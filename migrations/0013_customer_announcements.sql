-- Phase 13: preserve existing customer notices while adding product/status targeting.

DROP INDEX IF EXISTS idx_announcements_status;
ALTER TABLE announcements RENAME TO announcements_legacy;

CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'customer',
  product_id INTEGER,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'maintenance', 'degraded', 'outage')),
  published_at TEXT,
  status TEXT DEFAULT 'draft',
  starts_at TEXT NOT NULL DEFAULT (datetime('now')),
  ends_at TEXT,
  created_by INTEGER,
  updated_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

INSERT INTO announcements (id, title, message, audience, published_at, status, starts_at, created_at, updated_at)
SELECT id, title, message, COALESCE(audience, 'customer'), published_at,
       COALESCE(status, 'draft'), COALESCE(published_at, created_at, datetime('now')),
       COALESCE(created_at, datetime('now')), COALESCE(created_at, datetime('now'))
FROM announcements_legacy;

CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status, audience);
CREATE INDEX IF NOT EXISTS idx_announcements_visibility
  ON announcements(status, starts_at, ends_at, product_id);