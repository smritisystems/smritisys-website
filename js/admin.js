/**
 * @file        admin.js
 * @project     PrathamOne EduOS Coaching Institute Management System
 * @module      SMRITISYS admin portal
 *
 * @author      Jawahar R. Mallah
 * @organization AITDL (AI Technology & Development Lab)
 * @client      Prashant Academy Coaching Institute
 * @copyright   Copyright (c) 2026 AITDL
 * @license     Proprietary
 *
 * @version     1.0.0
 * @created     2026-11-06
 * @updated     2026-11-15
 *
 * @description Manages the authenticated admin workspace, organization relationships, invitations, and licenses.
 */
const adminState = {
  token: null,
  announcements: [],
  products: [],
  licenses: [],
  registrationPage: 1,
  registrationRequestId: 0,
  organizations: [],
  partners: [],
  licenseBatchCodes: null,
  licenseCodeBatchId: null,
};
const admin$ = (selector) => document.querySelector(selector);
const admin$$ = (selector) => [...document.querySelectorAll(selector)];
let licenseCodeRevealTimer = null;
let licenseCodeRevealRequestId = 0;
let licenseCodeRestoreRequestId = 0;

function adminEscape(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

async function adminApi(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (adminState.token) headers.Authorization = `Bearer ${adminState.token}`;
  const response = await fetch(`/api/${path}`, { ...options, headers, credentials: 'same-origin' });
  const data = await response.json().catch(() => ({ error: 'Invalid server response' }));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

function adminMessage(element, text, ok) {
  if (!element) return;
  element.textContent = text;
  element.style.color = ok ? 'var(--turquoise)' : 'var(--red)';
}

function clearCustomerInviteLink() {
  const link = admin$('#customerInviteLink');
  if (link) link.value = '';
  admin$('#customerInviteResult')?.classList.add('hidden');
  const partnerLink = admin$('#partnerInviteLink');
  if (partnerLink) partnerLink.value = '';
  admin$('#partnerInviteResult')?.classList.add('hidden');
  adminState.licenseBatchCodes = null;
  admin$('#licenseBatchDownload')?.classList.add('hidden');
}

function showAdminLogin(message = '') {
  const revealDialog = admin$('#licenseCodeRevealDialog');
  if (revealDialog?.open) revealDialog.close();
  clearCustomerInviteLink();
  admin$('#adminPortalView').classList.add('hidden');
  admin$('#adminLoginView').classList.remove('hidden');
  adminMessage(admin$('#adminLoginMessage'), message, false);
}

function showAdminPortal() {
  admin$('#adminLoginView').classList.add('hidden');
  admin$('#adminPortalView').classList.remove('hidden');
  loadAdminWorkspace();
}

function adminStatePanel(stateId, listId, text, error = false) {
  const state = admin$(`#${stateId}`);
  state.className = `state-panel${error ? ' error-state' : ''}`;
  state.textContent = text;
  if (listId) admin$(`#${listId}`).classList.add('hidden');
}

async function loadAdminOverview() {
  const error = admin$('#adminError');
  error.classList.add('hidden');
  try {
    const data = await adminApi('admin/overview');
    const labels = {
      users: 'Staff users',
      customers: 'Customer accounts',
      organizations: 'Organizations',
      products: 'Active products',
      licenses: 'Total licenses',
    };
    admin$('#adminMetrics').innerHTML = Object.entries(labels).map(([key, label]) => `
      <article class="card">
        <span class="stat-label">${adminEscape(label)}</span>
        <strong class="stat-value">${adminEscape(Number(data.metrics[key] || 0).toLocaleString())}</strong>
      </article>
    `).join('');

    const statusCounts = data.license_statuses || {};
    const activeLicenses = Number(statusCounts.active || 0);
    const expiringSoon = Number(data.expiring_soon || 0);
    const codeInventory = data.code_inventory || {};
    const operations = [
      { label: 'Active licenses', value: activeLicenses, note: 'Currently active in the authority' },
      { label: 'Expiring soon', value: expiringSoon, note: 'Within the next 30 days' },
      { label: 'Codes available', value: Number(codeInventory.available || 0), note: 'Not yet claimed' },
      { label: 'Awaiting delivery', value: Number(codeInventory.pending_delivery || 0), note: 'Available codes not yet issued' },
    ];
    admin$('#adminOperationsMetrics').innerHTML = operations.map((metric) => `
      <article class="card admin-ops-card">
        <span class="stat-label">${adminEscape(metric.label)}</span>
        <strong class="stat-value">${adminEscape(metric.value.toLocaleString())}</strong>
        <span class="admin-metric-note">${adminEscape(metric.note)}</span>
      </article>
    `).join('');

    const statusOrder = ['active', 'draft', 'pending_renewal', 'expired', 'suspended', 'revoked', 'cancelled'];
    const statuses = [...new Set([...statusOrder.filter((status) => status in statusCounts), ...Object.keys(statusCounts)])];
    admin$('#adminLicenseHealth').innerHTML = statuses.length
      ? statuses.map((status) => `
        <div class="admin-health-row">
          <span>${adminEscape(status.replaceAll('_', ' '))}</span>
          <strong>${adminEscape(Number(statusCounts[status] || 0).toLocaleString())}</strong>
        </div>
      `).join('')
      : '<p class="admin-empty-inline">No license status records are available.</p>';

    const activity = Array.isArray(data.recent_activity) ? data.recent_activity : [];
    admin$('#adminRecentActivity').innerHTML = activity.length
      ? activity.map((event) => {
        const resource = [event.resource_type, event.resource_id].filter(Boolean).join(' · ');
        const action = String(event.action || 'Activity')
          .replaceAll('_', ' ')
          .toLowerCase()
          .replace(/(^\w|\s\w)/g, (letter) => letter.toUpperCase());
        return `<article class="admin-activity-item">
          <strong>${adminEscape(action)}</strong>
          <time>${adminEscape(adminFormatDateTime(event.created_at))}</time>
          <small>${adminEscape(event.actor_name || 'System')}</small>
          <span class="admin-activity-meta">${adminEscape([resource, event.organization_name].filter(Boolean).join(' · ') || 'Control plane')}</span>
        </article>`;
      }).join('')
      : '<p class="admin-empty-inline">No recent activity has been recorded.</p>';
    admin$('#adminOverviewUpdated').textContent = `Refreshed ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    void loadAdminD1Operations();
  } catch (loadError) {
    error.textContent = `Dashboard data could not be loaded: ${loadError.message}`;
    error.className = 'state-panel error-state';
  }
}

function adminFormatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = -1;
  do {
    size /= 1000;
    unitIndex += 1;
  } while (size >= 1000 && unitIndex < units.length - 1);
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function adminD1UsageState(percent) {
  if (percent >= 90) return { label: 'Critical', className: 'critical' };
  if (percent >= 75) return { label: 'Warning', className: 'warning' };
  return { label: 'Healthy', className: '' };
}

function adminD1Percent(bytes, limit) {
  return limit > 0 ? Math.max(0, (Number(bytes) || 0) / limit * 100) : 0;
}

function adminD1FullEstimate(samples, limit) {
  if (samples.length < 2) return 'Not enough data';
  const first = samples[0];
  const last = samples[samples.length - 1];
  const elapsedDays = (Date.parse(last.sampled_at) - Date.parse(first.sampled_at)) / 86400000;
  if (!Number.isFinite(elapsedDays) || elapsedDays < 1) return 'Not enough data';
  const growthPerDay = (Number(last.size_bytes) - Number(first.size_bytes)) / elapsedDays;
  if (!Number.isFinite(growthPerDay)) return 'Not enough data';
  if (growthPerDay <= 0) return 'No growth observed';
  const remainingDays = (limit - Number(last.size_bytes)) / growthPerDay;
  if (remainingDays <= 0) return 'At or over limit';
  return `About ${Math.ceil(remainingDays).toLocaleString()} days`;
}

function adminD1AccountFullEstimate(byDatabase, databaseNames, limit) {
  if (!databaseNames.length) return 'Not enough data';
  const samplesByDay = new Map();
  for (const [databaseName, rows] of byDatabase.entries()) {
    for (const row of rows) {
      const date = String(row.sampled_at).slice(0, 10);
      if (!samplesByDay.has(date)) samplesByDay.set(date, new Map());
      const dailySamples = samplesByDay.get(date);
      const current = dailySamples.get(databaseName);
      if (!current || Date.parse(row.sampled_at) > Date.parse(current.sampled_at)) {
        dailySamples.set(databaseName, row);
      }
    }
  }
  const completeDays = [...samplesByDay.values()]
    .filter((dailySamples) => databaseNames.every((name) => dailySamples.has(name)))
    .map((dailySamples) => {
      const rows = [...dailySamples.values()];
      return {
        sampled_at: rows.reduce((latest, row) => Date.parse(row.sampled_at) > Date.parse(latest) ? row.sampled_at : latest, rows[0].sampled_at),
        size_bytes: rows.reduce((total, row) => total + (Number(row.size_bytes) || 0), 0),
      };
    })
    .sort((a, b) => Date.parse(a.sampled_at) - Date.parse(b.sampled_at));
  return adminD1FullEstimate(completeDays, limit);
}

async function loadAdminD1Operations() {
  const state = admin$('#adminD1State');
  const content = admin$('#adminD1Content');
  state.className = 'state-panel';
  state.textContent = 'Loading D1 capacity monitoring...';
  content.classList.add('hidden');
  try {
    const data = await adminApi('admin/d1-operations');
    const snapshots = Array.isArray(data.snapshots) ? data.snapshots : [];
    const limits = data.limits || {};
    const databases = Array.isArray(data.databases) ? data.databases : [];
    const byDatabase = new Map(databases.map((name) => [name, []]));
    for (const snapshot of snapshots) {
      if (!byDatabase.has(snapshot.database_name)) byDatabase.set(snapshot.database_name, []);
      byDatabase.get(snapshot.database_name).push(snapshot);
    }
    for (const rows of byDatabase.values()) {
      rows.sort((a, b) => Date.parse(a.sampled_at) - Date.parse(b.sampled_at));
    }
    const latestRows = [...byDatabase.entries()]
      .filter(([, rows]) => rows.length)
      .map(([, rows]) => rows[rows.length - 1]);
    const totalBytes = latestRows.reduce((sum, row) => sum + Number(row.size_bytes || 0), 0);
    const hasCompleteAccountSample = latestRows.length === databases.length;
    const accountFreePercent = adminD1Percent(totalBytes, Number(limits.free_account_bytes));
    const accountPaidPercent = adminD1Percent(totalBytes, Number(limits.paid_account_bytes));
    const accountFreeEstimate = adminD1AccountFullEstimate(byDatabase, databases, Number(limits.free_account_bytes));
    const accountPaidEstimate = adminD1AccountFullEstimate(byDatabase, databases, Number(limits.paid_account_bytes));
    const freeState = adminD1UsageState(accountFreePercent);
    const paidState = adminD1UsageState(accountPaidPercent);

    admin$('#adminD1Summary').innerHTML = `
      <article class="card admin-ops-card">
        <span class="stat-label">${databases.length === 1 ? 'Monitored database' : 'Monitored databases'}</span>
        <strong class="stat-value">${adminEscape(databases.length)}</strong>
        <span class="admin-metric-note">Account max: Free ${adminEscape(Number(limits.free_databases_per_account).toLocaleString())} / Paid ${adminEscape(Number(limits.paid_databases_per_account).toLocaleString())}</span>
      </article>
      <article class="card admin-ops-card">
        <span class="stat-label">Database size</span>
        <strong class="stat-value">${adminEscape(hasCompleteAccountSample ? adminFormatBytes(totalBytes) : 'Pending')}</strong>
        <span class="admin-metric-note">${adminEscape(latestRows.length)} of ${adminEscape(databases.length)} ${databases.length === 1 ? 'database' : 'databases'} sampled</span>
      </article>
      <article class="card admin-ops-card">
        <span class="stat-label">Free plan account cap</span>
        <strong class="stat-value">${adminEscape(hasCompleteAccountSample ? `${accountFreePercent.toFixed(2)}%` : 'Pending')}</strong>
        <span class="admin-metric-note">${adminEscape(hasCompleteAccountSample ? adminFormatBytes(totalBytes) : 'Incomplete sample')} / ${adminEscape(adminFormatBytes(limits.free_account_bytes))} · <span class="admin-d1-status ${hasCompleteAccountSample ? freeState.className : ''}">${adminEscape(hasCompleteAccountSample ? freeState.label : 'Waiting')}</span></span>
        <span class="admin-metric-note">Estimated to cap: ${adminEscape(hasCompleteAccountSample ? accountFreeEstimate : 'Pending')}</span>
      </article>
      <article class="card admin-ops-card">
        <span class="stat-label">Paid plan account cap</span>
        <strong class="stat-value">${adminEscape(hasCompleteAccountSample ? `${accountPaidPercent.toFixed(2)}%` : 'Pending')}</strong>
        <span class="admin-metric-note">${adminEscape(hasCompleteAccountSample ? adminFormatBytes(totalBytes) : 'Incomplete sample')} / ${adminEscape(adminFormatBytes(limits.paid_account_bytes))} · <span class="admin-d1-status ${hasCompleteAccountSample ? paidState.className : ''}">${adminEscape(hasCompleteAccountSample ? paidState.label : 'Waiting')}</span></span>
        <span class="admin-metric-note">Estimated to cap: ${adminEscape(hasCompleteAccountSample ? accountPaidEstimate : 'Pending')}</span>
      </article>`;

    admin$('#adminD1Databases').innerHTML = databases.map((name) => {
      const rows = byDatabase.get(name) || [];
      const latest = rows[rows.length - 1];
      if (!latest) {
        return `<article class="card admin-d1-card"><h4>${adminEscape(name)}</h4><p>Waiting for the first scheduled size sample.</p></article>`;
      }
      const size = Number(latest.size_bytes) || 0;
      const freePercent = adminD1Percent(size, Number(limits.free_per_database_bytes));
      const paidPercent = adminD1Percent(size, Number(limits.paid_per_database_bytes));
      const freeStatus = adminD1UsageState(freePercent);
      const paidStatus = adminD1UsageState(paidPercent);
      const freeEstimate = adminD1FullEstimate(rows, Number(limits.free_per_database_bytes));
      const paidEstimate = adminD1FullEstimate(rows, Number(limits.paid_per_database_bytes));
      const meterClass = freeStatus.className;
      return `<article class="card admin-d1-card">
        <h4>${adminEscape(name)}</h4>
        <p>Latest sample: <strong>${adminEscape(adminFormatBytes(size))}</strong> · ${adminEscape(adminFormatDateTime(latest.sampled_at))}</p>
        <div class="admin-d1-meter" role="img" aria-label="Free plan usage ${adminEscape(freePercent.toFixed(2))} percent">
          <span class="${meterClass}" style="width:${Math.min(100, freePercent).toFixed(2)}%"></span>
        </div>
        <p>Free: ${adminEscape(freePercent.toFixed(2))}% of ${adminEscape(adminFormatBytes(limits.free_per_database_bytes))} · <span class="admin-d1-status ${freeStatus.className}">${adminEscape(freeStatus.label)}</span></p>
        <p>Paid: ${adminEscape(paidPercent.toFixed(2))}% of ${adminEscape(adminFormatBytes(limits.paid_per_database_bytes))} · <span class="admin-d1-status ${paidStatus.className}">${adminEscape(paidStatus.label)}</span></p>
        <div class="admin-d1-estimates">
          <div><small>Estimate at Free limit</small><strong>${adminEscape(freeEstimate)}</strong></div>
          <div><small>Estimate at Paid limit</small><strong>${adminEscape(paidEstimate)}</strong></div>
        </div>
      </article>`;
    }).join('');

    const historyRows = snapshots
      .slice()
      .sort((a, b) => Date.parse(b.sampled_at) - Date.parse(a.sampled_at))
      .map((row) => `<tr><td>${adminEscape(row.database_name)}</td><td>${adminEscape(adminFormatDateTime(row.sampled_at))}</td><td>${adminEscape(adminFormatBytes(row.size_bytes))}</td></tr>`)
      .join('');
    admin$('#adminD1History').innerHTML = historyRows
      ? `<table class="admin-table"><thead><tr><th>Database</th><th>Sampled</th><th>Size</th></tr></thead><tbody>${historyRows}</tbody></table>`
      : '<p class="admin-empty-inline">No storage samples are available yet.</p>';

    admin$('#adminD1Backups').innerHTML = data.backup_status === 'disabled'
      ? '<p class="admin-empty-inline">Automated backups are disabled. No backups or restore points are being created.</p>'
      : '<p class="admin-empty-inline">Backup status is unavailable.</p>';

    state.classList.add('hidden');
    content.classList.remove('hidden');
  } catch (loadError) {
    state.textContent = `D1 monitoring data could not be loaded: ${loadError.message}`;
    state.className = 'state-panel error-state';
  }
}

function adminFormatDateTime(value) {
  if (!value) return 'Time unavailable';
  const normalized = String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function loadAdminUsers() {
  try {
    const data = await adminApi('admin/users');
    const list = admin$('#adminUsersList');
    const state = admin$('#adminUsersState');
    if (!data.users.length) return adminStatePanel('adminUsersState', 'adminUsersList', 'No staff users found.');
    state.classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = data.users.map((user) => `<article class="admin-user"><div><strong>${adminEscape(user.name || 'Unnamed user')}</strong><small>${adminEscape(user.email)}</small></div><span class="status">${adminEscape(user.status)}</span><select data-admin-role="${user.id}" aria-label="Role for ${adminEscape(user.email)}"><option value="staff" ${user.role === 'staff' ? 'selected' : ''}>Staff</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option><option value="super_admin" ${user.role === 'super_admin' ? 'selected' : ''}>Super admin</option></select><button class="text-button" data-admin-save="${user.id}">Save</button></article>`).join('');
    list.querySelectorAll('[data-admin-save]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await adminApi(`admin/users/${button.dataset.adminSave}`, { method: 'PATCH', body: JSON.stringify({ role: list.querySelector(`[data-admin-role="${button.dataset.adminSave}"]`).value }) });
        await loadAdminUsers();
      } catch (error) {
        adminMessage(admin$('#adminError'), error.message, false);
        admin$('#adminError').className = 'state-panel error-state';
      } finally { button.disabled = false; }
    }));
  } catch (error) { adminStatePanel('adminUsersState', 'adminUsersList', error.status === 403 ? 'Super admin access required.' : 'Users are unavailable.', true); }
}

async function loadAdminOrganizations() {
  try {
    const data = await adminApi('admin/organizations');
    adminState.organizations = data.organizations || [];
    populateOrganizationSelectors();
    if (!data.organizations.length) return adminStatePanel('adminOrganizationsState', 'adminOrganizationsList', 'No organizations found.');
    admin$('#adminOrganizationsState').classList.add('hidden');
    const list = admin$('#adminOrganizationsList');
    list.classList.remove('hidden');
    list.innerHTML = `<table class="admin-table"><thead><tr><th>Organization</th><th>Legal name</th><th>Relationships</th><th>Status</th><th>Members</th></tr></thead><tbody>${data.organizations.map((organization) => `<tr><td>${adminEscape(organization.name)}</td><td>${adminEscape(organization.legal_name || 'Not provided')}</td><td>${adminEscape((organization.relationship_types || '').split(',').filter(Boolean).join(', ') || 'Unclassified')}</td><td><span class="status">${adminEscape(organization.status)}</span></td><td>${adminEscape(organization.member_count)}</td></tr>`).join('')}</tbody></table>`;
  } catch (error) { adminStatePanel('adminOrganizationsState', 'adminOrganizationsList', 'Organizations are unavailable.', true); }
}

function populateOrganizationSelectors() {
  const selectableOrganizations = adminState.organizations.filter((organization) =>
    organization.status === 'active' && organization.name.trim().toLowerCase() !== 'smritisys internal');
  const customerSelect = admin$('#customerInviteOrganization');
  const selectedCustomerOrganization = customerSelect.value;
  customerSelect.innerHTML = `<option value="">Create a new organization</option>${selectableOrganizations.map((organization) => `<option value="${adminEscape(organization.id)}">${adminEscape(organization.name)}${organization.legal_name && organization.legal_name !== organization.name ? ` — ${adminEscape(organization.legal_name)}` : ''}</option>`).join('')}`;
  if ([...customerSelect.options].some((option) => option.value === selectedCustomerOrganization)) customerSelect.value = selectedCustomerOrganization;
  const partnerSelect = admin$('#partnerContactOrganization');
  const selectedPartnerOrganization = partnerSelect.value;
  const partnerOrganizations = selectableOrganizations.filter((organization) =>
    !(organization.relationship_types || '').split(',').some((type) => type.trim() === 'customer'));
  partnerSelect.innerHTML = `<option value="">Create a new partner organization</option>${partnerOrganizations.map((organization) => `<option value="${adminEscape(organization.id)}">${adminEscape(organization.name)}${organization.relationship_types ? ` · ${adminEscape(organization.relationship_types.replace(/,/g, ', '))}` : ''}</option>`).join('')}`;
  if ([...partnerSelect.options].some((option) => option.value === selectedPartnerOrganization)) partnerSelect.value = selectedPartnerOrganization;
  updateCustomerInviteOrganizationFields();
  updatePartnerOrganizationFields();
}

function updateCustomerInviteOrganizationFields() {
  const hasOrganization = Boolean(admin$('#customerInviteOrganization').value);
  const company = admin$('#customerInviteCompany');
  admin$('#customerInviteCompanyWrap').classList.toggle('hidden', hasOrganization);
  company.required = !hasOrganization;
  company.disabled = hasOrganization;
}

function updatePartnerOrganizationFields() {
  const hasOrganization = Boolean(admin$('#partnerContactOrganization').value);
  const name = admin$('#partnerOrganizationName');
  admin$('#partnerOrganizationNameWrap').classList.toggle('hidden', hasOrganization);
  name.required = !hasOrganization;
  name.disabled = hasOrganization;
}

async function loadAdminCustomerInvites() {
  try {
    const data = await adminApi('admin/customer-invites');
    const list = admin$('#adminCustomerInvitesList');
    if (!data.invites.length) return adminStatePanel('adminCustomerInvitesState', 'adminCustomerInvitesList', 'No customer invitations found.');
    admin$('#adminCustomerInvitesState').classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = `<table class="admin-table"><thead><tr><th>Email</th><th>Organization</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead><tbody>${data.invites.map((invite) => `<tr><td>${adminEscape(invite.email)}</td><td>${adminEscape(invite.company)}</td><td><span class="status">${adminEscape(invite.status)}</span></td><td>${adminEscape(invite.expires_at)}</td><td>${invite.status === 'pending' ? `<button class="text-button" type="button" data-customer-invite-revoke="${adminEscape(invite.id)}">Revoke</button>` : '—'}</td></tr>`).join('')}</tbody></table>`;
    list.querySelectorAll('[data-customer-invite-revoke]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Revoke this setup invitation? The link will stop working.')) return;
      button.disabled = true;
      try {
        await adminApi(`admin/customer-invites/${button.dataset.customerInviteRevoke}/revoke`, { method: 'POST', body: '{}' });
        await loadAdminCustomerInvites();
      } catch (error) {
        adminMessage(admin$('#adminError'), error.message, false);
        admin$('#adminError').className = 'state-panel error-state';
        button.disabled = false;
      }
    }));
  } catch (error) {
    adminStatePanel('adminCustomerInvitesState', 'adminCustomerInvitesList', 'Customer invitations are unavailable.', true);
  }
}

async function loadAdminPartners() {
  try {
    const data = await adminApi('admin/partners');
    adminState.partners = data.partners || [];
    const partnerSelect = admin$('#partnerLinkPartner');
    partnerSelect.innerHTML = adminState.partners
      .filter((partner) => partner.status === 'active')
      .map((partner) => `<option value="${adminEscape(partner.id)}">${adminEscape(partner.name)} · ${adminEscape(partner.partner_type)}</option>`)
      .join('');
    if (!partnerSelect.options.length) partnerSelect.innerHTML = '<option value="">No active partners</option>';
    const customerOrganizations = adminState.organizations.filter((organization) =>
      organization.status === 'active' &&
      organization.name.trim().toLowerCase() !== 'smritisys internal' &&
      (organization.relationship_types || '').split(',').includes('customer'));
    const customerSelect = admin$('#partnerLinkCustomer');
    customerSelect.innerHTML = customerOrganizations
      .map((organization) => `<option value="${adminEscape(organization.id)}">${adminEscape(organization.name)}</option>`)
      .join('');
    if (!customerSelect.options.length) customerSelect.innerHTML = '<option value="">No customer organizations</option>';

    const state = admin$('#adminPartnersState');
    const list = admin$('#adminPartnersList');
    if (!adminState.partners.length) {
      adminStatePanel('adminPartnersState', 'adminPartnersList', 'No partner organizations found.');
    } else {
      state.classList.add('hidden');
      list.classList.remove('hidden');
      list.innerHTML = `<h3>Partner organizations</h3><table class="admin-table"><thead><tr><th>Organization</th><th>Type</th><th>Members</th><th>Customer links</th><th>Pending invites</th></tr></thead><tbody>${adminState.partners.map((partner) => `<tr><td>${adminEscape(partner.name)}</td><td>${adminEscape(partner.partner_type)}</td><td>${adminEscape(partner.member_count)}</td><td>${adminEscape(partner.linked_customer_count)}</td><td>${adminEscape(partner.pending_invite_count)}</td></tr>`).join('')}</tbody></table><h3>Customer links</h3>${data.links.length ? `<table class="admin-table"><thead><tr><th>Partner</th><th>Customer</th><th>Status</th><th>Action</th></tr></thead><tbody>${data.links.map((link) => `<tr><td>${adminEscape(link.partner_name)}</td><td>${adminEscape(link.customer_name)}</td><td><span class="status">${adminEscape(link.status)}</span></td><td>${link.status === 'active' ? `<button class="text-button" type="button" data-partner-link-revoke="${adminEscape(link.partner_organization_id)}:${adminEscape(link.customer_organization_id)}">Unlink</button>` : '—'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No customer links recorded.</p>'}`;
      list.querySelectorAll('[data-partner-link-revoke]').forEach((button) => button.addEventListener('click', async () => {
        if (!window.confirm('Revoke this partner-to-customer link?')) return;
        const [partnerId, customerId] = button.dataset.partnerLinkRevoke.split(':');
        button.disabled = true;
        try {
          await adminApi(`admin/partners/${partnerId}/customers/${customerId}/revoke`, { method: 'POST', body: '{}' });
          await loadAdminPartners();
        } catch (error) {
          adminMessage(admin$('#adminError'), error.message, false);
          admin$('#adminError').className = 'state-panel error-state';
          button.disabled = false;
        }
      }));
    }
    await loadAdminPartnerInvites();
  } catch (error) {
    adminStatePanel('adminPartnersState', 'adminPartnersList', 'Partner organizations are unavailable.', true);
  }
}

async function loadAdminPartnerInvites() {
  try {
    const data = await adminApi('admin/partner-invites');
    const list = admin$('#adminPartnerInvitesList');
    if (!data.invites.length) return adminStatePanel('adminPartnerInvitesState', 'adminPartnerInvitesList', 'No partner invitations found.');
    admin$('#adminPartnerInvitesState').classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = `<table class="admin-table"><thead><tr><th>Email</th><th>Partner</th><th>Type / role</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead><tbody>${data.invites.map((invite) => `<tr><td>${adminEscape(invite.email)}</td><td>${adminEscape(invite.partner_name)}</td><td>${adminEscape(invite.partner_type)} · ${adminEscape(invite.partner_role)}</td><td><span class="status">${adminEscape(invite.status)}</span></td><td>${adminEscape(invite.expires_at)}</td><td>${invite.status === 'pending' ? `<button class="text-button" type="button" data-partner-invite-revoke="${adminEscape(invite.id)}">Revoke</button>` : '—'}</td></tr>`).join('')}</tbody></table>`;
    list.querySelectorAll('[data-partner-invite-revoke]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Revoke this partner setup invitation?')) return;
      button.disabled = true;
      try {
        await adminApi(`admin/partner-invites/${button.dataset.partnerInviteRevoke}/revoke`, { method: 'POST', body: '{}' });
        await loadAdminPartnerInvites();
      } catch (error) {
        adminMessage(admin$('#adminError'), error.message, false);
        admin$('#adminError').className = 'state-panel error-state';
        button.disabled = false;
      }
    }));
  } catch (error) {
    adminStatePanel('adminPartnerInvitesState', 'adminPartnerInvitesList', 'Partner invitations are unavailable.', true);
  }
}

async function loadAdminProducts() {
  try {
    const [products, licenses, organizations, batches] = await Promise.all([
      adminApi('products'),
      adminApi('licenses'),
      adminApi('admin/organizations'),
      adminApi('licenses/batches'),
    ]);
    adminState.products = products.products;
    adminState.licenses = licenses.licenses;
    adminState.organizations = organizations.organizations;
    renderLicenseBatches(batches.batches || []);
    admin$('#adminProductsState').classList.add('hidden');
    const activeLicenses = licenses.licenses.filter((license) => String(license.status).toLowerCase() === 'active').length;
    const customerOrganizations = organizations.organizations.filter((organization) =>
      organization.status === 'active' && organization.name.trim().toLowerCase() !== 'smritisys internal');
    admin$('#adminProductsList').innerHTML = `
      <article class="card"><span class="stat-label">Products</span><strong class="stat-value">${adminEscape(products.products.length)}</strong><span class="admin-metric-note">${adminEscape(products.products.filter((product) => product.status === 'active').length)} active in catalog</span></article>
      <article class="card"><span class="stat-label">Licenses</span><strong class="stat-value">${adminEscape(licenses.licenses.length)}</strong><span class="admin-metric-note">${adminEscape(activeLicenses)} currently active</span></article>
      <article class="card"><span class="stat-label">Customer organizations</span><strong class="stat-value">${adminEscape(customerOrganizations.length)}</strong><span class="admin-metric-note">Active customer relationships</span></article>
      ${products.products.map((product) => `<article class="card"><span class="eyebrow">${adminEscape(product.code)}</span><h3>${adminEscape(product.name)}</h3><span class="status">${adminEscape(product.status)}</span></article>`).join('')}
    `;
    const activeProducts = products.products.filter((product) => product.status === 'active');
    const productOptions = activeProducts.map((product) => `<option value="${adminEscape(product.id)}">${adminEscape(product.name)} (${adminEscape(product.code)})</option>`).join('');
    admin$('#licenseProduct').innerHTML = productOptions;
    admin$('#licenseBatchProduct').innerHTML = productOptions;
    admin$('#licensePolicyProduct').innerHTML = productOptions;
    const activeOrganizations = organizations.organizations.filter((organization) =>
      organization.status === 'active' && organization.name.trim().toLowerCase() !== 'smritisys internal');
    admin$('#licenseOrganization').innerHTML = activeOrganizations.map((organization) => `<option value="${adminEscape(organization.id)}">${adminEscape(organization.name)}${organization.legal_name ? ` — ${adminEscape(organization.legal_name)}` : ''}</option>`).join('');
    admin$('#licenseStartDate').value ||= new Date().toISOString().slice(0, 10);
    await Promise.all([
      loadLicenseEditions(admin$('#licenseProduct'), admin$('#licenseEdition')),
      loadLicenseEditions(admin$('#licenseBatchProduct'), admin$('#licenseBatchEdition')),
      loadLicenseEditions(admin$('#licensePolicyProduct'), admin$('#licensePolicyEdition')),
    ]);
    await loadLicensePolicy();
    admin$('#licenseBatchStartDate').value ||= new Date().toISOString().slice(0, 10);
    await loadLicenseRegistrations();
  } catch (error) {
    admin$('#adminProductsState').className = 'state-panel error-state';
    admin$('#adminProductsState').textContent = error.status === 403 ? 'Super admin license permissions are required.' : 'Products, organizations, or licenses are unavailable.';
  }
}

function renderLicenseBatches(batches) {
  const state = admin$('#adminLicenseBatchesState');
  const list = admin$('#adminLicenseBatchesList');
  if (!batches.length) {
    state.classList.remove('hidden');
    state.textContent = 'No activation code batches have been generated.';
    list.classList.add('hidden');
    return;
  }
  state.classList.add('hidden');
  list.classList.remove('hidden');
  list.innerHTML = `<table class="admin-table"><thead><tr><th>Created</th><th>Product / edition</th><th>Total</th><th>Available</th><th>Claimed</th><th>Revoked</th><th>Not issued</th><th>Issued</th><th>Codes</th></tr></thead><tbody>${batches.map((batch) => `<tr><td>${adminEscape(batch.created_at)}</td><td>${adminEscape(batch.product_name)} / ${adminEscape(batch.edition_name)}</td><td>${adminEscape(batch.total)}</td><td>${adminEscape(batch.available)}</td><td>${adminEscape(batch.claimed)}</td><td>${adminEscape(batch.revoked)}</td><td>${adminEscape(batch.not_issued)}</td><td>${adminEscape(batch.issued)}</td><td><button class="secondary" type="button" data-license-code-batch="${adminEscape(batch.batch_id)}">View codes</button></td></tr>`).join('')}</tbody></table>`;
}

async function loadLicenseCodeInventory(batchId) {
  adminState.licenseCodeBatchId = batchId;
  const state = admin$('#adminLicenseCodesState');
  const list = admin$('#adminLicenseCodesList');
  const issueButton = admin$('#licenseCodeIssueButton');
  state.className = 'state-panel';
  state.textContent = 'Loading serial delivery details...';
  list.classList.add('hidden');
  issueButton.disabled = true;

  const result = await adminApi(`licenses/batches/${encodeURIComponent(batchId)}/codes`);
  if (adminState.licenseCodeBatchId !== batchId) return;
  const eligibleCodes = result.codes.filter((code) =>
    code.status === 'available' && code.delivery_status === 'not_issued');
  state.classList.add('hidden');
  list.classList.remove('hidden');
  const revealNote = result.key_reveal_configured
    ? 'Available keys can be revealed one at a time after confirming your admin password. Older hash-only keys can be restored if you still have the original key.'
    : 'Protected key reveal is not configured in this environment.';
  list.innerHTML = `<p class="muted">Batch <strong>${adminEscape(batchId)}</strong>. ${adminEscape(revealNote)}</p><table class="admin-table"><thead><tr><th><input id="licenseCodeSelectAll" type="checkbox" aria-label="Select all eligible codes" ${eligibleCodes.length ? '' : 'disabled'} /></th><th>Serial number</th><th>Activation status</th><th>Delivery status</th><th>Recipient</th><th>Channel</th><th>Issued at</th><th>Key</th></tr></thead><tbody>${result.codes.map((code) => {
    const eligible = code.status === 'available' && code.delivery_status === 'not_issued';
    const recipient = [code.issued_to_name, code.issued_to_organization, code.issued_to_email]
      .filter(Boolean).map(adminEscape).join('<br>');
    const keyAction = code.status === 'available' && code.activation_key_recoverable
      ? `<button class="secondary" type="button" data-license-code-reveal-serial="${adminEscape(code.serial_number)}">Reveal key</button>`
      : code.status === 'available' && result.key_reveal_configured
        ? `<button class="secondary" type="button" data-license-code-restore-serial="${adminEscape(code.serial_number)}">Restore existing key</button>`
      : '<span class="muted">Unavailable</span>';
    return `<tr><td>${eligible ? `<input type="checkbox" name="serial_number" value="${adminEscape(code.serial_number)}" aria-label="Select serial ${adminEscape(code.serial_number)}" />` : '—'}</td><td>${adminEscape(code.serial_number)}</td><td>${adminEscape(code.status)}</td><td>${adminEscape(code.delivery_status)}</td><td>${recipient || '—'}</td><td>${adminEscape(code.delivery_channel || '—')}</td><td>${adminEscape(code.issued_at || '—')}</td><td>${keyAction}</td></tr>`;
  }).join('')}</tbody></table>`;

  const updateIssueButton = () => {
    issueButton.disabled = list.querySelectorAll('input[name="serial_number"]:checked').length === 0;
  };
  list.querySelector('#licenseCodeSelectAll')?.addEventListener('change', (event) => {
    list.querySelectorAll('input[name="serial_number"]').forEach((checkbox) => {
      checkbox.checked = event.currentTarget.checked;
    });
    updateIssueButton();
  });
  list.querySelectorAll('input[name="serial_number"]').forEach((checkbox) => {
    checkbox.addEventListener('change', updateIssueButton);
  });
}

function openLicenseCodeReveal(serialNumber) {
  const dialog = admin$('#licenseCodeRevealDialog');
  const form = admin$('#licenseCodeRevealForm');
  form.dataset.batchId = adminState.licenseCodeBatchId;
  form.dataset.serialNumber = serialNumber;
  admin$('#licenseCodeRevealSerial').textContent = serialNumber;
  admin$('#licenseCodeRevealPassword').value = '';
  admin$('#licenseCodeRevealMessage').textContent = '';
  admin$('#licenseCodeRevealResult').classList.add('hidden');
  admin$('#licenseCodeRevealKey').textContent = '';
  admin$('#licenseCodeRevealSubmit').disabled = false;
  dialog.showModal();
  admin$('#licenseCodeRevealPassword').focus();
}

function clearLicenseCodeReveal() {
  licenseCodeRevealRequestId += 1;
  clearTimeout(licenseCodeRevealTimer);
  licenseCodeRevealTimer = null;
  admin$('#licenseCodeRevealPassword').value = '';
  admin$('#licenseCodeRevealKey').textContent = '';
  admin$('#licenseCodeRevealResult').classList.add('hidden');
  admin$('#licenseCodeRevealMessage').textContent = '';
}

function openLicenseCodeRestore(serialNumber) {
  const form = admin$('#licenseCodeRestoreForm');
  form.dataset.batchId = adminState.licenseCodeBatchId;
  form.dataset.serialNumber = serialNumber;
  admin$('#licenseCodeRestoreSerial').textContent = serialNumber;
  admin$('#licenseCodeRestoreKey').value = '';
  admin$('#licenseCodeRestorePassword').value = '';
  admin$('#licenseCodeRestoreMessage').textContent = '';
  admin$('#licenseCodeRestoreSubmit').textContent = 'Verify & restore';
  admin$('#licenseCodeRestoreSubmit').disabled = false;
  admin$('#licenseCodeRestoreDialog').showModal();
  admin$('#licenseCodeRestoreKey').focus();
}

function clearLicenseCodeRestore() {
  licenseCodeRestoreRequestId += 1;
  admin$('#licenseCodeRestoreKey').value = '';
  admin$('#licenseCodeRestorePassword').value = '';
  admin$('#licenseCodeRestoreMessage').textContent = '';
}

async function loadLicenseEditions(productSelect, editionSelect) {
  const productId = productSelect.value;
  if (!productId) {
    editionSelect.innerHTML = '';
    return;
  }
  const data = await adminApi(`products/${encodeURIComponent(productId)}`);
  const editions = data.product.editions.filter((edition) => edition.status === 'active');
  editionSelect.innerHTML = editions.map((edition) => `<option value="${adminEscape(edition.id)}">${adminEscape(edition.name)} (${adminEscape(edition.code)})</option>`).join('');
}

function toggleLicenseCustomerMode() {
  const isNewCustomer = admin$('#licenseCustomerMode').value === 'new';
  admin$('#licenseNewCustomerFields').classList.toggle('hidden', !isNewCustomer);
  admin$('#licenseExistingOrganizationFields').classList.toggle('hidden', isNewCustomer);
  for (const field of admin$('#licenseNewCustomerFields').querySelectorAll('input')) {
    field.disabled = !isNewCustomer;
  }
  const organizationSelect = admin$('#licenseOrganization');
  organizationSelect.disabled = isNewCustomer;
}

async function loadLicensePolicy() {
  const productId = admin$('#licensePolicyProduct').value;
  const editionId = admin$('#licensePolicyEdition').value;
  if (!productId || !editionId) return;
  try {
    const { policy } = await adminApi(`products/${productId}/editions/${editionId}/evaluation-policy`);
    admin$('#licensePolicyGrace').value = policy.subscription_grace_days;
    admin$('#licensePolicyRollout').value = policy.rollout_stage;
    for (const key of ['allow_dashboard', 'allow_read_only_records', 'allow_reports', 'allow_backups', 'allow_exports']) {
      admin$(`#licensePolicyForm [name="${key}"]`).checked = policy.evaluation_policy[key];
    }
    admin$('#licensePolicyLockedModules').value = policy.evaluation_policy.locked_modules.join(', ');
    adminMessage(admin$('#licensePolicyMessage'), '', true);
  } catch (error) {
    adminMessage(admin$('#licensePolicyMessage'), error.message, false);
  }
}

function renderRegistrationMetrics(metrics) {
  const cards = [
    { label: 'Total licenses', value: metrics.total_licenses, note: 'Across all statuses' },
    { label: 'Active installations', value: metrics.active_installations, note: 'Currently using a license' },
    { label: 'No activation history', value: metrics.never_activated, note: 'No installation has ever activated' },
    { label: 'Missing registered email', value: metrics.missing_registered_email, note: 'Active installs needing attention' },
  ];
  admin$('#adminRegistrationMetrics').innerHTML = cards.map((metric) => `
    <article class="card">
      <span class="stat-label">${adminEscape(metric.label)}</span>
      <strong class="stat-value">${adminEscape(Number(metric.value || 0).toLocaleString())}</strong>
      <span class="admin-metric-note">${adminEscape(metric.note)}</span>
    </article>
  `).join('');
}

function renderAdminLicenses(data) {
  const state = admin$('#adminLicensesState');
  const list = admin$('#adminLicensesList');
  const pagination = admin$('#adminRegistrationPagination');
  const registrations = data.registrations || [];
  renderRegistrationMetrics(data.metrics || {});
  if (!registrations.length) {
    state.classList.remove('hidden');
    state.textContent = data.total ? 'No registrations match these filters.' : 'No licenses have been issued.';
    list.classList.add('hidden');
    list.innerHTML = '';
    renderRegistrationPagination(pagination, data);
    return;
  }
  state.classList.add('hidden');
  list.classList.remove('hidden');
  list.innerHTML = `<div class="admin-license-table-wrap"><table class="admin-license-table">
    <thead><tr><th>Customer / product</th><th>License</th><th>Registration emails</th><th>Activation</th><th>Last seen</th><th>Actions</th></tr></thead>
    <tbody>${registrations.map((registration) => {
      const id = adminEscape(registration.license_id);
      const status = String(registration.license_status || '').toLowerCase();
      const activeCount = Number(registration.active_activation_count || 0);
      const totalCount = Number(registration.total_activation_count || 0);
      const activationLabel = activeCount ? 'Active' : totalCount ? 'Released' : 'Never activated';
      const canRenew = ['ACTIVE', 'EXPIRED', 'PENDING_RENEWAL'].includes(registration.license_status);
      return `<tr>
        <td><strong>${adminEscape(registration.organization_name || 'Organization unavailable')}</strong><small>${adminEscape(registration.product?.name || 'Product')} · ${adminEscape(registration.edition?.name || 'No edition')}</small></td>
        <td><strong>${adminEscape(registration.serial_number || '—')}</strong><small><span class="status status-${adminEscape(status)}">${adminEscape(registration.license_status || 'Unknown')}</span> · ${adminEscape(registration.start_date || 'No start date')} → ${adminEscape(registration.expiry_date || 'Perpetual')}</small></td>
        <td class="registration-email"><strong>License email</strong><small>${adminEscape(registration.registered_email_masked || 'Not registered')}</small><strong>Customer contact</strong><small>${adminEscape(registration.contact_email_masked || 'Not available')}</small></td>
        <td><strong>${adminEscape(activationLabel)}</strong><small>${adminEscape(activeCount)} active · ${adminEscape(totalCount)} total</small><small>First activation: ${adminEscape(registration.first_activation_at || '—')}</small></td>
        <td><strong>${adminEscape(registration.last_seen_at || '—')}</strong><small>License created: ${adminEscape(registration.license_created_at || '—')}</small></td>
        <td class="registration-actions"><button class="secondary" type="button" data-license-details="${id}">Inspect</button>${registration.license_status === 'ACTIVE' ? `<button class="secondary" type="button" data-license-suspend="${id}">Suspend</button>` : ''}${canRenew ? `<label class="inline-date">Renew through <input type="date" data-license-renew-date="${id}" /></label><button class="secondary" type="button" data-license-renew="${id}">Renew</button>` : ''}</td>
      </tr><tr class="admin-license-detail-row" data-license-detail-row="${id}" hidden><td colspan="6"><div class="license-details hidden" data-license-detail-panel="${id}"></div></td></tr>`;
    }).join('')}</tbody>
  </table></div>`;
  renderRegistrationPagination(pagination, data);
}

function renderRegistrationPagination(container, data) {
  const pageCount = Math.max(1, Math.ceil(Number(data.total || 0) / Number(data.page_size || 25)));
  container.innerHTML = `
    <p>${adminEscape(Number(data.total || 0).toLocaleString())} licenses · Page ${adminEscape(data.page || 1)} of ${adminEscape(pageCount)}</p>
    <div class="form-actions">
      <button class="secondary" type="button" data-registration-page="previous" ${Number(data.page || 1) <= 1 ? 'disabled' : ''}>Previous</button>
      <button class="secondary" type="button" data-registration-page="next" ${Number(data.page || 1) >= pageCount ? 'disabled' : ''}>Next</button>
    </div>`;
}

async function loadLicenseRegistrations({ resetPage = false } = {}) {
  const state = admin$('#adminLicensesState');
  const list = admin$('#adminLicensesList');
  if (resetPage) adminState.registrationPage = 1;
  const values = new FormData(admin$('#adminRegistrationFilters'));
  const params = new URLSearchParams({
    page: String(adminState.registrationPage),
    page_size: '25',
  });
  for (const key of ['q', 'status', 'activation', 'email', 'from', 'to']) {
    const value = String(values.get(key) || '').trim();
    if (value) params.set(key, value);
  }
  const requestId = ++adminState.registrationRequestId;
  state.className = 'state-panel';
  state.textContent = 'Loading registration records...';
  list.classList.add('hidden');
  try {
    const data = await adminApi(`admin/license-registrations?${params.toString()}`);
    if (requestId !== adminState.registrationRequestId) return;
    renderAdminLicenses(data);
  } catch (error) {
    if (requestId !== adminState.registrationRequestId) return;
    state.className = 'state-panel error-state';
    state.textContent = `Registration monitoring is unavailable: ${error.message}`;
    admin$('#adminRegistrationMetrics').innerHTML = '';
    list.innerHTML = '';
    admin$('#adminRegistrationPagination').innerHTML = '';
  }
}

function renderLicenseDetails(licenseId, data) {
  const registration = data.registration.registration;
  const registrationGroups = [
    {
      title: 'Customer contact',
      fields: [
        ['Contact name', registration.contact_name],
        ['Customer contact email', registration.account_email],
        ['Phone', registration.contact_phone],
        ['Account status', registration.customer_status],
        ['Account created', registration.customer_created_at],
      ],
    },
    {
      title: 'Institution',
      fields: [
        ['Organization', registration.organization_name],
        ['Legal name', registration.organization_legal_name],
        ['City / state', [registration.organization_city, registration.organization_state].filter(Boolean).join(', ')],
      ],
    },
    {
      title: 'License lifecycle',
      fields: [
        ['License-registered email', registration.registered_email],
        ['License created', registration.license_created_at],
        ['First activation', registration.first_activation_at],
        ['Last seen', registration.last_seen_at],
        ['Installations', `${registration.active_activation_count} active / ${registration.total_activation_count} total`],
      ],
    },
  ].map((group) => `<section><h4>${adminEscape(group.title)}</h4><dl>${group.fields.map(([label, value]) => `<dt>${adminEscape(label)}</dt><dd>${adminEscape(value || 'Not available')}</dd>`).join('')}</dl></section>`).join('');
  const entitlements = data.entitlements.entitlements.map((item) => `<div><dt>${adminEscape(item.key)}</dt><dd>${adminEscape(typeof item.value === 'object' ? JSON.stringify(item.value) : item.value)}</dd></div>`).join('');
  const activations = data.activations.activations.map((item, index) => `<li><strong>Installation ${index + 1} (${adminEscape(String(item.installation_id || '').slice(-4) || '—')})</strong> · ${adminEscape(item.status)} · Last seen ${adminEscape(item.last_seen_at || '—')}${item.status === 'active' ? ` <button type="button" class="text-button" data-activation-revoke="${adminEscape(item.id)}" data-license-id="${adminEscape(licenseId)}">Revoke</button>` : ''}</li>`).join('');
  const artifacts = data.artifacts.artifacts.map((item) => `<li>${adminEscape(item.document_id)} · ${adminEscape(item.algorithm)} · key ${adminEscape(item.key_id)} · ${adminEscape(item.issued_at)}</li>`).join('');
  const events = data.events.events.map((item) => `<li>${adminEscape(item.created_at)} · ${adminEscape(item.event_type)} · ${adminEscape(item.previous_status || '—')} → ${adminEscape(item.new_status || '—')}</li>`).join('');
  return `<div class="registration-detail-grid">${registrationGroups}</div><div class="license-detail-grid"><section><h4>Entitlements</h4><dl class="entitlement-list">${entitlements || '<dd>None</dd>'}</dl></section><section><h4>Activations</h4><ul>${activations || '<li>None</li>'}</ul></section><section><h4>Signed artifacts</h4><ul>${artifacts || '<li>None</li>'}</ul></section><section><h4>Lifecycle timeline</h4><ul>${events || '<li>No lifecycle events recorded</li>'}</ul></section></div>`;
}

async function loadLicenseDetails(licenseId, panel) {
  panel.textContent = 'Loading license details...';
  panel.classList.remove('hidden');
  try {
    const [entitlements, activations, artifacts, events, registration] = await Promise.all([
      adminApi(`licenses/${licenseId}/entitlements`),
      adminApi(`licenses/${licenseId}/activations`),
      adminApi(`licenses/${licenseId}/artifacts`),
      adminApi(`licenses/${licenseId}/events`),
      adminApi(`admin/license-registrations/${licenseId}`),
    ]);
    panel.innerHTML = renderLicenseDetails(licenseId, { entitlements, activations, artifacts, events, registration });
    panel.dataset.loaded = 'true';
  } catch (error) {
    panel.textContent = `License details could not be loaded: ${error.message}`;
  }
}

async function loadAdminAudit() {
  try {
    const data = await adminApi('admin/audit');
    if (!data.audit.length) return adminStatePanel('adminAuditState', 'adminAuditList', 'No audit activity yet.');
    admin$('#adminAuditState').classList.add('hidden');
    const list = admin$('#adminAuditList');
    list.classList.remove('hidden');
    list.innerHTML = `<table class="admin-table"><thead><tr><th>Action</th><th>Resource</th><th>Actor</th><th>Organization</th><th>Created</th></tr></thead><tbody>${data.audit.map((event) => `<tr><td>${adminEscape(event.action)}</td><td>${adminEscape(event.resource_type || 'System')} ${adminEscape(event.resource_id || '')}</td><td>${adminEscape(event.actor_person_id || 'System')}</td><td>${adminEscape(event.organization_id || 'Global')}</td><td>${adminEscape(event.created_at)}</td></tr>`).join('')}</tbody></table>`;
  } catch (error) { adminStatePanel('adminAuditState', 'adminAuditList', 'Audit activity is unavailable.', true); }
}

function adminDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

async function loadAdminAnnouncements() {
  try {
    const [data, products] = await Promise.all([adminApi('admin/announcements'), adminApi('products')]);
    adminState.announcements = data.announcements;
    admin$('#announcementProduct').innerHTML = `<option value="">All customer organizations</option>${products.products.map((product) => `<option value="${product.id}">${adminEscape(product.name)} (${adminEscape(product.code)})</option>`).join('')}`;
    const state = admin$('#adminAnnouncementsState');
    const list = admin$('#adminAnnouncementsList');
    if (!data.announcements.length) {
      adminStatePanel('adminAnnouncementsState', 'adminAnnouncementsList', 'No announcements yet. Draft a service notice or customer update above.');
      return;
    }
    state.classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = data.announcements.map((item) => `<article class="card module"><div class="section-head compact"><div><span class="eyebrow">${adminEscape(item.severity)} · ${adminEscape(item.product_name || 'All customer organizations')}</span><h3>${adminEscape(item.title)}</h3></div><span class="status">${adminEscape(item.status)}</span></div><p>${adminEscape(item.message)}</p><p class="muted">Starts ${adminEscape(item.starts_at)}${item.ends_at ? ` · Ends ${adminEscape(item.ends_at)}` : ''}</p><div class="form-actions">${['draft', 'published'].includes(item.status) ? `<button class="secondary" type="button" data-announcement-edit="${item.id}">Edit</button>` : ''}${item.status === 'draft' ? `<button class="primary" type="button" data-announcement-status="published" data-announcement-id="${item.id}">Publish</button>` : ''}${item.status === 'published' ? `<button class="secondary" type="button" data-announcement-status="resolved" data-announcement-id="${item.id}">Resolve</button>` : ''}${['draft', 'published', 'resolved'].includes(item.status) ? `<button class="text-button" type="button" data-announcement-status="archived" data-announcement-id="${item.id}">Archive</button>` : ''}</div></article>`).join('');
  } catch (error) {
    adminStatePanel('adminAnnouncementsState', 'adminAnnouncementsList', error.status === 403 ? 'Super admin access required.' : 'Announcements are unavailable.', true);
  }
}

function resetAnnouncementForm() {
  admin$('#announcementForm').reset();
  admin$('#announcementId').value = '';
  admin$('#announcementStatus').disabled = false;
  admin$('#announcementSaveButton').textContent = 'Create announcement';
  admin$('#announcementCancelEdit').classList.add('hidden');
}

async function loadAdminWorkspace() {
  try {
    const identity = await adminApi('me');
    if (identity.account_type !== 'user' || identity.user?.role !== 'super_admin') throw Object.assign(new Error('Super admin access required'), { status: 403 });
    const displayName = identity.user.name || identity.user.email;
    admin$('#adminUserName').textContent = displayName;
    admin$('#adminWelcomeName').textContent = displayName.split(/\s+/)[0];
    await loadAdminOverview();
  } catch (error) {
    adminState.token = null;
    showAdminLogin(error.status === 403 ? 'Super admin access required.' : 'Your session has expired.');
  }
}

function navigateAdmin(view, productTab = null) {
  const button = admin$(`button[data-admin-view="${view}"]`);
  if (!button) return;
  if (view !== 'organizations') clearCustomerInviteLink();
  admin$$('.admin-nav button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  admin$$('.admin-view').forEach((section) => section.classList.toggle('active', section.dataset.adminSection === view));
  admin$('#adminPageTitle').textContent = button.textContent;
  if (view === 'overview') loadAdminOverview();
  if (view === 'users') loadAdminUsers();
  if (view === 'organizations') {
    loadAdminOrganizations().then(loadAdminPartners);
    loadAdminCustomerInvites();
  }
  if (view === 'products') {
    loadAdminProducts();
    if (productTab) selectAdminProductTab(productTab);
  }
  if (view === 'announcements') loadAdminAnnouncements();
  if (view === 'audit') loadAdminAudit();
}

function selectAdminProductTab(tabName) {
  const selectedTab = admin$(`.admin-product-tab[data-product-tab="${tabName}"]`);
  if (!selectedTab) return;
  admin$$('.admin-product-tab').forEach((tab) => {
    const isSelected = tab === selectedTab;
    tab.setAttribute('aria-selected', String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;
  });
  admin$$('.admin-product-panel').forEach((panel) => {
    panel.hidden = panel.dataset.productPanel !== tabName;
  });
}

admin$$('[data-admin-view]').forEach((button) => button.addEventListener('click', () => navigateAdmin(button.dataset.adminView, button.dataset.productTab)));
admin$$('.admin-product-tab').forEach((tab, index, tabs) => {
  tab.addEventListener('click', () => selectAdminProductTab(tab.dataset.productTab));
  tab.addEventListener('keydown', (event) => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const nextTab = tabs[(index + direction + tabs.length) % tabs.length];
    nextTab.focus();
    selectAdminProductTab(nextTab.dataset.productTab);
  });
});
selectAdminProductTab('overview');
admin$$('.admin-refresh').forEach((button) => button.addEventListener('click', () => navigateAdmin(button.dataset.refresh)));
admin$('#adminOverviewRefresh').addEventListener('click', loadAdminOverview);
admin$('#adminD1Refresh').addEventListener('click', loadAdminD1Operations);

admin$('#adminLoginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const button = event.target.querySelector('button');
  button.disabled = true;
  adminMessage(admin$('#adminLoginMessage'), 'Signing in...', true);
  try {
    const data = await adminApi('login', { method: 'POST', body: JSON.stringify({ type: 'user', email: form.get('email'), password: form.get('password') }) });
    adminState.token = null;
    showAdminPortal();
  } catch (error) { adminMessage(admin$('#adminLoginMessage'), error.status === 401 ? 'Invalid email or password.' : error.message, false); }
  finally { button.disabled = false; }
});

admin$('#customerInviteForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const values = new FormData(formElement);
  const button = admin$('#customerInviteButton');
  button.disabled = true;
  admin$('#customerInviteResult').classList.add('hidden');
  adminMessage(admin$('#customerInviteMessage'), 'Creating one-time setup invite...', true);
  try {
    const result = await adminApi('admin/customer-invites', {
      method: 'POST',
      body: JSON.stringify({
        email: values.get('email'),
        name: values.get('name'),
        company: values.get('company'),
        organization_id: values.get('organization_id'),
      }),
    });
    if (result.setup_path) {
      admin$('#customerInviteLink').value = new URL(result.setup_path, window.location.origin).href;
      admin$('#customerInviteResult').classList.remove('hidden');
    }
    formElement.reset();
    updateCustomerInviteOrganizationFields();
    adminMessage(
      admin$('#customerInviteMessage'),
      result.setup_path
        ? 'Invite created. Copy the link now and share it only with the intended customer.'
        : result.message || 'Existing customer added to the organization.',
      true,
    );
    await loadAdminCustomerInvites();
    await loadAdminOrganizations();
    await loadAdminPartners();
  } catch (error) {
    adminMessage(admin$('#customerInviteMessage'), error.message, false);
  } finally {
    button.disabled = false;
  }
});

admin$('#customerInviteOrganization').addEventListener('change', updateCustomerInviteOrganizationFields);
admin$('#partnerContactOrganization').addEventListener('change', updatePartnerOrganizationFields);

admin$('#partnerContactForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const values = new FormData(formElement);
  const button = admin$('#partnerContactButton');
  button.disabled = true;
  admin$('#partnerInviteResult').classList.add('hidden');
  adminMessage(admin$('#partnerContactMessage'), 'Saving partner organization and contact...', true);
  try {
    const result = await adminApi('admin/partners', {
      method: 'POST',
      body: JSON.stringify({
        organization_id: values.get('organization_id'),
        organization_name: values.get('organization_name'),
        partner_type: values.get('partner_type'),
        partner_role: values.get('partner_role'),
        email: values.get('email'),
        name: values.get('name'),
      }),
    });
    if (result.setup_path) {
      admin$('#partnerInviteLink').value = new URL(result.setup_path, window.location.origin).href;
      admin$('#partnerInviteResult').classList.remove('hidden');
      adminMessage(admin$('#partnerContactMessage'), 'Partner invitation created. Copy and share the one-time setup link securely.', true);
    } else {
      adminMessage(admin$('#partnerContactMessage'), 'Existing customer account added as a partner contact.', true);
    }
    formElement.reset();
    updatePartnerOrganizationFields();
    await loadAdminOrganizations();
    await loadAdminPartners();
  } catch (error) {
    adminMessage(admin$('#partnerContactMessage'), error.message, false);
  } finally {
    button.disabled = false;
  }
});

admin$('#partnerInviteCopy').addEventListener('click', async () => {
  const input = admin$('#partnerInviteLink');
  try {
    await navigator.clipboard.writeText(input.value);
    adminMessage(admin$('#partnerContactMessage'), 'Partner setup link copied. Share it only with the intended contact.', true);
  } catch {
    input.focus();
    input.select();
    adminMessage(admin$('#partnerContactMessage'), 'Select and copy the partner setup link manually.', false);
  }
});

admin$('#partnerCustomerLinkForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  const button = admin$('#partnerCustomerLinkButton');
  button.disabled = true;
  adminMessage(admin$('#partnerCustomerLinkMessage'), 'Linking organizations...', true);
  try {
    await adminApi(`admin/partners/${values.get('partner_organization_id')}/customers`, {
      method: 'POST',
      body: JSON.stringify({ customer_organization_id: values.get('customer_organization_id') }),
    });
    adminMessage(admin$('#partnerCustomerLinkMessage'), 'Customer organization linked to the partner.', true);
    await loadAdminPartners();
  } catch (error) {
    adminMessage(admin$('#partnerCustomerLinkMessage'), error.message, false);
  } finally {
    button.disabled = false;
  }
});

admin$('#customerInviteCopy').addEventListener('click', async () => {
  const input = admin$('#customerInviteLink');
  try {
    await navigator.clipboard.writeText(input.value);
    adminMessage(admin$('#customerInviteMessage'), 'Setup link copied. Share it only with the intended customer.', true);
  } catch {
    input.focus();
    input.select();
    adminMessage(admin$('#customerInviteMessage'), 'Select and copy the setup link manually.', false);
  }
});

admin$('#adminLogout').addEventListener('click', async () => {
  try { await adminApi('logout', { method: 'POST' }); } catch {}
  adminState.token = null;
  showAdminLogin();
});

admin$('#adminPasswordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const button = admin$('#adminPasswordButton');
  button.disabled = true;
  try {
    const result = await adminApi('admin/password', {
      method: 'POST',
      body: JSON.stringify({
        current_password: values.get('current_password'),
        new_password: values.get('new_password'),
      }),
    });
    form.reset();
    adminState.token = null;
    showAdminLogin();
    adminMessage(admin$('#adminLoginMessage'), result.message, true);
  } catch (error) {
    adminMessage(admin$('#adminPasswordMessage'), error.message, false);
  } finally {
    button.disabled = false;
  }
});

admin$('#announcementForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const id = form.get('id');
  const localDate = (value) => value ? new Date(value).toISOString() : null;
  const body = {
    title: form.get('title'),
    message: form.get('message'),
    severity: form.get('severity'),
    product_id: form.get('product_id') || null,
    starts_at: localDate(form.get('starts_at')),
    ends_at: localDate(form.get('ends_at')),
    status: form.get('status'),
  };
  const button = admin$('#announcementSaveButton');
  button.disabled = true;
  try {
    const result = await adminApi(id ? `admin/announcements/${id}` : 'admin/announcements', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    });
    adminMessage(admin$('#announcementMessage'), id ? 'Announcement updated.' : `Announcement #${result.announcement.id} created.`, true);
    resetAnnouncementForm();
    await loadAdminAnnouncements();
  } catch (error) {
    adminMessage(admin$('#announcementMessage'), error.message, false);
  } finally {
    button.disabled = false;
  }
});

admin$('#announcementCancelEdit').addEventListener('click', resetAnnouncementForm);
admin$('#adminAnnouncementsList').addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-announcement-edit]');
  if (editButton) {
    const announcement = adminState.announcements.find((item) => item.id === Number(editButton.dataset.announcementEdit));
    if (!announcement) return;
    admin$('#announcementId').value = announcement.id;
    admin$('#announcementTitle').value = announcement.title;
    admin$('#announcementMessageBody').value = announcement.message;
    admin$('#announcementSeverity').value = announcement.severity;
    admin$('#announcementProduct').value = announcement.product_id || '';
    admin$('#announcementStartsAt').value = adminDateInput(announcement.starts_at);
    admin$('#announcementEndsAt').value = adminDateInput(announcement.ends_at);
    admin$('#announcementStatus').value = announcement.status;
    admin$('#announcementStatus').disabled = true;
    admin$('#announcementSaveButton').textContent = 'Save changes';
    admin$('#announcementCancelEdit').classList.remove('hidden');
    admin$('#announcementTitle').focus();
    return;
  }

  const statusButton = event.target.closest('[data-announcement-status]');
  if (!statusButton) return;
  statusButton.disabled = true;
  try {
    await adminApi(`admin/announcements/${statusButton.dataset.announcementId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: statusButton.dataset.announcementStatus }),
    });
    adminMessage(admin$('#announcementMessage'), 'Announcement status updated.', true);
    await loadAdminAnnouncements();
  } catch (error) {
    adminMessage(admin$('#announcementMessage'), error.message, false);
  } finally {
    statusButton.disabled = false;
  }
});

admin$('#licenseCustomerMode').addEventListener('change', toggleLicenseCustomerMode);
toggleLicenseCustomerMode();

admin$('#licenseProduct').addEventListener('change', async () => {
  try { await loadLicenseEditions(admin$('#licenseProduct'), admin$('#licenseEdition')); }
  catch (error) { adminMessage(admin$('#licenseIssueMessage'), error.message, false); }
});

admin$('#licenseBatchProduct').addEventListener('change', async () => {
  try { await loadLicenseEditions(admin$('#licenseBatchProduct'), admin$('#licenseBatchEdition')); }
  catch (error) { adminMessage(admin$('#licenseBatchMessage'), error.message, false); }
});

admin$('#licensePolicyProduct').addEventListener('change', async () => {
  try {
    await loadLicenseEditions(admin$('#licensePolicyProduct'), admin$('#licensePolicyEdition'));
    await loadLicensePolicy();
  } catch (error) { adminMessage(admin$('#licensePolicyMessage'), error.message, false); }
});

admin$('#licensePolicyEdition').addEventListener('change', loadLicensePolicy);

admin$('#adminLicenseBatchesList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-license-code-batch]');
  if (!button) return;
  button.disabled = true;
  try {
    await loadLicenseCodeInventory(button.dataset.licenseCodeBatch);
    admin$('#adminLicenseCodesList').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    admin$('#adminLicenseCodesState').className = 'state-panel error-state';
    admin$('#adminLicenseCodesState').textContent = error.message || 'Code inventory is unavailable.';
  } finally {
    button.disabled = false;
  }
});

admin$('#adminLicenseCodesList').addEventListener('click', (event) => {
  const revealButton = event.target.closest('[data-license-code-reveal-serial]');
  const restoreButton = event.target.closest('[data-license-code-restore-serial]');
  if (!adminState.licenseCodeBatchId) return;
  if (revealButton) openLicenseCodeReveal(revealButton.dataset.licenseCodeRevealSerial);
  if (restoreButton) openLicenseCodeRestore(restoreButton.dataset.licenseCodeRestoreSerial);
});

admin$('#licenseCodeRevealDialog').addEventListener('close', clearLicenseCodeReveal);
admin$('#licenseCodeRevealCancel').addEventListener('click', () => {
  admin$('#licenseCodeRevealDialog').close();
});

admin$('#licenseCodeRestoreDialog').addEventListener('close', clearLicenseCodeRestore);
admin$('#licenseCodeRestoreCancel').addEventListener('click', () => {
  admin$('#licenseCodeRestoreDialog').close();
});

admin$('#licenseCodeRestoreForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const dialog = admin$('#licenseCodeRestoreDialog');
  const activationKeyInput = admin$('#licenseCodeRestoreKey');
  const passwordInput = admin$('#licenseCodeRestorePassword');
  const submitButton = admin$('#licenseCodeRestoreSubmit');
  const activationKey = activationKeyInput.value;
  const password = passwordInput.value;
  activationKeyInput.value = '';
  passwordInput.value = '';
  submitButton.disabled = true;
  adminMessage(admin$('#licenseCodeRestoreMessage'), 'Verifying key and password...', true);
  const requestId = ++licenseCodeRestoreRequestId;
  let restored = false;

  try {
    await adminApi(
      `licenses/batches/${encodeURIComponent(form.dataset.batchId)}/codes/${encodeURIComponent(form.dataset.serialNumber)}/restore`,
      { method: 'POST', body: JSON.stringify({ activation_key: activationKey, password }) },
    );
    restored = true;
    if (!dialog.open || requestId !== licenseCodeRestoreRequestId) return;
    try {
      await loadLicenseCodeInventory(form.dataset.batchId);
      if (!dialog.open || requestId !== licenseCodeRestoreRequestId) return;
      adminMessage(admin$('#licenseCodeRestoreMessage'), 'Key verified and stored securely. The inventory now offers the normal reveal action.', true);
      submitButton.textContent = 'Restored';
    } catch (error) {
      adminMessage(admin$('#licenseCodeRestoreMessage'), `Key was restored, but inventory could not refresh: ${error.message || 'refresh failed'}. Close this dialog and refresh the batch.`, false);
    }
  } catch (error) {
    if (dialog.open && requestId === licenseCodeRestoreRequestId) {
      adminMessage(admin$('#licenseCodeRestoreMessage'), error.message || 'The key could not be restored.', false);
    }
  } finally {
    if (dialog.open && requestId === licenseCodeRestoreRequestId) submitButton.disabled = restored;
  }
});

admin$('#licenseCodeRevealForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const dialog = admin$('#licenseCodeRevealDialog');
  const passwordInput = admin$('#licenseCodeRevealPassword');
  const submitButton = admin$('#licenseCodeRevealSubmit');
  const password = passwordInput.value;
  passwordInput.value = '';
  submitButton.disabled = true;
  adminMessage(admin$('#licenseCodeRevealMessage'), 'Checking password...', true);
  const requestId = ++licenseCodeRevealRequestId;
  let revealed = false;

  try {
    const result = await adminApi(
      `licenses/batches/${encodeURIComponent(form.dataset.batchId)}/codes/${encodeURIComponent(form.dataset.serialNumber)}/reveal`,
      { method: 'POST', body: JSON.stringify({ password }) },
    );
    if (!dialog.open || requestId !== licenseCodeRevealRequestId) return;
    admin$('#licenseCodeRevealKey').textContent = result.activation_key;
    admin$('#licenseCodeRevealResult').classList.remove('hidden');
    adminMessage(admin$('#licenseCodeRevealMessage'), 'Key revealed. It will be hidden automatically after 30 seconds.', true);
    revealed = true;
    licenseCodeRevealTimer = setTimeout(() => {
      if (requestId !== licenseCodeRevealRequestId) return;
      admin$('#licenseCodeRevealKey').textContent = '';
      admin$('#licenseCodeRevealResult').classList.add('hidden');
      adminMessage(admin$('#licenseCodeRevealMessage'), 'The key was hidden. Close this window when finished.', true);
    }, 30000);
  } catch (error) {
    if (dialog.open && requestId === licenseCodeRevealRequestId) {
      adminMessage(admin$('#licenseCodeRevealMessage'), error.message || 'The key could not be revealed.', false);
    }
  } finally {
    if (dialog.open && requestId === licenseCodeRevealRequestId) submitButton.disabled = revealed;
  }
});

admin$('#licenseCodeIssueForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const batchId = adminState.licenseCodeBatchId;
  const serialNumbers = admin$$('#adminLicenseCodesList input[name="serial_number"]:checked')
    .map((checkbox) => checkbox.value);
  if (!batchId || !serialNumbers.length) {
    adminMessage(admin$('#licenseCodeDeliveryMessage'), 'Select a batch and at least one unissued serial number.', false);
    return;
  }

  const form = new FormData(event.currentTarget);
  const body = {
    serial_numbers: serialNumbers,
    recipient_name: form.get('recipient_name'),
    recipient_organization: form.get('recipient_organization') || null,
    recipient_email: form.get('recipient_email') || null,
    delivery_channel: form.get('delivery_channel'),
    delivery_reference: form.get('delivery_reference') || null,
  };
  const button = admin$('#licenseCodeIssueButton');
  button.disabled = true;
  let result;
  try {
    result = await adminApi(`licenses/batches/${encodeURIComponent(batchId)}/issue`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (error) {
    adminMessage(admin$('#licenseCodeDeliveryMessage'), error.message, false);
    button.disabled = false;
    return;
  }
  adminMessage(
    admin$('#licenseCodeDeliveryMessage'),
    `Marked ${result.issued_count} serial number(s) as issued. The delivery action was audited.`,
    true,
  );
  await loadAdminProducts();
  try {
    await loadLicenseCodeInventory(batchId);
  } catch (error) {
    admin$('#adminLicenseCodesState').className = 'state-panel error-state';
    admin$('#adminLicenseCodesState').textContent = error.message || 'Code inventory refresh failed.';
    adminMessage(
      admin$('#licenseCodeDeliveryMessage'),
      `The codes were marked issued, but their status could not be refreshed: ${error.message}`,
      false,
    );
    button.disabled = false;
  }
});

admin$('#licenseBatchForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = {
    count: Number(form.get('count')),
    seats: Number(form.get('seats')),
    product_id: form.get('product_id'),
    edition_id: form.get('edition_id'),
    license_model: form.get('license_model'),
    start_date: form.get('start_date'),
    expiry_date: form.get('expiry_date') || null,
  };
  const button = admin$('#licenseBatchButton');
  button.disabled = true;
  adminState.licenseBatchCodes = null;
  admin$('#licenseBatchDownload').classList.add('hidden');
  try {
    const result = await adminApi('licenses/batches', { method: 'POST', body: JSON.stringify(body) });
    adminState.licenseBatchCodes = result.codes;
    admin$('#licenseBatchDownload').classList.remove('hidden');
    adminMessage(
      admin$('#licenseBatchMessage'),
      `Generated ${result.count} codes. Download and store the CSV securely. New keys can be revealed individually later; older hash-only codes can be restored if you still have the original key.`,
      true,
    );
    await loadAdminProducts();
  } catch (error) {
    adminMessage(admin$('#licenseBatchMessage'), error.message, false);
  } finally { button.disabled = false; }
});

admin$('#licenseBatchDownload').addEventListener('click', () => {
  const codes = adminState.licenseBatchCodes;
  if (!Array.isArray(codes) || !codes.length) {
    adminMessage(admin$('#licenseBatchMessage'), 'This batch is no longer available for download. It cannot be retrieved from the server.', false);
    admin$('#licenseBatchDownload').classList.add('hidden');
    return;
  }
  const csv = ['serial_number,activation_key', ...codes.map((code) => `${code.serial_number},${code.activation_key}`)].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `prathamone-license-codes-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
});

admin$('#licenseIssueForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  let additionalEntitlements = [];
  try {
    const raw = String(form.get('entitlements') || '').trim();
    if (raw) {
      additionalEntitlements = JSON.parse(raw);
      if (!Array.isArray(additionalEntitlements)) throw new Error('Additional entitlements must be a JSON array.');
    }
  } catch (error) {
    adminMessage(admin$('#licenseIssueMessage'), error.message || 'Additional entitlements contain invalid JSON.', false);
    return;
  }
  const binding = String(form.get('company_binding') || '').trim();
  const entitlements = [
    { key: 'company.binding', value_type: 'text', value: binding },
    { key: 'license.model', value_type: 'text', value: form.get('license_model') },
    ...additionalEntitlements,
  ];
  const keys = entitlements.map((item) => item?.key);
  if (keys.some((key) => typeof key !== 'string') || new Set(keys).size !== keys.length) {
    adminMessage(admin$('#licenseIssueMessage'), 'Entitlement keys must be valid and unique; company.binding and license.model are managed above.', false);
    return;
  }
  const body = {
    customer_mode: form.get('customer_mode'),
    product_id: form.get('product_id'),
    edition_id: form.get('edition_id'),
    company_binding: binding,
    start_date: form.get('start_date'),
    expiry_date: form.get('expiry_date') || null,
    status: form.get('status'),
    entitlements,
  };
  if (body.customer_mode === 'new') {
    body.customer_email = form.get('customer_email');
    body.customer_name = form.get('customer_name');
    body.customer_company = form.get('customer_company');
  } else {
    body.organization_id = form.get('organization_id');
  }
  const button = admin$('#licenseIssueButton');
  button.disabled = true;
  try {
    const result = await adminApi('licenses', { method: 'POST', body: JSON.stringify(body) });
    adminMessage(
      admin$('#licenseIssueMessage'),
      `Issued ${result.license.serial_number}. Activation key: ${result.license.license_key}. Save and deliver it securely; it cannot be retrieved again.`,
      true,
    );
    formElement.reset();
    admin$('#licenseStartDate').value = new Date().toISOString().slice(0, 10);
    toggleLicenseCustomerMode();
    await loadAdminProducts();
  } catch (error) {
    adminMessage(admin$('#licenseIssueMessage'), error.message, false);
  } finally { button.disabled = false; }
});

admin$('#licensePolicyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const evaluationPolicy = {};
  for (const key of ['allow_dashboard', 'allow_read_only_records', 'allow_reports', 'allow_backups', 'allow_exports']) {
    evaluationPolicy[key] = admin$(`#licensePolicyForm [name="${key}"]`).checked;
  }
  evaluationPolicy.locked_modules = String(form.get('locked_modules') || '').split(',').map((module) => module.trim()).filter(Boolean);
  const body = {
    subscription_grace_days: Number(form.get('subscription_grace_days')),
    rollout_stage: form.get('rollout_stage'),
    evaluation_policy: evaluationPolicy,
  };
  const button = admin$('#licensePolicySaveButton');
  button.disabled = true;
  try {
    const { policy } = await adminApi(
      `products/${form.get('product_id')}/editions/${form.get('edition_id')}/evaluation-policy`,
      { method: 'PUT', body: JSON.stringify(body) },
    );
    adminMessage(admin$('#licensePolicyMessage'), `Edition policy saved (${policy.rollout_stage} mode).`, true);
  } catch (error) {
    adminMessage(admin$('#licensePolicyMessage'), error.message, false);
  } finally { button.disabled = false; }
});

admin$('#adminLicensesList').addEventListener('click', async (event) => {
  const detailsButton = event.target.closest('[data-license-details]');
  if (detailsButton) {
    const panel = admin$(`[data-license-detail-panel="${detailsButton.dataset.licenseDetails}"]`);
    const detailRow = admin$(`[data-license-detail-row="${detailsButton.dataset.licenseDetails}"]`);
    if (panel.dataset.loaded === 'true') {
      const show = detailRow.hidden;
      detailRow.hidden = !show;
      panel.classList.toggle('hidden', !show);
    } else {
      detailRow.hidden = false;
      await loadLicenseDetails(detailsButton.dataset.licenseDetails, panel);
    }
    return;
  }

  const revokeButton = event.target.closest('[data-activation-revoke]');
  if (revokeButton) {
    if (!window.confirm('Revoke this activation? The action is audited and cannot be undone.')) return;
    revokeButton.disabled = true;
    try {
      await adminApi(`licenses/${revokeButton.dataset.licenseId}/activations/${revokeButton.dataset.activationRevoke}/revoke`, { method: 'POST', body: '{}' });
      await loadAdminProducts();
    } catch (error) {
      adminMessage(admin$('#adminError'), error.message, false);
      admin$('#adminError').classList.remove('hidden');
      revokeButton.disabled = false;
    }
    return;
  }

  const suspendButton = event.target.closest('[data-license-suspend]');
  if (suspendButton) {
    if (!window.confirm('Suspend this license? This is audited and will change its entitlement state.')) return;
    suspendButton.disabled = true;
    try {
      await adminApi(`licenses/${suspendButton.dataset.licenseSuspend}/suspend`, { method: 'POST', body: '{}' });
      await loadAdminProducts();
    } catch (error) {
      adminMessage(admin$('#adminError'), error.message, false);
      admin$('#adminError').classList.remove('hidden');
      suspendButton.disabled = false;
    }
    return;
  }

  const renewButton = event.target.closest('[data-license-renew]');
  if (renewButton) {
    const licenseId = renewButton.dataset.licenseRenew;
    const expiryDate = admin$(`[data-license-renew-date="${licenseId}"]`).value;
    if (!expiryDate) {
      adminMessage(admin$('#adminError'), 'Choose the renewal expiry date first.', false);
      admin$('#adminError').classList.remove('hidden');
      return;
    }
    renewButton.disabled = true;
    try {
      await adminApi(`licenses/${licenseId}/renew`, {
        method: 'POST',
        body: JSON.stringify({ start_date: new Date().toISOString().slice(0, 10), expiry_date: expiryDate }),
      });
      await loadAdminProducts();
    } catch (error) {
      adminMessage(admin$('#adminError'), error.message, false);
      admin$('#adminError').classList.remove('hidden');
      renewButton.disabled = false;
    }
  }
});

admin$('#adminRegistrationFilters').addEventListener('submit', (event) => {
  event.preventDefault();
  loadLicenseRegistrations({ resetPage: true });
});

admin$('#adminRegistrationReset').addEventListener('click', () => {
  admin$('#adminRegistrationFilters').reset();
  loadLicenseRegistrations({ resetPage: true });
});

admin$('#adminRegistrationPagination').addEventListener('click', (event) => {
  const button = event.target.closest('[data-registration-page]');
  if (!button || button.disabled) return;
  adminState.registrationPage += button.dataset.registrationPage === 'next' ? 1 : -1;
  loadLicenseRegistrations();
});

showAdminPortal();
