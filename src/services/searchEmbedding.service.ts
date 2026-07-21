import { MockAIProvider, IAIProvider } from './aiProvider.service';

export class SearchEmbeddingService {
  private aiProvider: IAIProvider;
  private cache: Map<string, number[]>;

  constructor(aiProvider?: IAIProvider) {
    // Default to MockAIProvider, allowing dependency injection for testing
    this.aiProvider = aiProvider || new MockAIProvider();
    this.cache = new Map<string, number[]>();
  }

  /**
   * Normalizes query string by trimming and converting to lowercase.
   */
  public normalizeQuery(query: string): string {
    return (query || '').trim().toLowerCase();
  }

  /**
   * Generates a transient query embedding, checking the in-memory cache first.
   */
  public async generateQueryEmbedding(query: string): Promise<number[]> {
    const normalized = this.normalizeQuery(query);
    if (!normalized) {
      throw new Error('Query cannot be empty for embedding generation.');
    }

    // Check transient in-memory cache
    if (this.cache.has(normalized)) {
      return this.cache.get(normalized)!;
    }

    // Call provider
    const { embedding } = await this.aiProvider.generateEmbedding(normalized);

    // Store in cache
    this.cache.set(normalized, embedding);

    return embedding;
  }

  /**
   * Clears the transient query embedding cache (useful for testing).
   */
  public clearCache(): void {
    this.cache.clear();
  }
}

export const searchEmbeddingService = new SearchEmbeddingService();
export default searchEmbeddingService;
