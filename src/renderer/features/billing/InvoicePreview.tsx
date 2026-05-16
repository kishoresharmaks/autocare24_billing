import { CalendarDays, Car, ClipboardList, CreditCard, FileText, Mail, MapPin, PenLine, Phone, QrCode, User, Wallet, type LucideIcon } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { BusinessSettings, InvoiceDetail, InvoiceItem, InvoicePaperSize, VehicleType } from "../../../shared/types";

type BillingDocumentKind = "invoice" | "quotation";

const AUTOCAR24_INVOICE_ACCENT = "#d71920";
const AUTOCAR24_INVOICE_BLACK = "#111111";
const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const rupeeSymbol = "\u20B9";
const formatInvoiceMoney = (value: number) =>
  `${rupeeSymbol} ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatInvoiceDate = (date: string) => {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const compactText = (value?: string) => value?.trim() || "";
const settingEnabled = (value?: boolean) => value !== false;
const invoiceLabel = (value: string | undefined, fallback: string) => compactText(value) || fallback;
const statusLabel = (status: string) =>
  status
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const vehicleTypeLabel = (type?: VehicleType | string) => (type === "bike" ? "Bike" : type === "other" ? "Other" : "Car");

type InvoicePageChunk = {
  items: InvoiceItem[];
  startIndex: number;
  showParties: boolean;
  showItemsTable?: boolean;
  showFinalSummary: boolean;
};

const paginationProfiles: Record<InvoicePaperSize, { single: number; first: number; middle: number; final: number }> = {
  A4: { single: 8, first: 15, middle: 26, final: 12 },
  Letter: { single: 7, first: 14, middle: 24, final: 10 },
  Legal: { single: 14, first: 24, middle: 38, final: 18 }
};

const estimateInvoiceItemUnits = (item: InvoiceItem) => Math.max(1, Math.ceil((item.description.length || 1) / 42));

const itemUnits = (items: InvoiceItem[]) => items.reduce((sum, item) => sum + estimateInvoiceItemUnits(item), 0);

const estimateFinalSummaryPenalty = (invoice: InvoiceDetail, settings: BusinessSettings) => {
  const paymentLength = settingEnabled(settings.showPaymentDetails) || settingEnabled(settings.showUpiQr)
    ? `${settings.bankName || ""} ${settings.bankAccountName || ""} ${settings.bankAccountNumber || ""} ${settings.bankIfsc || ""} ${settings.upiId || ""}`.length
    : 0;
  const textLength = `${invoice.notes || ""} ${settings.invoiceTerms || ""} ${settings.invoiceFooterNote || ""}`.length + paymentLength;
  return Math.min(9, Math.ceil(textLength / 180));
};

const takeInvoiceChunk = (items: InvoiceItem[], startIndex: number, budget: number) => {
  let used = 0;
  let endIndex = startIndex;
  while (endIndex < items.length) {
    const item = items[endIndex];
    if (!item) break;
    const nextUnits = estimateInvoiceItemUnits(item);
    if (endIndex > startIndex && used + nextUnits > budget) break;
    used += nextUnits;
    endIndex += 1;
  }
  return Math.max(startIndex + 1, endIndex);
};

const findFinalChunkStart = (items: InvoiceItem[], startIndex: number, budget: number) => {
  let used = 0;
  let finalStart = items.length;
  for (let index = items.length - 1; index >= startIndex; index -= 1) {
    const item = items[index];
    if (!item) break;
    const nextUnits = estimateInvoiceItemUnits(item);
    if (used + nextUnits > budget) break;
    used += nextUnits;
    finalStart = index;
  }
  return finalStart;
};

const paginateInvoiceItems = (invoice: InvoiceDetail, paperSize: InvoicePaperSize, settings: BusinessSettings): InvoicePageChunk[] => {
  const baseProfile = paginationProfiles[paperSize] || paginationProfiles.A4;
  const finalPenalty = estimateFinalSummaryPenalty(invoice, settings);
  const profile = {
    ...baseProfile,
    single: Math.max(5, baseProfile.single - finalPenalty),
    final: Math.max(5, baseProfile.final - finalPenalty)
  };
  if (invoice.items.length === 0 || itemUnits(invoice.items) <= profile.single) {
    return [{ items: invoice.items, startIndex: 0, showParties: true, showFinalSummary: true }];
  }

  const pages: InvoicePageChunk[] = [];
  let startIndex = 0;
  const firstEnd = takeInvoiceChunk(invoice.items, startIndex, profile.first);
  pages.push({ items: invoice.items.slice(startIndex, firstEnd), startIndex, showParties: true, showFinalSummary: false });
  startIndex = firstEnd;

  while (startIndex < invoice.items.length) {
    if (itemUnits(invoice.items.slice(startIndex)) <= profile.final) {
      pages.push({ items: invoice.items.slice(startIndex), startIndex, showParties: false, showFinalSummary: true });
      return pages;
    }
    const finalStart = findFinalChunkStart(invoice.items, startIndex, profile.final);
    let endIndex = takeInvoiceChunk(invoice.items, startIndex, profile.middle);
    if (finalStart > startIndex) endIndex = Math.min(endIndex, finalStart);
    if (endIndex <= startIndex) endIndex = Math.min(invoice.items.length, startIndex + 1);
    pages.push({ items: invoice.items.slice(startIndex, endIndex), startIndex, showParties: false, showFinalSummary: false });
    startIndex = endIndex;
  }

  pages.push({ items: [], startIndex: invoice.items.length, showParties: false, showItemsTable: false, showFinalSummary: true });

  return pages;
};

const buildUpiQrPayload = (settings: BusinessSettings, invoice: InvoiceDetail, documentKind: BillingDocumentKind) => {
  if (documentKind === "quotation") return "";
  const upiId = compactText(settings.upiId);
  if (!upiId) return "";
  const params = new URLSearchParams({
    pa: upiId,
    pn: compactText(settings.businessName) || "Autocare24",
    cu: "INR",
    tn: invoice.invoiceNumber
  });
  return `upi://pay?${params.toString()}`;
};

function useInvoiceAsset(filePath: string | undefined, enabled = true) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let active = true;
    setSrc("");
    if (!enabled || !filePath) return () => {
      active = false;
    };

    window.autocare
      .readInvoiceAsset(filePath)
      .then((result) => {
        if (active && result.ok && result.dataUrl) setSrc(result.dataUrl);
      })
      .catch(() => {
        if (active) setSrc("");
      });

    return () => {
      active = false;
    };
  }, [enabled, filePath]);

  return src;
}

function useQrDataUrl(payload: string, accent: string) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let active = true;
    setSrc("");
    if (!payload) return () => {
      active = false;
    };

    QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 180,
      color: { dark: accent, light: "#ffffff" }
    })
      .then((dataUrl) => {
        if (active) setSrc(dataUrl);
      })
      .catch(() => {
        if (active) setSrc("");
      });

    return () => {
      active = false;
    };
  }, [payload, accent]);

  return src;
}

export function InvoicePreview({
  settings,
  invoice,
  documentKind = "invoice"
}: {
  settings: BusinessSettings;
  invoice: InvoiceDetail;
  documentKind?: BillingDocumentKind;
}) {
  return <PremiumInvoiceDocument settings={settings} invoice={invoice} documentKind={documentKind} />;
}

function PremiumInvoiceDocument({ settings, invoice, documentKind }: { settings: BusinessSettings; invoice: InvoiceDetail; documentKind: BillingDocumentKind }) {
  const paperSize = settings.invoicePaperSize || "A4";
  const accent = settings.invoiceAccentColor || AUTOCAR24_INVOICE_ACCENT;
  const secondary = settings.invoiceSecondaryColor || AUTOCAR24_INVOICE_BLACK;
  const fontStyle = settings.invoiceFontStyle || "modern";
  const textSize = settings.invoiceTextSize || "standard";
  const density = settings.invoiceDensity || "standard";
  const logoSize = settings.invoiceLogoSize || "medium";
  const watermarkPlacement = settings.invoiceWatermarkPlacement || "bottom-right";
  const watermarkOpacity = Number.isFinite(settings.invoiceWatermarkOpacity) ? settings.invoiceWatermarkOpacity : 0.12;
  const logoSrc = useInvoiceAsset(settings.invoiceLogoPath, settingEnabled(settings.showLogo));
  const signatureSrc = useInvoiceAsset(settings.invoiceSignaturePath, settingEnabled(settings.showSignature));
  const watermarkSrc = useInvoiceAsset(settings.invoiceWatermarkPath, Boolean(settings.invoiceWatermarkPath));
  const qrPayload = buildUpiQrPayload(settings, invoice, documentKind);
  const qrSrc = useQrDataUrl(qrPayload, AUTOCAR24_INVOICE_BLACK);
  const pages = useMemo(() => paginateInvoiceItems(invoice, paperSize, settings), [invoice, paperSize, settings]);
  const title = documentKind === "quotation"
    ? invoiceLabel(settings.quotationTitle, "Quotation")
    : invoice.invoiceMode === "gst" ? settings.gstInvoiceTitle  : settings.simpleReceiptTitle ;

  return (
    <article
      className={`premium-invoice-document premium-${documentKind}-document premium-paper-${paperSize.toLowerCase()} premium-font-${fontStyle} premium-text-${textSize} premium-density-${density} premium-logo-${logoSize} premium-watermark-${watermarkPlacement}`}
      style={{
        "--invoice-accent": accent,
        "--premium-brand-black": secondary,
        "--premium-watermark-opacity": String(watermarkOpacity)
      } as CSSProperties}
    >
      {pages.map((page, pageIndex) => (
        <PremiumInvoicePage
          key={`${invoice.id}-${pageIndex}`}
          invoice={invoice}
          settings={settings}
          title={title}
          documentKind={documentKind}
          chunk={page}
          pageIndex={pageIndex}
          pageCount={pages.length}
          logoSrc={logoSrc}
          signatureSrc={signatureSrc}
          watermarkSrc={watermarkSrc}
          qrSrc={qrSrc}
        />
      ))}
    </article>
  );
}

function PremiumInvoicePage({
  invoice,
  settings,
  title,
  documentKind,
  chunk,
  pageIndex,
  pageCount,
  logoSrc,
  signatureSrc,
  watermarkSrc,
  qrSrc
}: {
  invoice: InvoiceDetail;
  settings: BusinessSettings;
  title: string;
  documentKind: BillingDocumentKind;
  chunk: InvoicePageChunk;
  pageIndex: number;
  pageCount: number;
  logoSrc: string;
  signatureSrc: string;
  watermarkSrc: string;
  qrSrc: string;
}) {
  return (
    <section className="premium-invoice-page">
      <PremiumInvoiceHeader
        invoice={invoice}
        settings={settings}
        title={title}
        documentKind={documentKind}
        logoSrc={logoSrc}
        pageNumber={pageIndex + 1}
        pageCount={pageCount}
      />

      <main className="premium-invoice-body">
        {chunk.showParties && <PremiumPartyCards invoice={invoice} settings={settings} />}
        {!chunk.showParties && (
          <div className="premium-continuation">
            <strong>Service / item details continued</strong>
            <span>{invoice.invoiceNumber}</span>
          </div>
        )}
        {chunk.showItemsTable !== false && <PremiumItemsTable invoice={invoice} settings={settings} items={chunk.items} startIndex={chunk.startIndex} />}
        {chunk.showFinalSummary && (
          <PremiumFinalSummary invoice={invoice} settings={settings} documentKind={documentKind} watermarkSrc={watermarkSrc} />
        )}
      </main>

      <PremiumInvoiceFooter settings={settings} invoice={invoice} documentKind={documentKind} qrSrc={qrSrc} signatureSrc={signatureSrc} />
    </section>
  );
}

function PremiumInvoiceHeader({
  invoice,
  settings,
  title,
  documentKind,
  logoSrc,
  pageNumber,
  pageCount
}: {
  invoice: InvoiceDetail;
  settings: BusinessSettings;
  title: string;
  documentKind: BillingDocumentKind;
  logoSrc: string;
  pageNumber: number;
  pageCount: number;
}) {
  return (
    <header className={`premium-invoice-header ${settingEnabled(settings.showLogo) ? "" : "premium-no-logo"}`}>
      <div className="premium-logo-panel">
        {settingEnabled(settings.showLogo) && (
          logoSrc ? (
            <img src={logoSrc} alt="" />
          ) : (
            <div className="premium-logo-fallback">
              <strong>AUTOCARE<span>24</span></strong>
              <small>DETAILING STUDIO</small>
            </div>
          )
        )}
      </div>

      <div className="premium-business-panel">
        <h2>{settings.businessName || "Autocare24 Detailing Studio"}</h2>
        {settingEnabled(settings.showBusinessAddress) && <PremiumInfoLine icon={MapPin} text={settings.address || "Business address not configured"} />}
        {settingEnabled(settings.showBusinessPhone) && settings.phone && <PremiumInfoLine icon={Phone} text={settings.phone} />}
        {settingEnabled(settings.showBusinessEmail) && settings.email && <PremiumInfoLine icon={Mail} text={settings.email} />}
        {settingEnabled(settings.showGstin) && settings.gstin && <PremiumInfoLine icon={FileText} text={`GSTIN: ${settings.gstin}`} />}
      </div>

      <div className="premium-meta-panel">
        <h1>{title.toUpperCase()}</h1>
        <PremiumMetaRow
          label={documentKind === "quotation" ? invoiceLabel(settings.quotationNumberLabel, "Quotation No.") : invoiceLabel(settings.invoiceNumberLabel, "Invoice No.")}
          value={invoice.invoiceNumber}
        />
        <PremiumMetaRow
          label={documentKind === "quotation" ? invoiceLabel(settings.quotationDateLabel, "Date") : invoiceLabel(settings.invoiceDateLabel, "Date")}
          value={formatInvoiceDate(invoice.invoiceDate)}
        />
        {documentKind !== "quotation" && settingEnabled(settings.showInvoiceStatus) && (
          <PremiumMetaRow
            label="Status"
            value={
              <span className={`premium-status premium-status-${invoice.invoiceStatus === "cancelled" ? "unpaid" : invoice.paymentStatus}`}>
                {invoice.invoiceStatus === "cancelled" ? "Cancelled" : statusLabel(invoice.paymentStatus)}
              </span>
            }
          />
        )}
        {documentKind !== "quotation" && settingEnabled(settings.showPaymentMode) && <PremiumMetaRow label="Payment Mode" value={invoice.paymentMode} />}
        <PremiumMetaRow label="Page" value={`${pageNumber} of ${pageCount}`} />
      </div>
    </header>
  );
}

function PremiumInfoLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="premium-info-line">
      <Icon size={16} />
      <span>{text}</span>
    </div>
  );
}

function PremiumMetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="premium-meta-row">
      <span>{label}</span>
      <b>:</b>
      <strong>{value}</strong>
    </div>
  );
}

function PremiumPartyCards({ invoice, settings }: { invoice: InvoiceDetail; settings: BusinessSettings }) {
  const vehicleDetails = [
    { icon: Car, label: "Type", value: vehicleTypeLabel(invoice.vehicle.vehicleType) },
    { icon: CreditCard, label: "Registration No.", value: invoice.vehicle.registrationNumber },
    { icon: CalendarDays, label: "Make / Model", value: [invoice.vehicle.make, invoice.vehicle.model].filter(Boolean).join(" ") },
    { icon: FileText, label: "Color", value: invoice.vehicle.color }
  ].filter((item) => item.value);

  return (
    <section className="premium-party-grid">
      <div className="premium-detail-card">
        <div className="premium-card-title"><span><User size={18} /></span> {invoiceLabel(settings.billToLabel, "Bill To")}</div>
        <strong>{invoice.customer.name}</strong>
        {settingEnabled(settings.showCustomerPhone) && invoice.customer.phone && <PremiumInfoLine icon={Phone} text={invoice.customer.phone} />}
        {settingEnabled(settings.showCustomerAddress) && invoice.customer.address && <PremiumInfoLine icon={MapPin} text={invoice.customer.address} />}
        {settingEnabled(settings.showGstin) && settingEnabled(settings.showCustomerGstin) && invoice.customer.gstin && <PremiumInfoLine icon={FileText} text={`GSTIN: ${invoice.customer.gstin}`} />}
      </div>

      {settingEnabled(settings.showVehicleDetails) && (
        <div className="premium-detail-card">
          <div className="premium-card-title"><span><Car size={18} /></span> {invoiceLabel(settings.vehicleDetailsLabel, "Vehicle Details")}</div>
          {vehicleDetails.map(({ icon: Icon, label, value }) => (
            <div className="premium-detail-row" key={label}>
              <Icon size={14} />
              <span>{label}</span>
              <b>:</b>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PremiumItemsTable({ invoice, settings, items, startIndex }: { invoice: InvoiceDetail; settings: BusinessSettings; items: InvoiceItem[]; startIndex: number }) {
  const gstMode = invoice.invoiceMode === "gst";
  const showItemGstRate = gstMode && settingEnabled(settings.showItemGstRate);
  const showSacCode = gstMode && settingEnabled(settings.showSacCode);
  const columnCount = 5 + (showItemGstRate ? 1 : 0) + (showSacCode ? 1 : 0);
  return (
    <table className={`premium-items-table ${gstMode ? "premium-gst-table" : "premium-simple-table"}`}>
      <colgroup>
        <col className="premium-col-index" />
        <col className="premium-col-description" />
        <col className="premium-col-qty" />
        <col className="premium-col-rate" />
        {showItemGstRate && <col className="premium-col-gst" />}
        {showSacCode && <col className="premium-col-sac" />}
        <col className="premium-col-amount" />
      </colgroup>
      <thead>
        <tr>
          <th>#</th>
          <th>Service / Item</th>
          <th>Qty</th>
          <th>Rate ({rupeeSymbol})</th>
          {showItemGstRate && <th>GST</th>}
          {showSacCode && <th>SAC</th>}
          <th>Amount ({rupeeSymbol})</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, index) => (
          <tr key={item.id}>
            <td>{startIndex + index + 1}</td>
            <td>{item.description}</td>
            <td>{item.quantity}</td>
            <td>{money(item.unitPrice).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            {showItemGstRate && <td>{item.gstRate}%</td>}
            {showSacCode && <td>{item.sacCode}</td>}
            <td>{money(item.lineTotal).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={columnCount}>Total Items: {invoice.items.length}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function PremiumFinalSummary({ invoice, settings, documentKind, watermarkSrc }: { invoice: InvoiceDetail; settings: BusinessSettings; documentKind: BillingDocumentKind; watermarkSrc: string }) {
  const cgstRate = invoice.taxableValue > 0 ? money((invoice.cgst / invoice.taxableValue) * 100) : 0;
  const sgstRate = invoice.taxableValue > 0 ? money((invoice.sgst / invoice.taxableValue) * 100) : 0;
  const igstRate = invoice.taxableValue > 0 ? money((invoice.igst / invoice.taxableValue) * 100) : 0;

  return (
    <section className="premium-final-grid">
      <div className="premium-notes-card">
        <div className="premium-card-title"><span><FileText size={18} /></span> Notes</div>
        <p>{invoice.notes || settings.invoiceFooterNote || "Thank you for choosing Autocare24."}</p>
        {settingEnabled(settings.showTerms) && settings.invoiceTerms && (
          <>
            <div className="premium-divider" />
            <div className="premium-card-title"><span><ClipboardList size={18} /></span> {invoiceLabel(settings.termsLabel, "Terms & Conditions")}</div>
            <p>{settings.invoiceTerms}</p>
          </>
        )}
        <PremiumWatermark src={watermarkSrc} />
      </div>

      <div className="premium-total-card">
        <PremiumTotalRow label={invoiceLabel(settings.subtotalLabel, "Subtotal")} value={formatInvoiceMoney(invoice.subTotal)} />
        <PremiumTotalRow label="Discount" value={formatInvoiceMoney(invoice.discount)} />
        {invoice.invoiceMode === "gst" && <PremiumTotalRow label="Taxable Value" value={formatInvoiceMoney(invoice.taxableValue)} separated />}
        {invoice.cgst > 0 && <PremiumTotalRow label={`CGST (${cgstRate}%)`} value={formatInvoiceMoney(invoice.cgst)} />}
        {invoice.sgst > 0 && <PremiumTotalRow label={`SGST (${sgstRate}%)`} value={formatInvoiceMoney(invoice.sgst)} />}
        {invoice.igst > 0 && <PremiumTotalRow label={`IGST (${igstRate}%)`} value={formatInvoiceMoney(invoice.igst)} />}
        <div className="premium-grand-row">
          <span>{invoiceLabel(settings.grandTotalLabel, "Grand Total")}</span>
          <strong>{formatInvoiceMoney(invoice.grandTotal)}</strong>
        </div>
        {documentKind !== "quotation" && settingEnabled(settings.showPaidAmount) && <PremiumTotalRow label={invoiceLabel(settings.paidLabel, "Paid")} value={formatInvoiceMoney(invoice.paidAmount)} />}
        {documentKind !== "quotation" && settingEnabled(settings.showBalanceDue) && (
          <div className="premium-balance-row">
            <span>{invoiceLabel(settings.balanceDueLabel, "Balance Due")}</span>
            <strong>{formatInvoiceMoney(invoice.balanceDue)}</strong>
          </div>
        )}
      </div>
    </section>
  );
}

function PremiumWatermark({ src }: { src: string }) {
  if (src) return <img className="premium-watermark-image" src={src} alt="" />;
  return (
    <svg className="premium-watermark-svg" viewBox="0 0 260 110" aria-hidden="true">
      <path d="M42 72h162c8 0 14-6 14-14v-7c0-9-6-16-15-18l-35-7c-11-13-27-20-44-20H86c-17 0-31 8-40 22L27 34c-11 4-18 14-18 26v7c0 3 2 5 5 5h18" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="66" cy="74" r="16" fill="none" stroke="currentColor" strokeWidth="5" />
      <circle cx="181" cy="74" r="16" fill="none" stroke="currentColor" strokeWidth="5" />
      <path d="M83 28h36m16 0h28M68 51h114" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function PremiumTotalRow({ label, value, separated }: { label: string; value: string; separated?: boolean }) {
  return (
    <div className={`premium-total-row ${separated ? "separated" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PremiumInvoiceFooter({
  settings,
  invoice,
  documentKind,
  qrSrc,
  signatureSrc
}: {
  settings: BusinessSettings;
  invoice: InvoiceDetail;
  documentKind: BillingDocumentKind;
  qrSrc: string;
  signatureSrc: string;
}) {
  const address = settings.address || "Business address not configured";
  const bankRows = [
    { label: "Bank", value: compactText(settings.bankName) },
    { label: "A/C Name", value: compactText(settings.bankAccountName) },
    { label: "A/C No.", value: compactText(settings.bankAccountNumber) },
    { label: "IFSC", value: compactText(settings.bankIfsc) }
  ].filter((row) => row.value);
  const upiId = compactText(settings.upiId);
  const paymentInstructions = compactText(settings.paymentInstructions);
  const canShowPayment = documentKind !== "quotation";
  const showUpiBlock = canShowPayment && Boolean(upiId) && settingEnabled(settings.showUpiQr);
  const showBankPaymentBlock = canShowPayment && settingEnabled(settings.showPaymentDetails) && (bankRows.length > 0 || Boolean(paymentInstructions));
  const showPaymentBlock = showBankPaymentBlock || showUpiBlock;
  const showFooterMain = showPaymentBlock || settingEnabled(settings.showSignature);
  const footerMainClass = showPaymentBlock && settingEnabled(settings.showSignature) ? "premium-footer-main" : "premium-footer-main premium-footer-main-single";
  const contactItems = [
    settingEnabled(settings.showBusinessPhone) && settings.phone ? { id: "phone", icon: Phone, text: settings.phone } : null,
    settingEnabled(settings.showBusinessEmail) && settings.email ? { id: "email", icon: Mail, text: settings.email } : null,
    settingEnabled(settings.showBusinessAddress) ? { id: "address", icon: MapPin, text: address } : null
  ].filter((item): item is { id: string; icon: LucideIcon; text: string } => Boolean(item));

  return (
    <footer className="premium-invoice-footer">
      {showFooterMain && (
        <div className={footerMainClass}>
          {showPaymentBlock && (
            <div className={`premium-payment-details ${showBankPaymentBlock && showUpiBlock ? "" : "premium-payment-single"}`}>
              {showBankPaymentBlock && (
                <div className="premium-bank-details">
                  <strong>{invoiceLabel(bankRows.length ? settings.bankDetailsLabel : settings.paymentDetailsLabel, bankRows.length ? "Bank Details" : "Payment Details")}</strong>
                  {bankRows.map((row) => (
                    <div key={row.label}>
                      <span>{row.label}</span>
                      <b>:</b>
                      <em>{row.value}</em>
                    </div>
                  ))}
                  {paymentInstructions && <p>{paymentInstructions}</p>}
                </div>
              )}

              {showUpiBlock && (
                <div className="premium-upi-block">
                  {qrSrc ? <img src={qrSrc} alt="" /> : <QrCode size={58} />}
                  <div>
                    <strong>Scan to Pay</strong>
                    <span>UPI ID</span>
                    <small>{upiId}</small>
                  </div>
                </div>
              )}
            </div>
          )}

          {settingEnabled(settings.showSignature) && (
            <div className="premium-signature">
              {signatureSrc ? <img src={signatureSrc} alt="" /> : <PenLine size={56} />}
              <span>{settings.signatureLabel || "Authorized Signatory"}</span>
            </div>
          )}
        </div>
      )}

      {settingEnabled(settings.showFooterContactBar) && (
        <div className="premium-contact-strip">
          {contactItems.map(({ id, icon: Icon, text }) => <span key={id}><Icon size={15} /> {text}</span>)}
          {!contactItems.length && settingEnabled(settings.showPaymentMode) && <span><Wallet size={15} /> Payment mode: {invoice.paymentMode}</span>}
        </div>
      )}
    </footer>
  );
}
