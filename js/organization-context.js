window.createOrganizationContextController = function ({
  api,
  buttonId,
  dialogId,
  formId,
  selectId,
  messageId,
  onSelected,
  onSignOut,
}) {
  const button = document.getElementById(buttonId);
  const dialog = document.getElementById(dialogId);
  const form = document.getElementById(formId);
  const select = document.getElementById(selectId);
  const message = document.getElementById(messageId);
  const submitButton = form.querySelector('[type="submit"]');
  const signOutButton = document.getElementById('organizationContextSignOutButton');
  let selectedOrganizationId = null;
  let selectedWorkspace = null;

  function workspaceLabel(organization) {
    if (organization.workspace_type === 'partner') {
      return `${organization.partner_type || 'Partner'} partner`;
    }
    return organization.workspace_type === 'staff' ? 'Staff' : 'Customer';
  }

  async function refresh(openWhenMissing = false) {
    const data = await api('organization-context');
    selectedOrganizationId = data.selected_organization_id == null
      ? null
      : String(data.selected_organization_id);
    const organizations = data.organizations || [];
    select.replaceChildren(new Option('Choose an organization', ''));
    for (const organization of organizations) {
      select.add(new Option(
        `${organization.organization_name} — ${workspaceLabel(organization)} · ${organization.member_role}`,
        String(organization.organization_id),
      ));
    }
    select.value = selectedOrganizationId || '';
    submitButton.disabled = !organizations.length;
    const selectedOrganization = organizations.find(
      (organization) => String(organization.organization_id) === selectedOrganizationId,
    );
    selectedWorkspace = selectedOrganization || null;
    button.textContent = selectedOrganization
      ? `${workspaceLabel(selectedOrganization)}: ${selectedOrganization.organization_name}`
      : 'Select organization';
    message.textContent = organizations.length
      ? selectedOrganizationId ? '' : 'Select an organization to continue.'
      : 'No active organization memberships were found. Contact an administrator.';
    if (!selectedOrganizationId && openWhenMissing && !dialog.open) dialog.showModal();
    return Boolean(selectedOrganizationId);
  }

  button.addEventListener('click', async () => {
    try {
      await refresh(true);
      if (!dialog.open) dialog.showModal();
      select.focus();
    } catch (error) {
      message.textContent = error.message || 'Organization context is unavailable.';
      if (!dialog.open) dialog.showModal();
    }
  });

  dialog.addEventListener('cancel', (event) => {
    if (!selectedOrganizationId) event.preventDefault();
  });

  signOutButton.addEventListener('click', onSignOut);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!select.value) {
      message.textContent = 'Choose an organization before continuing.';
      return;
    }
    submitButton.disabled = true;
    try {
      await api('organization-context', {
        method: 'POST',
        body: JSON.stringify({ organization_id: Number(select.value) }),
      });
      selectedOrganizationId = select.value;
      await refresh();
      dialog.close();
      await onSelected(selectedWorkspace);
    } catch (error) {
      message.textContent = error.message || 'The organization could not be selected.';
    } finally {
      submitButton.disabled = !select.options.length || select.options.length === 1;
    }
  });

  return {
    ensureSelected: () => refresh(true),
  };
};
