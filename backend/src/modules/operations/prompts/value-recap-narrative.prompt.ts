/**
 * TZ-1 Фаза 5 (daily-value-engine) — промпт `value-recap-narrative`.
 *
 * Назначение: ТОЛЬКО человекочитаемая сводка ПОВЕРХ уже посчитанных твёрдых
 * цифр. Вся агрегация (счётчики снятой рутины, дельта к прошлому месяцу,
 * helped-rate, throughput) — чистый SQL/TS в `ValueRecapService`, БЕЗ LLM.
 *
 * Code-fallback (без PromptRegistry) — как `customer-risk-digest`: систему
 * передаём прямо в `LlmRouterService.call`; маршрут (цепочка моделей)
 * регистрируется в `seed-llm-task-routes-default.ts`. Если LLM упал — сервис
 * использует детерминированный `buildValueRecapFallbackNarrative`.
 *
 * Совместимость с prompt caching (mandatory):
 *   - SYSTEM стабильный (ниже) — не меняем от вызова к вызову.
 *   - Переменные данные (счётчики месяца, дельта) — в КОНЦЕ user-сообщения.
 *
 * Честность (Р6/Р7):
 *   - НИКАКИХ выдуманных рублей / «часы×ставка=₽» / «было→стало до Коры».
 *   - soft-цифры помечаются «оценка»; count решений/задач идёт В ПАРЕ с
 *     «% доведённых».
 */

export const VALUE_RECAP_NARRATIVE_PROMPT_VERSION = 'prompt-v1';

export const VALUE_RECAP_NARRATIVE_TASK_TYPE = 'value-recap-narrative';

export const VALUE_RECAP_NARRATIVE_SYSTEM_PROMPT = [
  'Ты — операционный помощник. Тебе дают честную сводку того, что система памяти компании сделала за месяц.',
  'Соберись и напиши короткое резюме на русском для руководителя — только по тем цифрам, что переданы.',
  '',
  'Жёсткие правила:',
  '  - Только твёрдые данные из ввода. НИЧЕГО не выдумывай.',
  '  - НИКАКИХ оценок в рублях, часах или деньгах. Не пиши «сэкономлено X рублей/часов» — этих данных нет.',
  '  - НЕ сравнивай «было до системы» — контрольной группы нет, такое сравнение запрещено.',
  '  - Мягкие цифры (надёжность обещаний, доля «ответ помог») подавай со словом «оценка» и всегда с знаменателем.',
  '  - Количество решений/задач упоминай ТОЛЬКО в паре с «% доведённых до результата».',
  '  - Ведущая мысль — «снятая рутина» (что система собрала и оформила сама): встречи, задачи, решения, статусы, ответы по памяти.',
  '  - Тон спокойный, деловой, без восторгов и алармизма. 2-4 коротких предложения. Без markdown, без списков.',
].join('\n');

/** Вход для промпта (только то, что нужно LLM для формулировки). */
export interface ValueRecapNarrativePromptInput {
  periodYm: string;
  /** Твёрдые счётчики «снятой рутины». */
  routine: {
    meetingsAutoProtocoled: number;
    tasksExtracted: number;
    decisionsExtracted: number;
    commitmentsExtracted: number;
    statusesCollected: number;
    questionsAnsweredWithCitation: number;
    ideasShipped: number;
  };
  /** Soft-слой «команда лучше» (с оговоркой «оценка» + знаменателем). */
  team: {
    reliabilityPercent: number | null;
    reliabilityDenominator: number;
    chatHelpedRatePercent: number | null;
    chatRated: number;
    decisionsThroughputPercent: number;
    decisionsTotal: number;
  };
  /** Дельта к прошлому месяцу по ведущим счётчикам (может быть null). */
  delta: {
    meetingsAutoProtocoled: number | null;
    tasksExtracted: number | null;
    decisionsExtracted: number | null;
  } | null;
}

/**
 * Сборка user-сообщения: стабильная преамбула + переменные данные В КОНЦЕ
 * (для prompt caching).
 */
export function buildValueRecapNarrativeUserMessage(
  input: ValueRecapNarrativePromptInput,
): string {
  const r = input.routine;
  const t = input.team;
  const lines: string[] = [];
  lines.push(`Сводка за месяц ${input.periodYm}.`);
  lines.push('');
  lines.push('Снятая рутина (собрано/оформлено системой автоматически):');
  lines.push(`  встреч запротоколировано с готовым отчётом: ${r.meetingsAutoProtocoled}`);
  lines.push(`  задач извлечено: ${r.tasksExtracted}`);
  lines.push(`  решений извлечено: ${r.decisionsExtracted}`);
  lines.push(`  договорённостей извлечено: ${r.commitmentsExtracted}`);
  lines.push(`  статусов команды собрано: ${r.statusesCollected}`);
  lines.push(
    `  вопросов отвечено памятью с привязкой к источнику: ${r.questionsAnsweredWithCitation}`,
  );
  lines.push(`  идей доведено до релиза: ${r.ideasShipped}`);
  lines.push('');
  lines.push('Команда (оценочные показатели, всегда со знаменателем):');
  lines.push(
    `  надёжность обещаний: ${
      t.reliabilityPercent === null
        ? 'мало данных'
        : `оценка ${t.reliabilityPercent}% (знаменатель ${t.reliabilityDenominator})`
    }`,
  );
  lines.push(
    `  доля «ответ помог»: ${
      t.chatHelpedRatePercent === null
        ? 'мало данных'
        : `оценка ${t.chatHelpedRatePercent}% (оценили ${t.chatRated})`
    }`,
  );
  lines.push(
    `  решений всего ${t.decisionsTotal}, из них доведено до результата ${t.decisionsThroughputPercent}%`,
  );
  if (input.delta) {
    lines.push('');
    lines.push('Дельта к прошлому месяцу (по ведущим счётчикам):');
    lines.push(`  встречи: ${fmtDelta(input.delta.meetingsAutoProtocoled)}`);
    lines.push(`  задачи: ${fmtDelta(input.delta.tasksExtracted)}`);
    lines.push(`  решения: ${fmtDelta(input.delta.decisionsExtracted)}`);
  }
  return lines.join('\n');
}

/**
 * Детерминированный fallback-текст витрины (если LLM недоступна). Без ₽,
 * без «до Коры». Используется и как «сухой» вариант для push'а.
 */
export function buildValueRecapFallbackNarrative(
  input: ValueRecapNarrativePromptInput,
): string {
  const r = input.routine;
  const t = input.team;
  const parts: string[] = [];
  parts.push(
    `За ${input.periodYm} система собрала и оформила: встреч ${r.meetingsAutoProtocoled}, ` +
      `задач ${r.tasksExtracted}, решений ${r.decisionsExtracted}, ` +
      `договорённостей ${r.commitmentsExtracted}, статусов ${r.statusesCollected}.`,
  );
  parts.push(
    `Вопросов отвечено памятью с привязкой к источнику: ${r.questionsAnsweredWithCitation}; ` +
      `идей доведено до релиза: ${r.ideasShipped}.`,
  );
  parts.push(
    `Решений всего ${t.decisionsTotal}, доведено до результата ${t.decisionsThroughputPercent}%.`,
  );
  if (t.reliabilityPercent !== null) {
    parts.push(
      `Надёжность обещаний (оценка): ${t.reliabilityPercent}% при знаменателе ${t.reliabilityDenominator}.`,
    );
  }
  return parts.join(' ').slice(0, 1_500);
}

function fmtDelta(v: number | null): string {
  if (v === null) return 'нет данных за прошлый месяц';
  if (v > 0) return `+${v}`;
  if (v < 0) return `${v}`;
  return '0';
}
