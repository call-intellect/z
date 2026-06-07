---
date: 2026-06-07
type: рефлексия
tz:
  - plans/tz/2026-06-06-frontend-stability-chunk-and-video.md
  - plans/tz/2026-06-06-recording-pipeline-reliability-reconcile.md
  - plans/tz/2026-06-06-meeting-tasks-quality-dedup-asr.md
  - plans/tz/2026-06-06-graph-arbiter-json-resilience.md
  - plans/tz/2026-06-06-meeting-report-copy-download-actions.md
  - plans/tz/2026-06-06-agent-quality-golden-harness.md
branch: feature/prod-stability-2026-06-06
---

# Стабилизация прода: 6 ТЗ одной волной (оркестрация)

## Что было поставлено
Реализовать 6 готовых ТЗ из брифа `2026-06-06-handoff-brief-all-prod-fixes.md` в порядке
ТЗ-1 → ТЗ-2 (🔴 ломают продукт) → ТЗ-4 → ТЗ-3 (🟠) → ТЗ-5 → ТЗ-6 (🟡), довести до зелёного и запушить.
Роль — оркестратор (`tz-orchestrator`): код руками не писал, вёл фазами через суб-агентов с независимой приёмкой.

## Как решал
16 фазовых коммитов. Каждая фаза: картография (Explore, верификация path:line) → самодостаточный промпт кодеру
(general-purpose) с дословными сниппетами → **моя** приёмка (греп маркеров + re-Read + typecheck/lint/build/тесты сам,
агентам не верил) → коммит явными путями → следующая фаза. Параллелил независимые по файлам фазы.

**Ключевые технические развилки (решал сам, не сваливал владельцу):**
- **ack-first (ТЗ-2 Ф3)** — под флаг `LIVEKIT_WEBHOOK_ACK_FIRST_ENABLED` **default OFF**: фоновый `eventsHandler.handle`
  для `room_finished` не имеет крон-восстановления (крон ловит только composite/track) → потеря на рестарте застрянет
  встречу в `active`, а дедуп уже записан. Корневой фикс паузы — крон (default ON), ack-first вторичен.
- **forced tool_choice (ТЗ-3 Ф3)** — под флаг `LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED` **default OFF**: внешне-наблюдаемое
  поведение LLM-API + ТЗ требует прод-пробу agent-lia (нет прод-доступа в сессии). Guard сам откатит на 'auto' при
  format-400. `strict:true` не добавлял (та же проба). Корень потери связей закрыт Ф1+Ф2 (устойчивость + validate→secondary).
- **ASR-нота и org-контекст (ТЗ-4 Ф2/Ф3)** — централизованно в `analyze.worker` (точки сборки финального system),
  а не в N `type-*.ts` билдеров: меньше churn, покрывает и DB-редактируемые промпты, снапшоты билдеров не ломаются.
- **ТЗ-4 Ф4 (capable pro-модель)** — owner cost-decision: патч-скрипт создан, НЕ в `apply-prod-deploy` STEPS,
  не активирован (route admin-editable, владелец флипает и мерит).

## Что вышло (верификация)
- **Backend:** lint 0 errors, build OK, **1219 тестов passed / 0 failed** (173 файла, по всем затронутым модулям).
- **Frontend:** typecheck/lint чисто, **webpack-build OK**, **308 тестов passed**.
- Новые ENV (3, все безопасные дефолты), новый крон, новые метрики, удалена `@vidstack/react`. Схема БД не менялась.
- Остаток (owner-gated) честно вынесен в реестр `04_не-сделано`: прод-верификации (ТЗ-2/3/6), strict/force-проба, pro-модель, NUL-байт.

## Чему научился (грабли — продублированы в code-pitfalls.md)
1. **Turbopack в prod-сборке Next 16** даёт `ChunkLoadError` при HTTP 200 (рассинхрон манифеста чанков) + Vidstack
   web-компонент не инициализируется → `next build --webpack` + нативный `<video>`. Эмпирически доказано тестом на проде.
2. **Удаление зависимости из frontend `package.json` требует `bun install`** для синхронизации `bun.lock` — Dockerfile
   использует `--frozen-lockfile`, иначе прод-сборка упадёт на mismatch. Проверил `bun install --frozen-lockfile` = «no changes».
3. **`Recording` не имеет `updatedAt`/`createdAt`** — для «возраста записи» в кроне использовал `Meeting.endedAt`
   (всегда выставляется при `room_finished`; есть индекс `[status, endedAt]`).
4. **Router считал «битый JSON = успех»** (HTTP 200, непустой text) и не пробовал secondary → validate-callback бьёт корень
   класса «структурный вызов вправе не вернуть структуру, а мы это глотаем».
5. **`tsc`-build НЕ проверяет рантайм-DI.** DI новых провайдеров доказал транзитивно: handler уже резолвит
   `RecordingsService`/`MeetingsService` в WebhooksModule (а `RecordingsModule`/`AiModule` помечены `@Global()`) → новые
   провайдеры того же инжектора с теми же токенами зарезолвятся. Финальное доказательство — прод-bootstrap.
6. **Обратные кавычки в `git commit -m` ломают bash** (подстановка команды) — один коммит упал на ```` ``` ````. Впредь
   без тройных кавычек в сообщениях коммитов через Bash.
7. Суб-агенты дважды поймали и честно описали находки вне диффа (pre-existing NUL-байт, shared-ref баг в собственном тесте) —
   фактчек грепом + re-Read окупился, отчётам «всё зелёное» нельзя верить без своей лестницы проверки.
