'use strict';
// Accounts (phone + password), sessions and roles.
//
// Roles, from least to most power:
//   jogador     -> sees everything live, confirms own presence
//   organizador -> runs the game (goals, teams, presence, queue)
//   admin       -> everything, plus rules, backups and accounts (the owner)
//
// Passwords are stored as scrypt hashes; sessions as SHA-256 of a random
// token kept in an httpOnly cookie.
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'pelada_sid';
const SESSION_DAYS = 60;
const ROLES = { jogador: 1, organizador: 2, admin: 3 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [kind, saltHex, hashHex] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Keeps digits only; accepts 10-13 digits (DDD + number, with or without 55).
function normalizePhone(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length < 10 || d.length > 13) return null;
  return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
}

function formatPhone(d) {
  if (!d) return '';
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(req, res, token) {
  const secure = req.secure ? '; Secure' : '';
  res.set('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

function clearSessionCookie(res) {
  res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Creates a session inside a store transaction; returns the raw token.
function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  // Drop expired sessions while we are here.
  for (const [h, s] of Object.entries(db.sessions)) {
    if (now - s.createdAt > SESSION_DAYS * 86400000) delete db.sessions[h];
  }
  db.sessions[tokenHash(token)] = { userId, createdAt: now };
  return token;
}

function revokeSessions(db, userId) {
  for (const [h, s] of Object.entries(db.sessions)) if (s.userId === userId) delete db.sessions[h];
}

// Express middleware: sets req.user (or null) from the session cookie.
function sessionMiddleware(store) {
  return (req, res, next) => {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const db = store.get();
      const s = db.sessions[tokenHash(token)];
      if (s && Date.now() - s.createdAt < SESSION_DAYS * 86400000) {
        const u = db.users.find((x) => x.id === s.userId && x.active);
        if (u) {
          req.user = u;
          req.sessionHash = tokenHash(token);
        }
      }
    }
    next();
  };
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, code: 'LOGIN_REQUIRED', error: 'Faça login para continuar.' });
    if (ROLES[req.user.role] < ROLES[role]) {
      const who = role === 'admin' ? 'o administrador' : 'organizadores';
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: `Só ${who} podem fazer isso.` });
    }
    next();
  };
}

// What the browser may know about a user (never the password hash).
function publicUser(u) {
  return { id: u.id, name: u.name, phone: formatPhone(u.phone), role: u.role, playerId: u.playerId || null, active: u.active };
}

// Simple in-memory throttle: 5 failures per key -> blocked for 5 minutes.
function createThrottle(max = 5, blockMs = 5 * 60000) {
  const fails = new Map();
  return {
    blocked(key) {
      const f = fails.get(key);
      return Boolean(f && f.until > Date.now());
    },
    fail(key) {
      const f = fails.get(key) || { count: 0, until: 0 };
      f.count++;
      if (f.count >= max) { f.until = Date.now() + blockMs; f.count = 0; }
      fails.set(key, f);
    },
    ok(key) { fails.delete(key); },
  };
}

module.exports = {
  ROLES,
  hashPassword,
  verifyPassword,
  normalizePhone,
  formatPhone,
  createSession,
  revokeSessions,
  sessionMiddleware,
  requireRole,
  setSessionCookie,
  clearSessionCookie,
  publicUser,
  createThrottle,
};
