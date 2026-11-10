// User image for the overlay: downscaled once, kept as a canvas for GPU upload and a data URL for storage.

const MAX_SIDE = 1280;
/** Stored copy is smaller so it fits the localStorage quota */
const STORE_SIDE = 800;
const STORE_KEY = 'visualizer.image.v1';
/** Set when the user removed the image, so the default one does not come back */
const REMOVED_KEY = 'visualizer.image.removed';
/** Shown until the user picks an image of their own */
const DEFAULT_IMAGE = `${import.meta.env.BASE_URL}default.jpg`;

export interface OverlayImage {
  canvas: HTMLCanvasElement;
  /** Has real transparency (logo PNG): use its alpha as the mask instead of feathered edges */
  hasAlpha: boolean;
}

function hasTransparency(g: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = g.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4 * 7) if (data[i] < 250) return true;
  return false;
}

/** Decode via an <img>: works for SVG (which createImageBitmap rejects in Chromium). */
async function decodeWithElement(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // SVG without intrinsic size reports 0x0
    if (!img.naturalWidth || !img.naturalHeight) {
      img.width = img.height = MAX_SIDE;
    }
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawScaled(source: CanvasImageSource, w: number, h: number, maxSide: number): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function fromBlob(blob: Blob): Promise<OverlayImage> {
  let canvas: HTMLCanvasElement;
  if (blob.type === 'image/svg+xml') {
    const img = await decodeWithElement(blob);
    canvas = drawScaled(img, img.naturalWidth || img.width, img.naturalHeight || img.height, MAX_SIDE);
  } else {
    const bitmap = await createImageBitmap(blob);
    canvas = drawScaled(bitmap, bitmap.width, bitmap.height, MAX_SIDE);
    bitmap.close();
  }
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  return { canvas, hasAlpha: hasTransparency(g, canvas.width, canvas.height) };
}

/** Load a user image. `saved` is false when it could not be kept for the next start. */
export async function loadImageFile(file: File): Promise<{ image: OverlayImage; saved: boolean }> {
  const image = await fromBlob(file);
  const small = drawScaled(image.canvas, image.canvas.width, image.canvas.height, STORE_SIDE);
  try {
    const url = image.hasAlpha ? small.toDataURL('image/png') : small.toDataURL('image/jpeg', 0.85);
    localStorage.setItem(STORE_KEY, url);
    localStorage.removeItem(REMOVED_KEY);
    return { image, saved: true };
  } catch {
    // Too big for storage or storage blocked: drop the old one so it does not come back
    forgetImage();
    return { image, saved: false };
  }
}

export async function restoreImage(): Promise<OverlayImage | null> {
  try {
    const url = localStorage.getItem(STORE_KEY) ?? (localStorage.getItem(REMOVED_KEY) ? null : DEFAULT_IMAGE);
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await fromBlob(await res.blob());
  } catch {
    return null;
  }
}

/** Data URL of the stored image (null: none of the user's own) */
export function storedImage(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

/** Keep a preset's image for restoreImage(); null means the look has no image. */
export function storeImage(url: string | null): void {
  try {
    if (url) {
      localStorage.setItem(STORE_KEY, url);
      localStorage.removeItem(REMOVED_KEY);
    } else forgetImage(true);
  } catch {
    // Too big or storage blocked: the image is not kept
  }
}

/** Back to the built-in image: forget the stored one and the "removed" mark. */
export async function resetToDefaultImage(): Promise<OverlayImage | null> {
  try {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(REMOVED_KEY);
  } catch {
    // Not critical
  }
  return restoreImage();
}

/** `removed`: the user took the image away, so the default one stays away too. */
export function forgetImage(removed = false): void {
  try {
    localStorage.removeItem(STORE_KEY);
    if (removed) localStorage.setItem(REMOVED_KEY, '1');
  } catch {
    // Not critical
  }
}
