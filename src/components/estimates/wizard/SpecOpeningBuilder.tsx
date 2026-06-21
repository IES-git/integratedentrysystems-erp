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

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Loader2, AlertCircle, DoorOpen, Square, LayoutPanelLeft, GlassWater,
  Wrench, KeyRound, ShieldCheck, ClipboardList, Plus, Trash2, CheckCircle2, Layers,
  ChevronDown, ChevronRight, ArrowLeft, Wand2,
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
import { validateQuoteCompleteness, type BuilderStepTarget, type CompletenessIssue, type CompletenessReport } from '@/lib/cpq/completeness';
import {
  loadSpecFieldDictionary, loadOptionDescriptors, loadHardwareCategories, loadBaseSignatures,
  type SpecFieldWithPath, type VariantOption, loadVariantsForCategory, type HardwareCategoryOption,
  type BaseSignatures,
} from '@/lib/cpq-catalog-api';
import {
  loadHardwareCatalog, generateHardwareRequirements, derivePrepRequirements, resolveHardwareNet,
  resolveActivePriceBookDocument,
  type HardwareCatalog, type PrepRequirement,
} from '@/lib/pricing';
import { priceOpeningLive } from '@/lib/cpq/live-pricing';
import { buildNormalizedSpec, createOpeningDraft, createCutoutDraft, type OpeningDraft, type ComponentDraft, type HardwareSelectionDraft, type CutoutDraft } from '@/lib/cpq/opening-spec';
import { saveOpeningDraft, loadOpeningCutouts, loadOpeningDraft } from '@/lib/cpq/opening-persist';
import { loadNgpCatalog, emptyNgpCatalog, type NgpCatalog } from '@/lib/ngp-catalog-api';
import { resolveOpeningSpecFromDb, withTimeout } from '@/lib/cpq/resolver';
import { resolveInfill, type NgpInfillType, type ResolvedInfill } from '@/lib/cpq/ngp-infill';
import {
  deriveBuilderContext, fieldTier, allowedEnumOptions, isStepVisible,
  doorHand, isHandedCategory, isFireRating, optionLabelsForField, deriveHardwareIntelligence,
  validateBuilderIntegrity, priceableEnumOptions, autoFillBaseValues,
  type BuilderContext, type OptionDescriptors, type IntegrityIssue,
} from '@/lib/cpq/builder-logic';
import type { EngineResult } from '@/lib/pricing';
import type {
  OpeningConfigurationType, RuleEntityType, SpecFieldEntity, SpecFieldMapping, EstimateOpening,
  UserOpeningSpec, ResolutionResult, ResolutionCandidate,
} from '@/types';

// The builder's step ids are the same union the completeness model uses to
// deep-link "Fix" buttons back to the right section.
type StepId = BuilderStepTarget;

// Resolver-driven flow (plan Phase 5): requirements first (opening → door →
// frame → hardware → lite/louver), then the resolver presents compliant
// manufacturer constructions, then pricing/audit. The manufacturer series is an
// OUTPUT chosen in the "Construction" step — never entered up front.
const STEPS: { id: StepId; label: string; icon: typeof DoorOpen }[] = [
  { id: 'classify', label: 'Opening', icon: ClipboardList },
  { id: 'doors', label: 'Door construction', icon: DoorOpen },
  { id: 'frame', label: 'Frame & wall', icon: Square },
  { id: 'hardware', label: 'Hardware', icon: Wrench },
  { id: 'panels', label: 'Panels', icon: LayoutPanelLeft },
  { id: 'lites', label: 'Lites/Glass', icon: GlassWater },
  { id: 'cutouts', label: 'Glass / Louvers', icon: GlassWater },
  { id: 'preps', label: 'Preparations', icon: Layers },
  { id: 'keying', label: 'Keying', icon: KeyRound },
  { id: 'access', label: 'Access Control', icon: ShieldCheck },
  { id: 'construction', label: 'Construction', icon: Wand2 },
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

/** Parse a plain-inch dimension (NGP cutouts use plain inches, not door-nominal). */
function plainInches(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Door thickness (in) from the draft's first door, default 1.75". */
function draftDoorThickness(draft: OpeningDraft): number {
  for (const d of draft.doors) {
    for (const [path, value] of Object.entries(d.fields)) {
      // Match a door-thickness field but NOT the glass thickness / kit-depth field.
      if (/thickness/i.test(path) && !/glass|kit_depth/i.test(path)) {
        const n = plainInches(value);
        if (n != null) return n;
      }
    }
  }
  return 1.75;
}

/** Door elevation classification used to seed NGP infill. */
function doorElevationKind(d: ComponentDraft): 'lite' | 'louver' | null {
  const elev = String(d.fields['door.door_face_elevation_style'] ?? '').toLowerCase();
  if (['vision', 'narrow lite', 'half glass', 'full glass'].includes(elev)) return 'lite';
  if (elev === 'louvered') return 'louver';
  return null;
}

/** Parses "W x H" / "WxH" cutout dimensions into plain-inch strings. */
function parseCutoutDims(raw: string | undefined): { w: string; h: string } {
  if (!raw) return { w: '', h: '' };
  const m = String(raw).match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/);
  if (m) return { w: m[1], h: m[2] };
  return { w: '', h: '' };
}

/** Opening fire rating in minutes (0 = non-rated). */
function draftFireMinutes(draft: OpeningDraft): number | null {
  for (const [path, value] of Object.entries(draft.openingFields)) {
    if (/fire.*(rating|label|minutes)/i.test(path)) {
      const n = Number(String(value).replace(/[^0-9.]/g, ''));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return draft.fireLabelRequired ? null : 0;
}

/**
 * Single source of truth for whether an opening can be finalized: merges builder
 * integrity + NGP infill issues with the engine's pricing completeness (missing
 * base prices, CF, unresolved scope). Used to gate Save so a non-expert can't
 * finish an opening that doesn't actually produce a valid price.
 */
// Where each builder-integrity finding is fixed, so its review "Fix" button
// jumps to the right section. Hardware interdependency conflicts default to the
// Hardware step.
const INTEGRITY_TARGET: Record<string, BuilderStepTarget> = {
  FIRE_NO_ACTIVE_LATCH: 'hardware',
  DEADBOLT_ON_EGRESS: 'hardware',
  FIRE_EXIT_NO_DOGGING: 'hardware',
  PAIR_NEEDS_COORDINATOR: 'hardware',
  ACCESS_POWER: 'access',
  SPECIALTY_FRAME_MISMATCH: 'frame',
  DOOR_WITHOUT_FRAME: 'frame',
};

function computeCompleteness(
  engineResult: EngineResult | null,
  integrityIssues: IntegrityIssue[],
  ngpIssues: CompletenessIssue[],
): CompletenessReport {
  const extra: CompletenessIssue[] = [
    ...integrityIssues.map((i) => ({
      code: i.code,
      severity: i.severity,
      message: i.message,
      target: INTEGRITY_TARGET[i.code] ?? 'hardware',
    })),
    ...ngpIssues.map((i) => ({ ...i, target: i.target ?? ('cutouts' as BuilderStepTarget) })),
  ];
  if (!engineResult) {
    const blockingCount = extra.filter((i) => i.severity === 'block').length;
    return { issues: extra, blockingCount, warningCount: extra.filter((i) => i.severity === 'warn').length, canFinalize: blockingCount === 0 };
  }
  const quote = buildAuditableQuoteFromEngine(engineResult.lines);
  const seen = new Set<string>();
  for (const m of engineResult.manualQuotes) {
    if (m.reason !== 'MISSING_PRICE' || !m.requestedInputs || seen.has(m.requestedInputs)) continue;
    seen.add(m.requestedInputs);
    extra.push({ code: 'MANUAL_QUOTE', severity: 'warn', message: m.requestedInputs, target: 'hardware' });
  }
  return validateQuoteCompleteness(quote, {
    dependencyResults: engineResult.dependencyResults,
    warnings: engineResult.warnings,
    extraIssues: extra,
  });
}

/** Builds the NGP infill resolver input from a cutout draft + opening context. */
function cutoutToInput(c: CutoutDraft, draft: OpeningDraft) {
  return {
    infillType: c.infillType,
    cutoutWidthIn: plainInches(c.cutoutWidth),
    cutoutHeightIn: plainInches(c.cutoutHeight),
    doorThicknessIn: c.doorThicknessIn ?? draftDoorThickness(draft),
    fireRatingMinutes: c.fireRatingMinutes ?? draftFireMinutes(draft),
    kitModel: c.kitModel,
    louverModel: c.louverModel,
    glassModel: c.glassModel,
    tapeModel: c.tapeModel,
    glassThicknessIn: c.glassThicknessIn,
    finishCode: c.finishCode,
    optionCodes: c.optionCodes,
    preferAssembly: c.preferAssembly,
  };
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
  /** Step to open on (e.g. when a review "Fix" button deep-links here). */
  initialStep?: StepId | null;
  /** Render the builder as a full page instead of a modal dialog. */
  mode?: 'dialog' | 'page';
}

export function SpecOpeningBuilder({
  estimateId, resolveEstimateId, open, onOpenChange, onSaved,
  openingCount = 0, editingOpeningId, editingName, editingQuantity,
  initialStep = null,
  mode = 'dialog',
}: SpecOpeningBuilderProps) {
  const [step, setStep] = useState<StepId>('classify');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<OpeningDraft>(() => createOpeningDraft());
  const [specByEntity, setSpecByEntity] = useState<Map<SpecFieldEntity, SpecFieldWithPath[]>>(new Map());
  const [mappings, setMappings] = useState<SpecFieldMapping[]>([]);
  const [descriptors, setDescriptors] = useState<OptionDescriptors | null>(null);
  const [hwCatalog, setHwCatalog] = useState<HardwareCatalog | null>(null);
  const [hardwareCategories, setHardwareCategories] = useState<HardwareCategoryOption[]>([]);
  const [baseSignatures, setBaseSignatures] = useState<BaseSignatures>({ door: [], frame: [], panel: [] });
  const [ngpCatalog, setNgpCatalog] = useState<NgpCatalog>(() => emptyNgpCatalog());
  const [variantsByCategory, setVariantsByCategory] = useState<Record<string, VariantOption[]>>({});
  const [engineResult, setEngineResult] = useState<EngineResult | null>(null);
  const [pricing, setPricing] = useState(false);
  // Explicit opt-in to finish an opening that still has pricing exceptions
  // (routes those lines to the manual-quote queue instead of a silent zero).
  const [ackManualQuote, setAckManualQuote] = useState(false);

  // Load the dictionary-driven catalog when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setStep(initialStep ?? 'classify');
    setError(null);
    setEngineResult(null);
    setAckManualQuote(false);

    // Default draft — overridden below for edit mode.
    setDraft(createOpeningDraft({
      name: editingName ?? `Opening ${openingCount + 1}`,
      quantity: editingQuantity ?? 1,
      doors: [newComponent('door', 'Door')],
      frames: [newComponent('frame', 'Frame')],
    }));

    setLoading(true);
    const catalogLoad = Promise.all([
      loadSpecFieldDictionary(),
      loadHardwareCatalog(new Date().toISOString().slice(0, 10)),
      loadOptionDescriptors(),
      loadNgpCatalog(),
      loadHardwareCategories(),
      loadBaseSignatures(),
    ])
      .then(([dict, cat, desc, ngp, hwCats, sigs]) => {
        setSpecByEntity(dict.byEntity);
        setMappings(dict.mappings);
        setHwCatalog(cat);
        setDescriptors(desc);
        setNgpCatalog(ngp);
        setHardwareCategories(hwCats);
        setBaseSignatures(sigs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load catalog'))
      .finally(() => setLoading(false));

    // In edit mode, rehydrate the full draft from the persisted snapshot (or
    // fall back to lossy reconstruction for legacy openings without a snapshot).
    if (editingOpeningId) {
      loadOpeningDraft(editingOpeningId)
        .then((savedDraft) => {
          if (savedDraft) {
            setDraft(savedDraft);
          }
          // Cutouts are already included in the snapshot; this is a no-op fallback
          // for legacy openings where loadOpeningDraft does the reconstruction.
        })
        .catch(() => {
          // Non-fatal: builder starts from the name/qty defaults if load fails.
        });
    }

    void catalogLoad;
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
      // Auto-add code-required companion categories (fire->closer, pair->flush
      // bolts, access->EPT) that the template didn't already include.
      const intel = deriveHardwareIntelligence(prev, merged);
      for (const add of intel.autoAddCategories) {
        if (merged.some((h) => h.category === add.category)) continue;
        merged.push({
          category: add.category, variantId: null, quantity: 1,
          required: add.required, source: 'set_template',
        });
      }
      return { ...prev, hardware: merged };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.configurationType, draft.leafCount, draft.fireLabelRequired, draft.accessControl, hwCatalog, open]);

  // Load variants for every hardware category as soon as they're known (not just
  // on the Hardware step) so required items can auto-default before Review.
  useEffect(() => {
    if (!open) return;
    const missing = draft.hardware.map((h) => h.category).filter((c) => !(c in variantsByCategory));
    if (missing.length === 0) return;
    Promise.all(missing.map(async (c) => [c, await loadVariantsForCategory(c)] as const))
      .then((entries) => setVariantsByCategory((prev) => ({ ...prev, ...Object.fromEntries(entries) })))
      .catch(() => { /* non-fatal — variant lists just stay empty */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft.hardware]);

  // Auto-select the variant for any category that resolves to a single priced
  // candidate under the current filters + opening context (hand/finish/fire),
  // and default a cheapest priced variant for REQUIRED categories. Runs whenever
  // variants load (not gated on the Hardware step) so the lock is set by Review.
  useEffect(() => {
    if (!open) return;
    const hand = doorHand(draft);
    const fireLabeled = draft.fireLabelRequired;
    const defaultFinish = draft.hardwareFinishDefault;
    for (const h of draft.hardware) {
      if (h.variantId) continue;
      const variants = variantsByCategory[h.category];
      if (!variants || variants.length === 0) continue;
      const effFinish = h.selectedFinish ?? defaultFinish ?? null;
      const effHand = h.selectedHand ?? (isHandedCategory(h.category) ? hand : null);
      const priced = filterVariants(variants, {
        function: h.selectedFunction ?? null, finish: effFinish, size: h.selectedSize ?? null,
        hand: effHand, rating: h.selectedRating ?? null,
      }, fireLabeled).filter(hasVariantPrice);
      // Auto-select when there's a single clear match, OR pick the cheapest
      // priced variant for a REQUIRED category so it never blocks (overridable).
      // filterVariants sorts priced-first then cheapest, so priced[0] is cheapest.
      const pick = priced.length === 1 ? priced[0] : (h.required && priced.length > 1 ? priced[0] : null);
      if (pick) {
        updateHardware(h.category, {
          variantId: pick.variant.id, source: 'set_template',
          selectedFinish: effFinish, selectedHand: effHand,
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, variantsByCategory, draft.hardware, draft.hardwareFinishDefault, draft.fireLabelRequired]);

  // Track doors we've already auto-seeded an NGP cutout for, so deleting a
  // seeded cutout doesn't immediately re-create it.
  const seededDoorsRef = useRef<Set<string>>(new Set());
  useEffect(() => { if (!open) seededDoorsRef.current = new Set(); }, [open]);

  // Carry the door's glazed/louvered elevation INTO the NGP infill step: when a
  // door is set to a glass/louver elevation, auto-create a pre-filled cutout
  // (door thickness, fire rating, cutout size + glass thickness from the door's
  // lite fields) so the Glass/Louvers step is never an empty "Add" with nothing
  // carried over.
  useEffect(() => {
    if (!open || ngpCatalog.products.length === 0) return;
    setDraft((prev) => {
      const additions: CutoutDraft[] = [];
      const doorsWithCutout = new Set(prev.cutouts.map((c) => c.doorId).filter(Boolean) as string[]);
      for (const d of prev.doors) {
        const kind = doorElevationKind(d);
        if (!kind) continue;
        if (doorsWithCutout.has(d.id) || seededDoorsRef.current.has(d.id)) continue;
        const dims = parseCutoutDims(d.fields['door.lite_cutout_visible_glass_dimensions']);
        additions.push(createCutoutDraft({
          doorId: d.id,
          infillType: kind === 'louver' ? 'LOUVER' : 'LITE',
          cutoutWidth: dims.w,
          cutoutHeight: dims.h,
          doorThicknessIn: draftDoorThickness(prev),
          fireRatingMinutes: draftFireMinutes(prev),
          glassThicknessIn: plainInches(d.fields['door.glass_thickness_kit_depth']),
        }));
        seededDoorsRef.current.add(d.id);
      }
      if (additions.length === 0) return prev;
      return { ...prev, cutouts: [...prev.cutouts, ...additions] };
    });
  }, [open, ngpCatalog, draft.doors]);

  // Auto-fill base fields that are FORCED to a single priceable value given the
  // current selection (e.g. once a CRS-only series is chosen, material → CRS),
  // so a non-expert always lands on a combination that actually has a price.
  useEffect(() => {
    if (!open) return;
    const sigFor = (e: RuleEntityType) => (e === 'frame' ? baseSignatures.frame : e === 'panel' ? baseSignatures.panel : baseSignatures.door);
    if (baseSignatures.door.length === 0 && baseSignatures.frame.length === 0) return;
    setDraft((prev) => {
      let changed = false;
      const apply = (list: ComponentDraft[], entity: RuleEntityType) => list.map((c) => {
        const forced = autoFillBaseValues({ ...c, entityType: entity }, sigFor(entity));
        const add: Record<string, string> = {};
        for (const [fp, v] of Object.entries(forced)) {
          if (!c.fields[fp]) add[fp] = v;
        }
        if (Object.keys(add).length === 0) return c;
        changed = true;
        return { ...c, fields: { ...c.fields, ...add } };
      });
      const doors = apply(prev.doors, 'door');
      const frames = apply(prev.frames, 'frame');
      const panels = apply(prev.panels, 'panel');
      return changed ? { ...prev, doors, frames, panels } : prev;
    });
  }, [open, baseSignatures, draft.doors, draft.frames, draft.panels]);

  const spec = useMemo(() => buildNormalizedSpec(draft, mappings, ngpCatalog), [draft, mappings, ngpCatalog]);
  const ctx = useMemo(() => deriveBuilderContext(draft), [draft]);
  const hardwareIntel = useMemo(() => deriveHardwareIntelligence(draft, draft.hardware), [draft]);
  const integrityIssues = useMemo(() => validateBuilderIntegrity(draft), [draft]);
  const integrityBlocks = integrityIssues.filter((i) => i.severity === 'block');
  // NGP infill resolution per cutout (auto-select/filter/validate), for live preview + gating.
  const ngpIssues = useMemo(() => {
    const out: CompletenessIssue[] = [];
    for (const c of draft.cutouts) {
      if (c.infillType === 'NONE') continue;
      const resolved = resolveInfill(ngpCatalog, cutoutToInput(c, draft));
      out.push(...resolved.issues);
    }
    return out;
  }, [draft, ngpCatalog]);
  const ngpBlocks = ngpIssues.filter((i) => i.severity === 'block');
  // When the NGP catalog is published, glass/louvers flow through the intelligent
  // "Glass / Louvers" cutout step, so hide the legacy specialty "Lites/Glass" step
  // (its door-level lite fields still live on the Doors step). Without NGP, keep
  // the legacy step so nothing is lost.
  const hasNgp = ngpCatalog.products.length > 0;
  const steps = useMemo(
    () => STEPS.filter((s) => isStepVisible(s.id, draft)).filter((s) => !(s.id === 'lites' && hasNgp)),
    [draft, hasNgp],
  );

  // If the active step gets hidden by a configuration change, fall back to Classify.
  useEffect(() => {
    if (!steps.some((s) => s.id === step)) setStep('classify');
  }, [steps, step]);

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

  // Add an individual hardware category by hand (independent of any set template).
  const addHardware = (category: string) =>
    setDraft((prev) => prev.hardware.some((h) => h.category === category)
      ? prev
      : { ...prev, hardware: [...prev.hardware, { category, variantId: null, quantity: 1, required: false, source: 'manual' }] });

  const removeHardware = (category: string) =>
    setDraft((prev) => ({ ...prev, hardware: prev.hardware.filter((h) => h.category !== category) }));

  // ---- NGP cutout helpers ----
  const addCutout = (infillType: NgpInfillType) =>
    setDraft((prev) => ({
      ...prev,
      cutouts: [...prev.cutouts, createCutoutDraft({
        infillType,
        doorId: prev.doors[0]?.id ?? null,
        doorThicknessIn: draftDoorThickness(prev),
        fireRatingMinutes: draftFireMinutes(prev),
      })],
    }));
  const removeCutout = (id: string) =>
    setDraft((prev) => ({ ...prev, cutouts: prev.cutouts.filter((c) => c.id !== id) }));
  const updateCutout = (id: string, p: Partial<CutoutDraft>) =>
    setDraft((prev) => ({ ...prev, cutouts: prev.cutouts.map((c) => (c.id === id ? { ...c, ...p } : c)) }));

  // ---- live pricing ----
  const runPricing = async () => {
    setPricing(true);
    setError(null);
    try {
      // Bound the call so a stalled request surfaces an error + retry instead of
      // an indefinite spinner.
      const result = await withTimeout(
        priceOpeningLive(buildNormalizedSpec(draft, mappings, ngpCatalog)),
        30000,
        'Pricing',
      );
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
      // Pin the active Pioneer price-book version up front so the gate re-price
      // and the persisted lines are priced against the SAME book (rather than
      // "whatever is latest" resolved independently at each call).
      const pinnedPriceBookId = await resolveActivePriceBookDocument();

      // Authoritative price-and-gate: re-price now so we never persist an opening
      // that can't actually be priced unless the user explicitly acknowledges a
      // manual quote. This is what stops a non-expert from finishing with $0.
      let result = engineResult;
      if (!result) {
        result = await priceOpeningLive(buildNormalizedSpec(draft, mappings, ngpCatalog), { priceBookDocumentId: pinnedPriceBookId });
        setEngineResult(result);
      }
      const report = computeCompleteness(result, integrityIssues, ngpIssues);
      if (report.blockingCount > 0 && !ackManualQuote) {
        setStep('review');
        setError(`${report.blockingCount} issue${report.blockingCount > 1 ? 's' : ''} must be resolved before this opening can be priced — complete the highlighted selections, or check "Save for manual quote" to route them for a hand quote.`);
        return;
      }

      const eid = estimateId ?? (resolveEstimateId ? await resolveEstimateId() : null);
      if (!eid) { setError('Unable to create estimate.'); return; }
      const { opening } = await saveOpeningDraft(eid, draft, mappings, { priceBookDocumentId: pinnedPriceBookId }, editingOpeningId, ngpCatalog);
      onSaved(opening);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save opening');
    } finally {
      setSaving(false);
    }
  };

  const completeness = useMemo(
    () => computeCompleteness(engineResult, integrityIssues, ngpIssues),
    [engineResult, integrityIssues, ngpIssues],
  );
  const blockingDeps = engineResult?.dependencyResults.filter((d) => d.blocking) ?? [];
  // Pre-pricing gate (name + structural/NGP blocks); the pricing gate is enforced
  // in handleSave (and reflected here once a price has been computed).
  const pricingBlocked = completeness.blockingCount > 0 && !ackManualQuote;
  const canSave = draft.name.trim().length > 0 && blockingDeps.length === 0 &&
    integrityBlocks.length === 0 && ngpBlocks.length === 0 && !pricingBlocked;

  const title = editingOpeningId ? 'Edit Opening' : 'Build Opening';
  const description =
    'Spec-driven configurator — classify the opening, then walk door → frame → panel → lites → preps → hardware.';

  // Step rail + step content — identical between dialog and page modes.
  const mainContent = (
    <div className="flex flex-1 min-h-0">
      {/* Step rail */}
      <nav className="w-44 shrink-0 border-r bg-muted/20 py-3 overflow-y-auto">
        {steps.map((s) => {
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
            ctx={ctx}
            descriptors={descriptors}
            hardwareConflicts={hardwareIntel.conflicts}
            integrityIssues={integrityIssues}
            ngpCatalog={ngpCatalog}
            ngpIssues={ngpIssues}
            hardwareCategories={hardwareCategories}
            baseSignatures={baseSignatures}
            specByEntity={specByEntity}
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
            onAddHardware={addHardware}
            onRemoveHardware={removeHardware}
            onAddCutout={addCutout}
            onRemoveCutout={removeCutout}
            onUpdateCutout={updateCutout}
            onRunPricing={runPricing}
            onGoToStep={setStep}
          />
        )}
      </div>
    </div>
  );

  const errorBlock = error ? (
    <p className="px-6 text-sm text-destructive flex items-center gap-1.5">
      <AlertCircle className="h-4 w-4 shrink-0" /> {error}
    </p>
  ) : null;

  // Footer body (completeness summary + Cancel/Save) — identical between modes.
  const footerContent = (
    <>
      <div className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
        {completeness.blockingCount > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {completeness.blockingCount} issue{completeness.blockingCount > 1 ? 's' : ''} to resolve before this can be priced
            </span>
            {/* Only structural/NGP blocks are truly un-saveable; pricing gaps
                can be routed to a manual quote with an explicit opt-in. */}
            {integrityBlocks.length === 0 && ngpBlocks.length === 0 && (
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={ackManualQuote}
                  onChange={(e) => setAckManualQuote(e.target.checked)}
                />
                Save anyway for a manual quote
              </label>
            )}
          </div>
        ) : engineResult && (
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
    </>
  );

  if (mode === 'page') {
    return (
      <div className="flex h-full flex-col bg-background">
        <div className="px-6 pt-5 pb-3 border-b shrink-0">
          <Button variant="ghost" size="sm" className="-ml-2 mb-1 text-muted-foreground" onClick={() => onOpenChange(false)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Openings
          </Button>
          <h1 className="font-display text-2xl">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        {mainContent}
        {errorBlock}

        <div className="px-6 py-3 border-t shrink-0 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
          {footerContent}
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[92vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="font-display text-2xl">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {mainContent}
        {errorBlock}

        <DialogFooter className="px-6 py-3 border-t">
          {footerContent}
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
  ctx: BuilderContext;
  descriptors: OptionDescriptors | null;
  hardwareConflicts: IntegrityIssue[];
  integrityIssues: IntegrityIssue[];
  ngpCatalog: NgpCatalog;
  ngpIssues: CompletenessIssue[];
  hardwareCategories: HardwareCategoryOption[];
  baseSignatures: BaseSignatures;
  specByEntity: Map<SpecFieldEntity, SpecFieldWithPath[]>;
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
  onAddHardware: (category: string) => void;
  onRemoveHardware: (category: string) => void;
  onAddCutout: (infillType: NgpInfillType) => void;
  onRemoveCutout: (id: string) => void;
  onUpdateCutout: (id: string, p: Partial<CutoutDraft>) => void;
  onRunPricing: () => void;
  /** Jump to another builder step (used by review "Fix" buttons). */
  onGoToStep: (id: StepId) => void;
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
    case 'cutouts': return <CutoutStep {...props} />;
    case 'preps': return <PrepsStep {...props} />;
    case 'hardware': return <HardwareStep {...props} />;
    case 'keying': return <KeyingStep {...props} />;
    case 'access': return <AccessStep {...props} />;
    case 'construction': return <ConstructionStep {...props} />;
    case 'review': return <ReviewStep {...props} />;
    default: {
      const _exhaustive: never = step;
      return null;
    }
  }
}

// Configurations whose leaf count is implied (so the user shouldn't enter it).
const LEAF_FIXED_CONFIGS: OpeningConfigurationType[] = [
  'single', 'pair', 'double_egress', 'communicating', 'dutch',
];

function ClassifyStep({ draft, ctx, descriptors, specByEntity, onPatch, onSetOpeningField }: StepContentProps) {
  const opening = fieldsFor(specByEntity, 'opening').filter(
    (f) => f.category !== 'Configuration' && f.fieldId !== 'OPN-013',
  );
  const visible = opening.filter((f) => fieldTier(f, draft, ctx) !== 'hidden');
  const essential = visible.filter((f) => fieldTier(f, draft, ctx) === 'essential');
  const advanced = visible.filter((f) => fieldTier(f, draft, ctx) === 'advanced');
  const leafFixed = LEAF_FIXED_CONFIGS.includes(draft.configurationType);

  const renderOpeningField = (f: SpecFieldWithPath) => (
    <SpecFieldInput key={f.id} field={f}
      value={f.fieldPath ? draft.openingFields[f.fieldPath] ?? '' : ''}
      onChange={onSetOpeningField}
      derivedValue={f.fieldPath ? ctx.derivedOpeningFields[f.fieldPath]?.value ?? null : null}
      derivedReason={f.fieldPath ? ctx.derivedOpeningFields[f.fieldPath]?.reason ?? null : null}
      options={allowedEnumOptions(f, draft, ctx)}
      optionLabels={optionLabelsForField(f, descriptors)} />
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
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            Leaf count
            {leafFixed && <Badge variant="secondary" className="h-4 px-1 text-[9px] font-normal">auto</Badge>}
          </Label>
          {leafFixed ? (
            <Input value={ctx.leafCount} readOnly className="h-8 text-sm bg-muted/40" />
          ) : (
            <Input type="number" min={1} value={draft.leafCount}
              onChange={(e) => onPatch({ leafCount: parseInt(e.target.value) || 1 })} className="h-8 text-sm" />
          )}
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

      {essential.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Performance &amp; logistics</p>
          <div className="grid grid-cols-2 gap-3">{essential.map(renderOpeningField)}</div>
        </div>
      )}

      <AdvancedFields count={advanced.length}>
        <div className="grid grid-cols-2 gap-3">{advanced.map(renderOpeningField)}</div>
      </AdvancedFields>
    </div>
  );
}

/** Collapsible container for advanced/optional fields (progressive disclosure). */
function AdvancedFields({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <div className="rounded-md border border-dashed">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Advanced options ({count})
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
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
  const { draft, ctx, descriptors, specByEntity, baseSignatures, entity, specEntity, title, onAddComponent, onRemoveComponent, onUpdateComponentField, onUpdateComponentMeta } = props;
  const key = entity === 'door' ? 'doors' : entity === 'frame' ? 'frames' : entity === 'panel' ? 'panels' : 'lites';
  const components = draft[key] as ComponentDraft[];
  const fields = fieldsFor(specByEntity, specEntity);
  const signatures = entity === 'frame' ? baseSignatures.frame : entity === 'panel' ? baseSignatures.panel : baseSignatures.door;

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
        <ComponentCard key={comp.id} comp={comp} entity={entity} fields={fields}
          draft={draft} ctx={ctx} descriptors={descriptors} signatures={signatures}
          onRemoveComponent={onRemoveComponent}
          onUpdateComponentField={onUpdateComponentField}
          onUpdateComponentMeta={onUpdateComponentMeta} />
      ))}
    </div>
  );
}

interface ComponentCardProps {
  comp: ComponentDraft;
  entity: RuleEntityType;
  fields: SpecFieldWithPath[];
  draft: OpeningDraft;
  ctx: BuilderContext;
  descriptors: OptionDescriptors | null;
  signatures: BaseSignatures[keyof BaseSignatures];
  onRemoveComponent: (entity: RuleEntityType, id: string) => void;
  onUpdateComponentField: (entity: RuleEntityType, id: string, path: string, value: string) => void;
  onUpdateComponentMeta: (entity: RuleEntityType, id: string, p: Partial<ComponentDraft>) => void;
}

function ComponentCard({
  comp, entity, fields, draft, ctx, descriptors, signatures,
  onRemoveComponent, onUpdateComponentField, onUpdateComponentMeta,
}: ComponentCardProps) {
  const derived = ctx.derivedByComponent[comp.id] ?? {};
  const tierOf = (f: SpecFieldWithPath) => fieldTier(f, draft, ctx, comp);
  const essential = fields.filter((f) => tierOf(f) === 'essential');
  const advanced = fields.filter((f) => tierOf(f) === 'advanced');

  const renderField = (f: SpecFieldWithPath) => (
    <SpecFieldInput key={f.id} field={f}
      value={f.fieldPath ? comp.fields[f.fieldPath] ?? '' : ''}
      onChange={(path, value) => onUpdateComponentField(entity, comp.id, path, value)}
      derivedValue={f.fieldPath ? derived[f.fieldPath]?.value ?? null : null}
      derivedReason={f.fieldPath ? derived[f.fieldPath]?.reason ?? null : null}
      // Only offer values that keep a priceable base reachable (cascading).
      options={priceableEnumOptions(allowedEnumOptions(f, draft, ctx, comp), f, comp, signatures)}
      optionLabels={optionLabelsForField(f, descriptors)} />
  );

  const byCategory = (list: SpecFieldWithPath[]) => {
    const cats = [...new Set(list.map((f) => f.category).filter(Boolean))] as string[];
    return cats.map((cat) => (
      <div key={cat} className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{cat}</p>
        <div className="grid grid-cols-2 gap-2.5">{list.filter((f) => f.category === cat).map(renderField)}</div>
      </div>
    ));
  };

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Input value={comp.label} onChange={(e) => onUpdateComponentMeta(entity, comp.id, { label: e.target.value })}
          className="h-8 text-sm font-medium max-w-[200px]" />
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

      {byCategory(essential)}

      <AdvancedFields count={advanced.length}>
        <div className="space-y-3">{byCategory(advanced)}</div>
      </AdvancedFields>
    </div>
  );
}

/**
 * NGP glass / louver cutouts. Beginner flow: pick infill type + cutout size and
 * the system auto-filters to compatible kits/louvers, auto-selects the glazing
 * tape and glass, validates fire limits, and previews the child lines. Every
 * auto choice is overridable from the filtered candidate lists.
 */
function CutoutStep({ draft, ngpCatalog, onAddCutout, onRemoveCutout, onUpdateCutout }: StepContentProps) {
  const hasCatalog = ngpCatalog.products.length > 0;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg">Glass / Louvers</h3>
          <p className="text-sm text-muted-foreground">NGP vision lites and louvers cut into the door — the system picks the kit, glass and tape for you.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onAddCutout('LITE')} disabled={!hasCatalog}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Vision lite
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAddCutout('LOUVER')} disabled={!hasCatalog}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Louver
          </Button>
        </div>
      </div>

      {!hasCatalog && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-800/40 dark:bg-amber-900/10 p-3 text-xs text-amber-800 dark:text-amber-300">
          No published NGP catalog found. Ingest and publish the NGP glass / lite-kit / louver catalog in Price Book Ingest to enable infill pricing.
        </div>
      )}

      {hasCatalog && draft.cutouts.length === 0 && (
        <p className="text-sm text-muted-foreground italic">No cutouts. Add a vision lite or louver to start.</p>
      )}

      <div className="space-y-3">
        {draft.cutouts.map((cutout, idx) => (
          <CutoutCard
            key={cutout.id}
            index={idx}
            cutout={cutout}
            draft={draft}
            catalog={ngpCatalog}
            onRemove={() => onRemoveCutout(cutout.id)}
            onUpdate={(p) => onUpdateCutout(cutout.id, p)}
          />
        ))}
      </div>
    </div>
  );
}

function CutoutCard({
  index, cutout, draft, catalog, onRemove, onUpdate,
}: {
  index: number;
  cutout: CutoutDraft;
  draft: OpeningDraft;
  catalog: NgpCatalog;
  onRemove: () => void;
  onUpdate: (p: Partial<CutoutDraft>) => void;
}) {
  const resolved: ResolvedInfill = resolveInfill(catalog, cutoutToInput(cutout, draft));
  const isLite = cutout.infillType === 'LITE';
  const auto = resolved.autoFields;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GlassWater className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">
            {isLite ? 'Vision lite' : 'Louver'} {index + 1}
          </span>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Type + cutout size */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Infill type</Label>
          <Select value={cutout.infillType} onValueChange={(v) => onUpdate({ infillType: v as NgpInfillType })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="LITE">Vision lite (glass)</SelectItem>
              <SelectItem value="LOUVER">Louver</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Cutout width (in)</Label>
          <Input className="h-9" value={cutout.cutoutWidth} onChange={(e) => onUpdate({ cutoutWidth: e.target.value })} placeholder="e.g. 24" />
        </div>
        <div>
          <Label className="text-xs">Cutout height (in)</Label>
          <Input className="h-9" value={cutout.cutoutHeight} onChange={(e) => onUpdate({ cutoutHeight: e.target.value })} placeholder="e.g. 32" />
        </div>
      </div>

      {/* Auto-resolved selections (overridable) */}
      {isLite ? (
        <div className="grid grid-cols-2 gap-3">
          <AutoSelect
            label="Lite kit"
            value={resolved.kit?.model ?? null}
            autoReason={auto['kitModel']?.reason}
            options={resolved.candidateKits.map((k) => ({ value: k.model ?? '', label: `${k.model}${k.subcategory ? ` — ${k.subcategory}` : ''}` }))}
            onChange={(v) => onUpdate({ kitModel: v })}
          />
          {!resolved.glassBundled && (
            <AutoSelect
              label="Glass"
              value={resolved.glass?.model ?? null}
              autoReason={auto['glassModel']?.reason}
              options={resolved.candidateGlass.map((g) => ({ value: g.model ?? '', label: g.model ?? '' }))}
              onChange={(v) => onUpdate({ glassModel: v })}
            />
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <AutoSelect
            label="Louver"
            value={resolved.louver?.model ?? null}
            autoReason={auto['louverModel']?.reason}
            options={resolved.candidateLouvers.map((l) => ({ value: l.model ?? '', label: `${l.model}${l.subcategory ? ` — ${l.subcategory}` : ''}` }))}
            onChange={(v) => onUpdate({ louverModel: v })}
          />
          {resolved.louverCores > 1 && (
            <div className="flex items-end text-xs text-muted-foreground pb-2">
              {resolved.louverCores} cores (auto — split-core size threshold)
            </div>
          )}
        </div>
      )}

      {/* Finish */}
      {catalog.finishCodes.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Finish</Label>
            <Select value={cutout.finishCode ?? '__std'} onValueChange={(v) => onUpdate({ finishCode: v === '__std' ? null : v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Standard (GPZ)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__std">Standard primer (no charge)</SelectItem>
                {catalog.finishCodes.map((f) => (
                  <SelectItem key={f.id} value={f.finishCode}>{f.finishCode} — {f.finishName ?? ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Auto preview: tape + child lines + issues */}
      <div className="rounded-md bg-muted/40 p-2.5 text-xs space-y-1">
        {resolved.assemblyMode && (
          <div className="flex items-center gap-1.5"><Badge variant="secondary" className="text-[10px]">auto</Badge> Priced as a kit+glass+tape assembly.</div>
        )}
        {resolved.tapeModel && (
          <div className="flex items-center gap-1.5"><Badge variant="secondary" className="text-[10px]">auto</Badge> Glazing tape <strong>{resolved.tapeModel}</strong>{auto['tapeModel']?.reason ? ` — ${auto['tapeModel'].reason}` : ''}</div>
        )}
        {resolved.orderWidthIn != null && (
          <div className="text-muted-foreground">
            Order size {resolved.orderWidthIn}×{resolved.orderHeightIn}"
            {resolved.exposedWidthIn != null && ` · exposed glass ${resolved.exposedWidthIn}×${resolved.exposedHeightIn}"`}
          </div>
        )}
        {resolved.components.length > 0 && (
          <div className="text-muted-foreground">
            Generates: {resolved.components.map((c) => c.code).join(' + ')}
          </div>
        )}
        {resolved.issues.map((i, k) => (
          <div key={k} className={cn('flex items-center gap-1.5', i.severity === 'block' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400')}>
            <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {i.message}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A select whose current value can be auto-chosen (shows an "auto" badge). */
function AutoSelect({
  label, value, autoReason, options, onChange,
}: {
  label: string;
  value: string | null;
  autoReason?: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Label className="text-xs">{label}</Label>
        {autoReason && <Badge variant="secondary" className="text-[10px]" title={autoReason}>auto</Badge>}
      </div>
      <Select value={value ?? ''} onValueChange={onChange}>
        <SelectTrigger className="h-9"><SelectValue placeholder="Select…" /></SelectTrigger>
        <SelectContent>
          {options.filter((o) => o.value).map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
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

// ---- hardware variant filtering helpers ----
interface HwCriteria {
  function: string | null;
  finish: string | null;
  size: string | null;
  hand: string | null;
  rating: string | null;
}

const HW_AXES = ['function', 'finish', 'size', 'hand', 'rating'] as const;
type HwAxis = (typeof HW_AXES)[number];

function hasVariantPrice(v: VariantOption): boolean {
  // Only a TRUSTWORTHY price counts — negative / zero / absurd net (dirty
  // catalog data) must not look priced, must not auto-select, and must not win
  // a "cheapest" comparison.
  return resolveHardwareNet(v.price) != null;
}

function variantNet(v: VariantOption): number {
  return resolveHardwareNet(v.price) ?? Number.POSITIVE_INFINITY;
}

function matchesCriteria(v: VariantOption, c: Partial<HwCriteria>): boolean {
  return HW_AXES.every((axis) => {
    const want = c[axis];
    return !want || (v.variant[axis] ?? '') === want;
  });
}

/**
 * Accessory subcategories that share a device category but are NOT the device
 * itself (e.g. latch guards / pulls / trim live in the lock category). They must
 * never be auto-selected over a real device, or the cheapest-first sort lands on
 * a $17 latch protector instead of an actual lockset.
 */
const ACCESSORY_SUBCATEGORIES = ['latch grd', 'latch guard', 'pull trim', 'pull', 'trim', 'astragal', 'filler'];

function isAccessorySubcategory(sub: string | null): boolean {
  if (!sub) return false;
  const s = sub.trim().toLowerCase();
  return ACCESSORY_SUBCATEGORIES.some((a) => s === a || s.includes(a));
}

/**
 * Variants matching the criteria, with the fire-rating gate applied (when an
 * opening is labeled and both rated/unrated exist, keep only rated), then
 * accessory subcategories demoted below real devices, sorted with priced
 * variants first then cheapest net.
 */
function filterVariants(variants: VariantOption[], criteria: Partial<HwCriteria>, fireLabeled: boolean): VariantOption[] {
  let out = variants.filter((v) => matchesCriteria(v, criteria));
  if (fireLabeled) {
    const rated = out.filter((v) => isFireRating(v.variant.rating));
    if (rated.length > 0 && rated.length < out.length) out = rated;
  }
  // If real (non-accessory) devices exist in this category, drop the accessories
  // so auto-select can't pick a latch guard / pull / trim as the "device".
  const realDevices = out.filter((v) => !isAccessorySubcategory(v.subcategory));
  if (realDevices.length > 0 && realDevices.length < out.length) out = realDevices;
  return [...out].sort((a, b) =>
    (Number(hasVariantPrice(b)) - Number(hasVariantPrice(a))) || (variantNet(a) - variantNet(b)));
}

function HardwareStep({ draft, variantsByCategory, hardwareConflicts, hardwareCategories, onUpdateHardware, onAddHardware, onRemoveHardware, onPatch }: StepContentProps) {
  const defaultFinish = draft.hardwareFinishDefault;
  const hand = doorHand(draft);
  const fireLabeled = draft.fireLabelRequired;
  const allFinishes = [...new Set(
    Object.values(variantsByCategory).flat().map((v) => v.variant.finish).filter((x): x is string => !!x),
  )].sort();

  return (
    <div className="space-y-4">
      {hardwareConflicts.length > 0 && (
        <div className="space-y-1.5">
          {hardwareConflicts.map((c) => (
            <div key={c.code} className={cn(
              'flex items-start gap-2 rounded-md border p-2 text-xs',
              c.severity === 'block'
                ? 'border-destructive/40 bg-destructive/5 text-destructive'
                : c.severity === 'warn'
                  ? 'border-amber-300/50 bg-amber-50/60 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-300'
                  : 'border-border bg-muted/30 text-muted-foreground',
            )}>
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{c.message}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Hardware</h3>
          <p className="text-[11px] text-muted-foreground">
            Auto-suggested for this opening — add or remove individual items as needed.
          </p>
        </div>
        {allFinishes.length > 0 && (
          <div className="flex items-center gap-2">
            <Label className="text-[11px] text-muted-foreground">Default finish (all items)</Label>
            <Select value={defaultFinish ?? '__none'} onValueChange={(v) => onPatch({ hardwareFinishDefault: v === '__none' ? null : v })}>
              <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none" className="text-xs">None</SelectItem>
                {allFinishes.map((f) => <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Always allow adding individual hardware, regardless of set templates. */}
      <AddHardwareControl
        categories={hardwareCategories}
        existing={new Set(draft.hardware.map((h) => h.category))}
        onAdd={onAddHardware}
      />

      {draft.hardware.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          No hardware yet. Use “Add hardware” above to pick items (hinges, locks, closers, seals, …).
        </p>
      )}
      {draft.hardware.map((h) => {
        const variants = variantsByCategory[h.category] ?? [];
        const handed = isHandedCategory(h.category);
        const effFinish = h.selectedFinish ?? defaultFinish ?? null;
        const effHand = h.selectedHand ?? (handed ? hand : null);
        const criteria: HwCriteria = {
          function: h.selectedFunction ?? null, finish: effFinish, size: h.selectedSize ?? null,
          hand: effHand, rating: h.selectedRating ?? null,
        };
        const filtered = filterVariants(variants, criteria, fireLabeled);

        // Cascading options: each axis's choices are computed from the set
        // filtered by every OTHER axis; axes with <=1 option auto-collapse.
        const axisOptions = (axis: HwAxis): string[] => {
          const without = { ...criteria, [axis]: null };
          const pool = filterVariants(variants, without, fireLabeled);
          return [...new Set(pool.map((v) => v.variant[axis]).filter((x): x is string => !!x))].sort();
        };
        const axisValue: Record<HwAxis, string> = {
          function: h.selectedFunction ?? '', finish: effFinish ?? '', size: h.selectedSize ?? '',
          hand: effHand ?? '', rating: h.selectedRating ?? '',
        };
        const axisLabel: Record<HwAxis, string> = {
          function: 'Function', finish: 'Finish', size: 'Size', hand: 'Hand', rating: 'Rating',
        };
        const setAxis = (axis: HwAxis, v: string) => {
          const value = v || null;
          const patch: Partial<HardwareSelectionDraft> =
            axis === 'function' ? { selectedFunction: value }
            : axis === 'finish' ? { selectedFinish: value }
            : axis === 'size' ? { selectedSize: value }
            : axis === 'hand' ? { selectedHand: value }
            : { selectedRating: value };
          onUpdateHardware(h.category, patch);
        };
        const visibleAxes = HW_AXES.filter((axis) => {
          if (axis === 'hand' && !handed) return false;
          return axisOptions(axis).length > 1 || axisValue[axis] !== '';
        });
        const autoSelected = !!h.variantId && h.source === 'set_template';

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
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => onRemoveHardware(h.category)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {visibleAxes.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {visibleAxes.map((axis) => (
                  <FilterSelect key={axis} label={axisLabel[axis]} value={axisValue[axis]}
                    options={axisOptions(axis)} onChange={(v) => setAxis(axis, v)} />
                ))}
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                Variant
                {autoSelected && <Badge variant="secondary" className="h-4 px-1 text-[9px] font-normal">auto-selected</Badge>}
              </Label>
              <Select value={h.variantId ?? ''} onValueChange={(v) => onUpdateHardware(h.category, { variantId: v, source: 'manual' })}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder={filtered.length ? 'Select a variant…' : 'No catalog variants — route to manual quote'} />
                </SelectTrigger>
                <SelectContent>
                  {filtered.map((v) => (
                    <SelectItem key={v.variant.id} value={v.variant.id} className="text-sm">
                      {v.variant.sku ?? v.productDescription ?? v.variant.id}
                      {(() => { const n = resolveHardwareNet(v.price); return n != null ? ` — net $${n.toFixed(2)}` : ' — no price'; })()}
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

/** "Add hardware" picker — lists catalog categories not already on the opening. */
function AddHardwareControl({
  categories, existing, onAdd,
}: {
  categories: HardwareCategoryOption[];
  existing: Set<string>;
  onAdd: (category: string) => void;
}) {
  const available = categories.filter((c) => !existing.has(c.category));
  if (categories.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No hardware catalog loaded — ingest and publish a hardware price book to select items.
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Select value="" onValueChange={(v) => v && onAdd(v)}>
        <SelectTrigger className="h-8 text-sm w-72">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Plus className="h-3.5 w-3.5" /> Add hardware…
          </span>
        </SelectTrigger>
        <SelectContent>
          {available.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">All categories added</div>
          ) : (
            available.map((c) => (
              <SelectItem key={c.category} value={c.category} className="text-sm">
                {c.label} <span className="text-muted-foreground">({c.variantCount})</span>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
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

/** Builds the requirements-only UserOpeningSpec from the draft (series excluded). */
function buildUserSpec(draft: OpeningDraft): UserOpeningSpec {
  const requirements: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft.openingFields)) if (v) requirements[k] = v;
  const firstDoor = draft.doors[0];
  if (firstDoor) for (const [k, v] of Object.entries(firstDoor.fields)) {
    if (v && k !== 'door.door_series_construction') requirements[k] = v;
  }
  const firstFrame = draft.frames[0];
  if (firstFrame) for (const [k, v] of Object.entries(firstFrame.fields)) {
    if (v && k !== 'frame.frame_series') requirements[k] = v;
  }
  return {
    openingId: draft.openingId, estimateId: draft.estimateId, name: draft.name,
    quantity: draft.quantity, configurationType: draft.configurationType, leafCount: draft.leafCount,
    openingWidth: draft.openingWidth, openingHeight: draft.openingHeight,
    fireLabelRequired: draft.fireLabelRequired, requirements,
  };
}

/**
 * Compliant construction selection (plan Phase 5). Runs the spec resolver
 * against the entered requirements and lets the estimator pick a plain-language
 * construction. The chosen candidate's manufacturer series is applied back to
 * the door/frame components (so pricing still matches on series) — the series
 * codes themselves appear only under "technical detail".
 */
function ConstructionStep({ draft, onUpdateComponentField }: StepContentProps) {
  const [result, setResult] = useState<ResolutionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTech, setShowTech] = useState(false);

  const reqKey = useMemo(() => {
    const s = buildUserSpec(draft);
    return JSON.stringify(s.requirements) + s.configurationType + s.fireLabelRequired;
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    resolveOpeningSpecFromDb(buildUserSpec(draft))
      .then((r) => { if (!cancelled) setResult(r); })
      .catch(() => { if (!cancelled) setResult(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey]);

  const applyCandidate = (cand: ResolutionCandidate) => {
    const doorSeries = cand.resolved.series.door;
    const frameSeries = cand.resolved.series.frame;
    if (doorSeries) draft.doors.forEach((d) => onUpdateComponentField('door', d.id, 'door.door_series_construction', doorSeries));
    if (frameSeries) draft.frames.forEach((f) => onUpdateComponentField('frame', f.id, 'frame.frame_series', frameSeries));
  };

  const currentDoorSeries = draft.doors[0]?.fields['door.door_series_construction'] ?? null;

  // Auto-apply the single compliant construction.
  useEffect(() => {
    if (result?.status === 'auto' && result.selected) {
      if (currentDoorSeries !== result.selected.resolved.series.door) applyCandidate(result.selected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!result) {
    return <div className="text-sm text-muted-foreground">Enter the door and frame requirements, then return here to choose a compliant construction.</div>;
  }

  if (result.status === 'manual_quote' || result.status === 'invalid') {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">{result.status === 'manual_quote' ? 'Routed to manual quote' : 'No compliant construction'}</div>
            <ul className="mt-1 list-disc pl-4 text-xs">
              {result.diagnostics.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  const renderCandidate = (cand: ResolutionCandidate) => {
    const selected = currentDoorSeries === cand.resolved.series.door;
    return (
      <div key={cand.id} className={cn('rounded-md border p-3 space-y-2', selected && 'border-primary ring-1 ring-primary')}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium flex items-center gap-2">
              {cand.title}
              {selected && <Badge className="h-4 px-1 text-[9px]">Selected</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">{cand.description}</div>
          </div>
          <Button size="sm" variant={selected ? 'secondary' : 'default'} onClick={() => applyCandidate(cand)}>
            {selected ? 'Selected' : 'Use this'}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {cand.gauge && <Badge variant="secondary" className="text-[10px] font-normal">{cand.gauge} ga</Badge>}
          {cand.core && <Badge variant="secondary" className="text-[10px] font-normal">{cand.core}</Badge>}
          {cand.edge && <Badge variant="secondary" className="text-[10px] font-normal">{cand.edge}</Badge>}
          {cand.compliance.map((c) => <Badge key={c} variant="outline" className="text-[10px] font-normal">{c}</Badge>)}
          {cand.priceImpact && <Badge variant="outline" className="text-[10px] font-normal">{cand.priceImpact}</Badge>}
        </div>
        {showTech && (
          <div className="rounded bg-muted/40 p-2 text-[11px] text-muted-foreground font-mono">
            door series {cand.technical.doorSeries ?? '—'} · frame series {cand.technical.frameSeries ?? '—'}
            {cand.technical.optionCodes.length > 0 && <> · options {cand.technical.optionCodes.join(', ')}</>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {result.status === 'auto'
            ? 'A single compliant construction was resolved automatically.'
            : 'Multiple constructions comply — choose one.'}
        </div>
        <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowTech((v) => !v)}>
          {showTech ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
          Technical detail
        </Button>
      </div>
      {result.diagnostics.length > 0 && (
        <ul className="list-disc pl-4 text-[11px] text-muted-foreground">
          {result.diagnostics.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}
      <div className="space-y-2">{result.candidates.map(renderCandidate)}</div>
    </div>
  );
}

function ReviewStep({ engineResult, pricing, integrityIssues, ngpIssues, onRunPricing, onGoToStep }: StepContentProps) {
  if (pricing) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!engineResult) {
    return <Button onClick={onRunPricing} variant="outline"><CheckCircle2 className="h-4 w-4 mr-2" /> Calculate price</Button>;
  }

  const quote = buildAuditableQuoteFromEngine(engineResult.lines);
  const completeness = computeCompleteness(engineResult, integrityIssues, ngpIssues);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button size="sm" variant="ghost" onClick={onRunPricing}>Re-price</Button>
      </div>
      <AuditableQuote quote={quote} completeness={completeness} onNavigate={onGoToStep} />
    </div>
  );
}
