/**
 * AuditableQuote — the end-to-end opening quote view (Phase 5).
 *
 * Renders the rule engine's output as the separate-but-coordinated layers from
 * the "Example Opening" tab: Pioneer base + adders, Pioneer preparations,
 * actual hardware, linear accessories, keying, access control, and
 * services/freight/tax. Each line shows its status, source/version, and (for
 * hardware) sell vs net + GM. Completeness blockers/warnings sit on top, and
 * hardware can be rolled up by group or as one all-hardware figure.
 *
 * Presentational only — both the live builder review and the persisted wizard
 * ReviewStep pass the same `AuditableQuote` + `CompletenessReport` model.
 */

import { useState } from 'react';
import { AlertTriangle, ShieldAlert, Info, ChevronDown, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type {
  AuditableQuote as AuditableQuoteModel,
  QuoteLayer,
  QuoteLine,
} from '@/lib/cpq/auditable-quote';
import type { CompletenessReport, CompletenessSeverity } from '@/lib/cpq/completeness';
import type { EstimateLinePriceStatus } from '@/types';

function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

/** Renders the matched spec (field → value) compactly, dropping the entity prefix. */
function formatMatchedConditions(matched: Record<string, unknown> | null): string | null {
  if (!matched) return null;
  const parts = Object.entries(matched)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([k, v]) => `${k.includes('.') ? k.slice(k.indexOf('.') + 1).replace(/_/g, ' ') : k} ${String(v)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

const STATUS_STYLES: Record<EstimateLinePriceStatus, string> = {
  PRICED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  INCLUDED: 'bg-sky-50 text-sky-700 border-sky-200',
  NO_CHARGE: 'bg-muted text-muted-foreground border-border',
  CONTACT_FACTORY: 'bg-amber-50 text-amber-700 border-amber-200',
  EXTERNAL_PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  INVALID: 'bg-destructive/10 text-destructive border-destructive/30',
};

function StatusBadge({ status }: { status: EstimateLinePriceStatus }) {
  return (
    <Badge variant="outline" className={cn('text-[10px] py-0 px-1.5 font-medium', STATUS_STYLES[status])}>
      {status.replace(/_/g, ' ').toLowerCase()}
    </Badge>
  );
}

const SEVERITY_STYLES: Record<CompletenessSeverity, { box: string; icon: typeof AlertTriangle }> = {
  block: { box: 'border-destructive/40 bg-destructive/5 text-destructive', icon: ShieldAlert },
  warn: { box: 'border-amber-200 bg-amber-50 text-amber-800', icon: AlertTriangle },
  info: { box: 'border-border bg-muted/40 text-muted-foreground', icon: Info },
};

function CompletenessPanel({ report }: { report: CompletenessReport }) {
  if (report.issues.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <Info className="h-4 w-4 shrink-0" />
        Completeness check passed — no missing prices, templates, ratings, or unresolved scope.
      </div>
    );
  }
  // Group issues by severity, blockers first.
  const order: CompletenessSeverity[] = ['block', 'warn', 'info'];
  return (
    <div className="space-y-2">
      {order.map((sev) => {
        const items = report.issues.filter((i) => i.severity === sev);
        if (items.length === 0) return null;
        const { box, icon: Icon } = SEVERITY_STYLES[sev];
        const label =
          sev === 'block'
            ? `${items.length} blocking issue${items.length !== 1 ? 's' : ''} — must resolve before finalizing`
            : sev === 'warn'
              ? `${items.length} warning${items.length !== 1 ? 's' : ''}`
              : `${items.length} note${items.length !== 1 ? 's' : ''}`;
        return (
          <div key={sev} className={cn('rounded-md border px-3 py-2 text-sm', box)}>
            <div className="flex items-center gap-2 font-medium">
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </div>
            <ul className="mt-1 space-y-0.5 text-xs">
              {items.map((i, idx) => (
                <li key={idx} className="flex gap-1.5">
                  <span className="font-mono opacity-60 shrink-0">{i.code}</span>
                  <span>{i.message}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function LineRow({ line, showMargin }: { line: QuoteLine; showMargin: boolean }) {
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 border-b last:border-0 text-xs hover:bg-muted/30">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium">{line.description}</span>
          <StatusBadge status={line.priceStatus} />
          {line.selectedOptionCode && (
            <Badge variant="outline" className="text-[10px] py-0 px-1 font-mono">{line.selectedOptionCode}</Badge>
          )}
        </div>
        {line.calculationExpression && (
          <div className="text-muted-foreground mt-0.5">{line.calculationExpression}</div>
        )}
        {formatMatchedConditions(line.matchedConditions) && (
          <div className="text-muted-foreground/80 mt-0.5">
            <span className="opacity-60">matched:</span> {formatMatchedConditions(line.matchedConditions)}
          </div>
        )}
        {line.exceptionMessage && (
          <div className="text-destructive mt-0.5">{line.exceptionMessage}</div>
        )}
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
          {line.sourcePage && (
            <span className="flex items-center gap-0.5"><FileText className="h-2.5 w-2.5" />p.{line.sourcePage}</span>
          )}
          {line.priceBookId && <span>book {line.priceBookId.slice(0, 8)}</span>}
          {line.confidence != null && <span>conf {Math.round(line.confidence * 100)}%</span>}
        </div>
      </div>
      <div className="w-12 text-center text-muted-foreground tabular-nums shrink-0">
        ×{line.quantity}{line.unitOfMeasure && line.unitOfMeasure !== 'each' ? ` ${line.unitOfMeasure}` : ''}
      </div>
      {showMargin ? (
        <>
          <div className="w-20 text-right tabular-nums shrink-0">{money(line.extendedNetPrice)}</div>
          <div className="w-20 text-right tabular-nums font-medium shrink-0">{money(line.sellPrice)}</div>
          <div className="w-14 text-right tabular-nums text-muted-foreground shrink-0">
            {line.grossMarginPct != null ? `${line.grossMarginPct.toFixed(0)}%` : '—'}
          </div>
        </>
      ) : (
        <div className="w-24 text-right tabular-nums font-medium shrink-0">{money(line.sellPrice)}</div>
      )}
    </div>
  );
}

function LayerSection({ layer }: { layer: QuoteLayer }) {
  const [open, setOpen] = useState(true);
  const showMargin = layer.id === 'hardware' || layer.id === 'linear';
  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', !open && '-rotate-90')} />
        <span className="text-xs font-semibold uppercase tracking-wide">{layer.title}</span>
        <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{layer.lines.length}</Badge>
        {layer.exceptionCount > 0 && (
          <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-destructive/30 text-destructive">
            {layer.exceptionCount} exception{layer.exceptionCount !== 1 ? 's' : ''}
          </Badge>
        )}
        <span className="ml-auto text-xs font-semibold tabular-nums">{money(layer.sellTotal)}</span>
      </button>
      {open && (
        <div>
          {layer.warning && (
            <div className="flex items-start gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-800 text-[11px] border-b border-amber-200">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              <span>{layer.warning}</span>
            </div>
          )}
          {showMargin && (
            <div className="flex items-center gap-2 px-3 py-1 bg-muted/20 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-b">
              <div className="flex-1">Line</div>
              <div className="w-12 text-center">Qty</div>
              <div className="w-20 text-right">Net</div>
              <div className="w-20 text-right">Sell</div>
              <div className="w-14 text-right">GM</div>
            </div>
          )}
          {layer.lines.map((line, i) => (
            <LineRow key={i} line={line} showMargin={showMargin} />
          ))}
        </div>
      )}
    </div>
  );
}

function HardwareRollups({ quote }: { quote: AuditableQuoteModel }) {
  const [byGroup, setByGroup] = useState(true);
  if (quote.hardwareRollups.length === 0) return null;
  const all = quote.hardwareRollups.find((r) => r.group === 'all');
  const groups = quote.hardwareRollups.filter((r) => r.group !== 'all');

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hardware rollup</span>
        <div className="flex items-center gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => setByGroup(true)}
            className={cn('px-2 py-0.5 rounded', byGroup ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
          >
            By group
          </button>
          <button
            type="button"
            onClick={() => setByGroup(false)}
            className={cn('px-2 py-0.5 rounded', !byGroup ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
          >
            All hardware
          </button>
        </div>
      </div>
      {byGroup ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[10px] font-semibold text-muted-foreground uppercase">
            <div className="flex-1">Group</div>
            <div className="w-20 text-right">Net</div>
            <div className="w-20 text-right">Sell</div>
            <div className="w-14 text-right">GM</div>
          </div>
          {groups.map((r) => (
            <div key={r.group} className="flex items-center gap-2 text-xs">
              <div className="flex-1">{r.label} <span className="text-muted-foreground">×{r.lineCount}</span></div>
              <div className="w-20 text-right tabular-nums">{money(r.netTotal)}</div>
              <div className="w-20 text-right tabular-nums font-medium">{money(r.sellTotal)}</div>
              <div className="w-14 text-right tabular-nums text-muted-foreground">{r.grossMarginPct.toFixed(0)}%</div>
            </div>
          ))}
        </div>
      ) : all ? (
        <div className="flex items-center gap-4 text-sm">
          <span>Net <strong className="tabular-nums">{money(all.netTotal)}</strong></span>
          <span>Sell <strong className="tabular-nums">{money(all.sellTotal)}</strong></span>
          <span className="text-muted-foreground">GM <strong>{money(all.grossMargin)}</strong> ({all.grossMarginPct.toFixed(1)}%)</span>
        </div>
      ) : null}
    </div>
  );
}

interface AuditableQuoteProps {
  quote: AuditableQuoteModel;
  completeness: CompletenessReport;
  className?: string;
}

export function AuditableQuote({ quote, completeness, className }: AuditableQuoteProps) {
  return (
    <div className={cn('space-y-4', className)}>
      <CompletenessPanel report={completeness} />

      {/* Totals header */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-primary/5 px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">List</p>
          <p className="text-sm font-semibold tabular-nums">{money(quote.listTotal)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Net</p>
          <p className="text-sm font-semibold tabular-nums">{money(quote.netTotal)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Sell</p>
          <p className="text-lg font-bold tabular-nums">{money(quote.sellTotal)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Gross margin</p>
          <p className="text-sm font-semibold tabular-nums">{money(quote.grossMargin)} ({quote.grossMarginPct.toFixed(1)}%)</p>
        </div>
        {quote.exceptionCount > 0 && (
          <Badge variant="outline" className="ml-auto border-destructive/30 text-destructive">
            {quote.exceptionCount} exception{quote.exceptionCount !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      <HardwareRollups quote={quote} />

      <div className="space-y-2">
        {quote.layers.map((layer) => (
          <LayerSection key={layer.id} layer={layer} />
        ))}
        {quote.layers.length === 0 && (
          <p className="text-sm text-muted-foreground italic text-center py-8">No priced lines yet.</p>
        )}
      </div>
    </div>
  );
}
