import pdfParse from 'pdf-parse';
import { StorageService } from './storage.service';
import { IFileVersion } from '../models/fileVersion.model';

const MAX_INPUT_BYTES = 5 * 1024 * 1024; // AI input size policy

export class TextExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextExtractError';
  }
}

function truncateToPolicy(text: string): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= MAX_INPUT_BYTES) {
    return text;
  }
  let sliced = buf.subarray(0, MAX_INPUT_BYTES).toString('utf8');
  if (sliced.length > 0 && text.substring(0, sliced.length) !== sliced) {
    sliced = sliced.substring(0, sliced.length - 1);
  }
  return `${sliced}\n\n[TRUNCATED_MAX_INPUT_LIMIT_5MB]`;
}

function isPdf(mimeType: string, storageKey: string): boolean {
  const mime = (mimeType || '').toLowerCase();
  const key = (storageKey || '').toLowerCase();
  return mime.includes('pdf') || key.endsWith('.pdf');
}

function isPlainText(mimeType: string, storageKey: string): boolean {
  const mime = (mimeType || '').toLowerCase();
  const key = (storageKey || '').toLowerCase();
  return (
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('csv') ||
    mime.includes('markdown') ||
    /\.(txt|md|csv|json|log)$/i.test(key)
  );
}

/**
 * Download file bytes from storage and extract text for AI processing.
 * Throws TextExtractError on empty/unsupported content when live extraction is required.
 */
export async function extractTextFromFileVersion(version: IFileVersion): Promise<string> {
  if (!version.storageKey) {
    throw new TextExtractError('File version has no storageKey');
  }

  let buffer: Buffer;
  try {
    buffer = await StorageService.downloadFile(version.storageKey);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown download error';
    throw new TextExtractError(`Failed to download file for text extraction: ${message}`);
  }

  if (!buffer || buffer.length === 0) {
    throw new TextExtractError('Downloaded file is empty');
  }

  let text = '';

  if (isPdf(version.mimeType, version.storageKey)) {
    try {
      const parsed = await pdfParse(buffer);
      text = (parsed.text || '').trim();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown PDF parse error';
      throw new TextExtractError(`PDF text extraction failed: ${message}`);
    }
  } else if (isPlainText(version.mimeType, version.storageKey)) {
    text = buffer.toString('utf8').trim();
  } else {
    // Best-effort UTF-8 decode for unknown types that may still be text
    const decoded = buffer.toString('utf8');
    const printableRatio =
      decoded.length === 0
        ? 0
        : decoded.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').length / decoded.length;
    if (printableRatio > 0.85) {
      text = decoded.trim();
    } else {
      throw new TextExtractError(
        `Unsupported mime type for text extraction: ${version.mimeType || 'unknown'}`,
      );
    }
  }

  if (!text) {
    throw new TextExtractError('No extractable text found in file');
  }

  return truncateToPolicy(text);
}

export function buildMockExtractedText(fileVersionId: string): string {
  return `This is a mock extracted text from the file version ${fileVersionId}. It contains test dummy strings for verification.`;
}
