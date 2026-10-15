/**
 * Orbit's face, painted on a canvas used as the 3D face-screen texture: a rounded glossy
 * black screen with big glowing ring eyes (blue gradient iris + white sparkles), lids,
 * rosy cheeks and a cyan mouth. Pure drawing from a small state object; redrawn only when
 * the (quantised) state changes.
 */
import type { EyeShape, MouthShape } from "../orbit/poses";

export interface FaceState {
  eyes: EyeShape;
  mouth: MouthShape;
  lookX: number; // -1..1
  lookY: number; // -1..1
  lid: number; // 0 open .. 1 closed
  mouthOpen: number; // 0..1 (talk)
  blush: boolean;
  eyeScale: number;
}

export const FACE_W = 512;
export const FACE_H = 360;
const CYAN = "#22D3EE";
const CYAN_GLOW = "rgba(56,189,248,0.9)";

/** Stable key so the texture is only redrawn when something visible changed. */
export function faceKey(s: FaceState): string {
  const q = (v: number, step: number) => Math.round(v / step);
  return [s.eyes, s.mouth, q(s.lookX, 0.05), q(s.lookY, 0.05), q(s.lid, 0.1), q(s.mouthOpen, 0.08), s.blush ? 1 : 0, q(s.eyeScale, 0.05)].join("|");
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawEye(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: FaceState) {
  const scale = s.eyeScale;
  ctx.save();
  ctx.lineCap = "round";
  if (s.eyes === "happy" || s.eyes === "closed") {
    ctx.shadowColor = CYAN_GLOW;
    ctx.shadowBlur = 22;
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 13;
    ctx.beginPath();
    if (s.eyes === "happy") {
      ctx.moveTo(cx - 34, cy + 12);
      ctx.quadraticCurveTo(cx, cy - 36, cx + 34, cy + 12);
    } else {
      ctx.moveTo(cx - 32, cy + 4);
      ctx.quadraticCurveTo(cx, cy + 22, cx + 32, cy + 4);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  const r = (s.eyes === "wide" ? 52 : s.eyes === "focused" ? 42 : 48) * scale;
  const ry = s.eyes === "squint" ? r * 0.42 : r;
  const ix = cx + s.lookX * 12;
  const iy = cy + s.lookY * 10;

  // Outer glow
  const glow = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.6);
  glow.addColorStop(0, "rgba(56,189,248,0.35)");
  glow.addColorStop(1, "rgba(56,189,248,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 1.6, ry * 1.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyeball (deep navy)
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  const ball = ctx.createRadialGradient(cx, cy - ry * 0.2, 4, cx, cy, r);
  ball.addColorStop(0, "#0E2A66");
  ball.addColorStop(1, "#050E26");
  ctx.fillStyle = ball;
  ctx.fillRect(cx - r, cy - ry, r * 2, ry * 2);

  // Iris
  const ir = (s.eyes === "focused" ? 30 : 36) * scale;
  const iris = ctx.createRadialGradient(ix - ir * 0.25, iy - ir * 0.3, 2, ix, iy, ir);
  iris.addColorStop(0, "#7FE9FF");
  iris.addColorStop(0.45, "#16B4EE");
  iris.addColorStop(1, "#1446C8");
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.ellipse(ix, iy, ir, Math.min(ir, ry * 0.85), 0, 0, Math.PI * 2);
  ctx.fill();
  // Pupil
  ctx.fillStyle = "rgba(4,16,48,0.85)";
  ctx.beginPath();
  ctx.ellipse(ix, iy, ir * 0.42, Math.min(ir * 0.42, ry * 0.4), 0, 0, Math.PI * 2);
  ctx.fill();
  // Sparkles
  if (ry > 26) {
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(ix - ir * 0.42, iy - ir * 0.45, ir * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(ix + ir * 0.4, iy + ir * 0.38, ir * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Lids (blink / sleepy) and sad slant
  const cover = Math.max(0, Math.min(1, s.lid)) * ry * 2;
  ctx.fillStyle = "#070B1A";
  if (cover > 1) ctx.fillRect(cx - r - 4, cy - ry - 4, r * 2 + 8, cover + 4);
  if (s.eyes === "sad") {
    ctx.beginPath();
    ctx.moveTo(cx - r - 6, cy - ry - 6);
    ctx.lineTo(cx + r + 6, cy - ry - 6);
    ctx.lineTo(cx - r - 6, cy - ry * 0.05);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Glowing ring
  ctx.shadowColor = CYAN_GLOW;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawMouth(ctx: CanvasRenderingContext2D, s: FaceState, cx: number, cy: number) {
  ctx.save();
  ctx.shadowColor = CYAN_GLOW;
  ctx.shadowBlur = 16;
  ctx.strokeStyle = CYAN;
  ctx.fillStyle = CYAN;
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  switch (s.mouth) {
    case "grin":
      ctx.moveTo(cx - 32, cy - 8);
      ctx.quadraticCurveTo(cx, cy + 38, cx + 32, cy - 8);
      ctx.quadraticCurveTo(cx, cy + 6, cx - 32, cy - 8);
      ctx.fill();
      break;
    case "open":
      ctx.ellipse(cx, cy + 6, 15, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "talk":
      ctx.ellipse(cx, cy + 6, 13 + s.mouthOpen * 6, 4 + s.mouthOpen * 15, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "o":
      ctx.ellipse(cx, cy + 6, 10, 10, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "flat":
      ctx.moveTo(cx - 20, cy + 6);
      ctx.lineTo(cx + 20, cy + 6);
      ctx.stroke();
      break;
    case "frown":
      ctx.moveTo(cx - 24, cy + 16);
      ctx.quadraticCurveTo(cx, cy - 8, cx + 24, cy + 16);
      ctx.stroke();
      break;
    case "wavy":
      ctx.moveTo(cx - 30, cy + 8);
      for (let i = 0; i < 6; i++) ctx.quadraticCurveTo(cx - 25 + i * 10, cy + (i % 2 ? 16 : 0), cx - 20 + i * 10, cy + 8);
      ctx.stroke();
      break;
    default:
      ctx.moveTo(cx - 26, cy - 4);
      ctx.quadraticCurveTo(cx, cy + 26, cx + 26, cy - 4);
      ctx.stroke();
  }
  ctx.restore();
}

export function drawFace(ctx: CanvasRenderingContext2D, s: FaceState): void {
  ctx.clearRect(0, 0, FACE_W, FACE_H);
  const x = 14, y = 14, w = FACE_W - 28, h = FACE_H - 28;

  // Screen: rounded, deep blue-black with a subtle vignette and blue inner rim.
  roundRect(ctx, x, y, w, h, 130);
  const bg = ctx.createRadialGradient(FACE_W / 2, FACE_H * 0.32, 20, FACE_W / 2, FACE_H / 2, FACE_W * 0.62);
  bg.addColorStop(0, "#0D1636");
  bg.addColorStop(0.55, "#050A1C");
  bg.addColorStop(1, "#010205");
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(56,189,248,0.12)";
  roundRect(ctx, x + 4, y + 4, w - 8, h - 8, 126);
  ctx.stroke();

  // Face features
  drawEye(ctx, FACE_W / 2 - 98, FACE_H / 2 - 14, s);
  drawEye(ctx, FACE_W / 2 + 98, FACE_H / 2 - 14, s);
  if (s.blush) {
    for (const bx of [FACE_W / 2 - 160, FACE_W / 2 + 160]) {
      const g = ctx.createRadialGradient(bx, FACE_H / 2 + 52, 2, bx, FACE_H / 2 + 52, 34);
      g.addColorStop(0, "rgba(255,143,184,0.75)");
      g.addColorStop(1, "rgba(255,143,184,0)");
      ctx.fillStyle = g;
      ctx.fillRect(bx - 40, FACE_H / 2 + 22, 80, 60);
    }
  }
  drawMouth(ctx, s, FACE_W / 2, FACE_H / 2 + 62);

  // Glass reflection
  const shine = ctx.createLinearGradient(0, y, 0, y + h * 0.45);
  shine.addColorStop(0, "rgba(255,255,255,0.13)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.ellipse(FACE_W * 0.4, y + h * 0.14, w * 0.33, h * 0.12, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
