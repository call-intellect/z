/**
 * Code-fallback промпта `behavior-refine` (Фаза B.2).
 *
 * Источник: plans/tz/2026-05-21-phase-B-meeting-behavior-metrics.md §7.
 *
 * Задача: батч-классификатор. На вход — список «кандидатов на вопросы»
 * (текст сегмента + флаг, ставится ли «?») и «кандидатов на filler»
 * (слово + контекст). На выход — JSON с булевыми решениями по каждому
 * кандидату.
 *
 * Уровень модели: короткий yes/no классификатор (см. playbook §11). Не
 * требует длинного контекста, не требует reasoning. Подходит gpt-5.4-nano /
 * deepseek-v4-flash / qwen3.5:9b.
 */

export const BEHAVIOR_REFINE_TASK_TYPE = 'behavior-refine';
export const BEHAVIOR_REFINE_TOOL_NAME = 'submit_behavior_refine';

export interface BehaviorRefineQuestionCandidate {
  /** Уникальный ключ кандидата: `${participantId|null}:${segmentIdx}:${sentenceIdx}`. */
  id: string;
  /** Полное предложение-кандидат. */
  text: string;
  /** Содержит ли предложение «?» (для статистики). */
  hasQuestionMark: boolean;
}

export interface BehaviorRefineFillerCandidate {
  /** Уникальный ключ: `${participantId|null}:${segmentIdx}:${wordIdx}`. */
  id: string;
  /** Конкретное слово/фраза по словарю. */
  word: string;
  /** Окружающий контекст (предложение, в котором встретилось слово). */
  context: string;
}

export interface BehaviorRefineInput {
  questions: BehaviorRefineQuestionCandidate[];
  fillers: BehaviorRefineFillerCandidate[];
}

export interface BehaviorRefineOutput {
  /** id → true (это вопрос) / false (не вопрос, например риторика). */
  questions: Record<string, boolean>;
  /** id → true (это filler) / false (это связка/значимое слово). */
  fillers: Record<string, boolean>;
}

export const BEHAVIOR_REFINE_SYSTEM_PROMPT = [
  'Ты — лингвист-аналитик. Получаешь сегменты реальной деловой встречи на русском.',
  'Твоя задача — для каждого кандидата принять одно из двух решений: ДА или НЕТ.',
  '',
  'По вопросам: верни true, если предложение — действительный вопрос участника',
  '(в т.ч. без «?»), и false, если это риторика, междометие или утверждение',
  'с «?» по ошибке расшифровки.',
  '',
  'По filler-словам: верни true, если слово — паразит без смысловой нагрузки',
  '(«ну», «вот», «как бы» как затычка), и false, если оно несёт значение',
  '(«ну ладно», «вот это», «как бы» как сравнение).',
  '',
  'Отвечай строго через инструмент submit_behavior_refine, JSON без поясняющего текста.',
].join('\n');

export const BEHAVIOR_REFINE_TOOL_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    questions: {
      type: 'object' as const,
      description:
        'Map id → true/false. id — это id из questions[].id входа. Все id из входа обязаны быть в ответе.',
      additionalProperties: { type: 'boolean' as const },
    },
    fillers: {
      type: 'object' as const,
      description:
        'Map id → true/false. id — это id из fillers[].id входа. Все id из входа обязаны быть в ответе.',
      additionalProperties: { type: 'boolean' as const },
    },
  },
  required: ['questions', 'fillers'],
  additionalProperties: false,
};

/**
 * Строит user-сообщение для LLM. Сериализация — компактный JSON, чтобы
 * провайдеры с маленьким контекстом (Ollama qwen3.5:9b) не упирались в лимит.
 *
 * Лимит per-вызов: до 200 кандидатов вопросов + 500 кандидатов filler'ов.
 * Если кандидатов больше — caller должен бить на батчи.
 */
export function buildBehaviorRefineUser(input: BehaviorRefineInput): string {
  return JSON.stringify(input);
}

export const BEHAVIOR_REFINE_MAX_QUESTIONS_PER_CALL = 200;
export const BEHAVIOR_REFINE_MAX_FILLERS_PER_CALL = 500;
