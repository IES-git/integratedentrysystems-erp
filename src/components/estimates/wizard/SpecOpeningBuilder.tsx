/**
 * Unified spec-driven opening builder (Phase 4).
 *
 * Replaces the two legacy builders (BuildOpeningDialog + NewOpeningPage) with a
 * single configurator driven by the `opening_spec_field` dictionary. Step flow:
 *   Classify → Door(s) → Frame → Panel(s) → Lites/Louvers/Glass →
 *   Preparations → Hardware → Keying → Access Control → Review.
 *
 * Hardware starts from a hardware-set template (auto-populated categories +
 * quantities by opening type); variants are filtered by function/finish/size/
 * rating/hand; each selection auto-adds its Pioneer door/frame preps via the
 * crosswalk. Live pricing + dependency validation run through the Phase 3 engine.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, AlertCircle, DoorOpen, Square, LayoutPanelLeft, GlassWater,
  Wrench, KeyRound, ShieldCheck, ClipboardList, Plus, Trash2, CheckCircle2, Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SpecFieldInput } from './SpecFieldInput';
import { AuditableQuote } from './AuditableQuote';
import { buildAuditableQuoteFromEngine } from '@/lib/cpq/auditable-quote';
import { validateQuoteCompleteness, type CompletenessIssue } from '@/lib/cpq/completeness';
import {
  loadSpecFieldDictionary, loadProductFamilies, type SpecFieldWithPath, type VariantOption, loadVariantsForCategory,
} from '@/lib/cpq-catalog-api';
import {
  loadHardwareCatalog, generateHardwareRequirements, derivePrepRequirements,
  type HardwareCatalog, type PrepRequirement,
} from '@/lib/pricing';
import { priceOpeningLive } from '@/lib/cpq/live-pricing';
import { buildNormalizedSpec, createOpeningDraft, type OpeningDraft, type ComponentDraft, type HardwareSelectionDraft } from '@/lib/cpq/opening-spec';
import { saveOpeningDraft } from '@/lib/cpq/opening-persist';
import type { EngineResult } from '@/lib/pricing';
import type {
  OpeningConfigurationType, ProductFamily, RuleEntityType, SpecFieldEntity, SpecFieldMapping, EstimateOpening,
} from '@/types';

type StepId = 'classify' | 'doors' | 'frame' | 'panels' | 'lites' | 'preps' | 'hardware' | 'keying' | 'access' | 'review';

const STEPS: { id: StepId; label: string; icon: typeof DoorOpen }[] = [
  { id: 'classify', label: 'Classify', icon: ClipboardList },
  { id: 'doors', label: 'Doors', icon: DoorOpen },
  { id: 'frame', label: 'Frame', icon: Square },
  { id: 'panels', label: 'Panels', icon: LayoutPanelLeft },
  { id: 'lites', label: 'Lites/Glass', icon: GlassWater },
  { id: 'preps', label: 'Preparations', icon: Layers },
  { id: 'hardware', label: 'Hardware', icon: Wrench },
  { id: 'keying', label: 'Keying', icon: KeyRound },
  { id: 'access', label: 'Access Control', icon: ShieldCheck },
  { id: 'review', label: 'Review', icon: CheckCircle2 },
];

const CONFIG_OPTIONS: { value: OpeningConfigurationType; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'pair', label: 'Pair' },
  { value: 'double_egress', label: 'Double egress' },
  { value: 'communicating', label: 'Communicating' },
  { value: 'dutch', label: 'Dutch' },
  { value: 'borrowed_lite', label: 'Borrowed lite' },
  { value: 'sidelite_transom', label: 'Sidelite / transom' },
  { value: 'storefront', label: 'Storefront' },
  { value: 'specialty', label: 'Specialty assembly' },
];

let localSeq = 0;
const nextId = () => `c${Date.now()}_${localSeq++}`;

function newComponent(entityType: RuleEntityType, label: string): ComponentDraft {
  return { id: nextId(), entityType, label, familyCode: null, quantity: 1, fields: {} };
}

interface SpecOpeningBuilderProps {
  estimateId: string | null;
  resolveEstimateId?: () => Promise<string | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (opening: EstimateOpening) => void;
  openingCount?: number;
  editingOpeningId?: string | null;
  editingName?: string;
  editingQuantity?: number;
}

export function SpecOpeningBuilder({
  estimateId, resolveEstimateId, open, onOpenChange, onSaved,
  openingCount = 0, editingOpeningId, editingName, editingQuantity,
}: SpecOpeningBuilderProps) {
  const [step, setStep] = useState<StepId>('classify');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<OpeningDraft>(() => createOpeningDraft());
  const [specByEntity, setSpecByEntity] = useState<Map<SpecFieldEntity, SpecFieldWithPath[]>>(new Map());
  const [mappings, setMappings] = useState<SpecFieldMapping[]>([]);
  const [familiesByEntity, setFamiliesByEntity] = useState<Map<string, ProductFamily[]>>(new Map());
  const [hwCatalog, setHwCatalog] = useState<HardwareCatalog | null>(null);
  const [variantsByCategory, setVariantsByCategory] = useState<Record<string, VariantOption[]>>({});
  const [engineResult, setEngineResult] = useState<EngineResult | null>(null);
  const [pricing, setPricing] = useState(false);

  // Load the dictionary-driven catalog when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setStep('classify');
    setError(null);
    setEngineResult(null);
    setDraft(createOpeningDraft({
      name: editingName ?? `Opening ${openingCount + 1}`,
      quantity: editingQuantity ?? 1,
      doors: [newComponent('door', 'Door')],
    }));
    setLoading(true);
    Promise.all([loadSpecFieldDictionary(), loadProductFamilies(), loadHardwareCatalog(new Date().toISOString().slice(0, 10))])
      .then(([dict, fams, cat]) => {
        setSpecByEntity(dict.byEntity);
        setMappings(dict.mappings);
        setFamiliesByEntity(fams);
        setHwCatalog(cat);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load catalog'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-generate the hardware set whenever the opening config changes.
  useEffect(() => {
    if (!hwCatalog || !open) return;
    const spec = buildNormalizedSpec(draft, mappings);
    const { requirements } = generateHardwareRequirements(spec, hwCatalog);
    setDraft((prev) => {
      // Merge generated categories with existing selections (keep chosen variants).
      const existing = new Map(prev.hardware.map((h) => [h.category, h]));
      const merged: HardwareSelectionDraft[] = requirements.map((r) => {
        const cur = existing.get(r.category);
        return {
          category: r.category,
          variantId: cur?.variantId ?? null,
          quantity: cur?.variantId ? cur.quantity : r.quantity,
          required: r.required,
          selectedFunction: cur?.selectedFunction ?? null,
          selectedFinish: cur?.selectedFinish ?? null,
          selectedSize: cur?.selectedSize ?? null,
          selectedHand: cur?.selectedHand ?? null,
          selectedRating: cur?.selectedRating ?? null,
          source: r.source,
        };
      });
      // Preserve any purely-manual categories not in the template.
      for (const h of prev.hardware) {
        if (!requirements.some((r) => r.category === h.category)) merged.push(h);
      }
      return { ...prev, hardware: merged };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.configurationType, draft.leafCount, draft.fireLabelRequired, draft.accessControl, hwCatalog, open]);

  // Lazy-load variants when entering the hardware step.
  useEffect(() => {
    if (step !== 'hardware') return;
    const missing = draft.hardware.map((h) => h.category).filter((c) => !(c in variantsByCategory));
    if (missing.length === 0) return;
    Promise.all(missing.map(async (c) => [c, await loadVariantsForCategory(c)] as const))
      .then((entries) => setVariantsByCategory((prev) => ({ ...prev, ...Object.fromEntries(entries) })))
      .catch(() => { /* non-fatal — variant lists just stay empty */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, draft.hardware]);

  const spec = useMemo(() => buildNormalizedSpec(draft, mappings), [draft, mappings]);

  const prepRequirements: PrepRequirement[] = useMemo(() => {
    if (!hwCatalog) return [];
    return derivePrepRequirements(spec.hardware, hwCatalog).prepRequirements;
  }, [spec.hardware, hwCatalog]);

  // ---- draft mutation helpers ----
  const patch = (p: Partial<OpeningDraft>) => setDraft((prev) => ({ ...prev, ...p }));

  const setOpeningField = (path: string, value: string) =>
    setDraft((prev) => ({ ...prev, openingFields: { ...prev.openingFields, [path]: value } }));

  const componentListKey = (entity: RuleEntityType): keyof OpeningDraft =>
    entity === 'door' ? 'doors' : entity === 'frame' ? 'frames' : entity === 'panel' ? 'panels' : 'lites';

  const addComponent = (entity: RuleEntityType, label: string) =>
    setDraft((prev) => {
      const key = componentListKey(entity);
      const list = prev[key] as ComponentDraft[];
      return { ...prev, [key]: [...list, newComponent(entity, `${label} ${list.length + 1}`)] };
    });

  const removeComponent = (entity: RuleEntityType, id: string) =>
    setDraft((prev) => {
      const key = componentListKey(entity);
      return { ...prev, [key]: (prev[key] as ComponentDraft[]).filter((c) => c.id !== id) };
    });

  const updateComponentField = (entity: RuleEntityType, id: string, path: string, value: string) =>
    setDraft((prev) => {
      const key = componentListKey(entity);
      return {
        ...prev,
        [key]: (prev[key] as ComponentDraft[]).map((c) =>
          c.id === id ? { ...c, fields: { ...c.fields, [path]: value } } : c),
      };
    });

  const updateComponentMeta = (entity: RuleEntityType, id: string, p: Partial<ComponentDraft>) =>
    setDraft((prev) => {
      const key = componentListKey(entity);
      return { ...prev, [key]: (prev[key] as ComponentDraft[]).map((c) => (c.id === id ? { ...c, ...p } : c)) };
    });

  const updateHardware = (category: string, p: Partial<HardwareSelectionDraft>) =>
    setDraft((prev) => ({ ...prev, hardware: prev.hardware.map((h) => (h.category === category ? { ...h, ...p } : h)) }));

  // ---- live pricing ----
  const runPricing = async () => {
    setPricing(true);
    try {
      const result = await priceOpeningLive(buildNormalizedSpec(draft, mappings));
      setEngineResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pricing failed');
    } finally {
      setPricing(false);
    }
  };

  useEffect(() => {
    if (step === 'review' && open) void runPricing();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ---- save ----
  const handleSave = async () => {
    if (!draft.name.trim()) { setError('Opening name is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      const eid = estimateId ?? (resolveEstimateId ? await resolveEstimateId() : null);
      if (!eid) { setError('Unable to create estimate.'); return; }
      const { opening } = await saveOpeningDraft(eid, draft, mappings, { priceBookDocumentId: null }, editingOpeningId);
      onSaved(opening);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save opening');
    } finally {
      setSaving(false);
    }
  };

  const blockingDeps = engineResult?.dependencyResults.filter((d) => d.blocking) ?? [];
  const canSave = draft.name.trim().length > 0 && blockingDeps.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[92vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="font-display text-2xl">
            {editingOpeningId ? 'Edit Opening' : 'Build Opening'}
          </DialogTitle>
          <DialogDescription>
            Spec-driven configurator — classify the opening, then walk door → frame → panel → lites → preps → hardware.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* Step rail */}
          <nav className="w-44 shrink-0 border-r bg-muted/20 py-3 overflow-y-auto">
            {STEPS.map((s) => {
              const Icon = s.icon;
              const active = step === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setStep(s.id)}
                  className={cn(
                    'flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors',
                    active ? 'bg-background font-medium text-foreground border-l-2 border-primary' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {s.label}
                </button>
              );
            })}
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0 overflow-y-auto px-6 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <StepContent
                step={step}
                draft={draft}
                specByEntity={specByEntity}
                familiesByEntity={familiesByEntity}
                variantsByCategory={variantsByCategory}
                prepRequirements={prepRequirements}
                engineResult={engineResult}
                pricing={pricing}
                onPatch={patch}
                onSetOpeningField={setOpeningField}
                onAddComponent={addComponent}
                onRemoveComponent={removeComponent}
                onUpdateComponentField={updateComponentField}
                onUpdateComponentMeta={updateComponentMeta}
                onUpdateHardware={updateHardware}
                onRunPricing={runPricing}
              />
            )}
          </div>
        </div>

        {error && (
          <p className="px-6 text-sm text-destructive flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        <DialogFooter className="px-6 py-3 border-t">
          <div className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
            {engineResult && (
              <span>
                Sell <strong className="text-foreground">${engineResult.totals.sellTotal.toFixed(2)}</strong>
                {engineResult.totals.exceptionCount > 0 && (
                  <Badge variant="destructive" className="ml-2">{engineResult.totals.exceptionCount} exceptions</Badge>
                )}
              </span>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editingOpeningId ? 'Update Opening' : 'Save Opening'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Step content
// ===========================================================================

interface StepContentProps {
  step: StepId;
  draft: OpeningDraft;
  specByEntity: Map<SpecFieldEntity, SpecFieldWithPath[]>;
  familiesByEntity: Map<string, ProductFamily[]>;
  variantsByCategory: Record<string, VariantOption[]>;
  prepRequirements: PrepRequirement[];
  engineResult: EngineResult | null;
  pricing: boolean;
  onPatch: (p: Partial<OpeningDraft>) => void;
  onSetOpeningField: (path: string, value: string) => void;
  onAddComponent: (entity: RuleEntityType, label: string) => void;
  onRemoveComponent: (entity: RuleEntityType, id: string) => void;
  onUpdateComponentField: (entity: RuleEntityType, id: string, path: string, value: string) => void;
  onUpdateComponentMeta: (entity: RuleEntityType, id: string, p: Partial<ComponentDraft>) => void;
  onUpdateHardware: (category: string, p: Partial<HardwareSelectionDraft>) => void;
  onRunPricing: () => void;
}

function fieldsFor(map: Map<SpecFieldEntity, SpecFieldWithPath[]>, entity: SpecFieldEntity, category?: string): SpecFieldWithPath[] {
  const all = map.get(entity) ?? [];
  return category ? all.filter((f) => f.category === category) : all;
}

function StepContent(props: StepContentProps) {
  const { step } = props;
  switch (step) {
    case 'classify': return <ClassifyStep {...props} />;
    case 'doors': return <ComponentStep {...props} entity="door" specEntity="door" title="Doors" />;
    case 'frame': return <ComponentStep {...props} entity="frame" specEntity="frame" title="Frame" />;
    case 'panels': return <ComponentStep {...props} entity="panel" specEntity="panel" title="Panels" />;
    case 'lites': return <ComponentStep {...props} entity="specialty" specEntity="door" title="Lites / Louvers / Glass" liteMode />;
    case 'preps': return <PrepsStep {...props} />;
    case 'hardware': return <HardwareStep {...props} />;
    case 'keying': return <KeyingStep {...props} />;
    case 'access': return <AccessStep {...props} />;
    case 'review': return <ReviewStep {...props} />;
    default: {
      const _exhaustive: never = step;
      return null;
    }
  }
}

function ClassifyStep({ draft, specByEntity, onPatch, onSetOpeningField }: StepContentProps) {
  const perfFields = fieldsFor(specByEntity, 'opening').filter(
    (f) => f.category !== 'Configuration' && f.fieldId !== 'OPN-013',
  );
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Opening name *</Label>
          <Input value={draft.name} onChange={(e) => onPatch({ name: e.target.value })} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Quantity of identical openings</Label>
          <Input type="number" min={1} value={draft.quantity}
            onChange={(e) => onPatch({ quantity: parseInt(e.target.value) || 1 })} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Opening configuration *</Label>
          <Select value={draft.configurationType} onValueChange={(v) => onPatch({ configurationType: v as OpeningConfigurationType })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONFIG_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value} className="text-sm">{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Leaf count</Label>
          <Input type="number" min={1} value={draft.leafCount}
            onChange={(e) => onPatch({ leafCount: parseInt(e.target.value) || 1 })} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Nominal opening width</Label>
          <Input value={draft.openingWidth} onChange={(e) => onPatch({ openingWidth: e.target.value })}
            placeholder="e.g. 3-0" className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Nominal opening height</Label>
          <Input value={draft.openingHeight} onChange={(e) => onPatch({ openingHeight: e.target.value })}
            placeholder="e.g. 7-0" className="h-8 text-sm" />
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-md border p-3">
        <Switch checked={draft.fireLabelRequired} onCheckedChange={(v) => onPatch({ fireLabelRequired: v })} />
        <Label className="text-sm">Fire label required</Label>
      </div>

      {perfFields.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Performance &amp; logistics</p>
          <div className="grid grid-cols-2 gap-3">
            {perfFields.map((f) => (
              <SpecFieldInput key={f.id} field={f}
                value={f.fieldPath ? draft.openingFields[f.fieldPath] ?? '' : ''}
                onChange={onSetOpeningField} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ComponentStepProps extends StepContentProps {
  entity: RuleEntityType;
  specEntity: SpecFieldEntity;
  title: string;
  liteMode?: boolean;
}

function ComponentStep(props: ComponentStepProps) {
  const { draft, specByEntity, familiesByEntity, entity, specEntity, title, onAddComponent, onRemoveComponent, onUpdateComponentField, onUpdateComponentMeta } = props;
  const key = entity === 'door' ? 'doors' : entity === 'frame' ? 'frames' : entity === 'panel' ? 'panels' : 'lites';
  const components = draft[key] as ComponentDraft[];
  const fields = fieldsFor(specByEntity, specEntity);
  const families = familiesByEntity.get(entity === 'specialty' ? 'door' : entity) ?? [];
  const categories = [...new Set(fields.map((f) => f.category).filter(Boolean))] as string[];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button size="sm" variant="outline" onClick={() => onAddComponent(entity, title)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>

      {components.length === 0 && (
        <p className="text-sm text-muted-foreground italic">None added.</p>
      )}

      {components.map((comp) => (
        <div key={comp.id} className="rounded-lg border p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Input value={comp.label} onChange={(e) => onUpdateComponentMeta(entity, comp.id, { label: e.target.value })}
              className="h-8 text-sm font-medium max-w-[200px]" />
            {families.length > 0 && (
              <Select value={comp.familyCode ?? ''} onValueChange={(v) => onUpdateComponentMeta(entity, comp.id, { familyCode: v })}>
                <SelectTrigger className="h-8 text-sm max-w-[180px]"><SelectValue placeholder="Series…" /></SelectTrigger>
                <SelectContent>
                  {families.map((fam) => (
                    <SelectItem key={fam.id} value={fam.familyCode} className="text-sm">{fam.familyCode}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-[10px] text-muted-foreground">Qty</span>
              <Input type="number" min={1} value={comp.quantity}
                onChange={(e) => onUpdateComponentMeta(entity, comp.id, { quantity: parseInt(e.target.value) || 1 })}
                className="h-7 w-14 text-xs px-1.5" />
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => onRemoveComponent(entity, comp.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          {categories.map((cat) => (
            <div key={cat} className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{cat}</p>
              <div className="grid grid-cols-2 gap-2.5">
                {fields.filter((f) => f.category === cat).map((f) => (
                  <SpecFieldInput key={f.id} field={f}
                    value={f.fieldPath ? comp.fields[f.fieldPath] ?? '' : ''}
                    onChange={(path, value) => onUpdateComponentField(entity, comp.id, path, value)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function PrepsStep({ prepRequirements }: StepContentProps) {
  const doorPreps = prepRequirements.filter((p) => p.entityType === 'door');
  const framePreps = prepRequirements.filter((p) => p.entityType === 'frame');
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-800/40 dark:bg-amber-900/10 p-3 text-xs text-amber-800 dark:text-amber-300">
        Preparations are auto-derived from your hardware selections via the Pioneer prep crosswalk and stay in sync as devices change.
      </div>
      {prepRequirements.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No preps yet — select hardware to auto-generate door/frame preps.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <PrepColumn title="Door preps" preps={doorPreps} />
          <PrepColumn title="Frame preps" preps={framePreps} />
        </div>
      )}
    </div>
  );
}

function PrepColumn({ title, preps }: { title: string; preps: PrepRequirement[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {preps.length === 0 && <p className="text-xs text-muted-foreground italic">None.</p>}
      {preps.map((p, i) => (
        <div key={i} className="rounded-md border p-2 text-xs">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">{p.prepCode}</Badge>
            <span className="text-muted-foreground">×{p.quantity}</span>
          </div>
          <p className="mt-1 text-muted-foreground">{p.source}{p.templateId ? ` · template ${p.templateId}` : ''}</p>
        </div>
      ))}
    </div>
  );
}

function HardwareStep({ draft, variantsByCategory, onUpdateHardware }: StepContentProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Hardware set</h3>
      {draft.hardware.length === 0 && (
        <p className="text-sm text-muted-foreground italic">No hardware set matched this opening configuration.</p>
      )}
      {draft.hardware.map((h) => {
        const variants = variantsByCategory[h.category] ?? [];
        const filtered = variants.filter((v) =>
          (!h.selectedFunction || (v.variant.function ?? '') === h.selectedFunction) &&
          (!h.selectedFinish || (v.variant.finish ?? '') === h.selectedFinish) &&
          (!h.selectedSize || (v.variant.size ?? '') === h.selectedSize) &&
          (!h.selectedHand || (v.variant.hand ?? '') === h.selectedHand) &&
          (!h.selectedRating || (v.variant.rating ?? '') === h.selectedRating));
        const uniq = (sel: (v: VariantOption) => string | null) =>
          [...new Set(variants.map(sel).filter((x): x is string => !!x))];
        return (
          <div key={h.category} className="rounded-lg border p-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium capitalize">{h.category.replace(/_/g, ' ')}</span>
              {h.required && <Badge variant="secondary" className="text-[10px]">required</Badge>}
              <Badge variant="outline" className="text-[10px]">{h.source === 'set_template' ? 'auto' : 'manual'}</Badge>
              <div className="flex items-center gap-1 ml-auto">
                <span className="text-[10px] text-muted-foreground">Qty</span>
                <Input type="number" min={0} value={h.quantity}
                  onChange={(e) => onUpdateHardware(h.category, { quantity: parseInt(e.target.value) || 0 })}
                  className="h-7 w-14 text-xs px-1.5" />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <FilterSelect label="Function" value={h.selectedFunction ?? ''} options={uniq((v) => v.variant.function)}
                onChange={(v) => onUpdateHardware(h.category, { selectedFunction: v || null })} />
              <FilterSelect label="Finish" value={h.selectedFinish ?? ''} options={uniq((v) => v.variant.finish)}
                onChange={(v) => onUpdateHardware(h.category, { selectedFinish: v || null })} />
              <FilterSelect label="Size" value={h.selectedSize ?? ''} options={uniq((v) => v.variant.size)}
                onChange={(v) => onUpdateHardware(h.category, { selectedSize: v || null })} />
              <FilterSelect label="Rating" value={h.selectedRating ?? ''} options={uniq((v) => v.variant.rating)}
                onChange={(v) => onUpdateHardware(h.category, { selectedRating: v || null })} />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Variant</Label>
              <Select value={h.variantId ?? ''} onValueChange={(v) => onUpdateHardware(h.category, { variantId: v, source: 'manual' })}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder={filtered.length ? 'Select a variant…' : 'No catalog variants — route to manual quote'} />
                </SelectTrigger>
                <SelectContent>
                  {filtered.map((v) => (
                    <SelectItem key={v.variant.id} value={v.variant.id} className="text-sm">
                      {v.variant.sku ?? v.productDescription ?? v.variant.id}
                      {v.price?.netCost != null ? ` — net $${v.price.netCost.toFixed(2)}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Select value={value || '__any'} onValueChange={(v) => onChange(v === '__any' ? '' : v)}>
        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__any" className="text-xs">Any</SelectItem>
          {options.map((o) => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function KeyingStep({ draft, onPatch }: StepContentProps) {
  const k = draft.keying;
  const enabled = !!k;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-md border p-3">
        <Switch checked={enabled} onCheckedChange={(v) => onPatch({ keying: v ? { format: null, keyway: null, keyedCylinderCount: 0 } : null })} />
        <Label className="text-sm">Build a keying schedule for this opening</Label>
      </div>
      {enabled && k && (
        <div className="grid grid-cols-2 gap-3">
          <KeyInput label="Keying format" value={k.format ?? ''} onChange={(v) => onPatch({ keying: { ...k, format: v } })} />
          <KeyInput label="Keyway" value={k.keyway ?? ''} onChange={(v) => onPatch({ keying: { ...k, keyway: v } })} />
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Keyed cylinder count</Label>
            <Input type="number" min={0} value={k.keyedCylinderCount ?? 0}
              onChange={(e) => onPatch({ keying: { ...k, keyedCylinderCount: parseInt(e.target.value) || 0 } })}
              className="h-8 text-sm" />
          </div>
          <KeyInput label="Construction core strategy" value={k.constructionCoreStrategy ?? ''}
            onChange={(v) => onPatch({ keying: { ...k, constructionCoreStrategy: v } })} />
        </div>
      )}
    </div>
  );
}

function KeyInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-sm" />
    </div>
  );
}

function AccessStep({ draft, onPatch }: StepContentProps) {
  const ac = draft.accessControl;
  const enabled = !!ac;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-md border p-3">
        <Switch checked={enabled} onCheckedChange={(v) => onPatch({ accessControl: v ? {} : null })} />
        <Label className="text-sm">Add an access-control bundle</Label>
      </div>
      {enabled && ac && (
        <div className="grid grid-cols-2 gap-3">
          <KeyInput label="Reader" value={ac.reader ?? ''} onChange={(v) => onPatch({ accessControl: { ...ac, reader: v } })} />
          <KeyInput label="Electric lock / strike" value={ac.lockStrike ?? ''} onChange={(v) => onPatch({ accessControl: { ...ac, lockStrike: v } })} />
          <KeyInput label="Power transfer" value={ac.powerTransfer ?? ''} onChange={(v) => onPatch({ accessControl: { ...ac, powerTransfer: v } })} />
          <KeyInput label="Power supply" value={ac.powerSupply ?? ''} onChange={(v) => onPatch({ accessControl: { ...ac, powerSupply: v } })} />
          <KeyInput label="DPS" value={ac.dps ?? ''} onChange={(v) => onPatch({ accessControl: { ...ac, dps: v } })} />
          <KeyInput label="Panel I/O" value={ac.panelIo ?? ''} onChange={(v) => onPatch({ accessControl: { ...ac, panelIo: v } })} />
          <KeyInput label="Cable requirements" value={ac.cableRequirements ?? ''} onChange={(v) => onPatch({ accessControl: { ...ac, cableRequirements: v } })} />
        </div>
      )}
    </div>
  );
}

function ReviewStep({ engineResult, pricing, onRunPricing }: StepContentProps) {
  if (pricing) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!engineResult) {
    return <Button onClick={onRunPricing} variant="outline"><CheckCircle2 className="h-4 w-4 mr-2" /> Calculate price</Button>;
  }

  const quote = buildAuditableQuoteFromEngine(engineResult.lines);
  // De-duplicate manual-quote requests into warning issues for the reviewer.
  const seen = new Set<string>();
  const extraIssues: CompletenessIssue[] = [];
  for (const m of engineResult.manualQuotes) {
    if (m.reason !== 'MISSING_PRICE' || !m.requestedInputs || seen.has(m.requestedInputs)) continue;
    seen.add(m.requestedInputs);
    extraIssues.push({ code: 'MANUAL_QUOTE', severity: 'warn', message: m.requestedInputs });
  }
  const completeness = validateQuoteCompleteness(quote, {
    dependencyResults: engineResult.dependencyResults,
    warnings: engineResult.warnings,
    extraIssues,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button size="sm" variant="ghost" onClick={onRunPricing}>Re-price</Button>
      </div>
      <AuditableQuote quote={quote} completeness={completeness} />
    </div>
  );
}
