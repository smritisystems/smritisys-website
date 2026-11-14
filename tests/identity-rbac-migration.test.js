/**
 * @file        identity-rbac-migration.test.js
 * @project     PrathamOne EduOS Coaching Institute Management System
 * @module      SMRITISYS migration tests
 *
 * @author      Jawahar R. Mallah
 * @organization AITDL (AI Technology & Development Lab)
 * @client      Prashant Academy Coaching Institute
 * @copyright   Copyright (c) 2026 AITDL
 * @license     Proprietary
 *
 * @version     1.0.0
 * @created     2026-11-14
 * @updated     2026-11-14
 *
 * @description Verifies identity bootstrap migration idempotency.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/0002_identity_rbac.sql", import.meta.url), "utf8");

test("identity and RBAC bootstrap can be rerun without duplicating organizations or memberships", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  db.prepare(
    "INSERT INTO users (email, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)"
  ).run("admin@example.test", "test-hash", "Admin", "super_admin", "active");
  db.prepare(
    "INSERT INTO customers (email, password_hash, name, company, status) VALUES (?, ?, ?, ?, ?)"
  ).run("new@example.test", "test-hash", "New Customer", "New Academy", "active");
  db.prepare(
    "INSERT INTO customers (email, password_hash, name, company, status) VALUES (?, ?, ?, ?, ?)"
  ).run("existing@example.test", "test-hash", "Existing Customer", "Existing Academy", "trial");
  db.prepare(
    "INSERT INTO organizations (name, legal_name, status) VALUES (?, ?, ?)"
  ).run("Existing Academy #2", "Existing Academy", "active");

  db.exec(migration);
  const firstRun = {
    organizations: db.prepare("SELECT COUNT(*) AS count FROM organizations").get().count,
    memberships: db.prepare("SELECT COUNT(*) AS count FROM organization_members").get().count,
    people: db.prepare("SELECT COUNT(*) AS count FROM people").get().count,
    customerOrganization: db.prepare(
      "SELECT COUNT(*) AS count FROM organization_members m JOIN organizations o ON o.id = m.organization_id WHERE m.account_type = 'customer' AND m.account_id = 2 AND o.name = 'Existing Academy #2'"
    ).get().count,
    adminSystemPermission: db.prepare(
      "SELECT COUNT(*) AS count FROM organization_members m JOIN roles r ON r.name = m.member_role JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id WHERE m.account_type = 'user' AND m.account_id = 1 AND m.status = 'active' AND p.name = 'admin.system'"
    ).get().count,
  };

  db.exec(migration);

  const secondRun = {
    organizations: db.prepare("SELECT COUNT(*) AS count FROM organizations").get().count,
    memberships: db.prepare("SELECT COUNT(*) AS count FROM organization_members").get().count,
    people: db.prepare("SELECT COUNT(*) AS count FROM people").get().count,
    customerOrganization: db.prepare(
      "SELECT COUNT(*) AS count FROM organization_members m JOIN organizations o ON o.id = m.organization_id WHERE m.account_type = 'customer' AND m.account_id = 2 AND o.name = 'Existing Academy #2'"
    ).get().count,
    adminSystemPermission: db.prepare(
      "SELECT COUNT(*) AS count FROM organization_members m JOIN roles r ON r.name = m.member_role JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id WHERE m.account_type = 'user' AND m.account_id = 1 AND m.status = 'active' AND p.name = 'admin.system'"
    ).get().count,
  };

  assert.deepEqual(firstRun, {
    organizations: 3,
    memberships: 3,
    people: 3,
    customerOrganization: 1,
    adminSystemPermission: 1,
  });
  assert.deepEqual(secondRun, firstRun);
  db.close();
});
