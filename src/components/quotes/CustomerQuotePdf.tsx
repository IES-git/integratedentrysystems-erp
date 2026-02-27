import { Document, Page, Text, View, StyleSheet, Font, Image } from '@react-pdf/renderer';
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
  colQty: { flex: 1, textAlign: 'center' },
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
});

const fmt = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

interface CustomerQuotePdfProps {
  quote: Quote;
  items: QuoteItem[];
  company: Company | null;
  primaryContact?: Contact | null;
  aiSummary?: string | null;
}

export function CustomerQuotePdf({
  quote,
  items,
  company,
  primaryContact,
  aiSummary,
}: CustomerQuotePdfProps) {
  const quoteNumber = `Q-${quote.id.slice(-8).toUpperCase()}`;
  const quoteDate = new Date(quote.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

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
          </View>
        </View>

        {/* ── Bill To ── */}
        <View style={styles.addressSection}>
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

        {/* ── AI Summary ── */}
        {aiSummary && (
          <View style={styles.summarySection}>
            <Text style={styles.summaryLabel}>Quote Overview</Text>
            <Text style={styles.summaryText}>{aiSummary}</Text>
          </View>
        )}

        {/* ── Line Items Table ── */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <View style={[styles.colDescription]}>
              <Text style={styles.tableHeaderCell}>Description</Text>
            </View>
            <View style={[styles.colQty]}>
              <Text style={[styles.tableHeaderCell, { textAlign: 'center' }]}>Qty</Text>
            </View>
            <View style={[styles.colUnitPrice]}>
              <Text style={[styles.tableHeaderCell, { textAlign: 'right' }]}>Unit Price</Text>
            </View>
            <View style={[styles.colTotal]}>
              <Text style={[styles.tableHeaderCell, { textAlign: 'right' }]}>Total</Text>
            </View>
          </View>
          {items.map((item, idx) => (
            <View key={item.id} style={idx % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <View style={styles.colDescription}>
                <Text style={styles.cellTextBold}>{item.itemLabel}</Text>
              </View>
              <View style={styles.colQty}>
                <Text style={[styles.cellText, { textAlign: 'center' }]}>{item.quantity}</Text>
              </View>
              <View style={styles.colUnitPrice}>
                <Text style={[styles.cellText, { textAlign: 'right' }]}>
                  {fmt(item.unitPrice, quote.currency)}
                </Text>
              </View>
              <View style={styles.colTotal}>
                <Text style={[styles.cellTextBold, { textAlign: 'right' }]}>
                  {fmt(item.lineTotal, quote.currency)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── Totals ── */}
        <View style={styles.totalsSection}>
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

        {/* ── Payment Terms ── */}
        {paymentTerms && (
          <View style={styles.paymentTermsSection}>
            <Text style={styles.paymentTermsLabel}>Payment Terms:</Text>
            <Text style={styles.paymentTermsValue}>{paymentTerms}</Text>
          </View>
        )}

        {/* ── Notes ── */}
        {quote.notes && (
          <View style={styles.notesSection}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{quote.notes}</Text>
          </View>
        )}

        {/* ── Footer ── */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {quoteNumber} · {quoteDate}
          </Text>
          <Text style={styles.footerThankYou}>Thank you for your business!</Text>
          <Text style={styles.footerText}>Integrated Entry Systems</Text>
        </View>
      </Page>
    </Document>
  );
}
