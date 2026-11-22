import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const migration = fs.readFileSync(
  new URL("../migrations/0031_identity_organization_scope.sql", import.meta.url),
  "utf8",
);

test("organization-scope migration backfills only unambiguous active memberships", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE organizations (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE organization_members (
      organization_id INTEGER, account_type TEXT, account_id INTEGER,
      member_role TEXT, status TEXT
    );
    CREATE TABLE partner_memberships (
      partner_organization_id INTEGER, account_type TEXT, account_id INTEGER,
      partner_role TEXT, status TEXT
    );
    CREATE TABLE relationships (
      organization_id INTEGER, relationship_type TEXT, status TEXT
    );
    CREATE TABLE customers (id INTEGER PRIMARY KEY);
    CREATE TABLE licenses (id INTEGER PRIMARY KEY, customer_id INTEGER);
    CREATE TABLE support_tickets (id INTEGER PRIMARY KEY, customer_id INTEGER);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER);
    CREATE TABLE amc_contracts (id INTEGER PRIMARY KEY, customer_id INTEGER);

    INSERT INTO organizations VALUES
      (10, 'active'), (20, 'active'), (21, 'active'), (30, 'active'), (31, 'active');
    INSERT INTO organization_members VALUES
      (10, 'customer', 1, 'customer', 'active'),
      (20, 'customer', 2, 'customer', 'active'),
      (21, 'customer', 2, 'customer', 'active'),
      (30, 'customer', 3, 'customer', 'active'),
      (30, 'customer', 4, 'customer', 'inactive');
    INSERT INTO relationships VALUES
      (30, 'reseller', 'active'),
      (31, 'distributor', 'active');
    INSERT INTO partner_memberships VALUES
      (30, 'customer', 3, 'partner_admin', 'active'),
      (30, 'customer', 4, 'partner_admin', 'active'),
      (31, 'customer', 5, 'partner_member', 'active'),
      (31, 'customer', 6, 'partner_admin', 'inactive');
    INSERT INTO licenses VALUES (1, 1), (2, 2);
    INSERT INTO support_tickets VALUES (1, 1), (2, 2);
    INSERT INTO orders VALUES (1, 1), (2, 2);
    INSERT INTO amc_contracts VALUES (1, 1), (2, 2);
  `);

  db.exec(migration);

  for (const table of ["licenses", "support_tickets", "orders", "amc_contracts"]) {
    assert.equal(db.prepare(`SELECT organization_id FROM ${table} WHERE id = 1`).get().organization_id, 10);
    assert.equal(db.prepare(`SELECT organization_id FROM ${table} WHERE id = 2`).get().organization_id, null);
  }
  assert.equal(
    db.prepare("SELECT member_role FROM organization_members WHERE account_id = 3").get().member_role,
    "partner_admin",
  );
  assert.equal(
    db.prepare("SELECT member_role FROM organization_members WHERE account_id = 4").get().member_role,
    "customer",
  );
  assert.equal(
    db.prepare("SELECT member_role FROM organization_members WHERE organization_id = 31 AND account_id = 5").get().member_role,
    "partner_member",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM organization_members WHERE organization_id = 31 AND account_id = 6").get().count,
    0,
  );
  db.close();
});
