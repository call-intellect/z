/**
 * Демо-данные «ТехноСтрим» — Helpfulness/Contribution/Spotlight.
 *
 * Требует `ids.users` (создаются в `seedUsers`). Helpfulness-семейство
 * ссылается на User.id (не Person.id).
 *
 * Создаёт:
 *  - HelpfulnessTrait × 25 (по 5 на ключевого User'а)
 *  - HelpfulnessSpotlight × 5 (status='published')
 *  - SocialContributionProfile × 5
 *  - ContributionSnapshot × 5
 */
import type { SeedFn } from './types';
import { daysAgo, req } from './types';

const TRAITS: Array<{
  helperKey: 'morozov' | 'volkova' | 'kozlov' | 'sokolova' | 'petrova';
  /** recipientKey может ссылаться на любой ключ Person (включая тех, у кого
   *  нет User-аккаунта — `novikov`, `sidorov`, `lebedev`); в этом случае
   *  recipientUserId будет null (см. логику ниже). */
  recipientKey: string | null;
  traitType: string;
  intensity: string;
  topicHint: string;
  confidence: string;
  visibility: string;
  evidenceQuote: string;
  observedDaysAgo: number;
}> = [
  // — Дмитрий Козлов (helper) —
  {
    helperKey: 'kozlov', recipientKey: 'novikov', traitType: 'mentoring',
    intensity: '0.850', topicHint: 'OAuth2 архитектура', confidence: '0.900',
    visibility: 'public_team',
    evidenceQuote: 'Проводил парное программирование 3 дня — Игорь освоил рефакторинг auth-сервиса.',
    observedDaysAgo: 4,
  },
  {
    helperKey: 'kozlov', recipientKey: 'sokolova', traitType: 'help_provided',
    intensity: '0.700', topicHint: 'Demo стенд для Ростелекома', confidence: '0.850',
    visibility: 'public_team',
    evidenceQuote: 'Развернул отдельный demo-стенд для Ростелекома за один вечер.',
    observedDaysAgo: 5,
  },
  {
    helperKey: 'kozlov', recipientKey: 'novikov', traitType: 'constructive_feedback',
    intensity: '0.800', topicHint: 'Code review', confidence: '0.900',
    visibility: 'public_team',
    evidenceQuote: 'Каждый PR — детальный review с примерами «как лучше».',
    observedDaysAgo: 3,
  },
  {
    helperKey: 'kozlov', recipientKey: null, traitType: 'proactive_hint',
    intensity: '0.750', topicHint: 'Security advisories', confidence: '0.800',
    visibility: 'internal',
    evidenceQuote: 'Заранее предупредил команду про новую уязвимость в JWT.',
    observedDaysAgo: 8,
  },
  {
    helperKey: 'kozlov', recipientKey: 'sidorov', traitType: 'help_provided',
    intensity: '0.650', topicHint: 'TypeScript типы для API', confidence: '0.800',
    visibility: 'public_team',
    evidenceQuote: 'Помог разобраться с generic-типами для API-клиента.',
    observedDaysAgo: 11,
  },

  // — Марина Волкова (helper) —
  {
    helperKey: 'volkova', recipientKey: 'petrova', traitType: 'mentoring',
    intensity: '0.800', topicHint: 'Дизайн-ревью и приоритизация', confidence: '0.850',
    visibility: 'public_team',
    evidenceQuote: 'Каждую неделю проводит дизайн-ревью с Анной — помогает приоритезировать.',
    observedDaysAgo: 6,
  },
  {
    helperKey: 'volkova', recipientKey: 'sokolova', traitType: 'help_provided',
    intensity: '0.700', topicHint: 'CustDev скрипт', confidence: '0.850',
    visibility: 'public_team',
    evidenceQuote: 'Подготовила готовый скрипт CustDev для звонка с Ростелекомом.',
    observedDaysAgo: 9,
  },
  {
    helperKey: 'volkova', recipientKey: null, traitType: 'emotional_support',
    intensity: '0.650', topicHint: 'Поддержка после стрессовой недели', confidence: '0.700',
    visibility: 'restricted',
    evidenceQuote: 'Сказала команде взять day-off после релизного марафона.',
    observedDaysAgo: 12,
  },
  {
    helperKey: 'volkova', recipientKey: 'morozov', traitType: 'constructive_feedback',
    intensity: '0.750', topicHint: 'Roadmap чёткость', confidence: '0.800',
    visibility: 'internal',
    evidenceQuote: 'Указала на размытость Q3 roadmap — попросила KPI на каждый эпик.',
    observedDaysAgo: 7,
  },
  {
    helperKey: 'volkova', recipientKey: null, traitType: 'proactive_hint',
    intensity: '0.600', topicHint: 'Тренд оттока', confidence: '0.750',
    visibility: 'internal',
    evidenceQuote: 'Раньше всех заметила тренд на churn в SMB-сегменте.',
    observedDaysAgo: 14,
  },

  // — Екатерина Соколова (helper) —
  {
    helperKey: 'sokolova', recipientKey: 'lebedev', traitType: 'mentoring',
    intensity: '0.800', topicHint: 'B2B-продажи', confidence: '0.850',
    visibility: 'public_team',
    evidenceQuote: 'Шадоувила Виктора 3 встречи — он быстро вышел на самостоятельные демо.',
    observedDaysAgo: 5,
  },
  {
    helperKey: 'sokolova', recipientKey: 'morozov', traitType: 'help_provided',
    intensity: '0.700', topicHint: 'Подготовка к борду', confidence: '0.850',
    visibility: 'public_team',
    evidenceQuote: 'Собрала кейс-стори клиентов для презентации совету директоров.',
    observedDaysAgo: 8,
  },
  {
    helperKey: 'sokolova', recipientKey: null, traitType: 'proactive_hint',
    intensity: '0.650', topicHint: 'Конкуренты', confidence: '0.800',
    visibility: 'internal',
    evidenceQuote: 'Прислала еженедельный обзор движений конкурентов.',
    observedDaysAgo: 11,
  },
  {
    helperKey: 'sokolova', recipientKey: 'volkova', traitType: 'help_provided',
    intensity: '0.600', topicHint: 'Customer voice', confidence: '0.800',
    visibility: 'public_team',
    evidenceQuote: 'Поделилась расшифровкой 5 болевых интервью для продуктовой команды.',
    observedDaysAgo: 10,
  },
  {
    helperKey: 'sokolova', recipientKey: null, traitType: 'constructive_feedback',
    intensity: '0.600', topicHint: 'Документация фич', confidence: '0.700',
    visibility: 'internal',
    evidenceQuote: 'Попросила добавить use-case примеры в release notes — клиенты не понимали.',
    observedDaysAgo: 6,
  },

  // — Алексей Морозов (helper) —
  {
    helperKey: 'morozov', recipientKey: null, traitType: 'proactive_hint',
    intensity: '0.700', topicHint: 'Стратегические сигналы', confidence: '0.800',
    visibility: 'internal',
    evidenceQuote: 'Заметил, что в индустрии начинается переход на AI-агентов.',
    observedDaysAgo: 9,
  },
  {
    helperKey: 'morozov', recipientKey: 'volkova', traitType: 'mentoring',
    intensity: '0.700', topicHint: 'Управление перегрузом', confidence: '0.750',
    visibility: 'restricted',
    evidenceQuote: 'Помог Марине разгрузить календарь — отменил не критические совещания.',
    observedDaysAgo: 7,
  },
  {
    helperKey: 'morozov', recipientKey: 'sokolova', traitType: 'help_provided',
    intensity: '0.650', topicHint: 'Sales escalation', confidence: '0.800',
    visibility: 'public_team',
    evidenceQuote: 'Лично подключился к разговору с CEO Сбербанка для закрытия сделки.',
    observedDaysAgo: 12,
  },
  {
    helperKey: 'morozov', recipientKey: null, traitType: 'emotional_support',
    intensity: '0.600', topicHint: 'Town hall речь', confidence: '0.700',
    visibility: 'internal',
    evidenceQuote: 'Спокойно объяснил команде риски и план — паника спала.',
    observedDaysAgo: 18,
  },
  {
    helperKey: 'morozov', recipientKey: 'kozlov', traitType: 'constructive_feedback',
    intensity: '0.700', topicHint: 'Burnout warning', confidence: '0.800',
    visibility: 'restricted',
    evidenceQuote: 'Сказал, что Дмитрию пора брать неделю отпуска — не закрывать всё на себе.',
    observedDaysAgo: 4,
  },

  // — Анна Петрова (helper) —
  {
    helperKey: 'petrova', recipientKey: 'sidorov', traitType: 'mentoring',
    intensity: '0.750', topicHint: 'Design handoff в frontend', confidence: '0.850',
    visibility: 'public_team',
    evidenceQuote: 'Делает понятный handoff и помогает frontend-разработчикам с пиксель-перфектом.',
    observedDaysAgo: 5,
  },
  {
    helperKey: 'petrova', recipientKey: null, traitType: 'proactive_hint',
    intensity: '0.600', topicHint: 'UX-проблема CallScreen', confidence: '0.800',
    visibility: 'internal',
    evidenceQuote: 'Сама протестировала CallScreen на 3 устройствах и нашла 5 UX-проблем.',
    observedDaysAgo: 8,
  },
  {
    helperKey: 'petrova', recipientKey: 'volkova', traitType: 'help_provided',
    intensity: '0.700', topicHint: 'Прототипы для CustDev', confidence: '0.850',
    visibility: 'public_team',
    evidenceQuote: 'За день собрала кликабельный прототип для CustDev-интервью.',
    observedDaysAgo: 10,
  },
  {
    helperKey: 'petrova', recipientKey: null, traitType: 'constructive_feedback',
    intensity: '0.600', topicHint: 'Дизайн-система', confidence: '0.750',
    visibility: 'public_team',
    evidenceQuote: 'Предложила вынести часто используемые компоненты в Figma-библиотеку.',
    observedDaysAgo: 13,
  },
  {
    helperKey: 'petrova', recipientKey: 'sokolova', traitType: 'help_provided',
    intensity: '0.550', topicHint: 'Sales pitch deck', confidence: '0.700',
    visibility: 'public_team',
    evidenceQuote: 'Обновила оформление sales pitch deck — добавила скриншоты с реальными данными.',
    observedDaysAgo: 9,
  },
];

const PROFILE_BY_KEY = {
  morozov: {
    helpProvidedCount: 5, proactiveHintCount: 4, mentoringCount: 2, emotionalSupportCount: 2,
    expertiseTopics: ['стратегия', 'fundraising', 'pricing', 'OKR'],
    socialRoles: ['mentor', 'connector'],
    lastWeekHelpCount: 2, lastMonthHelpCount: 9,
    contributionScoreCached: '0.760',
  },
  volkova: {
    helpProvidedCount: 7, proactiveHintCount: 6, mentoringCount: 3, emotionalSupportCount: 3,
    expertiseTopics: ['product management', 'CustDev', 'roadmap', 'analytics'],
    socialRoles: ['mentor', 'mood_keeper'],
    lastWeekHelpCount: 3, lastMonthHelpCount: 11,
    contributionScoreCached: '0.820',
  },
  kozlov: {
    helpProvidedCount: 12, proactiveHintCount: 5, mentoringCount: 4, emotionalSupportCount: 1,
    expertiseTopics: ['OAuth2', 'security', 'PostgreSQL', 'NestJS'],
    socialRoles: ['mentor', 'problem_solver'],
    lastWeekHelpCount: 3, lastMonthHelpCount: 14,
    contributionScoreCached: '0.850',
  },
  sokolova: {
    helpProvidedCount: 6, proactiveHintCount: 4, mentoringCount: 2, emotionalSupportCount: 1,
    expertiseTopics: ['B2B-продажи', 'CustDev', 'конкурентный анализ', 'enterprise'],
    socialRoles: ['connector', 'trainer'],
    lastWeekHelpCount: 2, lastMonthHelpCount: 10,
    contributionScoreCached: '0.730',
  },
  petrova: {
    helpProvidedCount: 5, proactiveHintCount: 3, mentoringCount: 2, emotionalSupportCount: 0,
    expertiseTopics: ['UI/UX', 'дизайн-система', 'мобайл', 'прототипирование'],
    socialRoles: ['problem_solver'],
    lastWeekHelpCount: 1, lastMonthHelpCount: 7,
    contributionScoreCached: '0.680',
  },
} as const;

const CONTRIBUTION_BY_KEY = {
  morozov: { ideasInDevelopment: 2, ideasShipped: 5, thanksReceived: 9, thanksReceivedWeek: 1, currentCheckinStreak: 10, longestCheckinStreak: 18, helpfulComments: 6, probeQuestionsAnswered: 4 },
  volkova: { ideasInDevelopment: 4, ideasShipped: 8, thanksReceived: 12, thanksReceivedWeek: 2, currentCheckinStreak: 12, longestCheckinStreak: 20, helpfulComments: 9, probeQuestionsAnswered: 5 },
  kozlov:  { ideasInDevelopment: 3, ideasShipped: 7, thanksReceived: 14, thanksReceivedWeek: 2, currentCheckinStreak: 8, longestCheckinStreak: 14, helpfulComments: 11, probeQuestionsAnswered: 5 },
  sokolova: { ideasInDevelopment: 2, ideasShipped: 4, thanksReceived: 10, thanksReceivedWeek: 2, currentCheckinStreak: 11, longestCheckinStreak: 16, helpfulComments: 7, probeQuestionsAnswered: 3 },
  petrova:  { ideasInDevelopment: 3, ideasShipped: 6, thanksReceived: 7, thanksReceivedWeek: 1, currentCheckinStreak: 6, longestCheckinStreak: 12, helpfulComments: 5, probeQuestionsAnswered: 2 },
} as const;

const SPOTLIGHTS = [
  {
    helperKey: 'kozlov',
    approvedByKey: 'morozov',
    topicHint: 'OAuth2 архитектура',
    message:
      '🌟 Дмитрий Козлов на этой неделе — ваш «mentor of the week». ' +
      'Помог Игорю Новикову разобраться в OAuth2-архитектуре через парное программирование, ' +
      'выпустил детальное руководство по auth-флоу и закрыл 3 запроса по security.',
    helpCount: 5,
  },
  {
    helperKey: 'volkova',
    approvedByKey: 'morozov',
    topicHint: 'Поддержка команды',
    message:
      '🌟 Марина Волкова — «mood keeper» месяца. После стрессовой релизной недели ' +
      'предложила команде day-off, подготовила сценарий CustDev для Соколовой и ' +
      'добавила 3 продуктовых улучшения в roadmap по фидбеку клиентов.',
    helpCount: 6,
  },
  {
    helperKey: 'sokolova',
    approvedByKey: 'volkova',
    topicHint: 'Обучение команды продаж',
    message:
      '🌟 Екатерина Соколова — «trainer» этой недели. Шадоувила Виктора Лебедева ' +
      'на трёх встречах с Ростелекомом, дала готовый sales playbook и закрыла ' +
      'два enterprise-демо подряд.',
    helpCount: 4,
  },
  {
    helperKey: 'petrova',
    approvedByKey: 'volkova',
    topicHint: 'Дизайн-система',
    message:
      '🌟 Анна Петрова делает дизайн-handoff, которому позавидует любой большой стартап. ' +
      'За месяц помогла Сидорову с тремя пиксель-перфект-вёрстками, собрала ' +
      'кликабельный прототип для CustDev и предложила вынести компоненты в Figma-библиотеку.',
    helpCount: 4,
  },
  {
    helperKey: 'morozov',
    approvedByKey: 'volkova',
    topicHint: 'Стратегические сигналы',
    message:
      '🌟 Алексей Морозов — «proactive hinter» месяца. Заметил тренд на AI-агентов раньше остальных, ' +
      'предложил пересмотреть positioning и помог разгрузить календарь Марины ' +
      'для фокуса на стратегических задачах.',
    helpCount: 4,
  },
];

export const seedHelpfulness: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId } = ctx;

  // ── 1. HelpfulnessTrait × 25 ──────────────────────────────────────────

  for (const t of TRAITS) {
    const trait = await prisma.helpfulnessTrait.create({
      data: {
        tenantId,
        helperUserId: req(ids.users[t.helperKey], `user:${t.helperKey}`),
        recipientUserId: t.recipientKey ? ids.users[t.recipientKey] ?? null : null,
        traitType: t.traitType,
        intensity: t.intensity,
        topicHint: t.topicHint,
        sourceBlockIds: [],
        evidenceQuote: t.evidenceQuote,
        confidence: t.confidence,
        visibility: t.visibility,
        lastObservedAt: daysAgo(t.observedDaysAgo),
        status: 'active',
      },
    });
    ids.pulseSnapshotIds.helpfulnessTraits.push(trait.id);
  }

  // ── 2. SocialContributionProfile × 5 ──────────────────────────────────

  for (const [key, profile] of Object.entries(PROFILE_BY_KEY)) {
    const userId = req(ids.users[key], `user:${key}`);
    const created = await prisma.socialContributionProfile.create({
      data: {
        tenantId,
        userId,
        helpProvidedCount: profile.helpProvidedCount,
        proactiveHintCount: profile.proactiveHintCount,
        mentoringCount: profile.mentoringCount,
        emotionalSupportCount: profile.emotionalSupportCount,
        expertiseTopics: [...profile.expertiseTopics],
        socialRoles: [...profile.socialRoles],
        lastWeekHelpCount: profile.lastWeekHelpCount,
        lastMonthHelpCount: profile.lastMonthHelpCount,
        contributionScoreCached: profile.contributionScoreCached,
        buildVersion: 1,
        lastBuiltAt: daysAgo(1),
      },
    });
    ids.pulseSnapshotIds.socialContributions.push(created.id);
  }

  // ── 3. ContributionSnapshot × 5 (без tenantId, UNIQUE per userId) ─────

  for (const [key, snap] of Object.entries(CONTRIBUTION_BY_KEY)) {
    const userId = req(ids.users[key], `user:${key}`);
    const created = await prisma.contributionSnapshot.create({
      data: {
        userId,
        ideasInDevelopment: snap.ideasInDevelopment,
        ideasShipped: snap.ideasShipped,
        thanksReceived: snap.thanksReceived,
        thanksReceivedWeek: snap.thanksReceivedWeek,
        currentCheckinStreak: snap.currentCheckinStreak,
        longestCheckinStreak: snap.longestCheckinStreak,
        helpfulComments: snap.helpfulComments,
        probeQuestionsAnswered: snap.probeQuestionsAnswered,
      },
    });
    ids.pulseSnapshotIds.contributions.push(created.id);
  }

  // ── 4. HelpfulnessSpotlight × 5 (status='published') ───────────────────

  for (let i = 0; i < SPOTLIGHTS.length; i++) {
    const s = SPOTLIGHTS[i]!;
    const helperUserId = req(ids.users[s.helperKey], `user:${s.helperKey}`);
    const approvedByUserId = req(ids.users[s.approvedByKey], `user:${s.approvedByKey}`);
    const published = await prisma.helpfulnessSpotlight.create({
      data: {
        tenantId,
        helperUserId,
        topicHint: s.topicHint,
        message: s.message,
        periodFrom: daysAgo(7 + i),
        periodTo: daysAgo(i),
        helpCount: s.helpCount,
        traitIds: [],
        status: 'published',
        approvedByUserId,
        publishedAt: daysAgo(i),
      },
    });
    ids.pulseSnapshotIds.helpfulnessSpotlights.push(published.id);
  }

  console.log(
    `[demo/helpfulness] Создано: ${ids.pulseSnapshotIds.helpfulnessTraits.length} HelpfulnessTrait, ` +
      `${ids.pulseSnapshotIds.socialContributions.length} SocialContributionProfile, ` +
      `${ids.pulseSnapshotIds.contributions.length} ContributionSnapshot, ` +
      `${ids.pulseSnapshotIds.helpfulnessSpotlights.length} HelpfulnessSpotlight.`,
  );
};
