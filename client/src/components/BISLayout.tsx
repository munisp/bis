// BIS Layout — Forensic Intelligence Dark theme
// Persistent sidebar with collapsible nav groups + main content area

import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  LayoutDashboard, Search, FileText, Fingerprint, ShieldCheck,
  Activity, Users, Database, Settings, Bell, ChevronDown,
  ChevronRight, LogOut, Menu, X, AlertTriangle, Car, Pill,
  Briefcase, Globe, MapPin, MessageSquare, Building2, Eye,
  UserCheck, BarChart3, Key, Zap
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
    defaultOpen: false,
    items: [
      { label: 'MVR Check', href: '/mvr-check', icon: <Car size={15} /> },
      { label: 'Drug Screening', href: '/drug-screening', icon: <Pill size={15} /> },
      { label: 'Work Authorization', href: '/work-authorization', icon: <Briefcase size={15} /> },
      { label: 'Zero-Footprint', href: '/zero-footprint', icon: <Eye size={15} /> },
    ],
  },
  {
    label: 'MONITORING',
    defaultOpen: false,
    items: [
      { label: 'Continuous Monitoring', href: '/continuous-monitoring', icon: <Activity size={15} />, badge: 47, badgeVariant: 'destructive' },
      { label: 'Social Intelligence', href: '/social-monitoring', icon: <Globe size={15} /> },
      { label: 'Messaging Channels', href: '/messaging-channels', icon: <MessageSquare size={15} /> },
    ],
  },
  {
    label: 'DATA SOURCES',
    defaultOpen: false,
    items: [
      { label: 'Nigerian Data Bundle', href: '/nigeria-data-bundle', icon: <MapPin size={15} /> },
      { label: 'Social Intelligence', href: '/social-monitoring', icon: <Globe size={15} /> },
    ],
  },
  {
    label: 'PLATFORM',
    defaultOpen: false,
    items: [
      { label: 'Tenants & API Keys', href: '/tenants', icon: <Key size={15} /> },
      { label: 'Onboarding', href: '/onboarding', icon: <Building2 size={15} /> },
      { label: 'Settings', href: '/settings', icon: <Settings size={15} /> },
    ],
  },
];

function NavGroup({ group, currentPath }: { group: NavGroup; currentPath: string }) {
  const [open, setOpen] = useState(group.defaultOpen ?? false);
  const hasActive = group.items.some(i => i.href === currentPath);

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

interface BISLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function BISLayout({ children, title, subtitle, actions }: BISLayoutProps) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
            <NavGroup key={group.label} group={group} currentPath={location} />
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
            <Button variant="ghost" size="icon" className="h-7 w-7 relative">
              <Bell size={14} />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse-glow" />
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
    </div>
  );
}
