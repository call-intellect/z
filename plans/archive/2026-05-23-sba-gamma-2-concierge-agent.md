---
type: tz
status: done
feature: γ-2 — Concierge Agent (sквозной UX-слой через tool-use)
phase: gamma-2
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §γ-2
  - plans/tz/2026-05-22-final-roadmap.md §γ-2
---

# SBA γ-2 — Concierge Agent

## 1. Цель и контекст

Сквозной UX-слой кабинета: floating button в AppShell + страница `/assistant` + `<ConciergeSlot>` компонент на каждой странице. Понимает context страницы, имеет доступ к whitelist REST-эндпоинтам через tool-use, может выполнить действие за пользователя. Поддерживает Undo через ConciergeUndoLog.

**Главный вход — постоянно видимая плавающая кнопка** (`ConciergeFloatingButton` в AppShell + bottom-nav вкладка на мобильных). ЦА Z — не разработчики (владельцы малого бизнеса, COO, прорабы, менеджеры объектов), keyboard shortcuts они не знают и не запоминают. Cmd+K / Ctrl+K — **опциональный** desktop shortcut для power-users, не часть основного UX и не блокирует MVP. В user-guide и копи мессаджей Cmd+K **не позиционируется** как «главный способ» — главный способ всегда «нажать на значок Коры справа внизу или написать боту в Telegram».

## 2. Scope

**Входит:**
- Backend модуль `concierge/`:
  - `ConciergeService` (фасад) — `process({ userMessage, pageContext, userId, tenantId }) → SSE stream`.
  - `ToolRouterService` — реестр allowed REST tools (whitelist), validation схем, выполнение через internal axios call.
  - `ServiceMapGeneratorService` — startup: сканирует REST routes + Swagger metadata → формирует ToolSchema array (для системного промпта).
  - `ConciergeContextBuilderService` — формирует context из pageContext (route, currentEntityId) + recent activity + user permissions.
  - `ConciergeUndoLogService` — хранит executed tool calls с rollback-инструкциями.
- Модели Prisma:
  - `ConciergeConversation` (id, tenantId, userId, startedAt, lastMessageAt, summary?).
  - `ConciergeMessage` (id, conversationId, role, content, toolCalls?, createdAt).
  - `ConciergeUndoLog` (id, conversationId, toolName, params, result, undoInstruction, executedAt, rolledBackAt?).
  - `OrgConciergeQuota` (tenantId @unique, dailyMessagesLimit, monthlyMessagesLimit, currentDailyCount, currentMonthlyCount, resetAt).
- REST `/api/v1/concierge/*` + SSE endpoint.
- Frontend:
  - **Floating button в AppShell** (главный вход, всегда виден на desktop и mobile).
  - Страница `/assistant` (full-screen для длинных исследовательских запросов).
  - `<ConciergeSlot context={...}>` компонент (drop-in per page).
  - Расширение `CommandPalette.tsx` двумя режимами Search/Command — **опциональный desktop shortcut**, не блокирует MVP. Существующая палитра в Cards остаётся как глобальный поиск; режим Command — для тех, кто привык к Cmd+K.
- 2 LlmTaskType: `concierge-respond`, `concierge-toolcall-validate`.
- ToastContext extension (or Sonner migration) для action toast'ов «Готово. Отменить».
- RBAC + Метрики.

**Не входит:**
- Voice через concierge — δ-3.
- Multi-step deep orchestration — δ-1 (Orchestrator).

## 3. Принятые решения

1. **Tool-use approach.** LLM получает ToolSchema, может вызвать любой allowed tool. Backend выполняет, возвращает result в LLM-loop для next iteration.
2. **Whitelist tools — auto-generated из Swagger metadata** at startup. Любой REST-эндпоинт с decorator `@ConciergeTool({ undoableVia?: 'methodName' })` доступен.
3. **Undo** — обязателен для всех мутирующих tools. Если tool не undoable — concierge UI явно говорит «это действие нельзя отменить» и просит явное confirm.
4. **ConciergeSlot — opt-in.** Не каждая страница обязана подключать. Default — собирает context из URL.
5. **SSE streaming** — для UX «печатает ответ» effect.
6. **OrgConciergeQuota** — anti-abuse. Default 100 msgs/day per user, 3000/month per org.
7. **CommandPalette extension vs Sonner migration** — extend ToastContext с action; миграция на Sonner — отдельный sub-ТЗ.
8. **Tool execution context** — внутри backend, не через HTTP loopback. Direct service call с правильным TenantGuard контекстом.

## 4. Зависимости

- α-5 (parallel) — DialogService для intent classification (optional, fallback к direct LLM).
- α-1 (готово) — Notification для async-results.
- β-1 (БЛОКЕР для inbound через каналы) — sub-ТЗ запускать после β-1.
- chat-v2 (готово) — для knowledge queries.

## 5. Prisma-дельта

```prisma
model ConciergeConversation {
  id              String   @id @default(cuid())
  tenantId        String
  userId          String
  pageContextJson Json?
  startedAt       DateTime @default(now())
  lastMessageAt   DateTime?
  summary         String?  @db.Text
  archivedAt      DateTime?

  user            User     @relation(fields: [userId], references: [id])
  tenant          Org      @relation(fields: [tenantId], references: [id])
  messages        ConciergeMessage[]
  undoLogs        ConciergeUndoLog[]

  @@index([tenantId, userId, lastMessageAt])
}

model ConciergeMessage {
  id              String   @id @default(cuid())
  conversationId  String
  role            String                       // 'user'|'assistant'|'tool'
  content         String   @db.Text
  toolCallsJson   Json?
  createdAt       DateTime @default(now())

  conversation    ConciergeConversation @relation(fields: [conversationId], references: [id])

  @@index([conversationId, createdAt])
}

model ConciergeUndoLog {
  id                String   @id @default(cuid())
  tenantId          String
  conversationId    String
  toolName          String
  paramsJson        Json
  resultJson        Json
  undoInstructionJson Json?
  executedAt        DateTime @default(now())
  rolledBackAt      DateTime?

  conversation      ConciergeConversation @relation(fields: [conversationId], references: [id])

  @@index([tenantId, executedAt])
}

model OrgConciergeQuota {
  tenantId               String   @id
  dailyMessagesLimit     Int      @default(100)
  monthlyMessagesLimit   Int      @default(3000)
  currentDailyCount      Int      @default(0)
  currentMonthlyCount    Int      @default(0)
  resetDailyAt           DateTime?
  resetMonthlyAt         DateTime?

  tenant                 Org      @relation(fields: [tenantId], references: [id])
}
```

## 6. Patch / миграция данных

`backend/scripts/seed-org-concierge-quotas.ts` — для каждой Org проставить default quota если не существует.

## 7. REST API

`/api/v1/concierge`:
- `POST /messages` (SSE) — request body `{ userMessage, conversationId?, pageContext }`, response SSE stream.
- `GET /conversations`, `GET /conversations/:id` (history).
- `POST /undo/:logId`.

## 8. BullMQ worker'ы и cron'ы

- `concierge-quota-reset.cron` — `@Cron('0 0 * * *')` daily reset of daily counts.
- `concierge-quota-monthly-reset.cron` — `@Cron('0 0 1 * *')` monthly.
- `concierge-conversation-summarizer.cron` — `@Cron('*/30 * * * *')` — сжимает long conversations.

## 9. LlmTaskType регистрация

```ts
{ taskType: 'concierge-respond',           priority: 'primary', provider: 'openai', model: 'gpt-4o' }      // нужна tool-use
{ taskType: 'concierge-respond',           priority: 'secondary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'concierge-respond',           priority: 'tertiary', provider: 'ollama', model: 'qwen3.5:9b' }
{ taskType: 'concierge-toolcall-validate', priority: 'primary', provider: 'ollama', model: 'qwen3.5:9b' }
{ taskType: 'concierge-toolcall-validate', priority: 'secondary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'concierge-toolcall-validate', priority: 'tertiary', provider: 'openai', model: 'gpt-4o-mini' }
```

## 10. RBAC ResourceType

- `concierge.use` (employee).
- `concierge.admin` (super_admin) — для просмотра OrgConciergeQuota.
- Tool-execution использует существующие RBAC permissions от вызываемых endpoints.

## 11. Метрики Prometheus

- `concierge_messages_total{tenant_top}` counter.
- `concierge_tool_calls_total{tenant_top, tool}` counter.
- `concierge_undo_total{tenant_top, tool}` counter.
- `concierge_quota_exceeded_total{tenant_top, scope}` counter — scope ∈ {daily|monthly}.
- `concierge_response_duration_seconds` histogram.

## 12. Frontend

**Иерархия входов (по приоритету реализации):**

1. **`ConciergeFloatingButton.tsx`** — главный вход. Постоянно виден в правом нижнем углу на каждой странице. На мобильных — дополнительная вкладка в bottom navigation. Текст значка: «Кора-помощник». Это **обязательно для MVP**.
2. **`/assistant` страница** — full-screen режим для длинных исследовательских запросов с историей сессии.
3. **`<ConciergeSlot context={...}>`** — drop-in per page компонент для встраивания концьержа в конкретные страницы с контекстом.
4. _Опционально_ — **расширение `CommandPalette.tsx` режимом Command** для desktop power-users (Cmd+K/Ctrl+K). Не блокирует MVP, можно отложить. Существующая палитра в Cards (глобальный поиск) остаётся как есть.

Файлы:

- `frontend/src/ui/concierge/`:
  - `ConciergeFloatingButton.tsx`.
  - `ConciergeSlot.tsx` (drop-in per page).
  - `ConciergeChat.tsx` (с SSE handler).
  - _(опционально)_ Расширение `CommandPalette.tsx` с режимом Command.
- `frontend/app/(authenticated)/assistant/page.tsx`.
- API client `concierge.api.ts` с SSE support.
- Domain mapper.
- AppShell: floating button + (на мобильных) bottom-nav вкладка.
- ToastContext extension: добавить optional `action: { label, onClick }` для action toast'ов.
- `Remove-Item -Recurse -Force .next\types`.

## 13. ENV переменные

- `CONCIERGE_ENABLED: boolean (default true)`.
- `CONCIERGE_DAILY_MESSAGES_LIMIT: number (default 100)`.
- `CONCIERGE_MONTHLY_MESSAGES_LIMIT: number (default 3000)`.
- `CONCIERGE_SSE_HEARTBEAT_SECONDS: number (default 15)`.

## 14. Связь с существующим кодом

- `frontend/src/ui/CommandPalette.tsx` (если есть — extend).
- `frontend/src/contexts/toast.tsx` (extend) или migrate to Sonner.
- `backend/src/main.ts` — startup ServiceMapGeneratorService.
- `backend/src/modules/ai/services/llm-router.service.ts` — для tool-use LLM calls.
- schema.prisma.

## 15. DoD

- [x] 4 модели в schema.
- [x] 5 сервисов backend.
- [x] REST + SSE endpoint.
- [x] Frontend UI components: `ConciergeFloatingButton` (обязательно), `ConciergeSlot`, `ConciergeChat`, страница `/assistant`. Расширение CommandPalette — опционально, не блокирует MVP.
- [x] Floating button виден на каждой странице кабинета (desktop + mobile).
- [x] Tool-use loop работает (тест: «создай встречу с темой X» через значок концьержа).
- [x] Undo работает.
- [x] Quota enforcement.
- [x] LlmTaskType + RBAC + Metrics.
- [x] typecheck/lint/tests.

## 16. Тесты

- **unit:** для каждого сервиса.
- **integration:** SSE flow.
- **e2e (Playwright):** через UI: запрос — tool call — undo.

## 17. Риски и mitigation

- **Tool-call безопасность** — каждый tool проверяет RBAC от userId; concierge не bypassит permissions.
- **SSE streaming complexity** — fallback на polling если SSE не поддерживается.
- **Quota stable** — Redis для realtime counter, cron sync to DB.
- **Schema merge** — большой добавляемый объём; кодер аккуратно.
- **`.next/types/`** — Remove-Item.
- **ToastContext breaking change** — если existing code сильно зависит от текущего API ToastContext — рассмотри миграцию на Sonner как cleaner solution.

## Ревизия от 2026-05-24

**Статус:** done
**Реализовано:**
- 4 модели в schema.prisma: `ConciergeConversation` (5897) + `ConciergeMessage` + `ConciergeUndoLog` + `OrgConciergeQuota`.
- `ConciergeModule` (`backend/src/modules/concierge/`): 6 сервисов (ConciergeService, ToolRouterService, ServiceMapGeneratorService, ConciergeContextBuilderService, ConciergeUndoLogService, ConciergeQuotaService) + `@ConciergeTool` decorator + 2 cron'а (quota-reset, conversation-summarizer).
- REST `/api/v1/concierge` с SSE через `ConciergeController`.
- Frontend: `ConciergeFloatingButton.tsx` (подключён в `AppShell.tsx`), `ConciergeSlot.tsx`, `ConciergeChat.tsx`, страница `/assistant` + `AssistantClient.tsx`; API client `concierge.api.ts`.
- LlmTaskType seed: `backend/scripts/seed-llm-task-routes-concierge.ts`.
- RBAC `concierge` ResourceType (policy.csv:572-579).
- Wave 2 finishing (commit 8c1088a) — CommandPalette расширен режимами `>` (concierge action) и `?` (chat-v2 ask).
