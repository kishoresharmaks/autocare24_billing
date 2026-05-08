export function formatMoney(value: number | undefined | null): string {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `Rs. ${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

export function formatCount(value: number | undefined | null): string {
  return String(Number.isFinite(Number(value)) ? Number(value) : 0);
}

export function formatDateTime(value: string | undefined | null): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatDate(value: string | undefined | null): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

export function titleCase(value: string | undefined | null): string {
  return String(value || "")
    .replace(/[_-]/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Not available";
}

export function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
