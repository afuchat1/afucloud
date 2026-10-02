---
name: AfuCloud Cloudflare runtime
description: Preferred Cloudflare runtime for the AfuCloud Next.js frontend
---

AfuCloud's Next.js frontend is deployed as a Cloudflare Worker using OpenNext at `cloud.afuchat.com`; the canonical API remains a separate `afucloud-api` Worker at `api.afuchat.com`. Pages is not the target unless the frontend is migrated to a static SPA.

**Why:** Cloudflare Pages' configured `dist` directory did not match Next.js server output, and the user chose Workers to preserve server-rendered Next.js routes. The user confirmed `cloud.afuchat.com` as the frontend hostname.

**How to apply:** Keep `cloud.afuchat.com` routed to the frontend Worker and `api.afuchat.com` routed to the API Worker; deploy them separately when their respective code changes.