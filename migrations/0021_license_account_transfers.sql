ALTER TABLE licenses ADD COLUMN registered_email TEXT;

UPDATE licenses
SET registered_email = COALESCE(
  (SELECT contact_email FROM license_code_inventory WHERE license_id = licenses.id),
  (SELECT issued_to_email FROM license_code_inventory WHERE license_id = licenses.id),
  (SELECT email FROM customers WHERE id = licenses.customer_id)
)
WHERE registered_email IS NULL;

CREATE INDEX IF NOT EXISTS idx_licenses_registered_email
  ON licenses(registered_email, product_id);

CREATE TABLE IF NOT EXISTS license_email_verifications (
  challenge_id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('activation', 'email_change')),
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  product_code TEXT NOT NULL,
  company_binding TEXT NOT NULL,
  license_id INTEGER REFERENCES licenses(id),
  target_email TEXT,
  installation_id TEXT,
  activation_identifier TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  current_email_verified_at TEXT,
  verified_at TEXT,
  consumed_at TEXT,
  CHECK (
    (purpose = 'activation' AND license_id IS NULL AND target_email IS NULL)
    OR (purpose = 'email_change' AND license_id IS NOT NULL AND target_email IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_license_email_verifications_email
  ON license_email_verifications(email, purpose, created_at);
CREATE INDEX IF NOT EXISTS idx_license_email_verifications_license
  ON license_email_verifications(license_id, purpose, created_at);
