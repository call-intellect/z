---
type: reflection
date: 2026-07-09
topic: Инцидент — зависшая встреча + фикс подписочного гейта на live-контролах
---

# Зависшая встреча «планерка» + фикс подписочного гейта

## Что было поставлено
Владелец проводил видеовстречу (org svmazur@mail.ru), кнопка «Завершить» падала с ошибкой
`Не передан заголовок X-Org-Id... Невозможно определить организацию для проверки подписки`.
Встреча висела `active` → не запускалась цепочка сохранение→транскрибация→отчёт. Две задачи:
(1) добить конкретную встречу скриптом, сохранив запись и всю цепочку; (2) починить причину кодом,
новая ветка work + сегодняшняя дата, commit + push.

## Как решал
**Диагноз (read-only через diag.ts + чтение кода):**
- Встреча `01KX2YXTCNK7MKNR1138S7XANY`: `room_started` 08:11:58 → active, `egress_started: composite`
  08:11:59 (`EG_tua2KmXYN9fZ`, `meetings/.../composite.mp4`, retention 30д) — **запись шла**. Дальше тишина:
  `room_finished`/`egress_ended` не пришли.
- Ошибка — [subscription.guard.ts](../../backend/src/modules/billing/guards/subscription.guard.ts):
  ветка `tenant_required` (пустой `req.tenantId`). `tenantId` ставит
  [tenant.middleware.ts](../../backend/src/modules/rbac/middleware/tenant.middleware.ts) из `X-Org-Id`.
- FE [finish()](../../frontend/src/api/meetings.api.ts) не шлёт явный `X-Org-Id` — полагается на
  `defaultOrgId` из auth-context, а комната встречи живёт вне этого контекста → заголовок пуст → 403 ДО
  `deleteRoom` → комната LiveKit не удаляется → вебхуки не приходят.
- `finish()` для active НЕ двигает FSM сам — только `livekit.deleteRoom()` + событие; FSM едет от вебхука
  `room_finished` → `completed`, а транскрибация — от `egress_ended` → `promoteMeetingToReady` →
  `enqueueTranscribe`.
- idle-крон ([idle-meeting.cron.ts](../../backend/src/modules/meetings/cron/idle-meeting.cron.ts)) не добил:
  удаляет комнату только если в ней НЕТ участников, а egress-рекордер/вкладка держат её «непустой».

**Починка встречи:** штатный admin `POST /admin/api/v1/meetings/:id/force-finish`
([meetings-admin.controller.ts](../../backend/src/modules/admin/meetings-admin.controller.ts)) — удаляет комнату,
ждёт вебхук, при молчании сам ставит `completed`; egress-цепочка едет независимо. Написал ops-скрипт
`backend/scripts/force-finish-meeting.ts` (логин админом как diag.ts → POST). Прогнал → `{ok:true,status:"completed"}`
→ трейс показал переход в `transcription_processing` (запись сохранена, цепочка поехала).

**Фикс кода:** снял `@RequireSubscription` с 7 live-контролов: `finish`/`mute`/`unmute`/`kick`/`lower-hand`
(meetings.controller) + `recording start|stop` (recordings.controller). `create` под гейтом остался.

## Что вышло
- Встреча добита, запись сохранена, транскрибация запущена (без ошибок в следе).
- typecheck зелёный, lint 0 ошибок, subscription.guard.spec 25/25.
- Ветка `work/2026-07-09-meeting-finish-gate`, коммит `254186aa`, запушено.
- Prod-операций нет (чистое снятие декораторов) — нужен только пересбор образа backend при выкате.

## Чему научился
- **Инвариант:** подписка гейтит СОЗДАНИЕ ресурса, не управление/завершение уже идущего. Гейт на
  lifecycle-контролах = встреча зависает + запись/отчёт теряются (тихо, ошибок в логах нет).
- **Ловушка:** любой `@RequireSubscription`-эндпоинт, вызываемый из комнаты встречи (без org-контекста),
  падает `tenant_required`. Проверять при добавлении гейта: откуда зовётся ручка — из authenticated-app
  (org есть) или из meeting-room (org нет).
- **Молчаливая деградация:** `finish` падал на гварде до бизнес-логики, в логах встречи — ноль ошибок;
  зависание видно только по статусу `active` дольше idle-таймаута + сверке с картой функционала.
- **Диагностика после видео:** `diag.ts trace/chain --json` по meetingId даёт полный технический след
  (room_started/egress/recording) — этого хватило, чтобы доказать «запись шла» без SSH к проду.
