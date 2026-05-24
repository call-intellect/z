# Tracker (Phase 1 — Sprint 1)

PLG-точка входа платформы Z/Кора. Расширяет legacy `tasks/` до полноценного
трекера задач с проектами, циклами, intake, labels, webhook-ами.
Каждая мутация → запись в `IssueActivity`. В Sprint 3 трекер становится
источником для второго мозга (TrackerAdapter → `RawEvent` →
knowledge-core pipeline).

## REST API (5 групп)

| Группа | Endpoints | RBAC ResourceType |
|---|---|---|
| Projects | `/api/v1/projects` + `/projects/:id/members` | `project` |
| Issues | `/api/v1/projects/:projectId/issues` + `/issues/:id` (transitions / assignees / labels / subscribe / link-goal / activity / versions) | `issue` |
| Cycles | `/api/v1/projects/:projectId/cycles` + `/cycles/:id` (`/complete` auto-rollover) | `cycle` |
| Intake | `/api/v1/intake` + `/intake/:id/triage` | `intake_issue` |
| Comments | `/api/v1/issues/:id/comments` + `/comments/:commentId` | `issue` (write) |
| Labels | `/api/v1/labels` | `project` (write) |
| Webhooks | `/api/v1/tracker/webhooks` + `/test` + `/logs` | `issue_webhook` |
| Team Templates | `/api/v1/team-templates` (read-only Phase 1) | `team_template` |

## Принцип «трекер = источник для второго мозга»

Каждое событие трекера (issue.created / status_changed / commented /
cycle.completed / …) должно эмититься в `tracker.event_occurred` через
`@nestjs/event-emitter`. `TrackerAdapter` (Sprint 3, `modules/ingest/adapters/tracker/`)
ловит эти события и создаёт `RawEvent` с `signalType` из 8 новых task_*
типов (Sprint 1 B2-1.2). Дальше — стандартный knowledge-core pipeline:
RawEvent → Block → Entity → EntityLink → Theme. См.:
- `plans/tz/2026-05-23-tracker-phase-1-models-api.md` (§ Ingest)
- `plans/analysis/2026-05-23-tracker-as-entry-wedge.md`

## Что НЕ реализовано в Sprint 1 (по плану)

- WebSocket events (`issue.created` / `cycle.progress_updated` / ...) — Sprint 2.
- `Idempotency-Key` middleware на POST /issues, /comments, /intake — Sprint 2
  (общего IdempotencyService пока нет; Crossmark-specific не подходит).
- BullMQ-доставка webhook-ов с HMAC-подписью и retry exponential backoff —
  Sprint 2 (B1-2.2). `POST /webhooks/:id/test` сейчас делает синхронный fetch
  с timeout 5s без записи в `IssueWebhookLog`.
- Multipart upload `POST /issues/:id/attachments` — Sprint 2 (S3 binding).
- `POST /issues/:id/start-meeting` (LiveKit-интеграция) — Sprint 2.
- `IssueRelation` CRUD (`/issues/:id/relations`) — Sprint 2.
- TrackerAdapter (ingest в knowledge-core) — Sprint 3.
- Migration legacy Task → Issue — Sprint 3.
- Seed системных TeamTemplate (10–15 команд) + `POST /projects/from-template` —
  Sprint 9 (Phase 4). Сейчас endpoint возвращает 501.

## Документация

- Sub-ТЗ Phase 1: `plans/tz/2026-05-23-tracker-phase-1-models-api.md`
- Sprint Plan: `plans/sprints/2026-05-24-sprint-plan-wave-1.md` тикеты B1-1.3 / B1-1.4
- Analysis: `plans/analysis/2026-05-23-tracker-as-entry-wedge.md`
