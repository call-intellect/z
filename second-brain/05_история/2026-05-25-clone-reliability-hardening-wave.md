---
type: reflection
date: 2026-05-25
distilled: false
---

# 2026-05-25 — clone-reliability-hardening (волна)

## Постановка

Владелец попросил разобрать архитектуру клона сотрудника (γ-1 — SkillProfile + ExecutablePersona + Clone API) и найти слабые места. Из разбора выросло ТЗ [`plans/tz/2026-05-25-clone-reliability-hardening.md`](../../plans/tz/2026-05-25-clone-reliability-hardening.md) — 6 фаз: антифальшивка, смысловые блоки навыка, глава отдела, семантический поиск, реактивная пересборка, заморозка моделей + golden-набор. Затем владелец сказал «выступаешь как оркестратор, доделывай и возвращайся, когда полностью готово».

## Что сделал

Запустил 3 волны параллельных subagent'ов (через `Agent` tool), факт-чек после каждой волны, точечные правки конфликтов, атомарные коммиты по фазам.

**Волна 1** (3 параллельных): Фаза 1 (антифальшивка), Фаза 3 (глава отдела), Фаза 5 (реактивная пересборка).
- Коммиты: `acd9a14`, `5afb7eb`, `49e5825`.
- Конфликт: оба агента Фаз 1 и 5 правили общие конфиги (`env.schema.ts`, `typed-config.service.ts`, `business-metrics.service.ts`); агент Фазы 5 затёр настройки Фазы 1. Поправил руками.
- Блокер: Фаза 3 требовала правки `schema.prisma`, в котором у владельца лежало 290 строк параллельной работы. Сначала оставил Фазу 3 некоммитнутой, вернулся с отчётом, попросил решение.

**Волна 2** (2 параллельных, после разблокировки): Фаза 2 (смысловые блоки навыка — главная, ~3000 строк), Фаза 6.4 (golden-набор `skill-trait-detect`).
- Коммиты: `45a4510`, `deafcf7`, плюс `f4c61a5` HNSW-индексы отдельно.
- Schema.prisma уже содержала `SkillTraitConcept`, `PersonKnowledgeCategoryEmbedding`, `pinnedVersionNote` — параллельная работа владельца в `ba0c0c6` (`feat(ai,admin): запись quality_score`) опередила меня и подготовила место для всех 3 моих фаз 2/4/6.5. Edit'ы агентов прошли идемпотентно.

**Волна 3** (2 параллельных): Фаза 4 (семантический поиск), Фаза 6.5 (заморозка модели через snapshot).
- Коммиты: `e5433a8`, `b6b33db`.

Финальный push: `06158ad..b6b33db` (8 коммитов через `git push origin dev`).

## Что вышло

7 фаз ТЗ закрыто (1, 2, 3, 4, 5, 6.3 встроено в 2, 6.4, 6.5). Фаза 6.2 (admin/llm-routes UI) закрыта параллельно владельцем в `d74c8a2`.

Заблокирована **Фаза 6.1** (переключение `skill-trait-detect` на `deepseek-v4-pro`) — параллельный ТЗ [`deepseek-pro-output-format-fix.md`](../../plans/tz/2026-05-25-deepseek-pro-output-format-fix.md) в `draft`. DeepSeek-V4-Pro+thinking не поддерживает strict json_schema, нужна автоконвертация в `DeepSeekService`. Snapshot-тесты Фазы 6.5 защищают seed-route от случайного переключения до фикса.

Верификация:
- Все unit/integration/snapshot-тесты по моим фазам — зелёные (84 + 8 + 4 + 3 + 6 + 4 + 3 = всего 112+).
- `bun run typecheck` (backend + frontend) — чистый по моим файлам.
- Push прошёл без хуков-блокеров.

## Чему научился

1. **`git log --oneline -10` показывает только верхние 10 коммитов — мои могли «исчезнуть из истории» просто потому, что параллельная сессия владельца за пару часов налила 15 коммитов поверх.** В отчёте между моими ответами я ошибочно сказал «мои коммиты пропали», хотя `git log --all -20` и `git reflog` показывали их. → Всегда `git log --all` или `git log -N` с N >= 30 при первом анализе после возможной параллельной активности.

2. **Schema.prisma — горлышко при параллельных сессиях.** Если у владельца там 290 строк своей работы, я не могу безопасно закоммитить даже маленький свой hunk. → Перед началом любого ТЗ, требующего правок schema, проверять `git diff --stat backend/prisma/schema.prisma`. Если > 50 строк диффа — остановиться и согласовать порядок коммитов.

3. **Параллельные агенты могут затереть правки друг друга в общих файлах** (env.schema.ts, typed-config.service.ts, business-metrics.service.ts). Tool Edit не делает merge, последний победил. → В промпте каждому агенту явно перечислять «эти строки уже могут быть от другого агента — добавляй СВОИ рядом, не переписывай». После волны — обязательный grep ключевых маркеров каждого агента.

4. **Параллельная работа владельца может «предусмотрительно» сделать schema-правки за меня.** В `ba0c0c6` владелец добавил 3 новых модели/поля для моих будущих фаз — потому что писал смежный код и заодно расширил schema. Это сэкономило мне один большой `prisma:push`-блокер, но мои Edit'ы прошли вхолостую — schema уже была. → При работе с моделями всегда сначала `grep` по schema.prisma, проверить отсутствие, потом писать Edit.

5. **Anti-deepfake правило клона нельзя оставлять только в промпте.** Промпт-правило «если в контексте <2 reasoning-блоков — откажись отвечать» работало в γ-1, но модель могла его игнорировать. Перенос в код (через embed-сравнение в `ClonesService.askPerson` ДО вызова LLM) дал детерминированную защиту. → Любая критическая защита (deepfake / safety / RBAC) — должна быть в коде, а не в просьбе к модели.

6. **Golden-набор инвариантов работает лучше, чем точные ожидаемые строки.** Для `skill-trait-detect` я использовал `categoryKeywords` (хотя бы одно слово из списка), `statementContainsQualifier` (есть ли «похоже»/«склон»/«в большинстве случаев»), `forbiddenWords` (НЕТ «выдающийся»/«перфекционист») — это устойчиво к лёгким перефразировкам LLM, но ловит сдвиг стиля. → Для языковых задач — инварианты вместо точных строк.

7. **Заморозка модели без поддержки версионных slug-ов в прокси.** Прокси DeepSeek принимает только базовое имя `deepseek-v4-pro` (без `@дата`). Заморозить «версию которая работала» нельзя на уровне API. Защита через snapshot-тест seed-route — ломается, если кто-то поменял model — плюс UI warning «без закреплённой версии» для критичного списка. → Когда внешний API не даёт версионирования — переноси контроль в свой код через тесты и пометки.

## Дополнение того же дня — Фаза 6.1 закрыта

После основной волны провёл ещё один цикл:

1. **Перепроверил «блокер»** — оказался фантомным. Коммит `a8b2ab6 feat(ai/deepseek): авто-конвертация json_schema → tool для V4-Pro` (от того же 2026-05-25) уже реализовал автоконвертацию `response_format: json_schema strict` → `tools[]` + `tool_choice: 'auto'` для DeepSeek-V4-Pro. Я в основном отчёте говорил «фикс в draft» — был неправ, фактически фикс был сделан **до** моих фаз 1/5. Frontmatter ТЗ `deepseek-pro-output-format-fix.md` обновлён `draft → implemented`.

2. **Owner провёл golden-прогон** под `SKILL_TRAIT_DETECT_GOLDEN_REAL=1`:
   - `gpt-5.4` — 23/25 (92%), $0.10.
   - `deepseek-v4-pro` — 24/25 (96%), $0.02.
   - DeepSeek победил по точности и в 4.5× дешевле → решение переключать.

3. **Переключил seed-script** `seed-llm-task-routes-skill-and-clone.ts`:
   - `skill-trait-detect`: primary `deepseek:deepseek-v4-pro`, secondary `openai-via-proxy:gpt-5.4` (страховка).
   - `pinnedVersionNote` заполнено прямо в seed: "Закреплено на deepseek-v4-pro 2026-05-25 после golden-прогона (24/25 vs gpt-5.4 23/25, $0.02 vs $0.10). Перед сменой primary — обязательно прогнать SKILL_TRAIT_DETECT_GOLDEN_REAL=1...".
   - Расширил `TaskRouteSeed` интерфейс полем `pinnedVersionNote?`, `applySeed` пробрасывает в `LlmTaskRoute.create`/`update`.
   - Snapshot-тест обновлён через `bunx vitest --update` — новая цепочка зафиксирована.

4. **Дополнительный урок** (8-й к 7 основным):

   **Анализ «что блокирует» нужно делать на коде, а не на frontmatter ТЗ.** Я смотрел на `status: draft` в `deepseek-pro-output-format-fix.md` и делал вывод что не реализовано. На самом деле код был, рефлексия была, коммит был. Frontmatter просто не успели обновить. → При вопросе «что блокирует» — grep по реальному коду (наличие функции/класса), а не статус ТЗ. ТЗ — отстающий индикатор.

ТЗ `plans/tz/2026-05-25-clone-reliability-hardening.md` теперь весь закрыт (`status: implemented`, `all-phases-closed: 2026-05-25`).

## Что осталось
- **Frontend интеграция с `conceptId`** — на `/persons/[id]/skill-profile` группировка traits идёт по `category` (тексту), не по `conceptId`. После бэкфилла можно сделать естественный шаг — группировать по концепту. Не критично для MVP.
- **Виджет «топ-смысловых блоков компании»** на дашборде CEO — отложен, см. [[skill-trait-concepts]] «Что осталось».
- **Реестры в `second-brain`** (`02_architecture/data-model.md`, `module-map.md`, `01_projects/ai-jobs.md`, `workers-queues.md`, `api-layer.md`, `frontend-pages.md`, `admin.md`) — не обновил детально. Изменений много, прицельные правки сделал только в `skill-and-clone.md` и создал `skill-trait-concepts.md`. Реестры обновлять при следующей итерации.

## Прод-команды

После деплоя на prod:

```bash
# 1. Применить schema (модели уже в schema.prisma, владелец закоммитил в ba0c0c6)
cd backend && bun run prisma:push

# 2. Создать новые HNSW-индексы (skill_trait_concepts, person_knowledge_category_embeddings)
bun run scripts/apply-postgres-init.ts

# 3. Зарегистрировать новый LLM-роут для агента skill-trait-concept-name
bun run scripts/seed-llm-task-routes-skill-concept.ts

# 4. (опц.) Бэкфилл существующих SkillTrait → SkillTraitConcept
bun run scripts/skill-trait-concepts-backfill.ts

# 5. (опц.) Бэкфилл embedding'ов категорий знаний для семантического поиска
bun run scripts/person-knowledge-embeddings-backfill.ts

# 6. Рестарт backend и worker процессов — подхватят новые cron'ы (0 3 * * * нормализатор)
```

ENV-переменные с дефолтами (можно не выставлять — будут use defaults):
```
CLONE_TOPIC_SIMILARITY_THRESHOLD=0.70
CLONE_TOPIC_MIN_BLOCKS=2
CLONE_CONCEPT_MATCH_THRESHOLD=0.85
CLONE_CONCEPT_MERGE_THRESHOLD=0.92
CLONE_CONCEPT_ARCHIVE_AFTER_MONTHS=6
KNOWLEDGE_CLONE_EMBEDDING_FALLBACK_THRESHOLD=5
KNOWLEDGE_CLONE_MIN_MATCH_SCORE=1.0
PERSONA_REBUILD_TRAIT_DELTA_THRESHOLD=2
PERSONA_REBUILD_MAX_AGE_HOURS=48
```
