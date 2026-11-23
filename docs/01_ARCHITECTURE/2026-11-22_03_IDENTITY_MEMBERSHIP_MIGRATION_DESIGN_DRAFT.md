---
title: "Identity Membership and Relationship Migration Design"
module: "01_ARCHITECTURE"
category: "MIGRATION-DESIGN"
document_type: "REVIEW-DRAFT"
product: "SMRITISYS Control Plane"
version: "0.1.0"
created_date: "2026-11-22"
status: "Draft — not an executable migration"
tags: ["identity", "memberships", "relationships", "D1", "migration"]
related_documents:
  - "./2026-11-22_02_ARCHITECTURE_SPEC_IDENTITY-ORGANIZATION-RELATIONSHIP_MODEL_V1_1.md"
---

# Identity Membership and Relationship Migration Design

## Status and safety boundary

This is a review-only design for the approved conceptual baseline in
[Identity Specification 1.1.0](./2026-11-22_02_ARCHITECTURE_SPEC_IDENTITY-ORGANIZATION-RELATIONSHIP_MODEL_V1_1.md).
The SQL below is illustrative and is not executable migration code.

No production migration, schema change, API authorization change, or data
mutation is authorized by this document. Migration `0029` has already added
`sessions.organization_id` and explicit session organization selection is
implemented. An earlier revision's proposed `active_membership_id` session
column is superseded and must not be reintroduced. Production currently has no
partner memberships, but it does have one active partner-customer assignment
and one pending partner invitation; synthetic fixtures are still required to
test partner-member authorization.

### Local implementation status

The uncommitted working tree now contains migration
[`0031_identity_organization_scope.sql`](../../migrations/0031_identity_organization_scope.sql)
and matching API/schema changes for explicit ownership of licenses, support
tickets, orders, and AMC contracts. The migration backfills ownership only
when a customer has exactly one active organization membership, imports only
missing active canonical partner memberships from active compatibility rows,
and aligns active partner roles without reactivating inactive memberships.
Customer and partner access now uses the selected organization, canonical
membership roles, and active partner assignments; ambiguous account/license
selection fails closed.

The draft's original local-only status was superseded when the production D1
workflow applied migration `0031_identity_organization_scope.sql` on
2026-11-22. Recheck the remote migration ledger before future work. This narrow
migration does not implement the person/role reference columns or pairwise
relationship table proposed in the illustrative sections below; those remain
a separate design.

## Scope of this migration design

The additive foundation covers:

- A person and role reference on canonical `organization_members`.
- A compatibility reference from `partner_memberships` to that canonical
  membership.
- Pairwise organization relationships, with `partner_assignment` as the only
  initial seeded type.
- A backfill that preserves current partner assignment semantics without
  inferring sales, service, or implementation attribution.

It does not add relationship-specific permissions, deal registration, partner
hierarchy, pricing, commissions, billing, or payout behavior. Those require
separate business-policy specifications.

## Production preflight findings

The read-only inventory is recorded in
[Identity Specification 1.1.0](./2026-11-22_02_ARCHITECTURE_SPEC_IDENTITY-ORGANIZATION-RELATIONSHIP_MODEL_V1_1.md).
The production identity tables currently contain two people, two organization
memberships, no partner memberships, one active partner-customer assignment,
and one pending partner invitation. The orphan and invalid-role checks
returned zero, and `PRAGMA foreign_key_check` returned no violations. There
are no active accounts with multiple organization memberships.

The existing assignment must be included in any future preflight and
reconciliation; it is not evidence of sales attribution. Test fixtures must
also cover partner-member authorization and conflicting legacy records.

## Preflight checks before any future application

Run these read-only checks against the target database immediately before
design approval and migration preparation. Every unresolved result must be
reviewed; do not auto-merge or silently skip records.

```sql
-- Every existing membership must resolve to one person and one role.
SELECT m.id, m.account_type, m.account_id, m.member_role
FROM organization_members m
LEFT JOIN people p
  ON p.source_type = m.account_type AND p.source_id = m.account_id
LEFT JOIN roles r
  ON r.name = m.member_role
WHERE p.id IS NULL OR r.id IS NULL;

-- A partner membership may create a canonical membership only if an existing
-- canonical row does not conflict with its partner role or status.
SELECT pm.id, pm.partner_organization_id, pm.account_type, pm.account_id,
       pm.partner_role, pm.status, m.member_role, m.status
FROM partner_memberships pm
JOIN organization_members m
  ON m.organization_id = pm.partner_organization_id
 AND m.account_type = pm.account_type
 AND m.account_id = pm.account_id
WHERE m.member_role <> pm.partner_role OR m.status <> pm.status;

-- The first relationship backfill supports only the currently defined legacy
-- assignment states. Any other value needs an explicit mapping.
SELECT DISTINCT status
FROM partner_customer_links
WHERE status NOT IN ('active', 'revoked');

-- A person may not acquire duplicate membership rows through backfill.
SELECT p.id AS person_id, m.organization_id, COUNT(*) AS membership_count
FROM organization_members m
JOIN people p
  ON p.source_type = m.account_type AND p.source_id = m.account_id
GROUP BY p.id, m.organization_id
HAVING COUNT(*) > 1;
```

The above checks are expected to return no rows for an implementation-ready
database. The production inventory on 2026-11-22 returned zero for the
identity/role anomaly checks, and the existing partner-customer assignment has
an allowed `active` status.

## Candidate additive DDL

The following statements are split by migration phase to keep schema
compatibility changes distinct from data backfill. They are not yet approved
for placement in the repository's executable `migrations/` directory.

### DDL phase — membership references

```sql
ALTER TABLE organization_members
  ADD COLUMN person_id INTEGER REFERENCES people(id);

ALTER TABLE organization_members
  ADD COLUMN role_id INTEGER REFERENCES roles(id);

ALTER TABLE partner_memberships
  ADD COLUMN organization_member_id INTEGER
  REFERENCES organization_members(id);

CREATE INDEX idx_organization_members_person_status
  ON organization_members(person_id, status);

CREATE UNIQUE INDEX idx_organization_members_org_person
  ON organization_members(organization_id, person_id)
  WHERE person_id IS NOT NULL;

CREATE UNIQUE INDEX idx_partner_memberships_canonical_member
  ON partner_memberships(organization_member_id)
  WHERE organization_member_id IS NOT NULL;
```

The new columns are nullable so existing clients and rows remain valid before
the backfill and API cutover. Do not add a `NOT NULL` constraint until all rows
have been checked and the runtime is ready to use the fields.

Session organization selection is already represented by
`sessions.organization_id` and implemented by migration `0029`. Do not add a
second session-context field from an older revision of this draft.

### DDL phase — pairwise organization relationships

```sql
CREATE TABLE organization_relationship_types (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE organization_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_organization_id INTEGER NOT NULL,
  to_organization_id INTEGER NOT NULL,
  relationship_type TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'active', 'suspended', 'revoked', 'ended')),
  valid_from TEXT,
  valid_to TEXT,
  created_by_person_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (from_organization_id <> to_organization_id),
  FOREIGN KEY (from_organization_id) REFERENCES organizations(id),
  FOREIGN KEY (to_organization_id) REFERENCES organizations(id),
  FOREIGN KEY (relationship_type) REFERENCES organization_relationship_types(code),
  FOREIGN KEY (created_by_person_id) REFERENCES people(id)
);

CREATE INDEX idx_org_relationships_from_type_status
  ON organization_relationships(from_organization_id, relationship_type, status);

CREATE INDEX idx_org_relationships_to_type_status
  ON organization_relationships(to_organization_id, relationship_type, status);

CREATE UNIQUE INDEX idx_org_relationships_unique_active
  ON organization_relationships(
    from_organization_id, to_organization_id, relationship_type
  )
  WHERE status = 'active';

INSERT INTO organization_relationship_types (code, label, description)
VALUES (
  'partner_assignment',
  'Partner assignment',
  'Access assignment carried forward from the legacy partner-customer link.'
);
```

Direction is fixed for this table: `from_organization_id` is the partner or
provider; `to_organization_id` is the customer or recipient. The initial type
`partner_assignment` is the only type seeded by this design. It does not imply
sales credit, a reseller transaction, a service commitment, or an
implementation responsibility. Additional relationship types require business
approval before they are enabled.

### Backfill phase — canonical memberships and partner adapter

Preflight checks must pass before these statements are run. The backfill uses
exact account-source identity, never email matching.

```sql
-- Attach people and roles to existing canonical memberships.
UPDATE organization_members AS m
SET person_id = (
      SELECT p.id
      FROM people p
      WHERE p.source_type = m.account_type AND p.source_id = m.account_id
    ),
    role_id = (
      SELECT r.id
      FROM roles r
      WHERE r.name = m.member_role
    )
WHERE m.person_id IS NULL OR m.role_id IS NULL;

-- Create a canonical organization membership for legacy partner members that
-- do not already have one. Preflight must reject role/status conflicts first.
INSERT INTO organization_members (
  organization_id, account_type, account_id, member_role, status, person_id, role_id
)
SELECT pm.partner_organization_id, pm.account_type, pm.account_id,
       pm.partner_role, pm.status, p.id, r.id
FROM partner_memberships pm
JOIN people p
  ON p.source_type = pm.account_type AND p.source_id = pm.account_id
JOIN roles r
  ON r.name = pm.partner_role
WHERE NOT EXISTS (
  SELECT 1
  FROM organization_members m
  WHERE m.organization_id = pm.partner_organization_id
    AND m.account_type = pm.account_type
    AND m.account_id = pm.account_id
);

-- Resolve the partner adapter to its canonical membership.
UPDATE partner_memberships AS pm
SET organization_member_id = (
  SELECT m.id
  FROM organization_members m
  WHERE m.organization_id = pm.partner_organization_id
    AND m.account_type = pm.account_type
    AND m.account_id = pm.account_id
)
WHERE pm.organization_member_id IS NULL;
```

### Backfill phase — existing partner-customer access assignments

```sql
INSERT INTO organization_relationships (
  from_organization_id, to_organization_id, relationship_type, status,
  valid_from, valid_to, created_by_person_id, created_at, updated_at
)
SELECT pcl.partner_organization_id,
       pcl.customer_organization_id,
       'partner_assignment',
       CASE pcl.status
         WHEN 'active' THEN 'active'
         WHEN 'revoked' THEN 'revoked'
       END,
       pcl.created_at,
       NULL,
       NULL,
       pcl.created_at,
       pcl.created_at
FROM partner_customer_links pcl
WHERE pcl.status IN ('active', 'revoked')
  AND NOT EXISTS (
    SELECT 1
    FROM organization_relationships rel
    WHERE rel.from_organization_id = pcl.partner_organization_id
      AND rel.to_organization_id = pcl.customer_organization_id
      AND rel.relationship_type = 'partner_assignment'
  );
```

The legacy table has no actor or revocation timestamp, so the backfill must
leave `created_by_person_id` and `valid_to` unknown rather than invent values.
Keep the legacy table and current API behavior until a separately reviewed
cutover. The initial DDL does not dual-write or change authorization.

## Post-backfill validation

Before any code cutover, require all of the following:

```sql
SELECT COUNT(*) AS memberships_missing_person_or_role
FROM organization_members
WHERE person_id IS NULL OR role_id IS NULL;

SELECT COUNT(*) AS partner_memberships_missing_canonical_membership
FROM partner_memberships
WHERE organization_member_id IS NULL;

SELECT pcl.id
FROM partner_customer_links pcl
LEFT JOIN organization_relationships rel
  ON rel.from_organization_id = pcl.partner_organization_id
 AND rel.to_organization_id = pcl.customer_organization_id
 AND rel.relationship_type = 'partner_assignment'
WHERE rel.id IS NULL;

PRAGMA foreign_key_check;
```

Reconcile row counts and statuses by source table. No unexplained mismatch is
acceptable. A zero result in production partner-specific checks is not a
substitute for the synthetic non-empty migration fixture.

## Rollback and recovery plan

1. **Before any future production migration:** create a secure D1 export or
   backup, store it outside the repository, and verify restoration in an
   isolated environment. Never commit production data.
2. **This design is additive:** it does not drop or rewrite legacy columns or
   tables. If only the DDL/backfill phase is applied and the application is
   unchanged, the old application continues to use the old columns and tables.
3. **If migration output is interrupted or unclear:** inspect the D1 migration
   ledger and live schema before retrying. Do not blindly rerun `ALTER TABLE`
   statements or manually edit the migration ledger.
4. **If data reconciliation fails:** stop the application cutover. Prefer a
   reviewed forward correction. Do not drop new objects as an automatic
   rollback.
5. **If production data is damaged:** restore only from the verified backup
   under an incident-approved recovery plan, accounting for writes made after
   the backup. A backup captured after a migration does not replace a
   pre-migration recovery point.
6. **Before later removing legacy structures:** require a separate migration,
   dependency search, production usage verification, restore rehearsal, and
   approval.

Cloudflare documents that `wrangler d1 migrations apply` prompts for
confirmation and captures a backup after applying. That post-apply backup is
not the pre-apply recovery point required above.

## Synthetic fixture and test plan

The draft must be tested against a legacy-shaped in-memory database based on
the repository's current `schema.sql` and identity migrations. The fixture
should include:

- One internal user with a `super_admin` membership.
- One customer account and its existing organization membership.
- One partner organization and partner classification.
- A partner member with no matching general membership, exercising the adapter
  backfill.
- One active and one revoked partner-customer link.
- A deliberately conflicting partner role/status row for preflight rejection.
- Two independent memberships for the same person to prove no email-based
  merge or first-row assumption is introduced by this migration.

Assertions:

- Existing organization/account IDs, credentials, and role names are preserved.
- Backfill assigns `person_id` and `role_id` by source account and role name.
- Partner membership resolves to exactly one canonical organization member.
- Legacy links become only `partner_assignment` relationships, preserving
  active/revoked semantics.
- Relationship grants do not create or imply permission rows.
- Duplicate active pair/type relationships and invalid foreign keys are
  rejected.
- Preflight reports conflicting role/status rows instead of overwriting them.
- Running the preflight/backfill validation on the resulting fixture returns no
  unresolved rows.

This is not a substitute for testing the later API context-selection change.
That change requires its own implementation, authorization tests, and approval.

## Next approval boundary

This design may be reviewed and revised. Its successful in-memory validation
supports review of the proposed design only. It does not authorize creating an
executable migration file in `migrations/`, changing application code,
applying D1 migrations, changing production data, or deploying.

## Draft validation record

The SQL blocks in this document were extracted and executed against an
in-memory SQLite database initialized from the current `schema.sql` and
`0002_identity_rbac.sql`, with synthetic internal, customer, partner-member,
active-link, and revoked-link records. The checks passed for:

- Canonical person and role backfill.
- Creating and resolving a partner membership adapter.
- Preserving active and revoked access-assignment states.
- Foreign-key validation.
- Detecting a conflicting legacy partner role without overwriting it.

The repository's existing test suite passed **120/120**. It includes local
tests for explicit session organization selection and synthetic partner/customer
scoping. This does not validate Cloudflare's remote migration execution,
production authorization behavior for multiple memberships, or live partner
workflows. No production SQL was executed as part of this design review.
