-- Phase 8 local verification seed: one partner linked to Organization A.

INSERT OR IGNORE INTO customers (id, email, password_hash, name, company, status)
VALUES (103, 'partner@example.com', '783f1ea39d9119c1cf5d9b0c1bc579b7780df38992d9774837ac3917ebcc98ee', 'Partner Admin', 'Channel Partner Pvt Ltd', 'active');

INSERT OR IGNORE INTO people (id, email, name, source_type, source_id, status)
VALUES (103, 'partner@example.com', 'Partner Admin', 'customer', 103, 'active');

INSERT OR IGNORE INTO organizations (id, name, legal_name, status)
VALUES (103, 'Channel Partner Pvt Ltd', 'Channel Partner Pvt Ltd', 'active');

INSERT OR IGNORE INTO organization_members (organization_id, account_type, account_id, member_role, status)
VALUES (103, 'customer', 103, 'customer', 'active');

INSERT OR IGNORE INTO partner_memberships (partner_organization_id, account_type, account_id, partner_role, partner_type, status)
VALUES (103, 'customer', 103, 'partner_admin', 'reseller', 'active');

INSERT OR IGNORE INTO partner_customer_links (partner_organization_id, customer_organization_id, status)
VALUES (103, 101, 'active');