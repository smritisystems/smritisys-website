const partnerState = { token: localStorage.getItem('smritisys_partner_token') };
const partner$ = (selector) => document.querySelector(selector);
const partner$$ = (selector) => [...document.querySelectorAll(selector)];

function partnerEscape(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

async function partnerApi(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (partnerState.token) headers.Authorization = `Bearer ${partnerState.token}`;
  const response = await fetch(`/api/${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({ error: 'Invalid server response' }));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

function partnerMessage(element, text, ok) {
  if (!element) return;
  element.textContent = text;
  element.style.color = ok ? 'var(--turquoise)' : 'var(--red)';
}

function showPartnerLogin(message = '') {
  partner$('#partnerPortalView').classList.add('hidden');
  partner$('#partnerLoginView').classList.remove('hidden');
  partnerMessage(partner$('#partnerLoginMessage'), message, false);
}

function showPartnerPortal() {
  partner$('#partnerLoginView').classList.add('hidden');
  partner$('#partnerPortalView').classList.remove('hidden');
  loadPartnerWorkspace();
}

function renderPartnerState(stateId, listId, message, error = false) {
  const state = partner$(`#${stateId}`);
  const list = partner$(`#${listId}`);
  state.className = `state-panel${error ? ' error-state' : ''}`;
  state.textContent = message;
  list.classList.add('hidden');
}

async function loadPartnerProfile() {
  const data = await partnerApi('partner/me');
  const partner = data.partner;
  const user = data.user;
  partner$('#partnerUserName').textContent = user.name || 'Partner';
  partner$('#partnerWelcomeName').textContent = (user.name || 'there').split(' ')[0];
  partner$('#partnerAvatar').textContent = (user.name || 'P').charAt(0).toUpperCase();
  partner$('#partnerOrganizationName').textContent = partner.name;
  partner$('#partnerType').textContent = `${partner.partner_type} · ${partner.partner_role}`;
  partner$('#partnerOrganizationDetails').className = 'card';
  partner$('#partnerOrganizationDetails').innerHTML = `<span class="eyebrow">Partner organization</span><h3>${partnerEscape(partner.name)}</h3><p>${partnerEscape(partner.legal_name || 'Legal name not provided')}</p><p class="muted">${partnerEscape(partner.partner_type)} · ${partnerEscape(partner.partner_role)}</p>`;
}

async function loadPartnerCustomers() {
  try {
    const data = await partnerApi('partner/customers');
    partner$('#partnerCustomerCount').textContent = data.customers.length;
    if (!data.customers.length) return renderPartnerState('partnerCustomerState', 'partnerCustomerList', 'No linked customer organizations yet.');
    partner$('#partnerCustomerState').classList.add('hidden');
    partner$('#partnerCustomerList').classList.remove('hidden');
    partner$('#partnerCustomerList').innerHTML = `<table class="partner-table"><thead><tr><th>Organization</th><th>Legal name</th><th>Status</th></tr></thead><tbody>${data.customers.map((customer) => `<tr><td>${partnerEscape(customer.name)}</td><td>${partnerEscape(customer.legal_name || 'Not provided')}</td><td><span class="status">${partnerEscape(customer.status)}</span></td></tr>`).join('')}</tbody></table>`;
  } catch (error) {
    renderPartnerState('partnerCustomerState', 'partnerCustomerList', error.status === 403 ? 'You are not authorized to view linked customers.' : 'Linked customers are unavailable.', true);
  }
}

async function loadPartnerLicenses() {
  try {
    const data = await partnerApi('partner/licenses');
    partner$('#partnerLicenseCount').textContent = data.licenses.length;
    if (!data.licenses.length) return renderPartnerState('partnerLicenseState', 'partnerLicenseList', 'No linked customer licenses yet.');
    partner$('#partnerLicenseState').classList.add('hidden');
    partner$('#partnerLicenseList').classList.remove('hidden');
    partner$('#partnerLicenseList').innerHTML = `<table class="partner-table"><thead><tr><th>Customer</th><th>Product</th><th>License</th><th>Status</th></tr></thead><tbody>${data.licenses.map((license) => `<tr><td>${partnerEscape(license.customer_organization_name)}</td><td>${partnerEscape(license.product.name)}</td><td>${partnerEscape(license.license_key)}</td><td><span class="status">${partnerEscape(license.status)}</span></td></tr>`).join('')}</tbody></table>`;
  } catch (error) {
    renderPartnerState('partnerLicenseState', 'partnerLicenseList', error.status === 403 ? 'You are not authorized to view customer licenses.' : 'Customer license data is unavailable.', true);
  }
}

async function loadPartnerReleases() {
  try {
    const data = await partnerApi('partner/releases');
    partner$('#partnerReleaseCount').textContent = data.releases.length;
    if (!data.releases.length) return renderPartnerState('partnerReleaseState', 'partnerReleaseList', 'No linked product releases yet.');
    partner$('#partnerReleaseState').classList.add('hidden');
    partner$('#partnerReleaseList').innerHTML = data.releases.map((release) => `<article class="card module"><div><span class="eyebrow">${partnerEscape(release.product_code)} · ${partnerEscape(release.version)}</span><h3>${partnerEscape(release.title)}</h3><p>${partnerEscape(release.summary || 'Published product release')}</p></div><span class="status">Published</span></article>`).join('');
  } catch (error) {
    renderPartnerState('partnerReleaseState', 'partnerReleaseList', error.status === 403 ? 'You are not authorized to view releases.' : 'Release data is unavailable.', true);
  }
}

async function loadPartnerWorkspace() {
  partner$('#partnerError').classList.add('hidden');
  try {
    await loadPartnerProfile();
    await Promise.all([loadPartnerCustomers(), loadPartnerLicenses(), loadPartnerReleases()]);
  } catch (error) {
    partner$('#partnerError').textContent = error.status === 403 ? 'This account is not authorized for the partner workspace.' : 'Partner workspace data could not be loaded.';
    partner$('#partnerError').className = 'state-panel error-state';
    if (error.status === 401 || error.status === 403) {
      localStorage.removeItem('smritisys_partner_token');
      partnerState.token = null;
      showPartnerLogin('Partner access is unavailable for this account.');
    }
  }
}

function navigatePartner(view) {
  const button = partner$(`button[data-partner-view="${view}"]`);
  if (!button) return;
  partner$$('.partner-nav button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  partner$$('.partner-view').forEach((section) => section.classList.toggle('active', section.dataset.partnerSection === view));
  partner$('#partnerPageTitle').textContent = button.textContent;
  if (view === 'customers') loadPartnerCustomers();
  if (view === 'licenses') loadPartnerLicenses();
  if (view === 'releases') loadPartnerReleases();
}

partner$$('.partner-nav button').forEach((button) => button.addEventListener('click', () => navigatePartner(button.dataset.partnerView)));
partner$$('.partner-refresh').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.refresh === 'customers') loadPartnerCustomers();
  if (button.dataset.refresh === 'licenses') loadPartnerLicenses();
  if (button.dataset.refresh === 'releases') loadPartnerReleases();
}));

partner$('#partnerLoginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const button = event.target.querySelector('button');
  button.disabled = true;
  partnerMessage(partner$('#partnerLoginMessage'), 'Signing in...', true);
  try {
    const data = await partnerApi('login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) });
    partnerState.token = data.token;
    localStorage.setItem('smritisys_partner_token', data.token);
    showPartnerPortal();
  } catch (error) {
    partnerMessage(partner$('#partnerLoginMessage'), error.status === 401 ? 'Invalid email or password.' : error.message, false);
  } finally {
    button.disabled = false;
  }
});

partner$('#partnerLogout').addEventListener('click', async () => {
  try { await partnerApi('logout', { method: 'POST' }); } catch {}
  localStorage.removeItem('smritisys_partner_token');
  partnerState.token = null;
  showPartnerLogin();
});

if (partnerState.token) showPartnerPortal();
