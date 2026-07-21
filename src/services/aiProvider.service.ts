export interface IAIProvider {
  providerName: string;
  generateSummary(text: string): Promise<{ summary: string; version: string }>;
  generateTags(text: string): Promise<{ tags: string[]; version: string }>;
  generateEmbedding(
    text: string,
  ): Promise<{ embedding: number[]; model: string; dimensions: number }>;
}

export class MockAIProvider implements IAIProvider {
  public providerName = 'mock-provider';

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
