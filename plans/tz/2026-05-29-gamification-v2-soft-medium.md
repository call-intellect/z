---
type: tz
status: planned
feature: Геймификация v2 «мягко-средняя» — Зёрна (внутренняя валюта без денежной конвертации), 10 уровней с правами, двусторонние «спасибо», мини-лиги команды, личный прогресс «рост относительно себя», Telegram-канал мотивации, AI-оценка качества признаний, защиты от накрутки и от выгорания. Полная русификация. Поверх существующего модуля recognition. Под РФ-компанию 5–100 человек.
date: 2026-05-29
parent: plans/tz/2026-05-23-gamification-and-motivation.md
related:
  - plans/tz/2026-05-23-gamification-and-motivation.md
  - second-brain/01_projects/probe-agent.md
  - second-brain/02_architecture/module-map.md
research:
  - 2026-05-29 deep-research pass 1 (Centrical / Zhang 2025 Frontiers β=0.31 / PMC12263921 employee acceptance / Kim 2026 CMU Tepper / Hammedi 2021 MDPI leaderboard stress)
  - 2026-05-29 deep-research pass 2 (Almeida 2023 ToSE 87-paper systematic review / Matthews & Kelemen 2024-2025 JoM 131-paper integrative review / Moldon, Strohmaier & Wachs ICSE 2021 GitHub natural experiment n=433k / Song et al. 2018 Management Science RPF +10.9% / Bonusly Gratitude Gauge Sep 2025 + Recognition Quality Score / Kudos AI / Slack API guidelines + Microsoft Teams 20/min throttle / Mail.ru-VK case / Yahoo Answers Goodhart canonical)
language_rule: вся коммуникация с сотрудниками и руководителями — только русский, без англицизмов. См. memory feedback_admin_ui_russian_only.
---

# Геймификация v2 «мягко-средняя» — ТЗ

## TL;DR

Поверх работающего модуля `recognition` (модели `Recognition` / `Badge` / `UserBadge` / `ContributionSnapshot`, Recognition Agent, 4 cron'а) добавляем **средний соревновательный слой**, полностью адаптированный под русскую корпоративную культуру:

- **Зёрна** — внутренняя валюта без денежной конвертации по умолчанию (модель `ZCoinTransaction`).
- **10 уровней Хранителя памяти команды** с реальными правами (не пустыми званиями), множителем прогрессии 0.5–2.0 от admin тенанта.
- **Двусторонние «спасибо»**: при благодарности зёрна получают оба — отправитель и адресат (паттерн Centrical, подтверждённый Bonusly).
- **Серии чек-инов с Сохранением серии** (1 пропуск/неделя авто) — **БЕЗ привязки зёрен** к самому факту серии (урок GitHub ICSE 2021: streak'и провоцируют минимально-полезные действия).
- **Мини-лиги команды ≤30 человек, недельный сброс**, опт-ин через явный выбор на знакомстве (forced choice). Graceful degradation для команд <5.
- **Личный прогресс «рост относительно себя прошлой недели»** (паттерн GitHub contribution graph + Song et al. 2018 Management Science: +10.9% у нижней части рейтинга).
- **Категориальные топ-3** (Помощники / Идеаторы / Постоянные), еженедельный сброс — вместо единого рейтинга компании.
- **Telegram-канал мотивации** с жёсткими ограничениями: 3 сообщения/день/человек, тихие часы 22–8 локального, 5–8 шаблонов на триггер.
- **AI-оценка качества признаний** (по образцу Bonusly Gratitude Gauge): specificity + authenticity + values alignment + наш дифференциатор — детекция циркулярных паттернов и кластеризации по времени.
- **Inflection point мониторинг**: явные пороги перехода в токсичность с авто-уведомлением HR (Matthews & Kelemen 2024-2025 JoM).
- **Защиты**: дневной cap 200 зёрен, антивыгорание (14 дней на cap'е → AI шлёт «отдохни»), AI-фальшь-детектор для руководителя, опт-аут на каждый триггер.

**Всё опт-ин, ничто не привязано к оценке производительности.** Срок: 2–3 человеко-недели.

## Зачем именно это (с источниками)

Old план [plans/tz/2026-05-23-gamification-and-motivation.md](plans/tz/2026-05-23-gamification-and-motivation.md) запрещал баллы и рейтинги. Два pass deep-research (2026-05-29) показали нюанс:

- ✓ **Геймификация работает узко-условно**: β = 0.31 (Zhang 2025 Frontiers, N=418) — но только при принятии сотрудниками и оргподдержке.
- ✓ **Принятие — модератор × 1.5** (PMC12263921 2025). Без опт-ин эффект падает на 33%, для отказников — отрицательный.
- ✓ **Лидерборды и keeping score — самые частые источники негативных эффектов** (Almeida 2023 ToSE 87-paper systematic review, arXiv:2305.08346; Matthews & Kelemen 2024-2025 JoM 131-paper integrative review, DOI 10.1177/01492063241266157). Inflection point — явное требование.
- ✓ **GitHub natural experiment** (Moldon, Strohmaier & Wachs, ICSE 2021, n=433k разработчиков, arXiv:2006.02371): streak'и удерживают поведение, но раздувают синглтон-коммиты и weekend-активность — **cautionary evidence для knowledge work**. Урок: за стрики не давать реальную ценность.
- ✓ **Публичная относительная обратная связь** работает (+10.9% у нижней части рейтинга), но **только когда комплектована с показом лучших практик** (Song et al. 2018 Management Science, DOI 10.1287/mnsc.2017.2745). Урок: «рост относительно себя» + примеры лучших, не голый ранкинг.
- ✓ **Двусторонние благодарности** (Centrical): зёрна обоим — отправителю и адресату. Bonusly 2025 пошёл в ту же сторону.
- ✓ **Mail.ru / VK кейс** (gamification-now.ru, friend.work-интервью с Лией Королевой и Алексеем Дмитриевым, vc.ru): «Коины + Спасибо + Магазин призов + Доброкоины» — структурно идентично нашему ТЗ. Подтверждение, что российская крупная IT-компания уже идёт этим путём.

**Под РФ-культуру:**
- Все термины — только русские (см. правило в frontmatter и memory).
- Конвертация в рубли — выключена по умолчанию; включается admin тенанта осознанно.
- Доброкоины на благотворительность (как у Mail.ru) — снижают денежно-меркантильную окраску и усиливают values alignment.

## Правила копи (обязательно для всей коммуникации)

**Запрещены англицизмы в любом сообщении пользователю.** Источник: memory feedback_admin_ui_russian_only (расширено 2026-05-29 на Telegram, push, AI-сообщения, названия игровых механик).

| Архитектурный код | Русское название в коммуникации |
|---|---|
| `ZCoinTransaction`, Z-coins | **Зёрна** |
| Level, Memory contributor level | **Уровень** + русское название |
| Badge | **Знак** |
| Streak | **Серия** (серия чек-инов) |
| Streak Freeze | **Сохранение серии** |
| League / Mini-league | **Лига команды** |
| Leaderboard | **Топ команды** |
| Kudos / Thanks | **Спасибо** |
| Recognition | **Признание** |
| Check-in (утренний/вечерний) | **Утренний отчёт / Вечерний отчёт** |
| Quiet hours | **Тихие часы** |
| Weekly digest | **Итоги недели** |
| Opt-in / Opt-out | **Включить / Отключить участие** |
| XP | **Очки опыта** |
| Reset (weekly) | **Сброс недели** |
| Inflection point | **Точка перехода** |

В коде Prisma-модели и DTO остаются на английском (инженерный стандарт), но все user-facing поля (`displayName`, `template` в `RecognitionMessageTemplate`, `level.name`, `level.permissionsGranted.label` и т.п.) — только русский.

**AI-агенты (Recognition Agent, Concierge, Probe Agent) — системный промпт должен явно запрещать вставку англицизмов** («kudos», «teamwork», «good job» и т.п.) в финальный текст пользователю.

## Что НЕ делаем (anti-patterns с источниками)

| Anti-pattern | Источник | Что вместо |
|---|---|---|
| Единый компанейский рейтинг «лучший vs худший» | Hammedi 2021 MDPI; Almeida 2023 ToSE; Microsoft stack ranking (SHRM) | Категориальные топ-3 + мини-лиги команды ≤30 |
| Зёрна за факт серии чек-инов | Moldon et al. ICSE 2021 — streak'и провоцируют синглтон-вклады | Серия даёт только знак и публичное признание; зёрна — за **содержание** (длина рефлексии, инсайты, упоминания) |
| Конвертация зёрен в рубли по умолчанию | Wells Fargo 2016 (Goodhart, $3 млрд штраф) | Внутренняя валюта по умолчанию; конвертация — опция admin тенанта с лимитом ≤5% ФОТ |
| Зёрна за основную работу (закрыл задачу, провёл встречу) | overjustification effect (Deci/Ryan; Yu-kai Chou) | Зёрна только за **новые** действия: чек-ин, рефлексия, помощь, идея |
| Серии со штрафами за пропуск | PMC12263921 «contrived enjoyment»; GitHub ICSE 2021 cautionary | Сохранение серии (1/неделя авто) + `longestStreak` как трофей |
| Публичный позор отстающих | Disney Hotel housekeeper leaderboard 2008 | Никаких «последних мест». Личный прогресс «рост относительно себя» в личной зоне |
| Шаблонные AI-благодарности | Kim 2026 CMU Tepper (моральные издержки) | Recognition Agent не шлёт пустых; AI quality score: specificity + authenticity + values alignment |
| Зёрна за «озвучивание проблем» | Goodhart's law; Yahoo Answers (канон деградации) | Публичная благодарность от руководителя; quality score; никаких прямых зёрен |
| Спам Telegram > 3 раз/день | G2 (Achievers «notifications overwhelm inbox»); Slack guidelines; Mail.ru-практика | 3 сообщения/день/человек, тихие часы 22–8 локального, варьируемые шаблоны (5–8 на триггер) |
| Peer-points без AI quality scoring | Yahoo Answers (канонический провал); IBIMA 2024 review | Bonusly Gratitude Gauge-стиль: реал-тайм оценка качества + детекция накрутки |
| Лиги без защиты «дна» | Matthews & Kelemen 2024-2025 JoM (upward comparison → envy/deviance) | Никогда не показываем последние места; «рост относительно себя» виден всегда; дно лиги — приватно |

## Что делаем

### Фаза 1. Зёрна — внутренняя валюта (без денежной конвертации)

**Зерно** — внутренняя единица признания, накапливается у сотрудника **навсегда** и отдельно **за период** (текущая неделя/месяц для лиг).

**Начисление:**

| Действие | Зёрна получателю | Зёрна инициатору |
|---|---|---|
| Утренний отчёт | +3 | — |
| Вечерний отчёт | +3 | — |
| Письменная рефлексия (> 200 символов, оценка качества AI ≥ 0.5) | +5 | — |
| Получил «Спасибо» в комментарии | +10 × качество | **+5 × качество отправителю** |
| Реакция «Полезно» на инсайт/комментарий | +5 автору | **+2 реактору** |
| Идея перешла `captured → in_review` | +15 | — |
| Идея перешла `in_review → in_development` | +50 | — |
| Идея перешла `in_development → shipped` | +100 | — |
| Ответ на пробный вопрос коллеге | +10 | — |
| AI извлёк «мне помог X» из чек-ина | +20 X (помощнику) | — |

**Множитель качества (0.5..1.5)** — AI Recognition Agent оценивает каждое «спасибо» / реакцию по 3 сигналам Bonusly Gratitude Gauge:
- **Конкретность**: упомянуты контекст, факт, действие.
- **Подлинность**: тон, длина, не шаблон.
- **Соответствие ценностям**: связано с values компании (если есть в `Tenant.values`).

Дефолт качества = 1.0 (нейтрально). Если AI оценил <0.5 — начисление 0.5. Если ≥1.2 — 1.5 (бонус за качественное признание).

**Антинакрутка:**
- Дневной cap 200 зёрен / пользователь / день. Сверх — не начисляется (действие учитывается).
- Дневной cap на «полезно» от одного реактора: 5 реакций/день.
- Дневной cap на «спасибо» от одного отправителя: 3 спасибо/день.
- Зёрна за реакцию начисляются **только если** объект старше 1 часа.
- Циркулярная защита (A→B→A): если пара обменивается «спасибо» >5 раз за 7 дней в обе стороны без контекста → AI помечает паттерн в `RecognitionQualityWarning`, начисление сверх 3 в каждую сторону блокируется.
- Кластеризация по времени: если >5 благодарностей отправлены в окне 1 минуты — пометка `time_clustering_warning`, отложенный пересчёт качества.

**Что НЕ начисляет зёрна:**
- Закрытие задачи в трекере (основная работа).
- Участие во встрече (основная работа).
- Сам факт серии чек-инов 7/14/30 (урок GitHub ICSE 2021).

**Конвертация зёрен (по умолчанию выключена):**
- ✅ Разблокировка тем оформления профиля (космос / акварель / минимализм / графит).
- ✅ Апгрейд знака (золотой / платиновый).
- ✅ **Доброкоины на благотворительность** (паттерн Mail.ru): обмен зёрен на пожертвование в выбранный фонд от имени тенанта.
- ❌ Конвертация в рубли — **по умолчанию выключена**. Включается admin тенанта в `/admin/recognition/budget` с обязательным лимитом ≤5% месячного ФОТ команды и требованием подтверждения CEO/CFO тенанта.

### Фаза 2. Уровни 1–10 «Хранитель памяти команды» (с реальными правами)

| Уровень | Зёрна (lifetime) | Русское название | Открывает право |
|---|---|---|---|
| 1 | 0 | Новичок | Базовые функции |
| 2 | 50 | Участник | Может комментировать чужие чек-ины |
| 3 | 150 | Регулярный | Блок «Мой вклад» на дашборде |
| 4 | 400 | Активный | Создавать метки для идей |
| 5 | 800 | Опытный | **Право подтверждать идеи коллег** в backlog команды |
| 6 | 1500 | Эксперт | **Предлагать регламент** (`Regulation`) |
| 7 | 2800 | Наставник | Recognition Agent предлагает руководителю поставить наставником |
| 8 | 5000 | Архитектор | **Редактировать темы** (`Theme`, кластеры идей) |
| 9 | 8500 | Куратор | Закрывать дубликаты идей без модерации |
| 10 | 14000 | Голос команды | Голос засчитывается с весом ×2 в голосованиях команды |

**Множитель прогрессии тенанта** (`Tenant.gamification.levelProgressionMultiplier`) — admin тенанта задаёт **0.5–2.0** (дефолт 1.0):
- 0.5 — для крупной компании с медленной активностью (пороги ×2).
- 1.0 — стандарт.
- 2.0 — для стартапа с быстрой прогрессией (пороги ÷2).

**Принципы:**
- Каждый уровень открывает **реальное право** (Yu-kai Chou Octalysis: уровень без права = empty progress).
- Уровень нельзя потерять — только расти.
- Видим в профиле и команде, **не на топах** (это не соревновательная метрика).
- Руководитель может **досрочно выдать право** через `/admin/users/:id/permissions` без изменения уровня (для новичка-эксперта).

### Фаза 3. Двусторонние «Спасибо» (расширение `CommentsThanksService`)

**Расширяем:** каждое «Спасибо» даёт зёрна **обеим сторонам** (Centrical-паттерн, подтверждено Bonusly 2025).

**Опциональный тег причины** (фиксированный список + свободное поле):
- Помог разобраться
- Дал контекст
- Спас от ошибки
- Поделился знанием
- Ускорил мою работу

Опционально: свободное поле «Уточнение» (до 200 символов). Тег + уточнение → +0.3 к множителю качества AI.

**AI quality scoring (Bonusly Gratitude Gauge-стиль)** — для каждого «Спасибо» Recognition Agent в реальном времени:
1. **Конкретность**: содержит ли упоминание контекста / задачи / факта.
2. **Подлинность**: длина, тон, не шаблон, не повтор.
3. **Соответствие ценностям**: связь с `Tenant.values`.

Score = взвешенное среднее 0..1.5. Влияет на множитель зёрен.

**Anti-circular detection** — отдельный `QualityPatternDetectorCron`:
- Пара A↔B обменялась >5 раз за 7 дней в обе стороны → `pattern: circular_thanks`, severity warn.
- Группа >3 человек с >50% взаимных «спасибо» внутри группы → `pattern: kudos_ring`, severity warn.
- Кластеризация по времени (>5 благодарностей за минуту от одного отправителя) → `pattern: time_clustering`, severity warn.

При severity = warn — начисление зёрен по подозрительным транзакциям × 0.5; при severity = block (через admin) — начисление 0.

### Фаза 4. Серия чек-инов с Сохранением серии (без зёрен за факт)

**Сейчас:** `currentCheckinStreak`, `longestCheckinStreak` в `ContributionSnapshot`.

**Делаем:**
- Каждое воскресенье автоматически начисляется **1 Сохранение серии** (cap 2 в запасе).
- При пропуске дня → Сохранение серии тратится автоматически, серия не прерывается.
- Прерывание серии (Сохранения закончились) → `longestStreak` сохраняется как трофей.
- Вехи 7/14/30/60 дней → **только знак + публичное признание + сообщение в Telegram**. **БЕЗ начисления зёрен** (урок GitHub ICSE 2021: streak'и провоцируют минимально-полезные действия).
- Веха 30 дней → Recognition Agent отправляет AI-благодарность руководителю с упоминанием.

### Фаза 5. Мини-лиги команды (опт-ин через явный выбор)

**Лига = команда** (из `Team`, до 30 человек). Команды >30 → подгруппы (хэш user_id).

**Опт-ин через явный выбор на знакомстве (forced choice):**
- Не default-true, не default-false.
- При первом входе после релиза v2 — экран «Хотите участвовать в лиге команды? — Да / Нет / Позже (напомнить через месяц)».
- Это даёт opt-in 60–80% (паттерн Duolingo/Headspace без негативного эффекта на отказников).
- В любой момент можно поменять в `/me/settings/gamification`.

**Что показывает:**
- Топ-5 по зёрнам за **текущую неделю** (пн–вс).
- Текущий пользователь всегда виден: либо в топ-5, либо отдельной строкой «Вы на N месте — продолжайте».
- **Никогда не показываем последние места** (Matthews & Kelemen 2024-2025 JoM: дно лиги → upward comparison → зависть → снижение OCB).
- Дно лиги — **приватно у каждого**: показывается только им в их личной зоне.

**Сброс:** воскресенье 23:59 локального времени тенанта.

**Награды за неделю:**
- Топ-1 в лиге: знак «Звезда недели» (визуально, без бонуса зёрен).
- Все в топ-3: упоминание в `TeamSpotlightWidget` у руководителя.

**Graceful degradation для команд <5:**
- Если в команде <5 человек → лига **автоматически выключается**.
- Вместо лиги показываем личный прогресс «рост относительно себя прошлой недели» (см. Фазу 6).
- Категориальные топ-3 в команде <5 — выключены.

### Фаза 6. Категориальные топ-3 + личный прогресс «рост относительно себя»

**6.1. Категориальные топ-3 (вместо единого рейтинга)**

На странице `/team/:teamId/highlights` показываем 3 параллельных топ-3 по командe:
- 🤝 **Помощники недели** — топ-3 по полученным «Спасибо».
- 💡 **Идеаторы недели** — топ-3 по статусам `idea.in_review / in_development / shipped`.
- 📝 **Постоянные недели** — топ-3 по числу чек-инов с рефлексией качества ≥ 0.5.

**Принципы:**
- Сбрасывается еженедельно.
- 3 категории → 9 позиций → больше людей попадают в топ.
- Нет «худших» категорий — только позитивные.
- Опт-аут глобальный: «Не показывать меня в публичных топах» в `/me/settings/gamification`.

**Опц. общекомпанейский топ** (только категория «Помощники», с двойным подтверждением CEO/CFO тенанта в `/admin/recognition/company-top`) — для крупных тенантов 100+ человек. Дефолт выключен.

**6.2. Личный прогресс «рост относительно себя» (паттерн GitHub contribution graph + Song 2018)**

На странице `/me/contributions` дополнительно показываем:

```
┌──────────────────────────────────────────────┐
│  Ваш ритм · последние 12 недель              │
├──────────────────────────────────────────────┤
│  ▓▓▓░  ▓▓▓░  ▓▓▓▓  ▓▓░░  ▓▓▓░  ▓▓▓░  ...    │
│  Эта неделя: 47 зёрен (на 12% больше прошлой) │
│                                              │
│  Лучшие практики людей, у кого +20% к себе:  │
│  • Анна: пишет рефлексии 3–4 раза в неделю   │
│  • Игорь: ставит уточняющие вопросы коллегам │
└──────────────────────────────────────────────┘
```

**Зачем «рост относительно себя»:**
- Song et al. 2018 (Management Science): bottom-ranked workers получают +10.9%, **но только** при показе лучших практик.
- Не даёт upward comparison → нет зависти / снижения OCB.
- GitHub contribution graph — production-проверенный паттерн соревнования с собой.

Виджет `<PersonalRhythmWidget>` показывается на `/me` всем — независимо от опт-ина в лигу.

### Фаза 7. Telegram-канал мотивации (расширение Recognition Agent)

**Текущее:** Recognition Agent шлёт еженедельный дайджест.

**Делаем дополнительно:**

**Триггеры (событийные, не cron):**

| Событие | Сообщение | Anti-spam |
|---|---|---|
| 9:00 локального рабочего дня, если утренний отчёт не сделан | «🌅 Доброе утро! В команде {team} уже {n_done} коллег написали утренний отчёт. Ваша очередь?» | Только если ещё не написал; макс 1/день |
| Получил «Спасибо» с тегом | «🤝 {имя_отправителя} поблагодарил вас за «{контекст}». +{coins_you} зёрен вам, +{coins_them} ему.» | Группируем по 30 мин (если 3 спасибо подряд — одно сообщение «3 коллег поблагодарили») |
| Серия 7/14/30/60 дней | «🔥 Серия {n} дней. Команда видит полную картину благодаря вам.» | Только на вехах |
| Идея в `in_development` | «💡 Ваша идея «{title}» в работе. +50 зёрен. Ваша {n}-я идея в разработке.» | Сразу |
| Повышение уровня | «🎓 Уровень {n} «{level_name}». Открыто: {new_permission}» | Сразу |
| 19:00 воскресенья | «📊 Итоги недели: {n_отчётов}, {n_спасибо} от коллег, +{зёрна}. В лиге команды на {league_rank} месте.» | Только если есть вклад; никаких пустых дайджестов |
| 14 дней подряд на дневном cap'e | «Вы много вкладываете в команду. Не забывайте отдыхать — пауза тоже часть ритма.» | Антивыгорание (см. ниже) |
| Руководителю, ежемесячно | «Эти коллеги получили признание AI, но вы ещё не благодарили их лично: Анна, Игорь, Маша. [Сказать спасибо]» | Защита от AI-фальши |

**Жёсткий anti-spam:**
- Hard cap: **3 сообщения/день/человек** от Recognition Agent.
- **Тихие часы:** 22:00–8:00 локального времени пользователя (а не глобального тенанта).
- **Локальный часовой пояс:** утренний пинг идёт в 9:00 локального каждого, не один глобальный пинг.
- **Варьируемость:** в `RecognitionMessageTemplate` храним **5–8 формулировок на триггер**; Recognition Agent выбирает случайную, не показывая одну дважды за 7 дней (`SHA256(template) NOT IN last_7_days_sent`).
- **Опт-аут per-trigger:** в `/me/settings/notifications` чекбоксы по типам (могу отключить «утренние пинги», но оставить «получил спасибо»).

**Обоснование порогов:** Slack официальных порогов сообщений/день нет — только rate limit 1 msg/sec/channel и рекомендация дайджестов вместо отдельных сообщений. Microsoft Teams — hard throttle 20 нотификаций/мин/user. Наш порог 3/день на порядки ниже любых платформенных и согласуется со Slack-рекомендацией дайджестинга.

### Фаза 8. Защиты от Goodhart (AI quality + детекторы паттернов)

**8.1. AI Quality Score (расширение Recognition Agent)**

Каждое «Спасибо» / реакция проходит через Recognition Agent (LlmTaskType `recognition-quality-score`):
- **Конкретность** (0..1): есть ли упоминание контекста / задачи / факта.
- **Подлинность** (0..1): длина, тон, повторяемость, шаблонность.
- **Соответствие ценностям** (0..1): связь с `Tenant.values`.

Score = (0.4 × конкретность + 0.3 × подлинность + 0.3 × ценности). Множитель зёрен = 0.5 + score.

Хранится в `ZCoinTransaction.qualityScore`.

**8.2. Паттерн-детектор (`QualityPatternDetectorCron`, 03:00 ежедневно)**

Анализирует `ZCoinTransaction` за вчера на:
- **Циркулярные thanks** (A→B→A): >5 раз/7 дней → `circular_thanks` warn.
- **Kudos rings** (группа 3+ с >50% взаимных благодарностей внутри): warn.
- **Time clustering** (>5 thanks за минуту от одного): warn.
- **Минимально-полезные действия** (паттерн GitHub ICSE 2021): чек-ин <30 секунд + длина <50 символов + регулярно в одно время → `low_value_action` info (не блокируем, но фиксируем).
- **Спам-благодарность** (одна и та же фраза >3 раз): warn.

Записываются в `RecognitionQualityWarning`. Admin тенанта видит в `/admin/recognition/quality`, может «не начислять зёрна по этому пользователю на N дней».

**8.3. Дневной cap 200 зёрен/человек/день**

Сверх — не начисляется; действие учитывается в счётчиках.

**8.4. Уровень 10 «Голос команды»** достигается не быстрее, чем за **6 месяцев** (с учётом множителя прогрессии тенанта).

### Фаза 9. Inflection point мониторинг (НОВОЕ — Matthews & Kelemen 2024-2025 JoM)

**Зачем:** академический консенсус 2024-2025 требует явно определять «точку перехода в токсичность» для любой соревновательной системы. Без этого нельзя различить «работает» и «начинает вредить».

**Метрики (Prometheus + HR-аналитика в `/admin/recognition/health`):**

| Метрика | Зелёная зона | Жёлтая зона (warn) | Красная зона (alert) |
|---|---|---|---|
| % спасибо с qualityScore < 0.5 | < 15% | 15–30% | > 30% |
| % участников лиги с 0 зёрен за неделю | < 20% | 20–40% | > 40% |
| Сред. длина текста спасибо | > 50 симв | 30–50 симв | < 30 симв |
| Темп роста `circular_thanks` warns | < 1/нед | 1–3/нед | > 3/нед |
| Opt-out rate из лиги за месяц | < 5% | 5–15% | > 15% |
| Сред. кол-во сообщений Telegram, заблокированных opt-out, на пользователя | < 1/день | 1–2/день | > 2/день |

**Действия:**
- Жёлтая зона → автоматическое уведомление admin тенанта в `/admin/recognition/health`.
- Красная зона → автоматическое **уведомление admin тенанта + Probe Agent шлёт руководителю** «Геймификация в команде {team} даёт признаки токсичности. Подумайте о приостановке».
- В критической ситуации — admin тенанта может **поставить геймификацию на паузу** (`Tenant.gamification.paused = true`) на 30 дней. Все начисления приостанавливаются, лиги скрываются, остаётся только Recognition Agent с AI-благодарностями.

### Фаза 10. Антивыгорание + защита от AI-фальши

**10.1. Антивыгорание (сотруднику):**
- Если сотрудник 14 дней подряд достигает дневного cap'a 200 зёрен → `BurnoutDetectorCron` помечает.
- Recognition Agent в ближайший четверг шлёт мягкое сообщение: «Вы много вкладываете в команду. Не забывайте отдыхать — пауза тоже часть ритма».
- Если 21 день подряд на cap'e → опц. сигнал руководителю в `/dashboard/team/health`: «у Иванова признаки переработки, поговорите вживую».

**10.2. Защита от AI-фальши (руководителю):**
- Раз в месяц (`AiFalsenessGuardCron`, 1 число 9:00) — для каждого руководителя:
- Список 3–5 подчинённых, которых **AI хвалит** через Recognition Agent, но руководитель **ни разу не сказал лично спасибо** за месяц.
- Сообщение в Telegram: «Эти коллеги получили признание от AI, но вы их ещё не благодарили лично: Анна, Игорь, Маша. [Сказать спасибо одним нажатием]».
- Кнопка ведёт на форму pre-filled с шаблоном, который руководитель редактирует или отправляет как есть.

### Фаза 11. Сезонные тематические события

**Раз в квартал** — временное событие с **двойными зёрнами за конкретное действие**, не за всё:

| Месяц | Событие | Что × 2 |
|---|---|---|
| Январь | «Месяц идей» | Зёрна за идеи в `in_review` и `in_development` |
| Май | «Неделя помощи» | Зёрна за «Спасибо» с тегом «помог разобраться» / «спас от ошибки» |
| Сентябрь | «Месяц рефлексий» | Зёрна за рефлексии (длина > 200 + quality ≥ 0.5) |
| Декабрь | «Итоги года» | Один раз: персональный отчёт каждому «вот ваш год в команде» — не зёрна, а рефлексия |

**Принципы:**
- События **анонсируются** в Telegram за 3 дня; начало — конкретный день.
- **Не «всегда включены»** — даёт всплеск активности без постоянного давления (защита от усталости от геймификации).
- Сезонные знаки за участие — без рейтинга.

## Модель данных (дельты к существующей схеме)

### Дополнение к `ContributionSnapshot`

```prisma
model ContributionSnapshot {
  // существующие поля...

  zCoinsLifetime         Int   @default(0)
  zCoinsWeekly           Int   @default(0)
  zCoinsMonthly          Int   @default(0)

  level                  Int   @default(1)
  levelXp                Int   @default(0)
  levelUpAt              DateTime?

  streakFreezesAvail     Int   @default(0)
  streakFreezesUsedTotal Int   @default(0)

  daysOnCapStreak        Int   @default(0)   // дней подряд с попаданием в дневной cap (антивыгорание)
  lastBurnoutNudgeAt     DateTime?
}
```

### Новые модели

```prisma
model ZCoinTransaction {
  id                String   @id @default(cuid())
  tenantId          String
  userId            String

  amount            Int                      // положительное / отрицательное (cap-reduction)
  reason            String                   // morning_checkin | evening_checkin | reflection | thanks_received | thanks_given | reaction_received | reaction_given | idea_status_change | level_bonus | seasonal_double | cap_reduction | quality_penalty

  contextEntityType String?
  contextEntityId   String?
  sourceUserId      String?                  // для thanks_given — отправитель

  qualityScore      Decimal  @default(1.0) @db.Decimal(3,2)  // 0.5..1.5

  capped            Boolean  @default(false) // было ли срезано дневным cap'ом

  createdAt         DateTime @default(now())

  @@index([userId, createdAt])
  @@index([tenantId, reason])
  @@index([sourceUserId, createdAt])         // для anti-circular detection
}

model Level {
  level              Int      @id            // 1..10
  slug               String   @unique
  nameRu             String                  // «Новичок», «Участник», ...
  description        String   @db.Text
  zCoinsRequired     Int                     // 0, 50, 150, 400, 800, 1500, 2800, 5000, 8500, 14000
  permissionsGranted Json                    // [{code: 'idea.approve', labelRu: 'Право подтверждать идеи'}]
  iconUrl            String?
}

model LeagueParticipation {
  id                String   @id @default(cuid())
  tenantId          String
  teamId            String
  userId            String

  optedIn           Boolean  @default(false)
  optInChoiceAt     DateTime?                // когда сделал явный выбор (forced choice)
  hidden            Boolean  @default(false)

  weeklyZCoins      Int      @default(0)
  weekStartAt       DateTime

  weeklyRank        Int?                     // после сброса
  weeklyPercentile  Int?                     // 0..100 (для приватного «дна лиги»)

  updatedAt         DateTime @updatedAt

  @@unique([teamId, userId, weekStartAt])
  @@index([teamId, weekStartAt])
}

model CategoricalTop {
  id           String   @id @default(cuid())
  tenantId     String
  teamId       String?                       // null = по компании (опц.)

  category     String                        // helpers | ideators | consistent
  weekStartAt  DateTime
  rank         Int                           // 1, 2, 3
  userId       String
  score        Int

  createdAt    DateTime @default(now())

  @@unique([tenantId, teamId, category, weekStartAt, rank])
  @@index([tenantId, weekStartAt])
}

model RecognitionMessageTemplate {
  id           String   @id @default(cuid())
  triggerType  String                        // morning_checkin_nudge | thanks_received | streak_milestone | idea_shipped | level_up | weekly_digest | burnout_nudge | ai_falseness_manager_nudge
  language     String   @default("ru")
  template     String   @db.Text             // плейсхолдеры {first_name}, {team}, ...
  active       Boolean  @default(true)
  weight       Int      @default(1)

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([triggerType, language, active])
}

model RecognitionQualityWarning {
  id           String   @id @default(cuid())
  tenantId     String
  userId       String
  pattern      String                        // circular_thanks | kudos_ring | time_clustering | low_value_action | template_spam
  details      Json
  severity     String   @default("info")     // info | warn | block

  resolvedAt   DateTime?
  resolvedBy   String?
  createdAt    DateTime @default(now())

  @@index([tenantId, userId, createdAt])
}

model UserGamificationSettings {
  userId                       String   @id
  leagueOptIn                  Boolean  @default(false)
  leagueChoiceAt               DateTime?      // forced choice timestamp
  publicTopOptOut              Boolean  @default(false)

  telegramMorningNudge         Boolean  @default(true)
  telegramThanksNotifications  Boolean  @default(true)
  telegramStreakMilestones     Boolean  @default(true)
  telegramIdeaUpdates          Boolean  @default(true)
  telegramLevelUp              Boolean  @default(true)
  telegramWeeklyDigest         Boolean  @default(true)
  telegramBurnoutNudge         Boolean  @default(true)
  telegramAiFalsenessForMgr    Boolean  @default(true)   // только для руководителей

  quietHoursStart              Int      @default(22)
  quietHoursEnd                Int      @default(8)
  timezone                     String   @default("Europe/Moscow")

  updatedAt                    DateTime @updatedAt
}

model SeasonalEvent {
  id           String   @id @default(cuid())
  tenantId     String                        // null = глобально для всех тенантов
  slug         String                        // 'month_of_ideas_2026' и т.п.
  nameRu       String
  description  String   @db.Text
  startsAt     DateTime
  endsAt       DateTime
  doubleZCoinsForReasons Json                // ["idea_status_change"]
  active       Boolean  @default(false)

  createdAt    DateTime @default(now())
}
```

### Дополнения к `Tenant`

```prisma
model Tenant {
  // существующие поля...

  gamificationLevelProgressionMultiplier Decimal @default(1.0) @db.Decimal(3,2)  // 0.5..2.0
  gamificationPaused                     Boolean @default(false)
  gamificationPausedUntil                DateTime?
  gamificationCompanyTopEnabled          Boolean @default(false)
  gamificationCurrencyBudgetRubMonthly   Int     @default(0)     // 0 = выключено
  gamificationCurrencyBudgetCapPercent   Decimal @default(5.0) @db.Decimal(4,2)  // лимит ≤5% ФОТ
}
```

## REST API

```
# Зёрна и уровни
GET    /api/v1/me/z-coins                    # сумма lifetime/weekly/monthly + последние транзакции
GET    /api/v1/me/level                      # уровень + XP + что откроется
GET    /api/v1/levels                        # каталог 10 уровней
GET    /api/v1/persons/:id/level             # уровень коллеги
GET    /api/v1/me/rhythm                     # «рост относительно себя» — 12 недель + best practices

# Лиги
GET    /api/v1/me/league                     # моя лига на текущую неделю
POST   /api/v1/me/league/opt-in              # forced choice = yes
POST   /api/v1/me/league/opt-out             # forced choice = no
POST   /api/v1/me/league/remind-later        # forced choice = later (через месяц)
PATCH  /api/v1/me/league/hide                # скрыть себя в лиге

# Категориальные топы
GET    /api/v1/team/:teamId/tops             # 3 топ-3 на текущую неделю
GET    /api/v1/team/:teamId/tops/history     # история по неделям

# Спасибо с тегом
POST   /api/v1/comments/:id/thanks           # body: { reasonTag?, freeText? }
DELETE /api/v1/comments/:id/thanks

# Серия
GET    /api/v1/me/streak                     # current + longest + Сохранения

# Настройки геймификации
GET    /api/v1/me/settings/gamification
PATCH  /api/v1/me/settings/gamification

# Антивыгорание / AI-фальшь
GET    /api/v1/manager/team/:teamId/recognition-gaps   # для руководителя: «кого AI хвалит, но я не благодарил»
POST   /api/v1/manager/team/:teamId/quick-thanks       # отправить спасибо с pre-filled шаблоном

# Admin
GET    /api/v1/admin/recognition/health                # inflection point мониторинг
GET    /api/v1/admin/recognition/quality-warnings
PATCH  /api/v1/admin/recognition/quality-warnings/:id/resolve
GET    /api/v1/admin/recognition/budget                # бюджет на kudos в рублях
PATCH  /api/v1/admin/recognition/budget
GET    /api/v1/admin/recognition/templates             # CRUD шаблонов
POST   /api/v1/admin/recognition/templates
PATCH  /api/v1/admin/recognition/templates/:id
DELETE /api/v1/admin/recognition/templates/:id
POST   /api/v1/admin/recognition/pause                 # пауза геймификации
POST   /api/v1/admin/recognition/resume
GET    /api/v1/admin/recognition/seasonal-events
POST   /api/v1/admin/recognition/seasonal-events
PATCH  /api/v1/admin/recognition/level-multiplier      # 0.5..2.0
```

Все DTO — через `nestjs-zod`, Swagger `@ApiTags('recognition-v2')`. Все enum-значения (`reason`, `pattern`, `category`) — справочник в `second-brain/13_glossary/copy-strings.ru.md` с русскими лейблами.

## Cron / Workers

| Имя | Расписание | Что делает |
|---|---|---|
| `ZCoinAwarderWorker` (BullMQ event-driven) | по событиям | Подписан на `checkin.created`, `thanks.created`, `reaction.created`, `idea.status.changed`, `probe.answered`. Применяет AI quality score, дневной cap, циркулярную защиту. |
| `WeeklyLeagueResetCron` | `0 0 * * MON` | Закрывает прошлую неделю, рассчитывает `weeklyRank` и `weeklyPercentile`, создаёт записи на новую. |
| `CategoricalTopsBuilderCron` | `5 0 * * MON` | Пересчитывает 3 топ-3 + опц. общекомпанейский |
| `StreakFreezeReplenishCron` | `0 0 * * SUN` | +1 Сохранение серии (cap 2) |
| `LevelUpDetectorCron` | `*/15 * * * *` | Проверяет порог lifetime, повышает, шлёт уведомление, выдаёт права (с учётом multiplier тенанта) |
| `QualityPatternDetectorCron` | `0 3 * * *` | Детектит circular_thanks / kudos_ring / time_clustering / low_value_action / template_spam |
| `MorningCheckinNudgeCron` | `0 9 * * 1-5` локального | Сегментация по timezone, шлёт пинг если не сделал утренний отчёт |
| `WeeklyDigestCron` | `0 19 * * SUN` локального | Личный дайджест если есть вклад |
| `BurnoutDetectorCron` | `0 12 * * THU` | Помечает `daysOnCapStreak >= 14`, шлёт «отдохните» |
| `AiFalsenessGuardCron` | `0 9 1 * *` | 1 число месяца — руководителю «кого AI хвалит, а вы нет» |
| `InflectionPointCron` | `0 4 * * *` | Считает 6 метрик из Фазы 9, помечает зоны, шлёт уведомления admin |
| `SeasonalEventActivatorCron` | `0 0 * * *` | Включает/выключает сезонные события по расписанию |

## Frontend

### Новые страницы

| Путь | Содержимое |
|---|---|
| `/me/contributions` | Профиль вклада: зёрна, уровень, знаки, история, **+ `<PersonalRhythmWidget>`** |
| `/me/level-journey` | Карта 10 уровней с прогрессом + множитель тенанта |
| `/me/settings/gamification` | Все опт-ин/опт-аут + тихие часы + timezone |
| `/team/:teamId/highlights` | 3 категориальных топ-3 + мини-лига (если опт-ин) |
| `/team/:teamId/health` (для руководителя) | Здоровье признания + список «кого AI хвалит, а вы не благодарили» |
| `/admin/recognition/health` | Inflection point мониторинг (6 метрик) |
| `/admin/recognition/quality` | Quality warnings |
| `/admin/recognition/budget` | Бюджет на kudos в рублях |
| `/admin/recognition/templates` | CRUD шаблонов сообщений |
| `/admin/recognition/seasonal-events` | Сезонные события |

### Виджеты

- `<MyContributionsWidget>` — на `/me`, `/dashboard`. Зёрна + уровень + серия + знаки.
- `<PersonalRhythmWidget>` — на `/me/contributions`. 12-недельная гистограмма «рост относительно себя» + примеры лучших практик.
- `<TeamLeagueWidget>` — на `/team/:teamId`, `/dashboard` команды. Топ-5 + «Вы на N месте».
- `<CategoricalTopsWidget>` — на `/dashboard` руководителя.
- `<LevelUpToast>` — анимированный (один раз при повышении уровня).
- `<TeamHealthBadge>` — для руководителя: зелёная / жёлтая / красная зона геймификации команды.
- `<LeagueOptInModal>` — forced choice на знакомстве: Да / Нет / Позже.

### UX-правила (обязательно)

- **Никаких всплывающих окон / звуков при начислении зёрен** — тихая подпись «+10» + строка в истории.
- **Повышение уровня может анимироваться** (редкое событие).
- **Никаких красных строк** — отсутствие в топе не подсвечивается.
- **Опт-аут везде** — в каждом виджете кнопка «Скрыть» одним нажатием.
- **Язык:** только русский, без англицизмов (см. правила копи и memory).

## Telegram-копи (примеры шаблонов)

Сидится в `RecognitionMessageTemplate` через `seed-recognition-v2-templates.ts`. По 5–8 шаблонов на триггер.

```
[morning_checkin_nudge]
1) «🌅 Доброе утро! В команде {team} уже {n_done} коллег написали утренний отчёт. Ваша очередь?»
2) «Привет! Утренний отчёт занимает 30 секунд — расскажите, какой у вас фокус сегодня.»
3) «🌅 Доброе утро, {first_name}. Команда уже на старте — присоединяйтесь.»
4) «Утренний отчёт помогает {team} видеть общий план. Поделитесь своим?»
5) «🌅 День начинается. Что планируете двигать сегодня?»

[thanks_received]
1) «🤝 {from_name} поблагодарил вас за «{context}». +{coins_you} зёрен вам, +{coins_them} ему.»
2) «Вас отметили: «{from_name}: {reason_tag_label}». Спасибо, что делитесь экспертизой.»
3) «🤝 +{coins_you} зёрен за помощь — {from_name} оценил.»

[streak_milestone]
1) «🔥 Серия {n} дней. Команда видит полную картину благодаря вам.»
2) «🔥 {n} дней подряд — отличная дисциплина отчётов.»

[idea_shipped]
1) «💡 Ваша идея «{title}» теперь в работе. +{coins} зёрен. Это ваша {n}-я идея в разработке.»

[level_up]
1) «🎓 Уровень {n} «{level_name}». Открыто: {permission_label}»

[weekly_digest]
1) «📊 Итоги недели: {n_отчётов} отчётов, {n_спасибо} спасибо от коллег, +{зёрна} зёрен. В лиге команды вы на {league_rank} месте.»

[burnout_nudge]
1) «Вы много вкладываете в команду. Не забывайте отдыхать — пауза тоже часть ритма.»
2) «Заметили, что вы держите высокий темп уже {n_days} дней. Берегите себя.»

[ai_falseness_manager_nudge]
1) «Эти коллеги получили признание от AI на этой неделе, но вы ещё не благодарили их лично: {list_names}. [Сказать спасибо]»
```

## Пробные сигналы (probe-triggers)

- `low_team_league_participation` — у Probe Agent: «команда А не использует лигу (<20% опт-ин) — что у руководителя?»
- `level_up_without_recognition` — «{X} поднялся до уровня 6 за месяц, но получил 0 «спасибо» — посмотрите».
- `quality_warning_spike` — «за неделю >5 quality warnings в команде — посмотрите на культуру».
- `manager_zero_thanks` (НОВЫЙ) — «руководитель {X} за месяц 0 ручных «спасибо» подчинённым, но AI хвалит — мягко напомнить».
- `team_dead_gamification` (НОВЫЙ) — «команда {team}: 0 opt-in после месяца, 0 спасибо → предложить руководителю выключить геймификацию для команды без потери лица».
- `team_red_zone_inflection` (НОВЫЙ) — «у команды {team} 3+ метрики в красной зоне — посмотрите».

## Метрики Prometheus

```
# Базовые
z_coins_awarded_total{tenant, reason}
z_coins_capped_total{tenant, reason}                    # срезано дневным cap'ом
z_coins_quality_penalty_total{tenant}                   # срезано множителем качества < 1
level_ups_total{tenant, new_level}
league_opt_in_rate{tenant}                              # gauge
league_opt_out_rate{tenant}                             # gauge
league_active_participants{tenant, team}                # gauge
categorical_top_changes_total{tenant, category}
streak_freezes_used_total{tenant}
telegram_messages_sent_total{tenant, trigger}
telegram_messages_suppressed_total{tenant, reason}      # quiet_hours | opt_out | daily_cap | duplicate_window
recognition_quality_warnings_total{tenant, pattern}
z_coin_circular_pattern_blocked_total{tenant}

# Inflection point (НОВОЕ)
recognition_quality_score_low_share{tenant}             # gauge: доля спасибо с qualityScore < 0.5
league_zero_share{tenant}                               # gauge: % участников с 0 зёрен/неделю
recognition_text_avg_length{tenant}                     # gauge
inflection_zone{tenant, metric, zone="green|yellow|red"} # gauge enum

# Антивыгорание / AI-фальшь
burnout_nudges_sent_total{tenant}
ai_falseness_manager_nudges_sent_total{tenant}
ai_falseness_manager_thanks_after_nudge_total{tenant}   # для оценки эффективности

# Сезонные
seasonal_event_active{tenant, slug}                     # gauge enum
seasonal_event_participants_total{tenant, slug}
```

## RBAC (дополнения к policy.csv)

- `z_coin_transaction` — read (свои + admin тенанта), write (system/cron)
- `level` — read (все), write (admin платформы)
- `user_level` — read (все), write (только cron + admin тенанта для досрочной выдачи прав)
- `league_participation` — read (свои + одногруппники), write (свои opt-in/out)
- `categorical_top` — read (все в команде + admin), write (только cron)
- `recognition_message_template` — read (admin тенанта), write (admin платформы; опт-ауты — admin тенанта)
- `recognition_quality_warning` — read (admin тенанта), write (только system)
- `user_gamification_settings` — read/write (свои)
- `tenant_gamification_config` — read (все в тенанте), write (admin тенанта)
- `seasonal_event` — read (все), write (admin платформы или admin тенанта для своих)

## Связь с другими модулями

- **`recognition`** — расширение существующего, не отдельный модуль.
- **`probe-agent`** — 3 новых триггера (см. выше).
- **`activity-feeds`** — публикация level-up и идей-в-разработке.
- **`telegram-bot`** — отправка через существующий glob bot (см. memory feedback_conversational_channels_principles).
- **`orgs` + `teams`** — лиги по `Team`.
- **`ideas`** — статусы триггерят зёрна.
- **`checkins`** — `checkin.created` триггерит зёрна и серии.

## Безопасность и конфиденциальность

- История зёрен видна только владельцу и admin тенанта.
- Категориальные топы и лиги показывают только имена, не контекст вклада (детали — в `/persons/:id/contributions` через RBAC).
- Telegram — только тем, кто привязал бота (через `TelegramChannelConnection`).
- При деактивации сотрудника — зёрна остаются в `ContributionSnapshot`, пользователь исчезает из активных лиг и топов.
- `RecognitionQualityWarning` видна только admin тенанта, не самому пользователю (не подсказываем накрутчику, что он спалился).

## DoD (по фазам)

- [ ] **Фаза 1. Зёрна.** Модели, `ZCoinAwarderWorker`, дневные капы, AI quality score интеграция, integration tests на каждое событие. Endpoint `/api/v1/me/z-coins`.
- [ ] **Фаза 2. Уровни 1–10.** Модель `Level` + seed 10 уровней с русскими названиями, `LevelUpDetectorCron`, права через Casbin, множитель тенанта, endpoint `/api/v1/me/level`, страница `/me/level-journey`.
- [ ] **Фаза 3. Двусторонние «спасибо».** Расширение `CommentsThanksService`: зёрна обеим сторонам, теги причины + свободное поле, AI quality scoring (Bonusly Gratitude Gauge паттерн), `QualityPatternDetectorCron` (5 паттернов). Tests.
- [ ] **Фаза 4. Серия + Сохранение серии.** Поля в `ContributionSnapshot`, `StreakFreezeReplenishCron`, авто-расход в `StreakDetectorCron`. **БЕЗ начисления зёрен за серию**. Endpoint `/api/v1/me/streak`.
- [ ] **Фаза 5. Мини-лиги + forced choice.** Модель `LeagueParticipation`, `WeeklyLeagueResetCron`, endpoints opt-in/out/remind-later, `<LeagueOptInModal>` на онбординге, `<TeamLeagueWidget>`, страница `/team/:teamId/highlights`. **Graceful degradation для <5**.
- [ ] **Фаза 6. Категориальные топ-3 + личный ритм.** `CategoricalTop` + `CategoricalTopsBuilderCron`, endpoint топов, виджет, **`<PersonalRhythmWidget>` с примерами лучших практик**.
- [ ] **Фаза 7. Telegram-канал.** `RecognitionMessageTemplate` + seed 5–8 шаблонов на 8 триггеров, `MorningCheckinNudgeCron` с локальным timezone, event-driven отправка, **rate-limiter 3/день + тихие часы 22-8 локальные**, opt-out per-trigger.
- [ ] **Фаза 8. Защиты Goodhart.** AI quality scoring через Recognition Agent, `QualityPatternDetectorCron` (5 паттернов), admin `/admin/recognition/quality`, дневной cap 200.
- [ ] **Фаза 9. Inflection point мониторинг.** 6 метрик, `InflectionPointCron`, `/admin/recognition/health`, авто-уведомления admin при жёлтой/красной зоне, **пауза геймификации** на 30 дней.
- [ ] **Фаза 10. Антивыгорание + AI-фальшь.** `BurnoutDetectorCron`, `AiFalsenessGuardCron`, endpoint `/api/v1/manager/team/:teamId/recognition-gaps`, виджет для руководителя.
- [ ] **Фаза 11. Сезонные события.** `SeasonalEvent`, `SeasonalEventActivatorCron`, 4 годовых события в seed.
- [ ] **Frontend settings.** `/me/settings/gamification` со всеми чекбоксами + timezone + тихие часы.
- [ ] **Метрики Prometheus** — 20+ метрик в Grafana.
- [ ] **Unit + integration tests** для каждого worker'а и cron'а.
- [ ] **apply-prod-deploy.ts** — добавлены seed-скрипты (`seed-levels.ts`, `seed-recognition-v2-templates.ts`, `seed-seasonal-events.ts`).
- [ ] **second-brain** обновлён: `02_architecture/data-model.md`, `01_projects/workers-queues.md`, `01_projects/api-layer.md`, `02_architecture/module-map.md`.
- [ ] **docs/operations/prod-deploy-log.md** — Шаги 1 (ENV), 4 (schema), 7 (seed), 12 (smoke).
- [ ] **second-brain/13_glossary/copy-strings.ru.md** обновлён всеми новыми лейблами.

## Срок

**2–3 человеко-недели** при последовательной работе (Фазы 1→11). При параллелизации (3 фронт + 3 бэк) — 1.5 недели.

## Зафиксированные решения (вместо open questions)

В предыдущей версии ТЗ было 5 открытых вопросов. Все закрыты решениями с обоснованием. Дополнительно закрыты 4 открытых вопроса второго pass deep-research.

### 1. Конвертация зёрен в рубли

**Решение:** по умолчанию выключена. Включается admin тенанта в `/admin/recognition/budget` с обязательным лимитом ≤5% месячного ФОТ команды и требованием подтверждения CEO/CFO тенанта.

**Обоснование:** Wells Fargo 2016 ($3 млрд штраф) + Mail.ru-практика (без денежной конвертации) + наш приоритет — память компании, а не премиальная система. Включение как опция Pro-тарифа без давления на остальные.

### 2. Категориальные топ-3 — команда или компания

**Решение:** только команда по умолчанию. Опц. общекомпанейский топ — только категория «Помощники», с двойным подтверждением CEO/CFO тенанта, для крупных тенантов 100+ человек.

**Обоснование:** команда — естественный соревновательный круг (Dunbar number 15–30). Almeida 2023 ToSE — глобальные лидерборды среди самых проблемных элементов. Категории «Идеаторы» и «Постоянные» на уровне компании теряют контекст и провоцируют upward comparison (Matthews & Kelemen 2024-2025).

### 3. Уровни 1–10 — настраиваемость порогов

**Решение:** пороги фиксированные в схеме (0, 50, 150, 400, 800, 1500, 2800, 5000, 8500, 14000), но admin тенанта задаёт `gamificationLevelProgressionMultiplier` 0.5–2.0 (дефолт 1.0).

**Обоснование:** одна формула для consistency аналитики и онтологии прав; множитель даёт гибкость (стартап ×2 — быстрая прогрессия, крупный энтерпрайз ×0.5 — медленнее). 14000 зёрен / 1.0 ≈ 6 месяцев активного использования.

### 4. Опт-ин по умолчанию для лиги

**Решение:** **forced choice на знакомстве**. Не default-true, не default-false. При первом входе после релиза v2 — модальное окно с тремя кнопками: «Да» / «Нет» / «Позже (напомнить через месяц)».

**Обоснование:** PMC12263921 2025: для отказников обязательная геймификация даёт отрицательный эффект (нельзя default-true). При default-false никто не подключится (нет точки касания). Forced choice = опт-ин 60–80% по практике Duolingo/Headspace без негатива.

### 5. Reason-теги в «Спасибо»

**Решение:** **фиксированный список 5 тегов** (помог разобраться / дал контекст / спас от ошибки / поделился знанием / ускорил мою работу) + **опциональное свободное поле** «Уточнение» до 200 символов.

**Обоснование:** фиксированный список даёт consistency для AI quality scoring и аналитики; свободное поле — для нюансов. Тег + уточнение → +0.3 к множителю качества (стимулирует осмысленные благодарности).

### 6. РФ-кейсы — отсутствие публичных метрик opt-in/DAU/retention

**Решение:** **бенчмарки строим сами на первых тенантах Z**. Через 4 недели после релиза Фазы 5 (лиги) проводим первое замерение метрик inflection point: `league_opt_in_rate`, `telegram_messages_suppressed_total`, `recognition_quality_warnings_total`, `recognition_quality_score_low_share`. Если хоть одна метрика в красной зоне — Фазы 6–10 откатываем или переделываем.

**Обоснование:** второй pass deep-research подтвердил, что ни один РФ-вендор (Pryaniky, Mirapolis, Поток, Mail.ru/VK) не публикует opt-in/DAU/retention. Это системный пробел сегмента. Mail.ru-кейс структурно подтверждает наш дизайн, но не даёт цифр.

### 7. Duolingo Leagues — нет независимой эмпирики

**Решение:** **мини-лиги ≤30 + weekly reset формулируем как гипотезу с inflection point**, а не как доказанное решение. Через 8 недель замерения — если жёлтая/красная зоны не возникли — оставляем; если возникли — урезаем до личного ритма «рост относительно себя».

**Обоснование:** второй pass не нашёл независимых исследований Duolingo Leagues. Опровергнут тезис, что подиум top-3 создаёт мощный соревновательный стимул. Гипотеза остаётся правдоподобной (Hammedi 2021 показывает: большие лидерборды → стресс; малые группы — нет), но требует валидации на наших данных.

### 8. Конкретные пороги anti-gaming у конкурентов

**Решение:** **наши пороги** — циркулярная защита >5 раз/7 дней, time clustering >5/мин, kudos ring >50% взаимных в группе 3+. Через 1–2 месяца — тюним на реальных данных `RecognitionQualityWarning`.

**Обоснование:** Bonusly и Centrical не публикуют конкретных порогов anti-gaming. Наши значения — обоснованные догадки из обзора литературы; tuning на наших данных — рабочая стратегия для нишевой адаптации.

### 9. Workhuman AI Coach / Achievers Listen — production-функции

**Решение:** **не используем как референс**. Опираемся только на верифицированные Bonusly Gratitude Gauge + Bonusly Recognition Quality Score + Kudos AI и собственный Recognition Agent.

**Обоснование:** второй pass deep-research не нашёл production-описаний Workhuman AI Coach и Achievers Listen — только маркетинговые слайды. Дифференциатор Z — мы превосходим Kudos AI (только генерация) и сопоставляемся с Bonusly (quality scoring), но идём дальше — детектим circular patterns и time clustering, чего у Bonusly публично нет.

---

## Источники и исследовательская база

### Первичные (peer-reviewed)
- Zhang et al. 2025 — Frontiers in Psychology, N=418, β=0.31, p<0.001 на engagement.
- PMC12263921 (2025) — Frontiers, N=217, employee acceptance moderation.
- Almeida, Kalinowski, Uchoa, Feijó 2023 — Information and Software Technology Vol 156, систематический mapping-обзор 87 статей, arXiv:2305.08346.
- Matthews & Kelemen 2024-2025 — Journal of Management 51(1), DOI 10.1177/01492063241266157, интегративный обзор 131 эмпирической работы.
- Moldon, Strohmaier & Wachs 2021 — ICSE, GitHub natural experiment n=433k, arXiv:2006.02371.
- Song, Tucker, Murrell & Vinson 2018 — Management Science, DOI 10.1287/mnsc.2017.2745, естественный эксперимент в emergency department.
- Hammedi/Berger 2021 — MDPI Sustainability, leaderboard positions and stress.
- Kim 2026 — CMU Tepper, Ethics and Information Technology, DOI 10.1007/s10676-025-09885-8.

### Production-источники
- Bonusly Gratitude Gauge + Recognition Quality Score: [bonusly.com/post/new-bonusly-ai-features-recognition-just-got-a-whole-lot-smarter](https://bonusly.com/post/new-bonusly-ai-features-recognition-just-got-a-whole-lot-smarter), [bonusly.com/solutions/bonusly-ai](https://bonusly.com/solutions/bonusly-ai).
- Kudos AI Recognition Assistant: [kudos.com/platform/ai-recognition-assistant](https://www.kudos.com/platform/ai-recognition-assistant).
- Centrical Gamification: [centrical.com/platform/gamification/](https://centrical.com/platform/gamification/).
- Slack API guidelines: [api.slack.com/start/planning/guidelines](https://api.slack.com/start/planning/guidelines).
- Microsoft Teams notifications throttle: [learn.microsoft.com/en-us/graph/teams-activity-feed-notifications-best-practices](https://learn.microsoft.com/en-us/graph/teams-activity-feed-notifications-best-practices).

### РФ-кейс
- Mail.ru / VK интранет: gamification-now.ru, friend.work, vc.ru/insidevk/54334.
- Yahoo Answers как канон провала peer-points (Wikipedia + IBIMA 2024).

### Доброкоины как паттерн
- Mail.ru ДоброКоины на благотворительность (friend.work-интервью с Лией Королевой).

---

## Итог (заполняется по мере реализации)

_Реализовано целиком / частично / отменено — заполнить после Фазы 11._

_Дата старта: ___ . Дата завершения: ___ ._
