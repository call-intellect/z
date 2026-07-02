import { randomBytes } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import {
  assertNotProd,
  injectRawEventDirect,
  loadCounts,
  makeInfra,
  pollUntil,
  probeAge,
  pseudoUlid,
  readConfig,
  sleep,
  upsertSource,
  type HarnessInfra,
} from './_lib/combat-harness';

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

const DAY_MS = 86_400_000;

interface Turn {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
  authorPersonId?: string | null;
}

function parseProse(raw: string, speakerMap: Map<string, string>): Turn[] {
  const turns: Turn[] = [];
  let sec = 0;
  const skip = ['Транскрипт', 'Участники', 'Экспорт'];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (skip.some((p) => t.startsWith(p))) continue;
    const m = t.match(/^([A-Za-zА-Яа-яЁё]+):\s*(.+)$/);
    if (!m) {
      if (turns.length) turns[turns.length - 1]!.text += ' ' + t;
      continue;
    }
    const speaker = m[1]!;
    const author = speakerMap.has(speaker) ? speakerMap.get(speaker)! : null;
    turns.push({ speaker, text: m[2]!, startSec: sec, endSec: sec + 12, authorPersonId: author });
    sec += 12;
  }
  return turns;
}

function parseChat(raw: string, speakerMap: Map<string, string>): Turn[] {
  const turns: Turn[] = [];
  let sec = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^\d{1,2}:\d{2}\s+([A-Za-zА-Яа-яЁё]+):\s*(.+)$/);
    if (!m) continue;
    const speaker = m[1]!;
    const author = speakerMap.has(speaker) ? speakerMap.get(speaker)! : null;
    turns.push({ speaker, text: m[2]!, startSec: sec, endSec: sec + 8, authorPersonId: author });
    sec += 8;
  }
  return turns;
}

const T1 = `
Транскрипт встречи: еженедельная планёрка команды Кора.
Участники: Сергей, Анна, Михаил, Дарья, Игорь, Елена.
Сергей: Доброе утро всем. Давайте начнём, у нас плотная повестка. Сначала метрики, потом продукт, потом задачи на неделю и блокеры.
Сергей: Я хочу зафиксировать как решение команды: с сегодняшнего дня основной метрикой квартала мы считаем retention пользователей, удержание, а не выручку. Выручка важна, но она следствие. Это зафиксированное решение.
Сергей: И ставлю измеримую цель на квартал: поднять недельный retention с сорока двух до пятидесяти пяти процентов к концу сентября. Это наш ключевой измеримый результат квартала.
Игорь: Я согласен по сути, но мне сейчас по retention нечего показывать клиентам в переговорах. У нас есть хоть какая-то цифра удержания за последний месяц?
Дарья: Частично. По активным кабинетам недельный возврат где-то сорок два процента, но выборка маленькая, я бы не показывала эту цифру клиентам пока.
Анна: У меня есть продуктовое предложение. Предлагаю добавить в кабинет раздел «Моя история», где пользователь видит, что Кора запомнила о нём: его встречи, решения, задачи. Человек видит ценность памяти лично для себя, это повысит вовлечённость и retention.
Сергей: Мне нравится. Запишем как идею, обсудим приоритет отдельно.
Анна: И ещё мысль помельче. Можно по понедельникам присылать пользователю короткий дайджест: что за неделю Кора про него запомнила. Тоже про вовлечённость, это предложение.
Сергей: Обе мысли фиксируем. Теперь задачи. Анна, на тебе презентация нового онбординга, мы её обещали показать на демо. К какому сроку?
Анна: Давайте к следующей пятнице, к четвёртому июля. Мне нужно собрать сценарий и прогнать через дизайн.
Сергей: Ок, Анна готовит презентацию онбординга к четвёртому июля. Михаил, что с интеграцией Битрикс?
Михаил: Вот тут проблема, я обозначу её как блокер. Битрикс API отдаёт ошибку 429, rate limit, при массовом синке диалогов. Мы не можем завершить интеграционный тест, пока они не поднимут лимит. Это блокер, он держит весь сценарий импорта чатов.
Сергей: Михаил, тогда первая задача на тебе — напиши сегодня в техподдержку Битрикс официальный запрос на увеличение rate limit для нашего приложения.
Михаил: Сделаю, беру на себя. Напишу через форму партнёрской поддержки.
Дарья: У меня риск. Мы готовим email-кампанию по тёплой базе, но база контактов устарела, последнее обновление три месяца назад. Есть риск, что часть адресов мёртвые и мы испортим репутацию домена.
Сергей: Согласен, риск реальный. Дарья, задача — актуализируй базу контактов до среды, прочисти мёртвые адреса, обнови сегменты.
Дарья: Хорошо, возьму на себя актуализацию базы, сделаю до среды. И ещё мы запускаем саму email-кампанию на следующей неделе.
Игорь: Дарья, можешь заодно выгрузить мне сегмент по логистике? У меня переговоры идут.
Дарья: Да, выгружу логистику отдельно.
Елена: По поддержке спокойно. Пользователь с ID-2024 жалуется, что не отображается запись встречи, разбираюсь, похоже частный баг плеера, не системное. Отдельную задачу пока не завожу.
Сергей: Хорошо. Анна — презентация, Михаил — Битрикс запрос, Дарья — база. На этом всё, спасибо всем.
`;

const T2 = `
Транскрипт встречи: переговоры с клиентом, компания Логистик Плюс.
Участники: Александр, Игорь, Виктор, Наталья.
Александр: Добрый день, Виктор, Наталья. Спасибо, что нашли время. Предлагаю так: вы расскажете, что критично, мы честно ответим что есть, и наметим следующие шаги.
Виктор: Давайте сразу о деле. Мы компания на двести человек, но запускать на всех не будем. Мы готовы запустить пилот на три месяца на отделе логистики, пятнадцать человек. И мы внутри приняли решение: если за три месяца система покажет снижение потерянных задач на тридцать процентов, мы переходим на полный годовой контракт на всю компанию. Если не покажет — расходимся. Это зафиксировано на совете директоров.
Александр: Принято, это честная рамка. Зафиксируем: пилот три месяца, отдел логистики, критерий перехода минус тридцать процентов потерянных задач, дальше годовой контракт.
Наталья: У меня технические вопросы. Первое: наши встречи проходят в Zoom, не в вашем сервисе. Вы умеете подключаться к Zoom-встречам и забирать запись и расшифровку?
Александр: Честно отвечу: прямой интеграции с Zoom у нас сейчас нет. Это наш блокер для части клиентов. Сейчас либо встреча на нашем движке, либо запись загружается вручную файлом.
Наталья: Для нас это важно, ручная загрузка не вариант, люди забудут.
Александр: Понимаю. Я беру на себя обязательство лично выяснить, входит ли нативная интеграция с Zoom в дорожную карту на третий квартал, и дам конкретный ответ до пятницы. Это моё личное обязательство.
Наталья: Второй вопрос. Telegram. Большая часть общения у нас в Telegram. Вы умеете подтягивать переписку из Telegram-групп?
Александр: Да, это у нас есть. Telegram-интеграция работает, из переписки собираются задачи и решения. Настроим в первую неделю пилота.
Наталья: Третий вопрос, безопасность. Где физически хранятся записи и расшифровки? Мы работаем с перевозками, там коммерческая тайна.
Александр: Все данные хранятся только на российских серверах, это прописано в договоре отдельным пунктом.
Наталья: Хорошо, с безопасностью вопросов нет.
Наталья: Нам нужно от вас три вещи: договор на пилот, техническое описание интеграции для безопасников, и контакт технического специалиста.
Александр: Записал. Договор на пилот вышлю сегодня же до конца дня. Техническое описание интеграции подготовит маркетинг, попрошу Дарью собрать его до четверга. Контакт специалиста дам вместе с договором.
Виктор: Тогда резюмирую. Мы готовы на пилот. Ждём договор сегодня, техническое описание к четвергу, ответ по Zoom к пятнице.
Александр: Принято, спасибо. Свяжемся по почте.
`;

const T3 = `
Экспорт рабочего чата «Команда Кора», Telegram-группа.
10:21 Михаил: Доброе. Сел писать запрос в техподдержку Битрикс по rate limit, как договорились на планёрке.
10:23 Михаил: Отправил официальный запрос в техподдержку Битрикс на увеличение rate limit для нашего приложения. Жду ответа, обещали в течение суток.
10:24 Сергей: Отлично, спасибо. Держи в курсе как ответят.
10:31 Анна: Коллеги, читала их доку. Там написано: при ошибке 429 надо делать exponential backoff с джиттером. Предлагаю реализовать у нас exponential backoff на запросах к Битрикс, временно, пока ждём поднятия лимита.
10:33 Сергей: Звучит разумно. Это предложение или ты берёшь?
10:34 Анна: Это предложение, я фронтом занята. Пусть Михаил решит, брать ли.
10:36 Михаил: Согласен с идеей, беру реализацию exponential backoff для запросов к Битрикс API на себя. Сделаю сегодня к вечеру.
10:52 Дарья: Параллельно занимаюсь базой контактов. Нашла проблему: часть адресов невалидна. Сначала почищу мёртвые, потом обновлю сегменты. Справлюсь до среды как обещала.
11:40 Сергей: Дарья, напоминаю: база контактов для рассылки должна быть обновлена до среды, это критично для кампании.
11:42 Дарья: Да, держу, к среде будет.
12:15 Анна: Начала работу над материалами презентации онбординга для новых пользователей. Черновик покажу в четверг на ревью.
13:20 Игорь: Вернулся со встречи с Логистик Плюс, прошло хорошо. Берут пилот, если zoom добавим, дальше годовой контракт. Telegram им обязателен.
13:45 Михаил: Реализовал exponential backoff на запросах к Битрикс. Прогнал на стейдже, 429 больше не валит пачками. Выкатываю на прод вечером. Считай эта задача закрыта с моей стороны.
13:50 Михаил: Но есть риск. Если Битрикс вообще не поднимет лимиты, backoff не спасёт на больших объёмах. Тогда придётся переходить на webhook-модель вместо поллинга, а это минимум две недели разработки. Закладываю как риск.
15:10 Сергей: Михаил, и ещё задача. Настрой мониторинг ошибок Битрикс API, чтобы мы видели частоту 429 в реальном времени на дашборде.
15:12 Михаил: Принято, беру мониторинг ошибок Битрикс API на себя. Настрою до завтрашнего утра, повешу алерт.
16:30 Дарья: Апдейт по базе. Почистила мёртвые адреса, отлетело около восьми процентов, обновила сегменты, логистику Игорю отправила. База контактов готова и актуализирована, можно запускать рассылку. Задача с моей стороны выполнена.
16:31 Сергей: Прекрасно, Дарья, спасибо, это снимает риск по кампании.
18:10 Михаил: Backoff выкачен на прод, всё зелёное. Мониторинг доделаю с утра.
18:40 Сергей: Хороший день, всем спасибо. До завтра.
`;

interface SeedTenant {
  tag: string;
  orgId: string;
  ownerUserId: string;
  people: Map<string, string>;
}

async function bootstrap(prisma: PrismaClient): Promise<SeedTenant> {
  const tag = `strela-${randomBytes(3).toString('hex')}`;
  const owner = await prisma.user.create({
    data: {
      email: `sergey.${tag}@strela.test`,
      name: 'Сергей',
      role: 'user',
      signupSource: 'standalone',
    },
  });
  const org = await prisma.org.create({
    data: {
      name: `Компания Стрела [QA-test ${tag}]`,
      slug: `${tag}-strela`,
      ownerId: owner.id,
      visibilityMode: 'open',
      tier: 'basic',
    },
  });
  await prisma.membership.create({ data: { orgId: org.id, userId: owner.id, role: 'owner' } });

  const people = new Map<string, string>();
  const mkEmployee = async (name: string, userId?: string) => {
    const p = await prisma.person.create({
      data: {
        tenantId: org.id,
        userId: userId ?? null,
        name,
        email: `${name.toLowerCase()}.${tag}@strela.test`,
        relationship: 'employee',
        externalSource: 'qa-test',
      },
    });
    people.set(name, p.id);
  };
  await mkEmployee('Сергей', owner.id);
  for (const n of ['Анна', 'Михаил', 'Дарья', 'Игорь', 'Елена', 'Александр']) await mkEmployee(n);

  for (const [name, rel] of [
    ['Виктор', 'external'],
    ['Наталья', 'external'],
    ['Пётр', 'external'],
    ['Ольга', 'external'],
  ] as const) {
    await prisma.person.create({
      data: {
        tenantId: org.id,
        name,
        email: `${name.toLowerCase()}.${tag}@client.test`,
        relationship: rel,
        externalSource: 'qa-test',
      },
    });
  }

  return { tag, orgId: org.id, ownerUserId: owner.id, people };
}

async function injectMeeting(
  infra: HarnessInfra,
  t: SeedTenant,
  args: {
    sourceId: string;
    type: string;
    title: string;
    turns: Turn[];
    occurredAt: Date;
    externalId: string;
  },
): Promise<void> {
  const meetingId = pseudoUlid();
  const startedAt = new Date(args.occurredAt.getTime() - 40 * 60_000);
  const endedAt = args.occurredAt;
  await infra.prisma.meeting.create({
    data: {
      id: meetingId,
      roomName: meetingId,
      title: args.title,
      type: args.type as never,
      tenantId: t.orgId,
      ownerId: t.ownerUserId,
      startedAt,
      endedAt,
      durationMs: endedAt.getTime() - startedAt.getTime(),
      transcript: {
        create: {
          turns: args.turns as unknown as object,
          roomChat: [] as unknown as object,
          totalWords: args.turns.reduce((s, x) => s + x.text.split(' ').length, 0),
          totalDurationSeconds: args.turns.length * 12,
        },
      },
    },
  });
  await injectRawEventDirect(infra, {
    tenantId: t.orgId,
    sourceId: args.sourceId,
    sourceType: 'meeting',
    sourceExternalId: meetingId,
    occurredAt: endedAt,
    payload: {
      meetingId,
      type: args.type,
      title: args.title,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      participants: [],
      transcript: { turns: args.turns },
      roomChat: [],
    },
  });
  log(`  meeting[${args.type}] «${args.title}» → ${args.turns.length} turns`);
}

async function main(): Promise<void> {
  const cfg = readConfig();
  assertNotProd(cfg);
  const infra = makeInfra(cfg);
  const { prisma } = infra;
  const now = Date.now();
  const day = (d: number, h = 12) => new Date(now - d * DAY_MS + (h - 12) * 3_600_000);

  try {
    const t = await bootstrap(prisma);
    log(`=== seed-synthetic-company: Компания Стрела ===`);
    log(`✓ Org=${t.orgId} owner=${t.ownerUserId} tag=${t.tag}`);
    log(`  employees=${[...t.people.keys()].join(', ')}`);

    const srcMeeting = await upsertSource(prisma, { tenantId: t.orgId, type: 'meeting', name: 'Встречи Стрела' });
    const srcBitrix = await upsertSource(prisma, { tenantId: t.orgId, type: 'bitrix', name: 'Bitrix24' });
    const srcChatbox = await upsertSource(prisma, { tenantId: t.orgId, type: 'chatbox', name: 'ChatBox' });
    const srcConv = await upsertSource(prisma, { tenantId: t.orgId, type: 'conversational', name: 'Каналы' });
    const srcExternal = await upsertSource(prisma, { tenantId: t.orgId, type: 'external', name: 'Документы' });

    // ── day −4: планёрка команды (T1) + bitrix commitment
    await injectMeeting(infra, t, {
      sourceId: srcMeeting.id,
      type: 'team',
      title: '[QA] Планёрка недели',
      turns: parseProse(T1, t.people),
      occurredAt: day(4),
      externalId: 'meet-team-d4',
    });

    const bitrixTurns: Turn[] = [
      { speaker: 'Дарья', text: 'Пётр, добрый день. По пилоту — я подготовлю коммерческое предложение и пришлю вам КП в среду, обещаю точно к среде.', startSec: 0, endSec: 10, authorPersonId: t.people.get('Дарья') },
      { speaker: 'Пётр', text: 'Отлично, Дарья, ждём КП в среду. Если всё устроит по цене, запускаем пилот на отделе логистики.', startSec: 10, endSec: 20, authorPersonId: null },
      { speaker: 'Дарья', text: 'Договорились. Также приложу расчёт по пятнадцати сотрудникам и льготную цену пилота.', startSec: 20, endSec: 30, authorPersonId: t.people.get('Дарья') },
    ];
    await injectRawEventDirect(infra, {
      tenantId: t.orgId,
      sourceId: srcBitrix.id,
      sourceType: 'bitrix',
      sourceExternalId: 'bitrix-d4-logistic',
      occurredAt: day(4, 15),
      dataClass: 'sensitive',
      payload: { kind: 'bitrix_dialog_session', transcript: { turns: bitrixTurns } },
    });
    log('  bitrix commitment (Дарья→Логистик Плюс «КП в среду»)');

    // ── day −3: standup (blocker) + sales/custdev (T2) + chatbox (Ромашка)
    await injectMeeting(infra, t, {
      sourceId: srcMeeting.id,
      type: 'standup',
      title: '[QA] Стендап',
      turns: [
        { speaker: 'Михаил', text: 'Статус: пишу exponential backoff для Битрикс. Блокер прежний — Битрикс API отдаёт 429 при массовом синке, ждём поднятия лимита от их поддержки.', startSec: 0, endSec: 14, authorPersonId: t.people.get('Михаил') },
        { speaker: 'Анна', text: 'Готовлю презентацию онбординга, иду по плану, черновик к четвергу.', startSec: 14, endSec: 26, authorPersonId: t.people.get('Анна') },
        { speaker: 'Дарья', text: 'Чищу базу контактов, отправлю КП Логистик Плюс в среду.', startSec: 26, endSec: 38, authorPersonId: t.people.get('Дарья') },
      ],
      occurredAt: day(3, 10),
      externalId: 'meet-standup-d3',
    });

    await injectMeeting(infra, t, {
      sourceId: srcMeeting.id,
      type: 'sales',
      title: '[QA] Переговоры Логистик Плюс',
      turns: parseProse(T2, t.people),
      occurredAt: day(3, 14),
      externalId: 'meet-sales-d3',
    });

    const chatboxTurns: Turn[] = [
      { speaker: 'Ольга', text: 'Здравствуйте, это Ольга из компании Ромашка. У нас проблема: отчёт по встрече не сформировался, второй день пусто. Это критично, у нас завтра совет директоров.', startSec: 0, endSec: 12, authorPersonId: null },
      { speaker: 'Дарья', text: 'Ольга, добрый день, разберёмся. Заведу задачу на нашу команду поддержки, проверим ваш отчёт сегодня и вернёмся с результатом до конца дня.', startSec: 12, endSec: 24, authorPersonId: t.people.get('Дарья') },
      { speaker: 'Ольга', text: 'Спасибо, очень жду. И ещё пожелание: хорошо бы уведомление, когда отчёт готов.', startSec: 24, endSec: 36, authorPersonId: null },
    ];
    await injectRawEventDirect(infra, {
      tenantId: t.orgId,
      sourceId: srcChatbox.id,
      sourceType: 'chatbox',
      sourceExternalId: 'chatbox-d3-romashka',
      occurredAt: day(3, 16),
      dataClass: 'sensitive',
      payload: { kind: 'chatbox_chat_session', customer: 'Ромашка', transcript: { turns: chatboxTurns } },
    });
    log('  chatbox (Ромашка→Дарья, жалоба+задача)');

    // ── day −2: чат-день команды (T3)
    await injectRawEventDirect(infra, {
      tenantId: t.orgId,
      sourceId: srcConv.id,
      sourceType: 'conversational',
      sourceExternalId: 'chatday-d2',
      occurredAt: day(2, 18),
      payload: { transcript: { turns: parseChat(T3, t.people) } },
    });
    log('  conversational chat-day (T3, кросс-канал дедуп)');

    // ── day −1: project review (task completed signal) + checkins
    await injectMeeting(infra, t, {
      sourceId: srcMeeting.id,
      type: 'project',
      title: '[QA] Ревью проекта',
      turns: [
        { speaker: 'Сергей', text: 'Прогресс по цели retention: онбординг-презентация почти готова. Михаил, как с задачей по базе и монитоингом Битрикс?', startSec: 0, endSec: 14, authorPersonId: t.people.get('Сергей') },
        { speaker: 'Михаил', text: 'Мониторинг ошибок Битрикс API я настроил и выкатил, задача выполнена, алерт висит в канале. Backoff тоже на проде.', startSec: 14, endSec: 28, authorPersonId: t.people.get('Михаил') },
        { speaker: 'Дарья', text: 'Базу контактов актуализировала, отправила КП Логистик Плюс, всё готово.', startSec: 28, endSec: 40, authorPersonId: t.people.get('Дарья') },
      ],
      occurredAt: day(1, 11),
      externalId: 'meet-project-d1',
    });

    const checkinDate = new Date(now - 1 * DAY_MS).toISOString().slice(0, 10);
    for (const [name, plans, dones, blockers, notDone, ideas] of [
      ['Михаил', 'Настроить мониторинг Битрикс', 'Выкатил backoff и мониторинг на прод', '', '', 'Вынести таймауты Битрикс в конфиг'],
      ['Дарья', 'Дочистить базу и отправить КП', 'База актуализирована, КП отправлено', '', 'Не успела согласовать сегменты с Игорем', ''],
      ['Анна', 'Собрать сценарий онбординга', 'Черновик презентации готов', 'Жду ревью дизайна', '', 'Добавить раздел «Моя история» в кабинет'],
    ] as const) {
      const personId = t.people.get(name)!;
      const ci = await prisma.dailyCheckIn.create({
        data: {
          tenantId: t.orgId,
          personId,
          kind: 'evening',
          dateLocal: checkinDate,
          plansJson: plans ? [{ text: plans }] : undefined,
          donesJson: dones ? [{ text: dones }] : undefined,
          blockersJson: blockers ? [{ text: blockers, severity: 'medium' }] : undefined,
          notDoneJson: notDone ? [{ text: notDone }] : undefined,
          ideasJson: ideas ? [{ text: ideas }] : undefined,
          reportCompleteness: 'full',
          rawResponseText: [plans && `План: ${plans}`, dones && `Сделано: ${dones}`, blockers && `Блокер: ${blockers}`, notDone && `Не успел: ${notDone}`, ideas && `Идея: ${ideas}`].filter(Boolean).join('. '),
          parseConfidence: '0.9',
          completedAt: day(1, 20),
          source: 'manual',
          externalSource: 'qa-test',
        },
      });
      await injectRawEventDirect(infra, {
        tenantId: t.orgId,
        sourceId: (await upsertSource(prisma, { tenantId: t.orgId, type: 'daily_checkin', name: 'Ежедневные чек-ины' })).id,
        sourceType: 'daily_checkin',
        sourceExternalId: ci.id,
        occurredAt: day(1, 20),
        dataClass: 'sensitive',
        payload: {
          kind: 'daily_checkin',
          checkInId: ci.id,
          checkInKind: 'evening',
          dateLocal: checkinDate,
          personId,
          personName: name,
          transcript: { turns: [{ speaker: name, text: (ci.rawResponseText ?? ''), startSec: 0, endSec: 1, authorPersonId: personId }] },
        },
      });
    }
    log('  daily_checkin × 3 (notDone/ideas)');

    // ── day 0: retrospective (decision + insight) + документ-регламент
    await injectMeeting(infra, t, {
      sourceId: srcMeeting.id,
      type: 'retrospective',
      title: '[QA] Ретроспектива недели',
      turns: [
        { speaker: 'Сергей', text: 'Итоги недели. Что улучшить? Предлагаю зафиксировать решение: перед массовым синком любого внешнего API сначала включаем backoff и мониторинг, только потом объём. Это наше правило теперь.', startSec: 0, endSec: 16, authorPersonId: t.people.get('Сергей') },
        { speaker: 'Анна', text: 'Согласна. И боль недели: мы слишком поздно узнали про 429, узнавали постфактум. Это про наблюдаемость, надо усилить.', startSec: 16, endSec: 30, authorPersonId: t.people.get('Анна') },
        { speaker: 'Михаил', text: 'Риск на будущее: если клиентов станет много, поллинг Битрикса не потянет, нужна webhook-модель заранее.', startSec: 30, endSec: 44, authorPersonId: t.people.get('Михаил') },
      ],
      occurredAt: day(0, 16),
      externalId: 'meet-retro-d0',
    });

    await injectRawEventDirect(infra, {
      tenantId: t.orgId,
      sourceId: srcExternal.id,
      sourceType: 'external',
      sourceExternalId: 'doc-reglament-d0',
      occurredAt: day(0, 17),
      payload: {
        fullText:
          'Регламент обработки клиентских обращений в поддержке. Владелец регламента — руководитель поддержки Елена. ' +
          'Область применения: роль «специалист поддержки». Шаг 1: при поступлении обращения через ChatBox специалист регистрирует задачу в трекере в течение 15 минут. ' +
          'Шаг 2: критичные обращения (блокирует работу клиента) эскалируются владельцу в тот же день. ' +
          'Шаг 3: после решения обращения специалист отправляет клиенту уведомление о готовности. ' +
          'Ответственность за соблюдения регламента несёт Елена.',
      },
    });
    log('  external документ-регламент (scope роль+owner)');

    log('— Поллинг до canonical/специалистов…');
    const timeout = cfg.verifyTimeoutMs;
    const c = await pollUntil(
      prisma,
      t.orgId,
      (x) => x.canonicalBlock >= 20 && x.decision + x.idea + x.insight >= 5 && x.intakeIssue >= 3,
      timeout,
      3000,
    );
    await sleep(Math.min(20_000, timeout / 6));
    const fin = await loadCounts(prisma, t.orgId);
    const age = await probeAge(prisma, t.orgId);
    log('\n=== ИТОГОВЫЕ СЧЁТЧИКИ ===');
    log(JSON.stringify(fin, null, 2));
    log(`AGE: available=${age.available} nodes=${age.nodeCount ?? '—'}`);
    log(`\n✓ ORG_ID=${t.orgId}`);
    void c;
  } finally {
    await infra.close();
  }
}

void main();
