import { type Prisma } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

type Severity = 'low' | 'medium' | 'high' | 'destructive';

interface SettingSeed {
  key: string;
  value: unknown;
  category: string;
  section: string;
  severity: Severity;
  description: string;
}

const SEEDS: SettingSeed[] = [
  {
    key: 'chat_presence_ttl_seconds',
    value: 60,
    category: 'chat',
    section: 'presence',
    severity: 'low',
    description:
      'TTL (сек) записи presence участника разговора в Redis. Истёкшие presence-записи лениво вычищаются; переживает рестарт инстанса. По умолчанию 60.',
  },
  {
    key: 'chat_outbox_sweep_stale_seconds',
    value: 30,
    category: 'chat',
    section: 'delivery',
    severity: 'low',
    description:
      'Порог «застрял» (сек) для backstop-sweep transactional outbox: pending-записи старше этого порога пере-ставятся в очередь доставки. По умолчанию 30.',
  },
  {
    key: 'chat_outbox_sweep_batch_limit',
    value: 200,
    category: 'chat',
    section: 'delivery',
    severity: 'low',
    description:
      'Лимит батча backstop-sweep transactional outbox за один проход. По умолчанию 200.',
  },
  {
    key: 'chat_summary_min_messages',
    value: 5,
    category: 'chat',
    section: 'ai',
    severity: 'low',
    description:
      'Минимум непрочитанных сообщений в разговоре, чтобы «Что пропустил» выдало AI-сводку. Меньше порога → сводка не строится (читай сами сообщения). По умолчанию 5.',
  },
  {
    key: 'chat_summary_idle_days',
    value: 3,
    category: 'chat',
    section: 'ai',
    severity: 'low',
    description:
      'Сколько дней разговор считается «давно не открывали» для предложения сводки «Что пропустил». По умолчанию 3.',
  },
  {
    key: 'external_link_ttl_hours',
    value: 168,
    category: 'chat',
    section: 'external',
    severity: 'medium',
    description:
      'TTL (часов) magic-link доступа внешнего клиента к одному разговору (ConversationAccessLink). Просрочка → 403. По умолчанию 168 (7 дней).',
  },
  {
    key: 'external_inbound_rate_limit',
    value: 30,
    category: 'chat',
    section: 'external',
    severity: 'medium',
    description:
      'Лимит входящих сообщений внешнего клиента в час на разговор (анти-абьюз публичного входа). Превышение → 429. По умолчанию 30.',
  },
  {
    key: 'push_debounce_seconds',
    value: 30,
    category: 'chat',
    section: 'push',
    severity: 'low',
    description:
      'Окно дебаунса (сек) push-уведомлений о новых сообщениях одному получателю: повторные сигналы в пределах окна схлопываются в один. По умолчанию 30.',
  },
  {
    key: 'unread_smart_badge',
    value: true,
    category: 'chat',
    section: 'push',
    severity: 'low',
    description:
      'Умный бейдж непрочитанного: показывать счётчик непрочитанных на иконке/в приложении. Выкл → бейдж не подсвечивается. По умолчанию вкл.',
  },
  {
    key: 'message_retention_days',
    value: 0,
    category: 'chat',
    section: 'retention',
    severity: 'high',
    description:
      'Авто-удаление сообщений старше N дней. 0 = выключено (хранить вечно). >0 = знание сначала уходит в граф (pre-ingest для feedsGraph-разговоров), затем сообщение помечается удалённым (soft-delete, история/нумерация не рвутся). По умолчанию 0.',
  },
  {
    key: 'hr_auto_subscribe_enabled',
    value: true,
    category: 'chat',
    section: 'membership',
    severity: 'medium',
    description:
      'Авто-подписки по HR-событиям: при найме сотрудник автоматически добавляется в обязательный канал «Вся компания» (source=auto); при увольнении его авто-членства удаляются (ручные — остаются). Выкл → членствами управляют только вручную. По умолчанию вкл.',
  },
  {
    key: 'huddle_max_participants',
    value: 10,
    category: 'chat',
    section: 'huddle',
    severity: 'medium',
    description:
      'Максимум участников созвона («huddle»), запущенного из разговора единого чата. При достижении лимита новые участники получают 403 на присоединении. По умолчанию 10.',
  },
];

interface Counters {
  created: number;
  updated: number;
  skippedAdminEdited: number;
}

async function upsertSetting(seed: SettingSeed, counters: Counters): Promise<void> {
  const existing = await prisma.adminSetting.findUnique({
    where: { key: seed.key },
    select: { updatedBy: true },
  });
  const valueInput = seed.value as Prisma.InputJsonValue;

  if (!existing) {
    await prisma.adminSetting.create({
      data: {
        key: seed.key,
        value: valueInput,
        category: seed.category,
        section: seed.section,
        severity: seed.severity,
        description: seed.description,
      },
    });
    counters.created++;
    console.log(`[create] ${seed.key}`);
    return;
  }

  if (existing.updatedBy && existing.updatedBy !== 'system') {
    await prisma.adminSetting.update({
      where: { key: seed.key },
      data: {
        category: seed.category,
        section: seed.section,
        severity: seed.severity,
        description: seed.description,
      },
    });
    counters.skippedAdminEdited++;
    console.log(`[skip:admin-edited] ${seed.key}`);
    return;
  }

  await prisma.adminSetting.update({
    where: { key: seed.key },
    data: {
      value: valueInput,
      category: seed.category,
      section: seed.section,
      severity: seed.severity,
      description: seed.description,
    },
  });
  counters.updated++;
  console.log(`[update] ${seed.key}`);
}

async function main(): Promise<void> {
  console.log('=== seed-admin-setting-chat START ===');

  const counters: Counters = {
    created: 0,
    updated: 0,
    skippedAdminEdited: 0,
  };

  for (const seed of SEEDS) {
    await upsertSetting(seed, counters);
  }

  console.log(
    `created=${counters.created}, updated=${counters.updated}, skipped_admin_edited=${counters.skippedAdminEdited}`,
  );
  console.log('=== seed-admin-setting-chat DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-chat FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
