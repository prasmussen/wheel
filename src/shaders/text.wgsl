struct Uniforms { wheel_angle: f32, aspect: f32, charge: f32, impact: f32 }
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var labels: texture_2d<f32>;
@group(0) @binding(2) var label_sampler: sampler;
struct Output { @builtin(position) position: vec4f, @location(0) uv: vec2f }

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
  return textureSample(labels, label_sampler, input.uv);
}
