const MAX_WARRANTY_MONTHS = 240;

export const parseWarrantyDurationMonths = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(MAX_WARRANTY_MONTHS, Math.max(0, Math.round(value)));
  }
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return 0;
  const match = /^(\d+(?:\.\d+)?)\s*(y|yr|yrs|year|years|m|mo|mos|month|months)?$/.exec(text);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const unit = match[2] || "m";
  const months = unit.startsWith("y") ? amount * 12 : amount;
  return Math.min(MAX_WARRANTY_MONTHS, Math.max(0, Math.round(months)));
};

export const warrantyDurationLabel = (months: number) => {
  const value = parseWarrantyDurationMonths(months);
  if (!value) return "";
  if (value % 12 === 0) {
    const years = value / 12;
    return `${years} ${years === 1 ? "year" : "years"}`;
  }
  return `${value} ${value === 1 ? "month" : "months"}`;
};

export const normalizeWarrantyText = (text: unknown, months: number) => {
  const value = String(text ?? "").trim().slice(0, 180);
  return value || warrantyDurationLabel(months);
};

export const formatWarrantyLine = (item: { warrantyIncluded?: boolean; warrantyDurationMonths?: number; warrantyText?: string; warrantyEndDate?: string }) => {
  if (!item.warrantyIncluded) return "";
  const duration = warrantyDurationLabel(item.warrantyDurationMonths || 0);
  const label = item.warrantyText?.trim() || duration;
  if (!label) return "";
  return `${label}${item.warrantyEndDate ? `, valid until ${item.warrantyEndDate}` : ""}`;
};
