export function computeTargetDimensions(w: number, h: number, maxLong: number): { w: number; h: number } | null {
  const long = Math.max(w, h);
  if (long <= maxLong) return null;
  const scale = maxLong / long;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/**
 * Resize the image to have its long edge at most `maxLong` pixels and re-encode to JPEG.
 * If the image is already small enough, returns the original bytes unchanged.
 * Uses `createImageBitmap` + `OffscreenCanvas` (available in modern browsers / Electron).
 */
export async function resizeImageBytes(
  bytes: ArrayBuffer,
  mimeType: string,
  maxLong = 1568,
  quality = 0.85,
): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const blob = new Blob([bytes], { type: mimeType });
  const bitmap = await createImageBitmap(blob);
  const target = computeTargetDimensions(bitmap.width, bitmap.height, maxLong);
  if (!target) {
    bitmap.close();
    return { bytes, mimeType };
  }
  const canvas = new OffscreenCanvas(target.w, target.h);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return { bytes, mimeType };
  }
  ctx.drawImage(bitmap, 0, 0, target.w, target.h);
  bitmap.close();
  const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  const outBuf = await outBlob.arrayBuffer();
  return { bytes: outBuf, mimeType: 'image/jpeg' };
}
