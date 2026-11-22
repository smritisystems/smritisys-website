# Channel Partner, Commercial, and Follow-up Policy Options

**Status:** Business-policy draft with partial approvals recorded below; only the explicitly scoped local workflow foundation is implemented
**Scope:** SMRITISYS control plane only. Retail OS remains the operational and accounting system of record.
**Safety:** This draft does not authorize production data changes, financial calculations, payouts, outbound messages, or Cloudflare account changes.

## Approved baseline decisions — 2026-11-22

- Deal-protection duration: **90 days from internal approval**. This approves the duration only; eligibility, attribution, conflict handling, enforcement, expiry consequences, and extension criteria remain undecided.
- Follow-up timing baseline: new support tickets receive a first human response within 1 business day; open tickets awaiting company action receive an internal status update every 3 business days; submitted deals receive internal review within 2 business days; and an internal owner is reminded about an invitation after 2 business days.
- No automated email, SMS, or other outbound message to customers or partners is approved.
- Business calendar, time zone, holidays, pause states, assignment, and escalation rules remain undecided. Do not calculate or enforce business-day deadlines until these are defined.

## Current baseline

- Partner onboarding, partner contacts, customer links, and partner administration screens exist.
- Production currently has no partner organizations, partner contacts, partner invitations, or partner-customer links.
- Partner-customer links are access assignments, not sales attribution.
- A customer may have separate sourced-by, sold-by, implemented-by, and serviced-by relationships.
- SMRITISYS may track licensing, orders, renewals, and commercial approvals. It must not become the source of truth for Retail OS invoices, payments, accounting, inventory, or tax transactions.
- The production D1 database has Cloudflare-managed Time Travel. A restore drill has not been performed; manual exports are not configured.

## 1. Partner onboarding and governance

| Policy | Proposed baseline | Decision needed |
|---|---|---|
| Partner categories | Keep the six current categories: channel partner, reseller, implementation partner, technology partner, referral partner, distributor. | Confirm categories remain distinct from roles and permissions. |
| Partner organization | One canonical organization record, with multiple contacts represented by independent memberships. | Approve before adding a partner roster. |
| Relationship scope | Explicit customer links; no access inherited from partner hierarchy or territory. | Confirm. |
| Agreement/compliance | Track status only: not started, submitted, under review, approved, expired, suspended. | Define required documents and approval authority. R2 is unavailable, so file-storage design is separate. |
| Certification | Track certification status and expiry as metadata; do not grant permissions or commercial benefits implicitly. | Define certification requirements and consequences. |

No partner records should be created until an approved roster is supplied. The existing onboarding workflow can be used once company/contact details and partner classifications are provided.

## 2. Deal registration and attribution

### Proposed workflow

1. A partner submits a prospect/customer and opportunity.
2. The system checks likely duplicates using normalized organization name, verified domain, and contact email; a match is flagged for review, not automatically merged or rejected.
3. An authorized internal reviewer approves, rejects, or requests information.
4. An approved opportunity records its attribution separately from access/service relationships.
5. Conversion links the opportunity to the canonical customer organization; it does not create a duplicate customer.

### Workflow foundation currently implemented

The first increment supports partner-scoped prospect submissions and internal review states (`submitted`, `under_review`, `needs_information`, `approved`, `rejected`). A partner can respond to a `needs_information` review request, which returns the registration to `submitted`. Super-admin decisions and partner responses are audited. Exact case-insensitive organization-name or contact-email matches are shown to reviewers as possible-duplicate hints only; they do not block submission or decide ownership. Partners see only their own registrations and partner-facing decision summaries. Migration `0030_partner_workflow_foundations.sql` was applied to production on 2026-11-22.

This foundation does **not** implement the broader workflow above: there is no draft flow, domain verification, customer conversion, attribution assignment, expiration/withdrawal, deal-protection behavior, pricing, commission, payout, or customer/partner record seeding. An `approved` status is an internal review outcome only and grants no commercial rights. No partner records were seeded.

### Proposed states

`draft → submitted → under_review → approved | rejected | needs_information → converted`

An approved registration may later become `expired` or `withdrawn`. State changes should be audited, and partners should see only their own registrations and permitted customer scope.

### Protection-period decision

The approved baseline is **90 days from internal approval**. The previously considered 60- and 120-day alternatives were not selected.

The duration approval does not define eligible opportunity types, attribution, duplicate/conflict handling, what protection permits, expiry consequences, or extension criteria. Those rules remain unapproved, so the existing local `approved` state must not be treated as granting those rights until the rules are defined and implemented.

## 3. Price books and discounts

### Proposed data controls

- Version price books with currency, effective dates, and status.
- Store the price-book version on each quote/order so historical pricing is reproducible.
- Make discount authority explicit by partner organization or category; never infer a discount from partner role.
- Require internal approval above an agreed discount threshold.
- Do not expose another partner's pricing or customer data.

The price-book owner, currencies, tax treatment, discount bands, approval thresholds, and quote validity period need business approval before implementation.

## 4. Commission ledger and settlement

No commission calculation, payable amount, or payout should be implemented until the commission basis and commercial rules are approved.

### Calculation models to consider

1. **Fixed referral fee:** simple, but less suitable for recurring partner delivery.
2. **Percentage of net collected license revenue:** auditable and aligned to cash collection; requires a trusted billing/collection signal.
3. **Percentage of gross margin:** aligns incentives to margin but requires reliable cost data.
4. **Product/partner-specific schedule:** flexible, but needs versioned contracts and more administration.

### Recommended controls, regardless of model

- Use an append-only ledger of accruals, adjustments, reversals, approvals, and reconciliation references.
- Never edit a posted financial entry; correct it with a linked reversal/adjustment.
- Exclude taxes and separately identify discounts/refunds only after the calculation basis is approved.
- Require internal review before a statement is finalized.
- Keep payouts manual until reconciliation and legal/tax requirements are established.

The rate, eligible products, earning event, refund/cancellation treatment, currency, rounding, withholding/tax responsibility, statement period, dispute window, and approvers all remain undecided.

## 5. Billing, orders, and renewals

### Proposed boundary

- SMRITISYS tracks commercial orders, licensed products, renewal dates, approval status, and an external billing reference.
- Retail OS or the designated accounting/billing provider remains the system of record for invoices, payments, refunds, accounting, and tax.
- Do not issue invoices or mark payments collected from a portal-only event.
- Provisioning and entitlement changes should follow confirmed order/payment events from the approved system of record.

Before implementation, select the billing/payment source, define the source event and reconciliation method, and identify whether Retail OS or another system owns subscription status.

## 6. Follow-up queues and service targets

The local implementation has a paginated, read-only queue containing open/in-progress support tickets, submitted/in-review partner deals, and unexpired customer/partner invitations, plus a manually managed internal task list. Staff may set an optional owner, due date, and task status. The system does not infer a deadline, enforce an SLA, or send email, SMS, or other outbound messages.

### Approved timing baseline

| Work item | Approved target | Escalation |
|---|---|---|
| New support ticket | First human response within 1 business day | Not approved |
| Open support ticket awaiting company action | Post an internal status update every 3 business days | Not approved |
| Submitted partner deal | Internal review within 2 business days | Not approved |
| Customer/partner invitation | Remind the assigned internal owner after 2 business days; retain the existing invitation expiry policy | No automated recipient message |

The timing values and internal-only invitation reminder were approved on 2026-11-22. Define the business-day calendar, time zone, holidays, pause states, ownership, and exception rules before calculating or enforcing deadlines. No customer/partner outbound reminders are approved.

## 7. Reporting definitions

Potential initial metrics:

- Registered opportunities by state, age, partner, and attribution role.
- Conversion rate, measured using a defined registration cohort and conversion event.
- Active partner-linked customers and renewal status.
- Support response/resolve times using approved business-hour rules.
- Commission accruals and reversals only after the financial model is approved.

Metric definitions, access scope, and reporting periods need approval. Partner dashboards must not disclose other partners' performance or customer records.

## 8. Operational safeguards

- Narrow the Cloudflare token to the minimum required services/actions and use separate deployment credentials where available. Do not change credentials without a separately approved account operation.
- Retain D1 Time Travel as a recovery control and document the pre-migration bookmark. A production restore is destructive; perform any restore exercise only against an isolated copy or after explicit production approval.
- Add an isolated restore/recovery exercise, migration preflight, and post-migration schema verification to the release checklist.
- Do not apply future migrations, seed partner data, deploy, or enable outbound notifications under this draft.

## Approval checklist

- [ ] Confirm partner categories, organization/contact model, and agreement/certification statuses.
- [x] Set the deal-protection duration to 90 days from internal approval.
- [ ] Define deal eligibility, attribution, conflict handling, expiry consequences, and extension criteria.
- [ ] Approve the price-book owner, currency, discounts, and approval thresholds.
- [ ] Select the commission model and all earning/reversal/settlement rules.
- [ ] Confirm the billing/payment source of truth and reconciliation event.
- [x] Approve the follow-up target timings and internal-only invitation reminder.
- [ ] Define the business calendar, time zone, holidays, pause states, ownership, and escalation rules.
- [ ] Approve metric definitions and partner visibility.
- [ ] Approve a safe recovery exercise and Cloudflare credential-scope changes separately.
- [ ] Provide the production partner roster before any partner records are created.
