import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { pdf, PDFViewer } from '@react-pdf/renderer';
import {
  ArrowLeft,
  Building2,
  Download,
  Eye,
  FileText,
  Loader2,
  Save,
  Tag,
  TrendingUp,
  Wrench,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Info,
  Layers,
  Zap,
  Minus,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { getEstimateWithItems, updateEstimateOpening } from '@/lib/estimates-api';
import { refreshEstimatePricing } from '@/lib/pricing-lookup';
import { getCompany } from '@/lib/companies-api';
import { createQuote } from '@/lib/quotes-api';
import { assertEstimateBuildable, priceEstimate } from '@/lib/cpq/service';
import { loadEstimateLinesByOpening } from '@/lib/cpq/estimate-lines-api';
import { buildQuotableOpenings, type QuotableOpening } from '@/lib/cpq/quote-bridge';
import { generateQuoteSummary } from '@/lib/gemini-api';
import { CustomerQuotePdf } from '@/components/quotes/CustomerQuotePdf';
import { ManufacturerQuotePdf } from '@/components/quotes/ManufacturerQuotePdf';
import { groupHardwareBySubcategory } from '@/lib/hardware-utils';
import type {
  Company,
  EstimateItem,
  EstimateOpeningWithItems,
  EstimateLine,
  ItemField,
  Quote,
  QuoteItem,
  QuoteType,
} from '@/types';

// ─── Local types ──────────────────────────────────────────────────────────────

interface EstimateItemWithFields extends EstimateItem {
  fields: ItemField[];
  /**
   * True for individual engine line detail items (one per estimate_line row).
   * These have a fake id and carry `openingQuantity` / the source engine line.
   */
  isEngineLineDetail?: boolean;
  /** The opening-level quantity multiplier (how many of this opening). */
  openingQuantity?: number;
  /** Source engine line for display metadata (layer, category, UOM). */
  engineLine?: EstimateLine;
}

interface LineItem {
  estimateItem: EstimateItemWithFields;
  unitCost: number;
  multiplier: number;
  unitPrice: number;
  /** Total for this line across all opening instances (unitPrice × qty × openingQty). */
  lineTotal: number;
}

/** Case-insensitive lookup of an item in the bulk markup overrides map. */
function findItemOverride(
  overrides: Record<string, number>,
  item: EstimateItemWithFields
): number | undefined {
  const label = item.itemLabel?.toLowerCase().trim();
  const code = item.canonicalCode?.toLowerCase().trim();
  for (const [key, val] of Object.entries(overrides)) {
    const k = key.toLowerCase().trim();
    if (k === label || (code && k === code)) return val;
  }
  return undefined;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MultiplierBadge({ multiplier }: { multiplier: number }) {
  const color =
    multiplier >= 1.4
      ? 'bg-red-100 text-red-700 border-red-200'
      : multiplier >= 1.2
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : 'bg-green-100 text-green-700 border-green-200';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${color}`}
    >
      <TrendingUp className="h-3 w-3" />
      {multiplier}×
    </span>
  );
}

interface CustomerLineItemsTableProps {
  items: LineItem[];
  currency: string;
  companyDefaultMultiplier: number;
  bulkOverrides: Record<string, number>;
  onUpdateMultiplier: (itemId: string, multiplier: number) => void;
}

function CustomerLineItemsTable({
  items,
  currency,
  companyDefaultMultiplier,
  bulkOverrides,
  onUpdateMultiplier,
}: CustomerLineItemsTableProps) {
  // Separate top-level items (doors/frames) from hardware children
  const topLevel = items.filter((i) => !i.estimateItem.parentItemId);
  const hwByParent = new Map<string, LineItem[]>();
  for (const i of items) {
    if (!i.estimateItem.parentItemId) continue;
    const list = hwByParent.get(i.estimateItem.parentItemId) ?? [];
    list.push(i);
    hwByParent.set(i.estimateItem.parentItemId, list);
  }
  // Items without a parent that also have no opening assignment (ungrouped)
  const ungrouped = items.filter(
    (i) => !i.estimateItem.parentItemId && !hwByParent.has(i.estimateItem.id)
  );

  let rowIdx = 0;

  const renderItemRow = (item: LineItem) => {
    const isEngine = item.estimateItem.isEngineOpening === true;
    const multiplierKey = isEngine ? (item.estimateItem.openingId ?? item.estimateItem.id) : item.estimateItem.id;
    const bulkOverride = isEngine ? undefined : findItemOverride(bulkOverrides, item.estimateItem);
    const isOverriddenFromDefault = item.multiplier !== companyDefaultMultiplier;
    const hasBulkOverride = bulkOverride !== undefined;
    const stripe = rowIdx++ % 2 === 0 ? 'bg-background' : 'bg-muted/20';

    const priceMeta = item.estimateItem.priceLookupMetadata;
    const snapshotDate = priceMeta?.computedAt ? new Date(priceMeta.computedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

    return (
      <tr key={item.estimateItem.id} className={stripe}>
        <td className="px-4 py-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{item.estimateItem.itemLabel}</span>
              {isEngine && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                  <Zap className="h-2.5 w-2.5" />
                  CPQ Engine
                </span>
              )}
            </div>
            {isEngine && (
              <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                <Layers className="h-2.5 w-2.5 shrink-0" />
                Doors, frame, hardware &amp; accessories rolled up — net cost ÷ markup = customer price
              </p>
            )}
            {!isEngine && item.estimateItem.priceSource === 'lookup' && snapshotDate && (
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                <Info className="h-2.5 w-2.5 shrink-0" />
                Pricing table snapshot {snapshotDate}
              </p>
            )}
            {!isEngine && item.estimateItem.priceSource === 'manual' && (
              <p className="text-[10px] text-amber-600 mt-0.5">Manual price override</p>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-center text-muted-foreground">
          {item.estimateItem.quantity}
        </td>
        <td className="px-4 py-3 text-right text-muted-foreground">
          {fmt(item.unitCost, currency)}
        </td>
        <td className="px-4 py-3 text-center">
          <div className="flex flex-col items-center gap-0.5">
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="0.01"
                step="0.05"
                value={item.multiplier}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v > 0) {
                    onUpdateMultiplier(multiplierKey, parseFloat(v.toFixed(2)));
                  }
                }}
                className={`w-16 rounded border px-1.5 py-0.5 text-center text-xs font-semibold focus:outline-none focus:ring-1 ${
                  isOverriddenFromDefault
                    ? 'border-amber-300 bg-amber-50 text-amber-900 focus:ring-amber-400'
                    : 'border-border bg-background text-foreground focus:ring-ring'
                }`}
              />
              <span className="text-xs text-muted-foreground">×</span>
            </div>
            {hasBulkOverride && (
              <span className="text-[10px] text-blue-600 font-medium">bulk</span>
            )}
            {!hasBulkOverride && isOverriddenFromDefault && (
              <button
                type="button"
                onClick={() => onUpdateMultiplier(multiplierKey, companyDefaultMultiplier)}
                className="text-[10px] text-muted-foreground underline hover:text-foreground"
              >
                reset
              </button>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          <span className="font-semibold text-foreground">
            {fmt(item.unitPrice, currency)}
          </span>
        </td>
        <td className="px-4 py-3 text-right font-semibold">
          {fmt(item.lineTotal, currency)}
        </td>
      </tr>
    );
  };

  const renderHardwareRows = (parentId: string) => {
    const hwItems = hwByParent.get(parentId) ?? [];
    if (!hwItems.length) return null;
    const groups = groupHardwareBySubcategory(
      hwItems.map((i) => ({ ...i, subcategory: i.estimateItem.subcategory }))
    );
    return groups.map((group) => (
      <>
        <tr key={`hdr-${parentId}-${group.key}`} className="bg-muted/5">
          <td
            colSpan={6}
            className="pl-8 pr-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-dashed"
          >
            <Wrench className="inline h-2.5 w-2.5 mr-1 opacity-60" />
            {group.label}
          </td>
        </tr>
        {group.items.map((groupItem) => {
          const item = groupItem as LineItem & { subcategory: LineItem['estimateItem']['subcategory'] };
          const bulkOverride = findItemOverride(bulkOverrides, item.estimateItem);
          const isOverriddenFromDefault = item.multiplier !== companyDefaultMultiplier;
          const hasBulkOverride = bulkOverride !== undefined;
          const stripe = rowIdx++ % 2 === 0 ? 'bg-background' : 'bg-muted/20';
          return (
            <tr key={item.estimateItem.id} className={stripe}>
              <td className="pl-10 pr-4 py-2.5">
                <span className="text-sm text-muted-foreground">{item.estimateItem.itemLabel}</span>
              </td>
              <td className="px-4 py-2.5 text-center text-muted-foreground text-sm">
                {item.estimateItem.quantity}
              </td>
              <td className="px-4 py-2.5 text-right text-muted-foreground text-sm">
                {fmt(item.unitCost, currency)}
              </td>
              <td className="px-4 py-2.5 text-center">
                <div className="flex flex-col items-center gap-0.5">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0.01"
                      step="0.05"
                      value={item.multiplier}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v > 0) {
                          onUpdateMultiplier(item.estimateItem.id, parseFloat(v.toFixed(2)));
                        }
                      }}
                      className={`w-16 rounded border px-1.5 py-0.5 text-center text-xs font-semibold focus:outline-none focus:ring-1 ${
                        isOverriddenFromDefault
                          ? 'border-amber-300 bg-amber-50 text-amber-900 focus:ring-amber-400'
                          : 'border-border bg-background text-foreground focus:ring-ring'
                      }`}
                    />
                    <span className="text-xs text-muted-foreground">×</span>
                  </div>
                  {hasBulkOverride && (
                    <span className="text-[10px] text-blue-600 font-medium">bulk</span>
                  )}
                  {!hasBulkOverride && isOverriddenFromDefault && (
                    <button
                      type="button"
                      onClick={() => onUpdateMultiplier(item.estimateItem.id, companyDefaultMultiplier)}
                      className="text-[10px] text-muted-foreground underline hover:text-foreground"
                    >
                      reset
                    </button>
                  )}
                </div>
              </td>
              <td className="px-4 py-2.5 text-right text-sm">
                <span className="font-medium text-foreground">{fmt(item.unitPrice, currency)}</span>
              </td>
              <td className="px-4 py-2.5 text-right text-sm font-medium">
                {fmt(item.lineTotal, currency)}
              </td>
            </tr>
          );
        })}
      </>
    ));
  };

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Item</th>
            <th className="px-4 py-3 text-center font-medium text-muted-foreground">Qty</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Cost</th>
            <th className="px-4 py-3 text-center font-medium text-muted-foreground">Markup</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Customer Price</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Line Total</th>
          </tr>
        </thead>
        <tbody>
          {topLevel.map((item) => (
            <>
              {renderItemRow(item)}
              {renderHardwareRows(item.estimateItem.id)}
            </>
          ))}
          {ungrouped.map((item) => renderItemRow(item))}
        </tbody>
      </table>
    </div>
  );
}

interface ManufacturerLineItemsTableProps {
  items: LineItem[];
  currency: string;
}

function ManufacturerItemCard({
  item,
  currency,
  isHardware = false,
}: {
  item: LineItem;
  currency: string;
  isHardware?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const hasFields = item.estimateItem.fields.length > 0;
  const lineCost = item.estimateItem.quantity * item.unitCost;

  return (
    <div className={`rounded-lg border overflow-hidden ${isHardware ? 'ml-6 border-dashed' : ''}`}>
      <div
        className={`flex items-center gap-3 px-4 py-3 bg-background ${hasFields ? 'cursor-pointer hover:bg-muted/30' : ''}`}
        onClick={() => hasFields && setIsOpen((v) => !v)}
      >
        <button
          type="button"
          className={`flex-none text-muted-foreground transition-transform ${!hasFields ? 'opacity-20 cursor-default' : ''}`}
          tabIndex={-1}
        >
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className={`font-medium truncate ${isHardware ? 'text-sm text-muted-foreground' : ''}`}>
            {item.estimateItem.itemLabel}
          </div>
          {item.estimateItem.canonicalCode && (
            <div className="text-xs text-muted-foreground font-mono mt-0.5">
              {item.estimateItem.canonicalCode}
            </div>
          )}
        </div>

        <div className="flex items-center gap-6 text-sm shrink-0">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Qty</div>
            <div className="font-medium">{item.estimateItem.quantity}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Unit Cost</div>
            <div className="font-medium">{fmt(item.unitCost, currency)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Line Total</div>
            <div className="font-semibold">{fmt(lineCost, currency)}</div>
          </div>
          {hasFields && (
            <Badge variant="outline" className="text-xs">
              <Wrench className="mr-1 h-3 w-3" />
              {item.estimateItem.fields.length} spec{item.estimateItem.fields.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </div>

      {isOpen && hasFields && (
        <div className="border-t bg-muted/5 px-4 py-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {item.estimateItem.fields.map((field) => (
              <div key={field.id} className="rounded-md bg-background border px-3 py-2">
                <div className="text-xs text-muted-foreground">{field.fieldLabel}</div>
                <div className="mt-0.5 text-sm font-medium truncate">{field.fieldValue}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ManufacturerLineItemsTable({ items, currency }: ManufacturerLineItemsTableProps) {
  const topLevel = items.filter((i) => !i.estimateItem.parentItemId);
  const hwByParent = new Map<string, LineItem[]>();
  for (const i of items) {
    if (!i.estimateItem.parentItemId) continue;
    const list = hwByParent.get(i.estimateItem.parentItemId) ?? [];
    list.push(i);
    hwByParent.set(i.estimateItem.parentItemId, list);
  }

  return (
    <div className="space-y-3">
      {topLevel.map((item) => {
        const hwItems = hwByParent.get(item.estimateItem.id) ?? [];
        const hwGroups = groupHardwareBySubcategory(
          hwItems.map((i) => ({ ...i, subcategory: i.estimateItem.subcategory }))
        );

        return (
          <div key={item.estimateItem.id} className="space-y-1">
            <ManufacturerItemCard item={item} currency={currency} />
            {hwGroups.map((group) => (
              <div key={group.key} className="ml-6 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pt-1 flex items-center gap-1">
                  <Wrench className="h-2.5 w-2.5 opacity-60" />
                  {group.label}
                </p>
                {group.items.map((groupItem) => {
                  const hwItem = groupItem as LineItem & { subcategory: LineItem['estimateItem']['subcategory'] };
                  return (
                    <ManufacturerItemCard
                      key={hwItem.estimateItem.id}
                      item={hwItem}
                      currency={currency}
                      isHardware
                    />
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── EngineOpeningsPanel ─────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Full build spec display
// ---------------------------------------------------------------------------

const DOOR_SPEC_DISPLAY: { key: string; label: string }[] = [
  { key: 'door.door_series_construction', label: 'Series / Construction' },
  { key: 'door.nominal_door_width', label: 'Width' },
  { key: 'door.nominal_door_height', label: 'Height' },
  { key: 'door.door_gauge', label: 'Gauge (ga)' },
  { key: 'door.core_type', label: 'Core Construction' },
  { key: 'door.door_face_elevation_style', label: 'Face / Elevation Style' },
  { key: 'door.door_material', label: 'Material' },
  { key: 'door.edge_seam_construction', label: 'Edge / Seam' },
  { key: 'door.door_hand', label: 'Hand' },
  { key: 'door.leaf_activity', label: 'Leaf Activity' },
  { key: 'door.door_label_required_specific_designation', label: 'Fire Label' },
  { key: 'door.hinge_preparation_type', label: 'Hinge Prep' },
  { key: 'door.hinge_quantity', label: 'Hinge Qty' },
  { key: 'door.primary_lock_exit_device_preparation', label: 'Lock / Exit Prep' },
  { key: 'door.closer_holder_preparation', label: 'Closer Prep' },
  { key: 'door.louver_code_size', label: 'Louver' },
  { key: 'door.louver_material_classification', label: 'Louver Material' },
  { key: 'door.door_thickness', label: 'Thickness' },
];

const FRAME_SPEC_DISPLAY: { key: string; label: string }[] = [
  { key: 'frame.frame_series', label: 'Series' },
  { key: 'frame.frame_series_construction', label: 'Construction' },
  { key: 'frame.frame_type', label: 'Frame Type' },
  { key: 'frame.nominal_frame_width', label: 'Width' },
  { key: 'frame.nominal_frame_height', label: 'Height' },
  { key: 'frame.frame_gauge', label: 'Gauge (ga)' },
  { key: 'frame.jamb_depth', label: 'Jamb Depth' },
  { key: 'frame.frame_material', label: 'Material' },
  { key: 'frame.rabbet_type', label: 'Rabbet' },
  { key: 'frame.frame_hand', label: 'Hand' },
  { key: 'frame.frame_label_required_designation', label: 'Fire Label' },
  { key: 'frame.hinge_locations', label: 'Hinge Locations' },
  { key: 'frame.hinge_preparation_type', label: 'Hinge Prep' },
  { key: 'frame.hinge_quantity', label: 'Hinge Qty' },
  { key: 'frame.primary_strike_location', label: 'Strike Location' },
  { key: 'frame.primary_strike_preparation', label: 'Strike Prep' },
  { key: 'frame.closer_holder_coordinator_preparation', label: 'Closer / Coord. Prep' },
  { key: 'frame.silencer_qty', label: 'Silencers' },
];

interface BuildSpecPanelProps {
  doorFields: Record<string, string>;
  frameFields: Record<string, string>;
}

function BuildSpecPanel({ doorFields, frameFields }: BuildSpecPanelProps) {
  const hasDoor = DOOR_SPEC_DISPLAY.some(({ key }) => doorFields[key]);
  const hasFrame = FRAME_SPEC_DISPLAY.some(({ key }) => frameFields[key]);
  if (!hasDoor && !hasFrame) return null;

  return (
    <div className="border-t border-blue-100 bg-blue-50/40 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-700 mb-2">Build Specification</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Door spec */}
        {hasDoor && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/60" />
              Door
            </p>
            <dl className="space-y-0.5">
              {DOOR_SPEC_DISPLAY.filter(({ key }) => doorFields[key]).map(({ key, label }) => (
                <div key={key} className="flex items-baseline gap-1.5 text-xs">
                  <dt className="text-muted-foreground shrink-0 min-w-[120px]">{label}</dt>
                  <dd className="font-medium text-foreground">{doorFields[key]}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {/* Frame spec */}
        {hasFrame && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/60" />
              Frame
            </p>
            <dl className="space-y-0.5">
              {FRAME_SPEC_DISPLAY.filter(({ key }) => frameFields[key]).map(({ key, label }) => (
                <div key={key} className="flex items-baseline gap-1.5 text-xs">
                  <dt className="text-muted-foreground shrink-0 min-w-[120px]">{label}</dt>
                  <dd className="font-medium text-foreground">{frameFields[key]}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

// Human-readable labels for matched_condition field keys.
const SPEC_FIELD_LABELS: Record<string, string> = {
  'door.door_series_construction': 'Series',
  'door.door_material': 'Material',
  'door.nominal_door_width': 'Width',
  'door.nominal_door_height': 'Height',
  'door.door_gauge': 'Gauge',
  'door.door_face_elevation_style': 'Face',
  'door.fire_label': 'Fire label',
  'door.core_type': 'Core',
  'door.door_thickness': 'Thickness',
  'frame.frame_series': 'Series',
  'frame.frame_series_construction': 'Series',
  'frame.frame_gauge': 'Gauge',
  'frame.jamb_depth': 'Jamb',
  'frame.nominal_frame_width': 'Width',
  'frame.frame_profile': 'Profile',
  'frame.wall_type': 'Wall',
};

/** Extract formatted spec chips from engine line matched_conditions. */
function getSpecChips(conditions: Record<string, unknown>): { key: string; label: string; value: string }[] {
  return Object.entries(conditions)
    .filter(([key]) => SPEC_FIELD_LABELS[key])
    .map(([key, val]) => ({ key, label: SPEC_FIELD_LABELS[key], value: String(val) }));
}

/**
 * Build a one-line spec summary for the opening header from the door + frame
 * BASE line matched_conditions. E.g. "Series H · 3-0×7-0 · Galvannealed · Frame F · 16ga KD"
 */
function buildOpeningSpecSummary(lines: EstimateLine[]): string {
  const doorBase = lines.find((l) => l.entityType === 'door' && l.lineType === 'BASE');
  const frameBase = lines.find((l) => l.entityType === 'frame' && l.lineType === 'BASE');
  const parts: string[] = [];

  if (doorBase?.matchedConditions) {
    const c = doorBase.matchedConditions as Record<string, unknown>;
    const series = c['door.door_series_construction'];
    const w = c['door.nominal_door_width'];
    const h = c['door.nominal_door_height'];
    const mat = c['door.door_material'];
    if (series) parts.push(`Series ${series}`);
    if (w && h) parts.push(`${w}×${h}`);
    if (mat && String(mat).toLowerCase() !== 'steel') parts.push(String(mat));
  }

  if (frameBase?.matchedConditions) {
    const c = frameBase.matchedConditions as Record<string, unknown>;
    const series = c['frame.frame_series'] ?? c['frame.frame_series_construction'];
    const gauge = c['frame.frame_gauge'];
    const jamb = c['frame.jamb_depth'];
    if (series) parts.push(`Frame ${series}`);
    if (gauge) parts.push(`${gauge}ga`);
    if (jamb) parts.push(`${jamb}" jamb`);
  }

  return parts.join(' · ');
}

const LAYER_LABELS: Record<string, string> = {
  pioneer_base: 'Door / Frame / Panel (base)',
  pioneer_adders: 'Options & adders',
  pioneer_preps: 'Preparations',
  ngp_infill: 'NGP infill (glass / lite kits / louvers)',
  hardware: 'Hardware',
  linear: 'Linear accessories',
  keying: 'Keying',
  access_control: 'Access control',
  services: 'Services / freight / tax',
};

function classifyEngineLayer(entityType: string | null, chargeCategory: string | null): string {
  const cat = (chargeCategory ?? '').toLowerCase();
  const ent = entityType ?? '';
  if (ent === 'prep' || cat === 'prep') return 'pioneer_preps';
  if (['lite_kit', 'louver', 'glass', 'glazing_tape'].includes(ent) || cat === 'ngp_policy') return 'ngp_infill';
  if (cat === 'keying') return 'keying';
  if (cat === 'access_control') return 'access_control';
  if (['install', 'labor', 'wiring', 'glazing', 'freight', 'packaging', 'tax', 'commissioning', 'field_work'].includes(cat)) return 'services';
  if (ent === 'hardware') return cat.includes('linear') ? 'linear' : 'hardware';
  if (['door', 'frame', 'panel', 'stick', 'specialty', 'anchor', 'packaging'].includes(ent)) {
    return ['BASE'].includes('BASE') ? 'pioneer_base' : 'pioneer_adders';
  }
  return 'pioneer_adders';
}

interface EngineOpeningsPanelProps {
  openings: EstimateOpeningWithItems[];
  linesByOpening: Map<string, EstimateLine[]>;
  openingSpecMap: Map<string, { door: Record<string, string>; frame: Record<string, string> }>;
  lineItems: LineItem[];
  itemMultipliers: Record<string, number>;
  companyDefaultMultiplier: number;
  onUpdateMultiplier: (key: string, value: number) => void;
  onQuantityChange: (openingId: string, qty: number) => Promise<void>;
  currency: string;
}

function EngineOpeningsPanel({
  openings,
  linesByOpening,
  openingSpecMap,
  lineItems,
  itemMultipliers,
  companyDefaultMultiplier,
  onUpdateMultiplier,
  onQuantityChange,
  currency,
}: EngineOpeningsPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [updatingQty, setUpdatingQty] = useState<Record<string, boolean>>({});

  const engineOpenings = openings.filter((o) => (linesByOpening.get(o.id) ?? []).length > 0);
  if (engineOpenings.length === 0) return null;

  return (
    <div className="space-y-4">
      {engineOpenings.map((opening) => {
        const isOpen = expanded[opening.id] !== false;
        const openingLines = linesByOpening.get(opening.id) ?? [];
        const openingItems = lineItems.filter((li) => li.estimateItem.openingId === opening.id);
        const openingUnitSubtotal = openingItems.reduce((s, li) => s + li.unitPrice * li.estimateItem.quantity, 0);
        const openingTotal = openingUnitSubtotal * opening.quantity;
        const multiplier = itemMultipliers[opening.id] ?? companyDefaultMultiplier;
        const isOverridden = multiplier !== companyDefaultMultiplier;
        const specSummary = buildOpeningSpecSummary(openingLines);
        const openingSpec = openingSpecMap.get(opening.id);

        // Group lines by layer
        const byLayer: Record<string, LineItem[]> = {};
        for (const li of openingItems) {
          const layer = classifyEngineLayer(
            li.estimateItem.engineLine?.entityType ?? null,
            li.estimateItem.engineLine?.chargeCategory ?? null,
          );
          if (!byLayer[layer]) byLayer[layer] = [];
          byLayer[layer].push(li);
        }
        const layerOrder = Object.keys(LAYER_LABELS);

        const handleQtyStep = async (e: React.MouseEvent, delta: number) => {
          e.stopPropagation();
          const next = Math.max(1, opening.quantity + delta);
          if (next === opening.quantity) return;
          setUpdatingQty((prev) => ({ ...prev, [opening.id]: true }));
          try {
            await onQuantityChange(opening.id, next);
          } finally {
            setUpdatingQty((prev) => ({ ...prev, [opening.id]: false }));
          }
        };

        return (
          <div key={opening.id} className="rounded-lg border overflow-hidden">
            {/* Opening header */}
            <div
              className="flex items-center gap-3 px-4 py-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => setExpanded((prev) => ({ ...prev, [opening.id]: !isOpen }))}
            >
              {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}

              {/* Name + spec summary */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{opening.name}</span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                    <Zap className="h-2.5 w-2.5" />
                    CPQ Engine
                  </span>
                </div>
                {specSummary && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{specSummary}</p>
                )}
              </div>

              {/* Quantity stepper — stop propagation so click doesn't toggle expand */}
              <div
                className="flex items-center gap-1.5 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="text-xs text-muted-foreground hidden sm:block">Qty</span>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40"
                  disabled={opening.quantity <= 1 || updatingQty[opening.id]}
                  onClick={(e) => handleQtyStep(e, -1)}
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="w-6 text-center text-sm font-semibold tabular-nums">
                  {updatingQty[opening.id] ? <Loader2 className="h-3 w-3 animate-spin mx-auto" /> : opening.quantity}
                </span>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground"
                  disabled={updatingQty[opening.id]}
                  onClick={(e) => handleQtyStep(e, +1)}
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>

              {/* Per-opening markup */}
              <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                <span className="text-xs text-muted-foreground hidden sm:block">Markup</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.05"
                  value={multiplier}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v > 0) onUpdateMultiplier(opening.id, parseFloat(v.toFixed(2)));
                  }}
                  className={`w-16 rounded border px-1.5 py-1 text-center text-xs font-semibold focus:outline-none focus:ring-1 ${
                    isOverridden
                      ? 'border-amber-300 bg-amber-50 text-amber-900 focus:ring-amber-400'
                      : 'border-border bg-background text-foreground focus:ring-ring'
                  }`}
                  title="Markup multiplier for this opening"
                />
                <span className="text-xs text-muted-foreground">×</span>
              </div>

              {/* Opening total */}
              <div className="text-right shrink-0 min-w-[90px]" onClick={(e) => e.stopPropagation()}>
                <p className="text-sm font-bold tabular-nums">{fmt(openingTotal, currency)}</p>
                {opening.quantity > 1 && (
                  <p className="text-[10px] text-muted-foreground">{fmt(openingUnitSubtotal, currency)} × {opening.quantity}</p>
                )}
              </div>
            </div>

            {/* Engine line detail */}
            {isOpen && (
              <div>
                {/* Full build specification panel */}
                {openingSpec && (
                  <BuildSpecPanel
                    doorFields={openingSpec.door}
                    frameFields={openingSpec.frame}
                  />
                )}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/10 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 text-left w-full">Description &amp; Spec</th>
                      <th className="px-3 py-2 text-center whitespace-nowrap">Qty</th>
                      <th className="px-3 py-2 text-right whitespace-nowrap">Net / unit</th>
                      <th className="px-3 py-2 text-center whitespace-nowrap">Markup</th>
                      <th className="px-3 py-2 text-right whitespace-nowrap">Sell / unit</th>
                      <th className="px-3 py-2 text-right whitespace-nowrap">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {layerOrder
                      .filter((layer) => byLayer[layer]?.length)
                      .map((layer) => (
                        <>
                          {/* Layer sub-header */}
                          <tr key={`layer-${layer}`} className="bg-muted/5 border-t border-dashed">
                            <td colSpan={6} className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              {LAYER_LABELS[layer] ?? layer}
                            </td>
                          </tr>
                          {byLayer[layer].map((li) => {
                            const line = li.estimateItem.engineLine;
                            const uom = line?.unitOfMeasure ? `/${line.unitOfMeasure}` : '';
                            const hasException = line?.priceStatus === 'INVALID' || line?.priceStatus === 'CONTACT_FACTORY' || line?.priceStatus === 'EXTERNAL_PENDING';
                            const specChips = line?.matchedConditions
                              ? getSpecChips(line.matchedConditions as Record<string, unknown>)
                              : [];
                            return (
                              <tr key={li.estimateItem.id} className="border-t border-muted/30 hover:bg-muted/10">
                                <td className="px-4 py-2.5">
                                  <div>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className={`font-medium ${hasException ? 'text-destructive' : ''}`}>
                                        {li.estimateItem.itemLabel}
                                      </span>
                                      {li.estimateItem.canonicalCode && (
                                        <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1 rounded">
                                          {li.estimateItem.canonicalCode}
                                        </span>
                                      )}
                                      {hasException && (
                                        <span className="text-[10px] font-medium text-destructive bg-destructive/10 px-1 rounded">
                                          {line?.priceStatus}
                                        </span>
                                      )}
                                      {(line as EstimateLine & { isManualOverride?: boolean })?.isManualOverride && (
                                        <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1 rounded">
                                          manual override
                                        </span>
                                      )}
                                    </div>
                                    {/* Spec chips from matched_conditions */}
                                    {specChips.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1.5">
                                        {specChips.map(({ key, label, value }) => (
                                          <span
                                            key={key}
                                            className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                          >
                                            <span className="font-semibold text-foreground/70">{label}:</span>
                                            <span>{value}</span>
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 text-center text-muted-foreground tabular-nums align-top pt-3">
                                  {li.estimateItem.quantity}{uom}
                                </td>
                                <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums align-top pt-3">
                                  {fmt(li.unitCost, currency)}
                                </td>
                                <td className="px-3 py-2.5 text-center align-top pt-3">
                                  <MultiplierBadge multiplier={li.multiplier} />
                                </td>
                                <td className="px-3 py-2.5 text-right font-medium tabular-nums align-top pt-3">
                                  {fmt(li.unitPrice, currency)}
                                </td>
                                <td className="px-3 py-2.5 text-right font-semibold tabular-nums align-top pt-3">
                                  {fmt(li.lineTotal, currency)}
                                </td>
                              </tr>
                            );
                          })}
                        </>
                      ))}
                  </tbody>
                </table>

                {/* Opening subtotal footer */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20 border-t text-sm font-semibold">
                  <span className="text-muted-foreground text-xs">
                    {opening.quantity > 1 ? 'Unit subtotal (1 opening)' : 'Opening subtotal'}
                  </span>
                  <span className="tabular-nums">{fmt(openingUnitSubtotal, currency)}</span>
                </div>
                {opening.quantity > 1 && (
                  <div className="flex items-center justify-between px-4 py-2.5 bg-primary/5 border-t text-sm font-bold">
                    <span className="text-xs">Opening total × {opening.quantity}</span>
                    <span className="tabular-nums">{fmt(openingTotal, currency)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function QuoteBuilderPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { user } = useAuth();

  const estimateId = searchParams.get('estimateId');
  const customerId = searchParams.get('customerId');
  const quoteType = (searchParams.get('quoteType') ?? 'customer') as QuoteType;

  // ── State ──────────────────────────────────────────────────────────────────
  const [estimateItems, setEstimateItems] = useState<EstimateItemWithFields[]>([]);
  const [openings, setOpenings] = useState<EstimateOpeningWithItems[]>([]);
  const [linesByOpening, setLinesByOpening] = useState<Map<string, EstimateLine[]>>(new Map());
  const [quotableOpenings, setQuotableOpenings] = useState<QuotableOpening[]>([]);
  // Per-opening spec: door fields + frame fields loaded from item_fields.
  const [openingSpecMap, setOpeningSpecMap] = useState<Map<string, { door: Record<string, string>; frame: Record<string, string> }>>(new Map());
  const [company, setCompany] = useState<Company | null>(null);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloadingCustomer, setIsDownloadingCustomer] = useState(false);
  const [isDownloadingManufacturer, setIsDownloadingManufacturer] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [savedQuote, setSavedQuote] = useState<Quote | null>(null);
  const [previewType, setPreviewType] = useState<'customer' | 'manufacturer' | null>(null);
  const [previewAiSummary, setPreviewAiSummary] = useState<string | null>(null);
  const [isGeneratingPreviewSummary, setIsGeneratingPreviewSummary] = useState(false);
  // Per-item multipliers: keyed by estimateItem.id (legacy) or opening.id (engine)
  const [itemMultipliers, setItemMultipliers] = useState<Record<string, number>>({});
  // Bulk markup overrides stored on the company (for display hints)
  const [bulkOverrides, setBulkOverrides] = useState<Record<string, number>>({});
  // Pricing table refresh state
  const [refreshingPrices, setRefreshingPrices] = useState(false);

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!estimateId) {
      navigate('/app/estimates');
      return;
    }

    const load = async () => {
      try {
        const [result, engineLines] = await Promise.all([
          getEstimateWithItems(estimateId),
          loadEstimateLinesByOpening(estimateId).catch(() => new Map<string, EstimateLine[]>()),
        ]);
        if (!result) {
          toast({
            title: 'Estimate not found',
            variant: 'destructive',
          });
          navigate('/app/estimates');
          return;
        }
        const items = result.items;
        setEstimateItems(items);
        setOpenings(result.openings ?? []);
        setLinesByOpening(engineLines);

        // Build quotable openings from engine lines (one per opening that has them).
        const qo = buildQuotableOpenings(result.openings ?? [], engineLines);
        setQuotableOpenings(qo);

        // Load item_fields for all top-level opening components (door / frame).
        // This gives the full build spec (core, face elevation, preps, etc.) for display.
        const { data: specItemRows } = await supabase
          .from('estimate_items')
          .select('id, opening_id, item_type, item_fields(field_key, field_value)')
          .eq('estimate_id', estimateId)
          .is('parent_item_id', null)
          .not('opening_id', 'is', null);

        const specMap = new Map<string, { door: Record<string, string>; frame: Record<string, string> }>();
        for (const row of specItemRows ?? []) {
          const openingId = row.opening_id as string;
          if (!specMap.has(openingId)) specMap.set(openingId, { door: {}, frame: {} });
          const entry = specMap.get(openingId)!;
          const fields: Record<string, string> = {};
          for (const f of (row.item_fields as Array<{ field_key: string; field_value: string }> ?? [])) {
            if (f.field_value) fields[f.field_key] = f.field_value;
          }
          if (row.item_type === 'doors' || row.item_type === 'door') {
            Object.assign(entry.door, fields);
          } else if (row.item_type === 'frames' || row.item_type === 'frame') {
            Object.assign(entry.frame, fields);
          }
        }
        setOpeningSpecMap(specMap);

        // Set keyed by opening.id for engine openings, estimateItem.id for legacy.
        const engineOpeningIds = new Set(qo.map((q) => q.openingId));

        if (customerId) {
          const co = await getCompany(customerId);
          setCompany(co);
          if (co) {
            const defaultMult = co.settings?.costMultiplier ?? 1.0;
            const overrides: Record<string, number> = co.settings?.markupOverrides ?? {};
            setBulkOverrides(overrides);
            const initMultipliers: Record<string, number> = {};
            // Engine openings keyed by openingId
            for (const qOpening of qo) {
              initMultipliers[qOpening.openingId] = defaultMult;
            }
            // Legacy items keyed by itemId (skip items whose opening is engine-priced)
            for (const item of items) {
              if (item.openingId && engineOpeningIds.has(item.openingId)) continue;
              const override = findItemOverride(overrides, item);
              initMultipliers[item.id] = override ?? defaultMult;
            }
            setItemMultipliers(initMultipliers);
          }
        } else {
          const initMultipliers: Record<string, number> = {};
          for (const qOpening of qo) initMultipliers[qOpening.openingId] = 1.0;
          for (const item of items) {
            if (item.openingId && engineOpeningIds.has(item.openingId)) continue;
            initMultipliers[item.id] = 1.0;
          }
          setItemMultipliers(initMultipliers);
        }
      } catch (err) {
        console.error(err);
        toast({
          title: 'Failed to load estimate',
          description: err instanceof Error ? err.message : undefined,
          variant: 'destructive',
        });
        navigate('/app/estimates');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [estimateId, customerId, navigate, toast]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const companyDefaultMultiplier = company?.settings?.costMultiplier ?? 1.0;

  /** Set of opening IDs that have engine lines (engine-priced path). */
  const engineOpeningIds = useMemo(
    () => new Set(quotableOpenings.map((q) => q.openingId)),
    [quotableOpenings],
  );

  const lineItems = useMemo<LineItem[]>(() => {
    const result: LineItem[] = [];

    // 1. Engine-priced openings → one LineItem per visible engine line.
    for (const opening of openings) {
      const lines = linesByOpening.get(opening.id) ?? [];
      if (lines.length === 0) continue;
      const multiplier = itemMultipliers[opening.id] ?? companyDefaultMultiplier;
      const visibleLines = lines.filter((l) => !l.includedOrSuppressedBy && l.lineType !== 'INCLUDED');
      for (const line of visibleLines) {
        const lineQty = Math.max(1, line.quantity ?? 1);
        const unitNetCost = (line.extendedNetPrice ?? 0) / lineQty;
        const unitPrice = parseFloat((unitNetCost * multiplier).toFixed(2));
        const syntheticItem: EstimateItemWithFields = {
          id: `engine-line:${line.id}`,
          estimateId: estimateId ?? '',
          itemLabel: line.description ?? line.chargeCategory ?? 'Line item',
          canonicalCode: line.selectedOptionCode ?? null,
          quantity: lineQty,
          unitPrice: unitNetCost,
          sortOrder: line.sortOrder,
          manufacturerId: null,
          openingId: opening.id,
          parentItemId: null,
          subcategory: null,
          itemType: line.entityType as string | null,
          priceSource: null,
          priceLookupMetadata: null,
          isManualPriceOverride: false,
          createdAt: line.createdAt,
          fields: [],
          isEngineLineDetail: true,
          openingQuantity: opening.quantity,
          engineLine: line,
        };
        result.push({
          estimateItem: syntheticItem,
          unitCost: unitNetCost,
          multiplier,
          unitPrice,
          lineTotal: parseFloat((unitPrice * lineQty * opening.quantity).toFixed(2)),
        });
      }
    }

    // 2. Legacy items whose opening is NOT engine-priced.
    for (const ei of estimateItems) {
      if (ei.openingId && engineOpeningIds.has(ei.openingId)) continue;
      const unitCost = ei.unitPrice ?? 0;
      const multiplier = itemMultipliers[ei.id] ?? companyDefaultMultiplier;
      const unitPrice = parseFloat((unitCost * multiplier).toFixed(2));
      result.push({
        estimateItem: ei,
        unitCost,
        multiplier,
        unitPrice,
        lineTotal: parseFloat((ei.quantity * unitPrice).toFixed(2)),
      });
    }

    return result;
  }, [openings, linesByOpening, estimateItems, engineOpeningIds, itemMultipliers, companyDefaultMultiplier, estimateId]);

  // ── Per-item multiplier callbacks ──────────────────────────────────────────
  const handleUpdateMultiplier = useCallback((itemId: string, multiplier: number) => {
    setItemMultipliers((prev) => ({ ...prev, [itemId]: multiplier }));
  }, []);

  const handleApplyToAll = useCallback((multiplier: number) => {
    setItemMultipliers((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) next[key] = multiplier;
      return next;
    });
  }, []);

  const handleResetToDefaults = useCallback(() => {
    setItemMultipliers(() => {
      const next: Record<string, number> = {};
      // Engine openings
      for (const qo of quotableOpenings) {
        next[qo.openingId] = companyDefaultMultiplier;
      }
      // Legacy items
      for (const item of estimateItems) {
        if (item.openingId && engineOpeningIds.has(item.openingId)) continue;
        const override = findItemOverride(bulkOverrides, item);
        next[item.id] = override ?? companyDefaultMultiplier;
      }
      return next;
    });
  }, [quotableOpenings, estimateItems, engineOpeningIds, bulkOverrides, companyDefaultMultiplier]);

  // Opening quantity change from within the quote builder.
  const handleOpeningQuantityChange = useCallback(async (openingId: string, qty: number) => {
    await updateEstimateOpening(openingId, { quantity: qty });
    setOpenings((prev) => prev.map((o) => (o.id === openingId ? { ...o, quantity: qty } : o)));
  }, []);

  // Refresh pricing: engine openings via the rule engine, legacy items via pricing tables.
  const handleRefreshPricingTables = useCallback(async () => {
    setRefreshingPrices(true);
    try {
      if (quotableOpenings.length > 0) {
        // Engine path: re-price through the rule engine (handles both spec and legacy openings).
        const priced = await priceEstimate(estimateId, { persist: true });
        const updatedLines = await loadEstimateLinesByOpening(estimateId).catch(() => new Map<string, EstimateLine[]>());
        const qo = buildQuotableOpenings(openings, updatedLines);
        setLinesByOpening(updatedLines);
        setQuotableOpenings(qo);
        const updated = await getEstimateWithItems(estimateId);
        if (updated) setEstimateItems(updated.items);
        toast({
          title: 'Prices refreshed',
          description: `${priced.refreshSummary?.updated ?? 0} opening${(priced.refreshSummary?.updated ?? 0) !== 1 ? 's' : ''} re-priced via the rule engine.`,
        });
      } else {
        // Legacy path: grid pricing lookup.
        const result = await refreshEstimatePricing(estimateId);
        const updated = await getEstimateWithItems(estimateId);
        if (updated) setEstimateItems(updated.items);
        toast({
          title: 'Prices refreshed',
          description: `${result.updated} item price${result.updated !== 1 ? 's' : ''} updated from pricing tables.`,
        });
      }
    } catch (err) {
      toast({
        title: 'Refresh failed',
        description: err instanceof Error ? err.message : 'Could not refresh pricing.',
        variant: 'destructive',
      });
    } finally {
      setRefreshingPrices(false);
    }
  }, [estimateId, quotableOpenings, openings, toast]);

  const subtotal = useMemo(
    () => lineItems.reduce((sum, li) => sum + li.lineTotal, 0),
    [lineItems]
  );

  const total = subtotal;

  const costSubtotal = useMemo(
    () =>
      lineItems.reduce((sum, li) => {
        const openingQty = li.estimateItem.openingQuantity ?? 1;
        return sum + li.estimateItem.quantity * li.unitCost * openingQty;
      }, 0),
    [lineItems]
  );

  // Effective "global" multiplier for quote-level field (ratio of totals, or default)
  const effectiveMarkupMultiplier =
    costSubtotal > 0 ? parseFloat((subtotal / costSubtotal).toFixed(4)) : companyDefaultMultiplier;

  // ── Build quote items for Supabase ─────────────────────────────────────────
  const buildQuoteItems = useCallback(
    () =>
      lineItems.map((li, idx) => {
        const isEngLine = li.estimateItem.isEngineLineDetail === true;
        const openingQty = li.estimateItem.openingQuantity ?? 1;
        const saveQty = isEngLine ? li.estimateItem.quantity * openingQty : li.estimateItem.quantity;
        const saveLineTotal = parseFloat((li.unitPrice * saveQty).toFixed(2));
        return {
          estimateItemId: isEngLine ? null : li.estimateItem.id,
          itemLabel: li.estimateItem.itemLabel,
          canonicalCode: li.estimateItem.canonicalCode ?? null,
          quantity: saveQty,
          unitCost: li.unitCost,
          unitPrice: li.unitPrice,
          lineTotal: saveLineTotal,
          sortOrder: idx,
        };
      }),
    [lineItems]
  );

  // ── Save quote ─────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!estimateId || !user) return;
    setIsSaving(true);
    try {
      // CPQ gate: block quoting non-buildable configurations (Phase 4).
      await assertEstimateBuildable(estimateId);
      const quote = await createQuote({
        estimateId,
        companyId: customerId ?? null,
        createdByUserId: user.id,
        quoteType,
        markupMultiplier: effectiveMarkupMultiplier,
        subtotal,
        total,
        notes: notes.trim() || null,
        items: buildQuoteItems(),
      });
      setSavedQuote(quote);
      toast({
        title: 'Quote saved',
        description: `Quote Q-${quote.id.slice(-8).toUpperCase()} saved as draft.`,
      });
      navigate('/app/quotes');
    } catch (err) {
      toast({
        title: 'Failed to save quote',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }, [estimateId, user, customerId, quoteType, effectiveMarkupMultiplier, subtotal, total, notes, buildQuoteItems, toast, navigate]);

  // ── PDF helpers ────────────────────────────────────────────────────────────
  const buildQuoteForPdf = useCallback((): Quote => {
    const now = new Date().toISOString();
    const base = savedQuote ?? {
      id: `preview-${Date.now()}`,
      estimateId: estimateId ?? '',
      companyId: customerId ?? null,
      createdByUserId: user?.id ?? '',
      status: 'draft' as const,
      quoteType,
      markupMultiplier: effectiveMarkupMultiplier,
      subtotal,
      total,
      currency: 'USD',
      notes: notes.trim() || null,
      pricedAsOf: null,
      createdAt: now,
      updatedAt: now,
    };
    return base;
  }, [savedQuote, estimateId, customerId, user, quoteType, effectiveMarkupMultiplier, subtotal, total, notes]);

  const buildQuoteItemsForPdf = useCallback((): QuoteItem[] => {
    const now = new Date().toISOString();
    return lineItems.map((li, idx) => {
      const isEngLine = li.estimateItem.isEngineLineDetail === true;
      const openingQty = li.estimateItem.openingQuantity ?? 1;
      const saveQty = isEngLine ? li.estimateItem.quantity * openingQty : li.estimateItem.quantity;
      return {
        id: isEngLine ? (li.estimateItem.engineLine?.id ?? li.estimateItem.id) : li.estimateItem.id,
        quoteId: savedQuote?.id ?? 'preview',
        estimateItemId: isEngLine ? null : li.estimateItem.id,
        itemLabel: li.estimateItem.itemLabel,
        canonicalCode: li.estimateItem.canonicalCode ?? null,
        quantity: saveQty,
        unitCost: li.unitCost,
        unitPrice: li.unitPrice,
        lineTotal: parseFloat((li.unitPrice * saveQty).toFixed(2)),
        sortOrder: idx,
        createdAt: now,
      };
    });
  }, [lineItems, savedQuote]);

  // ── Reactive PDF data for live preview ────────────────────────────────────
  const pdfQuote = useMemo((): Quote => {
    const now = new Date().toISOString();
    if (savedQuote) return savedQuote;
    return {
      id: `preview-${estimateId}`,
      estimateId: estimateId ?? '',
      companyId: customerId ?? null,
      createdByUserId: user?.id ?? '',
      status: 'draft' as const,
      quoteType,
      markupMultiplier: effectiveMarkupMultiplier,
      subtotal,
      total,
      currency: 'USD',
      notes: notes.trim() || null,
      pricedAsOf: null,
      createdAt: now,
      updatedAt: now,
    };
  }, [savedQuote, estimateId, customerId, user?.id, quoteType, effectiveMarkupMultiplier, subtotal, total, notes]);

  const pdfItems = useMemo((): QuoteItem[] => {
    const now = new Date().toISOString();
    return lineItems.map((li, idx) => {
      const isEngLine = li.estimateItem.isEngineLineDetail === true;
      const openingQty = li.estimateItem.openingQuantity ?? 1;
      const saveQty = isEngLine ? li.estimateItem.quantity * openingQty : li.estimateItem.quantity;
      return {
        id: isEngLine ? (li.estimateItem.engineLine?.id ?? li.estimateItem.id) : li.estimateItem.id,
        quoteId: savedQuote?.id ?? 'preview',
        estimateItemId: isEngLine ? null : li.estimateItem.id,
        itemLabel: li.estimateItem.itemLabel,
        canonicalCode: li.estimateItem.canonicalCode ?? null,
        quantity: saveQty,
        unitCost: li.unitCost,
        unitPrice: li.unitPrice,
        lineTotal: parseFloat((li.unitPrice * saveQty).toFixed(2)),
        sortOrder: idx,
        createdAt: now,
      };
    });
  }, [lineItems, savedQuote?.id]);

  const pdfManufacturerItems = useMemo(
    () =>
      pdfItems.map((qi, idx) => ({
        ...qi,
        fields: lineItems[idx]?.estimateItem.fields ?? [],
      })),
    [pdfItems, lineItems]
  );

  const handlePreviewCustomer = useCallback(async () => {
    setPreviewAiSummary(null);
    setPreviewType('customer');
    setIsGeneratingPreviewSummary(true);
    try {
      const summary = await generateQuoteSummary({
        companyName: company?.name ?? null,
        items: pdfItems.map((i) => ({
          label: i.itemLabel,
          quantity: i.quantity,
          lineTotal: i.lineTotal,
        })),
        total: pdfQuote.total,
        currency: pdfQuote.currency,
        notes: pdfQuote.notes,
      });
      setPreviewAiSummary(summary);
    } catch (err) {
      console.warn('Preview AI summary failed:', err);
      setPreviewAiSummary(null);
    } finally {
      setIsGeneratingPreviewSummary(false);
    }
  }, [company, pdfItems, pdfQuote]);

  const handleDownloadCustomer = useCallback(async () => {
    setIsDownloadingCustomer(true);
    try {
      const quote = buildQuoteForPdf();
      const items = buildQuoteItemsForPdf();

      let aiSummary: string | null = null;
      try {
        aiSummary = await generateQuoteSummary({
          companyName: company?.name ?? null,
          items: items.map((i) => ({
            label: i.itemLabel,
            quantity: i.quantity,
            lineTotal: i.lineTotal,
          })),
          total: quote.total,
          currency: quote.currency,
          notes: quote.notes,
        });
      } catch (aiErr) {
        console.warn('AI summary skipped:', aiErr);
      }

      const blob = await pdf(
        <CustomerQuotePdf quote={quote} items={items} company={company} aiSummary={aiSummary} />
      ).toBlob();
      const name = company?.name ?? 'Customer';
      const date = new Date().toISOString().slice(0, 10);
      triggerDownload(blob, `Quote-${name.replace(/\s+/g, '-')}-${date}.pdf`);
    } catch (err) {
      toast({
        title: 'PDF generation failed',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsDownloadingCustomer(false);
    }
  }, [buildQuoteForPdf, buildQuoteItemsForPdf, company, toast]);

  const handleDownloadManufacturer = useCallback(async () => {
    setIsDownloadingManufacturer(true);
    try {
      const quote = buildQuoteForPdf();
      const items = buildQuoteItemsForPdf().map((qi, idx) => ({
        ...qi,
        fields: lineItems[idx]?.estimateItem.fields ?? [],
      }));
      const blob = await pdf(
        <ManufacturerQuotePdf quote={quote} items={items} company={company} />
      ).toBlob();
      const name = company?.name ?? 'Manufacturer';
      const date = new Date().toISOString().slice(0, 10);
      triggerDownload(blob, `RFQ-${name.replace(/\s+/g, '-')}-${date}.pdf`);
    } catch (err) {
      toast({
        title: 'PDF generation failed',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsDownloadingManufacturer(false);
    }
  }, [buildQuoteForPdf, buildQuoteItemsForPdf, lineItems, company, toast]);

  const handleDownloadBoth = useCallback(async () => {
    await Promise.all([handleDownloadCustomer(), handleDownloadManufacturer()]);
  }, [handleDownloadCustomer, handleDownloadManufacturer]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const quoteTypeBadgeMap: Record<QuoteType, { label: string; className: string }> = {
    customer: {
      label: 'Customer Quote',
      className: 'bg-blue-100 text-blue-700 border-blue-200',
    },
    manufacturer: {
      label: 'Manufacturer RFQ',
      className: 'bg-purple-100 text-purple-700 border-purple-200',
    },
    both: {
      label: 'Customer + Manufacturer',
      className: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    },
  };

  const typeBadge = quoteTypeBadgeMap[quoteType];

  return (
    <>
    {/* ── PDF Preview Dialog ── */}
    <Dialog open={previewType !== null} onOpenChange={(open) => !open && setPreviewType(null)}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Eye className="h-4 w-4" />
            {previewType === 'customer' ? 'Customer Quote Preview' : 'Manufacturer RFQ Preview'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0">
          {previewType !== null && (
            <PDFViewer width="100%" height="100%" showToolbar>
              {previewType === 'customer' ? (
                <CustomerQuotePdf
                  quote={pdfQuote}
                  items={pdfItems}
                  company={company}
                  aiSummary={previewAiSummary}
                />
              ) : (
                <ManufacturerQuotePdf
                  quote={pdfQuote}
                  items={pdfManufacturerItems}
                  company={company}
                />
              )}
            </PDFViewer>
          )}
        </div>

        <div className="px-6 py-4 border-t shrink-0 flex items-center justify-between gap-3 bg-background">
          {previewType === 'customer' && isGeneratingPreviewSummary && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating AI summary…
            </p>
          )}
          {previewType === 'customer' && !isGeneratingPreviewSummary && (
            <p className="text-xs text-muted-foreground">
              {previewAiSummary ? 'AI summary included.' : 'AI summary unavailable.'}
            </p>
          )}
          {previewType === 'manufacturer' && (
            <p className="text-xs text-muted-foreground">
              Internal use only — not for customer distribution.
            </p>
          )}
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <Button variant="outline" onClick={() => setPreviewType(null)}>
              Close
            </Button>
            <Button
              onClick={previewType === 'customer' ? handleDownloadCustomer : handleDownloadManufacturer}
              disabled={
                previewType === 'customer' ? isDownloadingCustomer : isDownloadingManufacturer
              }
            >
              {(previewType === 'customer' ? isDownloadingCustomer : isDownloadingManufacturer) ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download PDF
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <div className="flex h-full flex-col lg:flex-row">
      {/* ── Main content ── */}
      <div className="flex-1 overflow-auto">
        <div className="p-4 sm:p-6 lg:p-8">
          {/* Header */}
          <div className="mb-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/app/quotes')}
              className="mb-4 -ml-2"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Quotes
            </Button>

            <div className="flex flex-wrap items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-2xl sm:text-3xl tracking-wide">
                    Quote Builder
                  </h1>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${typeBadge.className}`}
                  >
                    {typeBadge.label}
                  </span>
                </div>
                {company && (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" />
                    {company.name}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshPricingTables}
                disabled={refreshingPrices}
                className="shrink-0"
              >
                {refreshingPrices ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Refreshing…</>
                ) : (
                  <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh from Pricing Tables</>
                )}
              </Button>
            </div>

            {/* Markup banner (customer or both) */}
            {(quoteType === 'customer' || quoteType === 'both') && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <Tag className="h-4 w-4 shrink-0" />
                <span className="flex-1 min-w-0">
                  {company ? `Markup for ${company.name}` : 'Markup'} — edit per-item below, or use these controls to apply globally.
                </span>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <label className="text-xs font-semibold uppercase tracking-wide opacity-70 whitespace-nowrap">
                    Apply to all
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.05"
                    defaultValue={companyDefaultMultiplier}
                    onBlur={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v > 0) handleApplyToAll(parseFloat(v.toFixed(2)));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = parseFloat((e.target as HTMLInputElement).value);
                        if (!isNaN(v) && v > 0) handleApplyToAll(parseFloat(v.toFixed(2)));
                      }
                    }}
                    className="w-20 rounded border border-amber-300 bg-white px-2 py-1 text-center text-sm font-semibold text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <span className="font-semibold">×</span>
                  <button
                    type="button"
                    onClick={handleResetToDefaults}
                    className="text-xs underline opacity-70 hover:opacity-100 whitespace-nowrap"
                  >
                    Reset to defaults
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Line items */}
          {quoteType === 'both' ? (
            <Tabs defaultValue="customer">
              <TabsList className="mb-4">
                <TabsTrigger value="customer">Customer Quote</TabsTrigger>
                <TabsTrigger value="manufacturer">Manufacturer RFQ</TabsTrigger>
              </TabsList>
              <TabsContent value="customer">
                <EngineOpeningsPanel
                  openings={openings}
                  linesByOpening={linesByOpening}
                  openingSpecMap={openingSpecMap}
                  lineItems={lineItems}
                  itemMultipliers={itemMultipliers}
                  companyDefaultMultiplier={companyDefaultMultiplier}
                  onUpdateMultiplier={handleUpdateMultiplier}
                  onQuantityChange={handleOpeningQuantityChange}
                  currency="USD"
                />
                {lineItems.some((li) => !li.estimateItem.isEngineLineDetail) && (
                  <div className={engineOpeningIds.size > 0 ? 'mt-6' : ''}>
                    <CustomerLineItemsTable
                      items={lineItems.filter((li) => !li.estimateItem.isEngineLineDetail)}
                      currency="USD"
                      companyDefaultMultiplier={companyDefaultMultiplier}
                      bulkOverrides={bulkOverrides}
                      onUpdateMultiplier={handleUpdateMultiplier}
                    />
                  </div>
                )}
              </TabsContent>
              <TabsContent value="manufacturer">
                <EngineOpeningsPanel
                  openings={openings}
                  linesByOpening={linesByOpening}
                  openingSpecMap={openingSpecMap}
                  lineItems={lineItems}
                  itemMultipliers={itemMultipliers}
                  companyDefaultMultiplier={companyDefaultMultiplier}
                  onUpdateMultiplier={handleUpdateMultiplier}
                  onQuantityChange={handleOpeningQuantityChange}
                  currency="USD"
                />
                {lineItems.some((li) => !li.estimateItem.isEngineLineDetail) && (
                  <div className={engineOpeningIds.size > 0 ? 'mt-6' : ''}>
                    <ManufacturerLineItemsTable
                      items={lineItems.filter((li) => !li.estimateItem.isEngineLineDetail)}
                      currency="USD"
                    />
                  </div>
                )}
              </TabsContent>
            </Tabs>
          ) : quoteType === 'customer' ? (
            <>
              <EngineOpeningsPanel
                openings={openings}
                linesByOpening={linesByOpening}
                openingSpecMap={openingSpecMap}
                lineItems={lineItems}
                itemMultipliers={itemMultipliers}
                companyDefaultMultiplier={companyDefaultMultiplier}
                onUpdateMultiplier={handleUpdateMultiplier}
                onQuantityChange={handleOpeningQuantityChange}
                currency="USD"
              />
              {lineItems.some((li) => !li.estimateItem.isEngineLineDetail) && (
                <div className={engineOpeningIds.size > 0 ? 'mt-6' : ''}>
                  <CustomerLineItemsTable
                    items={lineItems.filter((li) => !li.estimateItem.isEngineLineDetail)}
                    currency="USD"
                    companyDefaultMultiplier={companyDefaultMultiplier}
                    bulkOverrides={bulkOverrides}
                    onUpdateMultiplier={handleUpdateMultiplier}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <EngineOpeningsPanel
                openings={openings}
                linesByOpening={linesByOpening}
                openingSpecMap={openingSpecMap}
                lineItems={lineItems}
                itemMultipliers={itemMultipliers}
                companyDefaultMultiplier={companyDefaultMultiplier}
                onUpdateMultiplier={handleUpdateMultiplier}
                onQuantityChange={handleOpeningQuantityChange}
                currency="USD"
              />
              {lineItems.some((li) => !li.estimateItem.isEngineLineDetail) && (
                <div className={engineOpeningIds.size > 0 ? 'mt-6' : ''}>
                  <ManufacturerLineItemsTable
                    items={lineItems.filter((li) => !li.estimateItem.isEngineLineDetail)}
                    currency="USD"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Sidebar ── */}
      <div className="w-full shrink-0 border-t bg-muted/5 lg:w-80 lg:border-l lg:border-t-0">
        <div className="sticky top-0 overflow-y-auto p-4 sm:p-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Quote Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Company */}
              {company && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">{company.name}</span>
                </div>
              )}

              {/* Type badge */}
              <div>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${typeBadge.className}`}
                >
                  {typeBadge.label}
                </span>
              </div>

              <Separator />

              {/* Totals */}
              <div className="space-y-2 text-sm">
                {(quoteType === 'customer' || quoteType === 'both') && (
                  <>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Cost Subtotal</span>
                      <span>{fmt(costSubtotal)}</span>
                    </div>
                    {effectiveMarkupMultiplier !== 1.0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span className="flex items-center gap-1">
                          Markup
                          <MultiplierBadge multiplier={parseFloat(effectiveMarkupMultiplier.toFixed(2))} />
                        </span>
                        <span>+{fmt(subtotal - costSubtotal)}</span>
                      </div>
                    )}
                  </>
                )}
                {quoteType === 'manufacturer' && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Cost Subtotal</span>
                    <span>{fmt(costSubtotal)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between font-semibold text-base">
                  <span>Total</span>
                  <span>{fmt(quoteType === 'manufacturer' ? costSubtotal : total)}</span>
                </div>
              </div>

              <Separator />

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Notes
                </label>
                <Textarea
                  placeholder="Add any notes or special instructions..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="resize-none text-sm"
                />
              </div>

              <Separator />

              {/* Save */}
              <Button
                className="w-full"
                onClick={handleSave}
                disabled={isSaving || lineItems.length === 0}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Quote
              </Button>

              {/* Preview & Download buttons */}
              <div className="space-y-3">
                {(quoteType === 'customer' || quoteType === 'both') && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Customer Quote
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handlePreviewCustomer}
                        disabled={lineItems.length === 0}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={handleDownloadCustomer}
                        disabled={isDownloadingCustomer || lineItems.length === 0}
                      >
                        {isDownloadingCustomer ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="mr-2 h-4 w-4" />
                        )}
                        Download
                      </Button>
                    </div>
                  </div>
                )}

                {(quoteType === 'manufacturer' || quoteType === 'both') && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Manufacturer RFQ
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setPreviewType('manufacturer')}
                        disabled={lineItems.length === 0}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={handleDownloadManufacturer}
                        disabled={isDownloadingManufacturer || lineItems.length === 0}
                      >
                        {isDownloadingManufacturer ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="mr-2 h-4 w-4" />
                        )}
                        Download
                      </Button>
                    </div>
                  </div>
                )}

                {quoteType === 'both' && (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={handleDownloadBoth}
                    disabled={
                      isDownloadingCustomer ||
                      isDownloadingManufacturer ||
                      lineItems.length === 0
                    }
                  >
                    {isDownloadingCustomer || isDownloadingManufacturer ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Download Both PDFs
                  </Button>
                )}
              </div>

              {/* Item count */}
              <p className="text-center text-xs text-muted-foreground">
                {lineItems.length} line item{lineItems.length !== 1 ? 's' : ''}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
    </>
  );
}
