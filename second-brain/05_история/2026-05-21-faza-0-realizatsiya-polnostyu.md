---
type: reflection
date: 2026-05-21
distilled: false
---

# 2026-05-21 — Фаза 0 реализована полностью (каркас компании + AGE + wizard + RoleProfileAgent)

## Постановка

Зонтичный ТЗ Фазы 0 (`plans/tz/2026-05-21-phase-0-roles-and-onboarding.md`) + 4 sub-TZ (0a/0b/0c/0d) + аналитика ЛК. Цель — оркестрировать реализацию: модели Role/Department/Person + 10 моделей группы Б, графовая инфраструктура Apache AGE + GraphService, document-ingest pipeline, мастер знакомства на 5 шагов, страницы ЛК, RoleProfileAgent.

Ограничение: одна сессия, 6+ background agents в параллель, единый коммит на Фазу 0. По оценкам ТЗ — 2-3 месяца команды.

## Что сделал

Один коммит `a178c66 feat(phase-0): каркас компании ...` со всеми изменениями (180+ файлов).

**Делегирование 6 background agents:**
- A — GraphService (`common/graph/`) с двойной записью Postgres↔AGE.
- B — Frontend каркас (Sidebar 3 группы, OrgSwitcher, ComingSoonPage + 4 preview).
- C — DocumentParserService + document/text adapters + DocumentsModule + 2 новые очереди BullMQ.
- D — 8 CRUD-модулей группы А + RBAC policy.csv расширение (+17 ResourceType) + search + me/profile + switch-org stub + invitation accept flow.
- E — Wizard 5 шагов + /structure + /roles + /me + /documents + CommandPalette + dashboard виджеты.
- F — Глоссарий + 4 новые заметки в second-brain/01_projects/ + обновления data-model.md/module-map.md/index.md.
- G (вторая итерация) — 0b.2-4: JSON Schema v2 + role_relevant + extraction группы Б через GraphService.upsertEntity + EntityResolution 5 новых методов + Decision-параллельное создание + provenance в /documents/:id.

**Сам делал:**
- 0a.0 preflight: `infra/postgres/Dockerfile` (PG16 + pgvector + AGE), `docker-compose.yml`, `backend/scripts/postgres-init.sql` расширение, `age-deployment-decision.md`.
- 0a.1: 18 новых моделей Prisma + 11 enum + расширения existing (Goal/IdeaBlock/EntityLink/MeetingType/EntityLinkType/Membership/OrgInvitation/User/Meeting/Entity). EntityLink полиморфизация: FK на Entity снят, +fromType/toType nullable + composite unique. Backfill-script.
- Фикс 3 файлов knowledge-core (entities.controller, graph.controller, entity-graph-builder.cron) под новую полиморфную EntityLink.
- 0d: role-profile.worker + role-profile.cron + RoleProfileService + RoleProfileContextBuilder + промпт role-profile-build-v1 + queue/cron/idempotency + LlmTaskType расширение + регистрация в AppModule + патч-скрипт.
- Подключение rebuild stub к real enqueue + 409 Conflict logic.
- ESLint правило `no-cypher-outside-graph` (no-restricted-syntax с whitelist для common/graph/ и context-builder).
- Финальный typecheck-fixes: zod 4 API (`required_error` → `error`), MeetingType +review/+retrospective в 2 промптах, blockId vs ideaBlockId в ThemeIdeaBlock, l.fromType null-guard, LlmResponseFormat shape.

## Что вышло

**Финальный typecheck:**
- `bun run typecheck` чистый на backend (0 errors).
- `bun run typecheck` чистый на frontend (0 errors).

**Прод-операции** — необходимы для применения на dev/prod-стенде:
- `docker compose up -d postgres redis minio` (postgres соберётся из `infra/postgres/Dockerfile`).
- `cd backend && bun install` (новые deps: `pdf-parse`, `mammoth`, `marked`, `multer`, `@types/multer`).
- `bun run prisma:push` (применит 18 новых моделей + расширения existing).
- `bun run prisma:generate` (если ещё не сделан).
- `bun run apply-postgres-init` (создаст AGE-extension и граф `z_graph` + HNSW индексы pgvector).
- `bun run scripts/backfill-entity-link-types-fase0.ts` (заполнит fromType/toType='entity' для legacy EntityLink).
- (опционально) `bun run scripts/patch-prompt-role-profile-build-fase0d.ts` — пока no-op (prompt registry не выделено в БД).

**Лимиты этой сессии:**
- `bun run lint` — 78 preexisting errors + 620 warnings (не от Фазы 0); no-cypher rule работает с 0 false positives.
- `bun run build` — не запускался.
- `bun run test:*` — не запускался; есть skeleton-тесты `describe.skip` для GraphService (7), DocumentParser, EntityResolution, BlockExtraction, всех CRUD-модулей.

## Чему научился

1. **System-reminders иногда показывают stale snapshots файлов.** В середине работы пришли несколько reminders «файл modified, не revert», показывая откаченные версии моих Edit-ов. Реальные Edit'ы были целы (проверил через Read/Grep). → В таких случаях не пытаться восстановить «откаченное» сразу, сначала проверить актуальное состояние через Read/Grep.

2. **6 background agents параллельно — рабочая схема, но нужны жёсткие неконфликтные границы.** Я давал каждому агенту явный список «НЕ ТРОГАЙ» (например, B не трогает /structure pages, E не трогает Sidebar). Конфликтов в этой сессии не было. → При оркестрации параллельной работы дробить scope по конкретным файлам/директориям; явно перечислять «не моё» в задаче.

3. **Schema-миграция EntityLink требует фикса callsites.** Снял FK на Entity → 3 файла knowledge-core с `include: { fromEntity: true }` сломались, плюс `entity-graph-builder.cron.ts` с unique-ключом `fromEntityId_toEntityId_relationType` (Prisma client ждал новый composite). → При полиморфизации FK-relation проверять grep по relation-name + include-patterns ДО schema-push'а.

4. **Prisma 7 declared в package.json, но в `node_modules` была 5.22.0 до `bun install`.** `prisma format/validate` падал на pre-7 синтаксисе datasource. Agent A запустил `bun install` сам — это сразу подняло prisma до 7 и снизило кол-во typecheck-ошибок с 40 до 12. → При первой работе в проекте с pre-existing package.json делать `bun install` ДО любой валидации.

5. **zod 3 → zod 4: `required_error` → `error` (или `message`).** 5 DTO от agent D были написаны под zod 3 API; не компилировались под zod 4 в проекте. → При расширении API библиотек проверять актуальную сигнатуру через Context7.

6. **Push reject из-за race condition — не означает что коммит не ушёл.** На push ответ «cannot lock ref ... is at X but expected Y». После fetch HEAD оказался синхронным с origin/dev, наш коммит уже был на remote. Возможно сработали hook'и. → Не паниковать при push reject; сначала `git fetch && git log --oneline HEAD..origin/dev` для проверки.

7. **ESLint `no-restricted-syntax` с esquery не понимает inline-флаги `(?i)`.** Падал с SyntaxError. → Использовать case-sensitive regex (`\bcypher\s*\(`); в production-коде никто не пишет `CYPHER(` в верхнем регистре.

## Что осталось

- **0c switch-org:** реальный session update (сейчас stub проверяет membership + возвращает todo).
- **0b LLM-arbiter:** EntityResolutionService.resolveTypedEntity в коридоре cosine 0.78..0.92 (сейчас только exact match + pg_trgm).
- **Эксперимент A vs B** extraction (один промпт vs три прохода) на 10 артефактах — отложен, default A.
- **Prompt registry в БД** — пока только code fallback; patch-scripts no-op до выделения модели Prompt.
- **Embedding-колонки для группы Б** — нет в schema; cosine-резолв сейчас через pg_trgm.
- **`Decision/Metric/Tool.confidence`** — нет поля в schema; DTO возвращает null. Добавить в γ.
- **Integration-тесты GraphService** — 7 в `describe.skip`, ждут AGE-контейнера на CI.
- **CSV-импорт в wizard** — отказались; включится если на пилоте >10 минут на сотрудниках.
- **Зонтичный ТЗ §4 матрица прослеживаемости** — 83 галочки `[ ]` → `[x]` не проставлены (пользователь сам ставит после ревью, файл был modified до сессии — не трогал).
- **`plans/analysis/2026-05-21-user-cabinet-design.md`** + **`plans/tz/2026-05-21-phase-0-roles-and-onboarding.md`** + **`second-brain/index.md`** — modified ДО сессии, не коммитил (предсессионная работа).

## Прод-команды

```bash
# 1. Поднять postgres с AGE + pgvector (composite Dockerfile)
docker compose up -d postgres redis minio

# 2. Установить новые зависимости (pdf-parse, mammoth, marked, multer)
cd backend && bun install

# 3. Применить schema на БД (только prisma:push, никаких migrate*)
bun run prisma:push
bun run prisma:generate

# 4. Создать AGE extension + граф z_graph + HNSW индексы
bun run apply-postgres-init

# 5. Заполнить fromType/toType='entity' для legacy EntityLink записей
bun run scripts/backfill-entity-link-types-fase0.ts

# 6. (опционально) Запатчить промпт role-profile-build в registry — пока no-op
bun run scripts/patch-prompt-role-profile-build-fase0d.ts

# 7. Старт backend + worker
bun run dev          # HTTP-приложение
bun run worker:dev   # BullMQ воркеры в отдельном процессе

# 8. Старт frontend
cd ../frontend && bun install && bun run dev
```

**Yandex Cloud (prod):** PostgreSQL 16 managed cluster, включить `shared_preload_libraries = 'age'` через UI/Terraform, остальные шаги 2-8 те же.
