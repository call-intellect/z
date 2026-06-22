---
type: tz
status: ready-to-implement
feature: qa-fixes-concierge-rbac-deletion
date: 2026-06-22
owner: sergrv80@gmail.com
relates_to:
  - plans/archive/2026-06-03-knowledge-card-correct.md
  - plans/tz/2026-06-04-curation-canonical-writeback.md
  - backend/src/modules/concierge/services/tool-router.service.ts
  - backend/src/modules/rbac/policies/policy.csv
  - backend/src/modules/regulations/regulations.controller.ts
  - backend/src/modules/cards/cards.controller.ts
---

> Источник находок: QA-сессия 2026-06-22 (прод `korateam.ru`, тестовый аккаунт «ооо ромашка», роль owner, `currentOrgId=cmpuz4gbs000201mvfbf3k2zk`, `userId=cmpuz4ga3000101mvi1820wbj`). Корни Багов A/B доказаны живыми API-вызовами из авторизованной сессии (см. «Доказательство выбора»). Статус согласования с владельцем: 2026-06-22 — Баг A фикс = Вариант 1; удаление = «добавить owner/admin-удаление регламентов + кнопку удаления задачи».

# QA-фиксы: Консьерж-403 (RBAC) + удаление мусора (регламенты/задачи) + мелочи

## Принцип
Каждый баг чиним **в корень и весь класс**, не симптом. Каждый фикс обязан иметь **тест-доказательство** (unit/e2e + живой re-test в кабинете через `qa-tester`/Playwright) — владелец прямо потребовал «доказать, что починится, а не просто тезис».

## Вне scope / отложено владельцем
- **Достройка петли курации** (`dispute → авто-pending куратору`, write-back одобренной правки) — остаётся за `plans/tz/2026-06-04-curation-canonical-writeback.md` (needs-owner-go). Здесь добавляем **прямое owner/admin-удаление**, петлю курации не трогаем.
- **Жёсткий hard-delete** (физическое удаление строк) — НЕ делаем; только soft-delete (`deletedAt`) + grace + restore, как у `cards`.
- **Удаление сущностей/рёбер графа** (`entities/:id/mark-wrong`) — уже есть, не трогаем.

---

## Цель
1. Вернуть рабочий «Помощник компании» в плавающем Консьерже (сейчас на любой вопрос — `ask_chat_v2 (ошибка)`, ответа нет).
2. Вернуть стрим Консьержа (сейчас мёртв, тихий откат на polling).
3. Дать owner/admin **удалять** мусор: задачи (кнопки нет) и регламенты/решения (механизма нет).
4. Убрать мелкие протечки: служебный токен `[BLOCK:…]` в ответе чата; 404 по ссылке-источнику на встречу.

## Зачем (болезненное состояние)
- «Помощник компании» — главный вход для нетехнической ЦА ([[feedback_concierge_entry_visible_button]]). Сейчас он **полностью не отвечает на вопросы** у всех ролей (owner/admin/manager) — фича-витрина мертва, хотя сам движок chat-v2 исправен.
- Мусор в базе знаний и задачах **накапливается без возможности убрать**: `dispute` («Это неверно») лишь помечает карточку обучающим сигналом, она остаётся видимой; у задач backend-удаление есть, но кнопки в UI нет.

---

## REALITY-CHECK (факт по коду на 2026-06-22)

| # | Что проверено | Факт | Следствие для scope |
|---|---|---|---|
| RC-1 | Корень Бага A | RBAC-предпроверка `ToolRouter` для `ask_chat_v2`/`chat_v2_conversation:write` падает (scope `self`, `resourceOwnerId` не передан). Эндпоинт chat-v2 **исправен** (live 200). | Фикс — 1 строка + unit-тест. Миграций нет. |
| RC-2 | Корень Бага B | `streamConciergeMessage` (raw `fetch`) не шлёт `X-Org-Id` → стрим 403, откат на `/once`. | Фронт-фикс, миграций нет. Нужен геттер активного orgId. |
| RC-3 | Удаление задачи | `DELETE /api/v1/issues/:id` (soft delete) **уже есть** ([issues.controller.ts:159-162](../../backend/src/modules/tracker/controllers/issues.controller.ts#L159)); `issuesApi.remove` **уже есть** ([issues.api.ts:166](../../frontend/src/api/tracker/issues.api.ts#L166)), но **нигде не вызывается** — нет только UI-кнопки. | Только фронт-фаза. Backend готов. |
| RC-4 | **Удаление регламентов/решений** | ⚠️ У моделей `Regulation`/`Process`/`Policy`/`Instruction`/`Decision` поля **`deletedAt` НЕТ** (проверено по `schema.prisma`; `deletedAt:null` на `regulations.service.ts:503` — это **`ProcessTemplate`**, не Regulation). | Soft-delete требует **миграцию схемы** + правку ВСЕХ list/search/count/citation-чтений. Это самостоятельная backend-волна, не «поле уже есть». |
| RC-5 | Эталон soft-delete в Z | `cards`: `@Delete cards/:id`→`softDelete`, `@Post cards/:id/restore`→`restore`, «grace 30 дней» ([cards.controller.ts:232-248](../../backend/src/modules/cards/cards.controller.ts#L232)); `ProcessTemplate` уже имеет `deletedAt`+`status`. | Мирроррим cards (endpoint+UI) и ProcessTemplate (модель). |
| RC-6 | confirm-диалог UI | `useConfirmDialog` (`@/ui/components/shared/useConfirmDialog`, `ask()`+`dialog`) — используется в `CardDetailClient.tsx:33,64`. | Кнопки удаления задачи/регламента переиспользуют его, не изобретаем. |
| RC-7 | Источник `[BLOCK:…]` (M1) | Формат цитат `[BLOCK:id]` чистится regex `/\[BLOCK:[a-zA-Z0-9_-]+\]/g` ([clones.service.ts:1128](../../backend/src/modules/clones/services/clones.service.ts#L1128)). Вариант chat-v2 `[BLOCK:id — цепочка рассуждения]` (пробел + `—` + кириллица) этим regex **не ловится** → течёт. | Фикс — нормализовать/расширить очистку в сборке ответа chat-v2. |

---

## Принятые решения владельца (2026-06-22 — не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | Баг A чиним **Вариантом 1**: `ToolRouter` передаёт `resourceOwnerId: input.userId` в `rbac.check`. | Узко, прав не расширяет (как было «только своё» — так и осталось), не трогает ядро RBAC/policy. Консьерж по природе действует от лица юзера над его же ресурсом → `isSelfOwner=true`. |
| Р2 | **НЕ** расширять `policy.csv` до `chat_v2_conversation:write` scope `*` (Вариант 2 отклонён). | Это дало бы право писать в ЧУЖИЕ диалоги; нарушает «доступ по минимуму». |
| Р3 | Добавить **owner/admin soft-delete регламентов** + **кнопку удаления задачи**. | Мусор должен убираться руками владельца, а не только помечаться. |
| Р4 | Каждый фикс — с **тест-доказательством** (unit/e2e + живой re-test в кабинете). | Прямое требование владельца «доказать, что починится». |

---

## Доказательство выбора (Баг A: Вариант 1 vs 2 vs 3)

Корень доказан **связкой**: чтение кода + контраст инструментов + live-API.

**Цепочка кода:**
- `ask_chat_v2` → `rbacResource='chat_v2_conversation'`, `act='write'`, `POST /api/v1/chat-v2/messages` ([service-map-generator.service.ts:128-142](../../backend/src/modules/concierge/services/service-map-generator.service.ts#L128)).
- `ToolRouter.execute` зовёт `rbac.check({obj:'chat_v2_conversation', act:'write'})` **без `resourceOwnerId`** ([tool-router.service.ts:75-96](../../backend/src/modules/concierge/services/tool-router.service.ts#L75)).
- `rbac.check`: `isSelfOwner = (resourceOwnerId === userId)` → без него `false` ([rbac.service.ts:159-176](../../backend/src/modules/rbac/rbac.service.ts#L159)); `evaluate` строка 488: `if (p.ownerMatch === 'self' && !args.isSelfOwner) continue;` ([rbac.service.ts:476-492](../../backend/src/modules/rbac/rbac.service.ts#L476)).
- `policy.csv`: у owner/admin/manager `chat_v2_conversation:write` существует **только** `ownerMatch=self` ([policy.csv:655-663](../../backend/src/modules/rbac/policies/policy.csv#L655)) → правило пропускается → `allowed=false` → 403 «нет прав на chat_v2_conversation/write» **до loopback**, для всех ролей.
- Контраст: `create_task` через тот же ToolRouter даёт 201, т.к. `task:write` открыт на `*` (`p, owner, *, *, task, write`).

**Live-API (fetch из авторизованной сессии owner, реальные ответы):**

| Тест | Запрос | Итог | Что доказывает |
|---|---|---|---|
| T1 | `POST /chat-v2/messages` + `X-Org-Id` + `X-Concierge-Origin` + `{question}` | **200**, реальный ответ | Эндпоинт + транспорт исправны |
| T2 | то же без `X-Concierge-Origin` | **200** | Заголовок-маркер не при чём |
| T3 | без `X-Org-Id` | **403 `tenant_required`** | Это ДРУГой 403 (внешний guard), не RBAC-предпроверки |
| T4 | `X-Org-Id` + `{text}` (не `{question}`) | **400 validation** | Тело-контракт = `{question}` |

| Критерий | В1 (ToolRouter resourceOwnerId) | В2 (policy.csv → `*`) | В3 (skip pre-check для readOnly) |
|---|---|---|---|
| Чинит корень | ✓ | ✓ | ✓ |
| Не расширяет права | ✓ | ✗ (пишет в чужие диалоги) | ✓ |
| Не трогает общий policy/ядро RBAC | ✓ | ✗ | ⚠️ (меняет общую логику pre-check) |
| Объём правок | 1 строка + тест | 2 строки в policy | мини-рефактор + риск задеть др. инструменты |
| **Выбор** | **✓ (Р1)** | — | — |

Challenge-loop по В1: (1) корень, не симптом — да, чинит ВСЕ self-scoped readOnly-инструменты разом; (2) эффективнее некуда — 1 строка; (3) кода ради кода нет — переиспользует существующий `resourceOwnerId`-канал `rbac.check`.

---

## Scope

**Входит:** Баг A (Ф1), Баг B (Ф2), кнопка удаления задачи (Ф3), очистка `[BLOCK]` M1 (Ф4), soft-delete регламентов/решений — схема+бэк+фронт (Ф5–Ф7), 404 источника M2 (Ф8), финальный живой re-test (Ф9).

**Не входит:** петля курации/write-back; hard-delete; удаление блоков графа; изменение логики `dispute`/`correct`/`supersede` (остаются как есть, рядом с новым delete).

---

## Требования (EARS, трассируемые)

- **R1.** Когда owner/admin/manager задаёт вопрос «Помощнику компании» в Консьерже, система shall выполнить `ask_chat_v2` без RBAC-403 и вернуть ответ chat-v2 пользователю как есть.
- **R2.** Если Консьерж исполняет любой self-scoped инструмент от лица пользователя, то `rbac.check` shall получать `resourceOwnerId = input.userId`.
- **R3.** Когда фронт открывает стрим `POST /concierge/messages`, система shall передать заголовок `X-Org-Id` с активным orgId; при наличии активной орг стрим shall вернуть 200 и SSE-стадии.
- **R4.** Когда пользователь с правом на задачу открывает карточку задачи, система shall показать действие «Удалить задачу»; по подтверждению shall вызвать `DELETE /issues/:id` и увести со страницы, задача shall исчезнуть из доски/списка.
- **R5.** Если owner/admin нажимает «Удалить» на регламенте/процессе/политике/инструкции/решении, система shall проставить `deletedAt=now` и исключить запись из всех list/search/count/citation-выдач.
- **R6.** Когда регламент/решение удалён в пределах grace-окна, система shall позволить owner/admin восстановить его (снять `deletedAt`).
- **R7.** Когда chat-v2 формирует текст ответа пользователю, система shall удалить из него все токены цитат-блоков, включая помеченную форму `[BLOCK:<id>( — <подпись>)]`.
- **R8.** Если ссылка-источник указывает на несуществующую/недоступную встречу, система shall не отдавать «битый» 404-переход, а показать понятное состояние «источник недоступен».

---

## Фазы

Граф зависимостей: **Ф1, Ф2, Ф3, Ф4, Ф8 — независимы и параллелятся.** **Ф5 → Ф6 → Ф7** строго последовательны (схема → бэк → фронт). **Ф9 — последняя** (после выката, проверяет всё живьём).

```
Ф1 ─┐
Ф2 ─┤
Ф3 ─┼──────────────► Ф9 (живой re-test)
Ф4 ─┤
Ф8 ─┘
Ф5 ─► Ф6 ─► Ф7 ───► Ф9
```

---

### Ф1 — Баг A: ToolRouter передаёт `resourceOwnerId` (Консьерж отвечает) `[x]`
**Цель:** убрать ложный RBAC-403 в предпроверке инструментов Консьержа для self-scoped ресурсов.
**Картография:** [tool-router.service.ts:75-96](../../backend/src/modules/concierge/services/tool-router.service.ts#L75) (якорь: `obj: tool.rbacResource as any,`), тест-образец `tool-router.service.spec.ts` (есть моки `rbac`, `serviceMap`).
**Что входит:** в объект `rbac.check({...})` добавить `resourceOwnerId: input.userId`.
**Контракт (дословно):**
```ts
const allowed = await this.rbac.check({
  userId: input.userId,
  tenantId: input.tenantId,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj: tool.rbacResource as any,
  act: tool.rbacAction ?? 'read',
  resourceOwnerId: input.userId,
});
```
**Что НЕ входит:** policy.csv, ядро RBAC, режимы cookie/service, loopback.
**Файлы:** `tool-router.service.ts`, `tool-router.service.spec.ts`.
**Acceptance (тест-доказательство):**
- Новый unit в `tool-router.service.spec.ts`: при `rbac.check` с реальным предикатом self-scope (мок rbac, который возвращает `true` только если `resourceOwnerId === userId`) `execute({toolName:'ask_chat_v2', userId, tenantId})` НЕ возвращает `status:403` от предпроверки (доходит до loopback). Негативный кейс: без правки тест red.
- `bunx vitest run src/modules/concierge/services/tool-router.service.spec.ts` зелёный; `bun run typecheck` зелёный.
- Греп-маркер: `resourceOwnerId: input.userId` присутствует в `tool-router.service.ts`.
- Живой re-test — в Ф9.
**Закрывает:** R1, R2.

---

### Ф2 — Баг B: стрим Консьержа шлёт `X-Org-Id` `[x]`
**Цель:** оживить SSE-стрим `/concierge/messages` (сейчас 403 → тихий откат на `/once`).
**Картография:** [concierge.api.ts:82-97](../../frontend/src/api/concierge.api.ts#L82) (якорь: `Accept: "text/event-stream"`); активный orgId хранится в `defaultOrgId` модуля api-client, сеттер `setApiClientOrgId` ([api-client.ts:32-33](../../frontend/src/api/api-client.ts#L32)), используется в заголовках на `api-client.ts:139` (`headers["X-Org-Id"] = defaultOrgId`).
**Что входит:**
1. Экспортировать геттер активного orgId из `api-client.ts` (напр. `getApiClientOrgId(): string | null`) — рядом с `setApiClientOrgId`, читает тот же `defaultOrgId`. `[ASSUMPTION: геттера сейчас нет — добавить; если уже есть аналог — переиспользовать его, не плодить дубль]`.
2. В `streamConciergeMessage` добавить в `headers` строку `...(orgId ? { "X-Org-Id": orgId } : {})`, где `orgId = getApiClientOrgId()`.
**Что НЕ входит:** менять контроллер бэка, `/once`-путь, формат событий.
**Файлы:** `frontend/src/api/api-client.ts`, `frontend/src/api/concierge.api.ts`.
**Acceptance (тест-доказательство):**
- `bun run typecheck` (frontend) зелёный.
- В коде стрим-fetch содержит `X-Org-Id` (греп-маркер в `concierge.api.ts`).
- Живой re-test (Ф9): открыть Консьерж, отправить сообщение → в Network `POST /concierge/messages` = **200** (не 403), приходят SSE-события (`tool_result`/`message`/`done`), индикатор «печатает…» сменяется ответом без зависания.
**Закрывает:** R3.

---

### Ф3 — Кнопка «Удалить задачу» в UI `[ ]`
**Цель:** подключить уже готовый backend-delete к интерфейсу карточки задачи.
**Картография:** backend готов — [issues.controller.ts:159-162](../../backend/src/modules/tracker/controllers/issues.controller.ts#L159) (`@Delete('issues/:id')`, soft delete, доступ assignee/PM/admin — RBAC проверяет контроллер), `issuesApi.remove` ([issues.api.ts:166](../../frontend/src/api/tracker/issues.api.ts#L166)). UI карточки — `frontend/app/(authenticated)/issues/[id]/IssueDetailClient.tsx` + `frontend/src/ui/tracker/IssueHeader.tsx` (переименование) / `IssueSidebar.tsx`. Эталон удаления с подтверждением — `CardDetailClient.tsx` (`useConfirmDialog`, `ask({title, description, confirmLabel})`, см. RC-6).
**Что входит:** действие «Удалить задачу» в шапке/меню карточки (рядом с «Переименовать») → `useConfirmDialog.ask` с текстом про мягкое удаление → `issuesApi.remove(orgId, issueId)` → редирект на доску проекта (есть `parentHref`/крошка) + тост. Ошибку показывать через `humanizeApiError`.
**Что НЕ входит:** массовое удаление, восстановление задачи (если бэк restore для задач отсутствует — НЕ добавлять здесь; вынести как `[ASSUMPTION: у задач restore не делаем в этой фазе]`), удаление со списка/доски прямо в колонке.
**Файлы:** `IssueDetailClient.tsx` (или `IssueHeader.tsx`), при необходимости — `issues.api.ts` (если нужен резолв orgId).
**Acceptance (тест-доказательство):**
- `bun run typecheck` (frontend) зелёный.
- Живой re-test (Ф9): на тестовой задаче нажать «Удалить» → confirm → `DELETE /issues/:id` = 204 → редирект → задача отсутствует в `/projects` и в модуле «Что зависло».
- Негативно: отмена в диалоге — задача на месте, запрос не ушёл.
**Закрывает:** R4.

---

### Ф4 — M1: очистка токена `[BLOCK:…]` из ответа chat-v2 `[x]`
**Цель:** не показывать пользователю служебные цитаты-якоря вида `[BLOCK:cmq… — цепочка рассуждения]`.
**Картография:** эталон очистки — [clones.service.ts:1128](../../backend/src/modules/clones/services/clones.service.ts#L1128) (`.replace(/\[BLOCK:[a-zA-Z0-9_-]+\]/g, '')`) и парсер `clones.service.ts:2515`. Нужно найти сборку текста ответа в модуле **chat-v2** (где формируется `text` для `/chat-v2/messages`) и применить аналогичную очистку, но regex обязан ловить и помеченную форму `[BLOCK:<id> — <любой текст>]`.
**Что входит:** в пост-обработке текста ответа chat-v2 удалить токены цитат-блоков расширенным regex, напр. `/\[BLOCK:[a-zA-Z0-9_-]+(?:\s*[—-][^\]]*)?\]/gu`. Структурные `citations` (массив) НЕ трогать — режем только инлайн-протечку в `text`.
**Что НЕ входит:** менять формат цитат в промпте/контексте LLM; трогать клоны (там уже чистится).
**Файлы:** модуль chat-v2 (сборка ответа; точный файл определить грепом `chat-v2`/`messages`-сервис, якорь — место, где собирается `text`+`citations` ответа).
**Acceptance (тест-доказательство):**
- Unit на функцию-очистку: вход `"…привязки [BLOCK:cmq2b95ue00dc01qjquhaws49 — цепочка рассуждения]."` → выход без токена; вход `"[BLOCK:blk-1]"` (старая форма) → тоже удалён; обычный текст не меняется.
- `bunx vitest run` по затронутому spec зелёный; `bun run typecheck` зелёный.
- Живой re-test (Ф9): вопрос в `/chat`, в ответе нет подстроки `[BLOCK:`.
**Закрывает:** R7.

---

### Ф5 — Схема: `deletedAt` у регламентов/решений (миграция) `[x]`
**Цель:** дать моделям знаний поле для soft-delete (сейчас его нет — RC-4).
**Картография:** `backend/prisma/schema.prisma` модели `Regulation`@5982, `Process`@5690, `Policy`@6092, `Instruction`@6042, `Decision`@6206. Эталон поля — `ProcessTemplate` (`deletedAt DateTime?` + `@@index`).
**Что входит:** добавить в каждую из 5 моделей:
```prisma
deletedAt   DateTime?
deletedById String?
```
+ индекс под фильтрацию активных, напр. `@@index([tenantId, deletedAt])` (имя по конвенции соседних индексов модели). Миграция через `bun run prisma:migrate -- --name add_softdelete_to_knowledge_cards`; ревью SQL; `bun run prisma:generate`.
**Что НЕ входит:** бэкенд-логика удаления (Ф6), бэкфилл (нечего бэкфиллить — новое nullable-поле), правка чтений (Ф6).
**Файлы:** `schema.prisma`, `prisma/migrations/*`.
**Acceptance (тест-доказательство):**
- Файл миграции создан, SQL = `ALTER TABLE … ADD COLUMN "deletedAt" TIMESTAMP`, без `DROP`/потери данных; повторный `migrate deploy` — no-op (идемпотентно).
- `bun run prisma:generate` + `bun run typecheck` зелёные (типы `Regulation.deletedAt` доступны).
- `git show --stat` миграции в `prod-deploy-log.md` Шаг 4.
**Закрывает:** часть R5/R6 (инфраструктура).
**Prod:** новая колонка → `prod-deploy-log.md` Шаг 4; применяется авто на `docker compose up` (`migrate deploy`).

---

### Ф6 — Бэкенд: soft-delete + restore регламентов/решений `[x]`
**Цель:** owner/admin может удалить и восстановить карточку знания; удалённые исчезают из всех выдач.
**Картография:** контроллер регламентов [regulations.controller.ts:124-206](../../backend/src/modules/regulations/regulations.controller.ts#L124) (есть `requireWrite(user.id, t, kind)` — RBAC owner/admin); сервис `regulations.service.ts` (методы `supersede`/`confirm`/`dispute`/`correct`, фильтры list/search/count); `decisions.controller.ts`/`decisions.service.ts` (аналогично). Эталон endpoint+grace — `cards.controller.ts:232-248` (`softDelete`/`restore`).
**Что входит:**
1. `regulations`: `@Delete(':id')` (body `{kind}`) → `requireWrite(owner/admin)` → `service.softDelete({tenantId,id,kind,actorUserId})` ставит `deletedAt=now,deletedById=userId`; `@Post(':id/restore')` → снимает `deletedAt`. `decisions`: симметрично.
2. **Исключить `deletedAt != null` из ВСЕХ чтений**: list/search/getById/getHistory/count/summary в `regulations.service.ts` и `decisions.service.ts`, плюс любые места, где эти карточки попадают в **chat-v2/поиск/цитаты** (грепом найти чтения `prisma.regulation`/`process`/`policy`/`instruction`/`decision` без фильтра удаления; добавить `deletedAt: null`). Это — фикс **всего класса**, не одного списка.
3. Машинные коды ошибок: `not_found` (нет/уже удалён), `forbidden` (нет write-права), `restore_window_expired` (если grace истёк — см. Развилка F3).
**Что НЕ входит:** UI (Ф7); петля курации; физическое удаление; чистка блоков графа.
**Файлы:** `regulations.controller.ts`, `regulations.service.ts`, `regulations.dto.ts`, `decisions.controller.ts`, `decisions.service.ts`, соответствующие `*.spec.ts`.
**Acceptance (тест-доказательство):**
- Unit/e2e: owner удаляет регламент → `deletedAt` проставлен; тот же id больше НЕ приходит в list/search/count/getById; `restore` возвращает в выдачу. manager без write → 403 `forbidden`. Повторный delete уже удалённого → идемпотентно (no-op/`not_found`, выбрать и закрепить предикатом).
- Греп-гард: после фазы НЕТ чтений `prisma.regulation.findMany`/`count` (и аналогов для process/policy/instruction/decision) в публичных выдачах без `deletedAt` в `where` (перечислить проверенные call-site в отчёте фазы).
- `bun run typecheck` (вкл. spec) + `bunx vitest run` по затронутым spec зелёные; ревью `strict-production-review-gate` по delete-пути.
**Закрывает:** R5, R6.

---

### Ф7 — Фронт: кнопки «Удалить»/«Восстановить» регламента и решения `[ ]`
**Цель:** owner/admin видит и пользуется удалением/восстановлением в кабинете.
**Картография:** деталь регламента — действия «Подтвердить актуальность / Заменить новой версией / История версий / Исправить / Это неверно» (UI базы знаний `/regulations`, `frontend/src/api/regulations.api.ts`). Деталь решения — `/decisions`, `frontend/src/api/decisions.api.ts`. Эталон UI-удаления — `CardDetailClient.tsx` (`useConfirmDialog` + меню `⋯` «В архив»/«Удалить»; список с фильтром «Без архива»/«В архиве»).
**Что входит:**
1. `regulations.api.ts`/`decisions.api.ts`: `remove(id, {kind})` (DELETE) и `restore(id, {kind})` (POST).
2. На детали регламента/решения — действие «Удалить» (видно только при write-праве; роль приходит из `auth`-контекста), confirm через `useConfirmDialog` (текст про grace/восстановление по Развилке F3).
3. Фильтр статуса в списке: показать «Удалённые» + действие «Восстановить» (мирроррим cards «Без архива/В архиве»).
**Что НЕ входит:** массовые операции; удаление из графа/тем.
**Файлы:** `regulations.api.ts`, `decisions.api.ts`, UI-детали и списки `/regulations`, `/decisions` (точные клиентские компоненты определить грепом по странице).
**Acceptance (тест-доказательство):**
- `bun run typecheck` (frontend) зелёный.
- Живой re-test (Ф9): owner на мусорном регламенте → «Удалить» → confirm → карточка пропадает из «Действует»; фильтр «Удалённые» → «Восстановить» → карточка вернулась. Под ролью без write кнопки нет.
**Закрывает:** R5, R6 (UI).

---

### Ф8 — M2: 404 по ссылке-источнику на встречу `[ ]`
**Цель:** ссылка-источник из чата/карточки не должна вести в «Страница не найдена».
**Картография:** провенанс-резолвер `ProvenanceService` (`buildDeepLink`, фильтр прав зрителя — `0beca91a`), фронт-рендер «Откуда это»/источников (chat-v2 citations, list-DTO `previewSourceRef`). Наблюдение QA: `/meetings/01KTGNR4MGBQPAGCF5BDEFKPRV` → 404 (встреча отсутствует/в другой Org/удалена).
**Что входит (investigate-then-fix):** определить, почему deep-link на встречу резолвится в 404 — (а) устаревший id в старом блоке, (б) встреча недоступна зрителю/в другой Org, (в) встреча удалена. Сделать так, чтобы недоступный источник давал **понятное состояние** «источник недоступен», а не «битый» переход (либо не-кликабельный чип, либо страница встречи с graceful-403/«нет доступа»).
**Что НЕ входит:** переиндексация исторических блоков; изменение модели провенанса.
**Файлы:** `ProvenanceService`/резолвер deep-link + фронт-страница встречи (`/meetings/[id]`) graceful-состояние.
**Acceptance (тест-доказательство):**
- Воспроизведение: запрос источника на несуществующий meetingId → API отдаёт явный `not_found`/`forbidden` (не голый краш), фронт показывает «источник недоступен».
- `bun run typecheck` зелёный; при наличии — unit на резолвер.
- Живой re-test (Ф9): клик по такому источнику не ведёт в белый 404.
**Закрывает:** R8.
**Примечание:** low-prio; если корень — чисто данные (битый исторический id) и кода-фикса нет, фаза закрывается выводом «данные, не код» + строкой в `04_не-сделано`.

---

### Ф9 — Финальный живой re-test всего (после выката) `[ ]`
**Цель:** доказать на проде, что всё починилось (требование Р4).
**Что входит:** через `qa-tester` (Playwright, тестовый аккаунт «ооо ромашка») пройти: (1) Помощник компании в Консьерже отвечает на вопрос (Баг A); (2) стрим `/messages` = 200 + SSE (Баг B); (3) удаление задачи; (4) `[BLOCK:` отсутствует в ответе чата (M1); (5) удаление+восстановление регламента/решения; (6) недоступный источник без 404 (M2). Сверка с бэком при сомнении — `diag.ts` (read-only, с явным «можно в прод»).
**Acceptance:** все 6 пунктов зелёные глазами + сетевые статусы; скриншоты в `plans/analysis/2026-06-22-qa-fixes-verification/`.
**Закрывает:** приёмка R1–R8.

---

## Развилки (не решены владельцем — рекомендация + дефолт)

| # | Развилка | Рекомендация (дефолт для реализации) | Почему |
|---|---|---|---|
| F1 | Удалять ли **решения** (`Decision`) тем же механизмом, что регламенты? | **Да, симметрично** (Ф5–Ф7 включают Decision). | У decisions та же проблема (только `dispute`, нет delete); владелец сказал «регламентов и по-хорошему решений». Поправьте, если только регламенты. |
| F2 | Нужен ли **restore** для регламентов/решений? | **Да**, мирроррим cards (30 дней + фильтр «Удалённые»). | Консистентность с уже работающим паттерном cards; защита от случайного удаления. |
| F3 | Grace-окно и что после него (авто-purge?) | **30 дней** как у cards; авто-purge **не** делаем в этом ТЗ (soft-delete живёт, restore доступен). Срок — **крутилкой в AdminSetting** (`knowledge.softdelete_grace_days`, code-fallback 30), не ENV/хардкод. | Принцип Z «крутилки в AdminSetting» ([[feedback_admin_settings_not_env_or_code]]); purge — отдельный vNext-ТЗ при запросе. |
| F4 | Кто может удалять | **owner/admin** (write на ресурс); manager — только `dispute`. | `regulations.controller.requireWrite` уже так разводит; удаление знаний — сильное действие. |
| F5 | Что делать с **блоками графа**, на которых построена удалённая карточка | В scope — прячем **карточку** (фильтр `deletedAt`); блоки графа НЕ трогаем (для них есть `mark-wrong`/`dispute`). | Минимальный blast-radius; смешивать удаление карточки и чистку графа — отдельный риск. Поправьте, если удаление карточки должно гасить и блоки. |

---

## Прод-операции
- **Ф5** — миграция `add_softdelete_to_knowledge_cards` (новые колонки) → `prod-deploy-log.md` **Шаг 4**; применяется авто на `docker compose up -d --build` (`migrate deploy`). Бэкфилла нет (nullable).
- **Ф3 крутилка F3** — если вводится `knowledge.softdelete_grace_days`: строка в `admin-setting-schema-registry.ts` + сид + UI-поле + `prod-deploy-log.md` Шаг 1/7.
- Ф1/Ф2/Ф4/Ф7/Ф8 — без миграций/ENV/seed (после Ф5 — обычный `docker compose up -d --build`).
- **Флаги:** удаление — действие под RBAC (owner/admin), **не** глобальный флаг; выкатывается **включённым** (Ship-On). Новых kill-switch не вводим.

## Pre-mortem / Риски
- **R-1 (Ф6, высокий):** пропустить хотя бы одно чтение без `deletedAt` → удалённый мусор всё равно течёт в chat-v2/поиск/цитаты. Митигация: греп-гард на ВСЕ `prisma.{regulation,process,policy,instruction,decision}.{findMany,findFirst,count,findUnique}` в выдачах + перечень call-site в отчёте фазы (чиним класс, не кейс — [[feedback_fix_the_whole_class_not_the_case]]).
- **R-2 (Ф1):** `resourceOwnerId=input.userId` для мутирующих инструментов не должен давать лишнего — но мутирующие ресурсы (task и пр.) открыты на `*`, а реальную проверку всё равно делает guard эндпоинта; readOnly-инструменты (chat) и так self. Покрыть тестом, что create-инструмент не получил доступ к чужому ресурсу.
- **R-3 (Ф2):** активный orgId на момент стрима должен быть уже выставлен (`setApiClientOrgId`) — проверить, что геттер не отдаёт `null` на момент первого вызова Консьержа.
- **Ревью-аспекты для `strict-production-review-gate`:** delete-эндпоинты (Ф6) — tenant-изоляция (`tenantId` в `where` всегда), idempotency, отсутствие cross-tenant; RBAC-правка (Ф1) — нет расширения прав.

## DoD
- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` — зелёные в backend и frontend.
- Затронутые `*.spec.ts` зелёные (`bunx vitest run`).
- second-brain обновлён по таблице производных заметок: `01_projects/admin.md`/`api-layer.md` (новые эндпоинты delete/restore), `02_architecture/data-model.md` (новые колонки), `01_projects/tracker.md`/база знаний — где затронуто; `docs/operations/prod-deploy-log.md` Шаг 4 (+Шаг 1/7 если крутилка).
- Ф9 пройдена на проде, скриншоты сохранены.
- Без нарративных комментариев в коде; крутилка (если есть) — в AdminSetting, не ENV/код.

## Итог
Не реализовано (контракт-документ). Корни Багов A/B доказаны живыми API-вызовами; удаление спроектировано миррором cards (soft-delete+restore) с миграцией (RC-4 — у регламентов/решений `deletedAt` сейчас НЕТ). Реализация — по фазам Ф1→Ф9, начинать по явному «начни реализацию» владельца (передаётся `tz-orchestrator`).

---

## Решения оркестратора (2026-06-22, верифицировано картографией кода)

Картография 12 агентов подтвердила якоря с уточнениями. Развилки F1–F5 принимаю по дефолтам ТЗ + корректировки:

**Дрейф якорей (исправлено):**
- Ф1: вызов `rbac.check` в `tool-router.service.ts` на **строках 75-82** (4 поля, без `resourceOwnerId`); spec-ассерты `toHaveBeenCalledWith({userId,tenantId,obj,act})` на `tool-router.service.spec.ts:92-97,235-240` — обновить синхронно.
- Ф2: `getApiClientOrgId` **УЖЕ существует** (`api-client.ts:36-38`) — **не добавлять**, только импортировать+применить в `streamConciergeMessage` (`concierge.api.ts:82-97` — единственный сырой fetch мимо ApiClient).
- Ф4: эталон уже есть — `stripBlockMarkers` (`chat-v2.service.ts:398-413`), её regex стр.407 `/\[BLOCK:[a-z0-9]+\]/gi` уже́ эталона клонов; **расширять её** (не плодить новую), плюс синхронно `clones.service.ts:1128`. Тест `chat-v2-strip-markers.spec.ts` существует. Стрим `/messages/stream` отдаёт ответ ОДНИМ `done`-событием (per-chunk сборки текста нет) → очистка целого текста корректна.
- Ф6: `regulations`/`decisions` сервисы и dto лежат в подпапках `services/`/`dto/`. Централизованные where-хелперы `regulationsWhere/processesWhere/policiesWhere/instructionsWhere` (`regulations.service.ts:918-973`) — добавить `deletedAt:null` в каждый покрывает list/count разом; **Decision своего хелпера НЕ имеет** → точечно по call-site. RAW SQL (`tableFor`, KNN-дедуп, FROM "decisions") — `AND "deletedAt" IS NULL` вручную. Отдельно: `search.service.ts` (своё where), `provenance.service.ts` (цитаты chat-v2), `projection-rebuilder.service.ts`, дашборды decision. Полный список call-site — в картографии (область C10), передаётся кодеру.
- Ф8: **корень — код, не данные.** `buildProvenanceDeepLink` (`provenance.service.ts:156`) строит `/meetings/{id}?t=N` **без `/result`**, а единственный роут детали — `/meetings/[id]/result`. Фикс 1 строкой (`/meetings/${id}/result?t=`) + голые `/meetings/{id}` в `CoraFeedWidget.tsx:362` и `FeedWidget.tsx:130`. Graceful-состояние «источник недоступен» УЖЕ есть (`MeetingResultPageReal.tsx:239-253`), бэкенд УЖЕ отдаёт структурный `not_found`/`forbidden` (не голый 404). Старые `previewSourceRef.deepLink` в БД — нормализовать на фронте в маппере `mapPreviewToProvenanceRef` (без backfill). Вторая гипотеза (ULID `01KTGNR4…` ≠ cuid `meeting.id`) — проверить diag после код-фикса; если данные — строка в `04_не-сделано`.

**Развилки (приняты):**
- **F1 — да, `Decision` симметрично** регламентам (Ф5–Ф7 включают Decision).
- **F2 — да, restore** есть (мирроррим cards + фильтр «Удалённые»).
- **F3 — grace-окно: НЕ ввожу AdminSetting-крутилку в этом ТЗ.** Обоснование: auto-purge не делаем → grace ничего не *гейтит* (restore доступен всегда), значит это не операционная крутилка, а лишь UI-копия. Мирроррю cards: текст «Восстановить можно в течение 30 дней» (как у cards). Ошибку `restore_window_expired` **не ввожу** (без purge она недостижима). Knob+purge — отдельный vNext-ТЗ при запросе владельца.
- **F4 — owner/admin** (`requireWrite`/`canWrite`), manager — только dispute.
- **F5 — блоки графа НЕ трогаем** (прячем только карточку фильтром `deletedAt`).

**Аудит:** новые типы `REGULATION_DELETE/RESTORE`, `DECISION_DELETE/RESTORE` в `audit.types.ts` (образец `CARD_*`). `@RequireSubscription` — на delete (у decisions), НЕ на restore.
