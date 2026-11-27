import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeRegistrant,
  quoteForRegistrationYears,
  registrationRequirements,
  validateContactExtensions,
} from "../artifacts/cf-worker/src/lib/domain-registrar.ts";
import {
  buildDomainSearchResults,
  domainSearchCandidateNames,
  parseDomainSearchInput,
} from "../artifacts/cf-worker/src/lib/domain-search.ts";

const readProjectFile = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("uses only the registration terms published by the extension schema", () => {
  const requirements = registrationRequirements("com", {
    properties: {
      years: { type: "integer", enum: [1, 2, 5] },
      contact_extensions: {
        type: "object",
        required: ["entity_type"],
        properties: {
          entity_type: { type: "string", enum: ["person", "company"] },
        },
      },
    },
  });

  assert.equal(requirements.supported, true);
  assert.deepEqual(requirements.allowedYears, [1, 2, 5]);
  assert.deepEqual(requirements.fields.map(field => [field.name, field.required]), [["entity_type", true]]);
});

test("applies Cloudflare's documented minimum term when no term schema is returned", () => {
  assert.deepEqual(registrationRequirements("ai", { properties: {} }).allowedYears, [2]);
  assert.deepEqual(registrationRequirements("com", { properties: {} }).allowedYears, [1]);
});

test("limits term choices to the registrar's numeric constraints", () => {
  assert.deepEqual(
    registrationRequirements("test", {
      properties: { years: { type: "integer", minimum: 2, maximum: 10, multipleOf: 2 } },
    }).allowedYears,
    [2, 4, 6, 8, 10],
  );
});

test("blocks registration when extension requirements cannot be represented safely", () => {
  const requirements = registrationRequirements("test", {
    properties: {
      contact_extensions: {
        type: "object",
        properties: { nested: { type: "object", properties: { code: { type: "string" } } } },
      },
    },
  });
  assert.equal(requirements.supported, false);
  assert.match(requirements.reason, /cannot safely collect/i);
});

test("validates required and enumerated registry contact fields", () => {
  const schema = {
    type: "object",
    required: ["entity_type"],
    properties: { entity_type: { type: "string", enum: ["person", "company"] } },
  };
  assert.equal(validateContactExtensions(schema, {}).valid, false);
  assert.equal(validateContactExtensions(schema, { entity_type: "other" }).valid, false);
  assert.equal(validateContactExtensions(schema, { entity_type: "company" }).valid, true);
});

test("enforces numeric registry contact constraints", () => {
  const schema = {
    type: "object",
    required: ["employees"],
    properties: { employees: { type: "integer", minimum: 2, maximum: 10, multipleOf: 2 } },
  };
  assert.equal(validateContactExtensions(schema, { employees: 4 }).valid, true);
  assert.equal(validateContactExtensions(schema, { employees: 3 }).valid, false);
  assert.equal(validateContactExtensions(schema, { employees: 12 }).valid, false);
});

test("accepts international phone calling codes including Uganda's +256", () => {
  const registrant = {
    email: "buyer@example.com",
    phone: "+256.700000000",
    name: "Alex Example",
    organization: "",
    street: "555 Example Street",
    city: "Kampala",
    state: "",
    postalCode: "00000",
    countryCode: "ug",
  };
  assert.deepEqual(normalizeRegistrant(registrant), { ...registrant, countryCode: "UG" });
  assert.equal(normalizeRegistrant({ ...registrant, phone: "+256700000000" }), null);
});

test("quotes a multi-year term from live registration and renewal costs", () => {
  assert.deepEqual(quoteForRegistrationYears(10, 12, 3, 20), {
    registrarCost: 34,
    renewalRegistrarCost: 12,
    retailPrice: 40.8,
    renewalRetailPrice: 14.4,
  });
});

test("parses exact domains and preserves the requested keyword", () => {
  assert.deepEqual(parseDomainSearchInput(" Example.com "), {
    keyword: "example",
    exactDomain: "example.com",
  });
  assert.deepEqual(parseDomainSearchInput("my-brand.net"), {
    keyword: "my-brand",
    exactDomain: "my-brand.net",
  });
  assert.deepEqual(parseDomainSearchInput("my-brand"), {
    keyword: "my-brand",
    exactDomain: null,
  });
  assert.equal(parseDomainSearchInput("example.com/path"), null);
});

test("keeps only extensions that use the searched keyword", () => {
  assert.deepEqual(
    domainSearchCandidateNames("example", [
      { domain_name: "example.com" },
      { domain_name: "example.net" },
      { domain_name: "example-news.com" },
      { domain_name: "other.com" },
    ], "example.com"),
    ["example.com", "example.net"],
  );
});

test("includes purchased exact domains as taken even when Cloudflare omits them", () => {
  const results = buildDomainSearchResults({
    keyword: "example",
    suggestions: [{ domain_name: "example.net" }],
    quotes: [{
      domainName: "example.net",
      registrable: true,
      tier: "standard",
      reason: null,
      currency: "USD",
      markupPercent: 20,
      registrarCost: 10,
      renewalRegistrarCost: 12,
      retailPrice: 12,
      renewalRetailPrice: 14.4,
    }],
    exactDomain: "example.com",
    activeOrders: [{ hostname: "example.com", status: "registered" }],
    markupPercent: 20,
  });

  assert.deepEqual(results.map(result => [result.domainName, result.availabilityStatus]), [
    ["example.com", "taken"],
    ["example.net", "available"],
  ]);
  assert.equal(results[0].available, false);
});

test("marks stale suggestions unknown when authoritative availability checks fail", () => {
  const [result] = buildDomainSearchResults({
    keyword: "example",
    suggestions: [{ domain_name: "example.net", registrable: true }],
    quotes: [],
    exactDomain: "example.com",
    activeOrders: [],
    markupPercent: 20,
    availabilityCheckFailed: true,
  });

  assert.equal(result.domainName, "example.com");
  assert.equal(result.availabilityStatus, "unknown");
  assert.equal(result.available, false);
});

test("authoritative domain checks override cached search suggestions", () => {
  const [result] = buildDomainSearchResults({
    keyword: "example",
    suggestions: [{ domain_name: "example.com", registrable: true }],
    quotes: [{
      domainName: "example.com",
      registrable: false,
      tier: "standard",
      reason: null,
      currency: "USD",
      markupPercent: 20,
      registrarCost: 10,
      renewalRegistrarCost: 12,
      retailPrice: 12,
      renewalRetailPrice: 14.4,
    }],
    exactDomain: "example.com",
    activeOrders: [],
    markupPercent: 20,
  });

  assert.equal(result.availabilityStatus, "taken");
  assert.equal(result.available, false);
});

test("keeps public landing prices aligned with the enforced billing catalog", () => {
  const billing = readProjectFile("../artifacts/cf-worker/src/lib/billing.ts");
  const landing = readProjectFile("../artifacts/afucloud/src/screens/landing.tsx");

  assert.match(billing, /free:[\s\S]*?monthlyPriceUsd:\s*0/);
  assert.match(billing, /pro:[\s\S]*?monthlyPriceUsd:\s*12/);
  assert.match(billing, /business:[\s\S]*?monthlyPriceUsd:\s*39/);
  assert.match(landing, /name: 'Free',\s*price: '\$0',\s*period: 'forever'/);
  assert.match(landing, /name: 'Pro',\s*price: '\$12',\s*period: '\/month'/);
  assert.match(landing, /name: 'Business',\s*price: '\$39',\s*period: '\/month'/);
});
