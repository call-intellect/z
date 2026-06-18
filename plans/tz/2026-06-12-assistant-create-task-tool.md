---
type: tz
status: blocked-on-owner
feature: assistant-create-task-tool
date: 2026-06-12
relates_to:
  - plans/archive/2026-06-11-assistant-channels-telegram-max.md
---

# ТЗ-заглушка · Инструмент «поставить задачу» (create_task) у AI-помощника

> Вскрыто при реализации Ф6 assistant-channels (2026-06-12). Решение В4 владельца включает «поставить задачу» в набор инструментов канала, но инструмент НЕ реализован — нужна развилка владельца по правам.

## Проблема

У помощника (concierge) нет инструмента создания задачи. Семантически подходящий endpoint `POST /api/v1/intake` закрыт RBAC `intake_issue/write` = только **owner/admin/coo** (policy.csv:801-808): рядовой сотрудник и manager получат 403. Альтернатива `POST /api/v1/projects/:projectId/issues` требует projectId, которого модель не знает.

**Текущее смягчение (уже в коде):** intent `task` в Telegram идёт прежней веткой `handleCreateTask` (внутренний вызов IntakeService, минуя REST) — функционал постановки задач из Telegram сохранён. Но: в web-чате помощника и в MAX поставить задачу через помощника нельзя; «один мозг» для задач не достигнут.

## Развилка владельца (выбрать одно)

- **Р-1 (рекомендация):** расширить policy: `intake_issue/write` для всех ролей (`member` включительно) — intake это «входящие предложения задач», авто-триаж W4 уже фильтрует порогом 0.75; запись обратима. Тогда инструмент `create_task` → `POST /api/v1/intake` (source `concierge` уже в enum).
- **Р-2:** отдельный self-service endpoint `POST /api/v1/intake/self` (узкий: автор=сам, без назначения другим) + инструмент на него. Больше кода, та же семантика.

## Реализация после решения (1 фаза)

- [ ] policy.csv или новый endpoint (по выбору Р)
- [ ] инструмент `create_task` в `ServiceMapGeneratorService` (parameters: title, description?; rbacResource intake_issue; undoableVia нет → текст-confirm Ф6 сработает автоматически)
- [ ] добавить в `CHANNEL_TOOL_WHITELIST_SELF` (assistant-channel.bridge.ts)
- [ ] снять обход intent `task` в telegram-bot.adapter.ts (перехват в assistant_turn вернуть и для task) — один мозг
- [ ] тесты: рядовой ставит задачу через помощника в канале; confirm-флоу на создание

## Acceptance

Рядовой в Telegram: «поставь задачу проверить сервер» → помощник → confirm «да» → IntakeIssue создан → авто-триаж W4 принимает → ack в канал.
