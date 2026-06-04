/**
 * Приведение JSON Schema к требованиям OpenAI strict structured outputs.
 *
 * OpenAI (Responses API `text.format.json_schema` и Chat `response_format`)
 * при `strict: true` требует на КАЖДОМ объектном узле схемы:
 *   - `additionalProperties: false`;
 *   - `required`, перечисляющий ВСЕ ключи `properties`.
 *
 * Наши схемы этого не гарантируют:
 *   - `z.toJSONSchema(...)` (Zod v4) для `.optional()` / `.nullable()` полей
 *     НЕ кладёт их в `required` → 400 «'required' ... Missing 'summary'».
 *   - ручные схемы (block-ingest) содержат free-form `metadata: { type: 'object' }`
 *     без `additionalProperties` → 400 «'additionalProperties' is required
 *     to be supplied and to be false».
 *
 * Эта функция рекурсивно приводит схему к strict-совместимому виду,
 * возвращая НОВЫЙ объект (вход не мутируется). Для free-form объектов без
 * `properties` результатом будет закрытый объект (`{}`), что валидно для
 * strict — лучше лёгкая деградация metadata, чем падение всей задачи.
 *
 * Семантика «все поля required» совпадает с тем, что делает официальный
 * `zodResponseFormat` из OpenAI SDK: optional/nullable поля остаются
 * выразимыми через `null` (nullable-тип), но обязаны присутствовать в выводе.
 */
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
    } else if (
      (key === '$defs' || key === 'definitions') &&
      value &&
      typeof value === 'object'
    ) {
      const defs = value as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const [defKey, defValue] of Object.entries(defs)) {
        next[defKey] = toOpenAiStrictSchema(defValue);
      }
      out[key] = next;
    } else if (
      (key === 'anyOf' || key === 'oneOf' || key === 'allOf') &&
      Array.isArray(value)
    ) {
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
    const props =
      (out['properties'] as Record<string, unknown> | undefined) ?? {};
    out['properties'] = props;
    out['additionalProperties'] = false;
    out['required'] = Object.keys(props);
  }

  return out;
}
