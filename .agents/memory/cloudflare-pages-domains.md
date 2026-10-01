---
name: Cloudflare Pages custom domains
description: Provisioning order and verification for custom domains on Pages
---

For a Cloudflare-managed subdomain, deploy the Pages project, associate the hostname with that Pages project, and then ensure its DNS CNAME points to `<project>.pages.dev`. Check for an existing DNS record before creating or changing it. Confirm the Pages domain validation is active and the custom URL serves the app; an HTTP 522 can occur when a CNAME points to Pages before the hostname is associated.

**Why:** Pages must know which project owns the hostname before Cloudflare's edge can route requests to the project. A valid CNAME alone does not establish that mapping.

**How to apply:** Use the Pages custom-domain setup for the project's hostname first; then create or confirm the DNS record and wait for hostname validation/certificate provisioning before declaring the custom URL ready.