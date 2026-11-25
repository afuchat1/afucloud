# AfuCloud Roadmap

> **Current product focus: Domains.** Hosting and application deployment are intentionally deferred.
>
> Last updated: 25 November 2026

AfuCloud is being built as a branded infrastructure platform. This roadmap separates the active domain product from future hosting products so implementation stays focused.

## Product status at a glance

| Product area | Status | Scope |
|---|---|---|
| Domain registration and resale | **Current focus** | Search, pricing, checkout, registrar registration and renewals |
| Domain management | **Current focus** | One dashboard for AfuCloud-purchased and externally registered domains |
| AfuCloud DNS | **Current focus** | Branded nameservers, authoritative DNS and DNS record management |
| Existing-domain connection | **Current focus** | Delegate externally registered domains to AfuCloud nameservers |
| Hosting and deployments | **Roadmap — deferred** | GitHub-connected application deployment and hosting infrastructure |
| Hosting SSL automation | **Roadmap — deferred** | HTTPS certificates for applications hosted by AfuCloud |

---

## 1. Current focus — Domain platform

### Phase 1: Domain sales and registration

- [ ] Domain search and availability checks.
- [ ] Clear registration and renewal pricing before checkout.
- [ ] Collect and validate registrant contact information.
- [ ] Review order details before payment.
- [ ] Confirm payment before submitting a registration request.
- [ ] Integrate a registrar API for registration and renewal.
- [ ] Track registration lifecycle: pending, processing, registered, failed and manual review.
- [ ] Show a domain as owned/active only after the registrar confirms successful registration.
- [ ] Store and protect the customer's domain ownership and contact details appropriately.
- [ ] Support manual customer-initiated renewals; no automatic renewal by default.
- [ ] Send transactional confirmations and renewal reminders.

### Phase 2: Domain management

- [ ] Build one Domain Management area for all customer domains.
- [ ] Clearly distinguish domains purchased through AfuCloud from domains connected from other registrars.
- [ ] Show registrar, registration status, expiry date and renewal eligibility when reliable data is available.
- [ ] Provide supported registrar actions only where the registrar integration permits them.
- [ ] Keep DNS management unavailable until a purchased domain is registered or an external domain's delegation is verified.
- [ ] Provide clear domain status and actionable error messages.

### Phase 3: AfuCloud nameservers and authoritative DNS

- [ ] Design and operate AfuCloud authoritative DNS for customer zones.
- [ ] Provision DNS zones and nameserver assignments.
- [ ] Implement DNS record management (A, AAAA, CNAME, MX, TXT, NS, CAA, SRV and other supported types).
- [ ] Support DNS changes, validation, propagation visibility and audit history.
- [ ] Establish resilient authoritative DNS service and monitoring.
- [ ] Configure nameserver host records/glue at the relevant registry or registrar where required.
- [ ] Verify that branded nameservers are operational before exposing them to customers.

**Nameserver naming must be resolved before implementation:** the current product discussion referenced `ns1.afuchat.com`, while existing repository notes reference `dns1.afuchat.com` and `dns2.afuchat.com`. Do not assume either set is deployed or change production delegation until the final pair, IP addresses, glue records and redundancy have been verified.

### Phase 4: Connect domains from other registrars

- [ ] Let customers add a domain they already own.
- [ ] Create and prepare the DNS zone before asking the customer to change nameservers.
- [ ] Detect and display the assigned AfuCloud nameservers.
- [ ] Guide the customer to update nameservers at their current registrar.
- [ ] Verify authoritative nameserver delegation through DNS checks.
- [ ] Activate DNS management only after delegation is confirmed.
- [ ] Where possible, inspect/import existing DNS records before cutover to reduce website and email downtime.
- [ ] Explain that connecting DNS does not transfer registrar ownership or give AfuCloud control over renewals at the original registrar.

### Phase 5: Reliability, security and operations

- [ ] Securely store registrar credentials and API secrets.
- [ ] Protect registrant personal information and restrict staff/service access.
- [ ] Add idempotent registration and renewal processing to prevent duplicate operations.
- [ ] Add retry handling, failure recovery, alerts and an operational audit trail.
- [ ] Monitor nameserver health, DNS resolution and zone consistency.
- [ ] Document registrar outages, failed payments, failed registrations and domain dispute/escalation procedures.
- [ ] Verify provider pricing, API permissions, settlement terms and per-domain costs before launch.

---

## 2. Deferred roadmap — Hosting and application deployment

**Not part of the current domain implementation.** Do not expand the domain work into hosting or deployment features.

- [ ] GitHub-connected projects and repository selection.
- [ ] Automatic framework and build detection.
- [ ] Build and deploy application workloads.
- [ ] Deployment previews and deployment history.
- [ ] Free project subdomains.
- [ ] Custom domains attached to hosted projects.
- [ ] Hosting infrastructure, resource limits, logs and monitoring.
- [ ] Hosting-specific SSL/TLS issuance, installation and automatic renewal.
- [ ] HTTPS enforcement for hosted applications.

### SSL/TLS boundary

A domain registration does not itself provide an HTTPS certificate. SSL/TLS for a website must be handled by the server, hosting platform or proxy that terminates the visitor's HTTPS connection. AfuCloud may later automate certificates for applications it hosts, but that work belongs to the deferred hosting roadmap—not the current domain sales and DNS scope.

---

## 3. Product principles

1. **AfuCloud is the customer-facing product.** Provider integrations remain behind the AfuCloud experience.
2. **No false success states.** A payment is not a registration; only registrar confirmation establishes successful registration.
3. **Separate registrar and DNS responsibilities.** DNS delegation does not transfer domain registration or renewal control.
4. **Prepare before cutover.** Provision zones and preserve existing DNS records before changing nameservers wherever possible.
5. **Cost-conscious infrastructure.** Prefer free/open standards and usage-based services where practical, but verify provider charges, limits, registrar fees and operational costs. Do not promise zero cost where a provider charges per operation or domain.
6. **Upgrade existing foundations.** Audit and extend the current schema, payment flow, registrar integration and DNS code rather than rebuilding working components without a reason.
7. **Keep scope disciplined.** Complete and validate the domain platform before starting hosting and deployment work.

## 4. Immediate implementation order

1. Audit the existing domain checkout, registration-order lifecycle, registrar integration and domain-management UI/API.
2. Confirm registrar API capabilities, pricing, renewal support and registrant-contact handling.
3. Resolve the final AfuCloud nameserver hostnames and authoritative DNS architecture.
4. Implement DNS zone provisioning and nameserver delegation verification.
5. Complete the unified Domain Management experience for purchased and externally connected domains.
6. Test registration, renewal, delegation, DNS changes, failure recovery and customer notifications end to end.

> **Current milestone:** Build a reliable domain registration, management and DNS platform. Hosting, deployments and hosting SSL remain future work.
