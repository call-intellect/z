# Реестр UI-строк (русский)

Авторитетный источник копирайта. Любая user-facing строка в продукте берётся из этого файла. При локализации/переводе на другие языки — сохранять смысл и тон, не дословно.

## Принципы

См. [13-glossary.md](../13-glossary.md) и [06-ux-ui.md](../06-ux-ui.md), раздел Tone of voice.

## Глобальные

| Ключ | Текст |
|---|---|
| `app.title` | Память компании |
| `app.welcome` | Это память вашей компании. |
| `nav.today` | Сегодня |
| `nav.week` | Неделя |
| `nav.month` | Месяц |
| `nav.map` | Карта |
| `nav.branches` | Ветки |
| `nav.themes` | Темы |
| `nav.decisions` | Решения |
| `nav.ideas` | Идеи |
| `nav.risks` | Риски |
| `nav.goals` | Цели |
| `nav.knowledge` | База знаний |
| `nav.chat` | Спросить |
| `nav.dump` | Дамп |
| `nav.me` | Я |
| `nav.admin` | Управление |
| `nav.settings` | Настройки |
| `nav.signout` | Выйти |

## Действия

| Ключ | Текст |
|---|---|
| `action.send` | Отправить |
| `action.save` | Сохранить |
| `action.cancel` | Отмена |
| `action.confirm` | Подтвердить |
| `action.reject` | Отклонить |
| `action.merge` | Слить |
| `action.split` | Разделить |
| `action.archive` | В архив |
| `action.restore` | Восстановить |
| `action.export` | Выгрузить |
| `action.import` | Загрузить |
| `action.refresh` | Обновить |
| `action.search` | Найти |
| `action.add` | Добавить |
| `action.remove` | Убрать |
| `action.delete` | Удалить |
| `action.edit` | Изменить |
| `action.view` | Открыть |
| `action.copy` | Скопировать |
| `action.share` | Поделиться |
| `action.subscribe` | Подписаться |
| `action.unsubscribe` | Отписаться |
| `action.try_again` | Попробовать ещё раз |
| `action.show_source` | Откуда это |
| `action.expand` | Подробнее |
| `action.collapse` | Свернуть |
| `action.start_voice` | Зажми и говори |
| `action.stop_voice` | Стоп |

## Состояния

| Ключ | Текст |
|---|---|
| `state.loading` | Минуту… |
| `state.empty` | Пока пусто |
| `state.error_generic` | Что-то не получилось. Попробуйте ещё раз. |
| `state.error_network` | Не получилось связаться. Проверьте интернет. |
| `state.error_permission` | Этот раздел вам пока не виден. |
| `state.success` | Готово |
| `state.saved` | Сохранил |
| `state.deleted` | Удалил |
| `state.thinking` | Думаю… |
| `state.streaming` | Печатаю… |
| `state.recording` | Слушаю… |
| `state.processing` | Обрабатываю… |
| `state.uploading` | Загружаю… |

## Аутентификация

| Ключ | Текст |
|---|---|
| `auth.signin.title` | Войти |
| `auth.signin.email` | Электронная почта |
| `auth.signin.password` | Пароль |
| `auth.signin.submit` | Войти |
| `auth.signin.forgot` | Забыли пароль? |
| `auth.signin.sso` | Войти через SSO |
| `auth.signout.confirm` | Точно выйти? |
| `auth.welcome.first_time` | Добро пожаловать. Расскажите коротко о компании, и я начну запоминать. |
| `auth.error.invalid` | Не получилось войти. Проверьте данные. |
| `auth.error.locked` | Слишком много попыток. Попробуйте через 15 минут. |

## Дамп

| Ключ | Текст |
|---|---|
| `dump.placeholder.text` | Расскажите всё, что хотите зафиксировать |
| `dump.placeholder.subtitle` | Текстом или голосом — без правил |
| `dump.feedback.recorded` | Записал |
| `dump.feedback.signals_found` | Вижу {count} сигналов: |
| `dump.feedback.linked` | Связал с темами: |
| `dump.feedback.empty` | Спасибо. Запомнил. |
| `dump.feedback.followup` | Хотите добавить ещё что-то? |

## Чат

| Ключ | Текст |
|---|---|
| `chat.welcome` | Привет. Я — память вашей компании. Спрашивайте на русском. |
| `chat.placeholder` | Спросите что-нибудь… |
| `chat.examples.title` | Примеры: |
| `chat.examples.1` | Что я обещал на прошлой неделе? |
| `chat.examples.2` | Какие топ-боли клиентов в марте? |
| `chat.examples.3` | Что мы решили по ценообразованию? |
| `chat.evidence.title` | Источники |
| `chat.no_data_found` | В памяти этого нет. Возможно, вы хотели спросить иначе? |
| `chat.access_limited` | Эти данные не в моей зоне. |

## Сегодня

| Ключ | Текст |
|---|---|
| `today.alignment.title` | Согласованность стратегии |
| `today.alignment.delta_up` | ↑ {value} за неделю |
| `today.alignment.delta_down` | ↓ {value} за неделю |
| `today.learnings.title` | Что узнали сегодня |
| `today.client_voice.title` | Голос клиентов |
| `today.client_voice.top_pain` | Топ боль за неделю |
| `today.client_voice.mentions` | {count} упоминаний от {sources} клиентов |
| `today.reframed.title` | Что я переосмыслил ночью |
| `today.pending.title` | AI ждёт подтверждения |
| `today.pending.empty` | Всё подтверждено. Спасибо. |

## Карта

| Ключ | Текст |
|---|---|
| `map.title` | Смысловая карта |
| `map.empty` | Карта появится, когда накопится достаточно связей. |
| `map.command_hint` | Перетащи или скажи: «Покажи карту по продажам за неделю» |
| `map.timetravel` | Как было N дней назад |

## Темы

| Ключ | Текст |
|---|---|
| `themes.list.title` | Темы |
| `themes.list.empty` | Тем пока нет. Они появятся, когда накопятся сигналы. |
| `theme.weight` | Вес {value} |
| `theme.weight.rising` | растёт |
| `theme.weight.stable` | стабилен |
| `theme.weight.falling` | снижается |
| `theme.signals_count` | {count} сигналов из {sources} источников |
| `theme.appeared` | Появилась {date} |
| `theme.related` | Связано с: |
| `theme.history` | История изменений |
| `theme.correct` | Откорректировать описание |

## Цели и согласованность

| Ключ | Текст |
|---|---|
| `alignment.title` | Согласованность стратегии |
| `alignment.score_label` | {score} из 100 |
| `alignment.submetric.voices` | Слаженность голосов |
| `alignment.submetric.actions` | Связь действий с целями |
| `alignment.submetric.drift` | Скорость дрейфа |
| `alignment.drift.improving` | улучшается |
| `alignment.drift.stable` | стабильно |
| `alignment.drift.worsening` | ухудшается |
| `alignment.alert.drop` | Снижается слаженность по цели «{goal}» — посмотрите детализацию |
| `goals.list.title` | Цели |
| `goal.progress` | Прогресс {percent}% |
| `goal.related_themes` | Связано с темами |
| `goal.active_decisions` | Активные решения: {count} |

## Решения

| Ключ | Текст |
|---|---|
| `decisions.list.title` | Решения |
| `decision.title` | Заголовок решения |
| `decision.rationale` | Почему так |
| `decision.alternatives` | Что рассматривали |
| `decision.consequences.predicted` | Что ожидаем |
| `decision.consequences.actual` | Что получилось |
| `decision.evaluate_consequences` | Оценить результат |
| `decision.decided_by` | Кто решил |
| `decision.decided_at` | Когда решили |

## Идеи и риски

| Ключ | Текст |
|---|---|
| `ideas.list.title` | Идеи |
| `idea.source` | Источник: {source} |
| `idea.effect` | Возможный эффект |
| `idea.complexity` | Сложность |
| `idea.risk_level` | Риск |
| `idea.rating` | Оценка |
| `idea.status.proposed` | предложена |
| `idea.status.considering` | рассматривается |
| `idea.status.accepted` | принята |
| `idea.status.rejected` | отклонена |
| `idea.status.implemented` | реализована |
| `risks.list.title` | Риски |
| `risk.likelihood` | Вероятность |
| `risk.impact` | Влияние |
| `risk.mitigation` | Что делаем |

## Обещания `[СНЯТО 2026-07-01 — соц-слой обещаний удалён, ТЗ commitment-social-layer-cleanup]`

> Страница «Мои обещания» (`/me/promises`) и весь надзорный соц-слой обещаний удалены. Строки ниже больше не используются (оставлены для истории копирайта; не переиспользовать). Обещание остаётся фактом памяти, но отдельного UI «обещаний» нет.

| Ключ | Текст |
|---|---|
| ~~`commitments.list.title`~~ | ~~Мои обещания~~ |
| ~~`commitments.list.empty`~~ | ~~Обещаний пока не зафиксировал~~ |
| ~~`commitment.deadline`~~ | ~~до {date}~~ |
| ~~`commitment.no_deadline`~~ | ~~без срока~~ |
| ~~`commitment.source`~~ | ~~Источник~~ |
| ~~`commitment.status.mentioned`~~ | ~~сказал~~ |
| ~~`commitment.status.acknowledged`~~ | ~~подтвердил~~ |
| ~~`commitment.status.done`~~ | ~~сделал~~ |
| ~~`commitment.status.forgotten`~~ | ~~срок прошёл~~ |

## Настроение

| Ключ | Текст |
|---|---|
| `mood.checkin.title` | Чек-ин на сегодня |
| `mood.checkin.q1` | Как самочувствие? |
| `mood.checkin.q2` | Загрузка адекватна? |
| `mood.checkin.q3` | Понимаешь, что и зачем делаешь? |
| `mood.checkin.q4` | Чувствуешь поддержку коллег? |
| `mood.checkin.q5` | Если что-то блокирует — что именно? |
| `mood.checkin.q6` | Хочешь добавить что-то? |
| `mood.checkin.skip` | Пропустить |
| `mood.checkin.done` | Спасибо. Это останется приватным. |
| `mood.optin.title` | Включить участие в наблюдении за настроением? |
| `mood.optin.body` | AI будет анализировать только открытые сигналы (тон в публичных чатах, нагрузку из календаря). Личные данные видны только вам. Можно отключить в любой момент. |
| `mood.optin.yes` | Включить |
| `mood.optin.no` | Не сейчас |
| `mood.private_alert` | Если хочется поговорить — напишите {trust_contact}. |

## Корректировка (M-26)

| Ключ | Текст |
|---|---|
| `correction.queue.title` | AI ждёт подтверждения |
| `correction.queue.empty` | Всё подтверждено |
| `correction.link.title` | Связь между «{a}» и «{b}» |
| `correction.link.confirm` | Подтвердить |
| `correction.link.reject` | Отклонить |
| `correction.link.reason_label` | Почему вы так думаете? (опционально) |
| `correction.merge.title` | Слить темы «{a}» и «{b}»? |
| `correction.merge.confirm` | Слить |
| `correction.merge.reject` | Не сливать |

## Личный кабинет

| Ключ | Текст |
|---|---|
| `me.title` | Вы — {name} |
| `me.role` | Роль: {role} |
| `me.level` | Уровень: {level} |
| ~~`me.commitments`~~ | ~~Мои обещания~~ `[СНЯТО 2026-07-01 — вкладка «Мои обещания» удалена]` |
| `me.mood` | Моё настроение |
| `me.context` | Мой контекст |
| `me.settings` | Настройки |
| `me.export` | Выгрузить мои данные |
| `me.forget` | Удалить мой след из памяти |
| `me.forget.warning` | Это удалит все ваши сообщения, обещания, настроение. Можно сначала выгрузить. Точно? |
| `me.forget.confirm` | Удалить |

## Уведомления

| Ключ | Текст |
|---|---|
| `notify.alignment_drop` | Снижается слаженность по цели «{goal}» |
| `notify.risk_realized` | Реализовался риск: «{risk}» |
| `notify.theme_spike` | Резко растёт тема: «{theme}» |
| `notify.metric_anomaly` | Существенное изменение: {metric} {direction} на {delta}% |

**Запрещены:**
- «Вы обещали X к Y».
- «У вас 3 просроченных задачи».
- «Не забудьте про дедлайн».
- «Срочно посмотрите!»

## Подтверждения

| Ключ | Текст |
|---|---|
| `confirm.delete` | Точно? Это нельзя отменить. |
| `confirm.archive` | Перенести в архив? |
| `confirm.merge_themes` | Слить эти темы? |
| `confirm.discard_changes` | Изменения не сохранены. Отбросить? |

## Админка

| Ключ | Текст |
|---|---|
| `admin.title` | Управление |
| `admin.sources.title` | Источники |
| `admin.sources.add` | Подключить источник |
| `admin.sources.test` | Проверить подключение |
| `admin.users.title` | Сотрудники |
| `admin.roles.title` | Роли |
| `admin.roles.add` | Добавить роль |
| `admin.branches.title` | Ветки компании |
| `admin.llm.title` | Маршрутизация моделей AI |
| `admin.llm.budget` | Бюджет на месяц |
| `admin.llm.policy` | Политика |
| `admin.retention.title` | Сроки хранения |
| `admin.audit.title` | Журнал доступов |
| `admin.forget.title` | Запросы на удаление |
| `admin.health.title` | Состояние компонентов |

## Сообщения об ошибках

| Ключ | Текст |
|---|---|
| `error.404` | Не нашёл такой страницы |
| `error.403` | Этот раздел вам пока не виден |
| `error.429` | Слишком часто. Подождите минуту. |
| `error.500` | Что-то сломалось. Уже разбираемся. |
| `error.502` | Не получилось связаться. Попробуйте через минуту. |
| `error.503` | Сервис временно недоступен. |
| `error.maintenance` | Идёт обновление. Скоро вернёмся. |
| `error.budget_exceeded` | Бюджет AI на месяц исчерпан. Запросы будут обрабатываться локально (медленнее). |

## Фаза 0c — каркас ЛК

| Ключ | Текст |
|---|---|
| `nav.group.company` | Компания |
| `nav.group.operations` | Оперативка |
| `nav.group.settings` | Настройки |
| `nav.subgroup.coming_soon` | Будет в следующей фазе |
| `nav.subgroup.admin` | Админка |
| `nav.dashboard` | Главная |
| `nav.structure` | Структура |
| `nav.documents` | Документы |
| `nav.roles` | Карты должностей |
| `nav.meetings` | Встречи |
| `nav.cards` | Карточки |
| `nav.tasks` | Задачи |
| `nav.chat_company` | Помощник компании |
| `nav.processes` | Процессы |
| `nav.regulations` | Регламенты |
| `nav.policies` | Политики |
| `nav.metrics` | Метрики |
| `nav.settings_org_admin` | Админка компании |
| `nav.cta.create_meeting` | Создать встречу |
| `org_switcher.z_admin_mode` | Режим Z-Admin |
| `org_switcher.active_label` | Активная компания |
| `org_switcher.switch_label` | Переключиться |
| `org_switcher.switched_toast` | Переключились в компанию: {name} |
| `org_switcher.switch_failed` | Не удалось переключиться, обновите страницу |
| `coming_soon.tooltip` | Появится в Фазе γ |
| `coming_soon.collected_label` | Уже собрано |
| `coming_soon.processes.description` | Сборка бизнес-процессов из встреч и документов появится в следующей фазе. Мы уже копим данные. |
| `coming_soon.regulations.description` | Регламенты и стандарты компании появятся в следующей фазе. Уже сейчас извлекаем их из загруженных документов. |
| `coming_soon.policies.description` | Политики и правила работы появятся в следующей фазе. Мы уже фиксируем их в графе знаний. |
| `coming_soon.metrics.description` | Метрики и пульс компании появятся в следующей фазе. Сейчас собираем сигналы для расчёта. |

## SBA α-1 — Conversational Channels

| Ключ | Текст |
|---|---|
| `nav.me.channels` | Мои каналы |
| `nav.me.notifications` | Уведомления |
| `channels.page.title` | Мои каналы |
| `channels.page.subtitle` | Через какие каналы Кора может с вами общаться: задавать уточняющие вопросы, присылать карточки на модерацию, отвечать на ваш AI-чат. |
| `channels.kind.in_app` | В личном кабинете |
| `channels.kind.email_smtp` | Email |
| `channels.kind.email_imap` | Email (входящие) |
| `channels.kind.telegram_bot` | Telegram |
| `channels.kind.max_bot` | MAX |
| `channels.status.active` | Активен |
| `channels.status.disabled` | Выключен |
| `channels.status.broken` | Сломан |
| `channels.in_app.no_link_required` | Канал работает автоматически — отдельной привязки не требует. |
| `channels.empty` | В этой организации каналы общения ещё не настроены. Канал «В личном кабинете» появится автоматически при первом уведомлении. |
| `channels.bind.button` | Сгенерировать код |
| `channels.bind.instruction` | Не привязан. Сгенерируйте код и отправьте боту командой `/link <код>`. |
| `channels.unbind.button` | Отвязать |
| `channels.unbind.confirm` | Отвязать канал? Уведомления туда больше не будут приходить. |
| `channels.link.code_title` | Код для привязки |
| `channels.link.code_ttl` | Код действителен {minutes} мин. Отправьте боту `/link {code}`. |
| `notifications.page.title` | Уведомления |
| `notifications.page.subtitle` | Здесь Кора задаёт уточняющие вопросы и зовёт на модерацию карточек. Ответы возвращаются обратно в память компании. |
| `notifications.filter.unread` | Непрочитанные |
| `notifications.filter.pending_response` | Ждут ответа |
| `notifications.filter.all` | Все |
| `notifications.empty` | Пока тихо — уведомлений в этом фильтре нет. |
| `notifications.needs_response` | нужен ответ |
| `notifications.event.probe_question` | Уточняющий вопрос |
| `notifications.event.curation_pending` | Нужна модерация |
| `notifications.event.system_message` | Системное сообщение |
| `notifications.event.idea_status_changed` | Изменён статус идеи |
| `notifications.status.queued` | В очереди |
| `notifications.status.sent_partial` | Частично доставлено |
| `notifications.status.delivered` | Доставлено |
| `notifications.status.read` | Прочитано |
| `notifications.status.responded` | Отвечено |
| `notifications.status.failed` | Не доставлено |
| `notifications.detail.question` | Вопрос |
| `notifications.detail.context` | Контекст |
| `notifications.detail.your_answer_label` | Ваш ответ |
| `notifications.detail.your_answer_placeholder` | Напишите ответ… |
| `notifications.detail.respond_button` | Ответить |
| `notifications.detail.dismiss_button` | Пропустить |
| `notifications.detail.delivery_history` | История доставок |
| `notifications.free_note.title` | Свободная заметка |
| `notifications.free_note.subtitle` | Поделитесь мыслью, идеей, фактом или сигналом — Кора добавит это в граф знаний компании. |
| `notifications.free_note.placeholder` | Например: клиент жалуется на медленный отчёт по продажам… |
| `notifications.free_note.submit_button` | Отправить |
| `notifications.free_note.created_toast` | Заметка отправлена в память компании. |
| `mail.subject.probe_question` | Кора спрашивает: уточнение по знаниям компании |
| `mail.subject.curation_pending` | Кора: нужна ваша модерация |
| `mail.subject.system_message` | Кора — уведомление |
| `mail.body.probe_intro` | Кора нашла пробел в памяти компании и просит вас уточнить: |
| `mail.body.curation_intro` | Появилась карточка, которой нужна ваша модерация. |
| `mail.body.signature` | Кора — память компании. |

## Поведение участников (Фаза B — competitor-parity)

| Ключ | Текст |
|---|---|
| `behavior.section.title` | Поведение участников |
| `behavior.team.title` | Поведение команды |
| `behavior.team.period.30d` | за 30 дней |
| `behavior.state.pending` | Метрики считаются. Это занимает обычно 1–2 минуты. |
| `behavior.state.failed.title` | Метрики не удалось рассчитать. |
| `behavior.state.failed.action` | Обновить |
| `behavior.state.low_confidence` | Метрики ориентировочные: качество диаризации низкое |
| `behavior.state.empty_org` | За выбранный период встреч с метриками поведения пока нет. |
| `behavior.metric.totalSpeech` | Всего речи |
| `behavior.metric.silence` | Тишина |
| `behavior.metric.silence.percent` | Средняя тишина |
| `behavior.metric.crossTalk` | Перекрёстная речь |
| `behavior.metric.dominanceIndex` | Индекс доминирования |
| `behavior.metric.dominanceIndex.none` | — |
| `behavior.metric.speakingTime` | Время |
| `behavior.metric.speakingPercent` | % времени |
| `behavior.metric.turns` | Перевороты речи |
| `behavior.metric.monologues` | Монологи |
| `behavior.metric.longestMonologue` | Самый длинный монолог |
| `behavior.metric.questions` | Вопросы |
| `behavior.metric.fillerWords` | Слова-паразиты |
| `behavior.metric.interruptions` | Прерывания (сделано / получено) |
| `behavior.participant.guest_badge` | Гость |
| `behavior.team.meetingsCount` | Встреч |
| `behavior.team.topDominating` | Топ доминирующих |
| `behavior.bar.label` | Доля времени говорения |

## Шаблоны промптов (admin, Фаза A.2)

| Ключ | Текст |
|---|---|
| `prompts.page.title` | Шаблоны промптов |
| `prompts.page.subtitle` | Конструктор промптов для AI-отчётов. Системные поставляются с Z, свои создаются под Org. |
| `prompts.action.create` | Создать шаблон |
| `prompts.column.name` | Название |
| `prompts.column.task_type` | Вид |
| `prompts.column.meeting_type` | Тип встречи |
| `prompts.column.status` | Статус |
| `prompts.column.scope` | Источник |
| `prompts.scope.system` | Системный |
| `prompts.scope.org` | Мой |
| `prompts.status.draft` | Черновик |
| `prompts.status.active` | Активен |
| `prompts.status.archived` | Архив |
| `prompts.task.summary` | Сводка |
| `prompts.task.tasks` | Задачи |
| `prompts.task.chapters` | Главы |
| `prompts.task.followup` | Письмо вдогон |
| `prompts.task.card_rollup` | Сводка карточки |
| `prompts.empty` | У вас нет шаблонов под выбранные фильтры. Скопируйте системный или создайте с нуля. |
| `prompts.create.heading` | Новый шаблон промпта |
| `prompts.create.subtitle` | После создания вы попадёте в редактор: добавите разделы отчёта и активируете шаблон. |
| `prompts.field.scope` | Область |
| `prompts.field.org_id` | ID организации |
| `prompts.field.key` | Ключ шаблона (slug) |
| `prompts.field.key_hint` | Латиница, цифры, дефис. Уникален в рамках области. |
| `prompts.field.name` | Название |
| `prompts.field.description` | Описание (необязательно) |
| `prompts.field.task_type` | Вид отчёта |
| `prompts.field.meeting_type` | Тип встречи (необязательно) |
| `prompts.field.meeting_type_any` | — для любого типа — |
| `prompts.detail.tab.editor` | Редактор |
| `prompts.detail.tab.versions` | Версии |
| `prompts.detail.tab.preview` | Тестирование |
| `prompts.detail.tab.usage` | Использование |
| `prompts.detail.delete.confirm` | Точно удалить шаблон? Действие можно отменить администратору в течение 30 дней. |
| `prompts.editor.system_prompt` | Системный промпт |
| `prompts.editor.system_prompt_hint` | Опиши общую роль ИИ-аналитика и контекст. Этот текст ставится в начало system-message. |
| `prompts.editor.tool_name` | Имя tool-функции (необязательно) |
| `prompts.editor.sections_heading` | Разделы отчёта |
| `prompts.editor.add_section` | Добавить раздел |
| `prompts.editor.section.title` | Название раздела |
| `prompts.editor.section.key` | ключ_для_JSON |
| `prompts.editor.section.instruction_placeholder` | Инструкция для ИИ: что именно писать в этом разделе. |
| `prompts.editor.section.output_type` | Тип вывода |
| `prompts.editor.section.required` | Обязательный |
| `prompts.editor.section.max_tokens` | Лимит токенов |
| `prompts.editor.notes` | Заметка к версии |
| `prompts.editor.notes_placeholder` | Что изменилось в этой версии. Будет видно в истории. |
| `prompts.editor.preview_btn` | Предпросмотр на демо-встрече |
| `prompts.editor.save_new` | Сохранить как новую версию |
| `prompts.editor.save_active` | Сохранить и активировать |
| `prompts.editor.tokens_sum` | Сумма лимита токенов |
| `prompts.versions.heading` | Версии |
| `prompts.versions.active_badge` | Активная |
| `prompts.versions.activate` | Активировать |
| `prompts.versions.confirm_activate` | Активировать эту версию? Все новые встречи начнут использовать её для генерации отчётов. |
| `prompts.preview.heading` | Предпросмотр на демо-встрече |
| `prompts.preview.demo_meeting` | Демо-встреча |
| `prompts.preview.use_draft` | Тестировать последний черновик |
| `prompts.preview.generate` | Сгенерировать |
| `prompts.preview.result.model` | Модель |
| `prompts.preview.result.duration` | Длительность |
| `prompts.preview.result.cost` | Стоимость |
| `prompts.preview.result.cost_over` | (превышен лимит) |
| `prompts.preview.result.tokens` | Токены |
| `prompts.preview.result.answer` | Ответ ИИ |
| `prompts.output_type.text` | Текст |
| `prompts.output_type.bullet_list` | Список пунктов |
| `prompts.output_type.table` | Таблица |
| `prompts.output_type.json_object` | JSON-объект |
| `prompts.meeting_type.team` | Командная встреча |
| `prompts.meeting_type.standup` | Дейли-standup |
| `prompts.meeting_type.plan_fact` | План-факт |
| `prompts.meeting_type.project` | Проектная встреча |
| `prompts.meeting_type.sales` | Продажи |
| `prompts.meeting_type.custdev` | CustDev / интервью |
| `prompts.meeting_type.partner` | Встреча с партнёром |
| `prompts.meeting_type.interview` | Собеседование |
| `prompts.meeting_type.customer_success` | Customer Success |
| `prompts.meeting_type.review` | Обзорная встреча |
| `prompts.meeting_type.retrospective` | Ретроспектива |


## A/B-эксперименты по промптам (Фаза A.3)

| Ключ | Текст |
|---|---|
| `prompt_experiments.title` | A/B-эксперименты по промптам |
| `prompt_experiments.subtitle` | Сравните две версии шаблона на реальных встречах и выберите лучшую. |
| `prompt_experiments.create` | Создать эксперимент |
| `prompt_experiments.new_title` | Новый эксперимент |
| `prompt_experiments.empty` | Пока нет ни одного эксперимента. Создайте первый, чтобы сравнить две версии шаблона. |
| `prompt_experiments.status.draft` | Черновик |
| `prompt_experiments.status.running` | Запущен |
| `prompt_experiments.status.stopped` | Остановлен |
| `prompt_experiments.status.completed` | Завершён |
| `prompt_experiments.split_percent` | Доля трафика на группу B, % |
| `prompt_experiments.template_a` | ID версии A (контроль) |
| `prompt_experiments.template_b` | ID версии B (вариант) |
| `prompt_experiments.ends_at` | Окончание (не позже 30 дней) |
| `prompt_experiments.ends_at_hint` | Пусто = эксперимент остановится только вручную. |
| `prompt_experiments.notes_placeholder` | Какую гипотезу проверяем? |
| `prompt_experiments.action.start` | Запустить |
| `prompt_experiments.action.stop` | Остановить |
| `prompt_experiments.action.stopped_from_admin` | Остановлен из админки |
| `prompt_experiments.group.a` | Группа A (контроль) |
| `prompt_experiments.group.b` | Группа B (вариант) |
| `prompt_experiments.metric.meetings_count` | Встреч в группе |
| `prompt_experiments.metric.positive` | 👍 положительных |
| `prompt_experiments.metric.negative` | 👎 отрицательных |
| `prompt_experiments.metric.positive_ratio` | Доля положительных |
| `prompt_experiments.error.feature_not_available` | Доступно на тарифе Pro/Business |
| `prompt_experiments.error.too_many_running` | Превышен лимит одновременных экспериментов |

## Обратная связь по AI-отчёту (Фаза A.3)

| Ключ | Текст |
|---|---|
| `ai_feedback.prompt` | Полезен ли этот отчёт? |
| `ai_feedback.thumbs_up` | Полезно (большой палец вверх) |
| `ai_feedback.thumbs_down` | Не полезно (большой палец вниз) |
| `ai_feedback.thanks` | Спасибо за отзыв — он попадёт в аналитику качества шаблона. |
| `ai_feedback.error.send_failed` | Не удалось отправить отзыв |
| `ai_feedback.error.try_again` | Попробуйте ещё раз |

## Кабинет владельца Org — Шаблоны промптов (Фаза A.3)

| Ключ | Текст |
|---|---|
| `org_prompts.feature_gate_pro` | Доступно на тарифе Pro/Business |
| `org_prompts.quota_exceeded` | Достигнут лимит количества шаблонов на тарифе |
