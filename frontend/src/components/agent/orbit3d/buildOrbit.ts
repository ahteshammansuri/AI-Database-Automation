/**
 * Procedural 3D Orbit built from the design sheet: glossy clearcoat white shell, big wide
 * head with a curved glass face screen (live canvas face), headphone ear pods, antenna orb,
 * purple fabric scarf and fluttering cape, glowing chest badge, stubby arms with mitten
 * hands (thumb, pointing finger, open fingers) and hover feet with glowing soles.
 *
 * Every part is a named node so the renderer can animate joints from real runtime state.
 */
import * as THREE from "three";
import type { HandShape } from "../orbit/poses";
import { FACE_H, FACE_W } from "./faceTexture";

export interface HandRig {
  group: THREE.Group;
  variants: Record<HandShape, THREE.Object3D>;
  tip: THREE.Object3D; // fingertip / palm point for ripples
}

export interface ArmRig {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  hand: HandRig;
}

export interface OrbitModel {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  antenna: THREE.Group;
  armL: ArmRig;
  armR: ArmRig;
  feet: THREE.Group[];
  soles: THREE.Sprite[];
  cape: THREE.Mesh;
  capeBase: Float32Array;
  face: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture };
  coreMaterials: THREE.MeshStandardMaterial[];
  coreSprites: THREE.Sprite[];
  shadow: THREE.Mesh;
  extras: {
    keyboard: THREE.Object3D; tablet: THREE.Object3D; ripples: THREE.Mesh[]; dots: THREE.Mesh[];
    sparkles: THREE.Sprite[]; zz: THREE.Sprite; rings: THREE.Mesh[]; trail: THREE.Mesh[]; stopGlow: THREE.Sprite;
  };
  dispose(): void;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.65)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function starTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.translate(64, 64);
  g.fillStyle = "#ffffff";
  g.shadowColor = "rgba(160,170,255,0.9)";
  g.shadowBlur = 18;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? 54 : 12;
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  g.font = "bold 84px ui-sans-serif, system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildOrbit(): OrbitModel {
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  // ---- Materials ---------------------------------------------------------------------------
  const shell = track(new THREE.MeshPhysicalMaterial({
    color: 0xf6f8fe, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1,
    sheen: 0.25, sheenColor: new THREE.Color(0xc7d2fe), sheenRoughness: 0.5,
  }));
  const limb = track(new THREE.MeshPhysicalMaterial({ color: 0xf1f4fc, roughness: 0.34, clearcoat: 0.9, clearcoatRoughness: 0.15 }));
  const lavender = track(new THREE.MeshPhysicalMaterial({ color: 0xe3e6ff, roughness: 0.35, clearcoat: 1 }));
  const lilacRing = track(new THREE.MeshStandardMaterial({ color: 0xb7aeff, emissive: 0x8b7cf6, emissiveIntensity: 0.35, roughness: 0.4 }));
  const fabric = track(new THREE.MeshPhysicalMaterial({
    color: 0x5f4fe3, roughness: 0.6, sheen: 1, sheenColor: new THREE.Color(0xb7aeff), sheenRoughness: 0.35, side: THREE.DoubleSide,
  }));
  const badgeMat = track(new THREE.MeshPhysicalMaterial({ color: 0x5b4be0, roughness: 0.3, clearcoat: 1, metalness: 0, envMapIntensity: 0.6 }));
  const stem = track(new THREE.MeshPhysicalMaterial({ color: 0xd9dfef, roughness: 0.3, clearcoat: 1 }));
  const core = () => track(new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 2.2, roughness: 0.3 }));
  const coreMaterials: THREE.MeshStandardMaterial[] = [];
  const glowTex = track(glowTexture());
  const coreSprites: THREE.Sprite[] = [];
  const sprite = (color: number, scale: number, opacity = 0.9) => {
    const m = track(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
    const s = new THREE.Sprite(m);
    s.scale.setScalar(scale);
    return s;
  };
  const geo = <T extends THREE.BufferGeometry>(g: T) => track(g);

  const root = new THREE.Group();

  // ---- Body: small glossy bean -----------------------------------------------------------------
  const body = new THREE.Group();
  root.add(body);
  const profile = [
    [0, -0.62], [0.36, -0.6], [0.58, -0.47], [0.7, -0.22], [0.73, 0.04], [0.68, 0.3], [0.54, 0.5], [0.32, 0.62], [0, 0.65],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.Mesh(geo(new THREE.LatheGeometry(profile, 48)), shell);
  torso.scale.set(1, 1, 0.9);
  body.add(torso);

  // Chest badge with glowing chevron emblem
  const badge = new THREE.Group();
  badge.position.set(0, 0.06, 0.63);
  badge.rotation.x = -0.12;
  body.add(badge);
  const disc = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.21, 0.21, 0.06, 48)), badgeMat);
  disc.rotation.x = Math.PI / 2;
  badge.add(disc);
  const badgeRing = new THREE.Mesh(geo(new THREE.TorusGeometry(0.21, 0.022, 12, 48)), lilacRing);
  badgeRing.position.z = 0.03;
  badge.add(badgeRing);
  const tri = new THREE.Shape();
  tri.moveTo(-0.11, 0.07);
  tri.lineTo(0.11, 0.07);
  tri.lineTo(0, -0.1);
  tri.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-0.055, 0.04);
  hole.lineTo(0.055, 0.04);
  hole.lineTo(0, -0.045);
  hole.closePath();
  tri.holes.push(hole);
  const emblemMat = core();
  coreMaterials.push(emblemMat);
  const emblem = new THREE.Mesh(geo(new THREE.ShapeGeometry(tri)), emblemMat);
  emblem.position.z = 0.035;
  badge.add(emblem);
  const badgeGlow = sprite(0x22d3ee, 0.38, 0.22);
  badgeGlow.position.z = 0.06;
  badge.add(badgeGlow);
  coreSprites.push(badgeGlow);

  // ---- Scarf collar + cape -------------------------------------------------------------------
  const scarf = new THREE.Mesh(geo(new THREE.TorusGeometry(0.56, 0.15, 24, 64)), fabric);
  scarf.rotation.x = Math.PI / 2;
  scarf.scale.set(1.05, 0.92, 1.25);
  scarf.position.y = 0.6;
  root.add(scarf);

  const capeGeo = geo(new THREE.PlaneGeometry(1.5, 1.45, 14, 14));
  const pos = capeGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const v = (0.725 - y) / 1.45; // 0 at top, 1 at bottom
    pos.setZ(i, -0.18 * Math.cos(x * 1.9) - 0.15 * v);
    pos.setX(i, x * (1 + 0.35 * v) + 0.32 * v * v); // widen and flow to one side
  }
  capeGeo.computeVertexNormals();
  const cape = new THREE.Mesh(capeGeo, fabric);
  cape.position.set(0.05, -0.08, -0.5);
  root.add(cape);
  const capeBase = Float32Array.from(pos.array as Float32Array);

  // ---- Head (pivot at the neck) ------------------------------------------------------------------
  const head = new THREE.Group();
  head.position.y = 0.62;
  root.add(head);
  const skull = new THREE.Mesh(geo(new THREE.SphereGeometry(1, 64, 48)), shell);
  skull.scale.set(1.14, 0.98, 1.0);
  skull.position.y = 0.82;
  head.add(skull);

  // Curved face screen with a live canvas face (transparent outside the rounded screen).
  const canvas = document.createElement("canvas");
  canvas.width = FACE_W;
  canvas.height = FACE_H;
  const ctx = canvas.getContext("2d")!;
  const faceTex = track(new THREE.CanvasTexture(canvas));
  faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.anisotropy = 4;
  // Deep black glass: only the painted features glow; reflections are subtle.
  const faceMat = track(new THREE.MeshPhysicalMaterial({
    map: faceTex, emissiveMap: faceTex, emissive: 0xffffff, emissiveIntensity: 1.35, transparent: true,
    color: 0x111111, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04, metalness: 0, envMapIntensity: 0.35,
    polygonOffset: true, polygonOffsetFactor: -2,
  }));
  const faceGeo = geo(new THREE.SphereGeometry(1.012, 64, 32, Math.PI / 2 - 0.98, 1.96, Math.PI / 2 - 0.66, 1.2));
  const faceMesh = new THREE.Mesh(faceGeo, faceMat);
  faceMesh.scale.copy(skull.scale);
  faceMesh.position.copy(skull.position);
  head.add(faceMesh);

  // Headphone ear pods
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(side * 1.12, 0.84, 0);
    ear.rotation.z = Math.PI / 2;
    head.add(ear);
    const cup = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.33, 0.33, 0.26, 48)), shell);
    ear.add(cup);
    const ring = new THREE.Mesh(geo(new THREE.TorusGeometry(0.22, 0.055, 14, 40)), lilacRing);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -side * 0.14;
    ear.add(ring);
    const innerMat = core();
    coreMaterials.push(innerMat);
    const inner = new THREE.Mesh(geo(new THREE.CircleGeometry(0.15, 32)), innerMat);
    inner.rotation.x = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    inner.position.y = -side * 0.135;
    ear.add(inner);
    const pad = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 32)), lavender);
    pad.position.y = -side * 0.12;
    ear.add(pad);
  }

  // Antenna with glowing orb
  const antenna = new THREE.Group();
  antenna.position.set(0, 1.74, 0);
  head.add(antenna);
  const rod = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.035, 0.05, 0.4, 16)), stem);
  rod.position.y = 0.2;
  antenna.add(rod);
  const orbMat = core();
  coreMaterials.push(orbMat);
  const orb = new THREE.Mesh(geo(new THREE.SphereGeometry(0.13, 32, 24)), orbMat);
  orb.position.y = 0.46;
  antenna.add(orb);
  const orbGlow = sprite(0x22d3ee, 0.7, 0.55);
  orbGlow.position.y = 0.46;
  antenna.add(orbGlow);
  coreSprites.push(orbGlow);

  // ---- Arms --------------------------------------------------------------------------------------
  const makeHand = (side: number): HandRig => {
    const group = new THREE.Group();
    const palm = (r: number) => new THREE.Mesh(geo(new THREE.SphereGeometry(r, 32, 24)), limb);
    const thumb = () => {
      const t = new THREE.Mesh(geo(new THREE.SphereGeometry(0.085, 20, 16)), limb);
      t.position.set(side * 0.15, 0.05, 0.07);
      return t;
    };
    const mitten = new THREE.Group();
    const mp = palm(0.21);
    mp.scale.set(1, 0.95, 0.88);
    mitten.add(mp, thumb());
    const point = new THREE.Group();
    point.add(palm(0.18), thumb());
    const finger = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.055, 0.17, 6, 12)), limb);
    finger.position.y = -0.27;
    point.add(finger);
    const open = new THREE.Group();
    open.add(palm(0.19), thumb());
    [-0.5, 0, 0.5].forEach((a) => {
      const f = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.05, 0.11, 6, 12)), limb);
      f.position.set(Math.sin(a) * 0.2, -Math.cos(a) * 0.22, 0);
      f.rotation.z = -a;
      open.add(f);
    });
    const fist = new THREE.Group();
    fist.add(palm(0.18));
    group.add(mitten, point, open, fist);
    const tip = new THREE.Object3D();
    tip.position.y = -0.4;
    group.add(tip);
    return { group, variants: { mitten, point, open, fist }, tip };
  };

  const makeArm = (side: number): ArmRig => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.66, 0.36, 0.05);
    root.add(shoulder);
    const upper = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.165, 0.2, 8, 20)), limb);
    upper.position.y = -0.18;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.36;
    shoulder.add(elbow);
    const fore = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.15, 0.16, 8, 20)), limb);
    fore.position.y = -0.16;
    elbow.add(fore);
    const hand = makeHand(side);
    hand.group.position.y = -0.4;
    elbow.add(hand.group);
    return { shoulder, elbow, hand };
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // ---- Hover feet with glowing soles ---------------------------------------------------------------
  const feet: THREE.Group[] = [];
  const soles: THREE.Sprite[] = [];
  for (const side of [-1, 1]) {
    const foot = new THREE.Group();
    foot.position.set(side * 0.3, -0.62, 0.02);
    root.add(foot);
    const stub = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.21, 0.12, 8, 20)), limb);
    stub.position.y = -0.17;
    stub.scale.set(1, 1, 1.1);
    foot.add(stub);
    const soleMat = core();
    coreMaterials.push(soleMat);
    const sole = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.17, 0.15, 0.04, 32)), soleMat);
    sole.position.y = -0.4;
    foot.add(sole);
    const glow = sprite(0x38bdf8, 0.9, 0.85);
    glow.position.y = -0.5;
    foot.add(glow);
    soles.push(glow);
    feet.push(foot);
  }

  // ---- Contact shadow ------------------------------------------------------------------------------
  const shadowMat = track(new THREE.MeshBasicMaterial({ map: glowTex, color: 0x1e293b, transparent: true, opacity: 0.32, depthWrite: false }));
  const shadow = new THREE.Mesh(geo(new THREE.PlaneGeometry(2.2, 2.2)), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.32;
  root.add(shadow);

  // ---- Extras (shown only for the poses that use them) ----------------------------------------------
  const holo = track(new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.35, depthWrite: false }));
  const keyboard = new THREE.Mesh(geo(new THREE.BoxGeometry(1.25, 0.04, 0.38)), holo);
  keyboard.position.set(0, -0.58, 0.8);
  root.add(keyboard);
  const tablet = new THREE.Group();
  const slab = new THREE.Mesh(geo(new THREE.BoxGeometry(0.9, 0.56, 0.04)), track(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4 })));
  const tabScreen = new THREE.Mesh(geo(new THREE.PlaneGeometry(0.8, 0.46)), holo);
  tabScreen.position.z = 0.025;
  tablet.add(slab, tabScreen);
  tablet.position.set(0, -0.3, 0.85);
  tablet.rotation.x = -0.5;
  root.add(tablet);
  const ripples = [0, 1].map(() => {
    const m = new THREE.Mesh(geo(new THREE.RingGeometry(0.12, 0.15, 40)), track(new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
    root.add(m);
    return m;
  });
  const dotMat = track(new THREE.MeshStandardMaterial({ color: 0xa29bfe, emissive: 0x8b7cf6, emissiveIntensity: 1 }));
  const dots = [0.07, 0.09, 0.115].map((r, i) => {
    const d = new THREE.Mesh(geo(new THREE.SphereGeometry(r, 16, 12)), dotMat);
    d.position.set(1.15 + i * 0.25, 2.55 + i * 0.25, 0.3);
    root.add(d);
    return d;
  });
  const starTex = track(starTexture());
  const sparkles = [[-1.6, 2.4], [1.6, 2.0], [-1.7, 0.4], [1.7, 0.2]].map(([x, y]) => {
    const s = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: starTex, color: 0x9aa6ff, transparent: true, depthWrite: false })));
    s.position.set(x, y, 0.4);
    root.add(s);
    return s;
  });
  const zzTex = track(textTexture("z", "#a29bfe"));
  const zz = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: zzTex, transparent: true, depthWrite: false })));
  zz.scale.setScalar(0.55);
  zz.position.set(1.3, 2.6, 0.2);
  root.add(zz);
  const ringMat = track(new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.7, depthWrite: false }));
  const rings = [1.25, 1.12].map((r) => {
    const m = new THREE.Mesh(geo(new THREE.TorusGeometry(r, 0.018, 8, 80)), ringMat);
    m.rotation.x = Math.PI / 2;
    root.add(m);
    return m;
  });
  const trailMat = track(new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.6, depthWrite: false }));
  const trail = [0.4, 0, -0.4].map((y, i) => {
    const m = new THREE.Mesh(geo(new THREE.BoxGeometry(0.7 + i * 0.25, 0.05, 0.05)), trailMat);
    m.position.set(-1.25 - i * 0.12, y, -0.2);
    root.add(m);
    return m;
  });
  const stopGlow = sprite(0xfbbf24, 0.9, 0.7);
  root.add(stopGlow);

  return {
    root, body, head, antenna, armL, armR, feet, soles, cape, capeBase,
    face: { canvas, ctx, texture: faceTex },
    coreMaterials, coreSprites, shadow,
    extras: { keyboard, tablet, ripples, dots, sparkles, zz, rings, trail, stopGlow },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
