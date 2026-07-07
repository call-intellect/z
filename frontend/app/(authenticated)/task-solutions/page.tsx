import type { Metadata } from "next";

import { TaskSolutionsListClient } from "./TaskSolutionsListClient";

export const metadata: Metadata = {
  title: "Решения задач",
};

export default function TaskSolutionsPage() {
  return <TaskSolutionsListClient />;
}
