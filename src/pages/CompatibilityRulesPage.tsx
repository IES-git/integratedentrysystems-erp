/**
 * Admin page to manage compatibility / configuration rules (CPQ Phase 3).
 * Rules validate that a configured opening is buildable before pricing/quoting.
 */

import { useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, ShieldCheck, Pencil } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  listCompatibilityRules, createCompatibilityRule, updateCompatibilityRule, deleteCompatibilityRule,
} from '@/lib/compatibility-rules-api';
import type {
  CompatibilityRule, CompatibilityOperator, CompatibilityScopeType, CompatibilitySeverity,
} from '@/types';

const OPERATORS: CompatibilityOperator[] = ['equals', 'not_equals', 'in', 'not_in', 'gt', 'lt', 'gte', 'lte', 'between'];

interface FormState {
  id: string | null;
  name: string;
  scopeType: CompatibilityScopeType;
  scopeValue: string;
  severity: CompatibilitySeverity;
  message: string;
  active: boolean;
  hasWhen: boolean;
  whenField: string;
  whenOp: CompatibilityOperator;
  whenValues: string;
  reqField: string;
  reqOp: CompatibilityOperator;
  reqValues: string;
}

const EMPTY_FORM: FormState = {
  id: null, name: '', scopeType: 'item_type', scopeValue: '', severity: 'error', message: '', active: true,
  hasWhen: false, whenField: '', whenOp: 'equals', whenValues: '',
  reqField: '', reqOp: 'equals', reqValues: '',
};

function splitValues(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

export default function CompatibilityRulesPage() {
  const { toast } = useToast();
  const [rules, setRules] = useState<CompatibilityRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setRules(await listCompatibilityRules());
    } catch (err) {
      toast({ title: 'Failed to load rules', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setForm(EMPTY_FORM); setShowForm(true); };

  const openEdit = (r: CompatibilityRule) => {
    setForm({
      id: r.id,
      name: r.name,
      scopeType: r.scopeType,
      scopeValue: r.scopeValue,
      severity: r.severity,
      message: r.message,
      active: r.active,
      hasWhen: !!r.predicate.when,
      whenField: r.predicate.when?.fieldKey ?? '',
      whenOp: r.predicate.when?.operator ?? 'equals',
      whenValues: (r.predicate.when?.values ?? []).join(', '),
      reqField: r.predicate.require?.fieldKey ?? '',
      reqOp: r.predicate.require?.operator ?? 'equals',
      reqValues: (r.predicate.require?.values ?? []).join(', '),
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.scopeValue.trim() || !form.reqField.trim() || !form.message.trim()) {
      toast({ title: 'Missing fields', description: 'Name, scope, require field, and message are required.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const input = {
        name: form.name.trim(),
        scopeType: form.scopeType,
        scopeValue: form.scopeValue.trim(),
        severity: form.severity,
        message: form.message.trim(),
        active: form.active,
        predicate: {
          when: form.hasWhen
            ? { fieldKey: form.whenField.trim(), operator: form.whenOp, values: splitValues(form.whenValues) }
            : null,
          require: { fieldKey: form.reqField.trim(), operator: form.reqOp, values: splitValues(form.reqValues) },
        },
      };
      if (form.id) await updateCompatibilityRule(form.id, input);
      else await createCompatibilityRule(input);
      toast({ title: form.id ? 'Rule updated' : 'Rule created' });
      setShowForm(false);
      await load();
    } catch (err) {
      toast({ title: 'Save failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (r: CompatibilityRule) => {
    try {
      await updateCompatibilityRule(r.id, { active: !r.active });
      await load();
    } catch (err) {
      toast({ title: 'Update failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  const handleDelete = async (r: CompatibilityRule) => {
    if (!confirm(`Delete rule "${r.name}"?`)) return;
    try {
      await deleteCompatibilityRule(r.id);
      await load();
    } catch (err) {
      toast({ title: 'Delete failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><ShieldCheck className="h-6 w-6" /> Compatibility Rules</h1>
          <p className="text-sm text-muted-foreground">
            Validate that a configured opening is buildable. Rules check field values across the opening (e.g. door gauge vs frame gauge). Errors block saving; warnings inform.
          </p>
        </div>
        {!showForm && <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Add rule</Button>}
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{form.id ? 'Edit rule' : 'New rule'}</CardTitle>
            <CardDescription>When the optional condition holds for an in-scope item, the required condition must also hold across the opening.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Fire door requires fire-rated frame" />
              </div>
              <div className="space-y-1">
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v as CompatibilitySeverity })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="error">Error (blocks)</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Scope type</Label>
                <Select value={form.scopeType} onValueChange={(v) => setForm({ ...form, scopeType: v as CompatibilityScopeType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="item_type">Item type (slug)</SelectItem>
                    <SelectItem value="canonical_code">Canonical code</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Scope value</Label>
                <Input value={form.scopeValue} onChange={(e) => setForm({ ...form, scopeValue: e.target.value })} placeholder="doors" />
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Switch checked={form.hasWhen} onCheckedChange={(v) => setForm({ ...form, hasWhen: v })} />
                <Label className="cursor-pointer">Only apply WHEN a condition holds</Label>
              </div>
              {form.hasWhen && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input placeholder="field key (e.g. fire_rating)" value={form.whenField} onChange={(e) => setForm({ ...form, whenField: e.target.value })} />
                  <Select value={form.whenOp} onValueChange={(v) => setForm({ ...form, whenOp: v as CompatibilityOperator })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input placeholder="values (comma-separated)" value={form.whenValues} onChange={(e) => setForm({ ...form, whenValues: e.target.value })} />
                </div>
              )}
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <Label>REQUIRE (must hold, else violation)</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                <Input placeholder="field key (e.g. frame_rating)" value={form.reqField} onChange={(e) => setForm({ ...form, reqField: e.target.value })} />
                <Select value={form.reqOp} onValueChange={(v) => setForm({ ...form, reqOp: v as CompatibilityOperator })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="values (comma-separated)" value={form.reqValues} onChange={(e) => setForm({ ...form, reqValues: e.target.value })} />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Violation message</Label>
              <Input value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Fire-rated doors require a fire-rated frame." />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {form.id ? 'Save changes' : 'Create rule'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Rules</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No compatibility rules yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Scope</TableHead><TableHead>Severity</TableHead><TableHead>Active</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.message}</div>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{r.scopeType === 'item_type' ? r.scopeValue : `code:${r.scopeValue}`}</TableCell>
                    <TableCell>
                      <Badge variant={r.severity === 'error' ? 'destructive' : 'secondary'}>{r.severity}</Badge>
                    </TableCell>
                    <TableCell><Switch checked={r.active} onCheckedChange={() => handleToggle(r)} /></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => handleDelete(r)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
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
