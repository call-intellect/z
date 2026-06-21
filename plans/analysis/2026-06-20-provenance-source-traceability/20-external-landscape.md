---
type: analysis
status: research-input
feature: provenance-source-traceability
date: 2026-06-20
snapshot_date: 2026-06-20
part: external-landscape
related:
  - 99-synthesis.md
---

# Внешний ландшафт: как лучшие показывают «откуда это»

Метки достоверности: **verified** (первоисточник/доки/репо) · **claimed** (вендор о себе) · **inferred** (вывод). Снимок — 2026-06-20.

## 1. Citation-UX в AI-ответах — зарубеж (E1)

**Паттерн 1 — нумерованная inline-сноска + строка карточек источников (Perplexity).** Надстрочный номер сразу за утверждением (не в конце абзаца) = один retrieved-источник; hover→подсветка карточки; карточка несёт favicon+домен+excerpt; клик→первоисточник. Двухслойность (progressive disclosure): компактный номер + раскрываемый список. *verified* ([aiuxplayground](https://www.aiuxplayground.com/gallery/perplexity-citations/), [shapeof.ai](https://www.shapeof.ai/patterns/citations)).

**Паттерн 2 — deep-link к точному пассажу с подсветкой в оригинале (Glean, Microsoft 365 Copilot «Deep citations», Adobe Acrobat).** Центральный паттерн «откуда»: не «вот документ», а «вот эта строка». Glean: hover-preview подсвечивает процитированный текст + контекст без открытия; deep-link к пассажу, к слайду, к номеру страницы; preview перед переходом. **Инвариант доступа Glean: «Citations never grant new access»** — цитата уважает права; нет прав на документ → нельзя открыть. **Honesty-граница: если ответ из pre-trained знаний без поиска по корпусу — цитат нет вообще** (явный сигнал «это не из вашей базы»). Acrobat: клик по номеру→подсветка прямоугольника прямо в PDF, скролл к параграфу. *verified* ([docs.glean.com](https://docs.glean.com/user-guide/assistant/glean-chat/glean-chat-citations/glean-citations), [m365admin](https://m365admin.handsontek.net/microsoft-copilot-microsoft-365-deep-citations-copilot/), [adobe](https://helpx.adobe.com/acrobat/using/ai-generated-summaries.html)).

**Паттерн 3 — прямая цитата/парафраз за каждым пунктом (Granola, Adobe outline).** За каждым пунктом саммари — дословная опора; видно фабрикацию по несовпадению цитаты с текстом. *verified*.

**Паттерн 4 — источник-как-навигация по рабочему пространству (Notion AI Q&A).** Цитата = точка входа в первоисточник внутри той же системы; «проверить»=«открыть и дочитать», нулевое трение. Тот же инвариант доступа. *verified/claimed* ([notion](https://www.notion.com/blog/introducing-q-and-a)).

**Паттерн 5 — индикатор уверенности + reason-label + escape-hatch + «не знаю» (Confidence UI).** Категориальные бакеты High/Medium/Low вместо сырых %; coverage «Based on 3 sources» (число опор, не процент); reason-label («Conflicting sources», «Outdated data»); escape-hatch рядом с предупреждением («warning without an action is just anxiety»); «не знаю» как первоклассное поведение. *claimed/inferred* ([Modexa](https://medium.com/@Modexa/the-confidence-ui-pattern-that-users-actually-trust-ff27e1a8a956), [Amestris](https://amestris.com.au/blog/llm-ux-patterns.html)).

## 2. Meeting-intelligence — ближайший класс к Коре (E2)

Общий паттерн всех пяти: **двунаправленная синхронизация «извлечённый артефакт ↔ строка транскрипта ↔ таймкод медиа»**.

| Паттерн | Gong | Otter | Avoma | Fireflies | tl;dv/Fathom |
|---|---|---|---|---|---|
| Клик по строке транскрипта → момент медиа | ✅ | ✅ | ✅ | ✅ | ✅ |
| Клик/наведение по пункту сводки → момент | ✅ hover key point | ✅ topic | ✅ icon у заметки | ✅ outline ts | ✅ |
| Иконка-источник у каждого извлечённого факта | — | — | **✅ явная иконка** | частично | частично |
| AI Q&A с citation → исходный момент | ✅ Ask Anything | — | — | — | ✅ Ask Fathom |
| Обратный путь: категория → подсветка в транскрипте | ✅ Points of Interest | — | ✅ | ✅ Smart Search | — |
| Цветной таймлайн-слой тем по всей записи | частично | chapters | **✅** | — | highlights |
| Числовой confidence-score | ❌ | ❌ | ❌ | ❌ | ❌ |

Дословные verified-формулировки: Gong Points of Interest «Click any label to view the related snippet and jump to that part of the call»; Gong Ask Anything «Responses include citations so you can review the source and jump to the relevant moment»; Avoma «Clicking this timestamp will take you back to this exact point in the video and text transcript»; Fireflies «just click on the timestamp, and you'll be taken directly to that point in the recording and the transcript»; Fathom Ask «answers linked to citations and the exact moment». *verified* (доки/блоги вендоров — ссылки в 99-synthesis).

**Сухой факт сегмента:** ни одна из пяти платформ публично НЕ показывает числовой confidence-score у извлечённого артефакта — доверие везде строится на **цитате-доказательстве (клик→момент)**, а не на проценте. Процент у сводки встречи создаёт ложную точность. *verified-отсутствие + inferred* ([en.wikipedia.org/wiki/AI_notetaker](https://en.wikipedia.org/wiki/AI_notetaker)).

**Преимущество Коры над классом:** первоисточник = момент встречи на отдельной аудиодорожке спикера (Кора пишет дорожки по участникам), что даёт более точный спикер-слой, чем у конкурентов на общем миксе.

## 3. OSS-цепочки доказательств (E3) — как хранить провенанс

| Проект | Адрес источника | Под-документный якорь | bbox/координаты | Снапшот страницы | Маркер→источник |
|---|---|---|---|---|---|
| **RAGFlow** | `document_id`+`position_int` | да (page,L,R,T,B) | **да, пиксели** | **да, MinIO `img_id`** | агрегат `doc_aggs` |
| **Onyx** (ex-Danswer) | `document_id`+`chunk_id` | **да, `source_links: offset→URL`** | нет | `image_file_id` | **`[N]`→`CitationMapping`→`document_id`** |
| **Verba** | `doc uuid`+`chunk_id` | нет | нет | нет | `type:"extract"` |
| **Quivr** | `Document.metadata{source,page,index}` | слабо (`page`) | нет | нет | tool-call `cited_answer.citations[]` |

**Ключевые уроки для Z (verified по исходникам):**
- **Onyx `source_links: dict[offset→URL]`** (`backend/onyx/indexing/models.py`) — под-документный якорь без bbox: один чанк склеивает секции, каждый кусок ведёт на свой под-якорь. Это паттерн «переход к месту» для текстовых источников.
- **Onyx PR #3508:** `citation_num` перепривязали с «n-я цитата в потоке» на стабильную позицию документа — иначе при re-rank номера разъезжаются. **Урок: номер цитаты = стабильный источник, не порядок появления.**
- **RAGFlow `add_positions`** хранит `position_int=[(page,left,right,top,bottom)]` + превью-снимок страницы в объект-хранилище, отдаёт через backend-прокси `/v1/document/image/{id}` (не прямой URL — RBAC). Слабое место: при сплите/мердже чанков координаты теряются → **провенанс-атрибут надо протаскивать иммутабельно через ВСЕ трансформации pipeline**.
- **Анти-паттерн Quivr:** citation = self-report LLM (модель сама возвращает список «процитированных» документов) — не верифицируемо, может назвать то, что не цитировал. **НЕ перенимать.**

**Рекомендация по хранению для Z (гибрид Onyx+RAGFlow поверх существующего `IdeaBlock`):**
1. Базовый якорь на всех источниках — паттерн Onyx: `IdeaBlockEvidence` расширить адресом момента (`{meetingId,trackId,startMs}` / `{messageId}` / `{documentId,page}`), а не только `startMs/endMs`.
2. Маркер `[N]` в ответе AI-чата — паттерн Onyx (детект+стабильный mapping на `ideaBlockId`), НЕ Quivr.
3. bbox+снимок страницы — паттерн RAGFlow, только для канала ручной загрузки документов; превью в S3, отдача через backend-прокси с RBAC.
4. Провенанс-атрибут иммутабелен через `ingest→IdeaBlock→link→Theme`.

Источники (raw, проверены): [RAGFlow add_positions](https://raw.githubusercontent.com/infiniflow/ragflow/main/rag/nlp/__init__.py), [Onyx models](https://raw.githubusercontent.com/onyx-dot-app/onyx/main/backend/onyx/indexing/models.py), [Onyx PR #3508](https://github.com/onyx-dot-app/onyx/pull/3508), [Verba](https://github.com/weaviate/Verba/blob/main/goldenverba/verba_manager.py), [Quivr](https://raw.githubusercontent.com/QuivrHQ/quivr/main/core/quivr_core/rag/entities/models.py).

## 4. Российские аналоги (E4)

| Продукт | Цитата-первоисточник | Клик → момент/страница | Индикатор уверенности | Цитата vs вывод | «Полезно/Не полезно» |
|---|---|---|---|---|---|
| **istok.ai** (doc-RAG, on-prem, 152-ФЗ) | ✅ verified | ✅ клик→страница PDF | ✅ % в чипе (87-96) | ⚠️ неявно | ❓ claimed |
| **Яндекс Нейро** | ✅ verified | ✅ цифра→источник | ⚠️ внутр. разметка | ✅ **verified (подтверждённость)** | ❓ inferred |
| **mymeet.ai** | ✅ цитаты+таймкоды в чате | ⚠️ claimed | ❌ | ❌ | ❌ |
| **МТС Линк** | ✅ расшифровка | ✅ **клик по фразе→запись** verified | ❌ | ❌ | ❌ |
| **НаВстрече** | ✅ цитаты участников под решением | ❌ | ❌ | ⚠️ цитата без метки | ❌ |
| **SaluteJazz** (Сбер/GigaChat) | ⚠️ «фрагменты видео» claimed | ⚠️ claimed | ❌ | ❌ | ❌ |
| **Таймлист** («вторая память») | ❓ не раскрыто | ❓ | ❌ | ❌ | ❌ |

**Главный вывод по РФ:** никто не собирает все четыре сигнала вместе. istok силён в документах (цитата+файл·страница+%+клик-к-странице), но не про встречи. **Яндекс Нейро — единственный, кто явно разделяет «цитата из источника» vs «вывод модели» (подтверждённость)** — открытое окно для Коры. МТС Линк — эталон «клик по фразе→момент записи». У встречных секретарей (mymeet/НаВстрече/Таймлист/SaluteJazz) per-факт индикатора уверенности и разметки «цитата vs вывод» **нет ни у кого**.

Дословные verified-формулировки: istok «Каждый ответ — это ссылка на конкретную страницу документа. Щёлкните и откроется нужное место»; МТС Линк «в расшифровке можно кликнуть на фразе и перейти в нужный момент записи»; Яндекс Нейро «различает прямое цитирование документа от логического вывода». Источники: [istok.ai](https://istok.ai/), [help.istok.ai](https://help.istok.ai/guides/start-here), [habr/yandex](https://habr.com/ru/companies/yandex/articles/807801/), [mts-link](https://mts-link.ru/products/meetings/automated-minutes/), [navstreche](https://navstreche.com/), [vc.ru обзор](https://vc.ru/ai/2797578-luchshie-ii-assistenty-dlya-zapisi-vstrech-i-sammari-obzor).

## 5. Что из ландшафта берём в синтез

1. **Иконка-источник у каждого извлечённого факта** (Avoma) — самый прямой перенос.
2. **Deep-link к моменту записи с подсветкой реплики** (Glean/Copilot/МТС Линк) — превосходит «слайд/страницу» конкурентов, т.к. у Коры источник со временем.
3. **`[N]`-маркер→стабильный источник в ответе AI-чата** (Onyx, не Quivr) — для Concierge/ChatV2.
4. **Инвариант доступа «цитата не даёт новых прав»** (Glean/Notion) — критично для `dataClass`/`IdeaBlockAccess` Z.
5. **«Нет опоры в графе → не выдумывать цитату»** (Glean honesty-граница).
6. **Разметка «цитата vs вывод»** (Яндекс Нейро) — прямой ров против всех 7 РФ-конкурентов.
7. **Уверенность — НЕ числовой % для встреч** (консенсус meeting-intelligence), а качественно + coverage «по N репликам» + порог-гейт.
