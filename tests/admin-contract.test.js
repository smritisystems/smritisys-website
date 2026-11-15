/**
 * @file        admin-contract.test.js
 * @project     PrathamOne EduOS Coaching Institute Management System
 * @module      SMRITISYS admin contract tests
 *
 * @author      Jawahar R. Mallah
 * @organization AITDL (AI Technology & Development Lab)
 * @client      Prashant Academy Coaching Institute
 * @copyright   Copyright (c) 2026 AITDL
 * @license     Proprietary
 *
 * @version     1.0.0
 * @created     2026-11-06
 * @updated     2026-11-15
 *
 * @description Verifies the authenticated admin page contract and its API boundaries.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../js/admin.js", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const d1Worker = fs.readFileSync(new URL("../d1-ops/src/index.js", import.meta.url), "utf8");
const d1WorkerConfig = fs.readFileSync(new URL("../d1-ops/wrangler.jsonc", import.meta.url), "utf8");

 test("admin control plane is a separate authenticated workspace", () => {
  assert.match(html, /adminLoginForm/);
  assert.match(html, /data-admin-view="users"/);
  assert.match(html, /data-admin-view="organizations"/);
  assert.match(html, /data-admin-view="audit"/);
  assert.match(html, /data-admin-view="announcements"/);
  assert.match(html, /data-admin-view="security"/);
  assert.match(html, /id="adminPasswordForm" class="card" method="post"/);
  assert.match(script, /adminApi\('admin\/password'/);
  assert.match(script, /adminApi\('admin\/announcements'\)/);
  assert.match(script, /adminApi\('admin\/overview'\)/);
  assert.match(script, /adminApi\('admin\/organizations'\)/);
  assert.match(script, /adminApi\('admin\/audit'\)/);
});

test("admin endpoints require the super-admin guard", () => {
  assert.match(api, /async function handleAdminControl/);
  assert.match(api, /requireSuperAdmin\(request, env\)/);
  assert.match(api, /admin\/overview/);
  assert.match(api, /admin\/organizations/);
  assert.match(api, /admin\/audit/);
  assert.match(api, /admin\/announcements/);
  assert.match(api, /handleAdminAnnouncements/);
  assert.match(api, /Super admin access required/);
});

test("license workspace exposes issuance, lifecycle, activation, and edition policy controls", () => {
  assert.match(html, /id="licenseIssueForm"/);
  assert.match(html, /id="licensePolicyForm"/);
  assert.match(html, /id="adminLicensesList"/);
  assert.match(html, /role="tablist" aria-label="Product and license workspaces"/);
  assert.match(html, /data-product-tab="inventory"/);
  assert.match(html, /data-product-panel="issuance"/);
  assert.match(html, /id="adminRegistrationMetrics"/);
  assert.match(html, /id="adminRegistrationFilters"/);
  assert.match(html, /id="adminRegistrationPagination"/);
  assert.match(script, /data-license-suspend/);
  assert.match(script, /data-license-renew/);
  assert.match(script, /data-activation-revoke/);
  assert.match(script, /admin\/license-registrations/);
  assert.match(script, /registered_email_masked/);
  assert.match(script, /License-registered email/);
  assert.match(script, /evaluation-policy/);
  assert.match(script, /company\.binding/);
});

test("license inventory reveals one encrypted key only after admin password confirmation", () => {
  assert.match(html, /encrypted at rest and can be revealed one at a time/);
  assert.match(html, /id="licenseCodeRestoreForm"/);
  assert.match(script, /New keys can be revealed individually later/);
  assert.match(html, /id="licenseCodeRevealDialog"/);
  assert.match(html, /id="licenseCodeRevealPassword" type="password" autocomplete="current-password"/);
  assert.match(html, /js\/admin\.js\?v=admin-partner-sales-inventory-v1/);
  assert.match(script, /data-license-code-reveal-serial/);
  assert.match(script, /data-license-code-restore-serial/);
  assert.match(script, /\/restore/);
  assert.match(script, /licenseCodeRevealKey/);
  assert.match(api, /LICENSE_CODE_ENCRYPTION_KEY/);
  assert.match(api, /activation_key_ciphertext/);
  assert.match(api, /verifyPassword\(body\.password, user\.password_hash\)/);
  assert.match(api, /LICENSE_CODE_REVEALED/);
  assert.match(api, /"Cache-Control": "no-store"/);
  assert.match(api, /segments\[4\] === "reveal"/);
  assert.match(api, /segments\[4\] === "restore"/);
});

test("overview displays authorized live license health, inventory, and recent activity", () => {
  assert.match(html, /id="adminOperationsMetrics"/);
  assert.match(html, /id="adminLicenseHealth"/);
  assert.match(html, /id="adminRecentActivity"/);
  assert.match(script, /adminApi\('admin\/overview'\)/);
  assert.match(script, /data\.license_statuses/);
  assert.match(script, /data\.code_inventory/);
  assert.match(api, /requireSuperAdmin\(request, env\)/);
  assert.match(api, /recent_activity: recentActivity\.results/);
});

test("D1 monitoring is super-admin read-only and the sampler needs no R2 backup service", () => {
  assert.match(html, /id="adminD1Content"/);
  assert.match(html, /id="adminD1Refresh"/);
  assert.match(html, /Automated backups are disabled/);
  assert.match(script, /adminApi\('admin\/d1-operations'\)/);
  assert.match(script, /data\.backup_status === 'disabled'/);
  assert.match(api, /path === "admin\/d1-operations" && request\.method === "GET"/);
  assert.match(api, /d1_storage_snapshots/);
  assert.match(api, /WHERE database_name = 'smritisys-db'/);
  assert.match(api, /databases: \["smritisys-db"\]/);
  assert.match(api, /backup_status: "disabled"/);
  assert.match(api, /free_per_database_bytes/);
  assert.match(d1WorkerConfig, /"crons": \["0 2 \* \* \*"\]/);
  assert.match(d1WorkerConfig, /19066da9-8183-42cb-92e3-c64d1ee799de/);
  assert.doesNotMatch(d1WorkerConfig, /smritisys-db-recovery|67114a4c-c167-40db-8a58-00a5b9bf15cf|DB_SECONDARY/);
  assert.match(d1Worker, /scheduled\(controller, env, ctx\)/);
  assert.match(d1Worker, /d1_storage_snapshots/);
  assert.match(d1Worker, /env\.DB/);
  assert.doesNotMatch(d1WorkerConfig, /r2_buckets|workflows/);
  assert.doesNotMatch(d1Worker, /BACKUP_BUCKET|D1_REST_API_TOKEN|api\.cloudflare\.com\/client\/v4\/accounts/);
  assert.doesNotMatch(d1WorkerConfig, /D1_REST_API_TOKEN/);
});
