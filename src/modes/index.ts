import { matrix } from './matrix';
import { oscilloscope } from './oscilloscope';
import { plasma } from './plasma';
import { techno } from './techno';
import type { Mode } from './types';

/** Order defines the number-key shortcuts (1..n). */
export const MODES: Mode[] = [techno, oscilloscope, plasma, matrix];
