export const COMPANY_SUMMARY_COMPILE_SYSTEM_PROMPT = [
  'Ты — аналитик Коры. По набору фактов из графа знаний компании напиши краткое описание (3–5 абзацев)',
  'ЧЕМ компания занимается: продукты/услуги, рынок и клиенты, как себя позиционирует.',
  'Только факты из входа, без воды и домыслов.',
  'Чистый русский, без латиницы и идентификаторов.',
  'JSON строго по схеме.',
].join('\n');

export const COMPANY_SUMMARY_COMPILE_USER_TEMPLATE = (args: {
  facts: readonly string[];
}): string => {
  const numbered = args.facts.map((f, i) => `${i + 1}. ${f}`).join('\n');
  return [
    'Факты из графа знаний компании:',
    numbered,
    'Верни JSON по схеме company_summary_compile_v1.',
  ].join('\n');
};

export const COMPANY_SUMMARY_COMPILE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['contentMd'],
  properties: {
    contentMd: {
      type: 'string',
      minLength: 1,
      maxLength: 4000,
      description:
        'Краткое описание (3–5 абзацев) чем компания занимается: продукты/услуги, рынок и клиенты, позиционирование. Чистый русский.',
    },
  },
};

export const COMPANY_SUMMARY_COMPILE_SCHEMA_NAME = 'company_summary_compile_v1';
