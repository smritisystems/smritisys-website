-- Phase 8: partner relationship records on the existing identity model.

INSERT OR IGNORE INTO roles (name, description) VALUES
  ('partner_admin', 'Partner organization administrator'),
  ('partner_member', 'Partner organization member');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('partner_admin', 'partner_member') AND p.name IN (
  'partner.view', 'organization.view', 'license.view', 'release.view'
);

CREATE TABLE IF NOT EXISTS partner_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_organization_id INTEGER NOT NULL,
  account_type TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  partner_role TEXT NOT NULL DEFAULT 'partner_member',
  partner_type TEXT NOT NULL DEFAULT 'reseller',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(partner_organization_id, account_type, account_id),
  FOREIGN KEY (partner_organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS partner_customer_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_organization_id INTEGER NOT NULL,
  customer_organization_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(partner_organization_id, customer_organization_id),
  FOREIGN KEY (partner_organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_partner_memberships_account ON partner_memberships(account_type, account_id, status);
CREATE INDEX IF NOT EXISTS idx_partner_customer_links_partner ON partner_customer_links(partner_organization_id, status);