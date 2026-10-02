---
name: AfuCloud Cloudflare runtime
description: Preferred Cloudflare runtime for the AfuCloud Next.js frontend
---

AfuCloud's Next.js frontend is deployed as a Cloudflare Worker using OpenNext; the canonical API remains a separate `afucloud-api` Worker. Pages is not the target unless the frontend is migrated to a static SPA.

**Why:** Cloudflare Pages' configured `dist` directory did not match Next.js server output, and the user chose Workers to preserve server-rendered Next.js routes.

**How to apply:** Keep the frontend Worker and API Worker deployments separate; use OpenNext for the Next.js app and deploy the API Worker when its handlers change.