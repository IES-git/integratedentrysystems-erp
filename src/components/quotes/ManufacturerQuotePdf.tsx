import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { createDefaultAudienceDisplayConfig, resolveQuoteDocumentDisplayConfig, type QuoteDocumentDisplayConfigInput } from '@/lib/quote-display';
import type { OperationalOutputRow } from '@/lib/operational-outputs';
import type { Company, Quote, QuoteContextSnapshot } from '@/types';
import iesLogo from '@/assets/ies-logo.png';

const styles = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 8, paddingTop: 34, paddingBottom: 54, paddingHorizontal: 34, color: '#111827' },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 14, marginBottom: 14, borderBottom: '1.5pt solid #111827' },
  logo: { width: 126, objectFit: 'contain' },
  titleBlock: { alignItems: 'flex-end', gap: 2 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 17, letterSpacing: 1.4 },
  subtitle: { color: '#6b7280', fontSize: 7, letterSpacing: 0.7 },
  meta: { fontSize: 8, color: '#374151' },
  infoGrid: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  infoBox: { flex: 1, padding: 8, backgroundColor: '#f8fafc', border: '0.5pt solid #e5e7eb' },
  infoLabel: { fontFamily: 'Helvetica-Bold', fontSize: 6.5, color: '#6b7280', letterSpacing: 0.6, marginBottom: 3, textTransform: 'uppercase' },
  infoStrong: { fontFamily: 'Helvetica-Bold', fontSize: 8.5, marginBottom: 2 },
  infoLine: { color: '#374151', fontSize: 7.5, lineHeight: 1.35 },
  instruction: { padding: 9, marginBottom: 14, backgroundColor: '#eff6ff', borderLeft: '3pt solid #2563eb' },
  instructionTitle: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: '#1e3a8a', marginBottom: 3 },
  instructionText: { color: '#1e3a8a', fontSize: 7.5, lineHeight: 1.4 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#1f2937', paddingVertical: 6, paddingHorizontal: 8, marginBottom: 7 },
  sectionHeaderText: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 7.5, letterSpacing: 0.5 },
  sectionHeaderMeta: { color: '#d1d5db', fontSize: 7 },
  item: { border: '0.5pt solid #d1d5db', marginBottom: 9 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, padding: 7, backgroundColor: '#f3f4f6', borderBottom: '0.5pt solid #d1d5db' },
  itemIdentity: { flex: 1 },
  itemTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9, marginBottom: 2 },
  itemSub: { color: '#4b5563', fontSize: 7.5 },
  qtyBox: { minWidth: 62, alignItems: 'flex-end' },
  qtyLabel: { color: '#6b7280', fontSize: 6.5 },
  qty: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  callout: { paddingHorizontal: 7, paddingVertical: 5, backgroundColor: '#fffbeb', borderBottom: '0.5pt solid #fde68a' },
  calloutLabel: { fontFamily: 'Helvetica-Bold', fontSize: 6.5, color: '#92400e' },
  calloutValue: { fontSize: 7.5, color: '#78350f', marginTop: 1 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 3, paddingHorizontal: 4 },
  detailCell: { width: '25%', paddingVertical: 4, paddingHorizontal: 4 },
  detailLabel: { color: '#6b7280', fontSize: 6.5, marginBottom: 1 },
  detailValue: { color: '#1f2937', fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
  specs: { padding: 7, borderTop: '0.5pt solid #e5e7eb' },
  specsTitle: { fontFamily: 'Helvetica-Bold', color: '#4b5563', fontSize: 6.5, letterSpacing: 0.4, marginBottom: 4 },
  specGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  spec: { width: '33.333%', paddingRight: 8, paddingBottom: 3 },
  specText: { fontSize: 7, color: '#374151', lineHeight: 1.3 },
  specLabel: { fontFamily: 'Helvetica-Bold' },
  notes: { marginTop: 5, padding: 9, border: '0.5pt solid #d1d5db' },
  notesTitle: { fontFamily: 'Helvetica-Bold', fontSize: 7, marginBottom: 3 },
  notesText: { fontSize: 7.5, lineHeight: 1.4, color: '#374151' },
  footer: { position: 'absolute', left: 34, right: 34, bottom: 25, paddingTop: 7, borderTop: '0.5pt solid #d1d5db', flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { color: '#6b7280', fontSize: 6.5 },
});

interface ManufacturerQuotePdfProps {
  quote: Quote;
  rows: OperationalOutputRow[];
  manufacturerName: string;
  company: Company | null;
  context?: QuoteContextSnapshot | null;
  displayConfig?: QuoteDocumentDisplayConfigInput;
}

function addressLines(context: QuoteContextSnapshot | null | undefined, company: Company | null): string[] {
  const job = context?.job;
  const companySnapshot = context?.company;
  const street = job?.shipToAddress || companySnapshot?.shippingAddress || company?.shippingAddress || companySnapshot?.billingAddress || company?.billingAddress;
  const city = job?.shipToCity || companySnapshot?.shippingCity || company?.shippingCity || companySnapshot?.billingCity || company?.billingCity;
  const state = job?.shipToState || companySnapshot?.shippingState || company?.shippingState || companySnapshot?.billingState || company?.billingState;
  const zip = job?.shipToZip || companySnapshot?.shippingZip || company?.shippingZip || companySnapshot?.billingZip || company?.billingZip;
  return [street, [city, state, zip].filter(Boolean).join(', ')].filter((value): value is string => Boolean(value));
}

function detailPairs(row: OperationalOutputRow): Array<[string, string]> {
  return [
    ['Opening', row.openingMark], ['Product type', row.entityType], ['Category', row.category],
    ['Part / series', row.partNumber], ['Size', row.size], ['Finish', row.finish],
    ['Cutout size', row.cutoutSize], ['Kit order size', row.kitOrderSize],
    ['Visible glass', row.visibleGlassSize], ['Glass type', row.glassType],
  ].filter((pair) => pair[1]);
}

function uniqueSpecs(row: OperationalOutputRow): OperationalOutputRow['specifications'] {
  const known = new Set(['opening', 'mark', 'size', 'finish', 'quantity', 'qty', 'part number', 'product code']);
  const seen = new Set<string>();
  return row.specifications.filter((spec) => {
    const key = (spec.label || spec.key).trim().toLowerCase();
    if (!spec.value || known.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function ManufacturerQuotePdf({ quote, rows, manufacturerName, company, context, displayConfig }: ManufacturerQuotePdfProps) {
  const { audienceConfig } = resolveQuoteDocumentDisplayConfig(
    displayConfig ?? createDefaultAudienceDisplayConfig('manufacturer'),
    'manufacturer',
  );
  const rfqNumber = `RFQ-${quote.id.slice(-8).toUpperCase()}`;
  const job = context?.job;
  const shipTo = addressLines(context, company);
  const openings = new Set(rows.map((row) => row.openingMark).filter((mark) => mark !== 'Unassigned'));
  const date = new Date(quote.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <Document title={`${rfqNumber} - ${manufacturerName}`} author="Integrated Entry Systems" subject={`Manufacturer RFQ for ${manufacturerName}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Image src={iesLogo} style={styles.logo} />
          <View style={styles.titleBlock}>
            <Text style={styles.title}>REQUEST FOR QUOTE</Text>
            <Text style={styles.subtitle}>MANUFACTURER-SPECIFIC PROCUREMENT SCOPE</Text>
            <Text style={styles.meta}>{rfqNumber} · {date}</Text>
          </View>
        </View>

        <View style={styles.infoGrid}>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Requested From</Text>
            <Text style={styles.infoStrong}>{manufacturerName}</Text>
            <Text style={styles.infoLine}>{rows.length} line item{rows.length === 1 ? '' : 's'} · {openings.size} opening{openings.size === 1 ? '' : 's'}</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Project</Text>
            <Text style={styles.infoStrong}>{job?.jobName || 'Project not specified'}</Text>
            {job?.jobNumber && <Text style={styles.infoLine}>Job: {job.jobNumber}</Text>}
            {job?.jobLocation && <Text style={styles.infoLine}>Location: {job.jobLocation}</Text>}
            {job?.customerPo && <Text style={styles.infoLine}>Customer PO: {job.customerPo}</Text>}
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Ship To</Text>
            {company?.name && <Text style={styles.infoStrong}>{company.name}</Text>}
            {shipTo.length ? shipTo.map((line) => <Text key={line} style={styles.infoLine}>{line}</Text>) : <Text style={styles.infoLine}>Confirm with IES before fulfillment</Text>}
          </View>
        </View>

        <View style={styles.instruction}>
          <Text style={styles.instructionTitle}>QUOTE RESPONSE REQUEST</Text>
          <Text style={styles.instructionText}>{audienceConfig.termsText || 'Please quote only the items listed below and confirm unit pricing, freight, availability, lead time, and any specification exceptions.'}</Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>ITEMS REQUESTED FROM {manufacturerName.toUpperCase()}</Text>
          <Text style={styles.sectionHeaderMeta}>{rows.length} line{rows.length === 1 ? '' : 's'}</Text>
        </View>

        {rows.map((row, index) => {
          const specs = uniqueSpecs(row);
          return (
            <View key={`${row.openingId ?? 'none'}-${row.partNumber}-${index}`} style={styles.item}>
              <View style={styles.itemHeader}>
                <View style={styles.itemIdentity}>
                  <Text style={styles.itemTitle}>{index + 1}. {row.description || row.partNumber || 'Specified item'}</Text>
                  <Text style={styles.itemSub}>{row.openingMark !== 'Unassigned' ? `Opening ${row.openingMark}` : 'Opening not assigned'}{row.partNumber ? ` · ${row.partNumber}` : ''}</Text>
                </View>
                <View style={styles.qtyBox}><Text style={styles.qtyLabel}>QUANTITY</Text><Text style={styles.qty}>{row.quantity} {row.uom}</Text></View>
              </View>
              {row.frameOrderCallout && <View style={styles.callout}><Text style={styles.calloutLabel}>ORDER CALLOUT</Text><Text style={styles.calloutValue}>{row.frameOrderCallout}</Text></View>}
              <View style={styles.detailGrid}>
                {detailPairs(row).map(([label, value]) => <View key={label} style={styles.detailCell}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>)}
              </View>
              {specs.length > 0 && <View style={styles.specs}><Text style={styles.specsTitle}>TECHNICAL SPECIFICATIONS</Text><View style={styles.specGrid}>{specs.map((spec) => <View key={`${spec.key}-${spec.label}`} style={styles.spec}><Text style={styles.specText}><Text style={styles.specLabel}>{spec.label || spec.key}: </Text>{spec.value}</Text></View>)}</View></View>}
            </View>
          );
        })}

        {(quote.notes || audienceConfig.customText.trim()) && <View style={styles.notes}><Text style={styles.notesTitle}>PROJECT / PROCUREMENT NOTES</Text>{quote.notes && <Text style={styles.notesText}>{quote.notes}</Text>}{audienceConfig.customText.trim() && <Text style={styles.notesText}>{audienceConfig.customText}</Text>}</View>}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{rfqNumber} · {manufacturerName} · Confidential</Text>
          <Text style={styles.footerText}>Integrated Entry Systems · procurement@ies-access.com</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
