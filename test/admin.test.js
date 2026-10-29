'use strict';
// Accounts and roles, confirmation by link, automatic backups and persistence.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, addPlayers } = require('./helpers');

test('accounts: login required, sign-up as jogador, roles enforced', async () => {
  const { req, anon, login, stop } = await startServer();
  try {
    // Not logged in: no data.
    assert.equal((await anon('GET', '/api/state')).status, 401);
    assert.equal((await anon('POST', '/api/players', { name: 'X' })).status, 401);

    // Admin creates players; Ana signs up linking herself to her player.
    const ana = (await req('POST', '/api/players', { name: 'Ana' })).player.id;
    const reg = await anon('POST', '/api/auth/register', { name: 'Ana Souza', phone: '(21) 98888-7777', password: 'segredo1', playerId: ana });
    assert.equal(reg.ok, true, reg.error);
    assert.equal(reg.user.role, 'jogador');
    assert.equal(reg.user.playerId, ana);
    assert.equal(reg.user.passwordHash, undefined);
    assert.match(reg.cookie, /^pelada_sid=/);

    // Same phone again (other format) is refused; weak password refused.
    assert.equal((await anon('POST', '/api/auth/register', { name: 'Outra', phone: '5521988887777', password: 'abcdef' })).code, 'PHONE_EXISTS');
    assert.equal((await anon('POST', '/api/auth/register', { name: 'Beto', phone: '21977776666', password: '123' })).status, 400);
    // Player already linked to another account.
    assert.equal((await anon('POST', '/api/auth/register', { name: 'Fake', phone: '21900001111', password: 'abcdef', playerId: ana })).code, 'PLAYER_TAKEN');

    // Jogador can read, cannot run the game or change rules.
    const asAna = await login('21988887777', 'segredo1');
    assert.equal((await asAna('GET', '/api/state')).status, 200);
    assert.equal((await asAna('POST', '/api/players', { name: 'Z' })).status, 403);
    assert.equal((await asAna('PUT', '/api/settings', { goalLimit: 3 })).status, 403);
    assert.equal((await asAna('GET', '/api/backups')).status, 403);
    assert.equal((await asAna('GET', '/api/users')).status, 403);

    // Admin promotes Ana to organizador: she can run the game, not the rules.
    const users = (await req('GET', '/api/users')).users;
    const anaUser = users.find((u) => u.name === 'Ana Souza');
    assert.equal(users[0].role, 'admin');
    assert.equal((await req('PUT', `/api/users/${anaUser.id}`, { role: 'organizador' })).ok, true);
    assert.equal((await asAna('POST', '/api/players', { name: 'Caio' })).ok, true);
    assert.equal((await asAna('PUT', '/api/settings', { goalLimit: 3 })).status, 403);
    // Unknown roles are refused; the owner's admin account cannot be demoted.
    assert.equal((await req('PUT', `/api/users/${anaUser.id}`, { role: 'chefe' })).status, 400);
    assert.equal((await req('PUT', `/api/users/${users[0].id}`, { role: 'jogador' })).status, 403);

    // Goals are signed with the account name, not a client-provided one.
    const caio = (await req('GET', '/api/state')).players.find((p) => p.name === 'Caio').id;
    const m = await asAna('POST', '/api/matches', { teams: [{ players: [ana] }, { players: [caio] }] });
    const g = await asAna('POST', `/api/matches/${m.match.id}/events`, { team: 'A', scorerId: ana, deviceName: 'Mentira' });
    assert.equal(g.event.deviceName, 'Ana Souza');

    // Wrong password: generic message, throttled after 5 tries.
    const bad = await anon('POST', '/api/auth/login', { phone: '21988887777', password: 'errada' });
    assert.equal(bad.code, 'BAD_LOGIN');
    for (let i = 0; i < 5; i++) await anon('POST', '/api/auth/login', { phone: '21988887777', password: 'errada' });
    assert.equal((await anon('POST', '/api/auth/login', { phone: '21988887777', password: 'segredo1' })).status, 429);

    // Deactivated account loses access immediately.
    await req('PUT', `/api/users/${anaUser.id}`, { active: false });
    assert.equal((await asAna('GET', '/api/state')).status, 401);
  } finally { await stop(); }
});

test('accounts: logout, change password, admin reset, sign-up creating own player', async () => {
  const { req, anon, login, stop } = await startServer();
  try {
    const reg = await anon('POST', '/api/auth/register', { name: 'Duda', phone: '31955554444', password: 'primeira', newPlayer: true, position: 'GOL' });
    assert.equal(reg.ok, true, reg.error);
    const s = await req('GET', '/api/state');
    const duda = s.players.find((p) => p.id === reg.user.playerId);
    assert.equal(duda.name, 'Duda');
    assert.equal(duda.position, 'GOL');

    const asDuda = await login('31955554444', 'primeira');
    assert.equal((await asDuda('POST', '/api/auth/password', { current: 'errada', next: 'segunda1' })).code, 'BAD_LOGIN');
    assert.equal((await asDuda('POST', '/api/auth/password', { current: 'primeira', next: 'segunda1' })).ok, true);
    assert.equal((await asDuda('GET', '/api/state')).status, 401); // old session revoked
    const again = await login('31955554444', 'segunda1');
    assert.equal((await again('GET', '/api/auth/me')).user.name, 'Duda');
    await again('POST', '/api/auth/logout');
    assert.equal((await again('GET', '/api/state')).status, 401);

    const id = (await req('GET', '/api/users')).users.find((u) => u.name === 'Duda').id;
    assert.equal((await req('POST', `/api/users/${id}/password`, { password: 'temporaria' })).ok, true);
    await login('31955554444', 'temporaria');
  } finally { await stop(); }
});

test('admin account comes from env and can be reset', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pelada-admin-'));
  try {
    let srv = await startServer({ ADMIN_PHONE: '11911112222', ADMIN_PASSWORD: 'primeira1' }, { dataDir });
    await srv.login('11911112222', 'primeira1');
    await new Promise((r) => setTimeout(r, 300));
    await srv.stop({ keep: true });

    // A new env password is ignored unless ADMIN_RESET_PASSWORD=1.
    srv = await startServer({ ADMIN_PHONE: '11911112222', ADMIN_PASSWORD: 'outra123' }, { dataDir });
    await assert.rejects(srv.login('11911112222', 'outra123'));
    await srv.login('11911112222', 'primeira1');
    await srv.stop({ keep: true });

    srv = await startServer({ ADMIN_PHONE: '11911112222', ADMIN_PASSWORD: 'outra123', ADMIN_RESET_PASSWORD: '1' }, { dataDir });
    await new Promise((r) => setTimeout(r, 200));
    await srv.login('11911112222', 'outra123');
    await srv.stop({ keep: true });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('RSVP: each player confirms only for themselves, only while open', async () => {
  const { req, anon, login, stop } = await startServer();
  try {
    const ana = (await req('POST', '/api/players', { name: 'Ana' })).player.id;
    const beto = (await req('POST', '/api/players', { name: 'Beto' })).player.id;
    await anon('POST', '/api/auth/register', { name: 'Ana', phone: '41911110000', password: 'abcdef', playerId: ana });
    await anon('POST', '/api/auth/register', { name: 'Beto', phone: '41922220000', password: 'abcdef', playerId: beto });
    const asAna = await login('41911110000', 'abcdef');
    const asBeto = await login('41922220000', 'abcdef');

    assert.equal((await asAna('POST', '/api/rsvp/answer', { going: true })).code, 'CLOSED');
    assert.equal((await asAna('POST', '/api/rsvp/open', { date: '2026-11-01' })).status, 403);
    assert.equal((await req('POST', '/api/rsvp/open', { date: '2026-11-01' })).ok, true);

    await asAna('POST', '/api/rsvp/answer', { going: true });
    await asAna('POST', '/api/rsvp/answer', { going: true }); // twice = once
    await asBeto('POST', '/api/rsvp/answer', { going: false });
    assert.equal((await asAna('POST', '/api/rsvp/answer', { playerId: beto, going: true })).status, 403);
    let r = await asAna('GET', '/api/rsvp');
    assert.deepEqual(r.yes, [ana]);
    assert.deepEqual(r.no, [beto]);

    await asBeto('POST', '/api/rsvp/answer', { going: true }); // changed mind
    r = await req('GET', '/api/rsvp');
    assert.deepEqual(r.yes, [ana, beto]);
    assert.deepEqual(r.no, []);

    // Organizer removes someone who confirmed but won't come (neither list).
    await req('POST', '/api/rsvp/answer', { playerId: beto, going: null });
    r = await req('GET', '/api/rsvp');
    assert.deepEqual(r.yes, [ana]);
    assert.deepEqual(r.no, []);

    await req('POST', '/api/rsvp/close', {});
    assert.equal((await asAna('POST', '/api/rsvp/answer', { going: false })).code, 'CLOSED');
  } finally { await stop(); }
});

test('daily backup file is created and listed; data survives a restart', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pelada-persist-'));
  try {
    let srv = await startServer({}, { dataDir });
    const ids = await addPlayers(srv.req, ['Ana', 'Beto']);
    const m = await srv.req('POST', '/api/matches', { teams: [{ players: [ids.Ana] }, { players: [ids.Beto] }] });
    await srv.req('POST', `/api/matches/${m.match.id}/events`, { team: 'A', scorerId: ids.Ana });

    const run = await srv.req('POST', '/api/backups/run', {});
    assert.equal(run.ok, true);
    assert.match(run.name, /^pelada-\d{4}-\d{2}-\d{2}\.json$/);
    const list = await srv.req('GET', '/api/backups');
    assert.equal(list.backups.length, 1);
    const file = await srv.req('GET', `/api/backups/${run.name}`);
    assert.equal(file.players.length, 2);
    assert.equal(file.sessions, undefined); // sessions never go to backups
    const evil = await srv.req('GET', '/api/backups/..%2Fdb.json');
    assert.equal(evil.status, 404);

    // Restoring a backup keeps the accounts.
    const restored = await srv.req('POST', '/api/restore', { ...file, players: [file.players[0]] });
    assert.equal(restored.ok, true);
    assert.equal((await srv.req('GET', '/api/state')).players.length, 1);

    await new Promise((r) => setTimeout(r, 300)); // let the background save finish
    await srv.stop({ keep: true });

    srv = await startServer({}, { dataDir });
    const s = await srv.req('GET', '/api/state');
    assert.equal(s.players.length, 1);
    assert.equal(s.matches[0].events.length, 1);
    await srv.stop({ keep: true });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('admin: seed fictitious players, remove only them, then reset for launch', async () => {
  const { req, anon, login, stop } = await startServer();
  try {
    const real = (await req('POST', '/api/players', { name: 'Real Player' })).player.id;
    const seed = await req('POST', '/api/admin/seed', { count: 12 });
    assert.equal(seed.added, 12);
    let s = await req('GET', '/api/state');
    assert.equal(s.players.length, 13);
    const demoIds = s.players.filter((p) => p.name.endsWith('(teste)')).map((p) => p.id);
    await req('POST', '/api/matches', { teams: [{ players: [demoIds[0]] }, { players: [demoIds[1]] }] });
    await req('POST', '/api/attendance', { playerIds: [real, demoIds[2]], present: true });

    // Organizers cannot do this; a wrong confirmation is refused.
    await anon('POST', '/api/auth/register', { name: 'Org', phone: '51911112222', password: 'abcdef', newPlayer: false });
    const asOrg = await login('51911112222', 'abcdef');
    assert.equal((await asOrg('POST', '/api/admin/seed', {})).status, 403);
    assert.equal((await req('POST', '/api/admin/reset', { scope: 'all', confirm: 'nao' })).status, 400);

    const demo = await req('POST', '/api/admin/reset', { scope: 'demo', confirm: 'ZERAR' });
    assert.equal(demo.removed, 12);
    assert.match(demo.backup, /^pelada-antes-de-limpar-testes-/);
    s = await req('GET', '/api/state');
    assert.deepEqual(s.players.map((p) => p.id), [real]);
    assert.equal(s.matches.length, 0);
    assert.deepEqual(s.attendance.present, [real]);

    const all = await req('POST', '/api/admin/reset', { scope: 'all', confirm: 'ZERAR' });
    assert.match(all.backup, /^pelada-antes-de-zerar-/);
    s = await req('GET', '/api/state');
    assert.equal(s.players.length, 0);
    assert.equal((await req('GET', '/api/users')).users.length, 2); // accounts kept
    const list = (await req('GET', '/api/backups')).backups.map((b) => b.name);
    assert.ok(list.includes(all.backup) && list.includes(demo.backup));
  } finally { await stop(); }
});

test('sign-up creates the player (or links an unowned one); guest added on the spot is present', async () => {
  const { req, anon, stop } = await startServer();
  try {
    const reg = await anon('POST', '/api/auth/register', { name: 'Zé Novo', phone: '61911110000', password: 'abcdef', position: 'GOL' });
    assert.equal(reg.ok, true, reg.error);
    let s = await req('GET', '/api/state');
    const ze = s.players.find((p) => p.id === reg.user.playerId);
    assert.equal(ze.name, 'Zé Novo');
    assert.equal(ze.position, 'GOL');

    // Organizer created "Tico" before; Tico signs up and is linked to it.
    const tico = (await req('POST', '/api/players', { name: 'Tico' })).player.id;
    const reg2 = await anon('POST', '/api/auth/register', { name: 'tico', phone: '61922220000', password: 'abcdef' });
    assert.equal(reg2.user.playerId, tico);
    // Same name already owned by an account: refused with a clear message.
    const reg3 = await anon('POST', '/api/auth/register', { name: 'Tico', phone: '61933330000', password: 'abcdef' });
    assert.equal(reg3.code, 'PLAYER_TAKEN');

    // Guest without account: created and marked present; after the day started, queued.
    const g1 = await req('POST', '/api/players', { name: 'Convidado Um', present: true, date: '2026-10-28' });
    assert.equal(g1.present, true);
    s = await req('GET', '/api/state');
    assert.ok(s.attendance.present.includes(g1.player.id));
    assert.deepEqual(s.queue, []); // day not started yet
    await req('POST', '/api/matches', { teams: [{ players: [ze.id] }, { players: [tico] }] });
    const g2 = await req('POST', '/api/players', { name: 'Convidado Dois', present: true });
    assert.deepEqual(g2.queued, [g2.player.id]);
  } finally { await stop(); }
});

test('a player can switch between goalkeeper and line on their own', async () => {
  const { anon, login, stop } = await startServer();
  try {
    const reg = await anon('POST', '/api/auth/register', { name: 'Goleiro Zé', phone: '61944440000', password: 'abcdef', position: 'GOL' });
    assert.equal(reg.ok, true, reg.error);
    const me = await login('61944440000', 'abcdef');
    const toLine = await me('POST', '/api/auth/goalkeeper', { goalkeeper: false });
    assert.equal(toLine.player.position, '');
    const back = await me('POST', '/api/auth/goalkeeper', { goalkeeper: true });
    assert.equal(back.player.position, 'GOL');
    assert.equal((await me('POST', '/api/auth/goalkeeper', { goalkeeper: true })).already, true);
    // Other player fields stay with the organizer.
    assert.equal((await me('PUT', `/api/players/${reg.user.playerId}`, { name: 'X' })).status, 403);
  } finally { await stop(); }
});

test('stars start at 3 and only an admin changes them', async () => {
  const { req, anon, login, stop } = await startServer();
  try {
    await anon('POST', '/api/auth/register', { name: 'Orga', phone: '61955550000', password: 'abcdef', newPlayer: false });
    const users = (await req('GET', '/api/users')).users;
    await req('PUT', `/api/users/${users.find((u) => u.name === 'Orga').id}`, { role: 'organizador' });
    const org = await login('61955550000', 'abcdef');
    const p = (await org('POST', '/api/players', { name: 'Craque', rating: 5 })).player;
    assert.equal(p.rating, 3);
    assert.equal((await org('PUT', `/api/players/${p.id}`, { name: 'Craque', rating: 1 })).player.rating, 3);
    assert.equal((await req('PUT', `/api/players/${p.id}`, { name: 'Craque', rating: 5 })).player.rating, 5);
    // An organizer editing the name keeps the admin's rating.
    assert.equal((await org('PUT', `/api/players/${p.id}`, { name: 'Craque Novo' })).player.rating, 5);
  } finally { await stop(); }
});

test('admin grants admin to others; the owner account is protected', async () => {
  const { req, anon, login, stop } = await startServer();
  try {
    await anon('POST', '/api/auth/register', { name: 'Vice', phone: '61966660000', password: 'abcdef', newPlayer: false });
    let users = (await req('GET', '/api/users')).users;
    const owner = users.find((u) => u.owner);
    const vice = users.find((u) => u.name === 'Vice');
    assert.ok(owner && owner.role === 'admin');
    assert.equal((await req('PUT', `/api/users/${vice.id}`, { role: 'admin' })).user.role, 'admin');
    const asVice = await login('61966660000', 'abcdef');
    assert.equal((await asVice('GET', '/api/users')).ok, true); // admin powers
    assert.equal((await asVice('PUT', '/api/users/' + owner.id, { role: 'jogador' })).status, 403);
    assert.equal((await asVice('PUT', '/api/users/' + owner.id, { active: false })).status, 403);
    assert.equal((await asVice('POST', `/api/users/${owner.id}/password`, { password: 'trocada1' })).status, 403);
    // The owner can remove the admin role again.
    assert.equal((await req('PUT', `/api/users/${vice.id}`, { role: 'organizador' })).user.role, 'organizador');
    users = (await req('GET', '/api/users')).users;
    assert.equal(users.filter((u) => u.role === 'admin').length, 1);
  } finally { await stop(); }
});

test('presence is kept per day for the attendance chart', async () => {
  const { req, stop } = await startServer();
  try {
    const a = (await req('POST', '/api/players', { name: 'Dia1' })).player.id;
    const b = (await req('POST', '/api/players', { name: 'Dia2' })).player.id;
    await req('POST', '/api/attendance', { playerIds: [a, b], present: true, date: '2026-10-21' });
    await req('POST', '/api/day/reset', { date: '2026-10-28' });
    await req('POST', '/api/attendance', { playerIds: [a], present: true, date: '2026-10-28' });
    const s = await req('GET', '/api/state');
    assert.deepEqual(s.presenceLog['2026-10-21'].sort(), [a, b].sort());
    assert.deepEqual(s.presenceLog['2026-10-28'], [a]);
    await req('POST', '/api/attendance', { playerIds: [a], present: false });
    assert.equal((await req('GET', '/api/state')).presenceLog['2026-10-28'], undefined);
  } finally { await stop(); }
});
