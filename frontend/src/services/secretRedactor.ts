/**
 * SecretRedactor - Client-side Secret Isolation & Redaction
 *
 * Scans user utterances and chat inputs for sensitive database passwords,
 * API keys, and authorization tokens before they reach the network or LLM.
 *
 * Extracted credentials are routed strictly through the isolated `secureInputData`
 * channel directly to the encrypted control plane, while the transcript and
 * conversational history display only `[REDACTED_CREDENTIAL]`.
 */

export interface RedactedSecretMap {
  password?: string;
  apiKey?: string;
  token?: string;
  [key: string]: string | undefined;
}

export interface RedactionResult {
  /** Text with all discovered secrets replaced with [REDACTED_CREDENTIAL] */
  redactedText: string;
  /** True if any secrets were identified and stripped */
  hasRedaction: boolean;
  /** Isolated secret payload intended for secureInputData */
  extractedSecrets: RedactedSecretMap;
  /** List of raw sensitive substrings extracted (for audit/cleanup) */
  redactedValues: string[];
}

/**
 * Regex patterns targeting natural language expressions where users state secrets.
 */
const SECRET_PATTERNS = [
  // Database / User Passwords. Whole words only: "pass" alone is not one (Hindi "mere pass to …" means "I have …"),
  // and neither is "compass is" or "bypass to".
  {
    type: "password" as const,
    regex: /\b(?:password|passwd|passcode|pwd)\b\s*(?:is|to|:|equals|=)\s*(["']?[^\s,;'").]+["']?)/gi,
  },
  {
    type: "password" as const,
    regex: /\bsecret\b\s*(?:is|:|equals|=)\s*(["']?[^\s,;'").]+["']?)/gi,
  },
  // API Keys (OpenAI, Anthropic, Gemini, generic)
  {
    type: "apiKey" as const,
    regex: /\b(?:api[_\s-]?key|secret[_\s-]?key|openai[_\s-]?key|anthropic[_\s-]?key|gemini[_\s-]?key)\b\s*(?:is|to|:|equals|=)\s*(["']?[^\s,;'").]+["']?)/gi,
  },
  // Raw API Key tokens (sk-...)
  {
    type: "apiKey" as const,
    regex: /\b(sk-[a-zA-Z0-9_\-]{20,})\b/gi,
  },
  // Bearer / Auth Tokens
  {
    type: "token" as const,
    regex: /\b(?:bearer\s+token|auth[_\s-]?token|access[_\s-]?token)\b\s*(?:is|to|:|equals|=)\s*(["']?[^\s,;'").]+["']?)/gi,
  },
];

/**
 * Inspect an utterance string, extract any discovered secrets into an isolated map,
 * and return the sanitized string with sensitive tokens replaced with [REDACTED_CREDENTIAL].
 */
export function redactSecretsFromUtterance(text: string): RedactionResult {
  if (!text || typeof text !== "string") {
    return {
      redactedText: "",
      hasRedaction: false,
      extractedSecrets: {},
      redactedValues: [],
    };
  }

  let sanitized = text;
  const extractedSecrets: RedactedSecretMap = {};
  const redactedValues: string[] = [];

  for (const { type, regex } of SECRET_PATTERNS) {
    // Reset regex index for global pattern matching
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      // The secret token is captured in group 1
      const rawSecret = match[1] || match[0];
      const cleanSecret = rawSecret.replace(/^["']|["']$/g, "").trim();

      // Avoid catching common stopwords or empty values
      if (
        cleanSecret &&
        cleanSecret.length >= 2 &&
        !["is", "to", "the", "a", "an", "not", "none", "null"].includes(cleanSecret.toLowerCase())
      ) {
        if (!extractedSecrets[type]) {
          extractedSecrets[type] = cleanSecret;
        }
        redactedValues.push(cleanSecret);

        // Replace the raw token in the text
        sanitized = sanitized.split(cleanSecret).join("[REDACTED_CREDENTIAL]");
      }
    }
  }

  const hasRedaction = Object.keys(extractedSecrets).length > 0;

  return {
    redactedText: sanitized,
    hasRedaction,
    extractedSecrets,
    redactedValues,
  };
}

/**
 * Returns true if the string appears to contain credentials or password patterns.
 */
export function containsSecretPattern(text: string): boolean {
  if (!text) return false;
  return SECRET_PATTERNS.some(({ regex }) => {
    regex.lastIndex = 0;
    return regex.test(text);
  });
}

/**
 * Masks a secret string for display in the UI (e.g., "ipo••••••••").
 */
export function maskSecret(value?: string | null, visibleChars = 3): string {
  if (!value) return "••••••••";
  if (value.length <= visibleChars) return "••••••••";
  const visible = value.substring(0, visibleChars);
  return `${visible}${"•".repeat(Math.min(12, value.length - visibleChars))}`;
}
