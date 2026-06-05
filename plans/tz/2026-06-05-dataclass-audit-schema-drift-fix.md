# ТЗ: Починка schema drift по `dataClassAudit` (5 ERROR/30мин + латентное падение upsert проекций)

**Дата:** 2026-06-05
**Область:** `knowledge-core` (W4.2 DataClass enforce)
**Тип:** bugfix (schema drift) — затрагивает `schema.prisma` + один cron
**Приоритет:** High (видимый спам ERROR + отложенная мина на сохранение проекций)
**Статус:** готово к реализации, код НЕ начат

---

## 1. Симптом (что видно на проде)

Каждые 30 минут (`*/30`, отметки 09:00, 09:30, 10:00 UTC…) в `platform/logs` появляется **ровно 5 записей `[ERROR] SYSTEM/PrismaService`**:

```
Invalid `prisma.policy.count()` invocation:
  where: { dataClassAudit: { not: null } }
Unknown argument `dataClassAudit`. Available options are marked with ?.
```

Те же ошибки для `prisma.process.count()`, `prisma.regulation.count()`, `prisma.idea.count()`, `prisma.skillTrait.count()`.

Источник проверен на проде через `backend/scripts/diag.ts logs --level ERROR` (meet.crossmark.ru, 2026-06-05): за сутки 107 ERROR, из них стабильно по 5 на каждый прогон крона. Сама система при этом **не падает** — крон их глушит, метрика просто не считается.

## 2. Корневая причина

### 2.1. Откуда 5 ошибок
Крон [backend/src/modules/knowledge-core/workers/dataclass-audit-snapshot.cron.ts](../../backend/src/modules/knowledge-core/workers/dataclass-audit-snapshot.cron.ts) (`DataClassAuditSnapshotCron`, `@Cron('*/30 * * * *')`) обходит **13 проекций** (`PROJECTIONS`, строки 27–41) и для каждой делает:

```ts
delegate.count({ where: { dataClassAudit: { not: null } } })  // :84
```

Колонка `dataClassAudit Json?` в `schema.prisma` есть только у **8 моделей**: `AiUsageLog` (1423), `Card` (2146), `ConflictItem` (3514), `Decision` (5583), `Insight` (5709), `ProbeEvent` (5889), `SkillProfile` (7179), `ExecutablePersona` (7497).

У **5 моделей из списка крона** колонки нет → Prisma-клиент отбивает запрос валидацией (`Unknown argument`) ещё до БД:

| kind в кроне | модель | колонка `dataClassAudit` в схеме |
|---|---|---|
| `policy` | Policy | ❌ нет |
| `process` | Process | ❌ нет |
| `regulation` | Regulation | ❌ нет |
| `idea` | Idea | ❌ нет |
| `skill_trait` | SkillTrait | ❌ нет |

Крон не падает: в нём `try/catch` на каждую модель ([:89-97](../../backend/src/modules/knowledge-core/workers/dataclass-audit-snapshot.cron.ts#L89-L97)) глушит ошибку на уровне `debug`. Но `PrismaService` логирует **каждый невалидный запрос сам, на уровне ERROR** — отсюда 5 ERROR в лог каждые 30 минут.

### 2.2. Почему это не только косметика — латентная мина
Колонку `dataClassAudit` **пишут живые сервисы-проекторы**, причём безусловно (в `create` и `update`):

- [specialist-3-1-regulations.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts) — пишет в **regulation** (:354, :370), **process** (:528, :540, :563), **policy** (:711, :724, :748).
- [specialist-3-6-ideas.service.ts:188](../../backend/src/modules/knowledge-core/services/specialist-3-6-ideas.service.ts#L188) — пишет в **idea**.

Поскольку в схеме колонки нет, такой `upsert` упадёт целиком с тем же `Unknown argument` — **проекция (регламент / процесс / политика / идея) вообще не сохранится**. Пока не стреляло только потому, что на проде свежие встречи были короткие/без записи и таких проекций не порождали (в логах за неделю по `dataClassAudit` — только ошибки крона, ошибок самих specialist-сервисов нет). Как только реальная встреча даст контент на регламент/идею — запись молча потеряется.

### 2.3. Историческая причина (git)
- `0de1d7a4` (W4.2) — ввёл DataClass enforce: крон с 13 проекциями + сервисы-писатели.
- `22446248` («Фаза 8 — dataClassAudit Json? в Insight/Decision») — добавил колонку **только в Insight и Decision**.

До `Regulation/Process/Policy/Idea` Фаза 8 не дошла, хотя их писатели уже рассчитывают на колонку. Классический недокат схемы (schema drift): код опередил `schema.prisma`.

### 2.4. SkillTrait — отдельный случай
В `SkillTrait` `dataClassAudit` **не пишет никто** (grep по `backend/src` пуст). У модели нет ни `dataClass`, ни `dataClassAudit` — по дизайну skill-trait считается «всегда internal» (см. комментарий в backfill [patch-backfill-dataclass-audit.ts:215](../../backend/scripts/patch-backfill-dataclass-audit.ts#L215)). То есть аудит ему не положен, и он просто зря попал в список крона.

## 3. Как доставляется фикс схемы (версионируемая миграция — НЕ db push)

> **Смена правил 2026-06-05.** Схема в Z теперь катается **файловыми миграциями Prisma** (`backend/prisma/migrations/`), а `db push` запрещён в коммитах (только локальный черновик). Контекст: `plans/tz/2026-06-05-prisma-migrations-switch.md` и skill `prisma-db-push-rules`.

Правка `schema.prisma` оформляется миграцией через `bun run prisma:migrate -- --name <...>` (= `prisma migrate dev`): Prisma генерит `prisma/migrations/<ts>_<name>/migration.sql`, применяет к локальной БД и обновляет Client. **Миграция коммитится вместе с кодом.**

На прод схема приезжает **автоматически**: `migrate`-сервис в [docker-compose.yml:96](../../docker-compose.yml#L96) при каждом `docker compose up -d` выполняет `apply-prod-deploy.ts --with-schema`, а это теперь `prisma migrate deploy` (применяет только новые миграции, транзакционно, с авто-бэкапом). Отдельной ручной prod-команды не требуется.

Наша миграция — **безопасная**: добавление nullable-колонки `dataClassAudit Json?` в 4 таблицы (`ALTER TABLE ... ADD COLUMN "dataClassAudit" JSONB`). Деструктива (DROP/ALTER TYPE/NOT NULL) нет, данные не теряются.

Бонус: backfill [patch-backfill-dataclass-audit.ts](../../backend/scripts/patch-backfill-dataclass-audit.ts) уже зарегистрирован в `apply-prod-deploy.ts` STEPS (:130) и устроен идемпотентно — его pre-check (`count({where:{dataClassAudit:null}})` в try/catch, :112) после появления колонок сам подхватит 4 новые модели и проставит `dataClassAudit` существующим строкам.

---

## 4. Решение (фазы)

### Фаза 1 — добавить колонку в схему  `[x]`
В `backend/prisma/schema.prisma` добавить поле **`dataClassAudit Json?`** в 4 модели, сразу после существующего поля `dataClass`, зеркально тому как сделано в `Insight`/`Decision`:

- `Regulation` (поле `dataClass` на :5396)
- `Process` (поле `dataClass` на :5106)
- `Policy` (поле `dataClass` на :5436)
- `Idea` (поле `dataClass` на :5813)

> SkillTrait в схему **не** трогаем (см. Фазу 2).

После правки схемы — создать миграцию: `cd backend && bun run prisma:migrate -- --name add_dataclass_audit_to_projections` (генерит файл миграции + применяет локально + делает generate). Отревьюить `migration.sql` — должны быть только `ALTER TABLE "regulations"/"processes"/"policies"/"ideas" ADD COLUMN "dataClassAudit" JSONB` (имена таблиц — по `@@map`, проверить в схеме). Файл миграции **коммитится** вместе с кодом. `db push` для прод/коммита НЕ использовать.

### Фаза 2 — убрать `skill_trait` из крона  `[x]`
В [dataclass-audit-snapshot.cron.ts](../../backend/src/modules/knowledge-core/workers/dataclass-audit-snapshot.cron.ts) удалить из массива `PROJECTIONS` (:31) строку:
```ts
{ kind: 'skill_trait', modelKey: 'skillTrait' },
```
Обоснование: в `skillTrait` `dataClassAudit` не пишется и аудит ему по дизайну не положен; держать его в снапшоте — гарантированная ошибка/нулевая метрика.

> Альтернатива (не выбрана): добавить колонку и в `SkillTrait`. Отклонено — нет писателя, метрика всегда была бы 0 и вводила бы в заблуждение.

### Фаза 3 — hardening: крон самолечится от будущего дрейфа  `[x]`
**Реализовано (лучше изначального плана).** Вместо запроса в `information_schema` на каждую модель (что требует имён таблиц и round-trip в БД) — фильтр по статическому `Prisma.dmmf.datamodel.models`: экспортируемая `modelKeysWithDataClassAudit()` один раз собирает набор делегатов, реально имеющих поле `dataClassAudit`, а `snapshotPresentRatio` пропускает проекции вне этого набора. Никаких хардкод-таблиц, никаких лишних SQL, ERROR от дрейфа невозможен в принципе. Покрыто `dataclass-audit-snapshot.cron.spec.ts`.

### Фаза 4 — верификация  `[x]`
- `cd backend && bun run typecheck` — зелёный (Prisma-клиент знает новое поле; писатели specialist-3-1/3-6 типизируются).
- `bun run lint`, `bun run build` — зелёные.
- Локально: миграция применилась (`bun run prisma:migrate:status` — чисто, без дрейфа); колонки появились (`\d regulations` и т.д. содержат `dataClassAudit`).
- Локальный прогон крона (или mini-spec) на dev → 0 ERROR от `PrismaService`, метрика `kc_dataclass_audit_present_ratio` считается для regulation/process/policy/idea.
- (если делалась Фаза 3) — мини-проверка, что отсутствие колонки даёт `warn`, а не ERROR.

---

## 5. Критерии приёмки
1. После выката: в `platform/logs` **нет** ERROR `Invalid prisma.{policy,process,regulation,idea,skillTrait}.count()` ни на одном прогоне крона (проверить через `diag.ts logs --level ERROR --from <дата выката>` спустя ≥30 мин).
2. Реальная встреча, породившая регламент/процесс/политику/идею, сохраняет проекцию без ошибки `Unknown argument dataClassAudit` (проверить `diag.ts trace --meeting <id>` или прямым счётчиком проекций).
3. Метрика `kc_dataclass_audit_present_ratio{kind}` присутствует для `regulation/process/policy/idea` и отсутствует для `skill_trait`.
4. `typecheck` / `lint` / `build` зелёные.

## 6. Прод-операции
- Отдельных ручных шагов на проде **нет**: новую миграцию применит штатный `migrate`-сервис (`--with-schema` → `prisma migrate deploy`) при `docker compose up -d --build`.
- По правилам репозитория изменение `schema.prisma` (новые колонки) триггерит запись в `docs/operations/prod-deploy-log.md` **Шаг 4** — добавить строку «миграция `<ts>_add_dataclass_audit_to_projections` → `dataClassAudit Json?` в Regulation/Process/Policy/Idea (применяется штатным `migrate deploy`, отдельной команды не требуется)». Также обновить `second-brain/02_architecture/data-model.md`.
- Авто-бэкап (`pg_dump` → z-backups) делается перед `migrate deploy` автоматически. Добавление nullable-колонки данные не теряет.

## 7. Риски и их снятие
- **Риск:** `--accept-data-loss` на проде. **Снятие:** добавляем только nullable-колонку `Json?` — drop/потери нет; авто-бэкап всё равно делается.
- **Риск:** забыть `prisma:generate` после правки схемы → клиент не увидит поле, typecheck/рантайм упадёт. **Снятие:** Фаза 1 включает generate явным пунктом; в Dockerfile generate тоже есть (:31, :59).
- **Риск:** backfill при следующем выкате пройдётся по новым колонкам и проставит `backfill_v1` существующим строкам — это ожидаемо и идемпотентно (skip при `dataClassAudit IS NOT NULL`).

## 8. Вне рамок этого ТЗ (зафиксировать отдельно, не чинить здесь)
- **Отдельный инцидент LLM-провайдеров:** в трейсах рабочих встреч `kc.meeting-report-fast` циклично падает — deepseek timeout >30s, openai-via-proxy 400 «must contain the word 'json'», ollama 401 «Invalid API key format». Это самостоятельная проблема доступности моделей, требует отдельного разбора.
- **UX «нет записи → нет отчёта»:** если хост не нажал «Запись» ([livekit-events.handler.ts:187](../../backend/src/modules/webhooks/livekit-events.handler.ts#L187), авто-запись только при `recordByDefault`), встреча завершается `completed` без транскрипта и отчёта, и пользователю об этом ничего не сообщается. Кандидат на отдельное ТЗ (явный статус «запись не велась» в карточке встречи).

---

## Итог
Реализовано: **да, целиком** (ветка `sergdev`, коммиты `8986affb` Фаза 1 + `6d96c2a5` Фазы 2-4).
- Фаза 1: `dataClassAudit Json?` в Regulation/Process/Policy/Idea + миграция `20260605114300_add_dataclass_audit_to_projections` (4× ADD COLUMN JSONB, сгенерирована офлайн через `migrate diff` т.к. Docker локально недоступен).
- Фаза 2: `skill_trait` убран из `PROJECTIONS` крона.
- Фаза 3 (hardening): реализован лучше плана — самолечащийся DMMF-фильтр `modelKeysWithDataClassAudit()` вместо `information_schema`-запросов.
- Фаза 4: спек `dataclass-audit-snapshot.cron.spec.ts` (4 теста) + расширенная верификация.

Эмпирическое подтверждение диагноза: до фикса `typecheck` падал (писатели specialist-3-1/3-6 ссылались на несуществующее поле), после — зелёный.

**Верификация:** typecheck ✓ · lint ✓ · build ✓ · 55 тестов воркеров + 5 целевых ✓.
**НЕ проверено локально:** применение миграции к живой БД и факт исчезновения ERROR в проде — Docker Desktop локально упал («unable to start»); миграция применится штатным `migrate deploy` на проде, smoke по логам — после выката (см. prod-deploy-log Шаг 12).

Прод-доставка — штатным `migrate deploy` в `migrate`-контейнере, без отдельных команд.
