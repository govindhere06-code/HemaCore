let allDonors = [];
let allRequests = [];
let allDonations = [];
let allInventory = [];

const LOW_STOCK = 10;   // units at or below this count as low
const STATUS_COLORS = {
  pending: 'var(--amber-text)', approved: 'var(--green-text)', fulfilled: 'var(--blue-text)', rejected: 'var(--danger-text)', completed: 'var(--purple-text)',
};

const DONATION_GAP_DAYS = 56;

function stockLevel(units) {
  return units === 0 ? 'critical' : units <= LOW_STOCK ? 'low' : 'ok';
}

// ── FILTER HELPERS ────────────────────────────────────
const val = id => document.getElementById(id).value;

function matchText(q, ...fields) {
  q = q.trim().toLowerCase();
  return !q || fields.some(f => String(f ?? '').toLowerCase().includes(q));
}

// The API sends dates as HTTP date strings in GMT; the calendar day is the UTC day.
function dayOf(s) {
  return s ? new Date(s).toISOString().slice(0, 10) : '';
}

function inDateRange(s, from, to) {
  const d = dayOf(s);
  return (!from || d >= from) && (!to || d <= to);
}

function showCount(id, shown, total, noun) {
  document.getElementById(id).textContent =
    shown === total ? `${total} ${noun}` : `Showing ${shown} of ${total} ${noun}`;
}

function clearFilters(prefix) {
  document.querySelectorAll(`[id^="f-${prefix}-"]`).forEach(el => el.value = '');
  ({ donor: applyDonorFilters, req: applyRequestFilters, don: applyDonationFilters })[prefix]();
}

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
    saveToken(data.access_token);
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
  clearToken();
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
      clearToken();
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
  if (name === 'dashboard') loadDashboard();
  if (name === 'donors')    applyDonorFilters();
  if (name === 'inventory') loadInventory();
  if (name === 'requests')  applyRequestFilters();
  if (name === 'donations') applyDonationFilters();
}

function goTo(name) {
  showPage(name, document.querySelector(`.nav-item[onclick*="'${name}'"]`));
}

function setTopbarActions(page) {
  const el = document.getElementById('topbar-actions');
  const plusIcon = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  const actions = {
    donors:    `<button class="btn-sm btn-red" onclick="openDonorModal()">${plusIcon} Add Donor</button>`,
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
    allInventory = inv;

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

    renderStockChart(inv);
    renderAttention(inv, reqs, donations);
    renderStatusSplit(reqs);

    const recent = [...reqs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8);
    document.getElementById('recent-meta').textContent = `${reqs.length} total`;
    const tbody = document.getElementById('recent-body');
    tbody.innerHTML = recent.length
      ? recent.map(r => `<tr>
          <td>${esc(r.patient_name)}</td>
          <td><span class="badge badge-blood">${r.blood_type}</span></td>
          <td style="font-family:'DM Mono',monospace">${r.units}</td>
          <td>${esc(r.hospital)}</td>
          <td><span class="badge badge-${r.status}">${r.status}</span></td>
          <td style="color:var(--text-muted);font-size:12px">${fmtDate(r.created_at)}</td>
        </tr>`).join('')
      : `<tr><td colspan="6"><div class="empty-state"><p>No requests yet</p></div></td></tr>`;
  } catch (e) { toast('Failed to load: ' + e.message, 'error'); }
}

function renderStockChart(inv) {
  const max = Math.max(...inv.map(i => i.units_available), 1);
  const low = inv.filter(i => i.units_available <= LOW_STOCK).length;
  document.getElementById('stock-meta').textContent = low ? `${low} low` : 'All healthy';
  document.getElementById('stock-chart').innerHTML = inv.map(i => `
    <div class="stock-row">
      <span class="stock-type">${i.blood_type}</span>
      <div class="stock-track"><div class="stock-fill ${stockLevel(i.units_available)}" style="width:${Math.max(i.units_available / max * 100, 2)}%"></div></div>
      <span class="stock-num">${i.units_available}</span>
    </div>`).join('');
}

function renderAttention(inv, reqs, donations) {
  const items = [];
  inv.filter(i => i.units_available === 0).forEach(i =>
    items.push({ dot: 'red', text: `<strong>${i.blood_type}</strong> is out of stock`, page: 'inventory', btn: 'Restock' }));
  inv.filter(i => i.units_available > 0 && i.units_available <= LOW_STOCK).forEach(i =>
    items.push({ dot: 'amber', text: `<strong>${i.blood_type}</strong> is low — ${i.units_available} units left`, page: 'inventory', btn: 'Restock' }));

  const pendingReqs = reqs.filter(r => r.status === 'pending');
  if (pendingReqs.length) {
    const short = pendingReqs.filter(r => {
      const stock = inv.find(i => i.blood_type === r.blood_type);
      return !stock || stock.units_available < r.units;
    }).length;
    items.push({ dot: 'amber', text: `${pendingReqs.length} request${pendingReqs.length > 1 ? 's' : ''} awaiting approval`
      + (short ? ` <span style="color:var(--danger-text)">(${short} can't be met from stock)</span>` : ''), page: 'requests', btn: 'Review' });
  }
  const pendingDon = donations.filter(d => d.status === 'pending').length;
  if (pendingDon)
    items.push({ dot: 'green', text: `${pendingDon} donation offer${pendingDon > 1 ? 's' : ''} to review`, page: 'donations', btn: 'Review' });

  document.getElementById('attention-list').innerHTML = items.length
    ? items.map(it => `<div class="attn-item"><span class="attn-dot ${it.dot}"></span><span>${it.text}</span>
        <button class="action-btn" onclick="goTo('${it.page}')">${it.btn}</button></div>`).join('')
    : `<div class="attn-item"><span class="attn-dot green"></span><span>Nothing needs attention right now</span></div>`;
}

function renderStatusSplit(reqs) {
  const statuses = ['pending', 'approved', 'fulfilled', 'rejected'];
  const counts = statuses.map(s => reqs.filter(r => r.status === s).length);
  const total = reqs.length || 1;
  document.getElementById('status-split').innerHTML = statuses.map((s, i) =>
    `<div style="width:${counts[i] / total * 100}%;background:${STATUS_COLORS[s]}" title="${s}: ${counts[i]}"></div>`).join('');
  document.getElementById('status-legend').innerHTML = statuses.map((s, i) =>
    `<span style="--c:${STATUS_COLORS[s]}">${s[0].toUpperCase() + s.slice(1)} ${counts[i]}</span>`).join('');
}

// ── DONORS ────────────────────────────────────────────
function renderDonors(list) {
  const tbody = document.getElementById('donors-body');
  tbody.innerHTML = list.length
    ? list.map(d => `<tr>
        <td><strong>${esc(d.name)}</strong><span class="cell-sub">${esc(d.email || '—')}</span></td>
        <td><span class="badge badge-blood">${d.blood_type}</span></td>
        <td style="font-family:'DM Mono',monospace;font-size:13px">${esc(d.phone)}</td>
        <td style="color:var(--text-muted);font-size:13px">${fmtDate(d.last_donation_date)}</td>
        <td>${eligibilityBadge(d)}</td>
        <td>
          <button class="action-btn" onclick="viewDonor(${d.id})">View</button>
          <button class="action-btn" onclick="openDonorModal(${d.id})">Edit</button>
          <button class="action-btn danger" onclick="deleteDonor(${d.id})">Delete</button>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="6"><div class="empty-state"><p>${allDonors.length ? 'No donors match these filters' : 'No donors registered'}</p></div></td></tr>`;
}

function nextEligibleDate(d) {
  return d.last_donation_date
    ? new Date(new Date(d.last_donation_date).getTime() + DONATION_GAP_DAYS * 86400000)
    : null;
}

function isEligible(d) {
  const next = nextEligibleDate(d);
  return !next || next <= new Date();
}

function eligibilityBadge(d) {
  return isEligible(d)
    ? `<span class="badge badge-eligible">Eligible</span>`
    : `<span class="badge badge-waiting" title="Eligible from ${fmtDate(nextEligibleDate(d))}">From ${fmtDate(nextEligibleDate(d))}</span>`;
}

function ageFrom(dob) {
  if (!dob) return null;
  const b = new Date(dob), now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

// Donation offers are linked to donors by email (donor records have no user id)
function donorForOffer(o) {
  const email = (o.user_email || '').toLowerCase();
  return email ? allDonors.find(d => (d.email || '').toLowerCase() === email) : null;
}

function applyDonorFilters() {
  const q = val('f-donor-q'), blood = val('f-donor-blood'), elig = val('f-donor-elig');
  const list = allDonors.filter(d =>
    matchText(q, d.name, d.phone, d.email, d.address) &&
    (!blood || d.blood_type === blood) &&
    (!elig || isEligible(d) === (elig === 'yes'))
  );
  renderDonors(list);
  showCount('donor-count', list.length, allDonors.length, 'donors');
}

let editingDonorId = null;

// Opens the donor form empty (register) or filled in with an existing donor (edit)
function openDonorModal(id = null) {
  editingDonorId = id;
  const d = id ? allDonors.find(x => x.id === id) : {};
  const fields = { 'd-name': d.name, 'd-blood': d.blood_type, 'd-phone': d.phone, 'd-email': d.email,
    'd-dob': dayOf(d.date_of_birth), 'd-address': d.address, 'd-lastdon': dayOf(d.last_donation_date) };
  Object.entries(fields).forEach(([el, v]) => document.getElementById(el).value = v || '');
  document.getElementById('donor-modal-title').textContent = id ? 'Edit Donor' : 'Register Donor';
  document.getElementById('donor-modal-sub').textContent   = id ? `Update ${d.name}'s details` : 'Add a new blood donor to the system';
  document.getElementById('donor-modal-btn').textContent   = id ? 'Save Changes' : 'Register';
  openModal('modal-donor');
}

async function submitDonor() {
  const body = {
    name:               document.getElementById('d-name').value.trim(),
    blood_type:         document.getElementById('d-blood').value,
    phone:              document.getElementById('d-phone').value.trim(),
    email:              document.getElementById('d-email').value.trim() || null,
    date_of_birth:      document.getElementById('d-dob').value || null,
    address:            document.getElementById('d-address').value.trim() || null,
    last_donation_date: document.getElementById('d-lastdon').value || null,
  };
  if (!body.name || !body.blood_type || !body.phone) { toast('Name, blood type and phone required', 'error'); return; }
  try {
    if (editingDonorId) {
      await apiFetch(`/donors/${editingDonorId}`, { method: 'PUT', body: JSON.stringify(body) });
      toast('Donor updated', 'success');
    } else {
      await apiFetch('/donors/', { method: 'POST', body: JSON.stringify(body) });
      toast('Donor registered', 'success');
    }
    closeModal('modal-donor');
    allDonors = await apiFetch('/donors/');
    applyDonorFilters();
    document.getElementById('stat-donors').textContent = allDonors.length;
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteDonor(id) {
  if (!confirm('Delete this donor?')) return;
  try {
    await apiFetch(`/donors/${id}`, { method: 'DELETE' });
    toast('Donor deleted', 'success');
    allDonors = await apiFetch('/donors/');
    applyDonorFilters();
    document.getElementById('stat-donors').textContent = allDonors.length;
  } catch (e) { toast(e.message, 'error'); }
}

// ── INVENTORY ─────────────────────────────────────────
async function loadInventory() {
  try {
    allInventory = await apiFetch('/inventory/');
    renderInventory();
  } catch (e) { toast('Failed to load inventory', 'error'); }
}

function renderInventory() {
  const level = val('f-inv-level'), sort = val('f-inv-sort');
  let inv = allInventory.filter(i => !level || stockLevel(i.units_available) === level);
  if (sort) inv = [...inv].sort((a, b) => sort === 'asc' ? a.units_available - b.units_available : b.units_available - a.units_available);
  showCount('inv-count', inv.length, allInventory.length, 'blood types');
  const max = Math.max(...allInventory.map(i => i.units_available), 1);
  document.getElementById('inventory-grid').innerHTML = !inv.length
    ? `<div class="empty-state" style="grid-column:1/-1"><p>No blood types at this stock level</p></div>`
    : inv.map(i => {
      const pct = Math.round((i.units_available / max) * 100);
      const cls = stockLevel(i.units_available);
      return `<div class="inv-card">
        <div class="blood-type-label">${i.blood_type}</div>
        <div class="inv-units">${i.units_available}</div>
        <div class="inv-label">Units Available</div>
        <div class="inv-bar"><div class="inv-bar-fill ${cls}" style="width:${Math.max(pct,4)}%"></div></div>
      </div>`;
    }).join('');
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
        <td><strong>${esc(r.patient_name)}</strong><span class="cell-sub">by ${esc(r.requester_name || 'unknown user')}</span></td>
        <td><span class="badge badge-blood">${r.blood_type}</span></td>
        <td style="font-family:'DM Mono',monospace">${r.units}</td>
        <td>${esc(r.hospital)}</td>
        <td style="color:var(--text-muted);font-size:12px">${fmtDate(r.created_at)}</td>
        <td><span class="badge badge-${r.status}">${r.status}</span></td>
        <td>
          ${r.status === 'pending' ? `
            <button class="action-btn" onclick="updateStatus(${r.id},'approved')">Approve</button>
            <button class="action-btn danger" onclick="updateStatus(${r.id},'rejected')">Reject</button>` : ''}
          ${r.status === 'approved' ? `
            <button class="action-btn" onclick="updateStatus(${r.id},'fulfilled')">Fulfill</button>` : ''}
          <button class="action-btn" onclick="viewRequest(${r.id})">View</button>
          ${r.status === 'pending' ? `<button class="action-btn" onclick="openRequestEdit(${r.id})">Edit</button>` : ''}
          <button class="action-btn danger" onclick="deleteRequest(${r.id})">Delete</button>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="7"><div class="empty-state"><p>${allRequests.length ? 'No requests match these filters' : 'No requests found'}</p></div></td></tr>`;
}

function applyRequestFilters() {
  const q = val('f-req-q'), blood = val('f-req-blood'), status = val('f-req-status');
  const list = allRequests.filter(r =>
    matchText(q, r.patient_name, r.hospital, r.requester_name, r.requester_email) &&
    (!blood || r.blood_type === blood) &&
    (!status || r.status === status) &&
    inDateRange(r.created_at, val('f-req-from'), val('f-req-to'))
  );
  renderRequests(list);
  showCount('req-count', list.length, allRequests.length, 'requests');
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
    applyRequestFilters();
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
    applyRequestFilters();
  } catch (e) { toast(e.message, 'error'); }
}

// ── DONATIONS ─────────────────────────────────────────
function renderDonations(list) {
  const tbody = document.getElementById('donations-body');
  if (!tbody) return;
  tbody.innerHTML = list.length
    ? list.map(d => `<tr>
        <td><strong>${esc(d.user_name || `User #${d.user_id}`)}</strong><span class="cell-sub">${esc(offerPhone(d) || d.user_email || '')}</span></td>
        <td><span class="badge badge-blood">${d.blood_type}</span></td>
        <td style="font-family:'DM Mono',monospace">${d.units}</td>
        <td style="font-size:13px">${fmtDate(d.preferred_date)}<br><small style="color:var(--text-muted)">${esc(d.preferred_time || '')}</small></td>
        <td style="font-size:12px;color:var(--text-muted);max-width:140px">${esc(d.notes || '—')}</td>
        <td><span class="badge badge-${d.status}">${d.status}</span></td>
        <td>
          ${d.status === 'pending' ? `
            <button class="action-btn" onclick="updateDonationStatus(${d.id},'approved')">Approve</button>
            <button class="action-btn danger" onclick="updateDonationStatus(${d.id},'rejected')">Reject</button>` : ''}
          ${d.status === 'approved' ? `
            <button class="action-btn" onclick="updateDonationStatus(${d.id},'completed')">Complete</button>` : ''}
          <button class="action-btn" onclick="viewDonation(${d.id})">View</button>
          ${d.status === 'pending' || d.status === 'approved' ? `<button class="action-btn" onclick="openDonationEdit(${d.id})">Edit</button>` : ''}
          <button class="action-btn danger" onclick="deleteDonation(${d.id})">Delete</button>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="7"><div class="empty-state"><p>${allDonations.length ? 'No donation offers match these filters' : 'No donation offers found'}</p></div></td></tr>`;
}

function applyDonationFilters() {
  const q = val('f-don-q'), blood = val('f-don-blood'), status = val('f-don-status');
  const list = allDonations.filter(d =>
    matchText(q, d.user_name, d.user_email, offerPhone(d), d.notes, d.preferred_time) &&
    (!blood || d.blood_type === blood) &&
    (!status || d.status === status) &&
    inDateRange(d.preferred_date, val('f-don-from'), val('f-don-to'))
  );
  renderDonations(list);
  showCount('don-count', list.length, allDonations.length, 'offers');
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
    applyDonationFilters();
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
    applyDonationFilters();
  } catch (e) { toast(e.message, 'error'); }
}

// ── DETAIL VIEWS ──────────────────────────────────────
function offerPhone(o) {
  return o.user_phone || donorForOffer(o)?.phone || '';
}

function detailItem(label, value, full = false) {
  return `<div class="${full ? 'full' : ''}"><div class="detail-label">${label}</div><div class="detail-value">${value || '—'}</div></div>`;
}

function showDetail(html) {
  document.getElementById('detail-content').innerHTML = html;
  openModal('modal-detail');
}

function viewDonor(id) {
  const d = allDonors.find(x => x.id === id);
  if (!d) return;
  const age = ageFrom(d.date_of_birth);
  const next = nextEligibleDate(d);
  const email = (d.email || '').toLowerCase();
  const offers = email ? allDonations.filter(o => (o.user_email || '').toLowerCase() === email) : [];

  showDetail(`
    <div class="detail-head">
      <div class="detail-blood">${d.blood_type.replace("-", "−")}</div>
      <div><h3>${esc(d.name)}</h3>${eligibilityBadge(d)}</div>
    </div>
    <div class="detail-list">
      ${detailItem('Phone', esc(d.phone))}
      ${detailItem('Email', esc(d.email))}
      ${detailItem('Date of Birth', d.date_of_birth ? `${fmtDate(d.date_of_birth)} (${age} yrs)` : '')}
      ${detailItem('Registered On', fmtDate(d.created_at))}
      ${detailItem('Address', esc(d.address), true)}
      ${detailItem('Last Donation', d.last_donation_date ? fmtDate(d.last_donation_date) : 'Never donated')}
      ${detailItem('Next Eligible', next && next > new Date() ? fmtDate(next) : 'Now')}
    </div>
    <div class="detail-section">Donation Offers (${offers.length})</div>
    ${offers.length
      ? offers.map(o => `<div class="mini-row"><span class="badge badge-blood">${o.blood_type}</span>
          <span>${o.units} unit${o.units !== 1 ? 's' : ''} · ${fmtDate(o.preferred_date)} · ${esc(o.preferred_time || '')}</span>
          <span class="badge badge-${o.status}">${o.status}</span></div>`).join('')
      : `<p style="font-size:13px;color:var(--text-muted);margin:0">${d.email ? 'No donation offers from this donor’s account.' : 'No email on record, so offers can’t be linked.'}</p>`}
  `);
}

function viewRequest(id) {
  const r = allRequests.find(x => x.id === id);
  if (!r) return;
  const stock = allInventory.find(i => i.blood_type === r.blood_type)?.units_available ?? 0;
  let stockNote = '';
  if (r.status === 'pending') {
    stockNote = stock >= r.units
      ? `<div class="note-box ok">✓ Can be met from stock — ${stock} units of ${r.blood_type} available.</div>`
      : `<div class="note-box bad">✗ Not enough stock — needs ${r.units}, only ${stock} units of ${r.blood_type} available.</div>`;
  } else if (r.status === 'approved' || r.status === 'fulfilled') {
    stockNote = `<div class="note-box ok">${r.units} units were deducted from ${r.blood_type} stock on approval.</div>`;
  } else {
    stockNote = `<div class="note-box warn">This request was rejected — no stock was used.</div>`;
  }

  showDetail(`
    <div class="detail-head">
      <div class="detail-blood">${r.blood_type.replace("-", "−")}</div>
      <div><h3>${esc(r.patient_name)}</h3><span class="badge badge-${r.status}">${r.status}</span></div>
    </div>
    <div class="detail-list">
      ${detailItem('Hospital', esc(r.hospital))}
      ${detailItem('Units Required', r.units)}
      ${detailItem('Requested On', fmtDate(r.created_at))}
      ${detailItem('Request ID', '#' + r.id)}
    </div>
    <div class="detail-section">Requested By</div>
    <div class="detail-list" style="border-top:none;padding-top:0">
      ${detailItem('Name', esc(r.requester_name))}
      ${detailItem('Email', esc(r.requester_email))}
      ${detailItem('Phone', esc(r.requester_phone))}
    </div>
    <div class="detail-section">Stock Check</div>
    ${stockNote}
  `);
}

function viewDonation(id) {
  const o = allDonations.find(x => x.id === id);
  if (!o) return;
  const donor = donorForOffer(o);
  const others = allDonations.filter(x => x.user_id === o.user_id && x.id !== o.id);

  showDetail(`
    <div class="detail-head">
      <div class="detail-blood">${o.blood_type.replace("-", "−")}</div>
      <div><h3>${esc(o.user_name || `User #${o.user_id}`)}</h3><span class="badge badge-${o.status}">${o.status}</span></div>
    </div>
    <div class="detail-list">
      ${detailItem('Email', esc(o.user_email))}
      ${detailItem('Phone', esc(offerPhone(o)))}
      ${detailItem('Units Offered', o.units)}
      ${detailItem('Submitted On', fmtDate(o.created_at))}
      ${detailItem('Preferred Date', fmtDate(o.preferred_date))}
      ${detailItem('Preferred Time', esc(o.preferred_time))}
      ${detailItem('Notes', esc(o.notes), true)}
    </div>
    <div class="detail-section">Donor Record</div>
    ${donor
      ? `<div class="detail-list" style="border-top:none;padding-top:0">
          ${detailItem('Registered Blood Type', donor.blood_type + (donor.blood_type !== o.blood_type ? ' <span style="color:var(--danger-text)">(differs from offer)</span>' : ''))}
          ${detailItem('Last Donation', donor.last_donation_date ? fmtDate(donor.last_donation_date) : 'Never donated')}
          ${detailItem('Eligibility', eligibilityBadge(donor))}
          ${detailItem('Age', donor.date_of_birth ? ageFrom(donor.date_of_birth) + ' yrs' : '')}
        </div>`
      : `<div class="note-box warn">No donor record matches this user’s email yet.</div>`}
    <div class="detail-section">Other Offers From This User (${others.length})</div>
    ${others.length
      ? others.map(x => `<div class="mini-row"><span class="badge badge-blood">${x.blood_type}</span>
          <span>${x.units} unit${x.units !== 1 ? 's' : ''} · ${fmtDate(x.preferred_date)}</span>
          <span class="badge badge-${x.status}">${x.status}</span></div>`).join('')
      : `<p style="font-size:13px;color:var(--text-muted);margin:0">None</p>`}
  `);
}

// ── EDIT REQUESTS & DONATION OFFERS ───────────────────
let editingRequestId = null;
let editingDonationId = null;

function openRequestEdit(id) {
  const r = allRequests.find(x => x.id === id);
  if (!r) return;
  editingRequestId = id;
  document.getElementById('er-patient').value  = r.patient_name;
  document.getElementById('er-hospital').value = r.hospital;
  document.getElementById('er-blood').value    = r.blood_type;
  document.getElementById('er-units').value    = r.units;
  openModal('modal-edit-request');
}

async function submitRequestEdit() {
  const body = {
    patient_name: document.getElementById('er-patient').value.trim(),
    hospital:     document.getElementById('er-hospital').value.trim(),
    blood_type:   document.getElementById('er-blood').value,
    units:        parseInt(document.getElementById('er-units').value),
  };
  if (!body.patient_name || !body.hospital || !(body.units > 0)) { toast('Patient, hospital and units are required', 'error'); return; }
  try {
    await apiFetch(`/requests/${editingRequestId}`, { method: 'PUT', body: JSON.stringify(body) });
    toast('Request updated', 'success');
    closeModal('modal-edit-request');
    allRequests = await apiFetch('/requests/');
    applyRequestFilters();
  } catch (e) { toast(e.message, 'error'); }
}

function openDonationEdit(id) {
  const d = allDonations.find(x => x.id === id);
  if (!d) return;
  editingDonationId = id;
  const approved = d.status === 'approved';
  document.getElementById('ed-blood').value = d.blood_type;
  document.getElementById('ed-units').value = d.units;
  document.getElementById('ed-date').value  = dayOf(d.preferred_date);
  setSelectValue('ed-time', d.preferred_time);
  document.getElementById('ed-notes').value = d.notes || '';
  // Approval already added these units to stock, so lock them
  document.getElementById('ed-blood').disabled = approved;
  document.getElementById('ed-units').disabled = approved;
  document.getElementById('ed-sub').textContent = approved
    ? 'Already approved — stock was updated, so only the schedule and notes can change.'
    : 'Change the offer details or reschedule it.';
  openModal('modal-edit-donation');
}

async function submitDonationEdit() {
  const body = {
    blood_type:     document.getElementById('ed-blood').value,
    units:          parseInt(document.getElementById('ed-units').value),
    preferred_date: document.getElementById('ed-date').value,
    preferred_time: document.getElementById('ed-time').value,
    notes:          document.getElementById('ed-notes').value.trim(),
  };
  if (!(body.units > 0) || !body.preferred_date || !body.preferred_time) { toast('Units, date and time are required', 'error'); return; }
  try {
    await apiFetch(`/donations/${editingDonationId}`, { method: 'PUT', body: JSON.stringify(body) });
    toast('Donation offer updated', 'success');
    closeModal('modal-edit-donation');
    allDonations = await apiFetch('/donations/');
    applyDonationFilters();
  } catch (e) { toast(e.message, 'error'); }
}
