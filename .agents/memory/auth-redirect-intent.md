---
name: AfuCloud auth redirect intent
description: Keep normal login, protected-route return, and paid-plan checkout destinations distinct
---

Only attach `returnTo` when redirecting an unauthenticated visitor from a protected page. Paid-plan links carry a validated `plan` intent through login or registration and continue to that plan's checkout choices. A normal login with no explicit intent must go to `/dashboard`; never save every visited route as the post-login destination.

**Why:** Recording every route also recorded the public landing page, so users who signed in normally could be sent back to the landing page instead of their dashboard.

**How to apply:** Keep return destinations same-origin and reject public/auth routes. Preserve a selected paid plan through both sign-in and sign-up; without a paid-plan intent or protected-page return, default to the dashboard.