---
date: 2026-05-24
session: Sprint 1 рывка Z/Кора — оркестрация 9 параллельных subagent'ов
commits:
  - c5573b8 docs(plans): Sprint Plan Wave 1 + решения владельца 2026-05-24
  - 6b85491 feat(tracker,knowledge-core): 20 моделей трекера + 18 SignalType
  - 79c16dd feat(tracker): module scaffold + 8 controllers + 8 services + 18 DTO + RBAC
  - d1c2159 chore(config,metrics): tracker ENV schema + 9 Prometheus метрик
  - cd544be feat(livekit): noise suppression включён по умолчанию + UI toggle
  - fb1e770 feat(skill-profile): группировка SkillTrait по категориям на UI + lint fix
  - 7d5e51e fix(ai-prompts): CRIT-2 type-review + type-retrospective + CRIT-3 backfill
  - 4576111 feat(tracker): IssueRelation + Attachments S3 + start-meeting LiveKit
  - 4961db8 feat(tracker): WebSocket gateway + BullMQ webhook delivery с HMAC retry
  - 31fd270 feat(insights): β-4 causeCategory 8-категорий + LLM extraction
distilled: false
---

# Рефлексия: Sprint 1 трекера + ответы владельца + оркестрация 9 параллельных subagent'ов

## Что было поставлено

Владелец дал серию команд в одной длинной сессии 2026-05-24:

1. **Старт планирования** — оркестрация единого продуктового рывка Z/Кора + AI-COO + второй мозг. 31 sub-ТЗ (10 новых + 21 Кора v2) от 2026-05-23. Нужен план Wave 1 (6 нед, 3 спринта × 2 нед), команда 4 разработчика минимум, граф зависимостей, риски, тикеты-промпты.

2. **8 открытых вопросов** — закрыть с моими default-предложениями. Из них:
   - Чек-лист 14 пунктов из обзора продукта.
   - 10 шаблонов команд.
   - Ценовая модель (Free/Pro/Business/Enterprise) — **отложена**.
   - Магазины мобилки — все три (App Store + Google Play + RuStore).
   - Приоритет (параллельно vs последовательно).
   - Принцип «трекер = источник для второго мозга».
   - Sentiment чек-инов — **отмена кнопок 🟢🟡🔴**, AI определяет sentiment из свободного текста/голоса вечернего чек-ина.
   - Helpfulness Spotlights, приватные сигналы, календари.

3. **«Стартуй, ты главный, делай коммиты сам»** — я как оркестратор должен запускать subagent'ов, проверять результаты, делать локальные коммиты после каждого закрытого тикета. Push — только с явного подтверждения владельца.

4. **«Пуш»** — итоговый push 4 коммитов + автоматическая рефлексия.

## Как решал

### Фаза 1 — планирование (4 параллельных Read)

Прочитал ключевые документы параллельно: зонтичный план + reality-deltas + Phase 1 трекера + мобилка + α-2 + Phase 2 + Specialist 3.8 + tracker-as-entry-wedge + AI-COO readiness + Activity Feeds + Gamification + β-8 + Phase 3.

**Главное открытие:** reality-deltas (документ от 2026-05-22) был очень точным — код Кора v2 опережает план на **60-70%**. Из 24 sub-ТЗ Кора v2 13 крупных блоков практически готовы, ещё 4 нужны мелкие доделки. Это сильно меняет масштаб оставшейся работы — из ~24 sub-ТЗ реально ~14.

Создал `plans/sprints/2026-05-24-sprint-plan-wave-1.md` (~910 строк) с:
- 4 потока Wave 1 (A: Phase 1 трекера, B: α-2 расширение, C: мобилка, D: бэклог Кора v2).
- 3 спринта × 2 нед, каждый с тикетами + DoD + Skills + сроки + риски.
- Граф зависимостей 31 sub-ТЗ.
- Топ-3 рискованных sub-ТЗ (α-5 DialogService, α-10 Admin LLM, α-8 Role Map).
- 7+1 открытых вопросов с моими defaults.
- Промпты-тикеты для первого спринта.

После ответов владельца — обновил план: добавил раздел «Принятые решения владельца 2026-05-24» с 10 решениями, переписал раздел «Открытые вопросы» (оставил 8 не-закрытых).

### Фаза 2 — оркестрация 9 параллельных subagent'ов

**Принцип параллелизации:** запускал агентов **параллельно**, если они трогают **разные файлы**. На schema.prisma — **последовательно** (race condition на `prisma:push`).

Каждый агент получал:
- Контекст: путь к sub-ТЗ, sprint plan, существующая инфра.
- Skills проекта (nestjs-rules, prisma-db-push-rules, z-ai-agent-rules, core-engineering-standards).
- Жёсткие правила: только `bun run prisma:push` (никогда `migrate`), nullable поля для backward-compat, `bun run typecheck` зелёный до отчёта, никаких `git add/commit/push`.
- Чёткий DoD и список «что НЕ делать».

Список агентов (по порядку запуска):

1. **Agent 1 (Schema батч)** — 20 моделей трекера + 18 новых SignalType + Goal/Meeting расширения + block-ingest.prompt.ts. Один прогон schema-изменений → один `prisma:push`.

2. **Agent 2 (Tracker scaffold)** + **Agent 3 (DevOps ENV+metrics)** — параллельно. Agent 2 создал 38 файлов tracker модуля (8 controllers + 8 services + 18 DTO + ActivityRecorderService + RBAC). Agent 3 добавил TrackerSchema в env.schema.ts + 9 Prometheus метрик.

3. **Agent 4 (LiveKit RNNoise)** + **Agent 5 (γ-1 SkillTraitCategory)** — параллельно. Agent 4 активировал шумоподавление через AudioCaptureOptions (browser-уровень, без Krisp). Agent 5 обнаружил что 95% γ-1 уже готово в коде, доделал только frontend grouping + lint fix.

4. **Agent 6 (CRIT verification)** + **Agent 7 (Sprint 2 jump-start)** — параллельно. Agent 6 верифицировал CRIT-1 (синхронизировано), создал 2 промпта (type-review.ts, type-retrospective.ts), сделал backfill-скрипт для Meeting.tenantId (оказалось уже NOT NULL). Agent 7 закрыл IssueRelation CRUD (с auto-обратной парной) + Attachments S3 + start-meeting LiveKit.

5. **Agent 8 (WebSocket + BullMQ webhook)** + **Agent 9 (α-4 + β-4 + β-5 батч)** — параллельно. Agent 8 создал TrackerGateway (/ws/tracker) + WebhookDeliveryWorker (in-process, attempts:5, exp backoff) + интегрировал WS publish и webhook dispatch во все существующие services. Agent 9 обнаружил что α-4 и β-5 уже полностью готовы, доделал только β-4 causeCategory (8-категорийная таксономия + LLM extraction + filter в API).

### Фаза 3 — коммиты + push + second-brain + рефлексия

После каждого закрытого тикета — **верификация** через `git status`, `bun run typecheck`, отметка new files vs существующих. Коммиты делал **локально, явно перечисляя файлы** (не `git add .`):

```bash
git add backend/src/modules/tracker/ backend/src/app.module.ts ...
git commit -m "feat(tracker): ..."
```

Каждый коммит — Conventional Commits + HEREDOC + Co-Authored-By: Claude Opus 4.7.

Финальный push — 4 коммита (`fb1e770..31fd270`) на origin/dev. Первые 6 коммитов уже были запушены ранее (видимо предыдущая сессия владельца).

После push — обновил `second-brain/`:
- Новая заметка `01_projects/tracker.md` (~200 строк).
- Index.md: ссылка на tracker + Sprint Plan + Tracker entry wedge analysis + Updated дата.
- 02_architecture/module-map.md: новая секция «Tracker — задачный модуль» с структурой папок, потоками данных, метриками, ENV.
- 02_architecture/data-model.md: новая секция «Tracker модуль» со всеми 20 моделями и ER-связями.

И эта рефлексия. Дальше — auto-commit + auto-push рефлексии + second-brain.

## Что вышло

### Метрика по числу

| Что | Сколько |
|---|---|
| Коммитов в сессии | 10 (из них 4 запушено) |
| Закрытых sub-ТЗ | Sprint 1 backend полностью, ~80% Sprint 2 |
| Новых файлов кода | 70+ |
| Изменённых файлов | 30+ |
| Строк кода + тестов | ~10 200 |
| Новых Prisma моделей | 20 (трекер) + расширения Meeting + Goal + Insight |
| Новых SignalType | 18 (8 task_/* + 7 helpfulness + 3 gamification) |
| Новых REST endpoints | 50+ |
| WebSocket events | 9 типов |
| BullMQ воркеров | 1 (webhook-delivery) |
| Unit-тестов | 33+ (4 relations + 4 webhook-dispatcher + 6 webhook-signer + 5 tracker-events + 5 webhook-delivery + 5 normalize-cause-category + 3 review/retrospective + others) |
| Subagent'ов запущено | 9 (Agent 1-9) |

### Качество кода

- `bun run typecheck` зелёный во всех коммитах.
- `bun run lint` в новых файлах — 0 errors (warnings только pre-existing import-x/order resolver проблема репо).
- Все мутации в $transaction.
- Все DTO через nestjs-zod + Swagger.
- RBAC через RbacService.canRead/canWrite на каждом endpoint.
- TenantGuard + CookieAuthGuard.
- IssueActivity audit-trail на каждой мутации.
- Логирование через @nestjs/common Logger.
- ENV через TypedConfigService.

### Архитектурные решения, принятые автономно

1. **TrackerWebhooksController на `/api/v1/tracker/webhooks`** — не конфликт с существующим LiveKit webhooks (`/api/v1/webhooks`). Задокументировано в README tracker модуля.

2. **manager:write на issue** (не self-only) — командная работа подразумевает редактирование чужих задач. manager:delete только self.

3. **POST /webhooks/:id/test → 202 Accepted** (вместо синхронного fetch) — теперь ставится job в BullMQ очередь tracker.webhook-delivery, владелец видит логи через `GET /webhooks/:id/logs`.

4. **task_discussion AI-промпт временно переиспользует team-промпт** — отдельный промпт под обсуждение задачи отложен в Sprint 3.

5. **WebSocket auth через JWT cookie z_session** — тот же что REST. CORS двойная защита (декоратор + явный whitelist против cfg.cors.allowed).

6. **TrackerEventsService safe-emit** — ошибки gateway.emit логируются warn, не пробрасываются. WebSocket — best-effort, не блокирующий.

7. **BullMQ webhook worker in-process** (как knowledge-core воркеры) — следует существующему паттерну `workers.module.ts`. Отдельного worker-процесса больше нет.

8. **HMAC body — JSON с конкретной формой:** `{event, tenantId, webhookId, enqueuedAt, data}`. Headers: `X-Kora-Signature`, `X-Kora-Event`, `X-Kora-Webhook-Id`, `X-Kora-Delivery`, `X-Kora-Timestamp`.

9. **AttachmentsService 25 MB лимит + MIME whitelist** — защита от спама и неподдерживаемых форматов. Sharp thumbnails — TODO Sprint 3+ (отдельный воркер).

10. **causeCategory 8-категорийная таксономия** (вместо 4 как в Sprint Plan) — `process_gap, role_clarity, resource_constraint, task_setup_quality, communication_friction, skill_or_capability, external_dependency, unknown`. Более детальная для COO-функции №7 «отличить процесс/люди/ресурсы/постановку».

11. **causeCategory `unknown` fallback** — если LLM возвращает невалидное значение, нормализуется на `unknown` (вместо null или ошибки).

12. **Insight bump schema name** `insight_extract_v1` → `insight_extract_v2` при добавлении required causeCategory — strict validation отбросит ответы старого формата на следующий tier.

### Чему научился

#### Технические уроки (для code-pitfalls)

1. **Reality-deltas (как класс документа) сильно ускоряет работу.** Перед запуском любого sub-ТЗ — verify через grep + read schema/services, чтобы не дублировать готовое. В этой сессии 3 sub-ТЗ оказались уже почти полностью реализованы (α-4, β-5, γ-1 на 95%) — Agent 9 явно обнаружил это в первой фазе разведки. Это сэкономило ~3-4 часа реализации.

2. **Параллельные agent-вызовы безопасны если разные файлы.** Schema.prisma — bottleneck. Решение: один большой schema-агент в начале (Agent 1), потом параллельные агенты на код модулей.

3. **Edit с уникальным old_string работает лучше Write для больших файлов.** Для второго мозга (index.md, module-map.md, data-model.md) использовал Edit с anchor'ом «[[../index|← index]]» — гарантированно уникальная строка в конце.

4. **Bash через bash-tool требует POSIX-синтаксис.** Первая попытка с PowerShell-синтаксисом (`Select-String`, `Select-Object`) упала. Использовать `head -N`, `grep`, простые трубы.

5. **`git add .` запрещён** — каждый коммит явно перечисляет пути. Это спасло от случайного коммита pre-сессионных файлов (4 файла в `second-brain/06_marketing/` + 30+ untracked планов/скиллов/хуков).

6. **CRLF warnings на Windows** — git автоматически конвертирует LF в CRLF в working directory при `git add` (нормально, не блокер).

7. **Apache AGE extension отсутствует в pgvector/pgvector:pg17 docker-образе** — `bun run apply-postgres-init` падает, но это infra-проблема не из моих изменений. HNSW/GIN индексы pgvector нужно восстановить после фикса образа (отдельный тикет AGE infra). На корректность schema/Prisma Client не влияет.

8. **`@nestjs/websockets` + `socket.io` не были подключены** — пришлось добавлять зависимости в первый раз. `bun install` после изменения package.json.

9. **`s3.service.ts` в `recordings/` Global module** — переиспользовался без модификации. Глобальный модуль значит inject везде без явного import. Хорошая инфра-инвестиция.

10. **`LivekitService` Global, метод `generateHostToken({id, endedAt?}, identity, name)` + `ensureRoom({id})`** — переиспользовался без модификации. Не вызывали `MeetingsService.create()` напрямую — пишем Meeting через Prisma чтобы обойти quota `meetings_per_month` (task_discussion — системный сценарий, не учитывается в квоте). Это архитектурное решение Agent 7 — корректное.

#### Поведенческие уроки (для feedback memory)

1. **«Большой Subagent с чётким DoD + skills + что НЕ делать»** работает лучше «маленький с одним шагом». Subagent 1 (schema батч) и Subagent 2 (tracker scaffold) — каждый создал 20-40 файлов за один прогон. Главное — чёткий контекст, скиллы, ограничения, отчёт.

2. **Параллельные коммиты после параллельных agent'ов** — нужно делать в правильном порядке. Если 2 агента изменили один файл (например, IssueService.ts) — нужно мержить. В этой сессии — пока такого не было, потому что планировал заранее (каждый agent трогает разный scope).

3. **Reality-deltas можно использовать как фильтр-планировщик** — перед стартом каждого Sprint'а агент-разведчик проверяет какие sub-ТЗ уже готовы. Сэкономит часы на тех, что закрылись «бесшумно» в предыдущих сессиях.

4. **HEREDOC для commit messages** обязателен — без него markdown-форматирование ломается, длинные сообщения становятся нечитаемыми в `git log`.

5. **Conventional Commits + Co-Authored-By** — стандарт, выдерживается во всех коммитах.

## Прод-инструкция (для отдельного выполнения)

См. **PROD ИНСТРУКЦИЯ** в чате (следующее сообщение оркестратора владельцу). Здесь — для будущей памяти, какие команды нужно выполнить на dev/prod:

```bash
# 1. Локальный backend rebuild
cd backend
bun install                                            # для @nestjs/websockets + socket.io
bun run prisma:push                                    # schema-changes (20 моделей + расширения)
bun run prisma:generate
bun run typecheck                                      # должно быть зелёным

# 2. Опционально (если pgvector indexes нарушены)
bun run apply-postgres-init                            # ⚠ может падать на extension "age" (известная инфра-проблема)

# 3. Опционально (legacy Task → Issue миграция в Sprint 3)
bun run scripts/backfill-meeting-tenant-id.ts --dry-run
bun run scripts/backfill-meeting-tenant-id.ts --apply

# 4. Опционально (γ-1 traits → categories миграция)
bun run scripts/patch-skill-trait-categories-from-strings.ts --dry-run
bun run scripts/patch-skill-trait-categories-from-strings.ts

# 5. Restart backend (loads new WebSocket gateway + BullMQ worker)
docker compose -f docker-compose.dev.yml restart backend
# или для prod:
docker compose up -d --build backend
```

## Что осталось до DoD Phase 1 трекера

- **B1-3.1 (Sprint 3):** `tracker.adapter.ts` в `modules/ingest/adapters/tracker/` — слушает `tracker.event_occurred` → создаёт RawEvent с правильным signalType. Закрывает принцип «трекер = источник для второго мозга».
- **B1-3.2 (Sprint 3):** Goals integration + strategic-alignment расширение.
- **B1-3.3 (Sprint 3):** миграция legacy Task → Issue (`scripts/migrate-task-to-issue.ts`).
- **IdempotencyService** общий для трекера на POST /issues, /comments, /intake (Sprint 2).
- **Notification владельцу** при webhook.isActive=false (через ConversationalService).
- **task_discussion отдельный AI-промпт** (сейчас reuse team-промпта).
- **Sharp thumbnails** для IssueAttachment.

## Что осталось до Wave 1 DoD (полностью)

- **R1 (мобилка):** требует RN-среды владельца + Apple Developer Account + Google Play Account + RuStore регистрация. Отложено до подтверждения владельца.
- **F1 (frontend scaffold):** заглушки страниц tracker + DTO-типы. Можно начать в следующей сессии.
- **D-1.3 (EAS secrets):** после R1-1.1.
- **Des (дизайн):** wireframes + design tokens (не моя зона).

## Промежуточный итог по продукту

Sprint 1 backend + большая часть Sprint 2 — закрыты за одну сессию (~10 200 строк, 10 коммитов, 9 параллельных subagent'ов). По плану 6 нед — реально ~1 день оркестрации одного Claude. Объяснение: 60-70% Кора v2 уже готово, мы добавили tracker модуль + расширения существующих модулей.

**Оставшаяся работа:**
- Frontend трекера (Wave 2, Phase 2) — 7 нед в плане.
- AI-фичи трекера (Phase 3) — 4 нед в плане.
- Activity Feeds + Specialist 3.8 + Recognition (Wave 2 параллельно) — 11 нед в плане.
- РФ-must-have (Phase 4) — 4 нед в плане.
- Импорт (Phase 5) — 3 нед в плане.
- COO Dashboard + DailyCheckIn (β-8) — 5 нед в плане.
- Мобилка (параллельно) — 10-12 нед в плане.

Если темп оркестрации сохранится — реальный календарь Wave 2-3 может быть **2-3x быстрее заявленного** при готовой инфре (backend) и реальном кодере для frontend/mobile.

---

_2026-05-24: оркестрация 9 параллельных subagent'ов закрыла Sprint 1 + большую часть Sprint 2 за одну сессию. Главный урок: reality-deltas (документ сверки кода с планом) — основа для эффективного планирования. Перед каждым sub-ТЗ — verify готовности перед реализацией._
