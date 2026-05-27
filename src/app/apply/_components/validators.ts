export type FieldValidator = (value: unknown) => string | null

export const validators: Record<string, FieldValidator> = {
  email: (v) =>
    !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))
      ? null
      : "Enter a valid email address",
  phone: (v) =>
    !v || String(v).replace(/\D/g, "").length >= 10
      ? null
      : "Enter a 10-digit phone number",
  ssn: (v) =>
    !v || /^\d{3}-\d{2}-\d{4}$/.test(String(v))
      ? null
      : "Enter a 9-digit SSN",
  currency: (v) =>
    !v || /^\d+(\.\d{1,2})?$/.test(String(v))
      ? null
      : "Enter a number",
  date: (v) =>
    !v || !Number.isNaN(Date.parse(String(v)))
      ? null
      : "Enter a valid date",
}
