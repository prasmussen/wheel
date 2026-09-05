import { TAU } from "../utils/Math";
import type { WheelConfig } from "../wheel/WheelConfig";

const PALETTE = [
  [0.96, 0.30, 0.25], [0.98, 0.62, 0.15], [0.17, 0.73, 0.60], [0.17, 0.55, 0.92],
  [0.48, 0.34, 0.91], [0.88, 0.27, 0.58], [0.34, 0.76, 0.32], [0.10, 0.68, 0.79],
];

type Glyphs = Record<string, string[]>;
const FONT: Glyphs = {
  A:["01110","10001","10001","11111","10001","10001","10001"], B:["11110","10001","11110","10001","10001","10001","11110"],
  C:["01111","10000","10000","10000","10000","10000","01111"], D:["11110","10001","10001","10001","10001","10001","11110"],
  E:["11111","10000","11110","10000","10000","10000","11111"], F:["11111","10000","11110","10000","10000","10000","10000"],
  G:["01111","10000","10000","10111","10001","10001","01111"], H:["10001","10001","10001","11111","10001","10001","10001"],
  I:["11111","00100","00100","00100","00100","00100","11111"], J:["00111","00010","00010","00010","10010","10010","01100"],
  K:["10001","10010","10100","11000","10100","10010","10001"], L:["10000","10000","10000","10000","10000","10000","11111"],
  M:["10001","11011","10101","10101","10001","10001","10001"], N:["10001","11001","10101","10011","10001","10001","10001"],
  O:["01110","10001","10001","10001","10001","10001","01110"], P:["11110","10001","10001","11110","10000","10000","10000"],
  Q:["01110","10001","10001","10001","10101","10010","01101"], R:["11110","10001","10001","11110","10100","10010","10001"],
  S:["01111","10000","10000","01110","00001","00001","11110"], T:["11111","00100","00100","00100","00100","00100","00100"],
  U:["10001","10001","10001","10001","10001","10001","01110"], V:["10001","10001","10001","10001","10001","01010","00100"],
  W:["10001","10001","10001","10101","10101","10101","01010"], X:["10001","10001","01010","00100","01010","10001","10001"],
  Y:["10001","10001","01010","00100","00100","00100","00100"], Z:["11111","00001","00010","00100","01000","10000","11111"],
  "0":["01110","10011","10101","10101","11001","10001","01110"], "1":["00100","01100","00100","00100","00100","00100","01110"],
  "2":["01110","10001","00001","00010","00100","01000","11111"], "3":["11110","00001","00001","01110","00001","00001","11110"],
  "4":["00010","00110","01010","10010","11111","00010","00010"], "5":["11111","10000","10000","11110","00001","00001","11110"],
  "6":["01110","10000","10000","11110","10001","10001","01110"], "7":["11111","00001","00010","00100","01000","01000","01000"],
  "8":["01110","10001","10001","01110","10001","10001","01110"], "9":["01110","10001","10001","01111","00001","00001","01110"],
  "-":["00000","00000","00000","11111","00000","00000","00000"], " ":["00000","00000","00000","00000","00000","00000","00000"],
  "?":["01110","10001","00010","00100","00100","00000","00100"],
};

function vertex(out: number[], x: number, y: number, color: readonly number[], alpha = 1): void {
  out.push(x, y, color[0], color[1], color[2], alpha);
}

function triangle(out: number[], a: number[], b: number[], c: number[], color: readonly number[], alpha = 1): void {
  vertex(out, a[0], a[1], color, alpha); vertex(out, b[0], b[1], color, alpha); vertex(out, c[0], c[1], color, alpha);
}

function quad(out:number[],a:number[],b:number[],c:number[],d:number[],color:readonly number[]):void {
  triangle(out,a,b,c,color); triangle(out,a,c,d,color);
}

export function wheelVertices(config: WheelConfig): Float32Array {
  const out: number[] = [];
  const count = config.items.length;
  const subdivisions = Math.max(5, Math.ceil(28 / count));
  const dark = [0.055, 0.065, 0.09];
  for (let i = 0; i < 96; i++) {
    const a = i / 96 * TAU, b = (i + 1) / 96 * TAU;
    triangle(out, [0,0], [Math.cos(a)*0.9, Math.sin(a)*0.9], [Math.cos(b)*0.9, Math.sin(b)*0.9], dark);
  }
  for (let index = 0; index < count; index++) {
    const color = PALETTE[index % PALETTE.length];
    const start = index / count * TAU;
    for (let part = 0; part < subdivisions; part++) {
      const a = start + part / subdivisions * TAU / count;
      const b = start + (part + 1) / subdivisions * TAU / count;
      triangle(out, [0,0], [Math.cos(a)*0.82, Math.sin(a)*0.82], [Math.cos(b)*0.82, Math.sin(b)*0.82], color);
    }
  }
  // Hub rings are layered last.
  for (let i = 0; i < 48; i++) {
    const a=i/48*TAU,b=(i+1)/48*TAU;
    triangle(out,[0,0],[Math.cos(a)*.13,Math.sin(a)*.13],[Math.cos(b)*.13,Math.sin(b)*.13],[.85,.88,.92]);
    triangle(out,[0,0],[Math.cos(a)*.085,Math.sin(a)*.085],[Math.cos(b)*.085,Math.sin(b)*.085],[.12,.14,.18]);
  }
  return new Float32Array(out);
}

export interface TextGeometry { instances: Uint8Array<ArrayBuffer>; count: number }

export function textGeometry(config: WheelConfig): TextGeometry {
  const records: Array<{x:number;y:number;angle:number;size:number;low:number;high:number}>=[];
  const count = config.items.length;
  config.items.forEach((item, index) => {
    const label = item.label.toUpperCase().slice(0, count > 20 ? 8 : 14);
    const mid = (index + 0.5) / count * TAU;
    // Keep every label on the same radial convention: read from hub to rim.
    const orientation = mid;
    const size = Math.min(0.012, 0.09 / Math.max(7, label.length), 0.2 / count);
    const width = label.length * 6 * size;
    for (let charIndex=0; charIndex<label.length; charIndex++) {
      const glyph = FONT[label[charIndex]] ?? FONT["?"];
      let low=0,high=0;
      glyph.forEach((row,y)=>[...row].forEach((bit,x)=>{
        if(bit!=="1")return; const bitIndex=y*5+x;
        if(bitIndex<32)low=(low|(1<<bitIndex))>>>0; else high=(high|(1<<(bitIndex-32)))>>>0;
      }));
      const offset=(charIndex+.5)*6*size-width/2;
      records.push({x:Math.cos(mid)*.48+Math.cos(orientation)*offset,y:Math.sin(mid)*.48+Math.sin(orientation)*offset,angle:orientation,size,low,high});
    }
  });
  const buffer=new ArrayBuffer(records.length*24); const view=new DataView(buffer);
  records.forEach((record,index)=>{const offset=index*24;view.setFloat32(offset,record.x,true);view.setFloat32(offset+4,record.y,true);view.setFloat32(offset+8,record.angle,true);view.setFloat32(offset+12,record.size,true);view.setUint32(offset+16,record.low,true);view.setUint32(offset+20,record.high,true);});
  return {instances:new Uint8Array(buffer),count:records.length};
}

export function circleVertices(radius: number, sides = 14): Float32Array {
  const out: number[]=[];
  for(let i=0;i<sides;i++) out.push(0,0, Math.cos(i/sides*TAU)*radius,Math.sin(i/sides*TAU)*radius, Math.cos((i+1)/sides*TAU)*radius,Math.sin((i+1)/sides*TAU)*radius);
  return new Float32Array(out);
}

/** Minimal spring pointer geometry, centered on its hinge at (0, 0). */
export function pointerVertices(): Float32Array {
  const out:number[]=[];
  // One quiet, flat spring leaf. Its silhouette does the work without trim.
  quad(out,[-.023,.004],[.023,.004],[.007,-.145],[-.007,-.145],[.57,.25,.23]);
  // A small matte contact bead sits directly on the peg circle.
  for(let i=0;i<18;i++){
    const a=i/18*TAU,b=(i+1)/18*TAU;
    triangle(out,[0,-.145],[Math.cos(a)*.014,Math.sin(a)*.014-.145],[Math.cos(b)*.014,Math.sin(b)*.014-.145],[.53,.56,.61]);
  }
  // A single compact hinge with an understated center fastener.
  for(let i=0;i<24;i++){
    const a=i/24*TAU,b=(i+1)/24*TAU;
    triangle(out,[0,.004],[Math.cos(a)*.032,Math.sin(a)*.032+.004],[Math.cos(b)*.032,Math.sin(b)*.032+.004],[.31,.34,.39]);
    triangle(out,[0,.004],[Math.cos(a)*.009,Math.sin(a)*.009+.004],[Math.cos(b)*.009,Math.sin(b)*.009+.004],[.12,.14,.18]);
  }
  return new Float32Array(out);
}
