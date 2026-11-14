/**
 * @file        custom-requirements-migration.test.js
 * @project     PrathamOne EduOS Coaching Institute Management System
 * @module      SMRITISYS migration tests
 *
 * @author      Jawahar R. Mallah
 * @organization AITDL (AI Technology & Development Lab)
 * @client      Prashant Academy Coaching Institute
 * @copyright   Copyright (c) 2026 AITDL
 * @license     Proprietary
 *
 * @version     1.0.0
 * @created     2026-11-14
 * @updated     2026-11-14
 *
 * @description Checks compatibility with production's legacy requirements schema.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/0006_custom_requirements.sql", import.meta.url), "utf8");

test("custom requirements migration creates the missing legacy messages table before rebuilding it", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  db.exec("DROP TABLE custom_requirement_messages");

  assert.doesNotThrow(() => db.exec(migration));
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'custom_requirement_messages'").get().count,
    1
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});
