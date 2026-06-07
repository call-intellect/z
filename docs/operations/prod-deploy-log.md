# Накопительная prod-инструкция — Z / Кора

> **Назначение.** Единый реестр операций, которые нужно выполнить на проде после очередного push в `dev` / `main`.
> Каждый push, который требует операций (миграция БД, seed, patch, новые ENV, рестарт), **обязан** добавить запись в раздел [🚨 Накоплено к выкату](#-накоплено-к-выкату).
> После реального выката на прод накопленный блок переезжает в [📂 Архив применённых](#-архив-применённых).
>
> **Прод-программист:** открой раздел «Накоплено к выкату», иди сверху вниз — это твоя готовая копи-пейст-инструкция.
> **Агент (Claude):** правила обновления см. в [🔄 Правила поддержки файла](#-правила-поддержки-файла) и в `CLAUDE.md` → «Триггер 1: после `git push`».
>
> ⚠️ **ПРАВИЛО №1.** Z на проде живёт целиком внутри `docker-compose.yml` (postgres + redis + migrate + backend + frontend, единый стек). Все команды этого файла — через `docker compose exec backend …` (для запущенного backend) или `docker compose run --rm backend …` (для разового запуска). **Никаких прямых `cd backend && bun run …` или `bun install` на хосте.** Хост — только `git pull` + `docker compose build/up/down`.

---

## ⚡ Быстрый выкат (`docker compose up -d`)

С 2026-06-01 контейнер `migrate` сам прогоняет весь выкат. Выкат = собрать образ + поднять стек:

```bash
cd /home/docker/z
git pull origin dev
docker compose build backend frontend
docker compose up -d
docker compose logs -f migrate     # дождаться завершения + посмотреть SUMMARY
docker compose ps                  # z-migrate=Exited(0), backend/frontend=healthy
```

`migrate` выполняет (через `apply-prod-deploy.ts --mode update --with-schema --continue-on-fail --no-fail-on-steps`):
**авто-бэкап БД** (`pg_dump` → volume `z-backups`) → **dedupe** → **`prisma migrate deploy`** → **`apply-postgres-init`** → **все seed/patch/backfill**. Затем стартуют `backend` и `frontend`.

> **С 2026-06-05 — версионируемые миграции, НЕ `db push`.** Схема применяется файлами из `backend/prisma/migrations/` через `prisma migrate deploy` (транзакционно, только новые миграции). Это убрало класс частичных/дрейфующих состояний от `db push --accept-data-loss` (инцидент: осиротевший enum `ParticipantInvitationStatus`). **Одноразовый baseline существующего прода** — см. блок «🆕 Baseline миграций» в разделе «Накоплено к выкату». После baseline новые схемы просто доезжают через `migrate deploy` на каждом `up -d`.

> **Тихий лог (с 2026-06-05).** seed/patch/backfill-шаги печатают по ОДНОЙ строке-итогу (`✓ [phase] script — inserted=…, skipped=…`); полный вывод шага — только если он упал. Идемпотентный выкат больше не засоряет лог сотнями строк. Нужен полный вывод всех шагов — `--verbose` или env `APPLY_PROD_DEPLOY_VERBOSE=1`. Schema-фаза (migrate deploy / postgres-init) печатается как есть.

Семантика отказов (важно):
- **Сбой схемы** (бэкап не сделался / migrate deploy упал) → `migrate` exit 1 → `backend` НЕ стартует. Это правильно: схема-mismatch фатален. Чини и `up -d` снова.
- **Осечка отдельного seed/backfill** → залогирована в `=== SUMMARY ===`, но `migrate` выходит 0 → стек поднимается. Идемпотентные скрипты перезапусти руками: `docker compose exec backend bun run scripts/<имя>.ts`.

**Авто-бэкап обязателен** перед `migrate deploy`. Файл: `/app/backups/pre-deploy-<ts>.dump` в volume `z-backups`. Restore:
```bash
docker compose run --rm --no-deps backend \
  pg_restore --clean --if-exists -d "$DATABASE_URL" /app/backups/<file>.dump
```
Список бэкапов: `docker compose run --rm --no-deps backend ls -lh /app/backups`.

> Требует `pg_dump` в образе (`postgresql16-client`, `backend/Dockerfile`) и volume `z-backups` (`docker-compose.yml`).
>
> **Ручной прогон** (например, доехать сиды без пересборки) — через работающий backend:
> `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update --continue-on-fail`.
> Прогон схемы вручную в обход migrate: `docker compose run --rm --no-deps backend bun run scripts/apply-prod-deploy.ts --mode update --with-schema` (внутри = `prisma migrate deploy`). Только миграции, без сидов: `docker compose run --rm --no-deps backend sh -c 'bunx prisma migrate deploy'`; статус — `... sh -c 'bunx prisma migrate status'`.
>
> **Первый bootstrap с нуля** (пустая БД): замени `--mode update` на `--mode all` (добавит супер-админа и базовые сиды). Для существующего прода — всегда `--mode update`.

Подробная пошаговая инструкция со smoke-проверками — ниже (Шаги 0–12). Быстрый путь её заменяет в типовом случае.

---

## 🚨 Накоплено к выкату

**Окно:** 2026-05-20 .. 2026-05-30 (с момента последнего prod-cut).
**Источник:** все рефлексии в `second-brain/05_история/` с этой даты + git log dev.
**Содержит:** ~80 prod-скриптов (patch/seed/migrate/backfill/setup) + ~175 новых Prisma-моделей + ~135 новых ENV (все опциональные) + 2 опасных schema-изменения + новый модуль биллинга (Tochka).

> Все рабочие директории — внутри контейнера `backend` (`/app`). На хосте оставайся в корне репо `~/work/z` (или где у тебя `docker-compose.yml`).

### 🎛️ Опциональные ручные операции (вне авто-аггрегатора)

> Эти скрипты **НЕ зарегистрированы** в `apply-prod-deploy.ts` STEPS и **НЕ выполняются** на `docker compose ... apply-prod-deploy`. Запускать **только вручную, осознанно владельцем** (бюджетные / cost-решения). Все идемпотентны (повторный прогон = no-op).

- **(опц., owner cost-decision)** `docker compose exec backend bun run scripts/patch-task-extractor-route-pro.ts` — перевести task-экстракторы (`tasks`, `meeting-extract-actions`) с дефолтной `deepseek-v4-flash` на capable `deepseek-v4-pro` (точнее, но дороже). Не входит в авто-выкат. Откат — вернуть `deepseek-v4-flash` через `/admin/ai-models/[taskType]` или обратным патчем. Не трогает маршруты с `editedByAdmin=true`.

---

### 🔐 2026-06-06 — Доступ к знаниям через группы + фундамент-провенанс (knowledge-access)

> Контракт: `plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md`. Ветка `feature/knowledge-access-groups`. 8 фаз: Ф1 провенанс автора на все типы + per-adapter identity · Ф2 модель групп + резолвер · Ф3 ingest-вывод группы блока · Ф4 security-гейт во всех поверхностях retrieval · Ф5 контекст клонов в правах спрашивающего · Ф6 наследование группы на проекции · Ф7 frontend admin (матрица/членство/флаг встречи) · Ф8 выкат.
>
> **Зачем для прода:** 1 аддитивная миграция (4 модели + 2 поля) + 1 seed (группы) + 2 backfill (subject-атрибуция всех типов, department-группы) + 1 patch (interview→personal) + 2 новых флага. **Гейт по умолчанию OFF — поведение байт-в-байт текущее.** Выкат безопасно поэтапный: off → shadow (сверка метрик) → enforce.

- **Шаг 1 — ENV / AdminSetting**:
  - **ENV `KNOWLEDGE_ACCESS_ENFORCEMENT`** = `off` | `shadow` | `enforce`, **дефолт `off`** (`env.schema.ts`). Режим гейта доступа к знаниям. На выкате оставить `off`; перевод в `shadow`/`enforce` — см. Шаг 12. owner/admin/super — bypass всегда.
  - **AdminSetting `knowledge.subjectAttributionAllTypes`** (bool, **default TRUE**, code-fallback TRUE через `TypedConfigService.getDynamic`) — расширенная привязка автора знания на ВСЕ типы (не только reasoning). Master-выключатель `knowledge.subjectAttributionEnabled` сохранён. Засеивается идемпотентно `seed-admin-settings.ts` (уже в агрегаторе, phase `seed-base`); без сидера работает на code-дефолте.
- **Шаг 4 — Prisma миграция** — **обязательно, автоматически** (аддитивно, без data-loss). Миграция **`20260606114416_knowledge_access_groups`** = 4 новые модели (`KnowledgeGroup`, `KnowledgeGroupMember`, `IdeaBlockAccess`, `GroupVisibilityPolicy`) + enum `KnowledgeGroupKind` + поля `Meeting.closedGroupKind String?` и `MeetingTypeConfig.defaultClosedGroupKind String?`. Едет файлом миграции, применяется **автоматически** на `docker compose up -d` через `prisma migrate deploy` (migrate-контейнер). Проверка: `docker compose run --rm --no-deps backend sh -c 'bunx prisma migrate status'` → миграция в списке applied.
- **Шаг 6 — Patch** — **1 новый, идемпотентный**: `scripts/patch-meeting-type-closed-defaults.ts` — `MeetingTypeConfig.defaultClosedGroupKind='personal'` для типа `interview` (В6), если ещё NULL (на проде, где bootstrap прошёл до фичи). Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: 'patch'`, `skipBootstrap: true`). Прогон: `docker compose exec backend bun run scripts/patch-meeting-type-closed-defaults.ts --dry-run` → без флага. Через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 7 — Seed** — **1 новый, идемпотентный**: `scripts/seed-knowledge-groups.ts` — синглтон-группы «Руководство»/«Совет» + department-группы из существующих `Department` + leadership-членство из owner/admin. Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: 'seed-base'`). Прогон: `docker compose exec backend bun run scripts/seed-knowledge-groups.ts` (или агрегатором `apply-prod-deploy.ts --mode update`).
- **Шаг 8 — Backfill** — **2 новых, идемпотентных**:
  - `scripts/backfill-subject-attribution-all-types.ts` — добивает `IdeaBlockEntity{role='subject'}` для исторических canonical-блоков ВСЕХ типов (не только reasoning) + per-adapter identity (tracker/chatbox/dump/email). Уважает флаги `knowledge.subjectAttributionEnabled` + `knowledge.subjectAttributionAllTypes`. Сначала `--dry-run`, затем без флага. STEPS (`phase: backfill`, `skipBootstrap`).
  - `scripts/backfill-block-access.ts --departments` — department-группы (`IdeaBlockAccess`) для исторических блоков из functional axisLabels (+ участники/автор). closed задним числом НЕ назначается (В5: историческое знание = открыто). **Без `--departments` скрипт no-op** — в STEPS прописан с `args:['--departments']`. Сначала `--dry-run --departments`, затем `--departments`. STEPS (`phase: backfill`, `skipBootstrap`).
  - Оба — через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (backend: новый модуль `knowledge-access`, `KnowledgeAccessResolver` в rbac, `BlockAccessDeriverService` + гейт во всех retrieval-поверхностях, `env.schema.ts` новый флаг; frontend: `company-admin/access-groups`, селектор закрытости встречи): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke** (поэтапный перевод флага):
  1. После выката `KNOWLEDGE_ACCESS_ENFORCEMENT` остаётся `off` — выдача идентична baseline. Swagger `/api/docs` показывает `/api/v1/knowledge-access/*` и `PATCH /meetings/:id/closed-group`.
  2. Перевести в **`shadow`** (выдача не меняется), дать набежать данным, сверить метрики: `curl -s localhost:3000/metrics | grep kc_access_shadow_diff_total` — по `{surface}` видно, сколько блоков было бы отфильтровано. Также `kc_subject_attribution_total{via}` растёт (провенанс работает).
  3. Если расхождение ожидаемое — перевести в **`enforce`**. Проверить e2e-предикат «логист не видит блок Совета» во всех поверхностях: chat / search / snapshot / blocks / контекст клона — член «Логистики» НЕ получает блок с `IdeaBlockAccess{closed=Совет}`; owner — получает. `curl -s localhost:3000/metrics | grep kc_access_denied_total` → счётчик `{surface}` растёт.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🧩 2026-06-06 — Трекер + Встречи (sergdev)

> Контракт: `plans/tz/2026-06-06-FINAL-session-tracker-and-meetings.md`. Ветка `sergdev`. 12 фаз: A1-A7 (трекер: пикер проекта во Входящих, единый «Спринт», группа меню «Задачи», подвкладки проекта, русификация, скрытие теневого проекта, консолидация поллинга бейджей) + B1-B5 (встречи: войти/ссылка/пригласить в журнале, rejoin хоста, надёжный copyLink, лобби-ссылка, эндпоинт `POST /meetings/:id/invitees`).
>
> **Зачем для прода:** аддитивная миграция (`Project.systemGenerated`) + 1 русификационный patch + 1 backfill для legacy-контейнеров. Остальные фазы (A1-A5 фронт, A7, B1-B4) — без БД-операций.

- **Шаг 4 — Prisma миграция** — **обязательно, автоматически** (аддитивно, без data-loss). Миграция **`20260606071402_project_system_generated`** = `ALTER TABLE "Project" ADD COLUMN "systemGenerated" BOOLEAN NOT NULL DEFAULT false` (скрывает теневой org-контейнер «Спринт компании» из `GET /projects`). Едет файлом миграции, применяется **автоматически** на `docker compose up -d` через `prisma migrate deploy` (migrate-контейнер). Никакого `db push`. Проверка применения: `docker compose run --rm --no-deps backend sh -c 'bunx prisma migrate status'` → миграция в списке applied.
- **Шаг 6 — Patch** — **1 новый, идемпотентный**: `scripts/patch-team-templates-ru.ts` — русификация ролей шаблона продаж (SDR → «Специалист по квалификации», BANT/CHAMP → «методике квалификации») в `TeamTemplate.definition`. Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: 'patch'`, `skipBootstrap: true`). Прогон: `docker compose exec backend bun run scripts/patch-team-templates-ru.ts` (или через агрегатор `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`).
- **Шаг 8 — Backfill** — **1 новый, идемпотентный**: `scripts/backfill-system-generated-projects.ts` — помечает существующие legacy org-контейнеры «Спринт компании» `systemGenerated = true` (чтобы они тоже пропали из `GET /projects`). Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: 'backfill'`, `skipBootstrap: true`). Сначала `--dry-run`, затем без флага: `docker compose exec backend bun run scripts/backfill-system-generated-projects.ts --dry-run` → `docker compose exec backend bun run scripts/backfill-system-generated-projects.ts`. Через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (backend: `ProjectsService.findAll` фильтр `systemGenerated:false`, `MeetingsService.addInvitees` + контроллер; frontend: журнал/комната/лобби встреч, меню «Задачи», подвкладки проекта, пикер проекта, «Архив спринтов»): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - Swagger `/api/docs` показывает `POST /meetings/:id/invitees`.
  - Ручной чек «допригласить» на active-встрече → новый `Participant(invitationStatus='invited')` + ушло приглашение со ссылкой `…/m/<id>?inv=<token>`; повтор того же `userId`/`personId` → no-op (`skipped`).
  - `GET /projects` больше не возвращает теневой «Спринт компании» (org-scope контейнер) — он виден только в разделе «Спринты».
  - Прочие фазы (A1-A5 фронт, A7, B1-B4) — без БД-операций, достаточно `docker compose up -d --build`.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🛡️ 2026-06-05 — Надёжность LLM-роутера + нормализация цепочек (deepseek → openai → kie)

> Контракт: `plans/tz/2026-06-05-llm-router-resilience-and-chain-normalization.md`. Ветка `sergdev`. Коммиты: Ф1 `025714d3`, Ф3 `caf69f13`, Ф4 `b68554fb`, Ф2a `c21c9e15`, Ф2b `cb820a69`.
>
> **Зачем.** Аудит прод-маршрутов 2026-06-05 показал: у большинства агентов работал только PRIMARY. SECONDARY (`openai-via-proxy`) падал `400 "messages must contain the word 'json'"` на всех JSON-задачах; TERTIARY (`ollama:qwen3.5:9b`) — `401 Invalid API key format` везде. 5 pro-агентов вообще без fallback, граф (`block-linker`) молча терял связи, таймаут 30с убивал thinking-модели. Цель — стандартная цепочка везде `deepseek → openai-via-proxy(gpt) → kie:gemini-3.1-pro`, ollama выведен из всех боевых цепочек, `gpt-4o` выведен полностью.

- **Шаг 1 — ENV** — **1 новый (опциональный, дефолт уже поднят в коде)**: `LLM_ROUTER_DISPATCH_TIMEOUT_MS=300000` — таймаут одного dispatch модели (per-attempt). Был `30000`, поднят до `300_000`, чтобы thinking-модели (`deepseek-v4-pro`) успевали на объёмном входе. Можно не выставлять (code-fallback теперь `300_000`); если в проде стоит руками старое `30000` — **поднять до `300000`**. ⚠️ Это заменяет старую запись «`LLM_ROUTER_DISPATCH_TIMEOUT_MS=30000` (С30)» в архивном блоке аудита 2026-05-29 — там был дефолт 30с, теперь 300с.
- **Шаг 4 — Prisma** — **не требуется** (схема не менялась).
- **Шаг 6 — Patch** — **1 новый, идемпотентный**: `scripts/patch-normalize-llm-chains-deepseek-openai-kie.ts` — нормализует все цепочки `LlmTaskRoute` (tenantId=null) к стандарту `deepseek → openai-via-proxy(gpt) → kie:gemini-3.1-pro`; выводит `ollama` из primary/secondary и `gpt-4o` из проекта (4 агента: `orchestrator-plan`/`orchestrator-synthesize`/`brand-voice-extract` → `deepseek-v4-pro`, `concierge-respond` → `gpt-5-mini`); openai-primary исключения (классификаторы на nano + `debate`-diversity) сохраняются. Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: 'seed-llm-routes'`, `skipBootstrap: true`) **БЕЗ `--force`** — steady-state уважает `editedByAdmin`-правки.
  - ⚠️ **РАЗОВО при ЭТОМ выкате — гнать с `--force`** (решение владельца Р-A): нужно перетереть легаси `ollama`/`gpt-4o`, в т.ч. в маршрутах с `editedByAdmin=true`. Порядок обязателен: сначала `--dry-run` (глазами просмотреть строки с `editedByAdmin=true` — что именно перетираем), затем `--force`:
    ```bash
    docker compose exec backend bun run scripts/patch-normalize-llm-chains-deepseek-openai-kie.ts --dry-run
    docker compose exec backend bun run scripts/patch-normalize-llm-chains-deepseek-openai-kie.ts --force
    ```
  - На последующих выкатах `--force` НЕ нужен — агрегатор гонит без него (steady-state, не клобберит будущие админ-правки).
- **Шаг 7 — Seed** — **1 новый, идемпотентный**: `scripts/seed-llm-task-routes-missing-registry.ts` — заводит дефолтные цепочки для 5 ранее не зарегистрированных taskType (`knowledge-specialists-combined`, `dialog-multi-query-clone`, `checkin-sentiment-batch`, `experiment-extract`, `experiment-summarize-lessons`) — закрытая дыра реестра (они теперь в `ALL_LLM_TASK_TYPES`). Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: 'seed-llm-default'`). Также code-сиды (`seed-llm-task-routes-default.ts`) и `DEFAULT_FALLBACK_CHAIN` обновлены: tertiary `ollama:qwen3.5:9b` → `kie:gemini-3.1-pro`. Прогон: `docker compose exec backend bun run scripts/seed-llm-task-routes-missing-registry.ts`.
- **Агрегатором (рекомендуется)** — оба скрипта входят в `apply-prod-deploy.ts --mode update` (`docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`). **НО** разовый `--force` для нормализации агрегатор не делает — его гнать **вручную** командой выше, до/после агрегатора.
- **Шаг 11 — Docker rebuild** — обязателен (backend: `env.schema.ts` дефолт таймаута, `OpenAiProxyService.ensureJsonHint` (Ф3 — чинит secondary на JSON-задачах), `block-linker` retry + общий lenient-парсер `json-extract.util.ts` (Ф4), `kie.maxDataClass internal→private`, регистрация 5 taskType): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke**:
  - карта маршрутов после прогона (read-only): `docker compose exec backend bun run scripts/diag-routes.ts` → (а) `ollama` нет ни в одной строке боевых LLM-цепочек, (б) tertiary везде `kie:gemini-3.1-pro`, (в) `gpt-4o` (без `-mini`) отсутствует, (г) 5 ранее потерянных taskType присутствуют.
  - новая метрика молчаливой деградации графа: `curl -s localhost:3000/metrics | grep kc_block_linker_fallback_none_total` (растёт `{reason=...}` только при реальной потере связи — повесить алерт).
  - secondary на JSON-задачах больше не 400: после тест-встречи `bun run --env-file=.env scripts/diag.ts trace --meeting <id>` → `reportFast` не failed, в логах нет `messages must contain the word 'json'`.

#### 💰 2026-06-05 — Безопасность стоимости LLM + retention телеметрии (поверх блока надёжности роутера)

> Контракт: `plans/tz/2026-06-05-llm-cost-safety-and-telemetry-retention.md`. Ветка `sergdev`. Закрывает риски #4 (бюджет LLM не enforce-ится, `costUsd=0` молча) и #5 (`AiUsageLog` без retention) техаудита. Реализовано целиком (3 фазы).
>
> **Зачем.** До фикса: взбесившийся воркер/тенант выжигал месячный лимит за часы (бюджет только наблюдался алертом раз в 2ч, `LlmRouter.call` его не проверял); модели вне прайс-карты молча давали `costUsd=0` (только `logger.debug` — расход невидим); телеметрия `AiUsageLog` (строка + 2 TEXT-превью до 8 КБ) росла append-only без retention.

- **Шаг 4 — Prisma** — **не требуется** (схема не менялась; `OrgBudgetCap.capKind 'soft'|'hard'` уже был в схеме; превью `AiUsageLog` уже nullable).
- **Шаг 7 — Seed / AdminSetting** — **не требуется**. Все новые ключи читаются через `getDynamic` с code-fallback → дефолты применяются лениво, выкат БЕЗ сидов безопасен. Ключи (дефолты): `llm.budget.enforce_enabled`(bool, **false**), `llm.budget.mtd_cache_ttl_sec`(int, 60), `llm.usage_log.scrub_previews_after_days`(int, 30), `llm.usage_log.delete_after_days`(int, 365). Опционально настраиваются через админку настроек под super_admin.
- **Прод-операций по схеме/сидам НЕТ.** Достаточно деплоя кода: `docker compose up -d --build backend` (+ перезапуск worker-процесса — там self-scheduling retention-сервис `AiUsageLogCleanupService`, раз в час).
- **Шаг 11 — Docker rebuild** — обязателен (backend: `llm-router.service.ts` pre-dispatch budget-gate + WARN на unpriced; новый `budget-guard.service.ts`; новый `ai-usage-log-cleanup.service.ts`; `business-metrics.service.ts` — 2 новые метрики): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke**:
  - новые метрики в `/metrics`: `curl -s localhost:3000/metrics | grep -E 'llm_cost_unpriced_total|llm_budget_exceeded_total'` → счётчики присутствуют. `llm_cost_unpriced_total{provider,model}` растёт при вызове модели вне прайс-карты (видимость `costUsd=0`); `llm_budget_exceeded_total{mode}` (`mode=observe`|`enforce`) — при превышении hard-cap.
  - retention (через ≥1ч после старта worker): в логах worker строка о прогоне `AiUsageLogCleanupService` (Tier-1 scrub превью / Tier-2 delete), без ERROR.
- **⚠️ ВАЖНО — `llm.budget.enforce_enabled` оставить OFF** до решения владельца по поведению enforcement (развилка Р-1 в ТЗ: block / degrade / alert-only). До включения — чистый observe: бюджет считается, метрится, логируется «would block», но НЕ блокирует. Включать только после явного подтверждения владельца А/B/C.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🎯 2026-06-05 — ТЗ-F Цели: ответственный (ownerPersonId) + кэш blocksCount + UI-полировка

> Ветка `feature/goals-improvements`. Контракт: `plans/tz/2026-06-05-goals-improvements.md` (Ф1–Ф4; Ф5 голос — vNext). Коммиты: Ф1 `afe344b2`+`2701cff2`, Ф2 `62febeec`, Ф3 `158ac9df`, Ф4 `184bce07`.

- **Шаг 4 — Prisma миграция** — **обязательно** (аддитивно, без data-loss). После мержа `dev` (переход на миграции) изменения едут **файлом миграции `20260605130000_goal_owner_person_and_blocks_cache`**, применяется **автоматически** на `docker compose up -d` через `prisma migrate deploy` (migrate-контейнер). Никакого `db push`. Содержимое: `Goal += ownerPersonId String?` (relation `ownerPerson` GoalOwnerPerson, FK `→ persons(id) ON DELETE SET NULL`) + `cachedBlocksCount Int?` + `@@index([tenantId, ownerPersonId])`; `Person += ownedGoals Goal[] @relation("GoalOwnerPerson")`. Проверка применения: `docker compose run --rm --no-deps backend sh -c 'bunx prisma migrate status'` → миграция в списке applied.
- **Шаг 1 — ENV/AdminSetting** — новых ENV/флагов нет. Пороги «светофора уверенности» — code-fallback в `frontend/src/domain/goal.ts` (`confidenceLevel`); вынос в AdminSetting → vNext.
- **Шаг 11 — Docker rebuild** — обязателен (backend: `goals.service` ownerPerson + `strategic-alignment.worker` пишет `cachedBlocksCount`; frontend: пикер ответственного + светофор уверенности + вердикт движения + русификация): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - Swagger `/api/docs` → `GoalListItemDto` содержит `ownerPersonId`/`ownerPersonName`/`blocksCount`.
  - `POST /api/v1/goals { …, ownerPersonId:"<Person.id>" }` → 201 с `ownerPersonName`; `ownerPersonId` чужого tenant → 404 `owner_person_not_found`.
  - после ночного прогона `strategic-alignment` у целей заполняется `Goal.cachedBlocksCount` (светофор в списке без JOIN).
- Новых очередей/cron нет (используется существующий `strategic-alignment.worker`, +1 поле `cachedBlocksCount` в его `tx.goal.update`).

---

### 📊 2026-06-05 — Пакет улучшений дашбордов (ТЗ B/D/C/G/E: компас целей · план-факт по людям · операции · люди под риском · кабинет «Я»)

> Контракты: `plans/tz/2026-06-05-goal-vector-compass.md` (B), `…-weekly-per-person-plan-fact.md` (D), `…-operations-dashboards-redesign.md` (C), `…-employee-pulse-and-people-at-risk.md` (G), `…-personal-cabinet-me.md` (E). Ветка `feature/dashboards-improvements`. Изменения схемы **аддитивны** (2 новых nullable-колонки + индексы, опасных нет). C/E содержат только backend-сервисы и фронт (схему не трогают).

- **Шаг 4 — Prisma миграция** — **обязательно** (аддитивно, без data-loss). После мержа `dev` (переход на миграции) изменения едут **файлом миграции `20260605120000_dashboards_goal_primary_commitment_author`**, применяется **автоматически** на `docker compose up -d` через `prisma migrate deploy` (migrate-контейнер). Никакого `db push`. Содержимое миграции:
  - **ТЗ-B:** `Goal.isPrimary Boolean @default(false)` + `@@index([tenantId, isPrimary])` — главная цель компании (для компаса на главной директора).
  - **ТЗ-D:** `IdeaBlock.commitmentAuthorPersonId String?` + relation `CommitmentAuthor → Person?` (обратка `Person.commitmentsAuthored`) + FK `→ persons(id) ON DELETE SET NULL` + `@@index([tenantId, commitmentAuthorPersonId])` + `@@index([tenantId, signalType, commitmentAuthorPersonId, commitmentDueDate])` — автор обещания (кто пообещал), для недельного план-факта по людям.
  - Проверка применения: `docker compose run --rm --no-deps backend sh -c 'bunx prisma migrate status'` → миграция в списке applied.
- **Шаг 5 — postgres-init.sql — partial unique** — новый: `goal_primary_unique ON "Goal"("tenantId") WHERE "isPrimary" = true` — гарантирует не более одной главной цели на Org. Применяется: `docker compose exec backend bun run apply-postgres-init` (идемпотентно, `CREATE UNIQUE INDEX IF NOT EXISTS`).
- **Шаг 1 — ENV/AdminSetting** — **новых ENV нет.**
  - **ТЗ-G:** 5 порогов «люди под риском» через `AdminSetting` (super_admin, code-fallback в коде; отдельный сид на первом этапе не обязателен — работают на дефолтах): `peopleAtRisk.overduePenaltyPerItem`=**8**, `peopleAtRisk.overduePenaltyCap`=**30**, `peopleAtRisk.redMoodShareThreshold`=**0.34**, `peopleAtRisk.redMoodPenalty`=**15**, `peopleAtRisk.riskThreshold`=**60**. Менять в админке настроек.
  - **ТЗ-D:** флаг атрибуции автора обещания `knowledge.commitmentAuthorAttributionEnabled` (**default TRUE**, code-fallback через `TypedConfigService.getDynamic`). `false` = `attributeCommitmentAuthor` в `block-ingest` не проставляет `commitmentAuthorPersonId`.
  - **ТЗ-E:** отписка от соцвклада — **Redis-preference** (`helpfulness:optout:<tenant>:<user>`), не AdminSetting и не ENV. Доп. действий нет — Redis уже есть.
- **Шаг 8 — Backfill** — **обязательно** (ТЗ-D): `scripts/backfill-commitment-author.ts` — заполняет `IdeaBlock.commitmentAuthorPersonId` для истории обещаний (резолв автора через `EntityResolutionService.resolveSubjectPersonId`). Идемпотентен, зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: backfill`, `skipBootstrap: true`). Сначала dry-run, затем применение: `docker compose exec backend bun run scripts/backfill-commitment-author.ts --dry-run` → `… backfill-commitment-author.ts`. Через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (backend: `WeeklyPerPersonService`, `PeopleAtRiskService`, `SocialContributionPreferenceService`, self-режимы Pulse, новые эндпоинты; frontend: `CompassWidget`, виджеты план-факта/людей под риском, кабинет «Я» с вкладками): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - **Новые REST** (Swagger `/api/docs`): `GET /api/v1/dashboard/operations/weekly-per-person`, `GET /api/v1/dashboard/people-at-risk`, `PATCH /api/v1/me/promises/:blockId/reschedule`, `GET|POST /api/v1/me/social-contribution/opt-out` → 200 под нужной ролью.
  - **Компас (B):** `GET /api/v1/dashboard/pulse-patterns` отдаёт `goalVector` с `primaryGoalId` / `proScore` / `contraScore` / `byDepartment`; на главной директора виджет «Компас» (SVG) вместо списка целей.
  - **whoShined (C):** `GET /api/v1/dashboard/operations/daily-digest/latest` (ежедневный) содержит непустой `whoShined` (Recognition / HelpfulnessSpotlight / закрытые обещания по `commitmentAuthorPersonId`), когда есть данные.
  - **Атрибуция автора (D):** после прохода встречи у блоков-обещаний появляется `commitmentAuthorPersonId`: `docker compose exec backend bun -e "import {createPrismaClient} from './scripts/_lib/prisma'; const p=createPrismaClient(); p.ideaBlock.count({where:{commitmentAuthorPersonId:{not:null}}}).then(n=>{console.log('commitments with author:',n);return p.\$disconnect();});"` → > 0.
  - **Главная цель (B):** попытка пометить вторую цель как главную при уже существующей — конфликт `goal_primary_unique` (на Org остаётся ровно одна `isPrimary=true`).

---

### 🆕 2026-06-05 — Переход на миграции (АВТОМАТИЧЕСКИ при обычном выкате)

> Переход с `db push` на `prisma migrate deploy`. Прод сейчас в дрейфе (частично применённый Ф0 identity-фундамент: enum `ParticipantInvitationStatus` есть, колонки `Participant.{invitationStatus,inviteToken,invitedAt,deviceCount}` — нет → 500 на `POST /meetings` и на result-эндпоинте → плеер «бесконечно грузит»). Контракт: `plans/tz/2026-06-05-prisma-migrations-switch.md`.

**Ничего вручную делать не нужно — просто обычный выкат:**
```bash
cd /home/docker/z && git pull origin dev
docker compose build backend frontend
docker compose up -d
docker compose logs -f migrate     # увидишь блок ">>> [schema] АВТО-BASELINE ..."
```

`apply-prod-deploy.ts` → `ensureBaseline()` сам, ОДНОРАЗОВО, при первом запуске на существующей (db-push'нутой) БД без `_prisma_migrations`:
1. авто-бэкап (`pg_dump`),
2. `migrate resolve --applied 0_init` — помечает init применённым (SQL НЕ выполняется; БД уже имеет все таблицы из прошлого `db push` той же `schema.prisma`),
3. `migrate deploy` → применяет **`20260605075900_reconcile_participant_invitation_status`** — она **актуализирует БД до текущей схемы** (чинит `Participant.invitationStatus` + дотягивает Ф0-колонки; идемпотентна — на свежей БД no-op),
4. `apply-postgres-init` (идемпотентно держит GIN/HNSW/tsvector).

> **Актуализация прода — через миграцию, а не diff.** Схема Z разделена: `schema.prisma` + `postgres-init.sql` (GIN/HNSW/trgm-индексы, generated-колонки `*_search_tsv`, partial-индексы — Prisma их не выражает). `migrate diff --to-schema` не видит объекты postgres-init → сгенерил бы их `DROP` (false-positives, что и поймал первый подход). Поэтому реальный дрейф (только `Participant.invitationStatus`) выправляется явной идемпотентной миграцией `0001`, а не авто-диффом.

После первого успешного прогона `_prisma_migrations` есть, 0_init+0001 applied → каждый `up -d` просто докатывает новые миграции. Проверка: `docker compose run --rm --no-deps backend sh -c 'bunx prisma migrate status'` → «up to date».

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 💬 2026-06-05 — ChatBox-интеграция (клиентские переписки в память компании)

> Контракт: `plans/tz/2026-06-05-chatbox-integration.md`. Новый домен `backend/src/modules/chatbox/` — зеркалит чаты из внешнего ChatBox (`app.agent-lia.ru`). **За feature-flag тарифа `feature.chatbox` (дефолт OFF)** — до включения тарифа поведение прода не меняется. Профильная заметка — `second-brain/01_projects/chatbox-integration.md`.

- **Шаг 4 — Prisma (schema)** — **обязательно** (аддитивно, без data-loss): миграция **`20260605120000_chatbox_integration`** — 8 таблиц `Chatbox*` (`ChatboxIntegration/Channel/Customer/ChannelClient/Member/Chat/ChatSession/Message`) + 7 enum (`ChatboxSyncMode/IntegrationStatus/ChatStatus/SenderType/ContentType/SessionAnalysisStatus/MemberLinkMode`) + значение `SourceType.chatbox` + обратная связь `Org.chatboxIntegration`. Применяется **автоматически** через `prisma migrate deploy` (migrate-контейнер) на `docker compose up -d`. Вручную: `docker compose run --rm --no-deps backend sh -c 'bunx prisma migrate status'` → должна числиться applied.
- **Шаг 1 — ENV / AdminSetting**:
  - `CHATBOX_API_BASE_URL` — **опциональна**, дефолт `https://app.agent-lia.ru` (можно не задавать). Только через `TypedConfigService`.
  - ⚠️ realtime-webhook требует корректный **`PUBLIC_HOST_URL`** (внешний адрес backend) — он уже есть; webhook регистрируется как `${PUBLIC_HOST_URL}/api/v1/webhooks/chatbox/:tenantId/:secret`. Токен шифруется существующим `CRYPTO_MASTER_KEY`.
  - **Kill-switch** `AdminSetting chatbox.enabled` (дефолт **true**; `false` → синк-кроны и webhook молча no-op). Засеивается Шагом 7.
- **Шаг 7 — Seed** — `docker compose exec backend bun run scripts/seed-admin-setting-chatbox.ts` — идемпотентно: `chatbox.session.idle_gap_hours=12` (порог сегментации сессий) + `chatbox.enabled=true`. **Уже в агрегаторе** `apply-prod-deploy.ts` STEPS (phase `seed-base`): `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (новый backend-модуль `chatbox` + фронт-страницы `/chats*`): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - очереди BullMQ: `docker compose exec backend grep -rl "chatbox.sync\|chatbox.analyze" src/modules/chatbox/queue` → найдены обе очереди.
  - cron'ы: `docker compose exec backend grep -l "@Cron" src/modules/chatbox/chatbox-sync.cron.ts src/modules/chatbox/chatbox-analyze.cron.ts` (ChatboxSyncCron hourly/daily, ChatboxAnalyzeCron `*/5`).
  - inbound webhook: `docker compose exec backend grep -n "webhooks/chatbox/:tenantId/:secret" src/modules/chatbox/chatbox-webhook.controller.ts` (всегда 200, `timingSafeEqual`).
  - Swagger-тег `chatbox` виден в `/api/docs`; `POST /api/v1/chatbox/integration/workspaces` с валидным токеном → непустой список воркспейсов; после `POST .../sync {scope:'all'}` в БД ≥1 `ChatboxChat`/`ChatboxMessage`/`ChatboxChatSession`; одна сессия → `analysisStatus='done'` + `RawEvent(sourceType='chatbox')`.
  - privacy: под super_admin текст чужой переписки (`ChatboxMessage.text`) не читается.

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🆕 2026-06-05 — Колонка `dataClassAudit` в 4 проекции (миграция, АВТО при выкате)

> Контракт: `plans/tz/2026-06-05-dataclass-audit-schema-drift-fix.md`. Чинит schema drift: писатели specialist-3-1/3-6 кладут `dataClassAudit` в Regulation/Process/Policy/Idea, а колонки в схеме не было → ветка не компилировалась + snapshot-cron спамил 5 ERROR/30мин (`Unknown argument`).

- **Шаг 4 — Prisma миграция** — **обязательно, но автоматически** (аддитивно, без data-loss): новая миграция `20260605114300_add_dataclass_audit_to_projections` = 4× `ALTER TABLE {processes,regulations,policies,ideas} ADD COLUMN "dataClassAudit" JSONB`. Применяется штатным `prisma migrate deploy` в `migrate`-контейнере при обычном `docker compose up -d`. Отдельной ручной команды нет.
- **Шаг 11 — Docker rebuild** — обязателен (backend: правка `dataclass-audit-snapshot.cron.ts` — убран `skill_trait` + DMMF-гард): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke** (через ≥30 мин после выката): `bun run --env-file=… backend/scripts/diag.ts logs --level ERROR --from <дата>` → нет `Invalid prisma.{policy,process,regulation,idea,skillTrait}.count()`.
- **Бэкап** перед `migrate deploy` делается авто (`pg_dump` → z-backups).

Этот блок при следующем prod-cut перенести в «Архив применённых».

---

### 🧩 2026-06-04 — Единая видимая задача из встречи (ТЗ meeting-identity, Ф5.2)

> Контракт: `plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md` §5.2. Дедуп Task↔Issue: из встречи рождается ОДНА видимая задача (tracker `Issue`), а не дубль Task+Issue. **GATE-COUPLED, дефолт OFF** — до включения флага владельцем поведение прода не меняется.

- **Шаг 4 — Prisma db push** — **не требуется** (схема не менялась; читаем существующие `Issue.linkedMeetingIds`/`externalSource`).
- **Шаг 1 — ENV/AdminSetting** — новых ENV нет. Новый AdminSetting-флаг `knowledge.meetingTasksToTrackerOnly` (**default FALSE**, code-fallback FALSE через `TypedConfigService.getDynamic`). Менять в админке настроек под super_admin. При `true`: meeting-`Task` для action-items не создаётся (gate в `meeting-report-fast.worker`), 6 потребителей + фронт читают задачи встречи из `Issue` по `linkedMeetingIds`.
- **Шаг 7 — Seed admin-settings** — идемпотентно засеивает ключ `knowledge.meetingTasksToTrackerOnly` (FALSE): `docker compose exec backend bun run scripts/seed-admin-settings.ts` (или `apply-prod-deploy.ts --mode update`). Без сидера флаг работает на code-дефолте FALSE.
- **Шаг 11 — Docker rebuild** — обязателен (backend: новый `MeetingActionItemsService` + репойнт 6 потребителей; фронт НЕ менялся — форма ответа при OFF сохранена байт-в-байт): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke**:
  - регистрация флага: `docker compose exec backend grep -c "knowledge.meetingTasksToTrackerOnly" src/modules/admin/settings/admin-setting-schema-registry.ts scripts/seed-admin-settings.ts` → по 1 в каждом.
  - LLM-промпты не тронуты (prompt-cache): diff по `meeting-report-fast.prompt.ts` / `block-ingest.prompt.ts` пуст.
  - после включения флага в админке (`true`): новая встреча → таб «Задачи» карточки и `GET /api/v1/meetings/:id/tasks` отдают Issue-задачи; meeting-`Task` (action-items) не плодится.
- ⚠ **НЕ проверено без БД (dev):** Issue-ветка (флаг ON) — дормант, верифицирована только unit-мок-тестами (маппинг Issue→форма Task + контракт public API при ON). Боевая проверка ON-режима — после включения флага владельцем на проде. При OFF поведение всех потребителей идентично прежнему (читают Task) — это гарантия безопасности дефолта.
- ℹ Это запись по Ф5.2 (дедуп задач). **Identity-фундамент + приглашения + subject-атрибуция (Ф0–Ф5)** того же ТЗ — отдельной записью ниже (schema-push, новый kill-switch, backfill, шаблон письма).

---

### 🎙️ 2026-06-05 — Meeting-identity: identity участника + приглашение сотрудников + subject-атрибуция (Ф0–Ф5)

> Контракт: `plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md` (Фазы 0–5). Связывает `Participant` с `User`/`Person`, приглашает сотрудников из списка (email/Telegram), оживляет клонов через `IdeaBlockEntity.role='subject'`. Коммиты: Ф0 `158a33d8`, Ф1 `b4ac1ebd`, Ф2 `b2fde6c9`, Ф3 `b5a07ebe`, Ф4 `d0609a90`, Ф5.1 `779b4811`.

- **Шаг 4 — Prisma db push** — **обязательно** (Ф0, аддитивно, без data-loss, без `--accept-data-loss`): `Participant` += `personId String?` / `inviteToken String? @unique` / `invitationStatus ParticipantInvitationStatus @default(none)` / `invitedAt DateTime?` + relations `user`(ParticipantUser)/`person`(ParticipantPerson) + back-relations `User.participantsAsUser[]` / `Person.participantsAsPerson[]`; новый enum `ParticipantInvitationStatus { none invited joined }`. Команда: `docker compose exec backend bun run prisma:push` (через `migrate`-контейнер автоматически).
- **Шаг 1 — ENV/AdminSetting** — новых ENV нет. **Два AdminSetting kill-switch** (оба code-fallback в `TypedConfigService`, засеиваются Шагом 7):
  - `knowledge.subjectAttributionEnabled` — **default TRUE** (Ф1: шаг `attributeSubject` в `block-ingest` пишет `role:'subject'`). `false` = откат к старому (только `mentioned`).
  - `knowledge.meetingTasksToTrackerOnly` — **default FALSE** (Ф5.2, см. запись выше) — поэтапная раскатка.
- **Шаг 7 — Seed**:
  - admin-settings (новые ключи `knowledge.subjectAttributionEnabled`=true, `knowledge.meetingTasksToTrackerOnly`=false): `docker compose exec backend bun run scripts/seed-admin-settings.ts` (или `apply-prod-deploy.ts --mode update`). Без сидера работают code-дефолты.
  - **email-шаблон `meeting-invite`** — **спец-сида не нужно.** `MEETING_INVITE_TEMPLATE` лежит в `STATIC_TEMPLATES` (`email-templates-admin.service.ts`) и **bootstrap-sync'ается автоматически** в таблицу `EmailTemplate` при первом GET `/admin/content/email-templates` (когда `count===0`); код остаётся fallback'ом. Дальше редактируется из админки писем.
- **Шаг 8 — Backfill** — `scripts/backfill-subject-attribution.ts` — идемпотентный upsert `IdeaBlockEntity{role:'subject'}` для reasoning-блоков + ре-enqueue `core.skill-profile-rebuild`. Сначала dry-run, затем применение: `docker compose exec backend bun run scripts/backfill-subject-attribution.ts --dry-run` → `… backfill-subject-attribution.ts`. Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: backfill`), идёт и через агрегатор `apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (backend: identity-связи, `deliverMeetingInvites`, `mail.sendMeetingInvite`, conversational `meeting.invite`, subject-атрибуция; frontend: блок «Пригласить сотрудников» в форме создания встречи + вход `/m/[id]?inv=<token>`): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - Swagger `/api/docs` → POST создания встречи принимает `invitees[]` в теле.
  - `eventType 'meeting.invite'` зарегистрирован: `docker compose exec backend grep -R "meeting.invite" src/modules/conversational/types` (registry + `EVENT_TYPE_CHANNEL_POLICY`).
  - `GET /api/v1/meetings/:id/tasks` при **дефолтном** флаге (`knowledge.meetingTasksToTrackerOnly=false`) — форма ответа не изменилась.
  - subject-атрибуция работает: после прохода встречи у reasoning-блоков сотрудника-спикера появляются `IdeaBlockEntity{role:'subject'}` (`docker compose exec backend bun -e "import {createPrismaClient} from './scripts/_lib/prisma'; const p=createPrismaClient(); p.ideaBlockEntity.count({where:{role:'subject'}}).then(n=>{console.log('subject links:',n);return p.\$disconnect();});"`) → > 0.

---

### 🔓 2026-06-04 — Разблокировка конвейера встреча→граф→задачи (МТЗ №1, Ф1–Ф11)

> Ветка `feature/pipeline-unblock`. Контракт: `plans/tz/2026-06-04-razblokirovka-konveyera.md`. Чинит критпуть B1–B7 + развязку видео от AI-статуса.

- **Шаг 4 — Prisma db push** — **обязательно** (4 аддитивных изменения, без data-loss, без `--accept-data-loss`):
  - `AudioTrack.voxTaskId String?` (Ф1); `TranscriptTrack @@unique([transcriptId, livekitIdentity])` (Ф1); `Insight.dataClassAudit Json?` + `Decision.dataClassAudit Json?` (Ф8); `MeetingStatus += ai_failed` (Ф11).
  - ⚠ ПЕРЕД push проверить отсутствие дублей под новый unique: `SELECT "transcriptId","livekitIdentity",count(*) FROM "TranscriptTrack" GROUP BY 1,2 HAVING count(*)>1;` (ожидается пусто).
  - Команда: `docker compose exec backend bun run prisma:push` (через migrate-контейнер автоматически).
- **Шаг 5 — postgres-init / AGE** — **обязательно** (Ф5): закрепить `ag_catalog` в search_path роли приложения для рантайм-пула. Идемпотентный прогон: `docker compose exec backend bun run apply-postgres-init` (содержит `ALTER ROLE CURRENT_USER SET search_path = ag_catalog, "$user", public;`).
  - Проверка: `SELECT extname FROM pg_extension WHERE extname='age';` · `SELECT name FROM ag_catalog.ag_graph WHERE name='z_graph';` · smoke под ролью app: `SELECT * FROM cypher('z_graph', $$ RETURN 1 $$) AS (v agtype);`. На managed PG нужен `shared_preload_libraries='age'` + рестарт.
- **Шаг 1 — ENV** — все **опциональные** (есть код-дефолты):
  - `VOX_POLL_INTERVAL_MS=5000`, `VOX_POLL_MAX_ATTEMPTS=180` (Ф1 — бюджет опроса Vox 900с, критично для длинных встреч).
  - `GRAPH_AGE_ENABLED=true` (Ф5 — kill-switch графа; false = только Postgres).
  - ⚠ ПОНИЖЕНЫ ДЕФОЛТЫ (Ф6): `LINKER_MIN_BLOCKS` 50→3, `THEME_CLUSTERING_MIN_BLOCKS` 100→10, `ENTITY_GRAPH_MIN_COMENTIONS` 3→2, `LINK_MIN_CONFIDENCE` 0.75→0.5. Если эти ENV выставлены в проде руками со старыми значениями — снять/понизить, иначе граф на малом тенанте не строится. Предпочтительно крутить через AdminSetting (`knowledge.*`).
- **Шаг 7 — Seed admin-settings** — идемпотентно: `graph.ageEnabled`=true (Ф5), пороги `knowledge.*` (Ф6). `docker compose exec backend bun run scripts/seed-admin-settings.ts` (или `apply-prod-deploy.ts --mode update`). Защищает admin-edited значения.
- **Шаг 8 — Backfill** — **обязательно** (Ф9): Person для владельцев Org без Person. `docker compose exec backend bun run scripts/backfill-owner-person.ts --apply` (зарегистрирован в `apply-prod-deploy.ts` STEPS, phase `backfill`, `skipBootstrap`; без `--apply` — dry-run). Идемпотентно.
- **Шаг 11 — Docker rebuild** — обязателен (backend + frontend): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - один Worker на очереди specialist-routing (Ф2): `docker compose exec backend grep -rzoP "new Worker\(\s*CORE_QUEUE_NAMES\.SPECIALIST_ROUTING" src | grep -c Worker` → 1 (**multiline** grep — имя очереди на соседней строке).
  - новый cron (Ф7): `docker compose logs backend | grep -iE "meeting-reingest|MeetingReingestCron"`.
  - новые метрики на `/metrics`: `core_specialist_skipped_total` (Ф3), `kc_typed_entity_failed_total` (Ф5), `meeting_ingest_failed_total` (Ф7).
  - **боевой тест на проде** через `diag` (после выката): прогнать новую встречу → `bun run --env-file=.env scripts/diag.ts trace --meeting <id>` — дошла ли до `ai_ready`, есть ли отчёт, наполнился ли граф (раньше падала на Vox-таймауте → `failed`).
- ⚠ **НЕ проверено в dev** (Docker Desktop не стартовал в сессии разработки): интеграц-тесты против реального Postgres (Ф4/Ф8 «tsc-слепой» класс, Ф9 backfill), боевой харнесс `smoke-pipeline-e2e.ts`, реальный AGE-резолв `cypher()`, рантайм-DI диспетчера 14 хендлеров. Всё покрыто typecheck/lint/build/unit; первый прод-прогон = боевая проверка. Прогнать `bun run test:integration` на CI/проде с поднятым Postgres.

---

### 🔔 2026-06-03 — Action Center Часть B: центр подтверждений (`/actions` + колокольчик + напоминания)

План: [plans/tz/2026-06-02-action-center-pending-confirmations.md](../../plans/tz/2026-06-02-action-center-pending-confirmations.md) (Часть B). Модуль `backend/src/modules/pending-actions/`.

**Что выкатывается:**
- B0 — новый модуль `pending-actions` (агрегатор + 4 read-провайдера) + REST `/api/v1/pending-actions/{count,,snooze,confirm}` + модель `PendingActionSnooze`.
- B1 — фронт: страница `/actions`, глобальный колокольчик `PendingActionsBell`, пункт сайдбара «Подтверждения», хуки `usePendingActionsCount`/`usePendingActions`.
- B2 — блок `requiresAction` в `DirectorDashboardDto` (`RequiresActionTile` на главной + `RequiresActionBanner` на «Панели операций»).
- B3 — `PendingActionsReminderCron` (Telegram-напоминания, eventType `actions.reminder`) + строка «Ждёт подтверждения: N» в ежедневном дайджесте.
- B4 — one-tap `POST /api/v1/pending-actions/confirm` (light curation approve). Telegram оставлен zero-button (β-1) намеренно.
- B5 — `CurationItemLifecycleCron` (expiry `CurationItem.expiresAt`).

- **Шаг 4 — Prisma** — **обязательно** (новая модель `PendingActionSnooze`; безопасно — только новая таблица, без data-loss): `docker compose exec backend bun run prisma:push`. Применяется автоматически через `migrate`-контейнер.
- **Шаг 1 — ENV** — **не требуется** (новых ENV/feature-flag нет). ⚠️ Окна напоминаний и `LEAD_DAYS` переведены в AdminSetting в фазе **C2** — см. запись «Action Center остаток (C1–C3)» ниже (Шаг 7 seed).
- **Шаг 7 — Seed** — **не требуется** (напоминания — детерминированный шаблон без LLM, новых LLM-маршрутов нет).
- **Шаг 11 — Docker rebuild** — обязателен (новый модуль `pending-actions` + 2 крона + фронт `/actions`/колокольчик/сайдбар): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - новый REST: `curl -i -H 'Cookie:<owner_session>' -H 'X-Org-Id:<orgId>' https://prod.host/api/v1/pending-actions/count` → 200 `{total, bySource}`; список `GET /api/v1/pending-actions` → urgent-first; `POST /api/v1/pending-actions/confirm` подтверждает light curation.
  - новые кроны зарегистрированы: `docker compose logs backend | grep -E 'PendingActionsReminderCron|CurationItemLifecycleCron'`.
  - новый eventType: `docker compose exec backend grep -R "actions.reminder" src/modules/conversational/types` (registry + `EVENT_TYPE_CHANNEL_POLICY`).
  - фронт: на `/actions` список висящих подтверждений; колокольчик в top-bar с живым бейджом; пункт сайдбара «Подтверждения».

---

### 👥 2026-06-04 — Команда + персональные доступы сотрудников (Фазы 0–5)

План: [plans/tz/2026-06-03-team-section-and-employee-access.md](../../plans/tz/2026-06-03-team-section-and-employee-access.md). Модули `orgs`/`persons`/`users` (backend) + `structure`/`settings` (frontend).

**Что выкатывается:**
- Раздел «Команда» (`/structure`) — объединённый ростер `GET /api/v1/orgs/:id/team-roster`, управление участниками/приглашениями (переехало из `/settings/organization`), карточка сотрудника `/structure/persons/[id]` (Профиль/Доступы).
- Новая таблица `EmployeeCapabilityOverride` (персональные override доступа `allow`/`deny` поверх дефолта роли/тарифа) + `CapabilitiesService` (модуль `orgs`).
- Эндпоинты (owner/admin): `GET/PUT/DELETE /api/v1/orgs/:id/members/:userId/capabilities[/:capability]` + `GET /api/v1/orgs/:id/effective-access`. `POST /persons` принимает `linkUserId`; приглашение — по `personId`.

- **Шаг 4 — Prisma** — **обязательно** (Фаза 5: новая таблица `EmployeeCapabilityOverride` — безопасное добавление таблицы, без потери данных, **не** migrate): `docker compose exec backend bun run prisma:push`. Применяется автоматически через `migrate`-контейнер.
- **Шаг 1 — ENV** — новых ENV нет.
- **Seed/Patch/Backfill/Migrate** — нет. Агрегатор `apply-prod-deploy.ts` STEPS — без изменений (новых скриптов нет).
- **Шаг 11 — Docker rebuild** — обязателен (backend: `CapabilitiesService` + team-roster + `POST /persons` linkUserId; frontend: раздел «Команда», карточка сотрудника, диалоги `src/ui/components/team/`): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - ростер: `curl -i -H 'Cookie:<owner_session>' -H 'X-Org-Id:<orgId>' https://prod.host/api/v1/orgs/<orgId>/team-roster` → 200, список Person ⊕ участники без карточки.
  - capabilities: `GET .../orgs/<orgId>/members/<userId>/capabilities` → 200; `PUT .../capabilities/feature:graph` body `{ "effect": "deny" }` → 200; `GET .../orgs/<orgId>/effective-access` → 200 (эффективный доступ с учётом override); `DELETE .../capabilities/feature:graph` → 200 (вернулся дефолт роли/тарифа).
  - UI: в Sidebar пункт «Команда» (группа «Каждый день»), вкладка «Сотрудники» открывается первой; `/structure/persons/[id]` → вкладка «Доступы» переключает override; `/settings/organization` показывает только «Информацию».

---

### 🎥 2026-06-03 — Надёжность записи v2: per-track дорожки (reconcile) + фильтр участников по kind + faststart видео

План: [plans/tz/2026-06-03-meeting-recording-reliability.md](../../plans/tz/2026-06-03-meeting-recording-reliability.md). Поверх PR #17. **Схема БД НЕ меняется, скриптов нет.**

**Что выкатывается:**
- Фаза 1 (P0) — надёжные per-track аудиодорожки: догон на старте записи + cron `recording-track-reconcile` (`*/1`) + in-process lock идемпотентности + метрика `recording_track_egress_failed_total`.
- Фаза 2 (P1) — `participant_joined` фильтрует по `ParticipantKind` (создаёт только `STANDARD`; egress/agent/sip — no-op), fallback на префикс `host:`/`guest:` если kind отсутствует.
- Фаза 3 (P1) — `FaststartWorker` (очередь `recording.faststart`): `ffmpeg -movflags +faststart` для composite, **за флагом, дефолт OFF**.

- **Шаг 4 — Prisma** — **не требуется** (схема не менялась).
- **Шаг 1 — ENV** — **3 новых опциональных** (есть код-дефолты, можно не выставлять):
  - `RECORDING_TRACK_RECONCILE_ENABLED` — kill-switch сверки дорожек. **Дефолт `true`** (P0-фикс активен сразу). `false` — только если сверка создаёт проблемы.
  - `RECORDING_FASTSTART_ENABLED` — **дефолт `true`** (faststart включён сразу; операция идемпотентна и безопасна — `-c copy`, перезалив после `exit 0`). Kill-switch: `false`.
  - `RECORDING_FASTSTART_MIN_BYTES` — **дефолт `52428800` (50 МиБ)**. Composite меньше порога не ремуксится (мелкий файл и так играет сразу). Поднять/опустить по вкусу.
- **Шаг 11 — Docker rebuild** — **обязателен с пересборкой образа** (правки backend + **новый бинарь `ffmpeg` в Dockerfile**): `docker compose up -d --build backend`. ⚠ Образ должен пересобраться (не только рестарт) — иначе `recording.faststart` и `clip.render` упадут с `ENOENT ffmpeg`. Проверка: `docker compose exec backend ffmpeg -version` → версия печатается.
- **Шаг 12 — Smoke**:
  - cron сверки зарегистрирован: `docker compose logs backend | grep -E 'RecordingTrackReconcileCron|recording-track-reconcile'`.
  - очередь faststart инициализирована: `docker compose logs backend | grep -E 'FaststartWorker запущен|recording.faststart'`.
  - **дорожки (главное):** провести тест-встречу 3 говоривших + умышленный reconnect одного → в результате встречи 3 полные аудиодорожки (не 2), транскрипт со всеми тремя.
  - участники: в отчёте «Участники» только реальные люди (без egress-фантомов), даже под записью.
  - **faststart (работает сразу, проверка эффекта):** после записи встречи (>50 МБ composite) в логах `docker compose logs backend | grep 'faststart: composite переупакован'` → есть запись; видео на странице результата стартует за пару секунд, без «вечной крутилки». Опц. убедиться `ffprobe -v trace https://<presigned> 2>&1 | grep -E 'moov|mdat'` → `moov` ПЕРЕД `mdat`. Если нужно выключить — `RECORDING_FASTSTART_ENABLED=false`.

---

### 🧹 2026-06-03 — Фикс egress-фантомов + Content-Type видео + списание MeetingsBalance

Багфикс по итогам тестовой конференции (без изменения схемы БД).

**Что выкатывается:**
- `webhooks/livekit-events.handler.ts` — `participant_joined` игнорирует identity не `host:`/`guest:` (egress-рекордеры больше не плодят фантомных гостей «Participant»).
- `recordings/s3.service.ts` + `recordings.service.ts` — presign композита форсит `ResponseContentType=video/mp4` + `inline` (S3 отдавал mp4 как `octet-stream`, видео не игралось в плеере).
- `meetings-balance/meetings-balance.service.ts` — `consume` переведён с битого `$executeRaw UPDATE meetings_balance` (таблица не существовала — `relation does not exist`, баланс не списывался) на типизированный `prisma.meetingsBalance.updateMany`. **Без миграции схемы.**

- **Шаг 4 — Prisma** — **не требуется** (схема не менялась).
- **Шаг 1 — ENV** — новых ENV нет.
- **Шаг 6 — Patch** — 1 новый, идемпотентный, зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: 'patch'`, `skipBootstrap: true`): `scripts/patch-cleanup-egress-phantom-participants.ts` — удаляет уже накопленных фантомных Participant'ов (identity не `host:`/`guest:`) + их `MeetingParticipantBehavior`. Прогон: сначала `--dry-run`, затем без флага, либо через агрегатор `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (правки backend): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke**:
  - провести тест-встречу хост+гость → в отчёте «Участники» ровно 2 строки, `participantsCount=2` в behavior-metrics (без «Participant»-фантомов).
  - на странице результата видео проигрывается в плеере; запрос к `composite.mp4` в Network отдаёт `Content-Type: video/mp4`.
  - создание встречи залогиненным юзером с балансом списывает 1 встречу: `docker compose exec backend bun -e "import {createPrismaClient} from './scripts/_lib/prisma'; const p=createPrismaClient(); p.meetingsBalance.findMany({take:3,orderBy:{updatedAt:'desc'}}).then(r=>{console.log(r);return p.\$disconnect();});"` — `totalConsumed` растёт, ошибки `relation \"meetings_balance\" does not exist` пропали из логов.

---

### 🪵 2026-06-03 — Логирование: процессные контуры (pipeline) + сквозной traceId + мост Nest Logger → БД

План: [plans/tz/2026-06-03-logging-pipelines-coverage.md](../../plans/tz/2026-06-03-logging-pipelines-coverage.md). Модуль `backend/src/modules/logging`.

**Что выкатывается:**
- Новый enum `SystemLogPipeline` + поле `SystemLog.pipeline?` + 2 индекса (`[pipeline, createdAt]`, `[traceId, createdAt]`).
- Мост `DbLoggerBridge` (`app.useLogger` в `main.ts`): все `this.logger.*` по бэкенду/воркерам дублируются в `SystemLog`.
- HTTP-логирование (REQUEST) **отключено** — `RequestLoggingInterceptor` снят из `LoggingModule` (ошибки запросов пишет `AllExceptionsFilter`).
- Инструментованы 48 воркеров + livekit-вебхуки (`pipeline`/`traceId`); админка — фильтр контура, вид «Цепочка» (`GET /platform/logs/chain?traceId=`), русские лейблы enum'ов.
- **Live-стрим по WebSocket** `LogStreamGateway` (Socket.IO namespace `/ws/platform-logs`, только super_admin) — заменяет поллинг в `/admin/logs` (тумблер «● Live»). Схему БД не меняет.

- **Шаг 4 — Prisma** — **обязательно** (аддитивно, без data-loss: nullable-поле `pipeline` + новый enum + 2 индекса): `docker compose exec backend bun run prisma:push`. Применяется автоматически через `migrate`-контейнер.
- **Шаг 1 — ENV** — новых ENV нет (все `LOG_DB_*` уже существуют и опциональны). После выката HTTP-логи перестанут писаться — это ожидаемо (D3).
- **Шаг 11 — Docker rebuild** — обязателен (правки `main.ts` + воркеров + фронт `/admin/logs`): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - мост работает: `docker compose exec backend bun -e "import {createPrismaClient} from './scripts/_lib/prisma'; const p=createPrismaClient(); p.systemLog.count({where:{pipeline:{not:null}}}).then(n=>{console.log('logs with pipeline:',n);return p.\$disconnect();});"` — после прохода встречи > 0.
  - вид «Цепочка»: `/admin/logs` (super_admin) → у записи встречи кликнуть `traceId` (`mtg_<id>`) → Drawer «Цепочка» показывает webhook → транскрипцию → AI → KC одной лентой.
  - REQUEST-логов больше нет: фильтр «Категория = REQUEST» за свежий период пуст.
  - WS live: на `/admin/logs` включить «● Live» → индикатор зелёный (`connected`), новые логи появляются сверху без обновления страницы. За nginx убедиться, что `/ws/platform-logs` проксируется с `Upgrade`/`Connection` заголовками (как для существующих `/ws/*`).

---

### 🪜 2026-06-03 — Action Center Часть A: Лестница доверия (пер-типовые пороги + AI-судья + autotune)

План: [plans/tz/2026-06-02-action-center-pending-confirmations.md](../../plans/tz/2026-06-02-action-center-pending-confirmations.md) (Часть A). Модуль `backend/src/modules/curation`.

**Что выкатывается:**
- A0 — триаж курации сравнивает калиброванную уверенность с пер-типовыми порогами `autoThresholdByType`/`deepReviewThresholdByType` (`Org.curationSettings`, fallback на глобальные); read-model `getOverrideStats` + `GET /api/v1/curation/override-stats` (owner/admin).
- A1 — `CardVersion.trustTier` (enum `TrustTier {auto|provisional|human}`); критические типы (`regulation`/`process`/`decision`) в провизорной полосе проходят AI-судью `curation-verify` (3 голоса) → провизорная канонизация без человека либо deep review. Аудит-выборка 5%. Новые taskType `debate-curation-verify-*`.
- A2 — `CurationAutotuneCron` (`@Cron('0 3 * * *')`): kill-switch (всегда активен) + автоподстройка порогов (opt-in `autotuneEnabled`).

- **Шаг 4 — Prisma** — **обязательно** (новый enum `TrustTier` + поле `CardVersion.trustTier @default(human)` + `@@index([tenantId, trustTier])`; безопасно — defaulted, без data-loss): `docker compose exec backend bun run prisma:push`. Применяется автоматически через `migrate`-контейнер (`prisma db push --accept-data-loss`).
- **Шаг 7 — Seed** — маршруты AI-судьи (идемпотентно, уже в агрегаторе `apply-prod-deploy.ts`, phase `seed-llm-routes`): `docker compose exec backend bun run scripts/seed-llm-task-routes-curation.ts` (cheap-цепочка `deepseek-v4-flash`→`gpt-5.4-mini`→`qwen3.5:9b`, без anthropic). Через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`. Опционально — без сидера работает code-fallback chain.
- **Шаг 11 — Docker rebuild** — обязателен (новый cron + curation-сервисы): `docker compose up -d --build backend`.
- **Шаг 12 — Smoke**:
  - новый REST: `curl -i -H 'Cookie:<owner_session>' -H 'X-Org-Id:<orgId>' https://prod.host/api/v1/curation/override-stats` → 200 (доля override per resourceType).
  - новый cron зарегистрирован: `docker compose logs backend | grep -E 'CurationAutotuneCron'`.
  - новые LLM taskType: `docker compose exec backend bun -e "import {createPrismaClient} from './scripts/_lib/prisma'; const p=createPrismaClient(); p.llmTaskRoute.count({where:{taskType:{startsWith:'debate-curation-verify-'}}}).then(n=>{console.log('curation-verify routes:',n);return p.\$disconnect();});"`.
- **Заметка (долг):** опц. будущий backfill `CardVersion.trustTier` (existing → `auto` при `createdByUserId IS NULL`) — пока отложен, дефолт `human` безопасен.
### 🎯 2026-06-02 — Goals OKR v2 (Граф целей): специалист 3-14 + авто-прогресс + пульс + дерево

**Контекст.** Достройка модуля `goals` до «графа целей» (Цель → измеримые Key Results): авто-добыча из встреч (специалист `3-14-goals`), авто-прогресс KR (cron), еженедельный пульс (cron + доставка), дерево + мост к гипотезам. Принцип M0 — ручной контроль первичен, авто не перетирает `manualOverride`-поля. Изменения схемы **аддитивны** (только новые модели/поля/enum/FK). ТЗ — `plans/tz/2026-06-02-goals-okr-v2.md`.

- **Шаг 1 — ENV/AdminSetting** — **новых ENV нет.** Два тумблера через `AdminSetting` (не ENV, memory `feedback_admin_settings_not_env_or_code`), засеиваются сидером (Шаг 7): `goals.pulse.enabled` (default **true**) и `goals.pulse.deliver_to_telegram` (default **false**). Менять в админке настроек под super_admin.
- **Шаг 4 — Prisma** — **обязательно** (аддитивно, опасных изменений нет): `docker compose exec backend bun run prisma:push`.
  Новые модели `GoalKeyResult` / `GoalKeyResultCheckpoint` / `WeeklyGoalsPulseDigest`; поля в `Goal` (source/promotionState/progressStatus/sourceBlockIds/confidence/manualOverride/validFrom/validUntil/recordedAt/supersededById + relations); FK `Idea.goalId` / `Cycle.primaryGoalId`; 4 новых enum'а (`GoalSource`/`GoalPromotionState`/`GoalProgressStatus`/`GoalKrSourceKind`). Существующие `GoalStatus`/`GoalHorizon` НЕ менялись.
  Примечание: на dev `prisma:push` потребовал `--accept-data-loss` из-за уже-смерженного Smart-tables (`Table[tenantId, systemKey]`), **НЕ из-за goals** (goals полностью additive). На проде оценить необходимость флага отдельно — если в наличии только goals-изменения, `--accept-data-loss` не нужен.
- **Шаг 5 — postgres-init.sql — GIN-индекс** — новый: `Goal_sourceBlockIds_gin ON "Goal" USING GIN ("sourceBlockIds")` (поиск целей по блокам-источникам). Применяется: `docker compose exec backend bun run apply-postgres-init` (идемпотентно, `CREATE INDEX IF NOT EXISTS`).
- **Шаг 7 — Seed** — два сидера (оба идемпотентны, **оба уже в агрегаторе** `apply-prod-deploy.ts` STEPS):
  - `scripts/seed-llm-task-routes-goals.ts` — LLM-маршруты `goal-extract` (capable: DeepSeek V4 Pro→gpt-5.4-mini→qwen3.5:9b), `goal-hierarchy-link` (cheap: DeepSeek V4 Flash→…), `goals-pulse-summarize` (как operations-daily-digest). Без `anthropic`.
  - `scripts/seed-admin-setting-goals-pulse.ts` — тумблеры `goals.pulse.enabled=true` / `goals.pulse.deliver_to_telegram=false`.
  - Одной командой: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 8 — Backfill** — `scripts/backfill-goal-v2-defaults.ts` — legacy-целям проставляет `recordedAt=createdAt` + дефолты `source='manual'`/`promotionState='active'`/`progressStatus='on_track'` (идемпотентно). В агрегаторе STEPS (`phase: backfill`). Через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (новый специалист/воркер + 2 cron'а + сервисы goals + frontend дерево/пульс/диалоги): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - **Новый consumer** `3-14-goals` на очереди `core.specialist-routing` — виден в `/admin/platform/workers`. На тестовом блоке-обещании («провести 100 встреч за квартал») создаётся `suggested`-цель горизонта quarterly с провенансом; повтор не плодит дубль (KNN-dedup).
  - **Cron'ы** `goal-kr-progress` (05:00 UTC, ежедн.) и `goals-pulse` (пн 06:00 UTC = 09:00 МСК) — видны в `/admin/crons`. Ручной прогон `goal-kr-progress` → KR с `sourceKind='meeting_count'` показывает текущее число встреч + пишет checkpoint; ручной KR (`manual`) не перетирается.
  - **eventType `goals.pulse`** присутствует в `EVENT_TYPE_CHANNEL_POLICY` (при включённом `deliver_to_telegram` пульс уходит owner/coo).
  - **Метрики**: `curl -s localhost:3000/metrics | grep -E 'goal_kr_autoprogress_total|goals_pulse_(generated|failed|delivered)_total'`.
  - **Новые REST** (Swagger `/api/docs`): `/goals/:id/key-results*`, `/goals/:id/supersede`, `PATCH /goals/:id` (parentGoalId/progressStatus/promotionState), `/ideas/:id/goal`, `PATCH /cycles/:id` (primaryGoalId). Дашборд `GET /dashboard/director` отдаёт `goalsTree`/`goalsPulse`.
  - **UI**: `/goals` — переключатель «Список / Дерево», секция «Ключевые результаты» с прогресс-барами; на дашборде CEO — виджет «Пульс целей» + дерево.

---

### 🏷️ 2026-06-04 — Action Center остаток (C1 метка доверия · C2 крутилки AdminSetting · C3 detail-страницы курации)

План: [plans/tz/2026-06-03-action-center-remaining.md](../../plans/tz/2026-06-03-action-center-remaining.md). Достройка поверх Частей A/B (выше). Ветка `feature/action-center-trust-ladder`.

**Что выкатывается:**
- C1 — `trustTier` (из `CardVersion.currentVersion`) пробрасывается в read-DTO регуляций/решений/процессов/политик + provenance документа; фронт-плашка `TrustBadge` («Не проверено человеком» для provisional). Починен pre-existing баг вкладки «Извлечённые сущности» документа (контракт `entityGroups` vs `extractedEntities`).
- C2 — 14 платформенных дефолтов курации/напоминаний переведены из code-констант в AdminSetting (`resolveSync`, code-fallback): 9 `knowledge.curation*` (provisional/aiVerifier/auditSampleRate/autotune*/threshold*/maxProvisionalOverride) + 5 `pendingActions.*` (reminderWindow/Step/urgentAgeDays/reminderLeadDays). per-Org `curationSettings` не тронут. `urgentAgeDays` применён во всех 3 провайдерах (curation/conflict/intake).
- C3 — фронт detail-страницы `/curation/[id]` (решение куратора) + `/curation/conflicts` (список) + `/curation/conflicts/[id]` (резолюция/dismiss); `actionUrl` провайдеров теперь deep-link на конкретную карточку/конфликт.

- **Шаг 1 — ENV** — **не требуется** (C2 — admin-only ключи, новых ENV нет; код-дефолты сохранены как fallback).
- **Шаг 4 — Prisma** — **не требуется отдельно** (`CardVersion.trustTier`/`PendingActionSnooge` уже в записях Частей A/B выше; этот push покрывает и C-фазы).
- **Шаг 7 — Seed AdminSetting (C2)** — 14 ключей через существующий `seed-admin-settings.ts` (идемпотентно, уже в `apply-prod-deploy.ts` STEPS, phase `seed-base`): `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update` (или точечно `bun run scripts/seed-admin-settings.ts`). Без сидера крутилки работают на code-дефолтах, но не редактируются из админки.
- **Шаг 11 — Docker rebuild** — обязателен (backend: проброс trustTier, cfg-геттеры, провайдеры; frontend: TrustBadge, detail-страницы курации): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - метка доверия: открыть провизорную карточку в `/regulations`/`/decisions` → плашка «Не проверено человеком»; человеческая — без плашки.
  - крутилки: в админке super_admin изменить `knowledge.curationProvisionalThresholdDefault` или `pendingActions.urgentAgeDays` → значение применяется без релиза (history в `AdminSettingHistory`). Проверить наличие 14 ключей: `docker compose exec backend bun -e "import {createPrismaClient} from './scripts/_lib/prisma'; const p=createPrismaClient(); p.adminSetting.count({where:{OR:[{key:{startsWith:'knowledge.curation'}},{key:{startsWith:'pendingActions.'}}]}}).then(n=>{console.log('knobs:',n);return p.\$disconnect();});"`.
  - detail-страницы: «Открыть» из колокольчика/`/actions` для curation-item ведёт на `/curation/<id>` (не 404), для конфликта — на `/curation/conflicts/<id>`; решение/резолюция убирают элемент из очереди.

---

### ✍️ 2026-06-04 — Поправить карточку: исправить/оспорить провизорную (E1 backend + E2 frontend)

План: [plans/tz/2026-06-03-knowledge-card-correct.md](../../plans/tz/2026-06-03-knowledge-card-correct.md). Достройка поверх C1 (метка доверия). Ветка `feature/action-center-trust-ladder`.

**Что выкатывается:**
- E1 — новые REST на существующих модулях: `POST /api/v1/regulations/:id/{dispute,correct}` и `POST /api/v1/decisions/:id/{dispute,correct}`. `correct` от owner/admin применяет правку сразу (новая `CardVersion` `trustTier='human'` + `currentVersionId` + контент таблицы); от рядового — предложение в очередь курации (`CurationService.submitProposal` → `CurationItem(pending, via='user_correction')`). `dispute` → `recordDecision('mark_as_misleading')`. Обучающие сигналы: correct→`correct`, dispute→`misleading`.
- E2 — фронт `CardCorrectionActions` (кнопки «Исправить»/«Это неверно» на детали `/regulations` и `/decisions`).

- **Шаг 1 — ENV** — **не требуется** (новых ENV/флагов нет).
- **Шаг 4 — Prisma** — **не требуется** (всё на существующих `CurationItem`/`CardVersion`/канонических таблицах; схема не менялась).
- **Шаг 7 — Seed** — **не требуется** (новых LLM-маршрутов нет; `mark_as_misleading`/`approve_with_edits` уже маппятся в `PreferenceDatasetService`).
- **Шаг 11 — Docker rebuild** — обязателен (backend: regulations/decisions сервисы+контроллеры, curation.submitProposal; frontend: CardCorrectionActions): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - новые REST (Swagger `/api/docs` → теги `regulations`/`decisions` показывают `:id/dispute` и `:id/correct`). От owner: `correct` на провизорной карточке → `{ok:true,applied:true}`, плашка «Не проверено человеком» снимается, в `/regulations|decisions/:id/history` новая версия `changeReason='user_correction'`.
  - от пользователя без write-права: `correct` → `{ok:true,applied:false}`, карточка не изменилась, в очереди курации появился `CurationItem(pending)` с `via='user_correction'`.
  - `dispute` → `{ok:true}` + запись `LlmPreferenceSample(label='misleading')` по карточке.
- **Заметка (долг, ждёт go):** одобрение куратором *предложения рядового сотрудника* пока НЕ переносит правку в каноническую таблицу — суб-ТЗ [plans/tz/2026-06-04-curation-canonical-writeback.md](../../plans/tz/2026-06-04-curation-canonical-writeback.md) (blast-radius на `decide()`). Обходной путь — owner/admin применяет правку сам.

---

### 📊 2026-06-02 — Smart-tables Фаза 0: 10 системных таблиц при создании Org (auto-provision)

- **Шаг 4 — Prisma** — **обязательно** (безопасное добавление — только новые поля + индексы, опасных изменений нет): `docker compose exec backend bun run prisma:push`.
  В `Table`: `isSystem Boolean @default(false)`, `systemKey String?`, `@@unique([tenantId, systemKey])`, `@@index([tenantId, isSystem])`. У существующих строк `systemKey=NULL` — composite unique допускает множество NULL, дедуп не нужен.
- **Шаг 8 — Backfill** — завести 10 системных таблиц для всех существующих Org: `docker compose exec backend bun run scripts/backfill-system-tables.ts` (идемпотентен — повторный прогон пропускает уже созданные). Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: backfill`, `skipBootstrap: true`), поэтому идёт и через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (новый `TablesAutoProvisionService` + фронт-маркер 🔒): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - зарегистрировать нового пользователя → на `/tables` 10 системных таблиц с маркером 🔒 (Клиенты и сделки, Команда, Гипотезы и эксперименты, Поставщики, Реестр рисков, Идеи, Обещания, Контент-план, Регламенты, Цели и метрики).
  - попытка hard-delete системной таблицы через API → `403 system_table_hard_delete_forbidden`.
  - архив системной таблицы и восстановление из архива работают.

---

### 🤖 2026-06-02 — Smart-tables Фаза 1: Text-to-Schema через Кору (за feature-flag, default OFF)

- **Шаг 4 — Prisma** — **не требуется** (схема не менялась).
- **Шаг 7 — Seed** — два сидера (оба идемпотентны, уже в агрегаторе `apply-prod-deploy.ts`):
  - `scripts/seed-llm-task-routes-smart-tables.ts` — primary-маршруты для taskType `table-infer-schema`/`table-architect-pass`/`table-entity-check` на **DeepSeek V4 Pro**. Опционально: без сидера работает code-fallback chain (deepseek-chat→openai→ollama).
  - `scripts/seed-admin-settings.ts` — новый ключ `feature.tables_text_to_schema = false` (фича по умолчанию выключена).
  - Одной командой: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Шаг 11 — Docker rebuild** — обязателен (новый backend-сервис + frontend-компоненты Concierge): `docker compose up -d --build backend frontend`.
- **Включение фичи** (ТОЛЬКО после прохождения Eval Фазы 1.5 ≥ 0.85 accuracy): super_admin переключает `feature.tables_text_to_schema = true` в админке настроек (или PATCH admin-settings). До этого эндпоинты `/tables/infer-schema` и `/tables/from-schema` отвечают `403 feature_tables_text_to_schema_disabled` — это ожидаемо.
- **Шаг 12 — Smoke** (после включения флага): в Кора (Concierge) написать «нужна таблица клиентов с контактами и стадией сделки» → приходит карточка-превью схемы → «Подтвердить и создать» → таблица появляется в `/tables`.

---

### 🔗 2026-06-02 — Smart-tables Фаза 2: graph-driven rows (живой entitySync)

- **Шаг 4 — Prisma** — **не требуется** (entitySync и config — Json-поля, расширены без миграции).
- **Шаг 8 — Backfill** — наполнить sync-таблицы строками из живых сущностей графа для существующих Org: `docker compose exec backend bun run scripts/backfill-table-entity-sync.ts` (идемпотентен, конфликт-резолвер по primary/email). Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: backfill`, `skipBootstrap: true`, после `backfill-system-tables`). Через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`. **Порядок:** сначала `backfill-system-tables`, затем `backfill-table-entity-sync`.
- **Новая очередь BullMQ `tables.sync`** + воркер `TableSyncWorker` (in-process, поднимается в `ai/workers.module.ts` — отдельного процесса воркеров нет). Новые доменные события `entity.created/updated/archived` (EventEmitter2, in-process). Доп. инфраструктура не нужна — Redis уже есть.
- **Шаг 11 — Docker rebuild** — обязателен (backend: новые сервисы/воркер/события + правка `EntityResolutionService`; frontend: read-only колонки): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - создать новую Entity типа `customer` (через любой knowledge-core flow) → в течение ≤5с строка появляется в системной таблице «Клиенты и сделки».
  - попытка отредактировать read-only колонку «Название» через PATCH `/rows/:id` → `422 table_cell_readonly`; в UI ячейка помечена 🔗 и не открывает редактор.

---

### 📝 2026-06-02 — Smart-tables Фаза 3: Event-to-Cells из транскриптов встреч

- **Шаг 4 — Prisma** — **обязательно** (2 новые модели, безопасно): `docker compose exec backend bun run prisma:push`.
  Создаёт `TableCellProvenance` и `TableCellPendingPatch` (Decimal(3,2) confidence, индексы). Опасных изменений нет (только новые таблицы).
- **Шаг 7 — Seed** — перепрогнать (идемпотентно, уже в агрегаторе):
  - `seed-admin-settings.ts` — 3 ключа `table.agent.confirmation_threshold=0.85`, `table.agent.max_concurrent_enrich_jobs_per_org=100`, `table.agent.max_daily_tokens=1000000`.
  - `seed-llm-task-routes-smart-tables.ts` — маршруты `table-extract-rows`/`table-auto-fill` → DeepSeek V4 Flash (опционально; code-fallback chain работает и без них).
  - Через агрегатор: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Новая очередь BullMQ `tables.enrich`** + воркер `TableEnrichWorker` (in-process, `ai/workers.module.ts`). Новое событие `meeting.ai_ready` (EventEmitter2, in-process, эмит в AnalyzeWorker). Доп. инфраструктура не нужна.
- **Шаг 11 — Docker rebuild** — обязателен (backend: enrich-сервис/воркер/событие + правка AnalyzeWorker; frontend: provenance/undo/панель подтверждений): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - завершить встречу с транскриптом, где прозвучал факт по колонке клиента → после `ai_ready` в течение секунд пустая ячейка патчится (если conf≥0.85), у ячейки в карточке строки появляется 🔗 с ссылкой на тайминг встречи; «Отменить» откатывает.
  - правка с conf<0.85 или перезапись непустой ячейки → попадает в «🔔 Правки на подтверждении» (не применяется молча).
  - проверить, что повторная обработка той же встречи не вызывает повторный LLM-патч (кэш по meetingId).

---

### 📥 2026-06-02 — Smart-tables Фаза 4: Document-to-Table (Excel/CSV, in-process exceljs)

- **Шаг 1 — ENV** — 2 новых опциональных (есть код-дефолты): `TABLE_IMPORT_MAX_FILE_MB=25`, `TABLE_IMPORT_MAX_ROWS=5000`.
- **Шаг 4 — Prisma** — **не требуется** (схема не менялась).
- **Шаг 7 — Seed** — `seed-admin-settings.ts` добавляет ключ `table.import.dedup_threshold=0.85` (идемпотентно, уже в агрегаторе). Прогон: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- **Новая npm-зависимость** `exceljs@^4.4.0` (парсинг XLSX/CSV) — попадает в образ при rebuild (она в package.json + bun.lock). **Особых prod-действий нет** (не native-модуль).
- **Шаг 11 — Docker rebuild** — обязателен (backend: парсер/импорт-сервис + exceljs; frontend: диалог «Из файла»): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**: на `/tables` кнопка «Из файла» → загрузить тестовый Excel/CSV → приходит превью схемы (+ блок слияния, если есть похожая таблица) → «Создать новую» → таблица со строками появляется. Загрузка PDF → понятная ошибка «формат пока не поддерживается».
- **Примечание (долг):** парсинг in-process на `exceljs` — временное Node-решение (владелец 2026-06-02 решил пока не поднимать Python-микросервис DCS). PDF/сканы/HTML не поддержаны до появления DCS (см. `plans/tz/2026-05-31-document-ingest-universal.md`).

---

### 🔍 2026-06-02 — Smart-tables Фаза 5: NL Saved Views (семантический фильтр)

- **Шаг 4 — Prisma** — **не требуется** (моделей не добавляли; фильтры живут в `TableView.config`).
- **Шаг 7 — Seed** — `seed-llm-task-routes-smart-tables.ts` дополнен маршрутом taskType `table-semantic-filter` → DeepSeek V4 Flash. Опционально (без сида — code-fallback chain на `deepseek-chat`): чтобы primary был Flash, прогнать `docker compose exec backend bun run scripts/seed-llm-task-routes-smart-tables.ts --update-existing` (уже в `apply-prod-deploy.ts` STEPS). 
- **Redis** — новый кэш-ключ `table:semfilter:{tableId}:{sha1(normQuery)}` (TTL 7д). Redis уже есть, доп. действий нет.
- **Шаг 11 — Docker rebuild** — обязателен (backend: semantic-filter сервис/эндпоинт; frontend: SemanticFilterBar + клиентская фильтрация): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**: открыть таблицу с данными → поле «Найти срез» → «клиенты без активности месяц» (или по реальной колонке-дате) → строки фильтруются → «Сохранить как новый вид» сохраняет фильтр.

---

### 🪵 2026-06-01 — LoggingModule (технические логи в БД + админ-UI `/admin/logs`)

- **Шаг 1 — ENV** — **11 новых опциональных** `LOG_DB_*` (все с код-дефолтами, можно не выставлять):
  `LOG_DB_ENABLED=true`, `LOG_DB_MIN_LEVEL=INFO`, `LOG_DB_BATCH_SIZE=50`, `LOG_DB_FLUSH_INTERVAL_MS=5000`,
  `LOG_DB_MAX_BUFFER=5000`, `LOG_DB_RETENTION_DAYS=30`, `LOG_DB_STACK_TRACES=true`,
  `LOG_DB_REQUEST_BODY=false`, `LOG_DB_RESPONSE_BODY=false`, `LOG_DB_SUCCESS_REQUESTS=false`,
  `LOG_DB_SLOW_REQUEST_MS=2000`. Все переопределяются в рантайме через PATCH `/api/v1/platform/logs/settings` (без рестарта).
- **Шаг 4 — Prisma** — **обязательно** (новые модели/enum'ы): `docker compose exec backend bun run prisma:push`.
  Создаёт `SystemLog` (+9 индексов) и `PlatformSetting`, enum'ы `SystemLogLevel/Category/Contour`. Опасных изменений нет (только новые таблицы).
- **Seed/patch/backfill/migrate — НЕТ.** Cleanup-ретеншен — внутренний `setInterval` в backend-процессе (не cron-сервис).
- **Шаг 11 — Docker rebuild** — обязателен (новый backend-модуль + frontend-страница): `docker compose up -d --build backend frontend`.
- **Шаг 12 — Smoke**:
  - `curl -s localhost:3000/api/docs | grep platform-logs` (Swagger-тег появился).
  - под super_admin: `GET /api/v1/platform/logs?limit=5` → `{total, items, limit, offset}`; `GET /api/v1/platform/logs/settings` → настройки.
  - проверить запись: вызвать любой 5xx/404 → запись в `SystemLog` (через UI `/admin/logs`).

---

### 🌟 2026-06-01 — Shared demo Org «Демо: ТехноСтрим» + demo_observer (зонтик main-screen-umbrella, Поток А)

**Контекст.** Демо-кабинет «ТехноСтрим» теперь живёт **одной shared Org** в БД (isReferenceDemo=true). Новые пользователи получают `Membership(demo_observer)` к эталону сразу при регистрации (нет копий, нет ожидания «Готовим…»). При первой оплате listener снимает membership — пользователь видит только свою.

**Что выкачено в коде:**
- Schema: `enum MembershipRole +demo_observer`, `Org.isReferenceDemo`, `enum PaymentMode +reference`.
- ENV: `ZDEMO_ORG_ID` (optional CUID эталона).
- Backend: `DemoObserverGuard` (APP_GUARD), `RbacService.canMutate`, `AccountsService.register/getMe` интегрированы, `SubscriptionActivatedListener` снимает membership.
- Удалён авто-сидинг копий: `demo-seed.queue/worker`, `OnboardingService.triggerDemoSeed/getDemoSeedStatus/ensureDemoSeed`, endpoints `GET /demo-seed-status` / `POST /demo-workspace/ensure`, frontend loading-страница `/onboarding/welcome/complete`.
- Frontend: OrgSwitcher показывает бейдж «Демо», `/admin/demo` — «🌟 Эталон» с force-update только для эталона, MainEmptyState компонент.

**Шаги выката (порядок ВАЖЕН):**

- **Шаг 4 — Prisma** — да, новые enum values + поле:
  - `MembershipRole +demo_observer`
  - `Org.isReferenceDemo Boolean @default(false)`
  - `PaymentMode +reference`
  - Применяется автоматически через `migrate`-контейнер (`prisma db push --accept-data-loss`).

- **Шаг 6 — Patch (первый запуск)**: создать эталон + получить его id для ENV:
  ```bash
  docker compose exec backend bun run scripts/patch-create-reference-demo-org.ts
  ```
  Скрипт напечатает `ZDEMO_ORG_ID=<cuid>` — скопируй эту строку.

- **Шаг 1 — ENV**: добавить в `.env` (рядом с прочими ENV):
  ```bash
  ZDEMO_ORG_ID=<значение из шага 6 выше>
  ```
  Перезапустить backend:
  ```bash
  docker compose up -d backend
  ```

- **Шаг 6 — Patch (второй запуск)**: мигрировать старые «копии ТехноСтрим»:
  ```bash
  docker compose exec backend bun run scripts/patch-migrate-old-demo-orgs.ts
  ```
  Можно сделать сначала `--dry-run` для проверки.

- **Шаг 12 — Smoke**:
  - `curl -H "X-Org-Id: $ZDEMO_ORG_ID" -X POST http://localhost:3000/api/v1/meetings` (от owner'а эталона как demo_observer) → 403 `demo_observer_readonly`.
  - Зарегистрировать нового тест-юзера → проверить, что `/api/v1/accounts/me` возвращает `currentOrgId === ZDEMO_ORG_ID` И в `/api/v1/orgs/me` две Org (эталон + своя).
  - В админке `/admin/demo` — эталон помечен бейджем «🌟 Эталон», у остальных Org кнопки seed/reset disabled.

**Откат.** Если что-то пошло не так:
1. Удалить ENV `ZDEMO_ORG_ID` из `.env`, перезапустить backend — авто-привязка наблюдателей отключится (новые пользователи будут видеть только свою Org).
2. Memberships к эталону можно убрать через `prisma.membership.deleteMany({ where: { orgId: '<id>', role: 'demo_observer' } })`.
3. Саму эталонную Org можно soft-delete (`deletedAt: now()`) — schema fallback в register всё равно её отфильтрует.

**Известные ограничения:**
- Старые Org с `demoWorkspaceSeededAt != null` НО уже с реальными данными (`Person.externalSource <> 'demo'` или реальные `Meeting`) — НЕ мигрируются (skip-alive). Им остаётся прежнее состояние, в дашборде может быть «гибрид» демо + своих данных. По-хорошему надо просить пользователя оплатить, тогда listener снимет membership.
- frontend `(authenticated)/onboarding/welcome/complete/page.tsx` удалён — старые сессии, оказавшиеся на этой странице в момент выката, увидят 404. Они уйдут на `/dashboard` после refresh.

---

### 🛡️ 2026-06-01 — Идемпотентность update-скриптов (самопроверка вместо сырых падений)

Все patch/backfill/migrate-скрипты UPDATE-пути теперь **сами проверяют актуальность данных** и при «нечего делать / уже применено» печатают человекочитаемую причину и выходят с кодом `0`, а не валят `apply-prod-deploy`. Это значит: **повторный прогон `--mode update` безопасен**, и выкат не падает «сырой» ошибкой на уже-мигрированном проде.

Новый общий хелпер: `backend/scripts/_lib/schema-guards.ts` (`enumHasValue` / `isColumnNullable` / `tableExists` / `columnExists`) — read-only проверки `information_schema` / `pg_enum`.

Что изменилось по группам:
- **P1 (раньше падали на типичном проде):**
  - `patch-telegram-register-in-proxy.ts` — нет admin-кредов прокси / пустой токен / прокси недоступен → лог-причина + exit 0 (недоступность прокси пишется в `Channel.config.proxyLastSyncError`, выкат не блокируется). Перезапусти скрипт после настройки.
  - `patch-encrypt-tochka-oauth.ts` — `CRYPTO_MASTER_KEY` запрашивается только когда реально есть что шифровать (раньше падал, даже если всё уже зашифровано).
  - `backfill-demo-subscriptions.ts` — per-org ошибки → warning + exit 0; `exit 1` только при системном сбое (все Org упали).
  - `patch-backfill-card-versions.ts` — курсор по `id`, устранён бесконечный цикл в `--dry-run`.
- **P2 (поднимали весь AppModule):** `backfill-commitment-due-dates.ts`, `backfill-knowledge-clone-after-router-fix.ts` — лёгкий `count` + early-return ДО подъёма Nest; `migrate-telegram-channels-to-global.ts` переведён на `createPrismaClient()` (без AppModule).
- **P3 (защита от будущих cleanup-миграций):** enum DROP VALUE (`rename-client-to-customer`, `migrate-entity-custom-to-topic`), NOT NULL tightening (`org/person-timezone-default`, `backfill-entity-id-{document,goal,person}`), удаление legacy-моделей/колонок (`migrate-mvs-to-company-profile`, `migrate-person-role-to-appointment`, `skill-trait-categories-from-strings`, `bitemporal-backfill`).

Прод-операций сам по себе этот пункт НЕ добавляет — только делает существующие шаги 3/6/8/9 устойчивее. Достаточно общего Docker rebuild (Шаг 11).

---

### 🎬 2026-06-01 — Авто-сидинг демо при регистрации + авто-cleanup при оплате + фикс 403/404 дашборда

План: [plans/tz/2026-05-31-demo-auto-seed-and-cleanup.md](../../plans/tz/2026-05-31-demo-auto-seed-and-cleanup.md).

**Что выкатывается:**
- Backend: 2 новые BullMQ-очереди `onboarding.demo-seed` / `onboarding.demo-cleanup` + воркеры + `SubscriptionActivatedListener` (слушает `billing.subscription.activated_paid`/`_bonus`). `completeWelcome` ставит seed-job и редиректит на `/onboarding/welcome/complete`. Новый `GET /api/v1/orgs/:orgId/demo-seed-status`.
- Frontend: убрана страница `/onboarding/demo-choice`; новый loading-экран `/onboarding/welcome/complete`; фикс 403 дашборда (`dashboard.api.ts` теперь шлёт `X-Org-Id`); фикс 404 мёртвых ссылок (`/me/commitments`→`/me/promises`, `/settings/templates`→`/team-templates`).
- **Fallback пустого DEMO-кабинета:** `POST /api/v1/orgs/:orgId/demo-workspace/ensure` (идемпотентно) + триггер в `SubscriptionContext` при `status==='DEMO'`. Закрывает старые DEMO-Org (зарегистрированы до выката авто-сидинга) и неудавшийся seed — при первом заходе кабинет дозаливается синтетикой автоматически.

**Прод-операции:** только Docker rebuild. **Нет** новых ENV, миграций схемы (поле `Org.demoWorkspaceSeededAt` уже существует), seed/patch-скриптов. Очереди поднимаются вместе с backend-процессом (отдельного worker-процесса в Z нет).

- **Шаг 1 — ENV** — без новых.
- **Шаг 4 — Prisma** — не требуется (схема не менялась).
- **Шаг 11 — Docker rebuild** — обязательно:
  ```bash
  docker compose up -d --build backend frontend
  ```
- **Шаг 12 — Smoke**:
  ```bash
  # 1. Очереди demo-seed / demo-cleanup инициализированы (лог при старте backend)
  docker compose logs backend | grep -E 'DemoSeedQueue инициализирован|DemoCleanupQueue инициализирован|DemoSeedWorker запущен|DemoCleanupWorker запущен'

  # 2. Новый эндпоинт статуса отвечает (для своей Org owner'ом)
  curl -i -H 'Cookie: <owner_session>' -H 'X-Org-Id: <orgId>' \
    https://meet.crossmark.ru/api/v1/orgs/<orgId>/demo-seed-status
  # ожидаем {"status":"completed"} для уже залитой Org или pending/in_progress в процессе

  # 3. Дашборд директора больше НЕ отдаёт 403 (owner с X-Org-Id)
  curl -i -H 'Cookie: <owner_session>' -H 'X-Org-Id: <orgId>' \
    'https://meet.crossmark.ru/api/v1/dashboard/director?period=week'
  # ожидаем 200 (раньше 403 tenant_required из-за отсутствия X-Org-Id)
  ```
- **E2E (ручной):** регистрация новой Org → welcome 6 шагов → редирект на `/onboarding/welcome/complete` (спиннер «Готовим демо-кабинет») → авто-уход на `/dashboard` с данными «ТехноСтрим» + `PaywallBanner`. Затем активация подписки (manual bonus в Z-Admin) → через ~30 сек кабинет пуст.

---

### 🌊 2026-05-31 — Волна 2: Z-Admin Тариф (один tier_standard) + Партнёрский кабинет

Планы:
- [plans/tz/2026-05-31-admin-plans-collapse-to-standard.md](../../plans/tz/2026-05-31-admin-plans-collapse-to-standard.md)
- [plans/tz/2026-05-31-referrals-cabinet-revamp.md](../../plans/tz/2026-05-31-referrals-cabinet-revamp.md)

**ТЗ №3 — admin-plans-collapse-to-standard:**
- Backend: `/api/v1/admin/orgs/plans` CRUD → один `GET /current` (PlanSnapshotDto). `SeatService` и `MeetingsBalanceService` стали `async`, читают 6 ключей `billing.*` из AdminSetting через `getDynamic` с code-fallback. Активные `Subscription.monthlyPriceKopecks` НЕ пересчитываются при правке прайса.
- AdminSetting: 6 новых ключей `billing.*` (severity=`high`, reason обязателен).
- Frontend: `/admin/orgs/plans` переписан — одна карточка «Стандартный тариф Z» + 6 редактируемых `AdminSettingField` + калькулятор (slider 0..1000 seats) + история через `AdminSettingHistoryDrawer`.
- Prisma: `model Plan` помечен `// LEGACY` (физическое удаление — отдельным ТЗ через 2 недели).

**ТЗ №4 — referrals-cabinet-revamp:**
- Backend Prisma: `Referral.inn / legalForm / payoutDetails` → optional (`bun run prisma:push`, безопасно).
- Backend service: `create()` — `contractAccepted` обязателен, ИНН/реквизиты опциональны; `listClients()` маскированный (`clientCode`, без `org.name/id` — юридический приоритет); новые методы `getIncomeChart` (12 точек), `getFunnel(30d|90d|all)`; `getStats` расширен (+5 полей: clicks30d/signups30d/firstPayments30d/2 конверсии). `ReferralPayoutService.closePeriod` теперь требует `payoutDetails != null && Object.keys > 0`.
- Backend контроллер: новые `POST /me` body (`contractAccepted: z.literal(true)`), `GET /me/income-chart`, `GET /me/funnel`, `POST /me/promo-event` (throttle 30/min/IP).
- `AdminReferralsController.detail()` использует новый `listClientsForAdmin()` — super_admin сохраняет видимость `org.name/id` (маскировка только для партнёра).
- 3 новые Prometheus-метрики: `referral_promo_{impression,click,dismissed}_total{role}`.
- Frontend: `ReferralsClient.tsx` переписан на 3 состояния (A/B/C), 10 новых компонентов (`MarketingHero`, `CreateLinkCard`, `WithdrawalStrip`, `ReferralLinkCard`+QR, `IncomeChart` recharts, `FunnelCard`, `ClientsTableMasked`, `PayoutDetailsCard`, `WithdrawButton`, `PayoutsTable`). Терминологические замены (реферал → партнёр, paid → оплата).
- Frontend: `ReferralPromoStrip` в `AppShell` под `PaywallBanner` — мягкий promo-баннер с whitelisted страницами, разной копи для owner/member, dismiss на 30 дней, профиль-кэш на 24 часа.
- Новая зависимость: `qrcode.react@4.2.0` (~3 KB).

**Добивка 2026-05-31 (Блок A Волны 3):**
- Backend: `Referral`-response получил computed `hasPayoutDetails: boolean` (вычисляется как `payoutDetails != null && Object.keys > 0` через экспортируемую `hasPayoutDetails(ref)` в `services/referrals.service.ts`). Без него фронт использовал прокси `inn && legalForm` — кнопка «Вывести» ложно включалась, backend отвечал 400 при попытке вывода.
- Frontend: `referralFromApi` пробрасывает поле в `ReferralDomain`; `payoutDetailsAreFilled(ref)` теперь возвращает `ref.hasPayoutDetails` (старая эвристика по inn/legalForm удалена).
- Frontend: создана страница-заглушка `frontend/app/(public)/legal/partner-offer/page.tsx` (раньше чекбокс оферты в `CreateLinkCard` вёл в 404).
- Frontend: парный токен `text-emerald-50` вместо запрещённого `text-white` на CTA `ReferralPromoStrip`.
- Second-brain: создан `01_projects/referrals.md`; в `03_processes/referral-program.md` переписан раздел 3 (шаги 1-3 — one-click без обязательного ИНН) и §5-таблица (строки 1, 3).

**Pre-flight checks (Волна 2 + добивка Волны 3):**

```bash
# Сколько Referral без принятой оферты (профили до Волны 2).
# Если > 0 — обсудить с владельцем: backfill contractAcceptedAt = createdAt или
# попросить партнёров перепринять оферту вручную через legacy endpoint
# POST /referrals/me/accept-contract.
docker compose exec backend bun -e "import {PrismaClient} from '@prisma/client';
const p = new PrismaClient();
p.referral.count({where:{contractAcceptedAt: null}})
  .then(n=>{console.log('Referral без оферты:', n); return p.\$disconnect();});"
```

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — без новых.
- **Шаг 4 — Prisma** — **обязательно**:
  ```bash
  docker compose exec backend bun run prisma:push
  docker compose exec backend bun run prisma:generate
  ```
  Делает `Referral.inn / legalForm / payoutDetails` nullable (безопасно, данных не теряем) + добавляет `// LEGACY` docstring над `model Plan` (no-op для Postgres, нужен только generate).
- **Шаг 7 — Seed billing.* AdminSetting** — обязательно:
  ```bash
  docker compose exec backend bun run scripts/seed-admin-settings-billing.ts
  ```
  Идемпотентен. Создаёт 6 ключей `billing.*` с дефолтами 60_000 ₽ / 1_000 ₽ / 0.8 / 31 / 150 / 5. Если ключ уже есть — пропускает (защита админ-правок). Уже зарегистрирован в `apply-prod-deploy.ts STEPS` (phase=`seed-base`).
- **Шаг 9 — Migrate legacy tiers** — если в проде остались Org на `tier_basic/pro/enterprise`:
  ```bash
  docker compose exec backend bun run scripts/migrate-entitlements-to-standard.ts --dry-run
  docker compose exec backend bun run scripts/migrate-entitlements-to-standard.ts
  ```
  Уже зарегистрирован в `apply-prod-deploy.ts STEPS` (phase=`patch`, `skipBootstrap: true`).
- **Шаг 11 — Docker rebuild** — обязательно (новые backend-модули + frontend-страницы):
  ```bash
  docker compose up -d --build backend frontend
  ```
  (Уже было в записи Волны 1 от ai-chat-quota / z-admin-route-group — этот выкат накатываем общим cut'ом.)
- **Шаг 12 — Smoke**:
  ```bash
  # 1. Snapshot единого тарифа
  curl -i -H 'Cookie: <super_admin_session>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/admin/orgs/plans/current
  # Ожидаемо: 200 { tier: 'tier_standard', base: { monthlyPriceRub: 60000, … }, editableSettings: [...] }

  # 2. Правка прайса AdminSetting — live-инвалидация через <1s
  curl -i -X POST -H 'Cookie: <super_admin_session>' \
       -H 'Content-Type: application/json' \
       -d '{"value":7000000,"reason":"тест: подняли базу"}' \
       https://prod.host/api/v1/admin/settings/billing.baseMonthlyKopecks
  curl -i https://prod.host/api/v1/admin/orgs/plans/current  # base.monthlyPriceRub теперь 70000

  # 3. Старые CRUD-эндпоинты 404
  curl -i -X POST -H 'Cookie: <super_admin_session>' https://prod.host/api/v1/admin/orgs/plans
  # Ожидаемо: 404 (или 405)

  # 4. Партнёр без ИНН может создать профиль
  curl -i -X POST -H 'Cookie: <session>' -H 'Content-Type: application/json' \
       -d '{"contractAccepted":true}' https://prod.host/api/v1/referrals/me
  # Ожидаемо: 201 { id, slug, inn: null, legalForm: null, payoutDetails: null, contractAcceptedAt }

  # 5. Маскированный список клиентов
  curl -i -H 'Cookie: <session>' https://prod.host/api/v1/referrals/me/clients
  # Ожидаемо: 200 [{clientCode: 'C...', attachedAt, status, monthlyEarningsKopecks, totalEarnedKopecks}, ...]
  # Без org.name / org.id

  # 6. Новые аналитические эндпоинты
  curl -i https://prod.host/api/v1/referrals/me/income-chart  # 200, массив длиной 12
  curl -i https://prod.host/api/v1/referrals/me/funnel?period=30d  # 200, {clicks, signups, firstPayments, activeNow, conversions}

  # 7. Promo-event
  curl -i -X POST -H 'Cookie: <session>' -H 'Content-Type: application/json' \
       -d '{"type":"impression","role":"owner"}' \
       https://prod.host/api/v1/referrals/me/promo-event
  # Ожидаемо: 204 (без тела)
  curl -s https://prod.host/metrics | grep -E 'referral_promo_(impression|click|dismissed)_total'
  # Ожидаемо: счётчики увеличиваются при следующих вызовах

  # 8. UI:
  # - /admin/orgs/plans — одна карточка, 6 редактируемых полей, калькулятор, история
  # - /referrals — три состояния (A/B/C), маркетинговый герой, чекбокс оферты, без обязательных полей
  # - / (любая whitelisted страница) под пользователем без Referral — видна полоска ReferralPromoStrip; нажатие на × скрывает на 30 дней

  # 9. (Блок A Волны 3 — добивка) Партнёрская оферта — placeholder-страница не 404:
  curl -s -o /dev/null -w '%{http_code}\n' https://prod.host/legal/partner-offer
  # Ожидаемо: 200

  # 10. (Блок A Волны 3 — добивка) hasPayoutDetails в /referrals/me ответе:
  curl -i -H 'Cookie: <session>' https://prod.host/api/v1/referrals/me
  # Ожидаемо: 200 { ..., "hasPayoutDetails": false, "inn": null, ... } для свежесозданного профиля
  # После PATCH /me с непустым payoutDetails — hasPayoutDetails: true.
  ```

- **Откат:**
  ```bash
  git revert <hash_tz3> <hash_tz4>
  docker compose up -d --build backend frontend
  ```
  AdminSetting записи `billing.*` остаются (не ломают старый код — он на них не смотрел). Опциональность полей `Referral` ретро-вернуть в `required` нельзя без backfill дефолтами — не рекомендую откатывать prisma:push, только код.

⚠️ **Юридический момент.** Маскировка клиентов `/referrals/me/clients` обязательна — партнёр НЕ должен видеть `org.name/org.id`. Тест-кейсы в `referrals.service.spec.ts` проверяют это. Контракт: super_admin (`/admin/referrals/:id`) ВИДИТ полные данные через `listClientsForAdmin()` (отдельный метод сервиса).

---

### 🌊 2026-05-31 — Волна 3 Блок C: Smart Tables MVP-старт (Фазы 0+1)

План: [plans/tz/2026-05-31-smart-tables.md](../../plans/tz/2026-05-31-smart-tables.md) — реализованы Фазы 0+1 из 14.

**Сделано:**
- Backend: 5 новых Prisma-моделей (`Table`, `TableProperty`, `TableRow`, `TableView`, `TableAutomation`) + 3 enum'а (`TablePropType` 24 значения, `TableViewType` 9, `TableViewVisibility` 3) + обратная relation `Org.tables`.
- Backend: модуль `backend/src/modules/tables/` с 3 контроллерами и 3 сервисами, 19 эндпоинтов CRUD (`/api/v1/tables`, `/api/v1/tables/:tableId/properties`, `/api/v1/tables/:tableId/rows`).
- Backend: RBAC ресурс `table` в `policy.csv` (9 строк: owner/admin/manager r/w/d, manager — self-scope на write/delete).
- Backend: 4 ENV `TABLE_MAX_*` (опциональные, дефолты в коде).
- Backend: 19 unit-тестов пройдены; integration-spec `tables.e2e.spec.ts` помечен `it.skip` до dev-Postgres+testcontainers.
- Postgres-init: GIN-индекс `table_row_cells_gin ON "TableRow" USING GIN (cells jsonb_path_ops)` для фильтра по JSONB.
- Frontend: страница `/tables/[id]` с Glide Data Grid (Canvas, `next/dynamic ssr:false`), Zustand store с optimistic updates + debounce 500мс. 14 интерактивных типов колонок + 3 computed + drag&drop колонок/строк через фракционный `order` + copy/paste из Excel + добавление колонок через UI popover.
- Новые зависимости фронта: `@glideapps/glide-data-grid@^6.0.3`, `@tanstack/react-virtual@^3.13.26` (зарезервирован), `zustand@^5.0.14`.

**Не реализовано (отдельные сессии)**: Views (Фаза 3), Канбан (4), Excel-импорт (5, зависит от document-ingest Фазы 1), AI внутри таблиц (8), Embed в документ (9), Yjs real-time (10), Permissions ячейки (11), Conditional + Automations (12), API+webhooks (13), Forms (14).

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — 4 новых, опциональных (дефолты в коде):
  ```bash
  # TABLE_MAX_ROWS_PER_TABLE=100000
  # TABLE_MAX_PROPS_PER_TABLE=200
  # TABLE_MAX_TABLES_PER_ORG=1000
  # TABLE_MAX_CELL_SIZE_BYTES=1048576
  ```
  Не задавать = принять дефолты. В отдельной строке `.env` если нужно повысить порог.
- **Шаг 4 — Prisma** — **обязательно** (новые модели):
  ```bash
  docker compose exec backend bun run prisma:push
  docker compose exec backend bun run prisma:generate
  ```
  Делает: создаёт 5 таблиц `Table/TableProperty/TableRow/TableView/TableAutomation` + 3 enum типа в Postgres. Безопасно — все новые таблицы, ничего не теряем.
- **Шаг 5 — postgres-init.sql — GIN-индекс**:
  ```bash
  docker compose exec backend bun run apply-postgres-init
  ```
  Создаёт `CREATE INDEX IF NOT EXISTS table_row_cells_gin ON "TableRow" USING GIN (cells jsonb_path_ops)`. Идемпотентно.
- **Шаги 6–10 (patch/seed/backfill/migrate/setup)** — НЕТ. Фаза 0 без seed.
- **Шаг 11 — Docker rebuild** — обязателен (новый backend модуль + новые frontend зависимости):
  ```bash
  docker compose up -d --build backend frontend
  ```
- **Шаг 12 — Smoke**:
  ```bash
  # 1. Список таблиц для нового тенанта — пустой массив
  curl -i -H 'Cookie: <session>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/tables
  # Ожидаемо: 200 { items: [], total: 0 }

  # 2. Создание таблицы
  curl -i -X POST -H 'Cookie: <session>' -H 'X-Org-Id: <orgId>' \
       -H 'Content-Type: application/json' \
       -d '{"name":"Тестовая таблица"}' \
       https://prod.host/api/v1/tables
  # Ожидаемо: 200 { id, tenantId, name: 'Тестовая таблица', ... }
  TABLE_ID=<id из ответа>

  # 3. Добавление колонки
  curl -i -X POST -H 'Cookie: <session>' -H 'X-Org-Id: <orgId>' \
       -H 'Content-Type: application/json' \
       -d '{"name":"Имя","type":"text"}' \
       https://prod.host/api/v1/tables/$TABLE_ID/properties
  # Ожидаемо: 200 { id, tableId: <TABLE_ID>, name: 'Имя', type: 'text', order: 1 }
  PROP_ID=<id из ответа>

  # 4. Добавление строки
  curl -i -X POST -H 'Cookie: <session>' -H 'X-Org-Id: <orgId>' \
       -H 'Content-Type: application/json' \
       -d "{\"cells\":{\"$PROP_ID\":\"Иван Иванов\"}}" \
       https://prod.host/api/v1/tables/$TABLE_ID/rows
  # Ожидаемо: 200 { id, tableId, cells: { <PROP_ID>: 'Иван Иванов' }, ... }

  # 5. Список строк
  curl -i -H 'Cookie: <session>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/tables/$TABLE_ID/rows
  # Ожидаемо: 200 { items: [{...}], total: 1 }

  # 6. Превышение лимита cell size
  curl -i -X POST -H 'Cookie: <session>' -H 'X-Org-Id: <orgId>' \
       -H 'Content-Type: application/json' \
       -d "{\"cells\":{\"$PROP_ID\":\"$(python3 -c 'print(\"x\"*1100000)')\"}}" \
       https://prod.host/api/v1/tables/$TABLE_ID/rows
  # Ожидаемо: 400 с code='cell_too_large', message содержит propertyId

  # 7. Swagger smoke
  curl -s https://prod.host/api/docs-json | jq '.paths | keys[] | select(startswith("/api/v1/tables"))' | wc -l
  # Ожидаемо: 19

  # 8. UI:
  # - /tables/<id> — открывается Grid view (Glide Data Grid), редактирование text-ячейки работает,
  #   копирование из Excel через Ctrl+V вставляет диапазон, перетаскивание заголовков колонок и
  #   ручек строк меняет порядок. Кнопка «+ Колонка» в шапке открывает popover с 14 типами.
  ```

- **Откат:**
  ```bash
  git revert <commit_range>
  docker compose up -d --build backend frontend
  ```
  Schema-добавления безопасны (новые таблицы, не теряем данные). Если откатываем — таблицы остаются в БД пустыми (на старом коде их никто не дёрнет). Можно вычистить руками: `DROP TABLE "TableAutomation", "TableView", "TableRow", "TableProperty", "Table" CASCADE; DROP TYPE "TableViewVisibility", "TableViewType", "TablePropType";`.

⚠️ **Известное ограничение Фазы 1.** Bubble cells (status / selectSingle / selectMulti) в Glide Data Grid отображаются, но не редактируются inline (overlay-edit не поддержан Glide для Bubble). В коде помечено комментарием. Доработка — Фаза 2 (custom popover-редактор поверх Bubble).

**Дополнение Волны 3 / Smart Tables Фазы 2 + 3 (2026-05-31, тот же общий cut):**

**Фаза 2 — карточка строки = мини-документ**:
- Frontend: новый `RowDetail.tsx` (Sheet-панель), Tiptap-editor для `TableRow.pageContent` (поле уже было в Prisma из Фазы 0).
- Новые зависимости фронта: `@tiptap/react@^3.24.0`, `@tiptap/starter-kit@^3.24.0`, `@tiptap/extension-link@^3.24.0`.
- Backend: никаких изменений (`UpdateRowBodySchema.pageContent` уже принимался).

**Фаза 3 — сохраняемые срезы (saved views)**:
- Backend: новый `TableViewsController` + `TableViewsService` в `backend/src/modules/tables/`. **5 новых эндпоинтов** под `/api/v1/tables/:tableId/views`.
- Никаких Prisma-изменений (модель `TableView` уже была в Фазе 0).
- Frontend: `ViewSelector`, `SaveViewDialog`. URL state `/tables/:id?view=:viewId`.

**Прод-операций НЕ нужно** (нет новых ENV, нет Prisma-push, нет seed/patch/migrate, нет новых очередей). Достаточно `docker compose up -d --build backend frontend` — Шаг 11 общий с Фазами 0+1 и остальной Волной 3.

**Дополнительные smoke-проверки (опц.):**
```bash
# Список views — пустой для новой таблицы
curl -i -H 'Cookie:<session>' -H 'X-Org-Id:<orgId>' \
     https://prod.host/api/v1/tables/$TABLE_ID/views
# Ожидаемо: 200 []

# Создать view
curl -i -X POST -H 'Cookie:<session>' -H 'X-Org-Id:<orgId>' \
     -H 'Content-Type: application/json' \
     -d '{"name":"Только важное","type":"grid","visibility":"personal","config":{"hiddenProps":["<propId>"]}}' \
     https://prod.host/api/v1/tables/$TABLE_ID/views
# Ожидаемо: 201 { id, ownerId, ... }

# UI:
# /tables/<id> — в шапке dropdown «Виды» (пустой) + «Колонки» (видимость колонок и плотность)
# Кликнул на маркер строки → справа выезжает Sheet с property'ями + Tiptap editor «Содержимое»
```

---

### 🌊 2026-05-31 — Волна 3 Блок B: document-ingest Фаза 0 smoke-test (RESEARCH, без прод-выкатки)

План: [plans/tz/2026-05-31-document-ingest-universal.md](../../plans/tz/2026-05-31-document-ingest-universal.md) §Фаза 0.

**Сделано:** smoke-test финального стека (Docling 2.96 + RapidOCR + PP-OCRv5 eslav-веса) на 5 публичных фикстурах. Все гейты §0.3 либо пройдены, либо имеют архитектурное решение в Фазе 1.

**Прод-операций НЕТ.** Это research-фаза — она ничего не выкатывает в прод. Артефакты:
- `backend/test/fixtures/documents/{README.md, download-fixtures.sh, .gitignore}` — фикстуры скачиваются локально (бинарники не в git).
- `infra/document-conversion/smoke/{Dockerfile, docker-compose.yml, run.py}` — smoke-CLI, запускается локально через docker.
- `plans/analysis/2026-05-31-document-conversion-stack.md` — дополнен разделом «Smoke-test results» с цифрами.
- `plans/tz/2026-05-31-document-ingest-universal.md` — статус «Фаза 0 закрыт 2026-05-31».

**Локально воспроизвести** (для другой машины разработчика):
```bash
cd backend/test/fixtures/documents && bash download-fixtures.sh
cd ../../../../infra/document-conversion/smoke
docker compose build
docker compose run --rm smoke
```

**Решение по Фазе 1**: ✅ Docling+RapidOCR подтверждён. Не переходим на план B (OpenDataLoader PDF). Фаза 1 (полноценный DCS sidecar) разблокирована для отдельной сессии.

⚠️ **Критическая находка для Фазы 1:** PP-OCRv5 eslav-веса (`monkt/paddleocr-onnx`) обязательны. С дефолтным китайским ch_PP-OCRv4 — OCR на русском 0%. С eslav — 100%. Зафиксировать в ТЗ Фазы 1.

---

### 🌊 2026-05-31 — Pulse Этапы A+A2+B+C (gaps + 3.2/4.6/4.7 + Волна 5 + Волна 6)

---

### 🌊 2026-05-31 — Pulse Этапы A+A2+B+C (gaps + 3.2/4.6/4.7 + Волна 5 + Волна 6)

План: [plans/tz/2026-05-30-pulse-full.md](../../plans/tz/2026-05-30-pulse-full.md) §5-10.
Коммиты: `84b0f89` + `572f31b` + `ef9cd5a` + `1491d7f` + `dda094e` + `050d094`.
Рефлексия: [`second-brain/05_история/2026-05-31-pulse-volna-5-6.md`](../../second-brain/05_история/2026-05-31-pulse-volna-5-6.md).

**Сделано** (≈22 фазы ТЗ):
- A: backend gaps — viewedUserId в ActivityFeed (разблокировка PersonPulse 9.5) + meeting_activity в Engagement-Scorer.
- A2: Conflict-Detector extension (CheckInConflictDetectorCron) + Forecaster (новая модель ForecastSnapshot + LLM cron Mon 04:00) + hr_partner роль (+ canViewEmployeeFullCard в RbacService).
- Волна 5: Sprint Daily/Weekly табы + new endpoints, Архив гипотез `/sprints/archive`, Telegram sprint section, 5 Concierge tools.
- Волна 6: 5 weekly cron-агентов Mon 05:00 (Bus Factor / Topic Recurrence / Promise Network / Goal Vector / Knowledge Velocity) + 2 event-driven worker'а (Meeting ROI после analyze, Decision Hygiene после specialist-3-3) + единый `GET /api/v1/dashboard/pulse-patterns` endpoint + 7 виджетов на главной.

**Schema-изменения** (одной prisma:push):
- +6 новых моделей: `ForecastSnapshot` (4.6), `KnowledgeRiskSnapshot` (6.1), `RecurringTopic` (6.2), `PromiseNetworkSnapshot` (6.5), `PersonGoalContribution` (6.6, unique по tenant+person+goal+week), `KnowledgeVelocitySnapshot` (6.7).
- +5 новых полей в существующих: `Meeting.roiScore/roiScoreAt` (6.3, Decimal(8,3) — не 4,3 как в ТЗ §4.1, защита от переполнения), `Decision.reversibility/reversibilityAt` (6.8).
- +1 enum value: `MembershipRole.hr_partner` (4.7).
- Все nullable/defaulted — без data-loss.

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — без новых ENV (все feature-flags inline в коде).
- **Шаг 4 — Prisma** — **обязательно** (новые модели и поля):
  ```bash
  docker compose exec backend bun run prisma:push
  docker compose exec backend bun run prisma:generate
  ```
- **Шаг 5 — postgres-init.sql** — не трогали.
- **Шаги 6–10 (patch/seed/backfill/migrate/setup)** — НЕТ. Все новые модели снапшотные (cron сам наполнит при первом запуске); enum hr_partner не требует backfill (никто пока не назначен).
- **Шаг 11 — Docker rebuild** — обязателен:
  ```bash
  docker compose up -d --build backend
  ```
- **Шаг 12 — Smoke**:
  ```bash
  # 1. Pulse-patterns endpoint:
  curl -i -H 'Cookie:<auth>' -H 'X-Org-Id:<orgId>' \
       https://prod.host/api/v1/dashboard/pulse-patterns?period=week
  # Ожидаемо: 200 { busFactor, recurringTopics, lowRoiMeetings, bottlenecks, goalVector, knowledgeVelocity, irreversibleDecisions }

  # 2. Sprint dashboard daily/weekly:
  curl -i -H 'Cookie:<auth>' -H 'X-Org-Id:<orgId>' \
       https://prod.host/api/v1/cycles/<cycleId>/dashboard/daily
  curl -i ... /api/v1/cycles/<cycleId>/dashboard/weekly

  # 3. Sprints archive:
  curl -i ... /api/v1/sprints/archive?period=quarter

  # 4. ActivityFeed viewedUserId (PersonPulse 9.5):
  curl -i ... '/api/v1/feed/probe_question?viewedUserId=<userId>&scopedToMe=false&limit=10'

  # 5. Concierge tools (через chat):
  curl -i -X POST ... /api/v1/concierge/chat \
       -d '{"message":"что с Иваном"}'  # должен вызвать get_person_pulse

  # 6. Cron-агенты зарегистрированы:
  docker compose logs backend | grep -E 'Forecaster|BusFactorAnalyzer|TopicRecurrence|PromiseNetwork|GoalVectorTracker|KnowledgeVelocity'
  # Также после Mon 05:00 UTC — увидеть «проход завершён» от каждого.

  # 7. Frontend:
  # /dashboard — 7 новых виджетов + KnowledgeVelocity KpiHero + IrreversibleDecisions banner
  # /sprints/[id] — табы Main/Daily/Weekly
  # /sprints/archive — список всех Cycle
  # /persons/[id]/pulse — секция «Вопросы AI этому человеку» теперь живая
  ```

- **Откат:** `git revert <commit_range>` + `docker compose up -d --build`. Schema-добавления nullable — данные не теряются. Cron'ы можно остановить через рестарт (они идемпотентны).

⚠️ **Юридический check** для irreversible decisions UI: алерт «3 необратимых решения без альтернатив» виден только owner/admin (через RBAC dashboard_operations). Для hr_partner новые правила — см. policy.csv новый раздел «Pulse Wave 4 §4.7 — hr_partner».

---

### 🌊 2026-05-31 — Единая per-user квота AI-чата (Concierge + клоны)

План: [plans/tz/2026-05-31-ai-chat-quota-unified-per-user.md](../../plans/tz/2026-05-31-ai-chat-quota-unified-per-user.md).

**Сделано:** новый глобальный модуль `ai-chat-quota` (`AiChatQuotaService` + `AiChatQuotaController`) — один счётчик `ai_chat_messages_per_day` на пользователя, считает Concierge + клоны вместе; лимит зависит от роли в Org (admin/member). Concierge и Clones переключены на него. UI-эндпоинт `GET /api/v1/me/ai-chat/quota` для индикатора «осталось N сообщений сегодня». Старый Redis-ключ `clone:ask:*` и ENV `CLONE_ASK_PER_USER_PER_DAY` оставлены как deprecated code-fallback (удалим в следующем выкате после rollback-окна).

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — **3 новых опциональных** (есть код-дефолты, можно не выставлять). Рекомендуется задать явно в `.env`:
  ```env
  AI_CHAT_DAILY_LIMIT_ADMIN=50
  AI_CHAT_DAILY_LIMIT_MEMBER=20
  AI_CHAT_ADMIN_ROLES=owner,admin,coo
  ```
  `CLONE_ASK_PER_USER_PER_DAY` (старый) оставляем как есть — deprecated, не удаляем в этот выкат для безопасного rollback.
- **Шаги 4–10 (Prisma / postgres-init / patch / seed / backfill / migrate / setup)** — НЕТ. Счётчик живёт в Redis (existing `QuotaService`), снапшоты в `UserQuotaCounter` уже создаются автоматически.
- **Шаг 11 — Docker rebuild** — обязателен (новый модуль и контроллер):
  ```bash
  docker compose up -d --build backend
  ```
- **Шаг 12 — Smoke**:
  ```bash
  # 1. Endpoint в Swagger:
  docker compose exec backend curl -fsS http://localhost:3000/api/docs-json \
    | jq '.paths["/api/v1/me/ai-chat/quota"]'
  # Ожидаемо: объект с methods.get (Swagger включается только в dev — в prod
  # /api/docs за basic-auth, проверять curl'ом напрямую).

  # 2. Метрика счётчика в Prometheus:
  docker compose exec backend curl -fsS http://localhost:3000/metrics \
    | grep ai_chat_messages_per_day
  # Ожидаемо: одна и та же метрика растёт от Concierge-сообщений
  # И от ask_role_clone — это и есть единый счётчик.

  # 3. UI-проверка: открыть /concierge, отправить сообщение → счётчик
  # `dailyUsed` в `GET /api/v1/me/ai-chat/quota` увеличивается на 1.
  # Открыть карточку клона, спросить клона → тот же `dailyUsed` растёт.
  ```

- **Откат:** `git revert <commit>` + `docker compose up -d --build`. `CLONE_ASK_PER_USER_PER_DAY` остался — старая ветка кода после revert'а снова заработает без потерь.

---

### 🌊 2026-05-31 — Z-Admin standalone route group (frontend only)

План: [plans/tz/2026-05-31-z-admin-standalone-route-group.md](../../plans/tz/2026-05-31-z-admin-standalone-route-group.md).

**Изменения:** только frontend — перенос /admin/* в свою route-группу
`app/(admin)/admin/*` + новый `AdminAuthGuard`. Backend/БД/ENV — без изменений.

- **Шаг 1 (ENV)** — без новых.
- **Шаг 4 (Prisma)** — не требуется.
- **Шаг 11 (Docker image rebuild)** — обязательно (frontend image меняется):
  ```bash
  docker compose up -d --build frontend
  ```
- **Шаг 12 (Smoke)**:
  ```bash
  # Под super_admin: должен открыться /admin БЕЗ пользовательского сайдбара
  docker compose exec frontend curl -i -H 'Cookie: <super_admin_session>' http://localhost:3000/admin
  # Без cookie → 200 + клиентский redirect на /admin/login (SSR не редиректит,
  # AdminAuthGuard делает это в браузере)
  docker compose exec frontend curl -i http://localhost:3000/admin
  # Под обычным юзером → 200, в браузере redirect на /dashboard
  ```
- **Откат:** `git revert <hash>` + `docker compose up -d --build frontend`.
  Бэкенд не трогали — откат бесплатный.

---

### 🌊 2026-05-30 — Pulse Волна 4 (152-ФЗ + audit + Risk-агенты)

План: [plans/tz/2026-05-30-pulse-full.md](../../plans/tz/2026-05-30-pulse-full.md) §8.
Коммит: `2039d77`. **Сделано:** Фазы 4.1, 4.2, 4.3, 4.4, 4.5. **Отложено:** 4.6 Forecaster, 4.7 hr_partner.

**Краткое содержание:**
- 2 новых модели: `ConsentLog` (152-ФЗ согласия), `KnowledgeAccessLog` (audit просмотров карточки).
- Новые поля: `Person.analyticsOptIn`/`analyticsOptInAt`/`riskFlagsJson`, `Org.region`, `MeetingParticipantBehavior.sentimentTextPerSpeakerJson`.
- 2 новых cron: `MeetingSpeakerAnalyzerWorker` (hourly), `BurnoutRiskDetectorCron` (daily). Оба под `analyticsOptIn=true` gate.
- 1 interceptor: `KnowledgeAccessLoggerInterceptor` на view-эндпоинтах PersonsController (best-effort).
- REST: `GET/POST /api/v1/me/consents`, `GET /api/v1/me/privacy/access-log`.
- 3 новые frontend-страницы: `/onboarding/consents` (Блок C), `/me/privacy/consents`, `/me/privacy/access-log`.
- PersonPulse получил секцию «Сигналы для разговора 1:1» (из Burnout-Risk-Detector).

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — без новых ENV.
- **Шаг 4 — Prisma** — **обязательно**:
  ```bash
  docker compose exec backend bun run prisma:push
  docker compose exec backend bun run prisma:generate
  ```
  Добавляет 5 полей в существующие модели + 2 новые модели (ConsentLog, KnowledgeAccessLog). Все nullable/defaulted, без data-loss.
- **Шаг 7 — Seed LLM task routes**:
  ```bash
  docker compose exec backend bun run scripts/seed-llm-task-routes-pulse-w4.ts
  ```
  Регистрирует `meeting-speaker-analyzer`. Уже в `apply-prod-deploy.ts STEPS`.
- **Шаг 11 — Docker image rebuild** — обязателен (новые модули/endpoints/cron'ы/frontend).
- **Шаг 12 — Smoke**:
  ```bash
  # 1. Consents endpoint (cookie self):
  curl -i -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/me/consents
  # Ожидаемо: 200 { items: [] } (пусто до первого согласия)

  # 2. POST consent:
  curl -i -X POST -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       -H 'Content-Type: application/json' \
       -d '{"dataType":"checkin_processing","consented":true}' \
       https://prod.host/api/v1/me/consents

  # 3. Access log self:
  curl -i -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/me/privacy/access-log
  # Ожидаемо: 200 { items: [{accessedAt, viewerUserName, sectionAccessed, ...}, ...] }

  # 4. Cron'ы зарегистрированы:
  docker compose logs backend | grep -E 'MeetingSpeakerAnalyzer|BurnoutRiskDetector'

  # 5. Frontend:
  # /onboarding/consents — Блок C onboarding с 3 чекбоксами
  # /me/privacy/consents — текущие согласия + отозвать
  # /me/privacy/access-log — таблица «кто открывал твою карточку»
  # /persons/<id>/pulse — новая секция «Сигналы 1:1» (видна при наличии flags)
  ```
- **Откат:** `git revert 2039d77` + restart. Schema-добавления нерушительные. Если включить опять — пользовательские согласия сохранятся (ConsentLog не удаляется).

⚠️ **Юридический check рекомендуется** до релиза текстов в `/onboarding/consents` (см. ТЗ §8.4): согласия покрывают 152-ФЗ для РФ; для EU понадобится отдельный flow (region='eu') в будущей волне.

---

### 🌊 2026-05-30 — Pulse Волна 3 (Карточка сотрудника + 4 AI-агента)

План: [plans/tz/2026-05-30-pulse-full.md](../../plans/tz/2026-05-30-pulse-full.md) §7.
Коммит: `1791fd5`.

**Краткое содержание:**
- 4 новых cron-агента:
  - `team-health-analyzer.cron.ts` (daily 04:30 UTC) — LLM deepseek-v4-flash, 5 Gallup-факторов per Department.
  - `engagement-scorer.cron.ts` (daily 03:00 UTC) — детерминированный composite (sentiment+regularity+commitments+meeting), пишет в Person + PersonEngagementSnapshot.
  - `reflection-quality-scorer.cron.ts` (hourly batch) — LLM 3-axis quality, пишет в DailyCheckIn.qualityScore.
  - `hr-recommender.cron.ts` (weekly Mon 06:00 UTC) — LLM deepseek-v4-pro, рекомендации руководителю 5 типов.
- 5 новых Prisma полей: `Department.healthSummaryJson`, `Person.engagementScore/engagementScoreAt/hrSuggestionsJson`, `DailyCheckIn.qualityScore`.
- 1 новая модель: `PersonEngagementSnapshot` (история тренда).
- Новый endpoint `GET /api/v1/persons/:id/pulse` + `PersonPulseService`.
- Новая frontend-страница `/persons/[id]/pulse` — карточка сотрудника с AI Resume, Mood trend, Check-ins regularity, Promises KpiHero.

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — без новых ENV.
- **Шаг 4 — Prisma** — **обязательно**:
  ```bash
  docker compose exec backend bun run prisma:push
  docker compose exec backend bun run prisma:generate
  ```
  Все 5 новых полей nullable/defaulted, новая модель PersonEngagementSnapshot создаётся пустой — без data-loss.
- **Шаг 7 — Seed LLM task routes** — добавился новый seed:
  ```bash
  docker compose exec backend bun run scripts/seed-llm-task-routes-pulse-w3.ts
  ```
  Регистрирует `team-health-analyzer`, `reflection-quality-scorer`, `hr-recommender` task types. Идемпотентен, защищает editedByAdmin. Уже в `apply-prod-deploy.ts STEPS`.
- **Шаг 11 — Docker image rebuild** — обязателен (4 новых cron'а + новый endpoint + новая страница).
- **Шаг 12 — Smoke**:
  ```bash
  # 1. PersonPulse endpoint (cookie owner/admin или self):
  curl -i -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/persons/<personId>/pulse
  # Ожидаемо: 200 PersonPulseDto / 403 forbidden если не privileged и не self /
  #            404 person_not_found

  # 2. Cron'ы должны зарегистрироваться в Nest schedule:
  docker compose logs backend | grep -E 'TeamHealthAnalyzer|EngagementScorer|HrRecommender|ReflectionQuality'
  # Ожидаемо: "Cron registered" сообщения при старте процесса.

  # 3. После первого прогона (engagement-scorer 03:00 UTC):
  docker compose exec backend bun -e "
    import { PrismaClient } from '@prisma/client';
    const p = new PrismaClient();
    const count = await p.personEngagementSnapshot.count();
    console.log('PersonEngagementSnapshot rows:', count);
    await p.\$disconnect();
  "
  # Ожидаемо: >0 после первого прогона.

  # 4. Frontend:
  # /persons/<id>/pulse — карточка с AI Resume, mood trend, regularity, promises
  ```
- **Откат:** `git revert 1791fd5` + restart. Schema-добавления нерушительные. Cron'ы дальше работать не будут, но persisted данные (Department.healthSummaryJson, Person.engagementScore, etc) останутся (можно занулить вручную если нужно полное забвение).

---

### 🌊 2026-05-30 — Pulse Волны 1+2 (Фундамент + Усиление операций)

План: [plans/tz/2026-05-30-pulse-full.md](../../plans/tz/2026-05-30-pulse-full.md) §5-6.
Коммиты: `0f0bf03` (Волна 1, 8 фаз), `801ba61` (Волна 2, 5 фаз).

**Краткое содержание:**
- 8 новых сервисов в `backend/src/modules/dashboard/`: CommitmentReliability, HangingDecisions, SentimentIndex, NarrativeCitationsParser, TeamHealth, TeamDetail, SampleStoryDataset.
- 2 новых эндпоинта: `GET /api/v1/dashboard/team-health`, `GET /api/v1/dashboard/teams/:id`.
- 2 новых эндпоинта операций: `GET /api/v1/dashboard/operations/missing-checkins`, `GET /api/v1/dashboard/operations/stale-issues`.
- TenantMiddleware (`backend/src/modules/rbac/middleware/tenant.middleware.ts`) — резолв `req.tenantId` ДО глобальных guards (SubscriptionGuard, EntitlementGuard, MustChangePasswordGuard). Фикс бага `403 tenant_required` на эндпоинтах с `@RequireEntitlement`.
- 2 новых поля в Prisma модели `Decision`: `raisedCount Int @default(1)`, `lastRaisedAt DateTime?`. specialist-3-3 теперь инкрементит счётчик при merge-verdict.
- Новые frontend-страницы: `/teams` (список с сортировкой), `/teams/[id]` (детальная карточка).
- 4 runtime-секции в Daily-Digest DTO: eventsToday, urgentItems, whoShined (stub), whoStruggled.
- 3 runtime-секции в Weekly-Digest DTO: kpiDeltas, teamDynamics, forecast.
- 4 новых компонента UI: KpiHero (с threshold-coloring), TeamHealthGrid, ActivityFeedWidget, AiNarrativeWithSources, TeamTemperatureHeatmap, SampleStoryBanner.

**Тесты:** 186/186 passed (dashboard 76 + operations 110). Frontend typecheck чисто.

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — **нет новых ENV**. Все сервисы используют существующие настройки (Redis, Prisma).
- **Шаг 4 — Prisma** — **обязательно** перед запуском backend:
  ```bash
  docker compose exec backend bun run prisma:push
  docker compose exec backend bun run prisma:generate
  ```
  Добавляет в `Decision` два поля: `raisedCount Int @default(1)` и `lastRaisedAt DateTime?`. Существующие строки получат `raisedCount=1`, `lastRaisedAt=null`. Никакого data-loss, безопасно.
- **Шаги 6-10 — Patches/Seeds/Backfill/Migrations/Setup** — **без изменений**. Backfill для `Decision.raisedCount` не нужен (default=1 покрывает существующие). Для `lastRaisedAt` — null допустим, заполнится при следующем specialist-3-3 merge.
- **Шаг 11 — Docker image rebuild** — **обязателен** (новые backend-модули и frontend-страницы).
- **Шаг 12 — Smoke**:
  ```bash
  # 1. KPI Hero endpoints доступны (требует cookie owner/admin Org):
  curl -i -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/dashboard/director?period=week
  # Ожидаемо: 200 с полями kpiSentimentIndex, kpiCommitmentReliability, kpiHangingDecisions, isEmpty
  # На empty tenant: isEmpty=true + синтетический sample-story dataset

  # 2. Новый team-health endpoint:
  curl -i -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/dashboard/team-health
  # Ожидаемо: 200 { teams: [...], totalDepartments: N }

  # 3. Новый team-detail endpoint (404 для несуществующего отдела):
  curl -i -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/dashboard/teams/<deptId>
  # Ожидаемо: 200 c TeamDetailDto / 404 department_not_found

  # 4. Operations missing-checkins (today default):
  curl -i -H 'Cookie: <auth>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/dashboard/operations/missing-checkins
  # Ожидаемо: 200 { date, totalEmployees, missing: [...] }

  # 5. Frontend страницы:
  # /dashboard — новые KpiHero (3 шт), AI narrative с цитатами [1][2], TeamHealthGrid, ActivityFeedWidget
  # /teams — список команд с сортировкой
  # /teams/<deptId> — детальная карточка команды
  # /dashboard/operations — heatmap + missing-checkins + stale-issues + probe widget
  # /dashboard/operations/daily — 4 новых секции (eventsToday/urgentItems/whoShined/whoStruggled)
  # /dashboard/operations/weekly — 3 новых секции (kpiDeltas/teamDynamics/forecast)
  ```
- **Откат:** Никакого ENV-флага нет (все фичи активны по умолчанию). Для отката — `git revert 0f0bf03 801ba61` + redeploy. Schema-добавления Decision не требуют отката — поля nullable/defaulted, не блокируют старый код.

---

### 🧬 2026-05-30 — Agents v2 Phase C2 (GEPA prompt evolution)

План: [plans/tz/2026-05-29-agents-v2-umbrella.md](../../plans/tz/2026-05-29-agents-v2-umbrella.md) §C2.

**Краткое содержание:**
- Новая Prisma модель `PromptCandidate` + enum `CandidateStatus` + back-relation в `Org`.
- В `LlmTaskRoute` добавлены 2 поля: `evolutionEnabled Boolean @default(true)`, `promptOverride String?`.
- **(ревизия 2026-06-02)** GEPA вынесен в **отдельный контейнер `z-gepa`** — HTTP-сервис на FastAPI (`backend/python/gepa/server.py` + `backend/python/Dockerfile`, base `python:3.11-slim`). Backend больше НЕ спавнит Python: `GepaRunnerService` ходит по `POST {GEPA_SERVICE_URL}/optimize`. Из `backend/Dockerfile` убраны `python3 py3-pip` и `pip install gepa` → образ backend легче. `requirements.txt`: gepa, dspy-ai, requests, tiktoken + fastapi, uvicorn.
- 3 cron'a в `prompt-evolution` модуле: `GepaOptimizeCron` (Sun 04:00), `GepaPromoteCron` (Sun 05:00), `GepaAbMonitorCron` (каждые 15 мин).
- `LlmRouterService` теперь подхватывает `PromptCandidate(status='testing')` через минутный refresh кэша; на каждый `call()` deterministic-hash A/B sampling → подменяет systemPrompt + помечает `AiUsageLog.experimentGroup='gepa_candidate'`.
- 4 admin REST-эндпоинта в `/api/v1/admin/prompt-evolution/`: `GET candidates`, `PATCH candidates/:id/reject`, `POST rollback/:promptKey`, `PATCH lock/:promptKey`.
- 7 новых метрик: `z_gepa_optimizations_total`, `z_gepa_candidates_total`, `z_gepa_promoted_total`, `z_gepa_rejected_total`, `z_gepa_ab_active_total`, `z_gepa_cost_usd_total`, `z_gepa_rollback_total`.

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — **10 новых опциональных**, все безопасные дефолты, мастер-флаг `PROMPT_EVOLUTION_ENABLED=false`. Включать ПОСЛЕ ручной валидации Python subprocess в staging:
  - `PROMPT_EVOLUTION_ENABLED=false` — мастер-флаг 3 cron'ов GEPA.
  - `GEPA_MAX_METRIC_CALLS=150` — лимит rollouts (~$15 за прогон).
  - `GEPA_REFLECTION_LM=deepseek-v4-pro` / `GEPA_TASK_LM=deepseek-v4-pro` — модели Python-runner'а.
  - `GEPA_AB_TRAFFIC_SHARE=0.1` — 10% трафика на candidate.
  - `GEPA_AB_MIN_INVOCATIONS_BEFORE_DECISION=100` — минимум B-вызовов для promote.
  - `GEPA_AB_PROMOTE_THRESHOLD=0.05` / `GEPA_AB_REJECT_THRESHOLD=0.10` — пороги composite score.
  - `GEPA_SERVICE_URL=http://gepa:8000` — base URL gepa-сервиса (контейнер `z-gepa`, DNS внутри `z-internal`). Заменил `GEPA_PYTHON_PATH` (ревизия 2026-06-02). На dev — `http://127.0.0.1:58000`.
  - `GEPA_TIMEOUT_MS=3600000` — hard-timeout HTTP-вызова /optimize (1ч).
  - **Важно:** gepa-контейнер получает `.env` целиком (`env_file: [.env]`) — нужны те же LLM-креды (litellm/deepseek), что раньше наследовал subprocess.
- **Шаг 4 — Prisma** — безопасное добавление: новая модель `PromptCandidate` + 2 nullable/defaulted поля в `LlmTaskRoute`. Применить через `docker compose exec backend bun run prisma:push`.
- **Шаг 11 — Docker image rebuild** — **обязателен новый сервис `gepa`**: `docker compose build backend gepa && docker compose up -d`. Образ backend стал легче (без Python). Если `gepa` не поднят — GEPA-cron'ы пропускают optimization (status=`skipped_no_python`) — безопасный no-op.
- **Шаг 12 — Smoke**:
  ```bash
  # 1. gepa-контейнер жив (health + version):
  docker compose exec backend wget -qO- http://gepa:8000/health    # {"status":"ok"}
  docker compose exec backend wget -qO- http://gepa:8000/version   # {"runner":"gepa-runner",...}

  # 2. Метрики GEPA появляются после первого optimize-cron (Sun 04:00 + при PROMPT_EVOLUTION_ENABLED=true):
  curl -s https://prod.host/metrics | grep -E 'z_gepa_(optimizations|candidates|promoted|rejected|ab_active|cost_usd|rollback)_total'
  # Help-комментарии видны сразу; серии — после первого прогона.

  # 3. Admin REST: список кандидатов (требует cookie Org-admin'а):
  curl -i -H 'Cookie: <auth>' https://prod.host/api/v1/admin/prompt-evolution/candidates
  # Ожидаемо: 200 { items: [], total: 0, page: 1, limit: 50 } до первого optimize-cron.
  ```
- **Откат:** установить `PROMPT_EVOLUTION_ENABLED=false` → restart backend. Cron'ы no-op, существующие `PromptCandidate(status='testing')` ничего не сломают (LlmRouter перестанет их подхватывать). Для полного rollback `promoted` промпта: `POST /api/v1/admin/prompt-evolution/rollback/:promptKey`.

---

### 📦 2026-05-30 — Commercial-reliability pack (4 фазы)

План: [plans/tz/2026-05-29-commercial-reliability-package.md](../../plans/tz/2026-05-29-commercial-reliability-package.md).
Коммиты: `7cacf5f` (Фаза 1), `e452aa0` (Фаза 2), `acc5477` (Фаза 3), `cf5adfe` (Фаза 4).

**Краткое содержание:**
- Фаза 1: `ConversationalFreeNoteBridge` — Telegram free-note теперь попадает в граф знаний (раньше терялся в DEBUG-логе).
- Фаза 2: first-touch атрибуция — `AttributionService.attributeOrg` через `updateMany WHERE pendingAttributionSlug IS NULL`; раньше last-touch.
- Фаза 3: Zoom-rename — `PATCH /api/v1/meetings/:id/participants/:pid` + inline-edit в UI результата встречи.
- Фаза 4: 11 счётчиков + 1 гистограмма + 3 алёрта + Grafana-дашборд для биллинга и рефералов.

**Шаги прод-инструкции:**
- **Шаг 1 — ENV** — без изменений.
- **Шаг 4 — Prisma** — без изменений (schema.prisma не трогалась).
- **Шаг 6/7/8/9/10 — Patches/Seeds/Backfill/Migrations/Setup** — без изменений.
- **Шаг 11 — Prometheus rules + Grafana dashboards** — **2 новых файла**, подцепятся автоматически при перезагрузке Prometheus и Grafana provisioner:
  - `infra/prometheus/alerts/billing-referrals.rules.yml` — 3 алёрта (`BillingNoPaymentsLong`, `BillingWebhookSignatureFailures`, `ReferralPayoutCronDidNotRun`). Прометей мониторит `/etc/prometheus/alerts/*.yml`, перезагрузка через `docker compose exec prometheus kill -HUP 1` или `curl -X POST http://prometheus:9090/-/reload`.
  - `infra/grafana/dashboards/billing-referrals.json` — 4 панели (биллинг сегодня, webhook здоровье, реф-воронка, latency банка). Подцепится автоматически provisioner'ом если он наблюдает за `infra/grafana/dashboards/`.
- **Шаг 12 — Smoke**:
  ```bash
  # Метрики появляются после первого вызова (Counter с labels) или сразу (Counter без labels):
  curl https://prod.host/metrics | grep -E 'billing_invoice_paid_total|billing_subscription_renewed_total|referral_click_total|referral_signup_total|referral_payout_created_total|referral_payout_amount_rub_total|referral_attribution_first_touch_locked_total|participant_renamed_total|billing_provider_request_duration_seconds'
  # Должны увидеть help-комментарии + типы. После реальной оплаты появятся серии с лейблами.

  # Endpoint Zoom-rename доступен (host-only):
  curl -i -X PATCH https://prod.host/api/v1/meetings/<id>/participants/<pid> \
       -H 'Content-Type: application/json' \
       -d '{"name":"Иван Петров"}'
  # Ожидаемо: 401 без cookie / 403 'not_authorized' если не хост / 403 'participant_rename_forbidden' если isRegisteredUser=true / 404 'participant_not_found' / 200 + {id, name}.
  ```
  В Swagger под тегом **meetings** должен появиться `PATCH /api/v1/meetings/:id/participants/:pid` (UpdateParticipantSchema).
- **Шаг 12 — Smoke (free_note)**: отправить Telegram-боту короткое сообщение «тест заметки» → проверить что появился `RawEvent(sourceType='conversational')`:
  ```bash
  docker compose exec backend bun -e '
  import { createPrismaClient } from "./scripts/_lib/prisma";
  const p = createPrismaClient();
  p.rawEvent.findMany({
    where: { sourceType: "conversational" },
    orderBy: { createdAt: "desc" },
    take: 5,
  }).then(r => { console.log(JSON.stringify(r.map(e => ({id: e.id, occurredAt: e.occurredAt})), null, 2)); process.exit(0) })
  '
  ```

**Откатить нельзя** (точечные баг-фиксы, без миграций). При проблеме — отдельный hotfix.

---

### 🛡 2026-05-29 — Audit-fixes (Б1-Б15, В1-В17, С1-С31) + Admin Subscription UI v2

Ветка `fix/audit-2026-05-29`, **66 коммитов**. Включает 30 `fix(audit)` (15 блокеров + 15 high-risk), 24 `fix(audit) С*` (medium), 4 `feat(admin-sub-ui)` (фронт-табы Подписка/Биллинг), 6 `fix(tests)` (моки после смен логики). `typecheck`/`lint`/`test:unit` — зелёные на backend и frontend.

**Краткое содержание (фактически опасное идёт в Шаги ниже):**
- Auth: единый argon2id-hash в инвайтах (Б1), глобальный `MustChangePasswordGuard` (Б2), 120 бит энтропии в tempPassword.
- Billing: webhook-replay защита (Б4 — `maxAge:5m` + `jti @unique` + JWK TTL), AES-256-GCM на OAuth-токены Точки (Б5), уникальность по `(providerName, externalEventId)` и `triggerInvoiceId` (Б7), customerCode-сверка вебхука (В3), recurring создаёт Invoice ДО charge (Б15), `Promise.race` 30с timeout LLM-router (С30), BullMQ для referral-payout (С4), `billing_emit_failed_total` метрика (С3).
- Demo: precondition + `externalSource='demo'` фильтр + tx во всех `deleteMany` resetDemoWorkspace (Б3).
- Referrals: self-referral блок + INN-mismatch (Б6), composite-unique для public-attribution (Б8), TenantGuard на `attribute-current-org` (Б14), fingerprint min(32) (С5).
- Tracker: race-fix в подзадачах через `pg_advisory_xact_lock` + lock-ordering (Б9), per-tenant cap=5 в sprint-helper cron (Б10), `deletedAt:null` в `requireItem` (Б11), reorder под FOR UPDATE (В11), WS-RBAC `subscribe.project/issue` (В12), cycle-check + cascading soft-delete документов (С19+С20), recountCounters в tx с advisory-lock (С16), `complete` идемпотентность под advisory-lock (С18), pg_trgm index на `Cycle.name` (С17).
- Clones/RBAC: privacy для history клон-conversations после revoke (Б13), re-grant через UPDATE (В15), `assertCloneRefExists` после RBAC (В14), defense-in-depth tenantId-проверка в `canAccess*Clone` (С14), POST `/clones/:type/:id/access-grants/request` (В17), Role.created hook → grants owner'ам (С25).
- Misc: маскировка PII в логах (С1, С2), retry P2002 на placeholder email (С9), Telegram-proxy ping-timeout ENV (С28).
- **Frontend admin v2:** карточка Org теперь содержит **два таба** «Тариф и лимиты» (entitlements) и «Подписка и счета» (subscription + invoices + events). Старые `/admin/orgs/[id]/billing` и `/subscription` редиректят на `?tab=*`. В таблице инвойсов — кнопки `mark-paid` (для `issued`) и `void` (для `draft|issued`). Новые диалоги: `AdjustSeatsDialog`, `ForceStatusDialog` (с чекбоксом «обхожу FSM»), `SubscriptionEventsTimeline` (последние 100). Бэк не трогали — все методы `billingApi` уже были. В левом меню — пункт «Биллинг — обзор».

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — **2 новых опциональных**, дефолты безопасные, можно не выставлять:
  - `LLM_ROUTER_DISPATCH_TIMEOUT_MS=30000` (С30) — global timeout на dispatch модели.
  - `TELEGRAM_PROXY_PING_TIMEOUT_SEC=5` (С28) — timeout для health-cron ping'а.
- **Шаг 4 — Prisma (опасные изменения)** — **новые `@unique`/composite, требуют dedupe ДО `prisma db push`**:
  - `BillingEventLog.jti String? @unique` (Б4).
  - `BillingEventLog @@unique([providerName, externalEventId])` (Б7).
  - `ReferralPayout.triggerInvoiceId @unique` (Б7).
  - `ReferralAttribution.dateBucket String? VARCHAR(10)` + `@@unique([referralId, fingerprint, dateBucket])` (Б8).
  - Порядок: **сначала Шаг 6 (patch-dedupe-*)**, потом `docker compose exec backend bun run prisma:push`.
- **Шаг 5 — Postgres init (нативный SQL)** — **1 новое**:
  - `CREATE EXTENSION IF NOT EXISTS pg_trgm` + `CREATE INDEX Cycle_name_trgm_idx ON "Cycle" USING gin (name gin_trgm_ops)` — для substring-поиска спринтов (С17). Команда: `docker compose exec backend bun run apply-postgres-init`.
- **Шаг 6 — Patches** — **7 новых, все идемпотентные**, все зарегистрированы в `apply-prod-deploy.ts` STEPS (`phase: 'patch'`, `skipBootstrap: true` — на чистой БД нечего бэкфилить):
  - `patch-rehash-pending-invitations.ts` — sha256→argon2id для `OrgInvitation.tempPasswordHash` с `acceptedAt=NULL` (Б1). После него existing инвайты заработают.
  - `patch-mark-demo-data.ts` — backfill `externalSource='demo'` для existing demo-Org (Б3). Обязательно ПЕРЕД prod-выкатом фикса reset.
  - `patch-encrypt-tochka-oauth.ts` — AES-256-GCM на plain OAuth-токены Точки (Б5). Безопасно поверх уже шифрованных (skip если уже `enc:`).
  - `patch-dedupe-billing-event-log.ts` (Б7) — **запустить до `prisma:push`**. Поддерживает `--dry-run`.
  - `patch-dedupe-referral-payout.ts` (Б7) — **запустить до `prisma:push`**. Поддерживает `--dry-run`. Приоритет `paid > pending`, void-ит pending дубли с reason.
  - `patch-backfill-referral-attribution-date-bucket.ts` (Б8) — **запустить до `prisma:push`** composite unique. Идемпотентен.
  - `patch-audit-user-email-conflicts.ts` (С31) — **dry-run only**, печатает SQL-инструкции при обнаружении дублей email или несогласованности pwd-хешей; не правит автоматически. `skipBootstrap+skipUpdate` (вне агрегатора, запускать руками).
  - **Incident-only (не в агрегаторе):** `patch-rollback-to-deepseek-flash.ts --update-existing` — откат LLM-миграции при инциденте, новый флаг `--include-feature-flagged` для clone-respond-v2/specialists-combined (С29).
- **Шаг 12 — Smoke** (curl/UI):
  - **Auth:** `POST /api/v1/orgs/:id/invitations` → инвайт-email; вход по `/login` с tempPassword из письма → 200 + `mustChangePassword:true`; `curl /api/v1/meetings` → 403 `must_change_password`; `POST /me/change-password` → новая cookie; `curl /api/v1/meetings` → 200.
  - **Demo reset:** `POST /api/v1/admin/demo/orgs/:id/reset` на Org без `demoSeededAt` → 400 `no_demo_to_reset`.
  - **Tochka webhook replay:** повторный JWT с тем же `jti` → 409 `replay_detected`.
  - **Billing double-pay:** одновременно два webhook с одним `externalEventId` → один Invoice paid, `totalPaidKopecks` не удвоился.
  - **Referral self-ref:** signup со своим slug → `attribute-current-org` отвергает с 403 `self_referral_denied`.
  - **WS RBAC:** `socket.emit('subscribe.project', {projectId: 'чужой'})` → reject `access_denied`.
  - **Sprint search (pg_trgm):** `POST /api/v1/sprints/search?q=Q3` для близкого имени цикла — возвращает hit.
  - **Admin UI subscription tab:**
    - `/admin/orgs/[id]` → видны два таба «Тариф и лимиты» и «Подписка и счета».
    - В `?tab=subscription` для `issued` Invoice — кнопка «Отметить оплаченным» (с обязательным `externalRef`); для `paid`/`bonus` — кнопки не видны.
    - `AdjustSeatsDialog` показывает pro-rata подсказку (monthly: `daysLeft/30`, yearly: `monthsLeft*0.8`).
    - `ForceStatusDialog` submit disabled пока не отмечен чекбокс «обхожу FSM» И `reason ≥ 3`.
    - `SubscriptionEventsTimeline` показывает последние 100 событий с цветными бейджами.
  - **`/admin/billing-overview`** доступен по ссылке из левого меню «Биллинг — обзор».
  - **Redirects:** `/admin/orgs/[id]/billing` → 307 на `?tab=billing`. То же для `/subscription`.

---

### 🆕 2026-05-29 — единый логин `/login` + демо-кабинеты из админки

Чистые code-изменения: **ENV нет, schema нет, seed/patch/backfill нет.** Достаточно `docker compose up -d --build` (backend + frontend).

- **Единый логин:** новый `POST /api/v1/auth/login` (try standalone→admin). Старые `/accounts/login` и `/auth/admin-login` живы (deprecated). Фронт `/login` — единая форма, `/admin/login` редиректит на `/login`.
- **Демо из админки:** `GET/POST /api/v1/admin/demo/*` (super_admin), страница `/admin/demo`. Переиспользует `OnboardingService` — ничего нового в БД.
- **Шаг 12 — smoke** (эндпоинты `@ApiExcludeController`, в Swagger их нет — проверять curl'ом):
  - `POST /api/v1/auth/login` обычным юзером → 200 + cookie; супер-админом → 200 + `isSuperAdmin:true`; неверный пароль → единый `login_invalid`.
  - вход супер-админа через `/login` → доступен `/admin`.
  - `/admin/demo` (super_admin) → список Org; «Создать демо» на тестовой Org → ~4600 записей; «Сбросить» → чисто.

---

### 🔒 ТЗ 2026-05-28 — paywall без trial (Фазы 1–5)

Ветка: `dev`. Коммиты `fcde0aa..этот-commit`. Backend SubscriptionGuard + декораторы `@RequireSubscription` на ~141 мутирующем эндпоинте, frontend Paywall UI (Banner/Modal/SubscriptionContext) + страница `/settings/subscription` для DEMO/ACTIVE/BLOCKED, скрипт backfill для существующих Org.

- **Шаг 1 — ENV** — без изменений. Paywall работает на существующих ENV биллинга (`BILLING_PROVIDER`, `BILLING_PUBLIC_API_URL`).
- **Шаг 4 — Prisma** — без изменений. Используется существующая модель `Subscription` + enum `SubscriptionStatus`.
- **Шаг 8 — Backfill** — 1 новый: `backfill-demo-subscriptions.ts`. Для каждой Org без записи `Subscription` создаёт `Subscription{status=DEMO}` + `SubscriptionEvent{CREATED}`. Идемпотентен (skip существующих). Через apply-prod-deploy агрегатор автоматически.
- **Шаг 12 — Smoke** — проверить:
  - `POST /api/v1/projects` от DEMO-юзера → 403 с телом `{error: {code: 'subscription_required', currentStatus: 'DEMO', price: 60000}}`.
  - `GET /api/v1/projects` от DEMO-юзера → 200 (read-only пропускается).
  - `POST /api/v1/billing/pay/card` от DEMO-юзера → пропущен guard'ом (path bypass), доходит до контроллера.
  - `POST /api/v1/projects` от ACTIVE-юзера → 201.
  - Frontend `/settings/subscription` для DEMO → DemoHero + slider 31..100 + расчёт через Quote API.

---

### 💳 ТЗ 2026-05-27 — billing/tochka/referrals/dadata (новый блок)

Ветка: `feature/billing-tochka-referral-dadata`. 8 коммитов (52cde75..4416801). Введены 5 новых модулей backend: `billing`, `inn-lookup`, `meetings-balance`, `referrals` + интеграция в `entitlements`/`meetings`/`quotas`. **Frontend ещё не сделан** (Фаза 9 ТЗ §14) — поэтому новые эндпоинты пока доступны только через Swagger `/api/docs`.

**Кратко по шагам прод-инструкции (полные команды — в соответствующих секциях ниже):**

- **Шаг 1 — ENV** — 36 новых переменных. Все опциональные с дефолтами; backend стартует без них. На MVP минимум: `BILLING_PROVIDER=manual` (default), оставить feature-flags `false`. Реальные значения для Tochka — после регистрации app в кабинете Точки.
- **Шаг 4 — Prisma** — auto через `migrate`-сервис. 10 новых моделей: `Subscription`, `SubscriptionEvent`, `Invoice`, `BillingEventLog`, `BillingProviderConfig`, `MeetingsBalance`, `Referral`, `ReferralAttribution`, `ClientReferralLink`, `ReferralPayout`. 7 новых enum.
- **Шаг 6 — Patch** — 1 новый: `migrate-entitlements-to-standard.ts` (legacy `tier_basic/pro/enterprise` → `tier_standard`). Идемпотентный.
- **Шаг 7 — Seed** — ничего не нужно (плановых seed'ов в фазах нет).
- **Шаг 8 — Backfill** — 1 новый: `backfill-meetings-balance.ts` (стартовый `MeetingsBalance(balance=150)` для всех existing Org).
- **Шаг 10 — Per-tenant: Tochka OAuth** — отдельная операция владельца (не код). См. ниже «Tochka подключение в production».
- **Шаг 12 — Smoke** — проверить:
  - `GET /api/v1/billing/subscription` отдаёт null для свежей Org с DEMO,
  - `GET /api/v1/billing/meetings-balance` отдаёт balance после backfill,
  - `GET /api/v1/internal/billing/provider-events` отдаёт `{ok:true}` (webhook probe),
  - `POST /api/v1/admin/orgs/:tenantId/billing/activate {paymentMode:'bonus',...}` создаёт Subscription+Invoice+SubscriptionEvent+AdminAuditLog + грантует 150 встреч.

#### Tochka подключение в production

Делается **один раз** при первом включении реального провайдера Tochka:

1. Зарегистрировать приложение в кабинете Точки → получить `client_id`/`client_secret`.
2. Прописать в `.env`:
   ```bash
   BILLING_PROVIDER=tochka
   FEATURE_BILLING_TOCHKA=true
   FEATURE_BILLING_CARD_RECURRING=true     # вкл. оплату картой через рекуррент
   FEATURE_BILLING_BANK_INVOICE=true       # вкл. безналичный счёт
   TOCHKA_MODE=production
   TOCHKA_CUSTOMER_CODE=<выдан Точкой>
   TOCHKA_ACCOUNT_ID=<счёт/БИК>
   TOCHKA_CLIENT_ID=<выдан Точкой>
   TOCHKA_CLIENT_SECRET=<секрет>
   TOCHKA_REDIRECT_URI=https://api.kora.app/api/v1/internal/billing/tochka/oauth/callback
   TOCHKA_WEBHOOK_URL=https://api.kora.app/api/v1/internal/billing/provider-events
   TOCHKA_WEBHOOK_AUTO_REGISTER=true
   BILLING_PUBLIC_API_URL=https://api.kora.app
   BILLING_LEGAL_ENTITY_NAME=<ООО/ИП>
   BILLING_LEGAL_ENTITY_INN=<наш ИНН>
   BILLING_LEGAL_ENTITY_KPP=<наш КПП>
   BILLING_LEGAL_ENTITY_ADDRESS=<юр.адрес>
   BILLING_LEGAL_ENTITY_BIK=<БИК>
   BILLING_LEGAL_ENTITY_ACCOUNT=<р/с>
   # DaData (для inn-lookup fallback)
   DADATA_API_KEY=<токен dadata>
   INN_LOOKUP_PROVIDER=tochka_then_dadata
   ```
   `docker compose up -d --force-recreate backend`
3. Открыть backend-логи: `docker compose logs -f backend | grep "TOCHKA OAuth"`
   → увидеть строку `откройте URL в браузере: https://enter.tochka.com/connect/authorize?...`
   → открыть URL в браузере, авторизоваться в кабинете Точки → callback придёт на `/internal/billing/tochka/oauth/callback`.
4. Альтернатива через admin-API (если super_admin уже залогинен):
   ```bash
   curl -s https://api.kora.app/api/v1/admin/billing/tochka/oauth/authorize-url \
     -H "Cookie: <session>" -H "X-Org-Id: <org>"
   # → {url:"https://enter.tochka.com/connect/authorize?..."}
   # Открыть url в браузере. После callback'а проверить:
   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -c "SELECT key, jsonb_pretty(value_json::jsonb) FROM billing_provider_config;"
   # Должна быть запись 'tochka.production.oauth_tokens' с accessToken и refreshToken.
   ```
5. Webhook регистрируется автоматически при старте backend через 1.5с (если `TOCHKA_WEBHOOK_AUTO_REGISTER=true`).
6. Канарейка: на тестовой Org → `POST /api/v1/billing/pay/card` с `billingPeriod=monthly, seatsExtra=0` → 1 ₽ (потребуется снижение `BASE_MONTHLY_PRICE_KOPECKS` в коде для канарейки, либо использовать stage-окружение).

#### Реферальная программа — что проверить

После выката `referrals` модуль работает автоматически:
- Лендинг должен бить `POST /api/v1/public/referrals/attribution {slug, fingerprint?, referer?}` (throttle 10/min/IP) когда юзер заходит по `?ref=<slug>`.
- Фронт после signup зовёт `POST /api/v1/referrals/attribute-current-org` с заголовками `X-Z-Ref` (из cookie) и `X-Z-Fingerprint`.
- Cron `0 10 10 * *` Europe/Moscow закрывает прошлый месяц — на проде убедиться что `@nestjs/schedule` поднимает его.
- Партнёру нужно: `POST /referrals/me` (создать профиль), `POST /referrals/me/verify-inn`, `POST /referrals/me/accept-contract` — без этого cron 10-го числа переведёт payout в `void`.

---

## 🚀 Полный чек-лист обновления (Сценарий A: данные сохраняем)

> Стандартный workflow обновления работающего прода. Если БД жалко потерять — это твой путь.

```bash
# ─── 1. SSH на сервер + в директорию проекта ───────────────────────
ssh root@prod
cd /home/docker/z
set -a && source .env && set +a              # подтянуть POSTGRES_USER/DB в shell

# ─── 2. БЭКАП БД ────────────────────────────────────────────────────
mkdir -p backups && \
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "backups/z_main_$(date +%F-%H%M).dump" && \
ls -lh backups/ | tail -3
# Размер должен быть > 0 байт. Сохрани файл — нужен для отката.

# ─── 3. Pull кода ──────────────────────────────────────────────────
git pull origin dev
git log -1 --oneline                          # увидь последний коммит

# ─── 4. Sanity-check lockfile ──────────────────────────────────────
grep -c npmmirror backend/bun.lock frontend/bun.lock   # должно быть 0 и 0

# ─── 5. .env — проверить новые ENV ─────────────────────────────────
# Открой .env и сверься с разделом «Шаг 1 — ENV» ниже.
# Если добавлял новые NEXT_PUBLIC_* — нужна пересборка frontend в Шаге 9.
nano .env
set -a && source .env && set +a

# ─── 6. GATE — защитный backfill ДО migrate ────────────────────────
# Только если у тебя legacy Meeting с tenantId=NULL (есть до этого выката).
# postgres уже up с прошлого деплоя — `run --rm` стартует одноразовый контейнер.
docker compose run --rm backend bun run scripts/backfill-orgs-fase0.ts
docker compose run --rm backend bun run scripts/backfill-meeting-tenant-id.ts --apply
docker compose run --rm backend bun run scripts/tighten-meeting-tenant-not-null.ts
# Последняя команда: exit 0 = можно идти дальше, exit 1 = STOP, разбирайся.

# ─── 7. Build + up (миграция автоматически через migrate-сервис) ───
docker compose build                          # 5-15 минут на холодную, 1 на инкремент
docker compose up -d --build                  # postgres + redis + migrate (one-shot) + backend + frontend

# Дождаться миграции:
docker compose logs -f migrate
# Жди: "✓ postgres-init.sql выполнен" + "=== apply-postgres-init DONE ===", Ctrl+C
docker compose ps                             # все 4 контейнера healthy

# ─── 8. Подхват новых ENV / NEXT_PUBLIC_* ──────────────────────────
# Если правил .env (Шаг 5):
docker compose up -d --force-recreate backend
# Если правил NEXT_PUBLIC_*:
docker compose up -d --build frontend

# ─── 9. ОДНА КОМАНДА: применить patch + seed + backfill + migrate ──
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update --continue-on-fail
# В конце: "=== SUMMARY === Всего: NN, OK: M, FAIL: K"
# Если есть FAIL — посмотри список упавших, разбирайся индивидуально.

# ─── 10. Per-tenant setup (опц., только если меняются токены/URL) ──
# Telegram (глобальный, БЕЗ --tenant-id):
docker compose exec backend bun run setup:telegram-bot \
  -- --token=$TG_TOKEN --public-host-url=https://api.prod.host --webhook-secret=<секрет>

# ─── 11. Включение CLONE_V2_ENABLED (только если бизнес-готово) ────
# Убедись что в /admin/clones корректно отображаются гранты после
# patch-migrate-clone-access (он внутри агрегатора). Только тогда:
# В .env: CLONE_V2_ENABLED=true
# Подхват:
# docker compose up -d --force-recreate backend

# ─── 12. nginx (только если меняешь BACKEND_HOST_PORT/FRONTEND_HOST_PORT) ─
# sudo nginx -t && sudo systemctl reload nginx

# ─── 13. Smoke ─────────────────────────────────────────────────────
curl https://api.prod.host/health
curl https://api.prod.host/health/ready       # пара post/redis/livekit = ok
curl -s https://api.prod.host/api/docs > /dev/null && echo "Swagger OK"
curl -s https://api.prod.host/metrics | grep -E 'bullmq_(probe|conversational|chat-v2|knowledge-clone|skill|tracker)' | head
```

**Если что-то пошло не так — см. [🆘 Troubleshooting](#-troubleshooting) внизу.**

---

## 🆕 Полный чек-лист для чистого старта (Сценарий B: данные сносим)

> Beta/staging, или прод где volume PG несовместим с composite-образом. **Все данные пользователей будут потеряны.**

```bash
ssh root@prod
cd /home/docker/z
set -a && source .env && set +a

# ─── 1. (опц.) Бэкап перед wipe — на случай если передумаешь ──────
mkdir -p backups && \
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "backups/z_main_before_wipe_$(date +%F-%H%M).dump" 2>/dev/null || echo "БД уже сломана — пропускаем бэкап"

# ─── 2. WIPE: down -v снесёт volumes (БД + redis-AOF) ─────────────
docker compose down -v --remove-orphans
docker volume ls | grep z_                    # должно быть пусто

# ─── 3. Pull + проверка lockfile + .env ────────────────────────────
git pull origin dev
grep -c npmmirror backend/bun.lock frontend/bun.lock     # 0 и 0
# Минимальный .env (см. ниже «Шаг 1 — ENV»):
nano .env
set -a && source .env && set +a

# ─── 4. Build + up (на чистой БД gate не нужен) ────────────────────
docker compose build
docker compose up -d
docker compose logs -f migrate                # жди "DONE", Ctrl+C
docker compose ps                             # все healthy

# ─── 5. Проверка composite-образа postgres + расширений ───────────
docker compose ps postgres                    # IMAGE: z-postgres-age-pgvector:pg16
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT extname, extversion FROM pg_extension WHERE extname IN ('age','vector');"
# Должно вернуть 2 строки

# ─── 6. ОДНА КОМАНДА: bootstrap super-admin + все seed'ы ──────────
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode bootstrap --continue-on-fail
# Минует patch/backfill/migrate (на пустой БД нечего бэкфилить).

# ─── 7. Setup ботов + smoke ────────────────────────────────────────
docker compose exec backend bun run setup:telegram-bot \
  -- --token=$TG_TOKEN --public-host-url=https://api.prod.host --webhook-secret=<секрет>

curl https://api.prod.host/health
curl https://api.prod.host/health/ready
```

---

## 🚀 TL;DR — что делает агрегатор

`backend/scripts/apply-prod-deploy.ts` — единая точка для всех ~80 prod-операций:

```bash
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode bootstrap   # чистый старт
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update      # обновление
docker compose exec backend bun run scripts/apply-prod-deploy.ts                    # all (default)

# Полезные флаги:
#   --dry-run            показать что будет запущено, не выполнять
#   --continue-on-fail   продолжать после ошибки скрипта (default: stop)
```

В конце: `=== SUMMARY === Всего: NN, OK: M, FAIL: K` + список упавших. Если есть FAIL — `exit 1`.

> При добавлении нового `seed-*` / `patch-*` / `backfill-*` / `migrate-*` скрипта **обязательно** допиши его в массив `STEPS` в `backend/scripts/apply-prod-deploy.ts` — иначе на проде он не запустится.
>
> ⚠️ **Скрипт, который бутает `NestFactory.createApplicationContext(AppModule)`, ОБЯЗАН завершаться `process.exit(0)` на успехе** (`main().then(() => process.exit(0)).catch(...)`). Иначе после `app.close()` blocking-соединения BullMQ-воркеров уходят в reconnect-шторм (`ioredis: Connection is closed`), процесс не завершается, и аггрегатор виснет на `await proc.exited`. Грабля 2026-05-29 — подвисли `seed-global-channels`, `patch-backfill-dataclass-audit`, `skill-trait-concepts-backfill`, `person-knowledge-embeddings-backfill`.

---

## Два сценария выката

| Сценарий | Когда | Куда смотреть |
|---|---|---|
| **A. Обновление (данные сохраняем)** | Стандартный workflow: prod уже работает, данные пользователей важны | Шаги 0..12 ниже (с GATE-backfill'ами и patch/migrate-скриптами для legacy) |
| **B. Чистый выкат с нуля (wipe & fresh)** | Beta/staging без важных данных; или postgres-volume несовместим с новым образом (например, был pg17 → стал composite pg16) | См. [📦 Сценарий B: Чистый выкат с нуля](#-сценарий-b-чистый-выкат-с-нуля) ниже. **Минует patch/backfill/migrate — на пустой БД они не нужны.** |

⚠️ Если `docker compose up` падает с ошибкой про `database files are incompatible with server` или `migrate` exit 1 на CREATE EXTENSION — у тебя НЕ composite postgres-образ запущен (или volume старого PG). Перейди в [Сценарий B](#-сценарий-b-чистый-выкат-с-нуля).

---

### Шаг 0 — Pre-flight (один раз перед выкатом)

**0.1. Apache AGE в postgres-образе.**
`migrate`-сервис compose выполняет `bunx prisma db push && bun scripts/apply-postgres-init.ts`. Последний создаёт `CREATE EXTENSION age` и `ag_catalog.create_graph('z_graph')` для онтологии (Фаза 0).

В `docker-compose.yml` (корневой) postgres-сервис собирается из `infra/postgres/Dockerfile` — composite-образ `z-postgres-age-pgvector:pg16` с уже включёнными `age 1.5+`, `pgvector 0.8+` и `shared_preload_libraries = 'age'`. Ничего отдельно настраивать не нужно — образ соберётся при первом `docker compose build`.

Если у тебя на проде **managed Postgres** (Yandex / Selectel) вместо composite-образа:
- В настройках кластера прописать `shared_preload_libraries = 'age'` → рестарт инстанса.
- Проверить:
  ```bash
  docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SHOW shared_preload_libraries;"
  ```

См. `second-brain/02_architecture/age-deployment-decision.md`.

**0.2. Бэкап БД.** Обязательно перед `prisma:push` (Шаг 4) и `patch-*` (Шаг 6).

```bash
# Одной командой — mkdir + pg_dump (директория backups/ может ещё не существовать на свежем сервере):
mkdir -p backups && docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "backups/z_main_$(date +%F-%H%M).dump" && ls -lh backups/ | tail -3
```

> ⚠ `$POSTGRES_USER` и `$POSTGRES_DB` берутся из shell-окружения хоста. Если они не экспортированы — подставь явные значения (`-U z_app -d z_main`) или сначала `set -a && source .env && set +a`.

Восстановление:
```bash
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  < backups/z_main_<TIMESTAMP>.dump
```

**0.3. Lockfile-санитизация (одноразовое).**
Если `bun.lock` в репо ссылается на `cdn.npmmirror.com` (китайский CDN — пакеты оттуда удаляются произвольно), `docker compose build` упадёт на `error: GET https://cdn.npmmirror.com/... - 404`. Фикс уже закоммичен (`backend/bunfig.toml` + `frontend/bunfig.toml` с `registry = "https://registry.npmjs.org"` + перегенерированные `bun.lock`). Проверка:
```bash
grep -c npmmirror backend/bun.lock frontend/bun.lock     # должно быть по 0
```

**0.4. ENV** — см. Шаг 1.

---

### Шаг 1 — ENV (новые ключи за период)

Все ENV, добавленные за окно, **опциональны (имеют дефолты)** — backend стартует без них. Но рекомендованный минимум для прода:

```bash
# === Conversational channels β-9 (2026-05-25) — глобальный Telegram-бот ===
KORA_BOT_USERNAME=kora_bot          # без @, для deep-link
INVITE_TTL_DAYS=14
INVITE_REMINDER_DAYS=7
MAGIC_LINK_TTL_MINUTES=15
MAGIC_LINK_RATE_LIMIT_PER_HOUR=5
INACTIVE_BINDING_DAYS=30

# === Telegram через прокси telegram.crossmark.ru (2026-05-26) ===
# ТЗ: plans/tz/2026-05-26-telegram-via-crossmark-proxy.md.
# Прод по умолчанию через прокси — backend и Telegram не имеют прямой связи из ДЦ.
# ВАЖНО: PUBLIC_HOST_URL — публичный https-адрес БЭКЕНДА, на который прокси
# шлёт вебхуки. Из него собирается targetWebhookUrl=${PUBLIC_HOST_URL}/api/v1/webhooks/telegram-bot/s/<secret>.
# Кодом НЕ определяется. Если пуст — fallback на PUBLIC_FRONTEND_URL (обычно домен
# фронта → вебхуки уйдут не туда). В проде задавать обязательно.
PUBLIC_HOST_URL=https://<публичный-хост-бэкенда>
TELEGRAM_PROXY_ENABLED=true                       # default true; false = аварийный rollback на api.telegram.org
TELEGRAM_PROXY_API_BASE=https://telegram.crossmark.ru
TELEGRAM_PROXY_FILE_BASE=https://telegram.crossmark.ru
# 2026-06-04: авторизация админ-API прокси переведена на статический Bearer-токен.
# Токен создаётся один раз в веб-админке прокси (POST /api/tokens) и кладётся сюда.
# Старые TELEGRAM_PROXY_ADMIN_EMAIL/PASSWORD/JWT_PREFETCH_SEC — УДАЛЕНЫ из схемы, не нужны.
TELEGRAM_PROXY_TOKEN=<статический Bearer-токен из веб-админки прокси>  # хранить в vault
TELEGRAM_PROXY_REQUEST_TIMEOUT_MS=15000              # потолок одного outbound-вызова
TELEGRAM_PROXY_HEALTH_INTERVAL_SEC=30                # интервал health-cron

# === Web Push (если включается push-уведомления) ===
# ВНИМАНИЕ: VAPID_* НЕ в EnvSchema → опечатки не валидируются zod'ом, фича просто молча отключится.
VAPID_PUBLIC_KEY=<docker compose run --rm backend bunx web-push generate-vapid-keys>
VAPID_PRIVATE_KEY=<...>
VAPID_SUBJECT=mailto:noreply@kora.app
PUSH_MAX_FAILURES=5
# Frontend (build-arg!) — тот же public key:
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<тот же public>

# === Email-to-task (T5, опц., default OFF) ===
MAIL_INBOX_ENABLED=false                 # включить ТРЕБУЕТ заполнения остальных
MAIL_INBOX_DOMAIN=inbox.kora.app
MAIL_INBOX_IMAP_HOST=imap.kora.app
MAIL_INBOX_IMAP_PORT=993
MAIL_INBOX_IMAP_USER=inbox@kora.app
MAIL_INBOX_IMAP_PASS=<secret>
MAIL_INBOX_IMAP_TLS=true
MAIL_INBOX_IMAP_FOLDER=INBOX
MAIL_INBOX_POLL_CRON=*/2 * * * *
MAIL_INBOX_MAX_PER_RUN=50

# === T3 LLM провайдеры (kie + grsai) ===
KIE_API_KEY=<secret>
GRSAI_API_KEY=<secret>

# === Kill-switch'и (все default false — можно не дублировать) ===
BITEMPORAL_ENABLED=false
BITEMPORAL_SUPERSEDE_ENABLED=false
CLONE_V2_ENABLED=false                   # ТОЛЬКО ПОСЛЕ Шага 6.10 (patch-migrate-clone-access)
SPECIALISTS_COMBINED_ENABLED=false
COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM=false
DATACLASS_POLICY_ENFORCEMENT=shadow      # off | shadow | enforce — на проде сначала shadow

# === Concierge → dialog-layer integration (ТЗ 2026-05-27) ===
# При CONCIERGE_DIALOG_LAYER_ENABLED=true главный AI-агент использует
# 5-шаговый pipeline DialogService (contextualize → confidence → classify →
# multi-query + AnswerCache) и параллельный pre-retrieval по queries через
# ToolRouter.execute('search_knowledge'). Default false — на проде сначала
# включаем на 1 dev-tenant, потом полный raise. Откат — одной ENV.
CONCIERGE_DIALOG_LAYER_ENABLED=false        # фича-флаг pipeline (default false)
CONCIERGE_PRE_RETRIEVAL_TOP_K=12            # cap items в pre-retrieval после dedup
CONCIERGE_PRE_RETRIEVAL_TIMEOUT_MS=3000     # per-query timeout (мс), не блокирует основной flow
```

**Применение в compose.** ENV читаются из корневого `.env` через `env_file: [.env]` (см. `docker-compose.yml`). После правки `.env`:
```bash
docker compose up -d --force-recreate backend
```
(`restart` НЕ перечитает env-переменные — нужен именно `--force-recreate`.)

⚠️ **NEXT_PUBLIC_\*** вшиваются в frontend-бандл во время **сборки** (build-args). При смене любой `NEXT_PUBLIC_*` — обязательная пересборка:
```bash
docker compose up -d --build frontend
```

Полный список — `backend/src/common/config/env.schema.ts`. VAPID_*, CONCIERGE_* сознательно вне EnvSchema (TS2589 при глубоких `.merge()`) — читаются через `process.env` напрямую.

---

### Шаг 2 — Pull + сборка образов

```bash
# на хосте, в корне репо
git pull origin dev

# Пересобрать backend + frontend + postgres-композит (если изменился infra/postgres/Dockerfile).
docker compose build
```

`docker compose build` использует `bun install --frozen-lockfile` внутри Dockerfile и `bunfig.toml` (registry = npmjs.org). Никакого `bun install` на хосте не нужно.

---

### Шаг 3 — PRE-MIGRATION gate (защитный backfill ДО `migrate`-сервиса)

`prisma db push` (внутри `migrate`-сервиса) сделает `Meeting.tenantId` NOT NULL. Если есть legacy-Meeting с NULL — push упадёт и весь `docker compose up` зависнет.

> ⚠️ **Если прод уже проходил этот выкат раньше** (`Meeting.tenantId` уже NOT NULL) — **GATE пропусти целиком.** Сначала прогони только `backfill-meeting-tenant-id.ts` (он на raw-SQL, безопасен): если он пишет «Найдено … IS NULL: 0» — миграция уже применена, `backfill-orgs-fase0.ts` и `tighten-*` НЕ запускай. С версии после 2026-05-29 эти два скрипта на уже-мигрированной схеме сами печатают «обновление не требуется» и выходят `0` (раньше — падали Prisma 7-валидацией на `where:{tenantId:null}`, что пугало оператора). С 2026-06-01 такое самопроверочное поведение распространено на ВСЕ update-скрипты — см. раздел [🛡️ Идемпотентность update-скриптов](#️-2026-06-01--идемпотентность-update-скриптов-самопроверка-вместо-сырых-падений).

Сначала чиним — через `run --rm backend` (одноразовый контейнер с новым кодом, postgres уже запущен с прошлого выката):

```bash
# postgres должен быть up (со старого деплоя). Если нет:
docker compose up -d postgres redis

docker compose run --rm backend bun run scripts/backfill-orgs-fase0.ts
docker compose run --rm backend bun run scripts/backfill-meeting-tenant-id.ts                  # dry-run
docker compose run --rm backend bun run scripts/backfill-meeting-tenant-id.ts --apply          # реальный прогон
docker compose run --rm backend bun run scripts/tighten-meeting-tenant-not-null.ts             # exit 1 == STOP
```

Если `tighten-*` падает → разбирайся, **не запускай Шаг 4** пока не вернёт 0.

---

### Шаг 4 — Прогон миграций (автоматически через `migrate`-сервис)

Запуск всего стека. `migrate` отработает первым (`prisma db push` + `apply-postgres-init.ts`), потом стартанёт `backend`.

```bash
docker compose up -d
docker compose logs -f migrate     # пока не увидишь "DONE" / exit 0
```

⚠️ **`prisma:push` спросит подтверждение на:**
1. **DROP колонки `Transcript.rawIndexS3Url`** (NOT NULL) — данные перенесены в новую модель `TranscriptTrack`. Если потребуется — добавь `--accept-data-loss` в команду `migrate`-сервиса (`docker-compose.yml` → `migrate.command`) и пересобери. Перед этим убедиться, что нет внешних потребителей S3-ключа.
2. **`Meeting.tenantId` → NOT NULL** — gate из Шага 3 должен был всё прибрать. Если не сработал — вернись.

**Что нового в схеме** (за окно ~165 новых моделей):
- Kora-v2 фундамент: AdminSetting, EmailTemplate, RetentionPolicy, CronSchedule, FeatureFlag
- knowledge-core graph: Decision, Insight, Idea, IdeaCluster, IdeaBlockLink, EntityLink, Interaction
- Tracker (~20 моделей): Issue, IssueState, IssueComment, IssueAttachment, IssueLink, IssueRelation, IssueWebhook, IssueWebhookLog, IntakeIssue, Project, ProjectMember, Label, Cycle, Plan, ImportLog, HolidayCalendar
- Company Foundation (Фаза 0): Person, Role, Department, JobDescription, Document, Mission, Vision, Strategy, Process, ProcessStep, Regulation, Policy, Tool, Metric, Market, OrgUnit, Vendor, CompanyProfile, FunctionalDomain, Appointment, RoleProfile
- Skill / Clone (γ-1): Skill, SkillProfile, SkillTrait, SkillTraitCategory, SkillTraitConcept, ExecutablePersona, PersonKnowledgeCategoryEmbedding, CloneAccessGrant
- AI/LLM Admin: LlmProvider, LlmModel, LlmModelExperiment, LlmTaskRouteChange, PromptTemplate, PromptTemplateVersion, AiResultFeedback, AiCostDaily, OrgBudgetCap, CurrencyRate
- Meetings/Curation: TranscriptTrack, MeetingBehaviorMetrics, MeetingQualityScore, MeetingReport, CurationItem, CardVersion, CompletenessSlot
- Operations β: Experiment, DailyCheckIn, DailyOperationsDigest, WeeklyOperationsDigest, ProactiveNotification, ProbeEvent
- Gamification: ActivityFeedItem, Recognition, HelpfulnessTrait, HelpfulnessSpotlight, Badge, UserBadge, TeamTemplate
- Channels: Channel, ChannelBinding, Notification, NotificationDelivery, MailInboundLog, ChatV2Conversation, ChatV2Message
- Calendar (MVP): Event, EventParticipant, EventReminder
- Concierge / Push: ConciergeConversation, ConciergeMessage, OrgConciergeQuota, OrchestratorRun, PushSubscription

Расширение существующих:
- `Meeting`: +linkedIssueId, +reportFastStatus, +recordByDefault, +behaviorMetricsStatus, +qualityScoreStatus
- `Transcript`: +turns(Json), +roomChat, +cleanedS3Url, +cleaningStatus; **DROP rawIndexS3Url**
- `AiResult`: +summaryFast, +promptTemplateVersionId, +experimentGroup
- `AiUsageLog`: +inputCostPerMillionTokensSnapshot, +costRub, +dataClassAudit
- `Task`: +assigneeUserId (FK на User)
- `User`: +calendarFeedToken (VarChar 80)
- `User` (2026-05-29, онбординг v2): +`companyRole UserCompanyRole?` (enum: founder, general_director, operations_director, department_head, team_lead, specialist), +`profileCompletedAt DateTime?`. Оба nullable — обратно совместимо, простой db push.
- `Org` (2026-05-29, онбординг v2): +`teamSize VarChar(20)?`, +`painPoints String[]`, +`currentStack String[]`, +`plannedFeatures String[]`, +`welcomeCompletedAt DateTime?`, +`companyInfoCompletedAt DateTime?`, +`departmentsCompletedAt DateTime?`, +`rolesCompletedAt DateTime?`, +`teamInvitedAt DateTime?`, +`firstSprintCreatedAt DateTime?`, +`firstMeetingCreatedAt DateTime?`, +`setupCompletedAt DateTime?`. Все nullable — обратно совместимо, простой db push.
- `Org` (2026-05-28, демо-воркспейс): +`demoWorkspaceSeededAt DateTime?`. Nullable — обратно совместимо, простой db push. Отмечает, что для этой Org уже загружен демо-кабинет «ТехноСтрим».
- `Org` (2026-05-31, демо-контент Pulse v2): +`demoUserIds String[] @default([])`. Список id-шников демо-User'ов (5 шт. для «ТехноСтрим»). Используется `resetDemoWorkspace` для точечного удаления именно демо-юзеров. Обратно совместимо, простой db push.
- `User` (2026-05-27, коммит `ade4c25`): +`phone VarChar(20)?`, +`signupRef VarChar(255)?`, +`consentDataProcessing Boolean @default(false)`, +`consentMarketing Boolean @default(false)`, +`consentAcceptedAt DateTime?`. Lead-style регистрация: телефон, два чекбокса согласий, ref-tracking из URL. Все nullable / с дефолтом — обратно совместимо, простой db push без `--accept-data-loss`.
- `CloneAccessGrant` (2026-05-26, коммит `fc3d6fe`): +`revokedAt DateTime?`, +`revokedBy String?`, +`expiresAt DateTime?` + 2 индекса. Все поля nullable — обратно совместимо, простой db push.
- **Sprints (2026-05-27, коммиты `bb4aa6e`/`9df3d6c`/`bc34ea6`):**
  - `Project` +4 опц. scope-поля (`customerCardId/vendorId/subjectPersonId/departmentId`) + 4 индекса. Обратные relations добавлены в `Card/Vendor/Person/Department` как `scopedProjects Project[]` с уникальными relation-name'ами (ProjectCustomerCard / ProjectVendor / ProjectSubjectPerson / ProjectDepartment).
  - `Cycle` — обратные relations `linkedMeetings Meeting[]` (MeetingLinkedCycle) и `sprintHints SprintHint[]` + индекс `(tenantId, completedAt)`.
  - `Meeting` +`linkedCycleId String?` + relation MeetingLinkedCycle + индекс. Простой db push, обратно совместимо.
  - Новая модель `SprintHint` (cycleId, kind, severity, status, title, body, affectedIssueIds[], sourceBlockIds[], contentHash для дедупа, confidence). 3 новых enum: `SprintHintKind` (10 значений), `SprintHintSeverity`, `SprintHintStatus`.
  - `MeetingType` +`sprint_review` (для встречи «Итоги спринта»).
- **Telegram self-initiated checkins (2026-05-30):**
  - `DailyCheckIn` +`source DailyCheckInSource @default(cron_prompted)` — откуда пришла запись. Обратно совместимо (default backfill всех записей в `cron_prompted`, см. patch-скрипт Шаг 6).
  - Новый enum `DailyCheckInSource { cron_prompted, self_initiated, manual }`. Простой db push, без `--accept-data-loss`.

Enum расширения (без удалений — Postgres не умеет DROP VALUE):
- `MeetingType`: +review, +retrospective, +task_discussion
- `SignalType`: +30 значений
- `EntityType`: +customer, +vendor, +document, +goal, +event, +technology, +metric, +market, +org_unit
- `EntityLinkType`: +30 значений
- `IdeaBlockLinkType`: +resolves, +supersedes
- `MembershipRole`: +coo
- `SourceType`: +conversational, +tracker_event
- `VerificationPurpose`: +magic_link, +invite_accept
- ~50 новых enum-типов целиком

---

### Шаг 5 — Postgres-init (HNSW + GIN + partial unique + AGE graph)

Выполняется автоматически внутри `migrate`-сервиса (см. Шаг 4) после `prisma db push`. Если нужно прогнать вручную (например, после ручной правки SQL):
```bash
docker compose run --rm backend bun run apply-postgres-init
```

Что создаёт (всё через `IF NOT EXISTS`, идемпотентно):
- **Extensions:** `vector`, `age` (+ `LOAD 'age'`, `SET search_path`)
- **Graph:** `ag_catalog.create_graph('z_graph')`
- **HNSW (cosine) на embedding-колонках:** Decision, Insight, Idea, IdeaCluster, SkillTrait, SkillTraitConcept, PersonKnowledgeCategoryEmbedding, HelpfulnessTrait, Issue, MeetingTranscriptChunk, IdeaBlock, Entity
- **GENERATED tsvector + GIN (словарь `russian`):** IdeaBlock.search_tsv, decisions.decision_search_tsv, insights.insight_search_tsv
- **GIN на массивах:** Event.participantsPersonIds, Vendor.contractIds, decisions/insights/ideas/EntityLink.* массивы IDs
- **Partial unique индексы:** meeting_report_pending_unique, Vendor_tenantId_inn_unique_idx, Entity_strong_inn/ogrn/email/domain_uniq, channels_global_unique
- **Composite:** probe_events_tenant_status_created_idx, Entity_strong_phone_idx

---

### Шаг 6 — One-off patch-скрипты (порядок важен!)

> Все patch-скрипты — через `exec backend` (контейнер уже запущен после Шага 4).

```bash
# 6.1 — Knowledge-core: переименования + entityId
docker compose exec backend bun run scripts/patch-rename-client-to-customer.ts --dry-run
docker compose exec backend bun run scripts/patch-rename-client-to-customer.ts
docker compose exec backend bun run scripts/patch-migrate-entity-custom-to-topic.ts
docker compose exec backend bun run scripts/patch-backfill-entity-id-document.ts
docker compose exec backend bun run scripts/patch-backfill-entity-id-goal.ts
docker compose exec backend bun run scripts/patch-backfill-entity-id-person.ts
# либо composite alias (запускает все три выше):
# docker compose exec backend bun run patch:backfill-entity-id
docker compose exec backend bun run scripts/patch-person-relationship.ts

# 6.2 — Card versioning + document defaults
docker compose exec backend bun run scripts/patch-backfill-card-versions.ts
docker compose exec backend bun run scripts/patch-document-use-cases-default.ts

# 6.3 — Org / Person timezone (Europe/Moscow по умолчанию)
docker compose exec backend bun run scripts/patch-org-timezone-default.ts
docker compose exec backend bun run scripts/patch-person-timezone-default.ts

# 6.4 — Mission/Vision/Strategy → CompanyProfile (по умолчанию dry-run!)
docker compose exec backend bun run scripts/patch-migrate-mvs-to-company-profile.ts            # dry-run
docker compose exec backend bun run scripts/patch-migrate-mvs-to-company-profile.ts --apply    # запись

# 6.5 — PersonRole → Appointment (по умолчанию dry-run!)
docker compose exec backend bun run scripts/patch-migrate-person-role-to-appointment.ts            # dry-run
docker compose exec backend bun run scripts/patch-migrate-person-role-to-appointment.ts --apply    # запись

# 6.6 — Skill traits категории (γ-1)
docker compose exec backend bun run scripts/patch-skill-trait-categories-from-strings.ts --dry-run
docker compose exec backend bun run scripts/patch-skill-trait-categories-from-strings.ts

# 6.7 — KC-Temporal (bitemporal + dataclass + strong-ids + channel-binding)
docker compose exec backend bun run scripts/patch-bitemporal-backfill.ts --dry-run
docker compose exec backend bun run scripts/patch-bitemporal-backfill.ts
docker compose exec backend bun run scripts/patch-clones-role-versioning.ts
docker compose exec backend bun run scripts/patch-clones-dataclass-update.ts
docker compose exec backend bun run scripts/patch-backfill-dataclass-audit.ts
docker compose exec backend bun run scripts/patch-channel-binding-defaults.ts
docker compose exec backend bun run scripts/patch-extract-strong-ids.ts

# 6.8 — Prompt registry no-op (для будущей совместимости; сейчас ничего не пишут)
docker compose exec backend bun run scripts/patch-prompt-block-ingest-v2-fase0b.ts
docker compose exec backend bun run scripts/patch-prompt-role-profile-build-fase0d.ts

# 6.9 — LLM миграция на DeepSeek-V4-Pro (chat-v2 + 19 одиночек)
docker compose exec backend bun run scripts/patch-chat-v2-to-pro.ts
docker compose exec backend bun run scripts/patch-mass-migrate-to-deepseek-pro.ts --dry-run
docker compose exec backend bun run scripts/patch-mass-migrate-to-deepseek-pro.ts --update-existing

# 6.12 — Восстановить fallback-цепочку meeting-report-fast (2026-06-03)
# Нормализованный primary (deepseek-v4-pro) затенял legacy 3-провайдерную
# цепочку → single-provider timeout без fallback. Дописывает secondary
# (openai-via-proxy/gpt-5.4-mini) + tertiary (ollama/qwen3.5:9b). Идемпотентен.
docker compose exec backend bun run scripts/patch-ensure-meeting-report-fast-fallback.ts --dry-run
docker compose exec backend bun run scripts/patch-ensure-meeting-report-fast-fallback.ts

# 6.10 — Первичная миграция грантов CloneAccessGrant (2026-05-26, коммит 87fef5d)
# ОБЯЗАТЕЛЬНО ДО переключения CLONE_V2_ENABLED=true (см. Шаг 1).
docker compose exec backend bun run scripts/patch-migrate-clone-access.ts
# опц. для одного тенанта:
# docker compose exec backend bun run scripts/patch-migrate-clone-access.ts --tenant <orgId>

# 6.11 — Регистрация глобального Telegram-бота в прокси telegram.crossmark.ru
# (2026-05-26). Идемпотентен.
#
# ⚠ В обычном выкате этот скрипт НЕ нужен — после первой установки
# токена в /admin/system/telegram-bot backend сам авто-регистрирует бот
# в прокси (см. AdminTelegramBotService.updateToken → autoRegisterInProxy).
# Скрипт остаётся для двух кейсов:
#   1. Bootstrap старого прода, где токен уже был в БД ДО появления
#      прокси-флоу — скрипт зарегистрирует существующий токен без захода
#      в админку.
#   2. Аварийный режим, когда веб-админка временно недоступна.
#
# Предусловия:
#   - TELEGRAM_PROXY_TOKEN в .env (см. Шаг 1); статический токен из веб-админки прокси;
#   - PUBLIC_HOST_URL в .env (публичный хост бэкенда — из него собирается targetWebhookUrl);
#   - в /admin/system/telegram-bot уже установлен токен бота (иначе скрипт
#     выходит с инструкцией и кодом 0).
docker compose exec backend bun run scripts/patch-telegram-register-in-proxy.ts
# опц. — ротация webhookSecret (старый перестаёт работать сразу):
# docker compose exec backend bun run scripts/patch-telegram-register-in-proxy.ts --rotate-secret

# 6.12 — Backfill source=manual для DailyCheckIn без notificationId
# (2026-05-30, ТЗ telegram-self-initiated-checkins). Идемпотентен.
# После добавления поля source все существующие записи получили default
# 'cron_prompted', но manual-создания через POST /me/check-ins должны быть
# перевешены в 'manual' (notificationId IS NULL — точный признак). Безопасен
# на чистой БД (0 кандидатов).
docker compose exec backend bun run scripts/patch-daily-checkin-backfill-source.ts --dry-run
docker compose exec backend bun run scripts/patch-daily-checkin-backfill-source.ts
```

⚠️ **НЕ запускать на проде** (помечен внутри файла «без согласования»):
- `backfill-task-assignee-userid.ts`

ℹ️ **Доступно оператору при инциденте — НЕ плановая операция** (коммит `177e465`):
- `patch-rollback-to-deepseek-flash.ts` — массовый откат всех LlmTaskRoute с `deepseek-v4-pro` обратно на `deepseek-v4-flash`. Запуск только при подтверждённой регрессии:
  ```bash
  docker compose exec backend bun run scripts/patch-rollback-to-deepseek-flash.ts --dry-run --update-existing
  docker compose exec backend bun run scripts/patch-rollback-to-deepseek-flash.ts --update-existing
  ```

### Шаг 6.11 — Переключение `CLONE_V2_ENABLED` (после Шага 6.10)

После того как миграция грантов отработала и владелец сверил список в `/admin/clones`:

```bash
# 1. правка .env на хосте:
#    CLONE_V2_ENABLED=true
# 2. подхват без пересборки (force-recreate перечитывает env_file):
docker compose up -d --force-recreate backend
```

Откат:
```bash
# .env: CLONE_V2_ENABLED=false
docker compose up -d --force-recreate backend
```

---

### Шаг 7 — Seed-скрипты

```bash
# 7.1 — Базовый каркас LLM (порядок важен: providers → models → prices → routes)
docker compose exec backend bun run scripts/seed-default-llm-providers-and-models.ts
docker compose exec backend bun run scripts/seed-llm-model-prices.ts
docker compose exec backend bun run scripts/seed-prompt-templates.ts                          # 13 системных шаблонов
docker compose exec backend bun run scripts/seed-llm-task-routes-default.ts                   # дефолтные цепочки

# 7.2 — Тарифы / Entitlements / Retention / Календарь / Шаблоны команд / Домены
docker compose exec backend bun run scripts/seed-entitlements.ts                              # OrgEntitlement(tier_pro)
docker compose exec backend bun run scripts/seed-retention-policies.ts
docker compose exec backend bun run scripts/seed-holiday-calendar-ru-2026.ts                  # производственный календарь РФ
docker compose exec backend bun run scripts/seed-team-templates.ts                            # 10+5 системных TeamTemplate
docker compose exec backend bun run scripts/seed-functional-domains.ts                        # 8 базовых FunctionalDomain per Org

# 7.3 — Admin settings
docker compose exec backend bun run scripts/seed-admin-settings.ts
docker compose exec backend bun run scripts/seed-admin-setting-daily-digest.ts

# 7.4 — Бейджи (gamification T1)
docker compose exec backend bun run scripts/seed-badges.ts                                    # 5 базовых

# 7.5 — Глобальный Telegram канал (β-9)
docker compose exec backend bun run scripts/seed-global-channels.ts

# 7.6 — LLM TaskRoutes для всех новых taskType (за период, безопасно идемпотентно)
docker compose exec backend bun run scripts/seed-llm-task-routes-phase-B.ts                   # behavior-refine
docker compose exec backend bun run scripts/seed-llm-task-routes-phase-C.ts                   # meeting-quality-score
docker compose exec backend bun run scripts/seed-llm-task-routes-phase-D.ts                   # transcript-clean-refine
docker compose exec backend bun run scripts/seed-llm-task-routes-phase-E.ts                   # custom-report
docker compose exec backend bun run scripts/seed-llm-task-routes-regulations.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-knowledge-clone.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-knowledge-core.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-decisions.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-insights.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-ideas-and-probe.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-skill-and-clone.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-skill-concept.ts             # skill-trait-concept-name
docker compose exec backend bun run scripts/seed-llm-task-routes-chat-v2.ts                   # chat-v2-conversation-title, chat-v2-cite-select
docker compose exec backend bun run scripts/seed-llm-task-routes-recognition.ts               # recognition-formulate
docker compose exec backend bun run scripts/seed-llm-task-routes-helpfulness.ts               # 3 helpfulness taskType
docker compose exec backend bun run scripts/seed-llm-task-routes-beta-8.ts                    # checkin-parse, operations-summary
docker compose exec backend bun run scripts/seed-llm-task-routes-beta-8-1.ts                  # checkin-sentiment(+batch), operations-weekly-digest
docker compose exec backend bun run scripts/seed-llm-task-routes-beta-8-2.ts                  # commitment-extract-dates/status
docker compose exec backend bun run scripts/seed-llm-task-routes-beta-8-3.ts                  # operations-daily-digest
docker compose exec backend bun run scripts/seed-llm-task-routes-axis-classify.ts             # axis-classify, router-fallback
docker compose exec backend bun run scripts/seed-llm-task-routes-brand-voice.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-company-foundation.ts        # department-extract, domain-expand, maturity-rationale
docker compose exec backend bun run scripts/seed-llm-task-routes-concierge.ts                 # concierge-respond, concierge-toolcall-validate
docker compose exec backend bun run scripts/seed-llm-task-routes-cross-functional.ts          # cross-functional-friction-summary
docker compose exec backend bun run scripts/seed-llm-task-routes-experiments.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-process-template.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-role-map.ts                  # role-map-extract, role-completeness-rationale
docker compose exec backend bun run scripts/seed-llm-task-routes-orchestrator.ts              # 4 orchestrator-*
docker compose exec backend bun run scripts/seed-llm-task-routes-proactive.ts                 # proactive-message-craft
docker compose exec backend bun run scripts/seed-llm-task-routes-tracker-phase3.ts            # meeting-extract-actions, intake-auto-triage
docker compose exec backend bun run scripts/seed-llm-task-routes-tracker-phase3-c.ts          # issue-infer-fields, issue-goal-suggest
docker compose exec backend bun run scripts/seed-llm-task-routes-tracker-phase4-telegram.ts   # telegram-create-task и др. (4 шт.)
docker compose exec backend bun run scripts/seed-llm-task-routes-feedback-cluster.ts          # feedback.cluster (4 уровня)
docker compose exec backend bun run scripts/seed-llm-task-routes-clone-v2.ts                  # dialog-multi-query-clone, clone-respond v2 → deepseek-v4-pro
docker compose exec backend bun run scripts/seed-llm-task-routes-specialists-combined.ts      # knowledge-specialists-combined (Variant Б+)
docker compose exec backend bun run scripts/seed-llm-task-routes-dialog-layer.ts              # 5 dialog-* taskType
docker compose exec backend bun run scripts/seed-llm-task-routes-temporal.ts                  # fact-supersede-detect
docker compose exec backend bun run scripts/seed-llm-task-routes-kie-grsai-ab.ts              # A/B на dialog-multi-query (status=draft)
docker compose exec backend bun run scripts/seed-llm-task-routes-sprints.ts                   # Sprints (2026-05-27): sprint-helper-suggest + sprint-review-summary (deepseek-v4-pro → gpt-5.4-mini → qwen3.5:9b)

# 7.7 — Глобальный default: DeepSeek-V4-Pro primary на ВСЕ taskType
docker compose exec backend bun run scripts/seed-llm-default-primary-deepseek-pro.ts
# Если хочешь перебить уже существующие primary:
# docker compose exec backend bun run scripts/seed-llm-default-primary-deepseek-pro.ts --update-existing
```

ℹ️ Большинство `seed-llm-task-routes-*` принимают `--update-existing` — без него существующие записи не трогаются. Защита `editedByAdmin` блокирует затирание ручных правок.

---

### Шаг 7.8 — Демо-воркспейс «ТехноСтрим» (per-Org, по запросу)

**Два способа запуска** (выбери один):

**Способ А — через UI (рекомендуется):**
1. Залогинься под owner/admin нужной Org.
2. Перейди на `/onboarding/demo-choice` или вызови `POST /api/v1/orgs/<orgId>/demo-workspace` из Swagger (`/api/docs`).
3. После успешного seed фронтенд перенаправит на `/dashboard` и запустит демо-тур (5 шагов).

**Способ Б — CLI-скрипт (для тестирования / массового seed):**
```bash
# Узнать tenantId (slug Org) и ownerUserId:
docker compose exec backend bun run scripts/seed-demo-workspace.ts --tenant <orgId> --owner <userId>
```
Скрипт создаёт ~4600 строк демо-данных: 12 человек, 7 отделов, 3 проекта, 38 задач, 7 встреч с AI-отчётами, 20 IdeaBlock, 15 Entity, 7 Theme, 4 клона, 100 check-ins, дайджесты, чат-диалоги, уведомления, карточки, процессы. Все записи помечены `externalSource: 'demo'`.

**Сброс демо-данных:**
```bash
# CLI:
docker compose exec backend bun run scripts/seed-demo-workspace.ts --tenant <orgId> --owner <userId> --reset
# API: POST /api/v1/orgs/<orgId>/reset-demo (owner only)
```

⚠️ Скрипт **не зарегистрирован в `apply-prod-deploy.ts`** — это per-org операция, не глобальный seed. Вызывается по требованию из UI или CLI.

---

### Шаг 8 — Backfill (после schema + seed)

```bash
docker compose exec backend bun run scripts/backfill-meeting-sources-fase1.ts                 # дефолтный Source(type=meeting) per Org
docker compose exec backend bun run scripts/backfill-entity-link-types-fase0.ts               # EntityLink.fromType/toType → 'entity'
docker compose exec backend bun run scripts/backfill-commitment-due-dates.ts --dry-run
docker compose exec backend bun run scripts/backfill-commitment-due-dates.ts                  # β-8.2
docker compose exec backend bun run scripts/backfill-onboarding-setup-completed.ts            # онбординг v2: Org с отделами → setupCompletedAt = createdAt (идемпотентен, батчами по 100)
docker compose exec backend bun run scripts/backfill-demo-subscriptions.ts                    # ТЗ paywall: Subscription{DEMO} для Org без подписки (идемпотентен)

# Опционально (дорого по LLM-quota):
docker compose exec backend bun run scripts/skill-trait-concepts-backfill.ts
docker compose exec backend bun run scripts/person-knowledge-embeddings-backfill.ts --dry-run
docker compose exec backend bun run scripts/person-knowledge-embeddings-backfill.ts

# НЕ запускать (помечен «без согласования»):
# docker compose exec backend bun run scripts/backfill-task-assignee-userid.ts
```

---

### Шаг 9 — Миграции (β-9 Telegram + Tracker legacy Task)

```bash
# β-9: per-tenant Telegram-каналы → один глобальный
docker compose exec backend bun run scripts/migrate-telegram-channels-to-global.ts --dry-run
# Изучи output (cases A/B/C/D/E). Если ок:
docker compose exec backend bun run scripts/migrate-telegram-channels-to-global.ts
# Аварийный откат:
# docker compose exec backend bun run scripts/migrate-telegram-channels-back.ts

# Tracker: legacy Task → Issue (по умолчанию dry-run!)
docker compose exec backend bun run migrate-task-to-issue                # = bun run scripts/migrate-task-to-issue.ts (dry-run)
docker compose exec backend bun run migrate-task-to-issue --apply        # реальная запись
```

---

### Шаг 10 — Per-tenant: настройка ботов

```bash
# Telegram (β-9, 2026-05-25): теперь ГЛОБАЛЬНЫЙ — один на всю инсталляцию, без --tenant-id!
docker compose exec backend bun run setup:telegram-bot \
  -- --token=$TG_TOKEN --public-host-url=https://prod.host --webhook-secret=<секрет>

# MAX (платформа Дзен): пока per-tenant
docker compose exec backend bun run setup:max-bot \
  -- --token=$MAX_TOKEN --tenant-id=$ORG_ID --public-host-url=https://prod.host --webhook-secret=<секрет>
```

⚠️ В старых рефлексиях `setup-telegram-bot` мог упоминаться с `--tenant-id` — **это устарело с β-9**.

---

### Шаг 11 — Рестарт после ENV / кода

```bash
# Поднять / пересоздать с новым образом (миграция уже отработала в Шаге 4):
docker compose up -d --build

# Только подхватить новый .env (без пересборки кода):
docker compose up -d --force-recreate backend

# Если worker'ы вынесены в отдельный сервис (см. ниже) — рестарт его тоже:
# docker compose up -d --force-recreate worker
```

⚠️ В текущем `docker-compose.yml` **backend и BullMQ-воркеры — один контейнер** (worker'ы in-process по `backend/src/workers/main.ts`, который тоже грузится в HTTP-приложение). Один рестарт `backend` подхватывает и новые REST/WS-роуты, и новые BullMQ-очереди, и новые `@Cron`'ы.

Если когда-нибудь будет добавлен отдельный сервис `worker` — рестарт строго оба, иначе новые очереди не подцепятся.

---

### Шаг 12 — Smoke-проверка

```bash
# Health endpoints (изнутри compose-сети nginx → backend):
curl https://prod.host/health
curl https://prod.host/api/docs                  # Swagger UI

# Или напрямую к контейнеру (если nginx ещё не настроен):
docker compose exec backend wget -qO- http://127.0.0.1:3000/health
docker compose exec backend wget -qO- http://127.0.0.1:3000/health/ready
```

В Swagger должны появиться разделы: **tracker, projects, issues, cycles, intake, webhooks, comments, labels, attachments, relations, team-templates, chat-v2, conversational, curation, decisions, events, ideas, insights, knowledge-clone, clones, probe, regulations, vendors, calendar (events)**.

**Sprints (2026-05-27 / расширено 2026-05-28).** В Swagger под тегом `tracker / cycles` должны появиться `GET /api/v1/cycles/:id/dashboard`, `POST /api/v1/cycles/:id/start-meeting`, `GET /api/v1/cycles/:id/hints`, `GET /api/v1/cycles/:id/review`, `POST /api/v1/cycles/:id/review/regenerate`; под тегом `tracker / sprint-hints` — `POST /api/v1/sprint-hints/:id/{dismiss,resolve}`; под тегом `tracker / sprints` (2026-05-28) — `GET /api/v1/sprints` (master-detail список с фильтрами) и `POST /api/v1/sprints/quick-create` (атомарное создание Project+Cycle); под тегом `vendors` — `POST /api/v1/vendors`, `PATCH /api/v1/vendors/:id`, `DELETE /api/v1/vendors/:id`. Smoke модели и базового потока:

```bash
docker compose exec backend bun run scripts/smoke-sprints.ts
```

(создаёт временный Department + Project с departmentId scope + Cycle + 3 Issue + Meeting(sprint_review) + SprintHint, проверяет dismiss; 2026-05-28: расширен — также проверяет list-фильтр scope=department, inline-create Vendor, quick-create scope=vendor с cleanup. Чистит за собой).

```bash
curl https://prod.host/metrics | grep -E 'z_voice_ws|z_mail_inbound|z_llm_cache|z_prompt_injection|bullmq_'
```

Должны быть `bullmq_*` метрики под новые очереди: `probe-*, conversational-send, chat-v2-cleanup, card-stale-detector, idea-clusterer, insight-clusterer, knowledge-clone-rebuild, skill-profile-*, executable-persona-build, skill-manager-digest, tracker.webhook-delivery`.

**Демо-воркспейс (2026-05-28).** В Swagger под тегом `onboarding` должны появиться `POST /api/v1/orgs/:orgId/demo-workspace` и `POST /api/v1/orgs/:orgId/reset-demo`. Smoke-проверка:

```bash
# Seed демо-данных (замени <orgId> и <userId> на реальные):
docker compose exec backend bun run scripts/seed-demo-workspace.ts --tenant <orgId> --owner <userId>
# Ожидаемый вывод: "=== Демо-воркспейс «ТехноСтрим» успешно создан ===" + JSON stats
# Проверка: Org.demoWorkspaceSeededAt != null
docker compose exec backend bun -e '
import { createPrismaClient } from "./scripts/_lib/prisma";
const p = createPrismaClient();
p.org.findUnique({ where: { id: "<orgId>" }, select: { demoWorkspaceSeededAt: true } })
  .then(r => { console.log("demoWorkspaceSeededAt:", r?.demoWorkspaceSeededAt); process.exit(0) })
'

# Reset:
docker compose exec backend bun run scripts/seed-demo-workspace.ts --tenant <orgId> --owner <userId> --reset
# Ожидаемый вывод: "Демо-данные удалены."
```

**Telegram через прокси (2026-05-26).** После Шага 6.11 проверь, что:

```bash
# Метрики прокси — outcome должен быть ok после первого outbound:
curl https://prod.host/metrics | grep -E 'telegram_proxy_request_total|telegram_proxy_health_check_total'

# Health-cron: после ~30с в Redis должен появиться ключ tg:proxy:healthy='1'.
docker compose exec backend bun -e 'import("ioredis").then(m=>{const r=new m.default(process.env.REDIS_URL);r.get("tg:proxy:healthy").then(v=>{console.log("tg:proxy:healthy=",v);process.exit(0)})})'
```

В админке `/admin/system/telegram-bot` — карточка «Прокси telegram.crossmark.ru»
должна быть зелёной (бот зарегистрирован, healthy=true). Кнопка
«Проверить прокси сейчас» возвращает HTTP 200 и < 1000 мс.

```bash
# Hot-reload Prometheus alerts (если изменялись правила, и Prometheus в этом же compose):
docker compose exec prometheus kill -HUP 1
```

---

## 📦 Сценарий B: Чистый выкат с нуля

> Используй когда: данные в БД можно потерять (beta/staging), ИЛИ postgres-volume несовместим с composite-образом `z-postgres-age-pgvector:pg16` (например, был унаследован старый `pgvector/pgvector:pg17`). На чистой БД **не нужны** patch/backfill/migrate-скрипты (Шаги 6, 8, 9) — нечего бэкфилить.

### B.1 — Down + wipe volumes

```bash
cd /home/docker/z         # путь к docker-compose.yml на проде
docker compose down -v    # -v удаляет volumes: z_z-postgres-data, z_z-redis-data
```

⚠️ **Безвозвратно стирает БД и redis-AOF.** Если есть хоть какие-то данные, которые жалко — сначала `Шаг 0.2` бэкап.

### B.2 — Pull + ENV

```bash
git pull origin dev
set -a && source .env && set +a   # подтянуть POSTGRES_USER/DB в shell
```

**Обязательный минимум в `.env`:**
```bash
POSTGRES_DB=z_main
POSTGRES_USER=z_app
POSTGRES_PASSWORD=<openssl rand -hex 16>
DATABASE_URL=postgresql://z_app:<тот_же_пароль>@postgres:5432/z_main

JWT_SESSION_SECRET=<openssl rand -hex 32>
JWT_DEEP_LINK_SECRET=<openssl rand -hex 32>
WEBHOOK_SECRETS_ENCRYPTION_KEY=<openssl rand -base64 32>
IP_HASH_DAILY_SALT=<openssl rand -hex 16>

LIVEKIT_API_KEY=<совпадает с infra/livekit/livekit.yaml>
LIVEKIT_API_SECRET=<совпадает>
LIVEKIT_WEBHOOK_API_KEY=<тот же>
LIVEKIT_WEBHOOK_API_SECRET=<тот же>

# NEXT_PUBLIC_* — вшиваются в frontend-бандл на сборке
NEXT_PUBLIC_API_BASE_URL=https://api.your-domain.tld
NEXT_PUBLIC_BACKEND_URL=https://api.your-domain.tld
NEXT_PUBLIC_LIVEKIT_URL=wss://media.your-domain.tld
NEXT_PUBLIC_FRONTEND_URL=https://app.your-domain.tld

# Первый супер-админ (создаётся через bun prisma/seed.ts в Шаге B.6)
ADMIN_BOOTSTRAP_EMAIL=<твой email>
ADMIN_BOOTSTRAP_NAME=Admin

# Все Kill-switch'и оставь false:
BITEMPORAL_ENABLED=false
BITEMPORAL_SUPERSEDE_ENABLED=false
CLONE_V2_ENABLED=false                   # на чистой БД сразу можно true (нет existing pol'ей)
SPECIALISTS_COMBINED_ENABLED=false
COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM=false
DATACLASS_POLICY_ENFORCEMENT=shadow

# Опциональное (если используешь Telegram-бот):
KORA_BOT_USERNAME=kora_bot
```

### B.3 — Sanity-check + build

```bash
grep -c npmmirror backend/bun.lock frontend/bun.lock     # должно быть 0 / 0
docker compose build                                     # 5-15 мин на холодную
```

### B.4 — Up (postgres → init.sql → migrate → backend → frontend)

```bash
docker compose up -d
docker compose logs -f migrate
# Жди:
#   "✓ postgres-init.sql выполнен"
#   "=== apply-postgres-init DONE ==="
# затем Ctrl+C
```

### B.5 — Проверка composite-образа PG + extensions

```bash
docker compose ps postgres
# IMAGE должно быть: z-postgres-age-pgvector:pg16

docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT extname, extversion FROM pg_extension WHERE extname IN ('age','vector');"
# 2 строки: age 1.5+, vector 0.8+

docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT name FROM ag_catalog.ag_graph WHERE name = 'z_graph';"
# 1 строка: z_graph
```

Если postgres image не composite — пересобери и форсируй recreate:
```bash
docker compose build postgres
docker compose up -d --force-recreate postgres
```

### B.6 — Бутстрап первого супер-админа

**Интерактивно (рекомендуется)** — вводишь только email и пароль, скрипт сам хеширует (bcrypt 12) и ставит `role='admin'` + `isSuperAdmin=true`:
```bash
docker compose exec backend bun run scripts/set-admin-password.ts <email> '<пароль>' --super
# нет юзера → создаст; есть с role=admin → обновит пароль (+ isSuperAdmin при --super)
```
Логин: `POST /api/v1/auth/admin-login {email,password}` → session-cookie → Z-Admin на `/admin`.

⚠️ `role='admin'` **обязателен** — `admin-login` ищет юзера именно по нему (`admin-login.service.ts`). Флаг `--super` добавляет `isSuperAdmin=true` для доступа к супер-функциям Z-Admin. Ручной bcrypt+SQL больше не нужен.

**Альтернатива** — env-bootstrap (если задан `ADMIN_BOOTSTRAP_EMAIL`):
```bash
docker compose run --rm backend bun prisma/seed.ts
# Создаст User по ADMIN_BOOTSTRAP_EMAIL + Org "default" + role=admin (БЕЗ isSuperAdmin).
```

### B.7 — Базовый каркас LLM (без него AI-фичи не работают)

```bash
docker compose exec backend bun run scripts/seed-default-llm-providers-and-models.ts
docker compose exec backend bun run scripts/seed-llm-model-prices.ts
docker compose exec backend bun run scripts/seed-prompt-templates.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-default.ts
```

### B.8 — Прочие seed'ы (тарифы, календарь, шаблоны, домены, бейджи, Telegram)

```bash
docker compose exec backend bun run scripts/seed-entitlements.ts
docker compose exec backend bun run scripts/seed-retention-policies.ts
docker compose exec backend bun run scripts/seed-holiday-calendar-ru-2026.ts
docker compose exec backend bun run scripts/seed-team-templates.ts
docker compose exec backend bun run scripts/seed-functional-domains.ts
docker compose exec backend bun run scripts/seed-admin-settings.ts
docker compose exec backend bun run scripts/seed-admin-setting-daily-digest.ts
docker compose exec backend bun run scripts/seed-badges.ts
docker compose exec backend bun run scripts/seed-global-channels.ts
```

### B.9 — LLM TaskRoutes для всех новых taskType (35 скриптов одним циклом)

```bash
for s in phase-B phase-C phase-D phase-E regulations knowledge-clone knowledge-core \
         decisions insights ideas-and-probe skill-and-clone skill-concept chat-v2 \
         recognition helpfulness beta-8 beta-8-1 beta-8-2 beta-8-3 axis-classify \
         brand-voice company-foundation concierge cross-functional experiments \
         process-template role-map orchestrator proactive tracker-phase3 \
         tracker-phase3-c tracker-phase4-telegram feedback-cluster clone-v2 \
         specialists-combined dialog-layer temporal kie-grsai-ab; do
  echo "=== seed-llm-task-routes-$s ==="
  docker compose exec backend bun run scripts/seed-llm-task-routes-$s.ts
done

# Глобальный primary: DeepSeek-V4-Pro
docker compose exec backend bun run scripts/seed-llm-default-primary-deepseek-pro.ts
```

### B.10 — Setup глобального Telegram-бота (если используешь)

```bash
docker compose exec backend bun run setup:telegram-bot \
  -- --token=$TG_TOKEN --public-host-url=https://prod.host --webhook-secret=<секрет>
```

### B.11 — Smoke

```bash
curl https://prod.host/health
curl https://prod.host/health/ready
# {"ok":true,"checks":{"postgres":"ok","redis":"ok","livekit":"ok"}}

curl -s https://prod.host/api/docs > /dev/null && echo "Swagger OK"
curl -s https://prod.host/metrics | grep -E 'bullmq_(probe|conversational|chat-v2|knowledge-clone|skill|tracker)' | head
```

### Чего в Сценарии B НЕ делать

- ❌ Шаг 3 (PRE-MIGRATION gate) — нет legacy Meeting с NULL tenantId.
- ❌ Шаг 6 (patch-*) — нечего патчить, БД пустая. Исключение: `patch-migrate-clone-access.ts` безопасно запустить (no-op, нет existing Appointment), если планируешь сразу `CLONE_V2_ENABLED=true`.
- ❌ Шаг 8 (backfill-*) — нечего бэкфилить.
- ❌ Шаг 9 (migrate-telegram-channels-to-global / migrate-task-to-issue) — нет legacy данных.

---

## 🆘 Troubleshooting

### `apply-prod-deploy.ts` упал на конкретном скрипте

Запусти с `--continue-on-fail` — увидишь полный список упавших. Идемпотентные скрипты безопасно перезапустить, уже сделанные пройдут как `skipped`:

```bash
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode bootstrap --continue-on-fail
```

### `Cron Job with the given name (...) already exists`

9 скриптов используют `NestFactory(AppModule)` и поднимают весь Nest — это может конфликтовать с уже запущенными `@Cron`-декораторами. Известный технический долг, скрипты:

- `seed-global-channels.ts`
- `migrate-telegram-channels-to-global.ts` / `migrate-telegram-channels-back.ts`
- `patch-backfill-dataclass-audit.ts`
- `backfill-commitment-due-dates.ts`
- `backfill-task-assignee-userid.ts`
- `person-knowledge-embeddings-backfill.ts`
- `skill-trait-concepts-backfill.ts`
- `e2e-feedback-clustering.ts`

Обходные пути:
1. **Запускать в одноразовом контейнере** (где Nest ещё не работает с @Cron):
   ```bash
   docker compose run --rm backend bun run scripts/seed-global-channels.ts
   ```
   НЕ через `exec backend` (там Nest уже инициализирован с cron'ами в основном процессе).
2. **Долгосрочно** — переписать эти скрипты на `createPrismaClient()` из `_lib/prisma`, без `NestFactory`. См. правило в `CLAUDE.md` → Триггер 1 → Шаг 5.

### `migrate` exit 1 при `docker compose up`

Смотри логи:
```bash
docker compose logs --tail=100 migrate
```

Типичные причины:
| Лог | Что делать |
|---|---|
| `extension "age" is not available` | Postgres-контейнер НЕ composite-образ. Проверь `docker compose ps postgres` → IMAGE должно быть `z-postgres-age-pgvector:pg16`. Если нет — `docker compose build postgres && docker compose up -d --force-recreate postgres`. |
| `database files are incompatible with server` | Старый volume (от другой версии PG) и новый образ несовместимы. Только Сценарий B (wipe). |
| `Meeting.tenantId NOT NULL violation` | Не запустил GATE (Шаг 6 в Сценарии A). Сначала backfill, потом retry migrate. |
| `Cannot find module '../src/...'` | Старый backend-образ без `src/` в runner. Пересобери: `docker compose build backend && docker compose up -d --force-recreate backend`. |

### `bun install` падает на `cdn.npmmirror.com - 404` в docker build

Lockfile прибит к китайскому зеркалу. Проверь:
```bash
grep -c npmmirror backend/bun.lock frontend/bun.lock     # должно быть 0 и 0
```
Если ≠ 0 — что-то пошло не так с pull или последний коммит откатил фикс. Перегенерация:
```bash
cd backend && rm bun.lock && bun install && cd ..
cd frontend && rm bun.lock && bun install && cd ..
git diff bun.lock                              # проверь что нет npmmirror
git add backend/bun.lock frontend/bun.lock && git commit -m "fix(deploy): regen bun.lock"
```

### Backend не стартует после `docker compose up`

```bash
docker compose logs --tail=200 backend
```

Чаще всего:
- **Невалидный ENV** (zod fail): в логе будет «Невалидная конфигурация ENV» + поле. Открой `.env`, исправь, `docker compose up -d --force-recreate backend`.
- **DATABASE_URL** не дозвонился до postgres: проверь `docker compose ps postgres` — должен быть healthy. URL внутри compose: `postgres:5432`, не `localhost`.

### LiveKit `fail` в `/health/ready`

```json
{"checks":{"livekit":"fail:Unable to connect..."}}
```

`LIVEKIT_URL` из `.env` (внутри backend-контейнера) не дозвонился до media-сервера. Проверь:
- `LIVEKIT_URL` в `.env` указывает на доступный domain/IP (НЕ `localhost` если media в другом контейнере/сети).
- Media-сервер запущен и порт 7880/443 доступен.
- `LIVEKIT_API_KEY/SECRET` совпадают с `infra/livekit/livekit.yaml` на media-сервере.

### Откатить выкат

```bash
# 1. Откатить код
git log --oneline -10
git reset --hard <previous_commit>
# 2. Откатить БД из бэкапа
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists < backups/z_main_<TIMESTAMP>.dump
# 3. Поднять с откатанным кодом
docker compose up -d --build
```

---

## ⚠️ Особо опасные операции (требуют согласования владельца)

| Операция | Чем опасна | Защита |
|---|---|---|
| `prisma:push` + `--accept-data-loss` (внутри `migrate`-сервиса) | DROP `Transcript.rawIndexS3Url` — данные исчезнут | Данные перенесены в `TranscriptTrack` (Wave 5). Проверить отсутствие внешних потребителей S3-ключа. |
| Запуск `migrate` без AGE в postgres-образе | Падение с `extension "age" is not available` | Шаг 0.1 |
| `patch-mass-migrate-to-deepseek-pro.ts --update-existing` | Перезатирает primary провайдер у НЕ-admin-edited LlmTaskRoute | Сначала `--dry-run`. `editedByAdmin` защищён. |
| `seed-llm-default-primary-deepseek-pro.ts --update-existing` | Меняет primary у ВСЕХ taskType | `editedByAdmin` НЕ трогается. ТОЛЬКО для сброса ручных настроек. |
| `migrate-task-to-issue --apply` | Конвертирует legacy Task → Issue | Идемпотентен. Сначала dry-run. Task не удаляется. |
| `backfill-task-assignee-userid.ts` | В шапке файла «НЕ ЗАПУСКАТЬ НА ПРОДЕ без согласования» | Пропустить. |
| `patch-rollback-to-deepseek-flash.ts --update-existing` | Массовый откат 26 LlmTaskRoute pro→flash. Не плановая | Защищён флагом `--update-existing`; `editedByAdmin=true` не трогает. Сначала `--dry-run`. |
| `CLONE_V2_ENABLED=true` без `patch-migrate-clone-access.ts` | У всех пользователей пропадёт доступ к клонам | См. Шаг 6.10 + 6.11. Порядок: миграция грантов → сверка в `/admin/clones` → ENV → `force-recreate backend`. |

---

## 📂 Архив применённых

_(пусто — это первый накопительный документ; после первого выката переносим блок «Накоплено к выкату» сюда с датой)_

---

## 🔄 Правила поддержки файла

### Жёсткие правила формата команд

1. **Все команды — через `docker compose`.** Никаких `cd backend && bun run ...` на хосте. Z в проде целиком в контейнерах.
2. **Patch/seed/backfill/migrate-скрипты** — через `docker compose exec backend bun run scripts/<file>.ts` (backend уже запущен) ИЛИ `docker compose run --rm backend bun run scripts/<file>.ts` (одноразовый контейнер, если backend ещё не стартовал — например, в Шаге 3).
3. **Schema/postgres-init** — автоматически через `migrate`-сервис при `docker compose up`. Вручную: `docker compose run --rm backend bun run apply-postgres-init`.
4. **Бэкап БД** — только через `docker compose exec -T postgres pg_dump`, никаких локальных `pg_dump` к ip-сервера.
5. **ENV** — правка корневого `.env` + `docker compose up -d --force-recreate backend` (для `NEXT_PUBLIC_*` — `--build frontend`).
6. **Restart** — `docker compose up -d --build backend` (новый код) или `docker compose up -d --force-recreate backend` (новый ENV).

### Когда обновлять

После каждого `git push` в `dev`/`main`, если push содержит:

| Что изменилось | Куда писать в разделе «Накоплено к выкату» |
|---|---|
| `backend/prisma/schema.prisma` (новая модель / nullable→NOT NULL / drop / новый enum) | Шаг 4 |
| `backend/scripts/postgres-init.sql` (HNSW / GIN / partial unique / extension) | Шаг 5 |
| Новый файл `backend/scripts/patch-*.ts` | Шаг 6 |
| Новый файл `backend/scripts/seed-*.ts` | Шаг 7 |
| Новый файл `backend/scripts/backfill-*.ts` | Шаг 8 |
| Новый файл `backend/scripts/migrate-*.ts` | Шаг 9 |
| Новый файл `backend/scripts/setup-*.ts` | Шаг 10 |
| `backend/src/common/config/env.schema.ts` (новая ENV) | Шаг 1 |
| Новая модель worker / cron / BullMQ-очередь | Шаг 12 (smoke: добавить в grep по `bullmq_`) |
| Новый REST/Swagger раздел | Шаг 12 (smoke: добавить в список разделов Swagger) |
| Включение нового feature flag по умолчанию | Шаг 1 («Kill-switch'и») |
| Изменения в `docker-compose.yml` (новые сервисы / порты / depends_on) | Pre-flight 0 или Шаг 11 |
| Изменения в `Dockerfile` / `bunfig.toml` / `bun.lock` | Шаг 2 |

### Как обновлять

1. После `git push` запусти у себя:
   ```bash
   git show --stat HEAD
   git diff HEAD~N --name-only | grep -E '(prisma/schema|scripts/(seed|patch|migrate|backfill|setup|smoke)|postgres-init\.sql|env\.schema\.ts|Dockerfile|bunfig|docker-compose)'
   ```
2. Для каждого попавшего файла добавь строчку в соответствующий шаг — **обязательно с префиксом `docker compose exec backend …`** (или `run --rm backend …` для pre-up сценариев).
3. Если переименовываешь существующий скрипт или меняешь поведение — **обнови запись inline**, не дублируй.
4. Если запись становится неактуальной (фича откатили) — удали из «Накоплено к выкату».

### Когда переносить в архив

После триггера «выкат прошёл / прод обновили / выкатили» — целиком копируешь блок «🚨 Накоплено к выкату» в новый подраздел `## 📂 Архив применённых` → `### 2026-MM-DD — выкат N` с пометкой кто выкатил и какие были инциденты. Раздел «Накоплено к выкату» обнуляется (Pre-flight + пустой Шаг 1..12).

### Связь с рефлексией

При записи рефлексии в `second-brain/05_история/` всегда ссылайся на этот файл («prod-инструкция обновлена → см. `docs/operations/prod-deploy-log.md`»), вместо того чтобы дублировать команды в рефлексии.
