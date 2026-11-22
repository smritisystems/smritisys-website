/**
 * @file        customer-invite.test.js
 * @project     PrathamOne EduOS Coaching Institute Management System
 * @module      SMRITISYS customer invitation tests
 *
 * @author      Jawahar R. Mallah
 * @organization AITDL (AI Technology & Development Lab)
 * @client      Prashant Academy Coaching Institute
 * @copyright   Copyright (c) 2026 AITDL
 * @license     Proprietary
 *
 * @version     1.0.0
 * @created     2026-11-06
 * @updated     2026-11-16
 *
 * @description Verifies customer invitation and contact-detail contracts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  hashCustomerInviteToken,
  isValidCustomerInviteToken,
} from "../functions/api/[[path]].js";

const api = fs.readFileSync(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/0018_customer_setup_invites.sql", import.meta.url), "utf8");
const contactMigration = fs.readFileSync(new URL("../migrations/0027_customer_contact_and_partner_details.sql", import.meta.url), "utf8");
const profileMigration = fs.readFileSync(new URL("../migrations/0028_customer_profile_management.sql", import.meta.url), "utf8");
const adminHtml = fs.readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const adminScript = fs.readFileSync(new URL("../js/admin.js", import.meta.url), "utf8");
const inviteHtml = fs.readFileSync(new URL("../accept-invite.html", import.meta.url), "utf8");
const inviteScript = fs.readFileSync(new URL("../js/accept-invite.js", import.meta.url), "utf8");

test("customer invitation tokens are validated and hashed before storage", async () => {
  const token = "a".repeat(48);
  assert.equal(isValidCustomerInviteToken(token), true);
  assert.equal(isValidCustomerInviteToken("a".repeat(47)), false);
  assert.equal(isValidCustomerInviteToken(`${"a".repeat(47)}g`), false);

  const hash = await hashCustomerInviteToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(await hashCustomerInviteToken(token), hash);
  await assert.rejects(hashCustomerInviteToken("invalid"), TypeError);
});

test("customer invitation records enforce one pending invite and never store a raw token", () => {
  assert.match(migration, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /expires_at TEXT NOT NULL/);
  assert.match(migration, /CHECK \(status IN \('pending', 'accepted', 'revoked'\)\)/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_invites_one_pending_email/);
  assert.doesNotMatch(migration, /\btoken\s+TEXT\b/i);

  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE people (id INTEGER PRIMARY KEY); CREATE TABLE customers (id INTEGER PRIMARY KEY);");
  db.exec(migration);
  const insert = db.prepare(
    "INSERT INTO customer_invites (token_hash, email, company, expires_at) VALUES (?, ?, ?, datetime('now', '+1 day'))"
  );
  insert.run("a".repeat(64), "Customer@example.test", "Example Academy");
  assert.throws(() => insert.run("b".repeat(64), "customer@example.test", "Example Academy"), /UNIQUE/);
  db.prepare("UPDATE customer_invites SET status = 'revoked' WHERE token_hash = ?").run("a".repeat(64));
  assert.doesNotThrow(() => insert.run("c".repeat(64), "customer@example.test", "Example Academy"));
});

test("customer invite setup is authenticated, single-use, and does not put credentials in the URL", () => {
  assert.match(api, /path === "admin\/customer-invites"[\s\S]*handleAdminCustomerInvites/);
  assert.match(api, /requireSuperAdmin\(request, env\)/);
  assert.match(api, /status = 'pending' AND expires_at > datetime\('now'\)/);
  assert.match(api, /status = 'accepted', accepted_at = datetime\('now'\)/);
  assert.match(api, /path === "customer-invites\/accept"/);
  assert.match(adminHtml, /id="customerInviteForm"/);
  assert.match(adminHtml, /id="customerInvitePhone"[^>]*required/);
  assert.match(adminScript, /admin\/customer-invites/);
  assert.match(adminScript, /data-customer-invite-revoke/);
  assert.match(inviteHtml, /minlength="12" maxlength="128"/);
  assert.match(inviteScript, /history\.replaceState/);
  assert.match(inviteScript, /credentials: 'omit'/);
  assert.match(inviteScript, /JSON\.stringify\(\{ token: inviteToken, password \}\)/);
});

test("customer contact and partner organization migration adds optional legacy-safe fields", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, phone TEXT);
    CREATE TABLE customer_invites (id INTEGER PRIMARY KEY, customer_id INTEGER);
    CREATE TABLE partner_invites (id INTEGER PRIMARY KEY);
    CREATE TABLE organizations (id INTEGER PRIMARY KEY);
  `);
  db.prepare("INSERT INTO customers (id, phone) VALUES (1, '+1 555 0112')").run();
  db.prepare("INSERT INTO customer_invites (id, customer_id) VALUES (1, 1)").run();
  db.exec(contactMigration);

  for (const [table, column] of [
    ["customer_invites", "phone"],
    ["partner_invites", "phone"],
    ["organizations", "phone"],
    ["organizations", "country"],
  ]) {
    assert.ok(db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column));
  }
  assert.equal(db.prepare("SELECT phone FROM customer_invites WHERE id = 1").get().phone, "+1 555 0112");
});

test("customer profile migration upgrades legacy databases and is rerunnable", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY);
    CREATE TABLE people (id INTEGER PRIMARY KEY);
    CREATE TABLE permissions (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT
    );
    CREATE TABLE roles (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE role_permissions (
      role_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      UNIQUE(role_id, permission_id)
    );
    INSERT INTO roles (id, name) VALUES (1, 'partner_admin'), (2, 'partner_member');
  `);

  db.exec(profileMigration);
  db.exec(profileMigration);

  for (const [table, column] of [
    ["customer_profiles", "customer_id"],
    ["customer_addresses", "customer_id"],
    ["customer_password_resets", "token_hash"],
  ]) {
    assert.ok(db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column));
  }
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM permissions WHERE name = 'partner.customer.update_contact'")
      .get().count,
    1,
  );
  db.close();
});
