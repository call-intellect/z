import {
  type ChannelRow,
  type HarnessConfig,
  type HarnessInfra,
  type MatrixCell,
  type SyntheticTenant,
  type TenantCounts,
  assertNotProd,
  bootstrapTenant,
  computeExitCode,
  injectRawEventDirect,
  httpPost,
  loadCounts,
  makeInfra,
  pollUntil,
  probeAge,
  pseudoUlid,
  readConfig,
  renderMatrix,
  sleep,
  teardownTenant,
  terminalProjectionTotal,
  typedGroupBTotal,
  upsertSource,
} from './_lib/combat-harness';

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

async function injectLowLevel(infra: HarnessInfra, t: SyntheticTenant): Promise<void> {
  const src = await upsertSource(infra.prisma, {
    tenantId: t.orgId,
    type: 'web_form',
    name: 'Combat low-level',
  });
  await injectRawEventDirect(infra, {
    tenantId: t.orgId,
    sourceId: src.id,
    sourceType: 'web_form',
    sourceExternalId: `lowlevel:${t.tag}`,
    occurredAt: new Date(),
    payload: {
      text:
        'Низкоуровневый вброс: решили зафиксировать регламент онбординга новых разработчиков. ' +
        'Иван отвечает за документацию, дедлайн — конец месяца.',
      authorUserId: t.userId,
      authorName: 'Combat Harness',
    },
  });
}

async function injectWebForm(
  cfg: HarnessConfig,
  infra: HarnessInfra,
  t: SyntheticTenant,
): Promise<void> {
  if (cfg.mode === 'direct' || cfg.mode === 'both') {
    const src = await upsertSource(infra.prisma, {
      tenantId: t.orgId,
      type: 'web_form',
      name: 'Дамп мысли',
    });
    await injectRawEventDirect(infra, {
      tenantId: t.orgId,
      sourceId: src.id,
      sourceType: 'web_form',
      sourceExternalId: `web:${t.userId}:${t.tag}`,
      occurredAt: new Date(),
      payload: {
        text:
          'Идея: запустить проект Альфа для клиента Ромашка. Главный риск — нехватка ' +
          'разработчиков. Решение: привлечь подрядчика на фронтенд, бюджет ~500к.',
        authorUserId: t.userId,
        authorName: 'Combat Harness',
      },
    });
  }
  if (cfg.mode === 'http' || cfg.mode === 'both') {
    const res = await httpPost(
      cfg,
      '/api/v1/ingest/dump',
      {
        text: 'HTTP-дамп: договорились пересмотреть процесс ревью. Метрика — время до мержа.',
        nonce: `cmbt-${t.tag}-dump`,
      },
      { tenantId: t.orgId, useCookie: true },
    );
    log(
      `  http web_form → status=${res.status} ok=${res.ok}${res.error ? ` err=${res.error}` : ''}`,
    );
  }
}

async function injectFreeNote(
  cfg: HarnessConfig,
  infra: HarnessInfra,
  t: SyntheticTenant,
): Promise<void> {
  if (cfg.mode === 'direct' || cfg.mode === 'both') {
    const src = await upsertSource(infra.prisma, {
      tenantId: t.orgId,
      type: 'conversational',
      name: 'Свободные заметки',
    });
    await injectRawEventDirect(infra, {
      tenantId: t.orgId,
      sourceId: src.id,
      sourceType: 'conversational',
      sourceExternalId: null,
      occurredAt: new Date(),
      payload: {
        kind: 'free_note',
        userId: t.userId,
        text:
          'Свободная заметка: инсайт — клиенты чаще уходят на второй неделе. ' +
          'Гипотеза: онбординг слишком длинный. Эксперимент: сократить до 3 шагов.',
        metadata: null,
      },
    });
  }
  if (cfg.mode === 'http' || cfg.mode === 'both') {
    const res = await httpPost(
      cfg,
      '/api/v1/conversational/notifications/free-note',
      {
        text: 'HTTP free_note: предложение нанять ещё одного бэкенд-разработчика в Q3.',
      },
      { tenantId: t.orgId, useCookie: true },
    );
    log(
      `  http free_note → status=${res.status} ok=${res.ok}${res.error ? ` err=${res.error}` : ''}`,
    );
  }
}

async function injectMeetingDirect(infra: HarnessInfra, t: SyntheticTenant): Promise<void> {
  const { prisma } = infra;
  const src = await upsertSource(prisma, {
    tenantId: t.orgId,
    type: 'meeting',
    name: 'Встречи Z',
  });
  const meetingId = pseudoUlid();
  const startedAt = new Date(Date.now() - 30 * 60_000);
  const endedAt = new Date();
  const turns = [
    {
      speaker: 'Алексей',
      text: 'Сегодня обсудим проект Альфа. Клиент Ромашка просит ускорить релиз до конца квартала.',
      startSec: 0,
      endSec: 8,
    },
    {
      speaker: 'Алексей',
      text: 'Главный риск — нехватка разработчиков. Решили привлечь подрядчика. Иван берёт API.',
      startSec: 8,
      endSec: 16,
    },
    {
      speaker: 'Иван',
      text: 'Я возьму на себя API-часть. Обещаю закончить к пятнице. Бюджет около 500к.',
      startSec: 16,
      endSec: 28,
    },
  ];
  await prisma.meeting.create({
    data: {
      id: meetingId,
      roomName: meetingId,
      title: `Combat встреча ${t.tag}`,
      type: 'team',
      tenantId: t.orgId,
      ownerId: t.userId,
      startedAt,
      endedAt,
      durationMs: endedAt.getTime() - startedAt.getTime(),
      transcript: {
        create: {
          turns: turns as unknown as object,
          roomChat: [] as unknown as object,
          totalWords: 60,
          totalDurationSeconds: 28,
        },
      },
    },
  });

  const payload = {
    meetingId,
    type: 'team',
    title: `Combat встреча ${t.tag}`,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    participants: [
      {
        participantId: 'p1',
        userId: t.userId,
        displayName: 'Алексей',
        role: 'host',
        livekitIdentity: `host:${t.userId}`,
        joinedAt: startedAt.toISOString(),
        leftAt: endedAt.toISOString(),
      },
    ],
    transcript: { totalWords: 60, totalDurationSeconds: 28, turns },
    roomChat: [],
  };
  await injectRawEventDirect(infra, {
    tenantId: t.orgId,
    sourceId: src.id,
    sourceType: 'meeting',
    sourceExternalId: meetingId,
    occurredAt: endedAt,
    payload,
  });
}

interface ThresholdInfo {
  linkerMinBlocks: number;
}

async function readThresholds(infra: HarnessInfra): Promise<ThresholdInfo> {
  let linkerMinBlocks = Number(process.env['LINKER_MIN_BLOCKS'] ?? '50');
  try {
    const setting = await infra.prisma.adminSetting.findFirst({
      where: { key: 'knowledge.linkerMinBlocks' },
      select: { value: true },
    });
    if (setting?.value != null) {
      const v = Number(
        typeof setting.value === 'object'
          ? ((setting.value as { value?: unknown }).value ?? setting.value)
          : setting.value,
      );
      if (Number.isFinite(v) && v > 0) linkerMinBlocks = v;
    }
  } catch {}
  return { linkerMinBlocks };
}

function cell(status: MatrixCell['status'], note?: string): MatrixCell {
  return note ? { status, note } : { status };
}

function buildRow(
  channel: string,
  c: TenantCounts,
  age: { available: boolean; nodeCount: number | null },
  thr: ThresholdInfo,
  ageEnabled: boolean,
): ChannelRow {
  const cells: Record<string, MatrixCell> = {};

  cells.raw_event = c.rawEvent > 0 ? cell('PASS') : cell('FAIL');
  cells.idea_block = c.ideaBlock > 0 ? cell('PASS') : cell('FAIL');
  cells.canonical =
    c.canonicalBlock > 0 ? cell('PASS') : cell('FAIL', 'distill не дал canonical в окне');
  cells.entity = c.entity > 0 ? cell('PASS') : cell('FAIL');

  const typedB = typedGroupBTotal(c);
  cells.typed_group_b =
    typedB > 0
      ? cell('PASS')
      : c.ideaBlock > 0
        ? cell('FAIL', 'known bug #3/#11: AGE rollback типизированных сущностей')
        : cell('SKIP', 'нет блоков');

  cells.entity_link =
    c.entityLink > 0
      ? cell('PASS')
      : c.entity > 1
        ? cell('FAIL', 'known bug #14: addEdge rollback при недоступном AGE')
        : cell('SKIP', 'мало сущностей для ребра');

  cells.block_link =
    c.ideaBlockLink > 0
      ? cell('PASS')
      : c.canonicalBlock < thr.linkerMinBlocks
        ? cell('SKIP', `порог linker ${thr.linkerMinBlocks} > canonical ${c.canonicalBlock}`)
        : cell('FAIL', 'known bug #18/#35: linker не строит связи');

  cells.theme =
    c.theme > 0 ? cell('PASS') : cell('SKIP', 'порог theme не достигнут (малый тенант)');

  const term = terminalProjectionTotal(c);
  cells.terminal_projection =
    term > 0
      ? cell('PASS')
      : c.canonicalBlock > 0
        ? cell('FAIL', 'known bug #15/#16/#24: specialist-routing / draft→canonical')
        : cell('SKIP', 'нет canonical-блоков');

  cells.commitment =
    c.commitmentBlock > 0 ? cell('PASS') : cell('SKIP', 'commitment-блок не извлечён');
  cells.card = c.card > 0 ? cell('PASS') : cell('SKIP', 'card не материализована');
  cells.goal = c.goal > 0 ? cell('PASS') : cell('SKIP', 'goal не извлечён');
  cells.tracker = c.intakeIssue > 0 ? cell('PASS') : cell('SKIP', 'IntakeIssue не создан');

  if (!ageEnabled) {
    cells.age_node = cell('N/A', 'GRAPH_AGE не включён');
  } else if (!age.available) {
    cells.age_node = cell('FAIL', 'known bug #3/#11/#12: cypher() недоступен (42883/search_path)');
  } else {
    cells.age_node = (age.nodeCount ?? 0) > 0 ? cell('PASS') : cell('SKIP', '0 узлов в z_graph');
  }

  return { channel, cells };
}

async function main(): Promise<void> {
  const cfg = readConfig();
  assertNotProd(cfg);

  log(
    `=== smoke-pipeline-e2e START (mode=${cfg.mode}, runMode=${cfg.runMode}, voxLive=${cfg.voxLive}) ===`,
  );
  const infra = makeInfra(cfg);
  let tenant: SyntheticTenant | null = null;

  try {
    tenant = await bootstrapTenant(infra.prisma);
    log(
      `✓ Синтетический тенант: Org=${tenant.orgId} User=${tenant.userId} Person=${tenant.personId} tag=${tenant.tag}`,
    );

    const ageEnabled =
      (process.env['GRAPH_AGE_ENABLED'] ?? '').toLowerCase() === 'true' ||
      process.env['GRAPH_AGE_ENABLED'] === '1' ||
      false;

    const thr = await readThresholds(infra);
    log(`  пороги: linkerMinBlocks=${thr.linkerMinBlocks}`);

    log('— Вброс low-level RawEvent…');
    await injectLowLevel(infra, tenant);
    log('— Вброс web_form / дамп мысли…');
    await injectWebForm(cfg, infra, tenant);
    log('— Вброс free_note…');
    await injectFreeNote(cfg, infra, tenant);
    log('— Вброс meeting (низ цепочки, обход Vox)…');
    await injectMeetingDirect(infra, tenant);

    if (cfg.voxLive) {
      log(
        '— VOX_LIVE=1: полный meeting-путь через Vox требует живого ASR-прокси + синтетического аудио → SKIP в этой версии каркаса (блокер #1).',
      );
    }

    log(`— Поллинг до canonical-блоков (timeout=${cfg.verifyTimeoutMs}ms)…`);
    const counts = await pollUntil(
      infra.prisma,
      tenant.orgId,
      (c) => c.canonicalBlock > 0 || c.ideaBlock >= 3,
      cfg.verifyTimeoutMs,
    );
    await sleep(Math.min(15_000, cfg.verifyTimeoutMs / 4));
    const finalCounts = await loadCounts(infra.prisma, tenant.orgId);
    log(`  итоговые счётчики: ${JSON.stringify(finalCounts)}`);
    void counts;

    const age = await probeAge(infra.prisma, tenant.orgId);
    log(
      `  AGE-проба: available=${age.available} nodes=${age.nodeCount ?? '—'}${age.error ? ` err=${age.error.slice(0, 120)}` : ''}`,
    );

    const rows: ChannelRow[] = [];
    rows.push(buildRow('AGGREGATE (все каналы, узлы цепочки)', finalCounts, age, thr, ageEnabled));

    for (const ch of ['low_level', 'web_form', 'free_note', 'meeting_direct'] as const) {
      const srcType =
        ch === 'free_note' ? 'conversational' : ch === 'meeting_direct' ? 'meeting' : 'web_form';
      const cnt = await infra.prisma.rawEvent.count({
        where: { tenantId: tenant.orgId, sourceType: srcType as never },
      });
      rows.push({
        channel: ch,
        cells: { raw_event: cnt > 0 ? cell('PASS', `rawEvent=${cnt}`) : cell('FAIL') },
      });
    }
    if (cfg.voxLive) {
      rows.push({
        channel: 'meeting_vox',
        cells: { raw_event: cell('SKIP', 'нужен живой Vox/ASR (блокер #1)') },
      });
    }

    log('\n' + renderMatrix(rows));

    const exit = computeExitCode(rows, cfg.runMode);
    log(
      `\n=== smoke-pipeline-e2e ${exit === 0 ? 'PASSED' : 'FAILED'} (exit=${exit}, runMode=${cfg.runMode}) ===`,
    );

    if (cfg.keepTenant) {
      log(
        `⚠ KEEP_TENANT=1 — тенант НЕ удалён. Org=${tenant.orgId}. Ручная очистка: см. teardownTenant.`,
      );
    } else {
      await teardownTenant(infra.prisma, tenant);
      log('✓ Teardown синтетического тенанта готов');
    }
    process.exitCode = exit;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('smoke-pipeline-e2e FAILED:', err);
    if (tenant && !cfg.keepTenant) {
      await teardownTenant(infra.prisma, tenant).catch(() => undefined);
    }
    process.exitCode = 1;
  } finally {
    await infra.close();
  }
}

void main();
