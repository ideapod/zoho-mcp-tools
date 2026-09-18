import { describe, expect, it } from "vitest";
import { resolveEntityId } from "../src/mcp/tools/helpers.js";

const list = [
  { id: "1", name: "To Do" },
  { id: "2", name: "In Progress" },
  { id: "3", name: "In Review" },
  { id: "4", name: "Done" },
];

describe("resolveEntityId", () => {
  it("passes through a value that is already a known ID", () => {
    expect(resolveEntityId(list, "2", "statuses")).toBe("2");
  });

  it("resolves an exact case-insensitive name match", () => {
    expect(resolveEntityId(list, "done", "statuses")).toBe("4");
  });

  it("resolves a unique partial name match", () => {
    expect(resolveEntityId(list, "progress", "statuses")).toBe("2");
  });

  it("throws when a partial match is ambiguous", () => {
    expect(() => resolveEntityId(list, "in", "statuses")).toThrow(/matches multiple/);
  });

  it("throws when nothing matches", () => {
    expect(() => resolveEntityId(list, "blocked", "statuses")).toThrow(/No statuses found/);
  });
});
