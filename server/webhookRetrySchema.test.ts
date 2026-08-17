import { describe, expect, it } from "vitest";
import { webhookRetryQueue, webhookRetryStatusEnum } from "../drizzle/schema";

describe("webhook retry queue schema", () => {
  it("exports the durable queue and every status used by retry and reconciliation flows", () => {
    expect(webhookRetryQueue).toBeDefined();
    expect(webhookRetryStatusEnum.enumValues).toEqual(["pending", "dead_letter", "completed", "resolved"]);
  });
});
