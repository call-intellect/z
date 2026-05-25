/**
 * End-to-end smoke-тест feedback-фичи:
 *   1. Сидит маршрут LLM `feedback.cluster` (если ещё нет).
 *   2. Создаёт 10 тестовых пользователей с email вида `e2e-feedback-N@test.local`.
 *   3. Итерация 1: создаёт N1 FeedbackMessage с разнообразной тематикой.
 *   4. Запускает FeedbackDigestService.runDigest().
 *   5. Печатает созданные topics + items + assignments.
 *   6. Итерация 2: добавляет N2 новых сообщений (часть лезет в существующие
 *      блоки, часть про новые темы).
 *   7. Снова runDigest().
 *   8. Печатает дельту: сколько новых блоков добавилось, в какие старые блоки
 *      попали новые items.
 *
 * Запуск:  bun run scripts/e2e-feedback-clustering.ts
 * Очистка: bun run scripts/e2e-feedback-clustering.ts --cleanup
 */

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FeedbackDigestService } from '../src/modules/feedback/services/feedback-digest.service';

interface SeedMessage {
  userIndex: number; // 0..9
  text: string;
}

// 18 сообщений первой волны — несколько повторяющихся тем + уникальные.
const WAVE_1: SeedMessage[] = [
  { userIndex: 0, text: 'Очень не хватает тёмной темы в интерфейсе. Глаза устают вечером.' },
  { userIndex: 1, text: 'Дайте, пожалуйста, тёмный режим. Все нормальные приложения его имеют.' },
  { userIndex: 2, text: 'Кнопка экспорта в Excel виснет на больших отчётах, ждёшь по 3-4 минуты.' },
  { userIndex: 3, text: 'Экспорт тупит. Что-то надо делать с производительностью.' },
  { userIndex: 4, text: 'Спасибо за дашборд директора — это просто гениально, экономит мне час в день!' },
  { userIndex: 5, text: 'Дашборд CEO суперский, ребята молодцы.' },
  { userIndex: 0, text: 'Добавьте интеграцию с Telegram чтобы оповещения приходили прямо туда.' },
  { userIndex: 6, text: 'Можно ли получать уведомления в Телеграм? Слак мы не используем.' },
  { userIndex: 7, text: 'Хочу мобильное приложение. Сейчас приходится открывать сайт на телефоне — неудобно.' },
  { userIndex: 8, text: 'Срочно нужен мобильный клиент. Без него фича доступна только в офисе.' },
  { userIndex: 9, text: 'Сделайте, пожалуйста, экспорт встреч в PDF, а не только в Excel.' },
  { userIndex: 1, text: 'PDF-экспорт отчётов — must have. Сейчас приходится сначала в Word, потом сохранять.' },
  { userIndex: 2, text: 'Поиск по встречам очень медленный, иногда висит 10+ секунд.' },
  { userIndex: 3, text: 'Хочу видеть всю историю своих идей одним списком, а не лезть в каждую встречу.' },
  { userIndex: 4, text: 'асдфасдфасдф' }, // мусор
  { userIndex: 5, text: 'Не работает озвучка отчёта голосом, выдает ошибку Network.' },
  { userIndex: 6, text: 'Спасибо за новый поиск, стало гораздо удобнее искать инсайты!' },
  { userIndex: 7, text: 'Кнопка экспорта вообще ничего не делает, нажимаю — ничего. Браузер Firefox.' },
];

// 14 сообщений второй волны — часть лезет в существующие, часть про новые темы.
const WAVE_2: SeedMessage[] = [
  { userIndex: 8, text: 'Когда уже тёмная тема? Спрашиваю третий раз.' }, // → существующий блок про тёмную тему
  { userIndex: 9, text: 'Экспорт в Excel снова виснет на отчёте за месяц.' }, // → существующий про экспорт
  { userIndex: 0, text: 'Гениальный дашборд директора, рекомендую всем коллегам.' }, // → благодарности дашборду
  { userIndex: 1, text: 'Хочу видеть прогресс цели в реальном времени, а не раз в неделю.' }, // → новый блок про цели
  { userIndex: 2, text: 'Можно ли настроить какие именно оповещения приходят, а какие нет? Сейчас всё подряд.' }, // → новый про настройки оповещений
  { userIndex: 3, text: 'Slack-интеграция тоже была бы полезна, не только Telegram.' }, // → новый или к Telegram?
  { userIndex: 4, text: 'Когда мобильное приложение появится? Уже год обещаете.' }, // → существующий про мобилку
  { userIndex: 5, text: 'Хочу видеть все мои поручения в одном месте, сейчас приходится переходить по встречам.' }, // → новый про инбокс/таски
  { userIndex: 6, text: 'Спасибо за быстрый поиск, теперь нахожу нужное за пару секунд!' }, // → существующий про поиск
  { userIndex: 7, text: 'Очень нужны рекуррентные встречи каждую неделю с автоматическим созданием.' }, // → новый про рекуррентные
  { userIndex: 8, text: 'Бот в Telegram нужен срочно, у нас все там общаются.' }, // → существующий про Telegram
  { userIndex: 9, text: 'фыфыфыфы хахаха не понимаю что это' }, // → discard
  { userIndex: 0, text: 'Можно ли экспортировать одну встречу как PDF с фотками участников?' }, // → существующий PDF-экспорт
  { userIndex: 1, text: 'Голосовой ассистент в браузере не работает на айпаде в Сафари. Что делать?' }, // → новый про bug Safari/voice
];

const TEST_EMAIL_PREFIX = 'e2e-feedback-';

async function cleanup(prisma: PrismaService): Promise<void> {
  // Удаляем items → messages → topics (созданные только за время теста)
  const users = await prisma.user.findMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
    select: { id: true },
  });
  if (users.length === 0) return;
  const userIds = users.map((u) => u.id);

  const messages = await prisma.feedbackMessage.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const messageIds = messages.map((m) => m.id);

  // items
  const items = await prisma.feedbackItem.findMany({
    where: { messageId: { in: messageIds } },
    select: { topicId: true },
  });
  const touchedTopicIds = Array.from(new Set(items.map((i) => i.topicId).filter((t): t is string => t !== null)));

  await prisma.feedbackItem.deleteMany({ where: { messageId: { in: messageIds } } });
  await prisma.feedbackMessage.deleteMany({ where: { id: { in: messageIds } } });

  // удаляем topics, у которых после удаления items больше нет items
  for (const topicId of touchedTopicIds) {
    const remaining = await prisma.feedbackItem.count({ where: { topicId } });
    if (remaining === 0) {
      await prisma.feedbackTopic.delete({ where: { id: topicId } });
    }
  }

  // юзеров
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  console.log(`Удалено: ${userIds.length} юзеров, ${messageIds.length} сообщений, ${touchedTopicIds.length} тронутых блоков.`);
}

async function findOrCreateUsers(prisma: PrismaService): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    const email = `${TEST_EMAIL_PREFIX}${i}@test.local`;
    const existing = await prisma.user.findFirst({ where: { email } });
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const created = await prisma.user.create({
      data: {
        email,
        name: `E2E Feedback Юзер ${i}`,
        // signupSource — обязательное? Зависит от схемы. Если нужно — добавим позже.
      },
    });
    ids.push(created.id);
  }
  return ids;
}

async function seedMessages(
  prisma: PrismaService,
  userIds: string[],
  wave: SeedMessage[],
): Promise<number> {
  let created = 0;
  for (const msg of wave) {
    await prisma.feedbackMessage.create({
      data: {
        userId: userIds[msg.userIndex],
        text: msg.text,
        // orgId — не ставим, фидбэк глобальный.
      },
    });
    created++;
  }
  return created;
}

async function printState(prisma: PrismaService, label: string): Promise<void> {
  console.log(`\n=== ${label} ===`);
  const topics = await prisma.feedbackTopic.findMany({
    where: { status: 'ACTIVE' },
    include: { items: { include: { message: { include: { user: { select: { email: true } } } } } } },
    orderBy: { createdAt: 'asc' },
  });

  if (topics.length === 0) {
    console.log('Блоков пока нет.');
    return;
  }

  for (const topic of topics) {
    const totalItems = topic.items.length;
    const discarded = topic.items.filter((i) => i.discarded).length;
    const real = totalItems - discarded;
    const uniqueUsers = new Set(topic.items.map((i) => i.message.userId)).size;
    console.log(`\n📦 [${topic.id.slice(0, 8)}] ${topic.title}`);
    console.log(`   ${topic.description}`);
    console.log(`   items=${real} (uniqueUsers=${uniqueUsers}, discarded=${discarded})`);
    for (const item of topic.items.slice(0, 5)) {
      const author = item.message.user.email;
      const when = item.createdAt.toISOString().slice(0, 16).replace('T', ' ');
      console.log(`     • [${when}] ${author}: «${item.text.slice(0, 100)}»`);
    }
    if (topic.items.length > 5) {
      console.log(`     ... (ещё ${topic.items.length - 5})`);
    }
  }

  const discardedCount = await prisma.feedbackItem.count({ where: { discarded: true } });
  const unprocessed = await prisma.feedbackMessage.count({ where: { processedAt: null } });
  console.log(`\nИтого: блоков=${topics.length}, discard'ов=${discardedCount}, необработанных сообщений=${unprocessed}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isCleanup = args.includes('--cleanup');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const digest = app.get(FeedbackDigestService);

    if (isCleanup) {
      await cleanup(prisma);
      return;
    }

    console.log('=== E2E feedback clustering test ===\n');

    // 0. Очистка предыдущего тестового запуска (если был).
    console.log('Очищаю прошлые тестовые данные...');
    await cleanup(prisma);

    // 1. Создаём пользователей.
    const userIds = await findOrCreateUsers(prisma);
    console.log(`Создано ${userIds.length} тестовых юзеров.`);

    // 2. Итерация 1.
    const wave1Count = await seedMessages(prisma, userIds, WAVE_1);
    console.log(`\nИтерация 1: создано ${wave1Count} сообщений. Запускаю runDigest()...`);
    const result1 = await digest.runDigest();
    console.log(`runDigest() результат:`, JSON.stringify(result1));
    await printState(prisma, 'После итерации 1');

    // Запомним id блоков, созданных в итерации 1.
    const after1Topics = await prisma.feedbackTopic.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, title: true },
    });
    const after1Ids = new Set(after1Topics.map((t) => t.id));

    // 3. Итерация 2.
    const wave2Count = await seedMessages(prisma, userIds, WAVE_2);
    console.log(`\nИтерация 2: добавлено ${wave2Count} сообщений. Запускаю runDigest()...`);
    const result2 = await digest.runDigest();
    console.log(`runDigest() результат:`, JSON.stringify(result2));
    await printState(prisma, 'После итерации 2');

    // 4. Дельта.
    const after2Topics = await prisma.feedbackTopic.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, title: true, items: { select: { id: true, createdAt: true } } },
    });
    const newTopics = after2Topics.filter((t) => !after1Ids.has(t.id));
    console.log(`\n=== ДЕЛЬТА ===`);
    console.log(`Блоков было: ${after1Topics.length}, стало: ${after2Topics.length}, новых: ${newTopics.length}`);
    if (newTopics.length > 0) {
      console.log(`Новые блоки (Итерация 2):`);
      for (const t of newTopics) {
        console.log(`  + ${t.title} (items=${t.items.length})`);
      }
    }
    console.log(`\n=== Конец e2e-теста ===\n`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('E2E test failed:', err);
  process.exit(1);
});
