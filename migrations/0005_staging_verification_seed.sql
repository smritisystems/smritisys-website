-- Phase 4-7 Staging Verification Seed: customer, license, support, requirement, and release dataset.

-- 1. Product Editions
INSERT OR IGNORE INTO product_editions (product_id, code, name, description, status)
SELECT p.id, 'retail-enterprise', 'Enterprise Edition', 'Full-featured enterprise tier for multi-store retail chains', 'active'
FROM products p WHERE p.slug = 'smriti-retail-os';

-- 2. Customer A
INSERT OR IGNORE INTO customers (id, email, password_hash, name, phone, company, status)
VALUES (
  101,
  'customer.a@smritibooks.com',
  '783f1ea39d9119c1cf5d9b0c1bc579b7780df38992d9774837ac3917ebcc98ee',
  'Customer A',
  '+91 9876543210',
  'Organization A Retail Pvt Ltd',
  'active'
);

-- 3. People record for Customer A
INSERT OR IGNORE INTO people (id, email, name, source_type, source_id, status)
VALUES (101, 'customer.a@smritibooks.com', 'Customer A', 'customer', 101, 'active');

-- 4. Organization A
INSERT OR IGNORE INTO organizations (id, name, legal_name, gst_number, status)
VALUES (101, 'Organization A', 'Organization A Retail Pvt Ltd', '27AABCO1234A1Z5', 'active');

-- 5. Organization Membership
INSERT OR IGNORE INTO organization_members (organization_id, account_type, account_id, member_role, status)
VALUES (101, 'customer', 101, 'customer', 'active');

-- 6. License for Customer A / Organization A
INSERT OR IGNORE INTO licenses (id, customer_id, product_id, license_key, seats, starts_at, expires_at, status)
SELECT 101, 101, p.id, 'SMRITI-RET-ENT-2026-001', 5, '2026-01-01', '2027-01-01', 'ACTIVE'
FROM products p WHERE p.slug = 'smriti-retail-os';

-- 7. License Edition link
INSERT OR IGNORE INTO license_editions (license_id, edition_id)
SELECT 101, pe.id
FROM product_editions pe WHERE pe.code = 'retail-enterprise';

-- 8. License Entitlements
INSERT OR IGNORE INTO license_entitlements (license_id, entitlement_key, value_type, value_text, value_number) VALUES
  (101, 'pos_terminals', 'number', NULL, 5),
  (101, 'multi_branch', 'boolean', 'true', NULL),
  (101, 'gst_e_invoicing', 'boolean', 'true', NULL),
  (101, 'inventory_advanced', 'boolean', 'true', NULL),
  (101, 'offline_sync', 'boolean', 'true', NULL);

-- 9. License Activation (1 active node)
INSERT OR IGNORE INTO license_activations (license_id, installation_id, activation_identifier, status, activated_at, last_seen_at)
VALUES (101, 'NODE-MUM-POS-01', 'ACT-IDENT-8849-A1', 'active', datetime('now'), datetime('now'));

-- 10. Customer Profile
INSERT OR IGNORE INTO customer_profiles (customer_id, gst_number, website, bio, timezone)
VALUES (101, '27AABCO1234A1Z5', 'https://organization-a.example.com', 'Leading apparel retailer in Western India', 'Asia/Kolkata');

-- 11. Organization B and ticket isolation fixture
INSERT OR IGNORE INTO customers (id, email, password_hash, name, company, status)
VALUES (102, 'customer.b@example.com', '783f1ea39d9119c1cf5d9b0c1bc579b7780df38992d9774837ac3917ebcc98ee', 'Customer B', 'Organization B Retail Pvt Ltd', 'active');

INSERT OR IGNORE INTO people (id, email, name, source_type, source_id, status)
VALUES (102, 'customer.b@example.com', 'Customer B', 'customer', 102, 'active');

INSERT OR IGNORE INTO organizations (id, name, legal_name, status)
VALUES (102, 'Organization B', 'Organization B Retail Pvt Ltd', 'active');

INSERT OR IGNORE INTO organization_members (organization_id, account_type, account_id, member_role, status)
VALUES (102, 'customer', 102, 'customer', 'active');

INSERT OR IGNORE INTO support_tickets (id, customer_id, subject, description, priority, status)
VALUES
  (101, 101, 'Organization A ticket', 'A-owned support issue', 'normal', 'open'),
  (102, 102, 'Organization B ticket', 'B-owned support issue', 'high', 'open');

INSERT OR IGNORE INTO custom_requirements (id, customer_id, organization_id, title, description, business_need, category, priority, status)
VALUES
  (101, 101, 101, 'Organization A requirement', 'A-owned requirement request', 'A-owned requirement request', 'feature', 'normal', 'submitted'),
  (102, 102, 102, 'Organization B requirement', 'B-owned requirement request', 'B-owned requirement request', 'integration', 'high', 'submitted');

INSERT OR IGNORE INTO releases (id, product_id, version, title, summary, release_notes, status, published_at)
SELECT 101, p.id, '2026.08', 'Retail OS August Update', 'Faster branch operations and improved offline sync.', 'Improved branch exports' || char(10) || 'Improved offline sync reliability', 'published', '2026-08-01'
FROM products p WHERE p.slug = 'smriti-retail-os';

INSERT OR IGNORE INTO release_assets (release_id, name, platform, download_url, checksum)
VALUES (101, 'Retail OS Windows installer', 'Windows', 'https://downloads.example.com/smriti-retail-os/2026.08/windows', 'sha256:phase7-demo');

INSERT OR IGNORE INTO orders (id, customer_id, order_number, total_amount, status)
VALUES (101, 101, 'ORD-PHASE9-001', 125000, 'confirmed');

INSERT OR IGNORE INTO amc_contracts (id, customer_id, contract_number, starts_at, expires_at, status)
VALUES (101, 101, 'AMC-PHASE9-001', '2026-01-01', '2026-12-31', 'active');
