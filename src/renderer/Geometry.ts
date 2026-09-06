import { TAU } from "../utils/Math";
import type { WheelConfig } from "../wheel/WheelConfig";

const PALETTE = [
  [0.96, 0.30, 0.25], [0.98, 0.62, 0.15], [0.17, 0.73, 0.60], [0.17, 0.55, 0.92],
  [0.48, 0.34, 0.91], [0.88, 0.27, 0.58], [0.34, 0.76, 0.32], [0.10, 0.68, 0.79],
];

function vertex(out: number[], x: number, y: number, color: readonly number[], alpha = 1): void {
  out.push(x, y, color[0], color[1], color[2], alpha);
}

function triangle(out: number[], a: number[], b: number[], c: number[], color: readonly number[], alpha = 1): void {
  vertex(out, a[0], a[1], color, alpha); vertex(out, b[0], b[1], color, alpha); vertex(out, c[0], c[1], color, alpha);
}

function quad(out:number[],a:number[],b:number[],c:number[],d:number[],color:readonly number[]):void {
  triangle(out,a,b,c,color); triangle(out,a,c,d,color);
}

// Shared machined finishes keep the housing, bearing, and pointer in one family.
const GRAPHITE = [0.105, 0.125, 0.16];
const EDGE = [0.48, 0.53, 0.60];
const SILVER = [0.73, 0.77, 0.82];

function disc(out: number[], radius: number, color: readonly number[], x = 0, y = 0, alpha = 1): void {
  const sides = 256;
  for (let i = 0; i < sides; i++) {
    const a = i / sides * TAU, b = (i + 1) / sides * TAU;
    triangle(out, [x, y], [x + Math.cos(a) * radius, y + Math.sin(a) * radius],
      [x + Math.cos(b) * radius, y + Math.sin(b) * radius], color, alpha);
  }
}

export function wheelVertices(config: WheelConfig): Float32Array {
  const out: number[] = [];
  const count = config.items.length;
  const subdivisions = Math.max(8, Math.ceil(256 / count));
  // A restrained case: rolled outer edge, recessed graphite track, inner lip.
  disc(out, .908, [0.025, 0.032, 0.045]);
  disc(out, .901, EDGE);
  disc(out, .895, GRAPHITE);
  disc(out, .855, [0.075, 0.09, 0.12]);
  disc(out, .846, [0.25, 0.29, 0.35]);
  disc(out, .84, [0.035, 0.044, 0.06]);
  for (let index = 0; index < count; index++) {
    const color = PALETTE[index % PALETTE.length];
    const start = index / count * TAU;
    for (let part = 0; part < subdivisions; part++) {
      const a = start + part / subdivisions * TAU / count;
      const b = start + (part + 1) / subdivisions * TAU / count;
      triangle(out, [0,0], [Math.cos(a)*0.82, Math.sin(a)*0.82], [Math.cos(b)*0.82, Math.sin(b)*0.82], color);
    }
    // Fine seams give the enamel sectors a crisp, deliberate meeting point.
    const seam = .0013;
    triangle(out, [0, 0], [Math.cos(start - seam) * .82, Math.sin(start - seam) * .82],
      [Math.cos(start + seam) * .82, Math.sin(start + seam) * .82], [0.035, 0.044, 0.06], .28);
  }
  // The bearing repeats the case's thin edge and inset dark face.
  for (let i = 8; i > 0; i--) disc(out, .126 + i * .0025, [0.015, 0.02, 0.03], 0, 0, .035);
  disc(out, .128, [0.035, 0.044, 0.06]);
  disc(out, .12, SILVER);
  disc(out, .113, EDGE);
  disc(out, .105, GRAPHITE);
  disc(out, .086, [0.16, 0.185, 0.225]);
  disc(out, .082, [0.095, 0.115, 0.15]);
  disc(out, .018, [0.045, 0.06, 0.08]);
  disc(out, .012, EDGE);
  return new Float32Array(out);
}

export function circleVertices(radius: number, sides = 14): Float32Array {
  const out: number[]=[];
  for(let i=0;i<sides;i++) out.push(0,0, Math.cos(i/sides*TAU)*radius,Math.sin(i/sides*TAU)*radius, Math.cos((i+1)/sides*TAU)*radius,Math.sin((i+1)/sides*TAU)*radius);
  return new Float32Array(out);
}

/** Tapered satin-metal spring, centered on the physical hinge. */
export function pointerVertices(): Float32Array {
  const out: number[] = [];
  // Dark edge, silver bevel, inset graphite spine, and rounded contact tip.
  quad(out, [-.025,.004], [.025,.004], [.010,-.145], [-.010,-.145], GRAPHITE);
  quad(out, [-.021,.004], [.021,.004], [.007,-.145], [-.007,-.145], SILVER);
  quad(out, [-.011,-.015], [.011,-.015], [.003,-.122], [-.003,-.122], GRAPHITE);
  disc(out, .011, SILVER, 0, -.145);
  const movingVertexCount = out.length / 6;
  // The hinge cap is fixed to the housing; only the spring rotates beneath it.
  disc(out, .036, [0.035, 0.044, 0.06], 0, .004);
  disc(out, .031, EDGE, 0, .004);
  disc(out, .026, GRAPHITE, 0, .004);
  disc(out, .012, [0.045, 0.06, 0.08], 0, .004);
  disc(out, .008, SILVER, 0, .004);
  const vertices = new Float32Array(out.length / 6 * 7);
  for (let index = 0; index < out.length / 6; index++) {
    vertices.set(out.slice(index * 6, index * 6 + 6), index * 7);
    vertices[index * 7 + 6] = index < movingVertexCount ? 1 : 0;
  }
  return vertices;
}
