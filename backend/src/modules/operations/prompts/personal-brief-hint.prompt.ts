export const PERSONAL_BRIEF_HINT_TASK_TYPE = 'personal-brief-hint';

export const PERSONAL_BRIEF_HINT_SYSTEM_PROMPT = [
  'Ты — личный операционный помощник сотрудника. Тебе дают краткую сводку его дня:',
  'задачи на сегодня/просроченные, его обещания, открытые блокеры, что ему обещали.',
  'Твоя задача — одной короткой фразой на русском подсказать, на чём сфокусироваться сегодня.',
  '',
  'Жёсткие правила:',
  '  - Только то, что есть в данных. Не додумывай факты, имена, сроки.',
  '  - НИКАКИХ оценок в рублях, часах или деньгах.',
  '  - Без воды и преамбулы. Сразу суть: что важнее всего сделать первым.',
  '  - Тон спокойный, дружелюбный, на «ты». Не алармизм, не нравоучения.',
  '  - Длина — одно предложение, максимум ~200 символов. Без markdown, без списков.',
].join('\n');

export interface PersonalBriefHintPromptInput {
  taskCount: number;
  overdueTaskCount: number;
  promiseCount: number;
  blockerCount: number;
  promisedToMeCount: number;
  topTaskTitles: string[];
  topBlockerTexts: string[];
  knowsWhoExpertName?: string | null;
}

export function buildPersonalBriefHintUserMessage(input: PersonalBriefHintPromptInput): string {
  const lines: string[] = [];
  lines.push('Сводка дня сотрудника:');
  lines.push(`  задачи: ${input.taskCount} (из них просрочено ${input.overdueTaskCount})`);
  lines.push(`  мои обещания на сегодня/просроченные: ${input.promiseCount}`);
  lines.push(`  открытые блокеры: ${input.blockerCount}`);
  lines.push(`  обещано мне: ${input.promisedToMeCount}`);
  if (input.topTaskTitles.length > 0) {
    lines.push('  топ-задачи:');
    for (const t of input.topTaskTitles.slice(0, 3)) {
      lines.push(`    - ${truncate(t, 120)}`);
    }
  }
  if (input.topBlockerTexts.length > 0) {
    lines.push('  блокеры:');
    for (const b of input.topBlockerTexts.slice(0, 2)) {
      lines.push(`    - ${truncate(b, 120)}`);
    }
  }
  if (input.knowsWhoExpertName) {
    lines.push(`  по блокеру может помочь: ${truncate(input.knowsWhoExpertName, 80)}`);
  }
  return lines.join('\n');
}

export function buildPersonalBriefFallbackHint(input: PersonalBriefHintPromptInput): string {
  if (input.overdueTaskCount > 0) {
    return `Сначала разберись с просроченным: задач в просрочке ${input.overdueTaskCount}.`.slice(
      0,
      200,
    );
  }
  if (input.blockerCount > 0) {
    if (input.knowsWhoExpertName) {
      return `По твоему блокеру может помочь ${truncate(
        input.knowsWhoExpertName,
        80,
      )} — стоит связаться.`.slice(0, 200);
    }
    return `Есть открытые блокеры (${input.blockerCount}) — попробуй снять их в первую очередь.`.slice(
      0,
      200,
    );
  }
  if (input.taskCount > 0) {
    return `На сегодня ${input.taskCount} задач — начни с самой важной.`.slice(0, 200);
  }
  if (input.promiseCount > 0) {
    return `Не забудь про свои обещания на сегодня (${input.promiseCount}).`.slice(0, 200);
  }
  if (input.promisedToMeCount > 0) {
    return `Тебе обещали ${input.promisedToMeCount} — можно мягко напомнить коллегам.`.slice(
      0,
      200,
    );
  }
  return 'На сегодня срочных дел в памяти нет — хороший день спланировать наперёд.';
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
