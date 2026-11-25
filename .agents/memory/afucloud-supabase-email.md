---
name: AfuCloud Supabase email
description: Supabase Auth email branding and SMTP requirements for AfuCloud.
---

Configure a custom SMTP provider before applying branded Supabase Auth email templates. The current Supabase project rejects custom templates while it uses the default email provider.

**Why:** Supabase's default mailer is restricted and does not support custom templates for this project tier.

**How to apply:** Configure SMTP with a verified sender domain first, then update the confirmation subject and HTML template. Keep confirmation redirects on `https://cloud.afuchat.com`.
