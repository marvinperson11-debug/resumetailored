// Persisted settings: the extension token and API base URL, entered in the popup.

export interface Settings {
  token: string | null;
  apiBase: string;
}

const DEFAULTS: Settings = { token: null, apiBase: "http://localhost:3000" };

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(["token", "apiBase"]);
  return {
    token: stored.token ?? DEFAULTS.token,
    apiBase: stored.apiBase ?? DEFAULTS.apiBase,
  };
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(s);
}
