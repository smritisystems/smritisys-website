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
    env: { DB: env },
    params: { path: path.split("/").filter(Boolean) },
  });

  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json() : await res.text();
  return { status: res.status, ok: res.ok, data };
}

test("Phase 4 through 10 staging verification on seeded dataset", async (t) => {
  const d1 = createD1Mock();

  // Create session for Customer A directly to ensure clean testing
  const token = "test-token-customer-a-123456";
  d1.prepare(
    "INSERT INTO sessions (token, account_type, account_id, expires_at) VALUES (?, 'customer', 101, datetime('now', '+7 days'))"
  ).bind(token).run();

  let sessionToken = token;

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

  await t.test("23. Organization Isolation (Denied cross-tenant license read)", async () => {
    // Attempt to access unassigned license ID 999
    const res = await callApi(d1, "licenses/999/entitlements", { token: sessionToken });
    assert.equal(res.status, 404);
  });

  await t.test("24. License Mutation Denial (403 Forbidden for customer)", async () => {
    // Attempt direct mutation of license status
    const res = await callApi(d1, "licenses/101/suspend", {
      method: "POST",
      token: sessionToken,
    });
    assert.equal(res.status, 403);
  });

  await t.test("25. Logout & Invalidation", async () => {
    const res = await callApi(d1, "logout", {
      method: "POST",
      token: sessionToken,
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
  });

  await t.test("26. Access After Logout Denied (401 Unauthorized)", async () => {
    const res = await callApi(d1, "organization", { token: sessionToken });
    assert.equal(res.status, 401);
  });
});
