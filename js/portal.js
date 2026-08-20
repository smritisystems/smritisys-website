const state = {
  token: localStorage.getItem('smritisys_token'),
  accountType: localStorage.getItem('smritisys_account_type') || 'customer',
  profile: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function setMessage(element, text, ok) {
  element.textContent = text;
  element.style.color = ok ? 'var(--turquoise)' : 'var(--red)';
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`/api/${path}`, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showPortal() {
  $('#loginView').classList.add('hidden');
  $('#portalView').classList.remove('hidden');
  loadPortal();
}

function showLogin(message = '') {
  $('#portalView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
  if (message) setMessage($('#loginMessage'), message, false);
}

async function loadPortal() {
  try {
    if (state.accountType === 'user') {
      const data = await api('me');
      updateIdentity(data.user);
      if (data.user.role === 'super_admin') {
        $('#adminNav').classList.remove('hidden');
        await loadAdminUsers();
      }
      $('#profileForm').querySelectorAll('input, textarea, select, button').forEach((control) => {
        control.disabled = true;
      });
      $('#profileMessage').textContent = 'Staff profile editing is managed by the administration area.';
      $('#openTicketCount').textContent = '—';
      return;
    }

    const data = await api('profile');
    state.profile = data.profile;
    fillProfile(data.profile);
    updateIdentity(data.profile);
    await loadTickets();
  } catch (error) {
    localStorage.removeItem('smritisys_token');
    localStorage.removeItem('smritisys_account_type');
    state.token = null;
    showLogin(error.message);
  }
}

function fillProfile(profile) {
  ['name', 'email', 'phone', 'company', 'gst_number', 'website', 'bio'].forEach((key) => {
    const input = $(`#profile${key === 'gst_number' ? 'Gst' : key[0].toUpperCase() + key.slice(1)}`);
    if (input) input.value = profile[key] || '';
  });
}

function updateIdentity(profile) {
  const name = profile.name || 'Customer';
  $('#userName').textContent = name;
  $('#welcomeName').textContent = name.split(' ')[0];
  $('#userAvatar').textContent = name.charAt(0).toUpperCase();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

async function loadTickets() {
  const data = await api('tickets');
  $('#openTicketCount').textContent = data.tickets.filter((ticket) => ticket.status === 'open' || ticket.status === 'in_progress').length;
  $('#ticketList').innerHTML = data.tickets.length
    ? data.tickets.map((ticket) => `<article class="ticket"><div><h3>${escapeHtml(ticket.subject)}</h3><p>${escapeHtml(ticket.description)}</p></div><span class="status">${escapeHtml(ticket.status)}</span></article>`).join('')
    : '<p class="muted">No tickets yet. Your support history will appear here.</p>';
}

async function loadAccounting() {
  mountAccountingTools();
  const data = await api('accounting/ledger');
  $('#ledgerList').innerHTML = data.ledger.length
    ? data.ledger.map((entry) => `<article class="ticket"><div><h3>${escapeHtml(entry.account_code || entry.code)} · ${escapeHtml(entry.name)}</h3><p>${escapeHtml(entry.description)} · ${escapeHtml(entry.entry_date)}</p></div><span class="status">Dr ${Number(entry.debit).toFixed(2)} / Cr ${Number(entry.credit).toFixed(2)}</span></article>`).join('')
    : '<p class="muted">No ledger entries yet. Create an invoice or record a purchase to begin.</p>';
}

function mountAccountingTools() {
  if ($('#accountingTools')) return;
  const accountingView = $('[data-section="accounting"]');
  accountingView.insertAdjacentHTML('beforeend', `<div id="accountingTools" class="grid modules"><form id="contactForm" class="card module"><span class="eyebrow">Contacts</span><h3>Add customer or supplier</h3><label>Name</label><input name="name" required /><label>Type</label><select name="contact_type"><option value="customer">Customer</option><option value="supplier">Supplier</option></select><label>Email</label><input name="email" type="email" /><label>Phone</label><input name="phone" /><button class="primary" type="submit">Save contact</button></form><form id="receiptForm" class="card module"><span class="eyebrow">Money in</span><h3>Receive customer payment</h3><label>Receipt number</label><input name="receipt_number" placeholder="REC-001" required /><label>Invoice reference</label><input name="invoice_reference" /><label>Date</label><input name="receipt_date" type="date" required /><label>Amount</label><input name="amount" type="number" min="0" step="0.01" required /><label>Payment mode</label><select name="payment_mode"><option>Cash</option><option>Bank transfer</option><option>UPI</option><option>Card</option><option>Cheque</option></select><button class="primary" type="submit">Save receipt</button></form><form id="paymentForm" class="card module"><span class="eyebrow">Money out</span><h3>Pay supplier</h3><label>Payment number</label><input name="payment_number" placeholder="PAY-001" required /><label>Bill reference</label><input name="bill_reference" /><label>Date</label><input name="payment_date" type="date" required /><label>Amount</label><input name="amount" type="number" min="0" step="0.01" required /><label>Payment mode</label><select name="payment_mode"><option>Bank transfer</option><option>Cash</option><option>UPI</option><option>Card</option><option>Cheque</option></select><button class="primary" type="submit">Save payment</button></form><form id="noteForm" class="card module"><span class="eyebrow">Adjustments</span><h3>Debit or credit note</h3><label>Note number</label><input name="note_number" placeholder="CN-001" required /><label>Note type</label><select name="note_type"><option value="credit">Credit note</option><option value="debit">Debit note</option></select><label>Party</label><select name="party_type"><option value="customer">Customer</option><option value="supplier">Supplier</option></select><label>Date</label><input name="note_date" type="date" required /><label>Amount</label><input name="amount" type="number" min="0" step="0.01" required /><label>Reason</label><input name="reason" required /><button class="primary" type="submit">Save note</button></form></div>`);
  $('#contactForm').addEventListener('submit', (event) => submitAccountingForm(event, 'contacts'));
  $('#receiptForm').addEventListener('submit', (event) => submitAccountingForm(event, 'receipts'));
  $('#paymentForm').addEventListener('submit', (event) => submitAccountingForm(event, 'payments'));
  $('#noteForm').addEventListener('submit', (event) => submitAccountingForm(event, 'notes'));
}

async function submitAccountingForm(event, resource) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.target));
  try {
    const data = await api(`accounting/${resource}`, { method: 'POST', body: JSON.stringify(form) });
    setMessage($('#accountingMessage'), data.message, true);
    event.target.reset();
    if (resource !== 'contacts') await loadAccounting();
  } catch (error) {
    setMessage($('#accountingMessage'), error.message, false);
  }
}

async function loadAdminUsers() {
  const data = await api('admin/users');
  $('#adminUserList').innerHTML = data.users.map((user) => `<article class="admin-user"><div><strong>${escapeHtml(user.name || 'Unnamed user')}</strong><small>${escapeHtml(user.email)}</small></div><span class="status">${escapeHtml(user.status)}</span><select data-user-role="${user.id}" aria-label="Role for ${escapeHtml(user.email)}"><option value="staff" ${user.role === 'staff' ? 'selected' : ''}>Staff</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option><option value="super_admin" ${user.role === 'super_admin' ? 'selected' : ''}>Super admin</option></select><button class="text-button" data-save-user="${user.id}">Save</button></article>`).join('');
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
    }
    button.disabled = false;
  }));
}

$$('.nav button').forEach((button) => button.addEventListener('click', () => {
  $$('.nav button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  $$('.view').forEach((view) => view.classList.toggle('active', view.dataset.section === button.dataset.view));
  $('#pageTitle').textContent = button.textContent;
}));

$$('[data-go]').forEach((button) => button.addEventListener('click', () => $(`button[data-view="${button.dataset.go}"]`).click()));

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
  }
  button.disabled = false;
});

$('#profileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const data = await api('profile', { method: 'PUT', body: JSON.stringify(Object.fromEntries(form)) });
    setMessage($('#profileMessage'), data.message, true);
    updateIdentity(Object.fromEntries(form));
  } catch (error) {
    setMessage($('#profileMessage'), error.message, false);
  }
});

$('#newTicketButton').addEventListener('click', () => $('#ticketForm').classList.toggle('hidden'));

$('#ticketForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const data = await api('tickets', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
    setMessage($('#ticketMessage'), `Ticket #${data.ticket_id} created`, true);
    event.target.reset();
    $('#ticketForm').classList.add('hidden');
    await loadTickets();
  } catch (error) {
    setMessage($('#ticketMessage'), error.message, false);
  }
});

async function submitAccountingDocument(event, resource, numberField, partyField, dateField) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.target));
  const item = {
    description: resource === 'invoices' ? `Invoice ${form[numberField]}` : `Purchase ${form[numberField]}`,
    quantity: 1,
    unit_price: form.amount,
    tax_rate: 0,
  };
  try {
    const data = await api(`accounting/${resource}`, { method: 'POST', body: JSON.stringify({
      [numberField]: form[numberField],
      [partyField]: form[partyField],
      [dateField]: form[dateField],
      items: [item],
    }) });
    setMessage($('#accountingMessage'), data.message, true);
    event.target.reset();
    await loadAccounting();
  } catch (error) {
    setMessage($('#accountingMessage'), error.message, false);
  }
}

$('#logoutButton').addEventListener('click', () => {
  localStorage.removeItem('smritisys_token');
  localStorage.removeItem('smritisys_account_type');
  state.token = null;
  showLogin();
});

if (state.token) showPortal();
