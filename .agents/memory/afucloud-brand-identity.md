---
name: AfuCloud brand identity
description: User-specified AfuCloud logo, platform brand color, and ownership statement.
---

AfuCloud's platform brand color is `#07965B`. The user-provided green cloud/upload SVG is the canonical logo; preserve its geometry and colors when reusing it. The user states AfuCloud owns these brand assets and wants that shown on a public branding page.

**Why:** the user requested consistent branding across AfuCloud, a public ownership notice, and its Cloudflare OAuth consent experience.

**How to apply:** Use the same SVG for product marks and hosted brand assets. Keep the ownership copy limited to the user's claim; do not invent trademark registration details. Cloudflare consent branding is configured on the OAuth client with a publicly reachable HTTPS logo URL, so verify that URL serves the new asset before changing `logo_uri`.