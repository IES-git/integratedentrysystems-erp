import { useCallback, useEffect, useState } from 'react';
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, ArrowLeft, Trash2, Sparkles, RefreshCw, Eye } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { listManufacturerCompanies } from '@/lib/pricing-api';
import {
  uploadPriceBook, ingestPriceBook, pollBookStatus, extractPriceBookTable, listPriceBooks, listExtractionsForBook,
  approveExtraction, discardExtraction, deletePriceBook,
  extractAllPriceBookTables, pollExtractAllStatus, hasPriceBookWorker,
  approveAdderExtraction, listBaseTablesForVendor,
  findMatchingPricingTable, computeGridDiff,
  approveHardwareExtraction, resetExtractionGrid,
  compilePriceBookTable, compileAllPriceBookTables, ingestHardwareBook, ingestNgpCatalog,
  type ColumnMapping, type RowMapping, type BaseTableOption, type GridDiff, type HardwareRowMapping,
} from '@/lib/price-books-api';
import RuleReviewPanel from '@/components/pricing/RuleReviewPanel';
import { approveAllCompiledExtractions } from '@/lib/price-rules-api';
import { publishPriceBookDocumentWithQa, QaGateError } from '@/lib/cpq/qa-checks';
import { getProposalForExtraction } from '@/lib/pricing-proposals-api';
import { getFieldDefinitions } from '@/lib/estimates-api';
import type {
  PriceBook, PriceBookCategory, PriceBookExtraction, Company, ColumnCriteria, DimensionCriteria, FieldDefinition,
} from '@/types';

/** An adder/option table contributes surcharges, not a base size grid. */
function isAdderExtraction(ext: PriceBookExtraction): boolean {
  if (ext.kind === 'adder') return true;
  return /\(ADDERS\)|ADDITIONAL PREPARATION|ELEVATION|LOUVER|\bKIT\b|\bOPTION|\bGLASS\b/i.test(ext.title ?? '');
}

/**
 * Best-effort parse of a base-table title into the spec selectors that route an
 * item to it (doors: edge_construction + core_construction; frames: frame_type +
 * frame_fabrication). The user confirms/edits these before approving.
 */
function parseSpecSelectors(category: PriceBookCategory, title: string): { key: string; value: string }[] {
  const t = (title ?? '').toLowerCase();
  if (category === 'doors') {
    const edge = /continuous weld/.test(t) ? 'Continuous Weld' : /lockseam/.test(t) ? 'Lockseam' : '';
    const core = /embossed/.test(t) ? 'Embossed Panel' : /steel stiffen/.test(t) ? 'Steel Stiffened' : /glued/.test(t) ? 'Glued' : '';
    return [{ key: 'edge_construction', value: edge }, { key: 'core_construction', value: core }];
  }
  if (category === 'frames') {
    const type = /drywall/.test(t) ? 'Drywall' : /masonry/.test(t) ? 'Masonry' : /kerf/.test(t) ? 'Kerf' : '';
    const fab = /(knock|\bkd\b)/.test(t) ? 'KD' : /welded/.test(t) ? 'Welded-full' : '';
    return [{ key: 'frame_type', value: type }, { key: 'frame_fabrication', value: fab }];
  }
  return [];
}

const CATEGORIES: { value: PriceBookCategory; label: string }[] = [
  { value: 'doors', label: 'Doors' },
  { value: 'frames', label: 'Frames' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'lites_louvers_glass', label: 'Lites / Louvers / Glass' },
  { value: 'panels', label: 'Panels' },
];

function statusBadge(status: PriceBook['ocrStatus']) {
  switch (status) {
    case 'done':
      return <Badge className="bg-green-600 hover:bg-green-600"><CheckCircle2 className="mr-1 h-3 w-3" />Extracted</Badge>;
    case 'processing':
      return <Badge variant="secondary"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Processing</Badge>;
    case 'error':
      return <Badge variant="destructive"><AlertCircle className="mr-1 h-3 w-3" />Error</Badge>;
    default:
      return <Badge variant="outline">Pending</Badge>;
  }
}

/** Local editable mapping state derived from an extraction. */
interface ColumnDraft { gridCol: number; label: string; fieldKey: string; value: string; }
interface RowDraft { gridRow: number; label: string; width: string; height: string; }

function splitDimension(label: string): { width: string; height: string } {
  const parts = label.split(/\s*[x×]\s*/i);
  if (parts.length >= 2) return { width: parts[0].trim(), height: parts.slice(1).join(' x ').trim() };
  return { width: label.trim(), height: '' };
}

export default function PriceBookIngestPage() {
  const { toast } = useToast();
  const { user } = useAuth();

  const [books, setBooks] = useState<PriceBook[]>([]);
  const [manufacturers, setManufacturers] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload form
  const [name, setName] = useState('');
  const [companyId, setCompanyId] = useState<string>('');
  const [category, setCategory] = useState<PriceBookCategory | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState('');
  const [supersedesId, setSupersedesId] = useState('__none__');

  // Review state
  const [reviewBook, setReviewBook] = useState<PriceBook | null>(null);
  const [bookExtractions, setBookExtractions] = useState<PriceBookExtraction[]>([]);
  const [extraction, setExtraction] = useState<PriceBookExtraction | null>(null);
  // Read-only view of an already-extracted (often approved) table's grid.
  const [viewExtraction, setViewExtraction] = useState<PriceBookExtraction | null>(null);
  // CPQ v2 rule review/approval (replaces grid mapping). Set to the extraction
  // whose compiled price/dependency rules are being reviewed.
  const [ruleReviewExt, setRuleReviewExt] = useState<PriceBookExtraction | null>(null);
  const [compilingIds, setCompilingIds] = useState<Set<string>>(new Set());
  const [compilingAll, setCompilingAll] = useState(false);
  const [hardwareIngestingId, setHardwareIngestingId] = useState<string | null>(null);
  const [ngpIngestingId, setNgpIngestingId] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [reviewName, setReviewName] = useState('');
  const [reviewCategory, setReviewCategory] = useState<PriceBookCategory>('doors');
  const [reviewSeries, setReviewSeries] = useState('');
  const [reviewTableKind, setReviewTableKind] = useState<'base' | 'component'>('base');
  const [reviewVendorIds, setReviewVendorIds] = useState<string[]>([]);
  const [columnDrafts, setColumnDrafts] = useState<ColumnDraft[]>([]);
  const [rowDrafts, setRowDrafts] = useState<RowDraft[]>([]);
  const [specDrafts, setSpecDrafts] = useState<{ key: string; value: string }[]>([]);
  const [approving, setApproving] = useState(false);

  // Adder/option mapping state (used when the opened extraction is an adder).
  const [adderMode, setAdderMode] = useState(false);
  const [baseTableOptions, setBaseTableOptions] = useState<BaseTableOption[]>([]);
  const [adderBaseTableId, setAdderBaseTableId] = useState<string>('');
  const [adderCanonicalCode, setAdderCanonicalCode] = useState<string>('');
  const [fieldDefs, setFieldDefs] = useState<FieldDefinition[]>([]);
  const [adderFieldDefId, setAdderFieldDefId] = useState<string>('');
  // Per-row state: each row can be mapped to a different field definition
  const [adderRows, setAdderRows] = useState<{
    optionValue: string;
    price: number | null;
    include: boolean;
    fieldDefinitionId: string; // per-row field (empty = use the header default)
  }[]>([]);
  // For bulk-assignment: tracks which rows are checked for mass field-assign
  const [adderSelectedRows, setAdderSelectedRows] = useState<Set<number>>(new Set());
  const [bulkFieldDefId, setBulkFieldDefId] = useState<string>('');

  // Diff preview for update-vs-create
  const [diffPreview, setDiffPreview] = useState<GridDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // Hardware flat-list mapping state
  const [hardwareMode, setHardwareMode] = useState(false);
  const [hardwareRows, setHardwareRows] = useState<HardwareRowMapping[]>([]);

  const loadList = async () => {
    setLoading(true);
    try {
      const [bks, mfgs] = await Promise.all([listPriceBooks(), listManufacturerCompanies()]);
      setBooks(bks);
      setManufacturers(mfgs);
    } catch (err) {
      toast({ title: 'Failed to load price books', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadList(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Silent book-list refresh (no spinner) — used by the background poller. */
  const refreshBooks = useCallback(async () => {
    try {
      setBooks(await listPriceBooks());
    } catch {
      /* transient — the next tick retries */
    }
  }, []);

  // Background poller: while any book is still cataloging or extracting, keep the
  // list fresh so its status flips to "Extracted" automatically when the worker
  // finishes — without needing a manual page refresh. Survives re-mounts because
  // it's driven by the loaded `books` state, not a one-shot upload promise.
  const anyBookProcessing = books.some(
    (b) => b.ocrStatus === 'processing' || b.extractStatus === 'processing',
  );
  useEffect(() => {
    if (!anyBookProcessing) return;
    const id = setInterval(() => { void refreshBooks(); }, 4000);
    return () => clearInterval(id);
  }, [anyBookProcessing, refreshBooks]);

  const handleUpload = async () => {
    if (!file || !name.trim() || !user) {
      toast({ title: 'Missing fields', description: 'Provide a name and choose a file.', variant: 'destructive' });
      return;
    }
    setUploading(true);
    try {
      const { priceBookId } = await uploadPriceBook(file, user.id, {
        name: name.trim(),
        companyId: companyId || null,
        category: (category || null) as PriceBookCategory | null,
        effectiveDate: effectiveDate || null,
        supersedesPriceBookId: (supersedesId && supersedesId !== '__none__') ? supersedesId : null,
      });
      toast({ title: 'Uploaded', description: 'Scanning the whole book for every pricing table (this can take a minute)…' });
      setName(''); setFile(null); setCategory(''); setCompanyId(''); setEffectiveDate(''); setSupersedesId('__none__');
      await ingestPriceBook(priceBookId);
      await loadList();
      const book = await pollBookStatus(priceBookId);
      const tables = await listExtractionsForBook(book.id);
      toast({ title: 'Catalog complete', description: `${tables.length} table(s) found. Open "Review & approve" to pull each grid.` });
      await loadList();
    } catch (err) {
      toast({ title: 'Ingestion failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
      await loadList();
    } finally {
      setUploading(false);
    }
  };

  const openReview = async (book: PriceBook) => {
    try {
      const list = await listExtractionsForBook(book.id);
      if (list.length === 0) {
        toast({ title: 'No tables extracted', description: 'Try re-running ingestion.', variant: 'destructive' });
        return;
      }
      setReviewBook(book);
      setBookExtractions(list);
      setExtraction(null);
      // If a background extract-all is still running, reattach the progress poller.
      if (hasPriceBookWorker && book.extractStatus === 'processing') {
        setExtractProgress({ done: book.extractDone, failed: book.extractFailed, total: book.extractTotal });
        void trackExtractAll(book);
      }
    } catch (err) {
      toast({ title: 'Failed to open review', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  const reloadBookExtractions = async (book: PriceBook): Promise<PriceBookExtraction[] | undefined> => {
    try {
      const list = await listExtractionsForBook(book.id);
      setBookExtractions(list);
      return list;
    } catch { /* ignore */ return undefined; }
  };

  const [extractingIds, setExtractingIds] = useState<Set<string>>(new Set());
  const [extractingAll, setExtractingAll] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{ done: number; failed: number; total: number } | null>(null);

  const extractGrid = async (ext: PriceBookExtraction) => {
    if (!reviewBook) return;
    setExtractingIds((p) => new Set(p).add(ext.id));
    try {
      const r = await extractPriceBookTable(ext.id);
      toast({ title: 'Grid extracted', description: `${ext.title ?? 'Table'}: ${r.rowCount}×${r.colCount}, ${r.cellCount} prices.` });
      await reloadBookExtractions(reviewBook);
    } catch (err) {
      toast({ title: 'Extraction failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setExtractingIds((p) => { const n = new Set(p); n.delete(ext.id); return n; });
    }
  };

  /**
   * Re-runs grid extraction on a table that was already extracted but produced
   * a truncated or empty result. Resets the grid to empty first, then re-runs
   * the Gemini extraction — a second pass often succeeds where the first was cut off.
   */
  const reExtractGrid = async (ext: PriceBookExtraction) => {
    if (!reviewBook) return;
    setExtractingIds((p) => new Set(p).add(ext.id));
    try {
      await resetExtractionGrid(ext.id);
      const r = await extractPriceBookTable(ext.id);
      if (r.cellCount === 0) {
        toast({
          title: 'Re-extraction produced no prices',
          description: `${ext.title ?? 'Table'}: ${r.rowCount} rows, ${r.colCount} cols, 0 prices — response may have been truncated again. Try once more or check the page hint.`,
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Grid re-extracted', description: `${ext.title ?? 'Table'}: ${r.rowCount}×${r.colCount}, ${r.cellCount} prices.` });
      }
      await reloadBookExtractions(reviewBook);
    } catch (err) {
      toast({ title: 'Re-extraction failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setExtractingIds((p) => { const n = new Set(p); n.delete(ext.id); return n; });
    }
  };

  /** Poll a running background extract-all job to completion, updating UI. */
  const trackExtractAll = async (book: PriceBook) => {
    setExtractingAll(true);
    let lastReload = 0;
    try {
      const finalBook = await pollExtractAllStatus(book.id, {
        onProgress: (b) => {
          setExtractProgress({ done: b.extractDone, failed: b.extractFailed, total: b.extractTotal });
          // Refresh the table periodically so rows flip to "Ready to map".
          const now = Date.now();
          if (now - lastReload > 6000) { lastReload = now; void reloadBookExtractions(book); }
        },
      });
      await reloadBookExtractions(book);
      toast({
        title: 'Grids extracted',
        description: `Pulled ${finalBook.extractDone} grid(s)${finalBook.extractFailed ? `, ${finalBook.extractFailed} failed (retry those individually or re-run).` : '.'}`,
        variant: finalBook.extractFailed ? 'destructive' : undefined,
      });
    } catch (err) {
      toast({ title: 'Extraction failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
      await reloadBookExtractions(book);
    } finally {
      setExtractingAll(false);
      setExtractProgress(null);
    }
  };

  /**
   * Extract every not-yet-pulled grid. With the Render worker this runs as a
   * background job (survives closing the tab) and we just poll progress; the
   * book keeps extracting even if the user navigates away. Without a worker it
   * falls back to a client-driven, bounded-concurrency loop.
   */
  const extractAllGrids = async () => {
    if (!reviewBook) return;
    const pending = bookExtractions.filter((e) => e.status === 'pending' && !e.gridExtracted);
    if (pending.length === 0) return;
    setExtractingAll(true);

    if (hasPriceBookWorker) {
      setExtractProgress({ done: 0, failed: 0, total: pending.length });
      try {
        await extractAllPriceBookTables(reviewBook.id);
        await trackExtractAll(reviewBook);
      } catch (err) {
        toast({ title: 'Extraction failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
        await reloadBookExtractions(reviewBook);
        setExtractingAll(false);
        setExtractProgress(null);
      }
      return;
    }

    // Fallback: no worker configured — drive it from the browser.
    const CONCURRENCY = 3;
    try {
      for (let i = 0; i < pending.length; i += CONCURRENCY) {
        const batch = pending.slice(i, i + CONCURRENCY);
        setExtractingIds((p) => { const n = new Set(p); batch.forEach((b) => n.add(b.id)); return n; });
        await Promise.allSettled(batch.map((b) => extractPriceBookTable(b.id)));
        setExtractingIds((p) => { const n = new Set(p); batch.forEach((b) => n.delete(b.id)); return n; });
        await reloadBookExtractions(reviewBook);
      }
      toast({ title: 'Grids extracted', description: `Pulled ${pending.length} table grid(s).` });
    } catch (err) {
      toast({ title: 'Extraction failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setExtractingAll(false);
    }
  };

  const handleReingest = async (book: PriceBook) => {
    try {
      toast({ title: 'Re-cataloging…', description: 'Scanning the book again for every table (this can take a minute).' });
      await ingestPriceBook(book.id);
      await loadList();
      await pollBookStatus(book.id);
      const tables = await listExtractionsForBook(book.id);
      toast({ title: 'Catalog complete', description: `${tables.length} table(s) found.` });
      await loadList();
    } catch (err) {
      toast({ title: 'Ingestion failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
      await loadList();
    }
  };

  const openTable = async (book: PriceBook, ext: PriceBookExtraction) => {
    try {
      const prop = await getProposalForExtraction(ext.id);
      setExtraction(ext);
      setProposalId(prop?.id ?? null);
      setReviewName(ext.title || book.name);
      setReviewCategory((ext.detectedCategory ?? book.category ?? 'doors') as PriceBookCategory);
      setReviewSeries(ext.detectedSeries ?? '');
      setReviewVendorIds(book.companyId ? [book.companyId] : []);

      const cat = (ext.detectedCategory ?? book.category ?? 'doors') as PriceBookCategory;

      // Hardware flat-list: route to hardware mapper
      if (cat === 'hardware' || (ext.kind === 'flat_list' && cat === 'hardware')) {
        setHardwareMode(true);
        setAdderMode(false);
        setHardwareRows(ext.grid.rowLabels.map((label, i) => {
          const cell = ext.grid.cells.find((c) => c.row === i && c.price != null);
          return {
            gridRow: i,
            label,
            canonicalCode: label.trim().toUpperCase().replace(/\s+/g, '-'),
            price: cell?.price ?? null,
            include: cell?.price != null,
          };
        }));
        return;
      }

      if (isAdderExtraction(ext)) {
        // Adder/option table: map each row to an option surcharge on a base table.
        setAdderMode(true);
        setAdderFieldDefId('');
        setAdderSelectedRows(new Set());
        setBulkFieldDefId('');

        const [bases, defs] = await Promise.all([
          book.companyId ? listBaseTablesForVendor(book.companyId) : Promise.resolve([]),
          getFieldDefinitions(),
        ]);
        setBaseTableOptions(bases);
        setFieldDefs(defs);

        // Default to the base table matching this adder's series, if present.
        const seriesLower = (ext.detectedSeries ?? '').trim().toLowerCase();
        const matchedBase = bases.find((b) => b.seriesValue.trim().toLowerCase() === seriesLower);
        setAdderBaseTableId(matchedBase?.id ?? bases[0]?.id ?? '');
        setAdderCanonicalCode(matchedBase?.seriesValue ?? ext.detectedSeries ?? '');

        // Build a field_key → field def id map for fast lookup
        const fieldKeyToId = new Map(defs.map((f) => [f.fieldKey, f.id]));
        // rowFieldHints: Gemini's best-guess field_key per row index (set during extraction)
        const rowHints = (ext.grid.rowFieldHints as Record<number, string> | undefined) ?? {};

        // Prefill each grid row; auto-assign fieldDefinitionId from Gemini's hints when available.
        setAdderRows(ext.grid.rowLabels.map((label, i) => {
          const cell = ext.grid.cells.find((c) => c.row === i && c.price != null);
          const hintKey = rowHints[i];
          const hintFieldId = hintKey ? (fieldKeyToId.get(hintKey) ?? '') : '';
          return {
            optionValue: label,
            price: cell?.price ?? null,
            include: cell?.price != null,
            fieldDefinitionId: hintFieldId,
          };
        }));
        return;
      }

      setAdderMode(false);
      setHardwareMode(false);
      setDiffPreview(null);
      // Auto-detect component tables from the title
      const titleLower = (ext.title ?? '').toLowerCase();
      const isComponent = /component|head|jamb|\bkd\b|knock.?down|parts/.test(titleLower);
      setReviewTableKind(isComponent ? 'component' : 'base');
      setSpecDrafts(parseSpecSelectors(cat, ext.title ?? ''));
      setColumnDrafts(ext.grid.columnLabels.map((label, i) => ({
        gridCol: i,
        label,
        fieldKey: ext.grid.columnFieldHints?.[i] ?? '',
        value: label,
      })));
      setRowDrafts(ext.grid.rowLabels.map((label, i) => {
        const { width, height } = splitDimension(label);
        return { gridRow: i, label, width, height };
      }));
    } catch (err) {
      toast({ title: 'Failed to open table', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  const handleApproveAdder = async () => {
    if (!extraction || !reviewBook) return;
    const vendorId = reviewBook.companyId;
    if (!vendorId) {
      toast({ title: 'Manufacturer required', description: 'This price book has no manufacturer set.', variant: 'destructive' });
      return;
    }
    if (!adderBaseTableId) {
      toast({ title: 'Base table required', description: 'Pick the door/frame series these surcharges apply to.', variant: 'destructive' });
      return;
    }
    if (!adderCanonicalCode.trim()) {
      toast({ title: 'Item code required', description: 'Enter the item canonical code these adders apply to.', variant: 'destructive' });
      return;
    }
    // Validate: every included row must have a field assigned (either per-row or via the header default)
    const includedRows = adderRows.filter((r) => r.include && r.price != null && r.optionValue.trim());
    const unassigned = includedRows.filter((r) => !r.fieldDefinitionId && !adderFieldDefId);
    if (unassigned.length > 0) {
      toast({
        title: 'Field required for all rows',
        description: `${unassigned.length} row(s) have no option field assigned. Use the per-row picker or the bulk-assign bar to assign them.`,
        variant: 'destructive',
      });
      return;
    }
    setApproving(true);
    try {
      const rows = includedRows.map((r) => ({
        optionValue: r.optionValue.trim(),
        price: r.price as number,
        fieldDefinitionId: r.fieldDefinitionId || undefined,
      }));
      const result = await approveAdderExtraction({
        extractionId: extraction.id,
        proposalId,
        baseTableId: adderBaseTableId,
        canonicalCode: adderCanonicalCode.trim(),
        fieldDefinitionId: adderFieldDefId, // default; per-row overrides take precedence
        vendorId,
        rows,
      });
      toast({ title: 'Adders saved', description: `${result.cellsWritten} surcharge(s) written.` });
      const book = reviewBook;
      setExtraction(null);
      setAdderMode(false);
      await reloadBookExtractions(book);
      await loadList();
    } catch (err) {
      toast({ title: 'Approval failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setApproving(false);
    }
  };

  const handleApproveHardware = async () => {
    if (!extraction || !reviewBook) return;
    if (reviewVendorIds.length === 0) {
      toast({ title: 'Vendor required', description: 'Select at least one manufacturer.', variant: 'destructive' });
      return;
    }
    setApproving(true);
    try {
      const result = await approveHardwareExtraction({
        extractionId: extraction.id,
        priceBookId: reviewBook.id,
        proposalId,
        tableName: reviewName.trim() || (extraction.title ?? 'Hardware'),
        vendorIds: reviewVendorIds,
        rows: hardwareRows,
      });
      toast({ title: 'Hardware table saved', description: `${result.rowsWritten} item(s) priced, ${result.itemsTagged} canonical code(s) tagged.` });
      const book = reviewBook;
      setExtraction(null);
      setHardwareMode(false);
      await reloadBookExtractions(book);
      await loadList();
    } catch (err) {
      toast({ title: 'Approval failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setApproving(false);
    }
  };

  const toggleVendor = (id: string) => {
    setReviewVendorIds((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]);
  };

  const handleApprove = async () => {
    if (!extraction || !reviewBook) return;
    if (!reviewSeries.trim()) {
      toast({ title: 'Series required', description: 'Enter a series / product line value.', variant: 'destructive' });
      return;
    }
    if (reviewVendorIds.length === 0) {
      toast({ title: 'Vendor required', description: 'Select at least one manufacturer.', variant: 'destructive' });
      return;
    }
    // For door and frame base tables, require at least one spec selector so the
    // table is addressable via the spec-first lookup (not just series fallback).
    const selCrit = Object.fromEntries(specDrafts.filter((s) => s.key.trim() && s.value.trim()).map((s) => [s.key.trim(), s.value.trim()]));
    if ((reviewCategory === 'doors' || reviewCategory === 'frames') && Object.keys(selCrit).length === 0) {
      toast({
        title: 'Spec selectors required',
        description: `Add at least one spec selector (e.g. edge_construction, frame_type) so this ${reviewCategory === 'doors' ? 'door' : 'frame'} table is addressable by spec.`,
        variant: 'destructive',
      });
      return;
    }
    setApproving(true);
    try {
      const columns: ColumnMapping[] = columnDrafts.map((c) => {
        const criteria: ColumnCriteria = c.fieldKey.trim() ? { [c.fieldKey.trim()]: c.value.trim() } : {};
        return { gridCol: c.gridCol, label: c.label, criteria };
      });
      const rows: RowMapping[] = rowDrafts.map((r) => ({
        gridRow: r.gridRow,
        label: r.label,
        widthCriteria: r.width.trim() ? ({ type: 'raw', label: r.width.trim() } as DimensionCriteria) : {},
        heightCriteria: r.height.trim() ? ({ type: 'raw', label: r.height.trim() } as DimensionCriteria) : {},
      }));
      const selectionCriteria = Object.fromEntries(
        specDrafts.filter((s) => s.key.trim() && s.value.trim()).map((s) => [s.key.trim(), s.value.trim()]),
      );
      const result = await approveExtraction({
        extractionId: extraction.id,
        priceBookId: reviewBook.id,
        proposalId,
        category: reviewCategory,
        seriesValue: reviewSeries.trim(),
        tableName: reviewName.trim() || reviewSeries.trim(),
        vendorIds: reviewVendorIds,
        columns,
        rows,
        grid: extraction.grid,
        selectionCriteria,
        tableKind: reviewTableKind,
      });
      const action = result.wasUpdate ? 'Pricing table updated' : 'Pricing table created';
      toast({ title: action, description: `${result.cellsWritten} price${result.cellsWritten !== 1 ? 's' : ''} written (${result.rowsCreated} new rows, ${result.columnsCreated} new columns).` });
      const book = reviewBook;
      setExtraction(null);
      await reloadBookExtractions(book);
      await loadList();
    } catch (err) {
      toast({ title: 'Approval failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setApproving(false);
    }
  };

  const handleDiscard = async () => {
    if (!extraction || !reviewBook) return;
    try {
      await discardExtraction(extraction.id, proposalId);
      toast({ title: 'Discarded', description: 'Table discarded; no prices written.' });
      const book = reviewBook;
      setExtraction(null);
      await reloadBookExtractions(book);
    } catch (err) {
      toast({ title: 'Discard failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  /**
   * CPQ v2 — compile ONE extracted table's grid into canonical price/dependency
   * rules on the worker, then reload. Opens the rule-review panel on success.
   */
  const compileGrid = async (ext: PriceBookExtraction) => {
    if (!reviewBook) return;
    setCompilingIds((prev) => new Set(prev).add(ext.id));
    try {
      const r = await compilePriceBookTable(ext.id);
      toast({ title: 'Compiled to rules', description: `"${ext.title ?? 'Table'}" → ${r.ruleCount} rule(s) (${r.archetype}).` });
      const updated = await reloadBookExtractions(reviewBook);
      const fresh = updated?.find((e) => e.id === ext.id) ?? null;
      if (fresh) setRuleReviewExt(fresh);
    } catch (err) {
      toast({ title: 'Compile failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setCompilingIds((prev) => { const next = new Set(prev); next.delete(ext.id); return next; });
    }
  };

  const [approvingAll, setApprovingAll] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [processingBook, setProcessingBook] = useState(false);
  const [processPhase, setProcessPhase] = useState('');

  /**
   * One-click pipeline for a whole book: extract every pending grid → compile
   * all to rules → approve all compiled. Leaves the final Publish as an explicit
   * step (so the QA gate / override decision stays a deliberate action).
   * Worker-only (compile lives on the worker).
   */
  const processEntireBook = async () => {
    if (!reviewBook) return;
    setProcessingBook(true);
    try {
      // 1. Extract all not-yet-pulled grids (background job; poll to completion).
      const pending = bookExtractions.filter((e) => e.status === 'pending' && !e.gridExtracted);
      if (pending.length > 0) {
        setProcessPhase(`Extracting ${pending.length} grid(s)…`);
        await extractAllPriceBookTables(reviewBook.id);
        await pollExtractAllStatus(reviewBook.id, {
          onProgress: (b) =>
            setProcessPhase(`Extracting grids ${b.extractDone}/${b.extractTotal}${b.extractFailed ? ` (${b.extractFailed} failed)` : ''}…`),
        });
        await reloadBookExtractions(reviewBook);
      }

      // 2. Compile every extracted grid into canonical rules.
      setProcessPhase('Compiling tables to rules…');
      const compiled = await compileAllPriceBookTables(reviewBook.id);
      await reloadBookExtractions(reviewBook);

      // 3. Bulk-approve all compiled tables.
      setProcessPhase('Approving rules…');
      const approved = await approveAllCompiledExtractions(reviewBook.id);
      await reloadBookExtractions(reviewBook);

      toast({
        title: 'Book processed',
        description: `${compiled.done}/${compiled.total} table(s) compiled → ${approved.approvedRules} price rule(s) + ${approved.approvedDependencies} dependency rule(s) approved.${compiled.failed ? ` ${compiled.failed} table(s) failed to compile — re-run those.` : ''} Click "Publish version" to go live.`,
      });
    } catch (err) {
      toast({ title: 'Processing failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
      await reloadBookExtractions(reviewBook);
    } finally {
      setProcessingBook(false);
      setProcessPhase('');
    }
  };

  /** CPQ v2 — bulk-approve every compiled table for the open book in one pass. */
  const approveAllCompiled = async () => {
    if (!reviewBook) return;
    setApprovingAll(true);
    try {
      const r = await approveAllCompiledExtractions(reviewBook.id);
      toast({
        title: 'Rules approved',
        description: `${r.approvedExtractions} table(s) approved → ${r.approvedRules} price rule(s), ${r.approvedDependencies} dependency rule(s). You can publish the version now.`,
      });
      await reloadBookExtractions(reviewBook);
    } catch (err) {
      toast({ title: 'Bulk approve failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setApprovingAll(false);
    }
  };

  /** CPQ v2 — publish the book's draft document (QA-gated) so its rules go live. */
  const publishBook = async (override = false) => {
    if (!reviewBook) return;
    const documentId = bookExtractions.find((e) => e.priceBookDocumentId)?.priceBookDocumentId ?? null;
    if (!documentId) {
      toast({ title: 'Nothing to publish', description: 'No compiled document found for this book yet.', variant: 'destructive' });
      return;
    }
    setPublishing(true);
    try {
      const result = await publishPriceBookDocumentWithQa(documentId, { override });
      toast({
        title: 'Version published',
        description: `Approved rules are now the active priced version.${result.warningCount > 0 ? ` (${result.warningCount} QA warning(s))` : ''}`,
      });
      await reloadBookExtractions(reviewBook);
      await loadList();
    } catch (err) {
      if (err instanceof QaGateError) {
        const proceed = confirm(
          `QA gate found ${err.result.blockingCount} blocking issue(s):\n\n` +
          err.result.findings.filter((f) => f.severity === 'ERROR' || f.severity === 'BLOCK').slice(0, 8).map((f) => `• [${f.checkName}] ${f.detail}`).join('\n') +
          `\n\nPublish anyway (override the QA gate)?`,
        );
        if (proceed) { setPublishing(false); return publishBook(true); }
      } else {
        toast({ title: 'Publish failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
      }
    } finally {
      setPublishing(false);
    }
  };

  /** CPQ v2 — compile every extracted table for the open book into rules. */
  const compileAllGrids = async () => {
    if (!reviewBook) return;
    setCompilingAll(true);
    try {
      const r = await compileAllPriceBookTables(reviewBook.id);
      toast({ title: 'Compiled all tables', description: `${r.done}/${r.total} tables → ${r.totalRules} rule(s)${r.failed ? ` (${r.failed} failed)` : ''}.` });
      await reloadBookExtractions(reviewBook);
    } catch (err) {
      toast({ title: 'Compile-all failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setCompilingAll(false);
    }
  };

  /**
   * Phase 2b — ingest a hardware catalog workbook via the source-specific parser.
   * Runs in the background; polls extract_status. The parsed catalog + queued net
   * mismatches land as pricing_change_proposals for review.
   */
  const handleIngestHardware = async (book: PriceBook) => {
    if (!confirm(`Ingest "${book.name}" as a hardware catalog? This parses it via the source-column map and queues products + price mismatches for review.`)) return;
    setHardwareIngestingId(book.id);
    try {
      await ingestHardwareBook(book.id);
      const finished = await pollExtractAllStatus(book.id, {});
      toast({
        title: 'Hardware ingested',
        description: `${finished.extractDone} variant(s) built${finished.extractFailed ? `, ${finished.extractFailed} net mismatch(es) queued for review` : ''}. Review in the proposals queue.`,
      });
      await loadList();
    } catch (err) {
      toast({ title: 'Hardware ingestion failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setHardwareIngestingId(null);
    }
  };

  /**
   * NGP infill — ingest a normalized NGP catalog workbook (glass / lite kits /
   * louvers / tape) via the deterministic importer. Background; polls
   * extract_status. Writes the ngp_* catalog + compiles dimensional matrices and
   * option rules into a draft price_book_document for review/approve/publish.
   */
  const handleIngestNgp = async (book: PriceBook) => {
    if (!confirm(`Ingest "${book.name}" as the NGP infill catalog? This loads the NGP glass/lite-kit/louver products + compatibility rules and compiles the dimensional price matrices for review.`)) return;
    setNgpIngestingId(book.id);
    try {
      await ingestNgpCatalog(book.id);
      const finished = await pollExtractAllStatus(book.id, {});
      toast({
        title: 'NGP catalog ingested',
        description: `${finished.extractDone} price rule(s) compiled. Review and approve in the proposals queue, then publish.`,
      });
      await loadList();
    } catch (err) {
      toast({ title: 'NGP ingestion failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setNgpIngestingId(null);
    }
  };

  const handleDelete = async (book: PriceBook) => {
    if (!confirm(`Delete price book "${book.name}"? This cannot be undone.`)) return;
    try {
      await deletePriceBook(book.id);
      await loadList();
    } catch (err) {
      toast({ title: 'Delete failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  const priceAt = (rowIdx: number, colIdx: number): number | null => {
    const cell = extraction?.grid.cells.find((c) => c.row === rowIdx && c.col === colIdx);
    return cell?.price ?? null;
  };

  // ---------------------------------------------------------------- Rule review/approval (CPQ v2)
  if (reviewBook && ruleReviewExt) {
    return (
      <RuleReviewPanel
        book={reviewBook}
        extraction={ruleReviewExt}
        onClose={() => setRuleReviewExt(null)}
        onChanged={async () => {
          const list = await reloadBookExtractions(reviewBook);
          const fresh = list?.find((e) => e.id === ruleReviewExt.id);
          if (fresh) setRuleReviewExt(fresh);
        }}
      />
    );
  }

  // ---------------------------------------------------------------- Read-only grid view
  if (reviewBook && viewExtraction) {
    const g = viewExtraction.grid;
    const priceCount = g.cells.filter((c) => c.price != null).length;
    const viewPrice = (rowIdx: number, colIdx: number): number | null => {
      const cell = g.cells.find((c) => c.row === rowIdx && c.col === colIdx);
      return cell?.price ?? null;
    };
    return (
      <div className="container mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setViewExtraction(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{viewExtraction.title ?? 'Untitled table'}</h1>
              {viewExtraction.status === 'approved' && (
                <Badge className="bg-green-600 hover:bg-green-600"><CheckCircle2 className="mr-1 h-3 w-3" />Approved</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{reviewBook.name} · {reviewBook.originalFileName}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="outline" className="capitalize">{viewExtraction.detectedCategory?.replace(/_/g, ' ') ?? 'Uncategorized'}</Badge>
          {viewExtraction.detectedSeries && <Badge variant="outline">Series: {viewExtraction.detectedSeries}</Badge>}
          {viewExtraction.kind && <Badge variant="outline" className="capitalize">{viewExtraction.kind.replace(/_/g, ' ')}</Badge>}
          <Badge variant="outline">{g.rowLabels.length}×{g.columnLabels.length} · {priceCount} prices</Badge>
        </div>

        {viewExtraction.warnings.length > 0 && (
          <Card className="border-amber-500/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-amber-600">
                <AlertCircle className="h-4 w-4" /> Agent warnings
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <ul className="list-disc pl-5">{viewExtraction.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Pricing table</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {g.rowLabels.length === 0 || g.columnLabels.length === 0 ? (
              <p className="text-sm text-muted-foreground">No grid data was extracted for this table.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background"></TableHead>
                    {g.columnLabels.map((label, i) => <TableHead key={i} className="whitespace-nowrap text-xs">{label}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.rowLabels.map((rLabel, rIdx) => (
                    <TableRow key={rIdx}>
                      <TableCell className="sticky left-0 bg-background whitespace-nowrap text-xs font-medium">{rLabel}</TableCell>
                      {g.columnLabels.map((_, cIdx) => {
                        const price = viewPrice(rIdx, cIdx);
                        return <TableCell key={cIdx} className="text-xs tabular-nums">{price != null ? `$${price.toFixed(2)}` : '—'}</TableCell>;
                      })}
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

  // ---------------------------------------------------------------- Hardware flat-list mapping view
  if (reviewBook && extraction && hardwareMode) {
    const closeHardware = () => { setExtraction(null); setHardwareMode(false); };
    return (
      <div className="container mx-auto max-w-4xl space-y-6 p-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={closeHardware}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold">Map hardware: {extraction.title ?? 'Untitled'}</h1>
            <p className="text-sm text-muted-foreground">{reviewBook.name} · flat price list — one price per item</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Table details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Table name</Label>
              <Input value={reviewName} onChange={(e) => setReviewName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Manufacturers</Label>
              <div className="max-h-28 space-y-1 overflow-y-auto rounded-md border p-2">
                {manufacturers.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={reviewVendorIds.includes(m.id)} onCheckedChange={() => toggleVendor(m.id)} />
                    {m.name}
                  </label>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hardware item rows</CardTitle>
            <CardDescription>
              Map each row to the hardware canonical code (e.g. HINGE-BB, LATCHSET-M) used by the opening builder.
              Include rows you want to price; skip any you don&apos;t need.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Extracted label</TableHead>
                  <TableHead>Canonical code</TableHead>
                  <TableHead className="w-32">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hardwareRows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Checkbox
                        checked={r.include}
                        onCheckedChange={() => setHardwareRows((p) => p.map((x, j) => j === i ? { ...x, include: !x.include } : x))}
                      />
                    </TableCell>
                    <TableCell className="text-xs font-mono">{r.label}</TableCell>
                    <TableCell>
                      <Input
                        className="h-8 font-mono text-xs"
                        value={r.canonicalCode}
                        placeholder="e.g. HINGE-BB"
                        onChange={(e) => setHardwareRows((p) => p.map((x, j) => j === i ? { ...x, canonicalCode: e.target.value } : x))}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 text-xs"
                        type="number"
                        value={r.price ?? ''}
                        onChange={(e) => setHardwareRows((p) => p.map((x, j) => j === i ? { ...x, price: e.target.value === '' ? null : Number(e.target.value) } : x))}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleDiscard} disabled={approving}>Discard</Button>
          <Button onClick={handleApproveHardware} disabled={approving}>
            {approving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save hardware prices
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- Adder/option mapping view
  if (reviewBook && extraction && adderMode) {
    const closeAdder = () => { setExtraction(null); setAdderMode(false); };

        // Derived counts for the header summary
        const includedCount = adderRows.filter((r) => r.include && r.price != null && r.optionValue.trim()).length;
        const unassignedCount = adderRows.filter((r) => r.include && r.price != null && !r.fieldDefinitionId && !adderFieldDefId).length;
        const autoAssignedCount = adderRows.filter((r) => r.include && r.price != null && r.fieldDefinitionId).length;
    const allSelected = adderRows.length > 0 && adderSelectedRows.size === adderRows.length;
    const someSelected = adderSelectedRows.size > 0 && !allSelected;

    // Group rows visually by their assigned field label
    const fieldById = new Map(fieldDefs.map((f) => [f.id, f]));

    return (
      <div className="container mx-auto max-w-5xl space-y-6 p-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={closeAdder} className="mt-0.5"><ArrowLeft className="h-4 w-4" /></Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold truncate">Map adders: {extraction.title ?? 'Untitled'}</h1>
            <p className="text-sm text-muted-foreground">{reviewBook.name} · surcharges stacked on top of a base price</p>
          </div>
        </div>

        {/* Setup card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Adder target</CardTitle>
            <CardDescription>
              These surcharges apply to a base door/frame series. Each row's price is added at quote time when the item's chosen option value matches.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Base series (door / frame)</Label>
              <Select value={adderBaseTableId} onValueChange={setAdderBaseTableId}>
                <SelectTrigger><SelectValue placeholder="Select base table…" /></SelectTrigger>
                <SelectContent>
                  {baseTableOptions.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.category} · {b.seriesValue}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {baseTableOptions.length === 0 && (
                <p className="text-xs text-amber-600">No base tables yet — approve the size grid first.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>
                Default option field
                <span className="ml-1 text-muted-foreground font-normal text-[11px]">(applies to unassigned rows)</span>
              </Label>
              <Select
                value={adderFieldDefId || '__none__'}
                onValueChange={(val) => setAdderFieldDefId(val === '__none__' ? '' : val)}
              >
                <SelectTrigger><SelectValue placeholder="Select field…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None (assign per row) —</SelectItem>
                  {fieldDefs.map((f) => <SelectItem key={f.id} value={f.id}>{f.fieldLabel} ({f.fieldKey})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Applies to item code</Label>
              <Input value={adderCanonicalCode} onChange={(e) => setAdderCanonicalCode(e.target.value)} placeholder="e.g. H" />
              <p className="text-xs text-muted-foreground">Must match the item's canonical_code.</p>
            </div>
          </CardContent>
        </Card>

        {/* Rows card */}
        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Option rows</CardTitle>
                <CardDescription className="mt-0.5">
                  This table has multiple sections — each row can belong to a <strong>different option field</strong>.
                  Use the per-row field picker or select rows and bulk-assign them.
                </CardDescription>
              </div>
              <div className="text-right shrink-0 text-sm space-y-0.5">
                <p className="font-medium">{includedCount} rows included</p>
                {autoAssignedCount > 0 && (
                  <p className="text-green-700 text-xs">
                    ✓ {autoAssignedCount} auto-matched by AI
                  </p>
                )}
                {unassignedCount > 0 && (
                  <p className="text-destructive text-xs">{unassignedCount} still need a field</p>
                )}
              </div>
            </div>

            {/* Bulk-assign bar — appears when rows are selected */}
            {adderSelectedRows.size > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-md border bg-primary/5 px-3 py-2">
                <span className="text-xs font-medium text-primary">{adderSelectedRows.size} selected</span>
                <div className="flex-1">
                  <Select
                    value={bulkFieldDefId}
                    onValueChange={setBulkFieldDefId}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="Assign to field…" />
                    </SelectTrigger>
                    <SelectContent>
                      {fieldDefs.map((f) => <SelectItem key={f.id} value={f.id} className="text-xs">{f.fieldLabel} ({f.fieldKey})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  disabled={!bulkFieldDefId}
                  onClick={() => {
                    setAdderRows((prev) => prev.map((r, i) =>
                      adderSelectedRows.has(i) ? { ...r, fieldDefinitionId: bulkFieldDefId } : r
                    ));
                    setAdderSelectedRows(new Set());
                    setBulkFieldDefId('');
                  }}
                >
                  Assign
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-destructive/50 text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    // Remove selected rows and re-index selection
                    setAdderRows((prev) => prev.filter((_, i) => !adderSelectedRows.has(i)));
                    setAdderSelectedRows(new Set());
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete {adderSelectedRows.size}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAdderSelectedRows(new Set())}>
                  Clear
                </Button>
              </div>
            )}
          </CardHeader>

          <CardContent className="p-0 mt-3">
            {/* Column headers */}
            <div className="grid grid-cols-[auto_28px_1fr_200px_96px] gap-0 border-y bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <div className="w-8">
                <Checkbox
                  checked={allSelected}
                  data-state={someSelected ? 'indeterminate' : allSelected ? 'checked' : 'unchecked'}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setAdderSelectedRows(new Set(adderRows.map((_, i) => i)));
                    } else {
                      setAdderSelectedRows(new Set());
                    }
                  }}
                />
              </div>
              <div></div>
              <div>Option value</div>
              <div>Option field</div>
              <div className="text-right">Surcharge ($)</div>
            </div>

            <div className="divide-y">
              {adderRows.map((r, i) => {
                const rowField = r.fieldDefinitionId ? fieldById.get(r.fieldDefinitionId) : null;
                const isSelected = adderSelectedRows.has(i);
                const missingField = r.include && r.price != null && !r.fieldDefinitionId && !adderFieldDefId;

                return (
                  <div
                    key={i}
                    className={`grid grid-cols-[auto_28px_1fr_200px_96px] items-center gap-0 px-4 py-2 transition-colors
                      ${isSelected ? 'bg-primary/5' : ''}
                      ${!r.include ? 'opacity-40' : ''}
                      ${missingField ? 'bg-destructive/5' : ''}
                    `}
                  >
                    {/* Row select checkbox */}
                    <div className="w-8">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => {
                          setAdderSelectedRows((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i); else next.add(i);
                            return next;
                          });
                        }}
                      />
                    </div>

                    {/* Include toggle */}
                    <div>
                      <Checkbox
                        checked={r.include}
                        title="Include in approval"
                        onCheckedChange={() => setAdderRows((p) => p.map((x, j) => j === i ? { ...x, include: !x.include } : x))}
                      />
                    </div>

                    {/* Option value */}
                    <div className="pr-3">
                      <Input
                        className="h-7 text-xs"
                        value={r.optionValue}
                        onChange={(e) => setAdderRows((p) => p.map((x, j) => j === i ? { ...x, optionValue: e.target.value } : x))}
                      />
                    </div>

                    {/* Per-row field picker */}
                    <div className="pr-3">
                      <Select
                        value={r.fieldDefinitionId || '__inherit__'}
                        onValueChange={(val) => setAdderRows((p) => p.map((x, j) => j === i ? { ...x, fieldDefinitionId: val === '__inherit__' ? '' : val } : x))}
                      >
                        <SelectTrigger className={`h-7 text-xs ${missingField ? 'border-destructive' : ''} ${rowField ? 'text-foreground' : 'text-muted-foreground'}`}>
                          <SelectValue placeholder={adderFieldDefId ? 'Using default' : 'Pick field…'} />
                        </SelectTrigger>
                        <SelectContent>
                          {adderFieldDefId && (
                            <SelectItem value="__inherit__" className="text-xs text-muted-foreground italic">
                              Use default field
                            </SelectItem>
                          )}
                          {fieldDefs.map((f) => (
                            <SelectItem key={f.id} value={f.id} className="text-xs">
                              {f.fieldLabel}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Price */}
                    <div>
                      <Input
                        className="h-7 text-xs text-right"
                        type="number"
                        value={r.price ?? ''}
                        onChange={(e) => setAdderRows((p) => p.map((x, j) => j === i ? { ...x, price: e.target.value === '' ? null : Number(e.target.value) } : x))}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-between gap-2">
          <Button variant="outline" onClick={handleDiscard} disabled={approving}>Discard</Button>
          <Button onClick={handleApproveAdder} disabled={approving || unassignedCount > 0}>
            {approving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save {includedCount} adder{includedCount !== 1 ? 's' : ''}
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- Single-table mapping view
  if (reviewBook && extraction) {
    return (
      <div className="container mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setExtraction(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Map table: {extraction.title ?? 'Untitled'}</h1>
            <p className="text-sm text-muted-foreground">{reviewBook.name} · {reviewBook.originalFileName}</p>
          </div>
        </div>

        {/* Empty grid warning with one-click re-extract */}
        {(extraction.grid.cells.length === 0 || extraction.grid.rowLabels.length === 0) && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-destructive">
                <AlertCircle className="h-4 w-4" /> Empty grid — extraction was truncated
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                Gemini hit its output token limit and returned no prices. Re-extracting usually succeeds on a second pass.
              </p>
              <Button
                variant="outline"
                className="shrink-0"
                disabled={extractingIds.has(extraction.id)}
                onClick={async () => {
                  if (!reviewBook) return;
                  setExtractingIds((p) => new Set(p).add(extraction.id));
                  try {
                    await resetExtractionGrid(extraction.id);
                    const r = await extractPriceBookTable(extraction.id);
                    toast({ title: 'Re-extracted', description: `${r.rowCount}×${r.colCount}, ${r.cellCount} prices. Go back to review the updated grid.` });
                    await reloadBookExtractions(reviewBook);
                    setExtraction(null); // return to list so user sees the fresh result
                  } catch (err) {
                    toast({ title: 'Re-extraction failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
                  } finally {
                    setExtractingIds((p) => { const n = new Set(p); n.delete(extraction.id); return n; });
                  }
                }}
              >
                {extractingIds.has(extraction.id)
                  ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Re-extracting…</>
                  : <><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Re-extract grid</>}
              </Button>
            </CardContent>
          </Card>
        )}

        {extraction.warnings.length > 0 && (extraction.grid.cells.length > 0 || extraction.grid.rowLabels.length > 0) && (
          <Card className="border-amber-500/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-amber-600">
                <AlertCircle className="h-4 w-4" /> Agent warnings
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <ul className="list-disc pl-5 text-sm text-muted-foreground">{extraction.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={extractingIds.has(extraction.id)}
                onClick={async () => {
                  if (!reviewBook) return;
                  setExtractingIds((p) => new Set(p).add(extraction.id));
                  try {
                    await resetExtractionGrid(extraction.id);
                    const r = await extractPriceBookTable(extraction.id);
                    toast({ title: 'Re-extracted', description: `${r.rowCount}×${r.colCount}, ${r.cellCount} prices.` });
                    await reloadBookExtractions(reviewBook);
                    setExtraction(null);
                  } catch (err) {
                    toast({ title: 'Re-extraction failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
                  } finally {
                    setExtractingIds((p) => { const n = new Set(p); n.delete(extraction.id); return n; });
                  }
                }}
              >
                {extractingIds.has(extraction.id)
                  ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Re-extracting…</>
                  : <><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Re-extract</>}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Table details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Table name</Label>
              <Input value={reviewName} onChange={(e) => setReviewName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={reviewCategory} onValueChange={(v) => setReviewCategory(v as PriceBookCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Series / product line</Label>
              <Input value={reviewSeries} onChange={(e) => setReviewSeries(e.target.value)} placeholder="e.g. F Series" />
            </div>
            <div className="space-y-1">
              <Label>Table kind</Label>
              <Select value={reviewTableKind} onValueChange={(v) => setReviewTableKind(v as 'base' | 'component')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="base">Base — complete unit size grid</SelectItem>
                  <SelectItem value="component">Component — heads &amp; jambs sold separately (KD)</SelectItem>
                </SelectContent>
              </Select>
              {reviewTableKind === 'component' && (
                <p className="text-xs text-muted-foreground mt-1">
                  Used when <code className="bg-muted px-0.5 rounded text-[11px]">frame_construction=KD</code> is selected on the frame item.
                </p>
              )}
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Manufacturers</Label>
              <div className="flex flex-wrap gap-3 rounded-md border p-3">
                {manufacturers.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={reviewVendorIds.includes(m.id)} onCheckedChange={() => toggleVendor(m.id)} />
                    {m.name}
                  </label>
                ))}
                {manufacturers.length === 0 && <p className="text-xs text-muted-foreground">No manufacturers found.</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Series selectors (specs)</CardTitle>
            <CardDescription>
              The spec field values that route a configured item to this table for its manufacturer (e.g. doors: edge_construction + core_construction). A user picks these specs in the builder; the system resolves the matching manufacturer — no series needed.
              {(reviewCategory === 'doors' || reviewCategory === 'frames') && specDrafts.filter((s) => s.key.trim() && s.value.trim()).length === 0 && (
                <span className="block mt-1 text-destructive text-xs font-medium">
                  ⚠ Required for doors/frames — add at least one spec selector to enable spec-first pricing.
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Spec field key</TableHead><TableHead>Value</TableHead><TableHead className="w-10"></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {specDrafts.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Input className="h-8" value={s.key} placeholder="edge_construction"
                        onChange={(e) => setSpecDrafts((p) => p.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} />
                    </TableCell>
                    <TableCell>
                      <Input className="h-8" value={s.value} placeholder="Lockseam"
                        onChange={(e) => setSpecDrafts((p) => p.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => setSpecDrafts((p) => p.filter((_, j) => j !== i))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setSpecDrafts((p) => [...p, { key: '', value: '' }])}>
              Add spec selector
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Columns</CardTitle>
            <CardDescription>Map each column to a spec field (e.g. gauge) and value, or leave the field blank for label-based matching.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>#</TableHead><TableHead>Extracted label</TableHead><TableHead>Field key</TableHead><TableHead>Value</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {columnDrafts.map((c, i) => (
                  <TableRow key={c.gridCol}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{c.label}</TableCell>
                    <TableCell>
                      <Input className="h-8" value={c.fieldKey} placeholder="gauge"
                        onChange={(e) => setColumnDrafts((p) => p.map((x, j) => j === i ? { ...x, fieldKey: e.target.value } : x))} />
                    </TableCell>
                    <TableCell>
                      <Input className="h-8" value={c.value}
                        onChange={(e) => setColumnDrafts((p) => p.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rows</CardTitle>
            <CardDescription>Width and height were auto-split from the row label. Adjust if needed.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>#</TableHead><TableHead>Extracted label</TableHead><TableHead>Width</TableHead><TableHead>Height</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {rowDrafts.map((r, i) => (
                  <TableRow key={r.gridRow}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{r.label}</TableCell>
                    <TableCell>
                      <Input className="h-8" value={r.width}
                        onChange={(e) => setRowDrafts((p) => p.map((x, j) => j === i ? { ...x, width: e.target.value } : x))} />
                    </TableCell>
                    <TableCell>
                      <Input className="h-8" value={r.height}
                        onChange={(e) => setRowDrafts((p) => p.map((x, j) => j === i ? { ...x, height: e.target.value } : x))} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Extracted prices (preview)</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead></TableHead>
                  {columnDrafts.map((c) => <TableHead key={c.gridCol} className="text-xs">{c.label}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rowDrafts.map((r) => (
                  <TableRow key={r.gridRow}>
                    <TableCell className="text-xs font-medium">{r.label}</TableCell>
                    {columnDrafts.map((c) => {
                      const price = priceAt(r.gridRow, c.gridCol);
                      return <TableCell key={c.gridCol} className="text-xs">{price != null ? `$${price.toFixed(2)}` : '—'}</TableCell>;
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Diff preview — show when a matching table already exists */}
        {diffPreview && (
          <Card className={diffPreview.totalChanges > 0 ? 'border-amber-300' : 'border-green-300'}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                {diffPreview.totalChanges > 0
                  ? <><AlertCircle className="h-4 w-4 text-amber-500" />Existing table found — {diffPreview.totalChanges} change(s) will be applied</>
                  : <><CheckCircle2 className="h-4 w-4 text-green-500" />No changes — existing table is already up-to-date</>}
              </CardTitle>
              <CardDescription>
                Approving will <strong>update</strong> the existing pricing table rather than create a new one.
              </CardDescription>
            </CardHeader>
            {diffPreview.totalChanges > 0 && (
              <CardContent className="text-sm space-y-1">
                {diffPreview.addedRows.length > 0 && <p className="text-green-700">+ {diffPreview.addedRows.length} new row(s): {diffPreview.addedRows.slice(0, 3).join(', ')}{diffPreview.addedRows.length > 3 ? '…' : ''}</p>}
                {diffPreview.removedRows.length > 0 && <p className="text-destructive">− {diffPreview.removedRows.length} removed row(s)</p>}
                {diffPreview.addedColumns.length > 0 && <p className="text-green-700">+ {diffPreview.addedColumns.length} new column(s)</p>}
                {diffPreview.removedColumns.length > 0 && <p className="text-destructive">− {diffPreview.removedColumns.length} removed column(s)</p>}
                {diffPreview.changedCells.length > 0 && (
                  <p className="text-amber-700">{diffPreview.changedCells.length} price change(s) — avg {
                    (() => {
                      const withDelta = diffPreview.changedCells.filter((c) => c.pctDelta != null);
                      if (withDelta.length === 0) return 'n/a';
                      const avg = withDelta.reduce((s, c) => s + (c.pctDelta ?? 0), 0) / withDelta.length;
                      return `${avg > 0 ? '+' : ''}${avg.toFixed(1)}%`;
                    })()
                  }</p>
                )}
              </CardContent>
            )}
          </Card>
        )}

        <div className="flex justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleDiscard} disabled={approving}>Discard</Button>
            {reviewVendorIds.length === 1 && Object.keys(
              Object.fromEntries(specDrafts.filter((s) => s.key.trim() && s.value.trim()).map((s) => [s.key.trim(), s.value.trim()]))
            ).length > 0 && !diffPreview && (
              <Button
                variant="outline"
                disabled={diffLoading}
                onClick={async () => {
                  if (!extraction || !reviewBook) return;
                  setDiffLoading(true);
                  try {
                    const sc = Object.fromEntries(specDrafts.filter((s) => s.key.trim() && s.value.trim()).map((s) => [s.key.trim(), s.value.trim()]));
                    const existingId = await findMatchingPricingTable(reviewVendorIds[0], reviewCategory, sc, reviewTableKind);
                    if (existingId) {
                      const columns: ColumnMapping[] = columnDrafts.map((c) => {
                        const criteria: import('@/types').ColumnCriteria = c.fieldKey.trim() ? { [c.fieldKey.trim()]: c.value.trim() } : {};
                        return { gridCol: c.gridCol, label: c.label, criteria };
                      });
                      const rows: RowMapping[] = rowDrafts.map((r) => ({
                        gridRow: r.gridRow, label: r.label,
                        widthCriteria: r.width.trim() ? ({ type: 'raw', label: r.width.trim() } as import('@/types').DimensionCriteria) : {},
                        heightCriteria: r.height.trim() ? ({ type: 'raw', label: r.height.trim() } as import('@/types').DimensionCriteria) : {},
                      }));
                      const diff = await computeGridDiff(existingId, {
                        extractionId: extraction.id, priceBookId: reviewBook.id, category: reviewCategory,
                        seriesValue: reviewSeries, tableName: reviewName, vendorIds: reviewVendorIds,
                        columns, rows, grid: extraction.grid, selectionCriteria: sc,
                      });
                      setDiffPreview(diff);
                    } else {
                      toast({ title: 'No existing table', description: 'No pricing table matches these specs — will create a new one.' });
                    }
                  } catch (err) {
                    toast({ title: 'Diff check failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
                  } finally {
                    setDiffLoading(false);
                  }
                }}
              >
                {diffLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Check for existing table
              </Button>
            )}
          </div>
          <Button onClick={handleApprove} disabled={approving}>
            {approving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            {diffPreview ? 'Approve & update pricing table' : 'Approve & create pricing table'}
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- Table list (one book) view
  if (reviewBook) {
    const pendingCount = bookExtractions.filter((e) => e.status === 'pending').length;
    return (
      <div className="container mx-auto max-w-5xl space-y-6 p-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => { setReviewBook(null); setBookExtractions([]); setViewExtraction(null); }}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{reviewBook.name}</h1>
            <p className="text-sm text-muted-foreground">
              {bookExtractions.length} table{bookExtractions.length !== 1 ? 's' : ''} extracted · {pendingCount} pending review
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Extracted pricing tables</CardTitle>
                <CardDescription>Every table found in the book. Pull each grid, then map &amp; approve it into a pricing table.</CardDescription>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {/* One-click pipeline: extract → compile → approve (worker-only). */}
                  {hasPriceBookWorker && bookExtractions.some((e) => e.status !== 'approved' && e.status !== 'discarded') && (
                    <Button size="sm" onClick={processEntireBook} disabled={processingBook || extractingAll || compilingAll || approvingAll}>
                      {processingBook ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                      {processingBook ? 'Processing…' : 'Process entire book'}
                    </Button>
                  )}
                  {(extractingAll || bookExtractions.some((e) => e.status === 'pending' && !e.gridExtracted)) && (
                    <Button size="sm" variant="outline" onClick={extractAllGrids} disabled={extractingAll || processingBook}>
                      {extractingAll ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                      {extractingAll
                        ? (extractProgress
                            ? `Extracting ${extractProgress.done}/${extractProgress.total}${extractProgress.failed ? ` (${extractProgress.failed} failed)` : ''}…`
                            : 'Extracting…')
                        : 'Extract all grids'}
                    </Button>
                  )}
                  {hasPriceBookWorker && bookExtractions.some((e) => e.gridExtracted && e.status !== 'approved' && e.status !== 'discarded') && (
                    <Button size="sm" variant="outline" onClick={compileAllGrids} disabled={compilingAll || processingBook}>
                      {compilingAll ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                      {compilingAll ? 'Compiling…' : 'Compile all to rules'}
                    </Button>
                  )}
                  {bookExtractions.some((e) => e.status === 'compiled') && (
                    <Button size="sm" variant="outline" onClick={approveAllCompiled} disabled={approvingAll || processingBook}>
                      {approvingAll ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                      {approvingAll ? 'Approving…' : 'Approve all compiled'}
                    </Button>
                  )}
                  {!bookExtractions.some((e) => e.status === 'compiled') && bookExtractions.some((e) => e.status === 'approved' && e.priceBookDocumentId) && (
                    <Button size="sm" onClick={() => publishBook(false)} disabled={publishing || processingBook}>
                      {publishing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                      {publishing ? 'Publishing…' : 'Publish version'}
                    </Button>
                  )}
                </div>
                {processingBook && processPhase && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> {processPhase}
                  </p>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {bookExtractions.map((ext) => {
                const busy = extractingIds.has(ext.id);
                const gridEmpty = ext.gridExtracted && (ext.grid.cells.length === 0 || ext.grid.rowLabels.length === 0);
                const gridTruncated = ext.gridExtracted && ext.warnings.length > 0 && ext.grid.cells.length > 0;
                const needsReExtract = gridEmpty || gridTruncated;

                // Status badge
                const statusBadgeEl = ext.status === 'approved'
                  ? <Badge className="bg-green-600 hover:bg-green-600 shrink-0"><CheckCircle2 className="mr-1 h-3 w-3" />Approved</Badge>
                  : ext.status === 'discarded'
                    ? <Badge variant="outline" className="shrink-0">Discarded</Badge>
                    : ext.status === 'compiled'
                      ? <Badge className="bg-indigo-600 hover:bg-indigo-600 shrink-0">{ext.compiledRuleCount} rule(s) · review</Badge>
                    : gridEmpty
                      ? <Badge variant="destructive" className="shrink-0"><AlertCircle className="mr-1 h-3 w-3" />Empty grid</Badge>
                      : gridTruncated
                        ? <Badge className="bg-amber-500 hover:bg-amber-500 shrink-0"><AlertCircle className="mr-1 h-3 w-3" />Truncated</Badge>
                        : ext.gridExtracted
                          ? <Badge variant="secondary" className="shrink-0">Ready to compile</Badge>
                          : <Badge variant="outline" className="text-muted-foreground shrink-0">Not extracted</Badge>;

                return (
                  <div key={ext.id} className="flex items-center gap-4 px-6 py-4">
                    {/* Left: title + meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{ext.title ?? 'Untitled table'}</span>
                        {statusBadgeEl}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {ext.kind && (
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                            {ext.kind.replace(/_/g, ' ')}
                          </span>
                        )}
                        {ext.detectedCategory && (
                          <span className="text-[11px] text-muted-foreground capitalize">
                            {ext.detectedCategory.replace(/_/g, ' ')}
                          </span>
                        )}
                        {ext.detectedSeries && (
                          <span className="text-[11px] text-muted-foreground">
                            Series: {ext.detectedSeries}
                          </span>
                        )}
                        {ext.gridExtracted && (
                          <span className={`text-[11px] font-medium ${gridEmpty ? 'text-destructive' : gridTruncated ? 'text-amber-600' : 'text-muted-foreground'}`}>
                            {gridEmpty
                              ? '0 rows · 0 prices'
                              : `${ext.grid.rowLabels.length} rows × ${ext.grid.columnLabels.length} cols · ${ext.grid.cells.length} prices`}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: action buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Approved: view grid + (CPQ v2) view compiled rules */}
                      {ext.status === 'approved' && (
                        <>
                          {ext.sourceRegionId && (
                            <Button size="sm" variant="outline" onClick={() => setRuleReviewExt(ext)}>
                              <Eye className="mr-1.5 h-3.5 w-3.5" />Rules
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => setViewExtraction(ext)}>
                            <Eye className="mr-1.5 h-3.5 w-3.5" />Grid
                          </Button>
                        </>
                      )}

                      {/* Compiled: review + approve the rules (CPQ v2) */}
                      {ext.status === 'compiled' && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            title="Re-compile rules from the extracted grid"
                            disabled={compilingIds.has(ext.id)}
                            onClick={() => compileGrid(ext)}
                          >
                            {compilingIds.has(ext.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          </Button>
                          <Button size="sm" onClick={() => setRuleReviewExt(ext)}>
                            Review rules
                          </Button>
                        </>
                      )}

                      {/* Pending + not yet extracted */}
                      {ext.status === 'pending' && !ext.gridExtracted && (
                        <Button size="sm" variant="outline" onClick={() => extractGrid(ext)} disabled={busy || extractingAll}>
                          {busy
                            ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                          Extract grid
                        </Button>
                      )}

                      {/* Pending + extracted: primary action + optional re-extract */}
                      {ext.status === 'pending' && ext.gridExtracted && (
                        <>
                          {/* Re-extract: prominent when grid is bad, subtle icon when grid is good */}
                          {needsReExtract ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className={gridEmpty ? 'border-destructive/60 text-destructive hover:bg-destructive/10' : 'border-amber-400 text-amber-700 hover:bg-amber-50'}
                              onClick={() => reExtractGrid(ext)}
                              disabled={busy || extractingAll}
                            >
                              {busy
                                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                              Re-extract
                            </Button>
                          ) : (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              title="Re-extract grid (retry if any prices look wrong)"
                              disabled={busy || extractingAll}
                              onClick={() => reExtractGrid(ext)}
                            >
                              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            </Button>
                          )}

                          {hasPriceBookWorker && !needsReExtract && (
                            <Button size="sm" onClick={() => compileGrid(ext)} disabled={busy || compilingIds.has(ext.id)}>
                              {compilingIds.has(ext.id) ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                              Compile to rules
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => openTable(reviewBook, ext)} disabled={busy} title="Legacy grid mapping (retired at cutover)">
                            Map (legacy)
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---------------------------------------------------------------- List view
  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Price Book Ingestion</h1>
        <p className="text-sm text-muted-foreground">
          Upload a manufacturer price list (PDF, image, Excel, or CSV). The system extracts the price grid for you to review and approve into a pricing table.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Upload a price book</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pioneer CH Doors 2026" />
          </div>
          <div className="space-y-1">
            <Label>Manufacturer</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger><SelectValue placeholder="Select manufacturer" /></SelectTrigger>
              <SelectContent>{manufacturers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Category (hint)</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as PriceBookCategory)}>
              <SelectTrigger><SelectValue placeholder="Auto-detect" /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>File</Label>
            <Input type="file" accept=".pdf,.png,.jpg,.jpeg,.gif,.csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1">
            <Label>Effective date <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">When these prices take effect (e.g. 2026-01-01)</p>
          </div>
          <div className="space-y-1">
            <Label>Supersedes <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Select value={supersedesId} onValueChange={setSupersedesId}>
              <SelectTrigger><SelectValue placeholder="None — first upload for this manufacturer" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {books.filter((b) => b.companyId === companyId && b.ocrStatus === 'done').map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}{b.effectiveDate ? ` (${b.effectiveDate})` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Select a prior book that this upload replaces</p>
          </div>
          <div className="sm:col-span-2">
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Upload & extract
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Price books</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : books.length === 0 ? (
            <p className="text-sm text-muted-foreground">No price books uploaded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {books.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" />{b.name}</div>
                      {b.effectiveDate && <p className="text-xs text-muted-foreground mt-0.5">Effective {b.effectiveDate}</p>}
                      {b.ocrError && <p className="mt-1 text-xs text-destructive">{b.ocrError}</p>}
                    </TableCell>
                    <TableCell className="capitalize">{b.category?.replace(/_/g, ' ') ?? '—'}</TableCell>
                    <TableCell>{statusBadge(b.ocrStatus)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {hasPriceBookWorker && b.category === 'hardware' && (b.fileType === 'xlsx' || b.fileType === 'csv') && (
                          <Button size="sm" variant="outline" onClick={() => handleIngestHardware(b)} disabled={hardwareIngestingId === b.id}>
                            {hardwareIngestingId === b.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                            Ingest hardware
                          </Button>
                        )}
                        {hasPriceBookWorker && b.category === 'lites_louvers_glass' && (b.fileType === 'xlsx' || b.fileType === 'csv') && (
                          <Button size="sm" variant="outline" onClick={() => handleIngestNgp(b)} disabled={ngpIngestingId === b.id}>
                            {ngpIngestingId === b.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                            Ingest NGP catalog
                          </Button>
                        )}
                        {b.ocrStatus === 'done' && (
                          <Button size="sm" onClick={() => openReview(b)}>Review &amp; approve</Button>
                        )}
                        {b.ocrStatus === 'error' && (
                          <Button size="sm" variant="outline" onClick={() => handleReingest(b)}>
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => handleDelete(b)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
