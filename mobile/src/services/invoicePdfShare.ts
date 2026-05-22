import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import QRCode from "qrcode";
import { Linking } from "react-native";
import type { BusinessSettings, InvoiceDetail, InvoiceItem } from "../types/cloud";
import { cleanBaseUrl } from "../utils/format";

type PaperSize = "A4" | "Letter" | "Legal";
type InvoicePageChunk = {
  items: InvoiceItem[];
  startIndex: number;
  showParties: boolean;
  showItemsTable?: boolean;
  showFinalSummary: boolean;
};
type NormalizedBusinessSettings = BusinessSettings & {
  businessName: string;
  invoicePaperSize: PaperSize;
  invoiceAccentColor: string;
  invoiceSecondaryColor: string;
  invoiceFontStyle: "modern" | "classic" | "system";
  invoiceTextSize: "compact" | "standard" | "large";
  invoiceDensity: "compact" | "standard" | "comfortable";
  invoiceLogoSize: "small" | "medium" | "large";
  invoiceWatermarkPlacement: "bottom-right" | "center" | "top-right";
  invoiceWatermarkOpacity: number;
};
type InvoiceAssets = {
  logoSrc: string;
  signatureSrc: string;
  watermarkSrc: string;
  qrSrc: string;
};

const AUTOCAR24_INVOICE_ACCENT = "#d71920";
const AUTOCAR24_INVOICE_BLACK = "#111111";
const rupeeSymbol = "\u20B9";
const paginationProfiles: Record<PaperSize, { single: number; first: number; middle: number; final: number }> = {
  A4: { single: 8, first: 15, middle: 26, final: 12 },
  Letter: { single: 7, first: 14, middle: 24, final: 10 },
  Legal: { single: 14, first: 24, middle: 38, final: 18 }
};
const paperPixels: Record<PaperSize, { width: number; height: number }> = {
  A4: { width: 595, height: 842 },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 }
};

export type WhatsAppPhone = {
  valid: boolean;
  display: string;
  value: string;
};

export type PreparedInvoicePdf = {
  uri: string;
  fileName: string;
  phone: WhatsAppPhone;
  message: string;
};

export function normalizeWhatsAppPhone(phone: string | undefined | null): WhatsAppPhone {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return { valid: true, display: digits, value: `91${digits}` };
  if (digits.length === 12 && digits.startsWith("91")) return { valid: true, display: digits.slice(2), value: digits };
  return { valid: false, display: "", value: "" };
}

export function invoiceShareBlockReason(invoice: InvoiceDetail, phone: WhatsAppPhone) {
  if (invoice.invoiceStatus === "cancelled" || invoice.cancelledAt || invoice.cancelReason) {
    return "Cancelled invoices cannot be shared on WhatsApp.";
  }
  if (invoice.cloudSyncStatus === "pending_cloud" || invoice.cloudSyncStatus === "failed" || String(invoice.invoiceNumber || "").startsWith("LOCAL-")) {
    return "Sync this invoice first. WhatsApp sharing is locked until cloud assigns the final number.";
  }
  if (!phone.valid) return "A valid 10-digit customer phone number is required for WhatsApp sharing.";
  return "";
}

export async function prepareInvoicePdf(input: {
  invoice: InvoiceDetail;
  settings?: BusinessSettings;
  cloudUrl?: string;
  token?: string;
  userToken?: string;
}): Promise<PreparedInvoicePdf> {
  const settings = normalizeSettings(input.settings);
  const phone = normalizeWhatsAppPhone(customerPhone(input.invoice));
  const fileName = invoicePdfFileName(input.invoice);
  const assets = await loadInvoiceAssets(settings, input.cloudUrl, input.token, input.userToken, input.invoice);
  const paper = paperPixels[settings.invoicePaperSize] || paperPixels.A4;
  const result = await Print.printToFileAsync({
    html: buildInvoiceHtml(input.invoice, settings, assets),
    width: paper.width,
    height: paper.height,
    margins: { top: 0, right: 0, bottom: 0, left: 0 }
  });
  const targetUri = await invoicePdfUri(fileName);
  await FileSystem.deleteAsync(targetUri, { idempotent: true });
  await FileSystem.copyAsync({ from: result.uri, to: targetUri });
  return {
    uri: targetUri,
    fileName,
    phone,
    message: buildInvoiceWhatsAppMessage(input.invoice, input.settings)
  };
}

export async function sharePreparedInvoicePdf(pdf: PreparedInvoicePdf) {
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error("File sharing is not available on this phone.");
  await Sharing.shareAsync(pdf.uri, {
    dialogTitle: "Share invoice PDF on WhatsApp",
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf"
  });
}

export async function openInvoiceWhatsAppChat(input: { invoice: InvoiceDetail; settings?: BusinessSettings }) {
  const phone = normalizeWhatsAppPhone(customerPhone(input.invoice));
  if (!phone.valid) throw new Error("A valid 10-digit customer phone number is required for WhatsApp sharing.");
  const message = buildInvoiceWhatsAppMessage(input.invoice, input.settings);
  const encoded = encodeURIComponent(message);
  const appUrl = `whatsapp://send?phone=${phone.value}&text=${encoded}`;
  const webUrl = `https://wa.me/${phone.value}?text=${encoded}`;
  try {
    await Linking.openURL(appUrl);
  } catch {
    await Linking.openURL(webUrl);
  }
}

export function buildInvoiceWhatsAppMessage(invoice: InvoiceDetail, settings?: BusinessSettings) {
  const businessName = compactText(settings?.businessName) || "Autocare24";
  const customer = customerName(invoice) || "Customer";
  return [
    `Hi ${customer},`,
    `${businessName} invoice PDF is ready.`,
    `Invoice: ${invoice.invoiceNumber || "Not available"}`,
    `Amount: ${shareMoney(invoice.grandTotal)}`,
    Number(invoice.balanceDue || 0) > 0 ? `Balance due: ${shareMoney(invoice.balanceDue)}` : "Payment status: Paid",
    vehicleNumber(invoice) ? `Vehicle: ${vehicleNumber(invoice)}` : "",
    "Please check the attached PDF.",
    "Thank you."
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeSettings(settings?: BusinessSettings): NormalizedBusinessSettings {
  const paperSize = ["A4", "Letter", "Legal"].includes(String(settings?.invoicePaperSize || "")) ? settings?.invoicePaperSize as PaperSize : "A4";
  const fontStyle = ["modern", "classic", "system"].includes(String(settings?.invoiceFontStyle || "")) ? settings?.invoiceFontStyle as NormalizedBusinessSettings["invoiceFontStyle"] : "modern";
  const textSize = ["compact", "standard", "large"].includes(String(settings?.invoiceTextSize || "")) ? settings?.invoiceTextSize as NormalizedBusinessSettings["invoiceTextSize"] : "standard";
  const density = ["compact", "standard", "comfortable"].includes(String(settings?.invoiceDensity || "")) ? settings?.invoiceDensity as NormalizedBusinessSettings["invoiceDensity"] : "standard";
  const logoSize = ["small", "medium", "large"].includes(String(settings?.invoiceLogoSize || "")) ? settings?.invoiceLogoSize as NormalizedBusinessSettings["invoiceLogoSize"] : "medium";
  const watermarkPlacement = ["bottom-right", "center", "top-right"].includes(String(settings?.invoiceWatermarkPlacement || "")) ? settings?.invoiceWatermarkPlacement as NormalizedBusinessSettings["invoiceWatermarkPlacement"] : "bottom-right";
  const normalized = {
    businessName: "Autocare24 Bike & Car Detailing Studio",
    address: "",
    phone: "",
    email: "",
    gstin: "",
    state: "",
    invoicePaperSize: paperSize,
    invoiceLogoPath: "",
    invoiceSignaturePath: "",
    invoiceWatermarkPath: "",
    invoiceAccentColor: safeColor(settings?.invoiceAccentColor, AUTOCAR24_INVOICE_ACCENT),
    invoiceSecondaryColor: safeColor(settings?.invoiceSecondaryColor, AUTOCAR24_INVOICE_BLACK),
    invoiceFontStyle: fontStyle,
    invoiceTextSize: textSize,
    invoiceDensity: density,
    invoiceLogoSize: logoSize,
    invoiceWatermarkOpacity: Number.isFinite(Number(settings?.invoiceWatermarkOpacity)) ? Number(settings?.invoiceWatermarkOpacity) : 0.12,
    invoiceWatermarkPlacement: watermarkPlacement,
    gstInvoiceTitle: "Tax Invoice",
    simpleReceiptTitle: "Invoice",
    quotationTitle: "Quotation",
    invoiceTerms: "Goods and services once sold are subject to studio policy. Please retain this invoice for service records.",
    invoiceFooterNote: "Thank you for choosing Autocare24.",
    bankName: "",
    bankAccountName: "",
    bankAccountNumber: "",
    bankIfsc: "",
    upiId: "",
    signatureLabel: "Authorized Signatory",
    showLogo: true,
    showGstin: true,
    showVehicleDetails: true,
    showPaymentDetails: true,
    showTerms: true,
    showSignature: true,
    showBusinessPhone: true,
    showBusinessEmail: true,
    showBusinessAddress: true,
    showCustomerPhone: true,
    showCustomerAddress: true,
    showCustomerGstin: true,
    showInvoiceStatus: true,
    showPaymentMode: true,
    showPaidAmount: true,
    showBalanceDue: true,
    showSacCode: true,
    showItemGstRate: true,
    showFooterContactBar: true,
    showUpiQr: true,
    invoiceNumberLabel: "Invoice No.",
    invoiceDateLabel: "Date",
    billToLabel: "Bill To",
    vehicleDetailsLabel: "Vehicle Details",
    paymentDetailsLabel: "Payment Details",
    bankDetailsLabel: "Bank Details",
    termsLabel: "Terms & Conditions",
    subtotalLabel: "Subtotal",
    grandTotalLabel: "Grand Total",
    paidLabel: "Paid",
    balanceDueLabel: "Balance Due",
    paymentInstructions: "",
    ...(settings || {})
  };
  return {
    ...normalized,
    invoicePaperSize: paperSize,
    invoiceAccentColor: safeColor(settings?.invoiceAccentColor, AUTOCAR24_INVOICE_ACCENT),
    invoiceSecondaryColor: safeColor(settings?.invoiceSecondaryColor, AUTOCAR24_INVOICE_BLACK),
    invoiceFontStyle: fontStyle,
    invoiceTextSize: textSize,
    invoiceDensity: density,
    invoiceLogoSize: logoSize,
    invoiceWatermarkOpacity: Number.isFinite(Number(settings?.invoiceWatermarkOpacity)) ? Number(settings?.invoiceWatermarkOpacity) : 0.12,
    invoiceWatermarkPlacement: watermarkPlacement
  };
}

async function loadInvoiceAssets(
  settings: NormalizedBusinessSettings,
  cloudUrl: string | undefined,
  token: string | undefined,
  userToken: string | undefined,
  invoice: InvoiceDetail
): Promise<InvoiceAssets> {
  const [logoSrc, signatureSrc, watermarkSrc, qrSrc] = await Promise.all([
    enabled(settings.showLogo) ? cloudAssetDataUrl(settings.invoiceLogoPath, cloudUrl, token, userToken) : Promise.resolve(""),
    enabled(settings.showSignature) ? cloudAssetDataUrl(settings.invoiceSignaturePath, cloudUrl, token, userToken) : Promise.resolve(""),
    settings.invoiceWatermarkPath ? cloudAssetDataUrl(settings.invoiceWatermarkPath, cloudUrl, token, userToken) : Promise.resolve(""),
    buildUpiQrDataUrl(settings, invoice)
  ]);
  return {
    logoSrc,
    signatureSrc,
    watermarkSrc,
    qrSrc
  };
}

async function cloudAssetDataUrl(filePath: string | undefined, cloudUrl: string | undefined, token: string | undefined, userToken: string | undefined) {
  const fileId = cloudFileId(filePath);
  if (!fileId || !cloudUrl || !token) return "";
  const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!baseDirectory) return "";
  try {
    const targetUri = `${baseDirectory}invoice-asset-${fileNamePart(fileId, "asset")}`;
    await FileSystem.deleteAsync(targetUri, { idempotent: true });
    const response = await FileSystem.downloadAsync(`${cleanBaseUrl(cloudUrl)}/api/v1/files/${encodeURIComponent(fileId)}`, targetUri, {
      headers: {
        authorization: `Bearer ${token}`,
        ...(userToken ? { "x-autocare-user-token": userToken } : {})
      }
    });
    if (response.status >= 400) return "";
    const base64 = await FileSystem.readAsStringAsync(response.uri, { encoding: FileSystem.EncodingType.Base64 });
    const headers = response.headers as Record<string, string> | undefined;
    const mimeType = headers?.["content-type"] || headers?.["Content-Type"] || "image/png";
    return `data:${mimeType};base64,${base64}`;
  } catch {
    return "";
  }
}

function buildInvoiceHtml(invoice: InvoiceDetail, settings: NormalizedBusinessSettings, assets: InvoiceAssets) {
  const pages = paginateInvoiceItems(invoice, settings.invoicePaperSize, settings);
  const title = invoice.invoiceMode === "gst" ? settings.gstInvoiceTitle || "Tax Invoice" : settings.simpleReceiptTitle || "Invoice";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>${premiumInvoiceCss()}</style>
</head>
<body>
  <article
    class="premium-invoice-document premium-invoice-document-mobile premium-paper-${settings.invoicePaperSize.toLowerCase()} premium-font-${settings.invoiceFontStyle} premium-text-${settings.invoiceTextSize} premium-density-${settings.invoiceDensity} premium-logo-${settings.invoiceLogoSize} premium-watermark-${settings.invoiceWatermarkPlacement}"
    style="--invoice-accent:${escapeHtml(settings.invoiceAccentColor)};--premium-brand-black:${escapeHtml(settings.invoiceSecondaryColor)};--premium-watermark-opacity:${settings.invoiceWatermarkOpacity};"
  >
    ${pages.map((page, index) => premiumInvoicePage(invoice, settings, assets, page, index, pages.length, title)).join("")}
  </article>
</body>
</html>`;
}

function premiumInvoicePage(
  invoice: InvoiceDetail,
  settings: NormalizedBusinessSettings,
  assets: InvoiceAssets,
  chunk: InvoicePageChunk,
  pageIndex: number,
  pageCount: number,
  title: string
) {
  return `<section class="premium-invoice-page">
    ${premiumInvoiceHeader(invoice, settings, assets.logoSrc, title, pageIndex + 1, pageCount)}
    <main class="premium-invoice-body">
      ${chunk.showParties ? premiumPartyCards(invoice, settings) : premiumContinuation(invoice)}
      ${chunk.showItemsTable === false ? "" : premiumItemsTable(invoice, settings, chunk.items, chunk.startIndex)}
      ${chunk.showFinalSummary ? premiumFinalSummary(invoice, settings, assets.watermarkSrc) : ""}
    </main>
    ${premiumInvoiceFooter(invoice, settings, assets)}
  </section>`;
}

function premiumInvoiceHeader(invoice: InvoiceDetail, settings: NormalizedBusinessSettings, logoSrc: string, title: string, pageNumber: number, pageCount: number) {
  return `<header class="premium-invoice-header ${enabled(settings.showLogo) ? "" : "premium-no-logo"}">
    <div class="premium-logo-panel">
      ${enabled(settings.showLogo) ? logoSrc ? `<img src="${logoSrc}" alt="" />` : premiumLogoFallback() : ""}
    </div>
    <div class="premium-business-panel">
      <h2>${escapeHtml(settings.businessName || "Autocare24 Detailing Studio")}</h2>
      ${enabled(settings.showBusinessAddress) ? premiumInfoLine("map-pin", settings.address || "Business address not configured") : ""}
      ${enabled(settings.showBusinessPhone) && settings.phone ? premiumInfoLine("phone", settings.phone) : ""}
      ${enabled(settings.showBusinessEmail) && settings.email ? premiumInfoLine("mail", settings.email) : ""}
      ${enabled(settings.showGstin) && settings.gstin ? premiumInfoLine("file-text", `GSTIN: ${settings.gstin}`) : ""}
    </div>
    <div class="premium-meta-panel">
      <h1>${escapeHtml(title.toUpperCase())}</h1>
      ${premiumMetaRow(settings.invoiceNumberLabel || "Invoice No.", invoice.invoiceNumber)}
      ${premiumMetaRow(settings.invoiceDateLabel || "Date", formatInvoiceDate(invoice.invoiceDate))}
      ${enabled(settings.showInvoiceStatus) ? premiumMetaRow("Status", `<span class="premium-status premium-status-${invoice.invoiceStatus === "cancelled" ? "unpaid" : invoice.paymentStatus || "unpaid"}">${escapeHtml(invoice.invoiceStatus === "cancelled" ? "Cancelled" : statusLabel(invoice.paymentStatus))}</span>`, true) : ""}
      ${enabled(settings.showPaymentMode) ? premiumMetaRow("Payment Mode", invoice.paymentMode) : ""}
      ${premiumMetaRow("Page", `${pageNumber} of ${pageCount}`)}
    </div>
  </header>`;
}

function premiumPartyCards(invoice: InvoiceDetail, settings: NormalizedBusinessSettings) {
  const customer = invoice.customer || {};
  const vehicle = invoice.vehicle || {};
  const vehicleRows = [
    { icon: "car", label: "Type", value: vehicleTypeLabel(vehicle.vehicleType || invoice.vehicleType) },
    { icon: "credit-card", label: "Registration No.", value: vehicle.registrationNumber || invoice.vehicleNumber },
    { icon: "calendar-days", label: "Make / Model", value: [vehicle.make, vehicle.model].filter(Boolean).join(" ") },
    { icon: "file-text", label: "Color", value: vehicle.color }
  ].filter((item) => item.value);

  return `<section class="premium-party-grid">
    <div class="premium-detail-card">
      <div class="premium-card-title"><span>${svgIcon("user", 18)}</span> ${escapeHtml(settings.billToLabel || "Bill To")}</div>
      <strong>${escapeHtml(customer.name || invoice.customerName || "Customer")}</strong>
      ${enabled(settings.showCustomerPhone) && (customer.phone || invoice.customerPhone) ? premiumInfoLine("phone", customer.phone || invoice.customerPhone) : ""}
      ${enabled(settings.showCustomerAddress) && customer.address ? premiumInfoLine("map-pin", customer.address) : ""}
      ${enabled(settings.showGstin) && enabled(settings.showCustomerGstin) && customer.gstin ? premiumInfoLine("file-text", `GSTIN: ${customer.gstin}`) : ""}
    </div>
    ${enabled(settings.showVehicleDetails) ? `<div class="premium-detail-card">
      <div class="premium-card-title"><span>${svgIcon("car", 18)}</span> ${escapeHtml(settings.vehicleDetailsLabel || "Vehicle Details")}</div>
      ${vehicleRows.map((row) => premiumDetailRow(row.icon, row.label, row.value)).join("")}
    </div>` : ""}
  </section>`;
}

function premiumItemsTable(invoice: InvoiceDetail, settings: NormalizedBusinessSettings, items: InvoiceItem[], startIndex: number) {
  const gstMode = invoice.invoiceMode === "gst";
  const showItemGstRate = gstMode && enabled(settings.showItemGstRate);
  const showSacCode = gstMode && enabled(settings.showSacCode);
  const columnCount = 5 + (showItemGstRate ? 1 : 0) + (showSacCode ? 1 : 0);
  const rows = items.map((item, index) => `<tr>
    <td>${startIndex + index + 1}</td>
    <td>${escapeHtml(item.description || "Invoice item")}</td>
    <td>${escapeHtml(item.quantity)}</td>
    <td>${money(item.unitPrice).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    ${showItemGstRate ? `<td>${escapeHtml(item.gstRate)}%</td>` : ""}
    ${showSacCode ? `<td>${escapeHtml(item.sacCode || "")}</td>` : ""}
    <td>${money(item.lineTotal).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
  </tr>`);
  return `<table class="premium-items-table ${gstMode ? "premium-gst-table" : "premium-simple-table"}">
    <colgroup>
      <col class="premium-col-index" />
      <col class="premium-col-description" />
      <col class="premium-col-qty" />
      <col class="premium-col-rate" />
      ${showItemGstRate ? `<col class="premium-col-gst" />` : ""}
      ${showSacCode ? `<col class="premium-col-sac" />` : ""}
      <col class="premium-col-amount" />
    </colgroup>
    <thead><tr>
      <th>#</th><th>Service / Item</th><th>Qty</th><th>Rate (${rupeeSymbol})</th>
      ${showItemGstRate ? "<th>GST</th>" : ""}
      ${showSacCode ? "<th>SAC</th>" : ""}
      <th>Amount (${rupeeSymbol})</th>
    </tr></thead>
    <tbody>${rows.length ? rows.join("") : `<tr><td colspan="${columnCount}">No invoice items found.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="${columnCount}">Total Items: ${(invoice.items || []).length}</td></tr></tfoot>
  </table>`;
}

function premiumFinalSummary(invoice: InvoiceDetail, settings: NormalizedBusinessSettings, watermarkSrc: string) {
  const cgstRate = invoice.taxableValue > 0 ? money((invoice.cgst / invoice.taxableValue) * 100) : 0;
  const sgstRate = invoice.taxableValue > 0 ? money((invoice.sgst / invoice.taxableValue) * 100) : 0;
  const igstRate = invoice.taxableValue > 0 ? money((invoice.igst / invoice.taxableValue) * 100) : 0;
  return `<section class="premium-final-grid">
    <div class="premium-notes-card">
      <div class="premium-card-title"><span>${svgIcon("file-text", 18)}</span> Notes</div>
      <p>${escapeHtml(invoice.notes || settings.invoiceFooterNote || "Thank you for choosing Autocare24.")}</p>
      ${enabled(settings.showTerms) && settings.invoiceTerms ? `<div class="premium-divider"></div><div class="premium-card-title"><span>${svgIcon("clipboard-list", 18)}</span> ${escapeHtml(settings.termsLabel || "Terms & Conditions")}</div><p>${escapeHtml(settings.invoiceTerms)}</p>` : ""}
      ${premiumWatermark(watermarkSrc)}
    </div>
    <div class="premium-total-card">
      ${premiumTotalRow(settings.subtotalLabel || "Subtotal", formatInvoiceMoney(invoice.subTotal))}
      ${premiumTotalRow("Discount", formatInvoiceMoney(invoice.discount))}
      ${invoice.invoiceMode === "gst" ? premiumTotalRow("Taxable Value", formatInvoiceMoney(invoice.taxableValue), true) : ""}
      ${invoice.cgst > 0 ? premiumTotalRow(`CGST (${cgstRate}%)`, formatInvoiceMoney(invoice.cgst)) : ""}
      ${invoice.sgst > 0 ? premiumTotalRow(`SGST (${sgstRate}%)`, formatInvoiceMoney(invoice.sgst)) : ""}
      ${invoice.igst > 0 ? premiumTotalRow(`IGST (${igstRate}%)`, formatInvoiceMoney(invoice.igst)) : ""}
      <div class="premium-grand-row"><span>${escapeHtml(settings.grandTotalLabel || "Grand Total")}</span><strong>${formatInvoiceMoney(invoice.grandTotal)}</strong></div>
      ${enabled(settings.showPaidAmount) ? premiumTotalRow(settings.paidLabel || "Paid", formatInvoiceMoney(invoice.paidAmount)) : ""}
      ${enabled(settings.showBalanceDue) ? `<div class="premium-balance-row"><span>${escapeHtml(settings.balanceDueLabel || "Balance Due")}</span><strong>${formatInvoiceMoney(invoice.balanceDue)}</strong></div>` : ""}
    </div>
  </section>`;
}

function premiumInvoiceFooter(invoice: InvoiceDetail, settings: NormalizedBusinessSettings, assets: InvoiceAssets) {
  const bankRows = [
    { label: "Bank", value: compactText(settings.bankName) },
    { label: "A/C Name", value: compactText(settings.bankAccountName) },
    { label: "A/C No.", value: compactText(settings.bankAccountNumber) },
    { label: "IFSC", value: compactText(settings.bankIfsc) }
  ].filter((row) => row.value);
  const upiId = compactText(settings.upiId);
  const paymentInstructions = compactText(settings.paymentInstructions);
  const showUpiBlock = Boolean(upiId) && enabled(settings.showUpiQr);
  const showBankPaymentBlock = enabled(settings.showPaymentDetails) && (bankRows.length > 0 || Boolean(paymentInstructions));
  const showPaymentBlock = showBankPaymentBlock || showUpiBlock;
  const showFooterMain = showPaymentBlock || enabled(settings.showSignature);
  const footerMainClass = showPaymentBlock && enabled(settings.showSignature) ? "premium-footer-main" : "premium-footer-main premium-footer-main-single";
  const contactItems = [
    enabled(settings.showBusinessPhone) && settings.phone ? { id: "phone", icon: "phone", text: settings.phone } : null,
    enabled(settings.showBusinessEmail) && settings.email ? { id: "email", icon: "mail", text: settings.email } : null,
    enabled(settings.showBusinessAddress) ? { id: "address", icon: "map-pin", text: settings.address || "Business address not configured" } : null
  ].filter((item): item is { id: string; icon: string; text: string } => Boolean(item));

  return `<footer class="premium-invoice-footer">
    ${showFooterMain ? `<div class="${footerMainClass}">
      ${showPaymentBlock ? `<div class="premium-payment-details ${showBankPaymentBlock && showUpiBlock ? "" : "premium-payment-single"}">
        ${showBankPaymentBlock ? `<div class="premium-bank-details">
          <strong>${escapeHtml(bankRows.length ? settings.bankDetailsLabel || "Bank Details" : settings.paymentDetailsLabel || "Payment Details")}</strong>
          ${bankRows.map((row) => `<div><span>${escapeHtml(row.label)}</span><b>:</b><em>${escapeHtml(row.value)}</em></div>`).join("")}
          ${paymentInstructions ? `<p>${escapeHtml(paymentInstructions)}</p>` : ""}
        </div>` : ""}
        ${showUpiBlock ? `<div class="premium-upi-block">${assets.qrSrc ? `<img src="${assets.qrSrc}" alt="" />` : svgIcon("qr-code", 58)}<div><strong>Scan to Pay</strong><span>UPI ID</span><small>${escapeHtml(upiId)}</small></div></div>` : ""}
      </div>` : ""}
      ${enabled(settings.showSignature) ? `<div class="premium-signature">${assets.signatureSrc ? `<img src="${assets.signatureSrc}" alt="" />` : svgIcon("pen-line", 56)}<span>${escapeHtml(settings.signatureLabel || "Authorized Signatory")}</span></div>` : ""}
    </div>` : ""}
    ${enabled(settings.showFooterContactBar) ? `<div class="premium-contact-strip">${contactItems.map((item) => `<span>${svgIcon(item.icon, 15)} ${escapeHtml(item.text)}</span>`).join("")}${!contactItems.length && enabled(settings.showPaymentMode) ? `<span>${svgIcon("wallet", 15)} Payment mode: ${escapeHtml(invoice.paymentMode)}</span>` : ""}</div>` : ""}
  </footer>`;
}

function premiumInfoLine(iconName: string, text: string) {
  return `<div class="premium-info-line">${svgIcon(iconName, 16)}<span>${escapeHtml(text)}</span></div>`;
}

function premiumMetaRow(label: string, value: unknown, trustedHtml = false) {
  return `<div class="premium-meta-row"><span>${escapeHtml(label)}</span><b>:</b><strong>${trustedHtml ? String(value) : escapeHtml(value)}</strong></div>`;
}

function premiumDetailRow(iconName: string, label: string, value: unknown) {
  return `<div class="premium-detail-row">${svgIcon(iconName, 14)}<span>${escapeHtml(label)}</span><b>:</b><strong>${escapeHtml(value)}</strong></div>`;
}

function premiumContinuation(invoice: InvoiceDetail) {
  return `<div class="premium-continuation"><strong>Service / item details continued</strong><span>${escapeHtml(invoice.invoiceNumber)}</span></div>`;
}

function premiumTotalRow(label: string, value: string, separated = false) {
  return `<div class="premium-total-row ${separated ? "separated" : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function premiumWatermark(src: string) {
  if (src) return `<img class="premium-watermark-image" src="${src}" alt="" />`;
  return `<svg class="premium-watermark-svg" viewBox="0 0 260 110" aria-hidden="true">
    <path d="M42 72h162c8 0 14-6 14-14v-7c0-9-6-16-15-18l-35-7c-11-13-27-20-44-20H86c-17 0-31 8-40 22L27 34c-11 4-18 14-18 26v7c0 3 2 5 5 5h18" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="66" cy="74" r="16" fill="none" stroke="currentColor" stroke-width="5" />
    <circle cx="181" cy="74" r="16" fill="none" stroke="currentColor" stroke-width="5" />
    <path d="M83 28h36m16 0h28M68 51h114" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
  </svg>`;
}

function premiumLogoFallback() {
  return `<div class="premium-logo-fallback"><strong>AUTOCARE<span>24</span></strong><small>DETAILING STUDIO</small></div>`;
}

function premiumInvoiceCss() {
  return `
    @page { margin: 0; size: A4; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; background: #ffffff; color: #111111; }
    .premium-invoice-document {
      --invoice-accent: ${AUTOCAR24_INVOICE_ACCENT};
      --premium-brand-black: ${AUTOCAR24_INVOICE_BLACK};
      --premium-border: #d9dde3;
      --premium-text: #111111;
      --premium-muted: #5f6368;
      --premium-accent-soft: color-mix(in srgb, var(--invoice-accent) 9%, #ffffff);
      --premium-accent-border: color-mix(in srgb, var(--invoice-accent) 35%, #ffffff);
      display: block;
      width: auto;
      margin: 0;
      padding: 0;
      color: var(--premium-text);
    }
    .premium-paper-a4 .premium-invoice-page { --premium-page-width: 210mm; --premium-page-height: 297mm; }
    .premium-paper-letter .premium-invoice-page { --premium-page-width: 216mm; --premium-page-height: 279mm; }
    .premium-paper-legal .premium-invoice-page { --premium-page-width: 216mm; --premium-page-height: 356mm; }
    .premium-invoice-page {
      width: var(--premium-page-width);
      height: var(--premium-page-height);
      display: flex;
      flex-direction: column;
      margin: 0 !important;
      padding: 9mm 9mm 0;
      background: #ffffff;
      border: 0;
      box-shadow: none;
      overflow: hidden;
      font-family: Arial, Helvetica, sans-serif;
      break-after: page;
      page-break-after: always;
    }
    .premium-invoice-page:last-child { break-after: auto; page-break-after: auto; }
    .premium-font-classic .premium-invoice-page { font-family: Georgia, "Times New Roman", serif; }
    .premium-font-system .premium-invoice-page { font-family: "Segoe UI", Arial, Helvetica, sans-serif; }
    .premium-text-compact .premium-business-panel h2 { font-size: 13.5pt; }
    .premium-text-compact .premium-meta-panel h1 { font-size: 18pt; }
    .premium-text-compact .premium-info-line, .premium-text-compact .premium-detail-row, .premium-text-compact .premium-total-row { font-size: 8.4pt; }
    .premium-text-compact .premium-items-table { font-size: 7.8pt; }
    .premium-text-large .premium-business-panel h2 { font-size: 16.5pt; }
    .premium-text-large .premium-meta-panel h1 { font-size: 22pt; }
    .premium-text-large .premium-info-line, .premium-text-large .premium-detail-row, .premium-text-large .premium-total-row { font-size: 10.2pt; }
    .premium-text-large .premium-items-table { font-size: 8.9pt; }
    .premium-density-compact .premium-invoice-page { padding: 7mm 8mm 0; }
    .premium-density-compact .premium-invoice-header { gap: 4mm; min-height: 39mm; padding-bottom: 3mm; }
    .premium-density-compact .premium-invoice-body { gap: 3.5mm; padding-top: 3.5mm; }
    .premium-density-compact .premium-detail-card, .premium-density-compact .premium-notes-card { padding: 3mm; }
    .premium-density-compact .premium-items-table th, .premium-density-compact .premium-items-table td { padding: 1.25mm 1.8mm; }
    .premium-density-comfortable .premium-invoice-page { padding: 11mm 10mm 0; }
    .premium-density-comfortable .premium-invoice-header { gap: 7mm; min-height: 50mm; padding-bottom: 5mm; }
    .premium-density-comfortable .premium-invoice-body { gap: 6mm; padding-top: 6mm; }
    .premium-invoice-header { display: grid; grid-template-columns: 50mm minmax(0, 1fr) 70mm; gap: 6mm; align-items: center; min-height: 45mm; padding-bottom: 4mm; border-bottom: 2px solid var(--premium-brand-black); box-shadow: inset 0 -1.1mm 0 var(--invoice-accent); }
    .premium-invoice-header.premium-no-logo { grid-template-columns: minmax(0, 1fr) 70mm; }
    .premium-invoice-header.premium-no-logo .premium-logo-panel { display: none; }
    .premium-logo-panel, .premium-business-panel { min-width: 0; min-height: 33mm; display: grid; align-content: center; }
    .premium-logo-panel { justify-items: center; padding-right: 7mm; border-right: 1px solid var(--premium-border); }
    .premium-logo-panel img { max-width: 47mm; max-height: 34mm; object-fit: contain; }
    .premium-logo-small .premium-logo-panel img { max-width: 36mm; max-height: 26mm; }
    .premium-logo-large .premium-logo-panel img { max-width: 56mm; max-height: 38mm; }
    .premium-logo-fallback { display: grid; gap: 2mm; justify-items: center; color: var(--premium-brand-black); text-align: center; line-height: 1; }
    .premium-logo-fallback strong { font-size: 20pt; letter-spacing: 0; }
    .premium-logo-small .premium-logo-fallback strong { font-size: 16pt; }
    .premium-logo-large .premium-logo-fallback strong { font-size: 24pt; }
    .premium-logo-fallback strong span { color: var(--invoice-accent); }
    .premium-logo-fallback small { padding-top: 1mm; border-top: 1px solid var(--invoice-accent); color: var(--premium-brand-black); font-size: 7pt; font-weight: 800; }
    .premium-business-panel { padding-right: 5mm; border-right: 1px solid var(--premium-border); }
    .premium-business-panel h2 { margin: 0 0 4mm; color: var(--premium-brand-black); font-size: 15pt; line-height: 1.15; }
    .premium-info-line { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3mm; align-items: start; margin: 0 0 2mm; color: var(--premium-text); font-size: 9.5pt; line-height: 1.25; }
    .premium-info-line svg { color: var(--invoice-accent); stroke-width: 2.1; }
    .premium-info-line span { overflow-wrap: anywhere; }
    .premium-meta-panel { display: grid; gap: 2.2mm; align-content: center; }
    .premium-meta-panel h1 { margin: 0 0 2mm; color: var(--invoice-accent); font-size: 20pt; line-height: 1; text-align: right; letter-spacing: 0; }
    .premium-meta-row { display: grid; grid-template-columns: 24mm 2mm minmax(0, 1fr); gap: 1.5mm; align-items: center; font-size: 9pt; }
    .premium-meta-row span { color: var(--premium-text); }
    .premium-meta-row strong { min-width: 0; font-weight: 700; overflow-wrap: anywhere; }
    .premium-meta-row .premium-status { display: inline-flex; align-items: center; min-height: 5.5mm; padding: 0.8mm 1.8mm; border-radius: 1.6mm; background: var(--premium-accent-soft); border: 1px solid var(--premium-accent-border); color: var(--premium-brand-black); font-size: 8.5pt; font-weight: 900; text-transform: uppercase; }
    .premium-meta-row .premium-status-unpaid { background: var(--invoice-accent); border-color: var(--invoice-accent); color: #ffffff; }
    .premium-meta-row .premium-status-partial { background: var(--premium-accent-soft); border-color: var(--invoice-accent); color: var(--premium-brand-black); }
    .premium-meta-row .premium-status-paid { background: #e4f1eb; border-color: #94c8b8; color: #1c5d52; }
    .premium-invoice-body { display: grid; gap: 5mm; align-content: start; padding-top: 5mm; }
    .premium-party-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7mm; }
    .premium-detail-card, .premium-notes-card, .premium-total-card { border: 1px solid var(--premium-border); border-radius: 2mm; background: #ffffff; }
    .premium-detail-card { min-height: 30mm; padding: 4mm; }
    .premium-card-title { display: flex; align-items: center; gap: 2.4mm; margin-bottom: 3mm; color: var(--premium-brand-black); font-size: 10pt; font-weight: 900; text-transform: uppercase; }
    .premium-card-title span { display: inline-flex; align-items: center; justify-content: center; width: 8mm; height: 8mm; border-radius: 1.5mm; background: var(--premium-brand-black); box-shadow: inset 0 -1mm 0 var(--invoice-accent); color: #ffffff; }
    .premium-detail-card > strong { display: block; margin-bottom: 2.4mm; font-size: 11.5pt; }
    .premium-detail-row { display: grid; grid-template-columns: 5mm 30mm 3mm minmax(0, 1fr); gap: 2mm; align-items: center; margin-bottom: 2.2mm; font-size: 9.2pt; }
    .premium-detail-row svg { color: var(--invoice-accent); }
    .premium-detail-row span { color: var(--premium-text); }
    .premium-detail-row strong { min-width: 0; overflow-wrap: anywhere; }
    .premium-continuation { display: flex; align-items: center; justify-content: space-between; padding: 3mm 4mm; border: 1px solid var(--premium-border); border-radius: 2mm; color: var(--premium-brand-black); font-size: 9.5pt; }
    .premium-items-table { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; overflow: hidden; border: 1px solid var(--premium-border); border-radius: 1.6mm; font-size: 8.3pt; line-height: 1.1; }
    .premium-items-table th, .premium-items-table td { padding: 1.55mm 2.2mm; border-right: 1px solid var(--premium-border); border-bottom: 1px solid var(--premium-border); text-align: center; vertical-align: top; }
    .premium-items-table th { background: var(--premium-brand-black); box-shadow: inset 0 -0.9mm 0 var(--invoice-accent); color: #ffffff; font-size: 8.1pt; font-weight: 900; text-transform: uppercase; }
    .premium-items-table td:nth-child(2), .premium-items-table th:nth-child(2) { text-align: left; }
    .premium-items-table td:last-child, .premium-items-table th:last-child { border-right: 0; text-align: right; }
    .premium-items-table tbody tr:last-child td { border-bottom: 1px solid var(--premium-border); }
    .premium-items-table tfoot td { border: 0; color: var(--premium-brand-black); font-weight: 900; text-align: left; }
    .premium-col-index { width: 11mm; }
    .premium-col-qty, .premium-col-gst { width: 18mm; }
    .premium-col-rate { width: 27mm; }
    .premium-col-sac { width: 24mm; }
    .premium-col-amount { width: 33mm; }
    .premium-final-grid { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 6mm; }
    .premium-notes-card { position: relative; min-height: 38mm; padding: 4mm; overflow: hidden; }
    .premium-notes-card p { position: relative; z-index: 1; margin: 0 0 3mm; color: var(--premium-text); font-size: 9pt; line-height: 1.45; white-space: pre-line; }
    .premium-divider { position: relative; z-index: 1; margin: 3.5mm 0 3mm; border-top: 1px dashed var(--premium-border); }
    .premium-watermark-image, .premium-watermark-svg { position: absolute; right: 9mm; bottom: 4mm; width: 54mm; max-height: 28mm; color: var(--invoice-accent); opacity: var(--premium-watermark-opacity, 0.12); object-fit: contain; }
    .premium-watermark-center .premium-watermark-image, .premium-watermark-center .premium-watermark-svg { right: 50%; bottom: 50%; width: 64mm; max-height: 34mm; transform: translate(50%, 50%); }
    .premium-watermark-top-right .premium-watermark-image, .premium-watermark-top-right .premium-watermark-svg { top: 4mm; right: 7mm; bottom: auto; width: 48mm; }
    .premium-total-card { padding: 4mm 5mm 0; overflow: hidden; }
    .premium-total-row { display: flex; justify-content: space-between; gap: 8mm; padding: 0 0 2mm; margin-bottom: 2mm; color: var(--premium-text); font-size: 9.5pt; }
    .premium-total-row.separated { padding-top: 2mm; border-top: 1px solid var(--premium-border); }
    .premium-grand-row { display: flex; align-items: center; justify-content: space-between; gap: 8mm; margin: 0.5mm 0 3mm; padding: 2.4mm 3.5mm; border-radius: 1.6mm; background: var(--premium-accent-soft); border: 1px solid var(--premium-accent-border); color: var(--premium-brand-black); font-size: 10pt; font-weight: 900; text-transform: uppercase; }
    .premium-grand-row strong, .premium-balance-row strong { color: var(--premium-brand-black); font-size: 14pt; }
    .premium-balance-row { display: flex; align-items: center; justify-content: space-between; gap: 8mm; margin: 3mm -5mm 0; padding: 3.2mm 5mm; background: var(--premium-brand-black); border-top: 1.1mm solid var(--invoice-accent); color: #ffffff; font-size: 12pt; font-weight: 900; text-transform: uppercase; }
    .premium-balance-row strong { color: #ffffff; }
    .premium-invoice-footer { margin-top: auto; }
    .premium-footer-main { display: grid; grid-template-columns: minmax(0, 1fr) 55mm; gap: 6mm; align-items: center; padding: 3.5mm 0 4mm; border-top: 1px solid var(--premium-brand-black); }
    .premium-footer-main-single { grid-template-columns: minmax(0, 1fr); }
    .premium-payment-details, .premium-signature { min-width: 0; }
    .premium-payment-details { display: grid; grid-template-columns: minmax(0, 1fr) 50mm; gap: 5mm; align-items: center; }
    .premium-payment-single { grid-template-columns: minmax(0, 1fr); }
    .premium-payment-single .premium-bank-details { padding-right: 0; border-right: 0; }
    .premium-bank-details { display: grid; gap: 1.35mm; padding-right: 5mm; border-right: 1px solid var(--premium-border); }
    .premium-bank-details strong, .premium-upi-block strong { display: block; margin-bottom: 1.6mm; color: var(--premium-brand-black); font-size: 8.8pt; font-weight: 900; text-transform: uppercase; }
    .premium-bank-details div { display: grid; grid-template-columns: 20mm 2mm minmax(0, 1fr); gap: 1.5mm; color: var(--premium-text); font-size: 8.1pt; line-height: 1.2; }
    .premium-bank-details span { color: var(--premium-muted); font-weight: 800; }
    .premium-bank-details em { overflow-wrap: anywhere; font-style: normal; font-weight: 800; }
    .premium-bank-details p { margin: 1.5mm 0 0; color: var(--premium-text); font-size: 8pt; font-weight: 700; line-height: 1.3; white-space: pre-line; }
    .premium-upi-block { display: grid; grid-template-columns: 18mm minmax(0, 1fr); gap: 3mm; align-items: center; }
    .premium-upi-block img, .premium-upi-block > svg { width: 18mm; height: 18mm; padding: 1.4mm; border: 1px solid var(--premium-accent-border); border-radius: 1.6mm; color: var(--premium-brand-black); object-fit: contain; }
    .premium-upi-block span, .premium-upi-block small { display: block; overflow-wrap: anywhere; }
    .premium-upi-block span { color: var(--premium-muted); font-size: 8pt; font-weight: 800; }
    .premium-upi-block small { color: var(--premium-text); font-size: 8pt; font-weight: 800; }
    .premium-signature { display: grid; justify-items: center; gap: 2mm; padding-left: 6mm; border-left: 1px solid var(--premium-border); }
    .premium-footer-main-single .premium-signature { justify-self: end; padding-left: 0; border-left: 0; }
    .premium-signature img { max-width: 42mm; max-height: 13mm; object-fit: contain; }
    .premium-signature svg { color: var(--premium-brand-black); }
    .premium-signature span { width: 48mm; padding-top: 2mm; border-top: 1px solid var(--premium-brand-black); color: var(--premium-brand-black); font-size: 8.5pt; text-align: center; }
    .premium-contact-strip { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 2.2mm 8mm; min-height: 11mm; margin: 0 -9mm; padding: 1.8mm 9mm; background: var(--premium-brand-black); border-top: 1.1mm solid var(--invoice-accent); color: #ffffff; font-size: 8.4pt; font-weight: 700; line-height: 1.18; }
    .premium-contact-strip span { display: inline-flex; align-items: center; gap: 3mm; min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
    svg { display: inline-block; vertical-align: middle; }
  `;
}

function paginateInvoiceItems(invoice: InvoiceDetail, paperSize: PaperSize, settings: BusinessSettings): InvoicePageChunk[] {
  const baseProfile = paginationProfiles[paperSize] || paginationProfiles.A4;
  const finalPenalty = estimateFinalSummaryPenalty(invoice, settings);
  const profile = {
    ...baseProfile,
    single: Math.max(5, baseProfile.single - finalPenalty),
    final: Math.max(5, baseProfile.final - finalPenalty)
  };
  const items = invoice.items || [];
  if (items.length === 0 || itemUnits(items) <= profile.single) {
    return [{ items, startIndex: 0, showParties: true, showFinalSummary: true }];
  }
  const pages: InvoicePageChunk[] = [];
  let startIndex = 0;
  const firstEnd = takeInvoiceChunk(items, startIndex, profile.first);
  pages.push({ items: items.slice(startIndex, firstEnd), startIndex, showParties: true, showFinalSummary: false });
  startIndex = firstEnd;
  while (startIndex < items.length) {
    if (itemUnits(items.slice(startIndex)) <= profile.final) {
      pages.push({ items: items.slice(startIndex), startIndex, showParties: false, showFinalSummary: true });
      return pages;
    }
    const finalStart = findFinalChunkStart(items, startIndex, profile.final);
    let endIndex = takeInvoiceChunk(items, startIndex, profile.middle);
    if (finalStart > startIndex) endIndex = Math.min(endIndex, finalStart);
    if (endIndex <= startIndex) endIndex = Math.min(items.length, startIndex + 1);
    pages.push({ items: items.slice(startIndex, endIndex), startIndex, showParties: false, showFinalSummary: false });
    startIndex = endIndex;
  }
  pages.push({ items: [], startIndex: items.length, showParties: false, showItemsTable: false, showFinalSummary: true });
  return pages;
}

function estimateInvoiceItemUnits(item: InvoiceItem) {
  return Math.max(1, Math.ceil((item.description?.length || 1) / 42));
}

function itemUnits(items: InvoiceItem[]) {
  return items.reduce((sum, item) => sum + estimateInvoiceItemUnits(item), 0);
}

function estimateFinalSummaryPenalty(invoice: InvoiceDetail, settings: BusinessSettings) {
  const paymentLength = enabled(settings.showPaymentDetails) || enabled(settings.showUpiQr)
    ? `${settings.bankName || ""} ${settings.bankAccountName || ""} ${settings.bankAccountNumber || ""} ${settings.bankIfsc || ""} ${settings.upiId || ""}`.length
    : 0;
  const textLength = `${invoice.notes || ""} ${settings.invoiceTerms || ""} ${settings.invoiceFooterNote || ""}`.length + paymentLength;
  return Math.min(9, Math.ceil(textLength / 180));
}

function takeInvoiceChunk(items: InvoiceItem[], startIndex: number, budget: number) {
  let used = 0;
  let endIndex = startIndex;
  while (endIndex < items.length) {
    const nextUnits = estimateInvoiceItemUnits(items[endIndex]);
    if (endIndex > startIndex && used + nextUnits > budget) break;
    used += nextUnits;
    endIndex += 1;
  }
  return Math.max(startIndex + 1, endIndex);
}

function findFinalChunkStart(items: InvoiceItem[], startIndex: number, budget: number) {
  let used = 0;
  let finalStart = items.length;
  for (let index = items.length - 1; index >= startIndex; index -= 1) {
    const nextUnits = estimateInvoiceItemUnits(items[index]);
    if (used + nextUnits > budget) break;
    used += nextUnits;
    finalStart = index;
  }
  return finalStart;
}

async function invoicePdfUri(fileName: string) {
  const directory = await invoicePdfDirectory();
  return `${directory}${fileName}`;
}

async function invoicePdfDirectory() {
  const baseDirectory = FileSystem.documentDirectory || FileSystem.cacheDirectory;
  if (!baseDirectory) throw new Error("File storage is not available on this phone.");
  const directory = `${baseDirectory}Autocare24/Invoice-PDFs/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  return directory;
}

function invoicePdfFileName(invoice: InvoiceDetail) {
  return `${fileNamePart(invoice.invoiceNumber, "invoice")}-${fileNamePart(customerName(invoice), "customer")}.pdf`;
}

function fileNamePart(value: string | undefined | null, fallback: string) {
  const safe = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 44);
  return safe || fallback;
}

function customerName(invoice: InvoiceDetail) {
  return invoice.customer?.name || invoice.customerName || "";
}

function customerPhone(invoice: InvoiceDetail) {
  return invoice.customer?.phone || invoice.customerPhone || "";
}

function vehicleNumber(invoice: InvoiceDetail) {
  return invoice.vehicle?.registrationNumber || invoice.vehicleNumber || "";
}

function vehicleTypeLabel(type?: string) {
  return type === "bike" ? "Bike" : type === "other" ? "Other" : "Car";
}

function formatInvoiceDate(date: string) {
  if (!date) return "";
  const parsed = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatInvoiceMoney(value: number | undefined | null) {
  return `${rupeeSymbol} ${money(Number(value || 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shareMoney(value: number | undefined | null) {
  return `Rs ${money(Number(value || 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function money(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function statusLabel(status: string | undefined) {
  return String(status || "")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Unpaid";
}

function compactText(value?: string) {
  return value?.trim() || "";
}

function enabled(value: boolean | undefined) {
  return value !== false;
}

function safeColor(value: string | undefined, fallback: string) {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function cloudFileId(filePath: string | undefined) {
  const text = String(filePath || "");
  return text.startsWith("cloud:") ? text.slice("cloud:".length) : "";
}

async function buildUpiQrDataUrl(settings: BusinessSettings, invoice: InvoiceDetail) {
  const upiId = compactText(settings.upiId);
  if (!upiId || !enabled(settings.showUpiQr)) return "";
  try {
    const params = new URLSearchParams({
      pa: upiId,
      pn: compactText(settings.businessName) || "Autocare24",
      cu: "INR",
      tn: invoice.invoiceNumber || ""
    });
    return await QRCode.toDataURL(`upi://pay?${params.toString()}`, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 180,
      color: { dark: AUTOCAR24_INVOICE_BLACK, light: "#ffffff" }
    });
  } catch {
    return "";
  }
}

function svgIcon(name: string, size: number) {
  const common = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  const paths: Record<string, string> = {
    "map-pin": `<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>`,
    phone: `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.35 1.89.66 2.78a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.3-1.23a2 2 0 0 1 2.11-.45c.89.31 1.82.53 2.78.66A2 2 0 0 1 22 16.92Z"/>`,
    mail: `<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-10 7L2 7"/>`,
    "file-text": `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>`,
    car: `<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18.4 6c-.3-.6-.9-1-1.6-1H7.2c-.7 0-1.3.4-1.6 1l-2.1 5.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>`,
    "credit-card": `<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>`,
    "calendar-days": `<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>`,
    user: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
    "clipboard-list": `<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>`,
    wallet: `<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3v4a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5"/><path d="M18 12h.01"/>`,
    "pen-line": `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
    "qr-code": `<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>`
  };
  return `<svg ${common}>${paths[name] || paths["file-text"]}</svg>`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
