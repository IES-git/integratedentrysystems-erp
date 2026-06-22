import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Plus, Save, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
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
  createHardwareSellRule,
  createServiceScope,
  loadPricingDefaults,
  updateHardwareSellRule,
  updateServiceScope,
  type HardwareSellRuleInput,
  type ServiceScopeInput,
} from '@/lib/pricing-defaults-api';
import type {
  HardwareSellRule,
  SellCostBasis,
  ServiceScope,
  ServiceScopeBasis,
  ServiceScopeType,
} from '@/types';

const COST_BASIS_OPTIONS: SellCostBasis[] = ['net', 'list'];
const SERVICE_SCOPE_TYPES: ServiceScopeType[] = [
  'install',
  'labor',
  'wiring',
  'glazing',
  'freight',
  'packaging',
  'tax',
  'commissioning',
  'field_work',
];
const SERVICE_BASIS_OPTIONS: ServiceScopeBasis[] = [
  'per_opening',
  'per_leaf',
  'per_unit',
  'percent_of',
  'flat',
  'per_hour',
];

function labelize(value: string): string {
  return value.replace(/_/g, ' ');
}

function stringFromNumber(value: number | null): string {
  return value == null ? '' : String(value);
}

function parseOptionalNumber(value: string, label: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number.`);
  return parsed;
}

interface SellRuleDraft {
  name: string;
  costBasis: SellCostBasis;
  markupMultiplier: string;
  gmTargetPct: string;
  rounding: string;
  customerClass: string;
  category: string;
  priority: string;
}

interface ServiceScopeDraft {
  scopeType: ServiceScopeType;
  name: string;
  basis: ServiceScopeBasis;
  rate: string;
  percent: string;
  referenceBasis: string;
  notes: string;
}

function sellRuleDraft(rule: HardwareSellRule): SellRuleDraft {
  return {
    name: rule.name,
    costBasis: rule.costBasis,
    markupMultiplier: stringFromNumber(rule.markupMultiplier),
    gmTargetPct: stringFromNumber(rule.gmTargetPct),
    rounding: rule.rounding ?? '',
    customerClass: rule.customerClass ?? '',
    category: rule.category ?? '',
    priority: String(rule.priority),
  };
}

function serviceScopeDraft(scope: ServiceScope): ServiceScopeDraft {
  return {
    scopeType: scope.scopeType,
    name: scope.name,
    basis: scope.basis,
    rate: stringFromNumber(scope.rate),
    percent: stringFromNumber(scope.percent),
    referenceBasis: scope.referenceBasis ?? '',
    notes: scope.notes ?? '',
  };
}

export default function PricingDefaultsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [sellRules, setSellRules] = useState<HardwareSellRule[]>([]);
  const [serviceScopes, setServiceScopes] = useState<ServiceScope[]>([]);
  const [addingSellRule, setAddingSellRule] = useState(false);
  const [addingServiceScope, setAddingServiceScope] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const defaults = await loadPricingDefaults();
      setSellRules(defaults.sellRules);
      setServiceScopes(defaults.serviceScopes);
    } catch (err) {
      toast({
        title: 'Failed to load pricing defaults',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAddSellRule() {
    setAddingSellRule(true);
    try {
      const nextPriority = Math.max(0, ...sellRules.map((rule) => rule.priority)) + 10;
      const created = await createHardwareSellRule({
        name: 'New markup rule',
        costBasis: 'net',
        markupMultiplier: 2,
        gmTargetPct: null,
        priority: nextPriority,
      });
      setSellRules((prev) => [...prev, created].sort((a, b) => a.priority - b.priority));
      toast({ title: 'Markup rule added' });
    } catch (err) {
      toast({
        title: 'Failed to add markup rule',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setAddingSellRule(false);
    }
  }

  async function handleAddServiceScope() {
    setAddingServiceScope(true);
    try {
      const created = await createServiceScope({
        scopeType: 'freight',
        name: 'New service default',
        basis: 'percent_of',
        rate: null,
        percent: 0,
        referenceBasis: 'sell_subtotal',
        notes: null,
      });
      setServiceScopes((prev) => [...prev, created].sort((a, b) => a.scopeType.localeCompare(b.scopeType)));
      toast({ title: 'Service default added' });
    } catch (err) {
      toast({
        title: 'Failed to add service default',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setAddingServiceScope(false);
    }
  }

  async function handleSaveSellRule(id: string, input: HardwareSellRuleInput) {
    const updated = await updateHardwareSellRule(id, input);
    setSellRules((prev) =>
      prev.map((rule) => (rule.id === id ? updated : rule)).sort((a, b) => a.priority - b.priority),
    );
  }

  async function handleSaveServiceScope(id: string, input: ServiceScopeInput) {
    const updated = await updateServiceScope(id, input);
    setServiceScopes((prev) =>
      prev.map((scope) => (scope.id === id ? updated : scope)).sort((a, b) => a.scopeType.localeCompare(b.scopeType)),
    );
  }

  return (
    <div className="flex min-h-full w-full flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/app/pricing')}
            className="h-8 w-8 shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">Pricing Defaults</h1>
              <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                Admin
              </Badge>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Manage default markup rules plus services, freight, and tax scopes.
            </p>
          </div>
        </div>
        <SlidersHorizontal className="hidden h-5 w-5 text-muted-foreground lg:block" />
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border bg-card">
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold">Markup Rules</h2>
                <p className="text-sm text-muted-foreground">
                  Rules are evaluated by priority. Use markup multiplier or target gross margin as needed.
                </p>
              </div>
              <Button size="sm" onClick={handleAddSellRule} disabled={addingSellRule} className="gap-1.5">
                {addingSellRule ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add Rule
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-48">Name</TableHead>
                  <TableHead className="w-28">Basis</TableHead>
                  <TableHead className="w-32">Multiplier</TableHead>
                  <TableHead className="w-32">GM Target %</TableHead>
                  <TableHead className="w-36">Rounding</TableHead>
                  <TableHead className="w-36">Customer Class</TableHead>
                  <TableHead className="w-36">Category</TableHead>
                  <TableHead className="w-24">Priority</TableHead>
                  <TableHead className="w-20 text-right">Save</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sellRules.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-20 text-center text-muted-foreground">
                      No markup rules yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  sellRules.map((rule) => (
                    <SellRuleRow key={rule.id} rule={rule} onSave={handleSaveSellRule} />
                  ))
                )}
              </TableBody>
            </Table>
          </section>

          <section className="rounded-lg border bg-card">
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold">Services, Freight, and Tax</h2>
                <p className="text-sm text-muted-foreground">
                  Configure service scopes used for default add-ons and percentage-based charges.
                </p>
              </div>
              <Button size="sm" onClick={handleAddServiceScope} disabled={addingServiceScope} className="gap-1.5">
                {addingServiceScope ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add Scope
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Type</TableHead>
                  <TableHead className="min-w-48">Name</TableHead>
                  <TableHead className="w-40">Basis</TableHead>
                  <TableHead className="w-28">Rate</TableHead>
                  <TableHead className="w-28">Percent</TableHead>
                  <TableHead className="w-44">Reference</TableHead>
                  <TableHead className="min-w-48">Notes</TableHead>
                  <TableHead className="w-20 text-right">Save</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {serviceScopes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-20 text-center text-muted-foreground">
                      No service defaults yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  serviceScopes.map((scope) => (
                    <ServiceScopeRow key={scope.id} scope={scope} onSave={handleSaveServiceScope} />
                  ))
                )}
              </TableBody>
            </Table>
          </section>
        </div>
      )}
    </div>
  );
}

function SellRuleRow({
  rule,
  onSave,
}: {
  rule: HardwareSellRule;
  onSave: (id: string, input: HardwareSellRuleInput) => Promise<void>;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<SellRuleDraft>(() => sellRuleDraft(rule));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(sellRuleDraft(rule));
  }, [rule]);

  async function handleSave() {
    setSaving(true);
    try {
      const input: HardwareSellRuleInput = {
        name: draft.name.trim() || rule.name,
        costBasis: draft.costBasis,
        markupMultiplier: parseOptionalNumber(draft.markupMultiplier, 'Multiplier'),
        gmTargetPct: parseOptionalNumber(draft.gmTargetPct, 'GM target'),
        rounding: draft.rounding.trim() || null,
        customerClass: draft.customerClass.trim() || null,
        category: draft.category.trim() || null,
        priority: parseOptionalNumber(draft.priority, 'Priority') ?? rule.priority,
      };
      await onSave(rule.id, input);
      toast({ title: 'Markup rule saved' });
    } catch (err) {
      toast({
        title: 'Failed to save markup rule',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow>
      <TableCell>
        <Label className="sr-only" htmlFor={`sell-name-${rule.id}`}>Name</Label>
        <Input
          id={`sell-name-${rule.id}`}
          value={draft.name}
          onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
          className="h-8"
        />
      </TableCell>
      <TableCell>
        <Select
          value={draft.costBasis}
          onValueChange={(value) => setDraft((prev) => ({ ...prev, costBasis: value as SellCostBasis }))}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COST_BASIS_OPTIONS.map((basis) => (
              <SelectItem key={basis} value={basis}>
                {basis}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          value={draft.markupMultiplier}
          onChange={(event) => setDraft((prev) => ({ ...prev, markupMultiplier: event.target.value }))}
          className="h-8"
          inputMode="decimal"
        />
      </TableCell>
      <TableCell>
        <Input
          value={draft.gmTargetPct}
          onChange={(event) => setDraft((prev) => ({ ...prev, gmTargetPct: event.target.value }))}
          className="h-8"
          inputMode="decimal"
        />
      </TableCell>
      <TableCell>
        <Input
          value={draft.rounding}
          onChange={(event) => setDraft((prev) => ({ ...prev, rounding: event.target.value }))}
          className="h-8"
          placeholder="nearest"
        />
      </TableCell>
      <TableCell>
        <Input
          value={draft.customerClass}
          onChange={(event) => setDraft((prev) => ({ ...prev, customerClass: event.target.value }))}
          className="h-8"
          placeholder="default"
        />
      </TableCell>
      <TableCell>
        <Input
          value={draft.category}
          onChange={(event) => setDraft((prev) => ({ ...prev, category: event.target.value }))}
          className="h-8"
          placeholder="hardware"
        />
      </TableCell>
      <TableCell>
        <Input
          value={draft.priority}
          onChange={(event) => setDraft((prev) => ({ ...prev, priority: event.target.value }))}
          className="h-8"
          inputMode="numeric"
        />
      </TableCell>
      <TableCell className="text-right">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function ServiceScopeRow({
  scope,
  onSave,
}: {
  scope: ServiceScope;
  onSave: (id: string, input: ServiceScopeInput) => Promise<void>;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<ServiceScopeDraft>(() => serviceScopeDraft(scope));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(serviceScopeDraft(scope));
  }, [scope]);

  async function handleSave() {
    setSaving(true);
    try {
      const input: ServiceScopeInput = {
        scopeType: draft.scopeType,
        name: draft.name.trim() || scope.name,
        basis: draft.basis,
        rate: parseOptionalNumber(draft.rate, 'Rate'),
        percent: parseOptionalNumber(draft.percent, 'Percent'),
        referenceBasis: draft.referenceBasis.trim() || null,
        notes: draft.notes.trim() || null,
      };
      await onSave(scope.id, input);
      toast({ title: 'Service default saved' });
    } catch (err) {
      toast({
        title: 'Failed to save service default',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow>
      <TableCell>
        <Select
          value={draft.scopeType}
          onValueChange={(value) => setDraft((prev) => ({ ...prev, scopeType: value as ServiceScopeType }))}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SERVICE_SCOPE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {labelize(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          value={draft.name}
          onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
          className="h-8"
        />
      </TableCell>
      <TableCell>
        <Select
          value={draft.basis}
          onValueChange={(value) => setDraft((prev) => ({ ...prev, basis: value as ServiceScopeBasis }))}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SERVICE_BASIS_OPTIONS.map((basis) => (
              <SelectItem key={basis} value={basis}>
                {labelize(basis)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          value={draft.rate}
          onChange={(event) => setDraft((prev) => ({ ...prev, rate: event.target.value }))}
          className="h-8"
          inputMode="decimal"
        />
      </TableCell>
      <TableCell>
        <Input
          value={draft.percent}
          onChange={(event) => setDraft((prev) => ({ ...prev, percent: event.target.value }))}
          className="h-8"
          inputMode="decimal"
        />
      </TableCell>
      <TableCell>
        <Input
          value={draft.referenceBasis}
          onChange={(event) => setDraft((prev) => ({ ...prev, referenceBasis: event.target.value }))}
          className="h-8"
          placeholder="sell_subtotal"
        />
      </TableCell>
      <TableCell>
        <Input
          value={draft.notes}
          onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
          className="h-8"
        />
      </TableCell>
      <TableCell className="text-right">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </Button>
      </TableCell>
    </TableRow>
  );
}
