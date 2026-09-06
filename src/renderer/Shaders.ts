import wheelSource from '../shaders/wheel.wgsl?raw';
import textSource from '../shaders/text.wgsl?raw';
import enamel from '../shaders/enamel.wgsl?raw';
import { PALETTE } from './Geometry';

// Generate shader colors from the same palette used by the wheel geometry.
const palette = `const PALETTE_SIZE = ${PALETTE.length}u;
const ENAMEL_PALETTE = array<vec3f, ${PALETTE.length}>(
${PALETTE.map(color => `vec3f(${color.join(', ')})`).join(',\n')}
);`;

export const wheelShader = `${enamel}\n${wheelSource}`;
export const textShader = `${enamel}\n${palette}\n${textSource}`;
