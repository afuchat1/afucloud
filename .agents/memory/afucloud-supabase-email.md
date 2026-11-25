---
name: AfuCloud Supabase email
description: Supabase Auth email branding and SMTP requirements for AfuCloud.
---

Supabase Auth uses Resend SMTP for AfuCloud confirmation mail, with `no-reply@afuchat.com` as the sender and `AfuCloud` as the sender name. The confirmation template uses the AfuCloud green brand and Supabase's `{{ .ConfirmationURL }}` variable.

**Why:** Supabase's default mailer rejected custom templates for this project tier. The AfuCloud domain had verified DKIM and SPF sending records, while separate receiving/tracking records remained incomplete.

**How to apply:** Keep Supabase SMTP configured before changing the template; if delivery fails, inspect Resend's sending DNS records separately from receiving or tracking records. Keep confirmation redirects on `https://cloud.afuchat.com`.
