import { config } from '../config';

export interface IAIProvider {
  providerName: string;
  summarizerModelName: string;
  summarizerModelVersion: string;
  generateSummary(text: string): Promise<{ summary: string; version: string }>;
  generateTags(text: string): Promise<{ tags: string[]; version: string }>;
  generateEmbedding(
    text: string,
  ): Promise<{ embedding: number[]; model: string; dimensions: number }>;
}

export class MockAIProvider implements IAIProvider {
  public providerName = 'mock-provider';
  public summarizerModelName = 'mock-summarizer';
  public summarizerModelVersion = '1.0.0';

  async generateSummary(text: string): Promise<{ summary: string; version: string }> {
    const cleanText = text.trim();
    const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
    const preview = cleanText.substring(0, 60).replace(/\n/g, ' ');
    const summary = `This is a mock summary of the document containing ${wordCount} words. The document text begins with: "${preview}..."`;
    return {
      summary,
      version: 'mock-summary-v1',
    };
  }

  async generateTags(text: string): Promise<{ tags: string[]; version: string }> {
    const tags = ['mock-tag-1', 'mock-tag-2'];
    const lower = text.toLowerCase();
    if (lower.includes('pdf')) {
      tags.push('pdf');
    }
    if (lower.includes('test') || lower.includes('dummy')) {
      tags.push('test-content');
    }
    return {
      tags,
      version: 'mock-tags-v1',
    };
  }

  async generateEmbedding(
    text: string,
  ): Promise<{ embedding: number[]; model: string; dimensions: number }> {
    const norm = text.trim().toLowerCase();

    // Check for specific test terms to return orthogonal mock vectors
    if (norm.includes('concept a')) {
      const embedding = new Array(1536).fill(0);
      embedding[0] = 1.0;
      return {
        embedding,
        model: 'mock-text-embedding-3-small',
        dimensions: 1536,
      };
    }

    if (norm.includes('concept b')) {
      const embedding = new Array(1536).fill(0);
      embedding[1] = 1.0;
      return {
        embedding,
        model: 'mock-text-embedding-3-small',
        dimensions: 1536,
      };
    }

    if (norm.includes('deleted')) {
      const embedding = new Array(1536).fill(0);
      embedding[2] = 1.0;
      return {
        embedding,
        model: 'mock-text-embedding-3-small',
        dimensions: 1536,
      };
    }

    if (norm.includes('audit info') || norm === 'audit') {
      const embedding = new Array(1536).fill(0);
      embedding[0] = 1.0;
      embedding[1] = 1.0;
      return {
        embedding,
        model: 'mock-text-embedding-3-small',
        dimensions: 1536,
      };
    }

    // Default mock embedding generation
    const textLen = text.length || 1;
    const embedding = new Array(1536).fill(0).map((_, i) => {
      const charCode = text.charCodeAt(i % textLen) || 0;
      // Generate a deterministic value between -0.1 and 0.1
      return Math.sin(i + charCode) * 0.1;
    });

    return {
      embedding,
      model: 'mock-text-embedding-3-small',
      dimensions: 1536,
    };
  }
}

/**
 * OpenRouter (OpenAI-compatible) provider.
 * Requires OPENROUTER_API_KEY. Uses chat completions + embeddings HTTP APIs.
 */
export class OpenRouterAIProvider implements IAIProvider {
  public providerName = 'openrouter';
  public summarizerModelName: string;
  public summarizerModelVersion = 'openrouter';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly chatModel: string;
  private readonly embeddingModel: string;

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    chatModel?: string;
    embeddingModel?: string;
  }) {
    this.apiKey = options?.apiKey || config.OPENROUTER_API_KEY;
    this.baseUrl = (options?.baseUrl || config.OPENROUTER_BASE_URL).replace(/\/$/, '');
    this.chatModel = options?.chatModel || config.OPENROUTER_MODEL;
    this.embeddingModel = options?.embeddingModel || config.OPENROUTER_EMBEDDING_MODEL;
    this.summarizerModelName = this.chatModel;

    if (!this.apiKey) {
      throw new Error('OpenRouterAIProvider requires OPENROUTER_API_KEY');
    }
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/Strarist/CloudVault',
        'X-Title': 'CloudVault',
      },
      body: JSON.stringify(body),
    });

    const raw = await response.text();
    let data: unknown = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { error: { message: raw } };
    }

    if (!response.ok) {
      const errObj = data as { error?: { message?: string }; message?: string };
      const message =
        errObj.error?.message || errObj.message || `OpenRouter HTTP ${response.status}`;
      const err = new Error(message) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    return data as T;
  }

  async generateSummary(text: string): Promise<{ summary: string; version: string }> {
    const truncated = text.length > 120_000 ? `${text.slice(0, 120_000)}\n\n[TRUNCATED]` : text;
    const data = await this.request<{
      choices?: Array<{ message?: { content?: string } }>;
    }>('/chat/completions', {
      model: this.chatModel,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You summarize documents for a collaborative file vault. Write a concise, factual summary in 3-6 sentences. Do not invent facts.',
        },
        {
          role: 'user',
          content: `Summarize this document:\n\n${truncated}`,
        },
      ],
    });

    const summary = data.choices?.[0]?.message?.content?.trim();
    if (!summary) {
      throw new Error('OpenRouter returned an empty summary');
    }
    return { summary, version: 'openrouter-summary-v1' };
  }

  async generateTags(text: string): Promise<{ tags: string[]; version: string }> {
    const truncated = text.length > 80_000 ? `${text.slice(0, 80_000)}\n\n[TRUNCATED]` : text;
    const data = await this.request<{
      choices?: Array<{ message?: { content?: string } }>;
    }>('/chat/completions', {
      model: this.chatModel,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content:
            'Extract 3-8 short topical tags for a document. Reply with a JSON array of strings only, no markdown.',
        },
        {
          role: 'user',
          content: truncated,
        },
      ],
    });

    const content = data.choices?.[0]?.message?.content?.trim() || '[]';
    let tags: string[] = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
      if (Array.isArray(parsed)) {
        tags = parsed
          .map((t) => String(t).trim().toLowerCase().replace(/\s+/g, '-'))
          .filter(Boolean)
          .slice(0, 8);
      }
    } catch {
      tags = content
        .split(/[,\n]/)
        .map((t) => t.replace(/[\[\]"']/g, '').trim().toLowerCase().replace(/\s+/g, '-'))
        .filter(Boolean)
        .slice(0, 8);
    }

    if (tags.length === 0) {
      tags = ['untagged'];
    }

    return { tags, version: 'openrouter-tags-v1' };
  }

  async generateEmbedding(
    text: string,
  ): Promise<{ embedding: number[]; model: string; dimensions: number }> {
    // Free-tier path: OpenRouter has no reliable free embedding models.
    // `local` keeps semantic search working without paid OpenAI embedding calls.
    if (!this.embeddingModel || this.embeddingModel.toLowerCase() === 'local') {
      return this.localEmbedding(text);
    }

    const input = text.length > 20_000 ? text.slice(0, 20_000) : text;
    const data = await this.request<{
      data?: Array<{ embedding?: number[] }>;
    }>('/embeddings', {
      model: this.embeddingModel,
      input,
    });

    const embedding = data.data?.[0]?.embedding;
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('OpenRouter returned an empty embedding');
    }

    return {
      embedding,
      model: this.embeddingModel,
      dimensions: embedding.length,
    };
  }

  private localEmbedding(text: string): {
    embedding: number[];
    model: string;
    dimensions: number;
  } {
    const input = text.trim() || ' ';
    const textLen = input.length;
    const embedding = new Array(1536).fill(0).map((_, i) => {
      const charCode = input.charCodeAt(i % textLen) || 0;
      return Math.sin(i + charCode) * 0.1;
    });
    return {
      embedding,
      model: 'local-deterministic-embedding',
      dimensions: 1536,
    };
  }
}

export function isMockAIProvider(provider: IAIProvider): boolean {
  return provider.providerName === 'mock-provider';
}

/**
 * Select AI provider from env.
 * OpenRouter is used only when AI_PROVIDER=openrouter and OPENROUTER_API_KEY is set.
 */
export function createAIProvider(): IAIProvider {
  const requested = (config.AI_PROVIDER || 'mock').toLowerCase().trim();

  if (requested === 'openrouter') {
    if (config.OPENROUTER_API_KEY) {
      // eslint-disable-next-line no-console
      console.log(
        `[AI] Using OpenRouter provider (model=${config.OPENROUTER_MODEL}, embeddings=${config.OPENROUTER_EMBEDDING_MODEL})`,
      );
      return new OpenRouterAIProvider();
    }
    // eslint-disable-next-line no-console
    console.warn(
      '[AI] AI_PROVIDER=openrouter but OPENROUTER_API_KEY is empty — falling back to mock provider',
    );
  } else if (requested !== 'mock') {
    // eslint-disable-next-line no-console
    console.warn(`[AI] Unknown AI_PROVIDER="${requested}" — falling back to mock provider`);
  } else {
    // eslint-disable-next-line no-console
    console.log(
      '[AI] Using mock provider (set AI_PROVIDER=openrouter and OPENROUTER_API_KEY to enable OpenRouter)',
    );
  }

  return new MockAIProvider();
}
