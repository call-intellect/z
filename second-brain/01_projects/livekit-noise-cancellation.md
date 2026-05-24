---
type: project
---

# LiveKit — шумоподавление микрофона

Sprint 1 (2026-05-24). Решение владельца №5 из чек-листа волны 1.

## Что включено

**Browser-уровень noise suppression** через `AudioCaptureOptions`:
- `noiseSuppression: true` — шумодав браузера (Chrome/Edge/Safari внутри используют RNNoise-подобные алгоритмы; Firefox — собственный).
- `echoCancellation: true` — подавление акустического эха.
- `autoGainControl: true` — автоматический уровень громкости.

Это работает «из коробки» во всех современных браузерах, без установки новых зависимостей. Включено **по умолчанию**.

## Где код

- Конфиг и хелперы: `frontend/src/lib/livekit/noise-suppression.ts`
  - `getNoiseSuppressionEnabled()` / `setNoiseSuppressionEnabled()` — чтение/запись `localStorage` (ключ `kora_noise_suppression_enabled`).
  - `buildAudioCaptureOptions(enabled)` — собирает `AudioCaptureOptions` для LiveKit.
- Применение в комнате: `frontend/src/ui/components/meeting-room/MeetingRoom.tsx` — передаёт результат в `<LiveKitRoom audio={...} />`.
- UI-переключатель: `frontend/src/ui/components/lobby/GuestNameForm.tsx` (Pre-Join гостя).
- i18n: `frontend/src/lib/i18n/ru.ts` — ключи `lobby.noise_suppression_label` / `lobby.noise_suppression_hint`.

## Как пользователь отключает

Гость — в Lobby (Pre-Join) есть чекбокс «Шумоподавление микрофона», по умолчанию включён. Изменение сохраняется в `localStorage` и применяется при создании LocalAudioTrack.

Хост (авто-join без Pre-Join) — на Sprint 1 переключателя в UI нет (TODO ниже). Настройка читается из того же `localStorage` — то есть если хост менял её ранее (в любой встрече как гость), значение применится.

## Почему не Krisp и не RNNoise WASM

- **Krisp** (`@livekit/krisp-noise-filter`) — коммерческий, требует подписку LiveKit Cloud. У нас self-hosted.
- **RNNoise WASM через AudioWorklet + `track.setProcessor(...)`** — самый качественный путь для self-hosted, но требует:
  1. Найти или собрать WASM-бандл RNNoise.
  2. Написать `TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>` (см. `@livekit/track-processors` README — у них есть `GainAudioProcessor` как reference, но готового RNNoise нет).
  3. Решить вопрос с CSP и cross-origin для AudioWorklet.

  Это отдельный Sprint 2+ ticket — отложили, чтобы не блокировать волну 1.

## TODO

- [ ] **Sprint 2+:** хост-переключатель в Settings или прямо в комнате (ControlsBar). Внимание: смена on/off в работающей комнате потребует пересоздать LocalAudioTrack (`room.localParticipant.setMicrophoneEnabled(false)` → `setMicrophoneEnabled(true, audioCaptureOptions)`).
- [ ] **Sprint 2+:** мигрировать на RNNoise WASM через `TrackProcessor` — единое качество шумоподавления независимо от браузера, готовность к замене на Krisp если перейдём на LiveKit Cloud.
- [ ] **Sprint 2+:** телеметрия — логировать, какая доля сессий идёт с включённым/выключенным шумоподавлением (метрика `prom-client`).
