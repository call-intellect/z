import { z } from 'zod';

export const ISSUE_PROGRESS_DRAFT_SCHEMA_NAME = 'IssueProgressDraft';

export const ISSUE_PROGRESS_DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['health', 'body', 'doneText', 'nextText', 'confidence'],
  properties: {
    health: {
      type: 'string',
      enum: ['on_track', 'at_risk', 'off_track'],
    },
    body: { type: 'string' },
    doneText: { type: 'string' },
    nextText: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export const IssueProgressDraftResponseSchema = z.object({
  health: z.enum(['on_track', 'at_risk', 'off_track']),
  body: z.string(),
  doneText: z.string(),
  nextText: z.string(),
  confidence: z.number().min(0).max(1),
});

export type IssueProgressDraftResponse = z.infer<
  typeof IssueProgressDraftResponseSchema
>;

export const ISSUE_PROGRESS_DRAFT_SYSTEM_PROMPT = `# Кто ты
Ты — помощник по задачам в компании «Кора». По набору свежих сигналов о задаче ты готовишь короткий человеческий черновик обновления прогресса. Этот черновик увидит человек и решит — опубликовать как есть, поправить или отклонить. Ты ничего не закрываешь и не публикуешь сам.

# Что вернуть
- health — состояние задачи одним из трёх значений:
  - on_track — идёт в норме, видимых препятствий нет;
  - at_risk — есть риск не успеть или появились сомнения;
  - off_track — буксует, давно нет движения или есть явная блокировка.
- body — 1–2 коротких предложения по-русски: что происходит с задачей сейчас, человеческим языком, без воды и без оценки людей.
- doneText — кратко что уже сделано (по сигналам). Пусто, если из сигналов это не следует.
- nextText — кратко что логично сделать дальше. Пусто, если не следует из сигналов.
- confidence — насколько уверен в черновике (0..1).

# Правила
- Опирайся только на присланные сигналы. Не выдумывай фактов, цифр и сроков, которых в них нет.
- Тон — помощь коллеге, а не отчёт начальству. Без официоза, без латиницы, без кодов и идентификаторов.
- Не оценивай людей и не следи за ними — описывай состояние дела, не сотрудника.
- Если сигналов мало или они противоречивы — выбирай at_risk и снижай confidence.

Верни строго JSON по схеме IssueProgressDraft: health, body, doneText, nextText, confidence. Никакого текста вне JSON.`;

export interface IssueProgressDraftSignal {
  label: string;
  detail: string;
}

export function buildIssueProgressDraftUserMessage(args: {
  title: string;
  description?: string | null;
  signals: IssueProgressDraftSignal[];
}): string {
  const taskLine = args.description?.trim()
    ? `«${args.title}. ${args.description.trim().slice(0, 300)}»`
    : `«${args.title}»`;
  return [
    'Задача:',
    taskLine,
    '',
    'Свежие сигналы с момента последнего обновления прогресса:',
    JSON.stringify(
      args.signals.map((s) => ({ signal: s.label, detail: s.detail })),
      null,
      2,
    ),
    '',
    'Сформулируй черновик обновления прогресса. Верни JSON по схеме IssueProgressDraft.',
  ].join('\n');
}
