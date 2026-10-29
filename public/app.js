'use strict';

/* ================================================================ utils */

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () =>
  window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 3) | 8).toString(16);
      });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LS = {
  get(k, d = '') {
    try { return localStorage.getItem(k) ?? d; } catch { return d; }
  },
  set(k, v) {
    try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ }
  },
};

// "1 time", "2 times".
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function fmt(ms) {
  const t = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

// Line icons (inline SVG, inherit the text color).
const svg = (d, extra = '') => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
const ICON = {
  play: svg('<path d="M8 5l11 7-11 7z" fill="currentColor"/>'),
  pause: svg('<path d="M9 5v14M15 5v14"/>'),
  flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  more: svg('<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  screen: svg('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  sound: svg('<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M17 9a4 4 0 0 1 0 6"/>'),
  swap: svg('<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>'),
  reset: svg('<path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  share: svg('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/>'),
  up: svg('<path d="M6 15l6-6 6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};
// Goalkeeper marker (replaces the glove emoji).
const GK = '<span class="gk-tag" title="Goleiro">GOL</span>';

let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 3200);
}

/* ================================================================ state */

let S = null; // last state received from the server
let clockOffset = 0; // serverNow - Date.now()
let sseOpen = false;
let tab = LS.get('tab', 'match');
let busy = false;
let editingPlayerId = null;
let statsRange = LS.get('statsRange', 'today');
let alertedMatch = null;
let autoCache = null; // automatic ratings, recomputed on each new state

let ME = null; // logged-in account { id, name, phone, role, playerId }
let es = null; // live connection
const deviceId = LS.get('deviceId') || (() => { const id = uuid(); LS.set('deviceId', id); return id; })();

// assign: playerId -> team index (0..n-1) or EXTRA (loose queue)
const builder = { n: 2, mode: 'auto', assign: new Map(), names: [] };

const now = () => Date.now() + clockOffset;
const player = (id) => S.players.find((p) => p.id === id);
const pname = (id) => {
  if (!id) return 'Autor desconhecido';
  const p = player(id);
  return p ? p.nickname || p.name : '?';
};
const currentMatch = () => (S && S.matches ? S.matches.find((m) => m.status !== 'finished') : undefined);
const finishedMatches = () =>
  S.matches.filter((m) => m.status === 'finished').sort((a, b) => b.finishedAt - a.finishedAt);
// Undone goals stay in the record (removedAt/removedBy) but never count.
const live = (m) => m.events.filter((e) => !e.removedAt);
const score = (m, t) => live(m).filter((e) => e.team === t).length;
const otherSide = (t) => (t === 'A' ? 'B' : 'A');
const elapsed = (m) => m.elapsedMs + (m.status === 'running' ? now() - m.startedAt : 0);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const isPresent = (id) => S.attendance.present.includes(id);
const dayStartedClient = () => Boolean(currentMatch() || S.teams.length || S.queue.length);
const ROLE_LABEL = { admin: 'Administrador', organizador: 'Organizador', jogador: 'Jogador' };
const canEdit = () => Boolean(ME) && (ME.role === 'organizador' || ME.role === 'admin');
const isAdmin = () => Boolean(ME) && ME.role === 'admin';
const E = (html) => (canEdit() ? html : ''); // renders editing controls only for organizers

/* ============================================================ network */

// Each user action gets ONE Idempotency-Key. Network retries reuse it, so a
// request that reached the server but whose response got lost (bad signal at
// the field) is never applied twice.
async function api(method, url, body) {
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': uuid() };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      if ([502, 503, 504].includes(r.status) && attempt < 3) {
        await wait(700 * (attempt + 1));
        continue;
      }
      const data = await r.json().catch(() => ({ ok: false, error: 'Resposta inválida do servidor.' }));
      if (r.status === 401 && data.code === 'LOGIN_REQUIRED') showAuth('Sua sessão expirou. Entre de novo.');
      return { status: r.status, ...data };
    } catch {
      await wait(700 * (attempt + 1));
    }
  }
  return { status: 0, ok: false, code: 'NETWORK', error: 'Sem conexão. Tente novamente.' };
}

// Wraps a write: blocks double taps while the request is in flight and
// shows errors. Returns the response (or null if skipped).
async function act(method, url, body, { quiet = [] } = {}) {
  if (busy) return null;
  busy = true;
  document.body.classList.add('busy');
  try {
    const r = await api(method, url, body);
    if (r.code === 'LOGIN_REQUIRED') return r;
    if (!r.ok && !quiet.includes(r.code)) toast(r.error || 'Erro.', 'err');
    if (r.ok && !sseOpen) loadState();
    return r;
  } finally {
    busy = false;
    document.body.classList.remove('busy');
  }
}

function applyState(s) {
  if (!ME || !s || !Array.isArray(s.matches)) return; // ignore error payloads
  clockOffset = s.serverNow - Date.now();
  S = s;
  Object.assign(S.settings, pendingSettings);
  autoCache = null;
  applyPendingPresence();
  render();
}

async function loadState() {
  if (!ME) return;
  try {
    const r = await fetch('/api/state');
    if (r.status === 401) return showAuth();
    if (r.ok) applyState(await r.json());
  } catch { /* offline: keep last state */ }
}

function connect() {
  if (es) es.close();
  es = new EventSource('/api/stream');
  es.addEventListener('state', (e) => applyState(JSON.parse(e.data)));
  es.onopen = () => { sseOpen = true; renderConn(); };
  es.onerror = () => { sseOpen = false; renderConn(); }; // EventSource reconnects by itself
}
// Fallback polling while the live connection is down.
setInterval(() => { if (ME && !sseOpen) loadState(); }, 5000);

/* =============================================================== auth */

// Formats digits as (11) 98765-4321 while typing.
function maskPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function showAuth(message = '') {
  ME = null;
  if (es) { es.close(); es = null; }
  sseOpen = false;
  S = null;
  $('#auth').hidden = false;
  $('#authError').textContent = message;
  document.body.classList.add('logged-out');
}

function setAuthMode(mode) {
  document.querySelectorAll('[data-auth]').forEach((b) => b.classList.toggle('on', b.dataset.auth === mode));
  $('#loginForm').hidden = mode !== 'login';
  $('#registerForm').hidden = mode !== 'register';
  $('#authError').textContent = '';
  const first = (mode === 'login' ? $('#loginForm') : $('#registerForm')).querySelector('input');
  if (first) first.focus();
}

async function submitAuth(url, body, button) {
  $('#authError').textContent = '';
  button.disabled = true;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!data.ok) { $('#authError').textContent = data.error || 'Não foi possível entrar.'; return null; }
    return data.user;
  } catch {
    $('#authError').textContent = 'Sem conexão. Tente de novo.';
    return null;
  } finally {
    button.disabled = false;
  }
}

function startApp(user) {
  ME = user;
  LS.set('pin', null); // old PIN mode
  $('#auth').hidden = true;
  document.body.classList.remove('logged-out');
  document.body.dataset.role = ME.role;
  if (location.hash === '#confirmar') { tab = 'match'; history.replaceState(null, '', '/'); }
  renderTabs();
  connect();
  loadState();
}

async function refreshMe() {
  if (!ME) return;
  const r = await fetch('/api/auth/me').catch(() => null);
  if (!r) return;
  if (r.status === 401) return showAuth('Sua sessão terminou. Entre de novo.');
  const data = await r.json();
  if (data.ok) {
    const roleChanged = data.user.role !== ME.role;
    ME = data.user;
    document.body.dataset.role = ME.role;
    if (S) render();
    if (roleChanged) toast(`Seu acesso agora é: ${ROLE_LABEL[ME.role]}.`, 'ok');
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshMe(); });
setInterval(refreshMe, 60000);

document.querySelectorAll('[data-auth]').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.auth)));
document.querySelectorAll('#auth input[type=tel]').forEach((i) => i.addEventListener('input', () => { i.value = maskPhone(i.value); }));
document.querySelectorAll('[data-showpwd]').forEach((b) => b.addEventListener('click', () => {
  const input = b.parentElement.querySelector('input');
  input.type = input.type === 'password' ? 'text' : 'password';
  b.textContent = input.type === 'password' ? 'mostrar' : 'esconder';
}));

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (!f.phone.value || !f.password.value) { $('#authError').textContent = 'Preencha celular e senha.'; return; }
  const user = await submitAuth('/api/auth/login', { phone: f.phone.value, password: f.password.value }, f.querySelector('[type=submit]'));
  if (user) { f.password.value = ''; startApp(user); toast(`Olá, ${user.name}!`, 'ok'); }
});

$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (!f.name.value.trim()) { $('#authError').textContent = 'Informe seu nome.'; return; }
  if (f.phone.value.replace(/\D/g, '').length < 10) { $('#authError').textContent = 'Celular inválido. Use DDD + número.'; return; }
  if (f.password.value.length < 6) { $('#authError').textContent = 'A senha precisa ter pelo menos 6 caracteres.'; return; }
  const user = await submitAuth('/api/auth/register', {
    name: f.name.value, phone: f.phone.value, password: f.password.value, position: f.position.value, newPlayer: true,
  }, f.querySelector('[type=submit]'));
  if (user) {
    f.reset();
    startApp(user);
    toast(`Bem-vindo, ${user.name.split(' ')[0]}! Seu jogador já está cadastrado.`, 'ok');
  }
});

// "Quem é você na pelada?": links the account to a player (or creates one).
async function linkMeModal() {
  const r = await fetch('/api/auth/linkable').then((x) => x.json()).catch(() => ({}));
  const list = r.players || [];
  openModal(`
    <h3>Quem é você na pelada?</h3>
    <p class="muted">Escolha seu nome para confirmar presença e ver suas estatísticas.</p>
    <input id="linkSearch" type="search" placeholder="Buscar nome…" autocomplete="off">
    <div class="pick link-pick">${list.map((p) => `<button data-act="linkPick" data-player="${p.id}" data-name="${esc(`${p.name} ${p.nickname}`).toLowerCase()}">${p.position === 'GOL' ? GK : ''}${esc(p.name)}</button>`).join('') || '<p class="muted">Nenhum nome disponível.</p>'}</div>
    <details class="new-player"><summary>Não estou na lista</summary>
      <p class="muted">Cria seu jogador com o nome da conta (${esc(ME.name)}).</p>
      <div class="rsvp-open">
        <select id="linkPos">
          <option value="">Posição…</option><option value="GOL">Goleiro</option><option value="ZAG">Zagueiro</option>
          <option value="LAT">Lateral</option><option value="MEI">Meio-campo</option><option value="ATA">Atacante</option>
        </select>
        <button class="primary small" data-act="linkNew">Criar meu jogador</button>
      </div>
    </details>
    <button class="ghost wide" data-act="closeModal">Agora não</button>`);
  $('#linkSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.link-pick button').forEach((b) => { b.hidden = q && !b.dataset.name.includes(q); });
  });
}

async function linkMe(body) {
  const r = await act('POST', '/api/auth/link', body);
  if (r?.ok) {
    ME = r.user;
    closeModal();
    toast(r.created ? 'Jogador criado e ligado à sua conta!' : `Pronto, você é ${pname(ME.playerId) || 'você'}!`, 'ok');
    render();
  }
}

function passwordModal() {
  openModal(`
    <h3>Trocar senha</h3>
    <form id="pwdForm" class="stack">
      <label>Senha atual<input name="current" type="password" autocomplete="current-password" required></label>
      <label>Nova senha <small>(mínimo 6 caracteres)</small><input name="next" type="password" autocomplete="new-password" minlength="6" required></label>
      <button type="submit" class="primary">Salvar nova senha</button>
    </form>
    <p class="muted">Os outros aparelhos conectados na sua conta vão precisar entrar de novo.</p>
    <button class="ghost wide" data-act="closeModal">Cancelar</button>`);
  $('#pwdForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.next.value.length < 6) return toast('A nova senha precisa ter pelo menos 6 caracteres.', 'err');
    const r = await act('POST', '/api/auth/password', { current: f.current.value, next: f.next.value });
    if (r?.ok) { closeModal(); toast('Senha alterada.', 'ok'); }
  });
}

/* ---------------------------------------------------- contas (admin) */

let USERS = [];

async function loadUsers() {
  if (!isAdmin()) return;
  const r = await fetch('/api/users').then((x) => x.json()).catch(() => ({}));
  if (!r.ok) { $('#setUsers').innerHTML = '<p class="muted">Não foi possível carregar as contas.</p>'; return; }
  USERS = r.users;
  renderUsers();
}

function renderUsers() {
  if (!isAdmin() || !S) return;
  const linked = new Set(USERS.filter((u) => u.playerId && u.active).map((u) => u.playerId));
  const players = S.players.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  $('#setUsers').innerHTML = USERS.length ? `<ul class="users">${USERS.map((u) => {
    const isOwner = u.role === 'admin';
    const playerOpts = `<option value="">— sem jogador —</option>` + players
      .filter((p) => p.id === u.playerId || !linked.has(p.id))
      .map((p) => `<option value="${p.id}" ${p.id === u.playerId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    return `<li class="${u.active ? '' : 'inactive'}">
      <div class="u-head"><b>${esc(u.name)}</b> <small class="muted">${esc(u.phone)}</small>
        ${u.active ? '' : '<span class="tag">desativada</span>'}</div>
      <div class="u-controls">
        ${isOwner ? '<span class="tag owner">Administrador</span>' : `<select data-user-role="${u.id}" aria-label="Papel de ${esc(u.name)}">
          <option value="jogador" ${u.role === 'jogador' ? 'selected' : ''}>Jogador</option>
          <option value="organizador" ${u.role === 'organizador' ? 'selected' : ''}>Organizador</option>
        </select>`}
        <select data-user-player="${u.id}" aria-label="Jogador de ${esc(u.name)}">${playerOpts}</select>
      </div>
      <div class="row-btns">
        <button class="ghost small" data-act="userPwd" data-id="${u.id}">Criar nova senha</button>
        ${isOwner ? '' : `<button class="ghost small ${u.active ? 'danger-text' : ''}" data-act="userActive" data-id="${u.id}" data-v="${u.active ? '0' : '1'}">${u.active ? 'Desativar' : 'Reativar'}</button>`}
      </div>
    </li>`;
  }).join('')}</ul>` : '<p class="muted">Nenhuma conta ainda.</p>';
}

document.addEventListener('change', async (e) => {
  const roleSel = e.target.closest('[data-user-role]');
  const playerSel = e.target.closest('[data-user-player]');
  if (!roleSel && !playerSel) return;
  const id = (roleSel || playerSel).dataset[roleSel ? 'userRole' : 'userPlayer'];
  const body = roleSel ? { role: roleSel.value } : { playerId: playerSel.value || null };
  const r = await act('PUT', `/api/users/${id}`, body);
  if (r?.ok) toast('Conta atualizada.', 'ok');
  loadUsers();
});

/* ============================================================== modal */

// A sheet can pass a renderer so it stays in sync with live updates.
let modalRenderer = null;
function openModal(html, renderer = null) {
  modalRenderer = renderer;
  $('#modalBody').innerHTML = renderer ? renderer() : html;
  $('#modal').hidden = false;
}
function closeModal() {
  modalRenderer = null;
  $('#modal').hidden = true;
  $('#modalBody').innerHTML = '';
  if (askResolve) { const r = askResolve; askResolve = null; r(null); }
}

// Confirmation sheet (replaces the browser's confirm/prompt, which look
// foreign, are easy to dismiss by accident and are blocked in some apps).
// Resolves true (or the typed text when `input` is set), or null if cancelled.
// A live sheet that was open before comes back afterwards.
let askResolve = null;
function ask({ title, text = '', ok = 'Confirmar', danger = false, input = null }) {
  const back = modalRenderer;
  return new Promise((resolve) => {
    openModal(`
      <h3>${title}</h3>
      ${text ? `<p class="ask-text">${text}</p>` : ''}
      <form id="askForm" class="ask-form" autocomplete="off">
        ${input ? `<input id="askInput" type="${input.type || 'text'}" placeholder="${esc(input.placeholder || '')}" aria-label="${esc(input.label || title)}"${input.value ? ` value="${esc(input.value)}"` : ''}>` : ''}
        <button type="submit" class="${danger ? 'danger' : 'primary'} big">${ok}</button>
        <button type="button" class="ghost" data-act="closeModal">Cancelar</button>
      </form>`);
    askResolve = (v) => {
      resolve(v);
      if (back && $('#modal').hidden) openModal('', back);
    };
    const form = $('#askForm');
    const field = $('#askInput');
    if (field) field.focus();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const r = askResolve;
      askResolve = null;
      const value = field ? field.value : true;
      closeModal();
      if (r) r(value);
    });
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#modal').hidden) closeModal();
  else if (!$('#bigboard').hidden) $('#bigboard').click();
});
$('#bigboard').addEventListener('click', () => {
  $('#bigboard').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) $('#bigboard').hidden = true;
});
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

/* ============================================================= render */

function render() {
  if (!S) return;
  renderHeader();
  renderTabs();
  renderMatch();
  renderPresence();
  renderBuilder();
  renderQueue();
  renderPlayers();
  renderSettings();
  renderStats();
  if (modalRenderer && !$('#modal').hidden) $('#modalBody').innerHTML = modalRenderer();
  watchMatchEnd();
  syncWakeLock();
  tick();
}

function renderConn() {
  const el = $('#conn');
  el.className = `conn ${sseOpen ? 'on' : 'off'}`;
  el.textContent = sseOpen ? 'Ao vivo' : 'Reconectando';
  el.title = sseOpen ? 'Sincronizado com todos os aparelhos' : 'Sem conexão: tentando de novo';
}

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// Compact score in the header once the scoreboard scrolls out of view, so
// the score and clock stay visible while tapping scorers lower on the page.
function renderMini() {
  const m = currentMatch();
  const digits = tab === 'match' && m && $('#view-match .score');
  const show = Boolean(digits) && digits.getBoundingClientRect().bottom <= $('.top').getBoundingClientRect().bottom;
  const top = $('.top');
  const mini = $('#miniScore');
  if (!show) {
    if (!mini.hidden) { mini.hidden = true; mini.innerHTML = ''; $('#miniPlay').innerHTML = ''; top.classList.remove('has-mini'); }
    return;
  }
  const key = `${m.id}|${score(m, 'A')}|${score(m, 'B')}|${m.status}|${m.teamA.color}|${m.teamB.color}|${canEdit()}`;
  if (mini.hidden || mini.dataset.key !== key) {
    mini.dataset.key = key;
    mini.innerHTML = `<span class="team-bar" style="--c:${m.teamA.color}"></span><b>${score(m, 'A')}–${score(m, 'B')}</b><span class="team-bar" style="--c:${m.teamB.color}"></span><span id="miniClock" class="mini-clock"></span>`;
    $('#miniPlay').innerHTML = canEdit()
      ? (m.status === 'running'
        ? `<button class="mini-play dark" data-act="timer" data-a="pause" aria-label="Pausar">${ICON.pause}</button>`
        : `<button class="mini-play primary" data-act="timer" data-a="start" aria-label="${m.status === 'pending' ? 'Começar' : 'Continuar'}">${ICON.play}</button>`)
      : '';
    mini.hidden = false;
    top.classList.add('has-mini');
  }
  const ms = elapsed(m);
  const el = $('#miniClock');
  el.textContent = fmt(ms);
  el.classList.toggle('over', ms >= m.durationMin * 60000);
}
window.addEventListener('scroll', () => { if (S) renderMini(); }, { passive: true });

function renderHeader() {
  $('#btnMe').textContent = ME ? initials(ME.name) : '';
  const banner = $('#banner');
  banner.hidden = canEdit();
  banner.textContent = 'Você está como Jogador: acompanha o jogo ao vivo e confirma sua presença.';
  renderConn();
}

const TABS_BY_ROLE = {
  jogador: ['match', 'queue', 'stats', 'settings'],
  organizador: ['match', 'teams', 'queue', 'players', 'stats', 'settings'],
  admin: ['match', 'teams', 'queue', 'players', 'stats', 'settings'],
};

function renderTabs() {
  const allowed = TABS_BY_ROLE[ME ? ME.role : 'jogador'];
  if (!allowed.includes(tab)) tab = 'match';
  const navButtons = [...document.querySelectorAll('.tabs button')];
  navButtons.forEach((b) => { b.hidden = !allowed.includes(b.dataset.tab); });
  document.querySelector('.tabs').style.gridTemplateColumns = `repeat(${navButtons.filter((b) => !b.hidden).length}, minmax(0, 1fr))`;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
}

/* ----------------------------------------------------------- partida */

function matchPlayerStats(m, id) {
  let g = 0, a = 0;
  for (const e of live(m)) {
    if (e.scorerId === id && !e.ownGoal) g++;
    if (e.assistId === id) a++;
  }
  return { g, a };
}

function goalCounts(st) {
  if (!st.g && !st.a) return '';
  return `<span class="counts">${st.g ? `<span class="count" title="gols">${st.g}</span>` : ''}${st.a ? `<span class="count alt" title="assistências">${st.a} ass.</span>` : ''}</span>`;
}

function teamCol(m, t) {
  const team = m[`team${t}`];
  const rows = team.players.map((id) => {
    const inner = `<span class="pname">${team.gk === id ? GK : ''}${esc(pname(id))}</span>${goalCounts(matchPlayerStats(m, id))}`;
    return canEdit()
      ? `<button class="pbtn" data-act="goal" data-team="${t}" data-player="${id}">${inner}</button>`
      : `<div class="pbtn static">${inner}</div>`;
  });
  const gk = team.gk;
  const gkRow = gk && !team.players.includes(gk)
    ? (() => {
        const inner = `<span class="pname">${GK}${esc(pname(gk))} <small class="muted">de próximo</small></span>${goalCounts(matchPlayerStats(m, gk))}`;
        return canEdit()
          ? `<button class="pbtn gk" data-act="goal" data-team="${t}" data-player="${gk}">${inner}</button>`
          : `<div class="pbtn gk static">${inner}</div>`;
      })()
    : '';
  return `<div class="team-col">
    <div class="team-col-head"><span class="team-bar" style="--c:${team.color}"></span>${esc(team.name)}
      ${E(`<button class="ghost small gk-change" data-act="gkPick" data-team="${t}">${gk ? 'Goleiro' : 'Escolher goleiro'}</button>`)}</div>
    ${gkRow}
    ${rows.join('')}
    ${E(`<button class="link-btn" data-act="goalOther" data-team="${t}">Gol contra ou sem autor</button>`)}
  </div>`;
}

function eventsList(m) {
  const goals = live(m);
  const removed = m.events.filter((e) => e.removedAt);
  const items = [...goals].reverse().map((e) => {
    const team = m[`team${e.team}`];
    return `<li style="--c:${team.color}">
      <span class="min">${e.minute}'</span>
      <span class="ev-main"><b>${esc(pname(e.scorerId))}</b>${e.ownGoal ? ' <em>(contra)</em>' : ''}
        ${e.assistId ? `<small>passe de ${esc(pname(e.assistId))}</small>` : ''}
        <small class="by">${esc(team.name)} · registrado por ${esc(e.deviceName)}</small></span>
      ${E(`<button class="link-btn" data-act="undo" data-ev="${e.id}" data-match="${m.id}">Desfazer</button>`)}
    </li>`;
  });
  const hhmm = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${items.length ? `<ul class="events">${items.join('')}</ul>` : ''}
    ${removed.length ? `<details class="removed"><summary>Gols desfeitos (${removed.length})</summary>
      <ul class="events">${removed.map((e) => `<li class="gone" style="--c:${m[`team${e.team}`].color}">
        <span class="min">${e.minute}'</span>
        <span class="ev-main"><s>${esc(pname(e.scorerId))}</s>
          <small class="by">registrado por ${esc(e.deviceName)} · desfeito por ${esc(e.removedBy)} às ${hhmm(e.removedAt)}</small></span>
      </li>`).join('')}</ul></details>` : ''}`;
}

// Only the latest goal is shown; the full list folds away.
function eventsBlock(m) {
  const goals = live(m);
  const removedCount = m.events.length - goals.length;
  if (!goals.length && !removedCount) {
    return `<p class="hint">Nenhum gol ainda.${canEdit() ? ' Toque em quem marcou.' : ''}</p>`;
  }
  const last = goals[goals.length - 1];
  const lastRow = last ? `<div class="last-goal">
      <span class="lg-text"><span class="min">${last.minute}'</span><span>Gol de <b>${esc(pname(last.scorerId))}</b>${last.ownGoal ? ' (contra)' : ''}${last.assistId ? ` · passe de ${esc(pname(last.assistId))}` : ''}</span></span>
      ${E(`<button class="link-btn" data-act="undo" data-ev="${last.id}" data-match="${m.id}">Desfazer</button>`)}
    </div>` : '';
  return `${lastRow}
    <details class="all-events"><summary>Todos os lances (${goals.length}${removedCount ? ` + ${removedCount} desfeito${removedCount > 1 ? 's' : ''}` : ''})</summary>${eventsList(m)}</details>`;
}

// Substitutions and goalkeepers (opened from the match "more" menu): tap who
// leaves, then who comes in. "+ Pôr" adds someone without taking anyone out.
let subSel = null; // { team: 'A'|'B', player: id|null }

function subsSheet() {
  const m = currentMatch();
  if (!m) return '<h3>Nenhuma partida em andamento.</h3><button class="ghost wide" data-act="closeModal">Fechar</button>';
  if (subSel && subSel.player && !m[`team${subSel.team}`].players.includes(subSel.player)) subSel = null;
  const used = new Set([...m.teamA.players, ...m.teamB.players]);
  const waitOrder = [...S.queue, ...S.teams.flatMap((t) => t.players)];
  const rank = (id) => { const i = waitOrder.indexOf(id); return i === -1 ? Infinity : i; };
  const avail = S.players
    .filter((p) => p.active && !used.has(p.id) && (isPresent(p.id) || rank(p.id) !== Infinity))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, 'pt-BR'));
  let incoming = '';
  if (subSel) {
    const team = m[`team${subSel.team}`];
    const outName = subSel.player ? esc(pname(subSel.player)) : '';
    incoming = `<div class="subs-in">
      <h4>${subSel.player ? `Quem entra no lugar de ${outName}?` : `Quem entra no ${esc(team.name)}?`}</h4>
      <div class="subs-grid">${avail.map((p) => `<button data-act="subIn" data-player="${p.id}"><span>${isGk(p.id) ? GK : ''}${esc(p.nickname || p.name)}</span></button>`).join('') || '<p class="muted">Ninguém esperando.</p>'}</div>
      ${subSel.player ? `<button class="ghost wide danger-text" data-act="subOut">Só tirar ${outName}</button>` : ''}
    </div>`;
  }
  const side = (t) => {
    const team = m[`team${t}`];
    return `<div class="subs-team">
      <div class="subs-team-head"><span class="team-bar" style="--c:${team.color}"></span>${esc(team.name)}</div>
      <div class="subs-grid">
        ${team.players.map((id) => {
          const sel = subSel && subSel.team === t && subSel.player === id;
          return `<button class="${sel ? 'sel' : ''}" data-act="subPick" data-team="${t}" data-player="${id}" aria-pressed="${sel}"><span>${team.gk === id ? GK : ''}${esc(pname(id))}</span></button>`;
        }).join('')}
        <button class="add ${subSel && subSel.team === t && !subSel.player ? 'sel' : ''}" data-act="subPick" data-team="${t}" data-player="">+ Pôr</button>
      </div>
      ${subSel && subSel.team === t ? incoming : ''}
      <button class="ghost subs-gk" data-act="gkPick" data-team="${t}"><span>Goleiro</span><b>${team.gk ? esc(pname(team.gk)) : 'escolher'}</b></button>
    </div>`;
  };
  return `<h3>Substituições e goleiros</h3>
    <p class="muted">Toque em quem sai e depois em quem entra. Quem sai vai para o fim da fila.</p>
    ${side('A')}${side('B')}
    <button class="ghost wide" data-act="closeModal">Fechar</button>`;
}

// Mirrors the server rule to explain what "Próxima partida" will do.
function nextPlan(m) {
  const sA = score(m, 'A'), sB = score(m, 'B');
  if (sA !== sB) return { leaving: sA > sB ? 'B' : 'A', tie: false };
  if (S.settings.tieRule === 'house') {
    if (S.teams.length >= 2) return { leaving: 'both', tie: true };
    if (m.holdover) return { leaving: otherSide(m.holdover), tie: true };
  }
  return { leaving: null, tie: true };
}

// Who plays the next match, mirroring the server: the first waiting team
// (completed from the loose queue, then from who left), or a team formed
// from the loose queue plus who left.
function enteringInfo(leavers) {
  const line = S.settings.teamSize - 1;
  const names = (ids) => ids.map((id) => esc(pname(id))).join(', ');
  const t = S.teams[0];
  const base = t ? t.players : [];
  const missing = Math.max(0, line - base.filter((id) => !isGk(id)).length);
  const fromQueue = S.queue.filter((id) => !isGk(id) && !base.includes(id)).slice(0, missing);
  const fromLeavers = missing - fromQueue.length;
  // A goalkeeper is pulled in too: the first one waiting, else the one who left.
  let gk = base.find(isGk) || S.queue.find(isGk);
  const gkLeaving = !gk && leavers.find(isGk);
  const extra = [
    fromLeavers ? `${fromLeavers} de quem saiu (revezamento)` : '',
    gkLeaving ? `${esc(pname(gkLeaving))} volta no gol (não há outro goleiro esperando)` : '',
  ].filter(Boolean).join(' e ');
  return {
    team: t ? esc(t.name) : '',
    list: names([...(gk && !base.includes(gk) ? [gk] : []), ...base, ...fromQueue]),
    extra: extra ? ` + ${extra}` : '',
  };
}

function goalLines(m, t) {
  return live(m).filter((e) => e.team === t)
    .map((e) => `${e.minute}' <b>${esc(pname(e.scorerId))}</b>${e.ownGoal ? ' (contra)' : ''}${e.assistId ? ` <small>(${esc(pname(e.assistId))})</small>` : ''}`)
    .join('<br>') || '—';
}

// Team chosen to leave on the result card; the call only happens on
// "Chamar próxima partida", so a mistaken tap never starts the next match.
let leaveSel = null; // { match: id, side: 'A'|'B' }

// End of a match: the result, who scored, and what happens next.
function nextPanel(m, readOnly = false) {
  const sA = score(m, 'A'), sB = score(m, 'B');
  const plan = nextPlan(m);
  const chosen = !readOnly && leaveSel && leaveSel.match === m.id ? leaveSel.side : null;
  const leaving = chosen || plan.leaving;
  const name = (t) => esc(m[`team${t}`].name);
  const tie = sA === sB;
  const team = (t, mine, theirs) => `<div class="r-team ${mine > theirs ? 'win' : !tie ? 'lose' : ''}">
      <span class="team-bar" style="--c:${m[`team${t}`].color}"></span>${name(t)}
      ${mine > theirs ? '<small class="r-tag">Venceu</small>' : ''}</div>`;

  let who;
  if (leaving === 'both') {
    const [t1, t2] = S.teams;
    who = `<p><b>Empate com 2 times esperando: saem os dois.</b></p>
      <p><b>Entram</b> ${esc(t1.name)} (${t1.players.map((id) => esc(pname(id))).join(', ')})
        × ${esc(t2.name)} (${t2.players.map((id) => esc(pname(id))).join(', ')})</p>`;
  } else if (leaving) {
    const e = enteringInfo(m[`team${leaving}`].players);
    const why = chosen ? '' : plan.tie ? ' <span class="muted">(empate: fica quem ganhou a anterior)</span>' : '';
    who = `<p><b>Sai</b> ${name(leaving)} · <b>fica</b> ${name(otherSide(leaving))}${why}</p>
      <p><b>Entram${e.team ? ` (${e.team})` : ''}:</b> ${e.list || '<span class="muted">quem saiu</span>'}${e.list ? e.extra : ''}</p>`;
  } else {
    who = readOnly ? '<p><b>Empate.</b> O organizador escolhe qual time sai.</p>' : '<p><b>Empate.</b> Escolha qual time sai:</p>';
  }

  const current = chosen || (plan.leaving !== 'both' ? plan.leaving : null);
  const pick = (t) => `<button class="${current === t ? 'on' : ''}" data-act="leavePick" data-match="${m.id}" data-side="${t}" aria-pressed="${current === t}">Sai ${name(t)}</button>`;
  const choice = readOnly ? '' : plan.leaving
    ? `<details class="r-override" ${chosen ? 'open' : ''}><summary>Trocar quem sai</summary>
        <div class="r-choice">${pick('A')}${pick('B')}</div>
        ${chosen ? `<button class="ghost small" data-act="leavePick" data-match="${m.id}" data-side="">Voltar para a regra</button>` : ''}
      </details>`
    : `<div class="r-choice">${pick('A')}${pick('B')}</div>`;

  return `<div class="card result next">
    <p class="r-label">${m.endReason === 'goals' ? `Fim de jogo: chegou a ${S.settings.goalLimit} gols` : `Fim da partida ${m.number}`}${tie ? ' · empate' : ''}</p>
    <div class="r-score">${team('A', sA, sB)}<span class="r-num">${sA}<span class="score-sep">–</span>${sB}</span>${team('B', sB, sA)}</div>
    <div class="r-goals"><div>${goalLines(m, 'A')}</div><div>${goalLines(m, 'B')}</div></div>
    <div class="r-next">${who}<small class="muted">Quem sai vai para o fim da fila de próximo.</small></div>
    ${plan.leaving ? '' : choice}
    ${readOnly ? `<div class="r-actions"><button class="small" data-act="shareResult" data-id="${m.id}">${ICON.share}Mandar no grupo</button></div>` : `<div class="r-actions">
      ${leaving ? '' : '<p class="r-hint">Escolha acima qual time sai para chamar a próxima.</p>'}
      <button class="primary big" data-act="next" ${chosen ? `data-leaving="${chosen}"` : ''} ${leaving ? '' : 'disabled'}>${ICON.play}Chamar próxima partida</button>
      ${plan.leaving ? choice : ''}
      <div class="r-more">
        <button class="small" data-act="shareResult" data-id="${m.id}">${ICON.share}Mandar no grupo</button>
        <button class="ghost small" data-act="reopen" data-id="${m.id}">Reabrir partida</button>
      </div>
    </div>`}
  </div>`;
}

function resultText(m) {
  const goals = (t) => live(m).filter((e) => e.team === t)
    .map((e) => `${pname(e.scorerId)}${e.ownGoal ? ' (contra)' : ''}${e.assistId ? ` (passe de ${pname(e.assistId)})` : ''}`);
  const lines = [`⚽ *Partida ${m.number}*`, `${m.teamA.name} ${score(m, 'A')} × ${score(m, 'B')} ${m.teamB.name}`];
  for (const t of ['A', 'B']) {
    const g = goals(t);
    if (g.length) lines.push('', `*${m[`team${t}`].name}:* ${g.join(', ')}`);
  }
  return lines.join('\n');
}

// Opens the share sheet, or copies the text, or shows it to copy by hand.
async function shareText(text, copiedMsg) {
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(copiedMsg, 'ok');
  } catch {
    openModal(`<h3>Copie o texto</h3><textarea class="summary" readonly>${esc(text)}</textarea>
      <button class="ghost wide" data-act="closeModal">Fechar</button>`);
  }
}

// "Você vai?" card for the logged-in player while the confirmation is open.
function rsvpSelfCard() {
  const r = S.rsvp;
  if (!r.open || !r.date) return '';
  const date = r.date.split('-').reverse().slice(0, 2).join('/');
  if (!ME.playerId) {
    return `<div class="card rsvp-self"><b>Pelada ${date}</b>
      <p class="muted">Diga quem você é na lista de jogadores para confirmar presença.</p>
      <button class="primary small" data-act="linkMe">Escolher meu nome</button></div>`;
  }
  const going = r.yes.includes(ME.playerId) ? 'yes' : r.no.includes(ME.playerId) ? 'no' : '';
  return `<div class="card rsvp-self">
    <b>Pelada ${date}: você vai?</b> <small class="muted">${plural(r.yes.length, 'confirmado', 'confirmados')}</small>
    <div class="big-choice">
      <button class="yes ${going === 'yes' ? 'on' : ''}" data-act="rsvpMe" data-going="1" aria-pressed="${going === 'yes'}">Vou</button>
      <button class="no ${going === 'no' ? 'on' : ''}" data-act="rsvpMe" data-going="0" aria-pressed="${going === 'no'}">Não vou</button>
    </div></div>`;
}

let lastScoreKey = '';

function renderMatch() {
  const box = $('#view-match');
  const m = currentMatch();
  if (!m) {
    const last = finishedMatches()[0];
    const pendingNext = last && !last.nextMatchId;
    box.innerHTML = `
      ${rsvpSelfCard()}
      ${pendingNext ? nextPanel(last, !canEdit()) : ''}
      <div class="card empty" ${pendingNext ? 'hidden' : ''}>
        <h2>Nenhum jogo agora</h2>
        <p>${canEdit() ? 'Marque quem veio e sorteie os times na aba Hoje.' : 'Quando a partida começar, o placar aparece aqui.'}</p>
        ${E(`<div class="row-btns center">
          ${S.teams.length >= 2 ? `<button class="primary" data-act="startFromTeams">${ICON.play}${esc(S.teams[0].name)} × ${esc(S.teams[1].name)}</button>` : ''}
          <button class="${S.teams.length >= 2 ? '' : 'primary'}" data-act="go" data-tab="teams">Ir para Hoje</button>
        </div>`)}
      </div>
      ${last && !pendingNext ? `<h3 class="section-title">Última partida</h3>${matchSummary(last)}` : ''}`;
    return;
  }
  const sA = score(m, 'A'), sB = score(m, 'B');
  const scoreKey = `${m.id}:${sA}:${sB}`;
  const bump = lastScoreKey && lastScoreKey !== scoreKey && lastScoreKey.startsWith(`${m.id}:`);
  lastScoreKey = scoreKey;
  const status = { pending: 'Não começou', running: 'Rolando', paused: 'Pausada' }[m.status];
  const prev = S.matches.find((x) => x.nextMatchId === m.id);
  const running = m.status === 'running';
  const mainBtn = running
    ? `<button class="btn-main dark" data-act="timer" data-a="pause">${ICON.pause}Pausar</button>`
    : `<button class="btn-main primary" data-act="timer" data-a="start">${ICON.play}${m.status === 'pending' ? 'Começar' : 'Continuar'}</button>`;
  box.innerHTML = `
    ${rsvpSelfCard()}
    <section class="board" aria-label="Placar">
      <div class="board-teams">
        <div class="bteam"><span class="team-bar" style="--c:${m.teamA.color}"></span><span class="bteam-name">${esc(m.teamA.name)}</span></div>
        <div class="score${bump ? ' bump' : ''}" aria-label="${sA} a ${sB}">${sA}<span class="score-sep">–</span>${sB}</div>
        <div class="bteam"><span class="team-bar" style="--c:${m.teamB.color}"></span><span class="bteam-name">${esc(m.teamB.name)}</span></div>
      </div>
      <div class="clock-wrap ${m.status}">
        <div id="clock" class="clock">00:00</div>
        <div id="clockSub" class="clock-sub"></div>
        <span class="status-tag">Partida ${m.number} · ${status}${S.settings.goalLimit ? ` · até ${S.settings.goalLimit} gols` : ''}</span>
        ${prev && m.status === 'pending' ? `<div><button class="link-btn" data-act="shareResult" data-id="${prev.id}">${ICON.share}Mandar resultado da partida ${prev.number}</button></div>` : ''}
      </div>
      ${canEdit() ? `<div class="controls ${m.status === 'pending' ? 'pending' : ''}">
        ${mainBtn}
        ${m.status === 'pending' ? '' : `<button class="btn-finish" data-act="finish">${ICON.flag}Encerrar</button>`}
        <button class="icon-btn" data-act="matchMenu" aria-label="Mais opções da partida" title="Mais opções">${ICON.more}</button>
      </div>` : `<div class="row-btns center"><button class="ghost small" data-act="bigboard">${ICON.screen}Placar grande</button></div>`}
    </section>
    <section aria-label="Jogadores em campo">
      <div class="section-head"><h2>${canEdit() ? 'Toque em quem marcou' : 'Em campo'}</h2></div>
      <div class="teams-grid">${teamCol(m, 'A')}${teamCol(m, 'B')}</div>
    </section>
    <section aria-label="Lances">${eventsBlock(m)}</section>`;
}

function matchMenuSheet() {
  return `<h3>Opções da partida</h3>
    <div class="menu-time">
      <button data-act="adjust" data-s="-60">${ICON.minus}1 min</button>
      <button data-act="adjust" data-s="60">${ICON.plus}1 min</button>
    </div>
    <div class="sheet-list">
      <button data-act="subsMenu">${ICON.swap}Substituições e goleiros</button>
      <button data-act="bigboard" data-close>${ICON.screen}Placar grande (telão)</button>
    </div>
    <div class="menu-sep"></div>
    <div class="sheet-list">
      <button data-act="resetTimer" data-close>${ICON.reset}Zerar cronômetro</button>
      <button class="danger-text" data-act="cancelMatch" data-close>${ICON.trash}Cancelar partida</button>
    </div>
    <button class="ghost wide" data-act="closeModal">Fechar</button>`;
}

function matchSummary(m) {
  const sA = score(m, 'A'), sB = score(m, 'B');
  const goals = (t) =>
    live(m).filter((e) => e.team === t)
      .map((e) => `${e.minute}' ${esc(pname(e.scorerId))}${e.ownGoal ? ' (c)' : ''}${e.assistId ? ` <small>(${esc(pname(e.assistId))})</small>` : ''}`)
      .join('<br>') || '<span class="muted">—</span>';
  const date = new Date(m.finishedAt || m.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  return `<div class="card match-sum">
    <div class="ms-head"><span class="muted">#${m.number} · ${date} · ${fmt(m.elapsedMs)}</span>
      ${E(`<button class="ghost small danger-text" data-act="deleteMatch" data-id="${m.id}">excluir</button>`)}</div>
    <div class="ms-score">
      <span style="--c:${m.teamA.color}" class="ms-team"><span class="dot"></span>${esc(m.teamA.name)}</span>
      <b>${sA} × ${sB}</b>
      <span style="--c:${m.teamB.color}" class="ms-team right">${esc(m.teamB.name)}<span class="dot"></span></span>
    </div>
    <div class="ms-goals"><div>${goals('A')}</div><div class="right">${goals('B')}</div></div>
  </div>`;
}

function tick() {
  if (!S) return;
  renderBigboard();
  const m = currentMatch();
  const el = $('#clock');
  if (!m || !el) { renderMini(); return; }
  const ms = elapsed(m);
  const limit = m.durationMin * 60000;
  el.textContent = fmt(ms);
  renderMini();
  const over = ms >= limit;
  el.classList.toggle('over', over);
  $('#clockSub').textContent = over
    ? `Tempo esgotado · acréscimo +${fmt(ms - limit)}`
    : `Restam ${fmt(limit - ms)} de ${m.durationMin} min`;
  if (over && m.status === 'running' && alertedMatch !== m.id) {
    alertedMatch = m.id;
    whistle();
    toast('⏰ Tempo esgotado!', 'warn');
  }
}
setInterval(tick, 250);

/* ------------------------------------------------- apito, tela, telão */

// Browsers only allow sound after a tap, so the audio context is created on
// the first touch anywhere in the app.
let audioCtx = null;
document.addEventListener('pointerdown', () => {
  if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}, { capture: true });

// Referee whistle: three blasts (short, short, long) with a fast trill.
function whistle() {
  // Vibration is only allowed after the user touched the page.
  if (navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) navigator.vibrate([300, 150, 300, 150, 700]);
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + 0.05;
  [[0, 0.25], [0.4, 0.25], [0.8, 0.8]].forEach(([at, dur]) => {
    const osc = audioCtx.createOscillator();
    const trill = audioCtx.createOscillator();
    const trillGain = audioCtx.createGain();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = 2900;
    trill.frequency.value = 28;
    trillGain.gain.value = 180;
    trill.connect(trillGain).connect(osc.frequency);
    gain.gain.setValueAtTime(0, t0 + at);
    gain.gain.linearRampToValueAtTime(0.18, t0 + at + 0.02);
    gain.gain.setValueAtTime(0.18, t0 + at + dur - 0.04);
    gain.gain.linearRampToValueAtTime(0, t0 + at + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0 + at); trill.start(t0 + at);
    osc.stop(t0 + at + dur); trill.stop(t0 + at + dur);
  });
}

// Keeps the screen on while a match is open (needs HTTPS on the server).
let wakeLock = null;
async function syncWakeLock() {
  const want = Boolean(S && currentMatch()) && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not supported or denied: ignore */ }
}
document.addEventListener('visibilitychange', syncWakeLock);

// Whistles on every device when the open match ends (time is handled in tick).
let lastOpenId = null;
function watchMatchEnd() {
  const m = currentMatch();
  if (lastOpenId && (!m || m.id !== lastOpenId)) {
    const ended = S.matches.find((x) => x.id === lastOpenId);
    if (ended && ended.status === 'finished') {
      whistle();
      if (ended.endReason === 'goals') toast(`Fim de jogo: ${score(ended, 'A')} × ${score(ended, 'B')}`, 'ok');
    }
  }
  lastOpenId = m ? m.id : null;
}

function renderBigboard() {
  const box = $('#bigboard');
  if (box.hidden) return;
  const m = currentMatch() || finishedMatches()[0];
  if (!m) { box.innerHTML = '<div class="bb-empty">Nenhuma partida</div>'; return; }
  const ms = elapsed(m);
  const over = ms >= m.durationMin * 60000;
  box.innerHTML = `
    <div class="bb-teams">
      <div class="bb-team" style="--c:${m.teamA.color}"><span class="dot"></span>${esc(m.teamA.name)}</div>
      <div class="bb-team" style="--c:${m.teamB.color}"><span class="dot"></span>${esc(m.teamB.name)}</div>
    </div>
    <div class="bb-score">${score(m, 'A')}<span>×</span>${score(m, 'B')}</div>
    <div class="bb-clock ${over ? 'over' : ''} ${m.status}">${m.status === 'finished' ? 'FIM' : fmt(ms)}</div>
    <div class="bb-hint">toque para sair</div>`;
}

/* ------------------------------------------------------------- times *//* ------------------------------------------------------------- times */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const COLORS = ['#f97316', '#3b82f6', '#eab308', '#a855f7', '#ef4444', '#14b8a6', '#ec4899', '#84cc16'];
const EXTRA = -1; // builder slot for "goes to the loose queue"
const bTeamName = (i) => builder.names[i] || `Time ${LETTERS[i]}`;
const bTeamColor = (i) => COLORS[i % COLORS.length];
const isGk = (id) => player(id)?.position === 'GOL';
// Rating used by the draw: the automatic one when enabled and available.
const ratingOf = (id) => {
  const p = player(id);
  if (!p) return 0;
  return (S.settings.autoRating && autoRatings().get(id)) || p.rating;
};
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const TEAM_COUNTS = ['auto', 2, 3, 4, 5, 6, 7, 8];

function initBuilderInputs() {
  renderTeamCount();
  renderTeamNames();
}

function renderTeamCount() {
  const i = TEAM_COUNTS.indexOf(builder.mode === 'auto' ? 'auto' : Number(builder.mode));
  $('#teamCountVal').innerHTML = builder.mode === 'auto'
    ? `Auto <small>(${plural(S ? autoCount() : 2, 'time', 'times')})</small>`
    : plural(Number(builder.mode), 'time', 'times');
  document.querySelectorAll('[data-act=teamCountStep]').forEach((b) => {
    b.disabled = Number(b.dataset.d) < 0 ? i <= 0 : i >= TEAM_COUNTS.length - 1;
  });
}

function autoCount() {
  const selected = builder.assign.size || S.attendance.present.filter((id) => player(id)?.active).length;
  return Math.max(2, Math.floor(selected / S.settings.teamSize));
}

function setTeamCount(n) {
  if (n === builder.n) return;
  builder.n = n;
  for (const [id, i] of builder.assign) if (i >= n) builder.assign.set(id, EXTRA);
  renderTeamNames();
  renderBuilder();
}

// Name inputs are rendered only when the number of teams changes, so live
// updates from other devices never wipe what the user is typing.
function renderTeamNames() {
  $('#teamNames').innerHTML = Array.from({ length: builder.n }, (_, i) => `
    <label class="tn" style="--c:${bTeamColor(i)}"><span class="dot"></span>
      <input data-idx="${i}" maxlength="24" value="${esc(bTeamName(i))}" aria-label="Nome do time ${i + 1}">
    </label>`).join('');
}
$('#teamNames').addEventListener('input', (e) => {
  const i = Number(e.target.dataset.idx);
  builder.names[i] = e.target.value;
  renderBuilder();
});

function renderRsvp() {
  const r = S.rsvp;
  const dateInput = $('#rsvpDate');
  if (!dateInput.value) dateInput.value = r.date || today();
  if (!r.date) { $('#rsvpBox').innerHTML = ''; return; }
  const fmtDate = (d) => d.split('-').reverse().join('/');
  const names = (ids) => ids.filter((id) => player(id)?.active).map((id) => esc(pname(id))).join(', ') || '—';
  const pendingYes = r.yes.filter((id) => player(id)?.active && !isPresent(id));
  $('#rsvpBox').innerHTML = `
    <div class="rsvp-status ${r.open ? 'on' : ''}">
      <b>${fmtDate(r.date)}</b> · ${r.open ? 'lista aberta' : 'lista fechada'}
    </div>
    <p><b>Vão (${r.yes.length})</b> <small class="muted">toque no ✕ para tirar quem desistiu</small></p>
    <div class="wteam-players">${r.yes.filter((id) => player(id)?.active).map((id) => `<span class="wp">${esc(pname(id))}<button class="x" data-act="rsvpRemove" data-player="${id}" aria-label="Tirar ${esc(pname(id))} da lista de confirmados">✕</button></span>`).join('') || '<span class="muted">Ninguém ainda.</span>'}</div>
    <p class="muted"><b>Não vão (${r.no.length}):</b> ${names(r.no)}</p>
    <div class="row-btns">
      ${r.open ? `<button class="small primary" data-act="rsvpShare">${ICON.share}Mandar link no grupo</button>` : ''}
      ${pendingYes.length ? `<button class="small" data-act="rsvpApply">Marcar os ${pendingYes.length} confirmados como presentes</button>` : ''}
      ${r.open ? '<button class="small ghost" data-act="rsvpClose">Fechar lista</button>' : ''}
    </div>`;
}

function renderPresence() {
  renderRsvp();
  const att = S.attendance;
  const m = currentMatch();
  const playing = new Set(m ? [...m.teamA.players, ...m.teamB.players] : []);
  const where = new Map();
  S.teams.forEach((t) => t.players.forEach((id) => where.set(id, t.name)));
  S.queue.forEach((id, i) => where.set(id, `próximo ${i + 1}º`));
  playing.forEach((id) => where.set(id, 'em jogo'));

  const fmtDate = (d) => d.split('-').reverse().slice(0, 2).join('/');
  $('#dayBanner').innerHTML = att.date && att.date !== today() && (att.present.length || S.queue.length || S.teams.length)
    ? `<div class="day-old">A lista de presença é do dia ${fmtDate(att.date)}.
        <button class="small primary" data-act="newDay">Começar o dia de hoje</button></div>`
    : '';

  const present = att.present.filter((id) => player(id)?.active);
  const gks = present.filter(isGk).length;
  const line = present.length - gks;
  const ls = S.settings.teamSize - 1;
  const full = Math.floor(line / ls);
  $('#presenceSummary').innerHTML = present.length
    ? `<b>${plural(present.length, 'presente', 'presentes')}</b> · ${plural(gks, 'goleiro', 'goleiros')} · ${line} de linha → ${plural(full, 'time', 'times')} de ${ls} na linha${line % ls ? ` + ${line % ls} de próximo` : ''}`
    : 'Toque nos jogadores que vieram hoje.';

  const q = ($('#presenceSearch').value || '').trim().toLowerCase();
  const list = S.players
    .filter((p) => p.active && (!q || `${p.name} ${p.nickname}`.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  $('#presenceList').innerHTML = list.map((p) => {
    const on = isPresent(p.id);
    return `<button class="prow-toggle ${on ? 'on' : ''}" data-act="presence" data-player="${p.id}" ${playing.has(p.id) ? 'disabled title="Em jogo"' : ''} aria-pressed="${on}">
      <span class="check">${on ? '✓' : ''}</span>
      <span class="pt-text"><span class="pt-name">${p.position === 'GOL' ? GK : ''}${esc(p.nickname || p.name)}</span>
        ${where.get(p.id) ? `<span class="pt-where">${esc(where.get(p.id))}</span>` : ''}</span>
    </button>`;
  }).join('') || '<p class="muted">Nenhum jogador encontrado.</p>';
}

// Presence toggles are optimistic and do not block other taps, so the
// organizer can mark many players quickly. The server treats each call as
// "set present/absent", so repeated or concurrent calls are harmless.
const pendingPresence = new Map(); // playerId -> { present, token }

// Re-applies taps still in flight on top of a fresh server state, so a
// broadcast for an earlier tap never makes a later one blink off.
function applyPendingPresence() {
  const att = S.attendance;
  for (const [id, { present }] of pendingPresence) {
    const has = att.present.includes(id);
    if (present && !has) att.present = [...att.present, id];
    if (!present && has) att.present = att.present.filter((x) => x !== id);
  }
}

async function setPresence(playerIds, present) {
  const token = {};
  for (const id of playerIds) pendingPresence.set(id, { present, token });
  applyPendingPresence();
  renderPresence();
  renderBuilder();
  const r = await api('POST', '/api/attendance', { playerIds, present, date: today() });
  for (const id of playerIds) if (pendingPresence.get(id)?.token === token) pendingPresence.delete(id);
  if (!r.ok) { toast(r.error || 'Erro.', 'err'); return loadState(); }
  if (r.formed?.length) toast(`Time fechado: ${r.formed.join(', ')}!`, 'ok');
  else if (r.queued?.length) toast(`${r.queued.map(pname).join(', ')} ficou de próximo.`, 'ok');
}

function renderBuilder() {
  const dur = $('#duration');
  if (document.activeElement !== dur && !dur.dataset.touched) dur.value = S.settings.durationMin;

  const m = currentMatch();
  $('#drawBox').hidden = Boolean(m);
  $('#drawBusy').hidden = !m;
  if (m) $('#drawBusy h2').textContent = m.status === 'pending' ? 'Partida pronta para começar' : 'Partida em andamento';
  renderTeamCount();
  const playing = new Set(m ? [...m.teamA.players, ...m.teamB.players] : []);
  for (const id of builder.assign.keys()) if (!player(id)?.active || playing.has(id) || !isPresent(id)) builder.assign.delete(id);

  const waitingTeam = new Map();
  S.teams.forEach((t) => t.players.forEach((id) => waitingTeam.set(id, t.name)));
  const qpos = new Map(S.queue.map((id, i) => [id, i + 1]));
  const active = S.players.filter((p) => p.active && isPresent(p.id) && !playing.has(p.id));

  $('#builderPool').innerHTML = active.length
    ? active.map((p) => {
        const has = builder.assign.has(p.id);
        const i = builder.assign.get(p.id);
        const color = !has ? '' : i === EXTRA ? '#94b5a3' : bTeamColor(i);
        const tag = !has ? '' : i === EXTRA ? 'Fila' : LETTERS[i];
        const where = playing.has(p.id) ? 'em jogo' : waitingTeam.get(p.id) || (qpos.has(p.id) ? `fila ${qpos.get(p.id)}º` : '');
        return `<button class="pchip ${has ? 'sel' : ''}" style="${has ? `--c:${color}` : ''}" data-act="cycle" data-player="${p.id}" ${playing.has(p.id) ? 'disabled' : ''}>
          ${tag ? `<b>${tag}</b>` : ''}${esc(p.nickname || p.name)}
          <small>${p.position === 'GOL' ? 'goleiro ' : p.position ? `${p.position} ` : ''}${'★'.repeat(p.rating)}${where ? ` · ${esc(where)}` : ''}</small>
        </button>`;
      }).join('')
    : '<p class="muted">Marque os presentes acima.</p>';

  const size = S.settings.teamSize;
  const cols = Array.from({ length: builder.n }, (_, i) => {
    const ids = [...builder.assign].filter(([, t]) => t === i).map(([id]) => id);
    const total = ids.reduce((s, id) => s + ratingOf(id), 0);
    const role = i < 2 ? 'joga agora' : `${i - 1}º na fila`;
    return `<div class="team-col" style="--c:${bTeamColor(i)}">
      <div class="team-col-head"><span class="dot"></span>${esc(bTeamName(i))}
        <small>${ids.filter((id) => !isGk(id)).length}/${size - 1} na linha · ${ids.some(isGk) ? 'com goleiro' : 'sem goleiro fixo'} · nível ${total} · ${role}</small></div>
      ${ids.map((id) => `<div class="prow">${isGk(id) ? GK : ''}${esc(pname(id))}</div>`).join('') || '<div class="prow muted">vazio</div>'}
    </div>`;
  });
  const extras = [...builder.assign].filter(([, t]) => t === EXTRA).map(([id]) => id);
  if (extras.length) {
    cols.push(`<div class="team-col" style="--c:#94b5a3">
      <div class="team-col-head"><span class="dot"></span>De próximo<small>${plural(extras.length, 'jogador', 'jogadores')}</small></div>
      ${extras.map((id) => `<div class="prow">${esc(pname(id))}</div>`).join('')}
    </div>`);
  }
  const drawn = builder.assign.size > 0;
  $('#builderPreview').innerHTML = drawn ? cols.join('') : '';
  $('#builderPreview').hidden = !drawn;
  $('#clearSel').hidden = !drawn;

  // Main action of the tab, always within thumb reach.
  const present = S.attendance.present.filter((id) => player(id)?.active).length;
  $('#todayBar').innerHTML = !canEdit() || m ? '' : drawn
    ? `<button class="ghost" data-act="balance" aria-label="Sortear de novo">${ICON.reset}</button>
       <button class="primary" data-act="createMatch">${ICON.play}Criar partida</button>`
    : `<button class="primary" data-act="balance" ${present < 2 ? 'disabled' : ''}>Sortear com quem veio (${present})</button>`;
}

// Splits players into n teams of up to `size`: one goalkeeper per team,
// strongest players spread first. Players beyond n*size go to the loose
// queue, preferring whoever arrived last (queue order).
function balance(ids, n, size) {
  const qpos = (id) => { const i = S.queue.indexOf(id); return i === -1 ? Infinity : i; };
  const gks = shuffle(ids.filter(isGk));
  const teamGks = gks.slice(0, n);
  let pool = shuffle([...ids.filter((id) => !isGk(id)), ...gks.slice(n)]).sort((a, b) => qpos(a) - qpos(b));
  const lineSlots = n * (size - 1); // goalkeeper slot is separate
  const extras = pool.slice(Math.max(0, lineSlots));
  pool = pool.slice(0, Math.max(0, lineSlots));

  const teams = Array.from({ length: n }, () => ({ ids: [], sum: 0 }));
  teamGks.forEach((id, i) => { teams[i].ids.push(id); teams[i].sum += ratingOf(id); });
  pool = shuffle(pool).sort((a, b) => ratingOf(b) - ratingOf(a));
  for (const id of pool) {
    const t = teams
      .filter((x) => x.ids.filter((y) => !isGk(y)).length < size - 1)
      .sort((x, y) => x.ids.length - y.ids.length || x.sum - y.sum)[0];
    t.ids.push(id);
    t.sum += ratingOf(id);
  }
  builder.assign.clear();
  teams.forEach((t, i) => t.ids.forEach((id) => builder.assign.set(id, i)));
  extras.forEach((id) => builder.assign.set(id, EXTRA));
}

/* ---------------------------------------------------------- próximos */

function renderQueue() {
  const m = currentMatch();
  const playing = new Set(m ? [...m.teamA.players, ...m.teamB.players] : []);
  const size = S.settings.teamSize;
  const lineNeeded = Math.max(1, size - 1);
  const looseLine = S.queue.filter((id) => !isGk(id)).length;
  const missing = Math.max(0, lineNeeded - looseLine);
  const pct = Math.min(100, Math.round((looseLine / lineNeeded) * 100));
  const inGoal = new Map();
  if (m) for (const t of [m.teamA, m.teamB]) if (t.gk && t.gkGuest) inGoal.set(t.gk, t.name);
  const edit = canEdit();

  const teamCards = S.teams.map((t, i) => {
    const line = t.players.filter((id) => !isGk(id)).length;
    return `
    <div class="wteam ${i === 0 ? 'first' : ''}">
      <span class="wteam-label">${i === 0 ? 'Entra no próximo jogo' : `${i + 1}º da fila`}</span>
      <div class="wteam-head">
        <span class="dot" style="--c:${t.color}"></span><b>${esc(t.name)}</b>
        <small class="muted">${line}/${lineNeeded} na linha${line < lineNeeded ? ' · incompleto' : ''} · ${t.players.some(isGk) ? 'com goleiro' : 'goleiro de próximo'}</small>
        ${edit ? `<span class="acts">
          <button class="ghost ibtn" data-act="teamMove" data-team="${t.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir ${esc(t.name)}">${ICON.up}</button>
          <button class="ghost ibtn" data-act="teamMove" data-team="${t.id}" data-d="1" ${i === S.teams.length - 1 ? 'disabled' : ''} aria-label="Descer ${esc(t.name)}">${ICON.down}</button>
          <button class="small ghost" data-act="teamDissolve" data-team="${t.id}">Desfazer</button>
        </span>` : ''}
      </div>
      <div class="wteam-players">${t.players.map((id) => `<span class="wp">${isGk(id) ? GK : ''}${esc(pname(id))}${edit
        ? `<button class="x" data-act="qremove" data-player="${id}" aria-label="Tirar ${esc(pname(id))} da fila">✕</button>` : ''}</span>`).join('')}</div>
    </div>`;
  }).join('');

  const loose = S.queue.map((id, i) => `<li class="qrow">
      <span class="pos">${i + 1}</span><span class="nm">${isGk(id) ? GK : ''}${esc(pname(id))}${inGoal.has(id) ? ` <small class="ingoal">no gol do ${esc(inGoal.get(id))}</small>` : ''}</span>
      ${edit ? `<span class="acts">
        <button class="ghost ibtn" data-act="qmove" data-player="${id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir ${esc(pname(id))}">${ICON.up}</button>
        <button class="ghost ibtn" data-act="qmove" data-player="${id}" data-d="1" ${i === S.queue.length - 1 ? 'disabled' : ''} aria-label="Descer ${esc(pname(id))}">${ICON.down}</button>
        <button class="ghost ibtn ibtn-remove" data-act="qremove" data-player="${id}" aria-label="Tirar ${esc(pname(id))} da fila">${ICON.x}</button>
      </span>` : ''}</li>`).join('');

  const avail = S.players.filter((p) => p.active && !playing.has(p.id) && !S.queue.includes(p.id) && !S.teams.some((t) => t.players.includes(p.id)));
  const onField = m ? `<div class="last-goal"><span class="lg-text"><span class="muted">Em campo</span><span><b>${esc(m.teamA.name)}</b> ${score(m, 'A')}–${score(m, 'B')} <b>${esc(m.teamB.name)}</b></span></span></div>` : '';

  $('#queueBox').innerHTML = `
    <div class="stack">
      ${edit && !m && S.teams.length >= 2 ? `<button class="primary big" data-act="startFromTeams">${ICON.play}Começar: ${esc(S.teams[0].name)} × ${esc(S.teams[1].name)}</button>` : ''}
      ${onField}
      <section class="card">
        <h2>Times formados</h2>
        ${teamCards || `<p class="muted">Nenhum time formado esperando. Quando ${lineNeeded} jogadores de linha estão de próximo, o time fecha sozinho.</p>`}
      </section>
      <section class="card">
        <div class="row-between"><h2>De próximo</h2><small class="muted">${S.queue.length ? `${missing === 1 ? 'falta 1' : `faltam ${missing}`} para fechar um time` : `${lineNeeded} de linha fecham um time`}</small></div>
        <div class="progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
        ${loose ? `<ol class="queue">${loose}</ol>` : '<p class="muted">Ninguém de próximo.</p>'}
      </section>
      ${edit ? `<details class="card">
        <summary>Chegou alguém? Pôr na fila</summary>
        ${avail.length ? '<div class="row-btns" style="margin-top:0"><button class="small" data-act="qaddAll">Adicionar todos</button></div>' : ''}
        <div class="pool" style="margin-top:10px">${avail.map((p) => `<button class="pchip" data-act="qadd" data-player="${p.id}">+ ${p.position === 'GOL' ? GK : ''}${esc(p.nickname || p.name)}</button>`).join('') || '<p class="muted">Todos já estão na fila ou em campo.</p>'}</div>
      </details>` : ''}
      ${edit && (S.teams.length || S.queue.length) ? '<div class="row-btns center"><button class="ghost small danger-text" data-act="qclear">Limpar times e fila</button></div>' : ''}
    </div>`;
}

/* --------------------------------------------------------- jogadores */

const POS = { GOL: 'Goleiro', ZAG: 'Zagueiro', LAT: 'Lateral', MEI: 'Meio', ATA: 'Atacante' };

let playerQuery = '';
function renderPlayers() {
  const all = S.players.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const q = playerQuery.trim().toLowerCase();
  const active = q ? all.filter((p) => `${p.name} ${p.nickname}`.toLowerCase().includes(q)) : all;
  const focused = document.activeElement && document.activeElement.id === 'playerSearch';
  if (focused) { renderPlayerRows(active, all.length); return; }
  $('#playerList').innerHTML = `<div class="card">
    <h3>Jogadores cadastrados (${all.length})</h3>
    <input id="playerSearch" type="search" placeholder="Buscar jogador" aria-label="Buscar jogador" autocomplete="off" value="${esc(playerQuery)}">
    <div id="playerRows"></div>
  </div>`;
  renderPlayerRows(active, all.length);
}

function renderPlayerRows(active) {
  $('#playerRows').innerHTML = `
    ${active.length ? `<ul class="plist">${active.map((p) => `<li>
      <div><b>${esc(p.name)}</b>${p.nickname ? ` <span class="muted">"${esc(p.nickname)}"</span>` : ''}
        <small class="muted">${POS[p.position] || ''} ${'★'.repeat(p.rating)}</small></div>
      <div class="acts"><button class="small ghost" data-act="editPlayer" data-player="${p.id}">editar</button>
        <button class="small ghost danger-text" data-act="delPlayer" data-player="${p.id}">excluir</button></div>
    </li>`).join('')}</ul>` : `<p class="muted">${playerQuery ? 'Nenhum jogador encontrado.' : 'Nenhum jogador ainda.'}</p>`}`;
}
document.addEventListener('input', (e) => {
  if (e.target.id !== 'playerSearch') return;
  playerQuery = e.target.value;
  renderPlayers();
});

/* ------------------------------------------------------------ ajustes */

const SETTING_LIMITS = { durationMin: [1, 120], goalLimit: [0, 30], teamSize: [2, 11] };
const pendingSettings = {};
let settingsTimer = null;

function rulesSentence(st) {
  const end = st.goalLimit ? `${st.durationMin} min ou ${st.goalLimit} gol${st.goalLimit > 1 ? 's' : ''} (o que vier primeiro)` : `${st.durationMin} min`;
  return `Times de <b>${st.teamSize}</b> (${st.teamSize - 1} na linha + goleiro) · partidas de <b>${end}</b> · empate: <b>${st.tieRule === 'house' ? 'regra da casa' : 'escolher na hora'}</b> · sorteio pelo <b>${st.autoRating ? 'nível automático' : 'nível do cadastro'}</b>.`;
}

function stepper(key, label, help, display) {
  const v = S.settings[key];
  const [min, max] = isAdmin() ? SETTING_LIMITS[key] : [v, v]; // read-only for non-admins
  return `<div class="setting">
    <div class="setting-text"><b>${label}</b><small>${help}</small></div>
    <div class="stepper">
      <button data-act="step" data-key="${key}" data-d="-1" ${v <= min ? 'disabled' : ''} aria-label="Diminuir ${label}">−</button>
      <span class="val">${display(v)}</span>
      <button data-act="step" data-key="${key}" data-d="1" ${v >= max ? 'disabled' : ''} aria-label="Aumentar ${label}">+</button>
    </div>
  </div>`;
}

function renderSettings() {
  const st = S.settings;
  $('#rulesSummary').innerHTML = `<h2>Regras atuais</h2><p>${rulesSentence(st)}</p>
    <p class="muted">${isAdmin() ? 'Toque para mudar. Salva na hora e vale para todos os aparelhos.' : 'Só o administrador muda as regras.'}</p>`;
  document.querySelectorAll('.admin-only').forEach((el) => { el.hidden = !isAdmin(); });
  $('#view-settings').classList.toggle('readonly', !isAdmin());

  $('#setAccount').innerHTML = `
    <div class="setting"><div class="setting-text"><b>${esc(ME.name)}</b><small>${esc(ME.phone)} · ${ROLE_LABEL[ME.role]}</small></div></div>
    <div class="setting">
      <div class="setting-text"><b>Na pelada você é</b><small>${ME.playerId ? esc(player(ME.playerId)?.name || '—') : 'Ainda não escolheu seu nome'}</small></div>
      <button class="small ${ME.playerId ? 'ghost' : 'primary'}" data-act="linkMe">${ME.playerId ? 'Trocar' : 'Escolher'}</button>
    </div>
    <div class="row-btns">
      <button class="small ghost" data-act="changePassword">Trocar senha</button>
      <button class="small ghost danger-text" data-act="logout">Sair da conta</button>
    </div>`;
  renderUsers();

  $('#setMatch').innerHTML =
    stepper('durationMin', 'Duração', 'Tempo de cada partida', (v) => `${v} min`) +
    stepper('goalLimit', 'Acaba com gols', 'A partida termina quando um time chega a esse número', (v) => (v ? `${v} gol${v > 1 ? 's' : ''}` : 'Sem limite')) +
    stepper('teamSize', 'Jogadores por time', 'Contando o goleiro', (v) => `${v} <small>(${v - 1} + goleiro)</small>`) +
    `<div class="setting"><div class="setting-text"><b>Apito</b><small>Toca e vibra quando o tempo acaba. Aumente o volume do celular.</small></div>
      <button class="small" data-act="testWhistle">${ICON.sound}Testar</button></div>`;

  const opt = (v, title, desc) => `<button class="choice ${st.tieRule === v ? 'on' : ''}" data-act="setTie" data-v="${v}" aria-pressed="${st.tieRule === v}">
      <span class="radio">${st.tieRule === v ? '✓' : ''}</span>
      <span><b>${title}</b><small>${desc}</small></span>
    </button>`;
  $('#setTie').innerHTML =
    opt('house', 'Regra da casa', 'Com 2 times de próximo, saem os dois. Com menos, fica o time que ganhou a partida anterior.') +
    opt('choose', 'Escolher na hora', 'O app pergunta qual time sai sempre que empatar.');

  $('#setDraw').innerHTML = `<div class="setting">
      <div class="setting-text"><b>Nível automático</b>
        <small>O sorteio usa um nível calculado pelo desempenho (vitórias, gols e assistências) de quem tem 5 jogos ou mais. Desligado, usa o nível do cadastro.</small></div>
      <button class="switch ${st.autoRating ? 'on' : ''}" data-act="toggleAuto" role="switch" aria-checked="${Boolean(st.autoRating)}" aria-label="Nível automático"><span></span></button>
    </div>`;

}

// Settings are applied on screen at once and saved shortly after the last
// tap, so steppers stay responsive. Pending values survive live updates.
async function changeSetting(key, value) {
  if (!isAdmin()) return toast('Só o administrador muda as regras.', 'warn');
  pendingSettings[key] = value;
  S.settings[key] = value;
  renderSettings();
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(saveSettings, 450);
}

async function saveSettings() {
  const body = { ...pendingSettings };
  const r = await api('PUT', '/api/settings', body);
  for (const k of Object.keys(body)) if (pendingSettings[k] === body[k]) delete pendingSettings[k];
  if (!r.ok) { toast(r.error || 'Não foi possível salvar.', 'err'); loadState(); return; }
  toast('Salvo ✓', 'ok');
}

async function loadBackups() {
  const box = $('#backupList');
  if (!isAdmin()) return;
  try {
    const r = await fetch('/api/backups');
    const data = await r.json();
    if (!data.ok) throw new Error(data.error);
    const q = '';
    const label = (name) => {
      const [y, m, d] = name.slice(7, 17).split('-');
      const isToday = `${y}-${m}-${d}` === today();
      return `${isToday ? 'Hoje' : `${d}/${m}/${y}`}`;
    };
    box.innerHTML = data.backups.length
      ? `<ul class="plist">${data.backups.map((b) => `<li>
          <span><b>${label(b.name)}</b> <small class="muted">${Math.max(1, Math.ceil(b.size / 1024))} KB</small></span>
          <a class="button ghost small" href="/api/backups/${encodeURIComponent(b.name)}${q}" download>baixar</a></li>`).join('')}</ul>`
      : '<p class="muted">Ainda não há cópias. A primeira é feita assim que o servidor liga.</p>';
  } catch (err) {
    box.innerHTML = `<p class="muted">Não foi possível listar as cópias${err.message ? `: ${esc(err.message)}` : ''}.</p>`;
  }
}

function resetPlayerForm() {
  editingPlayerId = null;
  const f = $('#playerForm');
  f.reset();
  $('#playerFormTitle').textContent = 'Cadastrar jogador';
  $('#playerSubmit').textContent = 'Cadastrar';
  $('#playerCancel').hidden = true;
  $('#playerFormWrap').open = false;
}

/* ------------------------------------------------------- estatísticas */

// Per-player numbers for matches since a timestamp. Guest goalkeepers count
// as players of the side they defended.
function computeStats(since) {
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) rows.set(id, { id, j: 0, v: 0, e: 0, d: 0, g: 0, a: 0, gc: 0, gkJ: 0, gkSof: 0 });
    return rows.get(id);
  };
  for (const m of S.matches) {
    if ((m.finishedAt || m.createdAt) < since) continue;
    if (m.status === 'finished') {
      const sA = score(m, 'A'), sB = score(m, 'B');
      for (const t of ['A', 'B']) {
        const mine = t === 'A' ? sA : sB, theirs = t === 'A' ? sB : sA;
        for (const id of sidePlayers(m, t)) {
          const r = row(id);
          r.j++;
          if (mine > theirs) r.v++; else if (mine === theirs) r.e++; else r.d++;
        }
        const gk = m[`team${t}`].gk;
        if (gk) { row(gk).gkJ++; row(gk).gkSof += theirs; }
      }
    }
    for (const e of live(m)) {
      if (e.ownGoal) { if (e.scorerId) row(e.scorerId).gc++; continue; }
      if (e.scorerId) row(e.scorerId).g++;
      if (e.assistId) row(e.assistId).a++;
    }
  }
  return [...rows.values()]
    .filter((r) => player(r.id))
    .sort((x, y) => y.g - x.g || y.a - x.a || y.v - x.v || pname(x.id).localeCompare(pname(y.id)));
}

// Automatic rating 1-5 from all-time performance (needs 5+ games):
// 60% win rate (draw = half) + 40% goals/assists per game.
function autoRatings() {
  if (autoCache) return autoCache;
  autoCache = new Map();
  for (const r of computeStats(0)) {
    if (r.j < 5) continue;
    const winRate = (r.v + r.e / 2) / r.j;
    const contrib = Math.min(1, (r.g + 0.7 * r.a) / r.j / 1.5);
    autoCache.set(r.id, Math.min(5, Math.max(1, Math.round(1 + (0.6 * winRate + 0.4 * contrib) * 4))));
  }
  return autoCache;
}

function playerProfile(id) {
  const res = []; // results in time order: 'V' | 'E' | 'D'
  let g = 0, a = 0, gkJ = 0, gkSof = 0;
  const matches = S.matches.filter((m) => m.status === 'finished').sort((x, y) => x.finishedAt - y.finishedAt);
  for (const m of matches) {
    for (const t of ['A', 'B']) {
      if (!sidePlayers(m, t).includes(id)) continue;
      const mine = score(m, t), theirs = score(m, otherSide(t));
      res.push(mine > theirs ? 'V' : mine === theirs ? 'E' : 'D');
      if (m[`team${t}`].gk === id) { gkJ++; gkSof += theirs; }
    }
    for (const e of live(m)) {
      if (e.scorerId === id && !e.ownGoal) g++;
      if (e.assistId === id) a++;
    }
  }
  let best = 0, run = 0;
  for (const r of res) { run = r === 'V' ? run + 1 : 0; best = Math.max(best, run); }
  let current = 0;
  for (let i = res.length - 1; i >= 0 && res[i] === 'V'; i--) current++;
  const j = res.length;
  return {
    j, g, a, gkJ, gkSof,
    v: res.filter((r) => r === 'V').length,
    e: res.filter((r) => r === 'E').length,
    d: res.filter((r) => r === 'D').length,
    current, best, last: res.slice(-5).reverse(),
    perGame: j ? (g / j).toFixed(2) : '0',
  };
}

function profileModal(id) {
  const p = player(id);
  const pr = playerProfile(id);
  const auto = autoRatings().get(id);
  openModal(`
    <h3>${p.position === 'GOL' ? GK : ''}${esc(p.name)}${p.nickname ? ` <small class="muted">"${esc(p.nickname)}"</small>` : ''}</h3>
    <div class="profile-grid">
      <div><b>${pr.j}</b><small>jogos</small></div>
      <div><b>${pr.v}/${pr.e}/${pr.d}</b><small>V/E/D</small></div>
      <div><b>${pr.g}</b><small>gols</small></div>
      <div><b>${pr.a}</b><small>assist.</small></div>
      <div><b>${pr.perGame}</b><small>gols/jogo</small></div>
      <div><b>${pr.current}</b><small>vitórias seguidas</small></div>
      <div><b>${pr.best}</b><small>maior sequência</small></div>
      <div><b>${pr.gkJ ? (pr.gkSof / pr.gkJ).toFixed(1) : '—'}</b><small>sofridos/jogo no gol</small></div>
    </div>
    <p>Últimos jogos: ${pr.last.map((r) => `<span class="res res-${r}">${r}</span>`).join(' ') || '<span class="muted">nenhum</span>'}</p>
    <p class="muted">Nível no cadastro: ${'★'.repeat(p.rating)} · nível automático: ${auto ? '★'.repeat(auto) : 'precisa de 5 jogos'}</p>
    <button class="ghost wide" data-act="closeModal">Fechar</button>`);
}

// Text summary of the selected period, ready to paste in WhatsApp.
function summaryText() {
  const since = rangeStart();
  const rows = computeStats(since);
  const hist = finishedMatches().filter((m) => m.finishedAt >= since).reverse();
  const label = { today: new Date().toLocaleDateString('pt-BR'), 7: 'últimos 7 dias', 30: 'últimos 30 dias', all: 'geral' }[statsRange];
  const top = (key) => {
    const best = Math.max(0, ...rows.map((r) => r[key]));
    return best ? `${rows.filter((r) => r[key] === best).map((r) => pname(r.id)).join(', ')} (${best})` : '—';
  };
  const lines = [
    `⚽ *Pelada — ${label}*`,
    `Partidas: ${hist.length}`,
    `🥇 Artilheiro: ${top('g')}`,
    `🎯 Garçom: ${top('a')}`,
    `🏆 Mais vitórias: ${top('v')}`,
  ];
  const gks = rows.filter((r) => r.gkJ).sort((x, y) => x.gkSof / x.gkJ - y.gkSof / y.gkJ);
  if (gks.length) lines.push(`🧤 Melhor goleiro: ${pname(gks[0].id)} (${(gks[0].gkSof / gks[0].gkJ).toFixed(1)} gol/jogo)`);
  if (hist.length) {
    lines.push('', '*Resultados*');
    for (const m of hist) lines.push(`#${m.number} ${m.teamA.name} ${score(m, 'A')} × ${score(m, 'B')} ${m.teamB.name}`);
  }
  const scorers = rows.filter((r) => r.g || r.a);
  if (scorers.length) {
    lines.push('', '*Gols e assistências*');
    for (const r of scorers) lines.push(`${pname(r.id)}: ${plural(r.g, 'gol', 'gols')}, ${plural(r.a, 'assistência', 'assistências')}`);
  }
  return lines.join('\n');
}

function rangeStart() {
  if (statsRange === 'all') return 0;
  if (statsRange === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  return Date.now() - Number(statsRange) * 86400000;
}

function renderStats() {
  $('#statsRange').value = statsRange;
  const since = rangeStart();
  const rows = computeStats(since);
  const gks = rows.filter((r) => r.gkJ).sort((x, y) => x.gkSof / x.gkJ - y.gkSof / y.gkJ || y.gkJ - x.gkJ);
  const hist = finishedMatches().filter((m) => m.finishedAt >= since);
  $('#statsBox').innerHTML = `
    <div class="row-btns">
      <button class="primary" data-act="shareSummary">${ICON.share}Resumo para o WhatsApp</button>
    </div>
    <div class="card table-wrap">
      ${rows.length ? `<table class="stats">
        <thead><tr><th>#</th><th class="l">Jogador</th><th title="Jogos">J</th><th title="Vitórias">V</th>
          <th title="Gols">G</th><th title="Assistências">A</th><th title="Gols + assistências">G+A</th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr data-act="profile" data-player="${r.id}"><td>${i + 1}</td><td class="l link">${esc(pname(r.id))}${r.gc ? ` <small class="muted">(${r.gc} contra)</small>` : ''}</td>
          <td>${r.j}</td><td>${r.v}</td><td><b>${r.g}</b></td><td>${r.a}</td><td>${r.g + r.a}</td></tr>`).join('')}</tbody>
      </table>
      <p class="stats-legend">J jogos · V vitórias · G gols · A assistências${currentMatch() ? ' · gols da partida em andamento já contam; jogos e vitórias contam ao encerrar' : ''}</p>
      <p class="muted tip">Toque no jogador para ver o perfil.</p>` : '<p class="muted">Sem dados nesse período.</p>'}
    </div>
    ${gks.length ? `<h3 class="section-title">Goleiros</h3>
    <div class="card table-wrap"><table class="stats">
      <thead><tr><th>#</th><th class="l">Goleiro</th><th title="Jogos no gol">J</th><th title="Gols sofridos">GS</th><th title="Média de gols sofridos por jogo">Média</th></tr></thead>
      <tbody>${gks.map((r, i) => `<tr data-act="profile" data-player="${r.id}"><td>${i + 1}</td><td class="l link">${esc(pname(r.id))}</td>
        <td>${r.gkJ}</td><td>${r.gkSof}</td><td><b>${(r.gkSof / r.gkJ).toFixed(1)}</b></td></tr>`).join('')}</tbody>
    </table></div>` : ''}
    <h3 class="section-title">Histórico (${hist.length})</h3>
    ${hist.map(matchSummary).join('') || '<p class="muted pad">Nenhuma partida encerrada nesse período.</p>'}`;
}

/* ============================================================ actions */

// Members of one side plus its guest goalkeeper.
function sidePlayers(m, t) {
  const team = m[`team${t}`];
  return team.gk && !team.players.includes(team.gk) ? [team.gk, ...team.players] : [...team.players];
}

function gkModal(t) {
  const m = currentMatch();
  const team = m[`team${t}`];
  const opp = m[`team${t === 'A' ? 'B' : 'A'}`];
  const blocked = new Set([...opp.players, opp.gk].filter(Boolean));
  const btn = (id, extra = '') => `<button class="${team.gk === id ? 'primary' : ''}" data-act="gkSet" data-team="${t}" data-player="${id}">${esc(pname(id))}${extra}</button>`;
  const waiting = [...S.queue, ...S.teams.flatMap((x) => x.players)].filter((id) => !blocked.has(id));
  openModal(`
    <h3>Goleiro do ${esc(team.name)}</h3>
    <p class="muted">Quem está esperando (de próximo primeiro):</p>
    <div class="pick">${waiting.map((id) => btn(id, isGk(id) ? ` ${GK}` : '')).join('') || '<span class="muted">Ninguém esperando.</span>'}</div>
    <p class="muted">Do próprio time:</p>
    <div class="pick">${team.players.map((id) => btn(id)).join('')}</div>
    <button class="ghost wide" data-act="gkSet" data-team="${t}" data-player="">Sem goleiro</button>
    <button class="ghost wide" data-act="closeModal">Cancelar</button>`);
}

function goalModal(team, scorerId) {
  const m = currentMatch();
  const mates = sidePlayers(m, team).filter((id) => id !== scorerId);
  openModal(`
    <h3 class="goal-title"><span class="team-bar" style="--c:${m[`team${team}`].color}"></span>Gol de ${esc(pname(scorerId))}</h3>
    <p class="muted">Quem deu o passe?</p>
    <div class="pick">
      ${mates.map((id) => `<button data-act="confirmGoal" data-team="${team}" data-scorer="${scorerId}" data-assist="${id}">${esc(pname(id))}</button>`).join('')}
      <button class="dark" data-act="confirmGoal" data-team="${team}" data-scorer="${scorerId}">Sem passe</button>
    </div>
    <button class="ghost wide" data-act="closeModal">Cancelar</button>`);
}

function otherGoalModal(team) {
  const m = currentMatch();
  const opp = team === 'A' ? 'B' : 'A';
  openModal(`
    <h3>Gol para ${esc(m[`team${team}`].name)}</h3>
    <p class="muted">Gol contra — quem do ${esc(m[`team${opp}`].name)} marcou?</p>
    <div class="pick">
      ${sidePlayers(m, opp).map((id) => `<button data-act="confirmGoal" data-team="${team}" data-scorer="${id}" data-own="1">${esc(pname(id))}</button>`).join('')}
    </div>
    <p class="muted">Ou, se ninguém viu quem marcou:</p>
    <button class="wide" data-act="confirmGoal" data-team="${team}">Autor desconhecido</button>
    <button class="ghost wide" data-act="closeModal">Cancelar</button>`);
}

// A goal before "Começar" is almost always a mistake: ask, and start the
// clock if it was a real goal.
async function startedOrStart() {
  const m = currentMatch();
  if (!m || m.status !== 'pending') return Boolean(m);
  const ok = await ask({
    title: 'A partida ainda não começou',
    text: 'Começar o cronômetro agora e registrar o gol?',
    ok: `${ICON.play}Começar e registrar`,
  });
  if (!ok) return false;
  const r = await act('POST', `/api/matches/${m.id}/timer`, { action: 'start' });
  return Boolean(r?.ok);
}

async function registerGoal(payload, force = false) {
  closeModal();
  const m = currentMatch();
  if (!m) return;
  const r = await act('POST', `/api/matches/${m.id}/events`, {
    ...payload, force, deviceId,
  }, { quiet: ['DUPLICATE_SUSPECT'] });
  if (!r) return;
  if (r.code === 'DUPLICATE_SUSPECT') {
    const again = await ask({
      title: 'Esse gol parece repetido',
      text: `${esc(r.error)} Provavelmente outra pessoa já registrou o mesmo lance.`,
      ok: 'Foi outro gol, registrar',
    });
    if (again) return registerGoal(payload, true);
    return toast('Gol repetido ignorado.', 'ok');
  }
  if (r.ok && r.autoFinished) toast(`Fim de jogo! Gol de ${pname(payload.scorerId)} fechou a partida.`, 'ok');
  else if (r.ok && r.replayed) toast('Gol já estava registrado.', 'ok');
  else if (r.ok && navigator.vibrate) navigator.vibrate(40);
}

const actions = {
  go: (d) => setTab(d.tab),
  closeModal,
  matchMenu() { if (canEdit() && currentMatch()) openModal('', matchMenuSheet); },
  subsMenu() { subSel = null; openModal('', subsSheet); },
  accountMenu() {
    openModal(`
      <div class="sheet-head"><span class="avatar" style="display:inline-flex;align-items:center;justify-content:center">${esc(initials(ME.name))}</span>
        <div><b>${esc(ME.name)}</b><br><small class="muted">${esc(ME.phone)} · ${ROLE_LABEL[ME.role]}</small></div></div>
      <div class="sheet-list">
        ${canEdit() ? `<button data-act="go" data-tab="players" data-close>${ICON.users}Jogadores</button>` : ''}
        <button data-act="go" data-tab="settings" data-close>${ICON.gear}Minha conta, regras e ajustes</button>
        <button class="danger-text" data-act="logout" data-close>${ICON.logout}Sair da conta</button>
      </div>
      <button class="ghost wide" data-act="closeModal">Fechar</button>`);
  },
  linkMe() { linkMeModal(); },
  linkPick(d) { linkMe({ playerId: d.player }); },
  linkNew() { linkMe({ newPlayer: true, position: $('#linkPos').value }); },
  changePassword() { passwordModal(); },
  async logout() {
    if (!await ask({ title: 'Sair da conta?', text: 'Você sai só neste aparelho.', ok: 'Sair', danger: true })) return;
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    showAuth();
    setAuthMode('login');
  },
  async rsvpMe(d) {
    const r = await act('POST', '/api/rsvp/answer', { going: d.going === '1' });
    if (r?.ok) toast(d.going === '1' ? 'Presença confirmada!' : 'Tudo bem, fica para a próxima.', 'ok');
  },
  async userPwd(d) {
    const u = USERS.find((x) => x.id === d.id);
    const pwd = await ask({
      title: `Nova senha para ${esc(u.name)}`,
      text: 'Mínimo 6 caracteres. Passe para a pessoa e peça para trocar depois.',
      ok: 'Salvar senha', input: { type: 'text', label: 'Nova senha' },
    });
    if (pwd === null) return;
    if (pwd.length < 6) return toast('A senha precisa ter pelo menos 6 caracteres.', 'err');
    const r = await act('POST', `/api/users/${d.id}/password`, { password: pwd });
    if (r?.ok) toast(`Senha de ${u.name} redefinida.`, 'ok');
  },
  async userActive(d) {
    const u = USERS.find((x) => x.id === d.id);
    if (d.v === '0' && !await ask({ title: `Desativar a conta de ${esc(u.name)}?`, text: 'A pessoa não consegue mais entrar.', ok: 'Desativar', danger: true })) return;
    const r = await act('PUT', `/api/users/${d.id}`, { active: d.v === '1' });
    if (r?.ok) toast('Conta atualizada.', 'ok');
    loadUsers();
  },
  async goal(d) {
    if (!canEdit() || !await startedOrStart()) return;
    goalModal(d.team, d.player);
  },
  gkPick(d) { if (canEdit()) gkModal(d.team); },
  gkSet(d) {
    closeModal();
    const m = currentMatch();
    act('POST', `/api/matches/${m.id}/gk`, { team: d.team, playerId: d.player || null });
  },
  async goalOther(d) {
    if (!canEdit() || !await startedOrStart()) return;
    otherGoalModal(d.team);
  },
  confirmGoal(d) {
    registerGoal({ team: d.team, scorerId: d.scorer || null, assistId: d.assist || null, ownGoal: d.own === '1' });
  },
  async undo(d) {
    const m = S.matches.find((x) => x.id === d.match);
    const e = m && m.events.find((x) => x.id === d.ev);
    if (!e || !await ask({ title: `Desfazer o gol de ${esc(pname(e.scorerId))}?`, text: `Gol aos ${e.minute}'. Fica registrado quem desfez.`, ok: 'Desfazer gol', danger: true })) return;
    const r = await act('DELETE', `/api/matches/${m.id}/events/${e.id}`);
    if (r?.ok) toast(r.already ? 'Esse gol já tinha sido desfeito.' : r.reopened ? 'Gol desfeito. Partida reaberta (pausada).' : 'Gol desfeito.', 'ok');
  },
  async reopen(d) {
    if (!await ask({ title: 'Reabrir a partida?', text: 'Ela volta pausada com o placar atual.', ok: 'Reabrir' })) return;
    const r = await act('POST', `/api/matches/${d.id}/reopen`);
    if (r?.ok) toast('Partida reaberta.', 'ok');
  },
  bigboard() {
    const box = $('#bigboard');
    box.hidden = false;
    renderBigboard();
    if (box.requestFullscreen) box.requestFullscreen().catch(() => {});
  },
  testWhistle() { whistle(); },
  timer(d) { const m = currentMatch(); act('POST', `/api/matches/${m.id}/timer`, { action: d.a }); },
  adjust(d) {
    const m = currentMatch();
    act('POST', `/api/matches/${m.id}/timer`, { action: 'adjust', seconds: Number(d.s), baseVersion: m.version });
  },
  async resetTimer() {
    const m = currentMatch();
    if (!await ask({ title: 'Zerar o cronômetro?', text: 'O tempo volta para 00:00. Os gols continuam.', ok: 'Zerar', danger: true })) return;
    const cur = currentMatch();
    if (cur) act('POST', `/api/matches/${cur.id}/timer`, { action: 'reset', baseVersion: cur.version });
  },
  async finish() {
    const m = currentMatch();
    const sA = score(m, 'A'), sB = score(m, 'B');
    const ok = await ask({
      title: 'Encerrar a partida?',
      text: `<span class="r-score"><span class="r-team"><span class="team-bar" style="--c:${m.teamA.color}"></span>${esc(m.teamA.name)}</span><span class="r-num">${sA}<span class="score-sep">–</span>${sB}</span><span class="r-team"><span class="team-bar" style="--c:${m.teamB.color}"></span>${esc(m.teamB.name)}</span></span>`,
      ok: `${ICON.flag}Encerrar partida`,
    });
    if (!ok) return;
    const r = await act('POST', `/api/matches/${m.id}/finish`);
    if (r?.ok) { setTab('match'); toast('Partida encerrada.', 'ok'); }
  },
  async cancelMatch() {
    const m = currentMatch();
    if (!await ask({ title: 'Cancelar esta partida?', text: 'Os gols dela são apagados e os jogadores voltam para o início da fila.', ok: 'Cancelar partida', danger: true })) return;
    await act('DELETE', `/api/matches/${m.id}`);
  },
  async deleteMatch(d) {
    if (!await ask({ title: 'Excluir do histórico?', text: 'As estatísticas desta partida serão perdidas.', ok: 'Excluir partida', danger: true })) return;
    await act('DELETE', `/api/matches/${d.id}`);
  },
  async next(d) {
    const last = finishedMatches()[0];
    const r = await act('POST', `/api/matches/${last.id}/next`, d.leaving ? { leaving: d.leaving } : {}, { quiet: ['ALREADY_NEXT'] });
    if (r?.code === 'ALREADY_NEXT') toast(r.error, 'ok');
    if (r?.ok) { leaveSel = null; toast('Próxima partida montada!', 'ok'); }
  },
  subPick(d) {
    const same = subSel && subSel.team === d.team && subSel.player === (d.player || null);
    subSel = same ? null : { team: d.team, player: d.player || null };
    if (modalRenderer) $('#modalBody').innerHTML = modalRenderer();
    const panel = $('.subs-in');
    if (panel) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },
  async subIn(d) {
    const m = currentMatch();
    if (!m || !subSel) return;
    const { team, player: out } = subSel;
    if (out) {
      const r = await act('POST', `/api/matches/${m.id}/players`, { team, playerId: out, op: 'remove' });
      if (!r?.ok) return;
    }
    const r = await act('POST', `/api/matches/${m.id}/players`, { team, playerId: d.player, op: 'add' });
    if (!r?.ok) return;
    if (out) await act('POST', '/api/queue', { playerIds: [out] });
    subSel = null;
    if (modalRenderer) $('#modalBody').innerHTML = modalRenderer();
    toast(out ? `${pname(d.player)} entrou no lugar de ${pname(out)}.` : `${pname(d.player)} entrou.`, 'ok');
  },
  async subOut() {
    const m = currentMatch();
    if (!m || !subSel?.player) return;
    const { team, player: out } = subSel;
    const r = await act('POST', `/api/matches/${m.id}/players`, { team, playerId: out, op: 'remove' });
    if (!r?.ok) return;
    await act('POST', '/api/queue', { playerIds: [out] });
    subSel = null;
    if (modalRenderer) $('#modalBody').innerHTML = modalRenderer();
    toast(`${pname(out)} saiu e foi para a fila.`, 'ok');
  },
  shareResult(d) {
    const m = S.matches.find((x) => x.id === d.id);
    if (m) shareText(resultText(m), 'Resultado copiado! Cole no grupo.');
  },
  leavePick(d) {
    leaveSel = d.side ? { match: d.match, side: d.side } : null;
    renderMatch();
  },
  toTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); },
  teamCountStep(d) {
    const cur = TEAM_COUNTS.indexOf(builder.mode === 'auto' ? 'auto' : Number(builder.mode));
    const next = TEAM_COUNTS[Math.min(TEAM_COUNTS.length - 1, Math.max(0, cur + Number(d.d)))];
    builder.mode = String(next);
    setTeamCount(next === 'auto' ? autoCount() : next);
    renderTeamCount();
  },

  // times
  cycle(d) {
    const id = d.player;
    const cur = builder.assign.get(id);
    if (cur === undefined) builder.assign.set(id, 0);
    else if (cur === EXTRA) builder.assign.delete(id);
    else if (cur + 1 < builder.n) builder.assign.set(id, cur + 1);
    else builder.assign.set(id, EXTRA);
    renderBuilder();
  },
  balance() {
    if (currentMatch()) return toast('Há uma partida em andamento. Encerre-a para sortear de novo.', 'warn');
    const ids = S.attendance.present.filter((id) => player(id)?.active);
    if (ids.length < 2) return toast('Marque pelo menos 2 presentes.', 'warn');
    builder.assign.clear();
    for (const id of ids) builder.assign.set(id, EXTRA);
    if (builder.mode === 'auto') setTeamCount(autoCount());
    balance(ids, builder.n, S.settings.teamSize);
    renderBuilder();
  },
  clearSel() { builder.assign.clear(); renderBuilder(); },
  async createMatch() {
    const teams = Array.from({ length: builder.n }, (_, i) => ({
      name: bTeamName(i),
      color: bTeamColor(i),
      players: [...builder.assign].filter(([, t]) => t === i).map(([id]) => id),
    })).filter((t) => t.players.length);
    if (teams.length < 2) return toast('Pelo menos 2 times precisam de jogadores.', 'warn');
    const extras = [...builder.assign].filter(([, t]) => t === EXTRA).map(([id]) => id);
    const r = await act('POST', '/api/matches', { teams, extras, durationMin: Number($('#duration').value) });
    if (r?.ok) {
      builder.assign.clear();
      setTab('match');
      toast('Partida criada! Toque em Começar.', 'ok');
    }
  },
  async startFromTeams() {
    const r = await act('POST', '/api/matches/from-teams', { durationMin: S.settings.durationMin });
    if (r?.ok) { setTab('match'); toast('Partida criada! Toque em Começar.', 'ok'); }
  },

  presence(d) { setPresence([d.player], !isPresent(d.player)); },
  presenceAll() {
    const m = currentMatch();
    const playing = new Set(m ? [...m.teamA.players, ...m.teamB.players] : []);
    const ids = S.players.filter((p) => p.active && !isPresent(p.id) && !playing.has(p.id)).map((p) => p.id);
    if (ids.length) setPresence(ids, true);
  },
  presenceNone() {
    const m = currentMatch();
    const playing = new Set(m ? [...m.teamA.players, ...m.teamB.players] : []);
    const ids = S.attendance.present.filter((id) => !playing.has(id));
    if (!ids.length) return;
    ask({ title: 'Desmarcar todos os presentes?', text: 'Eles também saem da fila de próximo.', ok: 'Desmarcar todos', danger: true })
      .then((ok) => { if (ok) setPresence(ids, false); });
  },
  async newDay() {
    if (!await ask({ title: 'Começar um novo dia?', text: 'A lista de presença, os times formados e a fila são limpos. O histórico e as estatísticas continuam.', ok: 'Começar novo dia', danger: true })) return;
    const r = await act('POST', '/api/day/reset', { date: today() });
    if (r?.ok) { builder.assign.clear(); toast('Novo dia começado. Marque os presentes.', 'ok'); }
  },

  async rsvpOpen() {
    const date = $('#rsvpDate').value;
    if (!date) return toast('Escolha a data do jogo.', 'warn');
    if (S.rsvp.date && S.rsvp.date !== date && (S.rsvp.yes.length || S.rsvp.no.length) &&
        !await ask({ title: 'Abrir uma nova lista?', text: 'As respostas da lista atual serão apagadas.', ok: 'Abrir nova lista', danger: true })) return;
    const r = await act('POST', '/api/rsvp/open', { date });
    if (r?.ok) toast('Lista aberta. Agora mande o link no grupo.', 'ok');
  },
  async rsvpClose() { await act('POST', '/api/rsvp/close'); },
  async rsvpShare() {
    const url = `${location.origin}/confirmar.html`;
    const date = S.rsvp.date.split('-').reverse().join('/');
    shareText(`⚽ Pelada ${date}: entre no app e confirme se você vai → ${url}`, 'Link copiado! Cole no grupo.');
  },
  async rsvpRemove(d) {
    const name = pname(d.player);
    if (!await ask({ title: `Tirar ${esc(name)} da lista?`, text: isPresent(d.player) ? 'Ele também já está marcado como presente: desmarque em "Quem veio hoje" se não veio.' : '', ok: 'Tirar da lista', danger: true })) return;
    const r = await act('POST', '/api/rsvp/answer', { playerId: d.player, going: null });
    if (r?.ok) toast(`${name} saiu da lista.`, 'ok');
  },
  guestAdd() {
    openModal(`
      <h3>Adicionar convidado</h3>
      <p class="muted">Para quem veio hoje sem conta no app. Ele já entra como presente${dayStartedClient() ? ' e fica de próximo' : ''}.</p>
      <form id="guestForm" class="stack" autocomplete="off">
        <label>Nome<input name="name" maxlength="40" required></label>
        <div class="form-grid">
          <label>Posição
            <select name="position">
              <option value="">Linha</option><option value="GOL">Goleiro</option><option value="ZAG">Zagueiro</option>
              <option value="LAT">Lateral</option><option value="MEI">Meio-campo</option><option value="ATA">Atacante</option>
            </select>
          </label>
          <label>Nível
            <select name="rating"><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="4">4</option><option value="5">5</option></select>
          </label>
        </div>
        <button type="submit" class="primary big">Adicionar e marcar presença</button>
      </form>
      <button class="ghost wide" data-act="closeModal">Cancelar</button>`);
    const form = $('#guestForm');
    form.name.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.name.value.trim()) return toast('Informe o nome.', 'warn');
      const r = await act('POST', '/api/players', {
        name: form.name.value, position: form.position.value, rating: Number(form.rating.value), present: true, date: today(),
      });
      if (r?.ok) {
        closeModal();
        toast(r.formed?.length ? `${r.player.name} chegou e fechou o ${r.formed.join(', ')}!` : r.queued?.length ? `${r.player.name} ficou de próximo.` : `${r.player.name} marcado como presente.`, 'ok');
      }
    });
  },
  async seedDemo() {
    const r = await act('POST', '/api/admin/seed', { count: 20 });
    if (r?.ok) toast(r.added ? `${r.added} jogadores fictícios criados (com "(teste)" no nome).` : 'Os jogadores fictícios já existem.', 'ok');
  },
  async resetData(d) {
    const all = d.scope === 'all';
    const typed = await ask({
      title: all ? 'Zerar todos os dados de jogo?' : 'Apagar os jogadores fictícios?',
      text: `${all ? 'Apaga <b>todos</b> os jogadores, partidas e estatísticas. As contas continuam.' : 'Apaga os fictícios e as partidas em que eles jogaram.'} Para confirmar, digite <b>ZERAR</b>.`,
      ok: all ? 'Zerar tudo' : 'Apagar fictícios', danger: true, input: { placeholder: 'ZERAR', label: 'Digite ZERAR' },
    });
    if (typed === null) return;
    const r = await act('POST', '/api/admin/reset', { scope: d.scope, confirm: typed.trim().toUpperCase() });
    if (r?.ok) {
      builder.assign.clear();
      toast(all ? 'Dados zerados. Pronto para o lançamento!' : `${r.removed} jogadores fictícios apagados.`, 'ok');
      loadBackups();
    }
  },
  rsvpApply() {
    const ids = S.rsvp.yes.filter((id) => player(id)?.active && !isPresent(id));
    if (ids.length) setPresence(ids, true);
  },

  // fila
  async qadd(d) {
    const r = await act('POST', '/api/queue', { playerIds: [d.player] });
    if (r?.formed?.length) toast(`Time fechado: ${r.formed.join(', ')}!`, 'ok');
  },
  async qaddAll() {
    const m = currentMatch();
    const playing = new Set(m ? [...m.teamA.players, ...m.teamB.players] : []);
    const ids = S.players.filter((p) => p.active && !S.queue.includes(p.id) && !playing.has(p.id)).map((p) => p.id);
    const r = await act('POST', '/api/queue', { playerIds: ids });
    if (r?.formed?.length) toast(`Times fechados: ${r.formed.join(', ')}!`, 'ok');
  },
  teamMove(d) { act('POST', '/api/teams/move', { teamId: d.team, delta: Number(d.d) }); },
  teamDissolve(d) {
    const t = S.teams.find((x) => x.id === d.team);
    if (t) ask({ title: `Desfazer ${esc(t.name)}?`, text: 'Os jogadores voltam para o fim da fila de próximo.', ok: 'Desfazer time', danger: true })
      .then((ok) => { if (ok) act('DELETE', `/api/teams/${t.id}`); });
  },
  qmove(d) { act('POST', '/api/queue/move', { playerId: d.player, delta: Number(d.d) }); },
  qremove(d) {
    ask({ title: `Tirar ${esc(pname(d.player))} da fila?`, ok: 'Tirar da fila', danger: true })
      .then((ok) => { if (ok) act('DELETE', `/api/queue/${d.player}`); });
  },
  qclear() {
    ask({ title: 'Limpar tudo?', text: 'Os times formados e a fila de próximo são esvaziados.', ok: 'Limpar tudo', danger: true })
      .then((ok) => { if (ok) act('DELETE', '/api/queue'); });
  },

  // jogadores
  editPlayer(d) {
    const p = player(d.player);
    const f = $('#playerForm');
    editingPlayerId = p.id;
    f.name.value = p.name;
    f.nickname.value = p.nickname;
    f.position.value = p.position;
    f.rating.value = String(p.rating);
    $('#playerFormTitle').textContent = 'Editar jogador';
    $('#playerSubmit').textContent = 'Salvar';
    $('#playerCancel').hidden = false;
    $('#playerFormWrap').open = true;
    $('#playerFormWrap').scrollIntoView({ behavior: 'smooth' });
    f.name.focus();
  },
  async delPlayer(d) {
    if (!await ask({ title: `Excluir ${esc(pname(d.player))}?`, text: 'As estatísticas antigas continuam no histórico.', ok: 'Excluir jogador', danger: true })) return;
    await act('DELETE', `/api/players/${d.player}`);
  },
  profile(d) { profileModal(d.player); },
  shareSummary() { shareText(summaryText(), 'Resumo copiado! Cole no grupo do WhatsApp.'); },
  step(d) {
    const [min, max] = SETTING_LIMITS[d.key];
    const v = Math.min(max, Math.max(min, S.settings[d.key] + Number(d.d)));
    if (v !== S.settings[d.key]) changeSetting(d.key, v);
  },
  setTie(d) { if (S.settings.tieRule !== d.v) changeSetting('tieRule', d.v); },
  toggleAuto() { changeSetting('autoRating', !S.settings.autoRating); },
  backup() { location.href = '/api/backup'; },
};

function setTab(t) {
  tab = t;
  LS.set('tab', t);
  renderTabs();
  window.scrollTo(0, 0);
  if (t === 'settings') { loadBackups(); loadUsers(); }
}

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn && !tabBtn.dataset.act) return setTab(tabBtn.dataset.tab);
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || !actions[el.dataset.act]) return;
  if (el.dataset.close !== undefined) closeModal(); // sheet items that finish the sheet
  actions[el.dataset.act](el.dataset, el);
});

$('#playerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = { name: f.name.value, nickname: f.nickname.value, position: f.position.value, rating: Number(f.rating.value) };
  const r = editingPlayerId
    ? await act('PUT', `/api/players/${editingPlayerId}`, body)
    : await act('POST', '/api/players', body);
  if (r?.ok) {
    toast(editingPlayerId ? 'Jogador atualizado.' : r.reactivated ? 'Jogador reativado.' : 'Jogador cadastrado.', 'ok');
    resetPlayerForm();
    f.name.focus();
  }
});
$('#playerCancel').addEventListener('click', resetPlayerForm);

$('#restoreFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !await ask({ title: 'Restaurar este backup?', text: '<b>Todos</b> os dados atuais serão substituídos.', ok: 'Restaurar', danger: true })) return;
  try {
    const r = await act('POST', '/api/restore', JSON.parse(await file.text()));
    if (r?.ok) { toast('Backup restaurado.', 'ok'); loadBackups(); }
  } catch {
    toast('Arquivo inválido.', 'err');
  }
});

$('#presenceSearch').addEventListener('input', () => renderPresence());
$('#duration').addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
$('#statsRange').addEventListener('change', (e) => {
  statsRange = e.target.value;
  LS.set('statsRange', statsRange);
  renderStats();
});

/* ================================================================ boot */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

initBuilderInputs();

// Starts with the login screen unless there is a valid session.
(async () => {
  try {
    const r = await fetch('/api/auth/me');
    const data = await r.json();
    if (data.ok) startApp(data.user);
    else showAuth();
  } catch {
    showAuth('Sem conexão com o servidor.');
  }
})();
if (tab === 'settings') setTimeout(() => { loadBackups(); loadUsers(); }, 600);
