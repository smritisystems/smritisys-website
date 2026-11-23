# Portal capability boundary

This matrix describes surfaces present in the repository. It is not a deployment entitlement or a promise that a workflow is enabled for every organization.

| Surface | Confirmed in the current UI | Boundary |
|---|---|---|
| Customer portal | Organization and account views, product and license visibility, support tickets, custom requirements, release center, and service announcements | Customer-facing service and relationship workspace; license and organization data remain scoped by the authenticated session. |
| Partner / Channel portal | Partner profile, linked customer onboarding, deal registration for internal review, permission-gated allocated inventory, read-only customer license visibility, and eligible product releases | Channel partners, resellers, distributors, and other partner types use the partner workspace. Deal submission does not promise deal protection, pricing, commission, or approval. |
| Distributor public page | Marketing examples for wholesale orders, credit context, B2B returns, purchase planning, and distribution movement | These are potential product workflows and remain deployment/edition dependent unless separately verified for the customer rollout. |
| Distributor authenticated workspace | No distinct distributor-only order, credit, dispatch, or network-management portal is evidenced in the current UI | A distributor is represented as a partner type and uses the Partner portal. Do not describe the public marketing page as an authenticated distributor console. |
| Admin control plane | Internal user and organization administration, partner deal and follow-up review, product/license operations, releases, support, announcements, audit, and security views | Internal administration only; it is not a customer or partner workspace. |

Keep the public distributor page's illustrative and deployment-dependent wording. Propose a separate distributor workspace only after its users, permissions, operational workflows, and product availability are approved.

## Code references

- [Customer portal](../portal.html)
- [Partner portal](../partner.html)
- [Admin control plane](../admin.html)
- [Distributor public page](../distributor.html)
- [Partner capability labels and permission checks](../js/partner.js)
