ALTER TABLE customer_invites ADD COLUMN phone TEXT;
ALTER TABLE partner_invites ADD COLUMN phone TEXT;
ALTER TABLE organizations ADD COLUMN phone TEXT;
ALTER TABLE organizations ADD COLUMN country TEXT;

UPDATE customer_invites
SET phone = (
  SELECT c.phone FROM customers c
  WHERE c.id = customer_invites.customer_id AND trim(COALESCE(c.phone, '')) <> ''
)
WHERE customer_id IS NOT NULL AND (phone IS NULL OR trim(phone) = '');
