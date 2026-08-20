const state = {
  token: localStorage.getItem('smritisys_token'),
  accountType: localStorage.getItem('smritisys_account_type') || 'customer',
  profile: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function setMessage(element, text, ok) {
  element.textContent = text;
  element.style.color = ok ? 'var(--green)' : 'var(--red)';
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

$('#logoutButton').addEventListener('click', () => {
  localStorage.removeItem('smritisys_token');
  localStorage.removeItem('smritisys_account_type');
  state.token = null;
  showLogin();
});

if (state.token) showPortal();
