import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  quoteForRegistrationYears,
  registrationRequirements,
  validateContactExtensions,
} from "../artifacts/cf-worker/src/lib/domain-registrar.ts";

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

test("quotes a multi-year term from live registration and renewal costs", () => {
  assert.deepEqual(quoteForRegistrationYears(10, 12, 3, 20), {
    registrarCost: 34,
    renewalRegistrarCost: 12,
    retailPrice: 40.8,
    renewalRetailPrice: 14.4,
  });
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
