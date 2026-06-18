import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useShallow } from "zustand/react/shallow";

import {
  selectVisibleProperties,
  selectVisibleRows,
  useTableStore,
} from "@app/(authenticated)/tables/[id]/store/tableStore";
import type { TablePropertyDomain, TableRowDomain } from "@/domain/table";

const NOW = new Date("2026-06-07T00:00:00.000Z");

const PROPERTIES: TablePropertyDomain[] = [
  {
    id: "prop-1",
    tableId: "table-1",
    name: "Название",
    type: "text",
    config: {},
    isPrimary: true,
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "prop-2",
    tableId: "table-1",
    name: "Статус",
    type: "status",
    config: {},
    isPrimary: false,
    order: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const ROWS: TableRowDomain[] = [
  {
    id: "row-1",
    tableId: "table-1",
    tenantId: "org-1",
    cells: { "prop-1": "Альфа", "prop-2": "Активен" },
    entityId: null,
    order: 0,
    archivedAt: null,
    createdBy: "user-1",
    createdAt: NOW,
    updatedAt: NOW,
    pageContent: null,
  },
  {
    id: "row-2",
    tableId: "table-1",
    tenantId: "org-1",
    cells: { "prop-1": "Бета", "prop-2": "Завершён" },
    entityId: null,
    order: 1,
    archivedAt: null,
    createdBy: "user-1",
    createdAt: NOW,
    updatedAt: NOW,
    pageContent: null,
  },
];

let renderCount = 0;

function Probe() {
  renderCount++;
  const properties = useTableStore(useShallow(selectVisibleProperties));
  const rows = useTableStore(useShallow(selectVisibleRows));
  return (
    <div data-testid="probe">
      {properties.length}/{rows.length}
    </div>
  );
}

beforeEach(() => {
  renderCount = 0;
  useTableStore.setState({
    properties: PROPERTIES,
    rows: ROWS,
    draftConfig: { filters: [], sorts: [], hiddenProps: [] },
  });
});

afterEach(() => {
  useTableStore.setState({
    properties: [],
    rows: [],
    draftConfig: {},
  });
});

describe("TableClient render loop guard (selectVisibleRows/Properties + useShallow)", () => {
  it("does not infinitely re-render and reflects store data once", () => {
    render(<Probe />);

    expect(screen.getByTestId("probe").textContent).toBe("2/2");

    expect(renderCount).toBeLessThanOrEqual(3);
  });
});
