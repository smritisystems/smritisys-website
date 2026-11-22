-- Bind customer-owned commercial and license records to an explicit organization.
-- Existing rows are assigned only when the customer has exactly one active organization membership.

ALTER TABLE licenses
  ADD COLUMN organization_id INTEGER REFERENCES organizations(id);

ALTER TABLE support_tickets
  ADD COLUMN organization_id INTEGER REFERENCES organizations(id);

ALTER TABLE orders
  ADD COLUMN organization_id INTEGER REFERENCES organizations(id);

ALTER TABLE amc_contracts
  ADD COLUMN organization_id INTEGER REFERENCES organizations(id);

UPDATE licenses
SET organization_id = (
  SELECT om.organization_id
  FROM organization_members om
  JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
  WHERE om.account_type = 'customer'
    AND om.account_id = licenses.customer_id
    AND om.status = 'active'
  GROUP BY om.account_id
  HAVING COUNT(*) = 1
)
WHERE organization_id IS NULL;

UPDATE support_tickets
SET organization_id = (
  SELECT om.organization_id
  FROM organization_members om
  JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
  WHERE om.account_type = 'customer'
    AND om.account_id = support_tickets.customer_id
    AND om.status = 'active'
  GROUP BY om.account_id
  HAVING COUNT(*) = 1
)
WHERE organization_id IS NULL;

UPDATE orders
SET organization_id = (
  SELECT om.organization_id
  FROM organization_members om
  JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
  WHERE om.account_type = 'customer'
    AND om.account_id = orders.customer_id
    AND om.status = 'active'
  GROUP BY om.account_id
  HAVING COUNT(*) = 1
)
WHERE organization_id IS NULL;

UPDATE amc_contracts
SET organization_id = (
  SELECT om.organization_id
  FROM organization_members om
  JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
  WHERE om.account_type = 'customer'
    AND om.account_id = amc_contracts.customer_id
    AND om.status = 'active'
  GROUP BY om.account_id
  HAVING COUNT(*) = 1
)
WHERE organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_licenses_org ON licenses(organization_id);
CREATE INDEX IF NOT EXISTS idx_tickets_org ON support_tickets(organization_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_org ON orders(organization_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_amc_org ON amc_contracts(organization_id, customer_id);

-- Backfill missing canonical memberships from active compatibility records without reviving inactive rows.
INSERT INTO organization_members
  (organization_id, account_type, account_id, member_role, status)
SELECT pm.partner_organization_id, pm.account_type, pm.account_id, pm.partner_role, 'active'
FROM partner_memberships pm
JOIN organizations o ON o.id = pm.partner_organization_id AND o.status = 'active'
JOIN relationships r ON r.organization_id = pm.partner_organization_id
  AND r.status = 'active'
  AND r.relationship_type IN (
    'channel_partner', 'reseller', 'implementation_partner',
    'technology_partner', 'referral_partner', 'distributor'
  )
WHERE pm.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = pm.partner_organization_id
      AND om.account_type = pm.account_type
      AND om.account_id = pm.account_id
  );

-- Canonicalize active partner roles without activating inactive or missing memberships.
UPDATE organization_members
SET member_role = (
  SELECT pm.partner_role
  FROM partner_memberships pm
  WHERE pm.partner_organization_id = organization_members.organization_id
    AND pm.account_type = organization_members.account_type
    AND pm.account_id = organization_members.account_id
    AND pm.status = 'active'
)
WHERE status = 'active'
  AND EXISTS (
    SELECT 1
    FROM partner_memberships pm
    JOIN relationships r ON r.organization_id = pm.partner_organization_id
      AND r.relationship_type IN (
        'channel_partner', 'reseller', 'implementation_partner',
        'technology_partner', 'referral_partner', 'distributor'
      )
      AND r.status = 'active'
    WHERE pm.partner_organization_id = organization_members.organization_id
      AND pm.account_type = organization_members.account_type
      AND pm.account_id = organization_members.account_id
      AND pm.status = 'active'
  );
