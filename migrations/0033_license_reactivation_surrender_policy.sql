ALTER TABLE license_reactivation_requests ADD COLUMN surrender_confirmed INTEGER NOT NULL DEFAULT 0
  CHECK (surrender_confirmed IN (0, 1));

ALTER TABLE license_reactivation_requests ADD COLUMN surrender_reason TEXT;
