export function cleanPhoneNumber(value: string | null | undefined): string {
  return String(value || "").replace(/[\s\-.()+]/g, "");
}

export function normalizePhone(value: string | null | undefined): string {
  const cleaned = cleanPhoneNumber(value);
  if (/^243(81|82|83|84|85|89|90|97|98|99)\d{7}$/.test(cleaned)) {
    return `0${cleaned.slice(3)}`;
  }
  return cleaned;
}

export function isValidMsisdn(value: string | null | undefined): boolean {
  const phone = normalizePhone(value);
  return /^(08|09)\d{8}$/.test(phone);
}

/** Numéro M-Pesa : uniquement un MSISDN en 08 (ou +2438…). */
export function isValidMpesa(value: string | null | undefined): boolean {
  return /^08\d{8}$/.test(normalizePhone(value));
}

export function phoneValidationMessage(value: string): string {
  if (!value.trim()) return "Le numéro de téléphone est obligatoire.";
  if (!isValidMsisdn(value)) {
    return "Numéro invalide : 10 chiffres commençant par 08 ou 09, ou au format +243.";
  }
  return "";
}

export function formatPhoneForDisplay(value: string | null | undefined): string {
  const normalized = normalizePhone(value);
  if (!isValidMsisdn(normalized)) return normalized;
  return `${normalized.slice(0, 3)} ${normalized.slice(3, 6)} ${normalized.slice(6)}`;
}
