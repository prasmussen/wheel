export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function wrapAngle(angle: number): number {
  angle %= TAU;
  return angle < 0 ? angle + TAU : angle;
}

export function signedAngle(angle: number): number {
  const wrapped = wrapAngle(angle + Math.PI) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
