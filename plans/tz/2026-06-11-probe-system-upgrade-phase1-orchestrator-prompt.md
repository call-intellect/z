# Orchestrator-prompt — Probe-система Фаза 1

Запусти `tz-orchestrator` по ТЗ `plans/tz/2026-06-11-probe-system-upgrade-phase1.md`. Ниже — только навигация и факт-чек; тело контракта НЕ дублирую (риск рассинхрона) — читай ТЗ.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (стек, Ship-On, Prisma-миграции, AdminSetting-крутилки).
2. `plans/tz/2026-06-11-probe-system-upgrade-phase1.md` — ТЗ целиком, особенно **REALITY-CHECK** (что уже сделано §3 Ф1/Ф2 — НЕ переделывать) и **Принятые решения Б1–Б8**.
3. `plans/analysis/2026-06-11-proactive-clarifying-questions-probe-research.md` §9-B (дословный текст промпта для Ф1), §10 (доказательства порядка фаз).
4. Код-якоря (перечитать — номера строк дрейфуют, искать по символу): `probe-formulate.prompt.ts`, `probe/probe.service.ts` (`suggest`, `filterByRateLimit`), `probe/probe-dispatcher.worker.ts` (`formulate`, `humanizeProbeFallback`, `process`), `probe/probe-response.handler.ts`, `probe/probe-priority.cron.ts`, `probe/probe-recipient.util.ts` (§G1 — НЕ менять), `operations/services/daily-digest.service.ts` (образец дайджеста §G4), `conversational/types/event-payload.registry.ts` (:381 регистрация), `common/config/typed-config.service.ts` (`getDynamic` :2568), `admin/settings/admin-setting-schema-registry.ts`, `prisma/schema.prisma` (`model ProbeEvent`/`enum ProbeStatus` :6413).

## Инструменты
- vexp `run_pipeline` если демон живой; иначе обычные Read/Grep (в этой среде vexp был недоступен — хук НЕ блокировал grep).
- Context7 — не нужен (внешних новых либ нет; всё на нашем стеке BullMQ/Prisma/Zod/Nest).
- **`git fetch` + `git log --since="1 day"` ОБЯЗАТЕЛЬНО** перед началом: ветка `feature/meeting-cabinet-fixes` активна (параллельная сессия). Реализацию вести в отдельном worktree; не трогать файлы вне списка ТЗ.

## Граф фаз (волны)
- **W1:** Ф1 (промпт §9-B + reasonLabel + schema v3 + per-reason fallback) — независима, делать первой (дёшево, эффект сразу).
- **W2:** Ф2 (reason→window/recheck маппинг) — предшествует Ф3 и Ф4.
- **W3 (после Ф2, параллельно):** Ф3 (батч-дайджест), Ф4 (recheck повода), Ф5 (adaptive fatigue), Ф6 (видимое следствие).

Ф5 и Ф6 формально независимы от Ф2 — можно стартовать в W2, но коммитить волной W3 для связности.

## Факт-чек (НЕ верь отчёту суб-агента — `feedback_agents_can_lie_about_edits`)
После каждой фазы — сам греп ключевых маркеров + re-Read + свой `typecheck`/`build`:
- Ф1: `grep "Источник: специалист\|Причина:" probe-formulate.prompt.ts` → **0**; `grep "probe_formulate_v3"` → есть; fallback не вызывает `humanizeProbeFallback` как источник вопроса.
- Ф2: `probeWindow('decision.overdue')==='immediate'`, дефолт `deferrable`.
- Ф3: миграция `*_probe_status_digest` создана, `ProbeStatus` += `queued_digest`/`suppressed_stale`; `probe.digest` зарегистрирован в event-registry; cron-идемпотентность (повтор = no-op).
- Ф4: `grep "suppressed_stale"` в dispatcher; best-effort (ошибка предиката → probe всё равно ушёл).
- Ф5: `probe_outcome_total{answered|ignored}`, topic cooldown по `contentHash`.
- Ф6: `probe.answer_acknowledged` зарегистрирован; текст русский без кодов; ошибка ack не валит closing-loop.

## Определение «фаза закрыта»
Все Acceptance-предикаты фазы зелёные (греп/тест/typecheck/build) + строка `Закрывает: Rn` трассируется + «Что НЕ входит» соблюдено. Коммит по фазе: `feat(probe): Фаза 1 §N — <что>`. Push — только по явному подтверждению владельца.

## Failure-modes
- Промпт §9-B на дешёвой модели даёт мусор → проверить маршрут `probe-formulate` (capable, не Ollama); §9-A code-fallback на месте.
- immediate-probe утёк в дайджест → проверить `probeWindow` + `priorityHint>=0.7` минуют queued_digest.
- Дайджест дублирует отправку → только `queued_digest`, атомарный `updateMany`→`dispatched`.
- Cross-tenant в дайджесте → каждый запрос с `tenantId`.

## Прод после реализации
Сформировать блок «📋 Prod-инструкция» (`feedback_prod_deploy_log_single_source`): миграция enum (Шаг 4, авто через `migrate deploy`), новые AdminSetting-ключи (Шаг 1, code-default есть), smoke нового cron/eventType (Шаг 12). Полная инструкция — `docs/operations/prod-deploy-log.md`.
