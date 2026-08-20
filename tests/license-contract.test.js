import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { LICENSE_TRANSITIONS, licenseValidity } from "../functions/api/[[path]].js";

const api = fs.readFileSync(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/0003_license_control_plane.sql", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const docs = fs.readFileSync(new URL("../docs/LICENSE_ARCHITECTURE.md", import.meta.url), "utf8");

test("license domain tables and extensible entitlements exist", () => {
  for (const table of ["product_editions", "license_editions", "license_entitlements", "license_activations", "license_events"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /UNIQUE\(license_id, entitlement_key\)/);
  assert.match(migration, /UNIQUE\(license_id, activation_identifier\)/);
});

test("license reads are organization-scoped for customers", () => {
  assert.match(api, /principal\.account_type === "customer" && license\.organization_id !== principal\.organization_id/);
  assert.match(api, /om\.organization_id = \?/);
  assert.match(api, /License not found/);
});

test("license mutations use explicit permissions and transitions", () => {
  for (const permission of ["license.create", "license.update", "license.suspend", "license.activate", "license.renew", "license.manage_entitlements"]) {
    assert.match(api, new RegExp(permission.replace(".", "\\.")));
  }
  assert.match(api, /const LICENSE_TRANSITIONS/);
  assert.match(api, /Use an explicit license transition endpoint/);
  assert.match(api, /Only active licenses can be suspended/);
});

test("license validity is calculated without mutating stored status", () => {
  assert.match(api, /function licenseValidity/);
  assert.match(api, /is_valid/);
  assert.match(api, /is_expired/);
  assert.doesNotMatch(api, /UPDATE licenses SET status.*licenseValidity/);
});

test("license state transitions and expiry calculation are executable", () => {
  assert.deepEqual(LICENSE_TRANSITIONS.DRAFT, ["ACTIVE", "CANCELLED"]);
  assert.deepEqual(LICENSE_TRANSITIONS.CANCELLED, []);
  assert.equal(licenseValidity("ACTIVE", "2000-01-01", "2999-12-31").is_valid, true);
  assert.equal(licenseValidity("ACTIVE", "2000-01-01", "2000-01-02").is_expired, true);
  assert.equal(licenseValidity("EXPIRED", "2000-01-01", null).is_valid, false);
});

test("activation requests are idempotent and events are separate from audit logs", () => {
  assert.match(api, /INSERT OR IGNORE INTO license_activations/);
  assert.match(api, /ACTIVATION_CREATED/);
  assert.match(api, /recordLicenseEvent/);
  assert.match(api, /writeAudit/);
});

test("license architecture documents the Retail OS boundary and state machine", () => {
  assert.match(docs, /SMRITI Retail OS remains the authority/);
  assert.match(docs, /DRAFT.*ACTIVE, CANCELLED/);
  assert.match(docs, /license_entitlements/);
});
