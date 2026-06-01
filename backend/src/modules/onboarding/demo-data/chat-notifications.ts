/**
 * Демо-данные «ТехноСтрим» — AI-чат и уведомления.
 *
 * Создаёт: ChatV2Conversation (3), ChatV2Message (6), Notification (10).
 */
import type { SeedFn } from './types';
import { daysAgo } from './types';

export const seedChatNotifications: SeedFn = async (ctx, _ids) => {
  const { prisma, tenantId, ownerUserId } = ctx;

  // ── 1. ChatV2Conversation (3) + ChatV2Message (6) ─────────────────────

  console.log('[demo/chat-notifications] Создание AI-чатов...');

  // --- Conversation 1: «Стратегия Q2» ---
  const conv1 = await prisma.chatV2Conversation.create({
    data: {
      tenantId,
      userId: ownerUserId,
      scope: 'org',
      title: 'Стратегия Q2',
      status: 'active',
    },
  });

  await prisma.chatV2Message.create({
    data: {
      conversationId: conv1.id,
      role: 'user',
      text: 'Какие у нас главные риски на Q2?',
      createdAt: daysAgo(3),
    },
  });

  await prisma.chatV2Message.create({
    data: {
      conversationId: conv1.id,
      role: 'assistant',
      mode: 'synthetic',
      text: `## Главные риски Q2 2026\n\nНа основе анализа 7 встреч и 20 информационных блоков за последние 30 дней:\n\n### 1. Безопасность auth-модуля (высокий)\nJWT-токены без expiration — критическая уязвимость. Любой перехваченный токен действует бесконечно. Козлов — единственный эксперт по auth (bus factor = 1). Миграция на OAuth2 + PKCE начата, но затрагивает 3 микросервиса.\n\n**Рекомендация:** Ускорить миграцию OAuth2, выделить Козлову помощника.\n\n### 2. Мобильное приложение отстаёт (высокий)\nОтставание 3 дня из-за сложности SDK видеозвонка. Команда нашла обходной путь, но риск сдвига дедлайна сохраняется.\n\n**Рекомендация:** Рассмотреть альтернативный SDK или упростить MVP-функционал.\n\n### 3. Конкурентное давление Zoom (средний)\nZoom демпингует цены на 20%. Наша стратегия — value-sell через AI-отчёты и граф знаний, а не ценовая конкуренция.\n\n**Рекомендация:** Усилить позиционирование AI-фич в sales deck.\n\n### Сводка\n| Риск | Серьёзность | Статус |\n|------|-------------|--------|\n| Auth-уязвимости | Высокий | В работе |\n| Мобильное отставание | Высокий | В работе |\n| Zoom демпинг | Средний | Мониторинг |`,
      citations: [
        { type: 'idea_block', id: 'ib1', text: 'JWT без expiration — критическая уязвимость' },
        { type: 'idea_block', id: 'ib3', text: 'Мобильное приложение отстаёт от графика на 3 дня' },
        { type: 'idea_block', id: 'ib9', text: 'Zoom демпингует цены — нужна стратегия value-sell' },
      ] as object[],
      createdAt: daysAgo(3),
    },
  });

  // --- Conversation 2: «Что знает Козлов?» ---
  const conv2 = await prisma.chatV2Conversation.create({
    data: {
      tenantId,
      userId: ownerUserId,
      scope: 'org',
      title: 'Что знает Козлов?',
      status: 'active',
    },
  });

  await prisma.chatV2Message.create({
    data: {
      conversationId: conv2.id,
      role: 'user',
      text: 'Что будет если Козлов уволится?',
      createdAt: daysAgo(2),
    },
  });

  await prisma.chatV2Message.create({
    data: {
      conversationId: conv2.id,
      role: 'assistant',
      mode: 'synthetic',
      text: `## Оценка риска: уход Дмитрия Козлова\n\n### Критичность: ВЫСОКАЯ\n\nДмитрий Козлов — Tech Lead с уникальной экспертизой в нескольких критических областях.\n\n### Что знает только Козлов\n\n**Auth-модуль (bus factor = 1)**\n- Архитектура JWT/OAuth2 — полный контроль\n- Rate limiting, session fixation, token revocation\n- 4 уязвимости в процессе закрытия\n- Никто в команде не имеет сравнимой глубины знаний\n\n**Микросервисная архитектура**\n- SFU-интеграция с LiveKit\n- Kubernetes-конфигурации (документация отсутствует)\n- 3 критических микросервиса: auth-gateway, media-proxy, recording-service\n\n### Текущие задачи Козлова\n1. Миграция на OAuth2 + PKCE (в процессе)\n2. Code review (основной ревьюер — SLA 24ч)\n3. Закрытие уязвимостей auth (2 из 4 закрыты)\n4. Подготовка демо для Ростелеком\n\n### Skill-профиль (5 traits, build v3)\n- Глубокая экспертиза в безопасности (high confidence, 8 наблюдений)\n- Склонен брать на себя критические задачи (high, 6)\n- Предпочитает технический долг рефакторингу (medium, 4)\n- Хорошо объясняет сложные концепции (high, 5)\n- Иногда перегружен — 5+ задач в спринте (high, 7)\n\n### Рекомендации\n1. **Срочно:** Начать knowledge transfer — Новиков как backup\n2. **Среднесрочно:** Написать документацию по auth и K8s\n3. **Долгосрочно:** Нанять senior backend с экспертизой в security\n4. **Employee Clone:** Клон Tech Lead v3 доступен для вопросов`,
      citations: [
        { type: 'idea_block', id: 'ib4', text: 'Козлов — единственный эксперт по auth-модулю' },
      ] as object[],
      createdAt: daysAgo(2),
    },
  });

  // --- Conversation 3: «Сводка по команде» ---
  const conv3 = await prisma.chatV2Conversation.create({
    data: {
      tenantId,
      userId: ownerUserId,
      scope: 'org',
      title: 'Сводка по команде',
      status: 'active',
    },
  });

  await prisma.chatV2Message.create({
    data: {
      conversationId: conv3.id,
      role: 'user',
      text: 'Дай сводку по команде за неделю',
      createdAt: daysAgo(1),
    },
  });

  await prisma.chatV2Message.create({
    data: {
      conversationId: conv3.id,
      role: 'assistant',
      mode: 'synthetic',
      text: `## Сводка по команде за неделю 19–25 мая\n\n### Чек-ины\n- **Покрытие:** 90% (45 из 50 возможных)\n- **Пропущены:** Петрова — 2 вечерних чек-ина\n\n### Настроение команды\n| | Green | Yellow | Red |\n|---|---|---|---|\n| Доля | 55% | 30% | 15% |\n\n**Красные дни:**\n- Козлов (21.05): новая уязвимость в JWT — стресс\n- Козлов (22.05): давление от бизнеса + техдолг\n\n### Загрузка\n- **Козлов:** 5+ задач в спринте, перегружен\n- **Волкова:** 3 продукта одновременно, нужен junior PM\n- **Морозов:** стабильно green, стратегический фокус\n- **Соколова:** стабильно green, pipeline растёт\n- **Петрова:** в основном green, дизайн в графике\n\n### Блокеры недели (5 новых, 3 решено)\n1. ~~CI падает на интеграционных~~ (решено)\n2. SDK видеозвонка + OAuth2 (workaround найден)\n3. Token revocation (решено)\n4. Нет QA-процесса в мобильной команде (открыт)\n5. UI-баги в мобильном (в работе)\n\n### Ключевые решения\n- OAuth2 + PKCE миграция начата\n- Дизайн CallScreen v3 утверждён\n- Пилот Ростелеком: 500 юзеров\n- Code review SLA: 24 часа\n\n### Цели — динамика\n- ARR: 62→72 (+10) — рост\n- v2.0: 71→65 (-6) — auth замедлил\n- Мобильное: 42→55 (+13) — прогресс\n- NPS: 76→80 (+4) — стабильно`,
      citations: [] as object[],
      createdAt: daysAgo(1),
    },
  });

  // ── 2. Notifications (10) ─────────────────────────────────────────────

  console.log('[demo/chat-notifications] Создание уведомлений...');

  const notificationDefs = [
    // ── Свежие (за последние сутки) ──
    {
      eventType: 'issue_assigned',
      payload: { issueId: 'PLAT-18', title: 'Новая задача PLAT-18 назначена на вас' },
      daysAgoN: 0,
    },
    {
      eventType: 'mention',
      payload: { authorName: 'Марина Волкова', context: 'комментарий к Sprint 14', text: 'Марина Волкова упомянула вас в обсуждении Sprint 14' },
      daysAgoN: 0,
    },
    {
      eventType: 'spotlight_published',
      payload: { helperName: 'Дмитрий Козлов', text: 'Опубликован spotlight: «Mentor of the week — Дмитрий Козлов»' },
      daysAgoN: 0,
    },
    {
      eventType: 'promise_due_today',
      payload: { ideaBlockId: 'ib33', text: 'Сегодня дедлайн обещания: auth-контракт для frontend' },
      daysAgoN: 0,
    },
    {
      eventType: 'meeting_starting_soon',
      payload: { meetingTitle: 'Утренний стендап', text: 'Встреча «Утренний стендап» начнётся через 15 минут' },
      daysAgoN: 0,
    },
    {
      eventType: 'issue_assigned',
      payload: { issueId: 'PLAT-7', title: 'PLAT-7 переназначена на вас' },
      daysAgoN: 1,
    },
    {
      eventType: 'issue_comment',
      payload: { issueId: 'PLAT-7', authorName: 'Дмитрий Козлов', text: 'Козлов оставил комментарий к PLAT-7' },
      daysAgoN: 1,
    },
    {
      eventType: 'meeting_ai_ready',
      payload: { meetingTitle: 'Стендап', text: 'AI-отчёт встречи «Стендап» готов' },
      daysAgoN: 1,
    },
    {
      eventType: 'cycle_reminder',
      payload: { cycleName: 'Sprint 14', text: 'Sprint 14: осталось 4 дня' },
      daysAgoN: 2,
    },
    {
      eventType: 'insight_new',
      payload: { statement: 'Перегрузка Козлова', text: 'Новый инсайт: перегрузка Козлова' },
      daysAgoN: 2,
    },
    {
      eventType: 'recognition',
      payload: { fromName: 'Екатерина Соколова', text: 'Екатерина Соколова поблагодарила вас' },
      daysAgoN: 2,
    },
    {
      eventType: 'digest_ready',
      payload: { text: 'Weekly digest готов' },
      daysAgoN: 3,
    },
    {
      eventType: 'theme_new',
      payload: { themeName: 'Безопасность и auth', text: 'Новая тема в графе: «Безопасность и auth»' },
      daysAgoN: 3,
    },
    {
      eventType: 'clone_updated',
      payload: { cloneName: 'Tech Lead', version: 3, text: 'Clone обновлён: Tech Lead v3' },
      daysAgoN: 3,
    },
    {
      eventType: 'meeting_quality',
      payload: { meetingTitle: 'Стендап', score: 82, text: 'Meeting quality score: Стендап 82/100' },
      daysAgoN: 3,
    },
    // ── Дополнительные за неделю ──
    {
      eventType: 'sprint_alert',
      payload: { cycleName: 'Sprint 14', text: 'Sprint 14: 3 задачи в риске не закрыться' },
      daysAgoN: 2,
    },
    {
      eventType: 'helpful_comment',
      payload: { authorName: 'Дмитрий Козлов', text: 'Дмитрий Козлов оставил полезный ответ на ваш вопрос' },
      daysAgoN: 2,
    },
    {
      eventType: 'goal_progress',
      payload: { goalName: 'ARR 10M к концу года', delta: '+5', text: 'Цель «ARR 10M» прибавила 5 пунктов alignment' },
      daysAgoN: 2,
    },
    {
      eventType: 'forecast_warning',
      payload: { text: 'Прогноз: ожидается падение engagement Козлова на следующей неделе' },
      daysAgoN: 3,
    },
    {
      eventType: 'system',
      payload: { text: 'Plan check-in от менеджера на пятницу' },
      daysAgoN: 3,
    },
    {
      eventType: 'recurring_topic_alert',
      payload: { themeName: 'Storage capacity у клиентов', text: 'Тема «Storage capacity» повторилась 7 раз без решения' },
      daysAgoN: 4,
    },
    {
      eventType: 'idea_supported',
      payload: { text: 'Ваша идея «Slack-интеграция» получила поддержку 3 коллег' },
      daysAgoN: 4,
    },
    {
      eventType: 'bus_factor_warning',
      payload: { categoryName: 'Авторизация / OAuth2', text: 'Bus Factor=1 в категории «Авторизация» — критический риск' },
      daysAgoN: 4,
    },
    {
      eventType: 'recognition',
      payload: { fromName: 'Алексей Морозов', text: 'Алексей Морозов поблагодарил вас за проактивность' },
      daysAgoN: 4,
    },
    {
      eventType: 'invite_received',
      payload: { eventTitle: 'CustDev: Сбербанк', text: 'Получено приглашение на встречу «CustDev: Сбербанк»' },
      daysAgoN: 5,
    },
    {
      eventType: 'document_uploaded',
      payload: { docName: 'Брендбук v2', text: 'Загружен новый документ: «Брендбук v2»' },
      daysAgoN: 5,
    },
  ];

  for (const n of notificationDefs) {
    await prisma.notification.create({
      data: {
        tenantId,
        recipientUserId: ownerUserId,
        eventType: n.eventType,
        payload: n.payload as object,
        status: 'delivered',
        dataClass: 'internal',
        createdAt: daysAgo(n.daysAgoN),
      },
    });
  }

  console.log(
    `[demo/chat-notifications] Создано: 3 диалога (6 сообщений), ` +
    `${notificationDefs.length} уведомлений.`,
  );
};
