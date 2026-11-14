/**
 * @file        accept-invite.js
 * @project     PrathamOne EduOS Coaching Institute Management System
 * @module      SMRITISYS customer invite setup
 *
 * @author      Jawahar R. Mallah
 * @organization AITDL (AI Technology & Development Lab)
 * @client      Prashant Academy Coaching Institute
 * @copyright   Copyright (c) 2026 AITDL
 * @license     Proprietary
 *
 * @version     1.0.0
 * @created     2026-11-14
 * @updated     2026-11-14
 *
 * @description Completes one-time customer account setup from an invitation.
 */
let inviteToken = null;
const inviteForm = document.querySelector('#inviteForm');
const inviteMessage = document.querySelector('#inviteMessage');
const inviteSubmit = document.querySelector('#inviteSubmit');

function showInviteMessage(message, success = false) {
  inviteMessage.textContent = message;
  inviteMessage.style.color = success ? 'var(--turquoise)' : 'var(--red)';
}

const tokenMatch = window.location.hash.match(/^#token=([a-f0-9]{48})$/);
if (tokenMatch) inviteToken = tokenMatch[1];
window.history.replaceState(null, '', window.location.pathname);

if (!inviteToken) {
  inviteForm.classList.add('hidden');
  showInviteMessage('This setup link is invalid or unavailable. Ask the administrator for a new invitation.');
}

inviteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!inviteToken) return;

  const password = document.querySelector('#invitePassword').value;
  const confirmation = document.querySelector('#invitePasswordConfirm').value;
  if (password !== confirmation) {
    showInviteMessage('The passwords do not match.');
    return;
  }

  inviteSubmit.disabled = true;
  showInviteMessage('Creating your account...', true);
  try {
    const response = await fetch('/api/customer-invites/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ token: inviteToken, password }),
    });
    const data = await response.json().catch(() => ({ error: 'Invalid server response' }));
    if (!response.ok) throw new Error(data.error || 'Account setup failed');

    inviteToken = null;
    inviteForm.classList.add('hidden');
    document.querySelector('#inviteComplete').classList.remove('hidden');
    showInviteMessage(data.message || 'Account setup is complete.', true);
  } catch (error) {
    showInviteMessage(error.message || 'Account setup failed. Please try again or request a new invitation.');
    inviteSubmit.disabled = false;
  }
});
