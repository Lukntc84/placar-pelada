'use strict';
// File backend (local development or hosts without MySQL).
const fs = require('fs');
const path = require('path');

module.exports = function jsonBackend(dataDir) {
  const file = path.join(dataDir, 'db.json');

  return {
    name: `arquivo ${file}`,

    async load() {
      fs.mkdirSync(dataDir, { recursive: true });
      if (!fs.existsSync(file)) return null;
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        const bad = `${file}.corrupt-${Date.now()}`;
        fs.copyFileSync(file, bad);
        console.error(`[store] db.json inválido, copiado para ${bad}. Iniciando vazio.`, err.message);
        return null;
      }
    },

    async save(data) {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file); // atomic replace: never leaves a half-written file
    },

    async close() {},
  };
};
