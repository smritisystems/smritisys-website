import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../portal.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../js/portal.js", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const requirementsMigration = fs.readFileSync(new URL("../migrations/0006_custom_requirements.sql", import.meta.url), "utf8");

test("customer navigation exposes only implemented workspace sections", () => {
  for (const section of ["overview", "organization", "products", "licenses", "support", "requirements", "profile"]) {
    assert.match(html, new RegExp(`data-view="${section}"`));
    assert.match(html, new RegExp(`data-section="${section}"`));
  }
  for (const removed of ["commerce", "programs", "implementation", "accounting", "retail-os"]) {
    assert.doesNotMatch(html, new RegExp(`data-view="${removed}"`));
    assert.doesNotMatch(html, new RegExp(`data-section="${removed}"`));
  }
});

test("portal customer data comes from organization and license APIs", () => {
  assert.match(script, /api\('organization'\)/);
  assert.match(script, /api\('licenses'\)/);
  assert.match(script, /licenses\/\$\{license\.id\}\/entitlements/);
  assert.match(script, /licenses\/\$\{license\.id\}\/activations/);
  assert.match(script, /licenses\/\$\{license\.id\}\/events/);
  assert.match(script, /licenses\/\$\{button\.dataset\.licenseId\}\/requests/);
  assert.doesNotMatch(html, /AMC-1042|Renews 16 January 2027|Referral rewards|62% complete/);
});

test("organization endpoint derives ownership from the authenticated membership", () => {
  assert.match(api, /path === "organization"/);
  assert.match(api, /session\.organization_id/);
  assert.match(api, /m\.account_type = 'customer' AND m\.account_id = \?/);
  assert.match(api, /organization_id !== principal\.organization_id/);
});

test("customer portal has explicit refresh, loading, empty, and error surfaces", () => {
  assert.match(html, /refresh-view/);
  assert.match(html, /Loading licenses/);
  assert.match(html, /state-panel/);
  assert.match(script, /error-state/);
  assert.match(script, /No licenses yet/);
});

test("account controls use server-side session operations", () => {
  assert.match(html, /passwordForm/);
  assert.match(html, /accountLogoutButton/);
  assert.match(script, /api\('password'/);
  assert.match(script, /api\('logout'/);
  assert.match(api, /DELETE FROM sessions WHERE token = \?/);
  assert.match(api, /DELETE FROM sessions WHERE account_type = 'customer'/);
  assert.match(api, /Current password is incorrect/);
});

test("customer license actions create requests without license mutation access", () => {
  assert.match(api, /async function handleLicenseRequest/);
  assert.match(api, /requireLicenseAccess\(request, env, licenseId, "license.view"\)/);
  assert.match(api, /INSERT INTO license_requests/);
  assert.match(api, /child === "requests" && request.method === "POST"/);
  assert.match(api, /Customer request required/);
  assert.match(api, /const allowedTypes = \["renewal", "upgrade", "additional_users", "additional_branches", "additional_modules"\]/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS license_requests/);
  assert.match(schema, /request_type TEXT NOT NULL CHECK/);
});

test("support center uses customer-scoped ticket resources", () => {
  assert.match(html, /data-view="support"/);
  assert.match(html, /ticketForm/);
  assert.match(script, /api\('tickets'/);
  assert.match(script, /tickets\/\$\{ticketId\}/);
  assert.match(script, /tickets\/\$\{form\.dataset\.ticketReply\}\/messages/);
  assert.match(api, /support\.create/);
  assert.match(api, /WHERE id = \? AND customer_id = \?/);
  assert.match(api, /Ticket not found/);
  assert.match(api, /INSERT INTO support_ticket_messages/);
  assert.match(api, /customer_id, subject, description, priority/);
});

test("custom requirements use organization-scoped request resources", () => {
  assert.match(html, /data-view="requirements"/);
  assert.match(html, /requirementForm/);
  assert.match(script, /api\('requirements'/);
  assert.match(script, /requirements\/\$\{requirementId\}/);
  assert.match(script, /requirements\/\$\{form\.dataset\.requirementReply\}\/messages/);
  assert.match(api, /requirement\.create/);
  assert.match(api, /WHERE id = \? AND organization_id = \?/);
  assert.match(api, /INSERT INTO custom_requirements/);
  assert.match(api, /Requirement not found/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS custom_requirements/);
});

test("release center consumes eligible customer releases read-only", () => {
  assert.match(html, /data-view="releases"/);
  assert.match(html, /data-section="releases"/);
  assert.match(script, /api\('releases'/);
  assert.match(html, /Latest eligible release/);
  assert.match(api, /release\.view/);
  assert.match(api, /r\.status = 'published'/);
  assert.match(api, /om\.organization_id = \?/);
  assert.match(api, /Release not found/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS releases/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS release_assets/);
});

test("commercial relationship is read-only and separate from operational accounting", () => {
  assert.match(html, /data-view="commercial"/);
  assert.match(html, /Commercial relationship/);
  assert.match(script, /api\('commercial\/summary'\)/);
  assert.match(api, /commercial\.view/);
  assert.match(api, /FROM orders WHERE customer_id = \?/);
  assert.match(api, /FROM amc_contracts WHERE customer_id = \?/);
  assert.match(api, /Order not found/);
  assert.match(api, /Operational accounting belongs to SMRITI Retail OS/);
  assert.doesNotMatch(html, /accounting|ledger|GST ledger|Sales ledger|Purchase ledger/i);
});

test("requirements migration preserves existing replies", () => {
  assert.match(requirementsMigration, /ALTER TABLE custom_requirement_messages RENAME TO custom_requirement_messages_legacy/);
  assert.match(requirementsMigration, /INSERT INTO custom_requirement_messages \(id, requirement_id, author_type, author_id, message, created_at\)/);
  assert.doesNotMatch(requirementsMigration, /DROP TABLE IF EXISTS custom_requirement_messages/);
});
