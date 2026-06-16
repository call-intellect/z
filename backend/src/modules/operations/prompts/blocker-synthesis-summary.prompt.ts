export const BLOCKER_SYNTHESIS_SUMMARY_TASK_TYPE = 'blocker-synthesis-summary';

export const BLOCKER_SYNTHESIS_SUMMARY_SYSTEM_PROMPT = [
  'Ты — операционный помощник. Тебе дают сводку блокеров команды за день: какие новые, какие повторяются несколько дней, какие закрылись.',
  'Твоя задача — двумя-тремя короткими фразами на русском подсказать руководителю, на что обратить внимание в первую очередь.',
  '',
  'Жёсткие правила:',
  '  - Только то, что есть в данных. Не додумывай факты.',
  '  - НИКАКИХ оценок в рублях, часах или деньгах — их в данных нет, выдумывать запрещено.',
  '  - Приоритет — хроническим (повторяющимся) блокерам и тем, что задевают клиента/дедлайн/обещание.',
  '  - Без воды и преамбулы. Сразу суть.',
  '  - Тон спокойный, деловой. Не алармизм.',
  '  - Длина — 2-3 предложения, максимум ~360 символов. Без markdown, без списков.',
].join('\n');

export interface BlockerSynthesisSummaryItem {
  text: string;
  status: 'new' | 'recurring' | 'resolved';
  daysOpen: number;
  highImpact: boolean;
}

export interface BlockerSynthesisSummaryPromptInput {
  items: BlockerSynthesisSummaryItem[];
  newCount: number;
  recurringCount: number;
  resolvedCount: number;
}

export function buildBlockerSynthesisSummaryUserMessage(
  input: BlockerSynthesisSummaryPromptInput,
): string {
  const lines: string[] = [];
  lines.push('Сводка блокеров команды за день:');
  lines.push(
    `  новых ${input.newCount}, повторяющихся ${input.recurringCount}, закрылось ${input.resolvedCount}`,
  );
  if (input.items.length > 0) {
    lines.push('  ключевые блокеры:');
    for (const it of input.items.slice(0, 6)) {
      const statusRu =
        it.status === 'recurring'
          ? `повторяется ${it.daysOpen} дн.`
          : it.status === 'resolved'
            ? 'закрылся'
            : 'новый';
      const impact = it.highImpact ? ', высокий импакт' : '';
      lines.push(`    - ${truncate(it.text, 160)} (${statusRu}${impact})`);
    }
  }
  return lines.join('\n');
}

export function buildBlockerSynthesisFallbackSummary(
  input: BlockerSynthesisSummaryPromptInput,
): string {
  if (input.newCount === 0 && input.recurringCount === 0 && input.resolvedCount === 0) {
    return 'Активных блокеров за день не зафиксировано.';
  }
  const parts: string[] = [];
  parts.push(
    `Блокеров: новых ${input.newCount}, повторяющихся ${input.recurringCount}, закрылось ${input.resolvedCount}.`,
  );
  const chronic = input.items.find((i) => i.status === 'recurring');
  const highImpact = input.items.find((i) => i.highImpact);
  if (chronic) {
    parts.push(
      `Дольше всего держится: «${truncate(chronic.text, 80)}» (${chronic.daysOpen} дн.) — стоит разобрать.`,
    );
  } else if (highImpact) {
    parts.push(`Высокий приоритет: «${truncate(highImpact.text, 80)}» — задевает клиента/дедлайн.`);
  }
  return parts.join(' ').slice(0, 360);
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
