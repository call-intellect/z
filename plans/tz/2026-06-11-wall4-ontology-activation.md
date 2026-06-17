---
type: tz
status: ready-to-implement
feature: wall4-ontology-activation
date: 2026-06-11
owner: Сергей (владелец продукта Кора)
relates_to:
  - plans/analysis/2026-06-11-kora-moat-and-competitive-defensibility.md
  - plans/archive/2026-05-25-knowledge-core-temporal-and-graph-quality.md
  - plans/tz/2026-05-29-agents-v2-umbrella.md
  - second-brain/06_marketing/positioning.md
  - docs/operations/feature-flags.md
---

> Анализ-вход: `plans/analysis/2026-06-11-kora-moat-and-competitive-defensibility.md` (Стена 4) · Развилки согласованы с владельцем 2026-06-11 (3 ответа, см. «Принятые решения владельца»).

# ТЗ — Достройка и включение «Стены 4» (онтология): решения · bitemporal · ролевые клоны

## Принцип

«Стена 4» — это **усилитель Стены 1** (накопленная память клиента): связка [реестр решений с историей] + [bitemporal-срез на момент] + [ролевой клон должности]. Цель ТЗ — **не построить заново** (90% инфраструктуры уже в коде), а **достроить остаток и ВКЛЮЧИТЬ по Ship-On** то, что сейчас спит за OFF-флагами, плюс убрать маркетинговые claim'ы, не подтверждённые кодом.

Главный инвариант ТЗ — **Ship-On (CLAUDE.md §8)**: каждый флаг этого ТЗ либо (а) kill-switch (фича ON, рубильник только для инцидента), либо (б) owner-decision (выкат только с заданным владельцем параметром, сразу ON). Никаких «выкатить OFF → понаблюдаем → включим».

---

## REALITY-CHECK (что уже есть по факту — проверено чтением кода 2026-06-11)

| Что | Статус по коду | Вывод для scope |
|---|---|---|
| **Блок 1 — реестр решений** | `model Decision` (`statement/rationale/alternatives/supersedesId/reversibility/actualOutcomes/implementationStatus/linkedTaskCount`). Извлечение — `specialist-3-3-decisions.worker`. **`DecisionImplementationCron` УЖЕ работает и ВКЛЮЧЁН** ([decision-implementation.cron.ts](backend/src/modules/operations/workers/decision-implementation.cron.ts), cron `0 6 * * *`, флаг `operations.decision_controller.enabled` 🟢 ON, БЕЗ LLM): считает `implementationStatus` (`decision-implementation.scoring.ts`/`.service.ts`), метит `stalled`, пушит ответственным, метрики `decision_stalled_total`/`decision_throughput_percent`. **Уже есть страница `/decisions`** ([DecisionsListClient.tsx](frontend/app/(authenticated)/decisions/DecisionsListClient.tsx) — master-detail: statement/rationale/alternatives/supersede-цепочка/outcomes/«Отметить реализованным») + `src/api/decisions.api.ts`. | **Backend готов, фронт-страница решений ЕСТЬ.** Реальный остаток (уточнено верификацией): (1) у `/decisions` НЕТ фильтра «не доведённые/stalled» (текущие фильтры: proposed/approved/implemented/rejected); (2) cron шлёт на `actionUrl: '/dashboard/operations/decisions/stalled'` ([cron:154](backend/src/modules/operations/workers/decision-implementation.cron.ts#L154)) — **этой страницы нет (битая ссылка)**. **Решение: переиспользовать `/decisions`** (добавить фильтр + сменить cron actionUrl на `/decisions?status=stalled`), НЕ строить дубль-страницу; + виджет «% доведённых» на дашборд. |
| **Блок 2 — bitemporal** | Поля `validFrom/validUntil/recordedAt/supersededAt/supersededById` на `IdeaBlock` ([schema.prisma:3350](backend/prisma/schema.prisma#L3350)) и связях/`Decision`. Сервисы готовы: `FactSupersedeService.processNewBlock` ([fact-supersede.service.ts:87](backend/src/modules/knowledge-core/services/fact-supersede.service.ts#L87)), `TemporalConflictService` ([temporal-conflict.service.ts](backend/src/modules/knowledge-core/services/temporal-conflict.service.ts)), `snapshot.module` (`?at=`). Backfill-скрипты есть: `patch-bitemporal-backfill.ts`, `backfill-edge-temporal.ts`. | **Инфра готова, спит за флагами.** `BITEMPORAL_ENABLED`/`BITEMPORAL_SUPERSEDE_ENABLED`/`BI_TEMPORAL_EDGES_ENABLED` = `false` ([env.schema.ts:777/784/855](backend/src/common/config/env.schema.ts#L777)). Block-supersede гейтится двумя флагами ([block-distill.worker.ts:216-220](backend/src/modules/knowledge-core/workers/block-distill.worker.ts#L216)). **ВАЖНО: edge-conflict-закрытие `TemporalConflictService.onNewBlockLink` вызывается БЕЗ флага** ([block-linker.worker.ts:199](backend/src/modules/knowledge-core/workers/block-linker.worker.ts#L199)) — связи уже закрываются (`validUntil=NOW`), но retrieval это игнорирует, пока `BI_TEMPORAL_EDGES_ENABLED=false`. Остаток: backfill → recovery-surface (аудит+откат) → включить 3 флага. |
| **Блок 3 — ролевые клоны** | `ExecutablePersona`/`SkillTrait`/`SkillProfile`, `ExecutablePersonaBuildService` (компилит persona-prompt). Инфра v2 готова: модель `CloneAccessGrant` (в schema), `seed-llm-task-routes-clone-v2.ts`, `patch-migrate-clone-access.ts`, `clones-admin.service.ts` (матрица грантов), интеграционный тест `clones-v2.service.spec.ts`. Анти-фальшивка (≥2 reasoning-блока) — в `clone-respond`. | **Инфра готова, спит за `CLONE_V2_ENABLED=false`** ([env.schema.ts:1311](backend/src/common/config/env.schema.ts#L1311)). Остаток: (1) **фидбек/счётчик пользы у клонов отсутствует ВООБЩЕ** (греп по `modules/clones` — 0) → новая работа; (2) включить флаг на всех тенантах с матрицей; (3) убрать claim «стиль письма / stylistic profile» из маркетинга. |
| **Claim «клон имитирует стиль»** | В коде стилевого клонирования НЕТ (грепы `stylistic/styleProfile/writingStyle` по `backend/src` = 0). Но в маркетинге есть: `positioning.md:35` («stylistic profile»), `messaging.md:27` («стиль работы»), GTM-700m, `landings/2026-05-24-landing-draft.html:888,919`. | Docs-фикс: заменить на честное «знания и логика решений должности». |
| **Prisma-правила** | CLAUDE.md (2026-06-05): версионируемые миграции, `prisma:migrate`, НЕ `db push`. Комментарий в коде про «prisma db push (CloneAccessGrant)» — устарел. | Новую модель `CloneAnswerFeedback` вводить через `prisma:migrate`, не db push. |

**Итог REALITY-CHECK:** это ТЗ на ~30% «достройка остатка» (фильтр stalled на существующей `/decisions`, фидбек клонов, recovery-surface) и ~70% «безопасное включение + runbook + docs». Scope существенно меньше, чем «построить три фичи».

> **Верификация по текущему коду (2026-06-11, после коммита `c4733dd6`):** флаги подтверждены дословно — `BITEMPORAL_ENABLED:777`, `BITEMPORAL_SUPERSEDE_ENABLED:784`, `BI_TEMPORAL_EDGES_ENABLED:855`, `CLONE_V2_ENABLED:1311` (env.schema.ts, без дрейфа); `model IdeaBlock:3303`/`validFrom:3354`, `model CloneAccessGrant:2846`; `model CloneAnswerFeedback` в схеме отсутствует (имя свободно); последние коммиты (mobile/chatbox/tracker/ASR-тайминги) ядро Стены 4 не трогали. Номера строк актуальны на дату; перед правкой — перечитать (правило skill).

---

## Принятые решения владельца (2026-06-11 — не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | **Блок 2: авто-supersede выкатываем сразу ВКЛЮЧЁННЫМ + kill-switch** (не human-gate). | Владелец выбрал скорость. Риск авто-порчи памяти митигируем НЕ гейтом, а recovery-механизмом (аудит недавно закрытых + откат) + cost-alert + высокий cosine-порог 0.85. Ship-On тип флага — kill-switch. |
| Р2 | **Блок 3: CLONE_V2 включаем на ВСЕХ тенантах сразу**, owner-параметр Ship-On = матрица доступа `CloneAccessGrant`. | Скорость набора пользы. Защита от «пустой клон на холодном тенанте» — существующая анти-фальшивка (≥2 reasoning-блока → отказ + дисклеймер). Нет матрицы у тенанта → клоны ему недоступны (параметр обязателен). |
| Р3 | **Счётчик пользы клона = явный «Полезно/Не полезно» + groundedness**, паттерн `support-learning` (гейт качества). | Честный сигнал + задел под обучение клонов (vNext). Неявный сигнал слабее. |

---

## Доказательство выбора (кратко; полный разбор — в анализе)

- **Почему «достройка+включение», а не «построить»:** REALITY-CHECK выше — инфра в коде, доказано чтением.
- **Почему recovery-surface вместо human-gate для Блока 2 (Р1):** владелец выбрал авто. Альтернатива «human-gate перед закрытием» отклонена владельцем (медленнее). Чтобы авто не нарушал целостность памяти необратимо — supersede НЕ удаляет блок, а ставит `validUntil`; значит откат = снять `validUntil/supersededAt/supersededById`. Recovery дешевле и быстрее гейта, и совместим с авто.
- **Почему `CloneAnswerFeedback` отдельной моделью, а не переиспользовать `LlmPreferenceSample`:** `LlmPreferenceSample` — это сэмплы для обучения (accept/reject/edit черновика поддержки). Фидбек на ответ клона — продуктовый сигнал пользы от конечного пользователя (другой жизненный цикл, другой доступ). Обучающий мост в `LlmPreferenceSample` — vNext, не в этом ТЗ (kc/clone-learning).

---

## Scope

### Входит
- A. Фронт-страница `/dashboard/operations/decisions/stalled` + API списка + виджет «% доведённых» (Блок 1, остаток).
- B. Backfill bitemporal + recovery-surface (аудит закрытых + откат) + включение 3 флагов bitemporal ON (Блок 2).
- C. Модель+эндпоинт+UI фидбека на ответ клона (счётчик пользы) + активация CLONE_V2 на всех тенантах с матрицей + docs-фикс claim (Блок 3).
- Регистрация всех флагов/скриптов: `docs/operations/feature-flags.md`, `apply-prod-deploy.ts` `STEPS`, `prod-deploy-log.md`.

### Не входит (vNext, с заглушкой)
- **Авто-supersede без kill-switch / расширение `CONTRADICTING_*_PAIRS`** → vNext `plans/tz/…-bitemporal-auto-supersede-v2.md` (после накопления статистики точности).
- **Обучающий мост фидбека клонов → DPO/LoRA** (clone-learning loop) → vNext, переиспользует паттерн `support-desk-clone` (`plans/analysis/2026-06-09-support-desk-clone-and-closed-contour.md`).
- **Snapshot-таймлайн UI (`?at=` визуальный ползунок времени в чате)** → vNext `plans/tz/…-snapshot-timeline-ui.md`. В этом ТЗ `?at=` остаётся только backend-API (включается флагом, без нового UI).
- **Стилевое клонирование речи/письма** → НЕ делаем (claim убираем). Если когда-нибудь — отдельное ТЗ + правовой разбор (персональные данные).

### Граничные контракты с другими ТЗ
- `DecisionImplementationService.computeForTenant` и метрика `decision_throughput_percent` — **уже существуют**, их НЕ переписывать; Блок A только читает их выход и рисует UI.
- `FactSupersedeService`/`TemporalConflictService`/backfill-скрипты — **существуют**, их НЕ переписывать; Блок B их включает и добавляет recovery поверх.
- `CloneAccessGrant`/`clones-admin`/`seed-llm-task-routes-clone-v2.ts` — **существуют**; Блок C их активирует, не переписывает.

---

## Требования (EARS, R1…Rn)

- **R1.** Когда `DecisionImplementationCron` пометил решение `implementationStatus='stalled'`, пользователь по `actionUrl` shall попасть на работающую страницу со списком застрявших решений своей Org (не 404).
- **R2.** Страница stalled-решений shall показывать по каждому решению: `statement`, `decidedAt`, ответственных, число связанных задач (`linkedTaskCount`), и действие «создать задачу под решение».
- **R3.** Дашборд shall показывать агрегат «% доведённых решений» (из `decision_throughput_percent`), без нового пересчёта на фронте.
- **R4.** Когда backfill bitemporal выполнен, все исторические `IdeaBlock` shall иметь непустые `validFrom`/`recordedAt` (повторный прогон backfill = no-op).
- **R5.** Если `BITEMPORAL_ENABLED=true`, then block-ingest shall заполнять `validFrom` на новых блоках, а retrieval shall фильтровать «активные сейчас» (`validUntil IS NULL`).
- **R6.** Если `BITEMPORAL_SUPERSEDE_ENABLED=true` (и `BITEMPORAL_ENABLED=true`), then после canonical-distill shall запускаться `FactSupersedeService.processNewBlock` (LLM-арбитр устаревания).
- **R7.** Если `BI_TEMPORAL_EDGES_ENABLED=true`, then retrieval shall возвращать только связи, валидные на момент запроса.
- **R8.** Когда блок помечен superseded, super_admin/owner shall видеть его в «аудите устаревания» и shall иметь действие «откатить» (снять `validUntil/supersededAt/supersededById`, вернуть в активный поиск). Откат идемпотентен.
- **R9.** Когда пользователь получил ответ клона, он shall иметь возможность поставить «Полезно/Не полезно»; система shall сохранить вердикт + groundedness и инкрементить `clone_answer_feedback_total{verdict}`.
- **R10.** Если у тенанта НЕ задана матрица `CloneAccessGrant`, then при `CLONE_V2_ENABLED=true` клоны этому тенанту shall быть недоступны (owner-параметр обязателен).
- **R11.** Если опора клона < порога (нет ≥2 reasoning-блоков), then клон shall отказаться отвечать с дисклеймером (существующая анти-фальшивка), а не выдумывать.
- **R12.** В маркетинговых документах не shall оставаться формулировок «клон имитирует/сохраняет стиль (письма/работы)/stylistic profile»; заменено на «знания и логика решений должности».
- **R13.** Каждый флаг ТЗ shall иметь строку в `docs/operations/feature-flags.md` с типом (kill-switch / owner-decision) и финальным состоянием ON.

---

## Контракты (contract-first)

### Новая Prisma-модель (Блок C) — `CloneAnswerFeedback`
> Вводить через `bun run prisma:migrate -- --name wall4_clone_answer_feedback` (НЕ db push). После — `bun run prisma:generate`. На прод применится авто (`migrate deploy`).

```prisma
/// TZ wall4 (2026-06-11) — фидбек пользы ответа клона (Блок 3, Р9).
/// Сигнал «Полезно/Не полезно» от конечного пользователя + groundedness ответа.
/// Жизненный цикл — продуктовый (не обучающий: мост в LlmPreferenceSample — vNext).
model CloneAnswerFeedback {
  id          String   @id @default(cuid())
  tenantId    String
  /// 'person' | 'role' — на какой клон отвечали.
  cloneScope  String   @db.VarChar(8)
  /// SkillProfile.id (scope=person) или Role.id (scope=role).
  cloneTargetId String
  /// id ответа клона (генерится в clone-respond, возвращается в ответе для привязки фидбека).
  answerId    String
  /// Кто оценил (User.id).
  userId      String
  /// 'helpful' | 'not_helpful'.
  verdict     String   @db.VarChar(12)
  /// Опора ответа на источники [0..1] (из clone-respond groundedness; null если не посчитан).
  groundedness Decimal? @db.Decimal(4, 3)
  /// Опц. свободный комментарий пользователя.
  comment     String?  @db.Text
  createdAt   DateTime @default(now())

  org Org @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  /// Один пользователь — один вердикт на ответ (idempotent upsert).
  @@unique([tenantId, answerId, userId])
  @@index([tenantId, cloneScope, cloneTargetId])
  @@map("clone_answer_feedback")
}
```
(+ обратная связь `cloneAnswerFeedback CloneAnswerFeedback[]` на модели `Org`.)

### API-контракты
- **Блок A:** `GET /api/v1/operations/decisions/stalled` (Zod-DTO + Swagger) → `{ items: Array<{ id, statement, decidedAt, decidedByPersonIds, linkedTaskCount, implementationStatus }>, throughputPercent: number }`. tenant из `X-Org-Id` (TenantGuard). **Сначала грепнуть, нет ли уже эндпоинта** в `operations.controller`; если есть — переиспользовать, не дублировать.
- **Блок B (recovery):** `GET /api/v1/admin/knowledge/superseded?since=ISO` (super_admin) → список недавно закрытых блоков; `POST /api/v1/admin/knowledge/superseded/:blockId/restore` → откат (R8). Машинно-проверяемый код ошибки `block_not_superseded` если блок не закрыт.
- **Блок C:** `POST /api/v1/clones/answers/:answerId/feedback` body `{ verdict: 'helpful'|'not_helpful', comment?: string }` → upsert `CloneAnswerFeedback`. Ответ клона (`clones.askPerson/askRole`) расширить полем `answerId` (cuid) в DTO для привязки.

### Совместимость с prompt caching
- Блок B использует существующий промпт `fact-supersede-detect` (дешёвый арбитр ≤700 in/≤300 out) — SYSTEM не трогаем, кэш сохранён.
- Блок C: фидбек — без LLM. Клон-ответ (`clone-respond`) не меняем по содержанию промпта (только добавляем `answerId` в служебный ответ, не в промпт) — кэш сохранён.

---

## Фазы (dependency-ordered, `[ ]`)

Граф зависимостей: **A‑волна** (A1→A2) ∥ **B‑волна** (B1→B2→B3) ∥ **C‑волна** (C1 ∥ C2→C3). Блоки A/B/C независимы между собой — три параллельные волны. Внутри — строго последовательно.

### Блок A — Решения без внедрения (остаток Блока 1)

#### [ ] Фаза A1 — Backend: фильтр «не доведённые» в существующем decisions-эндпоинте + агрегат + cron-URL
- **Цель:** дать фронту данные для R1–R3, ПЕРЕИСПОЛЬЗУЯ существующий контракт решений.
- **Картография:** найти существующий decisions-контроллер (за `src/api/decisions.api.ts`; грепнуть `@Controller` с `decision`); `services/decision-implementation.service.ts`/`.scoring.ts` (уже считают `implementationStatus`/`throughputPercent`); `decision-implementation.cron.ts:154` (actionUrl).
- **Что входит:** (1) расширить существующий список решений фильтром по `implementationStatus` (значение «stalled»/«не доведённые») — НЕ новый эндпоинт, если список уже есть; (2) отдать агрегат `throughputPercent` (из существующего сервиса) на дашборд-эндпоинте; (3) сменить в cron `actionUrl` с `/dashboard/operations/decisions/stalled` на `/decisions?status=stalled`.
- **Что НЕ входит:** пересчёт статусов (делает существующий cron), новый дубль-эндпоинт/воркер, новый decisions-модуль.
- **Acceptance:** `bunx vitest run` spec (фильтр stalled возвращает только `implementationStatus='stalled'`, tenant-изоляция); `bun run typecheck && bun run build` зелёные; греп в cron — actionUrl `/decisions?status=stalled` (нет старого `/dashboard/operations/decisions/stalled`).
- **Закрывает:** R1 (частично), R2, R3.

#### [ ] Фаза A2 — Frontend: фильтр «не доведённые» на `/decisions` + виджет «% доведённых»
- **Цель:** закрыть битую `actionUrl` (R1) переиспользованием существующей страницы + показать агрегат (R3).
- **Картография:** [DecisionsListClient.tsx](frontend/app/(authenticated)/decisions/DecisionsListClient.tsx) (`STATUS_FILTERS`), `src/api/decisions.api.ts`, `src/domain/decision.ts`; дашборд `app/(authenticated)/dashboard/`.
- **Что входит:** (1) добавить в `STATUS_FILTERS` опцию «Не доведённые» (маппится на `implementationStatus='stalled'`); читать `?status=stalled` из query при заходе по cron-ссылке; (2) виджет «% доведённых решений» на дашборде (из `throughputPercent`). НЕ создавать новую страницу.
- **Что НЕ входит:** новая страница под `dashboard/operations/decisions/stalled`, редактирование решений сверх существующего, новые графики.
- **Acceptance:** `cd frontend && bun run typecheck && bun run build && bun run lint` зелёные; заход `/decisions?status=stalled` показывает отфильтрованный список (не 404); виджет «% доведённых» рендерится; ни одного английского слова; нет `text-white`/hex/slate.
- **Закрывает:** R1, R3.

### Блок B — Bitemporal (Р1: авто ON + kill-switch + recovery)

#### [ ] Фаза B1 — Backfill временных осей
- **Цель:** R4 — историю снабдить `validFrom/recordedAt` (и связи — temporal) до включения retrieval-фильтров.
- **Картография:** `backend/scripts/patch-bitemporal-backfill.ts`, `backend/scripts/backfill-edge-temporal.ts`, `backend/scripts/apply-prod-deploy.ts` (`STEPS`).
- **Что входит:** проверить идемпотентность скриптов (повторный прогон — no-op); зарегистрировать оба в `STEPS` (phase: `update`, `skipBootstrap: true`); обновить `prod-deploy-log.md` Шаг 8.
- **Что НЕ входит:** включение флагов (Фаза B3).
- **Acceptance:** локальный прогон обоих скриптов на seed-данных + повторный прогон = 0 изменений (no-op, лог это печатает); запись в `STEPS` есть (греп имени файла); `bun run typecheck` зелёный.
- **Закрывает:** R4.

#### [ ] Фаза B2 — Recovery-surface: аудит устаревания + откат
- **Цель:** R8 — безопасная сетка под авто-supersede (откат ошибочно закрытого блока). Зависит от: ничего (можно параллельно B1).
- **Картография:** `backend/src/modules/admin/` (admin-эндпоинты, super_admin guard), `IdeaBlock` поля `validUntil/supersededAt/supersededById`, `frontend (admin)` route-группа.
- **Что входит:** `GET /admin/knowledge/superseded?since=` + `POST …/:blockId/restore` (снять `validUntil/supersededAt/supersededById`, вернуть в активный поиск); простая admin-страница списка «недавно устаревшие» с кнопкой «Вернуть»; аудит-лог действия (`SuperAdminAccessLog`).
- **Что НЕ входит:** массовый откат, авто-эвристики «это ошибка».
- **Acceptance:** spec: restore идемпотентен (повтор = no-op), `block_not_superseded` при попытке откатить активный блок; super_admin-only (403 иначе); `bun run typecheck && build` зелёные.
- **Закрывает:** R8.

#### [ ] Фаза B3 — Включение 3 флагов bitemporal (ON, kill-switch)
- **Цель:** R5, R6, R7 — включить временную модель в проде. Зависит от: B1 (backfill) + B2 (recovery готов как сетка).
- **Картография:** `env.schema.ts:777/784/855`, `typed-config.service.ts` (`bitemporal.enabled/supersedeEnabled`), `docs/operations/feature-flags.md`, метрики `kc_fact_supersede_verdicts_total`, `temporal_edges_invalidated_total`, alert `fact_supersede_cost_spike`.
- **Что входит:** выставить `BITEMPORAL_ENABLED=true`, `BITEMPORAL_SUPERSEDE_ENABLED=true`, `BI_TEMPORAL_EDGES_ENABLED=true` (через ENV прод-окружения); зарегистрировать как **kill-switch ON** в `feature-flags.md` (R13); проверить, что cost-alert `fact_supersede_cost_spike` активен; smoke на проде после включения.
- **Что НЕ входит:** изменение порогов/логики арбитра, расширение `CONTRADICTING_*_PAIRS` (vNext).
- **Acceptance:** после включения на staging/нашей Org — новые блоки получают `validFrom`; `kc_fact_supersede_verdicts_total` растёт; supersede-аудит (B2) показывает закрытые блоки и откат работает; `feature-flags.md` содержит 3 строки kill-switch ON; smoke-грепы в `prod-deploy-log.md` Шаг 12 обновлены.
- **Закрывает:** R5, R6, R7, R13 (частично).

### Блок C — Ролевые клоны (Р2 активация + Р3 счётчик + docs)

#### [ ] Фаза C1 — Docs-фикс claim «стиль» (быстрая, независимая)
- **Цель:** R12 — убрать неподтверждённый кодом claim.
- **Картография:** `second-brain/06_marketing/positioning.md:35`, `messaging.md:27`, `plans/analysis/2026-05-20-gtm-700m.md` (вхождения «Stylistic profile»), `second-brain/06_marketing/landings/2026-05-24-landing-draft.html:888,919`.
- **Что входит:** заменить «stylistic profile / сохраняет стиль (работы/письма)» → «знания и логику решений должности (роль переживает уход человека)». Сохранить смысл «знание остаётся в компании».
- **Что НЕ входит:** переписывание всего позиционирования (отдельный разговор с владельцем).
- **Acceptance:** грепы `stylistic|стиль работы|стиль письма|имитир` по `second-brain/06_marketing/` = 0 (кроме явно исторических/архивных пометок); смысл «знание остаётся» сохранён.
- **Закрывает:** R12.

#### [ ] Фаза C2 — Счётчик пользы клона (модель + эндпоинт + UI)
- **Цель:** R9 — явный фидбек «Полезно/Не полезно» + groundedness.
- **Картография:** Prisma `CloneAnswerFeedback` (контракт выше), `backend/src/modules/clones/` (`clones.controller.ts`, `clones.service.ts` askPerson/askRole — добавить `answerId` в ответ), `clone-respond` (взять groundedness), метрики, `frontend` clone-ответ UI.
- **Что входит:** миграция модели (`prisma:migrate`); эндпоинт `POST /clones/answers/:answerId/feedback` (upsert, idempotent по `@@unique`); метрика `clone_answer_feedback_total{verdict}` + агрегат «польза клона %» для admin; кнопки «Полезно/Не полезно» на ответе клона в UI (русский, парные токены).
- **Что НЕ входит:** обучающий мост в `LlmPreferenceSample`/DPO (vNext); авто-промоут.
- **Acceptance:** `prisma:migrate` создаёт таблицу `clone_answer_feedback`; повторный POST тем же user на тот же answer = upsert (не дубль, проверка `@@unique`); метрика инкрементится; `bun run typecheck && build` (back) + `cd frontend && bun run typecheck && build && lint` зелёные; tenant-изоляция в spec.
- **Закрывает:** R9.

#### [ ] Фаза C3 — Активация CLONE_V2 на всех тенантах (owner-параметр = матрица)
- **Цель:** R10, R11 — включить клонов с обязательной матрицей доступа. Зависит от: C2 (чтобы фидбек был готов к моменту запуска) + миграции/seed клон-доступа.
- **Картография:** `backend/scripts/patch-migrate-clone-access.ts`, `backend/scripts/seed-llm-task-routes-clone-v2.ts`, `clones-admin.service.ts` (матрица `CloneAccessGrant`), `env.schema.ts:1311` (`CLONE_V2_ENABLED`), `apply-prod-deploy.ts` `STEPS`, `feature-flags.md`.
- **Что входит:** зарегистрировать `patch-migrate-clone-access.ts` + `seed-llm-task-routes-clone-v2.ts` в `STEPS` (если ещё нет); прогон миграции/seed; включить `CLONE_V2_ENABLED=true` (все тенанты); зарегистрировать в `feature-flags.md` как **owner-decision** (параметр = матрица `CloneAccessGrant`; нет матрицы → клоны недоступны, R10); проверить анти-фальшивку (R11) на холодном тенанте (отказ, не выдумка).
- **Что НЕ входит:** автозаполнение матрицы (владелец/админ задаёт), стилевое клонирование.
- **Acceptance:** на тенанте БЕЗ грантов askRole/askPerson → доступ запрещён (R10, spec/smoke); на тенанте с пустым графом → клон отказывается (R11, дисклеймер, не галлюцинация); `feature-flags.md` строка owner-decision ON; `STEPS` содержит оба скрипта; `prod-deploy-log.md` Шаги 7/9 обновлены; интеграционный `clones-v2.service.spec.ts` зелёный.
- **Закрывает:** R10, R11, R13 (частично).

---

## Прод-инструкция запуска (runbook по блокам)

> Все команды — через `docker compose exec backend …` (Z в проде целиком в docker-compose; никаких прямых `bun run` на хосте). Полная актуальная инструкция — `docs/operations/prod-deploy-log.md`; ниже — diff именно этого ТЗ.

**Блок A (решения):** prod-операций кроме выката кода нет (backend-флаг `operations.decision_controller.enabled` уже ON). После мержа: `docker compose up -d --build backend frontend`. Проверка: открыть `/decisions?status=stalled` — отфильтрованный список «не доведённых» рендерится (не 404); cron-push теперь ведёт сюда.

**Блок B (bitemporal) — порядок строгий:**
1. `docker compose exec backend bun run scripts/patch-bitemporal-backfill.ts` — дозаполнить `validFrom/recordedAt` на блоках (идемпотентно).
2. `docker compose exec backend bun run scripts/backfill-edge-temporal.ts` — temporal на связях (идемпотентно).
3. Выставить в прод-`.env`: `BITEMPORAL_ENABLED=true`, `BITEMPORAL_SUPERSEDE_ENABLED=true`, `BI_TEMPORAL_EDGES_ENABLED=true` → `docker compose up -d backend` (рестарт с новым ENV).
4. Наблюдать 48 ч: Grafana `kc_fact_supersede_verdicts_total` (доля `supersedes`), `temporal_edges_invalidated_total`, alert `fact_supersede_cost_spike`. Если аномалия (всплеск закрытий / рост стоимости) — **kill-switch:** вернуть флаги в `false`, `docker compose up -d backend`; ошибочные закрытия откатить через recovery-surface (B2).

**Блок C (клоны):**
1. Миграция модели фидбека: применяется авто при `docker compose up -d` (migrate deploy). Подтвердить: таблица `clone_answer_feedback` создана.
2. `docker compose exec backend bun run scripts/patch-migrate-clone-access.ts` — миграция грантов (идемпотентно).
3. `docker compose exec backend bun run scripts/seed-llm-task-routes-clone-v2.ts` — маршруты LLM clone-v2 (идемпотентно).
4. **Владелец/админ задаёт матрицу** `CloneAccessGrant` (кто из ролей видит какие клоны) — без неё клоны недоступны (Ship-On owner-параметр).
5. Выставить `CLONE_V2_ENABLED=true` → `docker compose up -d backend`.
6. Smoke: на тенанте с грантами askRole возвращает ответ + кнопки «Полезно/Не полезно»; на холодном тенанте клон отказывается (анти-фальшивка).

**Агрегатор:** все новые/затронутые скрипты — в `backend/scripts/apply-prod-deploy.ts` `STEPS`. Единый прогон: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.

---

## Реестр флагов (обязательно — `docs/operations/feature-flags.md`, R13)

| Флаг | Тип | Финальное состояние |
|---|---|---|
| `operations.decision_controller.enabled` | kill-switch | 🟢 ON (уже есть) |
| `BITEMPORAL_ENABLED` | kill-switch | 🟢 ON (это ТЗ) |
| `BITEMPORAL_SUPERSEDE_ENABLED` | kill-switch | 🟢 ON (это ТЗ) |
| `BI_TEMPORAL_EDGES_ENABLED` | kill-switch | 🟢 ON (это ТЗ) |
| `CLONE_V2_ENABLED` | owner-decision (параметр = матрица `CloneAccessGrant`) | 🟢 ON со всеми тенантами + матрица (это ТЗ) |

---

## Pre-mortem / Риски

| Риск | Митигирование |
|---|---|
| **Авто-supersede молча закрывает верный факт (порча памяти)** | Recovery-surface (B2, R8) — откат; cost/частотные алерты; cosine-порог 0.85; блок не удаляется (только `validUntil`). 48-ч наблюдение с kill-switch. |
| Edge-conflict-закрытие уже работало без флага — при включении retrieval-фильтра «всплывут» ранее закрытые связи | Backfill (B1) до включения; смотреть `temporal_edges_invalidated_total` на исторических данных; recovery применим и к связям (vNext, если массово). |
| Клон отвечает мусором на холодном тенанте | R11 — анти-фальшивка (≥2 reasoning-блока → отказ). Smoke на пустом тенанте обязателен (C3). |
| Матрица `CloneAccessGrant` забыта → клоны «молчат» у всех | R10 — это by design (нет параметра = нет доступа). Документировать в админке шаг «задать матрицу». |
| Claim «стиль» остался в каком-то канале | Грепы в Acceptance C1; пройтись по `landings/` и GTM. |

**Ревью-аспекты для `strict-production-review-gate`:** tenant-изоляция новых эндпоинтов (`@@index([tenantId,…])`, TenantGuard); идемпотентность restore/feedback/seed/backfill; super_admin-only на recovery; отсутствие `process.env.*`/`new PrismaClient(`/`prisma migrate` в скриптах (используется `createPrismaClient()` + импорты `../src`); Ship-On соответствие флагов.

---

## DoD (общий чек-лист)
- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` зелёные (back и front).
- `bunx vitest run` по новым spec проходит; tenant-изоляция и идемпотентность покрыты.
- `second-brain/` обновлён по таблице производных заметок: `02_architecture/data-model.md` (модель `CloneAnswerFeedback`), `01_projects/decisions.md` + `01_projects/skill-and-clone.md` (активация), `01_projects/api-layer.md` (новые эндпоинты), `01_projects/frontend-pages.md` (stalled-страница).
- `docs/operations/feature-flags.md` — 5 строк (R13); `prod-deploy-log.md` Шаги 4/7/8/9/12 обновлены; скрипты в `apply-prod-deploy.ts` `STEPS`.
- `second-brain/04_не-сделано/README.md`: убрать строки «Стена 4 за флагами» (если есть), вынести vNext-заглушки (auto-supersede-v2, clone-learning, snapshot-timeline-ui).
- Рефлексия в `05_история/` после push.

---

## Итог
_Заполняется `tz-orchestrator` по завершении: что реализовано целиком, что осталось, ссылки на коммиты._

> **Запуск:** многофазное ТЗ, три параллельные волны (A ∥ B ∥ C). Вести через `tz-orchestrator`. Парный orchestrator-prompt — `plans/tz/2026-06-11-wall4-ontology-activation-orchestrator-prompt.md`.
