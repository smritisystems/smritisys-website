-- Unassigned customer activation codes and installation-bound license snapshots.

ALTER TABLE licenses ADD COLUMN serial_number TEXT;
ALTER TABLE licenses ADD COLUMN offline_validity_days INTEGER NOT NULL DEFAULT 7
  CHECK (offline_validity_days BETWEEN 1 AND 365);
ALTER TABLE organizations ADD COLUMN address TEXT;
ALTER TABLE organizations ADD COLUMN city TEXT;
ALTER TABLE organizations ADD COLUMN state TEXT;
ALTER TABLE organizations ADD COLUMN pincode TEXT;
ALTER TABLE organizations ADD COLUMN tax_id TEXT;
ALTER TABLE organizations ADD COLUMN website TEXT;

UPDATE licenses
SET serial_number = 'SMR-LIC-' || printf('%08d', id)
WHERE serial_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_serial_number
  ON licenses(serial_number);

CREATE TABLE IF NOT EXISTS license_code_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  serial_number TEXT NOT NULL UNIQUE,
  activation_key_hash TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL,
  edition_id INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  expires_at TEXT,
  license_model TEXT NOT NULL CHECK (license_model IN (
    'cloud_subscription', 'cloud_one_time',
    'on_premise_subscription', 'on_premise_perpetual'
  )),
  seats INTEGER NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 10000),
  entitlements_json TEXT NOT NULL DEFAULT '[]',
  offline_validity_days INTEGER NOT NULL DEFAULT 90
    CHECK (offline_validity_days BETWEEN 7 AND 365),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'claiming', 'claimed', 'revoked')),
  license_id INTEGER UNIQUE,
  company_binding TEXT,
  installation_id TEXT,
  activation_identifier TEXT,
  contact_email TEXT,
  created_by_person_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at TEXT,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (edition_id) REFERENCES product_editions(id),
  FOREIGN KEY (license_id) REFERENCES licenses(id),
  FOREIGN KEY (created_by_person_id) REFERENCES people(id)
);

CREATE INDEX IF NOT EXISTS idx_license_code_inventory_batch
  ON license_code_inventory(batch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_license_code_inventory_status
  ON license_code_inventory(status, product_id, edition_id);
