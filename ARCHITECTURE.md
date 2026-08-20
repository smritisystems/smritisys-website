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

A person is not limited to one relationship. A person belongs to an organization and receives access through relationships and roles.

```text
Person -> Organization membership -> Relationship -> Role -> Entitlements
```

The same person can be a customer administrator, a partner contact, and an internal contact in different authorized relationships. APIs must always scope data by organization and relationship.

## Routing convention

- `/` public corporate website
- `/portal.html` customer portal entry point
- `/partner.html` partner portal entry point
- `/admin.html` internal control-plane entry point
- `https://app.smritisys.com` SMRITI Retail OS operational application

The current repository can host the public site and control-plane experiences together. Retail OS remains a separate deployment and application.
