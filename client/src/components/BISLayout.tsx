// BISLayout — Persistent sidebar + header with notification bell slide-over
// Design: Forensic Intelligence Dark theme, JetBrains Mono typography

import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  LayoutDashboard, Search, FileText, Fingerprint, ShieldCheck,
  Activity, Users, Database, Settings, Bell, ChevronDown,
  ChevronRight, LogOut, Menu, X, AlertTriangle, Car, Pill,
  Briefcase, Globe, MapPin, MessageSquare, Building2, Eye,
  UserCheck, BarChart3, Key, Zap, CheckCheck, ArrowRight
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLocation as useWouterLocation } from 'wouter';

// ─── Nav config ───────────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: string | number;
  badgeVariant?: 'default' | 'destructive' | 'secondary';
}

interface NavGroup {
  label: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

const navGroups: NavGroup[] = [
  {
    label: 'INTELLIGENCE',
    defaultOpen: true,
    items: [
      { label: 'Dashboard', href: '/', icon: <LayoutDashboard size={15} /> },
      { label: 'Investigations', href: '/investigations', icon: <Search size={15} />, badge: 143 },
      { label: 'Reports', href: '/reports', icon: <FileText size={15} /> },
      { label: 'Alerts', href: '/alerts', icon: <AlertTriangle size={15} />, badge: 5, badgeVariant: 'destructive' },
    ],
  },
  {
    label: 'IDENTITY & KYC',
    defaultOpen: true,
    items: [
      { label: 'KYC / KYB', href: '/kyc-verification', icon: <ShieldCheck size={15} /> },
      { label: 'Biometric Enrollment', href: '/biometric-enrollment', icon: <Fingerprint size={15} /> },
      { label: 'Onboarding', href: '/onboarding', icon: <UserCheck size={15} /> },
    ],
  },
  {
    label: 'SCREENING',
    defaultOpen: true,
    items: [
      { label: 'MVR Check', href: '/mvr-check', icon: <Car size={15} /> },
      { label: 'Drug Screening', href: '/drug-screening', icon: <Pill size={15} /> },
      { label: 'Work Authorization', href: '/work-authorization', icon: <Briefcase size={15} /> },
      { label: 'Zero-Footprint', href: '/zero-footprint', icon: <Eye size={15} /> },
    ],
  },
  {
    label: 'MONITORING',
    defaultOpen: true,
    items: [
      { label: 'Continuous Monitoring', href: '/continuous-monitoring', icon: <Activity size={15} />, badge: 47, badgeVariant: 'destructive' },
      { label: 'Social Intelligence', href: '/social-monitoring', icon: <Globe size={15} /> },
      { label: 'Messaging Channels', href: '/messaging-channels', icon: <MessageSquare size={15} /> },
    ],
  },
  {
    label: 'DATA SOURCES',
    defaultOpen: true,
    items: [
      { label: 'Nigerian Data Bundle', href: '/nigeria-data-bundle', icon: <MapPin size={15} /> },
      { label: 'Field Agents', href: '/field-agents', icon: <Users size={15} /> },
      { label: 'Data Sources', href: '/data-sources', icon: <Database size={15} /> },
    ],
  },
  {
    label: 'PLATFORM',
    defaultOpen: true,
    items: [
      { label: 'Tenants & API Keys', href: '/tenants', icon: <Key size={15} /> },
      { label: 'Settings', href: '/settings', icon: <Settings size={15} /> },
    ],
  },
];

// ─── Notification data ────────────────────────────────────────────────────────

type NotifSeverity = 'critical' | 'high' | 'medium' | 'low';

interface Notification {
  id: string;
  severity: NotifSeverity;
  title: string;
  body: string;
  time: string;
  ref?: string;
  read: boolean;
}

const SEED_NOTIFICATIONS: Notification[] = [
  { id: 'n1', severity: 'critical', title: 'OFAC SDN Match — BIS-2026-0004', body: 'Emeka Nwosu appears on OFAC Specially Designated Nationals list at 94% confidence.', time: '11:02', ref: 'BIS-2026-0004', read: false },
  { id: 'n2', severity: 'high', title: 'PEP Classification — BIS-2026-0007', body: 'Fatima Al-Hassan has been classified as a Politically Exposed Person (ward-level official).', time: '10:51', ref: 'BIS-2026-0007', read: false },
  { id: 'n3', severity: 'high', title: 'Adverse Media — BIS-2026-0002', body: 'Zenith Logistics Ltd director mentioned in Punch investigative report on procurement fraud.', time: '10:47', ref: 'BIS-2026-0002', read: false },
  { id: 'n4', severity: 'medium', title: 'Document Anomaly — BIS-2026-0011', body: 'Passport scan for Ibrahim Musa shows tampering score of 78.4%. Manual review required.', time: '10:30', ref: 'BIS-2026-0011', read: false },
  { id: 'n5', severity: 'medium', title: 'Incoming Report — Fraud Allegation', body: 'WhatsApp report: Land fraud suspect in Ikeja, Lagos. ₦5M collected from 3 victims.', time: '10:15', ref: undefined, read: false },
  { id: 'n6', severity: 'high', title: 'INTERPOL Red Notice Match', body: 'New INTERPOL Red Notice match detected for subject in BIS-2026-0011. Cross-border alert issued.', time: '09:58', ref: 'BIS-2026-0011', read: true },
  { id: 'n7', severity: 'low', title: 'Field Task Completed — FA-NG-0142', body: 'Address verification for Emeka Okafor completed by Adebayo Ogundimu. GPS-signed proof attached.', time: '09:30', ref: 'BIS-2026-0004', read: true },
  { id: 'n8', severity: 'medium', title: 'Credit Score Decline — BIS-2026-0009', body: 'Subject\'s CRC credit score dropped from 612 to 512 in the last 30 days. 2 new delinquencies.', time: '09:00', ref: 'BIS-2026-0009', read: true },
  { id: 'n9', severity: 'low', title: 'KYC Batch Completed', body: '134 KYC verifications completed today. Pass rate: 94.2%. 8 manual reviews pending.', time: '08:30', ref: undefined, read: true },
  { id: 'n10', severity: 'critical', title: 'Sanctions List Updated', body: 'OFAC SDN list updated with 23 new entries. Automated re-screening of active subjects in progress.', time: '08:00', ref: undefined, read: true },
];

const SEVERITY_CONFIG: Record<NotifSeverity, { color: string; bg: string; dot: string }> = {
  critical: { color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30',     dot: 'bg-red-400' },
  high:     { color: 'text-orange-400',  bg: 'bg-orange-500/10 border-orange-500/30', dot: 'bg-orange-400' },
  medium:   { color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/30',  dot: 'bg-amber-400' },
  low:      { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400' },
};

// ─── NavGroup sub-component ───────────────────────────────────────────────────

function NavGroupItem({ group, currentPath }: { group: NavGroup; currentPath: string }) {
  const [open, setOpen] = useState(group.defaultOpen ?? false);

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold tracking-widest text-sidebar-foreground/40 hover:text-sidebar-foreground/60 transition-colors"
      >
        <span>{group.label}</span>
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      </button>
      {open && (
        <div className="space-y-0.5 animate-slide-in">
          {group.items.map(item => (
            <Link key={item.href} href={item.href}>
              <div className={cn('nav-item', currentPath === item.href && 'active')}>
                <span className="text-sidebar-foreground/50 group-hover:text-sidebar-foreground">{item.icon}</span>
                <span className="flex-1 text-sm">{item.label}</span>
                {item.badge !== undefined && (
                  <Badge
                    variant={item.badgeVariant ?? 'secondary'}
                    className="text-[10px] h-4 px-1.5 font-mono"
                  >
                    {item.badge}
                  </Badge>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Notification Panel ───────────────────────────────────────────────────────

function NotificationPanel({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onClose,
  onNavigate,
}: {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClose: () => void;
  onNavigate: (href: string) => void;
}) {
  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="fixed right-3 top-14 w-96 z-50 bg-[#0d1117] border border-border rounded-xl shadow-2xl flex flex-col max-h-[calc(100vh-5rem)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Bell size={13} className="text-primary" />
            <span className="text-sm font-mono font-semibold text-foreground">Notifications</span>
            {unreadCount > 0 && (
              <span className="text-[9px] font-mono font-bold bg-red-500/20 text-red-400 border border-red-500/30 rounded px-1.5 py-0.5">
                {unreadCount} unread
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllRead}
                className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted/30"
              >
                <CheckCheck size={10} /> Mark all read
              </button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Notification list */}
        <div className="overflow-y-auto flex-1">
          {notifications.map(notif => {
            const cfg = SEVERITY_CONFIG[notif.severity];
            return (
              <div
                key={notif.id}
                className={cn(
                  "px-4 py-3 border-b border-border/50 transition-colors",
                  notif.read ? "opacity-60" : "bg-muted/10"
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Severity dot */}
                  <div className="mt-1.5 flex-shrink-0">
                    <span className={cn("w-2 h-2 rounded-full block", cfg.dot, !notif.read && "animate-pulse")} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={cn("text-[9px] font-mono font-bold uppercase rounded px-1 py-0.5 border", cfg.bg, cfg.color)}>
                        {notif.severity}
                      </span>
                      <span className="text-[9px] font-mono text-muted-foreground/60">{notif.time}</span>
                    </div>
                    <p className="text-xs font-mono font-semibold text-foreground leading-tight">{notif.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">{notif.body}</p>

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-1.5">
                      {notif.ref && (
                        <button
                          onClick={() => {
                            onNavigate('/investigations');
                            onClose();
                          }}
                          className="flex items-center gap-1 text-[10px] font-mono text-primary hover:text-primary/80 transition-colors"
                        >
                          <ArrowRight size={9} /> View {notif.ref}
                        </button>
                      )}
                      {!notif.read && (
                        <button
                          onClick={() => onMarkRead(notif.id)}
                          className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors ml-auto"
                        >
                          <CheckCheck size={9} /> Mark read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-border flex-shrink-0">
          <button
            onClick={() => { onNavigate('/alerts'); onClose(); }}
            className="w-full text-center text-[10px] font-mono text-primary hover:text-primary/80 transition-colors flex items-center justify-center gap-1"
          >
            View all alerts <ArrowRight size={9} />
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Main Layout ──────────────────────────────────────────────────────────────

interface BISLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function BISLayout({ children, title, subtitle, actions }: BISLayoutProps) {
  const [location] = useLocation();
  const [, navigate] = useWouterLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>(SEED_NOTIFICATIONS);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          'flex flex-col scanline transition-all duration-200 shrink-0',
          'bg-sidebar border-r border-sidebar-border',
          sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-md bg-primary/20 border border-primary/40 flex items-center justify-center glow-blue">
            <ShieldCheck size={16} className="text-primary" />
          </div>
          <div>
            <div className="text-sm font-bold text-sidebar-foreground tracking-wide">BIS Platform</div>
            <div className="text-[10px] text-sidebar-foreground/40 font-mono tracking-widest">INTELLIGENCE v2.0</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
          {navGroups.map(group => (
            <NavGroupItem key={group.label} group={group} currentPath={location} />
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-sidebar-accent transition-colors cursor-pointer">
            <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
              <span className="text-[10px] font-bold text-primary">OP</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-sidebar-foreground truncate">Operator Admin</div>
              <div className="text-[10px] text-sidebar-foreground/40 font-mono truncate">admin@bis.platform</div>
            </div>
            <LogOut size={12} className="text-sidebar-foreground/40 hover:text-sidebar-foreground" />
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-12 flex items-center gap-3 px-4 border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X size={14} /> : <Menu size={14} />}
          </Button>

          <div className="flex-1 flex items-center gap-2">
            {title && (
              <>
                <span className="text-sm font-semibold text-foreground">{title}</span>
                {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {actions}

            {/* Bell button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 relative"
              onClick={() => setBellOpen(prev => !prev)}
            >
              <Bell size={14} className={bellOpen ? 'text-primary' : ''} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-[8px] font-bold text-white flex items-center justify-center font-mono">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>

            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-glow" />
              <span className="text-[10px] font-mono text-emerald-400">LIVE</span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6 animate-fade-up">
          {children}
        </main>
      </div>

      {/* Notification panel */}
      {bellOpen && (
        <NotificationPanel
          notifications={notifications}
          onMarkRead={markRead}
          onMarkAllRead={markAllRead}
          onClose={() => setBellOpen(false)}
          onNavigate={navigate}
        />
      )}
    </div>
  );
}
