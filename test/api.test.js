'use strict';
// Integration tests: spawn the server on a temp data dir and hit the API.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers');

let srv;
const req = (...args) => srv.req(...args);

test.before(async () => { srv = await startServer(); });
test.after(() => srv.stop());

const ids = {};

test('register players and block duplicate names', async () => {
  for (const name of ['Ana', 'Beto', 'Caio', 'Duda', 'Edu', 'Fabi']) {
    const r = await req('POST', '/api/players', { name, rating: 3 });
    assert.equal(r.ok, true);
    ids[name] = r.player.id;
  }
  const dup = await req('POST', '/api/players', { name: 'ana' });
  assert.equal(dup.status, 409);
});

test('only one open match at a time', async () => {
  const body = {
    teamA: { name: 'Laranja', players: [ids.Ana, ids.Beto] },
    teamB: { name: 'Azul', players: [ids.Caio, ids.Duda] },
    durationMin: 10,
  };
  const [a, b] = await Promise.all([req('POST', '/api/matches', body), req('POST', '/api/matches', body)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  ids.match = (a.ok ? a : b).match.id;
});

test('same idempotency key is applied only once', async () => {
  const h = { 'Idempotency-Key': 'retry-key-1' };
  const body = { team: 'A', scorerId: ids.Ana, assistId: ids.Beto, deviceName: 'Celular 1' };
  const r1 = await req('POST', `/api/matches/${ids.match}/events`, body, h);
  const r2 = await req('POST', `/api/matches/${ids.match}/events`, body, h);
  assert.equal(r1.ok, true);
  assert.equal(r2.replayed, true);
  const s = await req('GET', '/api/state');
  assert.equal(s.matches.find((m) => m.id === ids.match).events.length, 1);
});

test('two devices recording the same goal: second is flagged as duplicate', async () => {
  const body = (dev) => ({ team: 'B', scorerId: ids.Caio, deviceName: dev });
  const [a, b] = await Promise.all([
    req('POST', `/api/matches/${ids.match}/events`, body('Celular 1')),
    req('POST', `/api/matches/${ids.match}/events`, body('Celular 2')),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal((a.ok ? b : a).code, 'DUPLICATE_SUSPECT');

  const forced = await req('POST', `/api/matches/${ids.match}/events`, { ...body('Celular 2'), force: true });
  assert.equal(forced.ok, true);
});

test('timer start is idempotent and adjust needs current version', async () => {
  await Promise.all([
    req('POST', `/api/matches/${ids.match}/timer`, { action: 'start' }),
    req('POST', `/api/matches/${ids.match}/timer`, { action: 'start' }),
  ]);
  const s = await req('GET', '/api/state');
  const m = s.matches.find((x) => x.id === ids.match);
  assert.equal(m.status, 'running');

  const ok = await req('POST', `/api/matches/${ids.match}/timer`, { action: 'adjust', seconds: 60, baseVersion: m.version });
  const stale = await req('POST', `/api/matches/${ids.match}/timer`, { action: 'adjust', seconds: 60, baseVersion: m.version });
  assert.equal(ok.ok, true);
  assert.equal(stale.code, 'STALE');
});

test('winner stays: next waiting team enters, losers go to the queue', async () => {
  await req('PUT', '/api/settings', { teamSize: 3 }); // 2 line players + goalkeeper
  const q = await req('POST', '/api/queue', { playerIds: [ids.Edu, ids.Fabi] });
  assert.deepEqual(q.formed, ['Time A']); // 2 loose line players = team closed automatically

  // Score is A 1 x 2 B, so A (Laranja) leaves.
  const r = await req('POST', `/api/matches/${ids.match}/next`, {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.match.teamB.players, [ids.Caio, ids.Duda]);
  assert.deepEqual(r.match.teamA.players, [ids.Edu, ids.Fabi]);
  assert.equal(r.match.teamA.name, 'Time A');

  const again = await req('POST', `/api/matches/${ids.match}/next`, {});
  assert.equal(again.code, 'ALREADY_NEXT');

  // Losers (Ana, Beto) formed the next waiting team on their own.
  const s = await req('GET', '/api/state');
  assert.deepEqual(s.queue, []);
  assert.equal(s.teams.length, 1);
  assert.deepEqual(s.teams[0].players, [ids.Ana, ids.Beto]);
});

test('queue closes a team of 6 automatically with one goalkeeper', async () => {
  await req('PUT', '/api/settings', { teamSize: 6 });
  const s0 = await req('GET', '/api/state');
  // The waiting team (Ana, Beto) is completed first, so clear it.
  await req('DELETE', '/api/queue');
  const fresh = [];
  for (const [name, position] of [['L1', 'ATA'], ['L2', 'MEI'], ['L3', 'ZAG'], ['L4', 'ATA'], ['L5', 'MEI'], ['L6', 'LAT'], ['G1', 'GOL']]) {
    fresh.push((await req('POST', '/api/players', { name, position })).player.id);
  }
  assert.ok(s0.teams.length >= 1);
  const r = await req('POST', '/api/queue', { playerIds: fresh });
  assert.equal(r.formed.length, 1);
  const s = await req('GET', '/api/state');
  const team = s.teams[0];
  assert.equal(team.players.length, 6);
  // Goalkeeper (last in arrival order) pulled in; 6th line player stays loose.
  assert.ok(team.players.includes(fresh[6]));
  assert.deepEqual(s.queue, [fresh[5]]);
});

test('builder with 3 teams: 2 play, 1 waits, extras go to the queue', async () => {
  const s0 = await req('GET', '/api/state');
  const open = s0.matches.find((m) => m.status !== 'finished');
  await req('POST', `/api/matches/${open.id}/finish`);
  await req('DELETE', '/api/queue');
  const r = await req('POST', '/api/matches', {
    teams: [{ players: [ids.Ana] }, { players: [ids.Beto] }, { players: [ids.Caio, ids.Duda] }],
    extras: [ids.Edu],
  });
  assert.equal(r.ok, true);
  const s = await req('GET', '/api/state');
  assert.equal(s.teams[0].name, 'Time C');
  assert.deepEqual(s.teams[0].players.slice(0, 2), [ids.Caio, ids.Duda]);
});

test('team without fixed goalkeeper gets a loose player in goal, rotating', async () => {
  const s0 = await req('GET', '/api/state');
  const open = s0.matches.find((m) => m.status !== 'finished');
  await req('POST', `/api/matches/${open.id}/finish`);
  await req('DELETE', '/api/queue');
  await req('PUT', '/api/settings', { teamSize: 3 });
  const extra = [];
  for (const name of ['P1', 'P2', 'P3']) extra.push((await req('POST', '/api/players', { name, position: 'ATA' })).player.id);
  await req('POST', '/api/queue', { playerIds: [extra[0]] }); // 1 loose: not enough for a team

  const r = await req('POST', '/api/matches', {
    teams: [{ players: [ids.Ana, ids.Beto] }, { players: [ids.Caio, ids.Duda] }],
  });
  assert.equal(r.match.teamA.gk, extra[0]);
  assert.equal(r.match.teamA.gkGuest, true);
  assert.equal(r.match.teamB.gk, null); // nobody else waiting

  // The guest goalkeeper scores; he stays in the queue.
  const g = await req('POST', `/api/matches/${r.match.id}/events`, { team: 'A', scorerId: extra[0] });
  assert.equal(g.ok, true);
  const s1 = await req('GET', '/api/state');
  assert.deepEqual(s1.queue, [extra[0]]);

  // Manual change of goalkeeper.
  await req('POST', '/api/queue', { playerIds: [extra[1]] });
  const c = await req('POST', `/api/matches/${r.match.id}/gk`, { team: 'B', playerId: extra[1] });
  assert.equal(c.match.teamB.gk, extra[1]);
});

test('presence: mark/unmark is idempotent; late arrivals go to the queue', async () => {
  const s0 = await req('GET', '/api/state');
  const open = s0.matches.find((m) => m.status !== 'finished');
  if (open) await req('POST', `/api/matches/${open.id}/finish`);
  const reset = await req('POST', '/api/day/reset', { date: '2026-10-28' });
  assert.equal(reset.ok, true);

  const both = [ids.Ana, ids.Beto];
  await Promise.all([
    req('POST', '/api/attendance', { playerIds: both, present: true, date: '2026-10-28' }),
    req('POST', '/api/attendance', { playerIds: both, present: true, date: '2026-10-28' }),
  ]);
  let s = await req('GET', '/api/state');
  assert.deepEqual(s.attendance.present, both);
  assert.equal(s.attendance.date, '2026-10-28');
  assert.deepEqual(s.queue, []); // day not started yet: only marked present

  await req('POST', '/api/matches', { teams: [{ players: [ids.Ana] }, { players: [ids.Beto] }] });
  await req('POST', '/api/attendance', { playerIds: [ids.Caio], present: true });
  s = await req('GET', '/api/state');
  assert.deepEqual(s.queue, [ids.Caio]); // arrived late: straight to the queue

  await req('POST', '/api/attendance', { playerIds: [ids.Caio], present: false });
  s = await req('GET', '/api/state');
  assert.deepEqual(s.queue, []);
  assert.ok(!s.attendance.present.includes(ids.Caio));

  const blocked = await req('POST', '/api/day/reset', {});
  assert.equal(blocked.code, 'MATCH_IN_PROGRESS');
});
