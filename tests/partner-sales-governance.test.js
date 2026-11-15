/**
 * @file        partner-sales-governance.test.js
 * @project     PrathamOne EduOS Coaching Institute Management System
 * @module      SMRITISYS partner sales governance tests
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
 * @description Verifies partner onboarding, assigned inventory, and scoped access.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const migration = fs.readFileSync(new URL("../migrations/0026_partner_sales_governance.sql", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const partnerHtml = fs.readFileSync(new URL("../partner.html", import.meta.url), "utf8");
const partnerScript = fs.readFileSync(new URL("../js/partner.js", import.meta.url), "utf8");

test("partner sales migration extends canonical invite and code records with scoped permissions", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE people (id INTEGER PRIMARY KEY);
    CREATE TABLE customer_invites (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      status TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE license_code_inventory (
      id INTEGER PRIMARY KEY,
      batch_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT
    );
    CREATE TABLE roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE role_permissions (
      role_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      PRIMARY KEY (role_id, permission_id)
    );
    INSERT INTO roles (name) VALUES ('partner_admin'), ('partner_member');
  `);
  db.exec(migration);

  const inviteColumns = db.prepare("PRAGMA table_info(customer_invites)").all().map((column) => column.name);
  const inventoryColumns = db.prepare("PRAGMA table_info(license_code_inventory)").all().map((column) => column.name);
  assert.ok(inviteColumns.includes("invited_by_partner_organization_id"));
  assert.ok(inventoryColumns.includes("assigned_partner_organization_id"));
  assert.ok(inventoryColumns.includes("partner_assigned_at"));
  assert.ok(inventoryColumns.includes("partner_assigned_by_person_id"));

  const grants = db.prepare(
    `SELECT r.name AS role_name, p.name AS permission_name
     FROM role_permissions rp
     JOIN roles r ON r.id = rp.role_id
     JOIN permissions p ON p.id = rp.permission_id`
  ).all();
  const adminGrants = grants.filter((grant) => grant.role_name === "partner_admin").map((grant) => grant.permission_name);
  const memberGrants = grants.filter((grant) => grant.role_name === "partner_member").map((grant) => grant.permission_name);
  assert.ok(adminGrants.includes("partner.customer.create"));
  assert.ok(adminGrants.includes("partner.inventory.view"));
  assert.ok(adminGrants.includes("partner.inventory.reveal"));
  assert.ok(memberGrants.includes("partner.customer.create"));
  assert.ok(memberGrants.includes("partner.inventory.view"));
  assert.ok(!memberGrants.includes("partner.inventory.reveal"));
  db.close();
});

test("partner APIs reuse customer records and scope inventory and key reveal to allocated partner codes", () => {
  assert.match(api, /async function createPartnerCustomerInvite/);
  assert.match(api, /invited_by_partner_organization_id/);
  assert.match(api, /PARTNER_CUSTOMER_INVITE_CREATED/);
  assert.match(api, /WHERE c\.assigned_partner_organization_id = \?/);
  assert.match(api, /partnerSession && Number\(code\.assigned_partner_organization_id\) !== Number\(partnerSession\.partner_organization_id\)/);
  assert.match(api, /PARTNER_LICENSE_CODE_REVEALED/);
  assert.match(api, /LICENSE_CODES_ALLOCATED_TO_PARTNER/);
  assert.match(api, /partner_organization_id: code\.assigned_partner_organization_id \|\| null/);
});

test("partner portal exposes customer onboarding and assigned inventory without returning activation keys in list data", () => {
  assert.match(partnerHtml, /id="partnerCustomerInviteForm"/);
  assert.match(partnerHtml, /data-partner-section="inventory"/);
  assert.match(partnerHtml, /partnerCodeRevealDialog/);
  assert.match(partnerScript, /partnerApi\('partner\/customers'/);
  assert.match(partnerScript, /partnerApi\('partner\/inventory'/);
  assert.match(partnerScript, /partner\/codes\/\$\{encodeURIComponent\(form\.dataset\.batchId\)\}/);

  const partnerHandler = api.slice(api.indexOf("async function handlePartner("), api.indexOf("async function createPartnerCustomerInvite("));
  assert.match(partnerHandler, /activation_key_recoverable: Boolean/);
  assert.doesNotMatch(partnerHandler, /activation_key:\s*code\.activation_key/);
});
