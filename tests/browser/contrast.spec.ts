import { expect, test } from '@playwright/test';

test('rendered tinted ink stays near 4.8:1 across slices, lighting, and wheel sizes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#spin-button')).toBeEnabled();
  const result = await page.evaluate(async () => {
    const shaderPath = '/src/renderer/Shaders.ts';
    const geometryPath = '/src/renderer/Geometry.ts';
    const { wheelShader, textShader } = await import(shaderPath);
    const { wheelVertices } = await import(geometryPath);
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice();
    device.pushErrorScope('validation');
    const uniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const texture = device.createTexture({ size: [64, 64], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    // Fully covered glyph interiors isolate ink contrast from edge antialiasing.
    const mask = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: mask }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
    const buffer = (data: Float32Array) => {
      const value = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(value, 0, new Float32Array(data));
      return value;
    };
    const quad = buffer(new Float32Array([-.5, -.5, .5, -.5, .5, .5, -.5, -.5, .5, .5, -.5, .5]));
    const wheelModule = device.createShaderModule({ code: wheelShader });
    const textModule = device.createShaderModule({ code: textShader });
    const wheelPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: wheelModule, entryPoint: 'vertex', buffers: [{ arrayStride: 24, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32x4' },
      ] }] },
      fragment: { module: wheelModule, entryPoint: 'fragment', targets: [{ format: 'rgba8unorm' }] },
    });
    const textPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: textModule, entryPoint: 'vertex', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
      fragment: { module: textModule, entryPoint: 'fragment', targets: [{ format: 'rgba8unorm' }] },
    });
    const wheelGroup = device.createBindGroup({ layout: wheelPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }] });
    const textGroup = device.createBindGroup({ layout: textPipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: mask.createView() },
      { binding: 2, resource: device.createSampler({ minFilter: 'linear', magFilter: 'linear' }) },
    ] });
    const readback = device.createBuffer({ size: 64 * 64 * 4 * 2, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const luminance = (pixels: Uint8Array, offset: number) => [.2126, .7152, .0722].reduce((sum, weight, channel) => {
      const v = pixels[offset + channel] / 255;
      return sum + weight * (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    }, 0);
    let minimum = Infinity, maximum = 0, samples = 0;
    for (const count of [2, 8, 9, 17, 50]) {
      const vertices = wheelVertices({ version: 'contrast', items: Array.from({ length: count }, (_, i) => ({ id: String(i), label: 'TEST', weight: 1 })) });
      const wheel = buffer(vertices);
      for (const angle of [0, 1.1, 3.4]) {
        device.queue.writeBuffer(uniform, 0, new Float32Array([angle, 1, 0, 0, count, 0, 0, 0]));
        const encoder = device.createCommandEncoder();
        const surface = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
        surface.setPipeline(wheelPipeline); surface.setBindGroup(0, wheelGroup); surface.setVertexBuffer(0, wheel); surface.draw(vertices.length / 6); surface.end();
        encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow: 256 }, [64, 64]);
        const ink = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'load', storeOp: 'store' }] });
        ink.setPipeline(textPipeline); ink.setBindGroup(0, textGroup); ink.setVertexBuffer(0, quad); ink.draw(6); ink.end();
        encoder.copyTextureToBuffer({ texture }, { buffer: readback, offset: 16384, bytesPerRow: 256 }, [64, 64]);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const pixels = new Uint8Array(readback.getMappedRange());
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
          const px = (x + .5) / 32 - 1, py = 1 - (y + .5) / 32;
          const radius = Math.hypot(px, py);
          if (radius < .25 || radius > .75) continue;
          // Exclude seams: labels occupy the interiors of their slices.
          const sector = ((Math.atan2(py, px) - angle + Math.PI * 4) % (Math.PI * 2)) / (Math.PI * 2) * count;
          if (sector % 1 < .12 || sector % 1 > .88) continue;
          const offset = (y * 64 + x) * 4;
          const ratio = (luminance(pixels, offset) + .05) / (luminance(pixels, offset + 16384) + .05);
          minimum = Math.min(minimum, ratio); maximum = Math.max(maximum, ratio); samples++;
        }
        readback.unmap();
      }
      wheel.destroy();
    }
    const error = await device.popErrorScope();
    device.destroy();
    return { minimum, maximum, samples, error: error?.message };
  });
  expect(result.error).toBeUndefined();
  expect(result.samples).toBeGreaterThan(10_000);
  expect(result.minimum).toBeGreaterThanOrEqual(4.5);
  expect(result.maximum).toBeLessThanOrEqual(5);
  console.info(`Rendered ink contrast: ${result.minimum.toFixed(2)}–${result.maximum.toFixed(2)}:1 (${result.samples} pixels)`);
});
