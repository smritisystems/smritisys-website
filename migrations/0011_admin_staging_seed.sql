-- Phase 10 local verification seed: isolated super-admin identity.

INSERT OR IGNORE INTO users (id, email, password_hash, name, role, status)
VALUES (201, 'admin.phase10@example.com', '783f1ea39d9119c1cf5d9b0c1bc579b7780df38992d9774837ac3917ebcc98ee', 'Phase 10 Admin', 'super_admin', 'active');

INSERT OR IGNORE INTO people (id, email, name, source_type, source_id, status)
VALUES (201, 'admin.phase10@example.com', 'Phase 10 Admin', 'user', 201, 'active');

INSERT OR IGNORE INTO organizations (id, name, legal_name, status)
VALUES (201, 'SMRITISYS Internal', 'SMRITISYS Internal', 'active');

INSERT OR IGNORE INTO organization_members (organization_id, account_type, account_id, member_role, status)
VALUES (201, 'user', 201, 'super_admin', 'active');
