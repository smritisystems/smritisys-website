const adminState = { token: localStorage.getItem('smritisys_admin_token') };
const admin$ = (selector) => document.querySelector(selector);
const admin$$ = (selector) => [...document.querySelectorAll(selector)];

function adminEscape(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

async function adminApi(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (adminState.token) headers.Authorization = `Bearer ${adminState.token}`;
  const response = await fetch(`/api/${path}`, { ...options, headers });
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

function showAdminLogin(message = '') {
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

async function loadAdminProducts() {
  try {
    const [products, licenses] = await Promise.all([adminApi('products'), adminApi('licenses')]);
    admin$('#adminProductsState').classList.add('hidden');
    admin$('#adminProductsList').innerHTML = `<article class="card module"><span class="eyebrow">Products</span><strong class="stat-value">${products.products.length}</strong><p>Catalog records</p></article><article class="card module"><span class="eyebrow">Licenses</span><strong class="stat-value">${licenses.licenses.length}</strong><p>License authority records</p></article>${products.products.map((product) => `<article class="card module"><span class="eyebrow">${adminEscape(product.code)}</span><h3>${adminEscape(product.name)}</h3><p>${adminEscape(product.status)}</p></article>`).join('')}`;
  } catch (error) { admin$('#adminProductsState').className = 'state-panel error-state'; admin$('#adminProductsState').textContent = 'Products or licenses are unavailable.'; }
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

async function loadAdminWorkspace() {
  try {
    const identity = await adminApi('me');
    if (identity.account_type !== 'user' || identity.user?.role !== 'super_admin') throw Object.assign(new Error('Super admin access required'), { status: 403 });
    admin$('#adminUserName').textContent = identity.user.name || identity.user.email;
    await loadAdminOverview();
  } catch (error) {
    localStorage.removeItem('smritisys_admin_token');
    adminState.token = null;
    showAdminLogin(error.status === 403 ? 'Super admin access required.' : 'Your session has expired.');
  }
}

function navigateAdmin(view) {
  const button = admin$(`button[data-admin-view="${view}"]`);
  if (!button) return;
  admin$$('.admin-nav button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  admin$$('.admin-view').forEach((section) => section.classList.toggle('active', section.dataset.adminSection === view));
  admin$('#adminPageTitle').textContent = button.textContent;
  if (view === 'overview') loadAdminOverview();
  if (view === 'users') loadAdminUsers();
  if (view === 'organizations') loadAdminOrganizations();
  if (view === 'products') loadAdminProducts();
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
    adminState.token = data.token;
    localStorage.setItem('smritisys_admin_token', data.token);
    showAdminPortal();
  } catch (error) { adminMessage(admin$('#adminLoginMessage'), error.status === 401 ? 'Invalid email or password.' : error.message, false); }
  finally { button.disabled = false; }
});

admin$('#adminLogout').addEventListener('click', async () => {
  try { await adminApi('logout', { method: 'POST' }); } catch {}
  localStorage.removeItem('smritisys_admin_token');
  adminState.token = null;
  showAdminLogin();
});

if (adminState.token) showAdminPortal();
