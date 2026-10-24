import '@fontsource/anton';
import '@fontsource/unbounded/900.css';
import '@fontsource/unifrakturmaguntia';
import '@fontsource/space-mono/700.css';

export interface OverlayFont {
  id: string;
  name: string;
  family: string;
  weight: number;
}

export const FONTS: OverlayFont[] = [
  { id: 'anton', name: 'Anton', family: 'Anton', weight: 400 },
  { id: 'unbounded', name: 'Unbounded', family: 'Unbounded', weight: 900 },
  { id: 'gothic', name: 'Gotika', family: 'UnifrakturMaguntia', weight: 400 },
  { id: 'mono', name: 'Mono', family: 'Space Mono', weight: 700 },
];

const SIZE = 200;

/** White text on transparent background; the shader colors it from the palette. */
export async function renderText(text: string, fontId: string): Promise<HTMLCanvasElement | null> {
  const lines = text
    .split('|')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const font = FONTS.find((f) => f.id === fontId) ?? FONTS[0];
  const css = `${font.weight} ${SIZE}px "${font.family}"`;
  try {
    await document.fonts.load(css, text);
  } catch {
    // Falls back to a system font
  }

  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d')!;
  g.font = css;
  const pad = SIZE * 0.25;
  const lineH = SIZE * 1.15;
  const width = Math.max(...lines.map((l) => g.measureText(l).width));
  canvas.width = Math.ceil(width + pad * 2);
  canvas.height = Math.ceil(lineH * lines.length + pad * 2);

  g.font = css; // resizing resets the context
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, canvas.width / 2, pad + lineH * (i + 0.5)));
  return canvas;
}
