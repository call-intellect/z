---
type: tz
status: ready-to-implement
feature: learned-clarifications-memory
date: 2026-06-21
owner: Сергей (владелец продукта Кора)
relates_to:
  - plans/analysis/2026-06-21-subject-memory-and-self-learning/99-synthesis.md
  - plans/analysis/2026-06-20-kora-doved-zadach-foundation.md
  - plans/analysis/2026-06-11-proactive-clarifying-questions-probe-research.md
  - plans/tz/2026-06-11-probe-system-upgrade-phase1.md
---
> Анализ: `plans/analysis/2026-06-21-subject-memory-and-self-learning/99-synthesis.md` (Слой 3) · Статус согласования: 2026-06-21 (владелец: «готовь ТЗ, докажи решения»)

# Слой 3 — Выученная память уточнений (самообучение probe на accept/reject/correct)

## Цель + Зачем
**Болезненное состояние:** Кора задаёт уточняющие вопросы, но **однажды выясненное не запоминает** — переспрашивает термины компании, аббревиатуры, разрешённые неоднозначности; не становится умнее со временем. Прямой запрос клиента «Молочные реки» (Д14 «а он учится?», Д16 «обучение на специфике и синонимах») и эталон-документ §Н2/Н3 (`2026-06-20-kora-doved-zadach-foundation.md`).

**Что строим:** слой **выученной памяти уточнений** (`SubjectMemory`). Сигнал (ответ на probe / reject задачи) → агент выводит переиспользуемое правило (термин · разрешённая неоднозначность · предпочтение) → правило хранится с embedding и провенансом → **перед тем как задать вопрос, probe сначала ищет ответ в памяти** (retrieve-before-ask) → правило активируется только если не ухудшает внешнюю метрику (canary + авто-rollback), без ручного одобрения.

**Метрика «решено» (R-метрики, считаются `BusinessMetricsService`):** ↓ доля probe, заданных при наличии подходящего правила (`probe_suppressed_by_memory_total` растёт); ↓ доля «unclear»-ответов; правило, ухудшившее метрику, авто-откатывается.

## REALITY-CHECK (по коду на 2026-06-21)
Проверено чтением (vexp-демон недоступен; Grep/Read):
- **Сигнал accept/correct УЖЕ ловится частично.** `ProbeResponseHandler` ([probe-response.handler.ts:37](../../backend/src/modules/probe/probe-response.handler.ts#L37)) на `notification.responded` зовёт `tryClassifyResponse` (taskType `probe-response-classify`, [probe-response.handler.ts:162](../../backend/src/modules/probe/probe-response.handler.ts#L162)) → получает `{answer, confidence, unclear}` и ингестит ответ как `RawEvent` в граф. **Это точка захвата сигнала — здесь ничего нового изобретать не нужно, надо подключить вывод правила.**
- **«Спросить или нет» УЖЕ есть.** `ProbeFormulationService.gate()` ([probe-formulation.service.ts:61](../../backend/src/modules/probe/probe-formulation.service.ts#L61), taskType `probe-value-gate`) решает `{ask, reason}`. **Это точка retrieve-before-ask** — добавить проверку `SubjectMemory` ДО LLM-гейта (если есть правило с высокой уверенностью → `ask:false, reason:'answered_by_memory'`).
- **Формулировка** — `ProbeFormulationService.formulate()` ([probe-formulation.service.ts:128](../../backend/src/modules/probe/probe-formulation.service.ts#L128)).
- **Конфиг probe уже через `getDynamic`/`cfg.probe.*`** (`probe.valueGateEnabled`, `probe.responseClassifyMinConfidence`) — паттерн крутилок соблюдён, добавляем ключи туда же.
- **`feedback`-модуль НЕ подходит** — это агрегация продуктовых жалоб (`FeedbackTopic`), не самообучение ([feedback-topic-manager.service.ts](../../backend/src/modules/feedback/services/feedback-topic-manager.service.ts)). Новый слой `SubjectMemory` — отдельный.
- **`13_glossary`** — это dev-доки (`second-brain/13_glossary/`), НЕ runtime-память. Не путать.
- **Embedding-инфра есть** — pgvector, `text-embedding-3-small`, образец `SkillTraitConcept.embedding Unsupported("vector(1536)")` ([schema.prisma:8246](../../backend/prisma/schema.prisma#L8246)) + HNSW-индексы в `postgres-init.sql`.

**Вывод REALITY-CHECK:** инфра захвата сигнала и гейта «спрашивать ли» уже стоит; новый — слой памяти правил + два хука (запись правила в `ProbeResponseHandler`, чтение в `gate()`) + контур авто-активации. Это **достройка**, не greenfield.

## Принятые решения владельца (из синтеза, не пересматривать)
| # | Решение | Обоснование (почему) |
|---|---|---|
| Р1 | Обучение БЕЗ human-approval; человек — только kill-switch | `feedback_no_human_in_loop_for_clone_learning`: в админке ~30 чел, «соглашаются не глядя»; синтез §7 |
| Р2 | Активация правила = **canary/shadow + авто-rollback по ВНЕШНЕЙ метрике** (не offline-A/B, не самооценка judge) | red-team `98`: на 30 пользователях A/B статзначимости не даст; closed-loop деградирует |
| Р3 | Judge — **ансамбль, ≠ генератор правила** | red-team: LLM-судья self-preference/verbosity/position-biased (verified) |
| Р4 | Конфликт правил — **supersede по `max(occurredAt)`**, свежесть решает КОД, не LLM | синтез §4 (arxiv 2606.01435 verified): LLM на длинном контексте деградирует 75%→61% |
| Р5 | Защита (вес подтверждений±, TTL/decay, регресс-набор, per-Org изоляция) — в **v1**, не vNext | red-team: без этого самоотравление; синтез §8 |
| Р6 | v1-сигналы: ответы probe + reject задач; correct/edit-distance — **вторая волна** | синтез §10 Q4: probe-ответы уже структурированы; edit-distance требует инфры черновик→финал |

## Доказательство выбора (состязательная таблица)
Полный разбор — синтез §6 (Слой 3) + `98-red-team.md`. Сжато:

| Критерий | A: human-approval каждого правила | B (выбран): авто canary + rollback, kill-switch | C: чистый онлайн без судьи/гейта |
|---|---|---|---|
| Масштаб (30 чел «соглашаются») | ✗ проваливается | ✓ | ✓ |
| Защита от самоотравления | ✓ (но не работает на 30) | ✓ (judge-ансамбль + вес + регресс) | ✗ |
| Совпадение с принципом Коры | ✗ конфликт | ✓ | ~ частично |
| Риск дрейфа | низкий | средний (управляем rollback) | высокий |
| Статзначимость на 30 польз. | n/a | ✓ (внешняя метрика, не A/B) | ✗ |

**Отвергнутые альтернативы:** offline-A/B — ломается на малой выборке (red-team); LLM-судья как генератор-и-оценщик одновременно — self-preference bias (red-team); LLM решает свежесть правила — деградация на длинном контексте (синтез §4).

## Scope
**Входит:** модель `SubjectMemory` + миграция; сервис вывода правила из сигнала; хук записи в `ProbeResponseHandler`; хук retrieve-before-ask в `gate()`; контур активации (shadow→canary→active с авто-rollback); judge-ансамбль; supersede по `max(occurredAt)`; крутилки в AdminSetting; метрики; подстановка активных правил в `probe-formulate` (контекст «что уже знаем»).
**Не входит (vNext, отдельные ТЗ):** (а) `correct`/edit-distance-сигнал от правок черновиков клонов/отчётов → vNext-ТЗ `learned-memory-edit-distance-signal`; (б) подстановка правил в chat-v2/ассистент-ответы (этот ТЗ ограничен probe-контуром) → vNext `learned-memory-into-answer-prompts`; (в) UI-просмотр/ручная правка выученных правил → vNext `learned-memory-admin-ui` (на v1 только kill-switch + метрики).

## Граничные контракты
- **С probe-системой:** переиспользуем `ProbeEvent`, `probe-value-gate`, `probe-response-classify`, `BusinessMetricsService`. Не переписываем формулировку/диспетчер.
- **С knowledge-core:** правило — НЕ `IdeaBlock`; отдельная сущность `SubjectMemory`. Ответ probe по-прежнему ингестится в граф как сейчас (не трогаем `ingestResponseAsRawEvent`).
- **С LLM-router:** новые taskType `subject-memory-rule-extract` (capable, DeepSeek V4 Pro), `subject-memory-judge` (дёшево, ансамбль из 2 дешёвых: `deepseek-v4-flash` + второй провайдер по DEFAULT-цепочке). Embedding — `text-embedding-3-small` через существующий путь.

## Контракт-first

### Prisma (добавить в `schema.prisma`; HNSW-индекс — в `postgres-init.sql`, НЕ здесь)
```prisma
enum SubjectMemoryKind {
  term            /// термин/аббревиатура компании: «КП» = «коммерческое предложение»
  disambiguation  /// разрешённая неоднозначность: «дизайн» → отдел/роль X
  preference      /// предпочтение: «задачи ставить с дедлайном»
}

enum SubjectMemoryStatus {
  shadow          /// выведено, но не влияет на поведение (наблюдаем метрику)
  canary          /// влияет на часть трафика, под наблюдением rollback-метрики
  active          /// влияет полностью
  superseded      /// заменено более свежим правилом (по occurredAt)
  rolled_back     /// авто-откат: ухудшило внешнюю метрику
  disabled        /// kill-switch владельца
}

model SubjectMemory {
  id              String              @id @default(cuid())
  tenantId        String              /// per-Org изоляция — Р5
  kind            SubjectMemoryKind
  /// Ключ-контекст, по которому правило ищется (что спрашивали / о чём).
  contextText     String              @db.Text
  /// Выученный ответ/правило (что подставлять вместо вопроса).
  ruleText        String              @db.Text
  /// Семантический отпечаток contextText (для retrieve-before-ask).
  embedding       Unsupported("vector(1536)")?
  status          SubjectMemoryStatus @default(shadow)
  /// Счётчики веса: сколько раз правило подтверждалось/опровергалось ответами. Р5
  confirmCount    Int                 @default(0)
  refuteCount     Int                 @default(0)
  /// Уверенность 0..1 (из вывода + накопленных подтверждений).
  confidence      Decimal             @db.Decimal(4, 3) @default(0)
  /// Время факта-источника — арбитр свежести supersede (Р4): КОД берёт max(occurredAt).
  occurredAt      DateTime
  /// Куда слито при supersede (status=superseded).
  supersededById  String?
  supersededBy    SubjectMemory?      @relation("SubjectMemorySupersede", fields: [supersededById], references: [id])
  supersedes      SubjectMemory[]     @relation("SubjectMemorySupersede")
  /// Провенанс: probeEvent / rawEvent / ideaBlock, из которых выведено правило.
  sourceProbeIds  String[]            @default([])
  sourceBlockIds  String[]            @default([])
  /// TTL/decay — дата, после которой правило уходит в decay-пересмотр. Р5
  staleAfter      DateTime?
  lastAppliedAt   DateTime?
  appliedCount    Int                 @default(0)
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  org Org @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, kind, status])
  @@index([tenantId, status, occurredAt])
  @@map("subject_memory")
}
```
`postgres-init.sql` (Шаг 5 prod-deploy): HNSW по `subject_memory.embedding` + partial-index `WHERE status IN ('active','canary')`. Образец — HNSW для `SkillTraitConcept`.

### AdminSetting (реестр `admin-setting-schema-registry.ts` + сид + getDynamic) — крутилки, НЕ ENV
| Ключ | Тип | Дефолт (code-fallback) | Смысл |
|---|---|---|---|
| `subjectMemory.enabled` | boolean | `true` | kill-switch всего слоя (Р1) |
| `subjectMemory.retrieveBeforeAskEnabled` | boolean | `true` | включить подавление probe памятью |
| `subjectMemory.matchMinSimilarity` | number | `0.82` | порог cosine для «правило подходит» |
| `subjectMemory.suppressMinConfidence` | number | `0.7` | мин. confidence правила, чтобы подавить вопрос |
| `subjectMemory.canaryRollbackWindowHours` | number | `48` | окно наблюдения rollback-метрики |
| `subjectMemory.ttlDays` | number | `180` | через сколько правило уходит в decay-пересмотр |
| `subjectMemory.judgeQuorum` | number | `2` | сколько судей в ансамбле должны согласиться |

### Метрики (`BusinessMetricsService`)
`subject_memory_rule_extracted_total{kind}`, `subject_memory_probe_suppressed_total{reason}`, `subject_memory_rule_activated_total`, `subject_memory_rule_rolled_back_total{cause}`, `subject_memory_apply_total{status}`.

## Фазы (dependency-ordered)

### Фаза 1 — Модель + миграция + реестр AdminSetting `[x]`
**Цель:** появилась сущность `SubjectMemory` и крутилки.
**Файлы:** `schema.prisma` (+enum, +модель, +relation в `Org`); `prisma/migrations/*`; `postgres-init.sql` (HNSW+partial); `admin-setting-schema-registry.ts` (+7 ключей); сид настроек; `env`-доступ через `getDynamic` (НЕ `process.env`).
**Что НЕ входит:** логика вывода/чтения.
**Acceptance:** `bun run prisma:migrate -- --name subject_memory` создаёт файл; `grep "model SubjectMemory" schema.prisma`; `grep "subjectMemory.enabled" admin-setting-schema-registry.ts`; `bun run prisma:generate` + `bun run typecheck` зелёные; повторный сид настроек = no-op (идемпотентность).
**Закрывает:** инфраструктуру для R1–R6.

### Фаза 2 — Сервис вывода правила + хук записи в ProbeResponseHandler `[ ]`
**Цель:** ответ на probe → выведенное правило в `status: shadow`.
**Файлы (new):** `backend/src/modules/probe/subject-memory/subject-memory.service.ts` (методы `deriveRuleFromProbeResponse`, `upsertWithSupersede`); промпт `subject-memory-rule-extract.prompt.ts` (cache-friendly: стабильный SYSTEM, переменные в конце user); регистрация taskType. **Хук:** в `ProbeResponseHandler.handle` после `tryClassifyResponse` ([probe-response.handler.ts:64](../../backend/src/modules/probe/probe-response.handler.ts#L64)) — если `classification && !classification.unclear` → enqueue вывод правила (BullMQ, не в request-path).
**Supersede (Р4):** `upsertWithSupersede` ищет по embedding похожее правило того же `kind`; при совпадении — КОД сравнивает `occurredAt`, новее → старое `superseded`, иначе `confirmCount++`. LLM решает только «то же это правило?» (boolean), не свежесть.
**Что НЕ входит:** retrieve-before-ask; активация.
**Acceptance:** unit-тест: probe-ответ → создан `SubjectMemory{status:shadow}` с непустым `ruleText`+`embedding`; тест supersede: два правила, остаётся новое по `occurredAt`, старое `superseded`; `subject_memory_rule_extracted_total` инкрементится. typecheck/lint/build зелёные.
**Закрывает:** R-захват сигнала, Р4, Р6.

### Фаза 3 — Retrieve-before-ask в gate() `[ ]`
**Цель:** при наличии активного правила probe не задаётся.
**Файлы:** `subject-memory.service.ts` (+`findApplicableRule(tenantId, contextText)`: embed → pgvector cosine top-1 по `status IN (active,canary)` и `kind`, фильтр `similarity ≥ matchMinSimilarity && confidence ≥ suppressMinConfidence`); хук в `ProbeFormulationService.gate()` ([probe-formulation.service.ts:61](../../backend/src/modules/probe/probe-formulation.service.ts#L61)) — ДО LLM-гейта: если правило найдено → `{ask:false, reason:'answered_by_memory'}` + `subject_memory_probe_suppressed_total`. Подмешать активные правила в `PROBE_FORMULATE_USER_TEMPLATE` как блок «что уже знаем» (для случая, когда вопрос всё же задаётся).
**Что НЕ входит:** активация (правило в shadow подавлять НЕ должно — только active/canary).
**Acceptance:** unit: правило `active` с similarity>порога → `gate()` вернул `ask:false reason:answered_by_memory` БЕЗ вызова LLM (мок llm не вызван); правило `shadow` → НЕ подавляет; счётчик растёт. Поведение `probe-value-gate` при отсутствии правила не изменилось (его спек зелёный).
**Закрывает:** retrieve-before-ask (главная метрика «меньше переспросов»).

### Фаза 4 — Контур активации shadow→canary→active + авто-rollback + judge-ансамбль `[ ]`
**Цель:** правило становится active только если не ухудшает внешнюю метрику; ухудшило — авто-rollback.
**Файлы (new):** `subject-memory-activation.cron.ts` (`@Cron`, интервал из AdminSetting): (1) `shadow`→`canary` после N подтверждений и прохождения judge-ансамбля (`subject-memory-judge`, кворум `judgeQuorum`, судья ≠ генератор Р3); (2) для `canary` — сравнить rollback-метрику (доля unclear/переспросов по контексту) за `canaryRollbackWindowHours` ПОСЛЕ vs ДО: не хуже → `active`, хуже → `rolled_back` + метрика `cause`; (3) decay: `staleAfter < now` → пересмотр (confidence↓, при refute>confirm → `superseded`). Регресс-набор: хранить контрольные кейсы (RawEvent-ответы), новое правило не должно ломать ранее верные подавления.
**Что НЕ входит:** UI.
**Acceptance:** unit: правило с `confirmCount≥порог` и согласием judge-кворума → `canary`; правило, ухудшившее метрику в окне → `rolled_back`; judge-ансамбль зовётся `judgeQuorum` раз разными провайдерами; decay переводит просроченное в пересмотр. Интеграционный: kill-switch `subjectMemory.enabled=false` → cron no-op, подавление выключено.
**Закрывает:** Р1, Р2, Р3, Р5.

## Совместимость с prompt caching
`subject-memory-rule-extract` и `subject-memory-judge`: стабильный SYSTEM, переменные данные (контекст/ответ/правила) — в конце user (`feedback_llm_prompts_cache_friendly`). Подмешивание правил в `probe-formulate` — в user-часть, SYSTEM не трогаем (его snapshot-спек не должен дрейфовать без необходимости).

## Pre-mortem / Риски (ревью-аспекты для strict-production-review-gate)
- **Самоотравление:** правило выведено из шумного ответа → ловится judge-ансамблем + canary-rollback + refuteCount. Проверить: одиночный ответ НЕ даёт сразу `active`.
- **Cross-tenant утечка:** правило одной Org применилось к другой → `@@index([tenantId,...])` + `findApplicableRule` всегда с `tenantId`. Проверить тестом изоляции.
- **Гонка supersede (TOCTOU):** два писателя на одно правило → `upsertWithSupersede` в транзакции + сравнение `occurredAt` детерминированно (урок Decision-идемпотентности из реестра).
- **fail-open:** ошибка `SubjectMemory` НЕ должна ломать probe — все хуки в try/catch с fallback на текущее поведение (как `gate()` сейчас fail-open).

## Idempotency / flag / prod-deploy
- Миграция (Шаг 4), `postgres-init.sql` HNSW (Шаг 5), сид настроек идемпотентен (Шаг 7) — зарегистрировать в `apply-prod-deploy.ts STEPS`.
- Флаг `subjectMemory.enabled` = **kill-switch** (Ship-On: фича выкатывается ON, рубильник для инцидента) → строка в `docs/operations/feature-flags.md`.
- prod-deploy-log Шаги 1 (нет новых ENV — всё AdminSetting), 4 (модель), 5 (HNSW), 12 (новый @Cron + метрики grep).

## DoD
typecheck (вкл. `.spec`)/lint/build зелёные; vitest по новым файлам; `second-brain/01_projects/` (probe/ai-jobs/workers-queues) обновлены; `04_не-сделано` — vNext-строки (edit-distance, into-answer, admin-ui); prod-deploy-log + feature-flags обновлены; рефлексия.

## Итог
_(заполнит tz-orchestrator после реализации)_
