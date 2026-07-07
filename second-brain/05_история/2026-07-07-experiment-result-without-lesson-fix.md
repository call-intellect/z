---
date: 2026-07-07
tags: [эксперимент, proactive-watcher, баг-фикс, уведомления]
distilled: false
---

# Баг-фикс: эксперимент «результат без урока» больше не застревает в running

## Что было поставлено
После реализации «эксперимент→задача» владелец спросил про упомянутый в границах баг «эксперимент застревает в running» и сказал чинить. Чип (FE-рендер связи задача↔эксперимент) — пометить в реестре не-сделанного, не делать.

## Как решал
- Подтвердил баг по коду: резолвер `experiment-status-resolver.cron.ts` (`computeTargetStatus`) завершает эксперимент только при `hasResult && lessonsLen>0` (это КОРРЕКТНО — не трогал), а сторож `proactive-watcher.service.ts` правило `experiment_running_too_long` ищет `currentResult: null` → эксперимент С результатом, но без урока невидим обоим → навсегда `running`.
- Фикс: новое правило-близнец `experiment_result_without_lesson` (`proactive-watcher.service.ts`) — `status=running AND currentResult != null AND startedAt < now-14d`, фильтр `lessonsLen===0` в JS, уведомление админу со ссылкой `/experiments/<id>`. Решение владельца: только уведомить, НЕ авто-завершать (авто-закрытие без урока теряет знание компании).
- Флаг-рубильник `PROACTIVE_RULE_EXPERIMENT_RESULT_WITHOUT_LESSON_ENABLED` (env.schema + typed-config + feature-flags.md), Ship-On дефолт ВКЛ — зеркало 7 соседних proactive-правил.
- Чип — строка в `04_не-сделано/README.md` (FE-рендер, vNext).

## Что вышло
typecheck 0, build зелёный, proactive-спека 8 тестов passed (3 новых кейса: позитив + урок-есть + результата-нет). Кодер-суб-агент + приёмка мной по лестнице.

## Чему научился
- В `ProactiveWatcher` `emit.ruleType` — обычная **строка**, не union/enum: новое правило добавляется без правки типов.
- Proactive-правила — **ENV-рубильники** (`PROACTIVE_RULE_*_ENABLED`, дефолт ON через `!== false`), НЕ в `admin-setting-schema-registry` (в отличие от порогов). Новое правило зеркаль в env.schema + typed-config `proactive.rules`, seed не нужен.
- Прод-страница эксперимента — `frontend/app/(authenticated)/experiments/[id]` (deep-link уведомлений корректен).

Связано: [[2026-07-06-experiment-to-task-impl]] · [[2026-07-06-experiment-to-task-tz]].
