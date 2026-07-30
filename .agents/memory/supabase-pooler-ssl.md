---
name: Supabase pooler SSL config for Replit
description: How to connect Replit apps to Supabase without SSL cert errors
---

# Supabase Pooler + SSL on Replit

## The Rule
Use session pooler (`aws-0-<region>.pooler.supabase.com:5432`) not direct hostname (`db.<project>.supabase.co`). Strip `?sslmode=require` from the URL.

**Why:** pg treats `sslmode=require` as `verify-full` in newer versions, failing on Supabase's cert chain. Code passes `ssl: { rejectUnauthorized: false }` in Pool options — that's enough.

**How to apply:**
```
postgresql://postgres.<project-id>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```
No `?sslmode=` suffix. Pool config: `ssl: { rejectUnauthorized: false }`.
