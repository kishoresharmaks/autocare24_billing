import { Alert, Share, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AppButton } from "../../src/components/AppButton";
import { MetricCard } from "../../src/components/MetricCard";
import { MetricGrid } from "../../src/components/MetricGrid";
import { Screen } from "../../src/components/Screen";
import { fetchBusinessSettings, fetchInvoice } from "../../src/services/cloudApi";
import {
  invoiceShareBlockReason,
  normalizeWhatsAppPhone,
  openInvoiceWhatsAppChat,
  prepareInvoicePdf,
  sharePreparedInvoicePdf,
  type PreparedInvoicePdf
} from "../../src/services/invoicePdfShare";
import { colors } from "../../src/theme";
import { formatDate, formatMoney, titleCase } from "../../src/utils/format";
import { useRequireOwner } from "../../src/hooks/useRequireOwner";
import { useSession } from "../../src/providers/SessionProvider";
import type { BusinessSettings, InvoiceDetail, InvoiceItem, Payment } from "../../src/types/cloud";

export default function InvoiceDetailScreen() {
  const guard = useRequireOwner();
  const session = useSession();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const invoiceId = Array.isArray(params.id) ? params.id[0] || "" : params.id || "";

  const invoiceQuery = useQuery({
    queryKey: ["invoice", session.cloudUrl, session.token, invoiceId],
    queryFn: () => fetchInvoice(session.cloudUrl, session.token, invoiceId),
    enabled: Boolean(session.user && session.token && invoiceId && session.approvalStatus === "APPROVED")
  });
  const settingsQuery = useQuery({
    queryKey: ["business-settings", session.cloudUrl, session.token],
    queryFn: () => fetchBusinessSettings(session.cloudUrl, session.token),
    enabled: Boolean(session.user && session.token && session.approvalStatus === "APPROVED")
  });

  if (guard) return guard;

  const invoice = invoiceQuery.data;
  const approvalError =
    session.approvalStatus && session.approvalStatus !== "APPROVED"
      ? "This phone is not approved for cloud invoice viewing. Check approval status from Settings."
      : "";

  const shareInvoice = async () => {
    if (!invoice) return;
    try {
      await Share.share({
        title: `Invoice ${invoice.invoiceNumber || ""}`.trim(),
        message: buildInvoiceShareText(invoice)
      });
    } catch (error) {
      Alert.alert("Unable to share invoice", error instanceof Error ? error.message : "Android share is not available right now.");
    }
  };

  return (
    <Screen
      title={invoice?.invoiceNumber || "Invoice"}
      subtitle={invoice ? `${invoice.customer?.name || invoice.customerName || "Customer"} - ${formatDate(invoice.invoiceDate)}` : "Cloud invoice detail"}
      right={
        <View style={styles.headerActions}>
          <AppButton label="Share Text" onPress={() => void shareInvoice()} disabled={!invoice} style={styles.headerButton} />
        </View>
      }
      refreshing={invoiceQuery.isFetching}
      onRefresh={invoiceQuery.refetch}
    >
      {!invoiceId ? <Text style={styles.error}>Invoice id was not provided.</Text> : null}
      {approvalError ? <Text style={styles.error}>{approvalError}</Text> : null}
      {invoiceQuery.error ? (
        <Text style={styles.error}>{invoiceQuery.error instanceof Error ? invoiceQuery.error.message : "Unable to load invoice."}</Text>
      ) : null}
      {invoiceQuery.isLoading ? <Text style={styles.empty}>Loading invoice...</Text> : null}
      {invoice ? <InvoiceSharePanel invoice={invoice} settings={settingsQuery.data} onShareText={shareInvoice} /> : null}
      {invoice ? <InvoiceContent invoice={invoice} /> : null}
    </Screen>
  );
}

function InvoiceContent({ invoice }: { invoice: InvoiceDetail }) {
  const customerName = invoice.customer?.name || invoice.customerName || "Customer not available";
  const vehicleNumber = invoice.vehicle?.registrationNumber || invoice.vehicleNumber || "Vehicle not available";
  const cancelled = invoice.invoiceStatus === "cancelled" || Boolean(invoice.cancelledAt || invoice.cancelReason);

  return (
    <>
      <MetricGrid>
        <MetricCard label="Total" value={formatMoney(invoice.grandTotal)} tone="success" />
        <MetricCard label="Paid" value={formatMoney(invoice.paidAmount)} />
        <MetricCard label="Balance" value={formatMoney(invoice.balanceDue)} tone={invoice.balanceDue > 0 ? "warning" : "default"} />
      </MetricGrid>

      <Section title="Invoice">
        <InfoGrid>
          <Info label="Status" value={titleCase(invoice.invoiceStatus)} />
          <Info label="Payment" value={titleCase(invoice.paymentStatus)} />
          <Info label="Date" value={formatDate(invoice.invoiceDate)} />
          <Info label="Mode" value={titleCase(invoice.invoiceMode)} />
        </InfoGrid>
      </Section>

      <Section title="Customer & Vehicle">
        <InfoGrid>
          <Info label="Customer" value={customerName} />
          <Info label="Phone" value={invoice.customer?.phone || invoice.customerPhone || "Not available"} />
          <Info label="Vehicle" value={vehicleNumber} />
          <Info
            label="Model"
            value={[invoice.vehicle?.make, invoice.vehicle?.model, invoice.vehicle?.color].filter(Boolean).join(" ") || titleCase(invoice.vehicle?.vehicleType)}
          />
          <Info label="GSTIN" value={invoice.customer?.gstin || "Not available"} />
          <Info label="Address" value={invoice.customer?.address || "Not available"} />
        </InfoGrid>
      </Section>

      <Section title="Items">
        {(invoice.items || []).map((item: InvoiceItem, index: number) => (
          <View key={item.id || `${item.description}-${index}`} style={styles.itemRow}>
            <View style={styles.itemText}>
              <Text style={styles.itemTitle} numberOfLines={2}>
                {item.description || "Invoice item"}
              </Text>
              <Text style={styles.itemSub} numberOfLines={1}>
                Qty {item.quantity || 0} x {formatMoney(item.unitPrice)} {item.gstRate ? `| GST ${item.gstRate}%` : ""}
              </Text>
            </View>
            <Text style={styles.rowAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
              {formatMoney(item.lineTotal)}
            </Text>
          </View>
        ))}
        {!invoice.items?.length ? <Text style={styles.empty}>No invoice items found.</Text> : null}
      </Section>

      <Section title="Tax & Totals">
        <AmountRow label="Subtotal" value={invoice.subTotal} />
        <AmountRow label="Discount" value={invoice.discount} />
        <AmountRow label="Taxable value" value={invoice.taxableValue} />
        <AmountRow label="CGST" value={invoice.cgst} />
        <AmountRow label="SGST" value={invoice.sgst} />
        <AmountRow label="IGST" value={invoice.igst} />
        <AmountRow label="Total tax" value={invoice.totalTax} />
        <AmountRow label="Grand total" value={invoice.grandTotal} strong />
      </Section>

      <Section title="Payments">
        {(invoice.payments || []).map((payment: Payment, index: number) => (
          <View key={payment.id || `${payment.paymentDate}-${index}`} style={styles.paymentRow}>
            <View style={styles.itemText}>
              <Text style={styles.itemTitle}>{payment.mode || "Payment"}</Text>
              <Text style={styles.itemSub} numberOfLines={1}>
                {[formatDate(payment.paymentDate), payment.reference].filter(Boolean).join(" | ")}
              </Text>
            </View>
            <Text style={styles.rowAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
              {formatMoney(payment.amount)}
            </Text>
          </View>
        ))}
        {!invoice.payments?.length ? <Text style={styles.empty}>No payments recorded.</Text> : null}
      </Section>

      {invoice.notes ? (
        <Section title="Notes">
          <Text style={styles.paragraph}>{invoice.notes}</Text>
        </Section>
      ) : null}

      {cancelled ? (
        <Section title="Cancellation">
          <InfoGrid>
            <Info label="Cancelled at" value={formatDate(invoice.cancelledAt)} />
            <Info label="Reason" value={invoice.cancelReason || "Not available"} />
          </InfoGrid>
        </Section>
      ) : null}
    </>
  );
}

function InvoiceSharePanel({
  invoice,
  settings,
  onShareText
}: {
  invoice: InvoiceDetail;
  settings?: BusinessSettings;
  onShareText: () => Promise<void>;
}) {
  const session = useSession();
  const [preparingPdf, setPreparingPdf] = useState(false);
  const [openingWhatsapp, setOpeningWhatsapp] = useState(false);
  const [sharingAgain, setSharingAgain] = useState(false);
  const [lastPdf, setLastPdf] = useState<PreparedInvoicePdf | null>(null);
  const phone = normalizeWhatsAppPhone(invoice.customer?.phone || invoice.customerPhone);
  const blockReason = invoiceShareBlockReason(invoice, phone);
  const disabled = Boolean(blockReason || preparingPdf || openingWhatsapp || sharingAgain);

  const openChat = async () => {
    setOpeningWhatsapp(true);
    try {
      await openInvoiceWhatsAppChat({ invoice, settings });
    } catch (error) {
      Alert.alert("Unable to open WhatsApp", error instanceof Error ? error.message : "WhatsApp is not available right now.");
    } finally {
      setOpeningWhatsapp(false);
    }
  };

  const sharePdf = async () => {
    if (blockReason) {
      Alert.alert("WhatsApp PDF unavailable", blockReason);
      return;
    }
    setPreparingPdf(true);
    try {
      const pdf = await prepareInvoicePdf({ invoice, settings, cloudUrl: session.cloudUrl, token: session.token });
      await sharePreparedInvoicePdf(pdf);
      setLastPdf(pdf);
      Alert.alert(
        "Invoice PDF ready",
        "Choose WhatsApp in the share sheet to send the PDF. Open the customer chat if you need the prepared message and number.",
        [
          { text: "Open WhatsApp chat", onPress: () => void openChat() },
          { text: "Done", style: "cancel" }
        ]
      );
    } catch (error) {
      Alert.alert("Unable to share invoice PDF", error instanceof Error ? error.message : "Invoice PDF sharing failed.");
    } finally {
      setPreparingPdf(false);
    }
  };

  const shareLastPdf = async () => {
    if (!lastPdf) return;
    setSharingAgain(true);
    try {
      await sharePreparedInvoicePdf(lastPdf);
    } catch (error) {
      Alert.alert("Unable to share PDF", error instanceof Error ? error.message : "Invoice PDF sharing failed.");
    } finally {
      setSharingAgain(false);
    }
  };

  return (
    <Section title="WhatsApp PDF">
      <View style={styles.whatsappTopRow}>
        <View style={[styles.whatsappChip, phone.valid ? null : styles.whatsappChipMissing]}>
          <Text style={[styles.whatsappChipText, phone.valid ? null : styles.whatsappChipTextMissing]}>
            {phone.valid ? `WhatsApp to: ${phone.display}` : "Customer phone missing"}
          </Text>
        </View>
        <Text style={styles.whatsappStatus} numberOfLines={1}>
          {lastPdf ? "PDF ready" : "Real invoice PDF"}
        </Text>
      </View>
      <Text style={styles.shareHelp}>
        Generate the invoice PDF, choose WhatsApp in the share sheet, then send it to the loaded customer number.
      </Text>
      {blockReason ? <Text style={styles.error}>{blockReason}</Text> : null}
      <View style={styles.shareActions}>
        <AppButton
          label={preparingPdf ? "Preparing PDF..." : "Send PDF on WhatsApp"}
          onPress={() => void sharePdf()}
          disabled={disabled}
          style={styles.shareButton}
        />
        <AppButton
          label={openingWhatsapp ? "Opening..." : "Open WhatsApp chat"}
          onPress={() => void openChat()}
          disabled={disabled}
          variant="secondary"
          style={styles.shareButton}
        />
      </View>
      <View style={styles.shareActions}>
        <AppButton label="Share invoice text" onPress={() => void onShareText()} variant="secondary" style={styles.shareButton} />
        {lastPdf ? (
          <AppButton
            label={sharingAgain ? "Sharing..." : "Share PDF again"}
            onPress={() => void shareLastPdf()}
            disabled={sharingAgain}
            variant="secondary"
            style={styles.shareButton}
          />
        ) : null}
      </View>
      {lastPdf ? (
        <View style={styles.pdfReadyBox}>
          <Text style={styles.pdfReadyTitle}>PDF saved on this phone</Text>
          <Text style={styles.pdfReadyText} numberOfLines={2}>
            {lastPdf.fileName}
          </Text>
        </View>
      ) : null}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function InfoGrid({ children }: { children: ReactNode }) {
  return <View style={styles.infoGrid}>{children}</View>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.info}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={3}>
        {value || "Not available"}
      </Text>
    </View>
  );
}

function AmountRow({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <View style={styles.amountRow}>
      <Text style={[styles.amountLabel, strong ? styles.strongLabel : null]}>{label}</Text>
      <Text style={[styles.amountText, strong ? styles.strongAmount : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
        {formatMoney(value)}
      </Text>
    </View>
  );
}

function buildInvoiceShareText(invoice: InvoiceDetail) {
  const customerName = invoice.customer?.name || invoice.customerName || "Customer not available";
  const vehicleNumber = invoice.vehicle?.registrationNumber || invoice.vehicleNumber || "Vehicle not available";
  const itemLines = (invoice.items || []).slice(0, 6).map((item) => `- ${item.description || "Item"} x ${item.quantity || 0}: ${formatMoney(item.lineTotal)}`);
  const moreItems = (invoice.items || []).length > itemLines.length ? [`- +${(invoice.items || []).length - itemLines.length} more item(s)`] : [];

  return [
    "Autocare24 Invoice",
    `Invoice: ${invoice.invoiceNumber || "Not available"}`,
    `Date: ${formatDate(invoice.invoiceDate)}`,
    `Customer: ${customerName}`,
    `Vehicle: ${vehicleNumber}`,
    `Status: ${titleCase(invoice.invoiceStatus || invoice.paymentStatus)}`,
    `Total: ${formatMoney(invoice.grandTotal)}`,
    `Paid: ${formatMoney(invoice.paidAmount)}`,
    `Balance: ${formatMoney(invoice.balanceDue)}`,
    itemLines.length ? "Items:" : "",
    ...itemLines,
    ...moreItems,
    invoice.notes ? `Notes: ${invoice.notes}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 8
  },
  headerButton: {
    minWidth: 96,
    flexGrow: 1
  },
  section: {
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  whatsappTopRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  whatsappChip: {
    maxWidth: "68%",
    borderRadius: 999,
    backgroundColor: colors.purpleSoft,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  whatsappChipMissing: {
    backgroundColor: colors.redSoft
  },
  whatsappChipText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900"
  },
  whatsappChipTextMissing: {
    color: colors.danger
  },
  whatsappStatus: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right"
  },
  shareHelp: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18
  },
  shareActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  shareButton: {
    minWidth: 148,
    flexGrow: 1,
    flexBasis: "48%"
  },
  pdfReadyBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.greenSoft,
    padding: 10,
    gap: 2
  },
  pdfReadyTitle: {
    color: colors.success,
    fontSize: 12,
    fontWeight: "900"
  },
  pdfReadyText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700"
  },
  infoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  info: {
    width: "48%",
    minWidth: 132,
    flexGrow: 1,
    gap: 2
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  infoValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18
  },
  itemRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 10
  },
  paymentRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 10
  },
  itemText: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  itemTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800"
  },
  itemSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600"
  },
  rowAmount: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "900",
    maxWidth: "42%",
    textAlign: "right"
  },
  amountRow: {
    minHeight: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 8
  },
  amountLabel: {
    flex: 1,
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800"
  },
  amountText: {
    maxWidth: "48%",
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right"
  },
  strongLabel: {
    color: colors.text
  },
  strongAmount: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: "900"
  },
  paragraph: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 20
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600"
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700"
  }
});
