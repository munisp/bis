/**
 * SearchResults.tsx — Full-page cross-entity search results
 *
 * Accessible via /search?q=<query>. Shows all entity types (investigations,
 * alerts, KYC records) in a tabbed layout. The GlobalSearchBar dropdown
 * links here for overflow results beyond the 5-per-type preview.
 */

import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import BISLayout from '@/components/BISLayout';
import { trpc } from '@/lib/trpc';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Search, AlertTriangle, ShieldCheck, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function useSearchQuery(): string {
  const [location] = useLocation();
  const params = new URLSearchParams(location.split('?')[1] ?? '');
  return params.get('q') ?? '';
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <span>{text}</span>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-primary/20 text-primary rounded px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

// ─── Hit extraction (mirrors GlobalSearchBar logic) ───────────────────────────

interface NormalisedHit {
  id: string;
  entityType: 'investigation' | 'alert' | 'kyc';
  title: string;
  subtitle?: string;
  href: string;
}

function extractHits(data: any): NormalisedHit[] {
  if (!data) return [];
  const hits: NormalisedHit[] = [];

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

// ─── Result row ───────────────────────────────────────────────────────────────

const ENTITY_ICON: Record<NormalisedHit['entityType'], React.ReactNode> = {
  investigation: <FileText size={15} className="text-blue-400 mt-0.5 flex-shrink-0" />,
  alert:         <AlertTriangle size={15} className="text-amber-400 mt-0.5 flex-shrink-0" />,
  kyc:           <ShieldCheck size={15} className="text-emerald-400 mt-0.5 flex-shrink-0" />,
};

function HitRow({ hit, query, onClick }: { hit: NormalisedHit; query: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors flex items-start gap-3"
    >
      {ENTITY_ICON[hit.entityType]}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-foreground truncate">
            <HighlightText text={hit.title} query={query} />
          </span>
          <Badge variant="secondary" className="text-[10px] font-mono flex-shrink-0 capitalize">
            {hit.entityType}
          </Badge>
        </div>
        {hit.subtitle && (
          <p className="text-xs text-muted-foreground truncate">{hit.subtitle}</p>
        )}
      </div>
    </button>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
      <Search size={32} className="opacity-20" />
      <p className="text-sm">No results for <strong className="text-foreground">"{query}"</strong></p>
      <p className="text-xs">Try a different keyword or broaden your search.</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function SearchResultsInner() {
  const initialQuery = useSearchQuery();
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [, navigate] = useLocation();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (debouncedQuery) {
      navigate(`/search?q=${encodeURIComponent(debouncedQuery)}`, { replace: true });
    }
  }, [debouncedQuery, navigate]);

  const { data, isFetching } = trpc.search.cross.useQuery(
    { query: debouncedQuery, size: 50 },
    { enabled: debouncedQuery.length >= 2, staleTime: 10_000 }
  );

  const allHits = extractHits(data);
  const investigations = allHits.filter(h => h.entityType === 'investigation');
  const alerts = allHits.filter(h => h.entityType === 'alert');
  const kycRecords = allHits.filter(h => h.entityType === 'kyc');

  const tabs = [
    { value: 'all',            label: 'All',            count: allHits.length },
    { value: 'investigations', label: 'Investigations',  count: investigations.length },
    { value: 'alerts',         label: 'Alerts',          count: alerts.length },
    { value: 'kyc',            label: 'KYC Records',     count: kycRecords.length },
  ];

  function renderList(hits: NormalisedHit[]) {
    if (hits.length === 0) return <EmptyState query={debouncedQuery} />;
    return (
      <Card>
        <CardContent className="p-0">
          {hits.map(hit => (
            <HitRow
              key={`${hit.entityType}-${hit.id}`}
              hit={hit}
              query={debouncedQuery}
              onClick={() => navigate(hit.href)}
            />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search input */}
      <div className="relative max-w-xl">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search investigations, alerts, KYC records…"
          className="pl-9 font-mono text-sm"
          autoFocus
        />
        {isFetching && (
          <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Results */}
      {debouncedQuery.length >= 2 ? (
        <Tabs defaultValue="all">
          <TabsList className="mb-4 flex-wrap h-auto gap-1">
            {tabs.map(tab => (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5 text-xs">
                {tab.label}
                {tab.count > 0 && (
                  <span className={cn(
                    "text-[10px] font-mono rounded px-1 py-0.5",
                    tab.value === 'all'
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {tab.count}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="all">{renderList(allHits)}</TabsContent>
          <TabsContent value="investigations">{renderList(investigations)}</TabsContent>
          <TabsContent value="alerts">{renderList(alerts)}</TabsContent>
          <TabsContent value="kyc">{renderList(kycRecords)}</TabsContent>
        </Tabs>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Search size={32} className="opacity-20" />
          <p className="text-sm">Type at least 2 characters to search</p>
        </div>
      )}
    </div>
  );
}

export default function SearchResults() {
  const query = useSearchQuery();
  return (
    <BISLayout
      title="Search Results"
      subtitle={query ? `Results for "${query}"` : 'Cross-entity search'}
    >
      <SearchResultsInner />
    </BISLayout>
  );
}
