-- Phase 6: prevent replay of a signed refresh request within its validity window.

CREATE TABLE IF NOT EXISTS license_refresh_nonces (
  license_id INTEGER NOT NULL,
  activation_identifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (license_id, activation_identifier, nonce),
  FOREIGN KEY (license_id, activation_identifier)
    REFERENCES license_activations(license_id, activation_identifier)
);

CREATE INDEX IF NOT EXISTS idx_license_refresh_nonces_created
  ON license_refresh_nonces(created_at);
