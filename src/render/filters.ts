/** Full-screen filters; the index is the uFilter value in POST_FRAG. */
export const FILTERS: { name: string; icon: string; hint: string }[] = [
  { name: 'None', icon: 'Ban', hint: 'Clean picture' },
  { name: 'Broken monitor', icon: 'MonitorX', hint: 'Rolls, tears, freezes and loses signal' },
  { name: 'VHS', icon: 'Videotape', hint: 'Tape: wobble, noise, faded colors' },
  { name: 'Datamosh', icon: 'Blocks', hint: 'Blocks smear and slide on the kick' },
  { name: 'Shake', icon: 'Vibrate', hint: 'The kick shakes and zooms the picture' },
  { name: 'Kaleidoscope', icon: 'Hexagon', hint: 'Mirrored slices, slowly turning' },
  { name: 'Pixelate', icon: 'Grid3x3', hint: '8-bit: big pixels, few colors' },
  { name: 'Halftone', icon: 'CircleDot', hint: 'Print dots by brightness' },
  { name: 'Trails', icon: 'Sparkles', hint: 'Bright things leave a trail' },
  { name: 'Night vision', icon: 'ScanEye', hint: 'Green picture with noise and a scope' },
];
