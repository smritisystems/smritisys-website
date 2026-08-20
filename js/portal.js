const state = {
  token: localStorage.getItem('smritisys_token'),
  accountType: localStorage.getItem('smritisys_account_type') || 'customer',
  profile: null,
  organization: null,
  licenses: [],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function setMessage(element, text, ok) {
  if (!element) return;
  element.textContent = text;
  element.style.color = ok ? 'var(--turquoise)' : 'var(--red)';
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`/api/${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({ error: 'Invalid server response' }));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function formatDate(value) {
  if (!value) return 'Not set';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function statusLabel(status) {
  return ({
    ACTIVE: 'Active', SUSPENDED: 'Suspended', PENDING_RENEWAL: 'Pending renewal',
    EXPIRED: 'Expired', CANCELLED: 'Cancelled', DRAFT: 'Draft',
    active: 'Active', inactive: 'Inactive', open: 'Open', in_progress: 'In progress'
  }[status] || status || 'Unknown');
}

function statusMessage(license) {
  if (license.status === 'ACTIVE' && license.validity?.days_remaining !== null && license.validity.days_remaining <= 30) {
    return `Your license expires in ${license.validity.days_remaining} days.`;
  }
  return ({
    ACTIVE: 'Your license is active.', SUSPENDED: 'Your license is currently suspended.',
    PENDING_RENEWAL: 'Your license is pending renewal.', EXPIRED: 'Your license has expired.',
    CANCELLED: 'This license has been cancelled.', DRAFT: 'This license is being prepared.'
  }[license.status] || 'License status is unavailable.');
}

function showPortal() {
  $('#loginView').classList.add('hidden');
  $('#portalView').classList.remove('hidden');
  loadPortal();
}

function showLogin(message = '') {
  $('#portalView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
  setMessage($('#loginMessage'), message, false);
}

function updateIdentity(profile) {
  const name = profile?.name || 'Customer';
  $('#userName').textContent = name;
  $('#welcomeName').textContent = name.split(' ')[0];
  $('#userAvatar').textContent = name.charAt(0).toUpperCase();
}

function fillProfile(profile) {
  ['name', 'email', 'phone', 'company', 'gst_number', 'website', 'bio'].forEach((key) => {
    const input = $(`#profile${key === 'gst_number' ? 'Gst' : key[0].toUpperCase() + key.slice(1)}`);
    if (input) input.value = profile?.[key] || '';
  });
}

function renderOrganization(data) {
  state.organization = data.organization;
  $('#organizationState').classList.add('hidden');
  $('#organizationDetails').classList.remove('hidden');
  $('#organizationDetails').innerHTML = `<article class="card module"><div><span class="eyebrow">Organization</span><h3>${escapeHtml(data.organization.name)}</h3><p>${escapeHtml(data.organization.legal_name || 'Legal name not provided')}</p></div><span class="status">${escapeHtml(statusLabel(data.organization.status))}</span></article><article class="card module"><div><span class="eyebrow">Primary contact</span><h3>${escapeHtml(state.profile.name)}</h3><p>${escapeHtml(state.profile.email)}</p></div><span class="status">${escapeHtml(statusLabel(data.organization.current_role))}</span></article>`;
  $('#memberList').innerHTML = data.members.length
    ? data.members.map((member) => `<article class="member-row"><div><strong>${escapeHtml(member.name || 'Unnamed member')}</strong><small>${escapeHtml(member.email)}</small></div><span class="status">${escapeHtml(statusLabel(member.member_role))}</span></article>`).join('')
    : '<p class="muted">No authorized members found.</p>';
  $('#dashboardOrganization').textContent = data.organization.name;
  $('#dashboardOrganizationStatus').textContent = statusLabel(data.organization.status);
}

function renderLicenseCard(license, detail = {}) {
  const entitlements = detail.entitlements || [];
  const activationCount = (detail.activations || []).filter((activation) => activation.status === 'active').length;
  const entitlementMarkup = entitlements.length
    ? `<dl class="entitlement-list">${entitlements.map((item) => `<div><dt>${escapeHtml(item.key.replace(/[_.-]/g, ' '))}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join('')}</dl>`
    : '<p class="muted">No entitlements recorded.</p>';
  const requestMarkup = ['renewal', 'upgrade', 'additional_users', 'additional_branches', 'additional_modules']
    .map((requestType) => `<button class="secondary license-request" type="button" data-license-id="${license.id}" data-request-type="${requestType}">${escapeHtml(requestType.replace(/_/g, ' '))}</button>`).join('');
  return `<article class="card license-card"><div class="license-card-head"><div><span class="eyebrow">${escapeHtml(license.product.code)}</span><h3>${escapeHtml(license.product.name)}</h3><p class="muted">${escapeHtml(license.edition?.name || 'Edition not assigned')} · ${escapeHtml(license.license_key)}</p></div><span class="status status-${escapeHtml(license.status.toLowerCase())}">${escapeHtml(statusLabel(license.status))}</span></div><p class="license-message">${escapeHtml(statusMessage(license))}</p><div class="license-meta"><div><span>Valid from</span><strong>${formatDate(license.start_date)}</strong></div><div><span>Expires</span><strong>${formatDate(license.expiry_date)}</strong></div><div><span>Days remaining</span><strong>${license.validity?.days_remaining ?? 'No expiry'}</strong></div><div><span>Activations</span><strong>${activationCount}</strong></div></div><div class="entitlements"><span class="eyebrow">Entitlements</span>${entitlementMarkup}</div><div class="request-actions"><span class="eyebrow">Request a change</span><div class="request-buttons">${requestMarkup}</div><p class="muted request-note">Requests are reviewed by SMRITISYS. License authority remains read-only here.</p><p class="message request-message" role="status"></p></div></article>`;
}

async function fetchLicenseDetails(licenses) {
  return Promise.all(licenses.map(async (license) => {
    const [entitlements, activations, events] = await Promise.all([
      api(`licenses/${license.id}/entitlements`),
      api(`licenses/${license.id}/activations`),
      api(`licenses/${license.id}/events`),
    ]);
    return { ...license, detail: { entitlements: entitlements.entitlements, activations: activations.activations, events: events.events } };
  }));
}

function renderLicenses(licenses, targetId = 'licenseList') {
  const target = $(`#${targetId}`);
  if (!licenses.length) {
    target.innerHTML = '<div class="state-panel"><h3>No licenses yet</h3><p class="muted">Your product licenses will appear here after SMRITISYS provisions them.</p></div>';
    return;
  }
  target.innerHTML = licenses.map((license) => renderLicenseCard(license, license.detail)).join('');
}

function renderProducts(licenses) {
  const target = $('#productList');
  const products = [...new Map(licenses.map((license) => [`${license.product.id}-${license.edition?.id || 'none'}`, license])).values()];
  target.innerHTML = products.length
    ? products.map((license) => `<article class="card module"><div><span class="eyebrow">${escapeHtml(license.product.code)}</span><h3>${escapeHtml(license.product.name)}</h3><p>${escapeHtml(license.edition?.name || 'Edition not assigned')} · ${escapeHtml(statusMessage(license))}</p></div><span class="status">${escapeHtml(statusLabel(license.status))}</span></article>`).join('')
    : '<div class="state-panel"><h3>No products yet</h3><p class="muted">Products associated with your organization will appear here.</p></div>';
}

function renderReleaseCard(release, detail = false) {
  const assets = detail && release.assets?.length
    ? `<div class="release-assets"><span class="eyebrow">Downloads</span>${release.assets.map((asset) => `<a class="secondary" href="${escapeHtml(asset.download_url)}" target="_blank" rel="noopener">${escapeHtml(asset.name)}${asset.platform ? ` · ${escapeHtml(asset.platform)}` : ''}</a>`).join('')}</div>`
    : '';
  return `<article class="card release-card"><div class="license-card-head"><div><span class="eyebrow">${escapeHtml(release.product.code)} · ${escapeHtml(release.version)}</span><h3>${escapeHtml(release.title)}</h3><p class="muted">${escapeHtml(release.product.name)} · Published ${formatDate(release.published_at?.slice(0, 10))}</p></div><span class="status">Published</span></div><p>${escapeHtml(release.summary || 'Release information is available for your licensed product.')}</p>${release.release_notes ? `<div class="release-notes"><span class="eyebrow">Release notes</span><p>${escapeHtml(release.release_notes)}</p></div>` : ''}${assets}</article>`;
}

async function loadReleases(targetId = 'releaseList') {
  const statePanel = $('#releaseState');
  if (statePanel) { statePanel.className = 'state-panel'; statePanel.textContent = 'Loading releases...'; }
  try {
    const data = await api('releases');
    const latest = data.releases[0];
    if ($('#dashboardRelease')) $('#dashboardRelease').innerHTML = latest
      ? `<strong>${escapeHtml(latest.product.name)} ${escapeHtml(latest.version)} · ${escapeHtml(latest.title)}</strong><p class="muted">${escapeHtml(latest.summary || 'A new eligible release is available.')}</p>`
      : '<p class="muted">No eligible releases are available for your licensed products.</p>';
    if (!data.releases.length) {
      if (statePanel) { statePanel.className = 'state-panel'; statePanel.innerHTML = '<h3>No releases yet</h3><p class="muted">Eligible product releases will appear here when published.</p>'; }
      return;
    }
    if (statePanel) statePanel.classList.add('hidden');
    const target = $(`#${targetId}`);
    if (target) target.innerHTML = data.releases.map((release) => renderReleaseCard(release, true)).join('');
  } catch (error) {
    if (statePanel) { statePanel.className = 'state-panel error-state'; statePanel.textContent = error.status === 403 ? 'You are not authorized to view releases.' : 'Release information is unavailable.'; }
    if ($('#dashboardRelease')) $('#dashboardRelease').innerHTML = '<p class="muted">Release information is unavailable.</p>';
  }
}

async function loadCommercial() {
  const statePanel = $('#commercialState');
  statePanel.className = 'state-panel';
  statePanel.textContent = 'Loading commercial relationship...';
  try {
    const data = await api('commercial/summary');
    const summary = data.summary;
    $('#commercialSummary').className = 'grid modules';
    $('#commercialSummary').innerHTML = `<article class="card module"><span class="eyebrow">Orders</span><strong class="stat-value">${summary.orders.length}</strong><p>Commercial relationship orders</p></article><article class="card module"><span class="eyebrow">AMC contracts</span><strong class="stat-value">${summary.amc_contracts.length}</strong><p>Service relationship records</p></article>`;
    $('#commercialOrders').className = 'card';
    $('#commercialOrders').innerHTML = `<div class="section-head compact"><div><span class="eyebrow">Order history</span><h3>Commercial orders</h3></div></div>${summary.orders.length ? `<table class="partner-table"><thead><tr><th>Order</th><th>Total</th><th>Status</th><th>Created</th></tr></thead><tbody>${summary.orders.map((order) => `<tr><td>${escapeHtml(order.order_number)}</td><td>${escapeHtml(order.total_amount)}</td><td><span class="status">${escapeHtml(order.status)}</span></td><td>${formatDate(order.created_at?.slice(0, 10))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No commercial orders yet.</p>'}<div class="section-head compact commercial-subhead"><div><span class="eyebrow">Service relationship</span><h3>AMC contracts</h3></div></div>${summary.amc_contracts.length ? `<table class="partner-table"><thead><tr><th>Contract</th><th>Valid from</th><th>Expires</th><th>Status</th></tr></thead><tbody>${summary.amc_contracts.map((contract) => `<tr><td>${escapeHtml(contract.contract_number)}</td><td>${formatDate(contract.starts_at)}</td><td>${formatDate(contract.expires_at)}</td><td><span class="status">${escapeHtml(contract.status)}</span></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No AMC contract records yet.</p>'}`;
    statePanel.classList.add('hidden');
  } catch (error) {
    statePanel.className = 'state-panel error-state';
    statePanel.textContent = error.status === 403 ? 'You are not authorized to view commercial relationship data.' : 'Commercial relationship data is unavailable.';
  }
}

async function loadLicenses() {
  const panel = $('#licenseStatePanel');
  panel.className = 'state-panel';
  panel.textContent = 'Loading licenses...';
  try {
    const data = await api('licenses');
    state.licenses = await fetchLicenseDetails(data.licenses);
    panel.classList.add('hidden');
    renderLicenses(state.licenses);
    renderProducts(state.licenses);
    const active = state.licenses.filter((license) => license.status === 'ACTIVE' && license.validity.is_valid);
    $('#licenseCount').textContent = state.licenses.length;
    $('#licenseState').textContent = active.length ? 'Active' : 'Review needed';
    $('#activeProductCount').textContent = new Set(active.map((license) => license.product.id)).size;
    $('#activeProductState').textContent = active.length ? 'In service' : 'No active products';
    renderLicenses(state.licenses, 'dashboardLicenses');
  } catch (error) {
    panel.className = 'state-panel error-state';
    panel.textContent = error.status === 403 ? 'You are not authorized to view licenses.' : 'Licenses could not be loaded. Please refresh and try again.';
    $('#dashboardLicenses').innerHTML = '<div class="state-panel error-state">License data is unavailable.</div>';
  }
}

async function loadOrganization() {
  $('#organizationState').className = 'state-panel';
  $('#organizationState').textContent = 'Loading organization...';
  try {
    renderOrganization(await api('organization'));
  } catch (error) {
    $('#organizationState').className = 'state-panel error-state';
    $('#organizationState').textContent = error.status === 403 ? 'You are not authorized to view this organization.' : 'Organization details could not be loaded.';
  }
}

async function loadTickets() {
  if (!$('#ticketList')) return;
  $('#ticketList').innerHTML = '<p class="muted">Loading tickets...</p>';
  try {
    const data = await api('tickets');
    const openTickets = data.tickets.filter((ticket) => ticket.status === 'open' || ticket.status === 'in_progress');
    $('#openTicketCount').textContent = openTickets.length;
    $('#ticketList').innerHTML = data.tickets.length
      ? data.tickets.map((ticket) => `<button class="ticket ticket-button" type="button" data-ticket-id="${ticket.id}"><span><strong>${escapeHtml(ticket.subject)}</strong><small>${escapeHtml(ticket.description)}</small></span><span class="status">${escapeHtml(statusLabel(ticket.status))}</span></button>`).join('')
      : '<p class="muted">No tickets yet. Your support history will appear here.</p>';
  } catch (error) {
    $('#openTicketCount').textContent = '—';
    $('#ticketList').innerHTML = `<div class="state-panel error-state">${error.status === 403 ? 'You are not authorized to view support tickets.' : 'Support data is unavailable.'}</div>`;
  }
}

async function loadTicketDetail(ticketId) {
  $('#ticketDetail').className = 'card state-panel';
  $('#ticketDetail').textContent = 'Loading ticket...';
  try {
    const data = await api(`tickets/${ticketId}`);
    const ticket = data.ticket;
    $('#ticketDetail').innerHTML = `<div class="section-head compact"><div><span class="eyebrow">Ticket #${ticket.id}</span><h3>${escapeHtml(ticket.subject)}</h3></div><span class="status">${escapeHtml(statusLabel(ticket.status))}</span></div><p>${escapeHtml(ticket.description)}</p><div class="ticket-messages">${ticket.messages.length ? ticket.messages.map((item) => `<article class="ticket-message"><strong>${escapeHtml(item.author_type === 'customer' ? 'You' : 'SMRITISYS')}</strong><p>${escapeHtml(item.message)}</p></article>`).join('') : '<p class="muted">No replies yet.</p>'}</div><form class="ticket-reply" data-ticket-reply="${ticket.id}"><label for="ticketReply">Reply</label><textarea id="ticketReply" name="message" maxlength="10000" rows="3" required></textarea><button class="secondary" type="submit">Send reply</button><p class="message" role="status"></p></form>`;
  } catch (error) {
    $('#ticketDetail').className = 'card state-panel error-state';
    $('#ticketDetail').textContent = error.status === 404 ? 'This ticket was not found.' : 'Ticket details are unavailable.';
  }
}

async function loadRequirements() {
  $('#requirementList').innerHTML = '<p class="muted">Loading requirements...</p>';
  try {
    const data = await api('requirements');
    $('#requirementList').innerHTML = data.requirements.length
      ? data.requirements.map((item) => `<button class="ticket ticket-button" type="button" data-requirement-id="${item.id}"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description)}</small></span><span class="status">${escapeHtml(statusLabel(item.status))}</span></button>`).join('')
      : '<p class="muted">No custom requirements yet.</p>';
  } catch (error) {
    $('#requirementList').innerHTML = `<div class="state-panel error-state">${error.status === 403 ? 'You are not authorized to view requirements.' : 'Requirements are unavailable.'}</div>`;
  }
}

async function loadRequirementDetail(requirementId) {
  $('#requirementDetail').className = 'card state-panel';
  $('#requirementDetail').textContent = 'Loading requirement...';
  try {
    const data = await api(`requirements/${requirementId}`);
    const requirement = data.requirement;
    $('#requirementDetail').innerHTML = `<div class="section-head compact"><div><span class="eyebrow">Requirement #${requirement.id}</span><h3>${escapeHtml(requirement.title)}</h3></div><span class="status">${escapeHtml(statusLabel(requirement.status))}</span></div><p>${escapeHtml(requirement.description)}</p><p class="muted">${escapeHtml(requirement.category)} · ${escapeHtml(requirement.priority)} priority</p><div class="ticket-messages">${requirement.messages.length ? requirement.messages.map((item) => `<article class="ticket-message"><strong>${escapeHtml(item.author_type === 'customer' ? 'You' : 'SMRITISYS')}</strong><p>${escapeHtml(item.message)}</p></article>`).join('') : '<p class="muted">No replies yet.</p>'}</div><form class="ticket-reply" data-requirement-reply="${requirement.id}"><label for="requirementReply">Reply</label><textarea id="requirementReply" name="message" maxlength="10000" rows="3" required></textarea><button class="secondary" type="submit">Send reply</button><p class="message" role="status"></p></form>`;
  } catch (error) {
    $('#requirementDetail').className = 'card state-panel error-state';
    $('#requirementDetail').textContent = error.status === 404 ? 'This requirement was not found.' : 'Requirement details are unavailable.';
  }
}

async function loadCustomerWorkspace() {
  $('#dashboardError').classList.add('hidden');
  try {
    const profileData = await api('profile');
    state.profile = profileData.profile;
    fillProfile(state.profile);
    updateIdentity(state.profile);
    await Promise.all([loadOrganization(), loadLicenses(), loadTickets(), loadReleases()]);
  } catch (error) {
    $('#dashboardError').textContent = error.status === 403 ? 'This account is not authorized for the customer workspace.' : 'Some workspace data could not be loaded.';
    $('#dashboardError').className = 'state-panel error-state';
    if (error.status === 401) {
      localStorage.removeItem('smritisys_token');
      localStorage.removeItem('smritisys_account_type');
      state.token = null;
      showLogin('Your session has expired. Please sign in again.');
    }
  }
}

async function loadPortal() {
  try {
    const identity = await api('me');
    updateIdentity(identity.user);
    if (state.accountType === 'user') {
      $('#adminNav').classList.remove('hidden');
      $('#profileForm').querySelectorAll('input, textarea, select, button').forEach((control) => { control.disabled = true; });
      $('#profileMessage').textContent = 'Staff profile editing is managed by the administration area.';
      return;
    }
    await loadCustomerWorkspace();
  } catch (error) {
    localStorage.removeItem('smritisys_token');
    localStorage.removeItem('smritisys_account_type');
    state.token = null;
    showLogin(error.status === 401 ? 'Your session has expired. Please sign in again.' : 'Unable to load your workspace.');
  }
}

async function loadView(view) {
  if (view === 'organization') await loadOrganization();
  if (view === 'products' || view === 'licenses') await loadLicenses();
  if (view === 'support') await loadTickets();
  if (view === 'requirements') await loadRequirements();
  if (view === 'releases') await loadReleases();
  if (view === 'commercial') await loadCommercial();
  if (view === 'admin') await loadAdminUsers();
}

async function loadAdminUsers() {
  try {
    const data = await api('admin/users');
    $('#adminUserList').innerHTML = data.users.map((user) => `<article class="admin-user"><div><strong>${escapeHtml(user.name || 'Unnamed user')}</strong><small>${escapeHtml(user.email)}</small></div><span class="status">${escapeHtml(statusLabel(user.status))}</span><select data-user-role="${user.id}" aria-label="Role for ${escapeHtml(user.email)}"><option value="staff" ${user.role === 'staff' ? 'selected' : ''}>Staff</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option><option value="super_admin" ${user.role === 'super_admin' ? 'selected' : ''}>Super admin</option></select><button class="text-button" data-save-user="${user.id}">Save</button></article>`).join('');
    $$('[data-save-user]').forEach((button) => button.addEventListener('click', async () => {
      const userId = button.dataset.saveUser;
      const role = $(`[data-user-role="${userId}"]`).value;
      button.disabled = true;
      try {
        const result = await api(`admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) });
        setMessage($('#adminMessage'), result.message, true);
        await loadAdminUsers();
      } catch (error) {
        setMessage($('#adminMessage'), error.message, false);
      } finally {
        button.disabled = false;
      }
    }));
  } catch (error) {
    $('#adminUserList').innerHTML = '<div class="state-panel error-state">Administration data is unavailable.</div>';
  }
}

function navigate(view) {
  const button = $(`button[data-view="${view}"]`);
  if (!button) return;
  $$('.nav button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  $$('.view').forEach((section) => section.classList.toggle('active', section.dataset.section === view));
  $('#pageTitle').textContent = button.textContent;
  loadView(view);
}

$$('.nav button[data-view]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
$$('[data-go]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.go)));
$$('.refresh-view').forEach((button) => button.addEventListener('click', () => loadView(button.closest('.view').dataset.section)));
$('#refreshDashboard').addEventListener('click', loadCustomerWorkspace);

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const button = event.target.querySelector('button');
  button.disabled = true;
  setMessage($('#loginMessage'), 'Signing in...', true);
  try {
    const data = await api('login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) });
    state.token = data.token;
    state.accountType = data.account_type;
    localStorage.setItem('smritisys_token', state.token);
    localStorage.setItem('smritisys_account_type', state.accountType);
    showPortal();
  } catch (error) {
    setMessage($('#loginMessage'), error.message, false);
  } finally {
    button.disabled = false;
  }
});

$('#newTicketButton').addEventListener('click', () => $('#ticketForm').classList.toggle('hidden'));
$('#ticketForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('tickets', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    setMessage($('#ticketMessage'), `Ticket #${data.ticket_id} created`, true);
    event.target.reset();
    event.target.classList.add('hidden');
    await loadTickets();
  } catch (error) {
    setMessage($('#ticketMessage'), error.status === 403 ? 'You are not authorized to create tickets.' : error.message, false);
  }
});

$('#newRequirementButton').addEventListener('click', () => $('#requirementForm').classList.toggle('hidden'));
$('#requirementForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('requirements', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    setMessage($('#requirementMessage'), `Requirement #${data.requirement_id} submitted`, true);
    event.target.reset();
    event.target.classList.add('hidden');
    await loadRequirements();
  } catch (error) {
    setMessage($('#requirementMessage'), error.status === 403 ? 'You are not authorized to submit requirements.' : error.message, false);
  }
});

$('#profileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('profile', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    setMessage($('#profileMessage'), data.message, true);
    await loadCustomerWorkspace();
  } catch (error) {
    setMessage($('#profileMessage'), error.message, false);
  }
});

$('#passwordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('password', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    setMessage($('#passwordMessage'), data.message, true);
    event.target.reset();
  } catch (error) {
    setMessage($('#passwordMessage'), error.message, false);
  }
});

async function logout() {
  try { await api('logout', { method: 'POST' }); } catch {}
  localStorage.removeItem('smritisys_token');
  localStorage.removeItem('smritisys_account_type');
  state.token = null;
  showLogin();
}

$('#logoutButton').addEventListener('click', logout);
$('#accountLogoutButton').addEventListener('click', logout);

document.addEventListener('click', async (event) => {
  const ticket = event.target.closest('[data-ticket-id]');
  if (ticket) await loadTicketDetail(ticket.dataset.ticketId);
  const requirement = event.target.closest('[data-requirement-id]');
  if (requirement) await loadRequirementDetail(requirement.dataset.requirementId);
  const button = event.target.closest('.license-request');
  if (!button) return;
  const card = button.closest('.license-card');
  const message = card.querySelector('.request-message');
  button.disabled = true;
  try {
    const data = await api(`licenses/${button.dataset.licenseId}/requests`, { method: 'POST', body: JSON.stringify({ request_type: button.dataset.requestType }) });
    setMessage(message, data.message, true);
  } catch (error) {
    setMessage(message, error.status === 403 ? 'You are not authorized to request changes for this license.' : 'Your request could not be submitted.', false);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-ticket-reply]');
  if (!form) return;
  event.preventDefault();
  const message = form.querySelector('.message');
  try {
    const data = await api(`tickets/${form.dataset.ticketReply}/messages`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    setMessage(message, data.message, true);
    await loadTicketDetail(form.dataset.ticketReply);
  } catch (error) {
    setMessage(message, error.status === 403 ? 'You are not authorized to reply to this ticket.' : 'Reply could not be sent.', false);
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-requirement-reply]');
  if (!form) return;
  event.preventDefault();
  const message = form.querySelector('.message');
  try {
    const data = await api(`requirements/${form.dataset.requirementReply}/messages`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    setMessage(message, data.message, true);
    await loadRequirementDetail(form.dataset.requirementReply);
  } catch (error) {
    setMessage(message, error.status === 403 ? 'You are not authorized to reply to this requirement.' : 'Reply could not be sent.', false);
  }
});

if (state.token) showPortal();
