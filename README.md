# Visualizer

Audio-reactive visualizer for the browser (WebGL2 + Web Audio). [Live demo](https://marcus0035.github.io/Visualizer/)

## Getting started

```
npm install
npm run dev      # http://localhost:5173
npm test         # audio analysis unit tests
npm run build    # production build into dist/
```

## Desktop app

```
npm run desktop                      # build, then run desktop/visualizer.py
python3 desktop/visualizer.py --help # --dev URL, --audio FILE
```

GTK4 + WebKitGTK 6.0 (python3-gi). The visualizer fills the screen in one window; every setting is
in a second window (settings button or H), all sections at once, changes apply live. Keys in the
settings window: 1-7 section, j/k scroll, g/G top/bottom, Ctrl+W close, Ctrl+Q quit. Videos go to
~/Videos. No tab audio source (system sound: the "Monitor of ..." input).

## Audio sources
- Demo: built-in loop (no microphone needed)
- Input: microphone / line-in; system sound via a "Monitor of ..." device (PipeWire/Pulse)
- File: button or drag and drop
- Tab: shared browser tab audio (Chromium)

## Modes
1. Techno - tunnel, lasers, blocks, industrial (everything switches on the kick); settings for speed, density, flash, brightness, pattern change every 1/2/4/8 kicks
2. Oscilloscope - waveform, stereo XY, circle
3. Plasma - fluid, light bars (shader)
4. Matrix - characters, binary

Palettes: 8 dark ones with a single main color (Blood, Venom, Ultraviolet, Cobalt, Fire, Turquoise, Magenta, Gold) plus 7 originals.

Custom image (palette colors, outline, original) and text over any mode; they pulse with the bass, and the text jitters on the beat.

Full-frame filters (running through the whole track): broken monitor, VHS, datamosh, shake, kaleidoscope, pixelate, halftone, trails, night vision; strength and kick boost are adjustable.

Random (top-left button, mouse wheel down or right arrow): a completely new look (mode, variant, settings, dark palette, filter); wheel up, left arrow or the back button returns to the previous one.

Autopilot (icon at the top right or A): on every kick (or every 2 to 32 kicks) it changes the mode, variant, mode settings, and optionally the dark palette and filter; you choose what changes and which modes are used. R changes immediately.

Effects: CRT, grain, strobe and glitch on the beat. Keys: 1-4 mode, V variant, P palette, N filter, A autopilot, R change now, C/G/S/X effects, F fullscreen, H or the gear at the top right for settings (Esc closes), space play/pause.

## Structure
- `src/audio` - AudioEngine (sources, analyzers), analysis (bands, beat, log spectrum), demo loop
- `src/autopilot.ts` - automatic switching (random step, kick counting)
- `src/modes` - modes (Canvas 2D or fragment shader), palettes
- `src/overlay` - custom image and text (fonts Anton, Unbounded, UnifrakturMaguntia, Space Mono)
- `src/render` - Renderer (mode into a texture, post pass with effects and filters, previous frame for datamosh and trails), shaders, filter list
- `src/ui` - settings as a full-screen window with tabs (Audio, Mode, Colors and effects, Filters, Autopilot, Image and text, Shortcuts), toolbar at the top right
- New mode: add a file in `src/modes` implementing `Mode2D` or `ModeGL`, register it in `src/modes/index.ts`; custom settings via `params` (a GL mode receives them as float uniforms)
