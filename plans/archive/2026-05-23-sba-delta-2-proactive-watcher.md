---
type: tz
status: ready-for-code
feature: δ-2 — ProactiveWatcher (активный мониторинг + инициативные сообщения)
phase: delta-2
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §δ-2
  - plans/tz/2026-05-22-final-roadmap.md §δ-2
---

# SBA δ-2 — ProactiveWatcher

## 1. Цель и контекст

ProbeAgent — пассивен (отвечает на готовые события). ProactiveWatcher — активен: сам мониторит граф каждые 6 часов, формирует инициативные сообщения «заметил риск», «вижу повторяемое решение без owner'а», «эксперимент висит без результата 45 дней». Паттерн уже частично есть в `skill-manager-digest.cron` (готово).

## 2. Scope

**Входит:**
- Worker `proactive-watcher.cron` (`@Cron('0 */6 * * *')`) — каждые 6 часов.
- 8 правил-инициаторов (deterministic detectors over graph):
  1. Decision без owner'а >3 дней.
  2. Insight с frequency≥3 без mitigation.
  3. Experiment в running >threshold-days без result.
  4. Process в production без recent edit >90 дней (stale review).
  5. Role с completeness<0.5 + >5 attached people (high-touch undercatalogued).
  6. Department без linked FunctionalDomain.
  7. Несколько Insight в одной FunctionalDomain без cross-reference (siloed).
  8. plan_item старше 30 дней без done_item.
- Anti-spam: **max 1 proactive notification per user per day**.
- LLM-step `proactive-message-craft`: формулирует короткое friendly message (не «алерт», а «привет, заметил X»).
- Использует ConversationalService.sendNotification для доставки.
- Метрики.

**Не входит:**
- ML-based pattern detection — пока detected правилами.
- Self-tuning frequency — fixed cron.

## 3. Принятые решения

1. **8 правил deterministic** — не LLM-driven detection. Дёшево + предсказуемо + audit-friendly.
2. **LLM только для wording** message'а — короткое, dignified, не алармистское.
3. **Anti-spam per user per day** — `ProactiveNotificationDedup` Redis-key `proactive:dedup:${tenantId}:${userId}:${dateLocal}` с TTL 24h.
4. **Recipient selection per rule** — каждое правило указывает target роль (decision→assignee, insight→owner FunctionalDomain, experiment→owner Experiment, etc.).
5. **Severity 3 уровня** — low (info), medium (probe-equivalent), high (urgent — bypass anti-spam? no, never bypass).
6. **Cron частота 6h** — баланс между «заметить вовремя» и «не нагружать».
7. **Запуск зависит от γ-1 доделок** (SkillTraitCategory + persona triggers паттерн) и δ-1 (Orchestrator — для deep-analysis subset).

## 4. Зависимости

- γ-1 доделки (parallel — coder в работе) — паттерн `skill-manager-digest.cron`.
- δ-1 (опц.) — для углублённого analysis (subset rules).
- α-1, α-4, β-3, β-4 (готово) — Notification, Curation, Decision, Insight.

## 5. Prisma-дельта

```prisma
model ProactiveNotification {
  id              String   @id @default(cuid())
  tenantId        String
  userId          String
  ruleType        String                       // 'decision_no_owner' | ...
  severity        String                       // 'low'|'medium'|'high'
  payloadJson     Json
  notificationId  String?                       // FK на Notification после отправки
  emittedAt       DateTime @default(now())
  dismissedAt     DateTime?

  user            User     @relation(fields: [userId], references: [id])
  tenant          Org      @relation(fields: [tenantId], references: [id])

  @@index([tenantId, userId, emittedAt])
  @@index([tenantId, ruleType, emittedAt])
}
```

## 6. Patch / миграция данных

Нет.

## 7. REST API

`/api/v1/me/proactive-notifications`:
- `GET /` — list active for user.
- `POST /:id/dismiss`.

## 8. BullMQ worker'ы и cron'ы

- `proactive-watcher.cron` — `@Cron('0 */6 * * *')`. Идемпотентность через Redis dedup-key (см. §3.3).
- 8 правил по очереди (each as separate stage with cancellation if timeout).

## 9. LlmTaskType регистрация

```ts
{ taskType: 'proactive-message-craft', priority: 'primary', provider: 'ollama', model: 'qwen3.5:9b' }
{ taskType: 'proactive-message-craft', priority: 'secondary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'proactive-message-craft', priority: 'tertiary', provider: 'openai', model: 'gpt-4o-mini' }
```

## 10. RBAC ResourceType

- `proactive_notification.read` (self — employee).
- `proactive_notification.admin` (admin — view all).

## 11. Метрики Prometheus

- `proactive_notifications_emitted_total{tenant_top, rule, severity}` counter.
- `proactive_notifications_dismissed_total{tenant_top, rule}` counter.
- `proactive_notifications_dedup_skipped_total{tenant_top}` counter (anti-spam fires).
- `proactive_watcher_duration_seconds{rule}` histogram.

## 12. Frontend

- `frontend/app/(authenticated)/me/notifications/page.tsx` (existing) — добавить вкладку «Проактивные».
- API client.
- `Remove-Item -Recurse -Force .next\types`.

## 13. ENV переменные

- `PROACTIVE_WATCHER_ENABLED: boolean (default true)`.
- `PROACTIVE_WATCHER_ANTI_SPAM_TTL_HOURS: number (default 24)`.
- `PROACTIVE_RULE_*_ENABLED: boolean` (8 шт) — каждое правило отдельным флагом.

## 14. Связь с существующим кодом

- `backend/src/modules/clones/services/skill-manager-digest.cron.ts` — паттерн.
- `backend/src/modules/conversational/services/conversational.service.ts` — sendNotification.
- `backend/src/common/redis/` — для dedup.
- schema.prisma — модели Decision, Insight, Experiment, Process, Role, Department, FunctionalDomain.

## 15. DoD

- [ ] 1 модель + cron + 8 правил.
- [ ] Anti-spam работает (тест: 2 trigger за день → 1 notification).
- [ ] LLM message-craft работает.
- [ ] Метрики.
- [ ] typecheck/lint/tests.

## 16. Тесты

- **unit:** для каждого правила (8 specs).
- **unit:** `proactive-watcher.cron.spec.ts` — anti-spam, ordering.
- **integration:** end-to-end (mock graph state → cron → notification sent).

## 17. Риски и mitigation

- **False-positive spam** — anti-spam + dismissible.
- **Cron timeout** — каждое правило 60-сек timeout, оставшиеся skip до next run.
- **`.next/types/`** — Remove-Item.
