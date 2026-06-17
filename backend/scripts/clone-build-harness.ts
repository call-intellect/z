import {
  type HarnessConfig,
  type HarnessInfra,
  type SyntheticTenant,
  assertNotProd,
  bootstrapTenant,
  injectRawEventDirect,
  makeInfra,
  pseudoUlid,
  readConfig,
  sleep,
  teardownTenant,
  upsertSource,
} from './_lib/combat-harness';

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

interface Episode {
  daysAgo: number;
  title: string;
  reasoning: string[];
}

const CLUSTER_1: Episode[] = [
  {
    daysAgo: 44,
    title: 'Планирование релиза Альфа',
    reasoning: [
      'Я не готов фиксировать срок по этому эпику, пока мы не снимем нагрузку на стейдже — я уже обжигался на оценках без замеров.',
      'Давайте не закладывать дату, пока не разберём контракт с биллингом: там легко вылезает лишняя неделя, и я не хочу обещать вслепую.',
    ],
  },
  {
    daysAgo: 30,
    title: 'Оценка миграции хранилища',
    reasoning: [
      'Я принципиально не называю срок миграции, пока не прогоню пробный батч на проде-копии — иначе это гадание, а не оценка.',
    ],
  },
  {
    daysAgo: 17,
    title: 'Ретро спринта',
    reasoning: [
      'Я предпочитаю откладывать коммит по срокам до того, как соберу фактические данные о зависимостях — слишком много допущений ломает план.',
      'Когда меня просят оценку «прямо сейчас», я обычно беру паузу и сначала смотрю метрики, а не даю цифру из головы.',
    ],
  },
  {
    daysAgo: 5,
    title: 'Планёрка по интеграции',
    reasoning: [
      'Не хочу комиттиться по дате интеграции, пока не проверю, как ведёт себя их API под нагрузкой — без этого любой срок будет фантазией.',
    ],
  },
];

const CLUSTER_2: Episode[] = [
  {
    daysAgo: 40,
    title: 'Продуктовое решение по онбордингу',
    reasoning: [
      'Я против того, чтобы менять онбординг по ощущениям — давайте сначала соберём конверсию по шагам и A/B, а потом решим.',
    ],
  },
  {
    daysAgo: 22,
    title: 'Спор про кэш',
    reasoning: [
      'Прежде чем добавлять кэш, я хочу увидеть профиль нагрузки: если это не узкое место по цифрам, усложнение не оправдано.',
      'Я опираюсь на данные, а не на авторитет: даже если так советует архитектор, без метрик я решение не приму.',
    ],
  },
  {
    daysAgo: 9,
    title: 'Выбор протокола',
    reasoning: [
      'Я не выбираю технологию по моде — мне нужны замеры и удержание, иначе это решение без основания.',
    ],
  },
];

async function injectReasoningMeeting(
  infra: HarnessInfra,
  t: SyntheticTenant,
  employeeName: string,
  ep: Episode,
  idx: number,
): Promise<string> {
  const { prisma } = infra;
  const src = await upsertSource(prisma, {
    tenantId: t.orgId,
    type: 'meeting',
    name: 'Клон-харнесс встречи',
  });
  const meetingId = pseudoUlid();
  const endedAt = new Date(Date.now() - ep.daysAgo * 24 * 60 * 60_000);
  const startedAt = new Date(endedAt.getTime() - 20 * 60_000);

  const turns: Array<{ speaker: string; text: string; startSec: number; endSec: number }> = [];
  let sec = 0;
  turns.push({
    speaker: 'Менеджер',
    text: `Обсудим ${ep.title}. ${employeeName}, твоя позиция?`,
    startSec: sec,
    endSec: (sec += 6),
  });
  for (const r of ep.reasoning) {
    turns.push({ speaker: employeeName, text: r, startSec: sec, endSec: (sec += 14) });
  }
  const totalWords = turns.reduce((a, x) => a + x.text.split(/\s+/).filter(Boolean).length, 0);

  await prisma.meeting.create({
    data: {
      id: meetingId,
      roomName: meetingId,
      title: `${ep.title} #${idx + 1}`,
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
          totalWords,
          totalDurationSeconds: sec,
        },
      },
    },
  });

  const payload = {
    meetingId,
    type: 'team',
    title: `${ep.title} #${idx + 1}`,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    participants: [
      {
        participantId: 'p_emp',
        userId: t.userId,
        displayName: employeeName,
        role: 'host',
        livekitIdentity: `host:${t.userId}`,
        joinedAt: startedAt.toISOString(),
        leftAt: endedAt.toISOString(),
      },
    ],
    transcript: { totalWords, totalDurationSeconds: sec, turns },
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
  return meetingId;
}

interface CloneSnapshot {
  reasoningSubjectBlocks: number;
  canonicalReasoningSubject: number;
  skillProfile: { id: string; status: string; buildVersion: number } | null;
  traits: Array<{
    category: string;
    statement: string;
    confidence: string;
    observationCount: number;
    status: string;
  }>;
  personas: Array<{
    id: string;
    scope: string;
    version: number;
    status: string;
    builtFromTraitsCount: number;
  }>;
}

async function snapshot(infra: HarnessInfra, t: SyntheticTenant): Promise<CloneSnapshot> {
  const { prisma } = infra;
  const person = await prisma.person.findFirst({
    where: { tenantId: t.orgId, userId: t.userId },
    select: { id: true, entityId: true },
  });
  const entityId = person?.entityId ?? '__none__';
  const reasoningSubjectBlocks = await prisma.ideaBlockEntity.count({
    where: {
      entityId,
      role: 'subject',
      block: {
        tenantId: t.orgId,
        signalType: { in: ['reasoning', 'rationale', 'decision_basis'] as never },
      },
    },
  });
  const canonicalReasoningSubject = await prisma.ideaBlockEntity.count({
    where: {
      entityId,
      role: 'subject',
      block: {
        tenantId: t.orgId,
        status: 'canonical',
        signalType: { in: ['reasoning', 'rationale', 'decision_basis'] as never },
      },
    },
  });
  const profile = await prisma.skillProfile.findFirst({
    where: { tenantId: t.orgId, personId: person?.id ?? '__none__' },
    select: { id: true, status: true, buildVersion: true },
  });
  const traits = profile
    ? await prisma.skillTrait.findMany({
        where: { profileId: profile.id },
        select: {
          category: true,
          statement: true,
          confidence: true,
          observationCount: true,
          status: true,
        },
        orderBy: [{ confidence: 'desc' }, { observationCount: 'desc' }],
      })
    : [];
  const personas = await prisma.executablePersona.findMany({
    where: { tenantId: t.orgId },
    select: { id: true, scope: true, version: true, status: true, builtFromTraitsCount: true },
    orderBy: { createdAt: 'desc' },
  });
  return {
    reasoningSubjectBlocks,
    canonicalReasoningSubject,
    skillProfile: profile
      ? { id: profile.id, status: String(profile.status), buildVersion: profile.buildVersion }
      : null,
    traits: traits.map((x) => ({
      ...x,
      confidence: String(x.confidence),
      status: String(x.status),
    })),
    personas: personas.map((p) => ({ ...p, scope: String(p.scope), status: String(p.status) })),
  };
}

function printSnapshot(s: CloneSnapshot): void {
  log(
    `  reasoning-subject блоков: ${s.reasoningSubjectBlocks} (canonical: ${s.canonicalReasoningSubject})`,
  );
  log(
    `  SkillProfile: ${s.skillProfile ? `id=${s.skillProfile.id.slice(0, 8)} status=${s.skillProfile.status} v=${s.skillProfile.buildVersion}` : '— нет —'}`,
  );
  log(`  SkillTrait'ы (${s.traits.length}):`);
  for (const t of s.traits) {
    log(
      `    • [${t.confidence}, ${t.observationCount} набл., ${t.status}] «${t.category}»: ${t.statement.slice(0, 160)}`,
    );
  }
  log(
    `  ExecutablePersona (${s.personas.length}): ${s.personas.map((p) => `${p.scope} v${p.version}/${p.status} (${p.builtFromTraitsCount} черт)`).join('; ') || '— нет —'}`,
  );
}

async function main(): Promise<void> {
  const cfg: HarnessConfig = readConfig();
  assertNotProd(cfg);

  const employeeName = process.env['EMPLOYEE_NAME'] ?? 'Сергей';
  const episodes = [...CLUSTER_1, ...CLUSTER_2];
  const numLimit = Number(process.env['NUM_MEETINGS'] ?? String(episodes.length));
  const toInject = episodes.slice(0, Math.max(1, numLimit));

  log(`=== clone-build-harness START (employee=${employeeName}, meetings=${toInject.length}) ===`);
  const infra = makeInfra(cfg);
  let tenant: SyntheticTenant | null = null;

  try {
    tenant = await bootstrapTenant(infra.prisma);
    await infra.prisma.person.updateMany({
      where: { tenantId: tenant.orgId, userId: tenant.userId },
      data: { name: employeeName },
    });
    log(
      `✓ синтетический тенант: Org=${tenant.orgId} Person(employee)=${tenant.personId} tag=${tenant.tag}`,
    );

    log('— Вброс reasoning-встреч…');
    for (let i = 0; i < toInject.length; i++) {
      const mid = await injectReasoningMeeting(infra, tenant, employeeName, toInject[i], i);
      log(
        `  [${i + 1}/${toInject.length}] «${toInject[i].title}» (${toInject[i].daysAgo}д назад) → meeting ${mid.slice(0, 10)}…`,
      );
      await sleep(400);
    }

    log(`\n— Поллинг до SkillTrait'ов (timeout=${cfg.verifyTimeoutMs}ms)…`);
    const deadline = Date.now() + cfg.verifyTimeoutMs;
    let last = await snapshot(infra, tenant);
    let tick = 0;
    while (Date.now() < deadline) {
      if (last.traits.length >= 2) break;
      await sleep(5000);
      last = await snapshot(infra, tenant);
      if (++tick % 4 === 0) {
        log(`  …t+${Math.round((cfg.verifyTimeoutMs - (deadline - Date.now())) / 1000)}с:`);
        printSnapshot(last);
      }
    }

    log('\n=== ИТОГ ===');
    printSnapshot(last);

    if (cfg.keepTenant) {
      log(`\n⚠ KEEP_TENANT=1 — тенант НЕ удалён. Org=${tenant.orgId} Person=${tenant.personId}.`);
      log(`  Дальше: триггернуть персону (on-demand ask / cron) и спросить клона.`);
    } else {
      await teardownTenant(infra.prisma, tenant);
      log('✓ teardown синтетического тенанта готов');
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('clone-build-harness FAILED:', err);
    if (tenant && !cfg.keepTenant)
      await teardownTenant(infra.prisma, tenant).catch(() => undefined);
    process.exitCode = 1;
  } finally {
    await infra.close();
  }
}

void main();
