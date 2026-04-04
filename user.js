let myRequests = [];
let myDonations = [];
let currentUserId = null;
let currentUserBloodType = null;

// ── AUTH TAB SWITCH ───────────────────────────────────
function switchAuthTab(tab) {
  document.getElementById('panel-login').classList.toggle('active', tab === 'login');
  document.getElementById('panel-signup').classList.toggle('active', tab === 'signup');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
  const headings = {
    login:  ['Welcome back', 'Sign in to manage your blood requests & donations'],
    signup: ['Create an account', 'Join HemaCore to request or donate blood'],
  };
  document.getElementById('auth-heading').textContent    = headings[tab][0];
  document.getElementById('auth-subheading').textContent = headings[tab][1];
}

// ── LOGIN ─────────────────────────────────────────────
async function doLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.style.display = 'none';
  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password })
    });
    token = data.access_token;
    localStorage.setItem('token', token);
    const me = await apiFetch('/auth/me');
    enterApp(me);
  } catch (e) {
    errEl.style.display = 'block';
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

// ── SIGNUP ────────────────────────────────────────────
async function doSignup() {
  const name     = document.getElementById('signup-name').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const phone    = document.getElementById('signup-phone').value.trim();
  const blood    = document.getElementById('signup-blood').value;
  const dob      = document.getElementById('signup-dob').value;
  const address  = document.getElementById('signup-address').value.trim();
  const errEl    = document.getElementById('signup-error');
  const succEl   = document.getElementById('signup-success');
  errEl.style.display  = 'none';
  succEl.style.display = 'none';

  if (!name || !email || !password || !phone || !blood) {
    errEl.style.display = 'block';
    errEl.textContent = 'Please fill in all required fields (name, email, password, phone, blood type).';
    return;
  }
  if (password.length < 6) {
    errEl.style.display = 'block';
    errEl.textContent = 'Password must be at least 6 characters.';
    return;
  }

  const btn = document.getElementById('btn-signup');
  btn.disabled = true;
  btn.textContent = 'Creating account…';
  try {
    await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, role: 'staff' })
    });

    const loginData = await apiFetch('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password })
    });
    token = loginData.access_token;
    localStorage.setItem('token', token);

    try {
      await apiFetch('/donors/', {
        method: 'POST',
        body: JSON.stringify({
          name, blood_type: blood, phone,
          email, date_of_birth: dob || null,
          address: address || null
        })
      });
    } catch (_) {}

    const me = await apiFetch('/auth/me');
    enterApp(me, blood);
    toast('Account created! Welcome to HemaCore 🎉', 'success');
  } catch (e) {
    token = '';
    errEl.style.display = 'block';
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
}

function enterApp(me, bloodType = null) {
  currentUserId        = me.id;
  currentUserBloodType = bloodType;
  document.getElementById('user-name').textContent   = me.name;
  document.getElementById('user-avatar').textContent = me.name.charAt(0).toUpperCase();
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.add('visible');

  if (bloodType) {
    const sel = document.getElementById('d-blood');
    if (sel) sel.value = bloodType;
  }

  const dateIn = document.getElementById('d-date');
  if (dateIn) dateIn.min = new Date().toISOString().split('T')[0];

  loadMyRequests();
  loadMyDonations();
}

function doLogout() {
  token = '';
  localStorage.removeItem('token');
  currentUserId = null;
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.remove('visible');
  document.getElementById('login-email').value    = '';
  document.getElementById('login-password').value = '';
}

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

// ── AUTO RESTORE SESSION ──────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (token) {
    try {
      const me = await apiFetch('/auth/me');
      enterApp(me);
    } catch {
      localStorage.removeItem('token');
      token = '';
    }
  }
});

// ── PAGE NAV ──────────────────────────────────────────
function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  btn.classList.add('active');
}

// ── REQUESTS ──────────────────────────────────────────
async function loadMyRequests() {
  try {
    const all = await apiFetch('/requests/');
    myRequests = all.filter(r => r.created_by == currentUserId);
    renderRequests();
  } catch (e) {
    toast('Failed to load requests', 'error');
  }
}

function renderRequests() {
  const container = document.getElementById('requests-list-body');
  const countEl   = document.getElementById('req-count');
  countEl.textContent = myRequests.length;

  if (!myRequests.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🩸</div><p>No requests submitted yet</p></div>`;
    return;
  }

  const sorted = [...myRequests].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  container.innerHTML = sorted.map(r => `
    <div class="req-item">
      <div class="req-blood">${r.blood_type}</div>
      <div class="req-info">
        <div class="req-title">${r.patient_name}</div>
        <div class="req-meta">
          <span>🏥 ${r.hospital}</span>
          <span>🩸 ${r.units} unit${r.units !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div class="req-right">
        <span class="badge badge-${r.status}">${capitalize(r.status)}</span>
        <div class="req-date">${fmtDate(r.created_at)}</div>
      </div>
    </div>
  `).join('');
}

async function submitRequest() {
  const body = {
    patient_name: document.getElementById('r-patient').value.trim(),
    blood_type:   document.getElementById('r-blood').value,
    units:        parseInt(document.getElementById('r-units').value),
    hospital:     document.getElementById('r-hospital').value.trim(),
  };
  if (!body.patient_name || !body.blood_type || !body.units || !body.hospital) {
    toast('Please fill in all fields', 'error');
    return;
  }
  try {
    await apiFetch('/requests/', { method: 'POST', body: JSON.stringify(body) });
    toast('Request submitted!', 'success');
    ['r-patient', 'r-blood', 'r-units', 'r-hospital'].forEach(id => {
      document.getElementById(id).value = '';
    });
    await loadMyRequests();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── DONATIONS ─────────────────────────────────────────
async function loadMyDonations() {
  try {
    const all = await apiFetch('/donations/');
    myDonations = all.filter(d => d.user_id == currentUserId);
    renderDonations();
  } catch (e) {}
}

function renderDonations() {
  const container = document.getElementById('donations-list-body');
  const countEl   = document.getElementById('don-count');
  countEl.textContent = myDonations.length;

  if (!myDonations.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">💚</div><p>No donation offers yet</p></div>`;
    return;
  }

  const sorted = [...myDonations].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  container.innerHTML = sorted.map(d => `
    <div class="req-item">
      <div class="req-blood green-bg">${d.blood_type}</div>
      <div class="req-info">
        <div class="req-title">${d.units} unit${d.units !== 1 ? 's' : ''} — ${d.blood_type}</div>
        <div class="req-meta">
          <span>📅 ${d.preferred_date ? fmtDate(d.preferred_date) : '—'}</span>
          <span>🕐 ${d.preferred_time || '—'}</span>
          ${d.notes ? `<span>📝 ${d.notes}</span>` : ''}
        </div>
      </div>
      <div class="req-right">
        <span class="badge badge-${d.status}">${capitalize(d.status)}</span>
        <div class="req-date">${fmtDate(d.created_at)}</div>
      </div>
    </div>
  `).join('');
}

async function submitDonation() {
  const blood_type     = document.getElementById('d-blood').value;
  const units          = parseInt(document.getElementById('d-units').value) || 1;
  const preferred_date = document.getElementById('d-date').value;
  const preferred_time = document.getElementById('d-time').value;
  const notes          = document.getElementById('d-notes').value.trim();

  if (!blood_type || !preferred_date || !preferred_time) {
    toast('Blood type, date and time slot are required', 'error');
    return;
  }

  try {
    await apiFetch('/donations/', {
      method: 'POST',
      body: JSON.stringify({ blood_type, units, preferred_date, preferred_time, notes })
    });
    toast("Donation offer submitted! We'll be in touch 💚", 'success');
    ['d-blood', 'd-units', 'd-date', 'd-time', 'd-notes'].forEach(id => {
      document.getElementById(id).value = '';
    });
    await loadMyDonations();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── ELIGIBILITY CHECKER ───────────────────────────────
function checkEligibility() {
  const age     = parseInt(document.getElementById('e-age').value);
  const weight  = parseInt(document.getElementById('e-weight').value);
  const lastDon = document.getElementById('e-lastdon').value;
  const checks  = [];

  if (age) {
    const ok = age >= 18 && age <= 65;
    checks.push({ label: `Age ${age}: must be between 18–65`, pass: ok });
  }
  if (weight) {
    const ok = weight >= 50;
    checks.push({ label: `Weight ${weight}kg: must be at least 50kg`, pass: ok });
  }
  if (lastDon) {
    const daysSince = Math.floor((Date.now() - new Date(lastDon)) / 86400000);
    const ok = daysSince >= 56;
    checks.push({ label: `Last donation ${daysSince} days ago: minimum 56 days required`, pass: ok });
  }

  if (!checks.length) {
    document.getElementById('eligibility-checklist').style.display = 'none';
    document.getElementById('eligibility-result').innerHTML = '';
    return;
  }

  document.getElementById('eligibility-checklist').style.display = 'flex';
  document.getElementById('eligibility-checklist').innerHTML = checks.map(c => `
    <div class="check-item">
      <div class="check-dot ${c.pass ? 'pass' : 'fail'}">${c.pass ? '✓' : '✗'}</div>
      <span>${c.label}</span>
    </div>
  `).join('');

  const allFilled = age && weight;
  const allPass   = checks.every(c => c.pass);
  const resultEl  = document.getElementById('eligibility-result');

  if (!allFilled) { resultEl.innerHTML = ''; return; }

  resultEl.innerHTML = allPass
    ? `<div class="eligibility-bar pass">✓ You appear to be eligible to donate blood today!</div>`
    : `<div class="eligibility-bar fail">✗ You may not be eligible. Please consult our staff.</div>`;
}

// ── HELPERS ───────────────────────────────────────────
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}