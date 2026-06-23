import { runAgent } from './agent';

async function main(): Promise<void> {
  const question = process.argv.slice(2).join(' ').trim();
  if (!question) {
    process.stdout.write('Использование: bun run scripts/proto/smart-search/run.ts "<вопрос>"\n');
    process.exit(0);
  }
  process.stdout.write(`\n❓ ВОПРОС: ${question}\n${'─'.repeat(70)}\n`);
  const res = await runAgent(question);
  for (const s of res.trace) {
    const head = `▸ ${s.stage}${s.provider ? ` [${s.provider}${s.ms ? ` ${s.ms}ms` : ''}]` : ''}`;
    process.stdout.write(`${head}\n  ${JSON.stringify(s.info)}\n`);
  }
  process.stdout.write(`${'─'.repeat(70)}\n`);
  process.stdout.write(`📌 ИСХОД: ${res.kind} · LLM-вызовов: ${res.llmCalls} · ${res.totalMs}ms\n`);
  process.stdout.write(`💬 ОТВЕТ:\n${res.text}\n`);
  if (res.usedBlockIds.length) process.stdout.write(`🔗 источники: ${res.usedBlockIds.join(', ')}\n`);
}

main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exit(1);
});
