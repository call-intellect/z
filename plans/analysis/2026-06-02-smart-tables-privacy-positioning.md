---
type: analysis
date: 2026-06-02
owner: sergrv80@gmail.com
relates_to:
  - plans/tz/2026-06-02-smart-tables-auto-creation.md
  - second-brain/01_projects/smart-tables.md
  - second-brain/01_projects/llm-providers-verified.md
  - second-brain/02_architecture/llm-cache-status.md
status: research-done
---

# Privacy-позиционирование Smart-tables (RF GTM)

> Документ потока PRIVACY из ТЗ `2026-06-02-smart-tables-auto-creation` (Б13). Готовится **до публичного GTM в РФ**. Часть фактов основана на аудите кода репозитория Z (подтверждённые), часть — на регуляторных/конкурентных данных из веба (июнь 2026), часть помечена как **«по знаниям, не подтверждено свежим вебом»** или **«требует подтверждения у провайдера»**. Перед использованием в договорах/маркетинге юридические нормы сверить с актуальной редакцией через КонсультантПлюс/Гарант.

---

## 1. Наш реальный data-flow (по аудиту кода)

Источник маршрутизации — `backend/scripts/seed-llm-task-routes-smart-tables.ts:57-79`; провайдеры и URL — `backend/src/common/config/env.schema.ts`; фильтрация по классу данных — `backend/src/modules/ai/services/llm-router.service.ts`.

### 1.1. Куда уходят данные компании по 5 фазам

| Фаза | taskType | Какие данные компании уходят в LLM | Provider (primary при штатной работе) | Чувствительность |
|---|---|---|---|---|
| **Фаза 1 — Text-to-Schema** (создание таблицы по описанию) | `table-infer-schema`, `table-architect-pass`, `table-entity-check` | NL-описание пользователя, черновик схемы, имена колонок. Транскрипты/строки **не уходят** — только метаданные структуры | `deepseek-v4-pro` (внешний, КНР) | Низкая |
| **Фаза 2 — Document-to-Table** (импорт Excel/CSV) | тот же 3-pass pipeline | Заголовки файла + **до 20 строк × до 5 примеров значений на колонку** — реальные данные из загруженного файла компании (`buildTabularPrompt`, `table-agent.service.ts:162-188,277-300`) | `deepseek-v4-pro` (внешний, КНР) | **Высокая** |
| **Фаза 3 — Event-to-Cells** (заполнение ячеек из встреч) | `table-extract-rows` | **Полный текст транскрипта встречи** (`turnsToText` — реплики со спикерами и таймкодами), схема колонок, метка сущности (напр. «ООО Бета-Корп») (`table-enrich.service.ts:96,685-722`) | `deepseek-v4-flash` (внешний, КНР) | **Критическая** |
| **Фаза 4 — Auto-fill ячейки** | `table-auto-fill` | Описание колонки + контекст строки + фрагмент транскрипта. **Hook заведён, но в pipeline НЕ вызывается** — данных пока не отправляет (подтверждено grep; `smart-tables.md:178`) | (не вызывается; при включении — `deepseek-v4-flash`) | — (неактивна) |
| **Фаза 5 — NL Saved Views** (фильтр по запросу) | `table-semantic-filter` | NL-запрос пользователя + схема колонок текущей таблицы + дата. Сами строки **не уходят** — фильтр применяется клиент-сайд (`table-semantic-filter.service.ts:180-216`) | `deepseek-v4-flash` (внешний, КНР) | Низкая |

Самые чувствительные потоки наружу — **Фаза 3 (полные транскрипты встреч)** и **Фаза 2 (содержимое импортируемых файлов)**.

### 1.2. Юрисдикция провайдеров (по дефолтам `env.schema.ts`)

| Провайдер | ENV / дефолт | Физическая юрисдикция | Примечание |
|---|---|---|---|
| **deepseek** | `DEEPSEEK_BASE_URL` = `https://api.deepseek.com/v1` (`env.schema.ts:137`, `deepseek.service.ts:50`) | **КНР (Китай)** — прямой API, **не через российский proxy** | Данные физически уходят на инфраструктуру DeepSeek в Китае |
| **openai-via-proxy** | `PROXY_BASE_URL` = `https://proxy.agent-lia.ru/v1` (`env.schema.ts:162`) | RU-фронт `agent-lia.ru` → конечная модель **OpenAI GPT (США)** | Прокси ретранслирует; данные в итоге у OpenAI/США. Логирует ли прокси — **требует подтверждения у владельца** |
| **ollama** | `OLLAMA_BASE_URL` = `https://ollama.agent-lia.ru/v1` (`env.schema.ts:142`) | внешний домен `agent-lia.ru` (предположительно РФ — **требует подтверждения**) | В коде помечен `localOnly: true` (`llm-router.service.ts:709`), **но дефолтный URL внешний**, не `localhost`/нода в периметре Z |

### 1.3. Пересекают ли данные границу РФ

**Да, при штатной работе — пересекают.** Primary всех 5 фаз — **deepseek** напрямую на `api.deepseek.com` (Китай). Значит:
- Фаза 3 — транскрипты встреч уходят **в Китай** (DeepSeek), при падении DeepSeek fallback — **в США** (OpenAI через прокси);
- Фаза 2 — содержимое импортируемых файлов уходит **в Китай**;
- Фазы 1/5 — NL-запросы и схемы — **в Китай**.

Только tertiary-fallback (`ollama qwen3.5:9b`) может остаться внутри (если `agent-lia.ru` физически в РФ), но он срабатывает лишь когда упали **и** DeepSeek, **и** OpenAI. В норме данные границу РФ **пересекают**.

### 1.4. Есть ли локальный путь (Ollama) — есть, но для table-задач НЕ задействован

Механизм фильтрации по `dataClass` реализован (`llm-router.service.ts:1242-1266`): только `ollama` имеет `maxDataClass: 'private'` + `localOnly: true`; `deepseek`/`openai-via-proxy` — `maxDataClass: 'internal'`. При `dataClass: 'sensitive'`/`'private'` внешние провайдеры отсеиваются, остаётся только Ollama.

**Но все table-сервисы жёстко передают `dataClass: 'internal'`:**
- `table-agent.service.ts:561` (Фазы 1, 2),
- `table-enrich.service.ts:706` (Фаза 3, транскрипты),
- `table-semantic-filter.service.ts:204` (Фаза 5).

`'internal'` проходит фильтр для DeepSeek. **Итог: ни одна table-задача не маршрутизируется на локальную модель.** Транскрипты встреч (Фаза 3) и содержимое файлов (Фаза 2) классифицируются как `internal` и штатно уходят во внешний DeepSeek/Китай. Нет ни логики повышения `dataClass` для конфиденциальных таблиц/встреч, ни признака «конфиденциальная таблица».

Дополнительно: даже при `dataClass: 'private'` «локальный» провайдер — это `ollama.agent-lia.ru` (внешний домен), то есть формальный `localOnly: true` **не гарантирует**, что данные останутся в периметре Z. Расхождение декларации `localOnly` и фактического URL — **требует подтверждения**, где физически стоит этот Ollama.

### 1.5. Хранение/обучение провайдером — в репозитории не зафиксировано

В репозитории **нет ни одной записи** о ToS/data-retention/opt-out провайдеров (ни в `llm-providers-verified.md`, ни в env, ни в коде). Из кода известно:
- Z логирует **факт** каждого вызова во внутренний `AiUsageLog` (tokens, cost, tier) — это логирование Z, не провайдера;
- промпты cache-friendly (стабильный SYSTEM) — DeepSeek кэширует префиксы (~99.9%, `llm-cache-status.md`), что подразумевает **временное хранение префиксов на стороне DeepSeek**;
- хранят ли провайдеры payload дольше и обучаются ли — **требует подтверждения у провайдеров**; enterprise/no-train режим в репозитории не настроен.

---

## 2. Регуляторный контекст РФ

> Нормы собраны из вторичных юридических источников (июнь 2026); перед договорами/маркетингом сверить с актуальной редакцией КоАП/152-ФЗ.

### 2.1. Локализация ПДн граждан РФ (ч. 5 ст. 18 152-ФЗ)

При сборе ПДн оператор обязан обеспечить **запись, систематизацию, накопление, хранение, уточнение, извлечение** ПДн граждан РФ в базах данных, **физически находящихся в РФ** («первичность» российской БД). С **1 июля 2025** локализацию усилили — «вторичная» лазейка фактически закрыта: первичная обработка ПДн россиян только на серверах в РФ; использование зарубежных БД для этих операций не допускается ([Lidings](https://www.lidings.com/ru/media/legalupdates/localization_pd_update/), [comply.ru](https://comply.ru/tpost/c43ezsout1-lokalizatsiya-i-transgranichnaya-peredac)).

**Для Z:** граф знаний (IdeaBlock, Entity, транскрипты, записи встреч с голосами сотрудников) — это ПДн (частично спецкатегории) и должен **храниться в РФ** (Postgres/pgvector, S3-записи, Redis). Заложено через switchable S3 (Yandex/Selectel/SberCloud/MinIO) — нужно зафиксировать российский ЦОД в проде.

**Штрафы за нарушение локализации (ст. 13.11 КоАП):** юрлица **1–6 млн руб.**, повтор — **6–18 млн руб.**

### 2.2. Трансграничная передача ПДн (266-ФЗ, приказ РКН № 128, режим с 01.03.2023)

Локализация и трансгран — **два разных требования**: сначала запись в РФ, **только потом** передача за рубеж. До начала передачи — **отдельное уведомление в РКН** (страны-получатели, контрагенты, меры защиты).

| Провайдер | Страна | Статус по приказу РКН № 128 | Что требуется |
|---|---|---|---|
| **DeepSeek** | КНР (Китай) | **«Адекватная»** (Китай во втором списке адекватной защиты; не участник Конвенции 108) | Уведомление РКН → передача **сразу** после подачи |
| **OpenAI** | США | **НЕ адекватная** (нет в обоих списках) | Предварительная оценка получателя + уведомление + ожидание решения РКН **до 10 раб. дней**; **риск запрета** |

С точки зрения трансграничного режима **DeepSeek (Китай) формально проще**, чем OpenAI (США). Оба варианта требуют сначала записать ПДн в РФ. Разъяснения РКН (24.03.2025) и Минцифры (12.05.2025): усиление локализации с 01.07.2025 **не вводит** доп. ограничений на трансгран из локализованной в РФ БД — схема «сначала РФ → потом трансгран» остаётся законной ([data-sec.ru](https://data-sec.ru/personal-data/cross-border-countries/), [приказ № 128](https://www.garant.ru/products/ipo/prime/doc/405209273/), [b-152.ru](https://b-152.ru/transgranichnaya-peredacha-personalnyh-dannyh)).

### 2.3. Требования B2B / госсектора (2025–2026)

Драйвер ужесточения — **оборотные штрафы за утечки** (420-ФЗ от 30.11.2024, с 30.05.2025): первичная утечка от 3–5 млн до 10–15 млн руб., спецкатегории — 10–15 млн, биометрия — 15–20 млн; **повторная — оборотный штраф 1–3% годовой выручки** (мин. 20 млн, макс. 500 млн). СБ заказчика отвечает деньгами за вашу платформу, поэтому due-diligence жёсткий. На практике спрашивают:

1. **Data residency** — где физически серверы (БД, файлы, бэкапы), требуют «всё в РФ», аттестованный ЦОД.
2. **«Куда уходят данные при работе AI»** — прямой вопрос про LLM: передаются ли промпты/транскрипты во внешние модели, в какие страны, есть ли уведомление РКН, обезличиваются ли данные. Иностранный облачный LLM — часто **стоп-фактор** или требование «выключить и заменить на российское/локальное».
3. **152-ФЗ комплаенс-пакет** — уведомление оператора, модель угроз, согласия субъектов, договоры поручения (ст. 6 п. 3); спецкатегории/биометрия — отдельные основания.
4. **Реестр российского ПО** (Минцифры) — для госзакупок почти обязателен; иностранный облачный SaaS в госсекторе ограничен импортозамещением.
5. **ФСТЭК Приказ № 117** (от 11.04.2025, в силе с 01.03.2026) — для ГИС/ИС госорганов: **прямой запрет на облачные ИИ-сервисы** для гостайны и информации ограниченного доступа; только «доверенные технологии ИИ». Для госсектора де-факто означает **on-prem/локальный AI-контур**.

По сегментам: средний коммерческий бизнес — допускает SaaS «всё в РФ» + прозрачность по LLM (часто согласен на DeepSeek с уведомлением РКН); крупный бизнес/банки — тяготеют к закрытому контуру и российским LLM; **госсектор/КИИ — внешний облачный AI практически исключён**, нужен on-prem ([КонсультантПлюс](https://www.consultant.ru/legalnews/28492/), [ФСТЭК № 117](https://fstec.ru/dokumenty/vse-dokumenty/spetsialnye-normativnye-dokumenty/trebovaniya-utverzhdeny-prikazom-fstek-rossii-ot-11-aprelya-2025-g-n-117), [ComNews](https://www.comnews.ru/content/244345/2026-03-23/2026-w13/1007/ii-gossektore-kak-novye-trebovaniya-fstek-menyayut-rynok)).

### 2.4. Тренд on-prem / локальных LLM в РФ

Чёткий тренд 2025–2026: компании со строгими требованиями разворачивают LLM **в закрытом контуре (on-prem)**. Коммерческие варианты: **GigaChat Business** (Сбер, on-prem/ПАК, гибрид, SaaS — запуск март 2026), **YandexGPT 5.1 Pro** (развёртывание внутри контура через Yandex Cloud), open-source **ruGPT** (ai-forever) и др. Минусы — стоимость GPU/ПАК, объём внедрения, более слабое качество против фронтирных моделей; отсюда популярна **гибридная модель** (чувствительное → локально, обезличенное → внешние API). У Z уже есть **Ollama qwen3.5:9b** как tertiary-fallback — это задел, но для рынка нужен полноценный режим «локальный AI-контур» ([vc.ru](https://vc.ru/ai/2733649-rossiyskie-neuroseti-2026-modeli-i-servisy-dlya-biznesa), [Bitbanker](https://bitbanker.space/technologies/era-gibridnogo-intellekta-kak-rossijskie-korporaczii-vnedryayut-lokalnye-llm-v-zakrytye-kontury/), [developers.sber.ru](https://developers.sber.ru/help/gigachat-api/best-ai-instruments)).

---

## 3. Конкуренты — privacy & data-governance AI-функций

> Данные из официальных trust-/security-страниц вендоров (2025–2026). Отдельные строки помечены как «по знаниям, не подтверждено свежим вебом».

| Продукт | Training на данных | Провайдер / sub-processors | Data residency | On-prem / self-hosted | Enterprise-гарантии |
|---|---|---|---|---|---|
| **Notion AI** | **No-training by default** (opt-out; есть добровольный opt-in AI LEAP Program) | Модели хостит сам Notion + **OpenAI, Anthropic**; embeddings — OpenAI; retention у LLM: Enterprise — **zero**, прочие — ≤30 дней | **EU residency (Франкфурт) с 2025** (Enterprise, бесплатно); также US / Япония / Ю.Корея. Нюанс: LLM-инференс может выполняться вне региона residency | **Нет** (по знаниям, не подтверждено свежим вебом) | SOC 2 Type 2, ISO 27001, GDPR + DPA, HIPAA (BAA на Enterprise), no-training pledge, audit logs, SCIM |
| **Coda AI / Coda Brain** | **No-training by default** для всей платформы (переключателя «разрешить» нет) | Coda AI → **OpenAI** (GPT-4 + fine-tuned) + свои модели на AWS; Coda Brain → **Snowflake Cortex** (данные «в периметре Snowflake») | US/AWS-центрично; **явного EU-residency нет** — трансгран через EU **SCCs** | **Нет** | SOC 2 Type 2, SOC 3, ISO 27001/27017/27018, GDPR/CCPA, DPA, no-training pledge, SSO/SAML, AES-256/KMS |
| **Airtable Omni / Airtable AI** | **No-training pledge для всех планов** (контрактно); AI **opt-out** (включён по умолчанию) | Своей LLM нет; **OpenAI, Anthropic, Google, Meta/Llama, Mistral, IBM watsonx, AWS** (часть через Bedrock). Retention провайдером: Enterprise/Business — **no-retention**, Free/Team/Pro/Plus — **≤30 дней** | **EU residency (Франкфурт, бэкап Дублин) только на Enterprise Scale**; есть AU residency; дефолт — US. AI sub-processors помечены Global/USA — вызов может выходить за регион | **Нет** | SOC 2 Type 2, ISO 27001:2022, ISO 27701, TX-RAMP L2, HIPAA (Enterprise Scale + BAA), GDPR/DPA, breach-notif 72ч |
| **Tana** | **No-training** (opt-out, контрактно на субпроцессоров) | Мульти-LLM: **OpenAI, Anthropic (Claude), Google (Gemini)**, ~13 моделей; своей LLM нет; вызов только по явному действию пользователя | Хостинг **Google Cloud**; **явного EU/локального residency нет**; трансгран через SCCs; E2E-шифрования нет (ключи у Tana) | **Нет** (self-hosted/Docker — только feature-request) | **SOC 2 Type 2 — в процессе, завершение Q3 2026 (ещё не выдан)**; GDPR, DPA (не на Tana Outliner), no-training pledge |
| **MS Fabric (Copilot / Data Agents)** | **No-training** (жёсткое контрактное; без fine-tuning; retention промптов убран) | **Azure OpenAI** (внутри Azure, **не** публичный OpenAI/ChatGPT); модели gpt-5.x/4.1; **AI Functions** могут конфигурироваться на Foundry-модели **Claude/LLaMA** | Обработка остаётся в гео-регионе capacity; кросс-гео — явный opt-in админа; **EU Data Boundary (с 02.2025)** + Multi-Geo (EU-capacity) | **Нет** полноценного on-prem (только Power BI Report Server без Copilot; BYOK — ключи, не self-host инференса) | No-training pledge, GDPR + Microsoft DPA, SOC 1/2/3, ISO 27001/27018, HIPAA BAA, FedRAMP, Purview/DLP, breach-notif 72ч |

**Ключевой вывод по конкурентам:** **ни один** из пяти не предлагает self-hosted/on-prem AI-инференс и **ни один** не имеет RF data residency или российской LLM. У всех — no-training pledge и (у большинства) EU residency на топ-планах. То есть на RF-рынке открыт незанятый дифференциатор: **RF-резидентный inference + локальный AI-контур (российская/open-source LLM в периметре)** — то, чего нет ни у Notion, ни у Coda, ни у Airtable, ни у Tana, ни у MS Fabric.

---

## 4. Риски Z (по приоритету)

Где текущий data-flow (раздел 1) конфликтует с ожиданиями RF-клиента (раздел 2).

| # | Риск | Где в коде | Severity | Суть конфликта |
|---|---|---|---|---|
| **R1** | **Транскрипты встреч (Фаза 3) штатно уходят во внешний DeepSeek/Китай**, fallback — OpenAI/США | `table-enrich.service.ts:96,706` | **CRITICAL** | Транскрипт = ПДн сотрудников + содержание переговоров (часто спецкатегории/коммерческая тайна). Прямой стоп-фактор на due-diligence; для госсектора/КИИ — нарушение ФСТЭК-117 (запрет облачного AI). Требует уведомления РКН по двум странам (Китай + США) |
| **R2** | **Содержимое импортируемых файлов (Фаза 2) уходит в Китай** (до 20 строк × 5 значений на колонку) | `table-agent.service.ts:277-300,561` | **HIGH** | Загруженный Excel/CSV может содержать клиентскую базу, ПДн, прайсы. Уходит во внешний LLM без обезличивания |
| **R3** | **`dataClass` всех table-задач захардкожен в `internal`** — механизм локальной маршрутизации (Ollama) не активируется | `table-agent.service.ts:561`, `table-enrich.service.ts:706`, `table-semantic-filter.service.ts:204` | **HIGH** | Механизм «держать локально» есть, но для table-задач выключен. Нет признака «конфиденциальная таблица» и логики повышения класса для встреч/чувствительных таблиц |
| **R4** | **`ollama` помечен `localOnly:true`, но дефолтный URL внешний** (`ollama.agent-lia.ru`) | `env.schema.ts:142`, `llm-router.service.ts:709` | **MEDIUM** | «Локальность» не гарантирует периметр Z/заказчика. Расхождение декларации и факта — нельзя честно обещать «данные не покидают периметр», пока не подтверждено физическое расположение |
| **R5** | **Условия хранения/обучения DeepSeek и прокси `agent-lia.ru` в репозитории не зафиксированы** | `llm-providers-verified.md` (нет записей) | **MEDIUM** | Нельзя дать клиенту no-training/no-retention гарантию по DeepSeek; consumer-API DeepSeek по публичной политике может хранить/использовать данные. Прокси `agent-lia.ru` — неизвестное звено логирования (**требует подтверждения**) |
| **R6** | **NL-запросы и схемы (Фазы 1/5) уходят в Китай** | `table-semantic-filter.service.ts`, `table-agent.service.ts` | **LOW** | Метаданные структуры и формулировки запросов; имена колонок могут косвенно раскрывать бизнес-контекст. Чувствительность ниже, но граница РФ пересекается |
| **R7** | **Фаза 4 (auto-fill) — hook заведён, в pipeline не вызывается** | grep подтверждён; `smart-tables.md:178` | **INFO** | Сейчас данных не отправляет. При включении унаследует R1–R3 (фрагмент транскрипта на `deepseek-v4-flash`) — заложить privacy-маршрутизацию **до** активации |

Главный риск — **R1 (CRITICAL)**: транскрипты встреч в Китай. Именно он сделает невозможным GTM в крупный B2B/госсектор без доработки.

---

## 5. Рекомендации / privacy-pitch для РФ-клиента

### 5.1. Что доработать в продукте (приоритет по риску)

1. **(закрывает R1, R2, R3) Признак «конфиденциальная таблица/встреча» + повышение `dataClass`.** Ввести для table-задач возможность `dataClass: 'sensitive'`/`'private'` — тогда существующий фильтр (`llm-router.service.ts:1242-1266`) сам уведёт их на локальную модель. По умолчанию для **Фазы 3 (транскрипты)** и **Фазы 2 (импорт файлов)** поднять класс выше `internal`, либо дать тенанту/таблице флаг конфиденциальности. Это переиспользует уже готовый механизм, а не строит новый.
2. **(закрывает R4) RF-резидентный / in-perimeter inference.** Подтвердить и зафиксировать физическое расположение Ollama; для enterprise/госсектора — задеплоить локальную LLM **в периметре заказчика** (on-prem-узел), не на `agent-lia.ru`. Привести `localOnly:true` в соответствие с реальным URL. Кандидаты российских/open-source моделей: GigaChat (ПАК), YandexGPT (в контуре), ruGPT, текущий qwen3.5:9b.
3. **(закрывает R5) Зафиксировать ToS/retention/no-train по каждому провайдеру** в `llm-providers-verified.md`: подтвердить у DeepSeek (enterprise no-train режим?), у владельца `agent-lia.ru` (логирует ли прокси), у себя — что Ollama не обучается. Без этого нельзя давать письменные гарантии.
4. **(регуляторика) Подать уведомления о трансграничной передаче в РКН** по Китаю (DeepSeek) и США (OpenAI) — до публичной эксплуатации в РФ. Зафиксировать российский ЦОД для Postgres/pgvector/S3/Redis (локализация хранения).
5. **(закрывает R7 превентивно) Заложить privacy-маршрутизацию для Фазы 4 до её активации** — чтобы auto-fill не унаследовал отправку фрагментов транскриптов во внешний LLM.

### 5.2. Что говорить РФ-клиенту (privacy-pitch)

- **Честно про сегодня:** «Хранение данных — в РФ. Для AI-обработки по умолчанию используется внешний LLM (DeepSeek, Китай — "адекватная" по РКН страна, передача легальна с уведомлением). Для конфиденциальных данных — режим локального AI-контура.»
- **Дифференциатор vs конкуренты:** «В отличие от Notion / Coda / Airtable / Tana / MS Fabric — у нас есть **полностью локальный AI-контур** (российская/open-source LLM в вашем периметре). Ни один из них не предлагает on-prem AI-инференс и ни у одного нет RF data residency.»
- **Гибридная модель** (под тренд РФ): «Конфиденциальное (транскрипты встреч, импорт чувствительных файлов) → локальная модель в периметре; обезличенное/низкочувствительное → внешний API с уведомлением РКН.»
- **Для госсектора/КИИ:** отдельный tier «полностью локальный AI» — снимает трансграничный вопрос и требования **ФСТЭК-117** (запрет облачного AI). Это входной билет в госзакупки.
- **Чего НЕ говорить** до доработок: «данные не покидают периметр» / «всё локально» — пока R1–R4 не закрыты, это неправда (транскрипты уходят в Китай).

### 5.3. Privacy-блок в маркетинг

Включить на лендинг/в sales-deck явный блок (после доработок):
- **«Данные компании — в России»**: хранение (Postgres/pgvector, записи встреч, бэкапы) в российском ЦОД, 152-ФЗ-локализация.
- **«Локальный AI-контур»**: конфиденциальные данные обрабатываются LLM в вашем периметре, не покидают его; on-prem-опция для enterprise/госсектора.
- **«No-training»**: ваши данные не используются для обучения моделей (после контрактной фиксации с провайдерами).
- **«Прозрачная маршрутизация»**: видно, какие задачи идут во внешний LLM (с уведомлением РКН), какие — локально; флаг конфиденциальности на уровне таблицы/тенанта.
- **«152-ФЗ / трансгран-комплаенс»**: уведомления РКН поданы, DPA/договор поручения, согласия субъектов.
- **Сравнительная плашка** с конкурентами: «RF residency + on-prem AI — только у нас».

---

## 6. Открытые вопросы до GTM

1. **Где физически стоит `ollama.agent-lia.ru` и `proxy.agent-lia.ru`?** РФ или нет? Логирует ли прокси payload? Без ответа нельзя честно позиционировать «локальность» (R4, R5).
2. **Каковы реальные ToS DeepSeek для нашего тарифа** — хранят ли payload, обучаются ли, есть ли enterprise/no-train opt-out? (R5) — **требует подтверждения у провайдера.**
3. **Готовы ли мы держать локальную LLM в периметре заказчика** (on-prem-узел), и какую модель (GigaChat ПАК / YandexGPT / ruGPT / qwen)? Качество локальной модели vs DeepSeek на table-задачах (extract-rows, infer-schema) — нужен бенчмарк.
4. **Подано ли уведомление в РКН** о трансграничной передаче по Китаю и США? Кто оператор ПДн — Z или тенант (договор поручения обработки)?
5. **Зафиксирован ли российский ЦОД** для прода (Postgres/pgvector/S3/Redis)? Аттестован ли по требованиям?
6. **Транскрипт встречи** — классифицируем ли как спецкатегорию ПДн (содержание переговоров, голоса)? Какие согласия субъектов нужны до отправки во внешний LLM?
7. **Целевой сегмент первого GTM** — средний коммерческий B2B (допускает DeepSeek+РКН) или сразу госсектор/КИИ (требует on-prem, ФСТЭК-117)? От этого зависит, обязателен ли локальный контур на старте.
8. **Нужна ли регистрация в реестре российского ПО** (Минцифры) для целевого сегмента, и совместимо ли это с использованием иностранного облачного LLM в архитектуре?

---

## Источники

**Аудит кода (репозиторий Z, подтверждено):**
- `backend/src/modules/ai/services/llm-router.service.ts` (фильтр `dataClass`, `PROVIDER_CAPABILITY`, fallback-chain)
- `backend/src/common/config/env.schema.ts` (дефолтные URL провайдеров)
- `backend/src/modules/tables/services/table-agent.service.ts`, `table-enrich.service.ts`, `table-semantic-filter.service.ts`
- `backend/scripts/seed-llm-task-routes-smart-tables.ts` (маршруты tier'ов)
- `backend/src/modules/ai/services/prompts/table-*.prompt.ts`
- `backend/src/modules/ai/services/deepseek.service.ts`, `openai-proxy.service.ts`, `ollama.service.ts`
- `second-brain/01_projects/smart-tables.md`, `llm-cache-status.md`, `llm-providers-verified.md`

**Регуляторика РФ:**
- https://www.lidings.com/ru/media/legalupdates/localization_pd_update/
- https://b-152.ru/hranenie-personalnyh-dannyh-za-granicej
- https://riverstart.ru/blog/novyie-trebovaniya-kpersonalnyim-dannyim-v2025-pravila-rabotyi-dlya-biznesa-s152-fz
- https://wcr-consulting.com/blog/2026/03/13/lokalizaciya-baz-dannyh-personalnyh-dannyh/
- https://data-sec.ru/personal-data/cross-border-countries/
- https://www.garant.ru/products/ipo/prime/doc/405209273/ (приказ РКН № 128)
- https://rkn.gov.ru/news/rsoc/news74528.htm
- https://b-152.ru/transgranichnaya-peredacha-personalnyh-dannyh
- https://comply.ru/tpost/c43ezsout1-lokalizatsiya-i-transgranichnaya-peredac
- https://www.business.ru/article/5351-transgranichnaya-peredacha-personalnyh-dannyh-gg
- https://www.consultant.ru/legalnews/27142/
- https://www.consultant.ru/legalnews/28492/
- https://fstec.ru/dokumenty/vse-dokumenty/spetsialnye-normativnye-dokumenty/trebovaniya-utverzhdeny-prikazom-fstek-rossii-ot-11-aprelya-2025-g-n-117 (Приказ № 117)
- https://www.comnews.ru/content/244345/2026-03-23/2026-w13/1007/ii-gossektore-kak-novye-trebovaniya-fstek-menyayut-rynok
- https://vc.ru/ai/2733649-rossiyskie-neuroseti-2026-modeli-i-servisy-dlya-biznesa
- https://bitbanker.space/technologies/era-gibridnogo-intellekta-kak-rossijskie-korporaczii-vnedryayut-lokalnye-llm-v-zakrytye-kontury/
- https://developers.sber.ru/help/gigachat-api/best-ai-instruments

**Конкуренты — Notion AI:** https://www.notion.com/help/notion-ai-security-practices · https://www.notion.com/help/ai-safety · https://www.notion.com/help/data-residency · https://www.notion.com/security · https://www.notion.com/help/gdpr-at-notion

**Конкуренты — Coda:** https://coda.io/trust · https://coda.io/trust/security · https://help.coda.io/en/articles/7988177-coda-ai-features · https://coda.io/product/coda-brain · https://www.snowflake.com/en/product/features/cortex/

**Конкуренты — Airtable:** https://www.airtable.com/company/ai-terms · https://www.airtable.com/company/subprocessors · https://www.airtable.com/company/data-residency-faqs · https://support.airtable.com/docs/using-omni-ai-in-airtable · https://www.airtable.com/company/dpa

**Конкуренты — Tana:** https://tana.inc/privacy · https://trust.tana.inc/subprocessors · https://outliner.tana.inc/learn/features/tana-ai · https://ideas.tana.inc/posts/745-self-hosted-docker-variant

**Конкуренты — MS Fabric:** https://learn.microsoft.com/en-us/fabric/fundamentals/copilot-privacy-security · https://learn.microsoft.com/en-us/fabric/data-science/ai-functions/overview · https://learn.microsoft.com/en-us/privacy/eudb/eu-data-boundary-learn · https://redresscompliance.com/azure-openai-data-privacy-and-compliance-for-enterprise-ai-deployments/
