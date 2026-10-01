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

## Region endpoint quirk

Some Supabase projects require a different numbered pooler endpoint than `aws-0` and reject an unqualified user. For the AfuCloud target in `eu-west-1`, the working combination is the `aws-1-eu-west-1.pooler.supabase.com` endpoint with the project-qualified user `postgres.<project-id>`.

**Why:** The pooler may return misleading tenant/user errors when the numbered endpoint or username format is wrong, even when the project is healthy.

**How to apply:** If the documented `aws-0` endpoint fails, resolve the region-specific pooler endpoint and test the qualified user without printing credentials before changing application configuration.

A successful session-pooler connection with the project-qualified login can report `current_user = 'postgres'`, rather than the qualified login string.

**Why:** The pooler maps its tenant-qualified login to the underlying PostgreSQL role, so strict string equality against `SUPABASE_DB_USER` can falsely reject the correct production connection.

**How to apply:** Validate the configured project ref, pooler host, qualified login, and expected database; compare `current_user` with the mapped database role, not the login string.
