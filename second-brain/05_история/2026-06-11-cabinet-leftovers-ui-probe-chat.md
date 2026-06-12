---
date: 2026-06-11
type: reflection
distilled: false
feature: cabinet-leftovers (UI-протечки §1 Ф2–Ф6 · probe §3 · чат-стрим §4)
branch: feature/meeting-cabinet-fixes-2026-06-10
---

# Рефлексия — доводка кабинета: UI-протечки, адресация probe, стадии AI-чата

## Что было поставлено

Реализовать ТЗ-1 `plans/tz/2026-06-11-cabinet-leftovers-ui-probe-chat.md` целиком через оркестрацию суб-агентами:
- **§1 (Часть 1)** — технические протечки в UI (Ф2 enum→русский, Ф3 cuid→имя, Ф4 raw-json→текст, Ф5 зоны: role-gate `/orchestrator` + strip маркеров чата, Ф6 admin-зона);
- **§3 (Часть 2)** — уведомления/probe/модерация (Ф1 адресация субъекту, Ф2 человеческие тексты, Ф3 фронт);
- **§4 (Часть 3)** — AI-чат «Помощник компании»: обратная связь и латентность (Ф1 стадии, Ф2 SSE-стрим токенов, Ф3 таймаут синтеза).

Владелец отдельно попросил **перепроверить, точно ли всё это ещё НЕ сделано** (ТЗ опиралось на аудит двухдневной давности — код мог уйти вперёд).

## Как решал

**Перепроверка кодом.** Прежде чем кодить — три суб-агента независимо прошли по якорям ТЗ (file:line) и подтвердили: всё перечисленное действительно НЕ сделано (с одним важным исключением — см. ниже про support-статусы). Это сэкономило бесполезную работу.

**Реализация фазами, 10 коммитов** (приёмку каждой фазы — typecheck/build/тесты/греп — прохожу сам как оркестратор, до коммита):

| Часть · Фаза | Что | Коммит |
|---|---|---|
| §1 Ф2 | enum→русский: мапперы cards/graph/themes/concierge/sprints, новый `domain/concierge.ts toolNameLabel`, `meetingStatusLabel`; `ReadablePayload` вынесен в общий `frontend/src/ui/readable-payload.tsx` | `d8902c49` |
| §1 Ф3 | cuid→имя: бэк `intake.findAll` батч-резолвит `Project.name`/`Goal.name`/`Person.name` → `*Name` в DTO; эксперимент скрыл ID; «Связанный конфликт» вместо `Конфликт {cid}`; participants→`memberDisplayName` | `fce71268` |
| §1 Ф4 | raw-json→текст: `me/notifications` «Ваш ответ»; team-templates `definition`→`ReadablePayload`, `category`→`teamTemplateCategoryLabel` | `6f6fff64` |
| §1 Ф5 | role-gate `/orchestrator` (`OrchestratorAuthGuard`+layout, super_admin/owner); `stripBlockMarkers` вырезает `[BLOCK:]`/`[CONTRADICTING BLOCK]` из ответа чата | `d995a4c7` |
| §3 Ф1 | адресация probe субъекту: `resolveProbeRecipients` при флаге ON → `[субъект, глава отдела, owner]` (субъект первым); specialist-3-2/3-7 пробрасывают флаг; kill-switch `PROBE_SUBJECT_ADDRESSING_ENABLED` | `a088e25d` |
| §3 Ф2 | человеческие тексты: `RULE_DESCRIPTIONS` простой русский; `probe-formulate` SYSTEM «без кодов/ID»; `humanizeProbeFallback`; модерация через `resourceTypeRu`/`levelRu`/`resolutionRu` (новые в `pending-actions/resource-type-ru.ts`) | `dbde0d57` |
| §3 Ф3 | `EVENT_TYPE_LABELS` дозаполнен реальными кодами из backend conversational policy-map | `6655f769` |
| §4 Ф3 | отдельный таймаут синтеза chat-v2: `LlmCallParams.timeoutMs?` (per-call override), AdminSetting `knowledge.chatV2SynthesisTimeoutMs` (POSITIVE_INT, code-default 90000, не ENV) | `8adfa8da` |
| §4 Ф1 backend | стадии прогресса через SSE: `POST /api/v1/chat-v2/messages/stream`, `ChatV2Stage=understanding\|searching\|writing`, `onStage` пробрасывается orchestration→synthesis→knowledge-core; события `stage`/`done`/`error`; kill-switch `CHAT_V2_STREAMING_ENABLED` (OFF→503, синхронный путь не тронут) | `2c6285aa` |
| §4 Ф1 frontend | `chat-v2.api streamChatV2Message` (SSE-генератор); `ChatV2Client` показывает «Понимаю→Ищу→Пишу» + «Долго думаю» (>45с) + прозрачный fallback на синхронный `ask` при 503/ошибке | `afc7e1d2` |

**Флаги (Ship-On):** 2 kill-switch (оба default ON, действий владельца не требуют) — `PROBE_SUBJECT_ADDRESSING_ENABLED`, `CHAT_V2_STREAMING_ENABLED`; 1 AdminSetting с code-default — `knowledge.chatV2SynthesisTimeoutMs`. Оба флага — строки в `docs/operations/feature-flags.md`.

**Развилка владельца по §4.** Посимвольный стрим токенов (§4 Ф2) против стадий через SSE (§4 Ф1). Владелец выбрал **Вариант 1 — стадии**: они дёшево решают проблему «зависло», а посимвольный стрим требует переписать LLM-роутер. §4 Ф2 отложен (follow-up за тем же kill-switch `CHAT_V2_STREAMING_ENABLED`).

## Что вышло

- `typecheck`/`build` front+back — зелёные.
- 6 новых spec-файлов, все зелёные: `intake.service.spec`, `chat-v2-strip-markers.spec` (9), `probe-recipient.util.spec` (9), `humanize-probe-fallback.spec` (5), `chat-v2-synthesis-timeout.spec` (1), `chat-v2-stage-progress.spec` (4).
- Реализовано: §1 Ф2–Ф5, §3 Ф1–Ф3, §4 Ф1+Ф3.
- Осознанно НЕ сделано: §1 Ф6 (super_admin debug-инструменты — сырой JSON это их функция, за `AdminAuthGuard`), §4 Ф2 (отложен владельцем).
- Прод-операций: только `docker compose up -d --build backend frontend` (миграций/seed/patch/backfill нет). Запись в `docs/operations/prod-deploy-log.md`.

## Чему научился (важное)

- **(а) Аудит может давать false-positive — проверка по коду экономит работу.** ТЗ требовало завести `ticketStatusLabel` для support-статусов (§1 Ф5). По факту `ticket.status = issueState.name` **уже русский** — маппер не нужен. Проверка по коду до начала кодинга сэкономила бесполезную обвязку. Урок: якоря аудита двухдневной давности нельзя брать на веру, грепать факт.
- **(б) LLM-роутер `call()` строго НЕ-стриминговый.** Посимвольный стрим токенов = крупная переделка (роутер + 3 провайдера). Стадии прогресса через SSE (как в Concierge) дёшево решают проблему «чат завис» — без касания синтеза. Правильный размен: косметику (token-streaming) отложить, обратную связь (стадии) выкатить.
- **(в) Глобальный `LLM_ROUTER_DISPATCH_TIMEOUT_MS` по факту 300с, не 30с** (как предполагало ТЗ из старой трассы). Тем не менее per-call `timeoutMs` всё равно правильный — он **развязывает** таймаут chat-v2 от общего, чтобы тяжёлый синтез не резался и не ловил чужие лимиты.
- **(г) Concierge — готовый SSE-образец.** У Concierge уже есть backend-контроллер SSE + frontend `streamConciergeMessage`. Переиспользовал паттерн (события stage/done/error, генератор на фронте) вместо изобретения своего — меньше риска, единый стиль.
- **(д) `chatV2TopBlocks` читается из ENV, а не AdminSetting.** Для настоящей админ-крутилки нужен `resolveSync` (динамический снимок), а не `this.get` (статический ENV). Зафиксировал как ловушку: «крутилка» в AdminSetting и «значение из ENV» — разные пути чтения в `TypedConfigService`.
