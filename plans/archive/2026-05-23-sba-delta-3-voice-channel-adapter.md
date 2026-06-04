---
type: tz
status: partial
feature: δ-3 — VoiceChannelAdapter (voice inbound через все каналы → ASR → текст; outbound через TTS → mp3)
phase: delta-3
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §δ-3
  - plans/tz/2026-05-22-final-roadmap.md §δ-3
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 100%.**
> Реализовано полностью: ASR REST, TTS REST, VoiceChannelAdapter, RBAC, ENV, 4 метрики, фронт voice.api+ConciergeVoice, и единственный «отложенный» пункт (WebSocket-голосовой ввод в Concierge, /ws/voice) тоже доделан и про
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# SBA δ-3 — VoiceChannelAdapter (inbound + outbound)

## 1. Цель и контекст

ASR (Vox+GigaAM) уже работает для встреч. β-1 добавит voice inbound для Telegram/MAX (через ASR pipeline). Этот sub-ТЗ — общий VoiceAdapter поверх всех каналов + TTS outbound + concierge voice через MediaRecorder+WebSocket.

## 2. Scope

**Входит:**
- `VoiceChannelAdapter` сервис — единый интерфейс для voice handling.
- Inbound: shared pipeline (Telegram/MAX voice file → download → ASR → text). β-1 использует.
- Outbound TTS: `TtsService` — text → mp3 file → outbound через canal как audio attachment.
- Concierge voice через MediaRecorder в браузере + WebSocket к backend → ASR → DialogService → response (мб TTS обратно).
- 1 LlmTaskType если нужен (probably no).
- 1 ENV — TTS provider config.
- Метрики ASR/TTS duration, cost.

## 3. Принятые решения

1. **TTS provider** — Yandex SpeechKit (uniform with ASR) ИЛИ OpenAI TTS. Default OpenAI TTS (multi-language out of box).
2. **mp3 output** — universal.
3. **WebSocket voice — concierge only.** Другие каналы — file upload (existing Telegram/MAX adapters).
4. **VoiceAdapter — не отдельная implementation IChannel**, а helper переиспользуется в Telegram/MAX/web concierge.
5. **ASR billing** — учитывать длительность в AiUsageLog.

## 4. Зависимости

- β-1 (parallel) — Telegram/MAX voice inbound.
- ASR (готово).
- γ-2 (опц.) — concierge voice.

## 5. Prisma-дельта

Нет.

## 6. Patch / миграция данных

Нет.

## 7. REST API

`/api/v1/voice/transcribe` (TenantGuard): POST multipart audio → text.
`/api/v1/voice/synthesize` (TenantGuard): POST `{ text, voice? }` → mp3 stream.

`/api/v1/concierge/voice` (WebSocket): real-time voice ↔ text.

## 8. BullMQ worker'ы и cron'ы

Нет новых (TTS — sync, ASR существует).

## 9. LlmTaskType регистрация

Нет (TTS — provider direct, не через LlmRouter).

## 10. RBAC ResourceType

- `voice.transcribe` (employee).
- `voice.synthesize` (employee).

## 11. Метрики Prometheus

- `voice_asr_requests_total{tenant_top, provider}` counter.
- `voice_asr_duration_seconds{provider}` histogram.
- `voice_tts_requests_total{tenant_top, provider}` counter.
- `voice_tts_chars_total{tenant_top}` counter (для cost-tracking).

## 12. Frontend

- `frontend/src/ui/concierge/ConciergeVoice.tsx` — MediaRecorder + WS handler.
- API client extension `voice.api.ts`.
- `Remove-Item -Recurse -Force .next\types`.

## 13. ENV переменные

- `TTS_PROVIDER: 'openai' | 'yandex' (default 'openai')`.
- `TTS_VOICE: string (default 'alloy')` (для OpenAI).
- `VOICE_WS_ENABLED: boolean (default true)`.

## 14. Связь с существующим кодом

- `backend/src/modules/ai/services/asr/` — существующий ASR pipeline.
- `backend/src/modules/conversational/adapters/telegram-bot/` и `max-bot/` — β-1 уже добавляет voice inbound.
- `backend/src/modules/concierge/` (γ-2) — для voice intent.

## 15. DoD

- [x] VoiceChannelAdapter сервис.
- [x] TTS service + REST endpoints.
- [ ] Concierge voice WS работает.  <!-- REST /voice/transcribe + /synthesize реализованы; WebSocket для concierge не вписан (см. shipping-report TODO #6) -->
- [x] Метрики.
- [x] typecheck/lint/tests.

## 16. Тесты

- **unit:** `voice-channel-adapter.service.spec.ts`.
- **unit:** `tts.service.spec.ts`.
- **integration:** WS voice flow.

## 17. Риски и mitigation

- **TTS cost** — short messages only (<500 chars), reject longer.
- **WS connection drops** — auto-reconnect client.
- **`.next/types/`** — Remove-Item.

## Ревизия от 2026-05-24

**Статус:** partial
**Реализовано:**
- `VoiceModule` (`backend/src/modules/voice/`): `VoiceChannelAdapter`, `TtsService` (OpenAI primary), `VoiceController` с `/voice/transcribe` + `/voice/synthesize`.
- Spec'и: `tts.service.spec.ts` + `voice-channel-adapter.service.spec.ts`.
- Frontend: `voice.api.ts` + `ConciergeVoice.tsx` (MediaRecorder с серверным ASR через voiceApi.transcribe — file upload паттерн, не WS).
- RBAC `voice.transcribe`/`voice.synthesize` в policy.csv.

**Осталось:**
- WebSocket endpoint `/api/v1/concierge/voice` для real-time voice ВВОДА → text. По shipping-report §5 TODO #6 — оставлено в backlog. ConciergeVoice фронт использует file-upload вместо WS, что покрывает MVP но даёт задержку 15-18 сек.

> **⚠ Уточнение от 2026-05-24 (владелец):** Concierge / AI-помощник отвечает ТОЛЬКО текстом. Голосовой ВЫВОД (TTS в ответах Concierge, кнопка «🔊 Слушать», `voiceMode` toggle) — **из scope исключён**. Остаётся ТОЛЬКО WebSocket-стриминг голосового ВВОДА (микрофон → real-time ASR → текст в чат). TTS-endpoint `/voice/synthesize` остаётся как технический backend для будущих сценариев accessibility, но в Concierge flow НЕ интегрируется.
