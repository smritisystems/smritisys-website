-- Phase 5: edition-level evaluation policy and immutable signed license artifacts.

CREATE TABLE IF NOT EXISTS product_edition_license_policies (
  edition_id INTEGER PRIMARY KEY,
  subscription_grace_days INTEGER NOT NULL DEFAULT 7 CHECK (subscription_grace_days BETWEEN 0 AND 30),
  rollout_stage TEXT NOT NULL DEFAULT 'shadow' CHECK (rollout_stage IN ('shadow', 'enforced')),
  evaluation_policy_json TEXT NOT NULL DEFAULT '{"allow_dashboard":true,"allow_read_only_records":true,"allow_reports":true,"allow_backups":true,"allow_exports":true,"locked_modules":["billing","inventory_transactions","accounting","payroll"]}',
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (edition_id) REFERENCES product_editions(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS license_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL UNIQUE,
  license_id INTEGER NOT NULL,
  installation_id TEXT NOT NULL,
  activation_identifier TEXT NOT NULL,
  key_id TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm = 'Ed25519'),
  payload_base64url TEXT NOT NULL,
  signature_base64url TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (license_id) REFERENCES licenses(id),
  FOREIGN KEY (license_id, activation_identifier)
    REFERENCES license_activations(license_id, activation_identifier)
);

CREATE INDEX IF NOT EXISTS idx_license_artifacts_license
  ON license_artifacts(license_id, created_at);
CREATE INDEX IF NOT EXISTS idx_license_artifacts_installation
  ON license_artifacts(license_id, installation_id, created_at);

CREATE TRIGGER IF NOT EXISTS prevent_license_artifacts_update
BEFORE UPDATE ON license_artifacts
BEGIN
  SELECT RAISE(ABORT, 'license_artifacts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_license_artifacts_delete
BEFORE DELETE ON license_artifacts
BEGIN
  SELECT RAISE(ABORT, 'license_artifacts are immutable');
END;
