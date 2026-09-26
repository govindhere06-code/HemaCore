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