-- Phase 6: bind automatic snapshot refresh to an installation-held Ed25519 key.

ALTER TABLE license_activations ADD COLUMN refresh_public_key TEXT;
