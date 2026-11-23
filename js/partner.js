/**
 * @file        partner.js
 * @project     PrathamOne EduOS Coaching Institute Management System
 * @module      SMRITISYS partner portal
 *
 * @author      Jawahar R. Mallah
 * @organization AITDL (AI Technology & Development Lab)
 * @client      Prashant Academy Coaching Institute
 * @copyright   Copyright (c) 2026 AITDL
 * @license     Proprietary
 *
 * @version     1.0.0
 * @created     2026-11-06
 * @updated     2026-11-16
 *
 * @description Manages partner customer onboarding and assigned activation inventory.
 */
const partnerState = { token: null, permissions: {}, dealPage: 1, dealRequestId: 0 };
const partner$ = (selector) => document.querySelector(selector);
const partner$$ = (selector) => [...document.querySelectorAll(selector)];
let partnerRevealTimer = null;
const PARTNER_TYPE_LABELS = {
  channel_partner: 'Channel partner',
  reseller: 'Reseller',
  implementation_partner: 'Implementation partner',
  technology_partner: 'Technology partner',
  referral_partner: 'Referral partner',
  distributor: 'Distributor',
};
const PARTNER_ROLE_LABELS = {
  partner_admin: 'Partner administrator',
  partner_member: 'Partner member',
};

function partnerEscape(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function partnerDisplayLabel(value, labels) {
  const raw = String(value ?? '');
  return labels[raw] || raw.replace(/_/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

async function partnerApi(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (partnerState.token) headers.Authorization = `Bearer ${partnerState.token}`;
  const response = await fetch(`/api/${path}`, { ...options, headers, credentials: 'same-origin' });
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
  element.style.color = ok ? 'var(--accent)' : 'var(--red)';
}

function showPartnerLogin(message = '') {
  const contextDialog = partner$('#organizationContextDialog');
  if (contextDialog?.open) contextDialog.close();
  const contactDialog = partner$('#partnerCustomerContactDialog');
  if (contactDialog?.open) contactDialog.close();
  partner$('#partnerCustomerContactForm').reset();
  partner$('#partnerCustomerContactForm').dataset.customerId = '';
  partner$('#partnerCustomerList').textContent = '';
  partner$('#partnerCustomerState').textContent = 'Sign in to view assigned customers.';
  partner$('#partnerCustomerState').className = 'state-panel';
  partner$('#partnerDealList').textContent = '';
  partner$('#partnerDealState').textContent = 'Sign in to view deal registrations.';
  partner$('#partnerDealState').className = 'state-panel';
  partner$('#partnerDealPagination').classList.add('hidden');
  partner$('#partnerDealForm').reset();
  partner$('#partnerDealMessage').textContent = '';
  partnerState.dealPage = 1;
  partnerState.dealRequestId += 1;
  clearPartnerCustomerInviteLink();
  partnerState.permissions = {};
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
  partnerState.permissions = data.permissions || {};
  partner$('#partnerUserName').textContent = user.name || 'Partner';
  partner$('#partnerWelcomeName').textContent = (user.name || 'there').split(' ')[0];
  partner$('#partnerAvatar').textContent = (user.name || 'P').charAt(0).toUpperCase();
  partner$('#partnerOrganizationName').textContent = partner.name;
  const partnerType = partnerDisplayLabel(partner.partner_type, PARTNER_TYPE_LABELS);
  const partnerRole = partnerDisplayLabel(partner.partner_role, PARTNER_ROLE_LABELS);
  partner$('#partnerType').textContent = `${partnerType} · ${partnerRole}`;
  partner$('#partnerOrganizationDetails').className = 'card';
  const location = [partner.address, partner.city, partner.state, partner.pincode, partner.country].filter(Boolean);
  partner$('#partnerOrganizationDetails').innerHTML = `<span class="eyebrow">Partner organization</span><h3>${partnerEscape(partner.name)}</h3><p>${partnerEscape(partner.legal_name || 'Legal name not provided')}</p>${location.length ? `<p>${partnerEscape(location.join(', '))}</p>` : ''}${partner.phone ? `<p>${partnerEscape(partner.phone)}</p>` : ''}${partner.website ? `<p>${partnerEscape(partner.website)}</p>` : ''}<p class="muted">${partnerEscape(partnerType)} · ${partnerEscape(partnerRole)}</p>`;
  partner$('#partnerCustomerInviteForm').classList.toggle('hidden', !partnerState.permissions.register_customers);
  partner$('button[data-partner-view="inventory"]').hidden = !partnerState.permissions.view_inventory;
}

async function loadPartnerCustomers() {
  try {
    const data = await partnerApi('partner/customers');
    partner$('#partnerCustomerCount').textContent = data.customers.length;
    const pending = data.pending_invites || [];
    const contacts = data.contacts || [];
    partnerState.permissions.manage_customer_contacts = Boolean(data.permissions?.manage_customer_contacts);
    if (!data.customers.length && !pending.length && !contacts.length) return renderPartnerState('partnerCustomerState', 'partnerCustomerList', 'No managed customer organizations yet.');
    partner$('#partnerCustomerState').classList.add('hidden');
    partner$('#partnerCustomerList').classList.remove('hidden');
    const organizationNames = new Map(data.customers.map((customer) => [String(customer.id), customer.name]));
    partner$('#partnerCustomerList').innerHTML = `${data.customers.length ? `<h3>Linked customers</h3><table class="partner-table"><thead><tr><th>Organization</th><th>Legal name</th><th>Status</th></tr></thead><tbody>${data.customers.map((customer) => `<tr><td>${partnerEscape(customer.name)}</td><td>${partnerEscape(customer.legal_name || 'Not provided')}</td><td><span class="status">${partnerEscape(customer.status)}</span></td></tr>`).join('')}</tbody></table>` : ''}${contacts.length ? `<h3>Assigned customer contacts</h3><p class="muted">Contact details are limited to customers assigned to this partner. Email and password information is not available here.</p><table class="partner-table"><thead><tr><th>Customer organization</th><th>Customer ID</th><th>Contact</th><th>Phone</th><th>Action</th></tr></thead><tbody>${contacts.map((contact) => `<tr><td>${partnerEscape(organizationNames.get(String(contact.organization_id)) || `Organization ${contact.organization_id}`)}</td><td>${partnerEscape(contact.id)}</td><td>${partnerEscape(contact.name || '—')}</td><td>${partnerEscape(contact.phone || '—')}</td><td>${partnerState.permissions.manage_customer_contacts ? `<button class="secondary" type="button" data-partner-customer-contact="${partnerEscape(contact.id)}" data-customer-organization-id="${partnerEscape(contact.organization_id)}" data-contact-name="${partnerEscape(contact.name || '')}" data-contact-phone="${partnerEscape(contact.phone || '')}">Edit contact</button>` : '—'}</td></tr>`).join('')}</tbody></table>` : ''}${pending.length ? `<h3>Pending customer setup</h3><table class="partner-table"><thead><tr><th>Organization</th><th>Contact</th><th>Status</th><th>Expires</th></tr></thead><tbody>${pending.map((invite) => `<tr><td>${partnerEscape(invite.company)}</td><td>${partnerEscape(invite.name || invite.email)}</td><td><span class="status">${partnerEscape(invite.status)}</span></td><td>${partnerEscape(invite.expires_at)}</td></tr>`).join('')}</tbody></table>` : ''}`;
    partner$('#partnerCustomerList').querySelectorAll('[data-partner-customer-contact]').forEach((button) => {
      button.addEventListener('click', () => openPartnerCustomerContact(button));
    });
  } catch (error) {
    renderPartnerState('partnerCustomerState', 'partnerCustomerList', error.status === 403 ? 'You are not authorized to view linked customers.' : 'Linked customers are unavailable.', true);
  }
}

async function loadPartnerDeals(page = partnerState.dealPage) {
  const requestId = ++partnerState.dealRequestId;
  const state = partner$('#partnerDealState');
  const list = partner$('#partnerDealList');
  const pagination = partner$('#partnerDealPagination');
  state.className = 'state-panel';
  state.textContent = 'Loading deal registrations...';
  list.classList.add('hidden');
  pagination.classList.add('hidden');
  try {
    const data = await partnerApi(`partner/deals?page=${encodeURIComponent(page)}&page_size=20`);
    if (requestId !== partnerState.dealRequestId) return;
    partnerState.dealPage = data.page;
    if (!data.deals.length) {
      state.textContent = 'No deal registrations submitted yet.';
      return;
    }
    state.classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = `<div class="partner-table-wrap"><table class="partner-table"><thead><tr><th>Prospect</th><th>Contact</th><th>Status</th><th>Summary</th><th>Decision</th><th>Your response</th><th>Updated</th></tr></thead><tbody>${data.deals.map((deal) => `<tr><td><strong>${partnerEscape(deal.prospect_organization_name)}</strong>${deal.website ? `<br><a href="${partnerEscape(deal.website)}" target="_blank" rel="noopener noreferrer">${partnerEscape(deal.website)}</a>` : ''}</td><td>${partnerEscape(deal.contact_name || '—')}<br>${partnerEscape(deal.contact_email || deal.contact_phone || '—')}</td><td><span class="status">${partnerEscape(deal.status.replace(/_/g, ' '))}</span></td><td>${partnerEscape(deal.summary)}</td><td>${partnerEscape(deal.decision_summary || '—')}</td><td>${partnerEscape(deal.partner_response || '—')}</td><td>${partnerEscape(deal.updated_at)}</td></tr>${deal.status === 'needs_information' ? `<tr><td colspan="7"><div data-deal-response-form="${partnerEscape(deal.id)}"><label for="partnerDealResponse${partnerEscape(deal.id)}">Your response to the review request</label><textarea id="partnerDealResponse${partnerEscape(deal.id)}" data-deal-response maxlength="2000" rows="2">${partnerEscape(deal.partner_response || '')}</textarea><button class="secondary" type="button" data-deal-resubmit="${partnerEscape(deal.id)}">Send response for review</button><span class="message" data-deal-response-message role="status"></span></div></td></tr>` : ''}`).join('')}</tbody></table></div>`;
    list.querySelectorAll('[data-deal-resubmit]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.dataset.dealResubmit;
      const response = list.querySelector(`[data-deal-response-form="${id}"] [data-deal-response]`).value;
      const message = list.querySelector(`[data-deal-response-form="${id}"] [data-deal-response-message]`);
      button.disabled = true;
      partnerMessage(message, 'Sending response for review...', true);
      try {
        await partnerApi(`partner/deals/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ partner_response: response }),
        });
        partnerMessage(message, 'Response submitted.', true);
        await loadPartnerDeals(partnerState.dealPage);
      } catch (error) {
        partnerMessage(message, error.message || 'The response could not be submitted.', false);
      } finally {
        button.disabled = false;
      }
    }));
    const pages = Math.max(1, Math.ceil(data.total / data.page_size));
    if (pages > 1) {
      pagination.classList.remove('hidden');
      partner$('#partnerDealPage').textContent = `Page ${data.page} of ${pages} · ${data.total} total`;
      partner$('#partnerDealPrevious').disabled = data.page <= 1;
      partner$('#partnerDealNext').disabled = data.page >= pages;
    }
  } catch (error) {
    if (requestId !== partnerState.dealRequestId) return;
    state.className = 'state-panel error-state';
    state.textContent = error.status === 403
      ? 'Deal registration is not enabled for this partner account.'
      : `Deal registrations are unavailable: ${error.message}`;
  }
}

function openPartnerCustomerContact(button) {
  const form = partner$('#partnerCustomerContactForm');
  form.dataset.customerId = button.dataset.partnerCustomerContact;
  form.dataset.organizationId = button.dataset.customerOrganizationId;
  partner$('#partnerCustomerContactName').value = button.dataset.contactName;
  partner$('#partnerCustomerContactPhone').value = button.dataset.contactPhone;
  partnerMessage(partner$('#partnerCustomerContactMessage'), '', true);
  partner$('#partnerCustomerContactDialog').showModal();
}

partner$('#partnerCustomerContactForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const customerId = form.dataset.customerId;
  if (!customerId) return;
  const values = new FormData(form);
  const button = partner$('#partnerCustomerContactSave');
  button.disabled = true;
  partnerMessage(partner$('#partnerCustomerContactMessage'), 'Saving customer contact...', true);
  try {
    await partnerApi(`partner/customers/${encodeURIComponent(customerId)}/contact`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: values.get('name'),
        phone: values.get('phone'),
        organization_id: form.dataset.organizationId,
      }),
    });
    partner$('#partnerCustomerContactDialog').close();
    await loadPartnerCustomers();
  } catch (error) {
    partnerMessage(partner$('#partnerCustomerContactMessage'), error.message || 'The customer contact could not be saved.', false);
  } finally {
    button.disabled = false;
  }
});

partner$('#partnerCustomerContactCancel').addEventListener('click', () => {
  partner$('#partnerCustomerContactDialog').close();
});

async function loadPartnerInventory() {
  try {
    const data = await partnerApi('partner/inventory');
    partner$('#partnerInventoryCount').textContent = data.inventory.length;
    if (!data.inventory.length) return renderPartnerState('partnerInventoryState', 'partnerInventoryList', 'No activation codes have been allocated to this partner.');
    partner$('#partnerInventoryState').classList.add('hidden');
    partner$('#partnerInventoryList').classList.remove('hidden');
    partner$('#partnerInventoryList').innerHTML = `<table class="partner-table"><thead><tr><th>Serial</th><th>Product / edition</th><th>Status</th><th>Allocated</th><th>Key</th></tr></thead><tbody>${data.inventory.map((code) => {
      const reveal = code.status === 'available' && code.activation_key_recoverable && partnerState.permissions.reveal_activation_keys
        ? `<button class="secondary" type="button" data-partner-code-reveal="${partnerEscape(code.batch_id)}:${partnerEscape(code.serial_number)}">Reveal key</button>`
        : code.status === 'available' && !code.activation_key_recoverable
          ? '<span class="muted">Key unavailable</span>'
          : '<span class="muted">Unavailable</span>';
      return `<tr><td>${partnerEscape(code.serial_number)}</td><td>${partnerEscape(code.product.name)}<small>${partnerEscape(code.edition.name)}</small></td><td><span class="status">${partnerEscape(code.status)}</span></td><td>${partnerEscape(code.assigned_at || '—')}</td><td class="partner-actions">${reveal}</td></tr>`;
    }).join('')}</tbody></table>`;
    partner$('#partnerInventoryList').querySelectorAll('[data-partner-code-reveal]').forEach((button) => {
      button.addEventListener('click', () => openPartnerCodeReveal(button.dataset.partnerCodeReveal));
    });
  } catch (error) {
    renderPartnerState('partnerInventoryState', 'partnerInventoryList', error.status === 403 ? 'You are not authorized to view assigned inventory.' : 'Assigned inventory is unavailable.', true);
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
    if (!(await organizationContext.ensureSelected())) return;
    await loadPartnerProfile();
    await Promise.all([
      loadPartnerCustomers(),
      loadPartnerLicenses(),
      loadPartnerReleases(),
      ...(partnerState.permissions.view_inventory ? [loadPartnerInventory()] : []),
    ]);
  } catch (error) {
    partner$('#partnerError').textContent = error.status === 403 ? 'This account is not authorized for the partner workspace.' : 'Partner workspace data could not be loaded.';
    partner$('#partnerError').className = 'state-panel error-state';
    if (error.status === 401 || error.status === 403) {
      partnerState.token = null;
      showPartnerLogin('Partner access is unavailable for this account.');
    }
  }
}

const organizationContext = window.createOrganizationContextController({
  api: partnerApi,
  buttonId: 'organizationContextButton',
  dialogId: 'organizationContextDialog',
  formId: 'organizationContextForm',
  selectId: 'organizationContextSelect',
  messageId: 'organizationContextMessage',
  onSelected: loadPartnerWorkspace,
  onSignOut: logoutPartner,
});

async function logoutPartner() {
  try { await partnerApi('logout', { method: 'POST' }); } catch {}
  partnerState.token = null;
  showPartnerLogin();
}

function navigatePartner(view) {
  const button = partner$(`button[data-partner-view="${view}"]`);
  if (!button) return;
  partner$$('.partner-nav button').forEach((item) => {
    item.classList.toggle('active', item === button);
    if (item === button) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  button.classList.add('active');
  partner$$('.partner-view').forEach((section) => section.classList.toggle('active', section.dataset.partnerSection === view));
  partner$('#partnerPageTitle').textContent = button.textContent;
  const menuWasOpen = partnerMobileNavToggle.getAttribute('aria-expanded') === 'true';
  partnerNavigation.classList.remove('is-open');
  partnerMobileNavToggle.setAttribute('aria-expanded', 'false');
  if (menuWasOpen && getComputedStyle(partnerMobileNavToggle).display !== 'none') partnerMobileNavToggle.focus();
  if (view === 'customers') loadPartnerCustomers();
  if (view === 'deals') loadPartnerDeals(1);
  if (view === 'inventory') loadPartnerInventory();
  if (view === 'licenses') loadPartnerLicenses();
  if (view === 'releases') loadPartnerReleases();
  if (view !== 'customers') clearPartnerCustomerInviteLink();
}

const partnerMobileNavToggle = partner$('#partnerMobileNavToggle');
const partnerNavigation = partner$('#partnerNavigation');
partnerMobileNavToggle.addEventListener('click', () => {
  const isExpanded = partnerMobileNavToggle.getAttribute('aria-expanded') === 'true';
  partnerMobileNavToggle.setAttribute('aria-expanded', String(!isExpanded));
  partnerNavigation.classList.toggle('is-open', !isExpanded);
});
partnerNavigation.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || partnerMobileNavToggle.getAttribute('aria-expanded') !== 'true') return;
  partnerNavigation.classList.remove('is-open');
  partnerMobileNavToggle.setAttribute('aria-expanded', 'false');
  partnerMobileNavToggle.focus();
});
partner$$('.partner-nav button').forEach((button) => button.addEventListener('click', () => navigatePartner(button.dataset.partnerView)));
partner$$('.partner-refresh').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.refresh === 'customers') loadPartnerCustomers();
  if (button.dataset.refresh === 'deals') loadPartnerDeals(1);
  if (button.dataset.refresh === 'inventory') loadPartnerInventory();
  if (button.dataset.refresh === 'licenses') loadPartnerLicenses();
  if (button.dataset.refresh === 'releases') loadPartnerReleases();
}));

partner$('#partnerDealForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const button = partner$('#partnerDealSubmit');
  button.disabled = true;
  partnerMessage(partner$('#partnerDealMessage'), 'Submitting deal for internal review...', true);
  try {
    const result = await partnerApi('partner/deals', {
      method: 'POST',
      body: JSON.stringify({
        prospect_organization_name: values.get('prospect_organization_name'),
        website: values.get('website'),
        contact_name: values.get('contact_name'),
        contact_email: values.get('contact_email'),
        contact_phone: values.get('contact_phone'),
        summary: values.get('summary'),
      }),
    });
    form.reset();
    partnerMessage(partner$('#partnerDealMessage'), `Deal registration #${result.deal_id} submitted for review.`, true);
    await loadPartnerDeals(1);
  } catch (error) {
    partnerMessage(partner$('#partnerDealMessage'), error.message || 'The deal registration could not be submitted.', false);
  } finally {
    button.disabled = false;
  }
});

partner$('#partnerDealPrevious').addEventListener('click', () => loadPartnerDeals(partnerState.dealPage - 1));
partner$('#partnerDealNext').addEventListener('click', () => loadPartnerDeals(partnerState.dealPage + 1));

function clearPartnerCustomerInviteLink() {
  partner$('#partnerCustomerInviteLink').value = '';
  partner$('#partnerCustomerInviteResult').classList.add('hidden');
}

partner$('#partnerCustomerInviteForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = partner$('#partnerCustomerInviteButton');
  clearPartnerCustomerInviteLink();
  button.disabled = true;
  partnerMessage(partner$('#partnerCustomerInviteMessage'), 'Creating a company customer record and setup invitation...', true);
  try {
    const result = await partnerApi('partner/customers', {
      method: 'POST',
      body: JSON.stringify({
        email: form.get('email'),
        phone: form.get('phone'),
        name: form.get('name'),
        company: form.get('company'),
      }),
    });
    partner$('#partnerCustomerInviteLink').value = new URL(result.setup_path, window.location.origin).href;
    partner$('#partnerCustomerInviteResult').classList.remove('hidden');
    partnerMessage(partner$('#partnerCustomerInviteMessage'), 'Invite created. Copy the one-time setup link and share it only with the intended customer.', true);
    event.currentTarget.reset();
    await loadPartnerCustomers();
  } catch (error) {
    partnerMessage(partner$('#partnerCustomerInviteMessage'), error.message || 'The customer invitation could not be created.', false);
  } finally {
    button.disabled = false;
  }
});

partner$('#partnerCustomerInviteCopy').addEventListener('click', async () => {
  const input = partner$('#partnerCustomerInviteLink');
  try {
    await navigator.clipboard.writeText(input.value);
    partnerMessage(partner$('#partnerCustomerInviteMessage'), 'Setup link copied. Share it only with the intended customer.', true);
  } catch {
    input.focus();
    input.select();
    partnerMessage(partner$('#partnerCustomerInviteMessage'), 'Select and copy the setup link manually.', false);
  }
});

function openPartnerCodeReveal(value) {
  clearTimeout(partnerRevealTimer);
  const separator = value.indexOf(':');
  const batchId = value.slice(0, separator);
  const serialNumber = value.slice(separator + 1);
  const form = partner$('#partnerCodeRevealForm');
  form.dataset.batchId = batchId;
  form.dataset.serialNumber = serialNumber;
  partner$('#partnerCodeRevealSerial').textContent = serialNumber;
  partner$('#partnerCodeRevealPassword').value = '';
  partner$('#partnerCodeRevealKey').textContent = '';
  partner$('#partnerCodeRevealResult').classList.add('hidden');
  partner$('#partnerCodeRevealMessage').textContent = '';
  partner$('#partnerCodeRevealSubmit').disabled = false;
  partner$('#partnerCodeRevealDialog').showModal();
  partner$('#partnerCodeRevealPassword').focus();
}

function clearPartnerCodeReveal() {
  clearTimeout(partnerRevealTimer);
  partnerRevealTimer = null;
  partner$('#partnerCodeRevealPassword').value = '';
  partner$('#partnerCodeRevealKey').textContent = '';
  partner$('#partnerCodeRevealResult').classList.add('hidden');
  partner$('#partnerCodeRevealMessage').textContent = '';
}

partner$('#partnerCodeRevealForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = partner$('#partnerCodeRevealSubmit');
  submitButton.disabled = true;
  partnerMessage(partner$('#partnerCodeRevealMessage'), 'Verifying your password...', true);
  try {
    const result = await partnerApi(
      `partner/codes/${encodeURIComponent(form.dataset.batchId)}/${encodeURIComponent(form.dataset.serialNumber)}/reveal`,
      { method: 'POST', body: JSON.stringify({ password: partner$('#partnerCodeRevealPassword').value }) },
    );
    partner$('#partnerCodeRevealKey').textContent = result.activation_key;
    partner$('#partnerCodeRevealResult').classList.remove('hidden');
    partner$('#partnerCodeRevealPassword').value = '';
    partnerMessage(partner$('#partnerCodeRevealMessage'), 'Key revealed and audited. It will be hidden automatically after 30 seconds.', true);
    partnerRevealTimer = setTimeout(clearPartnerCodeReveal, 30000);
  } catch (error) {
    partnerMessage(partner$('#partnerCodeRevealMessage'), error.message || 'The activation key could not be revealed.', false);
    submitButton.disabled = false;
  }
});

partner$('#partnerCodeRevealCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(partner$('#partnerCodeRevealKey').textContent);
    partnerMessage(partner$('#partnerCodeRevealMessage'), 'Activation key copied. Keep it confidential.', true);
  } catch {
    partnerMessage(partner$('#partnerCodeRevealMessage'), 'Clipboard access is unavailable. Select and copy the key manually.', false);
  }
});

partner$('#partnerCodeRevealCancel').addEventListener('click', () => partner$('#partnerCodeRevealDialog').close());
partner$('#partnerCodeRevealDialog').addEventListener('close', clearPartnerCodeReveal);

partner$('#partnerLoginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const button = event.target.querySelector('button');
  button.disabled = true;
  partnerMessage(partner$('#partnerLoginMessage'), 'Signing in...', true);
  try {
    const data = await partnerApi('login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) });
    partnerState.token = null;
    showPartnerPortal();
  } catch (error) {
    partnerMessage(partner$('#partnerLoginMessage'), error.status === 401 ? 'Invalid email or password.' : error.message, false);
  } finally {
    button.disabled = false;
  }
});

partner$('#partnerLogout').addEventListener('click', logoutPartner);

showPartnerLogin();
