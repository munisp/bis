import { describe, expect, it } from "vitest";
import { transactionsRouter } from "./transactions";

function updateInputParser() {
  const procedure = (transactionsRouter as unknown as {
    _def: { procedures: Record<string, { _def: { inputs: Array<{ parse: (value: unknown) => unknown }> } }> };
  })._def.procedures.update;
  return procedure._def.inputs[0];
}

describe("transaction settlement-state guard", () => {
  it("rejects fabricated completed and reversed states from the generic update procedure", () => {
    const parser = updateInputParser();

    expect(() => parser.parse({ id: 10, status: "completed" })).toThrow();
    expect(() => parser.parse({ id: 10, status: "reversed" })).toThrow();
  });

  it("retains only non-settlement operational states for the controlled admin procedure", () => {
    const parser = updateInputParser();

    expect(parser.parse({ id: 10, status: "under_review" })).toMatchObject({ id: 10, status: "under_review" });
    expect(parser.parse({ id: 10, status: "blocked" })).toMatchObject({ id: 10, status: "blocked" });
  });
});
