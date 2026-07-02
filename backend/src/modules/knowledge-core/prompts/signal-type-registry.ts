import type { SIGNAL_TYPE_VALUES } from './block-ingest.prompt';
import { TASK_VS_DECISION_PAIRS } from './task-decision-examples';

type SignalType = (typeof SIGNAL_TYPE_VALUES)[number];

export interface SignalTypeEntry {
  type: SignalType;
  definition: string;
  example: string;
  antiPattern: string;
}

const ideaPair = TASK_VS_DECISION_PAIRS[0]!;
const decisionPair = TASK_VS_DECISION_PAIRS[3]!;
const taskPair = TASK_VS_DECISION_PAIRS[5]!;

export const SIGNAL_TYPE_REGISTRY: Record<SignalType, SignalTypeEntry> = {
  fact: {
    type: 'fact',
    definition: 'устойчивое рабочее утверждение, переживёт неделю',
    example: 'У нас два склада: в Москве и Казани',
    antiPattern: 'Не путать с idea (предложение) и с одноразовой репликой',
  },
  pain: {
    type: 'pain',
    definition: 'боль клиента или пользователя продукта',
    example: 'Клиенты жалуются, что выгрузка падает на больших файлах',
    antiPattern: 'Не путать с objection (возражение в продаже) и friction (трение внутри)',
  },
  feature_request: {
    type: 'feature_request',
    definition: 'просьба сделать конкретную функцию продукта',
    example: 'Нужна выгрузка в Excel прямо из отчёта',
    antiPattern: 'Не путать с idea (наш набросок) и pain (жалоба без запроса)',
  },
  objection: {
    type: 'objection',
    definition: 'возражение против предложения или покупки',
    example: 'Дорого, у конкурента дешевле на треть',
    antiPattern: 'Не путать с pain (боль в работе) и feature_request (просьба о функции)',
  },
  churn_risk: {
    type: 'churn_risk',
    definition: 'признак, что клиент может уйти',
    example: 'Клиент второй месяц не заходит и не платит',
    antiPattern: 'Не путать с pain (разовая жалоба без угрозы ухода)',
  },
  idea: {
    type: 'idea',
    definition: 'набросок нового подхода, ещё не принятый выбор',
    example: ideaPair.idea,
    antiPattern: 'Не путать с decision (выбор зафиксирован) и action_item (поручение)',
  },
  risk: {
    type: 'risk',
    definition: 'будущая угроза делу, событие может навредить',
    example: 'Если поставщик сорвёт сроки — встанет вся отгрузка',
    antiPattern: 'Не путать с blocker (мешает уже сейчас) и pain (боль клиента)',
  },
  commitment: {
    type: 'commitment',
    definition: 'конкретный человек лично берёт действие на себя',
    example: 'Я к пятнице подготовлю смету и пришлю Марине',
    antiPattern: 'Не путать с action_item (поручение без личного «я беру») и plan_item (план группы)',
  },
  decision: {
    type: 'decision',
    definition: 'зафиксированный выбор между вариантами',
    example: decisionPair.decision,
    antiPattern: 'Не путать с idea (ещё не выбор) и action_item (поручение, не выбор)',
  },
  mood: {
    type: 'mood',
    definition: 'настроение, эмоциональный фон в разговоре',
    example: 'Команда вымотана авралом, все на нервах',
    antiPattern: 'Не путать с team_friction (конфликт людей) и pain (боль клиента)',
  },
  drift: {
    type: 'drift',
    definition: 'отклонение от темы, плана или договорённости',
    example: 'Опять ушли от повестки в обсуждение корпоратива',
    antiPattern: 'Не путать с decision (осознанная смена курса)',
  },
  competitor_move: {
    type: 'competitor_move',
    definition: 'действие конкурента на рынке',
    example: 'Конкурент запустил бесплатный тариф на год',
    antiPattern: 'Не путать с objection (клиент сравнивает) и metric_change (наше число)',
  },
  metric_change: {
    type: 'metric_change',
    definition: 'изменение метрики или числа во времени',
    example: 'Конверсия в оплату выросла с 4 до 6 процентов',
    antiPattern: 'Не путать с result (итог дела) и fact (постоянное утверждение)',
  },
  knowledge_gap: {
    type: 'knowledge_gap',
    definition: 'пробел в знаниях, «не знаем как или почему»',
    example: 'Никто не понимает, почему растут возвраты',
    antiPattern: 'Не путать с question (заданный вопрос) и resource_gap (нехватка людей)',
  },
  reasoning: {
    type: 'reasoning',
    definition: 'ход рассуждения, как пришли к мысли',
    example: 'Раз спрос падает, значит и склад надо урезать',
    antiPattern: 'Не путать с rationale (обоснование готового решения) и decision_basis (данные)',
  },
  rationale: {
    type: 'rationale',
    definition: 'обоснование уже принятого решения',
    example: 'Выбрали Казань, потому что там дешевле аренда',
    antiPattern: 'Не путать с reasoning (ход мысли до выбора) и decision_basis (на основании каких данных)',
  },
  decision_basis: {
    type: 'decision_basis',
    definition: 'на основании каких данных или фактов решали',
    example: 'Решали по отчёту: 70 процентов заказов из Казани',
    antiPattern: 'Не путать с rationale (словесное обоснование) и decision (сам выбор)',
  },
  regulation: {
    type: 'regulation',
    definition: 'правило или норма «как у нас положено»',
    example: 'Все договоры свыше миллиона визирует юрист',
    antiPattern: 'Не путать с process_step (как делается) и decision (разовый выбор)',
  },
  process_step: {
    type: 'process_step',
    definition: 'шаг процесса, «как это делается вообще»',
    example: 'После заявки менеджер ставит её в очередь склада',
    antiPattern: 'Не путать с commitment («я сделаю сейчас») и regulation (норма-правило)',
  },
  expertise: {
    type: 'expertise',
    definition: 'глубокое знание области у человека',
    example: 'Он много лет знает таможню изнутри',
    antiPattern: 'Не путать с experience (пережитый кейс) и competence (подтверждённый навык)',
  },
  experience: {
    type: 'experience',
    definition: 'пережитый опыт или конкретный кейс',
    example: 'В прошлом проекте мы уже наступали на эти грабли',
    antiPattern: 'Не путать с expertise (знание области) и lesson (выведенный урок)',
  },
  competence: {
    type: 'competence',
    definition: 'подтверждённый навык делать конкретное дело',
    example: 'Она умеет настраивать сквозную аналитику с нуля',
    antiPattern: 'Не путать с expertise (знание области) и experience (опыт без навыка)',
  },
  methodology_step: {
    type: 'methodology_step',
    definition: 'шаг признанной методологии или фреймворка',
    example: 'По Scrum сначала проводим грумминг бэклога',
    antiPattern: 'Не путать с process_step (наш внутренний процесс)',
  },
  hypothesis: {
    type: 'hypothesis',
    definition: 'проверяемое предположение, которое можно опровергнуть',
    example: 'Думаю, отток из-за долгой первой реакции поддержки',
    antiPattern: 'Не путать с idea (предложение действия) и result (доказанный итог)',
  },
  result: {
    type: 'result',
    definition: 'полученный итог или число по сделанному',
    example: 'Запустили рассылку — собрали 200 заявок',
    antiPattern: 'Не путать с metric_change (динамика метрики) и done_item (факт закрытия)',
  },
  lesson: {
    type: 'lesson',
    definition: 'извлечённый урок на будущее',
    example: 'Поняли: без предоплаты в этот сегмент не идём',
    antiPattern: 'Не путать с experience (сам кейс без вывода) и rationale (обоснование решения)',
  },
  brand_principle: {
    type: 'brand_principle',
    definition: 'принцип бренда или ценность компании',
    example: 'Мы всегда отвечаем клиенту в день обращения',
    antiPattern: 'Не путать с regulation (рабочая норма) и decision (разовый выбор)',
  },
  content_artifact: {
    type: 'content_artifact',
    definition: 'созданный контент-материал',
    example: 'Подготовили лендинг и серию писем под акцию',
    antiPattern: 'Не путать с done_item (закрытие задачи) и result (итог в числах)',
  },
  commitment_status: {
    type: 'commitment_status',
    definition: 'апдейт по ранее данному обещанию',
    example: 'По той смете задерживаюсь, будет к понедельнику',
    antiPattern: 'Не путать с commitment (новое обещание) и done_item (уже сделано)',
  },
  plan_item: {
    type: 'plan_item',
    definition: 'пункт общего плана группы на будущее',
    example: 'В этом квартале выходим на маркетплейсы',
    antiPattern: 'Не путать с commitment (личное «я») и action_item (точечное поручение)',
  },
  action_item: {
    type: 'action_item',
    definition: 'поручение или задача к исполнению без личного «я беру»',
    example: taskPair.task,
    antiPattern: 'Не путать с commitment (личное обещание) и decision (выбор, не действие)',
  },
  done_item: {
    type: 'done_item',
    definition: 'пункт или подзадача уже выполнены',
    example: 'Готово, выложил макет на согласование',
    antiPattern: 'Не путать с commitment (обещание на будущее) и task_completed (закрыта названная задача)',
  },
  blocker: {
    type: 'blocker',
    definition: 'что физически мешает выполнить задачу сейчас',
    example: 'Не могу продолжить — нет доступа к серверу',
    antiPattern: 'Не путать с risk (угроза в будущем) и resource_gap (нехватка ресурса)',
  },
  team_friction: {
    type: 'team_friction',
    definition: 'напряжение или конфликт между конкретными людьми',
    example: 'Опять спор с Петей по зонам ответственности',
    antiPattern: 'Не путать с process_friction (стык функций) и mood (общий настрой)',
  },
  process_friction: {
    type: 'process_friction',
    definition: 'трение на стыке функций или отделов при передаче',
    example: 'Продажи кидают сырые лиды прямо в поддержку',
    antiPattern: 'Не путать с team_friction (ссора людей) и blocker (что мешает задаче)',
  },
  resource_gap: {
    type: 'resource_gap',
    definition: 'нехватка ресурса: людей, денег, мощностей',
    example: 'На вторую смену людей не хватает',
    antiPattern: 'Не путать с blocker (мешает прямо сейчас) и knowledge_gap (пробел в знаниях)',
  },
  suggestion: {
    type: 'suggestion',
    definition: 'общая рекомендация или пожелание без новизны',
    example: 'Стоит чаще созваниваться с клиентом',
    antiPattern: 'Не путать с idea (новый подход) и feature_request (конкретная функция)',
  },
  client_request: {
    type: 'client_request',
    definition: 'просьба клиента, спрос со стороны, не наш выбор',
    example: 'Клиент просит добавить оплату по счёту',
    antiPattern: 'Не путать с feature_request (запрос функции продукта) и decision (наш выбор)',
  },
  question: {
    type: 'question',
    definition: 'заданный в окне вопрос',
    example: 'А кто займётся переносом склада?',
    antiPattern: 'Не путать с commitment (не назначай ответственного за вопрос)',
  },
  task_created: {
    type: 'task_created',
    definition: 'эхо-событие трекера: заведена существующая задача',
    example: 'Создал задачу по проверке остатков в трекере',
    antiPattern: 'Не путать с action_item (извлечение новой задачи из речи)',
  },
  task_status_changed: {
    type: 'task_status_changed',
    definition: 'эхо-событие трекера: сменился статус задачи',
    example: 'Перевёл задачу по смете в работу',
    antiPattern: 'Не путать с commitment_status (апдейт по устному обещанию)',
  },
  task_blocked: {
    type: 'task_blocked',
    definition: 'эхо-событие трекера: задача заблокирована',
    example: 'Поставил задаче по интеграции статус «заблокирована»',
    antiPattern: 'Не путать с blocker (устное «мне мешает» вне трекера)',
  },
  task_completed: {
    type: 'task_completed',
    definition: 'названная задача закрыта, прошедшее время плюс результат',
    example: 'Задачу по отчёту закрыл, всё отправил',
    antiPattern: 'Не путать с commitment (обещание на будущее) и done_item (пункт без названной задачи)',
  },
  task_overdue: {
    type: 'task_overdue',
    definition: 'эхо-событие трекера: задача просрочена',
    example: 'Задача по договору висит просроченной третий день',
    antiPattern: 'Не путать с commitment_status (устный апдейт «задерживаюсь»)',
  },
  task_reassigned: {
    type: 'task_reassigned',
    definition: 'эхо-событие трекера: задачу переназначили',
    example: 'Передал задачу по аналитике на Олега',
    antiPattern: 'Не путать с action_item (новое поручение из речи)',
  },
  task_comment: {
    type: 'task_comment',
    definition: 'эхо-событие трекера: комментарий к существующей задаче',
    example: 'Оставил в задаче комментарий про новые требования',
    antiPattern: 'Не путать с question (устный вопрос вне трекера)',
  },
  task_mention: {
    type: 'task_mention',
    definition: 'эхо-событие трекера: ссылка или упоминание задачи',
    example: 'По той задаче в трекере, что висит на Ане',
    antiPattern: 'Не путать с action_item (постановка новой задачи)',
  },
  help_provided: {
    type: 'help_provided',
    definition: 'человек помог делом, реально что-то сделал',
    example: 'Я за него настроил выгрузку, чтобы не стоял',
    antiPattern: 'Не путать с proactive_hint (подсказал) и mentoring (учит системно)',
  },
  proactive_hint: {
    type: 'proactive_hint',
    definition: 'подсказал по своей инициативе, без просьбы',
    example: 'Кстати, там есть готовый шаблон, не делай руками',
    antiPattern: 'Не путать с help_provided (помог делом) и constructive_feedback (критика)',
  },
  mentoring: {
    type: 'mentoring',
    definition: 'наставничество, системно учит и развивает',
    example: 'Разбираю с новичком каждый его звонок неделю',
    antiPattern: 'Не путать с proactive_hint (разовая подсказка) и help_provided (сделал за него)',
  },
  emotional_support: {
    type: 'emotional_support',
    definition: 'моральная поддержка, подбодрил человека',
    example: 'Не переживай, у всех бывает, разрулим вместе',
    antiPattern: 'Не путать с constructive_feedback (критика) и mentoring (обучение)',
  },
  constructive_feedback: {
    type: 'constructive_feedback',
    definition: 'конструктивная критика с предложением как лучше',
    example: 'Отчёт сырой, добавь разбивку по регионам',
    antiPattern: 'Не путать с objection (возражение в продаже) и proactive_hint (подсказка)',
  },
  question_unanswered: {
    type: 'question_unanswered',
    definition: 'вопрос задан и не получил ответа в окне',
    example: 'Так кто отвечает за приёмку? (ответа нет)',
    antiPattern: 'Не путать с question_acknowledged_no_action (услышали, но молчат по делу)',
  },
  question_acknowledged_no_action: {
    type: 'question_acknowledged_no_action',
    definition: 'вопрос услышали, но действий и решения нет',
    example: 'Да, видим проблему — ладно, потом разберёмся',
    antiPattern: 'Не путать с question_unanswered (вообще не ответили)',
  },
  helped_by: {
    type: 'helped_by',
    definition: 'кому-то помогли, направление «получил помощь»',
    example: 'Мне Сергей помог собрать первый отчёт',
    antiPattern: 'Не путать с helped_to (наоборот — это я помог) и thanks_explicit (благодарность)',
  },
  helped_to: {
    type: 'helped_to',
    definition: 'кому помог, направление «оказал помощь»',
    example: 'Помог Кате разобраться с настройкой рассылки',
    antiPattern: 'Не путать с helped_by (это мне помогли) и help_provided (факт помощи без адресата)',
  },
  thanks_explicit: {
    type: 'thanks_explicit',
    definition: 'явная благодарность за помощь или работу',
    example: 'Спасибо, без тебя бы не успели',
    antiPattern: 'Не путать с emotional_support (поддержка) и help_provided (сама помощь)',
  },
};

interface RegistrySection {
  title: string;
  types: readonly SignalType[];
}

const REGISTRY_SECTIONS: readonly RegistrySection[] = [
  {
    title: 'Базовые знания',
    types: [
      'fact',
      'reasoning',
      'rationale',
      'decision_basis',
      'regulation',
      'process_step',
      'methodology_step',
      'hypothesis',
      'result',
      'lesson',
      'brand_principle',
      'content_artifact',
      'metric_change',
    ],
  },
  {
    title: 'Решения и обязательства',
    types: ['idea', 'suggestion', 'decision', 'commitment', 'commitment_status', 'plan_item'],
  },
  {
    title: 'Задачи-трекер (эхо-события)',
    types: [
      'action_item',
      'done_item',
      'task_created',
      'task_status_changed',
      'task_blocked',
      'task_completed',
      'task_overdue',
      'task_reassigned',
      'task_comment',
      'task_mention',
    ],
  },
  {
    title: 'Риски и трения',
    types: [
      'risk',
      'blocker',
      'team_friction',
      'process_friction',
      'resource_gap',
      'knowledge_gap',
      'pain',
      'churn_risk',
      'objection',
      'competitor_move',
      'client_request',
      'feature_request',
      'drift',
      'mood',
    ],
  },
  {
    title: 'Навыки и опыт',
    types: ['expertise', 'experience', 'competence'],
  },
  {
    title: 'Помощь и социальное',
    types: [
      'help_provided',
      'proactive_hint',
      'mentoring',
      'emotional_support',
      'constructive_feedback',
      'helped_by',
      'helped_to',
      'thanks_explicit',
    ],
  },
  {
    title: 'Прочее',
    types: ['question', 'question_unanswered', 'question_acknowledged_no_action'],
  },
];

function renderEntryLine(entry: SignalTypeEntry): string {
  return `- ${entry.type}: ${entry.definition}. Пример: «${entry.example}» → ${entry.type}. ${entry.antiPattern}.`;
}

export function renderSignalTypeRegistry(): string {
  const lines: string[] = [
    'Каждый из 57 типов сигнала имеет определение, пример и анти-паттерн. Ставь ровно один тип, ближайший по смыслу; если сомневаешься между двумя — читай «Не путать».',
  ];
  for (const section of REGISTRY_SECTIONS) {
    lines.push('', `## ${section.title}`);
    for (const type of section.types) {
      lines.push(renderEntryLine(SIGNAL_TYPE_REGISTRY[type]));
    }
  }
  return lines.join('\n');
}
