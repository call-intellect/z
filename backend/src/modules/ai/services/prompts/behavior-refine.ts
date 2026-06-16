export const BEHAVIOR_REFINE_TASK_TYPE = 'behavior-refine';
export const BEHAVIOR_REFINE_TOOL_NAME = 'submit_behavior_refine';

export interface BehaviorRefineQuestionCandidate {
  id: string;
  text: string;
  hasQuestionMark: boolean;
}

export interface BehaviorRefineFillerCandidate {
  id: string;
  word: string;
  context: string;
}

export interface BehaviorRefineInput {
  questions: BehaviorRefineQuestionCandidate[];
  fillers: BehaviorRefineFillerCandidate[];
}

export interface BehaviorRefineOutput {
  questions: Record<string, boolean>;
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

export function buildBehaviorRefineUser(input: BehaviorRefineInput): string {
  return JSON.stringify(input);
}

export const BEHAVIOR_REFINE_MAX_QUESTIONS_PER_CALL = 200;
export const BEHAVIOR_REFINE_MAX_FILLERS_PER_CALL = 500;
