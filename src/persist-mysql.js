'use strict';
// MySQL / MariaDB backend (Hostinger). Tables are readable in phpMyAdmin:
//   players, matches, match_events  -> one row per record
//   app_state                       -> settings, queue, waiting teams, etc. (JSON)
//
// The server keeps the authoritative state in memory (see store.js). On each
// save only rows that changed since the last successful save are written,
// inside one MySQL transaction.
const mysql = require('mysql2/promise');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (
    id CHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(60) NOT NULL,
    nickname VARCHAR(30) NOT NULL DEFAULT '',
    position VARCHAR(5) NOT NULL DEFAULT '',
    rating TINYINT NOT NULL DEFAULT 3,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS matches (
    id CHAR(36) NOT NULL PRIMARY KEY,
    number INT NOT NULL,
    status VARCHAR(10) NOT NULL,
    team_a_name VARCHAR(30) NOT NULL,
    team_b_name VARCHAR(30) NOT NULL,
    score_a INT NOT NULL DEFAULT 0,
    score_b INT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    finished_at BIGINT NULL,
    data LONGTEXT NOT NULL,
    INDEX idx_matches_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS match_events (
    id CHAR(36) NOT NULL PRIMARY KEY,
    match_id CHAR(36) NOT NULL,
    team CHAR(1) NOT NULL,
    scorer_id CHAR(36) NULL,
    assist_id CHAR(36) NULL,
    own_goal TINYINT(1) NOT NULL DEFAULT 0,
    minute INT NOT NULL,
    created_at BIGINT NOT NULL,
    device_id VARCHAR(64) NOT NULL DEFAULT '',
    device_name VARCHAR(40) NOT NULL DEFAULT '',
    removed_at BIGINT NULL,
    removed_by VARCHAR(40) NULL,
    INDEX idx_events_match (match_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(60) NOT NULL,
    phone VARCHAR(15) NOT NULL,
    role VARCHAR(12) NOT NULL,
    player_id CHAR(36) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL,
    password_hash VARCHAR(200) NOT NULL,
    UNIQUE KEY uq_users_phone (phone)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS app_state (
    k VARCHAR(40) NOT NULL PRIMARY KEY,
    v LONGTEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const STATE_KEYS = ['rev', 'settings', 'queue', 'teams', 'attendance', 'gkDuty', 'bench', 'rsvp', 'sessions', 'idem'];

const liveScore = (m, t) => m.events.filter((e) => e.team === t && !e.removedAt).length;

function playerRow(p) {
  return [p.id, p.name, p.nickname || '', p.position || '', p.rating, p.active ? 1 : 0, p.createdAt];
}
function userRow(u) {
  return [u.id, u.name, u.phone, u.role, u.playerId || null, u.active ? 1 : 0, u.createdAt, u.passwordHash];
}
function matchRow(m) {
  const { events, ...rest } = m;
  return [
    m.id, m.number, m.status, m.teamA.name, m.teamB.name,
    liveScore(m, 'A'), liveScore(m, 'B'), m.createdAt, m.finishedAt ?? null, JSON.stringify(rest),
  ];
}
function eventRow(m, e) {
  return [
    e.id, m.id, e.team, e.scorerId, e.assistId, e.ownGoal ? 1 : 0, e.minute, e.createdAt,
    e.deviceId || '', e.deviceName || '', e.removedAt ?? null, e.removedBy ?? null,
  ];
}

const TABLES = {
  players: {
    cols: ['id', 'name', 'nickname', 'position', 'rating', 'active', 'created_at'],
  },
  matches: {
    cols: ['id', 'number', 'status', 'team_a_name', 'team_b_name', 'score_a', 'score_b', 'created_at', 'finished_at', 'data'],
  },
  match_events: {
    cols: ['id', 'match_id', 'team', 'scorer_id', 'assist_id', 'own_goal', 'minute', 'created_at',
      'device_id', 'device_name', 'removed_at', 'removed_by'],
  },
  users: {
    cols: ['id', 'name', 'phone', 'role', 'player_id', 'active', 'created_at', 'password_hash'],
  },
  app_state: { cols: ['k', 'v'] },
};

function upsertSql(table) {
  const { cols } = TABLES[table];
  const updates = cols.slice(1).map((c) => `${c}=VALUES(${c})`).join(', ');
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE ${updates}`;
}

// Builds every row of the current state, keyed by table and primary key.
function snapshotRows(data) {
  const rows = { players: new Map(), matches: new Map(), match_events: new Map(), users: new Map(), app_state: new Map() };
  for (const p of data.players) rows.players.set(p.id, playerRow(p));
  for (const u of data.users || []) rows.users.set(u.id, userRow(u));
  for (const m of data.matches) {
    rows.matches.set(m.id, matchRow(m));
    for (const e of m.events) rows.match_events.set(e.id, eventRow(m, e));
  }
  for (const k of STATE_KEYS) {
    if (data[k] !== undefined) rows.app_state.set(k, [k, JSON.stringify(data[k])]);
  }
  return rows;
}

module.exports = function mysqlBackend(config) {
  const pool = mysql.createPool({
    host: config.host,
    port: config.port || 3306,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: 'utf8mb4',
    connectionLimit: 4,
    waitForConnections: true,
    enableKeepAlive: true,
  });
  // Last successfully written row (as JSON) for each table/key.
  const written = { players: new Map(), matches: new Map(), match_events: new Map(), users: new Map(), app_state: new Map() };

  return {
    name: `MySQL ${config.user}@${config.host}/${config.database}`,

    async load() {
      for (const ddl of SCHEMA) await pool.query(ddl);
      const [stateRows] = await pool.query('SELECT k, v FROM app_state');
      const [playerRows] = await pool.query('SELECT * FROM players ORDER BY created_at');
      const [matchRows] = await pool.query('SELECT data FROM matches ORDER BY created_at');
      const [eventRows] = await pool.query('SELECT * FROM match_events ORDER BY created_at, id');
      const [userRows] = await pool.query('SELECT * FROM users ORDER BY created_at');
      if (!stateRows.length && !playerRows.length && !matchRows.length && !userRows.length) return null;

      const data = {};
      for (const r of stateRows) data[r.k] = JSON.parse(r.v);
      data.players = playerRows.map((r) => ({
        id: r.id,
        name: r.name,
        nickname: r.nickname,
        position: r.position,
        rating: Number(r.rating),
        active: Boolean(r.active),
        createdAt: Number(r.created_at),
      }));
      data.users = userRows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        role: r.role,
        playerId: r.player_id,
        active: Boolean(r.active),
        createdAt: Number(r.created_at),
        passwordHash: r.password_hash,
      }));
      const byId = new Map();
      data.matches = matchRows.map((r) => {
        const m = { ...JSON.parse(r.data), events: [] };
        byId.set(m.id, m);
        return m;
      });
      for (const r of eventRows) {
        const m = byId.get(r.match_id);
        if (!m) continue;
        m.events.push({
          id: r.id,
          team: r.team,
          scorerId: r.scorer_id,
          assistId: r.assist_id,
          ownGoal: Boolean(r.own_goal),
          minute: Number(r.minute),
          createdAt: Number(r.created_at),
          deviceId: r.device_id,
          deviceName: r.device_name,
          ...(r.removed_at != null ? { removedAt: Number(r.removed_at), removedBy: r.removed_by } : {}),
        });
      }
      // What we just read is what the database holds.
      const rows = snapshotRows(data);
      for (const t of Object.keys(rows)) for (const [k, v] of rows[t]) written[t].set(k, JSON.stringify(v));
      return data;
    },

    async save(data) {
      const rows = snapshotRows(data);
      const changes = [];
      for (const table of Object.keys(rows)) {
        for (const [key, row] of rows[table]) {
          const json = JSON.stringify(row);
          if (written[table].get(key) !== json) changes.push({ table, key, row, json });
        }
        for (const key of written[table].keys()) {
          if (!rows[table].has(key)) changes.push({ table, key, del: true });
        }
      }
      if (!changes.length) return;

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const c of changes) {
          if (c.del) {
            await conn.query(`DELETE FROM ${c.table} WHERE ${TABLES[c.table].cols[0]} = ?`, [c.key]);
          } else {
            await conn.query(upsertSql(c.table), c.row);
          }
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
      } finally {
        conn.release();
      }
      for (const c of changes) {
        if (c.del) written[c.table].delete(c.key);
        else written[c.table].set(c.key, c.json);
      }
    },

    async close() {
      await pool.end();
    },
  };
};
