import OpenAI from 'openai';

const apiKey = process.env.DEEPSEEK_API_KEY;
const baseURL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
const model = process.env.DEEPSEEK_SMOKE_MODEL ?? 'deepseek-v4-pro';

if (!apiKey) {
  console.error('✗ DEEPSEEK_API_KEY не задан в backend/.env');
  process.exit(1);
}

console.log('→ DeepSeek смоук');
console.log(`  baseURL: ${baseURL}`);
console.log(`  модель:  ${model}`);

const client = new OpenAI({ apiKey, baseURL });

const start = Date.now();
try {
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: 'Отвечай ровно одним словом.' },
      { role: 'user', content: 'Скажи "ок", если получил это сообщение.' },
    ],
    max_tokens: 10,
  });
  const ms = Date.now() - start;
  const text = response.choices[0]?.message?.content ?? '(пусто)';
  console.log('\n✓ Ответ получен');
  console.log(`  модель в ответе: ${response.model}`);
  console.log(`  текст:           "${text.trim()}"`);
  console.log(
    `  токены: вход=${response.usage?.prompt_tokens ?? '?'} выход=${response.usage?.completion_tokens ?? '?'}`,
  );
  console.log(`  время:           ${ms} мс`);
} catch (err) {
  const ms = Date.now() - start;
  console.error(`\n✗ Ошибка после ${ms} мс`);
  if (err instanceof Error) {
    console.error(`  тип:       ${err.constructor.name}`);
    console.error(`  сообщение: ${err.message}`);
  }
  process.exit(1);
}
