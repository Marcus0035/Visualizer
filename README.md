# Visualizer

Audio-reaktivni vizualizer v prohlizeci (WebGL2 + Web Audio), inspirovany Visual Lab Pro.

## Spusteni

```
npm install
npm run dev      # http://localhost:5173
npm test         # unit testy analyzy zvuku
npm run build    # produkcni build do dist/
```

## Zdroje zvuku
- Demo: vestavena smycka (bez mikrofonu)
- Vstup: mikrofon / line-in; zvuk systemu pres zarizeni "Monitor of ..." (PipeWire/Pulse)
- Soubor: tlacitko nebo drag and drop
- Karta: sdileny zvuk karty prohlizece (Chromium)

## Rezimy (verze 0.1)
1. Osciloskop - vlna, stereo XY, kruh
2. Spektrum - sloupce, zrcadlo, minimal (60. leta)
3. Plasma - tekuta, svetelne tyce (shader)
4. Matrix - znaky, binarni
5. Interstellar - hvezdne pole, warp

Efekty: CRT, zrno, strobe na beat. Klavesy: 1-5 rezim, V varianta, P paleta, C/G/S efekty, F cela obrazovka, H panel, mezernik play/pauza.

## Struktura
- `src/audio` - AudioEngine (zdroje, analyzery), analysis (pasma, beat, log spektrum), demo smycka
- `src/modes` - rezimy (Canvas 2D nebo fragment shader), palety
- `src/render` - Renderer (rezim do textury, post pass s efekty), shadery
- `src/ui` - panel ovladani
- Novy rezim: soubor v `src/modes` implementujici `Mode2D` nebo `ModeGL`, pridat do `src/modes/index.ts`
