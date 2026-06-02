export type OrderedAsyncTask<Result> = () => Promise<Result>;

export async function runOrderedAsyncTasks<Result>(
  tasks: readonly OrderedAsyncTask<Result>[],
): Promise<Result[]> {
  return runOrderedAsyncTasksFrom(tasks, 0, []);
}

async function runOrderedAsyncTasksFrom<Result>(
  tasks: readonly OrderedAsyncTask<Result>[],
  index: number,
  results: Result[],
): Promise<Result[]> {
  const task = tasks[index];

  if (task === undefined) {
    return results;
  }

  results.push(await task());
  return runOrderedAsyncTasksFrom(tasks, index + 1, results);
}
