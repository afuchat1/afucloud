---
name: Whop trial entitlements
description: AfuCloud subscription verification for Whop memberships that are trialing before a charge exists.
---

Whop can report a valid `trialing` membership before a corresponding paid payment record exists. A missing payment row does not mean the customer is on Free when a matching benefit-eligible membership exists.

**Why:** A customer’s membership may be created before the stored checkout configuration and may not yet have a charge. Payment-only reconciliation left valid trial members pending and applied Free limits.

**How to apply:** Resolve memberships server-side using the expected Whop account, AfuCloud product, configured plan, eligible status, and an exact match to server-authored `metadata.afucloud_user_id`. Fetch the membership by ID and verify it again before saving the local mapping. Never grant access from a redirect or client-provided identifier.