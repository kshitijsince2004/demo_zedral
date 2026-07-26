/** SHA-256 hex digest of raw frame bytes (reuse detection). */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = bytes instanceof Uint8Array
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : bytes;
  const digest = await crypto.subtle.digest('SHA-256', buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Grayscale → threshold → upscale ×3 for LCD/LED displays. */
export function preprocessWeightFrame(
  source: HTMLCanvasElement,
  opts?: { threshold?: number; invert?: boolean; scale?: number },
): HTMLCanvasElement {
  const threshold = opts?.threshold ?? 140;
  const invert = opts?.invert ?? false;
  const scale = opts?.scale ?? 3;

  const srcCtx = source.getContext('2d');
  if (!srcCtx) return source;

  const { width, height } = source;
  const src = srcCtx.getImageData(0, 0, width, height);
  const out = new ImageData(width, height);

  for (let i = 0; i < src.data.length; i += 4) {
    const gray = 0.299 * src.data[i] + 0.587 * src.data[i + 1] + 0.114 * src.data[i + 2];
    let v = gray >= threshold ? 255 : 0;
    if (invert) v = 255 - v;
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }

  const mid = document.createElement('canvas');
  mid.width = width;
  mid.height = height;
  mid.getContext('2d')!.putImageData(out, 0, 0);

  const scaled = document.createElement('canvas');
  scaled.width = width * scale;
  scaled.height = height * scale;
  const sctx = scaled.getContext('2d')!;
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(mid, 0, 0, scaled.width, scaled.height);
  return scaled;
}

export function canvasToJpegBase64(canvas: HTMLCanvasElement, quality = 0.92): string {
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
}
