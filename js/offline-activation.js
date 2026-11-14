/**
 * @file        offline-activation.js
 * @project     PrathamOne EduOS Coaching Institute Management System
 * @module      SMRITISYS offline license activation
 *
 * @author      Jawahar R. Mallah
 * @organization AITDL (AI Technology & Development Lab)
 * @client      Prashant Academy Coaching Institute
 * @copyright   Copyright (c) 2026 AITDL
 * @license     Proprietary
 *
 * @version     1.0.0
 * @created     2026-11-15
 * @updated     2026-11-15
 *
 * @description Exchanges an offline installation request for a signed license response.
 */
const form = document.querySelector('#offlineActivationForm');
const requestFile = document.querySelector('#requestFile');
const activationKey = document.querySelector('#activationKey');
const activateButton = document.querySelector('#activateButton');
const statusMessage = document.querySelector('#status');
const requestSummary = document.querySelector('#requestSummary');
const downloadResponse = document.querySelector('#downloadResponse');

let challenge = null;
let responseUrl = null;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function setStatus(message, error = false) {
  statusMessage.textContent = message;
  statusMessage.dataset.error = String(error);
}

function validateChallenge(value) {
  if (!isRecord(value) ||
      value.schema_version !== 1 ||
      value.request_type !== 'prathamone-offline-activation-request' ||
      typeof value.serial_number !== 'string' ||
      !/^SMR-LIC-[A-F0-9]{20}$/.test(value.serial_number) ||
      typeof value.product_code !== 'string' ||
      typeof value.company_binding !== 'string' ||
      typeof value.installation_id !== 'string' ||
      typeof value.activation_identifier !== 'string' ||
      typeof value.refresh_public_key !== 'string' ||
      !isRecord(value.registration)) {
    throw new Error('This is not a valid PrathamOne offline activation request file.');
  }
  return value;
}

requestFile.addEventListener('change', async () => {
  challenge = null;
  requestSummary.style.display = 'none';
  downloadResponse.style.display = 'none';
  if (responseUrl) URL.revokeObjectURL(responseUrl);
  responseUrl = null;
  const file = requestFile.files?.[0];
  if (!file) return;
  if (file.size > 16 * 1024) {
    setStatus('The request file is too large.', true);
    requestFile.value = '';
    return;
  }
  try {
    challenge = validateChallenge(JSON.parse(await file.text()));
    requestSummary.textContent = `Serial ${challenge.serial_number} · ${challenge.registration.institution_name || 'Institution'} · ${challenge.product_code}`;
    requestSummary.style.display = 'block';
    setStatus('Request file is ready. Enter the matching activation key.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'The request file is invalid.', true);
    requestFile.value = '';
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!challenge || !activationKey.value.trim()) {
    setStatus('Select a valid request file and enter its activation key.', true);
    return;
  }
  activateButton.disabled = true;
  downloadResponse.style.display = 'none';
  setStatus('Contacting the license authority...');
  try {
    const response = await fetch('/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        serial_number: challenge.serial_number,
        activation_key: activationKey.value.trim().toUpperCase(),
        product_code: challenge.product_code,
        company_binding: challenge.company_binding,
        installation_id: challenge.installation_id,
        activation_identifier: challenge.activation_identifier,
        refresh_public_key: challenge.refresh_public_key,
        registration: challenge.registration,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The activation request was rejected.');
    if (!isRecord(result) || !isRecord(result.artifact) ||
        typeof result.artifact.document_id !== 'string' ||
        typeof result.artifact.payload !== 'string' ||
        typeof result.artifact.signature !== 'string') {
      throw new Error('The authority returned an invalid signed response.');
    }
    if (responseUrl) URL.revokeObjectURL(responseUrl);
    responseUrl = URL.createObjectURL(new Blob([JSON.stringify(result.artifact, null, 2)], { type: 'application/json' }));
    downloadResponse.href = responseUrl;
    downloadResponse.download = `prathamone-license-response-${challenge.serial_number}.json`;
    downloadResponse.style.display = 'inline-block';
    activationKey.value = '';
    setStatus('Activation succeeded. Download the signed response and import it into the same PrathamOne installation.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Activation failed. Please try again.', true);
  } finally {
    activateButton.disabled = false;
  }
});
