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
 * @updated     2026-11-14
 *
 * @description Manages the authenticated admin workspace and customer invitations.
 */
const adminState = { token: null, announcements: [], products: [], licenses: [], organizations: [] };
const admin$ = (selector) => document.querySelector(selector);
const admin$$ = (selector) => [...document.querySelectorAll(selector)];

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
}

function showAdminLogin(message = '') {
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
  const data = await adminApi('admin/overview');
  admin$('#adminMetrics').innerHTML = Object.entries(data.metrics).map(([key, value]) => `<article class="card"><span class="stat-label">${adminEscape(key)}</span><strong class="stat-value">${adminEscape(value)}</strong></article>`).join('');
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
    if (!data.organizations.length) return adminStatePanel('adminOrganizationsState', 'adminOrganizationsList', 'No organizations found.');
    admin$('#adminOrganizationsState').classList.add('hidden');
    const list = admin$('#adminOrganizationsList');
    list.classList.remove('hidden');
    list.innerHTML = `<table class="admin-table"><thead><tr><th>Organization</th><th>Legal name</th><th>Status</th><th>Members</th></tr></thead><tbody>${data.organizations.map((organization) => `<tr><td>${adminEscape(organization.name)}</td><td>${adminEscape(organization.legal_name || 'Not provided')}</td><td><span class="status">${adminEscape(organization.status)}</span></td><td>${adminEscape(organization.member_count)}</td></tr>`).join('')}</tbody></table>`;
  } catch (error) { adminStatePanel('adminOrganizationsState', 'adminOrganizationsList', 'Organizations are unavailable.', true); }
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

async function loadAdminProducts() {
  try {
    const [products, licenses, organizations] = await Promise.all([
      adminApi('products'),
      adminApi('licenses'),
      adminApi('admin/organizations'),
    ]);
    adminState.products = products.products;
    adminState.licenses = licenses.licenses;
    adminState.organizations = organizations.organizations;
    admin$('#adminProductsState').classList.add('hidden');
    admin$('#adminProductsList').innerHTML = `<article class="card module"><span class="eyebrow">Products</span><strong class="stat-value">${products.products.length}</strong><p>Catalog records</p></article><article class="card module"><span class="eyebrow">Licenses</span><strong class="stat-value">${licenses.licenses.length}</strong><p>License authority records</p></article>${products.products.map((product) => `<article class="card module"><span class="eyebrow">${adminEscape(product.code)}</span><h3>${adminEscape(product.name)}</h3><p>${adminEscape(product.status)}</p></article>`).join('')}`;
    const activeProducts = products.products.filter((product) => product.status === 'active');
    const productOptions = activeProducts.map((product) => `<option value="${adminEscape(product.id)}">${adminEscape(product.name)} (${adminEscape(product.code)})</option>`).join('');
    admin$('#licenseProduct').innerHTML = productOptions;
    admin$('#licensePolicyProduct').innerHTML = productOptions;
    const activeOrganizations = organizations.organizations.filter((organization) => organization.status === 'active');
    admin$('#licenseOrganization').innerHTML = activeOrganizations.map((organization) => `<option value="${adminEscape(organization.id)}">${adminEscape(organization.name)}${organization.legal_name ? ` — ${adminEscape(organization.legal_name)}` : ''}</option>`).join('');
    admin$('#licenseStartDate').value ||= new Date().toISOString().slice(0, 10);
    await Promise.all([
      loadLicenseEditions(admin$('#licenseProduct'), admin$('#licenseEdition')),
      loadLicenseEditions(admin$('#licensePolicyProduct'), admin$('#licensePolicyEdition')),
    ]);
    await loadLicensePolicy();
    renderAdminLicenses();
  } catch (error) {
    admin$('#adminProductsState').className = 'state-panel error-state';
    admin$('#adminProductsState').textContent = error.status === 403 ? 'Super admin license permissions are required.' : 'Products, organizations, or licenses are unavailable.';
  }
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

function renderAdminLicenses() {
  const state = admin$('#adminLicensesState');
  const list = admin$('#adminLicensesList');
  const licensesById = new Map(adminState.licenses.map((license) => [license.id, license]));
  const licenses = [...licensesById.values()];
  if (!licenses.length) {
    state.classList.remove('hidden');
    state.textContent = 'No licenses have been issued.';
    list.innerHTML = '';
    return;
  }
  state.classList.add('hidden');
  list.innerHTML = licenses.map((license) => {
    const organization = adminState.organizations.find((item) => item.id === license.organization_id);
    const maskedKey = license.license_key ? `${license.license_key.slice(0, 5)}…${license.license_key.slice(-4)}` : 'Unavailable';
    const canRenew = ['ACTIVE', 'EXPIRED', 'PENDING_RENEWAL'].includes(license.status);
    return `<article class="card license-card" data-license-card="${adminEscape(license.id)}">
      <div class="license-card-head"><div><span class="eyebrow">${adminEscape(license.product?.code || 'Product')} · ${adminEscape(license.edition?.name || 'No edition')}</span><h3>${adminEscape(organization?.name || `Organization ${license.organization_id}`)}</h3><p class="muted">${adminEscape(license.product?.name || '')} · License #${adminEscape(license.id)}</p></div><span class="status status-${adminEscape(String(license.status).toLowerCase())}">${adminEscape(license.status)}</span></div>
      <div class="license-meta"><div><span>License key</span><strong>${adminEscape(maskedKey)}</strong></div><div><span>Start</span><strong>${adminEscape(license.start_date || '—')}</strong></div><div><span>Expiry</span><strong>${adminEscape(license.expiry_date || 'Perpetual')}</strong></div><div><span>Activations</span><strong>${adminEscape(license.activation_count ?? 0)}</strong></div></div>
      <div class="form-actions"><button class="secondary" type="button" data-license-details="${adminEscape(license.id)}">Inspect license</button>${license.status === 'ACTIVE' ? `<button class="secondary" type="button" data-license-suspend="${adminEscape(license.id)}">Suspend</button>` : ''}${canRenew ? `<label class="inline-date">Renew through <input type="date" data-license-renew-date="${adminEscape(license.id)}" /></label><button class="secondary" type="button" data-license-renew="${adminEscape(license.id)}">Renew</button>` : ''}</div>
      <div class="license-details hidden" data-license-detail-panel="${adminEscape(license.id)}"></div>
    </article>`;
  }).join('');
}

function renderLicenseDetails(licenseId, data) {
  const entitlements = data.entitlements.entitlements.map((item) => `<div><dt>${adminEscape(item.key)}</dt><dd>${adminEscape(typeof item.value === 'object' ? JSON.stringify(item.value) : item.value)}</dd></div>`).join('');
  const activations = data.activations.activations.map((item) => `<li><strong>${adminEscape(item.installation_id)}</strong> · ${adminEscape(item.status)} · Last seen ${adminEscape(item.last_seen_at || '—')}${item.status === 'active' ? ` <button type="button" class="text-button" data-activation-revoke="${adminEscape(item.id)}" data-license-id="${adminEscape(licenseId)}">Revoke</button>` : ''}</li>`).join('');
  const artifacts = data.artifacts.artifacts.map((item) => `<li>${adminEscape(item.document_id)} · ${adminEscape(item.algorithm)} · key ${adminEscape(item.key_id)} · ${adminEscape(item.issued_at)}</li>`).join('');
  const events = data.events.events.map((item) => `<li>${adminEscape(item.created_at)} · ${adminEscape(item.event_type)} · ${adminEscape(item.previous_status || '—')} → ${adminEscape(item.new_status || '—')}</li>`).join('');
  return `<div class="license-detail-grid"><section><h4>Entitlements</h4><dl class="entitlement-list">${entitlements || '<dd>None</dd>'}</dl></section><section><h4>Activations</h4><ul>${activations || '<li>None</li>'}</ul></section><section><h4>Signed artifacts</h4><ul>${artifacts || '<li>None</li>'}</ul></section><section><h4>Lifecycle events</h4><ul>${events || '<li>None</li>'}</ul></section></div>`;
}

async function loadLicenseDetails(licenseId, panel) {
  panel.textContent = 'Loading license details...';
  panel.classList.remove('hidden');
  try {
    const [entitlements, activations, artifacts, events] = await Promise.all([
      adminApi(`licenses/${licenseId}/entitlements`),
      adminApi(`licenses/${licenseId}/activations`),
      adminApi(`licenses/${licenseId}/artifacts`),
      adminApi(`licenses/${licenseId}/events`),
    ]);
    panel.innerHTML = renderLicenseDetails(licenseId, { entitlements, activations, artifacts, events });
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
    admin$('#adminUserName').textContent = identity.user.name || identity.user.email;
    await loadAdminOverview();
  } catch (error) {
    adminState.token = null;
    showAdminLogin(error.status === 403 ? 'Super admin access required.' : 'Your session has expired.');
  }
}

function navigateAdmin(view) {
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
    loadAdminOrganizations();
    loadAdminCustomerInvites();
  }
  if (view === 'products') loadAdminProducts();
  if (view === 'announcements') loadAdminAnnouncements();
  if (view === 'audit') loadAdminAudit();
}

admin$$('.admin-nav button').forEach((button) => button.addEventListener('click', () => navigateAdmin(button.dataset.adminView)));
admin$$('.admin-refresh').forEach((button) => button.addEventListener('click', () => navigateAdmin(button.dataset.refresh)));

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
      }),
    });
    admin$('#customerInviteLink').value = new URL(result.setup_path, window.location.origin).href;
    admin$('#customerInviteResult').classList.remove('hidden');
    formElement.reset();
    adminMessage(admin$('#customerInviteMessage'), 'Invite created. Copy the link now and share it only with the intended customer.', true);
    await loadAdminCustomerInvites();
  } catch (error) {
    adminMessage(admin$('#customerInviteMessage'), error.message, false);
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

admin$('#licenseProduct').addEventListener('change', async () => {
  try { await loadLicenseEditions(admin$('#licenseProduct'), admin$('#licenseEdition')); }
  catch (error) { adminMessage(admin$('#licenseIssueMessage'), error.message, false); }
});

admin$('#licensePolicyProduct').addEventListener('change', async () => {
  try {
    await loadLicenseEditions(admin$('#licensePolicyProduct'), admin$('#licensePolicyEdition'));
    await loadLicensePolicy();
  } catch (error) { adminMessage(admin$('#licensePolicyMessage'), error.message, false); }
});

admin$('#licensePolicyEdition').addEventListener('change', loadLicensePolicy);

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
    organization_id: form.get('organization_id'),
    product_id: form.get('product_id'),
    edition_id: form.get('edition_id'),
    company_binding: binding,
    start_date: form.get('start_date'),
    expiry_date: form.get('expiry_date') || null,
    status: form.get('status'),
    entitlements,
  };
  const button = admin$('#licenseIssueButton');
  button.disabled = true;
  try {
    const result = await adminApi('licenses', { method: 'POST', body: JSON.stringify(body) });
    adminMessage(admin$('#licenseIssueMessage'), `License issued. Deliver this key securely; it will be masked in the license list: ${result.license.license_key}`, true);
    formElement.reset();
    admin$('#licenseStartDate').value = new Date().toISOString().slice(0, 10);
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
    if (panel.dataset.loaded === 'true') panel.classList.toggle('hidden');
    else await loadLicenseDetails(detailsButton.dataset.licenseDetails, panel);
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

showAdminPortal();
