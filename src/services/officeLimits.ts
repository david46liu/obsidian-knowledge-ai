export const HARD_LIMIT_BYTES: Record<string, number> = {
  md:   10  * 1024 * 1024,
  txt:  10  * 1024 * 1024,
  docx: 30  * 1024 * 1024,
  xlsx: 50  * 1024 * 1024,
  pptx: 100 * 1024 * 1024,
};

export const SOFT_WARN_BYTES: Record<string, number> = {
  docx: 10 * 1024 * 1024,
  xlsx: 20 * 1024 * 1024,
  pptx: 30 * 1024 * 1024,
};

export const MOBILE_HARD_LIMIT_BYTES = 10 * 1024 * 1024;

export function isOverHardLimit(ext: string, size: number, isMobile: boolean): boolean {
  if (isMobile) return size > MOBILE_HARD_LIMIT_BYTES;
  const limit = HARD_LIMIT_BYTES[ext];
  return limit !== undefined && size > limit;
}
