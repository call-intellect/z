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
    log(`=== week-4 injector (дни −23…−19, старт квартала): Org=${orgId} employees=${[...map.keys()].join(', ')} ===`);
    const before = await loadCounts(prisma, orgId);

    const srcMeeting = await upsertSource(prisma, { tenantId: orgId, type: 'meeting', name: 'Встречи Стрела' });
    const srcBitrix = await upsertSource(prisma, { tenantId: orgId, type: 'bitrix', name: 'Bitrix24' });
    const srcChatbox = await upsertSource(prisma, { tenantId: orgId, type: 'chatbox', name: 'ChatBox' });
    const srcConv = await upsertSource(prisma, { tenantId: orgId, type: 'conversational', name: 'Каналы' });
    const srcCheckin = await upsertSource(prisma, { tenantId: orgId, type: 'daily_checkin', name: 'Ежедневные чек-ины' });

    await injectMeeting(infra, orgId, ownerUserId, srcMeeting.id, {
      type: 'team',
      title: '[QA] Планёрка (старт квартала)',
      occurredAt: day(23),
      turns: turns([
        ['Сергей', 'Открываем квартал. Хочу зафиксировать главный спор: что делаем ключевой метрикой — выручку или retention пользователей.'],
        ['Игорь', 'Я за выручку. Мне на переговорах проще показывать деньги, а не проценты удержания.'],
        ['Анна', 'А я за retention. Если люди не остаются, выручка всё равно осыпется. Удержание — причина, выручка — следствие.'],
        ['Сергей', 'Согласен с Анной. Фиксирую как решение команды: ключевая метрика квартала — недельный retention, цель поднять с сорока двух до пятидесяти пяти процентов к концу сентября. Решение обратимое, но пока так.'],
        ['Михаил', 'Тогда продуктовая идея от меня: интегрировать Битрикс, чтобы тянуть историю рабочих чатов в граф. Больше данных — точнее память, выше вовлечённость.'],
        ['Сергей', 'Идею фиксируем. Дарья, задача — актуализируй базу контактов до среды, она понадобится под первые продажи.'],
        ['Дарья', 'Беру актуализацию базы на себя, сделаю до среды.'],
      ], map, cust),
    });

    await injectMeeting(infra, orgId, ownerUserId, srcMeeting.id, {
      type: 'standup',
      title: '[QA] Стендап (старт квартала)',
      occurredAt: day(22, 10),
      turns: turns([
        ['Дарья', 'Актуализирую базу контактов, иду по графику, к среде закончу.'],
        ['Анна', 'Начала концепт раздела «Моя история», собираю референсы.'],
        ['Михаил', 'Смотрю, как вообще подключаться к Битрикс. Пока на уровне изучения документации.'],
      ], map, cust),
    });

    await injectMeeting(infra, orgId, ownerUserId, srcMeeting.id, {
      type: 'project',
      title: '[QA] Стратегия продукта (старт квартала)',
      occurredAt: day(22, 15),
      turns: turns([
        ['Сергей', 'Обсудим медиа-движок для встреч. Пишем свой или берём готовый?'],
        ['Михаил', 'Свой SFU — это месяцы. Предлагаю решение: берём LiveKit как медиа-движок, всю бизнес-логику держим у себя. Решение обратимое.'],
        ['Сергей', 'Принято, фиксирую: медиа-движок — LiveKit, своё не пишем. Михаил, беру на тебя черновик архитектуры интеграции к пятнице?'],
        ['Михаил', 'Беру на себя, черновик архитектуры LiveKit к пятнице будет.'],
      ], map, cust),
    });

    await injectRawEventDirect(infra, {
      tenantId: orgId,
      sourceId: srcBitrix.id,
      sourceType: 'bitrix',
      sourceExternalId: 'bitrix-d21-logistic',
      occurredAt: day(21, 12),
      dataClass: 'sensitive',
      payload: {
        kind: 'bitrix_dialog_session',
        transcript: {
          turns: turns([
            ['Виктор', 'Добрый день. Мы Логистик Плюс, слышали про вас. Расскажите коротко, чем можете быть полезны отделу логистики.'],
            ['Игорь', 'Виктор, добрый день. Мы собираем задачи и решения из встреч и чатов автоматически, чтобы после планёрок ничего не терялось. Предлагаю созвониться на кастдев на следующей неделе.'],
            ['Виктор', 'Хорошо, давайте. Интересно, но у нас всё в Zoom и Telegram, учтите это.'],
          ], map, cust),
        },
      },
    });
    log('  bitrix Логистик Плюс (первый контакт)');

    await injectRawEventDirect(infra, {
      tenantId: orgId,
      sourceId: srcChatbox.id,
      sourceType: 'chatbox',
      sourceExternalId: 'chatbox-d21-romashka',
      occurredAt: day(21, 16),
      dataClass: 'sensitive',
      payload: {
        kind: 'chatbox_chat_session',
        customer: 'Ромашка',
        transcript: {
          turns: turns([
            ['Пётр', 'Здравствуйте, мы Ромашка. Увидели вас в рассылке. Что нужно, чтобы попробовать?'],
            ['Дарья', 'Пётр, добрый день. Достаточно короткой встречи-знакомства. Предложу время в течение недели.'],
          ], map, cust),
        },
      },
    });
    log('  chatbox Ромашка (входящий из рассылки)');

    await injectRawEventDirect(infra, {
      tenantId: orgId,
      sourceId: srcConv.id,
      sourceType: 'conversational',
      sourceExternalId: 'chatday-d20',
      occurredAt: day(20, 18),
      payload: {
        transcript: {
          turns: turns([
            ['Михаил', 'По Битрикс: разобрался с авторизацией их API, дальше буду смотреть лимиты. Чувствую, там будут ограничения на объём.'],
            ['Дарья', 'База контактов почти готова, завтра закончу.'],
            ['Анна', 'Концепт «Моей истории» готов на словах, начну рисовать макеты.'],
            ['Сергей', 'Хороший темп. На этой неделе главное — определиться с медиа-движком и запустить продажи.'],
          ], map, cust),
        },
      },
    });
    log('  conversational chat-day (старт квартала)');

    const checkinDate = new Date(now - 20 * DAY_MS).toISOString().slice(0, 10);
    for (const [name, dones, notDone, ideas] of [
      ['Дарья', 'Почти закончила базу контактов', 'Не успела прочистить мёртвые адреса', 'Сегментировать базу по отраслям'],
      ['Михаил', 'Разобрался с авторизацией API Битрикс', '', 'Проверить лимиты API Битрикс на больших пачках'],
      ['Анна', 'Собрала референсы «Моей истории»', 'Не начала макеты', ''],
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
          completedAt: day(20, 20),
          source: 'manual',
          externalSource: 'qa-test',
        },
      });
      await injectRawEventDirect(infra, {
        tenantId: orgId,
        sourceId: srcCheckin.id,
        sourceType: 'daily_checkin',
        sourceExternalId: ci.id,
        occurredAt: day(20, 20),
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
    log('  daily_checkin × 3 (старт квартала)');

    await injectMeeting(infra, orgId, ownerUserId, srcMeeting.id, {
      type: 'project',
      title: '[QA] Ревью проекта (старт квартала)',
      occurredAt: day(19, 11),
      turns: turns([
        ['Сергей', 'Итоги первой недели квартала: определились с метрикой retention и медиа-движком LiveKit. Продажи стартовали.'],
        ['Дарья', 'База контактов готова, можно запускать первую кампанию.'],
        ['Михаил', 'Черновик архитектуры LiveKit готов. Следующий шаг — интеграция Битрикс.'],
      ], map, cust),
    });

    await injectMeeting(infra, orgId, ownerUserId, srcMeeting.id, {
      type: 'retrospective',
      title: '[QA] Ретроспектива (старт квартала)',
      occurredAt: day(19, 16),
      turns: turns([
        ['Сергей', 'Ретро квартала-старта: команда собрана, метрика и стек выбраны. Решение на будущее: крупные развилки фиксируем как обратимые решения с датой пересмотра.'],
        ['Анна', 'Хорошо, что не спорим бесконечно, а фиксируем. Боль: у нас нет процесса дизайн-ревью, скоро упрёмся.'],
        ['Игорь', 'Риск: продажи зависят от Zoom-интеграции, которой нет. Надо честно держать это в голове.'],
      ], map, cust),
    });

    log('— Поллинг прироста…');
    const target = before.canonicalBlock + 18;
    const c = await pollUntil(prisma, orgId, (x) => x.canonicalBlock >= target, cfg.verifyTimeoutMs, 4000);
    await sleep(Math.min(20_000, cfg.verifyTimeoutMs / 6));
    const fin = await loadCounts(prisma, orgId);
    log('\n=== ИТОГОВЫЕ СЧЁТЧИКИ (после недели 4) ===');
    log(JSON.stringify(fin, null, 2));
    void c;
  } finally {
    await infra.close();
  }
}

void main();
