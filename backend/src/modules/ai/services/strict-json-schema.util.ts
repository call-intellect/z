export function toOpenAiStrictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => toOpenAiStrictSchema(item));
  }
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const node = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && value && typeof value === 'object') {
      const props = value as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const [propKey, propValue] of Object.entries(props)) {
        next[propKey] = toOpenAiStrictSchema(propValue);
      }
      out[key] = next;
    } else if ((key === '$defs' || key === 'definitions') && value && typeof value === 'object') {
      const defs = value as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const [defKey, defValue] of Object.entries(defs)) {
        next[defKey] = toOpenAiStrictSchema(defValue);
      }
      out[key] = next;
    } else if ((key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(value)) {
      out[key] = value.map((item) => toOpenAiStrictSchema(item));
    } else if (
      (key === 'items' || key === 'additionalItems' || key === 'not') &&
      value &&
      typeof value === 'object'
    ) {
      out[key] = toOpenAiStrictSchema(value);
    } else {
      out[key] = value;
    }
  }

  const typeField = out['type'];
  const isObjectNode =
    typeField === 'object' ||
    (Array.isArray(typeField) && typeField.includes('object')) ||
    'properties' in out;

  if (isObjectNode) {
    const props = (out['properties'] as Record<string, unknown> | undefined) ?? {};
    out['properties'] = props;
    out['additionalProperties'] = false;
    out['required'] = Object.keys(props);
  }

  return out;
}
