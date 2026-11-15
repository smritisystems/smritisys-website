ALTER TABLE customer_invites
  ADD COLUMN organization_id INTEGER REFERENCES organizations(id);

CREATE TABLE IF NOT EXISTS partner_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  partner_organization_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  partner_type TEXT NOT NULL CHECK (partner_type IN (
    'channel_partner', 'reseller', 'implementation_partner',
    'technology_partner', 'referral_partner', 'distributor'
  )),
  partner_role TEXT NOT NULL DEFAULT 'partner_admin'
    CHECK (partner_role IN ('partner_admin', 'partner_member')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_by INTEGER,
  customer_id INTEGER UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  FOREIGN KEY (partner_organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES people(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_partner_invites_email_status
  ON partner_invites(email, status);
CREATE INDEX IF NOT EXISTS idx_partner_invites_expiry
  ON partner_invites(status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_invites_one_pending_per_partner_email
  ON partner_invites(partner_organization_id, lower(email)) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_relationships_type_status
  ON relationships(relationship_type, status, organization_id);

INSERT OR IGNORE INTO relationships (organization_id, relationship_type, status)
SELECT o.id, 'internal', o.status
FROM organizations o
WHERE lower(trim(o.name)) = 'smritisys internal';

INSERT OR IGNORE INTO relationships (organization_id, relationship_type, status)
SELECT DISTINCT om.organization_id, 'customer', o.status
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id
WHERE om.account_type = 'customer'
  AND NOT EXISTS (
    SELECT 1 FROM relationships r
    WHERE r.organization_id = o.id
      AND r.relationship_type IN (
        'channel_partner', 'reseller', 'implementation_partner',
        'technology_partner', 'referral_partner', 'distributor'
      )
  );

INSERT OR IGNORE INTO relationships (organization_id, relationship_type, status)
SELECT DISTINCT pm.partner_organization_id, pm.partner_type, o.status
FROM partner_memberships pm
JOIN organizations o ON o.id = pm.partner_organization_id
WHERE pm.partner_type IN (
  'channel_partner', 'reseller', 'implementation_partner',
  'technology_partner', 'referral_partner', 'distributor'
);
