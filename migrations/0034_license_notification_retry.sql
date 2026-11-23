ALTER TABLE license_reactivation_requests ADD COLUMN notification_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE license_reactivation_requests ADD COLUMN notification_next_retry_at TEXT;

ALTER TABLE license_reactivation_requests ADD COLUMN notification_error TEXT;
