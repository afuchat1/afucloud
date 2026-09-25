---
name: Live Supabase schema and staging
description: Connected production catalog facts that affect multi-product work and isolated staging
---

# Live Supabase schema and staging

The connected Supabase project contains a much broader multi-product catalog than the local Drizzle schema index. Live inventory found 201 tables in `afuchat`, 23 in `afuai`, 11 in `afucloud`, shared `accounts` and `auth` schemas, and multiple additional domain schemas. Product-related entities are not always in a schema named after the product.

**Why:** The local schema index only represents AfuCloud plus shared auth/profile tables, so it is not a reliable inventory for cross-product dashboard work.

**How to apply:** Inspect the live catalog and product API contracts before adding product navigation, routes, or generic data management. Do not infer table coverage from local Drizzle exports.

The connected Supabase project had no recorded migrations and no development branches when inspected on 2026-09-25. Supabase branches apply tracked migrations and do not copy production data, so creating a branch from this state would not reproduce the populated product schema.

**Why:** A blank staging database could make Worker/frontend testing misleading or nonfunctional.

**How to apply:** Do not create a staging branch until a schema-only baseline is versioned and validated, or an existing isolated staging project is identified. Keep staging data isolated; never seed it by copying production user records.

Supabase's security advisor reported RLS disabled on all 11 `afucloud` tables: `refresh_tokens`, `projects`, `images`, `api_keys`, `personal_tokens`, `webhooks`, `activity_logs`, `domains`, `hostnames`, `storage_containers`, and `storage_objects`.

**Why:** Enabling RLS without policies can block access paths, while leaving it disabled exposes these tables to Supabase `anon` and `authenticated` roles.

**How to apply:** Surface this risk and design table-specific policies and Worker/service-role behavior before changing RLS. Never apply blanket `ENABLE ROW LEVEL SECURITY` as an automatic fix.