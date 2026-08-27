import OpenAI from "openai";

export const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

// Instantiate lazily so a missing key never throws at build/module-load time —
// only when an AI route is actually invoked.
let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error("openai_not_configured");
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

/**
 * Call GPT-4o in JSON mode and parse the result. Throws if the model returns
 * non-JSON (should not happen with response_format json_object, but we guard).
 */
export async function chatJSON<T>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<T> {
  const res = await getClient().chat.completions.create({
    model: OPENAI_MODEL,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 2000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });

  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error("openai_empty_response");
  return JSON.parse(content) as T;
}
