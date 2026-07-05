import type { CloneKey } from './_shared';

export type GoldCategory = 'rule_hit' | 'rule_paraphrase' | 'rule_absent';

export interface GoldItem {
  id: string;
  clone: CloneKey;
  category: GoldCategory;
  question: string;
  gold: string[];
  note: string;
}

export const GOLD: GoldItem[] = [
  {
    id: 'g01',
    clone: 'ceo',
    category: 'rule_hit',
    question: 'Как мы решаем, раскатывать релиз на всех пользователей — по ощущениям команды или как-то ещё?',
    gold: ['cmr51f3bk02abdbbwrkou1l8q'],
    note: 'Раскатка по когортным метрикам, не по ощущениям.',
  },
  {
    id: 'g02',
    clone: 'ceo',
    category: 'rule_hit',
    question: 'От меня прямо сейчас требуют назвать срок по задаче. Как правильно поступить?',
    gold: ['cmr51hp4u02fxdbbw7a1jhors'],
    note: 'Пауза и замеры перед фиксацией даты.',
  },
  {
    id: 'g03',
    clone: 'ceo',
    category: 'rule_hit',
    question: 'Что обязательно включить перед массовым синком внешнего API?',
    gold: ['cmr50zurz01r3dbbw2gorkgdu', 'cmr50s8gj017kdbbwzo9po4ep'],
    note: 'Backoff и мониторинг ДО синка (regulation + policy — принимаем любой).',
  },
  {
    id: 'g04',
    clone: 'ceo',
    category: 'rule_paraphrase',
    question: 'Заказчик давит зафиксировать дедлайн немедленно. Что говорят наши правила?',
    gold: ['cmr51hp4u02fxdbbw7a1jhors'],
    note: 'Парафраз g02 — та же норма про паузу и замеры.',
  },
  {
    id: 'g05',
    clone: 'integrator',
    category: 'rule_hit',
    question: 'С чего начинать диагностику, когда сервис упал?',
    gold: ['cmr51raz9030gdbbwfo3v8229'],
    note: 'Начинать с логов и метрик, гипотезы после фактов.',
  },
  {
    id: 'g06',
    clone: 'integrator',
    category: 'rule_hit',
    question: 'Что обязательно сделать при закрытии багфикса, чтобы поймать возможный регресс?',
    gold: ['cmr51tvd8034fdbbwao4sszfj'],
    note: 'Добавить мониторинг: алерт + дашборд.',
  },
  {
    id: 'g07',
    clone: 'integrator',
    category: 'rule_hit',
    question: 'Можно ли выкатывать изменения сразу в прод, минуя промежуточную среду?',
    gold: ['cmr51tvdq034hdbbw37ssdof0', 'cmr51rayx030edbbwka4hp6ok', 'cmr51p5nv02vkdbbwiyqnvjo9'],
    note: 'Нельзя без стейджа — кластер near-дубликатов (принимаем любой).',
  },
  {
    id: 'g08',
    clone: 'marketer',
    category: 'rule_hit',
    question: 'Что сделать с базой контактов перед email-рассылкой, чтобы не ловить баунсы?',
    gold: ['cmr51v23h036udbbw3e2429wv'],
    note: 'Очистка базы: дубликаты + валидация адресов.',
  },
  {
    id: 'g09',
    clone: 'marketer',
    category: 'rule_hit',
    question: 'Как понять, стоит ли запускать новый платный канал трафика?',
    gold: ['cmr51vyyq039edbbwoqeb9f9f', 'cmr51zjes03eydbbwzta10dvu', 'cmr51v2xj037xdbbwzea0p2ok'],
    note: 'Юнит-экономика CAC/LTV до запуска — кластер near-дубликатов.',
  },
  {
    id: 'g10',
    clone: 'marketer',
    category: 'rule_paraphrase',
    question: 'Прежде чем раскатывать новый оффер на всю аудиторию — что мы делаем?',
    gold: ['cmr51vyz2039gdbbw9gm2rup4', 'cmr51wwad03addbbwvofzgbwc'],
    note: 'Парафраз: A/B-тест на малой доле до масштабирования.',
  },
  {
    id: 'g11',
    clone: 'marketer',
    category: 'rule_hit',
    question: 'Почему нельзя рассылать один и тот же текст по всей базе сразу?',
    gold: ['cmr51v23o036vdbbwya4bv5k4', 'cmr51wwav03afdbbwivvx3vla', 'cmr51q5re02ywdbbw8b0qay35'],
    note: 'Сегментация по поведению — кластер near-дубликатов.',
  },
  {
    id: 'g12',
    clone: 'support',
    category: 'rule_hit',
    question: 'За какое время мы обязаны дать клиенту первый ответ?',
    gold: ['cmr515at70014yfbw7ze89yox'],
    note: 'Только регламент v2 содержит норму «4 часа».',
  },
  {
    id: 'g13',
    clone: 'support',
    category: 'rule_hit',
    question: 'Куда и когда передавать критичные обращения, блокирующие работу клиента?',
    gold: ['cmr522jk703kjdbbw9lxvyei7'],
    note: 'Эскалация владельцу в тот же день по severity.',
  },
  {
    id: 'g14',
    clone: 'support',
    category: 'rule_paraphrase',
    question: 'Очередь тикетов растёт, есть риск сорвать SLA. Как действовать заранее?',
    gold: [
      'cmr526n7j03q6dbbwrtszx88j',
      'cmr52802w03rddbbwq1x14m63',
      'cmr524m2403nudbbwsaeyrxce',
      'cmr520f5l03h7dbbwxt1jdutv',
    ],
    note: 'Кластер упреждающего управления SLA / ранней эскалации.',
  },
  {
    id: 'g15',
    clone: 'ceo',
    category: 'rule_absent',
    question: 'Какой у нас регламент оформления отпусков сотрудников?',
    gold: [],
    note: 'У роли нет HR-правил про отпуска — ждём пустой выбор без выдумки.',
  },
  {
    id: 'g16',
    clone: 'support',
    category: 'rule_absent',
    question: 'Какой у нас регламент код-ревью и git-flow?',
    gold: [],
    note: 'У поддержки нет правил про код-ревью — ждём пустой выбор.',
  },
  {
    id: 'g17',
    clone: 'marketer',
    category: 'rule_absent',
    question: 'Как мы проводим пост-мортем после инцидента в поддержке?',
    gold: [],
    note: 'Пост-мортем — правило поддержки, не маркетинга; ждём пустой выбор.',
  },
];
