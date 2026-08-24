export const WEB_BYOK_PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI" },
] as const;

export type WebByokProvider = (typeof WEB_BYOK_PROVIDER_OPTIONS)[number]["value"];

const SUPPORTED_WEB_BYOK_PROVIDERS = new Set<string>(
  WEB_BYOK_PROVIDER_OPTIONS.map((option) => option.value),
);

export function parseWebByokProvider(value: FormDataEntryValue | null): WebByokProvider | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!SUPPORTED_WEB_BYOK_PROVIDERS.has(normalized)) return undefined;
  return normalized as WebByokProvider;
}
