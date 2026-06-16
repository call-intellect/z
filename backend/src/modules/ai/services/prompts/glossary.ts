const GLOSSARY: Record<string, string> = {
  pain: 'Pain — реальная проблема клиента/пользователя, которую он озвучивает. ОТЛИЧАТЬ от objection (возражение на цену/продавца) и concern (опасение, не подкреплённое опытом).',
  churn_risk:
    'Churn risk — риск ухода клиента/пользователя. ОТЛИЧАТЬ от disengagement (временное снижение активности без намерения уйти).',
  commitment:
    'Commitment — публичное обязательство сделать X к сроку Y. ОТЛИЧАТЬ от intention (внутреннее намерение без публичной фиксации).',
  mentoring:
    'Mentoring — передача знаний/опыта с целью развития получателя. ОТЛИЧАТЬ от explaining (просто объяснение факта/процесса).',
  proactive_hint:
    'Proactive hint — подсказка/предупреждение, которое не было запрошено получателем, но полезно ему. ОТЛИЧАТЬ от unsolicited advice (нежелательный совет, который не помогает).',
  decision:
    'Decision — выбор из нескольких опций, зафиксированный с обоснованием. ОТЛИЧАТЬ от preference (личное предпочтение без обоснования).',
  regulation:
    'Regulation — формальное правило компании (что/нельзя). ОТЛИЧАТЬ от process (последовательность шагов как делать) и policy (общий принцип).',
  'process-discriminator':
    'Процесс/норма — повторяемое правило «как делаем всегда». ОТЛИЧАТЬ от разовой задачи (выполнить один раз на этой встрече) и от пожелания «надо бы». Разовое НЕ создаёт регламент/процесс/инструкцию.',
};

export type GlossaryTerm = keyof typeof GLOSSARY;

export function withGlossary(systemBody: string, terms: readonly GlossaryTerm[]): string {
  const definitions = terms
    .filter((t) => GLOSSARY[t])
    .map((t) => `- ${GLOSSARY[t]}`)
    .join('\n');
  if (!definitions) return systemBody;
  return `${systemBody}\n\nГлоссарий бизнес-терминов:\n${definitions}`;
}
