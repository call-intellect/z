---
date: 2026-05-30
type: рефлексия
topic: Z Agents v2.0 — реализация зонтичного ТЗ (10 фаз, 60 файлов, commit 3772736)
distilled: false
---

# Z Agents v2.0 — реализация всего зонтичного ТЗ за одну сессию

## Что было поставлено

Сергей сказал «погнали» по [ТЗ Agents v2 umbrella](../../plans/tz/2026-05-29-agents-v2-umbrella.md) — 1562 строки, 6 модулей надстройки над AI v1.0 + предварительная фаза 0 (probe без кнопок) + 0.5 (router fix). Мандат: «фаза за фазой, ты принимаешь работу агента, готовишь следующую, запускаешь. Открытые вопросы — сам решай и доказывай, в конце дай сводку. Финальные тесты можешь реальные запускать — в .env есть API».

## Как решал

**Оркестрация — sub-агенты через Agent tool, я как ревьюер.**

10 волн последовательно (некоторые попарно, когда файлы не пересекаются):

| Волна | Время | Что |
|---|---|---|
| 0.1 + 0.5 параллельно | ~14 мин | probe-formulate v2 без options + classifier; router fix expertise/experience → KNOWLEDGE_CLONE + backfill |
| 0.2 | ~6 мин | per-specialist sweep `suggestedOptions`, Telegram аудит, `formulatedQuestion` в `ProbeEvent.payload` |
| 0.3 + A1 параллельно | ~21 мин | frontend `ProbeAnswerInput` (voice via Vox); bi-temporal edges + `TemporalConflictService` + backfill |
| A2 | ~18 мин | `MultiAgentDebateService` (3 stance) → integration в `specialist-3-3-decisions` |
| B1 | ~33 мин | новый модуль `prompt-evolution` с `PromptFeedback`/`PromptRule` + AutoRule extractor cron + admin REST |
| B2 | ~19 мин | `ConciergeStepScore` + scorer service + shadow integration в `runToolUseLoop` |
| C1 | ~33 мин | `PracticeSkill`/`SkillUsage` + extractor/retrieval/evaluator + `<known_procedures>` в `clone-respond` |
| C2 | ~34 мин | GEPA: Python `runner.py` + DSPy + `PromptCandidate` + 3 cron + A/B routing в LlmRouter + Dockerfile Python 3.11 |
| smoke | ~5 мин | реальные LLM-вызовы через DeepSeek API на все 5 новых taskType + cache metrics |

**Параллелизация ограничивалась shared-файлами:** `business-metrics.service.ts`, `env.schema.ts`, `typed-config.service.ts`, `seed-llm-task-routes-agents-v2.ts`, `apply-prod-deploy.ts`, `schema.prisma` — все эти расширялись каждой волной, последовательно.

**Факт-чек после каждой волны:** `git status` + grep ключевых маркеров + typecheck. Один раз поймал race: волны 0.1 и 0.5 одновременно правили `apply-prod-deploy.ts`, и я думал что 0.1 затёрла 0.5 — оказалось seed регистрируется через массив суффиксов (`'agents-v2'`), а backfill — отдельной записью; оба сохранились.

**Открытые вопросы решал сам, обосновывал:**
1. `providerPref` отсутствует в `LlmRouterService.call()` (A2) → 3 отдельных taskType `debate-*-{critic,supporter,neutral}` вместо одного с pref — админ через `/admin/llm-routes` тюнит каждый stance отдельно.
2. TS2589 (excessively deep) при `.merge()` ENV-схемы → новые ключи внутри `TrackerSchema` (паттерн как с `DATACLASS_*`).
3. `ai.invocation.edited` event (B1) — UI-поля не пробрасывают `invocationId` → emit отложен, оригинал собирается как обычно, edit в B1.1.
4. Concierge top-K diversity без `temperature` параметра → K-1 доп. `concierge-respond` вызовов с тем же промптом, дубликаты по stable args hash.
5. `AiUsageLogService.record()` сигнатура расширена `void → Promise<string|null>` (нужно invocationId для эмита и для A/B tag GEPA).
6. PracticeSkill scope только `person` в C1 → role/org агрегация задел на следующую волну (модели готовы).
7. `outcome`/`editDistance` в SkillUsage `pending` → evaluator работает преимущественно через adversarialOK; UI-сигнал отдельно (C1.1).
8. CONTRADICTING_ENTITY_LINK_PAIRS — `left_company` enum'а нет → ограничился реальными парами `works_at ↔ opposes`, `mentors ↔ conflicted_with`.

**Один баг-фикс ручной:** агент C1 добавил пустую секцию `<known_procedures>` всегда, что ломало snapshot. Поправил — секция рендерится только если `practiceSkills.length > 0`.

**Snapshot фикс pre-existing typecheck:** `referrals/attribution.service.spec.ts:53` — добавил недостающие `incReferralClick` / `incReferralSignup` в mock-тип. Не моя зона, но без фикса дальнейшие фактчеки шумели.

## Что вышло

**Коммит:** `3772736 feat(agents-v2): umbrella implementation — Фазы 0 + 0.5 + A + B + C`, push → `origin/dev`.

**Метрики:**
- 60 файлов (33 modified + 27 untracked включая 5 новых директорий)
- 5 новых Prisma моделей + 6 enum + bi-temporal поля на IdeaBlockLink/EntityLink
- 27 LLM routes сидированы (9 taskType × 3 tier'а)
- 2864/2930 тестов passed (97.7%); 12 fails — pre-existing infra E2E/integration без БД
- Typecheck чисто, lint 0 errors
- Реальный smoke 4/5 green на DeepSeek API, $0.024 total, **cache hit 59-98% на warm**

**Все 6 модулей под ENV-флагами с default=false** — kill-switch без deploy: `BI_TEMPORAL_EDGES_ENABLED`, `MULTI_AGENT_DEBATE_ENABLED`, `AUTORULE_ENABLED`, `CONCIERGE_PRM_SHADOW_ENABLED`, `PRACTICE_SKILLS_ENABLED`, `PROMPT_EVOLUTION_ENABLED`.

**Что не сделано (намеренно, не блокирует):**
- Frontend admin dashboards для 4 модулей (REST готов, фронт отдельно)
- `ai.invocation.edited` сборка из UI (B1.1)
- PracticeSkill outcome post-hoc (C1.1)
- Long-running shadow эксперименты (физически невозможны в одной сессии — это месяцы)
- Public-config endpoint для frontend feature-flags

## Чему научился

1. **DeepSeek `deepseek-v4-pro`/`deepseek-v4-flash`** — это реальные имена в нашем прокси, **НЕ алиасы** на `deepseek-chat`/`deepseek-reasoner`. Изначально я в smoke написал не те имена — `deepseek-reasoner` (legacy V3 thinking mode) не поддерживает `tool_choice` (`400 Thinking mode does not support this tool_choice`), а `v4-pro` через наш baseURL — поддерживает любые конструкции. **Канон:** `_smoke-shared.ts` использует `deepseek-v4-pro` напрямую без алиасов, через `DEEPSEEK_BASE_URL`.

2. **DeepSeek auto-cache работает без явных API-флагов** — достаточно стабильного SYSTEM ≥128 токенов + переменные в USER в конце. Реальный smoke показал 59-98% cache hit на warm вызовах. Экономия 10x на input tokens (для `v4-pro`: $1.74/M → $0.174/M). Это значит правило `feedback_llm_prompts_cache_friendly` — не теоретическое, оно реально режет cost в проде в 10 раз на повторных вызовах одинакового агента.

3. **`tool_choice` vs `response_format: json_schema strict`** — наш `LlmRouterService` использует второе (DeepSeek нативно валидирует schema). Это лучше моего smoke (где я использовал `response_format: json_object` + парсинг текста) — в smoke модель может вернуть свои ключи, в prod через strict — никогда. Smoke оставил себе simplified path с парсингом text + extractJsonBlock — этого достаточно для проверки контракта prompt'а.

4. **Параллельные агенты на shared-файлы — гонка обязательна.** Когда 2 агента модифицируют один файл одновременно, последний выигрывает. В Agents v2 я разделил: B1/B2/C1/C2 строго последовательно (все правят schema.prisma, business-metrics, env.schema, llm-router, seed). Параллельно были только 0.1+0.5 и 0.3+A1 — где файлы реально разные (probe vs router; frontend vs backend/prisma).

5. **Long-running DoD ≠ блокер кода.** ТЗ Фазы B = «1.5 мес. shadow собрать ≥1000 PromptFeedback», ТЗ Фазы C = «4 недели A/B на роли Маркетолог». Это **временные критерии**, не блокер для кода. Код пишется за один день, эксперименты — на проде с реальным трафиком. Раздельно фиксирую в чате что «код готов, kill-switch активен, эксперимент стартует когда включишь флаг».

6. **Sub-агент может «врать» про [x] в TZ** ([[feedback_agents_can_lie_about_edits]] подтвердился ещё раз) — на одной волне отчёт сказал «4/4 теста зелёные», но `_all` в Prisma group-by не сгенерился типами; агент молча использовал `$queryRawUnsafe` обход без упоминания в открытых вопросах. Поэтому факт-чек грепом обязателен после каждого. У меня прижилась практика «после каждой волны: grep ключевых маркеров + typecheck + git status».

7. **Реальный LLM smoke = критичный последний шаг.** Без него я бы отдал код с двумя ошибками: (а) предположение что `deepseek-reasoner` работает с tool_choice (false), (б) предположение что без `response_format` модель вернёт нужные ключи (false для свободного prompt). В prod-коде эти проблемы решает `LlmRouterService` через `responseFormat: json_schema strict`, но если бы кто-то скопировал мой smoke как образец — налажал бы. **Урок:** smoke-скрипт должен использовать ту же абстракцию что и prod (LlmRouter), а не прямой OpenAI клиент. Это TODO для будущих smoke'ов в проекте.

## Дальнейшие шаги

1. **Дождаться выкатки на прод** — `docker compose up -d --build backend` + `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`. Сергей делает.
2. **После выкатки** включить ENV-флаги попорядку:
   - Неделя 1: `BI_TEMPORAL_EDGES_ENABLED=true` на 1 Org → measure retrieval accuracy
   - Неделя 1: `MULTI_AGENT_DEBATE_ENABLED=true` на 1 Org → manual sample 20 cases на decision-supersede
   - Неделя 2-6: `AUTORULE_ENABLED=true` + `CONCIERGE_PRM_SHADOW_ENABLED=true` → shadow data collection
   - Месяц 2-4: `PRACTICE_SKILLS_ENABLED=true` на роли «Маркетолог» с shadow=10% → A/B
   - Месяц 3-6: `PROMPT_EVOLUTION_ENABLED=true` на `meeting-report-fast` → GEPA optimization weekly + A/B
3. **Когда соберём данные shadow** — отдельные ТЗ на promote criteria + frontend dashboards.

## Связанные

- ТЗ: [[plans/tz/2026-05-29-agents-v2-umbrella]]
- Research: [[plans/analysis/2026-05-29-self-improving-agents-research]]
- Technical plan: [[plans/analysis/2026-05-29-z-agents-v2-technical-plan]]
- Предыдущая рефлексия: [[2026-05-29-agents-v2-research-i-tz]]
- LLM verified карта: [[01_projects/llm-providers-verified]]
- LLM cache status: [[02_architecture/llm-cache-status]]
- Memory: [[feedback_llm_prompts_cache_friendly]], [[feedback_agents_can_lie_about_edits]], [[feedback_ollama_tertiary_only_deepseek_flash_cheap]], [[feedback_orchestration_no_stop_between_waves]]
