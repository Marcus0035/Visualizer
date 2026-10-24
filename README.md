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

## Rezimy
1. Techno - tunel, lasery, bloky, industrial (vse se prepina na kick); nastaveni rychlost, hustota, zablesk, jas, zmena vzoru po 1/2/4/8 kicich
2. Osciloskop - vlna, stereo XY, kruh
3. Plasma - tekuta, svetelne tyce (shader)
4. Matrix - znaky, binarni

Palety: 8 tmavych s jednou hlavni barvou (Krev, Jed, Ultrafialova, Kobalt, Ohen, Tyrkys, Magenta, Zlato) + 7 puvodnich.

Vlastni obrazek (barvy palety, obrys, original) a text pres jakykoli rezim; pulzuji s basy, text se na beat trha.

Filtry pres cely obraz (jako v CapCutu, bezi celou skladbu): rozbity monitor, VHS, datamosh, otresy, kaleidoskop, pixelace, rastr, stopy, nocni videni; sila a zesileni na kick.

Nahodne (tlacitko vlevo nahore, kolecko mysi dolu nebo sipka vpravo): uplne novy vizual (rezim, varianta, nastaveni, tmava paleta, filtr); kolecko nahoru, sipka vlevo nebo tlacitko zpet vrati predchozi.

Autopilot (ikona vpravo nahore nebo A): na kazdy kick (nebo po 2 az 32 kicich) sam meni rezim, variantu, nastaveni rezimu, pripadne tmavou paletu a filtr; co se meni a ktere rezimy se pouzivaji jde vybrat. R zmeni hned.

Efekty: CRT, zrno, strobe a glitch na beat. Klavesy: 1-4 rezim, V varianta, P paleta, N filtr, A autopilot, R zmenit hned, C/G/S/X efekty, F cela obrazovka, H nebo ozubene kolo vpravo nahore nastaveni (Esc zavre), mezernik play/pauza.

## Struktura
- `src/audio` - AudioEngine (zdroje, analyzery), analysis (pasma, beat, log spektrum), demo smycka
- `src/autopilot.ts` - automaticke stridani (nahodny krok, pocitani kicku)
- `src/modes` - rezimy (Canvas 2D nebo fragment shader), palety
- `src/overlay` - vlastni obrazek a text (fonty Anton, Unbounded, UnifrakturMaguntia, Space Mono)
- `src/render` - Renderer (rezim do textury, post pass s efekty a filtry, predchozi snimek pro datamosh a stopy), shadery, seznam filtru
- `src/ui` - nastaveni jako okno pres celou obrazovku se zalozkami (Zvuk, Rezim, Barvy a efekty, Filtry, Autopilot, Obrazek a text, Zkratky), nastrojova lista vpravo nahore
- Novy rezim: soubor v `src/modes` implementujici `Mode2D` nebo `ModeGL`, pridat do `src/modes/index.ts`; vlastni nastaveni pres `params` (GL rezim je dostane jako float uniformy)
