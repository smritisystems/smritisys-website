import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const api = fs.readFileSync(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/0002_identity_rbac.sql", import.meta.url), "utf8");
const rateLimitMigration = fs.readFileSync(new URL("../migrations/0012_rate_limits.sql", import.meta.url), "utf8");
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
  assert.match(api, /admin\.system/);
  assert.match(schema, /'support\.create'/);
});

test("production CORS requires explicit allowed origins", () => {
  assert.match(api, /typeof env\.ALLOWED_ORIGINS === "string"/);
  assert.match(api, /if \(!configuredOrigins\.trim\(\)\) return null/);
  assert.doesNotMatch(api, /env\.ALLOWED_ORIGINS \|\| "https:\/\/smritisys\.com/);
});

test("browser sessions use an HttpOnly cookie while bearer clients remain supported", () => {
  assert.match(api, /smritisys_session/);
  assert.match(api, /HttpOnly/);
  assert.match(api, /requestSessionToken/);
  assert.match(fs.readFileSync(new URL("../js/portal.js", import.meta.url), "utf8"), /credentials: 'same-origin'/);
  assert.doesNotMatch(fs.readFileSync(new URL("../js/portal.js", import.meta.url), "utf8"), /localStorage\.setItem\(['"]smritisys_token/);
});

test("sensitive public endpoints use D1-backed rate limits", () => {
  assert.match(api, /async function enforceRateLimit/);
  assert.match(api, /Retry-After/);
  for (const scope of ["demo", "signup", "login", "password"]) assert.match(api, new RegExp(`\"${scope}\"`));
  assert.match(schema, /CREATE TABLE IF NOT EXISTS rate_limit_buckets/);
  assert.match(rateLimitMigration, /CREATE TABLE IF NOT EXISTS rate_limit_buckets/);
});

test("fresh schema seeds the same RBAC catalog", () => {
  assert.match(schema, /INSERT OR IGNORE INTO roles/);
  assert.match(schema, /INSERT OR IGNORE INTO permissions/);
  assert.match(schema, /INSERT OR IGNORE INTO role_permissions/);
});

test("bootstrap documentation includes the secret header", () => {
  assert.match(readme, /X-Staff-Bootstrap/);
});
