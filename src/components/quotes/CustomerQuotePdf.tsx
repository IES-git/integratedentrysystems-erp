import { Document, Page, Text, View, StyleSheet, Font, Image } from '@react-pdf/renderer';
import {
  buildCustomerDisplayRows,
  createDefaultAudienceDisplayConfig,
  getEffectiveQuoteDetailMode,
  getEffectiveVisibleColumns,
  getEnabledBlocks,
  hasHiddenDisplayLines,
  resolveQuoteDocumentDisplayConfig,
  type QuoteDocumentDisplayConfigInput,
} from '@/lib/quote-display';
import type { Quote, QuoteItem, Company, Contact } from '@/types';
import iesLogo from '@/assets/ies-logo.png';

Font.register({
  family: 'Helvetica',
  fonts: [],
});

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 40,
    color: '#1a1a1a',
    backgroundColor: '#ffffff',
  },
  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 28,
    paddingBottom: 20,
    borderBottom: '1.5pt solid #1a1a1a',
  },
  brandBlock: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
  logoImage: {
    width: 140,
    objectFit: 'contain',
  },
  quoteMetaBlock: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 3,
  },
  quoteTitle: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: '#1a1a1a',
    letterSpacing: 2,
  },
  quoteNumber: {
    fontSize: 9,
    color: '#6b7280',
  },
  quoteDate: {
    fontSize: 9,
    color: '#6b7280',
  },
  // ── Bill To / Ship To ───────────────────────────────────────────────────────
  addressSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
    gap: 16,
  },
  addressBlock: {
    flex: 1,
    flexDirection: 'column',
    gap: 2,
  },
  addressLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#9ca3af',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  addressCompany: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#1a1a1a',
  },
  addressLine: {
    fontSize: 8.5,
    color: '#374151',
    lineHeight: 1.4,
  },
  // ── Line Items Table ────────────────────────────────────────────────────────
  table: {
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 2,
    marginBottom: 0,
  },
  tableHeaderCell: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottom: '0.5pt solid #e5e7eb',
  },
  tableRowAlt: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottom: '0.5pt solid #e5e7eb',
    backgroundColor: '#f9fafb',
  },
  colDescription: { flex: 4 },
  colMark: { flex: 1.2 },
  colCode: { flex: 1.5 },
  colQty: { flex: 1, textAlign: 'center' },
  colUom: { flex: 0.9, textAlign: 'center' },
  colUnitPrice: { flex: 2, textAlign: 'right' },
  colTotal: { flex: 2, textAlign: 'right' },
  cellText: {
    fontSize: 8.5,
    color: '#374151',
    lineHeight: 1.3,
  },
  cellTextBold: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: '#1a1a1a',
  },
  // ── Totals ──────────────────────────────────────────────────────────────────
  totalsSection: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 24,
  },
  totalsBox: {
    width: 200,
    borderTop: '1pt solid #e5e7eb',
    paddingTop: 10,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalLabel: {
    fontSize: 8.5,
    color: '#6b7280',
  },
  totalValue: {
    fontSize: 8.5,
    color: '#374151',
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    marginTop: 4,
    borderTop: '1pt solid #1a1a1a',
  },
  grandTotalLabel: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#1a1a1a',
  },
  grandTotalValue: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#1a1a1a',
  },
  // ── Notes & Footer ──────────────────────────────────────────────────────────
  notesSection: {
    marginBottom: 20,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 3,
    borderLeft: '3pt solid #e5e7eb',
  },
  notesLabel: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  notesText: {
    fontSize: 8.5,
    color: '#374151',
    lineHeight: 1.5,
  },
  paymentTermsSection: {
    marginBottom: 16,
    flexDirection: 'row',
    gap: 6,
  },
  paymentTermsLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
  },
  paymentTermsValue: {
    fontSize: 8,
    color: '#6b7280',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTop: '0.5pt solid #e5e7eb',
  },
  footerText: {
    fontSize: 7.5,
    color: '#9ca3af',
  },
  footerThankYou: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
  },
  divider: {
    borderBottom: '0.5pt solid #e5e7eb',
    marginVertical: 12,
  },
  // ── AI Summary ──────────────────────────────────────────────────────────────
  summarySection: {
    marginBottom: 22,
    padding: 14,
    backgroundColor: '#f0f7ff',
    borderRadius: 4,
    borderLeft: '3pt solid #3b82f6',
  },
  summaryLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#3b82f6',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  summaryText: {
    fontSize: 9,
    color: '#1e3a5f',
    lineHeight: 1.6,
  },
  scopeSection: {
    marginBottom: 18,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 3,
    borderLeft: '3pt solid #374151',
  },
  scopeLabel: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  scopeText: {
    fontSize: 8.5,
    color: '#374151',
    lineHeight: 1.45,
  },
  documentMessageSection: {
    marginBottom: 16,
    padding: 10,
    backgroundColor: '#f9fafb',
    borderRadius: 3,
    borderLeft: '3pt solid #9ca3af',
  },
  documentMessageLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  documentMessageText: {
    fontSize: 8,
    color: '#374151',
    lineHeight: 1.45,
  },
  tableNotice: {
    marginTop: 6,
    fontSize: 7.5,
    color: '#6b7280',
  },
});

const fmt = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

interface CustomerQuotePdfProps {
  quote: Quote;
  items: QuoteItem[];
  company: Company | null;
  primaryContact?: Contact | null;
  aiSummary?: string | null;
  displayConfig?: QuoteDocumentDisplayConfigInput;
}

export function CustomerQuotePdf({
  quote,
  items,
  company,
  primaryContact,
  aiSummary,
  displayConfig,
}: CustomerQuotePdfProps) {
  const { documentConfig, audienceConfig: config } = resolveQuoteDocumentDisplayConfig(
    displayConfig ?? createDefaultAudienceDisplayConfig('customer'),
    'customer',
  );
  const detailMode = getEffectiveQuoteDetailMode(config, documentConfig);
  const visibleColumns = new Set(getEffectiveVisibleColumns(config, documentConfig));
  const enabledBlocks = getEnabledBlocks(config);
  const displayRows = buildCustomerDisplayRows(items, config, {
    organizationMode: documentConfig?.organizationMode,
    detailMode,
  });
  const hiddenLines = hasHiddenDisplayLines(items, config);
  const quoteNumber = `Q-${quote.id.slice(-8).toUpperCase()}`;
  const createdDate = new Date(quote.createdAt);
  const quoteDate = createdDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const validUntilDate = documentConfig
    ? new Date(createdDate.getTime() + documentConfig.validityDays * 24 * 60 * 60 * 1000)
    : null;
  const validUntil = validUntilDate
    ? validUntilDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const billingLines = [
    company?.billingAddress,
    [company?.billingCity, company?.billingState, company?.billingZip]
      .filter(Boolean)
      .join(', '),
  ].filter(Boolean);

  const contactName = primaryContact
    ? `${primaryContact.firstName} ${primaryContact.lastName}`
    : null;
  const contactEmail = primaryContact?.email ?? null;

  const paymentTerms = company?.settings?.paymentTerms ?? 'Net 30';
  const overviewText = config.summaryText.trim() || aiSummary || '';
  const termsText =
    config.termsText.trim() ||
    (documentConfig ? `Pricing is valid for ${documentConfig.validityDays} days.` : paymentTerms);
  const headerText = documentConfig?.headerText.trim() ?? '';
  const footerText = documentConfig?.footerText.trim() || 'Thank you for your business!';
  const disclaimerText = documentConfig?.disclaimerText.trim() ?? '';

  return (
    <Document
      title={`Quote ${quoteNumber}`}
      author="Integrated Entry Systems"
      subject="Customer Quote"
    >
      <Page size="LETTER" style={styles.page}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.brandBlock}>
            <Image src={iesLogo} style={styles.logoImage} />
          </View>
          <View style={styles.quoteMetaBlock}>
            <Text style={styles.quoteTitle}>QUOTE</Text>
            <Text style={styles.quoteNumber}>Quote No: {quoteNumber}</Text>
            <Text style={styles.quoteDate}>Date: {quoteDate}</Text>
            {validUntil && <Text style={styles.quoteDate}>Valid Until: {validUntil}</Text>}
          </View>
        </View>

        {headerText && (
          <View style={styles.documentMessageSection}>
            <Text style={styles.documentMessageLabel}>Header</Text>
            <Text style={styles.documentMessageText}>{headerText}</Text>
          </View>
        )}

        {enabledBlocks.map((block) => {
          if (block.id === 'project') {
            return (
              <View key={block.id} style={styles.addressSection}>
                <View style={styles.addressBlock}>
                  <Text style={styles.addressLabel}>Bill To</Text>
                  {company && <Text style={styles.addressCompany}>{company.name}</Text>}
                  {contactName && <Text style={styles.addressLine}>{contactName}</Text>}
                  {contactEmail && <Text style={styles.addressLine}>{contactEmail}</Text>}
                  {billingLines.map((line, i) => (
                    <Text key={i} style={styles.addressLine}>{line}</Text>
                  ))}
                </View>
                <View style={styles.addressBlock}>
                  <Text style={styles.addressLabel}>From</Text>
                  <Text style={styles.addressCompany}>Integrated Entry Systems</Text>
                  <Text style={styles.addressLine}>Commercial Door &amp; Hardware</Text>
                  <Text style={styles.addressLine}>solutions@ies-access.com</Text>
                </View>
              </View>
            );
          }

          if (block.id === 'summary' && overviewText) {
            return (
              <View key={block.id} style={styles.summarySection}>
                <Text style={styles.summaryLabel}>{block.title}</Text>
                <Text style={styles.summaryText}>{overviewText}</Text>
              </View>
            );
          }

          if (block.id === 'scope' && config.scopeText.trim()) {
            return (
              <View key={block.id} style={styles.scopeSection}>
                <Text style={styles.scopeLabel}>{block.title}</Text>
                <Text style={styles.scopeText}>{config.scopeText}</Text>
              </View>
            );
          }

          if (block.id === 'lineItems') {
            const isSummary = detailMode === 'summary';
            const showMark = visibleColumns.has('mark');
            const showDescription = visibleColumns.has('description') || !showMark;
            const showProductCodes = !isSummary && visibleColumns.has('product_code');
            const showQuantities = !isSummary && visibleColumns.has('quantity');
            const showUom = !isSummary && visibleColumns.has('uom');
            const showUnitPrices = !isSummary && visibleColumns.has('unit_price');
            const showLineTotals = visibleColumns.has('line_total');

            return (
              <View key={block.id} style={styles.table}>
                <View style={styles.tableHeader}>
                  {showMark && (
                    <View style={styles.colMark}>
                      <Text style={styles.tableHeaderCell}>Mark</Text>
                    </View>
                  )}
                  {showDescription && (
                    <View style={styles.colDescription}>
                      <Text style={styles.tableHeaderCell}>Description</Text>
                    </View>
                  )}
                  {showProductCodes && (
                    <View style={styles.colCode}>
                      <Text style={styles.tableHeaderCell}>Code</Text>
                    </View>
                  )}
                  {showQuantities && (
                    <View style={[styles.colQty]}>
                      <Text style={[styles.tableHeaderCell, { textAlign: 'center' }]}>Qty</Text>
                    </View>
                  )}
                  {showUom && (
                    <View style={styles.colUom}>
                      <Text style={[styles.tableHeaderCell, { textAlign: 'center' }]}>UOM</Text>
                    </View>
                  )}
                  {showUnitPrices && (
                    <View style={[styles.colUnitPrice]}>
                      <Text style={[styles.tableHeaderCell, { textAlign: 'right' }]}>Unit Price</Text>
                    </View>
                  )}
                  {showLineTotals && (
                    <View style={[styles.colTotal]}>
                      <Text style={[styles.tableHeaderCell, { textAlign: 'right' }]}>Total</Text>
                    </View>
                  )}
                </View>
                {displayRows.map((item, idx) => (
                  <View key={item.id} style={idx % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                    {showMark && (
                      <View style={styles.colMark}>
                        <Text style={styles.cellText}>{item.mark ?? '-'}</Text>
                      </View>
                    )}
                    {showDescription && (
                      <View style={styles.colDescription}>
                        <Text style={styles.cellTextBold}>{item.label}</Text>
                        {!showProductCodes && item.canonicalCode && (
                          <Text style={styles.cellText}>Item Code: {item.canonicalCode}</Text>
                        )}
                        {detailMode === 'full_internal' && item.sourceItemCount > 1 && (
                          <Text style={styles.cellText}>
                            Includes {item.sourceItemCount} priced source line items.
                          </Text>
                        )}
                      </View>
                    )}
                    {showProductCodes && (
                      <View style={styles.colCode}>
                        <Text style={styles.cellText}>{item.canonicalCode ?? '-'}</Text>
                      </View>
                    )}
                    {showQuantities && (
                      <View style={styles.colQty}>
                        <Text style={[styles.cellText, { textAlign: 'center' }]}>
                          {item.quantity}
                        </Text>
                      </View>
                    )}
                    {showUom && (
                      <View style={styles.colUom}>
                        <Text style={[styles.cellText, { textAlign: 'center' }]}>
                          {item.unitOfMeasure ?? 'ea'}
                        </Text>
                      </View>
                    )}
                    {showUnitPrices && (
                      <View style={styles.colUnitPrice}>
                        <Text style={[styles.cellText, { textAlign: 'right' }]}>
                          {fmt(item.unitPrice, quote.currency)}
                        </Text>
                      </View>
                    )}
                    {showLineTotals && (
                      <View style={styles.colTotal}>
                        <Text style={[styles.cellTextBold, { textAlign: 'right' }]}>
                          {fmt(item.lineTotal, quote.currency)}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
                {hiddenLines && (
                  <Text style={styles.tableNotice}>
                    Total reflects the complete quoted scope, including items not itemized above.
                  </Text>
                )}
              </View>
            );
          }

          if (block.id === 'totals') {
            return (
              <View key={block.id} style={styles.totalsSection}>
                <View style={styles.totalsBox}>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Subtotal</Text>
                    <Text style={styles.totalValue}>{fmt(quote.subtotal, quote.currency)}</Text>
                  </View>
                  <View style={styles.grandTotalRow}>
                    <Text style={styles.grandTotalLabel}>TOTAL</Text>
                    <Text style={styles.grandTotalValue}>{fmt(quote.total, quote.currency)}</Text>
                  </View>
                </View>
              </View>
            );
          }

          if (block.id === 'terms' && termsText) {
            return (
              <View key={block.id} style={styles.paymentTermsSection}>
                <Text style={styles.paymentTermsLabel}>{block.title}:</Text>
                <Text style={styles.paymentTermsValue}>{termsText}</Text>
              </View>
            );
          }

          if (block.id === 'notes' && quote.notes) {
            return (
              <View key={block.id} style={styles.notesSection}>
                <Text style={styles.notesLabel}>{block.title}</Text>
                <Text style={styles.notesText}>{quote.notes}</Text>
              </View>
            );
          }

          if (block.id === 'custom' && config.customText.trim()) {
            return (
              <View key={block.id} style={styles.scopeSection}>
                <Text style={styles.scopeLabel}>{block.title}</Text>
                <Text style={styles.scopeText}>{config.customText}</Text>
              </View>
            );
          }

          return null;
        })}

        {disclaimerText && (
          <View style={styles.documentMessageSection}>
            <Text style={styles.documentMessageLabel}>Disclaimer</Text>
            <Text style={styles.documentMessageText}>{disclaimerText}</Text>
          </View>
        )}

        {/* ── Footer ── */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {quoteNumber} · {quoteDate}
          </Text>
          <Text style={styles.footerThankYou}>{footerText}</Text>
          <Text style={styles.footerText}>Integrated Entry Systems</Text>
        </View>
      </Page>
    </Document>
  );
}
