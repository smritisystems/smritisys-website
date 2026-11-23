/**
 * @file        reset-password.js
 * @project     PrathamOne EduOS Coaching Institute Management System
 * @module      SMRITISYS customer password recovery
 *
 * @author      Jawahar R. Mallah
 * @organization AITDL (AI Technology & Development Lab)
 * @client      Prashant Academy Coaching Institute
 * @copyright   Copyright (c) 2026 AITDL
 * @license     Proprietary
 *
 * @version     1.0.0
 * @created     2026-11-16
 * @updated     2026-11-16
 *
 * @description Completes one-time customer password reset links.
 */
const resetForm = document.querySelector('#passwordResetForm');
const resetMessage = document.querySelector('#passwordResetMessage');
const resetButton = document.querySelector('#passwordResetSubmit');
const resetComplete = document.querySelector('#passwordResetComplete');
let resetToken = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';

window.history.replaceState(null, '', window.location.pathname);

function showResetMessage(message, success = false) {
  resetMessage.textContent = message;
  resetMessage.style.color = success ? 'var(--accent)' : 'var(--red)';
}

if (!/^[a-f0-9]{48}$/.test(resetToken)) {
  resetForm.classList.add('hidden');
  showResetMessage('This password reset link is invalid or has expired.');
}

resetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(resetForm);
  const password = form.get('password');
  const confirmation = form.get('password_confirm');
  if (password !== confirmation) {
    showResetMessage('The passwords do not match.');
    return;
  }

  resetButton.disabled = true;
  showResetMessage('Updating your password...', true);
  try {
    const response = await fetch('/api/password-reset/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token: resetToken, password }),
    });
    const result = await response.json().catch(() => ({ error: 'Invalid server response' }));
    if (!response.ok) throw new Error(result.error || 'The password could not be updated.');
    resetForm.classList.add('hidden');
    resetComplete.classList.remove('hidden');
    resetToken = '';
    showResetMessage('Password updated. Please sign in again.', true);
  } catch (error) {
    showResetMessage(error.message || 'The password could not be updated.');
  } finally {
    resetButton.disabled = false;
  }
});
