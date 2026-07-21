import { supabase } from '../config/supabase';
import { config } from '../config';

export class StorageService {
  private static mockStorage = new Map<string, { buffer: Buffer; mimeType: string }>();
  private static mockFailNextUpload = false;
  /** When Supabase is configured but unreachable in development, use mock for the process lifetime. */
  private static devMockFallbackActive = false;

  /**
   * Set simulated failure flag for integration tests
   */
  public static setMockFailure(shouldFail: boolean) {
    this.mockFailNextUpload = shouldFail;
  }

  private static shouldUseMock(): boolean {
    return !supabase || this.devMockFallbackActive || config.STORAGE_USE_MOCK;
  }

  /** True when files are served from in-memory mock storage (local dev / tests). */
  public static isMockMode(): boolean {
    return this.shouldUseMock();
  }

  private static activateDevMockFallback(reason: string): void {
    if (this.devMockFallbackActive) {
      return;
    }
    this.devMockFallbackActive = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[WARN] Supabase storage unreachable (${reason}). Falling back to in-memory mock storage for local development.`,
    );
  }

  private static isDevNetworkFailure(message: string): boolean {
    return config.NODE_ENV === 'development' && /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(message);
  }

  /**
   * Uploads file to Supabase (or mock memory store)
   */
  public static async uploadFile(
    storageKey: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    if (this.mockFailNextUpload) {
      this.mockFailNextUpload = false; // Reset
      throw new Error('Simulated Supabase Upload Failure');
    }

    if (this.shouldUseMock()) {
      this.mockStorage.set(storageKey, { buffer, mimeType });
      return;
    }

    const { error } = await supabase!.storage
      .from(config.SUPABASE_BUCKET)
      .upload(storageKey, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) {
      if (this.isDevNetworkFailure(error.message)) {
        this.activateDevMockFallback(error.message);
        this.mockStorage.set(storageKey, { buffer, mimeType });
        return;
      }
      throw new Error(`Supabase upload error: ${error.message}`);
    }
  }

  /**
   * Deletes file from Supabase (or mock memory store)
   */
  public static async deleteFile(storageKey: string): Promise<void> {
    if (this.shouldUseMock()) {
      this.mockStorage.delete(storageKey);
      return;
    }

    const { error } = await supabase!.storage.from(config.SUPABASE_BUCKET).remove([storageKey]);

    if (error) {
      if (this.isDevNetworkFailure(error.message)) {
        this.activateDevMockFallback(error.message);
        this.mockStorage.delete(storageKey);
        return;
      }
      throw new Error(`Supabase delete error: ${error.message}`);
    }
  }

  /**
   * Generates a short-lived signed URL (or mock URL)
   */
  public static async generateSignedUrl(
    storageKey: string,
    expiresInSeconds: number = 60,
  ): Promise<string> {
    if (this.shouldUseMock()) {
      if (!this.mockStorage.has(storageKey)) {
        throw new Error('File not found in storage');
      }
      return `https://mock-supabase.storage/signed/${storageKey}?token=mock-token-${Date.now()}&expires=${expiresInSeconds}`;
    }

    const { data, error } = await supabase!.storage
      .from(config.SUPABASE_BUCKET)
      .createSignedUrl(storageKey, expiresInSeconds);

    if (error || !data?.signedUrl) {
      const message = error?.message || 'Failed to generate URL';
      if (this.isDevNetworkFailure(message)) {
        this.activateDevMockFallback(message);
        if (!this.mockStorage.has(storageKey)) {
          throw new Error('File not found in storage');
        }
        return `https://mock-supabase.storage/signed/${storageKey}?token=mock-token-${Date.now()}&expires=${expiresInSeconds}`;
      }
      throw new Error(`Supabase signed URL error: ${message}`);
    }
    return data.signedUrl;
  }

  /**
   * Downloads file from Supabase (or mock memory store)
   */
  public static async downloadFile(storageKey: string): Promise<Buffer> {
    if (this.shouldUseMock()) {
      const mockFile = this.mockStorage.get(storageKey);
      if (!mockFile) {
        throw new Error('File not found in storage');
      }
      return mockFile.buffer;
    }

    const { data, error } = await supabase!.storage
      .from(config.SUPABASE_BUCKET)
      .download(storageKey);

    if (error || !data) {
      const message = error?.message || 'Failed to download file';
      if (this.isDevNetworkFailure(message)) {
        this.activateDevMockFallback(message);
        const mockFile = this.mockStorage.get(storageKey);
        if (!mockFile) {
          throw new Error('File not found in storage');
        }
        return mockFile.buffer;
      }
      throw new Error(`Supabase download error: ${message}`);
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Helper to retrieve mock file content (useful for verification in tests)
   */
  public static getMockFile(storageKey: string) {
    return this.mockStorage.get(storageKey);
  }

  /**
   * Reset mock storage (for clean test runs)
   */
  public static clearMockStorage() {
    this.mockStorage.clear();
    this.mockFailNextUpload = false;
    this.devMockFallbackActive = false;
  }
}
