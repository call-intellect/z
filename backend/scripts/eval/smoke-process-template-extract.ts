process.argv = [process.argv[0]!, process.argv[1]!, 'process-template-extract'];
await import('./smoke-all-agents-runner');
