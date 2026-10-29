'use strict';
// In-memory state with transactional, serialized writes and pluggable
// persistence (MySQL when DB_HOST is set, otherwise a JSON file).
//
// Node runs JavaScript on a single thread, so every call to transaction()
// runs to completion before the next request is handled. That makes each
// mutation atomic: two devices can never interleave halfway through a write.
// If the handler throws, the in-memory state is rolled back to the snapshot.
// Saving happens right after, in the background, one save at a time.
const fs = require('fs');
const path = require('path');
const jsonBackend = require('./persist-json');
const mysqlBackend = require('./persist-mysql');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

function empty() {
  return {
    rev: 0,
    settings: { teamSize: 6, durationMin: 10, goalLimit: 0, tieRule: 'house', autoRating: false },
    players: [],
    queue: [], // loose players waiting, in arrival order
    teams: [], // complete/incomplete teams waiting to play, in order
    matches: [],
    attendance: { date: null, present: [] }, // players present today
    presenceLog: {}, // 'YYYY-MM-DD' -> players present that day (attendance chart)
    rsvp: { date: null, open: false, yes: [], no: [] }, // confirmation by link
    users: [], // accounts (phone + password hash + role)
    sessions: {}, // sha256(token) -> { userId, createdAt }
    bench: {}, // playerId -> times left out as loose player after losing (rotation)
    gkDuty: {}, // playerId -> times in goal while waiting (guest goalkeeper rotation)
    idem: {},
  };
}

function normalize(raw) {
  const base = empty();
  if (!raw) return base;
  return { ...base, ...raw, settings: { ...base.settings, ...raw.settings } };
}

const backend = process.env.DB_HOST
  ? mysqlBackend({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    })
  : jsonBackend(DATA_DIR);

let data = empty();
let saving = null; // promise of the save in progress
let dirty = false;
let saveTimer = null;
let failures = 0;
let lastError = null;

async function init() {
  let raw = await backend.load();
  if (!raw && process.env.DB_HOST) {
    // First run on MySQL: import the local JSON file if there is one.
    const file = path.join(DATA_DIR, 'db.json');
    if (fs.existsSync(file)) {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      console.log(`[store] importando ${file} para o MySQL`);
      data = normalize(raw);
      await backend.save(data);
      return;
    }
  }
  data = normalize(raw);
}

async function runSave() {
  dirty = false;
  try {
    await backend.save(data);
    failures = 0;
    lastError = null;
  } catch (err) {
    // State stays safe in memory; retry with backoff.
    failures++;
    lastError = err.message;
    dirty = true;
    console.error(`[store] falha ao salvar (${failures}x):`, err.message);
  }
}

function pump() {
  saveTimer = null;
  if (saving || !dirty) return;
  saving = runSave().finally(() => {
    saving = null;
    if (dirty) schedule(failures ? Math.min(30000, 500 * 2 ** failures) : 20);
  });
}

function schedule(delay = 20) {
  if (!saveTimer) saveTimer = setTimeout(pump, delay);
}

function transaction(fn) {
  const snapshot = structuredClone(data);
  try {
    const result = fn(data);
    data.rev++;
    dirty = true;
    schedule();
    return result;
  } catch (err) {
    data = snapshot;
    throw err;
  }
}

function replaceAll(next) {
  data = normalize({ ...next, rev: data.rev + 1, idem: {} });
  dirty = true;
  schedule();
}

// Waits until everything in memory is saved (used on shutdown and in tests).
async function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  for (let i = 0; i < 5 && (saving || dirty); i++) {
    if (saving) await saving;
    if (dirty) await runSave();
  }
}

async function close() {
  await flush();
  await backend.close();
}

module.exports = {
  get: () => data,
  init,
  transaction,
  replaceAll,
  flush,
  close,
  status: () => ({ backend: backend.name, pending: dirty || Boolean(saving), failures, lastError }),
  DATA_DIR,
};
