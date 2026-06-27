---
type: tz
status: stub-awaiting-owner
feature: meeting-chat-on-master-scoped
date: 2026-06-28
owner: sergrv80@gmail.com
relates_to:
  - plans/tz/2026-06-25-edinyy-pomoshnik-chat-surface-convergence.md
  - plans/tz/2026-06-28-concierge-conversation-management-parity.md
---

# ТЗ-заглушка: чат встречи на Мастера (scope:meeting) — с сохранением UX страницы встречи

> Отколото из `chat-surface-convergence` КФ3. IssueChat и мобильный «Спросить» уже переведены на Мастер (`MasterScopedChat`, КФ3a/КФ3b). **MeetingChatPanel НЕ переведён намеренно** — у него есть специфика страницы встречи, которую слепая миграция на `MasterScopedChat` РЕГРЕССИРУЕТ. Здесь — контракт, как мигрировать без потери UX. Запуск под визуальную приёмку (владелец заложил это для КФ3).

## Почему не сделано сразу (доказано чтением кода)
`MeetingChatPanel.tsx` + `use-meeting-chat.ts` сегодня:
1. **`onSeek(ms)` — клик по цитате перематывает ВСТРОЕННЫЙ плеер встречи**, не уводит на `/meetings/:id`. `MasterScopedChat`/`MasterCitations` рендерят цитату как НАВИГАЦИЮ (`/meetings/:id?t=sec`) — на странице самой встречи это регресс (уход со страницы вместо перемотки).
2. **`speakerName` в цитатах** (`AiCitation speakerName=...`). Цитаты concierge/chat-v2 (`ChatV2CitationApi`) поля `speakerName` НЕ несут — при миграции имя спикера теряется.
3. **Персист-история** через `chatApi.historyMeeting` (`GET /meetings/:id/chat/history`). `MasterScopedChat` сессионный — при повторном открытии встречи прошлый чат пропадёт.
4. **Сворачиваемый chrome** (open/onOpenChange + FAB), подсказки, retry-доставки — частично уже есть в MasterScopedChat (промпты), частично нет (retry, collapse).

## Scope (что сделать)
### Ф1 — speakerName в цитатах Мастера `[ ]`
- Бэкенд: добавить `speakerName?: string | null` в meeting-цитаты пути chat-v2 (`ChatV2Citation`) — там, где формируются по встрече (retrieval). Прокинуть до `EphemeralAnswer.citations` (concierge passthrough).
- Фронт: `ChatV2CitationApi += speakerName?`; `MasterCitations`/`MasterCitationSource` показывать спикера для meeting-цитат.

### Ф2 — режим цитаты «перемотка плеера» `[ ]`
- `MasterScopedChat` + `MasterCitations`: опц. проп `onCitationSeek?: (ms: number) => void`. Если задан — клик по meeting-цитате вызывает `onCitationSeek(startMs)` (перемотка), а не навигацию. На странице встречи передавать `onSeek` плеера.

### Ф3 — история чата встречи `[ ]`
- Решить модель: (а) сессионная (как сейчас в MasterScopedChat) — простейшее, но регресс vs текущей персист-истории; ИЛИ (б) concierge-conversation-by-scope (см. parity-ТЗ Ф-persistence): найти/создать concierge-диалог по (user, scope=meeting, scopeRefId=meetingId), грузить его историю. Рекомендация: (б) — единый стор с домом Мастера.

### Ф4 — chrome `[ ]`
- Перевести `MeetingChatPanel` в тонкую обёртку над `MasterScopedChat` (scope:meeting, scopeRefId:meetingId, onCitationSeek=onSeek, suggestedPrompts=SUGGESTED_PROMPTS), сохранив сворачивание (open/onOpenChange + FAB) и retry, либо вынеся их в проп MasterScopedChat. Монтаж — `MeetingResultPageReal.tsx:466`.

## Acceptance
- Визуальная приёмка (qa-tester, прод): на странице встречи чат отвечает Мастером (concierge scope:meeting), клик по цитате ПЕРЕМАТЫВАЕТ плеер (не уводит), спикер показан, история встречи цела.
- typecheck/lint/build; тесты на onCitationSeek-режим MasterCitations.

## Итог
(заполняет оркестратор при реализации.)
