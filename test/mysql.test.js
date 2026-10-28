'use strict';
// MySQL backend. Runs only when a test database is given:
//   TEST_DB_HOST, TEST_DB_PORT, TEST_DB_USER, TEST_DB_PASSWORD, TEST_DB_NAME
// (the database is wiped by this test).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, addPlayers } = require('./helpers');

const cfg = {
  DB_HOST: process.env.TEST_DB_HOST,
  DB_PORT: process.env.TEST_DB_PORT || '3306',
  DB_USER: process.env.TEST_DB_USER,
  DB_PASSWORD: process.env.TEST_DB_PASSWORD || '',
  DB_NAME: process.env.TEST_DB_NAME,
};
const skip = !cfg.DB_HOST && 'defina TEST_DB_HOST/TEST_DB_USER/TEST_DB_NAME para testar o MySQL';

async function query(sql, params) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: cfg.DB_HOST, port: Number(cfg.DB_PORT), user: cfg.DB_USER, password: cfg.DB_PASSWORD, database: cfg.DB_NAME,
  });
  try { return (await conn.query(sql, params))[0]; } finally { await conn.end(); }
}

async function wipe() {
  for (const t of ['players', 'matches', 'match_events', 'users', 'app_state']) await query(`DROP TABLE IF EXISTS ${t}`);
}

test('MySQL: tables created, rows readable, data reloaded after restart', { skip }, async () => {
  await wipe();
  let srv = await startServer(cfg);
  try {
  const ids = await addPlayers(srv.req, ['Ana:GOL', 'Beto', 'Caio', 'Duda']);
  await srv.req('POST', '/api/attendance', { playerIds: Object.values(ids), present: true, date: '2026-10-28' });
  const m = await srv.req('POST', '/api/matches', {
    teams: [{ name: 'Laranja', players: [ids.Ana, ids.Beto] }, { name: 'Azul', players: [ids.Caio, ids.Duda] }],
  });
  const g = await srv.req('POST', `/api/matches/${m.match.id}/events`, { team: 'A', scorerId: ids.Beto, deviceName: 'Mesa' });
  await srv.req('POST', `/api/matches/${m.match.id}/events`, { team: 'B', scorerId: ids.Caio, assistId: ids.Duda });
  await srv.req('DELETE', `/api/matches/${m.match.id}/events/${g.event.id}`, { by: 'Mesa' });
  await srv.req('PUT', '/api/players/' + ids.Duda, { name: 'Duda Ç', nickname: 'Dudão', rating: 5 });
  await srv.req('PUT', '/api/settings', { goalLimit: 3, tieRule: 'choose' });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal((await srv.req('GET', '/api/health')).store.pending, false);

  // Readable rows (what phpMyAdmin shows).
  const players = await query('SELECT name, nickname, rating FROM players ORDER BY name');
  assert.deepEqual(players.map((p) => p.name), ['Ana', 'Beto', 'Caio', 'Duda Ç']);
  assert.equal(players[3].nickname, 'Dudão');
  const [match] = await query('SELECT team_a_name, team_b_name, score_a, score_b, status FROM matches');
  assert.deepEqual({ ...match }, { team_a_name: 'Laranja', team_b_name: 'Azul', score_a: 0, score_b: 1, status: 'pending' });
  const events = await query('SELECT removed_by FROM match_events ORDER BY created_at');
  assert.deepEqual(events.map((e) => e.removed_by), ['Administrador', null]); // logged-in account

  await srv.stop();
  srv = await startServer(cfg);
  const s = await srv.req('GET', '/api/state');
  assert.equal(s.players.length, 4);
  assert.equal(s.settings.goalLimit, 3);
  assert.equal(s.settings.tieRule, 'choose');
  assert.equal(s.attendance.present.length, 4);
  const mm = s.matches[0];
  assert.equal(mm.teamA.name, 'Laranja');
  assert.equal(mm.events.length, 2);
  assert.equal(mm.events[0].removedBy, 'Administrador');
  assert.equal(mm.events[1].assistId, ids.Duda);

  // Deleting a match removes its rows.
  await srv.req('DELETE', `/api/matches/${mm.id}`);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal((await query('SELECT COUNT(*) AS n FROM matches'))[0].n, 0);
  assert.equal((await query('SELECT COUNT(*) AS n FROM match_events'))[0].n, 0);
  // Accounts are stored with a hash, never the password.
  const [admin] = await query("SELECT role, password_hash FROM users WHERE role = 'admin'");
  assert.match(admin.password_hash, /^scrypt\$/);
  } finally {
    await srv.stop();
  }
});

test('MySQL: first run imports an existing db.json', { skip }, async () => {
  await wipe();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pelada-import-'));
  try {
    const local = await startServer({}, { dataDir });
    await addPlayers(local.req, ['Zeca', 'Yuri']);
    await new Promise((r) => setTimeout(r, 300));
    await local.stop({ keep: true });

    const srv = await startServer(cfg, { dataDir });
    const s = await srv.req('GET', '/api/state');
    assert.deepEqual(s.players.map((p) => p.name), ['Zeca', 'Yuri']);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await query('SELECT COUNT(*) AS n FROM players'))[0].n, 2);
    await srv.stop({ keep: true });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
