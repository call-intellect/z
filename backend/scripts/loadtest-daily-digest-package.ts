import type { DailyDigestMetricsDto } from '../src/modules/operations/dto/daily-digest.dto';
import {
  buildDayCompanyUserMessage,
  type DayCompanyPackage,
  type DayCompanyRawConversations,
  type DayCompanyRawSession,
  type DayCompanyRawTurn,
} from '../src/modules/operations/prompts/daily-digest.prompt';

const RAW_CHAR_BUDGET = 40_000;
const TOKENS_PER_CHAR = 1 / 3.5;

const SESSIONS = 3;
const TURNS_PER_SESSION = 50;
const TURN_TEXT_LEN = 400;
const PERSONS = 10;
const SIGNALS_EACH = 12;
const CONFLICTS = 5;
const PER_PERSON = 10;

function repeatText(seed: string, len: number): string {
  let s = '';
  while (s.length < len) s += seed;
  return s.slice(0, len);
}

function buildRawSession(channel: string, idx: number): DayCompanyRawSession {
  const turns: DayCompanyRawTurn[] = [];
  for (let t = 0; t < TURNS_PER_SESSION; t++) {
    const isClient = t % 2 === 0;
    turns.push({
      author: isClient ? `Клиент ${channel}-${idx}` : `Менеджер ${channel}-${idx}`,
      personId: isClient ? null : `person-${channel}-${idx}`,
      isClient,
      ts: `2026-06-30T${String(8 + (t % 12)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}:00Z`,
      text: repeatText(
        `Сообщение ${channel} сессия ${idx} реплика ${t}: обсуждаем интеграцию, оплату коннекторов, статус клиента и сроки поставки задач. `,
        TURN_TEXT_LEN,
      ),
    });
  }
  return { session: `${channel} · сделка/чат ${idx}`, turns };
}

function buildRawConversations(): DayCompanyRawConversations {
  const bitrix: DayCompanyRawSession[] = [];
  const chatbox: DayCompanyRawSession[] = [];
  for (let i = 0; i < SESSIONS; i++) {
    bitrix.push(buildRawSession('bitrix', i));
    chatbox.push(buildRawSession('chatbox', i));
  }
  return { bitrix, chatbox };
}

function sumTurnsChars(sessions: DayCompanyRawSession[]): number {
  let sum = 0;
  for (const s of sessions) {
    for (const t of s.turns) sum += t.text.length;
  }
  return sum;
}

function trimRawConversations(
  conversations: DayCompanyRawConversations,
  budget: number,
): DayCompanyRawConversations {
  const total =
    sumTurnsChars(conversations.bitrix) + sumTurnsChars(conversations.chatbox);
  if (total <= budget) return conversations;

  const flat: Array<{ channel: 'bitrix' | 'chatbox'; session: string; turn: DayCompanyRawTurn }> =
    [];
  for (const s of conversations.bitrix) {
    for (const t of s.turns) flat.push({ channel: 'bitrix', session: s.session, turn: t });
  }
  for (const s of conversations.chatbox) {
    for (const t of s.turns) flat.push({ channel: 'chatbox', session: s.session, turn: t });
  }
  flat.sort((a, b) => a.turn.ts.localeCompare(b.turn.ts));

  let used = flat.reduce((acc, x) => acc + x.turn.text.length, 0);
  let cut = 0;
  while (used > budget && cut < flat.length) {
    used -= flat[cut]!.turn.text.length;
    cut++;
  }
  const kept = flat.slice(cut);

  const rebuild = (channel: 'bitrix' | 'chatbox'): DayCompanyRawSession[] => {
    const bySession = new Map<string, DayCompanyRawTurn[]>();
    for (const x of kept) {
      if (x.channel !== channel) continue;
      const turns = bySession.get(x.session);
      if (turns) turns.push(x.turn);
      else bySession.set(x.session, [x.turn]);
    }
    return Array.from(bySession, ([session, turns]) => ({ session, turns }));
  };

  return { bitrix: rebuild('bitrix'), chatbox: rebuild('chatbox') };
}

function buildMetrics(): DailyDigestMetricsDto {
  return {
    totalCheckIns: PER_PERSON,
    greenShare: 0.4,
    yellowShare: 0.4,
    redShare: 0.2,
    topRedCheckIns: Array.from({ length: 3 }, (_, i) => ({
      checkInId: `ci-${i}`,
      personName: `Сотрудник ${i}`,
      excerpt: repeatText('красный чек-ин, застряли на блокере оплаты. ', 120),
    })),
    newBlockers: Array.from({ length: SIGNALS_EACH }, (_, i) => ({
      blockId: `blk-${i}`,
      name: `Блокер ${i}: оплата коннекторов не снята`,
      confidence: 0.7,
    })),
    goals: {
      completed: 1,
      failed: 0,
      activated: 2,
      completedIds: ['g-1'],
      failedIds: [],
    },
    newHighInsights: Array.from({ length: SIGNALS_EACH }, (_, i) => ({
      insightId: `ins-${i}`,
      statement: `Риск ${i}: клиент на грани, ждёт ответа поддержки более суток`,
      kind: i % 2 === 0 ? 'risk' : 'blocker',
      causeCategory: 'communication',
    })),
  };
}

function buildPackage(raw: DayCompanyRawConversations): DayCompanyPackage {
  const dateLocal = '2026-06-30';
  return {
    dateLocal,
    goalId: 'goal-1',
    goalName: 'Запустить 10 интеграций для пилотов',
    meetings: Array.from({ length: 6 }, (_, i) => ({
      id: `m-${i}`,
      title: `Встреча ${i}: синк по интеграциям`,
      summary: repeatText(`Обсудили статус интеграции ${i}, блокеры и следующие шаги. `, 500),
    })),
    topInsights: Array.from({ length: 5 }, (_, i) => ({
      id: `ti-${i}`,
      statement: `Важный риск ${i}: незаменимость владельца по критичным задачам`,
      severity: 'high',
      kind: 'risk',
    })),
    topIdeas: Array.from({ length: 5 }, (_, i) => ({
      id: `tidea-${i}`,
      statement: `Идея ${i}: авто-карточка клиента из переписки`,
      weight: 0.8,
      supporterCount: 3,
    })),
    customersAtRisk: Array.from({ length: 5 }, (_, i) => ({
      customerName: `Клиент ${i}`,
      riskLevel: 'high',
      signals: 'молчание поддержки, ждёт более суток',
    })),
    compass: {
      goalName: 'Запустить 10 интеграций для пилотов',
      score: 46,
      delta: 1,
      explanation: repeatText('Запущен первый тест, но блокер оплаты съедает темп. ', 300),
      pro: ['запущен 1-й из 10 тестов', 'согласованы условия с подрядчиком'],
      contra: ['блокер оплаты 6-й день', 'КП не ушло'],
    },
    yesterday: {
      state: 'warn',
      title: 'День с трением',
      shortSummary: 'Вчера клиент на грани, оплата застряла.',
    },
    employeeVoice: Array.from({ length: PERSONS }, (_, i) => ({
      personId: `person-${i}`,
      personName: `Сотрудник ${i}`,
      ideas: [
        { text: `Идея сотрудника ${i}: чек-лист онбординга клиента`, signalType: 'idea' },
      ],
      risks: [
        { text: `Риск от сотрудника ${i}: клиент недоволен сроками`, signalType: 'risk' },
      ],
      other: [
        { text: `Прочее от сотрудника ${i}: нужен доступ к CRM`, signalType: 'note' },
      ],
    })),
    rawConversations: raw,
    signals: {
      blockers: Array.from({ length: SIGNALS_EACH }, (_, i) => ({
        text: `Блокер ${i}: оплата коннекторов не снята`,
        confidence: 0.7,
      })),
      risks: Array.from({ length: SIGNALS_EACH }, (_, i) => ({
        text: `Риск ${i}: молчание поддержки по клиенту`,
        causeCategory: 'communication',
        dynamicLabel: i % 2 === 0 ? 'growing' : 'stable',
        observations: 3 + i,
        frequencyScore: 0.5,
        status: 'open',
        severity: 'high',
      })),
      ideas: Array.from({ length: SIGNALS_EACH }, (_, i) => ({
        text: `Идея ${i}: авто-карточка клиента`,
        supporterCount: 3,
        weight: 0.8,
        status: 'proposed',
        clusterId: `cluster-${i % 3}`,
      })),
    },
    conflicts: Array.from({ length: CONFLICTS }, (_, i) => ({
      fromPersonName: `Сотрудник ${i}`,
      toPersonName: `Сотрудник ${i + 1}`,
      confidence: 0.7,
      explanation: `Спор ${i}, кто ведёт клиента после сделки`,
      since: '2026-06-30T09:00:00Z',
    })),
    reporting: {
      planSubmitted: { done: 5, total: 6 },
      reportSubmitted: { done: 3, total: 6 },
      perPerson: Array.from({ length: PER_PERSON }, (_, i) => ({
        personName: `Сотрудник ${i}`,
        planSubmitted: i % 3 !== 0,
        reportSubmitted: i % 2 === 0,
        planned: 4,
        done: i % 4,
        mismatchReason: i % 4 === 0 ? 'ждёт данные от смежников' : undefined,
      })),
      noReport: ['Сотрудник 1', 'Сотрудник 3', 'Сотрудник 5'],
      tasksSet: 24,
      tasksDone: 11,
      dayPlan: { done: 5, total: 6 },
    },
    yesterdayOpenSignals: Array.from({ length: 6 }, (_, i) => ({
      text: `Вчерашний открытый сигнал ${i}: клиент ждёт ответа`,
      axis: i % 2 === 0 ? 'clients' : 'team',
      state: 'warn',
    })),
  };
}

function main(): void {
  console.log('=== loadtest-daily-digest-package START ===');

  const metrics = buildMetrics();
  const dateLocal = '2026-06-30';

  const rawFull = buildRawConversations();
  const rawChars = sumTurnsChars(rawFull.bitrix) + sumTurnsChars(rawFull.chatbox);

  const msgNoTrim = buildDayCompanyUserMessage(buildPackage(rawFull), metrics, dateLocal);

  const rawTrimmed = trimRawConversations(rawFull, RAW_CHAR_BUDGET);
  const trimmedRawChars = sumTurnsChars(rawTrimmed.bitrix) + sumTurnsChars(rawTrimmed.chatbox);
  const msgTrimmed = buildDayCompanyUserMessage(buildPackage(rawTrimmed), metrics, dateLocal);

  const tokensNoTrim = Math.ceil(msgNoTrim.length * TOKENS_PER_CHAR);
  const tokensTrimmed = Math.ceil(msgTrimmed.length * TOKENS_PER_CHAR);

  console.log('');
  console.log('--- ВХОДНОЕ СЫРЬЁ (Битрикс+чатбокс) ---');
  console.log(
    `  сессий: ${SESSIONS * 2} (по ${TURNS_PER_SESSION} turn'ов, ~${TURN_TEXT_LEN} символов каждый)`,
  );
  console.log(`  сырьё БЕЗ обрезки: ${rawChars} символов`);
  console.log(`  бюджет raw_char_budget: ${RAW_CHAR_BUDGET} символов`);
  console.log(`  сырьё ПОСЛЕ обрезки: ${trimmedRawChars} символов`);
  console.log(`  обрезка сработала: ${trimmedRawChars <= RAW_CHAR_BUDGET ? 'ДА (≤ бюджета)' : 'НЕТ'}`);

  console.log('');
  console.log('--- ИТОГОВЫЙ userMessage (весь промпт-хвост) ---');
  console.log(`  БЕЗ обрезки сырья: ${msgNoTrim.length} символов ≈ ${tokensNoTrim} токенов`);
  console.log(`  С обрезкой (бюджет ${RAW_CHAR_BUDGET}): ${msgTrimmed.length} символов ≈ ${tokensTrimmed} токенов`);

  const CONTEXT_TOKEN_LIMIT = 128_000;
  const fitsNoTrim = tokensNoTrim <= CONTEXT_TOKEN_LIMIT;
  const fitsTrimmed = tokensTrimmed <= CONTEXT_TOKEN_LIMIT;

  console.log('');
  console.log('--- ВЕРДИКТ ---');
  console.log(`  ориентир контекста модели: ${CONTEXT_TOKEN_LIMIT} токенов`);
  console.log(
    `  БЕЗ обрезки: ${fitsNoTrim ? 'укладывается' : 'НЕ укладывается — нужна обрезка'} (${tokensNoTrim} токенов)`,
  );
  console.log(
    `  С обрезкой: ${fitsTrimmed ? 'укладывается' : 'НЕ укладывается'} (${tokensTrimmed} токенов)`,
  );
  console.log(
    `  страховочная обрезка ${trimmedRawChars < rawChars ? 'РЕАЛЬНО ограничила сырьё' : 'не потребовалась'} ` +
      `(${rawChars} → ${trimmedRawChars} символов).`,
  );

  console.log('');
  console.log('=== loadtest-daily-digest-package DONE ===');
}

main();
