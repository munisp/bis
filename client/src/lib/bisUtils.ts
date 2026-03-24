// bisUtils.ts — Shared types and utility functions for the BIS platform
// These were previously co-located with mock data; now extracted as pure utilities.

// ─── Domain types ─────────────────────────────────────────────────────────────

export type InvestigationStatus = 'pending' | 'processing' | 'completed' | 'flagged' | 'draft';
export type InvestigationTier = 'basic' | 'standard' | 'comprehensive';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type EntityType = 'individual' | 'corporate' | 'government' | 'ngo';

// ─── Style helpers ────────────────────────────────────────────────────────────

export function getRiskColor(level: RiskLevel): string {
  switch (level) {
    case 'low':      return 'text-emerald-400';
    case 'medium':   return 'text-amber-400';
    case 'high':     return 'text-orange-400';
    case 'critical': return 'text-red-400';
  }
}

export function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'completed':
    case 'verified':
    case 'connected':
    case 'active':
      return 'bis-badge-verified';
    case 'pending':
    case 'processing':
    case 'new':
      return 'bis-badge-processing';
    case 'flagged':
    case 'rejected':
    case 'failed':
    case 'offline':
    case 'escalated':
      return 'bis-badge-flagged';
    case 'draft':
    case 'dismissed':
    case 'suspended':
      return 'bis-badge-draft';
    case 'degraded':
    case 'reviewed':
      return 'bis-badge-pending';
    default:
      return 'bis-badge-draft';
  }
}

// ─── Date formatting ──────────────────────────────────────────────────────────

export function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function formatDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function relTime(ts: string | Date | number): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
