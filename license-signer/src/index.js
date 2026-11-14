// /**
//  * @file        index.js
//  * @project     PrathamOne EduOS Coaching Institute Management System
//  * @module      SMRITISYS license signer
//  *
//  * @author      Jawahar R. Mallah
//  * @organization AITDL (AI Technology & Development Lab)
//  * @client      Prashant Academy Coaching Institute
//  * @copyright   Copyright (c) 2026 AITDL
//  * @license     Proprietary
//  *
//  * @version     1.0.0
//  * @created     2026-11-14
//  * @updated     2026-11-14
//  *
//  * @description Isolated Ed25519 signing service for SMRITISYS license artifacts.
//  */

const MAX_BODY_BYTES = 64 * 1024;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function decodeBase64Url(value) {
  if (
    typeof value !== "string" ||
    !BASE64URL_PATTERN.test(value) ||
    value.length % 4 === 1
  ) {
    return null;
  }
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function encodeBase64Url(value) {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function readBoundedBody(request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return null;
  }
  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/v1/sign") return json({ error: "Not found" }, 404);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const bodyBytes = await readBoundedBody(request);
    if (!bodyBytes) return json({ error: "A bounded JSON signing request is required" }, 400);

    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch {
      return json({ error: "The signing request is invalid" }, 400);
    }

    const keyId = env.LICENSE_KEY_ID;
    const payload = decodeBase64Url(body?.payload);
    const privateKeyBytes = decodeBase64Url(env.LICENSE_SIGNING_PRIVATE_KEY_PKCS8);
    if (
      body?.algorithm !== "Ed25519" ||
      typeof keyId !== "string" ||
      !KEY_ID_PATTERN.test(keyId) ||
      body?.key_id !== keyId ||
      !payload ||
      payload.length === 0 ||
      payload.length > MAX_BODY_BYTES ||
      !privateKeyBytes
    ) {
      return json({ error: "The signing request is invalid" }, 400);
    }

    try {
      const privateKey = await crypto.subtle.importKey(
        "pkcs8",
        privateKeyBytes,
        { name: "Ed25519" },
        false,
        ["sign"],
      );
      const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, payload);
      return json({ key_id: keyId, signature: encodeBase64Url(signature) }, 200);
    } catch (error) {
      console.error("License signing failed", { name: error?.name || "Error" });
      return json({ error: "License signing is unavailable" }, 503);
    }
  },
};
