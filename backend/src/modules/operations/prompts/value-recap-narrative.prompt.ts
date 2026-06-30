export const VALUE_RECAP_NARRATIVE_TASK_TYPE = 'value-recap-narrative';

export const VALUE_RECAP_NARRATIVE_SYSTEM_PROMPT = [
  'Ты — операционный помощник. Тебе дают честную сводку того, что система памяти компании сделала за месяц.',
  'Соберись и напиши короткое резюме на русском для руководителя — только по тем цифрам, что переданы.',
  '',
  'Жёсткие правила:',
  '  - Только твёрдые данные из ввода. НИЧЕГО не выдумывай.',
  '  - НИКАКИХ оценок в рублях, часах или деньгах. Не пиши «сэкономлено X рублей/часов» — этих данных нет.',
  '  - НЕ сравнивай «было до системы» — контрольной группы нет, такое сравнение запрещено.',
  '  - Мягкие цифры (доля «ответ помог») подавай со словом «оценка» и всегда с знаменателем.',
  '  - Ведущая мысль — «снятая рутина» (что система собрала и оформила сама): встречи, задачи, решения, статусы, ответы по памяти.',
  '  - Тон спокойный, деловой, без восторгов и алармизма. 2-4 коротких предложения. Без markdown, без списков.',
].join('\n');

export interface ValueRecapNarrativePromptInput {
  periodYm: string;
  routine: {
    meetingsAutoProtocoled: number;
    tasksExtracted: number;
    decisionsExtracted: number;
    commitmentsExtracted: number;
    statusesCollected: number;
    questionsAnsweredWithCitation: number;
    ideasShipped: number;
  };
  team: {
    chatHelpedRatePercent: number | null;
    chatRated: number;
  };
  delta: {
    meetingsAutoProtocoled: number | null;
    tasksExtracted: number | null;
    decisionsExtracted: number | null;
  } | null;
}

export function buildValueRecapNarrativeUserMessage(input: ValueRecapNarrativePromptInput): string {
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
    `  доля «ответ помог»: ${
      t.chatHelpedRatePercent === null
        ? 'мало данных'
        : `оценка ${t.chatHelpedRatePercent}% (оценили ${t.chatRated})`
    }`,
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

export function buildValueRecapFallbackNarrative(input: ValueRecapNarrativePromptInput): string {
  const r = input.routine;
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
  return parts.join(' ').slice(0, 1_500);
}

function fmtDelta(v: number | null): string {
  if (v === null) return 'нет данных за прошлый месяц';
  if (v > 0) return `+${v}`;
  if (v < 0) return `${v}`;
  return '0';
}
