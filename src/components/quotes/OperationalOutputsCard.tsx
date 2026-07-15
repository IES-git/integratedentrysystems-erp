import { useEffect, useMemo, useState } from 'react';
import { Download, PackageCheck, ShoppingCart, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  buildKittingRows,
  buildOperationalOutputRows,
  groupOperationalRowsByManufacturer,
  manufacturerRfqFilename,
  operationalOutputFilename,
  operationalRowsToCsv,
  type OperationalOutputRow,
  type VendorExportPreset,
} from '@/lib/operational-outputs';
import type { QuoteContextSnapshot, QuoteLineSnapshot } from '@/types';

function downloadText(value: string, filename: string) {
  const blob = new Blob([value], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function money(value: number | null, currency: string): string {
  if (value == null) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}

function RowsTable({ rows, currency, kitting = false }: { rows: OperationalOutputRow[]; currency: string; kitting?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Opening</TableHead>
            {!kitting && <TableHead>Vendor</TableHead>}
            <TableHead>Part</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Qty</TableHead>
            <TableHead>Size / Finish</TableHead>
            <TableHead>Lite / Glass Detail</TableHead>
            {!kitting && <TableHead className="text-right">Net</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 100).map((row, index) => (
            <TableRow key={`${row.openingId ?? 'none'}-${row.partNumber}-${index}`}>
              <TableCell className="font-medium">{row.openingMark}</TableCell>
              {!kitting && <TableCell>{row.vendor}</TableCell>}
              <TableCell className="font-mono text-xs">{row.partNumber || '-'}</TableCell>
              <TableCell className="max-w-xs"><span className="line-clamp-2">{row.description || '-'}</span></TableCell>
              <TableCell className="tabular-nums">{row.quantity} {row.uom}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {[row.size, row.finish].filter(Boolean).join(' · ') || '-'}
              </TableCell>
              <TableCell className="min-w-[190px] text-xs text-muted-foreground">
                {row.cutoutSize && <div><span className="font-medium text-foreground">Cutout:</span> {row.cutoutSize}</div>}
                {row.kitOrderSize && <div><span className="font-medium text-foreground">Kit:</span> {row.kitOrderSize}</div>}
                {row.visibleGlassSize && <div><span className="font-medium text-foreground">Visible:</span> {row.visibleGlassSize}</div>}
                {row.glassType && <div><span className="font-medium text-foreground">Glass:</span> {row.glassType}</div>}
                {!row.cutoutSize && !row.kitOrderSize && !row.visibleGlassSize && !row.glassType && '-'}
              </TableCell>
              {!kitting && <TableCell className="text-right tabular-nums">{money(row.extendedNet, currency)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > 100 && <p className="border-t px-3 py-2 text-xs text-muted-foreground">Showing the first 100 of {rows.length} rows. The CSV contains all rows.</p>}
    </div>
  );
}

export function OperationalOutputsCard({
  snapshots,
  context,
  currency,
}: {
  snapshots: QuoteLineSnapshot[];
  context?: QuoteContextSnapshot | null;
  currency: string;
}) {
  const [vendorPreset, setVendorPreset] = useState<VendorExportPreset>('internal');
  const rows = useMemo(() => buildOperationalOutputRows(snapshots, context), [context, snapshots]);
  const kittingRows = useMemo(() => buildKittingRows(rows), [rows]);
  const manufacturerGroups = useMemo(() => groupOperationalRowsByManufacturer(rows), [rows]);
  const [manufacturerKey, setManufacturerKey] = useState('');
  useEffect(() => {
    if (!manufacturerGroups.some((group) => group.key === manufacturerKey)) {
      setManufacturerKey(manufacturerGroups[0]?.key ?? '');
    }
  }, [manufacturerGroups, manufacturerKey]);
  const selectedManufacturer = manufacturerGroups.find((group) => group.key === manufacturerKey) ?? manufacturerGroups[0];

  if (snapshots.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operations Outputs</CardTitle>
          <CardDescription>This legacy quote has no immutable detail snapshot. Re-save it before generating BOM or purchasing files.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Operations Outputs</CardTitle>
            <CardDescription>BOM, working vendor exports, and an opening-based hardware pick list generated from the saved quote snapshot.</CardDescription>
          </div>
          <Badge variant="secondary">{rows.length} snapshot lines</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="bom" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="bom"><PackageCheck className="mr-1.5 h-3.5 w-3.5" />BOM</TabsTrigger>
            <TabsTrigger value="vendor"><ShoppingCart className="mr-1.5 h-3.5 w-3.5" />Vendor</TabsTrigger>
            <TabsTrigger value="kitting"><Wrench className="mr-1.5 h-3.5 w-3.5" />Kitting</TabsTrigger>
          </TabsList>

          <TabsContent value="bom" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">Complete internal detail by opening, including list, net, sell, margin, vendor, and order callout columns.</p>
              <Button size="sm" variant="outline" onClick={() => downloadText(
                operationalRowsToCsv(rows, 'internal'),
                operationalOutputFilename('bom', context),
              )}><Download className="mr-1.5 h-3.5 w-3.5" />BOM CSV</Button>
            </div>
            <RowsTable rows={rows} currency={currency} />
          </TabsContent>

          <TabsContent value="vendor" className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">Working column mappings are ready for client/vendor template validation; they are not claimed as final manufacturer forms.</p>
              <div className="flex flex-wrap gap-2">
                <Select value={selectedManufacturer?.key ?? ''} onValueChange={setManufacturerKey}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="Manufacturer" /></SelectTrigger>
                  <SelectContent>
                    {manufacturerGroups.map((group) => (
                      <SelectItem key={group.key} value={group.key}>{group.manufacturerName} ({group.rows.length})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={vendorPreset} onValueChange={(value) => setVendorPreset(value as VendorExportPreset)}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">Internal purchasing</SelectItem>
                    <SelectItem value="ceco">CECO working map</SelectItem>
                    <SelectItem value="pioneer">Pioneer working map</SelectItem>
                    <SelectItem value="de_la_fontaine">De La Fontaine map</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" disabled={!selectedManufacturer} onClick={() => selectedManufacturer && downloadText(
                  operationalRowsToCsv(selectedManufacturer.rows, vendorPreset),
                  manufacturerRfqFilename(context, selectedManufacturer.manufacturerName, 'csv'),
                )}><Download className="mr-1.5 h-3.5 w-3.5" />Manufacturer CSV</Button>
              </div>
            </div>
            {selectedManufacturer && <RowsTable rows={selectedManufacturer.rows} currency={currency} />}
          </TabsContent>

          <TabsContent value="kitting" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">Hardware-only pick list by opening. Customer/installer export intentionally excludes price and margin.</p>
              <Button size="sm" variant="outline" disabled={kittingRows.length === 0} onClick={() => downloadText(
                operationalRowsToCsv(kittingRows, 'kitting'),
                operationalOutputFilename('kitting', context),
              )}><Download className="mr-1.5 h-3.5 w-3.5" />Kitting CSV</Button>
            </div>
            {kittingRows.length > 0
              ? <RowsTable rows={kittingRows} currency={currency} kitting />
              : <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No hardware lines were captured in this quote snapshot.</div>}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
