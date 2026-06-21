import OpenAI from 'openai';

import {
  REGULATION_EXTRACT_SYSTEM_PROMPT,
  REGULATION_EXTRACT_USER_TEMPLATE,
  REGULATION_EXTRACT_JSON_SCHEMA,
} from '../../src/modules/knowledge-core/prompts/regulation-extract.prompt';
import {
  REGULATION_DEDUPE_SYSTEM_PROMPT,
  REGULATION_DEDUPE_USER_TEMPLATE,
  REGULATION_DEDUPE_JSON_SCHEMA,
} from '../../src/modules/knowledge-core/prompts/regulation-dedupe.prompt';

const MODEL = process.env.AUDIT_MODEL ?? 'deepseek-v4-pro';
if (!process.env.DEEPSEEK_API_KEY) {
  console.error('DEEPSEEK_API_KEY not set');
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

async function callTool(
  system: string,
  user: string,
  toolName: string,
  schema: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = (await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: 4000,
    tools: [{ type: 'function', function: { name: toolName, description: 'submit', parameters: schema } }],
    tool_choice: 'auto',
  } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
    choices: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function: { arguments: string } }> } }>;
  };
  const msg = resp.choices[0]?.message;
  const raw = msg?.tool_calls?.[0]?.function.arguments ?? msg?.content ?? '{}';
  const stripped = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(jsonMatch ? jsonMatch[0] : stripped) as Record<string, unknown>;
  } catch {
    return { _raw: raw.slice(0, 200) };
  }
}

// ── Поле «чья это норма» в улучшенном extract V2 (добавка к системному промпту) ──
const ORG_OWNERSHIP_RULE_V2 = [
  '',
  '# КРИТИЧЕСКИ ВАЖНО — ЧЬЯ это норма (источник бага «чужие процессы»)',
  'Регламент/процесс/инструкция фиксируется ТОЛЬКО если это норма КОМПАНИИ-ВЛАДЕЛЬЦА кабинета (нашей), а не собеседника.',
  'На встречах типа «продажа», «успех клиента», «партнёр», «консультация» вторая сторона (клиент, гость, лид) РАССКАЗЫВАЕТ ПРО СВОЮ компанию — это НЕ наша норма.',
  'Если в блоке описан процесс/правило ЧУЖОЙ компании (клиента, гостя, потенциального заказчика), либо рассказан как «как у НАС в [другой компании]», «у клиента», «они так делают» — isOrgNorm=false, ownerCompany="клиент/гость", confidence низкий, тело не извлекай.',
  'isOrgNorm=true только когда норма принадлежит нашей компании и сказана нашим сотрудником про нашу работу.',
  'ownerCompany — чья это норма: "наша" | "клиент" | "гость" | "неизвестно". Сомнение про принадлежность → "неизвестно" и isOrgNorm=false.',
].join('\n');

const EXTRACT_SCHEMA_V2: Record<string, unknown> = {
  ...REGULATION_EXTRACT_JSON_SCHEMA,
  properties: {
    ...(REGULATION_EXTRACT_JSON_SCHEMA as { properties: Record<string, unknown> }).properties,
    ownerCompany: { type: 'string', enum: ['наша', 'клиент', 'гость', 'неизвестно'] },
  },
};

// ── Улучшенный dedupe V2: перебалансировка для процессов-парафразов ──
const DEDUPE_SYSTEM_V2 =
  REGULATION_DEDUPE_SYSTEM_PROMPT +
  [
    '',
    '# ДОПОЛНЕНИЕ (анти-дубль для процессов одного назначения)',
    'Цена ЛИШНЕГО дубля в каталоге процессов тоже высока: десять карточек «онбординг клиента» делают каталог нечитаемым и помощник смешивает их в ответе.',
    'Если черновик и кандидат описывают процесс с ОДНИМ И ТЕМ ЖЕ назначением/результатом и ТЕМИ ЖЕ ключевыми шагами (пусть слова и порядок разные) — это «объединить» или «дополнить», НЕ «новая запись».',
    'Признак того же процесса: совпадает цель (что на выходе) и ≥60% шагов/действий. Разные детали реализации того же сценария — это «дополнить», а не «новая запись».',
    '«Новая запись» для процесса — только когда у него ДРУГОЕ назначение/результат, а не просто другая формулировка того же сценария.',
  ].join('\n');

interface Case {
  title: string;
  expectCorrect: string;
}

async function runExtract(
  label: string,
  block: {
    blockName: string;
    criticalQuestion: string;
    trustedAnswer: string;
    signalType: string;
    tags: string[];
    evidenceQuotes: string[];
    meetingTypeHint?: string;
  },
  variant: 'v1' | 'v2',
): Promise<void> {
  let system = REGULATION_EXTRACT_SYSTEM_PROMPT;
  let schema = REGULATION_EXTRACT_JSON_SCHEMA;
  let user = REGULATION_EXTRACT_USER_TEMPLATE(block);
  if (variant === 'v2') {
    system = REGULATION_EXTRACT_SYSTEM_PROMPT + ORG_OWNERSHIP_RULE_V2;
    schema = EXTRACT_SCHEMA_V2;
    user =
      `Тип встречи: ${block.meetingTypeHint ?? 'неизвестно'} (на продажах/консультациях вторая сторона рассказывает про СВОЮ компанию).\n` +
      user;
  }
  const r = await callTool(system, user, 'submit_regulation_extract', schema);
  console.log(
    `  [${variant}] ${label}: isOrgNorm=${r['isOrgNorm']} ownerCompany=${r['ownerCompany'] ?? '—'} confidence=${r['confidence']} kind=${r['kind']}`,
  );
  console.log(`        name="${r['name']}"`);
}

async function runDedupe(
  label: string,
  draft: { kind: string; name: string; statement: string; scope?: string | null },
  candidates: Array<{ id: string; name: string; statement: string; scope?: string | null }>,
  variant: 'v1' | 'v2',
): Promise<void> {
  const system = variant === 'v2' ? DEDUPE_SYSTEM_V2 : REGULATION_DEDUPE_SYSTEM_PROMPT;
  const user = REGULATION_DEDUPE_USER_TEMPLATE({ draft, candidates });
  const r = await callTool(system, user, 'submit_regulation_dedupe', REGULATION_DEDUPE_JSON_SCHEMA);
  const tgt = candidates.find((c) => c.id === r['targetId']);
  console.log(
    `  [${variant}] ${label}: decision=${r['decision']} targetId=${r['targetId'] ?? '—'}${tgt ? ` («${tgt.name}»)` : ''}`,
  );
  console.log(`        reasoning: ${String(r['reasoning'] ?? '').slice(0, 220)}`);
}

async function main(): Promise<void> {
  console.log(`=== Аудит модуля регламентов (модель ${MODEL}) ===\n`);

  // ───────── БАГ 1: чужой процесс клиента проходит как наша норма ─────────
  console.log('## ТЕСТ 1 — Бага «чужие процессы»: блок из ПРОДАЖНОЙ встречи, клиент рассказывает про свою компанию');
  const clientBlock = {
    blockName: 'Хранение информации по торговым сетям (у клиента)',
    criticalQuestion: 'Как сейчас организовано хранение информации по торговым сетям?',
    trustedAnswer:
      'По каждой торговой сети последовательно фиксируются акции, договоры и заказы; инструкции хранятся в папках отделов (видео и печатные).',
    signalType: 'regulation',
    tags: ['продажа', 'клиент', 'торговые сети'],
    evidenceQuotes: [
      'У нас по каждой торговой сети всё по порядку: сначала договоры, потом заказы, потом акции',
      'Инструкции держим в папках по отделам — видео и печатные',
    ],
    meetingTypeHint: 'продажа (клиент — дистрибьютор молочной продукции)',
  };
  await runExtract('клиентский процесс (ожидается isOrgNorm=false)', clientBlock, 'v1');
  await runExtract('клиентский процесс (ожидается isOrgNorm=false)', clientBlock, 'v2');

  console.log('\n## ТЕСТ 1б — Контроль: НАШ внутренний процесс (должен пройти как наша норма)');
  const ourBlock = {
    blockName: 'Код-ревью перед merge',
    criticalQuestion: 'Какой у нас порядок код-ревью?',
    trustedAnswer:
      'Каждый pull request проходит ревью двух инженеров и зелёные тесты перед merge в основную ветку.',
    signalType: 'regulation',
    tags: ['разработка', 'внутреннее'],
    evidenceQuotes: ['Мы мержим только после ревью двух инженеров и зелёных тестов'],
    meetingTypeHint: 'командная (внутренняя встреча команды)',
  };
  await runExtract('наш процесс (ожидается isOrgNorm=true)', ourBlock, 'v1');
  await runExtract('наш процесс (ожидается isOrgNorm=true)', ourBlock, 'v2');

  // ───────── БАГ 2: дедуп не сливает очевидные дубли ─────────
  console.log('\n## ТЕСТ 2 — Бага «куча дублей»: новый черновик онбординга против РЕАЛЬНЫХ дублей из выгрузки');
  const draft = {
    kind: 'process',
    name: 'Подключение нового клиента к сервису',
    statement:
      'Создать группу в Telegram, добавить клиента; клиент регистрируется по ссылке, присылает почту для активации тарифа, настраиваем команду.',
    scope: 'org',
  };
  const candidates = [
    {
      id: 'cand-1',
      name: 'Онбординг нового клиента на платформу Кора',
      statement:
        'Процесс подключения клиента: создание Telegram-группы, регистрация на платформе, настройка команды.',
      scope: 'org',
    },
    {
      id: 'cand-2',
      name: 'Подключение к платформе и настройка команды',
      statement:
        'Создание группы, регистрация на платформе, отправка почты для подключения тарифа, создание команды.',
      scope: 'org',
    },
    {
      id: 'cand-3',
      name: 'Подключение нового клиента',
      statement: 'Обеспечить подключение нового клиента к сервису по шагам.',
      scope: 'org',
    },
    {
      id: 'cand-4',
      name: 'Подключение к сервису',
      statement:
        'Последовательность шагов: регистрация по ссылке, отправка почты для активации бесплатного тарифа.',
      scope: 'org',
    },
    {
      id: 'cand-5',
      name: 'Внедрение: создание группы, регистрация на платформе, отправка почты для подключения тарифа',
      statement:
        'Пошаговый план подключения: создание группы → регистрация на платформе → отправка почты для подключения тарифа.',
      scope: 'org',
    },
  ];
  await runDedupe('онбординг-дубль (ожидается merge/extension)', draft, candidates, 'v1');
  await runDedupe('онбординг-дубль (ожидается merge/extension)', draft, candidates, 'v2');

  console.log('\n## ТЕСТ 2б — Контроль: действительно РАЗНЫЙ процесс (должен остаться "new")');
  const draftDiff = {
    kind: 'process',
    name: 'Оценка качества звонков менеджеров',
    statement:
      'Звонки и переписки менеджеров оцениваются по чек-листу критериев, выставляется балл и комментарий.',
    scope: 'org',
  };
  await runDedupe('другой процесс (ожидается new)', draftDiff, candidates, 'v1');
  await runDedupe('другой процесс (ожидается new)', draftDiff, candidates, 'v2');

  console.log('\n=== готово ===');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
