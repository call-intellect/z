export const CUSTOM_PROMPT_MAX_LENGTH = 4000;

export const FORBIDDEN_PATTERNS: ReadonlyArray<{
  readonly id: string;
  readonly regex: RegExp;
}> = [
  { id: 'ignore_prev', regex: /ignore\s+(?:all\s+)?(?:previous|prior|above)/i },
  {
    id: 'ignore_prev_ru',
    regex:
      /игнорируй(?:те)?\s+(?:все\s+|всё\s+)?(?:предыдущие|прошлые|прежние|инструкции|правила)/i,
  },
  { id: 'forget_prev_ru', regex: /забудь\s+(?:все\s+|всё\s+)?(?:предыдущие|прошлые|прежние)/i },
  { id: 'system_prefix', regex: /(?:^|\n)\s*system\s*:/i },
  { id: 'chatml_tokens', regex: /<\|im_start\|>|<\|im_end\|>/ },
  { id: 'bracket_system', regex: /\[\[\s*system\s*\]\]/i },
  {
    id: 'act_as_ru',
    regex:
      /(?:действуй|веди\s+себя|отвечай)\s+как\s+|представь[,\s]+что\s+ты\s+|ты\s+(?:теперь|больше\s+не)\s+/i,
  },
  { id: 'new_instruction_ru', regex: /нов(?:ая|ые)\s+инструкци/i },
  { id: 'code_fence_role', regex: /(?:```|~~~)[\s\S]{0,40}(?:system|assistant|user)\s*:/i },
  { id: 'xml_role_tag', regex: /<\/?(?:system|assistant|instructions?|prompt)\s*>/i },
];

export interface SanitizeResult {
  readonly cleaned: string;
  readonly rejected: false;
  readonly reasons: string[];
}

export function sanitizeCustomPrompt(raw: string): SanitizeResult {
  const cleaned = (raw ?? '').slice(0, CUSTOM_PROMPT_MAX_LENGTH);
  const reasons: string[] = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.regex.test(cleaned)) {
      reasons.push(pattern.id);
    }
  }
  return { cleaned, rejected: false, reasons };
}
