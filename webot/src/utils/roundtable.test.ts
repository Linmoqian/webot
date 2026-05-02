import { describe, it, expect } from "vitest";
import { getRoundtableRoleKey } from "./roundtable";

describe("getRoundtableRoleKey", () => {
  it("生成 onstage 角色键", () => {
    expect(getRoundtableRoleKey("onstage", 0, { name: "Architect", trait: "Critical" })).toBe(
      "onstage:0:Architect:Critical",
    );
  });

  it("生成 backstage 角色键", () => {
    expect(getRoundtableRoleKey("backstage", 3, { name: "Devil", trait: "Contrarian" })).toBe(
      "backstage:3:Devil:Contrarian",
    );
  });
});
