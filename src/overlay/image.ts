// User image for the overlay: downscaled once, kept as a canvas for GPU upload and a data URL for storage.

const MAX_SIDE = 1280;
const STORE_KEY = 'visualizer.image.v1';

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

async function fromBlob(blob: Blob): Promise<OverlayImage> {
  const bitmap = await createImageBitmap(blob);
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * k));
  canvas.height = Math.max(1, Math.round(bitmap.height * k));
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { canvas, hasAlpha: hasTransparency(g, canvas.width, canvas.height) };
}

export async function loadImageFile(file: File): Promise<OverlayImage> {
  const img = await fromBlob(file);
  try {
    const url = img.hasAlpha ? img.canvas.toDataURL('image/png') : img.canvas.toDataURL('image/jpeg', 0.85);
    localStorage.setItem(STORE_KEY, url);
  } catch {
    // Too big for storage or storage blocked: image just won't survive a reload
    forgetImage();
  }
  return img;
}

export async function restoreImage(): Promise<OverlayImage | null> {
  try {
    const url = localStorage.getItem(STORE_KEY);
    if (!url) return null;
    return await fromBlob(await (await fetch(url)).blob());
  } catch {
    return null;
  }
}

export function forgetImage(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // Not critical
  }
}
