---
type: tz
status: stub-awaiting-owner
feature: concierge-conversation-management-parity
date: 2026-06-28
owner: sergrv80@gmail.com
relates_to:
  - plans/tz/2026-06-25-edinyy-pomoshnik-chat-surface-convergence.md
---

# ТЗ-заглушка: паритет управления диалогами Мастера (pin / archive / feedback)

> Отколото из `chat-surface-convergence` КФ2.3 как **осознанная граница** (п.15а оркестратора): дом Мастера на движке concierge построен и работает БЕЗ этих функций; они — расширение сверх «что входит» КФ2 и требуют нового бэкенда у concierge, которого нет.

## Зачем (контекст)
КФ2.3 перевёл `/chat`-дом на движок concierge (`MasterChatHome`/`MasterConversation`). У `ChatV2Client` (старый дом) были фичи, которых у concierge-стора нет на бэкенде:
- **pin** диалога — у `ConciergeConversation` нет колонки `pinnedAt` и эндпоинта.
- **archive-управление** — `ConciergeConversation.archivedAt` есть и `list` фильтрует по `archived`, но **нет mutation-эндпоинта** «архивировать/вернуть»; в доме показан только активный список.
- **feedback** (палец вверх/вниз по ответу) — у `ConciergeMessage` нет полей оценки и эндпоинта.

Боль владельца (анализ 2026-06-27) этих функций НЕ называет — основной запрос «единое окно с историей + действиями + двери» закрыт в КФ2. Поэтому здесь — отдельный контракт, **запуск только с подтверждения владельца**.

## Scope (что сделать, когда возьмём)
### Ф1 — archive-управление `[ ]`
- Prisma: `ConciergeConversation.archivedAt` уже есть. Добавить эндпоинт `POST /api/v1/concierge/conversations/:id/archive` (body `{archived: boolean}`) → `archivedAt = archived ? now() : null` (scoped tenant+user).
- Фронт: вкладки «Активный / В архиве» в `MasterChatHome` (хук уже принимает `archived`), кнопка «Архивировать/Вернуть» в шапке диалога.

### Ф2 — pin `[ ]`
- Prisma-миграция: `ConciergeConversation += pinnedAt DateTime?` (+ индекс для сортировки pinned-first).
- Эндпоинт `POST /conversations/:id/pin` (body `{pinned: boolean}`). `list` сортирует `pinnedAt desc nulls last, lastMessageAt desc`.
- Фронт: pin-глиф в `ConversationItem`, тогл в шапке, поле `pinnedAt` в `ConciergeConversationApi`/domain.

### Ф3 — feedback по ответу `[ ]`
- Prisma-миграция: `ConciergeMessage += feedback Int?` (1/-1/null) или отдельная модель (сверить с тем, как сделано в chat-v2 `setFeedback/clearFeedback`).
- Эндпоинт `POST /messages/:id/feedback` (body `{value: 1|-1|null}`).
- Фронт: пальцы в assistant-пузыре `MasterConversation` (реюз паттерна `MessageFeedback` из chat-v2).

## Acceptance
- Миграции → `prod-deploy-log` Шаг 4. Эндпоинты scoped tenant+user (RBAC `concierge`).
- Тесты: archive/pin/feedback round-trip; список сортируется pinned-first; idempotent.
- Визуальная приёмка (qa-tester) на проде.

## Итог
(заполняет оркестратор при реализации.)
