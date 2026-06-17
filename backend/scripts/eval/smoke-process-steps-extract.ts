process.argv = [process.argv[0]!, process.argv[1]!, 'process-steps-extract'];
await import('./smoke-all-agents-runner');
