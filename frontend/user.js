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
const ADMIN_REDIRECT_MSG = 'Admin accounts should sign in through the Admin Portal.';

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
    if (data.role === 'admin') throw new Error(ADMIN_REDIRECT_MSG);
    saveToken(data.access_token);
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
      body: JSON.stringify({ name, email, password, phone, role: 'staff' })
    });

    const loginData = await apiFetch('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password })
    });
    saveToken(loginData.access_token);

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
    clearToken();
    errEl.style.display = 'block';
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
}

function enterApp(me, bloodType = null) {
  currentUserId        = me.id;
  currentUserBloodType = bloodType || me.donor?.blood_type || null;
  bloodType            = currentUserBloodType;
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

  document.getElementById('home-greeting').textContent = `Welcome, ${me.name.split(' ')[0]}`;
  Promise.all([loadMyRequests(), loadMyDonations()]).then(loadHome);
  startNotifications({
    open: page => showPage(page, document.getElementById('nav-' + page)),
    onNew: () => Promise.all([loadMyRequests(), loadMyDonations()]).then(loadHome),
  });
}

// ── HOME ──────────────────────────────────────────────
const LOW_STOCK = 10;
const DONATION_GAP_DAYS = 56;

async function loadHome() {
  document.getElementById('h-req-total').textContent   = myRequests.length;
  document.getElementById('h-req-pending').textContent = myRequests.filter(r => r.status === 'pending').length;
  document.getElementById('h-don-total').textContent   = myDonations.length;
  document.getElementById('h-don-done').textContent    =
    myDonations.filter(d => d.status === 'approved' || d.status === 'completed').length;

  const myType = currentUserBloodType
    || [...myDonations].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]?.blood_type;

  try {
    const inv = await apiFetch('/inventory/');
    document.getElementById('avail-grid').innerHTML = inv.map(i => {
      const u = i.units_available;
      const [cls, label] = u === 0 ? ['critical', 'Out of stock'] : u <= LOW_STOCK ? ['low', `Low · ${u} units`] : ['ok', `${u} units`];
      return `<div class="avail-cell ${i.blood_type === myType ? 'mine' : ''}" ${i.blood_type === myType ? 'title="Your blood type"' : ''}>
        <div class="avail-type">${i.blood_type}</div><div class="avail-state ${cls}">${label}</div></div>`;
    }).join('');
  } catch (e) {
    document.getElementById('avail-grid').innerHTML = `<p class="section-sub">Couldn't load availability.</p>`;
  }

  renderNextDonation();
  renderActivity();
}

function renderNextDonation() {
  const el = document.getElementById('next-donation');
  const last = myDonations
    .filter(d => (d.status === 'approved' || d.status === 'completed') && d.preferred_date)
    .map(d => new Date(d.preferred_date))
    .sort((a, b) => b - a)[0];
  if (!last) { el.innerHTML = ''; return; }
  const next = new Date(last.getTime() + DONATION_GAP_DAYS * 86400000);
  el.innerHTML = next <= new Date()
    ? `<div class="next-don pass">✓ You're eligible to donate again (last donation ${fmtDate(last)})</div>`
    : `<div class="next-don wait">⏳ Next eligible donation date: <strong>${fmtDate(next)}</strong></div>`;
}

function renderActivity() {
  const items = [
    ...myRequests.map(r => ({ date: r.created_at, status: r.status, blood: r.blood_type, green: false,
      title: `Blood request for ${esc(r.patient_name)}`, meta: `🏥 ${esc(r.hospital)} · ${r.units} unit${r.units !== 1 ? 's' : ''}` })),
    ...myDonations.map(d => ({ date: d.created_at, status: d.status, blood: d.blood_type, green: true,
      title: `Donation offer — ${d.units} unit${d.units !== 1 ? 's' : ''}`, meta: `📅 ${fmtDate(d.preferred_date)} · ${esc(d.preferred_time || '')}` })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

  document.getElementById('activity-list').innerHTML = items.length
    ? items.map(it => `
      <div class="req-item">
        <div class="req-blood ${it.green ? 'green-bg' : ''}">${it.blood}</div>
        <div class="req-info"><div class="req-title">${it.title}</div><div class="req-meta"><span>${it.meta}</span></div></div>
        <div class="req-right"><span class="badge badge-${it.status}">${capitalize(it.status)}</span><div class="req-date">${fmtDate(it.date)}</div></div>
      </div>`).join('')
    : `<div class="empty-state"><div class="empty-icon">📋</div><p>No activity yet — request or donate blood to get started</p></div>`;
}

function doLogout() {
  stopNotifications();
  clearToken();
  currentUserId = null;
  currentUserBloodType = null;
  resetRequestForm();
  resetDonationForm();
  ['p-cur-pw', 'p-new-pw', 'p-new-pw2'].forEach(id => document.getElementById(id).value = '');
  showPage('home', document.getElementById('nav-home'));
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
      if (me.role === 'admin') throw new Error();
      enterApp(me);
    } catch {
      clearToken();
    }
  }
});

// ── PAGE NAV ──────────────────────────────────────────
function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'home' && token) loadHome();
  if (name === 'profile' && token) loadProfile();
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
    document.getElementById('myreq-shown').textContent = '';
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🩸</div><p>No requests submitted yet</p></div>`;
    return;
  }

  const q      = document.getElementById('f-myreq-q').value.trim().toLowerCase();
  const blood  = document.getElementById('f-myreq-blood').value;
  const status = document.getElementById('f-myreq-status').value;
  const list = myRequests.filter(r =>
    (!q || r.patient_name.toLowerCase().includes(q) || r.hospital.toLowerCase().includes(q)) &&
    (!blood || r.blood_type === blood) &&
    (!status || r.status === status)
  );
  document.getElementById('myreq-shown').textContent =
    list.length === myRequests.length ? '' : `Showing ${list.length} of ${myRequests.length}`;

  if (!list.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>No requests match these filters</p></div>`;
    return;
  }

  const sorted = [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  container.innerHTML = sorted.map(r => `
    <div class="req-item">
      <div class="req-blood">${r.blood_type}</div>
      <div class="req-info">
        <div class="req-title">${esc(r.patient_name)}</div>
        <div class="req-meta">
          <span>🏥 ${esc(r.hospital)}</span>
          <span>🩸 ${r.units} unit${r.units !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div class="req-right">
        <span class="badge badge-${r.status}">${capitalize(r.status)}</span>
        <div class="req-date">${fmtDate(r.created_at)}</div>
        ${r.status === 'pending' ? `<div class="item-actions">
          <button class="mini-btn" onclick="editRequest(${r.id})">Edit</button>
          <button class="mini-btn danger" onclick="cancelRequest(${r.id})">Cancel</button>
        </div>` : ''}
      </div>
    </div>
  `).join('');
}

let editingRequestId = null;

// Load a pending request into the form above so it can be changed
function editRequest(id) {
  const r = myRequests.find(x => x.id === id);
  if (!r) return;
  editingRequestId = id;
  document.getElementById('r-patient').value  = r.patient_name;
  document.getElementById('r-hospital').value = r.hospital;
  document.getElementById('r-blood').value    = r.blood_type;
  document.getElementById('r-units').value    = r.units;
  document.getElementById('r-submit').textContent = 'Save Changes';
  document.getElementById('r-cancel-edit').style.display = '';
  const card = document.getElementById('r-submit').closest('.card');
  card.classList.add('editing');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetRequestForm() {
  editingRequestId = null;
  ['r-patient', 'r-blood', 'r-units', 'r-hospital'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('r-submit').textContent = 'Submit Request';
  document.getElementById('r-cancel-edit').style.display = 'none';
  document.getElementById('r-submit').closest('.card').classList.remove('editing');
}

async function cancelRequest(id) {
  if (!confirm('Cancel this blood request? This cannot be undone.')) return;
  try {
    await apiFetch(`/requests/${id}`, { method: 'DELETE' });
    toast('Request cancelled', 'success');
    if (editingRequestId === id) resetRequestForm();
    await loadMyRequests();
  } catch (e) {
    toast(e.message, 'error');
  }
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
    if (editingRequestId) {
      await apiFetch(`/requests/${editingRequestId}`, { method: 'PUT', body: JSON.stringify(body) });
      toast('Request updated', 'success');
    } else {
      await apiFetch('/requests/', { method: 'POST', body: JSON.stringify(body) });
      toast('Request submitted!', 'success');
    }
    resetRequestForm();
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
    document.getElementById('mydon-shown').textContent = '';
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">💚</div><p>No donation offers yet</p></div>`;
    return;
  }

  const q      = document.getElementById('f-mydon-q').value.trim().toLowerCase();
  const status = document.getElementById('f-mydon-status').value;
  const list = myDonations.filter(d =>
    (!q || (d.notes || '').toLowerCase().includes(q) || (d.preferred_time || '').toLowerCase().includes(q)) &&
    (!status || d.status === status)
  );
  document.getElementById('mydon-shown').textContent =
    list.length === myDonations.length ? '' : `Showing ${list.length} of ${myDonations.length}`;

  if (!list.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>No donation offers match these filters</p></div>`;
    return;
  }

  const sorted = [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  container.innerHTML = sorted.map(d => `
    <div class="req-item">
      <div class="req-blood green-bg">${d.blood_type}</div>
      <div class="req-info">
        <div class="req-title">${d.units} unit${d.units !== 1 ? 's' : ''} — ${d.blood_type}</div>
        <div class="req-meta">
          <span>📅 ${d.preferred_date ? fmtDate(d.preferred_date) : '—'}</span>
          <span>🕐 ${esc(d.preferred_time || '—')}</span>
          ${d.notes ? `<span>📝 ${esc(d.notes)}</span>` : ''}
        </div>
      </div>
      <div class="req-right">
        <span class="badge badge-${d.status}">${capitalize(d.status)}</span>
        <div class="req-date">${fmtDate(d.created_at)}</div>
        ${d.status === 'pending' ? `<div class="item-actions">
          <button class="mini-btn" onclick="editDonation(${d.id})">Edit</button>
          <button class="mini-btn danger" onclick="cancelDonation(${d.id})">Cancel</button>
        </div>` : ''}
      </div>
    </div>
  `).join('');
}

let editingDonationId = null;

// Load a pending offer into the schedule form so it can be changed
function editDonation(id) {
  const d = myDonations.find(x => x.id === id);
  if (!d) return;
  editingDonationId = id;
  document.getElementById('d-blood').value = d.blood_type;
  document.getElementById('d-units').value = d.units;
  document.getElementById('d-date').value  = d.preferred_date ? new Date(d.preferred_date).toISOString().slice(0, 10) : '';
  setSelectValue('d-time', d.preferred_time);
  document.getElementById('d-notes').value = d.notes || '';
  document.getElementById('d-submit').textContent = 'Save Changes';
  document.getElementById('d-cancel-edit').style.display = '';
  const card = document.getElementById('d-submit').closest('.card');
  card.classList.add('editing');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetDonationForm() {
  editingDonationId = null;
  ['d-units', 'd-date', 'd-time', 'd-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('d-blood').value = currentUserBloodType || '';
  document.getElementById('d-submit').textContent = 'Submit Donation Offer';
  document.getElementById('d-cancel-edit').style.display = 'none';
  document.getElementById('d-submit').closest('.card').classList.remove('editing');
}

async function cancelDonation(id) {
  if (!confirm('Cancel this donation offer? This cannot be undone.')) return;
  try {
    await apiFetch(`/donations/${id}`, { method: 'DELETE' });
    toast('Donation offer cancelled', 'success');
    if (editingDonationId === id) resetDonationForm();
    await loadMyDonations();
  } catch (e) {
    toast(e.message, 'error');
  }
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

  const body = JSON.stringify({ blood_type, units, preferred_date, preferred_time, notes });
  try {
    if (editingDonationId) {
      await apiFetch(`/donations/${editingDonationId}`, { method: 'PUT', body });
      toast('Donation offer updated', 'success');
    } else {
      await apiFetch('/donations/', { method: 'POST', body });
      toast("Donation offer submitted! We'll be in touch 💚", 'success');
    }
    resetDonationForm();
    await loadMyDonations();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── PROFILE ───────────────────────────────────────────
async function loadProfile() {
  try {
    const me = await apiFetch('/auth/me');
    const donor = me.donor || {};
    document.getElementById('p-name').value    = me.name;
    document.getElementById('p-email').value   = me.email;
    document.getElementById('p-phone').value   = me.phone || donor.phone || '';
    document.getElementById('p-blood').value   = donor.blood_type || '';
    document.getElementById('p-dob').value     = donor.date_of_birth ? new Date(donor.date_of_birth).toISOString().slice(0, 10) : '';
    document.getElementById('p-address').value = donor.address || '';
    document.getElementById('p-member-since').textContent = `Member since ${fmtDate(me.created_at)}`;
  } catch (e) {
    toast('Failed to load profile', 'error');
  }
}

async function saveProfile() {
  const body = {
    name:          document.getElementById('p-name').value.trim(),
    phone:         document.getElementById('p-phone').value.trim(),
    blood_type:    document.getElementById('p-blood').value || null,
    date_of_birth: document.getElementById('p-dob').value || null,
    address:       document.getElementById('p-address').value.trim(),
  };
  if (!body.name || !body.phone) { toast('Name and phone are required', 'error'); return; }
  try {
    await apiFetch('/auth/me', { method: 'PUT', body: JSON.stringify(body) });
    toast('Profile updated', 'success');
    document.getElementById('user-name').textContent     = body.name;
    document.getElementById('user-avatar').textContent   = body.name.charAt(0).toUpperCase();
    document.getElementById('home-greeting').textContent = `Welcome, ${body.name.split(' ')[0]}`;
    if (body.blood_type) currentUserBloodType = body.blood_type;
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function changePassword() {
  const cur  = document.getElementById('p-cur-pw').value;
  const next = document.getElementById('p-new-pw').value;
  const conf = document.getElementById('p-new-pw2').value;
  if (!cur || !next) { toast('Enter your current and new password', 'error'); return; }
  if (next.length < 6) { toast('New password must be at least 6 characters', 'error'); return; }
  if (next !== conf) { toast('New passwords do not match', 'error'); return; }
  try {
    await apiFetch('/auth/change-password', {
      method: 'POST', body: JSON.stringify({ current_password: cur, new_password: next })
    });
    toast('Password changed', 'success');
    ['p-cur-pw', 'p-new-pw', 'p-new-pw2'].forEach(id => document.getElementById(id).value = '');
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