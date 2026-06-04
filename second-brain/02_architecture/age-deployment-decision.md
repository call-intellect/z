---
title: AGE deployment decision (Фаза 0a)
date: 2026-05-21
status: decided
references:
  - plans/tz/2026-05-21-phase-0a-data-model-and-graph-infra.md §5
  - plans/tz/2026-05-21-phase-0-roles-and-onboarding.md §6 решение #2
---

# AGE deployment decision

## Решение

- **Локально (dev):** composite Docker image PostgreSQL 16 + pgvector 0.8.0 + Apache AGE 1.5.0 (`release/PG16/1.5.0`). Источник — `infra/postgres/Dockerfile`. В `docker-compose.yml` postgres-сервис собирается через `build:` вместо `image:`.
- **Prod:** **Yandex Cloud Managed PostgreSQL 16.** Оба расширения (`age` 1.5.0 + `vector` 0.8.0) доступны как managed extensions. Включаются через UI/Terraform кластера: `shared_preload_libraries = 'age'`. Self-hosting не требуется.

## Почему не PG17

- Apache AGE 1.6/1.7 для PG17 — release candidates на 2026-02. Stable релиз 1.5.x — только под PG16.
- Yandex Managed PG17 поддерживает AGE 1.5.0 номинально, но в каталоге managed extensions PG16 + AGE — более зрелая комбинация.
- Downgrade `pgvector/pgvector:pg17` → собственный PG16-образ безболезненный: pgvector совместим, схема Prisma не меняется.

## Почему не self-hosting на prod

- Yandex Managed PostgreSQL даёт оба расширения «из коробки» — нет смысла платить за DevOps-нагрузку (бэкапы, репликация, мониторинг).
- Решение #2 зонтичного ТЗ (§6) допускало self-hosting как fallback. Yandex Managed закрыл этот риск: оба `age` и `vector` подтверждены в [таблице extensions](https://yandex.cloud/en/docs/managed-postgresql/operations/extensions/cluster-extensions).
- Если в Фазе α потребуется AGE 1.7+ (например, новые Cypher-функции), переедем на self-hosted — миграция управляемая, в Фазе 0 не блокирует.

## Граф `z_graph`

Единое graph-namespace внутри AGE для всех бизнес-связей. Создаётся идемпотентно через `infra/postgres/init.sql` (dev) и `backend/scripts/postgres-init.sql` (prod). Все Cypher-запросы — `SELECT * FROM cypher('z_graph', $$ ... $$)`. Через `GraphService` (см. 0a.2 — `backend/src/common/graph/`).

## Артефакты решения

- `infra/postgres/Dockerfile` — composite image для dev.
- `infra/postgres/init.sql` — bootstrap при первом старте docker-volume (CREATE EXTENSION + create_graph).
- `backend/scripts/postgres-init.sql` — идемпотентный init для prod (запускается через `bun run apply-postgres-init` после `prisma db push`).
- `docker-compose.yml` — postgres-сервис переведён с `image:` на `build:`.

## Deploy checklist (CRIT-6)

При деплое на свежий Postgres-инстанс обязательно убедиться, что доступны
**оба расширения** до запуска `bun run apply-postgres-init`:

1. **Composite Docker image (наш `infra/postgres/Dockerfile`):**
   - `age` 1.5.0 + `pgvector` 0.8.0 уже в образе — действий не нужно.
2. **Yandex Cloud Managed PostgreSQL 16:**
   - В настройках кластера в `shared_preload_libraries` добавить `age`.
   - Применить — кластер перезапустится.
   - В UI «Расширения» подтвердить, что `age` и `vector` доступны.
3. **Другой managed Postgres (RDS / Cloud SQL / Selectel):**
   - Проверить наличие `age` 1.5.0 для PG16 в каталоге расширений.
   - Если нет — `CREATE EXTENSION age` упадёт с «extension is not available»,
     и весь knowledge-core (`GraphService.cypher('z_graph', ...)`) перестанет
     работать **на любом обращении к графу**. Решение — composite-образ.

Проверка после `apply-postgres-init`:
```sql
SELECT extname, extversion FROM pg_extension WHERE extname IN ('age', 'vector');
SELECT name FROM ag_catalog.ag_graph WHERE name = 'z_graph';
```

Должно вернуть `age`/`vector` и одну строку с `z_graph`.

## Разблокировка графа AGE (МТЗ №1 Фаза 5, 2026-06-04, коммит `ee0bb910`)

**Источник:** [`plans/tz/2026-06-04-razblokirovka-konveyera.md`](../../plans/tz/2026-06-04-razblokirovka-konveyera.md). AGE на проде «не виделся» — типизированная запись в граф падала или висела внутри транзакций. Что сделано в `backend/src/common/graph/graph.service.ts` + `prisma.service.ts` + `postgres-init.sql`:

- **`search_path` для `ag_catalog`.** AGE требует `ag_catalog` в `search_path`, иначе Cypher-функции не резолвятся. Прибито двумя слоями: `ALTER ROLE ... SET search_path` в `postgres-init.sql` (постоянно для роли) **и** per-connection `options` в `PrismaPg` (на случай новой роли/пула). Это и была причина «AGE не виден».
- **Cypher развязан из транзакций.** Раньше `cypher(...)` вызывался внутри Prisma-транзакции — длинные графовые операции держали транзакцию и роняли запись. Теперь в `upsertEntity` / `upsertDecision` / `addEdge` / `removeNode` / `removeEdge` Cypher выполняется **post-commit best-effort** (после коммита основной транзакции Postgres).
- **Классификация ошибок + метрика `kc_typed_entity_failed_total{type, reason}`.** Видно, что именно ломается (а не общий silent-skip).
- **`age_unavailable` НЕ помечает RawEvent как ingested.** Если граф недоступен, `block-ingest.worker` делает `throw` (job уходит в ретрай BullMQ) — событие не теряется, дождётся восстановления AGE.
- **Kill-switch `graph.ageEnabled`** (`AdminSetting`, default `true`) — крутилка super_admin, можно отключить графовую запись без передеплоя (см. [[../01_projects/admin-settings]]). Getter `graph.ageEnabled` в `TypedConfigService`, ENV-дефолт в `env.schema.ts`.

## Пороги графа = живые крутилки AdminSetting (МТЗ №1 Фаза 6, 2026-06-04, коммит `eb7462ef`)

Геттер `knowledgeCore` в `TypedConfigService` переведён на `resolveSync` для порогов графа — теперь это **живые крутилки** super_admin (`AdminSetting`), а не статические ENV: `linkMinConfidence`, `linkerMinBlocks`, `entityGraphMinComentions`, `themeClusteringMinBlocks`, `themeClusterMinSize`. ENV-дефолты понижены под малый тенант (граф не строился, т.к. пороги были рассчитаны на крупную компанию):

| Порог | Было (ENV) | Стало (дефолт) |
|---|---|---|
| `LINKER_MIN_BLOCKS` | 50 | 3 |
| `THEME_CLUSTERING_MIN_BLOCKS` | 100 | 10 |
| `ENTITY_GRAPH_MIN_COMENTIONS` | 3 | 2 |
| `LINK_MIN_CONFIDENCE` | 0.75 | 0.5 |

> ⚠ **`v2AgentsEnabled` НАМЕРЕННО оставлен на ENV (не переведён в `resolveSync`).** Это не «крутилка», а мастер-флаг прод-выкатки v2-агентов — перевод в AdminSetting флипнул бы прод-флаг при первом же резолве дефолта. Урок зафиксирован в рефлексии 2026-06-04.

## Что дальше

- 0a.1 — Prisma модели + миграция EntityLink на полиморфизм.
- 0a.2 — `GraphService` с двойной записью Postgres ↔ AGE.
- 0a.3 — CRUD API + RBAC + расширение search.
