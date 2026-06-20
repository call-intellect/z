---
type: tz
status: ready-to-implement
feature: assistant-assign-task-to-others-and-notify
date: 2026-06-20
owner: Сергей (Владелец)
relates_to:
  - plans/analysis/2026-06-20-assistant-task-assignment-and-notify-and-confirm-text.md
  - plans/tz/2026-06-12-assistant-create-task-tool.md
  - plans/tz/2026-06-11-assistant-channels-telegram-max.md
---
> Анализ: `plans/analysis/2026-06-20-assistant-task-assignment-and-notify-and-confirm-text.md` · Решения владельца Р1–Р3 приняты 2026-06-20.

# Помощник: постановка задачи на другого сотрудника + уведомление в бот, и человекочитаемый текст подтверждения

## Принцип
Помощник умеет поставить задачу не только себе, но и на другого сотрудника по имени; этому сотруднику приходит человеческое уведомление в бот (а если бота нет — в кабинет). Текст подтверждения помощника — на русском, без технических ключей. **Никакой новой Prisma-модели**: переиспользуем `Issue`/`IssueAssignee` и существующий примитив доставки `ConversationalService.sendNotification`.

## Вне scope / отложено владельцем
- Согласование/право исполнителя ОТКЛОНИТЬ задачу (статус «предложена», возврат) — Р2 = «ставить может любой любому», без подтверждения исполнителя. vNext, если понадобится.
- Уведомление при назначении исполнителя **в момент generic-create** через обычный API/UI, который эмитит только `issue.created` без исполнителя в payload (см. §Граничные контракты). В v1 канонический триггер — `issue.assignee_changed action=added`; обогащение `issue.created` исполнителями — vNext.
- Назначение на отдел/группу (только на конкретного человека).
- Богатый выбор проекта при назначении — задача всегда падает в проект «Входящие» (как у self-task).

## Цель и зачем
**Болезненное состояние (по анализу, проверено кодом):**
1. Помощник **физически не умеет** ставить задачу на другого: `me-tasks.service.ts:50` жёстко `assigneeUserIds: [userId]`, эндпоинт «не принимает чужого исполнителя» (`me-tasks.controller.ts:41`). Имя коллеги попадает только в ТЕКСТ задачи → уведомлять некого.
2. Уведомления-при-назначении нет **нигде**: событие `issue.assignee_changed` слушает только граф знаний (`ingest/adapters/tracker/tracker.adapter.ts:78`), пуша исполнителю нет.
3. Текст подтверждения сыплет сырые англ. ключи: `buildConfirmPreview` (`concierge.service.ts:568`) клеит `` `${k}: ${v}` ``; `create_task` отсутствует в `CONFIRM_TOOL_RU_NAMES` (`concierge.service.ts:86`).

**Чем решение лучше:** запрос рядового «поставь задачу на Айназ» отрабатывает реально (Айназ становится исполнителем и узнаёт об этом в боте), а подтверждение читается как человеческая фраза.

## REALITY-CHECK (факт на 2026-06-20)
| Кусок | Статус по коду | Вывод для ТЗ |
|---|---|---|
| `create_task` → `POST /api/v1/me/tasks` → `createSelfTask` | Работает, исполнитель ВСЕГДА = автор (`me-tasks.service.ts:50`) | Не трогаем; добавляем ОТДЕЛЬНЫЙ путь назначения на другого |
| `issues.service.create` | Принимает `assigneeUserIds`, эмитит ТОЛЬКО `issue.created` (`issues.service.ts:328`) | Переиспользуем для создания; для уведомления НЕЛЬЗЯ полагаться на `issue.created` (нет исполнителя в payload) |
| `addAssignee` (UI-путь) | Эмитит `issue.assignee_changed action=added` (`issues.service.ts:1422`) | Канонический триггер уведомления; покрывает UI бесплатно (Р3) |
| `ConversationalService.sendNotification` | Резолвит каналы, есть `in_app` fallback (`conversational.service.ts:176`) | Кабинет-fallback УЖЕ есть; отдельный код не нужен |
| `event-payload.registry.ts` | Реестр Zod-схем по eventType, есть `issue.mention` (`:117,:268`) | Добавляем `issue.assigned` по тому же шаблону |
| `telegram-bot.adapter.ts` renderText | switch по eventType, есть кейс `issue.mention` (`:1143`), generic-fallback (`:1201`) | Добавляем кейс `issue.assigned`; зеркалим в MAX (`max-bot.adapter.ts:767`) |
| Резолвер имени → user | **Отсутствует** (context-builder ростер не даёт; events не резолвит участников по имени) | Проектируем `AssigneeResolverService` |
| Prisma-схема | Менять НЕ нужно (Issue/IssueAssignee достаточно) | Нет миграции → нет Шага 4/5 прод-выката |

## Принятые решения владельца (2026-06-20, не пересматривать)
| # | Решение | Обоснование |
|---|---|---|
| Р1 | Полноценно: реальное назначение + уведомление + чистка текста подтверждения | Запрос Насти закрывается целиком |
| Р2 | Ставить задачу на другого может ЛЮБОЙ сотрудник (право `issue:write`, есть у member) | Как в обычных трекерах/мессенджерах; антиспам — видно КТО поставил + 1 событие = 1 пуш |
| Р3 | Уведомление едино для UI трекера и помощника | Один listener на `issue.assignee_changed` покрывает оба источника |

## Архитектурные решения (Проход A vs B сведён; детали — в анализе §5)
| # | Решение | Почему (не оптимизировать) |
|---|---|---|
| Б1 | Отдельный инструмент `assign_task` (а не расширение `create_task`) | `create_task` остаётся простым «себе»; назначение на другого — явное действие с резолвом имени. Перегружать create_task опц. исполнителем = двусмысленность для LLM |
| Б2 | Резолв имени → user СЕРВЕРНО, в эндпоинте (tool принимает `assigneeName` свободным текстом) | LLM не имеет ростера в контексте (проверено: context-builder его не кладёт). Серверный резолвер тестируем и даёт машинные коды ошибок. Альтернатива «дать LLM tool-ростер» = лишние раунды и ошибки выбора |
| Б3 | Единый триггер уведомления — событие `issue.assignee_changed action=added`; путь помощника эмитит его ЯВНО после `issues.create` | Один listener = одна точка доставки для UI и помощника (Р3). НЕ обогащаем `issue.created` исполнителями (шире scope, риск двойного пуша) |
| Б4 | Кабинет-fallback НЕ кодим — он уже в `sendNotification` (`in_app`) | Дублировать существующий fallback = код ради кода |
| Б5 | Уведомление под kill-switch `ASSIGNMENT_NOTIFICATIONS_ENABLED` (default ON) | Новый исходящий-многим канал = риск шторма при массовом переназначении; рубильник для инцидента (Ship-On: kill-switch ON, не rollout-gate) |

## Scope
**Входит:** новый эндпоинт назначения на другого; `AssigneeResolverService`; инструмент помощника `assign_task` + whitelist; человекочитаемый preview подтверждения/«Готово»; eventType `issue.assigned` (схема+рендер Telegram+MAX); listener-нотификатор на `issue.assignee_changed`; kill-switch.
**Не входит:** см. «Вне scope» выше.

## Граничные контракты с другими ТЗ / подсистемами
- **knowledge-core ingest**: эмит `issue.assignee_changed` из пути помощника породит для НОВОЙ задачи и `issue.created`, и `issue.assignee_changed` (ingest трактует как `task_reassigned`). Это безвредно (ingest идемпотентен по сущности) — НЕ чинить здесь, не подавлять.
- **Telegram/MAX gating (W4.3 dataClass)**: `issue.assigned` идёт с `dataClass: 'internal'` → внешние каналы пропускают (как `issue.mention`). Не трогать политику gating.
- **`me/tasks` self-task**: контракт неизменен; назначение на себя по-прежнему через `create_task`.

---

## Контракты (канон для копипасты)

### 1. DTO эндпоинта назначения
Файл: `backend/src/modules/tracker/dto/issues/post-assign-task.dto.ts` (новый, по образцу `post-me-task.dto.ts`).
```ts
import { z } from 'zod';

export const PostAssignTaskBodySchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    assigneeName: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5_000).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();
export type PostAssignTaskBodyDto = z.infer<typeof PostAssignTaskBodySchema>;

export interface PostAssignTaskResponseDto {
  id: string;
  title: string;
  projectId: string;
  status: string;
  assignee: { userId: string; name: string };
}
```

### 2. Машинные коды ошибок (эндпоинт назначения)
| HTTP | code | message (рус.) |
|---|---|---|
| 404 | `assignee_not_found` | `Не нашёл сотрудника по имени «{name}». Уточните имя.` |
| 409 | `assignee_ambiguous` | `Несколько сотрудников с именем «{name}»: {список}. Уточните, кого имели в виду.` |
| 400 | `tenant_required` | `Организация не определена` |
| 403 | `forbidden` | `Недостаточно прав на создание задач` |

### 3. AssigneeResolverService (контракт)
Файл: `backend/src/modules/tracker/services/assignee-resolver.service.ts` (новый).
```ts
export type AssigneeResolution =
  | { kind: 'resolved'; userId: string; name: string }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; candidates: Array<{ userId: string; name: string }> };

// resolve(tenantId, rawName): AssigneeResolution
// 1. norm = rawName.trim().toLowerCase().replace(/\s+/g,' ')
// 2. кандидаты: Person where { tenantId, deletedAt: null, userId: { not: null } }
//    + активный Membership(orgId=tenantId, user.deletedAt=null) для этого userId.
// 3. матч по Person.name (ci): сначала точное равенство norm; если 0 — startsWith; если 0 — contains.
// 4. дедуп по userId. 1 → resolved; >1 → ambiguous (до 5 кандидатов в message); 0 → not_found.
```
> `path:line` Person — `schema.prisma:4855` (`name @db.VarChar(200)`, `userId String?`, `deletedAt`). Membership — `schema.prisma:2874` (`orgId`,`userId`). Перед правкой перечитать (номера строк на момент написания).

### 4. Эндпоинт
`POST /api/v1/me/tasks/assign` — добавить в `MeTasksController` (`me-tasks.controller.ts`), guards те же (`CookieAuthGuard, TenantGuard`), RBAC `issue:write` через `requireWrite` (уже есть).
Логика сервиса `MeTasksService.assignTask(body, tenantId, actorUserId)`:
1. `resolver.resolve(tenantId, body.assigneeName)` → not_found⇒404, ambiguous⇒409.
2. `projectId = projects.ensureInboxProjectId(tenantId)` (как в self-task).
3. `issues.create(projectId, { …, assigneeUserIds: [resolved.userId], externalSource: 'assistant' }, tenantId, actorUserId)`.
4. `emitter.emitIssueAssigneeChanged({ issue, actorUserId, action: 'added', assigneeUserId: resolved.userId })` — ЯВНЫЙ эмит (Б3).
5. вернуть `{ id, title, projectId, status, assignee: { userId, name } }`.

### 5. eventType `issue.assigned` — Zod-схема
Файл: `event-payload.registry.ts` (добавить схему + строку в `registry`).
```ts
const IssueAssignedPayloadSchema = z
  .object({
    issueId: z.string().min(1).max(80),
    issueIdentifier: z.string().max(40).optional(),
    issueTitle: z.string().min(1).max(500),
    byUserId: z.string().min(1).max(80),
    byName: z.string().min(1).max(200),
    dueDate: z.string().max(40).nullable().optional(),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();
// registry: ['issue.assigned', IssueAssignedPayloadSchema],
```

### 6. Listener-нотификатор
Файл: `backend/src/modules/tracker/services/issue-assignment-notifier.service.ts` (новый).
```ts
@OnEvent(TrackerEmitterService.EVENT_NAME, { async: true })
async onTrackerEvent(payload: TrackerEventPayload): Promise<void> {
  if (payload.type !== 'issue.assignee_changed') return;
  if (payload.meta?.action !== 'added') return;
  if (!this.cfg.tracker.assignmentNotificationsEnabled) return;        // R12 kill-switch
  const assigneeUserId = String(payload.meta?.assigneeUserId ?? '');
  const actorUserId = payload.actor.userId;
  if (!assigneeUserId || assigneeUserId === actorUserId) return;       // R13 self-skip
  const byName = await this.resolveUserName(actorUserId);              // User.name по actorUserId
  await this.conversational.sendNotification({
    tenantId: payload.tenantId,
    recipientUserId: assigneeUserId,
    eventType: 'issue.assigned',
    payload: {
      issueId: payload.issue.id,
      issueIdentifier: payload.issue.identifier,
      issueTitle: payload.issue.title,
      byUserId: actorUserId ?? '',
      byName,
      dueDate: payload.issue.dueDate ?? null,
      actionUrl: `/issues/${payload.issue.id}`,
    },
    dataClass: 'internal',
  });
}
```
> Модуль-размещение: регистрировать в `TrackerModule`, который должен импортировать `ConversationalModule` (проверить отсутствие цикла: conversational НЕ импортирует tracker — цикла нет; если NestJS ругнётся — вынести listener в `ConversationalModule` с инъекцией только `cfg`+эмиттер-типов). Ошибки доставки — `try/catch` + `logger.warn`, НЕ пробрасывать (fire-and-forget, как у proactive).

### 7. Рендер `issue.assigned`
Telegram — новый `case` в `telegram-bot.adapter.ts:renderText` (рядом с `issue.mention:1143`):
```ts
case 'issue.assigned': {
  const ref = (payload['issueIdentifier'] as string | undefined) ?? '';
  const title = (payload['issueTitle'] as string | undefined) ?? '';
  const by = (payload['byName'] as string | undefined) ?? '';
  const due = (payload['dueDate'] as string | undefined) ?? '';
  const url = (payload['actionUrl'] as string | undefined) ?? '';
  const head = ref ? `<b>Вам поставили задачу ${escapeHtml(ref)}</b>` : '<b>Вам поставили задачу</b>';
  const t = title ? `\n\n«${escapeHtml(title)}»` : '';
  const who = by ? `\nПоставил(а): ${escapeHtml(by)}` : '';
  const when = due ? `\nСрок: ${escapeHtml(formatRuDate(due))}` : '';
  const link = url ? `\n\nОткрыть:\n${escapeHtml(url)}` : '';
  return `${head}${t}${who}${when}${link}`.slice(0, 4000);
}
```
MAX — зеркальный `case` в `max-bot.adapter.ts:renderText` (`:767`), по стилю соседних кейсов MAX (без HTML, как там принято — перечитать соседний `issue.mention`/`event.reminder` в MAX-адаптере и повторить их конвенцию экранирования).

### 8. Человекочитаемый preview (Проблема 2)
В `concierge.service.ts`: расширить `CONFIRM_TOOL_RU_NAMES` (`:86`) и переписать `buildConfirmPreview` (`:568`).
```ts
const CONFIRM_TOOL_RU_NAMES: Record<string, string> = {
  // …существующие…
  create_task: 'поставить задачу себе',
  assign_task: 'поставить задачу сотруднику',
};
const PARAM_RU_LABELS: Record<string, string> = {
  title: 'задача', description: 'детали', dueDate: 'срок',
  assigneeName: 'кому', question: 'вопрос', text: 'текст',
  type: 'тип', startAt: 'начало', endAt: 'конец', kind: 'вид',
  location: 'место', counterparty: 'с кем',
};
// buildConfirmPreview:
//  - ruName = CONFIRM_TOOL_RU_NAMES[toolName] ?? humanizeToolName(toolName)
//  - для каждого значимого параметра: подпись = PARAM_RU_LABELS[k] ?? k;
//    значение: dueDate/startAt/endAt → formatRuDate; иначе строка ≤80.
//  - вернуть: `${ruName}: ${parts.join(', ')}`  (никаких сырых англ. ключей)
```
Симметрично — «Готово»: в `assistant-channel.bridge.ts:372` сейчас `Готово: ${state.preview}` уже использует тот же `preview` → правка автоматически наследуется (проверить, что bridge не строит preview сам).
**Пример (R1):** вместо `create_task (title: …, description: …, dueDate: 2026-06-19)` →
`поставить задачу сотруднику: кому — Айназ, задача — Тестирование бота в Telegram, срок — 19 июня`.

### 9. Инструмент `assign_task` (service-map)
В `service-map-generator.service.ts` рядом с `create_task` (`:145`):
```ts
{
  name: 'assign_task',
  description:
    'Используй для постановки задачи ДРУГОМУ сотруднику (не себе). Когда просят «поставь задачу на <имя>», «поручи <имя>…». Передай assigneeName именем, как назвал пользователь. Если суть/срок неясны — переспроси ДО вызова.',
  method: 'POST',
  path: '/api/v1/me/tasks/assign',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Краткая суть задачи.' },
      assigneeName: { type: 'string', description: 'Имя сотрудника-исполнителя, как назвал пользователь (например «Айназ»).' },
      description: { type: 'string', description: 'Подробности. Опц.' },
      dueDate: { type: 'string', description: 'Срок ISO-8601 (2026-06-20). Опц.' },
    },
    required: ['title', 'assigneeName'],
  },
  rbacResource: 'issue',
  rbacAction: 'write',
},
```
Whitelist: добавить `'assign_task'` в `CHANNEL_TOOL_WHITELIST_SELF` (`assistant-channel.bridge.ts:29`).
Системный промпт `concierge-respond.prompt.ts`: одна строка в блок «ЧТО КОГДА БРАТЬ» — «поставить задачу себе → create_task; поставить задачу другому человеку по имени → assign_task».

### Поток (ASCII)
```
Пользователь(бот): «поставь задачу на Айназ — протестировать бота, к сегодня»
  → ConciergeService.process (confirmHold) → LLM выбирает assign_task{title, assigneeName:'Айназ', dueDate}
  → confirm_required → bridge: «поставить задачу сотруднику: кому — Айназ, задача — …, срок — сегодня. да/нет»
  → «да» → ToolRouter → POST /me/tasks/assign
        → AssigneeResolver('Айназ') → resolved userId
        → issues.create(assigneeUserIds:[userId]) + emitIssueAssigneeChanged(added)
  → @OnEvent issue.assignee_changed(added) → IssueAssignmentNotifier
        → sendNotification(recipientUserId=Айназ, 'issue.assigned')
        → Telegram/MAX (или in_app кабинет) → «Вам поставили задачу …»
UI-путь: addAssignee → тот же issue.assignee_changed(added) → тот же notifier (Р3)
```

## Границы фичи
- ✅ Always: `dataClass:'internal'`; self-skip; fire-and-forget доставка; preview без латинских ключей; задача в проект «Входящие».
- ⚠️ Ask first: менять политику gating каналов; добавлять выбор проекта/отдела; трогать self-task `me/tasks`.
- 🚫 Never: писать `assigneeUserIds` мимо резолвера (cross-tenant!); слать пуш при assignee==actor; класть секреты/ID в текст уведомления сверх контракта; обогащать `issue.created` исполнителями (вне scope).

---

## Фазы

### Ф1 — Человекочитаемый текст подтверждения `[x]`
**Цель:** preview и «Готово» — на русском, без сырых ключей. Независима, ценность сразу.
**Файлы:** `concierge.service.ts` (`CONFIRM_TOOL_RU_NAMES:86`, `buildConfirmPreview:568`), `assistant-channel.bridge.ts:202,372` (проверить), новый helper `formatRuDate`, тесты `concierge.service.spec.ts` / `assistant-channel.bridge.spec.ts`.
**Что НЕ входит:** новые инструменты, назначение, уведомления.
**Acceptance:**
- `bunx vitest run backend/src/modules/concierge/services/concierge.service.spec.ts` зелёный; добавлен тест: для `create_task{title,description,dueDate}` в результате `buildConfirmPreview` НЕТ подстрок `title:`, `description:`, `dueDate:` и слова `create_task`.
- греп: `PARAM_RU_LABELS` присутствует в `concierge.service.ts`.
- `bun run typecheck && bun run lint` зелёные.
**Закрывает:** R1, R2, R3.

### Ф2 — Backend назначения на другого `[x]`
**Цель:** эндпоинт `POST /api/v1/me/tasks/assign` создаёт задачу на разрешённого по имени сотрудника и эмитит `issue.assignee_changed(added)`.
**Файлы:** `post-assign-task.dto.ts` (new), `assignee-resolver.service.ts` (new), `me-tasks.service.ts` (метод `assignTask`), `me-tasks.controller.ts` (метод+маршрут), регистрация сервисов в module трекера; тесты `assignee-resolver.service.spec.ts`, `me-tasks.service.spec.ts` (или e2e контроллера).
**Что НЕ входит:** инструмент помощника, уведомление-рендер.
**Acceptance:**
- грепы: `me/tasks/assign` в `me-tasks.controller.ts`; `assignee_not_found` и `assignee_ambiguous` в коде; `emitIssueAssigneeChanged` в `me-tasks.service.ts`.
- тест резолвера: 1 совпадение→resolved; 2 одноимённых→ambiguous; 0→not_found; cross-tenant Person не матчится.
- тест сервиса: создаёт Issue с `assigneeUserIds:[resolved]`, `externalSource:'assistant'`, вызывает `emitIssueAssigneeChanged({action:'added'})`.
- Swagger: `POST /api/v1/me/tasks/assign` виден в `/api/docs`.
- `bun run typecheck && bun run lint && bun run build` зелёные.
**Закрывает:** R4, R5, R6, R7.

### Ф3 — Инструмент помощника `assign_task` `[x]`
**Цель:** помощник умеет выбрать `assign_task`, preview красивый, whitelist пропускает.
**Файлы:** `service-map-generator.service.ts` (tool), `assistant-channel.bridge.ts:29` (whitelist), `concierge-respond.prompt.ts` (1 строка), `concierge.service.ts` (PARAM_RU_LABELS уже включает `assigneeName` из Ф1), тесты `service-map-generator.service.spec.ts`, `assistant-channel.bridge.spec.ts`.
**Что НЕ входит:** доставка уведомления (Ф4).
**Acceptance:**
- грепы: `'assign_task'` в `service-map-generator.service.ts` И в `CHANNEL_TOOL_WHITELIST_SELF`.
- тест: `findTool('assign_task')` возвращает tool с `method:'POST'`, `path:'/api/v1/me/tasks/assign'`, `required:['title','assigneeName']`, `rbacAction:'write'`.
- тест: для `assign_task{assigneeName:'Айназ',title:'…'}` preview содержит `Айназ` и `кому`, не содержит `assigneeName`/`assign_task`.
- `bun run typecheck && bun run lint` зелёные.
**Закрывает:** R8.

### Ф4 — Единое уведомление `issue.assigned` `[x]`
**Цель:** при появлении исполнителя (UI или помощник) ему уходит человеческое уведомление в бот/кабинет.
**Файлы:** `event-payload.registry.ts` (схема+registry), `issue-assignment-notifier.service.ts` (new + регистрация), `telegram-bot.adapter.ts` (case + `formatRuDate`), `max-bot.adapter.ts` (case), `env.schema.ts` + `TypedConfigService` (`tracker.assignmentNotificationsEnabled`, default true), `docs/operations/feature-flags.md` (строка kill-switch); тесты `issue-assignment-notifier.service.spec.ts`, `telegram-bot.adapter.spec.ts`.
**Что НЕ входит:** обогащение `issue.created`.
**Acceptance:**
- грепы: `'issue.assigned'` в `event-payload.registry.ts` (схема+registry) И в `telegram-bot.adapter.ts` И в `max-bot.adapter.ts`.
- тест notifier: событие `issue.assignee_changed{action:'added',assigneeUserId:X,actor:Y}` (X≠Y) → ровно 1 вызов `sendNotification` с `eventType:'issue.assigned'`, `recipientUserId:X`, `dataClass:'internal'`; при X==Y — 0 вызовов; при `action:'removed'` — 0; при флаге OFF — 0.
- тест рендера: `renderText` для `issue.assigned` содержит «Вам поставили задачу», имя автора, не падает в generic `Уведомление:`.
- `ASSIGNMENT_NOTIFICATIONS_ENABLED` есть в `env.schema.ts` и строкой в `docs/operations/feature-flags.md`.
- `bun run typecheck && bun run lint && bun run build` зелёные.
**Закрывает:** R9, R10, R11, R12, R13.

### Ф5 — Приёмка, прод-инструкция, second-brain `[x]`
**Цель:** сквозная проверка + документация.
**Acceptance:**
- сквозной тест/ручная проверка потока ASCII (минимум: unit-цепочка Ф2+Ф4 через эмит события).
- `docs/operations/prod-deploy-log.md`: Шаг 1 (новая ENV kill-switch), Шаг 12 (Swagger smoke `me/tasks/assign` + grep нового eventType). Миграции/seed НЕ требуются (Шаги 4–10 не трогаются).
- second-brain: `01_projects/api-layer.md` (новый эндпоинт), `01_projects/concierge-agent.md` (новый инструмент), `02_architecture/module-map.md` (новый listener/сервис), `01_projects/conversational-channels.md` (новый eventType `issue.assigned`).
- реестр «не сделано»: убрать строку 2026-06-20 (пробел закрыт) → в архив.
- рефлексия в `second-brain/05_история/`.
**Закрывает:** DoD.

## Граф зависимостей
```
Ф1 (preview) ───────────────┐ (независима)
Ф2 (backend assign) ──► Ф3 (tool assign_task)
        └──────────────────► Ф4 (notify issue.assigned)   [Ф4 не зависит от Ф3]
Ф3, Ф4 ──► Ф5 (verify+docs)
```
Строгий порядок: Ф2 раньше Ф3 и Ф4 (они опираются на эндпоинт/эмит). Ф1 можно делать первой (быстрый эффект). Ф3 и Ф4 независимы между собой.

## Требования (трассируемость)
- **R1** Когда помощник просит подтверждение пишущего действия, preview shall не содержать латинских ключей параметров и технического имени инструмента.
- **R2** Если инструмент есть в `CONFIRM_TOOL_RU_NAMES`, then preview использует русское название действия.
- **R3** Сообщение «Готово…» shall использовать тот же человекочитаемый формат, что и подтверждение.
- **R4** Когда вызывается `POST /api/v1/me/tasks/assign` с `title`+`assigneeName`, система shall создать задачу в «Входящие» с исполнителем=разрешённый user и вернуть 201 с `assignee`.
- **R5** Если имя не сопоставлено, then 404 `assignee_not_found`.
- **R6** Если имя сопоставлено с >1 активным участником, then 409 `assignee_ambiguous` со списком кандидатов.
- **R7** Вызов требует `issue:write` (есть у member) — Р2.
- **R8** Помощник shall иметь инструмент `assign_task` (на другого), отдельный от `create_task`, в `CHANNEL_TOOL_WHITELIST_SELF`.
- **R9** Когда на задаче появляется исполнитель (`action=added`) и он ≠ инициатор, система shall отправить ему `issue.assigned`.
- **R10** Уведомление shall доставляться в привязанный бот, иначе в кабинет (`in_app`) — через существующий fallback.
- **R11** Рендер `issue.assigned` в Telegram и MAX shall быть человекочитаемым (кто поставил, задача, срок, ссылка), не generic-fallback.
- **R12** Kill-switch `ASSIGNMENT_NOTIFICATIONS_ENABLED` (default ON); OFF гасит только отправку `issue.assigned`.
- **R13** Если исполнитель == инициатор, then уведомление не отправляется.

## Pre-mortem / Риски и ревью-аспекты
- **Шторм уведомлений** при массовом переназначении → kill-switch (R12); 1 событие = 1 пуш; self-skip (R13).
- **Cross-tenant утечка** при резолве имени → резолвер строго фильтрует по `tenantId` + активный Membership; тест cross-tenant (🚫 граница).
- **Неоднозначность имени** («два Айназ») → 409 с кандидатами; помощник переспрашивает (фидбек приходит ПОСЛЕ «да» — принятый компромисс, см. анализ §6).
- **Циклическая зависимость модулей** tracker→conversational → проверить; план Б: listener в ConversationalModule.
- **prompt caching:** SYSTEM-промпт помощника получает одну статичную строку (разовый сброс кэша, допустимо); per-request переменная часть не меняется; tool-лист расширяется на 1 инструмент (разовый сдвиг префикса). Раздел обязателен — выполнен.
- Ревью-гейт (`strict-production-review-gate`): идемпотентность доставки (fire-and-forget, ошибки логируются не пробрасываются), отсутствие `process.env.*` (только `TypedConfigService`), Zod-strict на DTO и payload, RBAC на эндпоинте, tenant-фильтр в резолвере.

## Idempotency / flag / prod-deploy
- Миграций/seed/patch/backfill НЕТ. Прод-выкат — обычный `docker compose up -d --build backend` + новая ENV.
- Kill-switch `ASSIGNMENT_NOTIFICATIONS_ENABLED=true` — строка в `docs/operations/feature-flags.md` (тип: аварийный рубильник, состояние ON).
- prod-deploy-log: Шаг 1 (ENV), Шаг 12 (Swagger smoke + grep eventType).

## DoD
- `bun run typecheck` (вкл. `.spec`) / `lint` / `build` зелёные; `bunx vitest run` по затронутым spec зелёный.
- second-brain обновлён по таблице производных заметок; prod-deploy-log Шаги 1/12; feature-flags.md строка; реестр «не сделано» закрыт; рефлексия записана.
- Все Acceptance фаз выполнены; ни одного сырого англ. ключа в preview; уведомление доходит до бота и кабинета.

## Итог
Реализовано целиком (Ф1–Ф5), ветка `feature/assistant-assign-task-notify` → влита в `dev`.

| Фаза | Коммит | Суть |
|---|---|---|
| Ф1 | `f3f36dc3` | Человекочитаемый preview подтверждения (formatRuDate, PARAM_RU_LABELS, CONFIRM_TOOL_RU_NAMES) |
| Ф2 | `642d52cf` | `POST /me/tasks/assign` + AssigneeResolverService + явный эмит issue.assignee_changed(added) |
| Ф3 | `a1d616b4` | Инструмент помощника assign_task (service-map + whitelist + промпт) |
| Ф4 | `939d7165` | Уведомление issue.assigned (IssueAssignmentNotifierService в ConversationalModule, схема+рендер Telegram/MAX+channel-policy+kill-switch) |
| Ф5 | (docs) | second-brain, prod-deploy-log, feature-flags, рефлексия |

**Верификация:** typecheck/lint/build зелёные; vitest по затронутым spec зелёный (formatRuDate 4 · concierge preview · assignee-resolver 7 · me-tasks service 8 · me-tasks controller 9 · service-map · notifier 5 · telegram-adapter render). Build подтверждает DI/@OnEvent. Архитектурное открытие: notifier обязан жить в `ConversationalModule` (conversational уже импортит tracker — обратный импорт = цикл). Дополнительно к ТЗ: добавлен `issue.assigned` в `EVENT_TYPE_CHANNEL_POLICY` (иначе DEFAULT=in_app, не дошло бы в бот, R10); dueDate в notifier слайсится до `YYYY-MM-DD` для чистого «20 июня».

**Не закрыто:** строка в реестре `second-brain/04_не-сделано/README.md` НЕ перенесена в архив — файл одновременно правят 2 параллельные сессии (config-knobs + decision-materialization, незакоммиченные строки в том же блоке); чистый выборочный стейдж невозможен без риска клоббера их работы. Строку про assign-task следует архивировать вручную после слияния параллельных правок.
