---
name: Supabase Auth REST responses
description: Response-shape behavior in AfuCloud's direct Supabase Auth REST integration.
---

Supabase Auth's raw signup response may be the user object at the top level instead of an SDK-normalized `{ user }` wrapper. Accept both top-level and nested response shapes when handling signup, sign-in, and confirmation.

**Why:** The REST request can create the account and send its confirmation email before a client that assumes `{ user }` rejects the response, producing a false signup failure.

**How to apply:** Normalize Auth REST responses before interpreting success, and keep provider details out of user-facing errors.
