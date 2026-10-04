---
name: Afu ecosystem isolation
description: User-provided requirements for AfuCloud infrastructure and shared Afu services.
---

The user-provided Afu ecosystem rules require one shared API domain, CDN domain, account system, and database, while each product keeps its own Worker, schema, R2 bucket, routes, secrets, configuration, deployment, and observability. AfuCloud data belongs in `afucloud.*`; shared identity remains in the ecosystem account system. The shared CDN should use a product path such as `/cloud/*`, and API routes should identify their product, such as `/afucloud/*`.

Before infrastructure changes, identify the resource owner, consumers, dependencies, data, routes, bindings, and production impact. Preserve existing API and asset URL behavior during migration. Do not alter shared or other-product resources, or decommission unknown resources, without owner coordination, validation, backups, rollback, and required authorization.

**Why:** the user supplied these as mandatory Afu ecosystem development and infrastructure rules.

**How to apply:** scope this workspace's infrastructure work to AfuCloud. Inventory live Cloudflare and database resources before migrating routes, buckets, bindings, or deployments. Stop and coordinate if shared-resource ownership, consumers, or production impact is uncertain.