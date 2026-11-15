-- Track code delivery separately from activation lifecycle.

ALTER TABLE license_code_inventory ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'not_issued'
  CHECK (delivery_status IN ('not_issued', 'issued'));
ALTER TABLE license_code_inventory ADD COLUMN issued_to_name TEXT;
ALTER TABLE license_code_inventory ADD COLUMN issued_to_organization TEXT;
ALTER TABLE license_code_inventory ADD COLUMN issued_to_email TEXT;
ALTER TABLE license_code_inventory ADD COLUMN delivery_channel TEXT
  CHECK (delivery_channel IN ('email', 'messaging', 'phone', 'in_person', 'other', 'activation'));
ALTER TABLE license_code_inventory ADD COLUMN delivery_reference TEXT;
ALTER TABLE license_code_inventory ADD COLUMN issued_at TEXT;
ALTER TABLE license_code_inventory ADD COLUMN issued_by_person_id INTEGER REFERENCES people(id);

UPDATE license_code_inventory
SET delivery_status = 'issued',
    issued_to_email = contact_email,
    delivery_channel = 'activation',
    issued_at = claimed_at
WHERE status = 'claimed';

CREATE INDEX IF NOT EXISTS idx_license_code_inventory_delivery
  ON license_code_inventory(batch_id, delivery_status, status);
