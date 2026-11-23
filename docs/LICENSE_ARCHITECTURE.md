---
title: "Signed License Control Plane Architecture"
module: "01_ARCHITECTURE"
category: "SECURITY-DESIGN"
document_type: "SPECIFICATION"
product: "PrathamOne EduOS"
edition: "Coaching Institute Edition"
version: "1.0.0"
doc_version: "2.2"
created_date: "2026-11-14"
updated_date: "2026-11-15"
author: "Jawahar R Mallah"
organization: "AITDL — AI Technology & Development Lab"
status: "In Progress"
tags: ["licensing", "Ed25519", "activation", "entitlements", "security", "D1", "monitoring", "channel-partners"]
entities: ["License", "Activation", "LicenseReactivationRequest", "Entitlement", "LicenseEvent", "LicenseCode", "Organization", "CustomerInvite", "CustomerPasswordReset", "PartnerCustomerLink", "D1StorageSnapshot"]
api_routes: ["/api/license/activate", "/api/license/reactivations", "/api/license/reactivations/:request_id", "/api/admin/license-reactivations", "/api/admin/license-reactivations/:request_id", "/api/licenses", "/api/licenses/batches", "/api/licenses/batches/:batch_id/codes", "/api/licenses/batches/:batch_id/codes/:serial_number/reveal", "/api/licenses/batches/:batch_id/codes/:serial_number/restore", "/api/licenses/batches/:batch_id/issue", "/api/admin/customers", "/api/admin/customers/:id", "/api/admin/customers/:id/password-reset", "/api/admin/license-registrations", "/api/admin/license-registrations/:id", "/api/password-reset/complete", "/api/partner/customers", "/api/partner/customers/:id/contact", "/api/partner/inventory", "/api/partner/codes/:batch_id/:serial_number/reveal", "/api/products", "/api/admin/d1-operations"]
related_modules: ["12_RBAC_SECURITY", "13_SYSADMIN_SETTINGS", "16_DATABASE_API"]
---

# License Control Plane

Phase 3 establishes SMRITISYS as the authority for product editions, licenses, entitlements, activations, and license history. SMRITI Retail OS remains the authority for POS, sales, purchases, inventory, accounting, GST transactions, and operational reports.

The current approved implementation scope is the SMRITISYS website and PrathamOne EduOS. No SMRITI Retail OS integration or deployment is included.

## Reused model

The existing `products` table remains the product catalog. Its `slug` is the stable product code. The existing `licenses` table remains the legacy-compatible license record and continues to own `customer_id`, `product_id`, `license_key`, validity dates, and status.

Organizations are not accepted from the browser as ownership proof. License ownership is derived through the Phase 2 `organization_members` relationship for the license customer.

`product_editions` adds editions without duplicating products. `license_editions` associates one edition with an existing license.

## Domain tables

- `products`: product catalog; `slug` is the product code.
- `product_editions`: product-specific edition catalog.
- `licenses`: legacy-compatible license authority.
- `license_code_inventory`: serial/key inventory; stores SHA-256 activation-key hashes, AES-GCM ciphertext for protected per-code reveal, and claim bindings, never plaintext activation keys. Delivery status and recipient metadata are separate from activation lifecycle status.
- `license_editions`: edition assignment for a license.
- `license_entitlements`: extensible key/value records such as `users`, `branches`, `devices`, `modules`, `industry_pack`, and `support_level`.
- `license_activations`: installation and activation identifiers, an installation refresh public key, and limited operational metadata.
- `license_reactivation_requests`: authenticated customer requests, installation identity, administrator phone-confirmation and decision audit fields, cooldown exceptions, notification state, and request expiry.
- `license_refresh_nonces`: short-lived, single-use refresh nonces used to reject replayed signed requests.
- `license_events`: append-only license history.
- `audit_logs`: security/governance audit records, separate from business event history.

## Status transitions

```text
DRAFT            -> ACTIVE, CANCELLED
ACTIVE           -> SUSPENDED, PENDING_RENEWAL, EXPIRED, CANCELLED
SUSPENDED        -> ACTIVE, CANCELLED
PENDING_RENEWAL  -> ACTIVE, EXPIRED
EXPIRED          -> ACTIVE (explicit renewal)
CANCELLED        -> terminal
```

The API does not accept arbitrary status changes through `PATCH`. Status changes use explicit action routes. Expiry is calculated from status and dates when a license is read; viewing a license does not mutate its stored status.

## Authorization

Customers receive `license.view` only. Product and license mutations require the appropriate Phase 3 permissions:

- `license.create`
- `license.update`
- `license.suspend`
- `license.activate`
- `license.renew`
- `license.manage_entitlements`

The server derives the authenticated person, organization membership, and role from the session. A customer query is constrained to that membership's organization. Administrative queries require the permission but are not constrained to the internal administrator organization.

Direct customer license issuance is restricted to super admins. It creates the canonical customer, inactive portal account, organization, and active customer membership within the same D1 batch as the license, edition, entitlements, license event, and audit records. The inactive customer account has a random undisclosed password hash and cannot be used for portal sign-in; the customer receives only the activation credentials. Existing-organization issuance continues to use `license.create`.

## Activation and idempotency

Activation requires an installation ID, activation identifier, and an exact non-empty `company.binding` text entitlement. An unbound or mismatched company is rejected before signing. Entitlement keys must be unique within a license. The pair `(license_id, activation_identifier)` is unique. Repeating an activation updates `last_seen_at` and does not create duplicate activation or history rows.

## Customer account reactivation

The customer signs in to the existing PrathamOne customer account with its email and password; the reactivation endpoints do not issue or reveal passwords and do not use OTPs. The account must already be active and have a working password (activation-only accounts created by direct issuance must first complete the existing customer setup/reset workflow). License ownership is derived from the signed-in customer account, never from a customer ID supplied as proof by the client.

`GET /api/license/reactivations` returns only that customer's active, in-date licenses with a product and non-empty `company.binding`. `POST /api/license/reactivations` binds the request to a server-validated license, company, installation ID, activation ID, and installation-generated Ed25519 refresh public key. If a seat is available and the 30-day transfer cooldown is inactive, the request is approved automatically. Otherwise it remains pending; no active installation is revoked automatically. Pending requests generate an email notice to the registered address, but email is a notification, not an approval factor.

The super-admin queue shows the registered contact details and currently active installations. Approval requires an explicit confirmation that support called the registered phone, an audit reason, and—when all seats are occupied—the active installation to release. The API checks that replacement belongs to the same license, applies the existing 30-day self-service transfer cooldown unless a super admin explicitly records an override, and leaves the license's own status `ACTIVE`. Rejection and approval are audited; email delivery failures are returned and stored rather than silently treated as success. Customer requests expire after 24 hours. An approved request is consumed when the normal signed artifact is issued; retries return the same artifact rather than creating duplicate activations. `GET /api/license/reactivations/:request_id` exposes only the authenticated customer's request status and completed artifact.

The website license server exposes this API and admin queue. The desktop product must call these endpoints after customer sign-in and import the returned installation-bound signed artifact; that client integration is separate from this website repository.

Client sequence: authenticate against the existing `/api/login` endpoint over TLS; call `GET /api/license/reactivations` with the customer session; create a durable installation ID, activation ID, and refresh-key pair inside the product; then submit those values with the selected `license_id` to `POST /api/license/reactivations`. For an automatically approved request, call `POST /api/license/activate` with `{ "reactivation_request_id": "..." }`. For a pending request, poll the customer-owned status endpoint and retry activation after approval. Verify and import the returned artifact using the product's existing Ed25519 verification path. The private refresh key must remain on the installation; neither customer passwords nor private keys belong in these reactivation requests.

Existing licenses without a company binding require an authorized customer-to-product mapping before their next activation; the system does not invent a binding during migration. New batch codes are generated unassigned, linked to one product/edition and commercial term, and have a default one-seat limit. On first claim, the customer supplies the institution name, contact name, email and phone; address and tax ID are optional. The licensing authority reuses the canonical customer only when the contact email and organization match, otherwise it rejects conflicting identity data.

Claiming creates the customer, organization membership, license, edition, entitlements, audit event and code-to-installation binding transactionally. A code can be retried only by the same installation, activation identifier and company binding. Generated keys are returned in the batch-creation response and encrypted at rest for protected reveal. Legacy hash-only keys are not derivable; a super admin may restore one only by supplying the original key for its existing serial, which must match the stored SHA-256 hash. The batch API returns aggregate inventory status without key hashes.

DRAFT license keys are not returned to customer list responses, and the authority rejects DRAFT activation before artifact signing. PrathamOne also treats DRAFT, suspended, or cancelled signed states as non-active, including perpetual and one-time models.

## Signed artifact boundary

- The Pages API builds the versioned license payload and calls the `LICENSE_SIGNER` service binding. The private signing key must remain inside that isolated signer boundary; the web application and products contain only public verification keys.
- Artifacts are Ed25519-signed, installation- and company-bound snapshots. The product verifies signature, key ID, product, company, installation, status, model, date bounds, and entitlements before applying its server-side policy.
- Each activation registers an installation-generated Ed25519 refresh public key. The matching private key remains encrypted at rest in PrathamOne using its application `SECRET_KEY`; it is never sent to SMRITISYS. The product signs a short-lived request containing the product, company binding, installation, activation, timestamp, and one-time nonce.
- `POST /api/license/refresh` verifies the installation signature, enforces timestamp and nonce replay protection, checks the current license and activation status, and returns a newly signed artifact. It uses the same artifact builder as initial activation and does not require the reusable license key.
- PrathamOne checks status hourly while the application is in use and contacts the authority only when the last signed snapshot is at least 24 hours old. Failed attempts are throttled to once per hour. Batch-code licenses carry a signed 90-day offline-validity window; legacy and directly issued licenses retain the seven-day default. After the signed window, the product applies its existing Evaluation Mode policy, including for perpetual licenses. A suspension or revocation is reflected on the next successful check-in, not pushed immediately.
- Activations created before refresh-key support must be manually reactivated once with the issued license key to register their installation public key.
- Configure a concrete signer backed by the selected protected KMS/HSM before enabling real issuance. No vendor or key has been selected, and no signing infrastructure is provisioned by this source change.
- Offline activation uses a PrathamOne-generated request file containing the serial number, registration details, installation IDs and public refresh key, but no activation key or private key. The customer uploads the request and enters the activation key on `/offline-activation.html`, downloads the signed response, and imports it into the same installation. The authority still performs the claim online; only the product installation can import the resulting artifact because it is signed and bound to that installation.

## Channel partner sales governance

SMRITISYS remains the licensing and customer-identity authority. Partner organizations are the existing `organizations` records with an authorized partner type; customer organizations and customer accounts continue to use their existing canonical records. Partner operations add attribution and access, not duplicate customer or license masters.

Partner customer onboarding reuses `customer_invites`. A partner-created invitation records `invited_by_partner_organization_id`; accepting it creates or reuses the normal customer account and organization membership, then records the partner/customer relationship in `partner_customer_links`. The customer organization remains a company customer. A revoked relationship is not silently reactivated by invitation acceptance or license claiming.

Customer email and phone are required for new customer registration through signup, customer invitations, partner invitations, and direct license issuance. Invitations retain the submitted phone until acceptance. Customer profile updates require a phone; existing records are not backfilled with invented values, and pending legacy invitations without a phone must be reissued. Existing known phone numbers are preserved when an account is linked or converted.

The super-admin customer directory searches canonical customer ID, name, email, phone, company, and linked organization. Customer IDs and login emails are displayed as immutable identifiers; account passwords are never returned or recoverable. Super admins may update the existing `customers` contact name/phone, `customer_profiles` GST number, website, bio, and timezone fields, and add or update existing `customer_addresses` records. Address IDs are verified against the selected customer; address deletion is not exposed by this workflow. Organization memberships, organization records, and partner assignments are shown from their canonical tables rather than copied into the customer profile. Profile changes update the canonical `people` display name where present and are audited.

Password recovery uses the `customer_password_resets` transaction table. A super admin may create one pending, cryptographically random reset token for an active/trial customer; older pending links are revoked, the new link expires after 30 minutes, and only its SHA-256 token hash is stored. The customer submits the token and a new password once. Completion consumes the token, replaces the password hash, invalidates all customer sessions, and writes an audit event. The plaintext link is returned only at creation and must be shared securely; the existing password is never disclosed.

Partners with `partner.customer.update_contact` may read contact name and phone only for customers whose active organization membership is linked to that partner. They may update only those two fields. Email, password, customer ID, company ownership, profile attributes, addresses, partner assignments, and licenses remain inaccessible or immutable through partner APIs. Every partner contact update is checked against the current active relationship server-side and audited.

Partner details extend the canonical `organizations` record. The admin onboarding workspace captures legal name, address, city, state/province, postal code, country, organization phone, tax ID, and website; these fields are optional and blank values do not erase existing data. The city/state/country describe the organization's address, not its sales or service territory. Territory assignment remains a separate future relationship if business requirements call for it.

The super-admin Organizations workspace lists partner type, active/inactive status, contacts, linked-customer totals, pending invitations, and allocated/claimed code counts. Administrators can change the partner classification, deactivate/reactivate the partner organization, change a contact's partner role, and deactivate/reactivate individual contacts. These are audited, reversible status changes; they preserve customer links, inventory, and history. Partner organizations use the existing `organizations.status` values (`active`/`inactive`), which gate partner sessions without deleting partner memberships or customer relationships. A partner must retain at least one active `partner_admin`.

Company administrators may allocate codes to an eligible partner during batch issuance. The existing `license_code_inventory` row records `assigned_partner_organization_id`, assignment time, and assigning person. Partner inventory reads are filtered server-side to that partner ID and do not return activation keys. A `partner_admin` with `partner.inventory.reveal` may reveal one assigned, unclaimed key after password confirmation; reveals are rate-limited and audited against the partner organization. `partner_member` can register customers and view assigned inventory, but cannot reveal keys. Company administrators retain authority over license generation, initial code allocation, customer links, suspension, revocation, and customer/partner relationship changes.

`0026_partner_sales_governance.sql` adds the partner attribution columns, indexes, and narrowly scoped permissions. `0027_customer_contact_and_partner_details.sql` adds phone fields to pending invitations, organization phone/country fields, and safely carries known phones into existing-customer invitations. It does not create duplicate customer or partner master tables. The production D1 workflow later reported migration `0031` as the pending migration and applied it successfully on 2026-11-22, so the earlier migration files were already recorded as applied at that point. Recheck the migration ledger before future operations. Transfer/reassignment of already allocated code inventory is not part of this change; company administrators must allocate codes when issuing a batch.

## Internal administrator workspace

The authenticated super-admin workspace can issue licenses for active organizations and product editions, generate batches of 1-200 unassigned activation-code pairs, review batch counts without retrieving keys, record per-serial delivery and recipient details, configure edition Evaluation Mode/grace/rollout policy, inspect entitlements, activations, signed-artifact metadata, and lifecycle events, renew or suspend licenses, and revoke activations. Batch codes use nine-digit numeric serials and 16-character uppercase alphanumeric activation keys. Delivery status (`not_issued` or `issued`) is independent of activation status. Manually marking codes issued requires available codes and records the actor, recipient, channel, reference, timestamp, and an audit event. A successful activation also marks a code issued, recording the registration contact and the `activation` channel. A batch can be revoked only while none of its codes are claimed or being claimed; revocations are audited.

The customer profile workspace links licenses by the canonical `licenses.customer_id`. Super admins can review each customer's serial, product/edition, status, validity period, activation counts, and per-license activity without creating duplicate license records. Inspecting a license reuses the existing registration, activation, artifact, entitlement, and lifecycle-event APIs; access remains super-admin-only and registration-detail reads are audited. “Manage all licenses” opens the existing license workspace with an exact customer-ID filter, where the normal renew/suspend/revoke controls remain available. Customer-specific filters are validated server-side and included in pagination and summary counts.

`POST /api/licenses` returns a stable `SMR-LIC-########` serial number and the direct-issue key once. `POST /api/licenses/batches` returns generated serial/key pairs once and requires `LICENSE_CODE_ENCRYPTION_KEY`, a base64-encoded 32-byte secret. Batch keys retain their SHA-256 verification hash and an AES-256-GCM ciphertext bound to the batch and serial; generation fails if protected storage is not configured. `GET /api/licenses/batches/:batch_id/codes` returns serials, activation lifecycle status, delivery metadata, and recoverability status without key hashes or ciphertext. `POST /api/licenses/batches/:batch_id/codes/:serial_number/reveal` permits one available code at a time after a super-admin password check, applies a rate limit, and writes an audit event without the key. `POST /api/licenses/batches/:batch_id/codes/:serial_number/restore` accepts a supplied legacy key only for an available, unclaimed record with no ciphertext; after a super-admin password check and rate limit, it verifies the key against the existing hash, encrypts it with the original batch and serial as authenticated data, and atomically stores it with a redacted audit event. It does not create a new inventory row or change the code status. Claimed, revoked, mismatched, or already-protected codes cannot be restored; the endpoint never returns the supplied key. Bulk reveal is not supported. Keep the encryption secret stable: replacing it without re-encrypting stored values makes those values unrecoverable. `POST /api/licenses/batches/:batch_id/issue` marks a selected set of available, unissued serials as issued atomically and records the recipient and audit event. `POST /api/licenses/batches/:batch_id/revoke` revokes all unclaimed codes in one batch and records an audit event. The admin workspace offers a CSV download from the current response and clears the in-memory key list on sign-out. License creation and customer registration are audited without including activation keys. Existing-organization issuance remains available.

Partner APIs include `GET|POST /api/partner/customers`, scoped `PATCH /api/partner/customers/:id/contact`, `GET /api/partner/inventory`, and password-confirmed `POST /api/partner/codes/:batch_id/:serial_number/reveal`. Admin APIs include `GET /api/admin/customers`, `GET|PATCH /api/admin/customers/:id`, `POST /api/admin/customers/:id/password-reset`, `POST /api/password-reset/complete`, `GET|POST /api/admin/partners`, `PATCH /api/admin/partners/:partner_id`, `POST /api/admin/partners/:partner_id/members`, `PATCH /api/admin/partners/:partner_id/members/:membership_id`, and partner invitation/customer-link administration. The admin partner workspace includes partner/customer links and partner allocation when issuing codes. All partner/customer and inventory access is checked on the server against current organization membership and permission records.

Private signing material and signed artifact payload/signature bytes are not rendered in the workspace.

## API

- `GET /api/products`
- `POST /api/products` (admin permission)
- `GET /api/products/:id`
- `GET /api/products/:id/editions`
- `POST /api/products/:id/editions` (admin permission)
- `GET /api/licenses`
- `POST /api/licenses` (license creation permission for an existing organization; super admin for direct customer registration)
- `GET /api/licenses/batches` (super admin; summary only)
- `POST /api/licenses/batches` (super admin; returns key pairs once)
- `GET /api/licenses/batches/:batch_id/codes` (super admin; serials and delivery metadata only)
- `POST /api/licenses/batches/:batch_id/codes/:serial_number/restore` (super admin; restore a matching existing legacy key)
- `POST /api/licenses/batches/:batch_id/issue` (super admin; mark available codes issued and audit delivery details)
- `GET /api/licenses/:id`
- `PATCH /api/licenses/:id` (metadata only)
- `GET /api/licenses/:id/entitlements`
- `POST /api/licenses/:id/entitlements` (admin permission)
- `GET /api/licenses/:id/activations`
- `GET /api/licenses/:id/events`
- `POST /api/licenses/:id/activate`
- `POST /api/licenses/:id/suspend`
- `POST /api/licenses/:id/renew`
- `POST /api/licenses/:id/activations/:activationId/revoke`
- `GET|PUT /api/products/:productId/editions/:editionId/evaluation-policy`
- `POST /api/license/activate` (signed product activation)
- `GET /api/license/reactivations` (customer's eligible licenses; sign-in required)
- `POST /api/license/reactivations` (request reactivation; sign-in required)
- `GET /api/license/reactivations/:request_id` (customer-owned status and completed artifact)
- `GET /api/admin/license-reactivations` (super-admin pending queue)
- `GET|POST /api/admin/license-reactivations/:request_id` (review; approval requires phone confirmation)
- `POST /api/license/refresh` (installation-key-authenticated snapshot refresh)
- `POST /api/v1/license/offline-request` (authorized PrathamOne admin; creates the request file)
- `POST /api/v1/license/offline-import` (authorized PrathamOne admin; verifies and imports a signed response)
- `GET /api/admin/d1-operations` (super admin; read-only storage snapshots and recovery status)

Every privileged mutation writes both a license event where applicable and a security audit event.

## D1 capacity monitoring

The current production control plane is connected to one D1 database, `smritisys-db`. The daily Cron-triggered operations Worker samples that database's `meta.size_after` and stores telemetry in its `d1_storage_snapshots` table. The dashboard presents Free/Paid capacity comparisons; growth projections are withheld until there are at least two daily samples. No `smritisys-db-recovery` database is currently visible in the account inventory.

Cloudflare D1 Time Travel provides automatic point-in-time recovery for production-storage databases, with a documented 30-day recovery window. The production database returned bookmarks for a current point and for 2026-10-24 when checked on 2026-11-22. No restore was performed. The portal reports this Cloudflare-managed recovery separately from manual backups: manual exports/backups are not configured, and the portal does not list recovery points or perform restores. See [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

The account plan is not assumed. The dashboard compares both Free and Paid limits, with visual warnings at 75% and 90%. The trend is based on daily snapshots rather than extrapolating from a single size measurement. Sampling runs at 02:00 UTC and currently reads the single `smritisys-db` binding.

The D1 operations endpoint is read-only. The monitoring table and sampler are present in production; the sampler writes capacity snapshots, not backups. Cloudflare Time Travel recovery was verified by bookmark lookup, but a restore drill remains outstanding. No R2 bucket or export token is required for Time Travel.

## Validation and remaining work

The control-plane tests cover company-binding rejection, signed-artifact verification, direct activation-only customer registration, one-time batch generation, hash and ciphertext storage, password-confirmed single-code reveal, hash-verified restoration of legacy keys, restoration authorization and duplicate rejection, audit redaction, claim idempotency, installation binding, registration reuse, partner customer and inventory isolation, partner role permissions, D1 dashboard authorization, and the existing staging contracts. The PrathamOne tests cover signed response verification and the per-artifact offline-validity boundary. A public verification key endpoint has responded successfully, but the repository does not establish the production signer's operator, key lifecycle, or recovery runbook; verify these with the authorized operator. Before expanding production license use, complete end-to-end testing against an isolated signer and D1 target, product-specific entitlement review, code-revocation procedures, signed release verification, and customer migration/recovery rehearsal. The production D1 workflow applied migration `0031` on 2026-11-22 after reporting it as pending; earlier migration files were already recorded as applied at that point. Recheck the migration ledger before future operations. The D1 monitoring sampler is deployed against `smritisys-db`; it records capacity telemetry, not backups. Cloudflare Time Travel is platform-managed, and no isolated restore drill has been performed.
