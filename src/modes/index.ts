import { interstellar } from './interstellar';
import { matrix } from './matrix';
import { oscilloscope } from './oscilloscope';
import { plasma } from './plasma';
import { spectrum } from './spectrum';
import type { Mode } from './types';

/** Order defines the number-key shortcuts (1..n). */
export const MODES: Mode[] = [oscilloscope, spectrum, plasma, matrix, interstellar];
