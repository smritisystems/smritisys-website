const loginForm = document.getElementById('commonLoginForm');
const loginButton = document.getElementById('commonLoginButton');
const loginMessage = document.getElementById('commonLoginMessage');
const workspaceView = document.getElementById('workspaceView');
const workspaceMessage = document.getElementById('workspaceMessage');
const workspaceOptions = document.getElementById('workspaceOptions');
const workspaceError = document.getElementById('workspaceError');
const useAnotherAccountButton = document.getElementById('useAnotherAccount');
const commonLogoutButton = document.getElementById('commonLogout');
const loginEntry = new URLSearchParams(window.location.search).get('entry');
const preferredWorkspace = ['customer', 'partner'].includes(loginEntry) ? loginEntry : null;
const query = new URLSearchParams(window.location.search);
const forceWorkspaceChoice = query.get('choose') === '1';
const loginNotice = ({
  session: 'Please sign in to continue.',
  workspace: 'We could not load your workspace. Please sign in again.',
  partner: 'Choose an organization where you have active access.',
})[query.get('notice')] || '';

async function loginApi(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => ({ error: 'Invalid server response' }));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

function showLogin(message = '', isError = false) {
  workspaceView.classList.add('hidden');
  loginForm.classList.remove('hidden');
  loginMessage.textContent = message;
  loginMessage.style.color = isError ? 'var(--red)' : 'var(--muted)';
}

function workspaceTypeLabel(workspace) {
  if (workspace.workspace_type === 'partner') {
    const labels = {
      channel_partner: 'Channel partner',
      reseller: 'Reseller',
      implementation_partner: 'Implementation partner',
      technology_partner: 'Technology partner',
      referral_partner: 'Referral partner',
      distributor: 'Distributor',
    };
    return labels[workspace.partner_type] || 'Partner';
  }
  return workspace.workspace_type === 'staff' ? 'Staff' : 'Customer';
}

function workspacePath(workspace) {
  if (workspace.workspace_type === 'partner') return '/partner';
  if (workspace.workspace_type === 'staff') return '/admin';
  return '/portal';
}

async function openWorkspace(workspace) {
  workspaceError.textContent = '';
  workspaceOptions.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  try {
    await loginApi('organization-context', {
      method: 'POST',
      body: JSON.stringify({ organization_id: Number(workspace.organization_id) }),
    });
    window.location.replace(workspacePath(workspace));
  } catch (error) {
    workspaceError.textContent = error.message || 'This workspace could not be selected.';
    workspaceOptions.querySelectorAll('button').forEach((button) => { button.disabled = false; });
  }
}

function renderWorkspaces(workspaces, message = '') {
  loginForm.classList.add('hidden');
  workspaceView.classList.remove('hidden');
  workspaceMessage.textContent = message || 'Select an organization. Your access and partner type are assigned by SMRITISYS.';
  workspaceOptions.replaceChildren();
  workspaceError.textContent = '';
  commonLogoutButton.classList.add('hidden');

  for (const workspace of workspaces) {
    const card = document.createElement('article');
    card.className = 'card workspace-option';
    const details = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = workspace.organization_name;
    const description = document.createElement('p');
    description.className = 'muted';
    description.textContent = `${workspaceTypeLabel(workspace)} · ${workspace.member_role.replace(/_/g, ' ')}`;
    const button = document.createElement('button');
    button.className = 'primary';
    button.type = 'button';
    button.textContent = 'Continue';
    button.addEventListener('click', () => openWorkspace(workspace));
    details.append(heading, description);
    card.append(details, button);
    workspaceOptions.append(card);
  }
}

async function loadWorkspaces() {
  try {
    const context = await loginApi('organization-context');
    const workspaces = context.organizations || [];
    if (!workspaces.length) {
      renderWorkspaces([], 'Your account has no active workspaces. Contact your organization administrator.');
      commonLogoutButton.classList.remove('hidden');
      return;
    }

    const selected = workspaces.find(
      (workspace) => Number(workspace.organization_id) === Number(context.selected_organization_id),
    );
    if (!forceWorkspaceChoice && preferredWorkspace) {
      const preferred = workspaces.filter((workspace) => workspace.workspace_type === preferredWorkspace);
      if (preferred.length === 1) {
        await openWorkspace(preferred[0]);
        return;
      }
      if (preferred.length > 1) {
        renderWorkspaces(preferred, `Choose a ${preferredWorkspace} organization.`);
        return;
      }
      renderWorkspaces(workspaces, `This account has no ${preferredWorkspace} workspace. Choose an available workspace instead.`);
      return;
    }

    if (!forceWorkspaceChoice && selected) {
      window.location.replace(workspacePath(selected));
      return;
    }
    if (!forceWorkspaceChoice && workspaces.length === 1) {
      await openWorkspace(workspaces[0]);
      return;
    }
    renderWorkspaces(workspaces, loginNotice);
  } catch (error) {
    if (error.status === 401) {
      showLogin(loginNotice);
      return;
    }
    showLogin(error.message || 'Available workspaces could not be loaded.', true);
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  loginMessage.textContent = 'Signing in...';
  loginMessage.style.color = 'var(--muted)';
  try {
    await loginApi('login', {
      method: 'POST',
      body: JSON.stringify({
        type: 'customer',
        email: new FormData(loginForm).get('email'),
        password: new FormData(loginForm).get('password'),
      }),
    });
    loginForm.reset();
    await loadWorkspaces();
  } catch (error) {
    showLogin(error.status === 401 ? 'Invalid email or password.' : error.message || 'Sign in failed.', true);
  } finally {
    loginButton.disabled = false;
  }
});

async function signOutAndReturnToLogin() {
  commonLogoutButton.disabled = true;
  useAnotherAccountButton.disabled = true;
  try {
    await loginApi('logout', { method: 'POST' });
    showLogin();
  } catch (error) {
    workspaceError.textContent = error.message || 'Sign out failed. Please try again.';
  } finally {
    commonLogoutButton.disabled = false;
    useAnotherAccountButton.disabled = false;
  }
}

useAnotherAccountButton.addEventListener('click', signOutAndReturnToLogin);
commonLogoutButton.addEventListener('click', signOutAndReturnToLogin);

loadWorkspaces();
