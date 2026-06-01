/**
 * Демо-данные «ТехноСтрим» — встречи (Meetings).
 *
 * Создаёт 7 встреч с полными связанными данными:
 * Meeting, Participant, AiResult, Transcript, MeetingChapter,
 * MeetingQualityScore, MeetingBehaviorMetrics, MeetingParticipantBehavior.
 */
import type { SeedFn } from './types';
import { daysAgo, demoId } from './types';
import type { Prisma } from '@prisma/client';

/* -------------------------------------------------------------------------- */
/*  Справочник имён                                                           */
/* -------------------------------------------------------------------------- */

const PERSON_NAMES: Record<string, string> = {
  morozov: 'Алексей Морозов',
  kozlov: 'Дмитрий Козлов',
  volkova: 'Марина Волкова',
  petrova: 'Анна Петрова',
  novikov: 'Игорь Новиков',
  sidorov: 'Павел Сидоров',
  popov: 'Сергей Попов',
  kuznetsova: 'Ольга Кузнецова',
  sokolova: 'Екатерина Соколова',
};

/* -------------------------------------------------------------------------- */
/*  Типы                                                                      */
/* -------------------------------------------------------------------------- */

interface Turn {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
}

interface MeetingDef {
  key: string;
  seqNum: number;
  title: string;
  type: 'standup' | 'plan_fact' | 'project' | 'custdev' | 'retrospective' | 'team' | 'task_discussion';
  daysAgoN: number;
  durationMs: number;
  /** Pulse Wave 6 §6.3 — формульный roi (Decimal(8,3)). Передаётся строкой. */
  roiScore: string;
  participants: { key: string; isHost: boolean }[];
  summary: string;
  structuredData: Record<string, unknown>;
  turns: Turn[];
  chapters: { title: string; startMs: number; endMs: number; summary?: string }[];
  quality: {
    overall: number;
    preparation: number;
    structure: number;
    clarity: number;
    outcomes: number;
    engagement: number;
  };
  strengths: string[];
  recommendations: { text: string; severity: string; category: string }[];
  behavior: {
    silencePercent: number;
    dominanceIndex: number;
    crossTalkMs: number;
    diarizationConfidence: number;
  };
  participantBehavior: {
    speakingTimePercent: number;
    turnsCount: number;
    questionCount: number;
    fillerWordsCount: number;
    interruptionsMade: number;
    interruptionsReceived: number;
  }[];
}

/* -------------------------------------------------------------------------- */
/*  Определения 7 встреч                                                      */
/* -------------------------------------------------------------------------- */

const MEETINGS: MeetingDef[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // 1. Еженедельный стендап
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'standup1',
    seqNum: 1,
    title: 'Еженедельный стендап',
    type: 'standup',
    daysAgoN: 1,
    durationMs: 900_000,
    roiScore: '0.850',
    participants: [
      { key: 'morozov', isHost: true },
      { key: 'kozlov', isHost: false },
      { key: 'volkova', isHost: false },
      { key: 'petrova', isHost: false },
    ],
    summary:
      'Еженедельный стендап команды. Козлов завершил hotfix rate limiting на login endpoint, PR на ревью. Волкова провела CustDev с ещё одним потенциальным клиентом. Петрова передала дизайн-файлы CallScreen Сидорову. Обсудили баг на staging — Сидорову нужна помощь Козлова для воспроизведения.',
    structuredData: {
      decisions: [
        'Hotfix rate limiting — приоритет до конца недели',
        'Сидоров и Козлов вместе разбирают staging-баг в четверг',
      ],
      actionItems: [
        { assignee: 'Козлов', task: 'Закончить PR по rate limiting', deadline: '29.05' },
        { assignee: 'Сидоров', task: 'Интеграция дизайна CallScreen', deadline: '30.05' },
        { assignee: 'Петрова', task: 'Финальные правки UX экрана звонка', deadline: '29.05' },
      ],
      risks: [
        'Staging-баг не воспроизводится 3 дня — может заблокировать релиз',
        'Козлов перегружен — 5 задач в Sprint 14',
      ],
      keyTopics: ['Безопасность auth-модуля', 'Прогресс мобильного приложения', 'Staging-баг'],
    },
    turns: [
      { speaker: 'Алексей Морозов', startMs: 0, endMs: 5200, text: 'Всем привет, начинаем стендап. Козлов, что у тебя?' },
      { speaker: 'Дмитрий Козлов', startMs: 5500, endMs: 18000, text: 'Закончил hotfix rate limiting на login endpoint. PR уже на ревью, жду аппрув от Новикова. Ещё закрыл два тикета по auth-модулю — исправил expired JWT и добавил CSRF-токены.' },
      { speaker: 'Алексей Морозов', startMs: 18500, endMs: 23000, text: 'Отлично. А staging-баг? Сидоров жалуется, что не может воспроизвести.' },
      { speaker: 'Дмитрий Козлов', startMs: 23500, endMs: 35000, text: 'Да, я видел. Проблема в том, что баг плавающий — проявляется только при определённом тайминге запросов. Я думаю, это race condition в Redis-кэше. Могу подключиться к Сидорову в четверг, вместе посмотрим.' },
      { speaker: 'Алексей Морозов', startMs: 35500, endMs: 40000, text: 'Хорошо, договорились. Волкова, как у тебя?' },
      { speaker: 'Марина Волкова', startMs: 40500, endMs: 58000, text: 'Провела CustDev с потенциальным клиентом — средняя компания, двести человек. Основная боль — нет интеграции с их CRM на Битрикс24. Готовы платить за кастомную интеграцию. Ещё один звонок на четверг запланирован.' },
      { speaker: 'Алексей Морозов', startMs: 58500, endMs: 65000, text: 'Интересно. Интеграция с Битрикс24 — это фича, которую мы уже обсуждали. Козлов, насколько сложно?' },
      { speaker: 'Дмитрий Козлов', startMs: 65500, endMs: 78000, text: 'Средне. У Битрикс24 есть REST API, но документация так себе. Неделя работы для одного бэкендера. Но если клиент готов платить — имеет смысл.' },
      { speaker: 'Марина Волкова', startMs: 78500, endMs: 85000, text: 'Я добавлю в бэклог с приоритетом high. Ещё — клиент спросил про мобильное приложение.' },
      { speaker: 'Алексей Морозов', startMs: 85500, endMs: 90000, text: 'Петрова, расскажи про мобайл.' },
      { speaker: 'Анна Петрова', startMs: 90500, endMs: 108000, text: 'Дизайн CallScreen v3 готов. Передала файлы Сидорову вчера. Основные изменения — новый layout для PiP-режима и обновлённая панель управления звонком. Финальные правки по UX сделаю до конца недели.' },
      { speaker: 'Дмитрий Козлов', startMs: 108500, endMs: 118000, text: 'Кстати, по PiP — мы с Сидоровым обсудили и решили упростить для MVP. Полноценный PiP с overlay — это сложно, сделаем просто свёрнутое окно с видео.' },
      { speaker: 'Анна Петрова', startMs: 118500, endMs: 125000, text: 'Да, я уже обновила макеты под упрощённый вариант. Выглядит нормально.' },
      { speaker: 'Алексей Морозов', startMs: 125500, endMs: 132000, text: 'Окей. Вернёмся к staging-багу. Сидоров, можешь описать подробнее?' },
      { speaker: 'Анна Петрова', startMs: 132500, endMs: 140000, text: 'Сидорова сегодня нет на стендапе, он на больничном. Но он писал в чат — баг проявляется при одновременном подключении трёх и более участников.' },
      { speaker: 'Дмитрий Козлов', startMs: 140500, endMs: 155000, text: 'Ага, тогда это похоже на проблему с SFU — когда несколько медиа-потоков одновременно, LiveKit Server может не успевать маршрутизировать. Я посмотрю логи Egress-сервиса. Возможно, нужен патч конфигурации.' },
      { speaker: 'Алексей Морозов', startMs: 155500, endMs: 162000, text: 'Это критично. Если не починим — релиз v2.0 под вопросом.' },
      { speaker: 'Марина Волкова', startMs: 162500, endMs: 175000, text: 'Кстати, по релизу — мы обещали клиентам v2.0 к пятому июня. Если staging-баг заблокирует, нужно предупредить sales-команду.' },
      { speaker: 'Алексей Морозов', startMs: 175500, endMs: 182000, text: 'Согласен. Соколова должна знать. Я ей напишу после стендапа.' },
      { speaker: 'Дмитрий Козлов', startMs: 182500, endMs: 195000, text: 'Давайте так — я сегодня закрою PR по rate limiting, а завтра с утра сяду с Сидоровым за staging-баг. Если к среде не починим — эскалируем.' },
      { speaker: 'Алексей Морозов', startMs: 195500, endMs: 202000, text: 'Принято. Петрова, по дизайну — всё по плану?' },
      { speaker: 'Анна Петрова', startMs: 202500, endMs: 215000, text: 'Да, финальные правки по UX экрана звонка сделаю завтра. Ещё начала работать над экраном настроек — там небольшие изменения в навигации.' },
      { speaker: 'Марина Волкова', startMs: 215500, endMs: 228000, text: 'По настройкам — добавь, пожалуйста, секцию для уведомлений. Клиенты просят.' },
      { speaker: 'Анна Петрова', startMs: 228500, endMs: 235000, text: 'Ок, добавлю в спринт. Могу показать макет в пятницу.' },
      { speaker: 'Алексей Морозов', startMs: 235500, endMs: 248000, text: 'Хорошо, на этом всё. Итого: Козлов — rate limiting и staging-баг, Петрова — UX и настройки, Волкова — CustDev и бэклог. Всем хорошей работы, до завтра.' },
    ],
    chapters: [
      { title: 'Открытие', startMs: 0, endMs: 60_000, summary: 'Морозов открывает стендап, передаёт слово Козлову.' },
      { title: 'Обновление Козлова', startMs: 60_000, endMs: 300_000, summary: 'Hotfix rate limiting, auth-модуль, обсуждение staging-бага.' },
      { title: 'Мобильное приложение', startMs: 300_000, endMs: 600_000, summary: 'Прогресс CallScreen, PiP-режим, передача дизайна Сидорову.' },
      { title: 'Итоги', startMs: 600_000, endMs: 900_000, summary: 'Подведение итогов, распределение задач на неделю.' },
    ],
    quality: { overall: 82, preparation: 85, structure: 90, clarity: 80, outcomes: 75, engagement: 80 },
    strengths: [
      'Чёткая структура стендапа — каждый участник отчитался',
      'Конкретные action items с дедлайнами',
      'Быстрое выявление рисков (staging-баг)',
    ],
    recommendations: [
      { text: 'Привлекать отсутствующих участников через async-обновления', severity: 'info', category: 'engagement' },
      { text: 'Фиксировать решения в протоколе встречи для отслеживания', severity: 'warning', category: 'outcomes' },
    ],
    behavior: { silencePercent: 12, dominanceIndex: 0.25, crossTalkMs: 18_000, diarizationConfidence: 0.96 },
    participantBehavior: [
      { speakingTimePercent: 22, turnsCount: 10, questionCount: 3, fillerWordsCount: 2, interruptionsMade: 0, interruptionsReceived: 0 },
      { speakingTimePercent: 35, turnsCount: 6, questionCount: 0, fillerWordsCount: 4, interruptionsMade: 1, interruptionsReceived: 0 },
      { speakingTimePercent: 23, turnsCount: 4, questionCount: 1, fillerWordsCount: 1, interruptionsMade: 0, interruptionsReceived: 1 },
      { speakingTimePercent: 20, turnsCount: 5, questionCount: 0, fillerWordsCount: 3, interruptionsMade: 0, interruptionsReceived: 0 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Планирование Sprint 14
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'planning14',
    seqNum: 2,
    title: 'Планирование Sprint 14',
    type: 'plan_fact',
    daysAgoN: 9,
    durationMs: 2_700_000,
    roiScore: '1.200',
    participants: [
      { key: 'kozlov', isHost: true },
      { key: 'novikov', isHost: false },
      { key: 'sidorov', isHost: false },
      { key: 'popov', isHost: false },
    ],
    summary:
      'Планирование Sprint 14. Распределили 8 задач: приоритет — рефакторинг auth-модуля (Козлов) и миграция user-service (Новиков). Попов берёт E2E-тесты auth-flow. Обсудили Docker-оптимизацию и Kubernetes-миграцию — решили начать с Dockerfile.',
    structuredData: {
      decisions: [
        'PLAT-7 — главная задача спринта',
        'OAuth2 миграцию отложить на Sprint 15',
        'Новиков: user-service + Docker-оптимизация',
        'Попов: E2E тесты auth',
      ],
      actionItems: [
        { assignee: 'Козлов', task: 'Аудит + рефакторинг auth', deadline: '02.06' },
        { assignee: 'Новиков', task: 'Миграция user-service + Docker', deadline: '02.06' },
        { assignee: 'Попов', task: 'E2E тесты auth-flow', deadline: '02.06' },
      ],
      risks: [
        'Козлов — single point of failure для auth',
        'K8s миграция заблокирована auth-рефакторингом',
      ],
      keyTopics: ['Планирование Sprint 14', 'Auth-рефакторинг', 'Docker-оптимизация'],
    },
    turns: [
      { speaker: 'Дмитрий Козлов', startMs: 0, endMs: 8000, text: 'Коллеги, начинаем планирование Sprint 14. У нас в бэклоге двенадцать задач, нужно отобрать восемь. Начнём с приоритетов.' },
      { speaker: 'Игорь Новиков', startMs: 8500, endMs: 22000, text: 'Я предлагаю на первый план поставить PLAT-7 — рефакторинг auth-модуля. Мы его уже два спринта откладываем, и техдолг растёт. Плюс от него зависит K8s миграция.' },
      { speaker: 'Дмитрий Козлов', startMs: 22500, endMs: 38000, text: 'Согласен. PLAT-7 — это мой основной фокус на спринт. Аудит показал четыре уязвимости, нужно закрыть хотя бы критические. Оценку ставлю в восемь story points.' },
      { speaker: 'Сергей Попов', startMs: 38500, endMs: 48000, text: 'Восемь — это оптимистично. Я бы сказал десять, учитывая что нужно написать тесты. Auth — это критический модуль, без тестов нельзя.' },
      { speaker: 'Дмитрий Козлов', startMs: 48500, endMs: 55000, text: 'Ок, давайте восемь с условием, что Попов пишет E2E тесты параллельно.' },
      { speaker: 'Сергей Попов', startMs: 55500, endMs: 65000, text: 'Могу. Мне нужен будет API-контракт от тебя — какие эндпоинты меняются, какие новые появляются. Без этого тесты не напишешь.' },
      { speaker: 'Дмитрий Козлов', startMs: 65500, endMs: 72000, text: 'Дам контракт до среды. Там три новых эндпоинта и два изменённых.' },
      { speaker: 'Павел Сидоров', startMs: 72500, endMs: 88000, text: 'А что с фронтендом? Если auth-эндпоинты меняются, мне нужно обновить API-клиент. Это ещё одна задача, которая должна быть в спринте.' },
      { speaker: 'Дмитрий Козлов', startMs: 88500, endMs: 95000, text: 'Да, правильно. Сидоров, возьмёшь обновление API-клиента на фронте?' },
      { speaker: 'Павел Сидоров', startMs: 95500, endMs: 108000, text: 'Возьму. Оценю в три story points. Ещё у меня в работе интеграция дизайна CallScreen — это тоже три points. Итого шесть на спринт.' },
      { speaker: 'Игорь Новиков', startMs: 108500, endMs: 125000, text: 'Я на себя беру миграцию user-service на новый ORM. Это пять story points. Плюс Docker-оптимизация — уменьшить размер образа auth-service. Ещё два points.' },
      { speaker: 'Дмитрий Козлов', startMs: 125500, endMs: 135000, text: 'Docker — это хорошо. Образ сейчас полтора гигабайта, нужно довести до трёхсот мегабайт. Multi-stage build и Alpine base.' },
      { speaker: 'Игорь Новиков', startMs: 135500, endMs: 148000, text: 'Именно. Ещё хочу добавить health check endpoint в Dockerfile. И настроить graceful shutdown — сейчас контейнер убивается без ожидания активных соединений.' },
      { speaker: 'Сергей Попов', startMs: 148500, endMs: 158000, text: 'А Kubernetes-миграция? Мы же хотели в этом спринте начать.' },
      { speaker: 'Дмитрий Козлов', startMs: 158500, endMs: 175000, text: 'K8s откладываем на Sprint 15. Без auth-рефакторинга нет смысла — всё равно придётся переделывать деплойменты. Сначала фундамент, потом оркестрация.' },
      { speaker: 'Павел Сидоров', startMs: 175500, endMs: 185000, text: 'Логично. А что с OAuth2 миграцией? Мы же обсуждали переход на OAuth2 + PKCE.' },
      { speaker: 'Дмитрий Козлов', startMs: 185500, endMs: 200000, text: 'OAuth2 — тоже Sprint 15. Это большая задача, нужно спроектировать flow, выбрать провайдера, написать миграцию. В Sprint 14 только hotfix критических уязвимостей.' },
      { speaker: 'Игорь Новиков', startMs: 200500, endMs: 215000, text: 'Кстати, по OAuth2 — я смотрел Keycloak. Open source, поддерживает PKCE из коробки, есть LDAP-интеграция. Может быть хорошим вариантом.' },
      { speaker: 'Дмитрий Козлов', startMs: 215500, endMs: 225000, text: 'Keycloak — вариант, но тяжёлый. Для нашего масштаба может быть overkill. Давайте в Sprint 15 сделаем сравнение с Auth0 и Cognito.' },
      { speaker: 'Сергей Попов', startMs: 225500, endMs: 238000, text: 'Ок, итого по тестам — я пишу E2E для auth-flow: логин, логаут, refresh token, CSRF-проверка. Плюс smoke-тесты для новых эндпоинтов. Оценю в пять points.' },
      { speaker: 'Дмитрий Козлов', startMs: 238500, endMs: 248000, text: 'Пять — нормально. Добавь ещё тест на rate limiting, раз уж мы его починили.' },
      { speaker: 'Сергей Попов', startMs: 248500, endMs: 258000, text: 'Добавлю. Тогда шесть points. Это мой максимум на спринт.' },
      { speaker: 'Павел Сидоров', startMs: 258500, endMs: 270000, text: 'У меня вопрос по staging-багу. Он в этом спринте или следующем? Я три дня не могу воспроизвести.' },
      { speaker: 'Дмитрий Козлов', startMs: 270500, endMs: 285000, text: 'В этом, обязательно. Я подключусь к тебе, вместе посмотрим. Я думаю, это race condition в Redis. Давай поставим три points на исследование и фикс.' },
      { speaker: 'Павел Сидоров', startMs: 285500, endMs: 295000, text: 'Ок, три points на staging-баг. Итого у меня двенадцать points — это нормально?' },
      { speaker: 'Дмитрий Козлов', startMs: 295500, endMs: 308000, text: 'Многовато. CallScreen можно перенести в следующий спринт, если не успеваешь.' },
      { speaker: 'Павел Сидоров', startMs: 308500, endMs: 318000, text: 'Нет, CallScreen хочу закрыть. Дизайн готов, осталось натянуть на компоненты. Справлюсь.' },
      { speaker: 'Игорь Новиков', startMs: 318500, endMs: 330000, text: 'Давайте подведём итоги. Итого velocity: Козлов — восемь, я — семь, Попов — шесть, Сидоров — двенадцать. Суммарно тридцать три points.' },
      { speaker: 'Дмитрий Козлов', startMs: 330500, endMs: 345000, text: 'Наша средняя velocity — тридцать. Немного выше, но Sprint 13 мы закрыли на двадцать восемь. Если Сидорову будет тяжело — CallScreen переносим.' },
      { speaker: 'Сергей Попов', startMs: 345500, endMs: 355000, text: 'Ещё вопрос — daily standups остаются в том же формате? По понедельникам, средам, пятницам?' },
    ],
    chapters: [
      { title: 'Обзор бэклога', startMs: 0, endMs: 480_000, summary: 'Обзор 12 задач из бэклога, определение приоритетов.' },
      { title: 'Оценка задач', startMs: 480_000, endMs: 1_200_000, summary: 'Story point оценка: auth-рефакторинг, user-service миграция, Docker-оптимизация.' },
      { title: 'Распределение', startMs: 1_200_000, endMs: 2_100_000, summary: 'Назначение задач: Козлов — auth, Новиков — user-service + Docker, Попов — E2E тесты.' },
      { title: 'Итоги спринта', startMs: 2_100_000, endMs: 2_700_000, summary: 'Velocity 33 points, Sprint review 6 июня.' },
    ],
    quality: { overall: 78, preparation: 70, structure: 85, clarity: 80, outcomes: 82, engagement: 75 },
    strengths: [
      'Чёткое распределение задач с ответственными',
      'Обоснованная оценка story points с дискуссией',
      'Явные решения по отложенным задачам (OAuth2, K8s)',
    ],
    recommendations: [
      { text: 'Подготовить бэклог до встречи — часть времени ушла на обзор задач', severity: 'warning', category: 'preparation' },
      { text: 'Зафиксировать velocity-тренд для более точного планирования', severity: 'info', category: 'outcomes' },
    ],
    behavior: { silencePercent: 8, dominanceIndex: 0.30, crossTalkMs: 42_000, diarizationConfidence: 0.94 },
    participantBehavior: [
      { speakingTimePercent: 38, turnsCount: 13, questionCount: 2, fillerWordsCount: 5, interruptionsMade: 1, interruptionsReceived: 0 },
      { speakingTimePercent: 22, turnsCount: 5, questionCount: 1, fillerWordsCount: 3, interruptionsMade: 0, interruptionsReceived: 0 },
      { speakingTimePercent: 18, turnsCount: 6, questionCount: 2, fillerWordsCount: 2, interruptionsMade: 0, interruptionsReceived: 0 },
      { speakingTimePercent: 22, turnsCount: 6, questionCount: 3, fillerWordsCount: 1, interruptionsMade: 0, interruptionsReceived: 1 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Обзор мобильного приложения
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'mobile_review',
    seqNum: 3,
    title: 'Обзор мобильного приложения',
    type: 'project',
    daysAgoN: 6,
    durationMs: 1_800_000,
    roiScore: '1.550',
    participants: [
      { key: 'volkova', isHost: true },
      { key: 'petrova', isHost: false },
      { key: 'kozlov', isHost: false },
    ],
    summary:
      'Обзор прогресса мобильного приложения. Петрова показала дизайн экрана видеозвонка — утверждён. Обсудили отставание от графика на 3 дня. Козлов предложил упростить PiP-режим для MVP.',
    structuredData: {
      decisions: [
        'Дизайн CallScreen v3 утверждён',
        'PiP-режим упрощён для MVP',
        'Нужен QA в мобильную команду',
      ],
      actionItems: [
        { assignee: 'Петрова', task: 'Передать дизайн-файлы Сидорову', deadline: '28.05' },
        { assignee: 'Волкова', task: 'Запросить QA-ресурс у Морозова', deadline: '25.05' },
      ],
      risks: ['Отставание 3 дня', 'Нет QA-инженера для мобайл'],
      keyTopics: ['Дизайн CallScreen', 'Отставание от графика', 'QA для мобайл'],
    },
    turns: [
      { speaker: 'Марина Волкова', startMs: 0, endMs: 10000, text: 'Привет! Сегодня разбираем мобайл. Петрова, покажи что готово по дизайну.' },
      { speaker: 'Анна Петрова', startMs: 10500, endMs: 38000, text: 'Да, вот дизайн CallScreen v3. Главная идея — минимализм. Кнопка записи в углу, шаринг экрана свайпом вверх, PiP — миниатюра в углу. Две версии: iOS и Android.' },
      { speaker: 'Дмитрий Козлов', startMs: 38500, endMs: 58000, text: 'Смотрится хорошо. Но PiP на Android работает иначе, чем на iOS. На Android нужен кастомный overlay, системный PiP доступен только с восьмой версии. Нужно учесть fallback.' },
      { speaker: 'Анна Петрова', startMs: 58500, endMs: 78000, text: 'Да, я сделала два варианта. iOS — системный PiP через AVKit, Android — кастомный overlay с перетаскиванием. Показываю оба.' },
      { speaker: 'Марина Волкова', startMs: 78500, endMs: 95000, text: 'Мне нравится iOS-вариант. Но PiP — это MVP-фича? Может, упростить для первого релиза?' },
      { speaker: 'Дмитрий Козлов', startMs: 95500, endMs: 118000, text: 'Согласен. Для MVP можно сделать только миниатюру без перетаскивания. Полноценный PiP с жестами — в следующем релизе. Это сэкономит неделю разработки.' },
      { speaker: 'Анна Петрова', startMs: 118500, endMs: 135000, text: 'Ок, упрощаю. Тогда design spec будет готов сегодня. Обновлю макеты и передам Сидорову.' },
      { speaker: 'Марина Волкова', startMs: 135500, endMs: 158000, text: 'Теперь по графику. Мы отстаём на три дня. Сидоров ждёт дизайн, а мы ещё не передали файлы.' },
      { speaker: 'Анна Петрова', startMs: 158500, endMs: 178000, text: 'Я передам все файлы Сидорову сегодня вечером. Figma, спецификации, анимации — всё готово. Задержка была из-за итераций по PiP.' },
      { speaker: 'Дмитрий Козлов', startMs: 178500, endMs: 205000, text: 'Сидоров опытный, но SDK видеозвонка — это сложно. LiveKit React Native SDK ещё сыроват. Ему нужен кто-то для code review на старте.' },
      { speaker: 'Марина Волкова', startMs: 205500, endMs: 228000, text: 'Козлов, можешь выделять час в день на мобайл-ревью? Хотя бы первые две недели.' },
      { speaker: 'Дмитрий Козлов', startMs: 228500, endMs: 248000, text: 'С Sprint 15 — да. Сейчас у меня auth на шее. Но Сидоров может задавать вопросы в Slack, я отвечаю быстро.' },
      { speaker: 'Марина Волкова', startMs: 248500, endMs: 275000, text: 'Ещё вопрос: QA. У нас вообще нет QA для мобайл. Попов занимается бэкендом. Сидоров сам пишет код и сам тестирует — это неправильно.' },
      { speaker: 'Дмитрий Козлов', startMs: 275500, endMs: 298000, text: 'Да, это проблема. Мобильное приложение — это отдельная платформа, нужен отдельный QA. Хотя бы на период первого релиза.' },
      { speaker: 'Марина Волкова', startMs: 298500, endMs: 320000, text: 'Подниму вопрос с Морозовым. Может, привлечь подрядчика на первый релиз. Или попросить Попова выделить двадцать процентов времени.' },
      { speaker: 'Анна Петрова', startMs: 320500, endMs: 345000, text: 'Я ещё обновила экран списка встреч. Добавила фильтры по типу и дате, группировку по неделям. Показываю.' },
      { speaker: 'Марина Волкова', startMs: 345500, endMs: 368000, text: 'Выглядит отлично. Это в текущий спринт мобайл? Или потом?' },
      { speaker: 'Анна Петрова', startMs: 368500, endMs: 388000, text: 'Дизайн готов, имплементация может быть в следующем спринте. Приоритет — CallScreen.' },
      { speaker: 'Дмитрий Козлов', startMs: 388500, endMs: 412000, text: 'Давайте не раздувать текущий спринт. Экран списка — в следующий. Фокус на видеозвонке.' },
      { speaker: 'Марина Волкова', startMs: 412500, endMs: 435000, text: 'Ок, фиксирую. Петрова передаёт дизайн CallScreen сегодня, Козлов подключится к ревью со следующего спринта, QA — решу с Морозовым до пятницы.' },
      { speaker: 'Анна Петрова', startMs: 435500, endMs: 450000, text: 'Договорились. Отправляю файлы Сидорову через час. Спецификация полная.' },
      { speaker: 'Дмитрий Козлов', startMs: 450500, endMs: 468000, text: 'Дизайн-система на восемьдесят процентов — это хороший прогресс. Петрова, молодец.' },
      { speaker: 'Марина Волкова', startMs: 468500, endMs: 490000, text: 'Согласна. Ок, завершаем. Следующий обзор мобайл — через неделю. Надеюсь, к тому времени отставание сократим.' },
      { speaker: 'Анна Петрова', startMs: 490500, endMs: 505000, text: 'Спасибо! До связи.' },
      { speaker: 'Дмитрий Козлов', startMs: 505500, endMs: 520000, text: 'Пока. Сидорову передайте, что я на связи в Slack.' },
    ],
    chapters: [
      { title: 'Прогресс мобайл', startMs: 0, endMs: 360_000, summary: 'Обзор текущего состояния, отставание от графика.' },
      { title: 'Дизайн CallScreen', startMs: 360_000, endMs: 1_080_000, summary: 'Детальный обзор дизайна, PiP-режим, утверждение v3.' },
      { title: 'Планы', startMs: 1_080_000, endMs: 1_800_000, summary: 'QA для мобайл, передача дизайна, следующие шаги.' },
    ],
    quality: { overall: 85, preparation: 90, structure: 80, clarity: 85, outcomes: 85, engagement: 85 },
    strengths: [
      'Подготовленный дизайн с двумя платформенными вариантами',
      'Активное обсуждение технических ограничений',
      'Конкретные решения по PiP и QA',
    ],
    recommendations: [
      { text: 'Записывать решения в таск-трекер во время встречи', severity: 'info', category: 'outcomes' },
      { text: 'Добавить чек-лист готовности дизайна перед передачей разработчику', severity: 'info', category: 'structure' },
    ],
    behavior: { silencePercent: 10, dominanceIndex: 0.20, crossTalkMs: 25_000, diarizationConfidence: 0.97 },
    participantBehavior: [
      { speakingTimePercent: 30, turnsCount: 9, questionCount: 3, fillerWordsCount: 1, interruptionsMade: 0, interruptionsReceived: 0 },
      { speakingTimePercent: 32, turnsCount: 8, questionCount: 0, fillerWordsCount: 2, interruptionsMade: 0, interruptionsReceived: 0 },
      { speakingTimePercent: 38, turnsCount: 8, questionCount: 1, fillerWordsCount: 3, interruptionsMade: 0, interruptionsReceived: 0 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 4. CustDev: клиент Ростелеком
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'custdev_rostelecom',
    seqNum: 4,
    title: 'CustDev: клиент Ростелеком',
    type: 'custdev',
    daysAgoN: 8,
    durationMs: 3_600_000,
    roiScore: '2.100',
    participants: [
      { key: 'sokolova', isHost: true },
      { key: 'volkova', isHost: false },
      { key: 'morozov', isHost: false },
    ],
    summary:
      'CustDev-интервью с Ростелеком. Клиент готов к пилоту на 500 пользователей. Основные боли: интеграция с их LDAP, безопасность данных, цена. Конкурент Zoom снизил цены на 30%, но клиент недоволен их поддержкой.',
    structuredData: {
      decisions: [
        'Пилот Ростелеком: 500 пользователей, старт июнь',
        'Подготовить LDAP-интеграцию к пилоту',
        'Value-sell стратегия против Zoom-демпинга',
      ],
      actionItems: [
        { assignee: 'Соколова', task: 'Подготовить договор пилота', deadline: '27.05' },
        { assignee: 'Козлов', task: 'LDAP-интеграция: оценка', deadline: '02.06' },
        { assignee: 'Волкова', task: 'Обновить презентацию с учётом болей', deadline: '25.05' },
      ],
      risks: ['Zoom демпингует — нужен value-sell', 'LDAP-интеграция может затянуться'],
      keyTopics: ['Пилот с Ростелеком', 'Конкурентное давление Zoom', 'LDAP-интеграция', 'Ценообразование'],
    },
    turns: [
      { speaker: 'Екатерина Соколова', startMs: 0, endMs: 15000, text: 'Коллеги, давайте разберём итоги CustDev с Ростелеком. Встреча прошла отлично, клиент заинтересован. Начну с общего впечатления.' },
      { speaker: 'Марина Волкова', startMs: 15500, endMs: 32000, text: 'Да, контакт был тёплый. IT-директор Ростелекома, Сергей Николаевич, сразу перешёл к делу. Ему не нужна общая презентация — он уже изучил продукт.' },
      { speaker: 'Алексей Морозов', startMs: 32500, endMs: 48000, text: 'Это хороший знак. Значит, они уже в стадии выбора решения. Что его больше всего волновало?' },
      { speaker: 'Екатерина Соколова', startMs: 48500, endMs: 72000, text: 'Три основные боли. Первая — интеграция с LDAP. У них пять тысяч сотрудников, все в Active Directory. Без SSO и LDAP-синхронизации они не смогут развернуть.' },
      { speaker: 'Марина Волкова', startMs: 72500, endMs: 95000, text: 'Вторая боль — безопасность данных. Ростелеком — это инфраструктурная компания, у них жёсткие требования. Данные должны храниться в РФ, шифрование end-to-end, сертификация ФСТЭК.' },
      { speaker: 'Алексей Морозов', startMs: 95500, endMs: 115000, text: 'ФСТЭК — это серьёзно. У нас пока нет сертификации. Козлов говорил, что это три-четыре месяца работы.' },
      { speaker: 'Екатерина Соколова', startMs: 115500, endMs: 140000, text: 'Да, я это озвучила. Клиент готов подождать с сертификацией, если для пилота достаточно нашего текущего уровня безопасности. Но к полноценному контракту ФСТЭК обязателен.' },
      { speaker: 'Марина Волкова', startMs: 140500, endMs: 165000, text: 'Третья боль — цена. У них текущий контракт с Zoom заканчивается в августе. Zoom предложил скидку тридцать процентов, но клиент недоволен.' },
      { speaker: 'Алексей Морозов', startMs: 165500, endMs: 188000, text: 'Чем недоволен? Скидка тридцать процентов — это существенно.' },
      { speaker: 'Екатерина Соколова', startMs: 188500, endMs: 218000, text: 'Поддержка. У Zoom тикеты обрабатываются по три-четыре дня. А у Ростелекома бывают срочные проблемы — конференция на тысячу человек, и вдруг аудио пропадает. Им нужен выделенный менеджер и SLA на ответ.' },
      { speaker: 'Марина Волкова', startMs: 218500, endMs: 245000, text: 'Это наш козырь. Мы можем предложить выделенного customer success менеджера и SLA на ответ в течение часа. Zoom такого не даст.' },
      { speaker: 'Алексей Морозов', startMs: 245500, endMs: 270000, text: 'Согласен. Value-sell, а не ценовая война. Что ещё мы можем предложить чего нет у Zoom?' },
      { speaker: 'Екатерина Соколова', startMs: 270500, endMs: 300000, text: 'AI-отчёты. Николаевич прямо загорелся, когда я показала пример отчёта по стратегической сессии. Говорит, у них каждый день по двадцать встреч, и никто не помнит что обсуждали.' },
      { speaker: 'Марина Волкова', startMs: 300500, endMs: 325000, text: 'Да, и граф знаний. Он спросил: если сотрудник увольняется, его знания остаются? Я рассказала про Employee Clones — он сказал, это именно то что нужно.' },
      { speaker: 'Алексей Морозов', startMs: 325500, endMs: 350000, text: 'Отлично. Значит наш pitch: AI-отчёты, граф знаний, клоны сотрудников, выделенный менеджер. Четыре пункта, которых нет у Zoom.' },
      { speaker: 'Екатерина Соколова', startMs: 350500, endMs: 378000, text: 'Теперь по пилоту. Клиент готов начать в июне. Пятьсот пользователей — IT-отдел и два продуктовых подразделения.' },
      { speaker: 'Марина Волкова', startMs: 378500, endMs: 405000, text: 'Пятьсот — это хороший масштаб. Нам нужно подготовить LDAP-интеграцию к старту. Козлов сможет оценить?' },
      { speaker: 'Алексей Морозов', startMs: 405500, endMs: 430000, text: 'Я с ним поговорю. LDAP — это не самая сложная интеграция, но нужно учесть их специфику. У них несколько доменов и сложная структура OU.' },
      { speaker: 'Екатерина Соколова', startMs: 430500, endMs: 460000, text: 'Ещё момент: клиент попросил демо для руководства. Двадцать минут, фокус на AI-отчётах и безопасности. Можем подготовить к следующей неделе?' },
      { speaker: 'Марина Волкова', startMs: 460500, endMs: 488000, text: 'Да, я подготовлю обновлённую презентацию. Добавлю акцент на безопасность, хранение данных в РФ, LDAP-интеграцию. Это их ключевые боли.' },
      { speaker: 'Алексей Морозов', startMs: 488500, endMs: 515000, text: 'По ценообразованию. Мы не должны демпинговать. Наш тариф Enterprise — это премиум-продукт. AI-фичи + поддержка + кастомизация.' },
      { speaker: 'Екатерина Соколова', startMs: 515500, endMs: 545000, text: 'Согласна. Я предложила им Enterprise-тариф с пилотным периодом три месяца. Первые два месяца — бесплатно, третий — пятьдесят процентов. Потом полная цена.' },
      { speaker: 'Марина Волкова', startMs: 545500, endMs: 575000, text: 'Хорошая структура. Бесплатный пилот снижает барьер входа, а третий месяц с discount даёт время оценить ценность.' },
      { speaker: 'Алексей Морозов', startMs: 575500, endMs: 605000, text: 'Ростелеком — это потенциально два миллиона ARR, если развернут на всю компанию. Пилот критически важен. Нужно сделать всё идеально.' },
      { speaker: 'Екатерина Соколова', startMs: 605500, endMs: 635000, text: 'Я подготовлю договор пилота до конца недели. Нужны юридические согласования — пилотное соглашение, NDA, DPA.' },
      { speaker: 'Марина Волкова', startMs: 635500, endMs: 665000, text: 'Ещё: давайте подготовим кейс Сбербанк для следующей встречи. Ростелеком и Сбербанк — похожие организации, кейс усилит доверие.' },
      { speaker: 'Алексей Морозов', startMs: 665500, endMs: 695000, text: 'Да, кейс Сбербанк — хороший аргумент. Кузнецова уже работает над ним. Попросим ускорить.' },
      { speaker: 'Екатерина Соколова', startMs: 695500, endMs: 725000, text: 'Ещё: вебинар по K8s на следующей неделе. Если Козлов будет спикером — это отличный контент для IT-команды Ростелекома. Они как раз мигрируют.' },
      { speaker: 'Марина Волкова', startMs: 725500, endMs: 755000, text: 'Козлов уже согласился быть спикером. Кузнецова готовит слайды. Можем пригласить IT-команду Ростелекома как VIP-гостей.' },
      { speaker: 'Алексей Морозов', startMs: 755500, endMs: 785000, text: 'Отличная идея. Вебинар — это мягкий прогрев перед пилотом. Пусть увидят нашу экспертизу.' },
      { speaker: 'Екатерина Соколова', startMs: 785500, endMs: 815000, text: 'По конкурентам: кроме Zoom, клиент рассматривал TrueConf и Яндекс.Телемост. TrueConf отпал из-за UX, Телемост — нет enterprise-фич.' },
      { speaker: 'Марина Волкова', startMs: 815500, endMs: 845000, text: 'Значит реальные конкуренты — только Zoom. И мы выигрываем по поддержке и AI-фичам.' },
      { speaker: 'Алексей Морозов', startMs: 845500, endMs: 875000, text: 'Ещё вопрос: клиенты путаются в тарифах. На лендинге три тарифа, но непонятно чем Pro отличается от Enterprise.' },
      { speaker: 'Екатерина Соколова', startMs: 875500, endMs: 905000, text: 'Да, это поднималось на маркетинг-синке. Кузнецова делает страницу сравнения тарифов с таблицей и калькулятором ROI.' },
      { speaker: 'Марина Волкова', startMs: 905500, endMs: 970000, text: 'Для Ростелекома ROI-калькулятор особенно важен. Они должны видеть, сколько экономят на AI-отчётах и сокращении потерь знаний. Подводим итоги: пилот — да, пятьсот пользователей, старт июнь. LDAP — готовим к старту. Презентацию обновляем. Договор — до пятницы.' },
    ],
    chapters: [
      { title: 'Знакомство и контекст', startMs: 0, endMs: 360_000, summary: 'Общее впечатление от встречи, уровень заинтересованности клиента.' },
      { title: 'Боли клиента', startMs: 360_000, endMs: 1_440_000, summary: 'LDAP, безопасность, хранение данных в РФ, ценообразование.' },
      { title: 'Конкуренты', startMs: 1_440_000, endMs: 2_520_000, summary: 'Zoom-демпинг, TrueConf, Телемост, value-sell стратегия.' },
      { title: 'Пилот и следующие шаги', startMs: 2_520_000, endMs: 3_600_000, summary: 'Договорённость о пилоте, LDAP, демо, итоги.' },
    ],
    quality: { overall: 91, preparation: 88, structure: 90, clarity: 92, outcomes: 95, engagement: 90 },
    strengths: [
      'Отличная подготовка — все боли клиента выявлены',
      'Конкретные договорённости: пилот, LDAP, сроки',
      'Грамотная работа с конкурентным возражением Zoom',
      'Все три участника активно вовлечены',
    ],
    recommendations: [
      { text: 'Подготовить демо AI-отчётов для следующей встречи с клиентом', severity: 'info', category: 'preparation' },
      { text: 'Вовлечь IT-специалиста клиента в техническую часть обсуждения', severity: 'info', category: 'engagement' },
    ],
    behavior: { silencePercent: 8, dominanceIndex: 0.18, crossTalkMs: 55_000, diarizationConfidence: 0.95 },
    participantBehavior: [
      { speakingTimePercent: 35, turnsCount: 12, questionCount: 2, fillerWordsCount: 3, interruptionsMade: 0, interruptionsReceived: 0 },
      { speakingTimePercent: 33, turnsCount: 12, questionCount: 1, fillerWordsCount: 2, interruptionsMade: 0, interruptionsReceived: 0 },
      { speakingTimePercent: 32, turnsCount: 11, questionCount: 4, fillerWordsCount: 1, interruptionsMade: 0, interruptionsReceived: 0 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Ретро Sprint 13
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'retro13',
    seqNum: 5,
    title: 'Ретро Sprint 13',
    type: 'retrospective',
    daysAgoN: 10,
    durationMs: 2_400_000,
    roiScore: '1.850',
    participants: [
      { key: 'kozlov', isHost: true },
      { key: 'novikov', isHost: false },
      { key: 'sidorov', isHost: false },
      { key: 'popov', isHost: false },
      { key: 'petrova', isHost: false },
    ],
    summary:
      'Ретроспектива Sprint 13. Что прошло хорошо: CI/CD настроен, лендинг запущен, API-гейтвей рефакторнут. Что улучшить: code review занимает > 2 дней, нужно больше async-коммуникации, нет документации по Kubernetes.',
    structuredData: {
      decisions: [
        'Code review SLA: 24 часа',
        'Ввести async-статусы в Slack',
        'Начать документирование K8s',
      ],
      actionItems: [
        { assignee: 'Козлов', task: 'Настроить code review SLA в GitHub', deadline: '22.05' },
        { assignee: 'Новиков', task: 'Начать документацию K8s', deadline: '02.06' },
      ],
      risks: ['Code review bottleneck', 'Нет документации K8s'],
      keyTopics: ['Code review процесс', 'Async-коммуникация', 'Документация K8s', 'Запись встреч для onboarding'],
    },
    turns: [
      { speaker: 'Дмитрий Козлов', startMs: 0, endMs: 15000, text: 'Начинаем ретро Sprint 13. Формат стандартный: что прошло хорошо, что улучшить, action items. Давайте по кругу.' },
      { speaker: 'Игорь Новиков', startMs: 15500, endMs: 35000, text: 'Что хорошо: CI/CD наконец настроен. Деплой на staging за три минуты вместо двадцати. Это огромный прогресс, спасибо Козлову за пайплайн.' },
      { speaker: 'Анна Петрова', startMs: 35500, endMs: 55000, text: 'Лендинг запущен! И дизайн-система продвинулась до семидесяти процентов. Компоненты переиспользуются, новые страницы собираются за часы.' },
      { speaker: 'Павел Сидоров', startMs: 55500, endMs: 75000, text: 'API-гейтвей рефакторнут. Код стал читаемее, новые эндпоинты добавляются за час вместо дня. Middleware вынесены в отдельные модули.' },
      { speaker: 'Сергей Попов', startMs: 75500, endMs: 95000, text: 'Баг с дублированием сообщений починен. Клиенты перестали жаловаться. Это была проблема с Redis Pub/Sub — дублировались события.' },
      { speaker: 'Дмитрий Козлов', startMs: 95500, endMs: 118000, text: 'Хорошо, позитива много. Теперь — что улучшить. Главная боль: code review. У меня PR висел по три-четыре дня.' },
      { speaker: 'Игорь Новиков', startMs: 118500, endMs: 148000, text: 'Да! Мой PR по Docker-оптимизации висел три дня. Три дня! Я уже забыл контекст, пришлось заново разбираться что там было.' },
      { speaker: 'Павел Сидоров', startMs: 148500, endMs: 172000, text: 'У меня та же проблема. Жду ревью от Козлова, а он занят auth-модулем. И некому передать — больше никто не знает бэкенд достаточно глубоко.' },
      { speaker: 'Дмитрий Козлов', startMs: 172500, endMs: 202000, text: 'Признаю, это моя проблема. Я bottleneck. Предлагаю SLA: двадцать четыре часа на ревью. Если не успел — автосназначение на другого ревьюера.' },
      { speaker: 'Анна Петрова', startMs: 202500, endMs: 228000, text: 'А можно ещё async-статусы? Я забываю писать обновления, потому что нужно открывать Slack, искать тред, формулировать. Лучше бы бот спрашивал.' },
      { speaker: 'Сергей Попов', startMs: 228500, endMs: 255000, text: 'Согласен. Может, бот в Slack, который каждый вечер спрашивает: что сделал сегодня, какие блокеры, планы на завтра? Как daily, но асинхронно.' },
      { speaker: 'Игорь Новиков', startMs: 255500, endMs: 280000, text: 'О, это как daily check-in! Только автоматический. И результат сохраняется — можно потом посмотреть что делал неделю назад.' },
      { speaker: 'Дмитрий Козлов', startMs: 280500, endMs: 310000, text: 'Хорошая идея. Запишу в бэклог. Ещё: документация K8s. Мы мигрируем, а документации нет. Новый разработчик не разберётся.' },
      { speaker: 'Павел Сидоров', startMs: 310500, endMs: 338000, text: 'Да, я разбирался с Docker-контейнерами по комментариям в коде. Это не дело. Нужен README хотя бы для каждого сервиса.' },
      { speaker: 'Анна Петрова', startMs: 338500, endMs: 365000, text: 'Я бы предложила записывать все встречи. Для onboarding новичков было бы бесценно. Пришёл новый разработчик — посмотрел записи стендапов и в контексте.' },
      { speaker: 'Дмитрий Козлов', startMs: 365500, endMs: 395000, text: 'Согласен. AI-отчёты уже есть, но видео тоже полезно. Добавлю в roadmap. Ещё — нужен knowledge base по архитектуре.' },
      { speaker: 'Сергей Попов', startMs: 395500, endMs: 420000, text: 'Ещё: нет процесса тестирования новых фич. Я тестирую вручную по чек-листу, который сам же и веду. Нужен автоматизированный процесс.' },
      { speaker: 'Игорь Новиков', startMs: 420500, endMs: 450000, text: 'Нужен QA-процесс. Хотя бы для критических фич — auth, платежи, запись. Smoke-тесты перед каждым деплоем.' },
      { speaker: 'Дмитрий Козлов', startMs: 450500, endMs: 480000, text: 'Записал. Action items: первое — code review SLA двадцать четыре часа, настраиваю в GitHub Actions. Второе — документация K8s, Новиков начинает.' },
      { speaker: 'Павел Сидоров', startMs: 480500, endMs: 505000, text: 'А кто будет ревьюить, если Козлов занят? Нужна матрица ревьюеров по областям.' },
      { speaker: 'Дмитрий Козлов', startMs: 505500, endMs: 535000, text: 'Новиков может ревьюить Docker и инфраструктуру. Сидоров — фронтенд. Я — auth и бэкенд. Попов — тесты.' },
      { speaker: 'Анна Петрова', startMs: 535500, endMs: 560000, text: 'Дизайн-ревью тоже нужно. Я могу ревьюить UI-PR и компонентные библиотеки.' },
      { speaker: 'Сергей Попов', startMs: 560500, endMs: 585000, text: 'А тестовые PR? Кто ревьюит мои тесты? Там бывает специфичная логика.' },
      { speaker: 'Дмитрий Козлов', startMs: 585500, endMs: 615000, text: 'Я ревьюю тесты. Или подключим Новикова для интеграционных. Unit-тесты — автор сам проверяет.' },
      { speaker: 'Игорь Новиков', startMs: 615500, endMs: 640000, text: 'Ок, могу интеграционные. Давайте зафиксируем матрицу ревьюеров в README проекта.' },
      { speaker: 'Дмитрий Козлов', startMs: 640500, endMs: 680000, text: 'Фиксирую: code review SLA двадцать четыре часа, async-статусы через Slack-бота, документация K8s — Новиков, матрица ревьюеров в README. Все согласны?' },
      { speaker: 'Павел Сидоров', startMs: 680500, endMs: 695000, text: 'Да! Отличное ретро, конкретные решения.' },
      { speaker: 'Анна Петрова', startMs: 695500, endMs: 710000, text: 'Согласна, продуктивно. Особенно про async-статусы.' },
      { speaker: 'Сергей Попов', startMs: 710500, endMs: 725000, text: 'Плюсую. Конкретные action items с ответственными.' },
      { speaker: 'Дмитрий Козлов', startMs: 725500, endMs: 740000, text: 'Всем спасибо. Sprint 14 — фокус на безопасность и стабильность!' },
    ],
    chapters: [
      { title: 'Что прошло хорошо', startMs: 0, endMs: 480_000, summary: 'CI/CD, лендинг, API-гейтвей, багфикс дублирования сообщений.' },
      { title: 'Что улучшить', startMs: 480_000, endMs: 1_200_000, summary: 'Code review bottleneck, async-коммуникация, документация.' },
      { title: 'Action items', startMs: 1_200_000, endMs: 1_920_000, summary: 'SLA, матрица ревьюеров, Slack-бот, документация K8s.' },
      { title: 'Итоги', startMs: 1_920_000, endMs: 2_400_000, summary: 'Фиксация решений, подтверждение всеми участниками.' },
    ],
    quality: { overall: 75, preparation: 65, structure: 80, clarity: 78, outcomes: 72, engagement: 80 },
    strengths: [
      'Все участники активно делились опытом',
      'Конкретные решения по code review',
      'Хороший баланс позитива и критики',
    ],
    recommendations: [
      { text: 'Подготовить данные о velocity и burndown до ретро', severity: 'warning', category: 'preparation' },
      { text: 'Использовать таймер для каждого блока ретроспективы', severity: 'info', category: 'structure' },
      { text: 'Записывать action items прямо в трекер во время встречи', severity: 'warning', category: 'outcomes' },
    ],
    behavior: { silencePercent: 18, dominanceIndex: 0.28, crossTalkMs: 35_000, diarizationConfidence: 0.93 },
    participantBehavior: [
      { speakingTimePercent: 30, turnsCount: 10, questionCount: 1, fillerWordsCount: 4, interruptionsMade: 0, interruptionsReceived: 0 },
      { speakingTimePercent: 18, turnsCount: 5, questionCount: 0, fillerWordsCount: 3, interruptionsMade: 0, interruptionsReceived: 0 },
      { speakingTimePercent: 16, turnsCount: 5, questionCount: 1, fillerWordsCount: 2, interruptionsMade: 0, interruptionsReceived: 0 },
      { speakingTimePercent: 18, turnsCount: 5, questionCount: 1, fillerWordsCount: 2, interruptionsMade: 0, interruptionsReceived: 0 },
      { speakingTimePercent: 18, turnsCount: 5, questionCount: 0, fillerWordsCount: 1, interruptionsMade: 0, interruptionsReceived: 0 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Маркетинг-синк
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'marketing_sync',
    seqNum: 6,
    title: 'Маркетинг-синк',
    type: 'team',
    daysAgoN: 5,
    durationMs: 1_500_000,
    roiScore: '0.450',
    participants: [
      { key: 'kuznetsova', isHost: true },
      { key: 'sokolova', isHost: false },
      { key: 'morozov', isHost: false },
    ],
    summary:
      'Синк маркетинга. Контент-план Q2: 4 вебинара + 12 статей. Вебинар по K8s готов, спикер — Козлов. Таргетированная реклама запущена. Обсудили проблему: клиенты не понимают разницу тарифов.',
    structuredData: {
      decisions: [
        'Контент-план Q2 утверждён',
        'Нужна страница сравнения тарифов',
      ],
      actionItems: [
        { assignee: 'Кузнецова', task: 'Страница сравнения тарифов', deadline: '02.06' },
        { assignee: 'Соколова', task: 'Фидбек клиентов по тарифам', deadline: '28.05' },
      ],
      risks: ['Клиенты путаются в тарифах'],
      keyTopics: ['Контент-план Q2', 'Вебинар K8s', 'Тарифы', 'Таргетированная реклама'],
    },
    turns: [
      { speaker: 'Ольга Кузнецова', startMs: 0, endMs: 12000, text: 'Привет! Начинаем маркетинг-синк. Первый пункт — контент-план на второй квартал.' },
      { speaker: 'Екатерина Соколова', startMs: 12500, endMs: 28000, text: 'Давай. Я собрала фидбек от клиентов — им нужен контент по интеграциям с LDAP и Active Directory, по безопасности данных, и по AI-фичам.' },
      { speaker: 'Алексей Морозов', startMs: 28500, endMs: 45000, text: 'Согласен. Плюс нужно продвигать наши AI-фичи — это то, что реально отличает нас от Zoom и TrueConf.' },
      { speaker: 'Ольга Кузнецова', startMs: 45500, endMs: 72000, text: 'План такой: четыре вебинара и двенадцать статей за квартал. Первый вебинар — K8s миграция для видеоконференций, спикер Козлов. Статьи по темам: безопасность, интеграции, кейсы клиентов, продуктовые обновления.' },
      { speaker: 'Екатерина Соколова', startMs: 72500, endMs: 95000, text: 'Вебинар по K8s — отличная идея. Ростелеком интересовался этой темой на CustDev. Их IT-команда как раз мигрирует.' },
      { speaker: 'Алексей Морозов', startMs: 95500, endMs: 115000, text: 'Кузнецова, сколько стоит таргетированная реклама на квартал? Какой бюджет?' },
      { speaker: 'Ольга Кузнецова', startMs: 115500, endMs: 145000, text: 'Бюджет двести тысяч в месяц. Запустили на прошлой неделе — Яндекс.Директ и VK Реклама. CTR пока два процента, это выше среднего по отрасли для B2B SaaS.' },
      { speaker: 'Екатерина Соколова', startMs: 145500, endMs: 175000, text: 'А что с тарифами? Три клиента на этой неделе спрашивали: чем Pro отличается от Enterprise? Это серьёзная проблема для продаж.' },
      { speaker: 'Алексей Морозов', startMs: 175500, endMs: 200000, text: 'Это критично. Если клиент не понимает тариф — он не покупает. Или покупает не тот и потом жалуется.' },
      { speaker: 'Ольга Кузнецова', startMs: 200500, endMs: 230000, text: 'Сделаю страницу сравнения тарифов. С таблицей фич, FAQ по частым вопросам, калькулятором ROI. Дедлайн — второе июня.' },
      { speaker: 'Екатерина Соколова', startMs: 230500, endMs: 258000, text: 'Я соберу конкретные вопросы клиентов по тарифам до конца недели. Из звонков, чатов поддержки, и CRM.' },
      { speaker: 'Алексей Морозов', startMs: 258500, endMs: 285000, text: 'Ещё: кейс Сбербанк. Нужно подготовить для лендинга и вебинара. Это наш самый сильный социальный proof.' },
      { speaker: 'Ольга Кузнецова', startMs: 285500, endMs: 315000, text: 'Записала. Кейс Сбербанк — в июне. Сначала интервью с их командой, потом лонгрид и короткое видео.' },
      { speaker: 'Екатерина Соколова', startMs: 315500, endMs: 345000, text: 'A/B тесты тарифных страниц — тоже в плане? Хочу протестировать два варианта подачи.' },
      { speaker: 'Ольга Кузнецова', startMs: 345500, endMs: 375000, text: 'Да, после запуска страницы сравнения запущу A/B тест. Протестируем два варианта: таблица vs карточки.' },
      { speaker: 'Алексей Морозов', startMs: 375500, endMs: 405000, text: 'Хорошо. Ещё что-то на повестке?' },
      { speaker: 'Ольга Кузнецова', startMs: 405500, endMs: 435000, text: 'SEO-аудит готов. Основные рекомендации: оптимизировать мета-теги для ключевых страниц, добавить блог с регулярными публикациями, ускорить загрузку лендинга.' },
      { speaker: 'Екатерина Соколова', startMs: 435500, endMs: 465000, text: 'Email-рассылка работает хорошо. Open rate двадцать три процента — это выше среднего. Но нужно сегментировать аудиторию: CTO отдельно, менеджеры отдельно.' },
      { speaker: 'Алексей Морозов', startMs: 465500, endMs: 495000, text: 'Отлично. Фиксируем: контент-план Q2 утверждён, страница тарифов — приоритет, кейс Сбербанк — июнь, SEO — в работе.' },
      { speaker: 'Ольга Кузнецова', startMs: 495500, endMs: 520000, text: 'Записала. Всем спасибо, до следующего синка!' },
    ],
    chapters: [
      { title: 'Контент-план', startMs: 0, endMs: 480_000, summary: 'Вебинары, статьи, бюджет рекламы, K8s-вебинар.' },
      { title: 'Тарифы', startMs: 480_000, endMs: 960_000, summary: 'Проблема непонимания тарифов клиентами, план решения.' },
      { title: 'Реклама и итоги', startMs: 960_000, endMs: 1_500_000, summary: 'SEO, email, кейс Сбербанк, A/B тесты, итоги.' },
    ],
    quality: { overall: 70, preparation: 60, structure: 75, clarity: 72, outcomes: 70, engagement: 75 },
    strengths: [
      'Контент-план структурирован с конкретными темами',
      'Проблема тарифов поднята вовремя',
      'Конкретные дедлайны и ответственные',
    ],
    recommendations: [
      { text: 'Подготовить метрики до встречи — текущие конверсии, CAC, LTV', severity: 'warning', category: 'preparation' },
      { text: 'Добавить конкурентный анализ в повестку', severity: 'info', category: 'structure' },
      { text: 'Фиксировать KPI для каждой маркетинговой инициативы', severity: 'warning', category: 'outcomes' },
    ],
    behavior: { silencePercent: 20, dominanceIndex: 0.22, crossTalkMs: 15_000, diarizationConfidence: 0.96 },
    participantBehavior: [
      { speakingTimePercent: 32, turnsCount: 8, questionCount: 1, fillerWordsCount: 2, interruptionsMade: 0, interruptionsReceived: 0 },
      { speakingTimePercent: 35, turnsCount: 6, questionCount: 1, fillerWordsCount: 1, interruptionsMade: 0, interruptionsReceived: 0 },
      { speakingTimePercent: 33, turnsCount: 6, questionCount: 2, fillerWordsCount: 1, interruptionsMade: 0, interruptionsReceived: 0 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Обсуждение безопасности
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'security_discussion',
    seqNum: 7,
    title: 'Обсуждение безопасности',
    type: 'task_discussion',
    daysAgoN: 2,
    durationMs: 2_100_000,
    roiScore: '2.400',
    participants: [
      { key: 'kozlov', isHost: true },
      { key: 'novikov', isHost: false },
      { key: 'morozov', isHost: false },
    ],
    summary:
      'Обсуждение безопасности auth-модуля. Козлов представил результаты аудита: 4 уязвимости (нет rate limiting, JWT без expiration, нет CSRF-защиты, открыты debug-эндпоинты). Решение: миграция на OAuth2 + PKCE. Приоритет — hotfix критических уязвимостей.',
    structuredData: {
      decisions: [
        'Миграция на OAuth2 + PKCE',
        'Hotfix критических уязвимостей до пятницы',
        'Rate limiting на всех API',
        'Закрыть debug-эндпоинты немедленно',
      ],
      actionItems: [
        { assignee: 'Козлов', task: 'Hotfix уязвимостей auth', deadline: '30.05' },
        { assignee: 'Новиков', task: 'Dockerfile оптимизация для auth-service', deadline: '02.06' },
        { assignee: 'Козлов', task: 'Rate limiting implementation', deadline: '30.05' },
      ],
      risks: ['Уязвимости могут заблокировать релиз v2.0', 'Нет rate limiting на API'],
      keyTopics: ['Аудит безопасности auth', 'OAuth2 + PKCE', 'Rate limiting', 'Debug-эндпоинты'],
    },
    turns: [
      { speaker: 'Дмитрий Козлов', startMs: 0, endMs: 18000, text: 'Коллеги, сегодня критическая тема — безопасность auth-модуля. Я провёл аудит на прошлой неделе и нашёл четыре уязвимости. Две критические, две средние.' },
      { speaker: 'Алексей Морозов', startMs: 18500, endMs: 30000, text: 'Четыре уязвимости? Это много. Насколько критично? Могли ли ими воспользоваться?' },
      { speaker: 'Дмитрий Козлов', startMs: 30500, endMs: 68000, text: 'Две критические. Первая: нет rate limiting на login endpoint. Брутфорс-атака тривиальна — можно подобрать пароль за минуты. Вторая: JWT-токены без expiration. Перехватил токен — и пользуешься вечно, пока не отзовёшь вручную.' },
      { speaker: 'Игорь Новиков', startMs: 68500, endMs: 88000, text: 'Без expiration? Серьёзно? Как это вообще прошло code review? Кто писал этот код?' },
      { speaker: 'Дмитрий Козлов', startMs: 88500, endMs: 115000, text: 'Это legacy-код, написан полтора года назад до того как я пришёл в проект. Тогда не было ни rate limiting, ни CSRF, ни security headers. Я бы никогда так не сделал.' },
      { speaker: 'Алексей Морозов', startMs: 115500, endMs: 135000, text: 'Ок, понятно. А третья и четвёртая уязвимости?' },
      { speaker: 'Дмитрий Козлов', startMs: 135500, endMs: 175000, text: 'Третья: нет CSRF-защиты на формах. Злоумышленник может заставить пользователя выполнить действие без его ведома. Четвёртая: debug-эндпоинты открыты в продакшене. Через них можно получить дамп базы данных и конфигурацию.' },
      { speaker: 'Алексей Морозов', startMs: 175500, endMs: 195000, text: 'Debug-эндпоинты в продакшене?! Это нужно закрыть прямо сейчас. Немедленно.' },
      { speaker: 'Дмитрий Козлов', startMs: 195500, endMs: 225000, text: 'Согласен. Закрою сегодня — это одна строка в конфиге Nginx. Но это патч, не решение. Нужно системное решение — миграция на OAuth2 с PKCE flow.' },
      { speaker: 'Игорь Новиков', startMs: 225500, endMs: 255000, text: 'OAuth2 + PKCE — это правильно. Но это затрагивает три микросервиса: auth-gateway, user-service и session-manager. Нужно спланировать миграцию.' },
      { speaker: 'Дмитрий Козлов', startMs: 255500, endMs: 290000, text: 'Да, масштаб большой. Поэтому предлагаю два этапа. Первый — hotfix критических уязвимостей до пятницы. Закрыть debug, добавить rate limiting, добавить JWT expiration. Второй — полная миграция на OAuth2, на Sprint 15.' },
      { speaker: 'Алексей Морозов', startMs: 290500, endMs: 315000, text: 'Приоритет — hotfix. OAuth2 может подождать. Что конкретно нужно сделать до пятницы, по пунктам?' },
      { speaker: 'Дмитрий Козлов', startMs: 315500, endMs: 355000, text: 'Три вещи. Первое: закрыть debug-эндпоинты — сегодня, это быстро. Второе: добавить rate limiting на login и registration — скользящее окно на Redis, десять попыток в минуту. Третье: добавить JWT expiration — двадцать четыре часа для access token.' },
      { speaker: 'Игорь Новиков', startMs: 355500, endMs: 385000, text: 'Rate limiting — я могу помочь. Redis у нас уже есть, sliding window алгоритм я знаю. Могу сделать за день.' },
      { speaker: 'Дмитрий Козлов', startMs: 385500, endMs: 415000, text: 'Давай. Rate limiting на тебе — Redis middleware, конфиг на каждый эндпоинт. Я закрою debug и JWT expiration. Параллельно.' },
      { speaker: 'Алексей Морозов', startMs: 415500, endMs: 445000, text: 'А что с CSRF? Это тоже критично или может подождать?' },
      { speaker: 'Дмитрий Козлов', startMs: 445500, endMs: 478000, text: 'CSRF — medium severity. Добавим в hotfix, если успеем. Если нет — на следующий спринт. CSRF-токены — это стандартный middleware, несложно.' },
      { speaker: 'Игорь Новиков', startMs: 478500, endMs: 508000, text: 'Ещё вопрос: rate limiting на всех API или только на auth-эндпоинты? У нас есть публичные эндпоинты, которые тоже нужно защитить.' },
      { speaker: 'Дмитрий Козлов', startMs: 508500, endMs: 545000, text: 'Начнём с auth: login, registration, password reset. Потом расширим на все публичные эндпоинты. Для каждого — свой лимит. API-запросы — сто в минуту, загрузка файлов — десять в минуту.' },
      { speaker: 'Алексей Морозов', startMs: 545500, endMs: 575000, text: 'Правильно. Безопасность — главный приоритет Q2. Я готов выделить дополнительные ресурсы, если нужно.' },
      { speaker: 'Дмитрий Козлов', startMs: 575500, endMs: 610000, text: 'Ещё: нужно добавить security headers. Content-Security-Policy, X-Frame-Options, Strict-Transport-Security, X-Content-Type-Options. Это защита от XSS, clickjacking и downgrade-атак.' },
      { speaker: 'Игорь Новиков', startMs: 610500, endMs: 640000, text: 'Это я могу сделать параллельно с Docker-оптимизацией. Nginx-конфиг — десять строк. Добавлю в тот же PR.' },
      { speaker: 'Алексей Морозов', startMs: 640500, endMs: 670000, text: 'Отлично. Козлов, сколько нужно времени на полный OAuth2 + PKCE? Оцени для Sprint 15.' },
      { speaker: 'Дмитрий Козлов', startMs: 670500, endMs: 710000, text: 'Две-три недели для одного разработчика. Если с Новиковым — полторы. Нужно: спроектировать authorization server flow, реализовать PKCE verifier, миграция существующих сессий, обновление SDK на фронтенде.' },
      { speaker: 'Алексей Морозов', startMs: 710500, endMs: 740000, text: 'Ок, Sprint 15 для OAuth2. До пятницы — hotfix. Фиксирую в трекере как P0.' },
      { speaker: 'Игорь Новиков', startMs: 740500, endMs: 770000, text: 'Козлов, а что с сессиями? Сейчас сессии в Redis без TTL? Или есть автоматический expiry?' },
      { speaker: 'Дмитрий Козлов', startMs: 770500, endMs: 805000, text: 'Сессии в Redis с TTL восемь часов. Это нормально. Но refresh tokens нужно реализовать в OAuth2 — отдельный long-lived token для обновления access token без повторного логина.' },
      { speaker: 'Алексей Морозов', startMs: 805500, endMs: 835000, text: 'Ещё: нужно ли уведомлять клиентов об уязвимостях? У нас есть обязательства по SLA.' },
      { speaker: 'Дмитрий Козлов', startMs: 835500, endMs: 870000, text: 'Уязвимости не были эксплуатированы — я проверил логи за последние три месяца. Подозрительной активности нет. Но после hotfix стоит отправить security advisory клиентам. Прозрачность укрепляет доверие.' },
      { speaker: 'Алексей Морозов', startMs: 870500, endMs: 935000, text: 'Согласен, прозрачность — это хорошо. Итак, финальные итоги: debug закрыть сегодня, rate limiting и JWT expiration — до пятницы, security headers — параллельно, OAuth2 — Sprint 15. Козлов — главный по безопасности.' },
    ],
    chapters: [
      { title: 'Аудит безопасности', startMs: 0, endMs: 420_000, summary: 'Обзор 4 уязвимостей, оценка критичности, история legacy-кода.' },
      { title: 'Обзор уязвимостей', startMs: 420_000, endMs: 1_080_000, summary: 'Детали rate limiting, JWT, CSRF, debug-эндпоинты, приоритизация.' },
      { title: 'OAuth2 + PKCE', startMs: 1_080_000, endMs: 1_680_000, summary: 'План миграции, оценка сроков, архитектура refresh tokens.' },
      { title: 'План действий', startMs: 1_680_000, endMs: 2_100_000, summary: 'Hotfix до пятницы, OAuth2 Sprint 15, security advisory, распределение задач.' },
    ],
    quality: { overall: 88, preparation: 85, structure: 90, clarity: 92, outcomes: 88, engagement: 85 },
    strengths: [
      'Глубокий технический аудит с конкретными примерами уязвимостей',
      'Чёткое разделение hotfix vs долгосрочное решение',
      'Все три участника активно вовлечены и предлагают решения',
    ],
    recommendations: [
      { text: 'Проводить security-аудит ежеквартально, не дожидаясь инцидентов', severity: 'warning', category: 'preparation' },
      { text: 'Добавить security checklist в процесс code review', severity: 'info', category: 'structure' },
    ],
    behavior: { silencePercent: 11, dominanceIndex: 0.30, crossTalkMs: 30_000, diarizationConfidence: 0.95 },
    participantBehavior: [
      { speakingTimePercent: 48, turnsCount: 14, questionCount: 1, fillerWordsCount: 3, interruptionsMade: 0, interruptionsReceived: 0 },
      { speakingTimePercent: 20, turnsCount: 6, questionCount: 3, fillerWordsCount: 2, interruptionsMade: 0, interruptionsReceived: 0 },
      { speakingTimePercent: 32, turnsCount: 10, questionCount: 5, fillerWordsCount: 1, interruptionsMade: 0, interruptionsReceived: 0 },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/*  Seed function                                                             */
/* -------------------------------------------------------------------------- */

export const seedMeetings: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId, ownerUserId } = ctx;
  console.log('[demo/meetings] Начинаем создание 7 встреч ТехноСтрим...');

  for (const def of MEETINGS) {
    const meetingId = demoId('mtg', def.seqNum);
    ids.meetings[def.key] = meetingId;

    const startedAt = daysAgo(def.daysAgoN);
    const endedAt = new Date(startedAt.getTime() + def.durationMs);

    // ── Идемпотентность: пропуск если уже создана ──
    const existing = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (existing) {
      console.log(`  [skip] «${def.title}» — уже существует`);
      continue;
    }

    // ── 1. Meeting ────────────────────────────────────────────────────────
    await prisma.meeting.create({
      data: {
        id: meetingId,
        title: def.title,
        type: def.type,
        tenantId,
        ownerId: ownerUserId,
        roomName: `demo-room-${def.key}`,
        status: 'ai_ready',
        startedAt,
        endedAt,
        durationMs: def.durationMs,
        chaptersStatus: 'ready',
        tasksStatus: 'ready',
        embeddingsStatus: 'ready',
        behaviorMetricsStatus: 'ready',
        qualityScoreStatus: 'ready',
        roiScore: def.roiScore,
        roiScoreAt: daysAgo(def.daysAgoN - 1),
      },
    });
    console.log(`  [meeting] «${def.title}» (${def.type})`);

    // ── 2. Participants ───────────────────────────────────────────────────
    const participantIds: string[] = [];
    for (const p of def.participants) {
      const participant = await prisma.participant.create({
        data: {
          meetingId,
          livekitIdentity: `demo-${p.key}`,
          name: PERSON_NAMES[p.key] ?? p.key,
          role: p.isHost ? 'host' : 'guest',
          isRegisteredUser: true,
          joinedAt: startedAt,
          leftAt: endedAt,
        },
      });
      participantIds.push(participant.id);
    }
    console.log(`    + ${def.participants.length} участников`);

    // ── 3. AiResult ──────────────────────────────────────────────────────
    await prisma.aiResult.create({
      data: {
        meetingId,
        meetingType: def.type,
        summary: def.summary,
        modelUsed: 'demo-seed',
        structuredData: def.structuredData as Prisma.InputJsonValue,
      },
    });
    console.log('    + AiResult');

    // ── 4. Transcript ────────────────────────────────────────────────────
    const totalWords = def.turns.reduce((sum, t) => sum + t.text.split(/\s+/).length, 0);
    await prisma.transcript.create({
      data: {
        meetingId,
        turns: def.turns as unknown as Prisma.InputJsonValue,
        totalWords,
        totalDurationSeconds: Math.round(def.durationMs / 1000),
      },
    });
    console.log(`    + Transcript (${def.turns.length} реплик, ${totalWords} слов)`);

    // ── 5. Chapters ──────────────────────────────────────────────────────
    for (let i = 0; i < def.chapters.length; i++) {
      const ch = def.chapters[i]!;
      await prisma.meetingChapter.create({
        data: {
          meetingId,
          title: ch.title,
          startMs: ch.startMs,
          endMs: ch.endMs,
          order: i,
          tenantId,
          summary: ch.summary ?? null,
        },
      });
    }
    console.log(`    + ${def.chapters.length} глав`);

    // ── 6. MeetingQualityScore ───────────────────────────────────────────
    await prisma.meetingQualityScore.create({
      data: {
        meetingId,
        tenantId,
        overallScore: def.quality.overall,
        preparationScore: def.quality.preparation,
        structureScore: def.quality.structure,
        clarityScore: def.quality.clarity,
        outcomesScore: def.quality.outcomes,
        engagementScore: def.quality.engagement,
        recommendations: def.recommendations,
        strengths: def.strengths,
      },
    });
    console.log(`    + QualityScore (overall: ${def.quality.overall})`);

    // ── 7. MeetingBehaviorMetrics ────────────────────────────────────────
    const silenceMs = Math.round(def.durationMs * (def.behavior.silencePercent / 100));
    const totalSpeechMs = def.durationMs - silenceMs + def.behavior.crossTalkMs;

    const metrics = await prisma.meetingBehaviorMetrics.create({
      data: {
        meetingId,
        tenantId,
        totalDurationMs: def.durationMs,
        totalSpeechMs,
        silenceMs,
        silencePercent: def.behavior.silencePercent,
        crossTalkMs: def.behavior.crossTalkMs,
        dominanceIndex: def.behavior.dominanceIndex,
        diarizationConfidence: def.behavior.diarizationConfidence,
      },
    });
    console.log('    + BehaviorMetrics');

    // ── 8. MeetingParticipantBehavior ────────────────────────────────────
    for (let i = 0; i < def.participants.length; i++) {
      const p = def.participants[i]!;
      const pb = def.participantBehavior[i]!;
      const speakingTimeMs = Math.round(def.durationMs * (pb.speakingTimePercent / 100));
      const avgTurnDurationMs = Math.round(speakingTimeMs / Math.max(pb.turnsCount, 1));

      // Подсчёт монологов (turns >= 60 секунд)
      const speakerTurns = def.turns.filter((t) => t.speaker === (PERSON_NAMES[p.key] ?? p.key));
      const monologueCount = speakerTurns.filter((t) => (t.endMs - t.startMs) >= 60_000).length;
      const longestMonologueMs = speakerTurns.length > 0
        ? Math.max(...speakerTurns.map((t) => t.endMs - t.startMs))
        : 0;

      await prisma.meetingParticipantBehavior.create({
        data: {
          meetingBehaviorMetricsId: metrics.id,
          participantId: participantIds[i] ?? null,
          tenantId,
          displayName: PERSON_NAMES[p.key] ?? p.key,
          isGuest: false,
          speakingTimeMs,
          speakingTimePercent: Math.round(pb.speakingTimePercent * 10) / 10,
          turnsCount: pb.turnsCount,
          avgTurnDurationMs,
          monologueCount,
          longestMonologueMs,
          questionCount: pb.questionCount,
          fillerWordsCount: pb.fillerWordsCount,
          interruptionsMadeCount: pb.interruptionsMade,
          interruptionsReceivedCount: pb.interruptionsReceived,
        },
      });
    }
    console.log(`    + ${def.participants.length} ParticipantBehavior`);

    console.log(`  [ok] «${def.title}» — полностью создана`);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Дополнительные «лёгкие» встречи (без AI-отчётов и транскриптов).
  // Цель — заполнить 12 недель историей для Pulse-виджетов
  // (LowRoiMeetings + список встреч на /meetings).
  // ──────────────────────────────────────────────────────────────────────

  const LITE_MEETINGS: Array<{
    key: string;
    seqNum: number;
    title: string;
    type: MeetingDef['type'];
    daysAgoN: number;
    durationMin: number;
    participantKeys: string[];
    roiScore: string;
  }> = [
    { key: 'standup_w12', seqNum: 8,  title: 'Стендап неделя 12', type: 'standup', daysAgoN: 82, durationMin: 15, participantKeys: ['morozov', 'kozlov', 'volkova', 'petrova'], roiScore: '0.700' },
    { key: 'product_review_w11', seqNum: 9, title: 'Продуктовое ревью Q1 итоги', type: 'project', daysAgoN: 75, durationMin: 60, participantKeys: ['volkova', 'morozov', 'petrova'], roiScore: '1.450' },
    { key: 'sales_pipeline_w10', seqNum: 10, title: 'Sales pipeline review', type: 'team', daysAgoN: 68, durationMin: 45, participantKeys: ['sokolova', 'morozov', 'lebedev'], roiScore: '0.380' },
    { key: 'sprint12_planning', seqNum: 11, title: 'Планирование Sprint 12', type: 'plan_fact', daysAgoN: 61, durationMin: 60, participantKeys: ['kozlov', 'novikov', 'sidorov', 'popov'], roiScore: '1.250' },
    { key: 'custdev_sberbank', seqNum: 12, title: 'CustDev: Сбербанк', type: 'custdev', daysAgoN: 54, durationMin: 60, participantKeys: ['sokolova', 'volkova'], roiScore: '1.900' },
    { key: 'hr_sync', seqNum: 13, title: 'HR-синк по найму', type: 'team', daysAgoN: 47, durationMin: 40, participantKeys: ['mikhailova', 'morozov'], roiScore: '0.420' },
    { key: 'mobile_review_w7', seqNum: 14, title: 'Обзор мобайла — апдейт', type: 'project', daysAgoN: 40, durationMin: 60, participantKeys: ['petrova', 'sidorov', 'volkova'], roiScore: '1.350' },
    { key: 'design_critique', seqNum: 15, title: 'Дизайн-критика CallScreen v2', type: 'project', daysAgoN: 33, durationMin: 45, participantKeys: ['petrova', 'volkova', 'morozov'], roiScore: '1.100' },
    { key: 'retro12', seqNum: 16, title: 'Ретро Sprint 12', type: 'retrospective', daysAgoN: 26, durationMin: 45, participantKeys: ['kozlov', 'novikov', 'sidorov', 'petrova', 'popov'], roiScore: '1.650' },
    { key: 'all_hands_q2', seqNum: 17, title: 'All-hands старт Q2', type: 'team', daysAgoN: 19, durationMin: 60, participantKeys: ['morozov', 'volkova', 'kozlov', 'sokolova', 'mikhailova'], roiScore: '0.480' },
    { key: 'product_review_w2', seqNum: 18, title: 'Продуктовое ревью — пилоты', type: 'project', daysAgoN: 12, durationMin: 45, participantKeys: ['volkova', 'morozov', 'sokolova'], roiScore: '1.750' },
    { key: 'standup2', seqNum: 19, title: 'Утренний стендап', type: 'standup', daysAgoN: 4, durationMin: 15, participantKeys: ['morozov', 'kozlov', 'volkova', 'petrova'], roiScore: '0.920' },
    { key: 'partner_1c', seqNum: 20, title: 'Переговоры с 1С — интеграция', type: 'custdev', daysAgoN: 0, durationMin: 60, participantKeys: ['morozov', 'sokolova', 'volkova'], roiScore: '2.250' },
  ];

  for (const m of LITE_MEETINGS) {
    const meetingId = demoId('mtg', m.seqNum);
    ids.meetings[m.key] = meetingId;

    const startedAt = daysAgo(m.daysAgoN);
    const endedAt = new Date(startedAt.getTime() + m.durationMin * 60_000);

    const existing = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (existing) continue;

    await prisma.meeting.create({
      data: {
        id: meetingId,
        title: m.title,
        type: m.type,
        tenantId,
        ownerId: ownerUserId,
        roomName: `demo-room-${m.key}`,
        status: 'completed',
        startedAt,
        endedAt,
        durationMs: m.durationMin * 60_000,
        roiScore: m.roiScore,
        roiScoreAt: daysAgo(Math.max(0, m.daysAgoN - 1)),
      },
    });

    for (const key of m.participantKeys) {
      await prisma.participant.create({
        data: {
          meetingId,
          livekitIdentity: `demo-${key}-${m.seqNum}`,
          name: PERSON_NAMES[key] ?? key,
          role: key === m.participantKeys[0] ? 'host' : 'guest',
          isRegisteredUser: true,
          joinedAt: startedAt,
          leftAt: endedAt,
        },
      });
    }
  }

  console.log(
    `[demo/meetings] Готово: ${MEETINGS.length} полных + ${LITE_MEETINGS.length} лёгких ` +
      `= ${MEETINGS.length + LITE_MEETINGS.length} встреч.`,
  );
};
