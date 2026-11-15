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
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { hashCustomerInviteToken, onRequest } from "../functions/api/[[path]].js";

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
    env: { DB: env, ...(options.bindings || {}) },
    params: { path: path.split("/").filter(Boolean) },
  });

  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json() : await res.text();
  return { status: res.status, ok: res.ok, data };
}

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

  const login = await callApi(d1, "login", {
    method: "POST",
    body: { type: "user", email: "bootstrap@example.test", password },
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, "super_admin");

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
    "INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'user', 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();

  const denied = await callApi(d1, "admin/customer-invites");
  assert.equal(denied.status, 403);

  const invite = await callApi(d1, "admin/customer-invites", {
    method: "POST",
    token: adminToken,
    body: { email: "invitee@example.test", name: "Invitee", company: "Example Academy" },
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

  const customer = d1.raw.prepare("SELECT id, password_hash FROM customers WHERE email = ?").get("invitee@example.test");
  assert.ok(customer);
  assert.match(customer.password_hash, /^pbkdf2-sha256\$/);
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
    "INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'user', 201, datetime('now', '+7 days'))"
  ).bind(adminToken).run();

  const createInvite = async (email) => callApi(d1, "admin/customer-invites", {
    method: "POST",
    token: adminToken,
    body: { email, company: "Example Academy" },
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

test("direct license issuance registers an activation-only customer and reveals the key once", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-direct-license";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'user', 201, datetime('now', '+7 days'))"
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
  const body = {
    customer_mode: "new",
    customer_email: "license-only@example.test",
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

  const issued = await callApi(d1, "licenses", { method: "POST", token: adminToken, body });
  assert.equal(issued.status, 201);
  assert.match(issued.data.license.serial_number, /^SMR-LIC-\d{8}$/);
  assert.match(issued.data.license.license_key, /^LIC-[A-F0-9]+$/);
  const licenseId = issued.data.license.id;
  const customer = d1.raw.prepare(
    "SELECT id, password_hash, status FROM customers WHERE email = ?"
  ).get("license-only@example.test");
  assert.equal(customer.status, "inactive");
  assert.match(customer.password_hash, /^pbkdf2-sha256\$/);
  assert.equal(d1.raw.prepare(
    "SELECT COUNT(*) AS count FROM customer_invites WHERE lower(email) = lower(?)"
  ).get("license-only@example.test").count, 0);

  const organization = d1.raw.prepare(
    `SELECT o.id, o.legal_name, om.status
     FROM organizations o
     JOIN organization_members om ON om.organization_id = o.id
     WHERE om.account_type = 'customer' AND om.account_id = ?`
  ).get(customer.id);
  assert.equal(organization.legal_name, "Example Coaching Academy");
  assert.equal(organization.status, "active");

  const storedLicense = d1.raw.prepare(
    "SELECT customer_id, seats, status FROM licenses WHERE id = ?"
  ).get(licenseId);
  assert.equal(storedLicense.customer_id, customer.id);
  assert.equal(storedLicense.seats, 1);
  assert.equal(storedLicense.status, "ACTIVE");
  assert.equal(d1.raw.prepare(
    "SELECT value_text FROM license_entitlements WHERE license_id = ? AND entitlement_key = 'company.binding'"
  ).get(licenseId).value_text, "PA001");

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

test("pre-generated license codes are hash-only, claim once, and issue installation-bound 90-day artifacts", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-license-code-batch";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'user', 201, datetime('now', '+7 days'))"
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
  assert.equal(storedCode.offline_validity_days, 90);
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
  assert.equal(payload.offline_validity_days, 90);
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
  assert.equal(claimed.offline_validity_days, 90);
  assert.equal(claimed.address, "12 Academy Road");
  assert.equal(claimed.tax_id, "TAX-123");

  const secondCode = createdBatch.data.codes[1];
  const secondInstallation = {
    ...activation,
    serial_number: secondCode.serial_number,
    activation_key: secondCode.activation_key,
    installation_id: "12111111-2222-4333-8444-555555555555",
    activation_identifier: "12111111-2222-4333-8444-666666666666",
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
});

test("license code batches allow 200 new-format codes and safely revoke unused batches", async () => {
  const d1 = createD1Mock();
  const adminToken = "test-token-license-code-revoke";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'user', 201, datetime('now', '+7 days'))"
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
    "INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'user', 201, datetime('now', '+7 days'))"
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

test("Phase 4 through 10 staging verification on seeded dataset", async (t) => {
  const d1 = createD1Mock();

  // Create session for Customer A directly to ensure clean testing
  const token = "test-token-customer-a-123456";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'customer', 101, datetime('now', '+7 days'))"
  ).bind(token).run();
  const adminToken = "test-token-super-admin-announcements";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'user', 201, datetime('now', '+7 days'))"
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
    d1.prepare("INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'customer', 102, datetime('now', '+7 days'))").bind(customerBToken).run();
    const res = await callApi(d1, "releases", { token: customerBToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.releases.length, 0);
  });

  await t.test("17. Partner workspace is scoped to linked customer organizations", async () => {
    const partnerToken = "test-token-partner-123456";
    d1.prepare("INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'customer', 103, datetime('now', '+7 days'))").bind(partnerToken).run();
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
    d1.prepare("INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'user', 201, datetime('now', '+7 days'))").bind(adminToken).run();
    const overview = await callApi(d1, "admin/overview", { token: adminToken });
    assert.equal(overview.status, 200);
    assert.ok(overview.data.metrics.organizations >= 3);

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
