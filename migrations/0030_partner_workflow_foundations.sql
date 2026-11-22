CREATE INDEX IF NOT EXISTS idx_support_tickets_status_created
  ON support_tickets(status, created_at, id);

CREATE TABLE IF NOT EXISTS deal_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_organization_id INTEGER NOT NULL,
  submitted_by_person_id INTEGER NOT NULL,
  prospect_organization_name TEXT NOT NULL,
  website TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  summary TEXT NOT NULL,
  partner_response TEXT,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'under_review', 'needs_information', 'approved', 'rejected')),
  decision_summary TEXT,
  internal_note TEXT,
  reviewed_by_person_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (partner_organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (submitted_by_person_id) REFERENCES people(id),
  FOREIGN KEY (reviewed_by_person_id) REFERENCES people(id)
);

CREATE INDEX IF NOT EXISTS idx_deal_registrations_partner_status_created
  ON deal_registrations(partner_organization_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_deal_registrations_status_created
  ON deal_registrations(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_deal_registrations_prospect_name
  ON deal_registrations(lower(prospect_organization_name));
CREATE INDEX IF NOT EXISTS idx_deal_registrations_contact_email
  ON deal_registrations(lower(contact_email)) WHERE contact_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS follow_up_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to_user_id INTEGER,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  created_by_person_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (assigned_to_user_id) REFERENCES users(id),
  FOREIGN KEY (created_by_person_id) REFERENCES people(id)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_status_due
  ON follow_up_tasks(status, due_date, id);
CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_assignee_status_due
  ON follow_up_tasks(assigned_to_user_id, status, due_date, id);
INSERT OR IGNORE INTO permissions (name, description)
VALUES ('partner.deals.submit', 'Submit and view partner deal registrations');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('partner_admin', 'partner_member')
  AND p.name = 'partner.deals.submit';
