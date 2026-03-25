import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Clock, AlertTriangle } from "lucide-react";

interface SlaCountdownProps {
  dueAt: Date | string | null | undefined;
  className?: string;
}

function getTimeLeft(dueAt: Date | string | null | undefined): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  urgent: boolean;
} {
  if (!dueAt) return { label: "No SLA", variant: "outline", urgent: false };

  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();

  if (diffMs < 0) {
    const overMs = Math.abs(diffMs);
    const overH = Math.floor(overMs / 3600000);
    const overD = Math.floor(overH / 24);
    const label = overD > 0 ? `${overD}d overdue` : `${overH}h overdue`;
    return { label, variant: "destructive", urgent: true };
  }

  const hoursLeft = Math.floor(diffMs / 3600000);
  const daysLeft = Math.floor(hoursLeft / 24);
  const minsLeft = Math.floor((diffMs % 3600000) / 60000);

  if (hoursLeft < 1) {
    return { label: `${minsLeft}m left`, variant: "destructive", urgent: true };
  }
  if (hoursLeft < 24) {
    return { label: `${hoursLeft}h left`, variant: "destructive", urgent: true };
  }
  if (daysLeft < 3) {
    return { label: `${daysLeft}d left`, variant: "secondary", urgent: false };
  }
  return { label: `${daysLeft}d left`, variant: "default", urgent: false };
}

export function SlaCountdown({ dueAt, className }: SlaCountdownProps) {
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft(dueAt));

  useEffect(() => {
    setTimeLeft(getTimeLeft(dueAt));
    const interval = setInterval(() => {
      setTimeLeft(getTimeLeft(dueAt));
    }, 60_000); // refresh every minute
    return () => clearInterval(interval);
  }, [dueAt]);

  if (!dueAt) return null;

  const Icon = timeLeft.urgent ? AlertTriangle : Clock;

  return (
    <Badge variant={timeLeft.variant} className={`flex items-center gap-1 text-xs ${className ?? ""}`}>
      <Icon className="h-3 w-3" />
      {timeLeft.label}
    </Badge>
  );
}
