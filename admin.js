let allDonors = [];
let allRequests = [];
let allDonations = [];

// ── AUTH ──────────────────────────────────────────────
async function doLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.style.display = 'none';
  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password })
    });
    if (data.role !== 'admin') throw new Error('Access denied. Admin account required.');
    token = data.access_token;
    localStorage.setItem('token', token);
    const me = await apiFetch('/auth/me');
    enterAdminApp(me);
  } catch (e) {
    errEl.style.display = 'block';
    errEl.textContent = e.message;
  }
}

function enterAdminApp(me) {
  document.getElementById('user-name').textContent   = me.name;
  document.getElementById('user-avatar').textContent = me.name.charAt(0).toUpperCase();
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.add('visible');
  setTopbarActions('dashboard');
  loadAll();
}

function doLogout() {
  token = '';
  localStorage.removeItem('token');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.remove('visible');
}

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

// ── AUTO RESTORE SESSION ──────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (token) {
    try {
      const me = await apiFetch('/auth/me');
      if (me.role !== 'admin') throw new Error();
      enterAdminApp(me);
    } catch {
      localStorage.removeItem('token');
      token = '';
    }
  }
});

// ── NAVIGATION ────────────────────────────────────────
function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  btn.classList.add('active');
  const titles = {
    dashboard: 'Dashboard', donors: 'Donors',
    inventory: 'Inventory', requests: 'Requests', donations: 'Donation Offers'
  };
  document.getElementById('page-title').textContent = titles[name];
  setTopbarActions(name);
  if (name === 'donors')    renderDonors(allDonors);
  if (name === 'inventory') loadInventory();
  if (name === 'requests')  renderRequests(allRequests);
  if (name === 'donations') renderDonations(allDonations);
}

function setTopbarActions(page) {
  const el = document.getElementById('topbar-actions');
  const plusIcon = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  const actions = {
    donors:    `<button class="btn-sm btn-red" onclick="openModal('modal-donor')">${plusIcon} Add Donor</button>`,
    inventory: `<button class="btn-sm btn-red" onclick="openModal('modal-inventory')">${plusIcon} Update Stock</button>`,
    requests: '', dashboard: '', donations: '',
  };
  el.innerHTML = actions[page] || '';
}

// ── LOAD ALL ──────────────────────────────────────────
async function loadAll() {
  await loadDashboard();
}

async function loadDashboard() {
  try {
    const [donors, inv, reqs, donations] = await Promise.all([
      apiFetch('/donors/'), apiFetch('/inventory/'),
      apiFetch('/requests/'), apiFetch('/donations/')
    ]);
    allDonors    = donors;
    allRequests  = reqs;
    allDonations = donations;

    document.getElementById('stat-donors').textContent    = donors.length;
    document.getElementById('stat-units').textContent     = inv.reduce((s, i) => s + i.units_available, 0);
    document.getElementById('stat-pending').textContent   = reqs.filter(r => r.status === 'pending').length;
    document.getElementById('stat-fulfilled').textContent = reqs.filter(r => r.status === 'fulfilled').length;

    const pendingDon = donations.filter(d => d.status === 'pending').length;
    const donBadge = document.getElementById('donation-badge');
    if (donBadge) {
      donBadge.textContent = pendingDon;
      donBadge.style.display = pendingDon ? 'inline-flex' : 'none';
    }

    const pendingReqs = reqs.filter(r => r.status === 'pending').length;
    const reqBadge = document.getElementById('request-badge');
    if (reqBadge) {
      reqBadge.textContent = pendingReqs;
      reqBadge.style.display = pendingReqs ? 'inline-flex' : 'none';
    }

    const recent = [...reqs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8);
    document.getElementById('recent-meta').textContent = `${reqs.length} total`;
    const tbody = document.getElementById('recent-body');
    tbody.innerHTML = recent.length
      ? recent.map(r => `<tr>
          <td>${r.patient_name}</td>
          <td><span class="badge badge-blood">${r.blood_type}</span></td>
          <td style="font-family:'DM Mono',monospace">${r.units}</td>
          <td>${r.hospital}</td>
          <td><span class="badge badge-${r.status}">${r.status}</span></td>
          <td style="color:var(--text-muted);font-size:12px">${fmtDate(r.created_at)}</td>
        </tr>`).join('')
      : `<tr><td colspan="6"><div class="empty-state"><p>No requests yet</p></div></td></tr>`;
  } catch (e) { toast('Failed to load: ' + e.message, 'error'); }
}

// ── DONORS ────────────────────────────────────────────
function renderDonors(list) {
  const tbody = document.getElementById('donors-body');
  tbody.innerHTML = list.length
    ? list.map(d => `<tr>
        <td><strong>${d.name}</strong></td>
        <td><span class="badge badge-blood">${d.blood_type}</span></td>
        <td style="font-family:'DM Mono',monospace;font-size:13px">${d.phone}</td>
        <td style="color:var(--text-muted);font-size:13px">${fmtDate(d.last_donation_date)}</td>
        <td><button class="action-btn danger" onclick="deleteDonor(${d.id})">Delete</button></td>
      </tr>`).join('')
    : `<tr><td colspan="5"><div class="empty-state"><p>No donors registered</p></div></td></tr>`;
}

function filterDonors(q) {
  renderDonors(allDonors.filter(d =>
    d.name.toLowerCase().includes(q.toLowerCase()) ||
    d.blood_type.toLowerCase().includes(q.toLowerCase()) ||
    (d.phone || '').includes(q)
  ));
}

async function submitDonor() {
  const body = {
    name:               document.getElementById('d-name').value,
    blood_type:         document.getElementById('d-blood').value,
    phone:              document.getElementById('d-phone').value,
    email:              document.getElementById('d-email').value,
    date_of_birth:      document.getElementById('d-dob').value || null,
    address:            document.getElementById('d-address').value,
    last_donation_date: document.getElementById('d-lastdon').value || null,
  };
  if (!body.name || !body.blood_type || !body.phone) { toast('Name, blood type and phone required', 'error'); return; }
  try {
    await apiFetch('/donors/', { method: 'POST', body: JSON.stringify(body) });
    toast('Donor registered', 'success');
    closeModal('modal-donor');
    allDonors = await apiFetch('/donors/');
    renderDonors(allDonors);
    document.getElementById('stat-donors').textContent = allDonors.length;
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteDonor(id) {
  if (!confirm('Delete this donor?')) return;
  try {
    await apiFetch(`/donors/${id}`, { method: 'DELETE' });
    toast('Donor deleted', 'success');
    allDonors = await apiFetch('/donors/');
    renderDonors(allDonors);
  } catch (e) { toast(e.message, 'error'); }
}

// ── INVENTORY ─────────────────────────────────────────
async function loadInventory() {
  try {
    const inv = await apiFetch('/inventory/');
    const max = Math.max(...inv.map(i => i.units_available), 1);
    document.getElementById('inventory-grid').innerHTML = inv.map(i => {
      const pct = Math.round((i.units_available / max) * 100);
      const cls = i.units_available === 0 ? 'critical' : i.units_available < 5 ? 'low' : 'ok';
      return `<div class="inv-card">
        <div class="blood-type-label">${i.blood_type}</div>
        <div class="inv-units">${i.units_available}</div>
        <div class="inv-label">Units Available</div>
        <div class="inv-bar"><div class="inv-bar-fill ${cls}" style="width:${Math.max(pct,4)}%"></div></div>
      </div>`;
    }).join('');
  } catch (e) { toast('Failed to load inventory', 'error'); }
}

async function submitInventory() {
  const blood_type = document.getElementById('i-blood').value;
  const units      = parseInt(document.getElementById('i-units').value);
  const op         = document.getElementById('i-op').value;
  if (!blood_type || !units) { toast('All fields required', 'error'); return; }
  try {
    await apiFetch(`/inventory/${op}`, { method: 'POST', body: JSON.stringify({ blood_type, units }) });
    toast(`${units} units ${op === 'add' ? 'added' : 'deducted'} for ${blood_type}`, 'success');
    closeModal('modal-inventory');
    loadInventory();
  } catch (e) { toast(e.message, 'error'); }
}

// ── REQUESTS ──────────────────────────────────────────
function renderRequests(list) {
  const tbody = document.getElementById('requests-body');
  tbody.innerHTML = list.length
    ? list.map(r => `<tr>
        <td><strong>${r.patient_name}</strong></td>
        <td><span class="badge badge-blood">${r.blood_type}</span></td>
        <td style="font-family:'DM Mono',monospace">${r.units}</td>
        <td>${r.hospital}</td>
        <td><span class="badge badge-${r.status}">${r.status}</span></td>
        <td>
          ${r.status === 'pending' ? `
            <button class="action-btn" onclick="updateStatus(${r.id},'approved')">Approve</button>
            <button class="action-btn danger" onclick="updateStatus(${r.id},'rejected')">Reject</button>` : ''}
          ${r.status === 'approved' ? `
            <button class="action-btn" onclick="updateStatus(${r.id},'fulfilled')">Fulfill</button>` : ''}
          <button class="action-btn danger" onclick="deleteRequest(${r.id})">Delete</button>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="6"><div class="empty-state"><p>No requests found</p></div></td></tr>`;
}

function filterRequests(status) {
  renderRequests(status ? allRequests.filter(r => r.status === status) : allRequests);
}

async function updateStatus(id, status) {
  try {
    await apiFetch(`/requests/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    const msgs = {
      approved:  'Request approved — inventory deducted ✓',
      fulfilled: 'Request fulfilled ✓',
      rejected:  'Request rejected — inventory restored',
    };
    toast(msgs[status] || `Request marked as ${status}`, 'success');
    const [reqs, inv] = await Promise.all([apiFetch('/requests/'), apiFetch('/inventory/')]);
    allRequests = reqs;
    renderRequests(allRequests);
    document.getElementById('stat-units').textContent     = inv.reduce((s, i) => s + i.units_available, 0);
    document.getElementById('stat-pending').textContent   = reqs.filter(r => r.status === 'pending').length;
    document.getElementById('stat-fulfilled').textContent = reqs.filter(r => r.status === 'fulfilled').length;
    const reqBadge = document.getElementById('request-badge');
    if (reqBadge) {
      const pendingReqs = reqs.filter(r => r.status === 'pending').length;
      reqBadge.textContent = pendingReqs;
      reqBadge.style.display = pendingReqs ? 'inline-flex' : 'none';
    }
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteRequest(id) {
  if (!confirm('Delete this request?')) return;
  try {
    await apiFetch(`/requests/${id}`, { method: 'DELETE' });
    toast('Request deleted', 'success');
    allRequests = await apiFetch('/requests/');
    renderRequests(allRequests);
  } catch (e) { toast(e.message, 'error'); }
}

// ── DONATIONS ─────────────────────────────────────────
function renderDonations(list) {
  const tbody = document.getElementById('donations-body');
  if (!tbody) return;
  tbody.innerHTML = list.length
    ? list.map(d => `<tr>
        <td><strong>User #${d.user_id}</strong></td>
        <td><span class="badge badge-blood">${d.blood_type}</span></td>
        <td style="font-family:'DM Mono',monospace">${d.units}</td>
        <td style="font-size:13px">${fmtDate(d.preferred_date)}<br><small style="color:var(--text-muted)">${d.preferred_time || ''}</small></td>
        <td style="font-size:12px;color:var(--text-muted);max-width:140px">${d.notes || '—'}</td>
        <td><span class="badge badge-${d.status}">${d.status}</span></td>
        <td>
          ${d.status === 'pending' ? `
            <button class="action-btn" onclick="updateDonationStatus(${d.id},'approved')">Approve</button>
            <button class="action-btn danger" onclick="updateDonationStatus(${d.id},'rejected')">Reject</button>` : ''}
          ${d.status === 'approved' ? `
            <button class="action-btn" onclick="updateDonationStatus(${d.id},'completed')">Complete</button>` : ''}
          <button class="action-btn danger" onclick="deleteDonation(${d.id})">Delete</button>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="7"><div class="empty-state"><p>No donation offers found</p></div></td></tr>`;
}

function filterDonations(status) {
  renderDonations(status ? allDonations.filter(d => d.status === status) : allDonations);
}

async function updateDonationStatus(id, status) {
  try {
    await apiFetch(`/donations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    const msgs = {
      approved:  'Donation approved — donor added & inventory updated ✓',
      rejected:  'Donation offer rejected',
      completed: 'Donation marked as completed',
    };
    toast(msgs[status] || `Status updated to ${status}`, 'success');
    const [donations, donors, inv] = await Promise.all([
      apiFetch('/donations/'), apiFetch('/donors/'), apiFetch('/inventory/')
    ]);
    allDonations = donations;
    renderDonations(allDonations);
    document.getElementById('stat-donors').textContent = donors.length;
    document.getElementById('stat-units').textContent  = inv.reduce((s, i) => s + i.units_available, 0);
    const donBadge = document.getElementById('donation-badge');
    if (donBadge) {
      const pendingDon = donations.filter(d => d.status === 'pending').length;
      donBadge.textContent = pendingDon;
      donBadge.style.display = pendingDon ? 'inline-flex' : 'none';
    }
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteDonation(id) {
  if (!confirm('Delete this donation offer?')) return;
  try {
    await apiFetch(`/donations/${id}`, { method: 'DELETE' });
    toast('Donation offer deleted', 'success');
    allDonations = await apiFetch('/donations/');
    renderDonations(allDonations);
  } catch (e) { toast(e.message, 'error'); }
}
