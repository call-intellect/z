---
date: 2026-06-10
title: «Кому видно» — доступ к видеовстречам (Ф1–Ф6)
tags: [meetings, access-control, rbac, knowledge-access-resolver, visibility, prisma-migration, kill-switch, security]
distilled: false
---

# «Кому видно» — доступ к видеовстречам (как в Google Диске) (Ф1–Ф6)

## Что было поставлено

ТЗ [`plans/tz/2026-06-10-meeting-visibility-who-can-see.md`](../../plans/tz/2026-06-10-meeting-visibility-who-can-see.md).

**Боль:** встреча была доступна **только создателю** (`ownerId === userId`) на всех поверхностях — список фильтровался строго по владельцу, детали/отчёт/статус/транскрипт/запись кидали `not_meeting_host` всем кроме хоста. Это by design owner-only MVP, но владелец: «я создаю встречи, сотрудники их не видят». Команда из 2 сотрудников не видела встречи владельца и не могла открыть запись/отчёт после.

**Решение** — модель «Кому видно» как в Google Диске: хост задаёт аудиторию `Meeting.visibilityScope` — `owner_only` · `participants` (ДЕФОЛТ) · `custom` (выбрать людей/группы) · `org` (вся компания). Один доступ на всё про встречу: кому видна встреча — тому видны видео, аудио-дорожки, расшифровка, отчёт. Управление встречей остаётся host-only. Жёсткая граница владельца: **граф знаний («второй мозг», авто-раскладка) НЕ трогать** — это отдельная подсистема.

## Как решал

Граф фаз: Ф1 → Ф2 → {Ф3, Ф4}; Ф4 → Ф5; Ф6 — последняя. Пофазная картография → промпт кодеру → независимая приёмка (греп + re-Read + свой typecheck/lint/build/спеки) → пофазный коммит.

- **Ф1 — схема** — `backend/prisma/schema.prisma`: `Meeting.visibilityScope String @default("participants") @db.VarChar(16)` + `accessGrants MeetingAccessGrant[]`; новая модель `MeetingAccessGrant` (`tenantId`/`meetingId`/`granteeType`/`granteeId`/`grantedById`/`createdAt`; FK `meetingId → Meeting onDelete: Cascade`; unique `(meetingId,granteeType,granteeId)` + 2 индекса). Миграция `backend/prisma/migrations/20260610130000_meeting_visibility/migration.sql`.
- **Ф2 — ядро** — `backend/src/modules/meetings/meeting-visibility.service.ts` (`canView`/`assertCanView`/`buildListWhere`) + новый read-only метод `KnowledgeAccessResolver.resolveDirectGroupIds` в `backend/src/modules/rbac/knowledge-access-resolver.service.ts` + ENV `MEETING_VISIBILITY_ENABLED` (`env.schema.ts`, `zBool(true)`) + геттер `cfg.meetingVisibilityEnabled` (`typed-config.service.ts`). Спека `meeting-visibility.service.spec.ts` (таблица кейсов canView + регресс-гард resolver).
- **Ф3 — подключить `canView`** — 6 READ-поверхностей встречи переведены с owner-only на предикат: `meetings.service.ts` (`getForUser`/`getResult`/`getResultStatus`/`getTranscript`), `recordings.service.ts` (`getDownloadUrl`/`getAudioTracks`), список через `buildListWhere` + tenant-scope. Мутации (start/stop/delete) НЕ трогали.
- **Ф4 — API** — `GET`/`PATCH /api/v1/meetings/:id/visibility` (host-only), Zod-DTO `SetVisibilitySchema`, транзакция замены грантов (delete-all + createMany), валидация принадлежности granteeId tenant, `visibilityScope` в DTO деталей/отчёта/списка.
- **Ф5 — фронт** — контрол «Кому видно» (4 пресета + пикер людей/групп) на странице встречи (`meeting-result-v2`) и при создании (`CreateMeetingFormV2`); пикер людей через `ParticipantPicker`, группы через `knowledgeAccessApi.listGroups`; чип «Кому видно: …» в шапке.
- **Ф6 — документация** — флаг, prod-deploy-log, second-brain, реестр не-сделанного.

**Ключевые инженерные моменты (отклонения от буквы ТЗ):**

- **(а) Миграция сгенерирована offline.** Docker/локальной БД не было → файл миграции собран через `prisma migrate diff --from-schema-datamodel --to-schema-datamodel`, а не `migrate dev` (который требует живую shadow DB). Результат — чистый аддитивный SQL (ADD COLUMN с дефолтом + CREATE TABLE), idempotent через `migrate deploy` на проде.
- **(б) `resolveDirectGroupIds` — ПРЯМЫЕ группы БЕЗ матрицы видимости.** Существующий `resolveAccessibleGroups` расширяет `deptGroupIds` матрицей `GroupVisibilityPolicy` (концепт графа знаний). Для грантов это неверно: грант группе «Логистика» должны видеть **прямые члены** логистики, а не «кто видит логистику по матрице». Новый метод останавливается на `ownDeptGroupIds ∪ closedGroupIds` ДО шага матрицы. Additive — существующие методы резолвера не тронуты (регресс-спека knowledge-access зелёная).
- **(в) SECURITY: перевод `getForUser` на `canView` вскрыл эскалацию привилегий.** Host-only мутации `renameParticipant`/`setClosedGroupKind` и контроллерный `retry-ai`-путь гейтили хоста ЧЕРЕЗ `getForUser` (полагались на то, что он кидает `not_meeting_host` не-хосту). Как только `getForUser` стал отдавать встречу любому, кто `canView`, эти мутации открылись грант-зрителям. Добавлен **публичный `assertMeetingHost`** (явный owner-чек), им закрыты все три места. Классическая дыра при смене семантики метода чтения, на котором висели проверки записи.
- **(г) `tenantId` для списка — `@CurrentOrg` + fallback.** Старый `listByOwner` фильтровал строго по `ownerId` БЕЗ `tenantId`. Новый `buildListWhere` обязан добавить tenant-scope: берём `tenantId` из `@CurrentOrg` (TenantMiddleware глобальный, всегда заполнен для авторизованного), с fallback на membership.

## Что вышло

5 код-коммитов (ветка `feature/meeting-cabinet-fixes-2026-06-10`) + этот док-коммит. Спеки зелёные:
- `meeting-visibility.service.spec.ts` — 19 кейсов (owner/bypass/org/participants±участник/custom person-грант/custom group-грант прямой член/custom не-член/owner_only/kill-switch off).
- регресс `knowledge-access-resolver.service.spec.ts` — зелёный без изменений (доказательство, что additive-метод не сломал knowledge-access).
- `recordings.service` (download/audio через `canView`) + host-controls (мутации сохранили owner-чек) — зелёные.

`backend` typecheck 0 + lint 0 + build 0; `frontend` typecheck 0 + lint 0 + build 0. Ручная визуальная приёмка (qa-tester) — после прод-выката.

**Prod-операции (diff к выкату):** Шаг 1 ENV `MEETING_VISIBILITY_ENABLED=true` (дефолт, kill-switch — действий владельца не требует), Шаг 4 миграция `20260610130000_meeting_visibility` (авто `migrate deploy`, в `apply-prod-deploy STEPS` регистрировать НЕ нужно — это миграция схемы), rebuild backend+frontend. Полная инструкция — `docs/operations/prod-deploy-log.md` блок «👁 2026-06-10 — Кому видно».

## Чему научился

- **Миграция Prisma без живой БД — `migrate diff --from-schema-datamodel --to-schema-datamodel`.** `migrate dev` требует shadow DB (Docker/Postgres недоступны в этом окружении). `diff` строит SQL из двух schema-снимков offline; для аддитивных изменений (ADD COLUMN с дефолтом + CREATE TABLE) результат корректен и idempotent через `migrate deploy`. Имя каталога — вручную `YYYYMMDDHHMMSS_name`.
- **Смена семантики метода чтения = аудит ВСЕХ, кто на него опирался для авторизации.** `getForUser` исторически гейтил host-only мутации тем, что кидал `not_meeting_host`. Ослабили его до `canView` — и мутации молча открылись грант-зрителям. Урок: метод, который меняет смысл с «только владелец» на «любой зритель», требует грепа всех вызовов на предмет неявных auth-предположений; READ-семантику нельзя переиспользовать как WRITE-гейт. Чинить — явным отдельным предикатом (`assertMeetingHost`), не доверять «он же раньше бросал 403».
- **Расширение резолвера групп read-only методом vs правка существующего.** Соблазн «добавить параметр `skipMatrix` в `resolveAccessibleGroups`» сломал бы регресс knowledge-access (высокий blast-radius). Новый additive-метод `resolveDirectGroupIds` рядом — нулевой риск для соседней подсистемы, регресс-спека доказывает изоляцию.
- **`@db.VarChar(16)` для строкового enum-поля вместо Prisma enum.** Значения видимости (`owner_only`/`participants`/`custom`/`org`) хранятся строкой с дефолтом — добавление нового режима не потребует `ALTER TYPE` (Postgres не умеет DROP VALUE у enum). Зеркалит существующий паттерн `Meeting.closedGroupKind String? @db.VarChar(20)`.
