import { useState, useEffect } from 'react';
import { SlidersHorizontal, X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { DimensionCriteria, DimensionCriteriaLeaf } from '@/types';
import {
  parseDimension,
  formatDimension,
  formatDimensionHyphen,
  describeDimensionCriteriaWith,
} from './dimension-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConditionMode = 'in' | 'between' | 'gte' | 'gt' | 'lte';

interface ConditionBlock {
  id: string;
  mode: ConditionMode;
  inListRaw: string;
  betweenMinRaw: string;
  betweenMaxRaw: string;
  singleRaw: string;
}

const MODES: { value: ConditionMode; short: string; description: string }[] = [
  { value: 'in',      short: 'List',   description: 'In list (exact values)' },
  { value: 'between', short: 'Range',  description: 'Between (inclusive)' },
  { value: 'gte',     short: '≥',      description: 'Greater than or equal to' },
  { value: 'gt',      short: '>',      description: 'Greater than' },
  { value: 'lte',     short: '≤',      description: 'Less than or equal to' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newBlock(): ConditionBlock {
  return {
    id: crypto.randomUUID(),
    mode: 'in',
    inListRaw: '',
    betweenMinRaw: '',
    betweenMaxRaw: '',
    singleRaw: '',
  };
}

function leafToBlock(
  c: DimensionCriteriaLeaf,
  fmt: (n: number) => string,
): ConditionBlock {
  const block = newBlock();
  block.mode = c.type;
  if (c.type === 'in') {
    block.inListRaw = c.values.map(fmt).join(', ');
  } else if (c.type === 'between') {
    block.betweenMinRaw = fmt(c.min);
    block.betweenMaxRaw = fmt(c.max);
  } else {
    block.singleRaw = fmt(c.value);
  }
  return block;
}

function criteriaToBlocks(
  criteria: DimensionCriteria | null | undefined,
  fmt: (n: number) => string,
): ConditionBlock[] {
  if (!criteria) return [newBlock()];
  if (criteria.type === 'raw') return [newBlock()];
  if (criteria.type === 'or') return criteria.conditions.map((c) => leafToBlock(c, fmt));
  return [leafToBlock(criteria as DimensionCriteriaLeaf, fmt)];
}

function blockToLeaf(
  block: ConditionBlock,
  prs: (s: string) => number | null,
): DimensionCriteriaLeaf | null {
  if (block.mode === 'in') {
    const values = block.inListRaw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(prs)
      .filter((v): v is number => v !== null);
    return values.length ? { type: 'in', values } : null;
  }
  if (block.mode === 'between') {
    const min = prs(block.betweenMinRaw);
    const max = prs(block.betweenMaxRaw);
    return min !== null && max !== null ? { type: 'between', min, max } : null;
  }
  const v = prs(block.singleRaw);
  return v !== null ? { type: block.mode, value: v } : null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface CriteriaPopoverProps {
  value?: DimensionCriteria | null;
  onChange: (value: DimensionCriteria | null) => void;
  label?: string;
  formatHint?: string;
  className?: string;
  disabled?: boolean;
  /**
   * When true, values are stored and displayed as plain numbers (no feet/inches
   * conversion). Use this for width criteria where raw inch values are entered.
   */
  plainNumbers?: boolean;
}

export function CriteriaPopover({
  value,
  onChange,
  label = 'Dimension',
  formatHint,
  className,
  disabled = false,
  plainNumbers = false,
}: CriteriaPopoverProps) {
  // Width (plainNumbers) uses the same parser but always formats back as hyphen notation
  // (e.g. "6-4" → 76in → "6-4"), never as the height-style feet-quote notation ("6'8\"").
  const parse = parseDimension;
  const fmt = plainNumbers ? formatDimensionHyphen : formatDimension;
  const defaultHint = plainNumbers ? 'e.g. 2-0, 2-6' : "e.g. 6'8\"";
  const hint = formatHint ?? defaultHint;

  const [open, setOpen] = useState(false);
  const [blocks, setBlocks] = useState<ConditionBlock[]>([newBlock()]);

  useEffect(() => {
    if (open) setBlocks(criteriaToBlocks(value, fmt));
  // fmt is derived from plainNumbers which is a stable prop — safe to omit from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  function updateBlock(id: string, patch: Partial<ConditionBlock>) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function removeBlock(id: string) {
    setBlocks((prev) => (prev.length > 1 ? prev.filter((b) => b.id !== id) : prev));
  }

  const validLeaves = blocks
    .map((b) => blockToLeaf(b, parse))
    .filter((l): l is DimensionCriteriaLeaf => l !== null);

  const canApply = validLeaves.length > 0;

  function buildResult(): DimensionCriteria | null {
    if (!canApply) return null;
    if (validLeaves.length === 1) return validLeaves[0];
    return { type: 'or', conditions: validLeaves };
  }

  const preview = canApply ? describeDimensionCriteriaWith(buildResult()!, fmt) : null;
  const hasCriteria = value != null;

  function handleApply() {
    onChange(buildResult());
    setOpen(false);
  }

  function handleClear() {
    onChange(null);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-6 w-6 shrink-0', hasCriteria && 'text-primary', className)}
          disabled={disabled}
          title={hasCriteria ? describeDimensionCriteriaWith(value!, fmt) : `Set ${label} criteria`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0" align="start" side="bottom">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-semibold">{label} Criteria</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="px-4 py-3 space-y-3 max-h-[420px] overflow-y-auto">
          {/* Condition blocks */}
          {blocks.map((block, idx) => (
            <div key={block.id} className="relative">
              {/* OR divider between blocks */}
              {idx > 0 && (
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                    OR
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}

              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2.5">
                {/* Remove block */}
                {blocks.length > 1 && (
                  <div className="flex justify-end -mt-1 -mr-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground hover:text-destructive"
                      onClick={() => removeBlock(block.id)}
                      title="Remove this condition"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}

                {/* Mode selector */}
                <div className="flex rounded-md bg-muted/70 p-0.5 gap-0.5">
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => updateBlock(block.id, { mode: m.value })}
                      title={m.description}
                      className={cn(
                        'flex-1 rounded-sm py-1 text-[11px] font-medium transition-colors',
                        block.mode === m.value
                          ? 'bg-background shadow-sm text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {m.short}
                    </button>
                  ))}
                </div>

                {/* Inputs per mode */}
                {block.mode === 'in' && (
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">
                      Values — comma or space separated
                    </Label>
                    <Input
                      value={block.inListRaw}
                      onChange={(e) => updateBlock(block.id, { inListRaw: e.target.value })}
                      placeholder={hint}
                      className="h-7 text-xs"
                    />
                  </div>
                )}

                {block.mode === 'between' && (
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 space-y-1">
                      <Label className="text-[11px] text-muted-foreground">From</Label>
                      <Input
                        value={block.betweenMinRaw}
                        onChange={(e) => updateBlock(block.id, { betweenMinRaw: e.target.value })}
                        placeholder={hint}
                        className="h-7 text-xs"
                      />
                    </div>
                    <span className="text-muted-foreground text-sm pb-1.5">–</span>
                    <div className="flex-1 space-y-1">
                      <Label className="text-[11px] text-muted-foreground">To</Label>
                      <Input
                        value={block.betweenMaxRaw}
                        onChange={(e) => updateBlock(block.id, { betweenMaxRaw: e.target.value })}
                        placeholder={hint}
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                )}

                {(block.mode === 'gte' || block.mode === 'gt' || block.mode === 'lte') && (
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">
                      {block.mode === 'gte'
                        ? 'Greater than or equal to (≥)'
                        : block.mode === 'gt'
                          ? 'Greater than (>)'
                          : 'Less than or equal to (≤)'}
                    </Label>
                    <Input
                      value={block.singleRaw}
                      onChange={(e) => updateBlock(block.id, { singleRaw: e.target.value })}
                      placeholder={hint}
                      className="h-7 text-xs"
                    />
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Add another condition */}
          <button
            onClick={() => setBlocks((prev) => [...prev, newBlock()])}
            className="w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add another condition (OR)
          </button>

          {/* Live preview */}
          <div className="rounded-md bg-muted px-3 py-2 min-h-8">
            {preview ? (
              <p className="text-xs font-mono text-foreground break-all">{preview}</p>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                Enter values above to see a preview
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={handleClear}
          >
            Clear
          </Button>
          <Button size="sm" onClick={handleApply} disabled={!canApply}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
