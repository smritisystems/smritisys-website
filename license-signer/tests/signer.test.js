// /**
//  * @file        signer.test.js
//  * @project     PrathamOne EduOS Coaching Institute Management System
//  * @module      SMRITISYS license signer tests
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
//  * @description Verifies signer request validation and Ed25519 signatures.
//  */

import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import signer from "../src/index.js";

const encodeBase64Url = (value) => Buffer.from(value).toString("base64url");
const keyId = "test-ed25519-key";

async function makeSigningEnv() {
  const pair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const privateKey = await webcrypto.subtle.exportKey("pkcs8", pair.privateKey);
  return {
    env: {
      LICENSE_KEY_ID: keyId,
      LICENSE_SIGNING_PRIVATE_KEY_PKCS8: encodeBase64Url(privateKey),
    },
    publicKey: pair.publicKey,
  };
}

function signRequest(body) {
  return new Request("https://license-signer.internal/v1/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("signer signs only the configured key ID and returns a verifiable Ed25519 signature", async () => {
  const { env, publicKey } = await makeSigningEnv();
  const payload = new TextEncoder().encode('{"license_id":"42"}');
  const response = await signer.fetch(signRequest({
    algorithm: "Ed25519",
    key_id: keyId,
    payload: encodeBase64Url(payload),
  }), env);

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.key_id, keyId);
  assert.equal(await webcrypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    Buffer.from(result.signature, "base64url"),
    payload,
  ), true);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("signer rejects wrong routes, methods, algorithms, and key IDs", async () => {
  const { env } = await makeSigningEnv();
  const wrongPath = await signer.fetch(new Request("https://license-signer.internal/"), env);
  const wrongMethod = await signer.fetch(new Request("https://license-signer.internal/v1/sign"), env);
  const wrongKey = await signer.fetch(signRequest({
    algorithm: "Ed25519",
    key_id: "attacker-key",
    payload: encodeBase64Url(new TextEncoder().encode("payload")),
  }), env);
  const wrongAlgorithm = await signer.fetch(signRequest({
    algorithm: "HS256",
    key_id: keyId,
    payload: encodeBase64Url(new TextEncoder().encode("payload")),
  }), env);

  assert.equal(wrongPath.status, 404);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongKey.status, 400);
  assert.equal(wrongAlgorithm.status, 400);
});
