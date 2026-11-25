// Where an LLM call goes, decided per model.
//
// The app was built on Lovable Cloud, whose AI gateway served every google/*
// and openai/* model against LOVABLE_API_KEY. A backend that is not on Lovable
// Cloud has no such key, so those models need another destination:
//
//   lovable     https://ai.gateway.lovable.dev   LOVABLE_API_KEY
//   openrouter  https://openrouter.ai            OPENROUTER_API_KEY
//   gemini      Google AI Studio (OpenAI-compatible endpoint)   GEMINI_API_KEY
//
// Models only OpenRouter carries (anthropic/*, qwen/*, ...) always go there.
// Everything else goes to the gateway AI_GATEWAY names, or, when it is unset,
// to the first of lovable, openrouter, gemini whose key is configured. So a
// Lovable-backed project behaves exactly as before, and a project with only
// OPENROUTER_API_KEY routes Gemini through OpenRouter with no further setup.
//
// The gemini gateway serves google/* only; anything else it cannot serve
// (openai/*) falls through to OpenRouter.
//
// Every function here reads the environment when it is called, not when the
// module loads, so tests can change the env between calls.

export type AiRoute = 'lovable' | 'openrouter' | 'gemini';

export const LOVABLE_CHAT_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
export const LOVABLE_IMAGES_URL = 'https://ai.gateway.lovable.dev/v1/images/generations';
export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const GEMINI_CHAT_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
export const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export const ROUTE_KEY: Record<AiRoute, string> = {
  lovable: 'LOVABLE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

const CHAT_URL: Record<AiRoute, string> = {
  lovable: LOVABLE_CHAT_URL,
  openrouter: OPENROUTER_CHAT_URL,
  gemini: GEMINI_CHAT_URL,
};

/** Named in errors when no gateway key is configured at all. */
export const NO_AI_KEY_MESSAGE =
  'No AI gateway key configured: set OPENROUTER_API_KEY or GEMINI_API_KEY (or LOVABLE_API_KEY on Lovable Cloud)';

/** Models the Lovable gateway never carried; OpenRouter is the only route. */
const OPENROUTER_ONLY = /^(anthropic|qwen|meta-llama|mistralai|deepseek|x-ai)\//;

const AUTO_ORDER: AiRoute[] = ['lovable', 'openrouter', 'gemini'];

function envKey(route: AiRoute): string | undefined {
  const value = Deno.env.get(ROUTE_KEY[route]);
  return value && value.trim() ? value : undefined;
}

/**
 * The gateway for models that are not OpenRouter-only. AI_GATEWAY wins when
 * set; an unknown value throws rather than silently picking something else.
 * Unset, the first configured key in AUTO_ORDER decides, and with no key at all
 * the answer is 'lovable' so the caller's missing-key error is the historical one.
 */
export function defaultGateway(): AiRoute {
  const explicit = Deno.env.get('AI_GATEWAY')?.trim().toLowerCase();
  if (explicit) {
    if (explicit === 'lovable' || explicit === 'openrouter' || explicit === 'gemini') return explicit;
    throw new Error(`AI_GATEWAY must be lovable, openrouter or gemini (got "${explicit}")`);
  }
  return AUTO_ORDER.find((route) => envKey(route)) ?? 'lovable';
}

export function routeForModel(model: string): AiRoute {
  if (OPENROUTER_ONLY.test(model)) return 'openrouter';
  const gateway = defaultGateway();
  if (gateway === 'gemini' && !model.startsWith('google/')) return 'openrouter';
  return gateway;
}

/** The model id as the destination spells it: Google's own API drops the vendor prefix. */
export function wireModel(model: string, route: AiRoute): string {
  return route === 'gemini' ? model.replace(/^google\//, '') : model;
}

export interface ChatTarget {
  route: AiRoute;
  url: string;
  /** The model id to put in the request body. */
  model: string;
  /** Undefined when the route's key is not configured; see `missingKey`. */
  apiKey: string | undefined;
  /** The env var to set when `apiKey` is undefined, else null. */
  missingKey: string | null;
  headers: Record<string, string>;
}

/** Everything needed to POST an OpenAI-shaped chat completion for `model`. */
export function chatTarget(model: string): ChatTarget {
  const route = routeForModel(model);
  const apiKey = envKey(route);
  return {
    route,
    url: CHAT_URL[route],
    model: wireModel(model, route),
    apiKey,
    missingKey: apiKey ? null : missingKeyName(route),
    headers: { Authorization: `Bearer ${apiKey ?? ''}`, 'Content-Type': 'application/json' },
  };
}

function missingKeyName(route: AiRoute): string {
  // With no gateway key at all, name every option rather than the one a
  // non-Lovable project should not be told to go and find.
  const nothingSet = !Deno.env.get('AI_GATEWAY') && AUTO_ORDER.every((r) => !envKey(r));
  return nothingSet && route !== 'openrouter' ? NO_AI_KEY_MESSAGE : ROUTE_KEY[route];
}

/**
 * The env var a call to `model` still needs, or null when it is configured.
 * Functions check this up front so a missing key is a clear 500 rather than a
 * 401 from upstream. Defaults to a google/* model, the common case.
 */
export function missingAiKey(model = 'google/gemini-2.5-flash'): string | null {
  return chatTarget(model).missingKey;
}

/** `missingAiKey` phrased as the error the functions have always returned. */
export function missingAiKeyError(model?: string): string | null {
  const missing = missingAiKey(model);
  if (!missing) return null;
  return missing === NO_AI_KEY_MESSAGE ? missing : `${missing} not configured`;
}

// ----------------- Image generation -----------------

export class ImageGenError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Generate one image with a Gemini image model and return it as a data URL.
 * Each gateway has its own shape: Lovable's images endpoint returns
 * `data[0].b64_json`, OpenRouter's chat completions return
 * `message.images[0].image_url.url`, and Google's native API returns an
 * `inlineData` part (its OpenAI-compatible endpoint does not return images).
 */
export async function generateImage(
  model: string,
  prompt: string,
  opts: { signal?: AbortSignal } = {},
): Promise<string> {
  const target = chatTarget(model);
  if (!target.apiKey) throw new ImageGenError(500, missingAiKeyError(model) ?? 'AI key not configured');

  let resp: Response;
  if (target.route === 'gemini') {
    resp = await fetch(`${GEMINI_MODELS_URL}/${target.model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': target.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
      signal: opts.signal,
    });
  } else {
    const isLovable = target.route === 'lovable';
    resp = await fetch(isLovable ? LOVABLE_IMAGES_URL : target.url, {
      method: 'POST',
      headers: isLovable ? { ...target.headers, 'Lovable-API-Key': target.apiKey } : target.headers,
      body: JSON.stringify({
        model: target.model,
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image', 'text'],
      }),
      signal: opts.signal,
    });
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new ImageGenError(resp.status, `image gen failed: ${resp.status} ${text.slice(0, 300)}`);
  }
  const json = await resp.json();
  const url = extractImageDataUrl(json);
  if (!url) throw new ImageGenError(502, 'no image in response');
  return url;
}

/** Pulls the first image out of any of the three gateways' response shapes. */
export function extractImageDataUrl(json: unknown): string | null {
  const j = json as ImageResponse | null;
  const b64 = j?.data?.[0]?.b64_json;
  if (typeof b64 === 'string' && b64) return `data:image/png;base64,${b64}`;
  const chatUrl = j?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (typeof chatUrl === 'string' && chatUrl) return chatUrl;
  const parts = j?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      const inline = part?.inlineData ?? part?.inline_data;
      if (inline?.data) return `data:${inline.mimeType ?? inline.mime_type ?? 'image/png'};base64,${inline.data}`;
    }
  }
  return null;
}

/** The union of the three gateways' image response shapes, every field optional. */
interface ImageResponse {
  data?: Array<{ b64_json?: string }>;
  choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { mimeType?: string; mime_type?: string; data?: string };
        inline_data?: { mimeType?: string; mime_type?: string; data?: string };
      }>;
    };
  }>;
}

/** Decodes a base64 data URL to bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const m = dataUrl.match(/^data:[^;]*;base64,(.+)$/);
  if (!m) throw new Error('expected a base64 data URL');
  const bin = atob(m[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
