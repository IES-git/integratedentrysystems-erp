import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import type { Quote, QuoteItem, ItemField, Company } from '@/types';
import iesLogo from '@/assets/ies-logo.png';

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
  rfqMetaBlock: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 3,
  },
  rfqTitle: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: '#1a1a1a',
    letterSpacing: 2,
  },
  rfqSubtitle: {
    fontSize: 8,
    color: '#6b7280',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  rfqNumber: {
    fontSize: 9,
    color: '#6b7280',
  },
  rfqDate: {
    fontSize: 9,
    color: '#6b7280',
  },
  // ── Project Info ────────────────────────────────────────────────────────────
  infoSection: {
    flexDirection: 'row',
    marginBottom: 24,
    gap: 12,
  },
  infoBlock: {
    flex: 1,
    padding: 10,
    backgroundColor: '#f9fafb',
    borderRadius: 3,
    borderLeft: '3pt solid #374151',
    flexDirection: 'column',
    gap: 3,
  },
  infoLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#9ca3af',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  infoValue: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#1a1a1a',
  },
  infoLine: {
    fontSize: 8.5,
    color: '#374151',
    lineHeight: 1.4,
  },
  // ── Section Header ──────────────────────────────────────────────────────────
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#374151',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 2,
    marginBottom: 8,
    marginTop: 4,
  },
  sectionHeaderText: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionHeaderRight: {
    fontSize: 7.5,
    color: '#d1d5db',
  },
  // ── Item Block ──────────────────────────────────────────────────────────────
  itemBlock: {
    marginBottom: 16,
    border: '0.5pt solid #e5e7eb',
    borderRadius: 3,
    overflow: 'hidden',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottom: '0.5pt solid #e5e7eb',
  },
  itemHeaderLeft: {
    flex: 3,
    flexDirection: 'column',
    gap: 1,
  },
  itemLabel: {
    fontSize: 9.5,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  itemCode: {
    fontSize: 7.5,
    color: '#6b7280',
    fontFamily: 'Helvetica',
  },
  itemHeaderRight: {
    flex: 2,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 20,
    alignItems: 'center',
  },
  itemMeta: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 1,
  },
  itemMetaLabel: {
    fontSize: 6.5,
    color: '#9ca3af',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  itemMetaValue: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#1a1a1a',
  },
  // ── Spec Grid ───────────────────────────────────────────────────────────────
  specGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8,
    gap: 0,
  },
  specCell: {
    width: '25%',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottom: '0.5pt solid #f3f4f6',
  },
  specKey: {
    fontSize: 7,
    color: '#9ca3af',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  specValue: {
    fontSize: 8.5,
    color: '#374151',
    fontFamily: 'Helvetica-Bold',
  },
  noSpecsText: {
    fontSize: 8,
    color: '#9ca3af',
    padding: 8,
    fontStyle: 'italic',
  },
  // ── Totals ──────────────────────────────────────────────────────────────────
  totalsSection: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
    marginBottom: 24,
  },
  totalsBox: {
    width: 220,
    border: '0.5pt solid #e5e7eb',
    borderRadius: 3,
    overflow: 'hidden',
  },
  totalsHeader: {
    backgroundColor: '#374151',
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  totalsHeaderText: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderBottom: '0.5pt solid #f3f4f6',
  },
  totalLabel: {
    fontSize: 8,
    color: '#6b7280',
  },
  totalValue: {
    fontSize: 8,
    color: '#374151',
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: '#f3f4f6',
  },
  grandTotalLabel: {
    fontSize: 9.5,
    fontFamily: 'Helvetica-Bold',
    color: '#1a1a1a',
  },
  grandTotalValue: {
    fontSize: 9.5,
    fontFamily: 'Helvetica-Bold',
    color: '#1a1a1a',
  },
  // ── Notes ───────────────────────────────────────────────────────────────────
  notesSection: {
    marginBottom: 20,
    padding: 12,
    backgroundColor: '#fef9c3',
    borderRadius: 3,
    borderLeft: '3pt solid #fbbf24',
  },
  notesLabel: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#92400e',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  notesText: {
    fontSize: 8.5,
    color: '#78350f',
    lineHeight: 1.5,
  },
  // ── Footer ──────────────────────────────────────────────────────────────────
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
  // ── Delivery notice ─────────────────────────────────────────────────────────
  deliverySection: {
    marginBottom: 16,
    flexDirection: 'row',
    gap: 20,
    padding: 10,
    border: '0.5pt solid #e5e7eb',
    borderRadius: 3,
  },
  deliveryItem: {
    flex: 1,
    flexDirection: 'column',
    gap: 2,
  },
  deliveryLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#9ca3af',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  deliveryValue: {
    fontSize: 8.5,
    color: '#374151',
  },
});

const fmt = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

export interface ManufacturerQuoteItem extends QuoteItem {
  fields: ItemField[];
}

interface ManufacturerQuotePdfProps {
  quote: Quote;
  items: ManufacturerQuoteItem[];
  company: Company | null;
}

export function ManufacturerQuotePdf({
  quote,
  items,
  company,
}: ManufacturerQuotePdfProps) {
  const rfqNumber = `RFQ-${quote.id.slice(-8).toUpperCase()}`;
  const rfqDate = new Date(quote.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const shipToLines = [
    company?.shippingAddress ?? company?.billingAddress,
    [
      company?.shippingCity ?? company?.billingCity,
      company?.shippingState ?? company?.billingState,
      company?.shippingZip ?? company?.billingZip,
    ]
      .filter(Boolean)
      .join(', '),
  ].filter(Boolean);

  return (
    <Document
      title={`RFQ ${rfqNumber}`}
      author="Integrated Entry Systems"
      subject="Request for Quote"
    >
      <Page size="LETTER" style={styles.page}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.brandBlock}>
            <Image src={iesLogo} style={styles.logoImage} />
          </View>
          <View style={styles.rfqMetaBlock}>
            <Text style={styles.rfqTitle}>REQUEST FOR QUOTE</Text>
            <Text style={styles.rfqSubtitle}>Technical Specification Document</Text>
            <Text style={styles.rfqNumber}>RFQ No: {rfqNumber}</Text>
            <Text style={styles.rfqDate}>Date: {rfqDate}</Text>
          </View>
        </View>

        {/* ── Project Info ── */}
        <View style={styles.infoSection}>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Ship To</Text>
            {company && <Text style={styles.infoValue}>{company.name}</Text>}
            {shipToLines.map((line, i) => (
              <Text key={i} style={styles.infoLine}>{line}</Text>
            ))}
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Issued By</Text>
            <Text style={styles.infoValue}>Integrated Entry Systems</Text>
            <Text style={styles.infoLine}>Commercial Door &amp; Hardware</Text>
            <Text style={styles.infoLine}>procurement@ies-access.com</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Quote Info</Text>
            <Text style={styles.infoLine}>RFQ: {rfqNumber}</Text>
            <Text style={styles.infoLine}>Date: {rfqDate}</Text>
            <Text style={styles.infoLine}>Items: {items.length}</Text>
          </View>
        </View>

        {/* ── Items ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>Line Items — Full Technical Specifications</Text>
          <Text style={styles.sectionHeaderRight}>{items.length} item{items.length !== 1 ? 's' : ''}</Text>
        </View>

        {items.map((item, idx) => (
          <View key={item.id} style={styles.itemBlock} wrap={false}>
            {/* Item header row */}
            <View style={styles.itemHeader}>
              <View style={styles.itemHeaderLeft}>
                <Text style={styles.itemLabel}>
                  {idx + 1}. {item.itemLabel}
                </Text>
                {item.canonicalCode && (
                  <Text style={styles.itemCode}>Code: {item.canonicalCode}</Text>
                )}
              </View>
              <View style={styles.itemHeaderRight}>
                <View style={styles.itemMeta}>
                  <Text style={styles.itemMetaLabel}>Qty</Text>
                  <Text style={styles.itemMetaValue}>{item.quantity}</Text>
                </View>
                <View style={styles.itemMeta}>
                  <Text style={styles.itemMetaLabel}>Unit Cost</Text>
                  <Text style={styles.itemMetaValue}>{fmt(item.unitCost, quote.currency)}</Text>
                </View>
                <View style={styles.itemMeta}>
                  <Text style={styles.itemMetaLabel}>Line Total</Text>
                  <Text style={styles.itemMetaValue}>
                    {fmt(item.quantity * item.unitCost, quote.currency)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Spec grid */}
            {item.fields.length > 0 ? (
              <View style={styles.specGrid}>
                {item.fields.map((field) => (
                  <View key={field.id} style={styles.specCell}>
                    <Text style={styles.specKey}>{field.fieldLabel}</Text>
                    <Text style={styles.specValue}>{field.fieldValue}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.noSpecsText}>No additional specifications recorded.</Text>
            )}
          </View>
        ))}

        {/* ── Totals ── */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsBox}>
            <View style={styles.totalsHeader}>
              <Text style={styles.totalsHeaderText}>Cost Summary</Text>
            </View>
            {items.map((item) => (
              <View key={item.id} style={styles.totalRow}>
                <Text style={styles.totalLabel} numberOfLines={1}>
                  {item.itemLabel} (×{item.quantity})
                </Text>
                <Text style={styles.totalValue}>
                  {fmt(item.quantity * item.unitCost, quote.currency)}
                </Text>
              </View>
            ))}
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>TOTAL COST</Text>
              <Text style={styles.grandTotalValue}>{fmt(quote.subtotal, quote.currency)}</Text>
            </View>
          </View>
        </View>

        {/* ── Notes ── */}
        {quote.notes && (
          <View style={styles.notesSection}>
            <Text style={styles.notesLabel}>Notes &amp; Special Requirements</Text>
            <Text style={styles.notesText}>{quote.notes}</Text>
          </View>
        )}

        {/* ── Delivery ── */}
        <View style={styles.deliverySection}>
          <View style={styles.deliveryItem}>
            <Text style={styles.deliveryLabel}>Delivery Requirements</Text>
            <Text style={styles.deliveryValue}>
              Please confirm lead times and availability before acceptance.
            </Text>
          </View>
          <View style={styles.deliveryItem}>
            <Text style={styles.deliveryLabel}>Response Required By</Text>
            <Text style={styles.deliveryValue}>Within 5 business days of receipt</Text>
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{rfqNumber} · Confidential</Text>
          <Text style={styles.footerText}>
            This document is for procurement purposes only. Not for customer distribution.
          </Text>
          <Text style={styles.footerText}>IES · Page 1</Text>
        </View>
      </Page>
    </Document>
  );
}
