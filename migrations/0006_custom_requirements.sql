-- Phase 6: upgrade the legacy custom requirement table without losing data.

PRAGMA foreign_keys = OFF;

ALTER TABLE custom_requirements RENAME TO custom_requirements_legacy;

CREATE TABLE custom_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  organization_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  business_need TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'submitted',
  feasibility TEXT,
  scope TEXT,
  estimate_amount REAL,
  target_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

INSERT INTO custom_requirements
  (id, customer_id, organization_id, title, description, business_need, category, priority,
   status, feasibility, scope, estimate_amount, target_date, created_at, updated_at)
SELECT r.id,
       r.customer_id,
       (SELECT m.organization_id FROM organization_members m
        WHERE m.account_type = 'customer' AND m.account_id = r.customer_id
          AND m.status = 'active' ORDER BY m.id LIMIT 1),
       r.title,
      COALESCE(r.business_need, ''),
       r.business_need,
      'general',
      'normal',
       COALESCE(r.status, 'submitted'),
       r.feasibility,
       r.scope,
       r.estimate_amount,
       r.target_date,
       r.created_at,
       r.updated_at
FROM custom_requirements_legacy r;

DROP TABLE custom_requirements_legacy;

ALTER TABLE custom_requirement_messages RENAME TO custom_requirement_messages_legacy;

CREATE TABLE custom_requirement_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requirement_id INTEGER NOT NULL,
  author_type TEXT NOT NULL,
  author_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (requirement_id) REFERENCES custom_requirements(id) ON DELETE CASCADE
);

INSERT INTO custom_requirement_messages (id, requirement_id, author_type, author_id, message, created_at)
SELECT id, requirement_id, author_type, author_id, message, created_at
FROM custom_requirement_messages_legacy;

DROP TABLE custom_requirement_messages_legacy;

CREATE INDEX IF NOT EXISTS idx_custom_requirements_org ON custom_requirements(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_custom_requirement_messages ON custom_requirement_messages(requirement_id, created_at);

PRAGMA foreign_keys = ON;