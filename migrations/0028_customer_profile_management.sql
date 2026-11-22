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

CREATE INDEX IF NOT EXISTS idx_profiles_customer
  ON customer_profiles(customer_id);
CREATE INDEX IF NOT EXISTS idx_addresses_customer
  ON customer_addresses(customer_id);

INSERT OR IGNORE INTO permissions (name, description) VALUES
  ('partner.customer.update_contact', 'Update contact name and phone for assigned customers');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('partner_admin', 'partner_member')
  AND p.name = 'partner.customer.update_contact';
