# Channel Partner, Commercial, and Follow-up Policy Options

**Status:** Business-policy draft; newest execution decisions defer onboarding, financial rules, SLA automation, credential rotation, and recovery execution
**Scope:** SMRITISYS control plane only. Retail OS remains separate; the actual billing/payment system of record is not approved.
**Safety:** This draft does not authorize production data changes, financial calculations, payouts, outbound messages, or Cloudflare account changes.

## Current controlling decisions — 2026-11-22

- No approved partner roster or import source exists. Existing production records may be discovered and reconciled read-only only. Do not create, import, activate, or invite partner records.
- Retain exactly these approved partner categories: Channel Partner, Reseller, Implementation Partner, Technology Partner, Referral Partner, and Distributor.
- Mixed billing is intended, but the billing/payment system of record and provider integration are unapproved. Defer payment integration, reconciliation, invoicing, and payment-status synchronization. Order or license status is not proof of payment.
- Defer all financial rules and workflows, including prices, discounts, partner margins, commissions, payouts, deal-lock periods, refunds, and reversals. Do not calculate or approve commissions.
- The business timezone is Asia/Kolkata (IST). Working days, operating hours, holidays, ownership, assignment, SLA, and escalation rules are not approved. Do not activate reminders, SLA enforcement, or automatic escalation.
- Approved operational metrics and visibility boundaries are specified in
  [the operational analytics and recovery plan](./2026-11-22_05_OPERATIONAL_ANALYTICS_CREDENTIAL_ROTATION_AND_D1_RECOVERY_PLAN.md).
- Credential rotation and D1 recovery are planning-only. Rotation requires an authorized Cloudflare account administrator and separate approval. Recovery requires a provisioned, verified non-production D1 target and separate approval.

The previously recorded 90-day deal-protection duration and draft follow-up timing targets are superseded for execution by these decisions. Do not implement or enforce them without separate approval.

## Current baseline

- Partner onboarding, partner contacts, customer links, and partner administration screens exist.
- The read-only production snapshot contains one active channel-partner classification, one active partner-customer assignment, one pending partner invitation, and no active partner memberships. These existing records were not modified.
- Partner-customer links are access assignments, not sales attribution.
- A customer may have separate sourced-by, sold-by, implemented-by, and serviced-by relationships.
- SMRITISYS may retain existing license/order records, but neither status proves payment. It must not become an assumed source of truth for invoices, payments, accounting, inventory, or tax transactions.
- Cloudflare D1 Time Travel is available subject to the account plan. A recovery exercise has not been performed and an isolated target has not been provisioned and confirmed.

## 1. Partner onboarding and governance

| Policy | Proposed baseline | Decision needed |
|---|---|---|
| Partner categories | Keep the six approved categories: channel partner, reseller, implementation partner, technology partner, referral partner, distributor. | No further category decision is required. |
| Partner organization | One canonical organization record, with multiple contacts represented by independent memberships. | Approve before adding a partner roster. |
| Relationship scope | Explicit customer links; no access inherited from partner hierarchy or territory. | Confirm. |
| Agreement/compliance | Track status only: not started, submitted, under review, approved, expired, suspended. | Define required documents and approval authority. R2 is unavailable, so file-storage design is separate. |
| Certification | Track certification status and expiry as metadata; do not grant permissions or commercial benefits implicitly. | Define certification requirements and consequences. |

No partner records should be created until an approved roster and import source are supplied. Partner onboarding and roster import are deferred; the presence of existing production records does not authorize changing or inviting anyone.

## 2. Deal registration and attribution

### Proposed workflow

1. A partner submits a prospect/customer and opportunity.
2. The system checks likely duplicates using normalized organization name, verified domain, and contact email; a match is flagged for review, not automatically merged or rejected.
3. An authorized internal reviewer approves, rejects, or requests information.
4. An approved opportunity records its attribution separately from access/service relationships.
5. Conversion links the opportunity to the canonical customer organization; it does not create a duplicate customer.

### Workflow foundation currently implemented

The first increment supports partner-scoped prospect submissions and internal review states (`submitted`, `under_review`, `needs_information`, `approved`, `rejected`). A partner can respond to a `needs_information` review request, which returns the registration to `submitted`. Super-admin decisions and partner responses are audited. Exact case-insensitive organization-name or contact-email matches are shown to reviewers as possible-duplicate hints only; they do not block submission or decide ownership. Partners see only their own registrations and partner-facing decision summaries. Migration `0030_partner_workflow_foundations.sql` was applied to production on 2026-11-22.

This foundation does **not** implement the broader workflow above: there is no draft flow, domain verification, customer conversion, attribution assignment, expiration/withdrawal, deal-protection behavior, pricing, commission, payout, or customer/partner record seeding. An `approved` status is an internal review outcome only and grants no commercial rights. No partner records were seeded by this workflow.

### Proposed states

`draft → submitted → under_review → approved | rejected | needs_information → converted`

An approved registration may later become `expired` or `withdrawn`. State changes should be audited, and partners should see only their own registrations and permitted customer scope.

### Protection-period status

A 90-day duration was recorded in an earlier draft, but the current instruction defers deal-lock periods and all related commercial rules. It is not an active approval and must not be implemented or enforced. An `approved` registration status remains an internal review outcome only; it grants no commercial rights.

## 3. Price books and discounts — deferred

No price book, discount tier, partner margin, or financial workflow is approved. The following are design considerations only and must not be activated:

- Version price books with currency, effective dates, and status.
- Store the price-book version on each quote/order so historical pricing is reproducible.
- Make discount authority explicit by partner organization or category; never infer a discount from partner role.
- Require internal approval above an agreed discount threshold.
- Do not expose another partner's pricing or customer data.

Price-book ownership, currencies, tax treatment, discount bands, approval thresholds, and quote validity would each require separate commercial approval.

## 4. Commission ledger and settlement — deferred

Do not create a commission calculation, payable amount, approval, or payout workflow. Existing commission-related structures, if retained for compatibility, remain inactive; the production commission table currently has no records.

### Previously listed calculation models — not approved

These are retained only as historical design notes. They are not recommendations
or approved choices:

1. **Fixed referral fee:** simple, but less suitable for recurring partner delivery.
2. **Percentage of net collected license revenue:** auditable and aligned to cash collection; requires a trusted billing/collection signal.
3. **Percentage of gross margin:** aligns incentives to margin but requires reliable cost data.
4. **Product/partner-specific schedule:** flexible, but needs versioned contracts and more administration.

### Previously suggested controls — not approved

- Use an append-only ledger of accruals, adjustments, reversals, approvals, and reconciliation references.
- Never edit a posted financial entry; correct it with a linked reversal/adjustment.
- Exclude taxes and separately identify discounts/refunds only after the calculation basis is approved.
- Require internal review before a statement is finalized.
- Keep payouts manual until reconciliation and legal/tax requirements are established.

The commission basis, rates, eligible products, earning event, refund/cancellation treatment, currency, rounding, withholding/tax responsibility, statement period, dispute window, and approvers all require separate commercial approval.

## 5. Billing, orders, and renewals — deferred

Mixed billing is the intended model. The actual billing/payment system of record and provider integration are not approved. Until then:

- Do not integrate a payment provider, reconcile financial records, automate invoices, or synchronize payment status.
- Do not infer payment from a license, order, invitation, or activation status.
- Do not trigger provisioning or entitlement changes based on an unverified payment event.

Before any integration, approve the actual system of record, provider, source event, reconciliation method, and ownership of subscription status.

## 6. Follow-up queues and service targets

The local implementation has a paginated, read-only queue containing open/in-progress support tickets, submitted/in-review partner deals, and unexpired customer/partner invitations, plus a manually managed internal task list. Staff may set an optional owner, due date, and task status. No default assignment, due-date policy, working calendar, SLA, or escalation is approved.

### Timing and automation status

- Prior draft targets (1/3/2 business days) and an internal invitation reminder are superseded and are not approved for implementation.
- Asia/Kolkata (IST) is the approved business timezone only. Working days, hours, holidays, pause states, default assignment, SLA rules, and escalation are unapproved.
- Keep tasks manually managed. Do not activate automated reminders, SLA calculations/enforcement, automatic assignment, or escalation. No customer/partner outbound messages are approved.

## 7. Operational reporting

The initial approved metrics are operational only:

- Total organizations and active customers.
- Active partners by the six approved partner categories.
- Active organization memberships.
- Active licenses and license utilization.
- Support ticket counts by status.
- Release and deployment status where an authoritative source is available.
- Customer onboarding progress where an explicit lifecycle status exists.

Use the definitions and access rules in
[the operational analytics and recovery plan](./2026-11-22_05_OPERATIONAL_ANALYTICS_CREDENTIAL_ROTATION_AND_D1_RECOVERY_PLAN.md).
Do not add revenue, commission, margin, payout, payment, or other financial
analytics. Do not infer onboarding stages or deployment success from unrelated
records. Internal authorized administrators may see platform-wide operational
metrics; partners are limited to explicitly assigned customers and permitted
customer/license information; customers are limited to their own organization.
No cross-partner visibility is permitted.

## 8. Operational safeguards

- Prepare an inventory of credentials, permissions, consumers, and affected deployments before any rotation. Only an authorized Cloudflare account administrator may execute an explicitly approved rotation.
- Never request, copy, or store credential values in this workflow.
- Prepare the D1 recovery procedure first. Production must never be used as a test/recovery target; use only an operator-provisioned and verified isolated non-production database.
- D1 Time Travel restores in place and is destructive; it does not clone to a new database. Do not restore production or execute recovery without a separately verified target and approval.
- Do not apply future migrations, seed partner data, deploy, or enable outbound notifications under this draft.

## Approval checklist

- [x] Retain the six partner categories.
- [ ] Provide an approved partner roster and import source before onboarding or importing partners.
- [ ] Approve the billing/payment system of record and provider integration.
- [ ] Obtain separate commercial approval for all financial rules; no rates or calculations are active.
- [ ] Approve operating days/hours, holiday calendar, assignment, SLA, and escalation before automating follow-up.
- [x] Approve operational metric categories and organization-scoped visibility; use the linked definitions.
- [ ] Have an authorized Cloudflare administrator approve and execute the separately planned credential rotation.
- [ ] Provision and confirm an isolated non-production D1 target, then separately approve any recovery exercise.
- [ ] Separately authorize any live portal verification that writes production sessions or audit records.
