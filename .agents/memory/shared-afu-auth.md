---
name: Shared Afu authentication
description: Cross-product Supabase Auth and profile conventions
---

# Shared Afu authentication

Supabase `auth.users` is the only identity and credential source across Afu products. `accounts.profiles.user_id` links shared profile data to the Auth UUID. Product schemas such as `afucloud` reference `auth.users(id)` directly.

**Why:** Product-specific user tables and password columns caused accounts and ownership records to diverge across AfuChat, AfuMail, AfuAI, AfuCloud, and AfuAds.

**How to apply:** Add new domain tables under the product schema, use `user_id uuid references auth.users(id)`, and read shared display data from `accounts.profiles` by `user_id`. Do not add product credential tables or use `accounts.profiles.id` as the Auth identity.

Profile provisioning must be idempotent. Resolve insert conflicts by the same Auth UUID. A profile with no `user_id` may be claimed only after Auth confirms the exact email and by conditional update; never reassign a profile linked to a different UUID.

**Why:** Supabase Auth may create the shared profile through its database trigger before an app's profile-repair path runs. Treating that duplicate as a fatal login error caused confirmed users to receive HTTP 500.

**How to apply:** After a duplicate insert conflict, look up the profile by `user_id`. If Auth has verified the email, a profile with `user_id IS NULL` may be linked only after matching its exact email and conditionally updating while it remains unlinked. Keep profiles owned by another Auth UUID as errors.