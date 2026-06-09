import type { ParsedRollingPlanRow, PpcXlsxSheetType } from '../utils/rollingPlanXlsxParser';

export interface PreviewSession {
  sessionId: string;
  fileName: string;
  userId: number;
  rows: ParsedRollingPlanRow[];
  planDate: string;
  shiftCode: string;
  sheetType: PpcXlsxSheetType;
  sheetName?: string;
  expiresAt: number;
}

export interface PreviewSessionStore {
  get(sessionId: string): PreviewSession | undefined;
  set(sessionId: string, session: PreviewSession): void;
  delete(sessionId: string): void;
  sweep(): void;
  clear(): void;
}

export const PREVIEW_SESSION_TTL_MS = 30 * 60 * 1000;

class InMemoryPreviewSessionStore implements PreviewSessionStore {
  private readonly map = new Map<string, PreviewSession>();

  get(sessionId: string): PreviewSession | undefined {
    this.sweep();
    const session = this.map.get(sessionId);
    if (!session) return undefined;
    if (Date.now() > session.expiresAt) {
      this.map.delete(sessionId);
      return undefined;
    }
    return session;
  }

  set(sessionId: string, session: PreviewSession): void {
    this.map.set(sessionId, session);
  }

  delete(sessionId: string): void {
    this.map.delete(sessionId);
  }

  sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.map.entries()) {
      if (now > session.expiresAt) this.map.delete(id);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

export const previewSessionStore: PreviewSessionStore = new InMemoryPreviewSessionStore();

export function getLiveSession(sessionId: string): PreviewSession {
  const session = previewSessionStore.get(sessionId);
  if (!session) {
    throw new Error('Preview session not found or expired');
  }
  return session;
}
