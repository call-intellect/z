import { writeFileSync } from 'node:fs';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { RedisService } from '../../src/common/redis/redis.service';
import { ConversationalIngestAdapter } from '../../src/modules/conversational/adapters/conversational-ingest.adapter';
import { ConversationalService } from '../../src/modules/conversational/conversational.service';
import { ClonesAdminService } from '../../src/modules/clones/services/clones-admin.service';
import { ExecutablePersonaBuildService } from '../../src/modules/knowledge-core/services/executable-persona-build.service';
import { RegulationConsolidatorService } from '../../src/modules/knowledge-core/services/regulation-consolidator.service';
import { RoleClonePersonaVersioningHandler } from '../../src/modules/knowledge-core/services/role-clone-persona-versioning.handler';
import { Specialist37Service } from '../../src/modules/knowledge-core/services/specialist-3-7-skill.service';
import { PersonsService } from '../../src/modules/persons/services/persons.service';
import { RolesDomainService } from '../../src/modules/roles-domain/services/roles-domain.service';
import { IssuesService } from '../../src/modules/tracker/services/issues.service';
import { ProjectsService } from '../../src/modules/tracker/services/projects.service';

import { assertNotProd, pseudoUlid, readConfig, sleep } from '../_lib/combat-harness';
import { createPrismaClient } from '../_lib/prisma';
import { ABSENT_FACTS, CLONES, STATUS_FACTS, type CloneDef } from './clone-seed-data';

const DAY_MS = 24 * 60 * 60_000;

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

function requireOrg(): string {
  const org = process.env['STRELA_ORG'];
  if (!org) throw new Error('STRELA_ORG не задан — пере-сей Стрелу и пропиши STRELA_ORG в .env');
  return org;
}

const REGULATIONS: Array<{ name: string; scopeKey: 'support-role' | 'org'; body: string }> = [
  { name: 'Регламент обработки обращений v2', scopeKey: 'support-role', body: 'Регламент обработки клиентских обращений v2. Первый ответ клиенту — в пределах 4 часов. Классификация по severity: критичные (блокирует работу клиента) эскалируются владельцу в тот же день. После инцидента — обязательный пост-мортем с правкой регламента.' },
  { name: 'Политика хранения данных клиентов', scopeKey: 'org', body: 'Данные клиентов хранятся только на серверах в РФ. [blocking] Нарушение недопустимо.' },
  { name: 'Рекомендация по тону общения', scopeKey: 'org', body: 'Рекомендуется вежливый тон в клиентской переписке. [advisory]' },
  { name: 'Рекомендация по код-ревью', scopeKey: 'org', body: 'Желательно ревью каждого PR вторым инженером. [advisory]' },
];

interface ChannelBMethod {
  methodId: string;
  title: string;
  answers: string[];
}

interface ChannelBClone {
  key: CloneDef['key'];
  bearer: string;
  methods: ChannelBMethod[];
}

const CHANNEL_B: ChannelBClone[] = [
  {
    key: 'ceo',
    bearer: 'Сергей',
    methods: [
      {
        methodId: 'ceo-data',
        title: 'Разобрать спор о раскатке фичи на всех',
        answers: [
          'Сначала я запросил разбивку метрики по когортам давности, а не общий средний показатель. Потом сравнил поведение внутри свежей и старой групп. Только увидев, что различие устойчиво, согласовал следующий шаг.',
          'Начал с того, что попросил разложить аудиторию на сегменты и показать метрику по каждому. Затем проверил, не прячет ли среднее провал в ядре. И уже после этого принял решение по цифрам, а не по настроению команды.',
          'Мой порядок был такой: собрать когортные данные, отсеять шум, сверить гипотезу с фактическим поведением сегмента. Решение подписал тогда, когда данные подтвердили эффект, а не раньше.',
        ],
      },
      {
        methodId: 'ceo-nodeadline',
        title: 'Оценить срок по запросу партнёра',
        answers: [
          'Первым делом я отказался называть дату вслепую. Снял замеры на пробном прогоне узкого объёма, оценил зависимости и только по факту измерений дал коммит по сроку.',
          'Порядок был: не давать цифру сходу, прогнать пробный батч, измерить реальную скорость и узкие места, и уже из замеров вывести реалистичный срок с запасом.',
          'Я взял паузу вместо мгновенной оценки: сначала измерил, сколько реально занимает шаг на малом объёме, потом экстраполировал и назвал дату, которую готов защищать.',
        ],
      },
      {
        methodId: 'ceo-pilot',
        title: 'Подготовить запуск новой механики',
        answers: [
          'Я запланировал сначала обкатку на узкой группе, замер эффекта на ней, и лишь при подтверждении — общую раскатку. Пилот дешевле отката, поэтому широко без него не иду.',
          'Шаги: выбрать небольшой сегмент, включить механику только на нём, снять метрику, сравнить с контролем. Раскатываю на всех только после зелёного пилота.',
          'Начал с пилота на одном сегменте, чтобы поймать проблему до того, как её увидят все. Замерил, поправил, и только затем расширил охват.',
        ],
      },
      {
        methodId: 'ceo-retention',
        title: 'Сформировать приоритеты квартала',
        answers: [
          'Я отсортировал инициативы по влиянию на удержание когорт. То, что не двигает retention, ушло вниз списка, даже если выглядело эффектно. Сначала латаем дно, потом наливаем сверху.',
          'Критерий приоритизации был один — эффект на удержание. Прогнал каждую идею через вопрос «двигает ли она retention», и по ответу расставил порядок работ.',
          'Порядок задач я вывел из retention-эффекта: рост без удержания — ведро с дырками, поэтому наверх встало то, что удерживает ядро.',
        ],
      },
    ],
  },
  {
    key: 'integrator',
    bearer: 'Михаил',
    methods: [
      {
        methodId: 'int-logs',
        title: 'Упал синк с внешней системой',
        answers: [
          'Я не полез сразу в код: поднял логи за окно сбоя, нашёл первую ошибку по времени, проследил цепочку до корня. Только определив причину, стал чинить, а не лечить симптом.',
          'Порядок был: собрать логи и метрики за период инцидента, локализовать первопричину по трассе, и лишь потом трогать код. Фикс без диагноза — лотерея, так не работаю.',
          'Начал с диагностики по данным, а не с гипотез: прочитал логи, сопоставил с метриками, вычислил корневую ошибку. Причина найдена — тогда фикс.',
        ],
      },
      {
        methodId: 'int-backoff',
        title: 'Внешний API отдаёт 429 на массовом обмене',
        answers: [
          'Раз душат по частоте — я поставил exponential backoff с джиттером вместо ретрая в лоб. Пауза растёт по нарастающей, лимит не долбится, обмен доходит до конца.',
          'Мой ответ на 429 — не бить повторами сразу, а наращивать задержку экспоненциально с разбросом. Так внешняя система не блокирует, а синк устаивается.',
          'Ввёл backoff по экспоненте: на каждую ошибку лимита увеличиваю паузу, добавляю джиттер, чтобы не бить синхронно. Это снимает 429 и не теряет данные.',
        ],
      },
      {
        methodId: 'int-monitor',
        title: 'Закрыть задачу по починке интеграции',
        answers: [
          'После фикса я повесил алерт на частоту ошибок и дашборд, чтобы увидеть регресс раньше клиента. Починку без наблюдаемости не считаю завершённой.',
          'Замкнул задачу мониторингом: метрика на ошибку, порог, оповещение. Пока нет наблюдаемости — задача открыта, даже если код исправлен.',
          'Порядок закрытия: поставить метрику, настроить алерт, проверить, что срабатывает. Только тогда фикс настоящий, а не «до следующего раза».',
        ],
      },
      {
        methodId: 'int-stage',
        title: 'Выкатить изменение интеграции',
        answers: [
          'Я прогнал изменение на стейдж-копии под нагрузкой, дождался зелёного результата и лишь потом выкатил в прод. Без обкатки выкат — ставка на удачу.',
          'Порядок: собрать на стейдже, воспроизвести боевой сценарий, проверить пределы, и только зелёный прогон едет в прод. Так у меня всегда.',
          'Сначала стейдж, потом прод — правило без исключений. Обкатал под нагрузкой, убедился, что не ломается, затем релиз.',
        ],
      },
    ],
  },
  {
    key: 'marketer',
    bearer: 'Дарья',
    methods: [
      {
        methodId: 'mkt-base',
        title: 'Подготовить крупную рассылку',
        answers: [
          'Первый шаг — чистка и валидация базы: удалила дубли, отсеяла невалидные адреса, проверила консент. Только по живой базе метрики честные, поэтому грязную не трогаю.',
          'Начала с прогона базы через валидацию: мёртвые контакты вон, дубли схлопнуты. Иначе слив бюджета и удар по репутации домена. Потом уже отправка.',
          'Порядок: выгрузить базу, вычистить невалидные и повторы, проверить свежесть, и лишь по очищенному списку готовить кампанию.',
        ],
      },
      {
        methodId: 'mkt-segment',
        title: 'Решить, кому и что отправлять',
        answers: [
          'Я не била по всей базе одним текстом: порезала на сегменты по поведению и подготовила релевантное сообщение под каждый. У разных групп разный триггер.',
          'Сначала сегментация по активности и интересам, затем оффер под сегмент. Общий текст на всех проигрывает адресному почти всегда.',
          'Порядок: определить сегменты, для каждого выбрать свой посыл, и только потом рассылка. Массовый одинаковый оффер я не отправляю.',
        ],
      },
      {
        methodId: 'mkt-ab',
        title: 'Проверить новую гипотезу оффера',
        answers: [
          'Прежде чем масштабировать, я запустила A/B на маленькой доле трафика, дождалась значимости и раскатала только победивший вариант. Интуиция без теста дороже теста.',
          'Порядок: сформулировать гипотезу, поставить A/B на небольшой выборке, дождаться статзначимости, масштабировать выигравший. Без теста широко не лью.',
          'Сначала контролируемый эксперимент на части аудитории, потом решение по данным. Проигравший вариант не масштабирую, даже если он мне нравился.',
        ],
      },
      {
        methodId: 'mkt-unit',
        title: 'Определить бюджет на новый канал',
        answers: [
          'Перед бюджетом я посчитала юнит-экономику канала: CAC против LTV. Если окупаемость не бьётся, канал закрыт, сколько в него ни лей.',
          'Порядок: собрать модель юнит-экономики, оценить CAC и LTV, проверить окупаемость до вливания денег, а не после. Бюджет даю только по сходящейся модели.',
          'Начала с расчёта окупаемости канала: сколько стоит клиент и сколько приносит. Открываю канал, только если LTV перекрывает CAC с запасом.',
        ],
      },
    ],
  },
  {
    key: 'support',
    bearer: 'Игорь',
    methods: [
      {
        methodId: 'sup-postmortem-i',
        title: 'Разобрать серьёзный инцидент в поддержке',
        answers: [
          'После инцидента я собрал пост-мортем: что произошло, почему проскочило, какой пункт регламента правим. Разбор без назначенных действий бесполезен, поэтому закрыл его конкретными правками.',
          'Порядок: зафиксировать факты инцидента, найти причину, назначить владельцев исправлений и внести правку в процесс. Эту практику пост-мортемов держу постоянно.',
          'Каждый серьёзный сбой закрываю разбором с действиями и правкой регламента. Без пост-мортема команда наступит на те же грабли.',
        ],
      },
      {
        methodId: 'sup-early',
        title: 'Обращение под риском срыва срока',
        answers: [
          'Я эскалировал не по факту просрочки, а при первом признаке риска. Как только увидел, что можем не уложиться, поднял тревогу сразу, а не когда SLA уже нарушен.',
          'Порядок: оценить риск срыва рано, при первом сигнале эскалировать вверх, не ждать нарушения. Тишина до просрочки для меня недопустима.',
          'Мой принцип — ранняя эскалация: риск просрочки поднимаю немедленно, чтобы успеть перераспределить силы до срыва.',
        ],
      },
      {
        methodId: 'sup-strict',
        title: 'Держать SLA при росте нагрузки',
        answers: [
          'При росте очереди я усилил смену заранее, на упреждение, а не после срыва срока. SLA для меня твёрдая граница, поэтому лучше перебдеть с ресурсом.',
          'Порядок: следить за длиной очереди, при её росте добавлять руки до того, как поплывёт срок. Просрочки не терплю, объяснять их клиенту не готов.',
          'Держу SLA жёстко: как только нагрузка растёт, укрепляю смену на упреждение. Ресурс дешевле сорванного обязательства.',
        ],
      },
    ],
  },
];

const CHANNELB_KNOBS: Array<{ key: string; value: unknown; category: string; section: string }> = [
  { key: 'tracker.methodCaptureMinComplexity', value: 0, category: 'ai', section: 'tracker' },
  { key: 'probe.semanticDedupEnabled', value: false, category: 'ai', section: 'probe' },
  { key: 'probe.coldStartModeHours', value: 0, category: 'ai', section: 'probe' },
  { key: 'probe.adaptiveFatigueEnabled', value: false, category: 'ai', section: 'probe' },
  { key: 'probe.rateLimitPerHour', value: 1000, category: 'ai', section: 'probe' },
  { key: 'probe.rateLimitPerDay', value: 1000, category: 'ai', section: 'probe' },
  { key: 'probe.dialogEnabled', value: false, category: 'ai', section: 'probe' },
];

interface PersonRec {
  personId: string;
  userId: string | null;
  name: string;
}

async function loadPeople(prisma: PrismaService, orgId: string): Promise<Map<string, PersonRec>> {
  const persons = await prisma.person.findMany({
    where: { tenantId: orgId, relationship: 'employee', deletedAt: null },
    select: { id: true, name: true, userId: true },
  });
  return new Map(persons.map((p) => [p.name, { personId: p.id, userId: p.userId, name: p.name }]));
}

async function ownerUserId(prisma: PrismaService, orgId: string): Promise<string> {
  const owner = await prisma.membership.findFirst({ where: { orgId, role: 'owner' }, select: { userId: true } });
  if (!owner) throw new Error(`owner membership не найден для org ${orgId}`);
  return owner.userId;
}

const TRANSLIT: Record<string, string> = { Михаил: 'mikhail', Дарья: 'darya', Игорь: 'igor', Елена: 'elena', Анна: 'anna', Александр: 'alex', Сергей: 'sergey' };

async function ensureUserForEmployee(prisma: PrismaService, orgId: string, rec: PersonRec, tag: string): Promise<string> {
  if (rec.userId) return rec.userId;
  const slug = TRANSLIT[rec.name] ?? `emp${rec.personId.slice(0, 6)}`;
  const user = await prisma.user.create({ data: { email: `${slug}.${tag}@stand.test`, name: rec.name, role: 'user', signupSource: 'standalone' } });
  await prisma.membership.create({ data: { orgId, userId: user.id, role: 'manager' } });
  await prisma.person.update({ where: { id: rec.personId }, data: { userId: user.id } });
  log(`  + user ${rec.name} → ${user.id.slice(0, 10)} (membership manager, person linked)`);
  return user.id;
}

type AppCtx = Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;

async function modePrepare(app: AppCtx, orgId: string): Promise<void> {
  const prisma = app.get(PrismaService);
  const roles = app.get(RolesDomainService);
  const persons = app.get(PersonsService);
  const clonesAdmin = app.get(ClonesAdminService);
  const owner = await ownerUserId(prisma, orgId);
  const people = await loadPeople(prisma, orgId);
  const tag = orgId.slice(-6);

  log('=== prepare: users для носителей клонов ===');
  for (const name of ['Михаил', 'Дарья', 'Игорь', 'Елена']) {
    const rec = people.get(name);
    if (!rec) throw new Error(`employee ${name} не найден в org ${orgId}`);
    await ensureUserForEmployee(prisma, orgId, rec, tag);
  }

  log('=== prepare: роли + первичное назначение ===');
  const initialBearer: Record<string, string> = { ceo: 'Сергей', integrator: 'Михаил', marketer: 'Дарья', support: 'Елена' };
  let supportRoleId = '';
  for (const c of CLONES) {
    const existing = await prisma.role.findFirst({ where: { tenantId: orgId, name: c.roleName, deletedAt: null }, select: { id: true } });
    const roleId = existing?.id ?? (await roles.create({ tenantId: orgId, userId: owner, body: { name: c.roleName } })).id;
    if (c.key === 'support') supportRoleId = roleId;
    const bearer = people.get(initialBearer[c.key] ?? '');
    if (bearer) await persons.update({ tenantId: orgId, userId: owner, id: bearer.personId, body: { roleId } });
    log(`  role «${c.roleName}» → ${roleId.slice(0, 10)} bearer=${initialBearer[c.key]}`);
  }

  log('=== prepare: регламенты ===');
  const consolidator = app.get(RegulationConsolidatorService);
  const cons = await consolidator.consolidateTenant(orgId, 1000);
  log(`  консолидация: merged=${cons.merged} scanned=${cons.scanned}`);
  for (const r of REGULATIONS) {
    const exists = await prisma.regulation.findFirst({ where: { tenantId: orgId, name: r.name }, select: { id: true } });
    if (exists) { log(`  regulation «${r.name}» уже есть`); continue; }
    const scope = r.scopeKey === 'support-role' ? `role:${supportRoleId}` : 'org';
    await prisma.regulation.create({ data: { tenantId: orgId, name: r.name, contentMd: r.body, scope } });
    log(`  + regulation «${r.name}» (${scope})`);
  }

  log('=== prepare: CloneAccessGrant владельцу ===');
  for (const c of CLONES) {
    const role = await prisma.role.findFirst({ where: { tenantId: orgId, name: c.roleName, deletedAt: null }, select: { id: true } });
    if (role) await clonesAdmin.createAccessGrant({ tenantId: orgId, actorUserId: owner, dto: { grantedToUserId: owner, cloneType: 'role', cloneRefId: role.id, expiresAt: null } }).catch((e: unknown) => log(`  grant role ${c.key} skip: ${(e as Error).message}`));
  }
  for (const name of ['Сергей', 'Михаил', 'Дарья', 'Игорь']) {
    const rec = people.get(name);
    if (rec) await clonesAdmin.createAccessGrant({ tenantId: orgId, actorUserId: owner, dto: { grantedToUserId: owner, cloneType: 'person', cloneRefId: rec.personId, expiresAt: null } }).catch((e: unknown) => log(`  grant person ${name} skip: ${(e as Error).message}`));
  }
  log('✓ prepare готов');
}

async function modeChannelA(app: AppCtx, orgId: string): Promise<void> {
  const prisma = app.get(PrismaService);
  const adapter = app.get(ConversationalIngestAdapter);
  const people = await loadPeople(prisma, orgId);
  log('=== channelA: reasoning через notification_response (детерминированная атрибуция) ===');
  let injected = 0;
  for (const c of CLONES) {
    for (const b of c.bearers) {
      const rec = people.get(b.name);
      if (!rec?.userId) { log(`  ! ${b.name} без userId (запусти prepare), пропуск`); continue; }
      let cnt = 0;
      for (const m of b.methods) {
        for (const fm of m.formulations) {
          await adapter.ingestNotificationResponse({
            tenantId: orgId,
            userId: rec.userId,
            notificationId: pseudoUlid(),
            eventType: 'probe.question',
            questionText: m.question,
            payload: { text: fm.text },
            signalTypeHint: 'reasoning',
            occurredAt: new Date(Date.now() - fm.daysAgo * DAY_MS),
          });
          injected++;
          cnt++;
          await sleep(150);
        }
      }
      log(`  ${b.name}: ${cnt} reasoning-ответов вброшено`);
    }
  }
  log(`✓ channelA: ${injected} reasoning-ответов вброшено (обработка идёт воркерами)`);
}

async function modeBuild(app: AppCtx, orgId: string): Promise<void> {
  const prisma = app.get(PrismaService);
  const specialist = app.get(Specialist37Service);
  const builder = app.get(ExecutablePersonaBuildService);
  const versioning = app.get(RoleClonePersonaVersioningHandler);
  const persons = app.get(PersonsService);
  const owner = await ownerUserId(prisma, orgId);
  const people = await loadPeople(prisma, orgId);

  log('=== build: getOrCreateForPerson (профили всем носителям) ===');
  const targetNames = ['Сергей', 'Михаил', 'Дарья', 'Игорь', 'Елена'];
  for (const name of targetNames) {
    const rec = people.get(name);
    if (!rec) continue;
    const sp = await specialist.getOrCreateForPerson({ tenantId: orgId, personId: rec.personId });
    log(`  ${name}: profile=${sp ? sp.id.slice(0, 10) : '— null —'}`);
  }

  log('=== build: rebuild skill-профилей (синхронно, в обход очереди) ===');
  const profiles = await prisma.skillProfile.findMany({ where: { tenantId: orgId }, select: { id: true, personId: true } });
  for (const p of profiles) {
    await specialist.rebuildProfile({ profileId: p.id });
    const cnt = await prisma.skillTrait.count({ where: { profileId: p.id, status: { in: ['pending_verification', 'active'] } } });
    log(`  rebuilt ${p.id.slice(0, 8)}: traits(pending+active)=${cnt}`);
  }

  log('=== build: verify pending-черт ===');
  const v = await specialist.verifyPendingTraits(300);
  log(`  verify: checked=${v.checked} promoted=${v.promoted} held=${v.held}`);

  const freshProfiles = await prisma.skillProfile.findMany({ where: { tenantId: orgId }, select: { id: true, personId: true } });
  log('=== build: buildForProfile (person-клоны) ===');
  for (const p of freshProfiles) {
    const built = await builder.buildForProfile({ profileId: p.id, triggerReason: 'on_demand' }).catch((e: unknown) => { log(`  buildForProfile ${p.id.slice(0, 8)} skip: ${(e as Error).message}`); return null; });
    if (built) log(`  person persona ${p.personId.slice(0, 8)} → ${built.id.slice(0, 8)} status=${String(built.status)}`);
  }

  log('=== build: buildForRole (role-клоны) ===');
  for (const c of CLONES) {
    const role = await prisma.role.findFirst({ where: { tenantId: orgId, name: c.roleName, deletedAt: null }, select: { id: true } });
    if (!role) continue;
    const built = await builder.buildForRole({ tenantId: orgId, roleId: role.id, triggerReason: 'on_demand' }).catch((e: unknown) => { log(`  buildForRole ${c.key} skip: ${(e as Error).message}`); return null; });
    if (built) log(`  role persona ${c.key} → ${built.id.slice(0, 8)} v${built.roleVersion ?? '?'} status=${String(built.status)}`);
  }

  log('=== build: смена носителя support Елена→Игорь ===');
  const supportRole = await prisma.role.findFirst({ where: { tenantId: orgId, name: 'Руководитель поддержки', deletedAt: null }, select: { id: true } });
  const elena = people.get('Елена');
  const igor = people.get('Игорь');
  if (supportRole && elena && igor) {
    await persons.update({ tenantId: orgId, userId: owner, id: igor.personId, body: { roleId: supportRole.id } });
    await persons.update({ tenantId: orgId, userId: owner, id: elena.personId, body: { roleId: null } }).catch(() => undefined);
    const newPersonaId = await versioning.handle({ tenantId: orgId, roleId: supportRole.id, oldPersonId: elena.personId, newPersonId: igor.personId, changedAt: new Date() });
    log(`  bearer change → versioning: newPersona=${newPersonaId ? newPersonaId.slice(0, 8) : 'null'}`);
  } else {
    log('  ! support role / Елена / Игорь не найдены — смена носителя пропущена');
  }
  log('✓ build готов');
}

const SKILL_SUBJECT_SIGNAL_TYPES = ['reasoning', 'rationale', 'decision_basis', 'methodology_step'];

function taskDesc(title: string, answerHint: string): string {
  const base = `По задаче «${title}» уже была переписка с уточнениями и промежуточными шагами. Нужно зафиксировать подход исполнителя по шагам для передачи в базу знаний команды: как именно решалась задача, в каком порядке, на что опирался. Контекст: ${answerHint}. Приоритет высокий, работа заняла несколько дней, есть активность в комментариях.`;
  return base.length >= 290 ? base : `${base} ${'Требуется подробный разбор метода. '.repeat(3)}`.slice(0, 700);
}

async function cleanProbeRedis(redis: RedisService, orgId: string, userId: string): Promise<void> {
  const patterns = [
    `probe:dedup:${orgId}:*`,
    `probe:cooldown:${orgId}:*`,
    `probe:ratelimit:${userId}:*`,
    `probe:engagement:${userId}`,
  ];
  for (const p of patterns) {
    const keys = await redis.client.keys(p);
    if (keys.length > 0) await redis.client.del(...keys);
  }
}

interface ProbeState {
  status: string;
  dispatchedNotificationId: string | null;
}

async function pollProbeDispatched(
  prisma: PrismaService,
  orgId: string,
  issueId: string,
  timeoutMs: number,
): Promise<ProbeState | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ev = await prisma.probeEvent.findFirst({
      where: { tenantId: orgId, reason: 'task.method_capture', payload: { path: ['contextCardId'], equals: issueId } },
      select: { status: true, dispatchedNotificationId: true },
      orderBy: { createdAt: 'desc' },
    });
    if (ev) {
      if (ev.status === 'dispatched' && ev.dispatchedNotificationId) return ev;
      if (ev.status !== 'pending') return ev;
    }
    await sleep(700);
  }
  return null;
}

async function modeConfigure(orgId: string): Promise<void> {
  const prisma = createPrismaClient();
  try {
    log('=== configure: knobs Канала Б (глобально в dev-БД, до boot) ===');
    for (const k of CHANNELB_KNOBS) {
      await prisma.adminSetting.upsert({
        where: { key: k.key },
        update: { value: k.value as never },
        create: { key: k.key, value: k.value as never, category: k.category, section: k.section, severity: 'medium' },
      });
      log(`  ${k.key} = ${JSON.stringify(k.value)}`);
    }
    log(`✓ configure готов (orgId=${orgId})`);
  } finally {
    await prisma.$disconnect();
  }
}

async function modeChannelB(app: AppCtx, orgId: string): Promise<void> {
  const prisma = app.get(PrismaService);
  const issues = app.get(IssuesService);
  const projects = app.get(ProjectsService);
  const conv = app.get(ConversationalService);
  const redis = app.get(RedisService);
  const owner = await ownerUserId(prisma, orgId);
  const people = await loadPeople(prisma, orgId);

  const projectId = await projects.ensureInboxProjectId(orgId);
  if (!projectId) throw new Error('ensureInboxProjectId вернул null (нет owner?)');

  const limit = Number(process.env['CHANNELB_LIMIT'] ?? '0');
  log(`=== channelB: задача → probe method_capture → ответ (limit=${limit || 'все'}) ===`);

  const startedAt = new Date();
  const funnel = { closed: 0, dispatched: 0, dropped: {} as Record<string, number>, answered: 0, notDispatched: 0 };

  let total = 0;
  for (const c of CHANNEL_B) {
    const rec = people.get(c.bearer);
    if (!rec?.userId) { log(`  ! ${c.bearer} без userId — пропуск клона ${c.key}`); continue; }
    let cloneAnswered = 0;
    for (const m of c.methods) {
      for (const answer of m.answers) {
        if (limit > 0 && total >= limit) break;
        total++;
        const title = `${m.title} #${total}`;
        const issue = await issues.create(
          projectId,
          { title, descriptionStripped: taskDesc(m.title, answer.slice(0, 60)), priority: 'high', assigneeUserIds: [rec.userId], sortOrder: 0, labelIds: [] },
          orgId,
          owner,
        );
        await cleanProbeRedis(redis, orgId, rec.userId);
        await issues.transitionToCategory(issue.id, 'completed', orgId, owner);
        funnel.closed++;
        const probe = await pollProbeDispatched(prisma, orgId, issue.id, 30_000);
        if (!probe) { funnel.notDispatched++; log(`  · ${title}: probe не появился за 30с`); continue; }
        if (probe.status !== 'dispatched' || !probe.dispatchedNotificationId) {
          funnel.dropped[probe.status] = (funnel.dropped[probe.status] ?? 0) + 1;
          log(`  · ${title}: probe ${probe.status} (не dispatched)`);
          continue;
        }
        funnel.dispatched++;
        await conv
          .respondToProbe({ notificationId: probe.dispatchedNotificationId, userId: rec.userId, payload: { text: answer } })
          .then(() => { funnel.answered++; cloneAnswered++; })
          .catch((e: unknown) => log(`  · ${title}: respondToProbe FAIL ${(e as Error).message}`));
        await sleep(300);
      }
      if (limit > 0 && total >= limit) break;
    }
    log(`  ${c.key}/${c.bearer}: ответов дано ${cloneAnswered}`);
    if (limit > 0 && total >= limit) break;
  }

  log('=== channelB: воронка (до дренажа ингеста) ===');
  log(`  задач закрыто: ${funnel.closed}`);
  log(`  probe задиспатчено: ${funnel.dispatched} (${funnel.closed ? Math.round((funnel.dispatched / funnel.closed) * 100) : 0}%)`);
  log(`  probe не задиспатчено (таймаут): ${funnel.notDispatched}`);
  log(`  probe drop-статусы: ${JSON.stringify(funnel.dropped)}`);
  log(`  ответов дано: ${funnel.answered}`);

  const blocks = await prisma.ideaBlock.count({
    where: { tenantId: orgId, signalType: { in: SKILL_SUBJECT_SIGNAL_TYPES as never }, createdAt: { gte: startedAt } },
  });
  log(`  клон-блоков создано пока (растёт по мере ингеста): ${blocks}`);
  log('✓ channelB готов (ингест ответов идёт воркерами; окончательную воронку смотри в status после дренажа)');
}

async function modeStatus(prisma: PrismaService, orgId: string): Promise<void> {
  log(`=== status: клон-готовность org ${orgId} ===`);
  const people = await loadPeople(prisma, orgId);
  for (const c of CLONES) {
    for (const b of c.bearers) {
      const rec = people.get(b.name);
      if (!rec) continue;
      const sp = await prisma.skillProfile.findFirst({ where: { tenantId: orgId, personId: rec.personId }, select: { id: true, status: true } });
      const traits = sp ? await prisma.skillTrait.count({ where: { profileId: sp.id, status: 'active' } }) : 0;
      const pending = sp ? await prisma.skillTrait.count({ where: { profileId: sp.id, status: 'pending_verification' } }) : 0;
      log(`  ${c.key}/${b.name}: profile=${sp ? String(sp.status) : '—'} activeTraits=${traits} pending=${pending}`);
    }
    const role = await prisma.role.findFirst({ where: { tenantId: orgId, name: c.roleName, deletedAt: null }, select: { id: true } });
    if (role) {
      const personas = await prisma.executablePersona.findMany({ where: { tenantId: orgId, scope: 'role', scopeRefId: role.id }, select: { roleVersion: true, status: true, includedTraitIds: true }, orderBy: { roleVersion: 'desc' } });
      log(`    role «${c.roleName}» personas: ${personas.map((p) => `v${p.roleVersion ?? '?'}/${String(p.status)}(${p.includedTraitIds.length}черт)`).join('; ') || '—'}`);
    }
    const personPersonas = await prisma.executablePersona.count({ where: { tenantId: orgId, scope: 'person' } });
    void personPersonas;
  }
  const personaCount = await prisma.executablePersona.count({ where: { tenantId: orgId, scope: 'person' } });
  log(`  person-персон всего: ${personaCount}`);
}

async function modeManifest(prisma: PrismaService, orgId: string): Promise<void> {
  const manifest = {
    _meta: {
      tenant: orgId,
      generatedFor: 'clone-stand baseline',
      note: 'Методы = ground truth по построению (посеяны Каналом А). Ожидаемые ЧЕРТЫ выводятся слепой разметкой в Слое 0 (layer0-annotate), НЕ копируются отсюда (правило №1).',
    },
    clones: CLONES.map((c) => ({
      key: c.key,
      role: c.roleName,
      bearers: c.bearers.map((b) => ({
        name: b.name,
        methods: b.methods.map((m) => ({ id: m.id, gist: m.gist, formulations: m.formulations.length, daysAgoSpread: m.formulations.map((x) => x.daysAgo) })),
      })),
    })),
    statusFacts: STATUS_FACTS,
    absentFacts: ABSENT_FACTS,
  };
  const path = `${process.cwd()}/../docs/testing/clone-feed-manifest.json`;
  writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf8');
  const methodCount = CLONES.reduce((a, c) => a + c.bearers.reduce((b2, b) => b2 + b.methods.length, 0), 0);
  log(`✓ manifest → docs/testing/clone-feed-manifest.json (${methodCount} методов, ${STATUS_FACTS.length} statusFacts, ${ABSENT_FACTS.length} absentFacts)`);
  void prisma;
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'status';
  const orgId = requireOrg();
  assertNotProd(readConfig());

  if (mode === 'configure') {
    await modeConfigure(orgId);
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const prisma = app.get(PrismaService);
    switch (mode) {
      case 'prepare': await modePrepare(app, orgId); break;
      case 'channelA': await modeChannelA(app, orgId); break;
      case 'channelB': await modeChannelB(app, orgId); break;
      case 'build': await modeBuild(app, orgId); break;
      case 'status': await modeStatus(prisma, orgId); break;
      case 'manifest': await modeManifest(prisma, orgId); break;
      default: throw new Error(`неизвестный режим: ${mode} (configure|prepare|channelA|channelB|build|status|manifest)`);
    }
  } finally {
    await Promise.race([app.close(), sleep(5000)]);
  }
}

main().then(() => process.exit(0)).catch((e: unknown) => { // eslint-disable-next-line no-console
  console.error(e); process.exit(1); });
