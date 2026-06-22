import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Database, Loader2, Search, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  getCpqRuleTableDetail,
  type CpqRuleRow,
  type CpqRuleTableDetail,
} from '@/lib/pricing-library-api';

function labelize(value: string | null | undefined): string {
  if (!value) return '-';
  return value.replace(/_/g, ' ');
}

function money(value: number | null): string {
  if (value == null) return '-';
  return `$${Number(value).toFixed(2)}`;
}

function pct(value: number | null): string {
  if (value == null) return '-';
  return `${Number(value).toFixed(2)}%`;
}

function ruleValue(rule: CpqRuleRow): string {
  if (rule.priceStatus !== 'PRICED') return labelize(rule.priceStatus);
  if (rule.actionType === 'PERCENT_OF') return pct(rule.percentage);
  return money(rule.amount);
}

function conditionsText(rule: CpqRuleRow): string {
  if (rule.conditions.length === 0) return 'Always';
  return rule.conditions
    .map((condition) => {
      const field = condition.fieldPath ?? '?';
      const value = [condition.value1, condition.value2].filter(Boolean).join('..') || '?';
      return `${field} ${condition.operator} ${value}${condition.unit ? ` ${condition.unit}` : ''}`;
    })
    .join('; ');
}

function searchableRule(rule: CpqRuleRow): string {
  return [
    rule.ruleKey,
    rule.entityType,
    rule.chargeCategory,
    rule.itemOrOptionCode,
    rule.priceStatus,
    rule.actionType,
    rule.amount,
    rule.percentage,
    rule.unitOfMeasure,
    rule.quantityBasisField,
    rule.rawValueText,
    rule.reviewStatus,
    conditionsText(rule),
  ]
    .filter((value) => value != null)
    .join(' ')
    .toLowerCase();
}

export default function PricingRuleTableDetailPage() {
  const { priceTableId } = useParams<{ priceTableId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [detail, setDetail] = useState<CpqRuleTableDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [reviewFilter, setReviewFilter] = useState('all');

  const load = useCallback(async () => {
    if (!priceTableId) return;
    setLoading(true);
    try {
      setDetail(await getCpqRuleTableDetail(priceTableId));
    } catch (err) {
      toast({
        title: 'Failed to load pricing table',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [priceTableId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const actionOptions = useMemo(() => {
    const values = new Set((detail?.rules ?? []).map((rule) => rule.actionType));
    return [...values].sort((a, b) => labelize(a).localeCompare(labelize(b)));
  }, [detail?.rules]);

  const reviewOptions = useMemo(() => {
    const values = new Set((detail?.rules ?? []).map((rule) => rule.reviewStatus));
    return [...values].sort();
  }, [detail?.rules]);

  const filteredRules = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (detail?.rules ?? []).filter((rule) => {
      if (actionFilter !== 'all' && rule.actionType !== actionFilter) return false;
      if (reviewFilter !== 'all' && rule.reviewStatus !== reviewFilter) return false;
      if (needle && !searchableRule(rule).includes(needle)) return false;
      return true;
    });
  }, [actionFilter, detail?.rules, query, reviewFilter]);

  if (loading) {
    return (
      <div className="flex min-h-full w-full items-center justify-center p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading pricing table...
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex min-h-full w-full flex-col gap-4 p-6">
        <Button variant="ghost" className="w-fit gap-2" onClick={() => navigate('/app/pricing/tables')}>
          <ArrowLeft className="h-4 w-4" />
          Pricing Tables
        </Button>
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            This pricing table could not be loaded.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { table, rules } = detail;

  return (
    <div className="flex min-h-full w-full flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/app/pricing/tables')}
            aria-label="Back to Pricing Tables"
            title="Back to Pricing Tables"
            className="h-8 w-8 shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap gap-1.5">
              <Badge variant="outline" className="capitalize">{labelize(table.entityType)}</Badge>
              <Badge variant="secondary" className="capitalize">{labelize(table.archetype)}</Badge>
              {table.documentStatus === 'published' && (
                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700">
                  <ShieldCheck className="mr-1 h-3 w-3" />
                  Published
                </Badge>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{table.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {table.manufacturerName ?? 'No manufacturer'} - {table.priceBookTitle}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => navigate('/app/pricing')}>
          Pricing Home
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Metric label="Rules" value={rules.length} />
        <Metric label="Approved" value={`${table.approvedRuleCount}/${table.ruleCount}`} />
        <Metric label="Effective" value={table.effectiveDate ?? '-'} />
        <Metric label="Basis" value={table.basis ?? '-'} />
        <Metric label="Unit" value={table.unit ?? '-'} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <Database className="mt-1 h-4 w-4 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Rule Data</CardTitle>
              <CardDescription>
                These are the `price_rule` rows and matching conditions used by the pricing engine.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_220px_180px_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search rules, codes, conditions, source text..."
                className="pl-9"
              />
            </div>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {actionOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {labelize(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={reviewFilter} onValueChange={setReviewFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All review states</SelectItem>
                {reviewOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              onClick={() => {
                setQuery('');
                setActionFilter('all');
                setReviewFilter('all');
              }}
              disabled={!query && actionFilter === 'all' && reviewFilter === 'all'}
            >
              Clear
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{filteredRules.length} of {rules.length} rules shown</span>
            <span>{table.ingestionProfileKey ?? table.section ?? ''}</span>
          </div>

          {filteredRules.length === 0 ? (
            <div className="rounded-md border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">
              No rules match the current filters.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Charge</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Conditions</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="whitespace-nowrap">{rule.chargeCategory ?? '-'}</TableCell>
                    <TableCell className="font-mono text-xs">{rule.itemOrOptionCode ?? '-'}</TableCell>
                    <TableCell className="whitespace-nowrap capitalize">{labelize(rule.actionType)}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{ruleValue(rule)}</TableCell>
                    <TableCell className="min-w-80 max-w-xl text-xs text-muted-foreground">
                      {conditionsText(rule)}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={rule.rawValueText ?? ''}>
                      {rule.rawValueText ?? '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={rule.reviewStatus === 'APPROVED' ? 'default' : 'outline'} className="text-[10px]">
                        {rule.reviewStatus}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="truncate text-xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
