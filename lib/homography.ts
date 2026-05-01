// Perspective rectification: given a source image and 4 quadrilateral
// corners (TL, TR, BR, BL), return a square canvas where the quadrilateral
// has been warped to fill the canvas.
//
// Implementation: compute the inverse 3x3 homography with perspective-transform,
// then apply it per-pixel via a WebGL fragment shader. WebGL gets us linear
// filtering + GPU speed for free, with a tiny shader.

import PerspT from "perspective-transform";

export type Point = { x: number; y: number };

export type CornerSet = {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
};

export type RectifyResult = {
  canvas: HTMLCanvasElement;
  /** Inverse homography coeffs (dst -> src), persisted to the audit JSON. */
  inverseCoeffs: number[];
  /** Forward homography coeffs (src -> dst). */
  forwardCoeffs: number[];
};

const VERT_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = (a_pos + 1.0) * 0.5;       // 0..1 across the destination
  v_uv.y = 1.0 - v_uv.y;             // flip so origin is top-left
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SHADER = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_dstSize;            // destination canvas size in px
uniform vec2 u_srcSize;            // source image size in px
uniform float u_h[8];              // inverse homography coeffs a..h, i=1

void main() {
  // Destination pixel in pixel coords
  vec2 d = v_uv * u_dstSize;
  // Apply inverse homography
  float denom = u_h[6] * d.x + u_h[7] * d.y + 1.0;
  float sx = (u_h[0] * d.x + u_h[1] * d.y + u_h[2]) / denom;
  float sy = (u_h[3] * d.x + u_h[4] * d.y + u_h[5]) / denom;
  if (sx < 0.0 || sy < 0.0 || sx > u_srcSize.x || sy > u_srcSize.y) {
    gl_FragColor = vec4(0.5, 0.5, 0.5, 1.0);
    return;
  }
  vec2 uv = vec2(sx / u_srcSize.x, sy / u_srcSize.y);
  gl_FragColor = texture2D(u_src, uv);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("createShader failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile: ${log}`);
  }
  return sh;
}

function link(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error("createProgram failed");
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`program link: ${log}`);
  }
  return p;
}

export function rectify(opts: {
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  corners: CornerSet;
  outputSize: number;
}): RectifyResult {
  const { source, corners, outputSize } = opts;

  // Source dimensions
  const srcW =
    "naturalWidth" in source && source.naturalWidth ? source.naturalWidth : source.width;
  const srcH =
    "naturalHeight" in source && source.naturalHeight
      ? source.naturalHeight
      : source.height;

  // Build the homography. perspective-transform expects flat arrays in
  // TL, TR, BR, BL order in source pixel space.
  const srcCorners = [
    corners.tl.x, corners.tl.y,
    corners.tr.x, corners.tr.y,
    corners.br.x, corners.br.y,
    corners.bl.x, corners.bl.y,
  ];
  const dstCorners = [
    0, 0,
    outputSize, 0,
    outputSize, outputSize,
    0, outputSize,
  ];
  const persp = PerspT(srcCorners, dstCorners);

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const gl =
    canvas.getContext("webgl") ??
    (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
  if (!gl) throw new Error("WebGL not available");

  const vs = compile(gl, gl.VERTEX_SHADER, VERT_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SHADER);
  const prog = link(gl, vs, fs);
  gl.useProgram(prog);

  // Full-screen quad
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );
  const aPos = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Upload source as a texture
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Uniforms
  gl.uniform1i(gl.getUniformLocation(prog, "u_src"), 0);
  gl.uniform2f(gl.getUniformLocation(prog, "u_dstSize"), outputSize, outputSize);
  gl.uniform2f(gl.getUniformLocation(prog, "u_srcSize"), srcW, srcH);
  gl.uniform1fv(
    gl.getUniformLocation(prog, "u_h[0]"),
    new Float32Array(persp.coeffsInv.slice(0, 8))
  );

  gl.viewport(0, 0, outputSize, outputSize);
  gl.clearColor(0.5, 0.5, 0.5, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  return {
    canvas,
    inverseCoeffs: persp.coeffsInv.slice(),
    forwardCoeffs: persp.coeffs.slice(),
  };
}

export async function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality = 0.9
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      "image/jpeg",
      quality
    );
  });
}
