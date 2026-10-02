---
name: AfuCloud subscription tiers
description: The current implementation defaults for AfuCloud monthly pricing and account quotas.
---

The current billing implementation uses Free ($0/month), Pro ($12/month), and Business ($39/month). Resource caps are:

| Tier | Projects | Storage containers | API keys | Maximum file |
| --- | ---: | ---: | ---: | ---: |
| Free | 2 | 2 | 3 | 10 MB |
| Pro | 10 | 25 | 50 | 100 MB |
| Business | 50 | 100 | 250 | 250 MB |

These are implementation defaults, not separately user-approved prices.

**Why:** The user delegated plan design and enforceable limits to the agent. Keeping the chosen values in one durable reference reduces accidental inconsistency between billing, quota enforcement, and user-facing copy.

**How to apply:** When changing an AfuCloud plan, update the Worker entitlement catalog, Settings UI, and public landing-page pricing together, then review the enforced account limits before release.