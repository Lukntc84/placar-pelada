'use strict';
// Daily automatic backup: one JSON file per day in BACKUP_DIR, refreshed every
// hour while data changes; only the newest BACKUP_KEEP days are kept.
const fs = require('fs');
const path = require('path');

const TZ = process.env.TZ_BACKUP || 'America/Sao_Paulo';
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 7);
const NAME_RE = /^pelada-\d{4}-\d{2}-\d{2}\.json$/; // daily files (rotated)
const ANY_RE = /^pelada-[a-z0-9-]+\.json$/; // daily + safety copies

function localDate(ts = Date.now()) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ts));
}

function snapshot(db) {
  const { idem, sessions, ...rest } = db;
  return rest;
}

module.exports = function createBackups(store) {
  const dir = path.resolve(process.env.BACKUP_DIR || path.join(store.DATA_DIR, 'backups'));

  function list() {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => ANY_RE.test(f))
      .sort()
      .reverse()
      .map((name) => ({ name, size: fs.statSync(path.join(dir, name)).size }));
  }

  function prune() {
    const daily = list().filter((b) => NAME_RE.test(b.name));
    for (const { name } of daily.slice(KEEP)) fs.unlinkSync(path.join(dir, name));
  }

  let lastRev = null;

  // Writes today's file when it is missing or the data changed since the last
  // run. force=true always writes.
  function run(force = false) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const name = `pelada-${localDate()}.json`;
      const file = path.join(dir, name);
      if (!force && fs.existsSync(file) && lastRev === store.get().rev) return null;
      lastRev = store.get().rev;
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(snapshot(store.get())));
      fs.renameSync(tmp, file);
      prune();
      return name;
    } catch (err) {
      console.error('[backup] falhou:', err.message);
      return null;
    }
  }

  function start() {
    run();
    setInterval(run, 60 * 60 * 1000).unref();
  }

  function filePath(name) {
    return ANY_RE.test(name) ? path.join(dir, name) : null;
  }

  // A one-off copy that the daily rotation never overwrites or deletes.
  function saveCopy(label) {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const name = `pelada-${label}-${stamp}.json`;
    fs.writeFileSync(path.join(dir, name), JSON.stringify(snapshot(store.get())));
    return name;
  }

  return { dir, list, run, start, filePath, snapshot, saveCopy };
};
