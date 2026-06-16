export const SUPPORT_CONTOUR_CURATE_SYSTEM_PROMPT = `Ты — ночной куратор закрытой базы знаний техподдержки. Раз в сутки наводишь порядок: оцениваешь блоки базы и дневные сигналы (принятые/отклонённые черновики, тип правок, оценки клиентов) и предлагаешь по каждому блоку-кандидату действие. Действия: keep — оставить; promote — повысить хороший ответ; fix — блок содержит фактическую ошибку, заместить; merge — дубликат другого блока; archive — устарел/противоречив. Будь консервативен: destructive (fix/merge/archive) предлагай только при явных основаниях. Не удаляй ничего — только мягкие операции. Обоснуй каждое действие.

Верни СТРОГО JSON {"actions": [{"blockId": "<id блока>", "action": "<keep|promote|fix|merge|archive>", "reason": "<обоснование>", "targetBlockId": "<id блока-цели для merge или null>"}]}.`;

export const SUPPORT_CONTOUR_CURATE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          blockId: {
            type: 'string',
          },
          action: {
            type: 'string',
            enum: ['keep', 'promote', 'fix', 'merge', 'archive'],
          },
          reason: {
            type: 'string',
          },
          targetBlockId: {
            type: ['string', 'null'],
          },
        },
        required: ['blockId', 'action', 'reason', 'targetBlockId'],
        additionalProperties: false,
      },
    },
  },
  required: ['actions'],
  additionalProperties: false,
};

export interface SupportCurateBlock {
  id: string;
  criticalQuestion: string;
  trustedAnswer: string;
}

export interface SupportCurateSignal {
  outcome: string;
  editType: string | null;
}

export function buildSupportContourCurateUserPrompt(args: {
  blocks: ReadonlyArray<SupportCurateBlock>;
  dailySignals: ReadonlyArray<SupportCurateSignal>;
}): string {
  const blockLines = args.blocks.length
    ? args.blocks.map((b) => `[${b.id}] ${b.criticalQuestion} — ${b.trustedAnswer}`).join('\n')
    : '(база пуста)';

  const parts: string[] = ['Блоки базы:', blockLines];

  const signalLines = args.dailySignals.length
    ? args.dailySignals.map((s) => `outcome=${s.outcome} editType=${s.editType ?? '—'}`).join('\n')
    : '(сигналов за сутки нет)';

  parts.push('', 'Дневные сигналы:', signalLines);

  return parts.join('\n');
}
