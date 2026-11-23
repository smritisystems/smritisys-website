CREATE TABLE IF NOT EXISTS license_reactivation_requests (
  request_id TEXT PRIMARY KEY,
  license_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  organization_id INTEGER,
  requester_person_id INTEGER NOT NULL,
  product_code TEXT NOT NULL,
  company_binding TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  activation_identifier TEXT NOT NULL,
  refresh_public_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'expired')),
  replaced_activation_id INTEGER,
  decision_reason TEXT,
  reviewed_by_person_id INTEGER,
  phone_confirmed_at TEXT,
  cooldown_override INTEGER NOT NULL DEFAULT 0 CHECK (cooldown_override IN (0, 1)),
  notification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending', 'sent', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  reviewed_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (requester_person_id) REFERENCES people(id),
  FOREIGN KEY (replaced_activation_id) REFERENCES license_activations(id),
  FOREIGN KEY (reviewed_by_person_id) REFERENCES people(id)
);

CREATE INDEX IF NOT EXISTS idx_license_reactivation_requests_status
  ON license_reactivation_requests(status, created_at);

CREATE INDEX IF NOT EXISTS idx_license_reactivation_requests_customer
  ON license_reactivation_requests(customer_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_license_reactivation_requests_active_target
  ON license_reactivation_requests(license_id, activation_identifier)
  WHERE status IN ('pending', 'approved');
