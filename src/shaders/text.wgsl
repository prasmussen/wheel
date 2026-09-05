struct Uniforms { wheel_angle: f32, aspect: f32, charge: f32, impact: f32 }
@group(0) @binding(0) var<uniform> u: Uniforms;

struct Input {
  @location(0) corner: vec2f,
  @location(1) center: vec2f,
  @location(2) angle: f32,
  @location(3) pixel_size: f32,
  @location(4) bits_low: u32,
  @location(5) bits_high: u32,
}
struct Output {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) bits_low: u32,
  @location(2) @interpolate(flat) bits_high: u32,
}

@vertex fn vertex(input: Input) -> Output {
  let baseline = vec2f(cos(input.angle), sin(input.angle));
  let upward = vec2f(-baseline.y, baseline.x);
  let glyph_position = input.center
    + baseline * input.corner.x * input.pixel_size * 5.0
    - upward * input.corner.y * input.pixel_size * 7.0;
  let c=cos(u.wheel_angle); let s=sin(u.wheel_angle);
  let p=vec2f(glyph_position.x*c-glyph_position.y*s,glyph_position.x*s+glyph_position.y*c);
  var output: Output;
  output.position=vec4f(p.x/u.aspect,p.y,0.0,1.0);
  output.uv=(input.corner+vec2f(.5))*vec2f(5.0,7.0);
  output.bits_low=input.bits_low; output.bits_high=input.bits_high;
  return output;
}

fn enabled(low:u32,high:u32,index:u32)->bool {
  if(index<32u){return (low & (1u<<index))!=0u;}
  return (high & (1u<<(index-32u)))!=0u;
}

@fragment fn fragment(input: Output) -> @location(0) vec4f {
  var distance=10.0;
  for(var y=0u;y<7u;y++){
    for(var x=0u;x<5u;x++){
      let index=y*5u+x;
      if(enabled(input.bits_low,input.bits_high,index)){
        let q=abs(input.uv-(vec2f(f32(x),f32(y))+vec2f(.5)))-vec2f(.39);
        let cell_distance=length(max(q,vec2f(0.0)))+min(max(q.x,q.y),0.0);
        distance=min(distance,cell_distance);
      }
    }
  }
  let smoothing=max(fwidth(distance),.025);
  let alpha=1.0-smoothstep(-smoothing,smoothing,distance);
  if(alpha<.01){discard;}
  return vec4f(1.0,1.0,1.0,alpha*.95);
}
