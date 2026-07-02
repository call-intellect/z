import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

function assertLocal(): void {
  const url = process.env['DATABASE_URL'] ?? '';
  if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error('qa-seed-goal-tree: DATABASE_URL не локальный — отказ');
  }
}

async function main(): Promise<void> {
  assertLocal();
  const orgId = process.env['STRELA_ORG'];
  if (!orgId) throw new Error('STRELA_ORG не задан');
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { ownerId: true, name: true } });
  const createdById = org.ownerId!;
  const persons = await prisma.person.findMany({ where: { tenantId: orgId, relationship: 'employee' }, select: { id: true, name: true } });
  const pid = (n: string) => persons.find((p) => p.name === n)?.id ?? null;

  // eslint-disable-next-line no-console
  console.log(`=== qa-seed-goal-tree: ${org.name} (${orgId}) ===`);

  if (process.env['QA_FORCE'] === '1') {
    const del = await prisma.goal.deleteMany({ where: { tenantId: orgId, externalSource: 'qa-goal-tree' } });
    // eslint-disable-next-line no-console
    console.log(`  QA_FORCE: удалено ${del.count} прежних qa-goal-tree`);
  }
  const existing = await prisma.goal.count({ where: { tenantId: orgId, externalSource: 'qa-goal-tree' } });
  if (existing > 0) {
    // eslint-disable-next-line no-console
    console.log(`  уже засеяно (${existing} целей qa-goal-tree) — пропуск`);
    return;
  }

  const now = new Date();
  const sept = new Date(now.getFullYear(), 8, 30);
  const mk = async (args: {
    name: string;
    description: string;
    parentGoalId?: string | null;
    isPrimary?: boolean;
    horizon?: 'strategic' | 'annual' | 'quarterly' | 'monthly' | 'sprint';
    owner?: string | null;
    targetDate?: Date | null;
  }): Promise<string> => {
    const g = await prisma.goal.create({
      data: {
        tenantId: orgId,
        externalSource: 'qa-goal-tree',
        name: args.name,
        description: args.description,
        createdById,
        parentGoalId: args.parentGoalId ?? null,
        isPrimary: args.isPrimary ?? false,
        horizon: (args.horizon ?? 'quarterly') as never,
        ownerPersonId: args.owner ? pid(args.owner) : null,
        targetDate: args.targetDate ?? sept,
        status: 'active',
      },
    });
    // eslint-disable-next-line no-console
    console.log(`  goal «${args.name}»${args.parentGoalId ? ' (подцель)' : args.isPrimary ? ' (ГЛАВНАЯ)' : ''} → ${g.id}`);
    return g.id;
  };

  const root = await mk({
    name: 'Поднять недельный retention с 42% до 55%',
    description: 'Ключевая цель квартала: недельное удержание пользователей 42% → 55% к концу сентября. Всё меряем этим.',
    isPrimary: true,
    horizon: 'quarterly',
    owner: 'Сергей',
  });

  const bitrix = await mk({
    name: 'Интеграция с Битрикс — тянуть рабочие чаты в граф',
    description: 'Больше источников данных в графе памяти → точнее «Моя история» → выше вовлечённость и retention.',
    parentGoalId: root,
    horizon: 'monthly',
    owner: 'Михаил',
  });
  await mk({
    name: 'Настроить мониторинг ошибок Битрикс API (429)',
    description: 'Видеть частоту 429 в реальном времени на дашборде, чтобы не ослепнуть на объёме.',
    parentGoalId: bitrix,
    horizon: 'sprint',
    owner: 'Михаил',
  });
  await mk({
    name: 'Заложить exponential backoff в синк Битрикс',
    description: 'Снизить риск блокера rate-limit при больших пачках.',
    parentGoalId: bitrix,
    horizon: 'sprint',
    owner: 'Михаил',
  });

  await mk({
    name: 'Раздел «Моя история» — еженедельный дайджест памяти',
    description: 'Показывать пользователю, что Кора про него запомнила за неделю. Прямой рычаг вовлечённости.',
    parentGoalId: root,
    horizon: 'monthly',
    owner: 'Анна',
  });

  const pilot = await mk({
    name: 'Пилот Логистик Плюс — снизить потери задач на 30%',
    description: 'Три месяца, отдел логистики (15 чел). Критерий перехода на годовой контракт: −30% потерянных задач.',
    parentGoalId: root,
    horizon: 'monthly',
    owner: 'Дарья',
  });
  await mk({
    name: 'Онбординг Ромашки',
    description: 'Подключить Telegram-группу, настроить автосбор задач. Первая неделя пилота.',
    parentGoalId: pilot,
    horizon: 'sprint',
    owner: 'Дарья',
  });

  // eslint-disable-next-line no-console
  console.log('=== qa-seed-goal-tree DONE (1 главная + 3 подцели + 3 под-подцели) ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('qa-seed-goal-tree FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
