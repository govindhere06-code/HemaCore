const API = 'http://localhost:5000/api';

// Each portal keeps its own login so signing in to one doesn't sign you in to the other
const TOKEN_KEY = document.body.dataset.portal === 'admin' ? 'adminToken' : 'userToken';

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function saveToken(t) {
  token = t;
  try { localStorage.setItem(TOKEN_KEY, t); } catch {}
}

function clearToken() {
  token = '';
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

try { localStorage.removeItem('token'); } catch {}   // old key shared by both portals
let token = readStorage(TOKEN_KEY) || '';

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

let toastTimer;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = '', 3200);
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

// ── THEME ─────────────────────────────────────────────
// The admin portal is dark and the user portal light by default; a choice made
// with the toggle is saved and applies to both portals. A script in each page's
// <head> applies the saved theme before first paint.
const THEME_KEY = 'hemacoreTheme';
const DEFAULT_THEME = document.body.dataset.portal === 'admin' ? 'dark' : 'light';

function currentTheme() {
  return document.documentElement.dataset.theme || DEFAULT_THEME;
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  updateThemeLabels();
}

function updateThemeLabels() {
  const label = currentTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  document.querySelectorAll('.theme-toggle').forEach(b => { b.title = label; b.setAttribute('aria-label', label); });
}

document.querySelectorAll('.theme-toggle').forEach(b => {
  b.innerHTML = `
    <svg class="icon-sun" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
    <svg class="icon-moon" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`;
});
updateThemeLabels();

// Escape user-entered text before putting it into innerHTML
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Select a value in a <select>, adding it as an option first if it isn't one of the choices
function setSelectValue(id, value) {
  const sel = document.getElementById(id);
  if (value && ![...sel.options].some(o => o.value === value)) sel.add(new Option(value, value));
  sel.value = value || '';
}

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(o => {
    o.addEventListener('click', e => {
      if (e.target === o) o.classList.remove('open');
    });
  });
});