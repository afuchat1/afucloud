---
name: Local API token signing
description: How development authentication behaves without a persisted JWT secret
---

# Local API token signing

Development derives a stable, app-specific JWT signing key from `SESSION_SECRET` when `JWT_SECRET` is absent. Production still requires an explicit `JWT_SECRET`.

**Why:** API workflow restarts must not invalidate local access tokens, without adding another long-lived Replit secret.

**How to apply:** Use this only for local development. Keep production signing keys explicit and separate from `SESSION_SECRET`.