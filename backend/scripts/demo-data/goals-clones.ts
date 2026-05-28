/**
 * Демо-данные «ТехноСтрим» — цели, клоны, решения, инсайты.
 *
 * Создаёт: Goal (4), GoalAlignmentSnapshot (12), GoalTheme (10),
 * SkillProfile (4), SkillTrait (18), ExecutablePersona (4),
 * CloneAccessGrant (4), Decision (5), Insight (7).
 */
import type { SeedFn, SeedContext, IdMap } from './types';
import { daysAgo, req } from './types';

export const seedGoalsClones: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId, ownerUserId } = ctx;

  // ── 1. Goals (4) ─────────────────────────────────────────────────────

  console.log('[demo/goals-clones] Создание целей...');

  const goalDefs = [
    {
      key: 'goal_arr',
      name: 'ARR 10M к концу года',
      description: 'Достижение годового регулярного дохода 10 миллионов рублей к 31 декабря 2026. Ключевой стратегический KPI компании.',
      horizon: 'annual' as const,
      cachedAlignment: 72,
      cachedAlignmentDelta: 5,
      targetDate: new Date('2026-12-31'),
    },
    {
      key: 'goal_v2',
      name: 'Релиз платформы v2.0 к 1 июля',
      description: 'Выпуск версии платформы 2.0 с AI-отчётами, графом знаний и обновлённым UI. Ключевой продуктовый milestone.',
      horizon: 'quarterly' as const,
      cachedAlignment: 65,
      cachedAlignmentDelta: -3,
      targetDate: new Date('2026-07-01'),
    },
    {
      key: 'goal_mobile',
      name: 'Мобильное приложение в App Store',
      description: 'Публикация мобильного приложения в Apple App Store и Google Play. Включает видеозвонки, чат и push-уведомления.',
      horizon: 'quarterly' as const,
      cachedAlignment: 55,
      cachedAlignmentDelta: 8,
      targetDate: new Date('2026-07-15'),
    },
    {
      key: 'goal_nps',
      name: 'NPS клиентов > 50',
      description: 'Достижение Net Promoter Score выше 50 среди активных клиентов. Индикатор удовлетворённости продуктом.',
      horizon: 'quarterly' as const,
      cachedAlignment: 80,
      cachedAlignmentDelta: 2,
      targetDate: new Date('2026-06-30'),
    },
  ];

  for (const g of goalDefs) {
    const goal = await prisma.goal.create({
      data: {
        tenantId,
        name: g.name,
        description: g.description,
        createdById: ownerUserId,
        horizon: g.horizon,
        status: 'active',
        cachedAlignment: g.cachedAlignment,
        cachedAlignmentDelta: g.cachedAlignmentDelta,
        targetDate: g.targetDate,
      },
    });
    ids.goals[g.key] = goal.id;
  }

  // ── 2. GoalAlignmentSnapshot (3 per goal = 12) ───────────────────────

  console.log('[demo/goals-clones] Создание snapshots выравнивания целей...');

  const snapshotDefs = [
    {
      goalKey: 'goal_arr',
      scores: [62, 67, 72],
      deltas: [null, 5, 5] as (number | null)[],
      explanations: [
        'Команда активно работает над продажами, но ARR пока ниже целевого.',
        'Рост ARR ускоряется — два новых пилотных клиента на этой неделе.',
        'Пилоты конвертируются в платящих клиентов. ARR растёт стабильно.',
      ],
    },
    {
      goalKey: 'goal_v2',
      scores: [71, 68, 65],
      deltas: [null, -3, -3] as (number | null)[],
      explanations: [
        'Разработка v2.0 идёт по плану, основные модули готовы.',
        'Обнаружены критические уязвимости в auth — часть ресурсов переключена.',
        'Auth-проблемы замедлили релизный график. Риск сдвига дедлайна.',
      ],
    },
    {
      goalKey: 'goal_mobile',
      scores: [42, 47, 55],
      deltas: [null, 5, 8] as (number | null)[],
      explanations: [
        'Мобильное приложение серьёзно отстаёт — SDK видеозвонка сложнее ожидаемого.',
        'Команда нашла обходной путь для SDK. Прогресс ускоряется.',
        'Значительный прогресс: видеозвонки работают, push-уведомления в тесте.',
      ],
    },
    {
      goalKey: 'goal_nps',
      scores: [76, 78, 80],
      deltas: [null, 2, 2] as (number | null)[],
      explanations: [
        'NPS стабилен, клиенты довольны базовым функционалом.',
        'Новые фичи AI-отчётов получили позитивные отзывы.',
        'NPS растёт благодаря улучшению онбординга и поддержке.',
      ],
    },
  ];

  for (const sd of snapshotDefs) {
    for (let i = 0; i < 3; i++) {
      await prisma.goalAlignmentSnapshot.create({
        data: {
          tenantId,
          goalId: req(ids.goals[sd.goalKey], `goal:${sd.goalKey}`),
          score: sd.scores[i]!,
          delta: sd.deltas[i]!,
          explanation: sd.explanations[i]!,
          signals: { ideaBlockCount: 3 + i * 2, meetingCount: 2 + i },
          themesCount: 2 + i,
          blocksCount: 5 + i * 3,
          windowDays: 30,
          createdAt: daysAgo(21 - i * 7),
        },
      });
    }
  }

  // ── 3. GoalTheme (10) ────────────────────────────────────────────────

  console.log('[demo/goals-clones] Привязка целей к темам...');

  const goalThemeDefs: { goalKey: string; themeKey: string; weight: number }[] = [
    { goalKey: 'goal_arr', themeKey: 'th_clients', weight: 1.2 },
    { goalKey: 'goal_arr', themeKey: 'th_competitors', weight: 0.8 },
    { goalKey: 'goal_v2', themeKey: 'th_security', weight: 1.5 },
    { goalKey: 'goal_v2', themeKey: 'th_process', weight: 0.7 },
    { goalKey: 'goal_v2', themeKey: 'th_team', weight: 0.5 },
    { goalKey: 'goal_mobile', themeKey: 'th_mobile', weight: 1.5 },
    { goalKey: 'goal_mobile', themeKey: 'th_team', weight: 0.6 },
    { goalKey: 'goal_nps', themeKey: 'th_clients', weight: 1.0 },
    { goalKey: 'goal_nps', themeKey: 'th_content', weight: 0.5 },
    { goalKey: 'goal_nps', themeKey: 'th_process', weight: 0.4 },
  ];

  for (const gt of goalThemeDefs) {
    await prisma.goalTheme.create({
      data: {
        goalId: req(ids.goals[gt.goalKey], `goal:${gt.goalKey}`),
        themeId: req(ids.themes[gt.themeKey], `theme:${gt.themeKey}`),
        weight: gt.weight,
        source: 'ai',
      },
    });
  }

  // ── 4. SkillProfile + SkillTrait + ExecutablePersona (4 clones) ──────

  console.log('[demo/goals-clones] Создание skill-профилей и клонов...');

  interface CloneDef {
    key: string;
    personKey: string;
    traits: {
      category: string;
      statement: string;
      confidence: 'low' | 'medium' | 'high';
      observationCount: number;
    }[];
    personaPrompt: string;
    publicName: string;
  }

  const cloneDefs: CloneDef[] = [
    {
      key: 'kozlov',
      personKey: 'kozlov',
      traits: [
        { category: 'Экспертиза', statement: 'Глубокая экспертиза в безопасности', confidence: 'high', observationCount: 8 },
        { category: 'Рабочее поведение', statement: 'Склонен брать на себя критические задачи', confidence: 'high', observationCount: 6 },
        { category: 'Технический долг', statement: 'Предпочитает технический долг рефакторингу', confidence: 'medium', observationCount: 4 },
        { category: 'Коммуникация', statement: 'Хорошо объясняет сложные концепции', confidence: 'high', observationCount: 5 },
        { category: 'Нагрузка', statement: 'Иногда перегружен — 5+ задач в спринте', confidence: 'high', observationCount: 7 },
      ],
      personaPrompt: 'Ты — Дмитрий Козлов, Tech Lead компании ТехноСтрим.\nТы глубоко разбираешься в архитектуре микросервисов и безопасности.\nПредпочитаешь прагматичный подход: сначала hotfix, потом рефакторинг.\nЗнаешь auth-модуль от и до. Отвечай конкретно, с примерами кода.',
      publicName: 'Клон Tech Lead',
    },
    {
      key: 'volkova',
      personKey: 'volkova',
      traits: [
        { category: 'Продуктовое мышление', statement: 'Фокус на пользовательских метриках', confidence: 'high', observationCount: 7 },
        { category: 'Принятие решений', statement: 'Быстро принимает решения на данных', confidence: 'high', observationCount: 5 },
        { category: 'Нагрузка', statement: 'Перегружена — ведёт 3 проекта одновременно', confidence: 'high', observationCount: 8 },
        { category: 'CustDev', statement: 'Активно участвует в CustDev', confidence: 'medium', observationCount: 4 },
        { category: 'Приоритизация', statement: 'Хорошо приоритезирует бэклог', confidence: 'high', observationCount: 6 },
      ],
      personaPrompt: 'Ты — Марина Волкова, CPO компании ТехноСтрим.\nФокусируешься на пользовательских метриках и данных.\nВедёшь три продукта: платформу, мобайл и CustDev.\nОтвечай с точки зрения продукта и пользовательской ценности.',
      publicName: 'Клон CPO',
    },
    {
      key: 'sokolova',
      personKey: 'sokolova',
      traits: [
        { category: 'Презентация', statement: 'Сильные навыки презентации продукта', confidence: 'high', observationCount: 6 },
        { category: 'Клиентская работа', statement: 'Умеет выявлять боли клиента', confidence: 'high', observationCount: 7 },
        { category: 'Стиль продаж', statement: 'Агрессивный стиль закрытия сделок', confidence: 'medium', observationCount: 4 },
        { category: 'Конкурентный анализ', statement: 'Знает конкурентов лучше всех в команде', confidence: 'high', observationCount: 5 },
      ],
      personaPrompt: 'Ты — Екатерина Соколова, Head of Sales компании ТехноСтрим.\nСпециализируешься на B2B enterprise-продажах.\nЗнаешь всех конкурентов и их слабые места.\nОтвечай с фокусом на клиентскую ценность и закрытие сделок.',
      publicName: 'Клон Head of Sales',
    },
    {
      key: 'morozov',
      personKey: 'morozov',
      traits: [
        { category: 'Стратегия', statement: 'Стратегическое мышление', confidence: 'high', observationCount: 6 },
        { category: 'Принятие решений', statement: 'Data-driven принятие решений', confidence: 'high', observationCount: 8 },
        { category: 'Делегирование', statement: 'Делегирует технические детали Козлову', confidence: 'medium', observationCount: 5 },
        { category: 'Метрики', statement: 'Фокусируется на метриках роста', confidence: 'high', observationCount: 7 },
      ],
      personaPrompt: 'Ты — Алексей Морозов, CEO и основатель компании ТехноСтрим.\nПринимаешь решения на основе данных и метрик.\nДелегируешь технические вопросы Tech Lead\'у.\nОтвечай стратегически, с фокусом на рост и ARR.',
      publicName: 'Клон CEO',
    },
  ];

  for (const cl of cloneDefs) {
    const profileId = `demo-sp-${cl.key}`;
    const personaId = `demo-ep-${cl.key}`;

    // SkillProfile
    await prisma.skillProfile.create({
      data: {
        id: profileId,
        tenantId,
        personId: req(ids.persons[cl.personKey], `person:${cl.personKey}`),
        status: 'active',
        buildVersion: 3,
        lastBuildAt: daysAgo(1),
      },
    });
    ids.skillProfiles[cl.key] = profileId;

    // SkillTraits
    const traitIds: string[] = [];
    for (let i = 0; i < cl.traits.length; i++) {
      const t = cl.traits[i]!;
      const traitId = `demo-st-${cl.key}-${i}`;
      traitIds.push(traitId);
      await prisma.skillTrait.create({
        data: {
          id: traitId,
          profileId,
          category: t.category,
          statement: t.statement,
          confidence: t.confidence,
          observationCount: t.observationCount,
          firstObservedAt: daysAgo(30),
          lastConfirmedAt: daysAgo(2),
          status: 'active',
        },
      });
    }

    // ExecutablePersona
    await prisma.executablePersona.create({
      data: {
        id: personaId,
        tenantId,
        profileId,
        scope: 'person',
        version: 3,
        personaPrompt: cl.personaPrompt,
        status: 'active',
        builtFromTraitsCount: cl.traits.length,
        publicName: cl.publicName,
        includedTraitIds: traitIds,
      },
    });
  }

  // ── 5. CloneAccessGrant (4) ──────────────────────────────────────────

  console.log('[demo/goals-clones] Выдача доступа к клонам...');

  for (const cl of cloneDefs) {
    await prisma.cloneAccessGrant.create({
      data: {
        tenantId,
        grantedToUserId: ownerUserId,
        cloneType: 'person',
        cloneRefId: req(ids.persons[cl.personKey], `person:${cl.personKey}`),
        grantedById: ownerUserId,
      },
    });
  }

  // ── 6. Decisions (5) ─────────────────────────────────────────────────

  console.log('[demo/goals-clones] Создание решений...');

  const decisionDefs = [
    {
      key: 'd_oauth2',
      statement: 'Миграция на OAuth2 + PKCE',
      rationale: 'JWT-токены без expiration — критическая уязвимость. OAuth2 + PKCE решает проблему безопасной авторизации для SPA и мобильных клиентов.',
      decidedByPersonKeys: ['kozlov', 'morozov'],
      meetingKey: 'security_discussion',
      decidedAt: daysAgo(2),
      status: 'approved' as const,
    },
    {
      key: 'd_design',
      statement: 'Дизайн CallScreen v3 — финальный',
      rationale: 'PiP, запись, шаринг экрана, адаптив под iOS и Android. Утверждён после трёх итераций с командой.',
      decidedByPersonKeys: ['volkova', 'petrova'],
      meetingKey: 'mobile_review',
      decidedAt: daysAgo(6),
      status: 'approved' as const,
    },
    {
      key: 'd_pilot',
      statement: 'Пилот Ростелеком: 500 юзеров',
      rationale: 'Ростелеком готов к пилоту на 500 пользователей. Это ключевой enterprise-клиент для валидации product-market fit.',
      decidedByPersonKeys: ['sokolova', 'morozov'],
      meetingKey: 'custdev_rostelecom',
      decidedAt: daysAgo(8),
      status: 'approved' as const,
    },
    {
      key: 'd_zoom',
      statement: 'Отложить Zoom-интеграцию',
      rationale: 'Zoom демпингует цены. Интеграция не принесёт конкурентного преимущества. Сфокусироваться на собственных AI-фичах.',
      decidedByPersonKeys: ['kozlov'],
      meetingKey: 'retro13',
      decidedAt: daysAgo(10),
      status: 'cancelled' as const,
    },
    {
      key: 'd_review_sl',
      statement: 'Code review SLA: 24 часа',
      rationale: 'Code review занимает более 2 дней, что замедляет delivery. Установить SLA 24 часа с эскалацией к Tech Lead.',
      decidedByPersonKeys: ['kozlov', 'novikov'],
      meetingKey: 'retro13',
      decidedAt: daysAgo(10),
      status: 'approved' as const,
    },
  ];

  const decisionIds: Record<string, string> = {};

  for (const d of decisionDefs) {
    const dec = await prisma.decision.create({
      data: {
        tenantId,
        statement: d.statement,
        rationale: d.rationale,
        decidedByPersonIds: d.decidedByPersonKeys.map((k) => req(ids.persons[k], `person:${k}`)),
        decidedByPersonId: req(ids.persons[d.decidedByPersonKeys[0]!], `person:${d.decidedByPersonKeys[0]}`),
        sourceMeetingId: req(ids.meetings[d.meetingKey], `meeting:${d.meetingKey}`),
        decidedAt: d.decidedAt,
        status: d.status,
        dataClass: 'internal',
      },
    });
    decisionIds[d.key] = dec.id;
  }

  // ── 7. Insights (7) ──────────────────────────────────────────────────

  console.log('[demo/goals-clones] Создание инсайтов...');

  const insightDefs = [
    {
      kind: 'risk' as const,
      statement: 'Козлов — single point of failure для auth',
      severity: 'high' as const,
      dynamicLabel: 'growing' as const,
      causeCategory: 'people',
      personSubjectKeys: ['kozlov'],
    },
    {
      kind: 'problem' as const,
      statement: 'Нет QA-процесса в мобильной команде',
      severity: 'high' as const,
      dynamicLabel: 'stable' as const,
      causeCategory: 'process',
      personSubjectKeys: [],
    },
    {
      kind: 'problem' as const,
      statement: 'Клиенты путаются в тарифах',
      severity: 'medium' as const,
      dynamicLabel: 'growing' as const,
      causeCategory: 'product',
      personSubjectKeys: [],
    },
    {
      kind: 'problem' as const,
      statement: 'Code review занимает > 2 дней',
      severity: 'medium' as const,
      dynamicLabel: 'stable' as const,
      causeCategory: 'process',
      personSubjectKeys: ['kozlov', 'novikov'],
    },
    {
      kind: 'blocker' as const,
      statement: 'Zoom демпингует — нужен value-sell',
      severity: 'medium' as const,
      dynamicLabel: 'stable' as const,
      causeCategory: 'market',
      personSubjectKeys: ['sokolova'],
    },
    {
      kind: 'risk' as const,
      statement: 'Перегрузка Волковой (3 проекта)',
      severity: 'high' as const,
      dynamicLabel: 'growing' as const,
      causeCategory: 'people',
      personSubjectKeys: ['volkova'],
    },
    {
      kind: 'problem' as const,
      statement: 'Нет документации по Kubernetes',
      severity: 'low' as const,
      dynamicLabel: 'declining' as const,
      causeCategory: 'process',
      personSubjectKeys: [],
    },
  ];

  for (const ins of insightDefs) {
    await prisma.insight.create({
      data: {
        tenantId,
        kind: ins.kind,
        statement: ins.statement,
        severity: ins.severity,
        dynamicLabel: ins.dynamicLabel,
        causeCategory: ins.causeCategory,
        dataClass: 'internal',
        status: 'active',
        firstObservedAt: daysAgo(14),
        lastObservedAt: daysAgo(1),
        personSubjectIds: ins.personSubjectKeys.map((k) => req(ids.persons[k], `person:${k}`)),
      },
    });
  }

  console.log(
    `[demo/goals-clones] Создано: ${goalDefs.length} целей, ` +
    `${snapshotDefs.length * 3} snapshots, ${goalThemeDefs.length} GoalTheme, ` +
    `${cloneDefs.length} skill-профилей, ` +
    `${cloneDefs.reduce((s, c) => s + c.traits.length, 0)} trait'ов, ` +
    `${cloneDefs.length} персон, ${cloneDefs.length} грантов, ` +
    `${decisionDefs.length} решений, ${insightDefs.length} инсайтов.`,
  );
};
