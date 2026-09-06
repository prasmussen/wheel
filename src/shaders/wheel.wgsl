struct Uniforms {
  wheel_angle: f32,
  aspect: f32,
  charge: f32,
  impact: f32,
}
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexInput {
  @location(0) position: vec2f,
  @location(1) color: vec4f,
}
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) local_position: vec2f,
}

@vertex fn vertex(input: VertexInput) -> VertexOutput {
  let c = cos(u.wheel_angle);
  let s = sin(u.wheel_angle);
  let rotated = vec2f(input.position.x * c - input.position.y * s,
                      input.position.x * s + input.position.y * c);
  let pulse = 1.0 - u.charge * 0.018 + u.impact * 0.004;
  var output: VertexOutput;
  output.position = vec4f(rotated.x * pulse / u.aspect, rotated.y * pulse, 0.0, 1.0);
  output.position = vec4f(output.position.xy * min(u.aspect, 1.0), 0.0, 1.0);
  output.color = input.color;
  output.local_position = rotated;
  return output;
}

@fragment fn fragment(input: VertexOutput) -> @location(0) vec4f {
  let radius=length(input.local_position);
  let light = dot(input.local_position, normalize(vec2f(-.55, .84)));
  let enamel = .96 + light * .055;
  let direction = normalize(input.local_position + vec2f(.0001));
  let metal = .73 + .34 * dot(direction, normalize(vec2f(-.55, .84)));
  let is_hardware = radius > .821 || radius < .129;
  let finish = select(enamel, metal, is_hardware);
  return vec4f(input.color.rgb * finish, input.color.a);
}
