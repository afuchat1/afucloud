---
name: AfuCloud domain sales model
description: User's commercial and platform direction for domain sales and DNS
---

Keep AfuCloud domain registration on Cloudflare Registrar, checkout on Whop, and DNS on the existing customer-authorized Cloudflare connection. Do not replace the registrar, payment provider, DNS provider, or nameserver architecture unless the user asks again.

Cloudflare's domain-search endpoint returns incomplete suggestions, not an authoritative availability list. Include the exact searched domain, verify candidate extensions with the live domain-check endpoint, and merge active AfuCloud orders so purchased domains display as taken. Preserve the searched keyword and show real extensions only.

Selecting an available result opens a dedicated registration page. Collect and validate legal registrant details before creating checkout.

Cloudflare Registrar's public API currently supports registration and status checks but not renewals (confirmed 2026-11-26). Do not expose manual or automatic renewal checkout until provider support or an alternate registrar path is verified.

**Why:** The user explicitly redirected the domain feature to the current Cloudflare implementation and asked not to change its infrastructure.

**How to apply:** Fix search, registration, and DNS workflows within the existing Cloudflare and Whop services. Never treat cached search suggestions as proof of availability. Cloudflare Registrar's public API currently supports registration and status checks but not renewals (confirmed 2026-11-26); do not expose manual or automatic renewal checkout until provider support is verified.
