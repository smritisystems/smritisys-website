import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const api = fs.readFileSync(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/0002_identity_rbac.sql", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("staff bootstrap is one-time and environment-gated", () => {
  assert.match(api, /X-Staff-Bootstrap/);
  assert.match(api, /STAFF_BOOTSTRAP_TOKEN/);
  assert.match(api, /staff_bootstrap_consumed/);
  assert.match(api, /WHERE changes\(\) = 1/);
});

test("identity migration contains unified records and repeatable backfills", () => {
  for (const table of ["people", "roles", "permissions", "role_permissions", "audit_logs"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /INSERT OR IGNORE INTO people/);
  assert.match(migration, /INSERT OR IGNORE INTO organization_members/);
});

test("server authorization uses organization membership permissions", () => {
  assert.match(api, /async function hasPermission/);
  assert.match(api, /JOIN role_permissions/);
  assert.match(api, /organization_id = \?/);
  assert.match(api, /support\.create/);
  assert.match(api, /admin\.system/);
});

test("fresh schema seeds the same RBAC catalog", () => {
  assert.match(schema, /INSERT OR IGNORE INTO roles/);
  assert.match(schema, /INSERT OR IGNORE INTO permissions/);
  assert.match(schema, /INSERT OR IGNORE INTO role_permissions/);
});

test("bootstrap documentation includes the secret header", () => {
  assert.match(readme, /X-Staff-Bootstrap/);
});
