---
date: 2026-05-29
type: рефлексия
topic: Z Agents v2.0 — research + ТЗ
distilled: false
---

# Z Agents v2.0 — research, технический разбор, зонтичное ТЗ

## Что было поставлено

Сергей увидел скриншот Hermes Agent (Nous Research) с описанием «self-improving agent + persistent memory + skills + gateway» и попросил разобраться: можно ли применить этот класс систем к двум кейсам Z — постоянно работающим агентам (AI-отчёты по встречам) и клонам сотрудников.

По ходу разговора задача эволюционировала:
1. Deep research state-of-the-art по самосовершенствующимся агентам
2. Adversarial review собственных рекомендаций («докажи, что это лучшее»)
3. Объяснение архитектуры клона на простом языке («без аббревиатур»)
4. Технический разбор текущего состояния Z (v1.0) + конкретные технические улучшения с доказательной базой
5. Полное зонтичное ТЗ на v2.0
6. Включить два дополнительных вопроса из другого чата (Router fix expertise + backfill)

## Как решал

**Research:**
- Запустил `Workflow({ name: "deep-research" })` — упал на verify-фазе из-за бага StructuredOutput у subagents (33 verify failed)
- Fallback вручную через WebFetch первоисточников: `github.com/NousResearch/hermes-agent` README + `hermes-agent-self-evolution` + arxiv (Voyager 2305.16291, AutoRule 2506.15651, Reflexion 2303.11366, MemGPT 2310.08560, Generative Agents 2304.03442, MIPRO 2406.11695, BehaviorChain 2502.14642)
- Adversarial review через 6 параллельных WebSearch — обнаружил критичное обновление: **GEPA (ICLR 2026 Oral)** обогнал MIPROv2 на 13%, а Hermes уже использует GEPA, а не MIPRO. Я начал с устаревшего optimizer'а.
- Дочитал GEPA paper + github.com/gepa-ai/gepa + Graphiti (Neo4j blog) + ALITA + SkillWeaver + AgentPRM/MASPRM/PRIME

**Разбор v1.0:**
- Прочитал ключевые second-brain файлы: `knowledge-clone.md`, `skill-and-clone.md`, `skill-trait-concepts.md`, `ai-jobs.md`, `ai-agents-map.md`, `knowledge-core.md`
- **Главное открытие:** Z уже имплементирует 17+ SOTA-паттернов БЕЗ формальных названий из paper'ов:
  - `SkillTraitConcept` (union-find ≥0.92 + embeddings + variants) = A-MEM Zettelkasten (NeurIPS 2025)
  - `reframing.cron` (03:00 daily) = Reflexion-style ночное переосмысление
  - `ExecutablePersona` (versioned snapshots) = Voyager skill library snapshots
  - `executable-persona-trigger-watcher` (каждые 2ч, 3 триггера) = Hermes curator pattern
  - Anti-fakery ≥2 reasoning blocks + cosine ≥0.70 = Constitutional AI guard
  - `pinnedVersionNote` + snapshot-tests = production-grade governance
- Это означало: задача не «строить с нуля», а «найти 6 конкретных gap'ов поверх».

**Объяснение на простом языке:**
- Использовал живые примеры (Roomstead, маркетолог Маша, фраза «возражение на цену → шаги 1-2-3-4-5») вместо терминов
- Структурировал клона как 5 слоёв (профиль / эпизоды / навыки / факты / активный контекст) — Сергей это принял, потом уточнил три развилки

**Feedback по ходу разговора (зафиксировал в memory):**
1. Никакого human approval gate в regular flow → `feedback_no_human_in_loop_for_clone_learning.md`
2. Probe и системные диалоги — без inline-кнопок, только свободный ввод текстом/голосом → `feedback_probe_no_buttons_text_voice_only.md`
3. Ollama qwen3.5:9b только tertiary fallback; DeepSeek V4 Flash для дешёвых задач → `feedback_ollama_tertiary_only_deepseek_flash_cheap.md`

**Финальное ТЗ:**
- Зонтичное на 5 фаз × 6 модулей, каждый под ENV-флагом
- Включён фикс из другого чата: Router fix для expertise/experience/competence → одновременно 3-7 И 3-2, + idempotent backfill скрипт
- Подтверждено через прямое чтение `router.service.ts:293-302` — фикс точечный, безопасный

## Что вышло

**Документы (committed b669d90, push на `fix/audit-2026-05-29`):**
- [`plans/analysis/2026-05-29-self-improving-agents-research.md`](../../plans/analysis/2026-05-29-self-improving-agents-research.md) — research + adversarial review (~900 строк)
- [`plans/analysis/2026-05-29-z-agents-v2-technical-plan.md`](../../plans/analysis/2026-05-29-z-agents-v2-technical-plan.md) — технический план v2.0 (~700 строк)
- [`plans/tz/2026-05-29-agents-v2-umbrella.md`](../../plans/tz/2026-05-29-agents-v2-umbrella.md) — зонтичное ТЗ (~1900 строк)

**Memory:**
- 3 новых feedback файла (анти-human-gate, без кнопок, ollama-tertiary-only)
- 3 строки в `MEMORY.md`

**Не реализовано в коде:** ничего — ТЗ к разработке, прод-операций не требует.

## Чему научился

1. **Workflow с schema-агентами иногда падает на verify-фазе** (StructuredOutput глюк). Fallback через WebFetch + WebSearch работает быстрее, чем повторный workflow. Не зацикливаться, переключаться.

2. **Adversarial review своих рекомендаций — обязательная стадия.** Я рекомендовал MIPROv2 как оптимизатор, при перепроверке нашёл GEPA (ICLR 2026 Oral), который +13% над MIPROv2, 35× cheaper rollouts, и Hermes уже использует именно GEPA. Без adversarial круга я бы поставил ТЗ на устаревший стек. Правило: после первой рекомендации делать adversarial проверку «что меня может опровергнуть».

3. **Z v1.0 — уже мощная.** Имплементирует 17+ SOTA-паттернов без формальных названий. Перед любым предложением «давайте добавим X» — проверить, нет ли уже эквивалентного механизма с другим именем. `SkillTraitConcept` ≈ A-MEM (NeurIPS 2025), `reframing.cron` ≈ Reflexion, и т.д.

4. **Сложная задача → простой язык работает через живые примеры.** Сергей попросил объяснить «по-человечески» — структура «вместо `bi-temporal edges` → "память помнит, когда факт был правдой"» дала результат. Никаких аббревиатур, всё через истории (Roomstead, маркетолог, фраза «возражение на цену → 1-2-3-4-5»).

5. **Feedback накапливается в memory сразу, не «потом».** Сергей дал три принципа по ходу разговора (human-gate, кнопки, ollama) — фиксировал каждый сразу, обновлял MEMORY.md. В финальное ТЗ они уже зашиты как ограничения. Если бы откладывал на «конец сессии», часть могла бы пропасть.

6. **Z router отстал от воркеров.** Воркер 3-2 (knowledge-clone) умеет принимать блоки с любым signalType (он триггерит ребилд по Person.id, а ребилд читает все блоки за 12 мес). Но router в строках 293-302 отправляет expertise/experience/competence ТОЛЬКО в 3-7. Это упущение, не дизайн-баг. Перепроверка через прямое чтение кода — обязательна.

7. **Backfill через существующий debounce — бесплатная гарантия идемпотентности.** Скрипт может звать `enqueueRebuildKnowledgeProfile` сколько угодно раз — `jobId='rebuild-knowledge-profile_<personId>'` гарантирует один реальный ребилд. CLI флаги `--dry-run`, `--tenant`, `--since`, `--limit` — стандарт.

8. **Многократное уточнение задачи Сергеем — это норма.** Запрос эволюционировал: research → adversarial → простой язык → технический разбор → ТЗ → расширить ТЗ. Каждый шаг — продуктивный, не «передумал». Это паттерн его работы. Не пытаться угадать всё с первого раза, отвечать точно на текущий запрос.

## Связанные документы

- [`plans/analysis/2026-05-29-self-improving-agents-research.md`](../../plans/analysis/2026-05-29-self-improving-agents-research.md)
- [`plans/analysis/2026-05-29-z-agents-v2-technical-plan.md`](../../plans/analysis/2026-05-29-z-agents-v2-technical-plan.md)
- [`plans/tz/2026-05-29-agents-v2-umbrella.md`](../../plans/tz/2026-05-29-agents-v2-umbrella.md)
- `~/.claude/projects/c--work-z/memory/feedback_no_human_in_loop_for_clone_learning.md`
- `~/.claude/projects/c--work-z/memory/feedback_probe_no_buttons_text_voice_only.md`
- `~/.claude/projects/c--work-z/memory/feedback_ollama_tertiary_only_deepseek_flash_cheap.md`
- Commit `b669d90` на ветке `fix/audit-2026-05-29`
