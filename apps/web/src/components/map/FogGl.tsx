import type { Fog } from '@daggerheart/protocol';
import { useEffect, useMemo, useRef } from 'react';

/**
 * Fog of war drawn on the GPU.
 *
 * The Konva version put one rectangle per unrevealed cell on the canvas, so a
 * large scene meant thousands of fills every frame and hard, blocky edges. Here
 * the whole fog is one texture, one quad and one draw call, and sampling that
 * texture with linear filtering feathers the border between seen and unseen for
 * free.
 *
 * It renders in its own canvas over the Konva stage, which is why the ruler now
 * reads through the fog rather than over it. That only matters to the GM, who
 * sees fog at half strength anyway; a player has no revealed ground to measure
 * inside the dark.
 *
 * If WebGL is missing the component renders nothing and says so through
 * `onUnavailable`, because fog hides the map image the client has already been
 * given: failing open would show a player the room they have not walked into.
 */

/** A hex design token as the three floats a shader wants. */
export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.trim().replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [0, 0, 0];
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
}

/**
 * One byte per fog cell: 255 where the party has been, 0 where it has not.
 *
 * A player's client only ever holds the revealed list, so everything absent from
 * it is covered. That is the same rule the Konva version applied, moved into a
 * texture.
 */
export function buildFogMask(fog: Pick<Fog, 'cols' | 'rows' | 'revealed'>): Uint8Array {
  const mask = new Uint8Array(Math.max(0, fog.cols * fog.rows));
  for (const index of fog.revealed) {
    if (index >= 0 && index < mask.length) mask[index] = 255;
  }
  return mask;
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

/**
 * Screen pixel to scene point to fog cell, then one texture read.
 *
 * `smoothstep` across the middle of the linear blend is what softens the edge:
 * a texel is a whole cell, so halfway between a seen and an unseen cell centre
 * the sample sits at 0.5 and the cover fades instead of stepping.
 */
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform vec3 uView;
uniform float uDpr;
uniform vec2 uFogDims;
uniform float uCellSize;
uniform vec3 uColor;
uniform float uMaxAlpha;
uniform sampler2D uMask;

out vec4 fragColor;

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y) / uDpr;
  vec2 scene = (pixel - uView.xy) / uView.z;
  vec2 uv = (scene / uCellSize) / uFogDims;

  float revealed = texture(uMask, uv).r;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) revealed = 0.0;

  float alpha = (1.0 - smoothstep(0.35, 0.65, revealed)) * uMaxAlpha;
  // Premultiplied, to match the blend function the context is set up with.
  fragColor = vec4(uColor * alpha, alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

interface FogGlProps {
  fog: Fog;
  /** The scene's pan and zoom, in CSS pixels. */
  view: { x: number; y: number; scale: number };
  width: number;
  height: number;
  /** The GM reads the map through the fog, so their cover is half strength. */
  isGameMaster: boolean;
  /** Called once when WebGL cannot be had, so the caller can cover the map itself. */
  onUnavailable: () => void;
}

export function FogGl({ fog, view, width, height, isGameMaster, onUnavailable }: FogGlProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<{
    gl: WebGL2RenderingContext;
    program: WebGLProgram;
    texture: WebGLTexture;
    uniforms: Record<string, WebGLUniformLocation | null>;
  } | null>(null);

  const mask = useMemo(() => buildFogMask(fog), [fog]);
  const colour = useMemo(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--c-bg');
    return hexToRgb(raw === '' ? '#0b0812' : raw);
  }, []);

  // Set the context up once. A lost context tears this down and the effect below
  // simply stops drawing, which leaves the fallback cover in place.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
    if (gl === null) {
      onUnavailable();
      return;
    }

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (vertex === null || fragment === null || program === null) {
      onUnavailable();
      return;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      onUnavailable();
      return;
    }

    // Two triangles covering clip space; the shader does all the mapping.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    if (texture === null) {
      onUnavailable();
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const names = [
      'uResolution',
      'uView',
      'uDpr',
      'uFogDims',
      'uCellSize',
      'uColor',
      'uMaxAlpha',
      'uMask',
    ];
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of names) uniforms[name] = gl.getUniformLocation(program, name);

    glRef.current = { gl, program, texture, uniforms };
    return () => {
      gl.deleteProgram(program);
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      glRef.current = null;
    };
  }, [onUnavailable]);

  // Everything that can change during play: the revealed set, the camera, the size.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = glRef.current;
    if (canvas === null || context === null) return;
    const { gl, program, texture, uniforms } = context;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      Math.max(1, fog.cols),
      Math.max(1, fog.rows),
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      mask.length > 0 ? mask : new Uint8Array(1),
    );

    gl.uniform2f(uniforms.uResolution ?? null, canvas.width, canvas.height);
    gl.uniform3f(uniforms.uView ?? null, view.x, view.y, view.scale);
    gl.uniform1f(uniforms.uDpr ?? null, dpr);
    gl.uniform2f(uniforms.uFogDims ?? null, Math.max(1, fog.cols), Math.max(1, fog.rows));
    gl.uniform1f(uniforms.uCellSize ?? null, fog.cellSize);
    gl.uniform3f(uniforms.uColor ?? null, colour[0], colour[1], colour[2]);
    gl.uniform1f(uniforms.uMaxAlpha ?? null, isGameMaster ? 0.5 : 1);
    gl.uniform1i(uniforms.uMask ?? null, 0);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }, [mask, fog.cols, fog.rows, fog.cellSize, view, width, height, isGameMaster, colour]);

  return (
    <canvas
      ref={canvasRef}
      className="map-fog-gl"
      style={{ width: `${width}px`, height: `${height}px` }}
    />
  );
}
