/**
 * Wave 2 — Recognition Agent.
 *
 * LLM-промпт `recognition-formulate`. Принимает контекст благодарности (type +
 * payload) и формулирует короткое тёплое сообщение от имени AI / Коры.
 *
 * Принципы (этические):
 *   - Сообщение НЕ от имени руководителя и НЕ от имени другого сотрудника.
 *     Всегда «я заметил(а)…» / «Кора заметила…» — от AI.
 *   - Не больше 2-3 предложений (≤ 350 символов).
 *   - На русском, без официоза.
 *   - Никаких «топ-3», «лучший в команде» — только индивидуальный сигнал
 *     («ты помог N коллегам», а не «ты на 1-м месте по помощи»).
 *   - Если фактов мало — лучше ничего не выдумывать (вернуть короткое
 *     общее «спасибо», без deepfake-благодарности). LLM может вернуть
 *     пустую строку — тогда воркер использует deterministic-fallback.
 *
 * TODO(owner-product): согласовать финальный текст промпта и тон.
 */

export const RECOGNITION_FORMULATE_SYSTEM_PROMPT = [
  'Ты — Кора, память компании. Твоя задача — сформулировать короткое тёплое',
  'благодарственное сообщение сотруднику от имени AI / системы (НЕ от имени',
  'руководителя и НЕ от имени коллеги). Это просто «я заметила …» / «вижу,',
  'что …».',
  '',
  'Жёсткие правила:',
  '  1. Только русский язык. Без англицизмов.',
  '  2. 1-3 предложения, всего ≤ 350 символов.',
  '  3. Без официоза, без «дорогой коллега», без «выражаем благодарность».',
  '  4. Никаких рейтингов («лучший», «топ-3», «победитель»).',
  '  5. Никаких преувеличений и пустых формулировок («ты молодец», «продолжай»).',
  '  6. Если фактов мало — лучше короче. Можно вернуть пустую строку — тогда',
  '     система использует свой fallback (ничего лучше fallback\'а не придумывай).',
  '',
  'Ответ строго в JSON по схеме `recognition_formulate_v1`:',
  '  { "message": "..." }',
].join('\n');

export interface RecognitionFormulateTemplateArgs {
  /** Тип Recognition — определяет тон и факты. */
  type:
    | 'thanks_comment'
    | 'thanks_helpfulness'
    | 'mention_helped'
    | 'idea_shipped'
    | 'streak_milestone'
    | 'weekly_summary';
  /** Имя получателя (User.name) — для обращения. Если null/пусто — без имени. */
  toUserName?: string | null;
  /** Имя того, кто поблагодарил (User.name). NULL если AI. */
  fromUserName?: string | null;
  /** Произвольный контекст: counts, ideas, examples. Сериализуется в текст. */
  payload?: Record<string, unknown>;
}

/**
 * User-template — компактный набор фактов для LLM. LLM сам решает, что брать
 * и как формулировать в рамках system prompt'а.
 */
export const RECOGNITION_FORMULATE_USER_TEMPLATE = (
  args: RecognitionFormulateTemplateArgs,
): string => {
  const lines: string[] = [];
  lines.push(`Тип благодарности: ${args.type}.`);
  if (args.toUserName) lines.push(`Получатель: ${args.toUserName}.`);
  if (args.fromUserName) {
    lines.push(`От: ${args.fromUserName} (это коллега, не AI).`);
  } else {
    lines.push('От: AI / Кора (никаких имён руководителя или коллеги).');
  }
  if (args.payload && Object.keys(args.payload).length > 0) {
    lines.push('Контекст:');
    for (const [k, v] of Object.entries(args.payload)) {
      lines.push(`  - ${k}: ${formatPayloadValue(v)}`);
    }
  }
  lines.push('');
  lines.push('Сформулируй сообщение по правилам system prompt\'а.');
  lines.push('Верни JSON по схеме `recognition_formulate_v1`.');
  return lines.join('\n');
};

function formatPayloadValue(v: unknown): string {
  if (v === null || v === undefined) return 'n/a';
  if (typeof v === 'string') return v.slice(0, 200);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v).slice(0, 300);
  } catch {
    return '[unserializable]';
  }
}

export const RECOGNITION_FORMULATE_SCHEMA_NAME = 'recognition_formulate_v1';

export const RECOGNITION_FORMULATE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: {
    message: {
      type: 'string',
      minLength: 0,
      maxLength: 400,
      description:
        'Короткое тёплое сообщение (1-3 предложения, ≤ 350 символов). Пустая строка = «использовать fallback».',
    },
  },
};

/**
 * Deterministic fallback — используется, если LLM упал / вернул пусто.
 * Никакого выдумывания фактов. Без имён.
 */
export function recognitionFallbackMessage(args: {
  type: RecognitionFormulateTemplateArgs['type'];
  payload?: Record<string, unknown>;
}): string {
  switch (args.type) {
    case 'thanks_comment':
      return 'Коллега поблагодарил тебя за комментарий — спасибо, что делишься.';
    case 'thanks_helpfulness':
      return 'Я заметила, что ты помог(ла) коллегам на этой неделе. Спасибо.';
    case 'mention_helped':
      return 'В чек-ине коллега отметил твою помощь. Это ценно.';
    case 'idea_shipped': {
      const status = typeof args.payload?.status === 'string'
        ? (args.payload.status as string)
        : null;
      if (status === 'shipped') {
        return 'Твоя идея выпущена — спасибо за инициативу.';
      }
      return 'Твоя идея взята в работу — спасибо за инициативу.';
    }
    case 'streak_milestone': {
      const days =
        typeof args.payload?.days === 'number'
          ? (args.payload.days as number)
          : null;
      return days
        ? `${days} дней подряд с чек-инами — спасибо, ты помогаешь команде видеть полную картину.`
        : 'Спасибо за стабильные чек-ины.';
    }
    case 'weekly_summary':
      return 'На этой неделе ты был(а) активным участником в команде. Коллеги это видят.';
  }
}
