# Orchestrator-prompt: llm-providers-models-routing-admin

Ты — оркестратор реализации ТЗ `plans/tz/2026-07-02-llm-providers-models-routing-admin.md` (скилл `tz-orchestrator`). Веди фазы Ф1→Ф10 силами суб-агентов, строго по графу зависимостей из ТЗ.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (vexp обязателен, Grep/Glob заблокированы хуком при живом демоне).
2. ТЗ целиком — единственный контракт; решения Б1–Б12 не пересматривать.
3. Код-якоря ТЗ: перед правкой каждого файла перечитать актуальные строки (номера дрейфуют) — искать по символам (`dispatch`, `PROVIDER_CAPABILITY`, `buildFromEnv`, `present`, `ALL_LLM_TASK_TYPES`).
4. Референс-паттерн: `backend/src/modules/admin/economics/admin-embedding-providers.*` + `frontend/app/(admin)/admin/ai/embeddings/EmbeddingProvidersClient.tsx`.

## Инструменты
- Картография — `mcp__vexp__run_pipeline` / `get_skeleton`; fallback при мёртвом демоне — Bash grep + Read.
- Внешние API (OpenAI SDK, Anthropic SDK, Prisma 7, Zod) — Context7, не память.
- Прогоны: backend typecheck ТОЛЬКО с `NODE_OPTIONS=--max-old-space-size=8192` (иначе OOM = ложный «0 ошибок», exit 134); после правок schema.prisma — `bun run prisma:generate`.

## Граф фаз
Ф1→Ф2→Ф3→Ф4; Ф5 после Ф2; Ф6 после Ф4; Ф7 после Ф5; Ф8 после Ф6; Ф9 после Ф3 (параллельна Ф6–Ф8); Ф10 последняя. Одна волна = одна фаза (или пара параллельных с непересекающимися файлами: {Ф5,Ф6-бэк}, {Ф7,Ф8-фронт} — следить за конфликтами в `admin-llm-providers.*` и `llm-router.service.ts`).

## Факт-чек (не верь отчёту суб-агента)
После каждой фазы сам: (1) грепни Acceptance-маркеры фазы из ТЗ; (2) прогони `bun run typecheck && bun run lint` затронутого пакета + `bunx vitest run <новые spec>`; (3) для Ф2 — проверь двойной прогон патча; (4) для Ф4 — parity-spec зелёный на всех 7 провайдерах; (5) для Ф7/Ф8 — `bun run build` frontend + грепы «0 совпадений» из Acceptance.

## Failure-modes (специфика этого ТЗ)
- Суб-агент «оптимизирует» и удаляет legacy-switch — ЗАПРЕЩЕНО (kill-switch путь, 🚫 в ТЗ).
- Суб-агент собирает proxy-URL внутри адаптера — формула живёт ТОЛЬКО в `ProviderInfoResolver`.
- Ключ в ответе/логе/`lastSmokeError` — блокер, откатывать фазу.
- Правка `EmbeddingProvider`-контура или `LlmFallbackService` — вне scope, стоп и вопрос владельцу.
- tsc OOM: exit 134 без `error TS` = НЕ зелёный прогон.
- `new PrismaClient()` в скриптах — заменять на `createPrismaClient()` из `scripts/_lib/prisma.ts`.

## Определение «фаза закрыта»
Acceptance фазы выполнен машинно (грепы/тесты/команды), `Закрывает: R…` сверено с текстом требования, чекбокс `[ ]`→`[x]` в ТЗ, коммит `тип(область): описание` (Conventional Commits, только свои файлы, без `git add .`). Push — только по явному подтверждению владельца. Ревью-гейт перед финальным push: скилл `strict-production-review-gate` по списку «Риски» ТЗ.
