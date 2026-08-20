import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("./_core/env", () => ({
  ENV: { opaUrl: "http://opa:8181", isProduction: true },
}));

import { assertPrivilegedPolicy } from "./opaPolicy";

describe("OPA privileged-action policy client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("permits a policy-approved MFA-backed Force Credit approval", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: { allow: true } }) });
    await expect(assertPrivilegedPolicy({ actorId: 7, role: "admin", action: "force_credit_approve", mfaPassed: true, reference: "PAY-1" })).resolves.toMatchObject({ provider: "opa", policy: "bis/authz", mfaPassed: true });
    expect(fetchMock).toHaveBeenCalledWith("http://opa:8181/v1/data/bis/authz", expect.objectContaining({ method: "POST" }));
  });

  it("rejects a policy-denied privileged action without allowing a fallback", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: { allow: false, reason: "MFA required" } }) });
    await expect(assertPrivilegedPolicy({ actorId: 7, role: "admin", action: "force_credit_approve", mfaPassed: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects when the policy decision point is unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("network unavailable"));
    await expect(assertPrivilegedPolicy({ actorId: 7, role: "admin", action: "force_credit_request" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sends break-glass action attributes to OPA rather than reducing the decision to a role check", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: { allow: true } }) });
    await assertPrivilegedPolicy({ actorId: 7, role: "admin", action: "caddy_rate_limit_override", mfaPassed: true, approverId: 9, reason: "Active credential-stuffing incident requires containment" });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.input).toMatchObject({ action: "caddy_rate_limit_override", mfaPassed: true, approverId: 9, reason: "Active credential-stuffing incident requires containment" });
  });
});
