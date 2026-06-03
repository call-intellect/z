---
type: tz
status: needs-owner-go
date: 2026-06-03
owner: sergrv80@gmail.com
branch: feature/action-center-trust-ladder
relates_to:
  - plans/tz/2026-06-03-action-center-remaining.md
  - backend/src/modules/chat-v2/services/card-specialist-registry.service.ts
  - backend/src/modules/chat-v2/services/synthesis.service.ts
  - backend/src/modules/knowledge-core/services/chat-v2.service.ts
phases:
  - D1
  - D2
---

> **Статус:** требуется решение владельца на запуск (продуктово-стоимостная развилка — п.17(б) оркестрации). Создано как фиксация пробела, вскрытого при реализации **Фазы C1** ТЗ `2026-06-03-action-center-remaining.md`.

# Корпоративный чат: карточки знаний как цитаты + метка доверия

## 0. Откуда взялось (контекст)

Acceptance Фазы C1 требовал: *«trustTier присутствует… в DTO цитат chat-v2»* и *«Цитата в чате на провизорную карточку помечена»*. ТЗ C1 исходил из допущения, что корпоративный чат **уже цитирует карточки знаний** (регуляции/решения/процессы) и нужно лишь пробросить метку.

**Аудит кода (2026-06-03) показал, что допущение неверно:**
- Ответ чата собирает `ChatV2OrchestrationService` → `SynthesisService.synthesize()` → knowledge-core `ChatV2Service.ask()`.
- Цитаты (`ChatV2Citation`: `meetingId, meetingTitle, startMs, endMs, snippet`) формируются `parseCitationsFromAnswer()`, который берёт **только блоки с `primaryMeetingEvidence`** — т.е. цитаты **исключительно на встречи**.
- `CardSpecialistRegistry.getCardsForQuery()` (`backend/src/modules/chat-v2/services/card-specialist-registry.service.ts`) — **каркас для α-6, в цепочку синтеза НЕ подключён** (нигде не вызывается). Карточки знаний в ответ как цитаты сейчас **не попадают вообще**.

Вывод: пометить «провизорную карточку в цитате» **физически негде** — класс «цитата-карточка» не существует. Это не проброс поля, а отдельная фича (surface карточек в чате). Поэтому вынесено из C1 в это суб-ТЗ.

## Почему это решение владельца (а не «просто доделать»)

Подключение карточек как цитат меняет **поведение и экономику** корпоративного чата:
1. **Стоимость:** дополнительный retrieval специалистов + больше контента в промпте LLM → рост токенов/латентности на каждый запрос. Нужно решение, оправдан ли он сейчас (см. `feedback_llm_prompts_cache_friendly` — стабильный SYSTEM, переменные карточки только в конце user).
2. **Продукт/UX:** новый тип цитат (карточка vs фрагмент встречи) — меняет вид ответа; нужно согласовать, должен ли чат «ссылаться на знания», а не только на сырые встречи.
3. **Качество:** карточки-цитаты завязаны на качество retrieval специалистов (α-6) — преждевременное включение может цитировать нерелевантное.

Если владелец говорит «да» — фазы ниже готовы к прогону тем же оркестратором.

## Цель
Дать корпоративному чату цитировать карточки знаний и **видимо помечать** провизорные (ИИ-канонизированные без человека) — замкнуть незакрытую часть C1.

## Фаза D1 — Backend: карточки-цитаты с trustTier

**Что входит:**
- Подключить `CardSpecialistRegistry.getCardsForQuery()` в цепочку синтеза (`SynthesisService`/knowledge-core `ChatV2Service`) — извлекать релевантные карточки наряду с блоками встреч. Cache-friendly: карточки — в конце user-промпта, SYSTEM не трогать.
- Расширить `CardSpecialistResult` полем `trustTier` (подтянуть `currentVersion.trustTier` в селектах хендлеров карточек — `specialist-3-1-card-handler.service.ts` и др.; образец include — из C1 `regulations.service.ts`).
- Ввести в HTTP-ответ чата **отдельный тип цитаты-карточки**: `{ kind:'card', resourceType, resourceId, title, snippet, trustTier }` (не ломая существующие meeting-цитаты — discriminated union или отдельный массив `cardCitations`).
- Контроллер `POST /api/v1/chat-v2/messages` отдаёт карточки-цитаты в ответе.

**Acceptance:**
- [ ] При запросе, на который отвечают карточки знаний, ответ содержит карточки-цитаты с `trustTier`.
- [ ] Промпт остаётся cache-friendly (SYSTEM стабилен; раздел «Совместимость с prompt caching»).
- [ ] Стоимость/латентность под контролем (лимит числа карточек-цитат; лог токенов).
- [ ] Unit на проброс trustTier в карточку-цитату + на сборку ответа; typecheck/lint зелёные.

## Фаза D2 — Frontend: рендер карточек-цитат + TrustBadge

**Что входит:**
- В `frontend/app/(authenticated)/chat-v2/ChatV2Client.tsx` (+ слои `src/api/chat-v2.api.ts`, `src/domain/chat-v2.ts`) — рендер карточек-цитат отдельно от meeting-цитат; рядом с провизорной карточкой — `<TrustBadge tier="provisional" />` (компонент уже есть из C1).
- Парные токены; русский; deep-link на карточку (`/regulations`/`/decisions/...`).

**Acceptance:**
- [ ] Карточки-цитаты видны в ответе чата, провизорные помечены плашкой.
- [ ] Клик ведёт на карточку. typecheck/lint/test:unit зелёные. Парные токены.

## Prod / second-brain
- D1: новых ENV/таблиц нет (читаем существующее). Рост стоимости LLM — отметить в наблюдаемости.
- second-brain: `02_architecture/knowledge-core.md` (карточки в ответе чата), `01_projects/*` про chat-v2.

## Итог
Не реализовано (фиксация пробела C1). Запуск — после «да» владельца (стоимость + продукт). Базовый компонент `TrustBadge` и backend-паттерн include trustTier уже готовы из C1.
