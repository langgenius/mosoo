import type { AgentTask } from "@mosoo/contracts/session";
import { useId } from "react";
import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";

export type AgentTaskView = Pick<AgentTask, "taskId"> & {
  taskType?: AgentTask["taskType"] | null;
  title?: AgentTask["title"] | null;
};

export function ActiveAgentTasks({
  className,
  tasks,
}: {
  className?: string;
  tasks: readonly AgentTaskView[];
}): ReactElement | null {
  const { t } = useTranslation();
  const headingId = useId();

  if (tasks.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby={headingId}
      className={cn("border-border-subtle bg-card rounded-md border px-3 py-2.5", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-fg-1 text-[12px] font-semibold">
          {t("sessionEvents.activeBackgroundTasks")}
        </h2>
        <output aria-labelledby={headingId} className="text-fg-3 text-[11px] tabular-nums">
          {t("sessionEvents.activeBackgroundTaskCount", { count: String(tasks.length) })}
        </output>
      </div>

      <ul className="mt-2 grid max-h-32 gap-1.5 overflow-y-auto sm:grid-cols-2">
        {tasks.map((task) => (
          <li
            key={task.taskId}
            className="border-border-subtle bg-muted/20 flex min-w-0 items-center gap-2 rounded-sm border px-2 py-1.5"
          >
            <span aria-hidden="true" className="bg-primary size-1.5 shrink-0 rounded-full" />
            <span className="min-w-0 flex-1">
              <span className="text-fg-1 block truncate text-[11.5px] font-medium">
                {task.title ?? task.taskType ?? task.taskId}
              </span>
              {task.title || task.taskType ? (
                <span className="text-fg-3 flex min-w-0 items-center gap-1.5 text-[10px]">
                  {task.title && task.taskType ? (
                    <span className="min-w-0 truncate">{task.taskType}</span>
                  ) : null}
                  <code className="min-w-0 flex-1 truncate" title={task.taskId}>
                    {task.taskId}
                  </code>
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
