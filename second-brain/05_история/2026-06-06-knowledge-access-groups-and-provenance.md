---
type: reflection
date: 2026-06-06
feature: knowledge-access-groups-and-provenance
branch: feature/knowledge-access-groups
relates_to:
  - plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md
  - plans/analysis/2026-06-06-knowledge-access-levels-and-provenance.md
distilled: false
---

# Рефлексия — доступ к знаниям через группы + фундамент-провенанс (Ф1–Ф8)

## Что было поставлено
Реализовать целиком ТЗ `2026-06-06-knowledge-access-groups-and-provenance.md` (8 фаз) как оркестратор: дать Коре управление видимостью знаний ВНУТРИ компании («менеджер не видит совет директоров») + расширить провенанс «кто сказал» на все типы знания. Граф знаний фильтровался только по `tenantId` — любой сотрудник через чат/поиск/клон видел весь граф.

## Как решал (фаза → коммит)
Вёл фаза-за-фазой силами суб-агентов-кодеров, приёмку каждой делал сам (git status → греп-маркеры → re-Read критичной логики → свой typecheck/build/тесты по всему модулю → коммит явными путями).

- **Ф1 `e253dd19`** — снят узкий гейт `attributeSubject` (был только 6 reasoning-типов) → флаг `knowledge.subjectAttributionAllTypes` (AdminSetting, code-fallback true); `tryGetActorIdentity` per-adapter (tracker `actor.userId` / chatbox `responsible.personId` / dump `uploaderId` / free_note `userId` / email `from.address`); ветки `authorPersonId`/`authorEmail` в `resolveSubjectEntityId/PersonId`; метрика `kc_subject_attribution_total{via}`; `backfill-subject-attribution-all-types.ts`.
- **Ф2 `cbb1c444`** — 4 модели (`KnowledgeGroup`/`KnowledgeGroupMember`/`IdeaBlockAccess`/`GroupVisibilityPolicy`) + enum + миграция `20260606114416`; `KnowledgeAccessResolver` (resolveAccessibleGroups + buildAccessWhere, кэш 60с); флаг `KNOWLEDGE_ACCESS_ENFORCEMENT` (off/shadow/enforce, дефолт off) в TrackerSchema (TS2589-safe); `seed-knowledge-groups.ts`.
- **Ф3 `0609d381`** — `BlockAccessDeriverService` (department из functional-домена/участников/автора + closed из `Meeting.closedGroupKind`/`MeetingTypeConfig.defaultClosedGroupKind`; personal→субъект+fallback leadership) в loop block-ingest после classify; `backfill-block-access.ts`.
- **Ф4 `d4aa1b3e`** (4 части) — security-гейт: chat-v2 выходной шлюз `loadContextBlocks`/`loadContradictingBlocks` (ГЛАВНАЯ гарантия — ловит cache/precomputed) + pool pre-filter + reasoning-chain; /search (SQL-предикат), /snapshot, orchestrator; **+ адверсариально найденные** `entities`/`themes`/`graph`/`blocks` контроллеры. Метрики `kc_access_shadow_diff_total`/`kc_access_denied_total{surface}`.
- **Ф5 `b08b9ade`** — клоны: `loadPersonSubgraph`/`loadRoleSubgraph` фильтруют reasoning-блоки по accessCtx спрашивающего (DB-фильтр + defense-in-depth post-filter); фильтр ДО `assertTopicDensity`.
- **Ф6 `3f055e80`** — проекции (decisions/insights/ideas/regulations/processes/policies) фильтруются on-read из `sourceBlockIds` (без новой модели); decisions в контексте клона тоже.
- **Ф7a `2ade7365` / Ф7b `a16157ef`** — `KnowledgeAccessAdminController` (/api/v1/knowledge-access: groups/matrix/members/meeting-type-default) + `invalidateAll()` на мутациях; frontend `company-admin/access-groups` (матрица+членство) + селектор закрытости встречи + advisory-баннер.
- **Ф8a `a5803ec4`** — interview→personal дефолт (bootstrap MeetingTypeConfig + patch); second-brain (6 файлов) + prod-deploy-log.

## Что вышло (верификация)
- typecheck + build (DI) + тесты зелёные на КАЖДОЙ фазе. Финальные прогоны: knowledge-core (251), api+services+rbac+orchestrator (477), clones (30), rbac+config+guards (238), knowledge-access+meetings (74), frontend typecheck/lint/build + 287 unit.
- Инвариант **off=байт-в-байт** держится: при `KNOWLEDGE_ACCESS_ENFORCEMENT=off` ни один путь не резолвит группы и не фильтрует (проверял re-Read'ом выходного шлюза и греп-маркерами).
- e2e-предикат «логист≠совет» покрыт per-surface юнитами + резолвер-тестами; полный DB-e2e — прод-смоук (локально AppModule не бутится без prod-ENV `WEBHOOK_SECRETS_ENCRYPTION_KEY`).

## Чему научился / грабли
1. **Адверсариальная проверка покрытия окупилась дважды.** Греп всех canonical-выдач (из Pre-mortem ТЗ) нашёл 2 волны пропущенных поверхностей утечки: сначала `entities/themes/graph` контроллеры, потом `blocks.controller` (`GET /blocks/:id` — findUnique по id без литерала `status:'canonical'`, первый греп его не поймал). Урок: для security-гейта одного «списка поверхностей из ТЗ» мало — нужен независимый исчерпывающий греп по полям контента (`trustedAnswer`/`criticalQuestion`), не по `status:'canonical'`.
2. **Не материализовать там, где можно вывести.** Ф6 «новая связь проекция↔группа» заменил на on-read вывод из `sourceBlockIds` — нет миграции, нет рассинхрона, нет риска пропустить create-путь в 6 специалистах. Цель R12 та же.
3. **Выходной шлюз > N pre-filter'ов.** Главную гарантию (и R10 про кэш) дал ОДИН фильтр на `loadContextBlocks` (он вызывается всегда, даже на cache-hit precomputedBlockIds). Pool pre-filter — лишь оптимизация recall при enforce. Это упростило и кэш (трогать не пришлось).
4. **derive() оставить sync.** Соблазн «расширить derive() группами» (как буквально в ТЗ) сломал бы его чистоту (нужен DB-запрос) — вынес в async резолвер-хелпер.
5. **Параллельная сессия — реальность.** Всю сессию в репо параллельно работала другая сессия (retest прод-проблем): множились untracked `retest-*.png`, `plans/analysis/2026-06-06-retest-*`, правился `04_не-сделано/README.md`. Спасло железное правило «коммитить только своими явными путями, никогда `git add .`» + фильтр чужого в каждом `git status`. `04_не-сделано` НЕ трогал во избежание клоба их работы (строку реестра вносить владельцу).
6. **Локальный AppModule не бутится без prod-ENV** (`WEBHOOK_SECRETS_ENCRYPTION_KEY`) — NestFactory-скрипты (бэкфиллы) и runtime-DI-смоук нельзя прогнать локально; DI верифицировал по конструкции (тот же @Global-модуль/паттерн, что у уже-работающих сервисов) + build. Прод-прогон зафиксирован в prod-deploy-log.

## Открыто
- Прод: прогон seed/backfill + перевод флага off→shadow→enforce (за владельцем; инструкция в `docs/operations/prod-deploy-log.md`).
- Строку в `04_не-сделано/README.md` внести владельцу (файл занят параллельной сессией).
- vNext: ingest групповых чатов сотрудников; UI крутилки defaultClosedGroupKind по типу; чтение closedGroupKind в meeting-detail DTO; фильтр проекций в dashboard-агрегатах.
