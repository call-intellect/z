# Orchestrator-prompt: ChatBox-интеграция

Реализуй ТЗ `plans/tz/2026-06-05-chatbox-integration.md` как `tz-orchestrator` — фаза за фазой, силами суб-агентов, в отдельном git worktree, строго последовательно по графу зависимостей.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (vexp-first, версионируемые миграции с 2026-06-05, prod-deploy-агрегатор, рефлексия по триггеру).
2. `second-brain/index.md`, затем `02_architecture/module-map.md`, `02_architecture/data-model.md`, `01_projects/ai-jobs.md`, `01_projects/workers-queues.md`.
3. ТЗ целиком + факты API `plans/analysis/2026-06-05-chatbox-integration-api-facts.md`.
4. Код-якоря (перечитать, номера строк дрейфуют): `backend/src/modules/sources/{sources.controller.ts,sources.service.ts,dto/source.dto.ts}` (образец модуля+шифрование), `backend/src/modules/ingest/ingest.service.ts:81` (контракт ingest), `backend/prisma/schema.prisma` (`model Source`~2885, `model RawEvent`~2905, `enum SourceType`~225, `model Org`~2192, `model AdminSetting`~8946), `backend/src/modules/conversational/adapters/max-bot/max-webhooks.controller.ts` (webhook-паттерн), `frontend/src/ui/components/app-shell/Sidebar.tsx` (nav), `backend/scripts/apply-prod-deploy.ts` (STEPS), `backend/src/common/config/env.schema.ts:393` (`PUBLIC_HOST_URL`).

## Инструменты
- Контекст нашего кода — **vexp `run_pipeline`**, не grep/glob. `get_skeleton` вместо Read для осмотра.
- Внешние либы (Prisma 7, NestJS, BullMQ, Zod, SWR) — Context7.
- ChatBox API живой, токен в файле фактов — можно докидывать smoke-запросы для приёмки Фаз 2/3/6.

## Граф фаз (волны)
Ф1 → Ф2 → Ф3 → (Ф4 ∥ Ф5 ∥ Ф6 — одна волна) → Ф7 → Ф9 → Ф8 → Ф10.
(Ф8 после Ф9, т.к. деталька чата показывает связку менеджера.)

## Факт-чек (не верь отчёту суб-агента)
После каждой фазы — независимая приёмка: re-Read изменённых файлов, grep маркеров из Acceptance, свой `bun run typecheck && bun run lint && bun run build`, `bunx vitest run <новые spec>`. Для Ф2/Ф3/Ф6 — реальный smoke к ChatBox API на воркспейсе `246c3062-807b-4367-a376-1d34a4ddc435`. «Фаза закрыта» = все предикаты Acceptance прошли у тебя, не у кодера.

## Инварианты (критично — отклонения вернуть владельцу)
- Версионируемые миграции (`prisma:migrate`/`migrate deploy`), не `db push`. `prisma:generate` после правок схемы.
- В скриптах `createPrismaClient()` из `scripts/_lib/prisma.ts`, импорты из `../src`. Регистрация скриптов в `apply-prod-deploy.ts` STEPS (идемпотентно).
- ENV только через `TypedConfigService`; пороги — `AdminSetting`, не хардкод.
- Токен — AES-GCM (`CryptoService`), никогда не в ответе/логе. dataClass переписки = `sensitive`. super_admin не читает текст переписки.
- LLM: DeepSeek/OpenAI-proxy, не Anthropic; раздел prompt-caching для summary.
- UI только русский; парные токены `bg-*/text-*-fg`.
- Коммит по фазам (Conventional Commits); push — только по явному подтверждению владельца. Рефлексия + prod-deploy-log + second-brain по триггеру после push.

## Failure-modes
- ChatBox rate-limit/таймаут → backoff в клиенте, не падать синком.
- Объём (воркспейсы с тысячами чатов) → инкрементально по `updatedAt`, не тянуть всё разом.
- Новый `channelType` → String + fallback «Другое», без миграции.

Заметки для владельца (НЕ копировать): крупных развилок в ТЗ не осталось — 4 решения зафиксированы. Перед стартом убедись, что `PUBLIC_HOST_URL` в проде указывает на публичный backend (нужно для регистрации вебхука).
