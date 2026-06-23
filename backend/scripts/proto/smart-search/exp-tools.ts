import { llmTools, type Provider, type ToolDef } from './llm';

const SYS = `Ты — помощник Коры на главном входе. По сообщению пользователя ВЫЗОВИ подходящий инструмент с правильными аргументами. Не отвечай текстом, если подходит инструмент.`;

const TOOLS: ToolDef[] = [
  { name: 'create_task', description: 'Поставить задачу СЕБЕ', parameters: { type: 'object', properties: { title: { type: 'string' }, dueDate: { type: 'string' } }, required: ['title'] } },
  { name: 'assign_task', description: 'Поставить задачу ДРУГОМУ человеку по имени', parameters: { type: 'object', properties: { assignee: { type: 'string' }, title: { type: 'string' } }, required: ['assignee', 'title'] } },
  { name: 'ingest_note', description: 'Записать мысль/факт/наблюдение в память компании', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'ask_company_memory', description: 'Ответить на вопрос из памяти компании (что обсуждали/решали/кто за что)', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'show_my_tasks', description: 'Показать мои задачи', parameters: { type: 'object', properties: {}, required: [] } },
];

interface Case {
  msg: string;
  tool: string;
  argKey?: string;
  argIncludes?: string;
}
const CASES: Case[] = [
  { msg: 'Поставь задачу подготовить коммерческое предложение к пятнице', tool: 'create_task', argKey: 'title' },
  { msg: 'Поручи Насте сделать отчёт по внедрению', tool: 'assign_task', argKey: 'assignee', argIncludes: 'наст' },
  { msg: 'Запиши: клиент Александр против переноса всех задач сразу', tool: 'ingest_note', argKey: 'text' },
  { msg: 'Какие возражения были у Александра по внедрению?', tool: 'ask_company_memory', argKey: 'query' },
  { msg: 'Покажи мои задачи на сегодня', tool: 'show_my_tasks' },
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
          fails.push(`ERR «${c.msg.slice(0, 30)}»: ${r.error.slice(0, 60)}`);
          continue;
        }
        const tOk = r.tool === c.tool;
        if (tOk) toolOk++;
        else fails.push(`tool «${c.msg.slice(0, 30)}»: ждали ${c.tool}, дал ${r.tool}`);
        let aOk = true;
        if (c.argKey) {
          const v = String(r.args[c.argKey] ?? '').toLowerCase();
          aOk = v.length > 0 && (!c.argIncludes || v.includes(c.argIncludes));
        }
        if (tOk && aOk) argOk++;
        else if (tOk && !aOk) fails.push(`args «${c.msg.slice(0, 30)}»: ${JSON.stringify(r.args).slice(0, 60)}`);
      }
    }
    process.stdout.write(
      `\n### ${provider}: выбор инструмента ${toolOk}/${total}, верные аргументы ${argOk}/${total}, ошибок ${errors}/${total}, ср.${Math.round(msSum / total)}мс\n`,
    );
    for (const f of [...new Set(fails)].slice(0, 12)) process.stdout.write(`   • ${f}\n`);
  }
  process.stdout.write('\n══ tool-calling тест отработан ══\n');
}

main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exit(1);
});
