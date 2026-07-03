import { createPrismaClient } from '../_lib/prisma';

const STRELA = process.env['STRELA_ORG'] ?? 'cmr1qbvpx0001pwbwxbgmh1jl';
const PREFIX = 'QA-стенд:';

const prisma = createPrismaClient();

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3600_000);
}

async function seedDocumentR1(uploaderPersonId: string): Promise<void> {
  const name = `${PREFIX} Памятка выгрузки сегментов (не привязана к процессу)`;
  const existing = await prisma.document.findFirst({
    where: { tenantId: STRELA, name, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    log(`R1 document: уже есть (${existing.id})`);
    return;
  }
  const doc = await prisma.document.create({
    data: {
      tenantId: STRELA,
      uploaderId: uploaderPersonId,
      kind: 'markdown',
      name,
      mimeType: 'text/markdown',
      originalSize: 512,
      parsedText: 'Как выгружать сегменты контактов для рассылок: фильтры, форматы, ответственные.',
      status: 'parsed',
    },
    select: { id: true },
  });
  log(`R1 document: создан (${doc.id})`);
}

async function seedProcessStepsR2R3(): Promise<void> {
  const process = await prisma.process.findFirst({
    where: { tenantId: STRELA },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });
  if (!process) {
    log('R2/R3: в Стреле нет процессов — пропуск');
    return;
  }
  const stepNames = [
    `${PREFIX} Согласовать доступ к выгрузке`,
    `${PREFIX} Передать сегмент в рассылку`,
  ];
  const existing = await prisma.processStep.count({
    where: { tenantId: STRELA, processId: process.id, name: { in: stepNames } },
  });
  if (existing >= stepNames.length) {
    log(`R2/R3 process_steps: уже есть (${existing})`);
    return;
  }
  const maxOrder = await prisma.processStep.aggregate({
    where: { processId: process.id },
    _max: { order: true },
  });
  let order = (maxOrder._max.order ?? 0) + 100;
  for (const name of stepNames) {
    await prisma.processStep.create({
      data: { tenantId: STRELA, processId: process.id, name, order },
    });
    order += 1;
  }
  log(`R2/R3 process_steps: создано 2 шага в «${process.name}»`);
}

async function seedResponsibilityR4R5(): Promise<void> {
  const roleName = `${PREFIX} Руководитель клиентского сервиса`;
  let role = await prisma.role.findFirst({
    where: { tenantId: STRELA, name: roleName, deletedAt: null },
    select: { id: true },
  });
  role ??= await prisma.role.create({
    data: { tenantId: STRELA, name: roleName },
    select: { id: true },
  });
  const elements = [
    { kind: 'outcome', name: `${PREFIX} Удержание ключевых клиентов` },
    { kind: 'function', name: `${PREFIX} Разбор эскалаций поддержки` },
  ];
  let created = 0;
  for (const el of elements) {
    const exists = await prisma.responsibilityElement.findFirst({
      where: { tenantId: STRELA, roleId: role.id, name: el.name, deletedAt: null },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.responsibilityElement.create({
      data: { tenantId: STRELA, roleId: role.id, kind: el.kind, name: el.name },
    });
    created += 1;
  }
  log(`R4/R5 role+elements: роль ${role.id}, новых элементов ${created}`);
}

async function seedIntakeDueDateMissing(assigneeUserId: string): Promise<void> {
  const title = `${PREFIX} Согласовать SLA с Логистик Плюс`;
  const existing = await prisma.intakeIssue.findFirst({
    where: { tenantId: STRELA, extractedTitle: title, status: 'pending' },
    select: { id: true },
  });
  if (existing) {
    log(`due_date_missing intake: уже есть (${existing.id})`);
    return;
  }
  const intake = await prisma.intakeIssue.create({
    data: {
      tenantId: STRELA,
      status: 'pending',
      source: 'meeting',
      rawContent:
        'Надо согласовать SLA с Логистик Плюс до конца месяца, берёт Сергей. Срок пока не назвали.',
      extractedTitle: title,
      extractedDescription: 'Согласовать SLA с клиентом Логистик Плюс, ответственный определён.',
      suggestedAssigneeId: assigneeUserId,
      suggestedDueDate: null,
      createdAt: hoursAgo(30),
    },
    select: { id: true },
  });
  log(`due_date_missing intake: создан (${intake.id}), возраст 30ч, исполнитель есть, срока нет`);
}

async function seedMethodCaptureIssue(assigneeUserId: string): Promise<void> {
  const title = `${PREFIX} Мигрировать базу контактов на новую схему сегментации`;
  const existing = await prisma.issue.findFirst({
    where: { tenantId: STRELA, title, deletedAt: null, completedAt: null },
    select: { id: true },
  });
  if (existing) {
    log(`method-capture issue: уже есть (${existing.id})`);
    return;
  }
  const project = await prisma.issue.groupBy({
    by: ['projectId'],
    where: { tenantId: STRELA, deletedAt: null },
    _count: { projectId: true },
    orderBy: { _count: { projectId: 'desc' } },
    take: 1,
  });
  const projectId = project[0]?.projectId;
  if (!projectId) {
    log('method-capture issue: нет проекта — пропуск');
    return;
  }
  const startedState = await prisma.issueState.findFirst({
    where: { projectId, category: 'started' },
    select: { id: true },
  });
  const maxSeq = await prisma.issue.aggregate({
    where: { projectId },
    _max: { sequenceId: true },
  });
  const seq = Math.max((maxSeq._max.sequenceId ?? 0) + 1, 900);
  const sample = await prisma.issue.findFirst({
    where: { projectId },
    select: { identifier: true },
  });
  const idPrefix = sample?.identifier.replace(/-\d+$/, '') ?? 'QA';
  const description = [
    'Перенести всю базу контактов на новую схему сегментации: выгрузить текущие сегменты,',
    'провести маппинг полей на новую модель, прогнать дедупликацию, синхронизировать',
    'результат с рассылками и CRM, проверить целостность на контрольной выборке из 500',
    'контактов и подготовить короткий регламент, как поддерживать сегменты дальше.',
    'Отдельно согласовать с маркетингом, какие сегменты замораживаем как архивные.',
  ].join(' ');
  const issue = await prisma.issue.create({
    data: {
      tenantId: STRELA,
      projectId,
      identifier: `${idPrefix}-${seq}`,
      sequenceId: seq,
      title,
      description,
      descriptionStripped: description,
      priority: 'urgent',
      stateId: startedState?.id ?? null,
      createdById: assigneeUserId,
      createdAt: hoursAgo(8 * 24),
      assignees: { create: { userId: assigneeUserId } },
    },
    select: { id: true, identifier: true },
  });
  log(`method-capture issue: создан ${issue.identifier} (${issue.id}), urgent, desc ${description.length} симв., возраст 8 дн, исполнитель есть`);
}

async function main(): Promise<void> {
  const org = await prisma.org.findFirst({ where: { id: STRELA }, select: { id: true } });
  if (!org) throw new Error(`Стрела ${STRELA} не найдена в локальной БД`);
  const person = await prisma.person.findFirst({
    where: { tenantId: STRELA, userId: { not: null } },
    select: { id: true, userId: true, name: true },
  });
  if (!person?.userId) throw new Error('в Стреле нет Person с userId');
  log(`Стрела: ${STRELA}, персона-исполнитель: ${person.name} (person=${person.id}, user=${person.userId})`);

  await seedDocumentR1(person.id);
  await seedProcessStepsR2R3();
  await seedResponsibilityR4R5();
  await seedIntakeDueDateMissing(person.userId);
  await seedMethodCaptureIssue(person.userId);
}

void main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    process.stderr.write(`seed-fixtures FAIL: ${err instanceof Error ? err.stack : String(err)}\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
