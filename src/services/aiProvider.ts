import { GoogleGenAI } from '@google/genai';

// Server-only module: this file must never be imported from a React
// component. Only server.ts touches it, so API keys never reach the client
// bundle. Two providers are supported behind one interface so the AI
// Copilot / demand forecaster can run against either a direct Gemini key or
// an OpenRouter key without touching call sites.
export interface AiGenerateOptions {
  temperature?: number;
  systemInstruction?: string;
}

export interface AiProvider {
  readonly name: 'gemini' | 'openrouter';
  readonly available: boolean;
  generateText(prompt: string, options?: AiGenerateOptions): Promise<string>;
  generateJSON<T = unknown>(prompt: string, options?: AiGenerateOptions): Promise<T>;
}

class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;
  private client: GoogleGenAI | null;
  private model: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    this.client = apiKey ? new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } }) : null;
    this.model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  }

  get available() {
    return this.client !== null;
  }

  private async call(prompt: string, options: AiGenerateOptions | undefined, jsonMode: boolean): Promise<string> {
    if (!this.client) throw new Error('Gemini provider is not configured (GEMINI_API_KEY missing).');
    const maxAttempts = 3;
    let lastErr: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.client.models.generateContent({
          model: this.model,
          contents: prompt,
          config: {
            responseMimeType: jsonMode ? 'application/json' : 'text/plain',
            temperature: options?.temperature ?? 0.3,
            ...(options?.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
          },
        });
        return response.text || '';
      } catch (err: any) {
        lastErr = err;
        const retryable = err.message?.includes('503') || err.message?.includes('UNAVAILABLE');
        if (!retryable || attempt === maxAttempts) break;
        await new Promise((r) => setTimeout(r, attempt * 700));
      }
    }
    throw lastErr;
  }

  async generateText(prompt: string, options?: AiGenerateOptions): Promise<string> {
    return this.call(prompt, options, false);
  }

  async generateJSON<T = unknown>(prompt: string, options?: AiGenerateOptions): Promise<T> {
    const text = await this.call(prompt, options, true);
    return JSON.parse(text || '{}') as T;
  }
}

class OpenRouterProvider implements AiProvider {
  readonly name = 'openrouter' as const;
  private apiKey: string | undefined;
  private model: string;

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY;
    this.model = process.env.OPENROUTER_MODEL || 'google/gemini-3.6-flash';
  }

  get available() {
    return Boolean(this.apiKey);
  }

  private async call(prompt: string, options: AiGenerateOptions | undefined, jsonMode: boolean): Promise<string> {
    if (!this.apiKey) throw new Error('OpenRouter provider is not configured (OPENROUTER_API_KEY missing).');
    const messages = [
      ...(options?.systemInstruction ? [{ role: 'system', content: options.systemInstruction }] : []),
      { role: 'user', content: prompt },
    ];
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options?.temperature ?? 0.3,
        max_tokens: 2048,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenRouter request failed (${response.status}): ${detail.slice(0, 300)}`);
    }
    const payload: any = await response.json();
    return payload.choices?.[0]?.message?.content || '';
  }

  async generateText(prompt: string, options?: AiGenerateOptions): Promise<string> {
    return this.call(prompt, options, false);
  }

  async generateJSON<T = unknown>(prompt: string, options?: AiGenerateOptions): Promise<T> {
    const text = await this.call(prompt, options, true);
    return JSON.parse(text || '{}') as T;
  }
}

let cachedProvider: AiProvider | null = null;

/** Resolves the active provider from AI_PROVIDER (default: gemini), falling
 *  back to whichever provider actually has credentials configured so a demo
 *  doesn't silently break if the env var and the available key disagree. */
export function getAiProvider(): AiProvider {
  if (cachedProvider) return cachedProvider;
  const preferred = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  const gemini = new GeminiProvider();
  const openrouter = new OpenRouterProvider();
  if (preferred === 'openrouter' && openrouter.available) cachedProvider = openrouter;
  else if (preferred === 'gemini' && gemini.available) cachedProvider = gemini;
  else if (gemini.available) cachedProvider = gemini;
  else if (openrouter.available) cachedProvider = openrouter;
  else cachedProvider = gemini; // still returned so callers can check .available and fall back to rules-engine
  return cachedProvider;
}
