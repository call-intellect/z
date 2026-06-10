# ТЗ 2026-06-10 — Зависание встречи в `scheduled` + дубли/статусы в разделе «Команда»

**Тип:** багфикс-пакет (2 независимые проблемы из одной сессии диагностики).
**Статус:** ✅ ФИНАЛИЗИРОВАНО — все решения владельца приняты (2026-06-10). Готово к реализации `tz-orchestrator`. Код НЕ написан.
**Источник:** жалоба владельца + read-only прод-диагностика (`backend/scripts/diag.ts`, прод `korateam.ru`, 2026-06-10).

---

## 0. Что произошло (факты из прода)

### Баг A — встреча не закрывалась
Владелец провёл видеовстречу, кнопка «Завершить» не закрывала её. Тост: *«Невозможно перевести встречу из состояния scheduled в completed»*; в консоли — `POST /api/v1/meetings/01KTR54GYJ47MMD76HADMVYAQH/finish → 409 (Conflict)` (4 повтора).

Прод-диагностика встречи `01KTR54GYJ47MMD76HADMVYAQH` («встреча с Максимом», team, владелец `svmazur@mail.ru`, создана 06:57:21Z):
- статус `scheduled`; транскрипт/отчёт отсутствуют;
- **технический след — 0 записей** (`diag chain --trace mtg_01KTR54GYJ...` → пусто) ⇒ backend не получил ни одного webhook LiveKit по этой встрече;
- в логах WARN с 06:57 — только заходы участников (`accounts/me`, `room-messages`), а в 07:24 — четыре `…/finish → 409`. **Ошибок 401 (невалидная подпись) нет** ⇒ вебхуки не доходят физически, а не отбраковываются по подписи;
- последние успешные `ai_ready`-встречи — 09.06 06:35 и 06:59Z; зависшая 10.06 — первая такая. `active` сейчас 0. Совпадает с переездом `meet.crossmark.ru → korateam.ru` (09.06).

**Корневая причина (инфра, вне кода):** LiveKit-сервер не доставляет вебхуки на backend (адрес/доступность изменились при переезде). Медиа работает (`wss://korateam.ru/rtc/v1`, `publishing track`), а обратный канал LiveKit→backend — нет.

**Корневая причина устойчивости (код):** единичная потеря вебхука вешает встречу намертво:
- `scheduled → active` делает ТОЛЬКО `room_started` ([livekit-events.handler.ts:171-207](../../backend/src/modules/webhooks/livekit-events.handler.ts#L171-L207)); `participant_joined` статус не двигает;
- `finish` требует `active`, иначе 409 ([host-controls.service.ts:91-106](../../backend/src/modules/meetings/host-controls.service.ts#L91-L106));
- FSM не имеет перехода `scheduled → completed` ([meeting-fsm.ts:25-44](../../backend/src/modules/meetings/fsm/meeting-fsm.ts#L25-L44));
- `room_finished` тоже no-op вне `active` ([livekit-events.handler.ts:211-230](../../backend/src/modules/webhooks/livekit-events.handler.ts#L211-L230));
- idle-cron подбирает только `status='active'` ([idle-meeting.cron.ts:41-48](../../backend/src/modules/meetings/cron/idle-meeting.cron.ts#L41-L48)) — брошенные `scheduled` не подбирает никто.

Следствие: при потере `room_started` встреча навечно `scheduled`, авто-запись (стартует там же, [строка 196](../../backend/src/modules/webhooks/livekit-events.handler.ts#L196)) не запускается → записи нет, AI нечего обрабатывать.

### Баг B — раздел «Команда»: дубли + «не приглашён» у всех
На скриншоте: на один email — две строки (`ainaz860707@gmail.com`: «ainaz860707/Администратор» + «Айназ/руководитель отдела внедрения»; `chydo_002@mail.ru`: «chydo_002/Администратор» + «Настя/менеджер тех.поддержки»). Статус «не приглашён» у всех, включая владельца.

**Корень дублей:** ростер объединяет строки только по `userId` ([orgs.service.ts:293-294](../../backend/src/modules/orgs/orgs.service.ts#L293-L294)), по email — нет. На один email заведено две активные `Person`: одна привязана к аккаунту (`userId`), вторая добавлена вручную («Добавить сотрудника», `userId=null`).

**Почему БД пропустила дубли:** `@@unique([tenantId, email, deletedAt])` ([schema.prisma:4834](../../backend/prisma/schema.prisma#L4834)) бесполезен — `deletedAt` nullable, а в Postgres `NULL ≠ NULL` в обычном уникальном индексе ⇒ несколько активных (`deletedAt IS NULL`) карточек с одним email проходят; `handleUniqueViolation` ([persons.service.ts:973-986](../../backend/src/modules/persons/services/persons.service.ts#L973-L986)) не срабатывает.

**Почему «не приглашён» у всех:** статус строки с карточкой берётся только из `p.invitations[0]?.status ?? 'none'` ([orgs.service.ts:285](../../backend/src/modules/orgs/orgs.service.ts#L285)), игнорируя `Membership`. У активных участников (владелец/админы вступили не через приглашение) записи `OrgInvitation` нет → всегда «не приглашён».

> Подход к Багу B проверен прототипом во время диагностики: правка ростера (статус по membership + дедуп по email) и 2 новых unit-кейса дали зелёный прогон `orgs.service.spec.ts` (6/6). Прототип откатан — это ТЗ, не код. Цифры в §«Тест-план» опираются на этот прогон.

---

## 1. Решения владельца (приняты 2026-06-10 — финал)

Все развилки закрыты владельцем «согласен со всеми рекомендациями». Зафиксировано как обязательные требования к реализации:

| # | Решение (принято) | Обоснование |
|---|---|---|
| **Р1** | При `finish` из `scheduled` (записи нет, `room_started` потерян): `scheduled → failed` с `failureReason='ended_before_start'`, ответ 200 (не 409). UI показывает **нейтральный** текст «Встреча завершена (запись не велась)», НЕ «ошибка». | В `scheduled` записи физически нет (egress стартует в `room_started`); пустая `completed` ушла бы в AI-пайплайн и упёрлась в «нет аудио». `failed` честно отражает «встреча технически не состоялась». |
| **Р2** | Reconcile-cron закрывает брошенную `scheduled` через **30 мин** (`IDLE_MEETING_TIMEOUT_MINUTES`). | Меньше — риск закрыть заранее созданную встречу; больше — мусор висит дольше. |
| **Р3** | Создание карточки с уже существующим в Org email → **409 `person_email_taken`** с понятным текстом. Исключение: задан `linkUserId` и найден безличный контакт (`userId=null`) с тем же email → линковать его, не плодить. | Тихий возврат скрыл бы факт дубля и запутал «почему карточка не появилась». |
| **Р4** | При слиянии дублей каноническая получает **человеческое имя** из ручной карточки («Айназ», не «ainaz860707»). | Аккаунтная карточка часто имеет `name` = локальная часть email. |

---

## 2. Фазы реализации

Порядок: сначала «Команда» (низкий риск, без зависимости от инфры), потом «Встречи». Внутри — по возрастанию риска.

### Ф1 — Ростер «Команда» (чтение): статус + дедуп по email ✅
**Файл:** `backend/src/modules/orgs/orgs.service.ts` (метод `listTeamRoster`, ~209-313).
**Изменения:**
1. Для Person-строки: `invitationStatus = membership ? 'accepted' : (p.invitations[0]?.status ?? 'none')` — активный участник всегда «активен».
2. Добавить приватный дедуп по нормализованному (`trim().toLowerCase()`) email: схлопывать строки с одинаковым непустым email в одну. База — строка с `userId` (носитель аккаунта/системной роли); должность/отдел/«человеческое» имя/карточка дополняются из «ручной» строки; статус `accepted`, если в группе есть аккаунт; `invitationId` — от «живого» приглашения (pending/expired). Порядок первого появления сохранять. Строки без email — как есть.
**Контракт:** существующие тесты не ломаются (email в фикстурах разные); добавить 2 кейса (см. §Тест-план).
**Риск:** низкий, только чтение. Дедуп на чтении — страховка; реальные дубли убирает Ф2+Ф3.

### Ф2 — БД: partial unique index по email ✅
**Файл:** `backend/scripts/postgres-init.sql` (в конец).
**Изменение:** `CREATE UNIQUE INDEX persons_tenant_email_active_uniq ON "persons" ("tenantId", lower("email")) WHERE "deletedAt" IS NULL AND "email" <> ''`.
**Устойчивость к порядку:** `postgres-init` запускается отдельно от backfill (внутри `apply-prod-deploy --with-schema` schema-фаза идёт раньше backfill — [apply-prod-deploy.ts:506-507](../../backend/scripts/apply-prod-deploy.ts#L506-L507)). Поэтому блок ОБЯЗАН не падать на существующих дублях: сначала считать группы-дубли, при `>0` — `RAISE NOTICE` и пропуск; индекс встанет на следующем прогоне `postgres-init` уже после Ф3. (Образец partial unique — `Vendor_tenantId_inn_unique_idx`, `Entity_strong_email_uniq`.)
**Prod-deploy:** Шаг 5.
**Риск:** низкий (idempotent + self-skip).

### Ф3 — Prod-merge существующих дублей `Person` ✅
**Новый файл:** `backend/scripts/backfill-merge-duplicate-persons.ts` (через `createPrismaClient()` из `_lib/prisma`, без подъёма AppModule).
**Логика (консервативная, не перетирает admin-данные):**
1. Активные `Person` (`deletedAt=null`, `email<>''`, опц. `--tenant=`) сгруппировать по `(tenantId, lower(email))`.
2. В группе >1 выбрать каноническую: ровно одна с `userId` → она; иначе старейшая по `createdAt`. Если `≥2` с `userId` (два аккаунта на email) — НЕ сливать, `warn` + пропуск (ручной разбор).
3. Каждую неканоническую: обогатить каноническую ТОЛЬКО в пустые поля (`primaryDepartmentId`, `jobTitle`, `company`; «слабое» имя-логин заменить человеческим — Р4); перенести активную должность (`Appointment`/`PersonRole`, `validTo=null`) на каноническую, только если у неё своей активной нет; пометить дубль `deletedAt=now` (soft-delete — FK не рвутся, строка уходит из ростера и из partial index).
4. `--dry-run` — только counts. Идемпотентен (повтор → нет групп >1).
**Регистрация:** `apply-prod-deploy.ts` STEPS, `phase:'backfill'`, `skipBootstrap:true`, ДО индекса по смыслу (комментарий про self-skip индекса).
**Prod-deploy:** Шаг 8.
**Риск:** средний (трогает прод-карточки) → строго soft-delete, обогащение только в null, dry-run для предпросмотра, перед прогоном — авто-бэкап schema-фазы.

### Ф4 — Дедуп при создании `Person` ✅
**Файл:** `backend/src/modules/persons/services/persons.service.ts` (`create` ~292; при необходимости `quickCreate`/`createBatch`).
**Изменения:** до вставки, если `email` задан, искать активную `Person` по `(tenantId, email)` (insensitive):
- ручное создание и нашлась → 409 `person_email_taken` (Р3);
- задан `linkUserId` и нашлась безличная (`userId=null`) с тем же email → линковать её (`userId=linkUserId`) вместо новой;
- иначе создавать как сейчас.
Это даёт дружелюбное поведение поверх БД-защиты Ф2 (которая после установки индекса всё равно поймает гонки через `handleUniqueViolation`).
**Риск:** низкий-средний (новая ветка валидации) → unit-тесты на 3 сценария.

### Ф5 — Встреча: `finish` устойчив из `scheduled`
**Файл:** `backend/src/modules/meetings/host-controls.service.ts` (`finish`), при необходимости `meeting-fsm.ts`.
**Изменения (по Р1 = вариант «а»):**
- из `active` — как сейчас (deleteRoom → webhook довершит; оставить);
- из `scheduled` — `deleteRoom` (best-effort, room могла не существовать) + перевести `scheduled → failed` с `failureReason='ended_before_start'`, записать `MeetingEvent host_action:finish`; вернуть 200, не 409;
- из терминальных (`completed`/`*_ready`/`failed`) — идемпотентный 200/понятный конфликт без 5xx.
FSM: `scheduled → failed` уже разрешён ([meeting-fsm.ts:29](../../backend/src/modules/meetings/fsm/meeting-fsm.ts#L29)) — расширять таблицу НЕ нужно.
**Frontend:** в [Curation… / meeting-room UI] тост по `failureReason='ended_before_start'` — «Встреча завершена (запись не велась)», не «ошибка». (Точное место рендера finish-ответа уточнить при реализации.)
**Риск:** средний (FSM/деньги/идемпотентность) → strict-production-review-gate + unit на каждый исходный статус.

### Ф6 — Встреча: reconcile брошенных `scheduled`
**Файл:** `backend/src/modules/meetings/cron/idle-meeting.cron.ts` (расширить) или новый `scheduled-reconcile.cron.ts`.
**Изменения (по Р2 = 30 мин):** добавить выборку `status='scheduled'` старше `createdAt + IDLE_MEETING_TIMEOUT_MINUTES`; для каждой — проверить `livekit.listParticipants`: если room пуста/не существует → `deleteRoom` (best-effort) + `scheduled → failed('never_activated')`; если в room есть живые участники (значит `room_started` потерян, но встреча идёт) → `scheduled → active` (startedAt=now) + при `recordByDefault` попытаться стартовать запись (recovery).
**Риск:** средний → unit на обе ветки (пустая room / есть участники).

> Баг A (инфра) — **не часть кода**, отдельный раздел §4. Ф5/Ф6 лишь делают систему устойчивой к будущим потерям вебхуков; саму доставку чинит §4.

---

## 3. Тест-план (верификация)
- **Ф1:** `bunx vitest run src/modules/orgs/orgs.service.spec.ts` — существующие 4 + новые: (а) «аккаунт-карточка ⊕ ручная карточка, тот же email (разный регистр) → 1 строка, статус accepted, человеческое имя/должность»; (б) «участник с Membership без invitation → accepted». (Прототип: 6/6 зелёные.)
- **Ф3:** прогнать `--dry-run` на проде, сверить counts; повторный прогон → 0 (идемпотентность).
- **Ф4:** unit на 3 сценария (ручной дубль → 409; link к безличному по email → линковка; чистое создание).
- **Ф5:** unit на finish из `scheduled`/`active`/терминального.
- **Ф6:** unit на пустую room / room с участниками.
- **Глобально:** `bun run typecheck && bun run lint && bun run build` в `backend/`; для тоста — `frontend/` typecheck+build.
- **Ручная приёмка (qa-tester):** раздел «Команда» — один человек = одна строка, владелец «активен»; тестовая встреча — «Завершить» из любого состояния закрывает без 409.

## 4. Прод-операции (после реализации)
- **Шаг 5** (`postgres-init.sql`): новый partial unique `persons_tenant_email_active_uniq` (self-skip при дублях).
- **Шаг 8** (`backfill`): `bun run scripts/backfill-merge-duplicate-persons.ts` (сначала без флага = dry-run, затем `--apply`). Регистрируется в `apply-prod-deploy.ts`.
- Записать оба в `docs/operations/prod-deploy-log.md`.
- **Инфра (Баг A, вне репо), владельцу:** проверить `infra/livekit/livekit.yaml` (на проде, в .gitignore) → `webhook.urls` = `https://<домен-backend>/webhooks/livekit` (эндпоинт ВНЕ `/api/v1`, [livekit-webhooks.controller.ts:30-39](../../backend/src/modules/webhooks/livekit-webhooks.controller.ts#L30-L39)); `webhook.api_key` = один из `keys`, тот же в backend `.env` `LIVEKIT_WEBHOOK_API_KEY`; reverse-proxy (nginx) должен проксировать путь `/webhooks/` на backend (а не только `/api`); после правки — `docker compose -f infra/livekit/docker-compose.yml up -d livekit`. Проверка: тестовая встреча → `diag trace --meeting <id>` показывает `room_started`. Зависшую `01KTR54GYJ...` — удалить (восстанавливать нечего).

## 5. Совместимость и риски
- **Prompt caching:** не затрагивается (LLM не используется).
- **Миграции Prisma:** схему НЕ меняем (partial index — в `postgres-init.sql`, как принято для WHERE-индексов).
- **Реестр «не сделано»:** до выката — строки в `second-brain/04_не-сделано/README.md` (зависшие встречи без устойчивости; дубли Person).
- **Главный риск Ф3:** ошибочное слияние разных людей с одним email — митигируется: сливаем только точное совпадение `lower(email)`, soft-delete (обратимо), `≥2` аккаунтов не трогаем, dry-run.

## 6. Итог
ТЗ финализировано: все 4 развилки закрыты решениями владельца (§1), фазы Ф1–Ф6 отражают их дословно. Готово к реализации через `tz-orchestrator` — отдельным «погнали».

Порядок реализации: Ф1 → Ф2 → Ф3 → Ф4 (трек «Команда»), затем Ф5 → Ф6 (трек «Встречи»). Коммит пофазно, push — по подтверждению владельца.

Баг A (доставка вебхуков LiveKit) — прод-действие владельца (§4), первично по срочности и **не зависит** от кода: без него каждая новая встреча будет зависать в `scheduled`. Ф5/Ф6 — страховка устойчивости на случай будущих потерь вебхуков.
