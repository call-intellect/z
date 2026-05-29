/**
 * Демо-данные «ТехноСтрим» — трекер задач.
 *
 * Создаёт: Project (3), Board (6), IssueState (15), Cycle (4), Label (9),
 * Issue (38 + 2 subtasks), IssueAssignee, IssueLabel, IssueChecklist + Item,
 * IssueComment, IssueRelation (5), IssueActivity, SprintHint (3),
 * ProjectDocument (5).
 *
 * Экспортирует seedTracker: SeedFn.
 * Зависит от данных org-structure (ids.persons, ids.departments).
 */
import type { SeedFn, SeedContext, IdMap } from './types';
import { daysAgo, req } from './types';

// ──────────────────────────── Helpers ─────────────────────────────────

/** Assert non-null for Record lookups (Prisma Record<string, string> types return string|undefined). */
function r(v: string | undefined, key: string): string {
  if (!v) throw new Error(`[demo/tracker] ID not found: ${key}`);
  return v;
}

/** Глобальный счётчик epoch (микросекунды) для IssueActivity. */
let epochCursor = BigInt(Date.now()) * BigInt(1000);
function nextEpoch(): bigint {
  epochCursor += BigInt(1_000_000); // +1 секунда
  return epochCursor;
}

// ──────────────────────────── Issue state definitions ────────────────

const STATE_TEMPLATE = [
  { name: 'Бэклог',    category: 'backlog',   sequence: 0, color: '#94A3B8', isDefault: true },
  { name: 'В работе',  category: 'started',   sequence: 1, color: '#F59E0B', isDefault: false },
  { name: 'На ревью',  category: 'started',   sequence: 2, color: '#8B5CF6', isDefault: false },
  { name: 'Готово',    category: 'completed', sequence: 3, color: '#10B981', isDefault: false },
  { name: 'Отменено',  category: 'cancelled', sequence: 4, color: '#EF4444', isDefault: false },
] as const;

// ──────────────────────────── TipTap JSON helper ────────────────────

function tipTapDoc(heading: string, paragraphs: string[]): object {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: heading }],
      },
      ...paragraphs.map(text => ({
        type: 'paragraph',
        content: [{ type: 'text', text }],
      })),
    ],
  };
}

// ──────────────────────────── Main seed function ─────────────────────

export const seedTracker: SeedFn = async (
  ctx: SeedContext,
  ids: IdMap,
): Promise<void> => {
  const { prisma, tenantId, ownerUserId } = ctx;

  /** Shorthand resolvers with non-null assertion. */
  const projectId = (k: string) => r(ids.projects[k], `projects.${k}`);
  const deptId = (k: string) => r(ids.departments[k], `departments.${k}`);
  const issueId = (k: string) => r(ids.issues[k], `issues.${k}`);
  const labelId = (k: string) => r(ids.labels[k], `labels.${k}`);
  const stateId = (projKey: string, stateName: string) => r(ids.states[`${projKey}_${stateName}`], `states.${projKey}_${stateName}`);
  const boardId = (k: string) => r(ids.boards[k], `boards.${k}`);
  const cycleId = (k: string | undefined) => k ? r(ids.cycles[k], `cycles.${k}`) : null;

  console.log('[demo/tracker] Начинаем создание трекера задач...');

  // ═══════════════════════════════════════════════════════════════════
  // 1. PROJECTS (3)
  // ═══════════════════════════════════════════════════════════════════

  console.log('[demo/tracker] Создаю 3 проекта...');

  const projectDefs = [
    {
      key: 'plat',
      slug: 'platform-v2',
      identifier: 'PLAT',
      name: 'Платформа v2.0',
      description: 'Миграция на микросервисы, новый UI, OAuth2 авторизация. Целевой релиз — 1 июля 2026.',
      ownerPersonKey: 'morozov',
      deptKey: 'engineering',
    },
    {
      key: 'mob',
      slug: 'mobile-app',
      identifier: 'MOB',
      name: 'Мобильное приложение',
      description: 'iOS + Android клиенты для платформы. Дизайн-система, Push-уведомления, SDK видеозвонка.',
      ownerPersonKey: 'volkova',
      deptKey: 'product',
    },
    {
      key: 'mkt',
      slug: 'marketing-q2',
      identifier: 'MKT',
      name: 'Маркетинг Q2',
      description: 'Лендинг v2, контент-план, вебинары, таргетированная реклама, партнёрская программа.',
      ownerPersonKey: 'sokolova',
      deptKey: 'marketing',
    },
  ];

  for (const p of projectDefs) {
    const proj = await prisma.project.create({
      data: {
        tenantId,
        slug: p.slug,
        identifier: p.identifier,
        name: p.name,
        description: p.description,
        ownerId: ownerUserId,
        departmentId: deptId(p.deptKey),
      },
    });
    ids.projects[p.key] = proj.id;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 2. ISSUE STATES (5 per project = 15)
  // ═══════════════════════════════════════════════════════════════════

  console.log('[demo/tracker] Создаю 15 статусов задач (5 на проект)...');

  const projectKeys = ['plat', 'mob', 'mkt'] as const;
  for (const projKey of projectKeys) {
    for (const s of STATE_TEMPLATE) {
      const state = await prisma.issueState.create({
        data: {
          tenantId,
          projectId: ids.projects[projKey]!,
          name: s.name,
          category: s.category,
          sequence: s.sequence,
          color: s.color,
          isDefault: s.isDefault,
        },
      });
      ids.states[`${projKey}_${s.name}`] = state.id;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 3. BOARDS (6)
  // ═══════════════════════════════════════════════════════════════════

  console.log('[demo/tracker] Создаю 6 досок...');

  const boardDefs: {
    project: string; key: string; name: string; color: string; isDefault: boolean;
  }[] = [
    { project: 'plat', key: 'plat_main',  name: 'Основная', color: '#3B82F6', isDefault: true },
    { project: 'plat', key: 'plat_bugs',  name: 'Баги',     color: '#EF4444', isDefault: false },
    { project: 'plat', key: 'plat_infra', name: 'Инфра',    color: '#8B5CF6', isDefault: false },
    { project: 'mob',  key: 'mob_main',   name: 'Основная', color: '#10B981', isDefault: true },
    { project: 'mob',  key: 'mob_design', name: 'Дизайн',   color: '#F59E0B', isDefault: false },
    { project: 'mkt',  key: 'mkt_main',   name: 'Основная', color: '#EC4899', isDefault: true },
  ];

  for (const b of boardDefs) {
    const board = await prisma.board.create({
      data: {
        tenantId,
        projectId: projectId(b.project),
        name: b.name,
        color: b.color,
        isDefault: b.isDefault,
      },
    });
    ids.boards[b.key] = board.id;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 4. CYCLES (4)
  // ═══════════════════════════════════════════════════════════════════

  console.log('[demo/tracker] Создаю 4 цикла (спринта)...');

  const cycleDefs: {
    key: string; project: string; name: string;
    startDaysAgo: number; endDaysAgo: number; completed: boolean;
  }[] = [
    { key: 'sprint14',    project: 'plat', name: 'Sprint 14', startDaysAgo: 9,  endDaysAgo: -5, completed: false },
    { key: 'sprint13',    project: 'plat', name: 'Sprint 13', startDaysAgo: 23, endDaysAgo: 10, completed: true },
    { key: 'sprint3_mob', project: 'mob',  name: 'Sprint 3',  startDaysAgo: 9,  endDaysAgo: -5, completed: false },
    { key: 'sprint2_mob', project: 'mob',  name: 'Sprint 2',  startDaysAgo: 23, endDaysAgo: 10, completed: true },
  ];

  for (const c of cycleDefs) {
    const endDate = daysAgo(c.endDaysAgo);
    const cycle = await prisma.cycle.create({
      data: {
        tenantId,
        projectId: projectId(c.project),
        name: c.name,
        startDate: daysAgo(c.startDaysAgo),
        endDate,
        completedAt: c.completed ? endDate : null,
      },
    });
    ids.cycles[c.key] = cycle.id;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 5. LABELS (9)
  // ═══════════════════════════════════════════════════════════════════

  console.log('[demo/tracker] Создаю 9 меток...');

  const labelDefs: { project: string; key: string; name: string; color: string }[] = [
    { project: 'plat', key: 'l_backend',  name: 'backend',  color: '#3B82F6' },
    { project: 'plat', key: 'l_frontend', name: 'frontend', color: '#10B981' },
    { project: 'plat', key: 'l_infra',    name: 'infra',    color: '#8B5CF6' },
    { project: 'plat', key: 'l_security', name: 'security', color: '#EF4444' },
    { project: 'mob',  key: 'l_ios',      name: 'ios',      color: '#6366F1' },
    { project: 'mob',  key: 'l_android',  name: 'android',  color: '#14B8A6' },
    { project: 'mob',  key: 'l_design',   name: 'design',   color: '#F59E0B' },
    { project: 'mkt',  key: 'l_content',  name: 'content',  color: '#EC4899' },
    { project: 'mkt',  key: 'l_paid',     name: 'paid',     color: '#F97316' },
  ];

  for (const l of labelDefs) {
    const label = await prisma.label.create({
      data: {
        tenantId,
        projectId: projectId(l.project),
        name: l.name,
        color: l.color,
      },
    });
    ids.labels[l.key] = label.id;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 6. ISSUES (38 + 2 subtasks = 40 records)
  // ═══════════════════════════════════════════════════════════════════

  console.log('[demo/tracker] Создаю 38 задач (+ 2 подзадачи PLAT-12)...');

  /** State ID resolver. */
  const S = (projKey: string, stateName: string): string => ids.states[`${projKey}_${stateName}`]!;
  /** Board ID resolver. */
  const B = (key: string): string => ids.boards[key]!;
  /** Cycle ID resolver (optional). */
  const C = (key: string | undefined): string | null => key ? ids.cycles[key]! : null;

  /** Shortcut: completedAt for sprint-13 completed issues. */
  const doneSprint13 = (offsetDays: number): Date => daysAgo(10 + offsetDays);

  // ── Issue definitions ──────────────────────────────────────────────

  interface IssueDef {
    key: string;
    identifier: string;
    seq: number;
    project: string;
    title: string;
    state: string;
    priority: string;
    assignee?: string;
    board: string;
    cycle?: string;
    labels: string[];
    description?: string;
    parentKey?: string;
    completedAt?: Date | null;
    createdAt: Date;
    checklist?: { text: string; done: boolean }[];
  }

  const allIssues: IssueDef[] = [
    // ═══════════ PLAT project (18 issues) ═══════════

    {
      key: 'PLAT-1', identifier: 'PLAT-1', seq: 1, project: 'plat',
      title: 'Настроить CI/CD pipeline',
      state: 'Готово', priority: 'medium', assignee: 'novikov',
      board: 'plat_infra', cycle: 'sprint13', labels: ['l_infra'],
      completedAt: doneSprint13(2), createdAt: daysAgo(22),
      checklist: [
        { text: 'Docker registry', done: true },
        { text: 'GitHub Actions', done: true },
        { text: 'Staging deploy', done: true },
        { text: 'Prod deploy', done: true },
      ],
    },
    {
      key: 'PLAT-2', identifier: 'PLAT-2', seq: 2, project: 'plat',
      title: 'Лендинг v1',
      state: 'Готово', priority: 'medium', assignee: 'petrova',
      board: 'plat_main', cycle: 'sprint13', labels: ['l_frontend'],
      completedAt: doneSprint13(3), createdAt: daysAgo(22),
    },
    {
      key: 'PLAT-3', identifier: 'PLAT-3', seq: 3, project: 'plat',
      title: 'Рефакторить API-гейтвей',
      state: 'Готово', priority: 'high', assignee: 'kozlov',
      board: 'plat_main', cycle: 'sprint13', labels: ['l_backend'],
      completedAt: doneSprint13(1), createdAt: daysAgo(21),
    },
    {
      key: 'PLAT-4', identifier: 'PLAT-4', seq: 4, project: 'plat',
      title: 'Настроить мониторинг Grafana',
      state: 'Готово', priority: 'medium', assignee: 'novikov',
      board: 'plat_infra', cycle: 'sprint13', labels: ['l_infra'],
      completedAt: doneSprint13(4), createdAt: daysAgo(20),
    },
    {
      key: 'PLAT-5', identifier: 'PLAT-5', seq: 5, project: 'plat',
      title: 'Интеграция с Cloudflare CDN',
      state: 'Готово', priority: 'low', assignee: 'novikov',
      board: 'plat_infra', labels: ['l_infra'],
      completedAt: daysAgo(8), createdAt: daysAgo(15),
    },
    {
      key: 'PLAT-6', identifier: 'PLAT-6', seq: 6, project: 'plat',
      title: 'Дизайн дашборда',
      state: 'Готово', priority: 'medium', assignee: 'petrova',
      board: 'plat_main', cycle: 'sprint13', labels: ['l_frontend'],
      completedAt: doneSprint13(0), createdAt: daysAgo(21),
    },
    {
      key: 'PLAT-7', identifier: 'PLAT-7', seq: 7, project: 'plat',
      title: 'Рефакторить модуль авторизации',
      state: 'В работе', priority: 'high', assignee: 'kozlov',
      board: 'plat_main', cycle: 'sprint14', labels: ['l_backend', 'l_security'],
      createdAt: daysAgo(8),
      description: 'Текущий модуль авторизации на JWT без refresh-токенов. Необходимо мигрировать на OAuth2 + PKCE flow для поддержки внешних провайдеров (Google, Yandex, SberID). Затрагивает 3 микросервиса: auth-gateway, user-service, session-manager. Требуется backward-compatible API для мобильных клиентов v1.',
      checklist: [
        { text: 'Аудит текущих эндпоинтов авторизации', done: true },
        { text: 'Дизайн OAuth2 + PKCE flow', done: true },
        { text: 'Миграция auth-gateway на новый flow', done: false },
        { text: 'Миграция user-service и session-manager', done: false },
      ],
    },
    {
      key: 'PLAT-8', identifier: 'PLAT-8', seq: 8, project: 'plat',
      title: 'Миграция user-service на новый ORM',
      state: 'В работе', priority: 'medium', assignee: 'novikov',
      board: 'plat_main', cycle: 'sprint14', labels: ['l_backend'],
      createdAt: daysAgo(7),
    },
    {
      key: 'PLAT-9', identifier: 'PLAT-9', seq: 9, project: 'plat',
      title: 'Оптимизация WebSocket-соединений',
      state: 'В работе', priority: 'high', assignee: 'kozlov',
      board: 'plat_main', cycle: 'sprint14', labels: ['l_backend'],
      createdAt: daysAgo(7),
    },
    {
      key: 'PLAT-10', identifier: 'PLAT-10', seq: 10, project: 'plat',
      title: 'Обновить документацию API',
      state: 'В работе', priority: 'low', assignee: 'sidorov',
      board: 'plat_main', cycle: 'sprint14', labels: ['l_backend'],
      createdAt: daysAgo(6),
    },
    {
      key: 'PLAT-11', identifier: 'PLAT-11', seq: 11, project: 'plat',
      title: 'E2E тесты для auth-flow',
      state: 'В работе', priority: 'medium', assignee: 'popov',
      board: 'plat_bugs', cycle: 'sprint14', labels: ['l_backend'],
      createdAt: daysAgo(6),
    },
    {
      key: 'PLAT-12', identifier: 'PLAT-12', seq: 12, project: 'plat',
      title: 'Миграция на Kubernetes',
      state: 'Бэклог', priority: 'medium', assignee: 'novikov',
      board: 'plat_infra', labels: ['l_infra'],
      createdAt: daysAgo(18),
      description: 'Переезд с Docker Compose на Kubernetes (K8s). Включает: подготовку Helm charts, настройку namespace-ов, CI/CD pipeline для K8s, staging и prod окружения, документацию для DevOps.',
      checklist: [
        { text: 'Аудит текущих Docker-контейнеров', done: false },
        { text: 'Подготовка Helm charts', done: false },
        { text: 'Настройка namespace-ов (staging, prod)', done: false },
        { text: 'CI/CD pipeline для K8s', done: false },
        { text: 'Развёртывание staging-окружения', done: false },
        { text: 'Документация для DevOps', done: false },
      ],
    },
    {
      key: 'PLAT-13', identifier: 'PLAT-13', seq: 13, project: 'plat',
      title: 'Интеграция с Slack',
      state: 'Бэклог', priority: 'low',
      board: 'plat_main', labels: ['l_backend'],
      createdAt: daysAgo(16),
    },
    {
      key: 'PLAT-14', identifier: 'PLAT-14', seq: 14, project: 'plat',
      title: 'Тёмная тема',
      state: 'Бэклог', priority: 'low',
      board: 'plat_main', labels: ['l_frontend'],
      createdAt: daysAgo(15),
    },
    {
      key: 'PLAT-15', identifier: 'PLAT-15', seq: 15, project: 'plat',
      title: 'Баг: переподключение при потере сети',
      state: 'В работе', priority: 'high', assignee: 'sidorov',
      board: 'plat_bugs', cycle: 'sprint14', labels: ['l_frontend'],
      createdAt: daysAgo(5),
    },
    {
      key: 'PLAT-16', identifier: 'PLAT-16', seq: 16, project: 'plat',
      title: 'Баг: дублирование сообщений в чате',
      state: 'Готово', priority: 'medium', assignee: 'popov',
      board: 'plat_bugs', cycle: 'sprint13', labels: ['l_backend'],
      completedAt: doneSprint13(1), createdAt: daysAgo(18),
    },
    {
      key: 'PLAT-17', identifier: 'PLAT-17', seq: 17, project: 'plat',
      title: 'Rate limiting на API',
      state: 'В работе', priority: 'high', assignee: 'kozlov',
      board: 'plat_main', cycle: 'sprint14', labels: ['l_backend', 'l_security'],
      createdAt: daysAgo(5),
    },
    {
      key: 'PLAT-18', identifier: 'PLAT-18', seq: 18, project: 'plat',
      title: 'Интеграция с Zoom',
      state: 'Отменено', priority: 'low',
      board: 'plat_main', labels: ['l_backend'],
      createdAt: daysAgo(14),
    },

    // ═══════════ MOB project (12 issues) ═══════════

    {
      key: 'MOB-1', identifier: 'MOB-1', seq: 1, project: 'mob',
      title: 'Архитектура мобильного приложения',
      state: 'Готово', priority: 'high', assignee: 'kozlov',
      board: 'mob_main', cycle: 'sprint2_mob', labels: [],
      completedAt: doneSprint13(3), createdAt: daysAgo(22),
    },
    {
      key: 'MOB-2', identifier: 'MOB-2', seq: 2, project: 'mob',
      title: 'React Native setup',
      state: 'Готово', priority: 'medium', assignee: 'sidorov',
      board: 'mob_main', cycle: 'sprint2_mob', labels: ['l_ios', 'l_android'],
      completedAt: doneSprint13(2), createdAt: daysAgo(21),
    },
    {
      key: 'MOB-3', identifier: 'MOB-3', seq: 3, project: 'mob',
      title: 'Дизайн экрана видеозвонка',
      state: 'В работе', priority: 'high', assignee: 'petrova',
      board: 'mob_design', cycle: 'sprint3_mob', labels: ['l_design'],
      createdAt: daysAgo(7),
      description: 'Адаптивный дизайн экрана видеозвонка для iOS и Android. Поддержка Picture-in-Picture, записи звонков, демонстрации экрана. Референсы: Zoom, Google Meet, но проще и легче. Упор на mobile-first UX: крупные кнопки, минимум элементов, быстрый доступ к mute/camera.',
    },
    {
      key: 'MOB-4', identifier: 'MOB-4', seq: 4, project: 'mob',
      title: 'Дизайн экрана списка встреч',
      state: 'Готово', priority: 'medium', assignee: 'petrova',
      board: 'mob_design', cycle: 'sprint2_mob', labels: ['l_design'],
      completedAt: doneSprint13(1), createdAt: daysAgo(20),
    },
    {
      key: 'MOB-5', identifier: 'MOB-5', seq: 5, project: 'mob',
      title: 'Push-уведомления iOS',
      state: 'В работе', priority: 'medium', assignee: 'sidorov',
      board: 'mob_main', cycle: 'sprint3_mob', labels: ['l_ios'],
      createdAt: daysAgo(6),
    },
    {
      key: 'MOB-6', identifier: 'MOB-6', seq: 6, project: 'mob',
      title: 'Push-уведомления Android',
      state: 'В работе', priority: 'medium', assignee: 'sidorov',
      board: 'mob_main', cycle: 'sprint3_mob', labels: ['l_android'],
      createdAt: daysAgo(6),
    },
    {
      key: 'MOB-7', identifier: 'MOB-7', seq: 7, project: 'mob',
      title: 'Интеграция SDK видеозвонка',
      state: 'Бэклог', priority: 'high',
      board: 'mob_main', labels: ['l_ios', 'l_android'],
      createdAt: daysAgo(14),
    },
    {
      key: 'MOB-8', identifier: 'MOB-8', seq: 8, project: 'mob',
      title: 'Offline-режим',
      state: 'Бэклог', priority: 'medium',
      board: 'mob_main', labels: [],
      createdAt: daysAgo(12),
    },
    {
      key: 'MOB-9', identifier: 'MOB-9', seq: 9, project: 'mob',
      title: 'Дизайн онбординга',
      state: 'В работе', priority: 'medium', assignee: 'petrova',
      board: 'mob_design', cycle: 'sprint3_mob', labels: ['l_design'],
      createdAt: daysAgo(5),
    },
    {
      key: 'MOB-10', identifier: 'MOB-10', seq: 10, project: 'mob',
      title: 'Адаптация под планшеты',
      state: 'Бэклог', priority: 'low',
      board: 'mob_design', labels: ['l_design'],
      createdAt: daysAgo(10),
    },
    {
      key: 'MOB-11', identifier: 'MOB-11', seq: 11, project: 'mob',
      title: 'Тестирование на реальных устройствах',
      state: 'В работе', priority: 'medium', assignee: 'popov',
      board: 'mob_main', cycle: 'sprint3_mob', labels: [],
      createdAt: daysAgo(4),
    },
    {
      key: 'MOB-12', identifier: 'MOB-12', seq: 12, project: 'mob',
      title: 'App Store submission prep',
      state: 'Бэклог', priority: 'medium',
      board: 'mob_main', labels: ['l_ios'],
      createdAt: daysAgo(8),
    },

    // ═══════════ MKT project (8 issues) ═══════════

    {
      key: 'MKT-1', identifier: 'MKT-1', seq: 1, project: 'mkt',
      title: 'Стратегия контент-маркетинга',
      state: 'Готово', priority: 'high', assignee: 'kuznetsova',
      board: 'mkt_main', labels: ['l_content'],
      completedAt: daysAgo(12), createdAt: daysAgo(22),
    },
    {
      key: 'MKT-2', identifier: 'MKT-2', seq: 2, project: 'mkt',
      title: 'Новый лендинг',
      state: 'Готово', priority: 'high', assignee: 'petrova',
      board: 'mkt_main', labels: ['l_content'],
      completedAt: daysAgo(11), createdAt: daysAgo(21),
    },
    {
      key: 'MKT-3', identifier: 'MKT-3', seq: 3, project: 'mkt',
      title: 'SEO-аудит',
      state: 'Готово', priority: 'medium', assignee: 'kuznetsova',
      board: 'mkt_main', labels: [],
      completedAt: daysAgo(13), createdAt: daysAgo(20),
    },
    {
      key: 'MKT-4', identifier: 'MKT-4', seq: 4, project: 'mkt',
      title: 'Email-рассылка: настройка',
      state: 'Готово', priority: 'medium', assignee: 'kuznetsova',
      board: 'mkt_main', labels: [],
      completedAt: daysAgo(10), createdAt: daysAgo(18),
    },
    {
      key: 'MKT-5', identifier: 'MKT-5', seq: 5, project: 'mkt',
      title: 'Подготовка вебинара «Как мы мигрировали на K8s»',
      state: 'Готово', priority: 'medium', assignee: 'kuznetsova',
      board: 'mkt_main', labels: ['l_content'],
      completedAt: daysAgo(8), createdAt: daysAgo(16),
      description: 'Целевая аудитория — CTO и DevOps малых компаний. Длительность 45 мин + 15 мин Q&A. Спикер: Дмитрий Козлов. Формат: live-демо миграции + разбор ошибок.',
    },
    {
      key: 'MKT-6', identifier: 'MKT-6', seq: 6, project: 'mkt',
      title: 'Таргетированная реклама Q2',
      state: 'В работе', priority: 'medium', assignee: 'kuznetsova',
      board: 'mkt_main', cycle: 'sprint3_mob', labels: ['l_paid'],
      createdAt: daysAgo(5),
    },
    {
      key: 'MKT-7', identifier: 'MKT-7', seq: 7, project: 'mkt',
      title: 'Кейс для Ростелеком',
      state: 'В работе', priority: 'medium', assignee: 'kuznetsova',
      board: 'mkt_main', labels: ['l_content'],
      createdAt: daysAgo(4),
    },
    {
      key: 'MKT-8', identifier: 'MKT-8', seq: 8, project: 'mkt',
      title: 'A/B тесты тарифных страниц',
      state: 'Бэклог', priority: 'low',
      board: 'mkt_main', labels: [],
      createdAt: daysAgo(10),
    },
  ];

  // ── Create all issues ──────────────────────────────────────────────

  for (const iss of allIssues) {
    const checklistTotal = iss.checklist?.length ?? 0;
    const checklistDone = iss.checklist?.filter(c => c.done).length ?? 0;

    const issue = await prisma.issue.create({
      data: {
        tenantId,
        projectId: req(ids.projects[iss.project], `${iss.project} project`),
        identifier: iss.identifier,
        sequenceId: iss.seq,
        title: iss.title,
        description: iss.description ?? null,
        priority: iss.priority,
        stateId: S(iss.project, iss.state),
        boardId: B(iss.board),
        cycleId: C(iss.cycle),
        parentId: iss.parentKey ? req(ids.issues[iss.parentKey], iss.parentKey) : null,
        createdById: ownerUserId,
        externalSource: 'demo',
        createdManually: true,
        createdAt: iss.createdAt,
        completedAt: iss.completedAt ?? null,
        checklistTotalCount: checklistTotal,
        checklistDoneCount: checklistDone,
      },
    });
    ids.issues[iss.key] = issue.id;
  }

  // ── Subtasks for PLAT-12 ──────────────────────────────────────────

  console.log('[demo/tracker] Создаю 2 подзадачи PLAT-12...');

  const subtask1 = await prisma.issue.create({
    data: {
      tenantId,
      projectId: req(ids.projects['plat'], 'plat project'),
      identifier: 'PLAT-19',
      sequenceId: 19,
      title: 'Dockerfile оптимизация',
      priority: 'medium',
      stateId: S('plat', 'В работе'),
      boardId: B('plat_infra'),
      parentId: ids.issues['PLAT-12']!,
      createdById: ownerUserId,
      externalSource: 'demo',
      createdManually: true,
      createdAt: daysAgo(16),
    },
  });
  ids.issues['PLAT-12.1'] = subtask1.id;

  const subtask2 = await prisma.issue.create({
    data: {
      tenantId,
      projectId: ids.projects['plat']!,
      identifier: 'PLAT-20',
      sequenceId: 20,
      title: 'Helm chart для auth-service',
      priority: 'low',
      stateId: S('plat', 'Бэклог'),
      boardId: B('plat_infra'),
      parentId: ids.issues['PLAT-12']!,
      createdById: ownerUserId,
      externalSource: 'demo',
      createdManually: true,
      createdAt: daysAgo(16),
    },
  });
  ids.issues['PLAT-12.2'] = subtask2.id;

  // ═══════════════════════════════════════════════════════════════════
  // 7. ISSUE ASSIGNEES
  // ═══════════════════════════════════════════════════════════════════

  console.log('[demo/tracker] Создаю IssueAssignee...');

  const assigneeMap: Record<string, string> = {
    'PLAT-1': 'novikov', 'PLAT-2': 'petrova', 'PLAT-3': 'kozlov',
    'PLAT-4': 'novikov', 'PLAT-5': 'novikov', 'PLAT-6': 'petrova',
    'PLAT-7': 'kozlov', 'PLAT-8': 'novikov', 'PLAT-9': 'kozlov',
    'PLAT-10': 'sidorov', 'PLAT-11': 'popov', 'PLAT-12': 'novikov',
    'PLAT-15': 'sidorov', 'PLAT-16': 'popov', 'PLAT-17': 'kozlov',
    'MOB-1': 'kozlov', 'MOB-2': 'sidorov', 'MOB-3': 'petrova',
    'MOB-4': 'petrova', 'MOB-5': 'sidorov', 'MOB-6': 'sidorov',
    'MOB-9': 'petrova', 'MOB-11': 'popov',
    'MKT-1': 'kuznetsova', 'MKT-2': 'petrova', 'MKT-3': 'kuznetsova',
    'MKT-4': 'kuznetsova', 'MKT-5': 'kuznetsova', 'MKT-6': 'kuznetsova',
    'MKT-7': 'kuznetsova',
  };

  for (const issueKey of Object.keys(assigneeMap)) {
    await prisma.issueAssignee.create({
      data: {
        issueId: ids.issues[issueKey]!,
        userId: ownerUserId,
        assignedById: ownerUserId,
      },
    });
  }

  // Subtask assignee: PLAT-12.1 assigned to novikov
  await prisma.issueAssignee.create({
    data: {
      issueId: ids.issues['PLAT-12.1']!,
      userId: ownerUserId,
      assignedById: ownerUserId,
    },
  });

  // ═══════════════════════════════════════════════════════════════════
  // 8. ISSUE LABELS
  // ═══════════════════════════════════════════════════════════════════

  console.log('[demo/tracker] Создаю IssueLabel...');

  const issueLabelDefs: { issueKey: string; labelKeys: string[] }[] = [
    { issueKey: 'PLAT-1',  labelKeys: ['l_infra'] },
    { issueKey: 'PLAT-2',  labelKeys: ['l_frontend'] },
    { issueKey: 'PLAT-3',  labelKeys: ['l_backend'] },
    { issueKey: 'PLAT-4',  labelKeys: ['l_infra'] },
    { issueKey: 'PLAT-5',  labelKeys: ['l_infra'] },
    { issueKey: 'PLAT-6',  labelKeys: ['l_frontend'] },
    { issueKey: 'PLAT-7',  labelKeys: ['l_backend', 'l_security'] },
    { issueKey: 'PLAT-8',  labelKeys: ['l_backend'] },
    { issueKey: 'PLAT-9',  labelKeys: ['l_backend'] },
    { issueKey: 'PLAT-10', labelKeys: ['l_backend'] },
    { issueKey: 'PLAT-11', labelKeys: ['l_backend'] },
    { issueKey: 'PLAT-12', labelKeys: ['l_infra'] },
    { issueKey: 'PLAT-13', labelKeys: ['l_backend'] },
    { issueKey: 'PLAT-14', labelKeys: ['l_frontend'] },
    { issueKey: 'PLAT-15', labelKeys: ['l_frontend'] },
    { issueKey: 'PLAT-16', labelKeys: ['l_backend'] },
    { issueKey: 'PLAT-17', labelKeys: ['l_backend', 'l_security'] },
    { issueKey: 'PLAT-18', labelKeys: ['l_backend'] },
    { issueKey: 'MOB-2',   labelKeys: ['l_ios', 'l_android'] },
    { issueKey: 'MOB-3',   labelKeys: ['l_design'] },
    { issueKey: 'MOB-4',   labelKeys: ['l_design'] },
    { issueKey: 'MOB-5',   labelKeys: ['l_ios'] },
    { issueKey: 'MOB-6',   labelKeys: ['l_android'] },
    { issueKey: 'MOB-7',   labelKeys: ['l_ios', 'l_android'] },
    { issueKey: 'MOB-9',   labelKeys: ['l_design'] },
    { issueKey: 'MOB-10',  labelKeys: ['l_design'] },
    { issueKey: 'MOB-12',  labelKeys: ['l_ios'] },
    { issueKey: 'MKT-1',   labelKeys: ['l_content'] },
    { issueKey: 'MKT-2',   labelKeys: ['l_content'] },
    { issueKey: 'MKT-5',   labelKeys: ['l_content'] },
    { issueKey: 'MKT-6',   labelKeys: ['l_paid'] },
    { issueKey: 'MKT-7',   labelKeys: ['l_content'] },
  ];

  for (const il of issueLabelDefs) {
    for (const lk of il.labelKeys) {
      await prisma.issueLabel.create({
        data: {
          issueId: ids.issues[il.issueKey]!,
          labelId: ids.labels[lk]!,
        },
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 9. ISSUE CHECKLISTS + ITEMS
  // ═══════════════════════════════════════════════════════════════════

  console.log('[demo/tracker] Создаю чек-листы...');

  async function createChecklist(
    issueKey: string,
    title: string,
    items: { text: string; done: boolean }[],
  ): Promise<void> {
    const cl = await prisma.issueChecklist.create({
      data: {
        tenantId,
        issueId: ids.issues[issueKey]!,
        title,
        sequence: 0,
      },
    });
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      await prisma.issueChecklistItem.create({
        data: {
          tenantId,
          checklistId: cl.id,
          text: item.text,
          isDone: item.done,
          sequence: i,
          completedAt: item.done ? daysAgo(2) : null,
        },
      });
    }
  }

  // PLAT-1 checklist (4 items, all done)
  await createChecklist('PLAT-1', 'CI/CD Pipeline', [
    { text: 'Docker registry', done: true },
    { text: 'GitHub Actions', done: true },
    { text: 'Staging deploy', done: true },
    { text: 'Prod deploy', done: true },
  ]);

  // PLAT-7 checklist (4 items, 2 done)
  await createChecklist('PLAT-7', 'OAuth2 миграция', [
    { text: 'Аудит текущих эндпоинтов авторизации', done: true },
    { text: 'Дизайн OAuth2 + PKCE flow', done: true },
    { text: 'Миграция auth-gateway на новый flow', done: false },
    { text: 'Миграция user-service и session-manager', done: false },
  ]);

  // PLAT-12 checklist (6 items, 0 done)
  await createChecklist('PLAT-12', 'K8s миграция', [
    { text: 'Аудит текущих Docker-контейнеров', done: false },
    { text: 'Подготовка Helm charts', done: false },
    { text: 'Настройка namespace-ов (staging, prod)', done: false },
    { text: 'CI/CD pipeline для K8s', done: false },
    { text: 'Развёртывание staging-окружения', done: false },
    { text: 'Документация для DevOps', done: false },
  ]);

  // MOB-1 checklist (architecture decisions, all done)
  await createChecklist('MOB-1', 'Архитектурные решения', [
    { text: 'Выбор фреймворка (React Native)', done: true },
    { text: 'Навигация (React Navigation)', done: true },
    { text: 'State management (Zustand)', done: true },
    { text: 'Видео SDK (LiveKit Mobile)', done: true },
  ]);

  // MOB-3 checklist (design stages)
  await createChecklist('MOB-3', 'Этапы дизайна', [
    { text: 'Wireframes', done: true },
    { text: 'Hi-fi мокапы', done: true },
    { text: 'Прототип в Figma', done: false },
    { text: 'Ревью с командой', done: false },
  ]);

  // MKT-5 checklist (webinar prep)
  await createChecklist('MKT-5', 'Подготовка вебинара', [
    { text: 'Сценарий и слайды', done: true },
    { text: 'Репетиция', done: true },
    { text: 'Запись и монтаж', done: true },
    { text: 'Публикация на YouTube', done: true },
  ]);

  // ═══════════════════════════════════════════════════════════════════
  // 10. ISSUE COMMENTS
  // ═══════════════════════════════════════════════════════════════════

  console.log('[demo/tracker] Создаю комментарии...');

  // PLAT-1: 2 comments
  await prisma.issueComment.createMany({
    data: [
      {
        issueId: ids.issues['PLAT-1']!,
        authorId: ownerUserId,
        content: 'Pipeline готов. staging деплоится за 3 минуты, prod — за 5 с canary-развёртыванием.',
        createdAt: daysAgo(14),
      },
      {
        issueId: ids.issues['PLAT-1']!,
        authorId: ownerUserId,
        content: 'Отлично. Добавь в документацию схему pipeline для онбординга новых разработчиков.',
        createdAt: daysAgo(13),
      },
    ],
  });

  // PLAT-3: 3 comments
  await prisma.issueComment.createMany({
    data: [
      {
        issueId: ids.issues['PLAT-3']!,
        authorId: ownerUserId,
        content: 'Разделил гейтвей на 3 маршрута: /auth, /api, /ws. Rate-limiting на каждом отдельно.',
        createdAt: daysAgo(16),
      },
      {
        issueId: ids.issues['PLAT-3']!,
        authorId: ownerUserId,
        content: 'Производительность выросла: p99 latency снизился с 340ms до 120ms.',
        createdAt: daysAgo(14),
      },
      {
        issueId: ids.issues['PLAT-3']!,
        authorId: ownerUserId,
        content: 'Деплой на staging прошёл. Завтра прогоню нагрузочные тесты.',
        createdAt: daysAgo(12),
      },
    ],
  });

  // PLAT-7: 3 comments
  await prisma.issueComment.createMany({
    data: [
      {
        issueId: ids.issues['PLAT-7']!,
        authorId: ownerUserId,
        content: 'Начал с аудита. Нашёл 4 уязвимости: нет rate limiting, JWT без expiration, нет CSRF-защиты, session fixation. Критично.',
        createdAt: daysAgo(7),
      },
      {
        issueId: ids.issues['PLAT-7']!,
        authorId: ownerUserId,
        content: 'Приоритет — закрыть уязвимости, OAuth2 потом. Дедлайн на hotfix — конец спринта.',
        createdAt: daysAgo(6),
      },
      {
        issueId: ids.issues['PLAT-7']!,
        authorId: ownerUserId,
        content: 'Принял. Rate limiting уже в PR, CSRF-токены добавлю завтра. OAuth2 flow спроектировал — см. чек-лист.',
        createdAt: daysAgo(5),
      },
    ],
  });

  // MOB-3: 2 comments
  await prisma.issueComment.createMany({
    data: [
      {
        issueId: ids.issues['MOB-3']!,
        authorId: ownerUserId,
        content: 'Три варианта layout: grid, speaker-focus, sidebar. Для мобильного рекомендую speaker-focus как основной.',
        createdAt: daysAgo(5),
      },
      {
        issueId: ids.issues['MOB-3']!,
        authorId: ownerUserId,
        content: 'Speaker-focus +1. Добавь кнопку «закрепить спикера» и свайп для переключения участников.',
        createdAt: daysAgo(4),
      },
    ],
  });

  // MKT-5: 2 comments
  await prisma.issueComment.createMany({
    data: [
      {
        issueId: ids.issues['MKT-5']!,
        authorId: ownerUserId,
        content: 'Слайды готовы, 42 слайда. Нужно прогнать тайминг — укладываемся ли в 45 минут?',
        createdAt: daysAgo(10),
      },
      {
        issueId: ids.issues['MKT-5']!,
        authorId: ownerUserId,
        content: 'Прогон прошли — 43 минуты, в норме. Запись нужна для YouTube и нарезки коротких роликов.',
        createdAt: daysAgo(9),
      },
    ],
  });

  // ═══════════════════════════════════════════════════════════════════
  // 11. ISSUE RELATIONS (5)
  // ═══════════════════════════════════════════════════════════════════

  console.log('[demo/tracker] Создаю 5 связей между задачами...');

  const relationDefs: { source: string; target: string; type: string }[] = [
    { source: 'PLAT-7',    target: 'PLAT-12', type: 'blocks' },
    { source: 'PLAT-7',    target: 'PLAT-3',  type: 'relates_to' },
    { source: 'MOB-3',     target: 'MOB-7',   type: 'blocks' },
    { source: 'MKT-5',     target: 'PLAT-12', type: 'relates_to' },
    { source: 'PLAT-12.1', target: 'PLAT-12', type: 'blocked_by' },
  ];

  for (const rel of relationDefs) {
    await prisma.issueRelation.create({
      data: {
        sourceIssueId: ids.issues[rel.source]!,
        targetIssueId: ids.issues[rel.target]!,
        relationType: rel.type,
        createdById: ownerUserId,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // 12. ISSUE ACTIVITIES
  // ═══════════════════════════════════════════════════════════════════

  console.log('[demo/tracker] Создаю IssueActivity (audit trail)...');

  async function createActivity(
    issueKey: string,
    verb: string,
    opts?: {
      field?: string;
      oldValue?: unknown;
      newValue?: unknown;
      actorType?: string;
      metadata?: unknown;
    },
  ): Promise<void> {
    await prisma.issueActivity.create({
      data: {
        tenantId,
        issueId: ids.issues[issueKey]!,
        actorUserId: ownerUserId,
        actorType: opts?.actorType ?? 'user',
        verb,
        field: opts?.field ?? null,
        oldValue: opts?.oldValue !== undefined ? (opts.oldValue as object) : undefined,
        newValue: opts?.newValue !== undefined ? (opts.newValue as object) : undefined,
        metadata: opts?.metadata !== undefined ? (opts.metadata as object) : undefined,
        epoch: nextEpoch(),
      },
    });
  }

  // PLAT-7: 5 activities (created, status_changed, assigned, comment, comment)
  await createActivity('PLAT-7', 'created');
  await createActivity('PLAT-7', 'status_changed', {
    field: 'state',
    oldValue: 'Бэклог',
    newValue: 'В работе',
  });
  await createActivity('PLAT-7', 'assigned', {
    field: 'assignees',
    newValue: 'kozlov',
  });
  await createActivity('PLAT-7', 'commented', {
    metadata: { commentSnippet: 'Начал с аудита. Нашёл 4 уязвимости...' },
  });
  await createActivity('PLAT-7', 'commented', {
    metadata: { commentSnippet: 'Принял. Rate limiting уже в PR...' },
  });

  // PLAT-1: 3 activities
  await createActivity('PLAT-1', 'created');
  await createActivity('PLAT-1', 'status_changed', {
    field: 'state',
    oldValue: 'В работе',
    newValue: 'Готово',
  });
  await createActivity('PLAT-1', 'checklist_completed', {
    metadata: { checklistTitle: 'CI/CD Pipeline', done: 4, total: 4 },
  });

  // PLAT-3: 3 activities
  await createActivity('PLAT-3', 'created');
  await createActivity('PLAT-3', 'status_changed', {
    field: 'state',
    oldValue: 'В работе',
    newValue: 'Готово',
  });
  await createActivity('PLAT-3', 'commented', {
    metadata: { commentSnippet: 'Производительность выросла: p99 latency...' },
  });

  // PLAT-12: 3 activities
  await createActivity('PLAT-12', 'created');
  await createActivity('PLAT-12', 'linked', {
    field: 'relations',
    newValue: 'blocked_by PLAT-7',
  });
  await createActivity('PLAT-12', 'subtask_created', {
    metadata: { subtaskIdentifier: 'PLAT-19', title: 'Dockerfile оптимизация' },
  });

  // PLAT-15: 2 activities
  await createActivity('PLAT-15', 'created');
  await createActivity('PLAT-15', 'status_changed', {
    field: 'state',
    oldValue: 'Бэклог',
    newValue: 'В работе',
  });

  // PLAT-17: 2 activities
  await createActivity('PLAT-17', 'created');
  await createActivity('PLAT-17', 'assigned', {
    field: 'assignees',
    newValue: 'kozlov',
  });

  // PLAT-9: 2 activities
  await createActivity('PLAT-9', 'created');
  await createActivity('PLAT-9', 'status_changed', {
    field: 'state',
    oldValue: 'Бэклог',
    newValue: 'В работе',
  });

  // MOB-1: 2 activities
  await createActivity('MOB-1', 'created');
  await createActivity('MOB-1', 'status_changed', {
    field: 'state',
    oldValue: 'В работе',
    newValue: 'Готово',
  });

  // MOB-3: 3 activities
  await createActivity('MOB-3', 'created');
  await createActivity('MOB-3', 'status_changed', {
    field: 'state',
    oldValue: 'Бэклог',
    newValue: 'В работе',
  });
  await createActivity('MOB-3', 'linked', {
    field: 'relations',
    newValue: 'blocks MOB-7',
  });

  // MOB-5: 2 activities
  await createActivity('MOB-5', 'created');
  await createActivity('MOB-5', 'assigned', {
    field: 'assignees',
    newValue: 'sidorov',
  });

  // MKT-1: 2 activities
  await createActivity('MKT-1', 'created');
  await createActivity('MKT-1', 'status_changed', {
    field: 'state',
    oldValue: 'В работе',
    newValue: 'Готово',
  });

  // MKT-5: 2 activities
  await createActivity('MKT-5', 'created');
  await createActivity('MKT-5', 'status_changed', {
    field: 'state',
    oldValue: 'В работе',
    newValue: 'Готово',
  });

  // MKT-6: 2 activities
  await createActivity('MKT-6', 'created');
  await createActivity('MKT-6', 'assigned', {
    field: 'assignees',
    newValue: 'kuznetsova',
  });

  // Minimal "created" activity for all remaining issues without detailed activities
  const issuesWithDetailedActivities = new Set([
    'PLAT-1', 'PLAT-3', 'PLAT-7', 'PLAT-9', 'PLAT-12', 'PLAT-15', 'PLAT-17',
    'MOB-1', 'MOB-3', 'MOB-5',
    'MKT-1', 'MKT-5', 'MKT-6',
  ]);

  for (const iss of allIssues) {
    if (!issuesWithDetailedActivities.has(iss.key)) {
      await createActivity(iss.key, 'created');
    }
  }
  // Subtasks basic activity
  await createActivity('PLAT-12.1', 'created');
  await createActivity('PLAT-12.2', 'created');

  // ═══════════════════════════════════════════════════════════════════
  // 13. SPRINT HINTS (3 for Sprint 14)
  // ═══════════════════════════════════════════════════════════════════

  console.log('[demo/tracker] Создаю 3 SprintHint для Sprint 14...');

  const sprintHintDefs: {
    kind: 'generic';
    severity: 'info' | 'warning' | 'critical';
    title: string;
    body: string;
    confidence: number;
    contentHash: string;
    affectedIssueKeys?: string[];
  }[] = [
    {
      kind: 'generic',
      severity: 'warning',
      title: 'Перегрузка Козлова',
      body: 'У Козлова 5 задач в Sprint 14, рассмотрите делегирование Новикову.',
      confidence: 0.85,
      contentHash: 'demo-hint-1',
      affectedIssueKeys: ['PLAT-7', 'PLAT-9', 'PLAT-17'],
    },
    {
      kind: 'generic',
      severity: 'info',
      title: 'Нет QA-задач',
      body: 'Нет QA-задач в спринте, добавьте тестирование.',
      confidence: 0.75,
      contentHash: 'demo-hint-2',
    },
    {
      kind: 'generic',
      severity: 'warning',
      title: 'Блокировка PLAT-12',
      body: 'PLAT-12 заблокирована PLAT-7, но PLAT-7 не имеет дедлайна.',
      confidence: 0.80,
      contentHash: 'demo-hint-3',
      affectedIssueKeys: ['PLAT-7', 'PLAT-12'],
    },
  ];

  for (const h of sprintHintDefs) {
    await prisma.sprintHint.create({
      data: {
        tenantId,
        cycleId: ids.cycles['sprint14']!,
        kind: h.kind,
        severity: h.severity,
        title: h.title,
        body: h.body,
        confidence: h.confidence,
        contentHash: h.contentHash,
        affectedIssueIds: h.affectedIssueKeys
          ? (h.affectedIssueKeys.map(k => ids.issues[k]!) as string[])
          : [],
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // 14. PROJECT DOCUMENTS (5)
  // ═══════════════════════════════════════════════════════════════════

  console.log('[demo/tracker] Создаю 5 проектных документов...');

  const docDefs: { title: string; project: string; content: object }[] = [
    {
      title: 'Техническая архитектура v2',
      project: 'plat',
      content: tipTapDoc(
        'Техническая архитектура v2',
        [
          'Архитектура Платформы v2.0 построена на микросервисном подходе. Каждый сервис отвечает за одну бизнес-область и может масштабироваться независимо. Основные сервисы: auth-gateway (авторизация и аутентификация), user-service (профили и роли), meeting-service (управление встречами), media-proxy (проксирование медиа-потоков к LiveKit SFU).',
          'Коммуникация между сервисами: синхронная через gRPC (внутренние вызовы), асинхронная через Redis Streams (события, уведомления). API-гейтвей на базе Kong принимает внешние запросы и маршрутизирует их к нужным сервисам с rate-limiting и аутентификацией.',
          'Хранение данных: PostgreSQL для транзакционных данных (Prisma ORM), Redis для сессий и кеша, S3 для записей встреч и файлов. Все сервисы контейнеризированы (Docker) и деплоятся через CI/CD pipeline (GitHub Actions, Docker Registry, K8s).',
          'Безопасность: OAuth2 + PKCE flow для внешних клиентов, mTLS для межсервисного общения, secrets в HashiCorp Vault. Аудит-лог всех критических операций через BullMQ-воркер.',
        ],
      ),
    },
    {
      title: 'API-спецификация auth-service',
      project: 'plat',
      content: tipTapDoc(
        'API-спецификация auth-service',
        [
          'Auth-service отвечает за аутентификацию и авторизацию всех пользователей платформы. Поддерживает OAuth2 + PKCE flow для веб- и мобильных клиентов, refresh-token ротацию, multi-factor authentication (TOTP).',
          'Основные эндпоинты: POST /auth/login (начало OAuth2 flow), POST /auth/token (обмен code на tokens), POST /auth/refresh (обновление access-токена), POST /auth/logout (инвалидация refresh-токена), GET /auth/me (текущий пользователь). Все эндпоинты возвращают стандартные JSON-ответы с кодами 200/400/401/403/500.',
          'Токены: access-token (JWT, 15 мин TTL), refresh-token (opaque, 30 дней TTL, single-use). Refresh-токены хранятся в Redis с привязкой к deviceId для возможности удалённой инвалидации сессий.',
          'Интеграции: Google OAuth2 (веб + Android), Apple Sign-In (iOS), Yandex ID (веб). Каждый провайдер настраивается через ENV-переменные (client_id, client_secret, redirect_uri).',
        ],
      ),
    },
    {
      title: 'Дизайн-система',
      project: 'mob',
      content: tipTapDoc(
        'Дизайн-система',
        [
          'Дизайн-система ТехноСтрим обеспечивает визуальную консистентность мобильного приложения на iOS и Android. Построена на базе токенов (цвета, типографика, отступы, радиусы) и компонентов (кнопки, инпуты, карточки, навигация).',
          'Цветовая палитра: Primary Blue #3B82F6 (действия, ссылки), Success Green #10B981 (подтверждения), Warning Amber #F59E0B (предупреждения), Error Red #EF4444 (ошибки). Нейтральные: Slate-50 до Slate-900 для фонов и текста. Тёмная тема планируется в v2.1.',
          'Типографика: Inter для UI-элементов (Regular 400, Medium 500, Semibold 600), JetBrains Mono для кода и технических данных. Размеры: xs=12, sm=14, base=16, lg=18, xl=24, 2xl=32. Межстрочный интервал 1.5 для текста, 1.2 для заголовков.',
          'Компоненты реализованы в Figma (мастер-библиотека) и в React Native (src/components/ui). Каждый компонент имеет варианты: size (sm/md/lg), state (default/hover/active/disabled), theme (light/dark). Документация компонентов — в Storybook.',
        ],
      ),
    },
    {
      title: 'UX-исследование: конкуренты',
      project: 'mob',
      content: tipTapDoc(
        'UX-исследование: конкуренты',
        [
          'Проведён конкурентный анализ 5 мобильных приложений для видеоконференций: Zoom, Google Meet, Microsoft Teams, Whereby и Jitsi Meet. Оценка по 12 критериям: скорость подключения, качество видео, UX звонка, управление участниками, запись, чат, шаринг экрана, push-уведомления, offline-режим, онбординг, производительность, доступность.',
          'Ключевые выводы: Zoom лидирует по функциональности, но перегружен UI. Google Meet — лучший баланс простоты и возможностей. Teams мощный, но тяжёлый и медленный. Whereby выделяется простым онбордингом (без регистрации). Jitsi — open-source, но страдает от проблем с качеством связи.',
          'Возможности для ТехноСтрим: 1) AI-саммари встречи как киллер-фича (нет ни у кого из конкурентов в мобильном). 2) Быстрый старт без регистрации для гостей. 3) Запись и транскрипция одним нажатием. 4) Интеграция с CRM прямо из встречи. 5) Легковесный клиент (цель: <30 MB установка).',
          'Рекомендации: mobile-first UX, максимум 3 действия на главном экране (присоединиться, создать, история). Speaker-focus layout как дефолтный. Свайп для дополнительных действий. Push-уведомления с превью участника.',
        ],
      ),
    },
    {
      title: 'Контент-план Q2',
      project: 'mkt',
      content: tipTapDoc(
        'Контент-план Q2',
        [
          'Контент-стратегия Q2 2026 фокусируется на трёх направлениях: технический контент для привлечения разработчиков и CTO, продуктовый контент для лиц, принимающих решения, и performance-маркетинг для лидогенерации.',
          'Технический контент: 4 статьи в блог (архитектура LiveKit, миграция на K8s, OAuth2 best practices, оптимизация WebSocket), 2 вебинара (K8s-миграция в мае, AI-аналитика встреч в июне), open-source утилиты на GitHub (loadtest-скрипт, LiveKit monitoring dashboard).',
          'Продуктовый контент: обновлённый лендинг с новыми секциями (AI-фичи, безопасность, интеграции), 3 кейса (Ростелеком, стартап 50 человек, enterprise 500 человек), email-цепочка онбординга (5 писем за 14 дней), демо-видео 2 минуты.',
          'Performance-маркетинг: Яндекс.Директ (брендовые + категорийные запросы), таргет VK (CTO/DevOps/HR-директора), ретаргетинг на посетителях лендинга. Бюджет: 800K руб/мес. Целевые метрики: CAC < 15K, конверсия лендинг-регистрация > 8%, trial-paid > 15%.',
        ],
      ),
    },
  ];

  for (const d of docDefs) {
    await prisma.projectDocument.create({
      data: {
        tenantId,
        projectId: ids.projects[d.project]!,
        title: d.title,
        content: d.content,
        createdById: ownerUserId,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // DONE
  // ═══════════════════════════════════════════════════════════════════

  console.log(
    '[demo/tracker] Готово: 3 проекта, 15 статусов, 6 досок, 4 цикла, ' +
    '9 меток, 40 задач (38 + 2 подзадачи), комментарии, связи, ' +
    'активности, 3 SprintHint, 5 документов.',
  );
};
