# Боевой тест модуля создания клона сотрудника — прод (korateam.ru)

> Дата: 2026-06-22 · Тестировщик: Claude (qa-tester) · Окружение: **прод**, Org «ооо ромашка» (`cmpuz4gbs000201mvfbf3k2zk`)
> Метод: через интерфейс кабинета (Playwright) + сверка с бэком через read-only `diag`/admin-API. Решения владельца: гибрид (owner-носитель), дефолтные пороги, diag в прод разрешён, ручной запуск штатных cron'ов разрешён.

## Цель
Проверить сквозную цепочку создания клона должности: дамп мысли → block-ingest (разметка signalType + subject) → диспетчер 3-7-skill → SkillProfile → rebuild (черты) → концепты → verify → ExecutablePersona → ответ клона + анти-фейк. Посмотреть, что реально попадает в БД на каждом звене.

## Окружение и носитель
- Должность: «[QA] Руководитель маркетинга» (`roleId cmq0y5v0300j301qxvnv3gr1p`), носитель — **Алексей** (owner, employee, `personId cmpzl0mee00065gnq9vm3ajv1`).
- Канал входа: «Создать → Мысль» → `/dump` → `POST /api/v1/ingest/dump` `{text, nonce}` (sourceType web_form, subject-атрибуция на автора). Подтверждено вручную (201) + пакетно тем же эндпоинтом (нужен заголовок `x-org-id`, иначе 403 `tenant_required`).

## Ход и находки

### Звено 1 — ingest → граф: РАБОТАЕТ ✅
- Залито 18 заметок «руководителя маркетинга» (решения с обоснованием).
- Метрики графа (`GET /api/v1/org-admin/knowledge/metrics`): rawEvents 44, blocks 81 (canonical 80), entities 102, links block 341 / entity 52, LLM за 24ч 580 вызовов.
- Реестр «Сущности»: появились CAC (8 упоминаний — дедуп объединил из 8 заметок), LTV, LTV первой покупки, лендинг, ICP, когортный анализ, атрибуция продаж, промокоды, небрендовые запросы, Алексей (сотрудник). **Дедуп сущностей и резолв работают.**

### Звено 2 — диспетчер 3-7-skill → SkillProfile: РАБОТАЕТ ✅
- `GET /clones/persons/:id/skill-profile`: профиль создан (`profileId b62454f1…`, status active). Значит первый reasoning-subject блок дошёл до диспетчера и создал профиль 1:1.

### 🔴 Находка №1 — формулировки-«решения» не кормят клон (классификация signalType)
- `buildVersion: 0`, `traits: []` спустя ~55 мин — rebuild упёрся в гейт `blocks < skillProfileMinObservations (5)`.
- Причина: реестр «Решения» показал **15 из 18 моих заметок как Decision** (signalType `decision`). А навыковый профиль кормят только `reasoning/rationale/decision_basis` (`loadSubjectReasoningBlocks`). `decision` ≠ `decision_basis` → reasoning-блоков набралось < 5.
- **Смысл:** заметки в стиле «сегодня решил X, потому что Y» уходят в реестр решений, а не в клон должности. Клон кормится формулировками про **подход/принцип** («я в принципе так работаю / мой принцип / я обычно рассуждаю так»).
- Реакция: долито 11 заметок в reasoning-стиле (про подход). Ожидаем reasoning-блоки → rebuild → черты. (в процессе)

### 🔴🔴 Находка №2 (ГЛАВНАЯ) — клон должности не наполняется: рассогласование таксономии signalType
**Симптом:** после долива 11 reasoning-заметок профиль клона так и остался `buildVersion 0`, `traits []` (поллер 8×40с).

**Диагностика (через UI «Сущности» → сущность «Алексей» → блоки знаний):** subject-атрибуция РАБОТАЕТ — к Алексею привязано 20 блоков знаний. Но их signalType:
- `methodology_step` («Шаг методологии») ×13 — «Data-driven подход», «Выбор канала по юнит-экономике», «Не масштабировать непроверенное», «Найм по ключевому навыку» и т.д.
- `motivation` ×2, `decision` ×2, `fact` ×1, `regulation` ×1, `metric_change` ×1, `result` ×1.
- **`reasoning`/`rationale`/`decision_basis` — 0 блоков.**

**Корень (по коду):**
- `specialist-3-7-skill.service.ts:530` — `loadSubjectReasoningBlocks` фильтрует строго `signalType: { in: ['reasoning','rationale','decision_basis'] }`.
- `specialist-3-7-skill.service.ts:318` — если таких блоков `< skillProfileMinObservations (5)` → **полный `return` (skip)**, включая проходы слоя метода (value/motivation/process_marker на :362/:382 работают на тех же reasoning-группах).
- block-ingest классифицирует «подход к работе» как `methodology_step`/`motivation`/`decision` (что осмысленно!), но эти типы НЕ входят в гейт-набор клона.

**Смысл находки:** `methodology_step` — это буквально «как сотрудник делает работу» = ядро клона должности. Но из-за узкого гейта (`reasoning/rationale/decision_basis`) эти блоки до клона НЕ доходят. Канал «Мысль/Память» (`/dump`) практически не генерирует `reasoning`-блоки → **клон должности через этот канал не наполняется вообще.** Это объясняет, почему в проде у активной Org 0 клонов.

**Варианты доработки (на решение владельца):**
- A (рекомендую) — расширить набор в `loadSubjectReasoningBlocks:530` на `methodology_step` (+ возможно `motivation`/`competence`/`expertise`); проверить, что role-principle-synthesis берёт тот же расширенный набор. Прямо устраняет рассогласование.
- B — доработать промпт block-ingest, чтобы рассуждения про подход метились `reasoning`/`rationale`.
- C — снизить/убрать гейт `<5` (частично; не решает, если reasoning-блоков 0).

### ✅ Решение находки №2 — оформлено в ТЗ
Полный доказательный разбор (Вариант A vs B vs C, 4 независимых прохода по коду, матрица, точки правки, backfill, риски, семантика и история узкого набора) → **ТЗ `plans/tz/2026-06-22-clone-signaltype-methodology-step.md`** (+ orchestrator-prompt). Решение: расширить набор-потребитель на `methodology_step` (единая константа + 3 рубежа + backfill, без правки LLM-классификатора и без миграций). Реализация — по явному «погнали» через tz-orchestrator + выкат владельцем; прод-acceptance замкнётся на этой же Org.

## Дальше по плану (после выката ТЗ — продолжить прод-приёмку на этой Org)
- [ ] Звено 3 — rebuild построил черты (pending_verification).
- [ ] Звено 4 — концепты (SkillTraitConcept) через normalizer cron.
- [ ] Звено 5 — force `SkillTraitVerifyCron.tick` → черты active.
- [ ] Звено 6 — ExecutablePersona on-demand при первом вопросе клону.
- [ ] Звено 7 — ответ клона (от первого лица, дисклеймер) + анти-фейк (отказ на вне-темном вопросе).
- [ ] Звено 8 — слой метода (RolePrinciple через `RolePrincipleSynthesisCron.tick`).
