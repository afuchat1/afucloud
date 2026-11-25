---
name: AfuCloud domain sales model
description: User's commercial and platform direction for domain sales and DNS
---

For AfuCloud's domain feature, build the customer-facing product flow rather than relying on Cloudflare's domain platform. Call a registrar API to register domains; the customer pays AfuCloud the full retail amount, AfuCloud keeps its cut, and the remainder is paid to the provider. The intended branded nameservers are `dns1.afuchat.com` and `dns2.afuchat.com`.

**Why:** The user stated this model for AfuCloud.

**How to apply:** Keep the registrar integration and customer payment under AfuCloud's control. Confirm the provider's actual settlement model before implementing a payment split, and treat branded authoritative DNS as a separate service from registration and third-party TXT/CNAME verification.
