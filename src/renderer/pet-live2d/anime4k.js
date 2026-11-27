/*!
 * anime4k.js@1.1.3 minimal preset bundle (ImageUpscaler + ANIME4KJS_SIMPLE_M_2X)
 * Source: https://github.com/monyone/Anime4K.js (npm tarball shasum 9f976d8edd381089e73436116fc191d6fd6edc0e)
 * Licenses: MIT - Copyright (c) 2023 もにょ～ん (Anime4K.js) & Copyright (c) 2019-2021 bloc97 (Anime4K GLSL)
 */
var Anime4KJS=(()=>{var P=Object.defineProperty;var S=Object.getOwnPropertyDescriptor;var X=Object.getOwnPropertyNames;var B=Object.prototype.hasOwnProperty;var W=(i,e)=>{for(var u in e)P(i,u,{get:e[u],enumerable:!0})},y=(i,e,u,t)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of X(e))!B.call(i,n)&&n!==u&&P(i,n,{get:()=>e[n],enumerable:!(t=S(e,n))||t.enumerable});return i};var V=i=>y(P({},"__esModule",{value:!0}),i);var c0={};W(c0,{ANIME4KJS_SIMPLE_M_2X:()=>m0,ImageUpscaler:()=>I});var F=(i,e,u)=>{let t=i.createShader(e);return t?(i.shaderSource(t,u),i.compileShader(t),i.getShaderParameter(t,i.COMPILE_STATUS)?t:(console.warn(i.getShaderInfoLog(t)),i.deleteShader(t),null)):null},g=(i,e)=>F(i,i.VERTEX_SHADER,e),l=(i,e)=>F(i,i.FRAGMENT_SHADER,e),x=(i,e,u)=>{let t=i.createProgram();return t?(i.attachShader(t,e),i.attachShader(t,u),i.linkProgram(t),i.getProgramParameter(t,i.LINK_STATUS)?(i.deleteShader(e),i.deleteShader(u),t):(console.warn(i.getProgramInfoLog(t)),i.deleteProgram(t),null)):null},p=(i,e)=>{let u=i.createTexture();return u?(i.bindTexture(i.TEXTURE_2D,u),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,e),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAG_FILTER,e),i.bindTexture(i.TEXTURE_2D,null),u):null},T=(i,e,u,t)=>{let n=i.getExtension("OES_texture_half_float");i.bindTexture(i.TEXTURE_2D,e),i.texImage2D(i.TEXTURE_2D,0,i.RGBA,u,t,0,i.RGBA,n?.HALF_FLOAT_OES??i.FLOAT,null),i.bindTexture(i.TEXTURE_2D,null)},f=(i,e,u,t,n)=>{let s=i.createBuffer();return s?(i.bindBuffer(i.ARRAY_BUFFER,s),i.bufferData(i.ARRAY_BUFFER,new Float32Array([e,u,t,u,e,n,e,n,t,u,t,n]),i.STATIC_DRAW),i.bindBuffer(i.ARRAY_BUFFER,null),s):null},m=(i,e,u)=>{i.bindBuffer(i.ARRAY_BUFFER,u),i.vertexAttribPointer(e,2,i.FLOAT,!1,0,0),i.bindBuffer(i.ARRAY_BUFFER,null)};var H=`
precision highp float;

attribute vec2 a_position;
attribute vec2 a_texture_coord;

uniform vec2 u_resolution;

varying vec2 v_texture_coord;

void main() {
  // convert the rectangle from pixels to 0.0 to 1.0
  vec2 zeroToOne = a_position / u_resolution;

  // convert from 0->1 to 0->2
  vec2 zeroToTwo = zeroToOne * 2.0;

  // convert from 0->2 to -1->+1 (clipspace)
  vec2 clipSpace = zeroToTwo - 1.0;

  gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);

  // pass the texCoord to the fragment shader
  // The GPU will interpolate this value between points.
  v_texture_coord = a_texture_coord;
}
`,K=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform sampler2D u_image;

varying vec2 v_texture_coord;

void main() {
  gl_FragColor = texture2D(u_image, v_texture_coord);
}
`,R=class{gl;program;resolutionLocation;sourceTextureLocation;aPositionLocation;aTextureCoordLocation;texcoordBuffer;positionBuffer=null;cachedWidth=null;cachedHeight=null;constructor(e){this.gl=e,this.program=x(e,g(e,H),l(e,K)),this.texcoordBuffer=f(e,0,0,1,1),this.resolutionLocation=e.getUniformLocation(this.program,"u_resolution"),this.sourceTextureLocation=e.getUniformLocation(this.program,"u_image"),this.aPositionLocation=e.getAttribLocation(this.program,"a_position"),e.enableVertexAttribArray(this.aPositionLocation),this.aTextureCoordLocation=e.getAttribLocation(this.program,"a_texture_coord"),e.enableVertexAttribArray(this.aTextureCoordLocation)}destroy(){let e=this.gl;this.texcoordBuffer!=null&&e.deleteBuffer(this.texcoordBuffer),this.positionBuffer!=null&&e.deleteBuffer(this.positionBuffer)}render(e,u,t){let n=this.gl,s=this.texcoordBuffer;if(!s)return;let{texture:_}=e;{n.viewport(0,0,u,t),n.bindFramebuffer(n.FRAMEBUFFER,null),n.activeTexture(n.TEXTURE0),n.bindTexture(n.TEXTURE_2D,_),n.useProgram(this.program),this.positionBuffer==null?this.positionBuffer=f(n,0,0,u,t):(this.cachedWidth!==u||this.cachedHeight!==t)&&(n.deleteBuffer(this.positionBuffer),this.positionBuffer=f(n,0,0,u,t));let c=this.positionBuffer;m(n,this.aPositionLocation,c),m(n,this.aTextureCoordLocation,s),n.uniform2f(this.resolutionLocation,u,t),n.uniform1i(this.sourceTextureLocation,0),n.drawArrays(n.TRIANGLES,0,6),this.cachedWidth=u,this.cachedHeight=t}}};var D=()=>{},I=class i{source=null;canvas=null;gl=null;scale=null;config;textures=new Map;in_texture=null;native_texture=null;output_texture=null;framebuffer=null;programs=null;passthrough=null;supported;constructor(e){this.supported=i.isSupported(),this.config=e}static isSupported(){let u=new OffscreenCanvas(0,0).getContext("webgl");return!(!u||u.getExtension("OES_texture_float")==null||u.getExtension("OES_texture_float_linear")==null)}upscale(){if(!this.supported||!this.source||!this.canvas||!this.gl||!this.framebuffer||!this.programs||!this.passthrough)return;let e=this.gl,u=this.framebuffer,t=this.in_texture;if(!t)return;e.bindTexture(e.TEXTURE_2D,t),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,this.source),e.bindTexture(e.TEXTURE_2D,null);let n=this.native_texture;if(!n)return;let s=this.output_texture;if(!s)return;let _=this.source instanceof ImageBitmap?this.source.width:this.source instanceof HTMLVideoElement?this.source.videoWidth:this.source instanceof(window.VideoFrame??D)?this.source.displayWidth:this.source.width,c=this.source instanceof ImageBitmap?this.source.height:this.source instanceof HTMLVideoElement?this.source.videoHeight:this.source instanceof(window.VideoFrame??D)?this.source.displayHeight:this.source.height,o=this.canvas.width,r=this.canvas.height;if(this.textures.has("NATIVE")||this.textures.set("NATIVE",{texture:n,width:_,height:c}),this.textures.has("OUTPUT")||this.textures.set("OUTPUT",{texture:s,width:o,height:r}),this.textures.has("MAIN")||this.textures.set("MAIN",{texture:t,width:_,height:c}),this.programs.forEach(a=>a.hook_MAIN(this.textures,u)),this.textures.has("MAIN")){let a=this.textures.get("MAIN");this.textures.set("PREKERNEL",a),this.textures.delete("MAIN"),this.programs.forEach(d=>d.hook_PREKERNEL(this.textures,u))}this.passthrough.render(this.textures.get("PREKERNEL"),o,r),e.flush(),this.canvas instanceof OffscreenCanvas||(this.canvas.style.visibility="visible")}attachSource(e,u){if(this.source=e,this.canvas=u,this.gl=this.canvas.getContext("webgl",{premultipliedAlpha:!1,stencil:!1,depth:!1}),this.gl&&this.gl.getExtension("OES_texture_float")&&this.gl.getExtension("OES_texture_float_linear")){let t=this.gl;t.disable(t.DEPTH_TEST),t.disable(t.STENCIL_TEST),t.clearColor(0,0,0,0),t.clear(t.COLOR_BUFFER_BIT),this.in_texture=p(t,t.LINEAR),this.native_texture=p(t,t.LINEAR),this.output_texture=p(t,t.LINEAR),this.framebuffer=t.createFramebuffer(),this.programs=this.config.map(n=>new n(t)),this.scale=null,this.passthrough=new R(t),this.adjustCanvasSize()}else this.detachSource()}detachSource(){(this.programs??[]).forEach(e=>e.destroy()),this.passthrough?.destroy(),this.passthrough=null,this.gl?.deleteFramebuffer(this.framebuffer),this.gl?.deleteTexture(this.in_texture),this.gl?.deleteTexture(this.native_texture),this.gl?.deleteTexture(this.output_texture),this.in_texture=this.native_texture=this.output_texture=null,this.gl=null,this.canvas&&(this.canvas instanceof OffscreenCanvas||(this.canvas.style.visibility="hidden")),this.source=null,this.canvas=null}adjustCanvasSize(){if(!this.source||!this.canvas)return;if(this.scale==null){let t=1,n=1;for(let s of this.programs??[]){let[_,c]=s.magnification();t*=_,n*=c}this.scale=[t,n]}let e=this.source instanceof ImageBitmap?this.source.width:this.source instanceof HTMLVideoElement?this.source.videoWidth:this.source instanceof(window.VideoFrame??D)?this.source.displayWidth:this.source.width,u=this.source instanceof ImageBitmap?this.source.height:this.source instanceof HTMLVideoElement?this.source.videoHeight:this.source instanceof(window.VideoFrame??D)?this.source.displayHeight:this.source.height;this.canvas.width=e*this.scale[0],this.canvas.height=u*this.scale[1],this.canvas instanceof OffscreenCanvas||(this.canvas.style.pointerEvents="none")}};var b=class{magnification(){return[1,1]}hook_MAIN(e,u){}hook_PREKERNEL(e,u){}};var z=`
precision highp float;

attribute vec2 a_position;
attribute vec2 a_texture_coord;

uniform vec2 u_resolution;

varying vec2 v_texture_coord;

void main() {
  vec2 zeroToOne = a_position / u_resolution;
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;

  gl_Position = vec4(clipSpace * vec2(1, 1), 0, 1);

  v_texture_coord = a_texture_coord;
}
`,C=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D MAIN;
#define MAIN_pos (v_texture_coord)
#define MAIN_tex(pos) (texture2D(MAIN, pos))
#define MAIN_size (u_texture_size)
#define MAIN_pt (1.0 / MAIN_size)
#define MAIN_texOff(offset) (MAIN_tex(MAIN_pos + MAIN_pt * offset))

#define KERNELSIZE 5 //Kernel size, must be an positive odd integer.
#define KERNELHALFSIZE 2 //Half of the kernel size without remainder. Must be equal to trunc(KERNELSIZE/2).
float get_luma(vec4 rgba) {
  return dot(vec4(0.299, 0.587, 0.114, 0.0), rgba);
}
void main() {
  float gmax = 0.0;
  for (int i=0; i<KERNELSIZE; i++) {
    float g = get_luma(MAIN_texOff(vec2(i - KERNELHALFSIZE, 0)));
    gmax = max(g, gmax);
  }
  gl_FragColor = vec4(gmax, 0.0, 0.0, 0.0);
}
`,k=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D MAIN;
#define MAIN_pos (v_texture_coord)
#define MAIN_tex(pos) (texture2D(MAIN, pos))
#define MAIN_size (u_texture_size)
#define MAIN_pt (1.0 / MAIN_size)
#define MAIN_texOff(offset) (MAIN_tex(MAIN_pos + MAIN_pt * offset))

uniform sampler2D STATSMAX;
#define STATSMAX_pos (v_texture_coord)
#define STATSMAX_tex(pos) (texture2D(STATSMAX, pos))
#define STATSMAX_size (u_texture_size)
#define STATSMAX_pt (1.0 / STATSMAX_size)
#define STATSMAX_texOff(offset) (STATSMAX_tex(STATSMAX_pos + STATSMAX_pt * offset))

#define KERNELSIZE 5 //Kernel size, must be an positive odd integer.
#define KERNELHALFSIZE 2 //Half of the kernel size without remainder. Must be equal to trunc(KERNELSIZE/2).
void main() {
  float gmax = 0.0;
  for (int i=0; i<KERNELSIZE; i++) {
    float g = STATSMAX_texOff(vec2(0, i - KERNELHALFSIZE)).x;
    gmax = max(g, gmax);
  }
  gl_FragColor = vec4(gmax, 0.0, 0.0, 0.0);
}
`,Z=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D PREKERNEL;
#define PREKERNEL_pos (v_texture_coord)
#define PREKERNEL_tex(pos) (texture2D(PREKERNEL, pos))
#define PREKERNEL_size (u_texture_size)
#define PREKERNEL_pt (1.0 / PREKERNEL_size)
#define PREKERNEL_texOff(offset) (PREKERNEL_tex(PREKERNEL_pos + PREKERNEL_pt * offset))

uniform sampler2D STATSMAX;
#define STATSMAX_pos (v_texture_coord)
#define STATSMAX_tex(pos) (texture2D(STATSMAX, pos))
#define STATSMAX_size (u_texture_size)
#define STATSMAX_pt (1.0 / STATSMAX_size)
#define STATSMAX_texOff(offset) (STATSMAX_tex(STATSMAX_pos + STATSMAX_pt * offset))

float get_luma(vec4 rgba) {
  return dot(vec4(0.299, 0.587, 0.114, 0.0), rgba);
}
void main() {
  float current_luma = get_luma(PREKERNEL_tex(PREKERNEL_pos));
  float new_luma = min(current_luma, STATSMAX_tex(PREKERNEL_pos).x);
  //This trick is only possible if the inverse Y->RGB matrix has 1 for every row... (which is the case for BT.709)
  //Otherwise we would need to convert RGB to YUV, modify Y then convert back to RGB.
  gl_FragColor = vec4((PREKERNEL_tex(PREKERNEL_pos) - (current_luma - new_luma)).rgb, 1);
}
`,w=class extends b{gl;texcoordBuffer;program_0;program_1;program_2;program_0_intermediate_texture;program_1_intermediate_texture;program_2_intermediate_texture;program_0_intermediate_texture_cached_width;program_1_intermediate_texture_cached_width;program_2_intermediate_texture_cached_width;program_0_intermediate_texture_cached_height;program_1_intermediate_texture_cached_height;program_2_intermediate_texture_cached_height;program_0_a_position_location;program_1_a_position_location;program_2_a_position_location;program_0_a_texture_coord_location;program_1_a_texture_coord_location;program_2_a_texture_coord_location;program_0_u_resolution_location;program_1_u_resolution_location;program_2_u_resolution_location;program_0_u_texture_size_location;program_1_u_texture_size_location;program_2_u_texture_size_location;program_0_MAIN_TextureLocation;program_1_MAIN_TextureLocation;program_1_STATSMAX_TextureLocation;program_2_PREKERNEL_TextureLocation;program_2_STATSMAX_TextureLocation;program_0_position_buffer;program_1_position_buffer;program_2_position_buffer;constructor(e){super(),this.gl=e,this.texcoordBuffer=f(e,0,0,1,1),this.program_0=x(e,g(e,z),l(e,C)),this.program_1=x(e,g(e,z),l(e,k)),this.program_2=x(e,g(e,z),l(e,Z)),this.program_0_intermediate_texture=p(e,e.NEAREST),this.program_1_intermediate_texture=p(e,e.NEAREST),this.program_2_intermediate_texture=p(e,e.NEAREST),this.program_0_intermediate_texture_cached_width=null,this.program_1_intermediate_texture_cached_width=null,this.program_2_intermediate_texture_cached_width=null,this.program_0_intermediate_texture_cached_height=null,this.program_1_intermediate_texture_cached_height=null,this.program_2_intermediate_texture_cached_height=null,this.program_0_a_position_location=e.getAttribLocation(this.program_0,"a_position"),e.enableVertexAttribArray(this.program_0_a_position_location),this.program_1_a_position_location=e.getAttribLocation(this.program_1,"a_position"),e.enableVertexAttribArray(this.program_1_a_position_location),this.program_2_a_position_location=e.getAttribLocation(this.program_2,"a_position"),e.enableVertexAttribArray(this.program_2_a_position_location),this.program_0_a_texture_coord_location=e.getAttribLocation(this.program_0,"a_texture_coord"),e.enableVertexAttribArray(this.program_0_a_texture_coord_location),this.program_1_a_texture_coord_location=e.getAttribLocation(this.program_1,"a_texture_coord"),e.enableVertexAttribArray(this.program_1_a_texture_coord_location),this.program_2_a_texture_coord_location=e.getAttribLocation(this.program_2,"a_texture_coord"),e.enableVertexAttribArray(this.program_2_a_texture_coord_location),this.program_0_u_resolution_location=e.getUniformLocation(this.program_0,"u_resolution"),this.program_1_u_resolution_location=e.getUniformLocation(this.program_1,"u_resolution"),this.program_2_u_resolution_location=e.getUniformLocation(this.program_2,"u_resolution"),this.program_0_u_texture_size_location=e.getUniformLocation(this.program_0,"u_texture_size"),this.program_1_u_texture_size_location=e.getUniformLocation(this.program_1,"u_texture_size"),this.program_2_u_texture_size_location=e.getUniformLocation(this.program_2,"u_texture_size"),this.program_0_MAIN_TextureLocation=e.getUniformLocation(this.program_0,"MAIN"),this.program_1_MAIN_TextureLocation=e.getUniformLocation(this.program_1,"MAIN"),this.program_1_STATSMAX_TextureLocation=e.getUniformLocation(this.program_1,"STATSMAX"),this.program_2_PREKERNEL_TextureLocation=e.getUniformLocation(this.program_2,"PREKERNEL"),this.program_2_STATSMAX_TextureLocation=e.getUniformLocation(this.program_2,"STATSMAX"),this.program_0_position_buffer=null,this.program_1_position_buffer=null,this.program_2_position_buffer=null}destroy(){let e=this.gl;this.texcoordBuffer!=null&&e.deleteBuffer(this.texcoordBuffer),this.program_0_intermediate_texture!=null&&e.deleteTexture(this.program_0_intermediate_texture),this.program_0_position_buffer!=null&&e.deleteBuffer(this.program_0_position_buffer),this.program_0!=null&&e.deleteProgram(this.program_0),this.program_1_intermediate_texture!=null&&e.deleteTexture(this.program_1_intermediate_texture),this.program_1_position_buffer!=null&&e.deleteBuffer(this.program_1_position_buffer),this.program_1!=null&&e.deleteProgram(this.program_1),this.program_2_intermediate_texture!=null&&e.deleteTexture(this.program_2_intermediate_texture),this.program_2_position_buffer!=null&&e.deleteBuffer(this.program_2_position_buffer),this.program_2!=null&&e.deleteProgram(this.program_2)}magnification(){let e=new Map([["MAIN",{width:1,height:1}],["NATIVE",{width:1,height:1}],["OUTPUT",{width:1,height:1}]]);{if(!e.get("MAIN"))return[1,1];let s=e.get("MAIN");if(!s)return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];e.set("STATSMAX",{width:s.width,height:s.height})}{if(!e.get("MAIN"))return[1,1];let s=e.get("MAIN");if(!s)return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];if(!e.get("STATSMAX"))return[1,1];e.set("STATSMAX",{width:s.width,height:s.height})}let u=e.get("MAIN")?.width??1,t=e.get("MAIN")?.height??1;return[u,t]}hook_MAIN(e,u){let t=this.gl,n=this.texcoordBuffer;if(n){{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE")||!e.get("OUTPUT"))return;{let r=this.program_0_intermediate_texture;(this.program_0_intermediate_texture_cached_width!==_.width||this.program_0_intermediate_texture_cached_height!==_.height)&&T(t,r,_.width,_.height),t.viewport(0,0,_.width,_.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,r,0),t.useProgram(this.program_0),this.program_0_position_buffer==null?this.program_0_position_buffer=f(t,0,0,_.width,_.height):(this.program_0_intermediate_texture_cached_width!==_.width||this.program_0_intermediate_texture_cached_height!==_.height)&&(t.deleteBuffer(this.program_0_position_buffer),this.program_0_position_buffer=f(t,0,0,_.width,_.height));let a=this.program_0_position_buffer;m(t,this.program_0_a_position_location,a),m(t,this.program_0_a_texture_coord_location,n),t.uniform2f(this.program_0_u_resolution_location,_.width,_.height),t.uniform2f(this.program_0_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,_.texture),t.uniform1i(this.program_0_MAIN_TextureLocation,0),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),this.program_0_intermediate_texture_cached_width=_.width,this.program_0_intermediate_texture_cached_height=_.height,e.set("STATSMAX",{texture:r,width:_.width,height:_.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE")||!e.get("OUTPUT"))return;let r=e.get("STATSMAX");if(!r)return;{let a=this.program_1_intermediate_texture;(this.program_1_intermediate_texture_cached_width!==_.width||this.program_1_intermediate_texture_cached_height!==_.height)&&T(t,a,_.width,_.height),t.viewport(0,0,_.width,_.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,a,0),t.useProgram(this.program_1),this.program_1_position_buffer==null?this.program_1_position_buffer=f(t,0,0,_.width,_.height):(this.program_1_intermediate_texture_cached_width!==_.width||this.program_1_intermediate_texture_cached_height!==_.height)&&(t.deleteBuffer(this.program_1_position_buffer),this.program_1_position_buffer=f(t,0,0,_.width,_.height));let d=this.program_1_position_buffer;m(t,this.program_1_a_position_location,d),m(t,this.program_1_a_texture_coord_location,n),t.uniform2f(this.program_1_u_resolution_location,_.width,_.height),t.uniform2f(this.program_1_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,_.texture),t.uniform1i(this.program_1_MAIN_TextureLocation,0),t.activeTexture(t.TEXTURE1),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_1_STATSMAX_TextureLocation,1),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE1),t.bindTexture(t.TEXTURE_2D,null),this.program_1_intermediate_texture_cached_width=_.width,this.program_1_intermediate_texture_cached_height=_.height,e.set("STATSMAX",{texture:a,width:_.width,height:_.height})}}}}hook_PREKERNEL(e,u){let t=this.gl,n=this.texcoordBuffer;if(n){if(!e.get("PREKERNEL")||!e.get("NATIVE")||!e.get("OUTPUT"))return;let o=e.get("PREKERNEL");if(!o)return;let r=e.get("STATSMAX");if(!r)return;{let a=this.program_2_intermediate_texture;(this.program_2_intermediate_texture_cached_width!==o.width||this.program_2_intermediate_texture_cached_height!==o.height)&&T(t,a,o.width,o.height),t.viewport(0,0,o.width,o.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,a,0),t.useProgram(this.program_2),this.program_2_position_buffer==null?this.program_2_position_buffer=f(t,0,0,o.width,o.height):(this.program_2_intermediate_texture_cached_width!==o.width||this.program_2_intermediate_texture_cached_height!==o.height)&&(t.deleteBuffer(this.program_2_position_buffer),this.program_2_position_buffer=f(t,0,0,o.width,o.height));let d=this.program_2_position_buffer;m(t,this.program_2_a_position_location,d),m(t,this.program_2_a_texture_coord_location,n),t.uniform2f(this.program_2_u_resolution_location,o.width,o.height),t.uniform2f(this.program_2_u_texture_size_location,o.width,o.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,o.texture),t.uniform1i(this.program_2_PREKERNEL_TextureLocation,0),t.activeTexture(t.TEXTURE1),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_2_STATSMAX_TextureLocation,1),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE1),t.bindTexture(t.TEXTURE_2D,null),this.program_2_intermediate_texture_cached_width=o.width,this.program_2_intermediate_texture_cached_height=o.height,e.set("PREKERNEL",{texture:a,width:o.width,height:o.height})}}}};var A=`
precision highp float;

attribute vec2 a_position;
attribute vec2 a_texture_coord;

uniform vec2 u_resolution;

varying vec2 v_texture_coord;

void main() {
  vec2 zeroToOne = a_position / u_resolution;
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;

  gl_Position = vec4(clipSpace * vec2(1, 1), 0, 1);

  v_texture_coord = a_texture_coord;
}
`,Y=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D MAIN;
#define MAIN_pos (v_texture_coord)
#define MAIN_tex(pos) (texture2D(MAIN, pos))
#define MAIN_size (u_texture_size)
#define MAIN_pt (1.0 / MAIN_size)
#define MAIN_texOff(offset) (MAIN_tex(MAIN_pos + MAIN_pt * offset))

#define go_0(x_off, y_off) (MAIN_texOff(vec2(x_off, y_off)))
void main() {
  vec4 result = mat4(-0.09991986, 0.13782342, -0.031251684, -0.06356843, -0.3437488, 0.05450952, 0.34347802, 0.46335372, 0.08607224, 0.044988394, 0.137179, 0.17976908, 0.0, 0.0, 0.0, 0.0) * go_0(-1.0, -1.0);
  result += mat4(-0.024212424, -0.09278509, -0.00040907756, 0.34552294, -0.13254678, 0.113105185, 0.005667946, -0.00036919137, -0.06375679, 0.009184115, 0.115518734, -0.115506776, 0.0, 0.0, 0.0, 0.0) * go_0(-1.0, 0.0);
  result += mat4(-0.14101827, 0.023523493, 0.044094566, -0.019271746, -0.44348842, -0.08818877, -0.4026149, -0.21995795, -0.15880394, -0.013732858, -0.020751135, 0.012719151, 0.0, 0.0, 0.0, 0.0) * go_0(-1.0, 1.0);
  result += mat4(0.013001821, -0.34503505, 0.39219138, 0.18792126, 0.24760444, -0.016173402, 0.10154511, 0.15453082, -0.058132876, 0.016784398, -0.05808539, -0.11039915, 0.0, 0.0, 0.0, 0.0) * go_0(0.0, -1.0);
  result += mat4(0.37024534, 0.041440863, -0.3374568, -0.44994286, 0.19555596, 0.20855539, -0.27974075, -0.5372628, 0.21228147, -0.0295346, -0.56700057, 0.030042822, 0.0, 0.0, 0.0, 0.0) * go_0(0.0, 0.0);
  result += mat4(-0.12940632, 0.057526, 0.090682045, -0.06985033, -0.13704006, -0.047685407, 0.44615674, -0.48056605, -0.06166251, -0.01883519, 0.2032237, -0.113287605, 0.0, 0.0, 0.0, 0.0) * go_0(0.0, 1.0);
  result += mat4(0.010856669, -0.35820737, 0.16757219, 0.082619876, -0.03967303, 0.038705572, 0.32652855, -0.012030017, 0.015120559, -0.15314877, 0.23442009, 0.09767922, 0.0, 0.0, 0.0, 0.0) * go_0(1.0, -1.0);
  result += mat4(-0.046272673, -0.17752305, 0.082018286, -0.2512824, 0.58619463, -0.060903464, -0.022793597, 0.077803515, -0.17025311, 0.05136993, 0.029383298, -0.15475409, 0.0, 0.0, 0.0, 0.0) * go_0(1.0, 0.0);
  result += mat4(-0.11212024, 0.13378005, -0.2027488, 0.08056421, -0.11176219, -0.048429377, -0.08396386, 0.10507829, 0.13326839, 0.0430627, 0.051362377, 0.06482755, 0.0, 0.0, 0.0, 0.0) * go_0(1.0, 1.0);
  result += vec4(-0.061233472, 0.39222646, 0.029704979, 0.02586828);
  gl_FragColor = result;
}
`,j=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D conv2d_tf;
#define conv2d_tf_pos (v_texture_coord)
#define conv2d_tf_tex(pos) (texture2D(conv2d_tf, pos))
#define conv2d_tf_size (u_texture_size)
#define conv2d_tf_pt (1.0 / conv2d_tf_size)
#define conv2d_tf_texOff(offset) (conv2d_tf_tex(conv2d_tf_pos + conv2d_tf_pt * offset))

#define go_0(x_off, y_off) (max((conv2d_tf_texOff(vec2(x_off, y_off))), 0.0))
#define go_1(x_off, y_off) (max(-(conv2d_tf_texOff(vec2(x_off, y_off))), 0.0))
void main() {
  vec4 result = mat4(-0.16410656, -0.40521824, 0.13121907, -0.02314597, 0.105412476, -0.060401272, -0.043063477, -0.13933973, 0.12558138, -0.020861467, 0.030370515, 0.13178016, -0.14220351, 0.20736893, 0.003321564, -0.29241714) * go_0(-1.0, -1.0);
  result += mat4(0.18517321, 0.29162985, -0.26783395, 0.039760686, 0.025527012, -0.067319244, 0.055004176, 0.048916563, 0.12750523, -0.091435954, 0.13818842, 0.36704224, 0.0839921, 0.10186618, -0.17237376, 0.13282418) * go_0(-1.0, 0.0);
  result += mat4(-0.1657887, 0.0131325135, -0.17222486, 0.091398895, -0.12756164, -0.08437298, -0.29052997, 0.3269337, 0.15870757, -0.013529402, -0.0581753, 0.11802371, 0.07099966, -0.024063632, 0.31834844, -0.11183859) * go_0(-1.0, 1.0);
  result += mat4(0.46036887, -0.07654623, 0.22923063, 0.17463821, 0.10555414, -0.117430426, 0.12406777, -0.011399492, 0.028316498, 0.13684341, 0.009664087, 0.2022659, 0.04953974, -0.31342217, -0.6103131, -0.13605757) * go_0(0.0, -1.0);
  result += mat4(0.03406955, -0.39819366, 0.61176, -0.46809456, -0.029321073, 0.46619493, 0.36700186, 0.02288561, 0.11464085, -0.10931452, -0.09154022, 0.07334147, -0.5609916, 0.31826234, -0.011012659, -0.46719545) * go_0(0.0, 0.0);
  result += mat4(-0.056855045, 0.27037027, -0.09269696, -0.563572, -0.06816116, -0.22986612, 0.08693167, -0.16246101, 0.09954046, -0.05374176, 0.0071916827, -0.1788692, 0.3825241, -0.1609887, 0.055204768, 0.10213068) * go_0(0.0, 1.0);
  result += mat4(0.0646626, 0.102358796, -0.45055822, 0.20557903, -0.23337309, 0.12633002, -0.19299199, -0.15085731, -0.13473304, 0.053790465, -0.10061193, -0.13393497, -0.04264752, -0.029740738, -0.07865285, 0.20883279) * go_0(1.0, -1.0);
  result += mat4(0.010471527, -0.033218473, -0.46157447, 0.004866583, 0.23226471, -0.059343327, -0.1439596, 0.13619648, 0.013839963, 0.15930325, 0.043742355, 0.17467323, 0.33772305, 0.40261495, -0.08351293, 0.18129359) * go_0(1.0, 0.0);
  result += mat4(-0.12493434, -0.1875134, -0.074943796, -0.0031701606, -0.037142616, 0.1667002, 0.16665547, -0.011248127, 0.0071619414, 0.0034872112, 0.120318964, -0.09625579, 0.14917047, -0.16310586, 0.07231737, 0.30447328) * go_0(1.0, 1.0);
  result += mat4(0.093798615, 0.17074613, -0.08780678, -0.012520207, 0.118534856, 0.027508778, -0.2778478, -0.19509242, -0.34137097, 0.32000312, -0.22027159, 0.337515, 0.16220862, 0.108993016, 0.14070526, 0.12784284) * go_1(-1.0, -1.0);
  result += mat4(-0.14325632, -0.1467453, -0.27502358, 0.09370837, 0.11821083, -0.012266484, -0.2100548, 0.4707502, -0.06766648, 0.58165014, -0.2512279, -0.33783755, 0.1318925, -0.04346277, 0.15454485, 0.044500057) * go_1(-1.0, 0.0);
  result += mat4(-0.05683207, 0.0051946463, -0.108000524, 0.10133204, -0.50763863, 0.007308442, 0.8542404, 0.28387356, 0.022709515, 0.294523, -0.3822472, 0.66166407, 0.01404485, 0.031282708, -0.26756814, -0.123147786) * go_1(-1.0, 1.0);
  result += mat4(-0.36455178, 0.3470555, -0.045303088, -0.03170764, -0.15802494, -0.0019141496, -0.25939587, -0.23875342, 0.130428, 0.03954273, -0.17985536, 0.105145946, 0.15804817, 0.12551713, 0.28371975, -0.085748516) * go_1(0.0, -1.0);
  result += mat4(0.0060625463, 0.2443924, -0.017692259, -0.20214005, -0.09584515, -0.012805372, -0.13942227, 0.16143198, 0.12942013, 0.41785547, 0.046071563, 0.7030026, 0.10499644, -0.20566013, -0.031321276, 0.27830327) * go_1(0.0, 0.0);
  result += mat4(-0.081274964, -0.14562319, 0.27200526, -0.20491314, 0.012910989, 0.024201397, 0.04816258, 0.21297328, -0.22015952, -0.44160756, -0.056035373, 0.33824417, -0.31645304, 0.15469243, 0.053187452, -0.20989445) * go_1(0.0, 1.0);
  result += mat4(-0.046550367, 0.033185404, 0.33337244, 0.12853645, 0.23520172, -0.05909214, 0.0861368, 0.10706329, -0.07058717, -0.11759937, -0.18594047, 0.080006264, -0.055425353, -0.12506317, 0.15729053, -0.0915004) * go_1(1.0, -1.0);
  result += mat4(0.042516407, 0.14844789, 0.16533111, 0.13502933, -0.0655417, -0.057256397, 0.076713726, -0.23448966, 0.12855926, 0.014219275, 0.051761385, 0.053433083, -0.2446715, -0.4008074, 0.19603717, -0.1796951) * go_1(1.0, 0.0);
  result += mat4(0.14777803, 0.15524907, 0.043158617, -0.06996876, 0.19210646, -0.2144364, -0.47020787, -0.4207906, -0.18074386, -0.2163903, 0.0030754965, 0.36799973, -0.3837698, -0.0022661497, -0.37276733, -0.28934997) * go_1(1.0, 1.0);
  result += vec4(-0.018297346, -0.080951825, -0.062163066, -0.08050014);
  gl_FragColor = result;
}
`,q=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D conv2d_1_tf;
#define conv2d_1_tf_pos (v_texture_coord)
#define conv2d_1_tf_tex(pos) (texture2D(conv2d_1_tf, pos))
#define conv2d_1_tf_size (u_texture_size)
#define conv2d_1_tf_pt (1.0 / conv2d_1_tf_size)
#define conv2d_1_tf_texOff(offset) (conv2d_1_tf_tex(conv2d_1_tf_pos + conv2d_1_tf_pt * offset))

#define go_0(x_off, y_off) (max((conv2d_1_tf_texOff(vec2(x_off, y_off))), 0.0))
#define go_1(x_off, y_off) (max(-(conv2d_1_tf_texOff(vec2(x_off, y_off))), 0.0))
void main() {
  vec4 result = mat4(0.31543177, 0.23095237, -0.06692611, -0.5867763, 0.003622504, 0.17948842, -0.14627707, 0.1745016, -0.052964583, -0.15551159, 0.05644786, -0.012665164, 0.13107763, 0.11369179, -0.09452995, -0.11973403) * go_0(-1.0, -1.0);
  result += mat4(-0.2694661, -0.115382135, 0.3073268, -0.067228466, -0.25511482, -0.13922207, 0.36758214, -0.18821828, -0.022617863, 0.20333402, -0.11125889, 0.3552245, -0.013346653, -0.099095374, -0.25100616, 0.35521755) * go_0(-1.0, 0.0);
  result += mat4(0.011012409, -0.13675085, 0.25642, -0.34851208, -0.23184675, 0.18012202, 0.57654136, 0.103173524, -0.16461405, 0.038177088, 0.1234096, 0.013202029, -0.19033363, 0.07469178, -0.017948546, 0.15287702) * go_0(-1.0, 1.0);
  result += mat4(-0.05340533, 0.23797482, 0.20351392, -0.05333351, -0.12181174, -0.23363493, -0.20696607, 0.109941036, -0.11519453, 0.13842066, -0.10687832, 0.29040006, 0.022218632, 0.031238724, 0.2685182, 0.15300068) * go_0(0.0, -1.0);
  result += mat4(0.22985318, -0.3103802, -0.22916415, 0.25238806, -0.11690287, -0.1947488, 0.118020535, 0.07814263, -0.06335474, -0.007870727, 0.076106325, 0.094677486, -0.16776285, -0.006570437, -0.29589584, 0.41413507) * go_0(0.0, 0.0);
  result += mat4(0.43607962, -0.36456433, -0.123776875, -0.16634953, -0.091190875, 0.13035081, 0.28627968, 0.27249968, 0.12356344, -0.008616177, 0.09599816, -0.006144557, -0.23490307, 0.3013123, 0.14153156, 0.21837278) * go_0(0.0, 1.0);
  result += mat4(0.060364585, 0.37860224, 0.039182413, -0.22805426, -0.089910224, -0.06817697, -0.2684275, -0.12528503, 0.036934495, -0.07826616, 0.06559976, -0.08253646, 0.13489649, 0.06237663, 0.126376, 0.21194184) * go_0(1.0, -1.0);
  result += mat4(-0.12534817, 0.21225189, -0.27818045, -0.3070443, -0.006957577, -0.025105853, 0.12100924, -0.06916452, 0.23081483, 0.1802756, -0.18995638, 0.16603014, -0.2904096, -0.25292823, -0.21834068, 0.13719653) * go_0(1.0, 0.0);
  result += mat4(0.017209655, 0.10757137, 0.21414296, -0.30885983, 0.10467716, -0.2184891, 0.100061476, -0.1527528, 0.2100472, -0.25768545, -0.22329919, -0.29153427, -0.06983842, -0.103854865, -0.051384352, 0.14629121) * go_0(1.0, 1.0);
  result += mat4(0.0059623295, -0.26060802, 0.32115817, 0.021025505, 0.09783085, -0.15865178, 0.1473021, -0.24977303, -0.033508282, 0.17480391, -0.091310136, 0.09870876, 0.10504043, -0.06105686, 0.013493489, -0.11278855) * go_1(-1.0, -1.0);
  result += mat4(0.14875248, -0.14859414, 0.19377062, -0.17456068, 0.101288855, -0.1113682, -0.48944646, 0.1018565, -0.037392337, 0.08539691, 0.1751306, -0.15428723, -0.059375558, 0.027663672, 0.051804014, -0.049813222) * go_1(-1.0, 0.0);
  result += mat4(0.118846565, -0.19869871, -0.037388258, 0.08456728, -0.11662527, -0.43818352, -0.093285345, 0.038507205, -0.051991668, 0.21008292, 0.10792365, 0.2020924, 0.057021596, 0.09460527, 0.0016551288, -0.0015957063) * go_1(-1.0, 1.0);
  result += mat4(0.11062174, -0.2639232, -0.060295466, -0.3217331, -0.050545212, 0.30989558, 0.30906132, 0.030323273, 0.028986752, 0.037429404, 0.20855664, -0.19848943, 0.034687653, -0.09599135, -0.06250494, -0.13215867) * go_1(0.0, -1.0);
  result += mat4(-0.010391146, 0.07657845, 0.44491258, 0.0435906, 0.0075931503, 0.42632654, 0.47022533, 0.34737435, -0.15452717, -0.14613411, -0.45231065, 0.12094409, 0.0067911847, 0.057501152, 0.09876979, 0.044946447) * go_1(0.0, 0.0);
  result += mat4(-0.15607435, 0.2293058, -0.09520331, 0.012836732, -0.15282455, 0.26437718, -0.1685477, -0.13211122, -0.055801593, -0.016778728, -0.34478986, -0.23228309, 0.12300962, -0.13235827, -0.13987203, -0.16550972) * go_1(0.0, 1.0);
  result += mat4(0.13161735, -0.09039346, -0.033475474, -0.23686698, 0.1514885, 0.20977421, 0.031431954, -0.0049226107, 0.090661936, 0.15288061, -0.03316583, 0.09646573, -0.32651708, 0.18825398, -0.15777239, 0.17572704) * go_1(1.0, -1.0);
  result += mat4(0.112157226, -0.08712878, 0.23453182, 0.1043877, -0.14686783, 0.28682423, -0.086443506, 0.059457052, -0.31530112, -0.2700583, -0.06028952, -0.070416875, 0.18053482, 0.16653341, 0.25215197, 0.061915852) * go_1(1.0, 0.0);
  result += mat4(-0.20122242, 0.076313145, -0.0988483, 0.094337784, -0.35436687, 0.3762327, -0.07809558, 0.3055848, 0.10425242, -0.17087407, 0.030301496, -0.13911743, 0.01630275, 0.24247427, -0.006474477, 0.03842641) * go_1(1.0, 1.0);
  result += vec4(-0.008952847, -0.0058945753, -0.08097229, 0.020968592);
  gl_FragColor = result;
}
`,J=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D conv2d_2_tf;
#define conv2d_2_tf_pos (v_texture_coord)
#define conv2d_2_tf_tex(pos) (texture2D(conv2d_2_tf, pos))
#define conv2d_2_tf_size (u_texture_size)
#define conv2d_2_tf_pt (1.0 / conv2d_2_tf_size)
#define conv2d_2_tf_texOff(offset) (conv2d_2_tf_tex(conv2d_2_tf_pos + conv2d_2_tf_pt * offset))

#define go_0(x_off, y_off) (max((conv2d_2_tf_texOff(vec2(x_off, y_off))), 0.0))
#define go_1(x_off, y_off) (max(-(conv2d_2_tf_texOff(vec2(x_off, y_off))), 0.0))
void main() {
  vec4 result = mat4(-0.2237721, -0.0064096362, -0.31808427, 0.73477733, 0.015353088, 0.23983319, 0.14967978, -0.34920225, -0.07456269, 0.093151815, -0.14331086, -0.24586205, -0.14183366, 0.06401045, -0.22044073, 0.29932275) * go_0(-1.0, -1.0);
  result += mat4(-0.07968509, -0.3349146, 0.16529128, 0.08443499, 0.4095855, -0.17120704, 0.17425705, 0.15298946, 0.2981273, 0.2212369, 0.10392389, -0.28775454, -0.065247655, -0.15255849, 0.13094437, 0.18685219) * go_0(-1.0, 0.0);
  result += mat4(0.015706737, -0.17755036, 0.2622526, 0.112057306, -0.15876788, -0.38466996, -0.33700845, -0.031711742, -0.023320962, -0.3145249, -0.21223734, -0.1314596, -0.1888095, -0.046370104, 0.09000896, -0.0046378844) * go_0(-1.0, 1.0);
  result += mat4(-0.31127506, 0.31304324, -0.03965752, 0.03649018, -0.029851055, 0.05801377, 0.00040150844, -0.04422069, 0.18019931, 0.14415511, -0.09845236, 0.21895434, -0.013932474, -0.046454947, -0.3403935, -0.006705289) * go_0(0.0, -1.0);
  result += mat4(-0.34878647, -0.5129283, 0.060250953, -0.16354133, 0.20644619, 0.08732273, -0.24118888, 0.24455065, 0.24449423, 0.44103387, 0.22455928, 0.25738943, -0.26914698, -0.21309987, 0.08386486, 0.021484816) * go_0(0.0, 0.0);
  result += mat4(-0.057454903, -0.4121922, 0.022661546, 0.37178272, 0.03331408, 0.05044008, 0.04324371, 0.20727943, 0.2432641, 0.076906696, -0.20858039, 0.012439015, -0.19335061, 0.09217451, 0.1968369, -0.19435833) * go_0(0.0, 1.0);
  result += mat4(-0.16960496, 0.24616167, 0.37977478, 0.14324574, -0.011531225, -0.11312143, -0.18141079, -0.23843932, 0.0086012175, -0.3564491, -0.12639481, 0.009799298, -0.29120612, 0.23756824, 0.18035695, -0.087133996) * go_0(1.0, -1.0);
  result += mat4(-0.10081239, 0.29191494, 0.10434693, 0.08970636, 0.008997759, 0.104756236, 0.039641086, 0.02323888, -0.11627765, 0.023693223, -0.30801758, -0.120208986, 0.05086147, 0.18498175, 0.15595439, -0.09877306) * go_0(1.0, 0.0);
  result += mat4(0.101321675, -0.2929976, 0.38810417, 0.5605376, -0.04073937, 0.030110704, -0.18147062, -0.09833952, 0.01927733, 0.15335669, -0.15384074, -0.110595055, -0.054297395, -0.077522054, 0.07918369, -0.068480626) * go_0(1.0, 1.0);
  result += mat4(0.23263514, -0.11719232, 0.2903209, -0.007503795, -0.020222448, -0.17790157, -0.15600762, -0.08741775, 0.12529704, 0.25548857, -0.04585447, -0.10255033, 0.18350503, -0.29593533, 0.0868933, 0.027004737) * go_1(-1.0, -1.0);
  result += mat4(-0.14958654, -0.006238835, -0.2928948, 0.1988557, -0.17057803, 0.12524141, 0.13978264, -0.019280292, 0.05967142, -0.07790818, -0.5893818, -0.022845713, -0.08596779, 0.07875358, -0.03316667, -0.4369282) * go_1(-1.0, 0.0);
  result += mat4(0.19195688, -0.060883682, -0.25897828, 0.07063324, 0.090833396, 0.003422883, 0.109534174, 0.031180874, -0.05017118, 0.022862168, -0.270113, -0.057831235, 0.53920543, -0.10252776, -0.091807485, 0.004294343) * go_1(-1.0, 1.0);
  result += mat4(-0.18494242, -0.119284816, 0.3821897, 0.07777979, 0.15568028, -0.2854859, -0.22441281, -0.049155876, -0.15292497, 0.21895619, -0.095677756, 0.15210424, 0.001643022, -0.026176987, 0.048463076, -0.4824009) * go_1(0.0, -1.0);
  result += mat4(0.007215129, 0.17074333, 0.053930074, -0.027014816, -0.17180431, -0.15163863, -0.0012122132, -0.18934256, -0.08294297, -0.24580221, -0.46552867, -0.27923223, 0.4092668, 0.06288688, -0.1602188, -0.0030876845) * go_1(0.0, 0.0);
  result += mat4(0.111870885, 0.03317145, 0.14155298, 0.20328505, -0.05104131, 0.13979794, 0.018966835, -0.07238511, 0.05493792, -0.14975783, -0.10293237, -0.21985306, 0.49054706, 0.18288186, -0.26925826, 0.35845932) * go_1(0.0, 1.0);
  result += mat4(0.3747799, -0.096748486, -0.17139742, 0.25289854, -0.17421168, -0.018461818, 0.09747162, 0.01660535, -0.20580359, 0.56189656, 0.17151354, -0.26347768, 0.28350568, -0.21486014, -0.44330928, -0.008981037) * go_1(1.0, -1.0);
  result += mat4(0.10169985, -0.18244018, 0.04760736, 0.41017643, -0.09468786, -0.024218475, 0.103733875, -0.22540338, 0.10630112, 0.3677178, -0.104170956, 0.057317447, 0.21764882, 0.0789158, -0.22041337, 0.15065216) * go_1(1.0, 0.0);
  result += mat4(0.11633995, -0.008195114, -0.14501533, 0.07168025, 0.058413275, 0.055995367, 0.09362145, -0.13827963, 0.13760869, 0.040319785, 0.038895044, 0.2675253, -0.087339684, 0.1412073, -0.17166458, -0.2312994) * go_1(1.0, 1.0);
  result += vec4(-0.059377354, -0.02055341, 0.07234869, -0.015452986);
  gl_FragColor = result;
}
`,Q=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D conv2d_3_tf;
#define conv2d_3_tf_pos (v_texture_coord)
#define conv2d_3_tf_tex(pos) (texture2D(conv2d_3_tf, pos))
#define conv2d_3_tf_size (u_texture_size)
#define conv2d_3_tf_pt (1.0 / conv2d_3_tf_size)
#define conv2d_3_tf_texOff(offset) (conv2d_3_tf_tex(conv2d_3_tf_pos + conv2d_3_tf_pt * offset))

#define go_0(x_off, y_off) (max((conv2d_3_tf_texOff(vec2(x_off, y_off))), 0.0))
#define go_1(x_off, y_off) (max(-(conv2d_3_tf_texOff(vec2(x_off, y_off))), 0.0))
void main() {
  vec4 result = mat4(-0.29012984, -0.13150147, 0.31015614, 0.05992291, -0.050289866, 0.14845313, -0.09608898, 0.27913308, 0.060307387, -0.04160452, 0.035932682, -0.08137563, -0.07999419, 0.11818284, -0.27512288, 0.21948813) * go_0(-1.0, -1.0);
  result += mat4(0.12916058, -0.21759962, -0.33868533, 0.021636661, 0.053470243, 0.1412425, 0.043395396, -0.26751056, -0.01689101, -0.2623835, 0.010809152, 0.062962815, -0.20692012, -0.1677863, -0.23313859, -0.17402615) * go_0(-1.0, 0.0);
  result += mat4(-0.08204112, -0.23672083, -0.0064437394, -0.13200696, -0.056692924, -0.02708657, 0.12536962, 0.004428919, 0.14137582, 0.15404348, -0.105753876, 0.047957454, 0.15734316, 0.16562423, -0.010160829, -0.06602983) * go_0(-1.0, 1.0);
  result += mat4(0.025653997, -0.10877775, -0.31258908, 0.18841636, -0.36005193, 0.1816357, -0.34537643, -0.0741087, 0.4663994, 0.0065186517, 0.08109033, 0.2976773, -0.35774228, -0.041366056, -0.37852773, 0.050565656) * go_0(0.0, -1.0);
  result += mat4(0.04392313, 0.11316681, -0.14421389, 0.17985669, -0.1651274, -0.5656209, -0.124100484, 0.42774054, -0.1153939, 0.16829851, 0.2025612, 0.054007456, -0.06868256, -0.56935954, -0.12227961, 0.17688861) * go_0(0.0, 0.0);
  result += mat4(0.34041, 0.499, 0.15234196, 0.21353458, -0.2732667, -0.049950935, 0.03550811, -0.21051687, 0.2609023, 0.016438454, -0.29874632, 0.37994128, 0.049288407, -0.31126305, 0.029235512, -0.012256015) * go_0(0.0, 1.0);
  result += mat4(-0.0046853204, 0.15391374, -0.040689662, 0.20186873, -0.08137621, 0.35905558, 0.23733845, 0.21794793, -0.066420384, 0.029600656, -0.31421044, -0.050773863, -0.06260773, 0.04634221, -0.10948491, -0.045498934) * go_0(1.0, -1.0);
  result += mat4(-0.082953, -0.025837064, -0.09928303, -0.14300232, 0.275064, 0.07793617, 0.22240888, 0.06637834, -0.4382666, -0.2932182, -0.27243167, -0.14221182, 0.5695728, 0.20719238, 0.5575927, 0.40816882) * go_0(1.0, 0.0);
  result += mat4(-0.18510929, -0.15052167, 0.25277212, 0.06804461, 0.016387, 0.20310035, 0.2903229, -0.0615877, -0.28987274, -0.11942605, 0.013498961, 0.3184152, 0.29543474, -0.042830903, -0.018111207, -0.13263674) * go_0(1.0, 1.0);
  result += mat4(0.25749087, 0.0053866603, -0.09391162, -0.06129529, -0.094091184, -0.07419633, 0.0013858611, 0.012000353, -0.062903, -0.0204224, -0.12113313, 0.017942557, -0.073379934, 0.052201986, 0.35864577, 0.023564404) * go_1(-1.0, -1.0);
  result += mat4(0.100115694, 0.19451359, 0.23252094, 0.19506809, -0.12470779, 0.0027281935, -0.17488572, -0.018721964, -0.15159339, 0.18457152, 0.057712987, -0.08191495, 0.19735703, 0.07326743, -0.28563106, 0.01642815) * go_1(-1.0, 0.0);
  result += mat4(0.068062514, 0.28356665, 0.07377898, 0.42776972, 0.28725025, -0.13045293, -0.17525704, -0.05885591, -0.16676305, -0.2555945, -0.10078422, -0.053032875, 0.084470876, 0.06460686, 0.13824362, -0.05231353) * go_1(-1.0, 1.0);
  result += mat4(0.22637829, -0.028969254, 0.1968254, -0.13331996, 0.038017053, -0.008854481, -0.2031639, 0.09237089, -0.3821112, 0.1108527, -0.11029933, -0.24542028, 0.22416145, -0.031492114, -0.19144306, -0.0996271) * go_1(0.0, -1.0);
  result += mat4(0.10776744, 0.16363445, 0.14656505, -0.3737814, -0.06642015, 0.5616549, -0.008412252, -0.37266847, 0.12506576, -0.15329036, 0.037538245, -0.10810259, 0.01706349, 0.1813702, 0.035651788, -0.012786579) * go_1(0.0, 0.0);
  result += mat4(-0.4023338, -0.2098614, -0.18285121, -0.02727653, 0.26107362, 0.041306913, -0.036515504, -0.045217298, -0.39958602, -0.21229339, -0.021053292, -0.13427502, 0.36178818, 0.20934913, 0.1500852, 0.2634554) * go_1(0.0, 1.0);
  result += mat4(0.07794611, -0.25937587, -0.06822529, -0.056336135, 0.094220124, 0.21588847, -0.0455218, -0.10968329, -0.08068449, -0.31366697, 0.07799637, 0.24252681, 0.23963861, 0.13715535, 0.010329345, 0.09094301) * go_1(1.0, -1.0);
  result += mat4(-0.20975718, -0.12550138, 0.14453574, -0.0020878632, -0.07153068, 0.3249998, -0.056577377, 0.18166828, 0.37204072, 0.17018336, 0.3752895, 0.32178587, 0.2571982, -0.27258632, -0.25971004, -0.40536007) * go_1(1.0, 0.0);
  result += mat4(-0.3243907, -0.06300621, -0.09398436, -0.19549188, 0.14906861, 0.061537784, -0.055284478, 0.11281728, 0.12964857, 0.09979093, -0.1810159, -0.4104283, 0.05807971, -0.056371246, 0.08072554, 0.18479007) * go_1(1.0, 1.0);
  result += vec4(-0.048888464, -0.0561434, 0.030690912, -0.030496685);
  gl_FragColor = result;
}
`,$=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D conv2d_4_tf;
#define conv2d_4_tf_pos (v_texture_coord)
#define conv2d_4_tf_tex(pos) (texture2D(conv2d_4_tf, pos))
#define conv2d_4_tf_size (u_texture_size)
#define conv2d_4_tf_pt (1.0 / conv2d_4_tf_size)
#define conv2d_4_tf_texOff(offset) (conv2d_4_tf_tex(conv2d_4_tf_pos + conv2d_4_tf_pt * offset))

#define go_0(x_off, y_off) (max((conv2d_4_tf_texOff(vec2(x_off, y_off))), 0.0))
#define go_1(x_off, y_off) (max(-(conv2d_4_tf_texOff(vec2(x_off, y_off))), 0.0))
void main() {
  vec4 result = mat4(0.15332128, 0.027258258, 0.14900503, -0.15982795, 0.17021236, -0.51046044, -0.15287271, -0.058167327, 0.51826185, -0.34817994, 0.004513167, 0.05395769, 0.1990321, -0.049979225, 0.11391989, -0.16062729) * go_0(-1.0, -1.0);
  result += mat4(0.033682905, 0.019728886, 0.19931756, 0.17381927, 0.2585768, -0.2124572, -0.014632459, 0.39779893, -0.1146207, -0.2396625, 0.08960277, 0.38345298, 0.25497693, 0.11692859, -0.14207517, 0.12667973) * go_0(-1.0, 0.0);
  result += mat4(-0.14911255, 0.08910706, 0.16136818, 0.03914566, 0.24204038, -0.03607149, -0.4571109, 0.10802461, -0.0021356856, 0.00885878, 0.22297303, 0.2367231, 0.045177583, 0.11120606, -0.009971904, -0.059262395) * go_0(-1.0, 1.0);
  result += mat4(0.24565999, -0.2261384, 0.47373205, 0.024613412, -0.10923052, 0.039027315, -0.42707404, -0.3783373, 0.3544573, -0.5468578, -0.27599156, -0.09455918, 0.18760219, -0.19082001, 0.030565469, 0.20589156) * go_0(0.0, -1.0);
  result += mat4(0.1973198, -0.03433863, 0.059960485, 0.045642868, 0.1819595, -0.14460869, 0.1286175, 0.2067575, -0.042632047, -0.11842967, -0.11224446, -0.18764776, -0.19563004, 0.027425969, 0.24056377, 0.5949649) * go_0(0.0, 0.0);
  result += mat4(0.055027682, 0.16331595, -0.2608588, 0.12545955, 0.4588985, 0.03642909, 0.22187738, 0.45190734, -0.001210133, -0.057651415, -0.061199043, 0.11935476, -0.049561135, 0.27509886, 0.13778673, -0.124914035) * go_0(0.0, 1.0);
  result += mat4(-0.02257459, 0.27705106, 0.044165276, -0.26521233, 0.05982374, -0.2824302, 0.3171142, 0.08430561, -0.10155528, 0.16182268, -0.09183147, -0.19447176, 0.3295707, -0.50616395, -0.036964044, 0.23166709) * go_0(1.0, -1.0);
  result += mat4(-0.0232342, 0.07299799, -0.18038079, -0.13672702, -0.108305976, 0.15024792, -0.19531927, 0.0870979, -0.26488534, 0.19481428, 0.10737945, -0.14573483, -0.33094683, 0.24155116, -0.09850332, 0.2797003) * go_0(1.0, 0.0);
  result += mat4(-0.24089853, 0.19506595, 0.4799156, -0.058313113, 0.36212957, -0.44844806, 0.23864488, 0.15477742, -0.07795971, -0.0033861927, -0.11216164, 0.033454563, -0.25893036, 0.23793478, -0.15769425, -0.00033481256) * go_0(1.0, 1.0);
  result += mat4(0.05772507, -0.1640253, -0.13499664, -0.20460358, -0.024399966, 0.14966168, -0.090857334, -0.039677754, 0.00036956606, -0.24236615, -0.053542696, -0.0049544116, 0.026651502, 0.39019194, -0.2742246, -0.061242323) * go_1(-1.0, -1.0);
  result += mat4(-0.016323274, -0.036179908, 0.029965919, 0.11151491, -0.00016685206, -0.29573023, 0.17996423, -0.20145437, 0.1324275, -0.18442132, -0.24618152, 0.061780427, -0.02770517, 0.28452995, 0.39804098, -0.1174389) * go_1(-1.0, 0.0);
  result += mat4(-0.025068847, -0.053328387, -0.27053785, 0.26866457, -0.09866204, 0.057677213, 0.01850112, -0.18014707, -0.13319959, -0.14411181, -0.26355243, -0.022209354, -0.05062645, -0.036771543, 0.13294417, -0.18458557) * go_1(-1.0, 1.0);
  result += mat4(-0.046194963, 0.038230438, -0.08993043, -0.07236354, 0.11031123, -0.16504908, -0.09517036, -0.16459833, -0.5279925, 0.12686682, -0.05726125, 0.055361677, 0.31593755, 0.027328093, 0.001839602, 0.30581662) * go_1(0.0, -1.0);
  result += mat4(0.08608678, 0.03168437, 0.007713377, -0.26140293, -0.1268983, 0.13395861, -0.069848835, -0.24080403, 0.018839337, -0.049821075, -0.21461345, -0.14168301, -0.0872339, 0.47096667, 0.022512507, 0.14860632) * go_1(0.0, 0.0);
  result += mat4(0.06293673, 0.22462969, 0.045494985, 0.021673543, 0.18227446, -0.2956555, 0.08010543, -0.01919729, -0.012190269, 0.241983, -0.046537094, -0.40094566, -0.3853647, 0.1081711, -0.16926058, 0.16138376) * go_1(0.0, 1.0);
  result += mat4(-0.14854589, -0.17625804, -0.10849075, 0.221543, 0.099971965, 0.13901573, 0.29464146, 0.020068526, 0.054358527, -0.10351705, -0.0062914286, 0.24127026, -0.16914125, 0.12729423, -0.18377453, -0.6452375) * go_1(1.0, -1.0);
  result += mat4(0.12603393, -0.10986093, 0.2314103, 0.16915044, -0.13619255, -0.09349073, 0.20594226, -0.34507084, 0.19077192, 0.052500796, 0.07185645, 0.029082738, -0.015576321, 0.08254907, -0.5501743, -0.38495848) * go_1(1.0, 0.0);
  result += mat4(0.09300796, -0.079218306, 0.46825135, -0.08735625, 0.06321122, 0.16234867, 0.042932414, -0.013057422, 0.09697148, 0.23457524, 0.19417483, -0.16804664, 0.18379296, 0.17770062, -0.050235, -0.059676602) * go_1(1.0, 1.0);
  result += vec4(0.011169491, 0.032399546, 0.138099, 0.023857072);
  gl_FragColor = result;
}
`,t0=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D conv2d_5_tf;
#define conv2d_5_tf_pos (v_texture_coord)
#define conv2d_5_tf_tex(pos) (texture2D(conv2d_5_tf, pos))
#define conv2d_5_tf_size (u_texture_size)
#define conv2d_5_tf_pt (1.0 / conv2d_5_tf_size)
#define conv2d_5_tf_texOff(offset) (conv2d_5_tf_tex(conv2d_5_tf_pos + conv2d_5_tf_pt * offset))

#define go_0(x_off, y_off) (max((conv2d_5_tf_texOff(vec2(x_off, y_off))), 0.0))
#define go_1(x_off, y_off) (max(-(conv2d_5_tf_texOff(vec2(x_off, y_off))), 0.0))
void main() {
  vec4 result = mat4(-0.22753362, -0.08612073, 0.33140692, 0.08699529, -0.18788953, -0.056579117, -0.12905197, -0.06694621, 0.054559365, 0.15031597, -0.13430363, 0.021646025, 0.14884405, -0.0694291, 0.26149413, 0.11270503) * go_0(-1.0, -1.0);
  result += mat4(0.17876762, -0.09637848, 0.11285323, 0.2004893, 0.1317187, -0.036162686, 0.17958368, -0.069625, 0.28760737, -0.12505141, 0.12760694, 0.047717955, -0.16811855, -0.16340709, 0.13278298, -0.08403954) * go_0(-1.0, 0.0);
  result += mat4(-0.21917523, 0.079711854, -0.28642535, 0.2822416, 0.03001489, -0.014772918, -0.3487396, 0.10597145, -0.013841082, 0.17034237, 0.10810282, -0.08089695, -0.22184245, -0.59067357, 0.44113398, 0.13045649) * go_0(-1.0, 1.0);
  result += mat4(-0.29906932, 0.013923749, 0.2031124, -0.11846688, -0.13953634, 0.08003455, -0.10164494, -0.21218559, 0.10563715, 0.31033117, -0.075903505, 0.047310907, -0.37824214, -0.14506383, 0.11866701, -0.21384487) * go_0(0.0, -1.0);
  result += mat4(-0.1353849, 0.19258606, 0.063908584, -0.2043788, 0.27244982, 0.1665306, -0.29357895, -0.22441709, 0.18514316, -0.17840464, 0.20986097, 0.14351055, -0.057732623, 0.42166704, -0.23182064, -0.4957248) * go_0(0.0, 0.0);
  result += mat4(-0.34830126, 0.109066755, -0.28285867, -0.048280068, -0.12290918, 0.04291651, -0.047484186, -0.03702595, 0.23047262, 0.09398974, 0.022467108, 0.08271034, 0.3066665, -0.54077, 0.057771873, 0.23194093) * go_0(0.0, 1.0);
  result += mat4(-0.17731948, -0.3175927, 0.1452728, 0.09396786, -0.16433562, -0.01833653, -0.22345604, -0.04161193, -0.14827462, 0.18544114, -0.15544125, -0.06179007, 0.16989979, -0.20985202, 0.16391534, -0.09447268) * go_0(1.0, -1.0);
  result += mat4(-0.053878862, -0.21034616, 0.023831524, 0.19772215, 0.31647214, 0.0126534775, -0.19130844, -0.049282108, -0.21446131, 0.067189045, 0.09117449, -0.25548774, 0.12109098, 0.22009392, -0.3924665, -0.13340388) * go_0(1.0, 0.0);
  result += mat4(-0.16096684, -0.18495405, 0.10410178, 0.0015673033, -0.00183498, -0.044303037, -0.062745355, -0.090802394, 0.043269135, 0.06924481, -0.21367405, -0.14619029, 0.11555763, -0.20292862, 0.5799557, 0.14739846) * go_0(1.0, 1.0);
  result += mat4(-0.21030277, -0.09578802, 0.013482288, -0.21484336, 0.12995781, 0.40431052, -0.3347856, -0.18183486, 0.15550353, -0.04402301, 0.4603779, 0.14874357, -0.07694621, -0.053523075, -0.19607326, -0.10850742) * go_1(-1.0, -1.0);
  result += mat4(-0.2347211, 0.2697403, -0.0634794, -0.17925987, 0.17231455, 0.24999185, -0.5208536, -0.10491828, -0.233575, 0.52950364, 0.0038063182, -0.1380038, 0.022935199, 0.19369157, 0.14586553, 0.1938704) * go_1(-1.0, 0.0);
  result += mat4(-0.10245223, 0.34150192, 0.25862157, -0.20165509, 0.5597771, 0.114510864, -0.122526556, -0.04010975, 0.1704679, -0.23335956, -0.16771887, -0.03783455, -0.056995615, 0.24153493, -0.08082429, -0.24210933) * go_1(-1.0, 1.0);
  result += mat4(-0.103466526, 0.15278348, -0.30526164, -0.080755696, 0.103505425, 0.15862796, 0.14696524, -0.008358076, -0.09180311, -0.12505089, 0.28052542, -0.13551563, 0.07528779, -0.09636086, -0.10369617, 0.23656134) * go_1(0.0, -1.0);
  result += mat4(-0.25752836, 0.099439755, -0.30716348, 0.035077725, 0.023509016, 0.23106368, 0.05277125, 0.34910464, 0.088015385, 0.26995596, 0.1390645, -0.40671825, 0.18096298, -0.100688554, 0.5492049, 0.2482101) * go_1(0.0, 0.0);
  result += mat4(0.41411775, -0.107200556, -0.13813478, 0.13768874, 0.27137747, 0.06313619, -0.08522967, 0.03218302, -0.03166121, -0.3415683, -0.52242, -0.1741813, -0.36956537, 0.179129, -0.09742935, -0.11696616) * go_1(0.0, 1.0);
  result += mat4(-0.07975504, 0.17964838, 0.37122533, 0.16064765, 0.14309953, 0.29473078, 0.0926391, -0.22333665, 0.34612748, -0.3387473, 0.0077308523, -0.07239449, 0.18522519, -0.21297298, 0.11493978, 0.16117814) * go_1(1.0, -1.0);
  result += mat4(-0.17402779, 0.10023144, 0.11712206, 0.031971734, 0.18713303, 0.08736295, 0.013007052, -0.06943139, -0.20102951, -0.010721135, -0.2562522, 0.34877458, -0.13732676, -0.40258047, 0.25824392, 0.15720639) * go_1(1.0, 0.0);
  result += mat4(0.044494305, 0.3296108, 0.0017603852, 0.09362289, 0.38839245, 0.40015858, -0.13395199, -0.044521853, -0.56266373, 0.251378, 0.5005789, -0.13106057, -0.18491416, -0.046887, 0.067797676, -0.14694957) * go_1(1.0, 1.0);
  result += vec4(0.013687534, -0.08185164, -0.04755438, 0.290178);
  gl_FragColor = result;
}
`,e0=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D MAIN;
#define MAIN_pos (v_texture_coord)
#define MAIN_tex(pos) (texture2D(MAIN, pos))
#define MAIN_size (u_texture_size)
#define MAIN_pt (1.0 / MAIN_size)
#define MAIN_texOff(offset) (MAIN_tex(MAIN_pos + MAIN_pt * offset))

uniform sampler2D conv2d_tf;
#define conv2d_tf_pos (v_texture_coord)
#define conv2d_tf_tex(pos) (texture2D(conv2d_tf, pos))
#define conv2d_tf_size (u_texture_size)
#define conv2d_tf_pt (1.0 / conv2d_tf_size)
#define conv2d_tf_texOff(offset) (conv2d_tf_tex(conv2d_tf_pos + conv2d_tf_pt * offset))

uniform sampler2D conv2d_1_tf;
#define conv2d_1_tf_pos (v_texture_coord)
#define conv2d_1_tf_tex(pos) (texture2D(conv2d_1_tf, pos))
#define conv2d_1_tf_size (u_texture_size)
#define conv2d_1_tf_pt (1.0 / conv2d_1_tf_size)
#define conv2d_1_tf_texOff(offset) (conv2d_1_tf_tex(conv2d_1_tf_pos + conv2d_1_tf_pt * offset))

uniform sampler2D conv2d_2_tf;
#define conv2d_2_tf_pos (v_texture_coord)
#define conv2d_2_tf_tex(pos) (texture2D(conv2d_2_tf, pos))
#define conv2d_2_tf_size (u_texture_size)
#define conv2d_2_tf_pt (1.0 / conv2d_2_tf_size)
#define conv2d_2_tf_texOff(offset) (conv2d_2_tf_tex(conv2d_2_tf_pos + conv2d_2_tf_pt * offset))

uniform sampler2D conv2d_3_tf;
#define conv2d_3_tf_pos (v_texture_coord)
#define conv2d_3_tf_tex(pos) (texture2D(conv2d_3_tf, pos))
#define conv2d_3_tf_size (u_texture_size)
#define conv2d_3_tf_pt (1.0 / conv2d_3_tf_size)
#define conv2d_3_tf_texOff(offset) (conv2d_3_tf_tex(conv2d_3_tf_pos + conv2d_3_tf_pt * offset))

uniform sampler2D conv2d_4_tf;
#define conv2d_4_tf_pos (v_texture_coord)
#define conv2d_4_tf_tex(pos) (texture2D(conv2d_4_tf, pos))
#define conv2d_4_tf_size (u_texture_size)
#define conv2d_4_tf_pt (1.0 / conv2d_4_tf_size)
#define conv2d_4_tf_texOff(offset) (conv2d_4_tf_tex(conv2d_4_tf_pos + conv2d_4_tf_pt * offset))

uniform sampler2D conv2d_5_tf;
#define conv2d_5_tf_pos (v_texture_coord)
#define conv2d_5_tf_tex(pos) (texture2D(conv2d_5_tf, pos))
#define conv2d_5_tf_size (u_texture_size)
#define conv2d_5_tf_pt (1.0 / conv2d_5_tf_size)
#define conv2d_5_tf_texOff(offset) (conv2d_5_tf_tex(conv2d_5_tf_pos + conv2d_5_tf_pt * offset))

uniform sampler2D conv2d_6_tf;
#define conv2d_6_tf_pos (v_texture_coord)
#define conv2d_6_tf_tex(pos) (texture2D(conv2d_6_tf, pos))
#define conv2d_6_tf_size (u_texture_size)
#define conv2d_6_tf_pt (1.0 / conv2d_6_tf_size)
#define conv2d_6_tf_texOff(offset) (conv2d_6_tf_tex(conv2d_6_tf_pos + conv2d_6_tf_pt * offset))

#define g_0 (max((conv2d_tf_tex(conv2d_tf_pos)), 0.0))
#define g_1 (max(-(conv2d_tf_tex(conv2d_tf_pos)), 0.0))
#define g_2 (max((conv2d_1_tf_tex(conv2d_1_tf_pos)), 0.0))
#define g_3 (max(-(conv2d_1_tf_tex(conv2d_1_tf_pos)), 0.0))
#define g_4 (max((conv2d_2_tf_tex(conv2d_2_tf_pos)), 0.0))
#define g_5 (max(-(conv2d_2_tf_tex(conv2d_2_tf_pos)), 0.0))
#define g_6 (max((conv2d_3_tf_tex(conv2d_3_tf_pos)), 0.0))
#define g_7 (max(-(conv2d_3_tf_tex(conv2d_3_tf_pos)), 0.0))
#define g_8 (max((conv2d_4_tf_tex(conv2d_4_tf_pos)), 0.0))
#define g_9 (max(-(conv2d_4_tf_tex(conv2d_4_tf_pos)), 0.0))
#define g_10 (max((conv2d_5_tf_tex(conv2d_5_tf_pos)), 0.0))
#define g_11 (max(-(conv2d_5_tf_tex(conv2d_5_tf_pos)), 0.0))
#define g_12 (max((conv2d_6_tf_tex(conv2d_6_tf_pos)), 0.0))
#define g_13 (max(-(conv2d_6_tf_tex(conv2d_6_tf_pos)), 0.0))
void main() {
  vec4 result = mat4(-0.08837163, -0.065234736, -0.034704313, 0.0, 0.021405501, 0.013663729, 0.019249594, 0.0, 0.05328863, 0.03580334, 0.046457592, 0.0, -0.12216048, 0.022547891, 0.016400825, 0.0) * g_0;
  result += mat4(0.061996464, 0.05631466, 0.06808407, 0.0, -0.005013109, -0.0044589997, -0.032367796, 0.0, 0.016481603, 0.13721058, 0.14924648, 0.0, 0.020035887, -0.07250003, -0.08034037, 0.0) * g_1;
  result += mat4(0.24078514, 0.081361525, 0.053420708, 0.0, -0.009353794, -0.051077116, -0.058007747, 0.0, -0.14071098, 0.01035966, 0.005308949, 0.0, -0.1489842, -0.06711817, -0.05552926, 0.0) * g_2;
  result += mat4(-0.13002375, 0.012733757, 0.017821986, 0.0, 0.17767483, 0.20204604, 0.1751779, 0.0, 0.12804912, 0.07381453, 0.05655911, 0.0, 0.17044514, 0.07301451, 0.06523978, 0.0) * g_3;
  result += mat4(-0.1170986, -0.05130371, -0.027939914, 0.0, -0.16645707, -0.121526904, -0.09471366, 0.0, -0.04143118, 0.026693767, 0.034615446, 0.0, -0.084318705, -0.064990036, -0.054324172, 0.0) * g_4;
  result += mat4(0.12094524, 0.09518409, 0.07387219, 0.0, 0.062216382, 0.053228356, 0.031372335, 0.0, 0.072797105, 0.026258165, 0.009804673, 0.0, 0.120719045, 0.073281154, 0.056623302, 0.0) * g_5;
  result += mat4(-0.11141495, -0.11566289, -0.10398725, 0.0, -0.0651895, -0.06820691, -0.054204144, 0.0, -0.032746475, -0.008849683, -0.007610222, 0.0, -0.024655705, -0.048778858, -0.041144755, 0.0) * g_6;
  result += mat4(0.058090195, 0.07538767, 0.059722915, 0.0, 0.044788487, 0.04212742, 0.027502589, 0.0, 0.04892866, 0.015416752, 0.008312418, 0.0, -0.011864114, -0.0074752793, -0.0060824654, 0.0) * g_7;
  result += mat4(0.043446552, 0.061971307, 0.05758086, 0.0, -0.06379154, -0.053758245, -0.047204215, 0.0, 0.016307736, 0.03423424, 0.030179083, 0.0, 0.041445345, 0.03843772, 0.033059113, 0.0) * g_8;
  result += mat4(-0.003803544, 0.0008906116, -0.00059585314, 0.0, 0.102071285, 0.11485224, 0.10007254, 0.0, -0.074306004, -0.08803551, -0.07972321, 0.0, -0.030704215, -0.021514274, -0.009049376, 0.0) * g_9;
  result += mat4(0.0066058086, 0.0011408008, 0.0016199006, 0.0, -0.03916473, -0.042929266, -0.04018418, 0.0, -0.03153446, -0.039413508, -0.034767237, 0.0, 0.113516055, 0.12577052, 0.113335624, 0.0) * g_10;
  result += mat4(0.02655948, 0.041905303, 0.03861737, 0.0, 0.048471425, 0.049788587, 0.050447535, 0.0, 0.12092813, 0.13564217, 0.12613249, 0.0, -0.0023508538, 0.0012828974, 0.0028730957, 0.0) * g_11;
  result += mat4(0.0084758485, 0.008800083, 0.008206044, 0.0, -0.056123603, -0.06610845, -0.060320783, 0.0, -0.081793964, -0.101638645, -0.096699014, 0.0, -0.04402356, -0.04177539, -0.03829645, 0.0) * g_12;
  result += mat4(0.10676299, 0.118409514, 0.10618478, 0.0, -0.05880252, -0.06488367, -0.06432695, 0.0, 0.019221924, 0.017602798, 0.017413978, 0.0, -0.07512528, -0.080483615, -0.066218294, 0.0) * g_13;
  result += vec4(-0.010478934, -0.008364784, -0.010246552, 0.0);
  gl_FragColor = result + MAIN_tex(MAIN_pos);
}
`,O=class extends b{gl;texcoordBuffer;program_0;program_1;program_2;program_3;program_4;program_5;program_6;program_7;program_0_intermediate_texture;program_1_intermediate_texture;program_2_intermediate_texture;program_3_intermediate_texture;program_4_intermediate_texture;program_5_intermediate_texture;program_6_intermediate_texture;program_7_intermediate_texture;program_0_intermediate_texture_cached_width;program_1_intermediate_texture_cached_width;program_2_intermediate_texture_cached_width;program_3_intermediate_texture_cached_width;program_4_intermediate_texture_cached_width;program_5_intermediate_texture_cached_width;program_6_intermediate_texture_cached_width;program_7_intermediate_texture_cached_width;program_0_intermediate_texture_cached_height;program_1_intermediate_texture_cached_height;program_2_intermediate_texture_cached_height;program_3_intermediate_texture_cached_height;program_4_intermediate_texture_cached_height;program_5_intermediate_texture_cached_height;program_6_intermediate_texture_cached_height;program_7_intermediate_texture_cached_height;program_0_a_position_location;program_1_a_position_location;program_2_a_position_location;program_3_a_position_location;program_4_a_position_location;program_5_a_position_location;program_6_a_position_location;program_7_a_position_location;program_0_a_texture_coord_location;program_1_a_texture_coord_location;program_2_a_texture_coord_location;program_3_a_texture_coord_location;program_4_a_texture_coord_location;program_5_a_texture_coord_location;program_6_a_texture_coord_location;program_7_a_texture_coord_location;program_0_u_resolution_location;program_1_u_resolution_location;program_2_u_resolution_location;program_3_u_resolution_location;program_4_u_resolution_location;program_5_u_resolution_location;program_6_u_resolution_location;program_7_u_resolution_location;program_0_u_texture_size_location;program_1_u_texture_size_location;program_2_u_texture_size_location;program_3_u_texture_size_location;program_4_u_texture_size_location;program_5_u_texture_size_location;program_6_u_texture_size_location;program_7_u_texture_size_location;program_0_MAIN_TextureLocation;program_1_conv2d_tf_TextureLocation;program_2_conv2d_1_tf_TextureLocation;program_3_conv2d_2_tf_TextureLocation;program_4_conv2d_3_tf_TextureLocation;program_5_conv2d_4_tf_TextureLocation;program_6_conv2d_5_tf_TextureLocation;program_7_MAIN_TextureLocation;program_7_conv2d_tf_TextureLocation;program_7_conv2d_1_tf_TextureLocation;program_7_conv2d_2_tf_TextureLocation;program_7_conv2d_3_tf_TextureLocation;program_7_conv2d_4_tf_TextureLocation;program_7_conv2d_5_tf_TextureLocation;program_7_conv2d_6_tf_TextureLocation;program_0_position_buffer;program_1_position_buffer;program_2_position_buffer;program_3_position_buffer;program_4_position_buffer;program_5_position_buffer;program_6_position_buffer;program_7_position_buffer;constructor(e){super(),this.gl=e,this.texcoordBuffer=f(e,0,0,1,1),this.program_0=x(e,g(e,A),l(e,Y)),this.program_1=x(e,g(e,A),l(e,j)),this.program_2=x(e,g(e,A),l(e,q)),this.program_3=x(e,g(e,A),l(e,J)),this.program_4=x(e,g(e,A),l(e,Q)),this.program_5=x(e,g(e,A),l(e,$)),this.program_6=x(e,g(e,A),l(e,t0)),this.program_7=x(e,g(e,A),l(e,e0)),this.program_0_intermediate_texture=p(e,e.NEAREST),this.program_1_intermediate_texture=p(e,e.NEAREST),this.program_2_intermediate_texture=p(e,e.NEAREST),this.program_3_intermediate_texture=p(e,e.NEAREST),this.program_4_intermediate_texture=p(e,e.NEAREST),this.program_5_intermediate_texture=p(e,e.NEAREST),this.program_6_intermediate_texture=p(e,e.NEAREST),this.program_7_intermediate_texture=p(e,e.NEAREST),this.program_0_intermediate_texture_cached_width=null,this.program_1_intermediate_texture_cached_width=null,this.program_2_intermediate_texture_cached_width=null,this.program_3_intermediate_texture_cached_width=null,this.program_4_intermediate_texture_cached_width=null,this.program_5_intermediate_texture_cached_width=null,this.program_6_intermediate_texture_cached_width=null,this.program_7_intermediate_texture_cached_width=null,this.program_0_intermediate_texture_cached_height=null,this.program_1_intermediate_texture_cached_height=null,this.program_2_intermediate_texture_cached_height=null,this.program_3_intermediate_texture_cached_height=null,this.program_4_intermediate_texture_cached_height=null,this.program_5_intermediate_texture_cached_height=null,this.program_6_intermediate_texture_cached_height=null,this.program_7_intermediate_texture_cached_height=null,this.program_0_a_position_location=e.getAttribLocation(this.program_0,"a_position"),e.enableVertexAttribArray(this.program_0_a_position_location),this.program_1_a_position_location=e.getAttribLocation(this.program_1,"a_position"),e.enableVertexAttribArray(this.program_1_a_position_location),this.program_2_a_position_location=e.getAttribLocation(this.program_2,"a_position"),e.enableVertexAttribArray(this.program_2_a_position_location),this.program_3_a_position_location=e.getAttribLocation(this.program_3,"a_position"),e.enableVertexAttribArray(this.program_3_a_position_location),this.program_4_a_position_location=e.getAttribLocation(this.program_4,"a_position"),e.enableVertexAttribArray(this.program_4_a_position_location),this.program_5_a_position_location=e.getAttribLocation(this.program_5,"a_position"),e.enableVertexAttribArray(this.program_5_a_position_location),this.program_6_a_position_location=e.getAttribLocation(this.program_6,"a_position"),e.enableVertexAttribArray(this.program_6_a_position_location),this.program_7_a_position_location=e.getAttribLocation(this.program_7,"a_position"),e.enableVertexAttribArray(this.program_7_a_position_location),this.program_0_a_texture_coord_location=e.getAttribLocation(this.program_0,"a_texture_coord"),e.enableVertexAttribArray(this.program_0_a_texture_coord_location),this.program_1_a_texture_coord_location=e.getAttribLocation(this.program_1,"a_texture_coord"),e.enableVertexAttribArray(this.program_1_a_texture_coord_location),this.program_2_a_texture_coord_location=e.getAttribLocation(this.program_2,"a_texture_coord"),e.enableVertexAttribArray(this.program_2_a_texture_coord_location),this.program_3_a_texture_coord_location=e.getAttribLocation(this.program_3,"a_texture_coord"),e.enableVertexAttribArray(this.program_3_a_texture_coord_location),this.program_4_a_texture_coord_location=e.getAttribLocation(this.program_4,"a_texture_coord"),e.enableVertexAttribArray(this.program_4_a_texture_coord_location),this.program_5_a_texture_coord_location=e.getAttribLocation(this.program_5,"a_texture_coord"),e.enableVertexAttribArray(this.program_5_a_texture_coord_location),this.program_6_a_texture_coord_location=e.getAttribLocation(this.program_6,"a_texture_coord"),e.enableVertexAttribArray(this.program_6_a_texture_coord_location),this.program_7_a_texture_coord_location=e.getAttribLocation(this.program_7,"a_texture_coord"),e.enableVertexAttribArray(this.program_7_a_texture_coord_location),this.program_0_u_resolution_location=e.getUniformLocation(this.program_0,"u_resolution"),this.program_1_u_resolution_location=e.getUniformLocation(this.program_1,"u_resolution"),this.program_2_u_resolution_location=e.getUniformLocation(this.program_2,"u_resolution"),this.program_3_u_resolution_location=e.getUniformLocation(this.program_3,"u_resolution"),this.program_4_u_resolution_location=e.getUniformLocation(this.program_4,"u_resolution"),this.program_5_u_resolution_location=e.getUniformLocation(this.program_5,"u_resolution"),this.program_6_u_resolution_location=e.getUniformLocation(this.program_6,"u_resolution"),this.program_7_u_resolution_location=e.getUniformLocation(this.program_7,"u_resolution"),this.program_0_u_texture_size_location=e.getUniformLocation(this.program_0,"u_texture_size"),this.program_1_u_texture_size_location=e.getUniformLocation(this.program_1,"u_texture_size"),this.program_2_u_texture_size_location=e.getUniformLocation(this.program_2,"u_texture_size"),this.program_3_u_texture_size_location=e.getUniformLocation(this.program_3,"u_texture_size"),this.program_4_u_texture_size_location=e.getUniformLocation(this.program_4,"u_texture_size"),this.program_5_u_texture_size_location=e.getUniformLocation(this.program_5,"u_texture_size"),this.program_6_u_texture_size_location=e.getUniformLocation(this.program_6,"u_texture_size"),this.program_7_u_texture_size_location=e.getUniformLocation(this.program_7,"u_texture_size"),this.program_0_MAIN_TextureLocation=e.getUniformLocation(this.program_0,"MAIN"),this.program_1_conv2d_tf_TextureLocation=e.getUniformLocation(this.program_1,"conv2d_tf"),this.program_2_conv2d_1_tf_TextureLocation=e.getUniformLocation(this.program_2,"conv2d_1_tf"),this.program_3_conv2d_2_tf_TextureLocation=e.getUniformLocation(this.program_3,"conv2d_2_tf"),this.program_4_conv2d_3_tf_TextureLocation=e.getUniformLocation(this.program_4,"conv2d_3_tf"),this.program_5_conv2d_4_tf_TextureLocation=e.getUniformLocation(this.program_5,"conv2d_4_tf"),this.program_6_conv2d_5_tf_TextureLocation=e.getUniformLocation(this.program_6,"conv2d_5_tf"),this.program_7_MAIN_TextureLocation=e.getUniformLocation(this.program_7,"MAIN"),this.program_7_conv2d_tf_TextureLocation=e.getUniformLocation(this.program_7,"conv2d_tf"),this.program_7_conv2d_1_tf_TextureLocation=e.getUniformLocation(this.program_7,"conv2d_1_tf"),this.program_7_conv2d_2_tf_TextureLocation=e.getUniformLocation(this.program_7,"conv2d_2_tf"),this.program_7_conv2d_3_tf_TextureLocation=e.getUniformLocation(this.program_7,"conv2d_3_tf"),this.program_7_conv2d_4_tf_TextureLocation=e.getUniformLocation(this.program_7,"conv2d_4_tf"),this.program_7_conv2d_5_tf_TextureLocation=e.getUniformLocation(this.program_7,"conv2d_5_tf"),this.program_7_conv2d_6_tf_TextureLocation=e.getUniformLocation(this.program_7,"conv2d_6_tf"),this.program_0_position_buffer=null,this.program_1_position_buffer=null,this.program_2_position_buffer=null,this.program_3_position_buffer=null,this.program_4_position_buffer=null,this.program_5_position_buffer=null,this.program_6_position_buffer=null,this.program_7_position_buffer=null}destroy(){let e=this.gl;this.texcoordBuffer!=null&&e.deleteBuffer(this.texcoordBuffer),this.program_0_intermediate_texture!=null&&e.deleteTexture(this.program_0_intermediate_texture),this.program_0_position_buffer!=null&&e.deleteBuffer(this.program_0_position_buffer),this.program_0!=null&&e.deleteProgram(this.program_0),this.program_1_intermediate_texture!=null&&e.deleteTexture(this.program_1_intermediate_texture),this.program_1_position_buffer!=null&&e.deleteBuffer(this.program_1_position_buffer),this.program_1!=null&&e.deleteProgram(this.program_1),this.program_2_intermediate_texture!=null&&e.deleteTexture(this.program_2_intermediate_texture),this.program_2_position_buffer!=null&&e.deleteBuffer(this.program_2_position_buffer),this.program_2!=null&&e.deleteProgram(this.program_2),this.program_3_intermediate_texture!=null&&e.deleteTexture(this.program_3_intermediate_texture),this.program_3_position_buffer!=null&&e.deleteBuffer(this.program_3_position_buffer),this.program_3!=null&&e.deleteProgram(this.program_3),this.program_4_intermediate_texture!=null&&e.deleteTexture(this.program_4_intermediate_texture),this.program_4_position_buffer!=null&&e.deleteBuffer(this.program_4_position_buffer),this.program_4!=null&&e.deleteProgram(this.program_4),this.program_5_intermediate_texture!=null&&e.deleteTexture(this.program_5_intermediate_texture),this.program_5_position_buffer!=null&&e.deleteBuffer(this.program_5_position_buffer),this.program_5!=null&&e.deleteProgram(this.program_5),this.program_6_intermediate_texture!=null&&e.deleteTexture(this.program_6_intermediate_texture),this.program_6_position_buffer!=null&&e.deleteBuffer(this.program_6_position_buffer),this.program_6!=null&&e.deleteProgram(this.program_6),this.program_7_intermediate_texture!=null&&e.deleteTexture(this.program_7_intermediate_texture),this.program_7_position_buffer!=null&&e.deleteBuffer(this.program_7_position_buffer),this.program_7!=null&&e.deleteProgram(this.program_7)}magnification(){let e=new Map([["MAIN",{width:1,height:1}],["NATIVE",{width:1,height:1}],["OUTPUT",{width:1,height:1}]]);{if(!e.get("MAIN"))return[1,1];let s=e.get("MAIN");if(!s)return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];e.set("conv2d_tf",{width:s.width,height:s.height})}{if(!e.get("MAIN"))return[1,1];if(!e.get("MAIN"))return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];let o=e.get("conv2d_tf");if(!o)return[1,1];e.set("conv2d_1_tf",{width:o.width,height:o.height})}{if(!e.get("MAIN"))return[1,1];if(!e.get("MAIN"))return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];let o=e.get("conv2d_1_tf");if(!o)return[1,1];e.set("conv2d_2_tf",{width:o.width,height:o.height})}{if(!e.get("MAIN"))return[1,1];if(!e.get("MAIN"))return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];let o=e.get("conv2d_2_tf");if(!o)return[1,1];e.set("conv2d_3_tf",{width:o.width,height:o.height})}{if(!e.get("MAIN"))return[1,1];if(!e.get("MAIN"))return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];let o=e.get("conv2d_3_tf");if(!o)return[1,1];e.set("conv2d_4_tf",{width:o.width,height:o.height})}{if(!e.get("MAIN"))return[1,1];if(!e.get("MAIN"))return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];let o=e.get("conv2d_4_tf");if(!o)return[1,1];e.set("conv2d_5_tf",{width:o.width,height:o.height})}{if(!e.get("MAIN"))return[1,1];if(!e.get("MAIN"))return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];let o=e.get("conv2d_5_tf");if(!o)return[1,1];e.set("conv2d_6_tf",{width:o.width,height:o.height})}{if(!e.get("MAIN"))return[1,1];if(!e.get("MAIN"))return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];if(!e.get("conv2d_1_tf"))return[1,1];if(!e.get("conv2d_2_tf"))return[1,1];if(!e.get("conv2d_3_tf"))return[1,1];if(!e.get("conv2d_4_tf"))return[1,1];if(!e.get("conv2d_5_tf"))return[1,1];if(!e.get("conv2d_6_tf"))return[1,1];let v=e.get("conv2d_tf");if(!v)return[1,1];e.set("MAIN",{width:v.width,height:v.height})}let u=e.get("MAIN")?.width??1,t=e.get("MAIN")?.height??1;return[u,t]}hook_MAIN(e,u){let t=this.gl,n=this.texcoordBuffer;if(n){{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE")||!e.get("OUTPUT"))return;{let r=this.program_0_intermediate_texture;(this.program_0_intermediate_texture_cached_width!==_.width||this.program_0_intermediate_texture_cached_height!==_.height)&&T(t,r,_.width,_.height),t.viewport(0,0,_.width,_.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,r,0),t.useProgram(this.program_0),this.program_0_position_buffer==null?this.program_0_position_buffer=f(t,0,0,_.width,_.height):(this.program_0_intermediate_texture_cached_width!==_.width||this.program_0_intermediate_texture_cached_height!==_.height)&&(t.deleteBuffer(this.program_0_position_buffer),this.program_0_position_buffer=f(t,0,0,_.width,_.height));let a=this.program_0_position_buffer;m(t,this.program_0_a_position_location,a),m(t,this.program_0_a_texture_coord_location,n),t.uniform2f(this.program_0_u_resolution_location,_.width,_.height),t.uniform2f(this.program_0_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,_.texture),t.uniform1i(this.program_0_MAIN_TextureLocation,0),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),this.program_0_intermediate_texture_cached_width=_.width,this.program_0_intermediate_texture_cached_height=_.height,e.set("conv2d_tf",{texture:r,width:_.width,height:_.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE")||!e.get("OUTPUT"))return;let r=e.get("conv2d_tf");if(!r)return;{let a=this.program_1_intermediate_texture;(this.program_1_intermediate_texture_cached_width!==r.width||this.program_1_intermediate_texture_cached_height!==r.height)&&T(t,a,r.width,r.height),t.viewport(0,0,r.width,r.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,a,0),t.useProgram(this.program_1),this.program_1_position_buffer==null?this.program_1_position_buffer=f(t,0,0,r.width,r.height):(this.program_1_intermediate_texture_cached_width!==r.width||this.program_1_intermediate_texture_cached_height!==r.height)&&(t.deleteBuffer(this.program_1_position_buffer),this.program_1_position_buffer=f(t,0,0,r.width,r.height));let d=this.program_1_position_buffer;m(t,this.program_1_a_position_location,d),m(t,this.program_1_a_texture_coord_location,n),t.uniform2f(this.program_1_u_resolution_location,r.width,r.height),t.uniform2f(this.program_1_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_1_conv2d_tf_TextureLocation,0),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),this.program_1_intermediate_texture_cached_width=r.width,this.program_1_intermediate_texture_cached_height=r.height,e.set("conv2d_1_tf",{texture:a,width:r.width,height:r.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE")||!e.get("OUTPUT"))return;let r=e.get("conv2d_1_tf");if(!r)return;{let a=this.program_2_intermediate_texture;(this.program_2_intermediate_texture_cached_width!==r.width||this.program_2_intermediate_texture_cached_height!==r.height)&&T(t,a,r.width,r.height),t.viewport(0,0,r.width,r.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,a,0),t.useProgram(this.program_2),this.program_2_position_buffer==null?this.program_2_position_buffer=f(t,0,0,r.width,r.height):(this.program_2_intermediate_texture_cached_width!==r.width||this.program_2_intermediate_texture_cached_height!==r.height)&&(t.deleteBuffer(this.program_2_position_buffer),this.program_2_position_buffer=f(t,0,0,r.width,r.height));let d=this.program_2_position_buffer;m(t,this.program_2_a_position_location,d),m(t,this.program_2_a_texture_coord_location,n),t.uniform2f(this.program_2_u_resolution_location,r.width,r.height),t.uniform2f(this.program_2_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_2_conv2d_1_tf_TextureLocation,0),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),this.program_2_intermediate_texture_cached_width=r.width,this.program_2_intermediate_texture_cached_height=r.height,e.set("conv2d_2_tf",{texture:a,width:r.width,height:r.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE")||!e.get("OUTPUT"))return;let r=e.get("conv2d_2_tf");if(!r)return;{let a=this.program_3_intermediate_texture;(this.program_3_intermediate_texture_cached_width!==r.width||this.program_3_intermediate_texture_cached_height!==r.height)&&T(t,a,r.width,r.height),t.viewport(0,0,r.width,r.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,a,0),t.useProgram(this.program_3),this.program_3_position_buffer==null?this.program_3_position_buffer=f(t,0,0,r.width,r.height):(this.program_3_intermediate_texture_cached_width!==r.width||this.program_3_intermediate_texture_cached_height!==r.height)&&(t.deleteBuffer(this.program_3_position_buffer),this.program_3_position_buffer=f(t,0,0,r.width,r.height));let d=this.program_3_position_buffer;m(t,this.program_3_a_position_location,d),m(t,this.program_3_a_texture_coord_location,n),t.uniform2f(this.program_3_u_resolution_location,r.width,r.height),t.uniform2f(this.program_3_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_3_conv2d_2_tf_TextureLocation,0),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),this.program_3_intermediate_texture_cached_width=r.width,this.program_3_intermediate_texture_cached_height=r.height,e.set("conv2d_3_tf",{texture:a,width:r.width,height:r.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE")||!e.get("OUTPUT"))return;let r=e.get("conv2d_3_tf");if(!r)return;{let a=this.program_4_intermediate_texture;(this.program_4_intermediate_texture_cached_width!==r.width||this.program_4_intermediate_texture_cached_height!==r.height)&&T(t,a,r.width,r.height),t.viewport(0,0,r.width,r.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,a,0),t.useProgram(this.program_4),this.program_4_position_buffer==null?this.program_4_position_buffer=f(t,0,0,r.width,r.height):(this.program_4_intermediate_texture_cached_width!==r.width||this.program_4_intermediate_texture_cached_height!==r.height)&&(t.deleteBuffer(this.program_4_position_buffer),this.program_4_position_buffer=f(t,0,0,r.width,r.height));let d=this.program_4_position_buffer;m(t,this.program_4_a_position_location,d),m(t,this.program_4_a_texture_coord_location,n),t.uniform2f(this.program_4_u_resolution_location,r.width,r.height),t.uniform2f(this.program_4_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_4_conv2d_3_tf_TextureLocation,0),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),this.program_4_intermediate_texture_cached_width=r.width,this.program_4_intermediate_texture_cached_height=r.height,e.set("conv2d_4_tf",{texture:a,width:r.width,height:r.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE")||!e.get("OUTPUT"))return;let r=e.get("conv2d_4_tf");if(!r)return;{let a=this.program_5_intermediate_texture;(this.program_5_intermediate_texture_cached_width!==r.width||this.program_5_intermediate_texture_cached_height!==r.height)&&T(t,a,r.width,r.height),t.viewport(0,0,r.width,r.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,a,0),t.useProgram(this.program_5),this.program_5_position_buffer==null?this.program_5_position_buffer=f(t,0,0,r.width,r.height):(this.program_5_intermediate_texture_cached_width!==r.width||this.program_5_intermediate_texture_cached_height!==r.height)&&(t.deleteBuffer(this.program_5_position_buffer),this.program_5_position_buffer=f(t,0,0,r.width,r.height));let d=this.program_5_position_buffer;m(t,this.program_5_a_position_location,d),m(t,this.program_5_a_texture_coord_location,n),t.uniform2f(this.program_5_u_resolution_location,r.width,r.height),t.uniform2f(this.program_5_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_5_conv2d_4_tf_TextureLocation,0),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),this.program_5_intermediate_texture_cached_width=r.width,this.program_5_intermediate_texture_cached_height=r.height,e.set("conv2d_5_tf",{texture:a,width:r.width,height:r.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE")||!e.get("OUTPUT"))return;let r=e.get("conv2d_5_tf");if(!r)return;{let a=this.program_6_intermediate_texture;(this.program_6_intermediate_texture_cached_width!==r.width||this.program_6_intermediate_texture_cached_height!==r.height)&&T(t,a,r.width,r.height),t.viewport(0,0,r.width,r.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,a,0),t.useProgram(this.program_6),this.program_6_position_buffer==null?this.program_6_position_buffer=f(t,0,0,r.width,r.height):(this.program_6_intermediate_texture_cached_width!==r.width||this.program_6_intermediate_texture_cached_height!==r.height)&&(t.deleteBuffer(this.program_6_position_buffer),this.program_6_position_buffer=f(t,0,0,r.width,r.height));let d=this.program_6_position_buffer;m(t,this.program_6_a_position_location,d),m(t,this.program_6_a_texture_coord_location,n),t.uniform2f(this.program_6_u_resolution_location,r.width,r.height),t.uniform2f(this.program_6_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_6_conv2d_5_tf_TextureLocation,0),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),this.program_6_intermediate_texture_cached_width=r.width,this.program_6_intermediate_texture_cached_height=r.height,e.set("conv2d_6_tf",{texture:a,width:r.width,height:r.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE")||!e.get("OUTPUT"))return;let r=e.get("conv2d_1_tf");if(!r)return;let a=e.get("conv2d_2_tf");if(!a)return;let d=e.get("conv2d_3_tf");if(!d)return;let L=e.get("conv2d_4_tf");if(!L)return;let U=e.get("conv2d_5_tf");if(!U)return;let v=e.get("conv2d_6_tf");if(!v)return;let h=e.get("conv2d_tf");if(!h)return;{let N=this.program_7_intermediate_texture;(this.program_7_intermediate_texture_cached_width!==h.width||this.program_7_intermediate_texture_cached_height!==h.height)&&T(t,N,h.width,h.height),t.viewport(0,0,h.width,h.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,N,0),t.useProgram(this.program_7),this.program_7_position_buffer==null?this.program_7_position_buffer=f(t,0,0,h.width,h.height):(this.program_7_intermediate_texture_cached_width!==h.width||this.program_7_intermediate_texture_cached_height!==h.height)&&(t.deleteBuffer(this.program_7_position_buffer),this.program_7_position_buffer=f(t,0,0,h.width,h.height));let G=this.program_7_position_buffer;m(t,this.program_7_a_position_location,G),m(t,this.program_7_a_texture_coord_location,n),t.uniform2f(this.program_7_u_resolution_location,h.width,h.height),t.uniform2f(this.program_7_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,_.texture),t.uniform1i(this.program_7_MAIN_TextureLocation,0),t.activeTexture(t.TEXTURE1),t.bindTexture(t.TEXTURE_2D,h.texture),t.uniform1i(this.program_7_conv2d_tf_TextureLocation,1),t.activeTexture(t.TEXTURE2),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_7_conv2d_1_tf_TextureLocation,2),t.activeTexture(t.TEXTURE3),t.bindTexture(t.TEXTURE_2D,a.texture),t.uniform1i(this.program_7_conv2d_2_tf_TextureLocation,3),t.activeTexture(t.TEXTURE4),t.bindTexture(t.TEXTURE_2D,d.texture),t.uniform1i(this.program_7_conv2d_3_tf_TextureLocation,4),t.activeTexture(t.TEXTURE5),t.bindTexture(t.TEXTURE_2D,L.texture),t.uniform1i(this.program_7_conv2d_4_tf_TextureLocation,5),t.activeTexture(t.TEXTURE6),t.bindTexture(t.TEXTURE_2D,U.texture),t.uniform1i(this.program_7_conv2d_5_tf_TextureLocation,6),t.activeTexture(t.TEXTURE7),t.bindTexture(t.TEXTURE_2D,v.texture),t.uniform1i(this.program_7_conv2d_6_tf_TextureLocation,7),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE1),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE2),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE3),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE4),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE5),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE6),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE7),t.bindTexture(t.TEXTURE_2D,null),this.program_7_intermediate_texture_cached_width=h.width,this.program_7_intermediate_texture_cached_height=h.height,e.set("MAIN",{texture:N,width:h.width,height:h.height})}}}}hook_PREKERNEL(e,u){let t=this.gl;this.texcoordBuffer}};var E=`
precision highp float;

attribute vec2 a_position;
attribute vec2 a_texture_coord;

uniform vec2 u_resolution;

varying vec2 v_texture_coord;

void main() {
  vec2 zeroToOne = a_position / u_resolution;
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;

  gl_Position = vec4(clipSpace * vec2(1, 1), 0, 1);

  v_texture_coord = a_texture_coord;
}
`,r0=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D MAIN;
#define MAIN_pos (v_texture_coord)
#define MAIN_tex(pos) (texture2D(MAIN, pos))
#define MAIN_size (u_texture_size)
#define MAIN_pt (1.0 / MAIN_size)
#define MAIN_texOff(offset) (MAIN_tex(MAIN_pos + MAIN_pt * offset))

#define go_0(x_off, y_off) (MAIN_texOff(vec2(x_off, y_off)))
void main() {
  vec4 result = mat4(-0.010995803, 0.077095956, -0.043992598, 0.06048717, 0.1164834, -0.11689607, 0.072985925, -0.078805886, 0.01182932, 0.054985743, -0.09018186, 0.044907484, 0.0, 0.0, 0.0, 0.0) * go_0(-1.0, -1.0);
  result += mat4(0.1813623, -0.14752422, 0.025720436, -0.17639883, 0.15697388, 0.10445984, -0.1843076, 0.5264643, 0.047516696, -0.097305484, 0.09740847, -0.29619336, 0.0, 0.0, 0.0, 0.0) * go_0(-1.0, 0.0);
  result += mat4(-0.014534763, 0.09486465, 0.046173926, 0.039391946, 0.09609376, -0.060574662, 0.042200956, -0.3269777, 0.051006425, 0.059818447, 0.04366627, 0.17699827, 0.0, 0.0, 0.0, 0.0) * go_0(-1.0, 1.0);
  result += mat4(0.04268535, -0.08152529, 0.10577459, -0.036936995, -0.051562306, 0.054872766, 0.09194519, 0.0025066638, -0.01073954, 0.00064474024, 0.10038221, 0.02131141, 0.0, 0.0, 0.0, 0.0) * go_0(0.0, -1.0);
  result += mat4(-0.51751363, -0.40028602, 0.3469574, 0.5933738, -0.91357684, -0.67692596, 0.57815677, 0.39809322, -0.16341521, -0.27169713, 0.12232366, 0.4318641, 0.0, 0.0, 0.0, 0.0) * go_0(0.0, 0.0);
  result += mat4(0.12601124, -0.06263236, -0.45907676, -0.41514075, 0.3330334, -0.1929565, -0.6333532, -0.6552794, -0.045809917, 0.046351526, -0.26173338, -0.30252662, 0.0, 0.0, 0.0, 0.0) * go_0(0.0, 1.0);
  result += mat4(0.0030332592, 0.012103107, 0.010537323, -0.02038607, 0.095558085, 0.097704545, 0.083433494, 0.026790185, 0.01943357, -0.061712462, -0.00015703632, -0.032268334, 0.0, 0.0, 0.0, 0.0) * go_0(1.0, -1.0);
  result += mat4(0.016870102, 0.5215812, -0.11525501, 0.027527615, -0.09045733, 0.61310345, -0.1575268, 0.1905386, 0.020172214, 0.3503187, -0.08209157, -0.051328037, 0.0, 0.0, 0.0, 0.0) * go_0(1.0, 0.0);
  result += mat4(0.005494087, -0.010656317, 0.07682753, -0.08116042, -0.03934524, 0.16589017, 0.101483546, -0.066603065, 0.03494657, -0.07885597, 0.074227594, 0.0016264897, 0.0, 0.0, 0.0, 0.0) * go_0(1.0, 1.0);
  result += vec4(0.014463938, -0.0031906287, 0.007015422, -0.003888468);
  gl_FragColor = result;
}
`,_0=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D conv2d_tf;
#define conv2d_tf_pos (v_texture_coord)
#define conv2d_tf_tex(pos) (texture2D(conv2d_tf, pos))
#define conv2d_tf_size (u_texture_size)
#define conv2d_tf_pt (1.0 / conv2d_tf_size)
#define conv2d_tf_texOff(offset) (conv2d_tf_tex(conv2d_tf_pos + conv2d_tf_pt * offset))

#define go_0(x_off, y_off) (max((conv2d_tf_texOff(vec2(x_off, y_off))), 0.0))
#define go_1(x_off, y_off) (max(-(conv2d_tf_texOff(vec2(x_off, y_off))), 0.0))
void main() {
  vec4 result = mat4(-0.08532478, -0.14302494, -0.017921071, -0.0032664281, -0.09841952, 0.024187077, 0.10701477, 0.14110753, -0.05714981, -0.10897174, 0.073803626, 0.103992954, 0.07914382, 0.032193683, -0.18346278, -0.09723936) * go_0(-1.0, -1.0);
  result += mat4(-0.034482613, -0.10742312, -0.047286414, -0.08641124, -0.33896688, -0.036533825, -0.48337597, 0.034040943, -0.13598205, -0.080917805, 0.08540263, -0.012667689, -0.009171425, -0.120026454, -0.20536867, -0.032149274) * go_0(-1.0, 0.0);
  result += mat4(0.18687321, 0.066278316, 0.024327392, 0.08816582, -0.08017908, 0.09488853, 0.26018232, -0.101504356, 0.17487666, 0.31057635, 0.14785016, -0.09622089, -0.07537452, -0.13844088, -0.05810814, 0.09907489) * go_0(-1.0, 1.0);
  result += mat4(-0.04183032, 0.15207712, 0.005002397, 0.32277516, -0.16169126, -0.119836345, -0.04068436, -0.096728764, 0.11943901, 0.1789597, -0.20412198, 0.19009817, 0.36630696, 0.06946421, -0.5254373, -0.11896399) * go_0(0.0, -1.0);
  result += mat4(-0.31916487, -0.98911583, 1.0728644, -0.39280394, 0.33458877, -0.17325239, -0.645045, -0.28524077, -0.14512783, 0.24996442, -0.09837877, 0.05468934, 0.31559715, -0.020504637, -0.026724018, 0.24507573) * go_0(0.0, 0.0);
  result += mat4(-0.23759829, -0.08530173, -0.16665787, -0.22463752, 0.109896734, 0.13446991, -0.049552456, -0.02385489, -0.01245375, 0.3833208, 0.05758832, 0.1528937, 0.0501858, -0.19651426, 0.0076587177, -0.03297025) * go_0(0.0, 1.0);
  result += mat4(0.14554465, -0.01826686, 0.10284085, -0.19152659, -0.017585073, -0.05511482, 0.06362406, 0.023924058, -0.0018977845, -0.103172876, 0.03287086, -0.20085956, 0.36062446, 0.10749464, -0.20984372, 0.018256644) * go_0(1.0, -1.0);
  result += mat4(-0.005534592, 0.3709197, -0.18287498, 0.1720451, 0.030155553, -0.023265475, 0.0058617783, -0.031765483, 0.037328955, -0.2730994, 0.35090837, -0.3269043, -0.028477207, 0.32756507, -0.15989502, 0.12158258) * go_0(1.0, 0.0);
  result += mat4(0.10873739, 0.19583772, 0.060394943, 0.09410379, -0.04739245, 0.026561242, 0.022990001, 0.1093272, -0.01071349, -0.022938967, -0.046423864, 0.2385325, -0.0319821, 0.046962265, 0.09081178, -0.11001857) * go_0(1.0, 1.0);
  result += mat4(0.13012704, 0.112289295, 0.030790284, -0.050499484, 0.11784853, 0.08107028, -0.07556717, -0.15643, 0.015249331, 0.015299608, 0.07748125, 0.054485757, 0.044857923, 0.12161275, -0.048292994, -0.033995003) * go_1(-1.0, -1.0);
  result += mat4(0.12931514, 0.15114146, 0.070513315, 0.11246343, 0.4142387, 0.213479, -0.5439916, 0.07776645, 0.13109331, 0.2021147, 0.25932786, -0.22157331, 0.02377734, -0.014970623, -0.1943276, 0.18440372) * go_1(-1.0, 0.0);
  result += mat4(-0.22365458, -0.19829084, -0.06881161, -0.06468993, 0.17202774, 0.0048758537, -0.09235021, 0.18941896, 0.064125344, -0.09067088, 0.09748182, 0.13561936, -0.05876288, -0.0122420965, -0.054380875, -0.17743628) * go_1(-1.0, 1.0);
  result += mat4(0.18582906, -0.09263032, -0.08210888, -0.20515606, 0.11484005, 0.08557595, 0.0009253741, -0.051202174, -0.18535301, -0.1529345, -0.13092944, 0.03770747, -0.020947013, 0.19187425, -0.15494856, -0.048979875) * go_1(0.0, -1.0);
  result += mat4(-0.38131633, 0.4278787, 0.19763695, 0.27655518, -0.08711912, 0.07374453, -0.064803004, 0.5983854, 0.2361923, -0.057221692, -0.37138999, -0.24259573, 0.13890724, 0.25706333, -0.54021406, 0.08095518) * go_1(0.0, 0.0);
  result += mat4(0.0991328, -0.022651536, -0.029148921, -0.009812537, -0.09523686, -0.15704902, 0.052389514, 0.21561539, 0.1950314, -0.08572602, 0.0016523858, 0.14125621, -0.030999828, 0.12009709, 0.0373512, -0.105043754) * go_1(0.0, 1.0);
  result += mat4(-0.11251988, 0.12106985, 0.011923068, 0.3662747, 0.004800994, 0.017972551, 0.004761366, -0.07934206, -0.13755941, -0.022852683, 0.1502225, 0.009758547, -0.16964264, 0.00984782, 0.07855833, 0.035730787) * go_1(1.0, -1.0);
  result += mat4(0.01964957, -0.27226487, 0.033933397, -0.117632054, -0.009058229, 0.047830686, -0.01125145, 0.136628, 0.0056388285, 0.3028781, -0.12286517, 0.23498532, -0.009319075, -0.444048, 0.16174883, -0.06367683) * go_1(1.0, 0.0);
  result += mat4(0.02343933, -0.010915871, -0.058680378, -0.21886891, -0.010750894, -0.06671997, 0.0602906, -0.07903071, 0.066891186, 0.06650588, 0.14362891, -0.101870626, 0.02264628, -0.06940821, -0.077616625, 0.110911585) * go_1(1.0, 1.0);
  result += vec4(0.032014452, -0.020821465, 0.0826416, -0.002838458);
  gl_FragColor = result;
}
`,o0=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D conv2d_1_tf;
#define conv2d_1_tf_pos (v_texture_coord)
#define conv2d_1_tf_tex(pos) (texture2D(conv2d_1_tf, pos))
#define conv2d_1_tf_size (u_texture_size)
#define conv2d_1_tf_pt (1.0 / conv2d_1_tf_size)
#define conv2d_1_tf_texOff(offset) (conv2d_1_tf_tex(conv2d_1_tf_pos + conv2d_1_tf_pt * offset))

#define go_0(x_off, y_off) (max((conv2d_1_tf_texOff(vec2(x_off, y_off))), 0.0))
#define go_1(x_off, y_off) (max(-(conv2d_1_tf_texOff(vec2(x_off, y_off))), 0.0))
void main() {
  vec4 result = mat4(-0.06963679, -0.07560548, -0.069522075, 0.0038078027, -0.08002613, 0.13671301, 0.084461786, -0.039376218, 0.19136548, -0.123174496, 0.26566333, -0.16583005, -0.18664864, -0.023539122, -0.21928434, -0.026818147) * go_0(-1.0, -1.0);
  result += mat4(0.16660932, -0.18558703, 0.37230486, 0.118128106, -0.14098641, 0.14659132, -0.22217897, 0.12952235, -0.4139033, -0.04308319, 0.12885277, -0.17986743, -0.23556231, -0.08351981, -0.43240538, 0.019033253) * go_0(-1.0, 0.0);
  result += mat4(-0.18008037, -0.04448665, 0.011906908, -0.023056917, 0.18136618, -0.04723555, -0.0050158803, -0.14823224, -0.2105281, 0.023047728, -0.14040631, -0.03178526, -0.13477588, -0.01820428, 0.058358394, 0.23792502) * go_0(-1.0, 1.0);
  result += mat4(0.07363309, -0.061728477, 0.03573137, -0.0050971056, -0.012813505, -0.17236637, 0.1697835, 0.055788577, -0.22263195, 0.10324512, 0.58971673, -0.4872246, -0.1555681, 0.032747746, -0.096495196, 0.070196226) * go_0(0.0, -1.0);
  result += mat4(0.14174286, 0.099460006, -0.088765986, 0.58350676, -0.025177564, -0.46004987, 0.37007022, -0.11437029, -0.5164534, -0.60465246, 0.38859612, -0.32846406, 0.050266482, -0.20334712, 0.18316261, -0.19327633) * go_0(0.0, 0.0);
  result += mat4(-0.09377763, -0.0012762006, -0.028991895, -0.26523829, 0.20173682, 0.037923716, -0.03174243, 0.07103378, -0.10764164, -0.30752546, 0.20556998, -0.1892279, 0.08115748, -0.023550175, -0.07627362, 0.11746628) * go_0(0.0, 1.0);
  result += mat4(-0.06998859, -0.017997518, 0.069938794, -0.14943017, -0.14179112, 0.16643842, -0.110231474, 0.08895815, -0.24074875, 0.3277253, -0.07435203, -0.23452802, 0.039962552, -0.07145652, -0.022511544, -0.04571222) * go_0(1.0, -1.0);
  result += mat4(-0.059785757, -0.23771374, -0.030571314, 0.25222278, 0.106601834, 0.34398326, 0.14511436, -0.03867526, -0.38982397, -0.11944689, 0.12997924, -0.13079585, 0.005729482, 0.012653905, -0.063693404, 0.09632285) * go_0(1.0, 0.0);
  result += mat4(-0.04933823, 0.0547175, 0.050636575, -0.10060694, 0.1344485, 0.19752938, -0.100068115, -0.028829506, -0.14096203, -0.079092234, 0.092109434, 0.011606209, -0.04052607, -0.008347507, 0.06956573, -0.028109524) * go_0(1.0, 1.0);
  result += mat4(0.21918017, -0.11115073, 0.2262453, -0.06889667, -0.11256312, -0.07438075, -0.088454485, 0.13672407, -0.06905764, 0.08128395, 0.016103368, 0.050190717, 0.09691516, 0.05845721, 0.4886816, 0.041121427) * go_1(-1.0, -1.0);
  result += mat4(-0.3449472, 0.09711974, -0.13881907, -0.018265123, 0.27855873, -0.07030004, 0.29545054, 0.37216932, 0.08657718, 0.099066615, -0.10574013, -0.17667885, -0.14855732, -0.11351448, 0.66945946, 0.11312157) * go_1(-1.0, 0.0);
  result += mat4(0.2526151, -0.04594331, -0.06606611, 0.09104881, 0.06857995, -0.075284235, -0.17664689, 0.21578754, 0.0696524, 0.09142951, 0.080997564, -0.0682772, -0.0011445724, -0.11736295, 0.2519232, -0.101926275) * go_1(-1.0, 1.0);
  result += mat4(-0.12913518, 0.058357026, 0.195421, -0.15651494, 0.2877076, 0.0033844314, -0.07831594, 0.052855384, -0.031295884, 0.03301088, -0.18408822, 0.06732994, 0.23742151, -0.12568143, 0.22810535, -0.11545694) * go_1(0.0, -1.0);
  result += mat4(-0.49203303, -0.22656603, 0.1723193, -0.51250046, -0.09742038, 0.758559, -0.3387505, -0.6193586, 0.14136684, 0.27679884, -0.050113205, 0.31041816, -0.36475047, -0.48746544, 0.3233227, 0.4579754) * go_1(0.0, 0.0);
  result += mat4(0.46636763, 0.1507748, -0.2581362, 0.15413165, -0.17160143, 0.14256273, -0.074575804, -0.099299066, -0.0017214464, 0.13778336, -0.07378213, -0.15489665, -0.10533715, -0.0011083825, 0.39584312, 0.0023906573) * go_1(0.0, 1.0);
  result += mat4(0.026959421, -0.06391859, 0.0034752619, 0.14521928, -0.0010877338, -0.032619733, 0.005375293, -0.018952755, 0.03381545, -0.007652831, 0.034141563, 0.046016496, 0.11219674, 0.030913852, 0.077403754, 0.17192438) * go_1(1.0, -1.0);
  result += mat4(0.040326044, 0.17290725, -0.1220239, -0.09594783, -0.025229257, 0.17913155, -0.26623353, -0.033396784, -0.03075146, 0.009143897, -0.0136083895, -0.13886899, 0.075683735, -0.11584183, 0.22182357, 0.19350322) * go_1(1.0, 0.0);
  result += mat4(0.15726025, -0.10215694, -0.060057458, 0.26487043, -0.04075552, -0.016496127, 0.0015382086, 0.108562306, 0.026795091, 0.0441233, -0.08754318, -0.0460157, 0.048422016, 0.14107347, 0.07986661, 0.1047697) * go_1(1.0, 1.0);
  result += vec4(0.0766796, 0.08115133, -0.05703058, 0.14025708);
  gl_FragColor = result;
}
`,i0=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D conv2d_2_tf;
#define conv2d_2_tf_pos (v_texture_coord)
#define conv2d_2_tf_tex(pos) (texture2D(conv2d_2_tf, pos))
#define conv2d_2_tf_size (u_texture_size)
#define conv2d_2_tf_pt (1.0 / conv2d_2_tf_size)
#define conv2d_2_tf_texOff(offset) (conv2d_2_tf_tex(conv2d_2_tf_pos + conv2d_2_tf_pt * offset))

#define go_0(x_off, y_off) (max((conv2d_2_tf_texOff(vec2(x_off, y_off))), 0.0))
#define go_1(x_off, y_off) (max(-(conv2d_2_tf_texOff(vec2(x_off, y_off))), 0.0))
void main() {
  vec4 result = mat4(-0.18038331, 0.21830973, -0.10019419, -0.022745568, -0.14944611, -0.15669158, 0.46361133, -0.07289843, 0.02976627, -0.09000817, 0.113060996, 0.05635241, 0.012762965, -0.022688959, 0.01629751, 0.061114635) * go_0(-1.0, -1.0);
  result += mat4(0.024338024, -0.10004009, -0.13709056, -0.0851965, 0.23927099, -0.024349794, -0.16574804, 0.084686354, -0.047885604, 0.09688507, -0.12733915, 0.06980246, 0.11480734, 0.014669346, -0.07505829, 0.04676309) * go_0(-1.0, 0.0);
  result += mat4(0.054203495, 0.011881634, -0.036115017, -0.0686298, -0.13682245, -0.15678032, 0.057050128, -0.03368558, 0.13011025, 0.033391044, -0.09841339, -0.027057761, -0.18701133, 0.20852546, -0.13660902, 0.0005817616) * go_0(-1.0, 1.0);
  result += mat4(-0.08077834, 0.35952288, -0.07647382, -0.0033230998, 0.13929126, -0.09155619, 0.14128102, 0.16005981, 0.18161216, -0.09485738, 0.0029118075, 0.052682754, 0.03242074, 0.08299826, 0.073796146, -0.06446532) * go_0(0.0, -1.0);
  result += mat4(-0.36655015, 0.4606936, 0.19073649, 0.31655258, -0.006838053, -0.579939, 0.089126326, -0.14021218, -0.3437716, 0.16714323, 0.17705944, -0.22418492, -0.3883696, -0.2302651, 0.2581861, 0.21983066) * go_0(0.0, 0.0);
  result += mat4(0.0992383, -0.014257871, -0.023896435, 0.19868234, 0.0408007, 0.07995299, 0.16102871, -0.11668251, 0.22458278, -0.05587917, 0.19373615, -0.016202094, -0.25106144, 0.15634494, 0.11624891, -0.2930768) * go_0(0.0, 1.0);
  result += mat4(0.024616942, 0.36248252, -0.14779098, -0.019894283, -0.007111256, 0.010641561, -0.09541178, 0.21236233, 0.009501827, 0.08132797, -0.13983901, 0.027207611, 0.038444366, -0.013995817, -0.16242191, 0.03294123) * go_0(1.0, -1.0);
  result += mat4(0.0131698875, -0.18124102, -0.13503514, -0.06099072, 0.07422735, -0.20906176, -0.049005672, 0.08739405, -0.031758767, -0.1978915, 0.23094437, 0.54512614, 0.21338555, -0.011205669, -0.23727885, -0.29533875) * go_0(1.0, 0.0);
  result += mat4(-0.0010255767, -0.07168225, -0.033568826, 0.22161655, -0.087293416, 0.11350447, 0.13653576, 0.061226424, -0.13074352, 0.058425818, 0.038460605, 0.2749964, -0.012814839, 0.085885845, -0.038151987, -0.17960808) * go_0(1.0, 1.0);
  result += mat4(0.19728905, -0.040724937, -0.18270236, 0.046735186, 0.03507326, 0.119867206, -0.12691991, 0.18119748, -0.052895024, 0.11348764, -0.043787055, 0.004703516, 0.006752757, -0.06939761, -0.009801806, -0.075640485) * go_1(-1.0, -1.0);
  result += mat4(0.051735226, 0.1732299, -0.10672899, 0.0320877, -0.4913656, 0.2102274, 0.43920282, 0.059108034, 0.08349019, -0.16517872, 0.15436842, -0.1075667, 0.022741623, -0.26693836, 0.3645307, 0.017874828) * go_1(-1.0, 0.0);
  result += mat4(0.034464058, 0.014929155, 0.054227423, 0.14167373, -0.0023630706, -0.08904212, 0.11918041, -0.034539603, 0.06048089, -0.06807333, 0.14447778, 0.035260547, 0.09979546, -0.1924939, 0.14596114, -0.12069667) * go_1(-1.0, 1.0);
  result += mat4(-0.04427228, -0.23673469, 0.010357103, -0.2907043, -0.06845721, -0.078984015, 0.06867713, -0.058163825, -0.12154615, 0.08430951, 0.1922373, 0.030108064, -0.43081748, -0.38715646, -0.022240646, -0.15403675) * go_1(0.0, -1.0);
  result += mat4(0.46885306, -0.33421394, -0.6695223, -0.41841158, 0.30317923, 0.24244753, -0.1047785, -0.18656285, 0.06261881, -0.4405616, 0.24233986, 0.40070608, 0.81440526, 0.11305212, -0.8826317, -0.023478031) * go_1(0.0, 0.0);
  result += mat4(-0.07879348, -0.024378026, -0.041883785, -0.17030984, 0.23229122, -0.011237109, 0.12058088, 0.20766267, -0.36519575, 0.09599417, -0.1271098, 0.06990154, 0.21161246, 0.041002538, -0.36046275, 0.007304667) * go_1(0.0, 1.0);
  result += mat4(0.10873893, 0.003872542, -0.13476561, -0.036068805, -0.054637462, 0.02304618, 0.04707738, -0.2856381, 0.07124422, 0.010866545, 0.20484549, -0.008342406, -0.43660247, -0.041055538, 0.33536008, -0.060022205) * go_1(1.0, -1.0);
  result += mat4(0.1966458, 0.0016302796, -0.25712642, -0.09639119, -0.006955351, 0.10882133, 0.1107341, 0.062697805, -0.1074494, 0.17361663, 0.6429869, -0.39846307, -0.26302996, 0.048710946, 0.40387508, 0.4299715) * go_1(1.0, 0.0);
  result += mat4(0.18948616, 0.24086732, -0.064474985, -0.11069709, 0.1279659, -0.13438123, -0.028438117, 0.125883, 0.018153818, -0.21942288, 0.020390838, -0.22797634, -0.10821287, -0.17175092, 0.122016855, 0.20699544) * go_1(1.0, 1.0);
  result += vec4(-0.05101961, -0.060740646, -0.024465766, 0.058471628);
  gl_FragColor = result;
}
`,n0=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D conv2d_3_tf;
#define conv2d_3_tf_pos (v_texture_coord)
#define conv2d_3_tf_tex(pos) (texture2D(conv2d_3_tf, pos))
#define conv2d_3_tf_size (u_texture_size)
#define conv2d_3_tf_pt (1.0 / conv2d_3_tf_size)
#define conv2d_3_tf_texOff(offset) (conv2d_3_tf_tex(conv2d_3_tf_pos + conv2d_3_tf_pt * offset))

#define go_0(x_off, y_off) (max((conv2d_3_tf_texOff(vec2(x_off, y_off))), 0.0))
#define go_1(x_off, y_off) (max(-(conv2d_3_tf_texOff(vec2(x_off, y_off))), 0.0))
void main() {
  vec4 result = mat4(-0.14533128, 0.07266841, 0.13238011, -0.23328504, 0.031516243, 0.058471266, -0.06394412, 0.090752736, -0.0042359144, 0.12357294, -0.04377495, 0.0011743477, 0.05412243, -0.08146249, 0.04002749, -0.032876283) * go_0(-1.0, -1.0);
  result += mat4(-0.036972385, -0.15238069, -0.3453321, -0.36025128, 0.07597202, -0.02368151, -0.3889606, 0.34607083, 0.3133179, -0.21712309, -0.4210954, 0.21450534, 0.15226828, 0.25326282, 0.45327064, -0.3350824) * go_0(-1.0, 0.0);
  result += mat4(0.019018406, -0.33060563, -0.092601225, 0.14970545, 0.1441509, -0.19228427, -0.032771986, 0.26331595, 0.052981265, -0.06627376, -0.08634131, 0.038706224, 0.13403937, -4.4842476e-05, 0.049002815, -0.12719193) * go_0(-1.0, 1.0);
  result += mat4(0.17527401, -0.0035254909, -0.047959115, -0.4526988, -0.07510284, 0.0013256798, -0.07539148, 0.24220634, -0.08708839, -0.14494033, -0.17085724, -0.099797316, 0.0068515535, -0.08918779, 0.27164719, -0.1702649) * go_0(0.0, -1.0);
  result += mat4(0.31848368, 0.48983255, -0.44140294, -0.65174145, -0.004199057, 0.19494705, 0.5196497, -0.027118586, 0.032509074, -0.23900363, -0.14489244, 0.36314297, -0.23168536, -0.20960593, 0.61471456, 0.12401275) * go_0(0.0, 0.0);
  result += mat4(-0.24317405, 0.21560913, 0.15564032, 0.11606844, -0.15039803, -0.59578896, 0.14100945, -0.026194477, 0.37237462, -0.49472088, -0.15215331, -0.38820064, -0.25089455, -0.29643852, -0.09513793, 0.019779462) * go_0(0.0, 1.0);
  result += mat4(0.12498539, 0.0710632, -0.25012368, -0.2272255, -0.08647026, 0.12277892, 0.011025097, -0.12168395, -0.13489573, 0.016708186, -0.15583871, -0.057124946, 0.1216943, 0.019803725, 0.06952334, -0.032985855) * go_0(1.0, -1.0);
  result += mat4(0.28794885, 0.33783793, -0.14469545, -0.081780486, -0.50320613, -0.067601606, -0.06847453, -0.021648854, -0.34295765, 0.15071863, -0.06619896, -0.084465064, 0.31909832, 0.015414661, 0.14930317, -0.11295768) * go_0(1.0, 0.0);
  result += mat4(0.24530606, 0.25526014, 0.09971985, -0.07749641, -0.2361951, -0.07997673, 0.03617294, 0.02959561, -0.4498983, -0.014073485, -0.20587012, 0.06396779, 0.1262825, 0.027433183, 0.14469334, 0.011538011) * go_0(1.0, 1.0);
  result += mat4(-0.038572453, -0.023108613, -0.039481267, -0.012160024, -0.004521989, -0.028665857, 0.04295255, 0.10580258, 0.05439479, -0.072261885, 0.11030243, 0.08934696, 0.09133867, 0.017547369, 0.097613186, 0.05491059) * go_1(-1.0, -1.0);
  result += mat4(-0.09972817, 0.057730395, 0.12665828, 0.32861367, -0.16186063, 0.0745509, 0.2394045, -0.08687853, -0.034404907, -0.05843572, 0.0684561, -0.1355754, 0.19248672, -0.60372186, 0.12583947, 0.4388962) * go_1(-1.0, 0.0);
  result += mat4(0.10341107, 0.061113223, 0.08773817, -0.082504354, -0.16612078, 0.2681751, 0.019737698, -0.17122322, -0.135949, 0.3048101, 0.087803006, 0.11373851, 0.013192192, -0.27022064, 0.35529897, -0.15321451) * go_1(-1.0, 1.0);
  result += mat4(-0.032835662, 0.11123062, -0.11322452, -0.17300649, 0.04680824, 0.12849288, 0.17269878, -0.048671383, 0.05189037, -0.009078046, 0.22105052, 0.013008137, -0.009738674, 0.15391739, 0.20969556, 0.14189166) * go_1(0.0, -1.0);
  result += mat4(-0.47377753, 0.3038031, 0.18604809, 0.1931698, -0.2964668, -0.12287907, -0.7107761, 0.26619422, -0.33923018, 0.19200724, 0.013786281, -0.17496964, 0.079325035, -0.3694445, 0.0054486147, -0.33018264) * go_1(0.0, 0.0);
  result += mat4(0.14903802, -0.028043179, 1.5238678e-05, 0.021232028, 0.16025065, 0.14746875, -0.22831628, -0.12177345, 0.038778774, 0.32188168, -0.042017702, 0.27155936, 0.17920609, 0.04099755, 0.28527525, 0.074623376) * go_1(0.0, 1.0);
  result += mat4(0.057019282, -0.112741895, 0.030361209, 0.14567861, 0.056265317, -0.01573537, -0.06707608, 0.016657263, 0.09829025, -0.026795063, 0.023042196, 0.09438241, -0.025483066, -0.052787006, 0.19730279, 0.021218104) * go_1(1.0, -1.0);
  result += mat4(0.19868211, -0.01531125, 0.108596824, -0.035456363, 0.0033609823, 0.057961613, -0.013726211, 0.101742364, 0.33357215, 0.14468077, 0.29711527, -0.24662566, -0.119014986, -0.1899639, 0.11246697, -0.0035374009) * go_1(1.0, 0.0);
  result += mat4(-0.05602109, -0.15539522, 0.010730943, 0.057116497, -0.02037749, 0.084210664, -0.028235348, 0.10574697, 0.056925274, 0.07922333, -0.090088, 0.1615985, -0.0044301567, -0.089945644, 0.024176618, -0.041844133) * go_1(1.0, 1.0);
  result += vec4(0.0015292584, -0.043625206, -0.09429898, -0.06280405);
  gl_FragColor = result;
}
`,a0=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D conv2d_4_tf;
#define conv2d_4_tf_pos (v_texture_coord)
#define conv2d_4_tf_tex(pos) (texture2D(conv2d_4_tf, pos))
#define conv2d_4_tf_size (u_texture_size)
#define conv2d_4_tf_pt (1.0 / conv2d_4_tf_size)
#define conv2d_4_tf_texOff(offset) (conv2d_4_tf_tex(conv2d_4_tf_pos + conv2d_4_tf_pt * offset))

#define go_0(x_off, y_off) (max((conv2d_4_tf_texOff(vec2(x_off, y_off))), 0.0))
#define go_1(x_off, y_off) (max(-(conv2d_4_tf_texOff(vec2(x_off, y_off))), 0.0))
void main() {
  vec4 result = mat4(0.06051604, -0.028152643, -0.21418124, 0.13032125, 0.42565975, -0.09571944, -0.34494513, 0.30004, -0.073245734, -0.028659137, 0.0032105136, -0.05009555, -0.048971225, 0.04814533, 0.002843805, -0.046224426) * go_0(-1.0, -1.0);
  result += mat4(-0.07495975, 0.018714864, 0.21229684, -0.13614887, 0.79988647, -0.0697328, 0.38232988, 0.24165109, 0.25947478, -0.0009418982, -0.17369923, 0.10007766, 0.024117598, 0.028611807, 0.15090801, -0.06344829) * go_0(-1.0, 0.0);
  result += mat4(-0.07982219, 0.0900347, 0.007609254, -0.0034791247, 0.013611781, -0.13560618, 0.09685799, 0.06276075, 0.134693, -0.14370437, -0.25175703, -0.0016138123, -0.0075672898, -0.13325731, -0.061100446, 0.0059743375) * go_0(-1.0, 1.0);
  result += mat4(-0.039018434, -0.19668463, -0.43018532, 0.31886247, 0.4965479, 0.114569925, 0.19110382, 0.27343535, 0.0707728, -0.11877004, -0.25827697, 0.37012872, 0.1474777, 0.07056952, -0.14965728, 0.061595406) * go_0(0.0, -1.0);
  result += mat4(0.506543, -0.16268773, 0.455319, -0.0702646, 0.70102173, -0.14041683, 0.70184857, 0.4817842, -0.3389246, -0.14463086, 0.13763213, -1.1259074, 0.47722015, 0.38352612, -0.04293366, -0.5604627) * go_0(0.0, 0.0);
  result += mat4(0.17606944, 0.15897374, 0.13499324, 0.29241478, -0.032824475, 0.11128662, -0.22204424, -0.051803727, 0.013195331, -0.42040786, -0.3950585, 0.70745844, 0.38646924, -0.19080774, -0.15171832, -0.10742828) * go_0(0.0, 1.0);
  result += mat4(-0.039278325, 0.18421806, -0.044948544, 0.07902063, -0.2149251, 0.09913459, -0.09743655, -0.26899317, -0.002695496, -0.07554527, -0.22373366, 0.17830558, -0.047994815, -0.06789183, -0.06755918, -0.104452066) * go_0(1.0, -1.0);
  result += mat4(-0.0493473, -0.30411786, -0.056439694, -0.06582185, -0.21309847, 0.100670904, -0.22966193, -0.045954112, 0.12728062, -0.25081897, -0.094699375, -0.4036555, 0.060854495, -0.64373237, -0.21522263, -0.6683476) * go_0(1.0, 0.0);
  result += mat4(0.063481025, 0.11744312, -0.043330096, 0.33817932, -0.06679828, -0.23207302, -0.10188898, -0.10590511, 0.058780864, 0.047292337, -0.11834696, 0.10076128, -0.036641665, 0.30200714, -0.0002892557, -0.10303763) * go_0(1.0, 1.0);
  result += mat4(-0.10842604, 0.042055763, 0.29702973, -0.07409644, -0.030164458, -0.012098744, -0.06396587, -0.08787527, 0.051854923, 0.12997511, 0.11468497, 0.15022379, 0.007814715, 0.014517445, 0.025484756, 0.01078619) * go_1(-1.0, -1.0);
  result += mat4(-0.29229385, 0.040265664, -0.15376821, 0.075579196, -0.05593569, -0.045405343, 0.12099204, 0.1571252, 0.17841713, 0.04673325, 0.14550509, 0.08603346, -0.049786013, 0.06121843, -0.16273825, -0.13857752) * go_1(-1.0, 0.0);
  result += mat4(0.06903744, 0.2628764, -0.13582836, -0.35678583, -0.13821034, -0.019381443, -0.19570538, -0.09298511, 0.08965436, 0.09745909, 0.20055099, 0.024967568, 0.08144204, 0.004633625, 0.12809834, -0.009431525) * go_1(-1.0, 1.0);
  result += mat4(0.09784006, 0.010729353, 0.046643205, -0.110926524, -0.21556224, 0.00016300633, 0.122175336, 0.15004392, 0.013864355, 0.24767809, 0.13865592, 0.0155424485, -0.1450483, -0.15688781, -0.06195043, -0.13745981) * go_1(0.0, -1.0);
  result += mat4(0.018991318, 0.55401963, 0.11709872, -0.028442185, -0.46035343, -0.10215539, -0.60193926, 0.47882316, -0.23346989, 0.037200127, 0.22814943, -0.08231696, -0.36430013, -0.011152757, 0.48752213, 0.29796222) * go_1(0.0, 0.0);
  result += mat4(-0.07258066, -0.023222538, 0.23230423, -0.30317304, 0.03942911, -0.06899803, 0.23778579, 0.07418621, -0.17443737, 0.33387753, 0.007354842, -0.123447575, -0.1745315, 0.11071779, -0.11949625, -0.22832453) * go_1(0.0, 1.0);
  result += mat4(-0.024909232, -0.0308135, 0.12170621, -0.13298757, 0.045828197, -0.1532345, -0.06633672, 0.23591088, 0.04964077, 0.14091493, 0.038343724, -0.029780807, 0.05762822, -0.048930667, -0.02434709, 0.07109019) * go_1(1.0, -1.0);
  result += mat4(-0.16039175, 0.3004474, -0.17278233, 0.13677922, 0.18838613, 0.15054552, 0.32901475, -0.1288333, 0.26378244, -0.05119892, 0.34533516, 0.25180495, 0.19452183, 0.0843233, -0.08029368, 0.39877903) * go_1(1.0, 0.0);
  result += mat4(-0.07097129, -0.26492423, -0.055032317, -0.093516104, -0.11795062, 0.04086253, -0.07989471, 0.059686553, 0.09378249, 0.45851848, 0.2510942, 0.19599153, 0.019765077, -0.02920918, -0.04125142, -0.13859107) * go_1(1.0, 1.0);
  result += vec4(0.04400571, -0.04015565, 0.0140529545, 0.05474095);
  gl_FragColor = result;
}
`,u0=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D conv2d_5_tf;
#define conv2d_5_tf_pos (v_texture_coord)
#define conv2d_5_tf_tex(pos) (texture2D(conv2d_5_tf, pos))
#define conv2d_5_tf_size (u_texture_size)
#define conv2d_5_tf_pt (1.0 / conv2d_5_tf_size)
#define conv2d_5_tf_texOff(offset) (conv2d_5_tf_tex(conv2d_5_tf_pos + conv2d_5_tf_pt * offset))

#define go_0(x_off, y_off) (max((conv2d_5_tf_texOff(vec2(x_off, y_off))), 0.0))
#define go_1(x_off, y_off) (max(-(conv2d_5_tf_texOff(vec2(x_off, y_off))), 0.0))
void main() {
  vec4 result = mat4(-0.014236042, -0.0031431736, -0.1551387, 0.12515116, -0.28528872, 0.36161992, 0.15750743, -0.17111474, 0.13792591, -0.0657419, -0.17471549, 0.14650472, 0.034169197, -0.019157575, 0.23520657, -0.20358163) * go_0(-1.0, -1.0);
  result += mat4(0.02015035, 0.12993371, 0.11199667, -0.09854378, 0.5001741, 0.03462961, 0.24919736, 0.08505297, -0.20902094, -0.24141377, -0.15360375, 0.049974803, -0.037157424, -0.048510186, 0.20106035, -0.118480384) * go_0(-1.0, 0.0);
  result += mat4(0.086798504, -0.009607818, 0.034812123, -0.005187592, 0.0351509, 0.021755, -0.04996161, -0.041231696, 0.0020545553, 0.015730752, -0.07507172, 0.018597523, -0.02393343, 0.07624775, 0.03892451, -0.0025574185) * go_0(-1.0, 1.0);
  result += mat4(0.035725456, 0.06809103, 0.51926994, -0.39983147, -0.16402833, -0.1243394, -0.25922915, 0.28285915, 0.15959994, -0.2351732, 0.2650535, -0.30193794, -0.11468332, 0.050777763, -0.51894253, 0.4408367) * go_0(0.0, -1.0);
  result += mat4(-0.27042082, 0.22243942, 0.14902467, 0.38428563, 0.46612173, 0.5169912, -0.22330502, -0.11300288, -0.36141354, 0.0668681, 0.2984152, 0.1275798, -0.24121419, 0.2952039, -0.45109174, -0.3822957) * go_0(0.0, 0.0);
  result += mat4(0.26543504, -0.05742226, -0.052103903, -0.013124308, -0.14358385, -0.04024543, 0.07665455, -0.012301872, -0.18752757, -0.03913891, 0.038205814, -0.006583095, -0.25550908, -0.25725332, -0.12454206, -0.0058936924) * go_0(0.0, 1.0);
  result += mat4(-0.0018946569, 0.019746022, -0.13080788, 0.11450627, -0.013743845, -0.027179785, -0.14425103, 0.07109661, 0.023703793, 0.086905524, 0.03151253, 0.0132474145, 0.041018624, 0.04548913, 0.2718715, -0.20008296) * go_0(1.0, -1.0);
  result += mat4(-0.076830454, 0.11652955, 0.5068201, -0.3082819, 0.058615055, -0.006765798, -0.057522714, 0.049981344, -0.006897243, -0.21763432, 0.16896053, -0.21176189, -0.061227098, 0.03566485, 0.08901554, -0.050980624) * go_0(1.0, 0.0);
  result += mat4(0.02327798, 0.07662976, 0.034811985, -0.03238033, -0.0021881019, -0.030997375, -0.069672935, 0.04040273, -0.1217442, 0.104173124, 0.09862539, 0.020557549, -0.022286594, 0.10287763, -0.021694934, 0.07542515) * go_0(1.0, 1.0);
  result += mat4(0.124069154, -0.08579466, -0.07816314, 0.11332851, -0.034682628, -0.11038275, 0.04750615, -0.096100725, 0.039588403, -0.15149672, -0.05529172, 0.034304325, -0.022520235, -0.05023852, -0.2674731, 0.21886522) * go_1(-1.0, -1.0);
  result += mat4(-0.1948599, -0.14946899, -0.39548838, 0.18042913, -0.007919619, 0.19826505, 0.23789087, 0.009140256, 0.11857748, 0.18215668, 0.13606293, -0.09209675, -0.080678545, -0.020431137, -0.07728839, -0.051353537) * go_1(-1.0, 0.0);
  result += mat4(-0.07616472, -0.0032800382, -0.045657665, -0.039144326, -0.37786487, -0.08877774, 0.053579114, -0.070886396, 0.011311804, 0.107276045, 0.013236154, 0.009832061, 0.08292063, 0.12258811, 0.0005569043, -0.009806432) * go_1(-1.0, 1.0);
  result += mat4(-0.28062925, 0.15946878, -0.1021801, -0.06471589, -0.26999477, 0.21230288, -0.14243907, 0.2555922, -0.09608517, 0.26339412, 0.20891234, -0.23538485, 0.33958244, -0.12569186, 0.43289876, -0.33462036) * go_1(0.0, -1.0);
  result += mat4(0.16265294, 0.2625464, -0.34452894, 0.2233622, 0.13850005, -0.42999864, -0.5385177, -0.11035979, 0.51662, -0.78238726, -0.09422375, 0.83759475, 0.44468537, 0.14301361, 0.108906105, 1.1596143) * go_1(0.0, 0.0);
  result += mat4(-0.73757625, -0.12369605, 0.23523071, 0.006587637, -0.15445381, 0.22757277, 0.052819528, 0.10183905, -0.07912228, -0.16998893, -0.13360223, 0.014348178, -0.17778571, -0.41047302, 0.10241381, -0.08526306) * go_1(0.0, 1.0);
  result += mat4(0.14712952, 0.048995696, 0.05299946, -0.06817572, 0.1498064, -0.079825334, 0.40354064, -0.31789717, -0.1998377, 0.00955295, -0.32318407, 0.30898204, -0.039571725, -0.026203401, -0.16292085, 0.08574385) * go_1(1.0, -1.0);
  result += mat4(-0.6353329, -0.56000775, -0.17279743, 0.18198174, -0.19555812, 0.056538377, 0.34365895, -0.07799055, 0.19011354, -0.13952748, 0.029196098, -0.19596763, -0.069196045, -0.17402656, 0.07948411, -0.016226962) * go_1(1.0, 0.0);
  result += mat4(0.25592864, 0.083498634, -0.28515807, 0.10789751, 0.0043962947, 0.07085363, 0.048724182, -0.025131436, -0.0049440865, -0.033094388, -0.032935806, 0.04266025, 0.20026933, 0.0927841, -0.006839351, -0.013012285) * go_1(1.0, 1.0);
  result += vec4(0.02021373, 0.0014037411, 0.0012718709, 0.017278494);
  gl_FragColor = result;
}
`,s0=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D conv2d_tf;
#define conv2d_tf_pos (v_texture_coord)
#define conv2d_tf_tex(pos) (texture2D(conv2d_tf, pos))
#define conv2d_tf_size (u_texture_size)
#define conv2d_tf_pt (1.0 / conv2d_tf_size)
#define conv2d_tf_texOff(offset) (conv2d_tf_tex(conv2d_tf_pos + conv2d_tf_pt * offset))

uniform sampler2D conv2d_1_tf;
#define conv2d_1_tf_pos (v_texture_coord)
#define conv2d_1_tf_tex(pos) (texture2D(conv2d_1_tf, pos))
#define conv2d_1_tf_size (u_texture_size)
#define conv2d_1_tf_pt (1.0 / conv2d_1_tf_size)
#define conv2d_1_tf_texOff(offset) (conv2d_1_tf_tex(conv2d_1_tf_pos + conv2d_1_tf_pt * offset))

uniform sampler2D conv2d_2_tf;
#define conv2d_2_tf_pos (v_texture_coord)
#define conv2d_2_tf_tex(pos) (texture2D(conv2d_2_tf, pos))
#define conv2d_2_tf_size (u_texture_size)
#define conv2d_2_tf_pt (1.0 / conv2d_2_tf_size)
#define conv2d_2_tf_texOff(offset) (conv2d_2_tf_tex(conv2d_2_tf_pos + conv2d_2_tf_pt * offset))

uniform sampler2D conv2d_3_tf;
#define conv2d_3_tf_pos (v_texture_coord)
#define conv2d_3_tf_tex(pos) (texture2D(conv2d_3_tf, pos))
#define conv2d_3_tf_size (u_texture_size)
#define conv2d_3_tf_pt (1.0 / conv2d_3_tf_size)
#define conv2d_3_tf_texOff(offset) (conv2d_3_tf_tex(conv2d_3_tf_pos + conv2d_3_tf_pt * offset))

uniform sampler2D conv2d_4_tf;
#define conv2d_4_tf_pos (v_texture_coord)
#define conv2d_4_tf_tex(pos) (texture2D(conv2d_4_tf, pos))
#define conv2d_4_tf_size (u_texture_size)
#define conv2d_4_tf_pt (1.0 / conv2d_4_tf_size)
#define conv2d_4_tf_texOff(offset) (conv2d_4_tf_tex(conv2d_4_tf_pos + conv2d_4_tf_pt * offset))

uniform sampler2D conv2d_5_tf;
#define conv2d_5_tf_pos (v_texture_coord)
#define conv2d_5_tf_tex(pos) (texture2D(conv2d_5_tf, pos))
#define conv2d_5_tf_size (u_texture_size)
#define conv2d_5_tf_pt (1.0 / conv2d_5_tf_size)
#define conv2d_5_tf_texOff(offset) (conv2d_5_tf_tex(conv2d_5_tf_pos + conv2d_5_tf_pt * offset))

uniform sampler2D conv2d_6_tf;
#define conv2d_6_tf_pos (v_texture_coord)
#define conv2d_6_tf_tex(pos) (texture2D(conv2d_6_tf, pos))
#define conv2d_6_tf_size (u_texture_size)
#define conv2d_6_tf_pt (1.0 / conv2d_6_tf_size)
#define conv2d_6_tf_texOff(offset) (conv2d_6_tf_tex(conv2d_6_tf_pos + conv2d_6_tf_pt * offset))

#define g_0 (max((conv2d_tf_tex(conv2d_tf_pos)), 0.0))
#define g_1 (max(-(conv2d_tf_tex(conv2d_tf_pos)), 0.0))
#define g_2 (max((conv2d_1_tf_tex(conv2d_1_tf_pos)), 0.0))
#define g_3 (max(-(conv2d_1_tf_tex(conv2d_1_tf_pos)), 0.0))
#define g_4 (max((conv2d_2_tf_tex(conv2d_2_tf_pos)), 0.0))
#define g_5 (max(-(conv2d_2_tf_tex(conv2d_2_tf_pos)), 0.0))
#define g_6 (max((conv2d_3_tf_tex(conv2d_3_tf_pos)), 0.0))
#define g_7 (max(-(conv2d_3_tf_tex(conv2d_3_tf_pos)), 0.0))
#define g_8 (max((conv2d_4_tf_tex(conv2d_4_tf_pos)), 0.0))
#define g_9 (max(-(conv2d_4_tf_tex(conv2d_4_tf_pos)), 0.0))
#define g_10 (max((conv2d_5_tf_tex(conv2d_5_tf_pos)), 0.0))
#define g_11 (max(-(conv2d_5_tf_tex(conv2d_5_tf_pos)), 0.0))
#define g_12 (max((conv2d_6_tf_tex(conv2d_6_tf_pos)), 0.0))
#define g_13 (max(-(conv2d_6_tf_tex(conv2d_6_tf_pos)), 0.0))
void main() {
  vec4 result = mat4(-0.0067711817, 0.08160003, 0.0247279, 0.03084815, -0.026977416, -0.02120602, -0.025078611, -0.029852165, -0.011627478, -0.012742972, 0.022736797, -0.0028815821, -0.007515677, 0.0172887, -0.023259213, 0.009608947) * g_0;
  result += mat4(-0.028660107, -0.014015208, -0.027838672, -0.013171922, 0.0029435428, 0.027047642, -0.017478354, 0.022834882, -0.037572853, -0.0034044068, -0.0149029335, -0.013362301, 0.009827443, -0.015742151, -0.0074795415, -0.0022266617) * g_1;
  result += mat4(-0.07579662, -0.039754186, -0.066026606, -0.046816852, 0.1099032, 0.043956704, 0.073109835, 0.04680284, -0.06896613, -0.008838632, -0.044584926, -0.01319039, -0.0021152915, -0.04503326, 0.027061926, -0.028334105) * g_2;
  result += mat4(0.15458213, 0.059769996, 0.09327123, -0.028782733, 0.023459995, -0.15390377, -0.13432898, -0.1127775, 0.072764635, -0.0020463336, 0.034736466, -0.0012086042, -0.05847183, -0.029952323, 0.052969377, 0.09590908) * g_3;
  result += mat4(-0.07476772, -0.016574614, 0.04131183, 0.017335678, 0.009654406, 0.072183535, -0.002266456, 0.086873695, 9.310129e-05, 0.0056416965, -0.004188391, 0.023132093, -0.05183336, -0.025825873, -0.03684392, -0.0075729224) * g_4;
  result += mat4(0.00878842, 0.03869637, -0.035759524, 0.003345386, -0.064184256, -0.034568302, -0.06672922, -0.0686381, -0.06794392, -0.10685906, 0.04679947, -0.012535639, 0.006932529, -0.007783515, 0.109123886, 0.13804391) * g_5;
  result += mat4(-0.03160699, 0.050473, -0.09030729, 0.0649397, 0.11466501, 0.17912874, -0.0081851315, 0.052244574, 0.051632743, 0.061941486, 0.06546816, 0.12174249, -0.05104755, -0.018193979, -0.032196652, -0.035292786) * g_6;
  result += mat4(0.013612735, -0.0024100312, -0.068611205, -0.07369285, -0.019647537, -0.066944756, -0.010012875, -0.06785739, -0.062246565, -0.087313406, -0.044278186, -0.09368995, 0.052555013, 0.13604961, 0.05645059, 0.08763303) * g_7;
  result += mat4(0.04218486, -0.05028401, 0.059086576, -0.03545452, 0.027737848, 0.0043074046, 0.0011001764, -0.073026665, -0.04094988, 0.044061556, -0.009812515, 0.06841999, -0.06612581, 0.037223976, -0.07759491, -0.04356598) * g_8;
  result += mat4(-0.027558247, 0.014248466, -0.019813016, -0.058107473, -0.016717663, -0.020424338, 0.0053625097, -0.009917319, 0.013678771, 0.0113340765, 0.0061787106, -0.036083996, -0.020179711, -0.011310535, 0.054827053, -0.0008278952) * g_9;
  result += mat4(0.028690035, -0.012079616, 0.11931408, -0.048533775, 0.069336995, 0.0049852817, 0.013774468, 0.035233382, -0.07384821, 0.0003354423, -0.0059171803, -0.04503906, 0.08727279, 0.005138857, -0.17724465, 0.055782065) * g_10;
  result += mat4(-0.20744391, 0.24348328, -0.3145766, 0.17026486, -0.022870807, -0.01648648, -0.05912279, -0.012555373, -0.066004686, 0.03182394, 0.16285324, -0.1221846, -0.31816196, 0.007928748, 0.43180224, -0.015949022) * g_11;
  result += mat4(0.16363169, 0.14781676, -0.2377973, -0.1571377, -0.09038187, 0.0046504294, 0.033955004, -0.051421452, 0.046735536, 0.006827522, -0.121338, 0.12671822, 0.15833299, -0.1858712, -0.1942371, 0.17336044) * g_12;
  result += mat4(-0.018145572, -0.015550516, 0.044410378, 0.046016492, 0.084021375, 0.05327457, -0.008270992, -0.045435544, 0.07185879, -0.131923, 0.26721445, -0.26745328, -0.07093472, 0.042701527, 0.13793674, -0.095621444) * g_13;
  result += vec4(0.016836504, 0.010161949, 0.021351453, 0.01278978);
  gl_FragColor = result;
}
`,f0=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
precision mediump sampler2D;

uniform vec2 u_resolution;
uniform vec2 u_texture_size;
varying vec2 v_texture_coord;
uniform sampler2D MAIN;
#define MAIN_pos (v_texture_coord)
#define MAIN_tex(pos) (texture2D(MAIN, pos))
#define MAIN_size (u_texture_size)
#define MAIN_pt (1.0 / MAIN_size)
#define MAIN_texOff(offset) (MAIN_tex(MAIN_pos + MAIN_pt * offset))

uniform sampler2D conv2d_last_tf;
#define conv2d_last_tf_pos (v_texture_coord)
#define conv2d_last_tf_tex(pos) (texture2D(conv2d_last_tf, pos))
#define conv2d_last_tf_size (u_texture_size)
#define conv2d_last_tf_pt (1.0 / conv2d_last_tf_size)
#define conv2d_last_tf_texOff(offset) (conv2d_last_tf_tex(conv2d_last_tf_pos + conv2d_last_tf_pt * offset))

void main() {
  vec2 f0 = fract(conv2d_last_tf_pos * conv2d_last_tf_size);
  ivec2 i0 = ivec2(f0 * vec2(2.0));
  float c0 = 0.0;
  if (i0.y * 2 + i0.x == 0) {
    c0 = conv2d_last_tf_tex((vec2(0.5) - f0) * conv2d_last_tf_pt + conv2d_last_tf_pos)[0];
  } else if (i0.y * 2 + i0.x == 1) {
    c0 = conv2d_last_tf_tex((vec2(0.5) - f0) * conv2d_last_tf_pt + conv2d_last_tf_pos)[1];
  } else if (i0.y * 2 + i0.x == 2) {
    c0 = conv2d_last_tf_tex((vec2(0.5) - f0) * conv2d_last_tf_pt + conv2d_last_tf_pos)[2];
  } else if (i0.y * 2 + i0.x == 3) {
    c0 = conv2d_last_tf_tex((vec2(0.5) - f0) * conv2d_last_tf_pt + conv2d_last_tf_pos)[3];
  };
  float c1 = c0;
  float c2 = c1;
  float c3 = 0.0;
  gl_FragColor = vec4(c0, c1, c2, c3) + MAIN_tex(MAIN_pos);
}
`,M=class extends b{gl;texcoordBuffer;program_0;program_1;program_2;program_3;program_4;program_5;program_6;program_7;program_8;program_0_intermediate_texture;program_1_intermediate_texture;program_2_intermediate_texture;program_3_intermediate_texture;program_4_intermediate_texture;program_5_intermediate_texture;program_6_intermediate_texture;program_7_intermediate_texture;program_8_intermediate_texture;program_0_intermediate_texture_cached_width;program_1_intermediate_texture_cached_width;program_2_intermediate_texture_cached_width;program_3_intermediate_texture_cached_width;program_4_intermediate_texture_cached_width;program_5_intermediate_texture_cached_width;program_6_intermediate_texture_cached_width;program_7_intermediate_texture_cached_width;program_8_intermediate_texture_cached_width;program_0_intermediate_texture_cached_height;program_1_intermediate_texture_cached_height;program_2_intermediate_texture_cached_height;program_3_intermediate_texture_cached_height;program_4_intermediate_texture_cached_height;program_5_intermediate_texture_cached_height;program_6_intermediate_texture_cached_height;program_7_intermediate_texture_cached_height;program_8_intermediate_texture_cached_height;program_0_a_position_location;program_1_a_position_location;program_2_a_position_location;program_3_a_position_location;program_4_a_position_location;program_5_a_position_location;program_6_a_position_location;program_7_a_position_location;program_8_a_position_location;program_0_a_texture_coord_location;program_1_a_texture_coord_location;program_2_a_texture_coord_location;program_3_a_texture_coord_location;program_4_a_texture_coord_location;program_5_a_texture_coord_location;program_6_a_texture_coord_location;program_7_a_texture_coord_location;program_8_a_texture_coord_location;program_0_u_resolution_location;program_1_u_resolution_location;program_2_u_resolution_location;program_3_u_resolution_location;program_4_u_resolution_location;program_5_u_resolution_location;program_6_u_resolution_location;program_7_u_resolution_location;program_8_u_resolution_location;program_0_u_texture_size_location;program_1_u_texture_size_location;program_2_u_texture_size_location;program_3_u_texture_size_location;program_4_u_texture_size_location;program_5_u_texture_size_location;program_6_u_texture_size_location;program_7_u_texture_size_location;program_8_u_texture_size_location;program_0_MAIN_TextureLocation;program_1_conv2d_tf_TextureLocation;program_2_conv2d_1_tf_TextureLocation;program_3_conv2d_2_tf_TextureLocation;program_4_conv2d_3_tf_TextureLocation;program_5_conv2d_4_tf_TextureLocation;program_6_conv2d_5_tf_TextureLocation;program_7_conv2d_tf_TextureLocation;program_7_conv2d_1_tf_TextureLocation;program_7_conv2d_2_tf_TextureLocation;program_7_conv2d_3_tf_TextureLocation;program_7_conv2d_4_tf_TextureLocation;program_7_conv2d_5_tf_TextureLocation;program_7_conv2d_6_tf_TextureLocation;program_8_MAIN_TextureLocation;program_8_conv2d_last_tf_TextureLocation;program_0_position_buffer;program_1_position_buffer;program_2_position_buffer;program_3_position_buffer;program_4_position_buffer;program_5_position_buffer;program_6_position_buffer;program_7_position_buffer;program_8_position_buffer;constructor(e){super(),this.gl=e,this.texcoordBuffer=f(e,0,0,1,1),this.program_0=x(e,g(e,E),l(e,r0)),this.program_1=x(e,g(e,E),l(e,_0)),this.program_2=x(e,g(e,E),l(e,o0)),this.program_3=x(e,g(e,E),l(e,i0)),this.program_4=x(e,g(e,E),l(e,n0)),this.program_5=x(e,g(e,E),l(e,a0)),this.program_6=x(e,g(e,E),l(e,u0)),this.program_7=x(e,g(e,E),l(e,s0)),this.program_8=x(e,g(e,E),l(e,f0)),this.program_0_intermediate_texture=p(e,e.NEAREST),this.program_1_intermediate_texture=p(e,e.NEAREST),this.program_2_intermediate_texture=p(e,e.NEAREST),this.program_3_intermediate_texture=p(e,e.NEAREST),this.program_4_intermediate_texture=p(e,e.NEAREST),this.program_5_intermediate_texture=p(e,e.NEAREST),this.program_6_intermediate_texture=p(e,e.NEAREST),this.program_7_intermediate_texture=p(e,e.NEAREST),this.program_8_intermediate_texture=p(e,e.NEAREST),this.program_0_intermediate_texture_cached_width=null,this.program_1_intermediate_texture_cached_width=null,this.program_2_intermediate_texture_cached_width=null,this.program_3_intermediate_texture_cached_width=null,this.program_4_intermediate_texture_cached_width=null,this.program_5_intermediate_texture_cached_width=null,this.program_6_intermediate_texture_cached_width=null,this.program_7_intermediate_texture_cached_width=null,this.program_8_intermediate_texture_cached_width=null,this.program_0_intermediate_texture_cached_height=null,this.program_1_intermediate_texture_cached_height=null,this.program_2_intermediate_texture_cached_height=null,this.program_3_intermediate_texture_cached_height=null,this.program_4_intermediate_texture_cached_height=null,this.program_5_intermediate_texture_cached_height=null,this.program_6_intermediate_texture_cached_height=null,this.program_7_intermediate_texture_cached_height=null,this.program_8_intermediate_texture_cached_height=null,this.program_0_a_position_location=e.getAttribLocation(this.program_0,"a_position"),e.enableVertexAttribArray(this.program_0_a_position_location),this.program_1_a_position_location=e.getAttribLocation(this.program_1,"a_position"),e.enableVertexAttribArray(this.program_1_a_position_location),this.program_2_a_position_location=e.getAttribLocation(this.program_2,"a_position"),e.enableVertexAttribArray(this.program_2_a_position_location),this.program_3_a_position_location=e.getAttribLocation(this.program_3,"a_position"),e.enableVertexAttribArray(this.program_3_a_position_location),this.program_4_a_position_location=e.getAttribLocation(this.program_4,"a_position"),e.enableVertexAttribArray(this.program_4_a_position_location),this.program_5_a_position_location=e.getAttribLocation(this.program_5,"a_position"),e.enableVertexAttribArray(this.program_5_a_position_location),this.program_6_a_position_location=e.getAttribLocation(this.program_6,"a_position"),e.enableVertexAttribArray(this.program_6_a_position_location),this.program_7_a_position_location=e.getAttribLocation(this.program_7,"a_position"),e.enableVertexAttribArray(this.program_7_a_position_location),this.program_8_a_position_location=e.getAttribLocation(this.program_8,"a_position"),e.enableVertexAttribArray(this.program_8_a_position_location),this.program_0_a_texture_coord_location=e.getAttribLocation(this.program_0,"a_texture_coord"),e.enableVertexAttribArray(this.program_0_a_texture_coord_location),this.program_1_a_texture_coord_location=e.getAttribLocation(this.program_1,"a_texture_coord"),e.enableVertexAttribArray(this.program_1_a_texture_coord_location),this.program_2_a_texture_coord_location=e.getAttribLocation(this.program_2,"a_texture_coord"),e.enableVertexAttribArray(this.program_2_a_texture_coord_location),this.program_3_a_texture_coord_location=e.getAttribLocation(this.program_3,"a_texture_coord"),e.enableVertexAttribArray(this.program_3_a_texture_coord_location),this.program_4_a_texture_coord_location=e.getAttribLocation(this.program_4,"a_texture_coord"),e.enableVertexAttribArray(this.program_4_a_texture_coord_location),this.program_5_a_texture_coord_location=e.getAttribLocation(this.program_5,"a_texture_coord"),e.enableVertexAttribArray(this.program_5_a_texture_coord_location),this.program_6_a_texture_coord_location=e.getAttribLocation(this.program_6,"a_texture_coord"),e.enableVertexAttribArray(this.program_6_a_texture_coord_location),this.program_7_a_texture_coord_location=e.getAttribLocation(this.program_7,"a_texture_coord"),e.enableVertexAttribArray(this.program_7_a_texture_coord_location),this.program_8_a_texture_coord_location=e.getAttribLocation(this.program_8,"a_texture_coord"),e.enableVertexAttribArray(this.program_8_a_texture_coord_location),this.program_0_u_resolution_location=e.getUniformLocation(this.program_0,"u_resolution"),this.program_1_u_resolution_location=e.getUniformLocation(this.program_1,"u_resolution"),this.program_2_u_resolution_location=e.getUniformLocation(this.program_2,"u_resolution"),this.program_3_u_resolution_location=e.getUniformLocation(this.program_3,"u_resolution"),this.program_4_u_resolution_location=e.getUniformLocation(this.program_4,"u_resolution"),this.program_5_u_resolution_location=e.getUniformLocation(this.program_5,"u_resolution"),this.program_6_u_resolution_location=e.getUniformLocation(this.program_6,"u_resolution"),this.program_7_u_resolution_location=e.getUniformLocation(this.program_7,"u_resolution"),this.program_8_u_resolution_location=e.getUniformLocation(this.program_8,"u_resolution"),this.program_0_u_texture_size_location=e.getUniformLocation(this.program_0,"u_texture_size"),this.program_1_u_texture_size_location=e.getUniformLocation(this.program_1,"u_texture_size"),this.program_2_u_texture_size_location=e.getUniformLocation(this.program_2,"u_texture_size"),this.program_3_u_texture_size_location=e.getUniformLocation(this.program_3,"u_texture_size"),this.program_4_u_texture_size_location=e.getUniformLocation(this.program_4,"u_texture_size"),this.program_5_u_texture_size_location=e.getUniformLocation(this.program_5,"u_texture_size"),this.program_6_u_texture_size_location=e.getUniformLocation(this.program_6,"u_texture_size"),this.program_7_u_texture_size_location=e.getUniformLocation(this.program_7,"u_texture_size"),this.program_8_u_texture_size_location=e.getUniformLocation(this.program_8,"u_texture_size"),this.program_0_MAIN_TextureLocation=e.getUniformLocation(this.program_0,"MAIN"),this.program_1_conv2d_tf_TextureLocation=e.getUniformLocation(this.program_1,"conv2d_tf"),this.program_2_conv2d_1_tf_TextureLocation=e.getUniformLocation(this.program_2,"conv2d_1_tf"),this.program_3_conv2d_2_tf_TextureLocation=e.getUniformLocation(this.program_3,"conv2d_2_tf"),this.program_4_conv2d_3_tf_TextureLocation=e.getUniformLocation(this.program_4,"conv2d_3_tf"),this.program_5_conv2d_4_tf_TextureLocation=e.getUniformLocation(this.program_5,"conv2d_4_tf"),this.program_6_conv2d_5_tf_TextureLocation=e.getUniformLocation(this.program_6,"conv2d_5_tf"),this.program_7_conv2d_tf_TextureLocation=e.getUniformLocation(this.program_7,"conv2d_tf"),this.program_7_conv2d_1_tf_TextureLocation=e.getUniformLocation(this.program_7,"conv2d_1_tf"),this.program_7_conv2d_2_tf_TextureLocation=e.getUniformLocation(this.program_7,"conv2d_2_tf"),this.program_7_conv2d_3_tf_TextureLocation=e.getUniformLocation(this.program_7,"conv2d_3_tf"),this.program_7_conv2d_4_tf_TextureLocation=e.getUniformLocation(this.program_7,"conv2d_4_tf"),this.program_7_conv2d_5_tf_TextureLocation=e.getUniformLocation(this.program_7,"conv2d_5_tf"),this.program_7_conv2d_6_tf_TextureLocation=e.getUniformLocation(this.program_7,"conv2d_6_tf"),this.program_8_MAIN_TextureLocation=e.getUniformLocation(this.program_8,"MAIN"),this.program_8_conv2d_last_tf_TextureLocation=e.getUniformLocation(this.program_8,"conv2d_last_tf"),this.program_0_position_buffer=null,this.program_1_position_buffer=null,this.program_2_position_buffer=null,this.program_3_position_buffer=null,this.program_4_position_buffer=null,this.program_5_position_buffer=null,this.program_6_position_buffer=null,this.program_7_position_buffer=null,this.program_8_position_buffer=null}destroy(){let e=this.gl;this.texcoordBuffer!=null&&e.deleteBuffer(this.texcoordBuffer),this.program_0_intermediate_texture!=null&&e.deleteTexture(this.program_0_intermediate_texture),this.program_0_position_buffer!=null&&e.deleteBuffer(this.program_0_position_buffer),this.program_0!=null&&e.deleteProgram(this.program_0),this.program_1_intermediate_texture!=null&&e.deleteTexture(this.program_1_intermediate_texture),this.program_1_position_buffer!=null&&e.deleteBuffer(this.program_1_position_buffer),this.program_1!=null&&e.deleteProgram(this.program_1),this.program_2_intermediate_texture!=null&&e.deleteTexture(this.program_2_intermediate_texture),this.program_2_position_buffer!=null&&e.deleteBuffer(this.program_2_position_buffer),this.program_2!=null&&e.deleteProgram(this.program_2),this.program_3_intermediate_texture!=null&&e.deleteTexture(this.program_3_intermediate_texture),this.program_3_position_buffer!=null&&e.deleteBuffer(this.program_3_position_buffer),this.program_3!=null&&e.deleteProgram(this.program_3),this.program_4_intermediate_texture!=null&&e.deleteTexture(this.program_4_intermediate_texture),this.program_4_position_buffer!=null&&e.deleteBuffer(this.program_4_position_buffer),this.program_4!=null&&e.deleteProgram(this.program_4),this.program_5_intermediate_texture!=null&&e.deleteTexture(this.program_5_intermediate_texture),this.program_5_position_buffer!=null&&e.deleteBuffer(this.program_5_position_buffer),this.program_5!=null&&e.deleteProgram(this.program_5),this.program_6_intermediate_texture!=null&&e.deleteTexture(this.program_6_intermediate_texture),this.program_6_position_buffer!=null&&e.deleteBuffer(this.program_6_position_buffer),this.program_6!=null&&e.deleteProgram(this.program_6),this.program_7_intermediate_texture!=null&&e.deleteTexture(this.program_7_intermediate_texture),this.program_7_position_buffer!=null&&e.deleteBuffer(this.program_7_position_buffer),this.program_7!=null&&e.deleteProgram(this.program_7),this.program_8_intermediate_texture!=null&&e.deleteTexture(this.program_8_intermediate_texture),this.program_8_position_buffer!=null&&e.deleteBuffer(this.program_8_position_buffer),this.program_8!=null&&e.deleteProgram(this.program_8)}magnification(){let e=new Map([["MAIN",{width:1,height:1}],["NATIVE",{width:1,height:1}],["OUTPUT",{width:1,height:1}]]);{if(!e.get("MAIN"))return[1,1];let s=e.get("MAIN");if(!s)return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];e.set("conv2d_tf",{width:s.width,height:s.height})}{if(!e.get("MAIN"))return[1,1];if(!e.get("MAIN"))return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];let o=e.get("conv2d_tf");if(!o)return[1,1];e.set("conv2d_1_tf",{width:o.width,height:o.height})}{if(!e.get("MAIN"))return[1,1];if(!e.get("MAIN"))return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];let o=e.get("conv2d_1_tf");if(!o)return[1,1];e.set("conv2d_2_tf",{width:o.width,height:o.height})}{if(!e.get("MAIN"))return[1,1];if(!e.get("MAIN"))return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];let o=e.get("conv2d_2_tf");if(!o)return[1,1];e.set("conv2d_3_tf",{width:o.width,height:o.height})}{if(!e.get("MAIN"))return[1,1];if(!e.get("MAIN"))return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];let o=e.get("conv2d_3_tf");if(!o)return[1,1];e.set("conv2d_4_tf",{width:o.width,height:o.height})}{if(!e.get("MAIN"))return[1,1];if(!e.get("MAIN"))return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];let o=e.get("conv2d_4_tf");if(!o)return[1,1];e.set("conv2d_5_tf",{width:o.width,height:o.height})}{if(!e.get("MAIN"))return[1,1];if(!e.get("MAIN"))return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];let o=e.get("conv2d_5_tf");if(!o)return[1,1];e.set("conv2d_6_tf",{width:o.width,height:o.height})}{if(!e.get("MAIN"))return[1,1];if(!e.get("MAIN"))return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];if(!e.get("conv2d_1_tf"))return[1,1];if(!e.get("conv2d_2_tf"))return[1,1];if(!e.get("conv2d_3_tf"))return[1,1];if(!e.get("conv2d_4_tf"))return[1,1];if(!e.get("conv2d_5_tf"))return[1,1];if(!e.get("conv2d_6_tf"))return[1,1];let v=e.get("conv2d_tf");if(!v)return[1,1];e.set("conv2d_last_tf",{width:v.width,height:v.height})}{if(!e.get("MAIN"))return[1,1];if(!e.get("MAIN"))return[1,1];if(!e.get("NATIVE"))return[1,1];if(!e.get("OUTPUT"))return[1,1];let o=e.get("conv2d_last_tf");if(!o)return[1,1];e.set("MAIN",{width:o.width*2,height:o.height*2})}let u=e.get("MAIN")?.width??1,t=e.get("MAIN")?.height??1;return[u,t]}hook_MAIN(e,u){let t=this.gl,n=this.texcoordBuffer;if(n){{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE"))return;let o=e.get("OUTPUT");if(!o)return;if(o.width/_.width>1.2&&o.height/_.height>1.2){let r=this.program_0_intermediate_texture;(this.program_0_intermediate_texture_cached_width!==_.width||this.program_0_intermediate_texture_cached_height!==_.height)&&T(t,r,_.width,_.height),t.viewport(0,0,_.width,_.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,r,0),t.useProgram(this.program_0),this.program_0_position_buffer==null?this.program_0_position_buffer=f(t,0,0,_.width,_.height):(this.program_0_intermediate_texture_cached_width!==_.width||this.program_0_intermediate_texture_cached_height!==_.height)&&(t.deleteBuffer(this.program_0_position_buffer),this.program_0_position_buffer=f(t,0,0,_.width,_.height));let a=this.program_0_position_buffer;m(t,this.program_0_a_position_location,a),m(t,this.program_0_a_texture_coord_location,n),t.uniform2f(this.program_0_u_resolution_location,_.width,_.height),t.uniform2f(this.program_0_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,_.texture),t.uniform1i(this.program_0_MAIN_TextureLocation,0),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),this.program_0_intermediate_texture_cached_width=_.width,this.program_0_intermediate_texture_cached_height=_.height,e.set("conv2d_tf",{texture:r,width:_.width,height:_.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE"))return;let o=e.get("OUTPUT");if(!o)return;let r=e.get("conv2d_tf");if(!r)return;if(o.width/_.width>1.2&&o.height/_.height>1.2){let a=this.program_1_intermediate_texture;(this.program_1_intermediate_texture_cached_width!==r.width||this.program_1_intermediate_texture_cached_height!==r.height)&&T(t,a,r.width,r.height),t.viewport(0,0,r.width,r.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,a,0),t.useProgram(this.program_1),this.program_1_position_buffer==null?this.program_1_position_buffer=f(t,0,0,r.width,r.height):(this.program_1_intermediate_texture_cached_width!==r.width||this.program_1_intermediate_texture_cached_height!==r.height)&&(t.deleteBuffer(this.program_1_position_buffer),this.program_1_position_buffer=f(t,0,0,r.width,r.height));let d=this.program_1_position_buffer;m(t,this.program_1_a_position_location,d),m(t,this.program_1_a_texture_coord_location,n),t.uniform2f(this.program_1_u_resolution_location,r.width,r.height),t.uniform2f(this.program_1_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_1_conv2d_tf_TextureLocation,0),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),this.program_1_intermediate_texture_cached_width=r.width,this.program_1_intermediate_texture_cached_height=r.height,e.set("conv2d_1_tf",{texture:a,width:r.width,height:r.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE"))return;let o=e.get("OUTPUT");if(!o)return;let r=e.get("conv2d_1_tf");if(!r)return;if(o.width/_.width>1.2&&o.height/_.height>1.2){let a=this.program_2_intermediate_texture;(this.program_2_intermediate_texture_cached_width!==r.width||this.program_2_intermediate_texture_cached_height!==r.height)&&T(t,a,r.width,r.height),t.viewport(0,0,r.width,r.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,a,0),t.useProgram(this.program_2),this.program_2_position_buffer==null?this.program_2_position_buffer=f(t,0,0,r.width,r.height):(this.program_2_intermediate_texture_cached_width!==r.width||this.program_2_intermediate_texture_cached_height!==r.height)&&(t.deleteBuffer(this.program_2_position_buffer),this.program_2_position_buffer=f(t,0,0,r.width,r.height));let d=this.program_2_position_buffer;m(t,this.program_2_a_position_location,d),m(t,this.program_2_a_texture_coord_location,n),t.uniform2f(this.program_2_u_resolution_location,r.width,r.height),t.uniform2f(this.program_2_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_2_conv2d_1_tf_TextureLocation,0),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),this.program_2_intermediate_texture_cached_width=r.width,this.program_2_intermediate_texture_cached_height=r.height,e.set("conv2d_2_tf",{texture:a,width:r.width,height:r.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE"))return;let o=e.get("OUTPUT");if(!o)return;let r=e.get("conv2d_2_tf");if(!r)return;if(o.width/_.width>1.2&&o.height/_.height>1.2){let a=this.program_3_intermediate_texture;(this.program_3_intermediate_texture_cached_width!==r.width||this.program_3_intermediate_texture_cached_height!==r.height)&&T(t,a,r.width,r.height),t.viewport(0,0,r.width,r.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,a,0),t.useProgram(this.program_3),this.program_3_position_buffer==null?this.program_3_position_buffer=f(t,0,0,r.width,r.height):(this.program_3_intermediate_texture_cached_width!==r.width||this.program_3_intermediate_texture_cached_height!==r.height)&&(t.deleteBuffer(this.program_3_position_buffer),this.program_3_position_buffer=f(t,0,0,r.width,r.height));let d=this.program_3_position_buffer;m(t,this.program_3_a_position_location,d),m(t,this.program_3_a_texture_coord_location,n),t.uniform2f(this.program_3_u_resolution_location,r.width,r.height),t.uniform2f(this.program_3_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_3_conv2d_2_tf_TextureLocation,0),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),this.program_3_intermediate_texture_cached_width=r.width,this.program_3_intermediate_texture_cached_height=r.height,e.set("conv2d_3_tf",{texture:a,width:r.width,height:r.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE"))return;let o=e.get("OUTPUT");if(!o)return;let r=e.get("conv2d_3_tf");if(!r)return;if(o.width/_.width>1.2&&o.height/_.height>1.2){let a=this.program_4_intermediate_texture;(this.program_4_intermediate_texture_cached_width!==r.width||this.program_4_intermediate_texture_cached_height!==r.height)&&T(t,a,r.width,r.height),t.viewport(0,0,r.width,r.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,a,0),t.useProgram(this.program_4),this.program_4_position_buffer==null?this.program_4_position_buffer=f(t,0,0,r.width,r.height):(this.program_4_intermediate_texture_cached_width!==r.width||this.program_4_intermediate_texture_cached_height!==r.height)&&(t.deleteBuffer(this.program_4_position_buffer),this.program_4_position_buffer=f(t,0,0,r.width,r.height));let d=this.program_4_position_buffer;m(t,this.program_4_a_position_location,d),m(t,this.program_4_a_texture_coord_location,n),t.uniform2f(this.program_4_u_resolution_location,r.width,r.height),t.uniform2f(this.program_4_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_4_conv2d_3_tf_TextureLocation,0),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),this.program_4_intermediate_texture_cached_width=r.width,this.program_4_intermediate_texture_cached_height=r.height,e.set("conv2d_4_tf",{texture:a,width:r.width,height:r.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE"))return;let o=e.get("OUTPUT");if(!o)return;let r=e.get("conv2d_4_tf");if(!r)return;if(o.width/_.width>1.2&&o.height/_.height>1.2){let a=this.program_5_intermediate_texture;(this.program_5_intermediate_texture_cached_width!==r.width||this.program_5_intermediate_texture_cached_height!==r.height)&&T(t,a,r.width,r.height),t.viewport(0,0,r.width,r.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,a,0),t.useProgram(this.program_5),this.program_5_position_buffer==null?this.program_5_position_buffer=f(t,0,0,r.width,r.height):(this.program_5_intermediate_texture_cached_width!==r.width||this.program_5_intermediate_texture_cached_height!==r.height)&&(t.deleteBuffer(this.program_5_position_buffer),this.program_5_position_buffer=f(t,0,0,r.width,r.height));let d=this.program_5_position_buffer;m(t,this.program_5_a_position_location,d),m(t,this.program_5_a_texture_coord_location,n),t.uniform2f(this.program_5_u_resolution_location,r.width,r.height),t.uniform2f(this.program_5_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_5_conv2d_4_tf_TextureLocation,0),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),this.program_5_intermediate_texture_cached_width=r.width,this.program_5_intermediate_texture_cached_height=r.height,e.set("conv2d_5_tf",{texture:a,width:r.width,height:r.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE"))return;let o=e.get("OUTPUT");if(!o)return;let r=e.get("conv2d_5_tf");if(!r)return;if(o.width/_.width>1.2&&o.height/_.height>1.2){let a=this.program_6_intermediate_texture;(this.program_6_intermediate_texture_cached_width!==r.width||this.program_6_intermediate_texture_cached_height!==r.height)&&T(t,a,r.width,r.height),t.viewport(0,0,r.width,r.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,a,0),t.useProgram(this.program_6),this.program_6_position_buffer==null?this.program_6_position_buffer=f(t,0,0,r.width,r.height):(this.program_6_intermediate_texture_cached_width!==r.width||this.program_6_intermediate_texture_cached_height!==r.height)&&(t.deleteBuffer(this.program_6_position_buffer),this.program_6_position_buffer=f(t,0,0,r.width,r.height));let d=this.program_6_position_buffer;m(t,this.program_6_a_position_location,d),m(t,this.program_6_a_texture_coord_location,n),t.uniform2f(this.program_6_u_resolution_location,r.width,r.height),t.uniform2f(this.program_6_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_6_conv2d_5_tf_TextureLocation,0),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),this.program_6_intermediate_texture_cached_width=r.width,this.program_6_intermediate_texture_cached_height=r.height,e.set("conv2d_6_tf",{texture:a,width:r.width,height:r.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE"))return;let o=e.get("OUTPUT");if(!o)return;let r=e.get("conv2d_1_tf");if(!r)return;let a=e.get("conv2d_2_tf");if(!a)return;let d=e.get("conv2d_3_tf");if(!d)return;let L=e.get("conv2d_4_tf");if(!L)return;let U=e.get("conv2d_5_tf");if(!U)return;let v=e.get("conv2d_6_tf");if(!v)return;let h=e.get("conv2d_tf");if(!h)return;if(o.width/_.width>1.2&&o.height/_.height>1.2){let N=this.program_7_intermediate_texture;(this.program_7_intermediate_texture_cached_width!==h.width||this.program_7_intermediate_texture_cached_height!==h.height)&&T(t,N,h.width,h.height),t.viewport(0,0,h.width,h.height),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,N,0),t.useProgram(this.program_7),this.program_7_position_buffer==null?this.program_7_position_buffer=f(t,0,0,h.width,h.height):(this.program_7_intermediate_texture_cached_width!==h.width||this.program_7_intermediate_texture_cached_height!==h.height)&&(t.deleteBuffer(this.program_7_position_buffer),this.program_7_position_buffer=f(t,0,0,h.width,h.height));let G=this.program_7_position_buffer;m(t,this.program_7_a_position_location,G),m(t,this.program_7_a_texture_coord_location,n),t.uniform2f(this.program_7_u_resolution_location,h.width,h.height),t.uniform2f(this.program_7_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,h.texture),t.uniform1i(this.program_7_conv2d_tf_TextureLocation,0),t.activeTexture(t.TEXTURE1),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_7_conv2d_1_tf_TextureLocation,1),t.activeTexture(t.TEXTURE2),t.bindTexture(t.TEXTURE_2D,a.texture),t.uniform1i(this.program_7_conv2d_2_tf_TextureLocation,2),t.activeTexture(t.TEXTURE3),t.bindTexture(t.TEXTURE_2D,d.texture),t.uniform1i(this.program_7_conv2d_3_tf_TextureLocation,3),t.activeTexture(t.TEXTURE4),t.bindTexture(t.TEXTURE_2D,L.texture),t.uniform1i(this.program_7_conv2d_4_tf_TextureLocation,4),t.activeTexture(t.TEXTURE5),t.bindTexture(t.TEXTURE_2D,U.texture),t.uniform1i(this.program_7_conv2d_5_tf_TextureLocation,5),t.activeTexture(t.TEXTURE6),t.bindTexture(t.TEXTURE_2D,v.texture),t.uniform1i(this.program_7_conv2d_6_tf_TextureLocation,6),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE1),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE2),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE3),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE4),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE5),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE6),t.bindTexture(t.TEXTURE_2D,null),this.program_7_intermediate_texture_cached_width=h.width,this.program_7_intermediate_texture_cached_height=h.height,e.set("conv2d_last_tf",{texture:N,width:h.width,height:h.height})}}{if(!e.get("MAIN"))return;let _=e.get("MAIN");if(!_||!e.get("NATIVE"))return;let o=e.get("OUTPUT");if(!o)return;let r=e.get("conv2d_last_tf");if(!r)return;if(o.width/_.width>1.2&&o.height/_.height>1.2){let a=this.program_8_intermediate_texture;(this.program_8_intermediate_texture_cached_width!==r.width*2||this.program_8_intermediate_texture_cached_height!==r.height*2)&&T(t,a,r.width*2,r.height*2),t.viewport(0,0,r.width*2,r.height*2),t.bindFramebuffer(t.FRAMEBUFFER,u),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,a,0),t.useProgram(this.program_8),this.program_8_position_buffer==null?this.program_8_position_buffer=f(t,0,0,r.width*2,r.height*2):(this.program_8_intermediate_texture_cached_width!==r.width*2||this.program_8_intermediate_texture_cached_height!==r.height*2)&&(t.deleteBuffer(this.program_8_position_buffer),this.program_8_position_buffer=f(t,0,0,r.width*2,r.height*2));let d=this.program_8_position_buffer;m(t,this.program_8_a_position_location,d),m(t,this.program_8_a_texture_coord_location,n),t.uniform2f(this.program_8_u_resolution_location,r.width*2,r.height*2),t.uniform2f(this.program_8_u_texture_size_location,_.width,_.height),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,_.texture),t.uniform1i(this.program_8_MAIN_TextureLocation,0),t.activeTexture(t.TEXTURE1),t.bindTexture(t.TEXTURE_2D,r.texture),t.uniform1i(this.program_8_conv2d_last_tf_TextureLocation,1),t.drawArrays(t.TRIANGLES,0,6),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,null),t.activeTexture(t.TEXTURE1),t.bindTexture(t.TEXTURE_2D,null),this.program_8_intermediate_texture_cached_width=r.width*2,this.program_8_intermediate_texture_cached_height=r.height*2,e.set("MAIN",{texture:a,width:r.width*2,height:r.height*2})}}}}hook_PREKERNEL(e,u){let t=this.gl;this.texcoordBuffer}};var m0=[w,O,M];return V(c0);})();
