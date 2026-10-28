'use strict';
// Match rules: tie rule, goal limit, undo with record, reopen.
const test = require('node:test');
const assert = require('node:assert');
const { startServer, addPlayers } = require('./helpers');

// 8 line players, teams of 2 line + guest goalkeeper -> 4 teams of 2.
async function setup(settings = {}) {
  const srv = await startServer();
  const { req } = srv;
  await req('PUT', '/api/settings', { teamSize: 3, ...settings });
  const ids = await addPlayers(req, ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
  await req('POST', '/api/queue', { playerIds: Object.values(ids) });
  return { ...srv, ids };
}
const openMatch = (s) => s.matches.find((m) => m.status !== 'finished');

test('tie with 2 teams waiting: both leave, next two play', async () => {
  const { req, stop, ids } = await setup();
  try {
    const start = await req('POST', '/api/matches/from-teams', {});
    assert.deepEqual(start.match.teamA.players, [ids.P1, ids.P2]);
    const r = await req('POST', `/api/matches/${start.match.id}/next`, {});
    assert.equal(r.ok, true, r.error);
    assert.equal(r.leaving, 'both');
    assert.deepEqual(r.match.teamA.players, [ids.P5, ids.P6]);
    assert.deepEqual(r.match.teamB.players, [ids.P7, ids.P8]);
    const s = await req('GET', '/api/state');
    // order inside each team is drawn; who forms which team follows the queue
    assert.deepEqual(s.teams.map((t) => [...t.players].sort()), [[ids.P1, ids.P2].sort(), [ids.P3, ids.P4].sort()]);
  } finally { await stop(); }
});

test('tie with 1 team waiting: the previous winner stays', async () => {
  const { req, stop, ids } = await setup();
  try {
    // Match 1: P1/P2 x P3/P4, team A wins -> A stays (holdover), C comes in.
    const m1 = (await req('POST', '/api/matches/from-teams', {})).match;
    await req('POST', `/api/matches/${m1.id}/events`, { team: 'A', scorerId: ids.P1 });
    const m2 = (await req('POST', `/api/matches/${m1.id}/next`, {})).match;
    assert.equal(m2.holdover, 'A');
    assert.deepEqual(m2.teamA.players, [ids.P1, ids.P2]);

    // Leave only one team waiting.
    let s = await req('GET', '/api/state');
    for (const t of s.teams.slice(1)) for (const id of t.players) await req('DELETE', `/api/queue/${id}`);
    s = await req('GET', '/api/state');
    assert.equal(s.teams.length, 1);

    // Tie: holdover (A = P1/P2) stays, B leaves.
    const r = await req('POST', `/api/matches/${m2.id}/next`, {});
    assert.equal(r.ok, true, r.error);
    assert.equal(r.leaving, 'B');
    assert.deepEqual(r.match.teamA.players, [ids.P1, ids.P2]);
  } finally { await stop(); }
});

test('tie in the first match with 1 team waiting needs a choice', async () => {
  const srv = await startServer();
  const { req, stop } = srv;
  try {
    await req('PUT', '/api/settings', { teamSize: 3 });
    const ids = await addPlayers(req, ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
    await req('POST', '/api/queue', { playerIds: Object.values(ids) });
    const m1 = (await req('POST', '/api/matches/from-teams', {})).match;
    const r = await req('POST', `/api/matches/${m1.id}/next`, {});
    assert.equal(r.code, 'NEED_CHOICE');
    const ok = await req('POST', `/api/matches/${m1.id}/next`, { leaving: 'A' });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.match.teamB.players, [ids.B1, ids.B2]);
  } finally { await stop(); }
});

test('tieRule "choose" always asks on a tie', async () => {
  const { req, stop } = await setup({ tieRule: 'choose' });
  try {
    const m1 = (await req('POST', '/api/matches/from-teams', {})).match;
    const r = await req('POST', `/api/matches/${m1.id}/next`, {});
    assert.equal(r.code, 'NEED_CHOICE');
  } finally { await stop(); }
});

test('goal limit ends the match; undoing that goal reopens it; record is kept', async () => {
  const { req, stop, ids } = await setup({ goalLimit: 2 });
  try {
    const m = (await req('POST', '/api/matches/from-teams', {})).match;
    await req('POST', `/api/matches/${m.id}/timer`, { action: 'start' });
    const g1 = await req('POST', `/api/matches/${m.id}/events`, { team: 'A', scorerId: ids.P1 });
    assert.equal(g1.autoFinished, false);
    const g2 = await req('POST', `/api/matches/${m.id}/events`, { team: 'A', scorerId: ids.P2 });
    assert.equal(g2.autoFinished, true);
    let s = await req('GET', '/api/state');
    let match = s.matches.find((x) => x.id === m.id);
    assert.equal(match.status, 'finished');
    assert.equal(match.endReason, 'goals');

    const u = await req('DELETE', `/api/matches/${m.id}/events/${g2.event.id}`, { by: 'Mesa' });
    assert.equal(u.reopened, true);
    s = await req('GET', '/api/state');
    match = s.matches.find((x) => x.id === m.id);
    assert.equal(match.status, 'paused');
    const removed = match.events.find((e) => e.id === g2.event.id);
    assert.equal(removed.removedBy, 'Administrador'); // the logged-in account
    assert.ok(removed.removedAt > 0);

    // Undo twice = no effect; removed goal no longer blocks a new one (dup check).
    const again = await req('DELETE', `/api/matches/${m.id}/events/${g2.event.id}`, { by: 'Outro' });
    assert.equal(again.already, true);
    const g3 = await req('POST', `/api/matches/${m.id}/events`, { team: 'A', scorerId: ids.P2 });
    assert.equal(g3.ok, true);
    assert.equal(g3.autoFinished, true);
  } finally { await stop(); }
});

test('manual finish can be reopened until the next match is created', async () => {
  const { req, stop } = await setup();
  try {
    const m = (await req('POST', '/api/matches/from-teams', {})).match;
    await req('POST', `/api/matches/${m.id}/finish`);
    const r = await req('POST', `/api/matches/${m.id}/reopen`);
    assert.equal(r.ok, true);
    let s = await req('GET', '/api/state');
    assert.equal(openMatch(s).id, m.id);

    await req('POST', `/api/matches/${m.id}/next`, { leaving: 'B' });
    const late = await req('POST', `/api/matches/${m.id}/reopen`);
    assert.equal(late.code, 'ALREADY_NEXT');
  } finally { await stop(); }
});

test('leaving players: first time a draw, then rotation (whoever was left out goes in)', async () => {
  const srv = await startServer();
  const { req, stop } = srv;
  try {
    await req('PUT', '/api/settings', { teamSize: 3 }); // 2 line players + goalkeeper
    const ids = await addPlayers(req, ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'X1', 'X2']);
    const open = async (teams, extras) => (await req('POST', '/api/matches', { teams, extras })).match;

    // Round 1: B loses; X1 waits loose, so one of B joins X1 (draw), the other is left out.
    let m = await open([{ players: [ids.A1, ids.A2] }, { players: [ids.B1, ids.B2] }, { players: [ids.C1, ids.C2] }], [ids.X1]);
    await req('POST', `/api/matches/${m.id}/events`, { team: 'A', scorerId: ids.A1 });
    await req('POST', `/api/matches/${m.id}/next`, {});
    let s = await req('GET', '/api/state');
    assert.equal(s.queue.length, 1);
    const leftOut = s.queue[0];
    assert.ok([ids.B1, ids.B2].includes(leftOut));
    const pickedFirst = leftOut === ids.B1 ? ids.B2 : ids.B1;

    // Round 2: the same two lose again (fresh setup). The one left out last
    // time now goes first and is picked; the other is left out.
    const cur = s.matches.find((x) => x.status !== 'finished');
    await req('POST', `/api/matches/${cur.id}/finish`);
    await req('DELETE', '/api/queue');
    m = await open([{ players: [ids.A1, ids.A2] }, { players: [pickedFirst, leftOut] }, { players: [ids.C1, ids.C2] }], [ids.X2]);
    await req('POST', `/api/matches/${m.id}/events`, { team: 'A', scorerId: ids.A1 });
    await req('POST', `/api/matches/${m.id}/next`, {});
    s = await req('GET', '/api/state');
    assert.deepEqual(s.queue, [pickedFirst]);
    assert.ok(s.teams.some((t) => t.players.includes(leftOut) && t.players.includes(ids.X2)));
  } finally { await stop(); }
});
