import React from "react";
import type { RiskLevel, NigerianDataSource, Country } from "../../types/bis";
import { RISK_CONFIG, STATUS_CONFIG, SUPPORTED_COUNTRIES, NIGERIAN_DATA_SOURCES } from "../../types/bis";

// ── Risk Badge ────────────────────────────────────────────────────────────────

export function RiskBadge({ level, size = "md" }: { level: RiskLevel; size?: "sm" | "md" | "lg" }) {
  const cfg = RISK_CONFIG[level];
  const sizes = { sm: "text-xs px-2 py-0.5", md: "text-sm px-2.5 py-1", lg: "text-base px-3 py-1.5" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold border ${cfg.color} ${cfg.bg} ${cfg.border} ${sizes[size]}`}>
      <span>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────

export function StatusBadge({ status, size = "md" }: { status: string; size?: "sm" | "md" }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "text-muted-foreground", bg: "bg-muted" };
  const sizes = { sm: "text-xs px-2 py-0.5", md: "text-sm px-2.5 py-1" };
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${cfg.color} ${cfg.bg} ${sizes[size]}`}>
      {cfg.label}
    </span>
  );
}

// ── Score Gauge ───────────────────────────────────────────────────────────────

export function ScoreGauge({ score, label, size = 120 }: { score: number; label?: string; size?: number }) {
  const radius = (size / 2) - 10;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color = score >= 70 ? "var(--risk-low)" : score >= 50 ? "var(--risk-medium)" : score >= 30 ? "var(--risk-high)" : "var(--risk-critical)";

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-slate-200)" strokeWidth={8} />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
        <text
          x={size / 2} y={size / 2 + 6}
          textAnchor="middle"
          className="rotate-90"
          style={{ transform: `rotate(90deg)`, transformOrigin: `${size / 2}px ${size / 2}px`, fill: color, fontSize: size * 0.22, fontWeight: 700 }}
        >
          {Math.round(score)}
        </text>
      </svg>
      {label && <span className="text-xs text-muted-foreground font-medium">{label}</span>}
    </div>
  );
}

// ── Country Selector ──────────────────────────────────────────────────────────

export function CountrySelector({
  value, onChange, label = "Country", required = false, className = ""
}: {
  value: string;
  onChange: (code: string) => void;
  label?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-sm font-medium text-muted-foreground">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-card"
      >
        <option value="">Select country...</option>
        <optgroup label="🌍 Africa">
          {SUPPORTED_COUNTRIES.filter(c => ["NG","KE","GH","ZA","TZ","UG","RW","SN","CM","ET"].includes(c.code)).map(c => (
            <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
          ))}
        </optgroup>
        <optgroup label="🌎 Americas & Europe">
          {SUPPORTED_COUNTRIES.filter(c => ["US","GB"].includes(c.code)).map(c => (
            <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}

// ── Data Environment Banner ───────────────────────────────────────────────────

export function DataEnvironmentBanner({ country }: { country: Country }) {
  const configs = {
    rich:     { label: "Rich Data Environment", color: "bg-emerald-50 border-emerald-200 text-emerald-800", icon: "📊", desc: "Full digital records available. Standard verification applies." },
    moderate: { label: "Moderate Data Environment", color: "bg-blue-50 border-blue-200 text-blue-800", icon: "📋", desc: "Government APIs available. Some manual verification may be needed." },
    sparse:   { label: "Sparse Data Environment", color: "bg-amber-50 border-amber-200 text-amber-800", icon: "⚠️", desc: "Limited digital records. Physical verification and community checks recommended." },
    minimal:  { label: "Minimal Data Environment", color: "bg-orange-50 border-orange-200 text-orange-800", icon: "🔍", desc: "Very limited digital infrastructure. Zero-footprint investigation required." },
  };
  const cfg = configs[country.dataEnvironment];
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${cfg.color} text-sm`}>
      <span className="text-lg">{cfg.icon}</span>
      <div>
        <div className="font-semibold">{cfg.label}</div>
        <div className="opacity-80 mt-0.5">{cfg.desc}</div>
        {country.primarySources.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {country.primarySources.map(s => (
              <span key={s} className="bg-card/60 border border-current/20 rounded px-1.5 py-0.5 text-xs font-medium">{s}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Nigerian Data Source Card ─────────────────────────────────────────────────

export function NigerianSourceCard({
  source, selected, onToggle
}: {
  source: NigerianDataSource;
  selected: boolean;
  onToggle: () => void;
}) {
  const tierColors: Record<number, string> = {
    1: "bg-blue-100 text-blue-700",
    2: "bg-violet-100 text-violet-700",
    3: "bg-emerald-100 text-emerald-700",
    4: "bg-red-100 text-red-700",
    5: "bg-orange-100 text-orange-700",
    6: "bg-cyan-100 text-cyan-700",
    7: "bg-muted text-muted-foreground",
  };
  const categoryIcons: Record<string, string> = {
    identity: "🪪", business: "🏢", financial: "💳", watchlist: "🚨",
    criminal: "⚖️", telecom: "📱", education: "🎓",
  };

  return (
    <button
      onClick={onToggle}
      className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
        selected ? "border-blue-500 bg-blue-50" : "border-border bg-card hover:border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">{categoryIcons[source.category]}</span>
          <div className="min-w-0">
            <div className="font-semibold text-sm text-muted-foreground truncate">{source.shortName}</div>
            <div className="text-xs text-muted-foreground truncate">{source.name}</div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${tierColors[source.tier]}`}>
            Tier {source.tier}
          </span>
          {selected && <span className="text-blue-600 text-sm font-bold">✓</span>}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span>💰 ${source.avgCostUSD.toFixed(2)}</span>
        <span>⏱ {source.avgTurnaround}</span>
        <span>📶 {Math.round(source.reliability * 100)}% uptime</span>
        {source.requiresConsent && <span className="text-amber-600 font-medium">Consent req.</span>}
      </div>
    </button>
  );
}

// ── Confidence Meter ──────────────────────────────────────────────────────────

export function ConfidenceMeter({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  const label = pct >= 70 ? "High Confidence" : pct >= 40 ? "Medium Confidence" : "Low Confidence";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Data Confidence</span>
        <span className="font-semibold">{pct}% — {label}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Section Card ──────────────────────────────────────────────────────────────

export function SectionCard({ title, icon, children, className = "" }: {
  title: string; icon?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-card rounded-2xl border border-border shadow-sm overflow-hidden ${className}`}>
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        {icon && <span className="text-lg">{icon}</span>}
        <h3 className="font-semibold text-muted-foreground">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Field Agent Status Timeline ───────────────────────────────────────────────

export function FieldAgentTimeline({ status }: { status: string }) {
  const steps = [
    { key: "pending",     label: "Dispatched",     icon: "📤" },
    { key: "assigned",    label: "Agent Assigned",  icon: "👤" },
    { key: "in_progress", label: "On Site",         icon: "📍" },
    { key: "completed",   label: "Report Filed",    icon: "✅" },
  ];
  const currentIdx = steps.findIndex(s => s.key === status);

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, idx) => {
        const done = idx <= currentIdx;
        const active = idx === currentIdx;
        return (
          <React.Fragment key={step.key}>
            <div className="flex flex-col items-center gap-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 transition-all ${
                done ? "bg-blue-600 border-blue-600 text-white" : "bg-card border-border text-muted-foreground"
              } ${active ? "ring-2 ring-blue-300 ring-offset-1" : ""}`}>
                {step.icon}
              </div>
              <span className={`text-xs font-medium ${done ? "text-blue-700" : "text-muted-foreground"}`}>{step.label}</span>
            </div>
            {idx < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mb-5 ${idx < currentIdx ? "bg-blue-500" : "bg-muted"}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Hard Stop Alert ───────────────────────────────────────────────────────────

export function HardStopAlert({ stops }: { stops: string[] }) {
  if (!stops.length) return null;
  return (
    <div className="bg-red-50 border-2 border-red-400 rounded-xl p-4">
      <div className="flex items-center gap-2 text-red-700 font-bold text-sm mb-2">
        <span className="text-xl">🚨</span>
        HARD STOP — Investigation Terminated
      </div>
      <ul className="space-y-1">
        {stops.map((s, i) => (
          <li key={i} className="text-red-600 text-sm flex items-start gap-2">
            <span>•</span><span>{s}</span>
          </li>
        ))}
      </ul>
      <p className="text-red-600 text-xs mt-2">
        This subject has been flagged on a watchlist. Do not proceed. Contact compliance immediately.
      </p>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, description, action }: {
  icon: string; title: string; description: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="text-5xl mb-4">{icon}</span>
      <h3 className="text-lg font-semibold text-muted-foreground mb-1">{title}</h3>
      <p className="text-muted-foreground text-sm max-w-xs">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
