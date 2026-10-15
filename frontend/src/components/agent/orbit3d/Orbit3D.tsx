import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ttsAdapter } from "../../../services/ttsAdapter";
import { OrbitRig, OrbitRigProps } from "../orbit/OrbitRig";
import { applyEmotion, poseFor, OrbitPose } from "../orbit/poses";
import { createBlinker, createLipSync, motionLayers, pickNumbers, stepSprings } from "../orbit/rigMotion";
import { buildOrbit, OrbitModel } from "./buildOrbit";
import { drawFace, faceKey, FaceState } from "./faceTexture";

const CALM = new Set(["idle", "resting", "offline", "paused", "waiting", "needs_input", "needs_confirmation", "cancelled"]);
const DEG = Math.PI / 180;
const PX = 57; // SVG pose units (240px tall view) per world unit

/**
 * Real-time 3D Orbit. Same props and behaviour contract as the SVG rig (which it falls back
 * to if WebGL is unavailable or the context is lost). Renders imperatively in its own
 * frame-capped loop; React only re-renders when props change.
 */
export const Orbit3D: React.FC<OrbitRigProps> = (props) => {
  const { width, reducedMotion = false, label, state } = props;
  const height = Math.round(width * 1.2);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.85;
    scene.add(new THREE.HemisphereLight(0xf0f4ff, 0x8b9cff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(-3, 5, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7aa2ff, 2.6);
    rim.position.set(4, 2.5, -5);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xdbe4ff, 0.6);
    fill.position.set(3, -1, 4);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 50);
    camera.position.set(0, 1.0, 11.2);
    camera.lookAt(0, 0.85, 0);

    const model: OrbitModel = buildOrbit();
    scene.add(model.root);

    const cur = pickNumbers(poseFor(state));
    const lip = createLipSync((fn) => ttsAdapter.subscribe(fn as any));
    const blinker = createBlinker();
    const coreColor = new THREE.Color();
    const t0 = performance.now();
    let since = { state, at: t0 };
    let lastKey = "";
    let lastFrame = 0;
    let lastPaint = 0;
    let raf = 0;
    let visible = true;
    let pointer: { x: number; y: number } | null = null;

    const onPointer = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    io.observe(canvas);
    const onLost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    canvas.addEventListener("webglcontextlost", onLost);

    const setVisible = (o: THREE.Object3D, v: boolean) => {
      o.visible = v;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const p = propsRef.current;
      const live = !p.reducedMotion;
      const calm = CALM.has(p.state);
      if (!visible || document.hidden) return;
      if (now - lastPaint < (calm ? 66 : 33)) return;
      const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000);
      lastFrame = now;
      lastPaint = now;

      if (since.state !== p.state) since = { state: p.state, at: now };
      const pose: OrbitPose = applyEmotion(poseFor(p.state), p.state === "speaking" ? p.emotion : null);
      stepSprings(cur, pose, dt, !live);
      const time = (now - t0) / 1000;
      const elapsed = (now - since.at) / 1000;

      // Gaze: the real target first; the pointer only while calm.
      const mirrored = p.facing === "left";
      let gaze: { x: number; y: number } | null = null;
      const point = p.lookAt ?? (p.followPointer !== false && ["idle", "listening", "curious"].includes(p.state) ? pointer : null);
      if (point) {
        const r = canvas.getBoundingClientRect();
        const dx = (point.x - (r.left + r.width / 2)) / 260;
        const dy = (point.y - (r.top + r.height * 0.35)) / 260;
        gaze = { x: Math.max(-1, Math.min(1, mirrored ? -dx : dx)), y: Math.max(-1, Math.min(1, dy)) };
      }
      const f = motionLayers(pose, cur, time, elapsed, live, gaze);

      // ---- Joints ----
      const m = model;
      m.root.scale.x = mirrored ? -1 : 1;
      m.root.position.y = -f.bodyY / PX;
      m.root.rotation.z = -f.bodyRot * DEG;
      m.root.rotation.y = 0.18 + (live ? Math.sin(time * 0.6) * 0.04 : 0);
      m.body.scale.y = f.breathe;
      m.head.rotation.z = -f.headRot * DEG;
      m.head.rotation.y = f.lookX * 0.45;
      m.head.rotation.x = f.lookY * 0.22;
      m.head.position.y = 0.62 - cur.headY / PX;
      m.antenna.rotation.z = -(cur.antennaRot + (live ? Math.sin(time * 2.6) * 2 : 0)) * DEG;
      const forward = pose.extras.includes("keyboard") || pose.extras.includes("tablet") ? -0.75 : 0;
      m.armL.shoulder.rotation.set(forward, 0, -cur.lShoulder * DEG);
      m.armL.elbow.rotation.z = -f.lElbow * DEG;
      m.armR.shoulder.rotation.set(forward, 0, -cur.rShoulder * DEG);
      m.armR.elbow.rotation.z = -f.rElbow * DEG;
      for (const [arm, shape] of [[m.armL, pose.lHand], [m.armR, pose.rHand]] as const) {
        for (const [k, v] of Object.entries(arm.hand.variants)) v.visible = k === shape;
      }
      m.feet.forEach((foot, i) => {
        foot.rotation.x = cur.feetTuck * 0.7;
        foot.rotation.z = cur.feetTuck * (i ? -0.25 : 0.25);
      });
      const shadowScale = Math.max(0.45, 1 - Math.max(0, -f.bodyY) / 40 - cur.feetTuck * 0.25);
      m.shadow.scale.setScalar(shadowScale);
      m.shadow.position.y = -1.32 + f.bodyY / PX; // stays on the ground while Orbit hovers

      // ---- Glow / colour from the real state ----
      const glow = Math.max(0, Math.min(1, cur.glow + (p.state === "listening" ? (p.audioLevel ?? 0) * 0.4 : 0) + (live ? Math.sin(time * 3) * 0.06 : 0)));
      coreColor.set(pose.core);
      for (const mat of m.coreMaterials) {
        mat.color.copy(coreColor);
        mat.emissive.copy(coreColor);
        mat.emissiveIntensity = 0.8 + glow * 2.2;
      }
      for (const s of m.coreSprites) {
        (s.material as THREE.SpriteMaterial).color.copy(coreColor);
        (s.material as THREE.SpriteMaterial).opacity = 0.25 + glow * 0.6;
      }
      m.soles.forEach((s) => {
        s.scale.setScalar(0.7 + cur.thruster * 0.6);
        (s.material as THREE.SpriteMaterial).opacity = 0.35 + cur.thruster * 0.6;
      });

      // ---- Cape flutter ----
      const flutter = cur.capeFlutter * (live ? 0.6 + 0.4 * Math.sin(time * (2 + cur.capeFlutter * 6)) : 1);
      const pos = m.cape.geometry.attributes.position as THREE.BufferAttribute;
      const base = m.capeBase;
      for (let i = 0; i < pos.count; i++) {
        const by = base[i * 3 + 1];
        const v = (0.725 - by) / 1.45;
        const wave = live ? Math.sin(time * 4 + base[i * 3] * 3 + v * 4) * 0.08 * v : 0;
        pos.setXYZ(i, base[i * 3] + flutter * 0.35 * v * v, by, base[i * 3 + 2] - flutter * 0.45 * v + wave * (0.5 + flutter));
      }
      pos.needsUpdate = true;

      // ---- Extras ----
      const ex = m.extras;
      setVisible(ex.keyboard, pose.extras.includes("keyboard"));
      setVisible(ex.tablet, pose.extras.includes("tablet"));
      setVisible(ex.zz, pose.extras.includes("zz"));
      ex.trail.forEach((t) => setVisible(t, pose.extras.includes("trail")));
      ex.rings.forEach((r, i) => {
        r.visible = pose.extras.includes("rings");
        r.rotation.z = (i ? -1 : 1) * time * 0.8;
        r.rotation.x = Math.PI / 2 + (i ? 0.35 : -0.25);
      });
      ex.dots.forEach((d, i) => {
        d.visible = pose.extras.includes("thinking_dots");
        d.scale.setScalar(live ? 0.7 + 0.5 * Math.max(0, Math.sin(time * 3 - i)) : 1);
      });
      ex.sparkles.forEach((s, i) => {
        s.visible = pose.extras.includes("sparkles");
        s.scale.setScalar(live ? 0.3 + 0.2 * Math.sin(time * 5 + i * 1.7) : 0.45);
      });
      const tip = new THREE.Vector3();
      m.armR.hand.tip.getWorldPosition(tip);
      m.root.worldToLocal(tip);
      ex.ripples.forEach((r, i) => {
        r.visible = pose.extras.includes("ripple") && live;
        const ph = (time * 1.6 + i * 0.5) % 1;
        r.position.copy(tip);
        r.scale.setScalar(1 + ph * 3);
        (r.material as THREE.MeshBasicMaterial).opacity = 1 - ph;
      });
      ex.stopGlow.visible = pose.extras.includes("stop_glow");
      ex.stopGlow.position.copy(tip);

      // ---- Face (redrawn only when it visibly changes) ----
      const face: FaceState = {
        eyes: pose.eyes,
        mouth: pose.mouth,
        lookX: f.lookX,
        lookY: f.lookY,
        lid: Math.max(cur.lid, blinker.closed(now, live && ["open", "wide", "focused", "sad"].includes(pose.eyes)) ? 1 : 0),
        mouthOpen: pose.mouth === "talk" ? lip.sample(time, true) : cur.mouthOpen,
        blush: true, // the design sheet shows rosy cheeks in every expression
        eyeScale: cur.eyeScale,
      };
      const k = faceKey(face);
      if (k !== lastKey) {
        drawFace(m.face.ctx, face);
        m.face.texture.needsUpdate = true;
        lastKey = k;
      }

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("webglcontextlost", onLost);
      lip.dispose();
      model.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
    };
    // Rebuild only when the canvas size changes; everything else is read live from propsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  if (failed) return <OrbitRig {...props} />;
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      role="img"
      aria-label={label ?? `Orbit (${String(state).replace(/_/g, " ")})`}
      style={{ width, height, display: "block", overflow: "visible" }}
      data-reduced-motion={reducedMotion ? "1" : undefined}
    />
  );
};

export default Orbit3D;
