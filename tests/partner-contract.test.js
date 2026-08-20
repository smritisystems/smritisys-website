import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../partner.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../js/partner.js", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

test("partner portal is an authenticated workspace, not a placeholder", () => {
  assert.match(html, /partnerLoginForm/);
  assert.match(html, /data-partner-view="customers"/);
  assert.match(html, /data-partner-view="licenses"/);
  assert.match(html, /data-partner-view="releases"/);
  assert.match(script, /partnerApi\('partner\/me'\)/);
  assert.doesNotMatch(html, /Register customer|View commissions|View licenses/);
});

test("partner APIs reuse session identity and partner membership scope", () => {
  assert.match(api, /async function getPartnerSession/);
  assert.match(api, /async function hasPartnerPermission/);
  assert.match(api, /partner_memberships/);
  assert.match(api, /partner_customer_links/);
  assert.match(api, /path\.startsWith\("partner\/"\)/);
  assert.match(api, /Partner access required/);
});

test("partner relationship tables and RBAC roles exist", () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS partner_memberships/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS partner_customer_links/);
  assert.match(schema, /'partner_admin'/);
  assert.match(schema, /'partner_member'/);
});
