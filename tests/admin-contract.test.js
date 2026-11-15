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
  assert.match(script, /data-license-suspend/);
  assert.match(script, /data-license-renew/);
  assert.match(script, /data-activation-revoke/);
  assert.match(script, /evaluation-policy/);
  assert.match(script, /company\.binding/);
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
