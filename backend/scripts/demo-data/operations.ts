/**
 * Демо-данные «ТехноСтрим» — операционные данные.
 *
 * Создаёт: DailyCheckIn (100), WeeklyOperationsDigest (3), DailyOperationsDigest (5).
 *
 * Зависит от OrgIds (persons).
 */
import type { SeedFn, SeedContext, IdMap } from './types';
import { req } from './types';

export const seedOperations: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId } = ctx;

  // ── Workdays: 10 рабочих дней (15-28 мая, пропуская 17,18,24,25) ──

  const WORKDAYS = [
    '2026-05-15', '2026-05-16', '2026-05-19', '2026-05-20', '2026-05-21',
    '2026-05-22', '2026-05-23', '2026-05-26', '2026-05-27', '2026-05-28',
  ];

  // ── 1. DailyCheckIn (100 records) ─────────────────────────────────────

  console.log('[demo/operations] Создание DailyCheckIn (100 записей)...');

  // --- Козлов (kozlov): 10 дней ---
  const kozlovDays = [
    {
      date: '2026-05-15',
      morning: { plans: [{ text: 'Закончить hotfix rate limiting на login endpoint', priority: 'high' }, { text: 'Подготовить PR для auth-gateway миграции', priority: 'medium' }], sentiment: 'yellow', rationale: 'Много задач по auth, но план понятен' },
      evening: { dones: [{ text: 'Hotfix rate limiting — готов, PR на ревью' }, { text: 'Начал миграцию auth-gateway на OAuth2' }], blockers: [{ text: 'Баг на staging не воспроизводится локально', severity: 'medium' }], sentiment: 'yellow', rationale: 'Hotfix закрыт, но баг на staging раздражает' },
    },
    {
      date: '2026-05-16',
      morning: { plans: [{ text: 'Code review PR #142 от Новикова', priority: 'high' }, { text: 'Продолжить OAuth2 миграцию — refresh tokens', priority: 'high' }], sentiment: 'green', rationale: 'Чёткий план на день' },
      evening: { dones: [{ text: 'Code review #142 — оставил 3 комментария, апрув' }, { text: 'Refresh tokens — базовая имплементация готова' }], blockers: [], sentiment: 'green', rationale: 'Продуктивный день, всё по плану' },
    },
    {
      date: '2026-05-19',
      morning: { plans: [{ text: 'Session fixation fix — начать работу', priority: 'high' }, { text: 'Встреча по безопасности в 14:00', priority: 'high' }], sentiment: 'yellow', rationale: 'Критические уязвимости давят' },
      evening: { dones: [{ text: 'Session fixation — патч написан, жду CI' }, { text: 'Встреча по безопасности прошла, решения зафиксированы' }], blockers: [{ text: 'CI падает на интеграционных тестах — не моя вина', severity: 'low' }], sentiment: 'yellow', rationale: 'Уязвимости закрываются, но CI блокирует' },
    },
    {
      date: '2026-05-20',
      morning: { plans: [{ text: 'Исправить CI-тесты для session fixation', priority: 'high' }, { text: 'Подготовить документацию OAuth2 для команды', priority: 'medium' }], sentiment: 'yellow', rationale: '5-й день подряд на auth — подустал' },
      evening: { dones: [{ text: 'CI починил — тесты зелёные' }, { text: 'Документация OAuth2 — черновик готов' }], blockers: [], sentiment: 'green', rationale: 'CI починен, документация сдана' },
    },
    {
      date: '2026-05-21',
      morning: { plans: [{ text: 'JWT expiration hotfix — финализация', priority: 'high' }, { text: 'Code review PR #148, #149', priority: 'medium' }], sentiment: 'red', rationale: 'Нашли ещё одну уязвимость в JWT — стресс' },
      evening: { dones: [{ text: 'JWT expiration hotfix задеплоен на staging' }], blockers: [{ text: 'Новая уязвимость: token revocation не работает для refresh', severity: 'high' }], sentiment: 'red', rationale: 'Ещё одна уязвимость — конец спринта под угрозой' },
    },
    {
      date: '2026-05-22',
      morning: { plans: [{ text: 'Token revocation — критический фикс', priority: 'high' }, { text: 'Созвон с Морозовым по статусу auth', priority: 'high' }], sentiment: 'yellow', rationale: 'Давление от бизнеса + техдолг' },
      evening: { dones: [{ text: 'Token revocation — фикс на ревью' }, { text: 'Морозову доложил — приоритет подтверждён' }], blockers: [], sentiment: 'yellow', rationale: 'Ситуация под контролем, но задач слишком много' },
    },
    {
      date: '2026-05-23',
      morning: { plans: [{ text: 'Ретроспектива Sprint 13 — подготовить тезисы', priority: 'medium' }, { text: 'Планирование Sprint 14 — оценка задач', priority: 'high' }], sentiment: 'yellow', rationale: 'Ретро + планирование — переключение контекста' },
      evening: { dones: [{ text: 'Ретро провёл — 3 action items зафиксировали' }, { text: 'Планирование Sprint 14 — бэклог приоритезирован' }], blockers: [], sentiment: 'green', rationale: 'Ретро продуктивная, спринт спланирован' },
    },
    {
      date: '2026-05-26',
      morning: { plans: [{ text: 'Начать Sprint 14 — OAuth2 scope parameter', priority: 'high' }, { text: 'Ревью PR #155 от Сидорова', priority: 'medium' }], sentiment: 'green', rationale: 'Новый спринт, свежая энергия' },
      evening: { dones: [{ text: 'OAuth2 scope parameter — базовая логика готова' }, { text: 'PR #155 — апрувнут, замержен' }], blockers: [{ text: 'SDK видеозвонка не совместим с новым OAuth2 flow', severity: 'medium' }], sentiment: 'yellow', rationale: 'OAuth2 идёт, но SDK создаёт проблемы' },
    },
    {
      date: '2026-05-27',
      morning: { plans: [{ text: 'Исправить совместимость OAuth2 + SDK', priority: 'high' }, { text: 'Подготовить auth-модуль к демо для Ростелеком', priority: 'high' }], sentiment: 'yellow', rationale: 'Дедлайн демо давит' },
      evening: { dones: [{ text: 'Совместимость починил — workaround через proxy' }, { text: 'Демо-стенд для Ростелеком подготовлен' }], blockers: [], sentiment: 'green', rationale: 'Всё успел, демо готово' },
    },
    {
      date: '2026-05-28',
      morning: { plans: [{ text: 'Финальное тестирование auth перед демо', priority: 'high' }, { text: 'Code review Sprint 14 — накопилось 4 PR', priority: 'medium' }], sentiment: 'yellow', rationale: 'Демо сегодня, нервы' },
      evening: { dones: [{ text: 'Auth прошёл все тесты — демо готов' }, { text: '3 из 4 PR заревьюены, один перенёс на завтра' }], blockers: [], sentiment: 'green', rationale: 'Демо прошло успешно, день продуктивный' },
    },
  ];

  // --- Волкова (volkova): 10 дней ---
  const volkovaDays = [
    {
      date: '2026-05-15',
      morning: { plans: [{ text: 'Подготовить CustDev-скрипт для Ростелеком', priority: 'high' }, { text: 'Обновить бэклог платформы — убрать устаревшие', priority: 'medium' }], sentiment: 'green', rationale: 'Чёткий план, CustDev — приоритет' },
      evening: { dones: [{ text: 'CustDev-скрипт готов — 12 вопросов' }, { text: 'Бэклог почищен — убрано 8 устаревших задач' }], blockers: [], sentiment: 'green', rationale: 'Всё по плану' },
    },
    {
      date: '2026-05-16',
      morning: { plans: [{ text: 'CustDev-интервью с Ростелеком (11:00)', priority: 'high' }, { text: 'Проанализировать метрики retention за неделю', priority: 'medium' }], sentiment: 'green', rationale: 'Важное интервью сегодня' },
      evening: { dones: [{ text: 'CustDev прошёл отлично — 5 инсайтов записала' }, { text: 'Retention: DAU/MAU = 34%, норма для нашей стадии' }], blockers: [], sentiment: 'green', rationale: 'CustDev — прорыв, клиенты хотят AI-отчёты' },
    },
    {
      date: '2026-05-19',
      morning: { plans: [{ text: 'Синхронизация с мобильной командой', priority: 'high' }, { text: 'Подготовить мобильный бэклог на Sprint 14', priority: 'high' }], sentiment: 'yellow', rationale: '3 проекта одновременно — сложно переключаться' },
      evening: { dones: [{ text: 'Мобильная синхронизация — определили приоритеты' }, { text: 'Бэклог мобильного готов — 12 задач' }], blockers: [{ text: 'Мобильное отстаёт на 3 дня — SDK видеозвонка', severity: 'high' }], sentiment: 'yellow', rationale: 'Отставание мобильного беспокоит' },
    },
    {
      date: '2026-05-20',
      morning: { plans: [{ text: 'Продуктовый стендап — статус по 3 продуктам', priority: 'high' }, { text: 'Написать PRD для push-уведомлений', priority: 'medium' }], sentiment: 'yellow', rationale: 'Перегрузка: платформа + мобайл + CustDev' },
      evening: { dones: [{ text: 'Стендап провела — все треки в курсе' }, { text: 'PRD push-уведомлений — первый драфт' }], blockers: [], sentiment: 'yellow', rationale: 'Справилась, но устала' },
    },
    {
      date: '2026-05-21',
      morning: { plans: [{ text: 'Анализ фидбека от 3 клиентов', priority: 'high' }, { text: 'Встреча с дизайном — CallScreen финализация', priority: 'high' }], sentiment: 'green', rationale: 'Дизайн-ревью — приятная часть работы' },
      evening: { dones: [{ text: 'Фидбек проанализирован — 3 паттерна выявлены' }, { text: 'CallScreen v3 дизайн утверждён' }], blockers: [], sentiment: 'green', rationale: 'Дизайн закрыт, фидбек полезен' },
    },
    {
      date: '2026-05-22',
      morning: { plans: [{ text: 'Приоритизация бэклога Sprint 14', priority: 'high' }, { text: 'Подготовить отчёт для Морозова — метрики Q2', priority: 'high' }], sentiment: 'yellow', rationale: 'Два дедлайна сегодня' },
      evening: { dones: [{ text: 'Бэклог приоритезирован — RICE-скоринг' }, { text: 'Отчёт Морозову отправлен — 5 слайдов' }], blockers: [], sentiment: 'green', rationale: 'Оба дедлайна закрыты' },
    },
    {
      date: '2026-05-23',
      morning: { plans: [{ text: 'CustDev follow-up — обещала клиенту прототип', priority: 'high' }, { text: 'Ретро Sprint 13 — продуктовый блок', priority: 'medium' }], sentiment: 'yellow', rationale: 'Много контекстов, нужно переключаться' },
      evening: { dones: [{ text: 'Прототип отправила — клиент доволен' }, { text: 'Ретро: зафиксировала 2 продуктовых улучшения' }], blockers: [], sentiment: 'green', rationale: 'Клиент счастлив — это главное' },
    },
    {
      date: '2026-05-26',
      morning: { plans: [{ text: 'Планирование Sprint 14 — продуктовая часть', priority: 'high' }, { text: 'Встреча с Ростелеком — статус пилота', priority: 'high' }], sentiment: 'green', rationale: 'Новый спринт, свежий старт' },
      evening: { dones: [{ text: 'Sprint 14 запланирован — 18 story points' }, { text: 'Ростелеком: пилот на 500 юзеров согласован' }], blockers: [], sentiment: 'green', rationale: 'Пилот Ростелеком — большая победа' },
    },
    {
      date: '2026-05-27',
      morning: { plans: [{ text: 'Анализ конверсии пилота Ростелеком', priority: 'high' }, { text: 'Обновить roadmap Q2-Q3', priority: 'medium' }], sentiment: 'yellow', rationale: 'Нужно всё успеть до отпуска в июне' },
      evening: { dones: [{ text: 'Конверсия: 12% пилотных → платящие (ожидание 10%)' }, { text: 'Roadmap обновлён — 3 новых фичи добавлены' }], blockers: [{ text: 'Нужен ещё один PM — не тяну 3 продукта', severity: 'high' }], sentiment: 'yellow', rationale: 'Результаты хорошие, но перегрузка растёт' },
    },
    {
      date: '2026-05-28',
      morning: { plans: [{ text: 'Еженедельный обзор метрик', priority: 'high' }, { text: 'Подготовить презентацию для борда', priority: 'high' }], sentiment: 'yellow', rationale: 'Презентация для борда — стресс' },
      evening: { dones: [{ text: 'Метрики: ARR растёт +8% WoW, NPS = 52' }, { text: 'Презентация готова — 12 слайдов' }], blockers: [], sentiment: 'green', rationale: 'Метрики хорошие, презентация сдана' },
    },
  ];

  // --- Морозов (morozov): 10 дней ---
  const morozovDays = [
    {
      date: '2026-05-15',
      morning: { plans: [{ text: 'Стратегическая сессия — ARR plan', priority: 'high' }, { text: 'Встреча с инвестором — update', priority: 'high' }], sentiment: 'green', rationale: 'Стратегия и инвесторы — основной фокус' },
      evening: { dones: [{ text: 'ARR plan: 10M к декабрю — реалистично при 3 пилотах' }, { text: 'Инвестор доволен прогрессом — follow-on возможен' }], blockers: [], sentiment: 'green', rationale: 'Отличный день' },
    },
    {
      date: '2026-05-16',
      morning: { plans: [{ text: 'Ревью финансовых метрик за апрель', priority: 'high' }, { text: 'Подготовить hiring plan на Q3', priority: 'medium' }], sentiment: 'green', rationale: 'Финансы в порядке, план понятен' },
      evening: { dones: [{ text: 'Метрики: MRR +12%, burn rate в норме' }, { text: 'Hiring plan: +2 бэкенда, +1 PM в Q3' }], blockers: [], sentiment: 'green', rationale: 'Всё идёт по плану' },
    },
    {
      date: '2026-05-19',
      morning: { plans: [{ text: 'Синхронизация с Козловым — статус auth', priority: 'high' }, { text: 'Встреча с HR — онбординг новых', priority: 'medium' }], sentiment: 'green', rationale: 'Операционка под контролем' },
      evening: { dones: [{ text: 'Козлов: auth под контролем, но нужно больше рук' }, { text: 'HR: 2 кандидата на бэкенд в финале' }], blockers: [], sentiment: 'green', rationale: 'Команда растёт, всё хорошо' },
    },
    {
      date: '2026-05-20',
      morning: { plans: [{ text: 'Борд-материалы — подготовка', priority: 'high' }, { text: 'One-to-one с Волковой', priority: 'high' }], sentiment: 'green', rationale: 'Борд через неделю, готовлюсь' },
      evening: { dones: [{ text: 'Борд-материалы — черновик готов' }, { text: 'Волкова: обсудили перегрузку, нужен junior PM' }], blockers: [], sentiment: 'green', rationale: 'Продуктивные встречи' },
    },
    {
      date: '2026-05-21',
      morning: { plans: [{ text: 'Анализ конкурентов — Zoom, Teams, Meet', priority: 'medium' }, { text: 'Встреча с юристом — договор Ростелеком', priority: 'high' }], sentiment: 'green', rationale: 'Конкурентный анализ — интересно' },
      evening: { dones: [{ text: 'Конкуренты: Zoom демпингует, но наш AI — дифференциатор' }, { text: 'Договор Ростелеком — финальные правки' }], blockers: [], sentiment: 'green', rationale: 'Стратегия ясна, юристы помогают' },
    },
    {
      date: '2026-05-22',
      morning: { plans: [{ text: 'Стратегия мобильного — синк с Волковой', priority: 'high' }, { text: 'Ревью KPI команды за май', priority: 'medium' }], sentiment: 'green', rationale: 'Мобильное — ключевой бет' },
      evening: { dones: [{ text: 'Мобильное: решили не менять дедлайн, добавить ресурсы' }, { text: 'KPI: 7 из 10 метрик в зелёной зоне' }], blockers: [], sentiment: 'green', rationale: 'Решения приняты, KPI в норме' },
    },
    {
      date: '2026-05-23',
      morning: { plans: [{ text: 'Подготовка к демо для Ростелеком', priority: 'high' }, { text: 'Ревью Sprint 13 — результаты', priority: 'medium' }], sentiment: 'green', rationale: 'Демо — ключевое событие недели' },
      evening: { dones: [{ text: 'Демо подготовлено — Козлов молодец' }, { text: 'Sprint 13: 85% задач закрыто в срок' }], blockers: [], sentiment: 'green', rationale: 'Команда работает отлично' },
    },
    {
      date: '2026-05-26',
      morning: { plans: [{ text: 'Планирование Q3 — стратегические приоритеты', priority: 'high' }, { text: 'Встреча с партнёром — интеграция Slack', priority: 'medium' }], sentiment: 'green', rationale: 'Q3-планирование начато' },
      evening: { dones: [{ text: 'Q3: 3 приоритета — мобайл, enterprise, AI-отчёты' }, { text: 'Slack-интеграция — договорились о пилоте' }], blockers: [], sentiment: 'green', rationale: 'Стратегия Q3 ясна' },
    },
    {
      date: '2026-05-27',
      morning: { plans: [{ text: 'Финализация борд-материалов', priority: 'high' }, { text: 'Созвон с юристом — финальные правки договора', priority: 'high' }], sentiment: 'green', rationale: 'Борд и договор — два приоритета' },
      evening: { dones: [{ text: 'Борд-материалы финализированы' }, { text: 'Договор Ростелеком подписан!' }], blockers: [], sentiment: 'green', rationale: 'Договор подписан — отличный день' },
    },
    {
      date: '2026-05-28',
      morning: { plans: [{ text: 'Демо для Ростелеком (14:00)', priority: 'high' }, { text: 'One-to-one с Козловым', priority: 'medium' }], sentiment: 'green', rationale: 'Демо — главный момент' },
      evening: { dones: [{ text: 'Демо прошло отлично — Ростелеком впечатлён' }, { text: 'Козлов: обсудили план на июнь, нагрузку' }], blockers: [], sentiment: 'green', rationale: 'Демо — успех, команда на подъёме' },
    },
  ];

  // --- Соколова (sokolova): 10 дней ---
  const sokolovaDays = [
    {
      date: '2026-05-15',
      morning: { plans: [{ text: 'Холодные звонки — 5 потенциальных клиентов', priority: 'high' }, { text: 'Обновить CRM — статусы сделок', priority: 'medium' }], sentiment: 'green', rationale: 'Энергии много, продажи идут' },
      evening: { dones: [{ text: '3 из 5 — заинтересовались, назначены демо' }, { text: 'CRM обновлена — 2 сделки перешли в negotiation' }], blockers: [], sentiment: 'green', rationale: 'Хороший день для продаж' },
    },
    {
      date: '2026-05-16',
      morning: { plans: [{ text: 'Демо для Сбербанка (11:00)', priority: 'high' }, { text: 'Подготовить КП для Яндекс', priority: 'medium' }], sentiment: 'green', rationale: 'Сбербанк — крупный клиент' },
      evening: { dones: [{ text: 'Демо Сбербанк — заинтересованы, просят пилот' }, { text: 'КП для Яндекс отправлено' }], blockers: [], sentiment: 'green', rationale: 'Сбербанк — потенциально крупная сделка' },
    },
    {
      date: '2026-05-19',
      morning: { plans: [{ text: 'Follow-up после демо Сбербанк', priority: 'high' }, { text: 'Конкурентный анализ — обновление', priority: 'medium' }], sentiment: 'green', rationale: 'Сбербанк горячий' },
      evening: { dones: [{ text: 'Сбербанк: согласны на пилот, обсуждаем условия' }, { text: 'Конкуренты: Zoom снизил цены на 20%' }], blockers: [], sentiment: 'green', rationale: 'Сделки двигаются' },
    },
    {
      date: '2026-05-20',
      morning: { plans: [{ text: 'Встреча с Ростелеком — финализация пилота', priority: 'high' }, { text: 'Подготовить sales deck v3', priority: 'medium' }], sentiment: 'green', rationale: 'Ростелеком почти наш' },
      evening: { dones: [{ text: 'Ростелеком: 500 юзеров, старт через 2 недели' }, { text: 'Sales deck v3 — обновлены кейсы' }], blockers: [], sentiment: 'green', rationale: 'Ростелеком закрыт!' },
    },
    {
      date: '2026-05-21',
      morning: { plans: [{ text: 'Демо для 2 новых лидов', priority: 'high' }, { text: 'Обучение Лебедева — shadowing', priority: 'medium' }], sentiment: 'green', rationale: 'Лиды приходят, команда растёт' },
      evening: { dones: [{ text: '2 демо прошли — оба лида в pipeline' }, { text: 'Лебедев: хорошо показался на демо' }], blockers: [], sentiment: 'green', rationale: 'Pipeline растёт' },
    },
    {
      date: '2026-05-22',
      morning: { plans: [{ text: 'Подготовка к CustDev с Ростелеком', priority: 'high' }, { text: 'Ревью pipeline за неделю', priority: 'medium' }], sentiment: 'green', rationale: 'CustDev + pipeline review' },
      evening: { dones: [{ text: 'CustDev с Ростелеком — отличные инсайты' }, { text: 'Pipeline: 12 активных сделок, 3 в финале' }], blockers: [], sentiment: 'green', rationale: 'Всё идёт хорошо' },
    },
    {
      date: '2026-05-23',
      morning: { plans: [{ text: 'Недельный отчёт по продажам', priority: 'high' }, { text: 'Стратегия upsell для текущих клиентов', priority: 'medium' }], sentiment: 'green', rationale: 'Подводим итоги недели' },
      evening: { dones: [{ text: 'Отчёт: 3 новых сделки, ARR +15% за месяц' }, { text: 'Upsell-план: 2 клиента готовы расширить' }], blockers: [], sentiment: 'green', rationale: 'Отличная неделя для продаж' },
    },
    {
      date: '2026-05-26',
      morning: { plans: [{ text: 'Новые лиды — квалификация', priority: 'high' }, { text: 'Подготовка к демо для Тинькофф', priority: 'high' }], sentiment: 'green', rationale: 'Новая неделя — новые клиенты' },
      evening: { dones: [{ text: '3 лида квалифицированы — 2 горячих' }, { text: 'Демо Тинькофф подготовлено' }], blockers: [], sentiment: 'green', rationale: 'Pipeline полон' },
    },
    {
      date: '2026-05-27',
      morning: { plans: [{ text: 'Демо Тинькофф (10:00)', priority: 'high' }, { text: 'Follow-up Сбербанк — договор', priority: 'high' }], sentiment: 'yellow', rationale: 'Два крупных клиента в один день — стресс' },
      evening: { dones: [{ text: 'Тинькофф: заинтересованы, просят PoC' }, { text: 'Сбербанк: договор на юристах, неделя на согласование' }], blockers: [], sentiment: 'green', rationale: 'Оба клиента в работе' },
    },
    {
      date: '2026-05-28',
      morning: { plans: [{ text: 'Участие в демо Ростелеком (поддержка)', priority: 'high' }, { text: 'Подготовить еженедельный sales-дашборд', priority: 'medium' }], sentiment: 'green', rationale: 'Демо Ростелеком — поддерживаю команду' },
      evening: { dones: [{ text: 'Демо Ростелеком — клиент впечатлён AI-отчётами' }, { text: 'Sales-дашборд готов: конверсия 22%, pipeline 4.2M' }], blockers: [], sentiment: 'green', rationale: 'Отличный день, команда сильная' },
    },
  ];

  // --- Петрова (petrova): 10 дней (2 пропущенных вечерних чек-ина) ---
  const petrovaDays = [
    {
      date: '2026-05-15',
      morning: { plans: [{ text: 'Финализация CallScreen v3 — адаптив iOS', priority: 'high' }, { text: 'Дизайн-ревью с Волковой', priority: 'medium' }], sentiment: 'green', rationale: 'CallScreen почти готов' },
      evening: { dones: [{ text: 'iOS адаптив готов — все брейкпоинты покрыты' }, { text: 'Ревью прошло — 2 мелких замечания' }], blockers: [], sentiment: 'green', rationale: 'Дизайн на финишной прямой' },
    },
    {
      date: '2026-05-16',
      morning: { plans: [{ text: 'CallScreen v3 — Android адаптив', priority: 'high' }, { text: 'Подготовить handoff для Сидорова', priority: 'medium' }], sentiment: 'green', rationale: 'Android — последний блок' },
      evening: { dones: [{ text: 'Android адаптив готов' }, { text: 'Handoff-документ — начат' }], blockers: [], sentiment: 'green', rationale: 'Продуктивный день' },
    },
    {
      date: '2026-05-19',
      morning: { plans: [{ text: 'Handoff CallScreen для frontend', priority: 'high' }, { text: 'Начать дизайн push-уведомлений', priority: 'medium' }], sentiment: 'green', rationale: 'Handoff — важная передача' },
      evening: { dones: [{ text: 'Handoff передан Сидорову — все спецификации' }, { text: 'Push-уведомления: 3 варианта дизайна' }], blockers: [], sentiment: 'green', rationale: 'Передача прошла гладко' },
    },
    {
      date: '2026-05-20',
      morning: { plans: [{ text: 'Дизайн push-уведомлений — финализация', priority: 'high' }, { text: 'Обновить дизайн-систему — новые компоненты', priority: 'medium' }], sentiment: 'yellow', rationale: 'Дизайн-система отстаёт от продукта' },
      evening: { dones: [{ text: 'Push-уведомления: 5 состояний спроектированы' }], blockers: [{ text: 'Дизайн-система не успевает за продуктом', severity: 'medium' }], sentiment: 'yellow', rationale: 'Нужно выделить время на систему' },
    },
    {
      date: '2026-05-21',
      morning: { plans: [{ text: 'Дизайн onboarding flow — новый пользователь', priority: 'high' }, { text: 'Мобильный UI — экран настроек', priority: 'medium' }], sentiment: 'green', rationale: 'Onboarding — интересный челлендж' },
      evening: { dones: [{ text: 'Onboarding: 5 экранов + анимации' }, { text: 'Экран настроек — готов' }], blockers: [], sentiment: 'green', rationale: 'Onboarding выглядит отлично' },
    },
    {
      date: '2026-05-22',
      morning: { plans: [{ text: 'Мобильный UI — экран записи', priority: 'high' }, { text: 'Прототип для CustDev', priority: 'high' }], sentiment: 'green', rationale: 'Два важных экрана' },
      evening: { dones: [{ text: 'Экран записи готов — таймлайн + контролы' }, { text: 'Прототип для CustDev отправлен Волковой' }], blockers: [], sentiment: 'green', rationale: 'Всё успела' },
    },
    {
      date: '2026-05-23',
      morning: { plans: [{ text: 'Ретро Sprint 13 — дизайн-блок', priority: 'medium' }, { text: 'Планирование Sprint 14 — дизайн-задачи', priority: 'high' }], sentiment: 'green', rationale: 'Ретро и планирование — рутина' },
      evening: { dones: [{ text: 'Ретро: 2 дизайн-улучшения предложила' }, { text: 'Sprint 14: 8 дизайн-задач оценены' }], blockers: [], sentiment: 'green', rationale: 'Спринт спланирован' },
      // skip evening — missed
    },
    {
      date: '2026-05-26',
      morning: { plans: [{ text: 'Дизайн мобильного чата — экран', priority: 'high' }, { text: 'Иконки для нового меню', priority: 'low' }], sentiment: 'green', rationale: 'Новый спринт — новые экраны' },
      evening: { dones: [{ text: 'Мобильный чат: дизайн готов, 4 состояния' }, { text: 'Иконки: 12 штук в Figma' }], blockers: [], sentiment: 'green', rationale: 'Продуктивный день' },
    },
    {
      date: '2026-05-27',
      morning: { plans: [{ text: 'Дизайн empty states — мобильное приложение', priority: 'medium' }, { text: 'Ревью UI от Сидорова — PR #156', priority: 'high' }], sentiment: 'yellow', rationale: 'Много мелких задач, нужно фокусироваться' },
      evening: { dones: [{ text: 'Empty states: 6 экранов готовы' }], blockers: [{ text: 'Сидоров реализовал не по спецификации — 3 бага', severity: 'medium' }], sentiment: 'yellow', rationale: 'UI-баги раздражают' },
      // skip evening — missed
    },
    {
      date: '2026-05-28',
      morning: { plans: [{ text: 'Фикс UI-багов с Сидоровым', priority: 'high' }, { text: 'Подготовить дизайн для демо Ростелеком', priority: 'high' }], sentiment: 'green', rationale: 'Демо сегодня — нужно всё доделать' },
      evening: { dones: [{ text: '3 UI-бага исправлены совместно' }, { text: 'Дизайн для демо готов — скриншоты и мокапы' }], blockers: [], sentiment: 'green', rationale: 'Всё готово к демо' },
    },
  ];

  // Build check-in records
  const personDayArrays: { personKey: string; days: typeof kozlovDays }[] = [
    { personKey: 'kozlov', days: kozlovDays },
    { personKey: 'volkova', days: volkovaDays },
    { personKey: 'morozov', days: morozovDays },
    { personKey: 'sokolova', days: sokolovaDays },
    { personKey: 'petrova', days: petrovaDays },
  ];

  // Petrova misses 2 evening check-ins (May 23 and May 27)
  const petrovaSkipEvenings = new Set(['2026-05-23', '2026-05-27']);

  let checkInCount = 0;

  for (const { personKey, days } of personDayArrays) {
    const personId = req(ids.persons[personKey], `persons.${personKey}`);

    for (const day of days) {
      // Morning
      await prisma.dailyCheckIn.create({
        data: {
          tenantId,
          personId,
          kind: 'morning',
          dateLocal: day.date,
          plansJson: day.morning.plans as object[],
          sentiment: day.morning.sentiment,
          sentimentRationale: day.morning.rationale,
          completedAt: new Date(`${day.date}T09:30:00Z`),
        },
      });
      checkInCount++;

      // Evening (skip some for Petrova)
      if (personKey === 'petrova' && petrovaSkipEvenings.has(day.date)) {
        continue;
      }

      await prisma.dailyCheckIn.create({
        data: {
          tenantId,
          personId,
          kind: 'evening',
          dateLocal: day.date,
          donesJson: day.evening.dones as object[],
          blockersJson: day.evening.blockers.length > 0 ? (day.evening.blockers as object[]) : undefined,
          sentiment: day.evening.sentiment,
          sentimentRationale: day.evening.rationale,
          completedAt: new Date(`${day.date}T18:30:00Z`),
        },
      });
      checkInCount++;
    }
  }

  console.log(`[demo/operations] Создано ${checkInCount} DailyCheckIn записей.`);

  // ── 2. WeeklyOperationsDigest (3) ─────────────────────────────────────

  console.log('[demo/operations] Создание WeeklyOperationsDigest...');

  const weeklyDigests = [
    {
      weekStart: '2026-05-12',
      weekEnd: '2026-05-18',
      bodyMarkdown: `## Неделя 12–18 мая\n\n### Общий тонус\nКоманда в зелёной зоне: 70% чек-инов с sentiment=green. Козлов активно закрывает уязвимости auth. Волкова провела продуктивный CustDev с Ростелеком.\n\n### Ключевые решения\n- Hotfix rate limiting на login endpoint — задеплоен\n- JWT expiration hotfix — готов к деплою\n\n### Блокеры\n- CI-тесты падают на интеграционных (решено к среде)\n- Мобильное отстаёт на 3 дня (SDK видеозвонка)\n\n### Цели\n- ARR: 62/100 — стабильный рост\n- v2.0: 71/100 — в графике\n- Мобильное: 42/100 — требует внимания\n- NPS: 76/100 — выше ожиданий\n\n### Рекомендации\n1. Выделить Козлову помощника на auth-задачи\n2. Рассмотреть обходной путь для SDK видеозвонка\n3. Подготовить демо для Ростелеком к 28 мая`,
      metricsJson: { checkInCompliance: 85, avgSentiment: 'green', blockersResolved: 4, newIssues: 6, closedIssues: 5 },
      sourcesJson: { meetings: 3, checkIns: 48 },
    },
    {
      weekStart: '2026-05-19',
      weekEnd: '2026-05-25',
      bodyMarkdown: `## Неделя 19–25 мая\n\n### Общий тонус\nКоманда работает интенсивно: 55% green, 30% yellow, 15% red. Козлов под давлением (2 red-дня), но справляется. Волкова ведёт 3 продукта — нужна помощь.\n\n### Ключевые решения\n- OAuth2 + PKCE: миграция начата\n- Дизайн CallScreen v3: утверждён\n- Пилот Ростелеком: 500 юзеров — согласован\n- Code review SLA: 24 часа — принято\n\n### Блокеры\n- Token revocation не работает для refresh (решено)\n- SDK видеозвонка не совместим с OAuth2 (workaround найден)\n- Нет QA-процесса в мобильной команде\n\n### Цели\n- ARR: 72/100 (+10 за неделю — пилоты конвертируются)\n- v2.0: 65/100 (-6 — auth замедлил)\n- Мобильное: 55/100 (+13 — прогресс)\n- NPS: 80/100 (+4)\n\n### Рекомендации\n1. Нанять junior PM для разгрузки Волковой\n2. Запустить QA-процесс в мобильной команде\n3. Подготовить борд-материалы`,
      metricsJson: { checkInCompliance: 90, avgSentiment: 'yellow', blockersResolved: 5, newIssues: 8, closedIssues: 6 },
      sourcesJson: { meetings: 4, checkIns: 50 },
    },
    {
      weekStart: '2026-05-26',
      weekEnd: '2026-06-01',
      bodyMarkdown: `## Неделя 26 мая – 1 июня\n\n### Общий тонус\nФинальная неделя перед демо Ростелеком. 65% green, 25% yellow, 10% red. Команда мобилизовалась. Договор с Ростелеком подписан.\n\n### Ключевые события\n- Демо Ростелеком: прошло успешно, клиент впечатлён\n- Договор Ростелеком: подписан\n- Sprint 14: начат, 18 story points запланировано\n- Slack-интеграция: договорились о пилоте\n\n### Блокеры\n- UI-баги в мобильном (3 штуки, исправлены)\n- Перегрузка Волковой (нужен junior PM)\n\n### Цели\n- ARR: прогноз 75+ к концу недели\n- v2.0: 65 — auth под контролем\n- Мобильное: 60+ — ускоряется\n- NPS: 80+ — стабилен\n\n### Рекомендации\n1. Начать найм junior PM (приоритет — июнь)\n2. Подготовить Q3 roadmap\n3. Запустить пилот Ростелеком в срок`,
      metricsJson: { checkInCompliance: 87, avgSentiment: 'green', blockersResolved: 3, newIssues: 4, closedIssues: 5 },
      sourcesJson: { meetings: 3, checkIns: 48 },
    },
  ];

  for (const wd of weeklyDigests) {
    await prisma.weeklyOperationsDigest.create({
      data: {
        tenantId,
        weekStart: wd.weekStart,
        weekEnd: wd.weekEnd,
        bodyMarkdown: wd.bodyMarkdown,
        metricsJson: wd.metricsJson as object,
        sourcesJson: wd.sourcesJson as object,
      },
    });
  }

  // ── 3. DailyOperationsDigest (5) ──────────────────────────────────────

  console.log('[demo/operations] Создание DailyOperationsDigest...');

  const dailyDigests = [
    {
      dateLocal: '2026-05-22',
      bodyMarkdown: `## Четверг, 22 мая\n\n### Чек-ины\n5 из 5 сотрудников заполнили утренние чек-ины. Вечерние: 5/5.\n\n### Новые блокеры\n- SDK видеозвонка не совместим с OAuth2 (Козлов, medium)\n\n### Решения\n- Token revocation — фикс на ревью\n\n### Цели\n- ARR: +5 за 3 дня — пилоты конвертируются\n\n### Тонус\n60% green, 40% yellow. Козлов и Волкова под нагрузкой.`,
      metricsJson: { greenShare: 60, yellowShare: 40, redShare: 0, topBlockers: ['SDK+OAuth2'], openCommitments: 3 },
      sourcesJson: { checkIns: 10, blockers: 1, decisions: 1 },
      shortSummary: 'Команда в рабочем режиме. Один новый блокер (SDK+OAuth2). Козлов закрывает token revocation.',
    },
    {
      dateLocal: '2026-05-23',
      bodyMarkdown: `## Пятница, 23 мая\n\n### Чек-ины\nУтро: 5/5. Вечер: 4/5 (Петрова не заполнила).\n\n### Ретроспектива Sprint 13\n- Закрыто 85% задач в срок\n- 3 action items: ускорить code review, добавить QA, документация K8s\n\n### Планирование Sprint 14\n- 18 story points запланировано\n- Приоритет: OAuth2, мобильное, push-уведомления\n\n### Тонус\n80% green, 20% yellow. Команда завершила спринт на позитиве.`,
      metricsJson: { greenShare: 80, yellowShare: 20, redShare: 0, topBlockers: [], openCommitments: 2 },
      sourcesJson: { checkIns: 9, meetings: 1, retrospective: true },
      shortSummary: 'Ретро Sprint 13: 85% задач закрыто. Sprint 14 спланирован. Команда на подъёме.',
    },
    {
      dateLocal: '2026-05-26',
      bodyMarkdown: `## Понедельник, 26 мая\n\n### Чек-ины\nУтро: 5/5. Вечер: 5/5.\n\n### Sprint 14 — старт\n- OAuth2 scope parameter: Козлов начал\n- Мобильный чат: Петрова спроектировала\n- Slack-интеграция: Морозов договорился о пилоте\n\n### Новые сделки\n- Тинькофф: квалифицирован, демо на среду\n\n### Тонус\n80% green, 20% yellow. Свежая энергия нового спринта.`,
      metricsJson: { greenShare: 80, yellowShare: 20, redShare: 0, topBlockers: [], openCommitments: 4 },
      sourcesJson: { checkIns: 10, newDeals: 1 },
      shortSummary: 'Sprint 14 стартовал. Козлов на OAuth2, Петрова на мобильном. Тинькофф — новый лид.',
    },
    {
      dateLocal: '2026-05-27',
      bodyMarkdown: `## Вторник, 27 мая\n\n### Чек-ины\nУтро: 5/5. Вечер: 4/5 (Петрова не заполнила).\n\n### Ключевые события\n- Договор Ростелеком подписан!\n- Борд-материалы финализированы\n- Демо Тинькофф: проведено, просят PoC\n\n### Блокеры\n- UI-баги в мобильном (3 штуки) — Сидоров + Петрова\n\n### Тонус\n60% green, 40% yellow. Морозов и Соколова в зелёной зоне.`,
      metricsJson: { greenShare: 60, yellowShare: 40, redShare: 0, topBlockers: ['UI bugs mobile'], openCommitments: 3 },
      sourcesJson: { checkIns: 9, signedDeals: 1, demos: 1 },
      shortSummary: 'Договор Ростелеком подписан — большая победа. Тинькофф просят PoC. UI-баги в работе.',
    },
    {
      dateLocal: '2026-05-28',
      bodyMarkdown: `## Среда, 28 мая\n\n### Чек-ины\nУтро: 5/5. Вечер: 5/5.\n\n### Демо Ростелеком\n- Прошло успешно, клиент впечатлён AI-отчётами\n- Следующий шаг: запуск пилота на 500 юзеров\n\n### Метрики дня\n- Sales: конверсия 22%, pipeline 4.2M\n- NPS: 52 (цель >50 — достигнута!)\n\n### Тонус\n80% green, 20% yellow. Команда на подъёме после успешного демо.`,
      metricsJson: { greenShare: 80, yellowShare: 20, redShare: 0, topBlockers: [], openCommitments: 2 },
      sourcesJson: { checkIns: 10, demos: 1, npsScore: 52 },
      shortSummary: 'Демо Ростелеком — успех! NPS достиг целевого значения 52. Команда мотивирована.',
    },
  ];

  for (const dd of dailyDigests) {
    await prisma.dailyOperationsDigest.create({
      data: {
        tenantId,
        dateLocal: dd.dateLocal,
        bodyMarkdown: dd.bodyMarkdown,
        metricsJson: dd.metricsJson as object,
        sourcesJson: dd.sourcesJson as object,
        shortSummary: dd.shortSummary,
      },
    });
  }

  console.log(
    `[demo/operations] Создано: ${checkInCount} DailyCheckIn, ` +
    `${weeklyDigests.length} WeeklyOperationsDigest, ` +
    `${dailyDigests.length} DailyOperationsDigest.`,
  );
};
