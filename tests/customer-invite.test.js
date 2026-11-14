import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  hashCustomerInviteToken,
  isValidCustomerInviteToken,
} from "../functions/api/[[path]].js";

const api = fs.readFileSync(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/0018_customer_setup_invites.sql", import.meta.url), "utf8");
const adminHtml = fs.readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const adminScript = fs.readFileSync(new URL("../js/admin.js", import.meta.url), "utf8");
const inviteHtml = fs.readFileSync(new URL("../accept-invite.html", import.meta.url), "utf8");
const inviteScript = fs.readFileSync(new URL("../js/accept-invite.js", import.meta.url), "utf8");

test("customer invitation tokens are validated and hashed before storage", async () => {
  const token = "a".repeat(48);
  assert.equal(isValidCustomerInviteToken(token), true);
  assert.equal(isValidCustomerInviteToken("a".repeat(47)), false);
  assert.equal(isValidCustomerInviteToken(`${"a".repeat(47)}g`), false);

  const hash = await hashCustomerInviteToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(await hashCustomerInviteToken(token), hash);
  await assert.rejects(hashCustomerInviteToken("invalid"), TypeError);
});

test("customer invitation records enforce one pending invite and never store a raw token", () => {
  assert.match(migration, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /expires_at TEXT NOT NULL/);
  assert.match(migration, /CHECK \(status IN \('pending', 'accepted', 'revoked'\)\)/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_invites_one_pending_email/);
  assert.doesNotMatch(migration, /\btoken\s+TEXT\b/i);

  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE people (id INTEGER PRIMARY KEY); CREATE TABLE customers (id INTEGER PRIMARY KEY);");
  db.exec(migration);
  const insert = db.prepare(
    "INSERT INTO customer_invites (token_hash, email, company, expires_at) VALUES (?, ?, ?, datetime('now', '+1 day'))"
  );
  insert.run("a".repeat(64), "Customer@example.test", "Example Academy");
  assert.throws(() => insert.run("b".repeat(64), "customer@example.test", "Example Academy"), /UNIQUE/);
  db.prepare("UPDATE customer_invites SET status = 'revoked' WHERE token_hash = ?").run("a".repeat(64));
  assert.doesNotThrow(() => insert.run("c".repeat(64), "customer@example.test", "Example Academy"));
});

test("customer invite setup is authenticated, single-use, and does not put credentials in the URL", () => {
  assert.match(api, /path === "admin\/customer-invites"[\s\S]*handleAdminCustomerInvites/);
  assert.match(api, /requireSuperAdmin\(request, env\)/);
  assert.match(api, /status = 'pending' AND expires_at > datetime\('now'\)/);
  assert.match(api, /status = 'accepted', accepted_at = datetime\('now'\)/);
  assert.match(api, /path === "customer-invites\/accept"/);
  assert.match(adminHtml, /id="customerInviteForm"/);
  assert.match(adminScript, /admin\/customer-invites/);
  assert.match(adminScript, /data-customer-invite-revoke/);
  assert.match(inviteHtml, /minlength="12" maxlength="128"/);
  assert.match(inviteScript, /history\.replaceState/);
  assert.match(inviteScript, /credentials: 'omit'/);
  assert.match(inviteScript, /JSON\.stringify\(\{ token: inviteToken, password \}\)/);
});
