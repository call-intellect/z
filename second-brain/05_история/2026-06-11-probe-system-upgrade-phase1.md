---
date: 2026-06-11
type: reflection
distilled: false
feature: Probe-система Фаза 1 — политика инициирования + формулировка (6 под-фаз)
branch: svdev
---

# Рефлексия — Probe-система Фаза 1 (формулировка + дайджест + recheck + fatigue + видимое следствие)

## Что было поставлено

Реализовать Фазу 1 переработки probe-системы (проактивные уточняющие вопросы Коры) по ТЗ
[`plans/tz/2026-06-11-probe-system-upgrade-phase1.md`](../../plans/tz/2026-06-11-probe-system-upgrade-phase1.md)
— 6 под-фаз. Корень проблемы «вопросы не понравились» из анализа
[`2026-06-11-proactive-clarifying-questions-probe-research.md`](../../plans/analysis/2026-06-11-proactive-clarifying-questions-probe-research.md):
дело было не в тексте вопроса, а в **отсутствии политики инициирования** — когда слать, кому, как часто,
и как не дёргать зря.

## Как решал (по фазам)

- **Ф1 (`5ed78b54`)** — переписал промпт `backend/src/modules/knowledge-core/prompts/probe-formulate.prompt.ts`
  по методологии (§9-B): SYSTEM = персона + правила + few-shot + self-check (стабильный, cache-friendly),
  USER больше не подаёт машинные коды (`emittedByService`/сырой `reason`) — вместо них человеческий
  `reasonLabel` из нового словаря `backend/src/modules/probe/probe-reason-labels.ts`
  (`PROBE_REASON_LABEL` + `PROBE_REASON_FALLBACK`). Schema контракта `probe_formulate_v2` → `probe_formulate_v3`.
  Fallback при провале LLM: `suggestedQuestion → PROBE_REASON_FALLBACK[reason] → generic` (раньше — сырой
  `humanizeProbeFallback(message)`, протекал техникой).
- **Ф2 (`cbe129b3`)** — новый `backend/src/modules/probe/probe-reason-policy.ts`: `PROBE_REASON_WINDOW`
  (`immediate`/`deferrable`, дефолт `deferrable`) + `probeWindow(reason)` + `PROBE_REASON_RECHECK`
  (предикаты «пробел ещё открыт?» — перечитывают Decision/Idea/Regulation/Process/Policy по `contextCardId`,
  tenant-изолированно).
- **Ф3 (`7c82a0f3`)** — батч-дайджест. Новое enum-значение `ProbeStatus.queued_digest`: deferrable-probe
  сверх бюджета больше не дропается (`dropped_rate_limit`), а откладывается — гейт исправлен **в двух местах**
  (`ProbeService.suggest()` и `ProbeDispatcherWorker`). Новый `probe/probe-digest.cron.ts`
  (`ProbeDigestCron`, `@Cron('0 * * * *')`, фактически 1×/день в `probe.digestHourUtc`): группирует
  `queued_digest` по `(tenantId, recipient)`, шлёт ОДНО `probe.digest` (≤ `probe.digestTouchCap`),
  помечает вошедшие `dispatched` (идемпотентно). Детерминированный билдер `probe/prompts/probe-digest.prompt.ts`
  (`buildProbeDigestSummary`, без LLM). immediate-probe при лимите минует дайджест (R6). Новый eventType
  `probe.digest` (Zod + рендер telegram/max-bot, канал-политика `['telegram_bot','max_bot','in_app']`,
  фронт-label «Вопросы от Коры»). Зарегистрирован в `probe.module.ts`.
- **Ф4 (`9b5a026a`)** — `ProbeDispatcherWorker.process()` перед `formulate()` перепроверяет повод
  (`PROBE_REASON_RECHECK`). Пробел закрылся сам между `suggest` и `dispatch` → `ProbeStatus.suppressed_stale`,
  probe не шлётся, LLM не зовётся. Best-effort (ошибка предиката → probe всё равно уходит).
- **Ф5 (`8a993edc`)** — adaptive fatigue. Метрика `probe_outcome_total{outcome,reason}` (`answered` из
  `ProbeResponseHandler`, `ignored` из `ProbePriorityCron`). `ProbePriorityCron` пишет engagement-снимок в Redis;
  `ProbeService.filterByRateLimit` режет бюджет вдвое получателю с низким engagement (kill-switch
  `probe.adaptiveFatigueEnabled`). Topic cooldown: dispatcher (на dispatch) и priority-cron (на `ignored`)
  ставят `probe:cooldown:{tenant}:{hash}` на `probe.topicCooldownHours` (48ч); `suggest()` дропает тему на
  cooldown. Общие ключи — `probe/probe-fatigue.util.ts`. `ProbePriorityCron` теперь инжектит
  `RedisService` + `TypedConfigService`.
- **Ф6 (`fa950cd1`)** — `ProbeResponseHandler` после ответа шлёт подтверждение `probe.answer_acknowledged`
  («Спасибо! Ваш ответ записан в память компании.» + `contextCardTitle`). Только текст. Best-effort.
  Инжектит `ConversationalService`. Новый eventType (Zod + рендер telegram/max-bot + фронт-label «Ответ записан»).

**Миграция:** `backend/prisma/migrations/20260611120000_probe_status_digest/migration.sql` —
`ALTER TYPE "ProbeStatus" ADD VALUE 'queued_digest'` + `'suppressed_stale'` (аддитивно).

**Крутилки** (AdminSetting, секция `probe`, через `getDynamic`, code-default): `probe.digestTouchCap` (5),
`probe.digestHourUtc` (9), `probe.digestEnabled` (true, kill-switch), `probe.topicCooldownHours` (48),
`probe.adaptiveFatigueEnabled` (true, kill-switch). Зарегистрированы в
`admin/settings/admin-setting-schema-registry.ts` + `seed-admin-settings.ts`. Прод-действий не требуют.

## Что вышло (верификация)

- `typecheck` + `build` + `frontend` — зелёные.
- Probe-тесты — ~57 (digest-cron, dispatcher-recheck, answer-ack, fatigue, reason-labels, reason-policy,
  queued-digest, priority-cron-integration).
- Conversational — 167 тестов зелёные (рендер новых eventType в адаптерах).
- lint — 0.

## Чему научился

- **Rate-limit-дроп жил в ДВУХ местах** — `ProbeService.suggest()` и `ProbeDispatcherWorker` гейтят бюджет
  независимо; чинить `queued_digest` пришлось в обоих, иначе один путь продолжал дропать. (Класс бага: один
  симптом — два корня; верифицировать оба.)
- **Рендер новых eventType потребовал кейсов в telegram + max адаптерах** + поле `summary` в payload для
  отображения в кабинете — ТЗ это недоскопил (описывало только сам факт нового eventType). Новый eventType ≠
  «только registry»: нужны Zod-схема + ветка рендера в КАЖДОМ адаптере + фронт-label.
- **Миграцию enum пришлось писать руками** (dev-БД не поднята, `migrate dev` не прогнать), а `ALTER TYPE
  ADD VALUE` не-транзакционна — вынес в отдельную миграцию, не в STEPS агрегатора (это схема, не seed/patch).
- **Cooldown-мок в тесте надо делать key-aware** — `probe:cooldown:*` ключи зависят от `(tenant, hash темы)`;
  плоский мок Redis давал ложные пройдено/провалено, пришлось разводить по ключу.
- **`probe-digest` намеренно без LLM** — детерминированный билдер; не плодим taskType ради сводки списка
  отложенных вопросов (дешевле, предсказуемее, не ломает prompt-cache `probe-formulate`).

## Связанные правки доков

`second-brain/01_projects/{probe-agent,workers-queues,ai-jobs,api-layer}.md`,
`second-brain/02_architecture/data-model.md`, `docs/operations/{feature-flags,prod-deploy-log}.md`,
`second-brain/04_не-сделано/README.md` (строка про Фазу 2/3).
