-- SMRITISYS D1 Schema
-- User accounts, customer portal, and demo requests

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'staff',          -- staff | admin | super_admin
  status TEXT DEFAULT 'active',       -- active | inactive
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  company TEXT,
  status TEXT DEFAULT 'active',       -- active | inactive | trial
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  company TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_by INTEGER,
  customer_id INTEGER UNIQUE,
  organization_id INTEGER,
  invited_by_partner_organization_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  FOREIGN KEY (created_by) REFERENCES people(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (invited_by_partner_organization_id) REFERENCES organizations(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_invites_email_status
  ON customer_invites(email, status);
CREATE INDEX IF NOT EXISTS idx_customer_invites_expiry
  ON customer_invites(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_customer_invites_partner_status
  ON customer_invites(invited_by_partner_organization_id, status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_invites_one_pending_email
  ON customer_invites(lower(email)) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS customer_password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL,
  created_by INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'used', 'revoked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES people(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_password_resets_customer_status
  ON customer_password_resets(customer_id, status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_password_resets_one_pending
  ON customer_password_resets(customer_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS partner_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  partner_organization_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  phone TEXT,
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

CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  legal_name TEXT,
  gst_number TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  tax_id TEXT,
  website TEXT,
  phone TEXT,
  country TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS organization_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  account_type TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  member_role TEXT NOT NULL DEFAULT 'member',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(organization_id, account_type, account_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  relationship_type TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(organization_id, relationship_type),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_relationships_type_status
  ON relationships(relationship_type, status, organization_id);

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

CREATE TABLE IF NOT EXISTS deal_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_organization_id INTEGER NOT NULL,
  submitted_by_person_id INTEGER NOT NULL,
  prospect_organization_name TEXT NOT NULL,
  website TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  summary TEXT NOT NULL,
  partner_response TEXT,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'under_review', 'needs_information', 'approved', 'rejected')),
  decision_summary TEXT,
  internal_note TEXT,
  reviewed_by_person_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (partner_organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (submitted_by_person_id) REFERENCES people(id),
  FOREIGN KEY (reviewed_by_person_id) REFERENCES people(id)
);

CREATE INDEX IF NOT EXISTS idx_deal_registrations_partner_status_created
  ON deal_registrations(partner_organization_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_deal_registrations_status_created
  ON deal_registrations(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_deal_registrations_prospect_name
  ON deal_registrations(lower(prospect_organization_name));
CREATE INDEX IF NOT EXISTS idx_deal_registrations_contact_email
  ON deal_registrations(lower(contact_email)) WHERE contact_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS follow_up_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to_user_id INTEGER,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  created_by_person_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (assigned_to_user_id) REFERENCES users(id),
  FOREIGN KEY (created_by_person_id) REFERENCES people(id)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_status_due
  ON follow_up_tasks(status, due_date, id);
CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_assignee_status_due
  ON follow_up_tasks(assigned_to_user_id, status, due_date, id);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('user', 'customer')),
  source_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_type, source_id)
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_person_id INTEGER,
  organization_id INTEGER,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  old_value TEXT,
  new_value TEXT,
  request_ip TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (actor_person_id) REFERENCES people(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO roles (name, description) VALUES
  ('customer', 'Customer organization member'),
  ('partner_admin', 'Partner organization administrator'),
  ('partner_member', 'Partner organization member'),
  ('staff', 'Internal staff member'),
  ('admin', 'Internal administrator'),
  ('super_admin', 'Full system administrator');

INSERT OR IGNORE INTO permissions (name, description) VALUES
  ('organization.view', 'View organization details'),
  ('organization.manage', 'Manage organization details'),
  ('member.view', 'View organization members'),
  ('member.manage', 'Manage organization memberships'),
  ('license.view', 'View licenses'),
  ('license.manage', 'Manage licenses'),
  ('support.view', 'View support tickets'),
  ('support.create', 'Create support tickets'),
  ('support.manage', 'Manage support tickets'),
  ('requirement.view', 'View custom requirements'),
  ('requirement.create', 'Create custom requirements'),
  ('requirement.manage', 'Manage custom requirements'),
  ('partner.customer.create', 'Register customer organizations for a partner'),
  ('partner.customer.update_contact', 'Update contact name and phone for assigned customers'),
  ('partner.deals.submit', 'Submit and view partner deal registrations'),
  ('partner.inventory.view', 'View activation codes allocated to a partner'),
  ('partner.inventory.reveal', 'Reveal activation keys allocated to a partner'),
  ('commercial.view', 'View commercial relationship records'),
  ('release.view', 'View releases'),
  ('release.manage', 'Manage releases'),
  ('partner.view', 'View partner records'),
  ('partner.manage', 'Manage partner records'),
  ('license.create', 'Create licenses'),
  ('license.update', 'Update license metadata'),
  ('license.suspend', 'Suspend licenses'),
  ('license.activate', 'Activate licenses and installations'),
  ('license.renew', 'Renew licenses'),
  ('license.manage_entitlements', 'Manage license entitlements'),
  ('admin.system', 'Access system administration');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'customer' AND p.name IN (
  'organization.view', 'support.view', 'support.create', 'license.view',
  'requirement.view', 'requirement.create', 'release.view', 'commercial.view'
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('partner_admin', 'partner_member') AND p.name IN (
  'partner.view', 'organization.view', 'license.view', 'release.view'
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('partner_admin', 'partner_member')
  AND p.name IN ('partner.customer.create', 'partner.customer.update_contact', 'partner.deals.submit', 'partner.inventory.view');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'partner_admin' AND p.name = 'partner.inventory.reveal';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'staff' AND p.name IN (
  'organization.view', 'member.view', 'license.view', 'support.view',
  'support.manage', 'requirement.view', 'requirement.manage', 'release.view'
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'admin' AND p.name IN (
  'organization.view', 'organization.manage', 'member.view', 'member.manage',
  'license.view', 'license.manage', 'support.view', 'support.manage',
  'license.create', 'license.update', 'license.suspend', 'license.activate',
  'license.renew', 'license.manage_entitlements',
  'requirement.view', 'requirement.manage', 'release.view', 'release.manage',
  'partner.view', 'partner.manage'
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'super_admin';

CREATE TABLE IF NOT EXISTS customer_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER UNIQUE NOT NULL,
  gst_number TEXT,
  website TEXT,
  bio TEXT,
  timezone TEXT DEFAULT 'Asia/Kolkata',
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  address_type TEXT NOT NULL DEFAULT 'billing',
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'India',
  is_default INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  price REAL NOT NULL DEFAULT 0,
  billing_period TEXT DEFAULT 'one_time',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_editions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, code),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  organization_id INTEGER REFERENCES organizations(id),
  product_id INTEGER NOT NULL,
  license_key TEXT UNIQUE NOT NULL,
  serial_number TEXT UNIQUE,
  registered_email TEXT,
  last_self_service_transfer_at TEXT,
  last_self_service_transfer_id TEXT,
  seats INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT NOT NULL,
  expires_at TEXT,
  offline_validity_days INTEGER NOT NULL DEFAULT 14
    CHECK (offline_validity_days BETWEEN 1 AND 365),
  status TEXT DEFAULT 'active',
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS license_code_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  serial_number TEXT NOT NULL UNIQUE,
  activation_key_hash TEXT NOT NULL UNIQUE,
  activation_key_ciphertext TEXT,
  product_id INTEGER NOT NULL,
  edition_id INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  expires_at TEXT,
  license_model TEXT NOT NULL CHECK (license_model IN (
    'cloud_subscription', 'cloud_one_time',
    'on_premise_subscription', 'on_premise_perpetual'
  )),
  seats INTEGER NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 10000),
  entitlements_json TEXT NOT NULL DEFAULT '[]',
  offline_validity_days INTEGER NOT NULL DEFAULT 14
    CHECK (offline_validity_days BETWEEN 7 AND 365),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'claiming', 'claimed', 'revoked')),
  license_id INTEGER UNIQUE,
  company_binding TEXT,
  installation_id TEXT,
  activation_identifier TEXT,
  contact_email TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'not_issued'
    CHECK (delivery_status IN ('not_issued', 'issued')),
  issued_to_name TEXT,
  issued_to_organization TEXT,
  issued_to_email TEXT,
  delivery_channel TEXT
    CHECK (delivery_channel IN ('email', 'messaging', 'phone', 'in_person', 'other', 'activation')),
  delivery_reference TEXT,
  issued_at TEXT,
  issued_by_person_id INTEGER,
  assigned_partner_organization_id INTEGER,
  partner_assigned_at TEXT,
  partner_assigned_by_person_id INTEGER,
  created_by_person_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at TEXT,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (edition_id) REFERENCES product_editions(id),
  FOREIGN KEY (license_id) REFERENCES licenses(id),
  FOREIGN KEY (issued_by_person_id) REFERENCES people(id),
  FOREIGN KEY (assigned_partner_organization_id) REFERENCES organizations(id),
  FOREIGN KEY (partner_assigned_by_person_id) REFERENCES people(id),
  FOREIGN KEY (created_by_person_id) REFERENCES people(id)
);

CREATE INDEX IF NOT EXISTS idx_license_code_assigned_partner
  ON license_code_inventory(assigned_partner_organization_id, status, batch_id);
CREATE INDEX IF NOT EXISTS idx_license_code_inventory_batch
  ON license_code_inventory(batch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_license_code_inventory_status
  ON license_code_inventory(status, product_id, edition_id);
CREATE INDEX IF NOT EXISTS idx_license_code_inventory_delivery
  ON license_code_inventory(batch_id, delivery_status, status);

CREATE TABLE IF NOT EXISTS license_editions (
  license_id INTEGER PRIMARY KEY,
  edition_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE,
  FOREIGN KEY (edition_id) REFERENCES product_editions(id)
);

CREATE TABLE IF NOT EXISTS product_edition_license_policies (
  edition_id INTEGER PRIMARY KEY,
  subscription_grace_days INTEGER NOT NULL DEFAULT 7 CHECK (subscription_grace_days BETWEEN 0 AND 30),
  rollout_stage TEXT NOT NULL DEFAULT 'enforced' CHECK (rollout_stage IN ('shadow', 'enforced')),
  evaluation_policy_json TEXT NOT NULL DEFAULT '{"allow_dashboard":true,"allow_read_only_records":true,"allow_reports":true,"allow_backups":true,"allow_exports":true,"locked_modules":["billing","inventory_transactions","accounting","payroll"]}',
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (edition_id) REFERENCES product_editions(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS license_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL,
  entitlement_key TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('number', 'text', 'boolean', 'json')),
  value_text TEXT,
  value_number REAL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(license_id, entitlement_key),
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS license_activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL,
  installation_id TEXT NOT NULL,
  activation_identifier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  refresh_public_key TEXT,
  activated_at TEXT DEFAULT (datetime('now')),
  last_seen_at TEXT DEFAULT (datetime('now')),
  deactivated_at TEXT,
  metadata_json TEXT,
  UNIQUE(license_id, activation_identifier),
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS license_reactivation_requests (
  request_id TEXT PRIMARY KEY,
  license_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  organization_id INTEGER,
  requester_person_id INTEGER NOT NULL,
  product_code TEXT NOT NULL,
  company_binding TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  activation_identifier TEXT NOT NULL,
  refresh_public_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'expired')),
  replaced_activation_id INTEGER,
  decision_reason TEXT,
  reviewed_by_person_id INTEGER,
  phone_confirmed_at TEXT,
  cooldown_override INTEGER NOT NULL DEFAULT 0 CHECK (cooldown_override IN (0, 1)),
  surrender_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (surrender_confirmed IN (0, 1)),
  surrender_reason TEXT,
  surrendered_activation_id INTEGER,
  notification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending', 'sent', 'failed')),
  notification_attempts INTEGER NOT NULL DEFAULT 0,
  notification_next_retry_at TEXT,
  notification_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  reviewed_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (requester_person_id) REFERENCES people(id),
  FOREIGN KEY (replaced_activation_id) REFERENCES license_activations(id),
  FOREIGN KEY (surrendered_activation_id) REFERENCES license_activations(id),
  FOREIGN KEY (reviewed_by_person_id) REFERENCES people(id)
);
CREATE INDEX IF NOT EXISTS idx_license_reactivation_requests_status
  ON license_reactivation_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_license_reactivation_requests_customer
  ON license_reactivation_requests(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_license_reactivation_surrendered_activation
  ON license_reactivation_requests(surrendered_activation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_license_reactivation_requests_active_target
  ON license_reactivation_requests(license_id, activation_identifier)
  WHERE status IN ('pending', 'approved');

CREATE TABLE IF NOT EXISTS license_email_verifications (
  challenge_id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('activation', 'email_change')),
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  product_code TEXT NOT NULL,
  company_binding TEXT NOT NULL,
  license_id INTEGER,
  target_email TEXT,
  installation_id TEXT,
  activation_identifier TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  current_email_verified_at TEXT,
  verified_at TEXT,
  consumed_at TEXT,
  CHECK (
    (purpose = 'activation' AND license_id IS NULL AND target_email IS NULL)
    OR (purpose = 'email_change' AND license_id IS NOT NULL AND target_email IS NOT NULL)
  ),
  FOREIGN KEY (license_id) REFERENCES licenses(id)
);
CREATE INDEX IF NOT EXISTS idx_license_email_verifications_email
  ON license_email_verifications(email, purpose, created_at);
CREATE INDEX IF NOT EXISTS idx_license_email_verifications_license
  ON license_email_verifications(license_id, purpose, created_at);

CREATE TABLE IF NOT EXISTS license_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL UNIQUE,
  license_id INTEGER NOT NULL,
  installation_id TEXT NOT NULL,
  activation_identifier TEXT NOT NULL,
  key_id TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm = 'Ed25519'),
  payload_base64url TEXT NOT NULL,
  signature_base64url TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (license_id) REFERENCES licenses(id),
  FOREIGN KEY (license_id, activation_identifier)
    REFERENCES license_activations(license_id, activation_identifier)
);

CREATE TABLE IF NOT EXISTS license_refresh_nonces (
  license_id INTEGER NOT NULL,
  activation_identifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (license_id, activation_identifier, nonce),
  FOREIGN KEY (license_id, activation_identifier)
    REFERENCES license_activations(license_id, activation_identifier)
);

CREATE TABLE IF NOT EXISTS license_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL,
  organization_id INTEGER NOT NULL,
  actor_person_id INTEGER,
  event_type TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  metadata_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (actor_person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS license_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL,
  organization_id INTEGER NOT NULL,
  requester_person_id INTEGER NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('renewal', 'upgrade', 'additional_users', 'additional_branches', 'additional_modules')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'completed', 'declined')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (requester_person_id) REFERENCES people(id)
);

CREATE INDEX IF NOT EXISTS idx_license_requests_org ON license_requests(organization_id, created_at);

CREATE INDEX IF NOT EXISTS idx_product_editions_product ON product_editions(product_id, status);
CREATE INDEX IF NOT EXISTS idx_license_entitlements_license ON license_entitlements(license_id);
CREATE INDEX IF NOT EXISTS idx_license_activations_license ON license_activations(license_id, status);
CREATE INDEX IF NOT EXISTS idx_license_events_license ON license_events(license_id, created_at);
CREATE INDEX IF NOT EXISTS idx_license_events_org ON license_events(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_license_artifacts_license ON license_artifacts(license_id, created_at);
CREATE INDEX IF NOT EXISTS idx_license_artifacts_installation ON license_artifacts(license_id, installation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_license_refresh_nonces_created ON license_refresh_nonces(created_at);

CREATE TRIGGER IF NOT EXISTS prevent_license_events_update
BEFORE UPDATE ON license_events
BEGIN
  SELECT RAISE(ABORT, 'license_events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_license_events_delete
BEFORE DELETE ON license_events
BEGIN
  SELECT RAISE(ABORT, 'license_events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_license_artifacts_update
BEFORE UPDATE ON license_artifacts
BEGIN
  SELECT RAISE(ABORT, 'license_artifacts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_license_artifacts_delete
BEFORE DELETE ON license_artifacts
BEGIN
  SELECT RAISE(ABORT, 'license_artifacts are immutable');
END;

CREATE TABLE IF NOT EXISTS amc_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  organization_id INTEGER REFERENCES organizations(id),
  contract_number TEXT UNIQUE NOT NULL,
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  notes TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  organization_id INTEGER REFERENCES organizations(id),
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_created
  ON support_tickets(status, created_at, id);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  author_type TEXT NOT NULL,
  author_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS custom_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  organization_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  business_need TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'submitted',
  feasibility TEXT,
  scope TEXT,
  estimate_amount REAL,
  target_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS custom_requirement_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requirement_id INTEGER NOT NULL,
  author_type TEXT NOT NULL,
  author_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (requirement_id) REFERENCES custom_requirements(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_custom_requirements_org ON custom_requirements(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_custom_requirement_messages ON custom_requirement_messages(requirement_id, created_at);

CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  release_notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  published_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, version),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS release_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  platform TEXT,
  download_url TEXT NOT NULL,
  checksum TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_releases_product_status ON releases(product_id, status, published_at);
CREATE INDEX IF NOT EXISTS idx_release_assets_release ON release_assets(release_id);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  organization_id INTEGER REFERENCES organizations(id),
  order_number TEXT UNIQUE NOT NULL,
  total_amount REAL NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_customer_id INTEGER NOT NULL,
  referred_email TEXT NOT NULL,
  referral_code TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending',
  reward_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (referrer_customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS partner_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER UNIQUE NOT NULL,
  program_type TEXT NOT NULL,
  tier TEXT DEFAULT 'standard',
  status TEXT DEFAULT 'pending',
  commission_rate REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS partner_commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL,
  order_id INTEGER,
  amount REAL NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'pending',
  paid_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (partner_id) REFERENCES partner_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'general',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS implementation_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  product_id INTEGER,
  project_name TEXT NOT NULL,
  status TEXT DEFAULT 'planned',
  start_date TEXT,
  target_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS implementation_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  due_date TEXT,
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES implementation_projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  version TEXT NOT NULL,
  release_date TEXT NOT NULL,
  summary TEXT,
  status TEXT DEFAULT 'published',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, version),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS custom_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  business_need TEXT NOT NULL,
  status TEXT DEFAULT 'submitted',
  feasibility TEXT,
  scope TEXT,
  estimate_amount REAL,
  target_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'customer',
  product_id INTEGER,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'maintenance', 'degraded', 'outage')),
  published_at TEXT,
  status TEXT DEFAULT 'draft',
  starts_at TEXT NOT NULL DEFAULT (datetime('now')),
  ends_at TEXT,
  created_by INTEGER,
  updated_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS accounting_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  opening_balance REAL NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(customer_id, code),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accounting_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  invoice_number TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT,
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(customer_id, invoice_number),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accounting_invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES accounting_invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accounting_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  bill_number TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  purchase_date TEXT NOT NULL,
  subtotal REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'recorded',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(customer_id, bill_number),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accounting_purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (purchase_id) REFERENCES accounting_purchases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accounting_ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  entry_date TEXT NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  description TEXT NOT NULL,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounting_accounts(id)
);

CREATE TABLE IF NOT EXISTS accounting_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  contact_type TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  gst_number TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accounting_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  receipt_number TEXT NOT NULL,
  contact_id INTEGER,
  invoice_reference TEXT,
  receipt_date TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_mode TEXT NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'received',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(customer_id, receipt_number),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES accounting_contacts(id)
);

CREATE TABLE IF NOT EXISTS accounting_supplier_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  payment_number TEXT NOT NULL,
  contact_id INTEGER,
  bill_reference TEXT,
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_mode TEXT NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'paid',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(customer_id, payment_number),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES accounting_contacts(id)
);

CREATE TABLE IF NOT EXISTS accounting_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  note_number TEXT NOT NULL,
  note_type TEXT NOT NULL,
  party_type TEXT NOT NULL,
  contact_id INTEGER,
  document_reference TEXT,
  note_date TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'issued',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(customer_id, note_number),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES accounting_contacts(id)
);

CREATE TABLE IF NOT EXISTS demo_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  stores TEXT,
  message TEXT,
  status TEXT DEFAULT 'new',          -- new | contacted | scheduled | closed
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  account_type TEXT NOT NULL,         -- user | customer
  account_id INTEGER NOT NULL,
  organization_id INTEGER REFERENCES organizations(id),
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_org_members_account ON organization_members(account_type, account_id);
CREATE INDEX IF NOT EXISTS idx_relationships_org ON relationships(organization_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_demo_status ON demo_requests(status);
CREATE INDEX IF NOT EXISTS idx_profiles_customer ON customer_profiles(customer_id);
CREATE INDEX IF NOT EXISTS idx_addresses_customer ON customer_addresses(customer_id);
CREATE INDEX IF NOT EXISTS idx_licenses_customer ON licenses(customer_id);
CREATE INDEX IF NOT EXISTS idx_licenses_org ON licenses(organization_id);
CREATE INDEX IF NOT EXISTS idx_amc_customer ON amc_contracts(customer_id);
CREATE INDEX IF NOT EXISTS idx_amc_org ON amc_contracts(organization_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_customer ON support_tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_org ON support_tickets(organization_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_org ON orders(organization_id, customer_id);

CREATE TABLE IF NOT EXISTS d1_storage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  database_id TEXT NOT NULL,
  database_name TEXT NOT NULL,
  sampled_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  UNIQUE (database_id, sampled_at)
);

CREATE INDEX IF NOT EXISTS idx_d1_storage_snapshots_database_sampled
  ON d1_storage_snapshots(database_id, sampled_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_customer ON referrals(referrer_customer_id);
CREATE INDEX IF NOT EXISTS idx_projects_customer ON implementation_projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_releases_product ON product_releases(product_id);
CREATE INDEX IF NOT EXISTS idx_requirements_customer ON custom_requirements(customer_id);
CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status, audience);
CREATE INDEX IF NOT EXISTS idx_announcements_visibility ON announcements(status, starts_at, ends_at, product_id);
CREATE INDEX IF NOT EXISTS idx_commissions_partner ON partner_commissions(partner_id);
CREATE INDEX IF NOT EXISTS idx_notifications_customer ON notifications(customer_id);
CREATE INDEX IF NOT EXISTS idx_accounting_accounts_customer ON accounting_accounts(customer_id);
CREATE INDEX IF NOT EXISTS idx_accounting_invoices_customer ON accounting_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_accounting_purchases_customer ON accounting_purchases(customer_id);
CREATE INDEX IF NOT EXISTS idx_accounting_ledger_customer ON accounting_ledger_entries(customer_id);
CREATE INDEX IF NOT EXISTS idx_accounting_contacts_customer ON accounting_contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_accounting_receipts_customer ON accounting_receipts(customer_id);
CREATE INDEX IF NOT EXISTS idx_accounting_payments_customer ON accounting_supplier_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_accounting_notes_customer ON accounting_notes(customer_id);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_updated ON rate_limit_buckets(updated_at);

INSERT OR IGNORE INTO products (name, slug, description, price, billing_period, status)
VALUES (
  'PrathamOne EduOS',
  'prathamone-eduos',
  'PrathamOne EduOS Coaching Institute Edition',
  0,
  'subscription',
  'active'
);

INSERT OR IGNORE INTO product_editions (product_id, code, name, description)
SELECT id, 'coaching-institute', 'Coaching Institute Edition',
       'PrathamOne EduOS edition for coaching institutes'
FROM products
WHERE slug = 'prathamone-eduos';

INSERT OR IGNORE INTO product_edition_license_policies
  (edition_id, subscription_grace_days, rollout_stage, evaluation_policy_json)
SELECT id, 7, 'enforced',
       '{"allow_dashboard":true,"allow_read_only_records":true,"allow_reports":true,"allow_backups":true,"allow_exports":true,"locked_modules":["payroll","premium_analytics"]}'
FROM product_editions
WHERE product_id = (SELECT id FROM products WHERE slug = 'prathamone-eduos')
  AND code = 'coaching-institute';
