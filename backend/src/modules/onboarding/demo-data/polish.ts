/**
 * Демо-данные «ТехноСтрим» — финальная полировка.
 *
 * Создаёт: Recognition (5), HelpfulnessSpotlight (2), UserBadge (3),
 * Card (5), Process (3) + ProcessStep (19), Subscription (upsert),
 * MeetingsBalance (upsert).
 *
 * MeetingQualityScore, MeetingBehaviorMetrics, MeetingParticipantBehavior
 * уже создаются в meetings.ts — здесь не дублируем.
 */
import type { SeedFn, SeedContext, IdMap } from './types';
import { daysAgo } from './types';

export const seedPolish: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId, ownerUserId } = ctx;

  // ── 1. Recognition (5) ────────────────────────────────────────────────

  console.log('[demo/polish] Создание Recognition...');

  const recognitionDefs = [
    {
      type: 'thanks_helpfulness',
      message: 'Спасибо за быстрый hotfix уязвимостей!',
      daysAgoN: 2,
    },
    {
      type: 'thanks_comment',
      message: 'Отличный дизайн экрана звонка, клиент в восторге',
      daysAgoN: 4,
    },
    {
      type: 'idea_shipped',
      message: 'Хорошая Docker-оптимизация, билд ускорился на 40%',
      daysAgoN: 5,
    },
    {
      type: 'thanks_helpfulness',
      message: 'CustDev с Ростелеком — прорыв!',
      daysAgoN: 7,
    },
    {
      type: 'mention_helped',
      message: 'Закрытие сделки с Сбербанк — отличная работа',
      daysAgoN: 9,
    },
  ];

  for (const r of recognitionDefs) {
    await prisma.recognition.create({
      data: {
        tenantId,
        toUserId: ownerUserId,
        fromUserId: ownerUserId,
        type: r.type,
        message: r.message,
        visibility: 'public_org',
        createdAt: daysAgo(r.daysAgoN),
      },
    });
  }

  // ── 2. HelpfulnessSpotlight (2) ───────────────────────────────────────

  console.log('[demo/polish] Создание HelpfulnessSpotlight...');

  const spotlightDefs = [
    {
      message: 'Дмитрий Козлов — главный помощник недели: 8 раз помог коллегам',
      helpCount: 8,
      daysFrom: 7,
      daysTo: 1,
    },
    {
      message: 'Марина Волкова — мост между продуктом и продажами',
      helpCount: 5,
      daysFrom: 14,
      daysTo: 7,
    },
  ];

  for (const s of spotlightDefs) {
    await prisma.helpfulnessSpotlight.create({
      data: {
        tenantId,
        helperUserId: ownerUserId,
        message: s.message,
        helpCount: s.helpCount,
        periodFrom: daysAgo(s.daysFrom),
        periodTo: daysAgo(s.daysTo),
        status: 'published',
        publishedAt: daysAgo(s.daysTo),
      },
    });
  }

  // ── 3. Badge + UserBadge ──────────────────────────────────────────────

  console.log('[demo/polish] Привязка бейджей...');

  const badgeSlugs = [
    {
      slug: 'first-meeting',
      name: 'Первая встреча',
      description: 'Провёл первую встречу в платформе',
      condition: { type: 'meetings_hosted', threshold: 1 },
    },
    {
      slug: 'knowledge-builder',
      name: 'Собиратель знаний',
      description: 'Создал 10+ информационных блоков в графе знаний',
      condition: { type: 'idea_blocks_created', threshold: 10 },
    },
    {
      slug: 'sprint-hero',
      name: 'Герой спринта',
      description: 'Закрыл все задачи спринта в срок',
      condition: { type: 'sprint_completion', threshold: 100 },
    },
  ];

  for (const b of badgeSlugs) {
    const badge = await prisma.badge.upsert({
      where: { slug: b.slug },
      update: {},
      create: {
        slug: b.slug,
        name: b.name,
        description: b.description,
        condition: b.condition as object,
      },
    });

    // UserBadge — upsert to handle re-runs
    await prisma.userBadge.upsert({
      where: {
        userId_badgeId: {
          userId: ownerUserId,
          badgeId: badge.id,
        },
      },
      update: {},
      create: {
        userId: ownerUserId,
        badgeId: badge.id,
      },
    });
  }

  // ── 4. Cards (5) ──────────────────────────────────────────────────────

  console.log('[demo/polish] Создание карточек...');

  const cardDefs = [
    {
      key: 'card_rostelecom',
      name: 'Ростелеком',
      kind: 'client',
      entityKey: 'e_rostelecom',
      description: 'Ключевой enterprise-клиент. Пилот на 500 пользователей. Договор подписан.',
      meetingCount: 2,
    },
    {
      key: 'card_sberbank',
      name: 'Сбербанк',
      kind: 'client',
      entityKey: 'e_sberbank',
      description: 'Потенциальный крупный клиент. Демо проведено, просят пилот.',
      meetingCount: 1,
    },
    {
      key: 'card_platform',
      name: 'Платформа v2.0',
      kind: 'product',
      entityKey: 'e_platform',
      description: 'Основной продукт: AI-отчёты, граф знаний, клоны сотрудников. Релиз к 1 июля.',
      meetingCount: 3,
    },
    {
      key: 'card_zoom',
      name: 'Zoom',
      kind: 'competitor',
      entityKey: 'e_zoom',
      description: 'Основной конкурент. Демпингует цены на 20%. Наша стратегия — value-sell через AI.',
      meetingCount: 1,
    },
    {
      key: 'card_market',
      name: 'Рынок B2B VC',
      kind: 'market',
      entityKey: 'e_market',
      description: 'Рынок B2B видеоконференций. Растёт +15% YoY. AI-фичи — ключевой дифференциатор.',
      meetingCount: 1,
    },
  ];

  for (const c of cardDefs) {
    const card = await prisma.card.create({
      data: {
        ownerId: ownerUserId,
        tenantId,
        name: c.name,
        kind: c.kind,
        description: c.description,
        entityId: ids.entities[c.entityKey],
        meetingCount: c.meetingCount,
      },
    });
    ids.cards[c.key] = card.id;
  }

  // ── 5. Processes (3) + ProcessStep (19) ───────────────────────────────

  console.log('[demo/polish] Создание процессов...');

  const processDefs = [
    {
      key: 'process_code_review',
      name: 'Code Review',
      description: 'Процесс ревью кода в команде. SLA: 24 часа. Эскалация к Tech Lead при нарушении.',
      ownerPersonKey: 'kozlov',
      steps: [
        'Создание PR',
        'Автоматические проверки',
        'Ревью назначенным ревьюером',
        'Исправление замечаний',
        'Approve и мерж',
      ],
    },
    {
      key: 'process_onboarding',
      name: 'Onboarding нового сотрудника',
      description: 'Полный процесс онбординга нового члена команды. Владелец — HR.',
      ownerPersonKey: 'mikhailova',
      steps: [
        'Подготовка рабочего места',
        'Доступы и аккаунты',
        'Встреча с buddy',
        'Обзор архитектуры',
        'Первая задача',
        'Ревью первого PR',
        'One-to-one с руководителем',
        'Feedback через 2 недели',
      ],
    },
    {
      key: 'process_custdev',
      name: 'Обработка CustDev-интервью',
      description: 'Процесс от записи интервью до обновления продукта. Владелец — CPO.',
      ownerPersonKey: 'volkova',
      steps: [
        'Запись интервью',
        'Транскрибация',
        'Выделение болей',
        'Кластеризация инсайтов',
        'Обновление продукта',
        'Follow-up клиенту',
      ],
    },
  ];

  for (const p of processDefs) {
    const proc = await prisma.process.create({
      data: {
        tenantId,
        name: p.name,
        description: p.description,
        ownerPersonId: ids.persons[p.ownerPersonKey],
        status: 'active',
      },
    });
    ids.processes[p.key] = proc.id;

    for (let i = 0; i < p.steps.length; i++) {
      await prisma.processStep.create({
        data: {
          tenantId,
          processId: proc.id,
          name: p.steps[i]!,
          order: i + 1,
        },
      });
    }
  }

  // ── 6. Subscription (upsert) ──────────────────────────────────────────

  console.log('[demo/polish] Обновление подписки...');

  await prisma.subscription.upsert({
    where: { tenantId },
    update: {
      status: 'DEMO',
      seatsBase: 31,
    },
    create: {
      tenantId,
      status: 'DEMO',
      seatsBase: 31,
      seatsExtra: 0,
      autoRenew: false,
    },
  });

  // ── 7. MeetingsBalance (upsert) ───────────────────────────────────────

  console.log('[demo/polish] Обновление баланса встреч...');

  await prisma.meetingsBalance.upsert({
    where: { tenantId },
    update: {
      balance: 147,
      totalGranted: 150,
      totalConsumed: 3,
    },
    create: {
      tenantId,
      balance: 147,
      totalGranted: 150,
      totalConsumed: 3,
      lastGrantedAt: daysAgo(30),
    },
  });

  console.log(
    `[demo/polish] Создано: ${recognitionDefs.length} Recognition, ` +
    `${spotlightDefs.length} HelpfulnessSpotlight, ` +
    `${badgeSlugs.length} UserBadge, ` +
    `${cardDefs.length} Cards, ` +
    `${processDefs.length} процессов (${processDefs.reduce((s, p) => s + p.steps.length, 0)} шагов), ` +
    `Subscription, MeetingsBalance.`,
  );
};
