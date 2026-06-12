# Тайминги речи (ТЗ-3): корень, эмпирическое доказательство и лучшее решение

> Дата: 2026-06-11. Прод-Vox `vox.agent-lia.ru`, прод-кабинет `korateam.ru`.
> Доказательная база: (1) **живые пробы прод-модели Vox** (3 ASR-прогона + чтение OpenAPI), (2) код (`vox.service.ts`, `merger.ts`, `merge.worker.ts`, `transcribe.worker.ts`, `behavior-metrics-*.ts`, `schema.prisma`), (3) состязательно-проверенный research конкурентов и forced-alignment.
> Сменяет гипотезу ТЗ [2026-06-07-asr-word-timestamps-duration-behavior.md](../tz/2026-06-07-asr-word-timestamps-duration-behavior.md) и питает Ф3 [2026-06-10-bugfix-fleet-retest3.md](../tz/2026-06-10-bugfix-fleet-retest3.md) / анализ [2026-06-10-diarization-timing-rootcause.md](2026-06-10-diarization-timing-rootcause.md).

---

## 0. Вывод одной фразой (доказан эмпирически)

**Прод-модель Vox `v3_e2e_rnnt` УЖЕ возвращает посегментные (по-предложенческие) тайм-коды в `extendedResult.segments` — на ровно том же запросе, что шлёт живой конвейер (`diarizationEnabled:false`).** Тайминги не теряются у ASR — их **выбрасывает наш собственный конвейер**: `transcribe.worker` персистит только `words`, а `merge.worker` читает только `words`. Парсер `parseVoxResult` сегменты уже извлекает — их просто некуда сохранить и некому прочитать.

Поэтому «красивая транскрибация по ролям и времени друг за другом» + точные доли говорения + точная длительность достигаются **чисто backend-правкой без единого изменения в Vox/submit**: +1 колонка в БД, +1 строка персиста, развилка в merge, поправка флага в behavior-metrics. Это уровень рендера, который показывают все солидные конкуренты (Otter/Fireflies/Gong/Zoom — реплики-сегменты, не слова).

Пословные тайминги (для «караоке»-подсветки и точной нарезки клипов) Vox **не отдаёт ни при каком параметре** (проверено по OpenAPI) — это отдельный, опциональный апгрейд (Tier 1/2 ниже), не нужный для текущей задачи.

---

## 1. Где это уже обсуждалось (полный след)

| Документ | Что зафиксировано | Чего не хватало |
|---|---|---|
| `plans/tz/2026-06-06-meeting-report-reliability-and-ui-honesty.md` Ф3 | Парсер расширен на `segments[].words`; добавлен PII-safe лог `vox.no_words` | Не прочитан сырой ответ |
| `plans/tz/2026-06-07-asr-word-timestamps-duration-behavior.md` | Дерево решений (а) ключ / (б) submit-флаг / (в) смена модели; Ф2 закрыта Vox-независимым фолбэком | Решили «нужен 1 прод-проход» |
| `plans/tz/2026-06-08-agent-chain-remaining-no-golden.md` п.5 (`accdfe7b`) | **Первое** прод-чтение `vox.no_words` показало ключ `extendedResult` → парсер расширен на `extendedResult` | Не углубились в `extendedResult.segments` |
| `plans/tz/2026-06-08-meeting-upload-diarized-speaker-mapping.md` Ф0 + `backend/scripts/smoke-vox-diarization.ts` | Доказали: `diarizationEnabled:true` → `extendedResult.segments[] {start,end,speaker,text}` (секунды). Парсер `mapDiarizedSegments` | Считали, что это только для upload-пути |
| `plans/analysis/2026-06-10-diarization-timing-rootcause.md` | **Точный разбор**: алгоритм слияния корректен, нужны таймкоды; Plan B = псевдо-слово на сегмент | **Ошибочная посылка:** «per-track (`diar:false`) → segments отсутствуют» |
| `second-brain/02_architecture/code-pitfalls.md:503` | «модель `v3_e2e_rnnt` может не отдавать word-ts by design» | Не подтверждено сырым ответом |
| Реестр `second-brain/04_не-сделано/README.md` | Строка ASR word-timestamps (2026-06-06) | — |

**Что нового делает этот документ:** вместо чтения PII-safe диагностики я снял **полный сырой ответ** прод-Vox на реальном аудио в 3 конфигурациях + контракт OpenAPI. Это однозначно закрыло развилку (а/б/в) и опровергло посылку rootcause-дока.

---

## 2. Как устроено сейчас (код) и где именно теряются тайминги

Архитектура (CLAUDE.md принцип 4): **отдельная аудиодорожка на каждого участника**. Каждая транскрибируется независимо (`diarizationEnabled:false`, один спикер на дорожку). Стадия `ai.merge` переплетает реплики всех дорожек в хронологию.

Поток и точки разрыва:

1. **Submit (живой путь):** `transcribe.worker.ts:468` → `vox.submit(audio, {})` — без доп. параметров. Корректно (см. §3 — доп. параметры и не нужны).
2. **Парсер:** `vox.service.ts` `parseVoxResult` — **уже** извлекает `extendedResult.segments` в `result.segments` через `mapDiarizedSegments` ([vox.service.ts:444-448](../../backend/src/modules/ai/services/vox.service.ts#L444)). ⇒ `voxResult.segments` для живого пути **непустой прямо сейчас**.
3. **🔴 Разрыв №1 — персист.** `transcribe.worker.ts:581-589`: `trackData` сохраняет `words: (voxResult.words ?? [])`, но **НЕ сохраняет `voxResult.segments`**. Сегменты выброшены.
4. **🔴 Разрыв №2 — схема.** `TranscriptTrack` ([schema.prisma:1526](../../backend/prisma/schema.prisma#L1526)) имеет колонку `words Json`, **нет колонки `segments`** — даже если бы захотели, сохранить некуда.
5. **🔴 Разрыв №3 — потребление.** `merge.worker.ts:137-164` строит `perTrack` только из `track.words`. Слов нет → фолбэк **одно псевдо-слово на ВСЮ дорожку** (`startMs:0 … endMs: длительность`). 3 дорожки → 3 turn'а, каждый «звучит» все ~44 мин и полностью накладывается → абсурд «всего речи 130 мин / перекрёст 128 мин» (rootcause-док §1).
6. **Алгоритм слияния `mergeWordTimestamps` ([merger.ts:58](../../backend/src/modules/ai/services/merger.ts#L58)) — КОРРЕКТЕН** (offset входа спикера → абсолютное время → сортировка → нарезка по смене спикера/паузе >1.5с). Ему нужно лишь скормить таймкоды на уровне слов **или сегментов**.
7. **behavior-metrics:** калькулятор ([behavior-metrics-calculator.ts](../../backend/src/modules/ai/services/behavior-metrics-calculator.ts)) считает union/crosstalk/доли **по сегментам** и построен именно под per-segment вход (комментарий :308). Флаг `wordTimingsAvailable` ([behavior-metrics.worker.ts:153](../../backend/src/modules/ai/workers/behavior-metrics.worker.ts#L153)) меряет **только `track.words`** → с сегментным фиксом ложно даст `lowConfidence`.
8. **Фронт:** `Transcript.turns` рендерится лентой реплик (`MeetingResultPageReal`/`structured-report`). Как только merge выдаст реальные переплетённые turns — лента **автоматически** станет «по ролям и времени». UI-правок для базовой задачи не требуется.

**Диагностический слепой пятак (важно):** лог `vox.no_words` ([vox.service.ts:243](../../backend/src/modules/ai/services/vox.service.ts#L243)) проверяет `ro.segments ?? nestedRo.segments` (top-level / `result`), но сегменты лежат в `ro.extendedResult.segments` — поэтому он писал `hasSegments:false`. Отсюда вывод прошлых сессий «сегментов нет». (`extendedResultKeys` он логирует, но в них не вглядывались.)

---

## 3. Эмпирическое доказательство (живые пробы прод-Vox)

Инструмент: throwaway-probe + чтение OpenAPI. Аудио: реальный звонок 4:51 (`5c3c05f…mp3`).

### 3.1 Контракт submit (OpenAPI `vox.agent-lia.ru/api/docs-json`)
`CreateTaskDto` — **полный** список параметров: `file`/`audioUrl`, `model` (`v2_ctc｜v2_rnnt｜v3_ctc｜v3_rnnt｜v3_e2e_ctc｜v3_e2e_rnnt`), `punctuationMode` (`basic｜pro`), `diarizationEnabled` (bool), `speakerMode` (`fixed_2｜auto`), `numSpeakers`, `maxSpeakers`.
👉 **Параметра «пословные тайминги» (`word_timestamps`/`responseFormat`/…) НЕ существует.** Развилка (б) из ТЗ-2026-06-07 — мёртвая: API его не предоставляет.

### 3.2 Три прогона
| Прогон | Параметры | Результат |
|---|---|---|
| **plain (прод-путь!)** | `model=v3_e2e_rnnt`, `diarizationEnabled:false` | `extendedResult.segments` = **55 сегментов** `{start,end,text,speaker,speaker_id}` в секундах. `diarization.enabled:false`. `words` — нет. |
| diar | `v3_e2e_rnnt`, `diarizationEnabled:true` | 73 сегмента того же формата. |
| CTC | `v3_e2e_ctc`, `diarizationEnabled:false` | 55 сегментов того же формата. `words` — нет. |

Форма ответа (живой путь, `diar:false`):
```json
extendedResult: {
  raw_text, segments, variants, diarization, speaker_text, stage_timing,
  role_labeling, merged_segments, normalized_text, speaker_text_with_timestamps
}
segments[i] = {"start":285.034,"end":290.942,"text":"конечно, спасибо. Угу. ...","speaker":"SPEAKER 1","speaker_id":1}
```
Сегменты — **предложенческого уровня, с точными секундами**, ровно «реплика за репликой». Есть и готовая строка `speaker_text_with_timestamps`: `[00:02.146 - 04:50.942] SPEAKER 1: …`.

### 3.3 Что это доказывает
- **(а) тайминги есть — на уровне сегментов, под `extendedResult.segments`, БЕЗ изменения submit.** Подтверждено на точной прод-модели и точных прод-параметрах. → **Plan B реализуем сразу.**
- **(б) submit-флаг пословных таймингов невозможен** — его нет в API.
- **(в) словные тайминги от Vox недоступны** на текущем endpoint (ни `words`, ни `segments[].words` ни в одном режиме). Нужны — только через изменение Vox-сервера или внешний шаг (Tier 1/2).
- Кодек/контент роли не играют: сегментацию делает серверный VAD Vox независимо от источника; per-track ogg даст те же сегменты (подтвердить на прод-встрече при приёмке).

---

## 4. Как делают конкуренты (валидирует подход и целевой UX)

Состязательно проверенный research (полные источники — в выводе workflow). Сжатие:

**Наш per-track через LiveKit = «perfect diarization» (термин Recall.ai) — верхний «лучший» класс атрибуции.** Изолированный поток на участника позволяет приписывать речь напрямую **без диаризации по голосу, даже при наложении**. Только **3 из 11** продуктов в этом классе: **Zoom (раздельные дорожки M4A), MS Teams (нативные speaker-события), Gong-стерео**. Остальные 8 (Otter, Fireflies, Fathom, tl;dv, Read.ai, Google Meet-боты, Granola, Gong-моно) диаризуют общий микс по голосу и признают 11–13% ошибки из-за наложения речи — то, чего у нас нет by design. Gong прямо: стерео-каналы «не делим дальше», к диаризации прибегаем только для моно.

**Целевой рендер у всех — блок реплики (utterance), не слова:** аватар/цвет спикера + имя + кликабельный таймкод; подряд идущие реплики одного спикера группируются без повторной «шапки». **Сегментный уровень — это и есть индустриальный стандарт показа.** Пословная «караоке»-подсветка — премиум-надстройка (Otter/Mux), не базовая.

UX-практики, релевантные нашему `Vidstack`-плееру (на будущую UI-полировку, не на базовую задачу):
- клик по реплике → `remote.seek(startSec)`; подсветка активной строки + авто-скролл;
- **антипаттерн:** хранить `currentTime` в React-state (перерисовка на каждом `timeupdate`, >400мс/тик) — подсветку красить через `ref` вне рендера (<1мс) [metaview.ai];
- полоса говорения дорожка-на-участника (у нас почти бесплатна), доли % и длительность считаем **точно из интервалов**, а не оцениваем;
- overlap/паузы — наш дифференциатор: per-track позволяет честно показать одновременную речь и сворачивать паузы;
- виртуализация ленты + собственный поиск (виртуализация ломает нативный Ctrl+F).

Вывод: наш подход — топ-класс, нам не хватало ровно одного — **отдать таймкоды из дорожки**, и они уже есть на сегментном уровне.

---

## 5. Лучшее решение (доказанное), тремя слоями

### 🟢 Tier 0 — СЕЙЧАС: посегментные тайминги (backend-only, без Vox)
Доставляет всю поставленную задачу. Доказано: §3 (сегменты приходят) + §2 (парсер их извлекает; теряют персист+мердж).

**Что менять (точечно):**
1. **Схема** `TranscriptTrack` ([schema.prisma:1526](../../backend/prisma/schema.prisma#L1526)): добавить `segments Json?` — `Array<{ startSec:number; endSec:number; text:string }>`. Версионируемая миграция `prisma:migrate --name transcript_track_segments` (skill `prisma-db-push-rules`).
2. **Персист** `transcribe.worker.ts:581`: в `trackData` добавить
   `segments: (voxResult.segments ?? []).map(s => ({ startSec: s.startSec, endSec: s.endSec, text: s.text }))` (speaker_id не нужен — спикер известен по дорожке).
3. **Мердж** `merge.worker.ts:137-164` — приоритет источников при сборке `perTrack`:
   - `track.words.length>0` → как сейчас (готовность к Tier 1);
   - **иначе `track.segments.length>0` → одно псевдо-слово НА КАЖДЫЙ СЕГМЕНТ:** `{ word: seg.text, startMs: round(seg.startSec*1000), endMs: round(seg.endSec*1000) }`;
   - иначе `transcriptText` → текущий фолбэк «одно псевдо-слово на дорожку» (последний резерв);
   - иначе пусто.
   `mergeWordTimestamps` переплетёт по абсолютному времени → реальные turns по ролям. (Бонус: сегменты одного спикера с gap<1.5с склеятся в один turn — группировка предложений, как у конкурентов.)
4. **behavior-metrics** `behavior-metrics.worker.ts`: в select (:104) добавить `segments: true`; флаг (:153) →
   `timingsAvailable = tracks.some(t => (words?.length>0) || (segments?.length>0))`. С сегментами `lowConfidence` больше не выставляется ложно; union/crosstalk/доли становятся реальными (абсурд «130 мин» уходит сам).
5. **(полировка)** Поправить слепое пятно лога `vox.no_words` — проверять и `extendedResult.segments`; либо понизить до DEBUG (после фикса он почти не нужен). Убрать строку из реестра «не-сделано».

**Объём:** ~1 миграция + 4 точечные правки + тесты `merger.spec`/`behavior-metrics-*.spec`. Прод: только миграция (авто на `up`) + рестарт backend. Без новых ENV, зависимостей, Python.

### 🟡 Tier 1 — апгрейд до пословных таймингов (silent, без правок нашего кода)
Запросить у владельцев Vox (`agent-lia`) отдать пословные тайминги в ответе. Технически дёшево на их стороне: модель — GigaAM-v3 (RNNT хранит индекс кадра энкодера на токен; NeMo `compute_timestamps:true`/`preserve_alignments:true` или GigaAM `word_timestamps=True` из GitHub `main`) — тайминги уже считаются и **отбрасываются на сервере**. Наш парсер `parseVoxResult` **уже** поддерживает `words[]` и `segments[].words` → как только Vox начнёт их слать, мы получим word-level **без единой правки backend**. Даёт «караоке»-подсветку и точную нарезку клипов. Опционально, не блокирует Tier 0.

> ⚠️ Состязательная поправка: word-level в апстрим-GigaAM — это ещё не влитый PR #51 (релиз ~апрель 2026), а на самом Vox-endpoint его сейчас нет (§3.1). Не закладывать как «уже доступно» — это запрос к agent-lia с проверкой версии.

### 🟠 Tier 2 — пословные без участия Vox (контингентный план)
Если word-level нужен, а agent-lia не добавит: **sherpa-onnx + GigaAM-CTC** (Apache-2.0, Node-addon, родной русский) как `infra/*`-микросервис или native-воркер — перераспознаёт per-track дорожку с token-level таймингами (пословные — группировкой токенов). Это «распознавание сразу с таймингами», а не forced alignment.
- ⚠️ Лицензия **весов** GigaAM — у Сбера отдельные условия (код sherpa-onnx — Apache-2; веса проверить до выбора).
- **Echogarden — GPL-3** → только как изолированный сервис в `infra/*`, не линковать в `backend/`; на русском DTW «плывёт» — не предпочтителен.
- MFA/aeneas/gentle/whisper-timestamped — Python/Kaldi, только `infra/*`, для русского хуже GigaAM. Не брать.
Истинный forced alignment (выровнять именно текст-от-Vox) нужен лишь если обязаны сохранить дословный текст Vox — иначе перераспознавание чище (текст и время из одной модели).

**Рекомендация:** делать **Tier 0** (закрывает задачу, доказано), параллельно — низкоусилийный запрос **Tier 1** к agent-lia. Tier 2 — только если Tier 1 не выйдет и понадобится «караоке».

---

## 6. Приёмка (как проверить, что стало «красиво»)
1. Свежая прод-встреча >1 мин, ≥2 говорящих → вкладка «Транскрипт»: реплики **переплетены** «Спикер A (0:10) → Спикер B (0:25) → A (0:40)», много turn'ов (не «3 реплики»).
2. «Поведение участников»: «всего речи» ≈ длительности встречи (а не сумме дорожек), перекрёст в разумных пределах, доли в сумме ~100%, нет плашки «качество диаризации низкое».
3. `Transcript.totalDurationSeconds` ≈ фактической; в логах нет `vox.no_words` на встречах с речью.
4. Юнит: `merger.spec` — сегментный вход → N turns по времени; `behavior-metrics` — реальные union/crosstalk; `timingsAvailable=true` при наличии segments.

---

## 7. Поправки к прошлым артефактам
- **rootcause-док 2026-06-10 §3.3 / §6:** посылка «per-track (`diar:false`) → segments отсутствуют» — **опровергнута эмпирически** (§3.2 plain). Сегменты приходят без диаризации; Plan B реализуем без `diarizationEnabled:true`.
- **ТЗ 2026-06-07 / code-pitfalls:** развилка (б) submit-флаг — невозможна (нет в API); (в) «модель не отдаёт word-ts» — **верно для word-level, но сегментные она отдаёт**. Обновить заметку pitfalls.
- **Реестр «не-сделано»:** строку ASR word-timestamps переформулировать в «сегментные тайминги — есть, нужен персист+мердж (Tier 0)».

---

## Приложение. Throwaway-артефакт
`backend/scripts/_throwaway-vox-probe.ts` — разовый зонд (discover/whitelist/run). После фиксации результатов в этом документе **удалить** (не коммитить).
