import { useEffect, useState } from 'react';
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, ArrowLeft, Trash2, Sparkles, RefreshCw } from 'lucide-react';
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
  type ColumnMapping, type RowMapping,
} from '@/lib/price-books-api';
import { getProposalForExtraction } from '@/lib/pricing-proposals-api';
import type {
  PriceBook, PriceBookCategory, PriceBookExtraction, Company, ColumnCriteria, DimensionCriteria,
} from '@/types';

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

  // Review state
  const [reviewBook, setReviewBook] = useState<PriceBook | null>(null);
  const [bookExtractions, setBookExtractions] = useState<PriceBookExtraction[]>([]);
  const [extraction, setExtraction] = useState<PriceBookExtraction | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [reviewName, setReviewName] = useState('');
  const [reviewCategory, setReviewCategory] = useState<PriceBookCategory>('doors');
  const [reviewSeries, setReviewSeries] = useState('');
  const [reviewVendorIds, setReviewVendorIds] = useState<string[]>([]);
  const [columnDrafts, setColumnDrafts] = useState<ColumnDraft[]>([]);
  const [rowDrafts, setRowDrafts] = useState<RowDraft[]>([]);
  const [approving, setApproving] = useState(false);

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
      });
      toast({ title: 'Uploaded', description: 'Scanning the whole book for every pricing table (this can take a minute)…' });
      setName(''); setFile(null); setCategory(''); setCompanyId('');
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
    } catch (err) {
      toast({ title: 'Failed to open review', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  const reloadBookExtractions = async (book: PriceBook) => {
    try {
      setBookExtractions(await listExtractionsForBook(book.id));
    } catch { /* ignore */ }
  };

  const [extractingIds, setExtractingIds] = useState<Set<string>>(new Set());
  const [extractingAll, setExtractingAll] = useState(false);

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

  /** Extract all not-yet-pulled grids with bounded concurrency. */
  const extractAllGrids = async () => {
    if (!reviewBook) return;
    const pending = bookExtractions.filter((e) => e.status === 'pending' && !e.gridExtracted);
    if (pending.length === 0) return;
    setExtractingAll(true);
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
      });
      toast({ title: 'Pricing table created', description: `${result.cellsWritten} prices written across ${result.rowsCreated}×${result.columnsCreated}.` });
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

        {extraction.warnings.length > 0 && (
          <Card className="border-amber-500/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-amber-600">
                <AlertCircle className="h-4 w-4" /> Agent warnings
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <ul className="list-disc pl-5">{extraction.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
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
              <Input value={reviewSeries} onChange={(e) => setReviewSeries(e.target.value)} placeholder="e.g. CH" />
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
                {manufacturers.length === 0 && <p className="text-xs text-muted-foreground">No manufacturers found.</p>}
              </div>
            </div>
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

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleDiscard} disabled={approving}>Discard</Button>
          <Button onClick={handleApprove} disabled={approving}>
            {approving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Approve & create pricing table
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
          <Button variant="ghost" size="icon" onClick={() => { setReviewBook(null); setBookExtractions([]); }}>
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
              {bookExtractions.some((e) => e.status === 'pending' && !e.gridExtracted) && (
                <Button size="sm" variant="outline" onClick={extractAllGrids} disabled={extractingAll}>
                  {extractingAll ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                  Extract all grids
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead><TableHead>Category</TableHead><TableHead>Series</TableHead>
                  <TableHead>Size</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookExtractions.map((ext) => {
                  const busy = extractingIds.has(ext.id);
                  return (
                    <TableRow key={ext.id}>
                      <TableCell>
                        <div className="font-medium">{ext.title ?? 'Untitled table'}</div>
                        {ext.kind && <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{ext.kind.replace(/_/g, ' ')}</div>}
                        {ext.warnings.length > 0 && <div className="mt-0.5 text-xs text-amber-600">{ext.warnings.length} warning(s)</div>}
                      </TableCell>
                      <TableCell className="capitalize">{ext.detectedCategory?.replace(/_/g, ' ') ?? '—'}</TableCell>
                      <TableCell>{ext.detectedSeries ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {ext.gridExtracted ? `${ext.grid.rowLabels.length}×${ext.grid.columnLabels.length} · ${ext.grid.cells.length} prices` : '—'}
                      </TableCell>
                      <TableCell>
                        {ext.status === 'approved'
                          ? <Badge className="bg-green-600 hover:bg-green-600"><CheckCircle2 className="mr-1 h-3 w-3" />Approved</Badge>
                          : ext.status === 'discarded'
                            ? <Badge variant="outline">Discarded</Badge>
                            : ext.gridExtracted
                              ? <Badge variant="secondary">Ready to map</Badge>
                              : <Badge variant="outline">Not extracted</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        {ext.status === 'pending' && (
                          ext.gridExtracted
                            ? <Button size="sm" onClick={() => openTable(reviewBook, ext)}>Map &amp; approve</Button>
                            : <Button size="sm" variant="outline" onClick={() => extractGrid(ext)} disabled={busy || extractingAll}>
                                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                                Extract grid
                              </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
          Upload a manufacturer price list (PDF, image, or CSV). The agent extracts the price grid for you to review and approve into a pricing table.
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
            <Input type="file" accept=".pdf,.png,.jpg,.jpeg,.gif,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
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
                      {b.ocrError && <p className="mt-1 text-xs text-destructive">{b.ocrError}</p>}
                    </TableCell>
                    <TableCell className="capitalize">{b.category?.replace(/_/g, ' ') ?? '—'}</TableCell>
                    <TableCell>{statusBadge(b.ocrStatus)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
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
