---
title: "Operational Analytics, Credential Rotation, and Isolated D1 Recovery Plan"
module: "01_ARCHITECTURE"
category: "OPERATIONAL-READINESS"
document_type: "CONTROLLED-PLAN"
product: "SMRITISYS Control Plane"
version: "1.0.0"
created_date: "2026-11-22"
status: "Operational analytics prepared locally; production release and privileged execution deferred"
tags: ["analytics", "authorization", "credentials", "D1", "recovery", "operations"]
---

# Operational Analytics, Credential Rotation, and Isolated D1 Recovery Plan

## Status and safety boundary

This document records approved operational metric categories, current read-only
findings, and preparation steps. Local analytics implementation is not a
production release authorization. No production schema or authorization
change, deployment, credential rotation, data export/import, or recovery
operation is authorized here. No credential value is included or requested.

## Read-only as-built findings

The production database was queried through read-only Wrangler commands on
2026-11-22. The queries reported zero rows written and `changed_db: false`.

- Applied migration history includes `0029_session_organization_context.sql`
  and `0030_partner_workflow_foundations.sql`; Wrangler reported no pending
  migrations.
- Production contains 3 organizations and 2 active organization memberships.
  Active classifications are one internal, one customer, and one
  `channel_partner` organization.
- Production contains zero partner memberships and zero partner account
  records, one active partner-customer assignment, and one pending partner
  invitation. These are existing records and were not changed.
- There are 2 active licenses and one closed support ticket. Product release
  tables exist; no D1 deployment-status table was found.
- Identity integrity checks found no missing people/roles for memberships,
  no invalid partner assignment endpoints, and no foreign-key violations.
- Eight unexpired sessions exist. Seven have no selected organization and one
  has a selected organization. The API rejects a session without selected
  organization context for organization-scoped authorization. No session was
  created, selected, invalidated, or otherwise modified.
- The repository test suite passed **120/120**, including synthetic tests for
  explicit organization selection, customer isolation, partner assignment
  scope, and the internal super-admin boundary. Live portal sign-in was not
  attempted because sign-in and organization selection write production
  session/audit data.

## Operational analytics contract

The following metric families are approved. Implementation is prepared locally
in the existing internal-admin overview; the production endpoint and dashboard
remain unchanged until separately released.

| Metric | Proposed source and definition | Guardrail |
|---|---|---|
| Total organizations | Count canonical `organizations` rows. | Do not count people/accounts as organizations. |
| Active customers | Count active organizations with the active `customer` classification. | Do not substitute `customers.status` account counts or double-count customer accounts. |
| Active partners by category | Count distinct active organizations classified as one of the six approved categories: channel partner, reseller, implementation partner, technology partner, referral partner, distributor. | Do not count invitations or memberships as partner organizations; do not infer category from role or access. |
| Active organization memberships | Count `organization_members` rows whose membership status is active. | Membership count is not a user count. |
| Active licenses | Count licenses that satisfy the existing license-authority status and validity rules. | A license, order, invitation, or activation status is not proof of payment. |
| License utilization | For active, currently valid licenses, compare active `license_activations` with the sum of `licenses.seats`. | Report numerator and denominator; do not count unused license-code inventory as customer utilization. |
| Support tickets | Count tickets by their stored status. | Do not publish response-time/SLA analytics until the business calendar, operating hours, pauses, and SLA rules are separately approved. |
| Release status | Use stored product release status and publication metadata. | Do not infer deployment success from a release status. |
| Deployment status | Use an authoritative Cloudflare Pages/Workers deployment record only when available to the authorized internal viewer. | No deployment table or dashboard integration was found in D1/repository review; otherwise report unavailable, not zero or successful. |
| Customer onboarding progress | Show only explicit existing workflow states (for example, an invitation's stored state) after the relevant lifecycle is approved. | No aggregate onboarding stage is inferred from unrelated records; partner onboarding remains deferred. |

### Visibility boundaries

| Viewer | Allowed scope |
|---|---|
| Internal authorized administrator | Platform-wide operational aggregates, behind the existing `admin.system` plus internal `user`/`super_admin` guard. |
| Partner | Only explicitly assigned customer organizations and permitted customer/license information for the selected partner organization. No other partner's customers or aggregate performance. |
| Customer | Only the customer's selected organization and its permitted data. |

The existing partner API requires a partner session and filters customer,
license, and release queries by the selected partner organization and active
customer assignment. Customer APIs derive organization scope from the
authenticated membership. These boundaries are also covered by local
synthetic-data tests. Production has no active partner memberships, so live
partner isolation cannot be proven from current production records.

The current internal overview is already protected by the super-admin guard
and exposes basic organization/customer/license counts, license status,
inventory, and recent activity. The full approved metric set above is not
implemented in production. No partner/customer global analytics endpoint is
authorized.

### Local implementation prepared

- The existing `admin/overview` GET response now includes active customer
  organizations, active memberships, active partner organizations by the six
  approved categories, active-license seat utilization, ticket and release
  status counts, and customer invitation states.
- The overview UI presents those aggregates only in the internal-admin
  workspace. It labels invitation status as invitation-only and deployment
  status as unavailable because no authoritative deployment source is
  connected.
- License utilization uses `licenses.seats` for active, currently valid
  licenses and counts active activation records. It does not interpret orders
  or license state as evidence of payment.
- The D1 panel no longer hardcodes a 30-day recovery period. It reports that
  retention is plan-dependent while the Cloudflare account plan remains
  unverified.
- These are local API/UI/test changes only. They add no schema migration,
  production authorization change, or production data change, and have not
  been deployed. Separate release approval is still required.
- Local verification passed: the focused admin API/UI tests and full
  `npm test` suite (120/120).

## Cloudflare credential inventory and rotation plan

### Inventory captured without reading secret values

| Credential or integration | Location / observed permissions | Consumer and known dependency |
|---|---|---|
| Local Wrangler OAuth credential | Stored in the operator's Wrangler user-profile configuration. `wrangler whoami` showed broad write access spanning Workers, KV, routes, scripts, D1, Pages, SSL certificates, AI/AI Search, Queues, Pipelines, Secrets Store, Artifacts, Flagship, Containers, Cloudchamber, Connectivity administration, Email Routing/Sending, Browser, and challenge widgets; account/user read scopes were also present. No token value was copied. | Local operator commands can affect multiple Cloudflare products. Replace only through an authorized account-admin rotation. |
| GitHub Actions secret `CLOUDFLARE_API_TOKEN` | Secret name is configured; its value and permission scopes are not visible through repository metadata. | `.github/workflows/deploy-d1-operations.yml` uses it for production D1 migrations and D1 operations Worker deployment. |
| GitHub Actions variable `CLOUDFLARE_ACCOUNT_ID` | Variable name is configured; it is an identifier, not a credential. | Required by the same D1 operations workflow. |
| Cloudflare Pages Git integration | Configured through Cloudflare dashboard settings; repository configuration does not expose its authorization owner/scopes. | Pages production deploys use the dashboard Git integration and are separate from the D1 operations workflow. |
| Pages/Worker runtime secrets and bindings | Runtime dashboard settings were not inventoried in this read-only repository review. | An authorized Cloudflare operator must inventory names, consumers, and deployment environments; never copy values into this document. |

The repository's `wrangler.toml` is labeled local-only but binds `DB` to the
production D1 database. Do not use the unmodified binding for recovery testing
or local data writes. The D1 operations workflow applies pending production
migrations before deploying a Worker; do not trigger it as a credential
canary.

### Rotation sequence — not executed

1. An authorized Cloudflare account administrator inventories token owners,
   token identifiers/expiry and last-use metadata, exact permission groups,
   Pages Git integration, runtime secrets, and every affected deployment.
   Never export or share token values.
2. Confirm separate credentials and least-privilege scopes for CI and human
   administration. The CI candidate permissions must be verified against the
   actual Wrangler D1 migration and Worker deployment requests; do not assume
   the broad local OAuth scope set is needed by CI.
3. Obtain separate approval for the rotation window, affected deployments,
   rollback owner, and final revocation.
4. Create a replacement credential in Cloudflare and update the approved
   GitHub secret/configuration through an authorized secret-management path.
   Do not place the value in source, shell history, chat, logs, or this plan.
5. Perform only non-mutating identity/metadata checks first. A full workflow
   run is a deployment operation and also applies migrations; run it only
   after a separate deployment approval and a migration preflight.
6. During the approved overlap window, revert the secret to the still-valid
   previous credential if the replacement fails. Revoke the old credential
   only after all consumers pass their approved validation. After revocation,
   rollback requires issuing a new credential; do not plan to restore a
   revoked token.
7. Verify the old credential is revoked, consumers use the replacement, and
   no unexpected permission or deployment changes occurred.

Cloudflare's current [API token permission reference](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
should be checked by the account administrator when choosing exact permission
groups. Rotation has not been performed.

## Isolated D1 recovery plan

### Preconditions

- Production `smritisys-db` must never be the test or recovery target.
- An authorized Cloudflare operator must provision and confirm the exact
  non-production database name and ID. Neither is currently designated in
  this plan.
- Confirm the target belongs to the intended account, is isolated from
  production Pages/Workers, and is empty or explicitly approved for overwrite.
- Confirm the Cloudflare plan's Time Travel retention window. Current Cloudflare
  documentation describes 7 days on Workers Free and 30 days on Workers Paid;
  the account plan was not verified here.
- D1 Time Travel restores in place and overwrites its target; it does not
  clone/fork a production database. Production restore is prohibited by this
  plan. An isolated logical export/import is required for recovery testing.

### Procedure — preparation only

1. Under separate approval, record the source database identity, recovery
   point, expected schema/migration version, and operator/approver.
2. Use a restricted, encrypted, non-repository location for the logical export.
   A full export contains production data and must not be copied into source
   control, chat, or logs. Cloudflare documents
   `wrangler d1 export <source> --remote --output=<restricted-file>`.
   Exports can block other database requests; schedule and monitor the
   approved export window.
3. Before any import, independently verify the operator-confirmed target name
   and ID with Cloudflare metadata and verify that it is not the production
   database. Import only into that target using
   `wrangler d1 execute <confirmed-target> --remote --file=<restricted-file>`.
   Do not run these commands until the target and execution are separately
   approved.
4. Validate the target only: table/schema inventory, migration ledger,
   aggregate row counts, expected statuses, and `PRAGMA foreign_key_check`.
   Run application checks only with a separate non-production configuration
   bound to the confirmed target. Never use the production-bound
   `wrangler.toml` for this test.
5. Record validation evidence without exposing customer data. Retain or remove
   the export according to an approved data-handling/retention policy.

The current production schema inspection found no virtual tables, but export
compatibility must be checked again at execution time. Cloudflare's
[D1 import/export guidance](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
and [Time Travel guidance](https://developers.cloudflare.com/d1/reference/time-travel/)
are the authoritative references. No export, import, restore, or target
provisioning was performed.

## Blockers and separate approvals

- **Partner onboarding:** approved roster/import source required; no partner
  record creation, import, activation, or invitation.
- **Financial workflows:** billing/payment system of record and separate
  commercial policy approval required; no payment integration or financial
  calculations.
- **Follow-up automation:** working calendar, hours, holidays, assignment,
  SLA, and escalation approval required.
- **Analytics production release:** local implementation is prepared; release
  and production verification remain separate work and require approval.
- **Live identity verification:** sign-in/context selection changes production
  session/audit data; separate approval is required before that live test.
- **Credential rotation:** authorized Cloudflare account administrator,
  completed inventory, and separate execution approval required.
- **D1 recovery drill:** operator-provisioned and verified isolated target,
  secure export handling, and separate execution approval required.
