---
title: "Customer and Channel Partner Administration Capability Review"
module: "01_ARCHITECTURE"
category: "ARCHITECTURE-REVIEW"
document_type: "REPORT"
product: "PrathamOne EduOS"
edition: "Coaching Institute Edition"
version: "1.0.0"
doc_version: "1.0"
created_date: "2026-11-15"
updated_date: "2026-11-15"
author: "Jawahar R Mallah"
organization: "AITDL — AI Technology & Development Lab"
status: "In Review"
tags: ["admin", "customers", "channel-partners", "organizations", "identity", "RBAC"]
entities: ["Customer", "Organization", "OrganizationMembership", "PartnerMembership", "PartnerCustomerLink"]
api_routes:
  - "/api/admin/organizations"
  - "/api/admin/customer-invites"
  - "/api/customer-invites/accept"
  - "/api/partner/me"
  - "/api/partner/customers"
  - "/api/partner/licenses"
  - "/api/partner/releases"
related_modules: ["12_RBAC_SECURITY", "13_SYSADMIN_SETTINGS", "16_DATABASE_API"]
---

# Customer and Channel Partner Administration Review

## Executive summary

The production system already has a customer account model, organization memberships, partner relationship tables, partner roles, and a read-only partner portal. However, the production database currently has **no partner memberships and no partner-to-customer links**, and the internal admin panel has **no channel-partner onboarding or relationship-management workflow**.

Customer onboarding does exist through one-time customer invitations. A separate license-issuance path can also register a customer for activation-only use. These flows do not currently provide a complete customer lifecycle, and they create a new organization for each customer account rather than reliably reusing one canonical organization for multiple contacts.

**Recommendation:** Do not add a separate `partners` or `channel_partners` master table. Keep `organizations` as the organization master and extend the existing identity, membership, and partner relationship model. Before scaling onboarding, fix organization reuse and customer account activation, then add a super-admin partner onboarding and customer-link workflow with explicit relationship types, RBAC, audit history, and scoped portal access.

## Scope and evidence

This review covers the live SMRITISYS admin page and the repository at the time of review. It is an architecture and feature-capability review, not a penetration test.

Evidence collected:

- Read-only production D1 counts from `smritisys-db`:
  - `organizations`: 2
  - `customers`: 1
  - `customer_invites`: 0
  - `partner_memberships`: 0
  - `partner_customer_links`: 0
  - `relationships`: 0
  - Active organization memberships: one customer account and one internal super-admin account
- The live Organizations page displays the customer organization and the SMRITISYS internal organization. It exposes a customer-invite form, but no partner section or partner actions.
- Source reviewed: [admin.html](../../admin.html), [admin.js](../../js/admin.js), [API handlers](<../../functions/api/[[path]].js>), [schema.sql](../../schema.sql), [partner relationship migration](../../migrations/0008_partner_relationships.sql), [partner portal](../../partner.html), [partner script](../../js/partner.js), [architecture boundary](../../ARCHITECTURE.md), and focused tests.
- Validation: `node --test tests/partner-contract.test.js tests/admin-contract.test.js` passed **9/9** tests. These are contract checks; they do not prove partner onboarding or customer lifecycle completeness.
- No production records, application code, or deployment settings were changed during this review.

## Existing capabilities

### Customers

1. **Customer invitation:** The Organizations page lets a super-admin invite a customer using email, optional contact name, and organization name. The API stores a token hash, creates a 24-hour one-time setup link, rate-limits creation, audits the action, and lets the customer set their own password on acceptance.
2. **Activation-only license issuance:** The Products & Licenses workspace can issue a license to a new customer without creating portal access. The form explicitly says the customer receives activation credentials only.
3. **Organization display:** The admin page lists organizations with legal name, status, and active member count.
4. **Customer portal:** Customer sessions and data are scoped through active organization membership. The customer portal offers profile, organization, license, support, and related customer workflows.

The admin page does **not** currently provide a customer directory with search, customer detail/edit controls, organization reuse when inviting another contact, or member-management controls. The invitation list is separate from the organization list.

### Channel partners

The underlying schema already defines:

- `partner_memberships`: associates a user/customer account with a partner organization and role.
- `partner_customer_links`: associates a partner organization with customer organizations.
- Partner RBAC roles: `partner_admin` and `partner_member`.

The partner portal authenticates using an existing SMRITISYS account and requires an active partner membership. Its implemented views are partner profile, linked customers, linked-customer licenses, and releases. API reads are scoped through the authenticated partner organization and active customer links.

The code does **not** expose an admin API or UI to create a partner relationship, invite partner contacts, assign partner roles/types, or create/revoke partner-customer links. The current partner API routes are GET-only. The architecture document lists leads, opportunities, quotes, commissions, support, and training as target partner capabilities; those are not implemented in the reviewed partner portal.

## Gaps and risks, ranked

### High — customer accounts can create duplicate organization records

The customer identity helper derives an organization name by appending the customer account ID to the company/contact name. The live customer organization is displayed as `Prashant Academy #1`. Inviting another contact at the same business therefore creates a different organization rather than adding that contact to the existing company organization.

This conflicts with the intended organization-as-master model and will fragment licenses, support, announcements, and partner links as onboarding grows. The organization table supports multiple memberships, but the current customer invitation flow does not let the admin select an existing organization or add another member to it.

### High — activation-only customers do not have a supported portal-access conversion path

Direct license issuance creates a customer account with no customer invitation or sign-in. The customer-invite API rejects emails that already exist in `customers`, and the ordinary signup path also cannot insert a duplicate email. The reviewed admin UI has no action to activate or invite an existing activation-only account. As a result, license-only and portal-enabled customer onboarding are separate paths with no clear conversion step.

### High — partner relationships exist in the schema but cannot be administered

There are no production partner memberships or customer links. Without admin onboarding and assignment operations, the partner portal cannot be used by a real partner through the supported UI. Manual database inserts would bypass a defined approval, validation, and audit workflow and are not recommended.

### Medium — organization relationship type is not populated or enforced

The `relationships` table has no production rows. The organization list does not show whether an organization is a customer, channel partner, internal organization, or another type. The partner tables point to organization IDs, but do not themselves validate that one organization is actually a partner and the other is a customer. `partner_type` defaults to `reseller` but is plain text rather than a constrained, policy-validated set.

### Medium — one identity with multiple memberships is not fully represented in session selection

The shared identity-session query selects the first active organization membership, and partner-session selection chooses the first active partner membership. This is insufficient for a person who belongs to multiple customer organizations or partner organizations. The architecture describes multi-relationship identity, but the current session selection has no explicit organization/partner context switch.

### Medium — admin operations are fragmented

The admin has staff users, an organization summary, customer invitations, license issuance, and audit views. It does not yet provide one searchable customer/partner directory that shows relationship type, contacts, linked partners, license state, invite status, or relationship history.

### Documentation drift

The existing [license architecture document](../LICENSE_ARCHITECTURE.md) still describes monitoring two D1 databases, including `smritisys-db-recovery`, and storing snapshots in that recovery database. That does not match the current production setup, which has one canonical database. The partner architecture document also describes planned capabilities broader than the implemented partner portal.

## Recommended design

### 1. Preserve canonical masters

- Keep `organizations` as the single organization master.
- Keep customer login/person records separate from organization records.
- Reuse `organization_members` for multiple contacts belonging to one organization.
- Reuse `partner_memberships` and `partner_customer_links` for partner access and assigned customers.
- Do not create parallel `partners`, `channel_partners`, or `partner_customers` master tables.
- Record organization relationship type explicitly and validate it in both API and database constraints. Require an organization to be classified as a customer before linking it to a partner.
- Use confirmation and duplicate detection for organization matching; do not silently merge organizations based only on similar names.

### 2. Unify customer onboarding

- Let an admin create a new customer organization or select an existing canonical organization.
- Invite one or more contact accounts into the selected organization with explicit member roles.
- Add a secure activation/invitation flow for an existing activation-only customer account rather than rejecting the registered email or creating a duplicate.
- Keep license-only issuance available, but make its no-portal-access consequence explicit and provide a safe later conversion action.
- Preserve existing organization IDs and license/account history when correcting the current display name or merging verified duplicates.

### 3. Add a controlled channel-partner workflow

- Add a super-admin partner onboarding action that selects/creates an organization, assigns a supported partner type, and invites the first `partner_admin`.
- Use a validated partner-type set, for example `channel_partner`, `reseller`, `implementation_partner`, `technology_partner`, `referral_partner`, and `distributor`, subject to approved commercial policy.
- Add explicit link/unlink operations for customer organizations, with authorization, reason, actor, timestamp, and audit event.
- Grant partner users only the permissions required for their partner role. Preserve the existing read-only scope for customer licenses/releases unless commercial policy explicitly authorizes additional operations.
- Use soft deactivation for organizations and memberships; do not hard-delete records referenced by licenses, audit events, or financial history.

### 4. Improve admin usability and scale readiness

- Add a paginated, searchable directory with filters for organization type, status, partner, and license state.
- Provide detail views for organization profile, contacts, invites, licenses, linked partners/customers, and audit history.
- Add an explicit organization/partner context to the session before supporting multi-organization identities.
- Keep mutations auditable and apply server-side permission checks; hiding controls in the browser is not authorization.
- Add load tests using synthetic data and representative indexed queries before claiming 10,000-customer operational readiness. The current database size does not establish query-throughput capacity.

## Suggested delivery sequence

1. **Identity and data-model correction:** Establish canonical organization typing and existing-organization member invitations; define the activation-only account conversion flow.
2. **Partner lifecycle:** Add partner invite/approval, partner membership assignment, partner type validation, and audited customer linking/unlinking.
3. **Admin directory:** Add unified customer/partner search, pagination, detail pages, and safe status controls.
4. **Verification:** Test duplicate-company prevention, adding a second contact to the same organization, partner role assignment, link revocation, cross-organization isolation, multi-membership selection, and audit completeness.
5. **Operational readiness:** Update architecture documentation, confirm backup and restore procedures, and load-test expected peak request patterns.

## Conclusion

**Customers already exist and can be added** through customer invitations or activation-only license issuance. **Channel partners exist only as schema/API/portal foundations**; there are no live partner records and no supported admin workflow to add or manage them. The highest-priority correction is to make customer contacts reuse a canonical organization before expanding partner onboarding, so that partner assignments and customer data remain attached to the right business entity.

Documentation indexing and validation commands were not run because `tools/docs_manager.py` is not present in this repository. The corporate header checker `scripts/manage_headers.py` is also absent; this review adds no source-code files.
