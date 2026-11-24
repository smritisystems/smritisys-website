ALTER TABLE license_reactivation_requests
  ADD COLUMN surrendered_activation_id INTEGER
  REFERENCES license_activations(id);

CREATE INDEX IF NOT EXISTS idx_license_reactivation_surrendered_activation
  ON license_reactivation_requests(surrendered_activation_id);
