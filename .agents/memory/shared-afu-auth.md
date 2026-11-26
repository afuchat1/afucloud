---
name: Shared Afu authentication
description: Cross-product Supabase Auth and profile conventions
---

# Shared Afu authentication

Supabase `auth.users` is the only identity and credential source across Afu products. `accounts.profiles.user_id` links shared profile data to the Auth UUID. Product schemas such as `afucloud` reference `auth.users(id)` directly.

**Why:** Product-specific user tables and password columns caused accounts and ownership records to diverge across AfuChat, AfuMail, AfuAI, AfuCloud, and AfuAds.

**How to apply:** Add new domain tables under the product schema, use `user_id uuid references auth.users(id)`, and read shared display data from `accounts.profiles` by `user_id`. Do not add product credential tables or use `accounts.profiles.id` as the Auth identity.

Profile provisioning must be idempotent. Resolve insert conflicts by the same Auth UUID. A profile with no `user_id` may be claimed only after Auth confirms the exact email and by conditional update; never reassign a profile linked to a different UUID.

Some deployed `accounts.profiles` schemas also enforce a foreign key on `id`; profile creation must set both `id` and `user_id` to the authenticated Auth UUID.

**Why:** The production database checked on 2026-11-27 had no `auth.users` profile-creation trigger. A confirmed account existed without a shared profile even though a correctly keyed profile insert succeeded.

**How to apply:** Verify `accounts.profiles` after signup or confirmation instead of assuming Auth created it. Check live triggers before relying on them, and do not add a shared Auth/profile trigger without reviewing its impact on other Afu products.

**Why:** The live Supabase schema rejected generated profile IDs with SQLSTATE `23503`; matching the Auth UUID satisfies legacy identity constraints without changing the database.

**How to apply:** Always pass the Auth UUID as `accounts.profiles.id` and `user_id` when the Worker provisions a new shared profile.