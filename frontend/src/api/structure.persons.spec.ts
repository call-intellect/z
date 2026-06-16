import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { personsDomainApi } from "./structure.api";

function captureFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    calls.push({ url: String(input), init: (init ?? {}) as RequestInit });
    return Promise.resolve(
      new Response(JSON.stringify({ person: {} }), { status: 200 }),
    );
  });
  return calls;
}

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body));

describe("personsDomainApi — маппинг полей UI → бэкенд-контракт", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("create: fullName→name, departmentId→primaryDepartmentId", async () => {
    const calls = captureFetch();
    await personsDomainApi.create("org1", {
      fullName: "Никитося",
      email: "tozix@yandex.ru",
      roleId: null,
      departmentId: null,
    });

    expect(calls[0].url).toContain("/api/v1/persons");
    const body = bodyOf(calls[0].init);
    expect(body).toEqual({
      name: "Никитося",
      email: "tozix@yandex.ru",
      primaryDepartmentId: null,
      roleId: null,
    });
    expect(body).not.toHaveProperty("fullName");
    expect(body).not.toHaveProperty("departmentId");
  });

  it("update: маппит только переданные поля (fullName→name, departmentId→primaryDepartmentId)", async () => {
    const calls = captureFetch();
    await personsDomainApi.update("org1", "p1", {
      fullName: "Новое имя",
      departmentId: "dep1",
    });

    const body = bodyOf(calls[0].init);
    expect(body).toEqual({ name: "Новое имя", primaryDepartmentId: "dep1" });
  });

  it("update: roleId:null прокидывается (снять должность)", async () => {
    const calls = captureFetch();
    await personsDomainApi.update("org1", "p1", { roleId: null });

    expect(bodyOf(calls[0].init)).toEqual({ roleId: null });
  });
});

describe("personsDomainApi — обратный маппинг бэкенд → UI (D7, дрейф контракта)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("list: name→fullName, primaryDepartmentId→departmentId, currentRoleId→roleId", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "p1",
              name: "Сергей Мазур",
              email: "s@e.ru",
              userId: null,
              primaryDepartmentId: "dep1",
              primaryDepartmentName: "Маркетинг",
              currentRoleId: "role1",
              currentRoleName: "Маркетолог",
              invitationStatus: "accepted",
              createdAt: "2026-01-01",
            },
          ],
          total: 1,
        }),
        { status: 200 },
      ),
    );

    const res = await personsDomainApi.list("org1");
    expect(res.total).toBe(1);
    expect(res.items[0]).toEqual({
      id: "p1",
      orgId: "org1",
      fullName: "Сергей Мазур",
      email: "s@e.ru",
      roleId: "role1",
      roleName: "Маркетолог",
      departmentId: "dep1",
      departmentName: "Маркетинг",
      userId: null,
      invitationStatus: "accepted",
      createdAt: "2026-01-01",
    });
  });

  it("byId: обратный маппинг + null name → пустая строка fullName (без undefined)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          person: {
            id: "p2",
            name: null,
            email: null,
            userId: "u2",
            primaryDepartmentId: null,
            primaryDepartmentName: null,
            currentRoleId: null,
            currentRoleName: null,
            invitationStatus: "pending",
            createdAt: "2026-02-02",
          },
        }),
        { status: 200 },
      ),
    );

    const res = await personsDomainApi.byId("org1", "p2");
    expect(res.person.fullName).toBe("");
    expect(res.person.departmentId).toBeNull();
    expect(res.person.roleId).toBeNull();
    expect(res.person.userId).toBe("u2");
  });
});
