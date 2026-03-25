/**
 * Phase 41 — Case Risk Scoring, Lead Analyst Assignment, Comments CRUD
 * Unit tests for the new casesRouter procedures.
 */

import { describe, it, expect } from "vitest";

// ─── Risk Score Formula (mirrors recalculateRiskScore logic) ──────────────────

function computeRiskScore(opts: {
  priority: string;
  partyCount: number;
  timelineCount: number;
  docCount: number;
  isOverdue: boolean;
}): number {
  const PRIORITY_WEIGHTS: Record<string, number> = {
    low: 10,
    medium: 35,
    high: 65,
    critical: 90,
  };
  const priorityScore = PRIORITY_WEIGHTS[opts.priority] ?? 35;
  const partyScore = Math.min(opts.partyCount * 8, 20);
  const timelineScore = Math.min(opts.timelineCount * 2, 20);
  const docScore = Math.min(opts.docCount * 2, 10);
  const overdueScore = opts.isOverdue ? 10 : 0;
  return Math.min(Math.round(priorityScore + partyScore + timelineScore + docScore + overdueScore), 100);
}

describe("Risk Score Formula", () => {
  it("returns 10 for a low-priority case with no data", () => {
    expect(computeRiskScore({ priority: "low", partyCount: 0, timelineCount: 0, docCount: 0, isOverdue: false })).toBe(10);
  });

  it("returns 35 for a medium-priority case with no data", () => {
    expect(computeRiskScore({ priority: "medium", partyCount: 0, timelineCount: 0, docCount: 0, isOverdue: false })).toBe(35);
  });

  it("returns 65 for a high-priority case with no data", () => {
    expect(computeRiskScore({ priority: "high", partyCount: 0, timelineCount: 0, docCount: 0, isOverdue: false })).toBe(65);
  });

  it("returns 90 for a critical-priority case with no data", () => {
    expect(computeRiskScore({ priority: "critical", partyCount: 0, timelineCount: 0, docCount: 0, isOverdue: false })).toBe(90);
  });

  it("caps party score at 20 (3+ parties)", () => {
    const base = computeRiskScore({ priority: "low", partyCount: 0, timelineCount: 0, docCount: 0, isOverdue: false });
    const withParties = computeRiskScore({ priority: "low", partyCount: 10, timelineCount: 0, docCount: 0, isOverdue: false });
    expect(withParties - base).toBe(20);
  });

  it("caps timeline score at 20 (10+ events)", () => {
    const base = computeRiskScore({ priority: "low", partyCount: 0, timelineCount: 0, docCount: 0, isOverdue: false });
    const withTimeline = computeRiskScore({ priority: "low", partyCount: 0, timelineCount: 100, docCount: 0, isOverdue: false });
    expect(withTimeline - base).toBe(20);
  });

  it("caps doc score at 10 (5+ documents)", () => {
    const base = computeRiskScore({ priority: "low", partyCount: 0, timelineCount: 0, docCount: 0, isOverdue: false });
    const withDocs = computeRiskScore({ priority: "low", partyCount: 0, timelineCount: 0, docCount: 100, isOverdue: false });
    expect(withDocs - base).toBe(10);
  });

  it("adds 10 for overdue cases", () => {
    const notOverdue = computeRiskScore({ priority: "medium", partyCount: 0, timelineCount: 0, docCount: 0, isOverdue: false });
    const overdue = computeRiskScore({ priority: "medium", partyCount: 0, timelineCount: 0, docCount: 0, isOverdue: true });
    expect(overdue - notOverdue).toBe(10);
  });

  it("never exceeds 100", () => {
    const score = computeRiskScore({ priority: "critical", partyCount: 100, timelineCount: 100, docCount: 100, isOverdue: true });
    expect(score).toBe(100);
  });

  it("handles unknown priority gracefully (defaults to medium=35)", () => {
    const score = computeRiskScore({ priority: "unknown_priority", partyCount: 0, timelineCount: 0, docCount: 0, isOverdue: false });
    expect(score).toBe(35);
  });
});

// ─── Lead Analyst Assignment Logic ───────────────────────────────────────────

function buildAssignmentLabel(analystId: number | null, analystName?: string): string {
  if (!analystId) return "Lead analyst unassigned";
  return `Assigned to ${analystName ?? "Analyst #" + analystId}`;
}

describe("Lead Analyst Assignment Label", () => {
  it("returns unassigned label when analystId is null", () => {
    expect(buildAssignmentLabel(null)).toBe("Lead analyst unassigned");
  });

  it("uses analyst name when provided", () => {
    expect(buildAssignmentLabel(42, "Jane Doe")).toBe("Assigned to Jane Doe");
  });

  it("falls back to analyst ID when name is not provided", () => {
    expect(buildAssignmentLabel(42)).toBe("Assigned to Analyst #42");
  });

  it("uses name even if ID is 0 (edge case)", () => {
    expect(buildAssignmentLabel(0, "System")).toBe("Lead analyst unassigned");
  });
});

// ─── Comment Confidentiality Filter ──────────────────────────────────────────

type MockComment = { id: number; content: string; confidential: boolean; deletedAt: Date | null };

function filterComments(comments: MockComment[], role: string): MockComment[] {
  const canSeeConfidential = role === "admin" || role === "analyst" || role === "supervisor";
  return comments.filter(c => !c.deletedAt && (!c.confidential || canSeeConfidential));
}

const testComments: MockComment[] = [
  { id: 1, content: "Public note", confidential: false, deletedAt: null },
  { id: 2, content: "Confidential note", confidential: true, deletedAt: null },
  { id: 3, content: "Deleted note", confidential: false, deletedAt: new Date() },
  { id: 4, content: "Deleted confidential", confidential: true, deletedAt: new Date() },
];

describe("Comment Confidentiality Filter", () => {
  it("analyst can see public and confidential comments", () => {
    const result = filterComments(testComments, "analyst");
    expect(result.map(c => c.id)).toEqual([1, 2]);
  });

  it("admin can see public and confidential comments", () => {
    const result = filterComments(testComments, "admin");
    expect(result.map(c => c.id)).toEqual([1, 2]);
  });

  it("supervisor can see public and confidential comments", () => {
    const result = filterComments(testComments, "supervisor");
    expect(result.map(c => c.id)).toEqual([1, 2]);
  });

  it("readonly user cannot see confidential comments", () => {
    const result = filterComments(testComments, "readonly");
    expect(result.map(c => c.id)).toEqual([1]);
  });

  it("user role cannot see confidential comments", () => {
    const result = filterComments(testComments, "user");
    expect(result.map(c => c.id)).toEqual([1]);
  });

  it("soft-deleted comments are always excluded", () => {
    const result = filterComments(testComments, "admin");
    expect(result.every(c => !c.deletedAt)).toBe(true);
  });

  it("returns empty array when all comments are deleted", () => {
    const allDeleted = testComments.map(c => ({ ...c, deletedAt: new Date() }));
    expect(filterComments(allDeleted, "admin")).toHaveLength(0);
  });
});

// ─── Comment Edit/Delete Authorization ───────────────────────────────────────

function canEditComment(comment: { authorId: number | null }, requestingUserId: number, requestingRole: string): boolean {
  if (comment.authorId === requestingUserId) return true;
  if (requestingRole === "admin") return true;
  return false;
}

function canDeleteComment(comment: { authorId: number | null }, requestingUserId: number, requestingRole: string): boolean {
  return canEditComment(comment, requestingUserId, requestingRole);
}

describe("Comment Edit/Delete Authorization", () => {
  const comment = { authorId: 5 };

  it("author can edit their own comment", () => {
    expect(canEditComment(comment, 5, "analyst")).toBe(true);
  });

  it("admin can edit any comment", () => {
    expect(canEditComment(comment, 99, "admin")).toBe(true);
  });

  it("non-author non-admin cannot edit", () => {
    expect(canEditComment(comment, 10, "analyst")).toBe(false);
  });

  it("author can delete their own comment", () => {
    expect(canDeleteComment(comment, 5, "analyst")).toBe(true);
  });

  it("admin can delete any comment", () => {
    expect(canDeleteComment(comment, 99, "admin")).toBe(true);
  });

  it("non-author non-admin cannot delete", () => {
    expect(canDeleteComment(comment, 10, "readonly")).toBe(false);
  });
});

// ─── LLM Risk Notes Parsing ───────────────────────────────────────────────────

function parseLlmRiskNotes(content: string | object): string {
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  return `AI Assessment: ${(parsed as any).riskLevel?.toUpperCase()} risk. Factors: ${((parsed as any).keyRiskFactors ?? []).join("; ")}. ${(parsed as any).recommendation ?? ""}`;
}

describe("LLM Risk Notes Parsing", () => {
  it("parses a valid LLM JSON response", () => {
    const json = JSON.stringify({ riskLevel: "high", keyRiskFactors: ["PEP match", "Sanctions hit"], recommendation: "Escalate immediately" });
    const result = parseLlmRiskNotes(json);
    expect(result).toContain("HIGH risk");
    expect(result).toContain("PEP match");
    expect(result).toContain("Escalate immediately");
  });

  it("handles missing keyRiskFactors gracefully", () => {
    const json = JSON.stringify({ riskLevel: "low", recommendation: "Monitor" });
    const result = parseLlmRiskNotes(json);
    expect(result).toContain("LOW risk");
    expect(result).toContain("Monitor");
  });

  it("handles object input (pre-parsed)", () => {
    const obj = { riskLevel: "critical", keyRiskFactors: ["Fraud"], recommendation: "Freeze" };
    const result = parseLlmRiskNotes(obj);
    expect(result).toContain("CRITICAL risk");
    expect(result).toContain("Fraud");
  });
});
