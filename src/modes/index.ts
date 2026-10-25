import { arcade } from './arcade';
import { lava } from './lava';
import { matrix } from './matrix';
import { motif } from './motif';
import { oscilloscope } from './oscilloscope';
import { particles } from './particles';
import { plasma } from './plasma';
import { techno } from './techno';
import { tiles } from './tiles';
import { tv } from './tv';
import type { Mode } from './types';

/** Order defines the number-key shortcuts (1..n). */
export const MODES: Mode[] = [techno, oscilloscope, plasma, matrix, motif, lava, tv, arcade, particles, tiles];
