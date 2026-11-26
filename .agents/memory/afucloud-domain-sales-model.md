---
name: AfuCloud domain sales model
description: User's commercial and platform direction for domain sales and DNS
---

For AfuCloud's domain feature, build the customer-facing product flow rather than relying on Cloudflare's domain platform. Call a registrar API to register domains; the customer pays AfuCloud the full retail amount, AfuCloud keeps its cut, and the remainder is paid to the provider. The intended branded nameservers are `dns1.afuchat.com` and `dns2.afuchat.com`.

The user chose AfuCloud-operated authoritative DNS rather than provider-managed DNS for customer zones.

The domain registration flow must collect and validate legal registrant details before showing or creating checkout; choosing a search result opens the form and must not start checkout.

Cloudflare Registrar's public API currently supports registration and status checks but not renewals (confirmed 2026-11-26). Do not expose manual or automatic renewal checkout until provider support or an alternate registrar path is verified.

**Why:** The user stated this model for AfuCloud.

**How to apply:** Keep the registrar integration and customer payment under AfuCloud's control. Collect and validate legal registrant details before creating hosted checkout. Confirm the provider's actual settlement model before implementing a payment split. Operate customer authoritative DNS behind the branded nameservers; treat DNS hosting as separate from registration and third-party TXT/CNAME verification. Recheck Cloudflare's renewal API before designing renewal behavior.
