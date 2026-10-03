---
name: Whop trial entitlements
description: AfuCloud subscription verification for Whop memberships that are trialing before a charge exists.
---

Whop can report a valid `trialing` membership before a corresponding paid payment record exists. A missing payment row does not mean the customer is on Free when a matching benefit-eligible membership exists.

Resolve memberships server-side using the expected Whop account, AfuCloud product, configured plan, eligible status, and either an exact match to server-authored `metadata.afucloud_user_id` or an exact match to the checkout configuration ID already stored for that authenticated user. Allow the checkout-ID fallback only when membership metadata is absent; reject conflicting metadata. Fetch the membership by ID and verify it again before saving the mapping. Never grant access from a redirect or client-provided identifier.

**Why:** Trial memberships may not have payment records, and some membership responses can omit copied checkout metadata. The locally saved checkout ID is still a server-authored binding and safely recovers those memberships without trusting browser input.

**How to apply:** Keep Whop as the access authority, require account/product/plan/status checks, and only use persisted server-side ownership links when resolving trials. Paid access statuses include `trialing`.