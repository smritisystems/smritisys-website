# SMRITISYS Architecture

## Product boundary

SMRITISYS is the business and control plane. It owns identity, organizations, customer and partner relationships, licensing, support, releases, commercial workflows, governance, and audit history.

SMRITI Retail OS is the operational product. It owns POS, billing, inventory, purchase, sales, CRM, accounting, barcode, GST, reports, and day-to-day business operations.

SMRITISYS must never become a second Retail OS. The portal may show license and release information about Retail OS, but operational accounting belongs in the Retail OS application.

## Experiences on smritisys.com

### Public corporate website

- Home
- About
- Products
- SMRITI Retail OS
- Solutions
- Industries
- Technology
- Partners
- Resources
- Contact
- Login

The public site explains the company and product relationship. It does not expose internal ERP screens.

### Customer Portal

- Dashboard
- My Organization
- My Products
- Licenses and entitlements
- Support Center
- Custom Requirements
- Release and Update Center
- Announcements and service status
- Billing relationship and orders

### Partner Portal

- Dashboard
- Partner organization and profile
- Customers and leads
- Opportunities
- Quotes and orders
- Licenses and renewals
- Commissions
- Support and resources
- Training

Partner type is policy-driven: channel partner, reseller, implementation partner, technology partner, referral partner, or distributor.

### Internal Control Plane

Only authorized SMRITISYS staff access this area:

- Organizations and people
- Customers and partners
- Products, licenses, and entitlements
- Support, SLAs, and escalations
- Custom requirements
- Releases and downloads
- Orders, billing, and commissions
- Announcements and knowledge base
- Audit logs and configuration

## Identity model

A person is not limited to one relationship. Customer and partner memberships use one customer-account sign-in; a person can select among the active organizations and workspaces assigned to that account.

```text
Account -> Organization membership -> Workspace type -> Role -> Entitlements
```

Partner category (such as reseller, referral partner, or distributor) describes the business relationship; `partner_admin` and `partner_member` determine access within that relationship. Workspace choices come from server-authorized active memberships, and every API request remains scoped to the selected organization and permissions.

The shared Customer/Partner sign-in does not merge separate legacy customer and staff accounts. Staff/Admin sign-in remains on the restricted Admin entry point until those identities are explicitly linked and stronger authentication is in place. Never merge accounts solely because their email strings match.

## Routing convention

- `/` public corporate website
- `/login.html` common Customer/Partner sign-in and workspace chooser
- `/portal.html` customer workspace entry point; redirects to common sign-in when needed
- `/partner.html` partner workspace entry point; redirects to common sign-in when needed
- `/admin.html` internal control-plane entry point
- `https://app.smritisys.com` SMRITI Retail OS operational application

The current repository can host the public site and control-plane experiences together. Retail OS remains a separate deployment and application.
