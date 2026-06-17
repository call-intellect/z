process.argv = [process.argv[0]!, process.argv[1]!, 'idea-status-summarize'];
await import('./smoke-all-agents-runner');
