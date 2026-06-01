/**
 * Демо-данные «ТехноСтрим» — статичные Pulse snapshot'ы для главной директора.
 *
 * Заполняет 8 моделей, которые читает `pulse-patterns.service.ts` и
 * Team Health Grid:
 *  - KnowledgeRiskSnapshot (5)
 *  - RecurringTopic (4)
 *  - PromiseNetworkSnapshot (1)
 *  - PersonGoalContribution (5 person × 4 goals × 4 weeks = 80)
 *  - KnowledgeVelocitySnapshot (1)
 *  - PersonEngagementSnapshot (5 person × 12 weeks = 60)
 *  - ForecastSnapshot (4)
 *  - CrossFunctionalFrictionReport (3)
 *
 * Все snapshot'ы детерминированы — без Math.random(). Решение владельца
 * (2026-05-31): cron-агенты не дёргаем, snapshot'ы запекаем статично.
 *
 * Окна выборки фронта (см. pulse-patterns.service.ts):
 *  - BusFactor: latest snapshot per categoryName за 30 дней
 *  - RecurringTopic: 14 дней
 *  - Bottleneck: 30 дней (CrossFunctionalFrictionReport.createdAt)
 *  - GoalVector: 4 недели (week-режим) / 12 недель (month-режим)
 *  - KnowledgeVelocity: latest 1 шт без окна
 */
import type { Prisma } from '@prisma/client';

import type { SeedFn } from './types';
import { daysAgo, mondayOf, req } from './types';

export const seedPulseSnapshots: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId } = ctx;

  // ── 1. KnowledgeRiskSnapshot × 5 ───────────────────────────────────────

  const knowledgeRisks = [
    {
      categoryName: 'Авторизация / OAuth2',
      highConfidenceCount: 1,
      totalExpertsCount: 1,
      riskLevel: 'critical',
      experts: [{ personKey: 'kozlov', name: 'Дмитрий Козлов', confidence: 'high' }],
    },
    {
      categoryName: 'Дизайн-система',
      highConfidenceCount: 1,
      totalExpertsCount: 1,
      riskLevel: 'critical',
      experts: [{ personKey: 'petrova', name: 'Анна Петрова', confidence: 'high' }],
    },
    {
      categoryName: 'Kubernetes / DevOps',
      highConfidenceCount: 2,
      totalExpertsCount: 3,
      riskLevel: 'warning',
      experts: [
        { personKey: 'novikov', name: 'Игорь Новиков', confidence: 'high' },
        { personKey: 'kozlov', name: 'Дмитрий Козлов', confidence: 'high' },
        { personKey: 'sidorov', name: 'Павел Сидоров', confidence: 'medium' },
      ],
    },
    {
      categoryName: 'Stripe / платежи',
      highConfidenceCount: 2,
      totalExpertsCount: 2,
      riskLevel: 'warning',
      experts: [
        { personKey: 'novikov', name: 'Игорь Новиков', confidence: 'high' },
        { personKey: 'morozov', name: 'Алексей Морозов', confidence: 'high' },
      ],
    },
    {
      categoryName: 'CustDev / B2B-продажи',
      highConfidenceCount: 4,
      totalExpertsCount: 4,
      riskLevel: 'ok',
      experts: [
        { personKey: 'sokolova', name: 'Екатерина Соколова', confidence: 'high' },
        { personKey: 'volkova', name: 'Марина Волкова', confidence: 'high' },
        { personKey: 'morozov', name: 'Алексей Морозов', confidence: 'high' },
        { personKey: 'lebedev', name: 'Виктор Лебедев', confidence: 'high' },
      ],
    },
  ];

  for (const r of knowledgeRisks) {
    const snap = await prisma.knowledgeRiskSnapshot.create({
      data: {
        tenantId,
        categoryName: r.categoryName,
        highConfidenceCount: r.highConfidenceCount,
        totalExpertsCount: r.totalExpertsCount,
        riskLevel: r.riskLevel,
        topExpertsJson: {
          experts: r.experts.map((e) => ({
            personId: req(ids.persons[e.personKey], `person:${e.personKey}`),
            name: e.name,
            confidence: e.confidence,
          })),
        } as unknown as Prisma.InputJsonValue,
        snapshotAt: daysAgo(1),
      },
    });
    ids.pulseSnapshotIds.knowledgeRisks.push(snap.id);
  }

  // ── 2. RecurringTopic × 4 ──────────────────────────────────────────────

  const recurringTopics = [
    {
      themeKey: null as string | null,
      themeName: 'Storage capacity у клиентов',
      mentionCount: 7,
      meetingCount: 5,
      blockKeys: ['ib1', 'ib16', 'ib19'],
      windowDays: 30,
    },
    {
      themeKey: null,
      themeName: 'Code review SLA',
      mentionCount: 6,
      meetingCount: 4,
      blockKeys: ['ib8', 'ib11'],
      windowDays: 30,
    },
    {
      themeKey: null,
      themeName: 'Онбординг новичков — медленный',
      mentionCount: 5,
      meetingCount: 3,
      blockKeys: ['ib14'],
      windowDays: 30,
    },
    {
      themeKey: null,
      themeName: 'Stripe sandbox нестабилен',
      mentionCount: 5,
      meetingCount: 2,
      blockKeys: [] as string[],
      windowDays: 21,
    },
  ];

  for (const t of recurringTopics) {
    const snap = await prisma.recurringTopic.create({
      data: {
        tenantId,
        themeId: t.themeKey ? ids.themes[t.themeKey] ?? null : null,
        themeName: t.themeName,
        mentionCount: t.mentionCount,
        meetingCount: t.meetingCount,
        hasImplementedDecision: false,
        blockIdsJson: t.blockKeys
          .map((k) => ids.ideaBlocks[k])
          .filter((v): v is string => Boolean(v)) as unknown as Prisma.InputJsonValue,
        windowStart: daysAgo(t.windowDays),
        windowEnd: daysAgo(0),
        snapshotAt: daysAgo(2),
      },
    });
    ids.pulseSnapshotIds.recurringTopics.push(snap.id);
  }

  // ── 3. PromiseNetworkSnapshot × 1 ──────────────────────────────────────

  const networkNodes = [
    { personKey: 'morozov', name: 'Алексей Морозов', role: 'donor', inDegree: 1, outDegree: 4, balance: -3 },
    { personKey: 'volkova', name: 'Марина Волкова', role: 'accumulator', inDegree: 5, outDegree: 1, balance: 4 },
    { personKey: 'kozlov', name: 'Дмитрий Козлов', role: 'accumulator', inDegree: 6, outDegree: 2, balance: 4 },
    { personKey: 'sokolova', name: 'Екатерина Соколова', role: 'balanced', inDegree: 3, outDegree: 3, balance: 0 },
    { personKey: 'petrova', name: 'Анна Петрова', role: 'balanced', inDegree: 2, outDegree: 2, balance: 0 },
  ];

  const networkEdges = [
    { fromKey: 'morozov', toKey: 'kozlov', count: 2 },
    { fromKey: 'morozov', toKey: 'volkova', count: 1 },
    { fromKey: 'morozov', toKey: 'sokolova', count: 1 },
    { fromKey: 'sokolova', toKey: 'volkova', count: 2 },
    { fromKey: 'sokolova', toKey: 'kozlov', count: 1 },
    { fromKey: 'petrova', toKey: 'kozlov', count: 2 },
    { fromKey: 'petrova', toKey: 'volkova', count: 1 },
    { fromKey: 'volkova', toKey: 'kozlov', count: 1 },
  ];

  {
    const snap = await prisma.promiseNetworkSnapshot.create({
      data: {
        tenantId,
        graphJson: {
          nodes: networkNodes.map((n) => ({
            personId: req(ids.persons[n.personKey], `person:${n.personKey}`),
            name: n.name,
            role: n.role,
            inDegree: n.inDegree,
            outDegree: n.outDegree,
            balance: n.balance,
          })),
          edges: networkEdges.map((e) => ({
            fromPersonId: req(ids.persons[e.fromKey], `person:${e.fromKey}`),
            toPersonId: req(ids.persons[e.toKey], `person:${e.toKey}`),
            count: e.count,
          })),
          periodStart: daysAgo(30).toISOString(),
          periodEnd: daysAgo(0).toISOString(),
        } as unknown as Prisma.InputJsonValue,
        totalCommitments: networkEdges.reduce((s, e) => s + e.count, 0),
        snapshotAt: daysAgo(1),
      },
    });
    ids.pulseSnapshotIds.promiseNetwork = snap.id;
  }

  // ── 4. PersonGoalContribution × 80 (5 × 4 goals × 4 weeks) ─────────────

  const personKeys = ['morozov', 'volkova', 'kozlov', 'sokolova', 'petrova'] as const;
  const goalKeys = ['goal_arr', 'goal_v2', 'goal_mobile', 'goal_nps'] as const;
  const weekOffsets = [21, 14, 7, 0] as const;

  type ContribRow = { pro: string; contra: string; kinds: ReadonlyArray<'idea' | 'commitment_kept' | 'commitment_broken' | 'issue_closed'> };
  const CONTRIB_TABLE: Record<typeof personKeys[number], Record<typeof goalKeys[number], ContribRow>> = {
    morozov: {
      goal_arr:    { pro: '6.500', contra: '0.500', kinds: ['idea', 'idea', 'commitment_kept'] },
      goal_v2:     { pro: '2.000', contra: '1.000', kinds: ['idea'] },
      goal_mobile: { pro: '1.500', contra: '0.500', kinds: ['idea'] },
      goal_nps:    { pro: '3.000', contra: '0.500', kinds: ['idea', 'commitment_kept'] },
    },
    volkova: {
      goal_arr:    { pro: '4.500', contra: '0.500', kinds: ['idea', 'idea'] },
      goal_v2:     { pro: '5.500', contra: '1.500', kinds: ['idea', 'commitment_kept'] },
      goal_mobile: { pro: '3.500', contra: '2.000', kinds: ['idea', 'commitment_broken'] },
      goal_nps:    { pro: '4.000', contra: '0.500', kinds: ['idea', 'idea'] },
    },
    kozlov: {
      goal_arr:    { pro: '0.500', contra: '0.500', kinds: ['idea'] },
      goal_v2:     { pro: '8.000', contra: '0.500', kinds: ['issue_closed', 'issue_closed', 'commitment_kept'] },
      goal_mobile: { pro: '1.000', contra: '2.500', kinds: ['commitment_broken'] },
      goal_nps:    { pro: '0.500', contra: '0.000', kinds: [] },
    },
    sokolova: {
      goal_arr:    { pro: '8.000', contra: '0.500', kinds: ['idea', 'commitment_kept', 'commitment_kept'] },
      goal_v2:     { pro: '0.500', contra: '0.500', kinds: ['idea'] },
      goal_mobile: { pro: '1.000', contra: '0.500', kinds: ['idea'] },
      goal_nps:    { pro: '3.500', contra: '1.000', kinds: ['idea', 'commitment_kept'] },
    },
    petrova: {
      goal_arr:    { pro: '1.000', contra: '0.500', kinds: ['idea'] },
      goal_v2:     { pro: '4.500', contra: '0.500', kinds: ['idea', 'issue_closed'] },
      goal_mobile: { pro: '5.000', contra: '0.500', kinds: ['idea', 'issue_closed'] },
      goal_nps:    { pro: '2.000', contra: '0.500', kinds: ['idea'] },
    },
  };

  for (const personKey of personKeys) {
    for (const goalKey of goalKeys) {
      const base = CONTRIB_TABLE[personKey][goalKey];
      for (const offset of weekOffsets) {
        const weekStart = mondayOf(daysAgo(offset));
        const variance = 0.8 + (offset / 21) * 0.4; // 0.8..1.2 в зависимости от недели
        const proNum = parseFloat(base.pro) * variance;
        const contraNum = parseFloat(base.contra) * variance;
        const netNum = proNum - contraNum;

        // IdeaBlock-id под каждую запись — для transparent sourcing.
        const sourceBlockKeys = Object.keys(ids.ideaBlocks);
        const signalsRefs = base.kinds.map((kind, i) => {
          const key = sourceBlockKeys[(personKey.length * 7 + goalKey.length * 3 + offset + i) % sourceBlockKeys.length];
          const refId = key ? ids.ideaBlocks[key] ?? 'demo-ref' : 'demo-ref';
          return {
            kind,
            refId,
            direction: kind === 'commitment_broken' ? 'contra' : 'pro',
          };
        });

        const c = await prisma.personGoalContribution.create({
          data: {
            tenantId,
            personId: req(ids.persons[personKey], `person:${personKey}`),
            goalId: req(ids.goals[goalKey], `goal:${goalKey}`),
            proScore: proNum.toFixed(3),
            contraScore: contraNum.toFixed(3),
            netScore: netNum.toFixed(3),
            signalsJson: signalsRefs as unknown as Prisma.InputJsonValue,
            weekStart,
            snapshotAt: daysAgo(1),
          },
        });
        ids.pulseSnapshotIds.personGoalContributions.push(c.id);
      }
    }
  }

  // ── 5. KnowledgeVelocitySnapshot × 1 ───────────────────────────────────

  {
    await prisma.knowledgeVelocitySnapshot.create({
      data: {
        tenantId,
        medianHoursToAnswer: '6.50',
        resolvedGapsCount: 12,
        openGapsCount: 4,
        topRespondersJson: [
          {
            personId: req(ids.persons.kozlov, 'person:kozlov'),
            name: 'Дмитрий Козлов',
            resolvedCount: 6,
          },
          {
            personId: req(ids.persons.novikov, 'person:novikov'),
            name: 'Игорь Новиков',
            resolvedCount: 4,
          },
          {
            personId: req(ids.persons.morozov, 'person:morozov'),
            name: 'Алексей Морозов',
            resolvedCount: 3,
          },
        ] as unknown as Prisma.InputJsonValue,
        windowStart: daysAgo(30),
        windowEnd: daysAgo(0),
        snapshotAt: daysAgo(1),
      },
    });
    // Берём id из последнего findFirst если нужно — не используется дальше.
    ids.pulseSnapshotIds.knowledgeVelocity = 'created';
  }

  // ── 6. PersonEngagementSnapshot × 60 (5 × 12 weeks) ────────────────────

  // Trajectory: index 0 — текущая неделя, index 11 — 11 недель назад.
  const engagementTrajectories: Record<typeof personKeys[number], readonly number[]> = {
    morozov:  [0.60, 0.65, 0.62, 0.68, 0.70, 0.72, 0.68, 0.75, 0.78, 0.72, 0.70, 0.68],
    volkova:  [0.88, 0.85, 0.90, 0.92, 0.88, 0.85, 0.82, 0.80, 0.78, 0.75, 0.78, 0.80],
    kozlov:   [0.75, 0.78, 0.82, 0.80, 0.78, 0.72, 0.68, 0.65, 0.62, 0.58, 0.55, 0.52], // выгорание
    sokolova: [0.75, 0.80, 0.85, 0.88, 0.90, 0.88, 0.92, 0.90, 0.88, 0.85, 0.82, 0.80],
    petrova:  [0.90, 0.88, 0.85, 0.82, 0.80, 0.78, 0.75, 0.72, 0.70, 0.68, 0.65, 0.62], // выгорание
  };

  for (const personKey of personKeys) {
    const trajectory = engagementTrajectories[personKey];
    for (let w = 0; w < 12; w++) {
      const score = trajectory[w]!;
      const snap = await prisma.personEngagementSnapshot.create({
        data: {
          tenantId,
          personId: req(ids.persons[personKey], `person:${personKey}`),
          score: score.toFixed(3),
          signalsJson: {
            signals: {
              checkin_sentiment: Math.min(1, score + 0.05).toFixed(3),
              checkin_regularity: '0.900',
              commitment_kept_ratio: score > 0.7 ? '0.800' : '0.500',
              meeting_activity: '0.700',
            },
            baseline: '0.700',
          } as unknown as Prisma.InputJsonValue,
          snapshotAt: daysAgo(w * 7),
        },
      });
      ids.pulseSnapshotIds.personEngagements.push(snap.id);
    }
  }

  // ── 7. ForecastSnapshot × 4 (последние 4 недели) ───────────────────────

  const forecastVariants = [
    {
      trend: 'improving',
      risks: ['Bus factor по auth=1'],
      opportunities: ['CustDev Ростелеком положителен'],
      shifts: [
        { metric: 'sentiment_index', direction: 'flat', confidence: 0.7 },
        { metric: 'engagement_avg', direction: 'up', confidence: 0.55 },
      ],
    },
    {
      trend: 'stable',
      risks: ['Bus factor по auth=1', 'Engagement Козлова -5%'],
      opportunities: ['Партнёрство с 1С'],
      shifts: [
        { metric: 'sentiment_index', direction: 'flat', confidence: 0.7 },
        { metric: 'engagement_avg', direction: 'down', confidence: 0.5 },
        { metric: 'commitment_kept_ratio', direction: 'flat', confidence: 0.65 },
      ],
    },
    {
      trend: 'stable',
      risks: ['Engagement Козлова -12% за 4 недели'],
      opportunities: ['Пилот Ростелеком потенциал 2M ARR'],
      shifts: [
        { metric: 'sentiment_index', direction: 'flat', confidence: 0.7 },
        { metric: 'engagement_avg', direction: 'down', confidence: 0.6 },
        { metric: 'commitment_kept_ratio', direction: 'flat', confidence: 0.65 },
      ],
    },
    {
      trend: 'declining',
      risks: [
        'Engagement Козлова -28% за 12 недель',
        'NPS прогноз 48',
        'Storage capacity повторяется 7 раз',
      ],
      opportunities: [] as string[],
      shifts: [
        { metric: 'sentiment_index', direction: 'down', confidence: 0.7 },
        { metric: 'engagement_avg', direction: 'down', confidence: 0.75 },
        { metric: 'commitment_kept_ratio', direction: 'down', confidence: 0.6 },
      ],
    },
  ];

  for (let i = 0; i < forecastVariants.length; i++) {
    const v = forecastVariants[i]!;
    const snap = await prisma.forecastSnapshot.create({
      data: {
        tenantId,
        scope: 'company',
        scopeId: null,
        payloadJson: {
          trend: v.trend,
          risks: v.risks,
          opportunities: v.opportunities,
          expectedShifts: v.shifts,
          modelName: 'demo-deterministic-v1',
          provenance: { weeks: 4 },
        } as unknown as Prisma.InputJsonValue,
        snapshotAt: daysAgo((forecastVariants.length - 1 - i) * 7),
      },
    });
    ids.pulseSnapshotIds.forecasts.push(snap.id);
  }

  // ── 8. CrossFunctionalFrictionReport × 3 ──────────────────────────────

  const frictions = [
    {
      processTemplateKey: 'sales_to_eng',
      severity: 'high',
      description:
        'Sales обещают клиентам функции до согласования с разработкой. 6 случаев за месяц — Engineering догоняет.',
      sourceBlockKeys: ['ib2', 'ib18'],
      involvedDepartmentKeys: ['sales', 'engineering'],
      recommendedAction: 'Внедрить sync-чек до commitment\'а с клиентом.',
      daysAgoCreated: 7,
    },
    {
      processTemplateKey: 'bug_triage',
      severity: 'high',
      description:
        'Нет процесса QA-валидации, баги обнаруживаются в проде. 4 инцидента за 30 дней.',
      sourceBlockKeys: ['ib8', 'ib15'],
      involvedDepartmentKeys: ['engineering'],
      recommendedAction: 'Найм QA-инженера или ротация разработчиков на тестирование.',
      daysAgoCreated: 14,
    },
    {
      processTemplateKey: 'customer_onboarding',
      severity: 'medium',
      description:
        'Маркетинговые материалы не соответствуют возможностям продукта; Customer Success объясняет постоянно.',
      sourceBlockKeys: ['ib10'],
      involvedDepartmentKeys: ['marketing', 'support'],
      recommendedAction: 'Согласование лендингов с CS до публикации.',
      daysAgoCreated: 20,
    },
  ];

  for (const f of frictions) {
    const report = await prisma.crossFunctionalFrictionReport.create({
      data: {
        tenantId,
        processTemplateId: req(
          ids.processTemplates[f.processTemplateKey],
          `processTemplate:${f.processTemplateKey}`,
        ),
        severity: f.severity,
        description: f.description,
        sourceBlockIds: f.sourceBlockKeys
          .map((k) => ids.ideaBlocks[k])
          .filter((v): v is string => Boolean(v)),
        involvedDepartmentIds: f.involvedDepartmentKeys.map((k) =>
          req(ids.departments[k], `dept:${k}`),
        ),
        recommendedAction: f.recommendedAction,
        resolvedAt: null,
        createdAt: daysAgo(f.daysAgoCreated),
      },
    });
    ids.pulseSnapshotIds.frictionReports.push(report.id);
  }

  console.log(
    `[demo/pulse-snapshots] Создано: ${ids.pulseSnapshotIds.knowledgeRisks.length} KnowledgeRisk, ` +
      `${ids.pulseSnapshotIds.recurringTopics.length} RecurringTopic, ` +
      `${ids.pulseSnapshotIds.promiseNetwork ? 1 : 0} PromiseNetwork, ` +
      `${ids.pulseSnapshotIds.personGoalContributions.length} PersonGoalContribution, ` +
      `1 KnowledgeVelocity, ` +
      `${ids.pulseSnapshotIds.personEngagements.length} PersonEngagement, ` +
      `${ids.pulseSnapshotIds.forecasts.length} Forecast, ` +
      `${ids.pulseSnapshotIds.frictionReports.length} FrictionReport.`,
  );
};
