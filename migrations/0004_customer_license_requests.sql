-- Phase 4: customer-initiated, read-only license change requests.

CREATE TABLE IF NOT EXISTS license_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL,
  organization_id INTEGER NOT NULL,
  requester_person_id INTEGER NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('renewal', 'upgrade', 'additional_users', 'additional_branches', 'additional_modules')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'completed', 'declined')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (requester_person_id) REFERENCES people(id)
);

CREATE INDEX IF NOT EXISTS idx_license_requests_org ON license_requests(organization_id, created_at);