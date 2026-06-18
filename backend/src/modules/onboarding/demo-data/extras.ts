import type { Prisma } from '@prisma/client';

import type { SeedFn } from './types';
import { daysAgo, req } from './types';

export const seedRegulations: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId } = ctx;

  const REGULATIONS = [
    {
      key: 'r_code_review',
      name: 'Регламент code review',
      contentMd:
        '# Регламент code review\n\n' +
        '## SLA\nКаждый PR проходит обязательное review минимум одним инженером в течение 24 часов.\n\n' +
        '## Эскалация\nЕсли SLA нарушен — авто-эскалация к Tech Lead.\n\n' +
        '## Чек-лист\n- Тесты на новый код\n- Security review для auth-flow\n- Документация API изменений',
      ownerPersonKey: 'kozlov',
    },
    {
      key: 'r_hotfix',
      name: 'Регламент релиза hotfix',
      contentMd:
        '# Регламент релиза hotfix\n\n' +
        '## Когда применять\nПрод-инцидент с потерей дохода или security-уязвимость.\n\n' +
        "## Процесс\n1. Создать PR в hotfix-branch\n2. Минимум 2 reviewer'а\n3. Smoke-тест на staging\n4. Деплой в течение 4 часов\n5. Post-mortem в течение 48 часов",
      ownerPersonKey: 'kozlov',
    },
    {
      key: 'r_onboarding',
      name: 'Регламент онбординга нового сотрудника',
      contentMd:
        '# Регламент онбординга\n\n' +
        '## День 1\nWelcome-встреча с HR, доступы, ноутбук.\n\n' +
        '## Неделя 1\nЗнакомство с командой, чтение второго мозга, первый PR.\n\n' +
        '## Месяц 1\n1-2-1 с руководителем еженедельно, fix-задачи, парное программирование.',
      ownerPersonKey: 'volkova',
    },
    {
      key: 'r_custdev',
      name: 'Регламент CustDev-интервью',
      contentMd:
        '# Регламент CustDev\n\n' +
        '## Подготовка\n- Скрипт из 12 открытых вопросов\n- Запись с согласия клиента\n- Длительность 45–60 минут\n\n' +
        '## После интервью\n- Расшифровка в Z\n- Кластеризация инсайтов\n- 3 ключевых вывода → продуктовой команде',
      ownerPersonKey: 'sokolova',
    },
    {
      key: 'r_escalation',
      name: 'Регламент эскалации инцидента',
      contentMd:
        '# Эскалация инцидента\n\n' +
        '## Уровни\n- P0: данные клиентов — CEO + CTO немедленно\n- P1: даунтайм > 30 мин — on-call + Tech Lead\n- P2: bug в проде — стендап следующего дня\n\n' +
        '## SLA восстановления\nP0: 1 час, P1: 4 часа, P2: 24 часа.',
      ownerPersonKey: 'morozov',
    },
  ];

  for (const r of REGULATIONS) {
    const reg = await prisma.regulation.create({
      data: {
        tenantId,
        name: r.name,
        contentMd: r.contentMd,
        category: 'regulation',
        status: 'active',
        ownerPersonId: ids.persons[r.ownerPersonKey] ?? null,
        dataClass: 'internal',
      },
    });
    ids.regulations[r.key] = reg.id;
  }

  console.log(`[demo/regulations] Создано ${REGULATIONS.length} регламентов.`);
};

export const seedIdeas: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId } = ctx;

  const CLUSTERS = [
    { key: 'ui', name: 'UI улучшения', description: 'Идеи по визуальной полировке и UX' },
    {
      key: 'integrations',
      name: 'Интеграции',
      description: 'Запросы на интеграции с внешними системами',
    },
    { key: 'perf', name: 'Производительность', description: 'Идеи по ускорению платформы' },
  ];

  for (const c of CLUSTERS) {
    const cl = await prisma.ideaCluster.create({
      data: {
        tenantId,
        name: c.name,
        description: c.description,
        clusterWeight: '3.000',
      },
    });
    ids.ideaClusters[c.key] = cl.id;
  }

  const IDEAS = [
    {
      clusterKey: 'ui',
      kind: 'internal',
      authorKey: 'petrova',
      statement: 'Добавить тёмную тему для длинных встреч',
      supporters: 5,
    },
    {
      clusterKey: 'ui',
      kind: 'internal',
      authorKey: 'petrova',
      statement: 'Кастомизируемые горячие клавиши для модераторов',
      supporters: 3,
    },
    {
      clusterKey: 'ui',
      kind: 'internal',
      authorKey: 'sidorov',
      statement: 'Компактный режим дашборда — больше виджетов в одно окно',
      supporters: 2,
    },
    {
      clusterKey: 'integrations',
      kind: 'client_request',
      authorKey: 'sokolova',
      statement: 'Slack-интеграция (запрос от Ростелекома)',
      supporters: 7,
    },
    {
      clusterKey: 'integrations',
      kind: 'client_request',
      authorKey: 'sokolova',
      statement: 'Webhooks для CRM (Сбербанк)',
      supporters: 4,
    },
    {
      clusterKey: 'integrations',
      kind: 'client_request',
      authorKey: 'volkova',
      statement: 'Calendar 2-way sync с Google Calendar',
      supporters: 6,
    },
    {
      clusterKey: 'integrations',
      kind: 'internal',
      authorKey: 'kozlov',
      statement: 'GitHub PR-bot — статус ревью в Slack',
      supporters: 3,
    },
    {
      clusterKey: 'perf',
      kind: 'internal',
      authorKey: 'novikov',
      statement: 'Lazy-load транскриптов на странице встречи',
      supporters: 4,
    },
    {
      clusterKey: 'perf',
      kind: 'internal',
      authorKey: 'kozlov',
      statement: 'Кэширование embeddings в Redis на 24 часа',
      supporters: 2,
    },
    {
      clusterKey: 'perf',
      kind: 'client_request',
      authorKey: 'sokolova',
      statement: 'Ускорить открытие больших проектов в трекере',
      supporters: 5,
    },
  ];

  for (let i = 0; i < IDEAS.length; i++) {
    const idea = IDEAS[i]!;
    const created = await prisma.idea.create({
      data: {
        tenantId,
        kind: idea.kind as 'internal' | 'client_request',
        statement: idea.statement,
        supporterCount: idea.supporters,
        weight: (idea.supporters * 1.5).toFixed(3),
        clusterId: ids.ideaClusters[idea.clusterKey] ?? null,
        confidence: '0.700',
        status: 'in_discussion',
        firstProposedAt: daysAgo(20 + i),
        lastDiscussedAt: daysAgo(i),
        dataClass: 'internal',
      },
    });
    ids.ideas[`idea_${i}`] = created.id;
  }

  console.log(`[demo/ideas] Создано ${IDEAS.length} идей + ${CLUSTERS.length} кластеров.`);
};

export const seedDocuments: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId } = ctx;

  const DOCS = [
    {
      name: 'Должностная инструкция Tech Lead',
      uploaderKey: 'morozov',
      content:
        '# Tech Lead\n\nОтвечает за архитектуру backend, code review SLA, технический долг и инциденты P0.',
    },
    {
      name: 'Брендбук ТехноСтрим v2',
      uploaderKey: 'volkova',
      content:
        '# Брендбук ТехноСтрим v2\n\n## Логотип\nИспользуем основной знак на светлом фоне.\n\n## Цвета\n- Primary: #4F46E5\n- Accent: #10B981',
    },
    {
      name: 'Шаблон NDA для клиентов',
      uploaderKey: 'morozov',
      content: '# NDA шаблон\n\nСтандартное соглашение о неразглашении со сроком 3 года.',
    },
    {
      name: 'Положение об оплате труда',
      uploaderKey: 'mikhailova',
      content:
        '# Положение об оплате\n\nДва раза в месяц — аванс 15-го, основная 30-го. Премии — по KPI квартала.',
    },
    {
      name: 'Roadmap Q2-Q3 2026',
      uploaderKey: 'volkova',
      content:
        '# Roadmap\n\n## Q2\n- OAuth2 миграция\n- Мобильное MVP\n- Ростелеком пилот\n\n## Q3\n- ФСТЭК сертификация\n- Slack-интеграция',
    },
  ];

  for (let i = 0; i < DOCS.length; i++) {
    const d = DOCS[i]!;
    const personId = req(ids.persons[d.uploaderKey], `person:${d.uploaderKey}`);
    const buffer = Buffer.from(d.content, 'utf8');
    const doc = await prisma.document.create({
      data: {
        tenantId,
        uploaderId: personId,
        kind: 'text',
        name: d.name,
        mimeType: 'text/markdown',
        originalSize: buffer.byteLength,
        inlineContent: buffer,
        status: 'parsed',
        parsedText: d.content,
        useCases: ['reference'],
      },
    });
    ids.documents[`doc_${i}`] = doc.id;
  }

  console.log(`[demo/documents] Создано ${DOCS.length} документов.`);
};

export const seedCalendar: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId, ownerUserId } = ctx;

  const EVENTS: Array<{
    title: string;
    daysFromNow: number;
    durationMin: number;
    kind: 'meeting' | 'release' | 'milestone' | 'incident' | 'deadline' | 'other';
    participantPersonKeys: string[];
  }> = [
    {
      title: 'CustDev: Ростелеком',
      daysFromNow: -28,
      durationMin: 60,
      kind: 'meeting',
      participantPersonKeys: ['sokolova', 'volkova', 'morozov'],
    },
    {
      title: 'Sprint 12 планирование',
      daysFromNow: -25,
      durationMin: 60,
      kind: 'meeting',
      participantPersonKeys: ['kozlov', 'novikov', 'sidorov'],
    },
    {
      title: 'Дизайн-ревью v2',
      daysFromNow: -22,
      durationMin: 45,
      kind: 'meeting',
      participantPersonKeys: ['petrova', 'volkova'],
    },
    {
      title: 'All-hands старт Q2',
      daysFromNow: -19,
      durationMin: 60,
      kind: 'meeting',
      participantPersonKeys: ['morozov', 'volkova', 'kozlov', 'sokolova'],
    },
    {
      title: 'Релиз v1.9.0',
      daysFromNow: -17,
      durationMin: 30,
      kind: 'release',
      participantPersonKeys: ['kozlov', 'novikov'],
    },
    {
      title: 'Sales pipeline review',
      daysFromNow: -14,
      durationMin: 45,
      kind: 'meeting',
      participantPersonKeys: ['sokolova', 'morozov'],
    },
    {
      title: 'CustDev: Сбербанк',
      daysFromNow: -12,
      durationMin: 60,
      kind: 'meeting',
      participantPersonKeys: ['sokolova', 'volkova'],
    },
    {
      title: 'HR-синк',
      daysFromNow: -10,
      durationMin: 30,
      kind: 'meeting',
      participantPersonKeys: ['mikhailova', 'morozov'],
    },
    {
      title: 'Ретро Sprint 12',
      daysFromNow: -8,
      durationMin: 45,
      kind: 'meeting',
      participantPersonKeys: ['kozlov', 'sidorov'],
    },
    {
      title: 'Demo для борда',
      daysFromNow: -6,
      durationMin: 60,
      kind: 'meeting',
      participantPersonKeys: ['morozov', 'volkova'],
    },
    {
      title: 'Релиз v1.9.5 hotfix',
      daysFromNow: -4,
      durationMin: 20,
      kind: 'release',
      participantPersonKeys: ['kozlov'],
    },
    {
      title: 'Code review session',
      daysFromNow: -2,
      durationMin: 45,
      kind: 'meeting',
      participantPersonKeys: ['kozlov', 'novikov', 'sidorov'],
    },
    {
      title: 'Sprint 14 planning',
      daysFromNow: 1,
      durationMin: 60,
      kind: 'meeting',
      participantPersonKeys: ['kozlov', 'novikov', 'sidorov', 'popov'],
    },
    {
      title: 'CustDev: Тинькофф',
      daysFromNow: 2,
      durationMin: 90,
      kind: 'meeting',
      participantPersonKeys: ['sokolova', 'morozov'],
    },
    {
      title: 'Дизайн-ревью CallScreen v4',
      daysFromNow: 3,
      durationMin: 45,
      kind: 'meeting',
      participantPersonKeys: ['petrova', 'volkova', 'sidorov'],
    },
    {
      title: 'Демо-день для команды',
      daysFromNow: 5,
      durationMin: 30,
      kind: 'meeting',
      participantPersonKeys: ['morozov', 'volkova', 'kozlov'],
    },
    {
      title: 'Ретроспектива Q2',
      daysFromNow: 7,
      durationMin: 90,
      kind: 'meeting',
      participantPersonKeys: ['morozov', 'volkova', 'kozlov', 'sokolova', 'mikhailova'],
    },
    {
      title: 'Релиз v2.0 milestone',
      daysFromNow: 14,
      durationMin: 60,
      kind: 'milestone',
      participantPersonKeys: ['kozlov', 'volkova'],
    },
  ];

  for (let i = 0; i < EVENTS.length; i++) {
    const e = EVENTS[i]!;
    const startAt = e.daysFromNow >= 0 ? daysAgo(-e.daysFromNow) : daysAgo(-e.daysFromNow);
    const endAt = new Date(startAt.getTime() + e.durationMin * 60_000);

    const entity = await prisma.entity.create({
      data: {
        tenantId,
        type: 'event',
        canonicalName: e.title,
        aliases: [],
      },
    });

    const created = await prisma.event.create({
      data: {
        tenantId,
        entityId: entity.id,
        kind: e.kind,
        title: e.title,
        startAt,
        endAt,
        durationMin: e.durationMin,
        ownerId: ownerUserId,
        timezone: 'Europe/Moscow',
        status: 'confirmed',
        visibility: 'company',
        participantsPersonIds: e.participantPersonKeys
          .map((k) => ids.persons[k])
          .filter((v): v is string => Boolean(v)),
        participants: {
          create: e.participantPersonKeys
            .map((k) => ids.persons[k])
            .filter((v): v is string => Boolean(v))
            .map((personId) => ({
              personId,
              role: 'required' as const,
              rsvp: 'pending' as const,
            })),
        },
      },
    });
    ids.events[`event_${i}`] = created.id;

    if (e.daysFromNow > 0 && i < EVENTS.length && EVENTS.slice(EVENTS.length - 6).includes(e)) {
      await prisma.eventReminder.create({
        data: {
          eventId: created.id,
          offsetMin: 15,
          channel: 'push',
          userId: ownerUserId,
        },
      });
    }
  }

  console.log(`[demo/calendar] Создано ${EVENTS.length} событий.`);
};

export const seedReferrals: SeedFn = async (ctx, ids) => {
  const { prisma, ownerUserId } = ctx;

  const slug = `demo${ownerUserId.slice(-6)}`;
  const ref = await prisma.referral.upsert({
    where: { ownerUserId },
    create: { ownerUserId, slug },
    update: {},
  });
  ids.referralLinkId = ref.id;

  console.log(`[demo/referrals] Создан 1 Referral (slug=${slug}).`);
};

export const seedFeedback: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId, ownerUserId } = ctx;

  const MESSAGES = [
    { text: 'Хотим тёмную тему для длинных встреч — глазам тяжело.', daysAgoN: 8 },
    { text: 'Открытие большого проекта 5+ секунд — нужно ускорить.', daysAgoN: 6 },
    { text: 'Не хватает экспорта расшифровки в .docx.', daysAgoN: 5 },
    { text: 'Календарь не синхронизируется с Google.', daysAgoN: 4 },
    { text: 'AI-отчёт по CustDev — местами повторы. Хочется лаконичнее.', daysAgoN: 3 },
    { text: 'Slack-интеграция: нужны ссылки на встречу прямо в канале.', daysAgoN: 2 },
    {
      text: 'Заметил баг: при поиске по транскрипту иногда подсвечиваются не те фразы.',
      daysAgoN: 1,
    },
    { text: 'Очень нравится новый дашборд! Спасибо команде.', daysAgoN: 0 },
  ];

  for (let i = 0; i < MESSAGES.length; i++) {
    const m = MESSAGES[i]!;
    const msg = await prisma.feedbackMessage.create({
      data: {
        userId: ownerUserId,
        orgId: tenantId,
        text: m.text,
        createdAt: daysAgo(m.daysAgoN),
        processedAt: i < 4 ? daysAgo(Math.max(0, m.daysAgoN - 1)) : null,
      },
    });
    ids.feedbackMessages[`msg_${i}`] = msg.id;
  }

  console.log(`[demo/feedback] Создано ${MESSAGES.length} FeedbackMessage.`);
};

export const seedExperiments: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId } = ctx;

  const EXPERIMENTS = [
    {
      key: 'exp_pricing_3tier',
      name: 'A/B тест: 3 vs 4 тарифа на лендинге',
      hypothesisText: '4 тарифа дают больше выбора и повышают конверсию на 5%.',
      status: 'running',
      currentResult:
        'Промежуточно: 4 тарифа дают +2.1% конверсии (p=0.18, маловато для значимости).',
    },
    {
      key: 'exp_onboarding_video',
      name: 'Видео-онбординг vs текстовый',
      hypothesisText: 'Видео-онбординг повышает завершаемость first-meeting на 15%.',
      status: 'completed',
      currentResult: 'Видео даёт +12% завершаемость (p=0.04). Решение: внедрить.',
    },
    {
      key: 'exp_email_subject',
      name: 'Email subject: emoji vs plain',
      hypothesisText: 'Emoji в subject повышает open rate на 10%.',
      status: 'completed',
      currentResult: 'Открываемость без emoji выше на 3% (p=0.02). Откат к plain subject.',
    },
  ];

  for (const e of EXPERIMENTS) {
    const exp = await prisma.experiment.create({
      data: {
        tenantId,
        name: e.name,
        hypothesisText: e.hypothesisText,
        status: e.status,
        currentResult: e.currentResult,
        confidence: '0.700',
        startedAt: daysAgo(30),
        completedAt: e.status === 'completed' ? daysAgo(5) : null,
      },
    });
    ids.experiments[e.key] = exp.id;
  }

  console.log(`[demo/experiments] Создано ${EXPERIMENTS.length} экспериментов.`);
};

export const seedBrandVoice: SeedFn = async (ctx, _ids) => {
  const { prisma, tenantId } = ctx;

  await prisma.brandVoiceProfile.upsert({
    where: { tenantId },
    create: {
      tenantId,
      toneJson: {
        formal: 0.3,
        technical: 0.7,
        casual: 0.4,
        energetic: 0.6,
      } as unknown as Prisma.InputJsonValue,
      valuesJson: [
        { value: 'Прямота', weight: 0.9, exampleBlockIds: [] },
        { value: 'Экспертиза', weight: 0.85, exampleBlockIds: [] },
        { value: 'Гуманность', weight: 0.7, exampleBlockIds: [] },
      ] as unknown as Prisma.InputJsonValue,
      taboosJson: [
        { phrase: 'наш продукт', alternative: 'Z (Кора)', reason: 'Конкретика бренда' },
        { phrase: 'возможно', alternative: 'предлагаем', reason: 'Уверенность' },
      ] as unknown as Prisma.InputJsonValue,
      version: 1,
      lastBuiltAt: daysAgo(2),
      builderAgentVersion: 'demo-seed',
    },
    update: {},
  });

  console.log('[demo/brand-voice] Создан 1 BrandVoiceProfile.');
};

export const seedVendors: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId } = ctx;

  const VENDORS = [
    { key: 'v_aws', name: 'AWS', segment: 'infrastructure' },
    { key: 'v_cloudflare', name: 'Cloudflare', segment: 'infrastructure' },
    { key: 'v_stripe', name: 'Stripe', segment: 'payments' },
    { key: 'v_1c', name: '1С-Битрикс', segment: 'integration' },
  ];

  for (const v of VENDORS) {
    const entity = await prisma.entity.create({
      data: {
        tenantId,
        type: 'vendor',
        canonicalName: v.name,
        aliases: [],
      },
    });

    const created = await prisma.vendor.create({
      data: {
        tenantId,
        entityId: entity.id,
        name: v.name,
        status: 'active',
      },
    });
    ids.vendors[v.key] = created.id;
  }

  console.log(`[demo/vendors] Создано ${VENDORS.length} вендоров.`);
};

export const seedProbeEvents: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId } = ctx;

  const PROBES = [
    { reason: 'decision_outcome_unknown', emittedBy: 'specialist-3-3', priority: 70, daysAgoN: 5 },
    { reason: 'commitment_overdue', emittedBy: 'commitment-keeper', priority: 80, daysAgoN: 4 },
    {
      reason: 'recurring_topic_no_decision',
      emittedBy: 'topic-recurrence',
      priority: 60,
      daysAgoN: 3,
    },
    {
      reason: 'knowledge_gap_unanswered',
      emittedBy: 'knowledge-velocity',
      priority: 65,
      daysAgoN: 3,
    },
    {
      reason: 'process_friction_detected',
      emittedBy: 'cross-functional-detector',
      priority: 75,
      daysAgoN: 2,
    },
    { reason: 'idea_supporter_threshold', emittedBy: 'ideas-collector', priority: 50, daysAgoN: 2 },
    { reason: 'goal_alignment_drop', emittedBy: 'goal-vector', priority: 70, daysAgoN: 1 },
    { reason: 'bus_factor_critical', emittedBy: 'bus-factor-analyzer', priority: 85, daysAgoN: 1 },
    { reason: 'engagement_drop', emittedBy: 'engagement-scorer', priority: 75, daysAgoN: 0 },
    { reason: 'experiment_no_owner', emittedBy: 'experiment-tracker', priority: 55, daysAgoN: 0 },
  ];

  for (let i = 0; i < PROBES.length; i++) {
    const p = PROBES[i]!;
    const probe = await prisma.probeEvent.create({
      data: {
        tenantId,
        emittedByService: p.emittedBy,
        reason: p.reason,
        payload: { contextIds: [], note: 'demo seed' } as unknown as Prisma.InputJsonValue,
        recipientCandidates: [],
        status: 'pending',
        contentHash: `demo-${p.reason}-${i}-${tenantId.slice(-6)}`,
        priority: p.priority,
        createdAt: daysAgo(p.daysAgoN),
        expiresAt: daysAgo(p.daysAgoN - 7),
      },
    });
    ids.probeEvents[`probe_${i}`] = probe.id;
  }

  console.log(`[demo/probe-events] Создано ${PROBES.length} ProbeEvent.`);
};
