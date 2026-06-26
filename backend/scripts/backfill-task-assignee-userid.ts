async function main(): Promise<void> {
  console.log('backfill-task-assignee-userid: no-op (legacy Task model dropped)');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-task-assignee-userid FAILED:', err);
    process.exit(1);
  });
