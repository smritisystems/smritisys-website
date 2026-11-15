ALTER TABLE customer_invites
  ADD COLUMN invited_by_partner_organization_id INTEGER
  REFERENCES organizations(id);

ALTER TABLE license_code_inventory
  ADD COLUMN assigned_partner_organization_id INTEGER
  REFERENCES organizations(id);
ALTER TABLE license_code_inventory
  ADD COLUMN partner_assigned_at TEXT;
ALTER TABLE license_code_inventory
  ADD COLUMN partner_assigned_by_person_id INTEGER
  REFERENCES people(id);

CREATE INDEX IF NOT EXISTS idx_customer_invites_partner_status
  ON customer_invites(invited_by_partner_organization_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_license_code_assigned_partner
  ON license_code_inventory(assigned_partner_organization_id, status, batch_id);

INSERT OR IGNORE INTO permissions (name, description) VALUES
  ('partner.customer.create', 'Register customer organizations for a partner'),
  ('partner.inventory.view', 'View activation codes allocated to a partner'),
  ('partner.inventory.reveal', 'Reveal activation keys allocated to a partner');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('partner_admin', 'partner_member')
  AND p.name IN ('partner.customer.create', 'partner.inventory.view');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'partner_admin'
  AND p.name = 'partner.inventory.reveal';
