import type { PrismaClient } from '@prisma/client';

import {
  assertNotProd,
  injectRawEventDirect,
  loadCounts,
  makeInfra,
  pollUntil,
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

function turns(rows: Array<[string, string]>, map: Map<string, string>, cust: Set<string>): Turn[] {
  return rows.map(([speaker, text], i) => ({
    speaker,
    text,
    startSec: i * 12,
    endSec: i * 12 + 12,
    authorPersonId: cust.has(speaker) ? null : (map.get(speaker) ?? null),
  }));
}

async function loadTenant(prisma: PrismaClient, orgId: string) {
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { ownerId: true } });
  const people = await prisma.person.findMany({
    where: { tenantId: orgId, relationship: 'employee' },
    select: { id: true, name: true },
  });
  const map = new Map(people.map((p) => [p.name, p.id]));
  return { ownerUserId: org.ownerId!, map };
}

async function injectMeeting(
  infra: HarnessInfra,
  orgId: string,
  ownerUserId: string,
  sourceId: string,
  args: { type: string; title: string; turns: Turn[]; occurredAt: Date },
): Promise<void> {
  const meetingId = pseudoUlid();
  const startedAt = new Date(args.occurredAt.getTime() - 40 * 60_000);
  await infra.prisma.meeting.create({
    data: {
      id: meetingId,
      roomName: meetingId,
      title: args.title,
      type: args.type as never,
      tenantId: orgId,
      ownerId: ownerUserId,
      startedAt,
      endedAt: args.occurredAt,
      durationMs: args.occurredAt.getTime() - startedAt.getTime(),
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
    tenantId: orgId,
    sourceId,
    sourceType: 'meeting',
    sourceExternalId: meetingId,
    occurredAt: args.occurredAt,
    payload: {
      meetingId,
      type: args.type,
      title: args.title,
      startedAt: startedAt.toISOString(),
      endedAt: args.occurredAt.toISOString(),
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
  const orgId = process.env['STRELA_ORG'];
  if (!orgId) throw new Error('STRELA_ORG не задан');
  const infra = makeInfra(cfg);
  const { prisma } = infra;
  const now = Date.now();
  const day = (d: number, h = 12) => new Date(now - d * DAY_MS + (h - 12) * 3_600_000);
  const cust = new Set(['Виктор', 'Наталья', 'Пётр', 'Ольга']);

  try {
    const { ownerUserId, map } = await loadTenant(prisma, orgId);
    log(`=== week-2 injector: Org=${orgId} employees=${[...map.keys()].join(', ')} ===`);

    const srcMeeting = await upsertSource(prisma, { tenantId: orgId, type: 'meeting', name: 'Встречи Стрела' });
    const srcBitrix = await upsertSource(prisma, { tenantId: orgId, type: 'bitrix', name: 'Bitrix24' });
    const srcChatbox = await upsertSource(prisma, { tenantId: orgId, type: 'chatbox', name: 'ChatBox' });
    const srcConv = await upsertSource(prisma, { tenantId: orgId, type: 'conversational', name: 'Каналы' });
    const srcCheckin = await upsertSource(prisma, { tenantId: orgId, type: 'daily_checkin', name: 'Ежедневные чек-ины' });

    // ── day −9 (пн прошлой недели): планёрка — старт Битрикс-интеграции, цель retention
    await injectMeeting(infra, orgId, ownerUserId, srcMeeting.id, {
      type: 'team',
      title: '[QA] Планёрка (прошлая неделя)',
      occurredAt: day(9),
      turns: turns([
        ['Сергей', 'Начинаем неделю. Главная цель квартала прежняя — поднять недельный retention пользователей до пятидесяти пяти процентов. Всё, что делаем, меряем этим.'],
        ['Сергей', 'Фиксирую решение: для медиа-движка встреч берём LiveKit, не пишем своё. Это обратимое решение, но пока так.'],
        ['Михаил', 'Тогда беру на себя задачу — поднять интеграцию с Битрикс, чтобы тянуть историю диалогов в граф. Начну с прототипа синка на этой неделе.'],
        ['Анна', 'Есть продуктовая идея: показывать пользователю еженедельный дайджест того, что Кора про него запомнила. Это про вовлечённость и retention.'],
        ['Дарья', 'По продажам: у нас на подходе два клиента — Логистик Плюс и Ромашка. С Ромашкой веду онбординг, с Логистик Плюс готовим пилот.'],
        ['Сергей', 'Хорошо. Дарья, задача — подготовить онбординг-план для Ромашки до четверга.'],
        ['Дарья', 'Беру онбординг Ромашки на себя, сделаю к четвергу.'],
      ], map, cust),
    });

    // ── day −8 (вт): стендап + переговоры Ромашка (custdev)
    await injectMeeting(infra, orgId, ownerUserId, srcMeeting.id, {
      type: 'standup',
      title: '[QA] Стендап (прошлая неделя)',
      occurredAt: day(8, 10),
      turns: turns([
        ['Михаил', 'Прототип синка Битрикс поднял, но упёрся в rate limit — их API отдаёт 429 на больших пачках. Это потенциальный блокер интеграции.'],
        ['Дарья', 'Готовлю онбординг-план Ромашки, иду по графику.'],
        ['Анна', 'Проектирую раздел «Моя история», собираю макеты.'],
      ], map, cust),
    });

    await injectMeeting(infra, orgId, ownerUserId, srcMeeting.id, {
      type: 'custdev',
      title: '[QA] Кастдев Ромашка',
      occurredAt: day(8, 15),
      turns: turns([
        ['Дарья', 'Ольга, добрый день. Хочу понять, как у вас сейчас теряются задачи после встреч, чтобы правильно настроить Кору.'],
        ['Ольга', 'Основная боль — после планёрок половина договорённостей забывается, никто не фиксирует. Нам критично, чтобы задачи сами попадали в трекер.'],
        ['Дарья', 'Поняла. Тогда предлагаю решение: на пилоте включаем автоизвлечение задач из ваших встреч и чатов. Если за месяц потери задач упадут — расширяемся.'],
        ['Ольга', 'Согласна попробовать. И ещё запрос: нам нужны отчёты по каждому типу встречи отдельно.'],
      ], map, cust),
    });

    // ── day −7 (ср): bitrix Логистик Плюс + chatbox Ромашка
    await injectRawEventDirect(infra, {
      tenantId: orgId,
      sourceId: srcBitrix.id,
      sourceType: 'bitrix',
      sourceExternalId: 'bitrix-d7-logistic',
      occurredAt: day(7, 12),
      dataClass: 'sensitive',
      payload: {
        kind: 'bitrix_dialog_session',
        transcript: {
          turns: turns([
            ['Пётр', 'Дарья, добрый день. Мы на совете решили: если пилот покажет результат, берём годовой контракт. Пришлите, пожалуйста, детали по срокам подключения.'],
            ['Дарья', 'Пётр, подключение занимает около недели после договора. Пришлю вам подробный план подключения завтра, обещаю.'],
          ], map, cust),
        },
      },
    });
    log('  bitrix Логистик Плюс (commitment «план подключения завтра»)');

    await injectRawEventDirect(infra, {
      tenantId: orgId,
      sourceId: srcChatbox.id,
      sourceType: 'chatbox',
      sourceExternalId: 'chatbox-d7-romashka',
      occurredAt: day(7, 16),
      dataClass: 'sensitive',
      payload: {
        kind: 'chatbox_chat_session',
        customer: 'Ромашка',
        transcript: {
          turns: turns([
            ['Ольга', 'Здравствуйте, подскажите, как подключить нашу Telegram-группу к Коре? Хотим, чтобы задачи из чата тоже собирались.'],
            ['Дарья', 'Ольга, это штатный сценарий. Заведу задачу настроить подключение вашей Telegram-группы, сделаем на первой неделе пилота.'],
          ], map, cust),
        },
      },
    });
    log('  chatbox Ромашка (запрос Telegram → задача)');

    // ── day −6 (чт): чат-день + чек-ины
    await injectRawEventDirect(infra, {
      tenantId: orgId,
      sourceId: srcConv.id,
      sourceType: 'conversational',
      sourceExternalId: 'chatday-d6',
      occurredAt: day(6, 18),
      payload: {
        transcript: {
          turns: turns([
            ['Михаил', 'Коллеги, по Битрикс: почитал доку, там рекомендуют exponential backoff при 429. Думаю, стоит заложить сразу.'],
            ['Сергей', 'Согласен, заложи. Это снизит риск блокера.'],
            ['Михаил', 'Беру backoff на себя, реализую на следующей неделе.'],
            ['Дарья', 'Онбординг-план для Ромашки готов, отправила Ольге. Задача с моей стороны выполнена.'],
            ['Сергей', 'Отлично. Анна, как макеты «Моей истории»?'],
            ['Анна', 'Макеты почти готовы, покажу на ретро в пятницу.'],
          ], map, cust),
        },
      },
    });
    log('  conversational chat-day (прошлая неделя)');

    const checkinDate = new Date(now - 6 * DAY_MS).toISOString().slice(0, 10);
    for (const [name, dones, notDone, ideas] of [
      ['Михаил', 'Поднял прототип синка Битрикс', 'Не успел решить проблему с 429', 'Заложить backoff в синк Битрикс'],
      ['Дарья', 'Отправила онбординг-план Ромашке', '', 'Сделать типовой чек-лист онбординга клиента'],
      ['Анна', 'Собрала макеты «Моей истории»', 'Не успела прогнать через дизайн-ревью', ''],
    ] as const) {
      const personId = map.get(name)!;
      const ci = await prisma.dailyCheckIn.create({
        data: {
          tenantId: orgId,
          personId,
          kind: 'evening',
          dateLocal: checkinDate,
          donesJson: dones ? [{ text: dones }] : undefined,
          notDoneJson: notDone ? [{ text: notDone }] : undefined,
          ideasJson: ideas ? [{ text: ideas }] : undefined,
          reportCompleteness: 'full',
          rawResponseText: [dones && `Сделано: ${dones}`, notDone && `Не успел: ${notDone}`, ideas && `Идея: ${ideas}`].filter(Boolean).join('. '),
          parseConfidence: '0.9',
          completedAt: day(6, 20),
          source: 'manual',
          externalSource: 'qa-test',
        },
      });
      await injectRawEventDirect(infra, {
        tenantId: orgId,
        sourceId: srcCheckin.id,
        sourceType: 'daily_checkin',
        sourceExternalId: ci.id,
        occurredAt: day(6, 20),
        dataClass: 'sensitive',
        payload: {
          kind: 'daily_checkin',
          checkInId: ci.id,
          checkInKind: 'evening',
          dateLocal: checkinDate,
          personId,
          personName: name,
          transcript: { turns: [{ speaker: name, text: ci.rawResponseText ?? '', startSec: 0, endSec: 1, authorPersonId: personId }] },
        },
      });
    }
    log('  daily_checkin × 3 (прошлая неделя)');

    // ── day −5 (пт): ревью проекта + ретро
    await injectMeeting(infra, orgId, ownerUserId, srcMeeting.id, {
      type: 'project',
      title: '[QA] Ревью проекта (прошлая неделя)',
      occurredAt: day(5, 11),
      turns: turns([
        ['Сергей', 'Прогресс по цели retention: раздел «Моя история» в макетах, Битрикс-синк в прототипе. Идём по плану.'],
        ['Михаил', 'Прототип Битрикс-синка работает на малых объёмах, задача прототипа выполнена. Дальше backoff и прод.'],
        ['Дарья', 'Онбординг Ромашки закрыт, клиент доволен планом.'],
      ], map, cust),
    });

    await injectMeeting(infra, orgId, ownerUserId, srcMeeting.id, {
      type: 'retrospective',
      title: '[QA] Ретроспектива (прошлая неделя)',
      occurredAt: day(5, 16),
      turns: turns([
        ['Сергей', 'Итоги недели: стартовали Битрикс и онбординг Ромашки. Решение на будущее: любой внешний синк начинаем с малых объёмов и мониторинга.'],
        ['Анна', 'Боль недели: дизайн-ревью узкое место, макеты ждут в очереди. Надо выделить слот под ревью.'],
        ['Михаил', 'Риск: если Битрикс не поднимет лимит, backoff не спасёт на объёме, понадобится webhook-модель.'],
      ], map, cust),
    });

    log('— Поллинг прироста…');
    const c = await pollUntil(prisma, orgId, (x) => x.canonicalBlock >= 40, cfg.verifyTimeoutMs, 4000);
    await sleep(Math.min(20_000, cfg.verifyTimeoutMs / 6));
    const fin = await loadCounts(prisma, orgId);
    log('\n=== ИТОГОВЫЕ СЧЁТЧИКИ (обе недели) ===');
    log(JSON.stringify(fin, null, 2));
    void c;
  } finally {
    await infra.close();
  }
}

void main();
