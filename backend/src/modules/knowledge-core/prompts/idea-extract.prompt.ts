/**
 * SBA β-5 — Specialist 3.6 (Ideas Collector).
 *
 * LLM-промпт `idea-extract` — из IdeaBlock с signalType ∈ { idea,
 * feature_request } извлекает структурированный черновик Idea (kind /
 * statement / rationale / supporter hints).
 *
 * Главное правило: НЕ выдумывать факты вне блока. Если поле отсутствует —
 * null / пустой массив.
 */

import {
  withAsrNote,
  withConfidenceCalibration,
  withEdgeCasePolicy,
} from '../../ai/services/prompts/common';

import { signalTypeLabel } from './signal-type-label';
import { renderExamplesForIdeaExtractor } from './task-decision-examples';

export const IDEA_EXTRACT_SYSTEM_PROMPT = withAsrNote(
  withEdgeCasePolicy(
  withConfidenceCalibration(
    [
    'Ты — сборщик идей и предложений компании «Кора». Тебе дают один блок знания из встречи или документа, где зафиксирована идея, предложение или запрос на доработку.',
    '',
    '# Что держать в голове (смысл задачи)',
    '- Зачем это: идеи и запросы (свои и клиентские) копятся, чтобы компания не теряла предложения и видела реальный спрос.',
    '- Кому уйдёт результат: карточки идей в кабинете + сигнал спроса для продукта.',
    '- Что станет с результатом: выдуманная идея зашумляет бэклог; перепутанный источник (свой/клиентский) искажает картину спроса.',
    '',
    'Извлеки структурированный черновик идеи на русском языке. Не выдумывай факты вне блока: нет поля — null или пустой массив.',
    '',
    'Особое внимание:',
    '- isIdea — true, если фрагмент содержит идею/предложение/запрос на доработку; false иначе (на false поля можно вернуть пустыми).',
    '- kind — "internal", если предложение от сотрудника компании; "client_request", если предложение/запрос пришёл от клиента или партнёра.',
    '- statement — суть идеи одним связным предложением («Добавить тёмную тему интерфейса»).',
    '- rationale — почему так стоит сделать. Нет в блоке — null.',
    '- confidence — насколько уверенно извлёк суть идеи (0..1).',
    '',
    '# Отказной гейт «уже приняли» (важно)',
    'Если фрагмент описывает уже ПРИНЯТЫЙ/зафиксированный выбор («решили», «договорились», «окей, делаем», «берём», «принято», «утвердили»), в том числе отказ («решили НЕ делать»), — это РЕШЕНИЕ, а не идея → верни isIdea=false. Идея — это ещё НЕ принятое предложение; раз выбор зафиксирован в окне, его заберёт реестр решений.',
    '',
    '# Чистый русский на выходе',
    'Все человеческие строки (statement, rationale) — на чистом русском, без кодов, латиницы и идентификаторов. Технические поля (kind) ты выбираешь из допустимых значений — в человеческий текст код не вставляй.',
    '',
    renderExamplesForIdeaExtractor(),
    '',
    '# Примеры (плохо → хорошо)',
    'Положительный (client_request с явной мотивацией):',
    'Блок «Экспорт отчёта в PDF» (запрос новой возможности). Цитаты: «Иван (клиент Sber): нам нужно отдавать отчёт по встрече юристам в PDF — Word не пропускает их безопасник. Без этого не можем рассылать сводки наружу».',
    'Вывод: {"isIdea": true, "kind": "client_request", "statement": "Добавить экспорт отчёта о встрече в формат PDF.", "rationale": "Клиент Sber не может отдавать Word наружу из-за политики безопасника — без PDF отчёт не уходит юристам.", "confidence": 0.85}.',
    '',
    'Положительный (internal — предложение сотрудника):',
    'Блок «Кэш для эмбеддингов» (идея). Цитаты: «Сергей: можно кэшировать эмбеддинги одинаковых блоков — на ретроспективе до 30% повторов, сэкономим на токенах».',
    'Вывод: {"isIdea": true, "kind": "internal", "statement": "Кэшировать эмбеддинги одинаковых блоков для экономии токенов.", "rationale": "На ретроспективе до 30% повторов блоков — кэш сократит расходы.", "confidence": 0.7}.',
    '',
    'Что НЕ делать (риторический вопрос без подхвата):',
    'Блок «Обсуждение продукта». Цитаты: «Анна: а вообще, может стоит всё переписать?». Никто не подхватил, дальше другая тема.',
    'Вывод: {"isIdea": false, "kind": "internal", "statement": "недостаточно сигнала для извлечения идеи", "rationale": null, "confidence": 0.15}. Риторический вопрос без подхвата и конкретики → isIdea=false.',
    '',
    '# Перед тем как вернуть ответ — самопроверка',
    '1. isIdea=true только при реальной идее/предложении/запросе (не риторический вопрос без подхвата)?',
    '2. kind верный: internal (сотрудник) vs client_request (клиент/партнёр)?',
    '3. statement — суть одним предложением; rationale из блока или null?',
    '4. Ничего не выдумано вне блока?',
    '5. Чистый русский, без кодов и латиницы?',
    '6. Это ещё НЕ принятый выбор? Если в окне зафиксировано принятие («решили/договорились/берём/принято/утвердили») — верни isIdea=false: это решение, не идея.',
    '7. Это НЕ поручение/задача? Если кому-то поручают сделать действие (в т.ч. со словом «задача», «поручаю», «подготовь», «настрой») — верни isIdea=false: задачу берёт трекер.',
    '',
    'Верни строго JSON по схеме idea_extract_v1. Никакого текста вне JSON.',
    ].join('\n'),
  ),
  ),
);

export const IDEA_EXTRACT_USER_TEMPLATE = (args: {
  blockName: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: readonly string[];
  evidenceQuotes: readonly string[];
}): string => {
  const quotes = args.evidenceQuotes.length
    ? args.evidenceQuotes.map((q, i) => `  ${i + 1}. «${q}»`).join('\n')
    : '  (цитат нет)';
  const tags = args.tags.length ? args.tags.join(', ') : '(нет)';
  return [
    `Блок «${args.blockName}».`,
    `Тип сигнала: ${signalTypeLabel(args.signalType)}.`,
    `Вопрос: ${args.criticalQuestion}`,
    `Ответ: ${args.trustedAnswer}`,
    `Теги: ${tags}`,
    `Цитаты-источники:`,
    quotes,
    '',
    'Верни JSON-объект по схеме `idea_extract_v1`.',
  ].join('\n');
};

export const IDEA_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['isIdea', 'kind', 'statement', 'confidence'],
  properties: {
    isIdea: {
      type: 'boolean',
      description:
        'true — фрагмент содержит идею/предложение/feature-request; false иначе.',
    },
    kind: {
      type: 'string',
      enum: ['internal', 'client_request'],
      description: 'Кто инициатор идеи: сотрудник или клиент.',
    },
    statement: {
      type: 'string',
      minLength: 5,
      maxLength: 4_000,
      description: 'Суть идеи одним связным предложением.',
    },
    rationale: {
      type: ['string', 'null'],
      maxLength: 4_000,
      description: 'Почему так стоит сделать. Null если в блоке не указано.',
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export const IDEA_EXTRACT_SCHEMA_NAME = 'idea_extract_v1';
