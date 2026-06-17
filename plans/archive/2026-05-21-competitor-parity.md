---
type: tz
status: done
feature: Паритет с российскими конкурентами по post-meeting фичам
date: 2026-05-21
umbrella: true
children:
  - tz/2026-05-21-phase-A-prompt-registry-admin.md (draft, создан 2026-05-21)
  - tz/2026-05-21-phase-B-meeting-behavior-metrics.md (draft, создан 2026-05-21)
  - tz/2026-05-21-phase-C-meeting-quality-score.md (draft, создан 2026-05-21)
  - tz/2026-05-21-phase-D-transcript-cleaning.md (draft, создан 2026-05-21)
  - tz/2026-05-21-phase-E-multi-report-per-meeting.md (draft, создан 2026-05-21)
related:
  - second-brain/06_marketing/competitors.md (карта конкурентов)
---

# ТЗ: Паритет с российскими конкурентами по post-meeting фичам (зонтичный документ)

> **Это зонтичный документ.** Он фиксирует цель, scope и карту пяти sub-TZ. Сами sub-TZ (A, B, C, D, E) — отдельные документы; этот файл — точка контроля «ничего не потеряли» **до** старта работы.
>
> **Контекст-источник:** разведка конкурентов 2026-05-21 (mymeet.ai с конструктором ИИ-отчётов от 20.05.2026, FollowUp.tech, Таймлист, НаВстрече, Яндекс Телемост). Сводка по гэпам — в [second-brain/06_marketing/competitors.md](../../second-brain/06_marketing/competitors.md).
>
> **При расхождениях** между этим документом и sub-TZ — приоритет у конкретного sub-TZ. При расхождениях с positioning/messaging (06_marketing/) — приоритет у positioning.

---

## 1. Цель

После закрытия всех 5 sub-TZ Z **достигает функционального паритета** с лидером российского рынка post-meeting AI (mymeet.ai) и опережает по гэпам, которые есть только у FollowUp/Таймлиста. При этом сохраняет уникальное преимущество — knowledge-core (память компании) — никто из конкурентов этого не делает.

**После паритета пользователь Z получает:**
1. Возможность редактировать и создавать шаблоны AI-отчётов из админки **без релиза** (как mymeet).
2. Метрики поведения участников: время говорения, монологи, вопросы, слова-паразиты, прерывания (как mymeet+FollowUp).
3. AI-оценку качества встречи с рекомендациями руководителю (как FollowUp).
4. Очищенный от слов-паразитов транскрипт по тумблеру (как mymeet).
5. Возможность сделать несколько разных AI-отчётов на одну встречу (как mymeet+FollowUp).

---

## 2. Scope

### Входит

- **Конструктор шаблонов AI-отчёта в админке** (sub-TZ A) — БД-registry для промптов, версионирование, A/B, до 30 разделов с независимыми инструкциями ИИ, кастомные шаблоны на уровне Org. Перенос всех существующих 9 типов встреч из кода в БД как «системные» шаблоны с code-fallback.
- **Метрики поведения участников** (sub-TZ B) — новый воркер `ai.behavior-metrics`, модель `MeetingBehaviorMetrics`. Минимум 8 метрик на участника + 6 общих. UI-секция на странице результата + org-roll-up для дашборда.
- **AI-оценка качества встречи** (sub-TZ C) — новый `taskType='meeting-quality-score'`, расширение `AiResult` или отдельная модель `MeetingQualityScore`. Общий балл (0–100) + категории + рекомендации руководителю. UI-виджет + org-trend.
- **Очистка транскрипта** (sub-TZ D) — расширение `Transcript`: поле `cleanedS3Url`. Воркер `ai.transcript-clean` (или inline-этап в `ai.merge` по флагу). UI-toggle «Показать очищенный». Оригинал не разрушается.
- **Несколько AI-отчётов на одну встречу** (sub-TZ E) — модель `MeetingReport` (one-to-many от `Meeting`). API создать дополнительный отчёт по выбранному шаблону. Текущий `AiResult` остаётся как primary-отчёт по `Meeting.type`.

### Не входит

- Открытие админки промптов для конечных пользователей всех тарифов — gating через `Entitlements` (только Pro / Business), см. sub-TZ A §11.
- Промпты в стиле mymeet «Medicine» (медицинский приём) и узкие отраслевые шаблоны — пользователь добавит их сам через конструктор.
- Real-time подсветка поведения во время встречи (live coach) — после паритета, в отдельной фазе.
- Перевод/мультиязычность шаблонов — только русский (см. memory `feedback_admin_ui_russian_only`).
- Авто-определение типа встречи по содержимому (вместо ручного выбора) — отдельная фаза, не блокирует паритет.
- Цифровой двойник / Employee Clones / роль AI Value Director — продолжают свою фазу 9 (`plans/tz/2026-05-10-phase-9-goals-strategic-alignment.md`), не пересекаются.

---

## 3. Матрица «гэп → sub-TZ → бизнес-результат»

| # | Конкурент-гэп | Кто закрывает у конкурентов | sub-TZ Z | Бизнес-результат |
|---|---|---|---|---|
| 1 | Шаблоны AI-отчёта редактируются из UI, можно создавать свои | mymeet (конструктор 20.05.2026, до 30 разделов), FollowUp (блоки) | **A** | Pro/Business клиенты ведут шаблоны сами без релиза; sales и solution-инжиниринг показывают «свой шаблон под клиента» |
| 2 | Метрики поведения участников | mymeet (40+ метрик), FollowUp (тональность) | **B** | Руководители видят «кто доминирует, кто молчит» — впервые в Z |
| 3 | AI-оценка качества встречи и рекомендации руководителю | FollowUp, Таймлист | **C** | Дифференциатор перед mymeet (у них этого нет в явном виде); материал для дашборда CEO |
| 4 | Очистка транскрипта от слов-паразитов и повторов | mymeet | **D** | Транскрипт читаемый «как статья» — закрывает обиду «у конкурентов читается, у вас — нет» |
| 5 | Несколько отчётов на одну встречу | mymeet | **E** | Один и тот же sales-разговор → отчёт для продавца + отчёт для маркетинга. Прямой апсейл |

---

## 4. Карта sub-TZ

| sub-TZ | Файл | Зависит от | Сложность (грубо) | Можно параллелить |
|---|---|---|---|---|
| **A** Prompt registry + админка шаблонов | [`2026-05-21-phase-A-prompt-registry-admin.md`](2026-05-21-phase-A-prompt-registry-admin.md) | — | L (~5–7 дн) | да, но E ждёт A |
| **B** Метрики поведения | [`2026-05-21-phase-B-meeting-behavior-metrics.md`](2026-05-21-phase-B-meeting-behavior-metrics.md) | — | M (~3 дн) | да |
| **C** AI-оценка качества | [`2026-05-21-phase-C-meeting-quality-score.md`](2026-05-21-phase-C-meeting-quality-score.md) | A (промпт через registry) — мягкая | S (~2 дн) | да, после первой версии A |
| **D** Очистка транскрипта | [`2026-05-21-phase-D-transcript-cleaning.md`](2026-05-21-phase-D-transcript-cleaning.md) | — | S (~1–2 дн) | да |
| **E** Несколько отчётов на встречу | [`2026-05-21-phase-E-multi-report-per-meeting.md`](2026-05-21-phase-E-multi-report-per-meeting.md) | **A** (нужна библиотека шаблонов) | M (~2–3 дн) | нет, после A |

**Рекомендуемый порядок:**
- Спринт 1 (паралл.): A.1 (схема + миграция промптов из кода), B, D.
- Спринт 2: A.2 (админка-UI), C.
- Спринт 3: A.3 (Org-overrides + A/B), E.

---

## 5. Общие принципы (одинаковы для всех sub-TZ)

Это разделение, чтобы не дублировать в каждом из 5 файлов. Любой sub-TZ обязан соблюдать.

### 5.1. Backend (NestJS)
- DTO-цепочки `ApiDto → DomainModel → UiModel` (skill `frontend-rules`), Zod-схемы через `nestjs-zod`, Swagger обязателен.
- Любой эндпоинт с `@UseGuards(JwtAuthGuard, TenantGuard, CasbinGuard)`, кроме явно публичных.
- `tenantId` — обязательный фильтр, никогда не доверять входу.
- Все ENV — через `TypedConfigService` / `env.schema.ts`. **Никаких `process.env.*` в коде** (skill `nestjs-rules`).
- Транзакции — через Prisma `$transaction` для всех мульти-сущностных записей.
- Логирование — pino с `requestId`, `tenantId`, `meetingId`.
- Метрики prom-client с префиксом `z_competitor_parity_*`.

### 5.2. База данных
- **Только** `bun run prisma:push`, **никогда** `prisma migrate*` (skill `prisma-db-push-rules`).
- После любой правки моделей — `bun run prisma:generate`.
- Все новые таблицы — с `tenantId String NOT NULL` (multi-tenancy) и индексом `@@index([tenantId])`.
- Soft-delete через `deletedAt DateTime?` для всех редактируемых из админки сущностей.
- pgvector-индексы (HNSW/GIN) — не в `schema.prisma`, а в `apply-postgres-init` скрипте.

### 5.3. AI / LLM
- Все промпты — через `LlmRouterService`, `taskType` регистрируется в `LlmTaskType` enum + seed.
- **Code fallback обязателен** для каждого промпта (skill `z-ai-agent-rules`) — даже если promo registry в БД сломан, воркер должен работать.
- `dataClass` — обязательный параметр: `internal` для всего, что про встречи; `sensitive` если есть PII в выходе.
- Каждый вызов LLM → `AiUsageLog` (это уже работает в роутере, ничего нового).
- Никаких таймаутов в коде — LlmRouter сам управляет.
- **3-уровневая цепочка провайдеров обязательна для каждого нового `taskType`** — см. решение Q9 ниже. Источник кандидатов и цепочек — [docs/reference/llm-models-playbook.md](../../docs/reference/llm-models-playbook.md). Это же правило закреплено в [umbrella SBA §3.7 + §5.11](2026-05-21-second-brain-agents-umbrella.md) для всех агентов второго мозга — competitor-parity следует тому же стандарту, чтобы у нас не было двух разных способов регистрации агентов.

### 5.4. Frontend (Next.js App Router)
- Слоистая модель `ApiDto → DomainModel → UiModel` (skill `frontend-rules`).
- Единый `apiClient`, никаких прямых `fetch`.
- Все UI-строки на русском (memory `feedback_admin_ui_russian_only` + `second-brain/13_glossary/ui-glossary.md`). Никаких английских слов в UI пользователя, кроме явных терминов из глоссария.
- SWR для data-fetching. ErrorBoundary + loading skeleton — каждый новый компонент.

### 5.5. RBAC
- Расширить `ResourceType` enum для каждой новой редактируемой сущности (`prompt_template`, `report_template`, `meeting_quality_score` и т.д.).
- Permissions в `policies/policy.csv`: read для member, write/delete — owner/admin. Z-Admin (`super_admin`) — везде.
- Entitlements: каждая фича из A/B/C/D/E связана с feature flag в `Entitlement` модели (см. sub-TZ A §11 для шаблонов).

### 5.6. Тесты
- `bun run typecheck` + `bun run lint` + `bun run build` — zero warning, blocking для merge.
- `vitest`: unit на сервисы, integration на воркеры, e2e — на критичные эндпоинты.
- Pre-flight в каждом sub-TZ DoD: ≥1 integration-тест на полный happy-path.

### 5.7. Documentation
- Каждый sub-TZ обязан создать или обновить заметку в `second-brain/01_projects/`.
- При расширении схемы — обновить `second-brain/02_architecture/data-model.md`.
- При новом эндпоинте — `second-brain/01_projects/api-layer.md`.
- При новом воркере — `second-brain/01_projects/workers-queues.md` + `second-brain/01_projects/ai-jobs.md`.
- После закрытия — рефлексия в `second-brain/05_история/YYYY-MM-DD-<sub-tz>-итог.md`.

---

## 6. Решённые принципиальные вопросы (фиксация для всех sub-TZ)

### Q1. Где хранить промпты после паритета — в коде или в БД?

**Решение:** В БД (`PromptTemplate` + `PromptTemplateVersion`), с code fallback для каждого системного шаблона. См. sub-TZ A §3. Это закрывает skill `z-ai-agent-rules`, который пока в коде только в правилах, но не в реализации.

### Q2. Шаблоны AI-отчёта и `MeetingType` — это одно и то же или разные сущности?

**Решение:** Разные. `MeetingType` остаётся как **системный enum** (9 значений + 2 фаза-0) для категоризации встречи. `ReportTemplate` — **новая сущность** «как обрабатывать встречу AI». По умолчанию: `Meeting.type=sales` → `ReportTemplate=sales_default` (системный). Пользователь может назначить любой другой `ReportTemplate` любой встрече (даже неподходящей по type), и через sub-TZ E — несколько `ReportTemplate` на одну встречу.

### Q3. Метрики поведения — отдельный воркер или часть analyze?

**Решение:** Отдельный воркер `ai.behavior-metrics` (sub-TZ B), запускается параллельно `ai.analyze` после `ai.merge`. Это не LLM-задача (чисто детерминистский анализ tracks + текста). Не зависит от готовности `AiResult`, может выйти раньше или позже. UI должен корректно отрисовывать «метрики готовы, отчёт ещё в обработке» и обратное.

### Q4. AI-оценка качества — секция в существующем AiResult или отдельная сущность?

**Решение:** Отдельная сущность `MeetingQualityScore` (один к одному с `Meeting`). Причины: (а) считается отдельным `taskType`, (б) можно регенерировать независимо, (в) на дашборде нужен прямой запрос «средний score по Org за период», не доставая весь `AiResult`.

### Q5. Несколько отчётов — как соотносится с регенерацией секции?

**Решение:** Это разные механики.
- `POST /:id/regenerate-section` — перегенерирует **одну секцию** в primary-отчёте (текущий `AiResult`). Остаётся как есть.
- `POST /:id/reports` (новый, sub-TZ E) — создаёт **новый отчёт** по другому шаблону. Primary не трогает.
- `AiResult` остаётся primary-сущностью для legacy. `MeetingReport` — новая, для пользовательских отчётов.

### Q6. Очистка транскрипта — деструктивная или нет?

**Решение:** Не деструктивная. Оригинал `Transcript.mergedS3Url` не трогаем никогда. Новый файл — `Transcript.cleanedS3Url`. UI по умолчанию показывает оригинал; toggle «Очистить от слов-паразитов» переключает на cleaned. Если cleaning не запущен — toggle disabled.

### Q7. Метрики на гостях — считаем или нет?

**Решение:** Считаем для всех, кто заговорил (есть `AudioTrack`). Гость без аккаунта = `participantId` есть, `userId` нет — отдельная категория «Гость: <displayName>» в UI. См. sub-TZ B §6.

### Q8. Cleaned-транскрипт для AI-pipeline — использовать или нет?

**Решение:** **Нет.** AI-pipeline (`analyze`, `chapters`, `tasks`) всегда работает с оригиналом `mergedS3Url`. Cleaning — только для отображения пользователю. Причина: AI лучше понимает контекст с междометиями (паузы, эмоции), а cleaning теряет это.

### Q9. LLM-провайдеры — трёхуровневая цепочка + админка моделей (обязательное правило)

**Решение.** Каждый новый `LlmTaskType`, создаваемый в этой ветке (B `behavior-refine`, C `meeting-quality-score`, D `transcript-clean-refine`, E `custom-report:*`), а также все системные taskType'ы из sub-TZ A (после миграции из кода) обязаны иметь **минимум 3 уровня провайдеров** и быть **видимыми в админке** Z-Admin.

**Три уровня (стандарт из [umbrella SBA §3.7](2026-05-21-second-brain-agents-umbrella.md#37-llm-provider-routing-—-трёхуровневая-подстраховка--admin-переключение-per-agent) и [playbook §11](../../docs/reference/llm-models-playbook.md#11-fallback-chain)):**

| Уровень | Назначение | Дефолтные кандидаты по playbook |
|---|---|---|
| **Primary (рабочий)** | Лучшее качество/цена по результатам тестов | `deepseek-v4-flash` (общий поток), `deepseek-v4-pro` (тяжёлый reasoning — quality-score, regenerate отчёта), `gpt-5.4-nano` (короткие классификаторы — behavior-refine, transcript-clean-refine) |
| **Secondary (если что-то пошло не так)** | Другой провайдер той же категории — переключается при ошибке/timeout primary | `gpt-5.4-mini` / `gpt-5.4` через `proxy.agent-lia.ru` |
| **Tertiary (когда связи нет)** | Local fallback — гарантирует работу при полном отказе внешних провайдеров | `qwen3.5:9b` через self-hosted `ollama.agent-lia.ru` |

**Применение в этом зонтике (касается всех 5 sub-TZ):**

1. **Каждый sub-TZ обязан** включать seed-script `seed-llm-task-routes-<phase>.ts` (по skill `safe-seed-rules`) с тремя provider'ами per-taskType.
2. **Каждый seed-script ссылается** в комментарии на конкретный раздел [playbook](../../docs/reference/llm-models-playbook.md) — какие модели тестировались, по каким метрикам выбрана данная цепочка.
3. **Все три provider'а** должны проходить фильтр по `maxDataClass` (если task работает с `sensitive` — все три не ниже `sensitive`).
4. **Tertiary обязательно local** — для встреч это `qwen3.5:9b` через Ollama. Если задача не вытягивается на qwen — переоцениваем дизайн фичи (возможно, нужно более простое решение).
5. **Sub-TZ A берёт на себя реализацию админки** (см. §A.4) — отдельная фаза, видна в `/admin/ai-models`. Sub-TZ B/C/D/E только регистрируют свои taskType'ы через seed (UI уже готов).

**Связь с Sub-TZ A (Prompt Registry):**
- В админке шаблонов `PromptTemplate` + цепочка моделей идут **рядом** (одна страница). Пользователь видит: «Шаблон Sales — primary DeepSeek-flash, secondary GPT-5.4-mini, tertiary qwen3.5:9b. Переключить → отправить на 20% трафика GPT-5.4».
- Это означает: модель Prisma `LlmTaskRoute` (или новая `PromptTemplateRoute`) расширяется полем `tier` (`primary` / `secondary` / `tertiary`) — детали в sub-TZ A §4 + §A.4.

**Жёсткое vs мягкое — где живёт цепочка:**

| Где | Что | Кто меняет | Эффект |
|---|---|---|---|
| **Код** (seed-script `seed-llm-task-routes-*.ts`) | Дефолтный пресет «из коробки» — только при первой инициализации БД (`MetaConfig.seedAppliedAt`). Идемпотентен: на повторный запуск НЕ перезаписывает уже отредактированные через UI цепочки | Разработчик через PR + ссылка на playbook | Только новые установки получают этот пресет; на старых нужно явно вызвать `--reset` |
| **БД** (`LlmTaskRoute` + `LlmTaskRouteChange`) | **Источник правды.** `LlmRouterService` читает отсюда на каждом вызове (с кэшем 60 сек, см. существующий код) | super_admin / owner через `/admin/ai-models` | Изменение применяется в течение 60 сек ко всем новым LLM-вызовам, без релиза кода |

**Свобода выбора в админке (sub-TZ A.4 гарантирует):**
- Любая модель из карты provider'ов ([playbook §2](../../docs/reference/llm-models-playbook.md#2-карта-моделей-кандидатов)) — DeepSeek / GPT-* / Claude / MiniMax / Ollama / KIA / Gemini — может быть поставлена в любой tier любого taskType, если `maxDataClass` provider'а ≥ `dataClass` taskType.
- Drag-n-drop порядка моделей внутри tier'а (поле `priority`).
- Свап tier'ов (primary↔secondary↔tertiary) одной операцией.
- Можно держать 1, 2, 3, 4, 5+ provider'ов в одной цепочке.
- Можно убрать целый tier (например, отказаться от tertiary) — UI покажет warning о потере отказоустойчивости, но не заблокирует.
- Можно вернуть зашитый код-дефолт одной кнопкой «Сбросить к playbook-дефолту».

Дефолтные таблицы в sub-TZ B/C/D/E ниже — это **только seed-пресет**, не constraint. Они показывают «как мы рекомендуем стартовать» с обоснованием из playbook.

---

## 7. Матрица прослеживаемости

Каждый sub-TZ закрывает строки. Перед мержем зонтика проверяем, что все строки в одном из sub-TZ.

| # | Требование | sub-TZ |
|---|---|---|
| 1 | Промпты редактируются из админки без релиза | A |
| 2 | Версионирование промптов (rollback к старой версии) | A |
| 3 | A/B-тестирование двух версий промпта | A |
| 4 | До 30 разделов в одном шаблоне с независимыми инструкциями | A |
| 5 | Перенос 9 существующих типов встреч в registry как системные шаблоны | A |
| 6 | Код в `ai/services/prompts/type-*.ts` становится code-fallback | A |
| 7 | Org-level кастомные шаблоны (видны только своей компании) | A |
| 8 | Системные шаблоны нельзя удалить (но можно скопировать в Org) | A |
| 9 | Связь `AiResult.promptTemplateVersionId` для проследить, какой версией сгенерирован отчёт | A |
| 10 | Entitlement-гейт: конструктор только Pro/Business | A |
| 11 | Метрика speakingTimeMs per-participant | B |
| 12 | Метрика monologueCount (turn ≥60 сек) per-participant | B |
| 13 | Метрика questionCount (heuristic + LLM-уточнение) per-participant | B |
| 14 | Метрика fillerWordsCount per-participant + общая | B |
| 15 | Метрика interruptionsCount per-participant | B |
| 16 | Метрика turnsCount per-participant | B |
| 17 | Метрика silenceMs (общая) | B |
| 18 | Метрика crossTalkMs (общая) | B |
| 19 | UI-секция «Поведение участников» с гистограммами | B |
| 20 | Org-aggregation: средние метрики по периоду | B |
| 21 | Voicelog для гостей с `displayName` | B |
| 22 | Воркер `ai.behavior-metrics` независим от `ai.analyze` | B |
| 23 | Модель `MeetingQualityScore` 1:1 с Meeting | C |
| 24 | Балл 0–100 (overall) | C |
| 25 | Категории: preparation/structure/clarity/outcomes/engagement | C |
| 26 | Рекомендации руководителю в формате `[{ text, severity, category }]` | C |
| 27 | Промпт `meeting-quality-score` в registry с code-fallback | C |
| 28 | UI-виджет на странице результата | C |
| 29 | Org-trend: средний score за период по `Meeting.type` | C |
| 30 | Регенерация quality-score независимо от основного отчёта | C |
| 31 | Опция отключить quality-score для конкретного типа встречи (entitlement-flag) | C |
| 32 | Поле `Transcript.cleanedS3Url` | D |
| 33 | Воркер `ai.transcript-clean` | D |
| 34 | Алгоритм: filler words + repeats + false starts (через LLM или детерминистский) | D |
| 35 | Тайм-коды сохраняются (mapping старый→новый) | D |
| 36 | UI-toggle «Очистить от слов-паразитов» | D |
| 37 | Cleaned-транскрипт НЕ используется AI-pipeline (только для UI) | D |
| 38 | Опционально: cleaning запускается автоматически (org-setting) | D |
| 39 | Модель `MeetingReport` (many от Meeting) | E |
| 40 | `POST /meetings/:id/reports` создать новый отчёт по выбранному template | E |
| 41 | `GET /meetings/:id/reports` список отчётов по встрече | E |
| 42 | UI: вкладка «Отчёты» со списком + кнопка «Добавить отчёт» | E |
| 43 | Primary-отчёт (`AiResult` по `Meeting.type`) помечен флагом, отображается первым | E |
| 44 | Регенерация конкретного отчёта в библиотеке независимо | E |
| 45 | Лимит на количество отчётов на встречу по тарифу | E |
| 46 | Каждый новый `taskType` зарегистрирован через `seed-llm-task-routes-<phase>.ts` с 3 уровнями provider'ов | A, B, C, D, E |
| 47 | Каждый seed-script ссылается в комментарии на раздел [playbook](../../docs/reference/llm-models-playbook.md) с обоснованием выбора | A, B, C, D, E |
| 48 | `LlmTaskRoute` расширена полем `tier` (`primary` / `secondary` / `tertiary`) | A |
| 49 | `AiUsageLog` логирует `tier` использованного provider'а — для аналитики «какой % запросов ушёл в fallback» | A |
| 50 | Tertiary всегда local (Ollama `qwen3.5:9b`); проверено что задача вытягивается на qwen | A, B, C, D, E |
| 51 | Страница `/admin/ai-models` показывает per-taskType цепочку (primary/secondary/tertiary), метрики (cost/latency/success), кнопку «переключить primary», A/B-эксперимент per-agent | A |
| 52 | Все три provider'а в цепочке проходят фильтр по `maxDataClass` для своего taskType | A |
| 53 | При полном отказе всех трёх — `NoEligibleProviderError` + метрика `core_llm_no_provider_total{taskType}` + retry через час (без падения воркера) | A |

---

## 8. DoD зонтика

- [x] Все 5 sub-TZ доведены до `status: done`.
- [x] Все 45 строк матрицы прослеживаемости — `[x]` в одном из sub-TZ.
- [x] `bun run typecheck && bun run lint && bun run build` зелёные на dev-окружении.
- [x] Интеграционный тест end-to-end: создать встречу → завершить → дождаться все воркеры → AiResult + MeetingBehaviorMetrics + MeetingQualityScore + cleanedS3Url + создать дополнительный MeetingReport — всё успешно.
- [ ] Demo-сценарий для sales: запись на 30-минутной встрече, прохождение всех 5 фич, обнаружить отличия от mymeet.ai в свою пользу.
- [ ] `second-brain/06_marketing/competitors.md` обновлён — статус «закрыто» по строкам 1–5 матрицы.
- [ ] Рефлексия в `second-brain/05_история/YYYY-MM-DD-competitor-parity-итог.md`.

---

## 9. Риски и митигации

| Риск | Тяжесть | Митигация |
|---|---|---|
| Конструктор шаблонов в админке сложнее, чем кажется (form-builder с 30 разделами) | высокая | Sub-TZ A разбит на 3 этапа: A.1 (registry+migration), A.2 (Admin UI базовый — список + редактор разделов), A.3 (Org-overrides + A/B). Релизим инкрементально |
| Метрики поведения требуют точной диаризации; Vox даёт ~95% точности | средняя | Sub-TZ B §8: метрики считать только при `merged.json.diarizationConfidence ≥ 0.85`, иначе показывать «Метрики недоступны: качество диаризации низкое» |
| Quality-score может звучать обидно для участников (например, «низкая структура») | средняя | Sub-TZ C §6: визуально показываем только хосту (`Meeting.ownerId`) и Org-Admin'у. Гости — нет доступа |
| Cleaning ломает тайм-коды для скроллинга по транскрипту | высокая | Sub-TZ D §5: cleaning сохраняет mapping `originalOffset → cleanedOffset`, скроллинг работает в обоих |
| Несколько отчётов экспоненциально увеличивают LLM-cost (если все генерить автоматически) | высокая | Sub-TZ E §7: автоматически генерируется ТОЛЬКО primary-отчёт (как сейчас). Дополнительные — только on-demand по кнопке «Сгенерировать ещё один отчёт по шаблону X» |
| Перенос 9 кодовых промптов в БД ломает работу analyze.worker | критичная | Sub-TZ A §4: миграция с обязательным fallback — если в БД нет PromptTemplate с key=`type-sales`, используется код из `ai/services/prompts/type-sales.ts`. Сначала seed → проверка → код-fallback оставляем навсегда |
| Конкурент перегонит за время разработки (mymeet релизит каждые 2–4 недели) | средняя | Уникальные дифференциаторы (knowledge-core, AI-чат org-scope, strategic alignment) уже работают — паритет не может быть единственным аргументом. Маркетинг качает уникальное, паритет закрывает «обиду» |

---

## 10. Что обновить ПОСЛЕ закрытия

1. [second-brain/06_marketing/competitors.md](../../second-brain/06_marketing/competitors.md) — раздел «Что конкуренты делают после встречи», статус Z по каждой строке.
2. [second-brain/06_marketing/positioning.md](../../second-brain/06_marketing/positioning.md) — поправить пункт «отличия от mymeet» (теперь не «у нас лучше шаблоны», а «у нас есть конструктор + knowledge-core, у них только конструктор»).
3. [second-brain/01_projects/ai-analysis-by-type.md](../../second-brain/01_projects/ai-analysis-by-type.md) — отметить, что 9 типов теперь живут в БД, а не в коде.
4. [second-brain/02_architecture/module-map.md](../../second-brain/02_architecture/module-map.md) — добавить `ai-prompts/`, `behavior-metrics/`, `meeting-quality/`, `transcript-clean/`, `meeting-reports/`.
5. [CLAUDE.md](../../CLAUDE.md) — обновить раздел «AI-router и промпты» (новая БД-таблица).
6. Глоссарий [`second-brain/13_glossary/ui-glossary.md`](../../second-brain/13_glossary/ui-glossary.md) — добавить русские термины: «Шаблон отчёта», «Метрики поведения», «Оценка качества встречи», «Очищенный транскрипт», «Дополнительный отчёт».

---

## 11. Итог

_Заполняется по факту, когда все 5 sub-TZ закрыты._

- **Реализовано полностью / частично:** полностью (5/5 sub-TZ закрыты).
- **Что осталось:** —
- **Демо-видео для маркетинга:** _TBD_
- **Ссылка на рефлексию:** plans/analysis/2026-05-22-code-reality-deltas.md (раздел «5 competitor-parity (A-E)»).

## Ревизия от 2026-05-24

**Статус:** done

**Реализовано (фактически, по 5 sub-TZ):**
- **A. Prompt Registry + админка шаблонов** — `PromptTemplate` модель (schema.prisma:4809) + `PromptResolverService` (`backend/src/modules/ai/services/prompt-resolver.service.ts`) + code-fallback adapter (`code-fallback.adapter.ts`) + admin UI `(authenticated)/admin/prompt-templates/`. `PromptExperiment` для A/B (`prompt-experiments.service.ts`). Все 9 системных шаблонов мигрированы из кода в БД с fallback.
- **B. Метрики поведения** — модель `MeetingBehaviorMetrics` (schema.prisma:5353) + модуль `backend/src/modules/behavior-metrics/` + воркер `ai.behavior-metrics` + LLM refine (`behavior-llm-refine.ts`).
- **C. AI-оценка качества** — модель `MeetingQualityScore` (schema.prisma:5446) + модуль `backend/src/modules/quality-score/` + воркер `ai/workers/quality-score.worker.ts` + промпт `meeting-quality-score.ts`.
- **D. Очистка транскрипта** — поле `Transcript.cleanedS3Url` + сервис `transcript-cleaning.service.ts` + LLM refine + воркер `transcript-clean.worker.ts` + UI-toggle.
- **E. Несколько отчётов на встречу** — модель `MeetingReport` (schema.prisma:4986) + модуль `backend/src/modules/meeting-reports/`.
- 3-уровневая LLM-цепочка реализована для всех taskType'ов (primary/secondary/tertiary) через seed-скрипты в `backend/scripts/seed-llm-task-routes-*.ts`.

Все 5 закрытий подтверждены delta-аудитом 2026-05-22 («все 5 competitor-parity (A-E) работают»).

