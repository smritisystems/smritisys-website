-- Phase 2: unified identity, organization membership, RBAC, and audit support.
-- Safe to rerun after the initial schema has been applied.

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

INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
SELECT 'staff_bootstrap_consumed', CASE WHEN EXISTS (SELECT 1 FROM users) THEN '1' ELSE '0' END;

CREATE INDEX IF NOT EXISTS idx_people_source ON people(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_people_email ON people(email);
CREATE INDEX IF NOT EXISTS idx_members_account ON organization_members(account_type, account_id, status);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(organization_id, created_at);

INSERT OR IGNORE INTO roles (name, description) VALUES
  ('customer', 'Customer organization member'),
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
  ('release.view', 'View releases'),
  ('release.manage', 'Manage releases'),
  ('partner.view', 'View partner records'),
  ('partner.manage', 'Manage partner records'),
  ('admin.system', 'Access system administration');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'customer' AND p.name IN (
  'organization.view', 'support.view', 'support.create', 'license.view',
  'requirement.view', 'requirement.create', 'release.view'
);

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
  'requirement.view', 'requirement.manage', 'release.view', 'release.manage',
  'partner.view', 'partner.manage'
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'super_admin';

INSERT OR IGNORE INTO people (email, name, source_type, source_id, status)
SELECT email, name, 'customer', id, status FROM customers;

INSERT OR IGNORE INTO people (email, name, source_type, source_id, status)
SELECT email, name, 'user', id, status FROM users;

INSERT INTO organizations (name, legal_name, status)
SELECT COALESCE(NULLIF(c.company, ''), NULLIF(c.name, ''), 'Customer') || ' #' || c.id,
       COALESCE(NULLIF(c.company, ''), NULLIF(c.name, ''), 'Customer'),
       CASE WHEN c.status IN ('active', 'trial') THEN 'active' ELSE 'inactive' END
FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM organization_members m
  WHERE m.account_type = 'customer' AND m.account_id = c.id
);

INSERT OR IGNORE INTO organization_members (organization_id, account_type, account_id, member_role, status)
SELECT o.id, 'customer', c.id, 'customer',
       CASE WHEN c.status IN ('active', 'trial') THEN 'active' ELSE 'inactive' END
FROM customers c
JOIN organizations o ON o.name = COALESCE(NULLIF(c.company, ''), NULLIF(c.name, ''), 'Customer') || ' #' || c.id;

INSERT OR IGNORE INTO organizations (name, legal_name, status)
SELECT 'SMRITISYS Internal', 'SMRITISYS Internal', 'active'
WHERE EXISTS (SELECT 1 FROM users);

INSERT OR IGNORE INTO organization_members (organization_id, account_type, account_id, member_role, status)
SELECT o.id, 'user', u.id,
       CASE WHEN u.role IN ('staff', 'admin', 'super_admin') THEN u.role ELSE 'staff' END,
       u.status
FROM users u
JOIN organizations o ON o.name = 'SMRITISYS Internal';
