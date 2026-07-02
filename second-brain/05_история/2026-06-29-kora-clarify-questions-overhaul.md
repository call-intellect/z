---
date: 2026-06-29
feature: kora-clarify-questions-overhaul
branch: work/2026-06-29
---

# Пересмотр модуля уточняющих вопросов Коры (probe) — оркестрация 6 фаз

## Что было поставлено
ТЗ `plans/tz/2026-06-29-kora-clarify-questions-overhaul.md` (одобренная архитектура того же имени). Привести модуль уточняющих вопросов Коры к замыслу владельца: (1) снять probe-инспектор РЕШЕНИЙ; (2) снять probe-инспектор ОБЕЩАНИЙ (только вопросы, соц-слой не трогать); (3) адресат probe задачи = постановщик (автор реплики), а не первый owner Org; (4) вопрос про срок на извлечении + ежедневный свод; (5) новый агент «расскажи, как решал» при закрытии значимой задачи; (6) проверить мостики ответа. Роль — tz-orchestrator (код руками не пишу, веду суб-агентов + сам принимаю).

## Как решал
Картография всего surface по живому коду (Bash grep + Read — vexp free-capped по backend), затем 6 фаз строго последовательно (файлы пересекаются: `probe-reason-policy/labels`, `probe-response.handler`, `operations.module`, `specialist-3-15` — параллелить нельзя). Каждая фаза: самодостаточный промпт кодеру (general-purpose) → приёмка САМ по лестнице (git status → grep-маркеры → re-Read → typecheck/lint/build → тесты модуля целиком → acceptance построчно) → коммит явными путями.

| Фаза | Коммит | Суть |
|---|---|---|
| Ф1 | `750e0df5` | снос `specialist-3-3-probe.service.ts` + proactive `decision_no_owner` + поводы `decision.*` |
| Ф2 | `d9a6fbdf` | снос `commitment-followup.cron` + `specialist-3-9-promise-keeper` + `commitment-response.handler` + 3 флага |
| Ф3 | `910900fe` | `resolveSetterRecipient`: authorPersonId evidence → Person.userId (tenant-scoped), фолбэк owner |
| Ф4 | `67b5e8d3` | due-probe на извлечении (одно за раз) + `TaskClarifySweepCron` (свод) + 3 крутилки |
| Ф5 | `f01a4172` | `task.method_capture` + хук в `transitionState` + эвристика `computeMethodCaptureComplexity` + 3 крутилки; снят узкий probe в `completeTask` |
| Ф6 | `d19f6126` | `signalTypeHint:'reasoning'` для `task.method_capture` + тесты мостика |
| hardening | `c10095ae` | strict-review: хук Ф5 покрыл и `update()`-путь (PATCH stateId минует transitionState) — Р7 «любой путь» |
| docs | `e466f83f` | каталог наблюдателей + feature-flags + prod-deploy-log |

## Что вышло (верификация)
- Финальный интегрированный прогон: `bun run build` EXIT 0; vitest по всем затронутым модулям — **1480 passed** (probe/proactive/knowledge-core/tracker/operations); после hardening tracker 547/547.
- Strict-review всего диффа (adversarial суб-агент): критичных/HIGH багов нет; tenant-изоляция чистая, эвристика без NaN, best-effort на месте, удаления чистые (соц-слой обещаний цел — 88 ссылок), старые `decision.*`/`commitment.*` probe_events читаются через фолбэк-метки.
- Ручной фактчек: приёмка не верила отчётам кодеров — в Ф1 моя расширенная прогонка поймала 2 «забытых» спека (`probe-dispatcher-recheck`, `probe-service-queued-digest`), которые кодер не гонял; починил миграцией фикстур.

## Чему научился
1. **REALITY-CHECK ТЗ может ошибаться в деталях путей.** ТЗ утверждал «обновление/перетаскивание делегирует в `transitionState`» — на деле прямой `issues.update()` (PATCH stateId) ставит `completedAt` САМ, минуя `transitionState`. Strict-review это вскрыл; без него Ф5 имела бы тихую дыру (Р7 «любой путь» не закрыт). **Урок: к утверждениям ТЗ про «все пути делегируют сюда» относиться как к гипотезе — проверять второй путь.**
2. **Мостик ответа на probe (`ingestResponseAsRawEvent`) уже универсален** — срабатывает на ЛЮБОЙ ответ, reason-агностично, создаёт `RawEvent(kind='notification_response')` (НЕ `free_note`, как писал ТЗ), идемпотентен по `sourceExternalId='resp:<notificationId>'`. Ф6 свелась к 1-строчному обогащению + тесту.
3. **«1 напоминание» — бесплатно**: `probe-priority.cron` делает ровно один re-ask (`reaskCount < 1`) для любого истекающего probe. Спец-механизм не нужен.
4. **DI-локация cron'ов knowledge-core — `WorkersModule` (`ai/workers.module.ts`), не `KnowledgeCoreModule`** (там нет `Specialist315TasksService` среди providers). Кодер Ф4 это корректно вскрыл по build-фейлу.
5. **Последовательность по пересечению файлов важнее «волн».** Граф зависимостей ТЗ предлагал параллельные волны, но реальное пересечение файлов (реестры probe, operations.module) делало параллель опасной в общем дереве — шёл строго 1→6.

## Отложено (осознанно)
- Свод `runClarifySweep` без общего бюджета на проход (N+1 при росте числа Org) — строка в `04_не-сделано` (на пилоте ~1 Org безвреден; per-org cap 200 + раз в сутки).
