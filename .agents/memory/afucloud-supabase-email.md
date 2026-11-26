---
name: AfuCloud Supabase email
description: Supabase Auth email branding and SMTP requirements for AfuCloud.
---

Supabase Auth uses Resend SMTP for AfuCloud confirmation mail, with `no-reply@afuchat.com` as the sender and `AfuCloud` as the sender name. Confirmation templates must use the AfuCloud green brand and link to `https://cloud.afuchat.com/auth/confirm#token_hash={{ .TokenHash }}`. The browser sends the hash to the AfuCloud API Worker, which verifies it server-side; do not use `{{ .ConfirmationURL }}` in user-facing email.

**Why:** Supabase's confirmation URL exposes the Supabase project host to email recipients. The app-owned link keeps the user on AfuCloud while Supabase remains behind the API Worker. Supabase's default mailer rejected custom templates for this project tier, so Resend SMTP is required.

**How to apply:** Keep Supabase SMTP configured; if delivery fails, inspect Resend's sending DNS records separately from receiving or tracking records. Keep email links and confirmation redirects on `https://cloud.afuchat.com`.
