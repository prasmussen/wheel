struct Uniforms { wheel_angle: f32, aspect: f32, charge: f32, impact: f32 }
@group(0) @binding(0) var<uniform> u: Uniforms;
struct Input { @location(0) local: vec2f, @location(1) angle: f32 }
struct Output { @builtin(position) position: vec4f, @location(0) shade: f32 }

@vertex fn vertex(input: Input) -> Output {
  let a = input.angle + u.wheel_angle;
  let radial = vec2f(cos(a), sin(a));
  let tangent = vec2f(-radial.y, radial.x);
  let center = radial * 0.83;
  let p = center + radial * input.local.y + tangent * input.local.x;
  var output: Output;
  output.position = vec4f(p.x / u.aspect, p.y, 0.0, 1.0);
  output.position = vec4f(output.position.xy * min(u.aspect, 1.0), 0.0, 1.0);
  output.shade = 0.78 + input.local.y * 4.0 + u.impact * 0.18;
  return output;
}
@fragment fn fragment(input: Output) -> @location(0) vec4f {
  return vec4f(vec3f(input.shade), 1.0);
}
