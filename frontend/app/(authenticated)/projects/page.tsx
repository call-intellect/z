import type { Metadata } from "next";

import { TasksWorkspaceClient } from "./TasksWorkspaceClient";

export const metadata: Metadata = {
  title: "Задачи",
};

export default function ProjectsPage() {
  return <TasksWorkspaceClient />;
}
