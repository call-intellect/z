import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { ConversationalIngestAdapter } from '../../src/modules/conversational/adapters/conversational-ingest.adapter';
import { ClonesAdminService } from '../../src/modules/clones/services/clones-admin.service';
import { ExecutablePersonaBuildService } from '../../src/modules/knowledge-core/services/executable-persona-build.service';
import { RegulationConsolidatorService } from '../../src/modules/knowledge-core/services/regulation-consolidator.service';
import { RoleClonePersonaVersioningHandler } from '../../src/modules/knowledge-core/services/role-clone-persona-versioning.handler';
import { Specialist37Service } from '../../src/modules/knowledge-core/services/specialist-3-7-skill.service';
import { PersonsService } from '../../src/modules/persons/services/persons.service';
import { RolesDomainService } from '../../src/modules/roles-domain/services/roles-domain.service';

import { assertNotProd, pseudoUlid, readConfig, sleep } from '../_lib/combat-harness';

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

interface Formulation {
  daysAgo: number;
  text: string;
}

interface MethodDef {
  id: string;
  gist: string;
  question: string;
  formulations: Formulation[];
}

interface BearerDef {
  name: string;
  methods: MethodDef[];
}

interface CloneDef {
  key: 'ceo' | 'integrator' | 'marketer' | 'support';
  roleName: string;
  bearers: BearerDef[];
}

function f(daysAgo: number, text: string): Formulation {
  return { daysAgo, text };
}

const CLONES: CloneDef[] = [
  {
    key: 'ceo',
    roleName: 'Генеральный директор',
    bearers: [
      {
        name: 'Сергей',
        methods: [
          {
            id: 'ceo-data',
            gist: 'Решения по данным и когортам, не по средним и не по ощущениям',
            question: 'Как ты принимаешь продуктовые и стратегические решения?',
            formulations: [
              f(47, 'Я не смотрю на средний чек — среднее врёт. Разбиваю на когорты по давности и смотрю поведение внутри группы, только тогда решаю.'),
              f(33, 'Решение о раскатке я принимаю по цифрам когорт, а не по ощущению команды: ощущения обманывают, данные — нет.'),
              f(19, 'Когда спорят «на глаз», я прошу разложить по сегментам и показать метрику — без когортных данных я решение не подписываю.'),
              f(6, 'Средние прячут провалы: я всегда смотрю распределение и когорты, иначе можно радоваться среднему при мёртвом ядре.'),
            ],
          },
          {
            id: 'ceo-nodeadline',
            gist: 'Не называет срок без замеров и пробного прогона',
            question: 'Почему ты не называешь сроки сразу, когда просят оценку?',
            formulations: [
              f(45, 'Я принципиально не даю срок, пока мы не сняли замеры на пробном прогоне — иначе это гадание, а не оценка.'),
              f(31, 'Меня обжигали оценки без замеров, поэтому теперь: сначала метрики и пробный батч, потом коммит по дате.'),
              f(18, 'Когда просят срок здесь и сейчас, я беру паузу: пока не измерил зависимости, любая цифра — фантазия.'),
            ],
          },
          {
            id: 'ceo-pilot',
            gist: 'Перед раскаткой обкатывает на узкой группе',
            question: 'Как ты относишься к раскатке новых функций на всех сразу?',
            formulations: [
              f(44, 'Прежде чем катить на всех, я запускаю на узкой группе и смотрю метрику — пилот дешевле отката.'),
              f(20, 'Новую механику сначала обкатаем на одном сегменте, замерим эффект, и только потом общая раскатка.'),
              f(7, 'Я не выкатываю широко без пилота: маленькая группа ловит проблему до того, как её увидят все.'),
            ],
          },
          {
            id: 'ceo-retention',
            gist: 'Приоритизирует по эффекту на удержание',
            question: 'Как ты расставляешь приоритеты в квартале?',
            formulations: [
              f(46, 'Приоритет ставлю по влиянию на удержание: если фича не двигает retention когорты, она уходит вниз, даже если красивая.'),
              f(32, 'Главный критерий для меня — удержание: всё, что не влияет на retention, я двигаю ниже по списку.'),
              f(5, 'Я приоритизирую через retention-эффект: рост без удержания — это ведро с дырками, сначала латаем дно.'),
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'integrator',
    roleName: 'Разработчик-интегратор',
    bearers: [
      {
        name: 'Михаил',
        methods: [
          {
            id: 'int-logs',
            gist: 'До фикса диагностирует по логам',
            question: 'С чего ты начинаешь, когда что-то сломалось в интеграции?',
            formulations: [
              f(45, 'Я не трогаю код, пока не прочитал логи — сначала нахожу причину по логам, потом чиню, иначе лечу симптом.'),
              f(28, 'Диагностику начинаю с логов и метрик, а не с гипотез: данные раньше догадок, так быстрее нахожу корень.'),
              f(12, 'Прежде чем править, я поднимаю логи за период сбоя и ищу первопричину — фикс без диагноза это лотерея.'),
            ],
          },
          {
            id: 'int-backoff',
            gist: 'На rate-limit ставит exponential backoff (опыт 429 Битрикс)',
            question: 'Как ты решаешь проблему, когда внешний API душит по частоте запросов?',
            formulations: [
              f(44, 'Когда Битрикс отдал 429 на массовом синке, я поставил exponential backoff с джиттером — душат по частоте, значит отступаем по нарастающей.'),
              f(27, 'Если внешняя система лимитирует по частоте, мой ответ — backoff по экспоненте, а не тупой ретрай в лоб.'),
              f(10, 'На 429 я не бью повторами сразу: наращиваю паузу экспоненциально с джиттером, так лимит не долбится и синк доходит.'),
            ],
          },
          {
            id: 'int-monitor',
            gist: 'После фикса вешает мониторинг/алерт',
            question: 'Что ты делаешь после того, как починил проблему?',
            formulations: [
              f(43, 'После того как починил синк, я сразу повесил алерт на частоту ошибок — фикс без мониторинга слепой.'),
              f(25, 'Любой фикс закрываю мониторингом: алерт на ошибку и дашборд, чтобы увидеть регресс раньше клиента.'),
              f(9, 'Я не считаю задачу закрытой без наблюдаемости: поставил метрику и алерт — тогда починка настоящая.'),
            ],
          },
          {
            id: 'int-stage',
            gist: 'Не выкатывает на прод без стейджа',
            question: 'Как ты относишься к выкату изменений сразу на прод?',
            formulations: [
              f(42, 'Я не выкачу такое на прод без прогона на стейдже — сначала стейдж под нагрузкой, потом прод.'),
              f(23, 'Стейдж обязателен: выкат без обкатки — это ставка на удачу, я так не работаю.'),
              f(5, 'Любое изменение интеграции я сперва гоняю на стейдж-копии, и только зелёный прогон едет в прод.'),
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'marketer',
    roleName: 'Маркетолог',
    bearers: [
      {
        name: 'Дарья',
        methods: [
          {
            id: 'mkt-base',
            gist: 'Перед кампанией чистит и валидирует базу',
            question: 'С чего ты начинаешь подготовку рассылки или кампании?',
            formulations: [
              f(44, 'Я не запускаю рассылку на грязную базу — сначала чищу дубли и валидирую адреса, иначе слив бюджета и репутации домена.'),
              f(30, 'Первый шаг любой кампании — валидация и чистка базы: на мёртвых контактах метрики врут.'),
              f(11, 'Перед стартом я всегда прогоняю базу через чистку: удаляю невалидные и дубли, только потом отправка.'),
            ],
          },
          {
            id: 'mkt-segment',
            gist: 'Сегментирует до рассылки, не бьёт по всем',
            question: 'Как ты решаешь, кому и что отправлять в кампании?',
            formulations: [
              f(43, 'Бить по всей базе одним сообщением — зря; я сегментирую по поведению и шлю релевантное каждому сегменту.'),
              f(17, 'Перед отправкой всегда режу базу на сегменты: у разных групп разный триггер, общий текст проигрывает.'),
              f(8, 'Я не делаю массовую рассылку одним оффером: сначала сегментация, потом сообщение под сегмент.'),
            ],
          },
          {
            id: 'mkt-ab',
            gist: 'Проверяет на A/B до масштабирования',
            question: 'Как ты проверяешь новую гипотезу перед масштабированием?',
            formulations: [
              f(42, 'Новый оффер я сначала гоняю на A/B на маленькой доле, и только победивший вариант масштабирую.'),
              f(24, 'Не масштабирую гипотезу без A/B: интуиция без теста часто дороже, чем сам тест.'),
              f(6, 'Прежде чем лить бюджет, я ставлю A/B на небольшой выборке и смотрю значимость, потом раскатка.'),
            ],
          },
          {
            id: 'mkt-unit',
            gist: 'Считает юнит-экономику канала до бюджета',
            question: 'Как ты решаешь, сколько бюджета дать на канал?',
            formulations: [
              f(41, 'Прежде чем заливать бюджет в канал, я считаю юнит-экономику: CAC против LTV, иначе это покупка убытка.'),
              f(22, 'Бюджет на канал даю только после расчёта юнит-экономики — окупаемость считаю до, а не после.'),
              f(7, 'Я не открываю канал без модели юнит-экономики: если LTV не бьёт CAC, канал закрыт, сколько ни лей.'),
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'support',
    roleName: 'Руководитель поддержки',
    bearers: [
      {
        name: 'Елена',
        methods: [
          {
            id: 'sup-severity',
            gist: 'Эскалирует по шкале severity',
            question: 'Как ты решаешь, какое обращение эскалировать и как срочно?',
            formulations: [
              f(48, 'Я эскалирую по severity: критичное, что блокирует работу клиента, уходит владельцу в тот же день, остальное — по очереди.'),
              f(32, 'Шкала severity — основа: я не даю команде решать на глаз, критичность определяет маршрут и срок.'),
              f(14, 'Каждое обращение я классифицирую по severity, и от класса зависит, кому и когда оно эскалируется.'),
            ],
          },
          {
            id: 'sup-sla4h',
            gist: 'Первый ответ клиенту в пределах 4 часов',
            question: 'Какой у вас норматив по времени первого ответа клиенту?',
            formulations: [
              f(46, 'Первый ответ клиенту мы обязаны дать в пределах четырёх часов — не решение, но живой контакт, чтобы человек не висел в тишине.'),
              f(30, 'Четыре часа на первый ответ — это не «когда получится», а обязательство; не успеваем — значит проблема в расстановке смен.'),
              f(12, 'SLA на первый отклик у нас четыре часа: клиент не должен ждать в пустоте дольше, даже если решение ещё в работе.'),
            ],
          },
          {
            id: 'sup-postmortem',
            gist: 'После инцидента проводит пост-мортем',
            question: 'Что ты делаешь после серьёзного сбоя или потерянного обращения?',
            formulations: [
              f(45, 'После каждого серьёзного сбоя я собираю пост-мортем: что произошло, почему проскочило, какой регламент меняем.'),
              f(28, 'Разбор инцидента без назначенных действий бесполезен — я закрываю пост-мортем конкретными правками в регламент.'),
              f(13, 'Потерянное обращение для меня повод для пост-мортема: без разбора причины оно повторится.'),
            ],
          },
        ],
      },
      {
        name: 'Игорь',
        methods: [
          {
            id: 'sup-postmortem-i',
            gist: 'Игорь: сохраняет практику пост-мортемов',
            question: 'Как ты работаешь с инцидентами в поддержке?',
            formulations: [
              f(20, 'Практику пост-мортемов я сохраняю: после инцидента разбираем причину и правим регламент, это работает.'),
              f(14, 'После сбоя обязательно собираю разбор с действиями — без пост-мортема команда наступает на те же грабли.'),
              f(6, 'Каждый серьёзный инцидент я закрываю пост-мортемом и правкой процесса, эту практику от Елены оставил.'),
            ],
          },
          {
            id: 'sup-early',
            gist: 'Игорь: эскалирует раньше — при первом риске SLA',
            question: 'В какой момент ты поднимаешь тревогу по обращению?',
            formulations: [
              f(19, 'Я эскалирую раньше: не жду, пока SLA нарушен, поднимаю тревогу уже при первом риске просрочки.'),
              f(11, 'Мой принцип — ранняя эскалация: риск нарушить SLA поднимаю сразу, тишина до просрочки недопустима.'),
              f(4, 'Как только вижу, что обращение может не уложиться в срок, я эскалирую немедленно, а не по факту срыва.'),
            ],
          },
          {
            id: 'sup-strict',
            gist: 'Игорь: держит SLA жёстче',
            question: 'Как ты управляешь нагрузкой, чтобы держать SLA?',
            formulations: [
              f(18, 'Я держу SLA жёстче: если очередь растёт, добавляю руки заранее, а не после срыва срока.'),
              f(10, 'SLA для меня твёрдая граница, не ориентир; лучше перебдеть с ресурсом, чем объяснять клиенту срыв.'),
              f(4, 'При росте нагрузки я усиливаю смену на упреждение, чтобы SLA не поплыл, — терпеть просрочки не готов.'),
            ],
          },
        ],
      },
    ],
  },
];

const STATUS_FACTS = [
  'База контактов НЕ актуализирована на текущий момент (чистка не завершена).',
  'Zoom: вхождение в roadmap Q3 выясняется, решение не принято.',
  'Контракт с «Логистик Плюс»: НЕ подписан (на стадии КП).',
  'Онбординг «Ромашки»: НЕ завершён, жалоба открыта.',
];

const ABSENT_FACTS = [
  'Регламента про работу в выходные — НЕТ.',
  'Регламента согласования КП — НЕТ.',
  'Регламента про подрядчиков — НЕТ.',
  'Прецедента выхода на новый рынок — НЕТ.',
];

const REGULATIONS: Array<{ name: string; scopeKey: 'support-role' | 'org'; body: string }> = [
  { name: 'Регламент обработки обращений v2', scopeKey: 'support-role', body: 'Регламент обработки клиентских обращений v2. Первый ответ клиенту — в пределах 4 часов. Классификация по severity: критичные (блокирует работу клиента) эскалируются владельцу в тот же день. После инцидента — обязательный пост-мортем с правкой регламента.' },
  { name: 'Политика хранения данных клиентов', scopeKey: 'org', body: 'Данные клиентов хранятся только на серверах в РФ. [blocking] Нарушение недопустимо.' },
  { name: 'Рекомендация по тону общения', scopeKey: 'org', body: 'Рекомендуется вежливый тон в клиентской переписке. [advisory]' },
  { name: 'Рекомендация по код-ревью', scopeKey: 'org', body: 'Желательно ревью каждого PR вторым инженером. [advisory]' },
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
    const bearer = people.get(initialBearer[c.key]);
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
    if (role) await clonesAdmin.createAccessGrant({ tenantId: orgId, actorUserId: owner, dto: { grantedToUserId: owner, cloneType: 'role', cloneRefId: role.id } }).catch((e: unknown) => log(`  grant role ${c.key} skip: ${(e as Error).message}`));
  }
  for (const name of ['Сергей', 'Михаил', 'Дарья', 'Игорь']) {
    const rec = people.get(name);
    if (rec) await clonesAdmin.createAccessGrant({ tenantId: orgId, actorUserId: owner, dto: { grantedToUserId: owner, cloneType: 'person', cloneRefId: rec.personId } }).catch((e: unknown) => log(`  grant person ${name} skip: ${(e as Error).message}`));
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
  await Bun.write(path, JSON.stringify(manifest, null, 2));
  const methodCount = CLONES.reduce((a, c) => a + c.bearers.reduce((b2, b) => b2 + b.methods.length, 0), 0);
  log(`✓ manifest → docs/testing/clone-feed-manifest.json (${methodCount} методов, ${STATUS_FACTS.length} statusFacts, ${ABSENT_FACTS.length} absentFacts)`);
  void prisma;
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'status';
  const orgId = requireOrg();
  assertNotProd(readConfig());

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const prisma = app.get(PrismaService);
    switch (mode) {
      case 'prepare': await modePrepare(app, orgId); break;
      case 'channelA': await modeChannelA(app, orgId); break;
      case 'build': await modeBuild(app, orgId); break;
      case 'status': await modeStatus(prisma, orgId); break;
      case 'manifest': await modeManifest(prisma, orgId); break;
      default: throw new Error(`неизвестный режим: ${mode} (prepare|channelA|build|status|manifest)`);
    }
  } finally {
    await Promise.race([app.close(), sleep(5000)]);
  }
}

main().then(() => process.exit(0)).catch((e: unknown) => { // eslint-disable-next-line no-console
  console.error(e); process.exit(1); });
