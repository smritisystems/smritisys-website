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
  releases: [],
  products: [],
  licenses: [],
  registrationPage: 1,
  registrationRequestId: 0,
  reactivationRequestId: 0,
  selectedReactivationId: null,
  organizations: [],
  organizationDetailRequestId: 0,
  partners: [],
  partnerDealPage: 1,
  followUpPage: 1,
  followUpTaskPage: 1,
  partnerDealRequestId: 0,
  followUpRequestId: 0,
  followUpTaskRequestId: 0,
  licenseBatchCodes: null,
  licenseCodeBatchId: null,
  licenseCodeRows: [],
  licenseCodeAllocations: [],
  registrations: [],
  customerProfileId: null,
  supportTickets: [],
  supportTicketId: null,
  supportPage: 1,
  supportTotal: 0,
  supportListRequestId: 0,
  supportDetailRequestId: 0,
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
  element.style.color = ok ? 'var(--accent)' : 'var(--red)';
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

function clearAdminCustomerResetLink() {
  const link = admin$('#adminCustomerResetLink');
  if (link) link.value = '';
  admin$('#adminCustomerResetResult')?.classList.add('hidden');
}

function showAdminLogin(message = '') {
  const contextDialog = admin$('#organizationContextDialog');
  if (contextDialog?.open) contextDialog.close();
  const revealDialog = admin$('#licenseCodeRevealDialog');
  if (revealDialog?.open) revealDialog.close();
  adminState.supportTickets = [];
  adminState.supportTicketId = null;
  adminState.supportPage = 1;
  adminState.supportTotal = 0;
  adminState.supportListRequestId += 1;
  adminState.supportDetailRequestId += 1;
  adminState.partnerDealPage = 1;
  adminState.followUpPage = 1;
  adminState.followUpTaskPage = 1;
  adminState.partnerDealRequestId += 1;
  adminState.followUpRequestId += 1;
  adminState.followUpTaskRequestId += 1;
  admin$('#adminSupportList').textContent = '';
  admin$('#adminSupportDetail').textContent = '';
  admin$('#adminSupportPagination').classList.add('hidden');
  admin$('#adminPartnerDealsList').textContent = '';
  admin$('#adminFollowUpsList').textContent = '';
  admin$('#adminFollowUpTasksList').textContent = '';
  admin$('#adminPartnerDealsPagination').classList.add('hidden');
  admin$('#adminFollowUpsPagination').classList.add('hidden');
  admin$('#adminFollowUpTasksPagination').classList.add('hidden');
  admin$('#adminFollowUpTaskForm').reset();
  admin$('#adminFollowUpTaskMessage').textContent = '';
  admin$('#adminFollowUpTaskAssignee').innerHTML = '<option value="">Unassigned</option>';
  admin$('#adminPartnerDealSearch').value = '';
  admin$('#adminPartnerDealStatus').value = '';
  clearCustomerInviteLink();
  clearAdminCustomerResetLink();
  adminState.customerProfileId = null;
  admin$('#adminCustomerProfilePanel').classList.add('hidden');
  admin$('#adminCustomerProfileForm').reset();
  admin$('#adminCustomerAddresses').textContent = '';
  admin$('#adminCustomerLicenses').textContent = '';
  admin$('#adminCustomerLicensesState').textContent = '';
  admin$('#adminCustomerProfileIdentity').textContent = '';
  admin$('#adminCustomerProfileRelationships').textContent = '';
  admin$('#adminCustomersList').textContent = '';
  admin$('#adminCustomerSearch').value = '';
  admin$('#adminCustomerProfileMessage').textContent = '';
  admin$('#adminCustomerResetMessage').textContent = '';
  setAdminCustomerProfileEditMode(false);
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

    const operational = data.operational_metrics;
    const partnerCategories = operational.active_partners_by_category;
    const activePartners = partnerCategories.reduce((total, category) => total + Number(category.count), 0);
    const utilization = operational.license_utilization;
    const licensedSeats = Number(utilization.licensed_seats);
    const activeActivations = Number(utilization.active_activations);
    const utilizationPercent = licensedSeats > 0
      ? `${((activeActivations / licensedSeats) * 100).toFixed(1)}%`
      : 'Unavailable';
    const operationalCards = [
      { label: 'Active customers', value: Number(operational.active_customer_organizations), note: 'Active customer organizations' },
      { label: 'Active memberships', value: Number(operational.active_organization_memberships), note: 'Organization memberships' },
      { label: 'Active partners', value: activePartners, note: 'Across approved partner categories' },
      {
        label: 'License utilization',
        value: licensedSeats > 0 ? `${activeActivations}/${licensedSeats}` : 'Unavailable',
        note: licensedSeats > 0
          ? `Active installations / licensed seats across ${Number(utilization.active_licenses)} active licenses · ${utilizationPercent}`
          : 'No active licensed-seat capacity is available',
      },
    ];
    admin$('#adminOperationalMetrics').innerHTML = operationalCards.map((metric) => `
      <article class="card admin-ops-card">
        <span class="stat-label">${adminEscape(metric.label)}</span>
        <strong class="stat-value">${adminEscape(metric.value.toLocaleString())}</strong>
        <span class="admin-metric-note">${adminEscape(metric.note)}</span>
      </article>
    `).join('');

    const partnerLabels = {
      channel_partner: 'Channel Partner',
      reseller: 'Reseller',
      implementation_partner: 'Implementation Partner',
      technology_partner: 'Technology Partner',
      referral_partner: 'Referral Partner',
      distributor: 'Distributor',
    };
    admin$('#adminPartnerCategoryMetrics').innerHTML = partnerCategories.map((category) => `
      <div class="admin-health-row">
        <span>${adminEscape(partnerLabels[category.category])}</span>
        <strong>${adminEscape(Number(category.count).toLocaleString())}</strong>
      </div>
    `).join('');

    const renderStatusCounts = (rows) => rows.length
      ? rows.map((row) => `
        <div class="admin-health-row">
          <span>${adminEscape(String(row.status).replaceAll('_', ' '))}</span>
          <strong>${adminEscape(Number(row.count).toLocaleString())}</strong>
        </div>
      `).join('')
      : '<p class="admin-empty-inline">No records are available.</p>';
    admin$('#adminSupportTicketMetrics').innerHTML = renderStatusCounts(operational.support_ticket_statuses);
    admin$('#adminReleaseMetrics').innerHTML = renderStatusCounts(operational.release_statuses);
    admin$('#adminCustomerOnboardingMetrics').innerHTML = renderStatusCounts(operational.customer_invitation_statuses);
    admin$('#adminDeploymentStatus').textContent = operational.deployment_status.available
      ? 'Deployment metadata is available.'
      : 'Deployment status unavailable: no deployment source is connected.';

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

    const recovery = data.recovery;
    const retentionDays = Number(recovery?.retention_days);
    const recoveryAvailable = recovery?.provider === 'cloudflare_d1_time_travel' &&
      recovery.status === 'available' && Number.isInteger(retentionDays) && retentionDays > 0;
    const recoveryPlanUnverified = recovery?.provider === 'cloudflare_d1_time_travel' &&
      recovery.status === 'plan_dependent' && recovery.retention_days === null;
    admin$('#adminD1Backups').innerHTML = recoveryAvailable
      ? `<p>Cloudflare D1 Time Travel provides point-in-time recovery for up to ${adminEscape(retentionDays)} days. This panel does not list recovery points or perform restores.</p><p class="admin-empty-inline">Manual backups and exports are not configured.</p>`
      : recoveryPlanUnverified
        ? '<p class="admin-empty-inline">Time Travel retention depends on the Cloudflare account plan, which has not been verified. This panel does not list recovery points or perform restores.</p><p class="admin-empty-inline">Manual backups and exports are not configured.</p>'
        : '<p class="admin-empty-inline">Recovery availability could not be verified. This panel does not list recovery points or perform restores.</p>';

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
    if (!adminState.organizations.length) {
      admin$('#adminOrganizationDetail').classList.add('hidden');
      return adminStatePanel('adminOrganizationsState', 'adminOrganizationsList', 'No organizations found.');
    }
    admin$('#adminOrganizationsState').classList.add('hidden');
    renderAdminOrganizations();
  } catch (error) { adminStatePanel('adminOrganizationsState', 'adminOrganizationsList', 'Organizations are unavailable.', true); }
}

function renderAdminOrganizations() {
  const search = admin$('#adminOrganizationSearch').value.trim().toLowerCase();
  const status = admin$('#adminOrganizationStatus').value;
  const relationship = admin$('#adminOrganizationType').value;
  const organizations = adminState.organizations.filter((organization) => {
    const types = (organization.relationship_types || '').split(',').map((type) => type.trim().toLowerCase()).filter(Boolean);
    const searchable = [
      organization.name, organization.legal_name, organization.address, organization.city,
      organization.state, organization.pincode, organization.country, organization.phone,
      organization.gst_number, organization.tax_id, organization.website,
    ].join(' ').toLowerCase();
    const matchesRelationship = !relationship
      || (relationship === 'customer' && types.includes('customer'))
      || (relationship === 'partner' && types.some((type) => !['customer', 'internal'].includes(type)))
      || (relationship === 'internal' && types.includes('internal'))
      || (relationship === 'unclassified' && types.length === 0);
    return (!search || searchable.includes(search))
      && (!status || String(organization.status).toLowerCase() === status)
      && matchesRelationship;
  });
  const list = admin$('#adminOrganizationsList');
  list.classList.remove('hidden');
  list.innerHTML = `<table class="admin-table"><thead><tr><th>Organization</th><th>Relationships</th><th>Status</th><th>Active members</th><th>Details</th></tr></thead><tbody>${organizations.length ? organizations.map((organization) => `<tr><td><strong>${adminEscape(organization.name)}</strong><br><small>${adminEscape(organization.legal_name || 'Legal name not provided')}</small></td><td>${adminEscape((organization.relationship_types || '').split(',').filter(Boolean).join(', ') || 'Unclassified')}</td><td><span class="status">${adminEscape(organization.status)}</span></td><td>${adminEscape(organization.member_count)}</td><td><button class="text-button" type="button" data-admin-organization-detail="${adminEscape(organization.id)}">View details</button></td></tr>`).join('') : '<tr><td colspan="5">No organizations match these filters.</td></tr>'}</tbody></table>`;
}

async function loadAdminOrganizationDetail(organizationId) {
  const panel = admin$('#adminOrganizationDetail');
  const requestId = ++adminState.organizationDetailRequestId;
  panel.classList.remove('hidden');
  panel.textContent = 'Loading organization details...';
  try {
    const data = await adminApi(`admin/organizations/${encodeURIComponent(organizationId)}`);
    if (requestId !== adminState.organizationDetailRequestId) return;
    const organization = data.organization;
    const fields = [
      ['Organization ID', organization.id], ['Name', organization.name],
      ['Legal name', organization.legal_name], ['Status', organization.status],
      ['Relationships', (organization.relationship_types || '').split(',').filter(Boolean).join(', ')],
      ['GST number', organization.gst_number], ['Tax ID', organization.tax_id],
      ['Phone', organization.phone], ['Website', organization.website],
      ['Address', [organization.address, organization.city, organization.state, organization.pincode, organization.country].filter(Boolean).join(', ')],
      ['Created', organization.created_at],
    ];
    const members = data.members || [];
    const relationships = data.relationships || [];
    const licenses = data.licenses || [];
    panel.innerHTML = `<div class="section-head"><div><span class="eyebrow">Organization profile</span><h3>${adminEscape(organization.name)}</h3></div><button class="secondary" type="button" data-admin-organization-close>Close details</button></div><div class="admin-organization-detail-grid"><article class="card"><h4>Profile</h4><dl class="admin-organization-fields">${fields.map(([label, value]) => `<div><dt>${adminEscape(label)}</dt><dd>${adminEscape(value || 'Not provided')}</dd></div>`).join('')}</dl></article><article class="card"><h4>Members and roles <span class="muted">(${members.length})</span></h4>${members.length ? `<div class="table-scroll"><table><thead><tr><th>Name / email</th><th>Account</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead><tbody>${members.map((member) => `<tr><td>${adminEscape(member.name || 'Name unavailable')}<br><small>${adminEscape(member.email || 'Email unavailable')}</small></td><td>${adminEscape(member.account_type)}</td><td>${adminEscape(member.member_role)}</td><td>${adminEscape(member.status)}</td><td>${adminEscape(member.created_at || 'Not available')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No organization members found.</p>'}</article><article class="card"><h4>Partner / customer links <span class="muted">(${relationships.length})</span></h4>${relationships.length ? `<div class="table-scroll"><table><thead><tr><th>Link type</th><th>Organization</th><th>Status</th><th>Since</th></tr></thead><tbody>${relationships.map((link) => `<tr><td>${adminEscape(link.relationship_type)}</td><td>${adminEscape(link.organization_name)}</td><td>${adminEscape(link.status)}</td><td>${adminEscape(link.created_at || 'Not available')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No linked partner or customer organizations.</p>'}</article><article class="card"><h4>Product licenses <span class="muted">(${licenses.length})</span></h4>${licenses.length ? `<div class="table-scroll"><table><thead><tr><th>Product</th><th>Serial</th><th>Status</th><th>Seats</th><th>Term</th></tr></thead><tbody>${licenses.map((license) => `<tr><td>${adminEscape(license.product_name)}<br><small>${adminEscape(license.product_code)}</small></td><td>${adminEscape(license.serial_number || 'Not assigned')}</td><td>${adminEscape(license.status)}</td><td>${adminEscape(license.seats)}</td><td>${adminEscape(license.starts_at)} – ${adminEscape(license.expires_at || 'No expiry')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No product licenses are assigned to this organization.</p>'}</article></div>`;
  } catch (error) {
    if (requestId !== adminState.organizationDetailRequestId) return;
    panel.textContent = `Organization details could not be loaded: ${error.message}`;
  }
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
  const organizationId = admin$('#partnerContactOrganization').value;
  const hasOrganization = Boolean(organizationId);
  const name = admin$('#partnerOrganizationName');
  admin$('#partnerOrganizationNameWrap').classList.toggle('hidden', hasOrganization);
  name.required = !hasOrganization;
  name.disabled = hasOrganization;
  const organization = adminState.organizations.find((item) => String(item.id) === organizationId);
  const fields = {
    partnerOrganizationLegalName: 'legal_name',
    partnerOrganizationPhone: 'phone',
    partnerOrganizationAddress: 'address',
    partnerOrganizationCity: 'city',
    partnerOrganizationState: 'state',
    partnerOrganizationPincode: 'pincode',
    partnerOrganizationCountry: 'country',
    partnerOrganizationTaxId: 'tax_id',
    partnerOrganizationWebsite: 'website',
  };
  for (const [id, key] of Object.entries(fields)) {
    admin$(`#${id}`).value = organization?.[key] || '';
  }
}

async function loadAdminCustomerInvites() {
  try {
    const data = await adminApi('admin/customer-invites');
    const list = admin$('#adminCustomerInvitesList');
    if (!data.invites.length) return adminStatePanel('adminCustomerInvitesState', 'adminCustomerInvitesList', 'No customer invitations found.');
    admin$('#adminCustomerInvitesState').classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = `<table class="admin-table"><thead><tr><th>Email</th><th>Organization</th><th>Partner source</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead><tbody>${data.invites.map((invite) => `<tr><td>${adminEscape(invite.email)}</td><td>${adminEscape(invite.company)}</td><td>${adminEscape(invite.invited_by_partner || 'Direct')}</td><td><span class="status">${adminEscape(invite.status)}</span></td><td>${adminEscape(invite.expires_at)}</td><td>${invite.status === 'pending' ? `<button class="text-button" type="button" data-customer-invite-revoke="${adminEscape(invite.id)}">Revoke</button>` : '—'}</td></tr>`).join('')}</tbody></table>`;
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

function setAdminCustomerProfileEditMode(enabled) {
  admin$('#adminCustomerProfileForm').querySelectorAll('input, textarea').forEach((input) => {
    input.disabled = !enabled;
  });
  admin$('#adminCustomerAddressAdd').classList.toggle('hidden', !enabled);
  admin$('#adminCustomerProfileEdit').classList.toggle('hidden', enabled);
  admin$('#adminCustomerProfileSave').classList.toggle('hidden', !enabled);
  admin$('#adminCustomerProfileCancel').classList.toggle('hidden', !enabled);
}

function renderAdminCustomerAddress(address = {}) {
  const isSaved = Boolean(address.id);
  return `<fieldset class="card" data-customer-address-row${isSaved ? ` data-address-id="${adminEscape(address.id)}"` : ''}>
    <legend>${isSaved ? `Address ${adminEscape(address.id)}` : 'New address'}</legend>
    <div class="form-grid">
      <div><label>Address type<input name="address_type" maxlength="30" value="${adminEscape(address.address_type || 'billing')}" disabled required /></label></div>
      <div><label>Country<input name="country" maxlength="120" value="${adminEscape(address.country || (isSaved ? '' : 'India'))}" disabled /></label></div>
      <div class="full"><label>Address line 1<input name="address_line1" maxlength="255" value="${adminEscape(address.address_line1 || '')}" disabled required /></label></div>
      <div class="full"><label>Address line 2<input name="address_line2" maxlength="255" value="${adminEscape(address.address_line2 || '')}" disabled /></label></div>
      <div><label>City<input name="city" maxlength="120" value="${adminEscape(address.city || '')}" disabled /></label></div>
      <div><label>State / province<input name="state" maxlength="120" value="${adminEscape(address.state || '')}" disabled /></label></div>
      <div><label>Postal code<input name="postal_code" maxlength="32" value="${adminEscape(address.postal_code || '')}" disabled /></label></div>
      <div><label><input name="is_default" type="checkbox" ${address.is_default ? 'checked' : ''} disabled /> Default address</label></div>
    </div>
    ${isSaved ? '' : '<button class="text-button" type="button" data-remove-new-customer-address>Remove unsaved address</button>'}
  </fieldset>`;
}

async function loadAdminCustomers(query = admin$('#adminCustomerSearch').value.trim()) {
  adminStatePanel('adminCustomersState', 'adminCustomersList', 'Loading customer accounts...');
  try {
    const data = await adminApi(`admin/customers${query ? `?q=${encodeURIComponent(query)}` : ''}`);
    const list = admin$('#adminCustomersList');
    if (!data.customers.length) {
      return adminStatePanel('adminCustomersState', 'adminCustomersList', query ? 'No matching customer accounts found.' : 'No customer accounts found.');
    }
    admin$('#adminCustomersState').classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = `<table class="admin-table"><thead><tr><th>Customer ID</th><th>Contact</th><th>Email</th><th>Organization</th><th>Phone</th><th>Status</th><th>Action</th></tr></thead><tbody>${data.customers.map((customer) => `<tr><td>${adminEscape(customer.id)}</td><td>${adminEscape(customer.name || '—')}</td><td>${adminEscape(customer.email)}</td><td>${adminEscape(customer.organization_name || customer.company || '—')}</td><td>${adminEscape(customer.phone || '—')}</td><td><span class="status">${adminEscape(customer.status)}</span></td><td><button class="text-button" type="button" data-admin-customer-profile="${adminEscape(customer.id)}">Manage profile</button></td></tr>`).join('')}</tbody></table>`;
    list.querySelectorAll('[data-admin-customer-profile]').forEach((button) => {
      button.addEventListener('click', () => openAdminCustomerProfile(button.dataset.adminCustomerProfile));
    });
  } catch (error) {
    adminStatePanel('adminCustomersState', 'adminCustomersList', error.message || 'Customer accounts are unavailable.', true);
  }
}

async function openAdminCustomerProfile(customerId) {
  const panel = admin$('#adminCustomerProfilePanel');
  panel.classList.remove('hidden');
  admin$('#adminCustomerProfileMessage').textContent = '';
  admin$('#adminCustomerResetMessage').textContent = '';
  admin$('#adminCustomerResetResult').classList.add('hidden');
  admin$('#adminCustomerResetLink').value = '';
  adminState.customerProfileId = customerId;
  try {
    const data = await adminApi(`admin/customers/${encodeURIComponent(customerId)}`);
    if (adminState.customerProfileId !== customerId) return false;
    const profile = data.profile;
    admin$('#adminCustomerProfileHeading').textContent = profile.name || `Customer ${profile.id}`;
    admin$('#adminCustomerProfileIdentity').innerHTML = `Customer ID <strong>${adminEscape(profile.id)}</strong> · ${adminEscape(profile.email)} · <span class="status">${adminEscape(profile.status)}</span>${profile.company ? ` · ${adminEscape(profile.company)}` : ''}`;
    const values = {
      adminCustomerProfileName: profile.name,
      adminCustomerProfilePhone: profile.phone,
      adminCustomerProfileGst: profile.gst_number,
      adminCustomerProfileWebsite: profile.website,
      adminCustomerProfileTimezone: profile.timezone || 'Asia/Kolkata',
      adminCustomerProfileBio: profile.bio,
    };
    for (const [id, value] of Object.entries(values)) admin$(`#${id}`).value = value || '';
    setAdminCustomerProfileEditMode(false);
    admin$('#adminCustomerResetButton').disabled = !['active', 'trial'].includes(profile.status);
    const organizations = data.organizations || [];
    const partners = (data.partners || []).map((item) =>
      `<li>${adminEscape(item.name)} · ${adminEscape(item.status)}</li>`);
    admin$('#adminCustomerAddresses').innerHTML = (data.addresses || []).length
      ? data.addresses.map((item) => renderAdminCustomerAddress(item)).join('')
      : '<p class="muted">No saved addresses.</p>';
    admin$('#adminCustomerProfileRelationships').innerHTML = [
      `<h4>Organizations</h4>${organizations.length ? `<ul>${organizations.map((item) => {
        const details = [item.address, item.city, item.state, item.pincode, item.country, item.phone, item.gst_number, item.website].filter(Boolean).join(' · ');
        return `<li><strong>${adminEscape(item.name)}</strong>${item.legal_name ? ` · ${adminEscape(item.legal_name)}` : ''} · ${adminEscape(item.member_role)} (${adminEscape(item.membership_status)})<small class="muted">${adminEscape(details)}</small></li>`;
      }).join('')}</ul>` : '<p>No organization membership.</p>'}`,
      `<h4>Assigned partners</h4>${partners.length ? `<ul>${partners.join('')}</ul>` : '<p>No active partner assignment.</p>'}`,
    ].join('');
    await loadAdminCustomerLicenses(customerId);
    return true;
  } catch (error) {
    if (adminState.customerProfileId !== customerId) return false;
    panel.classList.add('hidden');
    adminMessage(admin$('#adminError'), error.message || 'Customer profile is unavailable.', false);
    admin$('#adminError').className = 'state-panel error-state';
    return false;
  }
}

function renderAdminCustomerLicenses(data) {
  const state = admin$('#adminCustomerLicensesState');
  const list = admin$('#adminCustomerLicenses');
  const registrations = data.registrations || [];
  if (!registrations.length) {
    list.classList.add('hidden');
    state.className = 'state-panel';
    state.textContent = 'No licenses are linked to this customer.';
    return;
  }

  state.classList.add('hidden');
  list.classList.remove('hidden');
  const scopeNote = Number(data.total) > registrations.length
    ? `<p class="muted">Showing ${adminEscape(registrations.length)} of ${adminEscape(data.total)} licenses. Use “Manage all licenses” for the complete list.</p>`
    : '';
  list.innerHTML = `${scopeNote}<div class="admin-license-table-wrap"><table class="admin-license-table">
    <thead><tr><th>Serial / status</th><th>Product / edition</th><th>Validity</th><th>Installations</th><th>Activity</th></tr></thead>
    <tbody>${registrations.map((registration) => {
      const id = adminEscape(registration.license_id);
      return `<tr>
        <td><strong>${adminEscape(registration.serial_number || '—')}</strong><small>${adminEscape(registration.license_status || 'Unknown')}</small></td>
        <td><strong>${adminEscape(registration.product?.name || 'Product')}</strong><small>${adminEscape(registration.edition?.name || 'No edition')}</small></td>
        <td>${adminEscape(registration.start_date || '—')} → ${adminEscape(registration.expiry_date || 'Perpetual')}</td>
        <td>${adminEscape(registration.active_activation_count)} active / ${adminEscape(registration.total_activation_count)} total</td>
        <td><button class="secondary" type="button" data-customer-license-inspect="${id}">Inspect activity</button></td>
      </tr><tr class="admin-license-detail-row" data-customer-license-detail-row="${id}" hidden><td colspan="5"><div class="license-details hidden" data-customer-license-detail-panel="${id}"></div></td></tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

async function loadAdminCustomerLicenses(customerId) {
  const state = admin$('#adminCustomerLicensesState');
  const list = admin$('#adminCustomerLicenses');
  state.className = 'state-panel';
  state.textContent = 'Loading customer licenses...';
  list.classList.add('hidden');
  list.textContent = '';
  try {
    const data = await adminApi(`admin/license-registrations?customer_id=${encodeURIComponent(customerId)}&page_size=100`);
    if (adminState.customerProfileId !== customerId) return;
    renderAdminCustomerLicenses(data);
  } catch (error) {
    if (adminState.customerProfileId !== customerId) return;
    state.className = 'state-panel error-state';
    state.textContent = `Customer licenses are unavailable: ${error.message}`;
  }
}

async function loadAdminPartners() {
  try {
    const data = await adminApi('admin/partners');
    adminState.partners = data.partners || [];
    const partnerTypes = data.partner_types || [];
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
      list.innerHTML = `<h3>Partner organizations</h3><div class="admin-partner-table-wrap"><table class="admin-table admin-partner-table"><thead><tr><th>Organization</th><th>Location</th><th>Phone</th><th>Status</th><th>Partner type</th><th>Contacts</th><th>Customers</th><th>Codes allocated / claimed</th><th>Pending invites</th><th>Actions</th></tr></thead><tbody>${adminState.partners.map((partner) => `<tr><td><strong>${adminEscape(partner.name)}</strong><small>${adminEscape(partner.legal_name || '')}</small></td><td>${adminEscape([partner.address, partner.city, partner.state, partner.pincode, partner.country].filter(Boolean).join(', ') || 'Not provided')}</td><td>${adminEscape(partner.phone || 'Not provided')}</td><td><span class="status">${adminEscape(partner.status)}</span></td><td><div class="admin-partner-controls"><select data-partner-type-select="${adminEscape(partner.id)}" aria-label="Partner type for ${adminEscape(partner.name)}">${partnerTypes.map((type) => `<option value="${adminEscape(type)}" ${type === partner.partner_type ? 'selected' : ''}>${adminEscape(type.replace(/_/g, ' '))}</option>`).join('')}</select><button class="text-button" type="button" data-partner-type-save="${adminEscape(partner.id)}">Save</button></div></td><td>${adminEscape(partner.member_count)}</td><td>${adminEscape(partner.linked_customer_count)}</td><td>${adminEscape(partner.allocated_code_count)} / ${adminEscape(partner.claimed_code_count)}</td><td>${adminEscape(partner.pending_invite_count)}</td><td><button class="text-button" type="button" data-partner-status="${adminEscape(partner.id)}:${partner.status === 'active' ? 'inactive' : 'active'}">${partner.status === 'active' ? 'Deactivate' : 'Reactivate'}</button></td></tr>`).join('')}</tbody></table></div><h3>Customer links</h3>${data.links.length ? `<div class="admin-partner-table-wrap"><table class="admin-table"><thead><tr><th>Partner</th><th>Customer</th><th>Status</th><th>Action</th></tr></thead><tbody>${data.links.map((link) => `<tr><td>${adminEscape(link.partner_name)}</td><td>${adminEscape(link.customer_name)}</td><td><span class="status">${adminEscape(link.status)}</span></td><td>${link.status === 'active' ? `<button class="text-button" type="button" data-partner-link-revoke="${adminEscape(link.partner_organization_id)}:${adminEscape(link.customer_organization_id)}">Unlink</button>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No customer links recorded.</p>'}`;
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
      list.querySelectorAll('[data-partner-type-save]').forEach((button) => button.addEventListener('click', async () => {
        const partnerId = button.dataset.partnerTypeSave;
        const partnerType = list.querySelector(`[data-partner-type-select="${partnerId}"]`).value;
        button.disabled = true;
        try {
          await adminApi(`admin/partners/${partnerId}`, {
            method: 'PATCH',
            body: JSON.stringify({ partner_type: partnerType }),
          });
          await loadAdminPartners();
        } catch (error) {
          adminMessage(admin$('#adminError'), error.message, false);
          admin$('#adminError').className = 'state-panel error-state';
        } finally {
          button.disabled = false;
        }
      }));
      list.querySelectorAll('[data-partner-status]').forEach((button) => button.addEventListener('click', async () => {
        const [partnerId, status] = button.dataset.partnerStatus.split(':');
        const action = status === 'inactive' ? 'deactivate' : 'reactivate';
        if (!window.confirm(`${action === 'deactivate' ? 'Deactivating' : 'Reactivating'} this partner changes portal access. Existing customer links, code allocations, and audit history are retained. Continue?`)) return;
        button.disabled = true;
        try {
          await adminApi(`admin/partners/${partnerId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status }),
          });
          await Promise.all([loadAdminPartners(), loadAdminOrganizations()]);
        } catch (error) {
          adminMessage(admin$('#adminError'), error.message, false);
          admin$('#adminError').className = 'state-panel error-state';
        } finally {
          button.disabled = false;
        }
      }));
    }

    const members = data.members || [];
    if (!members.length) {
      adminStatePanel('adminPartnerMembersState', 'adminPartnerMembersList', 'No partner contacts found.');
    } else {
      const partnerNames = new Map(adminState.partners.map((partner) => [String(partner.id), partner.name]));
      const memberState = admin$('#adminPartnerMembersState');
      const memberList = admin$('#adminPartnerMembersList');
      memberState.classList.add('hidden');
      memberList.classList.remove('hidden');
      memberList.innerHTML = `<div class="admin-partner-table-wrap"><table class="admin-table"><thead><tr><th>Partner</th><th>Contact</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>${members.map((member) => `<tr><td>${adminEscape(partnerNames.get(String(member.partner_organization_id)) || `Partner ${member.partner_organization_id}`)}</td><td>${adminEscape(member.name || 'Unnamed contact')}</td><td>${adminEscape(member.email)}</td><td><div class="admin-partner-controls"><select data-partner-member-role="${adminEscape(member.id)}" aria-label="Partner role for ${adminEscape(member.email)}"><option value="partner_admin" ${member.partner_role === 'partner_admin' ? 'selected' : ''}>Partner administrator</option><option value="partner_member" ${member.partner_role === 'partner_member' ? 'selected' : ''}>Partner member</option></select><button class="text-button" type="button" data-partner-member-role-save="${adminEscape(member.id)}:${adminEscape(member.partner_organization_id)}">Save</button></div></td><td><span class="status">${adminEscape(member.status)}</span></td><td><button class="text-button" type="button" data-partner-member-status="${adminEscape(member.id)}:${adminEscape(member.partner_organization_id)}:${member.status === 'active' ? 'inactive' : 'active'}">${member.status === 'active' ? 'Deactivate' : 'Reactivate'}</button></td></tr>`).join('')}</tbody></table></div>`;
      memberList.querySelectorAll('[data-partner-member-role-save]').forEach((button) => button.addEventListener('click', async () => {
        const [membershipId, partnerId] = button.dataset.partnerMemberRoleSave.split(':');
        const partnerRole = memberList.querySelector(`[data-partner-member-role="${membershipId}"]`).value;
        button.disabled = true;
        try {
          await adminApi(`admin/partners/${partnerId}/members/${membershipId}`, {
            method: 'PATCH',
            body: JSON.stringify({ partner_role: partnerRole }),
          });
          await loadAdminPartners();
        } catch (error) {
          adminMessage(admin$('#adminError'), error.message, false);
          admin$('#adminError').className = 'state-panel error-state';
        } finally {
          button.disabled = false;
        }
      }));
      memberList.querySelectorAll('[data-partner-member-status]').forEach((button) => button.addEventListener('click', async () => {
        const [membershipId, partnerId, status] = button.dataset.partnerMemberStatus.split(':');
        const action = status === 'inactive' ? 'deactivate' : 'reactivate';
        if (!window.confirm(`${action === 'deactivate' ? 'Deactivate' : 'Reactivate'} this partner contact?`)) return;
        button.disabled = true;
        try {
          await adminApi(`admin/partners/${partnerId}/members/${membershipId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status }),
          });
          await loadAdminPartners();
        } catch (error) {
          adminMessage(admin$('#adminError'), error.message, false);
          admin$('#adminError').className = 'state-panel error-state';
        } finally {
          button.disabled = false;
        }
      }));
    }
    await loadAdminPartnerInvites();
  } catch (error) {
    adminStatePanel('adminPartnersState', 'adminPartnersList', 'Partner organizations are unavailable.', true);
    adminStatePanel('adminPartnerMembersState', 'adminPartnerMembersList', 'Partner contacts are unavailable.', true);
  }
}

async function loadAdminPartnerDeals(page = adminState.partnerDealPage) {
  const requestId = ++adminState.partnerDealRequestId;
  const state = admin$('#adminPartnerDealsState');
  const list = admin$('#adminPartnerDealsList');
  const pagination = admin$('#adminPartnerDealsPagination');
  state.className = 'state-panel';
  state.textContent = 'Loading deal registrations...';
  list.textContent = '';
  pagination.classList.add('hidden');
  const params = new URLSearchParams({
    page: String(page),
    page_size: '50',
    q: admin$('#adminPartnerDealSearch').value.trim(),
    status: admin$('#adminPartnerDealStatus').value,
  });
  try {
    const data = await adminApi(`admin/partner-deals?${params}`);
    if (requestId !== adminState.partnerDealRequestId) return;
    adminState.partnerDealPage = data.page;
    if (!data.deals.length) {
      state.textContent = 'No deal registrations match these filters.';
      return;
    }
    state.classList.add('hidden');
    const labels = {
      submitted: 'Submitted',
      under_review: 'Under review',
      needs_information: 'Needs information',
      approved: 'Approved',
      rejected: 'Rejected',
    };
    const transitions = {
      submitted: ['submitted', 'under_review', 'needs_information', 'approved', 'rejected'],
      under_review: ['under_review', 'needs_information', 'approved', 'rejected'],
      needs_information: ['needs_information', 'under_review', 'approved', 'rejected'],
      approved: ['approved'],
      rejected: ['rejected'],
    };
    list.innerHTML = data.deals.map((deal) => `<article class="card admin-partner-deal" data-admin-partner-deal="${adminEscape(deal.id)}"><div class="section-head compact"><div><span class="eyebrow">Registration #${adminEscape(deal.id)} · ${adminEscape(deal.partner_name)}</span><h3>${adminEscape(deal.prospect_organization_name)}</h3></div><span class="status">${adminEscape(labels[deal.status] || deal.status)}</span></div>${deal.possible_duplicate ? '<p class="state-panel">Possible duplicate submission — review manually; this is only a warning.</p>' : ''}<div class="admin-organization-detail-grid"><div><strong>Submitted</strong><p>${adminEscape(deal.created_at)}</p></div><div><strong>Contact</strong><p>${adminEscape(deal.contact_name || 'Not provided')} · ${adminEscape(deal.contact_email || deal.contact_phone || 'No contact details')}</p></div><div><strong>Website</strong><p>${adminEscape(deal.website || 'Not provided')}</p></div></div><p><strong>Opportunity summary</strong><br>${adminEscape(deal.summary)}</p>${deal.partner_response ? `<p><strong>Partner response</strong><br>${adminEscape(deal.partner_response)}</p>` : ''}<div class="form-grid"><div><label for="adminDealStatus${adminEscape(deal.id)}">Review status</label><select id="adminDealStatus${adminEscape(deal.id)}" data-deal-status>${(transitions[deal.status] || [deal.status]).map((status) => `<option value="${adminEscape(status)}" ${status === deal.status ? 'selected' : ''}>${adminEscape(labels[status] || status)}</option>`).join('')}</select></div><div class="full"><label for="adminDealDecision${adminEscape(deal.id)}">Partner-facing decision summary</label><textarea id="adminDealDecision${adminEscape(deal.id)}" data-deal-decision maxlength="1000" rows="2">${adminEscape(deal.decision_summary || '')}</textarea></div><div class="full"><label for="adminDealNote${adminEscape(deal.id)}">Internal note (not shown to the partner)</label><textarea id="adminDealNote${adminEscape(deal.id)}" data-deal-note maxlength="4000" rows="2">${adminEscape(deal.internal_note || '')}</textarea></div></div><div class="form-actions"><button class="primary" data-deal-save type="button">Save review</button><span class="message" data-deal-message role="status"></span></div></article>`).join('');
    list.querySelectorAll('[data-deal-save]').forEach((button) => button.addEventListener('click', async () => {
      const card = button.closest('[data-admin-partner-deal]');
      const id = card.dataset.adminPartnerDeal;
      const status = card.querySelector('[data-deal-status]').value;
      button.disabled = true;
      adminMessage(card.querySelector('[data-deal-message]'), 'Saving review...', true);
      try {
        await adminApi(`admin/partner-deals/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status,
            decision_summary: card.querySelector('[data-deal-decision]').value,
            internal_note: card.querySelector('[data-deal-note]').value,
          }),
        });
        adminMessage(card.querySelector('[data-deal-message]'), 'Review saved.', true);
        await Promise.all([loadAdminPartnerDeals(adminState.partnerDealPage), loadAdminFollowUps()]);
      } catch (error) {
        adminMessage(card.querySelector('[data-deal-message]'), error.message || 'The review could not be saved.', false);
      } finally {
        button.disabled = false;
      }
    }));
    const pages = Math.max(1, Math.ceil(data.total / data.page_size));
    if (pages > 1) {
      pagination.classList.remove('hidden');
      admin$('#adminPartnerDealsPaginationStatus').textContent = `Page ${data.page} of ${pages} · ${data.total} total`;
      admin$('#adminPartnerDealsPrevious').disabled = data.page <= 1;
      admin$('#adminPartnerDealsNext').disabled = data.page >= pages;
    }
  } catch (error) {
    if (requestId !== adminState.partnerDealRequestId) return;
    state.className = 'state-panel error-state';
    state.textContent = `Partner deal registrations are unavailable: ${error.message}`;
  }
}

async function loadAdminFollowUpTasks(page = adminState.followUpTaskPage) {
  const requestId = ++adminState.followUpTaskRequestId;
  const state = admin$('#adminFollowUpTasksState');
  const list = admin$('#adminFollowUpTasksList');
  const pagination = admin$('#adminFollowUpTasksPagination');
  state.className = 'state-panel';
  state.textContent = 'Loading follow-up tasks...';
  list.textContent = '';
  pagination.classList.add('hidden');
  try {
    const data = await adminApi(`admin/follow-up-tasks?page=${encodeURIComponent(page)}&page_size=50`);
    if (requestId !== adminState.followUpTaskRequestId) return;
    adminState.followUpTaskPage = data.page;
    const assigneeSelect = admin$('#adminFollowUpTaskAssignee');
    const selectedAssignee = assigneeSelect.value;
    assigneeSelect.innerHTML = `<option value="">Unassigned</option>${data.assignees.map((user) => `<option value="${adminEscape(user.id)}">${adminEscape(user.name || user.email)} · ${adminEscape(user.role.replace(/_/g, ' '))}</option>`).join('')}`;
    if (selectedAssignee && data.assignees.some((user) => String(user.id) === selectedAssignee)) {
      assigneeSelect.value = selectedAssignee;
    }
    if (!data.tasks.length) {
      state.textContent = 'No follow-up tasks yet.';
      return;
    }
    state.classList.add('hidden');
    const statusLabels = {
      open: 'Open',
      in_progress: 'In progress',
      completed: 'Completed',
      cancelled: 'Cancelled',
    };
    list.innerHTML = data.tasks.map((task) => {
      const activeAssignee = data.assignees.some((user) => Number(task.assigned_to_user_id) === Number(user.id));
      const currentAssignee = task.assigned_to_user_id == null
        ? ''
        : `<option value="${adminEscape(task.assigned_to_user_id)}" selected disabled>${adminEscape(task.assigned_to_name || task.assigned_to_email || `User ${task.assigned_to_user_id}`)} (inactive)</option>`;
      return `<article class="card admin-follow-up-task" data-follow-up-task="${adminEscape(task.id)}"><div class="section-head compact"><div><span class="eyebrow">Task #${adminEscape(task.id)} · Created ${adminEscape(task.created_at)}</span><h3>${adminEscape(task.title)}</h3></div></div><div class="form-grid"><div><label for="followUpTaskStatus${adminEscape(task.id)}">Status</label><select id="followUpTaskStatus${adminEscape(task.id)}" data-task-status>${Object.entries(statusLabels).map(([status, label]) => `<option value="${status}" ${status === task.status ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div><label for="followUpTaskOwner${adminEscape(task.id)}">Owner</label><select id="followUpTaskOwner${adminEscape(task.id)}" data-task-owner><option value="" ${task.assigned_to_user_id == null ? 'selected' : ''}>Unassigned</option>${task.assigned_to_user_id != null && !activeAssignee ? currentAssignee : ''}${data.assignees.map((user) => `<option value="${adminEscape(user.id)}" ${Number(task.assigned_to_user_id) === Number(user.id) ? 'selected' : ''}>${adminEscape(user.name || user.email)}</option>`).join('')}</select></div><div><label for="followUpTaskDue${adminEscape(task.id)}">Due date</label><input id="followUpTaskDue${adminEscape(task.id)}" data-task-due type="date" value="${adminEscape(task.due_date || '')}" /></div><div class="full"><label for="followUpTaskDescription${adminEscape(task.id)}">Notes</label><textarea id="followUpTaskDescription${adminEscape(task.id)}" data-task-description maxlength="2000" rows="2">${adminEscape(task.description || '')}</textarea></div></div><div class="form-actions"><button class="secondary" data-task-save type="button">Save task</button><span class="message" data-task-message role="status"></span></div></article>`;
    }).join('');
    list.querySelectorAll('[data-task-save]').forEach((button) => button.addEventListener('click', async () => {
      const card = button.closest('[data-follow-up-task]');
      const id = card.dataset.followUpTask;
      button.disabled = true;
      adminMessage(card.querySelector('[data-task-message]'), 'Saving task...', true);
      try {
        await adminApi(`admin/follow-up-tasks/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: card.querySelector('[data-task-status]').value,
            assigned_to_user_id: card.querySelector('[data-task-owner]').value || null,
            due_date: card.querySelector('[data-task-due]').value || null,
            description: card.querySelector('[data-task-description]').value,
          }),
        });
        adminMessage(card.querySelector('[data-task-message]'), 'Task saved.', true);
        await loadAdminFollowUpTasks(adminState.followUpTaskPage);
      } catch (error) {
        adminMessage(card.querySelector('[data-task-message]'), error.message || 'The task could not be saved.', false);
      } finally {
        button.disabled = false;
      }
    }));
    const pages = Math.max(1, Math.ceil(data.total / data.page_size));
    if (pages > 1) {
      pagination.classList.remove('hidden');
      admin$('#adminFollowUpTasksPaginationStatus').textContent = `Page ${data.page} of ${pages} · ${data.total} total`;
      admin$('#adminFollowUpTasksPrevious').disabled = data.page <= 1;
      admin$('#adminFollowUpTasksNext').disabled = data.page >= pages;
    }
  } catch (error) {
    if (requestId !== adminState.followUpTaskRequestId) return;
    state.className = 'state-panel error-state';
    state.textContent = `Follow-up tasks are unavailable: ${error.message}`;
  }
}

async function loadAdminFollowUps(page = adminState.followUpPage) {
  const requestId = ++adminState.followUpRequestId;
  const state = admin$('#adminFollowUpsState');
  const list = admin$('#adminFollowUpsList');
  const pagination = admin$('#adminFollowUpsPagination');
  state.className = 'state-panel';
  state.textContent = 'Loading follow-ups...';
  list.classList.add('hidden');
  pagination.classList.add('hidden');
  try {
    const data = await adminApi(`admin/follow-ups?page=${encodeURIComponent(page)}&page_size=50`);
    if (requestId !== adminState.followUpRequestId) return;
    adminState.followUpPage = data.page;
    if (!data.items.length) {
      state.textContent = 'No open follow-ups or pending onboarding invitations.';
      return;
    }
    state.classList.add('hidden');
    list.classList.remove('hidden');
    const types = {
      support_ticket: 'Support ticket',
      deal_registration: 'Partner deal',
      customer_invite: 'Customer invitation',
      partner_invite: 'Partner invitation',
    };
    list.innerHTML = `<p class="muted">${adminEscape(data.total)} items · internal queue only · no automated messages</p><div class="admin-partner-table-wrap"><table class="admin-table"><thead><tr><th>Type</th><th>Item</th><th>Organization</th><th>Status</th><th>Created</th><th>Invitation expiry</th></tr></thead><tbody>${data.items.map((item) => `<tr><td>${adminEscape(types[item.type] || item.type)}</td><td>${adminEscape(item.title)} <small>#${adminEscape(item.id)}</small></td><td>${adminEscape(item.organization || 'Not provided')}</td><td><span class="status">${adminEscape(item.status.replace(/_/g, ' '))}</span></td><td>${adminEscape(item.created_at)}</td><td>${adminEscape(item.expires_at || '—')}</td></tr>`).join('')}</tbody></table></div>`;
    const pages = Math.max(1, Math.ceil(data.total / data.page_size));
    if (pages > 1) {
      pagination.classList.remove('hidden');
      admin$('#adminFollowUpsPaginationStatus').textContent = `Page ${data.page} of ${pages} · ${data.total} total`;
      admin$('#adminFollowUpsPrevious').disabled = data.page <= 1;
      admin$('#adminFollowUpsNext').disabled = data.page >= pages;
    }
  } catch (error) {
    if (requestId !== adminState.followUpRequestId) return;
    state.className = 'state-panel error-state';
    state.textContent = `The follow-up queue is unavailable: ${error.message}`;
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
    const [products, licenses, organizations, batches, partnerData] = await Promise.all([
      adminApi('products'),
      adminApi('licenses'),
      adminApi('admin/organizations'),
      adminApi('licenses/batches'),
      adminApi('admin/partners'),
    ]);
    adminState.products = products.products;
    adminState.licenses = licenses.licenses;
    adminState.organizations = organizations.organizations;
    adminState.partners = partnerData.partners || [];
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
    admin$('#licenseCodePartner').innerHTML = `<option value="">Direct customer or other recipient</option>${adminState.partners
      .filter((partner) => partner.status === 'active' && ['channel_partner', 'reseller', 'distributor'].includes(partner.partner_type))
      .map((partner) => `<option value="${adminEscape(partner.id)}">${adminEscape(partner.name)} · ${adminEscape(partner.partner_type)}</option>`)
      .join('')}`;
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
  adminState.licenseCodeRows = [];
  adminState.licenseCodeAllocations = [];
  const state = admin$('#adminLicenseCodesState');
  const list = admin$('#adminLicenseCodesList');
  const issueButton = admin$('#licenseCodeIssueButton');
  state.className = 'state-panel';
  state.textContent = 'Loading serial delivery details...';
  list.classList.add('hidden');
  issueButton.disabled = true;

  const result = await adminApi(`licenses/batches/${encodeURIComponent(batchId)}/codes`);
  if (adminState.licenseCodeBatchId !== batchId) return;
  adminState.licenseCodeRows = result.codes || [];
  adminState.licenseCodeAllocations = result.allocations || [];
  const eligibleCodes = result.codes.filter((code) =>
    code.status === 'available' && code.delivery_status === 'not_issued');
  state.classList.add('hidden');
  list.classList.remove('hidden');
  const revealNote = result.key_reveal_configured
    ? 'Available keys can be revealed one at a time after confirming your admin password. Older hash-only keys can be restored if you still have the original key.'
    : 'Protected key reveal is not configured in this environment.';
  const allocationSection = adminState.licenseCodeAllocations.length
    ? `<section class="admin-allocation-print-list"><h3>Partner allocation documents</h3>${adminState.licenseCodeAllocations.map((allocation, index) => `
        <div class="admin-allocation-print-row">
          <div><strong>${adminEscape(allocation.partner_name || 'Partner unavailable')}</strong><small>${adminEscape(allocation.serial_numbers.length)} serial(s) · ${adminEscape(allocation.recorded_at || 'Date unavailable')}${allocation.delivery_reference ? ` · ${adminEscape(allocation.delivery_reference)}` : ''}</small></div>
          <button class="secondary" type="button" data-partner-allocation-print="${index}">Print allocation note</button>
        </div>`).join('')}</section>`
    : '';
  list.innerHTML = `${allocationSection}<p class="muted">Batch <strong>${adminEscape(batchId)}</strong>. ${adminEscape(revealNote)}</p><table class="admin-table"><thead><tr><th><input id="licenseCodeSelectAll" type="checkbox" aria-label="Select all eligible codes" ${eligibleCodes.length ? '' : 'disabled'} /></th><th>Serial number</th><th>Activation status</th><th>Delivery status</th><th>Recipient</th><th>Assigned partner</th><th>Channel</th><th>Issued at</th><th>Delivery reference</th><th>Key</th></tr></thead><tbody>${result.codes.map((code) => {
    const eligible = code.status === 'available' && code.delivery_status === 'not_issued';
    const recipient = [code.issued_to_name, code.issued_to_organization, code.issued_to_email]
      .filter(Boolean).map(adminEscape).join('<br>');
    const keyAction = code.status === 'available' && code.activation_key_recoverable
      ? `<button class="secondary" type="button" data-license-code-reveal-serial="${adminEscape(code.serial_number)}">Reveal key</button>`
      : code.status === 'available' && result.key_reveal_configured
        ? `<button class="secondary" type="button" data-license-code-restore-serial="${adminEscape(code.serial_number)}">Restore existing key</button>`
      : '<span class="muted">Unavailable</span>';
    return `<tr><td>${eligible ? `<input type="checkbox" name="serial_number" value="${adminEscape(code.serial_number)}" aria-label="Select serial ${adminEscape(code.serial_number)}" />` : '—'}</td><td>${adminEscape(code.serial_number)}</td><td>${adminEscape(code.status)}</td><td>${adminEscape(code.delivery_status)}</td><td>${recipient || '—'}</td><td>${adminEscape(code.assigned_partner_name || '—')}</td><td>${adminEscape(code.delivery_channel || '—')}</td><td>${adminEscape(code.issued_at || '—')}</td><td>${adminEscape(code.delivery_reference || '—')}</td><td>${keyAction}</td></tr>`;
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
  admin$('#licenseCustomerAccountId').disabled = isNewCustomer;
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
  adminState.registrations = registrations;
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
        <td class="registration-actions"><button class="secondary" type="button" data-license-print="${id}">Print summary</button><button class="secondary" type="button" data-license-details="${id}">Inspect</button>${registration.license_status === 'ACTIVE' ? `<button class="secondary" type="button" data-license-suspend="${id}">Suspend</button>` : ''}${canRenew ? `<label class="inline-date">Renew through <input type="date" data-license-renew-date="${id}" /></label><button class="secondary" type="button" data-license-renew="${id}">Renew</button>` : ''}</td>
      </tr><tr class="admin-license-detail-row" data-license-detail-row="${id}" hidden><td colspan="6"><div class="license-details hidden" data-license-detail-panel="${id}"></div></td></tr>`;
    }).join('')}</tbody>
  </table></div>`;
  renderRegistrationPagination(pagination, data);
}

function printAdminDocument({ title, subtitle, fields, columns = [], rows = [], disclaimer }) {
  const root = admin$('#adminPrintRoot');
  if (!root) throw new Error('The print workspace is unavailable.');
  const details = fields.map(([label, value]) => {
    const displayValue = value == null || value === '' ? '—' : value;
    return `<div><dt>${adminEscape(label)}</dt><dd>${adminEscape(displayValue)}</dd></div>`;
  }).join('');
  const table = columns.length
    ? `<table><thead><tr>${columns.map((column) => `<th>${adminEscape(column)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${adminEscape(value == null || value === '' ? '—' : value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '';
  root.innerHTML = `<article class="print-document">
    <header class="print-header"><span class="print-brand">SMRITISYS</span><h1>${adminEscape(title)}</h1><p class="print-subtitle">${adminEscape(subtitle)}</p></header>
    <dl class="print-details">${details}</dl>${table}
    <p class="print-disclaimer">${adminEscape(disclaimer)}</p>
  </article>`;
  root.setAttribute('aria-hidden', 'false');
  document.body.classList.add('admin-printing');
  let cleanupTimer = null;
  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup);
    if (cleanupTimer) window.clearTimeout(cleanupTimer);
    root.replaceChildren();
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('admin-printing');
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  cleanupTimer = window.setTimeout(cleanup, 120000);
  try {
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}

function printPartnerAllocationNote(index) {
  const allocation = adminState.licenseCodeAllocations[index];
  if (!allocation) throw new Error('The selected allocation record is unavailable.');
  const codesBySerial = new Map(adminState.licenseCodeRows.map((code) => [code.serial_number, code]));
  const rows = allocation.serial_numbers.map((serialNumber) => {
    const code = codesBySerial.get(serialNumber);
    const productEdition = code
      ? `${code.product_name || 'Product unavailable'} · ${code.edition_name || 'Edition unavailable'}`
      : 'Code unavailable in current batch';
    return [serialNumber, productEdition, code?.status || 'Unavailable'];
  });
  printAdminDocument({
    title: 'Partner Activation Code Allocation & Dispatch Note',
    subtitle: 'Operational record of activation-code allocation to a sales partner.',
    fields: [
      ['Allocation reference', `AL-${allocation.allocation_id}`],
      ['Recorded at', allocation.recorded_at],
      ['Prepared by', allocation.recorded_by],
      ['Partner organization', allocation.partner_name],
      ['Partner category', allocation.partner_type ? allocation.partner_type.replace(/_/g, ' ') : null],
      ['Recipient contact', allocation.recipient_name],
      ['Recipient email', allocation.recipient_email],
      ['Delivery channel', allocation.delivery_channel ? allocation.delivery_channel.replace(/_/g, ' ') : null],
      ['Delivery reference', allocation.delivery_reference],
    ],
    columns: ['Serial number', 'Product / edition', 'Activation status now'],
    rows,
    disclaimer: 'Operational allocation record only. Activation keys are not included. This document contains no prices, payment status, commission, or payout information.',
  });
}

function printCustomerLicenseSummary(licenseId) {
  const registration = adminState.registrations.find((item) => String(item.license_id) === String(licenseId));
  if (!registration) throw new Error('The selected license summary is unavailable.');
  printAdminDocument({
    title: 'Customer License Summary',
    subtitle: 'Operational summary of a customer-bound product license.',
    fields: [
      ['License record', registration.license_id],
      ['Customer organization', registration.organization_name],
      ['Product', registration.product?.name],
      ['Product code', registration.product?.code],
      ['Edition', registration.edition?.name],
      ['Edition code', registration.edition?.code],
      ['Serial number', registration.serial_number],
      ['License status', registration.license_status],
      ['Seats', registration.seats],
      ['Start date', registration.start_date],
      ['Expiry date', registration.expiry_date || 'Perpetual'],
      ['Registered email (masked)', registration.registered_email_masked || 'Not registered'],
      ['License created', registration.license_created_at],
    ],
    disclaimer: 'Operational license summary only. It does not include activation keys or payment status.',
  });
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
  const customerId = String(values.get('customer_id') || '').trim();
  const customerScope = admin$('#adminRegistrationCustomerScope');
  customerScope.classList.toggle('hidden', !customerId);
  admin$('#adminRegistrationCustomerScopeLabel').textContent = customerId
    ? `Showing licenses for customer ID ${customerId}.`
    : '';
  for (const key of ['q', 'customer_id', 'status', 'activation', 'email', 'from', 'to']) {
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

function renderAdminReactivationRequests(requests) {
  const state = admin$('#adminReactivationState');
  const list = admin$('#adminReactivationList');
  if (!requests.length) {
    state.className = 'state-panel';
    state.textContent = 'No pending license reactivation requests.';
    list.classList.add('hidden');
    list.innerHTML = '';
    adminState.selectedReactivationId = null;
    admin$('#adminReactivationDetail').className = 'card state-panel';
    admin$('#adminReactivationDetail').textContent = 'New customer requests will appear here.';
    return;
  }
  state.classList.add('hidden');
  list.classList.remove('hidden');
  list.innerHTML = requests.map((item) => `
    <button class="admin-support-ticket${item.request_id === adminState.selectedReactivationId ? ' active' : ''}"
      type="button" data-admin-reactivation="${adminEscape(item.request_id)}"
      aria-pressed="${item.request_id === adminState.selectedReactivationId}">
      <span class="admin-support-ticket-head">
        <span>${adminEscape(item.product_name)} · ${adminEscape(item.serial_number)}</span>
        <span class="status">${adminEscape(item.active_activation_count)}/${adminEscape(item.seats)} seats</span>
      </span>
      <strong>${adminEscape(item.customer_name || 'Customer')}</strong>
      <small>${adminEscape(item.customer_email)} · ${adminEscape(item.customer_phone || 'No phone on file')}</small>
      <small>Received ${adminEscape(item.created_at)}</small>
    </button>
  `).join('');
}

async function loadAdminLicenseReactivationDetail(requestId) {
  const detail = admin$('#adminReactivationDetail');
  const requestSequence = ++adminState.reactivationRequestId;
  adminState.selectedReactivationId = requestId;
  detail.className = 'card state-panel';
  detail.textContent = 'Loading request and active installations...';
  try {
    const data = await adminApi(`admin/license-reactivations/${encodeURIComponent(requestId)}`);
    if (requestSequence !== adminState.reactivationRequestId) return;
    const item = data.request;
    const active = item.active_activations || [];
    const requiresReplacement = Number(item.active_activation_count) >= Number(item.seats);
    const cooldown = Number(item.transfer_cooldown_active) === 1;
    detail.className = 'card';
    detail.innerHTML = `
      <div class="section-head compact"><div><span class="eyebrow">Pending request</span><h3>${adminEscape(item.product_name)} · ${adminEscape(item.serial_number)}</h3></div></div>
      <dl>
        <dt>Customer</dt><dd>${adminEscape(item.customer_name || 'Not available')}</dd>
        <dt>Registered email</dt><dd>${adminEscape(item.customer_email)}</dd>
        <dt>Registered phone — call this number</dt><dd><strong>${adminEscape(item.customer_phone || 'No phone on file')}</strong></dd>
        <dt>Requested</dt><dd>${adminEscape(item.created_at)}</dd>
        <dt>Active seats</dt><dd>${adminEscape(item.active_activation_count)} / ${adminEscape(item.seats)}</dd>
        <dt>Expires</dt><dd>${adminEscape(item.expires_at)}</dd>
      </dl>
      ${item.status !== 'pending' ? `<p class="message">This request is ${adminEscape(item.status)} and can no longer be reviewed.</p>` : ''}
      <form data-admin-reactivation-review="${adminEscape(item.request_id)}">
        <div class="form-grid">
          <div class="full">
            <label for="adminReactivationReplacement">Active installation to replace${requiresReplacement ? ' (required)' : ' (optional)'}</label>
            <select id="adminReactivationReplacement" name="replaced_activation_id" ${requiresReplacement ? 'required' : ''}>
              <option value="">Do not replace an installation</option>
              ${active.map((activation) => `<option value="${adminEscape(activation.id)}">Installation …${adminEscape(String(activation.installation_id).slice(-8))} · last seen ${adminEscape(activation.last_seen_at || 'unknown')}</option>`).join('')}
            </select>
            ${requiresReplacement ? '<small class="muted">The license has no free seat; one active installation must be released.</small>' : ''}
          </div>
          ${cooldown ? `<div class="full"><label><input name="cooldown_override" type="checkbox" value="true" /> Override the 30-day transfer cooldown (available ${adminEscape(item.transfer_available_at)})</label><small class="muted">Use only after verifying the customer by phone and documenting the reason.</small></div>` : ''}
          <div class="full"><label><input name="phone_confirmed" type="checkbox" value="true" /> I called and confirmed with the customer at the registered phone number</label></div>
          <div class="full"><label for="adminReactivationReason">Decision reason</label><textarea id="adminReactivationReason" name="reason" minlength="10" maxlength="500" rows="3" required></textarea></div>
        </div>
        <div class="form-actions">
          <button class="primary" type="submit" name="decision" value="approve" ${item.status !== 'pending' ? 'disabled' : ''}>Approve</button>
          <button class="secondary" type="submit" name="decision" value="reject" ${item.status !== 'pending' ? 'disabled' : ''}>Reject</button>
        </div>
        <p data-admin-reactivation-feedback class="message" role="status"></p>
      </form>`;
  } catch (error) {
    if (requestSequence !== adminState.reactivationRequestId) return;
    detail.className = 'card state-panel error-state';
    detail.textContent = `Reactivation details could not be loaded: ${error.message}`;
  }
}

async function loadAdminLicenseReactivations(preferredRequestId = adminState.selectedReactivationId) {
  const requestSequence = ++adminState.reactivationRequestId;
  const state = admin$('#adminReactivationState');
  const list = admin$('#adminReactivationList');
  state.className = 'state-panel';
  state.textContent = 'Loading reactivation requests...';
  list.classList.add('hidden');
  try {
    const data = await adminApi('admin/license-reactivations');
    if (requestSequence !== adminState.reactivationRequestId) return;
    const requests = data.requests || [];
    const selected = requests.find((item) => item.request_id === preferredRequestId) || requests[0];
    adminState.selectedReactivationId = selected?.request_id || null;
    renderAdminReactivationRequests(requests);
    if (selected) await loadAdminLicenseReactivationDetail(selected.request_id);
  } catch (error) {
    if (requestSequence !== adminState.reactivationRequestId) return;
    adminStatePanel('adminReactivationState', 'adminReactivationList', `Reactivation queue is unavailable: ${error.message}`, true);
    admin$('#adminReactivationDetail').className = 'card state-panel';
    admin$('#adminReactivationDetail').textContent = 'Request details are unavailable.';
  }
}

function renderLicenseDetails(licenseId, data, { allowActivationRevoke = true } = {}) {
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
  const activations = data.activations.activations.map((item, index) => `<li><strong>Installation ${index + 1} (${adminEscape(String(item.installation_id || '').slice(-4) || '—')})</strong> · ${adminEscape(item.status)} · Last seen ${adminEscape(item.last_seen_at || '—')}${item.status === 'active' && allowActivationRevoke ? ` <button type="button" class="text-button" data-activation-revoke="${adminEscape(item.id)}" data-license-id="${adminEscape(licenseId)}">Revoke</button>` : ''}</li>`).join('');
  const artifacts = data.artifacts.artifacts.map((item) => `<li>${adminEscape(item.document_id)} · ${adminEscape(item.algorithm)} · key ${adminEscape(item.key_id)} · ${adminEscape(item.issued_at)}</li>`).join('');
  const events = data.events.events.map((item) => `<li>${adminEscape(item.created_at)} · ${adminEscape(item.event_type)} · ${adminEscape(item.previous_status || '—')} → ${adminEscape(item.new_status || '—')}</li>`).join('');
  return `<div class="registration-detail-grid">${registrationGroups}</div><div class="license-detail-grid"><section><h4>Entitlements</h4><dl class="entitlement-list">${entitlements || '<dd>None</dd>'}</dl></section><section><h4>Activations</h4><ul>${activations || '<li>None</li>'}</ul></section><section><h4>Signed artifacts</h4><ul>${artifacts || '<li>None</li>'}</ul></section><section><h4>Lifecycle timeline</h4><ul>${events || '<li>No lifecycle events recorded</li>'}</ul></section></div>`;
}

async function loadLicenseDetails(licenseId, panel, options = {}) {
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
    panel.innerHTML = renderLicenseDetails(licenseId, { entitlements, activations, artifacts, events, registration }, options);
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

function adminSupportStatusLabel(status) {
  return ({
    open: 'Open',
    in_progress: 'In progress',
    resolved: 'Resolved',
    closed: 'Closed',
  }[status] || String(status || 'Unknown').replaceAll('_', ' '));
}

function adminSupportActivityDescription(event) {
  const labels = {
    SUPPORT_TICKET_CREATED: 'Ticket created',
    SUPPORT_TICKET_CUSTOMER_REPLIED: 'Customer replied',
    SUPPORT_TICKET_REOPENED_BY_CUSTOMER: 'Reopened by customer',
    ADMIN_SUPPORT_TICKET_REPLIED: 'Support replied',
    ADMIN_SUPPORT_TICKET_STATUS_CHANGED: 'Status changed',
  };
  if (event.action === 'ADMIN_SUPPORT_TICKET_STATUS_CHANGED') {
    const readStatus = (value) => {
      try {
        return JSON.parse(value || '{}').status || '';
      } catch {
        return '';
      }
    };
    const oldStatus = readStatus(event.old_value);
    const newStatus = readStatus(event.new_value);
    if (oldStatus && newStatus) {
      return `Status changed: ${adminSupportStatusLabel(oldStatus)} to ${adminSupportStatusLabel(newStatus)}`;
    }
  }
  return labels[event.action] || String(event.action || 'Ticket activity').replaceAll('_', ' ').toLowerCase();
}

function renderAdminSupportTicketList(pageSize) {
  const list = admin$('#adminSupportList');
  list.innerHTML = adminState.supportTickets.map((ticket) => `
    <button class="admin-support-ticket${ticket.id === adminState.supportTicketId ? ' active' : ''}" type="button"
      data-admin-support-ticket="${ticket.id}" aria-pressed="${ticket.id === adminState.supportTicketId}">
      <span class="admin-support-ticket-head"><span>Ticket #${adminEscape(ticket.id)} · ${adminEscape(String(ticket.priority || 'normal').toUpperCase())}</span><span class="status">${adminEscape(adminSupportStatusLabel(ticket.status))}</span></span>
      <strong>${adminEscape(ticket.subject)}</strong>
      <small>${adminEscape(ticket.customer_name || 'Customer')} · ${adminEscape(ticket.customer_email)}</small>
      <small>${adminEscape(ticket.customer_company || 'Company not provided')} · Updated ${adminEscape(ticket.updated_at)}</small>
    </button>
  `).join('');
  const pagination = admin$('#adminSupportPagination');
  const pageCount = Math.max(1, Math.ceil(adminState.supportTotal / pageSize));
  pagination.classList.toggle('hidden', adminState.supportTotal <= pageSize);
  admin$('#adminSupportPaginationStatus').textContent =
    `Page ${adminState.supportPage} of ${pageCount} · ${adminState.supportTotal} tickets`;
  pagination.querySelector('[data-admin-support-page="previous"]').disabled = adminState.supportPage <= 1;
  pagination.querySelector('[data-admin-support-page="next"]').disabled = adminState.supportPage >= pageCount;
}

async function loadAdminSupportTickets(page = adminState.supportPage, preferredTicketId = adminState.supportTicketId) {
  const requestId = ++adminState.supportListRequestId;
  const search = admin$('#adminSupportSearch').value.trim();
  const status = admin$('#adminSupportStatus').value;
  const pageSize = 50;
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (search) query.set('q', search);
  if (status) query.set('status', status);
  adminStatePanel('adminSupportState', 'adminSupportList', 'Loading support tickets...');
  admin$('#adminSupportPagination').classList.add('hidden');

  try {
    const data = await adminApi(`admin/support-tickets?${query.toString()}`);
    if (requestId !== adminState.supportListRequestId) return;
    adminState.supportTickets = data.tickets;
    adminState.supportPage = data.page;
    adminState.supportTotal = data.total;
    if (!data.tickets.length) {
      adminState.supportTicketId = null;
      adminStatePanel('adminSupportState', 'adminSupportList', 'No tickets match these filters.');
      admin$('#adminSupportDetail').className = 'card state-panel';
      admin$('#adminSupportDetail').textContent = 'Select another filter or refresh to check for new tickets.';
      return;
    }

    const selectedTicket = data.tickets.find((ticket) => ticket.id === preferredTicketId) || data.tickets[0];
    adminState.supportTicketId = selectedTicket.id;
    admin$('#adminSupportState').classList.add('hidden');
    admin$('#adminSupportList').classList.remove('hidden');
    renderAdminSupportTicketList(pageSize);
    await loadAdminSupportTicket(selectedTicket.id);
  } catch (error) {
    if (requestId !== adminState.supportListRequestId) return;
    adminStatePanel(
      'adminSupportState',
      'adminSupportList',
      error.status === 403 ? 'Super admin access required.' : `Support ticket queue is unavailable: ${error.message}`,
      true,
    );
    admin$('#adminSupportDetail').className = 'card state-panel error-state';
    admin$('#adminSupportDetail').textContent = 'Ticket details are unavailable.';
  }
}

async function loadAdminSupportTicket(ticketId) {
  const requestId = ++adminState.supportDetailRequestId;
  const panel = admin$('#adminSupportDetail');
  panel.className = 'card state-panel';
  panel.textContent = 'Loading ticket details...';
  try {
    const data = await adminApi(`admin/support-tickets/${ticketId}`);
    if (requestId !== adminState.supportDetailRequestId || ticketId !== adminState.supportTicketId) return;
    const { ticket, messages, activity } = data;
    const messageMarkup = messages.length
      ? messages.map((message) => `
        <article class="admin-support-message">
          <div class="admin-support-message-head"><strong>${adminEscape(message.author_type === 'customer' ? ticket.customer_name || 'Customer' : 'SMRITISYS Support')}</strong><time>${adminEscape(message.created_at)}</time></div>
          <p>${adminEscape(message.message)}</p>
        </article>
      `).join('')
      : '<p class="muted">No replies yet.</p>';
    const activityMarkup = activity.length
      ? activity.map((event) => `
        <div class="admin-activity-item">
          <strong>${adminEscape(adminSupportActivityDescription(event))}</strong>
          <time>${adminEscape(event.created_at)}</time>
          <small class="admin-activity-meta">By ${adminEscape(event.actor_name || 'System')}</small>
        </div>
      `).join('')
      : '<p class="muted">No activity recorded.</p>';
    panel.className = 'card admin-support-detail';
    panel.innerHTML = `
      <div class="section-head compact">
        <div><span class="eyebrow">Ticket #${adminEscape(ticket.id)} · ${adminEscape(String(ticket.priority || 'normal').toUpperCase())} priority</span><h3>${adminEscape(ticket.subject)}</h3></div>
        <span class="status">${adminEscape(adminSupportStatusLabel(ticket.status))}</span>
      </div>
      <p class="admin-support-contact">${adminEscape(ticket.customer_name || 'Customer')} · ${adminEscape(ticket.customer_email)} · ${adminEscape(ticket.customer_phone || 'Phone not provided')} · ${adminEscape(ticket.customer_company || 'Company not provided')}</p>
      <p class="admin-support-description">${adminEscape(ticket.description)}</p>
      <form class="admin-support-status-form" data-admin-support-status="${ticket.id}">
        <div class="form-actions">
          <label for="adminSupportStatusSelect">Ticket status</label>
          <select id="adminSupportStatusSelect" name="status">
            ${['open', 'in_progress', 'resolved', 'closed'].map((status) => `<option value="${status}" ${ticket.status === status ? 'selected' : ''}>${adminEscape(adminSupportStatusLabel(status))}</option>`).join('')}
          </select>
          <button class="secondary" type="submit">Update status</button>
        </div>
        <p class="message" data-admin-support-feedback="status" role="status"></p>
      </form>
      <h4>Conversation</h4>
      <div class="admin-support-messages">${messageMarkup}</div>
      <form class="admin-support-reply" data-admin-support-reply="${ticket.id}">
        <label for="adminSupportReply">Reply to customer</label>
        <textarea id="adminSupportReply" name="message" maxlength="10000" rows="4" required></textarea>
        <div class="form-actions"><button class="primary" type="submit">Send reply</button></div>
        <p class="message" data-admin-support-feedback="reply" role="status"></p>
      </form>
      <h4>Activity</h4>
      <div class="admin-support-activity">${activityMarkup}</div>
      <p class="muted">Created ${adminEscape(ticket.created_at)} · Last updated ${adminEscape(ticket.updated_at)}</p>
    `;
  } catch (error) {
    if (requestId !== adminState.supportDetailRequestId) return;
    panel.className = 'card state-panel error-state';
    panel.textContent = error.status === 404 ? 'Ticket not found.' : `Ticket details are unavailable: ${error.message}`;
  }
}

function adminDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function adminReleaseAssetRow(asset = {}) {
  return `<div class="form-grid admin-release-asset-row">
    <div><label>Download name</label><input aria-label="Download name" data-release-asset="name" maxlength="200" value="${adminEscape(asset.name)}" /></div>
    <div><label>Platform (optional)</label><input aria-label="Platform (optional)" data-release-asset="platform" maxlength="100" value="${adminEscape(asset.platform)}" /></div>
    <div class="full"><label>HTTPS download URL</label><input aria-label="HTTPS download URL" data-release-asset="download_url" type="url" maxlength="2048" value="${adminEscape(asset.download_url)}" /></div>
    <div class="full"><label>SHA-256 checksum</label><input aria-label="SHA-256 checksum" data-release-asset="checksum" maxlength="64" pattern="[A-Fa-f0-9]{64}" value="${adminEscape(asset.checksum)}" /></div>
    <div class="full"><button class="text-button" type="button" data-release-asset-remove>Remove download</button></div>
  </div>`;
}

function resetAdminReleaseForm() {
  admin$('#adminReleaseForm').reset();
  admin$('#adminReleaseId').value = '';
  admin$('#adminReleaseProduct').disabled = false;
  admin$('#adminReleaseVersion').disabled = false;
  admin$('#adminReleaseSaveButton').textContent = 'Create draft';
  admin$('#adminReleaseCancelEdit').classList.add('hidden');
  admin$('#adminReleaseAssets').innerHTML = adminReleaseAssetRow();
}

async function loadAdminReleases() {
  try {
    const [data, products] = await Promise.all([adminApi('admin/releases'), adminApi('products')]);
    adminState.releases = data.releases;
    adminState.products = products.products;
    const productSelect = admin$('#adminReleaseProduct');
    const selectedProductId = productSelect.value;
    productSelect.innerHTML = products.products
      .filter((product) => product.status === 'active')
      .map((product) => `<option value="${adminEscape(product.id)}">${adminEscape(product.name)} (${adminEscape(product.code)})</option>`)
      .join('');
    if (products.products.some((product) => String(product.id) === selectedProductId && product.status === 'active')) {
      productSelect.value = selectedProductId;
    }

    const state = admin$('#adminReleasesState');
    const list = admin$('#adminReleasesList');
    if (!data.releases.length) {
      adminStatePanel('adminReleasesState', 'adminReleasesList', 'No releases yet. Create a draft to start the review process.');
    } else {
      state.classList.add('hidden');
      list.classList.remove('hidden');
      list.innerHTML = data.releases.map((release) => {
        const actions = [
          release.status === 'draft' ? `<button class="secondary" type="button" data-release-edit="${release.id}">Edit draft</button><button class="primary" type="button" data-release-transition="review" data-release-id="${release.id}">Submit for review</button><button class="text-button" type="button" data-release-transition="withdrawn" data-release-id="${release.id}">Cancel draft</button>` : '',
          release.status === 'review' ? `<button class="secondary" type="button" data-release-transition="draft" data-release-id="${release.id}">Return to draft</button><button class="primary" type="button" data-release-transition="published" data-release-id="${release.id}">Publish</button><button class="text-button" type="button" data-release-transition="withdrawn" data-release-id="${release.id}">Withdraw</button>` : '',
          release.status === 'published' ? `<button class="text-button" type="button" data-release-transition="withdrawn" data-release-id="${release.id}">Withdraw</button>` : '',
        ].join('');
        const assets = release.assets.length
          ? `<ul>${release.assets.map((asset) => `<li>${adminEscape(asset.name)}${asset.platform ? ` · ${adminEscape(asset.platform)}` : ''} · SHA-256 ${adminEscape(asset.checksum)}</li>`).join('')}</ul>`
          : '<p class="muted">No downloads attached.</p>';
        return `<article class="card module">
          <div class="section-head compact"><div><span class="eyebrow">${adminEscape(release.product.name)} · ${adminEscape(release.version)}</span><h3>${adminEscape(release.title)}</h3></div><span class="status">${adminEscape(release.status)}</span></div>
          ${release.summary ? `<p>${adminEscape(release.summary)}</p>` : ''}
          ${release.release_notes ? `<details><summary>Release notes</summary><p style="white-space:pre-wrap">${adminEscape(release.release_notes)}</p></details>` : '<p class="muted">Release notes are pending.</p>'}
          ${assets}
          <p class="muted">Updated ${adminEscape(release.updated_at)}${release.published_at ? ` · Published ${adminEscape(release.published_at)}` : ''}</p>
          <div class="form-actions">${actions}</div>
        </article>`;
      }).join('');
    }
    if (!admin$('#adminReleaseId').value && !admin$('#adminReleaseAssets').children.length) {
      admin$('#adminReleaseAssets').innerHTML = adminReleaseAssetRow();
    }
  } catch (error) {
    adminStatePanel('adminReleasesState', 'adminReleasesList', error.status === 403 ? 'Super admin access required.' : `Releases are unavailable: ${error.message}`, true);
  }
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
    if (!(await organizationContext.ensureSelected())) return;
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

const organizationContext = window.createOrganizationContextController({
  api: adminApi,
  buttonId: 'organizationContextButton',
  dialogId: 'organizationContextDialog',
  formId: 'organizationContextForm',
  selectId: 'organizationContextSelect',
  messageId: 'organizationContextMessage',
  onSelected: loadAdminWorkspace,
  onSignOut: logoutAdmin,
});

async function logoutAdmin() {
  try { await adminApi('logout', { method: 'POST' }); } catch {}
  adminState.token = null;
  showAdminLogin();
}

function navigateAdmin(view, productTab = null) {
  const button = admin$(`.admin-nav button[data-admin-view="${view}"]`);
  if (!button) return;
  if (view !== 'organizations') clearCustomerInviteLink();
  if (view !== 'organizations') clearAdminCustomerResetLink();
  admin$$('.admin-nav button').forEach((item) => {
    item.classList.toggle('active', item === button);
    if (item === button) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  button.classList.add('active');
  admin$$('.admin-view').forEach((section) => section.classList.toggle('active', section.dataset.adminSection === view));
  admin$('#adminPageTitle').textContent = button.textContent;
  const menuWasOpen = adminMobileNavToggle.getAttribute('aria-expanded') === 'true';
  adminNavigation.classList.remove('is-open');
  adminMobileNavToggle.setAttribute('aria-expanded', 'false');
  if (menuWasOpen && getComputedStyle(adminMobileNavToggle).display !== 'none') adminMobileNavToggle.focus();
  if (view === 'overview') loadAdminOverview();
  if (view === 'users') loadAdminUsers();
  if (view === 'organizations') {
    loadAdminOrganizations().then(loadAdminPartners);
    loadAdminCustomerInvites();
    loadAdminCustomers();
  }
  if (view === 'partner-deals') loadAdminPartnerDeals(1);
  if (view === 'follow-ups') {
    loadAdminFollowUpTasks(1);
    loadAdminFollowUps(1);
  }
  if (view === 'products') {
    loadAdminProducts();
    if (productTab) selectAdminProductTab(productTab);
  }
  if (view === 'releases') loadAdminReleases();
  if (view === 'support') loadAdminSupportTickets();
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
  if (tabName === 'licenses') {
    loadLicenseRegistrations();
    loadAdminLicenseReactivations();
  }
}

const adminMobileNavToggle = admin$('#adminMobileNavToggle');
const adminNavigation = admin$('#adminNavigation');
adminMobileNavToggle.addEventListener('click', () => {
  const isExpanded = adminMobileNavToggle.getAttribute('aria-expanded') === 'true';
  adminMobileNavToggle.setAttribute('aria-expanded', String(!isExpanded));
  adminNavigation.classList.toggle('is-open', !isExpanded);
});
adminNavigation.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || adminMobileNavToggle.getAttribute('aria-expanded') !== 'true') return;
  adminNavigation.classList.remove('is-open');
  adminMobileNavToggle.setAttribute('aria-expanded', 'false');
  adminMobileNavToggle.focus();
});
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
admin$$('.admin-refresh').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.refresh === 'customer-profiles') loadAdminCustomers();
  else navigateAdmin(button.dataset.refresh);
}));
admin$('#adminPartnerDealFilters').addEventListener('submit', (event) => {
  event.preventDefault();
  loadAdminPartnerDeals(1);
});
admin$('#adminPartnerDealsRefresh').addEventListener('click', () => loadAdminPartnerDeals());
admin$('#adminPartnerDealsPrevious').addEventListener('click', () => loadAdminPartnerDeals(adminState.partnerDealPage - 1));
admin$('#adminPartnerDealsNext').addEventListener('click', () => loadAdminPartnerDeals(adminState.partnerDealPage + 1));
admin$('#adminFollowUpsRefresh').addEventListener('click', () => {
  loadAdminFollowUpTasks();
  loadAdminFollowUps();
});
admin$('#adminFollowUpsPrevious').addEventListener('click', () => loadAdminFollowUps(adminState.followUpPage - 1));
admin$('#adminFollowUpsNext').addEventListener('click', () => loadAdminFollowUps(adminState.followUpPage + 1));
admin$('#adminFollowUpTasksPrevious').addEventListener('click', () => loadAdminFollowUpTasks(adminState.followUpTaskPage - 1));
admin$('#adminFollowUpTasksNext').addEventListener('click', () => loadAdminFollowUpTasks(adminState.followUpTaskPage + 1));
admin$('#adminFollowUpTaskForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const button = admin$('#adminFollowUpTaskCreate');
  button.disabled = true;
  adminMessage(admin$('#adminFollowUpTaskMessage'), 'Creating follow-up task...', true);
  try {
    await adminApi('admin/follow-up-tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: form.get('title'),
        description: form.get('description'),
        assigned_to_user_id: form.get('assigned_to_user_id') || null,
        due_date: form.get('due_date') || null,
      }),
    });
    formElement.reset();
    adminMessage(admin$('#adminFollowUpTaskMessage'), 'Follow-up task created.', true);
    await loadAdminFollowUpTasks(1);
  } catch (error) {
    adminMessage(admin$('#adminFollowUpTaskMessage'), error.message || 'The follow-up task could not be created.', false);
  } finally {
    button.disabled = false;
  }
});
admin$('#adminOverviewRefresh').addEventListener('click', loadAdminOverview);
admin$('#adminD1Refresh').addEventListener('click', loadAdminD1Operations);
admin$('#adminOrganizationFilters').addEventListener('submit', (event) => event.preventDefault());
admin$('#adminOrganizationSearch').addEventListener('input', renderAdminOrganizations);
admin$('#adminOrganizationStatus').addEventListener('change', renderAdminOrganizations);
admin$('#adminOrganizationType').addEventListener('change', renderAdminOrganizations);
admin$('#adminOrganizationsList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-admin-organization-detail]');
  if (button) loadAdminOrganizationDetail(button.dataset.adminOrganizationDetail);
});
admin$('#adminOrganizationDetail').addEventListener('click', (event) => {
  if (!event.target.closest('[data-admin-organization-close]')) return;
  adminState.organizationDetailRequestId += 1;
  admin$('#adminOrganizationDetail').classList.add('hidden');
});
admin$('#adminSupportFilters').addEventListener('submit', (event) => {
  event.preventDefault();
  loadAdminSupportTickets(1, null);
});
admin$('#adminReactivationRefresh').addEventListener('click', () => loadAdminLicenseReactivations());
admin$('#adminReactivationList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-admin-reactivation]');
  if (!button) return;
  loadAdminLicenseReactivationDetail(button.dataset.adminReactivation);
  admin$$('[data-admin-reactivation]').forEach((item) => {
    const selected = item === button;
    item.classList.toggle('active', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
});
admin$('#adminReactivationDetail').addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-admin-reactivation-review]');
  if (!form) return;
  event.preventDefault();
  const decision = event.submitter?.value;
  if (!['approve', 'reject'].includes(decision)) return;
  const values = new FormData(form);
  if (decision === 'approve' && values.get('phone_confirmed') !== 'true') {
    adminMessage(form.querySelector('[data-admin-reactivation-feedback]'),
      'Confirm the phone call before approving.', false);
    return;
  }
  const buttons = [...form.querySelectorAll('button[type="submit"]')];
  buttons.forEach((button) => { button.disabled = true; });
  const feedback = form.querySelector('[data-admin-reactivation-feedback]');
  try {
    const replacedActivation = values.get('replaced_activation_id');
    await adminApi(`admin/license-reactivations/${encodeURIComponent(form.dataset.adminReactivation)}`, {
      method: 'POST',
      body: JSON.stringify({
        decision,
        reason: values.get('reason'),
        phone_confirmed: values.get('phone_confirmed') === 'true',
        replaced_activation_id: replacedActivation ? Number(replacedActivation) : null,
        cooldown_override: values.get('cooldown_override') === 'true',
      }),
    });
    await loadAdminLicenseReactivations(null);
    const state = admin$('#adminReactivationState');
    if (!state.classList.contains('hidden')) {
      state.textContent = `Request ${decision === 'approve' ? 'approved' : 'rejected'}.`;
    }
  } catch (error) {
    adminMessage(feedback, error.message, false);
    buttons.forEach((button) => { button.disabled = false; });
  }
});
admin$('#adminSupportList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-admin-support-ticket]');
  if (!button) return;
  adminState.supportTicketId = Number(button.dataset.adminSupportTicket);
  renderAdminSupportTicketList(50);
  loadAdminSupportTicket(adminState.supportTicketId);
});
admin$('#adminSupportPagination').addEventListener('click', (event) => {
  const button = event.target.closest('[data-admin-support-page]');
  if (!button || button.disabled) return;
  const nextPage = adminState.supportPage + (button.dataset.adminSupportPage === 'next' ? 1 : -1);
  loadAdminSupportTickets(nextPage, null);
});
admin$('#adminSupportDetail').addEventListener('submit', async (event) => {
  const statusForm = event.target.closest('[data-admin-support-status]');
  const replyForm = event.target.closest('[data-admin-support-reply]');
  const form = statusForm || replyForm;
  if (!form) return;
  event.preventDefault();
  const ticketId = Number(form.dataset.adminSupportStatus || form.dataset.adminSupportReply);
  const button = form.querySelector('button[type="submit"]');
  const feedback = form.querySelector('[data-admin-support-feedback]');
  button.disabled = true;
  try {
    if (statusForm) {
      await adminApi(`admin/support-tickets/${ticketId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: new FormData(statusForm).get('status') }),
      });
    } else {
      await adminApi(`admin/support-tickets/${ticketId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message: new FormData(replyForm).get('message') }),
      });
    }
    await loadAdminSupportTickets(adminState.supportPage, ticketId);
    if (adminState.supportTicketId === ticketId) {
      const feedbackType = statusForm ? 'status' : 'reply';
      const currentFeedback = admin$('#adminSupportDetail').querySelector(`[data-admin-support-feedback="${feedbackType}"]`);
      if (currentFeedback) currentFeedback.textContent = statusForm ? 'Ticket status updated.' : 'Reply sent to customer.';
    }
  } catch (error) {
    feedback.textContent = error.message;
    button.disabled = false;
  }
});

admin$('#adminCustomerSearchForm').addEventListener('submit', (event) => {
  event.preventDefault();
  loadAdminCustomers(admin$('#adminCustomerSearch').value.trim());
});
admin$('#adminCustomerProfileClose').addEventListener('click', () => {
  adminState.customerProfileId = null;
  admin$('#adminCustomerProfilePanel').classList.add('hidden');
  admin$('#adminCustomerProfileForm').reset();
  admin$('#adminCustomerLicenses').textContent = '';
  admin$('#adminCustomerLicensesState').textContent = '';
  clearAdminCustomerResetLink();
});
admin$('#adminCustomerLicensesManage').addEventListener('click', () => {
  const customerId = adminState.customerProfileId;
  if (!customerId) return;
  admin$('#adminRegistrationFilters').reset();
  admin$('#adminRegistrationCustomerId').value = customerId;
  adminState.registrationPage = 1;
  navigateAdmin('products', 'licenses');
});
admin$('#adminCustomerLicenses').addEventListener('click', async (event) => {
  const inspectButton = event.target.closest('[data-customer-license-inspect]');
  if (!inspectButton) return;
  const licenseId = inspectButton.dataset.customerLicenseInspect;
  const row = admin$(`[data-customer-license-detail-row="${licenseId}"]`);
  const panel = admin$(`[data-customer-license-detail-panel="${licenseId}"]`);
  if (panel.dataset.loaded === 'true') {
    const show = row.hidden;
    row.hidden = !show;
    panel.classList.toggle('hidden', !show);
    return;
  }
  row.hidden = false;
  await loadLicenseDetails(licenseId, panel, { allowActivationRevoke: false });
});
admin$('#adminCustomerProfileEdit').addEventListener('click', () => setAdminCustomerProfileEditMode(true));
admin$('#adminCustomerAddressAdd').addEventListener('click', () => {
  admin$('#adminCustomerAddresses').insertAdjacentHTML('beforeend', renderAdminCustomerAddress());
  const lastRow = admin$('#adminCustomerAddresses').lastElementChild;
  lastRow.querySelectorAll('input, textarea').forEach((input) => { input.disabled = false; });
  lastRow.querySelector('[name="address_line1"]').focus();
});
admin$('#adminCustomerAddresses').addEventListener('click', (event) => {
  if (event.target.closest('[data-remove-new-customer-address]')) {
    event.target.closest('[data-customer-address-row]').remove();
  }
});
admin$('#adminCustomerProfileCancel').addEventListener('click', () => {
  if (adminState.customerProfileId) openAdminCustomerProfile(adminState.customerProfileId);
});
admin$('#adminCustomerProfileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const customerId = adminState.customerProfileId;
  if (!customerId) return;
  const button = admin$('#adminCustomerProfileSave');
  const form = new FormData(event.currentTarget);
  const addresses = [...admin$('#adminCustomerAddresses').querySelectorAll('[data-customer-address-row]')].map((row) => {
    const value = (name) => row.querySelector(`[name="${name}"]`).value;
    return {
      ...(row.dataset.addressId ? { id: Number(row.dataset.addressId) } : {}),
      address_type: value('address_type'),
      address_line1: value('address_line1'),
      address_line2: value('address_line2'),
      city: value('city'),
      state: value('state'),
      postal_code: value('postal_code'),
      country: value('country'),
      is_default: row.querySelector('[name="is_default"]').checked,
    };
  });
  button.disabled = true;
  adminMessage(admin$('#adminCustomerProfileMessage'), 'Saving customer profile...', true);
  try {
    await adminApi(`admin/customers/${encodeURIComponent(customerId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: form.get('name'),
        phone: form.get('phone'),
        gst_number: form.get('gst_number'),
        website: form.get('website'),
        bio: form.get('bio'),
        timezone: form.get('timezone'),
        addresses,
      }),
    });
    const [profileLoaded] = await Promise.all([
      openAdminCustomerProfile(customerId),
      loadAdminCustomers(),
    ]);
    if (adminState.customerProfileId === customerId && profileLoaded) {
      adminMessage(admin$('#adminCustomerProfileMessage'), 'Customer profile saved.', true);
    }
  } catch (error) {
    if (adminState.customerProfileId === customerId) {
      adminMessage(admin$('#adminCustomerProfileMessage'), error.message || 'Customer profile could not be saved.', false);
    }
  } finally {
    button.disabled = false;
  }
});
admin$('#adminCustomerResetButton').addEventListener('click', async () => {
  const customerId = adminState.customerProfileId;
  if (!customerId) return;
  if (!window.confirm('Generate a single-use password reset link that expires in 30 minutes?')) return;
  const button = admin$('#adminCustomerResetButton');
  button.disabled = true;
  admin$('#adminCustomerResetResult').classList.add('hidden');
  admin$('#adminCustomerResetLink').value = '';
  adminMessage(admin$('#adminCustomerResetMessage'), 'Generating a one-time reset link...', true);
  try {
    const data = await adminApi(`admin/customers/${encodeURIComponent(customerId)}/password-reset`, {
      method: 'POST',
      body: '{}',
    });
    if (adminState.customerProfileId !== customerId) return;
    admin$('#adminCustomerResetLink').value = new URL(data.reset_path, window.location.origin).href;
    admin$('#adminCustomerResetResult').classList.remove('hidden');
    adminMessage(admin$('#adminCustomerResetMessage'), `Reset link expires in ${data.expires_in_minutes} minutes. It can only be used once.`, true);
  } catch (error) {
    adminMessage(admin$('#adminCustomerResetMessage'), error.message || 'A reset link could not be generated.', false);
  } finally {
    button.disabled = false;
  }
});
admin$('#adminCustomerResetCopy').addEventListener('click', async () => {
  const input = admin$('#adminCustomerResetLink');
  try {
    await navigator.clipboard.writeText(input.value);
    adminMessage(admin$('#adminCustomerResetMessage'), 'Reset link copied. Share it securely with the customer.', true);
  } catch {
    input.focus();
    input.select();
    adminMessage(admin$('#adminCustomerResetMessage'), 'Select and copy the reset link manually.', false);
  }
});

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
        phone: values.get('phone'),
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
        phone: values.get('phone'),
        name: values.get('name'),
        legal_name: values.get('legal_name'),
        address: values.get('address'),
        city: values.get('city'),
        state: values.get('state'),
        pincode: values.get('pincode'),
        country: values.get('country'),
        organization_phone: values.get('organization_phone'),
        tax_id: values.get('tax_id'),
        website: values.get('website'),
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

admin$('#adminLogout').addEventListener('click', logoutAdmin);

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

admin$('#adminReleaseForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const releaseId = admin$('#adminReleaseId').value;
  const assets = [];
  for (const row of admin$$('#adminReleaseAssets .admin-release-asset-row')) {
    const asset = Object.fromEntries([...row.querySelectorAll('[data-release-asset]')].map((input) => [input.dataset.releaseAsset, input.value.trim()]));
    if (!Object.values(asset).some(Boolean)) continue;
    if (!asset.name || !asset.download_url || !asset.checksum) {
      adminMessage(admin$('#adminReleaseMessage'), 'Complete the name, HTTPS URL, and SHA-256 checksum for each download.', false);
      return;
    }
    assets.push(asset);
  }
  const body = {
    title: admin$('#adminReleaseTitle').value,
    summary: admin$('#adminReleaseSummary').value,
    release_notes: admin$('#adminReleaseNotes').value,
    assets,
  };
  if (!releaseId) {
    body.product_id = admin$('#adminReleaseProduct').value;
    body.version = admin$('#adminReleaseVersion').value;
  }
  const button = admin$('#adminReleaseSaveButton');
  button.disabled = true;
  try {
    const result = await adminApi(releaseId ? `admin/releases/${releaseId}` : 'admin/releases', {
      method: releaseId ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    });
    adminMessage(admin$('#adminReleaseMessage'), releaseId ? 'Draft updated.' : `Draft release #${result.release.id} created.`, true);
    resetAdminReleaseForm();
    await loadAdminReleases();
  } catch (error) {
    adminMessage(admin$('#adminReleaseMessage'), error.message, false);
  } finally {
    button.disabled = false;
  }
});

admin$('#adminReleaseAddAsset').addEventListener('click', () => {
  admin$('#adminReleaseAssets').insertAdjacentHTML('beforeend', adminReleaseAssetRow());
});
admin$('#adminReleaseAssets').addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-release-asset-remove]');
  if (removeButton) removeButton.closest('.admin-release-asset-row').remove();
});
admin$('#adminReleaseCancelEdit').addEventListener('click', resetAdminReleaseForm);
admin$('#adminReleasesList').addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-release-edit]');
  if (editButton) {
    const release = adminState.releases.find((item) => item.id === Number(editButton.dataset.releaseEdit));
    if (!release || release.status !== 'draft') return;
    admin$('#adminReleaseId').value = release.id;
    admin$('#adminReleaseProduct').value = release.product_id;
    admin$('#adminReleaseProduct').disabled = true;
    admin$('#adminReleaseVersion').value = release.version;
    admin$('#adminReleaseVersion').disabled = true;
    admin$('#adminReleaseTitle').value = release.title;
    admin$('#adminReleaseSummary').value = release.summary || '';
    admin$('#adminReleaseNotes').value = release.release_notes || '';
    admin$('#adminReleaseAssets').innerHTML = release.assets.length
      ? release.assets.map((asset) => adminReleaseAssetRow(asset)).join('')
      : adminReleaseAssetRow();
    admin$('#adminReleaseSaveButton').textContent = 'Save draft';
    admin$('#adminReleaseCancelEdit').classList.remove('hidden');
    admin$('#adminReleaseTitle').focus();
    return;
  }

  const transitionButton = event.target.closest('[data-release-transition]');
  if (!transitionButton) return;
  const status = transitionButton.dataset.releaseTransition;
  const releaseId = transitionButton.dataset.releaseId;
  if (status === 'published' && !window.confirm('Publish this release to eligible licensed organizations?')) return;
  if (status === 'withdrawn' && !window.confirm('Withdraw this release from customer and partner views?')) return;
  transitionButton.disabled = true;
  try {
    await adminApi(`admin/releases/${releaseId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    adminMessage(admin$('#adminReleaseMessage'), `Release status changed to ${status}.`, true);
    await loadAdminReleases();
  } catch (error) {
    adminMessage(admin$('#adminReleaseMessage'), error.message, false);
  } finally {
    transitionButton.disabled = false;
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
  const printButton = event.target.closest('[data-partner-allocation-print]');
  if (!adminState.licenseCodeBatchId) return;
  if (printButton) {
    try {
      printPartnerAllocationNote(Number(printButton.dataset.partnerAllocationPrint));
    } catch (error) {
      admin$('#adminError').classList.remove('hidden');
      adminMessage(admin$('#adminError'), error.message || 'The allocation note could not be printed.', false);
    }
    return;
  }
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
    partner_organization_id: form.get('partner_organization_id') || null,
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
    body.partner_organization_id
      ? `Allocated ${result.issued_count} serial number(s) to the selected partner. The allocation was audited.`
      : `Marked ${result.issued_count} serial number(s) as issued. The delivery action was audited.`,
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
    body.customer_phone = form.get('customer_phone');
    body.customer_name = form.get('customer_name');
    body.customer_company = form.get('customer_company');
  } else {
    body.organization_id = form.get('organization_id');
    body.customer_id = form.get('customer_id') || null;
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
  const printButton = event.target.closest('[data-license-print]');
  if (printButton) {
    try {
      printCustomerLicenseSummary(printButton.dataset.licensePrint);
    } catch (error) {
      admin$('#adminError').classList.remove('hidden');
      adminMessage(admin$('#adminError'), error.message || 'The license summary could not be printed.', false);
    }
    return;
  }

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

admin$('#adminRegistrationCustomerScopeClear').addEventListener('click', () => {
  admin$('#adminRegistrationCustomerId').value = '';
  loadLicenseRegistrations({ resetPage: true });
});

admin$('#adminRegistrationPagination').addEventListener('click', (event) => {
  const button = event.target.closest('[data-registration-page]');
  if (!button || button.disabled) return;
  adminState.registrationPage += button.dataset.registrationPage === 'next' ? 1 : -1;
  loadLicenseRegistrations();
});

showAdminPortal();
