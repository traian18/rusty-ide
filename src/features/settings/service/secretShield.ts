export type SecretShieldPolicy = "off" | "warn" | "mask" | "block";

export interface SecretShieldPreferences {
  secretShieldPolicy: SecretShieldPolicy;
  setSecretShieldPolicy: (policy: SecretShieldPolicy) => void;
  hydrateSecretShieldPolicy: () => void;
}

export const SECRET_SHIELD_POLICIES: readonly SecretShieldPolicy[] = ["off", "warn", "mask", "block"];
export const SECRET_SHIELD_DEFAULT_POLICY: SecretShieldPolicy = "mask";
const SECRET_SHIELD_STORAGE_KEY = "rusty.secretShieldPolicy";

export function normalizeSecretShieldPolicy(value: unknown): SecretShieldPolicy {
  return SECRET_SHIELD_POLICIES.includes(value as SecretShieldPolicy)
    ? (value as SecretShieldPolicy)
    : SECRET_SHIELD_DEFAULT_POLICY;
}

export function loadSecretShieldPolicy(): SecretShieldPolicy {
  if (typeof localStorage === "undefined") return SECRET_SHIELD_DEFAULT_POLICY;
  try {
    const stored = localStorage.getItem(SECRET_SHIELD_STORAGE_KEY);
    return stored === null ? SECRET_SHIELD_DEFAULT_POLICY : normalizeSecretShieldPolicy(stored);
  } catch {
    return SECRET_SHIELD_DEFAULT_POLICY;
  }
}

export function saveSecretShieldPolicy(policy: SecretShieldPolicy): SecretShieldPolicy {
  const normalized = normalizeSecretShieldPolicy(policy);
  try {
    localStorage.setItem(SECRET_SHIELD_STORAGE_KEY, normalized);
  } catch {
    // Keep the in-memory setting usable when browser storage is unavailable.
  }
  return normalized;
}

export function redactCredentialText(text: string): { text: string; detected: boolean } {
  const patterns = [
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b/gi,
    /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*(["']?)[^\s,"'};]+\1/gi,
  ];
  let redacted = text;
  let detected = false;
  for (const pattern of patterns) {
    redacted = redacted.replace(pattern, () => {
      detected = true;
      return "[REDACTED]";
    });
  }
  return { text: redacted, detected };
}

export function redactOutboundValue(value: unknown): { value: unknown; detected: boolean } {
  if (typeof value === "string") {
    const result = redactCredentialText(value);
    return { value: result.text, detected: result.detected };
  }
  if (Array.isArray(value)) {
    let detected = false;
    const mapped = value.map((item) => {
      const result = redactOutboundValue(item);
      detected ||= result.detected;
      return result.value;
    });
    return { value: mapped, detected };
  }
  if (value !== null && typeof value === "object") {
    let detected = false;
    const mapped = Object.fromEntries(Object.entries(value).map(([key, item]) => {
      const result = redactOutboundValue(item);
      detected ||= result.detected;
      return [key, result.value];
    }));
    return { value: mapped, detected };
  }
  return { value, detected: false };
}
