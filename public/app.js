import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFX } from './fx.js';
import { JUNCTIONS, AUDIENCES, TONES, lateness, makeExcuse, randomReason, replyFor } from './excuses.js';
import { initTurnstile, getToken } from './turnstile.js';
import { initMe } from './me.js';

const $ = (id) => document.getElementById(id);
const isMobile = () => innerWidth <= 820;
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const saved = store.get('sb-state') || {};
const istHour = () => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date()));
const autoTod = () => { const h = istHour(); return h >= 6 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night'; };

const state = {
  junction: JUNCTIONS.some((j) => j.id === saved.junction) ? saved.junction : 'silk',
  minutes: saved.minutes || 35,
  audience: AUDIENCES.some((a) => a.id === saved.audience) ? saved.audience : 'manager',
  tone: TONES.some((t) => t.id === saved.tone) ? saved.tone : 'corporate',
  tod: autoTod(), rain: false, excuse: '', reason: '',
};

// ================================================================ sound (synthesised, off by default)
const sfx = {
  on: false, ctx: null, rumble: null,
  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  env(a, t, peak, dur, rel = 0.08) {
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
    g.gain.setValueAtTime(peak, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
    return g;
  },
  honk(pan = 0) {
    if (!this.on) return;
    const a = this.ensure(), t = a.currentTime, dur = 0.12 + Math.random() * 0.32;
    const g = this.env(a, t, 0.035, dur), f = a.createBiquadFilter(), p = a.createStereoPanner();
    f.type = 'lowpass'; f.frequency.value = 2000; p.pan.value = Math.max(-1, Math.min(1, pan));
    const base = 290 + Math.random() * 230;
    for (const m of [1, 1.26]) { const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.value = base * m; o.connect(f); o.start(t); o.stop(t + dur + 0.12); }
    f.connect(g).connect(p).connect(a.destination);
  },
  moo() {
    if (!this.on) return;
    const a = this.ensure(), t = a.currentTime;
    const o = a.createOscillator(), lfo = a.createOscillator(), lg = a.createGain(), f = a.createBiquadFilter(), g = this.env(a, t, 0.08, 0.8, 0.3);
    o.type = 'sawtooth'; o.frequency.setValueAtTime(150, t); o.frequency.linearRampToValueAtTime(115, t + 1);
    lfo.frequency.value = 5; lg.gain.value = 4; lfo.connect(lg).connect(o.frequency);
    f.type = 'lowpass'; f.frequency.value = 700;
    o.connect(f).connect(g).connect(a.destination);
    o.start(t); lfo.start(t); o.stop(t + 1.2); lfo.stop(t + 1.2);
  },
  pop(up = true) {
    if (!this.on) return;
    const a = this.ensure(), t = a.currentTime, o = a.createOscillator(), g = this.env(a, t, 0.05, 0.04, 0.06);
    o.type = 'sine'; o.frequency.setValueAtTime(up ? 620 : 900, t); o.frequency.exponentialRampToValueAtTime(up ? 980 : 560, t + 0.09);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.15);
  },
  thunk() {
    if (!this.on) return;
    const a = this.ensure(), t = a.currentTime;
    const o = a.createOscillator(), g = this.env(a, t, 0.25, 0.02, 0.3);
    o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.3);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.4);
    const buf = a.createBuffer(1, a.sampleRate * 0.15, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
    const n = a.createBufferSource(), f = a.createBiquadFilter(), ng = a.createGain();
    n.buffer = buf; f.type = 'lowpass'; f.frequency.value = 900; ng.gain.value = 0.35;
    n.connect(f).connect(ng).connect(a.destination); n.start(t);
  },
  startRumble() {
    const a = this.ensure();
    if (this.rumble) return;
    const buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; src.loop = true; f.type = 'lowpass'; f.frequency.value = 380; g.gain.value = 0;
    src.connect(f).connect(g).connect(a.destination); src.start();
    this.rumble = g;
  },
  setRumble(v) { if (this.rumble) this.rumble.gain.setTargetAtTime(this.on ? v : 0, this.ctx.currentTime, 0.4); },
};

// ================================================================ renderer, camera, post
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#e9cfc0', 110, 190);
const camera = new THREE.PerspectiveCamera(24, 1, 1, 600);
const HOME = new THREE.Vector3(44, 46, 52);
camera.position.set(120, 140, 150);
const controls = new OrbitControls(camera, canvas);
Object.assign(controls, { enableDamping: true, enablePan: false, minDistance: 45, maxDistance: 140, minPolarAngle: 0.5, maxPolarAngle: 1.15, enabled: false });
const fx = createFX(renderer, scene, camera, { bloom: 0.4, bloomThreshold: 0.92, bloomRadius: 0.35, tilt: 3.4, band: 0.1, vignette: 0.22, grain: 0.018, envIntensity: 0.5 });
renderer.toneMapping = THREE.NeutralToneMapping;

// sky dome
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, bot: { value: new THREE.Color() } },
  vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 top, hor, bot; varying vec3 vP;
    void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(hor, top, pow(clamp(y * 1.4, 0.0, 1.0), 0.7)) : mix(hor, bot, pow(clamp(-y * 3.0, 0.0, 1.0), 0.5)); gl_FragColor = vec4(c, 1.0); }`,
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat));

const hemi = new THREE.HemisphereLight('#fff6e6', '#c9b88f', 1.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffe2b0', 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 5, far: 180 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// ================================================================ time-of-day presets (everything eases between them)
const PRESETS = {
  day: { top: '#7fa6d8', hor: '#efcfbd', bot: '#d7c9b4', fog: '#e9cfc0', sun: '#fff0d6', sunI: 2.1, sunPos: [30, 55, 18], hs: '#fff1e6', hg: '#b8a8cc', hI: 0.8, env: 0.4, lamps: 0, lights: 0.9, win: 0, exposure: 0.95, bloom: 0.2 },
  dusk: { top: '#8e86d6', hor: '#ffb8a8', bot: '#9a86b4', fog: '#f4bcb0', sun: '#ffb48a', sunI: 1.5, sunPos: [-50, 14, 22], hs: '#ffd6c8', hg: '#7a6a9a', hI: 0.75, env: 0.32, lamps: 0.85, lights: 1.6, win: 0.8, exposure: 1.0, bloom: 0.4 },
  night: { top: '#1c1f4a', hor: '#4a4080', bot: '#2d2a4e', fog: '#3f3b74', sun: '#b8c4ff', sunI: 0.55, sunPos: [-25, 45, -30], hs: '#7070c0', hg: '#2a2548', hI: 0.55, env: 0.12, lamps: 1, lights: 2.0, win: 1, exposure: 0.95, bloom: 0.5 },
};
const RAIN_TINT = new THREE.Color('#9a98b4');
const cur = {}, tgt = {};
function makeTarget() {
  const p = PRESETS[state.tod], r = state.rain ? 1 : 0;
  for (const k of ['top', 'hor', 'bot', 'fog', 'sun', 'hs', 'hg']) {
    tgt[k] = new THREE.Color(p[k]);
    if (r && k !== 'sun') tgt[k].lerp(RAIN_TINT.clone().multiplyScalar(state.tod === 'day' ? 1 : 0.35), k === 'hg' ? 0.2 : 0.5);
  }
  Object.assign(tgt, { sunI: p.sunI * (r ? 0.35 : 1), hI: p.hI * (r ? 0.8 : 1), env: p.env + r * 0.12, lamps: Math.max(p.lamps, r * 0.6), lights: Math.max(p.lights, r * 1.6), win: Math.max(p.win, r * 0.5), exposure: p.exposure, bloom: p.bloom + r * 0.1, wet: r, sunPos: new THREE.Vector3(...p.sunPos) });
  document.body.classList.toggle('night', state.tod === 'night');
}
makeTarget();
for (const [k, v] of Object.entries(tgt)) cur[k] = v?.clone ? v.clone() : v;

// ================================================================ world
const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
const add = (geo, m, x, y, z, { cast = true, recv = true } = {}) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = recv; scene.add(o); return o; };
const rnd = (() => { let s = 11; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

const ground = add(new THREE.PlaneGeometry(160, 160), mat('#cfd3b8'), 0, 0, 0, { cast: false });
ground.rotation.x = -Math.PI / 2;
const roadMat = mat('#6e6a82', { roughness: 0.9 });
add(new THREE.BoxGeometry(130, 0.08, 7.2), roadMat, 0, 0.04, 0, { cast: false });
add(new THREE.BoxGeometry(7.2, 0.08, 130), roadMat, 0, 0.045, 0, { cast: false });
const walk = mat('#ddd0c6');
for (const s of [-1, 1]) for (const [a, b] of [[-65, -4.4], [4.4, 65]]) {
  const len = b - a, mid = (a + b) / 2;
  add(new THREE.BoxGeometry(len, 0.22, 1.3), walk, mid, 0.11, s * 4.25);
  add(new THREE.BoxGeometry(1.3, 0.23, len), walk, s * 4.25, 0.115, mid);
}
{
  const paint = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 });
  const dash = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.02, 0.12), paint, 500);
  const m4 = new THREE.Matrix4(), sc = new THREE.Matrix4();
  let n = 0;
  for (let p = -64; p <= 64; p += 2.4) {
    if (Math.abs(p) < 5.5) continue;
    for (const off of [-1.75, 1.75]) {
      dash.setMatrixAt(n++, m4.makeTranslation(p, 0.1, off));
      dash.setMatrixAt(n++, m4.makeRotationY(Math.PI / 2).setPosition(off, 0.1, p));
    }
  }
  for (let k = -3; k <= 3.01; k += 0.85) for (const s of [-1, 1]) {
    dash.setMatrixAt(n++, sc.makeScale(0.45, 1, 4.2).setPosition(s * 4.75, 0.1, k));
    dash.setMatrixAt(n++, m4.makeRotationY(Math.PI / 2).multiply(sc.makeScale(0.45, 1, 4.2)).setPosition(k, 0.1, s * 4.75));
  }
  dash.count = n;
  dash.receiveShadow = true;
  scene.add(dash);
  const yellow = new THREE.MeshStandardMaterial({ color: '#ffd98a', roughness: 0.6 });
  for (const [a, b] of [[-65, -5.5], [5.5, 65]]) {
    add(new THREE.BoxGeometry(b - a, 0.02, 0.14), yellow, (a + b) / 2, 0.1, 0, { cast: false });
    add(new THREE.BoxGeometry(0.14, 0.02, b - a), yellow, 0, 0.1, (a + b) / 2, { cast: false });
  }
}

// buildings, rooftop water tanks, and windows that light up at night
const winLitMat = new THREE.MeshBasicMaterial({ color: '#7c8aa8', toneMapped: false });
{
  const PAL = ['#f0bfa6', '#ecd293', '#b5d6be', '#efc7d2', '#cbbde9', '#b9d6e3', '#f3d2a3', '#d3e0a8', '#e9b5c8'];
  const lots = [];
  for (let x = 9; x < 58; x += 5.6) for (let z = 9; z < 58; z += 5.6) for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    if (sz === -1 && Math.abs(z - 8.5) < 5) continue;
    if (sx === 1 && sz === 1 && x < 20 && z < 20) continue; // the park
    if (rnd() < 0.2) continue;
    const it = sx === 1 && sz === -1;
    const w = 3.3 + rnd() * 1.2, d = 3.3 + rnd() * 1.2, h = it ? 6 + rnd() * 9 : 1.8 + rnd() * 5.5;
    lots.push({ x: sx * x, z: sz * z, w, d, h, it });
  }
  const blds = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 1, 0.04), mat('#ffffff', { roughness: 0.75 }), lots.length);
  const tanks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.8, 14), mat('#5d5878', { roughness: 0.5 }), lots.length);
  const wins = [], m4 = new THREE.Matrix4(), c = new THREE.Color();
  let t = 0;
  lots.forEach((b, i) => {
    blds.setMatrixAt(i, m4.makeScale(b.w, b.h, b.d).setPosition(b.x, b.h / 2, b.z));
    blds.setColorAt(i, c.set(b.it ? (rnd() < 0.5 ? '#9fb9e0' : '#b2a8e2') : PAL[Math.floor(rnd() * PAL.length)]));
    if (!b.it && rnd() < 0.6) tanks.setMatrixAt(t++, m4.makeTranslation(b.x + (rnd() - 0.5) * b.w * 0.4, b.h + 0.4, b.z + (rnd() - 0.5) * b.d * 0.4));
    const floors = Math.floor((b.h - 0.6) / 0.9);
    for (let f = 0; f < floors; f++) {
      const y = 0.75 + f * 0.9;
      wins.push({ lit: rnd() < 0.55, cool: b.it, m: new THREE.Matrix4().makeScale(0.05, 0.36, b.d * 0.72).setPosition(b.x + b.w / 2 + 0.02, y, b.z) });
      wins.push({ lit: rnd() < 0.55, cool: b.it, m: new THREE.Matrix4().makeScale(b.w * 0.72, 0.36, 0.05).setPosition(b.x, y, b.z + b.d / 2 + 0.02) });
    }
  });
  tanks.count = t;
  blds.castShadow = blds.receiveShadow = tanks.castShadow = true;
  scene.add(blds, tanks);
  const lit = wins.filter((w) => w.lit), dark = wins.filter((w) => !w.lit);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const L = new THREE.InstancedMesh(box, winLitMat, lit.length);
  lit.forEach((w, i) => { L.setMatrixAt(i, w.m); L.setColorAt(i, c.set(w.cool ? '#d8ecff' : rnd() < 0.2 ? '#ffe9c2' : '#ffc873')); });
  const D = new THREE.InstancedMesh(box, mat('#7c8aa8', { roughness: 0.15, metalness: 0.4 }), dark.length);
  dark.forEach((w, i) => D.setMatrixAt(i, w.m));
  scene.add(L, D);
}

// rain trees and gulmohars
{
  const spots = [];
  for (let p = -62; p <= 62; p += 4.4) {
    if (Math.abs(p) < 8) continue;
    spots.push([p, 5.9], [p, -5.9], [5.9, p], [-5.9, p]);
  }
  // the park's trees join the avenue
  for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.28 + 0.3, r = 4.6 + rnd() * 0.5; spots.push([14.5 + Math.cos(a) * r, 14.5 + Math.sin(a) * r]); }
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 1.4, 6), mat('#b89a82'), spots.length);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat('#ffffff', { flatShading: true, roughness: 0.9 }), spots.length);
  const petals = new THREE.InstancedMesh(new THREE.CircleGeometry(0.12, 6), mat('#ffffff', { roughness: 1 }), spots.length * 14);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  // rain trees, and Bengaluru's spring: pink tabebuia, purple jacaranda, coral gulmohar
  const BLOOM = ['#e98fb8', '#e07aa8', '#a98ad8', '#9a78d6', '#f08a74'];
  let pn = 0;
  spots.forEach(([x, z], i) => {
    const s = 1 + rnd() * 0.6;
    trunks.setMatrixAt(i, m4.makeTranslation(x, 0.7, z));
    q.setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd()));
    crowns.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 1.6 + s * 0.6, z), q, new THREE.Vector3(s * 1.35, s * 0.95, s * 1.35)));
    const r = rnd(), col = r < 0.3 ? BLOOM[Math.floor(rnd() * BLOOM.length)] : ['#7fb87c', '#96c47c', '#6fae84', '#8cc08c'][Math.floor(rnd() * 4)];
    crowns.setColorAt(i, c.set(col));
    if (r < 0.3) for (let k = 0; k < 14; k++) {
      const a = rnd() * 6.3, d = rnd() * 1.8 * s;
      petals.setMatrixAt(pn, m4.compose(new THREE.Vector3(x + Math.cos(a) * d, 0.24, z + Math.sin(a) * d), q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, rnd() * 6)), new THREE.Vector3(1, 1, 1)));
      petals.setColorAt(pn++, c.set(col));
    }
  });
  petals.count = pn;
  trunks.castShadow = crowns.castShadow = crowns.receiveShadow = true;
  petals.receiveShadow = true;
  scene.add(trunks, crowns, petals);
}

// Cubbon-ish park by the junction: lawn, a fountain, benches
const fountainWater = mat('#bfe3f5', { roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.9 });
const PARK = [14.5, 14.5];
{
  const [px, pz] = PARK;
  const lawn = add(new RoundedBoxGeometry(11.5, 0.3, 11.5, 2, 0.12), mat('#a9cf98', { roughness: 1 }), px, 0.15, pz, { cast: false });
  lawn.receiveShadow = true;
  add(new THREE.BoxGeometry(11.6, 0.32, 0.9), walk, px, 0.16, pz, { cast: false });
  add(new THREE.BoxGeometry(0.9, 0.32, 11.6), walk, px, 0.16, pz, { cast: false });
  add(new THREE.CylinderGeometry(1.5, 1.65, 0.45, 28), mat('#fffaf5'), px, 0.4, pz);
  add(new THREE.CylinderGeometry(1.3, 1.3, 0.1, 28), fountainWater, px, 0.6, pz, { cast: false });
  add(new THREE.CylinderGeometry(0.18, 0.26, 1.0, 12), mat('#fffaf5'), px, 0.95, pz);
  add(new THREE.CylinderGeometry(0.65, 0.35, 0.2, 20), mat('#fffaf5'), px, 1.5, pz);
  const spout = add(new THREE.SphereGeometry(0.26, 14, 10), fountainWater, px, 1.75, pz, { cast: false });
  spout.scale.y = 1.6;
  const benchM = mat('#ffc2d4'), legM = mat('#6d6a86');
  for (const [dx, dz, ry] of [[-2.6, 1.4, Math.PI / 2], [2.6, -1.4, -Math.PI / 2], [1.4, 2.6, 0], [-1.4, -2.6, Math.PI]]) {
    const b = new THREE.Group();
    const piece = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); b.add(o); };
    piece(new RoundedBoxGeometry(1.5, 0.12, 0.5, 1, 0.04), benchM, 0, 0.55, 0);
    piece(new RoundedBoxGeometry(1.5, 0.42, 0.1, 1, 0.04), benchM, 0, 0.83, -0.22);
    for (const lx of [-0.6, 0.6]) piece(new THREE.BoxGeometry(0.08, 0.5, 0.42), legM, lx, 0.3, 0);
    b.position.set(px + dx, 0.1, pz + dz); b.rotation.y = ry;
    b.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(b);
  }
}
// flower beds in the park and planters along the pavements
{
  const FL = ['#ff9fb8', '#ffe07a', '#ffffff', '#c9b8ff', '#ffb88a', '#ff8fa3'];
  const heads = [], boxes = [];
  const bed = (x, z, n, r) => { for (let i = 0; i < n; i++) { const a = rnd() * 6.3, d = Math.sqrt(rnd()) * r; heads.push([x + Math.cos(a) * d, 0.42 + rnd() * 0.12, z + Math.sin(a) * d]); } };
  for (const [x, z] of [[-27, 17], [-17, 17], [-27, 27], [-17, 27], [22, 13.5], [-13.5, 22], [-30.5, 22], [22, 30.5]]) bed(x, z, 26, 1.6);
  for (let p = 10; p <= 50; p += 8) for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const onX = p % 16 === 10;
    const x = onX ? sx * p : sx * 4.25, z = onX ? sz * 4.25 : sz * p;
    if (!onX && sz === -1 && Math.abs(z + 8.5) < 3) continue;
    boxes.push([x, z]);
    for (let i = 0; i < 7; i++) heads.push([x + (rnd() - 0.5) * (onX ? 1.1 : 0.5), 0.62 + rnd() * 0.1, z + (rnd() - 0.5) * (onX ? 0.5 : 1.1)]);
  }
  const hm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.16, 1), mat('#ffffff', { roughness: 0.7 }), heads.length);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  heads.forEach(([x, y, z], i) => { hm.setMatrixAt(i, m4.makeTranslation(x, y, z)); hm.setColorAt(i, c.set(FL[Math.floor(rnd() * FL.length)])); });
  const pm = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 1, 0.08), mat('#fffaf5'), boxes.length);
  const leaf = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat('#7fb87c'), boxes.length);
  boxes.forEach(([x, z], i) => {
    const onX = Math.abs(z) < 5;
    pm.setMatrixAt(i, m4.makeScale(onX ? 1.3 : 0.6, 0.35, onX ? 0.6 : 1.3).setPosition(x, 0.4, z));
    leaf.setMatrixAt(i, m4.makeScale(onX ? 1.2 : 0.5, 0.12, onX ? 0.5 : 1.2).setPosition(x, 0.6, z));
  });
  hm.castShadow = pm.castShadow = true;
  scene.add(hm, pm, leaf);
}
// a billboard (the easter egg)
const bbCanvas = document.createElement('canvas'); bbCanvas.width = 1024; bbCanvas.height = 440;
const bbTex = new THREE.CanvasTexture(bbCanvas); bbTex.colorSpace = THREE.SRGBColorSpace; bbTex.anisotropy = 4;
const billboard = new THREE.Group();
function drawBillboard(img) {
  const g = bbCanvas.getContext('2d'), W = 1024, H = 440;
  const gold = g.createLinearGradient(0, 0, W, H); gold.addColorStop(0, '#b8862a'); gold.addColorStop(0.25, '#fff0b0'); gold.addColorStop(0.5, '#e2b44a'); gold.addColorStop(0.75, '#fbe39a'); gold.addColorStop(1, '#a8761d');
  g.fillStyle = gold; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fffaf0'; g.fillRect(18, 18, W - 36, H - 36);
  g.fillStyle = '#f6f0ff'; g.fillRect(18, 18, 360, H - 36);
  if (img) { g.save(); g.beginPath(); g.arc(198, 220, 150, 0, 7); g.clip(); const sc = 320 / Math.min(img.width, img.height); g.drawImage(img, 198 - (img.width * sc) / 2, 70, img.width * sc, img.height * sc); g.restore(); }
  g.strokeStyle = '#e2b44a'; g.lineWidth = 10; g.beginPath(); g.arc(198, 220, 152, 0, 7); g.stroke();
  g.fillStyle = '#3d2a07'; g.textAlign = 'left';
  g.font = '800 27px "Space Grotesk"'; g.fillText('NOW SHOWING AT SILK BOARD', 400, 118);
  g.font = '700 76px \"Space Grotesk\"'; g.fillStyle = '#2f2a45'; g.fillText('HITESH', 400, 246);
  g.fillText('GUPTA', 400, 328);
  g.font = '700 26px "JetBrains Mono", monospace'; g.fillStyle = '#8f6a14'; g.fillText('✦', 400, 384);
  bbTex.needsUpdate = true;
}
{
  const img = new Image();
  const draw = () => document.fonts.load('700 64px \"Space Grotesk\"').catch(() => {}).then(() => drawBillboard(img.complete && img.naturalWidth ? img : null));
  img.onload = draw; img.src = './hitesh.jpg'; draw();
  const poleM = mat('#9a96b0', { metalness: 0.5, roughness: 0.35 });
  for (const x of [-2.2, 2.2]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 7, 10), poleM); p.position.set(x, 3.5, 0); p.castShadow = true; billboard.add(p); }
  const frame = new THREE.Mesh(new RoundedBoxGeometry(7.4, 3.4, 0.3, 2, 0.08), mat('#e8c25a', { metalness: 0.6, roughness: 0.3 }));
  frame.position.y = 8.4; frame.castShadow = true;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(7, 3), new THREE.MeshStandardMaterial({ map: bbTex, roughness: 0.55, emissive: '#ffffff', emissiveMap: bbTex, emissiveIntensity: 0.05 }));
  face.position.set(0, 8.4, 0.16);
  const lampM = new THREE.MeshBasicMaterial({ color: '#fff3c4', toneMapped: false });
  for (const x of [-2.4, 0, 2.4]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.35), lampM); l.position.set(x, 10.2, 0.45); billboard.add(l); }
  billboard.add(frame, face);
  billboard.position.set(16, 0, 6.5);
  billboard.scale.setScalar(0.72);
  billboard.rotation.y = 0.55;
  billboard.userData = { face, lampM };
  scene.add(billboard);
}
// street lamps + warm pools of light
const lampHeadMat = new THREE.MeshBasicMaterial({ color: '#ffe3a6', toneMapped: false });
const poolMat = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: '#ffc27a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
})();
{
  const spots = [];
  for (let p = -58; p <= 58; p += 9) {
    if (Math.abs(p) < 9) continue;
    spots.push({ x: p, z: 4.95, dx: 0, dz: -1 }, { x: p, z: -4.95, dx: 0, dz: 1 }, { x: 4.95, z: p, dx: -1, dz: 0 }, { x: -4.95, z: p, dx: 1, dz: 0 });
  }
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6), mat('#9a96b0', { metalness: 0.4, roughness: 0.4 }), spots.length);
  const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.07, 0.07), pole.material, spots.length);
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.1, 0.22), lampHeadMat, spots.length);
  const pool = new THREE.InstancedMesh(new THREE.CircleGeometry(2.6, 24), poolMat, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3();
  spots.forEach((s, i) => {
    pole.setMatrixAt(i, m4.makeTranslation(s.x, 1.7, s.z));
    q.setFromAxisAngle(up, s.dx ? 0 : Math.PI / 2);
    arm.setMatrixAt(i, m4.compose(v.set(s.x + s.dx * 0.5, 3.35, s.z + s.dz * 0.5), q, new THREE.Vector3(1, 1, 1)));
    head.setMatrixAt(i, m4.compose(v.set(s.x + s.dx * 0.95, 3.3, s.z + s.dz * 0.95), q, new THREE.Vector3(1, 1, 1)));
    pool.setMatrixAt(i, m4.makeRotationX(-Math.PI / 2).setPosition(s.x + s.dx * 1.4, 0.13, s.z + s.dz * 1.4));
  });
  pole.castShadow = true;
  scene.add(pole, arm, head, pool);
}

// namma metro, forever under construction
const craneJib = new THREE.Group();
let hanging;
{
  const concrete = mat('#ece6de', { roughness: 0.9 });
  for (let x = -56; x <= 56; x += 7) {
    if (Math.abs(x) < 5) continue;
    add(new THREE.CylinderGeometry(0.5, 0.55, 5.4, 14), concrete, x, 2.7, -8.5);
    add(new RoundedBoxGeometry(1.1, 0.7, 3.2, 1, 0.08), concrete, x, 5.6, -8.5);
  }
  add(new RoundedBoxGeometry(35, 0.6, 3.4, 1, 0.08), concrete, -31.5, 6.25, -8.5);
  const yellow = mat('#ffd36b', { metalness: 0.2, roughness: 0.5 });
  add(new THREE.BoxGeometry(0.5, 13, 0.5), yellow, 10, 6.5, -12);
  craneJib.position.set(10, 13, -12);
  const jib = new THREE.Mesh(new THREE.BoxGeometry(16, 0.35, 0.35), yellow); jib.position.x = -5; jib.castShadow = true;
  const counter = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.9), mat('#555')); counter.position.x = 2.6;
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 5, 4), mat('#333')); cable.position.set(-10, -2.5, 0);
  hanging = new THREE.Mesh(new RoundedBoxGeometry(6, 0.5, 3, 1, 0.06), concrete); hanging.position.set(-10, -5.2, 0); hanging.castShadow = true;
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff3b2b', toneMapped: false }));
  beacon.position.set(-13, 0.3, 0);
  craneJib.add(jib, counter, cable, hanging, beacon);
  craneJib.userData.beacon = beacon;
  scene.add(craneJib);
  const sc = document.createElement('canvas'); sc.width = 512; sc.height = 160;
  const g = sc.getContext('2d');
  g.fillStyle = '#9d7fd6'; g.fillRect(0, 0, 512, 160);
  g.fillStyle = '#fff'; g.font = '900 44px Arial'; g.textAlign = 'center';
  g.fillText('NAMMA METRO', 256, 66); g.font = '700 34px Arial'; g.fillText('COMING 2027*', 256, 112);
  g.font = '500 16px Arial'; g.fillText('*terms, conditions and monsoons apply', 256, 145);
  const tex = new THREE.CanvasTexture(sc); tex.colorSpace = THREE.SRGBColorSpace;
  const board = add(new THREE.PlaneGeometry(6, 1.9), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), -14, 3.6, -7.2, { cast: false });
  board.rotation.y = 0.35;
}

// the big green junction sign
const signCanvas = document.createElement('canvas'); signCanvas.width = 768; signCanvas.height = 300;
const signTex = new THREE.CanvasTexture(signCanvas);
signTex.colorSpace = THREE.SRGBColorSpace;
signTex.anisotropy = 4;
{
  const poleM = mat('#8a8f96', { metalness: 0.6, roughness: 0.35 });
  add(new THREE.CylinderGeometry(0.12, 0.12, 6, 10), poleM, 6.5, 3, 7.4);
  add(new THREE.CylinderGeometry(0.12, 0.12, 6, 10), poleM, 12.5, 3, 7.4);
  const s = add(new THREE.PlaneGeometry(7, 2.73), new THREE.MeshStandardMaterial({ map: signTex, side: THREE.DoubleSide, roughness: 0.5, emissive: '#ffffff', emissiveMap: signTex, emissiveIntensity: 0 }), 9.5, 5.3, 7.5);
  s.rotation.y = 0.25;
  signTex.userData.mesh = s;
}
function drawSign(j) {
  const g = signCanvas.getContext('2d');
  g.fillStyle = '#3f9e72'; g.fillRect(0, 0, 768, 300);
  g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(14, 14, 740, 272);
  g.fillStyle = '#fff'; g.textAlign = 'center';
  let size = 88;
  g.font = `900 ${size}px Arial`;
  while (g.measureText(j.sign).width > 690) g.font = `900 ${(size -= 4)}px Arial`;
  g.fillText(j.sign, 384, 150);
  g.font = '700 40px Arial';
  g.fillText('← EVERYWHERE   ·   NOWHERE →', 384, 236);
  signTex.needsUpdate = true;
}

// traffic lights + police umbrella
const bulbs = [];
{
  const poleM = mat('#4a4660', { roughness: 0.5 });
  for (const [x, z, axis] of [[5.3, 5.3, 'x'], [-5.3, -5.3, 'x'], [-5.3, 5.3, 'z'], [5.3, -5.3, 'z']]) {
    add(new THREE.CylinderGeometry(0.08, 0.08, 3, 8), poleM, x, 1.5, z);
    add(new RoundedBoxGeometry(0.5, 1.2, 0.5, 1, 0.08), poleM, x, 3.3, z);
    const m = new THREE.MeshBasicMaterial({ color: '#e5392b', toneMapped: false });
    add(new THREE.SphereGeometry(0.2, 14, 10), m, x - 0.2 * Math.sign(x), 3.3, z - 0.2 * Math.sign(z), { cast: false });
    bulbs.push({ axis, m });
  }
  add(new THREE.CylinderGeometry(0.6, 0.6, 1.2, 16), mat('#fffaf5'), -6.9, 0.8, 6.9);
  const um = add(new THREE.ConeGeometry(1.4, 0.7, 8), mat('#ff8f9f', { roughness: 0.6 }), -6.9, 2.4, 6.9);
  um.rotation.y = 0.3;
}

// ================================================================ vehicles (merged, vertex-coloured, instanced)
function part(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  delete g.attributes.uv;
  return g;
}
const RB = (w, h, d, r = 0.1) => new RoundedBoxGeometry(w, h, d, 2, r);
const wheel = (r, w) => new THREE.CylinderGeometry(r, r, w, 14);
const lightBox = (d = 0.2) => new THREE.BoxGeometry(0.05, 0.09, d);
const TINT = '#ffffff';
const MODELS = {
  car: {
    len: 1.9,
    body: [part(RB(1.9, 0.46, 0.95, 0.14), TINT, 0, 0.42), part(RB(1.05, 0.4, 0.84, 0.12), '#4a5270', -0.12, 0.82),
      ...[[0.6, 0.43], [0.6, -0.43], [-0.6, 0.43], [-0.6, -0.43]].map(([x, z]) => part(wheel(0.19, 0.16), '#141414', x, 0.2, z, Math.PI / 2))],
    lights: [part(lightBox(), '#fff2c8', 0.955, 0.47, 0.3), part(lightBox(), '#fff2c8', 0.955, 0.47, -0.3), part(lightBox(), '#ff2a14', -0.955, 0.5, 0.32), part(lightBox(), '#ff2a14', -0.955, 0.5, -0.32)],
    colors: ['#fbfaf7', '#d6dbe6', '#f7a8a8', '#9cc3e6', '#6d6a86', '#ffd88a', '#fbfaf7', '#b8e0c8', '#d9c2f0'],
  },
  auto: {
    len: 1.3,
    body: [part(RB(1.2, 0.46, 0.86, 0.12), TINT, -0.05, 0.42), part(RB(0.34, 0.52, 0.5, 0.1), TINT, 0.56, 0.52), part(RB(1.0, 0.5, 0.92, 0.16), '#3a3550', -0.12, 0.93),
      part(wheel(0.17, 0.12), '#141414', 0.56, 0.17, 0, Math.PI / 2), part(wheel(0.17, 0.12), '#141414', -0.42, 0.17, 0.4, Math.PI / 2), part(wheel(0.17, 0.12), '#141414', -0.42, 0.17, -0.4, Math.PI / 2)],
    lights: [part(lightBox(0.14), '#fff2c8', 0.74, 0.66, 0), part(lightBox(0.12), '#ff2a14', -0.66, 0.5, 0.34), part(lightBox(0.12), '#ff2a14', -0.66, 0.5, -0.34)],
    colors: ['#ffe07a', '#ffe07a', '#ffd86b', '#8fd6a0'],
  },
  bus: {
    len: 4.4,
    body: [part(RB(4.4, 1.25, 1.15, 0.18), TINT, 0, 0.87), part(new THREE.BoxGeometry(4.24, 0.38, 1.17), '#4a5270', 0, 1.08), part(RB(4.1, 0.08, 1.0, 0.03), '#e6e6e6', 0, 1.51),
      ...[[1.4, 0.55], [1.4, -0.55], [-1.4, 0.55], [-1.4, -0.55]].map(([x, z]) => part(wheel(0.26, 0.18), '#141414', x, 0.26, z, Math.PI / 2))],
    lights: [part(lightBox(), '#fff2c8', 2.21, 0.5, 0.4), part(lightBox(), '#fff2c8', 2.21, 0.5, -0.4), part(lightBox(), '#ff2a14', -2.21, 0.62, 0.45), part(lightBox(), '#ff2a14', -2.21, 0.62, -0.45),
      part(new THREE.BoxGeometry(0.04, 0.16, 0.72), '#ffb300', 2.215, 1.33, 0)],
    colors: ['#f28b82', '#8fb8f0', '#8fd6a8', '#ffb870'],
  },
  bike: {
    len: 0.85,
    body: [part(RB(0.8, 0.2, 0.2, 0.06), '#2a2a2a', 0, 0.35), part(wheel(0.16, 0.07), '#111', 0.3, 0.16, 0, Math.PI / 2), part(wheel(0.16, 0.07), '#111', -0.3, 0.16, 0, Math.PI / 2),
      part(RB(0.26, 0.38, 0.3, 0.08), TINT, -0.05, 0.66), part(new THREE.SphereGeometry(0.13, 12, 10), '#ececec', 0.03, 0.94)],
    lights: [part(lightBox(0.08), '#fff2c8', 0.42, 0.42, 0), part(lightBox(0.08), '#ff2a14', -0.42, 0.4, 0)],
    colors: ['#f7a8a8', '#9cc3e6', '#fbfaf7', '#6d6a86', '#ffe07a', '#c9b8ff', '#8fd6a8', '#ffb88a'],
  },
};
const vehMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.12 });
const vehLightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const MAX = { car: 190, auto: 190, bus: 80, bike: 110 };
for (const [k, m] of Object.entries(MODELS)) {
  m.mesh = new THREE.InstancedMesh(mergeGeometries(m.body), vehMat, MAX[k]);
  m.lmesh = new THREE.InstancedMesh(mergeGeometries(m.lights), vehLightMat, MAX[k]);
  m.mesh.castShadow = true;
  m.mesh.frustumCulled = m.lmesh.frustumCulled = false;
  m.mesh.setColorAt(0, new THREE.Color()); m.lmesh.setColorAt(0, new THREE.Color());
  scene.add(m.mesh, m.lmesh);
}

// ================================================================ traffic simulation
const LANES = [];
for (const [axis, dir, off] of [['x', 1, 0.9], ['x', 1, 2.6], ['x', -1, -0.9], ['x', -1, -2.6], ['z', 1, -0.9], ['z', 1, -2.6], ['z', -1, 0.9], ['z', -1, 2.6]])
  LANES.push({ axis, dir, off, bikes: false, cars: [] });
for (const [axis, dir, off] of [['x', 1, 1.75], ['x', -1, -1.75], ['z', 1, -1.75], ['z', -1, 1.75]])
  LANES.push({ axis, dir, off, bikes: true, cars: [] });

function newVehicle(bikeLane, s) {
  let type = 'bike';
  if (!bikeLane) { const r = Math.random(); type = r < 0.58 ? 'car' : r < 0.88 ? 'auto' : 'bus'; }
  const m = MODELS[type];
  return { type, len: m.len, s, v: 0, color: new THREE.Color(m.colors[Math.floor(Math.random() * m.colors.length)]), rebel: Math.random() < 0.18, mood: 0.75 + Math.random() * 0.45, pop: 0 };
}

const HALF = 66, STOP = -5.4;
let jam = 0.4, phase = 0, phaseT = 0;
const PHASES = [['x', 7], ['none', 1.6], ['z', 7], ['none', 1.6]];
const green = (axis) => PHASES[phase][0] === axis;
const want = (lane) => lane.bikes ? Math.round(3 + jam * 12) : Math.round(5 + jam * 17);

function seedTraffic() {
  for (const lane of LANES) {
    const n = want(lane);
    let s = HALF - Math.random() * 8;
    for (let i = 0; i < n; i++) {
      const v = newVehicle(lane.bikes, 0);
      v.s = s; v.pop = 1;
      lane.cars.push(v);
      s -= v.len + 0.6 + Math.random() * (2 + (1 - jam) * 9);
      if (s < -HALF) break;
    }
  }
}

const cow = { active: false, lane: 0, s: -10, group: null, scale: 0, mooT: 3 };

function stepTraffic(dt) {
  phaseT += dt;
  if (phaseT > PHASES[phase][1] * (1 + jam * 0.3)) { phaseT = 0; phase = (phase + 1) % PHASES.length; }
  for (const b of bulbs) b.m.color.set(green(b.axis) ? '#2fe070' : PHASES[phase][0] === 'none' ? '#ffb000' : '#ff2d1f').multiplyScalar(1.6 + cur.lamps);

  const vmax = 7.8 * (1 - 0.9 * jam) + 0.25;
  let sumV = 0, n = 0;
  LANES.forEach((lane, li) => {
    const cars = lane.cars;
    const cap = lane.bikes ? Math.max(vmax * 1.35, 2.4) : vmax;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i], lead = cars[i - 1];
      let gap = lead ? lead.s - lead.len / 2 - (c.s + c.len / 2) : 99;
      const front = c.s + c.len / 2;
      if (!green(lane.axis) && front < STOP + 0.4 && !(lane.bikes && c.rebel && phaseT > 1.5)) gap = Math.min(gap, STOP - front);
      if (cow.active && cow.lane === li && front < cow.s - 0.8) gap = Math.min(gap, cow.s - 1.2 - front);
      const desired = cap * c.mood * THREE.MathUtils.clamp((gap - (lane.bikes ? 0.2 : 0.35)) / 3, 0, 1);
      c.v += (desired - c.v) * Math.min(1, dt * (desired < c.v ? 6 : 1.7));
      c.s += c.v * dt;
      c.pop = Math.min(1, c.pop + dt * 3);
      if (!lane.bikes) { sumV += c.v; n++; }
    }
    if (cars.length && cars[0].s > HALF + 3) cars.shift();
    const tail = cars.length ? cars.at(-1).s - cars.at(-1).len : HALF;
    if (cars.length < want(lane) && tail > -HALF + 3 && Math.random() < dt * 4) {
      const v = newVehicle(lane.bikes, -HALF - 2);
      v.v = vmax * 0.6;
      cars.push(v);
    }
  });
  return n ? sumV / n : 0;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
const laneQuat = LANES.map((l) => new THREE.Quaternion().setFromAxisAngle(UP, l.axis === 'x' ? (l.dir > 0 ? 0 : Math.PI) : (l.dir > 0 ? -Math.PI / 2 : Math.PI / 2)));
const worldOf = (lane, s, out) => out.set(lane.axis === 'x' ? s * lane.dir : lane.off, 0, lane.axis === 'x' ? lane.off : s * lane.dir);

function drawTraffic(t) {
  const cnt = { car: 0, auto: 0, bus: 0, bike: 0 };
  LANES.forEach((lane, li) => {
    for (const c of lane.cars) {
      const m = MODELS[c.type], i = cnt[c.type]++;
      if (i >= MAX[c.type]) continue;
      worldOf(lane, c.s, _p);
      const bob = c.v > 0.3 ? Math.sin(t * 18 + c.s) * 0.012 : 0;
      _p.y = bob;
      if (lane.bikes) { _p.x += lane.axis === 'z' ? Math.sin(c.s * 0.7) * 0.12 : 0; _p.z += lane.axis === 'x' ? Math.sin(c.s * 0.7) * 0.12 : 0; }
      const sc = 0.001 + c.pop * (1 + (1 - c.pop) * 0.2);
      _m.compose(_p, laneQuat[li], _s.set(sc, sc, sc));
      m.mesh.setMatrixAt(i, _m); m.mesh.setColorAt(i, c.color);
      m.lmesh.setMatrixAt(i, _m);
      m.lmesh.setColorAt(i, _c.setScalar(c.v < 0.4 ? 1.5 : 1));
    }
  });
  for (const [k, m] of Object.entries(MODELS)) {
    m.mesh.count = m.lmesh.count = Math.min(cnt[k], MAX[k]);
    m.mesh.instanceMatrix.needsUpdate = m.lmesh.instanceMatrix.needsUpdate = true;
    m.mesh.instanceColor.needsUpdate = m.lmesh.instanceColor.needsUpdate = true;
  }
}

// ================================================================ the cow
{
  const g = new THREE.Group(), white = mat('#f4f1ea', { roughness: 0.8 }), dark = mat('#2b2521', { roughness: 0.8 }), pink = mat('#e9a5a0');
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.75, 0.7, 2, 0.2), white); body.position.y = 0.95;
  const spot1 = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), dark); spot1.scale.set(1.2, 0.8, 0.1); spot1.position.set(0.1, 1.05, 0.35);
  const spot2 = spot1.clone(); spot2.position.set(-0.4, 0.95, -0.35);
  const head = new THREE.Group(); head.position.set(0.85, 1.25, 0);
  const skull = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.42, 0.42, 2, 0.12), white);
  const snout = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.26, 0.36, 2, 0.08), pink); snout.position.set(0.26, -0.08, 0);
  const horn = new THREE.ConeGeometry(0.05, 0.22, 6);
  const h1 = new THREE.Mesh(horn, mat('#e8dcc0')); h1.position.set(-0.05, 0.28, 0.14); h1.rotation.x = -0.4;
  const h2 = h1.clone(); h2.position.z = -0.14; h2.rotation.x = 0.4;
  const eye = new THREE.SphereGeometry(0.04, 8, 6);
  const e1 = new THREE.Mesh(eye, dark); e1.position.set(0.18, 0.08, 0.18); const e2 = e1.clone(); e2.position.z = -0.18;
  head.add(skull, snout, h1, h2, e1, e2);
  const legGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.62, 8);
  for (const [x, z] of [[0.55, 0.22], [0.55, -0.22], [-0.55, 0.22], [-0.55, -0.22]]) { const l = new THREE.Mesh(legGeo, white); l.position.set(x, 0.31, z); l.castShadow = true; g.add(l); }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.6, 6), white); tail.position.set(-0.78, 0.9, 0); tail.rotation.z = 0.35;
  g.add(body, spot1, spot2, head, tail);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = { head, tail };
  g.scale.setScalar(0.001);
  worldOf(LANES[0], cow.s, g.position);
  g.position.z += 0.45;
  g.rotation.y = 0.7;
  scene.add(g);
  cow.group = g;
}

// ================================================================ rain
const RAIN_N = 1600;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_N * 6);
for (let i = 0; i < RAIN_N; i++) {
  const x = (Math.random() - 0.5) * 90, y = Math.random() * 40, z = (Math.random() - 0.5) * 90;
  rainPos.set([x, y, z, x + 0.12, y - 0.7, z + 0.06], i * 6);
}
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.LineBasicMaterial({ color: '#d9e3f0', transparent: true, opacity: 0 });
const rain = new THREE.LineSegments(rainGeo, rainMat);
rain.frustumCulled = false;
scene.add(rain);
const puddles = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20), new THREE.MeshStandardMaterial({ color: '#2d3440', roughness: 0.04, metalness: 0.7, transparent: true, opacity: 0 }), 26);
{
  for (let i = 0; i < 26; i++) {
    const onX = i % 2 === 0, p = (Math.random() - 0.5) * 100, o = (Math.random() - 0.5) * 5.5, s = 0.6 + Math.random() * 1.2;
    _m.makeRotationX(-Math.PI / 2).scale(_s.set(s * 1.6, s, 1)).setPosition(onX ? p : o, 0.095, onX ? o : p);
    puddles.setMatrixAt(i, _m);
  }
  scene.add(puddles);
}

// ================================================================ honks
const HONKS = ['PAAM!', 'POOOO!', 'BEEP BEEP', 'PEE-PAA', 'HORN OK PLEASE', 'MOVE, MACHA', 'PAA-PAA-PAAAM', 'BRRRRP', 'SWALPA MOVE!'];
const honkLayer = $('honks');
function bubble(worldPos, text, cls = '') {
  _p.copy(worldPos).project(camera);
  if (_p.z > 1 || Math.abs(_p.x) > 0.95 || Math.abs(_p.y) > 0.95) return null;
  const el = document.createElement('div');
  el.className = 'honk ' + cls;
  el.textContent = text;
  el.style.left = `${(_p.x * 0.5 + 0.5) * innerWidth}px`;
  el.style.top = `${(-_p.y * 0.5 + 0.5) * innerHeight}px`;
  honkLayer.appendChild(el);
  setTimeout(() => el.remove(), 1400);
  return _p.x;
}
function maybeHonk(dt) {
  if (honkLayer.childElementCount > 7 || Math.random() > jam * dt * 3.4) return;
  const li = Math.floor(Math.random() * 8), lane = LANES[li];
  const stuck = lane.cars.filter((c) => c.v < 0.45 && Math.abs(c.s) < 32);
  if (!stuck.length) return;
  const c = stuck[Math.floor(Math.random() * stuck.length)];
  worldOf(lane, c.s, _p).y = 1.9;
  const x = bubble(_p.clone(), HONKS[Math.floor(Math.random() * HONKS.length)]);
  if (x != null) sfx.honk(x);
}

// ================================================================ layout + resize
function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 40 : 24;
  if (!isMobile()) camera.setViewOffset(w, h, -w * 0.13, 0, w, h);
  else camera.setViewOffset(w, h, 0, h * 0.24, w, h);
  camera.updateProjectionMatrix();
  fx.setSize(w, h);
  fx.setFocus(isMobile() ? 0.72 : 0.5);
}
addEventListener('resize', resize);
resize();

// ================================================================ main loop
const clock = new THREE.Clock();
let speedT = 0, intro = { t: 0, dur: 2.6, from: camera.position.clone() };
const ease = (x) => 1 - Math.pow(1 - x, 4);
function lerpState(dt) {
  const k = 1 - Math.exp(-dt * 2.5);
  for (const key of ['top', 'hor', 'bot', 'fog', 'sun', 'hs', 'hg']) cur[key].lerp(tgt[key], k);
  for (const key of ['sunI', 'hI', 'env', 'lamps', 'lights', 'win', 'exposure', 'bloom', 'wet']) cur[key] += (tgt[key] - cur[key]) * k;
  cur.sunPos.lerp(tgt.sunPos, k);
  skyMat.uniforms.top.value.copy(cur.top); skyMat.uniforms.hor.value.copy(cur.hor); skyMat.uniforms.bot.value.copy(cur.bot);
  scene.fog.color.copy(cur.fog);
  sun.color.copy(cur.sun); sun.intensity = cur.sunI; sun.position.copy(cur.sunPos);
  hemi.color.copy(cur.hs); hemi.groundColor.copy(cur.hg); hemi.intensity = cur.hI;
  scene.environmentIntensity = cur.env;
  renderer.toneMappingExposure = cur.exposure;
  fx.bloom.strength = cur.bloom;
  lampHeadMat.color.set('#ffe3a6').multiplyScalar(0.35 + cur.lamps * 1.8);
  poolMat.opacity = cur.lamps * 0.4;
  vehLightMat.color.setScalar(0.5 + cur.lights * 0.8);
  winLitMat.color.set('#7c8aa8').lerp(_c.setScalar(1.25), cur.win);
  signTex.userData.mesh.material.emissiveIntensity = cur.lamps * 0.3;
  billboard.userData.face.material.emissiveIntensity = 0.05 + cur.lamps * 0.45;
  billboard.userData.lampM.color.set('#fff3c4').multiplyScalar(0.4 + cur.lamps * 1.4);
  roadMat.roughness = 0.9 - cur.wet * 0.7; roadMat.metalness = cur.wet * 0.25;
  rainMat.opacity = cur.wet * 0.3;
  puddles.material.opacity = cur.wet * 0.85;
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  if (intro) {
    intro.t += dt;
    const k = ease(Math.min(1, intro.t / intro.dur));
    camera.position.lerpVectors(intro.from, HOME, k);
    camera.lookAt(0, 0, 0);
    if (intro.t >= intro.dur) { intro = null; controls.enabled = true; }
  } else controls.update();

  lerpState(dt);
  const avg = stepTraffic(dt);
  drawTraffic(t);
  if (!intro) maybeHonk(dt);

  craneJib.rotation.y = Math.sin(t * 0.15) * 0.5;
  hanging.position.y = -5.2 + Math.sin(t * 0.8) * 0.15;
  craneJib.userData.beacon.material.color.set('#ff3b2b').multiplyScalar((0.35 + Math.max(0, Math.sin(t * 2.5)) * 0.65) * (1 + cur.lamps * 2));

  // cow
  const cg = cow.group, target = cow.active ? 1 : 0;
  cow.scale += (target - cow.scale) * Math.min(1, dt * 5);
  const bounce = cow.active ? 1 + Math.sin(Math.min(1, cow.scale) * Math.PI) * 0.15 : 1;
  cg.scale.setScalar(Math.max(0.001, cow.scale * bounce));
  cg.visible = cow.scale > 0.01;
  cg.userData.head.rotation.z = Math.sin(t * 2.2) * 0.12 - 0.15;
  cg.userData.tail.rotation.x = Math.sin(t * 3) * 0.4;
  if (cow.active && (cow.mooT -= dt) < 0) {
    cow.mooT = 5 + Math.random() * 5;
    if (bubble(cg.position.clone().setY(2.4), 'MOOOO', 'moo') != null) sfx.moo();
  }

  // rain
  if (cur.wet > 0.02) {
    const fall = dt * 34;
    for (let i = 0; i < RAIN_N; i++) {
      const o = i * 6;
      rainPos[o + 1] -= fall; rainPos[o + 4] -= fall;
      if (rainPos[o + 4] < 0) { rainPos[o + 1] += 40; rainPos[o + 4] += 40; }
    }
    rainGeo.attributes.position.needsUpdate = true;
  }

  if ((speedT -= dt) < 0) {
    speedT = 0.5;
    $('speed').textContent = `${Math.max(1, Math.round(avg * 6))} km/h in the diorama`;
    sfx.setRumble(0.012 + jam * 0.035);
  }
  fx.render(dt, t);
  requestAnimationFrame(frame);
}

// ================================================================ UI
const ICON = {
  manager: '<path d="M4 8h16v11H4zM9 8V5h6v3"/>', founder: '<path d="M5 19c2-6 6-12 14-14-2 8-8 12-14 14zM9 15l-3-3"/>',
  client: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 10h1M14 10h1M9 14h1M14 14h1"/>', mom: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  date: '<circle cx="12" cy="8" r="4"/><path d="M12 12v9M9 17h6"/>', prof: '<path d="M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5"/>', hr: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
  corporate: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', desperate: '<path d="M12 3l10 18H2zM12 10v5M12 18v.01"/>', poetic: '<path d="M20 4C10 4 5 10 4 20c4-6 8-8 12-8M8 16h5"/>',
  legal: '<path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z"/>',
  day: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dusk: '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 8V5M5.6 11.6 4 10M18.4 11.6 20 10"/>', night: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
};
const svg = (k) => `<svg class="i" viewBox="0 0 24 24">${ICON[k] || ''}</svg>`;
const AVATAR = { manager: ['M', '#8ec5ff'], founder: ['F', '#ffcc00'], client: ['C', '#c9d6c3'], mom: ['A', '#ffb3c7'], date: ['♥', '#ff8a8a'], prof: ['P', '#d7c3ff'], hr: ['HR', '#b8f0d0'] };

function chips(el, list, key, label, icon) {
  el.innerHTML = list.map((x) => `<button data-id="${x.id}" aria-pressed="${x.id === state[key]}">${icon ? icon(x) : ''}${label(x)}</button>`).join('');
  el.querySelectorAll('button').forEach((b) => (b.onclick = () => {
    state[key] = b.dataset.id;
    el.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    sfx.pop(false);
    changed();
  }));
}
chips($('jn'), JUNCTIONS, 'junction', (j) => j.name.replace(' Junction', ''));
chips($('aud'), AUDIENCES, 'audience', (a) => a.label, (a) => svg(a.id));
chips($('tone'), TONES, 'tone', (t) => t.label, (t) => (t.id === 'kannada' ? '<b style="font-size:15px;line-height:1">ಕ</b>' : svg(t.id)));
$('tod').innerHTML = ['day', 'dusk', 'night'].map((k) => `<button data-k="${k}" aria-pressed="${k === state.tod}" title="${k}">${svg(k)}<span>${k[0].toUpperCase() + k.slice(1)}</span></button>`).join('');
$('tod').querySelectorAll('button').forEach((b) => (b.onclick = () => setTod(b.dataset.k)));
function setTod(k) {
  state.tod = k;
  $('tod').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.k === k)));
  makeTarget();
}
$('mins').value = state.minutes;
$('mins').oninput = () => { state.minutes = +$('mins').value; changed(); };

function changed() {
  const j = JUNCTIONS.find((x) => x.id === state.junction);
  drawSign(j);
  $('mVal').textContent = state.minutes;
  $('mWord').textContent = lateness(state.minutes);
  jam = THREE.MathUtils.clamp((0.12 + 0.88 * ((state.minutes - 5) / 235) ** 0.7) * (0.65 + 0.35 * j.jam) + (state.rain ? 0.15 : 0), 0.05, 1);
  cow.active = state.minutes >= 120;
  store.set('sb-state', { junction: state.junction, minutes: state.minutes, audience: state.audience, tone: state.tone });
}
function setRain(on) {
  state.rain = on;
  $('rain').setAttribute('aria-pressed', String(on));
  makeTarget(); changed();
  if (on) toast('Monsoon mode. Everything is now 40% slower and 100% wetter.');
}
$('rain').onclick = () => setRain(!state.rain);
$('snd').onclick = () => {
  sfx.on = !sfx.on;
  $('snd').setAttribute('aria-pressed', String(sfx.on));
  $('sndWave').setAttribute('opacity', sfx.on ? '1' : '.25');
  if (sfx.on) { sfx.startRumble(); sfx.honk(0); }
  sfx.setRumble(sfx.on ? 0.03 : 0);
};
$('btnTs').onclick = () => { const on = $('btnTs').getAttribute('aria-pressed') !== 'true'; $('btnTs').setAttribute('aria-pressed', String(on)); fx.setTilt(on); };
$('deskHead').onclick = () => { if (isMobile()) $('desk').classList.toggle('min'); };

changed();
seedTraffic();
document.querySelector('#jn [aria-pressed=true]')?.scrollIntoView({ inline: 'center', block: 'nearest' });

// ---------------------------------------------------------------- chat
let chatRun = 0;
function chatSend(text, reason) {
  state.excuse = text;
  state.reason = reason || randomReason();
  const run = ++chatRun;
  const aud = AUDIENCES.find((a) => a.id === state.audience);
  const [ch, bg] = AVATAR[aud.id] || ['?', '#ddd'];
  $('chatAv').textContent = ch; $('chatAv').style.background = bg;
  $('chatName').textContent = aud.label;
  $('chatStatus').textContent = 'online';
  $('chat').classList.add('show');
  const body = $('chatBody');
  while (body.children.length > 5) body.firstChild.remove();
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const me = document.createElement('div');
  me.className = 'msg me';
  me.append(text);
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = `${time} <span class="tk">✓</span>`;
  me.append(meta);
  body.append(me);
  body.scrollTop = body.scrollHeight;
  sfx.pop(true);
  $('wa').href = `https://wa.me/?text=${encodeURIComponent(`${text}\n\n(certified by Silk Bored: ${location.origin})`)}`;
  const ticks = meta.querySelector('.tk');
  const later = (ms, fn) => setTimeout(() => run === chatRun && fn(), ms);
  later(600, () => (ticks.textContent = '✓✓'));
  later(1500, () => {
    ticks.classList.add('read');
    $('chatStatus').textContent = 'typing…';
    const typing = Object.assign(document.createElement('div'), { className: 'typing', innerHTML: '<i></i><i></i><i></i>' });
    body.append(typing); body.scrollTop = body.scrollHeight;
    later(900 + Math.random() * 900, () => {
      typing.remove();
      const them = document.createElement('div');
      them.className = 'msg them';
      them.append(replyFor(state.audience, state.minutes));
      const m2 = document.createElement('div'); m2.className = 'meta'; m2.textContent = time;
      them.append(m2);
      body.append(them); body.scrollTop = body.scrollHeight;
      $('chatStatus').textContent = 'online';
      sfx.pop(false);
    });
  });
  if (isMobile()) $('desk').classList.remove('min');
  $('chat').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

const opts = () => ({ ...state, cow: cow.active });
$('gen').onclick = () => { $('err').textContent = ''; chatSend(makeExcuse(opts())); };

initTurnstile('ts').catch(() => {});
$('ai').onclick = async () => {
  $('err').textContent = '';
  const btn = $('ai'), label = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Honking at the AI…';
  try {
    const token = await getToken();
    const r = await fetch('/api/excuse', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ junction: state.junction, minutes: state.minutes, audience: state.audience, tone: state.tone, detail: $('detail').value, rain: state.rain, cow: cow.active, turnstile: token }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    chatSend(d.excuse, d.reason);
  } catch (e) {
    $('err').textContent = `${e.message} Here's a free one instead.`;
    chatSend(makeExcuse(opts()));
  } finally {
    btn.disabled = false; btn.innerHTML = label;
  }
};

$('copy').onclick = async () => { try { await navigator.clipboard.writeText(state.excuse); toast('Copied. Go forth and be late.'); } catch { toast('Couldn’t copy. Select the text instead.'); } };
$('cert').onclick = async () => {
  await drawCert(false);
  $('certModal').classList.add('open');
  setTimeout(async () => {
    await drawCert(true);
    const sh = $('certSheet'); sh.classList.remove('slam'); void sh.offsetWidth; sh.classList.add('slam');
    sfx.thunk();
  }, 520);
};
$('btnHelp').onclick = () => $('help').classList.add('open');

// the billboard is clickable (a click, not a drag)
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downAt = null;
const overBoard = (e) => { ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.intersectObject(billboard, true).length > 0; };
canvas.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
canvas.addEventListener('pointerup', (e) => {
  if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 6 && overBoard(e)) { sfx.honk(0.3); me.openCard(true); }
  downAt = null;
});
canvas.addEventListener('pointermove', (e) => { if (!downAt) canvas.style.cursor = overBoard(e) ? 'pointer' : ''; });

const IC = (d) => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;
const me = initMe({
  id: 'silk-bored', name: 'Silk Bored', music: 'lofi', mount: $('tools'), btnClass: 'tool', introDelay: 900,
  intro: {
    kicker: 'Bureau of Bumper-to-Bumper Affairs',
    titleHtml: 'Silk Bored',
    lede: 'Late because of Bengaluru traffic? Pick your junction and who’s waiting, and get an excuse <b>certified</b> by an entirely unofficial bureau.',
    steps: [
      [IC('<path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>'), 'Pick your junction', 'Silk Board, Hebbal, ORR… the tiny city jams to match.'],
      [IC('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'), 'Drag how late you are', 'Watch the traffic give up. After two hours, a cow takes over.'],
      [IC('<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>'), 'Send it, get certified', 'Copy it, WhatsApp it, and download your delay certificate.'],
    ],
    cta: 'Merge into traffic',
    note: 'Works on phones too',
  },
});
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => b.closest('.modal').classList.remove('open')));
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); }));
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea') || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') document.querySelectorAll('.modal.open').forEach((m) => m.classList.remove('open'));
  if (k === 'g') $('gen').click();
  if (k === 't') $('btnTs').click();
  if (k === 'm') $('rain').click();
  if (k === 's') $('snd').click();
  if (k === '?') me.showIntro();
  if (k === 'n') setTod({ day: 'dusk', dusk: 'night', night: 'day' }[state.tod]);
});

let toastT;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

function tickClock() {
  const s = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date());
  $('clock').textContent = `Bengaluru · ${s.toUpperCase()}`;
}
tickClock(); setInterval(tickClock, 15000);

// ---------------------------------------------------------------- certificate
function wrap(g, text, x, y, maxW, lh, maxLines = 99) {
  const words = text.split(/\s+/);
  let line = '', lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (g.measureText(test).width > maxW && line) {
      if (++lines >= maxLines) { g.fillText(line.replace(/[,.;:]?$/, '…'), x, y); return y + lh; }
      g.fillText(line, x, y); y += lh; line = words[i];
    } else line = test;
  }
  if (line) g.fillText(line, x, y);
  return y + lh;
}
let certSerial = '';
async function drawCert(withStamp) {
  await Promise.all(['700 40px \"Space Grotesk\"', '30px "Space Grotesk"', '800 30px "Space Grotesk"', '22px "JetBrains Mono"', '60px Caveat'].map((f) => document.fonts.load(f).catch(() => {})));
  const j = JUNCTIONS.find((x) => x.id === state.junction);
  const c = $('certCanvas'), g = c.getContext('2d');
  const W = c.width, H = c.height;
  if (!withStamp) certSerial = `BBBA/${j.id.toUpperCase()}/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 90000) + 10000)}`;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#fffaf5'; g.fillRect(0, 0, W, H);
  // guilloche-ish background lines
  g.strokeStyle = 'rgba(63,158,114,.08)'; g.lineWidth = 1.2;
  for (let k = 0; k < 40; k++) { g.beginPath(); for (let x = 0; x <= W; x += 10) g.lineTo(x, H / 2 + Math.sin(x / 60 + k * 0.4) * (180 + k * 6)); g.stroke(); }
  g.strokeStyle = '#3f9e72'; g.lineWidth = 10; g.strokeRect(30, 30, W - 60, H - 60);
  g.lineWidth = 2; g.strokeRect(48, 48, W - 96, H - 96);
  g.fillStyle = '#3f9e72';
  for (let x = 70; x < W - 60; x += 26) { g.beginPath(); g.arc(x, 62, 4, 0, 7); g.arc(x, H - 62, 4, 0, 7); g.fill(); }
  g.textAlign = 'center';
  g.font = '700 40px \"Space Grotesk\"'; g.fillText('BUREAU OF BUMPER-TO-BUMPER AFFAIRS', W / 2, 142);
  g.fillStyle = '#6b6456'; g.font = '500 22px "Space Grotesk"'; g.fillText('Bengaluru · established the day the first signal broke · entirely unofficial', W / 2, 180);
  g.fillStyle = '#e8607a'; g.font = '700 64px \"Space Grotesk\"'; g.fillText('TRAFFIC DELAY CERTIFICATE', W / 2, 272);
  g.fillStyle = '#2f2a45'; g.font = '600 22px "JetBrains Mono"'; g.fillText(`Certificate No. ${certSerial}`, W / 2, 316);
  g.textAlign = 'left';
  g.font = '500 30px "Space Grotesk"';
  const who = ($('name').value || '').trim() || 'the bearer of this certificate';
  const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const extra = [state.rain && 'in monsoon conditions', cow.active && 'with a cow in attendance'].filter(Boolean).join(', ');
  let y = wrap(g, `This is to certify that ${who} was, in good faith and against their will, stationary at ${j.name}${extra ? `, ${extra},` : ''} for approximately ${state.minutes} minutes on ${date}.`, 110, 392, W - 220, 44);
  g.font = '800 30px "Space Grotesk"';
  y = wrap(g, `Certified reason: ${state.reason}`, 110, y + 14, W - 220, 42);
  g.font = 'italic 500 24px "Space Grotesk"'; g.fillStyle = '#4a463d';
  wrap(g, `Excuse on record: “${(state.excuse || '').replace(/\n+/g, ' ')}”`, 110, y + 14, W - 520, 34, 5);
  g.fillStyle = '#2f2a45'; g.font = '60px Caveat'; g.fillText('Swalpa Adjust Maadi', 110, H - 170);
  g.fillRect(110, H - 150, 420, 2);
  g.font = '600 20px "Space Grotesk"'; g.fillText('Chief Honking Officer', 110, H - 120);
  g.textAlign = 'center'; g.fillStyle = '#6b6456'; g.font = '600 18px "Space Grotesk"';
  g.fillText(`This certificate has no legal value. Neither does your ETA. · ${location.host}`, W / 2, H - 76);
  if (!withStamp) return;
  g.save();
  g.translate(W - 250, H - 235); g.rotate(-0.22);
  g.strokeStyle = 'rgba(232,96,122,.9)'; g.fillStyle = 'rgba(232,96,122,.9)';
  g.lineWidth = 7; g.beginPath(); g.arc(0, 0, 140, 0, 7); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 118, 0, 7); g.stroke();
  g.font = '700 24px \"Space Grotesk\"'; g.textAlign = 'center';
  const ring = '★ OFFICIALLY BORED ★ BBBA BENGALURU ';
  for (let i = 0; i < ring.length; i++) { g.save(); g.rotate((i / ring.length) * Math.PI * 2); g.fillText(ring[i], 0, -124); g.restore(); }
  g.font = '700 56px \"Space Grotesk\"'; g.fillText(`${state.minutes}`, 0, 12);
  g.font = '700 22px \"Space Grotesk\"'; g.fillText('MIN LATE', 0, 46);
  g.restore();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 1100; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.55})`; g.fillRect(W - 400 + Math.random() * 300, H - 385 + Math.random() * 300, 2, 2); }
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = '#fffaf5'; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
}
$('dl').onclick = () => {
  const a = document.createElement('a');
  a.download = `silk-bored-certificate-${state.junction}.png`;
  a.href = $('certCanvas').toDataURL('image/png');
  a.click();
};
$('shareCert').onclick = async () => {
  const blob = await new Promise((r) => $('certCanvas').toBlob(r, 'image/png'));
  const file = new File([blob], 'delay-certificate.png', { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Silk Bored', text: state.excuse });
    else { await navigator.clipboard.writeText(`${state.excuse}\n${location.origin}`); toast('Copied the excuse. Download the PNG to share the certificate.'); }
  } catch {}
};

// ---------------------------------------------------------------- boot
frame();
requestAnimationFrame(() => {
  $('loader').classList.add('done');
  setTimeout(() => document.body.classList.remove('boot'), 500);
});
