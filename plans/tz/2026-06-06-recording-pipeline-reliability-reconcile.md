---
type: tz
status: ready-to-implement
feature: recording-pipeline-reliability-reconcile
date: 2026-06-06
owner: Сергей (владелец)
relates_to:
  - plans/analysis/2026-06-06-handoff-brief-all-prod-fixes.md
  - plans/analysis/2026-06-06-deep-root-cause-analysis-prod-issues.md
  - plans/tz/2026-06-06-meeting-report-reliability-and-ui-honesty.md
---

> Анализ-источник: `deep-root-cause-analysis-prod-issues.md` §1 (A) + §0 (эмпирика двух встреч) · бриф §ТЗ-2 · Статус согласования: решения decisive (бриф), ожидает запуска реализации.
> Цель в одну строку: убрать интермиттентную **18-минутную паузу** перед стартом пост-обработки встречи — добавив **крон-сверку composite-egress через LiveKit** (pull вместо ожидания push-вебхука), чтобы пауза была ограничена сверху ≤2 мин.

---

## 1. Цель и зачем (человеческим языком)

**Что не так.** Иногда AI-отчёт встречи готов через ~50 секунд, иногда — через ~20 минут. Владельца это путало («то быстро, то висит»).

**Корень (доказан 2 встречами одного кода).** Весь старт пост-обработки (`transcribe → analyze → report → граф`) висит на приходе **одного** вебхука LiveKit `egress_ended` (готовность composite-видео). Крон-фоллбэка, который сам дотянул бы статус из LiveKit, **нет**.

| Встреча | пауза `completed → recording_ready` | итого до ai_ready |
|---|---|---|
| `01KTEAH38…` | **18 мин 22 с** 🔴 | ~20 мин |
| `01KTED9V9F…` | **1.7 с** ✅ | ~50 с |

Один код, разный результат ⇒ **интермиттентная доставка egress-вебхука** (LiveKit push-модель: ретраи + **секвенирование** — новые события не доставляются, пока старое «не обработано или не заброшено»; при рестарте backend в окне доставки «хвост» зависает). Это НЕ время финализации egress (по доке ≤30 с).

**Чем решение лучше.** Крон каждую минуту pull-ит статус composite-egress из LiveKit и, если он `EGRESS_COMPLETE`, сам запускает тот же путь, что и вебхук. Пауза ограничена сверху интервалом крона (≤2 мин вместо 18). Это переиспользует **весь готовый промоут-код** (`onCompositeEnded` + FSM-переход + `enqueueTranscribe`), а не строит новый пайплайн.

---

## 2. REALITY-CHECK (что по факту в коде на момент написания)

| Проверено | Факт | Источник |
|---|---|---|
| Единственный триггер транскрибации | `enqueueTranscribe` зовётся ТОЛЬКО из `maybePromoteMeetingToReady`, который ТОЛЬКО из `onEgressEnded` | [livekit-events.handler.ts:503](../../backend/src/modules/webhooks/livekit-events.handler.ts#L503), [:472](../../backend/src/modules/webhooks/livekit-events.handler.ts#L472), [:381-435](../../backend/src/modules/webhooks/livekit-events.handler.ts#L381-L435) |
| Reconcile-крон есть, но не для composite | `RecordingTrackReconcileCron` смотрит только `Recording.status ∈ {requested,recording}` и только TRACK-дорожки; после `room_finished` запись → `finalizing` → крон её не видит | [recording-track-reconcile.cron.ts:35-43](../../backend/src/modules/recordings/cron/recording-track-reconcile.cron.ts#L35-L43) |
| Обёртка egress-клиента | `LivekitEgressClient` умеет start/stop, **НЕ умеет `listEgress`** | [livekit-egress.client.ts:51-121](../../backend/src/modules/recordings/livekit-egress.client.ts#L51-L121) |
| SDK умеет listEgress | `listEgress(options?: {roomName?, egressId?, active?}): Promise<EgressInfo[]>` (livekit-server-sdk, installed) | `node_modules/livekit-server-sdk/dist/EgressClient.d.ts:91-95,168` |
| Промоут-код реюзабелен | `recordings.onCompositeEnded(meetingId,{url,bytes,durationSeconds})` → `tryFinalizeReady` → `{status, allReady}`; идемпотентен (guard `status !== 'ready'`) | [recordings.service.ts:638-672](../../backend/src/modules/recordings/recordings.service.ts#L638-L672), [:763-812](../../backend/src/modules/recordings/recordings.service.ts#L763-L812) |
| Где хранится composite egressId | `Recording.compositeEgressId` пишется в `markCompositeStarted` | [recordings.service.ts:724-733](../../backend/src/modules/recordings/recordings.service.ts#L724-L733); [schema.prisma:1315-1327](../../backend/prisma/schema.prisma#L1315-L1327) |
| Webhook сейчас синхронный | controller **awaits** `service.handle()` до 200; `service.handle` делает verify→dedup→`meeting_event`→`eventsHandler.handle` синхронно | [livekit-webhooks.controller.ts:41-60](../../backend/src/modules/webhooks/livekit-webhooks.controller.ts#L41-L60), [livekit-webhooks.service.ts:43-107](../../backend/src/modules/webhooks/livekit-webhooks.service.ts#L43-L107) |
| `meeting_event` пишется ДО handle | строки 85-92 — событие персистится до `eventsHandler.handle` (строка 98) | [livekit-webhooks.service.ts:84-98](../../backend/src/modules/webhooks/livekit-webhooks.service.ts#L84-L98) |
| AiQueue — опционально в handler | handler инжектит `aiQueue` опционально (`if (this.aiQueue)`); webhooks-модуль имеет доступ к meetings+recordings+ai | [livekit-events.handler.ts:501-518](../../backend/src/modules/webhooks/livekit-events.handler.ts#L501-L518) |
| Статусы | `MeetingStatus{…completed, recording_processing, recording_ready,…}`; `RecordingStatus{…recording, finalizing, ready, failed, deleted, archived}` | [schema.prisma:71-110](../../backend/prisma/schema.prisma#L71-L110) |
| ENV-флаг крона — паттерн | `RECORDING_TRACK_RECONCILE_ENABLED: zBool(true)` + геттер `recording.trackReconcileEnabled` (`resolveSync`); **интервал `@Cron` нельзя через ENV** (декоратор статичен) | [env.schema.ts:233](../../backend/src/common/config/env.schema.ts#L233), [typed-config.service.ts:1585-1597](../../backend/src/common/config/typed-config.service.ts#L1585-L1597) |
| Смежное ТЗ reliability — DONE | `meeting-report-reliability-and-ui-honesty` (6 фаз done, sergdev) покрыло 404-отчёт, гонку fast, имя спикера, задачи, ASR, честную длительность/поведение, UX-чистку, метрику block-linker. **НЕ трогало** 18-мин паузу / composite-reconcile / ack-first | [meeting-report-reliability-and-ui-honesty.md](2026-06-06-meeting-report-reliability-and-ui-honesty.md) |
| Параллельные сессии | git log 2 дня: пайплайн-пауза / egress-reconcile параллельной работой **не затронуты** | `git log --since=2d` |

**Следствие:** ядро (composite-reconcile-крон) — чистый greenfield; промоут-логику переиспользуем (вынеся в общий сервис); честный UI — маленький довесок. Это backend-фича (+ один фронт-баннер).

---

## 3. Доказательство выбора (два прохода + challenge-loop)

**Проход A (выбран).** Composite-egress reconcile-крон (pull-сверка статуса) + переиспользование промоут-кода + (вторично) ack-first вебхуки + метрика gap.
**Проход B (альтернатива).** Только ack-first: всегда быстро 200, обработку в фон/очередь, надеясь что LiveKit перестанет держать секвенс.

| Критерий (= ограничение фичи) | A: reconcile-крон | B: только ack-first |
|---|---|---|
| Гарантия верхней границы паузы | ✅ ≤ интервал крона (pull не зависит от доставки) | ✗ нет — вебхуки без гарантий доставки (док LiveKit) |
| Чинит «вебхук потерян/рестарт в окне» | ✅ да (крон догонит) | ✗ нет (если backend был мёртв — некому ack'нуть) |
| Объём | M (обёртка listEgress + крон + вынос промоута) | S, но недостаточно |
| Риск | ✅ низкий (реюз промоута, идемпотентно) | ⚠️ фоновая работа теряется при рестарте без сети-гарантии |

**Вывод.** A бьёт в корень (pull не зависит от push-доставки); B — лишь снижает вероятность секвенс-холда. Берём A как ядро, ack-first — defensive-дополнение (см. Р3), метрика gap — для замера.

**Challenge-loop:**
- *Корень, не симптом?* Да: крон делает старт пост-обработки независимым от доставки одного вебхука — чинит класс «пайплайн ждёт push». Не «ускорить вебхук».
- *Самое эффективное?* Да: переиспускаем `onCompositeEnded`+промоут (не дублируем FSM); крон по образцу готового track-reconcile. Радикальный вариант (транскрибация от per-track аудио, не дожидаясь composite — §1 анализа вариант 3) — стратегический, дороже, отложен.
- *Кода ради кода?* Нет: единственный новый код — `listEgress`-обёртка + крон + вынос уже существующего промоута в общий сервис (убирает дублирование между вебхуком и кроном).

---

## 4. Принятые решения владельца (decisive, не пересматривать)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Р1 | **Composite-egress reconcile-крон** `@Cron('*/1')`, флаг `RECORDING_COMPOSITE_RECONCILE_ENABLED` (default ON). | Pull-сверка не зависит от доставки вебхука → жёсткая верхняя граница паузы. Образец — готовый `RecordingTrackReconcileCron`. Флаг для kill-switch (риск-поведение за флагом). |
| Р2 | **Вынести промоут-логику** (`maybePromoteMeetingToReady` + faststart-enqueue) из webhook-handler в общий `MeetingFinalizationService` (webhooks-модуль). Вебхук и крон зовут её. | Без выноса крон дублировал бы FSM+enqueue — это «код ради кода». Общий сервис = один источник правды о промоуте. Webhooks-модуль уже имеет meetings+recordings+опц.AiQueue — нет нового цикла модулей. |
| Р3 | **Ack-first — вторично:** verify+dedup+`meeting_event` синхронно, `eventsHandler.handle` — в фон; + метрика gap `room_finished→egress_ended`. | Крон (Р1) — гарантия; ack-first лишь снижает шанс секвенс-холда (без гарантий). Безопасно ТОЛЬКО потому, что крон — сеть-страховка для потерянной фоновой обработки. Метрика — чтобы замерить корень на проде. |
| Р4 | **Честный UI обработки:** пока встреча не `ai_ready` — на `/result` баннер «Отчёт готовится, обычно несколько минут» + SWR-поллинг, не бесконечный скелетон. | Снимает ощущение «зависло». Минимально — реюз паттерна `MeetingPlayer` «Запись готовится». |
| Р5 | **Интервал крона фиксирован `*/1`** (не ENV). | `@Cron`-декоратор статичен (ScheduleModule не читает ENV в class-decoration — подтверждено комментарием track-крона). Управление — только флагом вкл/выкл. |

> Развилок для владельца нет. Прод-проба (вебхуки встречи `01KTEAH38…`, рестарт backend в окне) — **верификация**, не блокер: решение decisive независимо от исхода.

---

## 5. Scope

**Входит:**
1. `LivekitEgressClient.listCompositeEgress(meetingId)` — обёртка над `listEgress({roomName})`, поиск composite + маппинг статуса/файла (Р1).
2. `RecordingsService.reconcileCompositeEgress(meetingId)` — pull-сверка + реюз `onCompositeEnded` при `EGRESS_COMPLETE`; `markFailed` при `EGRESS_FAILED` (Р1).
3. `MeetingFinalizationService` (webhooks-модуль) — вынос `promoteMeetingToReady` + `enqueueFaststartIfNeeded`; handler делегирует (Р2).
4. `CompositeEgressReconcileCron` (webhooks-модуль), флаг `RECORDING_COMPOSITE_RECONCILE_ENABLED` в `env.schema.ts`+`TypedConfigService` (Р1, Р5).
5. Ack-first в `LivekitWebhooksService.handle` + метрика gap (Р3).
6. Честный UI на `/result` — баннер + поллинг (Р4).

**Не входит (с судьбой):**
- **block-linker параллелизм** (`p-limit` вместо for-loop, снижение `LINK_KNN_TOP_K`) — хвостовая perf-оптимизация, не корень 18-мин паузы. → vNext, отдельное мелкое ТЗ (анализ §1 вариант 4). Метрика block-linker уже есть (S6-02).
- **Транскрибация от per-track аудио, не дожидаясь composite** (§1 анализа вариант 3) — стратегический рефактор, отдельное ТЗ.
- Всё из реализованного `meeting-report-reliability-and-ui-honesty` (404, fast-гонка, имя, задачи, ASR, честность длительности/поведения, UX-чистка) — НЕ дублировать.

---

## 6. Контракт (что именно поменять)

### 6.1 `listCompositeEgress` (Фаза 1)
В [livekit-egress.client.ts](../../backend/src/modules/recordings/livekit-egress.client.ts) добавить (рядом со `stopEgress`):
```ts
import { EgressStatus } from 'livekit-server-sdk'; // ⚠ если НЕ реэкспортится — числовой литерал 3 (EGRESS_COMPLETE), как PARTICIPANT_KIND_STANDARD в recordings.service.ts; проверить в node_modules перед кодом

export interface CompositeEgressState {
  egressId: string;
  status: 'complete' | 'failed' | 'active'; // нормализованный
  url: string | null;
  bytes: number | null;
  durationSeconds: number | null;
}

/** Pull статуса composite-egress комнаты. null — composite-egress не найден. */
async listCompositeEgress(meetingId: string): Promise<CompositeEgressState | null> {
  const list = await this.egress.listEgress({ roomName: meetingId });
  // composite = room_composite request; берём первый (на встречу — один composite)
  const e = list.find((x) => x.request?.case === 'roomComposite') ?? list[0];
  if (!e) return null;
  const file = e.fileResults?.[0] ?? null;
  const isComplete = e.status === EgressStatus.EGRESS_COMPLETE; // = 3
  const isFailed = e.status === EgressStatus.EGRESS_FAILED;     // = 4
  return {
    egressId: e.egressId,
    status: isComplete ? 'complete' : isFailed ? 'failed' : 'active',
    url: file?.location ?? null,
    bytes: file?.size != null ? Number(file.size) : null,
    durationSeconds: file?.duration != null ? Math.round(Number(file.duration) / 1_000_000_000) : null,
  };
}
```
> ⚠ Точные имена полей `EgressInfo` (`request.case`, `fileResults`, `status`, `egressId`) **перечитать в `node_modules/livekit-server-sdk/dist/EgressClient.d.ts`** перед кодом — поведение либы проверять эмпирически (`feedback_verify_framework_behavior_empirically`).

### 6.2 `reconcileCompositeEgress` (Фаза 1)
В [recordings.service.ts](../../backend/src/modules/recordings/recordings.service.ts) добавить:
```ts
/** Pull-сверка composite-egress: если LiveKit говорит COMPLETE, а у нас ещё нет mainVideoUrl — финализируем (реюз onCompositeEnded). */
async reconcileCompositeEgress(meetingId: string): Promise<{ becameComplete: boolean; allReady: boolean; compositeBytes: number | null }> {
  const recording = await this.prisma.recording.findUnique({ where: { meetingId } });
  if (!recording || recording.mainVideoUrl || ['ready','failed','deleted','archived'].includes(recording.status)) {
    return { becameComplete: false, allReady: false, compositeBytes: null };
  }
  const state = await this.egressClient.listCompositeEgress(meetingId);
  if (!state) return { becameComplete: false, allReady: false, compositeBytes: null };
  if (state.status === 'failed') { await this.markFailed(meetingId, 'egress_failed:reconcile'); return { becameComplete:false, allReady:false, compositeBytes:null }; }
  if (state.status !== 'complete' || !state.url) return { becameComplete: false, allReady: false, compositeBytes: null };
  const res = await this.onCompositeEnded(meetingId, { url: state.url, bytes: state.bytes, durationSeconds: state.durationSeconds });
  this.logger.log({ meetingId, allReady: res.allReady }, 'reconcileCompositeEgress: composite догнан кроном');
  return { becameComplete: true, allReady: res.allReady, compositeBytes: state.bytes };
}
```

### 6.3 `MeetingFinalizationService` (Фаза 2 — вынос промоута, Р2)
Новый `backend/src/modules/webhooks/meeting-finalization.service.ts`. Перенести ТЕЛО `maybePromoteMeetingToReady` ([handler:472-526](../../backend/src/modules/webhooks/livekit-events.handler.ts#L472-L526)) и faststart-enqueue ([handler:396-417](../../backend/src/modules/webhooks/livekit-events.handler.ts#L396-L417)) сюда дословно (инжектит `MeetingsService`, `@Optional() AiQueueService`, `PrismaService`):
```ts
async promoteMeetingToReady(meetingId: string, allReady: boolean): Promise<void> { /* тело из handler:472-526 без изменений */ }
async enqueueFaststartIfNeeded(meetingId: string, compositeBytes: number | null): Promise<void> { /* тело из handler:396-417 */ }
```
Handler: `maybePromoteMeetingToReady` и faststart-блок заменить вызовами `this.finalization.*`. **Поведение не меняется** — проверить существующим [handler.spec.ts:302](../../backend/src/modules/webhooks/livekit-events.handler.spec.ts#L302).

### 6.4 `CompositeEgressReconcileCron` (Фаза 1)
Новый `backend/src/modules/webhooks/cron/composite-egress-reconcile.cron.ts` (по образцу `RecordingTrackReconcileCron`):
```ts
@Cron('*/1 * * * *', { name: 'composite-egress-reconcile' })
async sweep(): Promise<void> {
  if (!this.cfg.recording.compositeReconcileEnabled) return;
  const cutoff = new Date(Date.now() - 60_000); // дать вебхуку шанс ~60с
  const candidates = await this.prisma.recording.findMany({
    where: {
      mainVideoUrl: null,
      compositeEgressId: { not: null },
      status: { in: ['recording', 'finalizing'] },
      updatedAt: { lt: cutoff },
      meeting: { status: { in: ['completed', 'recording_processing'] } },
    },
    select: { meetingId: true },
    take: 50,
  });
  for (const rec of candidates) {
    try {
      const { becameComplete, allReady, compositeBytes } = await this.recordings.reconcileCompositeEgress(rec.meetingId);
      if (becameComplete) {
        await this.finalization.enqueueFaststartIfNeeded(rec.meetingId, compositeBytes);
        await this.finalization.promoteMeetingToReady(rec.meetingId, allReady);
      }
    } catch (err) { this.logger.warn({ meetingId: rec.meetingId, err: String(err) }, 'composite-egress-reconcile: ошибка'); }
  }
}
```
> ⚠ Перечитать: имя relation `meeting` на `Recording` и наличие `updatedAt` в схеме (`schema.prisma` Recording) — при расхождении поправить предикат.

### 6.5 ENV-флаг (Фаза 1)
[env.schema.ts](../../backend/src/common/config/env.schema.ts) рядом с `RECORDING_TRACK_RECONCILE_ENABLED`: `RECORDING_COMPOSITE_RECONCILE_ENABLED: zBool(true)`. В `TypedConfigService` геттер `recording.compositeReconcileEnabled` (зеркало `trackReconcileEnabled` через `resolveSync`).

### 6.6 Ack-first + метрика (Фаза 3, Р3)
[livekit-webhooks.service.ts:95-106](../../backend/src/modules/webhooks/livekit-webhooks.service.ts#L95-L106): после персиста `meeting_event` НЕ `await` `eventsHandler.handle` — запустить в фон (`void this.eventsHandler.handle(event).catch((err) => this.logger.error(...))`), вернуть управление сразу. Verify+dedup остаются синхронными (401/дедуп-корректность). Метрика: histogram `livekit_egress_ended_gap_seconds` — на `egress_ended` залогировать разницу `now - room_finished_at` (взять время `room_finished` из `meeting_event` или `Meeting`/`Recording`).

### 6.7 Честный UI (Фаза 4, Р4)
[MeetingResultPageReal.tsx](../../frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx): SWR результата ([:164](../../frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx#L164)) — добавить `refreshInterval`, активный пока `meeting.status` не в финальном AI-состоянии (`ai_ready`/`failed`); вместо `<MeetingResultSkeleton/>` ([:226](../../frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx#L226)) при «встреча есть, отчёта ещё нет» показать баннер «Отчёт готовится, обычно несколько минут» (русский, парные токены). Реюз тона `MeetingPlayer` «Запись готовится» ([MeetingPlayer.tsx:66-80](../../frontend/src/ui/components/meeting-result-v2/MeetingPlayer.tsx#L66-L80)).

---

## 7. Фазы и Acceptance (машинно-проверяемо)

Граф: **Фаза 1** (крон+обёртка+reconcile) зависит от **Фазы 2** (вынос промоута — крон зовёт `finalization.*`) → Ф2 раньше Ф1, либо одной волной (один автор). **Фаза 3** (ack-first) и **Фаза 4** (UI) независимы. Порядок: Ф2 → Ф1 → Ф3 → Ф4.

### Фаза 2 — Вынос промоут-логики в `MeetingFinalizationService`
Файлы: `meeting-finalization.service.ts` (new), `livekit-events.handler.ts`, модуль webhooks, `handler.spec.ts`.
**Не входит:** крон, listEgress, ack-first.
**Acceptance:** `MeetingFinalizationService` существует с `promoteMeetingToReady`/`enqueueFaststartIfNeeded`; handler делегирует (греп: в handler нет тела FSM-перехода, есть `this.finalization.promoteMeetingToReady`); существующий `handler.spec.ts` зелёный (поведение не изменилось); `bun run typecheck/lint/build` зелёные.
Закрывает: R2.

### Фаза 1 — Composite-egress reconcile-крон
Файлы: `livekit-egress.client.ts`, `recordings.service.ts`(+`.spec`), `composite-egress-reconcile.cron.ts`(new), `env.schema.ts`, `typed-config.service.ts`, модуль webhooks.
**Не входит:** ack-first, UI.
**Acceptance:**
- грепы: `listCompositeEgress` в egress-client; `reconcileCompositeEgress` в recordings.service; `@Cron('*/1 * * * *', { name: 'composite-egress-reconcile' })`; `RECORDING_COMPOSITE_RECONCILE_ENABLED` в env.schema; геттер `compositeReconcileEnabled`.
- юнит `recordings.service.spec`: `reconcileCompositeEgress` — (a) при `EGRESS_COMPLETE`+url → вызывает `onCompositeEnded`, возвращает `becameComplete:true`; (b) при `mainVideoUrl` уже задан → no-op `becameComplete:false` (идемпотентность); (c) при `EGRESS_FAILED` → `markFailed`.
- `bun run typecheck/lint/build` зелёные.
Закрывает: R1, R3(kill-switch).

### Фаза 3 — Ack-first + метрика gap
Файлы: `livekit-webhooks.service.ts`(+`.spec`), метрика (prom-client провайдер).
**Не входит:** крон, UI.
**Acceptance:** грепы: в `handle` нет `await this.eventsHandler.handle` (фон, `void`+`.catch`); verify+dedup остались до фон-запуска; метрика `livekit_egress_ended_gap_seconds` зарегистрирована и инкрементится на `egress_ended`. Юнит: невалидная подпись по-прежнему → throw (401-путь). `bun run typecheck/lint/build` зелёные.
Закрывает: R4, R5.

### Фаза 4 — Честный UI обработки
Файлы: `MeetingResultPageReal.tsx`.
**Не входит:** backend.
**Acceptance:** грепы: `refreshInterval` на SWR результата с условием по статусу; баннер «Отчёт готовится» вместо бесконечного скелетона при `meeting && !aiReady`; нет английского текста; парные токены. `bun run typecheck/lint/build` (frontend) зелёные.
Закрывает: R6.

### Фаза 5 — Прод-верификация (владелец, после выката + `можно в прод`)
**Acceptance (diag, read-only):** на искусственно «потерянном» вебхуке (или по факту) пауза `completed→recording_ready` ≤ ~2 мин; `diag chain --meeting <id>` показывает промоут от крона (лог `reconcileCompositeEgress: composite догнан кроном`), не только от вебхука; флип `RECORDING_COMPOSITE_RECONCILE_ENABLED=false` → крон молчит (kill-switch).

**Требования (EARS):**
- R1: Когда встреча в `{completed, recording_processing}` с composite-egress, не финализированным >60 с, система shall pull-ить статус из LiveKit и при `EGRESS_COMPLETE` запускать `onCompositeEnded` + промоут (не позже следующего тика крона).
- R2: Система shall иметь единый `MeetingFinalizationService` для промоута, вызываемый и вебхуком, и кроном (без дублирования FSM-логики).
- R3: Если `RECORDING_COMPOSITE_RECONCILE_ENABLED=false`, система shall не выполнять composite-сверку (kill-switch).
- R4: Когда вебхук принят и `meeting_event` записан, система shall возвращать 200 не дожидаясь `eventsHandler.handle` (фоновая обработка); при невалидной подписи — 401 (синхронно).
- R5: Система shall измерять gap `room_finished→egress_ended` метрикой `livekit_egress_ended_gap_seconds`.
- R6: Когда встреча ещё не `ai_ready`, `/result` shall показывать «Отчёт готовится…» + поллинг, не бесконечный скелетон.

---

## 8. Границы фичи
- ✅ Always: реюз `onCompositeEnded`/промоут; идемпотентность (повторный тик = no-op); флаг по образцу track-крона; русский UI.
- ⚠️ Ask first: менять FSM-переходы встречи; трогать `tryFinalizeReady`-логику allReady.
- 🚫 Never: дублировать FSM+enqueue в кроне; ослаблять верификацию подписи; `git add -A`.

## 9. Совместимость с prompt caching
Не релевантно — надёжность пайплайна, LLM-промпты не меняются.

## 10. Граничные контракты с другими ТЗ
- НЕ трогает то, что сделал `meeting-report-reliability-and-ui-honesty` (отчёт/задачи/ASR/UX-чистка). Честный UI здесь — только баннер «отчёт готовится» (processing-state), не пересекается с честностью длительности/поведения (S6-12/S5-02-UX, уже done).
- Честный UI на `/result` коснётся того же файла, что ТЗ-5 (UX отчёта) — координировать волны (не редактировать одновременно одним суб-агентом); см. relates_to.

## 11. Риски / pre-mortem (ревью-аспекты для strict-production-review-gate)
| Риск | Митигация |
|---|---|
| Крон гонится с вебхуком (оба финализируют) | `reconcileCompositeEgress` no-op если `mainVideoUrl` уже задан; `onCompositeEnded`+`tryFinalizeReady` идемпотентны (guard `status!=='ready'`); промоут проверяет текущий статус |
| Ack-first: фоновая обработка теряется при рестарте | composite — догонит крон (Р1, гарантия); track — догонит существующий track-reconcile-крон; `meeting_event` персистится ДО фона |
| `EgressStatus` enum не реэкспортится из SDK | числовой литерал `3`/`4` + комментарий (паттерн `PARTICIPANT_KIND_STANDARD`), проверить node_modules |
| Цикл модулей (recordings↔ai) | финализация+крон в webhooks-модуле (уже имеет meetings+recordings+опц.AiQueue); `@Optional()` AiQueue как в handler |
| Крон нагружает LiveKit API | `take:50`, `updatedAt < now-60s`, узкий предикат (только незавершённые composite); 1 раз/мин |
| listEgress поля `EgressInfo` отличаются от ожидаемых | перечитать `.d.ts` перед кодом; юнит с mock `listEgress` |

## 12. Idempotency / feature-flag / prod-deploy
- Новый ENV `RECORDING_COMPOSITE_RECONCILE_ENABLED` (default ON) → `docs/operations/prod-deploy-log.md` **Шаг 1**.
- Новый `@Cron('composite-egress-reconcile')` → **Шаг 12** (smoke: grep наличие крона + лог запуска после старта worker-процесса; NB cron в HTTP-процессе или worker — проверить, где ScheduleModule активен).
- Схема БД / сиды / миграции — **не меняются** (используем существующие поля `Recording`).
- Выкат: `docker compose up -d --build backend` (+ worker-процесс, если кроны там).

## 13. DoD
- `bun run typecheck` (вкл. `.spec`) / `lint` / `build` зелёные; юниты `recordings.service.spec` (reconcile a/b/c) + handler.spec (без регрессии) зелёные.
- second-brain: `01_projects/workers-queues.md` (новый крон) + `01_projects/ai-jobs.md`/профильная заметка по записи; `02_architecture/code-pitfalls.md` (грабля «пайплайн висит на одном egress-вебхуке»).
- `docs/operations/prod-deploy-log.md` Шаг 1 (ENV) + Шаг 12 (cron smoke).
- Рефлексия в `05_история/`.
- В коде: 0 `process.env.*`, 0 `prisma migrate`, 0 `new PrismaClient(`.

## Итог
_(заполнит tz-orchestrator: пауза ограничена ≤2 мин на проде? крон догоняет composite? ack-first без регрессий? метрика gap на дашборде?)_
