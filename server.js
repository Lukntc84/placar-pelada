'use strict';
require('./src/env');

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const store = require('./src/store');
const createBackups = require('./src/backup');
const auth = require('./src/auth');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000; // PORT=0 = any free port
const DUP_WINDOW_MS = (Number(process.env.DUP_WINDOW_SECONDS) || 30) * 1000;
const IDEM_TTL_MS = 2 * 60 * 60 * 1000; // retries happen within seconds; 2h is plenty
const IDEM_MAX = 500;
const backups = createBackups(store);

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
// The page asks for app.js/style.css with a version taken from their content,
// so a CDN or browser cache can never pair a new page with an old script.
const PUBLIC_DIR = path.join(__dirname, 'public');
const readPublic = (f) => require('fs').readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
const BUILD = crypto.createHash('sha1').update(readPublic('app.js') + readPublic('style.css')).digest('hex').slice(0, 10);
const INDEX_HTML = readPublic('index.html')
  .replace('href="/style.css"', `href="/style.css?v=${BUILD}"`)
  .replace('src="/app.js"', `src="/app.js?v=${BUILD}"`);
app.get(['/', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(INDEX_HTML);
});
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, file) {
    // Versioned assets can be cached long; the service worker never.
    if (file.endsWith('sw.js')) res.set('Cache-Control', 'no-cache');
  },
}));
app.use(auth.sessionMiddleware(store));
const asPlayer = auth.requireRole('jogador');

// ---------------------------------------------------------------- helpers

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const uid = () => crypto.randomUUID();
const other = (t) => (t === 'A' ? 'B' : 'A');
const bad = (msg) => new HttpError(400, 'VALIDATION', msg);

function cleanStr(v, max) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function cleanInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function cleanColor(v) {
  return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : null;
}
const POSITIONS = ['', 'GOL', 'ZAG', 'LAT', 'MEI', 'ATA'];
function cleanPosition(v) {
  const p = String(v || '').toUpperCase();
  return POSITIONS.includes(p) ? p : '';
}

function getPlayer(db, id) {
  return db.players.find((p) => p.id === id);
}
function getMatch(db, id) {
  const m = db.matches.find((x) => x.id === id);
  if (!m) throw new HttpError(404, 'NOT_FOUND', 'Partida não encontrada.');
  return m;
}
function activeMatch(db) {
  return db.matches.find((m) => m.status !== 'finished');
}
function playerName(db, id) {
  const p = getPlayer(db, id);
  return p ? p.nickname || p.name : 'desconhecido';
}
// Removed (undone) goals stay in the record but never count.
function score(m, team) {
  return m.events.filter((e) => e.team === team && !e.removedAt).length;
}
function inMatch(m, id) {
  return m.teamA.players.includes(id) || m.teamB.players.includes(id);
}
// ------------------------------------------------- waiting teams (próximos)

const TEAM_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TEAM_COLORS = ['#f97316', '#3b82f6', '#eab308', '#a855f7', '#ef4444', '#14b8a6', '#ec4899', '#84cc16'];

const isGk = (db, id) => getPlayer(db, id)?.position === 'GOL';

// First free "Time X" name not used by the open match or a waiting team.
function nextIdentity(db, extraUsed = []) {
  const m = activeMatch(db);
  const used = new Set([...extraUsed, ...db.teams.map((t) => t.name), ...(m ? [m.teamA.name, m.teamB.name] : [])]);
  for (let i = 0; i < TEAM_LETTERS.length; i++) {
    const name = `Time ${TEAM_LETTERS[i]}`;
    if (!used.has(name)) return { name, color: TEAM_COLORS[i % TEAM_COLORS.length] };
  }
  return { name: `Time ${db.teams.length + 1}`, color: TEAM_COLORS[0] };
}

// A team is 1 goalkeeper + (teamSize - 1) line players. The goalkeeper slot
// is filled by a fixed goalkeeper (position GOL) when there is one; when
// there is not, a waiting player ("de próximo") goes in goal each match.
const lineSize = (db) => Math.max(1, db.settings.teamSize - 1);
const lineCount = (db, ids) => ids.filter((id) => !isGk(db, id)).length;

function pullGk(db) {
  const gk = db.queue.find((id) => isGk(db, id));
  if (gk) db.queue = db.queue.filter((id) => id !== gk);
  return gk || null;
}

function pullLine(db, count) {
  const picked = db.queue.filter((id) => !isGk(db, id)).slice(0, Math.max(0, count));
  db.queue = db.queue.filter((id) => !picked.includes(id));
  return picked;
}

// Runs after every change to the queue: gives waiting teams a fixed
// goalkeeper when one is available, completes short teams and, whenever
// there are enough loose line players, closes a new team.
function autoForm(db, extraUsedNames = []) {
  const ls = lineSize(db);
  db.teams = db.teams.filter((t) => t.players.length);
  for (const t of db.teams) {
    if (!t.players.some((id) => isGk(db, id))) {
      const gk = pullGk(db);
      if (gk) t.players.unshift(gk);
    }
    const missing = ls - lineCount(db, t.players);
    if (missing > 0) t.players.push(...pullLine(db, missing));
  }
  const formed = [];
  while (lineCount(db, db.queue) >= ls) {
    const gk = pullGk(db);
    const players = [...(gk ? [gk] : []), ...pullLine(db, ls)];
    const team = { id: uid(), ...nextIdentity(db, extraUsedNames), players, createdAt: Date.now() };
    db.teams.push(team);
    formed.push(team);
  }
  return formed;
}

// Who goes in goal for a team without a fixed goalkeeper: loose players
// first (goalkeepers first, then whoever kept goal fewer times while
// waiting, then arrival order); if nobody is loose, someone from the next
// waiting team. They keep their place in the queue.
function guestCandidates(db, exclude) {
  const duty = (id) => db.gkDuty[id] || 0;
  const rank = (ids) => ids
    .map((id, i) => ({ id, i }))
    .filter((x) => !exclude.has(x.id) && getPlayer(db, x.id)?.active)
    .sort((a, b) => isGk(db, b.id) - isGk(db, a.id) || duty(a.id) - duty(b.id) || a.i - b.i)
    .map((x) => x.id);
  return [...rank(db.queue), ...rank(db.teams[0]?.players || [])];
}

function assignGoalkeepers(db, m) {
  db.gkDuty ||= {};
  const taken = new Set([...m.teamA.players, ...m.teamB.players]);
  for (const t of [m.teamA, m.teamB]) {
    const fixed = t.players.find((id) => isGk(db, id));
    if (fixed) {
      t.gk = fixed;
      t.gkGuest = false;
      continue;
    }
    const guest = guestCandidates(db, taken)[0] || null;
    t.gk = guest;
    t.gkGuest = Boolean(guest);
    if (guest) {
      taken.add(guest);
      db.gkDuty[guest] = (db.gkDuty[guest] || 0) + 1;
    }
  }
}

// Player is on this side of the match (as a member or as its goalkeeper).
function onSide(m, team, id) {
  const t = m[`team${team}`];
  return t.players.includes(id) || t.gk === id;
}

// Removes players from the loose queue and from waiting teams.
function detach(db, ids) {
  const set = new Set(ids);
  db.queue = db.queue.filter((id) => !set.has(id));
  for (const t of db.teams) t.players = t.players.filter((id) => !set.has(id));
  db.teams = db.teams.filter((t) => t.players.length);
}

function isWaiting(db, id) {
  return db.queue.includes(id) || db.teams.some((t) => t.players.includes(id));
}

function checkVersion(m, baseVersion) {
  if (baseVersion !== undefined && Number(baseVersion) !== m.version) {
    throw new HttpError(
      409,
      'STALE',
      'A partida foi alterada por outro dispositivo. Confira a tela atualizada e tente de novo.'
    );
  }
}

// ------------------------------------------------------- realtime (SSE)

const clients = new Set();

function publicState() {
  const db = store.get();
  return {
    rev: db.rev,
    serverNow: Date.now(),
    dupWindowSeconds: DUP_WINDOW_MS / 1000,
    settings: db.settings,
    players: db.players,
    queue: db.queue,
    teams: db.teams,
    attendance: db.attendance,
    presenceLog: db.presenceLog,
    rsvp: db.rsvp,
    matches: db.matches,
  };
}

function broadcast() {
  const payload = `event: state\ndata: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) res.write(payload);
}

app.get('/api/stream', asPlayer, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disables proxy buffering (nginx/LiteSpeed)
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// Keeps idle connections alive behind proxies.
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25000).unref();

app.get('/api/state', asPlayer, (req, res) => res.json(publicState()));
app.get('/api/health', (req, res) => res.json({ ok: true, clients: clients.size, store: store.status() }));

// ---------------------------------------------------- mutation wrapper
//
// Every write goes through action():
//  1. Idempotency-Key header: the client generates one key per user action
//     and reuses it on network retries. If the key was already processed,
//     the stored response is returned and nothing is applied twice.
//  2. store.transaction(): atomic, serialized, rolled back on error.
//  3. broadcast(): every connected device receives the new state at once.

function pruneIdem(db) {
  const now = Date.now();
  const keys = Object.keys(db.idem);
  for (const k of keys) if (now - db.idem[k].at > IDEM_TTL_MS) delete db.idem[k];
  const left = Object.keys(db.idem);
  if (left.length > IDEM_MAX) {
    left.sort((x, y) => db.idem[x].at - db.idem[y].at);
    for (const k of left.slice(0, left.length - IDEM_MAX)) delete db.idem[k];
  }
}

function sendError(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ ok: false, code: err.code, error: err.message, ...(err.extra || {}) });
  }
  console.error(err);
  return res.status(500).json({ ok: false, code: 'INTERNAL', error: 'Erro interno no servidor.' });
}

// Keeps one presence list per day, for the attendance chart.
function syncPresenceLog(db) {
  const { date, present } = db.attendance;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return;
  db.presenceLog ||= {};
  if (present.length) db.presenceLog[date] = [...present];
  else delete db.presenceLog[date];
}

function action(handler) {
  return (req, res) => {
    // Keys are scoped per account so two users can never collide.
    const raw = cleanStr(req.get('Idempotency-Key'), 100);
    const key = raw && `${req.user ? req.user.id : 'anon'}:${raw}`;
    const cached = key && store.get().idem[key];
    if (cached) return res.json({ ...cached.body, replayed: true, rev: store.get().rev });

    try {
      const body = store.transaction((db) => {
        const out = { ok: true, ...(handler(db, req.body || {}, req) || {}) };
        syncPresenceLog(db);
        if (key) {
          pruneIdem(db);
          const { match, ...small } = out; // clients get the match through the live state
          db.idem[key] = { at: Date.now(), body: small };
        }
        return out;
      });
      broadcast();
      res.json({ ...body, rev: store.get().rev });
    } catch (err) {
      sendError(res, err);
    }
  };
}

const json = express.json({ limit: '200kb' });
// Game operations: organizers and admin. Rules, backups, accounts: admin only.
const write = [json, auth.requireRole('organizador')];
const adminOnly = [json, auth.requireRole('admin')];

// ------------------------------------------------------------- accounts

const loginThrottle = auth.createThrottle(5, 5 * 60000);
const signupThrottle = auth.createThrottle(10, 60 * 60000);

function linkPlayer(db, user, b) {
  if (b.playerId) {
    const p = getPlayer(db, b.playerId);
    if (!p || !p.active) throw bad('Jogador não encontrado.');
    if (db.users.some((u) => u.id !== user.id && u.active && u.playerId === p.id)) {
      throw new HttpError(409, 'PLAYER_TAKEN', `"${p.name}" já está ligado a outra conta. Fale com o administrador.`);
    }
    user.playerId = p.id;
    return null;
  }
  if (b.newPlayer) {
    const name = cleanStr(b.playerName || user.name, 40);
    const same = db.players.find((p) => p.active && p.name.toLowerCase() === name.toLowerCase());
    if (same) {
      // A player with this exact name that nobody owns yet is this person
      // (e.g. registered earlier by the organizer): link it.
      if (db.users.some((u) => u.id !== user.id && u.active && u.playerId === same.id)) {
        throw new HttpError(409, 'PLAYER_TAKEN', `Já existe um jogador "${name}" com conta. Use seu nome completo ou um apelido diferente.`);
      }
      if (b.position && !same.position) same.position = cleanPosition(b.position);
      user.playerId = same.id;
      return null;
    }
    const player = { id: uid(), name, nickname: '', position: cleanPosition(b.position), rating: 3, active: true, createdAt: Date.now() };
    db.players.push(player);
    user.playerId = player.id;
    return player;
  }
  return null;
}

app.post('/api/auth/register', json, async (req, res) => {
  try {
    if (signupThrottle.blocked(req.ip)) throw new HttpError(429, 'TOO_MANY', 'Muitos cadastros deste aparelho. Tente mais tarde.');
    const b = req.body || {};
    const name = cleanStr(b.name, 40);
    const phone = auth.normalizePhone(b.phone);
    const password = String(b.password || '');
    if (!name) throw bad('Informe seu nome.');
    if (!phone) throw bad('Celular inválido. Use DDD + número, ex.: (11) 98765-4321.');
    if (password.length < 6) throw bad('A senha precisa ter pelo menos 6 caracteres.');
    const hash = await auth.hashPassword(password);
    let token, user, created;
    store.transaction((db) => {
      if (db.users.some((u) => u.phone === phone)) {
        throw new HttpError(409, 'PHONE_EXISTS', 'Este celular já tem conta. Toque em "Entrar".');
      }
      user = { id: uid(), name, phone, role: 'jogador', passwordHash: hash, playerId: null, active: true, createdAt: Date.now() };
      // Every account gets its player right away (unless it picks one).
      created = linkPlayer(db, user, b.playerId ? b : { ...b, newPlayer: b.newPlayer !== false });
      db.users.push(user);
      token = auth.createSession(db, user.id);
    });
    signupThrottle.fail(req.ip); // counts sign-ups per device
    if (created) broadcast();
    auth.setSessionCookie(req, res, token);
    res.json({ ok: true, user: auth.publicUser(user) });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/auth/login', json, async (req, res) => {
  try {
    const b = req.body || {};
    const phone = auth.normalizePhone(b.phone);
    if (loginThrottle.blocked(req.ip) || (phone && loginThrottle.blocked(phone))) {
      throw new HttpError(429, 'TOO_MANY', 'Muitas tentativas. Aguarde 5 minutos.');
    }
    const user = phone && store.get().users.find((u) => u.phone === phone && u.active);
    const ok = user ? await auth.verifyPassword(b.password, user.passwordHash) : (await auth.hashPassword('x'), false);
    if (!ok) {
      loginThrottle.fail(req.ip);
      if (phone) loginThrottle.fail(phone);
      throw new HttpError(401, 'BAD_LOGIN', 'Celular ou senha incorretos.');
    }
    loginThrottle.ok(req.ip);
    loginThrottle.ok(phone);
    const token = store.transaction((db) => auth.createSession(db, user.id));
    auth.setSessionCookie(req, res, token);
    res.json({ ok: true, user: auth.publicUser(user) });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/auth/logout', (req, res) => {
  if (req.sessionHash) store.transaction((db) => { delete db.sessions[req.sessionHash]; });
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, code: 'LOGIN_REQUIRED', error: 'Faça login para continuar.' });
  res.json({ ok: true, user: auth.publicUser(req.user) });
});

// Players not linked to any account yet (for "who are you?").
app.get('/api/auth/linkable', asPlayer, (req, res) => {
  const db = store.get();
  const taken = new Set(db.users.filter((u) => u.active && u.playerId && u.id !== req.user.id).map((u) => u.playerId));
  res.json({
    ok: true,
    players: db.players
      .filter((p) => p.active && !taken.has(p.id))
      .map(({ id, name, nickname, position }) => ({ id, name, nickname, position }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  });
});

// Links my account to my player (pick from the list or create).
app.post('/api/auth/link', json, asPlayer, action((db, b, req) => {
  const user = db.users.find((u) => u.id === req.user.id);
  const created = linkPlayer(db, user, b);
  return { user: auth.publicUser(user), created: Boolean(created) };
}));

// A player says whether they play in goal (e.g. a goalkeeper who wants to
// play on the line). Only this flag; the rest of the player stays with the
// organizer.
app.post('/api/auth/goalkeeper', json, asPlayer, action((db, b, req) => {
  const user = db.users.find((u) => u.id === req.user.id);
  const p = user && getPlayer(db, user.playerId);
  if (!p) throw new HttpError(404, 'NO_PLAYER', 'Sua conta ainda não tem jogador.');
  const position = b.goalkeeper ? 'GOL' : p.position === 'GOL' ? '' : p.position;
  if (p.position === position) return { already: true, player: p };
  p.position = position;
  return { player: p };
}));

app.post('/api/auth/password', json, asPlayer, async (req, res) => {
  try {
    const b = req.body || {};
    if (!(await auth.verifyPassword(b.current, req.user.passwordHash))) throw new HttpError(401, 'BAD_LOGIN', 'Senha atual incorreta.');
    if (String(b.next || '').length < 6) throw bad('A nova senha precisa ter pelo menos 6 caracteres.');
    const hash = await auth.hashPassword(b.next);
    const token = store.transaction((db) => {
      const u = db.users.find((x) => x.id === req.user.id);
      u.passwordHash = hash;
      auth.revokeSessions(db, u.id); // logs out other devices
      return auth.createSession(db, u.id);
    });
    auth.setSessionCookie(req, res, token);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

// The owner is the account of ADMIN_PHONE (the first admin when it is not
// set). Other admins are granted in the app and can be removed; the owner
// can't be demoted, deactivated or have the password reset by them.
function ownerOf(db) {
  const phone = auth.normalizePhone(process.env.ADMIN_PHONE);
  return (phone && db.users.find((u) => u.phone === phone))
    || db.users.filter((u) => u.role === 'admin').sort((a, b) => a.createdAt - b.createdAt)[0];
}

// Admin: accounts.
app.get('/api/users', auth.requireRole('admin'), (req, res) => {
  const db = store.get();
  const owner = ownerOf(db);
  const users = db.users
    .map((u) => ({ ...auth.publicUser(u), owner: Boolean(owner && u.id === owner.id) }))
    .sort((a, b) => b.owner - a.owner || (b.role === 'admin') - (a.role === 'admin') || a.name.localeCompare(b.name, 'pt-BR'));
  res.json({ ok: true, users });
});

app.put('/api/users/:id', ...adminOnly, action((db, b, req) => {
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u) throw new HttpError(404, 'NOT_FOUND', 'Conta não encontrada.');
  if (u === ownerOf(db) && (b.role !== undefined || b.active !== undefined)) {
    throw new HttpError(403, 'FORBIDDEN', 'A conta do dono do app não pode ser alterada.');
  }
  if (b.role !== undefined) {
    if (!['jogador', 'organizador', 'admin'].includes(b.role)) throw bad('Papel inválido.');
    u.role = b.role;
  }
  if (b.active !== undefined) {
    u.active = Boolean(b.active);
    if (!u.active) auth.revokeSessions(db, u.id);
  }
  if (b.playerId !== undefined) {
    if (b.playerId === null) u.playerId = null;
    else linkPlayer(db, u, { playerId: b.playerId });
  }
  return { user: auth.publicUser(u) };
}));

app.post('/api/users/:id/password', ...adminOnly, async (req, res) => {
  try {
    const pwd = String((req.body || {}).password || '');
    if (pwd.length < 6) throw bad('A senha precisa ter pelo menos 6 caracteres.');
    const hash = await auth.hashPassword(pwd);
    store.transaction((db) => {
      const u = db.users.find((x) => x.id === req.params.id);
      if (!u) throw new HttpError(404, 'NOT_FOUND', 'Conta não encontrada.');
      const owner = ownerOf(db);
      if (u === owner && req.user.id !== owner.id) throw new HttpError(403, 'FORBIDDEN', 'Só o dono do app troca a própria senha.');
      u.passwordHash = hash;
      auth.revokeSessions(db, u.id);
    });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

// Creates (or resets, with ADMIN_RESET_PASSWORD=1) the owner's admin account
// from ADMIN_PHONE / ADMIN_PASSWORD. The password never lives in the code.
async function ensureAdmin() {
  const phone = auth.normalizePhone(process.env.ADMIN_PHONE);
  const password = process.env.ADMIN_PASSWORD || '';
  const existing = ownerOf(store.get());
  const reset = process.env.ADMIN_RESET_PASSWORD === '1';
  if (existing && !reset) return;
  if (!phone || password.length < 6) {
    if (!existing) console.warn('[admin] Defina ADMIN_PHONE e ADMIN_PASSWORD (mín. 6 caracteres) para criar a conta de administrador.');
    return;
  }
  const hash = await auth.hashPassword(password);
  store.transaction((db) => {
    let admin = db.users.find((u) => u.phone === phone) || ownerOf(db);
    if (!admin) {
      admin = { id: uid(), name: 'Administrador', phone, role: 'admin', passwordHash: hash, playerId: null, active: true, createdAt: Date.now() };
      db.users.push(admin);
    }
    if (db.users.some((u) => u !== admin && u.phone === phone)) throw new Error('ADMIN_PHONE já é usado por outra conta.');
    Object.assign(admin, { phone, role: 'admin', passwordHash: hash, active: true });
    auth.revokeSessions(db, admin.id);
  });
  console.log(`[admin] conta de administrador ${existing ? 'redefinida' : 'criada'} para ${auth.formatPhone(phone)}`);
}

// ------------------------------------------------------------- settings

// --------------------------------------------- test data and launch reset

const DEMO_NAMES = [
  ['Carlos Silva', 'GOL'], ['Marcelo Souza', 'GOL'], ['Paulo Lima', 'GOL'],
  ['Rafael Costa', 'ATA'], ['Bruno Alves', 'MEI'], ['Diego Rocha', 'ZAG'], ['Thiago Melo', 'ATA'],
  ['Pedro Gomes', 'MEI'], ['Lucas Pereira', 'LAT'], ['Felipe Barros', 'ATA'], ['João Ribeiro', 'ZAG'],
  ['Vinícius Dias', 'MEI'], ['Leandro Nunes', 'ATA'], ['Caio Martins', 'ZAG'], ['André Castro', 'MEI'],
  ['Igor Freitas', 'ATA'], ['Hugo Teixeira', 'LAT'], ['Nicolas Araújo', 'MEI'], ['Samuel Pinto', 'ZAG'],
  ['Otávio Cardoso', 'ATA'], ['Renan Moreira', 'MEI'], ['Gustavo Ramos', 'ATA'], ['Henrique Lopes', 'ZAG'],
  ['Matheus Cunha', 'MEI'], ['Fábio Correia', 'LAT'], ['Rodrigo Vieira', 'ATA'], ['Eduardo Moura', 'MEI'],
  ['Daniel Farias', 'ZAG'], ['Ricardo Batista', 'ATA'], ['Alexandre Reis', 'MEI'],
];

// Creates fictitious players (marked demo) to try the app before launch.
app.post('/api/admin/seed', ...adminOnly, action((db, b) => {
  const count = cleanInt(b.count, 1, DEMO_NAMES.length, 20);
  const added = [];
  for (const [name, position] of DEMO_NAMES) {
    if (added.length >= count) break;
    if (db.players.some((p) => p.active && p.name.toLowerCase() === name.toLowerCase())) continue;
    const player = {
      id: uid(), name: `${name} (teste)`, nickname: name.split(' ')[0], position,
      rating: 1 + Math.floor(Math.random() * 5), active: true, createdAt: Date.now(), demo: true,
    };
    db.players.push(player);
    added.push(player.id);
  }
  return { added: added.length };
}));

// Wipes game data for launch: players, matches, queue, presence and
// confirmations. Accounts and rules stay. A safety copy is saved first.
app.post('/api/admin/reset', ...adminOnly, action((db, b) => {
  if (b.confirm !== 'ZERAR') throw bad('Para confirmar, digite ZERAR.');
  if (b.scope !== 'all' && b.scope !== 'demo') throw bad('Escolha o que apagar.');
  const backup = backups.saveCopy(b.scope === 'all' ? 'antes-de-zerar' : 'antes-de-limpar-testes');
  if (b.scope === 'demo') {
    // demo flag, or the "(teste)" suffix (the MySQL table keeps only fixed columns)
    const demo = new Set(db.players.filter((p) => p.demo || / \(teste\)$/.test(p.name)).map((p) => p.id));
    const touches = (m) => [...m.teamA.players, ...m.teamB.players, m.teamA.gk, m.teamB.gk].some((id) => demo.has(id));
    db.matches = db.matches.filter((m) => !touches(m));
    db.players = db.players.filter((p) => !demo.has(p.id));
    db.queue = db.queue.filter((id) => !demo.has(id));
    db.teams = db.teams.map((t) => ({ ...t, players: t.players.filter((id) => !demo.has(id)) })).filter((t) => t.players.length);
    db.attendance.present = db.attendance.present.filter((id) => !demo.has(id));
    db.rsvp.yes = db.rsvp.yes.filter((id) => !demo.has(id));
    db.rsvp.no = db.rsvp.no.filter((id) => !demo.has(id));
    for (const u of db.users) if (demo.has(u.playerId)) u.playerId = null;
    return { backup, removed: demo.size };
  }
  db.players = [];
  db.matches = [];
  db.queue = [];
  db.teams = [];
  db.attendance = { date: null, present: [] };
  db.rsvp = { date: null, open: false, yes: [], no: [] };
  db.gkDuty = {};
  db.bench = {};
  for (const u of db.users) u.playerId = null;
  return { backup };
}));

app.put('/api/settings', ...adminOnly, action((db, b) => {
  db.settings.teamSize = cleanInt(b.teamSize, 1, 11, db.settings.teamSize);
  db.settings.durationMin = cleanInt(b.durationMin, 1, 120, db.settings.durationMin);
  db.settings.goalLimit = cleanInt(b.goalLimit, 0, 30, db.settings.goalLimit);
  if (b.tieRule === 'house' || b.tieRule === 'choose') db.settings.tieRule = b.tieRule;
  if (typeof b.autoRating === 'boolean') db.settings.autoRating = b.autoRating;
  autoForm(db);
  return { settings: db.settings };
}));

// -------------------------------------------------------------- players

// Rating (stars) starts at 3 and only the admin changes it; for anyone
// else `keep` is used (the current rating, or 3 for a new player).
function playerFields(b, user, keep = 3) {
  const name = cleanStr(b.name, 40);
  if (!name) throw bad('Informe o nome do jogador.');
  return {
    name,
    nickname: cleanStr(b.nickname, 20),
    position: cleanPosition(b.position),
    rating: user && user.role === 'admin' ? cleanInt(b.rating, 1, 5, keep) : keep,
  };
}

app.post('/api/players', ...write, action((db, b, req) => {
  const existing = db.players.find((p) => p.name.toLowerCase() === cleanStr(b.name, 40).toLowerCase());
  const fields = playerFields(b, req.user, existing ? existing.rating : 3);
  const same = db.players.find((p) => p.name.toLowerCase() === fields.name.toLowerCase());
  if (same && same.active) {
    // Also blocks two devices registering the same player at the same time.
    throw new HttpError(409, 'PLAYER_EXISTS', `Já existe um jogador chamado "${fields.name}".`);
  }
  let player = same;
  if (same) {
    Object.assign(same, fields, { active: true }); // reactivate and keep history
  } else {
    player = { id: uid(), ...fields, active: true, createdAt: Date.now() };
    db.players.push(player);
  }
  // "+ Convidado": a guest without an account who showed up today.
  if (b.present === true) {
    const queued = markPresent(db, [player.id], b.date);
    const formed = autoForm(db);
    return { player, reactivated: Boolean(same), present: true, queued, formed: formed.map((t) => t.name) };
  }
  return { player, reactivated: Boolean(same) };
}));

app.put('/api/players/:id', ...write, action((db, b, req) => {
  const p = getPlayer(db, req.params.id);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'Jogador não encontrado.');
  const fields = playerFields(b, req.user, p.rating);
  const clash = db.players.find((x) => x.id !== p.id && x.active && x.name.toLowerCase() === fields.name.toLowerCase());
  if (clash) throw new HttpError(409, 'PLAYER_EXISTS', `Já existe um jogador chamado "${fields.name}".`);
  Object.assign(p, fields);
  return { player: p };
}));

app.delete('/api/players/:id', ...write, action((db, b, req) => {
  const p = getPlayer(db, req.params.id);
  if (!p || !p.active) return { already: true };
  const m = activeMatch(db);
  if (m && inMatch(m, p.id)) {
    throw new HttpError(409, 'IN_MATCH', 'Jogador está na partida em andamento. Remova-o da partida antes.');
  }
  p.active = false; // soft delete keeps historic stats
  detach(db, [p.id]);
  db.attendance.present = db.attendance.present.filter((id) => id !== p.id);
  autoForm(db);
  return {};
}));

// ---------------------------------------------------- presence (dia)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayStarted = (db) => Boolean(activeMatch(db) || db.teams.length || db.queue.length);

// Marks players present; after the day started they also join the queue.
function markPresent(db, ids, date) {
  const att = db.attendance;
  if (!att.date && DATE_RE.test(date || '')) att.date = date;
  const m = activeMatch(db);
  const started = dayStarted(db);
  const queued = [];
  for (const id of ids) {
    if (!getPlayer(db, id)?.active || att.present.includes(id)) continue;
    att.present.push(id);
    if (started && !isWaiting(db, id) && !(m && inMatch(m, id))) {
      db.queue.push(id);
      queued.push(id);
    }
  }
  return queued;
}

// Body: { playerIds: [...], present: true|false, date: 'YYYY-MM-DD' }
// Setting presence is idempotent (marking twice = same result). Players who
// arrive after the day started go straight to the end of the loose queue.
app.post('/api/attendance', ...write, action((db, b) => {
  const att = db.attendance;
  const ids = Array.isArray(b.playerIds) ? b.playerIds : [];
  const m = activeMatch(db);
  let queued = [];
  if (b.present) {
    queued = markPresent(db, ids, b.date);
  } else {
    const gone = ids.filter((id) => !(m && inMatch(m, id)));
    att.present = att.present.filter((id) => !gone.includes(id));
    detach(db, gone);
  }
  const formed = autoForm(db);
  return { queued, formed: formed.map((t) => t.name) };
}));

// Starts a new day: clears presence, queue and waiting teams.
app.post('/api/day/reset', ...write, action((db, b) => {
  if (activeMatch(db)) throw new HttpError(409, 'MATCH_IN_PROGRESS', 'Encerre a partida em andamento antes de começar um novo dia.');
  db.attendance = { date: DATE_RE.test(b.date || '') ? b.date : null, present: [] };
  db.queue = [];
  db.teams = [];
  db.gkDuty = {};
  db.bench = {};
  return {};
}));

// ---------------------------------------------------- queue (próximos)

app.post('/api/queue', ...write, action((db, b) => {
  const ids = Array.isArray(b.playerIds) ? b.playerIds : [];
  const m = activeMatch(db);
  const added = [];
  for (const id of ids) {
    const p = getPlayer(db, id);
    if (p && p.active && !isWaiting(db, id) && !(m && inMatch(m, id))) {
      if (!db.attendance.present.includes(id)) db.attendance.present.push(id);
      db.queue.push(id);
      added.push(id);
    }
  }
  const formed = autoForm(db);
  return { added, formed: formed.map((t) => t.name) };
}));

// Relative moves (up/down) never conflict with concurrent additions.
app.post('/api/queue/move', ...write, action((db, b) => {
  const from = db.queue.indexOf(b.playerId);
  if (from === -1) throw new HttpError(404, 'NOT_FOUND', 'Jogador não está na fila.');
  const to = b.to === 'top' ? 0 : Math.min(db.queue.length - 1, Math.max(0, from + cleanInt(b.delta, -50, 50, 0)));
  db.queue.splice(from, 1);
  db.queue.splice(to, 0, b.playerId);
  return {};
}));

// Removes a player from the waiting lists (loose queue or waiting team).
// A waiting team that loses a player is completed again from the queue.
app.delete('/api/queue/:playerId', ...write, action((db, b, req) => {
  detach(db, [req.params.playerId]);
  autoForm(db);
  return {};
}));

app.delete('/api/queue', ...write, action((db) => {
  db.queue = [];
  db.teams = [];
  return {};
}));

app.post('/api/teams/move', ...write, action((db, b) => {
  const from = db.teams.findIndex((t) => t.id === b.teamId);
  if (from === -1) throw new HttpError(404, 'NOT_FOUND', 'Time não encontrado.');
  const to = Math.min(db.teams.length - 1, Math.max(0, from + cleanInt(b.delta, -20, 20, 0)));
  const [t] = db.teams.splice(from, 1);
  db.teams.splice(to, 0, t);
  return {};
}));

// Dissolves a waiting team: its players go back to the end of the loose queue.
app.delete('/api/teams/:id', ...write, action((db, b, req) => {
  const t = db.teams.find((x) => x.id === req.params.id);
  if (!t) return { already: true };
  db.teams = db.teams.filter((x) => x !== t);
  db.queue.push(...t.players.filter((id) => !db.queue.includes(id)));
  autoForm(db);
  return {};
}));

// ------------------------------------------------------------- matches

function buildTeam(db, t, identity, used) {
  const players = [...new Set(Array.isArray(t?.players) ? t.players : [])];
  if (!players.length) throw bad('Cada time precisa de pelo menos 1 jogador.');
  for (const id of players) {
    const p = getPlayer(db, id);
    if (!p || !p.active) throw bad('Há um jogador inválido na escalação.');
    if (used.has(id)) throw bad(`"${p.nickname || p.name}" está em dois times.`);
    used.add(id);
  }
  return {
    id: uid(),
    name: cleanStr(t?.name, 24) || identity.name,
    color: cleanColor(t?.color) || identity.color,
    players,
  };
}

function createMatch(db, teamA, teamB, durationMin) {
  // Only one match can be open at a time: if two devices press "Criar partida"
  // together, the second one gets a 409 instead of creating a duplicate match.
  if (activeMatch(db)) {
    throw new HttpError(409, 'MATCH_IN_PROGRESS', 'Já existe uma partida em andamento.');
  }
  const number = db.matches.reduce((n, m) => Math.max(n, m.number || 0), 0) + 1;
  const m = {
    id: uid(),
    number,
    teamA,
    teamB,
    durationMin: cleanInt(durationMin, 1, 120, db.settings.durationMin),
    status: 'pending', // pending | running | paused | finished
    elapsedMs: 0,
    startedAt: null,
    events: [],
    version: 1,
    createdAt: Date.now(),
    finishedAt: null,
    nextMatchId: null,
  };
  detach(db, [...teamA.players, ...teamB.players]);
  db.gkDuty ||= {};
  for (const id of [...teamA.players, ...teamB.players]) delete db.gkDuty[id]; // new waiting stint later
  assignGoalkeepers(db, m);
  db.matches.push(m);
  return m;
}

// Body: { teams: [{name, color, players}, ...], extras: [playerIds], durationMin }
// The first two teams play; the others wait in order; extras join the queue.
// (Also accepts the older { teamA, teamB } shape.)
app.post('/api/matches', ...write, action((db, b) => {
  const list = Array.isArray(b.teams) ? b.teams : [b.teamA, b.teamB];
  if (list.length < 2) throw bad('Monte pelo menos 2 times.');
  if (activeMatch(db)) throw new HttpError(409, 'MATCH_IN_PROGRESS', 'Já existe uma partida em andamento.');
  const used = new Set();
  const usedNames = [];
  const teams = list.map((t, i) => {
    const fallback = i < TEAM_LETTERS.length
      ? { name: `Time ${TEAM_LETTERS[i]}`, color: TEAM_COLORS[i % TEAM_COLORS.length] }
      : nextIdentity(db, usedNames);
    const team = buildTeam(db, t, fallback, used);
    usedNames.push(team.name);
    return team;
  });
  const extras = (Array.isArray(b.extras) ? b.extras : []).filter((id) => getPlayer(db, id)?.active && !used.has(id));

  // Players being rearranged leave whatever list they were in.
  detach(db, [...used, ...extras]);
  for (const id of [...used, ...extras]) if (!db.attendance.present.includes(id)) db.attendance.present.push(id);
  const match = createMatch(db, teams[0], teams[1], b.durationMin);
  db.teams.unshift(...teams.slice(2).map((t) => ({ ...t, createdAt: Date.now() })));
  db.queue.push(...extras);
  autoForm(db);
  return { match };
}));

// Starts a match with the first two waiting teams.
app.post('/api/matches/from-teams', ...write, action((db, b) => {
  if (activeMatch(db)) throw new HttpError(409, 'MATCH_IN_PROGRESS', 'Já existe uma partida em andamento.');
  if (db.teams.length < 2) throw bad('São necessários 2 times formados na fila de próximos.');
  const [a, c] = db.teams.splice(0, 2);
  const strip = (t) => ({ id: t.id, name: t.name, color: t.color, players: t.players });
  const match = createMatch(db, strip(a), strip(c), b.durationMin);
  autoForm(db);
  return { match };
}));

app.delete('/api/matches/:id', ...write, action((db, b, req) => {
  const m = db.matches.find((x) => x.id === req.params.id);
  if (!m) return { already: true };
  if (m.status !== 'finished') {
    // Cancelled match: both teams go back to the front of the waiting teams.
    const back = (t) => ({ id: t.id || uid(), name: t.name, color: t.color, players: [...t.players], createdAt: Date.now() });
    detach(db, [...m.teamA.players, ...m.teamB.players]);
    db.teams.unshift(back(m.teamA), back(m.teamB));
  }
  db.matches = db.matches.filter((x) => x.id !== m.id);
  for (const x of db.matches) if (x.nextMatchId === m.id) x.nextMatchId = null;
  return {};
}));

// Timer: the server stores only the accumulated time plus the moment it was
// last started. Every device computes the clock from that, so all screens
// show the same time and a page reload never loses the count.
app.post('/api/matches/:id/timer', ...write, action((db, b, req) => {
  const m = getMatch(db, req.params.id);
  if (m.status === 'finished') throw new HttpError(409, 'FINISHED', 'Partida já encerrada.');
  const now = Date.now();
  switch (b.action) {
    case 'start': // idempotent: pressing "start" on two phones has no extra effect
      if (m.status !== 'running') {
        m.status = 'running';
        m.startedAt = now;
        m.version++;
      }
      break;
    case 'pause':
      if (m.status === 'running') {
        m.elapsedMs += now - m.startedAt;
        m.startedAt = null;
        m.status = 'paused';
        m.version++;
      }
      break;
    case 'adjust': {
      // Not idempotent by nature, so it requires the version the user saw.
      checkVersion(m, b.baseVersion);
      const delta = cleanInt(b.seconds, -600, 600, 0) * 1000;
      const current = m.elapsedMs + (m.status === 'running' ? now - m.startedAt : 0);
      const target = Math.max(0, current + delta);
      m.elapsedMs = m.status === 'running' ? target - (now - m.startedAt) : target;
      m.version++;
      break;
    }
    case 'reset':
      checkVersion(m, b.baseVersion);
      m.elapsedMs = 0;
      m.startedAt = m.status === 'running' ? now : null;
      m.version++;
      break;
    default:
      throw bad('Ação de cronômetro inválida.');
  }
  return { match: m };
}));

app.post('/api/matches/:id/events', ...write, action((db, b, req) => {
  const m = getMatch(db, req.params.id);
  const team = b.team;
  if (team !== 'A' && team !== 'B') throw bad('Time inválido.');
  const ownGoal = Boolean(b.ownGoal);
  const scorerTeam = ownGoal ? other(team) : team;
  const scorerId = b.scorerId || null;
  const assistId = ownGoal ? null : b.assistId || null;

  if (ownGoal && !scorerId) throw bad('Informe quem fez o gol contra.');
  if (scorerId && !onSide(m, scorerTeam, scorerId)) {
    throw bad('O autor do gol não está nesse time.');
  }
  if (assistId && (assistId === scorerId || !onSide(m, team, assistId))) {
    throw bad('Assistência inválida.');
  }

  const now = Date.now();

  // Duplicate protection: the same goal (same team, same scorer) recorded
  // again within the window is almost always two people tapping for the same
  // lance. Reject it and let the client confirm with force=true if it really
  // was a second goal.
  if (!b.force) {
    const recent = m.events.find(
      (e) =>
        e.team === team &&
        e.scorerId === scorerId &&
        e.ownGoal === ownGoal &&
        !e.removedAt &&
        now - e.createdAt < DUP_WINDOW_MS
    );
    if (recent) {
      throw new HttpError(
        409,
        'DUPLICATE_SUSPECT',
        `Gol de ${scorerId ? playerName(db, scorerId) : 'autor desconhecido'} já foi registrado há ${Math.round((now - recent.createdAt) / 1000)}s por "${recent.deviceName}".`,
        { existing: recent }
      );
    }
  }

  const elapsed = m.elapsedMs + (m.status === 'running' ? now - m.startedAt : 0);
  const event = {
    id: uid(),
    team,
    scorerId,
    assistId,
    ownGoal,
    minute: Math.floor(elapsed / 60000) + 1,
    createdAt: now,
    deviceId: req.user ? req.user.id : cleanStr(b.deviceId, 64),
    deviceName: req.user ? req.user.name : cleanStr(b.deviceName, 30) || 'Anônimo',
  };
  m.events.push(event);
  m.version++;

  // "Partida acaba com X gols": the match ends when a team reaches the limit.
  let autoFinished = false;
  const limit = db.settings.goalLimit;
  if (limit > 0 && m.status !== 'finished' && score(m, team) >= limit) {
    finish(m, 'goals');
    autoFinished = true;
  }
  return { event, match: m, autoFinished };
}));

// Undo keeps the goal in the record (who removed it and when) but it no longer
// counts. If that goal had ended the match by the goal limit, the match is
// reopened (paused) so play can continue.
app.delete('/api/matches/:id/events/:eventId', ...write, action((db, b, req) => {
  const m = getMatch(db, req.params.id);
  const e = m.events.find((x) => x.id === req.params.eventId);
  if (!e || e.removedAt) return { already: true }; // someone already undid it
  e.removedAt = Date.now();
  e.removedBy = req.user ? req.user.name : cleanStr(b.by, 30) || 'Anônimo';
  m.version++;
  let reopened = false;
  const limit = db.settings.goalLimit;
  if (m.status === 'finished' && m.endReason === 'goals' && !m.nextMatchId && !activeMatch(db) &&
      !(limit > 0 && (score(m, 'A') >= limit || score(m, 'B') >= limit))) {
    reopen(m);
    reopened = true;
  }
  return { match: m, reopened };
}));

// Substitutions / late arrivals.
app.post('/api/matches/:id/players', ...write, action((db, b, req) => {
  const m = getMatch(db, req.params.id);
  if (b.team !== 'A' && b.team !== 'B') throw bad('Time inválido.');
  const team = m[`team${b.team}`];
  const p = getPlayer(db, b.playerId);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'Jogador não encontrado.');
  if (b.op === 'add') {
    if (inMatch(m, p.id)) return { already: true };
    team.players.push(p.id);
    detach(db, [p.id]);
    autoForm(db);
  } else if (b.op === 'remove') {
    if (!team.players.includes(p.id)) return { already: true };
    team.players = team.players.filter((id) => id !== p.id);
    if (team.gk === p.id) team.gk = null;
  } else {
    throw bad('Operação inválida.');
  }
  m.version++;
  return { match: m };
}));

// Changes who is in goal for one side. playerId null = no goalkeeper.
app.post('/api/matches/:id/gk', ...write, action((db, b, req) => {
  const m = getMatch(db, req.params.id);
  if (b.team !== 'A' && b.team !== 'B') throw bad('Time inválido.');
  const t = m[`team${b.team}`];
  const id = b.playerId || null;
  if (id) {
    if (!getPlayer(db, id)?.active) throw new HttpError(404, 'NOT_FOUND', 'Jogador não encontrado.');
    if (onSide(m, other(b.team), id)) throw bad('Esse jogador está no outro time.');
  }
  if (t.gk === id) return { already: true };
  t.gk = id;
  t.gkGuest = Boolean(id) && !t.players.includes(id);
  m.version++;
  return { match: m };
}));

function finish(m, reason = 'manual') {
  if (m.status === 'finished') return false;
  const now = Date.now();
  if (m.status === 'running') m.elapsedMs += now - m.startedAt;
  m.startedAt = null;
  m.status = 'finished';
  m.finishedAt = now;
  m.endReason = reason;
  m.version++;
  return true;
}

function reopen(m) {
  m.status = 'paused';
  m.finishedAt = null;
  m.endReason = null;
  m.version++;
}

app.post('/api/matches/:id/finish', ...write, action((db, b, req) => {
  const m = getMatch(db, req.params.id);
  return { already: !finish(m), match: m };
}));

// Reopens the last match (e.g. it was ended by mistake), while the next one
// has not been created yet.
app.post('/api/matches/:id/reopen', ...write, action((db, b, req) => {
  const m = getMatch(db, req.params.id);
  if (m.status !== 'finished') return { already: true };
  if (m.nextMatchId) throw new HttpError(409, 'ALREADY_NEXT', 'A próxima partida já foi criada.');
  if (activeMatch(db)) throw new HttpError(409, 'MATCH_IN_PROGRESS', 'Já existe uma partida em andamento.');
  reopen(m);
  return { match: m };
}));

// Decides who leaves. Loser leaves. On a tie, with the house rule:
//  - 2 or more teams waiting: both teams leave and the next two play;
//  - 1 team waiting (or only loose players): the team that won the previous
//    match (holdover) stays; in the first match of the day someone must choose.
// With tieRule 'choose', a tie always needs an explicit choice.
function decideLeaving(db, m, requested) {
  if (requested === 'A' || requested === 'B') return requested;
  const sA = score(m, 'A');
  const sB = score(m, 'B');
  if (sA !== sB) return sA > sB ? 'B' : 'A';
  if (db.settings.tieRule === 'house') {
    if (db.teams.length >= 2) return 'both';
    if (m.holdover) return other(m.holdover);
    throw new HttpError(400, 'NEED_CHOICE', 'Empate entre dois times novos: escolha qual time sai.');
  }
  throw new HttpError(400, 'NEED_CHOICE', 'Empate: escolha qual time sai.');
}

const stripTeam = (t) => ({ id: t.id || uid(), name: t.name, color: t.color, players: [...t.players] });

// "Vencedor fica": the winner stays, the next waiting team comes in, and the
// leaving players go to the end of the loose queue (where they may complete
// or close a new team automatically).
app.post('/api/matches/:id/next', ...write, action((db, b, req) => {
  const m = getMatch(db, req.params.id);
  finish(m);
  if (m.nextMatchId) {
    throw new HttpError(409, 'ALREADY_NEXT', 'A próxima partida já foi criada por outro dispositivo.', {
      nextMatchId: m.nextMatchId,
    });
  }
  if (activeMatch(db)) throw new HttpError(409, 'MATCH_IN_PROGRESS', 'Já existe uma partida em andamento.');
  const leaving = decideLeaving(db, m, b.both ? null : b.leaving);
  const durationMin = b.durationMin ?? m.durationMin;
  // Leaving players go to the end of the queue. Who goes first (and so gets
  // picked to complete the next team) is a rotation: whoever was left out as
  // a loose player more times goes first; ties are drawn, so the first time
  // it is a plain draw.
  db.bench ||= {};
  const leavers = [];
  const toQueue = (ids, keep = []) => {
    const eligible = ids.filter((id) => getPlayer(db, id)?.active && !isWaiting(db, id) && !keep.includes(id));
    const ordered = eligible
      .map((id) => ({ id, r: Math.random() }))
      .sort((a, b) => (db.bench[b.id] || 0) - (db.bench[a.id] || 0) || a.r - b.r)
      .map((x) => x.id);
    db.queue.push(...ordered);
    leavers.push(...ordered);
  };
  // After the new teams are formed: left out again -> more priority next time;
  // made it into a team -> back to zero.
  const settleBench = () => {
    for (const id of leavers) {
      if (db.queue.includes(id)) db.bench[id] = (db.bench[id] || 0) + 1;
      else delete db.bench[id];
    }
  };

  if (leaving === 'both') {
    // The team that played longer (holdover) goes after the other one.
    const order = m.holdover ? [other(m.holdover), m.holdover] : ['A', 'B'];
    for (const side of order) toQueue(m[`team${side}`].players);
    autoForm(db);
    const [first, second] = db.teams.splice(0, 2);
    const next = createMatch(db, stripTeam(first), stripTeam(second), durationMin);
    m.nextMatchId = next.id;
    autoForm(db);
    settleBench();
    return { match: next, leaving: 'both' };
  }

  const stay = m[`team${other(leaving)}`];
  const leave = m[`team${leaving}`];
  const staying = stay.players.filter((id) => getPlayer(db, id)?.active);
  if (!staying.length) throw bad('O time que fica não tem jogadores ativos.');

  toQueue(leave.players, staying);
  // Completes the next team (if short) and closes new teams, then takes it.
  autoForm(db, [stay.name]);
  let challenger = db.teams.shift();
  if (!challenger) {
    // Not enough people for a full team: play with whoever is waiting.
    const gk = pullGk(db);
    const players = [...(gk ? [gk] : []), ...pullLine(db, lineSize(db))];
    if (!players.length) throw bad('Não há ninguém na fila de próximos.');
    challenger = { id: uid(), ...nextIdentity(db, [stay.name]), players };
  }

  const newStay = { ...stripTeam(stay), players: staying };
  const newChal = stripTeam(challenger);
  const next = createMatch(
    db,
    leaving === 'A' ? newChal : newStay,
    leaving === 'A' ? newStay : newChal,
    durationMin
  );
  next.holdover = other(leaving); // remembers who won, for the tie rule
  m.nextMatchId = next.id;
  autoForm(db);
  settleBench();
  return { match: next, leaving };
}));

// --------------------------------------------- confirmation by link (RSVP)

// Public page data: who confirmed for the open date.
app.get('/api/rsvp', asPlayer, (req, res) => {
  const db = store.get();
  res.json({
    ...db.rsvp,
    players: db.players
      .filter((p) => p.active)
      .map(({ id, name, nickname, position }) => ({ id, name, nickname, position }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  });
});

// Players answer from their own phone (no PIN): "vou" / "não vou".
// Players answer for themselves (their linked player); organizers for anyone.
app.post('/api/rsvp/answer', json, asPlayer, action((db, b, req) => {
  if (!db.rsvp.open) throw new HttpError(409, 'CLOSED', 'A confirmação de presença está fechada.');
  const playerId = b.playerId || req.user.playerId;
  if (!playerId) throw bad('Ligue sua conta ao seu nome de jogador primeiro.');
  if (req.user.role === 'jogador' && playerId !== req.user.playerId) {
    throw new HttpError(403, 'FORBIDDEN', 'Você só pode confirmar a sua própria presença.');
  }
  const p = getPlayer(db, playerId);
  if (!p || !p.active) throw new HttpError(404, 'NOT_FOUND', 'Jogador não encontrado.');
  db.rsvp.yes = db.rsvp.yes.filter((id) => id !== p.id);
  db.rsvp.no = db.rsvp.no.filter((id) => id !== p.id);
  if (b.going === true) db.rsvp.yes.push(p.id);
  else if (b.going === false) db.rsvp.no.push(p.id);
  return {};
}));

app.post('/api/rsvp/open', ...write, action((db, b) => {
  if (!DATE_RE.test(b.date || '')) throw bad('Informe a data do jogo.');
  if (db.rsvp.open && db.rsvp.date === b.date) return { already: true };
  db.rsvp = { date: b.date, open: true, yes: [], no: [] };
  return {};
}));

app.post('/api/rsvp/close', ...write, action((db) => {
  db.rsvp.open = false;
  return {};
}));

// ------------------------------------------------------- backup/restore

app.get('/api/backup', auth.requireRole('admin'), (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.set('Content-Disposition', `attachment; filename="pelada-backup-${stamp}.json"`);
  res.json(backups.snapshot(store.get()));
});

// Automatic daily backups kept on the server.
app.get('/api/backups', auth.requireRole('admin'), (req, res) => res.json({ ok: true, backups: backups.list() }));
app.post('/api/backups/run', ...adminOnly, (req, res) => {
  const name = backups.run(true);
  res.json({ ok: Boolean(name), name, backups: backups.list() });
});
app.get('/api/backups/:name', auth.requireRole('admin'), (req, res) => {
  const file = backups.filePath(req.params.name);
  if (!file || !require('fs').existsSync(file)) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Backup não encontrado.' });
  }
  res.download(file, req.params.name);
});

app.post('/api/restore', express.json({ limit: '10mb' }), auth.requireRole('admin'), (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.players) || !Array.isArray(b.matches) || !Array.isArray(b.queue)) {
    return res.status(400).json({ ok: false, code: 'VALIDATION', error: 'Arquivo de backup inválido.' });
  }
  const current = store.get();
  store.replaceAll({
    users: current.users, // accounts are not part of the game data
    sessions: current.sessions,
    settings: b.settings,
    players: b.players,
    queue: b.queue,
    teams: Array.isArray(b.teams) ? b.teams : [],
    attendance: b.attendance && Array.isArray(b.attendance.present) ? b.attendance : { date: null, present: [] },
    rsvp: b.rsvp && Array.isArray(b.rsvp.yes) ? b.rsvp : { date: null, open: false, yes: [], no: [] },
    matches: b.matches,
  });
  broadcast();
  res.json({ ok: true });
});

// ----------------------------------------------------------------- boot

app.use('/api', (req, res) => res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Rota não encontrada.' }));

let server;

async function main() {
  await store.init();
  await ensureAdmin();
  backups.start();
  server = app.listen(PORT, () => {
    console.log(`Placar da Pelada rodando em http://localhost:${server.address().port}`);
    console.log(`Dados: ${store.status().backend} | backups: ${backups.dir}`);
    console.log(`Contas: ${store.get().users.length} (admin: ${store.get().users.some((u) => u.role === 'admin') ? 'sim' : 'NÃO CONFIGURADO'})`);
  });
}

main().catch((err) => {
  console.error('Falha ao iniciar:', err.message);
  process.exit(1);
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const res of clients) res.end();
  try {
    await store.close();
  } catch (err) {
    console.error('Falha ao salvar na saída:', err.message);
  }
  if (server) server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
