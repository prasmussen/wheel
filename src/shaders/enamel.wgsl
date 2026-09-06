// Shared by the enamel surface and its printed lettering.
fn enamel_finish(position: vec2f) -> f32 {
  return .96 + dot(position, normalize(vec2f(-.55, .84))) * .055;
}
