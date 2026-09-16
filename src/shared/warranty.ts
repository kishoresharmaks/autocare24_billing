export const MAX_WARRANTY_MONTHS = 240;

const clampWarrantyMonths = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_WARRANTY_MONTHS, Math.max(1, Math.round(value)));
};

export const parseWarrantyDurationMonths = (value: unknown): number => {
  if (typeof value === "number") return clampWarrantyMonths(value);
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return 0;

  const compact = text.replace(/\s+/g, "");
  const match = /^(\d+(?:\.\d+)?)(y|yr|yrs|year|years|m|mo|mos|month|months)?$/.exec(compact);
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2] || "m";
    return clampWarrantyMonths(unit.startsWith("y") ? amount * 12 : amount);
  }

  const years = /(\d+(?:\.\d+)?)\s*(?:y|yr|yrs|year|years)\b/.exec(text);
  if (years) return clampWarrantyMonths(Number(years[1]) * 12);

  const months = /(\d+(?:\.\d+)?)\s*(?:m|mo|mos|month|months)\b/.exec(text);
  if (months) return clampWarrantyMonths(Number(months[1]));

  return 0;
};

export const warrantyDurationCode = (months: number) => {
  const value = parseWarrantyDurationMonths(months);
  if (!value) return "";
  return value % 12 === 0 ? `${value / 12}y` : `${value}m`;
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

export const normalizeDateOnly = (value: unknown) => {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
};

export const addMonthsToDate = (date: unknown, months: unknown) => {
  const startDate = normalizeDateOnly(date);
  const durationMonths = parseWarrantyDurationMonths(months);
  if (!startDate || !durationMonths) return "";

  const [year, month, day] = startDate.split("-").map(Number);
  if (!year || !month || !day) return "";

  const lastDayOfTargetMonth = new Date(year, month - 1 + durationMonths + 1, 0).getDate();
  const normalized = new Date(year, month - 1 + durationMonths, Math.min(day, lastDayOfTargetMonth));
  const local = new Date(normalized.getTime() - normalized.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export const warrantyStatus = (endDate: unknown, today = new Date()) => {
  const date = normalizeDateOnly(endDate);
  if (!date) return "none";
  const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (date < localToday) return "expired";

  const diffMs = new Date(`${date}T00:00:00`).getTime() - new Date(`${localToday}T00:00:00`).getTime();
  const days = Math.ceil(diffMs / 86_400_000);
  return days <= 30 ? "expiring" : "active";
};
