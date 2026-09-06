struct Uniforms { wheel_angle: f32, aspect: f32, charge: f32, impact: f32 }
@group(0) @binding(0) var<uniform> u: Uniforms;
struct Input { @location(0) local: vec2f, @location(1) angle: f32 }
struct Output { @builtin(position) position: vec4f, @location(0) local: vec2f }

@vertex fn vertex(input: Input) -> Output {
  let a = input.angle + u.wheel_angle;
  let radial = vec2f(cos(a), sin(a));
  let tangent = vec2f(-radial.y, radial.x);
  let center = radial * 0.83;
  let p = center + radial * input.local.y + tangent * input.local.x;
  var output: Output;
  output.position = vec4f(p.x / u.aspect, p.y, 0.0, 1.0);
  output.position = vec4f(output.position.xy * min(u.aspect, 1.0), 0.0, 1.0);
  output.local = (radial * input.local.y + tangent * input.local.x) / .027;
  return output;
}
@fragment fn fragment(input: Output) -> @location(0) vec4f {
  let radius = length(input.local);
  let lighting = dot(input.local, vec2f(-.55, .84));
  let socket = vec3f(.055, .07, .095);
  let bevel = vec3f(.48, .53, .60) * (.8 + lighting * .35);
  let face = vec3f(.73, .77, .82) * (.88 + lighting * .18);
  let metal = mix(face, bevel, smoothstep(.48, .65, radius));
  return vec4f(mix(metal, socket, smoothstep(.72, .82, radius)), 1.0);
}
