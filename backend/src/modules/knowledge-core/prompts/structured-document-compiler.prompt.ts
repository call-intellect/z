/**
 * structured-document-compiler.prompt — Волна 6 Стадия C, A7.
 *
 * Агент-компилятор организационного документа: единый владелец сборки
 * `contentMd` для типов regulation / process / policy / instruction. Получает
 * тип, название и материал (накопленные блоки темы) + текущее тело документа,
 * собирает готовый структурный markdown по шаблону типа в двух режимах:
 *   - СОЗДАНИЕ (existingContentMd пуст) — каркас с нуля по структуре типа;
 *   - ДОПОЛНЕНИЕ (existingContentMd непустой) — слияние без потери старого.
 *
 * Источник полного текста SYSTEM:
 *   plans/analysis/2026-06-09-prompt-rewrites/22-org-entities-COMPARE-and-compiler.md §3
 *   (режимы, правила слияния, структуры по типам, маркеры, чек-лист).
 *
 * Контракт (tool `compile_org_document`):
 *   - contentMd:     string  — готовый markdown по структуре типа.
 *   - steps:         array of {title, description} — ТОЛЬКО для kind=process,
 *                    иначе []. Синхронизируются downstream с ProcessStep.
 *   - changeReason:  string  — что и почему изменено («первичная сборка из
 *                    материала» для СОЗДАНИЯ) → ложится в changelog версии.
 *   - signals:       array of string — type-mismatch / no-info / конфликты
 *                    (для триажа).
 *
 * Cache-friendly: SYSTEM стабильный (одинаков для всех вызовов); переменные
 * kind / name / blocks / existingContentMd — целиком в user (см.
 * applyInputGuards на call-site). withDocumentCompilerMode (A0.7) дописан в
 * КОНЕЦ SYSTEM, чтобы не ломать кэш префикса.
 *
 * E1/E2: newSourceBlocks / existingContentMd — пользовательский контент →
 * оборачиваются wrapUserData + withInjectionGuard на call-site (через
 * applyInputGuards). В тело SYSTEM пользовательские данные не вшиваются.
 *
 * Все строки на русском.
 */

import { z } from 'zod';

import type { LlmTool } from '../../ai/services/llm.types';
import { withDocumentCompilerMode } from '../../ai/services/prompts/common';

// ──────────────────────────── Метаданные ────────────────────────────

/** taskType для LlmRouter (см. llm-router.service.ts LlmTaskType). */
export const COMPILE_ORG_DOCUMENT_TASK_TYPE = 'compile-org-document' as const;

/** Имя tool'а для structured output (LLM tool-use). */
export const COMPILE_ORG_DOCUMENT_TOOL_NAME = 'compile_org_document';

/**
 * Лимит выходных токенов. Документ + шаги + changelog — компактны (обычно
 * 2-6k), но запас на длинные регламенты с большой таблицей «кто-что-когда».
 */
export const COMPILE_ORG_DOCUMENT_MAX_TOKENS = 12_000;

/** Поддерживаемые типы документа (kind). */
export const ORG_DOCUMENT_KINDS = [
  'regulation',
  'process',
  'policy',
  'instruction',
] as const;
export type OrgDocumentKind = (typeof ORG_DOCUMENT_KINDS)[number];

// ──────────────────────────── Zod-схема парсинга ────────────────────────────

export const CompiledStepSchema = z
  .object({
    title: z.string().min(1),
    description: z.string(),
  })
  .strict();
export type CompiledStep = z.infer<typeof CompiledStepSchema>;

/**
 * Output одного LLM-вызова. `steps` — массив (для не-process типов LLM вернёт
 * []). Все поля обязательны (steps/signals могут быть пустыми массивами).
 */
export const CompileOrgDocumentOutputSchema = z
  .object({
    contentMd: z.string(),
    steps: z.array(CompiledStepSchema),
    changeReason: z.string(),
    signals: z.array(z.string()),
  })
  .strict();
export type CompileOrgDocumentOutput = z.infer<
  typeof CompileOrgDocumentOutputSchema
>;

// ──────────────────────────── Tool schema (LlmTool) ────────────────────────────

export const COMPILE_ORG_DOCUMENT_TOOL: LlmTool = {
  name: COMPILE_ORG_DOCUMENT_TOOL_NAME,
  description:
    'Собрать готовый структурный организационный документ (markdown) из материала по шаблону его типа.',
  input_schema: {
    type: 'object',
    required: ['contentMd', 'steps', 'changeReason', 'signals'],
    additionalProperties: false,
    properties: {
      contentMd: {
        type: 'string',
        description:
          'Готовый markdown документа по структуре его типа (с маркерами [требует уточнения]/[конфликт]/[изменено] там, где нужно).',
      },
      steps: {
        type: 'array',
        description:
          'Шаги процесса — ТОЛЬКО для kind=process (синхронизируются с таблицей шагов); для остальных типов — пустой массив.',
        items: {
          type: 'object',
          required: ['title', 'description'],
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
          },
        },
      },
      changeReason: {
        type: 'string',
        description:
          'Короткая запись «что и почему изменилось в этой версии» (для СОЗДАНИЯ — «первичная сборка из материала»).',
      },
      signals: {
        type: 'array',
        description:
          'Сигналы для триажа: «материал больше похож на <тип>…», «в материале нет информации по теме», конфликты и т.п.',
        items: { type: 'string' },
      },
    },
  },
};

// ──────────────────────────── System prompt ────────────────────────────

/**
 * Тело SYSTEM — текст СТАЛО из анализа 22 §3 (режимы, алгоритм, правила
 * слияния, общие принципы, структуры по типам, краевые случаи, чек-лист,
 * формат вывода). Стабильный, без переменных — cache-friendly.
 */
const COMPILE_ORG_DOCUMENT_SYSTEM_BODY = `## Роль
Ты — специалист по корпоративной документации компании Кора. Получаешь тип документа, его
название и материал (накопленные блоки из встреч, переписок, заметок) и собираешь из сырого
материала готовый структурный документ одного из типов: Инструкция, Регламент, Описание процесса,
Политика. Ты не пересказываешь материал и не украшаешь его — ты собираешь рабочий документ,
который сразу ложится в базу знаний.

## Режим
- existingContentMd пуст или отсутствует → СОЗДАНИЕ.
- existingContentMd непустой → ДОПОЛНЕНИЕ (слияние по правилам ниже).

## Алгоритм (строго по порядку)
1. Определи режим.
2. Извлеки из материала факты по теме name: действия, роли, сроки, условия, инструменты,
   последовательности. Всё, что не относится к теме документа, — отбрось (в разговоре много лишнего).
3. Проверь тип. Если факты явно противоречат типу (просили инструкцию, а материал — взаимодействие
   пяти ролей со сроками), всё равно пиши в заданном типе, но добавь в signals строку
   «материал больше похож на <тип> — рекомендуется пересмотреть тип».
4. Разложи факты по разделам структуры нужного типа (ниже).
5. В режиме ДОПОЛНЕНИЯ — слей с существующим по правилам слияния.
6. Закрой пробелы маркерами, проверь по чек-листу, верни результат.

## Правила слияния (ДОПОЛНЕНИЕ)
- Сохраняй существующее: не удаляй и не переформулируй валидные пункты без основания; правка
  ради правки запрещена.
- Заполняй пробелы: если в документе [требует уточнения: …], а материал даёт ответ — подставь,
  маркер убери.
- Добавляй новое в логичное место (шаг в середину последовательности, если он там по смыслу).
- Обновляй изменившееся (материал актуальнее старого), помечай прямо в тексте:
  [изменено: было «…», стало «…»].
- Фиксируй конфликты, не угадывай: [конфликт — требует подтверждения: A «…» / B «…»].
- Ничего не теряй молча: каждый факт старого документа либо сохранён, либо обновлён с пометкой.
- Маркеры [изменено: …] из прошлых версий считай принятыми: маркер убери, формулировку оставь.

## Общие принципы
- Не выдумывай: только то, что есть в материале или однозначно следует. Запрещено придумывать
  сроки/ответственных/названия систем «для полноты».
- Помечай пробелы: нет данных для раздела — [требует уточнения: <что именно>]. Честная дырка
  ценнее красивой выдумки.
- Роли, а не имена: пиши через роль, имя в скобках если есть («Менеджер (Ирина) передаёт…»).
  Роль неясна — Иван [требует уточнения: роль].
- Деловой язык, настоящее время, ролевые формулировки («Менеджер проверяет…»).
- Один шаг — одно действие (глагол + объект + условие). Не склеивай три действия в пункт.
- Единая терминология: один объект — один термин во всём документе.
- Без воды: короткий точный документ лучше длинного.

## Структура по типам (раздел contentMd)

### kind = instruction (для одного исполнителя)
1. Назначение · 2. Область применения (кто исполняет) · 3. Что нужно перед началом ·
4. Последовательность действий (нумерованные шаги, каждый = одно действие одного человека) ·
5. Как понять, что сделано верно · 6. Если что-то пошло не так · 7. Связанные документы.

### kind = regulation (взаимодействие ролей) — ядро: таблица
1. Назначение · 2. Область применения · 3. Участники и роли ·
4. Порядок выполнения — таблица: | Шаг | Действие | Ответственный | Срок | Результат |
   (неизвестный срок/ответственный → [требует уточнения] в ячейке, не пропуск) ·
5. Контроль и эскалация · 6. Связанные документы.

### kind = process (сквозной поток) — synced со steps[]
1. Цель · 2. Границы (триггер/результат) · 3. Владелец процесса · 4. Участники ·
5. Шаги (для каждого: вход → действие → выход; ветвления «если…, то…») ·
6. Схема потока (Шаг 1 → Шаг 2 → …, текстом) · 7. Метрики (или [требует уточнения]) ·
8. Связанные процессы и документы.
   ВАЖНО: шаги верни ТАКЖЕ в поле steps[] (title = краткое имя шага, description = «вход → действие → выход») —
   они синхронизируются с таблицей шагов процесса. Для остальных типов steps[] — пустой массив.

### kind = policy
1. Назначение · 2. Область действия · 3. Положения (правила/ограничения) ·
4. Уровень строгости (рекомендация/обязательная/критическая) · 5. Последствия нарушения ·
6. Связанные документы.

## Краевые случаи
- В материале нет ничего по теме → не выдумывай: ДОПОЛНЕНИЕ — верни существующий contentMd без
  изменений; СОЗДАНИЕ — каркас из маркеров [требует уточнения]; в signals — «в материале нет
  информации по теме».
- Материала мало (1–2 фразы) — нормально: заполни что можно, остальное маркеры, не растягивай.
- В материале несколько тем — бери только относящееся к name.

## Чек-лист (молча, не в ответ)
Каждый факт прослеживается до материала? Пустоты закрыты маркерами, не выдумкой? В ДОПОЛНЕНИИ
ничего не пропало молча? Термины единые, шаги атомарные, роли (не только имена)?

## Формат вывода
Верни через инструмент compile_org_document: contentMd (по структуре типа), steps[] (для process,
иначе []), changeReason (1–3 строки «что изменилось в этой версии» — только для ДОПОЛНЕНИЯ; для
СОЗДАНИЯ — «первичная сборка из материала»), signals[]. Никакого текста вне инструмента.`;

/**
 * Полный SYSTEM-промпт компилятора. withDocumentCompilerMode (A0.7) дописывает
 * в КОНЕЦ блок про режимы/маркеры/«ничего не теряй»/версию — стабильно,
 * cache-friendly.
 */
export function buildCompileOrgDocumentSystemPrompt(): string {
  return withDocumentCompilerMode(COMPILE_ORG_DOCUMENT_SYSTEM_BODY);
}

// ──────────────────────────── User message ────────────────────────────

/** Минимальное представление блока-источника для user-сообщения. */
export interface CompileSourceBlock {
  name: string;
  /** Вопрос/тема блока (criticalQuestion). */
  question?: string | null;
  /** Подтверждённый ответ/суть (trustedAnswer / statement). */
  answer?: string | null;
  /** Дословные цитаты-опоры. */
  quotes?: string[];
}

/** Существующий шаг процесса (для синхронизации в ДОПОЛНЕНИИ). */
export interface CompileExistingStep {
  title: string;
  description?: string | null;
}

export interface CompileOrgDocumentInput {
  kind: OrgDocumentKind;
  name: string;
  newSourceBlocks: CompileSourceBlock[];
  /** Текущее тело документа. Пусто/undefined → СОЗДАНИЕ; иначе ДОПОЛНЕНИЕ. */
  existingContentMd?: string | null;
  /** Существующие шаги (для kind=process). */
  existingSteps?: CompileExistingStep[];
  /** ISO «сейчас» (для относительных сроков). */
  nowIso?: string | null;
}

function formatSourceBlock(block: CompileSourceBlock, idx: number): string {
  const lines = [`[Блок ${idx + 1}] ${block.name}`];
  if (block.question) lines.push(`  Вопрос: ${block.question}`);
  if (block.answer) lines.push(`  Суть: ${block.answer}`);
  const quotes = (block.quotes ?? []).filter((q) => q && q.trim().length > 0);
  if (quotes.length > 0) {
    lines.push(`  Цитаты: ${quotes.map((q) => `«${q}»`).join('; ')}`);
  }
  return lines.join('\n');
}

/**
 * Сборка RAW user-сообщения (БЕЗ guard-обёртки — её добавляет applyInputGuards
 * на call-site). Переменная часть целиком здесь — SYSTEM остаётся стабильным.
 */
export function buildCompileOrgDocumentUserMessage(
  input: CompileOrgDocumentInput,
): string {
  const mode =
    input.existingContentMd && input.existingContentMd.trim().length > 0
      ? 'ДОПОЛНЕНИЕ'
      : 'СОЗДАНИЕ';

  const parts: string[] = [];
  parts.push(`kind: ${input.kind}`);
  parts.push(`name: ${input.name}`);
  parts.push(`mode: ${mode}`);
  if (input.nowIso) parts.push(`nowIso: ${input.nowIso}`);

  parts.push('');
  parts.push('Материал (накопленные блоки темы):');
  if (input.newSourceBlocks.length > 0) {
    parts.push(input.newSourceBlocks.map(formatSourceBlock).join('\n\n'));
  } else {
    parts.push('(новых блоков нет)');
  }

  parts.push('');
  parts.push('existingContentMd (текущее тело документа):');
  parts.push(
    input.existingContentMd && input.existingContentMd.trim().length > 0
      ? input.existingContentMd
      : '(пусто — это СОЗДАНИЕ)',
  );

  if (input.kind === 'process') {
    parts.push('');
    parts.push('existingSteps (текущие шаги процесса):');
    const steps = input.existingSteps ?? [];
    if (steps.length > 0) {
      parts.push(
        steps
          .map(
            (s, i) =>
              `  ${i + 1}. ${s.title}${s.description ? ` — ${s.description}` : ''}`,
          )
          .join('\n'),
      );
    } else {
      parts.push('(шагов пока нет)');
    }
  }

  parts.push('');
  parts.push(
    `Собери документ типа «${input.kind}» по его структуре и верни через инструмент ${COMPILE_ORG_DOCUMENT_TOOL_NAME}.`,
  );

  return parts.join('\n');
}

/**
 * Удобный билдер пары (system, user) — НЕ применяет guard'ы (это делает
 * сервис через applyInputGuards). Возвращает RAW system/user.
 */
export function buildCompileOrgDocumentPrompt(input: CompileOrgDocumentInput): {
  system: string;
  user: string;
} {
  return {
    system: buildCompileOrgDocumentSystemPrompt(),
    user: buildCompileOrgDocumentUserMessage(input),
  };
}
