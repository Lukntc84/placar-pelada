'use strict';
// Starts a real server process on a temp data dir for integration tests.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ADMIN = { phone: '11999990000', password: 'admin-teste-123' };

async function startServer(env = {}, { dataDir } = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'pelada-'));
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT: '0', DATA_DIR: dir, DB_HOST: '',
      ADMIN_PHONE: ADMIN.phone, ADMIN_PASSWORD: ADMIN.password, ADMIN_RESET_PASSWORD: '', ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });
  // The OS picks a free port (PORT=0); the server prints it on startup.
  const port = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${stderr}`)), 15000);
    proc.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/localhost:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    proc.once('exit', () => { clearTimeout(timer); reject(new Error(`server exited: ${stderr}`)); });
  });
  proc.stdout.resume();
  const base = `http://127.0.0.1:${port}`;

  // Raw request; `cookie` selects the account (null = not logged in).
  async function raw(method, url, body, headers = {}, cookie = null) {
    const r = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    const setCookie = r.headers.get('set-cookie');
    return { status: r.status, headers: r.headers, cookie: setCookie && setCookie.split(';')[0], ...data };
  }

  // Logs in and returns a request function bound to that account.
  async function login(phone, password) {
    const r = await raw('POST', '/api/auth/login', { phone, password });
    if (!r.ok) throw new Error(`login ${phone}: ${r.error}`);
    return (method, url, body, headers) => raw(method, url, body, headers, r.cookie);
  }

  let req = null; // admin by default
  const anon = (method, url, body, headers) => raw(method, url, body, headers, null);

  if (env.ADMIN_PHONE === undefined) req = await login(ADMIN.phone, ADMIN.password);

  // Graceful stop (SIGTERM is not delivered on Windows, so ask nicely via kill
  // and wait for the process to exit).
  async function stop({ keep = false } = {}) {
    await new Promise((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
      proc.once('exit', resolve);
      proc.kill('SIGTERM');
      setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 3000).unref();
    });
    if (!keep && !dataDir) fs.rmSync(dir, { recursive: true, force: true });
  }

  return { req, anon, raw, login, stop, dir, base, stderr: () => stderr };
}

async function addPlayers(req, list) {
  const ids = {};
  for (const item of list) {
    const [name, position = 'ATA'] = item.split(':');
    const r = await req('POST', '/api/players', { name, position, rating: 3 });
    if (!r.ok) throw new Error(`addPlayer ${name}: ${r.error}`);
    ids[name] = r.player.id;
  }
  return ids;
}

module.exports = { startServer, addPlayers, ADMIN };
