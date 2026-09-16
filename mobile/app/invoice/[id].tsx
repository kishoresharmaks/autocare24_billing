import { Alert, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { AppButton } from "../../src/components/AppButton";
import { MetricCard } from "../../src/components/MetricCard";
import { MetricGrid } from "../../src/components/MetricGrid";
import { Screen } from "../../src/components/Screen";
import {
  appendInvoiceItem,
  cancelInvoice,
  fetchBusinessSettings,
  fetchInventoryDashboard,
  fetchInvoice,
  fetchServices,
  recordInvoicePayment
} from "../../src/services/cloudApi";
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
import { useRequirePermission } from "../../src/hooks/useRequireOwner";
import { useSession } from "../../src/providers/SessionProvider";
import { hasPermission } from "../../src/services/permissions";
import { calculateInvoiceTotals, DEFAULT_SAC_CODE, money, normalizeSacCode } from "../../src/utils/billingMath";
import { normalizeWarrantyText, parseWarrantyDurationMonths, warrantyDurationLabel } from "../../src/utils/warranty";
import type { BusinessSettings, InventoryItem, InvoiceDetail, InvoiceItem, InvoiceItemInput, Payment, PaymentMode, ServiceItem } from "../../src/types/cloud";

const PAYMENT_MODES: PaymentMode[] = ["Cash", "UPI", "Card", "Bank Transfer", "Other"];

const todayIso = () => {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const numberValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const serviceWarrantyFields = (service: ServiceItem): Pick<InvoiceItemInput, "warrantyIncluded" | "warrantyDurationMonths" | "warrantyText"> => {
  const durationMonths = parseWarrantyDurationMonths(service.warrantyDurationMonths || service.warrantyText);
  if (!service.warrantyEnabled || !durationMonths) return { warrantyIncluded: false, warrantyDurationMonths: 0, warrantyText: "" };
  return {
    warrantyIncluded: true,
    warrantyDurationMonths: durationMonths,
    warrantyText: normalizeWarrantyText(service.warrantyText, durationMonths)
  };
};

const emptyAppendItem = (gstRate: number): InvoiceItemInput => ({
  description: "",
  quantity: 1,
  unitPrice: 0,
  gstRate,
  sacCode: DEFAULT_SAC_CODE,
  warrantyIncluded: false,
  warrantyDurationMonths: 0,
  warrantyText: ""
});

export default function InvoiceDetailScreen() {
  const guard = useRequirePermission("billing.view");
  const session = useSession();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const invoiceId = Array.isArray(params.id) ? params.id[0] || "" : params.id || "";

  const invoiceQuery = useQuery({
    queryKey: ["invoice", session.cloudUrl, session.token, session.userToken, invoiceId],
    queryFn: () => fetchInvoice(session.cloudUrl, session.token, session.userToken, invoiceId),
    enabled: Boolean(session.user && session.token && session.userToken && invoiceId && session.approvalStatus === "APPROVED")
  });
  const settingsQuery = useQuery({
    queryKey: ["business-settings", session.cloudUrl, session.token, session.userToken],
    queryFn: () => fetchBusinessSettings(session.cloudUrl, session.token, session.userToken),
    enabled: Boolean(session.user && session.token && session.userToken && session.approvalStatus === "APPROVED")
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
      {invoice ? <InvoiceManagePanel invoice={invoice} onChanged={() => void invoiceQuery.refetch()} /> : null}
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
              {item.warrantyIncluded ? (
                <Text style={styles.warrantyText} numberOfLines={1}>
                  Warranty {item.warrantyText || warrantyDurationLabel(item.warrantyDurationMonths || 0)}
                  {item.warrantyEndDate ? ` | Until ${formatDate(item.warrantyEndDate)}` : ""}
                </Text>
              ) : null}
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

function InvoiceManagePanel({ invoice, onChanged }: { invoice: InvoiceDetail; onChanged: () => void }) {
  const session = useSession();
  const queryClient = useQueryClient();
  const canPay = hasPermission(session.user, "billing.recordPayments");
  const canAppend = hasPermission(session.user, "billing.manageInvoices");
  const canCancel = hasPermission(session.user, "billing.cancelInvoices");
  const canReadServices = hasPermission(session.user, "services.view");
  const canReadStock = hasPermission(session.user, "stock.view");
  const cancelled = invoice.invoiceStatus === "cancelled";
  const [paymentAmount, setPaymentAmount] = useState(String(invoice.balanceDue > 0 ? invoice.balanceDue : ""));
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("UPI");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [appendItem, setAppendItem] = useState<InvoiceItemInput>(emptyAppendItem(18));
  const [serviceQuery, setServiceQuery] = useState("");
  const [stockQuery, setStockQuery] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const servicesQuery = useQuery({
    queryKey: ["services", session.cloudUrl, session.token, session.userToken],
    queryFn: () => fetchServices(session.cloudUrl, session.token, session.userToken),
    enabled: Boolean(canAppend && canReadServices && session.token && session.userToken && session.approvalStatus === "APPROVED")
  });
  const inventoryQuery = useQuery({
    queryKey: ["inventory-dashboard", session.cloudUrl, session.token, session.userToken],
    queryFn: () => fetchInventoryDashboard(session.cloudUrl, session.token, session.userToken),
    enabled: Boolean(canAppend && canReadStock && session.token && session.userToken && session.approvalStatus === "APPROVED")
  });

  const retailItems = useMemo(() => (inventoryQuery.data?.items || []).filter((item) => item.type === "retail" && item.active !== false), [inventoryQuery.data?.items]);
  const serviceMatches = useMemo(() => filterServices(servicesQuery.data || [], serviceQuery), [serviceQuery, servicesQuery.data]);
  const stockMatches = useMemo(() => filterStock(retailItems, stockQuery), [retailItems, stockQuery]);
  const appendTotals = useMemo(() => calculateInvoiceTotals(invoice.invoiceMode, invoice.taxScope, [appendItem], 0), [appendItem, invoice.invoiceMode, invoice.taxScope]);

  const invalidateInvoiceData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["invoice"] }),
      queryClient.invalidateQueries({ queryKey: ["invoices"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-dashboard"] })
    ]);
    onChanged();
  };

  const paymentMutation = useMutation({
    mutationFn: () =>
      recordInvoicePayment(session.cloudUrl, session.token, session.userToken, {
        invoiceId: invoice.id,
        amount: money(numberValue(paymentAmount)),
        mode: paymentMode,
        reference: paymentReference.trim(),
        paymentDate
      }),
    onSuccess: async () => {
      await invalidateInvoiceData();
      setPaymentAmount("");
      setPaymentReference("");
      Alert.alert("Payment recorded", "Invoice payment was updated.");
    },
    onError: (error) => Alert.alert("Unable to record payment", error instanceof Error ? error.message : "Payment failed.")
  });

  const appendMutation = useMutation({
    mutationFn: () =>
      appendInvoiceItem(session.cloudUrl, session.token, session.userToken, {
        invoiceId: invoice.id,
        item: {
          ...appendItem,
          description: appendItem.description.trim(),
          quantity: money(numberValue(appendItem.quantity)),
          unitPrice: money(numberValue(appendItem.unitPrice)),
          gstRate: invoice.invoiceMode === "gst" ? money(numberValue(appendItem.gstRate)) : 0,
          sacCode: normalizeSacCode(appendItem.sacCode),
          warrantyIncluded: Boolean(appendItem.warrantyIncluded && parseWarrantyDurationMonths(appendItem.warrantyDurationMonths || appendItem.warrantyText)),
          warrantyDurationMonths: parseWarrantyDurationMonths(appendItem.warrantyDurationMonths || appendItem.warrantyText),
          warrantyText: normalizeWarrantyText(appendItem.warrantyText, parseWarrantyDurationMonths(appendItem.warrantyDurationMonths || appendItem.warrantyText))
        }
      }),
    onSuccess: async () => {
      await invalidateInvoiceData();
      setAppendItem(emptyAppendItem(numberValue(appendItem.gstRate || 18)));
      Alert.alert("Item added", "The item was appended to this invoice.");
    },
    onError: (error) => Alert.alert("Unable to add item", error instanceof Error ? error.message : "Append item failed.")
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelInvoice(session.cloudUrl, session.token, session.userToken, { invoiceId: invoice.id, reason: cancelReason.trim() }),
    onSuccess: async () => {
      await invalidateInvoiceData();
      setCancelReason("");
      Alert.alert("Invoice cancelled", "Stock and dues were updated by the cloud API.");
    },
    onError: (error) => Alert.alert("Unable to cancel invoice", error instanceof Error ? error.message : "Cancellation failed.")
  });

  const paymentError = money(numberValue(paymentAmount)) <= 0
    ? "Enter payment amount."
    : money(numberValue(paymentAmount)) > money(invoice.balanceDue)
      ? "Payment cannot be greater than balance due."
      : "";
  const appendError = !appendItem.description.trim()
    ? "Enter item description."
    : numberValue(appendItem.quantity) <= 0
      ? "Quantity must be greater than zero."
      : numberValue(appendItem.unitPrice) < 0
        ? "Price cannot be negative."
        : "";
  const cancelError = cancelReason.trim() ? "" : "Cancellation reason is required.";

  if (!canPay && !canAppend && !canCancel) return null;

  return (
    <Section title="Manage Invoice">
      {cancelled ? <Text style={styles.error}>This invoice is cancelled. Further payment and item changes are blocked.</Text> : null}

      {canPay && !cancelled ? (
        <View style={styles.manageBox}>
          <Text style={styles.manageTitle}>Record payment</Text>
          <View style={styles.infoGrid}>
            <ManageInput label="Amount" value={paymentAmount} onChangeText={setPaymentAmount} keyboardType="decimal-pad" />
            <ManageInput label="Date" value={paymentDate} onChangeText={setPaymentDate} />
          </View>
          <Segmented options={PAYMENT_MODES.map((mode) => ({ label: mode, value: mode }))} value={paymentMode} onChange={(value) => setPaymentMode(value as PaymentMode)} />
          <ManageInput label="Reference" value={paymentReference} onChangeText={setPaymentReference} />
          {paymentError ? <Text style={styles.error}>{paymentError}</Text> : null}
          <AppButton label={paymentMutation.isPending ? "Recording..." : "Record Payment"} onPress={() => paymentMutation.mutate()} loading={paymentMutation.isPending} disabled={Boolean(paymentError)} />
        </View>
      ) : null}

      {canAppend && !cancelled ? (
        <View style={styles.manageBox}>
          <Text style={styles.manageTitle}>Append item</Text>
          {!canReadServices ? <Text style={styles.empty}>This role cannot browse saved services. Enter the append item manually.</Text> : null}
          <ManageInput label="Search service" value={serviceQuery} onChangeText={setServiceQuery} />
          {serviceMatches.map((service) => (
            <ActionRow
              key={service.id}
              title={service.name}
              subtitle={`${formatMoney(service.defaultPrice)} | GST ${service.gstRate || appendItem.gstRate || 0}%${service.warrantyEnabled ? ` | Warranty ${warrantyDurationLabel(service.warrantyDurationMonths)}` : ""}`}
              onPress={() =>
                setAppendItem({
                  ...emptyAppendItem(numberValue(service.gstRate || appendItem.gstRate || 18)),
                  serviceId: service.id,
                  description: service.name,
                  unitPrice: numberValue(service.defaultPrice),
                  gstRate: numberValue(service.gstRate || appendItem.gstRate || 18),
                  sacCode: normalizeSacCode(service.sacCode),
                  ...serviceWarrantyFields(service)
                })
              }
            />
          ))}
          {!canReadStock ? <Text style={styles.empty}>This role cannot browse retail stock. Enter the append item manually.</Text> : null}
          <ManageInput label="Search retail stock" value={stockQuery} onChangeText={setStockQuery} />
          {stockMatches.map((item) => (
            <ActionRow
              key={item.id}
              title={item.name}
              subtitle={`${formatMoney(item.retailPrice)} | Stock ${item.currentQuantity || 0} ${item.unit || "unit"}`}
              onPress={() =>
                setAppendItem({
                  ...emptyAppendItem(numberValue(item.gstRate || appendItem.gstRate || 18)),
                  inventoryItemId: item.id,
                  description: item.name,
                  unitPrice: numberValue(item.retailPrice),
                  gstRate: numberValue(item.gstRate || appendItem.gstRate || 18)
                })
              }
            />
          ))}
          <ManageInput label="Description" value={appendItem.description} onChangeText={(value) => setAppendItem({ ...appendItem, description: value })} />
          <View style={styles.infoGrid}>
            <ManageInput label="Quantity" value={String(appendItem.quantity || 0)} onChangeText={(value) => setAppendItem({ ...appendItem, quantity: numberValue(value) })} keyboardType="decimal-pad" />
            <ManageInput label="Unit price" value={String(appendItem.unitPrice || 0)} onChangeText={(value) => setAppendItem({ ...appendItem, unitPrice: numberValue(value) })} keyboardType="decimal-pad" />
            <ManageInput label="GST %" value={String(appendItem.gstRate || 0)} onChangeText={(value) => setAppendItem({ ...appendItem, gstRate: numberValue(value) })} keyboardType="decimal-pad" />
            <ManageInput label="SAC" value={appendItem.sacCode || DEFAULT_SAC_CODE} onChangeText={(value) => setAppendItem({ ...appendItem, sacCode: value })} keyboardType="number-pad" />
          </View>
          {parseWarrantyDurationMonths(appendItem.warrantyDurationMonths || appendItem.warrantyText) ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: Boolean(appendItem.warrantyIncluded) }}
              onPress={() => setAppendItem({ ...appendItem, warrantyIncluded: !appendItem.warrantyIncluded })}
              style={styles.toggleRow}
            >
              <Text style={styles.toggleText}>
                Warranty {appendItem.warrantyIncluded ? "included" : "removed"} - {warrantyDurationLabel(parseWarrantyDurationMonths(appendItem.warrantyDurationMonths || appendItem.warrantyText))}
              </Text>
            </Pressable>
          ) : null}
          <AmountRow label="Append total" value={appendTotals.grandTotal} strong />
          {appendError ? <Text style={styles.error}>{appendError}</Text> : null}
          <AppButton label={appendMutation.isPending ? "Adding..." : "Append Item"} onPress={() => appendMutation.mutate()} loading={appendMutation.isPending} disabled={Boolean(appendError)} />
        </View>
      ) : null}

      {canCancel && !cancelled ? (
        <View style={styles.manageBox}>
          <Text style={styles.manageTitle}>Cancel invoice</Text>
          <ManageInput label="Reason" value={cancelReason} onChangeText={setCancelReason} />
          {cancelError ? <Text style={styles.error}>{cancelError}</Text> : null}
          <AppButton label={cancelMutation.isPending ? "Cancelling..." : "Cancel Invoice"} variant="danger" onPress={() => cancelMutation.mutate()} loading={cancelMutation.isPending} disabled={Boolean(cancelError)} />
        </View>
      ) : null}
    </Section>
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
  const canPrintPdf = hasPermission(session.user, "documents.printPdf");
  const canShareWhatsapp = hasPermission(session.user, "sharing.whatsapp");
  const blockReason = invoiceShareBlockReason(invoice, phone);
  const accessBlockReason = !canPrintPdf
    ? "This role cannot print invoice PDF files."
    : !canShareWhatsapp
      ? "This role cannot share invoices on WhatsApp."
      : "";
  const disabled = Boolean(accessBlockReason || blockReason || preparingPdf || openingWhatsapp || sharingAgain);

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
      if (accessBlockReason) {
        Alert.alert("No access for this role", accessBlockReason);
        return;
      }
      const pdf = await prepareInvoicePdf({ invoice, settings, cloudUrl: session.cloudUrl, token: session.token, userToken: session.userToken });
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
      {accessBlockReason || blockReason ? <Text style={styles.error}>{accessBlockReason || blockReason}</Text> : null}
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

function ManageInput({
  label,
  value,
  onChangeText,
  keyboardType = "default"
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: "default" | "number-pad" | "decimal-pad";
}) {
  return (
    <View style={styles.manageInputWrap}>
      <Text style={styles.infoLabel}>{label}</Text>
      <TextInput
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholderTextColor={colors.muted}
        style={styles.manageInput}
        value={value}
      />
    </View>
  );
}

function Segmented({
  options,
  value,
  onChange
}: {
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => (
        <Pressable key={option.value} accessibilityRole="button" onPress={() => onChange(option.value)} style={[styles.segment, value === option.value ? styles.segmentActive : null]}>
          <Text style={[styles.segmentText, value === option.value ? styles.segmentTextActive : null]} numberOfLines={1}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function ActionRow({ title, subtitle, onPress }: { title: string; subtitle?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.actionRow, pressed ? styles.actionPressed : null]}>
      <View style={styles.itemText}>
        <Text style={styles.itemTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.itemSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Text style={styles.actionText}>Use</Text>
    </Pressable>
  );
}

function filterServices(rows: ServiceItem[], query: string) {
  const needle = query.trim().toLowerCase();
  const filtered = needle ? rows.filter((row) => [row.name, row.category].some((value) => String(value || "").toLowerCase().includes(needle))) : rows;
  return filtered.slice(0, 5);
}

function filterStock(rows: InventoryItem[], query: string) {
  const needle = query.trim().toLowerCase();
  const filtered = needle ? rows.filter((row) => [row.name, row.sku, row.category].some((value) => String(value || "").toLowerCase().includes(needle))) : rows;
  return filtered.slice(0, 5);
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
  manageBox: {
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    padding: 10
  },
  manageTitle: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "900"
  },
  manageInputWrap: {
    flex: 1,
    minWidth: 132,
    gap: 6
  },
  manageInput: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    paddingHorizontal: 10
  },
  segmented: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  segment: {
    minHeight: 40,
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    paddingHorizontal: 10
  },
  segmentActive: {
    borderColor: colors.primary,
    backgroundColor: colors.chip
  },
  segmentText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  segmentTextActive: {
    color: colors.primaryDark
  },
  actionRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 10
  },
  actionPressed: {
    transform: [{ scale: 0.99 }]
  },
  actionText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900"
  },
  toggleRow: {
    minHeight: 40,
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: colors.greenSoft,
    paddingHorizontal: 10
  },
  toggleText: {
    color: colors.success,
    fontSize: 12,
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
  warrantyText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: "800"
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
