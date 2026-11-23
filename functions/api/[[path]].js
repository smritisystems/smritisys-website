/**
 * @file        [[path]].js
 * @project     PrathamOne EduOS Coaching Institute Management System
 * @module      SMRITISYS Pages API
 *
 * @author      Jawahar R. Mallah
 * @organization AITDL (AI Technology & Development Lab)
 * @client      Prashant Academy Coaching Institute
 * @copyright   Copyright (c) 2026 AITDL
 * @license     Proprietary
 *
 * @version     1.0.0
 * @created     2026-11-06
 * @updated     2026-11-15
 *
 * @description Handles authenticated website APIs and customer invitation workflows.
 */
/**
 * SMRITISYS Pages Functions
 * Handles account, profile, support ticket, and demo APIs.
 * Auto-deploys with Cloudflare Pages on every GitHub push
 */

function isTrustedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const configuredOrigins = typeof env.ALLOWED_ORIGINS === "string" ? env.ALLOWED_ORIGINS : "";
  if (!configuredOrigins.trim()) return null;
  const allowedOrigins = configuredOrigins
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowedOrigins.includes(origin) ? origin : null;
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

function boundedString(value, maxLength) {
  return typeof value === "string" && value.trim().length <= maxLength ? value.trim() : null;
}

function validEmail(value) {
  const email = boundedString(value, 254);
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : null;
}

function optionalPartnerOrganizationValue(value, maxLength) {
  if (value == null || typeof value !== "string" || value.trim() === "") return null;
  return boundedString(value, maxLength);
}

function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!match) return null;
  try { return decodeURIComponent(match.slice(name.length + 1)); } catch { return null; }
}

function requestSessionToken(request) {
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || getCookie(request, "smritisys_session");
}

function sessionCookie(token, maxAge = 7 * 24 * 60 * 60) {
  return `smritisys_session=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function clearedSessionCookie() {
  return sessionCookie("", 0);
}

async function enforceRateLimit(env, request, scope, limit, windowSeconds, identity = "", failClosed = false) {
  const client = request.headers.get("CF-Connecting-IP") || "unknown";
  const suffix = identity ? `:${identity}` : "";
  const bucketKey = `${scope}:${client}${suffix}`.slice(0, 240);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  try {
    await env.DB.prepare(
      `INSERT INTO rate_limit_buckets (bucket_key, window_started_at, request_count)
       VALUES (?, ?, 1)
       ON CONFLICT(bucket_key) DO UPDATE SET
         request_count = CASE WHEN window_started_at < ? THEN 1 ELSE request_count + 1 END,
         window_started_at = CASE WHEN window_started_at < ? THEN ? ELSE window_started_at END,
         updated_at = datetime('now')`
    ).bind(bucketKey, windowStart, windowStart, windowStart, windowStart).run();
    const row = await env.DB.prepare(
      "SELECT window_started_at, request_count FROM rate_limit_buckets WHERE bucket_key = ?"
    ).bind(bucketKey).first();
    const retryAfter = Math.max(1, windowSeconds - (now - Number(row?.window_started_at || windowStart)));
    return { allowed: Number(row?.request_count || 0) <= limit, retryAfter };
  } catch (error) {
    console.error("Rate-limit storage unavailable", error);
    return { allowed: !failClosed, unavailable: failClosed, retryAfter: windowSeconds };
  }
}

async function requireRateLimit(env, request, scope, limit, windowSeconds, identity = "") {
  const result = await enforceRateLimit(env, request, scope, limit, windowSeconds, identity);
  return result.allowed ? null : json({ ok: false, error: "Too many requests. Please try again later." }, 429, null, { "Retry-After": String(result.retryAfter) });
}

function json(data, status = 200, origin = null, extraHeaders = {}) {
  const headers = {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

function cors(origin) {
  return new Response(null, {
    status: 204,
    headers: {
      ...SECURITY_HEADERS,
      ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

async function hashLegacyPassword(password) {
  const data = new TextEncoder().encode(password + "smritisys-salt-v1");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MAX_PBKDF2_ITERATIONS = 100000;

async function hashPassword(password) {
  const iterations = MAX_PBKDF2_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hashHex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `pbkdf2-sha256$${iterations}$${saltHex}$${hashHex}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash?.startsWith("pbkdf2-sha256$")) {
    return constantTimeStringEqual(await hashLegacyPassword(password), storedHash);
  }

  const [, prefix, algorithm, iterationsText, saltHex, expectedHash] = storedHash.match(/^(pbkdf2)-(sha256)\$(\d+)\$([0-9a-f]+)\$([0-9a-f]+)$/) || [];
  if (!prefix || !algorithm || !iterationsText || !saltHex || !expectedHash) return false;
  const iterations = Number(iterationsText);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_PBKDF2_ITERATIONS) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((value) => parseInt(value, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  const actualHash = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return constantTimeStringEqual(actualHash, expectedHash);
}

function makeToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function makeNumericLicenseSerialNumber(usedSerials) {
  const range = 900_000_000;
  const maxAcceptedValue = Math.floor(0x1_0000_0000 / range) * range;
  const random = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(random);
    if (random[0] >= maxAcceptedValue) continue;
    const serialNumber = String(100_000_000 + (random[0] % range));
    if (usedSerials.has(serialNumber)) continue;
    usedSerials.add(serialNumber);
    return serialNumber;
  }
}

function makeLicenseActivationKey() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const maxAcceptedValue = Math.floor(256 / alphabet.length) * alphabet.length;
  const random = new Uint8Array(32);
  const characters = [];
  while (characters.length < 16) {
    crypto.getRandomValues(random);
    for (const byte of random) {
      if (byte >= maxAcceptedValue) continue;
      characters.push(alphabet[byte % alphabet.length]);
      if (characters.length === 16) break;
    }
  }
  return characters.join("");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeBase64(value) {
  if (typeof value !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function encodeBase64(value) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function loadLicenseCodeEncryptionKey(env) {
  const secret = env.LICENSE_CODE_ENCRYPTION_KEY;
  if (secret == null || secret === "") return { configured: false, key: null };
  const rawKey = decodeBase64(secret);
  if (!rawKey || rawKey.length !== 32) return { configured: true, key: null };
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
  return { configured: true, key };
}

async function encryptLicenseActivationKey(activationKey, encryptionKey, batchId, serialNumber) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(`${batchId}:${serialNumber}`);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData },
    encryptionKey,
    new TextEncoder().encode(activationKey),
  );
  return `v1.${encodeBase64(iv)}.${encodeBase64(new Uint8Array(encrypted))}`;
}

async function decryptLicenseActivationKey(ciphertext, encryptionKey, batchId, serialNumber) {
  const [version, encodedIv, encodedCiphertext, ...extra] = String(ciphertext || "").split(".");
  const iv = decodeBase64(encodedIv);
  const encrypted = decodeBase64(encodedCiphertext);
  if (version !== "v1" || extra.length || iv?.length !== 12 || !encrypted || encrypted.length < 16) {
    throw new TypeError("Invalid encrypted activation-key format");
  }
  const additionalData = new TextEncoder().encode(`${batchId}:${serialNumber}`);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData },
    encryptionKey,
    encrypted,
  );
  return new TextDecoder().decode(plaintext);
}

async function licenseEmailCodeHash(env, challengeId, code) {
  const secret = boundedString(env.LICENSE_EMAIL_CODE_SECRET, 256);
  if (!secret || secret.length < 32) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${challengeId}\n${code}`),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeLicenseEmailCode() {
  const range = 100_000_000;
  const maxAcceptedValue = Math.floor(0x1_0000_0000 / range) * range;
  const random = new Uint32Array(1);
  do {
    crypto.getRandomValues(random);
  } while (random[0] >= maxAcceptedValue);
  return String(random[0] % range).padStart(8, "0");
}

async function sendLicenseVerificationEmail(env, email, code, purpose) {
  const accountId = boundedString(env.CLOUDFLARE_EMAIL_ACCOUNT_ID, 64);
  const apiToken = boundedString(env.CLOUDFLARE_EMAIL_API_TOKEN, 512);
  const from = validEmail(env.LICENSE_EMAIL_FROM);
  if (!accountId || !apiToken || !from) {
    return { error: "License verification email is not configured", status: 503 };
  }

  const subject = purpose === "email_change"
    ? "Confirm your PrathamOne license email change"
    : "Your PrathamOne license verification code";
  const text = `Your PrathamOne verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: [email], from, subject, text }),
    },
  ).catch((error) => {
    console.error("License verification email request failed", error);
    return null;
  });
  if (!response) return { error: "License verification email could not be sent", status: 503 };

  let result;
  try {
    result = await response.json();
  } catch (error) {
    console.error("License verification email service returned invalid JSON", error);
    return { error: "License verification email service returned an invalid response", status: 502 };
  }
  const sentToRecipient = [
    ...(Array.isArray(result?.result?.delivered) ? result.result.delivered : []),
    ...(Array.isArray(result?.result?.queued) ? result.result.queued : []),
  ].some((recipient) => String(recipient).toLowerCase() === email);
  if (!response.ok || result?.success !== true || !sentToRecipient) {
    console.error("License verification email service rejected a message", {
      status: response.status,
      success: result?.success === true,
    });
    return { error: "License verification email could not be delivered", status: 503 };
  }
  return { ok: true };
}

async function createLicenseEmailVerification(env, {
  challengeId = crypto.randomUUID(),
  purpose,
  email,
  productCode,
  companyBinding,
  licenseId = null,
  targetEmail = null,
  installationId = null,
  activationIdentifier = null,
}) {
  const rateLimitedAddresses = [...new Set([email, targetEmail]
    .filter(Boolean)
    .map((address) => address.toLowerCase()))];
  for (const address of rateLimitedAddresses) {
    const recentRequests = await env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM license_email_verifications
       WHERE created_at > datetime('now', '-10 minutes')
         AND (lower(email) = ? OR lower(target_email) = ?)`
    ).bind(address, address).first();
    if (Number(recentRequests?.count || 0) >= 5) {
      return { error: "Too many verification emails were requested for this address. Try again later.", status: 429 };
    }
  }

  const code = makeLicenseEmailCode();
  const codeHash = await licenseEmailCodeHash(env, challengeId, code);
  if (!codeHash) return { error: "License email verification is not configured", status: 503 };

  await env.DB.prepare(
    `INSERT INTO license_email_verifications
     (challenge_id, purpose, email, code_hash, product_code, company_binding, license_id,
      target_email, installation_id, activation_identifier, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+10 minutes'))`
  ).bind(
    challengeId, purpose, email, codeHash, productCode, companyBinding, licenseId,
    targetEmail, installationId, activationIdentifier,
  ).run();

  const delivery = await sendLicenseVerificationEmail(env, email, code, purpose);
  if (delivery.error) {
    await env.DB.prepare(
      "DELETE FROM license_email_verifications WHERE challenge_id = ? AND verified_at IS NULL"
    ).bind(challengeId).run();
    return delivery;
  }
  return { challenge_id: challengeId };
}

function constantTimeStringEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function verifyLicenseEmailCode(env, challengeId, code) {
  const challenge = await env.DB.prepare(
    `SELECT challenge_id, purpose, email, code_hash, product_code, company_binding,
            license_id, target_email, attempts, current_email_verified_at, verified_at, consumed_at
     FROM license_email_verifications
     WHERE challenge_id = ? AND expires_at > datetime('now') AND attempts < 5`
  ).bind(challengeId).first();
  if (!challenge || challenge.consumed_at) return { error: "The verification code is invalid or expired", status: 400 };
  const submittedHash = await licenseEmailCodeHash(env, challengeId, code);
  if (!submittedHash) return { error: "License email verification is not configured", status: 503 };
  if (!constantTimeStringEqual(submittedHash, challenge.code_hash)) {
    await env.DB.prepare(
      `UPDATE license_email_verifications SET attempts = attempts + 1
       WHERE challenge_id = ? AND attempts < 5 AND consumed_at IS NULL`
    ).bind(challengeId).run();
    return { error: "The verification code is invalid or expired", status: 400 };
  }
  return { challenge };
}

async function requestLicenseEmailCode(request, env, origin) {
  const rateLimit = await requireRateLimit(env, request, "license-email-code", 5, 600);
  if (rateLimit) return rateLimit;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A JSON verification request is required" }, 400, origin);
  }
  const purpose = body?.purpose;
  if (!["activation", "email_change"].includes(purpose)) {
    return json({ ok: false, error: "A supported email verification purpose is required" }, 400, origin);
  }
  const email = validEmail(body?.email);
  const targetEmail = purpose === "email_change" ? validEmail(body?.target_email) : null;
  const productCode = boundedString(body?.product_code, 100);
  const companyBinding = boundedString(body?.company_binding, 128);
  const licenseId = purpose === "email_change" ? numericId(body?.license_id) : null;
  const serialNumber = purpose === "email_change"
    ? boundedString(body?.serial_number, 80)?.toUpperCase() || null
    : null;
  if (!email || !productCode || !companyBinding ||
      (purpose === "email_change" && (!targetEmail || targetEmail === email || (!licenseId && !serialNumber)))) {
    return json({ ok: false, error: "A valid email, product, company, and verification scope are required" }, 400, origin);
  }

  let matchingLicense;
  if (purpose === "activation") {
    matchingLicense = await env.DB.prepare(
      `SELECT l.id FROM licenses l
       JOIN products p ON p.id = l.product_id AND p.slug = ?
       JOIN license_entitlements e ON e.license_id = l.id
         AND e.entitlement_key = 'company.binding' AND e.value_text = ?
       WHERE lower(l.registered_email) = ? AND l.status = 'ACTIVE'
       ORDER BY l.id DESC LIMIT 1`
    ).bind(productCode, companyBinding, email).first();
  } else {
    matchingLicense = await env.DB.prepare(
      `SELECT l.id FROM licenses l
       JOIN products p ON p.id = l.product_id AND p.slug = ?
       JOIN license_entitlements e ON e.license_id = l.id
         AND e.entitlement_key = 'company.binding' AND e.value_text = ?
       WHERE (? IS NULL OR l.id = ?) AND (? IS NULL OR l.serial_number = ?)
         AND lower(l.registered_email) = ? AND l.status = 'ACTIVE'`
    ).bind(productCode, companyBinding, licenseId, licenseId, serialNumber, serialNumber, email).first();
  }

  if (matchingLicense) {
    const challenge = await createLicenseEmailVerification(env, {
      purpose,
      email,
      productCode,
      companyBinding,
      licenseId: purpose === "email_change" ? Number(matchingLicense.id) : null,
      targetEmail,
    });
    if (challenge.error) return json({ ok: false, error: challenge.error }, challenge.status, origin);
    return json({
      ok: true,
      challenge_id: challenge.challenge_id,
      message: "If an eligible license matches this email, a verification code has been sent.",
    }, 202, origin);
  }

  return json({
    ok: true,
    challenge_id: crypto.randomUUID(),
    message: "If an eligible license matches this email, a verification code has been sent.",
  }, 202, origin);
}

async function verifyLicenseEmail(request, env, origin) {
  const rateLimit = await requireRateLimit(env, request, "license-email-verify", 10, 600);
  if (rateLimit) return rateLimit;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A JSON verification request is required" }, 400, origin);
  }
  const challengeId = boundedString(body?.challenge_id, 36);
  const code = boundedString(body?.code, 8);
  if (!UUID_PATTERN.test(challengeId || "") || !/^\d{8}$/.test(code || "")) {
    return json({ ok: false, error: "A valid challenge and eight-digit verification code are required" }, 400, origin);
  }
  const result = await verifyLicenseEmailCode(env, challengeId, code);
  if (result.error) return json({ ok: false, error: result.error }, result.status, origin);
  const challenge = result.challenge;

  if (challenge.purpose === "email_change") {
    if (!challenge.current_email_verified_at && challenge.email !== challenge.target_email) {
      const targetCode = makeLicenseEmailCode();
      const targetHash = await licenseEmailCodeHash(env, challengeId, targetCode);
      if (!targetHash) return json({ ok: false, error: "License email verification is not configured" }, 503, origin);
      const delivery = await sendLicenseVerificationEmail(env, challenge.target_email, targetCode, "email_change");
      if (delivery.error) return json({ ok: false, error: delivery.error }, delivery.status, origin);
      await env.DB.prepare(
        `UPDATE license_email_verifications
         SET code_hash = ?, attempts = 0,
             current_email_verified_at = datetime('now'), verified_at = NULL,
             expires_at = datetime('now', '+10 minutes')
         WHERE challenge_id = ? AND consumed_at IS NULL AND current_email_verified_at IS NULL`
      ).bind(targetHash, challengeId).run();
      return json({ ok: true, stage: "target_email", message: "A confirmation code was sent to the new email address." }, 200, origin);
    }

    if (!challenge.current_email_verified_at) {
      return json({ ok: false, error: "The email change verification state is invalid" }, 409, origin);
    }
    const changeResults = await env.DB.batch([
      env.DB.prepare(
        `UPDATE license_email_verifications
         SET verified_at = datetime('now'), consumed_at = datetime('now')
         WHERE challenge_id = ? AND purpose = 'email_change'
           AND email = ? AND target_email = ? AND current_email_verified_at IS NOT NULL
           AND consumed_at IS NULL AND expires_at > datetime('now')`
      ).bind(challengeId, challenge.email, challenge.target_email),
      env.DB.prepare(
        `UPDATE licenses SET registered_email = ?
         WHERE id = ? AND lower(registered_email) = ?
           AND EXISTS (
             SELECT 1 FROM license_email_verifications
             WHERE challenge_id = ? AND purpose = 'email_change'
               AND email = ? AND target_email = ? AND current_email_verified_at IS NOT NULL
               AND consumed_at IS NOT NULL
           )`
      ).bind(
        challenge.target_email, challenge.license_id, challenge.email, challengeId,
        challenge.email, challenge.target_email,
      ),
    ]);
    if (Number(changeResults?.[0]?.meta?.changes || 0) !== 1 ||
        Number(changeResults?.[1]?.meta?.changes || 0) !== 1) {
      return json({ ok: false, error: "The license email could not be changed" }, 409, origin);
    }
    const changedLicense = await env.DB.prepare(
      `SELECT l.id, l.status, l.organization_id
       FROM licenses l
       WHERE l.id = ?`
    ).bind(challenge.license_id).first();
    const auditPrincipal = {
      person_id: null,
      organization_id: changedLicense?.organization_id || null,
    };
    await writeAudit(env, request, auditPrincipal, "LICENSE_REGISTERED_EMAIL_CHANGED",
      "license", challenge.license_id, null, { source: "verified_self_service" });
    if (changedLicense?.organization_id) {
      await recordLicenseEvent(env, changedLicense, null, "LICENSE_EMAIL_CHANGED",
        changedLicense.status, changedLicense.status, { source: "verified_self_service" });
    }
    return json({ ok: true, stage: "complete", registered_email: challenge.target_email }, 200, origin);
  }

  await env.DB.prepare(
    `UPDATE license_email_verifications SET verified_at = datetime('now')
     WHERE challenge_id = ? AND purpose = 'activation' AND consumed_at IS NULL`
  ).bind(challengeId).run();
  const { results } = await env.DB.prepare(
    `SELECT l.id AS license_id, l.serial_number, l.seats,
            (SELECT COUNT(*) FROM license_activations la
             WHERE la.license_id = l.id AND la.status = 'active') AS activation_count
     FROM licenses l
     JOIN products p ON p.id = l.product_id AND p.slug = ?
     JOIN license_entitlements e ON e.license_id = l.id
       AND e.entitlement_key = 'company.binding' AND e.value_text = ?
     WHERE lower(l.registered_email) = ? AND l.status = 'ACTIVE'
     ORDER BY l.id DESC`
  ).bind(challenge.product_code, challenge.company_binding, challenge.email).all();
  return json({
    ok: true,
    stage: "complete",
    licenses: results,
  }, 200, origin);
}

export function isValidCustomerInviteToken(token) {
  return typeof token === "string" && /^[a-f0-9]{48}$/.test(token);
}

export async function hashCustomerInviteToken(token) {
  if (!isValidCustomerInviteToken(token)) throw new TypeError("Invalid customer invitation token");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getCustomerSession(request, env) {
  const principal = await getIdentitySession(request, env);
  if (!principal || principal.account_type !== "customer") return null;
  return principal;
}

async function getSessionIdentity(request, env) {
  const token = requestSessionToken(request);
  if (!token) return null;

  return await env.DB.prepare(
    `SELECT s.id AS session_id, s.token, s.account_type, s.account_id,
            s.organization_id, p.id AS person_id, p.email, p.name,
            p.status AS person_status
     FROM sessions s
     JOIN people p ON p.source_type = s.account_type AND p.source_id = s.account_id
     WHERE s.token = ? AND s.expires_at > datetime('now') AND p.status = 'active'
       AND (
         (s.account_type = 'user' AND EXISTS (
           SELECT 1 FROM users u WHERE u.id = s.account_id AND u.status IN ('active', 'trial')
         ))
         OR
         (s.account_type = 'customer' AND EXISTS (
           SELECT 1 FROM customers c WHERE c.id = s.account_id AND c.status IN ('active', 'trial')
         ))
       )`
  ).bind(token).first();
}

async function handleOrganizationContext(request, env) {
  const session = await getSessionIdentity(request, env);
  if (!session) return json({ ok: false, error: "Valid login required" }, 401);

  const memberships = await env.DB.prepare(
    `SELECT m.id AS membership_id, m.organization_id, o.name AS organization_name,
            m.member_role
     FROM organization_members m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.account_type = ? AND m.account_id = ?
       AND m.status = 'active' AND o.status = 'active'
     ORDER BY o.name COLLATE NOCASE, o.id`
  ).bind(session.account_type, session.account_id).all();
  const availableMemberships = memberships.results || [];
  const selectedMembership = availableMemberships.find(
    (membership) => Number(membership.organization_id) === Number(session.organization_id),
  ) || null;

  if (request.method === "GET") {
    return json({
      ok: true,
      selected_organization_id: selectedMembership?.organization_id || null,
      organizations: availableMemberships,
    }, 200, null, { "Cache-Control": "no-store" });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid organization selection is required" }, 400);
  }
  const organizationId = numericId(body?.organization_id);
  if (!organizationId) {
    return json({ ok: false, error: "A valid organization id is required" }, 400);
  }
  const membership = availableMemberships.find(
    (item) => Number(item.organization_id) === organizationId,
  );
  if (!membership) {
    return json({ ok: false, error: "You do not have active access to that organization" }, 403);
  }
  if (Number(session.organization_id) === organizationId) {
    return json({
      ok: true,
      selected_organization_id: organizationId,
      changed: false,
    }, 200, null, { "Cache-Control": "no-store" });
  }

  const result = await env.DB.prepare(
    `UPDATE sessions SET organization_id = ?
     WHERE id = ? AND token = ? AND expires_at > datetime('now')`
  ).bind(organizationId, session.session_id, session.token).run();
  if (result.meta.changes !== 1) {
    return json({ ok: false, error: "The login session expired; sign in again" }, 401);
  }

  await writeAudit(
    env,
    request,
    { person_id: session.person_id, organization_id: organizationId },
    "ORGANIZATION_CONTEXT_SELECTED",
    "organization_membership",
    String(membership.membership_id),
    session.organization_id ? { organization_id: session.organization_id } : null,
    { organization_id: organizationId },
  );
  return json({
    ok: true,
    selected_organization_id: organizationId,
    changed: true,
  }, 200, null, { "Cache-Control": "no-store" });
}

async function getIdentitySession(request, env) {
  const token = requestSessionToken(request);
  if (!token) return null;

  return await env.DB.prepare(
    `SELECT s.account_type, s.account_id, p.id AS person_id, p.email, p.name,
            p.status AS person_status, s.organization_id, m.member_role,
            m.status AS membership_status, o.status AS organization_status
     FROM sessions s
     JOIN people p ON p.source_type = s.account_type AND p.source_id = s.account_id
     JOIN organization_members m ON m.organization_id = s.organization_id
       AND m.account_type = s.account_type AND m.account_id = s.account_id
     JOIN organizations o ON o.id = m.organization_id
     WHERE s.token = ? AND s.expires_at > datetime('now')
       AND s.organization_id IS NOT NULL
       AND p.status = 'active' AND m.status = 'active' AND o.status = 'active'
       AND (
         (s.account_type = 'user' AND EXISTS (
           SELECT 1 FROM users u WHERE u.id = s.account_id AND u.status IN ('active', 'trial')
         ))
         OR
         (s.account_type = 'customer' AND EXISTS (
           SELECT 1 FROM customers c WHERE c.id = s.account_id AND c.status IN ('active', 'trial')
         ))
       )
     LIMIT 1`
  )
    .bind(token)
    .first();
}

async function hasPermission(env, principal, permission) {
  if (!principal) return false;
  if (principal.account_type === "customer" &&
      ["partner_admin", "partner_member"].includes(principal.member_role)) {
    return false;
  }
  const row = await env.DB.prepare(
    `SELECT 1 FROM organization_members m
     JOIN roles r ON r.name = m.member_role
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE m.organization_id = ? AND m.account_type = ? AND m.account_id = ?
       AND m.status = 'active' AND p.name = ?`
  )
    .bind(principal.organization_id, principal.account_type, principal.account_id, permission)
    .first();
  return Boolean(row);
}

async function getPartnerSession(request, env) {
  const principal = await getIdentitySession(request, env);
  if (!principal) return null;
  const membership = await env.DB.prepare(
    `SELECT r.organization_id AS partner_organization_id,
            r.relationship_type AS partner_type,
            o.name AS partner_name, o.status AS partner_status
     FROM relationships r
     JOIN organizations o ON o.id = r.organization_id AND o.status = 'active'
     WHERE r.organization_id = ? AND r.status = 'active'
       AND r.relationship_type IN (
         'channel_partner', 'reseller', 'implementation_partner',
         'technology_partner', 'referral_partner', 'distributor'
       )`
  ).bind(principal.organization_id).first();
  if (!membership) return null;
  return { ...principal, ...membership, partner_role: principal.member_role };
}

async function hasPartnerPermission(env, principal, permission) {
  if (!principal || !["partner_admin", "partner_member"].includes(principal.member_role)) return false;
  const row = await env.DB.prepare(
    `SELECT 1 FROM organization_members m
     JOIN roles r ON r.name = m.member_role
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     JOIN relationships rel ON rel.organization_id = m.organization_id
       AND rel.status = 'active'
       AND rel.relationship_type IN (
         'channel_partner', 'reseller', 'implementation_partner',
         'technology_partner', 'referral_partner', 'distributor'
       )
     WHERE m.organization_id = ? AND m.account_type = ? AND m.account_id = ?
       AND m.member_role IN ('partner_admin', 'partner_member')
       AND m.status = 'active' AND p.name = ?`
  ).bind(principal.organization_id, principal.account_type, principal.account_id, permission).first();
  return Boolean(row);
}

async function requirePermission(request, env, permission) {
  const principal = await getIdentitySession(request, env);
  if (!principal || !(await hasPermission(env, principal, permission))) return null;
  return principal;
}

async function writeAudit(env, request, principal, action, resourceType, resourceId, oldValue = null, newValue = null) {
  await env.DB.prepare(
    `INSERT INTO audit_logs
     (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      principal?.person_id || null,
      principal?.organization_id || null,
      action,
      resourceType || null,
      resourceId == null ? null : String(resourceId),
      oldValue == null ? null : JSON.stringify(oldValue),
      newValue == null ? null : JSON.stringify(newValue),
      request.headers.get("CF-Connecting-IP") || null,
    )
    .run();
}

const LICENSE_STATUSES = ["DRAFT", "ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED", "PENDING_RENEWAL"];
const LICENSE_TRANSITIONS = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["SUSPENDED", "PENDING_RENEWAL", "EXPIRED", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "CANCELLED"],
  PENDING_RENEWAL: ["ACTIVE", "EXPIRED"],
  EXPIRED: ["ACTIVE"],
  CANCELLED: [],
};

function numericId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function licenseValidity(status, startsAt, expiresAt) {
  const today = new Date().toISOString().slice(0, 10);
  const isExpired = status === "EXPIRED" || (expiresAt && expiresAt < today);
  const isValid = status === "ACTIVE" && (!startsAt || startsAt <= today) && (!expiresAt || expiresAt >= today);
  const daysRemaining = expiresAt
    ? Math.max(0, Math.ceil((Date.parse(`${expiresAt}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000))
    : null;
  return { is_valid: isValid, is_expired: Boolean(isExpired), days_remaining: daysRemaining };
}

function licenseResponse(record, includeActivationKey = false) {
  return {
    id: record.id,
    serial_number: record.serial_number || `SMR-LIC-${String(record.id).padStart(8, "0")}`,
    license_key: includeActivationKey ? record.license_key : null,
    organization_id: record.organization_id,
    customer_id: record.customer_id,
    product: { id: record.product_id, code: record.product_code, name: record.product_name },
    edition: record.edition_id ? { id: record.edition_id, code: record.edition_code, name: record.edition_name } : null,
    status: record.status,
    start_date: record.starts_at,
    expiry_date: record.expires_at,
    activation_count: Number(record.activation_count || 0),
    validity: licenseValidity(record.status, record.starts_at, record.expires_at),
    created_at: record.created_at || null,
    updated_at: record.updated_at || record.created_at || null,
  };
}

async function getLicenseRecord(env, licenseId) {
  return await env.DB.prepare(
    `SELECT l.id, l.license_key, l.serial_number, l.offline_validity_days,
            l.customer_id, l.product_id, l.status,
            l.starts_at, l.expires_at,
            p.slug AS product_code, p.name AS product_name,
            le.edition_id, pe.code AS edition_code, pe.name AS edition_name,
            l.organization_id,
            (SELECT COUNT(*) FROM license_activations la WHERE la.license_id = l.id AND la.status = 'active') AS activation_count
     FROM licenses l
     JOIN products p ON p.id = l.product_id
     LEFT JOIN license_editions le ON le.license_id = l.id
     LEFT JOIN product_editions pe ON pe.id = le.edition_id
     WHERE l.id = ?`
  ).bind(licenseId).first();
}

async function requireLicenseAccess(request, env, licenseId, permission = "license.view") {
  const principal = await requirePermission(request, env, permission);
  if (!principal) return { error: json({ ok: false, error: "License permission required" }, 403) };
  const license = await getLicenseRecord(env, licenseId);
  if (!license) return { error: json({ ok: false, error: "License not found" }, 404) };
  if (!license.organization_id && permission !== "license.view") {
    return {
      error: json({
        ok: false,
        error: "This license requires an organization association before it can be changed",
      }, 409),
    };
  }
  if (principal.account_type === "customer" && license.organization_id !== principal.organization_id) {
    return { error: json({ ok: false, error: "License not found" }, 404) };
  }
  return { principal, license };
}

async function recordLicenseEvent(env, license, principal, eventType, previousStatus, newStatus, metadata = null) {
  await env.DB.prepare(
    `INSERT INTO license_events
     (license_id, organization_id, actor_person_id, event_type, previous_status, new_status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    license.id,
    license.organization_id,
    principal?.person_id || null,
    eventType,
    previousStatus || null,
    newStatus || null,
    metadata == null ? null : JSON.stringify(metadata),
  ).run();
}

function normalizeEntitlements(value) {
  if (!Array.isArray(value) || value.length > 50) return null;
  const allowedTypes = ["number", "text", "boolean", "json"];
  const normalized = [];
  const keys = new Set();
  for (const item of value) {
    if (!item || typeof item.key !== "string" || !/^[a-z][a-z0-9_.-]{0,63}$/.test(item.key) || !allowedTypes.includes(item.value_type) || keys.has(item.key)) return null;
    keys.add(item.key);
    if (item.value_type === "number" && (!Number.isFinite(Number(item.value)) || Number(item.value) < 0)) return null;
    normalized.push({
      key: item.key,
      value_type: item.value_type,
      value_text: item.value_type === "number" ? null : item.value_type === "json" ? JSON.stringify(item.value) : String(item.value),
      value_number: item.value_type === "number" ? Number(item.value) : null,
    });
  }
  return normalized;
}

function parseEntitlement(row) {
  let value = row.value_text;
  if (row.value_type === "number") value = row.value_number;
  if (row.value_type === "boolean") value = row.value_text === "true";
  if (row.value_type === "json") {
    try { value = JSON.parse(row.value_text); } catch { value = null; }
  }
  return { key: row.entitlement_key, value_type: row.value_type, value };
}

const DEFAULT_EVALUATION_POLICY = {
  allow_dashboard: true,
  allow_read_only_records: true,
  allow_reports: true,
  allow_backups: true,
  allow_exports: true,
  locked_modules: ["billing", "inventory_transactions", "accounting", "payroll"],
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function encodeBase64Url(value) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function licenseModel(entitlements, billingPeriod) {
  const explicitModel = entitlements["license.model"]?.value;
  const allowedModels = ["cloud_subscription", "cloud_one_time", "on_premise_subscription", "on_premise_perpetual"];
  if (allowedModels.includes(explicitModel)) return explicitModel;
  const deployment = entitlements["deployment.mode"]?.value === "cloud" ? "cloud" : "on_premise";
  if (billingPeriod === "one_time") return deployment === "cloud" ? "cloud_one_time" : "on_premise_perpetual";
  return `${deployment}_subscription`;
}

export function calculateLicenseMode({ status, startsAt, expiresAt, model, graceDays = 7, now = new Date() }) {
  const today = now.toISOString().slice(0, 10);
  if (startsAt && startsAt > today) return "evaluation";
  const perpetual = model === "on_premise_perpetual" || model === "cloud_one_time";
  if (perpetual) {
    return status === "SUSPENDED" || status === "CANCELLED" ? "evaluation" : "active";
  }
  if (status === "SUSPENDED" || status === "CANCELLED" || status === "DRAFT") return "evaluation";

  if (!expiresAt || expiresAt >= today) return "active";

  const expiryDay = Date.parse(`${expiresAt}T00:00:00Z`);
  const todayDay = Date.parse(`${today}T00:00:00Z`);
  const daysPastExpiry = Math.floor((todayDay - expiryDay) / 86400000);
  return daysPastExpiry <= Math.max(0, Number(graceDays) || 0) ? "grace" : "evaluation";
}

function licenseEnvelopeJson(payload) {
  return new TextEncoder().encode(JSON.stringify(payload));
}

async function signLicensePayload(env, payloadBytes) {
  const signer = env.LICENSE_SIGNER;
  const activeKeyId = boundedString(env.LICENSE_ACTIVE_KEY_ID, 128);
  let publicKeys;
  try {
    publicKeys = JSON.parse(env.LICENSE_SIGNING_PUBLIC_KEYS || "{}");
  } catch {
    return { error: "License verification keys are not configured correctly", status: 503 };
  }
  if (!signer || typeof signer.fetch !== "function" || !activeKeyId || !publicKeys[activeKeyId]) {
    return { error: "License signing service is not configured", status: 503 };
  }

  const payloadBase64url = encodeBase64Url(payloadBytes);
  const signerResponse = await signer.fetch(new Request("https://license-signer.internal/v1/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ algorithm: "Ed25519", key_id: activeKeyId, payload: payloadBase64url }),
  }));
  if (!signerResponse.ok) {
    return { error: "License signing service is unavailable", status: 503 };
  }

  let signed;
  try {
    signed = await signerResponse.json();
  } catch {
    return { error: "License signing service returned an invalid response", status: 502 };
  }
  const signature = decodeBase64Url(signed?.signature);
  const publicKeyBytes = decodeBase64Url(publicKeys[activeKeyId]);
  if (signed?.key_id !== activeKeyId || !signature || signature.length !== 64 || !publicKeyBytes || publicKeyBytes.length !== 32) {
    return { error: "License signing service returned an invalid signature envelope", status: 502 };
  }

  try {
    const publicKey = await crypto.subtle.importKey("raw", publicKeyBytes, { name: "Ed25519" }, false, ["verify"]);
    const verified = await crypto.subtle.verify({ name: "Ed25519" }, publicKey, signature, payloadBytes);
    if (!verified) return { error: "License signature verification failed", status: 502 };
  } catch (error) {
    console.error("License signature verification failed", error);
    return { error: "License signature verification failed", status: 502 };
  }

  return { keyId: activeKeyId, payload: payloadBase64url, signature: signed.signature };
}

async function buildSignedLicenseArtifact(env, license, installationId, activationIdentifier, companyBinding, entitlements, status) {
  let editionPolicy = null;
  if (license.edition_id) {
    editionPolicy = await env.DB.prepare(
      `SELECT subscription_grace_days, rollout_stage, evaluation_policy_json
       FROM product_edition_license_policies WHERE edition_id = ?`
    ).bind(license.edition_id).first();
  }
  let evaluationPolicy = DEFAULT_EVALUATION_POLICY;
  if (editionPolicy?.evaluation_policy_json) {
    try {
      const configured = JSON.parse(editionPolicy.evaluation_policy_json);
      if (configured && typeof configured === "object" && !Array.isArray(configured)) {
        evaluationPolicy = { ...DEFAULT_EVALUATION_POLICY, ...configured };
      }
    } catch (error) {
      console.error("Invalid edition evaluation policy", error);
      return { error: "Edition evaluation policy is invalid", status: 503 };
    }
  }

  const issuedAt = new Date().toISOString();
  const documentId = crypto.randomUUID();
  const payload = {
    schema_version: 1,
    document_id: documentId,
    issuer: "SMRITISYS",
    license_id: String(license.id),
    serial_number: license.serial_number || `SMR-LIC-${String(license.id).padStart(8, "0")}`,
    customer_id: String(license.customer_id),
    organization_id: String(license.organization_id),
    product_code: license.product_code,
    edition: license.edition_code || null,
    company_binding: companyBinding,
    installation_id: installationId,
    activation_identifier: activationIdentifier,
    license_model: licenseModel(entitlements, license.billing_period),
    status: status || license.status,
    starts_at: license.starts_at,
    expires_at: license.expires_at,
    offline_validity_days: Number(license.offline_validity_days || 14),
    subscription_grace_days: Math.min(30, Math.max(0, Number(editionPolicy?.subscription_grace_days ?? 7))),
    rollout_stage: editionPolicy?.rollout_stage || "shadow",
    evaluation_policy: evaluationPolicy,
    entitlements: Object.fromEntries(Object.entries(entitlements).map(([key, item]) => [key, item.value])),
    issued_at: issuedAt,
  };
  const signed = await signLicensePayload(env, licenseEnvelopeJson(payload));
  if (signed.error) return signed;

  return {
    document_id: documentId,
    issued_at: issuedAt,
    key_id: signed.keyId,
    payload: signed.payload,
    signature: signed.signature,
  };
}

function constantTimeHexEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function claimLicenseCode(env, { serialNumber, activationKey, productCode, companyBinding, installationId, activationIdentifier, registration }) {
  const activationKeyHash = await sha256Hex(activationKey);
  const code = await env.DB.prepare(
    `SELECT c.*, p.slug AS product_code, p.billing_period
     FROM license_code_inventory c
     JOIN products p ON p.id = c.product_id
     WHERE c.serial_number = ?`
  ).bind(serialNumber).first();
  if (!code || !constantTimeHexEqual(code.activation_key_hash, activationKeyHash) || code.product_code !== productCode) {
    return { error: "Serial number and activation key were not recognized for this product", status: 404 };
  }
  if (code.status === "claimed") {
    if (code.company_binding !== companyBinding ||
        code.installation_id !== installationId ||
        code.activation_identifier !== activationIdentifier) {
      return { error: "This activation code has already been claimed by another installation", status: 409 };
    }
    return { license_id: code.license_id };
  }
  if (code.status !== "available") {
    return { error: "This activation code is not available", status: 409 };
  }

  const customerEmail = validEmail(registration?.contact_email);
  const institutionName = boundedString(registration?.institution_name, 200);
  const contactName = boundedString(registration?.contact_name, 120);
  const requestedOrganizationId = registration?.organization_id == null || registration.organization_id === ""
    ? null
    : numericId(String(registration.organization_id));
  const optionalString = (value, maxLength) => {
    if (value == null || value === "") return null;
    return boundedString(value, maxLength);
  };
  const phone = boundedString(registration?.phone, 50);
  const address = optionalString(registration?.address, 300);
  const city = optionalString(registration?.city, 120);
  const state = optionalString(registration?.state, 120);
  const pincode = optionalString(registration?.pincode, 30);
  const taxId = optionalString(registration?.tax_id, 80);
  const website = optionalString(registration?.website, 200);
  if (!customerEmail || !institutionName || !contactName || !phone ||
      (registration?.organization_id != null && registration.organization_id !== "" && !requestedOrganizationId) ||
      (registration?.address != null && registration.address !== "" && !address) ||
      (registration?.city != null && registration.city !== "" && !city) ||
      (registration?.state != null && registration.state !== "" && !state) ||
      (registration?.pincode != null && registration.pincode !== "" && !pincode) ||
      (registration?.tax_id != null && registration.tax_id !== "" && !taxId) ||
      (registration?.website != null && registration.website !== "" && !website)) {
    return { error: "Registration requires an institution name, contact name, valid email, and valid optional contact details", status: 400 };
  }
  if (!companyBinding || companyBinding.length > 128) {
    return { error: "A valid company binding is required", status: 400 };
  }

  let customer = await env.DB.prepare(
    "SELECT id, company, status FROM customers WHERE lower(email) = ? LIMIT 1"
  ).bind(customerEmail).first();
  if (customer) {
    if (customer.status !== "active" ||
        String(customer.company || "").trim().toLowerCase() !== institutionName.toLowerCase()) {
      return { error: "This contact email is already registered to another customer organization", status: 409 };
    }
  } else {
    if (await emailAlreadyRegistered(env, customerEmail)) {
      return { error: "This contact email is already registered to another account", status: 409 };
    }
    if (requestedOrganizationId) {
      return { error: "A new activation account cannot be linked to an existing organization without an invitation", status: 409 };
    }
    customer = { id: null };
  }

  let existingOrganization = null;
  if (customer.id) {
    const memberships = await env.DB.prepare(
      `SELECT o.id, o.name, o.legal_name
       FROM organization_members om
       JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
       WHERE om.account_type = 'customer' AND om.account_id = ? AND om.status = 'active'
       ${requestedOrganizationId ? "AND o.id = ?" : ""}
       ORDER BY o.id`
    ).bind(...(requestedOrganizationId ? [customer.id, requestedOrganizationId] : [customer.id])).all();
    if (requestedOrganizationId) {
      existingOrganization = memberships.results?.[0] || null;
    } else if (memberships.results?.length === 1) {
      existingOrganization = memberships.results[0];
    } else if ((memberships.results || []).length > 1) {
      return {
        error: "Select the organization for this license activation",
        status: 409,
        organization_options: memberships.results.map(({ id, name, legal_name }) => ({ id, name, legal_name })),
      };
    }
    if (!existingOrganization) {
      return { error: "This customer account has no active organization relationship", status: 409 };
    }
    if (existingOrganization.legal_name &&
        String(existingOrganization.legal_name).trim().toLowerCase() !== institutionName.toLowerCase()) {
      return { error: "The registered organization name does not match this activation registration", status: 409 };
    }
  }

  const generatedLicenseKey = `CLAIM-${makeToken().toUpperCase()}`;
  const newCustomerPasswordHash = customer.id ? null : await hashPassword(makeToken());
  const customerIdExpression = customer.id ? "?" : "(SELECT id FROM customers WHERE email = ?)";
  const customerIdBinding = customer.id ? customer.id : customerEmail;
  const organizationIdExpression = existingOrganization
    ? "?"
    : `(
    SELECT om.organization_id FROM organization_members om
    JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
    WHERE om.account_type = 'customer' AND om.account_id = ${customerIdExpression}
      AND om.status = 'active'
    GROUP BY om.account_id
    HAVING COUNT(*) = 1
  )`;
  const organizationIdBindings = existingOrganization ? [existingOrganization.id] : [customerIdBinding];
  const statements = [
    env.DB.prepare(
      `UPDATE license_code_inventory SET status = 'claiming'
       WHERE id = ? AND status = 'available'`
    ).bind(code.id),
  ];
  if (!customer.id) {
    statements.push(env.DB.prepare(
      `INSERT INTO customers (email, password_hash, name, phone, company, status)
       SELECT ?, ?, ?, ?, ?, 'active'
       WHERE EXISTS (
         SELECT 1 FROM license_code_inventory WHERE id = ? AND status = 'claiming'
       )`
    ).bind(customerEmail, newCustomerPasswordHash, contactName, phone, institutionName, code.id));
    statements.push(...customerIdentityStatements(
      env,
      "(SELECT id FROM customers WHERE email = ?)",
      [customerEmail],
      "active",
      "active",
      "customer",
    ));
  } else {
    statements.push(env.DB.prepare(
      `UPDATE customers SET name = COALESCE(NULLIF(name, ''), ?),
                            phone = COALESCE(NULLIF(phone, ''), ?)
       WHERE id = ? AND EXISTS (
         SELECT 1 FROM license_code_inventory WHERE id = ? AND status = 'claiming'
       )`
    ).bind(contactName, phone, customer.id, code.id));
  }
  if (code.assigned_partner_organization_id) {
    statements.push(env.DB.prepare(
      `INSERT INTO partner_customer_links
       (partner_organization_id, customer_organization_id, status)
       SELECT ?, om.organization_id, 'active'
       FROM organization_members om
       JOIN organizations customer_org ON customer_org.id = om.organization_id AND customer_org.status = 'active'
       JOIN relationships customer_relationship ON customer_relationship.organization_id = om.organization_id
         AND customer_relationship.relationship_type = 'customer' AND customer_relationship.status = 'active'
       WHERE om.account_type = 'customer' AND om.account_id = ${customerIdExpression}
         AND om.status = 'active'
         AND om.organization_id = ${organizationIdExpression}
         AND EXISTS (
           SELECT 1 FROM organizations partner
           JOIN relationships partner_relationship ON partner_relationship.organization_id = partner.id
           WHERE partner.id = ? AND partner.status = 'active'
             AND partner_relationship.status = 'active'
             AND partner_relationship.relationship_type IN ('channel_partner', 'reseller', 'distributor')
         )
         AND EXISTS (
           SELECT 1 FROM license_code_inventory
           WHERE id = ? AND status = 'claiming' AND assigned_partner_organization_id = ?
         )
        ON CONFLICT(partner_organization_id, customer_organization_id) DO NOTHING`
    ).bind(
       code.assigned_partner_organization_id,
       customerIdBinding,
       ...organizationIdBindings,
       code.assigned_partner_organization_id,
       code.id,
       code.assigned_partner_organization_id,
    ));
  }
  statements.push(env.DB.prepare(
    `UPDATE organizations
     SET legal_name = COALESCE(NULLIF(legal_name, ''), ?),
         address = COALESCE(NULLIF(address, ''), ?),
         city = COALESCE(NULLIF(city, ''), ?),
         state = COALESCE(NULLIF(state, ''), ?),
         pincode = COALESCE(NULLIF(pincode, ''), ?),
         tax_id = COALESCE(NULLIF(tax_id, ''), ?),
         website = COALESCE(NULLIF(website, ''), ?)
     WHERE id = ${organizationIdExpression}
       AND EXISTS (SELECT 1 FROM license_code_inventory WHERE id = ? AND status = 'claiming')`
  ).bind(institutionName, address, city, state, pincode, taxId, website, ...organizationIdBindings, code.id));
  statements.push(env.DB.prepare(
    `INSERT INTO licenses
     (customer_id, organization_id, product_id, license_key, serial_number, registered_email, seats, starts_at, expires_at, offline_validity_days, status)
     SELECT ${customerIdExpression}, ${organizationIdExpression}, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE'
     WHERE EXISTS (SELECT 1 FROM license_code_inventory WHERE id = ? AND status = 'claiming')`
  ).bind(
    customerIdBinding, ...organizationIdBindings, code.product_id, generatedLicenseKey, code.serial_number, customerEmail, code.seats,
    code.starts_at, code.expires_at, code.offline_validity_days, code.id,
  ));
  statements.push(env.DB.prepare(
    `INSERT INTO license_editions (license_id, edition_id)
     SELECT id, ? FROM licenses WHERE license_key = ?`
  ).bind(code.edition_id, generatedLicenseKey));
  const entitlements = [
    { key: "company.binding", value_type: "text", value_text: companyBinding, value_number: null },
    { key: "license.model", value_type: "text", value_text: code.license_model, value_number: null },
  ];
  for (const entitlement of entitlements) {
    statements.push(env.DB.prepare(
      `INSERT INTO license_entitlements (license_id, entitlement_key, value_type, value_text, value_number)
       SELECT id, ?, ?, ?, ? FROM licenses WHERE license_key = ?`
    ).bind(entitlement.key, entitlement.value_type, entitlement.value_text, entitlement.value_number, generatedLicenseKey));
  }
  statements.push(env.DB.prepare(
    `INSERT INTO license_events (license_id, organization_id, event_type, new_status, metadata_json)
     SELECT l.id, l.organization_id, 'LICENSE_CREATED', l.status, ?
     FROM licenses l WHERE l.license_key = ?`
  ).bind(JSON.stringify({
    source: "activation_code_claim",
    batch_id: code.batch_id,
    partner_organization_id: code.assigned_partner_organization_id || null,
  }), generatedLicenseKey));
  statements.push(env.DB.prepare(
    `UPDATE license_code_inventory
     SET status = 'claimed',
         license_id = (SELECT id FROM licenses WHERE license_key = ?),
         company_binding = ?,
         installation_id = ?,
         activation_identifier = ?,
         contact_email = ?,
         delivery_status = 'issued',
         issued_to_name = ?,
         issued_to_organization = ?,
         issued_to_email = ?,
         delivery_channel = 'activation',
         issued_at = datetime('now'),
         claimed_at = datetime('now')
     WHERE id = ? AND status = 'claiming'`
  ).bind(
    generatedLicenseKey, companyBinding, installationId, activationIdentifier, customerEmail,
    contactName, institutionName, customerEmail, code.id,
  ));
  statements.push(env.DB.prepare(
    `INSERT INTO audit_logs
     (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
     SELECT NULL, l.organization_id, 'LICENSE_CODE_CLAIMED', 'license_code', ?, NULL, ?, NULL
     FROM licenses l
     WHERE l.license_key = ? AND EXISTS (
       SELECT 1 FROM license_code_inventory
       WHERE id = ? AND status = 'claimed' AND license_id = (SELECT id FROM licenses WHERE license_key = ?)
     )`
  ).bind(code.serial_number, JSON.stringify({
    product_id: code.product_id,
    edition_id: code.edition_id,
    contact_email: customerEmail,
    partner_organization_id: code.assigned_partner_organization_id || null,
    delivery_status: "issued",
    issued_to_name: contactName,
    issued_to_organization: institutionName,
    delivery_channel: "activation",
  }), generatedLicenseKey, code.id, generatedLicenseKey));

  const results = await env.DB.batch(statements);
  const claimChanges = Number(results?.[0]?.meta?.changes || 0);
  const finalizeChanges = Number(results?.[results.length - 2]?.meta?.changes || 0);
  const licenseId = await env.DB.prepare(
    "SELECT license_id FROM license_code_inventory WHERE id = ? AND status = 'claimed'"
  ).bind(code.id).first();
  if (claimChanges !== 1 || finalizeChanges !== 1 || !licenseId?.license_id) {
    return { error: "This activation code was claimed by another request; retry with the same installation", status: 409 };
  }
  return { license_id: licenseId.license_id };
}

async function activateLicense(request, env, origin) {
  const rateLimit = await requireRateLimit(env, request, "license-activation", 20, 60);
  if (rateLimit) return rateLimit;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A JSON activation request is required" }, 400, origin);
  }
  const licenseKey = boundedString(body?.license_key, 200);
  const serialNumber = boundedString(body?.serial_number, 80)?.toUpperCase() || null;
  const activationKey = boundedString(body?.activation_key, 100)?.toUpperCase() || null;
  const productCode = boundedString(body?.product_code, 100);
  const installationId = boundedString(body?.installation_id, 36);
  const activationIdentifier = boundedString(body?.activation_identifier, 36);
  const companyBinding = body?.company_binding == null ? null : boundedString(body.company_binding, 128);
  const refreshPublicKey = boundedString(body?.refresh_public_key, 100);
  const refreshPublicKeyBytes = decodeBase64Url(refreshPublicKey);
  const emailChallengeId = boundedString(body?.email_challenge_id, 36);
  const activationEmail = validEmail(body?.email);
  const requestedLicenseId = numericId(body?.license_id);
  const usesActivationCode = Boolean(serialNumber || activationKey);
  const usesEmailVerification = Boolean(emailChallengeId || activationEmail || requestedLicenseId);
  if ((!licenseKey && !usesActivationCode && !usesEmailVerification) ||
      (usesActivationCode && (!serialNumber || !activationKey || licenseKey || usesEmailVerification)) ||
      (usesEmailVerification && (!emailChallengeId || !activationEmail || !requestedLicenseId || licenseKey)) ||
      (licenseKey && usesActivationCode) ||
      !productCode || !UUID_PATTERN.test(installationId || "") || !UUID_PATTERN.test(activationIdentifier || "")) {
    return json({ ok: false, error: "Provide a license key, serial and activation key, or verified email activation details with product and installation identifiers" }, 400, origin);
  }
  if (usesActivationCode && !/^(?:\d{1,9}|SMR-LIC-(?:\d{8}|[A-F0-9]{20}))$/.test(serialNumber)) {
    return json({ ok: false, error: "The serial number format is invalid" }, 400, origin);
  }
  if (usesActivationCode && !/^(?:[A-Z0-9]{16}|ACT-[A-F0-9]{48})$/.test(activationKey)) {
    return json({ ok: false, error: "The activation key format is invalid" }, 400, origin);
  }
  if (!refreshPublicKeyBytes || refreshPublicKeyBytes.length !== 32) {
    return json({ ok: false, error: "A valid Ed25519 refresh public key is required" }, 400, origin);
  }
  if (body?.company_binding != null && !companyBinding) {
    return json({ ok: false, error: "Company binding must be a non-empty string of at most 128 characters" }, 400, origin);
  }

  let emailChallenge = null;
  if (usesEmailVerification) {
    emailChallenge = await env.DB.prepare(
      `SELECT challenge_id, email, product_code, company_binding, verified_at, consumed_at
       FROM license_email_verifications
       WHERE challenge_id = ? AND purpose = 'activation' AND expires_at > datetime('now')`
    ).bind(emailChallengeId).first();
    if (!emailChallenge || emailChallenge.email !== activationEmail ||
        emailChallenge.product_code !== productCode || emailChallenge.company_binding !== companyBinding ||
        !emailChallenge.verified_at || emailChallenge.consumed_at) {
      return json({ ok: false, error: "Email verification is invalid or expired" }, 403, origin);
    }
  }

  let license;
  if (usesActivationCode) {
    const registration = body.registration;
    const claim = await claimLicenseCode(env, {
      serialNumber,
      activationKey,
      productCode,
      companyBinding,
      installationId,
      activationIdentifier,
      registration,
    });
    if (claim.error) {
      return json({
        ok: false,
        error: claim.error,
        ...(claim.organization_options ? { organization_options: claim.organization_options } : {}),
      }, claim.status, origin);
    }
    license = await env.DB.prepare(
      `SELECT l.id, l.customer_id, l.product_id, l.license_key, l.serial_number,
              l.offline_validity_days, l.seats, l.status, l.starts_at, l.expires_at,
              l.registered_email, c.email AS customer_email,
              p.slug AS product_code, p.billing_period,
              le.edition_id, pe.code AS edition_code, l.organization_id
       FROM licenses l
       JOIN products p ON p.id = l.product_id
       JOIN organizations o ON o.id = l.organization_id AND o.status = 'active'
       LEFT JOIN customers c ON c.id = l.customer_id
       LEFT JOIN license_editions le ON le.license_id = l.id
       LEFT JOIN product_editions pe ON pe.id = le.edition_id
       WHERE l.id = ? AND p.slug = ?`
    ).bind(claim.license_id, productCode).first();
  } else {
    license = await env.DB.prepare(
      `SELECT l.id, l.customer_id, l.product_id, l.license_key, l.serial_number,
              l.offline_validity_days, l.seats, l.status, l.starts_at, l.expires_at,
              l.registered_email, c.email AS customer_email,
              p.slug AS product_code, p.billing_period,
            le.edition_id, pe.code AS edition_code, l.organization_id
       FROM licenses l
       JOIN products p ON p.id = l.product_id
       JOIN organizations o ON o.id = l.organization_id AND o.status = 'active'
       LEFT JOIN customers c ON c.id = l.customer_id
       LEFT JOIN license_editions le ON le.license_id = l.id
       LEFT JOIN product_editions pe ON pe.id = le.edition_id
       WHERE l.license_key = ? AND p.slug = ?`
    ).bind(licenseKey, productCode).first();
  }
  if (usesEmailVerification) {
    license = await env.DB.prepare(
      `SELECT l.id, l.customer_id, l.product_id, l.license_key, l.serial_number,
              l.offline_validity_days, l.seats, l.status, l.starts_at, l.expires_at,
              l.registered_email, c.email AS customer_email,
              p.slug AS product_code, p.billing_period, le.edition_id, pe.code AS edition_code,
              l.organization_id
       FROM licenses l
       JOIN products p ON p.id = l.product_id
       JOIN organizations o ON o.id = l.organization_id AND o.status = 'active'
       LEFT JOIN customers c ON c.id = l.customer_id
       LEFT JOIN license_editions le ON le.license_id = l.id
       LEFT JOIN product_editions pe ON pe.id = le.edition_id
       WHERE l.id = ? AND p.slug = ? AND l.status = 'ACTIVE'
         AND lower(l.registered_email) = lower(?)`
    ).bind(requestedLicenseId, productCode, activationEmail).first();
  }
  if (!license) return json({ ok: false, error: "License not found for this product" }, 404, origin);
  if (license.status === "DRAFT") {
    return json({ ok: false, error: "Draft licenses cannot be activated" }, 409, origin);
  }
  license.registered_email = license.registered_email || license.customer_email || null;
  if (license.registered_email) {
    await env.DB.prepare(
      "UPDATE licenses SET registered_email = ? WHERE id = ? AND registered_email IS NULL"
    ).bind(license.registered_email, license.id).run();
  }

  const existing = await env.DB.prepare(
    `SELECT id, installation_id, status FROM license_activations
     WHERE license_id = ? AND activation_identifier = ?`
  ).bind(license.id, activationIdentifier).first();
  if (existing && (existing.installation_id !== installationId || existing.status !== "active")) {
    return json({ ok: false, error: "Activation identifier is already bound or revoked" }, 409, origin);
  }
  const activeCount = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM license_activations WHERE license_id = ? AND status = 'active'"
  ).bind(license.id).first();
  if (!existing && Number(activeCount?.count || 0) >= Number(license.seats || 1)) {
    return json({ ok: false, error: "The license activation limit has been reached" }, 409, origin);
  }

  const entitlementRows = await env.DB.prepare(
    `SELECT entitlement_key, value_type, value_text, value_number
     FROM license_entitlements WHERE license_id = ? ORDER BY entitlement_key`
  ).bind(license.id).all();
  const entitlements = Object.fromEntries((entitlementRows.results || []).map((row) => {
    const parsed = parseEntitlement(row);
    return [parsed.key, parsed];
  }));
  const expectedCompanyBinding = entitlements["company.binding"]?.value;
  if (
    typeof expectedCompanyBinding !== "string" ||
    !expectedCompanyBinding.trim() ||
    expectedCompanyBinding !== companyBinding
  ) {
    return json({ ok: false, error: "License is not registered for this company" }, 404, origin);
  }

  const signed = await buildSignedLicenseArtifact(
    env, license, installationId, activationIdentifier, companyBinding, entitlements, license.status,
  );
  if (signed.error) return json({ ok: false, error: signed.error }, signed.status, origin);

  const metadata = JSON.stringify({ source: "signed_license_activation", company_binding: companyBinding });
  const activationStatements = [];
  if (emailChallenge) {
    activationStatements.push(env.DB.prepare(
      `UPDATE license_email_verifications
       SET consumed_at = datetime('now'), installation_id = ?, activation_identifier = ?
       WHERE challenge_id = ? AND purpose = 'activation' AND email = ?
         AND product_code = ? AND company_binding = ?
         AND verified_at IS NOT NULL AND consumed_at IS NULL
         AND expires_at > datetime('now')`
    ).bind(installationId, activationIdentifier, emailChallengeId, activationEmail, productCode, companyBinding));
  }
  activationStatements.push(
    env.DB.prepare(
      `INSERT OR IGNORE INTO license_activations
       (license_id, installation_id, activation_identifier, refresh_public_key, metadata_json)
       SELECT ?, ?, ?, ?, ?
       WHERE (? IS NULL OR EXISTS (
         SELECT 1 FROM license_email_verifications
         WHERE challenge_id = ? AND purpose = 'activation' AND consumed_at IS NOT NULL
           AND installation_id = ? AND activation_identifier = ?
       ))
       AND (EXISTS (
         SELECT 1 FROM license_activations
         WHERE license_id = ? AND activation_identifier = ? AND installation_id = ? AND status = 'active'
       ) OR (
         SELECT COUNT(*) FROM license_activations WHERE license_id = ? AND status = 'active'
       ) < ?)`
    ).bind(
      license.id, installationId, activationIdentifier, refreshPublicKey, metadata,
      emailChallenge ? emailChallengeId : null, emailChallengeId, installationId, activationIdentifier,
      license.id, activationIdentifier, installationId, license.id, Number(license.seats || 1),
    ),
    env.DB.prepare(
      `UPDATE license_activations SET last_seen_at = datetime('now'), refresh_public_key = ?
       WHERE license_id = ? AND activation_identifier = ? AND installation_id = ? AND status = 'active'`
    ).bind(refreshPublicKey, license.id, activationIdentifier, installationId),
    env.DB.prepare(
      `INSERT INTO license_artifacts
       (document_id, license_id, installation_id, activation_identifier, key_id, algorithm, payload_base64url, signature_base64url, issued_at)
       SELECT ?, ?, ?, ?, ?, 'Ed25519', ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM license_activations
         WHERE license_id = ? AND activation_identifier = ? AND installation_id = ? AND status = 'active'
       )`
    ).bind(signed.document_id, license.id, installationId, activationIdentifier, signed.key_id, signed.payload, signed.signature, signed.issued_at, license.id, activationIdentifier, installationId),
  );
  const artifactResult = await env.DB.batch(activationStatements);
  const artifactInsertIndex = emailChallenge ? 3 : 2;
  if ((emailChallenge && Number(artifactResult?.[0]?.meta?.changes || 0) !== 1) ||
      Number(artifactResult?.[artifactInsertIndex]?.meta?.changes || 0) !== 1) {
    return json({ ok: false, error: "The license activation limit was reached during registration" }, 409, origin);
  }

  if (!existing) {
    await recordLicenseEvent(env, { id: license.id, organization_id: license.organization_id }, null,
      "ACTIVATION_CREATED", license.status, license.status,
      { installation_id: installationId, activation_identifier: activationIdentifier, artifact_id: signed.document_id });
  }
  await writeAudit(env, request, { person_id: null, organization_id: license.organization_id },
    "LICENSE_ARTIFACT_ISSUED", "license_artifact", signed.document_id, null,
    { license_id: license.id, installation_id: installationId, key_id: signed.key_id });

  return json({
    ok: true,
    registered_email: license.registered_email,
    artifact: {
      document_id: signed.document_id,
      algorithm: "Ed25519",
      key_id: signed.key_id,
      payload: signed.payload,
      signature: signed.signature,
    },
  }, 201, origin);
}

async function refreshLicense(request, env, origin) {
  const rateLimit = await requireRateLimit(env, request, "license-refresh", 20, 60);
  if (rateLimit) return rateLimit;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A JSON refresh request is required" }, 400, origin);
  }
  const productCode = boundedString(body?.product_code, 100);
  const installationId = boundedString(body?.installation_id, 36);
  const activationIdentifier = boundedString(body?.activation_identifier, 36);
  const companyBinding = boundedString(body?.company_binding, 128);
  const timestamp = Number(body?.timestamp);
  const nonce = boundedString(body?.nonce, 36);
  const signature = decodeBase64Url(body?.signature);
  if (
    !productCode ||
    !UUID_PATTERN.test(installationId || "") ||
    !UUID_PATTERN.test(activationIdentifier || "") ||
    !companyBinding ||
    !Number.isSafeInteger(timestamp) ||
    Math.abs(Date.now() - timestamp) > 5 * 60 * 1000 ||
    !UUID_PATTERN.test(nonce || "") ||
    !signature ||
    signature.length !== 64
  ) {
    return json({ ok: false, error: "The signed refresh request is invalid or expired" }, 400, origin);
  }

  const activationMatches = await env.DB.prepare(
    `SELECT l.id, l.customer_id, l.product_id, l.serial_number, l.offline_validity_days,
            l.status, l.starts_at, l.expires_at, l.seats,
            p.slug AS product_code, p.billing_period, le.edition_id, pe.code AS edition_code,
            l.organization_id, la.status AS activation_status, la.refresh_public_key
     FROM licenses l
     JOIN products p ON p.id = l.product_id
     JOIN organizations o ON o.id = l.organization_id AND o.status = 'active'
     JOIN license_activations la ON la.license_id = l.id
       AND la.installation_id = ? AND la.activation_identifier = ?
     JOIN license_entitlements e ON e.license_id = l.id
       AND e.entitlement_key = 'company.binding' AND e.value_text = ?
     LEFT JOIN license_editions le ON le.license_id = l.id
     LEFT JOIN product_editions pe ON pe.id = le.edition_id
     WHERE p.slug = ? LIMIT 2`
  ).bind(installationId, activationIdentifier, companyBinding, productCode).all();
  if ((activationMatches.results || []).length > 1) {
    return json({ ok: false, error: "License activation details are ambiguous" }, 409, origin);
  }
  const license = activationMatches.results?.[0] || null;
  if (!license || license.product_code !== productCode) {
    return json({ ok: false, error: "License activation not found" }, 404, origin);
  }

  const entitlementRows = await env.DB.prepare(
    `SELECT entitlement_key, value_type, value_text, value_number
     FROM license_entitlements WHERE license_id = ? ORDER BY entitlement_key`
  ).bind(license.id).all();
  const entitlements = Object.fromEntries((entitlementRows.results || []).map((row) => {
    const parsed = parseEntitlement(row);
    return [parsed.key, parsed];
  }));
  if (entitlements["company.binding"]?.value !== companyBinding) {
    return json({ ok: false, error: "License is not registered for this company" }, 404, origin);
  }

  const publicKeyBytes = decodeBase64Url(license.refresh_public_key);
  if (!publicKeyBytes || publicKeyBytes.length !== 32) {
    return json({ ok: false, error: "Installation refresh credentials are not registered" }, 409, origin);
  }
  const message = new TextEncoder().encode([
    productCode, companyBinding, installationId, activationIdentifier, timestamp, nonce,
  ].join("\n"));
  try {
    const publicKey = await crypto.subtle.importKey("raw", publicKeyBytes, { name: "Ed25519" }, false, ["verify"]);
    if (!(await crypto.subtle.verify({ name: "Ed25519" }, publicKey, signature, message))) {
      return json({ ok: false, error: "Installation refresh signature is invalid" }, 403, origin);
    }
  } catch (error) {
    console.error("Installation refresh signature verification failed", error);
    return json({ ok: false, error: "Installation refresh signature could not be verified" }, 403, origin);
  }

  await env.DB.prepare(
    "DELETE FROM license_refresh_nonces WHERE created_at < datetime('now', '-10 minutes')"
  ).run();
  const nonceResult = await env.DB.prepare(
    `INSERT OR IGNORE INTO license_refresh_nonces (license_id, activation_identifier, nonce)
     VALUES (?, ?, ?)`
  ).bind(license.id, activationIdentifier, nonce).run();
  if (Number(nonceResult?.meta?.changes || 0) !== 1) {
    return json({ ok: false, error: "Refresh request has already been used" }, 409, origin);
  }

  const effectiveStatus = license.activation_status === "revoked" ? "SUSPENDED" : license.status;
  const signed = await buildSignedLicenseArtifact(
    env, license, installationId, activationIdentifier, companyBinding, entitlements, effectiveStatus,
  );
  if (signed.error) return json({ ok: false, error: signed.error }, signed.status, origin);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO license_artifacts
       (document_id, license_id, installation_id, activation_identifier, key_id, algorithm, payload_base64url, signature_base64url, issued_at)
       VALUES (?, ?, ?, ?, ?, 'Ed25519', ?, ?, ?)`
    ).bind(signed.document_id, license.id, installationId, activationIdentifier,
      signed.key_id, signed.payload, signed.signature, signed.issued_at),
    env.DB.prepare(
      `UPDATE license_activations SET last_seen_at = datetime('now')
       WHERE license_id = ? AND installation_id = ? AND activation_identifier = ? AND status = 'active'`
    ).bind(license.id, installationId, activationIdentifier),
  ]);
  await writeAudit(env, request, { person_id: null, organization_id: license.organization_id },
    "LICENSE_ARTIFACT_REFRESHED", "license_artifact", signed.document_id, null,
    { license_id: license.id, installation_id: installationId, activation_identifier: activationIdentifier, key_id: signed.key_id });

  return json({
    ok: true,
    artifact: {
      document_id: signed.document_id,
      algorithm: "Ed25519",
      key_id: signed.key_id,
      payload: signed.payload,
      signature: signed.signature,
    },
  }, 200, origin);
}

async function manageLicenseActivation(request, env, origin) {
  const rateLimit = await requireRateLimit(env, request, "license-management", 10, 60);
  if (rateLimit) return rateLimit;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A JSON license management request is required" }, 400, origin);
  }
  const action = body?.action;
  const productCode = boundedString(body?.product_code, 100);
  const installationId = boundedString(body?.installation_id, 36);
  const activationIdentifier = boundedString(body?.activation_identifier, 36);
  const companyBinding = boundedString(body?.company_binding, 128);
  const timestamp = Number(body?.timestamp);
  const nonce = boundedString(body?.nonce, 36);
  const signature = decodeBase64Url(body?.signature);
  if (
    action !== "deactivate" ||
    !productCode ||
    !UUID_PATTERN.test(installationId || "") ||
    !UUID_PATTERN.test(activationIdentifier || "") ||
    !companyBinding ||
    !Number.isSafeInteger(timestamp) ||
    Math.abs(Date.now() - timestamp) > 5 * 60 * 1000 ||
    !UUID_PATTERN.test(nonce || "") ||
    !signature ||
    signature.length !== 64
  ) {
    return json({ ok: false, error: "The signed license management request is invalid or expired" }, 400, origin);
  }
  const activationMatches = await env.DB.prepare(
    `SELECT l.id, l.status, l.last_self_service_transfer_at,
            p.slug AS product_code, l.organization_id,
            la.status AS activation_status, la.refresh_public_key
     FROM licenses l
     JOIN products p ON p.id = l.product_id
     JOIN organizations o ON o.id = l.organization_id AND o.status = 'active'
     JOIN license_activations la ON la.license_id = l.id
       AND la.installation_id = ? AND la.activation_identifier = ?
     JOIN license_entitlements e ON e.license_id = l.id
       AND e.entitlement_key = 'company.binding' AND e.value_text = ?
     WHERE p.slug = ? LIMIT 2`
  ).bind(installationId, activationIdentifier, companyBinding, productCode).all();
  if ((activationMatches.results || []).length > 1) {
    return json({ ok: false, error: "License activation details are ambiguous" }, 409, origin);
  }
  const license = activationMatches.results?.[0] || null;
  if (!license || license.product_code !== productCode) {
    return json({ ok: false, error: "License activation not found" }, 404, origin);
  }
  if (license.status !== "ACTIVE" || license.activation_status !== "active") {
    return json({ ok: false, error: "This license activation is not active" }, 409, origin);
  }
  const publicKeyBytes = decodeBase64Url(license.refresh_public_key);
  if (!publicKeyBytes || publicKeyBytes.length !== 32) {
    return json({ ok: false, error: "Installation management credentials are not registered" }, 409, origin);
  }
  const message = new TextEncoder().encode([
    "license-management-v1", action, productCode, companyBinding,
    installationId, activationIdentifier, timestamp, nonce,
  ].join("\n"));
  try {
    const publicKey = await crypto.subtle.importKey("raw", publicKeyBytes, { name: "Ed25519" }, false, ["verify"]);
    if (!(await crypto.subtle.verify({ name: "Ed25519" }, publicKey, signature, message))) {
      return json({ ok: false, error: "Installation management signature is invalid" }, 403, origin);
    }
  } catch (error) {
    console.error("Installation management signature verification failed", error);
    return json({ ok: false, error: "Installation management signature could not be verified" }, 403, origin);
  }

  const cooldown = await env.DB.prepare(
    `SELECT datetime(last_self_service_transfer_at, '+30 days') AS transfer_available_at
     FROM licenses
     WHERE id = ? AND last_self_service_transfer_at IS NOT NULL
       AND julianday(last_self_service_transfer_at) > julianday('now', '-30 days')`
  ).bind(license.id).first();
  if (cooldown) {
    return json({
      ok: false,
      error: "Self-service device transfer is temporarily unavailable. Contact the license administrator for assistance.",
      transfer_available_at: cooldown.transfer_available_at,
    }, 429, origin);
  }

  await env.DB.prepare(
    "DELETE FROM license_refresh_nonces WHERE created_at < datetime('now', '-10 minutes')"
  ).run();
  const nonceResult = await env.DB.prepare(
    `INSERT OR IGNORE INTO license_refresh_nonces (license_id, activation_identifier, nonce)
     VALUES (?, ?, ?)`
  ).bind(license.id, activationIdentifier, nonce).run();
  if (Number(nonceResult?.meta?.changes || 0) !== 1) {
    return json({ ok: false, error: "License management request has already been used" }, 409, origin);
  }
  const deactivationResults = await env.DB.batch([
    env.DB.prepare(
      `UPDATE licenses SET last_self_service_transfer_at = datetime('now'),
                           last_self_service_transfer_id = ?
       WHERE id = ?
         AND (last_self_service_transfer_at IS NULL
              OR julianday(last_self_service_transfer_at) <= julianday('now', '-30 days'))
         AND EXISTS (
           SELECT 1 FROM license_activations
           WHERE license_id = ? AND installation_id = ?
             AND activation_identifier = ? AND status = 'active'
         )`
    ).bind(nonce, license.id, license.id, installationId, activationIdentifier),
    env.DB.prepare(
      `UPDATE license_activations SET status = 'revoked', deactivated_at = datetime('now')
       WHERE license_id = ? AND installation_id = ? AND activation_identifier = ? AND status = 'active'
         AND EXISTS (
           SELECT 1 FROM licenses
           WHERE id = ? AND last_self_service_transfer_id = ?
         )`
    ).bind(license.id, installationId, activationIdentifier, license.id, nonce),
  ]);
  if (Number(deactivationResults?.[0]?.meta?.changes || 0) !== 1 ||
      Number(deactivationResults?.[1]?.meta?.changes || 0) !== 1) {
    const activeCooldown = await env.DB.prepare(
      `SELECT datetime(last_self_service_transfer_at, '+30 days') AS transfer_available_at
       FROM licenses
       WHERE id = ? AND last_self_service_transfer_at IS NOT NULL
         AND julianday(last_self_service_transfer_at) > julianday('now', '-30 days')`
    ).bind(license.id).first();
    if (activeCooldown) {
      return json({
        ok: false,
        error: "Self-service device transfer is temporarily unavailable. Contact the license administrator for assistance.",
        transfer_available_at: activeCooldown.transfer_available_at,
      }, 429, origin);
    }
    return json({ ok: false, error: "License activation could not be deactivated" }, 409, origin);
  }
  const transferPolicy = await env.DB.prepare(
    "SELECT datetime(last_self_service_transfer_at, '+30 days') AS transfer_available_at FROM licenses WHERE id = ?"
  ).bind(license.id).first();
  await recordLicenseEvent(env, { id: license.id, organization_id: license.organization_id }, null,
    "ACTIVATION_REVOKED", license.status, license.status,
    {
      installation_id: installationId,
      activation_identifier: activationIdentifier,
      source: "customer_self_deactivation",
      transfer_available_at: transferPolicy?.transfer_available_at || null,
    });
  await writeAudit(env, request, { person_id: null, organization_id: license.organization_id },
    "LICENSE_ACTIVATION_DEACTIVATED", "license", license.id, null,
    {
      installation_id: installationId,
      activation_identifier: activationIdentifier,
      transfer_available_at: transferPolicy?.transfer_available_at || null,
    });
  return json({
    ok: true,
    deactivated: true,
    transfer_available_at: transferPolicy?.transfer_available_at || null,
  }, 200, origin);
}

async function requireSuperAdmin(request, env) {
  const session = await requirePermission(request, env, "admin.system");
  if (!session || session.account_type !== "user" || session.member_role !== "super_admin") return null;
  return session;
}

async function handleProducts(request, env, productId = null) {
  const permission = request.method === "GET" ? "license.view" : "license.create";
  const principal = await requirePermission(request, env, permission);
  if (!principal) return json({ ok: false, error: "Product permission required" }, 403);

  if (productId && request.method === "GET") {
    const product = await env.DB.prepare(
      `SELECT id, slug AS code, name, description, status, created_at
       FROM products WHERE id = ?`
    ).bind(productId).first();
    if (!product) return json({ ok: false, error: "Product not found" }, 404);
    const { results: editions } = await env.DB.prepare(
      `SELECT id, product_id, code, name, description, status, created_at, updated_at
       FROM product_editions WHERE product_id = ? ORDER BY code`
    ).bind(productId).all();
    return json({ ok: true, product: { ...product, editions } });
  }

  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, slug AS code, name, description, status, created_at FROM products ORDER BY name`
    ).all();
    return json({ ok: true, products: results });
  }

  const body = await request.json();
  const code = typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(code) || !name || name.length > 120) {
    return json({ ok: false, error: "A valid product code and name are required" }, 400);
  }
  try {
    const result = await env.DB.prepare(
      `INSERT INTO products (slug, name, description, price, billing_period, status)
       VALUES (?, ?, ?, 0, 'one_time', 'active')`
    ).bind(code, name, String(body.description || "").slice(0, 2000) || null).run();
    await writeAudit(env, request, principal, "PRODUCT_CREATED", "product", result.meta.last_row_id, null, { code, name });
    return json({ ok: true, product_id: result.meta.last_row_id }, 201);
  } catch (error) {
    if (String(error).includes("UNIQUE")) return json({ ok: false, error: "Product code already exists" }, 409);
    throw error;
  }
}

async function handleEditions(request, env, productId) {
  const id = numericId(productId);
  if (!id) return json({ ok: false, error: "A valid product id is required" }, 400);
  const permission = request.method === "GET" ? "license.view" : "license.create";
  const principal = await requirePermission(request, env, permission);
  if (!principal) return json({ ok: false, error: "Edition permission required" }, 403);
  const product = await env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(id).first();
  if (!product) return json({ ok: false, error: "Product not found" }, 404);
  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, product_id, code, name, description, status, created_at, updated_at
       FROM product_editions WHERE product_id = ? ORDER BY code`
    ).bind(id).all();
    return json({ ok: true, editions: results });
  }
  const body = await request.json();
  const code = typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(code) || !name || name.length > 120) {
    return json({ ok: false, error: "A valid edition code and name are required" }, 400);
  }
  try {
    const result = await env.DB.prepare(
      `INSERT INTO product_editions (product_id, code, name, description)
       VALUES (?, ?, ?, ?)`
    ).bind(id, code, name, String(body.description || "").slice(0, 2000) || null).run();
    await writeAudit(env, request, principal, "EDITION_CREATED", "product_edition", result.meta.last_row_id, null, { product_id: id, code, name });
    return json({ ok: true, edition_id: result.meta.last_row_id }, 201);
  } catch (error) {
    if (String(error).includes("UNIQUE")) return json({ ok: false, error: "Edition code already exists" }, 409);
    throw error;
  }
}

async function handlePublicLicenseKeys(env) {
  let publicKeys;
  try {
    publicKeys = JSON.parse(env.LICENSE_SIGNING_PUBLIC_KEYS || "{}");
  } catch {
    return json({ ok: false, error: "License verification keys are not configured correctly" }, 503);
  }
  if (!publicKeys || typeof publicKeys !== "object" || Array.isArray(publicKeys)) {
    return json({ ok: false, error: "License verification keys are not configured correctly" }, 503);
  }
  const keys = [];
  for (const [keyId, encodedKey] of Object.entries(publicKeys)) {
    const key = decodeBase64Url(encodedKey);
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(keyId) || !key || key.length !== 32) {
      return json({ ok: false, error: "A configured license verification key is invalid" }, 503);
    }
    keys.push({ key_id: keyId, algorithm: "Ed25519", public_key: encodedKey });
  }
  return json({ ok: true, keys });
}

async function handleEditionLicensePolicy(request, env, productId, editionId) {
  const productNumericId = numericId(productId);
  const editionNumericId = numericId(editionId);
  if (!productNumericId || !editionNumericId) return json({ ok: false, error: "A valid product and edition id are required" }, 400);
  const permission = request.method === "GET" ? "license.view" : "license.manage_entitlements";
  const principal = await requirePermission(request, env, permission);
  if (!principal) return json({ ok: false, error: "Edition license policy permission required" }, 403);
  const edition = await env.DB.prepare(
    "SELECT id, product_id FROM product_editions WHERE id = ? AND product_id = ?"
  ).bind(editionNumericId, productNumericId).first();
  if (!edition) return json({ ok: false, error: "Edition not found" }, 404);

  if (request.method === "GET") {
    const policy = await env.DB.prepare(
      `SELECT subscription_grace_days, rollout_stage, evaluation_policy_json, updated_at
       FROM product_edition_license_policies WHERE edition_id = ?`
    ).bind(editionNumericId).first();
    let evaluationPolicy = DEFAULT_EVALUATION_POLICY;
    if (policy?.evaluation_policy_json) {
      try {
        evaluationPolicy = { ...DEFAULT_EVALUATION_POLICY, ...JSON.parse(policy.evaluation_policy_json) };
      } catch (error) {
        console.error("Invalid edition evaluation policy", error);
        return json({ ok: false, error: "Edition evaluation policy is invalid" }, 503);
      }
    }
    return json({
      ok: true,
      policy: {
        subscription_grace_days: Number(policy?.subscription_grace_days ?? 7),
        rollout_stage: policy?.rollout_stage || "shadow",
        evaluation_policy: evaluationPolicy,
        updated_at: policy?.updated_at || null,
      },
    });
  }

  if (request.method !== "PUT") return json({ ok: false, error: "Unsupported edition license policy operation" }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A JSON policy is required" }, 400);
  }
  const graceDays = Number(body?.subscription_grace_days);
  const rolloutStage = body?.rollout_stage;
  const evaluationPolicy = body?.evaluation_policy;
  const policyBooleanKeys = ["allow_dashboard", "allow_read_only_records", "allow_reports", "allow_backups", "allow_exports"];
  const lockedModules = evaluationPolicy?.locked_modules;
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 30 ||
      !["shadow", "enforced"].includes(rolloutStage) ||
      !evaluationPolicy || typeof evaluationPolicy !== "object" || Array.isArray(evaluationPolicy) ||
      policyBooleanKeys.some((key) => typeof evaluationPolicy[key] !== "boolean") ||
      !Array.isArray(lockedModules) || lockedModules.length > 50 ||
      lockedModules.some((module) => typeof module !== "string" || !/^[a-z][a-z0-9_.-]{0,63}$/.test(module))) {
    return json({ ok: false, error: "The evaluation policy contains invalid values" }, 400);
  }
  const savedPolicy = {
    allow_dashboard: evaluationPolicy.allow_dashboard,
    allow_read_only_records: evaluationPolicy.allow_read_only_records,
    allow_reports: evaluationPolicy.allow_reports,
    allow_backups: evaluationPolicy.allow_backups,
    allow_exports: evaluationPolicy.allow_exports,
    locked_modules: [...new Set(lockedModules)],
  };
  await env.DB.prepare(
    `INSERT INTO product_edition_license_policies
     (edition_id, subscription_grace_days, rollout_stage, evaluation_policy_json, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(edition_id) DO UPDATE SET
       subscription_grace_days = excluded.subscription_grace_days,
       rollout_stage = excluded.rollout_stage,
       evaluation_policy_json = excluded.evaluation_policy_json,
       updated_by = excluded.updated_by,
       updated_at = datetime('now')`
  ).bind(editionNumericId, graceDays, rolloutStage, JSON.stringify(savedPolicy), principal.person_id).run();
  await writeAudit(env, request, principal, "EDITION_LICENSE_POLICY_UPDATED", "product_edition", editionNumericId, null, {
    subscription_grace_days: graceDays,
    rollout_stage: rolloutStage,
    evaluation_policy: savedPolicy,
  });
  return json({ ok: true, policy: { subscription_grace_days: graceDays, rollout_stage: rolloutStage, evaluation_policy: savedPolicy } });
}

async function listLicenses(request, env) {
  const principal = await requirePermission(request, env, "license.view");
  if (!principal) return json({ ok: false, error: "License permission required" }, 403);
  const filter = principal.account_type === "customer" ? "AND l.organization_id = ?" : "";
  const bindings = principal.account_type === "customer" ? [principal.organization_id] : [];
  const { results } = await env.DB.prepare(
    `SELECT l.id, l.license_key, l.customer_id, l.product_id, l.status, l.starts_at, l.expires_at,
            l.organization_id, p.slug AS product_code, p.name AS product_name,
            le.edition_id, pe.code AS edition_code, pe.name AS edition_name,
            (SELECT COUNT(*) FROM license_activations la WHERE la.license_id = l.id AND la.status = 'active') AS activation_count
     FROM licenses l
     JOIN products p ON p.id = l.product_id
     LEFT JOIN organizations o ON o.id = l.organization_id
     LEFT JOIN license_editions le ON le.license_id = l.id
     LEFT JOIN product_editions pe ON pe.id = le.edition_id
    WHERE 1 = 1 ${filter} ORDER BY l.id DESC`
  ).bind(...bindings).all();
  return json({
    ok: true,
    licenses: results.map((record) => {
      const license = licenseResponse(record);
      if (principal.account_type === "customer" && record.status === "DRAFT") {
        license.license_key = null;
      }
      return license;
    }),
  });
}

async function createLicense(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid JSON license request is required" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "A license request object is required" }, 400);
  }
  const customerMode = body?.customer_mode || "existing";
  if (!["existing", "new"].includes(customerMode)) {
    return json({ ok: false, error: "Customer mode must be existing or new" }, 400);
  }
  const provisionCustomer = customerMode === "new";
  const principal = provisionCustomer
    ? await requireSuperAdmin(request, env)
    : await requirePermission(request, env, "license.create");
  if (!principal) return json({ ok: false, error: provisionCustomer ? "Super admin access required" : "License creation permission required" }, 403);

  const organizationId = provisionCustomer ? null : numericId(body.organization_id);
  const requestedCustomerId = body.customer_id == null || body.customer_id === ""
    ? null
    : numericId(body.customer_id);
  const productId = numericId(body.product_id);
  const editionId = numericId(body.edition_id);
  const status = body.status || "DRAFT";
  const startsAt = body.start_date || new Date().toISOString().slice(0, 10);
  const expiresAt = body.expiry_date || null;
  const customerEmail = provisionCustomer ? validEmail(body.customer_email) : null;
  const suppliedName = body.customer_name;
  const customerName = suppliedName == null || suppliedName === "" ? null : boundedString(suppliedName, 120);
  const customerCompany = provisionCustomer ? boundedString(body.customer_company, 200) : null;
  const customerPhone = provisionCustomer ? boundedString(body.customer_phone, 40) : null;
  if ((!provisionCustomer && !organizationId) ||
      (body.customer_id != null && body.customer_id !== "" && !requestedCustomerId) ||
      (provisionCustomer && requestedCustomerId) || !productId || !editionId ||
      !LICENSE_STATUSES.includes(status) || !["DRAFT", "ACTIVE"].includes(status)) {
    return json({ ok: false, error: "Organization or new customer details, product, edition, and a valid initial status are required" }, 400);
  }
  if (provisionCustomer && (!customerEmail || !customerPhone || !customerCompany ||
      (suppliedName != null && suppliedName !== "" && !customerName))) {
    return json({ ok: false, error: "A valid customer email, phone number, organization name, and optional contact name are required" }, 400);
  }
  if (expiresAt && expiresAt < startsAt) return json({ ok: false, error: "Expiry date must not precede start date" }, 400);
  const product = await env.DB.prepare(
    `SELECT p.id FROM products p JOIN product_editions e ON e.product_id = p.id
     WHERE p.id = ? AND e.id = ? AND p.status = 'active' AND e.status = 'active'`
  ).bind(productId, editionId).first();
  if (!product) return json({ ok: false, error: "Product and edition do not match or are inactive" }, 400);
  let customer = null;
  let customerPasswordHash = null;
  if (provisionCustomer) {
    if (await emailAlreadyRegistered(env, customerEmail)) {
      return json({ ok: false, error: "A customer or staff account already uses this email; select its existing organization instead" }, 409);
    }
    customerPasswordHash = await hashPassword(makeToken());
  } else {
    const memberships = await env.DB.prepare(
      `SELECT om.account_id FROM organization_members om
       JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
       WHERE om.organization_id = ? AND lower(o.name) != 'smritisys internal'
         AND om.account_type = 'customer' AND om.status = 'active'
       ${requestedCustomerId ? "AND om.account_id = ?" : ""}`
    ).bind(...(requestedCustomerId ? [organizationId, requestedCustomerId] : [organizationId])).all();
    if (requestedCustomerId) {
      customer = memberships.results?.[0] || null;
      if (!customer) return json({ ok: false, error: "Select a customer account that belongs to this organization" }, 400);
    } else if (memberships.results?.length === 1) {
      customer = memberships.results[0];
    } else if ((memberships.results || []).length > 1) {
      return json({ ok: false, error: "A customer account ID is required when the organization has multiple customer accounts" }, 409);
    }
    if (!customer) return json({ ok: false, error: "Organization has no active customer relationship" }, 400);
  }
  const licenseKey = `LIC-${makeToken().toUpperCase()}`;
  const entitlements = normalizeEntitlements(body.entitlements || []);
  if (!entitlements) return json({ ok: false, error: "Invalid entitlement values" }, 400);
  const companyBinding = entitlements.find((entitlement) => entitlement.key === "company.binding");
  if (!companyBinding || companyBinding.value_type !== "text" || !companyBinding.value_text?.trim()) {
    return json({ ok: false, error: "A non-empty text company.binding entitlement is required" }, 400);
  }
  companyBinding.value_text = companyBinding.value_text.trim();
  if (body.company_binding != null && String(body.company_binding).trim() !== companyBinding.value_text) {
    return json({ ok: false, error: "Company binding must match its license entitlement" }, 400);
  }

  const customerIdExpression = provisionCustomer ? "(SELECT id FROM customers WHERE email = ?)" : "?";
  const organizationIdExpression = provisionCustomer
    ? `(SELECT m.organization_id FROM organization_members m
       JOIN organizations o ON o.id = m.organization_id AND o.status = 'active'
       WHERE m.account_type = 'customer'
         AND m.account_id = (SELECT id FROM customers WHERE email = ?)
         AND m.status = 'active'
       GROUP BY m.account_id
       HAVING COUNT(*) = 1)`
    : "?";
  const auditIp = request.headers.get("CF-Connecting-IP") || null;
  const licenseAuditValue = JSON.stringify({
    customer_id: provisionCustomer ? null : customer.account_id,
    product_id: productId,
    edition_id: editionId,
    status,
    start_date: startsAt,
    expiry_date: expiresAt,
    company_binding: companyBinding.value_text,
    seats: 1,
  });
  try {
    const statements = provisionCustomer ? [
      env.DB.prepare(
        `INSERT INTO customers (email, password_hash, name, phone, company, status)
         VALUES (?, ?, ?, ?, ?, 'inactive')`
      ).bind(customerEmail, customerPasswordHash, customerName, customerPhone, customerCompany),
      ...customerIdentityStatements(
        env,
        "(SELECT id FROM customers WHERE email = ?)",
        [customerEmail],
        "active",
        "active",
        "customer",
      ),
    ] : [];
    statements.push(
      env.DB.prepare(
        `INSERT INTO licenses
         (customer_id, organization_id, product_id, license_key, seats, starts_at, expires_at, offline_validity_days, status)
         VALUES (${customerIdExpression}, ${organizationIdExpression}, ?, ?, 1, ?, ?, 14, ?)`
      ).bind(...(provisionCustomer
        ? [customerEmail, customerEmail, productId, licenseKey, startsAt, expiresAt, status]
        : [customer.account_id, organizationId, productId, licenseKey, startsAt, expiresAt, status])),
      env.DB.prepare(
        `INSERT INTO license_editions (license_id, edition_id)
         SELECT id, ? FROM licenses WHERE license_key = ?`
      ).bind(editionId, licenseKey),
    );
    for (const entitlement of entitlements) {
      statements.push(env.DB.prepare(
        `INSERT INTO license_entitlements (license_id, entitlement_key, value_type, value_text, value_number)
         SELECT id, ?, ?, ?, ? FROM licenses WHERE license_key = ?`
      ).bind(entitlement.key, entitlement.value_type, entitlement.value_text, entitlement.value_number, licenseKey));
    }
    statements.push(env.DB.prepare(
      `INSERT INTO license_events (license_id, organization_id, actor_person_id, event_type, new_status, metadata_json)
       SELECT id, organization_id, ?, 'LICENSE_CREATED', status, ? FROM licenses WHERE license_key = ?`
    ).bind(...(provisionCustomer
      ? [principal.person_id, JSON.stringify({ product_id: productId, edition_id: editionId, seats: 1 }), licenseKey]
      : [principal.person_id, JSON.stringify({ product_id: productId, edition_id: editionId, seats: 1 }), licenseKey])),
    env.DB.prepare(
      `INSERT INTO audit_logs
       (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
       SELECT ?, l.organization_id, 'LICENSE_CREATED', 'license',
              CAST(l.id AS TEXT), NULL, ?, ? FROM licenses l WHERE l.license_key = ?`
    ).bind(...(provisionCustomer
      ? [principal.person_id, licenseAuditValue, auditIp, licenseKey]
      : [principal.person_id, licenseAuditValue, auditIp, licenseKey])),
    );
    if (provisionCustomer) {
      statements.push(env.DB.prepare(
        `INSERT INTO audit_logs
         (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
         SELECT ?, l.organization_id, 'CUSTOMER_LICENSE_ACCOUNT_CREATED', 'customer',
                CAST(c.id AS TEXT), NULL, ?, ?
         FROM customers c
         JOIN licenses l ON l.customer_id = c.id AND l.license_key = ?
         WHERE c.email = ?`
      ).bind(
        principal.person_id,
        JSON.stringify({ email: customerEmail, company: customerCompany, portal_access: false }),
        auditIp,
        licenseKey,
        customerEmail,
      ));
    }

    await env.DB.batch(statements);
    const licenseId = await env.DB.prepare("SELECT id FROM licenses WHERE license_key = ?").bind(licenseKey).first();
    if (!licenseId) throw new Error("The new license record could not be loaded after creation");
    const license = await getLicenseRecord(env, licenseId.id);
    if (!license) throw new Error("The new license could not be loaded after creation");
    return json({ ok: true, license: licenseResponse(license, true) }, 201);
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return json({ ok: false, error: provisionCustomer ? "Customer email or license record already exists" : "License record already exists" }, 409);
    }
    throw error;
  }
}

async function handleLicenseCodeBatches(request, env) {
  const principal = await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403);

  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT b.batch_id, b.product_id, p.name AS product_name,
              b.edition_id, e.name AS edition_name,
              MIN(b.created_at) AS created_at,
              COUNT(*) AS total,
              SUM(CASE WHEN b.status = 'available' THEN 1 ELSE 0 END) AS available,
              SUM(CASE WHEN b.status = 'claimed' THEN 1 ELSE 0 END) AS claimed,
              SUM(CASE WHEN b.status = 'revoked' THEN 1 ELSE 0 END) AS revoked,
              SUM(CASE WHEN b.delivery_status = 'not_issued' THEN 1 ELSE 0 END) AS not_issued,
              SUM(CASE WHEN b.delivery_status = 'issued' THEN 1 ELSE 0 END) AS issued
       FROM license_code_inventory b
       JOIN products p ON p.id = b.product_id
       JOIN product_editions e ON e.id = b.edition_id
       GROUP BY b.batch_id, b.product_id, p.name, b.edition_id, e.name
       ORDER BY created_at DESC LIMIT 50`
    ).all();
    return json({ ok: true, batches: results || [] });
  }

  if (request.method !== "POST") return json({ ok: false, error: "Unsupported batch operation" }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid JSON batch request is required" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "A license code batch object is required" }, 400);
  }

  const count = Number(body.count);
  const productId = numericId(body.product_id);
  const editionId = numericId(body.edition_id);
  const seats = Number(body.seats ?? 1);
  const licenseModelName = boundedString(body.license_model, 40);
  const startsAt = boundedString(body.start_date, 10) || new Date().toISOString().slice(0, 10);
  const expiresAt = body.expiry_date ? boundedString(body.expiry_date, 10) : null;
  const allowedModels = ["cloud_subscription", "cloud_one_time", "on_premise_subscription", "on_premise_perpetual"];
  const isDate = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!Number.isInteger(count) || count < 1 || count > 200 ||
      !productId || !editionId || !Number.isInteger(seats) || seats < 1 || seats > 10000 ||
      !allowedModels.includes(licenseModelName) || !isDate(startsAt) ||
      (body.expiry_date != null && (!expiresAt || !isDate(expiresAt))) ||
      (expiresAt && (expiresAt < startsAt || expiresAt < new Date().toISOString().slice(0, 10)))) {
    return json({ ok: false, error: "Provide 1-200 codes, a matching product and edition, valid license terms, and a valid seat count" }, 400);
  }

  const product = await env.DB.prepare(
    `SELECT p.id, e.id AS edition_id
     FROM products p JOIN product_editions e ON e.product_id = p.id
     WHERE p.id = ? AND e.id = ? AND p.status = 'active' AND e.status = 'active'`
  ).bind(productId, editionId).first();
  if (!product) return json({ ok: false, error: "Product and edition do not match or are inactive" }, 400);
  const encryption = await loadLicenseCodeEncryptionKey(env);
  if (!encryption.key) {
    return json({
      ok: false,
      error: encryption.configured
        ? "Protected activation-key storage is invalid"
        : "Protected activation-key storage is not configured",
    }, 503);
  }

  const batchId = crypto.randomUUID();
  const batchEntitlements = "[]";
  const codes = [];
  const statements = [];
  const { results: existingSerialRows } = await env.DB.prepare(
    `SELECT serial_number FROM license_code_inventory
     WHERE length(serial_number) BETWEEN 1 AND 9 AND serial_number NOT GLOB '*[^0-9]*'
     UNION
     SELECT serial_number FROM licenses
     WHERE serial_number IS NOT NULL
       AND length(serial_number) BETWEEN 1 AND 9
       AND serial_number NOT GLOB '*[^0-9]*'`
  ).all();
  const usedSerials = new Set((existingSerialRows || []).map((row) => row.serial_number));
  const usedActivationKeys = new Set();
  for (let index = 0; index < count; index += 1) {
    const serialNumber = makeNumericLicenseSerialNumber(usedSerials);
    let activationKey = makeLicenseActivationKey();
    while (usedActivationKeys.has(activationKey)) activationKey = makeLicenseActivationKey();
    usedActivationKeys.add(activationKey);
    const activationKeyHash = await sha256Hex(activationKey);
    const activationKeyCiphertext = await encryptLicenseActivationKey(
      activationKey, encryption.key, batchId, serialNumber,
    );
    codes.push({ serial_number: serialNumber, activation_key: activationKey });
    statements.push(env.DB.prepare(
      `INSERT INTO license_code_inventory
       (batch_id, serial_number, activation_key_hash, activation_key_ciphertext, product_id, edition_id,
        starts_at, expires_at, license_model, seats, entitlements_json,
        offline_validity_days, created_by_person_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 14, ?)`
    ).bind(
      batchId, serialNumber, activationKeyHash, activationKeyCiphertext, productId, editionId,
      startsAt, expiresAt, licenseModelName, seats, batchEntitlements, principal.person_id,
    ));
  }
  statements.push(env.DB.prepare(
    `INSERT INTO audit_logs
     (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
     VALUES (?, NULL, 'LICENSE_CODE_BATCH_CREATED', 'license_code_batch', ?, NULL, ?, ?)`
  ).bind(
    principal.person_id,
    batchId,
    JSON.stringify({ count, product_id: productId, edition_id: editionId, starts_at: startsAt, expires_at: expiresAt, seats }),
    request.headers.get("CF-Connecting-IP") || null,
  ));

  await env.DB.batch(statements);
  return json({ ok: true, batch_id: batchId, count, codes, offline_validity_days: 14 }, 201);
}

async function getLicenseCodeBatchCodes(request, env, batchId) {
  const principal = await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) {
    return json({ ok: false, error: "A valid batch id is required" }, 400);
  }

  const batch = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM license_code_inventory WHERE batch_id = ?"
  ).bind(batchId).first();
  if (!Number(batch?.count)) return json({ ok: false, error: "License code batch not found" }, 404);

  const { results } = await env.DB.prepare(
    `SELECT c.serial_number, c.status, c.delivery_status, c.issued_to_name,
            c.issued_to_organization, c.issued_to_email, c.delivery_channel,
            c.delivery_reference, c.issued_at, c.activation_key_ciphertext,
            c.assigned_partner_organization_id, c.partner_assigned_at,
            assigned_partner.name AS assigned_partner_name,
            p.slug AS product_code, p.name AS product_name,
            e.code AS edition_code, e.name AS edition_name
     FROM license_code_inventory c
     LEFT JOIN organizations assigned_partner ON assigned_partner.id = c.assigned_partner_organization_id
     JOIN products p ON p.id = c.product_id
     JOIN product_editions e ON e.id = c.edition_id
     WHERE c.batch_id = ?
     ORDER BY c.serial_number LIMIT 500`
  ).bind(batchId).all();
  const { results: allocationRows } = await env.DB.prepare(
    `SELECT a.id, a.created_at, a.new_value, p.name AS actor_name
     FROM audit_logs a
     LEFT JOIN people p ON p.id = a.actor_person_id
     WHERE a.resource_type = 'license_code_batch_delivery'
       AND a.resource_id = ?
       AND a.action = 'LICENSE_CODES_ALLOCATED_TO_PARTNER'
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT 200`
  ).bind(batchId).all();
  const allocations = [];
  for (const row of allocationRows || []) {
    let details;
    try {
      details = JSON.parse(row.new_value || "null");
    } catch {
      return json({ ok: false, error: "Partner allocation history contains invalid data" }, 500);
    }
    const partnerOrganizationId = Number(details?.partner_organization_id);
    if (!details || !Array.isArray(details.serial_numbers) || !details.serial_numbers.length ||
        details.serial_numbers.some((serial) => typeof serial !== "string") ||
        !Number.isInteger(partnerOrganizationId) || partnerOrganizationId < 1) {
      return json({ ok: false, error: "Partner allocation history is incomplete" }, 500);
    }
    allocations.push({
      allocation_id: Number(row.id),
      recorded_at: row.created_at,
      recorded_by: row.actor_name,
      partner_organization_id: partnerOrganizationId,
      partner_name: details.recipient_organization,
      partner_type: details.partner_type || null,
      recipient_name: details.recipient_name,
      recipient_email: details.recipient_email,
      delivery_channel: details.delivery_channel,
      delivery_reference: details.delivery_reference,
      serial_numbers: details.serial_numbers,
    });
  }
  const encryption = await loadLicenseCodeEncryptionKey(env);
  return json({
    ok: true,
    batch_id: batchId,
    key_reveal_configured: Boolean(encryption.key),
    allocations,
    codes: (results || []).map((code) => ({
      serial_number: code.serial_number,
      status: code.status,
      delivery_status: code.delivery_status,
      issued_to_name: code.issued_to_name,
      issued_to_organization: code.issued_to_organization,
      issued_to_email: code.issued_to_email,
      delivery_channel: code.delivery_channel,
      delivery_reference: code.delivery_reference,
      issued_at: code.issued_at,
      assigned_partner_organization_id: code.assigned_partner_organization_id,
      assigned_partner_name: code.assigned_partner_name,
      partner_assigned_at: code.partner_assigned_at,
      product_code: code.product_code,
      product_name: code.product_name,
      edition_code: code.edition_code,
      edition_name: code.edition_name,
      activation_key_recoverable: Boolean(code.activation_key_ciphertext && encryption.key),
    })),
  });
}

async function revealLicenseCode(request, env, batchId, serialNumber, partnerSession = null) {
  const noStoreHeaders = { "Cache-Control": "no-store", Pragma: "no-cache" };
  const principal = partnerSession || await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403, null, noStoreHeaders);
  if (partnerSession && !(await hasPartnerPermission(env, partnerSession, "partner.inventory.reveal"))) {
    return json({ ok: false, error: "Partner activation-key access required" }, 403, null, noStoreHeaders);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId) ||
      !/^\d{9}$/.test(serialNumber)) {
    return json({ ok: false, error: "A valid batch and serial number are required" }, 400, null, noStoreHeaders);
  }

  const rateLimit = await enforceRateLimit(
    env, request, "license-code-reveal", 5, 900, String(principal.account_id), true,
  );
  if (rateLimit.unavailable) {
    return json({ ok: false, error: "Protected key reveal is temporarily unavailable" }, 503, null, noStoreHeaders);
  }
  if (!rateLimit.allowed) {
    return json(
      { ok: false, error: "Too many requests. Please try again later." },
      429,
      null,
      { ...noStoreHeaders, "Retry-After": String(rateLimit.retryAfter) },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A password confirmation is required" }, 400, null, noStoreHeaders);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.password !== "string" || body.password.length < 1 || body.password.length > 256) {
    return json({ ok: false, error: "A valid password confirmation is required" }, 400, null, noStoreHeaders);
  }

  const accountTable = principal.account_type === "user" ? "users" : "customers";
  const user = await env.DB.prepare(
    `SELECT password_hash FROM ${accountTable} WHERE id = ? AND status = 'active'`
  ).bind(principal.account_id).first();
  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    return json({ ok: false, error: "Password confirmation failed" }, 403, null, noStoreHeaders);
  }

  const code = await env.DB.prepare(
    `SELECT activation_key_ciphertext, activation_key_hash, status,
            assigned_partner_organization_id
     FROM license_code_inventory WHERE batch_id = ? AND serial_number = ?`
  ).bind(batchId, serialNumber).first();
  if (!code) return json({ ok: false, error: "License code not found" }, 404, null, noStoreHeaders);
  if (partnerSession && Number(code.assigned_partner_organization_id) !== Number(partnerSession.partner_organization_id)) {
    return json({ ok: false, error: "License code not found" }, 404, null, noStoreHeaders);
  }
  if (code.status !== "available") {
    return json({ ok: false, error: "Only unclaimed, available codes can be revealed" }, 409, null, noStoreHeaders);
  }
  if (!code.activation_key_ciphertext) {
    return json({ ok: false, error: "This older code has no recoverable key" }, 409, null, noStoreHeaders);
  }

  const encryption = await loadLicenseCodeEncryptionKey(env);
  if (!encryption.key) {
    return json({ ok: false, error: "Protected activation-key storage is unavailable" }, 503, null, noStoreHeaders);
  }

  let activationKey;
  try {
    activationKey = await decryptLicenseActivationKey(
      code.activation_key_ciphertext, encryption.key, batchId, serialNumber,
    );
  } catch {
    console.error("Activation key reveal decryption failed", { batchId, serialNumber });
    return json({ ok: false, error: "The activation key could not be decrypted" }, 503, null, noStoreHeaders);
  }
  if (!/^[A-Z0-9]{16}$/.test(activationKey)) {
    console.error("Activation key reveal returned an invalid key format", { batchId, serialNumber });
    return json({ ok: false, error: "The activation key could not be decrypted" }, 503, null, noStoreHeaders);
  }
  if (!constantTimeStringEqual(await sha256Hex(activationKey), code.activation_key_hash)) {
    console.error("Activation key reveal hash verification failed", { batchId, serialNumber });
    return json({ ok: false, error: "The activation key could not be verified" }, 503, null, noStoreHeaders);
  }

  const auditPrincipal = partnerSession
    ? { ...partnerSession, organization_id: partnerSession.partner_organization_id }
    : principal;
  const revealAuditDetails = { batch_id: batchId };
  if (partnerSession) revealAuditDetails.partner_organization_id = partnerSession.partner_organization_id;
  await writeAudit(
    env, request, auditPrincipal,
    partnerSession ? "PARTNER_LICENSE_CODE_REVEALED" : "LICENSE_CODE_REVEALED",
    "license_code_inventory", serialNumber, null, revealAuditDetails,
  );
  return json({ ok: true, activation_key: activationKey }, 200, null, noStoreHeaders);
}

async function restoreLegacyLicenseCode(request, env, batchId, serialNumber) {
  const noStoreHeaders = { "Cache-Control": "no-store", Pragma: "no-cache" };
  const principal = await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403, null, noStoreHeaders);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId) ||
      !/^\d{9}$/.test(serialNumber)) {
    return json({ ok: false, error: "A valid batch and serial number are required" }, 400, null, noStoreHeaders);
  }

  const rateLimit = await enforceRateLimit(
    env, request, "license-code-restore", 5, 900, String(principal.account_id), true,
  );
  if (rateLimit.unavailable) {
    return json({ ok: false, error: "Protected key recovery is temporarily unavailable" }, 503, null, noStoreHeaders);
  }
  if (!rateLimit.allowed) {
    return json(
      { ok: false, error: "Too many requests. Please try again later." },
      429,
      null,
      { ...noStoreHeaders, "Retry-After": String(rateLimit.retryAfter) },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A key and password confirmation are required" }, 400, null, noStoreHeaders);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.password !== "string" || body.password.length < 1 || body.password.length > 256 ||
      typeof body.activation_key !== "string" || !/^[A-Z0-9]{16}$/.test(body.activation_key)) {
    return json({ ok: false, error: "A valid activation key and password confirmation are required" }, 400, null, noStoreHeaders);
  }

  const user = await env.DB.prepare(
    "SELECT password_hash FROM users WHERE id = ? AND status = 'active'"
  ).bind(principal.account_id).first();
  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    return json({ ok: false, error: "Password confirmation failed" }, 403, null, noStoreHeaders);
  }

  const code = await env.DB.prepare(
    `SELECT activation_key_ciphertext, activation_key_hash, status
     FROM license_code_inventory WHERE batch_id = ? AND serial_number = ?`
  ).bind(batchId, serialNumber).first();
  if (!code) return json({ ok: false, error: "License code not found" }, 404, null, noStoreHeaders);
  if (code.status !== "available") {
    return json({ ok: false, error: "Only unclaimed, available codes can be restored" }, 409, null, noStoreHeaders);
  }
  if (code.activation_key_ciphertext) {
    return json({ ok: false, error: "This code already has protected key storage" }, 409, null, noStoreHeaders);
  }

  const encryption = await loadLicenseCodeEncryptionKey(env);
  if (!encryption.key) {
    return json({ ok: false, error: "Protected activation-key storage is unavailable" }, 503, null, noStoreHeaders);
  }
  if (!constantTimeStringEqual(await sha256Hex(body.activation_key), code.activation_key_hash)) {
    return json({ ok: false, error: "The activation key does not match this serial number" }, 400, null, noStoreHeaders);
  }

  let ciphertext;
  try {
    ciphertext = await encryptLicenseActivationKey(body.activation_key, encryption.key, batchId, serialNumber);
  } catch {
    console.error("Activation key recovery encryption failed", { batchId, serialNumber });
    return json({ ok: false, error: "The activation key could not be stored securely" }, 503, null, noStoreHeaders);
  }

  const newValue = JSON.stringify({ batch_id: batchId });
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE license_code_inventory
       SET activation_key_ciphertext = ?
       WHERE batch_id = ? AND serial_number = ? AND status = 'available'
         AND activation_key_ciphertext IS NULL AND activation_key_hash = ?`
    ).bind(ciphertext, batchId, serialNumber, code.activation_key_hash),
    env.DB.prepare(
      `INSERT INTO audit_logs
       (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
       SELECT ?, ?, 'LICENSE_CODE_KEY_RESTORED', 'license_code_inventory', ?, NULL, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM license_code_inventory
         WHERE batch_id = ? AND serial_number = ? AND status = 'available'
           AND activation_key_ciphertext = ? AND activation_key_hash = ?
       )`
    ).bind(
      principal.person_id || null,
      principal.organization_id || null,
      serialNumber,
      newValue,
      request.headers.get("CF-Connecting-IP") || null,
      batchId,
      serialNumber,
      ciphertext,
      code.activation_key_hash,
    ),
  ]);
  if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1) {
    return json({ ok: false, error: "The code changed before its key could be restored" }, 409, null, noStoreHeaders);
  }

  return json({ ok: true }, 200, null, noStoreHeaders);
}

async function issueLicenseCodes(request, env, batchId) {
  const principal = await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) {
    return json({ ok: false, error: "A valid batch id is required" }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid JSON code-issuance request is required" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "A code-issuance request object is required" }, 400);
  }

  const serialNumbers = Array.isArray(body.serial_numbers)
    ? body.serial_numbers.map((value) => boundedString(value, 80))
    : [];
  const recipientName = boundedString(body.recipient_name, 120);
  const recipientOrganization = body.recipient_organization == null || body.recipient_organization === ""
    ? null
    : boundedString(body.recipient_organization, 200);
  const emailProvided = body.recipient_email != null && body.recipient_email !== "";
  const recipientEmail = emailProvided ? validEmail(body.recipient_email) : null;
  const referenceProvided = body.delivery_reference != null && body.delivery_reference !== "";
  const deliveryReference = referenceProvided ? boundedString(body.delivery_reference, 200) : null;
  const partnerIdProvided = body.partner_organization_id != null && body.partner_organization_id !== "";
  const assignedPartnerId = partnerIdProvided ? numericId(body.partner_organization_id) : null;
  const deliveryChannels = ["email", "messaging", "phone", "in_person", "other"];
  const deliveryChannel = boundedString(body.delivery_channel, 20);
  if (serialNumbers.length < 1 || serialNumbers.length > 200 ||
      serialNumbers.some((serialNumber) => !serialNumber) ||
      new Set(serialNumbers).size !== serialNumbers.length ||
      !recipientName ||
      (body.recipient_organization != null && body.recipient_organization !== "" && !recipientOrganization) ||
      (emailProvided && !recipientEmail) ||
      (referenceProvided && !deliveryReference) ||
      (partnerIdProvided && !assignedPartnerId) ||
      !deliveryChannels.includes(deliveryChannel)) {
    return json({ ok: false, error: "Provide 1-200 unique serials, a recipient name, and valid delivery details" }, 400);
  }

  let assignedPartner = null;
  if (assignedPartnerId) {
    assignedPartner = await env.DB.prepare(
      `SELECT o.id, o.name, r.relationship_type AS partner_type
       FROM organizations o
       JOIN relationships r ON r.organization_id = o.id AND r.status = 'active'
       WHERE o.id = ? AND o.status = 'active'
         AND r.relationship_type IN ('channel_partner', 'reseller', 'distributor')
       LIMIT 1`
    ).bind(assignedPartnerId).first();
    if (!assignedPartner) return json({ ok: false, error: "Select an active sales partner" }, 404);
  }
  const deliveryOrganization = assignedPartner?.name || recipientOrganization;

  const batch = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM license_code_inventory WHERE batch_id = ?"
  ).bind(batchId).first();
  if (!Number(batch?.count)) return json({ ok: false, error: "License code batch not found" }, 404);

  const serialNumbersJson = JSON.stringify(serialNumbers);
  const auditDetails = JSON.stringify({
    delivery_status: "issued",
    serial_numbers: serialNumbers,
    recipient_name: recipientName,
    recipient_organization: deliveryOrganization,
    recipient_email: recipientEmail,
    delivery_channel: deliveryChannel,
    delivery_reference: deliveryReference,
    partner_organization_id: assignedPartnerId,
    partner_type: assignedPartner?.partner_type || null,
  });
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE license_code_inventory
       SET delivery_status = 'issued',
           issued_at = datetime('now'),
           issued_by_person_id = ?,
           issued_to_name = ?,
           issued_to_organization = ?,
           issued_to_email = ?,
           delivery_channel = ?,
           delivery_reference = ?,
           assigned_partner_organization_id = ?,
           partner_assigned_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END,
           partner_assigned_by_person_id = ?
       WHERE batch_id = ?
         AND serial_number IN (SELECT value FROM json_each(?))
         AND status = 'available'
         AND delivery_status = 'not_issued'
         AND assigned_partner_organization_id IS NULL
         AND (
           SELECT COUNT(*) FROM license_code_inventory
           WHERE batch_id = ?
             AND serial_number IN (SELECT value FROM json_each(?))
             AND status = 'available'
             AND delivery_status = 'not_issued'
             AND assigned_partner_organization_id IS NULL
         ) = ?`
    ).bind(
      principal.person_id, recipientName, deliveryOrganization, recipientEmail,
      deliveryChannel, deliveryReference, assignedPartnerId, assignedPartnerId,
      assignedPartnerId ? principal.person_id : null, batchId, serialNumbersJson,
      batchId, serialNumbersJson, serialNumbers.length,
    ),
    env.DB.prepare(
      `INSERT INTO audit_logs
       (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
       SELECT ?, NULL, ?, 'license_code_batch_delivery', ?, ?, ?, ?
       WHERE changes() = ?`
    ).bind(
      principal.person_id,
      assignedPartnerId ? "LICENSE_CODES_ALLOCATED_TO_PARTNER" : "LICENSE_CODES_ISSUED",
      batchId,
      JSON.stringify({ delivery_status: "not_issued", assigned_partner_organization_id: null, count: serialNumbers.length }),
      auditDetails, request.headers.get("CF-Connecting-IP") || null, serialNumbers.length,
    ),
  ]);
  const issuedCount = Number(results?.[0]?.meta?.changes || 0);
  if (issuedCount !== serialNumbers.length) {
    return json({
      ok: false,
      error: "One or more selected codes are not available in this batch or have already been issued",
    }, 409);
  }
  return json({
    ok: true,
    batch_id: batchId,
    issued_count: issuedCount,
    serial_numbers: serialNumbers,
    partner_organization_id: assignedPartnerId,
  });
}

async function revokeLicenseCodeBatch(request, env, batchId) {
  const principal = await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) {
    return json({ ok: false, error: "A valid batch id is required" }, 400);
  }

  const getBatchCounts = () => env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
            SUM(CASE WHEN status = 'claiming' THEN 1 ELSE 0 END) AS claiming,
            SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed,
            SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) AS revoked
     FROM license_code_inventory WHERE batch_id = ?`
  ).bind(batchId).first();

  const current = await getBatchCounts();
  if (!current || Number(current.total) === 0) {
    return json({ ok: false, error: "License code batch not found" }, 404);
  }
  if (Number(current.claiming) > 0 || Number(current.claimed) > 0) {
    return json({ ok: false, error: "A batch with a claimed or in-progress code cannot be revoked" }, 409);
  }
  if (Number(current.revoked) === Number(current.total)) {
    return json({ ok: true, batch_id: batchId, status: "revoked", count: Number(current.total), already_revoked: true });
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE license_code_inventory SET status = 'revoked'
       WHERE batch_id = ? AND status = 'available'
         AND NOT EXISTS (
           SELECT 1 FROM license_code_inventory
           WHERE batch_id = ? AND status IN ('claiming', 'claimed')
         )`
    ).bind(batchId, batchId),
    env.DB.prepare(
      `INSERT INTO audit_logs
       (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
       SELECT ?, NULL, 'LICENSE_CODE_BATCH_REVOKED', 'license_code_batch', ?, ?, ?, ?
       WHERE changes() > 0`
    ).bind(
      principal.person_id,
      batchId,
      JSON.stringify({ status: "available", count: Number(current.available) }),
      JSON.stringify({ status: "revoked", count: Number(current.available) }),
      request.headers.get("CF-Connecting-IP") || null,
    ),
  ]);

  const updated = await getBatchCounts();
  if (Number(updated.claiming) > 0 || Number(updated.claimed) > 0 || Number(updated.available) > 0) {
    return json({ ok: false, error: "The batch changed during revocation; no further codes were revoked" }, 409);
  }
  return json({
    ok: true,
    batch_id: batchId,
    status: "revoked",
    count: Number(updated.total),
    revoked: Number(updated.revoked),
  });
}

async function handleLicenseEntitlements(request, env, licenseId) {
  const access = await requireLicenseAccess(request, env, licenseId, request.method === "GET" ? "license.view" : "license.manage_entitlements");
  if (access.error) return access.error;
  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT entitlement_key, value_type, value_text, value_number, created_at, updated_at
       FROM license_entitlements WHERE license_id = ? ORDER BY entitlement_key`
    ).bind(access.license.id).all();
    return json({ ok: true, entitlements: results.map(parseEntitlement) });
  }
  const body = await request.json();
  const entitlements = normalizeEntitlements([body]);
  if (!entitlements) return json({ ok: false, error: "Invalid entitlement value" }, 400);
  const entitlement = entitlements[0];
  await env.DB.prepare(
    `INSERT INTO license_entitlements (license_id, entitlement_key, value_type, value_text, value_number)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(license_id, entitlement_key) DO UPDATE SET
       value_type = excluded.value_type, value_text = excluded.value_text,
       value_number = excluded.value_number, updated_at = datetime('now')`
  ).bind(access.license.id, entitlement.key, entitlement.value_type, entitlement.value_text, entitlement.value_number).run();
  await recordLicenseEvent(env, access.license, access.principal, "ENTITLEMENT_CHANGED", access.license.status, access.license.status, entitlement);
  await writeAudit(env, request, access.principal, "ENTITLEMENT_CHANGED", "license", access.license.id, null, entitlement);
  return json({ ok: true, message: "Entitlement saved" });
}

async function handleLicenseActivations(request, env, licenseId) {
  const access = await requireLicenseAccess(request, env, licenseId, "license.view");
  if (access.error) return access.error;
  const { results } = await env.DB.prepare(
    `SELECT id, license_id, installation_id, activation_identifier, status,
            activated_at, last_seen_at, deactivated_at, metadata_json
     FROM license_activations WHERE license_id = ? ORDER BY activated_at DESC`
  ).bind(access.license.id).all();
  return json({ ok: true, activations: results.map((activation) => ({
    ...activation,
    metadata: activation.metadata_json ? JSON.parse(activation.metadata_json) : null,
  })) });
}

async function handleLicenseArtifacts(request, env, licenseId) {
  const access = await requireLicenseAccess(request, env, licenseId, "license.view");
  if (access.error) return access.error;
  const { results } = await env.DB.prepare(
    `SELECT id, document_id, license_id, installation_id, activation_identifier, key_id,
            algorithm, payload_base64url, signature_base64url, issued_at, created_at
     FROM license_artifacts WHERE license_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`
  ).bind(access.license.id).all();
  return json({ ok: true, artifacts: results });
}

async function revokeLicenseActivation(request, env, licenseId, activationId) {
  const access = await requireLicenseAccess(request, env, licenseId, "license.activate");
  if (access.error) return access.error;
  const activationNumericId = numericId(activationId);
  if (!activationNumericId) return json({ ok: false, error: "A valid activation id is required" }, 400);
  const activation = await env.DB.prepare(
    `SELECT id, installation_id, activation_identifier, status
     FROM license_activations WHERE id = ? AND license_id = ?`
  ).bind(activationNumericId, access.license.id).first();
  if (!activation) return json({ ok: false, error: "Activation not found" }, 404);
  if (activation.status !== "active") return json({ ok: false, error: "Activation is already revoked" }, 409);

  await env.DB.prepare(
    `UPDATE license_activations SET status = 'revoked', deactivated_at = datetime('now')
     WHERE id = ? AND license_id = ? AND status = 'active'`
  ).bind(activationNumericId, access.license.id).run();
  await recordLicenseEvent(env, access.license, access.principal, "ACTIVATION_REVOKED",
    access.license.status, access.license.status,
    { activation_id: activationNumericId, installation_id: activation.installation_id });
  await writeAudit(env, request, access.principal, "ACTIVATION_REVOKED", "license_activation",
    activationNumericId, { status: "active" }, { status: "revoked" });
  return json({ ok: true, activation_id: activationNumericId, status: "revoked" });
}

async function handleLicenseEvents(request, env, licenseId) {
  const access = await requireLicenseAccess(request, env, licenseId, "license.view");
  if (access.error) return access.error;
  const { results } = await env.DB.prepare(
    `SELECT id, license_id, organization_id, actor_person_id, event_type,
            previous_status, new_status, metadata_json, created_at
     FROM license_events WHERE license_id = ? ORDER BY created_at DESC, id DESC`
  ).bind(access.license.id).all();
  return json({ ok: true, events: results.map((event) => ({
    ...event,
    metadata: event.metadata_json ? JSON.parse(event.metadata_json) : null,
  })) });
}

async function handleLicenseRequest(request, env, licenseId) {
  const access = await requireLicenseAccess(request, env, licenseId, "license.view");
  if (access.error) return access.error;
  if (access.principal.account_type !== "customer") return json({ ok: false, error: "Customer request required" }, 403);
  const body = await request.json();
  const allowedTypes = ["renewal", "upgrade", "additional_users", "additional_branches", "additional_modules"];
  if (!allowedTypes.includes(body.request_type)) return json({ ok: false, error: "Invalid license request" }, 400);
  await env.DB.prepare(
    `INSERT INTO license_requests (license_id, organization_id, requester_person_id, request_type)
     VALUES (?, ?, ?, ?)`
  ).bind(access.license.id, access.license.organization_id, access.principal.person_id, body.request_type).run();
  await writeAudit(env, request, access.principal, "LICENSE_REQUESTED", "license", access.license.id, null, { request_type: body.request_type });
  return json({ ok: true, message: "Your request has been sent to SMRITISYS." }, 201);
}

async function transitionLicense(request, env, licenseId, action) {
  const permissionByAction = { activate: "license.activate", suspend: "license.suspend", renew: "license.renew" };
  const access = await requireLicenseAccess(request, env, licenseId, permissionByAction[action]);
  if (access.error) return access.error;
  const body = await request.json();
  const currentStatus = access.license.status;
  let nextStatus;
  let eventType;
  let update = null;

  if (action === "activate") {
    if (!body.installation_id || !body.activation_identifier || !["DRAFT", "ACTIVE", "SUSPENDED", "PENDING_RENEWAL"].includes(currentStatus)) {
      return json({ ok: false, error: "A valid activation and transition are required" }, 400);
    }
    nextStatus = "ACTIVE";
    eventType = currentStatus === "DRAFT" ? "LICENSE_ACTIVATED" : currentStatus === "ACTIVE" ? null : "LICENSE_REACTIVATED";
    const metadataJson = body.metadata == null ? null : JSON.stringify(body.metadata);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO license_activations
         (license_id, installation_id, activation_identifier, metadata_json)
         VALUES (?, ?, ?, ?)`
      ).bind(access.license.id, String(body.installation_id).slice(0, 200), String(body.activation_identifier).slice(0, 200), metadataJson),
      env.DB.prepare(
        `UPDATE license_activations SET last_seen_at = datetime('now')
         WHERE license_id = ? AND activation_identifier = ? AND status = 'active'`
      ).bind(access.license.id, String(body.activation_identifier).slice(0, 200)),
      ...(currentStatus === "ACTIVE" ? [] : [env.DB.prepare("UPDATE licenses SET status = ? WHERE id = ?").bind(nextStatus, access.license.id)]),
    ]);
    const activation = await env.DB.prepare(
      "SELECT id FROM license_activations WHERE license_id = ? AND activation_identifier = ?"
    ).bind(access.license.id, String(body.activation_identifier).slice(0, 200)).first();
    const eventExists = await env.DB.prepare(
      `SELECT id FROM license_events WHERE license_id = ? AND event_type = 'ACTIVATION_CREATED'
       AND json_extract(metadata_json, '$.activation_identifier') = ? LIMIT 1`
    ).bind(access.license.id, String(body.activation_identifier).slice(0, 200)).first();
    if (!eventExists) await recordLicenseEvent(env, access.license, access.principal, "ACTIVATION_CREATED", currentStatus, nextStatus, { activation_identifier: body.activation_identifier, activation_id: activation.id });
  } else if (action === "suspend") {
    if (currentStatus !== "ACTIVE") return json({ ok: false, error: "Only active licenses can be suspended" }, 409);
    nextStatus = "SUSPENDED";
    eventType = "LICENSE_SUSPENDED";
    update = {};
  } else {
    if (!["ACTIVE", "PENDING_RENEWAL", "EXPIRED"].includes(currentStatus)) return json({ ok: false, error: "License cannot be renewed from its current state" }, 409);
    const startsAt = body.start_date || new Date().toISOString().slice(0, 10);
    const expiresAt = body.expiry_date;
    if (!expiresAt || expiresAt < startsAt) return json({ ok: false, error: "A valid renewal expiry date is required" }, 400);
    nextStatus = "ACTIVE";
    eventType = "LICENSE_RENEWED";
    update = { startsAt, expiresAt };
  }

  if (action !== "activate") {
    const statements = [env.DB.prepare("UPDATE licenses SET status = ?, starts_at = COALESCE(?, starts_at), expires_at = COALESCE(?, expires_at) WHERE id = ?")
      .bind(nextStatus, update?.startsAt || null, update?.expiresAt || null, access.license.id)];
    await env.DB.batch(statements);
  }
  if (eventType) {
    await recordLicenseEvent(env, access.license, access.principal, eventType, currentStatus, nextStatus, update);
    await writeAudit(env, request, access.principal, eventType, "license", access.license.id, { status: currentStatus }, { status: nextStatus });
  } else if (action === "activate") {
    await writeAudit(env, request, access.principal, "ACTIVATION_CREATED", "license_activation", access.license.id, null, { activation_identifier: body.activation_identifier });
  }
  const license = await getLicenseRecord(env, access.license.id);
  return json({ ok: true, license: licenseResponse(license) });
}

async function patchLicense(request, env, licenseId) {
  const access = await requireLicenseAccess(request, env, licenseId, "license.update");
  if (access.error) return access.error;
  const body = await request.json();
  if (body.status) return json({ ok: false, error: "Use an explicit license transition endpoint" }, 400);
  const startsAt = body.start_date || null;
  const expiresAt = body.expiry_date || null;
  if (startsAt && expiresAt && expiresAt < startsAt) return json({ ok: false, error: "Expiry date must not precede start date" }, 400);
  let editionId = null;
  if (body.edition_id != null) {
    editionId = numericId(body.edition_id);
    const edition = await env.DB.prepare("SELECT id FROM product_editions WHERE id = ? AND product_id = ? AND status = 'active'").bind(editionId, access.license.product_id).first();
    if (!edition) return json({ ok: false, error: "Edition does not belong to this product" }, 400);
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE licenses SET starts_at = COALESCE(?, starts_at), expires_at = COALESCE(?, expires_at) WHERE id = ?").bind(startsAt, expiresAt, access.license.id),
    ...(editionId ? [env.DB.prepare("UPDATE license_editions SET edition_id = ?, updated_at = datetime('now') WHERE license_id = ?").bind(editionId, access.license.id)] : []),
  ]);
  await recordLicenseEvent(env, access.license, access.principal, "LICENSE_UPDATED", access.license.status, access.license.status, { start_date: startsAt, expiry_date: expiresAt, edition_id: editionId });
  await writeAudit(env, request, access.principal, "LICENSE_UPDATED", "license", access.license.id, licenseResponse(access.license), { start_date: startsAt, expiry_date: expiresAt, edition_id: editionId });
  const license = await getLicenseRecord(env, access.license.id);
  return json({ ok: true, license: licenseResponse(license) });
}

async function handleLicenses(request, env, segments) {
  if (segments[0] === "batches") {
    if (segments.length === 1) return await handleLicenseCodeBatches(request, env);
    if (segments.length === 5 && segments[2] === "codes" &&
        segments[4] === "reveal" && request.method === "POST") {
      return await revealLicenseCode(request, env, segments[1], segments[3]);
    }
    if (segments.length === 5 && segments[2] === "codes" &&
        segments[4] === "restore" && request.method === "POST") {
      return await restoreLegacyLicenseCode(request, env, segments[1], segments[3]);
    }
    if (segments.length === 3 && segments[2] === "codes" && request.method === "GET") {
      return await getLicenseCodeBatchCodes(request, env, segments[1]);
    }
    if (segments.length === 3 && segments[2] === "issue" && request.method === "POST") {
      return await issueLicenseCodes(request, env, segments[1]);
    }
    if (segments.length === 3 && segments[2] === "revoke" && request.method === "POST") {
      return await revokeLicenseCodeBatch(request, env, segments[1]);
    }
    return json({ ok: false, error: "License code batch operation not found" }, 404);
  }
  if (!segments.length) return request.method === "GET" ? listLicenses(request, env) : createLicense(request, env);
  const licenseId = numericId(segments[0]);
  if (!licenseId) return json({ ok: false, error: "A valid license id is required" }, 400);
  const child = segments[1];
  if (child === "entitlements" && ["GET", "POST"].includes(request.method)) return handleLicenseEntitlements(request, env, licenseId);
  if (child === "activations" && request.method === "GET") return handleLicenseActivations(request, env, licenseId);
  if (child === "activations" && segments[3] === "revoke" && request.method === "POST") {
    return revokeLicenseActivation(request, env, licenseId, segments[2]);
  }
  if (child === "artifacts" && request.method === "GET") return handleLicenseArtifacts(request, env, licenseId);
  if (child === "events" && request.method === "GET") return handleLicenseEvents(request, env, licenseId);
  if (child === "requests" && request.method === "POST") return handleLicenseRequest(request, env, licenseId);
  if (["activate", "suspend", "renew"].includes(child) && request.method === "POST") return transitionLicense(request, env, licenseId, child);
  if (!child && request.method === "GET") {
    const access = await requireLicenseAccess(request, env, licenseId, "license.view");
    if (access.error) return access.error;
    return json({ ok: true, license: licenseResponse(access.license) });
  }
  if (!child && request.method === "PATCH") return patchLicense(request, env, licenseId);
  return json({ ok: false, error: "Unsupported license operation" }, 405);
}

async function handleAdminUsers(request, env) {
  const session = await requireSuperAdmin(request, env);
  if (!session) return json({ ok: false, error: "Super admin access required" }, 403);

  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, email, name, role, status, created_at
       FROM users ORDER BY created_at DESC`
    ).all();
    return json({ ok: true, users: results });
  }

  const userId = Number(request.params?.id);
  if (!Number.isInteger(userId) || userId < 1) {
    return json({ ok: false, error: "A valid user id is required" }, 400);
  }
  const body = await request.json();
  const allowedRoles = ["staff", "admin", "super_admin"];
  const allowedStatuses = ["active", "inactive"];
  if (body.role && !allowedRoles.includes(body.role)) {
    return json({ ok: false, error: "Invalid role" }, 400);
  }
  if (body.status && !allowedStatuses.includes(body.status)) {
    return json({ ok: false, error: "Invalid status" }, 400);
  }
  if (userId === session.account_id && body.status === "inactive") {
    return json({ ok: false, error: "You cannot deactivate your own account" }, 400);
  }
  if (userId === session.account_id && body.role && body.role !== "super_admin") {
    return json({ ok: false, error: "You cannot remove your own super admin role" }, 400);
  }

  const target = await env.DB.prepare("SELECT role, status FROM users WHERE id = ?").bind(userId).first();
  if (!target) return json({ ok: false, error: "User not found" }, 404);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users
       SET name = COALESCE(?, name), role = COALESCE(?, role), status = COALESCE(?, status)
       WHERE id = ?`
    ).bind(body.name || null, body.role || null, body.status || null, userId),
    env.DB.prepare(
      `UPDATE people SET name = COALESCE(?, name), status = COALESCE(?, status)
       WHERE source_type = 'user' AND source_id = ?`
    ).bind(body.name || null, body.status || null, userId),
    env.DB.prepare(
      `UPDATE organization_members
       SET member_role = CASE
             WHEN ? IS NOT NULL AND EXISTS (
               SELECT 1 FROM relationships r
               WHERE r.organization_id = organization_members.organization_id
                 AND r.relationship_type = 'internal' AND r.status = 'active'
             ) THEN ?
             ELSE member_role
           END,
           status = COALESCE(?, status)
       WHERE account_type = 'user' AND account_id = ?`
    ).bind(body.role || null, body.role || null, body.status || null, userId),
  ]);
  await writeAudit(env, request, session, "MEMBER_ROLE_OR_STATUS_CHANGED", "user", userId, target, {
    role: body.role || target.role,
    status: body.status || target.status,
  });

  return json({ ok: true, message: "User updated" });
}

function maskRegistrationEmail(email) {
  if (typeof email !== "string") return null;
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const visible = local.length > 2 ? `${local[0]}***${local.slice(-1)}` : `${local[0]}***`;
  return `${visible}${email.slice(at)}`;
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function listAdminLicenseRegistrations(request, env) {
  const url = new URL(request.url);
  const readFilter = (name, maxLength) => {
    const raw = url.searchParams.get(name);
    if (raw === null) return "";
    const value = raw.trim();
    return value.length <= maxLength ? value : null;
  };
  const search = readFilter("q", 100);
  const customerIdValue = readFilter("customer_id", 20);
  const customerId = customerIdValue ? numericId(customerIdValue) : null;
  const licenseStatusValue = readFilter("status", 32);
  const licenseStatus = licenseStatusValue === null ? null : licenseStatusValue.toUpperCase();
  const activationStatus = readFilter("activation", 24);
  const emailStatus = readFilter("email", 16);
  const createdAfter = readFilter("from", 10);
  const createdBefore = readFilter("to", 10);
  const requestedPage = Number(url.searchParams.get("page") || 1);
  const pageSize = Number(url.searchParams.get("page_size") || 25);
  const validStatuses = LICENSE_STATUSES;
  if ([search, customerIdValue, licenseStatus, activationStatus, emailStatus, createdAfter, createdBefore].some((value) => value === null) ||
      (customerIdValue && !customerId) ||
      (licenseStatus && !validStatuses.includes(licenseStatus)) ||
      !["", "active", "never_activated", "released"].includes(activationStatus) ||
      !["", "registered", "missing"].includes(emailStatus) ||
      (createdAfter && !isValidDateOnly(createdAfter)) ||
      (createdBefore && !isValidDateOnly(createdBefore)) ||
      (createdAfter && createdBefore && createdAfter > createdBefore) ||
      !Number.isInteger(requestedPage) || requestedPage < 1 ||
      ![25, 50, 100].includes(pageSize)) {
    return json({ ok: false, error: "Registration filters are invalid" }, 400);
  }

  const registrationsCte = `
    WITH registration_rows AS (
      SELECT l.id AS license_id, l.customer_id, l.serial_number, upper(l.status) AS license_status,
             l.starts_at AS start_date, l.expires_at AS expiry_date, l.seats,
             l.registered_email, c.email AS account_email, c.name AS contact_name,
             COALESCE(NULLIF(o.legal_name, ''), o.name) AS organization_name,
             o.legal_name AS organization_legal_name,
             p.slug AS product_code, p.name AS product_name,
             pe.code AS edition_code, pe.name AS edition_name,
             COALESCE(
               (SELECT MIN(ev.created_at) FROM license_events ev
                WHERE ev.license_id = l.id AND ev.event_type = 'LICENSE_CREATED'),
               c.created_at
             ) AS license_created_at,
             (SELECT MIN(la.activated_at) FROM license_activations la WHERE la.license_id = l.id) AS first_activation_at,
             (SELECT MAX(la.last_seen_at) FROM license_activations la WHERE la.license_id = l.id) AS last_seen_at,
             (SELECT COUNT(*) FROM license_activations la WHERE la.license_id = l.id) AS total_activation_count,
             (SELECT COUNT(*) FROM license_activations la
              WHERE la.license_id = l.id AND la.status = 'active') AS active_activation_count
      FROM licenses l
      JOIN customers c ON c.id = l.customer_id
      JOIN products p ON p.id = l.product_id
      LEFT JOIN organizations o ON o.id = l.organization_id
      LEFT JOIN license_editions le ON le.license_id = l.id
      LEFT JOIN product_editions pe ON pe.id = le.edition_id
    )
  `;
  const conditions = ["1 = 1"];
  const bindings = [];
  if (search) {
    conditions.push(`(
      instr(lower(coalesce(organization_name, '')), lower(?)) > 0 OR
      instr(lower(coalesce(organization_legal_name, '')), lower(?)) > 0 OR
      instr(lower(coalesce(contact_name, '')), lower(?)) > 0 OR
      instr(lower(coalesce(account_email, '')), lower(?)) > 0 OR
      instr(lower(coalesce(registered_email, '')), lower(?)) > 0 OR
      instr(lower(coalesce(serial_number, '')), lower(?)) > 0 OR
      instr(lower(coalesce(product_name, '')), lower(?)) > 0 OR
      instr(lower(coalesce(product_code, '')), lower(?)) > 0
    )`);
    bindings.push(search, search, search, search, search, search, search, search);
  }
  if (customerId) {
    conditions.push("customer_id = ?");
    bindings.push(customerId);
  }
  if (licenseStatus) {
    conditions.push("license_status = ?");
    bindings.push(licenseStatus);
  }
  if (activationStatus === "active") conditions.push("active_activation_count > 0");
  if (activationStatus === "never_activated") conditions.push("total_activation_count = 0");
  if (activationStatus === "released") {
    conditions.push("total_activation_count > 0 AND active_activation_count = 0");
  }
  if (emailStatus === "registered") conditions.push("NULLIF(trim(registered_email), '') IS NOT NULL");
  if (emailStatus === "missing") conditions.push("NULLIF(trim(registered_email), '') IS NULL");
  if (createdAfter) {
    conditions.push("date(license_created_at) >= date(?)");
    bindings.push(createdAfter);
  }
  if (createdBefore) {
    conditions.push("date(license_created_at) <= date(?)");
    bindings.push(createdBefore);
  }
  const whereSql = `WHERE ${conditions.join(" AND ")}`;
  const [total, page, metrics] = await Promise.all([
    env.DB.prepare(`${registrationsCte} SELECT COUNT(*) AS count FROM registration_rows ${whereSql}`)
      .bind(...bindings).first(),
    env.DB.prepare(
      `${registrationsCte} SELECT * FROM registration_rows ${whereSql}
       ORDER BY license_created_at DESC, license_id DESC LIMIT ? OFFSET ?`
    ).bind(...bindings, pageSize, (requestedPage - 1) * pageSize).all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total_licenses,
              (SELECT COUNT(*) FROM license_activations la
               JOIN licenses active_license ON active_license.id = la.license_id
               WHERE la.status = 'active' AND (? IS NULL OR active_license.customer_id = ?)) AS active_installations,
              SUM(CASE WHEN NOT EXISTS (
                SELECT 1 FROM license_activations la WHERE la.license_id = l.id
              ) THEN 1 ELSE 0 END) AS never_activated,
              SUM(CASE WHEN NULLIF(trim(l.registered_email), '') IS NULL AND EXISTS (
                SELECT 1 FROM license_activations la
                WHERE la.license_id = l.id AND la.status = 'active'
              ) THEN 1 ELSE 0 END) AS missing_registered_email
       FROM licenses l
       WHERE (? IS NULL OR l.customer_id = ?)`
    ).bind(customerId, customerId, customerId, customerId).first(),
  ]);
  return json({
    ok: true,
    registrations: (page.results || []).map((record) => ({
      license_id: Number(record.license_id),
      serial_number: record.serial_number,
      license_status: record.license_status,
      start_date: record.start_date,
      expiry_date: record.expiry_date,
      seats: Number(record.seats || 0),
      product: { code: record.product_code, name: record.product_name },
      edition: record.edition_code ? { code: record.edition_code, name: record.edition_name } : null,
      organization_name: record.organization_name,
      contact_email_masked: maskRegistrationEmail(record.account_email),
      registered_email_masked: maskRegistrationEmail(record.registered_email),
      license_created_at: record.license_created_at || null,
      first_activation_at: record.first_activation_at || null,
      last_seen_at: record.last_seen_at || null,
      total_activation_count: Number(record.total_activation_count || 0),
      active_activation_count: Number(record.active_activation_count || 0),
    })),
    total: Number(total?.count || 0),
    page: requestedPage,
    page_size: pageSize,
    metrics: {
      total_licenses: Number(metrics?.total_licenses || 0),
      active_installations: Number(metrics?.active_installations || 0),
      never_activated: Number(metrics?.never_activated || 0),
      missing_registered_email: Number(metrics?.missing_registered_email || 0),
    },
  });
}

async function getAdminLicenseRegistration(request, env, session, licenseId) {
  const id = numericId(licenseId);
  if (!id) return json({ ok: false, error: "A valid license id is required" }, 400);
  const registration = await env.DB.prepare(
    `SELECT l.id AS license_id, l.serial_number, upper(l.status) AS license_status,
            l.starts_at AS start_date, l.expires_at AS expiry_date, l.registered_email,
            c.email AS account_email, c.name AS contact_name, c.phone AS contact_phone,
            c.company AS customer_company, c.status AS customer_status, c.created_at AS customer_created_at,
            COALESCE(NULLIF(o.legal_name, ''), o.name) AS organization_name,
            o.legal_name AS organization_legal_name,
            o.city AS organization_city, o.state AS organization_state,
            COALESCE(
              (SELECT MIN(ev.created_at) FROM license_events ev
               WHERE ev.license_id = l.id AND ev.event_type = 'LICENSE_CREATED'),
              c.created_at
            ) AS license_created_at,
            (SELECT MIN(la.activated_at) FROM license_activations la WHERE la.license_id = l.id) AS first_activation_at,
            (SELECT MAX(la.last_seen_at) FROM license_activations la WHERE la.license_id = l.id) AS last_seen_at,
            (SELECT COUNT(*) FROM license_activations la WHERE la.license_id = l.id) AS total_activation_count,
            (SELECT COUNT(*) FROM license_activations la
             WHERE la.license_id = l.id AND la.status = 'active') AS active_activation_count
     FROM licenses l
     JOIN customers c ON c.id = l.customer_id
     LEFT JOIN organizations o ON o.id = l.organization_id
     WHERE l.id = ?`
  ).bind(id).first();
  if (!registration) return json({ ok: false, error: "License registration not found" }, 404);

  await writeAudit(env, request, session, "ADMIN_LICENSE_REGISTRATION_VIEWED", "license", id, null, {
    view: "registration_details",
  });
  return json({
    ok: true,
    registration: {
      ...registration,
      registered_email: registration.registered_email || null,
      license_created_at: registration.license_created_at || null,
      first_activation_at: registration.first_activation_at || null,
      last_seen_at: registration.last_seen_at || null,
      total_activation_count: Number(registration.total_activation_count || 0),
      active_activation_count: Number(registration.active_activation_count || 0),
    },
  });
}

async function handleAdminControl(request, env, resource) {
  const session = await requireSuperAdmin(request, env);
  if (!session) return json({ ok: false, error: "Super admin access required" }, 403);

  if (resource === "d1-operations") {
    const snapshots = await env.DB.prepare(
      `SELECT database_name, sampled_at, size_bytes
       FROM d1_storage_snapshots
       WHERE database_name = 'smritisys-db'
       ORDER BY sampled_at DESC LIMIT 60`
    ).all();
    return json({
      ok: true,
      databases: ["smritisys-db"],
      manual_backup_status: "not_configured",
      recovery: {
        provider: "cloudflare_d1_time_travel",
        status: "plan_dependent",
        retention_days: null,
      },
      limits: {
        free_per_database_bytes: 500000000,
        paid_per_database_bytes: 10000000000,
        free_account_bytes: 5000000000,
        paid_account_bytes: 1000000000000,
        free_databases_per_account: 10,
        paid_databases_per_account: 1000000,
      },
      snapshots: snapshots.results || [],
      manual_backups: [],
    });
  }

  if (resource === "license-registrations") return listAdminLicenseRegistrations(request, env);
  const registrationMatch = resource.match(/^license-registration:(\d+)$/);
  if (registrationMatch) return getAdminLicenseRegistration(request, env, session, registrationMatch[1]);

  if (resource === "overview") {
    const [
      users,
      customers,
      organizations,
      products,
      licenses,
      codeInventory,
      recentActivity,
      licenseStatuses,
      activeCustomerOrganizations,
      activeMemberships,
      partnerCategories,
      licenseUtilization,
      supportTicketStatuses,
      releaseStatuses,
      customerInvitationStatuses,
    ] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM users").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM customers").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM organizations").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM products WHERE status = 'active'").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM licenses").first(),
      env.DB.prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END), 0) AS available,
           COALESCE(SUM(CASE WHEN status = 'available' AND delivery_status = 'not_issued' THEN 1 ELSE 0 END), 0) AS pending_delivery
         FROM license_code_inventory`
      ).first(),
      env.DB.prepare(
        `SELECT a.action, a.resource_type, a.resource_id,
                COALESCE(NULLIF(p.name, ''), 'System') AS actor_name,
                o.name AS organization_name, a.created_at
         FROM audit_logs a
         LEFT JOIN people p ON p.id = a.actor_person_id
         LEFT JOIN organizations o ON o.id = a.organization_id
         ORDER BY a.id DESC LIMIT 6`
      ).all(),
      env.DB.prepare(
        `SELECT lower(status) AS status, COUNT(*) AS count,
                SUM(CASE
                  WHEN lower(status) = 'active'
                    AND expires_at IS NOT NULL
                    AND date(expires_at) BETWEEN date('now') AND date('now', '+30 days')
                  THEN 1 ELSE 0
                END) AS expiring_soon
         FROM licenses GROUP BY lower(status)`
      ).all(),
      env.DB.prepare(
        `SELECT COUNT(DISTINCT o.id) AS count
         FROM organizations o
         JOIN relationships r ON r.organization_id = o.id
         WHERE o.status = 'active' AND r.status = 'active'
           AND r.relationship_type = 'customer'`
      ).first(),
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM organization_members WHERE status = 'active'"
      ).first(),
      env.DB.prepare(
        `SELECT r.relationship_type AS category, COUNT(DISTINCT o.id) AS count
         FROM organizations o
         JOIN relationships r ON r.organization_id = o.id
         WHERE o.status = 'active' AND r.status = 'active'
           AND r.relationship_type IN (?, ?, ?, ?, ?, ?)
         GROUP BY r.relationship_type`
      ).bind(...ADMIN_PARTNER_TYPES).all(),
      env.DB.prepare(
        `SELECT COUNT(*) AS active_licenses,
                COALESCE(SUM(l.seats), 0) AS licensed_seats,
                COALESCE(SUM((
                  SELECT COUNT(*) FROM license_activations la
                  WHERE la.license_id = l.id AND la.status = 'active'
                )), 0) AS active_activations
         FROM licenses l
         WHERE l.status = 'ACTIVE'
           AND (l.starts_at IS NULL OR date(l.starts_at) <= date('now'))
           AND (l.expires_at IS NULL OR date(l.expires_at) >= date('now'))`
      ).first(),
      env.DB.prepare(
        `SELECT lower(status) AS status, COUNT(*) AS count
         FROM support_tickets GROUP BY lower(status) ORDER BY lower(status)`
      ).all(),
      env.DB.prepare(
        `SELECT lower(status) AS status, COUNT(*) AS count
         FROM releases GROUP BY lower(status) ORDER BY lower(status)`
      ).all(),
      env.DB.prepare(
        `SELECT CASE
                  WHEN status = 'pending' AND expires_at <= datetime('now') THEN 'expired'
                  ELSE status
                END AS status,
                COUNT(*) AS count
         FROM customer_invites
         GROUP BY status ORDER BY status`
      ).all(),
    ]);
    const licenseStatusCounts = Object.fromEntries(
      (licenseStatuses.results || []).map((row) => [row.status, Number(row.count)]),
    );
    const expiringSoon = (licenseStatuses.results || []).reduce(
      (total, row) => total + Number(row.expiring_soon || 0),
      0,
    );
    const partnerCategoryCounts = new Map(
      (partnerCategories.results || []).map((row) => [row.category, Number(row.count)]),
    );
    const utilization = {
      active_licenses: Number(licenseUtilization?.active_licenses || 0),
      licensed_seats: Number(licenseUtilization?.licensed_seats || 0),
      active_activations: Number(licenseUtilization?.active_activations || 0),
    };
    return json({
      ok: true,
      metrics: { users: users.count, customers: customers.count, organizations: organizations.count, products: products.count, licenses: licenses.count },
      license_statuses: licenseStatusCounts,
      expiring_soon: expiringSoon,
      code_inventory: {
        available: Number(codeInventory?.available || 0),
        pending_delivery: Number(codeInventory?.pending_delivery || 0),
      },
      operational_metrics: {
        active_customer_organizations: Number(activeCustomerOrganizations?.count || 0),
        active_organization_memberships: Number(activeMemberships?.count || 0),
        active_partners_by_category: ADMIN_PARTNER_TYPES.map((category) => ({
          category,
          count: partnerCategoryCounts.get(category) || 0,
        })),
        license_utilization: utilization,
        support_ticket_statuses: (supportTicketStatuses.results || []).map((row) => ({
          status: row.status,
          count: Number(row.count),
        })),
        release_statuses: (releaseStatuses.results || []).map((row) => ({
          status: row.status,
          count: Number(row.count),
        })),
        deployment_status: { available: false },
        customer_invitation_statuses: (customerInvitationStatuses.results || []).map((row) => ({
          status: row.status,
          count: Number(row.count),
        })),
      },
      recent_activity: recentActivity.results || [],
    });
  }

  if (resource === "organizations") {
    const { results } = await env.DB.prepare(
      `SELECT o.id, o.name, o.legal_name, o.address, o.city, o.state, o.pincode,
              o.country, o.phone, o.gst_number, o.tax_id, o.website, o.status, o.created_at,
              COUNT(DISTINCT m.id) AS member_count,
              GROUP_CONCAT(DISTINCT r.relationship_type) AS relationship_types
       FROM organizations o
       LEFT JOIN organization_members m ON m.organization_id = o.id AND m.status = 'active'
       LEFT JOIN relationships r ON r.organization_id = o.id AND r.status = 'active'
       GROUP BY o.id ORDER BY o.created_at DESC, o.id DESC`
    ).all();
    return json({ ok: true, organizations: results });
  }

  const organizationDetailMatch = resource.match(/^organization:(\d+)$/);
  if (organizationDetailMatch) {
    const organizationId = numericId(organizationDetailMatch[1]);
    if (!organizationId) return json({ ok: false, error: "A valid organization id is required" }, 400);
    const organization = await env.DB.prepare(
      `SELECT id, name, legal_name, gst_number, tax_id, address, city, state, pincode,
              country, phone, website, status, created_at,
              (SELECT GROUP_CONCAT(r.relationship_type)
               FROM relationships r
               WHERE r.organization_id = organizations.id AND r.status = 'active') AS relationship_types
       FROM organizations WHERE id = ?`
    ).bind(organizationId).first();
    if (!organization) return json({ ok: false, error: "Organization not found" }, 404);
    const [members, relationships, licenses] = await Promise.all([
      env.DB.prepare(
        `SELECT om.account_type, om.account_id, om.member_role, om.status, om.created_at,
                p.name, p.email
         FROM organization_members om
         LEFT JOIN people p ON p.source_type = om.account_type AND p.source_id = om.account_id
         WHERE om.organization_id = ?
         ORDER BY om.status, p.name, p.email`
      ).bind(organizationId).all(),
      env.DB.prepare(
        `SELECT 'Customer' AS relationship_type, customer.id AS organization_id,
                customer.name AS organization_name, pcl.status, pcl.created_at
         FROM partner_customer_links pcl
         JOIN organizations customer ON customer.id = pcl.customer_organization_id
         WHERE pcl.partner_organization_id = ?
         UNION ALL
         SELECT 'Partner' AS relationship_type, partner.id AS organization_id,
                partner.name AS organization_name, pcl.status, pcl.created_at
         FROM partner_customer_links pcl
         JOIN organizations partner ON partner.id = pcl.partner_organization_id
         WHERE pcl.customer_organization_id = ?
         ORDER BY relationship_type, organization_name`
      ).bind(organizationId, organizationId).all(),
      env.DB.prepare(
        `SELECT l.id, l.serial_number, l.status, l.starts_at, l.expires_at, l.seats,
                p.name AS product_name, p.slug AS product_code
         FROM organization_members om
         JOIN licenses l ON l.customer_id = om.account_id
           AND l.organization_id = om.organization_id
         JOIN products p ON p.id = l.product_id
         WHERE om.organization_id = ? AND om.account_type = 'customer'
         ORDER BY l.id DESC`
      ).bind(organizationId).all(),
    ]);
    return json({
      ok: true,
      organization,
      members: members.results || [],
      relationships: relationships.results || [],
      licenses: licenses.results || [],
    }, 200, null, { "Cache-Control": "no-store" });
  }

  if (resource === "audit") {
    const { results } = await env.DB.prepare(
      `SELECT id, actor_person_id, organization_id, action, resource_type,
              resource_id, request_ip, created_at
       FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 200`
    ).all();
    return json({ ok: true, audit: results });
  }

  return json({ ok: false, error: "Unsupported admin operation" }, 405);
}

async function handleAdminCustomers(request, env, customerId = null) {
  const session = await requireSuperAdmin(request, env);
  if (!session) return json({ ok: false, error: "Super admin access required" }, 403);

  if (!customerId && request.method === "GET") {
    const url = new URL(request.url);
    const suppliedQuery = url.searchParams.get("q") || "";
    const query = suppliedQuery ? boundedString(suppliedQuery, 100) : "";
    if (suppliedQuery && !query) return json({ ok: false, error: "Search text must be 100 characters or fewer" }, 400);
    const pattern = query ? `%${query.toLowerCase()}%` : "";
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.email, c.name, c.phone, c.company, c.status, c.created_at,
              (SELECT CASE WHEN COUNT(*) = 1 THEN MAX(o.name)
                           WHEN COUNT(*) > 1 THEN 'Multiple organizations' END
               FROM organization_members om
               JOIN organizations o ON o.id = om.organization_id
               WHERE om.account_type = 'customer' AND om.account_id = c.id
                 AND om.status = 'active' AND o.status = 'active') AS organization_name,
              (SELECT COUNT(*) FROM licenses l WHERE l.customer_id = c.id) AS license_count
       FROM customers c
       WHERE ? = ''
          OR CAST(c.id AS TEXT) = ?
          OR lower(COALESCE(c.email, '')) LIKE ?
          OR lower(COALESCE(c.name, '')) LIKE ?
          OR lower(COALESCE(c.phone, '')) LIKE ?
          OR lower(COALESCE(c.company, '')) LIKE ?
          OR EXISTS (
            SELECT 1 FROM organization_members om
            JOIN organizations o ON o.id = om.organization_id
            WHERE om.account_type = 'customer' AND om.account_id = c.id
              AND om.status = 'active' AND o.status = 'active'
              AND lower(o.name) LIKE ?
          )
       ORDER BY c.id DESC LIMIT 200`
    ).bind(query, query, pattern, pattern, pattern, pattern, pattern).all();
    return json({ ok: true, customers: results || [] }, 200, null, { "Cache-Control": "no-store" });
  }

  const id = numericId(String(customerId || ""));
  if (!id) return json({ ok: false, error: "A valid customer id is required" }, 400);

  if (request.method === "GET") {
    const profile = await env.DB.prepare(
      `SELECT c.id, c.email, c.name, c.phone, c.company, c.status, c.created_at,
              cp.gst_number, cp.website, cp.bio, cp.timezone, cp.updated_at AS profile_updated_at
       FROM customers c
       LEFT JOIN customer_profiles cp ON cp.customer_id = c.id
       WHERE c.id = ?`
    ).bind(id).first();
    if (!profile) return json({ ok: false, error: "Customer not found" }, 404);
    const [organizations, addresses, partners] = await Promise.all([
      env.DB.prepare(
        `SELECT o.id, o.name, o.legal_name, o.gst_number, o.address, o.city, o.state,
                o.pincode, o.country, o.phone, o.tax_id, o.website, o.status,
                om.member_role, om.status AS membership_status
         FROM organization_members om
         JOIN organizations o ON o.id = om.organization_id
         WHERE om.account_type = 'customer' AND om.account_id = ?
         ORDER BY om.id`
      ).bind(id).all(),
      env.DB.prepare(
        `SELECT id, address_type, address_line1, address_line2, city, state,
                postal_code, country, is_default
         FROM customer_addresses WHERE customer_id = ?
         ORDER BY is_default DESC, id`
      ).bind(id).all(),
      env.DB.prepare(
        `SELECT DISTINCT p.id, p.name, pcl.status
         FROM organization_members om
         JOIN partner_customer_links pcl ON pcl.customer_organization_id = om.organization_id
         JOIN organizations p ON p.id = pcl.partner_organization_id
         WHERE om.account_type = 'customer' AND om.account_id = ?
         ORDER BY p.name`
      ).bind(id).all(),
    ]);
    await writeAudit(env, request, session, "ADMIN_CUSTOMER_PROFILE_VIEWED", "customer", id, null, {
      organizations: (organizations.results || []).length,
    });
    return json({
      ok: true,
      profile,
      organizations: organizations.results || [],
      addresses: addresses.results || [],
      partners: partners.results || [],
    }, 200, null, { "Cache-Control": "no-store" });
  }

  if (request.method !== "PATCH") return json({ ok: false, error: "Unsupported customer profile operation" }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid customer profile is required" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "A valid customer profile is required" }, 400);
  }
  const allowedFields = new Set(["name", "phone", "gst_number", "website", "bio", "timezone", "addresses"]);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    return json({ ok: false, error: "Customer id, login email, and account status are not editable here" }, 400);
  }
  const name = boundedString(body.name, 120);
  const phone = boundedString(body.phone, 40);
  const optionalFields = [
    ["gst_number", body.gst_number, 80],
    ["website", body.website, 255],
    ["bio", body.bio, 2000],
    ["timezone", body.timezone, 100],
  ];
  if (!name || !phone || optionalFields.some(([, value, maxLength]) =>
    value != null && (typeof value !== "string" || value.trim().length > maxLength))) {
    return json({ ok: false, error: "A valid name, phone number, and customer profile are required" }, 400);
  }
  const addressesProvided = Object.prototype.hasOwnProperty.call(body, "addresses");
  if (addressesProvided && (!Array.isArray(body.addresses) || body.addresses.length > 20)) {
    return json({ ok: false, error: "Customer addresses must be a list of at most 20 entries" }, 400);
  }
  const addresses = addressesProvided ? body.addresses.map((address) => {
    if (!address || typeof address !== "object" || Array.isArray(address) ||
        Object.keys(address).some((field) => !["id", "address_type", "address_line1", "address_line2", "city", "state", "postal_code", "country", "is_default"].includes(field))) {
      return null;
    }
    const id = address.id == null || address.id === "" ? null : numericId(String(address.id));
    const addressType = boundedString(address.address_type, 30);
    const addressLine1 = boundedString(address.address_line1, 255);
    const optionalAddressFields = [
      ["address_line2", address.address_line2, 255],
      ["city", address.city, 120],
      ["state", address.state, 120],
      ["postal_code", address.postal_code, 32],
      ["country", address.country, 120],
    ];
    if ((address.id != null && address.id !== "" && !id) || !addressType || !addressLine1 ||
        optionalAddressFields.some(([, value, maxLength]) =>
          value != null && (typeof value !== "string" || value.trim().length > maxLength)) ||
        ![undefined, null, true, false, 0, 1].includes(address.is_default)) {
      return null;
    }
    return {
      id,
      address_type: addressType,
      address_line1: addressLine1,
      address_line2: optionalPartnerOrganizationValue(address.address_line2, 255),
      city: optionalPartnerOrganizationValue(address.city, 120),
      state: optionalPartnerOrganizationValue(address.state, 120),
      postal_code: optionalPartnerOrganizationValue(address.postal_code, 32),
      country: optionalPartnerOrganizationValue(address.country, 120) || "India",
      is_default: address.is_default === true || address.is_default === 1 ? 1 : 0,
    };
  }) : [];
  if (addressesProvided && (addresses.some((address) => !address) ||
      addresses.filter((address) => address.is_default).length > 1 ||
      new Set(addresses.filter((address) => address.id).map((address) => address.id)).size !== addresses.filter((address) => address.id).length)) {
    return json({ ok: false, error: "Each address must be valid and at most one can be marked as default" }, 400);
  }
  const current = await env.DB.prepare(
    `SELECT c.name, c.phone, cp.gst_number, cp.website, cp.bio, cp.timezone
     FROM customers c LEFT JOIN customer_profiles cp ON cp.customer_id = c.id
     WHERE c.id = ?`
  ).bind(id).first();
  if (!current) return json({ ok: false, error: "Customer not found" }, 404);
  const profileValues = Object.fromEntries(optionalFields.map(([field, value, maxLength]) => [
    field,
    Object.prototype.hasOwnProperty.call(body, field)
      ? optionalPartnerOrganizationValue(value, maxLength)
      : current[field] ?? null,
  ]));
  const timezoneProvided = Object.prototype.hasOwnProperty.call(body, "timezone");
  const websiteProvided = Object.prototype.hasOwnProperty.call(body, "website");
  profileValues.timezone = profileValues.timezone || "Asia/Kolkata";
  if (websiteProvided && profileValues.website) {
    try {
      const website = new URL(profileValues.website);
      if (!["http:", "https:"].includes(website.protocol)) throw new TypeError("Unsupported website protocol");
    } catch {
      return json({ ok: false, error: "Website must be a valid HTTP or HTTPS URL" }, 400);
    }
  }
  if (timezoneProvided) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: profileValues.timezone });
    } catch {
      return json({ ok: false, error: "A valid timezone is required" }, 400);
    }
  }
  const updates = { name, phone, ...profileValues };
  const changedFields = Object.keys(updates).filter((field) =>
    String(current[field] ?? "") !== String(updates[field] ?? ""));
  let currentAddresses = [];
  if (addressesProvided) {
    const { results } = await env.DB.prepare(
      `SELECT id, address_type, address_line1, address_line2, city, state, postal_code, country, is_default
       FROM customer_addresses WHERE customer_id = ? ORDER BY id`
    ).bind(id).all();
    currentAddresses = results || [];
    const existingIds = addresses.filter((address) => address.id).map((address) => address.id);
    if (existingIds.length) {
      const placeholders = existingIds.map(() => "?").join(",");
      const { results: ownedAddresses } = await env.DB.prepare(
        `SELECT id FROM customer_addresses WHERE customer_id = ? AND id IN (${placeholders})`
      ).bind(id, ...existingIds).all();
      if ((ownedAddresses || []).length !== existingIds.length) {
        return json({ ok: false, error: "One or more addresses do not belong to this customer" }, 404);
      }
    }
    const oldById = new Map(currentAddresses.map((address) => [Number(address.id), address]));
    const addressChanges = addresses.some((address) => {
      if (!address.id) return true;
      const old = oldById.get(address.id);
      return !old || ["address_type", "address_line1", "address_line2", "city", "state", "postal_code", "country", "is_default"]
        .some((field) => String(old[field] ?? "") !== String(address[field] ?? ""));
    });
    if (addressChanges) changedFields.push("addresses");
  }
  if (changedFields.length) {
    const statements = [
      env.DB.prepare("UPDATE customers SET name = ?, phone = ? WHERE id = ?").bind(name, phone, id),
      env.DB.prepare(
        "UPDATE people SET name = ? WHERE source_type = 'customer' AND source_id = ?"
      ).bind(name, id),
      env.DB.prepare(
        `INSERT INTO customer_profiles (customer_id, gst_number, website, bio, timezone, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(customer_id) DO UPDATE SET
           gst_number = excluded.gst_number, website = excluded.website,
           bio = excluded.bio, timezone = excluded.timezone, updated_at = datetime('now')`
      ).bind(id, profileValues.gst_number, profileValues.website, profileValues.bio, profileValues.timezone),
    ];
    if (addressesProvided && changedFields.includes("addresses")) {
      if (addresses.some((address) => address.is_default)) {
        statements.push(env.DB.prepare("UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?").bind(id));
      }
      for (const address of addresses) {
        statements.push(address.id
          ? env.DB.prepare(
            `UPDATE customer_addresses SET address_type = ?, address_line1 = ?, address_line2 = ?,
             city = ?, state = ?, postal_code = ?, country = ?, is_default = ?
             WHERE id = ? AND customer_id = ?`
          ).bind(
            address.address_type, address.address_line1, address.address_line2, address.city,
            address.state, address.postal_code, address.country, address.is_default, address.id, id,
          )
          : env.DB.prepare(
            `INSERT INTO customer_addresses
             (customer_id, address_type, address_line1, address_line2, city, state, postal_code, country, is_default)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            id, address.address_type, address.address_line1, address.address_line2, address.city,
            address.state, address.postal_code, address.country, address.is_default,
          ));
      }
    }
    await env.DB.batch(statements);
    await writeAudit(env, request, session, "ADMIN_CUSTOMER_PROFILE_UPDATED", "customer", id, {
      fields: changedFields,
    }, {
      fields: changedFields,
    });
  }
  return json({ ok: true, updated_fields: changedFields }, 200, null, { "Cache-Control": "no-store" });
}

async function createAdminCustomerPasswordReset(request, env, customerId) {
  const session = await requireSuperAdmin(request, env);
  if (!session) return json({ ok: false, error: "Super admin access required" }, 403);
  const limited = await requireRateLimit(
    env, request, "admin-customer-password-reset", 10, 3600, String(session.person_id),
  );
  if (limited) return limited;
  const customer = await env.DB.prepare(
    "SELECT id, status FROM customers WHERE id = ?"
  ).bind(customerId).first();
  if (!customer) return json({ ok: false, error: "Customer not found" }, 404);
  if (!["active", "trial"].includes(customer.status)) {
    return json({ ok: false, error: "Only active customer accounts can reset their password" }, 409);
  }

  const token = makeToken();
  const tokenHash = await hashCustomerInviteToken(token);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE customer_password_resets SET status = 'revoked' WHERE customer_id = ? AND status = 'pending'"
    ).bind(customer.id),
    env.DB.prepare(
      `INSERT INTO customer_password_resets (token_hash, customer_id, created_by, expires_at)
       VALUES (?, ?, ?, datetime('now', '+30 minutes'))`
    ).bind(tokenHash, customer.id, session.person_id),
  ]);
  await writeAudit(env, request, session, "CUSTOMER_PASSWORD_RESET_LINK_CREATED", "customer", customer.id, null, {
    expires_in_minutes: 30,
  });
  return json({
    ok: true,
    reset_path: `/reset-password.html#token=${token}`,
    expires_in_minutes: 30,
  }, 201, null, { "Cache-Control": "no-store" });
}

async function completeCustomerPasswordReset(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid password reset request is required" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "A valid password reset request is required" }, 400);
  }
  const token = body.token;
  const password = boundedString(body.password, 128);
  if (!isValidCustomerInviteToken(token) || !password || password.length < 12) {
    return json({ ok: false, error: "A valid reset link and password of at least 12 characters are required" }, 400);
  }
  const limited = await requireRateLimit(env, request, "customer-password-reset-complete", 10, 900);
  if (limited) return limited;

  const tokenHash = await hashCustomerInviteToken(token);
  const reset = await env.DB.prepare(
    `SELECT r.id, r.customer_id,
            (SELECT CASE WHEN COUNT(*) = 1 THEN MAX(om.organization_id) END
             FROM organization_members om
             JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
             WHERE om.account_type = 'customer' AND om.account_id = r.customer_id
               AND om.status = 'active') AS organization_id
     FROM customer_password_resets r
     JOIN customers c ON c.id = r.customer_id AND c.status IN ('active', 'trial')
     WHERE r.token_hash = ? AND r.status = 'pending' AND r.expires_at > datetime('now')
     LIMIT 1`
  ).bind(tokenHash).first();
  if (!reset) {
    return json({ ok: false, error: "This password reset link is invalid, expired, or already used" }, 410, null, {
      "Cache-Control": "no-store",
    });
  }
  const passwordHash = await hashPassword(password);
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE customer_password_resets
       SET status = 'used', used_at = datetime('now')
       WHERE id = ? AND status = 'pending' AND expires_at > datetime('now')`
    ).bind(reset.id),
    env.DB.prepare(
      `UPDATE customers SET password_hash = ?
       WHERE id = ? AND status IN ('active', 'trial') AND changes() = 1`
    ).bind(passwordHash, reset.customer_id),
    env.DB.prepare(
      "DELETE FROM sessions WHERE account_type = 'customer' AND account_id = ? AND changes() = 1"
    ).bind(reset.customer_id),
  ]);
  if (results[1]?.meta?.changes !== 1) {
    return json({ ok: false, error: "This password reset link is invalid, expired, or already used" }, 410, null, {
      "Cache-Control": "no-store",
    });
  }
  await writeAudit(env, request, {
    person_id: null,
    organization_id: reset.organization_id,
  }, "CUSTOMER_PASSWORD_RESET_COMPLETED", "customer", reset.customer_id, null, {
    password_reset: true,
  });
  return json({ ok: true, message: "Password updated. Please sign in again." }, 200, null, {
    "Cache-Control": "no-store",
  });
}

async function handleProfile(request, env) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  if (!(await hasPermission(env, session, "organization.view"))) {
    return json({ ok: false, error: "Organization access required" }, 403);
  }

  if (request.method === "GET") {
    const profile = await env.DB.prepare(
      `SELECT c.id, c.email, c.name, c.phone, c.company, c.status,
              p.gst_number, p.website, p.bio, p.timezone
       FROM customers c
       LEFT JOIN customer_profiles p ON p.customer_id = c.id
       WHERE c.id = ?`
    )
      .bind(session.account_id)
      .first();
    return json({ ok: true, profile });
  }

  const body = await request.json();
  const name = boundedString(body.name, 120);
  const phone = boundedString(body.phone, 40);
  if (!name || !phone) {
    return json({ ok: false, error: "Name and phone number are required" }, 400);
  }

  await env.DB.prepare(`UPDATE customers SET name = ?, phone = ? WHERE id = ?`).bind(name, phone, session.account_id).run();
  await writeAudit(env, request, session, "CUSTOMER_PROFILE_UPDATED", "customer", session.account_id, null, { name, phone });

  return json({ ok: true, message: "Profile updated" });
}

async function handleOrganization(request, env) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  if (!(await hasPermission(env, session, "organization.view"))) {
    return json({ ok: false, error: "Organization access required" }, 403);
  }
  const organization = await env.DB.prepare(
    `SELECT o.id, o.name, o.legal_name, o.gst_number, o.status, o.created_at,
            m.member_role AS current_role
     FROM organizations o
     JOIN organization_members m ON m.organization_id = o.id
       AND m.account_type = 'customer' AND m.account_id = ? AND m.status = 'active'
     WHERE o.id = ? AND o.status = 'active'`
  ).bind(session.account_id, session.organization_id).first();
  if (!organization) return json({ ok: false, error: "Organization not found" }, 404);
  const { results: members } = await env.DB.prepare(
    `SELECT p.id, p.name, p.email, m.member_role, m.status
     FROM people p
     JOIN organization_members m ON m.account_type = p.source_type AND m.account_id = p.source_id
     WHERE m.organization_id = ? AND m.status = 'active'
     ORDER BY p.name, p.email`
  ).bind(session.organization_id).all();
  return json({ ok: true, organization, members });
}

async function ensureDefaultAccounts(env, customerId) {
  const defaults = [
    ["1000", "Cash", "asset"],
    ["1100", "Accounts Receivable", "asset"],
    ["2000", "Accounts Payable", "liability"],
    ["4000", "Sales", "income"],
    ["5000", "Purchases", "expense"],
  ];
  const statements = defaults.map(([code, name, accountType]) => env.DB.prepare(
    `INSERT OR IGNORE INTO accounting_accounts (customer_id, code, name, account_type)
     VALUES (?, ?, ?, ?)`
  ).bind(customerId, code, name, accountType));
  await env.DB.batch(statements);
}

async function handleAccounting(request, env, resource) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  return json({ ok: false, error: "Operational accounting belongs to SMRITI Retail OS" }, 403);
  const customerId = session.account_id;
  await ensureDefaultAccounts(env, customerId);

  if (resource === "accounts") {
    if (request.method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT id, code, name, account_type, opening_balance, status
         FROM accounting_accounts WHERE customer_id = ? ORDER BY code`
      ).bind(customerId).all();
      return json({ ok: true, accounts: results });
    }

    const body = await request.json();
    const allowedTypes = ["asset", "liability", "income", "expense", "equity"];
    if (!body.code || !body.name || !allowedTypes.includes(body.account_type)) {
      return json({ ok: false, error: "Code, name, and a valid account type are required" }, 400);
    }
    try {
      await env.DB.prepare(
        `INSERT INTO accounting_accounts
         (customer_id, code, name, account_type, opening_balance)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(customerId, body.code, body.name, body.account_type, Number(body.opening_balance) || 0).run();
      return json({ ok: true, message: "Account created" }, 201);
    } catch (error) {
      if (String(error).includes("UNIQUE")) return json({ ok: false, error: "Account code already exists" }, 409);
      throw error;
    }
  }

  if (resource === "contacts") {
    if (request.method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT id, contact_type, name, email, phone, gst_number, opening_balance, status
         FROM accounting_contacts WHERE customer_id = ? ORDER BY name`
      ).bind(customerId).all();
      return json({ ok: true, contacts: results });
    }
    const body = await request.json();
    if (!body.name || !["customer", "supplier"].includes(body.contact_type)) {
      return json({ ok: false, error: "Name and contact type are required" }, 400);
    }
    await env.DB.prepare(
      `INSERT INTO accounting_contacts
       (customer_id, contact_type, name, email, phone, gst_number, opening_balance)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(customerId, body.contact_type, body.name, body.email || null, body.phone || null, body.gst_number || null, Number(body.opening_balance) || 0).run();
    return json({ ok: true, message: `${body.contact_type === "customer" ? "Customer" : "Supplier"} created` }, 201);
  }

  const simpleDocuments = {
    receipts: { table: "accounting_receipts", number: "receipt_number", contact: "contact_id", reference: "invoice_reference", date: "receipt_date" },
    payments: { table: "accounting_supplier_payments", number: "payment_number", contact: "contact_id", reference: "bill_reference", date: "payment_date" },
    notes: { table: "accounting_notes", number: "note_number", contact: "contact_id", reference: "document_reference", date: "note_date" },
  };
  if (simpleDocuments[resource]) {
    const config = simpleDocuments[resource];
    if (request.method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT * FROM ${config.table} WHERE customer_id = ? ORDER BY ${config.date} DESC, id DESC`
      ).bind(customerId).all();
      return json({ ok: true, [resource]: results });
    }
    const body = await request.json();
    const required = resource === "notes"
      ? [config.number, "note_type", "party_type", config.date, "amount", "reason"]
      : [config.number, config.date, "amount", "payment_mode"];
    if (required.some((field) => !body[field])) {
      return json({ ok: false, error: "Complete the required document fields" }, 400);
    }
    if (resource === "notes" && (!["debit", "credit"].includes(body.note_type) || !["customer", "supplier"].includes(body.party_type))) {
      return json({ ok: false, error: "Invalid note or party type" }, 400);
    }
    try {
      const columns = ["customer_id", config.number, config.contact, config.reference, config.date, "amount"];
      const values = [customerId, body[config.number], body[config.contact] || null, body[config.reference] || null, body[config.date], Number(body.amount) || 0];
      if (resource === "notes") {
        columns.push("note_type", "party_type", "reason");
        values.push(body.note_type, body.party_type, body.reason);
      } else {
        columns.push("payment_mode", "notes");
        values.push(body.payment_mode, body.notes || null);
      }
      const placeholders = columns.map(() => "?").join(", ");
      await env.DB.prepare(`INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${placeholders})`).bind(...values).run();
      return json({ ok: true, message: `${resource === "receipts" ? "Receipt" : resource === "payments" ? "Supplier payment" : "Note"} saved` }, 201);
    } catch (error) {
      if (String(error).includes("UNIQUE")) return json({ ok: false, error: "Document number already exists" }, 409);
      throw error;
    }
  }

  if (resource === "invoices" || resource === "purchases") {
    if (request.method === "GET") {
      const table = resource === "invoices" ? "accounting_invoices" : "accounting_purchases";
      const orderField = resource === "invoices" ? "invoice_date" : "purchase_date";
      const { results } = await env.DB.prepare(
        `SELECT * FROM ${table} WHERE customer_id = ? ORDER BY ${orderField} DESC, id DESC`
      ).bind(customerId).all();
      return json({ ok: true, [resource]: results });
    }

    const body = await request.json();
    const items = Array.isArray(body.items) ? body.items : [];
    const isInvoice = resource === "invoices";
    const number = isInvoice ? body.invoice_number : body.bill_number;
    const partyName = isInvoice ? body.buyer_name : body.supplier_name;
    const date = isInvoice ? body.invoice_date : body.purchase_date;
    if (!number || !partyName || !date || !items.length) {
      return json({ ok: false, error: "Document number, party name, date, and at least one item are required" }, 400);
    }

    const normalizedItems = items.map((item) => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unit_price) || 0;
      const taxRate = Number(item.tax_rate) || 0;
      const base = quantity * unitPrice;
      return { description: item.description, quantity, unitPrice, taxRate, lineTotal: base + (base * taxRate / 100) };
    });
    if (normalizedItems.some((item) => !item.description || item.quantity <= 0 || item.unitPrice < 0)) {
      return json({ ok: false, error: "Each item needs a description, positive quantity, and valid price" }, 400);
    }
    const subtotal = normalizedItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const total = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const tax = total - subtotal;
    const table = isInvoice ? "accounting_invoices" : "accounting_purchases";
    const numberColumn = isInvoice ? "invoice_number" : "bill_number";
    const partyColumn = isInvoice ? "buyer_name" : "supplier_name";
    const dateColumn = isInvoice ? "invoice_date" : "purchase_date";
    const itemTable = isInvoice ? "accounting_invoice_items" : "accounting_purchase_items";
    const parentColumn = isInvoice ? "invoice_id" : "purchase_id";
    try {
      const parent = await env.DB.prepare(
        `INSERT INTO ${table} (customer_id, ${numberColumn}, ${partyColumn}, ${isInvoice ? "buyer_email, " : ""}${dateColumn}, ${isInvoice ? "due_date, " : ""}subtotal, tax_amount, total_amount)
         VALUES (?, ?, ?, ${isInvoice ? "?, " : ""}?, ${isInvoice ? "?, " : ""}?, ?, ?)`
      ).bind(...(isInvoice
        ? [customerId, number, partyName, body.buyer_email || null, date, body.due_date || null, subtotal, tax, total]
        : [customerId, number, partyName, date, subtotal, tax, total])).run();
      const itemStatements = normalizedItems.map((item) => env.DB.prepare(
        `INSERT INTO ${itemTable} (${parentColumn}, description, quantity, unit_price, tax_rate, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(parent.meta.last_row_id, item.description, item.quantity, item.unitPrice, item.taxRate, item.lineTotal));
      const accountTypes = isInvoice
        ? { debit: "asset", credit: "income" }
        : { debit: "expense", credit: "liability" };
      const accountRows = await env.DB.prepare(
        `SELECT id, account_type FROM accounting_accounts
         WHERE customer_id = ? AND account_type IN (?, ?)`
      ).bind(customerId, accountTypes.debit, accountTypes.credit).all();
      const accountIds = Object.fromEntries(accountRows.results.map((account) => [account.account_type, account.id]));
      itemStatements.push(
        env.DB.prepare(
          `INSERT INTO accounting_ledger_entries
           (customer_id, account_id, entry_date, reference_type, reference_id, description, debit, credit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(customerId, accountIds[accountTypes.debit], date, resource, parent.meta.last_row_id, `${number} total`, total, 0),
        env.DB.prepare(
          `INSERT INTO accounting_ledger_entries
           (customer_id, account_id, entry_date, reference_type, reference_id, description, debit, credit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(customerId, accountIds[accountTypes.credit], date, resource, parent.meta.last_row_id, `${number} total`, 0, total),
      );
      await env.DB.batch(itemStatements);
      return json({ ok: true, id: parent.meta.last_row_id, message: `${isInvoice ? "Invoice" : "Purchase"} recorded` }, 201);
    } catch (error) {
      if (String(error).includes("UNIQUE")) return json({ ok: false, error: "Document number already exists" }, 409);
      throw error;
    }
  }

  if (resource === "ledger" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT l.id, l.entry_date, l.description, l.debit, l.credit,
              a.code, a.name, a.account_type
       FROM accounting_ledger_entries l
       JOIN accounting_accounts a ON a.id = l.account_id
       WHERE l.customer_id = ? ORDER BY l.entry_date DESC, l.id DESC LIMIT 200`
    ).bind(customerId).all();
    return json({ ok: true, ledger: results });
  }

  return json({ ok: false, error: "Unsupported accounting operation" }, 405);
}

async function handleCommercial(request, env, resource, recordId = null) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  if (!(await hasPermission(env, session, "commercial.view"))) return json({ ok: false, error: "Commercial access required" }, 403);

  if (resource === "summary") {
    const { results: orders } = await env.DB.prepare(
      `SELECT id, order_number, total_amount, status, created_at
       FROM orders WHERE customer_id = ? AND organization_id = ?
       ORDER BY created_at DESC, id DESC`
    ).bind(session.account_id, session.organization_id).all();
    const { results: amcContracts } = await env.DB.prepare(
      `SELECT id, contract_number, starts_at, expires_at, status
       FROM amc_contracts WHERE customer_id = ? AND organization_id = ?
       ORDER BY expires_at DESC, id DESC`
    ).bind(session.account_id, session.organization_id).all();
    return json({ ok: true, summary: { orders, amc_contracts: amcContracts } });
  }

  if (resource === "orders" && recordId) {
    const order = await env.DB.prepare(
      `SELECT id, order_number, total_amount, status, created_at
       FROM orders WHERE id = ? AND customer_id = ? AND organization_id = ?`
    ).bind(recordId, session.account_id, session.organization_id).first();
    if (!order) return json({ ok: false, error: "Order not found" }, 404);
    return json({ ok: true, order });
  }

  if (resource === "orders") {
    const { results } = await env.DB.prepare(
      `SELECT id, order_number, total_amount, status, created_at
       FROM orders WHERE customer_id = ? AND organization_id = ?
       ORDER BY created_at DESC, id DESC`
    ).bind(session.account_id, session.organization_id).all();
    return json({ ok: true, orders: results });
  }

  return json({ ok: false, error: "Unsupported commercial operation" }, 405);
}

async function handleTickets(request, env) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  const permission = request.method === "POST" ? "support.create" : "support.view";
  if (!(await hasPermission(env, session, permission))) {
    return json({ ok: false, error: "Support access required" }, 403);
  }

  if (request.method === "POST") {
    const body = await request.json();
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const allowedPriorities = ["low", "normal", "high", "urgent"];
    if (!subject || subject.length > 200 || !description || description.length > 10000) {
      return json({ ok: false, error: "Subject and description are required" }, 400);
    }
    const priority = allowedPriorities.includes(body.priority) ? body.priority : "normal";
    const result = await env.DB.prepare(
      `INSERT INTO support_tickets (customer_id, organization_id, subject, description, priority)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(session.account_id, session.organization_id, subject, description, priority).run();
    await writeAudit(env, request, session, "SUPPORT_TICKET_CREATED", "support_ticket", result.meta.last_row_id, null, { priority });
    return json({ ok: true, ticket_id: result.meta.last_row_id, message: "Support ticket created" }, 201);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, subject, description, priority, status, created_at, updated_at
     FROM support_tickets
     WHERE customer_id = ? AND organization_id = ?
     ORDER BY created_at DESC`
  )
    .bind(session.account_id, session.organization_id)
    .all();
  return json({ ok: true, tickets: results });
}

async function handleTicketResource(request, env, ticketId, resource) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  const permission = request.method === "GET" ? "support.view" : "support.create";
  if (!(await hasPermission(env, session, permission))) return json({ ok: false, error: "Support access required" }, 403);

  const ticket = await env.DB.prepare(
    `SELECT id, subject, description, priority, status, created_at, updated_at
     FROM support_tickets WHERE id = ? AND customer_id = ? AND organization_id = ?`
  ).bind(ticketId, session.account_id, session.organization_id).first();
  if (!ticket) return json({ ok: false, error: "Ticket not found" }, 404);

  if (resource === "messages" && request.method === "POST") {
    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 10000) return json({ ok: false, error: "Message is required" }, 400);
    const reopensTicket = ["resolved", "closed"].includes(ticket.status);
    const nextStatus = reopensTicket ? "open" : ticket.status;
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO support_ticket_messages (ticket_id, author_type, author_id, message)
         VALUES (?, 'customer', ?, ?)`
      ).bind(ticket.id, session.account_id, message),
      env.DB.prepare("UPDATE support_tickets SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(nextStatus, ticket.id),
    ]);
    await writeAudit(
      env,
      request,
      session,
      reopensTicket ? "SUPPORT_TICKET_REOPENED_BY_CUSTOMER" : "SUPPORT_TICKET_CUSTOMER_REPLIED",
      "support_ticket",
      ticket.id,
      reopensTicket ? { status: ticket.status } : null,
      { message_id: results[0]?.meta?.last_row_id, ...(reopensTicket ? { status: nextStatus } : {}) },
    );
    return json({ ok: true, message: "Reply added" }, 201);
  }

  if (resource || request.method !== "GET") return json({ ok: false, error: "Unsupported ticket operation" }, 405);
  const { results: messages } = await env.DB.prepare(
    `SELECT id, author_type, author_id, message, created_at
     FROM support_ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC, id ASC`
  ).bind(ticket.id).all();
  return json({ ok: true, ticket: { ...ticket, messages } });
}

const SUPPORT_TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"];

async function handleAdminSupportTickets(request, env, ticketId = null, resource = null) {
  const session = await requireSuperAdmin(request, env);
  if (!session) return json({ ok: false, error: "Super admin access required" }, 403);
  const noStoreHeaders = { "Cache-Control": "no-store" };

  if (ticketId === null) {
    if (request.method !== "GET") return json({ ok: false, error: "Unsupported support ticket operation" }, 405);
    const url = new URL(request.url);
    const status = (url.searchParams.get("status") || "").trim();
    const search = (url.searchParams.get("q") || "").trim();
    const pageValue = url.searchParams.get("page") || "1";
    const pageSizeValue = url.searchParams.get("page_size") || "50";
    if (status && !SUPPORT_TICKET_STATUSES.includes(status)) {
      return json({ ok: false, error: "A valid support ticket status is required" }, 400);
    }
    if (search.length > 100) return json({ ok: false, error: "Search must be 100 characters or fewer" }, 400);
    if (!/^\d+$/.test(pageValue) || !Number.isSafeInteger(Number(pageValue)) || Number(pageValue) < 1) {
      return json({ ok: false, error: "A valid page number is required" }, 400);
    }
    if (!/^\d+$/.test(pageSizeValue) || !Number.isSafeInteger(Number(pageSizeValue)) ||
        Number(pageSizeValue) < 1 || Number(pageSizeValue) > 100) {
      return json({ ok: false, error: "Page size must be between 1 and 100" }, 400);
    }

    const clauses = [];
    const values = [];
    if (status) {
      clauses.push("t.status = ?");
      values.push(status);
    }
    if (search) {
      const pattern = `%${search}%`;
      clauses.push(`(
        CAST(t.id AS TEXT) LIKE ? OR t.subject LIKE ? OR t.description LIKE ? OR
        c.name LIKE ? OR c.email LIKE ? OR c.company LIKE ?
      )`);
      values.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }
    const from = "FROM support_tickets t JOIN customers c ON c.id = t.customer_id";
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total ${from}${where}`).bind(...values).first();
    const total = Number(count?.total || 0);
    const pageSize = Number(pageSizeValue);
    const page = Math.min(Number(pageValue), Math.max(1, Math.ceil(total / pageSize)));
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.customer_id, t.subject, t.description, t.priority, t.status,
              t.created_at, t.updated_at, c.name AS customer_name, c.email AS customer_email,
              c.phone AS customer_phone, c.company AS customer_company
       ${from}${where}
       ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?`
    ).bind(...values, pageSize, (page - 1) * pageSize).all();
    return json({ ok: true, tickets: results, total, page, page_size: pageSize }, 200, null, noStoreHeaders);
  }

  const ticket = await env.DB.prepare(
    `SELECT t.id, t.customer_id, t.subject, t.description, t.priority, t.status,
            t.created_at, t.updated_at, c.name AS customer_name, c.email AS customer_email,
            c.phone AS customer_phone, c.company AS customer_company
     FROM support_tickets t
     JOIN customers c ON c.id = t.customer_id
     WHERE t.id = ?`
  ).bind(ticketId).first();
  if (!ticket) return json({ ok: false, error: "Ticket not found" }, 404);

  if (resource === "messages" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "A valid JSON reply is required" }, 400);
    }
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 10000) {
      return json({ ok: false, error: "Reply must contain 1 to 10000 characters" }, 400);
    }
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO support_ticket_messages (ticket_id, author_type, author_id, message)
         VALUES (?, 'staff', ?, ?)`
      ).bind(ticket.id, session.account_id, message),
      env.DB.prepare("UPDATE support_tickets SET updated_at = datetime('now') WHERE id = ?").bind(ticket.id),
    ]);
    await writeAudit(env, request, session, "ADMIN_SUPPORT_TICKET_REPLIED", "support_ticket", ticket.id, null, {
      message_id: results[0]?.meta?.last_row_id,
    });
    return json({ ok: true, message: "Reply sent to customer" }, 201, null, noStoreHeaders);
  }

  if (resource === "status" && request.method === "PATCH") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "A valid JSON status update is required" }, 400);
    }
    const status = typeof body?.status === "string" ? body.status : "";
    if (!SUPPORT_TICKET_STATUSES.includes(status)) {
      return json({ ok: false, error: "Choose open, in progress, resolved, or closed" }, 400);
    }
    if (status === ticket.status) return json({ ok: true, status, changed: false }, 200, null, noStoreHeaders);
    const update = await env.DB.prepare(
      "UPDATE support_tickets SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = ?"
    ).bind(status, ticket.id, ticket.status).run();
    if (update.meta.changes !== 1) {
      return json({ ok: false, error: "Ticket status changed; refresh and try again" }, 409);
    }
    await writeAudit(env, request, session, "ADMIN_SUPPORT_TICKET_STATUS_CHANGED", "support_ticket", ticket.id, {
      status: ticket.status,
    }, {
      status,
    });
    return json({ ok: true, status, changed: true }, 200, null, noStoreHeaders);
  }

  if (resource || request.method !== "GET") {
    return json({ ok: false, error: "Unsupported support ticket operation" }, 405);
  }

  const { results: messages } = await env.DB.prepare(
    `SELECT id, author_type, author_id, message, created_at
     FROM support_ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC, id ASC`
  ).bind(ticket.id).all();
  const { results: activity } = await env.DB.prepare(
    `SELECT a.action, a.old_value, a.new_value, a.actor_person_id, a.created_at,
            COALESCE(NULLIF(p.name, ''), NULLIF(p.email, ''), 'System') AS actor_name
     FROM audit_logs a
     LEFT JOIN people p ON p.id = a.actor_person_id
     WHERE a.resource_type = 'support_ticket' AND a.resource_id = ?
     ORDER BY a.id ASC`
  ).bind(String(ticket.id)).all();
  return json({ ok: true, ticket, messages, activity }, 200, null, noStoreHeaders);
}

async function handleRequirements(request, env) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  const permission = request.method === "POST" ? "requirement.create" : "requirement.view";
  if (!(await hasPermission(env, session, permission))) return json({ ok: false, error: "Requirements access required" }, 403);

  if (request.method === "POST") {
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const categories = ["general", "feature", "integration", "reporting", "workflow"];
    const priorities = ["low", "normal", "high", "urgent"];
    if (!title || title.length > 200 || !description || description.length > 10000) {
      return json({ ok: false, error: "Title and description are required" }, 400);
    }
    const category = categories.includes(body.category) ? body.category : "general";
    const priority = priorities.includes(body.priority) ? body.priority : "normal";
    const result = await env.DB.prepare(
      `INSERT INTO custom_requirements (customer_id, organization_id, title, description, category, priority)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(session.account_id, session.organization_id, title, description, category, priority).run();
    await writeAudit(env, request, session, "CUSTOM_REQUIREMENT_CREATED", "custom_requirement", result.meta.last_row_id, null, { category, priority });
    return json({ ok: true, requirement_id: result.meta.last_row_id, message: "Requirement submitted" }, 201);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, title, description, category, priority, status, created_at, updated_at
     FROM custom_requirements WHERE organization_id = ? ORDER BY created_at DESC, id DESC`
  ).bind(session.organization_id).all();
  return json({ ok: true, requirements: results });
}

async function handleRequirementResource(request, env, requirementId, resource) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  const permission = request.method === "GET" ? "requirement.view" : "requirement.create";
  if (!(await hasPermission(env, session, permission))) return json({ ok: false, error: "Requirements access required" }, 403);
  const requirement = await env.DB.prepare(
    `SELECT id, title, description, category, priority, status, created_at, updated_at
     FROM custom_requirements WHERE id = ? AND organization_id = ?`
  ).bind(requirementId, session.organization_id).first();
  if (!requirement) return json({ ok: false, error: "Requirement not found" }, 404);

  if (resource === "messages" && request.method === "POST") {
    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 10000) return json({ ok: false, error: "Message is required" }, 400);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO custom_requirement_messages (requirement_id, author_type, author_id, message)
         VALUES (?, 'customer', ?, ?)`
      ).bind(requirement.id, session.account_id, message),
      env.DB.prepare("UPDATE custom_requirements SET updated_at = datetime('now') WHERE id = ?").bind(requirement.id),
    ]);
    return json({ ok: true, message: "Reply added" }, 201);
  }

  if (resource || request.method !== "GET") return json({ ok: false, error: "Unsupported requirement operation" }, 405);
  const { results: messages } = await env.DB.prepare(
    `SELECT id, author_type, author_id, message, created_at
     FROM custom_requirement_messages WHERE requirement_id = ? ORDER BY created_at ASC, id ASC`
  ).bind(requirement.id).all();
  return json({ ok: true, requirement: { ...requirement, messages } });
}

const ANNOUNCEMENT_SEVERITIES = ["info", "maintenance", "degraded", "outage"];
const ANNOUNCEMENT_STATUSES = ["draft", "published", "resolved", "archived"];

function normalizeAnnouncementDate(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 40) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function announcementRowQuery() {
  return `SELECT a.id, a.product_id, a.title, a.message, a.audience, a.severity, a.status,
                 a.starts_at, a.ends_at, a.published_at, a.created_at, a.updated_at,
                 p.slug AS product_code, p.name AS product_name
          FROM announcements a
          LEFT JOIN products p ON p.id = a.product_id`;
}

async function handleCustomerAnnouncements(request, env) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  if (!(await hasPermission(env, session, "organization.view"))) {
    return json({ ok: false, error: "Organization access required" }, 403);
  }

  const { results } = await env.DB.prepare(
    `${announcementRowQuery()}
     WHERE a.status IN ('published', 'resolved')
       AND a.audience = 'customer'
       AND datetime(a.starts_at) <= datetime('now')
       AND (a.ends_at IS NULL OR datetime(a.ends_at) > datetime('now'))
       AND (a.product_id IS NULL OR EXISTS (
         SELECT 1 FROM licenses l
         JOIN organization_members om ON om.account_type = 'customer'
           AND om.account_id = l.customer_id AND om.organization_id = l.organization_id
           AND om.status = 'active'
         WHERE l.organization_id = ? AND l.product_id = a.product_id
           AND l.status NOT IN ('CANCELLED', 'EXPIRED')
       ))
     ORDER BY CASE a.severity
       WHEN 'outage' THEN 1 WHEN 'degraded' THEN 2
       WHEN 'maintenance' THEN 3 ELSE 4 END,
       a.published_at DESC, a.id DESC`
  ).bind(session.organization_id).all();
  return json({ ok: true, announcements: results });
}

async function handleAdminAnnouncements(request, env, announcementId = null) {
  const session = await requireSuperAdmin(request, env);
  if (!session) return json({ ok: false, error: "Super admin access required" }, 403);

  if (request.method === "GET" && !announcementId) {
    const { results } = await env.DB.prepare(
      `${announcementRowQuery()} ORDER BY a.created_at DESC, a.id DESC LIMIT 200`
    ).all();
    return json({ ok: true, announcements: results });
  }

  const body = await request.json();
  if (request.method === "POST" && !announcementId) {
    const title = boundedString(body.title, 200);
    const content = boundedString(body.message, 5000);
    const severity = body.severity || "info";
    const status = body.status || "draft";
    const productId = body.product_id == null || body.product_id === "" ? null : numericId(body.product_id);
    const startsAt = body.starts_at === undefined ? null : normalizeAnnouncementDate(body.starts_at);
    const endsAt = body.ends_at === undefined ? null : normalizeAnnouncementDate(body.ends_at);
    if (!title || !content) return json({ ok: false, error: "Title and message are required" }, 400);
    if (!ANNOUNCEMENT_SEVERITIES.includes(severity)) return json({ ok: false, error: "Invalid announcement severity" }, 400);
    if (!["draft", "published"].includes(status)) return json({ ok: false, error: "New announcements must be draft or published" }, 400);
    if (productId === null && body.product_id != null && body.product_id !== "") return json({ ok: false, error: "A valid product is required" }, 400);
    if (startsAt === undefined || endsAt === undefined) return json({ ok: false, error: "Announcement dates are invalid" }, 400);
    if (endsAt && new Date(endsAt).getTime() <= new Date(startsAt || new Date()).getTime()) {
      return json({ ok: false, error: "The end time must be after the start time" }, 400);
    }
    if (productId && !(await env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(productId).first())) {
      return json({ ok: false, error: "Product not found" }, 404);
    }

    const result = await env.DB.prepare(
            `INSERT INTO announcements
             (product_id, title, message, audience, severity, status, starts_at, ends_at, published_at, created_by, updated_by)
             VALUES (?, ?, ?, 'customer', ?, ?, COALESCE(?, datetime('now')), ?,
               CASE WHEN ? = 'published' THEN datetime('now') ELSE NULL END, ?, ?)`
          ).bind(productId, title, content, severity, status, startsAt, endsAt, status, session.account_id, session.account_id).run();
    const announcement = await env.DB.prepare(`${announcementRowQuery()} WHERE a.id = ?`).bind(result.meta.last_row_id).first();
    await writeAudit(env, request, session, "ANNOUNCEMENT_CREATED", "announcement", announcement.id, null, announcement);
    return json({ ok: true, announcement }, 201);
  }

  if (request.method === "PATCH" && announcementId) {
    const current = await env.DB.prepare(`${announcementRowQuery()} WHERE a.id = ?`).bind(announcementId).first();
    if (!current) return json({ ok: false, error: "Announcement not found" }, 404);

    const title = Object.hasOwn(body, "title") ? boundedString(body.title, 200) : current.title;
    const content = Object.hasOwn(body, "message") ? boundedString(body.message, 5000) : current.message;
    const severity = body.severity || current.severity;
    const productId = Object.hasOwn(body, "product_id")
      ? (body.product_id == null || body.product_id === "" ? null : numericId(body.product_id))
      : current.product_id;
    const startsAt = Object.hasOwn(body, "starts_at") && body.starts_at
      ? normalizeAnnouncementDate(body.starts_at)
      : current.starts_at;
    const endsAt = Object.hasOwn(body, "ends_at") ? normalizeAnnouncementDate(body.ends_at) : current.ends_at;
    const status = body.status || current.status;
    const transitions = { draft: ["published", "archived"], published: ["resolved", "archived"], resolved: ["archived"], archived: [] };

    if (!title || !content) return json({ ok: false, error: "Title and message are required" }, 400);
    if (!ANNOUNCEMENT_SEVERITIES.includes(severity)) return json({ ok: false, error: "Invalid announcement severity" }, 400);
    if (!ANNOUNCEMENT_STATUSES.includes(status)) return json({ ok: false, error: "Invalid announcement status" }, 400);
    if (status !== current.status && !transitions[current.status].includes(status)) {
      return json({ ok: false, error: "Invalid announcement status transition" }, 409);
    }
    if (Object.hasOwn(body, "product_id") && productId === null && body.product_id != null && body.product_id !== "") {
      return json({ ok: false, error: "A valid product is required" }, 400);
    }
    if (startsAt === undefined || endsAt === undefined) return json({ ok: false, error: "Announcement dates are invalid" }, 400);
    if (endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      return json({ ok: false, error: "The end time must be after the start time" }, 400);
    }
    if (productId && !(await env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(productId).first())) {
      return json({ ok: false, error: "Product not found" }, 404);
    }

    await env.DB.prepare(
      `UPDATE announcements SET product_id = ?, title = ?, message = ?, severity = ?, status = ?,
       starts_at = ?, ends_at = ?,
       published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN datetime('now') ELSE published_at END,
       updated_by = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(productId, title, content, severity, status, startsAt, endsAt, status, session.account_id, announcementId).run();
    const updated = await env.DB.prepare(`${announcementRowQuery()} WHERE a.id = ?`).bind(announcementId).first();
    await writeAudit(env, request, session, "ANNOUNCEMENT_UPDATED", "announcement", announcementId, current, updated);
    return json({ ok: true, announcement: updated });
  }

  return json({ ok: false, error: "Unsupported announcement operation" }, 405);
}

const RELEASE_STATUSES = ["draft", "review", "published", "withdrawn"];
const RELEASE_STATUS_TRANSITIONS = {
  draft: ["review", "withdrawn"],
  review: ["draft", "published", "withdrawn"],
  published: ["withdrawn"],
  withdrawn: [],
};
const RELEASE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

function optionalReleaseText(value, maxLength) {
  if (value == null) return { valid: true, value: null };
  if (typeof value !== "string" || value.trim().length > maxLength) return { valid: false, value: null };
  return { valid: true, value: value.trim() || null };
}

function releaseAdminQuery() {
  return `SELECT r.id, r.product_id, r.version, r.title, r.summary, r.release_notes,
                 r.status, r.published_at, r.created_at, r.updated_at,
                 p.slug AS product_code, p.name AS product_name
          FROM releases r JOIN products p ON p.id = r.product_id`;
}

function releaseAdminResponse(release, assets = []) {
  return {
    id: release.id,
    version: release.version,
    title: release.title,
    summary: release.summary,
    release_notes: release.release_notes,
    status: release.status,
    published_at: release.published_at,
    created_at: release.created_at,
    updated_at: release.updated_at,
    product_id: release.product_id,
    product: { id: release.product_id, code: release.product_code, name: release.product_name },
    assets,
  };
}

function normalizeReleaseAssets(value) {
  if (!Array.isArray(value) || value.length > 10) return null;
  const names = new Set();
  const assets = [];
  for (const asset of value) {
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) return null;
    const name = boundedString(asset.name, 200);
    const rawPlatform = asset.platform == null ? null : boundedString(asset.platform, 100);
    const platform = rawPlatform || null;
    const downloadUrl = boundedString(asset.download_url, 2048);
    const checksum = boundedString(asset.checksum, 64);
    if (!name || (asset.platform != null && rawPlatform === null) ||
        !downloadUrl || !checksum || !/^[a-f0-9]{64}$/i.test(checksum) || names.has(name.toLowerCase())) {
      return null;
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(downloadUrl);
    } catch {
      return null;
    }
    if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) return null;
    names.add(name.toLowerCase());
    assets.push({ name, platform, download_url: parsedUrl.toString(), checksum: checksum.toLowerCase() });
  }
  return assets;
}

async function getAdminRelease(env, releaseId) {
  const release = await env.DB.prepare(`${releaseAdminQuery()} WHERE r.id = ?`).bind(releaseId).first();
  if (!release) return null;
  const { results: assets } = await env.DB.prepare(
    "SELECT id, name, platform, download_url, checksum FROM release_assets WHERE release_id = ? ORDER BY name"
  ).bind(releaseId).all();
  return releaseAdminResponse(release, assets);
}

async function handleAdminReleases(request, env, releaseId = null) {
  const session = await requireSuperAdmin(request, env);
  if (!session) return json({ ok: false, error: "Super admin access required" }, 403);

  if (request.method === "GET" && !releaseId) {
    const { results } = await env.DB.prepare(`${releaseAdminQuery()} ORDER BY r.updated_at DESC, r.id DESC LIMIT 200`).all();
    if (!results.length) return json({ ok: true, releases: [] });
    const ids = results.map((release) => release.id);
    const placeholders = ids.map(() => "?").join(", ");
    const { results: assets } = await env.DB.prepare(
      `SELECT id, release_id, name, platform, download_url, checksum
       FROM release_assets WHERE release_id IN (${placeholders}) ORDER BY name`
    ).bind(...ids).all();
    const assetsByRelease = new Map();
    for (const asset of assets) {
      if (!assetsByRelease.has(asset.release_id)) assetsByRelease.set(asset.release_id, []);
      assetsByRelease.get(asset.release_id).push(asset);
    }
    return json({
      ok: true,
      releases: results.map((release) => releaseAdminResponse(release, assetsByRelease.get(release.id) || [])),
    });
  }

  if (request.method === "GET" && releaseId) {
    const release = await getAdminRelease(env, releaseId);
    return release
      ? json({ ok: true, release })
      : json({ ok: false, error: "Release not found" }, 404);
  }

  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "A release object is required" }, 400);
  }

  if (request.method === "POST" && !releaseId) {
    const productId = numericId(body.product_id);
    const version = boundedString(body.version, 64);
    const title = boundedString(body.title, 200);
    const summaryField = optionalReleaseText(body.summary, 1000);
    const releaseNotesField = optionalReleaseText(body.release_notes, 20000);
    const summary = summaryField.value;
    const releaseNotes = releaseNotesField.value;
    const assets = Object.hasOwn(body, "assets") ? normalizeReleaseAssets(body.assets) : [];
    if (!productId || !version || !RELEASE_VERSION_PATTERN.test(version) || !title) {
      return json({ ok: false, error: "A valid product, version, and title are required" }, 400);
    }
    if (!summaryField.valid || !releaseNotesField.valid) return json({ ok: false, error: "Release summary or notes are invalid" }, 400);
    if (Object.hasOwn(body, "status") && body.status !== "draft") {
      return json({ ok: false, error: "New releases must start as a draft" }, 400);
    }
    if (!assets) return json({ ok: false, error: "Release assets must use unique names, HTTPS URLs, and SHA-256 checksums" }, 400);
    const product = await env.DB.prepare("SELECT id FROM products WHERE id = ? AND status = 'active'").bind(productId).first();
    if (!product) return json({ ok: false, error: "Active product not found" }, 404);
    const duplicate = await env.DB.prepare("SELECT id FROM releases WHERE product_id = ? AND version = ?")
      .bind(productId, version).first();
    if (duplicate) return json({ ok: false, error: "A release with this product and version already exists" }, 409);

    const statements = [
      env.DB.prepare(
        `INSERT INTO releases (product_id, version, title, summary, release_notes, status)
         VALUES (?, ?, ?, ?, ?, 'draft')`
      ).bind(productId, version, title, summary, releaseNotes),
      ...assets.map((asset) => env.DB.prepare(
        `INSERT INTO release_assets (release_id, name, platform, download_url, checksum)
         SELECT id, ?, ?, ?, ? FROM releases WHERE product_id = ? AND version = ?`
      ).bind(asset.name, asset.platform, asset.download_url, asset.checksum, productId, version)),
    ];
    await env.DB.batch(statements);
    const release = await env.DB.prepare(`${releaseAdminQuery()} WHERE r.product_id = ? AND r.version = ?`)
      .bind(productId, version).first();
    const created = await getAdminRelease(env, release.id);
    await writeAudit(env, request, session, "RELEASE_CREATED", "release", created.id, null, created);
    return json({ ok: true, release: created }, 201);
  }

  if (request.method === "PATCH" && releaseId) {
    const current = await getAdminRelease(env, releaseId);
    if (!current) return json({ ok: false, error: "Release not found" }, 404);
    const status = Object.hasOwn(body, "status") ? body.status : current.status;
    if (!RELEASE_STATUSES.includes(status)) return json({ ok: false, error: "Invalid release status" }, 400);
    if (status !== current.status && !(RELEASE_STATUS_TRANSITIONS[current.status] || []).includes(status)) {
      return json({ ok: false, error: "Invalid release status transition" }, 409);
    }

    const assetsProvided = Object.hasOwn(body, "assets");
    const editable = current.status === "draft" || (current.status === "review" && status === "draft");
    const hasContentChanges = ["title", "summary", "release_notes", "assets"].some((key) => Object.hasOwn(body, key));
    if (hasContentChanges && !editable) {
      return json({ ok: false, error: "Return this release to draft before editing it" }, 409);
    }
    const title = Object.hasOwn(body, "title") ? boundedString(body.title, 200) : current.title;
    const summaryField = Object.hasOwn(body, "summary") ? optionalReleaseText(body.summary, 1000) : { valid: true, value: current.summary };
    const releaseNotesField = Object.hasOwn(body, "release_notes")
      ? optionalReleaseText(body.release_notes, 20000)
      : { valid: true, value: current.release_notes };
    const summary = summaryField.value;
    const releaseNotes = releaseNotesField.value;
    const assets = assetsProvided ? normalizeReleaseAssets(body.assets) : current.assets;
    if (!title) return json({ ok: false, error: "A release title is required" }, 400);
    if (!summaryField.valid || !releaseNotesField.valid) return json({ ok: false, error: "Release summary or notes are invalid" }, 400);
    if (!assets) return json({ ok: false, error: "Release assets must use unique names, HTTPS URLs, and SHA-256 checksums" }, 400);
    if (["review", "published"].includes(status) &&
        (!releaseNotes || !releaseNotes.trim() || assets.length === 0)) {
      return json({ ok: false, error: "Release notes and at least one download with a SHA-256 checksum are required before review or publication" }, 409);
    }

    const statements = [
      env.DB.prepare(
        `UPDATE releases SET title = ?, summary = ?, release_notes = ?, status = ?,
         published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, datetime('now')) ELSE published_at END,
         updated_at = datetime('now') WHERE id = ? AND status = ?`
      ).bind(title, summary, releaseNotes, status, status, releaseId, current.status),
    ];
    if (assetsProvided) {
      statements.push(env.DB.prepare(
        `DELETE FROM release_assets WHERE release_id = ?
         AND EXISTS (SELECT 1 FROM releases WHERE id = ? AND status IN ('draft', 'review'))`
      ).bind(releaseId, releaseId));
      for (const asset of assets) {
        statements.push(env.DB.prepare(
          `INSERT INTO release_assets (release_id, name, platform, download_url, checksum)
           SELECT ?, ?, ?, ?, ? WHERE EXISTS (
             SELECT 1 FROM releases WHERE id = ? AND status IN ('draft', 'review')
           )`
        ).bind(releaseId, asset.name, asset.platform, asset.download_url, asset.checksum, releaseId));
      }
    }
    const results = await env.DB.batch(statements);
    if (!results[0]?.meta?.changes) return json({ ok: false, error: "Release changed; reload and try again" }, 409);
    const updated = await getAdminRelease(env, releaseId);
    const transitionActions = {
      "draft:review": "RELEASE_SUBMITTED_FOR_REVIEW",
      "draft:withdrawn": "RELEASE_WITHDRAWN",
      "review:draft": "RELEASE_RETURNED_TO_DRAFT",
      "review:published": "RELEASE_PUBLISHED",
      "review:withdrawn": "RELEASE_WITHDRAWN",
      "published:withdrawn": "RELEASE_WITHDRAWN",
    };
    const action = status === current.status
      ? "RELEASE_UPDATED"
      : transitionActions[`${current.status}:${status}`];
    await writeAudit(env, request, session, action, "release", releaseId, current, updated);
    return json({ ok: true, release: updated });
  }

  return json({ ok: false, error: "Unsupported release operation" }, 405);
}

function releaseResponse(release, assets = []) {
  return {
    id: release.id,
    version: release.version,
    title: release.title,
    summary: release.summary,
    release_notes: release.release_notes,
    published_at: release.published_at,
    product: { id: release.product_id, code: release.product_code, name: release.product_name },
    assets,
  };
}

async function handleReleases(request, env, releaseId = null) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  if (!(await hasPermission(env, session, "release.view"))) return json({ ok: false, error: "Release access required" }, 403);

  const baseQuery = `SELECT DISTINCT r.id, r.product_id, r.version, r.title, r.summary,
           r.release_notes, r.published_at, p.slug AS product_code, p.name AS product_name
    FROM releases r
    JOIN products p ON p.id = r.product_id
    JOIN licenses l ON l.product_id = r.product_id AND l.status = 'ACTIVE'
      AND (l.starts_at IS NULL OR date(l.starts_at) <= date('now'))
      AND (l.expires_at IS NULL OR date(l.expires_at) >= date('now'))
      AND l.organization_id = ?
    JOIN organizations o ON o.id = l.organization_id AND o.status = 'active'
    JOIN organization_members om ON om.account_type = 'customer'
      AND om.account_id = l.customer_id AND om.organization_id = l.organization_id
      AND om.status = 'active'
    WHERE r.status = 'published' AND r.published_at IS NOT NULL`;

  if (releaseId) {
    const release = await env.DB.prepare(`${baseQuery} AND r.id = ? ORDER BY r.published_at DESC LIMIT 1`)
      .bind(session.organization_id, releaseId).first();
    if (!release) return json({ ok: false, error: "Release not found" }, 404);
    const { results: assets } = await env.DB.prepare(
      `SELECT id, name, platform, download_url, checksum FROM release_assets WHERE release_id = ? ORDER BY name`
    ).bind(release.id).all();
    return json({ ok: true, release: releaseResponse(release, assets) });
  }

  const { results } = await env.DB.prepare(`${baseQuery} ORDER BY r.published_at DESC, r.id DESC`).bind(session.organization_id).all();
  const releases = await Promise.all(results.map(async (release) => {
    const { results: assets } = await env.DB.prepare(
      `SELECT id, name, platform, download_url, checksum FROM release_assets WHERE release_id = ? ORDER BY name`
    ).bind(release.id).all();
    return releaseResponse(release, assets);
  }));
  return json({ ok: true, releases });
}

async function handlePartner(request, env, resource) {
  const session = await getPartnerSession(request, env);
  if (!session) return json({ ok: false, error: "Partner access required" }, 403);
  if (!(await hasPartnerPermission(env, session, "partner.view"))) return json({ ok: false, error: "Partner access required" }, 403);

  if (resource === "me") {
    const organization = await env.DB.prepare(
      `SELECT id, name, legal_name, gst_number, address, city, state, pincode, country,
              phone, tax_id, website, status, created_at FROM organizations WHERE id = ?`
    ).bind(session.partner_organization_id).first();
    const [canRegisterCustomers, canManageCustomerContacts, canViewInventory, canRevealKeys] = await Promise.all([
      hasPartnerPermission(env, session, "partner.customer.create"),
      hasPartnerPermission(env, session, "partner.customer.update_contact"),
      hasPartnerPermission(env, session, "partner.inventory.view"),
      hasPartnerPermission(env, session, "partner.inventory.reveal"),
    ]);
    return json({
      ok: true,
      account_type: session.account_type,
      user: { id: session.account_id, name: session.name, email: session.email },
      partner: { ...organization, partner_role: session.partner_role, partner_type: session.partner_type },
      permissions: {
        register_customers: canRegisterCustomers && PARTNER_SALES_TYPES.includes(session.partner_type),
        manage_customer_contacts: canManageCustomerContacts && PARTNER_SALES_TYPES.includes(session.partner_type),
        view_inventory: canViewInventory,
        reveal_activation_keys: canRevealKeys,
      },
    });
  }

  if (resource === "customers") {
    if (request.method === "POST") return await createPartnerCustomerInvite(request, env, session);
    if (request.method !== "GET") return json({ ok: false, error: "Unsupported partner customer operation" }, 405);
    const canManageCustomerContacts =
      PARTNER_SALES_TYPES.includes(session.partner_type) &&
      await hasPartnerPermission(env, session, "partner.customer.update_contact");
    const [customers, contacts, pendingInvites] = await Promise.all([
      env.DB.prepare(
      `SELECT o.id, o.name, o.legal_name, o.status, pcl.created_at
       FROM partner_customer_links pcl
       JOIN organizations o ON o.id = pcl.customer_organization_id
       WHERE pcl.partner_organization_id = ? AND pcl.status = 'active' AND o.status = 'active'
       ORDER BY o.name`
      ).bind(session.partner_organization_id).all(),
      canManageCustomerContacts
        ? env.DB.prepare(
          `SELECT DISTINCT c.id, c.name, c.phone, om.organization_id
           FROM partner_customer_links pcl
           JOIN organization_members om ON om.organization_id = pcl.customer_organization_id
             AND om.account_type = 'customer' AND om.status = 'active'
           JOIN customers c ON c.id = om.account_id AND c.status IN ('active', 'trial')
           WHERE pcl.partner_organization_id = ? AND pcl.status = 'active'
           ORDER BY om.organization_id, c.id`
        ).bind(session.partner_organization_id).all()
        : Promise.resolve({ results: [] }),
      env.DB.prepare(
        `SELECT id, email, name, company,
                CASE WHEN status = 'pending' AND expires_at <= datetime('now') THEN 'expired' ELSE status END AS status,
                created_at, expires_at
         FROM customer_invites
         WHERE invited_by_partner_organization_id = ? AND status = 'pending'
         ORDER BY created_at DESC, id DESC LIMIT 100`
      ).bind(session.partner_organization_id).all(),
    ]);
    return json({
      ok: true,
      customers: customers.results || [],
      contacts: contacts.results || [],
      permissions: { manage_customer_contacts: canManageCustomerContacts },
      pending_invites: pendingInvites.results || [],
    }, 200, null, { "Cache-Control": "no-store" });
  }

  if (resource === "inventory") {
    if (!(await hasPartnerPermission(env, session, "partner.inventory.view"))) {
      return json({ ok: false, error: "Partner inventory access required" }, 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT c.batch_id, c.serial_number, c.status, c.delivery_status,
              c.partner_assigned_at, c.activation_key_ciphertext,
              p.slug AS product_code, p.name AS product_name,
              e.code AS edition_code, e.name AS edition_name
       FROM license_code_inventory c
       JOIN products p ON p.id = c.product_id
       JOIN product_editions e ON e.id = c.edition_id
       WHERE c.assigned_partner_organization_id = ?
       ORDER BY c.partner_assigned_at DESC, c.serial_number`
    ).bind(session.partner_organization_id).all();
    const encryption = await loadLicenseCodeEncryptionKey(env);
    return json({
      ok: true,
      inventory: (results || []).map((code) => ({
        batch_id: code.batch_id,
        serial_number: code.serial_number,
        status: code.status,
        delivery_status: code.delivery_status,
        assigned_at: code.partner_assigned_at,
        product: { code: code.product_code, name: code.product_name },
        edition: { code: code.edition_code, name: code.edition_name },
        activation_key_recoverable: Boolean(code.activation_key_ciphertext && encryption.key),
      })),
    }, 200, null, { "Cache-Control": "no-store" });
  }

  if (resource === "licenses") {
    if (!(await hasPartnerPermission(env, session, "license.view"))) return json({ ok: false, error: "Partner license access required" }, 403);
    const { results } = await env.DB.prepare(
      `SELECT l.id, l.license_key, l.customer_id, l.product_id, l.status, l.starts_at, l.expires_at,
              om.organization_id, customer_org.name AS customer_organization_name,
              p.slug AS product_code, p.name AS product_name,
              le.edition_id, pe.code AS edition_code, pe.name AS edition_name
       FROM licenses l
       JOIN products p ON p.id = l.product_id
       JOIN organization_members om ON om.account_type = 'customer' AND om.account_id = l.customer_id
         AND om.organization_id = l.organization_id AND om.status = 'active'
       JOIN organizations customer_org ON customer_org.id = om.organization_id AND customer_org.status = 'active'
       JOIN partner_customer_links pcl ON pcl.customer_organization_id = om.organization_id
         AND pcl.partner_organization_id = ? AND pcl.status = 'active'
       LEFT JOIN license_editions le ON le.license_id = l.id
       LEFT JOIN product_editions pe ON pe.id = le.edition_id
       ORDER BY l.id DESC`
    ).bind(session.partner_organization_id).all();
    return json({ ok: true, licenses: results.map((license) => ({ ...licenseResponse(license), customer_organization_name: license.customer_organization_name })) });
  }

  if (resource === "releases") {
    if (!(await hasPartnerPermission(env, session, "release.view"))) return json({ ok: false, error: "Partner release access required" }, 403);
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT r.id, r.version, r.title, r.summary, r.release_notes, r.published_at,
              p.slug AS product_code, p.name AS product_name
       FROM releases r
       JOIN products p ON p.id = r.product_id
       JOIN licenses l ON l.product_id = r.product_id AND l.status = 'ACTIVE'
         AND (l.starts_at IS NULL OR date(l.starts_at) <= date('now'))
         AND (l.expires_at IS NULL OR date(l.expires_at) >= date('now'))
       JOIN organization_members om ON om.account_type = 'customer' AND om.account_id = l.customer_id
         AND om.organization_id = l.organization_id AND om.status = 'active'
       JOIN organizations customer_org ON customer_org.id = om.organization_id AND customer_org.status = 'active'
       JOIN partner_customer_links pcl ON pcl.customer_organization_id = om.organization_id
         AND pcl.partner_organization_id = ? AND pcl.status = 'active'
       WHERE r.status = 'published' AND r.published_at IS NOT NULL
       ORDER BY r.published_at DESC, r.id DESC`
    ).bind(session.partner_organization_id).all();
    return json({ ok: true, releases: results });
  }

  return json({ ok: false, error: "Unsupported partner operation" }, 405);
}

const DEAL_REGISTRATION_STATUSES = ["submitted", "under_review", "needs_information", "approved", "rejected"];
const DEAL_STATUS_TRANSITIONS = {
  submitted: ["under_review", "needs_information", "approved", "rejected"],
  under_review: ["needs_information", "approved", "rejected"],
  needs_information: ["under_review", "approved", "rejected"],
  approved: [],
  rejected: [],
};

async function handlePartnerDeals(request, env) {
  const session = await getPartnerSession(request, env);
  if (!session || !(await hasPartnerPermission(env, session, "partner.deals.submit"))) {
    return json({ ok: false, error: "Partner deal registration access required" }, 403);
  }
  if (request.method === "GET") {
    const url = new URL(request.url);
    const pageValue = url.searchParams.get("page") || "1";
    const pageSizeValue = url.searchParams.get("page_size") || "20";
    if (!/^\d+$/.test(pageValue) || !Number.isSafeInteger(Number(pageValue)) || Number(pageValue) < 1) {
      return json({ ok: false, error: "A valid page number is required" }, 400);
    }
    if (!/^\d+$/.test(pageSizeValue) || !Number.isSafeInteger(Number(pageSizeValue)) ||
        Number(pageSizeValue) < 1 || Number(pageSizeValue) > 100) {
      return json({ ok: false, error: "Page size must be between 1 and 100" }, 400);
    }
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM deal_registrations WHERE partner_organization_id = ?"
    ).bind(session.partner_organization_id).first();
    const total = Number(count?.total || 0);
    const pageSize = Number(pageSizeValue);
    const page = Math.min(Number(pageValue), Math.max(1, Math.ceil(total / pageSize)));
    const { results } = await env.DB.prepare(
      `SELECT id, prospect_organization_name, website, contact_name, contact_email,
              contact_phone, summary, partner_response, status, decision_summary, created_at, updated_at
       FROM deal_registrations
       WHERE partner_organization_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    ).bind(session.partner_organization_id, pageSize, (page - 1) * pageSize).all();
    return json({ ok: true, deals: results || [], total, page, page_size: pageSize },
      200, null, { "Cache-Control": "no-store" });
  }
  if (request.method !== "POST") return json({ ok: false, error: "Unsupported deal registration operation" }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid deal registration is required" }, 400);
  }
  const allowedFields = ["prospect_organization_name", "website", "contact_name", "contact_email", "contact_phone", "summary"];
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((field) => !allowedFields.includes(field))) {
    return json({ ok: false, error: "Only prospect and contact details can be submitted" }, 400);
  }
  const prospectName = boundedString(body.prospect_organization_name, 200);
  const summary = boundedString(body.summary, 4000);
  const website = body.website == null || body.website === "" ? null : boundedString(body.website, 255);
  const contactName = body.contact_name == null || body.contact_name === "" ? null : boundedString(body.contact_name, 120);
  const contactEmail = body.contact_email == null || body.contact_email === "" ? null : validEmail(body.contact_email);
  const contactPhone = body.contact_phone == null || body.contact_phone === "" ? null : boundedString(body.contact_phone, 40);
  if (!prospectName || !summary || summary.length < 10 ||
      (body.website != null && body.website !== "" && !website) ||
      (body.contact_name != null && body.contact_name !== "" && !contactName) ||
      (body.contact_email != null && body.contact_email !== "" && !contactEmail) ||
      (body.contact_phone != null && body.contact_phone !== "" && !contactPhone)) {
    return json({ ok: false, error: "Provide a prospect name and a 10-4,000 character summary; optional contact details must be valid" }, 400);
  }
  if (website) {
    try {
      const parsedWebsite = new URL(website);
      if (!["http:", "https:"].includes(parsedWebsite.protocol)) throw new Error("Unsupported protocol");
    } catch {
      return json({ ok: false, error: "Website must be a valid HTTP or HTTPS URL" }, 400);
    }
  }

  const result = await env.DB.prepare(
    `INSERT INTO deal_registrations
       (partner_organization_id, submitted_by_person_id, prospect_organization_name,
        website, contact_name, contact_email, contact_phone, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    session.partner_organization_id, session.person_id, prospectName,
    website, contactName, contactEmail, contactPhone, summary,
  ).run();
  await writeAudit(env, request, session, "PARTNER_DEAL_SUBMITTED", "deal_registration", result.meta.last_row_id,
    null, { status: "submitted", prospect_organization_name: prospectName });
  return json({ ok: true, deal_id: result.meta.last_row_id, status: "submitted" }, 201,
    null, { "Cache-Control": "no-store" });
}

async function handlePartnerDealResponse(request, env, dealId) {
  const session = await getPartnerSession(request, env);
  if (!session || !(await hasPartnerPermission(env, session, "partner.deals.submit"))) {
    return json({ ok: false, error: "Partner deal registration access required" }, 403);
  }
  if (request.method !== "PATCH") return json({ ok: false, error: "Unsupported deal registration operation" }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid deal response is required" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !Object.prototype.hasOwnProperty.call(body, "partner_response")) {
    return json({ ok: false, error: "Only a partner response can be submitted" }, 400);
  }
  const response = boundedString(body.partner_response, 2000);
  if (!response || response.length < 10) {
    return json({ ok: false, error: "Provide a response of 10 to 2,000 characters" }, 400);
  }
  const deal = await env.DB.prepare(
    `SELECT id, status, partner_response FROM deal_registrations
     WHERE id = ? AND partner_organization_id = ?`
  ).bind(dealId, session.partner_organization_id).first();
  if (!deal) return json({ ok: false, error: "Deal registration not found" }, 404);
  if (deal.status !== "needs_information") {
    return json({ ok: false, error: "This registration is not awaiting partner information" }, 409);
  }
  const update = await env.DB.prepare(
    `UPDATE deal_registrations
     SET partner_response = ?, status = 'submitted', reviewed_by_person_id = NULL, updated_at = datetime('now')
     WHERE id = ? AND partner_organization_id = ? AND status = 'needs_information'`
  ).bind(response, deal.id, session.partner_organization_id).run();
  if (update.meta.changes !== 1) {
    return json({ ok: false, error: "Deal registration changed; refresh and try again" }, 409);
  }
  await writeAudit(env, request, session, "PARTNER_DEAL_RESPONSE_SUBMITTED", "deal_registration", deal.id,
    { status: deal.status, partner_response: deal.partner_response },
    { status: "submitted", partner_response: response });
  return json({ ok: true, status: "submitted" }, 200, null, { "Cache-Control": "no-store" });
}

async function handleAdminPartnerDeals(request, env, dealId = null) {
  const principal = await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403);
  const noStoreHeaders = { "Cache-Control": "no-store" };

  if (dealId === null) {
    if (request.method !== "GET") return json({ ok: false, error: "Unsupported deal review operation" }, 405);
    const url = new URL(request.url);
    const status = (url.searchParams.get("status") || "").trim();
    const search = (url.searchParams.get("q") || "").trim();
    const pageValue = url.searchParams.get("page") || "1";
    const pageSizeValue = url.searchParams.get("page_size") || "50";
    if (status && !DEAL_REGISTRATION_STATUSES.includes(status)) {
      return json({ ok: false, error: "A valid deal registration status is required" }, 400);
    }
    if (search.length > 100) return json({ ok: false, error: "Search must be 100 characters or fewer" }, 400);
    if (!/^\d+$/.test(pageValue) || !Number.isSafeInteger(Number(pageValue)) || Number(pageValue) < 1) {
      return json({ ok: false, error: "A valid page number is required" }, 400);
    }
    if (!/^\d+$/.test(pageSizeValue) || !Number.isSafeInteger(Number(pageSizeValue)) ||
        Number(pageSizeValue) < 1 || Number(pageSizeValue) > 100) {
      return json({ ok: false, error: "Page size must be between 1 and 100" }, 400);
    }
    const clauses = [];
    const values = [];
    if (status) {
      clauses.push("d.status = ?");
      values.push(status);
    }
    if (search) {
      const pattern = `%${search}%`;
      clauses.push("(CAST(d.id AS TEXT) LIKE ? OR d.prospect_organization_name LIKE ? OR d.contact_email LIKE ? OR o.name LIKE ?)");
      values.push(pattern, pattern, pattern, pattern);
    }
    const from = `FROM deal_registrations d
      JOIN organizations o ON o.id = d.partner_organization_id`;
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total ${from}${where}`).bind(...values).first();
    const total = Number(count?.total || 0);
    const pageSize = Number(pageSizeValue);
    const page = Math.min(Number(pageValue), Math.max(1, Math.ceil(total / pageSize)));
    const { results } = await env.DB.prepare(
      `SELECT d.id, d.partner_organization_id, o.name AS partner_name,
              d.submitted_by_person_id, d.prospect_organization_name, d.website,
              d.contact_name, d.contact_email, d.contact_phone, d.summary, d.partner_response,
              d.status, d.decision_summary, d.internal_note, d.created_at, d.updated_at,
              EXISTS (
                SELECT 1 FROM deal_registrations other
                WHERE other.id <> d.id AND other.status <> 'rejected'
                  AND (
                    lower(other.prospect_organization_name) = lower(d.prospect_organization_name)
                    OR (d.contact_email IS NOT NULL AND other.contact_email IS NOT NULL
                      AND lower(other.contact_email) = lower(d.contact_email))
                  )
              ) AS possible_duplicate
       ${from}${where}
       ORDER BY d.created_at DESC, d.id DESC LIMIT ? OFFSET ?`
    ).bind(...values, pageSize, (page - 1) * pageSize).all();
    return json({ ok: true, deals: results || [], total, page, page_size: pageSize },
      200, null, noStoreHeaders);
  }

  if (request.method !== "PATCH") return json({ ok: false, error: "Unsupported deal review operation" }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid deal review update is required" }, 400);
  }
  const allowedFields = ["status", "decision_summary", "internal_note"];
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length === 0 || Object.keys(body).some((field) => !allowedFields.includes(field))) {
    return json({ ok: false, error: "Provide a valid status, decision summary, or internal note" }, 400);
  }
  const deal = await env.DB.prepare(
    "SELECT id, partner_organization_id, status, decision_summary, internal_note FROM deal_registrations WHERE id = ?"
  ).bind(dealId).first();
  if (!deal) return json({ ok: false, error: "Deal registration not found" }, 404);

  const nextStatus = Object.prototype.hasOwnProperty.call(body, "status") ? body.status : deal.status;
  if (!DEAL_REGISTRATION_STATUSES.includes(nextStatus) ||
      (nextStatus !== deal.status && !DEAL_STATUS_TRANSITIONS[deal.status]?.includes(nextStatus))) {
    return json({ ok: false, error: "This deal registration status transition is not allowed" }, 409);
  }
  const decisionSummary = Object.prototype.hasOwnProperty.call(body, "decision_summary")
    ? (body.decision_summary === "" || body.decision_summary === null ? null : boundedString(body.decision_summary, 1000))
    : deal.decision_summary;
  const internalNote = Object.prototype.hasOwnProperty.call(body, "internal_note")
    ? (body.internal_note === "" || body.internal_note === null ? null : boundedString(body.internal_note, 4000))
    : deal.internal_note;
  if ((Object.prototype.hasOwnProperty.call(body, "decision_summary") &&
        body.decision_summary != null && body.decision_summary !== "" && decisionSummary === null) ||
      (Object.prototype.hasOwnProperty.call(body, "internal_note") &&
        body.internal_note != null && body.internal_note !== "" && internalNote === null)) {
    return json({ ok: false, error: "Review notes exceed the allowed length or are invalid" }, 400);
  }
  if (nextStatus === "needs_information" && !decisionSummary) {
    return json({ ok: false, error: "Provide a partner-facing summary when requesting more information" }, 400);
  }
  if (nextStatus === "rejected" && !decisionSummary) {
    return json({ ok: false, error: "Provide a partner-facing summary when rejecting a registration" }, 400);
  }
  if (nextStatus === deal.status && decisionSummary === deal.decision_summary && internalNote === deal.internal_note) {
    return json({ ok: true, changed: false, status: deal.status }, 200, null, noStoreHeaders);
  }

  const update = await env.DB.prepare(
    `UPDATE deal_registrations
     SET status = ?, decision_summary = ?, internal_note = ?, reviewed_by_person_id = ?,
         updated_at = datetime('now')
     WHERE id = ? AND status = ?`
  ).bind(nextStatus, decisionSummary, internalNote, principal.person_id, deal.id, deal.status).run();
  if (update.meta.changes !== 1) {
    return json({ ok: false, error: "Deal registration changed; refresh and try again" }, 409);
  }
  await writeAudit(env, request, principal, "ADMIN_PARTNER_DEAL_REVIEWED", "deal_registration", deal.id,
    { status: deal.status, decision_summary: deal.decision_summary, internal_note: deal.internal_note },
    { status: nextStatus, decision_summary: decisionSummary, internal_note: internalNote });
  return json({ ok: true, changed: true, status: nextStatus }, 200, null, noStoreHeaders);
}

async function handleAdminFollowUps(request, env) {
  const principal = await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403);
  if (request.method !== "GET") return json({ ok: false, error: "The follow-up queue is read-only" }, 405);
  const noStoreHeaders = { "Cache-Control": "no-store" };
  const url = new URL(request.url);
  const pageValue = url.searchParams.get("page") || "1";
  const pageSizeValue = url.searchParams.get("page_size") || "50";
  if (!/^\d+$/.test(pageValue) || !Number.isSafeInteger(Number(pageValue)) || Number(pageValue) < 1) {
    return json({ ok: false, error: "A valid page number is required" }, 400);
  }
  if (!/^\d+$/.test(pageSizeValue) || !Number.isSafeInteger(Number(pageSizeValue)) ||
      Number(pageSizeValue) < 1 || Number(pageSizeValue) > 100) {
    return json({ ok: false, error: "Page size must be between 1 and 100" }, 400);
  }
  const queueQuery = `SELECT 'support_ticket' AS type, t.id, t.subject AS title, t.status,
                             COALESCE(NULLIF(c.company, ''), c.name) AS organization,
                             t.created_at, t.updated_at, NULL AS expires_at
                      FROM support_tickets t JOIN customers c ON c.id = t.customer_id
                      WHERE t.status IN ('open', 'in_progress')
                      UNION ALL
                      SELECT 'deal_registration', d.id, d.prospect_organization_name, d.status,
                             o.name, d.created_at, d.updated_at, NULL
                      FROM deal_registrations d JOIN organizations o ON o.id = d.partner_organization_id
                      WHERE d.status IN ('submitted', 'under_review')
                      UNION ALL
                      SELECT 'customer_invite', ci.id, ci.company, 'pending', ci.company,
                             ci.created_at, ci.created_at, ci.expires_at
                      FROM customer_invites ci
                      WHERE ci.status = 'pending' AND ci.expires_at > datetime('now')
                      UNION ALL
                      SELECT 'partner_invite', pi.id, pi.email, 'pending', o.name,
                             pi.created_at, pi.created_at, pi.expires_at
                      FROM partner_invites pi JOIN organizations o ON o.id = pi.partner_organization_id
                      WHERE pi.status = 'pending' AND pi.expires_at > datetime('now')`;
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM (${queueQuery})`).first();
  const total = Number(count?.total || 0);
  const pageSize = Number(pageSizeValue);
  const page = Math.min(Number(pageValue), Math.max(1, Math.ceil(total / pageSize)));
  const { results } = await env.DB.prepare(
    `SELECT * FROM (${queueQuery})
     ORDER BY created_at ASC, type ASC, id ASC LIMIT ? OFFSET ?`
  ).bind(pageSize, (page - 1) * pageSize).all();
  return json({
    ok: true,
    items: results || [],
    total,
    page,
    page_size: pageSize,
    policy: "manual_review_no_sla_or_outbound_messages",
  }, 200, null, noStoreHeaders);
}

const FOLLOW_UP_TASK_STATUSES = ["open", "in_progress", "completed", "cancelled"];

function validFollowUpDueDate(value) {
  if (value == null || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function validateFollowUpAssignee(env, value) {
  if (value == null || value === "") return { id: null, valid: true };
  const id = numericId(value);
  if (!id) return { id: null, valid: false };
  const user = await env.DB.prepare(
    "SELECT id FROM users WHERE id = ? AND status = 'active' AND role IN ('staff', 'admin', 'super_admin')"
  ).bind(id).first();
  return { id: user ? id : null, valid: Boolean(user) };
}

async function handleAdminFollowUpTasks(request, env, taskId = null) {
  const principal = await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403);
  const noStoreHeaders = { "Cache-Control": "no-store" };

  if (taskId === null) {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const status = (url.searchParams.get("status") || "").trim();
      const search = (url.searchParams.get("q") || "").trim();
      const assigneeValue = (url.searchParams.get("assigned_to_user_id") || "").trim();
      const pageValue = url.searchParams.get("page") || "1";
      const pageSizeValue = url.searchParams.get("page_size") || "50";
      if (status && !FOLLOW_UP_TASK_STATUSES.includes(status)) {
        return json({ ok: false, error: "A valid follow-up task status is required" }, 400);
      }
      if (search.length > 100) return json({ ok: false, error: "Search must be 100 characters or fewer" }, 400);
      if (assigneeValue && assigneeValue !== "unassigned" && !numericId(assigneeValue)) {
        return json({ ok: false, error: "A valid assignee id is required" }, 400);
      }
      if (!/^\d+$/.test(pageValue) || !Number.isSafeInteger(Number(pageValue)) || Number(pageValue) < 1) {
        return json({ ok: false, error: "A valid page number is required" }, 400);
      }
      if (!/^\d+$/.test(pageSizeValue) || !Number.isSafeInteger(Number(pageSizeValue)) ||
          Number(pageSizeValue) < 1 || Number(pageSizeValue) > 100) {
        return json({ ok: false, error: "Page size must be between 1 and 100" }, 400);
      }
      const clauses = [];
      const values = [];
      if (status) {
        clauses.push("t.status = ?");
        values.push(status);
      }
      if (assigneeValue === "unassigned") {
        clauses.push("t.assigned_to_user_id IS NULL");
      } else if (assigneeValue) {
        clauses.push("t.assigned_to_user_id = ?");
        values.push(Number(assigneeValue));
      }
      if (search) {
        const pattern = `%${search}%`;
        clauses.push("(CAST(t.id AS TEXT) LIKE ? OR t.title LIKE ? OR t.description LIKE ?)");
        values.push(pattern, pattern, pattern);
      }
      const from = `FROM follow_up_tasks t
        LEFT JOIN users u ON u.id = t.assigned_to_user_id`;
      const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
      const count = await env.DB.prepare(`SELECT COUNT(*) AS total ${from}${where}`).bind(...values).first();
      const total = Number(count?.total || 0);
      const pageSize = Number(pageSizeValue);
      const page = Math.min(Number(pageValue), Math.max(1, Math.ceil(total / pageSize)));
      const [{ results: tasks }, { results: assignees }] = await Promise.all([
        env.DB.prepare(
          `SELECT t.id, t.title, t.description, t.assigned_to_user_id, t.due_date, t.status,
                  t.created_by_person_id, t.created_at, t.updated_at,
                  u.name AS assigned_to_name, u.email AS assigned_to_email,
                  u.status AS assigned_to_status
           ${from}${where}
           ORDER BY CASE WHEN t.status IN ('completed', 'cancelled') THEN 1 ELSE 0 END,
                    t.due_date IS NULL, t.due_date, t.created_at DESC, t.id DESC
           LIMIT ? OFFSET ?`
        ).bind(...values, pageSize, (page - 1) * pageSize).all(),
        env.DB.prepare(
          `SELECT id, name, email, role FROM users
           WHERE status = 'active' AND role IN ('staff', 'admin', 'super_admin')
           ORDER BY name, email`
        ).all(),
      ]);
      return json({ ok: true, tasks: tasks || [], assignees: assignees || [], total, page, page_size: pageSize },
        200, null, noStoreHeaders);
    }

    if (request.method !== "POST") return json({ ok: false, error: "Unsupported follow-up task operation" }, 405);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "A valid follow-up task is required" }, 400);
    }
    const allowedFields = ["title", "description", "assigned_to_user_id", "due_date"];
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((field) => !allowedFields.includes(field))) {
      return json({ ok: false, error: "Only task details, owner, and due date can be provided" }, 400);
    }
    const title = boundedString(body.title, 200);
    const description = body.description == null || body.description === ""
      ? null
      : boundedString(body.description, 2000);
    const dueDate = body.due_date == null || body.due_date === "" ? null : body.due_date;
    const assignee = await validateFollowUpAssignee(env, body.assigned_to_user_id);
    if (!title || (body.description != null && body.description !== "" && !description) ||
        !validFollowUpDueDate(dueDate) || !assignee.valid) {
      return json({ ok: false, error: "Provide a title, valid optional description, active internal owner, and due date" }, 400);
    }
    const result = await env.DB.prepare(
      `INSERT INTO follow_up_tasks
       (title, description, assigned_to_user_id, due_date, created_by_person_id)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(title, description, assignee.id, dueDate, principal.person_id).run();
    await writeAudit(env, request, principal, "ADMIN_FOLLOW_UP_TASK_CREATED", "follow_up_task", result.meta.last_row_id,
      null, { title, assigned_to_user_id: assignee.id, due_date: dueDate, status: "open" });
    return json({ ok: true, task_id: result.meta.last_row_id, status: "open" }, 201, null, noStoreHeaders);
  }

  if (request.method !== "PATCH") return json({ ok: false, error: "Unsupported follow-up task operation" }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid follow-up task update is required" }, 400);
  }
  const allowedFields = ["title", "description", "assigned_to_user_id", "due_date", "status"];
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length === 0 || Object.keys(body).some((field) => !allowedFields.includes(field))) {
    return json({ ok: false, error: "Provide valid follow-up task fields" }, 400);
  }
  const task = await env.DB.prepare(
    `SELECT id, title, description, assigned_to_user_id, due_date, status, updated_at
     FROM follow_up_tasks WHERE id = ?`
  ).bind(taskId).first();
  if (!task) return json({ ok: false, error: "Follow-up task not found" }, 404);
  const title = Object.prototype.hasOwnProperty.call(body, "title")
    ? boundedString(body.title, 200)
    : task.title;
  const description = Object.prototype.hasOwnProperty.call(body, "description")
    ? (body.description == null || body.description === "" ? null : boundedString(body.description, 2000))
    : task.description;
  const dueDate = Object.prototype.hasOwnProperty.call(body, "due_date")
    ? (body.due_date == null || body.due_date === "" ? null : body.due_date)
    : task.due_date;
  const status = Object.prototype.hasOwnProperty.call(body, "status") ? body.status : task.status;
  const hasAssigneeField = Object.prototype.hasOwnProperty.call(body, "assigned_to_user_id");
  const requestedAssigneeId = body.assigned_to_user_id == null || body.assigned_to_user_id === ""
    ? null
    : numericId(body.assigned_to_user_id);
  const assignee = !hasAssigneeField || (
    (body.assigned_to_user_id == null || body.assigned_to_user_id === "" || requestedAssigneeId !== null) &&
    requestedAssigneeId === task.assigned_to_user_id
  )
    ? { id: task.assigned_to_user_id, valid: true }
    : await validateFollowUpAssignee(env, body.assigned_to_user_id);
  if (!title || (Object.prototype.hasOwnProperty.call(body, "description") &&
        body.description != null && body.description !== "" && !description) ||
      !validFollowUpDueDate(dueDate) || !assignee.valid ||
      !FOLLOW_UP_TASK_STATUSES.includes(status)) {
    return json({ ok: false, error: "Provide valid task details, an active internal owner, and a valid status and due date" }, 400);
  }
  if (title === task.title && description === task.description &&
      assignee.id === task.assigned_to_user_id && dueDate === task.due_date && status === task.status) {
    return json({ ok: true, changed: false, status }, 200, null, noStoreHeaders);
  }
  const update = await env.DB.prepare(
    `UPDATE follow_up_tasks
     SET title = ?, description = ?, assigned_to_user_id = ?, due_date = ?, status = ?,
         updated_at = datetime('now')
     WHERE id = ? AND updated_at = ? AND title = ? AND description IS ?
       AND assigned_to_user_id IS ? AND due_date IS ? AND status = ?`
  ).bind(
    title, description, assignee.id, dueDate, status,
    task.id, task.updated_at, task.title, task.description,
    task.assigned_to_user_id, task.due_date, task.status,
  ).run();
  if (update.meta.changes !== 1) {
    return json({ ok: false, error: "Follow-up task changed; refresh and try again" }, 409);
  }
  await writeAudit(env, request, principal, "ADMIN_FOLLOW_UP_TASK_UPDATED", "follow_up_task", task.id,
    {
      title: task.title,
      description: task.description,
      assigned_to_user_id: task.assigned_to_user_id,
      due_date: task.due_date,
      status: task.status,
    },
    { title, description, assigned_to_user_id: assignee.id, due_date: dueDate, status });
  return json({ ok: true, changed: true, status }, 200, null, noStoreHeaders);
}

async function updatePartnerCustomerContact(request, env, customerId) {
  const session = await getPartnerSession(request, env);
  if (!session || !(await hasPartnerPermission(env, session, "partner.view"))) {
    return json({ ok: false, error: "Partner access required" }, 403);
  }
  if (!PARTNER_SALES_TYPES.includes(session.partner_type) ||
      !(await hasPartnerPermission(env, session, "partner.customer.update_contact"))) {
    return json({ ok: false, error: "Customer contact updates are not authorized for this partner" }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid customer contact is required" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((field) => !["name", "phone", "organization_id"].includes(field))) {
    return json({ ok: false, error: "Only customer contact name, phone, and organization can be supplied" }, 400);
  }
  const name = boundedString(body.name, 120);
  const phone = boundedString(body.phone, 40);
  const requestedOrganizationId = body.organization_id == null || body.organization_id === ""
    ? null
    : numericId(body.organization_id);
  if (!name || !phone ||
      (body.organization_id != null && body.organization_id !== "" && !requestedOrganizationId)) {
    return json({ ok: false, error: "A valid contact name, phone number, and optional organization are required" }, 400);
  }

  const customers = await env.DB.prepare(
    `SELECT c.id, c.name, c.phone, om.organization_id
     FROM customers c
     JOIN organization_members om ON om.account_type = 'customer'
       AND om.account_id = c.id AND om.status = 'active'
     JOIN organizations customer_org ON customer_org.id = om.organization_id
       AND customer_org.status = 'active'
     JOIN partner_customer_links pcl ON pcl.customer_organization_id = om.organization_id
       AND pcl.partner_organization_id = ? AND pcl.status = 'active'
     WHERE c.id = ? AND c.status IN ('active', 'trial')
       ${requestedOrganizationId ? "AND om.organization_id = ?" : ""}`
  ).bind(...(requestedOrganizationId
    ? [session.partner_organization_id, customerId, requestedOrganizationId]
    : [session.partner_organization_id, customerId])).all();
  if (!requestedOrganizationId && (customers.results || []).length > 1) {
    return json({ ok: false, error: "Select the assigned customer organization for this contact" }, 409);
  }
  const customer = customers.results?.[0] || null;
  if (!customer) return json({ ok: false, error: "Assigned customer contact not found" }, 404);
  const changedFields = [];
  if (customer.name !== name) changedFields.push("name");
  if (customer.phone !== phone) changedFields.push("phone");
  if (changedFields.length) {
    await env.DB.batch([
      env.DB.prepare("UPDATE customers SET name = ?, phone = ? WHERE id = ?").bind(name, phone, customer.id),
      env.DB.prepare(
        "UPDATE people SET name = ? WHERE source_type = 'customer' AND source_id = ?"
      ).bind(name, customer.id),
    ]);
    await env.DB.prepare(
      `INSERT INTO audit_logs
       (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
       VALUES (?, ?, 'PARTNER_CUSTOMER_CONTACT_UPDATED', 'customer', ?, ?, ?, ?)`
    ).bind(
      session.person_id, customer.organization_id, String(customer.id),
      JSON.stringify({ fields: changedFields }), JSON.stringify({ fields: changedFields }),
      request.headers.get("CF-Connecting-IP") || null,
    ).run();
  }
  return json({ ok: true, updated_fields: changedFields }, 200, null, { "Cache-Control": "no-store" });
}

async function createPartnerCustomerInvite(request, env, session) {
  if (!(await hasPartnerPermission(env, session, "partner.customer.create")) ||
      !PARTNER_SALES_TYPES.includes(session.partner_type)) {
    return json({ ok: false, error: "Customer registration is not authorized for this partner" }, 403);
  }
  const limited = await requireRateLimit(
    env, request, "partner-customer-invite-create", 20, 3600, String(session.person_id),
  );
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid customer registration request is required" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "A valid customer registration request is required" }, 400);
  }
  const email = validEmail(body.email);
  const phone = boundedString(body.phone, 40);
  const company = boundedString(body.company, 200);
  const name = body.name == null || body.name === "" ? null : boundedString(body.name, 120);
  if (!email || !phone || !company || (body.name != null && body.name !== "" && !name)) {
    return json({ ok: false, error: "A valid customer email, phone number, organization name, and optional contact name are required" }, 400);
  }
  if (await emailAlreadyRegistered(env, email)) {
    return json({ ok: false, error: "This account already exists. Ask SMRITISYS to link the existing customer." }, 409);
  }

  const duplicateOrganization = await env.DB.prepare(
    `SELECT id FROM organizations
     WHERE lower(trim(COALESCE(NULLIF(legal_name, ''), name))) = lower(trim(?))
        OR lower(trim(name)) = lower(trim(?))
     ORDER BY id LIMIT 1`
  ).bind(company, company).first();
  if (duplicateOrganization) {
    return json({ ok: false, error: "This organization already exists. Ask SMRITISYS to link the existing customer." }, 409);
  }
  const pendingInvite = await env.DB.prepare(
    `SELECT id FROM customer_invites
     WHERE lower(email) = ? AND status = 'pending' AND expires_at > datetime('now') LIMIT 1`
  ).bind(email).first();
  if (pendingInvite) return json({ ok: false, error: "An active invitation already exists for this email" }, 409);

  const token = makeToken();
  const tokenHash = await hashCustomerInviteToken(token);
  const auditValue = JSON.stringify({
    email,
    name,
    company,
    partner_organization_id: session.partner_organization_id,
    expires_in_hours: 24,
  });
  const clientIp = request.headers.get("CF-Connecting-IP") || null;
  let results;
  try {
    results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE customer_invites SET status = 'revoked'
         WHERE lower(email) = ? AND status = 'pending' AND expires_at <= datetime('now')`
      ).bind(email),
      env.DB.prepare(
        `INSERT INTO customer_invites
        (token_hash, email, name, phone, company, created_by, expires_at, invited_by_partner_organization_id)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+24 hours'), ?)`
      ).bind(tokenHash, email, name, phone, company, session.person_id, session.partner_organization_id),
      env.DB.prepare(
        `INSERT INTO audit_logs
         (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
         SELECT ?, ?, 'PARTNER_CUSTOMER_INVITE_CREATED', 'customer_invite',
                CAST(id AS TEXT), NULL, ?, ?
         FROM customer_invites WHERE token_hash = ?`
      ).bind(session.person_id, session.partner_organization_id, auditValue, clientIp, tokenHash),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return json({ ok: false, error: "An active invitation already exists for this email" }, 409);
    }
    throw error;
  }
  if (results[1].meta.changes !== 1 || results[2].meta.changes !== 1) {
    throw new Error("Partner customer invitation could not be recorded");
  }
  return json({
    ok: true,
    setup_path: `/accept-invite.html#token=${token}`,
    expires_in_hours: 24,
    invite_id: results[1].meta.last_row_id,
  }, 201, null, { "Cache-Control": "no-store" });
}

async function handleDemo(request, env) {
  const limited = await requireRateLimit(env, request, "demo", 5, 3600);
  if (limited) return limited;
  const body = await request.json();
  const name = boundedString(body.name, 120);
  const email = validEmail(body.email);
  const phone = boundedString(body.phone, 40);
  const stores = boundedString(body.stores, 20);
  const message = boundedString(body.message, 5000);
  if (!name || !email) return json({ ok: false, error: "Name and email are required" }, 400);

  await env.DB.prepare(
    `INSERT INTO demo_requests (name, email, phone, stores, message) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(name, email, phone || null, stores || null, message || null)
    .run();

  return json({ ok: true, message: "Demo request received. We will contact you soon." });
}

function customerIdentityStatements(
  env,
  customerIdExpression,
  customerIdBindings,
  personStatus,
  memberStatus,
  memberRole,
  organizationIdExpression = null,
  organizationIdBindings = [],
) {
  const companyName = "COALESCE(NULLIF(trim(c.company), ''), NULLIF(trim(c.name), ''), 'Customer')";
  const organizationName = organizationIdExpression
    ? companyName
    : `(${companyName} || ' #' || c.id)`;
  const organizationId = organizationIdExpression
    ? `(${organizationIdExpression})`
    : `(SELECT CASE WHEN COUNT(*) = 1 THEN MAX(o.id) END FROM organizations o
        WHERE lower(trim(o.name)) = lower(trim(${organizationName}))
          AND o.status = 'active')`;
  const organizationExists = organizationIdExpression
    ? `o.id = ${organizationIdExpression}`
    : `lower(trim(o.name)) = lower(trim(${organizationName}))`;
  const bindCustomerId = () => [...customerIdBindings];
  const bindOrganizationId = () => [...organizationIdBindings];

  return [
    env.DB.prepare(
      `INSERT OR IGNORE INTO people (email, name, source_type, source_id, status)
       SELECT c.email, c.name, 'customer', c.id, ?
       FROM customers c WHERE c.id = ${customerIdExpression}`
    ).bind(personStatus, ...bindCustomerId()),
    env.DB.prepare(
      `INSERT INTO organizations (name, legal_name, status)
       SELECT ${organizationName}, ${companyName}, 'active'
       FROM customers c
       WHERE c.id = ${customerIdExpression}
         ${organizationIdExpression ? `AND (${organizationIdExpression}) IS NULL` : ""}
         AND NOT EXISTS (
           SELECT 1 FROM organizations o
           WHERE ${organizationExists}
             AND lower(trim(o.name)) <> 'smritisys internal'
         )`
    ).bind(...bindCustomerId(), ...bindOrganizationId()),
    env.DB.prepare(
      `INSERT INTO organization_members
       (organization_id, account_type, account_id, member_role, status)
       SELECT o.id, 'customer', c.id, ?, ?
       FROM customers c
       JOIN organizations o ON o.id = ${organizationId} AND o.status = 'active'
       WHERE c.id = ${customerIdExpression}
       ON CONFLICT(organization_id, account_type, account_id)
       DO UPDATE SET status = excluded.status`
    ).bind(memberRole, memberStatus, ...bindOrganizationId(), ...bindCustomerId()),
    env.DB.prepare(
      `INSERT OR IGNORE INTO relationships (organization_id, relationship_type, status)
       SELECT ${organizationId}, 'customer', 'active'
       FROM customers c
       WHERE c.id = ${customerIdExpression} AND ${organizationId} IS NOT NULL`
    ).bind(...bindOrganizationId(), ...bindCustomerId()),
  ];
}

async function ensureIdentityForAccount(env, accountType, accountId, email, name, status, company = null, role = null) {
  if (accountType === "customer") {
    await env.DB.batch(customerIdentityStatements(
      env,
      "?",
      [accountId],
      status || "active",
      status === "inactive" ? "inactive" : "active",
      role || "customer",
    ));
    return;
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO people (email, name, source_type, source_id, status)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(email, name || null, accountType, accountId, status || "active")
    .run();

  const organizationName = "SMRITISYS Internal";
  await env.DB.prepare(
    `INSERT INTO organizations (name, legal_name, status)
     SELECT ?, ?, 'active'
     WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE name = ?)`
  )
    .bind(organizationName, organizationName, organizationName)
    .run();
  const organization = await env.DB.prepare(
    `SELECT CASE WHEN COUNT(*) = 1 THEN MAX(id) END AS id
     FROM organizations WHERE name = ? AND status = 'active'`
  ).bind(organizationName).first();
  if (!organization?.id) throw new Error("A unique active internal organization is required");
  const memberRole = role || "staff";
  await env.DB.prepare(
    `INSERT OR IGNORE INTO organization_members
     (organization_id, account_type, account_id, member_role, status)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(organization.id, accountType, accountId, memberRole, status === "inactive" ? "inactive" : "active")
    .run();
}

async function emailAlreadyRegistered(env, email) {
  const existing = await env.DB.prepare(
    `SELECT 1 AS registered FROM customers WHERE lower(email) = ?
    UNION ALL SELECT 1 FROM users WHERE lower(email) = ?
    UNION ALL SELECT 1 FROM people WHERE lower(email) = ?
    LIMIT 1`
  ).bind(email, email, email).first();
  return Boolean(existing);
}

async function handleAdminCustomerInvites(request, env, origin) {
  const principal = await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403);

  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
     `SELECT i.id, i.email, i.name, COALESCE(o.legal_name, o.name, i.company) AS company,
             i.organization_id, i.customer_id, partner.name AS invited_by_partner,
             CASE WHEN i.status = 'pending' AND i.expires_at <= datetime('now') THEN 'expired' ELSE i.status END AS status,
             i.created_at, i.expires_at, i.accepted_at
      FROM customer_invites i
      LEFT JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN organizations partner ON partner.id = i.invited_by_partner_organization_id
      ORDER BY i.created_at DESC, i.id DESC LIMIT 100`
    ).all();
    return json({ ok: true, invites: results }, 200, origin, { "Cache-Control": "no-store" });
  }

  const limited = await requireRateLimit(env, request, "customer-invite-create", 20, 3600, String(principal.person_id));
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid JSON invitation request is required" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "A valid invitation request is required" }, 400);
  }

  const email = validEmail(body.email);
  const phone = boundedString(body.phone, 40);
  const suppliedCompany = boundedString(body.company, 200);
  const requestedOrganizationId = body.organization_id == null || body.organization_id === ""
    ? null
    : numericId(String(body.organization_id));
  const suppliedName = body.name;
  const name = suppliedName == null || suppliedName === "" ? null : boundedString(suppliedName, 120);
  if (!email || !phone || (body.organization_id != null && body.organization_id !== "" && !requestedOrganizationId) ||
      (suppliedName != null && suppliedName !== "" && !name)) {
    return json({ ok: false, error: "A valid email and phone number, optional organization, and optional name are required" }, 400);
  }

  const existingUser = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = ? LIMIT 1").bind(email).first();
  if (existingUser) return json({ ok: false, error: "This email belongs to an internal user account" }, 409);

  const existingCustomer = await env.DB.prepare(
    "SELECT id, status, company, phone FROM customers WHERE lower(email) = ? LIMIT 1"
  ).bind(email).first();
  let organization = null;
  if (requestedOrganizationId) {
    organization = await env.DB.prepare(
      `SELECT id, name, legal_name, status FROM organizations
       WHERE id = ? AND status = 'active' AND lower(trim(name)) <> 'smritisys internal'
         AND EXISTS (
           SELECT 1 FROM relationships r
           WHERE r.organization_id = organizations.id
             AND r.relationship_type = 'customer'
             AND r.status = 'active'
         )`
    ).bind(requestedOrganizationId).first();
    if (!organization) return json({ ok: false, error: "Select an active organization" }, 400);
  } else if (!suppliedCompany) {
    return json({ ok: false, error: "An organization name is required when creating a new organization" }, 400);
  }

  if (existingCustomer && existingCustomer.status === "active") {
    if (!organization) {
      return json({ ok: false, error: "This account already exists. Select its organization to add it as a contact." }, 409);
    }
    const memberships = await env.DB.prepare(
      `SELECT organization_id FROM organization_members
       WHERE account_type = 'customer' AND account_id = ? AND status = 'active'`
    ).bind(existingCustomer.id).all();
    const activeOrganizationIds = (memberships.results || []).map((membership) => Number(membership.organization_id));
    if (!existingCustomer.phone) {
      await env.DB.prepare(
        "UPDATE customers SET phone = ? WHERE id = ? AND (phone IS NULL OR trim(phone) = '')"
      ).bind(phone, existingCustomer.id).run();
      await writeAudit(
        env, request, principal, "CUSTOMER_CONTACT_PHONE_ADDED", "customer",
        existingCustomer.id, null, { email, organization_id: organization.id },
      );
    }
    if (!activeOrganizationIds.includes(Number(organization.id))) {
      await env.DB.batch([
        ...customerIdentityStatements(
          env,
          "?",
          [existingCustomer.id],
          "active",
          "active",
          "customer",
          "?",
          [organization.id],
        ),
      ]);
      await writeAudit(
        env,
        request,
        principal,
        "CUSTOMER_ORGANIZATION_MEMBER_ADDED",
        "customer",
        existingCustomer.id,
        null,
        { email, organization_id: organization.id },
      );
    }
    return json({
      ok: true,
      membership_added: !activeOrganizationIds.includes(Number(organization.id)),
      message: activeOrganizationIds.includes(Number(organization.id))
        ? "This customer is already a member of the selected organization."
        : "Existing customer added to the selected organization.",
    }, 200, origin, { "Cache-Control": "no-store" });
  }

  let company = organization ? (organization.legal_name || organization.name) : suppliedCompany;
  let customerId = null;
  if (existingCustomer) {
    if (existingCustomer.status !== "inactive") {
      return json({ ok: false, error: "This customer account cannot be converted through an invitation" }, 409);
    }
    const priorMemberships = await env.DB.prepare(
      `SELECT organization_id, status FROM organization_members
       WHERE account_type = 'customer' AND account_id = ?
       ORDER BY status = 'active' DESC, id`
    ).bind(existingCustomer.id).all();
    const allPriorMemberships = priorMemberships.results || [];
    const activePriorMemberships = allPriorMemberships.filter((membership) => membership.status === "active");
    const selectableMemberships = activePriorMemberships.length ? activePriorMemberships : allPriorMemberships;
    if (selectableMemberships.length &&
        (!organization || !selectableMemberships.some(
          (membership) => Number(membership.organization_id) === Number(organization.id),
        ))) {
      return json({ ok: false, error: "Select the organization already associated with this account" }, 409);
    }
    if (!organization) {
      return json({ ok: false, error: "Select the existing organization to activate this account" }, 409);
    }
    customerId = existingCustomer.id;
  } else if (await emailAlreadyRegistered(env, email)) {
    return json({ ok: false, error: "An account already exists for this email" }, 409);
  }

  if (!organization) {
    const duplicateOrganization = await env.DB.prepare(
      `SELECT id FROM organizations
       WHERE lower(trim(COALESCE(NULLIF(legal_name, ''), name))) = lower(trim(?))
          OR lower(trim(name)) = lower(trim(?))
       ORDER BY id LIMIT 1`
    ).bind(company, company).first();
    if (duplicateOrganization) {
      return json({ ok: false, error: "This organization already exists. Select it to reuse the existing record." }, 409);
    }
  }

  const pendingInvite = await env.DB.prepare(
    `SELECT id FROM customer_invites
    WHERE lower(email) = ? AND status = 'pending' AND expires_at > datetime('now') LIMIT 1`
  ).bind(email).first();
  if (pendingInvite) return json({ ok: false, error: "An active invitation already exists for this email" }, 409);

  const token = makeToken();
  const tokenHash = await hashCustomerInviteToken(token);
  const auditValue = JSON.stringify({
    email,
    name,
    company,
    organization_id: organization?.id || null,
    existing_customer_id: customerId,
    expires_in_hours: 24,
  });
  const clientIp = request.headers.get("CF-Connecting-IP") || null;
  let results;
  try {
    results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE customer_invites SET status = 'revoked'
         WHERE lower(email) = ? AND status = 'pending' AND expires_at <= datetime('now')`
      ).bind(email),
      env.DB.prepare(
        `INSERT INTO customer_invites
         (token_hash, email, name, phone, company, created_by, expires_at, organization_id, customer_id)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+24 hours'), ?, ?)`
      ).bind(tokenHash, email, name, phone, company, principal.person_id, organization?.id || null, customerId),
      env.DB.prepare(
        `INSERT INTO audit_logs
         (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
         SELECT ?, NULL, 'CUSTOMER_INVITE_CREATED', 'customer_invite',
                CAST(id AS TEXT), NULL, ?, ?
         FROM customer_invites WHERE token_hash = ?`
      ).bind(principal.person_id, auditValue, clientIp, tokenHash),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
     return json({ ok: false, error: "An active invitation already exists for this email" }, 409);
    }
    throw error;
  }
  const [, created, audited] = results;
  if (created.meta.changes !== 1 || audited.meta.changes !== 1) {
    throw new Error("Customer invitation could not be recorded");
  }

  return json({
    ok: true,
    setup_path: `/accept-invite.html#token=${token}`,
    expires_in_hours: 24,
    invite_id: created.meta.last_row_id,
  }, 201, origin, { "Cache-Control": "no-store" });
}

async function handleAdminCustomerInviteRevocation(request, env, inviteId) {
  const principal = await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403);

  const invite = await env.DB.prepare(
    "SELECT id, email, company, status FROM customer_invites WHERE id = ?"
  ).bind(inviteId).first();
  if (!invite) return json({ ok: false, error: "Invitation not found" }, 404);
  if (invite.status !== "pending") return json({ ok: false, error: "Only pending invitations can be revoked" }, 409);

  const updated = await env.DB.prepare(
    `UPDATE customer_invites SET status = 'revoked'
    WHERE id = ? AND status = 'pending'`
  ).bind(inviteId).run();
  if (updated.meta.changes !== 1) {
    return json({ ok: false, error: "Invitation is no longer pending" }, 409);
  }
  await writeAudit(
    env,
    request,
    principal,
    "CUSTOMER_INVITE_REVOKED",
    "customer_invite",
    inviteId,
    null,
    { email: invite.email, company: invite.company },
  );
  return json({ ok: true, message: "Invitation revoked" }, 200, null, { "Cache-Control": "no-store" });
}

async function handleCustomerInviteAcceptance(request, env, origin) {
  const limited = await requireRateLimit(env, request, "customer-invite-accept", 5, 3600);
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid invitation setup request is required" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "A valid invitation setup request is required" }, 400);
  }
  const token = body.token;
  const password = body.password;
  if (!isValidCustomerInviteToken(token) || typeof password !== "string" || password.length < 12 || password.length > 128) {
    return json({ ok: false, error: "A valid invitation token and password of 12 to 128 characters are required" }, 400);
  }

  const tokenHash = await hashCustomerInviteToken(token);
  const invitation = await env.DB.prepare(
    `SELECT id, email, name, phone, company, organization_id, customer_id,
            invited_by_partner_organization_id
     FROM customer_invites
     WHERE token_hash = ? AND status = 'pending' AND expires_at > datetime('now')
       AND (
         invited_by_partner_organization_id IS NULL
         OR EXISTS (
           SELECT 1 FROM organizations partner
           JOIN relationships partner_relationship ON partner_relationship.organization_id = partner.id
           WHERE partner.id = customer_invites.invited_by_partner_organization_id
             AND partner.status = 'active' AND partner_relationship.status = 'active'
             AND partner_relationship.relationship_type IN ('channel_partner', 'reseller', 'distributor')
         )
       )`
  ).bind(tokenHash).first();
  if (!invitation) return json({ ok: false, error: "This invitation is invalid, expired, or already used" }, 410);
  if (!invitation.phone) {
    return json({ ok: false, error: "This invitation predates required contact details. Ask the administrator for a new invitation." }, 409);
  }
  const existingCustomer = invitation.customer_id
    ? await env.DB.prepare(
     `SELECT id FROM customers
      WHERE id = ? AND lower(email) = ? AND status = 'inactive'`
    ).bind(invitation.customer_id, invitation.email).first()
    : null;
  if ((invitation.customer_id && !existingCustomer) ||
     (!invitation.customer_id && await emailAlreadyRegistered(env, invitation.email))) {
    return json({ ok: false, error: "An account already exists for this invitation email" }, 409);
  }

  const passwordHash = await hashPassword(password);
  const clientIp = request.headers.get("CF-Connecting-IP") || null;
  const auditValue = JSON.stringify({
    email: invitation.email,
    company: invitation.company,
    organization_id: invitation.organization_id || null,
    converted_customer_id: invitation.customer_id || null,
    partner_organization_id: invitation.invited_by_partner_organization_id || null,
  });
  try {
    const acceptInvite = env.DB.prepare(
     `UPDATE customer_invites SET status = 'accepted', accepted_at = datetime('now')
      WHERE id = ? AND status = 'pending' AND expires_at > datetime('now')`
    ).bind(invitation.id);
    const identityStatements = customerIdentityStatements(
     env,
     invitation.customer_id
       ? "?"
       : "(SELECT customer_id FROM customer_invites WHERE id = ? AND status = 'accepted')",
     invitation.customer_id ? [invitation.customer_id] : [invitation.id],
     "active",
     "active",
     "customer",
     invitation.organization_id ? "(SELECT organization_id FROM customer_invites WHERE id = ?)" : null,
     invitation.organization_id ? [invitation.id] : [],
    );
    const partnerCustomerLinkStatement = env.DB.prepare(
     `INSERT INTO partner_customer_links
      (partner_organization_id, customer_organization_id, status)
      SELECT i.invited_by_partner_organization_id, om.organization_id, 'active'
      FROM customer_invites i
      JOIN organization_members om ON om.account_type = 'customer'
        AND om.account_id = i.customer_id AND om.status = 'active'
      WHERE i.id = ? AND i.status = 'accepted'
        AND i.invited_by_partner_organization_id IS NOT NULL
      ON CONFLICT(partner_organization_id, customer_organization_id)
      DO UPDATE SET status = partner_customer_links.status`
    ).bind(invitation.id);
    const auditStatement = env.DB.prepare(
     `INSERT INTO audit_logs
      (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
      SELECT p.id, om.organization_id, 'CUSTOMER_INVITE_ACCEPTED', 'customer', CAST(c.id AS TEXT),
             NULL, ?, ?
      FROM customer_invites i
      JOIN customers c ON c.id = i.customer_id
      JOIN people p ON p.source_type = 'customer' AND p.source_id = c.id
      JOIN organization_members om ON om.account_type = 'customer' AND om.account_id = c.id AND om.status = 'active'
      WHERE i.id = ? AND i.status = 'accepted'`
    ).bind(auditValue, clientIp, invitation.id);
    const results = invitation.customer_id
     ? await env.DB.batch([
       acceptInvite,
       env.DB.prepare(
         `UPDATE customers
          SET password_hash = ?, name = COALESCE(?, name),
              phone = COALESCE(NULLIF(phone, ''), ?), company = ?, status = 'active'
          WHERE id = ? AND status = 'inactive'
            AND EXISTS (SELECT 1 FROM customer_invites WHERE id = ? AND status = 'accepted')`
       ).bind(passwordHash, invitation.name, invitation.phone, invitation.company, invitation.customer_id, invitation.id),
       env.DB.prepare(
         `UPDATE people SET name = COALESCE(?, name), status = 'active'
          WHERE source_type = 'customer' AND source_id = ?`
       ).bind(invitation.name, invitation.customer_id),
       ...identityStatements,
       partnerCustomerLinkStatement,
       auditStatement,
     ])
     : await env.DB.batch([
       acceptInvite,
       env.DB.prepare(
         `INSERT INTO customers (email, password_hash, name, phone, company)
          SELECT ?, ?, ?, ?, ? WHERE changes() = 1`
       ).bind(invitation.email, passwordHash, invitation.name, invitation.phone, invitation.company),
       env.DB.prepare(
         `UPDATE customer_invites
          SET customer_id = (SELECT id FROM customers WHERE lower(email) = lower(?) LIMIT 1)
          WHERE id = ? AND status = 'accepted' AND customer_id IS NULL AND changes() = 1`
       ).bind(invitation.email, invitation.id),
       ...identityStatements,
       partnerCustomerLinkStatement,
       auditStatement,
     ]);

    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1 ||
       (!invitation.customer_id && results[2].meta.changes !== 1)) {
     return json({ ok: false, error: "This invitation is invalid, expired, or already used" }, 410);
    }
    if (invitation.invited_by_partner_organization_id &&
        Number(results[7]?.meta?.changes || 0) !== 1) {
      throw new Error("The new customer could not be linked to the inviting partner");
    }
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
     return json({ ok: false, error: "An account already exists for this invitation email" }, 409);
    }
    throw error;
  }

  return json({ ok: true, message: "Account setup is complete. You can now sign in." }, 200, origin, { "Cache-Control": "no-store" });
}

const ADMIN_PARTNER_TYPES = [
  "channel_partner",
  "reseller",
  "implementation_partner",
  "technology_partner",
  "referral_partner",
  "distributor",
];

const PARTNER_SALES_TYPES = ["channel_partner", "reseller", "distributor"];

function isAdminPartnerType(value) {
  return ADMIN_PARTNER_TYPES.includes(value);
}

async function handleAdminPartners(request, env, origin) {
  const principal = await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403);

  if (request.method === "GET") {
    const [partners, members, links] = await Promise.all([
      env.DB.prepare(
        `SELECT o.id, o.name, o.legal_name, o.address, o.city, o.state, o.pincode,
                o.country, o.phone, o.status, r.relationship_type AS partner_type,
                COUNT(DISTINCT m.id) AS member_count,
                COUNT(DISTINCT CASE WHEN pcl.status = 'active' THEN pcl.id END) AS linked_customer_count,
                (SELECT COUNT(*) FROM partner_invites pi
                 WHERE pi.partner_organization_id = o.id AND pi.status = 'pending'
                   AND pi.expires_at > datetime('now')) AS pending_invite_count,
                (SELECT COUNT(*) FROM license_code_inventory lci
                 WHERE lci.assigned_partner_organization_id = o.id) AS allocated_code_count,
                (SELECT COUNT(*) FROM license_code_inventory lci
                 WHERE lci.assigned_partner_organization_id = o.id AND lci.status = 'claimed') AS claimed_code_count
         FROM organizations o
         JOIN relationships r ON r.organization_id = o.id
           AND r.relationship_type IN (
             'channel_partner', 'reseller', 'implementation_partner',
             'technology_partner', 'referral_partner', 'distributor'
           )
         LEFT JOIN organization_members m ON m.organization_id = o.id
           AND m.member_role IN ('partner_admin', 'partner_member') AND m.status = 'active'
         LEFT JOIN partner_customer_links pcl ON pcl.partner_organization_id = o.id
         GROUP BY o.id, r.relationship_type
         ORDER BY o.name, r.relationship_type`
      ).all(),
      env.DB.prepare(
        `SELECT m.id, m.organization_id AS partner_organization_id, m.account_type, m.account_id,
                m.member_role AS partner_role, m.status, r.relationship_type AS partner_type,
                p.name, p.email
         FROM organization_members m
         JOIN relationships r ON r.organization_id = m.organization_id
           AND r.relationship_type IN (
             'channel_partner', 'reseller', 'implementation_partner',
             'technology_partner', 'referral_partner', 'distributor'
           )
         JOIN people p ON p.source_type = m.account_type AND p.source_id = m.account_id
         WHERE m.member_role IN ('partner_admin', 'partner_member')
         ORDER BY m.organization_id, m.status, p.name, p.email`
      ).all(),
      env.DB.prepare(
        `SELECT pcl.id, pcl.partner_organization_id, partner.name AS partner_name,
                pcl.customer_organization_id, customer.name AS customer_name,
                pcl.status, pcl.created_at
         FROM partner_customer_links pcl
         JOIN organizations partner ON partner.id = pcl.partner_organization_id
         JOIN organizations customer ON customer.id = pcl.customer_organization_id
         ORDER BY partner.name, customer.name`
      ).all(),
    ]);
    return json({
      ok: true,
      partner_types: ADMIN_PARTNER_TYPES,
      partners: partners.results || [],
      members: members.results || [],
      links: links.results || [],
    }, 200, origin, { "Cache-Control": "no-store" });
  }

  if (request.method !== "POST") return json({ ok: false, error: "Unsupported partner operation" }, 405);
  return createAdminPartnerContact(request, env, origin, principal, null);
}

async function updateAdminPartner(request, env, partnerOrganizationId) {
  const principal = await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid partner update is required" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "A valid partner update is required" }, 400);
  }

  const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
  const hasPartnerType = Object.prototype.hasOwnProperty.call(body, "partner_type");
  if ((!hasStatus && !hasPartnerType) ||
      (hasStatus && !["active", "inactive"].includes(body.status)) ||
      (hasPartnerType && !isAdminPartnerType(body.partner_type))) {
    return json({ ok: false, error: "Provide a valid partner status or partner type" }, 400);
  }

  const current = await env.DB.prepare(
    `SELECT o.id, o.name, o.status, r.id AS relationship_id,
            r.relationship_type AS partner_type
     FROM organizations o
     JOIN relationships r ON r.organization_id = o.id
       AND r.relationship_type IN (
         'channel_partner', 'reseller', 'implementation_partner',
         'technology_partner', 'referral_partner', 'distributor'
       )
     WHERE o.id = ?
     ORDER BY r.id LIMIT 1`
  ).bind(partnerOrganizationId).first();
  if (!current) return json({ ok: false, error: "Partner organization not found" }, 404);

  const nextStatus = hasStatus ? body.status : current.status;
  const nextPartnerType = hasPartnerType ? body.partner_type : current.partner_type;
  const statusChanged = nextStatus !== current.status;
  const partnerTypeChanged = nextPartnerType !== current.partner_type;
  if (!statusChanged && !partnerTypeChanged) {
    return json({ ok: true, unchanged: true });
  }

  if (partnerTypeChanged) {
    const conflictingType = await env.DB.prepare(
      `SELECT id FROM relationships
       WHERE organization_id = ? AND relationship_type = ? AND id <> ? LIMIT 1`
    ).bind(partnerOrganizationId, nextPartnerType, current.relationship_id).first();
    if (conflictingType) {
      return json({ ok: false, error: "This organization already has the requested partner classification" }, 409);
    }
  }

  const oldValue = { status: current.status, partner_type: current.partner_type };
  const newValue = { status: nextStatus, partner_type: nextPartnerType };
  const statements = [];
  if (statusChanged) {
    statements.push(env.DB.prepare(
      `UPDATE organizations SET status = ? WHERE id = ? AND status = ?
       AND EXISTS (
         SELECT 1 FROM relationships
         WHERE id = ? AND organization_id = ? AND relationship_type = ?
       )`
    ).bind(
      nextStatus, partnerOrganizationId, current.status,
      current.relationship_id, partnerOrganizationId, current.partner_type,
    ));
  }
  if (partnerTypeChanged) {
    statements.push(env.DB.prepare(
      `UPDATE relationships SET relationship_type = ?
       WHERE id = ? AND organization_id = ? AND relationship_type = ?${statusChanged ? " AND changes() = 1" : ""}`
    ).bind(nextPartnerType, current.relationship_id, partnerOrganizationId, current.partner_type));
  }
  statements.push(env.DB.prepare(
    `INSERT INTO audit_logs
     (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
     SELECT ?, ?, 'PARTNER_UPDATED', 'partner', ?, ?, ?, ?
     WHERE changes() = 1`
  ).bind(
    principal.person_id,
    partnerOrganizationId,
    String(partnerOrganizationId),
    JSON.stringify(oldValue),
    JSON.stringify(newValue),
    request.headers.get("CF-Connecting-IP") || null,
  ));
  if (partnerTypeChanged) {
    statements.push(
      env.DB.prepare(
        `UPDATE partner_memberships SET partner_type = ?
         WHERE partner_organization_id = ?
           AND EXISTS (
             SELECT 1 FROM relationships
             WHERE organization_id = ? AND relationship_type = ?
           )`
      ).bind(nextPartnerType, partnerOrganizationId, partnerOrganizationId, nextPartnerType),
      env.DB.prepare(
        `UPDATE partner_invites SET partner_type = ?
         WHERE partner_organization_id = ? AND status = 'pending'
           AND EXISTS (
             SELECT 1 FROM relationships
             WHERE organization_id = ? AND relationship_type = ?
           )`
      ).bind(nextPartnerType, partnerOrganizationId, partnerOrganizationId, nextPartnerType),
    );
  }

  const results = await env.DB.batch(statements);
  if ((statusChanged && Number(results[0]?.meta?.changes || 0) !== 1) ||
      (partnerTypeChanged && Number(results[statusChanged ? 1 : 0]?.meta?.changes || 0) !== 1)) {
    return json({ ok: false, error: "Partner details changed before this update could be saved" }, 409);
  }
  const auditIndex = statusChanged || partnerTypeChanged ? (statusChanged && partnerTypeChanged ? 2 : 1) : 0;
  if (Number(results[auditIndex]?.meta?.changes || 0) !== 1) {
    return json({ ok: false, error: "Partner details changed before this update could be saved" }, 409);
  }
  return json({ ok: true, partner: { id: partnerOrganizationId, ...newValue } });
}

async function updateAdminPartnerMember(request, env, partnerOrganizationId, membershipId) {
  const principal = await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid partner member update is required" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "A valid partner member update is required" }, 400);
  }

  const hasRole = Object.prototype.hasOwnProperty.call(body, "partner_role");
  const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
  if ((!hasRole && !hasStatus) ||
      (hasRole && !["partner_admin", "partner_member"].includes(body.partner_role)) ||
      (hasStatus && !["active", "inactive"].includes(body.status))) {
    return json({ ok: false, error: "Provide a valid partner role or member status" }, 400);
  }

  const membership = await env.DB.prepare(
    `SELECT m.id, m.organization_id AS partner_organization_id, m.account_type, m.account_id,
            m.member_role AS partner_role, m.status, p.name, p.email
     FROM organization_members m
     JOIN people p ON p.source_type = m.account_type AND p.source_id = m.account_id
     JOIN relationships r ON r.organization_id = m.organization_id
       AND r.relationship_type IN (
         'channel_partner', 'reseller', 'implementation_partner',
         'technology_partner', 'referral_partner', 'distributor'
       )
     WHERE m.id = ? AND m.organization_id = ?
       AND m.member_role IN ('partner_admin', 'partner_member')
     LIMIT 1`
  ).bind(membershipId, partnerOrganizationId).first();
  if (!membership) return json({ ok: false, error: "Partner member not found" }, 404);

  const nextRole = hasRole ? body.partner_role : membership.partner_role;
  const nextStatus = hasStatus ? body.status : membership.status;
  if (nextRole === membership.partner_role && nextStatus === membership.status) {
    return json({ ok: true, unchanged: true });
  }
  const removingActiveAdmin = membership.status === "active" &&
    membership.partner_role === "partner_admin" &&
    (nextStatus !== "active" || nextRole !== "partner_admin");
  if (removingActiveAdmin) {
    const activeAdmins = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM organization_members
       WHERE organization_id = ? AND status = 'active' AND member_role = 'partner_admin'`
    ).bind(partnerOrganizationId).first();
    if (Number(activeAdmins?.count || 0) <= 1) {
      return json({ ok: false, error: "Keep at least one active partner administrator" }, 409);
    }
  }

  const oldValue = { partner_role: membership.partner_role, status: membership.status };
  const newValue = { partner_role: nextRole, status: nextStatus };
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE organization_members
       SET member_role = ?, status = ?
       WHERE id = ? AND organization_id = ?
         AND member_role = ? AND status = ?
         AND (
           (? = 'partner_admin' AND ? = 'active') OR
           member_role <> 'partner_admin' OR status <> 'active' OR
           (SELECT COUNT(*) FROM organization_members
            WHERE organization_id = ? AND member_role = 'partner_admin' AND status = 'active') > 1
         )`
    ).bind(
      nextRole, nextStatus, membershipId, partnerOrganizationId,
      membership.partner_role, membership.status,
      nextRole, nextStatus, partnerOrganizationId,
    ),
    env.DB.prepare(
      `INSERT INTO partner_memberships
       (partner_organization_id, account_type, account_id, partner_role, partner_type, status)
       SELECT m.organization_id, m.account_type, m.account_id, m.member_role, r.relationship_type, m.status
       FROM organization_members m
       JOIN relationships r ON r.organization_id = m.organization_id
         AND r.relationship_type IN (
           'channel_partner', 'reseller', 'implementation_partner',
           'technology_partner', 'referral_partner', 'distributor'
         )
       WHERE m.id = ? AND m.member_role = ? AND m.status = ? AND changes() = 1
       ON CONFLICT(partner_organization_id, account_type, account_id)
       DO UPDATE SET partner_role = excluded.partner_role,
                     partner_type = excluded.partner_type, status = excluded.status`
    ).bind(
      membershipId, nextRole, nextStatus,
    ),
    env.DB.prepare(
      `INSERT INTO audit_logs
       (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
       SELECT ?, ?, 'PARTNER_MEMBER_UPDATED', 'partner_membership', ?, ?, ?, ?
       WHERE changes() = 1`
    ).bind(
      principal.person_id,
      partnerOrganizationId,
      String(membershipId),
      JSON.stringify(oldValue),
      JSON.stringify(newValue),
      request.headers.get("CF-Connecting-IP") || null,
    ),
  ]);
  if (Number(results?.[0]?.meta?.changes || 0) !== 1 ||
      Number(results?.[1]?.meta?.changes || 0) !== 1 ||
      Number(results?.[2]?.meta?.changes || 0) !== 1) {
    return json({ ok: false, error: "Partner member details changed before this update could be saved" }, 409);
  }
  return json({ ok: true, member: { id: membershipId, ...newValue } });
}

async function createAdminPartnerContact(request, env, origin, principal, requestedPartnerId) {
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403);
  const limited = await requireRateLimit(
    env,
    request,
    "admin-partner-create",
    30,
    3600,
    String(principal.person_id),
  );
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid partner request is required" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "A valid partner request is required" }, 400);
  }

  const email = validEmail(body.email);
  const phone = boundedString(body.phone, 40);
  const name = body.name == null || body.name === "" ? null : boundedString(body.name, 120);
  const organizationName = body.organization_name == null || body.organization_name === ""
    ? null
    : boundedString(body.organization_name, 200);
  const partnerType = body.partner_type;
  const partnerRole = body.partner_role || "partner_admin";
  const bodyOrganizationId = body.organization_id == null || body.organization_id === ""
    ? null
    : numericId(String(body.organization_id));
  if (!email || !phone || (body.name != null && body.name !== "" && !name) ||
      !isAdminPartnerType(partnerType) ||
      !["partner_admin", "partner_member"].includes(partnerRole) ||
      (body.organization_id != null && body.organization_id !== "" && !bodyOrganizationId) ||
      (requestedPartnerId && bodyOrganizationId && Number(requestedPartnerId) !== bodyOrganizationId)) {
    return json({ ok: false, error: "A valid email and phone number, partner type, role, and organization are required" }, 400);
  }

  const organizationDetails = {
    legal_name: optionalPartnerOrganizationValue(body.legal_name, 200),
    address: optionalPartnerOrganizationValue(body.address, 500),
    city: optionalPartnerOrganizationValue(body.city, 120),
    state: optionalPartnerOrganizationValue(body.state, 120),
    pincode: optionalPartnerOrganizationValue(body.pincode, 20),
    country: optionalPartnerOrganizationValue(body.country, 120),
    phone: optionalPartnerOrganizationValue(body.organization_phone, 40),
    tax_id: optionalPartnerOrganizationValue(body.tax_id, 80),
    website: optionalPartnerOrganizationValue(body.website, 255),
  };
  const organizationDetailInputs = [
    ["legal_name", body.legal_name, 200],
    ["address", body.address, 500],
    ["city", body.city, 120],
    ["state", body.state, 120],
    ["pincode", body.pincode, 20],
    ["country", body.country, 120],
    ["phone", body.organization_phone, 40],
    ["tax_id", body.tax_id, 80],
    ["website", body.website, 255],
  ];
  if (organizationDetailInputs.some(([key, value, maxLength]) =>
    value != null && (typeof value !== "string" ||
      (value.trim() !== "" && (value.trim().length > maxLength || !organizationDetails[key]))))) {
    return json({ ok: false, error: "One or more partner organization details are invalid" }, 400);
  }

  const organizationId = requestedPartnerId || bodyOrganizationId;
  const internalUser = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = ? LIMIT 1").bind(email).first();
  if (internalUser) return json({ ok: false, error: "This email belongs to an internal user account" }, 409);
  const existingCustomer = await env.DB.prepare(
    "SELECT id, status, phone FROM customers WHERE lower(email) = ? LIMIT 1"
  ).bind(email).first();
  if (existingCustomer && existingCustomer.status !== "active") {
    return json({ ok: false, error: "Activate this existing customer account before assigning partner access" }, 409);
  }
  if (!existingCustomer && await emailAlreadyRegistered(env, email)) {
    return json({ ok: false, error: "An account already exists for this email" }, 409);
  }
  let organization = organizationId
    ? await env.DB.prepare(
      `SELECT id, name, legal_name, status FROM organizations
       WHERE id = ? AND status = 'active' AND lower(trim(name)) <> 'smritisys internal'
         AND NOT EXISTS (
           SELECT 1 FROM relationships r
           WHERE r.organization_id = organizations.id
             AND r.relationship_type = 'customer'
         )`
    ).bind(organizationId).first()
    : null;
  if (organizationId && !organization) return json({ ok: false, error: "Partner organization not found or inactive" }, 404);
  if (!organization) {
    if (!organizationName) return json({ ok: false, error: "A partner organization name is required" }, 400);
    const duplicate = await env.DB.prepare(
      `SELECT id FROM organizations
       WHERE lower(trim(COALESCE(NULLIF(legal_name, ''), name))) = lower(trim(?))
          OR lower(trim(name)) = lower(trim(?))
       ORDER BY id LIMIT 1`
    ).bind(organizationName, organizationName).first();
    if (duplicate) {
      return json({ ok: false, error: "This organization already exists. Select it to reuse the existing record." }, 409);
    }
    const created = await env.DB.prepare(
      `INSERT INTO organizations
       (name, legal_name, address, city, state, pincode, country, phone, tax_id, website, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    ).bind(
      organizationName,
      organizationDetails.legal_name || organizationName,
      organizationDetails.address,
      organizationDetails.city,
      organizationDetails.state,
      organizationDetails.pincode,
      organizationDetails.country,
      organizationDetails.phone,
      organizationDetails.tax_id,
      organizationDetails.website,
    ).run();
    organization = {
      id: created.meta.last_row_id,
      name: organizationName,
      legal_name: organizationName,
      status: "active",
    };
  }

  const assignedPartnerType = await env.DB.prepare(
    `SELECT relationship_type FROM relationships
     WHERE organization_id = ? AND relationship_type IN (
       'channel_partner', 'reseller', 'implementation_partner',
       'technology_partner', 'referral_partner', 'distributor'
     ) LIMIT 1`
  ).bind(organization.id).first();
  if (assignedPartnerType && assignedPartnerType.relationship_type !== partnerType) {
    return json({ ok: false, error: "This organization is already classified as a different partner type" }, 409);
  }
  const token = existingCustomer ? null : makeToken();
  const tokenHash = token ? await hashCustomerInviteToken(token) : null;
  const auditAction = existingCustomer ? "PARTNER_MEMBER_ADDED" : "PARTNER_INVITE_CREATED";
  const auditValue = JSON.stringify({
    email,
    partner_type: partnerType,
    partner_role: partnerRole,
    organization_id: organization.id,
    existing_customer_id: existingCustomer?.id || null,
    contact_phone_added: Boolean(existingCustomer && !existingCustomer.phone),
  });
  const clientIp = request.headers.get("CF-Connecting-IP") || null;
  const statements = [
    env.DB.prepare(
      `INSERT INTO relationships (organization_id, relationship_type, status)
       VALUES (?, ?, 'active')
       ON CONFLICT(organization_id, relationship_type)
       DO UPDATE SET status = 'active'`
    ).bind(organization.id, partnerType),
  ];
  const updatedOrganizationFields = Object.entries(organizationDetails)
    .filter(([, value]) => value !== null)
    .map(([field]) => field);
  if (organizationId && updatedOrganizationFields.length) {
    statements.push(
      env.DB.prepare(
        `UPDATE organizations
         SET legal_name = COALESCE(?, legal_name), address = COALESCE(?, address),
             city = COALESCE(?, city), state = COALESCE(?, state), pincode = COALESCE(?, pincode),
             country = COALESCE(?, country), phone = COALESCE(?, phone),
             tax_id = COALESCE(?, tax_id), website = COALESCE(?, website)
         WHERE id = ?`
      ).bind(
        organizationDetails.legal_name, organizationDetails.address, organizationDetails.city,
        organizationDetails.state, organizationDetails.pincode, organizationDetails.country,
        organizationDetails.phone, organizationDetails.tax_id, organizationDetails.website,
        organization.id,
      ),
      env.DB.prepare(
        `INSERT INTO audit_logs
         (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
         SELECT ?, ?, 'PARTNER_ORGANIZATION_DETAILS_UPDATED', 'organization', ?, NULL, ?, ?
         WHERE changes() = 1`
      ).bind(
        principal.person_id, organization.id, String(organization.id),
        JSON.stringify({ fields: updatedOrganizationFields }),
        clientIp,
      ),
    );
  }
  if (existingCustomer) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO organization_members
         (organization_id, account_type, account_id, member_role, status)
         VALUES (?, 'customer', ?, ?, 'active')
         ON CONFLICT(organization_id, account_type, account_id)
         DO UPDATE SET member_role = excluded.member_role, status = excluded.status`
      ).bind(organization.id, existingCustomer.id, partnerRole),
      env.DB.prepare(
        `INSERT INTO partner_memberships
         (partner_organization_id, account_type, account_id, partner_role, partner_type, status)
         VALUES (?, 'customer', ?, ?, ?, 'active')
         ON CONFLICT(partner_organization_id, account_type, account_id)
         DO UPDATE SET partner_role = excluded.partner_role,
                       partner_type = excluded.partner_type, status = excluded.status`
      ).bind(organization.id, existingCustomer.id, partnerRole, partnerType),
    );
    if (!existingCustomer.phone) {
      statements.push(env.DB.prepare(
        "UPDATE customers SET phone = ? WHERE id = ? AND (phone IS NULL OR trim(phone) = '')"
      ).bind(phone, existingCustomer.id));
    }
  } else {
    statements.push(
      env.DB.prepare(
        `INSERT INTO partner_invites
         (token_hash, partner_organization_id, email, name, phone, partner_type, partner_role, created_by, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+24 hours'))`
      ).bind(tokenHash, organization.id, email, name, phone, partnerType, partnerRole, principal.person_id),
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO audit_logs
       (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
       VALUES (?, ?, ?, 'partner', ?, NULL, ?, ?)`
    ).bind(
      principal.person_id,
      organization.id,
      auditAction,
      String(organization.id),
      auditValue,
      clientIp,
    ),
  );

  let results;
  try {
    results = await env.DB.batch(statements);
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return json({ ok: false, error: "An active invitation already exists for this partner and email" }, 409);
    }
    throw error;
  }
  if (results[0].meta.changes !== 1 || results[results.length - 1].meta.changes !== 1) {
    throw new Error("Partner contact change could not be recorded");
  }

  return json({
    ok: true,
    partner_organization_id: organization.id,
    membership_added: Boolean(existingCustomer),
    ...(token ? {
      setup_path: `/accept-invite.html#type=partner&token=${token}`,
      expires_in_hours: 24,
    } : {}),
  }, existingCustomer ? 200 : 201, origin, { "Cache-Control": "no-store" });
}

async function handleAdminPartnerCustomerLink(request, env, partnerOrganizationId, customerOrganizationId, revoke = false) {
  const principal = await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403);
  if (!customerOrganizationId && !revoke) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "A customer organization is required" }, 400);
    }
    customerOrganizationId = numericId(String(body?.customer_organization_id || ""));
  }
  if (!customerOrganizationId) return json({ ok: false, error: "A valid customer organization id is required" }, 400);
  if (partnerOrganizationId === customerOrganizationId) {
    return json({ ok: false, error: "An organization cannot be linked to itself" }, 400);
  }
  const partner = await env.DB.prepare(
    `SELECT id FROM organizations o
     WHERE o.id = ? AND o.status = 'active'
       AND EXISTS (SELECT 1 FROM relationships r WHERE r.organization_id = o.id
         AND r.relationship_type IN (
           'channel_partner', 'reseller', 'implementation_partner',
           'technology_partner', 'referral_partner', 'distributor'
         ) AND r.status = 'active')`
  ).bind(partnerOrganizationId).first();
  if (!partner) return json({ ok: false, error: "Partner organization not found" }, 404);

  const customer = await env.DB.prepare(
    `SELECT o.id, o.name FROM organizations o
     WHERE o.id = ? AND o.status = 'active'
       AND EXISTS (SELECT 1 FROM relationships r WHERE r.organization_id = o.id
         AND r.relationship_type = 'customer' AND r.status = 'active')`
  ).bind(customerOrganizationId).first();
  if (!customer) return json({ ok: false, error: "Select an active customer organization" }, 400);

  const existing = await env.DB.prepare(
    `SELECT id, status FROM partner_customer_links
     WHERE partner_organization_id = ? AND customer_organization_id = ?`
  ).bind(partnerOrganizationId, customerOrganizationId).first();
  if (revoke) {
    if (!existing || existing.status !== "active") {
      return json({ ok: false, error: "Active customer link not found" }, 404);
    }
    const updated = await env.DB.prepare(
      `UPDATE partner_customer_links SET status = 'revoked'
       WHERE id = ? AND status = 'active'`
    ).bind(existing.id).run();
    if (updated.meta.changes !== 1) return json({ ok: false, error: "Customer link is no longer active" }, 409);
    await writeAudit(
      env,
      request,
      principal,
      "PARTNER_CUSTOMER_LINK_REVOKED",
      "partner_customer_link",
      existing.id,
      { partner_organization_id: partnerOrganizationId, customer_organization_id: customerOrganizationId },
      null,
    );
    return json({ ok: true, message: "Customer link revoked" }, 200, null, { "Cache-Control": "no-store" });
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO partner_customer_links (partner_organization_id, customer_organization_id, status)
       VALUES (?, ?, 'active')
       ON CONFLICT(partner_organization_id, customer_organization_id)
       DO UPDATE SET status = 'active'`
    ).bind(partnerOrganizationId, customerOrganizationId),
  ]);
  if (!existing || existing.status !== "active") {
    await writeAudit(
      env,
      request,
      principal,
      "PARTNER_CUSTOMER_LINK_CREATED",
      "partner_customer_link",
      existing?.id || customerOrganizationId,
      null,
      { partner_organization_id: partnerOrganizationId, customer_organization_id: customerOrganizationId },
    );
  }
  return json({ ok: true, message: "Customer organization linked" }, 200, null, { "Cache-Control": "no-store" });
}

async function handleAdminPartnerInvites(request, env, origin, inviteId = null) {
  const principal = await requireSuperAdmin(request, env);
  if (!principal) return json({ ok: false, error: "Super admin access required" }, 403);
  if (request.method === "GET" && !inviteId) {
    const { results } = await env.DB.prepare(
      `SELECT pi.id, pi.email, pi.name, pi.partner_organization_id, o.name AS partner_name,
              pi.partner_type, pi.partner_role,
              CASE WHEN pi.status = 'pending' AND pi.expires_at <= datetime('now') THEN 'expired' ELSE pi.status END AS status,
              pi.created_at, pi.expires_at, pi.accepted_at
       FROM partner_invites pi
       JOIN organizations o ON o.id = pi.partner_organization_id
       ORDER BY pi.created_at DESC, pi.id DESC LIMIT 100`
    ).all();
    return json({ ok: true, invites: results || [] }, 200, origin, { "Cache-Control": "no-store" });
  }
  if (request.method !== "POST" || !inviteId) return json({ ok: false, error: "Unsupported partner invitation operation" }, 405);

  const invite = await env.DB.prepare(
    "SELECT id, email, partner_organization_id, partner_type, partner_role, status FROM partner_invites WHERE id = ?"
  ).bind(inviteId).first();
  if (!invite) return json({ ok: false, error: "Invitation not found" }, 404);
  if (invite.status !== "pending") return json({ ok: false, error: "Only pending invitations can be revoked" }, 409);
  const updated = await env.DB.prepare(
    "UPDATE partner_invites SET status = 'revoked' WHERE id = ? AND status = 'pending'"
  ).bind(inviteId).run();
  if (updated.meta.changes !== 1) return json({ ok: false, error: "Invitation is no longer pending" }, 409);
  await writeAudit(
    env,
    request,
    principal,
    "PARTNER_INVITE_REVOKED",
    "partner_invite",
    inviteId,
    null,
    { email: invite.email, partner_organization_id: invite.partner_organization_id },
  );
  return json({ ok: true, message: "Invitation revoked" }, 200, null, { "Cache-Control": "no-store" });
}

async function handlePartnerInviteAcceptance(request, env, origin) {
  const limited = await requireRateLimit(env, request, "partner-invite-accept", 5, 3600);
  if (limited) return limited;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid partner setup request is required" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "A valid partner setup request is required" }, 400);
  }
  if (!isValidCustomerInviteToken(body.token) || typeof body.password !== "string" ||
      body.password.length < 12 || body.password.length > 128) {
    return json({ ok: false, error: "A valid invitation token and password of 12 to 128 characters are required" }, 400);
  }
  const tokenHash = await hashCustomerInviteToken(body.token);
  const invitation = await env.DB.prepare(
    `SELECT pi.id, pi.email, pi.name, pi.phone, pi.partner_organization_id, pi.partner_type, pi.partner_role,
            o.name AS partner_name
     FROM partner_invites pi
     JOIN organizations o ON o.id = pi.partner_organization_id AND o.status = 'active'
     JOIN relationships r ON r.organization_id = o.id
       AND r.relationship_type = pi.partner_type AND r.status = 'active'
     WHERE pi.token_hash = ? AND pi.status = 'pending' AND pi.expires_at > datetime('now')`
  ).bind(tokenHash).first();
  if (!invitation) return json({ ok: false, error: "This invitation is invalid, expired, or already used" }, 410);
  if (!invitation.phone) {
    return json({ ok: false, error: "This invitation predates required contact details. Ask the administrator for a new invitation." }, 409);
  }
  if (await emailAlreadyRegistered(env, invitation.email)) {
    return json({ ok: false, error: "An account already exists for this invitation email" }, 409);
  }

  const passwordHash = await hashPassword(body.password);
  const clientIp = request.headers.get("CF-Connecting-IP") || null;
  const auditValue = JSON.stringify({
    email: invitation.email,
    partner_type: invitation.partner_type,
    partner_role: invitation.partner_role,
  });
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE partner_invites SET status = 'accepted', accepted_at = datetime('now')
         WHERE id = ? AND status = 'pending' AND expires_at > datetime('now')`
      ).bind(invitation.id),
      env.DB.prepare(
        `INSERT INTO customers (email, password_hash, name, phone, company)
         SELECT ?, ?, ?, ?, ? WHERE changes() = 1`
      ).bind(invitation.email, passwordHash, invitation.name, invitation.phone, invitation.partner_name),
      env.DB.prepare(
        `UPDATE partner_invites
         SET customer_id = (SELECT id FROM customers WHERE lower(email) = lower(?) LIMIT 1)
         WHERE id = ? AND status = 'accepted' AND customer_id IS NULL AND changes() = 1`
      ).bind(invitation.email, invitation.id),
      env.DB.prepare(
        `INSERT INTO people (email, name, source_type, source_id, status)
         SELECT c.email, c.name, 'customer', c.id, 'active'
         FROM customers c JOIN partner_invites pi ON pi.customer_id = c.id
         WHERE pi.id = ? AND pi.status = 'accepted'
         ON CONFLICT(source_type, source_id) DO UPDATE SET status = 'active'`
      ).bind(invitation.id),
      env.DB.prepare(
        `INSERT INTO organization_members
         (organization_id, account_type, account_id, member_role, status)
         SELECT pi.partner_organization_id, 'customer', pi.customer_id, pi.partner_role, 'active'
         FROM partner_invites pi WHERE pi.id = ? AND pi.status = 'accepted'
         ON CONFLICT(organization_id, account_type, account_id)
         DO UPDATE SET member_role = excluded.member_role, status = excluded.status`
      ).bind(invitation.id),
      env.DB.prepare(
        `INSERT INTO partner_memberships
         (partner_organization_id, account_type, account_id, partner_role, partner_type, status)
         SELECT pi.partner_organization_id, 'customer', pi.customer_id, pi.partner_role, pi.partner_type, 'active'
         FROM partner_invites pi WHERE pi.id = ? AND pi.status = 'accepted'
         ON CONFLICT(partner_organization_id, account_type, account_id)
         DO UPDATE SET partner_role = excluded.partner_role,
                       partner_type = excluded.partner_type, status = excluded.status`
      ).bind(invitation.id),
      env.DB.prepare(
        `INSERT INTO audit_logs
         (actor_person_id, organization_id, action, resource_type, resource_id, old_value, new_value, request_ip)
         SELECT p.id, pi.partner_organization_id, 'PARTNER_INVITE_ACCEPTED', 'partner_member',
                CAST(c.id AS TEXT), NULL, ?, ?
         FROM partner_invites pi
         JOIN customers c ON c.id = pi.customer_id
         JOIN people p ON p.source_type = 'customer' AND p.source_id = c.id
         WHERE pi.id = ? AND pi.status = 'accepted'`
      ).bind(auditValue, clientIp, invitation.id),
    ]);
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1 ||
        results[2].meta.changes !== 1) {
      return json({ ok: false, error: "This invitation is invalid, expired, or already used" }, 410);
    }
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return json({ ok: false, error: "An account already exists for this invitation email" }, 409);
    }
    throw error;
  }
  return json({ ok: true, message: "Partner access is ready. You can now sign in." }, 200, origin, { "Cache-Control": "no-store" });
}

async function handleSignup(request, env) {
  const limited = await requireRateLimit(env, request, "signup", 5, 3600);
  if (limited) return limited;
  const body = await request.json();
  const type = body.type;
  const email = validEmail(body.email);
  const password = boundedString(body.password, 128);
  const name = boundedString(body.name, 120);
  const phone = boundedString(body.phone, 40);
  const company = boundedString(body.company, 200);

  if (!email || !password || password.length < 12 || !type) {
    return json({ ok: false, error: "A valid email, password of at least 12 characters, and account type are required" }, 400);
  }
  if (!["user", "customer"].includes(type)) {
    return json({ ok: false, error: "type must be 'user' or 'customer'" }, 400);
  }
  if (type === "customer" && !phone) {
    return json({ ok: false, error: "A customer phone number is required" }, 400);
  }

  if (type === "user") {
    const bootstrapToken = request.headers.get("X-Staff-Bootstrap");
    if (!env.STAFF_BOOTSTRAP_TOKEN || bootstrapToken !== env.STAFF_BOOTSTRAP_TOKEN) {
      return json({ ok: false, error: "Staff accounts require an authorized bootstrap" }, 403);
    }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
       VALUES ('staff_bootstrap_consumed', '0')`
    ).run();
  }

  const password_hash = await hashPassword(password);

  try {
    if (type === "user") {
      const [claim, result] = await env.DB.batch([
        env.DB.prepare(
          `UPDATE system_settings SET setting_value = '1', updated_at = datetime('now')
           WHERE setting_key = 'staff_bootstrap_consumed' AND setting_value = '0'`
        ),
        env.DB.prepare(
          `INSERT INTO users (email, password_hash, name, role)
           SELECT ?, ?, ?, ? WHERE changes() = 1`
        ).bind(email.toLowerCase(), password_hash, name || null, "super_admin"),
      ]);
      if (claim.meta.changes !== 1 || result.meta.changes !== 1) {
        return json({ ok: false, error: "Staff bootstrap has already been consumed" }, 403);
      }
      await ensureIdentityForAccount(env, "user", result.meta.last_row_id, email.toLowerCase(), name, "active", null, "super_admin");
    } else {
      const result = await env.DB.prepare(
        `INSERT INTO customers (email, password_hash, name, phone, company) VALUES (?, ?, ?, ?, ?)`
      )
        .bind(email.toLowerCase(), password_hash, name || null, phone, company || null)
        .run();
      await ensureIdentityForAccount(env, "customer", result.meta.last_row_id, email.toLowerCase(), name, "active", company, "customer");
    }
    return json({ ok: true, message: "Account created successfully" });
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return json({ ok: false, error: "Email already registered" }, 409);
    }
    return json({ ok: false, error: "Signup failed" }, 500);
  }
}

async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid JSON login request is required" }, 400);
  }
  const type = body.type;
  const email = validEmail(body.email);
  const password = boundedString(body.password, 128);

  const limited = await requireRateLimit(env, request, "login", 10, 900, email || "invalid");
  if (limited) return limited;

  if (!email || !password) {
    return json({ ok: false, error: "email and password are required" }, 400);
  }
  if (type && !["user", "customer"].includes(type)) {
    return json({ ok: false, error: "type must be 'user' or 'customer'" }, 400);
  }

  let row = null;
  let accountType = type;

  if (!type || type === "user") {
    row = await env.DB.prepare(
      `SELECT id, email, password_hash, name, role, status FROM users WHERE email = ?`
    )
      .bind(email.toLowerCase())
      .first();
    if (row && !(await verifyPassword(password, row.password_hash))) row = null;
    if (row) accountType = "user";
  }
  if (!row && (!type || type === "customer")) {
    row = await env.DB.prepare(
      `SELECT id, email, password_hash, name, phone, company, status FROM customers WHERE email = ?`
    )
      .bind(email.toLowerCase())
      .first();
    if (row && !(await verifyPassword(password, row.password_hash))) row = null;
    if (row) accountType = "customer";
  }

  if (!row) return json({ ok: false, error: "Invalid email or password" }, 401);
  if (row.status !== "active" && row.status !== "trial") {
    return json({ ok: false, error: "Account is not active" }, 403);
  }

  if (!row.password_hash.startsWith("pbkdf2-sha256$")) {
    const upgradedHash = await hashPassword(password);
    const table = accountType === "user" ? "users" : "customers";
    await env.DB.prepare(`UPDATE ${table} SET password_hash = ? WHERE id = ?`).bind(upgradedHash, row.id).run();
  }

  const token = makeToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, ?, ?, ?)`
  )
    .bind(token, accountType, row.id, expires)
    .run();

  const { password_hash: _passwordHash, ...safeRow } = row;
  return json({ ok: true, token, account_type: accountType, user: safeRow }, 200, null, { "Set-Cookie": sessionCookie(token) });
}

async function handleMe(request, env) {
  const principal = await getIdentitySession(request, env);
  if (!principal) return json({ ok: false, error: "Invalid or expired session" }, 401);

  let account;
  if (principal.account_type === "user") {
    account = await env.DB.prepare(
      `SELECT id, email, name, role, status FROM users WHERE id = ?`
    )
      .bind(principal.account_id)
      .first();
  } else {
    account = await env.DB.prepare(
      `SELECT id, email, name, phone, company, status FROM customers WHERE id = ?`
    )
      .bind(principal.account_id)
      .first();
  }

  const { person_id: _personId, person_status: _personStatus, membership_status: _membershipStatus, organization_status: _organizationStatus, ...identity } = principal;
  return json({ ok: true, account_type: principal.account_type, user: account, identity });
}

async function handleLogout(request, env) {
  const token = requestSessionToken(request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json({ ok: true, message: "Signed out" }, 200, null, { "Set-Cookie": clearedSessionCookie() });
}

async function handlePasswordChange(request, env) {
  const session = await getCustomerSession(request, env);
  if (!session) return json({ ok: false, error: "Customer login required" }, 401);
  const limited = await requireRateLimit(env, request, "password", 5, 900, String(session.account_id));
  if (limited) return limited;
  const body = await request.json();
  const currentPassword = boundedString(body.current_password, 128);
  const newPassword = boundedString(body.new_password, 128);
  if (!currentPassword || !newPassword || newPassword.length < 12) {
    return json({ ok: false, error: "Current password and a new password of at least 12 characters are required" }, 400);
  }
  const customer = await env.DB.prepare("SELECT password_hash FROM customers WHERE id = ? AND status IN ('active', 'trial')").bind(session.account_id).first();
  if (!customer || !(await verifyPassword(currentPassword, customer.password_hash))) {
    return json({ ok: false, error: "Current password is incorrect" }, 403);
  }
  const passwordHash = await hashPassword(newPassword);
  await env.DB.batch([
    env.DB.prepare("UPDATE customers SET password_hash = ? WHERE id = ?").bind(passwordHash, session.account_id),
    env.DB.prepare("DELETE FROM sessions WHERE account_type = 'customer' AND account_id = ?").bind(session.account_id),
  ]);
  await writeAudit(env, request, session, "CUSTOMER_PASSWORD_CHANGED", "customer", session.account_id);
  return json({ ok: true, message: "Password changed. Please sign in again." });
}

async function handleAdminPasswordChange(request, env) {
  const session = await getIdentitySession(request, env);
  if (!session || session.account_type !== "user") {
    return json({ ok: false, error: "Staff login required" }, 401);
  }
  const limited = await requireRateLimit(env, request, "admin-password", 5, 900, String(session.account_id));
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "A valid JSON password request is required" }, 400);
  }
  const currentPassword = boundedString(body.current_password, 128);
  const newPassword = boundedString(body.new_password, 128);
  if (!currentPassword || !newPassword || newPassword.length < 12) {
    return json({ ok: false, error: "Current password and a new password of at least 12 characters are required" }, 400);
  }

  const user = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ? AND status = 'active'")
    .bind(session.account_id)
    .first();
  if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
    return json({ ok: false, error: "Current password is incorrect" }, 403);
  }

  const passwordHash = await hashPassword(newPassword);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(passwordHash, session.account_id),
    env.DB.prepare("DELETE FROM sessions WHERE account_type = 'user' AND account_id = ?").bind(session.account_id),
  ]);
  await writeAudit(env, request, session, "STAFF_PASSWORD_CHANGED", "user", session.account_id);
  return json({ ok: true, message: "Password changed. Please sign in again." }, 200, null, { "Set-Cookie": clearedSessionCookie() });
}

async function handleListDemos(request, env) {
  const session = await requireSuperAdmin(request, env);
  if (!session) return json({ ok: false, error: "Super admin access required" }, 403);

  const { results } = await env.DB.prepare(
    `SELECT id, name, email, phone, stores, status, created_at FROM demo_requests ORDER BY created_at DESC LIMIT 100`
  ).all();

  return json({ ok: true, demos: results });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "") || "";
  const origin = isTrustedOrigin(request, env);
  const isUnsafeMethod = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
  const hasBearerToken = /^Bearer\s+\S+$/i.test(request.headers.get("Authorization") || "");
  const hasCookieSession = Boolean(getCookie(request, "smritisys_session"));

  if (isUnsafeMethod && hasCookieSession && !hasBearerToken &&
      request.headers.get("Origin") !== url.origin && !origin) {
    return json({ ok: false, error: "A trusted origin is required for cookie-authenticated requests" }, 403);
  }
  if (request.method === "OPTIONS") return cors(origin);

  try {
    if (path === "license/activate" && request.method === "POST") return await activateLicense(request, env, origin);
    if (path === "license/refresh" && request.method === "POST") return await refreshLicense(request, env, origin);
    if (path === "license/email/request" && request.method === "POST") {
      return await requestLicenseEmailCode(request, env, origin);
    }
    if (path === "license/email/verify" && request.method === "POST") {
      return await verifyLicenseEmail(request, env, origin);
    }
    if (path === "license/manage" && request.method === "POST") {
      return await manageLicenseActivation(request, env, origin);
    }
    if (path === "license-verification-keys" && request.method === "GET") return await handlePublicLicenseKeys(env);
    if (path === "demo" && request.method === "POST") return await handleDemo(request, env);
    if (path === "customer-invites/accept" && request.method === "POST") {
      return await handleCustomerInviteAcceptance(request, env, origin);
    }
    if (path === "password-reset/complete" && request.method === "POST") {
      return await completeCustomerPasswordReset(request, env);
    }
    if (path === "partner-invites/accept" && request.method === "POST") {
      return await handlePartnerInviteAcceptance(request, env, origin);
    }
    if (path === "signup" && request.method === "POST") return await handleSignup(request, env);
    if (path === "login" && request.method === "POST") return await handleLogin(request, env);
    if (path === "logout" && request.method === "POST") return await handleLogout(request, env);
    if (path === "organization-context" && ["GET", "POST"].includes(request.method)) {
      return await handleOrganizationContext(request, env);
    }
    if (path === "me" && request.method === "GET") return await handleMe(request, env);
    if (path === "password" && request.method === "POST") return await handlePasswordChange(request, env);
    if (path === "admin/password" && request.method === "POST") return await handleAdminPasswordChange(request, env);
    if (path === "admin/customer-invites" && ["GET", "POST"].includes(request.method)) {
      return await handleAdminCustomerInvites(request, env, origin);
    }
    if (path === "admin/customers" && request.method === "GET") {
      return await handleAdminCustomers(request, env);
    }
    const customerPasswordResetMatch = path.match(/^admin\/customers\/(\d+)\/password-reset$/);
    if (customerPasswordResetMatch && request.method === "POST") {
      const customerId = numericId(customerPasswordResetMatch[1]);
      if (!customerId) return json({ ok: false, error: "A valid customer id is required" }, 400);
      return await createAdminCustomerPasswordReset(request, env, customerId);
    }
    const adminCustomerProfileMatch = path.match(/^admin\/customers\/(\d+)$/);
    if (adminCustomerProfileMatch && ["GET", "PATCH"].includes(request.method)) {
      const customerId = numericId(adminCustomerProfileMatch[1]);
      if (!customerId) return json({ ok: false, error: "A valid customer id is required" }, 400);
      return await handleAdminCustomers(request, env, customerId);
    }
    if (path === "admin/partners" && ["GET", "POST"].includes(request.method)) {
      return await handleAdminPartners(request, env, origin);
    }
    const partnerUpdate = path.match(/^admin\/partners\/(\d+)$/);
    if (partnerUpdate && request.method === "PATCH") {
      const partnerId = numericId(partnerUpdate[1]);
      if (!partnerId) return json({ ok: false, error: "A valid partner organization id is required" }, 400);
      return await updateAdminPartner(request, env, partnerId);
    }
    if (path === "admin/partner-invites" && request.method === "GET") {
      return await handleAdminPartnerInvites(request, env, origin);
    }
    const partnerMemberUpdate = path.match(/^admin\/partners\/(\d+)\/members\/(\d+)$/);
    if (partnerMemberUpdate && request.method === "PATCH") {
      const partnerId = numericId(partnerMemberUpdate[1]);
      const membershipId = numericId(partnerMemberUpdate[2]);
      if (!partnerId || !membershipId) return json({ ok: false, error: "Valid partner and member ids are required" }, 400);
      return await updateAdminPartnerMember(request, env, partnerId, membershipId);
    }
    const partnerMemberMatch = path.match(/^admin\/partners\/(\d+)\/members$/);
    if (partnerMemberMatch && request.method === "POST") {
      const partnerId = numericId(partnerMemberMatch[1]);
      if (!partnerId) return json({ ok: false, error: "A valid partner organization id is required" }, 400);
      return await createAdminPartnerContact(request, env, origin, await requireSuperAdmin(request, env), partnerId);
    }
    const partnerCustomerRevoke = path.match(/^admin\/partners\/(\d+)\/customers\/(\d+)\/revoke$/);
    if (partnerCustomerRevoke && request.method === "POST") {
      const partnerId = numericId(partnerCustomerRevoke[1]);
      const customerId = numericId(partnerCustomerRevoke[2]);
      if (!partnerId || !customerId) return json({ ok: false, error: "Valid organization ids are required" }, 400);
      return await handleAdminPartnerCustomerLink(request, env, partnerId, customerId, true);
    }
    const partnerCustomerLink = path.match(/^admin\/partners\/(\d+)\/customers$/);
    if (partnerCustomerLink && request.method === "POST") {
      const partnerId = numericId(partnerCustomerLink[1]);
      if (!partnerId) return json({ ok: false, error: "A valid partner organization id is required" }, 400);
      return await handleAdminPartnerCustomerLink(request, env, partnerId);
    }
    const partnerInviteRevocation = path.match(/^admin\/partner-invites\/(\d+)\/revoke$/);
    if (partnerInviteRevocation && request.method === "POST") {
      const inviteId = numericId(partnerInviteRevocation[1]);
      if (!inviteId) return json({ ok: false, error: "A valid invitation id is required" }, 400);
      return await handleAdminPartnerInvites(request, env, origin, inviteId);
    }
    const inviteRevocation = path.match(/^admin\/customer-invites\/(\d+)\/revoke$/);
    if (inviteRevocation && request.method === "POST") {
      const inviteId = numericId(inviteRevocation[1]);
      if (!inviteId) return json({ ok: false, error: "A valid invitation id is required" }, 400);
      return await handleAdminCustomerInviteRevocation(request, env, inviteId);
    }
    if (path === "profile" && ["GET", "PUT"].includes(request.method)) return await handleProfile(request, env);
    if (path === "organization" && request.method === "GET") return await handleOrganization(request, env);
    if (path === "tickets" && ["GET", "POST"].includes(request.method)) return await handleTickets(request, env);
    if (path.startsWith("tickets/") && ["GET", "POST"].includes(request.method)) {
      const segments = path.split("/");
      const ticketId = numericId(segments[1]);
      if (!ticketId) return json({ ok: false, error: "A valid ticket id is required" }, 400);
      return await handleTicketResource(request, env, ticketId, segments[2] || null);
    }
    if (path === "requirements" && ["GET", "POST"].includes(request.method)) return await handleRequirements(request, env);
    if (path.startsWith("requirements/") && ["GET", "POST"].includes(request.method)) {
      const segments = path.split("/");
      const requirementId = numericId(segments[1]);
      if (!requirementId) return json({ ok: false, error: "A valid requirement id is required" }, 400);
      return await handleRequirementResource(request, env, requirementId, segments[2] || null);
    }
    if (path === "releases" && request.method === "GET") return await handleReleases(request, env);
    if (path.startsWith("releases/") && request.method === "GET") {
      const releaseId = numericId(path.split("/")[1]);
      if (!releaseId) return json({ ok: false, error: "A valid release id is required" }, 400);
      return await handleReleases(request, env, releaseId);
    }
    if (path === "announcements" && request.method === "GET") return await handleCustomerAnnouncements(request, env);
    if (path === "admin/announcements" && ["GET", "POST"].includes(request.method)) {
      return await handleAdminAnnouncements(request, env);
    }
    if (path.startsWith("admin/announcements/") && request.method === "PATCH") {
      const announcementId = numericId(path.split("/")[2]);
      if (!announcementId) return json({ ok: false, error: "A valid announcement id is required" }, 400);
      return await handleAdminAnnouncements(request, env, announcementId);
    }
    if (path === "admin/releases" && ["GET", "POST"].includes(request.method)) {
      return await handleAdminReleases(request, env);
    }
    if (path.startsWith("admin/releases/") && ["GET", "PATCH"].includes(request.method)) {
      const releaseId = numericId(path.split("/")[2]);
      if (!releaseId) return json({ ok: false, error: "A valid release id is required" }, 400);
      return await handleAdminReleases(request, env, releaseId);
    }
    const partnerCodeReveal = path.match(/^partner\/codes\/([0-9a-f-]{36})\/(\d{9})\/reveal$/i);
    if (partnerCodeReveal && request.method === "POST") {
      const partnerSession = await getPartnerSession(request, env);
      if (!partnerSession) {
        return json({ ok: false, error: "Partner access required" }, 403, null, {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
        });
      }
      return await revealLicenseCode(
        request, env, partnerCodeReveal[1], partnerCodeReveal[2], partnerSession,
      );
    }
    if (path === "partner/deals") {
      return await handlePartnerDeals(request, env);
    }
    const partnerDealResponseMatch = path.match(/^partner\/deals\/(\d+)$/);
    if (partnerDealResponseMatch && request.method === "PATCH") {
      const dealId = numericId(partnerDealResponseMatch[1]);
      if (!dealId) return json({ ok: false, error: "A valid deal registration id is required" }, 400);
      return await handlePartnerDealResponse(request, env, dealId);
    }
    if (path === "partner/customers" && request.method === "POST") {
      return await handlePartner(request, env, "customers");
    }
    const partnerCustomerContactMatch = path.match(/^partner\/customers\/(\d+)\/contact$/);
    if (partnerCustomerContactMatch && request.method === "PATCH") {
      const customerId = numericId(partnerCustomerContactMatch[1]);
      if (!customerId) return json({ ok: false, error: "A valid customer id is required" }, 400);
      return await updatePartnerCustomerContact(request, env, customerId);
    }
    if (path.startsWith("partner/") && path.split("/").length === 2 && request.method === "GET") {
      return await handlePartner(request, env, path.split("/")[1]);
    }
    if (path === "commercial/summary" && request.method === "GET") return await handleCommercial(request, env, "summary");
    if (path === "commercial/orders" && request.method === "GET") return await handleCommercial(request, env, "orders");
    if (path.startsWith("commercial/orders/") && request.method === "GET") {
      const orderId = numericId(path.split("/")[2]);
      if (!orderId) return json({ ok: false, error: "A valid order id is required" }, 400);
      return await handleCommercial(request, env, "orders", orderId);
    }
    if (path === "products" && ["GET", "POST"].includes(request.method)) return await handleProducts(request, env);
    const editionPolicyMatch = path.match(/^products\/(\d+)\/editions\/(\d+)\/evaluation-policy$/);
    if (editionPolicyMatch && ["GET", "PUT"].includes(request.method)) {
      return await handleEditionLicensePolicy(request, env, editionPolicyMatch[1], editionPolicyMatch[2]);
    }
    if (path.startsWith("products/") && path.endsWith("/editions") && ["GET", "POST"].includes(request.method)) {
      return await handleEditions(request, env, path.split("/")[1]);
    }
    if (path.startsWith("products/") && request.method === "GET") {
      const productId = numericId(path.split("/")[1]);
      if (!productId) return json({ ok: false, error: "A valid product id is required" }, 400);
      return await handleProducts(request, env, productId);
    }
    if (path === "licenses" && ["GET", "POST"].includes(request.method)) return await handleLicenses(request, env, []);
    if (path.startsWith("licenses/") && ["GET", "POST", "PATCH"].includes(request.method)) {
      return await handleLicenses(request, env, path.split("/").slice(1));
    }
    if (path === "accounting/accounts" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "accounts");
    if (path === "accounting/contacts" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "contacts");
    if (path === "accounting/invoices" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "invoices");
    if (path === "accounting/purchases" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "purchases");
    if (path === "accounting/receipts" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "receipts");
    if (path === "accounting/payments" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "payments");
    if (path === "accounting/notes" && ["GET", "POST"].includes(request.method)) return await handleAccounting(request, env, "notes");
    if (path === "accounting/ledger" && request.method === "GET") return await handleAccounting(request, env, "ledger");
    if (path === "demos" && request.method === "GET") return await handleListDemos(request, env);
    if (path === "admin/support-tickets" && request.method === "GET") {
      return await handleAdminSupportTickets(request, env);
    }
    if (path === "admin/partner-deals") {
      return await handleAdminPartnerDeals(request, env);
    }
    const adminPartnerDealMatch = path.match(/^admin\/partner-deals\/(\d+)$/);
    if (adminPartnerDealMatch) {
      const dealId = numericId(adminPartnerDealMatch[1]);
      if (!dealId) return json({ ok: false, error: "A valid deal registration id is required" }, 400);
      return await handleAdminPartnerDeals(request, env, dealId);
    }
    if (path === "admin/follow-ups") {
      return await handleAdminFollowUps(request, env);
    }
    if (path === "admin/follow-up-tasks") {
      return await handleAdminFollowUpTasks(request, env);
    }
    const adminFollowUpTaskMatch = path.match(/^admin\/follow-up-tasks\/(\d+)$/);
    if (adminFollowUpTaskMatch) {
      const taskId = numericId(adminFollowUpTaskMatch[1]);
      if (!taskId) return json({ ok: false, error: "A valid follow-up task id is required" }, 400);
      return await handleAdminFollowUpTasks(request, env, taskId);
    }
    const adminSupportTicketMatch = path.match(/^admin\/support-tickets\/([^/]+)(?:\/(messages|status))?$/);
    if (adminSupportTicketMatch && ["GET", "POST", "PATCH"].includes(request.method)) {
      const ticketId = numericId(adminSupportTicketMatch[1]);
      if (!ticketId) return json({ ok: false, error: "A valid ticket id is required" }, 400);
      return await handleAdminSupportTickets(request, env, ticketId, adminSupportTicketMatch[2] || null);
    }
    if (path === "admin/overview" && request.method === "GET") return await handleAdminControl(request, env, "overview");
    if (path === "admin/d1-operations" && request.method === "GET") {
      return await handleAdminControl(request, env, "d1-operations");
    }
    if (path === "admin/license-registrations" && request.method === "GET") {
      return await handleAdminControl(request, env, "license-registrations");
    }
    const registrationMatch = path.match(/^admin\/license-registrations\/(\d+)$/);
    if (registrationMatch && request.method === "GET") {
      return await handleAdminControl(request, env, `license-registration:${registrationMatch[1]}`);
    }
    if (path === "admin/organizations" && request.method === "GET") return await handleAdminControl(request, env, "organizations");
    const adminOrganizationMatch = path.match(/^admin\/organizations\/(\d+)$/);
    if (adminOrganizationMatch && request.method === "GET") {
      return await handleAdminControl(request, env, `organization:${adminOrganizationMatch[1]}`);
    }
    if (path === "admin/audit" && request.method === "GET") return await handleAdminControl(request, env, "audit");
    if (path === "admin/users" && request.method === "GET") return await handleAdminUsers(request, env);
    if (path.startsWith("admin/users/") && request.method === "PATCH") {
      request.params = { id: path.split("/")[2] };
      return await handleAdminUsers(request, env);
    }
    return json({ ok: false, error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "Server error" }, 500);
  }
}

export { LICENSE_TRANSITIONS, licenseValidity };
