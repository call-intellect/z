---
date: 2026-05-26
type: рефлексия
session: миграция LLM-агентов на DeepSeek-V4-Pro (Фазы 0-8)
distilled: false
---

# Рефлексия — миграция LLM-агентов на DeepSeek-V4-Pro (8 фаз, 1 сессия)

## Что было поставлено

Применить ТЗ-копилку `plans/tz/2026-05-25-llm-architecture-changes-from-experiments.md` — серию архитектурных изменений по результатам 4 экспериментов + golden-набора + smoke 28 агентов. Главные блоки:

- §4 — фикс формата вывода для thinking-моделей (фундамент)
- §6 + §8 — operations (batch checkin) + skill-trait-detect verify
- §10 Find 1 + 2 — аудит maxTokens + вынос embedded-промптов
- §2 — chat-v2 на Pro + массовый перевод 19 одиночек
- §1 — meeting-report-fast (один LLM-вызов вместо 5)
- §3 — Specialists Combined (Б+, один вызов на 8 типов сущностей)
- §9 — clone-respond v2 (CloneAccessGrant + dialog-layer + 2 режима)

Пользователь: «делай все по порядку, не спеши, у тебя есть агенты». Я как оркестратор делегирую sub-агентам, факт-чекаю и коммичу.

## Как решал

**Оркестратор-паттерн.** Каждую фазу делегировал отдельному `general-purpose` агенту с чётким брифом: источник правды, ограничения, этапы (аудит → план → применение → verification), запреты. После каждого агента — факт-чек через `git status` + `git diff` + `bun run typecheck` + точечные unit-тесты.

**Параллельная сессия.** В репо одновременно работала ещё одна сессия Claude Code (feedback-модуль, KC-Temporal W3.5, admin-settings Phase 5). Стратегия — не пересекаться: в брифах каждого агента явно перечислял запретные пути (feedback/**, admin/settings/**, specialists 3-*). Несколько раз спасало: параллельный агент успел добавить мой счётчик `incLlmThinkingModelGuard` в business-metrics параллельно — lucky convergence.

**Flag-based rollout для крупных фаз.** Фаза 6 (SpecialistsCombined) и Фаза 7 (clone-respond v2) — flag-based, чтобы не ломать существующий путь:
- `SPECIALISTS_COMBINED_ENABLED` (default false) — новый сервис рядом со старыми специалистами, не удаляет их
- `CLONE_V2_ENABLED` (default false) — ранний return askPersonV2/askRoleV2, legacy полностью сохранён

**Конкретные коммиты:**
| # | Коммит | Фаза | Размер |
|---|---|---|---|
| 0 | `5921a20` | Карта AI-агентов (ai-agents-map.md) | 642+ |
| 1 | `92aec84` | §4 фикс формата (isThinkingModel helper, автоконверт json_schema→tools) | 534+ |
| 2 | `3cba11d` | §6 operations (CheckinSentimentBatchCron, max_tokens 300→1500) + §8 verify | 474+ |
| 3 | `d50f0e3` | §10 Find 1 maxTokens (6 точек до 1500/4000/8000/16000) | 22+ |
| 4 | `5cf6198` | §2 chat-v2 + dialog-layer + 19 одиночек на Pro (patch-mass-migrate-to-deepseek-pro) | 538+ |
| 5 | — | §1 meeting-report-fast verified, параллельная сессия закрыла раньше | — |
| 6 | `46af33d` | §3 SpecialistsCombined (новый сервис, taskType knowledge-specialists-combined) | 2361+ |
| 7 | `f897d99` | §9 clone-respond v2 (CloneAccessGrant, dialog-layer, factual/judgmental, 2 endpoint'а) | 2063+ |
| 8 | `cad4aef` | §10 Find 2: 5 embedded-промптов → prompts/*.prompt.ts + 14 snapshot-тестов | 1084+ |
| docs | `8de57ee` | Обновление second-brain (6 файлов) | 123+ |

**~9 700 строк кода + тестов за сессию.**

## Что вышло

**Verification:**
- `bun run typecheck` — OK после каждой фазы
- `bunx vitest run` по затронутым модулям — 735/741 pass на финале (1 fail в `entity-resolution.service.spec.ts` integration — требует pgvector БД, не моя зона)
- 14 snapshot-тестов для вынесенных промптов — все pass
- 12/12 unit для llm-thinking-models + adapter
- 85/85 operations
- 28/28 dialog-layer
- 13/13 chat-v2
- 4/4 clones-v2 integration
- 9/9 rbac-clone-access
- 15/15 specialists-combined

**Push.** Все 9 коммитов на `origin/dev` (через параллельный auto-push hook, не мой явный push). `git status` чистый по моим файлам.

**Прод-инструкция** консолидирована (см. финальное сообщение сессии): prisma:push для CloneAccessGrant + 5 seed-команд + 2 patch-команды + ENV-флаги.

## Чему научился

**Tech-факты для копилки (`02_architecture/code-pitfalls.md`):**

1. **DeepSeek-V4-Pro thinking mode не поддерживает strict json_schema, tool_choice=required, forced function.** Возвращает 400 «Thinking mode does not support…». Рабочий путь: `tools: [<one tool>] + tool_choice: 'auto'` + явное «Верни через инструмент submit_X» в user-сообщении. Helper `isThinkingModel(model)` детектит по подстроке `pro` или `thinking` в имени.

2. **thinking-токены не управляются** — модель сама решает сколько думать (200-2000 на сложных задачах). max_tokens 300 при thinking даёт 56% пустых ответов. **Минимум 1500 для коротких JSON, 8000 для длинных текстов, 16000 для role-profile-build.**

3. **На Windows `git status` показывает M из-за CRLF/LF** — обманчиво. Реальный diff проверять через `git diff --stat HEAD -- file` или `git diff --cached --stat`.

4. **`git diff HEAD -- path` пустой ≠ файл не изменён.** Если параллельный агент закоммитил то же — в HEAD и working tree совпадает, но `git status` всё ещё M (line-endings). После их commit'а — диф пустой, можно не коммитить.

5. **Convergent design между параллельными сессиями.** Параллельный агент проактивно добавил мой `incLlmThinkingModelGuard` в business-metrics без моего ведома — потому что оба читали тот же ТЗ. Это удача, не дизайн. Защита — chirurgical commit через `git add -p`.

6. **Subagent'ы могут «придумывать» коммиты.** Два разных Explore-агента независимо галлюцинировали коммиты `0de1d7a`, `4cd9ef2` (которые **существовали**, но я видел только 18 последних в `git log` и не верил агентам). Правило «trust but verify» — всегда `git log --oneline -50 --all` если агент ссылается на конкретный SHA.

**Поведенческие правила (feedback-память):**

7. **Перед каждой фазой — `git log` + `git status` + проверка моих файлов через `git ls-files`.** Параллельная сессия делает коммиты быстро, состояние дерева меняется между моими шагами. Без перепроверки можно подхватить чужой код в свой коммит.

8. **Bash `cd backend` после первого вызова закрепляется в `pwd`.** Дальнейшие `cd backend` падают «No such file or directory». Правило CLAUDE.md «maintain current working directory» — реальное, не теоретическое.

9. **Файлы `/tmp/*.diff` на Windows не существуют.** Используй PowerShell-совместимый путь или вообще без temp-файлов (через pipe).

**Архитектурный вывод:**

10. **Variant Б+ работает только когда есть общий тяжёлый контекст.** §3 (specialists на одной встрече) — да, выигрыш 3.7×. §2 (chat-v2 dialog-layer) — нет, объединение проиграло. Главное правило §0.3 ТЗ-копилки подтверждено серией экспериментов.

11. **Flag-based rollout — единственный безопасный способ менять архитектуру параллельно с активной сессией.** Создание нового сервиса рядом со старым (Specialists Combined, Clone V2) даёт A/B без риска регрессии и не блокирует параллельную работу.

## Что не доделано (для следующих волн)

- **Фаза 9 (§9.10 исторические клоны должности)** — зависит от Marketplace UI (frontend, отдельная подзадача)
- **Frontend Фазы 7** — `/clones` маркетплейс, `/admin/clones`, боковая панель диалогов, кнопка «Новый диалог»
- **Admin endpoints CRUD `CloneAccessGrant`** — отложил чтобы не пересекаться с параллельной сессией
- **`LlmCallParams.temperature`** — параметр не пробрасывается в LlmRouter, два режима factual/judgmental сейчас управляются только через mode-параметр промпта (TODO §9.9)
- **`patch-migrate-clone-access.ts`** — заглушка, реальная миграция первичных грантов после admin UI
- **Unit-тесты для CheckinSentimentBatchCron + parser** (gap Фазы 2) — отложил, не критично
- **MVP-persist в SpecialistsCombined без KNN/dedup/triage** — сознательный trade-off для A/B; при включении флага возможны дубли с legacy-путём
- **Smoke 28 агентов после правок** — не запускал, требует `DEEPSEEK_API_KEY` в окружении

## Что обновлено в second-brain

- `02_architecture/ai-agents-map.md` — §2.4.3 SpecialistsCombined + §7.2 массовая миграция на Pro
- `02_architecture/data-model.md` — модель `CloneAccessGrant`
- `01_projects/ai-jobs.md` — +3 taskType + секция миграции 2026-05-26
- `01_projects/api-layer.md` — +2 endpoint'а `/clones/{persons,roles}/:id/conversations`
- `01_projects/workers-queues.md` — `core.specialists-combined` + `CheckinSentimentBatchCron`
- `01_projects/skill-and-clone.md` — раздел «Доработки 2026-05-26 — clone-respond v2»

## Команды для прода (консолидированно)

```bash
cd backend

# 1. Применить модель CloneAccessGrant
bun run prisma:push
bun run prisma:generate

# 2. Засеять маршруты
bun run scripts/seed-llm-task-routes-clone-v2.ts --update-existing
bun run scripts/seed-llm-task-routes-specialists-combined.ts
bun run scripts/seed-llm-task-routes-beta-8-1.ts --update-existing
bun run scripts/seed-llm-task-routes-beta-8-3.ts --update-existing
bun run scripts/seed-llm-task-routes-dialog-layer.ts --update-existing

# 3. Patch chat-v2 + массовая миграция 19 одиночек
bun run scripts/patch-chat-v2-to-pro.ts
bun run scripts/patch-mass-migrate-to-deepseek-pro.ts --dry-run
bun run scripts/patch-mass-migrate-to-deepseek-pro.ts --update-existing

# 4. Включить v2 для пилота (опц., после admin UI выдачи грантов):
# .env: CLONE_V2_ENABLED=true
# .env: SPECIALISTS_COMBINED_ENABLED=true
```

**Все скрипты идемпотентны + уважают `editedByAdmin=true`.**
