---
date: 2026-06-20
title: Провенанс «Откуда это» + умный модуль уточняющих вопросов (probe)
distilled: false
---

# Что было поставлено

Реализовать два ТЗ оркестрацией по фазам (скилл tz-orchestrator), коммит и push в dev:
1. `plans/tz/2026-06-20-provenance-source-traceability-tz.md` — провенанс/трассировка первоисточника (6 фаз Ф0–Ф5, contract-first). Поглощает `2026-06-11-probe-question-context-leak-fix`.
2. `plans/tz/2026-06-20-probe-smart-questions-module.md` — умные уточняющие вопросы probe (6 фаз Ф1–Ф6), зависит от provenance Ф0.2.

# Как решал

Оркестрация фазами: критичную/security-чувствительную часть (provenance Ф0/Ф1, probe Ф1) писал сам с тщательной картографией; объёмные/механические фазы (provenance Ф2/Ф4-Ф5 UI, probe Ф2-Ф6) — суб-агентами с точными контрактами, каждую приёмку проверял сам (typecheck/lint/build + специи + грепы + re-Read). 9 коммитов:

| Коммит | Фаза |
|---|---|
| fab510be | Provenance Ф0 — плеер `?t=`, probe payload blockId/quote, pending task_closure/task_review, Concierge snippet из evidence |
| 0beca91a | Provenance Ф1 — ProvenanceService (resolveByRawEventIds/buildDeepLink/resolve с deny-by-default фильтром), миграция previewQuote/previewSourceRef |
| cadf5549 | Provenance Ф2 — эндпоинт `/provenance/:type/:id`, обогащение `/blocks/:id`, ослабление `/raw-events/:id`, backfill |
| 1e35cea8 | Provenance Ф3 — domain ProvenanceRef + api + ленивый useProvenance |
| 1e5d3dbf | Provenance Ф4+Ф5 — компонент «Откуда это» + рендер + attribution/уверенность/degradation + крутилка порога |
| dc6a2377 | Probe Ф1 — стоп-кран дайджеста (humanize, +12 ключей FALLBACK, гард паритета) |
| 5ab54b3f | Probe Ф2+Ф3+Ф6 — ProbeFormulationService + промпт B + судья видит объект |
| ee3a3f3c | Probe Ф4+Ф5 — гейт ценности probe-value-gate + дайджест формулирует через сервис |
| 841ba213 | Синтетический харнесс промптов+логики (7 тестов) |

Ключевые инженерные решения:
- **Инвариант деагрегации** (главный риск provenance): `resolve()` маскирует у закрытого блока НЕ только `quote`, но и `source.label/refId/deepLink` — иначе название встречи-источника утекает зрителю без доступа. Тест «источник закрыт» с реальным `partitionProjectionsByAccess`.
- **DI-цикл tables↔knowledge-core**: KnowledgeCoreModule импортирует TablesModule, поэтому tables зовёт `buildProvenanceDeepLink` (чистая функция, без DI), а не инжектит ProvenanceService.
- **Probe value-gate fail-open**: сбой LLM → `{ask:true}` (нужное не глушим); флаг OFF → без LLM-вызова.

# Что вышло (верификация)

- `typecheck` (8 ГБ heap — дефолтный tsc упирался в 4 ГБ на этом проекте), `lint` (0 errors), `build` — зелёные backend и frontend.
- Probe-специи: 133 теста (18 файлов). Provenance: provenance.service.spec + access-resolver «источник закрыт» + pending-action домен. Tables 122. Синтетический харнесс 7.
- Миграция `20260620113751_provenance_preview_snapshot` применена локально (только ADD COLUMN nullable).

# Чему научился / грабли

- **tsc OOM на 4 ГБ**: на размере backend дефолтный `bun run typecheck` периодически падает heap-OOM; `NODE_OPTIONS=--max-old-space-size=8192 bunx tsc --noEmit` стабилен. (→ code-pitfalls кандидат.)
- **Скрипты, импортирующие `../src`, тянут eager-валидацию ConfigModule** — локальный прогон backfill требует полный `.env`; в проде через `docker compose exec` env полный.
- **Суб-агенты на Windows перегенерируют `.snap` line-endings (LF→CRLF) при vitest** — это churn без контента, чистить `git checkout -- __snapshots__/` перед коммитом.
- **`noUncheckedIndexedAccess`**: `nodes[0]` под strict → `possibly undefined`, в тестах `nodes[0]!`.

# Что НЕ сделано / ограничения (честно)

1. **chat-v2.loadContextBlocks НЕ отрефакторен** на ProvenanceService — оставлен как эталон последней мили, из которого извлечён сервис. Acceptance «≥2 из 3 дублей» выполнен на tables+regulations. Полная миграция chat-v2 — безопасный follow-up (его ContextBlock-форма богаче ProvenanceSourceRef).
2. **Живой LLM-бенч `probe-module-bench.ts` и Playwright/qa провенанса НЕ прогнаны** — песочница блокирует внешнюю сеть (api.deepseek.com и proxy.agent-lia.ru → 000). Промпты выкатываются по ship-and-observe (feedback_no_golden_ship_and_observe_prod); качество промптов B/C доказано бенчем РАНЕЕ при написании ТЗ (100% назвал объект, гейт 0 ложных пропусков). Логика+сборка промптов покрыты синтетическим харнессом.
3. **`provenancePreview` в domain/decision+issue = null** — backend list-DTO решений/задач не отдаёт previewQuote/previewSourceRef; поле объявлено для будущего, дровер грузит провенанс on-demand. vNext: прокинуть preview в list-эндпоинты.
4. **Эмиттер specialist-3-4 (card)** не получил чистый objectName — не указан в ТЗ ни как структурный, ни как размытый.
5. **backfill локально не прогнан** (неполный локальный .env) — типы и идемпотентность (`previewQuote IS NULL`) проверены, прогон на проде через apply-prod-deploy.
6. **Вторая волна провенанса** (deep-link к сообщению чата, якорь к странице документа, аудио free_note в S3, block-линк fast-задач RC-5, phone_call-адаптер, email-ingest баг) — в `04_не-сделано`.
