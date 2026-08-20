-- Phase 9: read-only commercial relationship visibility.

INSERT OR IGNORE INTO permissions (name, description)
VALUES ('commercial.view', 'View commercial relationship records');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'customer' AND p.name = 'commercial.view';