# Чек-лист инвариантов Z + «куда что писать»

Прогоняй перед выдачей ТЗ. Не дублируй текст правил в ТЗ — **ссылайся** на скилл/файл, но проверь, что фича их не нарушает. Источник правды о фактическом состоянии — `second-brain/`.

## Стек и рантайм
- [ ] Backend строго **Bun+Node+TS**. Нет нового Python в `backend/`. Найденный продакшен-Python → отдельным ТЗ на порт в TS (пример: `plans/tz/2026-06-02-gepa-port-to-node.md`). Исключения: `infra/*` HTTP-микросервисы, build-time Docker-deps, `.claude/`. Скилл: `core-engineering-standards`; память: `feedback_single_node_stack_no_python`.
- [ ] Команды проверки — через `bun` (`bun run typecheck/lint/build`, `bunx vitest`), никогда `npm`/`npx`.

## Prisma / БД → `prisma-db-push-rules`, `safe-seed-rules`
- [ ] Только `bun run prisma:push`, **никогда** `prisma migrate*`. После правки моделей — `prisma:generate`.
- [ ] HNSW/GIN-индексы — в `backend/scripts/postgres-init.sql` (Шаг 5 prod-deploy), не в schema.prisma.
- [ ] В скриптах `createPrismaClient()` из `scripts/_lib/prisma.ts`, **никогда** `new PrismaClient()`; импорты из `../src`, не `../dist`.
- [ ] seed/patch/backfill/migrate идемпотентны (повторный прогон = no-op) и зарегистрированы в `backend/scripts/apply-prod-deploy.ts` (`STEPS`, верная `phase`, `skipBootstrap` для update-only).

## ENV и крутилки → память `feedback_admin_settings_not_env_or_code`, `feedback_switchable_endpoints`
- [ ] ENV только через `TypedConfigService` / `env.schema.ts`. Нет `process.env.*` в коде.
- [ ] Прайсы/пороги/лимиты/флаги/retention → `AdminSetting` (super_admin, history+audit), не ENV и не хардкод. Константа в коде = code-fallback.
- [ ] Активные снимки (`Subscription.monthlyPriceKopecks` и т.п.) ретроактивно не пересчитывать.
- [ ] Switchable endpoints (TURN/S3/AI-провайдеры) — через ENV/настройку, не хардкод.

## LLM / AI → `z-ai-agent-rules`, память `feedback_llm_prompts_cache_friendly`, `project_z_infra_and_ai`
- [ ] Primary DeepSeek/OpenAI-proxy: дёшево — `deepseek-v4-flash`, capable — DeepSeek V4 Pro. Anthropic не используем. Embeddings только `text-embedding-3-small`. Ollama `qwen3.5:9b` — tertiary fallback.
- [ ] Раздел **«Совместимость с prompt caching»** в каждом ТЗ с LLM (стабильный SYSTEM, переменные в конце user) или явное «Не релевантно».
- [ ] Промпты admin-editable через registry + code-fallback; доставка patch-скриптом.
- [ ] Self-improving (клоны, обновление промптов) — автоматически (composite judge + A/B), без regular human-approve; human gate только kill-switch. Память: `feedback_no_human_in_loop_for_clone_learning`.
- [ ] **Не упоминать SPO/eval-систему**, пока владелец сам не произнёс (`feedback_spo_dont_mention`).

## Multi-tenancy и доступ
- [ ] `TenantGuard` тянет `tenantId` из `X-Org-Id`/`:orgId`; любой knowledge-запрос требует `tenantId`; `@@index([tenantId, …])`.
- [ ] RBAC через Casbin `policies/policy.csv`; super-admin не читает переписку. Один user = одна Org (`feedback_conversational_channels_principles`).

## Контракты back/front → `nestjs-rules`, `frontend-rules`
- [ ] Каждый эндпоинт — Zod-DTO (nestjs-zod) + Swagger + machine-readable коды ошибок.
- [ ] Фронт: `ApiDto→DomainModel→UiModel`, единый `api-client.ts`, SWR; route-группы `(public)/(authenticated)/(admin)`.
- [ ] knowledge-core: воркеры BullMQ (отдельный процесс `src/workers/main.ts`) + `@Cron`; новый `signalType` — только при реальной нужде.
- [ ] Единый источник правды для перечней фронт↔бэк (accept-форматы, enum).

## Риск и флаги
- [ ] Рискованное/внешне-наблюдаемое поведение — за feature-flag, дефолт OFF + kill-switch. Флаг «на всякий случай» не вводить.

## LiveKit / медиа → `domain-business-context`
- [ ] LiveKit только медиа; токены только на бэке; гость без секретов; аудио отдельными дорожками на участника.

## UI и копирайтинг → память `feedback_admin_ui_russian_only`, `feedback_paired_color_tokens`, `feedback_concierge_*`
- [ ] UI конечного пользователя — только русский, ни одного английского слова.
- [ ] Парные токены `bg-{color}`+`text-{color}-fg`; никогда `text-white` на цветном, без жёстких hex/slate.
- [ ] Concierge/AI-помощник — ответы только текстом (голос только на ВВОД); главный вход — плавающий значок, не Cmd+K.
- [ ] Probe/уточняющие диалоги фичи — без inline-кнопок, только текст/голос.

## Приоритеты сейчас
- [ ] Privacy/data-residency LLM — **deprioritized**, не поднимать (`feedback_privacy_deprioritized_now`).

## Куда писать (для секции DoD / prod-deploy)
| Что изменил | Куда (second-brain) | prod-deploy-log шаг |
|---|---|---|
| Новая колонка/таблица | `02_architecture/data-model.md` | Шаг 4 |
| Новый модуль/контроллер | `02_architecture/module-map.md` | — |
| Новый AI-агент/воркер/job | `01_projects/ai-jobs.md`, `workers-queues.md` | Шаг 12 (smoke) |
| Новый API-эндпоинт | `01_projects/api-layer.md` | Шаг 12 (Swagger smoke) |
| Новая admin-страница | `01_projects/admin.md` | — |
| postgres-init.sql (HNSW/GIN) | — | Шаг 5 |
| patch-/seed-/backfill-/migrate-/setup-*.ts | профильная `01_projects/` | Шаги 6/7/8/9/10 |
| Новая ENV в env.schema.ts | — | Шаг 1 |
| Новый feature-flag по умолчанию | — | Шаг 1 (kill-switch) |
