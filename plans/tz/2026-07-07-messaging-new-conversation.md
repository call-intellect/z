---
type: tz
status: ready-to-implement
feature: messaging-new-conversation
date: 2026-07-07
owner: Сергей (владелец)
relates_to:
  - plans/architecture/2026-07-07-messaging-new-conversation.md
  - plans/analysis/2026-06-09-support-desk-clone-and-closed-contour.md
---
> Архитектура (одобрена владельцем): `plans/architecture/2026-07-07-messaging-new-conversation.md` (`status: approved`, 2026-07-07) · Статус согласования: 2026-07-07 (обе двери + отсрочка «компания↔компания» подтверждены в чате)

# ТЗ: «Новое сообщение» — точка входа в переписку (коллега + внешний/клиент)

## Принцип

Приделываем **недостающий вход** в готовый мессенджер. Бэкенд под обе двери уже написан; задача — привязать его к UI. Не переписываем движок, не строим новый контур. Минимальное безопасное изменение поверх существующих контрактов.

## Цель + Зачем

Сотрудники сообщают, что раздел «Сообщения» «не доделан — некому и негде написать». Диагностика на проде (кабинет владельца, «Ооо луа», 7 июля) подтвердила: беседы заводит только система (чат задачи/карточки/тикет), а **создать переписку вручную нельзя** — во фронте нет кнопки. При этом бэкенд создания личек/групп/каналов и внешних чатов готов, а FE-функция `createConversation` определена, но **не вызывается ни разу** (мёртвый код против Ship-On).

Возвращаем два действия сотрудника из раздела «Сообщения»:
1. написать **коллеге** (личка) или **нескольким** (группа);
2. написать **внешнему человеку/клиенту** по одноразовой ссылке (он может ответить без пароля и при желании завести аккаунт).

## REALITY-CHECK (что уже есть / мертво / сломано)

**Готово на бэкенде (переиспользуем как есть, не трогаем контракт):**
- `POST /api/v1/conversations` — `backend/src/modules/messaging/conversation.controller.ts:98` (`create`). Принимает `{kind: dm|group|channel, title?, memberUserIds[]}`, создатель→`owner`. Сервис `ConversationService.createConversation` — `backend/src/modules/messaging/services/conversation.service.ts:27`. Валидирует членство в Org (`USER_NOT_IN_TENANT`, там же `assertUsersInTenant`).
- `POST /api/v1/external-conversations` — `backend/src/modules/messaging/external/external-conversation.controller.ts:36` (`start`). Тело `{clientContact:{email?|phone?}, title?, message?}` → ответ `{conversationId, inviteLink}`. Сервис `ExternalConversationService.startExternalConversation` — `backend/src/modules/messaging/external/external-conversation.service.ts` (сам шлёт приглашение `sendInvite`, ссылку строит `AccessLinkService.buildUrl` → `${publicHostUrl}/c/<token>`). Флаг `EXTERNAL_CHAT_ENABLED` — 🟢 ВКЛ (`docs/operations/feature-flags.md:156`).
- `GET /api/v1/org-members/search?q=&limit=` — `backend/src/modules/org-members/org-members.controller.ts:25`. Возвращает `items: (user|person)[]` (см. `frontend/src/api/org-members.api.ts:27`). Создан именно под `ParticipantPicker`.
- Канал «Вся компания»: `ConversationService.ensureCompanyChannel` (`conversation.service.ts:142`, идемпотентно), авто-подписка при найме — `HrMembershipListener` (`backend/src/modules/messaging/listeners/hr-membership.listener.ts:23`) за флагом `hr_auto_subscribe_enabled` (default `true`). `findCompanyChannel` — `conversation.service.ts` (kind=channel, isMandatory).

**Готово на фронте (переиспользуем):**
- `ParticipantPicker` — `frontend/src/ui/shared/ParticipantPicker.tsx`. Отдаёт `ParticipantPickerValue[]` c типами `user`(userId)/`person`(personId). **Нет** пропа «только пользователи» — добавляем (Ф3).
- `messagingApi.createConversation` — `frontend/src/api/messaging.api.ts:109` (тело `CreateConversationBody`, `messaging.api.ts:2`). **Определён, 0 вызовов** — подключаем (Ф4).
- Гостевой внешний чат — `frontend/src/ui/external-chat/ExternalChatClient.tsx` (сторона клиента по `/c/<token>`). `externalChatApi` (`frontend/src/api/external-chat.api.ts`) — **только гостевые** методы (`access/list/send/register`), employee-старт **отсутствует** → добавляем (Ф3).

**Сломано/дыра (это и чиним):**
- В `frontend/src/ui/messaging/MessagesClient.tsx` (835 строк) нет кнопки создания беседы. Вкладки `TABS` (`MessagesClient.tsx:58-60`: dm/group/channel) и поиск `feedQuery` (`MessagesClient.tsx:262`) — только **фильтры существующих** тредов.
- `Conversation` (schema `backend/prisma/schema.prisma`, модель `Conversation`, ~строка 12676) **не имеет** уникального ограничения на dm → повторный старт лички плодит дубликаты. Дедуп — логикой в сервисе (Ф1).
- У старых Org канала «Вся компания» нет (листенер срабатывает только на новые членства) → бэкфилл (Ф2).

**Параллельных веток/PR на эту фичу нет** (`git log`, ветка `work/2026-07-02`).

## Принятые решения владельца

| # | Решение | Обоснование | Дата |
|---|---|---|---|
| Р1 | Пикер в режиме «Коллега» показывает **только `type:user`** (есть аккаунт). `person` без аккаунта скрыт. | Выбор «напиши» не должен вести в никуда — мёртвый выбор = та же жалоба. | 2026-07-07 |
| Р2 | Один выбранный → `dm`; несколько → `group`. Название группы необязательно; пустое → собрать из имён участников на фронте. | Привычная логика мессенджера; лишний шаг «выбери тип» не нужен. | 2026-07-07 |
| Р3 | Повторная личка с тем же человеком **переиспускается** (backend-дедуп). | Единая история переписки. | 2026-07-07 |
| Р4 | Канал «Вся компания» **дожать разово** для всех существующих Org + включить всех членов. | Задумка есть в коде, не отработала на старых Org; выкат «как задумано». | 2026-07-07 |
| Р5 | Выкат **сразу включённым** (Ship-On), без флага-переключателя новой фичи. Внешняя дверь — поверх уже включённого `EXTERNAL_CHAT_ENABLED`. | Возврат ожидаемой функции, не эксперимент. | 2026-07-07 |
| Р6 | «Новое сообщение» — одна кнопка с переключателем режимов «Коллега» / «Внешний/клиент». | Обе двери — один вход для пользователя. | 2026-07-07 |
| Р7 | Внешняя дверь использует `EXTERNAL_CHAT_ENABLED` как есть; новый контур не строим. | Бэкенд готов, флаг ВКЛ. | 2026-07-07 |
| Р8 | «Компания↔компания» (тенант↔тенант) и служба поддержки/деск — **вне scope**, отложены. | Прямое решение владельца (Р-1 анализа 2026-06-09). | 2026-07-07 |

## Доказательство выбора (ключевые развилки)

**Дедуп личек — где (Проход A: бэкенд-логика · Проход B: БД-constraint).**

| Критерий | A: дедуп в `ConversationService` | B: `@@unique` в Prisma |
|---|---|---|
| Модель данных | участники в join-таблице `ConversationMember` | ✗ уникальность по паре юзеров в M2M не выражается одним `@@unique` |
| Сложность миграции | нет миграции | ✗ нужен производный ключ (напр. отсортированная пара) + backfill |
| Гонки | закрыть транзакцией + повтор поиска | зависит от синтетического ключа |
| Тенант-изоляция | явный `tenantId` в запросе | требует включения tenantId в ключ |

Выбор — **A**: метод `findExistingDm(tenantId, [a,b])` перед созданием; для `kind=dm` с ровно двумя участниками сначала ищем существующую, иначе создаём. Обоснование: M2M-уникальность в Prisma без синтетического ключа не выражается (проверено по модели `Conversation`/`ConversationMember`), а логика дедупа локальна и тестируема.

**Фильтр «только пользователи» — где (A: проп у `ParticipantPicker` · B: фильтр в модалке).** Выбор — **A** (проп `onlyUsers?: boolean`): пикер переиспользуется в 9 местах, а «показывать только людей с аккаунтом» — переиспользуемое поведение; фильтровать результат снаружи после отрисовки person-строк = мёртвые строки в выпадашке. Challenge: не ломаем текущих потребителей — проп опционален, default `false` (текущее поведение).

## Scope

**Входит:** кнопка «Новое сообщение» с переключателем режимов; режим «Коллега» (пикер `type:user`, dm/group, дедуп dm, открытие треда); режим «Внешний/клиент» (email/телефон + первое сообщение → старт внешнего чата, показ+копирование `inviteLink`); проп `onlyUsers` у `ParticipantPicker`; бэкфилл канала «Вся компания».

**Не входит (каждый хвост — судьба):**
- «Компания↔компания», служба поддержки/деск + клон — отложено (Р8), отдельные ТЗ при необходимости.
- Управление участниками группы через UI (переименование, add/remove после создания) — бэкенд-метод `addMember` есть (`conversation.controller.ts:130`), UI — vNext, не здесь.
- Приглашение сотрудников (не клиентов) в кабинет — онбординг, вне scope.
- Реакции/опросы/хадлы/поиск-по-списку — существующее/отдельное.

## Граничные контракты с другими ТЗ

- Внешний чат — **только вызываем** `POST /external-conversations` и рендерим ответ. Гостевую сторону (`/c/<token>`, `ExternalChatClient`) и `EXTERNAL_CHAT_ENABLED` **не трогаем** — они готовы (ТЗ `unified-chat` Ф3.5).
- Служба поддержки (`SUPPORT_DESK_*`, `support.vendor_org_id`) — **не касаемся**; это отдельный контур (ТЗ `support-desk-clone`).

## Контракты (единый источник правды)

**Backend — дедуп dm (Zod-DTO не меняется, меняется поведение `create`).**
Тело `POST /conversations` остаётся `CreateConversationSchema` (`backend/src/modules/messaging/dto/conversation.dto.ts`). Новый метод сервиса:
```ts
// conversation.service.ts
async findExistingDm(tenantId: string, memberIds: [string, string]): Promise<{ id: string } | null> {
  const [a, b] = memberIds;
  return this.prisma.conversation.findFirst({
    where: {
      tenantId,
      kind: 'dm',
      AND: [
        { members: { some: { userId: a } } },
        { members: { some: { userId: b } } },
        { members: { every: { userId: { in: [a, b] } } } },
      ],
    },
    select: { id: true },
  });
}
```
`createConversation` при `kind==='dm'` и ровно 2 итоговых участниках (`createdByUserId` + один) сначала зовёт `findExistingDm`; найдено → возвращает существующий `Conversation`, иначе создаёт как сейчас. Ответ контроллера `{conversationId}` не меняется.

**Frontend — employee-старт внешнего чата (новый метод в API-слое).**
Добавить в `frontend/src/api/messaging.api.ts` (или новый `external-conversations.api.ts`):
```ts
export interface StartExternalBody { clientContact: { email?: string; phone?: string }; title?: string; message?: string; }
export interface StartExternalResponseApi { conversationId: string; inviteLink: string; }
// startExternal: (orgId, body) => apiClient.post<StartExternalResponseApi>("/api/v1/external-conversations", body, { headers: { "X-Org-Id": orgId } })
```
Заголовок Org — как в соседних вызовах `messaging.api.ts` (сверить фактический способ передачи `orgId` в `apiClient`).

**Frontend — `ParticipantPicker` проп:**
```ts
export interface ParticipantPickerProps { /* …существующие… */ onlyUsers?: boolean; }
```
При `onlyUsers` фильтровать результаты поиска до `type==='user'` (в `toValueFromSearch`/рендере списка) и не показывать person-строки.

**Backfill-скрипт `backend/scripts/backfill-company-channel.ts`:**
```ts
import { createPrismaClient } from './_lib/prisma';
// для каждой Org: выбрать creator (owner/admin membership) → ensureCompanyChannel(orgId, creatorUserId)
//   → для каждого membership орга addMember({conversationId, userId, source:'auto'}) (upsert, идемпотентно)
// повторный прогон = no-op
```
Регистрация в `backend/scripts/apply-prod-deploy.ts` `STEPS`: `{ phase: 'backfill', script: 'scripts/backfill-company-channel.ts' }`.

## Границы фичи

- ✅ Always: переиспользовать существующие контроллеры/сервисы/`ParticipantPicker`; русский UI; парные токены `bg-*`/`text-*-fg`; tenant через существующий guard.
- ⚠️ Ask first: любое изменение контракта `POST /conversations`/`/external-conversations`; новые поля в `Conversation`/`ConversationMember`.
- 🚫 Never: новый флаг «на всякий случай»; `process.env.*` мимо `env.schema.ts`; `new PrismaClient()` в скрипте; трогать гостевую сторону внешнего чата и support-desk; `git add -A`.

## Требования (EARS)

- **R1.** Когда сотрудник в `/messages` нажимает «Новое сообщение», система shall открыть модалку с переключателем «Коллега»/«Внешний/клиент» (default «Коллега»).
- **R2.** В режиме «Коллега» когда сотрудник ищет людей, система shall показывать только членов Org с аккаунтом (`type:user`), исключая `person` без аккаунта.
- **R3.** Если выбран ровно один коллега, then при подтверждении система shall создать/открыть `dm` и перейти в тред; если у сотрудника уже есть `dm` с этим человеком — открыть существующий (без дубликата).
- **R4.** Если выбрано ≥2 коллег, then система shall создать `group`; при пустом названии — сформировать заголовок из имён участников на фронте перед отправкой.
- **R5.** В режиме «Внешний/клиент» когда сотрудник ввёл корректный email или телефон и подтвердил, система shall вызвать `POST /external-conversations`, показать вернувшийся `inviteLink` с кнопкой «Скопировать» и открыть созданный тред.
- **R6.** Если `EXTERNAL_CHAT_ENABLED` выключен (ответ `503 EXTERNAL_CHAT_DISABLED`), then система shall показать понятное русское сообщение и не ломать модалку.
- **R7.** Когда backfill-скрипт отрабатывает по Org, система shall гарантировать наличие канала «Вся компания» и членство всех текущих сотрудников; повторный прогон shall быть no-op.
- **R8.** Система shall валидировать ввод: в режиме «Внешний» — email ИЛИ телефон (иначе кнопка неактивна/ошибка `Нужен email или телефон клиента`).

## Фазы

Граф зависимостей: **Ф1 ∥ Ф2** (независимы, бэкенд) → **Ф3** (FE api/domain, зависит от Ф1 контракта дедупа поведенчески, но не по коду) → **Ф4** (FE UI, зависит от Ф3) → **Ф5** (e2e, зависит от Ф4). Ф1 и Ф2 можно вести параллельно; Ф2 самодостаточна.

### Ф1 — Backend: дедуп личек (`dm`) `[x]`
**Ценность:** как сотрудник, повторно открывая переписку с коллегой, попадаю в ту же ветку, а не в новый пустой дубль.
**Что входит:** метод `findExistingDm` (сниппет выше) в `ConversationService`; ветка дедупа в `createConversation` для `kind='dm'` c 2 участниками; unit-тест.
**Что НЕ входит:** изменение DTO/ответа контроллера; дедуп group/channel.
**Файлы:** `backend/src/modules/messaging/services/conversation.service.ts:27` (метод `createConversation`, якорь `Array.from(new Set([args.createdByUserId`), + новый метод рядом); тест `conversation.service.spec.ts`.
**Acceptance:**
- `bunx vitest run src/modules/messaging/services/conversation.service.spec.ts` — зелёный; новый тест: два подряд `createConversation({kind:'dm', members:[a,b]})` → один и тот же `id`.
- Негатив: `dm` с другим вторым участником → другой `id`; `group` из тех же людей → всегда новый `id`.
- `grep -n "findExistingDm" conversation.service.ts` → определён и вызывается.
**Закрывает:** R3.

### Ф2 — Backend: бэкфилл канала «Вся компания» `[x]`
**Ценность:** как сотрудник существующей компании, вижу канал «Вся компания» и могу написать всем сразу.
**Что входит:** `backend/scripts/backfill-company-channel.ts` (сниппет-контур выше, `createPrismaClient()` из `./_lib/prisma`, импорты из `../src`); регистрация в `apply-prod-deploy.ts` `STEPS` (`phase:'backfill'`).
**Что НЕ входит:** изменение логики листенера/флага `hr_auto_subscribe_enabled`.
**Файлы:** новый `backend/scripts/backfill-company-channel.ts`; `backend/scripts/apply-prod-deploy.ts` (массив `STEPS`, якорь `phase: 'backfill'`); переиспользовать `ConversationService.ensureCompanyChannel`/`addMember`.
**Acceptance:**
- Идемпотентность: два прогона подряд → второй не создаёт вторую беседу и не дублирует членов (лог `created:0` на повторе). Проверка на dev-БД.
- `grep -n "backfill-company-channel" backend/scripts/apply-prod-deploy.ts` → зарегистрирован с `phase:'backfill'`.
- `require.main`-guard, чтобы импорт не запускал прогон (память `project_local-toolchain`).
**Закрывает:** R7.

### Ф3 — Frontend: API + domain для обеих дверей `[x]`
**Ценность:** как разработчик UI, имею типизированные вызовы «создать беседу» и «начать внешний чат» и переиспользуемый пикер только-пользователей.
**Что входит:** проп `onlyUsers` в `ParticipantPicker`; employee-метод `startExternal` в api-слое (сниппет выше) + типы; при необходимости domain-маппер. `createConversation` уже есть — не дублировать.
**Что НЕ входит:** сам UI модалки (Ф4).
**Файлы:** `frontend/src/ui/shared/ParticipantPicker.tsx` (props + фильтр `toValueFromSearch`/рендер); `frontend/src/api/messaging.api.ts` (добавить `startExternal`) или новый `external-conversations.api.ts`; следовать `frontend-rules` (ApiDto→DomainModel→UiModel, единый `apiClient`).
**Acceptance:**
- `cd frontend && bun run typecheck && bun run lint` — зелёные.
- `grep -n "onlyUsers" src/ui/shared/ParticipantPicker.tsx` — проп есть, default не ломает 9 текущих потребителей (сборка зелёная).
- `grep -n "external-conversations" src/api/*.ts` — метод старта добавлен.
**Закрывает:** R2 (частично), R5 (контракт).

### Ф4 — Frontend: модалка «Новое сообщение» `[x]`
**Ценность:** как сотрудник, из «Сообщений» начинаю переписку с коллегой или внешним клиентом.
**Что входит:** кнопка «Новое сообщение» в шапке `MessagesClient` (рядом с заголовком, `MessagesClient.tsx:247-255`); модалка с переключателем режима; режим «Коллега» (`ParticipantPicker onlyUsers`, поле названия для группы, submit → `createConversation` → навигация в тред, dm/group по числу выбранных, заголовок группы из имён при пустом); режим «Внешний/клиент» (email/телефон + первое сообщение, submit → `startExternal`, показ `inviteLink` + «Скопировать», обработка `503`); все состояния (loading/ошибка/пусто) по-русски.
**Что НЕ входит:** управление участниками созданной группы; изменения списка/фильтров.
**Файлы:** `frontend/src/ui/messaging/MessagesClient.tsx` (+ новый под-компонент `NewConversationDialog.tsx` в `src/ui/messaging/`); Radix Dialog как в проекте; навигация в открытый тред существующим механизмом (`onOpen`/refId в `MessagesClient`).
**Acceptance:**
- `bun run typecheck && bun run lint && bun run build` (frontend) — зелёные.
- Playwright/ручной проход на dev или проде (тестовый аккаунт): кнопка видна; «Коллега» → выбор одного → тред dm открыт; выбор двух → group; повторный выбор того же → тот же тред (визуально та же история).
- Режим «Внешний»: ввод email → показана ссылка `/c/<token>` с «Скопировать».
- В выпадашке пикера нет строк-контактов без аккаунта.
- Консоль без красных ошибок (`browser_console_messages`).
**Закрывает:** R1, R2, R3, R4, R5, R6, R8.

### Ф5 — Приёмка e2e (три сотрудника пишут друг другу) `[ ]`
**Ценность:** как владелец, вижу, что жалоба закрыта — люди пишут друг другу.
**Что входит:** сквозной сценарий: три сотрудника (или тестовый + владелец) — A пишет B «привет», B видит и отвечает «привет», A создаёт группу A+B+C и пишет «тест»; внешняя дверь — старт по email, открытие по ссылке.
**Что НЕ входит:** нагрузочное/авто-e2e в CI (ручная приёмка достаточна для этой фичи).
**Файлы:** нет кода; артефакт — заметка приёмки в `plans/analysis/` или рефлексия.
**Acceptance:** все пункты «Как поймём» из архитектуры выполнены; скриншоты приложены.
**Закрывает:** R1–R8 (интеграционно).

## Сквозные аспекты

- **RBAC/tenant:** контроллеры уже под `CookieAuthGuard`+`TenantGuard`; `createConversation`/`findExistingDm` фильтруют по `tenantId` (обязательно в `where`). Внешний старт — под `RequireSubscription`. `[Проверить: dm/group не должны требовать owner/admin — обычный член Org может начать личку]`.
- **Observability:** переиспользуем существующее логирование сервисов; отдельные метрики не вводим `[N/A: нет нового воркера/очереди]`.
- **Ошибки/идемпотентность:** дедуп dm (Ф1) и backfill (Ф2) идемпотентны как acceptance; внешний `503` обработан (R6).
- **Миграции данных:** backfill канала (Ф2) — единственная; новых колонок нет `[N/A: схема не меняется]`.
- **Rollout/флаг:** Ship-On, новый флаг не вводим (Р5); внешняя дверь поверх включённого `EXTERNAL_CHAT_ENABLED`. Строка в `docs/operations/feature-flags.md` не добавляется (нового флага нет) — отметить в PR.
- **Тесты:** Ф1 unit; Ф3 typecheck/lint; Ф4 build + ручной; Ф5 e2e-приёмка.

## Pre-mortem / Риски

- **Дедуп dm под гонкой:** два одновременных старта лички → две беседы. Митигация: поиск+создание в одной транзакции или пост-фактум-схлопывание не делаем в v1 (низкая вероятность); `[ASSUMPTION: гонка старта одной и той же личкой пренебрежимо редка; при жалобах — обернуть в транзакцию с повторным поиском]`.
- **`orgId` в новом FE-вызове:** свериться, как соседние методы `messaging.api.ts` передают Org (заголовок vs путь) — не изобретать.
- **`onlyUsers` ломает потребителей:** проп опционален, default = текущее поведение; сборка ловит регресс.
- **Backfill на большом числе Org:** батчить по Org, логировать прогресс; ошибка одной Org не валит весь прогон (try/catch на Org).

## Ревью-аспекты (для strict-production-review-gate)
tenant-фильтр в `findExistingDm`; отсутствие утечки чужих Org в пикере; отсутствие нового `process.env`/`new PrismaClient()`; идемпотентность backfill; обработка `503`/сетевых ошибок в модалке; русский UI и парные цвет-токены.

## Idempotency / feature-flag / prod-deploy
- Новый флаг — **нет** (Р5).
- **prod-deploy-log.md Шаг 8 (backfill):** добавить `bun run scripts/backfill-company-channel.ts` — «дожать канал «Вся компания» + членства для всех Org; идемпотентно». Прогон через `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update` (backfill входит в update).
- Схема БД не меняется → Шаги 4/5 не трогаем.

## DoD
- `bun run typecheck` (вкл. `.spec`), `lint`, `build` — зелёные (backend и frontend).
- `bunx vitest run` затронутых spec — зелёные.
- second-brain обновлён по таблице производных заметок: `01_projects/` мессенджера/conversational-channels (новый вход), при необходимости `module-map` (новый FE-компонент), `prod-deploy-log.md` Шаг 8.
- Рефлексия в `05_история/`.
- Приёмка Ф5 со скриншотами.

## Итог

**Ф1–Ф4 реализованы, машинно проверены и закоммичены** (ветка `work/2026-07-07`), Ф5 — ждёт выката.

- **Ф1** `d3fc4a1d` — `findExistingDm` + дедуп dm в `createConversation`; 3 unit-теста (vitest 10/10 зелёный).
- **Ф2** `35b65201` — `scripts/backfill-company-channel.ts` (переиспользует `ensureCompanyChannel`) + регистрация в `apply-prod-deploy.ts` STEPS `phase:'backfill'`. Идемпотентность доказана на dev-БД (26 Org: прогон #2 `created:0`, 0 дублей каналов/членов).
- **Ф3** `1d1bd27e` — проп `onlyUsers` у `ParticipantPicker` + `startExternal` в `messaging.api.ts`.
- **Ф4** `bef677d1` — `NewConversationDialog.tsx` + кнопка в `MessagesClient`; оба режима, обработка `503`, inviteLink+копирование, навигация в тред.
- **Hardening по адверсариальному ревью** `ec9c0b7e` — исключение self-dm (`excludeUserIds`), обновление ленты на «Готово», честный текст email/телефон, сброс вкладки на «Всё» при переходе в новый тред.

**Приёмка:** backend `typecheck`/`lint`/`build` + `vitest` зелёные; frontend `lint`/`build` зелёные (typecheck-шум только в устаревшем `.next/types`, не в `src/`). Адверсариальное ревью: 12 находок → 5 CONFIRMED (все low), 3 исправлены, 2 гонки (partial unique index = схема, вне scope) вынесены в `second-brain/04_не-сделано`.

**Осталось — Ф5** (живая e2e-приёмка «три сотрудника пишут друг другу» + внешняя дверь): требует кода на dev/проде. Push и выкат — по слову владельца. Прод-операция: `apply-prod-deploy.ts --mode update` (backfill; схему/ENV не трогаем) — см. `docs/operations/prod-deploy-log.md`.
