import { withAsrNote, withConfidenceCalibration } from '../../ai/services/prompts/common';

export const GOAL_HIERARCHY_LINK_SYSTEM_PROMPT = withAsrNote(
  withConfidenceCalibration(
    [
      'Ты — knowledge-куратор по целям компании. Тебе дают новую цель-черновик и список ближайших существующих целей.',
      'Реши, чем является новая цель относительно существующих:',
      '- duplicate — это та же самая цель, что одна из существующих (по смыслу совпадает). Укажи её id в targetId. Новую цель создавать НЕ нужно.',
      '- child_of — это подцель (декомпозиция) одной из существующих. Укажи id родителя в parentId.',
      '- standalone — самостоятельная цель, не дубликат и не подцель ни одной из списка.',
      '',
      'Правило иерархии: подцель ⊂ родителя по смыслу И по горизонту. Более короткий горизонт обычно вложен в более длинный: sprint ⊂ monthly ⊂ quarterly ⊂ annual ⊂ strategic.',
      'Например, «провести 100 встреч за квартал» (quarterly) может быть подцелью «вырасти в выручке за год» (annual).',
      'Не объявляй child_of только из-за общей темы — нужна реальная связь «эта цель продвигает ту».',
      'Если ни один кандидат не совпадает и не является родителем — verdict=standalone, targetId=null, parentId=null.',
      '',
      'Отвечай строго в формате JSON по предоставленной схеме на русском языке.',
    ].join('\n'),
  ),
);

export const GOAL_HIERARCHY_LINK_USER_TEMPLATE = (args: {
  draftStatement: string;
  draftHorizon: string;
  candidates: ReadonlyArray<{
    id: string;
    name: string;
    horizon: string;
    description: string | null;
  }>;
}): string => {
  const lines = [
    'Новая цель-черновик:',
    `«${args.draftStatement}» (горизонт=${args.draftHorizon})`,
    '',
    'Ближайшие существующие цели:',
  ];
  if (args.candidates.length === 0) {
    lines.push('  (нет — реши standalone)');
  } else {
    args.candidates.forEach((c, idx) => {
      lines.push(`  ${idx + 1}. [${c.id}] «${c.name}» (горизонт=${c.horizon})`);
      if (c.description) lines.push(`     ${c.description}`);
    });
  }
  lines.push('', 'Верни JSON по схеме `goal_hierarchy_link_v1`.');
  return lines.join('\n');
};

export const GOAL_HIERARCHY_LINK_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'confidence'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['duplicate', 'child_of', 'standalone'],
    },
    targetId: { type: ['string', 'null'] },
    parentId: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: ['string', 'null'], maxLength: 2_000 },
  },
};

export const GOAL_HIERARCHY_LINK_SCHEMA_NAME = 'goal_hierarchy_link_v1';
