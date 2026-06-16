export const CARD_ROLLUP_MAX_RECENT_MEETINGS = 20;

export interface CardRollupMeetingDigest {
  index: number;
  date: string;
  type: string;
  title: string;
  summary: string;
}

export interface BuildCardRollupPromptInput {
  cardName: string;
  cardKind: string;
  contactName: string | null;
  contactEmail: string | null;
  meetings: CardRollupMeetingDigest[];
}

const SYSTEM_BASE =
  'Ты — ассистент для CRM-карточек встреч. Сжимаешь набор саммари нескольких ' +
  'встреч одного контекста в краткий обзор для пользователя.\n\n' +
  'ПРАВИЛА:\n' +
  '- Не выдумывай факты, которых нет во входе.\n' +
  '- Не повторяй сами саммари — выдели общие темы, прогресс, открытые вопросы.\n' +
  '- Стиль: деловой, без воды. На русском.\n' +
  '- Длина: 2-4 коротких абзаца ИЛИ маркированный список из 4-6 пунктов.\n' +
  '- Если встреч мало (1-2), сделай ёмкое одно-абзацное саммари.\n' +
  '- Markdown допустим (жирный, списки), но без заголовков верхнего уровня.\n' +
  '- НЕ добавляй вступительных фраз типа «Вот обзор...» — сразу к сути.\n' +
  '- Пустые данные → «Данных недостаточно», не выдумывай.';

const SYSTEM_BY_KIND: Record<string, string> = {
  client:
    SYSTEM_BASE +
    '\n\nКОНТЕКСТ: это карточка КЛИЕНТА. Сфокусируйся на:\n' +
    '— как развиваются отношения / темы клиента;\n' +
    '— что повторяется (жалобы, запросы, цели);\n' +
    '— открытые обещания или follow-up;\n' +
    '— заметные изменения от встречи к встрече.\n' +
    'АНТИ-УТЕЧКА: не включай температуру сделки, бюджет, сомнения, оценку готовности ЛПР — только нейтральные темы и прогресс.',
  deal:
    SYSTEM_BASE +
    '\n\nКОНТЕКСТ: это карточка СДЕЛКИ. Сфокусируйся на:\n' +
    '— стадия сделки и прогресс;\n' +
    '— ключевые возражения и как они отрабатывались;\n' +
    '— ЛПР, бюджет, сроки (если упоминалось);\n' +
    '— next step.\n' +
    'АНТИ-УТЕЧКА: не включай температуру сделки, бюджет, сомнения, оценку готовности ЛПР — только нейтральные темы и прогресс.\n' +
    'конкуренты включают варианты «ничего не делать»/«своими силами».',
  project:
    SYSTEM_BASE +
    '\n\nКОНТЕКСТ: это карточка ПРОЕКТА. Сфокусируйся на:\n' +
    '— состояние проекта и ключевые вехи;\n' +
    '— текущие блокеры и риски;\n' +
    '— что обсуждалось чаще всего;\n' +
    '— открытые задачи / решения.',
  topic:
    SYSTEM_BASE +
    '\n\nКОНТЕКСТ: это ТЕМАТИЧЕСКАЯ карточка (без конкретного человека). Сфокусируйся на:\n' +
    '— основные темы встреч и их эволюция;\n' +
    '— общие выводы, повторяющиеся идеи;\n' +
    '— открытые вопросы и направления.',
  custom: SYSTEM_BASE,
};

export function buildCardRollupSystemPrompt(kind: string): string {
  return SYSTEM_BY_KIND[kind] ?? SYSTEM_BY_KIND.custom!;
}

export function buildCardRollupUserMessage(input: BuildCardRollupPromptInput): string {
  const lines: string[] = [];
  lines.push(`Карточка: ${input.cardName}`);
  if (input.contactName) {
    const contactSuffix = input.contactEmail ? ` (${input.contactEmail})` : '';
    lines.push(`Контакт: ${input.contactName}${contactSuffix}`);
  } else if (input.contactEmail) {
    lines.push(`Контактный email: ${input.contactEmail}`);
  }
  lines.push(`Тип карточки: ${input.cardKind}`);
  lines.push(`Всего встреч в обзоре: ${input.meetings.length}`);
  lines.push('');
  lines.push('Саммари встреч (от старых к новым):');
  for (const m of input.meetings) {
    lines.push('');
    lines.push(`#${m.index} · ${m.date} · ${m.type} · ${m.title}`);
    lines.push(m.summary || '(пустое саммари)');
  }
  lines.push('');
  lines.push('Сделай обзор в 2-4 коротких абзаца или 4-6 буллетов.');
  return lines.join('\n');
}
