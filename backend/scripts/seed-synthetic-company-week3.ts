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
    log(`=== week-3 injector (дни −16…−12): Org=${orgId} employees=${[...map.keys()].join(', ')} ===`);
    const before = await loadCounts(prisma, orgId);

    const srcMeeting = await upsertSource(prisma, { tenantId: orgId, type: 'meeting', name: 'Встречи Стрела' });
    const srcBitrix = await upsertSource(prisma, { tenantId: orgId, type: 'bitrix', name: 'Bitrix24' });
    const srcChatbox = await upsertSource(prisma, { tenantId: orgId, type: 'chatbox', name: 'ChatBox' });
    const srcConv = await upsertSource(prisma, { tenantId: orgId, type: 'conversational', name: 'Каналы' });
    const srcCheckin = await upsertSource(prisma, { tenantId: orgId, type: 'daily_checkin', name: 'Ежедневные чек-ины' });

    await injectMeeting(infra, orgId, ownerUserId, srcMeeting.id, {
      type: 'team',
      title: '[QA] Планёрка (три недели назад)',
      occurredAt: day(16),
      turns: turns([
        ['Сергей', 'Открываем неделю. Цель квартала неизменна — поднять недельный retention с сорока двух до пятидесяти пяти процентов к концу сентября. Всё меряем этим.'],
        ['Сергей', 'Фиксирую решение команды: в этом квартале приоритет отдаём интеграции с Битрикс, а нативный Zoom откладываем. Решение обратимое, вернёмся к нему после пилота.'],
        ['Михаил', 'Тогда беру на себя разведку по Битрикс: изучить их API и лимиты. Сделаю обзор к пятнице.'],
        ['Игорь', 'Сергей, у меня встречное. Дарья отдаёт приоритет маркетинговой базе, а мне для переговоров с Логистик Плюс срочно нужен сегмент по логистике. Мы тянем одеяло в разные стороны, надо расставить приоритеты.'],
        ['Дарья', 'Игорь, база под кампанию тоже критична, у нас дедлайн. Давай не сваливать всё на меня в один день.'],
        ['Сергей', 'Понял, есть трение по приоритетам. Дарья — сначала выгрузи Игорю сегмент логистики, база под кампанию идёт следом. Зафиксировали.'],
        ['Анна', 'И продуктовая идея на подумать: показывать пользователю еженедельный дайджест того, что Кора про него запомнила. Это прямо про вовлечённость и retention.'],
      ], map, cust),
    });

    await injectMeeting(infra, orgId, ownerUserId, srcMeeting.id, {
      type: 'standup',
      title: '[QA] Стендап (три недели назад)',
      occurredAt: day(15, 10),
      turns: turns([
        ['Михаил', 'Начал разведку Битрикс. Первое впечатление: их API отдаёт 429 при больших пачках, лимиты жёсткие. Это потенциальный блокер интеграции, помечаю как риск.'],
        ['Дарья', 'Выгрузила Игорю сегмент логистики, конфликт с утра снят. Дальше берусь за базу под кампанию.'],
        ['Игорь', 'Спасибо, сегмент получил, иду готовиться к переговорам с Логистик Плюс.'],
      ], map, cust),
    });

    await injectMeeting(infra, orgId, ownerUserId, srcMeeting.id, {
      type: 'custdev',
      title: '[QA] Первый кастдев Логистик Плюс',
      occurredAt: day(15, 15),
      turns: turns([
        ['Александр', 'Виктор, Наталья, добрый день. Хотим понять вашу ситуацию, прежде чем что-то предлагать. Что для вас критично?'],
        ['Виктор', 'Мы компания на двести человек, но пилот хотим на отделе логистики, пятнадцать человек, три месяца. Если потери задач упадут на тридцать процентов — переходим на годовой контракт на всю компанию. Это решение совета директоров.'],
        ['Наталья', 'Технический вопрос сразу: наши встречи в Zoom. Вы умеете забирать запись и расшифровку из Zoom?'],
        ['Александр', 'Честно — прямой интеграции с Zoom у нас пока нет, это наш блокер. Беру на себя выяснить, входит ли Zoom в дорожную карту на третий квартал, отвечу до пятницы.'],
        ['Наталья', 'И второе — Telegram. Большая часть общения там. Подтягиваете переписку из Telegram-групп?'],
        ['Александр', 'Да, Telegram-интеграция работает, из переписки собираются задачи и решения. Настроим в первую неделю пилота.'],
      ], map, cust),
    });

    await injectRawEventDirect(infra, {
      tenantId: orgId,
      sourceId: srcBitrix.id,
      sourceType: 'bitrix',
      sourceExternalId: 'bitrix-d14-logistic',
      occurredAt: day(14, 12),
      dataClass: 'sensitive',
      payload: {
        kind: 'bitrix_dialog_session',
        transcript: {
          turns: turns([
            ['Пётр', 'Дарья, добрый день. По итогам кастдева мы настроены серьёзно. Пришлите, пожалуйста, коммерческое предложение по пилоту.'],
            ['Дарья', 'Пётр, поняла. Подготовлю и пришлю коммерческое предложение по пилоту завтра, обещаю.'],
          ], map, cust),
        },
      },
    });
    log('  bitrix Логистик Плюс (commitment «КП завтра»)');

    await injectRawEventDirect(infra, {
      tenantId: orgId,
      sourceId: srcChatbox.id,
      sourceType: 'chatbox',
      sourceExternalId: 'chatbox-d14-romashka',
      occurredAt: day(14, 16),
      dataClass: 'sensitive',
      payload: {
        kind: 'chatbox_chat_session',
        customer: 'Ромашка',
        transcript: {
          turns: turns([
            ['Ольга', 'Здравствуйте. Мы Ромашка, небольшая команда. Хотим попробовать Кору. С чего начать?'],
            ['Дарья', 'Ольга, добрый день. Заведу задачу подготовить для вас онбординг-план, вернусь с ним в течение недели.'],
          ], map, cust),
        },
      },
    });
    log('  chatbox Ромашка (первый контакт → задача)');

    await injectRawEventDirect(infra, {
      tenantId: orgId,
      sourceId: srcConv.id,
      sourceType: 'conversational',
      sourceExternalId: 'chatday-d13',
      occurredAt: day(13, 18),
      payload: {
        transcript: {
          turns: turns([
            ['Михаил', 'Коллеги, по Битрикс: чтобы понимать масштаб 429, нужен мониторинг частоты ошибок API. Беру на себя настроить мониторинг ошибок Битрикс API, сделаю на следующей неделе.'],
            ['Сергей', 'Согласен, без мониторинга мы слепые. Заводи.'],
            ['Анна', 'Я по «Моей истории»: начала собирать первые макеты, покажу на ретро.'],
            ['Игорь', 'Переговоры с Логистик Плюс прошли хорошо, ждут КП. Если добавим Zoom — берут пилот, дальше годовой контракт.'],
          ], map, cust),
        },
      },
    });
    log('  conversational chat-day (три недели назад)');

    const checkinDate = new Date(now - 13 * DAY_MS).toISOString().slice(0, 10);
    for (const [name, dones, notDone, ideas] of [
      ['Михаил', 'Сделал обзор API Битрикс', 'Не успел настроить мониторинг ошибок Битрикс API', 'Заложить exponential backoff в синк Битрикс'],
      ['Дарья', 'Выгрузила сегмент логистики Игорю', 'Не начала базу под кампанию', 'Сделать типовой чек-лист онбординга клиента'],
      ['Анна', 'Собрала первые макеты «Моей истории»', '', ''],
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
          completedAt: day(13, 20),
          source: 'manual',
          externalSource: 'qa-test',
        },
      });
      await injectRawEventDirect(infra, {
        tenantId: orgId,
        sourceId: srcCheckin.id,
        sourceType: 'daily_checkin',
        sourceExternalId: ci.id,
        occurredAt: day(13, 20),
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
    log('  daily_checkin × 3 (три недели назад)');

    await injectMeeting(infra, orgId, ownerUserId, srcMeeting.id, {
      type: 'project',
      title: '[QA] Ревью проекта (три недели назад)',
      occurredAt: day(12, 11),
      turns: turns([
        ['Сергей', 'Прогресс по retention: раздел «Моя история» в первых макетах, разведка Битрикс закрыта. Идём по плану.'],
        ['Михаил', 'Обзор Битрикс готов. Вывод: нужен backoff и, возможно, webhook-модель, если лимит не поднимут.'],
        ['Дарья', 'КП для Логистик Плюс отправлено, клиент доволен.'],
      ], map, cust),
    });

    await injectMeeting(infra, orgId, ownerUserId, srcMeeting.id, {
      type: 'retrospective',
      title: '[QA] Ретроспектива (три недели назад)',
      occurredAt: day(12, 16),
      turns: turns([
        ['Сергей', 'Итоги недели: стартовали Битрикс-разведку и продажи Логистик Плюс. Решение на будущее: любой внешний синк начинаем с малых объёмов и мониторинга.'],
        ['Игорь', 'Риск по продажам: если Zoom не появится в третьем квартале, часть клиентов вроде Логистик Плюс мы потеряем.'],
        ['Анна', 'Боль недели: дизайн-ревью узкое место, макеты ждут очереди. Нужен выделенный слот под ревью.'],
      ], map, cust),
    });

    log('— Поллинг прироста…');
    const target = before.canonicalBlock + 18;
    const c = await pollUntil(prisma, orgId, (x) => x.canonicalBlock >= target, cfg.verifyTimeoutMs, 4000);
    await sleep(Math.min(20_000, cfg.verifyTimeoutMs / 6));
    const fin = await loadCounts(prisma, orgId);
    log('\n=== ИТОГОВЫЕ СЧЁТЧИКИ (после недели 3) ===');
    log(JSON.stringify(fin, null, 2));
    void c;
  } finally {
    await infra.close();
  }
}

void main();
