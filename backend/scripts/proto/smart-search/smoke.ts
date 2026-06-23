import { llm } from './llm';

async function main(): Promise<void> {
  for (const provider of ['deepseek', 'gpt5mini'] as const) {
    try {
      const r = await llm(
        provider,
        'Ты лаконичный помощник. Отвечай одним словом.',
        'Назови столицу Франции одним словом.',
        { maxTokens: 600 },
      );
      process.stdout.write(
        `✓ ${provider} (${r.model}) ${r.ms}ms in/out=${r.inputTokens}/${r.outputTokens}: ${JSON.stringify(r.text).slice(0, 120)}\n`,
      );
    } catch (e) {
      process.stdout.write(`✗ ${provider}: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
}

main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exit(1);
});
