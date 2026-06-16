/**
 * GlobalSearchBar — cross-entity search across investigations, alerts, and KYC records.
 *
 * Calls trpc.search.cross.useQuery with a debounced 300ms delay.
 * Results are grouped by entity type with click-through navigation.
 * Keyboard: ↑/↓ to navigate, Enter to select, Escape to close.
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { Search, FileSearch, ShieldAlert, UserCheck, X, Loader2, AlertCircle } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchHit {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  entityType: 'investigation' | 'alert' | 'kyc';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTITY_META = {
  investigation: {
    label: 'Investigations',
    icon: FileSearch,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
  },
  alert: {
    label: 'Alerts',
    icon: ShieldAlert,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
  },
  kyc: {
    label: 'KYC Records',
    icon: UserCheck,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function extractHits(data: any): SearchHit[] {
  if (!data) return [];
  const hits: SearchHit[] = [];

  // investigations
  const invHits = data['bis-investigations']?.hits ?? [];
  for (const h of invHits) {
    const src = h._source ?? {};
    hits.push({
      id: h._id,
      entityType: 'investigation',
      title: src.subject_name ?? src.title ?? `Investigation #${h._id}`,
      subtitle: src.status ? `Status: ${src.status}` : undefined,
      href: `/investigations/${h._id}`,
    });
  }

  // alerts
  const alertHits = data['bis-alerts']?.hits ?? [];
  for (const h of alertHits) {
    const src = h._source ?? {};
    hits.push({
      id: h._id,
      entityType: 'alert',
      title: src.title ?? `Alert #${h._id}`,
      subtitle: src.severity ? `Severity: ${src.severity}` : undefined,
      href: `/alerts`,
    });
  }

  // kyc
  const kycHits = data['bis-kyc']?.hits ?? [];
  for (const h of kycHits) {
    const src = h._source ?? {};
    hits.push({
      id: h._id,
      entityType: 'kyc',
      title: src.subject_name ?? `KYC #${h._id}`,
      subtitle: src.status ? `Status: ${src.status}` : undefined,
      href: `/kyc-records`,
    });
  }

  return hits;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GlobalSearchBar() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  const debouncedQuery = useDebounce(query.trim(), 300);
  const enabled = debouncedQuery.length >= 2;

  const { data, isFetching, isError } = trpc.search.cross.useQuery(
    { query: debouncedQuery, size: 12 },
    {
      enabled,
      staleTime: 10_000,
    }
  );

  const hits = extractHits(data);

  // Group hits by entity type for display
  const grouped: Record<string, SearchHit[]> = {};
  for (const hit of hits) {
    if (!grouped[hit.entityType]) grouped[hit.entityType] = [];
    grouped[hit.entityType].push(hit);
  }

  // Flat ordered list for keyboard navigation
  const flatHits = [
    ...(grouped['investigation'] ?? []),
    ...(grouped['alert'] ?? []),
    ...(grouped['kyc'] ?? []),
  ];

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery]);

  // Open panel when query is non-empty
  useEffect(() => {
    setOpen(query.trim().length > 0);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard: Ctrl+K / Cmd+K to focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, flatHits.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const hit = flatHits[activeIndex];
        if (hit) {
          navigate(hit.href);
          setOpen(false);
          setQuery('');
        }
      } else if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    },
    [open, flatHits, activeIndex, navigate]
  );

  const handleSelect = (hit: SearchHit) => {
    navigate(hit.href);
    setOpen(false);
    setQuery('');
  };

  const showEmpty = enabled && !isFetching && !isError && hits.length === 0;
  const showResults = enabled && (hits.length > 0 || isFetching || isError);

  // Running index for keyboard navigation across groups
  let runningIndex = 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-xs">
      {/* Input */}
      <div className="relative flex items-center">
        <Search
          size={12}
          className="absolute left-2.5 text-muted-foreground pointer-events-none"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => query.trim().length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search… (⌘K)"
          className={cn(
            'w-full h-7 pl-7 pr-7 text-xs rounded-md',
            'bg-muted/50 border border-border',
            'text-foreground placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50',
            'transition-all font-mono'
          )}
          aria-label="Global search"
          aria-expanded={open}
          aria-haspopup="listbox"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="global-search-results"
          aria-activedescendant={
            open && flatHits[activeIndex] ? `search-hit-${flatHits[activeIndex].id}` : undefined
          }
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setOpen(false); }}
            className="absolute right-2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear search"
          >
            <X size={10} />
          </button>
        )}
        {isFetching && (
          <Loader2 size={10} className="absolute right-2 text-muted-foreground animate-spin" />
        )}
      </div>

      {/* Results panel */}
      {open && (showResults || showEmpty) && (
        <div
          id="global-search-results"
          role="listbox"
          className={cn(
            'absolute top-full left-0 right-0 mt-1 z-[200]',
            'bg-card border border-border rounded-lg shadow-xl',
            'max-h-80 overflow-y-auto',
            'animate-in fade-in-0 zoom-in-95 duration-100'
          )}
        >
          {isError && (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-destructive">
              <AlertCircle size={12} />
              <span>Search unavailable — check gateway connection</span>
            </div>
          )}

          {showEmpty && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground font-mono">
              No results for &ldquo;{debouncedQuery}&rdquo;
            </div>
          )}

          {(Object.keys(ENTITY_META) as Array<keyof typeof ENTITY_META>).map(entityType => {
            const group = grouped[entityType];
            if (!group?.length) return null;
            const meta = ENTITY_META[entityType];
            const Icon = meta.icon;

            return (
              <div key={entityType}>
                {/* Group header */}
                <div
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5',
                    'text-[10px] font-mono font-semibold tracking-widest',
                    'border-b border-border/50',
                    meta.color
                  )}
                >
                  <Icon size={10} />
                  {meta.label.toUpperCase()}
                  <span className="ml-auto text-muted-foreground">{group.length}</span>
                </div>

                {/* Hits */}
                {group.map(hit => {
                  const idx = runningIndex++;
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={hit.id}
                      id={`search-hit-${hit.id}`}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => handleSelect(hit)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={cn(
                        'w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors',
                        'hover:bg-accent/50',
                        isActive && 'bg-accent/70'
                      )}
                    >
                      <div
                        className={cn(
                          'mt-0.5 w-5 h-5 rounded flex items-center justify-center shrink-0',
                          meta.bg,
                          `border ${meta.border}`
                        )}
                      >
                        <Icon size={10} className={meta.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate leading-tight">
                          {hit.title}
                        </p>
                        {hit.subtitle && (
                          <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                            {hit.subtitle}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}

          {/* Footer hint */}
          {flatHits.length > 0 && (
            <div className="px-3 py-1.5 border-t border-border/50 flex items-center gap-3 text-[10px] text-muted-foreground font-mono">
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span>esc close</span>
              <button
                onClick={() => {
                  navigate(`/search?q=${encodeURIComponent(debouncedQuery)}`);
                  setOpen(false);
                  setQuery('');
                }}
                className="ml-auto text-primary hover:text-primary/80 transition-colors"
              >
                View all {flatHits.length} result{flatHits.length !== 1 ? 's' : ''} →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
