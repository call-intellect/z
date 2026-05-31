/**
 * Pulse Wave 6 §6.6 — Goal-Vector-Tracker агент (LLM-промпт).
 *
 * Источник: plans/tz/2026-05-30-pulse-full.md §6.6.
 *
 * Для одной active Goal и набора артефактов команды за неделю модель
 * возвращает per-Person структурированный pro/contra/net score. Используется
 * в виджете «Вектор компании» на Главной и в карточке сотрудника
 * «Куда направлены усилия».
 *
 * Cache-friendly (см. feedback_llm_prompts_cache_friendly.md): SYSTEM —
 * полностью статичен; переменные данные (цель + артефакты) — в КОНЦЕ
 * user-сообщения.
 *
 * EU AI Act: на вход — только структурированные действия (без личных
 * характеристик / эмоций / голоса). Это про вклад в цель, а не про
 * оценку личности.
 */

export const GOAL_VECTOR_TRACKER_SYSTEM_PROMPT = `Ты — аналитик вклада сотрудников в цели компании.
По цели и списку артефактов за неделю ты определяешь:
  - proScore   — суммарный вес действий «в цель» (идеи, обещания, выполненные обещания, закрытые задачи).
  - contraScore — суммарный вес действий «против цели» (нарушенные обещания, отказы, явная негативная активность).
  - netScore   — proScore − contraScore.
  - signals    — провенанс: какие конкретные артефакты вошли (для transparent sourcing).

Правила:
  - Если артефакт явно работает на цель — pro.
  - Если артефакт явно противоречит цели — contra.
  - Если артефакт нейтрален или непонятен — не учитывай.
  - Каждый сигнал помечай direction='pro' или 'contra' и kind ∈ {idea, commitment_kept, commitment_broken, issue_closed}.

Верни СТРОГО JSON:
{
  "persons": [
    {
      "personId": "string",
      "proScore": number,
      "contraScore": number,
      "netScore": number,
      "signals": [
        {"kind": "idea"|"commitment_kept"|"commitment_broken"|"issue_closed",
         "refId": "string",
         "direction": "pro"|"contra"}
      ]
    }
  ]
}

Без дополнительных полей. Без markdown-fences.`;

export const GOAL_VECTOR_TRACKER_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    persons: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          personId: { type: 'string' },
          proScore: { type: 'number' },
          contraScore: { type: 'number' },
          netScore: { type: 'number' },
          signals: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: {
                  type: 'string',
                  enum: [
                    'idea',
                    'commitment_kept',
                    'commitment_broken',
                    'issue_closed',
                  ],
                },
                refId: { type: 'string' },
                direction: { type: 'string', enum: ['pro', 'contra'] },
              },
              required: ['kind', 'refId', 'direction'],
            },
          },
        },
        required: ['personId', 'proScore', 'contraScore', 'netScore', 'signals'],
      },
    },
  },
  required: ['persons'],
};

/**
 * Один артефакт сотрудника, который оценивает модель.
 */
export interface GoalVectorArtefact {
  personId: string;
  personName: string;
  /** Тип артефакта (источник). */
  kind: 'idea' | 'commitment_kept' | 'commitment_broken' | 'issue_closed';
  /** Стабильный ID источника (IdeaBlock.id / Issue.id) — для signals.refId. */
  refId: string;
  /** Краткий текст артефакта для контекста LLM. */
  text: string;
}

/**
 * Cache-friendly сборка user-сообщения: фиксированные заголовки —
 * сверху, переменные данные `goal` + `artefacts` — внизу JSON-блоком.
 */
export function buildGoalVectorTrackerUserMessage(args: {
  goalTitle: string;
  goalDescription: string;
  weekStart: string; // ISO YYYY-MM-DD
  artefacts: GoalVectorArtefact[];
}): string {
  return [
    `Цель компании: ${args.goalTitle}.`,
    ``,
    `Описание цели:`,
    args.goalDescription,
    ``,
    `Неделя: ${args.weekStart}.`,
    ``,
    `Артефакты сотрудников за неделю (JSON в конце):`,
    `- kind: idea / commitment_kept / commitment_broken / issue_closed.`,
    `- refId: стабильный ID для signals.refId.`,
    `- text: контекст для оценки направления (pro/contra).`,
    ``,
    JSON.stringify({ artefacts: args.artefacts }, null, 2),
  ].join('\n');
}

/** Тип одной person-записи в распарсенном ответе. */
export interface GoalVectorPerson {
  personId: string;
  proScore: number;
  contraScore: number;
  netScore: number;
  signals: Array<{
    kind: 'idea' | 'commitment_kept' | 'commitment_broken' | 'issue_closed';
    refId: string;
    direction: 'pro' | 'contra';
  }>;
}

/**
 * Безопасный парсер: null при невалидном JSON или нарушении схемы.
 */
export function parseGoalVectorTrackerResponse(
  text: string,
): { persons: GoalVectorPerson[] } | null {
  try {
    const raw = JSON.parse(text) as unknown;
    if (typeof raw !== 'object' || raw === null) return null;
    const o = raw as Record<string, unknown>;
    if (!Array.isArray(o.persons)) return null;
    const out: GoalVectorPerson[] = [];
    for (const item of o.persons) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const personId = r.personId;
      const proScore = r.proScore;
      const contraScore = r.contraScore;
      const netScore = r.netScore;
      if (
        typeof personId !== 'string' ||
        typeof proScore !== 'number' ||
        typeof contraScore !== 'number' ||
        typeof netScore !== 'number'
      ) {
        continue;
      }
      const signalsRaw = r.signals;
      const signals: GoalVectorPerson['signals'] = [];
      if (Array.isArray(signalsRaw)) {
        for (const sItem of signalsRaw) {
          if (!sItem || typeof sItem !== 'object') continue;
          const s = sItem as Record<string, unknown>;
          const kind = s.kind;
          const refId = s.refId;
          const direction = s.direction;
          if (
            (kind === 'idea' ||
              kind === 'commitment_kept' ||
              kind === 'commitment_broken' ||
              kind === 'issue_closed') &&
            typeof refId === 'string' &&
            (direction === 'pro' || direction === 'contra')
          ) {
            signals.push({ kind, refId, direction });
          }
        }
      }
      out.push({
        personId,
        proScore,
        contraScore,
        netScore,
        signals,
      });
    }
    return { persons: out };
  } catch {
    return null;
  }
}
