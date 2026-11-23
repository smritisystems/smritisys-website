import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../partner.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../js/partner.js", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

test("partner portal is an authenticated workspace, not a placeholder", () => {
  assert.match(html, /login\.html\?entry=partner/);
  assert.doesNotMatch(html, /partnerLoginForm/);
  assert.match(html, /data-partner-view="customers"/);
  assert.match(html, /data-partner-view="deals"/);
  assert.match(html, /id="partnerDealForm"/);
  assert.match(html, /Submission does not promise deal protection/);
  assert.match(html, /data-partner-view="licenses"/);
  assert.match(html, /data-partner-view="releases"/);
  assert.match(script, /partnerApi\('partner\/me'\)/);
  assert.match(script, /partnerApi\('partner\/deals'/);
  assert.match(script, /initializePartnerPortal\(\)/);
  assert.doesNotMatch(html, /Register customer|View commissions|View licenses/);
});

test("partner profiles display readable partner type and role labels", () => {
  assert.match(script, /channel_partner: 'Channel partner'/);
  assert.match(script, /distributor: 'Distributor'/);
  assert.match(script, /partner_admin: 'Partner administrator'/);
  assert.match(script, /partner_member: 'Partner member'/);
  assert.match(script, /partnerDisplayLabel\(partner\.partner_type, PARTNER_TYPE_LABELS\)/);
  assert.match(script, /partnerDisplayLabel\(partner\.partner_role, PARTNER_ROLE_LABELS\)/);
  assert.doesNotMatch(script, /textContent = `\$\{partner\.partner_type\}/);
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
  assert.match(schema, /CREATE TABLE IF NOT EXISTS deal_registrations/);
  assert.match(schema, /partner\.deals\.submit/);
  assert.match(schema, /'partner_admin'/);
  assert.match(schema, /'partner_member'/);
});
