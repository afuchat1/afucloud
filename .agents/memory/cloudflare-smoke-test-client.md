---
name: Cloudflare smoke-test client
description: Client behavior when checking AfuCloud's Cloudflare Worker endpoints
---

For read-only production smoke checks against AfuCloud's Cloudflare API, requests using Python urllib's default `Python-urllib` User-Agent returned 403, while requests with an explicit curl-like User-Agent reached the Worker and returned its expected application statuses.

**Why:** Cloudflare's edge rules can reject a scripted client's default User-Agent, making a healthy API look unavailable.

**How to apply:** Set an explicit curl-like User-Agent in scripted diagnostics and confirm a representative response with `curl` before interpreting a batch of 403s as application failures.
