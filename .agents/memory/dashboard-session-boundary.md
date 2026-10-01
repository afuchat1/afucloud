---
name: AfuCloud dashboard session boundary
description: Security boundary between browser dashboard sessions and developer API credentials
---

# AfuCloud dashboard session boundary

Dashboard browser sign-in uses an HttpOnly cookie session with a double-submit CSRF token. Developer APIs use bearer personal access tokens or project keys; a dashboard session JWT must never be accepted as a developer bearer token. Personal tokens with `account:*` can manage the account's projects, while project keys are limited to their own project. Keep dashboard login/session operations out of the developer OpenAPI contract and generated client.

Dashboard login remains reachable over HTTP for browser sign-in. Credentialed CORS and CSRF protect browser-origin use; they do not make the route inaccessible to arbitrary HTTP clients. Allow only the dashboard's actual origins, and add external frontend origins to `DASHBOARD_ALLOWED_ORIGINS`.

**Why:** Reusing one bearer credential for both dashboard sessions and developer APIs makes it difficult to enforce different lifetimes, CSRF protections, and project scopes.

**How to apply:** Preserve this separation in both the Express API and Cloudflare Worker. Test that dashboard JWTs fail as bearer credentials, account tokens can manage account projects, and project keys cannot cross project boundaries.