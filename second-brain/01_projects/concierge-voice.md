---
title: Concierge + Voice (Streaming ASR)
status: in-progress
phase: gamma-2 + delta-3
covers: Concierge UI вход + Voice Streaming WebSocket (T4 финального handoff)
---

# Concierge + Voice Streaming

Concierge — главный conversational интерфейс Z/Кора. Voice — streaming-вход через `/ws/voice`. Создан 2026-05-25 в рамках финального handoff Wave 1-3 (T4 δ-3).

## Архитектурные правила (КРИТИЧНО)

1. **Concierge и AI-помощник отвечают ТОЛЬКО текстом.** Голосовой ВВОД — да (микрофон → ASR), голосовой ВЫВОД — НЕТ. См. memory `feedback_concierge_text_only_output.md`.
   - Никакой кнопки «🔊 Слушать» в Concierge.
   - Никакого `voiceMode toggle`.
   - TTS endpoint `/api/v1/voice/synthesize` существует как технический примитив, НО НЕ интегрируется в Concierge flow.
2. **Главный вход в Concierge — плавающий значок** «Кора-помощник», не Cmd+K. ЦА (прорабы, менеджеры объектов, владельцы малого бизнеса) не запоминают горячие клавиши. Cmd+K — опц. desktop shortcut, открывает то же окно. См. memory `feedback_concierge_entry_visible_button.md`.
3. **Mobile-first.** На мобиле — вкладка в bottom navigation, на десктопе — правый нижний угол.

## Voice Streaming WebSocket (T4, 2026-05-25)

### Backend — `concierge/gateways/voice-stream.gateway.ts`

Namespace `/ws/voice`. Auth: JWT cookie (`z_session`), 401 при отсутствии.

**Events client → server:**
- `voice.start { tenantId?, locale? }` — открыть сессию (создаёт VoiceSession в Map).
- `voice.chunk` (Binary `Buffer` audio) — отправить audio chunk (250ms PCM из MediaRecorder).
- `voice.end` — финализировать → запустить transcription → отдать `voice.transcribed`.
- `voice.cancel` — отменить сессию (буфер дропается, ничего не возвращается).

**Events server → client:**
- `voice.transcribed { text, durationMs, provider }` — финальный текст после ASR.
- `voice.partial { text }` — placeholder (не реализовано, заготовлено под streaming-ASR).
- `voice.error { reason, code? }` — ошибка (auth/quota/asr_failed/buffer_overflow/timeout).

### Session lifecycle

- **In-memory:** `Map<userId, VoiceSession>` в инстансе gateway.
- **1 session per user:** новое подключение убивает старое (`voice.error` со старого сокета).
- **TTL 60s:** если за 60 секунд нет `voice.end`/`voice.cancel`/`voice.chunk` — сессия дропается (`voice.error: 'timeout'`).
- **Buffer cap 5 MB:** при превышении — `voice.error: 'buffer_overflow'` и сессия дропается.

### ASR backend

- При `voice.end` → объединяем все chunk'и → `VoxAdapter.transcribe(audioBuffer, locale)`.
- **Vox / GigaAM — poll-модель** (не streaming) → задержка ≥ 2 секунды (зависит от размера буфера и нагрузки).
- **TODO:** миграция на streaming ASR (Whisper realtime / GigaAM streaming-mode). Это уберёт 2-сек задержку и позволит реально использовать `voice.partial` events.

### Метрики

- `z_voice_ws_sessions_total{tenant}` — counter открытых сессий.
- `z_voice_ws_chunks_total{tenant}` — counter принятых chunk'ов.
- `z_voice_ws_errors_total{reason}` — counter ошибок (для алертинга).

### Frontend

**Hook `src/hooks/concierge/useVoiceStream.ts`:**
- `open()` — устанавливает socket connection.
- `sendChunk(blob)` — конвертирует Blob → ArrayBuffer → emit `voice.chunk`.
- `end()` — emit `voice.end`, ждёт `voice.transcribed`.
- `cancel()` — emit `voice.cancel` + close.
- **Graceful REST fallback:** при `socket.disconnected` или `voice.error` — автоматически переключается на `POST /api/v1/voice/transcribe` (REST blob upload).

**Component `src/ui/concierge/ConciergeVoice.tsx`:**
- Кнопка-микрофон в Concierge sheet (mobile bottom-sheet) / drawer (desktop).
- MediaRecorder API → 250ms chunks → useVoiceStream.sendChunk.
- UX states: idle → recording (Square icon) → transcribing (Loader2) → idle.
- Транскрипт допишется в текстовое поле Concierge input — пользователь может отредактировать перед отправкой (важно для длинных и неточных транскрипций).

## Concierge endpoint (γ-2)

- `POST /api/v1/concierge/ask` — основной NL → tool-use endpoint. Заведён в γ-2 ранее, не трогался в T4.
- Внутри использует `concierge-parse` LLM taskType из DialogService.
- Возвращает: `{ reply: text, toolCalls?: [], undo?: {actionId, label}, citations?: [] }`.

## Файлы (создано в T4)

**Backend:**
- `backend/src/modules/concierge/gateways/voice-stream.gateway.ts` (новый)
- `backend/src/modules/concierge/services/voice-session.service.ts` (in-memory Map, при необходимости можно перенести на Redis для multi-instance)
- `backend/src/common/metrics/business-metrics.service.ts` — 3 новых метрики `z_voice_ws_*`

**Frontend:**
- `frontend/src/hooks/concierge/useVoiceStream.ts` (новый)
- `frontend/src/ui/concierge/ConciergeVoice.tsx` (новый)
- `frontend/src/ui/concierge/ConciergeFloatingButton.tsx` — интеграция кнопки voice
- `frontend/src/ui/concierge/ConciergeSheet.tsx` — интеграция voice + text input

## Связь с другими модулями

| Модуль | Связь |
|---|---|
| `dialog-layer` (α-5) | concierge-parse LLM taskType использует DialogService для контекста |
| `chat-v2` | Concierge внутри может делегировать вопрос в chat-v2 (mode='factual'/'synthetic') |
| `voice` (REST) | `POST /api/v1/voice/transcribe` — fallback при WS-проблемах |
| `tracker` | Концьерж может создавать Issue / комментировать через tool-use |

## Что отложено

- **Streaming ASR** (Whisper realtime / GigaAM streaming) — TODO для убирания 2-сек задержки.
- **`voice.partial` events** — заготовлены, но не отправляются (нужен streaming-ASR backend).
- **TTS интеграция в Concierge** — НЕ планируется (см. правило 1 выше).
- **Multi-instance backend** — voice-session.service.ts использует in-memory Map; при горизонтальном масштабировании нужно либо sticky-session, либо Redis-backed sessions.
- **Voice locale autodetect** — сейчас locale передаётся клиентом, autodetect не реализован.

## История

- **2026-05-25:** создан в рамках финального handoff Wave 1-3 (T4 δ-3). VoiceStreamGateway + useVoiceStream hook + ConciergeVoice UI.

[[../index|← index]]
