-- One-time, expiring customer setup invitations.
CREATE TABLE IF NOT EXISTS customer_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT,
  company TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_by INTEGER,
  customer_id INTEGER UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  FOREIGN KEY (created_by) REFERENCES people(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_invites_email_status
  ON customer_invites(email, status);
CREATE INDEX IF NOT EXISTS idx_customer_invites_expiry
  ON customer_invites(status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_invites_one_pending_email
  ON customer_invites(lower(email)) WHERE status = 'pending';
