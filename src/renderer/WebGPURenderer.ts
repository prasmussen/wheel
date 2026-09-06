import wheelShader from "../shaders/wheel.wgsl?raw";
import pegShader from "../shaders/peg.wgsl?raw";
import pointerShader from "../shaders/pointer.wgsl?raw";
import textShader from "../shaders/text.wgsl?raw";
import type { PhysicsSnapshot } from "../physics/PhysicsEngine";
import type { WheelConfig } from "../wheel/WheelConfig";
import { circleVertices, pointerVertices, wheelVertices } from "./Geometry";
import { TAU } from "../utils/Math";

import { labelTexture, resolveLabelFont } from "./TextLabels";

const UNIFORM_SIZE = 16;

export class WebGPURenderer {
  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
    private readonly labelFont: string,
  ) {}

  onDeviceLost?: () => void;

  private readonly wheelUniformData = new Float32Array(4);
  private readonly pointerUniformData = new Float32Array(4);
  private uniform!: GPUBuffer;
  private pointerUniform!: GPUBuffer;
  private wheelBuffer!: GPUBuffer;
  private wheelCount = 0;
  private pegVertex!: GPUBuffer;
  private pegInstances!: GPUBuffer;
  private pegCount = 0;
  private pointerBuffer!: GPUBuffer;
  private pointerCount = 0;
  private textQuad!: GPUBuffer;
  private textTexture?: GPUTexture;
  private textSampler!: GPUSampler;
  private textSize = 0;
  private textDirty = true;
  private config!: WheelConfig;
  private wheelPipeline!: GPURenderPipeline;
  private pegPipeline!: GPURenderPipeline;
  private pointerPipeline!: GPURenderPipeline;
  private textPipeline!: GPURenderPipeline;
  private wheelBindGroup!: GPUBindGroup;
  private pegBindGroup!: GPUBindGroup;
  private textBindGroup!: GPUBindGroup;
  private pointerBindGroup!: GPUBindGroup;
  private multisampleTexture?: GPUTexture;
  private multisampleWidth = 0;
  private multisampleHeight = 0;

  static async create(canvas: HTMLCanvasElement, config: WheelConfig): Promise<WebGPURenderer> {
    if (!navigator.gpu) throw new Error("This browser does not support WebGPU.");
    const [adapter, labelFont] = await Promise.all([
      navigator.gpu.requestAdapter({ powerPreference: "low-power" }),
      resolveLabelFont(config),
    ]);
    if (!adapter) throw new Error("No compatible WebGPU adapter was found.");
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("Could not create a WebGPU canvas context.");
    const renderer = new WebGPURenderer(canvas, device, context, navigator.gpu.getPreferredCanvasFormat(), labelFont);
    device.pushErrorScope("validation");
    try {
      renderer.initialize(config);
      const error = await device.popErrorScope();
      if (error) throw new Error(error.message);
    } catch (error) {
      renderer.destroy();
      throw error;
    }
    void device.lost.then(info => { if (info.reason !== "destroyed") renderer.onDeviceLost?.(); });
    return renderer;
  }

  private initialize(config: WheelConfig): void {
    this.context.configure({ device: this.device, format: this.format, alphaMode: "premultiplied" });
    this.uniform = this.device.createBuffer({ label:"wheel-state", size:UNIFORM_SIZE, usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });
    this.pointerUniform = this.device.createBuffer({ label:"pointer-state", size:UNIFORM_SIZE, usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });
    const wheelModule=this.device.createShaderModule({code:wheelShader});
    const pegModule=this.device.createShaderModule({code:pegShader});
    const pointerModule=this.device.createShaderModule({code:pointerShader});
    const textModule=this.device.createShaderModule({code:textShader});
    const target={format:this.format,blend:{color:{srcFactor:"src-alpha" as GPUBlendFactor,dstFactor:"one-minus-src-alpha" as GPUBlendFactor,operation:"add" as GPUBlendOperation},alpha:{srcFactor:"one" as GPUBlendFactor,dstFactor:"one-minus-src-alpha" as GPUBlendFactor,operation:"add" as GPUBlendOperation}}};
    const multisample={count:4};
    this.wheelPipeline=this.device.createRenderPipeline({layout:"auto",vertex:{module:wheelModule,entryPoint:"vertex",buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:"float32x2"},{shaderLocation:1,offset:8,format:"float32x4"}]}]},fragment:{module:wheelModule,entryPoint:"fragment",targets:[target]},primitive:{topology:"triangle-list"},multisample});
    this.pegPipeline=this.device.createRenderPipeline({layout:"auto",vertex:{module:pegModule,entryPoint:"vertex",buffers:[{arrayStride:8,attributes:[{shaderLocation:0,offset:0,format:"float32x2"}]},{arrayStride:4,stepMode:"instance",attributes:[{shaderLocation:1,offset:0,format:"float32"}]}]},fragment:{module:pegModule,entryPoint:"fragment",targets:[target]},primitive:{topology:"triangle-list"},multisample});
    this.pointerPipeline=this.device.createRenderPipeline({layout:"auto",vertex:{module:pointerModule,entryPoint:"vertex",buffers:[{arrayStride:28,attributes:[{shaderLocation:0,offset:0,format:"float32x2"},{shaderLocation:1,offset:8,format:"float32x4"},{shaderLocation:2,offset:24,format:"float32"}]}]},fragment:{module:pointerModule,entryPoint:"fragment",targets:[target]},primitive:{topology:"triangle-list"},multisample});
    this.textPipeline=this.device.createRenderPipeline({layout:"auto",vertex:{module:textModule,entryPoint:"vertex",buffers:[{arrayStride:8,attributes:[{shaderLocation:0,offset:0,format:"float32x2"}]}]},fragment:{module:textModule,entryPoint:"fragment",targets:[target]},primitive:{topology:"triangle-list"},multisample});
    this.wheelBindGroup=this.device.createBindGroup({layout:this.wheelPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}}]});
    this.pegBindGroup=this.device.createBindGroup({layout:this.pegPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}}]});
    this.textSampler=this.device.createSampler({minFilter:"linear",magFilter:"linear"});
    this.pointerBindGroup=this.device.createBindGroup({layout:this.pointerPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.pointerUniform}}]});
    this.textQuad=this.buffer(new Float32Array([-.5,-.5,.5,-.5,.5,.5,-.5,-.5,.5,.5,-.5,.5]),GPUBufferUsage.VERTEX);
    const pegGeometry=circleVertices(.027, 32);
    this.pegVertex=this.buffer(pegGeometry,GPUBufferUsage.VERTEX);
    const pointer=pointerVertices();
    this.pointerBuffer=this.buffer(pointer,GPUBufferUsage.VERTEX); this.pointerCount=pointer.length/7;
    this.updateConfig(config);
  }

  updateConfig(config: WheelConfig): void {
    const vertices=wheelVertices(config);
    this.wheelBuffer?.destroy(); this.wheelBuffer=this.buffer(vertices,GPUBufferUsage.VERTEX); this.wheelCount=vertices.length/6;
    const pegs=new Float32Array(config.items.length);
    for(let i=0;i<pegs.length;i++) pegs[i]=i/pegs.length*TAU;
    this.pegInstances?.destroy(); this.pegInstances=this.buffer(pegs,GPUBufferUsage.VERTEX); this.pegCount=pegs.length;
    this.config = config;
    this.invalidateLabels();
  }

  render(state: PhysicsSnapshot, charge: number): void {
    this.resize();
    this.updateLabels();
    const aspect=this.canvas.width/this.canvas.height;
    this.wheelUniformData[0]=state.wheel.angle; this.pointerUniformData[0]=state.pointer.angle;
    this.wheelUniformData[1]=this.pointerUniformData[1]=aspect;
    this.wheelUniformData[2]=this.pointerUniformData[2]=charge;
    this.wheelUniformData[3]=this.pointerUniformData[3]=state.lastImpact;
    this.device.queue.writeBuffer(this.uniform,0,this.wheelUniformData);
    this.device.queue.writeBuffer(this.pointerUniform,0,this.pointerUniformData);
    const encoder=this.device.createCommandEncoder();
    const pass=encoder.beginRenderPass({colorAttachments:[{view:this.multisampleTexture!.createView(),resolveTarget:this.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"discard"}]});
    pass.setPipeline(this.wheelPipeline); pass.setBindGroup(0,this.wheelBindGroup); pass.setVertexBuffer(0,this.wheelBuffer); pass.draw(this.wheelCount);
    pass.setPipeline(this.textPipeline); pass.setBindGroup(0,this.textBindGroup); pass.setVertexBuffer(0,this.textQuad); pass.draw(6);
    pass.setPipeline(this.pegPipeline); pass.setBindGroup(0,this.pegBindGroup); pass.setVertexBuffer(0,this.pegVertex); pass.setVertexBuffer(1,this.pegInstances); pass.draw(96,this.pegCount);
    pass.setPipeline(this.pointerPipeline); pass.setBindGroup(0,this.pointerBindGroup); pass.setVertexBuffer(0,this.pointerBuffer); pass.draw(this.pointerCount);
    pass.end(); this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.onDeviceLost = undefined;
    this.multisampleTexture?.destroy();
    this.textTexture?.destroy();
    this.context.unconfigure();
    this.device.destroy();
  }

  invalidateLabels(): void { this.textDirty = true; }

  private updateLabels(): void {
    // Oversample for crisp rotated text, with a bounded GPU allocation.
    const size = Math.min(4096, this.device.limits.maxTextureDimension2D,
      Math.max(512, Math.ceil(Math.min(this.canvas.width, this.canvas.height) * 1.5)));
    if (!this.textDirty && size === this.textSize) return;
    const source = labelTexture(this.config, size, this.labelFont);
    if (size !== this.textSize) {
      this.textTexture?.destroy();
      this.textTexture = this.device.createTexture({size:[size,size],format:"rgba8unorm",
        usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
      this.textSize = size;
      this.textBindGroup = this.device.createBindGroup({layout:this.textPipeline.getBindGroupLayout(0),entries:[
        {binding:0,resource:{buffer:this.uniform}},
        {binding:1,resource:this.textTexture.createView()},
        {binding:2,resource:this.textSampler},
      ]});
    }
    this.device.queue.copyExternalImageToTexture({source}, {texture:this.textTexture!,premultipliedAlpha:false}, [size,size]);
    this.textDirty = false;
  }

  private resize(): void {
    const ratio=Math.min(devicePixelRatio,2);
    const width=Math.max(1,Math.floor(this.canvas.clientWidth*ratio)),height=Math.max(1,Math.floor(this.canvas.clientHeight*ratio));
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    if(this.multisampleWidth!==width||this.multisampleHeight!==height){
      this.multisampleTexture?.destroy();
      this.multisampleTexture=this.device.createTexture({size:[width,height],sampleCount:4,format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT});
      this.multisampleWidth=width;this.multisampleHeight=height;
    }
  }
  private buffer(data:Float32Array<ArrayBufferLike>|Uint8Array<ArrayBuffer>,usage:GPUBufferUsageFlags):GPUBuffer {
    const buffer=this.device.createBuffer({size:Math.max(4,(data.byteLength+3)&~3),usage:usage|GPUBufferUsage.COPY_DST});
    this.device.queue.writeBuffer(buffer,0,data.buffer as ArrayBuffer,data.byteOffset,data.byteLength); return buffer;
  }
}
