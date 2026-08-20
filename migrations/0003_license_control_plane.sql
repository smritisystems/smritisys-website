-- Phase 3: product editions, license entitlements, activations, and immutable events.
-- Existing products and licenses remain the authoritative legacy-compatible records.

CREATE TABLE IF NOT EXISTS product_editions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, code),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS license_editions (
  license_id INTEGER PRIMARY KEY,
  edition_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE,
  FOREIGN KEY (edition_id) REFERENCES product_editions(id)
);

CREATE TABLE IF NOT EXISTS license_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL,
  entitlement_key TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('number', 'text', 'boolean', 'json')),
  value_text TEXT,
  value_number REAL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(license_id, entitlement_key),
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS license_activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL,
  installation_id TEXT NOT NULL,
  activation_identifier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  activated_at TEXT DEFAULT (datetime('now')),
  last_seen_at TEXT DEFAULT (datetime('now')),
  deactivated_at TEXT,
  metadata_json TEXT,
  UNIQUE(license_id, activation_identifier),
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS license_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL,
  organization_id INTEGER NOT NULL,
  actor_person_id INTEGER,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'LICENSE_CREATED', 'LICENSE_UPDATED', 'LICENSE_ACTIVATED',
    'LICENSE_SUSPENDED', 'LICENSE_REACTIVATED', 'LICENSE_RENEWED',
    'LICENSE_EXPIRED', 'LICENSE_CANCELLED', 'ENTITLEMENT_CHANGED',
    'ACTIVATION_CREATED', 'ACTIVATION_REVOKED'
  )),
  previous_status TEXT,
  new_status TEXT,
  metadata_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (actor_person_id) REFERENCES people(id)
);

CREATE INDEX IF NOT EXISTS idx_product_editions_product ON product_editions(product_id, status);
CREATE INDEX IF NOT EXISTS idx_license_entitlements_license ON license_entitlements(license_id);
CREATE INDEX IF NOT EXISTS idx_license_activations_license ON license_activations(license_id, status);
CREATE INDEX IF NOT EXISTS idx_license_events_license ON license_events(license_id, created_at);
CREATE INDEX IF NOT EXISTS idx_license_events_org ON license_events(organization_id, created_at);

UPDATE licenses SET status = UPPER(status) WHERE status IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS prevent_license_events_update
BEFORE UPDATE ON license_events
BEGIN
  SELECT RAISE(ABORT, 'license_events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_license_events_delete
BEFORE DELETE ON license_events
BEGIN
  SELECT RAISE(ABORT, 'license_events are immutable');
END;

INSERT OR IGNORE INTO products (name, slug, description, price, billing_period, status)
VALUES ('SMRITI Retail OS', 'smriti-retail-os', 'SMRITI retail operations platform', 0, 'one_time', 'active');

INSERT OR IGNORE INTO permissions (name, description) VALUES
  ('license.create', 'Create licenses'),
  ('license.update', 'Update license metadata'),
  ('license.suspend', 'Suspend licenses'),
  ('license.activate', 'Activate licenses and installations'),
  ('license.renew', 'Renew licenses'),
  ('license.manage_entitlements', 'Manage license entitlements');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin')
  AND p.name IN ('license.create', 'license.update', 'license.suspend', 'license.activate', 'license.renew', 'license.manage_entitlements');
