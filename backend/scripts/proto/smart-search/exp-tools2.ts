import { llmTools, type Provider, type ToolDef } from './llm';

const SYS = `Ты — помощник Коры на главном входе. По сообщению пользователя ВЫЗОВИ подходящий инструмент с правильными аргументами.
Если просьба НЕ про рабочие дела компании (стихи, общие знания, болтовня) — НЕ вызывай инструмент, ответь текстом-отказом. Не угадывай инструмент ради инструмента.`;

const TOOLS: ToolDef[] = [
  { name: 'create_task', description: 'Поставить задачу СЕБЕ', parameters: { type: 'object', properties: { title: { type: 'string' }, dueDate: { type: 'string' } }, required: ['title'] } },
  { name: 'assign_task', description: 'Поставить задачу ДРУГОМУ человеку (есть имя исполнителя)', parameters: { type: 'object', properties: { assignee: { type: 'string' }, title: { type: 'string' } }, required: ['assignee', 'title'] } },
  { name: 'create_meeting', description: 'Создать встречу/событие календаря', parameters: { type: 'object', properties: { withWhom: { type: 'string' }, when: { type: 'string' } }, required: ['when'] } },
  { name: 'find_free_slot', description: 'Найти общий свободный слот для нескольких людей', parameters: { type: 'object', properties: { people: { type: 'string' }, period: { type: 'string' } }, required: [] } },
  { name: 'ingest_note', description: 'Записать мысль/идею/факт/наблюдение в память компании', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'ask_company_memory', description: 'Ответить на вопрос из памяти компании (что обсуждали/решали/кто за что)', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'show_my_tasks', description: 'Показать мои задачи', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'show_colleague_calendar', description: 'Показать календарь коллеги по имени', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
];

interface Case {
  msg: string;
  tool: string | null; // null = инструмент НЕ должен вызываться
  argKey?: string;
  argIncludes?: string;
}
const CASES: Case[] = [
  { msg: 'Поставь себе задачу: дописать ТЗ к среде', tool: 'create_task', argKey: 'title' },
  { msg: 'Поручи Игорю обзвонить клиентов из списка', tool: 'assign_task', argKey: 'assignee', argIncludes: 'игор' },
  { msg: 'Организуй встречу с Петром в четверг в 15:00', tool: 'create_meeting', argKey: 'when' },
  { msg: 'Когда мы с Настей и Игорем все свободны на следующей неделе?', tool: 'find_free_slot' },
  { msg: 'Зафиксируй мысль: стоит запускать пилот на одной задаче, а не на всех', tool: 'ingest_note', argKey: 'text' },
  { msg: 'Что мы решили по бюджету на маркетинг?', tool: 'ask_company_memory', argKey: 'query' },
  { msg: 'Покажи мои задачи', tool: 'show_my_tasks' },
  { msg: 'Открой календарь Насти на завтра', tool: 'show_colleague_calendar', argKey: 'name', argIncludes: 'наст' },
  { msg: 'Напиши, пожалуйста, короткое стихотворение про осень', tool: null },
];

const N = 3;

async function main(): Promise<void> {
  for (const provider of ['gpt5mini', 'deepseek'] as Provider[]) {
    let toolOk = 0;
    let argOk = 0;
    let errors = 0;
    let total = 0;
    let msSum = 0;
    const fails: string[] = [];
    for (const c of CASES) {
      for (let i = 0; i < N; i++) {
        total++;
        const r = await llmTools(provider, SYS, c.msg, TOOLS);
        msSum += r.ms;
        if (r.error) {
          errors++;
          fails.push(`ERR «${c.msg.slice(0, 28)}»: ${r.error.slice(0, 50)}`);
          continue;
        }
        const tOk = (c.tool === null && r.tool === null) || r.tool === c.tool;
        if (tOk) toolOk++;
        else fails.push(`tool «${c.msg.slice(0, 28)}»: ждали ${c.tool}, дал ${r.tool}`);
        let aOk = true;
        if (c.tool !== null && c.argKey) {
          const v = String(r.args[c.argKey] ?? '').toLowerCase();
          aOk = v.length > 0 && (!c.argIncludes || v.includes(c.argIncludes));
        }
        if (tOk && aOk) argOk++;
        else if (tOk && !aOk) fails.push(`args «${c.msg.slice(0, 28)}»: ${JSON.stringify(r.args).slice(0, 50)}`);
      }
    }
    process.stdout.write(
      `\n### ${provider}: выбор ${toolOk}/${total}, аргументы ${argOk}/${total}, ошибок ${errors}/${total}, ср.${Math.round(msSum / total)}мс\n`,
    );
    for (const f of [...new Set(fails)].slice(0, 14)) process.stdout.write(`   • ${f}\n`);
  }
  process.stdout.write('\n══ жёсткий tool-calling тест отработан ══\n');
}

main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exit(1);
});
