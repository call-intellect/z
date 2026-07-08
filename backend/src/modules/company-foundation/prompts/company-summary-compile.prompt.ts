export const COMPANY_SUMMARY_COMPILE_SYSTEM_PROMPT = [
  'Ты — аналитик Коры, ведёшь краткий паспорт компании: чем она ЕСТЬ по устойчивым фактам.',
  'Формат: 4–6 предложений, один абзац, без списков и заголовков.',
  'Содержание (пункт включай, только если по нему есть факт): чем занимается, продукт/услуги, клиенты/рынок, позиционирование, стадия, при наличии — маркетинг/каналы.',
  'Если дано ТЕКУЩЕЕ описание — прими его за основу, внеси только реально новые или изменившиеся факты, сохрани суть и стиль, НЕ раздувай и НЕ переписывай ради переписывания. Если нового по существу нет — верни текущее описание дословно и changed=false.',
  'Описывай, чем компания ЕСТЬ (устойчивые факты), а не что обсуждали на последней встрече. Идеи, гипотезы, предложения и рассуждения в паспорт не тащи.',
  'Только факты из входа, без воды и домыслов. Чистый русский, без латиницы и идентификаторов.',
  'JSON строго по схеме.',
].join('\n');

export const COMPANY_SUMMARY_COMPILE_USER_TEMPLATE = (args: {
  currentSummary?: string | null;
  facts: readonly string[];
}): string => {
  const numbered = args.facts.map((f, i) => `${i + 1}. ${f}`).join('\n');
  const current =
    args.currentSummary && args.currentSummary.trim().length > 0
      ? args.currentSummary.trim()
      : '(пока нет)';
  return [
    'Текущее описание компании (может быть пустым):',
    current,
    '',
    'Новые факты из графа знаний (учитывай только значимое для паспорта):',
    numbered,
    '',
    'Верни JSON по схеме company_summary_compile_v1.',
  ].join('\n');
};

export const COMPANY_SUMMARY_COMPILE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['contentMd', 'changed'],
  properties: {
    contentMd: {
      type: 'string',
      minLength: 1,
      maxLength: 1000,
      description:
        'Паспорт компании: 4–6 предложений, один абзац — чем занимается, продукт/услуги, клиенты/рынок, позиционирование, стадия. Чистый русский.',
    },
    changed: {
      type: 'boolean',
      description:
        'true — описание обновлено новыми фактами; false — по существу нового нет, contentMd повторяет текущее описание дословно.',
    },
  },
};

export const COMPANY_SUMMARY_COMPILE_SCHEMA_NAME = 'company_summary_compile_v1';
