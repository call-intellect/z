---
type: tz
status: ready-to-implement
feature: clone-persona-method-layer
date: 2026-06-11
owner: Сергей (владелец продукта Кора)
relates_to:
  - plans/analysis/2026-06-11-clone-depth-and-persona-method.md
  - plans/tz/2026-06-11-wall4-ontology-activation.md
  - second-brain/01_projects/skill-and-clone.md
  - second-brain/02_architecture/company-memory-overview.md
---

> Анализ-вход: `plans/analysis/2026-06-11-clone-depth-and-persona-method.md` (research-complete) · Согласование с владельцем 2026-06-11: «берём всё лучшее в мире, делаем лучшее в России решение; правовой контур владелец решает сам — НЕ гейтить им реализацию».

# ТЗ — Слой метода клона (clone persona-method layer)

## Принцип

Сегодня клон Коры = «эксперт по ЗНАНИЯМ должности» (≈40% реального клона роли). Чтобы он «думал как роль», достраиваем **наблюдаемый МЕТОД работы** (а не психотип): **ценности** из проявленного поведения, **принципы решений** (слой Reflection), **методологию «ситуация→ход»** (RPD) и **разовое интервью носителя** (CDM). Берём доказанные мировые практики — Stanford Generative Agents (memory→reflection→plan, Park 2023/2024, ~85% точности на интервью), Cognitive Task Analysis / Critical Decision Method, Recognition-Primed Decision (Klein), Delphi clone-brain (explicit knowledge + implicit reasoning отдельным узлом), Anthropic character training — и кладём их на текущий стек Коры **с максимальным переиспользованием**.

**Главный инвариант (Personality Illusion, 2025):** любой слой компилируется в клон как **поведенческие ПРАВИЛА ПРОЦЕССА с цитатами-якорями** («перед рекомендацией перечисли 2-3 варианта и критерий»), а **не как ярлык** («ты рациональный»). Валидация — **по поведению** клона (composite-judge + A/B), а не по самоотчёту.

**Чего НЕ делаем (анти-scope):** психотип / MBTI / DISC / соционика / OCEAN-ярлык как ядро; «говорит точь-в-точь как человек» (стилевой дипфейк); обещание «двойник ответит ровно как он». Клон — **«информированный советник от лица ДОЛЖНОСТИ»**.

> **Правовой контур (152-ФЗ / согласие / single-incumbent):** владелец берёт на себя (решение 2026-06-11) — реализацию им НЕ блокируем. Оставлены лишь дешёвые product-quality предохранители (grounding, отказ при пробеле), потому что они повышают ВЕРНОСТЬ клона (Stanford/Delphi/PersonaCite), а не только закрывают юр-риск.

---

## REALITY-CHECK (проверено чтением кода 2026-06-11)

Бóльшая часть конвейера есть — это ТЗ на **достройку 4 слоёв + интеграцию в persona-compile + валидацию**, не «с нуля».

| Что нужно слою | Что УЖЕ есть в коде | Что строить |
|---|---|---|
| **Детектор черт из reasoning** | `skill-trait-detect.prompt.ts` — эмерджентная category + гипотеза-statement + confidence(low/medium/high) + sourceBlockIds + строгая JSON-schema; источник = reasoning-блоки (`signalType ∈ reasoning/rationale/decision_basis`, role=subject). | Новые промпты-детекторы **по этому образцу** для ценностей и маркеров процесса. |
| **Периодический rebuild-cron** | `knowledge-clone-rebuild.cron.ts` (`0 */6 * * *`, sweep Org→Person с свежей активностью→enqueue, лимит 200/проход). | Новый **Reflection-cron** по этому образцу (синтез принципов роли). |
| **Методология «ситуация→ход» (RPD)** | **`PracticeSkill`** ([schema.prisma:8143](backend/prisma/schema.prisma#L8143)) = `trigger`(ситуация/сигнал) + `steps`(Json: order/action/emotionalRegister/redFlags) + `redFlags` + `examples` + lifecycle `shadow→active` + `trafficShare` + `SkillUsage`-лог + evaluator composite. scope `person/role/org`. **Это и есть RPD.** | **НЕ строить заново.** Активировать + завести в persona-compile (сейчас игнорируется). |
| **Сборка persona** | `executable-persona-build.service.ts` `buildForProfile`(топ-20 черт) / `buildForRole`(агрегат топ-5/чел, дедуп по conceptId, ≥`roleAggMinPersons`) → `compilePersonaPrompt` → `executable-persona-compile.prompt.ts` (**мелкий: только черты → 300-800 слов от 1-го лица**). | **persona-compile v2** — секционная сборка: подход + ценности + принципы + типовые ситуации→ход + маркеры. **Точка интеграции всего ТЗ.** |
| **Интервью носителя** | `specialist-3-7-skill-probe.service.ts` (3.7 уже ходит в probe-систему) + probe-система (проактивные вопросы, только текст/голос, без inline-кнопок). | Расширить 3.7-probe на **ретроспективный разбор кейсов по CDM**; transcript → high-priority контекст клона. |
| **Самообучение клона** | `PracticeSkill` evaluator (composite: editDistance+outcome+adversarial), `preference-dataset.service.ts`. | Переиспользовать как **валидацию по поведению** новых слоёв + A/B. |
| **Анти-фальшивка ответа** | `clone-respond` отказ при <2 reasoning-блоков (cosine≥0.70) + дисклеймер «могу ошибаться». | Усилить до **per-claim grounding** + отказ при пробеле (product-quality). |

**Честная поправка к анализу:** анализ обещал «без миграции (category эмерджентная)». По факту нужна **1 небольшая аддитивная миграция**: модель `RolePrinciple` (новый узел) + дискриминатор `layer` на `SkillTrait` (чтобы persona-compile отбирал черты по слою). Это безопасная backward-compatible миграция (новая таблица + nullable/default-колонка), через `prisma:migrate` (НЕ db push, CLAUDE.md 2026-06-05).

---

## Принятые решения (2026-06-11 — не пересматривать)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Б1 | Ценности/мотивация/маркеры процесса — **переиспользовать конвейер `SkillTrait`** (детектор по образцу `skill-trait-detect`) + добавить дискриминатор `layer` (`skill\|value\|motivation\|process_marker`). | `category` уже эмерджентная; не плодить параллельные модели. `layer` нужен, чтобы persona-compile секционировал (без него черты и ценности смешаются в топ-20). Аддитивная миграция. |
| Б2 | **Слой Reflection — отдельная новая модель `RolePrinciple`** (не SkillTrait-категория). | Принцип = СИНТЕЗ из многих наблюдений с обобщением; у него другой жизненный цикл (периодический ресинтез), чем у черты (одно наблюдение). «Не растворять в SkillTrait» — анализ §3 + паттерн Delphi (implicit reasoning отдельным узлом). |
| Б3 | **Методологию RPD НЕ строить — переиспользовать `PracticeSkill`** (активировать + скомпилировать в persona). | `PracticeSkill` уже = RPD (trigger→steps→redFlags+evaluator). Строить заново = код ради кода (`feedback_fix_the_whole_class`). |
| Б4 | **persona-compile v2** — секционная сборка, каждый слой как **правила процесса с якорями**, не ярлык. | Personality Illusion: ярлык двигает самоотчёт, не поведение. Секции: [подход/черты] + [ценности] + [принципы (Reflection)] + [типовые ситуации→ход (PracticeSkill)] + [маркеры процесса]. |
| Б5 | **CDM-интервью — расширить `specialist-3-7-skill-probe`**, transcript = high-priority контекст клона. | Stanford: интервью даёт самый большой прирост точности над пассивными данными. probe уже есть. Только свободный текст/голос — `feedback_probe_no_buttons_text_voice_only`. |
| Б6 | **Валидация по ПОВЕДЕНИЮ** (composite-judge + A/B), self-improving **без human-approval-гейта** (только kill-switch). | `feedback_no_human_in_loop_for_clone_learning` + `feedback_no_golden_ship_and_observe_prod`. Переиспользует evaluator `PracticeSkill`. |
| Б7 | Все флаги — **kill-switch ON (Ship-On)**; правовой контур владелец решает отдельно, реализацию не гейтит. | Согласовано 2026-06-11. Не owner-decision-параметр (не деньги/доступ). |

---

## Доказательство выбора (Проход A vs B)

**Проход A (выбран):** переиспользовать `SkillTrait`-конвейер (+`layer`) для ценностей/маркеров, `PracticeSkill` для RPD; единственный новый узел — `RolePrinciple`; интеграция через persona-compile v2.
**Проход B (отвергнут):** отдельная структурированная модель `PersonaMethodProfile` (типизированные поля: вектор ценностей, оси решений, список принципов) + единый «method-специалист».

| Критерий | A (reuse) | B (new model) |
|---|---|---|
| Переиспользование готового конвейера | ✓ (SkillTrait/PracticeSkill/cron/probe/evaluator) | ✗ всё заново |
| Объём миграций | ✓ 1 малая (RolePrinciple + layer) | ✗ крупная новая модель |
| Grounding/lifecycle из коробки | ✓ (confidence/observationCount/sourceBlockIds/evaluator) | ✗ дублировать |
| Структурная queryability | ⚠️ через layer-фильтр | ✓ типизировано |
| Риск дублирования RPD | ✓ нет (reuse PracticeSkill) | ✗ соблазн переписать |

**Вывод:** A — меньше кода, ниже риск, ложится на проверенный конвейер. Структурная queryability B не нужна (на выходе — текстовый persona-prompt). Challenge-loop: корень («нет слоя метода») закрыт; RPD не дублируем; новый узел только там, где жизненный цикл реально иной (Reflection).

---

## Scope

### Входит
- Этап 0: `clone-respond` v2 — per-claim grounding + отказ при пробеле + лёгкий журнал запросов к клону (`CloneQueryLog`).
- Этап 1: модель `RolePrinciple` + Reflection-cron (синтез принципов) + детектор `value-motivation-detect` → SkillTrait layer=value/motivation.
- Этап 2: активация `PracticeSkill` в persona + детектор `process-marker-detect` → SkillTrait layer=process_marker (только конструктивные оси).
- Этап 3: расширение 3.7-probe на CDM-интервью + хранение transcript как high-priority контекста клона.
- Интеграция: **persona-compile v2** (секционная сборка) + `build.service` подтягивает все слои.
- Валидация: composite-judge по поведению + A/B (reuse evaluator).
- Регистрация: флаги в `feature-flags.md`, taskType в LLM-registry, скрипты в `apply-prod-deploy.ts`.

### Не входит (vNext / явные заглушки)
- **Оценочные оси стиля решений (avoidant/dependent «избегает/не решает сам»)** — НЕ строить (кадрово-токсичны; см. анти-scope). Только конструктивные маркеры.
- **OCEAN/Big Five conditioning, коммуникативный стиль (styleProfile)** → vNext `plans/tz/…-clone-style-and-traits.md` (владелец решит отдельно; вторично для роли).
- **Обучающий мост фидбека→DPO/LoRA** → vNext (clone-learning loop, переиспользует `preference-dataset`).
- **Snapshot-таймлайн / UI редактирования принципов носителем** → vNext.

### Граничные контракты с другими ТЗ
- ТЗ `2026-06-11-wall4-ontology-activation.md` (Блок 3) активирует `CLONE_V2` — это ТЗ **строит поверх активированного клона**; если Wall4-Блок3 ещё не выкачен, новые слои всё равно компилируются в persona (читаются при `CLONE_V2_ENABLED=true`). Не дублировать активацию `CLONE_V2`.
- `PracticeSkill` extraction/evaluator — **существуют**, не переписывать; здесь только активация + компиляция в persona.

---

## Контракты (contract-first)

### Prisma — новая модель + дискриминатор (1 миграция: `prisma:migrate --name clone_method_layer`)
> Номера строк — на 2026-06-11, перед правкой перечитать. Используется существующий enum `SkillConfidence`.

```prisma
/// TZ clone-method (2026-06-11) — RolePrinciple — синтезированный ПРИНЦИП/паттерн
/// решений роли (Reflection-слой, Park 2023). НЕ черта человека («осторожный»),
/// а обобщённый ПРОЦЕСС роли («типовой ход: сначала пилот на 5%, потом раскатка»).
/// Синтезируется периодическим cron из накопленных reasoning-блоков должности,
/// с обратными ссылками на наблюдения (grounding). Отдельный узел: черта = одно
/// наблюдение, принцип = обобщение многих.
model RolePrinciple {
  id               String                       @id @default(cuid())
  tenantId         String
  /// Role.id — принцип процесса ДОЛЖНОСТИ (переживает ротацию носителя).
  roleId           String
  /// Краткая метка-ситуация, к которой относится принцип («срыв срока», «выбор подрядчика»).
  situation        String                       @db.VarChar(200)
  /// Обобщённая ПОВЕДЕНЧЕСКАЯ формулировка процесса (без оценок личности):
  /// «При срыве срока — сначала эскалирует владельцу с 2 вариантами, затем режет scope».
  statement        String                       @db.Text
  /// IdeaBlock.id, на которых построено обобщение (grounding-trail, ≥ порога).
  sourceBlockIds   String[]                     @default([])
  observationCount Int                          @default(0)
  confidence       SkillConfidence
  /// Эмбеддинг (situation+statement) — дедуп/ретрив.
  embedding        Unsupported("vector(1536)")?
  status           RolePrincipleStatus          @default(active)
  supersededById   String?
  lastSynthesizedAt DateTime                    @default(now())
  createdAt        DateTime                     @default(now())
  updatedAt        DateTime                     @updatedAt

  org Org @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, roleId, status])
  @@index([tenantId, situation])
  @@map("role_principles")
}

enum RolePrincipleStatus {
  active
  superseded
  archived
}

/// Дискриминатор слоя черты — чтобы persona-compile отбирал по слою.
enum SkillTraitLayer {
  skill          // поведение при решениях (текущий дефолт)
  value          // что ставит выше при конфликте приоритетов (Schwartz, revealed)
  motivation     // что драйвит в работе (SDT)
  process_marker // конструктивный маркер процесса (перечисляет критерии / перепроверяет)
}
```
+ на модели `SkillTrait` добавить: `layer SkillTraitLayer @default(skill)` (аддитивно, backward-compatible) + `@@index([profileId, layer, status])`.
+ обратная связь `rolePrinciples RolePrinciple[]` на `Org`.

### LLM-промпты (по образцу `skill-trait-detect`, stable SYSTEM — cache-friendly)
- `value-motivation-detect` — вход: reasoning-цитаты с trade-off; выход JSON `{layer:'value'|'motivation', category(эмерджентная), statement(гипотеза, человеческим языком, без научного жаргона), confidence, sourceBlockIds}`. Детектит **решающие моменты** (роль явно выбрала одно в ущерб другому) = revealed preference.
- `process-marker-detect` — выход JSON как у trait, layer=process_marker, **только конструктивные**: «перечисляет критерии перед выбором», «перепроверяет вывод/просит данные», «оспаривает первый ответ». **Запрет** оценочных «избегает/не решает сам».
- `role-principle-synthesize` — вход: накопленные reasoning-блоки роли (сгруппированы по ситуациям); выход JSON `{principles:[{situation, statement(процесс, не черта), sourceBlockIds(≥порога), observationCount, confidence}]}`. taskType = capable (DeepSeek V4 Pro). Запрет негативно-диагностической лексики о носителе.
- `cdm-case-interview` (расширение 3.7-probe) — ведёт ретроспективный разбор реального кейса: «почему выбрали этот вариант / что насторожило / какие альтернативы отвергли». Вопросы **не наводящие**, свободный ответ (текст/голос).

### persona-compile v2 (контракт секций)
`EXECUTABLE_PERSONA_COMPILE_V2` — SYSTEM перечисляет секции; USER передаёт собранные слои. Секции (пустая опускается):
1. Подход (черты layer=skill) — как сейчас.
2. **Что ставит выше** (layer=value) + что драйвит (layer=motivation).
3. **Принципы решений роли** (RolePrinciple — «в ситуации X типовой ход — Y»).
4. **Типовые ситуации → ход** (активные `PracticeSkill` роли: trigger→steps).
5. **Как подходит к процессу** (layer=process_marker — конструктивные правила).
Всё от 1-го лица, гипотезным тоном, **как правила процесса** («обычно перед рекомендацией я перечисляю варианты и критерий»), не ярлыки.

### API / журнал (Этап 0)
- `CloneQueryLog` (новая лёгкая модель: tenantId, cloneScope, cloneTargetId, userId, question(hash/preview), answeredGrounded(bool), createdAt) — лог запросов к клону, видимый владельцу. `@@index([tenantId, cloneTargetId, createdAt])`.
- `clone-respond` v2: каждое утверждение привязано к `IdeaBlock/Entity`; нет опоры → «нет наблюдения под этим» (отказ), не выдумка.

### Совместимость с prompt caching
Все новые промпты — стабильный SYSTEM, переменные данные (цитаты/слои) в конце USER (как `skill-trait-detect`). persona-compile v2 SYSTEM стабилен. Правок SYSTEM на лету нет.

---

## Фазы (`[ ]`, dependency-ordered)

Граф: **Э0** ∥ **Э1** ∥ **Э2** (данные-производители независимы) → **ИНТ** (persona-compile v2, зависит от Э1+Э2) → **ВАЛ** (валидация). **Э3** (CDM-интервью) ∥ Э1/Э2, его выход — высокоприоритетные reasoning-блоки, которые кормят те же детекторы/синтез.

### [x] Фаза Э0.1 — clone-respond v2: grounding + отказ + журнал
- **Картография:** `clone-respond.prompt.ts`, `clones.service.ts` (anti-fake topic-density), новая модель `CloneQueryLog`.
- **Входит:** per-claim grounding (утверждение ↔ IdeaBlock/Entity); отказ при пробеле; запись `CloneQueryLog`.
- **Не входит:** правовой контур/согласие (владелец), per-claim UI-цитаты в чате (vNext).
- **Acceptance:** spec — ответ без опоры → отказ (не галлюцинация); `CloneQueryLog` пишется (tenant-изоляция); `bun run typecheck && build` зелёные.
- **Закрывает:** R1, R2.

### [x] Фаза Э1.1 — Модель RolePrinciple + layer (миграция)
- **Входит:** `prisma:migrate --name clone_method_layer` (RolePrinciple + RolePrincipleStatus + SkillTraitLayer + SkillTrait.layer default skill); `prisma:generate`.
- **Acceptance:** таблицы `role_principles` создана, колонка `skill_traits.layer` дефолт `skill` (повтор миграции — no-op на проде через migrate deploy); существующие SkillTrait получают layer=skill (backward-compatible); `bun run typecheck` зелёный.
- **Закрывает:** R3 (часть).

### [x] Фаза Э1.2 — Reflection-синтезатор принципов (@Cron)
- **Картография:** `knowledge-clone-rebuild.cron.ts` (образец), новый `role-principle-synthesize` промпт, `RolePrinciple`.
- **Входит:** @Cron по образцу (sweep Org→Role с порогом наблюдений) → группирует reasoning-блоки роли по ситуациям → LLM `role-principle-synthesize` → upsert `RolePrinciple` с grounding-ссылками; дедуп по embedding; флаг kill-switch ON.
- **Не входит:** оценочные черты носителя (только процесс роли); UI редактирования.
- **Acceptance:** на seed-данных роли с ≥порога reasoning-блоков синтезируются принципы с непустым `sourceBlockIds`; повторный прогон не дублирует (дедуп по embedding); греп «process, не черта» — промпт запрещает диагностическую лексику; spec + `build` зелёные.
- **Закрывает:** R3, R4.

### [x] Фаза Э1.3 — Детектор ценностей/мотивации (revealed preferences)
- **Картография:** `skill-trait-detect.prompt.ts` (образец), `specialist-3-7-skill.service/worker` (образец регистрации), routing-dispatcher.
- **Входит:** промпт `value-motivation-detect` + специалист-воркер (по образцу 3.7), пишет SkillTrait `layer=value/motivation` из trade-off; человеческим языком; флаг kill-switch ON.
- **Не входит:** научные ярлыки (не «по Schwartz» в выдаче), негативные формулировки.
- **Acceptance:** на цитатах с явным trade-off извлекается value/motivation-черта с `sourceBlockIds`; на цитатах без выбора-в-ущерб — пусто; layer проставлен; spec + `build` зелёные.
- **Закрывает:** R5.

### [x] Фаза Э2.1 — Активация PracticeSkill (RPD) + детектор маркеров процесса
- **Картография:** `PracticeSkill` extraction/evaluator (существуют), флаг PracticeSkill, `process-marker-detect` (новый, образец skill-trait-detect).
- **Входит:** включить extraction/evaluator `PracticeSkill` (kill-switch ON); детектор `process-marker-detect` → SkillTrait `layer=process_marker` (только конструктивные оси).
- **Не входит:** новая модель под RPD (reuse PracticeSkill); оценочные оси.
- **Acceptance:** `PracticeSkill` извлекается и доходит до status active по evaluator; process-marker черты пишутся с layer; греп — нет осей «avoidant/dependent/избегает/не решает сам» в промпте/выдаче; spec + `build` зелёные.
- **Закрывает:** R6, R7.

### [x] Фаза Э3.1 — CDM-интервью носителя через probe
- **Картография:** `specialist-3-7-skill-probe.service.ts`, probe-система (`feedback_probe_no_buttons_text_voice_only`), ingest (новый высокоприоритетный sourceType/флаг для transcript).
- **Входит:** расширить 3.7-probe на ретроспективный разбор 3-5 реальных кейсов по CDM (не наводящие вопросы, текст/голос); transcript → RawEvent с пометкой «interview» (high-priority контекст клона), кормит детекторы Э1/Э2.
- **Не входит:** автоинтервью без участия носителя; inline-кнопки.
- **Acceptance:** probe формирует CDM-вопросы по реальному кейсу (греп: «почему выбрали / что насторожило / альтернативы»); transcript сохраняется как высокоприоритетный источник и попадает в reasoning-пул роли; нет inline_keyboard; spec + `build` зелёные.
- **Закрывает:** R8.

### [x] Фаза ИНТ.1 — persona-compile v2 (секционная сборка) — KEYSTONE
- **Зависит от:** Э1.2, Э1.3, Э2.1 (иначе секции пусты).
- **Картография:** `executable-persona-compile.prompt.ts`, `executable-persona-build.service.ts` (`buildForProfile`/`buildForRole`/`compilePersonaPrompt`).
- **Входит:** v2-промпт с 5 секциями; `build.service` подтягивает: черты(layer=skill) + ценности/мотивацию(layer=value/motivation) + RolePrinciple + активные PracticeSkill роли + process_marker; компилирует как правила процесса с якорями; пустые секции опускаются.
- **Не входит:** изменение лимитов топ-N без нужды; ярлыки-психотипы.
- **Acceptance:** persona роли с заполненными слоями содержит секции «принципы решений» и «типовые ситуации→ход» (греп в результате); при пустых слоях — деградирует к текущему поведению (только черты); длина в контракте; SYSTEM стабилен (cache); spec + `build` зелёные.
- **Закрывает:** R9.

### [x] Фаза ВАЛ.1 — Валидация по поведению (composite-judge + A/B)
- **Зависит от:** ИНТ.1.
- **Картография:** evaluator `PracticeSkill` + `preference-dataset.service.ts` (образцы), метрики.
- **Входит:** composite-judge оценивает, отвечает ли клон **как роль** на реальных кейсах (поведение, не самоотчёт); A/B persona-v1 vs v2; метрики `clone_persona_layer_score`.
- **Не входит:** обучающий мост DPO/LoRA (vNext); human-approval-гейт (только kill-switch).
- **Acceptance:** judge даёт сравнимый скор v2≥v1 на наборе кейсов; метрика экспортируется; нет блокирующего human-approval (греп); spec + `build` зелёные.
- **Закрывает:** R10.

---

## Требования (EARS)
- **R1.** Если у ответа клона нет опоры (≥2 reasoning-блока / grounded-утверждение), then клон shall отказаться с дисклеймером, не выдумывая.
- **R2.** Когда задан вопрос клону, система shall записать `CloneQueryLog` (видимый владельцу).
- **R3.** Когда по роли накоплено ≥ порога reasoning-блоков, Reflection-cron shall синтезировать `RolePrinciple` (процесс роли) с непустым `sourceBlockIds`; повтор без новых данных = no-op (дедуп).
- **R4.** `RolePrinciple.statement` shall описывать ПРОЦЕСС роли, не черту личности (промпт запрещает диагностическую лексику).
- **R5.** Когда в событиях есть trade-off (выбор в ущерб альтернативе), детектор shall извлечь SkillTrait `layer=value/motivation` с якорем-цитатой.
- **R6.** `PracticeSkill` (RPD) shall извлекаться, доходить до `active` по evaluator и компилироваться в persona.
- **R7.** Детектор маркеров процесса shall писать только конструктивные оси; оценочные «избегает/не решает сам» shall отсутствовать.
- **R8.** CDM-интервью через probe shall вести разбор реальных кейсов (не наводящие, текст/голос); transcript shall стать высокоприоритетным reasoning-источником роли.
- **R9.** persona-compile v2 shall собирать секции (подход/ценности/принципы/ситуации→ход/маркеры) как правила процесса; при пустых слоях shall деградировать к текущему поведению.
- **R10.** Валидация shall оценивать клон ПО ПОВЕДЕНИЮ (composite-judge + A/B), без human-approval-гейта (только kill-switch).
- **R11.** Каждый флаг shall иметь строку в `docs/operations/feature-flags.md` (kill-switch ON).

---

## Границы фичи
- ✅ **Always:** черты/принципы — гипотезным тоном с якорями; синтез ПРОЦЕССА роли; переиспользовать PracticeSkill/SkillTrait/cron/probe/evaluator; стабильный SYSTEM (cache).
- ⚠️ **Ask first:** материализация коммуникативного стиля / OCEAN (vNext, владелец); расширение `CONTRADICTING`/оценочных осей.
- 🚫 **Never:** психотип/MBTI/DISC/ярлыки; оценочные оси (avoidant/dependent); «говорит точь-в-точь»; обещание «ответит ровно как он»; человек-approval как regular gate; правки SYSTEM на лету (ломает кэш).

---

## Прод-инструкция (runbook) — все команды через `docker compose exec backend …`
1. Миграция `clone_method_layer` — авто при `docker compose up -d` (migrate deploy). Подтвердить: `role_principles` создана, `skill_traits.layer` дефолт `skill`.
2. Сид taskType новых промптов: `docker compose exec backend bun run scripts/seed-llm-task-routes-*.ts` (зарегистрировать `value-motivation-detect`/`process-marker-detect`/`role-principle-synthesize`/`cdm-case-interview` — добавить в `apply-prod-deploy.ts STEPS`).
3. Флаги (kill-switch ON) выставить в прод-`.env` + `docker compose up -d backend`: Reflection-cron, value-detector, process-marker-detector, PracticeSkill, clone-respond-v2.
4. Smoke: persona роли после прогона cron содержит секции «принципы» и «ситуации→ход»; клон без опоры — отказывается; `CloneQueryLog` пишется.

**Реестр флагов (`feature-flags.md`, R11):** 5 строк kill-switch ON (reflection / value-detector / process-marker / practice-skill / clone-respond-v2).

---

## Pre-mortem / Риски
| Риск | Митигирование |
|---|---|
| **Эндогенная циркулярность** (LLM детектит, синтезирует и судит сам) | Валидация по ПОВЕДЕНИЮ на реальных кейсах с известным исходом (ВАЛ.1) + grounding-якоря обязательны + порог observationCount. |
| Reflection скатывается в черту личности («осторожный») | Промпт `role-principle-synthesize` запрещает диагностическую лексику; composite-judge отклоняет character-суждения (греп-маркер в spec). |
| Псевдоточность/Барнум | Гипотезный тон + якорь-наблюдение на каждый слой (наследует контракт skill-trait-detect); пустой результат при отсутствии сигнала. |
| Persona drift в длинном диалоге | Правила процесса в стабильном SYSTEM (cache), периодически перевставлять. |
| Дублирование RPD | Б3 — reuse PracticeSkill, не строить (ревью-гейт проверяет, что новой RPD-модели нет). |
| Стоимость LLM (синтез/детекторы) | Дешёвые детекторы — flash; синтез — capable, но cron с порогом+лимитом (образец knowledge-clone-rebuild MAX 200/проход); cost-метрики. |

**Ревью-аспекты (`strict-production-review-gate`):** tenant-изоляция новых моделей (`@@index([tenantId,…])`); идемпотентность cron/детекторов/миграции; нет новой RPD-модели (reuse); нет оценочных осей; нет `process.env.*`/`prisma migrate`/`new PrismaClient(` в скриптах; стабильный SYSTEM; флаги kill-switch.

---

## DoD
- `bun run typecheck`(вкл. `.spec`)·`lint`·`build` зелёные (back+front, если затронут UI журнала).
- `bunx vitest run` новых spec; tenant-изоляция + идемпотентность покрыты.
- `second-brain/` обновлён: `01_projects/skill-and-clone.md` (новые слои), `02_architecture/data-model.md` (RolePrinciple+layer+CloneQueryLog), `01_projects/ai-jobs.md`/`workers-queues.md` (Reflection-cron+детекторы).
- `docs/operations/feature-flags.md` (5 флагов) + `prod-deploy-log.md` Шаги 1/4/12 + скрипты в `apply-prod-deploy.ts STEPS`.
- `04_не-сделано/README.md`: vNext-заглушки (clone-style-and-traits, clone-learning-DPO, snapshot-timeline).
- Рефлексия в `05_история/` после push.

---

## Итог
_Заполняется `tz-orchestrator`._

> **Запуск:** многофазное ТЗ. Вести через `tz-orchestrator`. Парный orchestrator-prompt — `plans/tz/2026-06-11-clone-persona-method-layer-orchestrator-prompt.md`.
