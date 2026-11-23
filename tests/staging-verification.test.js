/**
 * @file        staging-verification.test.js
 * @project     PrathamOne EduOS Coaching Institute Management System
 * @module      SMRITISYS integration tests
 *
 * @author      Jawahar R. Mallah
 * @organization AITDL (AI Technology & Development Lab)
 * @client      Prashant Academy Coaching Institute
 * @copyright   Copyright (c) 2026 AITDL
 * @license     Proprietary
 *
 * @version     1.0.0
 * @created     2026-11-14
 * @updated     2026-11-15
 *
 * @description Exercises authenticated control-plane and customer portal workflows.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { hashCustomerInviteToken, onRequest } from "../functions/api/[[path]].js";
import d1Operations, { sampleD1Database } from "../d1-ops/src/index.js";

const TEST_LICENSE_CODE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

// Initialize in-memory SQLite with D1-like interface
function createD1Mock() {
  const db = new DatabaseSync(":memory:");
  
  // Apply schemas and migrations
  const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  const m2 = fs.readFileSync(new URL("../migrations/0002_identity_rbac.sql", import.meta.url), "utf8");
  const m3 = fs.readFileSync(new URL("../migrations/0003_license_control_plane.sql", import.meta.url), "utf8");
  const m4 = fs.readFileSync(new URL("../migrations/0004_customer_license_requests.sql", import.meta.url), "utf8");
  const m5 = fs.readFileSync(new URL("./fixtures/migrations/0005_staging_verification_seed.sql", import.meta.url), "utf8");
  const m6 = fs.readFileSync(new URL("../migrations/0006_custom_requirements.sql", import.meta.url), "utf8");
  const m7 = fs.readFileSync(new URL("../migrations/0007_release_center.sql", import.meta.url), "utf8");
  const m8 = fs.readFileSync(new URL("../migrations/0008_partner_relationships.sql", import.meta.url), "utf8");
  const m9 = fs.readFileSync(new URL("./fixtures/migrations/0009_partner_staging_seed.sql", import.meta.url), "utf8");
  const m10 = fs.readFileSync(new URL("../migrations/0010_commercial_relationship.sql", import.meta.url), "utf8");
  const m11 = fs.readFileSync(new URL("./fixtures/migrations/0011_admin_staging_seed.sql", import.meta.url), "utf8");
  const m14 = fs.readFileSync(new URL("../migrations/0014_signed_license_artifacts.sql", import.meta.url), "utf8");
  const m15 = fs.readFileSync(new URL("../migrations/0015_prathamone_product_registration.sql", import.meta.url), "utf8");
  const m28 = fs.readFileSync(new URL("../migrations/0028_customer_profile_management.sql", import.meta.url), "utf8");
  const m30 = fs.readFileSync(new URL("../migrations/0030_partner_workflow_foundations.sql", import.meta.url), "utf8");
  const m31 = fs.readFileSync(new URL("../migrations/0031_identity_organization_scope.sql", import.meta.url), "utf8");
  const m32 = fs.readFileSync(new URL("../migrations/0032_license_reactivation_requests.sql", import.meta.url), "utf8");

  db.exec(schema);
  db.exec(m2);
  db.exec(m3);
  db.exec(m4);
  db.exec(m5);
  db.exec(m6);
  db.exec(m7);
  db.exec(m8);
  db.exec(m9);
  db.exec(m10);
  db.exec(m11);
  db.exec(m14);
  db.exec(m15);
  db.exec(m28);
  db.exec(m30);
  db.exec(m31.slice(m31.indexOf("UPDATE licenses")));
  db.exec(m32);

  return {
    raw: db,
    prepare(query) {
      let boundValues = [];
      return {
        bind(...values) {
          boundValues = values;
          return this;
        },
        first() {
          try {
            const stmt = db.prepare(query);
            return stmt.get(...boundValues) || null;
          } catch (e) {
            return null;
          }
        },
        all() {
          try {
            const stmt = db.prepare(query);
            return { results: stmt.all(...boundValues) };
          } catch (e) {
            return { results: [] };
          }
        },
        run() {
          const stmt = db.prepare(query);
          const info = stmt.run(...boundValues);
          return {
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: Number(info.lastInsertRowid),
            },
          };
        },
      };
    },
    async batch(statements) {
      return statements.map((s) => s.run());
    },
  };
}

async function callApi(env, path, options = {}) {
  const url = new URL(`https://smritisys.test/api/${path}`);
  const headers = new Headers(options.headers || {});
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  if (options.body && typeof options.body === "object") {
    headers.set("Content-Type", "application/json");
  }

  const req = new Request(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const res = await onRequest({
    request: req,
    env: {
      DB: env,
      LICENSE_CODE_ENCRYPTION_KEY: TEST_LICENSE_CODE_ENCRYPTION_KEY,
      ...(options.bindings || {}),
    },
    params: { path: path.split("/").filter(Boolean) },
  });

  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json() : await res.text();
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

async function selectSessionOrganization(env, token, organizationId = null) {
  const context = await callApi(env, "organization-context", { token });
  assert.equal(context.status, 200);
  const selectedId = organizationId ?? context.data.organizations[0]?.organization_id;
  assert.ok(selectedId);
  return callApi(env, "organization-context", {
    method: "POST",
    token,
    body: { organization_id: selectedId },
  });
}

async function createLicenseSignerBindings(keyId) {
  const signerPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", signerPair.publicKey)).toString("base64url");
  const refreshPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const refreshPublicKey = Buffer.from(await crypto.subtle.exportKey("raw", refreshPair.publicKey)).toString("base64url");
  return {
    refreshPublicKey,
    bindings: {
      LICENSE_SIGNER: {
        async fetch(request) {
          const body = await request.json();
          const signature = await crypto.subtle.sign(
            { name: "Ed25519" },
            signerPair.privateKey,
            Buffer.from(body.payload, "base64url"),
          );
          return Response.json({ key_id: body.key_id, signature: Buffer.from(signature).toString("base64url") });
        },
      },
      LICENSE_ACTIVE_KEY_ID: keyId,
      LICENSE_SIGNING_PUBLIC_KEYS: JSON.stringify({ [keyId]: publicKey }),
    },
  };
}

test("admin release drafts follow an audited manual publication lifecycle", async () => {
  const d1 = createD1Mock();
  const adminToken = "release-lifecycle-admin";
  const customerToken = "release-lifecycle-customer";
  const partnerToken = "release-lifecycle-partner";
  d1.raw.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+1 hour'))",
  ).run(adminToken);
  d1.raw.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 101, 101, datetime('now', '+1 hour'))",
  ).run(customerToken);
  d1.raw.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 103, 103, datetime('now', '+1 hour'))",
  ).run(partnerToken);
  const productId = d1.raw.prepare("SELECT id FROM products WHERE slug = 'prathamone-eduos'").get().id;
  const asset = {
    name: "PrathamOne package",
    platform: "Windows",
    download_url: "https://downloads.example.test/prathamone/2026.11.0",
    checksum: "a".repeat(64),
  };
  const draftBody = {
    product_id: productId,
    version: "2026.11.0",
    title: "PrathamOne EduOS November 2026",
    summary: "Draft pending product validation.",
    release_notes: "Release notes for the verified package.",
    assets: [asset],
  };

  const denied = await callApi(d1, "admin/releases", { method: "POST", token: customerToken, body: draftBody });
  assert.equal(denied.status, 403);
  const insecureAsset = await callApi(d1, "admin/releases", {
    method: "POST",
    token: adminToken,
    body: { ...draftBody, assets: [{ ...asset, download_url: "http://downloads.example.test/package" }] },
  });
  assert.equal(insecureAsset.status, 400);
  const incomplete = await callApi(d1, "admin/releases", {
    method: "POST",
    token: adminToken,
    body: { product_id: productId, version: "2026.11.1", title: "Pending product package" },
  });
  assert.equal(incomplete.status, 201);
  assert.equal(
    (await callApi(d1, `admin/releases/${incomplete.data.release.id}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "review" },
    })).status,
    409,
  );

  const created = await callApi(d1, "admin/releases", { method: "POST", token: adminToken, body: draftBody });
  assert.equal(created.status, 201);
  assert.equal(created.data.release.status, "draft");
  assert.equal(created.data.release.published_at, null);
  const releaseId = created.data.release.id;
  assert.equal(
    (await callApi(d1, `admin/releases/${releaseId}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "published" },
    })).status,
    409,
  );
  assert.equal(
    (await callApi(d1, `admin/releases/${releaseId}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "review" },
    })).data.release.status,
    "review",
  );
  assert.equal(
    (await callApi(d1, `admin/releases/${releaseId}`, {
      method: "PATCH",
      token: adminToken,
      body: { title: "Edit during review" },
    })).status,
    409,
  );
  const published = await callApi(d1, `admin/releases/${releaseId}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "published" },
  });
  assert.equal(published.status, 200);
  assert.ok(published.data.release.published_at);
  d1.raw.prepare(
    `INSERT INTO licenses (customer_id, organization_id, product_id, license_key, starts_at, expires_at, status)
     VALUES (101, 101, ?, 'TEST-PRATHAMONE-RELEASE', date('now', '-1 day'), date('now', '+1 day'), 'ACTIVE')`,
  ).run(productId);
  for (const [path, token] of [["releases", customerToken], ["partner/releases", partnerToken]]) {
    const visible = await callApi(d1, path, { token });
    assert.ok(visible.data.releases.some((release) => release.version === "2026.11.0"));
  }
  const withdrawn = await callApi(d1, `admin/releases/${releaseId}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "withdrawn" },
  });
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.data.release.status, "withdrawn");
  assert.equal(withdrawn.data.release.published_at, published.data.release.published_at);
  for (const [path, token] of [["releases", customerToken], ["partner/releases", partnerToken]]) {
    const hidden = await callApi(d1, path, { token });
    assert.ok(!hidden.data.releases.some((release) => release.version === "2026.11.0"));
  }
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE resource_type = 'release'").get().count, 5);
});

test("customer and partner release visibility requires active, in-date licenses", async () => {
  const d1 = createD1Mock();
  const customerToken = "release-validity-customer";
  const partnerToken = "release-validity-partner";
  d1.raw.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 101, 101, datetime('now', '+1 hour'))",
  ).run(customerToken);
  d1.raw.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 103, 103, datetime('now', '+1 hour'))",
  ).run(partnerToken);

  for (const [path, token] of [["releases", customerToken], ["partner/releases", partnerToken]]) {
    const active = await callApi(d1, path, { token });
    assert.equal(active.status, 200);
    assert.equal(active.data.releases.length, 1);
  }

  d1.raw.prepare("UPDATE licenses SET status = 'SUSPENDED' WHERE id = 101").run();
  for (const [path, token] of [["releases", customerToken], ["partner/releases", partnerToken]]) {
    assert.equal((await callApi(d1, path, { token })).data.releases.length, 0);
  }

  d1.raw.prepare(
    "UPDATE licenses SET status = 'ACTIVE', starts_at = date('now', '+1 day'), expires_at = date('now', '+2 days') WHERE id = 101",
  ).run();
  for (const [path, token] of [["releases", customerToken], ["partner/releases", partnerToken]]) {
    assert.equal((await callApi(d1, path, { token })).data.releases.length, 0);
  }

  d1.raw.prepare(
    "UPDATE licenses SET starts_at = date('now', '-2 days'), expires_at = date('now', '-1 day') WHERE id = 101",
  ).run();
  for (const [path, token] of [["releases", customerToken], ["partner/releases", partnerToken]]) {
    assert.equal((await callApi(d1, path, { token })).data.releases.length, 0);
  }
});

test("cookie-authenticated mutations reject untrusted origins without blocking bearer clients", async () => {
  const d1 = createD1Mock();
  const cookie = "smritisys_session=csrf-test-session";
  const untrusted = await callApi(d1, "logout", {
    method: "POST",
    headers: { Cookie: cookie, Origin: "https://attacker.example" },
  });
  assert.equal(untrusted.status, 403);

  const missingOrigin = await callApi(d1, "logout", {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(missingOrigin.status, 403);

  const sameOrigin = await callApi(d1, "logout", {
    method: "POST",
    headers: { Cookie: cookie, Origin: "https://smritisys.test" },
  });
  assert.equal(sameOrigin.status, 200);

  const allowlistedOrigin = await callApi(d1, "logout", {
    method: "POST",
    headers: { Cookie: cookie, Origin: "https://portal.example" },
    bindings: { ALLOWED_ORIGINS: "https://portal.example" },
  });
  assert.equal(allowlistedOrigin.status, 200);

  const bearer = await callApi(d1, "logout", {
    method: "POST",
    headers: { Authorization: "Bearer csrf-test-token", Origin: "https://attacker.example" },
  });
  assert.equal(bearer.status, 200);
});

test("customer records are isolated by the explicitly selected organization", async () => {
  const d1 = createD1Mock();
  d1.raw.prepare(
    `INSERT INTO organization_members (organization_id, account_type, account_id, member_role, status)
     VALUES (102, 'customer', 101, 'customer', 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO support_tickets (id, customer_id, organization_id, subject, description)
     VALUES (201, 101, 102, 'Organization B ticket', 'Second organization ticket')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO orders (id, customer_id, organization_id, order_number, total_amount, status)
     VALUES (201, 101, 102, 'ORG-B-ORDER-201', 1, 'confirmed')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO amc_contracts (id, customer_id, organization_id, contract_number, starts_at, expires_at, status)
     VALUES (201, 101, 102, 'ORG-B-AMC-201', '2026-01-01', '2027-01-01', 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO licenses (id, customer_id, organization_id, product_id, license_key, starts_at, status)
     SELECT 201, 101, 102, id, 'ORG-B-LICENSE-201', '2026-01-01', 'ACTIVE'
     FROM products WHERE slug = 'smriti-retail-os'`,
  ).run();

  const firstToken = "customer-org-scope-first";
  const secondToken = "customer-org-scope-second";
  d1.raw.prepare(
    `INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at)
     VALUES (?, 'customer', 101, 101, datetime('now', '+1 hour'))`,
  ).run(firstToken);
  d1.raw.prepare(
    `INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at)
     VALUES (?, 'customer', 101, 102, datetime('now', '+1 hour'))`,
  ).run(secondToken);

  for (const [token, expectedId] of [[firstToken, 101], [secondToken, 201]]) {
    const tickets = await callApi(d1, "tickets", { token });
    assert.equal(tickets.status, 200);
    assert.deepEqual(tickets.data.tickets.map((ticket) => ticket.id), [expectedId]);

    const commercial = await callApi(d1, "commercial/summary", { token });
    assert.equal(commercial.status, 200);
    assert.deepEqual(commercial.data.summary.orders.map((order) => order.id), [expectedId]);
    assert.deepEqual(commercial.data.summary.amc_contracts.map((contract) => contract.id), [expectedId]);

    const licenses = await callApi(d1, "licenses", { token });
    assert.equal(licenses.status, 200);
    assert.deepEqual(licenses.data.licenses.map((license) => license.id), [expectedId]);
  }

  assert.equal((await callApi(d1, "tickets/201", { token: firstToken })).status, 404);
  assert.equal((await callApi(d1, "commercial/orders/201", { token: firstToken })).status, 404);
  const adminToken = "customer-org-scope-admin";
  d1.raw.prepare(
    `INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at)
     VALUES (?, 'user', 201, 201, datetime('now', '+1 hour'))`,
  ).run(adminToken);
  const organizationDetail = await callApi(d1, "admin/organizations/101", { token: adminToken });
  assert.equal(organizationDetail.status, 200);
  assert.deepEqual(organizationDetail.data.licenses.map((license) => license.id), [101]);
});

test("partner data is limited to assigned customers and canonical membership roles", async () => {
  const d1 = createD1Mock();
  d1.raw.prepare(
    `INSERT INTO customers (id, email, password_hash, name, company, status)
     VALUES (104, 'partner.b@example.com', 'test-hash', 'Partner B', 'Partner B Ltd', 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO people (id, email, name, source_type, source_id, status)
     VALUES (104, 'partner.b@example.com', 'Partner B', 'customer', 104, 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO organizations (id, name, legal_name, status)
     VALUES (104, 'Partner B', 'Partner B Ltd', 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO relationships (organization_id, relationship_type, status)
     VALUES (104, 'distributor', 'active'), (104, 'reseller', 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO organization_members (organization_id, account_type, account_id, member_role, status)
     VALUES (104, 'customer', 104, 'partner_admin', 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO partner_memberships (partner_organization_id, account_type, account_id, partner_role, partner_type, status)
     VALUES (104, 'customer', 104, 'partner_admin', 'reseller', 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO partner_customer_links (partner_organization_id, customer_organization_id, status)
     VALUES (104, 102, 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO licenses (id, customer_id, organization_id, product_id, license_key, starts_at, status)
     SELECT 202, 102, 102, id, 'ORG-B-LICENSE-202', '2026-01-01', 'ACTIVE'
     FROM products WHERE slug = 'smriti-retail-os'`,
  ).run();
  d1.raw.prepare(
    `UPDATE organization_members SET member_role = 'partner_member'
     WHERE organization_id = 103 AND account_type = 'customer' AND account_id = 103`,
  ).run();
  d1.raw.prepare(
    `INSERT OR IGNORE INTO permissions (name, description)
     VALUES ('partner.inventory.reveal', 'Reveal allocated activation keys')`,
  ).run();
  d1.raw.prepare(
    `INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
     SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
     WHERE r.name = 'partner_admin' AND p.name = 'partner.inventory.reveal'`,
  ).run();

  const partnerAToken = "partner-a-canonical-role";
  const partnerBToken = "partner-b-isolation";
  d1.raw.prepare(
    `INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at)
     VALUES (?, 'customer', 103, 103, datetime('now', '+1 hour'))`,
  ).run(partnerAToken);
  d1.raw.prepare(
    `INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at)
     VALUES (?, 'customer', 104, 104, datetime('now', '+1 hour'))`,
  ).run(partnerBToken);

  const partnerA = await callApi(d1, "partner/customers", { token: partnerAToken });
  const partnerB = await callApi(d1, "partner/customers", { token: partnerBToken });
  assert.equal(partnerA.status, 200);
  assert.equal(partnerB.status, 200);
  assert.deepEqual(partnerA.data.customers.map((organization) => organization.id), [101]);
  assert.deepEqual(partnerB.data.customers.map((organization) => organization.id), [102]);

  const partnerALicenses = await callApi(d1, "partner/licenses", { token: partnerAToken });
  const partnerBLicenses = await callApi(d1, "partner/licenses", { token: partnerBToken });
  assert.equal(partnerALicenses.status, 200);
  assert.equal(partnerBLicenses.status, 200);
  assert.deepEqual(partnerALicenses.data.licenses.map((license) => license.id), [101]);
  assert.deepEqual(partnerBLicenses.data.licenses.map((license) => license.id), [202]);

  const partnerProfile = await callApi(d1, "partner/me", { token: partnerAToken });
  assert.equal(partnerProfile.status, 200);
  assert.equal(partnerProfile.data.partner.partner_role, "partner_member");
  assert.equal(partnerProfile.data.partner.partner_type, "reseller");
  assert.equal(partnerProfile.data.permissions.reveal_activation_keys, false);
  assert.equal((await callApi(d1, "admin/overview", { token: partnerAToken })).status, 403);
});

test("admin partner onboarding synchronizes the canonical membership role", async () => {
  const d1 = createD1Mock();
  const adminToken = "partner-role-onboarding-admin";
  d1.raw.prepare(
    `INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at)
     VALUES (?, 'user', 201, 201, datetime('now', '+1 hour'))`,
  ).run(adminToken);
  d1.raw.prepare(
    `UPDATE organization_members SET member_role = 'customer'
     WHERE organization_id = 103 AND account_type = 'customer' AND account_id = 103`,
  ).run();

  const response = await callApi(d1, "admin/partners/103/members", {
    method: "POST",
    token: adminToken,
    body: {
      partner_type: "reseller",
      partner_role: "partner_admin",
      email: "partner@example.com",
      phone: "+1 555 0103",
      name: "Partner Admin",
    },
  });
  assert.equal(response.status, 200);
  assert.equal(d1.raw.prepare(
    `SELECT member_role FROM organization_members
     WHERE organization_id = 103 AND account_type = 'customer' AND account_id = 103`,
  ).get().member_role, "partner_admin");
  assert.equal(d1.raw.prepare(
    `SELECT partner_role FROM partner_memberships
     WHERE partner_organization_id = 103 AND account_type = 'customer' AND account_id = 103`,
  ).get().partner_role, "partner_admin");
});

test("account deactivation invalidates an otherwise active customer session", async () => {
  const d1 = createD1Mock();
  const token = "deactivated-customer-session";
  d1.raw.prepare(
    `INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at)
     VALUES (?, 'customer', 101, 101, datetime('now', '+1 hour'))`,
  ).run(token);
  d1.raw.prepare("UPDATE customers SET status = 'inactive' WHERE id = 101").run();

  assert.equal((await callApi(d1, "me", { token })).status, 401);
});

test("signed license operations reject ambiguous activation identifiers", async () => {
  const d1 = createD1Mock();
  const productId = d1.raw.prepare("SELECT product_id FROM licenses WHERE id = 101").get().product_id;
  const installationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const activationIdentifier = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  d1.raw.prepare(
    `INSERT INTO licenses
     (id, customer_id, organization_id, product_id, license_key, starts_at, status)
     VALUES (202, 101, 101, ?, 'AMBIGUOUS-LICENSE-202', '2026-01-01', 'ACTIVE')`,
  ).run(productId);
  d1.raw.prepare(
    `INSERT INTO license_entitlements (license_id, entitlement_key, value_type, value_text)
     VALUES (202, 'company.binding', 'text', 'COMP-001')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO license_activations
     (license_id, installation_id, activation_identifier, status, refresh_public_key)
     VALUES (101, ?, ?, 'active', 'test-key'), (202, ?, ?, 'active', 'test-key')`,
  ).run(installationId, activationIdentifier, installationId, activationIdentifier);

  const signedRequest = {
    product_code: "smriti-retail-os",
    company_binding: "COMP-001",
    installation_id: installationId,
    activation_identifier: activationIdentifier,
    timestamp: Date.now(),
    nonce: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    signature: Buffer.alloc(64, 1).toString("base64url"),
  };
  const refresh = await callApi(d1, "license/refresh", { method: "POST", body: signedRequest });
  assert.equal(refresh.status, 409);
  assert.match(refresh.data.error, /ambiguous/i);

  const management = await callApi(d1, "license/manage", {
    method: "POST",
    body: { ...signedRequest, action: "deactivate" },
  });
  assert.equal(management.status, 409);
  assert.match(management.data.error, /ambiguous/i);
});

test("activation-code claims require an explicit organization for multi-organization accounts", async () => {
  const d1 = createD1Mock();
  const adminToken = "ambiguous-activation-admin";
  d1.raw.prepare(
    `INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at)
     VALUES (?, 'user', 201, 201, datetime('now', '+1 hour'))`,
  ).run(adminToken);
  const customerEmail = "multi-org-activation@example.com";
  d1.raw.prepare(
    `INSERT INTO customers (id, email, password_hash, name, company, status)
     VALUES (105, ?, 'test-hash', 'Multi Org Customer', 'Ambiguous Academy', 'active')`,
  ).run(customerEmail);
  d1.raw.prepare(
    `INSERT INTO people (id, email, name, source_type, source_id, status)
     VALUES (105, ?, 'Multi Org Customer', 'customer', 105, 'active')`,
  ).run(customerEmail);
  d1.raw.prepare(
    `INSERT INTO organizations (id, name, legal_name, status)
     VALUES (105, 'Ambiguous Academy One', 'Ambiguous Academy', 'active'),
            (106, 'Ambiguous Academy Two', 'Ambiguous Academy', 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO relationships (organization_id, relationship_type, status)
     VALUES (105, 'customer', 'active'), (106, 'customer', 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO organization_members (organization_id, account_type, account_id, member_role, status)
     VALUES (105, 'customer', 105, 'customer', 'active'),
            (106, 'customer', 105, 'customer', 'active')`,
  ).run();

  const product = d1.raw.prepare("SELECT id FROM products WHERE slug = 'prathamone-eduos'").get();
  const edition = d1.raw.prepare(
    "SELECT id FROM product_editions WHERE product_id = ? AND code = 'coaching-institute'",
  ).get(product.id);
  const batch = await callApi(d1, "licenses/batches", {
    method: "POST",
    token: adminToken,
    body: {
      count: 1,
      product_id: product.id,
      edition_id: edition.id,
      license_model: "on_premise_subscription",
      start_date: "2026-11-15",
      expiry_date: "2027-11-15",
    },
  });
  assert.equal(batch.status, 201);

  const signerPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", signerPair.publicKey)).toString("base64url");
  const refreshPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const signer = {
    async fetch(request) {
      const requestBody = await request.json();
      const signature = await crypto.subtle.sign(
        { name: "Ed25519" },
        signerPair.privateKey,
        Buffer.from(requestBody.payload, "base64url"),
      );
      return Response.json({
        key_id: requestBody.key_id,
        signature: Buffer.from(signature).toString("base64url"),
      });
    },
  };
  const bindings = {
    LICENSE_SIGNER: signer,
    LICENSE_ACTIVE_KEY_ID: "ambiguous-activation-test",
    LICENSE_SIGNING_PUBLIC_KEYS: JSON.stringify({ "ambiguous-activation-test": publicKey }),
  };
  const code = batch.data.codes[0];
  const registration = {
    institution_name: "Ambiguous Academy",
    contact_name: "Multi Org Customer",
    contact_email: customerEmail,
    phone: "+91-9876543210",
  };
  const activation = {
    serial_number: code.serial_number,
    activation_key: code.activation_key,
    product_code: "prathamone-eduos",
    company_binding: "MULTI-ORG-105",
    installation_id: "8a36e7ab-20de-4e31-bf83-87bb4dcd7560",
    activation_identifier: "4c765a67-9e03-4e9d-9f38-211366dcf7de",
    refresh_public_key: Buffer.from(await crypto.subtle.exportKey("raw", refreshPair.publicKey)).toString("base64url"),
    registration,
  };

  const ambiguous = await callApi(d1, "license/activate", { method: "POST", body: activation, bindings });
  assert.equal(ambiguous.status, 409);
  assert.deepEqual(ambiguous.data.organization_options.map((organization) => organization.id), [105, 106]);
  assert.equal(d1.raw.prepare(
    "SELECT status FROM license_code_inventory WHERE serial_number = ?",
  ).get(code.serial_number).status, "available");

  const claimed = await callApi(d1, "license/activate", {
    method: "POST",
    body: { ...activation, registration: { ...registration, organization_id: 106 } },
    bindings,
  });
  assert.equal(claimed.status, 201);
  assert.equal(d1.raw.prepare(
    "SELECT organization_id FROM licenses WHERE serial_number = ?",
  ).get(code.serial_number).organization_id, 106);
});

test("license issuance requires an explicit customer when an organization has multiple accounts", async () => {
  const d1 = createD1Mock();
  const adminToken = "license-recipient-admin";
  d1.raw.prepare(
    `INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at)
     VALUES (?, 'user', 201, 201, datetime('now', '+1 hour'))`,
  ).run(adminToken);
  d1.raw.prepare(
    `INSERT INTO customers (id, email, password_hash, name, company, status)
     VALUES (105, 'customer.extra@example.com', 'test-hash', 'Extra Customer', 'Organization A Retail Pvt Ltd', 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO people (id, email, name, source_type, source_id, status)
     VALUES (105, 'customer.extra@example.com', 'Extra Customer', 'customer', 105, 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO organization_members (organization_id, account_type, account_id, member_role, status)
     VALUES (101, 'customer', 105, 'customer', 'active')`,
  ).run();
  const productId = d1.raw.prepare("SELECT product_id FROM licenses WHERE id = 101").get().product_id;
  const editionId = d1.raw.prepare("SELECT edition_id FROM license_editions WHERE license_id = 101").get().edition_id;
  const body = {
    organization_id: 101,
    product_id: productId,
    edition_id: editionId,
    status: "DRAFT",
    entitlements: [{ key: "company.binding", value_type: "text", value: "ORG-A" }],
  };

  const ambiguous = await callApi(d1, "licenses", { method: "POST", token: adminToken, body });
  assert.equal(ambiguous.status, 409);
  assert.match(ambiguous.data.error, /customer account ID is required/i);

  const issued = await callApi(d1, "licenses", {
    method: "POST",
    token: adminToken,
    body: { ...body, customer_id: 101 },
  });
  assert.equal(issued.status, 201);
  assert.equal(issued.data.license.customer_id, 101);
  assert.equal(issued.data.license.organization_id, 101);
});

test("admin role updates change internal roles but preserve external memberships", async () => {
  const d1 = createD1Mock();
  const adminToken = "internal-role-update-admin";
  d1.raw.prepare(
    `INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at)
     VALUES (?, 'user', 201, 201, datetime('now', '+1 hour'))`,
  ).run(adminToken);
  d1.raw.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, status)
     VALUES (202, 'user.role-target@example.com', 'test-hash', 'Role Target', 'staff', 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO people (id, email, name, source_type, source_id, status)
     VALUES (202, 'user.role-target@example.com', 'Role Target', 'user', 202, 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO relationships (organization_id, relationship_type, status)
     VALUES (201, 'internal', 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO organization_members (organization_id, account_type, account_id, member_role, status)
     VALUES (201, 'user', 202, 'staff', 'active'), (101, 'user', 202, 'staff', 'active')`,
  ).run();

  const response = await callApi(d1, "admin/users/202", {
    method: "PATCH",
    token: adminToken,
    body: { role: "admin" },
  });
  assert.equal(response.status, 200);
  assert.equal(d1.raw.prepare(
    "SELECT member_role FROM organization_members WHERE organization_id = 201 AND account_id = 202",
  ).get().member_role, "admin");
  assert.equal(d1.raw.prepare(
    "SELECT member_role FROM organization_members WHERE organization_id = 101 AND account_id = 202",
  ).get().member_role, "staff");
});

test("organization context requires explicit session selection and is isolated per session", async () => {
  const d1 = createD1Mock();
  const firstToken = "organization-context-first-session";
  const secondToken = "organization-context-second-session";
  d1.raw.prepare(
    "INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'customer', 101, datetime('now', '+1 hour'))",
  ).run(firstToken);
  d1.raw.prepare(
    "INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'customer', 101, datetime('now', '+1 hour'))",
  ).run(secondToken);
  d1.raw.prepare(
    `INSERT INTO organization_members (organization_id, account_type, account_id, member_role, status)
     VALUES (102, 'customer', 101, 'customer', 'active')`,
  ).run();

  const anonymous = await callApi(d1, "organization-context");
  assert.equal(anonymous.status, 401);

  const initial = await callApi(d1, "organization-context", { token: firstToken });
  assert.equal(initial.status, 200);
  assert.equal(initial.data.selected_organization_id, null);
  assert.deepEqual(initial.data.organizations.map((item) => item.organization_id), [101, 102]);
  assert.equal((await callApi(d1, "me", { token: firstToken })).status, 401);

  const invalidSelection = await callApi(d1, "organization-context", {
    method: "POST",
    token: firstToken,
    body: { organization_id: 999 },
  });
  assert.equal(invalidSelection.status, 403);

  const selected = await callApi(d1, "organization-context", {
    method: "POST",
    token: firstToken,
    body: { organization_id: 101 },
  });
  assert.equal(selected.status, 200);
  assert.equal(selected.data.selected_organization_id, 101);
  assert.equal((await callApi(d1, "me", { token: firstToken })).status, 200);
  const secondSelected = await callApi(d1, "organization-context", {
    method: "POST",
    token: secondToken,
    body: { organization_id: 102 },
  });
  assert.equal(secondSelected.status, 200);
  assert.equal(secondSelected.data.selected_organization_id, 102);
  assert.equal((await callApi(d1, "organization-context", { token: secondToken })).data.selected_organization_id, 102);
  assert.equal(d1.raw.prepare(
    "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'ORGANIZATION_CONTEXT_SELECTED'",
  ).get().count, 2);
});

test("organization context derives customer and partner workspaces from active membership", async () => {
  const d1 = createD1Mock();
  const token = "organization-workspace-kind-session";
  d1.raw.prepare(
    "INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'customer', 101, datetime('now', '+1 hour'))",
  ).run(token);
  d1.raw.prepare(
    "INSERT INTO organizations (id, name, legal_name, status) VALUES (104, 'Reseller Org', 'Reseller Org Ltd', 'active')",
  ).run();
  d1.raw.prepare(
    `INSERT INTO relationships (organization_id, relationship_type, status)
     VALUES (104, 'distributor', 'active'), (104, 'reseller', 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO organization_members (organization_id, account_type, account_id, member_role, status)
     VALUES (104, 'customer', 101, 'partner_admin', 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO partner_memberships
       (partner_organization_id, account_type, account_id, partner_role, partner_type, status)
     VALUES (104, 'customer', 101, 'partner_admin', 'reseller', 'active')`,
  ).run();
  d1.raw.prepare(
    "INSERT INTO organizations (id, name, legal_name, status) VALUES (105, 'Unassigned Partner Role', 'Unassigned Partner Role Ltd', 'active')",
  ).run();
  d1.raw.prepare(
    "INSERT INTO relationships (organization_id, relationship_type, status) VALUES (105, 'referral_partner', 'active')",
  ).run();
  d1.raw.prepare(
    `INSERT INTO organization_members (organization_id, account_type, account_id, member_role, status)
     VALUES (105, 'customer', 101, 'customer', 'active')`,
  ).run();
  d1.raw.prepare(
    `INSERT INTO partner_memberships
       (partner_organization_id, account_type, account_id, partner_role, partner_type, status)
     VALUES (105, 'customer', 101, 'partner_admin', 'referral_partner', 'active')`,
  ).run();

  const response = await callApi(d1, "organization-context", { token });
  assert.equal(response.status, 200);
  const customerWorkspace = response.data.organizations.find((item) => item.organization_id === 101);
  const partnerWorkspace = response.data.organizations.find((item) => item.organization_id === 104);
  const unassignedWorkspace = response.data.organizations.find((item) => item.organization_id === 105);
  assert.equal(customerWorkspace.workspace_type, "customer");
  assert.equal(customerWorkspace.partner_type, null);
  assert.equal(partnerWorkspace.workspace_type, "partner");
  assert.equal(partnerWorkspace.partner_type, "reseller");
  assert.equal(unassignedWorkspace.workspace_type, "customer");
  assert.equal(unassignedWorkspace.partner_type, null);

  const selected = await callApi(d1, "organization-context", {
    method: "POST",
    token,
    body: { organization_id: 104 },
  });
  assert.equal(selected.status, 200);
  const partnerProfile = await callApi(d1, "partner/me", { token });
  assert.equal(partnerProfile.status, 200);
  assert.equal(partnerProfile.data.partner.partner_type, "reseller");
});

test("D1 capacity monitoring is restricted to super admins and reports platform recovery", async () => {
  const d1 = createD1Mock();
  const anonymous = await callApi(d1, "admin/d1-operations");
  assert.equal(anonymous.status, 403);

  const token = "d1-operations-test-session";
  d1.raw.prepare("INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+1 hour'))")
    .run(token);
  d1.raw.prepare(
    "INSERT INTO d1_storage_snapshots (database_id, database_name, sampled_at, size_bytes) VALUES (?, ?, ?, ?)"
  ).run("db-old", "smritisys-db-recovery", "2026-11-15T02:00:00.000Z", 921600);
  d1.raw.prepare(
    "INSERT INTO d1_storage_snapshots (database_id, database_name, sampled_at, size_bytes) VALUES (?, ?, ?, ?)"
  ).run("db-main", "smritisys-db", "2026-11-15T02:00:00.000Z", 716800);

  const response = await callApi(d1, "admin/d1-operations", { token });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.databases, ["smritisys-db"]);
  assert.deepEqual(response.data.snapshots.map((snapshot) => snapshot.database_name), ["smritisys-db"]);
  assert.equal(response.data.snapshots[0].size_bytes, 716800);
  assert.equal(response.data.manual_backup_status, "not_configured");
  assert.deepEqual(response.data.recovery, {
    provider: "cloudflare_d1_time_travel",
    status: "plan_dependent",
    retention_days: null,
  });
  assert.deepEqual(response.data.manual_backups, []);
});

test("organization details require a super admin and omit license keys", async () => {
  const d1 = createD1Mock();
  const anonymous = await callApi(d1, "admin/organizations/101");
  assert.equal(anonymous.status, 403);

  const token = "organization-details-test-session";
  d1.raw.prepare("INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+1 hour'))")
    .run(token);
  const customerToken = "organization-details-customer-session";
  d1.raw.prepare("INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 101, 101, datetime('now', '+1 hour'))")
    .run(customerToken);
  const customer = await callApi(d1, "admin/organizations/101", { token: customerToken });
  assert.equal(customer.status, 403);

  const response = await callApi(d1, "admin/organizations/101", { token });
  assert.equal(response.status, 200);
  assert.equal(response.data.organization.name, "Organization A");
  assert.equal(response.data.organization.gst_number, "27AABCO1234A1Z5");
  assert.equal(response.data.organization.relationship_types, "customer");
  assert.equal(response.data.members[0].email, "customer.a@smritibooks.com");
  assert.equal(response.data.members[0].member_role, "customer");
  assert.deepEqual(response.data.relationships.map((link) => [link.relationship_type, link.organization_name]), [
    ["Partner", "Channel Partner Pvt Ltd"],
  ]);
  assert.equal(response.data.licenses.length, 1);
  assert.equal(response.data.licenses[0].product_name, "SMRITI Retail OS");
  assert.doesNotMatch(JSON.stringify(response.data), /SMRITI-RET-ENT-2026-001/);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("D1 sampler records a scheduled size sample for the canonical database", async () => {
  const recorded = [];
  const database = {
    prepare(query) {
      if (query === "SELECT 1 AS health_check") {
        return {
          async run() {
            return { meta: { size_after: 716800 } };
          },
        };
      }
      assert.match(query, /INSERT INTO d1_storage_snapshots/);
      return {
        bind(...values) {
          return {
            async run() {
              recorded.push(values);
            },
          };
        },
      };
    },
  };
  const scheduledAt = Date.parse("2026-11-15T02:00:00.000Z");

  await sampleD1Database({
    DATABASE_ID: "db-main",
    DATABASE_NAME: "smritisys-db",
    DB: database,
  }, scheduledAt);

  assert.deepEqual(recorded, [
    ["db-main", "smritisys-db", "2026-11-15T02:00:00.000Z", 716800],
  ]);
});

test("D1 sampler fails explicitly when the size metadata is unavailable", async () => {
  let recorded = false;
  const primary = {
    prepare() {
      return {
        bind() {
          return { async run() { recorded = true; } };
        },
      };
    },
  };
  const unavailable = {
    prepare() {
      return { async run() { return { meta: {} }; } };
    },
  };

  await assert.rejects(sampleD1Database({
    DATABASE_ID: "db-main",
    DATABASE_NAME: "smritisys-db",
    DB: unavailable,
  }, Date.parse("2026-11-15T02:00:00.000Z")), /size metadata was unavailable/);
  assert.equal(recorded, false);
});

test("announcement migration preserves existing notices", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY); CREATE TABLE products (id INTEGER PRIMARY KEY);");
  db.exec(`CREATE TABLE announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    audience TEXT DEFAULT 'customer',
    published_at TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.prepare("INSERT INTO announcements (id, title, message, audience, published_at, status) VALUES (1, ?, ?, ?, ?, ?)")
    .run("Existing notice", "Previously published service notice", "customer", "2026-09-01", "published");
  db.exec(fs.readFileSync(new URL("../migrations/0013_customer_announcements.sql", import.meta.url), "utf8"));

  const migrated = db.prepare("SELECT title, message, audience, status, starts_at, severity FROM announcements WHERE id = 1").get();
  assert.equal(migrated.title, "Existing notice");
  assert.equal(migrated.message, "Previously published service notice");
  assert.equal(migrated.audience, "customer");
  assert.equal(migrated.status, "published");
  assert.equal(migrated.starts_at, "2026-09-01");
  assert.equal(migrated.severity, "info");
  assert.equal(db.prepare("SELECT title FROM announcements_legacy WHERE id = 1").get().title, "Existing notice");
});

test("D1 operations migration creates idempotent storage snapshots only", () => {
  const db = new DatabaseSync(":memory:");
  const migration = fs.readFileSync(new URL("../migrations/0024_d1_operations_monitoring.sql", import.meta.url), "utf8");
  db.exec(migration);
  db.exec(migration);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_storage_snapshots'").all();
  assert.deepEqual(tables.map((row) => row.name), ["d1_storage_snapshots"]);
  assert.doesNotMatch(migration, /d1_backup_runs/);
});

test("customer and partner administration migration classifies existing organizations", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE organizations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      legal_name TEXT,
      status TEXT DEFAULT 'active'
    );
    CREATE TABLE customers (id INTEGER PRIMARY KEY);
    CREATE TABLE people (id INTEGER PRIMARY KEY);
    CREATE TABLE organization_members (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      account_type TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      status TEXT DEFAULT 'active'
    );
    CREATE TABLE relationships (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      UNIQUE(organization_id, relationship_type)
    );
    CREATE TABLE partner_memberships (
      id INTEGER PRIMARY KEY,
      partner_organization_id INTEGER NOT NULL,
      account_type TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      partner_type TEXT NOT NULL
    );
    CREATE TABLE customer_invites (
      id INTEGER PRIMARY KEY,
      token_hash TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      company TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by INTEGER,
      customer_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      accepted_at TEXT
    );
    INSERT INTO organizations (id, name, legal_name) VALUES
      (1, 'Customer One', 'Customer One Pvt Ltd'),
      (2, 'Partner One', 'Partner One Pvt Ltd'),
      (3, 'SMRITISYS Internal', 'SMRITISYS Internal');
    INSERT INTO organization_members (organization_id, account_type, account_id)
      VALUES (1, 'customer', 10);
    INSERT INTO partner_memberships (partner_organization_id, account_type, account_id, partner_type)
      VALUES (2, 'customer', 20, 'reseller');
  `);
  const migration = fs.readFileSync(new URL("../migrations/0025_customer_partner_administration.sql", import.meta.url), "utf8");
  db.exec(migration);

  const inviteColumns = db.prepare("PRAGMA table_info(customer_invites)").all().map((column) => column.name);
  assert.ok(inviteColumns.includes("organization_id"));
  const relationships = db.prepare("SELECT organization_id, relationship_type FROM relationships ORDER BY organization_id").all();
  assert.deepEqual(relationships.map((row) => ({ organization_id: row.organization_id, relationship_type: row.relationship_type })), [
    { organization_id: 1, relationship_type: "customer" },
    { organization_id: 2, relationship_type: "reseller" },
    { organization_id: 3, relationship_type: "internal" },
  ]);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partner_invites'").get());
});

test("staff bootstrap uses Worker-supported PBKDF2 and can log in", async () => {
  const d1 = createD1Mock();
  d1.raw.prepare("DELETE FROM organization_members WHERE account_type = 'user' AND account_id = 201").run();
  d1.raw.prepare("DELETE FROM people WHERE source_type = 'user' AND source_id = 201").run();
  d1.raw.prepare("DELETE FROM users WHERE id = 201").run();
  d1.raw.prepare("UPDATE system_settings SET setting_value = '0' WHERE setting_key = 'staff_bootstrap_consumed'").run();

  const password = "Fresh-admin-test-passphrase-2026!";
  const signup = await callApi(d1, "signup", {
    method: "POST",
    headers: { "X-Staff-Bootstrap": "test-bootstrap-token" },
    bindings: { STAFF_BOOTSTRAP_TOKEN: "test-bootstrap-token" },
    body: { type: "user", email: "bootstrap@example.test", name: "Bootstrap Admin", password },
  });

  assert.equal(signup.status, 200);
  const storedHash = d1.raw.prepare("SELECT password_hash FROM users WHERE email = ?").get("bootstrap@example.test").password_hash;
  const iterations = Number(storedHash.split("$")[1]);
  assert.ok(iterations > 0 && iterations <= 100000);
  const missingCustomerPhone = await callApi(d1, "signup", {
    method: "POST",
    body: {
      type: "customer",
      email: "customer-without-phone@example.test",
      password: "Customer-signup-passphrase-2026!",
    },
  });
  assert.equal(missingCustomerPhone.status, 400);

  const login = await callApi(d1, "login", {
    method: "POST",
    body: { type: "user", email: "bootstrap@example.test", password },
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, "super_admin");
  assert.equal((await selectSessionOrganization(d1, login.data.token)).status, 200);

  const newPassword = "Changed-admin-test-passphrase-2026!";
  const passwordChange = await callApi(d1, "admin/password", {
    method: "POST",
    token: login.data.token,
    body: { current_password: password, new_password: newPassword },
  });
  assert.equal(passwordChange.status, 200);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM sessions WHERE account_type = 'user'").get().count, 0);

  const oldPasswordLogin = await callApi(d1, "login", {
    method: "POST",
    body: { type: "user", email: "bootstrap@example.test", password },
  });
  assert.equal(oldPasswordLogin.status, 401);

  const changedPasswordLogin = await callApi(d1, "login", {
    method: "POST",
    body: { type: "user", email: "bootstrap@example.test", password: newPassword },
  });
  assert.equal(changedPasswordLogin.status, 200);
});

test("unsupported PBKDF2 iteration counts are rejected without a server error", async () => {
  const d1 = createD1Mock();
  const hash = `pbkdf2-sha256$120000$${"00".repeat(16)}$${"00".repeat(32)}`;
  d1.raw.prepare("INSERT INTO users (email, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)")
    .run("legacy@example.test", hash, "Legacy Admin", "super_admin", "active");

  const login = await callApi(d1, "login", {
    method: "POST",
    body: { type: "user", email: "legacy@example.test", password: "password" },
  });

  assert.equal(login.status, 401);
});

test("customer setup invitations are one-time and provision the canonical customer identity", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-super-admin-invites";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();

  const denied = await callApi(d1, "admin/customer-invites");
  assert.equal(denied.status, 403);
  const missingPhone = await callApi(d1, "admin/customer-invites", {
    method: "POST",
    token: adminToken,
    body: { email: "missing-phone@example.test", company: "Example Academy" },
  });
  assert.equal(missingPhone.status, 400);

  const invite = await callApi(d1, "admin/customer-invites", {
    method: "POST",
    token: adminToken,
    body: { email: "invitee@example.test", phone: "+1 555 0100", name: "Invitee", company: "Example Academy" },
  });
  assert.equal(invite.status, 201);
  const token = invite.data.setup_path.match(/#token=([a-f0-9]{48})$/)?.[1];
  assert.ok(token);

  const storedInvite = d1.raw.prepare("SELECT token_hash, status FROM customer_invites WHERE id = ?").get(invite.data.invite_id);
  assert.equal(storedInvite.status, "pending");
  assert.equal(storedInvite.token_hash, await hashCustomerInviteToken(token));
  assert.notEqual(storedInvite.token_hash, token);
  const creationAudit = d1.raw.prepare(
    "SELECT new_value FROM audit_logs WHERE action = 'CUSTOMER_INVITE_CREATED' AND resource_id = ?"
  ).get(String(invite.data.invite_id));
  assert.equal(creationAudit.new_value.includes(token), false);

  const password = "One-time-invite-passphrase-2026!";
  const accepted = await callApi(d1, "customer-invites/accept", {
    method: "POST",
    body: { token, password },
  });
  assert.equal(accepted.status, 200);
  assert.equal(d1.raw.prepare("SELECT status FROM customer_invites WHERE id = ?").get(invite.data.invite_id).status, "accepted");

  const customer = d1.raw.prepare("SELECT id, password_hash, phone FROM customers WHERE email = ?").get("invitee@example.test");
  assert.ok(customer);
  assert.match(customer.password_hash, /^pbkdf2-sha256\$/);
  assert.equal(customer.phone, "+1 555 0100");
  const identity = d1.raw.prepare(
    `SELECT p.email, o.legal_name, m.member_role
     FROM people p
     JOIN organization_members m ON m.account_type = 'customer' AND m.account_id = p.source_id
     JOIN organizations o ON o.id = m.organization_id
     WHERE p.source_type = 'customer' AND p.source_id = ?`
  ).get(customer.id);
  assert.equal(identity.email, "invitee@example.test");
  assert.equal(identity.legal_name, "Example Academy");
  assert.equal(identity.member_role, "customer");

  const login = await callApi(d1, "login", {
    method: "POST",
    body: { type: "customer", email: "invitee@example.test", password },
  });
  assert.equal(login.status, 200);
  assert.equal((await selectSessionOrganization(d1, login.data.token)).status, 200);
  const missingPhoneUpdate = await callApi(d1, "profile", {
    method: "PUT",
    token: login.data.token,
    body: { name: "Invitee", phone: "" },
  });
  assert.equal(missingPhoneUpdate.status, 400);

  const inviteList = await callApi(d1, "admin/customer-invites", { token: adminToken });
  assert.equal(inviteList.status, 200);
  assert.equal("token_hash" in inviteList.data.invites[0], false);
  assert.equal("setup_path" in inviteList.data.invites[0], false);

  const replay = await callApi(d1, "customer-invites/accept", {
    method: "POST",
    body: { token, password },
  });
  assert.equal(replay.status, 410);
});

test("customer invitations can be revoked or expire before acceptance", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-super-admin-invite-revoke";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();

  const createInvite = async (email) => callApi(d1, "admin/customer-invites", {
    method: "POST",
    token: adminToken,
    body: { email, phone: "+1 555 0101", company: "Example Academy" },
  });
  const revokedInvite = await createInvite("revoked@example.test");
  assert.equal(revokedInvite.status, 201);
  const revokedToken = revokedInvite.data.setup_path.match(/#token=([a-f0-9]{48})$/)[1];
  const duplicateInvite = await createInvite("REVOKED@example.test");
  assert.equal(duplicateInvite.status, 409);
  const revoke = await callApi(d1, `admin/customer-invites/${revokedInvite.data.invite_id}/revoke`, {
    method: "POST",
    token: adminToken,
    body: {},
  });
  assert.equal(revoke.status, 200);
  const revokedAcceptance = await callApi(d1, "customer-invites/accept", {
    method: "POST",
    body: { token: revokedToken, password: "One-time-invite-passphrase-2026!" },
  });
  assert.equal(revokedAcceptance.status, 410);

  const expiredInvite = await createInvite("expired@example.test");
  assert.equal(expiredInvite.status, 201);
  const expiredToken = expiredInvite.data.setup_path.match(/#token=([a-f0-9]{48})$/)[1];
  d1.raw.prepare("UPDATE customer_invites SET expires_at = datetime('now', '-1 hour') WHERE id = ?")
    .run(expiredInvite.data.invite_id);
  const expiredAcceptance = await callApi(d1, "customer-invites/accept", {
    method: "POST",
    body: { token: expiredToken, password: "One-time-invite-passphrase-2026!" },
  });
  assert.equal(expiredAcceptance.status, 410);
});

test("admin customer profiles are searchable, editable, and recover access with single-use reset links", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-admin-customer-profile";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 101, 101, datetime('now', '+7 days'))"
  ).bind("customer-profile-old-session").run();

  assert.equal((await callApi(d1, "admin/customers")).status, 403);
  const search = await callApi(d1, "admin/customers?q=Organization%20A", { token: adminToken });
  assert.equal(search.status, 200);
  assert.ok(search.data.customers.some((customer) => customer.id === 101));
  assert.equal("password_hash" in search.data.customers[0], false);

  const detail = await callApi(d1, "admin/customers/101", { token: adminToken });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.profile.email, "customer.a@smritibooks.com");
  assert.equal(detail.data.organizations[0].name, "Organization A");
  assert.equal(JSON.stringify(detail.data).includes("password_hash"), false);

  const immutableEmail = await callApi(d1, "admin/customers/101", {
    method: "PATCH",
    token: adminToken,
    body: { name: "Changed", phone: "+1 555 0140", email: "changed@example.test" },
  });
  assert.equal(immutableEmail.status, 400);
  const updated = await callApi(d1, "admin/customers/101", {
    method: "PATCH",
    token: adminToken,
    body: {
      name: "Customer A Updated",
      phone: "+1 555 0140",
      gst_number: "27AABCO1234A1Z5",
      website: "https://organization-a.example.com",
      bio: "Updated from the admin profile",
      timezone: "Asia/Kolkata",
    },
  });
  assert.equal(updated.status, 200);
  assert.ok(updated.data.updated_fields.includes("name"));
  assert.equal(d1.raw.prepare("SELECT name, phone FROM customers WHERE id = 101").get().name, "Customer A Updated");
  assert.equal(d1.raw.prepare("SELECT name FROM people WHERE source_type = 'customer' AND source_id = 101").get().name, "Customer A Updated");
  const partialUpdate = await callApi(d1, "admin/customers/101", {
    method: "PATCH",
    token: adminToken,
    body: { name: "Customer A Final", phone: "+1 555 0140" },
  });
  assert.equal(partialUpdate.status, 200);
  assert.equal(d1.raw.prepare("SELECT bio FROM customer_profiles WHERE customer_id = 101").get().bio, "Updated from the admin profile");
  const foreignAddressId = d1.raw.prepare(
    `INSERT INTO customer_addresses (customer_id, address_line1, city, country)
     VALUES (102, 'Private address', 'Other City', 'India')`
  ).run().lastInsertRowid;
  const addressUpdate = await callApi(d1, "admin/customers/101", {
    method: "PATCH",
    token: adminToken,
    body: {
      name: "Customer A Final",
      phone: "+1 555 0140",
      addresses: [{
        address_type: "billing",
        address_line1: "12 Example Road",
        city: "Pune",
        state: "Maharashtra",
        postal_code: "411001",
        country: "India",
        is_default: true,
      }],
    },
  });
  assert.equal(addressUpdate.status, 200);
  const customerAddress = d1.raw.prepare(
    "SELECT id, address_line1, city, is_default FROM customer_addresses WHERE customer_id = 101"
  ).get();
  assert.equal(customerAddress.address_line1, "12 Example Road");
  assert.equal(customerAddress.city, "Pune");
  assert.equal(customerAddress.is_default, 1);
  const savedAddressUpdate = await callApi(d1, "admin/customers/101", {
    method: "PATCH",
    token: adminToken,
    body: {
      name: "Customer A Final",
      phone: "+1 555 0140",
      addresses: [{
        id: customerAddress.id,
        address_type: "billing",
        address_line1: "12 Example Road",
        city: "Nashik",
        state: "Maharashtra",
        postal_code: "411001",
        country: "India",
        is_default: false,
      }],
    },
  });
  assert.equal(savedAddressUpdate.status, 200);
  assert.equal(d1.raw.prepare("SELECT city, is_default FROM customer_addresses WHERE id = ?").get(customerAddress.id).city, "Nashik");
  const foreignAddressUpdate = await callApi(d1, "admin/customers/101", {
    method: "PATCH",
    token: adminToken,
    body: {
      name: "Customer A Final",
      phone: "+1 555 0140",
      addresses: [{
        id: Number(foreignAddressId),
        address_type: "billing",
        address_line1: "Attempted cross-customer edit",
        country: "India",
        is_default: true,
      }],
    },
  });
  assert.equal(foreignAddressUpdate.status, 404);
  assert.equal(d1.raw.prepare("SELECT address_line1 FROM customer_addresses WHERE id = ?").get(foreignAddressId).address_line1, "Private address");

  const reset = await callApi(d1, "admin/customers/101/password-reset", {
    method: "POST",
    token: adminToken,
    body: {},
  });
  assert.equal(reset.status, 201);
  const token = reset.data.reset_path.match(/#token=([a-f0-9]{48})$/)?.[1];
  assert.ok(token);
  const storedReset = d1.raw.prepare(
    "SELECT token_hash, status FROM customer_password_resets WHERE customer_id = 101"
  ).get();
  assert.equal(storedReset.token_hash, await hashCustomerInviteToken(token));
  assert.equal(storedReset.status, "pending");
  assert.notEqual(storedReset.token_hash, token);

  const newPassword = "Customer-reset-passphrase-2026!";
  const completed = await callApi(d1, "password-reset/complete", {
    method: "POST",
    body: { token, password: newPassword },
  });
  assert.equal(completed.status, 200);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM sessions WHERE token = 'customer-profile-old-session'").get().count, 0);
  assert.equal(d1.raw.prepare("SELECT status FROM customer_password_resets WHERE token_hash = ?").get(storedReset.token_hash).status, "used");
  const replay = await callApi(d1, "password-reset/complete", {
    method: "POST",
    body: { token, password: newPassword },
  });
  assert.equal(replay.status, 410);
  const login = await callApi(d1, "login", {
    method: "POST",
    body: { type: "customer", email: "customer.a@smritibooks.com", password: newPassword },
  });
  assert.equal(login.status, 200);
  assert.ok(d1.raw.prepare("SELECT id FROM audit_logs WHERE action = 'CUSTOMER_PASSWORD_RESET_COMPLETED'").get());
});

test("partners can update only contacts in their active customer assignments", async () => {
  const d1 = createD1Mock();
  const partnerToken = "test-token-partner-customer-contact";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 103, 103, datetime('now', '+7 days'))"
  ).bind(partnerToken).run();

  const contacts = await callApi(d1, "partner/customers", { token: partnerToken });
  assert.equal(contacts.status, 200);
  assert.equal(contacts.data.permissions.manage_customer_contacts, true);
  assert.ok(contacts.data.contacts.some((contact) => contact.id === 101));

  const deniedFields = await callApi(d1, "partner/customers/101/contact", {
    method: "PATCH",
    token: partnerToken,
    body: { name: "Partner Edit", phone: "+1 555 0141", email: "changed@example.test" },
  });
  assert.equal(deniedFields.status, 400);
  const updated = await callApi(d1, "partner/customers/101/contact", {
    method: "PATCH",
    token: partnerToken,
    body: { name: "Partner Updated Contact", phone: "+1 555 0141" },
  });
  assert.equal(updated.status, 200);
  assert.equal(d1.raw.prepare("SELECT name, phone, email FROM customers WHERE id = 101").get().email, "customer.a@smritibooks.com");
  assert.equal(d1.raw.prepare("SELECT name FROM customers WHERE id = 101").get().name, "Partner Updated Contact");

  const unassigned = await callApi(d1, "partner/customers/102/contact", {
    method: "PATCH",
    token: partnerToken,
    body: { name: "Out of scope", phone: "+1 555 0142" },
  });
  assert.equal(unassigned.status, 404);
  assert.ok(d1.raw.prepare("SELECT id FROM audit_logs WHERE action = 'PARTNER_CUSTOMER_CONTACT_UPDATED'").get());
});

test("customer contacts reuse an organization and inactive activation-only accounts can be converted", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-customer-org-reuse";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();
  const organizationCount = d1.raw.prepare("SELECT COUNT(*) AS count FROM organizations").get().count;

  const invite = await callApi(d1, "admin/customer-invites", {
    method: "POST",
    token: adminToken,
    body: { email: "second-contact@example.test", phone: "+1 555 0102", name: "Second Contact", organization_id: 101 },
  });
  assert.equal(invite.status, 201);
  assert.equal(d1.raw.prepare("SELECT organization_id FROM customer_invites WHERE id = ?").get(invite.data.invite_id).organization_id, 101);
  const token = invite.data.setup_path.match(/#token=([a-f0-9]{48})$/)[1];
  const accepted = await callApi(d1, "customer-invites/accept", {
    method: "POST",
    body: { token, password: "Second-contact-passphrase-2026!" },
  });
  assert.equal(accepted.status, 200);
  assert.equal(
    d1.raw.prepare("SELECT COUNT(*) AS count FROM organization_members WHERE organization_id = 101 AND account_type = 'customer' AND status = 'active'").get().count,
    2,
  );
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM organizations").get().count, organizationCount);

  const alreadyMember = await callApi(d1, "admin/customer-invites", {
    method: "POST",
    token: adminToken,
    body: { email: "customer.a@smritibooks.com", phone: "+1 555 0103", organization_id: 101 },
  });
  assert.equal(alreadyMember.status, 200);
  assert.equal(alreadyMember.data.membership_added, false);

  d1.raw.prepare("UPDATE customers SET status = 'inactive' WHERE id = 102").run();
  d1.raw.prepare("UPDATE organization_members SET status = 'inactive' WHERE organization_id = 102 AND account_id = 102").run();
  const conversion = await callApi(d1, "admin/customer-invites", {
    method: "POST",
    token: adminToken,
    body: { email: "customer.b@example.com", phone: "+1 555 0104", organization_id: 102 },
  });
  assert.equal(conversion.status, 201);
  const conversionInviteId = conversion.data.invite_id;
  const conversionToken = conversion.data.setup_path.match(/#token=([a-f0-9]{48})$/)[1];
  const converted = await callApi(d1, "customer-invites/accept", {
    method: "POST",
    body: { token: conversionToken, password: "Converted-customer-passphrase-2026!" },
  });
  assert.equal(converted.status, 200);
  assert.equal(d1.raw.prepare("SELECT status FROM customers WHERE id = 102").get().status, "active");
  assert.equal(
    d1.raw.prepare("SELECT status FROM organization_members WHERE organization_id = 102 AND account_id = 102").get().status,
    "active",
  );
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM customers WHERE lower(email) = 'customer.b@example.com'").get().count, 1);
  assert.equal(d1.raw.prepare("SELECT status FROM customer_invites WHERE id = ?").get(conversionInviteId).status, "accepted");
});

test("partner onboarding, customer links, and partner setup invitations are scoped and audited", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-partner-administration";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();

  const denied = await callApi(d1, "admin/partners");
  assert.equal(denied.status, 403);
  const created = await callApi(d1, "admin/partners", {
    method: "POST",
    token: adminToken,
    body: {
      organization_name: "New Implementation Partner",
      partner_type: "implementation_partner",
      partner_role: "partner_admin",
      email: "partner-admin@example.test",
      phone: "+1 555 0105",
      name: "Partner Admin",
      address: "100 Market Street",
      city: "San Francisco",
      state: "California",
      pincode: "94105",
      country: "United States",
      organization_phone: "+1 555 0199",
    },
  });
  assert.equal(created.status, 201);
  const partnerId = created.data.partner_organization_id;
  const inviteToken = created.data.setup_path.match(/#type=partner&token=([a-f0-9]{48})$/)[1];
  const organizationCount = d1.raw.prepare("SELECT COUNT(*) AS count FROM organizations").get().count;
  const missingPartnerPhone = await callApi(d1, "admin/partners", {
    method: "POST",
    token: adminToken,
    body: {
      organization_name: "Partner Without Contact Phone",
      partner_type: "reseller",
      partner_role: "partner_admin",
      email: "partner-no-phone@example.test",
    },
  });
  assert.equal(missingPartnerPhone.status, 400);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM organizations").get().count, organizationCount);
  const invalidContact = await callApi(d1, "admin/partners", {
    method: "POST",
    token: adminToken,
    body: {
      organization_name: "Rejected Orphan Partner",
      partner_type: "reseller",
      partner_role: "partner_admin",
      email: d1.raw.prepare("SELECT email FROM users WHERE id = 201").get().email,
      phone: "+1 555 0106",
    },
  });
  assert.equal(invalidContact.status, 409);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM organizations").get().count, organizationCount);
  assert.equal(
    (await callApi(d1, `admin/partners/${partnerId}`, { method: "PATCH", body: { status: "inactive" } })).status,
    403,
  );
  const customerOrganizationAsPartner = await callApi(d1, "admin/partners", {
    method: "POST",
    token: adminToken,
    body: {
      organization_id: 101,
      partner_type: "channel_partner",
      email: "customer-org-partner@example.test",
      phone: "+1 555 0107",
    },
  });
  assert.equal(customerOrganizationAsPartner.status, 404);
  const misclassifiedCustomerInvite = await callApi(d1, "admin/customer-invites", {
    method: "POST",
    token: adminToken,
    body: { email: "wrong-organization@example.test", phone: "+1 555 0108", organization_id: partnerId },
  });
  assert.equal(misclassifiedCustomerInvite.status, 400);
  const listed = await callApi(d1, "admin/partners", { token: adminToken });
  assert.equal(listed.status, 200);
  assert.ok(listed.data.partners.some((partner) => partner.id === partnerId && partner.partner_type === "implementation_partner"));
  assert.ok(listed.data.partners.find((partner) => partner.id === partnerId).pending_invite_count === 1);

  const inviteList = await callApi(d1, "admin/partner-invites", { token: adminToken });
  assert.equal(inviteList.status, 200);
  assert.equal(inviteList.data.invites[0].email, "partner-admin@example.test");
  const password = "Partner-admin-passphrase-2026!";
  const accepted = await callApi(d1, "partner-invites/accept", {
    method: "POST",
    body: { token: inviteToken, password },
  });
  assert.equal(accepted.status, 200);
  assert.equal(
    d1.raw.prepare("SELECT COUNT(*) AS count FROM partner_memberships WHERE partner_organization_id = ? AND account_type = 'customer'").get(partnerId).count,
    1,
  );
  assert.equal(
    d1.raw.prepare("SELECT phone FROM customers WHERE email = 'partner-admin@example.test'").get().phone,
    "+1 555 0105",
  );
  assert.equal(
    d1.raw.prepare("SELECT COUNT(*) AS count FROM relationships WHERE organization_id = ? AND relationship_type = 'customer'").get(partnerId).count,
    0,
  );

  const login = await callApi(d1, "login", {
    method: "POST",
    body: { type: "customer", email: "partner-admin@example.test", password },
  });
  assert.equal(login.status, 200);
  assert.equal((await selectSessionOrganization(d1, login.data.token, partnerId)).status, 200);
  const customerLicenseAccess = await callApi(d1, "licenses", { token: login.data.token });
  assert.equal(customerLicenseAccess.status, 403);
  const customerOrganizationAccess = await callApi(d1, "organization", { token: login.data.token });
  assert.equal(customerOrganizationAccess.status, 403);
  const partnerMe = await callApi(d1, "partner/me", { token: login.data.token });
  assert.equal(partnerMe.status, 200);
  assert.equal(partnerMe.data.partner.partner_type, "implementation_partner");
  assert.equal(partnerMe.data.partner.city, "San Francisco");
  assert.equal(partnerMe.data.partner.phone, "+1 555 0199");
  const initialMembers = await callApi(d1, "admin/partners", { token: adminToken });
  const partnerAdmin = initialMembers.data.members.find(
    (member) => member.partner_organization_id === partnerId && member.email === "partner-admin@example.test",
  );
  assert.ok(partnerAdmin);
  const lastAdminDemotion = await callApi(d1, `admin/partners/${partnerId}/members/${partnerAdmin.id}`, {
    method: "PATCH",
    token: adminToken,
    body: { partner_role: "partner_member" },
  });
  assert.equal(lastAdminDemotion.status, 409);

  const typeChange = await callApi(d1, `admin/partners/${partnerId}`, {
    method: "PATCH",
    token: adminToken,
    body: { partner_type: "channel_partner" },
  });
  assert.equal(typeChange.status, 200);
  assert.equal(
    d1.raw.prepare("SELECT relationship_type FROM relationships WHERE organization_id = ? AND relationship_type = 'channel_partner'").get(partnerId).relationship_type,
    "channel_partner",
  );
  assert.equal(
    d1.raw.prepare(
      "SELECT partner_type FROM partner_memberships WHERE partner_organization_id = ? AND account_type = ? AND account_id = ?",
    ).get(partnerId, partnerAdmin.account_type, partnerAdmin.account_id).partner_type,
    "channel_partner",
  );
  const missingPartnerCustomerPhone = await callApi(d1, "partner/customers", {
    method: "POST",
    token: login.data.token,
    body: { email: "partner-customer-no-phone@example.test", company: "No Phone Academy" },
  });
  assert.equal(missingPartnerCustomerPhone.status, 400);

  const memberInvite = await callApi(d1, `admin/partners/${partnerId}/members`, {
    method: "POST",
    token: adminToken,
    body: {
      partner_type: "channel_partner",
      partner_role: "partner_member",
      email: "partner-member@example.test",
      phone: "+1 555 0109",
      name: "Partner Member",
    },
  });
  assert.equal(memberInvite.status, 201);
  const memberInviteToken = memberInvite.data.setup_path.match(/#type=partner&token=([a-f0-9]{48})$/)[1];
  const memberAccepted = await callApi(d1, "partner-invites/accept", {
    method: "POST",
    body: { token: memberInviteToken, password: "Partner-member-passphrase-2026!" },
  });
  assert.equal(memberAccepted.status, 200);
  const partnerMember = d1.raw.prepare(
    "SELECT id FROM organization_members WHERE organization_id = ? AND account_type = 'customer' AND account_id = (SELECT id FROM customers WHERE email = 'partner-member@example.test')"
  ).get(partnerId);
  assert.ok(partnerMember);
  const promoteMember = await callApi(d1, `admin/partners/${partnerId}/members/${partnerMember.id}`, {
    method: "PATCH",
    token: adminToken,
    body: { partner_role: "partner_admin" },
  });
  assert.equal(promoteMember.status, 200);
  const deactivateMember = await callApi(d1, `admin/partners/${partnerId}/members/${partnerMember.id}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "inactive" },
  });
  assert.equal(deactivateMember.status, 200);
  assert.equal(
    d1.raw.prepare("SELECT status FROM organization_members WHERE organization_id = ? AND account_id = (SELECT id FROM customers WHERE email = 'partner-member@example.test')").get(partnerId).status,
    "inactive",
  );
  const lastAdminDeactivation = await callApi(d1, `admin/partners/${partnerId}/members/${partnerAdmin.id}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "inactive" },
  });
  assert.equal(lastAdminDeactivation.status, 409);
  assert.ok(d1.raw.prepare("SELECT 1 FROM audit_logs WHERE action = 'PARTNER_MEMBER_UPDATED'").get());
  assert.ok(d1.raw.prepare("SELECT 1 FROM audit_logs WHERE action = 'PARTNER_UPDATED'").get());

  const linked = await callApi(d1, `admin/partners/${partnerId}/customers`, {
    method: "POST",
    token: adminToken,
    body: { customer_organization_id: 101 },
  });
  assert.equal(linked.status, 200);
  assert.equal(
    d1.raw.prepare("SELECT status FROM partner_customer_links WHERE partner_organization_id = ? AND customer_organization_id = 101").get(partnerId).status,
    "active",
  );
  const partnerCustomers = await callApi(d1, "partner/customers", { token: login.data.token });
  assert.equal(partnerCustomers.status, 200);
  assert.equal(partnerCustomers.data.customers[0].id, 101);

  const partnerDeactivated = await callApi(d1, `admin/partners/${partnerId}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "inactive" },
  });
  assert.equal(partnerDeactivated.status, 200);
  assert.equal((await callApi(d1, "partner/me", { token: login.data.token })).status, 403);
  assert.equal(
    d1.raw.prepare("SELECT status FROM partner_customer_links WHERE partner_organization_id = ? AND customer_organization_id = 101").get(partnerId).status,
    "active",
  );
  const partnerReactivated = await callApi(d1, `admin/partners/${partnerId}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "active" },
  });
  assert.equal(partnerReactivated.status, 200);
  assert.equal((await callApi(d1, "partner/me", { token: login.data.token })).status, 200);

  const revoked = await callApi(d1, `admin/partners/${partnerId}/customers/101/revoke`, {
    method: "POST",
    token: adminToken,
    body: {},
  });
  assert.equal(revoked.status, 200);
  assert.equal(
    d1.raw.prepare("SELECT status FROM partner_customer_links WHERE partner_organization_id = ? AND customer_organization_id = 101").get(partnerId).status,
    "revoked",
  );
  assert.ok(d1.raw.prepare("SELECT 1 FROM audit_logs WHERE action = 'PARTNER_CUSTOMER_LINK_REVOKED'").get());

  const partnerCustomerInvite = await callApi(d1, "partner/customers", {
    method: "POST",
    token: login.data.token,
    body: {
      email: "partner-created-customer@example.test",
      phone: "+1 555 0111",
      name: "Partner Customer",
      company: "Partner Customer Academy",
    },
  });
  assert.equal(partnerCustomerInvite.status, 201);
  const partnerCustomerToken = partnerCustomerInvite.data.setup_path.match(/#token=([a-f0-9]{48})$/)[1];
  const acceptedPartnerCustomer = await callApi(d1, "customer-invites/accept", {
    method: "POST",
    body: { token: partnerCustomerToken, password: "Partner-created-customer-passphrase-2026!" },
  });
  assert.equal(acceptedPartnerCustomer.status, 200);
  assert.equal(
    d1.raw.prepare("SELECT phone FROM customers WHERE email = 'partner-created-customer@example.test'").get().phone,
    "+1 555 0111",
  );
  assert.equal(
    d1.raw.prepare("SELECT COUNT(*) AS count FROM partner_customer_links WHERE partner_organization_id = ? AND status = 'active'").get(partnerId).count,
    1,
  );
});

test("partner deal registration is tenant-scoped, manually reviewed, and feeds an internal-only follow-up queue", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-deal-admin";
  const partnerToken = "test-token-deal-partner";
  const secondPartnerToken = "test-token-deal-second-partner";
  const customerToken = "test-token-deal-customer";
  const unselectedToken = "test-token-deal-unselected";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();
  d1.raw.prepare(
    "INSERT INTO users (id, email, password_hash, name, role, status) VALUES (202, 'task-owner@example.test', 'hash', 'Task Owner', 'staff', 'active')"
  ).run();
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 103, 103, datetime('now', '+7 days'))"
  ).bind(partnerToken).run();
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 101, 101, datetime('now', '+7 days'))"
  ).bind(customerToken).run();
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'customer', 103, datetime('now', '+7 days'))"
  ).bind(unselectedToken).run();
  d1.raw.exec(`
    INSERT INTO customers (id, email, password_hash, name, company, status)
    VALUES (104, 'second-partner@example.test', 'hash', 'Second Partner', 'Second Partner LLC', 'active');
    INSERT INTO people (id, email, name, source_type, source_id, status)
    VALUES (104, 'second-partner@example.test', 'Second Partner', 'customer', 104, 'active');
    INSERT INTO organizations (id, name, status) VALUES (104, 'Second Partner LLC', 'active');
    INSERT INTO relationships (organization_id, relationship_type, status) VALUES (104, 'reseller', 'active');
    INSERT INTO organization_members (organization_id, account_type, account_id, member_role, status)
    VALUES (104, 'customer', 104, 'partner_member', 'active');
    INSERT INTO partner_memberships (partner_organization_id, account_type, account_id, partner_role, partner_type, status)
    VALUES (104, 'customer', 104, 'partner_member', 'reseller', 'active');
  `);
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 104, 104, datetime('now', '+7 days'))"
  ).bind(secondPartnerToken).run();

  const unauthorized = await callApi(d1, "partner/deals", {
    method: "POST",
    token: customerToken,
    body: { prospect_organization_name: "Prospect Academy", summary: "A valid opportunity summary." },
  });
  assert.equal(unauthorized.status, 403);
  assert.equal((await callApi(d1, "partner/deals", { token: unselectedToken })).status, 403);
  const forgedOrganization = await callApi(d1, "partner/deals", {
    method: "POST",
    token: partnerToken,
    body: {
      partner_organization_id: 104,
      prospect_organization_name: "Prospect Academy",
      summary: "A valid opportunity summary.",
    },
  });
  assert.equal(forgedOrganization.status, 400);

  const commissionCountBefore = d1.raw.prepare("SELECT COUNT(*) AS count FROM partner_commissions").get().count;
  const organizationCountBeforeDeals = d1.raw.prepare("SELECT COUNT(*) AS count FROM organizations").get().count;
  const customerCountBeforeDeals = d1.raw.prepare("SELECT COUNT(*) AS count FROM customers").get().count;
  const firstDeal = await callApi(d1, "partner/deals", {
    method: "POST",
    token: partnerToken,
    body: {
      prospect_organization_name: "Prospect Academy",
      contact_email: "owner@prospect.test",
      website: "https://prospect.test",
      summary: "Prospect requested a product demonstration.",
    },
  });
  assert.equal(firstDeal.status, 201);
  assert.equal(
    d1.raw.prepare("SELECT partner_organization_id FROM deal_registrations WHERE id = ?").get(firstDeal.data.deal_id).partner_organization_id,
    103,
  );
  const secondDeal = await callApi(d1, "partner/deals", {
    method: "POST",
    token: secondPartnerToken,
    body: {
      prospect_organization_name: "Prospect Academy",
      contact_email: "sales@prospect.test",
      summary: "Prospect requested a separate partner discussion.",
    },
  });
  assert.equal(secondDeal.status, 201);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM partner_commissions").get().count, commissionCountBefore);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM organizations").get().count, organizationCountBeforeDeals);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM customers").get().count, customerCountBeforeDeals);
  const partnerDeals = await callApi(d1, "partner/deals", { token: partnerToken });
  assert.equal(partnerDeals.status, 200);
  assert.deepEqual(partnerDeals.data.deals.map((deal) => deal.id), [firstDeal.data.deal_id]);
  const secondPartnerDeals = await callApi(d1, "partner/deals", { token: secondPartnerToken });
  assert.deepEqual(secondPartnerDeals.data.deals.map((deal) => deal.id), [secondDeal.data.deal_id]);

  const adminDeals = await callApi(d1, "admin/partner-deals", { token: adminToken });
  assert.equal(adminDeals.status, 200);
  assert.equal(adminDeals.data.total, 2);
  assert.ok(adminDeals.data.deals.every((deal) => deal.possible_duplicate === 1));
  assert.equal(
    (await callApi(d1, "admin/partner-deals", { token: partnerToken })).status,
    403,
  );

  const missingDecision = await callApi(d1, `admin/partner-deals/${firstDeal.data.deal_id}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "needs_information" },
  });
  assert.equal(missingDecision.status, 400);
  const reviewed = await callApi(d1, `admin/partner-deals/${firstDeal.data.deal_id}`, {
    method: "PATCH",
    token: adminToken,
    body: {
      status: "needs_information",
      decision_summary: "Please add the requested deployment timeline.",
      internal_note: "Discussed at channel review.",
    },
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.data.status, "needs_information");
  const terminalTransition = await callApi(d1, `admin/partner-deals/${firstDeal.data.deal_id}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "submitted", decision_summary: "Please add the requested deployment timeline." },
  });
  assert.equal(terminalTransition.status, 409);

  const partnerVisibleDeals = await callApi(d1, "partner/deals", { token: partnerToken });
  assert.equal(partnerVisibleDeals.data.deals[0].decision_summary, "Please add the requested deployment timeline.");
  assert.equal(Object.prototype.hasOwnProperty.call(partnerVisibleDeals.data.deals[0], "internal_note"), false);
  const crossPartnerResponse = await callApi(d1, `partner/deals/${firstDeal.data.deal_id}`, {
    method: "PATCH",
    token: secondPartnerToken,
    body: { partner_response: "This response must not cross partner scope." },
  });
  assert.equal(crossPartnerResponse.status, 404);
  const shortResponse = await callApi(d1, `partner/deals/${firstDeal.data.deal_id}`, {
    method: "PATCH",
    token: partnerToken,
    body: { partner_response: "Short" },
  });
  assert.equal(shortResponse.status, 400);
  d1.raw.prepare(
    "INSERT INTO support_tickets (customer_id, subject, description) VALUES (101, 'Follow-up queue test', 'Open ticket for pagination verification')"
  ).run();
  const deniedQueue = await callApi(d1, "admin/follow-ups", { token: partnerToken });
  assert.equal(deniedQueue.status, 403);
  const messagesBeforeQueue = d1.raw.prepare("SELECT COUNT(*) AS count FROM support_ticket_messages").get().count;
  const queue = await callApi(d1, "admin/follow-ups", { token: adminToken });
  assert.equal(queue.status, 200);
  assert.equal(queue.data.policy, "manual_review_no_sla_or_outbound_messages");
  assert.ok(queue.data.total >= 2);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM support_ticket_messages").get().count, messagesBeforeQueue);
  assert.ok(queue.data.items.some((item) => item.type === "deal_registration" && item.id === secondDeal.data.deal_id));
  assert.equal(queue.data.items.some((item) => item.type === "deal_registration" && item.id === firstDeal.data.deal_id), false);
  const queueSecondPage = await callApi(d1, "admin/follow-ups?page=2&page_size=1", { token: adminToken });
  assert.equal(queueSecondPage.status, 200);
  assert.equal(queueSecondPage.data.page, 2);
  assert.equal(queueSecondPage.data.items.length, 1);
  const deniedTaskCreate = await callApi(d1, "admin/follow-up-tasks", {
    method: "POST",
    token: partnerToken,
    body: { title: "Unauthorized task" },
  });
  assert.equal(deniedTaskCreate.status, 403);
  const invalidTaskDate = await callApi(d1, "admin/follow-up-tasks", {
    method: "POST",
    token: adminToken,
    body: { title: "Invalid due date", due_date: "2026-02-31" },
  });
  assert.equal(invalidTaskDate.status, 400);
  const invalidTaskOwner = await callApi(d1, "admin/follow-up-tasks", {
    method: "POST",
    token: adminToken,
    body: { title: "Invalid task owner", assigned_to_user_id: 999 },
  });
  assert.equal(invalidTaskOwner.status, 400);
  const createdTask = await callApi(d1, "admin/follow-up-tasks", {
    method: "POST",
    token: adminToken,
    body: {
      title: "Review prospect follow-up",
      description: "Contact the channel team after the internal review.",
      assigned_to_user_id: 202,
      due_date: "2026-12-15",
    },
  });
  assert.equal(createdTask.status, 201);
  const listedTasks = await callApi(d1, "admin/follow-up-tasks", { token: adminToken });
  assert.equal(listedTasks.status, 200);
  assert.equal(listedTasks.data.tasks[0].assigned_to_name, "Task Owner");
  assert.ok(listedTasks.data.assignees.some((user) => user.id === 202));
  d1.raw.prepare("UPDATE users SET status = 'inactive' WHERE id = 202").run();
  const updatedTask = await callApi(d1, `admin/follow-up-tasks/${createdTask.data.task_id}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "in_progress" },
  });
  assert.equal(updatedTask.status, 200);
  assert.equal(
    d1.raw.prepare("SELECT assigned_to_user_id FROM follow_up_tasks WHERE id = ?").get(createdTask.data.task_id).assigned_to_user_id,
    202,
  );
  const unassignedTask = await callApi(d1, `admin/follow-up-tasks/${createdTask.data.task_id}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "completed", assigned_to_user_id: null, due_date: null },
  });
  assert.equal(unassignedTask.status, 200);
  const taskRecord = d1.raw.prepare(
    "SELECT status, assigned_to_user_id, due_date FROM follow_up_tasks WHERE id = ?"
  ).get(createdTask.data.task_id);
  assert.equal(taskRecord.status, "completed");
  assert.equal(taskRecord.assigned_to_user_id, null);
  assert.equal(taskRecord.due_date, null);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action LIKE 'ADMIN_FOLLOW_UP_TASK_%'").get().count, 3);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM support_ticket_messages").get().count, messagesBeforeQueue);
  const partnerResponse = await callApi(d1, `partner/deals/${firstDeal.data.deal_id}`, {
    method: "PATCH",
    token: partnerToken,
    body: { partner_response: "The requested deployment timeline is six weeks." },
  });
  assert.equal(partnerResponse.status, 200);
  assert.equal(partnerResponse.data.status, "submitted");
  assert.equal(
    d1.raw.prepare("SELECT partner_response, status FROM deal_registrations WHERE id = ?").get(firstDeal.data.deal_id).partner_response,
    "The requested deployment timeline is six weeks.",
  );
  assert.ok(d1.raw.prepare("SELECT 1 FROM audit_logs WHERE action = 'PARTNER_DEAL_RESPONSE_SUBMITTED'").get());
  assert.ok(d1.raw.prepare("SELECT 1 FROM audit_logs WHERE action = 'PARTNER_DEAL_SUBMITTED'").get());
  assert.ok(d1.raw.prepare("SELECT 1 FROM audit_logs WHERE action = 'ADMIN_PARTNER_DEAL_REVIEWED'").get());
});

test("direct license issuance registers an activation-only customer and reveals the key once", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-direct-license";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();

  const productId = d1.raw.prepare("SELECT id FROM products WHERE slug = 'prathamone-eduos'").get().id;
  const editionId = d1.raw.prepare(
    "SELECT id FROM product_editions WHERE product_id = ? AND code = 'coaching-institute'"
  ).get(productId).id;
  d1.raw.prepare(
    "INSERT INTO customers (id, email, password_hash, company, status) VALUES (300, ?, 'test-hash', ?, 'active')"
  ).run("internal-bound@example.test", "Internal Test");
  d1.raw.prepare(
    "INSERT INTO organization_members (organization_id, account_type, account_id, member_role, status) VALUES (201, 'customer', 300, 'customer', 'active')"
  ).run();
  d1.raw.prepare(
    "INSERT INTO organizations (name, legal_name, status) VALUES (?, ?, 'active')"
  ).run("Example Coaching Academy", "Example Coaching Academy");
  const preexistingOrganizationId = d1.raw.prepare(
    "SELECT id FROM organizations WHERE name = ?"
  ).get("Example Coaching Academy").id;
  const body = {
    customer_mode: "new",
    customer_email: "license-only@example.test",
    customer_phone: "+1 555 0110",
    customer_name: "License Contact",
    customer_company: "Example Coaching Academy",
    product_id: productId,
    edition_id: editionId,
    company_binding: "PA001",
    status: "ACTIVE",
    start_date: "2026-11-14",
    expiry_date: "2027-11-14",
    entitlements: [
      { key: "company.binding", value_type: "text", value: "PA001" },
      { key: "license.model", value_type: "text", value: "on_premise_subscription" },
    ],
  };
  const internalOrganization = await callApi(d1, "licenses", {
    method: "POST",
    token: adminToken,
    body: { ...body, customer_mode: "existing", organization_id: 201 },
  });
  assert.equal(internalOrganization.status, 400);
  const missingCustomerPhone = await callApi(d1, "licenses", {
    method: "POST",
    token: adminToken,
    body: { ...body, customer_phone: "" },
  });
  assert.equal(missingCustomerPhone.status, 400);

  const issued = await callApi(d1, "licenses", { method: "POST", token: adminToken, body });
  assert.equal(issued.status, 201);
  assert.match(issued.data.license.serial_number, /^SMR-LIC-\d{8}$/);
  assert.match(issued.data.license.license_key, /^LIC-[A-F0-9]+$/);
  const licenseId = issued.data.license.id;
  const customer = d1.raw.prepare(
    "SELECT id, password_hash, phone, status FROM customers WHERE email = ?"
  ).get("license-only@example.test");
  assert.equal(customer.status, "inactive");
  assert.equal(customer.phone, "+1 555 0110");
  assert.match(customer.password_hash, /^pbkdf2-sha256\$/);
  assert.equal(d1.raw.prepare(
    "SELECT COUNT(*) AS count FROM customer_invites WHERE lower(email) = lower(?)"
  ).get("license-only@example.test").count, 0);

  const organization = d1.raw.prepare(
    `SELECT o.id, o.name, o.legal_name, om.status
     FROM organizations o
     JOIN organization_members om ON om.organization_id = o.id
     WHERE om.account_type = 'customer' AND om.account_id = ?`
  ).get(customer.id);
  assert.notEqual(organization.id, preexistingOrganizationId);
  assert.equal(organization.name, `Example Coaching Academy #${customer.id}`);
  assert.equal(organization.legal_name, "Example Coaching Academy");
  assert.equal(organization.status, "active");

  const storedLicense = d1.raw.prepare(
    "SELECT customer_id, seats, status, offline_validity_days FROM licenses WHERE id = ?"
  ).get(licenseId);
  assert.equal(storedLicense.customer_id, customer.id);
  assert.equal(storedLicense.seats, 1);
  assert.equal(storedLicense.status, "ACTIVE");
  assert.equal(storedLicense.offline_validity_days, 14);
  assert.equal(d1.raw.prepare(
    "SELECT value_text FROM license_entitlements WHERE license_id = ? AND entitlement_key = 'company.binding'"
  ).get(licenseId).value_text, "PA001");

  d1.raw.prepare("UPDATE licenses SET registered_email = ? WHERE id = ?")
    .run("verified-contact@example.test", licenseId);
  d1.raw.prepare(
    `INSERT INTO license_activations
     (license_id, installation_id, activation_identifier, status)
     VALUES (?, 'installation-private-1234', 'activation-private-test', 'active')`
  ).run(licenseId);
  const unauthenticatedRegistrations = await callApi(d1, "admin/license-registrations");
  assert.equal(unauthenticatedRegistrations.status, 403);
  const registrations = await callApi(
    d1,
    "admin/license-registrations?q=Example%20Coaching%20Academy&activation=active",
    { token: adminToken },
  );
  assert.equal(registrations.status, 200);
  assert.equal(registrations.data.total, 1);
  const monitoredRegistration = registrations.data.registrations[0];
  assert.equal(monitoredRegistration.organization_name, "Example Coaching Academy");
  assert.equal(monitoredRegistration.contact_email_masked, "l***y@example.test");
  assert.equal(monitoredRegistration.registered_email_masked, "v***t@example.test");
  assert.equal(monitoredRegistration.active_activation_count, 1);
  assert.equal(JSON.stringify(registrations.data).includes("license-only@example.test"), false);
  d1.raw.prepare(
    "UPDATE organization_members SET status = 'inactive' WHERE account_type = 'customer' AND account_id = ?"
  ).run(customer.id);
  const customerRegistrations = await callApi(
    d1,
    `admin/license-registrations?customer_id=${customer.id}&page_size=100`,
    { token: adminToken },
  );
  d1.raw.prepare(
    "UPDATE organization_members SET status = 'active' WHERE account_type = 'customer' AND account_id = ?"
  ).run(customer.id);
  assert.equal(customerRegistrations.status, 200);
  assert.equal(customerRegistrations.data.total, 1);
  assert.equal(customerRegistrations.data.registrations[0].license_id, licenseId);
  assert.equal(customerRegistrations.data.registrations[0].organization_name, "Example Coaching Academy");
  assert.equal(customerRegistrations.data.metrics.total_licenses, 1);
  const otherCustomer = await callApi(
    d1,
    "admin/license-registrations?customer_id=999999&page_size=100",
    { token: adminToken },
  );
  assert.equal(otherCustomer.status, 200);
  assert.equal(otherCustomer.data.total, 0);
  const invalidCustomerFilter = await callApi(
    d1,
    "admin/license-registrations?customer_id=not-a-customer",
    { token: adminToken },
  );
  assert.equal(invalidCustomerFilter.status, 400);
  const registrationDetails = await callApi(
    d1,
    `admin/license-registrations/${licenseId}`,
    { token: adminToken },
  );
  assert.equal(registrationDetails.status, 200);
  assert.equal(registrationDetails.data.registration.contact_name, "License Contact");
  assert.equal(registrationDetails.data.registration.account_email, "license-only@example.test");
  assert.equal(registrationDetails.data.registration.registered_email, "verified-contact@example.test");
  assert.equal(d1.raw.prepare(
    "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'ADMIN_LICENSE_REGISTRATION_VIEWED' AND resource_id = ?"
  ).get(String(licenseId)).count, 1);
  const invalidRegistrationFilter = await callApi(d1, "admin/license-registrations?status=UNKNOWN", {
    token: adminToken,
  });
  assert.equal(invalidRegistrationFilter.status, 400);
  const overlongRegistrationSearch = await callApi(
    d1,
    `admin/license-registrations?q=${"x".repeat(101)}`,
    { token: adminToken },
  );
  assert.equal(overlongRegistrationSearch.status, 400);

  const licenseList = await callApi(d1, "licenses", { token: adminToken });
  const listedLicense = licenseList.data.licenses.find((license) => license.id === licenseId);
  assert.equal(listedLicense.license_key, null);
  assert.equal(listedLicense.serial_number, issued.data.license.serial_number);
  const licenseDetail = await callApi(d1, `licenses/${licenseId}`, { token: adminToken });
  assert.equal(licenseDetail.data.license.license_key, null);
  const licenseAudit = d1.raw.prepare(
    "SELECT new_value FROM audit_logs WHERE action = 'LICENSE_CREATED' AND resource_id = ?"
  ).get(String(licenseId));
  assert.ok(licenseAudit);
  assert.equal(licenseAudit.new_value.includes(issued.data.license.license_key), false);

  const duplicate = await callApi(d1, "licenses", { method: "POST", token: adminToken, body });
  assert.equal(duplicate.status, 409);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM licenses").get().count, 2);

  const customerLogin = await callApi(d1, "login", {
    method: "POST",
    body: { type: "customer", email: "license-only@example.test", password: "Not-the-random-password-2026!" },
  });
  assert.equal(customerLogin.status, 401);
});

test("license code inventory migration upgrades existing license and organization tables", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE products (id INTEGER PRIMARY KEY);
    CREATE TABLE product_editions (id INTEGER PRIMARY KEY);
    CREATE TABLE people (id INTEGER PRIMARY KEY);
    CREATE TABLE licenses (id INTEGER PRIMARY KEY, license_key TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO licenses (id, license_key) VALUES (7, 'legacy-key')").run();
  db.exec(fs.readFileSync(new URL("../migrations/0019_license_code_inventory.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO products (id) VALUES (1)").run();
  db.prepare("INSERT INTO product_editions (id) VALUES (1)").run();
  db.prepare(
    `INSERT INTO license_code_inventory
     (batch_id, serial_number, activation_key_hash, product_id, edition_id, starts_at,
      license_model, status, contact_email, claimed_at)
     VALUES ('legacy-batch', '123456789', 'legacy-hash', 1, 1, '2026-01-01',
             'on_premise_subscription', 'claimed', 'claimed@example.test', '2026-02-01 10:00:00')`
  ).run();
  db.exec(fs.readFileSync(new URL("../migrations/0020_license_code_delivery.sql", import.meta.url), "utf8"));

  const migrated = db.prepare("SELECT serial_number, offline_validity_days FROM licenses WHERE id = 7").get();
  assert.equal(migrated.serial_number, "SMR-LIC-00000007");
  assert.equal(migrated.offline_validity_days, 7);
  assert.equal(db.prepare(
    "SELECT COUNT(*) AS count FROM pragma_table_info('organizations') WHERE name IN ('address', 'city', 'state', 'pincode', 'tax_id', 'website')"
  ).get().count, 6);
  assert.ok(db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'license_code_inventory'"
  ).get());
  const deliveryStatusColumn = db.prepare(
    "SELECT dflt_value FROM pragma_table_info('license_code_inventory') WHERE name = 'delivery_status'"
  ).get();
  assert.equal(deliveryStatusColumn.dflt_value, "'not_issued'");
  assert.ok(db.prepare(
    "SELECT name FROM pragma_table_info('license_code_inventory') WHERE name = 'issued_by_person_id'"
  ).get());
  const existingClaim = db.prepare(
    `SELECT delivery_status, issued_to_email, delivery_channel, issued_at
     FROM license_code_inventory WHERE serial_number = '123456789'`
  ).get();
  assert.equal(existingClaim.delivery_status, "issued");
  assert.equal(existingClaim.issued_to_email, "claimed@example.test");
  assert.equal(existingClaim.delivery_channel, "activation");
  assert.equal(existingClaim.issued_at, "2026-02-01 10:00:00");
});

test("license account transfer migration backfills registered email and adds verification challenges", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, email TEXT);
    CREATE TABLE licenses (id INTEGER PRIMARY KEY, customer_id INTEGER, product_id INTEGER);
    CREATE TABLE license_code_inventory (license_id INTEGER, contact_email TEXT, issued_to_email TEXT);
  `);
  db.prepare("INSERT INTO customers (id, email) VALUES (1, 'customer@example.test')").run();
  db.prepare("INSERT INTO licenses (id, customer_id) VALUES (7, 1)").run();
  db.prepare(
    "INSERT INTO license_code_inventory (license_id, contact_email, issued_to_email) VALUES (7, 'registered@example.test', NULL)"
  ).run();
  db.exec(fs.readFileSync(new URL("../migrations/0021_license_account_transfers.sql", import.meta.url), "utf8"));

  assert.equal(db.prepare("SELECT registered_email FROM licenses WHERE id = 7").get().registered_email, "registered@example.test");
  assert.ok(db.prepare(
    "SELECT name FROM pragma_table_info('license_email_verifications') WHERE name = 'current_email_verified_at'"
  ).get());
});

test("license transfer policy migration adds cooldown state and sets the offline lease baseline", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE licenses (id INTEGER PRIMARY KEY, offline_validity_days INTEGER NOT NULL);
    CREATE TABLE license_code_inventory (
      id INTEGER PRIMARY KEY,
      offline_validity_days INTEGER NOT NULL
    );
    INSERT INTO licenses (id, offline_validity_days) VALUES (1, 7), (2, 90);
    INSERT INTO license_code_inventory (id, offline_validity_days) VALUES (1, 90), (2, 14);
  `);
  db.exec(fs.readFileSync(new URL("../migrations/0022_license_transfer_policy.sql", import.meta.url), "utf8"));

  assert.ok(db.prepare(
    "SELECT name FROM pragma_table_info('licenses') WHERE name = 'last_self_service_transfer_at'"
  ).get());
  assert.ok(db.prepare(
    "SELECT name FROM pragma_table_info('licenses') WHERE name = 'last_self_service_transfer_id'"
  ).get());
  assert.deepEqual(db.prepare("SELECT offline_validity_days FROM licenses ORDER BY id").all()
    .map((row) => row.offline_validity_days), [14, 14]);
  assert.deepEqual(db.prepare("SELECT offline_validity_days FROM license_code_inventory ORDER BY id").all()
    .map((row) => row.offline_validity_days), [14, 14]);
});

test("encrypted license code migration adds nullable ciphertext storage", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE license_code_inventory (id INTEGER PRIMARY KEY, activation_key_hash TEXT NOT NULL)");
  db.exec(fs.readFileSync(new URL("../migrations/0023_license_code_encrypted_keys.sql", import.meta.url), "utf8"));
  const column = db.prepare(
    "SELECT type, \"notnull\" AS notnull_flag FROM pragma_table_info('license_code_inventory') WHERE name = 'activation_key_ciphertext'"
  ).get();
  assert.equal(column.type, "TEXT");
  assert.equal(column.notnull_flag, 0);
});

test("pre-generated license codes retain hash and encrypted key, claim once, and issue installation-bound 14-day artifacts", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-license-code-batch";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();
  const product = d1.raw.prepare("SELECT id FROM products WHERE slug = 'prathamone-eduos'").get();
  const edition = d1.raw.prepare(
    "SELECT id FROM product_editions WHERE product_id = ? AND code = 'coaching-institute'"
  ).get(product.id);
  const createdBatch = await callApi(d1, "licenses/batches", {
    method: "POST",
    token: adminToken,
    body: {
      count: 2,
      seats: 1,
      product_id: product.id,
      edition_id: edition.id,
      license_model: "on_premise_subscription",
      start_date: "2026-11-15",
      expiry_date: "2027-11-15",
    },
  });
  assert.equal(createdBatch.status, 201);
  const invalidDateBatch = await callApi(d1, "licenses/batches", {
    method: "POST",
    token: adminToken,
    body: {
      count: 1,
      product_id: product.id,
      edition_id: edition.id,
      license_model: "on_premise_subscription",
      start_date: "2026-02-31",
      expiry_date: "2027-11-15",
    },
  });
  assert.equal(invalidDateBatch.status, 400);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM license_code_inventory").get().count, 2);
  assert.equal(createdBatch.data.codes.length, 2);
  const code = createdBatch.data.codes[0];
  assert.match(code.serial_number, /^\d{9}$/);
  assert.match(code.activation_key, /^[A-Z0-9]{16}$/);
  const storedCode = d1.raw.prepare(
    "SELECT activation_key_hash, status, offline_validity_days FROM license_code_inventory WHERE serial_number = ?"
  ).get(code.serial_number);
  assert.match(storedCode.activation_key_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(storedCode.activation_key_hash, code.activation_key);
  assert.equal(storedCode.status, "available");
  assert.equal(storedCode.offline_validity_days, 14);
  const batchList = await callApi(d1, "licenses/batches", { token: adminToken });
  assert.equal(batchList.status, 200);
  assert.equal(batchList.data.batches[0].available, 2);
  assert.equal(JSON.stringify(batchList.data).includes(code.activation_key), false);
  assert.equal(d1.raw.prepare("PRAGMA table_info(license_code_inventory)").all()
    .some((column) => column.name === "activation_key"), false);

  const signerPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", signerPair.publicKey));
  const publicKey = Buffer.from(publicKeyBytes).toString("base64url");
  const signer = {
    async fetch(request) {
      const requestBody = await request.json();
      const signature = await crypto.subtle.sign(
        { name: "Ed25519" },
        signerPair.privateKey,
        Buffer.from(requestBody.payload, "base64url"),
      );
      return Response.json({
        key_id: requestBody.key_id,
        signature: Buffer.from(signature).toString("base64url"),
      });
    },
  };
  const refreshPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const refreshPublicKey = Buffer.from(await crypto.subtle.exportKey("raw", refreshPair.publicKey)).toString("base64url");
  const bindings = {
    LICENSE_SIGNER: signer,
    LICENSE_ACTIVE_KEY_ID: "test-license-key",
    LICENSE_SIGNING_PUBLIC_KEYS: JSON.stringify({ "test-license-key": publicKey }),
  };
  const activation = {
    serial_number: code.serial_number,
    activation_key: code.activation_key,
    product_code: "prathamone-eduos",
    company_binding: "ACADEMY-NEW-01",
    installation_id: "8a36e7ab-20de-4e31-bf83-87bb4dcd7560",
    activation_identifier: "4c765a67-9e03-4e9d-9f38-211366dcf7de",
    refresh_public_key: refreshPublicKey,
    registration: {
      institution_name: "New Coaching Academy",
      contact_name: "Priya Sharma",
      contact_email: "priya@newacademy.example",
      phone: "+91-9876543210",
      address: "12 Academy Road",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411001",
      tax_id: "TAX-123",
    },
  };
  const invalidSerial = await callApi(d1, "license/activate", {
    method: "POST",
    body: { ...activation, serial_number: `X${code.serial_number}` },
    bindings,
  });
  assert.equal(invalidSerial.status, 400);
  const invalidKeyFormat = await callApi(d1, "license/activate", {
    method: "POST",
    body: { ...activation, activation_key: `${code.activation_key.slice(0, 15)}!` },
    bindings,
  });
  assert.equal(invalidKeyFormat.status, 400);
  const invalidKey = await callApi(d1, "license/activate", {
    method: "POST",
    body: { ...activation, activation_key: "ACT-000000000000000000000000000000000000000000000000" },
    bindings,
  });
  assert.equal(invalidKey.status, 404);
  assert.equal(d1.raw.prepare("SELECT status FROM license_code_inventory WHERE serial_number = ?")
    .get(code.serial_number).status, "available");

  const issued = await callApi(d1, "license/activate", { method: "POST", body: activation, bindings });
  assert.equal(issued.status, 201);
  const payload = JSON.parse(Buffer.from(issued.data.artifact.payload, "base64url").toString("utf8"));
  assert.equal(payload.serial_number, code.serial_number);
  assert.equal(payload.offline_validity_days, 14);
  assert.equal(payload.company_binding, activation.company_binding);
  assert.equal(payload.installation_id, activation.installation_id);
  const claimed = d1.raw.prepare(
    `SELECT c.status, c.license_id, c.delivery_status, c.issued_to_name,
            c.issued_to_organization, c.issued_to_email, c.delivery_channel, c.issued_at,
            l.serial_number, l.offline_validity_days, o.address, o.tax_id
     FROM license_code_inventory c
     JOIN licenses l ON l.id = c.license_id
     JOIN customers cu ON cu.id = l.customer_id
     JOIN organization_members om ON om.account_type = 'customer' AND om.account_id = cu.id
     JOIN organizations o ON o.id = om.organization_id
     WHERE c.serial_number = ?`
  ).get(code.serial_number);
  assert.equal(claimed.status, "claimed");
  assert.equal(claimed.delivery_status, "issued");
  assert.equal(claimed.issued_to_name, "Priya Sharma");
  assert.equal(claimed.issued_to_organization, "New Coaching Academy");
  assert.equal(claimed.issued_to_email, "priya@newacademy.example");
  assert.equal(claimed.delivery_channel, "activation");
  assert.ok(claimed.issued_at);
  const claimAudit = d1.raw.prepare(
    "SELECT new_value FROM audit_logs WHERE action = 'LICENSE_CODE_CLAIMED' AND resource_id = ?"
  ).get(code.serial_number);
  assert.equal(JSON.parse(claimAudit.new_value).delivery_status, "issued");
  assert.equal(JSON.parse(claimAudit.new_value).issued_to_name, "Priya Sharma");
  assert.equal(claimed.serial_number, code.serial_number);
  assert.equal(claimed.offline_validity_days, 14);
  assert.equal(claimed.address, "12 Academy Road");
  assert.equal(claimed.tax_id, "TAX-123");

  const secondCode = createdBatch.data.codes[1];
  const secondInstallation = {
    ...activation,
    serial_number: secondCode.serial_number,
    activation_key: secondCode.activation_key,
    installation_id: "22111111-2222-4333-8444-555555555555",
    activation_identifier: "22111111-2222-4333-8444-666666666666",
  };
  const secondLicense = await callApi(d1, "license/activate", {
    method: "POST",
    body: secondInstallation,
    bindings,
  });
  assert.equal(secondLicense.status, 201);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM customers WHERE email = ?")
    .get("priya@newacademy.example").count, 1);
  assert.equal(d1.raw.prepare(
    "SELECT COUNT(*) AS count FROM organization_members WHERE account_type = 'customer' AND account_id = (SELECT id FROM customers WHERE email = ?)"
  ).get("priya@newacademy.example").count, 1);

  const repeated = await callApi(d1, "license/activate", { method: "POST", body: activation, bindings });
  assert.equal(repeated.status, 201);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM license_code_inventory WHERE status = 'claimed'").get().count, 2);
  const otherInstallation = await callApi(d1, "license/activate", {
    method: "POST",
    body: { ...activation, installation_id: "12111111-2222-4333-8444-555555555555" },
    bindings,
  });
  assert.equal(otherInstallation.status, 409);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM licenses WHERE serial_number = ?").get(code.serial_number).count, 1);

  const managementTimestamp = Date.now();
  const managementNonce = crypto.randomUUID();
  const managementMessage = [
    "license-management-v1",
    "deactivate",
    activation.product_code,
    activation.company_binding,
    activation.installation_id,
    activation.activation_identifier,
    managementTimestamp,
    managementNonce,
  ].join("\n");
  const managementSignature = Buffer.from(await crypto.subtle.sign(
    { name: "Ed25519" },
    refreshPair.privateKey,
    Buffer.from(managementMessage),
  )).toString("base64url");
  const deactivated = await callApi(d1, "license/manage", {
    method: "POST",
    body: {
      action: "deactivate",
      product_code: activation.product_code,
      company_binding: activation.company_binding,
      installation_id: activation.installation_id,
      activation_identifier: activation.activation_identifier,
      timestamp: managementTimestamp,
      nonce: managementNonce,
      signature: managementSignature,
    },
    bindings,
  });
  assert.equal(deactivated.status, 200);
  assert.ok(d1.raw.prepare(
    "SELECT last_self_service_transfer_at FROM licenses WHERE serial_number = ?",
  ).get(code.serial_number).last_self_service_transfer_at);
  assert.equal(d1.raw.prepare(
    "SELECT status FROM license_activations WHERE license_id = (SELECT id FROM licenses WHERE serial_number = ?) AND activation_identifier = ?"
  ).get(code.serial_number, activation.activation_identifier).status, "revoked");
  const replayedDeactivation = await callApi(d1, "license/manage", {
    method: "POST",
    body: {
      action: "deactivate",
      product_code: activation.product_code,
      company_binding: activation.company_binding,
      installation_id: activation.installation_id,
      activation_identifier: activation.activation_identifier,
      timestamp: managementTimestamp,
      nonce: managementNonce,
      signature: managementSignature,
    },
    bindings,
  });
  assert.equal(replayedDeactivation.status, 409);

  const originalFetch = globalThis.fetch;
  const emailMessages = [];
  globalThis.fetch = async (_url, options) => {
    const message = JSON.parse(options.body);
    emailMessages.push(message);
    return Response.json({ success: true, result: { delivered: message.to } });
  };
  try {
    const emailBindings = {
      ...bindings,
      LICENSE_EMAIL_CODE_SECRET: "license-email-verification-secret-for-tests",
      CLOUDFLARE_EMAIL_ACCOUNT_ID: "test-account",
      CLOUDFLARE_EMAIL_API_TOKEN: "test-token",
      LICENSE_EMAIL_FROM: "licenses@prathamone.example",
    };
    const invalidEmailPurpose = await callApi(d1, "license/email/request", {
      method: "POST",
      body: {
        purpose: "unknown",
        email: "priya@newacademy.example",
        product_code: activation.product_code,
        company_binding: activation.company_binding,
      },
      bindings: emailBindings,
    });
    assert.equal(invalidEmailPurpose.status, 400);
    const emailRequest = await callApi(d1, "license/email/request", {
      method: "POST",
      body: {
        purpose: "activation",
        email: "priya@newacademy.example",
        product_code: activation.product_code,
        company_binding: activation.company_binding,
      },
      bindings: emailBindings,
    });
    assert.equal(emailRequest.status, 202);
    const activationCode = emailMessages.at(-1).text.match(/\b\d{8}\b/)[0];
    const invalidEmailCode = await callApi(d1, "license/email/verify", {
      method: "POST",
      body: {
        challenge_id: emailRequest.data.challenge_id,
        code: activationCode === "00000000" ? "00000001" : "00000000",
      },
      bindings: emailBindings,
    });
    assert.equal(invalidEmailCode.status, 400);
    const emailVerification = await callApi(d1, "license/email/verify", {
      method: "POST",
      body: { challenge_id: emailRequest.data.challenge_id, code: activationCode },
      bindings: emailBindings,
    });
    assert.equal(emailVerification.status, 200);
    const selectedLicense = emailVerification.data.licenses.find((license) => license.serial_number === code.serial_number);
    assert.ok(selectedLicense);
    const emailActivation = await callApi(d1, "license/activate", {
      method: "POST",
      body: {
        email: "priya@newacademy.example",
        email_challenge_id: emailRequest.data.challenge_id,
        license_id: selectedLicense.license_id,
        product_code: activation.product_code,
        company_binding: activation.company_binding,
        installation_id: "12111111-2222-4333-8444-555555555555",
        activation_identifier: "12111111-2222-4333-8444-666666666666",
        refresh_public_key: refreshPublicKey,
      },
      bindings: emailBindings,
    });
    assert.equal(emailActivation.status, 201);
    assert.ok(d1.raw.prepare(
      "SELECT last_self_service_transfer_at FROM licenses WHERE serial_number = ?",
    ).get(code.serial_number).last_self_service_transfer_at);
    assert.equal(d1.raw.prepare(
      `SELECT license_id FROM license_activations
       WHERE installation_id = '12111111-2222-4333-8444-555555555555'
         AND activation_identifier = '12111111-2222-4333-8444-666666666666'`,
    ).get().license_id, selectedLicense.license_id);
    const replayedEmailActivation = await callApi(d1, "license/activate", {
      method: "POST",
      body: {
        email: "priya@newacademy.example",
        email_challenge_id: emailRequest.data.challenge_id,
        license_id: selectedLicense.license_id,
        product_code: activation.product_code,
        company_binding: activation.company_binding,
        installation_id: "22111111-2222-4333-8444-555555555555",
        activation_identifier: "22111111-2222-4333-8444-666666666666",
        refresh_public_key: refreshPublicKey,
      },
      bindings: emailBindings,
    });
    assert.equal(replayedEmailActivation.status, 403);

    const transferTimestamp = Date.now();
    const transferNonce = crypto.randomUUID();
    const transferInstallationId = "12111111-2222-4333-8444-555555555555";
    const transferActivationId = "12111111-2222-4333-8444-666666666666";
    const transferSignature = Buffer.from(await crypto.subtle.sign(
      { name: "Ed25519" },
      refreshPair.privateKey,
      Buffer.from([
        "license-management-v1",
        "deactivate",
        activation.product_code,
        activation.company_binding,
        transferInstallationId,
        transferActivationId,
        transferTimestamp,
        transferNonce,
      ].join("\n")),
    )).toString("base64url");
    const blockedTransfer = await callApi(d1, "license/manage", {
      method: "POST",
      body: {
        action: "deactivate",
        product_code: activation.product_code,
        company_binding: activation.company_binding,
        installation_id: transferInstallationId,
        activation_identifier: transferActivationId,
        timestamp: transferTimestamp,
        nonce: transferNonce,
        signature: transferSignature,
      },
      bindings,
    });
    assert.equal(blockedTransfer.status, 429);
    assert.match(blockedTransfer.data.error, /temporarily unavailable/i);
    assert.equal(d1.raw.prepare(
      "SELECT status FROM license_activations WHERE license_id = ? AND activation_identifier = ?"
    ).get(selectedLicense.license_id, transferActivationId).status, "active");

    const changeRequest = await callApi(d1, "license/email/request", {
      method: "POST",
      body: {
        purpose: "email_change",
        email: "priya@newacademy.example",
        target_email: "renewed@newacademy.example",
        serial_number: code.serial_number,
        product_code: activation.product_code,
        company_binding: activation.company_binding,
      },
      bindings: emailBindings,
    });
    assert.equal(changeRequest.status, 202);
    const oldEmailCode = emailMessages.at(-1).text.match(/\b\d{8}\b/)[0];
    const oldEmailVerification = await callApi(d1, "license/email/verify", {
      method: "POST",
      body: { challenge_id: changeRequest.data.challenge_id, code: oldEmailCode },
      bindings: emailBindings,
    });
    assert.equal(oldEmailVerification.data.stage, "target_email");
    const newEmailCode = emailMessages.at(-1).text.match(/\b\d{8}\b/)[0];
    const newEmailVerification = await callApi(d1, "license/email/verify", {
      method: "POST",
      body: { challenge_id: changeRequest.data.challenge_id, code: newEmailCode },
      bindings: emailBindings,
    });
    assert.equal(newEmailVerification.status, 200);
    assert.equal(newEmailVerification.data.registered_email, "renewed@newacademy.example");
    assert.equal(d1.raw.prepare("SELECT registered_email FROM licenses WHERE serial_number = ?")
      .get(code.serial_number).registered_email, "renewed@newacademy.example");
    assert.equal(d1.raw.prepare(
      "SELECT event_type FROM license_events WHERE license_id = ? ORDER BY id DESC LIMIT 1"
    ).get(selectedLicense.license_id).event_type, "LICENSE_EMAIL_CHANGED");
    assert.equal(d1.raw.prepare("SELECT registered_email FROM licenses WHERE serial_number = ?")
      .get(secondCode.serial_number).registered_email, "priya@newacademy.example");

    for (let index = 0; index < 4; index += 1) {
      const request = await callApi(d1, "license/email/request", {
        method: "POST",
        headers: { "CF-Connecting-IP": `198.51.100.${index + 1}` },
        body: {
          purpose: "activation",
          email: "renewed@newacademy.example",
          product_code: activation.product_code,
          company_binding: activation.company_binding,
        },
        bindings: emailBindings,
      });
      assert.equal(request.status, 202);
    }
    const addressRateLimited = await callApi(d1, "license/email/request", {
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.99" },
      body: {
        purpose: "activation",
        email: "renewed@newacademy.example",
        product_code: activation.product_code,
        company_binding: activation.company_binding,
      },
      bindings: emailBindings,
    });
    assert.equal(addressRateLimited.status, 429);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("single-code reveal requires password confirmation, audits safely, and rejects legacy or claimed codes", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-license-code-reveal";
  const adminPassword = "reveal-test-password";
  const passwordHash = createHash("sha256")
    .update(`${adminPassword}smritisys-salt-v1`)
    .digest("hex");
  d1.prepare("UPDATE users SET password_hash = ? WHERE id = 201").bind(passwordHash).run();
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();
  const product = d1.raw.prepare("SELECT id FROM products WHERE slug = 'prathamone-eduos'").get();
  const edition = d1.raw.prepare(
    "SELECT id FROM product_editions WHERE product_id = ? AND code = 'coaching-institute'"
  ).get(product.id);
  const created = await callApi(d1, "licenses/batches", {
    method: "POST",
    token: adminToken,
    body: {
      count: 2,
      product_id: product.id,
      edition_id: edition.id,
      license_model: "on_premise_subscription",
      start_date: "2026-11-16",
      expiry_date: "2027-11-16",
    },
  });
  assert.equal(created.status, 201);

  const code = created.data.codes[0];
  const inventory = await callApi(d1, `licenses/batches/${created.data.batch_id}/codes`, { token: adminToken });
  assert.equal(inventory.status, 200);
  assert.equal(inventory.data.codes[0].activation_key_recoverable, true);
  assert.equal(JSON.stringify(inventory.data).includes("activation_key_ciphertext"), false);
  assert.equal(JSON.stringify(inventory.data).includes("activation_key_hash"), false);
  assert.equal(JSON.stringify(inventory.data).includes(code.activation_key), false);
  const stored = d1.raw.prepare(
    "SELECT activation_key_hash, activation_key_ciphertext FROM license_code_inventory WHERE serial_number = ?"
  ).get(code.serial_number);
  assert.match(stored.activation_key_hash, /^[a-f0-9]{64}$/);
  assert.match(stored.activation_key_ciphertext, /^v1\./);
  assert.notEqual(stored.activation_key_ciphertext, code.activation_key);

  const revealPath = `licenses/batches/${created.data.batch_id}/codes/${code.serial_number}/reveal`;
  const unauthorized = await callApi(d1, revealPath, {
    method: "POST",
    body: { password: adminPassword },
  });
  assert.equal(unauthorized.status, 403);
  assert.equal(unauthorized.headers.get("cache-control"), "no-store");
  const rejected = await callApi(d1, revealPath, {
    method: "POST",
    token: adminToken,
    body: { password: "incorrect-password" },
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("cache-control"), "no-store");
  assert.equal(rejected.data.activation_key, undefined);
  const revealed = await callApi(d1, revealPath, {
    method: "POST",
    token: adminToken,
    body: { password: adminPassword },
  });
  assert.equal(revealed.status, 200);
  assert.equal(revealed.data.activation_key, code.activation_key);
  assert.equal(revealed.headers.get("cache-control"), "no-store");

  const audit = d1.raw.prepare(
    "SELECT resource_id, new_value FROM audit_logs WHERE action = 'LICENSE_CODE_REVEALED'"
  ).get();
  assert.equal(audit.resource_id, code.serial_number);
  assert.equal(audit.new_value, JSON.stringify({ batch_id: created.data.batch_id }));
  assert.equal(JSON.stringify(audit).includes(code.activation_key), false);

  const legacyCode = created.data.codes[1];
  d1.raw.prepare(
    "UPDATE license_code_inventory SET activation_key_ciphertext = NULL WHERE serial_number = ?"
  ).run(legacyCode.serial_number);
  const legacyReveal = await callApi(
    d1,
    `licenses/batches/${created.data.batch_id}/codes/${legacyCode.serial_number}/reveal`,
    { method: "POST", token: adminToken, body: { password: adminPassword } },
  );
  assert.equal(legacyReveal.status, 409);

  const restorePath = `licenses/batches/${created.data.batch_id}/codes/${legacyCode.serial_number}/restore`;
  const unauthorizedRestore = await callApi(d1, restorePath, {
    method: "POST",
    body: { activation_key: legacyCode.activation_key, password: adminPassword },
  });
  assert.equal(unauthorizedRestore.status, 403);
  assert.equal(unauthorizedRestore.headers.get("cache-control"), "no-store");
  const wrongPasswordRestore = await callApi(d1, restorePath, {
    method: "POST",
    token: adminToken,
    body: { activation_key: legacyCode.activation_key, password: "incorrect-password" },
  });
  assert.equal(wrongPasswordRestore.status, 403);
  const unavailableStorageRestore = await callApi(d1, restorePath, {
    method: "POST",
    token: adminToken,
    body: { activation_key: legacyCode.activation_key, password: adminPassword },
    bindings: { LICENSE_CODE_ENCRYPTION_KEY: "" },
  });
  assert.equal(unavailableStorageRestore.status, 503);
  const mismatchedKeyRestore = await callApi(d1, restorePath, {
    method: "POST",
    token: adminToken,
    body: { activation_key: code.activation_key, password: adminPassword },
  });
  assert.equal(mismatchedKeyRestore.status, 400);
  assert.equal(mismatchedKeyRestore.data.ok, false);
  assert.equal(
    d1.raw.prepare("SELECT activation_key_ciphertext FROM license_code_inventory WHERE serial_number = ?")
      .get(legacyCode.serial_number).activation_key_ciphertext,
    null,
  );

  const restored = await callApi(d1, restorePath, {
    method: "POST",
    token: adminToken,
    body: { activation_key: legacyCode.activation_key, password: adminPassword },
  });
  assert.equal(restored.status, 200);
  assert.equal(JSON.stringify(restored.data).includes(legacyCode.activation_key), false);
  assert.equal(restored.headers.get("cache-control"), "no-store");
  const restoredStored = d1.raw.prepare(
    "SELECT activation_key_hash, activation_key_ciphertext, status FROM license_code_inventory WHERE serial_number = ?"
  ).get(legacyCode.serial_number);
  assert.equal(restoredStored.activation_key_hash, createHash("sha256").update(legacyCode.activation_key).digest("hex"));
  assert.match(restoredStored.activation_key_ciphertext, /^v1\./);
  assert.equal(restoredStored.status, "available");
  const restoredInventory = await callApi(
    d1,
    `licenses/batches/${created.data.batch_id}/codes`,
    { token: adminToken },
  );
  assert.equal(restoredInventory.data.codes.find((item) => item.serial_number === legacyCode.serial_number).activation_key_recoverable, true);

  const duplicateRestore = await callApi(d1, restorePath, {
    method: "POST",
    token: adminToken,
    body: { activation_key: legacyCode.activation_key, password: adminPassword },
  });
  assert.equal(duplicateRestore.status, 409);
  const restoreAudit = d1.raw.prepare(
    "SELECT resource_id, new_value FROM audit_logs WHERE action = 'LICENSE_CODE_KEY_RESTORED'"
  ).get();
  assert.equal(restoreAudit.resource_id, legacyCode.serial_number);
  assert.equal(restoreAudit.new_value, JSON.stringify({ batch_id: created.data.batch_id }));
  assert.equal(JSON.stringify(restoreAudit).includes(legacyCode.activation_key), false);

  d1.raw.prepare(
    "UPDATE license_code_inventory SET status = 'claimed', activation_key_ciphertext = NULL WHERE serial_number = ?"
  ).run(code.serial_number);
  const claimedRestore = await callApi(d1, revealPath.replace(/\/reveal$/, "/restore"), {
    method: "POST",
    token: adminToken,
    headers: { "CF-Connecting-IP": "192.0.2.20" },
    body: { activation_key: code.activation_key, password: adminPassword },
  });
  assert.equal(claimedRestore.status, 409);
  const claimedReveal = await callApi(d1, revealPath, {
    method: "POST",
    token: adminToken,
    body: { password: adminPassword },
  });
  assert.equal(claimedReveal.status, 409);
  const finalAllowedAttempt = await callApi(d1, revealPath, {
    method: "POST",
    token: adminToken,
    body: { password: adminPassword },
  });
  assert.equal(finalAllowedAttempt.status, 409);
  const rateLimited = await callApi(d1, revealPath, {
    method: "POST",
    token: adminToken,
    body: { password: adminPassword },
  });
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.headers.get("cache-control"), "no-store");
});

test("license code batch generation fails closed when protected storage is not configured", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-license-code-no-encryption";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();
  const product = d1.raw.prepare("SELECT id FROM products WHERE slug = 'prathamone-eduos'").get();
  const edition = d1.raw.prepare(
    "SELECT id FROM product_editions WHERE product_id = ? AND code = 'coaching-institute'"
  ).get(product.id);
  const body = {
    count: 1,
    product_id: product.id,
    edition_id: edition.id,
    license_model: "on_premise_subscription",
    start_date: "2026-11-16",
  };
  for (const secret of ["", "not-base64"]) {
    const result = await callApi(d1, "licenses/batches", {
      method: "POST",
      token: adminToken,
      body,
      bindings: { LICENSE_CODE_ENCRYPTION_KEY: secret },
    });
    assert.equal(result.status, 503);
  }
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM license_code_inventory").get().count, 0);
});

test("license code batches allow 200 new-format codes and safely revoke unused batches", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-license-code-revoke";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();
  const product = d1.raw.prepare("SELECT id FROM products WHERE slug = 'prathamone-eduos'").get();
  const edition = d1.raw.prepare(
    "SELECT id FROM product_editions WHERE product_id = ? AND code = 'coaching-institute'"
  ).get(product.id);
  const body = {
    count: 200,
    seats: 1,
    product_id: product.id,
    edition_id: edition.id,
    license_model: "on_premise_perpetual",
    start_date: "2026-11-15",
    expiry_date: null,
  };
  const created = await callApi(d1, "licenses/batches", { method: "POST", token: adminToken, body });
  assert.equal(created.status, 201);
  assert.equal(created.data.codes.length, 200);
  assert.ok(created.data.codes.every((code) => /^\d{9}$/.test(code.serial_number)));
  assert.ok(created.data.codes.every((code) => /^[A-Z0-9]{16}$/.test(code.activation_key)));
  assert.equal(new Set(created.data.codes.map((code) => code.serial_number)).size, 200);
  assert.equal(new Set(created.data.codes.map((code) => code.activation_key)).size, 200);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM license_code_inventory").get().count, 200);

  const unauthorizedRevocation = await callApi(d1, `licenses/batches/${created.data.batch_id}/revoke`, {
    method: "POST",
  });
  assert.equal(unauthorizedRevocation.status, 403);
  const overLimit = await callApi(d1, "licenses/batches", {
    method: "POST",
    token: adminToken,
    body: { ...body, count: 201 },
  });
  assert.equal(overLimit.status, 400);
  assert.equal(d1.raw.prepare("SELECT COUNT(*) AS count FROM license_code_inventory").get().count, 200);

  const revoked = await callApi(d1, `licenses/batches/${created.data.batch_id}/revoke`, {
    method: "POST",
    token: adminToken,
  });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.data.status, "revoked");
  assert.equal(revoked.data.revoked, 200);
  assert.equal(d1.raw.prepare(
    "SELECT COUNT(*) AS count FROM license_code_inventory WHERE batch_id = ? AND status = 'revoked'"
  ).get(created.data.batch_id).count, 200);
  assert.equal(d1.raw.prepare(
    "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'LICENSE_CODE_BATCH_REVOKED' AND resource_id = ?"
  ).get(created.data.batch_id).count, 1);

  const repeatedRevocation = await callApi(d1, `licenses/batches/${created.data.batch_id}/revoke`, {
    method: "POST",
    token: adminToken,
  });
  assert.equal(repeatedRevocation.status, 200);
  assert.equal(repeatedRevocation.data.already_revoked, true);
  assert.equal(d1.raw.prepare(
    "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'LICENSE_CODE_BATCH_REVOKED' AND resource_id = ?"
  ).get(created.data.batch_id).count, 1);

  const guardedBatch = await callApi(d1, "licenses/batches", {
    method: "POST",
    token: adminToken,
    body: { ...body, count: 2 },
  });
  assert.equal(guardedBatch.status, 201);
  d1.raw.prepare(
    `UPDATE license_code_inventory SET status = 'claimed'
     WHERE id = (SELECT id FROM license_code_inventory WHERE batch_id = ? LIMIT 1)`
  ).run(guardedBatch.data.batch_id);
  const blockedRevocation = await callApi(d1, `licenses/batches/${guardedBatch.data.batch_id}/revoke`, {
    method: "POST",
    token: adminToken,
  });
  assert.equal(blockedRevocation.status, 409);
  assert.deepEqual(
    d1.raw.prepare(
      "SELECT status, COUNT(*) AS count FROM license_code_inventory WHERE batch_id = ? GROUP BY status ORDER BY status"
    ).all(guardedBatch.data.batch_id).map((row) => [row.status, row.count]),
    [["available", 1], ["claimed", 1]],
  );
});

test("license code delivery is authorized, atomic, audited, and independent from activation status", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-license-code-delivery";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();
  const product = d1.raw.prepare("SELECT id FROM products WHERE slug = 'prathamone-eduos'").get();
  const edition = d1.raw.prepare(
    "SELECT id FROM product_editions WHERE product_id = ? AND code = 'coaching-institute'"
  ).get(product.id);
  const created = await callApi(d1, "licenses/batches", {
    method: "POST",
    token: adminToken,
    body: {
      count: 2,
      product_id: product.id,
      edition_id: edition.id,
      license_model: "on_premise_subscription",
      start_date: "2026-11-15",
      expiry_date: "2027-11-15",
    },
  });
  assert.equal(created.status, 201);

  const unauthorizedList = await callApi(d1, `licenses/batches/${created.data.batch_id}/codes`);
  assert.equal(unauthorizedList.status, 403);
  const inventory = await callApi(d1, `licenses/batches/${created.data.batch_id}/codes`, { token: adminToken });
  assert.equal(inventory.status, 200);
  assert.equal(inventory.data.codes.length, 2);
  assert.ok(inventory.data.codes.every((row) => row.delivery_status === "not_issued"));
  assert.equal(JSON.stringify(inventory.data).includes("activation_key_hash"), false);
  assert.equal(JSON.stringify(inventory.data).includes(created.data.codes[0].activation_key), false);

  const firstSerial = created.data.codes[0].serial_number;
  const secondSerial = created.data.codes[1].serial_number;
  const delivery = {
    serial_numbers: [firstSerial],
    recipient_name: "Priya Sharma",
    recipient_organization: "New Coaching Academy",
    recipient_email: "PRIYA@NEWACADEMY.EXAMPLE",
    delivery_channel: "email",
    delivery_reference: "order-1042",
  };
  const invalidDelivery = await callApi(d1, `licenses/batches/${created.data.batch_id}/issue`, {
    method: "POST",
    token: adminToken,
    body: { ...delivery, recipient_email: "not-an-email" },
  });
  assert.equal(invalidDelivery.status, 400);

  const unauthorizedIssue = await callApi(d1, `licenses/batches/${created.data.batch_id}/issue`, {
    method: "POST",
    body: delivery,
  });
  assert.equal(unauthorizedIssue.status, 403);

  const issued = await callApi(d1, `licenses/batches/${created.data.batch_id}/issue`, {
    method: "POST",
    token: adminToken,
    body: delivery,
  });
  assert.equal(issued.status, 200);
  assert.equal(issued.data.issued_count, 1);
  const issuedRow = d1.raw.prepare(
    `SELECT status, delivery_status, issued_by_person_id, issued_to_name,
            issued_to_organization, issued_to_email, delivery_channel, delivery_reference, issued_at
     FROM license_code_inventory WHERE serial_number = ?`
  ).get(firstSerial);
  assert.equal(issuedRow.status, "available");
  assert.equal(issuedRow.delivery_status, "issued");
  assert.equal(issuedRow.issued_by_person_id, 201);
  assert.equal(issuedRow.issued_to_name, "Priya Sharma");
  assert.equal(issuedRow.issued_to_organization, "New Coaching Academy");
  assert.equal(issuedRow.issued_to_email, "priya@newacademy.example");
  assert.equal(issuedRow.delivery_channel, "email");
  assert.equal(issuedRow.delivery_reference, "order-1042");
  assert.ok(issuedRow.issued_at);

  const partialConflict = await callApi(d1, `licenses/batches/${created.data.batch_id}/issue`, {
    method: "POST",
    token: adminToken,
    body: { ...delivery, serial_numbers: [firstSerial, secondSerial] },
  });
  assert.equal(partialConflict.status, 409);
  assert.equal(d1.raw.prepare(
    "SELECT delivery_status FROM license_code_inventory WHERE serial_number = ?"
  ).get(secondSerial).delivery_status, "not_issued");
  assert.equal(d1.raw.prepare(
    "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'LICENSE_CODES_ISSUED' AND resource_id = ?"
  ).get(created.data.batch_id).count, 1);

  const batchList = await callApi(d1, "licenses/batches", { token: adminToken });
  assert.equal(batchList.data.batches[0].available, 2);
  assert.equal(batchList.data.batches[0].not_issued, 1);
  assert.equal(batchList.data.batches[0].issued, 1);
  const audit = d1.raw.prepare(
    "SELECT actor_person_id, new_value FROM audit_logs WHERE action = 'LICENSE_CODES_ISSUED' AND resource_id = ?"
  ).get(created.data.batch_id);
  assert.equal(audit.actor_person_id, 201);
  assert.deepEqual(JSON.parse(audit.new_value).serial_numbers, [firstSerial]);
});

test("partner allocation history is returned for secure printable notes without activation keys", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-partner-allocation-print";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();
  const product = d1.raw.prepare("SELECT id FROM products WHERE slug = 'prathamone-eduos'").get();
  const edition = d1.raw.prepare(
    "SELECT id FROM product_editions WHERE product_id = ? AND code = 'coaching-institute'"
  ).get(product.id);
  const batch = await callApi(d1, "licenses/batches", {
    method: "POST",
    token: adminToken,
    body: {
      count: 1,
      product_id: product.id,
      edition_id: edition.id,
      license_model: "on_premise_subscription",
      start_date: "2026-11-15",
      expiry_date: "2027-11-15",
    },
  });
  assert.equal(batch.status, 201);

  const allocation = await callApi(d1, `licenses/batches/${batch.data.batch_id}/issue`, {
    method: "POST",
    token: adminToken,
    body: {
      serial_numbers: [batch.data.codes[0].serial_number],
      recipient_name: "Partner Demo Contact",
      recipient_organization: "Partner Demo",
      recipient_email: "partner@example.com",
      delivery_channel: "in_person",
      delivery_reference: "dispatch-demo-1",
      partner_organization_id: 103,
    },
  });
  assert.equal(allocation.status, 200);

  const forbidden = await callApi(d1, `licenses/batches/${batch.data.batch_id}/codes`);
  assert.equal(forbidden.status, 403);
  const inventory = await callApi(d1, `licenses/batches/${batch.data.batch_id}/codes`, { token: adminToken });
  assert.equal(inventory.status, 200);
  assert.equal(inventory.data.allocations.length, 1);
  assert.equal(inventory.data.allocations[0].partner_name, "Channel Partner Pvt Ltd");
  assert.equal(inventory.data.allocations[0].partner_type, "reseller");
  assert.equal(inventory.data.allocations[0].recipient_email, "partner@example.com");
  assert.equal(inventory.data.allocations[0].delivery_reference, "dispatch-demo-1");
  assert.deepEqual(inventory.data.allocations[0].serial_numbers, [batch.data.codes[0].serial_number]);
  assert.equal(inventory.data.codes[0].product_name, "PrathamOne EduOS");
  assert.equal(inventory.data.codes[0].edition_name, "Coaching Institute Edition");
  assert.equal(JSON.stringify(inventory.data).includes(batch.data.codes[0].activation_key), false);
  assert.equal(JSON.stringify(inventory.data).includes("activation_key_hash"), false);
});

test("customer reactivation automatically approves an available seat and returns an idempotent signed artifact", async () => {
  const d1 = createD1Mock();
  const customerToken = "reactivation-auto-customer";
  const otherCustomerToken = "reactivation-auto-other-customer";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 101, 101, datetime('now', '+1 day'))"
  ).bind(customerToken).run();
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 102, 102, datetime('now', '+1 day'))"
  ).bind(otherCustomerToken).run();

  assert.equal((await callApi(d1, "license/reactivations")).status, 401);
  const options = await callApi(d1, "license/reactivations", { token: customerToken });
  assert.equal(options.status, 200);
  assert.ok(options.data.licenses.some((license) => license.license_id === 101));

  const installationId = "PRATHAM-789F-CEBC-0916-6315";
  const activationIdentifier = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const { refreshPublicKey, bindings } = await createLicenseSignerBindings("reactivation-test-key");
  const invalidHardwareId = await callApi(d1, "license/reactivations", {
    method: "POST",
    token: customerToken,
    body: {
      license_id: 101,
      installation_id: "PRATHAM-789F-CEBC-0916-631",
      activation_identifier: activationIdentifier,
      refresh_public_key: refreshPublicKey,
    },
  });
  assert.equal(invalidHardwareId.status, 400);

  const request = await callApi(d1, "license/reactivations", {
    method: "POST",
    token: customerToken,
    body: {
      license_id: 101,
      installation_id: installationId,
      activation_identifier: activationIdentifier,
      refresh_public_key: refreshPublicKey,
    },
  });
  assert.equal(request.status, 201);
  assert.equal(request.data.id, request.data.request_id);
  assert.equal(request.data.status, "approved");

  const duplicate = await callApi(d1, "license/reactivations", {
    method: "POST",
    token: customerToken,
    body: {
      license_id: 101,
      installation_id: installationId,
      activation_identifier: activationIdentifier,
      refresh_public_key: refreshPublicKey,
    },
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.id, request.data.request_id);
  assert.equal(duplicate.data.request_id, request.data.request_id);
  assert.equal((await callApi(d1, `license/reactivations/${request.data.request_id}`, {
    token: otherCustomerToken,
  })).status, 404);
  assert.equal((await callApi(d1, "license/activate", {
    method: "POST",
    token: otherCustomerToken,
    body: { reactivation_request_id: request.data.request_id },
    bindings,
  })).status, 404);

  const activation = await callApi(d1, "license/activate", {
    method: "POST",
    token: customerToken,
    body: { reactivation_request_id: request.data.request_id },
    bindings,
  });
  assert.equal(activation.status, 201);
  assert.ok(activation.data.artifact.signature);
  assert.equal(d1.raw.prepare(
    "SELECT status FROM license_reactivation_requests WHERE request_id = ?"
  ).get(request.data.request_id).status, "completed");
  assert.equal(d1.raw.prepare(
    "SELECT COUNT(*) AS count FROM license_activations WHERE license_id = 101 AND status = 'active'"
  ).get().count, 2);

  const retry = await callApi(d1, "license/activate", {
    method: "POST",
    token: customerToken,
    body: { reactivation_request_id: request.data.request_id },
    bindings,
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.artifact.document_id, activation.data.artifact.document_id);
  assert.equal(d1.raw.prepare(
    "SELECT COUNT(*) AS count FROM license_artifacts WHERE license_id = 101"
  ).get().count, 1);

  d1.raw.prepare(
    "UPDATE licenses SET last_self_service_transfer_at = datetime('now') WHERE id = 101"
  ).run();
  const cooldownRequest = await callApi(d1, "license/reactivations", {
    method: "POST",
    token: customerToken,
    body: {
      license_id: 101,
      installation_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      activation_identifier: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      refresh_public_key: refreshPublicKey,
    },
  });
  assert.equal(cooldownRequest.status, 201);
  assert.equal(cooldownRequest.data.status, "pending");
});

test("full-seat reactivation requires phone confirmation and an audited installation replacement", async () => {
  const d1 = createD1Mock();
  const customerToken = "reactivation-review-customer";
  const adminToken = "reactivation-review-admin";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 101, 101, datetime('now', '+1 day'))"
  ).bind(customerToken).run();
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+1 day'))"
  ).bind(adminToken).run();
  d1.raw.prepare("UPDATE licenses SET seats = 1 WHERE id = 101").run();
  d1.raw.prepare(
    "UPDATE licenses SET last_self_service_transfer_at = datetime('now') WHERE id = 101"
  ).run();

  const replacement = d1.raw.prepare(
    "SELECT id FROM license_activations WHERE license_id = 101 AND status = 'active'"
  ).get();
  const installationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const activationIdentifier = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const { refreshPublicKey, bindings } = await createLicenseSignerBindings("reactivation-review-key");
  const requested = await callApi(d1, "license/reactivations", {
    method: "POST",
    token: customerToken,
    body: {
      license_id: 101,
      installation_id: installationId,
      activation_identifier: activationIdentifier,
      refresh_public_key: refreshPublicKey,
    },
  });
  assert.equal(requested.status, 201);
  assert.equal(requested.data.status, "pending");
  assert.equal(requested.data.notification_status, "failed");
  assert.equal((await callApi(d1, "admin/license-reactivations", { token: customerToken })).status, 403);

  const queue = await callApi(d1, "admin/license-reactivations", { token: adminToken });
  assert.equal(queue.status, 200);
  assert.equal(queue.data.requests.length, 1);
  const detail = await callApi(d1, `admin/license-reactivations/${requested.data.request_id}`, {
    token: adminToken,
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.request.customer_phone, "+91 9876543210");

  const review = (body) => callApi(d1, `admin/license-reactivations/${requested.data.request_id}`, {
    method: "POST",
    token: adminToken,
    body: { decision: "approve", reason: "Customer verified by support call", ...body },
  });
  assert.equal((await review({})).status, 400);
  assert.equal((await review({ phone_confirmed: true })).status, 409);
  assert.equal((await review({
    phone_confirmed: true,
    replaced_activation_id: replacement.id,
  })).status, 409);
  assert.equal((await review({
    phone_confirmed: true,
    cooldown_override: true,
  })).status, 409);
  const approved = await review({
    phone_confirmed: true,
    replaced_activation_id: replacement.id,
    cooldown_override: true,
  });
  assert.equal(approved.status, 200);
  assert.equal(d1.raw.prepare(
    "SELECT status FROM license_activations WHERE id = ?"
  ).get(replacement.id).status, "revoked");
  const reviewedRequest = d1.raw.prepare(
    "SELECT status, phone_confirmed_at, cooldown_override FROM license_reactivation_requests WHERE request_id = ?"
  ).get(requested.data.request_id);
  assert.equal(reviewedRequest.status, "approved");
  assert.ok(reviewedRequest.phone_confirmed_at);
  assert.equal(reviewedRequest.cooldown_override, 1);

  const activation = await callApi(d1, "license/activate", {
    method: "POST",
    token: customerToken,
    body: { reactivation_request_id: requested.data.request_id },
    bindings,
  });
  assert.equal(activation.status, 201);
  assert.equal(d1.raw.prepare(
    "SELECT COUNT(*) AS count FROM license_activations WHERE license_id = 101 AND status = 'active'"
  ).get().count, 1);
});

test("Phase 4 through 10 staging verification on seeded dataset", async (t) => {
  const d1 = createD1Mock();

  // Create session for Customer A directly to ensure clean testing
  const token = "test-token-customer-a-123456";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 101, 101, datetime('now', '+7 days'))"
  ).bind(token).run();
  const adminToken = "test-token-super-admin-announcements";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();

  let sessionToken = token;

  await t.test("0. Invalid login is rejected without a server error", async () => {
    const res = await callApi(d1, "login", {
      method: "POST",
      body: { email: "missing@example.com", password: "not-a-real-password" },
    });
    assert.equal(res.status, 401);
    assert.equal(res.data.ok, false);
  });

  await t.test("1. Customer Profile Verification", async () => {
    const res = await callApi(d1, "me", { token: sessionToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.user.name, "Customer A");
    assert.equal(res.data.user.email, "customer.a@smritibooks.com");
  });

  await t.test("2. Organization Access", async () => {
    const res = await callApi(d1, "organization", { token: sessionToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.organization.name, "Organization A");
    assert.equal(res.data.organization.gst_number, "27AABCO1234A1Z5");
  });

  await t.test("3. Product Catalog", async () => {
    const res = await callApi(d1, "products", { token: sessionToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.ok(res.data.products.some((p) => p.code === "smriti-retail-os"));
  });

  await t.test("4. Populated License Card & Validity", async () => {
    const res = await callApi(d1, "licenses", { token: sessionToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.licenses.length, 1);
    const lic = res.data.licenses[0];
    assert.equal(lic.license_key, null);
    assert.match(lic.serial_number, /^SMR-LIC-\d{8}$/);
    assert.equal(lic.edition?.name, "Enterprise Edition");
    assert.equal(lic.status, "ACTIVE");
    assert.equal(lic.validity?.is_valid, true);
    assert.equal(lic.activation_count, 1);
  });

  await t.test("5. Entitlements Display", async () => {
    const res = await callApi(d1, "licenses/101/entitlements", { token: sessionToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.ok(res.data.entitlements.length >= 4);
    assert.ok(res.data.entitlements.some((e) => e.key === "pos_terminals" && e.value === 5));
  });

  await t.test("6. Activations Display", async () => {
    const res = await callApi(d1, "licenses/101/activations", { token: sessionToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.activations.length, 1);
    assert.equal(res.data.activations[0].installation_id, "NODE-MUM-POS-01");
  });

  await t.test("6a. License activation issues a verified, organization-bound artifact", async () => {
    const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", keyPair.publicKey)).toString("base64url");
    const refreshKeyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const refreshPublicKey = Buffer.from(await crypto.subtle.exportKey("raw", refreshKeyPair.publicKey)).toString("base64url");
    const signer = {
      async fetch(request) {
        const requestBody = await request.json();
        const payloadBytes = Buffer.from(requestBody.payload, "base64url");
        const signature = await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, payloadBytes);
        return Response.json({
          key_id: requestBody.key_id,
          signature: Buffer.from(signature).toString("base64url"),
        });
      },
    };
    const bindings = {
      LICENSE_SIGNER: signer,
      LICENSE_ACTIVE_KEY_ID: "staging-key",
      LICENSE_SIGNING_PUBLIC_KEYS: JSON.stringify({ "staging-key": publicKey }),
    };
    const body = {
      license_key: "SMRITI-RET-ENT-2026-001",
      product_code: "smriti-retail-os",
      company_binding: "COMP-001",
      installation_id: "8a36e7ab-20de-4e31-bf83-87bb4dcd7560",
      activation_identifier: "4c765a67-9e03-4e9d-9f38-211366dcf7de",
      refresh_public_key: refreshPublicKey,
    };
    const missingBinding = { ...body };
    delete missingBinding.company_binding;
    const unbound = await callApi(d1, "license/activate", { method: "POST", body: missingBinding, bindings });
    assert.equal(unbound.status, 404);
    const wrongBinding = await callApi(d1, "license/activate", {
      method: "POST",
      body: { ...body, company_binding: "COMP-999" },
      bindings,
    });
    assert.equal(wrongBinding.status, 404);
    const first = await callApi(d1, "license/activate", { method: "POST", body, bindings });
    assert.equal(first.status, 201);
    assert.equal(first.data.artifact.algorithm, "Ed25519");
    const payloadBytes = Buffer.from(first.data.artifact.payload, "base64url");
    const payload = JSON.parse(payloadBytes.toString("utf8"));
    const verifier = await crypto.subtle.importKey(
      "raw",
      Buffer.from(publicKey, "base64url"),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    assert.equal(payload.product_code, body.product_code);
    assert.equal(payload.company_binding, body.company_binding);
    assert.equal(payload.installation_id, body.installation_id);
    assert.equal(payload.organization_id, "101");
    assert.equal(await crypto.subtle.verify(
      { name: "Ed25519" },
      verifier,
      Buffer.from(first.data.artifact.signature, "base64url"),
      payloadBytes,
    ), true);

    const eventCount = d1.prepare(
      `SELECT COUNT(*) AS count FROM license_events
       WHERE license_id = 101 AND event_type = 'ACTIVATION_CREATED'
         AND json_extract(metadata_json, '$.activation_identifier') = ?`
    ).bind(body.activation_identifier).first().count;
    const repeated = await callApi(d1, "license/activate", { method: "POST", body, bindings });
    assert.equal(repeated.status, 201);
    assert.notEqual(repeated.data.artifact.document_id, first.data.artifact.document_id);
    const repeatedEventCount = d1.prepare(
      `SELECT COUNT(*) AS count FROM license_events
       WHERE license_id = 101 AND event_type = 'ACTIVATION_CREATED'
         AND json_extract(metadata_json, '$.activation_identifier') = ?`
    ).bind(body.activation_identifier).first().count;
    assert.equal(repeatedEventCount, eventCount);
  });

  await t.test("7. License Request Action (Request-only flow)", async () => {
    const res = await callApi(d1, "licenses/101/requests", {
      method: "POST",
      token: sessionToken,
      body: { request_type: "additional_users" },
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.ok, true);

    const check = d1.prepare("SELECT * FROM license_requests WHERE license_id = 101").first();
    assert.ok(check);
    assert.equal(check.request_type, "additional_users");
    assert.equal(check.status, "pending");
  });

  await t.test("8. Support Center lists only the authenticated customer's tickets", async () => {
    const res = await callApi(d1, "tickets", { token: sessionToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.tickets.length, 1);
    assert.equal(res.data.tickets[0].subject, "Organization A ticket");
  });

  await t.test("9. Support ticket detail and reply are customer-scoped", async () => {
    const detail = await callApi(d1, "tickets/101", { token: sessionToken });
    assert.equal(detail.status, 200);
    assert.equal(detail.data.ticket.subject, "Organization A ticket");

    const reply = await callApi(d1, "tickets/101/messages", {
      method: "POST",
      token: sessionToken,
      body: { message: "Please investigate this issue." },
    });
    assert.equal(reply.status, 201);

    const crossTenant = await callApi(d1, "tickets/102", { token: sessionToken });
    assert.equal(crossTenant.status, 404);
  });

  await t.test("Admin can review, reply to, close, and audit customer tickets", async () => {
    const anonymous = await callApi(d1, "admin/support-tickets");
    assert.equal(anonymous.status, 403);
    const customerAccess = await callApi(d1, "admin/support-tickets", { token: sessionToken });
    assert.equal(customerAccess.status, 403);

    const filtered = await callApi(d1, "admin/support-tickets?status=open&q=Organization%20A%20ticket&page=1&page_size=1", {
      token: adminToken,
    });
    assert.equal(filtered.status, 200);
    assert.equal(filtered.data.total, 1);
    assert.equal(filtered.data.tickets[0].id, 101);
    const secondPage = await callApi(d1, "admin/support-tickets?page=2&page_size=1", { token: adminToken });
    assert.equal(secondPage.status, 200);
    assert.equal(secondPage.data.page, 2);
    assert.equal(secondPage.data.tickets.length, 1);

    const detail = await callApi(d1, "admin/support-tickets/101", { token: adminToken });
    assert.equal(detail.status, 200);
    assert.equal(detail.data.ticket.customer_id, 101);
    assert.ok(Array.isArray(detail.data.activity));

    const invalidStatus = await callApi(d1, "admin/support-tickets/101/status", {
      method: "PATCH",
      token: adminToken,
      body: { status: "archived" },
    });
    assert.equal(invalidStatus.status, 400);

    const reply = await callApi(d1, "admin/support-tickets/101/messages", {
      method: "POST",
      token: adminToken,
      body: { message: "We are investigating this issue." },
    });
    assert.equal(reply.status, 201);

    const closed = await callApi(d1, "admin/support-tickets/101/status", {
      method: "PATCH",
      token: adminToken,
      body: { status: "closed" },
    });
    assert.equal(closed.status, 200);
    assert.equal(closed.data.status, "closed");

    const customerDetail = await callApi(d1, "tickets/101", { token: sessionToken });
    assert.equal(customerDetail.data.ticket.status, "closed");
    assert.ok(customerDetail.data.ticket.messages.some((message) => message.author_type === "staff"));

    const customerReply = await callApi(d1, "tickets/101/messages", {
      method: "POST",
      token: sessionToken,
      body: { message: "The issue still persists." },
    });
    assert.equal(customerReply.status, 201);
    assert.equal(
      d1.raw.prepare("SELECT status FROM support_tickets WHERE id = 101").get().status,
      "open",
    );
    assert.equal(
      d1.raw.prepare(
        "SELECT COUNT(*) AS count FROM audit_logs WHERE resource_type = 'support_ticket' AND resource_id = '101' AND action IN ('ADMIN_SUPPORT_TICKET_REPLIED', 'ADMIN_SUPPORT_TICKET_STATUS_CHANGED', 'SUPPORT_TICKET_REOPENED_BY_CUSTOMER')"
      ).get().count,
      3,
    );
    const finalDetail = await callApi(d1, "admin/support-tickets/101", { token: adminToken });
    assert.ok(finalDetail.data.activity.some((event) => event.action === "SUPPORT_TICKET_REOPENED_BY_CUSTOMER"));
  });

  await t.test("10. Customer can create a ticket without supplying ownership", async () => {
    const res = await callApi(d1, "tickets", {
      method: "POST",
      token: sessionToken,
      body: { subject: "New issue", description: "Created from the portal", priority: "normal" },
    });
    assert.equal(res.status, 201);
    const created = d1.prepare("SELECT customer_id FROM support_tickets WHERE id = ?").bind(res.data.ticket_id).first();
    assert.equal(created.customer_id, 101);
  });

  await t.test("11. Custom Requirements lists only the authenticated organization", async () => {
    const res = await callApi(d1, "requirements", { token: sessionToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.requirements.length, 1);
    assert.equal(res.data.requirements[0].title, "Organization A requirement");
  });

  await t.test("12. Customer can submit and reply to a requirement", async () => {
    const created = await callApi(d1, "requirements", {
      method: "POST",
      token: sessionToken,
      body: { title: "New requirement", description: "Created from the portal", category: "workflow", priority: "normal" },
    });
    assert.equal(created.status, 201);
    const record = d1.prepare("SELECT organization_id FROM custom_requirements WHERE id = ?").bind(created.data.requirement_id).first();
    assert.equal(record.organization_id, 101);

    const reply = await callApi(d1, `requirements/${created.data.requirement_id}/messages`, {
      method: "POST",
      token: sessionToken,
      body: { message: "Adding more context." },
    });
    assert.equal(reply.status, 201);
  });

  await t.test("13. Modified requirement IDs are denied", async () => {
    const detail = await callApi(d1, "requirements/102", { token: sessionToken });
    assert.equal(detail.status, 404);
  });

  await t.test("14. Release Center shows only eligible licensed product releases", async () => {
    const res = await callApi(d1, "releases", { token: sessionToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.releases.length, 1);
    assert.equal(res.data.releases[0].version, "2026.08");
    assert.equal(res.data.releases[0].assets.length, 1);
  });

  await t.test("15. Release detail is organization-scoped", async () => {
    const detail = await callApi(d1, "releases/101", { token: sessionToken });
    assert.equal(detail.status, 200);
    assert.equal(detail.data.release.product.code, "smriti-retail-os");
    const forged = await callApi(d1, "releases/999", { token: sessionToken });
    assert.equal(forged.status, 404);
  });

  await t.test("16. Customer without a qualifying license sees no releases", async () => {
    const customerBToken = "test-token-customer-b-123456";
    d1.prepare("INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 102, 102, datetime('now', '+7 days'))").bind(customerBToken).run();
    const res = await callApi(d1, "releases", { token: customerBToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.releases.length, 0);
  });

  await t.test("17. Partner workspace is scoped to linked customer organizations", async () => {
    const partnerToken = "test-token-partner-123456";
    d1.prepare("INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'customer', 103, 103, datetime('now', '+7 days'))").bind(partnerToken).run();
    const profile = await callApi(d1, "partner/me", { token: partnerToken });
    assert.equal(profile.status, 200);
    assert.equal(profile.data.partner.partner_type, "reseller");

    const customers = await callApi(d1, "partner/customers", { token: partnerToken });
    assert.equal(customers.status, 200);
    assert.equal(customers.data.customers.length, 1);
    assert.equal(customers.data.customers[0].name, "Organization A");

    const licenses = await callApi(d1, "partner/licenses", { token: partnerToken });
    assert.equal(licenses.status, 200);
    assert.ok(licenses.data.licenses.every((license) => license.customer_organization_name === "Organization A"));

    const releases = await callApi(d1, "partner/releases", { token: partnerToken });
    assert.equal(releases.status, 200);
    assert.equal(releases.data.releases.length, 1);
  });

  await t.test("18. Ordinary customer cannot enter the partner workspace", async () => {
    const res = await callApi(d1, "partner/me", { token: sessionToken });
    assert.equal(res.status, 403);
  });

  await t.test("19. Commercial relationship is customer-scoped and read-only", async () => {
    const summary = await callApi(d1, "commercial/summary", { token: sessionToken });
    assert.equal(summary.status, 200);
    assert.equal(summary.data.summary.orders.length, 1);
    assert.equal(summary.data.summary.amc_contracts.length, 1);

    const order = await callApi(d1, "commercial/orders/101", { token: sessionToken });
    assert.equal(order.status, 200);
    assert.equal(order.data.order.order_number, "ORD-PHASE9-001");
    const forged = await callApi(d1, "commercial/orders/999", { token: sessionToken });
    assert.equal(forged.status, 404);
  });

  await t.test("20. Operational accounting remains outside the portal", async () => {
    const res = await callApi(d1, "accounting/accounts", { token: sessionToken });
    assert.equal(res.status, 403);
  });

  await t.test("21. Super admin control plane is internal-only", async () => {
    const adminToken = "test-token-admin-123456";
    d1.prepare("INSERT INTO sessions (token, account_type, account_id, organization_id, expires_at) VALUES (?, 'user', 201, 201, datetime('now', '+7 days'))").bind(adminToken).run();
    d1.prepare(
      `INSERT INTO licenses (customer_id, product_id, license_key, serial_number, starts_at, expires_at, status)
       SELECT (SELECT id FROM customers LIMIT 1), (SELECT id FROM products LIMIT 1),
              'overview-expiring-soon-license-key', 'OVERVIEW-EXPIRING-SOON',
              date('now'), date('now', '+15 days'), 'ACTIVE'`
    ).run();
    const overviewLicenseId = d1.prepare(
      "SELECT id FROM licenses WHERE serial_number = 'OVERVIEW-EXPIRING-SOON'"
    ).first().id;
    d1.prepare(
      `INSERT INTO license_activations
       (license_id, installation_id, activation_identifier, status)
       VALUES (?, 'overview-test-installation', 'overview-test-activation', 'active')`
    ).bind(overviewLicenseId).run();
    const overview = await callApi(d1, "admin/overview", { token: adminToken });
    assert.equal(overview.status, 200);
    assert.ok(overview.data.metrics.organizations >= 3);
    assert.ok(overview.data.license_statuses.active >= 1);
    assert.ok(overview.data.expiring_soon >= 1);
    assert.equal(
      Object.values(overview.data.license_statuses).reduce((total, count) => total + count, 0),
      overview.data.metrics.licenses,
    );
    assert.equal(typeof overview.data.expiring_soon, "number");
    assert.equal(typeof overview.data.code_inventory.available, "number");
    assert.equal(typeof overview.data.code_inventory.pending_delivery, "number");
    const operational = overview.data.operational_metrics;
    assert.equal(typeof operational.active_customer_organizations, "number");
    assert.equal(typeof operational.active_organization_memberships, "number");
    assert.deepEqual(operational.active_partners_by_category.map((partner) => partner.category), [
      "channel_partner",
      "reseller",
      "implementation_partner",
      "technology_partner",
      "referral_partner",
      "distributor",
    ]);
    assert.equal(typeof operational.license_utilization.active_licenses, "number");
    assert.equal(typeof operational.license_utilization.licensed_seats, "number");
    assert.equal(typeof operational.license_utilization.active_activations, "number");
    assert.ok(operational.license_utilization.active_licenses >= 1);
    assert.ok(operational.license_utilization.licensed_seats >= 1);
    assert.ok(operational.license_utilization.active_activations >= 1);
    assert.ok(Array.isArray(operational.support_ticket_statuses));
    assert.ok(Array.isArray(operational.release_statuses));
    assert.deepEqual(operational.deployment_status, { available: false });
    assert.ok(Array.isArray(operational.customer_invitation_statuses));
    assert.ok(Array.isArray(overview.data.recent_activity));

    const organizations = await callApi(d1, "admin/organizations", { token: adminToken });
    assert.equal(organizations.status, 200);
    assert.ok(organizations.data.organizations.some((organization) => organization.name === "Organization A"));

    const users = await callApi(d1, "admin/users", { token: adminToken });
    assert.equal(users.status, 200);
    assert.ok(users.data.users.some((user) => user.email === "admin.phase10@example.com"));

    const audit = await callApi(d1, "admin/audit", { token: adminToken });
    assert.equal(audit.status, 200);
  });

  await t.test("22. Customer cannot enter admin control plane", async () => {
    const res = await callApi(d1, "admin/overview", { token: sessionToken });
    assert.equal(res.status, 403);
  });

  await t.test("23. Announcements require super-admin authoring access", async () => {
    const denied = await callApi(d1, "admin/announcements", {
      method: "POST",
      token: sessionToken,
      body: { title: "Unauthorized", message: "Must not publish" },
    });
    assert.equal(denied.status, 403);

    const listing = await callApi(d1, "admin/announcements", { token: adminToken });
    assert.equal(listing.status, 200);
    assert.deepEqual(listing.data.announcements, []);
  });

  await t.test("24. Customer announcements filter drafts and unlicensed product notices", async () => {
    const licensedProduct = d1.prepare("SELECT product_id FROM licenses WHERE id = 101").first().product_id;
    d1.prepare("INSERT INTO products (name, slug, status) VALUES ('Unlicensed Product', 'unlicensed-product', 'active')").run();
    const unlicensedProduct = d1.prepare("SELECT id FROM products WHERE slug = 'unlicensed-product'").first().id;

    const createAnnouncement = (body) => callApi(d1, "admin/announcements", {
      method: "POST",
      token: adminToken,
      body: { title: "Service update", message: "Customer-facing details", status: "published", ...body },
    });
    const globalNotice = await createAnnouncement({ severity: "maintenance" });
    const licensedNotice = await createAnnouncement({ product_id: licensedProduct, severity: "degraded" });
    const unlicensedNotice = await createAnnouncement({ product_id: unlicensedProduct });
    const draftNotice = await createAnnouncement({ status: "draft" });
    assert.equal(globalNotice.status, 201);
    assert.equal(licensedNotice.status, 201);
    assert.equal(unlicensedNotice.status, 201);
    assert.equal(draftNotice.status, 201);

    const response = await callApi(d1, "announcements", { token: sessionToken });
    assert.equal(response.status, 200);
    const visibleIds = response.data.announcements.map((item) => item.id);
    assert.ok(visibleIds.includes(globalNotice.data.announcement.id));
    assert.ok(visibleIds.includes(licensedNotice.data.announcement.id));
    assert.ok(!visibleIds.includes(unlicensedNotice.data.announcement.id));
    assert.ok(!visibleIds.includes(draftNotice.data.announcement.id));
  });

  await t.test("25. Announcement status transitions are audited and constrained", async () => {
    const draft = await callApi(d1, "admin/announcements", {
      method: "POST",
      token: adminToken,
      body: { title: "Planned notice", message: "Will publish after review" },
    });
    const published = await callApi(d1, `admin/announcements/${draft.data.announcement.id}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "published" },
    });
    assert.equal(published.status, 200);
    assert.equal(published.data.announcement.status, "published");

    const invalid = await callApi(d1, `admin/announcements/${draft.data.announcement.id}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "draft" },
    });
    assert.equal(invalid.status, 409);
    const audit = d1.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE resource_type = 'announcement'").first();
    assert.ok(audit.count >= 5);
  });

  await t.test("26. Organization Isolation (Denied cross-tenant license read)", async () => {
    // Attempt to access unassigned license ID 999
    const res = await callApi(d1, "licenses/999/entitlements", { token: sessionToken });
    assert.equal(res.status, 404);
  });

  await t.test("27. License Mutation Denial (403 Forbidden for customer)", async () => {
    // Attempt direct mutation of license status
    const res = await callApi(d1, "licenses/101/suspend", {
      method: "POST",
      token: sessionToken,
    });
    assert.equal(res.status, 403);
  });

  await t.test("27a. Draft license keys are hidden from customers and cannot be activated", async () => {
    const productId = d1.prepare("SELECT product_id FROM licenses WHERE id = 101").first().product_id;
    const editionId = d1.prepare("SELECT edition_id FROM license_editions WHERE license_id = 101").first().edition_id;
    const refreshKeyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const refreshPublicKey = Buffer.from(await crypto.subtle.exportKey("raw", refreshKeyPair.publicKey)).toString("base64url");
    const created = await callApi(d1, "licenses", {
      method: "POST",
      token: adminToken,
      body: {
        organization_id: 101,
        product_id: productId,
        edition_id: editionId,
        status: "DRAFT",
        entitlements: [{ key: "company.binding", value_type: "text", value: "COMP-001" }],
      },
    });
    assert.equal(created.status, 201);

    const customerLicenses = await callApi(d1, "licenses", { token: sessionToken });
    const draft = customerLicenses.data.licenses.find((license) => license.id === created.data.license.id);
    assert.equal(draft.status, "DRAFT");
    assert.equal(draft.license_key, null);

    const activation = await callApi(d1, "license/activate", {
      method: "POST",
      body: {
        license_key: created.data.license.license_key,
        product_code: "smriti-retail-os",
        company_binding: "COMP-001",
        installation_id: "8a36e7ab-20de-4e31-bf83-87bb4dcd7560",
        activation_identifier: "4c765a67-9e03-4e9d-9f38-211366dcf7de",
        refresh_public_key: refreshPublicKey,
      },
    });
    assert.equal(activation.status, 409);
    assert.match(activation.data.error, /Draft licenses cannot be activated/);
  });

  await t.test("28. Logout & Invalidation", async () => {
    const res = await callApi(d1, "logout", {
      method: "POST",
      token: sessionToken,
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
  });

  await t.test("29. Access After Logout Denied (401 Unauthorized)", async () => {
    const res = await callApi(d1, "organization", { token: sessionToken });
    assert.equal(res.status, 401);
  });

  await t.test("30. New licenses require a unique, non-empty company binding", async () => {
    const productId = d1.prepare("SELECT product_id FROM licenses WHERE id = 101").first().product_id;
    const editionId = d1.prepare("SELECT edition_id FROM license_editions WHERE license_id = 101").first().edition_id;
    const baseBody = {
      organization_id: 101,
      product_id: productId,
      edition_id: editionId,
      status: "DRAFT",
      entitlements: [{ key: "license.model", value_type: "text", value: "on_premise_subscription" }],
    };
    const missingBinding = await callApi(d1, "licenses", { method: "POST", token: adminToken, body: baseBody });
    assert.equal(missingBinding.status, 400);

    const duplicateBinding = await callApi(d1, "licenses", {
      method: "POST",
      token: adminToken,
      body: {
        ...baseBody,
        entitlements: [
          { key: "company.binding", value_type: "text", value: "COMP-001" },
          { key: "company.binding", value_type: "text", value: "COMP-001" },
        ],
      },
    });
    assert.equal(duplicateBinding.status, 400);

    const created = await callApi(d1, "licenses", {
      method: "POST",
      token: adminToken,
      body: {
        ...baseBody,
        company_binding: "COMP-001",
        entitlements: [
          { key: "company.binding", value_type: "text", value: " COMP-001 " },
          ...baseBody.entitlements,
        ],
      },
    });
    assert.equal(created.status, 201);
    assert.ok(created.data.license.license_key);
    assert.equal(created.data.license.status, "DRAFT");
  });
});
