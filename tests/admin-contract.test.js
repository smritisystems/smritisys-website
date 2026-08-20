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
  assert.match(api, /Super admin access required/);
});
