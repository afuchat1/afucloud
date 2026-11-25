type JsonObject = Record<string, unknown>;

export type RegistrarField = {
  name: string;
  label: string;
  description: string | null;
  type: "string" | "number" | "integer" | "boolean";
  required: boolean;
  options: Array<string | number | boolean> | null;
  format: string | null;
  minLength: number | null;
  maxLength: number | null;
};

export type RegistrationRequirements = {
  supported: boolean;
  reason: string | null;
  extension: string;
  allowedYears: number[];
  fields: RegistrarField[];
  contactExtensionsSchema: JsonObject | null;
};

const isObject = (value: unknown): value is JsonObject =>
  !!value && typeof value === "object" && !Array.isArray(value);

function positiveInteger(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function supportedTerm(value: unknown): number | null {
  const years = positiveInteger(value);
  return years !== null && years <= 10 ? years : null;
}

function yearsFromSchema(schema: unknown, extension: string): number[] | null {
  if (!isObject(schema)) {
    // Cloudflare documents .ai as requiring at least two years. For other
    // extensions its documented default is one year.
    return [extension === "ai" ? 2 : 1];
  }

  if (Array.isArray(schema.enum)) {
    const values = [...new Set(schema.enum.map(supportedTerm).filter((value): value is number => value !== null))];
    return values.length === schema.enum.length ? values.sort((a, b) => a - b) : null;
  }

  if (schema.const !== undefined && supportedTerm(schema.const) === null) return null;
  const constant = supportedTerm(schema.const);
  if (constant !== null) return [constant];

  if (schema.minimum !== undefined && supportedTerm(schema.minimum) === null) return null;
  if (schema.maximum !== undefined && supportedTerm(schema.maximum) === null) return null;
  const minimum = supportedTerm(schema.minimum) ?? 1;
  const maximum = supportedTerm(schema.maximum);
  if (maximum === null) {
    const defaultValue = supportedTerm(schema.default);
    return defaultValue !== null ? [defaultValue] : [minimum];
  }
  if (maximum < minimum || maximum - minimum > 9) return null;
  return Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index);
}

function fieldType(schema: JsonObject): RegistrarField["type"] | null {
  if (schema.type === "string" || schema.type === "number" || schema.type === "integer" || schema.type === "boolean") {
    return schema.type;
  }
  if (Array.isArray(schema.enum) && schema.enum.every(value => typeof value === "string")) return "string";
  return null;
}

function humanize(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, first => first.toUpperCase());
}

export function registrationRequirements(
  extension: string,
  registrationSchema: unknown,
): RegistrationRequirements {
  if (!isObject(registrationSchema) || !isObject(registrationSchema.properties)) {
    return {
      supported: false,
      reason: "Cloudflare did not return usable registration requirements for this extension.",
      extension,
      allowedYears: [],
      fields: [],
      contactExtensionsSchema: null,
    };
  }

  const properties = registrationSchema.properties;
  const years = yearsFromSchema(properties.years, extension);
  if (!years?.length) {
    return {
      supported: false,
      reason: "AfuCloud could not confirm a supported registration term for this extension.",
      extension,
      allowedYears: [],
      fields: [],
      contactExtensionsSchema: null,
    };
  }

  const contactSchema = properties.contact_extensions;
  if (contactSchema === undefined) {
    return {
      supported: true,
      reason: null,
      extension,
      allowedYears: years,
      fields: [],
      contactExtensionsSchema: null,
    };
  }
  if (!isObject(contactSchema) || !isObject(contactSchema.properties)) {
    return {
      supported: false,
      reason: "AfuCloud cannot safely collect the registry-specific fields required for this extension yet.",
      extension,
      allowedYears: years,
      fields: [],
      contactExtensionsSchema: null,
    };
  }

  const required = new Set(Array.isArray(contactSchema.required)
    ? contactSchema.required.filter((key): key is string => typeof key === "string")
    : []);
  const contactProperties = contactSchema.properties;
  const entries = Object.entries(contactProperties);
  if (entries.length > 20 || [...required].some(key => !(key in contactProperties))) {
    return {
      supported: false,
      reason: "AfuCloud cannot safely collect the registry-specific fields required for this extension yet.",
      extension,
      allowedYears: years,
      fields: [],
      contactExtensionsSchema: null,
    };
  }

  const fields: RegistrarField[] = [];
  for (const [name, rawSchema] of entries) {
    if (!isObject(rawSchema)) {
      return {
        supported: false,
        reason: "AfuCloud cannot safely collect the registry-specific fields required for this extension yet.",
        extension,
        allowedYears: years,
        fields: [],
        contactExtensionsSchema: null,
      };
    }
    const type = fieldType(rawSchema);
    const options = Array.isArray(rawSchema.enum) &&
      rawSchema.enum.length <= 30 &&
      rawSchema.enum.every(value => ["string", "number", "boolean"].includes(typeof value))
      ? rawSchema.enum as Array<string | number | boolean>
      : null;
    if (!type || (Array.isArray(rawSchema.enum) && !options)) {
      return {
        supported: false,
        reason: "AfuCloud cannot safely collect the registry-specific fields required for this extension yet.",
        extension,
        allowedYears: years,
        fields: [],
        contactExtensionsSchema: null,
      };
    }
    fields.push({
      name,
      label: typeof rawSchema.title === "string" ? rawSchema.title : humanize(name),
      description: typeof rawSchema.description === "string" ? rawSchema.description : null,
      type,
      required: required.has(name),
      options,
      format: typeof rawSchema.format === "string" ? rawSchema.format : null,
      minLength: positiveInteger(rawSchema.minLength),
      maxLength: positiveInteger(rawSchema.maxLength),
    });
  }

  return {
    supported: true,
    reason: null,
    extension,
    allowedYears: years,
    fields,
    contactExtensionsSchema: contactSchema,
  };
}

function validSchemaValue(schema: JsonObject, value: unknown): boolean {
  const type = fieldType(schema);
  if (type === "string") {
    if (typeof value !== "string") return false;
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return false;
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value)) return false;
      } catch {
        return false;
      }
    }
  } else if (type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
  } else if (type === "integer") {
    if (!Number.isInteger(value)) return false;
    if (typeof schema.minimum === "number" && Number(value) < schema.minimum) return false;
    if (typeof schema.maximum === "number" && Number(value) > schema.maximum) return false;
  } else if (type === "boolean") {
    if (typeof value !== "boolean") return false;
  } else {
    return false;
  }
  return !Array.isArray(schema.enum) || schema.enum.includes(value);
}

export function validateContactExtensions(
  schema: JsonObject | null,
  rawValue: unknown,
): { valid: boolean; values: JsonObject; error: string | null } {
  const values = isObject(rawValue) ? rawValue : {};
  if (!schema) {
    return Object.keys(values).length === 0
      ? { valid: true, values: {}, error: null }
      : { valid: false, values: {}, error: "This extension does not accept registry-specific contact fields." };
  }

  const properties = isObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];
  if (Object.keys(values).some(key => !(key in properties))) {
    return { valid: false, values: {}, error: "Remove fields that Cloudflare does not require for this extension." };
  }
  for (const key of required) {
    if (!(key in values) || values[key] === "" || values[key] === null || values[key] === undefined) {
      return { valid: false, values: {}, error: `Complete the required ${humanize(key)} field.` };
    }
  }
  for (const [key, value] of Object.entries(values)) {
    const fieldSchema = properties[key];
    if (!isObject(fieldSchema) || !validSchemaValue(fieldSchema, value)) {
      return { valid: false, values: {}, error: `Enter a valid value for ${humanize(key)}.` };
    }
  }
  return { valid: true, values, error: null };
}

export function quoteForRegistrationYears(
  registrationCost: number,
  renewalCost: number,
  years: number,
  markupPercent: number,
): { registrarCost: number; renewalRegistrarCost: number; retailPrice: number; renewalRetailPrice: number } {
  if (![registrationCost, renewalCost, markupPercent].every(value => Number.isFinite(value) && value >= 0) ||
    !Number.isInteger(years) || years < 1) {
    throw new Error("Invalid registration quote values.");
  }
  const totalRegistrarCost = Math.round((registrationCost + renewalCost * (years - 1)) * 100) / 100;
  return {
    registrarCost: totalRegistrarCost,
    renewalRegistrarCost: Math.round(renewalCost * 100) / 100,
    retailPrice: Math.round(totalRegistrarCost * (1 + markupPercent / 100) * 100) / 100,
    renewalRetailPrice: Math.round(renewalCost * (1 + markupPercent / 100) * 100) / 100,
  };
}
