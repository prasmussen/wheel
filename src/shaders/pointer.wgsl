struct Uniforms { pointer_angle: f32, aspect: f32, charge: f32, impact: f32 }
@group(0) @binding(0) var<uniform> u: Uniforms;
struct Input { @location(0) local: vec2f, @location(1) color: vec4f, @location(2) moving: f32 }
struct Output { @builtin(position) position: vec4f, @location(0) color: vec4f }

@vertex fn vertex(input: Input) -> Output {
  let angle = u.pointer_angle * input.moving;
  let c = cos(angle); let s = sin(angle);
  let local = vec2f(input.local.x * c - input.local.y * s,
                    input.local.x * s + input.local.y * c);
  let p = vec2f(0.0, 0.955) + local;
  var output: Output;
  output.position = vec4f(p.x / u.aspect, p.y, 0.0, 1.0);
  output.position = vec4f(output.position.xy * min(u.aspect, 1.0), 0.0, 1.0);
  output.color = input.color;
  return output;
}
@fragment fn fragment(input: Output) -> @location(0) vec4f { return input.color; }
