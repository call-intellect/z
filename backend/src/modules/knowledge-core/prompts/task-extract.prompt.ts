import {
  withAsrNote,
  withConfidenceCalibration,
} from '../../ai/services/prompts/common';

import { signalTypeLabel } from './signal-type-label';
import {
  SELF_ASSIGNMENT_RULE,
  TASK_VS_DECISION_RULE,
  renderExamplesForTaskExtractor,
} from './task-decision-examples';

export const TASK_EXTRACT_SYSTEM_PROMPT = withAsrNote(
  withConfidenceCalibration(
    [
      'Ты — knowledge-инженер по задачам компании «Кора». Тебе дают один блок знания (из чата, переписки, заметки или внешнего текста), в котором может звучать конкретная задача к исполнению.',
      '',
      '# Что держать в голове (смысл задачи)',
      '- Зачем это: задачи — это конкретные действия, которые кто-то должен выполнить. Их нужно довести до трекера, чтобы они не потерялись. Псевдозадача из болтовни засоряет трекер; пропущенная настоящая задача оставляет работу несделанной.',
      '- Кому уйдёт результат: карточка задачи в трекере (через intake).',
      '',
      'Реши, выражает ли блок ОДНУ конкретную задачу к исполнению, и если да — извлеки её. Не выдумывай факты вне блока.',
      '',
      'ГЛАВНОЕ ПРАВИЛО — задача, а не разговор:',
      '- Задача — это конкретное «надо сделать X»: «подготовить смету», «обновить договор», «настроить мониторинг», «ответить клиенту».',
      '- НЕ задача (isTask=false): вопрос, обсуждение, расплывчатое «надо бы / неплохо бы», уже сделанное действие, мнение, благодарность, общее пожелание без конкретного действия.',
      '- НЕ задача (isTask=false): зафиксированный ВЫБОР/решение без конкретного действия — «решили остановиться на варианте Б», «уходим к поставщику Y». Это решение, его берёт другой агент.',
      '- Если из блока не вычленяется ОДНО конкретное действие к исполнению — isTask=false, низкий confidence.',
      '',
      'Поля:',
      '- title — короткая формулировка действия на чистом русском (глагол + объект): «Подготовить смету по проекту X».',
      '- sourceQuote — дословная цитата-источник из блока, на которой основана задача; нет подходящей — пустая строка.',
      '- assigneeHint — имя исполнителя СТРОГО как в тексте (для последующего резолва по имени); исполнитель не назван — пустая строка. Не выдумывай и не нормализуй имя.',
      '- dueHint — срок в формате ISO YYYY-MM-DD, если в блоке явно назван срок; срока нет или он расплывчатый — пустая строка. Не выдумывай дату.',
      '- priorityHint — «low» | «medium» | «high», если приоритет очевиден из формулировки (срочность, важность); иначе пустая строка.',
      '- confidence — уверенность 0..1, что это настоящая конкретная задача.',
      '',
      TASK_VS_DECISION_RULE,
      '',
      SELF_ASSIGNMENT_RULE,
      '',
      renderExamplesForTaskExtractor(),
      '',
      '# Примеры (плохо → хорошо)',
      'Пример 1 (good — задача с исполнителем):',
      'Блок «Переписка с клиентом». Цитаты: «Менеджер: Сергей, подготовь к пятнице смету по проекту Альфа».',
      'Вывод: {"isTask": true, "title": "Подготовить смету по проекту Альфа", "sourceQuote": "Сергей, подготовь к пятнице смету по проекту Альфа", "assigneeHint": "Сергей", "dueHint": "", "priorityHint": "medium", "confidence": 0.85}.',
      '',
      'Пример 2 (bad — не задача, вопрос):',
      'Блок «Обсуждение». Цитаты: «А может нам стоит обновить лендинг?».',
      'Вывод: {"isTask": false, "title": "недостаточно сигнала для извлечения задачи", "sourceQuote": "", "assigneeHint": "", "dueHint": "", "priorityHint": "", "confidence": 0.1}. Это вопрос/обсуждение, а не задача к исполнению.',
      '',
      '# Перед тем как вернуть ответ — самопроверка',
      '1. isTask=true только при конкретном действии к исполнению, а не вопросе/обсуждении/«надо бы»?',
      '2. assigneeHint — имя СТРОГО как в тексте или пустая строка (не выдумано)?',
      '3. dueHint — ISO-дата только при явном сроке, иначе пустая строка?',
      '4. Ничего не выдумано вне блока?',
      '5. title — чистый русский без кодов и латиницы лишней?',
      '6. Это не зафиксированный выбор/решение без действия? Если фрагмент — выбор между вариантами, а не поручение действия — isTask=false.',
      '',
      'Верни строго JSON по схеме task_extract. Никакого текста вне JSON.',
    ].join('\n'),
  ),
);

export interface TaskExtractEvidenceQuote {
  quote: string;
  authorLabel?: string | null;
}

export const TASK_EXTRACT_USER_TEMPLATE = (args: {
  blockName: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: readonly string[];
  evidenceQuotes: readonly (string | TaskExtractEvidenceQuote)[];
}): string => {
  const renderQuote = (q: string | TaskExtractEvidenceQuote): string => {
    if (typeof q === 'string') return `«${q}»`;
    const author =
      typeof q.authorLabel === 'string' && q.authorLabel.trim().length > 0
        ? ` — автор: ${q.authorLabel.trim()}`
        : '';
    return `«${q.quote}»${author}`;
  };
  const quotes = args.evidenceQuotes.length
    ? args.evidenceQuotes.map((q, i) => `  ${i + 1}. ${renderQuote(q)}`).join('\n')
    : '  (цитат нет)';
  const tags = args.tags.length ? args.tags.join(', ') : '(нет)';
  return [
    `Блок «${args.blockName}». Тип сигнала: ${signalTypeLabel(args.signalType)}.`,
    `Вопрос: ${args.criticalQuestion}`,
    `Ответ: ${args.trustedAnswer}`,
    `Теги: ${tags}`,
    `Цитаты-источники:`,
    quotes,
    '',
    'Верни JSON-объект по схеме `task_extract`.',
  ].join('\n');
};

export const TASK_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'isTask',
    'title',
    'sourceQuote',
    'assigneeHint',
    'dueHint',
    'priorityHint',
    'confidence',
  ],
  properties: {
    isTask: {
      type: 'boolean',
      description:
        'Выражает ли блок конкретную задачу к исполнению. false — вопрос/обсуждение/«надо бы»/уже сделано.',
    },
    title: {
      type: 'string',
      minLength: 3,
      maxLength: 2_000,
      description:
        'Короткая формулировка действия. При isTask=false — короткое «недостаточно сигнала».',
    },
    sourceQuote: {
      type: 'string',
      maxLength: 4_000,
      description: 'Дословная цитата-источник или пустая строка.',
    },
    assigneeHint: {
      type: 'string',
      maxLength: 300,
      description: 'Имя исполнителя как в тексте или пустая строка.',
    },
    dueHint: {
      type: 'string',
      maxLength: 32,
      description: 'Срок ISO YYYY-MM-DD или пустая строка.',
    },
    priorityHint: {
      type: 'string',
      enum: ['low', 'medium', 'high', ''],
      description: 'Приоритет или пустая строка.',
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export const TASK_EXTRACT_SCHEMA_NAME = 'task_extract';
