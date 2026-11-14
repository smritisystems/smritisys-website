import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { LICENSE_TRANSITIONS, calculateLicenseMode, licenseValidity } from "../functions/api/[[path]].js";

const api = fs.readFileSync(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/0003_license_control_plane.sql", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const artifactMigration = fs.readFileSync(new URL("../migrations/0014_signed_license_artifacts.sql", import.meta.url), "utf8");
const productMigration = fs.readFileSync(new URL("../migrations/0015_prathamone_product_registration.sql", import.meta.url), "utf8");
const refreshKeyMigration = fs.readFileSync(new URL("../migrations/0016_license_activation_refresh_keys.sql", import.meta.url), "utf8");
const refreshReplayMigration = fs.readFileSync(new URL("../migrations/0017_license_refresh_replay_protection.sql", import.meta.url), "utf8");
const docs = fs.readFileSync(new URL("../docs/LICENSE_ARCHITECTURE.md", import.meta.url), "utf8");

test("license domain tables and extensible entitlements exist", () => {
  for (const table of ["product_editions", "license_editions", "license_entitlements", "license_activations", "license_events"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /UNIQUE\(license_id, entitlement_key\)/);
  assert.match(migration, /UNIQUE\(license_id, activation_identifier\)/);
  for (const table of ["product_edition_license_policies", "license_artifacts"]) {
    assert.match(artifactMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(schema, /CREATE TABLE IF NOT EXISTS license_refresh_nonces/);
  assert.match(artifactMigration, /prevent_license_artifacts_update/);
  assert.match(artifactMigration, /prevent_license_artifacts_delete/);
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

test("signed license mode preserves perpetual use and applies seven-day subscription grace", () => {
  const now = new Date("2026-11-16T12:00:00.000Z");
  assert.equal(calculateLicenseMode({
    status: "ACTIVE",
    model: "on_premise_perpetual",
    expiresAt: "2000-01-01",
    now,
  }), "active");
  assert.equal(calculateLicenseMode({
    status: "EXPIRED",
    model: "on_premise_subscription",
    expiresAt: "2026-11-10",
    graceDays: 7,
    now,
  }), "grace");
  assert.equal(calculateLicenseMode({
    status: "EXPIRED",
    model: "on_premise_subscription",
    expiresAt: "2026-11-08",
    graceDays: 7,
    now,
  }), "evaluation");
});

test("activation requests are idempotent and events are separate from audit logs", () => {
  assert.match(api, /INSERT OR IGNORE INTO license_activations/);
  assert.match(api, /ACTIVATION_CREATED/);
  assert.match(api, /recordLicenseEvent/);
  assert.match(api, /writeAudit/);
  assert.match(api, /typeof expectedCompanyBinding !== "string"/);
  assert.match(api, /A non-empty text company\.binding entitlement is required/);
  assert.match(api, /keys\.has\(item\.key\)/);
});

test("license architecture documents the Retail OS boundary and state machine", () => {
  assert.match(docs, /SMRITI Retail OS remains the authority/);
  assert.match(docs, /DRAFT.*ACTIVE, CANCELLED/);
  assert.match(docs, /license_entitlements/);
});

test("PrathamOne uses its canonical product and Coaching Institute edition records", () => {
  assert.match(productMigration, /'prathamone-eduos'/);
  assert.match(productMigration, /'coaching-institute'/);
  assert.match(productMigration, /'Coaching Institute Edition'/);
  assert.match(productMigration, /subscription_grace_days, rollout_stage/);
});

test("installation refresh is signed, replay-protected, and reuses the activation identity", () => {
  assert.match(refreshKeyMigration, /ALTER TABLE license_activations ADD COLUMN refresh_public_key TEXT/);
  assert.match(refreshReplayMigration, /CREATE TABLE IF NOT EXISTS license_refresh_nonces/);
  assert.match(refreshReplayMigration, /PRIMARY KEY \(license_id, activation_identifier, nonce\)/);
  assert.match(api, /function buildSignedLicenseArtifact/);
  assert.match(api, /async function refreshLicense/);
  assert.match(api, /license\/refresh.*request\.method === "POST"/);
  assert.match(api, /crypto\.subtle\.verify\(\{ name: "Ed25519" \}, publicKey, signature, message\)/);
  assert.match(api, /Refresh request has already been used/);
  assert.match(api, /license\.activation_status === "revoked" \? "SUSPENDED" : license\.status/);
  assert.match(api, /LICENSE_ARTIFACT_REFRESHED/);
});
