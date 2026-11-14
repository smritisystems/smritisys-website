import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[path]].js";

// Initialize in-memory SQLite with D1-like interface
function createD1Mock() {
  const db = new DatabaseSync(":memory:");
  
  // Apply schemas and migrations
  const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  const m2 = fs.readFileSync(new URL("../migrations/0002_identity_rbac.sql", import.meta.url), "utf8");
  const m3 = fs.readFileSync(new URL("../migrations/0003_license_control_plane.sql", import.meta.url), "utf8");
  const m4 = fs.readFileSync(new URL("../migrations/0004_customer_license_requests.sql", import.meta.url), "utf8");
  const m5 = fs.readFileSync(new URL("../migrations/0005_staging_verification_seed.sql", import.meta.url), "utf8");
  const m6 = fs.readFileSync(new URL("../migrations/0006_custom_requirements.sql", import.meta.url), "utf8");
  const m7 = fs.readFileSync(new URL("../migrations/0007_release_center.sql", import.meta.url), "utf8");
  const m8 = fs.readFileSync(new URL("../migrations/0008_partner_relationships.sql", import.meta.url), "utf8");
  const m9 = fs.readFileSync(new URL("../migrations/0009_partner_staging_seed.sql", import.meta.url), "utf8");
  const m10 = fs.readFileSync(new URL("../migrations/0010_commercial_relationship.sql", import.meta.url), "utf8");
  const m11 = fs.readFileSync(new URL("../migrations/0011_admin_staging_seed.sql", import.meta.url), "utf8");
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
    assert.equal(lic.license_key, "SMRITI-RET-ENT-2026-001");
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
