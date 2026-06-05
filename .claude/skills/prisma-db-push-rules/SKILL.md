---
name: prisma-db-push-rules
description: Правила работы с Prisma и схемой БД в Z (с 2026-06-05 — версионируемые миграции, НЕ db push). Файловые миграции prisma/migrations — источник правды о схеме; на прод применяется migrate deploy. db push разрешён только для черновых локальных проб (не коммитить). Используй этот скилл при ЛЮБОЙ задаче, где меняются таблицы, модели Prisma, enum, индексы, constraints, связи, или когда нужно применить изменения схемы. Обязателен если задача упоминает schema.prisma, миграции, baseline или изменения структуры данных.
---

# Z: правила Prisma и схемы БД

> **Смена правила 2026-06-05.** Раньше схема каталась через `prisma db push --accept-data-loss`.
> Это давало частичные/дрейфующие состояния при сбоях (реальный инцидент: осиротевший enum
> `ParticipantInvitationStatus` + недостающие колонки `Participant` → 500 на создании встречи и
> на result-эндпоинте). Перешли на **версионируемые файловые миграции Prisma**.
> Контекст: `plans/tz/2026-06-05-prisma-migrations-switch.md`.

## Главное правило

> **ЛЮБОЕ изменение в БД = файл миграции.** Нет миграции — нет изменения. Точка.
> Никаких «по-быстрому через db push на проде». Каждая правка схемы коммитится миграцией.

**Источник истины о схеме — файлы `backend/prisma/migrations/`** (плюс `schema.prisma` как desired-state).

- Изменение схемы → **`prisma migrate dev`** генерит файл миграции → ревью SQL → коммит.
- На прод/staging схема применяется **`prisma migrate deploy`** (только новые миграции, транзакционно) — **автоматически на каждом `docker compose up -d`** (через `apply-prod-deploy.ts --with-schema`). Деплой hands-free; первичный baseline существующей БД делает `ensureBaseline()` сам (авто-бэкап + `resolve --applied 0_init`, без diff-reconcile — схема разделена с `postgres-init.sql`).
- `prisma db push` — **ТОЛЬКО** для быстрых черновых локальных экспериментов, которые **НЕ коммитятся**.
  Перед коммитом такой эксперимент оформляется нормальной миграцией через `migrate dev`.

---

## Что НЕЛЬЗЯ делать

```bash
# ЗАПРЕЩЕНО на проде и в коммитах
prisma db push                 # только локальный черновик, результат НЕ коммитить
prisma migrate reset           # на проде — никогда (дропает БД); локально — осознанно

# ЗАПРЕЩЕНО редактировать руками уже применённые миграции
backend/prisma/migrations/<applied>/migration.sql   # вместо правки — новая миграция
```

---

## Что НУЖНО делать

```bash
cd backend

# Создать миграцию из изменений schema.prisma (генерит файл + применяет к локальной БД)
bun run prisma:migrate -- --name <короткое_описание>      # = prisma migrate dev --name ...

# Применить накопленные миграции (прод/CI; идемпотентно)
bun run prisma:migrate:deploy                              # = prisma migrate deploy

# Статус: какие миграции применены, есть ли дрейф
bun run prisma:migrate:status                              # = prisma migrate status

# Обновить Prisma Client после изменения схемы
bun run prisma:generate

# Черновой локальный эксперимент (НЕ коммитить результат)
bun run prisma:push                                        # = prisma db push
```

> Прод: всё через docker compose — `docker compose run --rm --no-deps backend sh -c 'bunx prisma migrate deploy'`.
> Штатно migrate deploy уже зашит в `apply-prod-deploy.ts --with-schema` (migrate-контейнер).

---

## Workflow изменения схемы

1. **Редактируй `backend/prisma/schema.prisma`** (модель/enum/индекс/связь).
2. **Сгенерируй миграцию:** `bun run prisma:migrate -- --name add_x_to_y`.
   - Prisma создаст `prisma/migrations/<timestamp>_add_x_to_y/migration.sql`, применит к локальной БД и обновит Client.
   - Шадоу-БД создаётся автоматически (pgvector доступен в dev-образе). Если роль без прав `CREATE DATABASE` — задать `shadowDatabaseUrl`.
3. **Отревьюй сгенерированный `migration.sql`** — особенно деструктив (DROP/ALTER TYPE/NOT NULL). Деструктивные шаги теперь явные и проходят ревью именно здесь.
4. **Обнови связанный код** (DTO, сервисы, типы, frontend, second-brain — см. таблицу ниже).
5. **Проверь:** `bun run typecheck`.
6. **Закоммить** миграцию вместе с кодом: `backend/prisma/migrations/**` + `schema.prisma`.

| Что | Где |
|-----|-----|
| Миграция | `backend/prisma/migrations/<ts>_<name>/migration.sql` (коммитить!) |
| DTO | `backend/src/<module>/dto/` |
| Service (запросы) | `backend/src/<module>/<module>.service.ts` |
| Frontend API types | `frontend/src/api/*.api.ts` / `frontend/src/domain/*.ts` |
| second-brain | `second-brain/02_architecture/data-model.md` |
| prod-deploy-log | `docs/operations/prod-deploy-log.md` Шаг 4 (если требуется отдельное внимание) |

---

## Baseline существующей БД (одноразово)

> **На проде это автоматизировано** — `ensureBaseline()` в `apply-prod-deploy.ts` сам выполнит reconcile + `resolve --applied 0_init` при первом `docker compose up -d` (с DROP-гейтом и авто-бэкапом). Команды ниже — для понимания механики и для локальных/ручных случаев.

Если БД уже существует (создана старым `db push`) и не имеет `_prisma_migrations`:

```bash
# 1. init-миграция из текущей схемы (уже создана: prisma/migrations/0_init/)
bunx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql

# 2. ПРИВЕСТИ БД к schema.prisma, если есть дрейф (reconcile, без db push):
bunx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > reconcile.sql
# отревьюить reconcile.sql → применить: psql "$DATABASE_URL" -f reconcile.sql

# 3. пометить init применённой (НЕ выполняя SQL — БД уже в этом состоянии):
bunx prisma migrate resolve --applied 0_init
```

После baseline — обычный цикл `migrate dev` (локально) / `migrate deploy` (прод).

> Prisma 7 флаги: `--from-empty`, `--from-schema`/`--to-schema` (путь к schema-файлу),
> `--from-config-datasource`/`--to-config-datasource` (живая БД из `prisma.config.ts`).

---

## Правила именования

| Сущность | Конвенция | Пример |
|----------|-----------|--------|
| Таблица (model) | PascalCase | `MeetingRecording` |
| Поле | camelCase | `hostId`, `scheduledAt` |
| Enum | PascalCase | `RecordingStatus` |
| Enum value | snake_case (как в проекте) | `not_started`, `ready` |
| Индекс | `@@index([field])` | `@@index([hostId, status])` |
| Unique | `@@unique([...])` | `@@unique([meetingId, livekitIdentity])` |

---

## Безопасные vs деструктивные изменения

### Безопасные (без потери данных)
- Добавить новое поле с default / опциональное (`String?`)
- Добавить индекс / новую модель / новое значение в enum (в конец)

### Деструктивные (требуют осторожности — теперь видны в файле миграции)
- Удалить/переименовать поле, изменить тип, удалить значение enum, сделать поле обязательным

Для деструктивных:
1. Убедись, что нет prod-данных, которые сломаются.
2. Если есть — сначала data-миграция (patch script в `scripts/` + регистрация в `apply-prod-deploy.ts` STEPS).
3. Потом миграция схемы. На проде авто-бэкап (`pg_dump`) делается перед `migrate deploy` автоматически.

---

## Чеклист после изменения схемы

- [ ] `bun run prisma:migrate -- --name <...>` создал файл миграции
- [ ] `migration.sql` отревьюен (деструктив осознан)
- [ ] `bun run prisma:generate` выполнен (migrate dev делает это сам)
- [ ] DTO / сервисы / frontend-типы обновлены
- [ ] `bun run typecheck` прошёл
- [ ] `second-brain/02_architecture/data-model.md` обновлён
- [ ] миграция закоммичена вместе с кодом
