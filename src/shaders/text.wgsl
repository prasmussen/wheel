struct Uniforms { wheel_angle: f32, aspect: f32, charge: f32, impact: f32, segment_count: f32 }
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var labels: texture_2d<f32>;
@group(0) @binding(2) var label_sampler: sampler;
struct Output { @builtin(position) position: vec4f, @location(0) uv: vec2f }
const TARGET_CONTRAST = 4.8;

fn linear_rgb(color: vec3f) -> vec3f {
  return select(pow((color + .055) / 1.055, vec3f(2.4)), color / 12.92, color <= vec3f(.04045));
}

fn srgb(color: vec3f) -> vec3f {
  return select(1.055 * pow(color, vec3f(1.0 / 2.4)) - .055, color * 12.92, color <= vec3f(.0031308));
}

@vertex fn vertex(@location(0) corner: vec2f) -> Output {
  let local = corner * 2.0;
  let c = cos(u.wheel_angle);
  let s = sin(u.wheel_angle);
  let p = vec2f(local.x * c - local.y * s, local.x * s + local.y * c);
  let pulse = 1.0 + u.impact * .004;
  var output: Output;
  output.position = vec4f(vec2f(p.x / u.aspect, p.y) * min(u.aspect, 1.0) * pulse, 0.0, 1.0);
  output.uv = vec2f(corner.x + .5, .5 - corner.y);
  return output;
}

@fragment fn fragment(input: Output) -> @location(0) vec4f {
  let glyph = textureSample(labels, label_sampler, input.uv);
  let local = vec2f(input.uv.x - .5, .5 - input.uv.y) * 2.0;
  let tau = 6.28318530718;
  let angle = (atan2(local.y, local.x) + tau) % tau;
  let count = u32(u.segment_count);
  let index = min(u32(angle / tau * u.segment_count), count - 1u);
  var palette_index = index % PALETTE_SIZE;
  // Match the alternate closing slice used by the wheel geometry.
  if (index == count - 1u && palette_index == 0u) { palette_index = 1u; }
  let c = cos(u.wheel_angle);
  let s = sin(u.wheel_angle);
  let rotated = vec2f(local.x * c - local.y * s, local.x * s + local.y * c);
  let background = linear_rgb(ENAMEL_PALETTE[palette_index] * enamel_finish(rotated));
  let luminance = dot(background, vec3f(.2126, .7152, .0722));
  let ink_luminance = max((luminance + .05) / TARGET_CONTRAST - .05, 0.0);
  // Scale in linear light to retain the slice hue at a consistent contrast.
  let color = srgb(background * ink_luminance / max(luminance, .0001));
  let alpha = glyph.a;
  // Preserve the internal detail of colored emoji.
  let colored_glyph = max(glyph.r, max(glyph.g, glyph.b)) - min(glyph.r, min(glyph.g, glyph.b)) > .08;
  return select(vec4f(color, alpha), glyph, colored_glyph);
}
