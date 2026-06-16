process.argv = [process.argv[0]!, process.argv[1]!, 'regulation-dedupe'];
await import('./smoke-all-agents-runner');
