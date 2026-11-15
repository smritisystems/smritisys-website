ALTER TABLE licenses ADD COLUMN last_self_service_transfer_at TEXT;
ALTER TABLE licenses ADD COLUMN last_self_service_transfer_id TEXT;

UPDATE licenses
SET offline_validity_days = 14
WHERE offline_validity_days != 14;

UPDATE license_code_inventory
SET offline_validity_days = 14
WHERE offline_validity_days != 14;
