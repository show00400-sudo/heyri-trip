import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MAP = window.HEYRI_MAP, [BX0, BX1, BZ0, BZ1] = MAP.B, CP = MAP.campus;
const $ = s => document.querySelector(s);
const TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (TOUCH) document.documentElement.classList.add('touch');
let seed = 20261005;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const rr = (a, b) => a + rnd() * (b - a);
const pick = a => a[Math.floor(rnd() * a.length)];
const inB = (x, z, m = 0) => x > BX0 + m && x < BX1 - m && z > BZ0 + m && z < BZ1 - m;

/* ================= renderer / scene ================= */
const renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: !TOUCH });
renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1800);
const hemi = new THREE.HemisphereLight(0xffffff, 0x88aa66, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
sun.castShadow = true;
sun.shadow.mapSize.set(TOUCH ? 1024 : 2048, TOUCH ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const mats = {};
const mat = (c, o = {}) => mats[c + JSON.stringify(o)] ??= new THREE.MeshLambertMaterial({ color: c, ...o });

/* ================= geometry helpers ================= */
const polyIn = (x, z, poly) => { let o = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) o = !o; } return o; };
function edgeDist(x, z, poly) {
  let best = 1e9;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    best = Math.min(best, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz));
  }
  return best;
}
const inCampus = (x, z) => polyIn(x, z, CP.poly);

/* campus geometry derived from data */
const G = [CP.gate.x, CP.gate.z], gN = [CP.gate.dx, CP.gate.dz], gT = [gN[1], -gN[0]];
if (CP.lake.length > 2) MAP.water.push(CP.lake);

/* ================= ground ================= */
const ground = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000), mat(0x8cc271));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const lawn = new THREE.Mesh(new THREE.PlaneGeometry(BX1 - BX0, BZ1 - BZ0), mat(0x9bd07c));
lawn.rotation.x = -Math.PI / 2; lawn.position.set((BX0 + BX1) / 2, 0.005, (BZ0 + BZ1) / 2); lawn.receiveShadow = true; scene.add(lawn);
{ // campus lawn
  const sh = new THREE.Shape(CP.poly.map(p => new THREE.Vector2(p[0], -p[1])));
  const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat(0x7fcf6c, { side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.012; m.receiveShadow = true; scene.add(m);
}

/* ================= roads ================= */
const ROAD = {
  trunk: [12, 0x666a72, 5], trunk_link: [8, 0x666a72, 5], secondary: [9, 0x6b6f76, 4], secondary_link: [7, 0x6b6f76, 4],
  tertiary: [8, 0x73777e, 3], tertiary_link: [6, 0x73777e, 3], residential: [6, 0x7c8087, 2], unclassified: [6, 0x7c8087, 2],
  living_street: [5, 0x9a9588, 2], service: [4, 0xaaa392, 1], track: [3, 0xc9b48a, 1], pedestrian: [4, 0xe0d2b4, 1],
  footway: [2, 0xe3d5b8, 1], path: [1.8, 0xd9c9a4, 1], cycleway: [2.2, 0xd8a9a0, 1], steps: [2, 0xcfc4ae, 1],
  campus: [10, 0xc2a98a, 6], campuslane: [6, 0xcdbfa3, 6]
};
{
  const pos = [], col = [], idx = [], c = new THREE.Color();
  for (const r of MAP.roads) {
    const [w, color, rank] = ROAD[r.k] || [4, 0xaaaaaa, 1];
    const p = r.p, y = 0.02 + rank * 0.008; c.set(color);
    const base = pos.length / 3;
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz * w / 2, nz = dx * w / 2;
      pos.push(p[i][0] + nx, y, p[i][1] + nz, p[i][0] - nx, y, p[i][1] - nz);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let i = 0; i < p.length - 1; i++) { const k = base + i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  m.receiveShadow = true; scene.add(m);
}
const CELL = 10, roadHash = new Map();
const key = (cx, cz) => cx * 8192 + cz;
for (const r of MAP.roads) {
  const hw = (ROAD[r.k] || [4])[0] / 2;
  for (let i = 0; i < r.p.length - 1; i++) {
    const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 3));
    for (let s = 0; s <= n; s++) {
      const x = ax + (bx - ax) * s / n, z = az + (bz - az) * s / n, k = key(Math.floor(x / CELL), Math.floor(z / CELL));
      (roadHash.get(k) || roadHash.set(k, []).get(k)).push([x, z, hw]);
    }
  }
}
function roadDist(x, z, maxd) {
  let best = maxd; const cr = Math.ceil(maxd / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let i = -cr; i <= cr; i++) for (let j = -cr; j <= cr; j++) {
    const a = roadHash.get(key(cx + i, cz + j)); if (!a) continue;
    for (const q of a) { const d = Math.hypot(q[0] - x, q[1] - z) - q[2]; if (d < best) best = d; }
  }
  return best;
}
function nearestRoadPoint(x, z, maxd) {
  let best = null, bd = maxd; const cr = Math.ceil(maxd / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let i = -cr; i <= cr; i++) for (let j = -cr; j <= cr; j++) {
    const a = roadHash.get(key(cx + i, cz + j)); if (!a) continue;
    for (const q of a) { const d = Math.hypot(q[0] - x, q[1] - z); if (d < bd) { bd = d; best = q; } }
  }
  return best;
}

/* ================= water ================= */
for (const w of MAP.water) {
  if (w.length < 3) continue;
  const sh = new THREE.Shape(w.map(q => new THREE.Vector2(q[0], -q[1])));
  const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshLambertMaterial({ color: 0x66b7e0, transparent: true, opacity: .85, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.04; scene.add(m);
}
const inWater = (x, z) => MAP.water.some(w => w.length > 2 && polyIn(x, z, w));

/* ================= colliders ================= */
const colHash = new Map();
function addCol(x, z, r) { const k = key(Math.floor(x / 20), Math.floor(z / 20)); (colHash.get(k) || colHash.set(k, []).get(k)).push([x, z, r]); }
function collide(p, pr) {
  const cx = Math.floor(p.x / 20), cz = Math.floor(p.z / 20);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const a = colHash.get(key(cx + i, cz + j)); if (!a) continue;
    for (const c of a) {
      const dx = p.x - c[0], dz = p.z - c[1], d = Math.hypot(dx, dz), m = c[2] + pr;
      if (d < m && d > 1e-4) { p.x = c[0] + dx / d * m; p.z = c[1] + dz / d * m; }
    }
  }
}
function camBlocked(x, y, z) {
  if (y > 13) return false;
  const cx = Math.floor(x / 20), cz = Math.floor(z / 20);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const a = colHash.get(key(cx + i, cz + j)); if (!a) continue;
    for (const c of a) if (c[2] > 1 && Math.hypot(x - c[0], z - c[1]) < c[2] + .4) return true;
  }
  return false;
}
const toW = (cx, cz, rot, lx, lz) => [cx + lx * Math.cos(rot) + lz * Math.sin(rot), cz - lx * Math.sin(rot) + lz * Math.cos(rot)];
function solid(x, z, w, d, rot) {
  const C = 3.2, nx = Math.max(1, Math.ceil(w / C)), nz = Math.max(1, Math.ceil(d / C)), cw = w / nx, cd = d / nz, cr = Math.hypot(cw, cd) / 2 * .98;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const [px, pz] = toW(x, z, rot, -w / 2 + cw * (i + .5), -d / 2 + cd * (j + .5)); addCol(px, pz, cr); }
}

/* ================= procedural facade textures ================= */
const cv = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c; };
const mkTex = (c, rep = true) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
const BW = 4, BH = 3.2;
const TEX = {};
function pane(x, px, py, pw, ph, glass, frame, bars = true) {
  x.fillStyle = frame; x.fillRect(px - 5, py - 5, pw + 10, ph + 10);
  const g = x.createLinearGradient(px, py, px + pw, py + ph); g.addColorStop(0, glass); g.addColorStop(1, glass === '#ffd277' ? '#ffb347' : '#5d7f99');
  x.fillStyle = g; x.fillRect(px, py, pw, ph);
  if (bars) { x.fillStyle = frame; x.fillRect(px + pw / 2 - 2, py, 4, ph); x.fillRect(px, py + ph * .45, pw, 4); }
}
function def(k, wall, win) {
  TEX[k] = { map: mkTex(cv(160, 128, (x, w, h) => wall(x, w, h))), em: win ? mkTex(cv(160, 128, (x, w, h) => { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); win(x, w, h); })) : null };
}
const fill = (x, w, h, c) => { x.fillStyle = c; x.fillRect(0, 0, w, h); };
def('plain', (x, w, h) => fill(x, w, h, '#fff'));
def('flat', (x, w, h) => { fill(x, w, h, '#e4e4e4'); for (let i = 0; i < 120; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * .06})`; x.fillRect(Math.random() * w, Math.random() * h, 6, 6); } });
def('concrete', (x, w, h) => { fill(x, w, h, '#dcdcd8'); for (let i = 0; i < 220; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * .07})`; x.fillRect(Math.random() * w, Math.random() * h, 3, 3); } x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(0, 0, w, 3); x.fillRect(0, 0, 3, h); x.fillRect(w / 2, 0, 2, h); });
def('win', (x, w, h) => { fill(x, w, h, '#f7f4ec'); pane(x, 42, 28, 76, 70, '#7a9bb3', '#ece7da'); x.fillStyle = 'rgba(0,0,0,.08)'; x.fillRect(0, h - 4, w, 4); }, x => pane(x, 42, 28, 76, 70, '#ffd277', '#000'));
def('glass', (x, w, h) => { fill(x, w, h, '#cfd6da'); pane(x, 6, 8, 148, 92, '#6f95b0', '#dfe4e6'); x.fillStyle = '#c4cbd0'; x.fillRect(0, 108, w, 20); }, x => { x.fillStyle = '#ffcf6e'; x.fillRect(6, 8, 148, 92); x.fillStyle = '#000'; x.fillRect(78, 8, 4, 92); });
def('brick', (x, w, h) => { fill(x, w, h, '#d6cbc2'); for (let r = 0; r < 16; r++) for (let c = -1; c < 9; c++) { x.fillStyle = `hsl(20,${14 + Math.random() * 8}%,${80 + Math.random() * 16}%)`; x.fillRect(c * 20 + (r % 2) * 10 + 1, r * 8 + 1, 18, 6); } });
def('brickwin', (x, w, h) => { for (let r = 0; r < 16; r++) for (let c = -1; c < 9; c++) { x.fillStyle = `hsl(20,${14 + Math.random() * 8}%,${80 + Math.random() * 16}%)`; x.fillRect(c * 20 + (r % 2) * 10 + 1, r * 8 + 1, 18, 6); } x.fillStyle = '#d6cbc2'; x.globalCompositeOperation = 'destination-over'; x.fillRect(0, 0, w, h); x.globalCompositeOperation = 'source-over'; x.fillStyle = '#fff'; x.fillRect(36, 74, 88, 8); pane(x, 44, 24, 72, 48, '#7a9bb3', '#ffffff'); }, x => pane(x, 44, 24, 72, 48, '#ffd277', '#000'));
def('tudor', (x, w, h) => { fill(x, w, h, '#f6f0e0'); x.strokeStyle = '#523826'; x.lineWidth = 7; x.strokeRect(3, 3, w - 6, h - 6); x.beginPath(); x.moveTo(0, 62); x.lineTo(w, 62); x.moveTo(80, 0); x.lineTo(80, 62); x.moveTo(0, 62); x.lineTo(40, 3); x.moveTo(w, 62); x.lineTo(120, 3); x.stroke(); pane(x, 20, 76, 44, 42, '#7a9bb3', '#523826'); pane(x, 96, 76, 44, 42, '#7a9bb3', '#523826'); }, x => { pane(x, 20, 76, 44, 42, '#ffd277', '#000'); pane(x, 96, 76, 44, 42, '#ffd277', '#000'); });
def('siding', (x, w, h) => { fill(x, w, h, '#f4f1e8'); x.fillStyle = 'rgba(0,0,0,.12)'; for (let y = 0; y < h; y += 8) x.fillRect(0, y, w, 2); x.fillStyle = '#b9c9b7'; x.fillRect(26, 34, 14, 66); x.fillRect(120, 34, 14, 66); pane(x, 44, 34, 72, 66, '#7a9bb3', '#fff'); }, x => pane(x, 44, 34, 72, 66, '#ffd277', '#000'));
def('slat', (x, w, h) => { for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#d9bf9a' : '#e7d0ad'; x.fillRect(i * 10, 0, 10, h); } x.fillStyle = 'rgba(0,0,0,.15)'; for (let i = 0; i < 16; i++) x.fillRect(i * 10, 0, 1, h); });
def('tile', (x, w, h) => { fill(x, w, h, '#d2d2d2'); x.fillStyle = 'rgba(0,0,0,.2)'; for (let y = 0; y < h; y += 12) x.fillRect(0, y, w, 2); x.fillStyle = 'rgba(0,0,0,.1)'; for (let y = 0; y < h; y += 12) for (let c = (y / 12 % 2) * 10; c < w; c += 20) x.fillRect(c, y, 2, 12); });
def('stripe', (x, w, h) => { for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#ffffff' : '#e0453a'; x.fillRect(i * 20, 0, 20, h); } });
def('sand', (x, w, h) => { fill(x, w, h, '#ead7a8'); x.fillStyle = 'rgba(120,90,40,.12)'; for (let y = 0; y < h; y += 32) x.fillRect(0, y, w, 2); x.fillStyle = '#f4e8c6'; x.fillRect(0, 0, 10, h); x.fillRect(w - 10, 0, 10, h);
  x.fillStyle = '#f7efd8'; x.beginPath(); x.rect(46, 48, 68, 70); x.arc(80, 48, 34, Math.PI, 0); x.fill();
  const g = x.createLinearGradient(54, 30, 106, 118); g.addColorStop(0, '#7a9bb3'); g.addColorStop(1, '#5d7f99'); x.fillStyle = g; x.beginPath(); x.rect(54, 48, 52, 66); x.arc(80, 48, 26, Math.PI, 0); x.fill();
  x.fillStyle = '#f7efd8'; x.fillRect(78, 22, 4, 92); x.fillRect(54, 70, 52, 4); }, x => { x.fillStyle = '#ffd277'; x.beginPath(); x.rect(54, 48, 52, 66); x.arc(80, 48, 26, Math.PI, 0); x.fill(); x.fillStyle = '#000'; x.fillRect(78, 22, 4, 92); x.fillRect(54, 70, 52, 4); });
def('stone', (x, w, h) => { fill(x, w, h, '#e6dcc0'); for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(90,70,30,${Math.random() * .07})`; x.fillRect(Math.random() * w, Math.random() * h, 4, 3); } x.fillStyle = '#bfb08c'; for (let r = 0; r < 4; r++) { x.fillRect(0, r * 32, w, 2); for (let c = (r % 2) * 40; c < w; c += 80) x.fillRect(c, r * 32, 2, 32); } });
// sign atlas
const SIGNS = ['GALLERY', 'ATELIER', 'BOOKS', 'BAKERY', 'STUDIO', 'POTTERY', 'DESIGN', 'ART HALL', 'TOY LAB', 'MUSIC', 'CAPY COFFEE', 'MAIN HALL',
  'IMMIGRATION', 'POST OFFICE', 'CITY HALL', 'BANK', 'LIBRARY', 'CAFE', 'POLICE', 'THEATER', 'MARKET', 'MUSEUM', 'HOTEL', 'SCHOOL',
  'CLASS A', 'CLASS B', 'CLASS C', 'CLASS D', 'DORM', 'CINEMA', 'GIFT SHOP', 'FLORIST', 'CONCERT HALL', 'CAFETERIA', 'HEYRI COFFEE 1970', 'INFO'];
const SC = 4, SR = Math.ceil(SIGNS.length / SC);
const signTex = mkTex(cv(1024, SR * 64, (x, w, h) => {
  const cols = ['#2f5d8a', '#8a3b2f', '#2f7a55', '#6b3f8a', '#b5651d', '#27666b', '#444'];
  SIGNS.forEach((n, i) => {
    const cx = (i % SC) * 256, cy = Math.floor(i / SC) * 64;
    x.fillStyle = cols[i % cols.length]; x.beginPath(); x.roundRect(cx + 3, cy + 3, 250, 58, 12); x.fill();
    x.strokeStyle = '#f3e3b8'; x.lineWidth = 3; x.stroke();
    x.fillStyle = '#fff6dc'; x.font = 'bold 34px Georgia,serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(n, cx + 128, cy + 34, 230);
  });
}), false);
const facadeMats = [];
const bmat = {};
function matFor(k) {
  if (bmat[k]) return bmat[k];
  if (k === 'signs') return bmat[k] = new THREE.MeshLambertMaterial({ map: signTex, vertexColors: true, side: THREE.DoubleSide });
  const t = TEX[k];
  const m = new THREE.MeshLambertMaterial({ map: t.map, vertexColors: true, side: THREE.DoubleSide, emissive: t.em ? 0xffffff : 0x000000, emissiveMap: t.em || null, emissiveIntensity: 0 });
  if (t.em) facadeMats.push(m);
  return bmat[k] = m;
}

/* ================= building kit (merged by texture) ================= */
const parts = {};
const _c = new THREE.Color();
function push(k, g, mtx, color) {
  if (g.index) g = g.toNonIndexed();
  g.applyMatrix4(mtx);
  const n = g.attributes.position.count, a = new Float32Array(n * 3); _c.set(color);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const nm of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(nm)) g.deleteAttribute(nm);
  (parts[k] ||= []).push(g);
}
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
function xf(cx, cy, cz, rot, lx = 0, ly = 0, lz = 0, ry = 0, rx = 0) {
  const base = new THREE.Matrix4().makeTranslation(cx, cy, cz).multiply(_m1.makeRotationY(rot));
  const loc = new THREE.Matrix4().makeTranslation(lx, ly, lz).multiply(_m2.makeRotationY(ry)).multiply(_m3.makeRotationX(rx));
  return base.multiply(loc);
}
function face(k, w, h, ux, uy, mtx, color) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ux, uv.getY(i) * uy);
  push(k, g, mtx, color);
}
const bays = (v, s) => Math.max(1, Math.round(v / s));
function bbox(o) {
  const { x, z, w, h, d, rot } = o, y = o.y || 0, col = o.color ?? 0xffffff, sk = o.side || 'plain', fk = o.front || sk;
  const ux = bays(w, BW), uy = bays(h, BH), ud = bays(d, BW);
  face(fk, w, h, ux, uy, xf(x, y, z, rot, 0, h / 2, d / 2), col);
  face(sk, w, h, ux, uy, xf(x, y, z, rot, 0, h / 2, -d / 2, Math.PI), col);
  face(sk, d, h, ud, uy, xf(x, y, z, rot, w / 2, h / 2, 0, Math.PI / 2), col);
  face(sk, d, h, ud, uy, xf(x, y, z, rot, -w / 2, h / 2, 0, -Math.PI / 2), col);
  if (o.top !== null) face(o.top || 'flat', w, d, Math.max(1, w / 6), Math.max(1, d / 6), xf(x, y, z, rot, 0, h, 0, 0, -Math.PI / 2), o.topColor ?? 0xffffff);
}
function gable(o) { // ridge along local x
  const { x, z, y, w, d, rh, rot } = o, ov = o.ov ?? .5, col = o.color ?? 0xffffff, gk = o.gableKey || 'plain', gc = o.gableColor ?? 0xffffff;
  const hh = d / 2 + ov, L = Math.hypot(hh, rh), phi = Math.atan2(rh, hh), a = -(Math.PI / 2 - phi);
  face('tile', w + 2 * ov, L, Math.max(1, (w + 2 * ov) / 3), Math.max(1, L / 2.4), xf(x, y, z, rot, 0, rh / 2, hh / 2, 0, a), col);
  face('tile', w + 2 * ov, L, Math.max(1, (w + 2 * ov) / 3), Math.max(1, L / 2.4), xf(x, y, z, rot + Math.PI, 0, rh / 2, hh / 2, 0, a), col);
  for (const s of [-1, 1]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([s * w / 2, 0, -hh, s * w / 2, 0, hh, s * w / 2, rh, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2 * hh / BW, 0, hh / BW, rh / BH], 2));
    g.computeVertexNormals(); push(gk, g, xf(x, y, z, rot), gc);
  }
}
function pyramid(o) {
  const { x, z, y, w, d, rh, rot } = o, col = o.color ?? 0xffffff, hw = w / 2 + (o.ov ?? .3), hd = d / 2 + (o.ov ?? .3);
  const c = [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd]];
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, 0, rh, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 3, 0, 1.5, 3], 2));
    g.computeVertexNormals(); push('tile', g, xf(x, y, z, rot), col);
  }
}
function cyl(o) { // vertical cylinder; k texture
  const { x, z, r, h, rot = 0 } = o, y = o.y || 0, g = new THREE.CylinderGeometry(r, o.r2 ?? r, h, o.seg || 16, 1, !!o.open), uv = g.attributes.uv;
  const ux = bays(2 * Math.PI * r, BW), uy = bays(h, BH);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ux, uv.getY(i) * uy);
  push(o.k || 'plain', g, xf(x, y + h / 2, z, rot), o.color ?? 0xffffff);
}
function sign(name, x, z, rot, lx, ly, lz, w = 3.4, ry = 0) {
  const i = Math.max(0, SIGNS.indexOf(name)), cx = i % SC, cy = Math.floor(i / SC);
  const g = new THREE.PlaneGeometry(w, w / 4), uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, (cx + uv.getX(k)) / SC, 1 - (cy + 1 - uv.getY(k)) / SR);
  push('signs', g, xf(x, 0, z, rot, lx, ly, lz, ry), 0xffffff);
}
function awning(x, z, rot, lx, ly, lz, w, col = 0xffffff) {
  const phi = .5, L = 1.5;
  face('stripe', w, L, Math.max(1, Math.round(w / 1.2)), 1, xf(x, 0, z, rot, lx, ly - L / 2 * Math.sin(phi), lz + L / 2 * Math.cos(phi), 0, -(Math.PI / 2 - phi)), col);
}
function plainBox(x, z, rot, lx, ly, lz, w, h, d, col, k = 'plain') {
  const [px, pz] = toW(x, z, rot, lx, lz); bbox({ x: px, z: pz, y: ly, w, h, d, rot, side: k, top: k === 'plain' ? 'plain' : 'flat', color: col, topColor: col });
}
function doorAt(x, z, rot, lx, lz, w = 1.5, h = 2.3, col = 0x6b4a33) { plainBox(x, z, rot, lx, 0, lz + .1, w, h, .25, col); }
function hedge(x, z, rot, lx, lz, w, d = 1.2, h = 1) { plainBox(x, z, rot, lx, 0, lz, w, h, d, pick([0x4f8f45, 0x5a9a4a, 0x437a3c])); }
function chimney(x, z, rot, lx, lz, y0, h = 2.4) { plainBox(x, z, rot, lx, y0, lz, .9, h, .9, 0x9c6b52, 'brick'); }
function flushAll() {
  for (const k of Object.keys(parts)) {
    const g = mergeGeometries(parts[k], false); if (!g) continue;
    const m = new THREE.Mesh(g, matFor(k)); m.castShadow = m.receiveShadow = true; scene.add(m);
  }
  for (const k of Object.keys(parts)) delete parts[k];
}

const bldgs = []; // [x,z,radius] for overlap tests
const PAL = [0xf4efe4, 0xe9d8b8, 0xd9a07a, 0xb8c9d6, 0xcfd9a8, 0xe8b6b0, 0xf2e2a0, 0xa9b4a0, 0xd8cfc4, 0xc7916b, 0x9fb7c9];
const ACC = [0xe8b04a, 0x4aa3a0, 0xd9604a, 0x6b8fd1, 0x9bbf6a, 0xe28bb0];
const ROOFC = [0x8a4b3a, 0x5f6b73, 0x7a5a45, 0x3f4a55, 0xa65a43];
const BRICKC = [0xc4604a, 0xb5543f, 0xcf7358, 0xa9654d];

/* ---------- Heyri-style (art village) buildings ---------- */
function heyriBuilding(x, z, w, d, h, rot, name, kind) {
  const wall = pick(PAL), acc = pick(ACC), roof = pick(ROOFC), df = d / 2;
  const fr = (lx, lz) => toW(x, z, rot, lx, lz);
  if (kind === 'modern') { // exposed-concrete / white gallery box with a glass front and a wood-slat accent
    bbox({ x, z, w, h, d, rot, side: 'concrete', front: 'glass', color: pick([0xf2f2ee, 0xe6e6e0, 0xd9d9d4]) });
    const [sx, sz] = fr(-w * .28, df + .06); bbox({ x: sx, z: sz, w: w * .3, h: h * .92, d: .12, rot, side: 'slat', top: null, color: 0xffffff });
    plainBox(x, z, rot, 0, h, 0, w + .6, .35, d + .6, 0x3b3f44);                     // roof slab
    plainBox(x, z, rot, 0, h + .35, 0, w * .4, 2.2, d * .5, 0xeeeeea, 'concrete');   // rooftop volume
    plainBox(x, z, rot, w * .25, 0, df + 1.2, w * .35, .3, 2.4, 0xcfcfca, 'concrete'); // canopy
    hedge(x, z, rot, w * .2, df + 2.6, w * .5);
  } else if (kind === 'brick') { // brick house with a gabled roof and chimney
    bbox({ x, z, w, h, d, rot, side: 'brickwin', front: 'brickwin', color: pick(BRICKC), top: null });
    gable({ x, z, y: h, w, d, rh: Math.min(w, d) * .35, rot, color: roof, gableKey: 'brick', gableColor: 0xc4604a });
    chimney(x, z, rot, w * .28, -df * .3, h + 1.5, 3);
    awning(x, z, rot, -w * .2, 2.7, df, 3.2, 0xffffff);
    hedge(x, z, rot, -w * .25, df + 1.4, w * .5);
  } else if (kind === 'stack') { // two offset volumes, upper one cantilevers
    bbox({ x, z, w, h, d, rot, side: 'win', front: 'win', color: wall });
    plainBox(x, z, rot, 0, h, 0, w + .5, .3, d + .5, 0x4a4a4a);
    const [ux, uz] = fr(w * .12, df * .25); const uh = h * .7;
    bbox({ x: ux, z: uz, y: h + .3, w: w * .62, h: uh, d: d * .8, rot, side: 'glass', front: 'glass', color: acc });
    plainBox(x, z, rot, w * .12, h + .3 + uh, df * .25, w * .62 + .5, .3, d * .8 + .5, 0x4a4a4a);
    hedge(x, z, rot, -w * .25, df + 1.6, w * .4);
  } else if (kind === 'cafe') { // coloured siding cafe with awning + signboard
    bbox({ x, z, w, h, d, rot, side: 'siding', front: 'siding', color: acc, top: null });
    gable({ x, z, y: h, w, d, rh: Math.min(w, d) * .3, rot, color: roof, gableKey: 'siding', gableColor: acc });
    awning(x, z, rot, 0, 2.9, df, Math.min(w * .8, 9), 0xffffff);
    chimney(x, z, rot, w * .3, 0, h + 1, 2.4);
    for (const s of [-1, 1]) { const [px, pz] = fr(s * w * .3, df + 2.2); cyl({ x: px, z: pz, r: .5, h: .08, y: .8, color: 0xf3e3b8 }); cyl({ x: px, z: pz, r: .06, h: .8, color: 0x555555 }); }
  } else { // round pavilion
    const r = Math.min(w, d) / 2;
    cyl({ x, z, r, h, k: 'win', color: wall, seg: 18 });
    cyl({ x, z, r: r + .5, h: .3, y: h, color: 0x44484d });
    cyl({ x, z, r: r * .55, h: 2.2, y: h + .3, color: acc });
    return;
  }
  if (name) sign(name, x, z, rot, 0, Math.min(h * .55, 4.4), df + .2, 3.4);
  doorAt(x, z, rot, 0, df, 1.5, 2.3);
}
function heyriFootprint(x, z, w, d, rot) { solid(x, z, w, d, rot); bldgs.push([x, z, Math.hypot(w, d) / 2 * .8]); }

/* ---------- Western / English-village buildings ---------- */
function westBuilding(kind, x, z, w, d, h, rot, name) {
  const df = d / 2, fr = (lx, lz) => toW(x, z, rot, lx, lz);
  if (kind === 'tudor') {
    bbox({ x, z, w, h, d, rot, side: 'tudor', front: 'tudor', color: 0xfbf3df, top: null });
    gable({ x, z, y: h, w, d, rh: d * .55, rot, color: 0x6b4a3a, gableKey: 'tudor', gableColor: 0xfbf3df, ov: .7 });
    chimney(x, z, rot, w * .32, 0, h + 2, 4); chimney(x, z, rot, -w * .32, 0, h + 2, 4);
    plainBox(x, z, rot, 0, 0, df + 1.1, 3.4, .25, 2.2, 0xbbb2a4, 'concrete');
  } else if (kind === 'georgian') {
    bbox({ x, z, w, h, d, rot, side: 'brickwin', front: 'brickwin', color: pick(BRICKC), top: null });
    plainBox(x, z, rot, 0, h - .6, 0, w + .6, .6, d + .6, 0xf2eee4);
    gable({ x, z, y: h, w, d, rh: d * .3, rot, color: 0x56606a, gableKey: 'brick', gableColor: 0xb5543f, ov: .5 });
    for (let i = -1; i <= 1; i += 2) plainBox(x, z, rot, i * 2.2, 0, df + 1.6, .55, h * .8, .55, 0xfaf7f0);
    plainBox(x, z, rot, 0, h * .8, df + 1.6, 6.2, .5, 2.4, 0xfaf7f0);
    chimney(x, z, rot, w * .35, 0, h + 1.5, 3);
  } else if (kind === 'clap') {
    const c = pick([0xcfe3ef, 0xf6e3a8, 0xdcead0, 0xf2cfd0, 0xe5d5ef]);
    bbox({ x, z, w, h, d, rot, side: 'siding', front: 'siding', color: c, top: null });
    gable({ x, z, y: h, w, d, rh: d * .38, rot, color: pick(ROOFC), gableKey: 'siding', gableColor: c, ov: .6 });
    awning(x, z, rot, 0, 3, df, Math.min(w * .7, 8), 0xffffff);
    plainBox(x, z, rot, 0, 0, df + 1.2, w * .7, .35, 2.4, 0xd7c7a7);
  } else { // victorian with a corner tower
    bbox({ x, z, w, h, d, rot, side: 'brickwin', front: 'brickwin', color: pick([0xd8c3a0, 0xcfa88d]), top: null });
    gable({ x, z, y: h, w, d, rh: d * .32, rot, color: 0x4a5560, gableKey: 'brick', gableColor: 0xd8c3a0 });
    const [tx, tz] = fr(-w / 2 + 2.6, df - .5);
    bbox({ x: tx, z: tz, y: 0, w: 5, h: h + 5, d: 5, rot, side: 'brickwin', front: 'brickwin', color: 0xd8c3a0, top: null });
    pyramid({ x: tx, z: tz, y: h + 5, w: 5, d: 5, rh: 5, rot, color: 0x3f4a55 });
  }
  if (name) sign(name, x, z, rot, 0, 4.6, df + .25, 4.4);
  doorAt(x, z, rot, 0, df, 1.7, 2.6, 0x4a3426);
}

/* ================= real OSM buildings (extruded footprints) ================= */
{
  const wallT = TEX.win.map.clone(); wallT.repeat.set(1 / 4, 1 / 3.2); wallT.needsUpdate = true;
  for (const b of MAP.buildings) {
    const pts = b.p.slice(0, -1); if (pts.length < 3) continue;
    const sh = new THREE.Shape(pts.map(q => new THREE.Vector2(q[0], -q[1])));
    const h = rr(6, 10);
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false }), new THREE.MeshLambertMaterial({ map: wallT, color: pick(PAL), side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.castShadow = m.receiveShadow = true; scene.add(m);
    const roof = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat(pick(ROOFC), { side: THREE.DoubleSide }));
    roof.rotation.x = -Math.PI / 2; roof.position.y = h + .02; scene.add(roof);
    const xs = pts.map(q => q[0]), zs = pts.map(q => q[1]), cx = xs.reduce((s, v) => s + v, 0) / pts.length, cz = zs.reduce((s, v) => s + v, 0) / pts.length;
    bldgs.push([cx, cz, Math.min(25, Math.max(...pts.map(q => Math.hypot(q[0] - cx, q[1] - cz))))]);
    const C = 4; for (let x = Math.min(...xs) + C / 2; x < Math.max(...xs); x += C) for (let z = Math.min(...zs) + C / 2; z < Math.max(...zs); z += C) if (polyIn(x, z, pts)) addCol(x, z, C * .74);
  }
}

/* ================= Paju English Village campus (traced from the reference map image) ================= */
const gateRot = Math.atan2(-gN[0], -gN[1]); // local +z of gate pieces faces outside
const CB = CP.blds;
const CREAM = 0xf0e4c4;
function domeAt(x, z, y, r, color) { push('plain', new THREE.SphereGeometry(r, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), xf(x, y, z, 0), color); }
function halfDisc(x, z, rot, lx, ly, lz, r, color) { push('plain', new THREE.CircleGeometry(r, 18, 0, Math.PI), xf(x, 0, z, rot, lx, ly, lz), color); }
function column(x, z, rot, lx, lz, h, r = .55) { const [px, pz] = toW(x, z, rot, lx, lz); cyl({ x: px, z: pz, r, h, color: CREAM, seg: 10 }); cyl({ x: px, z: pz, r: r * 1.45, h: .35, color: CREAM, seg: 10 }); cyl({ x: px, z: pz, r: r * 1.45, h: .35, y: h - .35, color: CREAM, seg: 10 }); }
function steps(x, z, rot, lz, w, n = 3) { for (let i = 0; i < n; i++) plainBox(x, z, rot, 0, i * .22, lz + (n - i) * .5, w, .22, .5, 0xd6c9ae, 'concrete'); }
function flagPole(x, z, rot, lx, lz, col) {
  const [px, pz] = toW(x, z, rot, lx, lz); cyl({ x: px, z: pz, r: .09, h: 9, color: 0xdddddd, seg: 6 });
  bbox({ x: px, z: pz, y: 7.2, w: 2.2, h: 1.4, d: .06, rot: rot + .5, side: 'plain', front: 'plain', color: col, top: null });
}

function concertHall(b) {
  const { x, z, w, d, rot } = b, df = d / 2, Wp = (lx, lz) => toW(x, z, rot, lx, lz);
  bbox({ x, z, w, h: 9, d, rot, side: 'sand', front: 'sand', top: null });
  plainBox(x, z, rot, 0, 9, 0, w + .8, .8, d + .8, 0xe2cd98);                                  // cornice
  const cw = w * .42, cd = d * .7;
  bbox({ x, z, y: 9.8, w: cw, h: 4.4, d: cd, rot, side: 'sand', front: 'sand', top: 'plain', topColor: 0xe2cd98 });
  const dr = Math.min(cw, cd) * .36;
  cyl({ x, z, r: dr, h: 2.8, y: 14.2, color: 0xe9d6a6, k: 'sand' });
  domeAt(x, z, 17, dr * 1.02, 0x9db3a2);                                                      // verdigris dome
  cyl({ x, z, r: .18, h: 3.2, y: 17 + dr * 1.02 - .2, color: 0x6c7b70, seg: 6 });
  const pz = df + 3.4;
  const k = Math.min(1.9, Math.max(1, w / 48));                                               // portico grows with the (very large) hall
  for (const i of [-1.5, -.5, .5, 1.5]) column(x, z, rot, i * 3.3 * k, pz, 8.6, .6 * Math.min(k, 1.4));
  plainBox(x, z, rot, 0, 8.6, pz, 13.6 * k, 1.3, 6.8, 0xe8d6aa);
  { const [gx, gz] = Wp(0, pz); gable({ x: gx, z: gz, y: 9.9, w: 6.8, d: 13.6 * k, rh: 2.6 * k, rot: rot + Math.PI / 2, color: 0xe8d6aa, gableKey: 'plain', gableColor: 0xeedcae, ov: .3 }); }
  steps(x, z, rot, df + 6.5, 12 * k);
  halfDisc(x, z, rot, 0, 5.6, df + .12, 2.5 * k, 0x9fb6c6);                                   // fan window
  doorAt(x, z, rot, 0, df, 3.2 * k, 3.6, 0x3d2a1e);
  sign('CONCERT HALL', x, z, rot, 0, 9.2, pz + 3.5, 6 * k);
  const [fx, fz] = Wp(0, df + 17);                                                            // fountain + brick circle
  cyl({ x: fx, z: fz, r: 4.2, h: .7, color: 0xdcd3c0, k: 'concrete' }); cyl({ x: fx, z: fz, r: .45, h: 3, color: 0xdcd3c0 }); cyl({ x: fx, z: fz, r: 1.5, h: .35, y: 2.2, color: 0xdcd3c0 });
  addCol(fx, fz, 4.3);
}
function mainHall(b) {
  const { x, z, w, d, rot } = b, df = d / 2, h = 13, Wp = (lx, lz) => toW(x, z, rot, lx, lz);
  bbox({ x, z, w, h, d, rot, side: 'sand', front: 'sand', top: null });
  plainBox(x, z, rot, 0, h, 0, w + .8, .9, d + .8, 0xe2cd98);
  for (const [lx, lz, bw, bd] of [[0, df + .2, w, .35], [0, -df - .2, w, .35], [w / 2 + .2, 0, .35, d], [-w / 2 - .2, 0, .35, d]]) plainBox(x, z, rot, lx, h + .9, lz, bw, 1, bd, 0xeee2bf);
  const pw = Math.min(w * .2, 13);
  for (const s of [-1, 1]) {                                                                  // corner pavilions, like the City Hall photo
    const [px, pz] = Wp(s * (w / 2 - pw / 2), 1.2);
    bbox({ x: px, z: pz, w: pw, h: h + 2.6, d: d + 2.4, rot, side: 'sand', front: 'sand', top: null });
    plainBox(px, pz, rot, 0, h + 2.6, 0, pw + .7, .8, d + 3.1, 0xe2cd98);
    pyramid({ x: px, z: pz, y: h + 3.4, w: pw, d: d + 2.4, rh: 3, rot, color: 0x56606a, ov: .5 });
  }
  const pz = df + 3.8;
  for (const i of [-2.5, -1.5, -.5, .5, 1.5, 2.5]) column(x, z, rot, i * 3.2, pz, 9.4, .62);
  plainBox(x, z, rot, 0, 9.4, pz, 19, 1.4, 7.6, 0xe8d6aa);
  { const [gx, gz] = Wp(0, pz); gable({ x: gx, z: gz, y: 10.8, w: 7.6, d: 19, rh: 3.3, rot: rot + Math.PI / 2, color: 0xe8d6aa, gableKey: 'plain', gableColor: 0xeedcae, ov: .3 }); }
  steps(x, z, rot, df + 7.4, 16, 4);
  doorAt(x, z, rot, 0, df, 3.4, 4.2, 0x3d2a1e);
  sign('MAIN HALL', x, z, rot, 0, 10.3, pz + 3.9, 7);
  for (const [i, c] of [[-.32, 0xd9283d], [0, 0xffffff], [.32, 0x2f5d8a]]) flagPole(x, z, rot, i * w, df + 13, c);
}
function dormBuilding(b) {
  const { x, z, w, d, rot } = b, df = d / 2, h1 = 7.6, Wp = (lx, lz) => toW(x, z, rot, lx, lz), brick = pick(BRICKC);
  bbox({ x, z, w, h: h1, d, rot, side: 'brickwin', front: 'brickwin', color: brick, top: null });
  bbox({ x, z, y: h1, w, h: 3.8, d, rot, side: 'sand', front: 'sand', color: 0xfff1d6, top: null });
  gable({ x, z, y: h1 + 3.8, w, d, rh: Math.min(d * .5, 5), rot, color: pick(ROOFC), gableKey: 'sand', gableColor: 0xfff1d6, ov: .4 });
  for (const s of [-1, 0, 1]) for (let i = 0; i < 3; i++) { const [gx, gz] = Wp(s * w * .3, df + .15); bbox({ x: gx, z: gz, y: h1 + 3.8 + i * 1.25, w: Math.max(1.2, w * .2 - i * 1.0), h: 1.25, d: .5, rot, side: 'sand', top: 'plain', color: 0xfff1d6 }); }
  for (const s of [-1, 1]) { const [bx, bz] = Wp(s * w * .24, df + .5); bbox({ x: bx, z: bz, w: 2.8, h: 3.6, d: 1.1, rot, side: 'glass', front: 'glass', color: 0xf2e8d0, top: 'plain', topColor: 0xeee2bf }); }
  const [px, pz] = Wp(0, df + 1.1); gable({ x: px, z: pz, y: 3.2, w: 3.4, d: 2.4, rh: .9, rot, color: 0x56606a, gableKey: 'plain', gableColor: 0xeee2bf, ov: .2 });
  doorAt(x, z, rot, 0, df, 1.7, 2.6, 0x4a3426); chimney(x, z, rot, w * .3, -df * .2, h1 + 3, 3);
}
function cafeteriaB(b) {
  const { x, z, w, d, rot, h } = b, df = d / 2;
  bbox({ x, z, w, h, d, rot, side: 'win', front: 'glass', color: 0xf6ecd0 });
  plainBox(x, z, rot, 0, h, 0, w + .8, .5, d + .8, 0xc9b88c);
  awning(x, z, rot, 0, 3.4, df, Math.min(w * .7, 12), 0xffffff);
  sign('CAFETERIA', x, z, rot, 0, h - 1.4, df + .2, 5);
  doorAt(x, z, rot, 0, df, 2.2, 2.6);
  for (const s of [-1, 1]) { const [px, pz] = toW(x, z, rot, s * w * .28, df + 3.4); cyl({ x: px, z: pz, r: .7, h: .08, y: .85, color: 0xf3e3b8 }); cyl({ x: px, z: pz, r: .07, h: .85, color: 0x555555 }); }
}
function sandBuilding(b, i) {
  const { x, z, w, d, rot, h } = b, df = d / 2, big = b.area > 280;
  bbox({ x, z, w, h, d, rot, side: 'sand', front: 'sand', top: null });
  if (i % 3 === 0) {
    gable({ x, z, y: h, w, d, rh: Math.min(w, d) * .3, rot, color: pick(ROOFC), gableKey: 'sand', gableColor: 0xefe0b4, ov: .6 });
  } else {
    plainBox(x, z, rot, 0, h, 0, w + .7, .7, d + .7, 0xe2cd98, 'plain');
    plainBox(x, z, rot, 0, h + .7, 0, w, .5, d, 0xcfcfc8, 'flat');
  }
  if (big) { for (const k of [-1, 1]) column(x, z, rot, k * Math.min(w * .12, 2.4), df + 1.8, h * .7, .4); plainBox(x, z, rot, 0, h * .7, df + 1.8, Math.min(w * .3, 7), .7, 3.4, 0xe8d6aa); }
  doorAt(x, z, rot, 0, df, 1.8, 2.6, 0x4a3426);
}
function funBuilding(b) {
  const { x, z, w, d, rot, h } = b, df = d / 2, c = pick(ACC);
  bbox({ x, z, w, h, d, rot, side: 'win', front: 'glass', color: c });
  plainBox(x, z, rot, 0, h, 0, w + 1, .6, d + 1, 0x4a4a4a);
  cyl({ x, z, r: Math.min(w, d) * .22, h: 1.4, y: h + .6, color: 0xffffff });
  awning(x, z, rot, 0, 3.2, df, Math.min(w * .6, 9), 0xffffff); doorAt(x, z, rot, 0, df, 2, 2.6);
}
function smallBuilding(b, name) {
  const { x, z, w, d, rot, h } = b, df = d / 2;
  bbox({ x, z, w, h, d, rot, side: 'brickwin', front: 'brickwin', color: 0xc4604a, top: null });
  gable({ x, z, y: h, w, d, rh: Math.min(w, d) * .35, rot, color: 0x56606a, gableKey: 'brick', gableColor: 0xc4604a });
  doorAt(x, z, rot, 0, df, 1.4, 2.2); if (name) sign(name, x, z, rot, 0, h * .7, df + .2, Math.min(3.2, w));
}
function polyBuilding(b, i) { // irregular (merged) footprints: extruded polygon with sandstone walls
  const pts = b.poly, sh = new THREE.Shape(pts.map(q => new THREE.Vector2(q[0], -q[1])));
  const tint = b.kind === 'fun' ? pick(ACC) : 0xffffff;
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: b.h, bevelEnabled: false }), new THREE.MeshLambertMaterial({ map: polyWall, color: tint, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.castShadow = m.receiveShadow = true; scene.add(m);
  const roof = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat(b.kind === 'fun' ? 0x4a4a4a : pick(ROOFC), { side: THREE.DoubleSide }));
  roof.rotation.x = -Math.PI / 2; roof.position.y = b.h + .03; scene.add(roof);
  const xs = pts.map(q => q[0]), zs = pts.map(q => q[1]), C = 4;
  for (let x = Math.min(...xs) + C / 2; x < Math.max(...xs); x += C) for (let z = Math.min(...zs) + C / 2; z < Math.max(...zs); z += C) if (polyIn(x, z, pts)) addCol(x, z, C * .74);
}
const polyWall = TEX.sand.map.clone(); polyWall.repeat.set(1 / 4, 1 / 3.2); polyWall.needsUpdate = true;

/* ----- ground: brick pavement, gardens ----- */
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const [roadImg, gardenImg] = await Promise.all([loadImg('road_mask.png?v=3'), loadImg('plaza_mask.png?v=3')]);
const TX = CP.tex;
const gardenData = (() => { const c = document.createElement('canvas'); c.width = TX.W; c.height = TX.H; const q = c.getContext('2d'); q.drawImage(gardenImg, 0, 0); return q.getImageData(0, 0, TX.W, TX.H).data; })();
const roadData = (() => { const c = document.createElement('canvas'); c.width = TX.W; c.height = TX.H; const q = c.getContext('2d'); q.drawImage(roadImg, 0, 0); return q.getImageData(0, 0, TX.W, TX.H).data; })();
const sampleMask = (d, x, z) => { const px = Math.floor((x - TX.x0) / (TX.x1 - TX.x0) * TX.W), py = Math.floor((z - TX.z0) / (TX.z1 - TX.z0) * TX.H); return px >= 0 && py >= 0 && px < TX.W && py < TX.H ? d[(py * TX.W + px) * 4 + 3] > 100 : false; };
const gardenAt = (x, z) => sampleMask(gardenData, x, z), campusRoadAt = (x, z) => sampleMask(roadData, x, z);
{
  const sc = 2, cw = TX.W * sc, ch = TX.H * sc, c = document.createElement('canvas'); c.width = cw; c.height = ch; const x = c.getContext('2d');
  const tinted = (img, fn) => { const t = document.createElement('canvas'); t.width = cw; t.height = ch; const q = t.getContext('2d'); q.drawImage(img, 0, 0, cw, ch); q.globalCompositeOperation = 'source-in'; fn(q); return t; };
  x.drawImage(tinted(gardenImg, q => { q.fillStyle = '#6fb85c'; q.fillRect(0, 0, cw, ch); }), 0, 0);
  const bt = document.createElement('canvas'); bt.width = 32; bt.height = 20; const bq = bt.getContext('2d');
  for (let r = 0; r < 4; r++) for (let k = -1; k < 3; k++) { bq.fillStyle = ['#b86a52', '#a95f48', '#c27a60', '#b0644c'][(r * 3 + k + 8) % 4]; bq.fillRect(k * 16 + (r % 2) * 8 + 1, r * 5 + 1, 14, 3.5); }
  bq.fillStyle = 'rgba(120,80,60,.35)'; for (let r = 0; r < 4; r++) bq.fillRect(0, r * 5, 32, 1);
  x.drawImage(tinted(roadImg, q => { q.fillStyle = '#d8c9a8'; q.fillRect(0, 0, cw, ch); }), 0, 0);               // beige base (acts as curb at the edges)
  x.drawImage(tinted(roadImg, q => { q.fillStyle = q.createPattern(bt, 'repeat'); q.fillRect(0, 0, cw, ch); }), 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(TX.x1 - TX.x0, TX.z1 - TX.z0), new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.rotation.x = -Math.PI / 2; m.position.set((TX.x0 + TX.x1) / 2, .045, (TX.z0 + TX.z1) / 2); m.receiveShadow = true; m.renderOrder = 1; scene.add(m);
}

/* ----- buildings ----- */
CB.forEach((b, i) => {
  if (b.poly) polyBuilding(b, i);
  else {
    if (b.kind === 'concert') concertHall(b);
    else if (b.kind === 'hall') mainHall(b);
    else if (b.kind === 'dorm') dormBuilding(b);
    else if (b.kind === 'cafeteria') cafeteriaB(b);
    else if (b.kind === 'fun') funBuilding(b);
    else if (b.kind === 'booth') smallBuilding(b, 'INFO');
    else if (b.kind === 'shop') smallBuilding(b, 'MARKET');
    else sandBuilding(b, i);
    solid(b.x, b.z, b.w, b.d, b.rot);
  }
  bldgs.push([b.x, b.z, Math.min(30, Math.hypot(b.w || 20, b.d || 20) / 2 * .8)]);
});
// name tags (shown when you are close)
const campusLabels = CP.labels.map(l => {
  const bh = l.b >= 0 ? CB[l.b].h : 4, s = label(l.n, '#c9731a', 11, 2.75); s.position.set(l.x, bh + 4, l.z); s.visible = false; scene.add(s); return { s, x: l.x, z: l.z };
});
// lake + open-air stage
{ const l = CP.labels.find(q => q.n === '야외공연장'); if (l) for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.RingGeometry(5 + i * 3.2, 7.8 + i * 3.2, 24, 1, Math.PI * .1, Math.PI * .8), mat(i % 2 ? 0xd8d2c4 : 0xc9c2b2, { side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI * .25; m.position.set(l.x, .1 + i * .18, l.z); m.receiveShadow = true; scene.add(m); } }

/* ----- walls + the castle-style main gate (beside 안내소) ----- */
const stoneT = TEX.stone.map;
{
  const P = CP.poly, segs = [], T0 = CP.tex;
  const onBorder = (a, b) => [[0, T0.x0], [0, T0.x1], [1, T0.z0], [1, T0.z1]].some(([ax, v]) => Math.abs(a[ax] - v) < 2.5 && Math.abs(b[ax] - v) < 2.5);
  const addWall = (a, b) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 3)), ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    for (let k = 0; k < n; k++) { const t = (k + .5) / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; if (Math.hypot(x - G[0], z - G[1]) < 6) continue; segs.push([x, z, ang, L / n]); }
  };
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; if (!onBorder(a, b)) addWall(a, b); }
  for (const s of [-1, 1]) { const a = [G[0] + gT[0] * s * 12.4, G[1] + gT[1] * s * 12.4], b = [G[0] + gT[0] * s * 60, G[1] + gT[1] * s * 60]; addWall(a, b); }
  const WH = 5.4;
  const wm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, WH, 1.3), new THREE.MeshLambertMaterial({ map: stoneT, color: 0xffffff }), segs.length);
  const mm2 = new THREE.InstancedMesh(new THREE.BoxGeometry(1.15, 1.25, 1.5), new THREE.MeshLambertMaterial({ map: stoneT, color: 0xffffff }), segs.length * 2);
  const o4 = new THREE.Object3D();
  segs.forEach(([x, z, ang, L], i) => {
    o4.position.set(x, WH / 2, z); o4.rotation.set(0, ang, 0); o4.scale.set(L * 1.02, 1, 1); o4.updateMatrix(); wm.setMatrixAt(i, o4.matrix);
    for (const k of [-1, 1]) { o4.position.set(x + Math.cos(ang) * k * L * .25, WH + .62, z - Math.sin(ang) * k * L * .25); o4.scale.set(1, 1, 1); o4.updateMatrix(); mm2.setMatrixAt(i * 2 + (k + 1) / 2, o4.matrix); }
    for (let c = 0; c < L; c += 1.5) addCol(x + Math.cos(ang) * (c - L / 2 + .75), z - Math.sin(ang) * (c - L / 2 + .75), .8);
  });
  wm.castShadow = wm.receiveShadow = true; mm2.castShadow = true; scene.add(wm, mm2);

  // gate: two round crenellated towers joined by an arched block with a portcullis
  const Gp = (lx, lz) => toW(G[0], G[1], gateRot, lx, lz);
  for (const s of [-1, 1]) {
    const tx = G[0] + gT[0] * s * 9, tz = G[1] + gT[1] * s * 9;
    cyl({ x: tx, z: tz, r: 3.7, h: 11.5, k: 'stone', color: 0xffffff, seg: 20 });
    cyl({ x: tx, z: tz, r: 4.1, h: .8, y: 11.5, color: 0xe0d3b0, seg: 20 });
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; bbox({ x: tx + Math.sin(a) * 3.85, z: tz + Math.cos(a) * 3.85, y: 12.3, w: 1.5, h: 1.4, d: 1.0, rot: a, side: 'stone', top: 'stone', color: 0xffffff }); }
    for (const yy of [3.6, 7.4]) for (const aa of [0, .6, -.6]) { const a = gateRot + aa; bbox({ x: tx + Math.sin(a) * 3.65, z: tz + Math.cos(a) * 3.65, y: yy, w: .45, h: 1.7, d: .3, rot: a, side: 'plain', top: null, color: 0x2a2a2a }); }
    addCol(tx, tz, 3.8);
    const [px, pz] = Gp(-s * 4.7, 0);                                                          // pier beside the opening
    bbox({ x: px, z: pz, w: 3.6, h: 10, d: 3.4, rot: gateRot, side: 'stone', front: 'stone', top: 'stone', color: 0xffffff }); solid(px, pz, 3.6, 3.4, gateRot);
  }
  { const [lx, lz] = Gp(0, 0); bbox({ x: lx, z: lz, y: 6.9, w: 5.8, h: 3.1, d: 3.4, rot: gateRot, side: 'stone', front: 'stone', top: 'stone', color: 0xffffff }); }
  for (let k = -3; k <= 3; k++) { const [mx_, mz_] = Gp(k * 1.7, 0); bbox({ x: mx_, z: mz_, y: 10, w: 1.1, h: 1.3, d: 3.6, rot: gateRot, side: 'stone', top: 'stone', color: 0xffffff }); }
  for (let k = -2; k <= 2; k++) { const [bx, bz] = Gp(k * 1.05, 0); bbox({ x: bx, z: bz, y: 4.6, w: .14, h: 2.4, d: .14, rot: gateRot, side: 'plain', top: null, color: 0x25272b }); }   // portcullis
  for (let yy = 5; yy <= 6.6; yy += .8) { const [bx, bz] = Gp(0, 0); bbox({ x: bx, z: bz, y: yy, w: 5.4, h: .12, d: .14, rot: gateRot, side: 'plain', top: null, color: 0x25272b }); }
  { const arch = new THREE.Mesh(new THREE.TorusGeometry(2.7, .3, 8, 24, Math.PI), new THREE.MeshLambertMaterial({ map: stoneT })); arch.position.set(G[0], 4.2, G[1]); arch.rotation.y = gateRot; scene.add(arch); }
  const gsMat = new THREE.MeshBasicMaterial({ map: mkTex(cv(1024, 230, (x, w, h) => { x.fillStyle = '#e8dcc0'; x.fillRect(0, 0, w, h); x.strokeStyle = '#8b7a55'; x.lineWidth = 8; x.strokeRect(6, 6, w - 12, h - 12); x.fillStyle = '#4a3a22'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 78px Georgia,serif'; x.fillText('PAJU ENGLISH VILLAGE', w / 2, 84, w - 60); x.font = 'bold 56px "Malgun Gothic",sans-serif'; x.fillText('경기영어마을 파주캠프', w / 2, 168, w - 60); }), false), side: THREE.DoubleSide });
  for (const side of [1, -1]) { const gs = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 1.9), gsMat); const [sx, sz] = Gp(0, side * 1.75); gs.position.set(sx, 8.4, sz); gs.rotation.y = gateRot + (side < 0 ? Math.PI : 0); scene.add(gs); }
  for (const s of [-1, 1]) { const [lx, lz] = Gp(s * 7.5, 6); cyl({ x: lx, z: lz, r: .12, h: 4.8, color: 0x2e3a3a, seg: 6 }); cyl({ x: lx, z: lz, r: .34, h: .5, y: 4.8, color: 0xfff1c4, seg: 8 }); addCol(lx, lz, .25); }
  { // immigration booth beside the officer
    const bx = G[0] + gN[0] * 7 - gT[0] * 4.5, bz = G[1] + gN[1] * 7 - gT[1] * 4.5, brot = Math.atan2(gN[0], gN[1]) + Math.PI;
    bbox({ x: bx, z: bz, w: 4.2, h: 3.4, d: 3.2, rot: brot, side: 'brickwin', front: 'brickwin', color: 0xc4604a, top: null });
    gable({ x: bx, z: bz, y: 3.4, w: 4.2, d: 3.2, rh: 1.3, rot: brot, color: 0x56606a, gableKey: 'brick', gableColor: 0xc4604a });
    sign('IMMIGRATION', bx, bz, brot, 0, 4.2, 1.7, 3.6); solid(bx, bz, 4.2, 3.2, brot); bldgs.push([bx, bz, 3]);
  }
}
const HALL = CB[CP.hall];
const hallF = [Math.sin(HALL.rot), Math.cos(HALL.rot)];

/* ================= Heyri coffee shop (mission 2) ================= */
let cafe = null;
{
  const target = nearestRoadPoint(CP.cafe[0], CP.cafe[1], 60), W = 11, D = 9, H = 5.5;
  const q = target || [CP.cafe[0], CP.cafe[1], 3];
  for (let a = 0; a < 16 && !cafe; a++) {
    const ang = a * Math.PI / 8, off = q[2] + 9, x = q[0] + Math.cos(ang) * off, z = q[1] + Math.sin(ang) * off;
    const rot = Math.atan2(q[0] - x, q[1] - z);
    if (roadDist(x, z, 12) < 6 || bldgs.some(b => Math.hypot(b[0] - x, b[1] - z) < b[2] + 9) || inWater(x, z) || inCampus(x, z)) continue;
    cafe = { x, z, rot, door: toW(x, z, rot, 0, D / 2 + 5) };
  }
  cafe ||= { x: q[0] + 12, z: q[1] + 12, rot: 0, door: [q[0] + 12, q[1] + 22] };
  const { x, z, rot } = cafe;
  heyriBuilding(x, z, W, D, H, rot, 'HEYRI COFFEE 1970', 'cafe'); heyriFootprint(x, z, W, D, rot);
  // giant coffee cup on the roof so it is easy to spot
  cyl({ x, z, r: 1.7, r2: 1.2, h: 2.4, y: H + 1.2, color: 0xffffff }); cyl({ x, z, r: 1.5, h: .1, y: H + 3.6, color: 0x5a3820 });
  for (let i = 0; i < 3; i++) cyl({ x: x + .2 * i, z, r: .25 - i * .04, h: .5, y: H + 3.9 + i * .7, color: 0xffffff, seg: 6 });
}

/* ================= filler buildings (OSM coverage is sparse) ================= */
{
  const kinds = new Set(['residential', 'unclassified', 'tertiary', 'living_street', 'secondary', 'service', 'pedestrian', 'track', 'footway']);
  const NAMES = ['GALLERY', 'ATELIER', 'BOOKS', 'BAKERY', 'STUDIO', 'POTTERY', 'DESIGN', 'ART HALL', 'TOY LAB', 'MUSIC', 'FLORIST', 'GIFT SHOP'];
  let n = 0;
  for (const r of MAP.roads) {
    if (!kinds.has(r.k)) continue;
    for (let i = 0; i < r.p.length - 1 && n < 440; i++) {
      const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      for (let t = rr(4, 14); t < L; t += rr(16, 26)) {
        for (const side of [-1, 1]) {
          if (rnd() < .3) continue;
          const w = rr(8, 16), d = rr(7, 13), h = rr(4.5, 9), off = (ROAD[r.k][0] / 2) + 3.5 + d / 2 + rr(0, 5);
          const x = ax + dx * t - dz * off * side, z = az + dz * t + dx * off * side;
          if (!inB(x, z, 25) || inCampus(x, z)) continue;
          if (roadDist(x, z, d) < d / 2 + 1.5) continue;
          if (bldgs.some(b => Math.hypot(b[0] - x, b[1] - z) < b[2] + Math.hypot(w, d) / 2 * .8 + 1)) continue;
          if (MAP.pois.some(s => Math.hypot(s.p[0] - x, s.p[1] - z) < 12) || inWater(x, z)) continue;
          const rotY = -Math.atan2(dz, dx) + (side > 0 ? Math.PI : 0);
          heyriBuilding(x, z, w, d, h, rotY, rnd() < .55 ? pick(NAMES) : null, pick(['modern', 'modern', 'brick', 'stack', 'cafe', 'round']));
          heyriFootprint(x, z, w, d, rotY); n++;
        }
      }
    }
  }
}
flushAll();

/* ================= trees, flowers ================= */
{
  const N = 1100, crown = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshLambertMaterial({ color: 0xffffff }), N);
  const crown2 = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }), N);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(.18, .26, 1, 6), mat(0x7a5535), N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  let k = 0, ci = 0, si = 0;
  for (let tries = 0; tries < 14000 && k < N; tries++) {
    const x = rr(BX0 + 8, BX1 - 8), z = rr(BZ0 + 8, BZ1 - 8);
    if (roadDist(x, z, 6) < 5 || bldgs.some(b => Math.hypot(b[0] - x, b[1] - z) < b[2] + 3) || inWater(x, z)) continue;
    if (inCampus(x, z) && (edgeDist(x, z, CP.poly) < 4 || campusRoadAt(x, z) || (gardenAt(x, z) ? rnd() < .25 : rnd() < .93))) continue;
    const h = rr(3.5, 7), pine = rnd() < .45;
    m4.compose(new THREE.Vector3(x, h * .2, z), q, new THREE.Vector3(1, h * .4, 1)); trunk.setMatrixAt(k, m4);
    if (pine) { m4.compose(new THREE.Vector3(x, h * .65, z), q, new THREE.Vector3(h * .28, h * .75, h * .28)); crown.setMatrixAt(ci, m4); c.setHSL(rr(.28, .36), .45, rr(.28, .38)); crown.setColorAt(ci++, c); }
    else { m4.compose(new THREE.Vector3(x, h * .72, z), q, new THREE.Vector3(h * .3, h * .3, h * .3)); crown2.setMatrixAt(si, m4); c.setHSL(rr(.18, .32), .5, rr(.36, .5)); crown2.setColorAt(si++, c); }
    addCol(x, z, .5); k++;
  }
  trunk.count = k; crown.count = ci; crown2.count = si;
  for (const m of [trunk, crown, crown2]) { m.castShadow = true; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; scene.add(m); }
}
{
  const N = 800, f = new THREE.InstancedMesh(new THREE.SphereGeometry(.18, 6, 4), new THREE.MeshLambertMaterial({ color: 0xffffff }), N);
  const m4 = new THREE.Matrix4(), c = new THREE.Color(), cols = [0xff8fa8, 0xffe066, 0xffffff, 0xc7a6ff]; let k = 0;
  for (let t = 0; t < 5000 && k < N; t++) {
    const x = rr(BX0, BX1), z = rr(BZ0, BZ1), d = roadDist(x, z, 8);
    if (d < 1 || d > 7 || bldgs.some(b => Math.hypot(b[0] - x, b[1] - z) < b[2] + 1) || inWater(x, z)) continue;
    m4.makeTranslation(x, .2, z); f.setMatrixAt(k, m4); c.set(cols[k % 4]); f.setColorAt(k++, c);
  }
  f.count = k; scene.add(f);
}

/* ================= clouds ================= */
const clouds = [];
for (let i = 0; i < 16; i++) {
  const g = new THREE.Group(), cm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .9 });
  for (let j = 0; j < 5; j++) { const s = new THREE.Mesh(new THREE.SphereGeometry(rr(10, 18), 8, 6), cm); s.position.set(j * 14 - 28, rr(-3, 3), rr(-6, 6)); s.scale.y = .6; g.add(s); }
  g.position.set(rr(BX0, BX1), rr(120, 170), rr(BZ0, BZ1)); scene.add(g); clouds.push({ g, cm });
}

/* ================= yuzu (collectibles) ================= */
const yuzus = [];
{
  const geo = new THREE.SphereGeometry(.4, 10, 8), m = new THREE.MeshLambertMaterial({ color: 0xffa726, emissive: 0x5a2c00 });
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(.14, 6, 4), mat(0x4e9a3a)); leaf.scale.set(1, .4, 1.6); leaf.position.set(0, .4, 0);
  let tries = 0;
  while (yuzus.length < 50 && tries++ < 4000) {
    const x = rr(BX0 + 20, BX1 - 20), z = rr(BZ0 + 20, BZ1 - 20), d = roadDist(x, z, 6);
    if (d > 4 || bldgs.some(b => Math.hypot(b[0] - x, b[1] - z) < b[2] + 2) || inWater(x, z)) continue;
    const y = new THREE.Mesh(geo, m); y.add(leaf.clone()); y.position.set(x, 1.1, z); y.castShadow = true; scene.add(y); yuzus.push({ m: y, got: false });
  }
}

/* ================= labels ================= */
function label(text, color, w = 14, h = 3.5) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d');
  x.fillStyle = 'rgba(255,248,232,.95)'; x.strokeStyle = color; x.lineWidth = 8;
  x.beginPath(); x.roundRect(6, 6, 500, 116, 40); x.fill(); x.stroke();
  x.fillStyle = '#4a3320'; x.font = 'bold 54px "Malgun Gothic",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 68, 460);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(w, h, 1); s.renderOrder = 10; return s;
}

/* ================= stamps (landmarks, labels only) ================= */
const STAMP_DEF = [['헤이리 공식 매표소', '헤이리 매표소', '여행의 시작! 오리가 입장권을 물고 왔어요.', -79.6], ['한립완구박물관', '한립완구박물관', '장난감 친구들이 반갑게 맞아줘요.'], ['플라잉카우', '플라잉카우', '날아다니는 소? 카피바라는 그냥 앉아서 구경해요.'], ['고막원', '고막원', '조용한 쉼터. 카피바라가 하품을 해요.'], ['한국근현대사박물관', '한국근현대사박물관', '오래된 시간들이 차곡차곡 쌓여 있어요.'], ['카메라타', '카메라타', '음악이 흘러나오는 마을의 귀.'], ['김정기 뮤지엄', '김정기 뮤지엄', '예술가의 숨결이 느껴지는 곳.'], ['물고기자리', '물고기자리', '연못 옆에서 잠깐 쉬어가요.']];
const stamps = STAMP_DEF.map(([n, name, blurb, px]) => { const q = MAP.pois.find(p => p.n.startsWith(n) && (px === undefined || Math.abs(p.p[0] - px) < 1)); return q ? { name, blurb, x: q.p[0], z: q.p[1], got: false } : null; }).filter(Boolean);
try { const s = JSON.parse(localStorage.getItem('heyri-stamps') || '[]'); stamps.forEach(t => t.got = s.includes(t.name)); } catch (e) { }
for (const s of stamps) {
  const g = new THREE.Group(); g.position.set(s.x, 0, s.z);
  s.ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, .2, 8, 28), new THREE.MeshBasicMaterial({ color: s.got ? 0x59c46a : 0xffb62e })); s.ring.rotation.x = Math.PI / 2; s.ring.position.y = .4; g.add(s.ring);
  s.sprite = label(s.name, '#f2a93b', 10, 2.5); s.sprite.position.y = 9; s.sprite.visible = false; g.add(s.sprite); scene.add(g);
}

/* ================= characters ================= */
const S = (r, sx, sy, sz, color, x, y, z) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat(color)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; return m; };
function makeCapy() {
  const g = new THREE.Group(), BR = 0xb07a45, DK = 0x6b4426, LT = 0xd9b383;
  g.add(S(.5, 1, .9, 1.45, BR, 0, .62, 0));
  g.add(S(.34, .95, .85, 1.3, BR, 0, .8, .66));
  g.add(S(.27, 1.05, .8, 1.15, LT, 0, .72, .98));
  g.add(S(.075, 1.5, .9, 1, 0x2b1a10, 0, .79, 1.27));
  for (const s of [-1, 1]) { g.add(S(.045, 1, 1, 1, 0x1d130c, s * .2, .9, .98)); g.add(S(.055, 1, 1.1, .7, DK, s * .22, 1.05, .45)); g.add(S(.17, 1, 1, 1, 0xc4915b, s * .27, .55, .3)); }
  g.legs = [];
  for (const [x, z] of [[-.28, .5], [.28, .5], [-.28, -.5], [.28, -.5]]) { const l = new THREE.Group(); l.position.set(x, .38, z); const m = new THREE.Mesh(new THREE.CylinderGeometry(.11, .1, .38, 8), mat(DK)); m.position.y = -.19; m.castShadow = true; l.add(m); g.add(l); g.legs.push(l); }
  g.add(S(.08, 1, 1, 1, DK, 0, .6, -.72));
  g.slot = new THREE.Object3D(); g.slot.position.set(0, 1.12, .5); g.add(g.slot);
  g.carry = new THREE.Group(); g.carry.position.set(0, 1.08, -.3); g.add(g.carry);
  return g;
}
/* 대장오리: chubby chick-like duck with a crown and a red cape (from the reference sheets) */
function makeDuck(o = {}) {
  const g = new THREE.Group(), Y = o.color ?? 0xffdf4d, Y2 = 0xffd12e, OR = 0xff9a2e, PK = 0xff9fb2, crown = o.crown ?? true, cape = o.cape ?? true;
  g.add(S(.27, 1, .95, 1.08, Y, 0, .29, 0));                         // round body
  g.add(S(.235, 1.08, 1, 1, Y, 0, .58, .07));                        // big head
  g.add(S(.15, 1.1, .8, .8, 0xfff2a6, 0, .32, .13));                 // pale belly
  for (const [i, h] of [[-1, .06], [0, .1], [1, .06]]) { const t = S(.03, 1, 2.2, 1, Y2, i * .045, .83 + h * .2, .05); t.rotation.z = -i * .45; g.add(t); } // head tuft
  for (const s of [-1, 1]) {
    g.add(S(.055, 1, 1.25, .55, 0x15100a, s * .11, .6, .27));        // big shiny eyes
    g.add(S(.017, 1, 1, 1, 0xffffff, s * .11 + .012, .63, .295));
    g.add(S(.052, 1.3, .8, .4, PK, s * .185, .52, .23));             // rosy cheeks
  }
  g.add(S(.062, 1.7, .55, 1.15, OR, 0, .535, .31));                  // beak
  g.add(S(.05, 1.4, .35, 1, 0xff8618, 0, .5, .31));
  g.wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(s * .27, .33, 0); w.add(S(.11, .35, 1, 1.3, Y2, s * .03, 0, 0)); g.add(w); g.wings.push(w);
    g.add(S(.065, 1.4, .3, 1.9, OR, s * .1, .03, .07));
  }
  g.add(S(.07, 1, 1, 1.3, Y, 0, .33, -.3));
  if (cape) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(.2, .36, .42, 16, 1, true, Math.PI * .12, Math.PI * 1.76), new THREE.MeshLambertMaterial({ color: 0xd9283d, side: THREE.DoubleSide }));
    c.position.set(0, .3, -.02); c.castShadow = true; g.add(c); g.cape = c;
    const fur = new THREE.Mesh(new THREE.TorusGeometry(.2, .055, 8, 18), mat(0xfffaf0)); fur.rotation.x = Math.PI / 2; fur.position.set(0, .49, 0); g.add(fur);
    const hem = new THREE.Mesh(new THREE.TorusGeometry(.35, .035, 6, 20, Math.PI * 1.76), mat(0xfffaf0)); hem.rotation.set(Math.PI / 2, 0, Math.PI * .12 - Math.PI / 2 + Math.PI); hem.position.set(0, .09, -.02); g.add(hem);
  }
  if (crown) {
    const cr = new THREE.Group(); cr.position.set(0, .83, .04);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(.095, .085, .06, 12, 1, true), new THREE.MeshLambertMaterial({ color: 0xffc928, emissive: 0x4a3200, side: THREE.DoubleSide })); cr.add(band);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2, p = new THREE.Mesh(new THREE.ConeGeometry(.026, .08, 5), new THREE.MeshLambertMaterial({ color: 0xffc928, emissive: 0x4a3200 })); p.position.set(Math.sin(a) * .09, .06, Math.cos(a) * .09); cr.add(p); }
    cr.add(S(.02, 1, 1, 1, 0xff4d6d, 0, .0, .092)); g.add(cr);
  }
  if (o.hat === 'cap') { const c = new THREE.Group(); c.position.set(0, .8, .05); c.add(S(.17, 1, .6, 1, 0x2f5d8a, 0, 0, 0)); c.add(S(.12, 1.3, .15, 1, 0x2f5d8a, 0, -.02, .15)); g.add(c); }
  if (o.hat === 'grad') { const c = new THREE.Group(); c.position.set(0, .83, .03); const b = new THREE.Mesh(new THREE.BoxGeometry(.34, .03, .34), mat(0x222222)); c.add(b); c.add(S(.1, 1, .6, 1, 0x222222, 0, -.03, 0)); c.add(S(.02, 1, 3, 1, 0xffc928, .15, -.05, .15)); g.add(c); }
  return g;
}

/* ================= actors ================= */
const gateIn = (k) => [G[0] + gN[0] * k, G[1] + gN[1] * k];
const capy = makeCapy(), duck = makeDuck({ crown: true, cape: true });
const spawn = gateIn(15);
capy.position.set(spawn[0], 0, spawn[1]); capy.rotation.y = Math.atan2(gN[0], gN[1]); scene.add(capy); capy.slot.add(duck); duck.scale.setScalar(1.18);
const npcs = [];
function addNPC(model, x, z, name, faceTo) {
  model.position.set(x, 0, z); scene.add(model); model.rotation.y = faceTo ?? 0;
  const l = model.isCapy ? label(name, '#6fae5c', 5, 1.25) : label(name, '#6fae5c', 2.6, .65); l.position.set(0, model.isCapy ? 2.4 : 1.25, 0); model.add(l);
  const n = { model, x, z, base: faceTo ?? 0 }; npcs.push(n); addCol(x, z, .6); return n;
}
const officerPos = [G[0] + gN[0] * 7 + gT[0] * 4.5, G[1] + gN[1] * 7 + gT[1] * 4.5];
const officer = addNPC(makeDuck({ crown: false, cape: false, color: 0xfff2c4, hat: 'cap' }), officerPos[0], officerPos[1], '입국심사 오리', Math.atan2(gN[0], gN[1]));
officer.model.scale.setScalar(2.1);
const hallFront = [HALL.x + hallF[0] * (HALL.d / 2 + 13), HALL.z + hallF[1] * (HALL.d / 2 + 13)];
const teacher = addNPC(makeDuck({ crown: false, cape: false, color: 0xffffff, hat: 'grad' }), hallFront[0] + hallF[1] * 3, hallFront[1] - hallF[0] * 3, '선생님 오리', Math.atan2(-hallF[0], -hallF[1]));
teacher.model.scale.setScalar(2.1);
const baristaModel = makeCapy(); baristaModel.isCapy = true; baristaModel.add(S(.22, 1, .55, 1, 0xffffff, 0, 1.14, .6)); baristaModel.scale.setScalar(.95);
const barista = addNPC(baristaModel, cafe.door[0], cafe.door[1], '바리스타 카피바라', Math.atan2(cafe.x - cafe.door[0], cafe.z - cafe.door[1]));

/* carried items */
function carryMesh(kind) {
  const g = new THREE.Group();
  if (kind === 'docs') { const b = new THREE.Mesh(new THREE.BoxGeometry(.45, .08, .32), mat(0xfffaf0)); g.add(b); const s = new THREE.Mesh(new THREE.CircleGeometry(.07, 10), mat(0xd9283d)); s.rotation.x = -Math.PI / 2; s.position.y = .045; g.add(s); }
  if (kind === 'passport') { const b = new THREE.Mesh(new THREE.BoxGeometry(.3, .1, .4), mat(0x2f5d8a)); g.add(b); const s = new THREE.Mesh(new THREE.CircleGeometry(.07, 10), mat(0xffc928)); s.rotation.x = -Math.PI / 2; s.position.y = .055; g.add(s); }
  if (kind === 'coffee') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(.7, .04, .4), mat(0x8b6b4a)));
    for (const x of [-.2, .2]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(.09, .07, .2, 10), mat(0xffffff)); c.position.set(x, .12, 0); g.add(c); const t = new THREE.Mesh(new THREE.CylinderGeometry(.085, .085, .02, 10), mat(0x5a3820)); t.position.set(x, .22, 0); g.add(t); }
  }
  g.traverse(o => o.castShadow = true); return g;
}
function setCarry(kind) { capy.carry.clear(); if (kind) capy.carry.add(carryMesh(kind)); P.carry = kind; }

/* ================= player state ================= */
const P = { path: null, pathLen: 0, mode: 'capy', vy: 0, speed: 0, yaw: capy.rotation.y, walk: 0, dir: [gN[0], gN[1]], carry: null };
const camS = { yaw: capy.rotation.y - Math.PI, pitch: .4, dist: 10 };
const keys = {}, joy = { x: 0, y: 0 };
let runToggle = false;
const ctl = () => P.mode === 'capy' ? capy : duck;
function swap() {
  if (P.mode === 'capy') { P.mode = 'duck'; scene.attach(duck); duck.scale.setScalar(2); duck.position.y = Math.max(duck.position.y, 1.6); P.vy = 5; P.yaw = capy.rotation.y; duck.rotation.y = P.yaw; }
  else { P.mode = 'capy'; capy.slot.add(duck); duck.position.set(0, 0, 0); duck.rotation.set(0, 0, 0); duck.scale.setScalar(1.18); P.vy = 0; P.yaw = capy.rotation.y; }
  $('#bSwap').classList.toggle('on', P.mode === 'duck'); updateStats();
}
$('#bSwap').onclick = swap;
addEventListener('keydown', e => {
  if (e.repeat && e.code !== 'Space') return;
  keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); swap(); }
  if (e.code === 'KeyP') $('#bPhoto').click();
  if (e.code === 'Enter') nextLine();
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => keys[e.code] = false);
$('#bPhoto').onclick = () => document.body.classList.toggle('hide-hud');
const ptrs = new Map(); let pinch0 = 0;
const cvs = renderer.domElement;
cvs.addEventListener('pointerdown', e => { ptrs.set(e.pointerId, [e.clientX, e.clientY]); cvs.setPointerCapture(e.pointerId); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
cvs.addEventListener('pointerup', e => ptrs.delete(e.pointerId)); cvs.addEventListener('pointercancel', e => ptrs.delete(e.pointerId));
cvs.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); camS.dist = Math.min(26, Math.max(4, camS.dist - (d - pinch0) * .03)); pinch0 = d; return; }
  camS.yaw -= (e.clientX - prev[0]) * .006; camS.pitch = Math.min(1.2, Math.max(.08, camS.pitch + (e.clientY - prev[1]) * .005));
});
addEventListener('wheel', e => { camS.dist = Math.min(26, Math.max(4, camS.dist + e.deltaY * .01)); }, { passive: true });
{ // touch joystick + buttons
  const st = $('#stick'), kn = $('#knob'); let sid = null;
  const setJ = e => { const r = st.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2); const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } joy.x = dx; joy.y = -dy; kn.style.transform = `translate(${dx * 35}px,${dy * 35}px)`; };
  st.addEventListener('pointerdown', e => { sid = e.pointerId; st.setPointerCapture(sid); setJ(e); e.preventDefault(); });
  st.addEventListener('pointermove', e => { if (e.pointerId === sid) setJ(e); });
  const end = e => { if (e.pointerId === sid) { sid = null; joy.x = joy.y = 0; kn.style.transform = ''; } };
  st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
  const jb = $('#tbJump'); jb.addEventListener('pointerdown', e => { keys.Space = true; jb.classList.add('down'); e.preventDefault(); }); const jEnd = () => { keys.Space = false; jb.classList.remove('down'); }; jb.addEventListener('pointerup', jEnd); jb.addEventListener('pointercancel', jEnd);
  const rb = $('#tbRun'); rb.addEventListener('pointerdown', e => { runToggle = !runToggle; rb.classList.toggle('down', runToggle); e.preventDefault(); });
}


/* ================= navigation: A* on a 2 m grid (tap-to-move, auto-guide) ================= */
const NC = 2, NW = Math.ceil((BX1 - BX0) / NC), NH = Math.ceil((BZ1 - BZ0) / NC);
const blockedG = new Uint8Array(NW * NH); let navReady = false;
const cellOf = (x, z) => [Math.floor((x - BX0) / NC), Math.floor((z - BZ0) / NC)];
function buildNav() {
  for (const arr of colHash.values()) for (const [x, z, r] of arr) {
    if (r < .1) continue;
    const e = r + .95, x0 = Math.floor((x - e - BX0) / NC), x1 = Math.floor((x + e - BX0) / NC), z0 = Math.floor((z - e - BZ0) / NC), z1 = Math.floor((z + e - BZ0) / NC);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      if (cx < 0 || cz < 0 || cx >= NW || cz >= NH) continue;
      if (Math.hypot(BX0 + (cx + .5) * NC - x, BZ0 + (cz + .5) * NC - z) < e) blockedG[cz * NW + cx] = 1;
    }
  }
  for (let cz = 0; cz < NH; cz++) for (let cx = 0; cx < NW; cx++) if (cx < 3 || cz < 3 || cx >= NW - 3 || cz >= NH - 3) blockedG[cz * NW + cx] = 1;
  navReady = true;
}
function findPath(sx, sz, gx_, gz_) {
  if (!navReady) buildNav();
  const free = (cx, cz) => cx >= 0 && cz >= 0 && cx < NW && cz < NH && !blockedG[cz * NW + cx];
  const nearest = (cx, cz) => { if (free(cx, cz)) return [cx, cz]; for (let r = 1; r < 16; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; if (free(cx + dx, cz + dz)) return [cx + dx, cz + dz]; } return null; };
  const a = nearest(...cellOf(sx, sz)), b = nearest(...cellOf(gx_, gz_)); if (!a || !b) return null;
  const N = NW * NH, g = new Float32Array(N).fill(1e9), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N), hf = [], hi = [];
  const hpush = (f, i) => { let k = hf.length; hf.push(f); hi.push(i); while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= hf[k]) break; [hf[p], hf[k]] = [hf[k], hf[p]]; [hi[p], hi[k]] = [hi[k], hi[p]]; k = p; } };
  const hpop = () => { const i = hi[0], lf = hf.pop(), li = hi.pop(); if (hf.length) { hf[0] = lf; hi[0] = li; let k = 0; for (; ;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < hf.length && hf[l] < hf[m]) m = l; if (r < hf.length && hf[r] < hf[m]) m = r; if (m === k) break; [hf[m], hf[k]] = [hf[k], hf[m]]; [hi[m], hi[k]] = [hi[k], hi[m]]; k = m; } } return i; };
  const h = (cx, cz) => { const dx = Math.abs(cx - b[0]), dz = Math.abs(cz - b[1]); return (dx + dz + (1.414 - 2) * Math.min(dx, dz)) * 1.08; };
  const si = a[1] * NW + a[0], gi = b[1] * NW + b[0]; g[si] = 0; hpush(h(a[0], a[1]), si);
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  let found = false, guard = 0;
  while (hf.length && guard++ < 700000) {
    const i = hpop(); if (closed[i]) continue; closed[i] = 1; if (i === gi) { found = true; break; }
    const cx = i % NW, cz = (i / NW) | 0;
    for (const [dx, dz, c] of D) {
      const nx = cx + dx, nz = cz + dz; if (!free(nx, nz)) continue;
      if (dx && dz && (!free(cx + dx, cz) || !free(cx, cz + dz))) continue;
      const ni = nz * NW + nx, ng = g[i] + c; if (ng < g[ni]) { g[ni] = ng; from[ni] = i; hpush(ng + h(nx, nz), ni); }
    }
  }
  if (!found) return null;
  const cells = []; for (let i = gi; i !== -1; i = from[i]) cells.push(i); cells.reverse();
  const pts = cells.map(i => ({ x: BX0 + ((i % NW) + .5) * NC, z: BZ0 + (((i / NW) | 0) + .5) * NC }));
  const los = (p, q) => { const L = Math.hypot(q.x - p.x, q.z - p.z), n = Math.ceil(L / 1); for (let k = 0; k <= n; k++) { const [cx, cz] = cellOf(p.x + (q.x - p.x) * k / n, p.z + (q.z - p.z) * k / n); if (!free(cx, cz)) return false; } return true; };
  const out = []; let i = 0; while (i < pts.length - 1) { let j = pts.length - 1; while (j > i + 1 && !los(pts[i], pts[j])) j--; out.push(pts[j]); i = j; }
  if (!out.length) out.push(pts[0]);
  if (free(...cellOf(gx_, gz_))) out[out.length - 1] = { x: gx_, z: gz_ };
  return out;
}
const tapMark = new THREE.Mesh(new THREE.RingGeometry(.7, 1.1, 24), new THREE.MeshBasicMaterial({ color: 0xff6f9f, side: THREE.DoubleSide, transparent: true, opacity: .9, depthWrite: false }));
tapMark.rotation.x = -Math.PI / 2; tapMark.position.y = .2; tapMark.visible = false; scene.add(tapMark);
function goTo(x, z, quiet) {
  const o = ctl().position, path = findPath(o.x, o.z, x, z);
  if (!path || !path.length) { if (!quiet) toast('그쪽으로는 갈 수 없어요', '벽이나 건물이 막고 있어요'); return false; }
  P.path = path; P.pathLen = path.reduce((s, q, k) => s + Math.hypot(q.x - (k ? path[k - 1].x : o.x), q.z - (k ? path[k - 1].z : o.z)), 0);
  tapMark.position.set(path.at(-1).x, .2, path.at(-1).z); tapMark.visible = true; return true;
}
function guide() {
  const st = curStep(); if (!st) { toast('🎉 모든 미션 완료', '안내할 목표가 없어요'); return; }
  const p = st.at(); if (goTo(p[0], p[1])) toast('🧭 자동 길안내', '조이스틱·키를 움직이면 멈춰요');
}
function vib(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { } }
$('#bGuide').onclick = guide;
if (!document.documentElement.requestFullscreen && !document.documentElement.webkitRequestFullscreen) $('#bFull').style.display = 'none';
$('#bFull').onclick = () => { const el = document.documentElement; if (document.fullscreenElement) document.exitFullscreen(); else (el.requestFullscreen || el.webkitRequestFullscreen).call(el); };
// tilt steering (phones)
let tiltOn = false, tiltBase = null; const tilt = { x: 0, y: 0 };
function onTilt(e) { if (e.beta == null) return; tiltBase ??= { b: e.beta, g: e.gamma }; const dx = (e.gamma - tiltBase.g) / 22, dy = -(e.beta - tiltBase.b) / 22; tilt.x = Math.abs(dx) < .18 ? 0 : Math.max(-1, Math.min(1, dx)); tilt.y = Math.abs(dy) < .18 ? 0 : Math.max(-1, Math.min(1, dy)); }
if (!TOUCH) $('#bTilt').style.display = 'none';
$('#bTilt').onclick = async () => {
  if (!tiltOn) {
    try { if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') { toast('기울이기 권한이 필요해요', '브라우저 설정에서 모션 센서를 허용해 주세요'); return; } } } catch (e) { }
    tiltBase = null; addEventListener('deviceorientation', onTilt); tiltOn = true; toast('📱 기울이기 모드', '지금 잡은 자세가 기준이에요. 폰을 기울이면 그쪽으로 걸어가요');
  } else { removeEventListener('deviceorientation', onTilt); tiltOn = false; tilt.x = tilt.y = 0; }
  $('#bTilt').classList.toggle('on', tiltOn);
};
// tap the ground to walk there
{
  let down = null; const rc = new THREE.Raycaster(), pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt = new THREE.Vector3();
  cvs.addEventListener('pointerdown', e => { down = ptrs.size === 1 ? { t: performance.now(), x: e.clientX, y: e.clientY } : null; });
  cvs.addEventListener('pointerup', e => {
    if (!down || performance.now() - down.t > 380 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) { down = null; return; }
    down = null; if (!started) return;
    rc.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    if (rc.ray.intersectPlane(pl, pt) && pt.x > BX0 && pt.x < BX1 && pt.z > BZ0 && pt.z < BZ1) { if (dlgOpen) return; if (goTo(pt.x, pt.z)) vib(8); }
  });
}

/* ================= time of day ================= */
const TOD = [
  { sky: 0x9fd8f5, hemiS: 0xffffff, hemiG: 0x88aa66, hi: 1.0, sunC: 0xfff4e0, si: 1.2, dir: [.5, 1, .35], fog: 420, glow: 0 },
  { sky: 0xf4b183, hemiS: 0xffd7b0, hemiG: 0x806040, hi: .75, sunC: 0xff9a55, si: 1.0, dir: [1, .35, .3], fog: 360, glow: .35 },
  { sky: 0x24305e, hemiS: 0x6270b8, hemiG: 0x3a4666, hi: 1.1, sunC: 0x9fb0ff, si: .6, dir: [-.4, 1, -.3], fog: 280, glow: 1 }
];
let tod = 0;
function setTime(i) {
  tod = i; const t = TOD[i];
  scene.background = new THREE.Color(t.sky); scene.fog = new THREE.Fog(t.sky, 40, t.fog);
  hemi.color.set(t.hemiS); hemi.groundColor.set(t.hemiG); hemi.intensity = t.hi; sun.color.set(t.sunC); sun.intensity = t.si;
  facadeMats.forEach(m => m.emissiveIntensity = t.glow);
  clouds.forEach(c => c.cm.color.set(i === 2 ? 0x4a5580 : i === 1 ? 0xffd9c0 : 0xffffff));
  document.querySelectorAll('#ctrl [data-t]').forEach(b => b.classList.toggle('on', +b.dataset.t === i));
}
document.querySelectorAll('#ctrl [data-t]').forEach(b => b.onclick = () => setTime(+b.dataset.t));
setTime(0);

/* ================= audio ================= */
let actx;
function chime(freqs, dur = .18) {
  try {
    actx ??= new AudioContext();
    freqs.forEach((f, i) => { const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * dur * .7; o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.18, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + dur * 2); o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur * 2); });
  } catch (e) { }
}

/* ================= dialog ================= */
let queue = [], dlgT = 0, dlgOpen = false, onDlgDone = null;
function say(lines, done) { queue = lines.slice(); onDlgDone = done || null; nextLine(); }
function nextLine() {
  clearTimeout(dlgT);
  const d = $('#dlg');
  if (!queue.length) { d.classList.remove('show'); dlgOpen = false; const f = onDlgDone; onDlgDone = null; f && f(); return; }
  const l = queue.shift(); dlgOpen = true;
  d.querySelector('.who').textContent = l.who; d.querySelector('.en').textContent = l.en; d.querySelector('.ko').textContent = l.ko;
  d.classList.add('show'); chime([740], .06);
  dlgT = setTimeout(nextLine, 5200);
}
$('#dlg').addEventListener('pointerdown', e => { nextLine(); e.stopPropagation(); });

/* ================= missions ================= */
const OFF = '입국심사 오리', TEA = '선생님 오리', BAR = '바리스타 카피바라';
const MISSIONS = [
  {
    title: '미션 1 · 정문 ↔ 본관 심부름', steps: [
      { text: '정문에 있는 입국심사 오리에게 가서 말 걸기', at: () => officerPos, r: 5.5, label: '입국심사 오리', run() { say([{ who: OFF, en: 'Welcome to Paju English Village!', ko: '파주영어마을에 온 걸 환영해요!' }, { who: OFF, en: 'Please take these documents to the Main Hall.', ko: '이 서류를 본관에 전달해 주세요. (큰 시계탑 건물이에요)' }]); setCarry('docs'); } },
      { text: '본관(Main Hall) 앞 선생님 오리에게 서류 전달하기', at: () => [teacher.x, teacher.z], r: 6.5, label: '본관', run() { say([{ who: TEA, en: 'Thank you! These documents are perfect.', ko: '고마워요! 서류가 완벽해요.' }, { who: TEA, en: 'Now, please bring this passport back to the gate.', ko: '이제 이 여권을 정문으로 가져다주세요.' }]); setCarry('passport'); } },
      {
        text: '정문으로 돌아가 입국심사 오리에게 여권 전달하기', at: () => officerPos, r: 5.5, label: '정문', run() {
          setCarry(null); say([{ who: OFF, en: 'Perfect! You are now an official visitor.', ko: '완벽해요! 이제 정식 방문객이에요.' }, { who: OFF, en: 'Could you buy us a coffee in Heyri Village? Try Heyri Coffee 1970, the café with a giant cup on its roof!', ko: '헤이리 마을에서 커피 좀 사다 줄래요? 지붕에 커다란 컵이 있는 헤이리커피 1970 카페예요!' }]);
        }
      }
    ]
  },
  {
    title: '미션 2 · 헤이리 마을 커피 배달', steps: [
      { text: '헤이리커피 1970에서 커피 받기', at: () => cafe.door, r: 6, label: '헤이리커피 1970', run() { say([{ who: BAR, en: 'One hot coffee for the Captain Duck? Here you go!', ko: '대장오리님 커피 나왔어요! 따뜻할 때 가져가세요!' }]); setCarry('coffee'); } },
      { text: '영어마을 정문으로 커피 배달하기', at: () => officerPos, r: 5.5, label: '정문', run() { setCarry(null); say([{ who: OFF, en: 'Wow, it is still warm! Thank you so much.', ko: '우와, 아직 따뜻해요! 정말 고마워요.' }, { who: OFF, en: 'You are a great traveler. See you again!', ko: '훌륭한 여행가네요. 또 만나요!' }], () => toast('🎉 모든 미션 완료!', '이제 자유롭게 영어마을과 헤이리를 산책해 보세요')); chime([523, 659, 784, 1046]); } }
    ]
  }
];
let MS = { m: 0, s: 0 };
try { const s = JSON.parse(localStorage.getItem('heyri-mission-v2') || 'null'); if (s && typeof s.m === 'number') MS = s; } catch (e) { }
function saveMission() { try { localStorage.setItem('heyri-mission-v2', JSON.stringify(MS)); localStorage.setItem('heyri-yuzu', yuzuCount); localStorage.setItem('heyri-stamps', JSON.stringify(stamps.filter(s => s.got).map(s => s.name))); } catch (e) { } }
function restoreCarry() { setCarry(MS.m === 0 && MS.s === 1 ? 'docs' : MS.m === 0 && MS.s === 2 ? 'passport' : MS.m === 1 && MS.s === 1 ? 'coffee' : null); }
const curStep = () => MISSIONS[MS.m]?.steps[MS.s];
function advance() {
  MS.s++;
  if (MS.s >= MISSIONS[MS.m].steps.length) { MS.m++; MS.s = 0; if (MISSIONS[MS.m]) setTimeout(() => toast('✅ 미션 완료!', MISSIONS[MS.m].title + ' 시작'), 600); }
  saveMission(); renderMission(); chime([660, 880, 1100]); vib([30, 40, 30]);
}
function renderMission() {
  const el = $('#mission'), st = curStep();
  if (!st) { el.innerHTML = '<div class="t">🎉 모든 미션 완료!</div><div class="s">자유롭게 산책하며 유자를 모아 보세요</div>'; return; }
  el.innerHTML = `<div class="t">${MISSIONS[MS.m].title}</div><div class="s">▶ ${st.text}</div><div class="d" id="mdist"></div>`;
}
$('#bReset').onclick = () => { MS = { m: 0, s: 0 }; setCarry(null); saveMission(); renderMission(); toast('↺ 미션을 처음부터 시작해요', '정문의 입국심사 오리에게 가 보세요'); };
let beaconPos = [0, 0];
const beacon = new THREE.Group();
{
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 60, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xff6f9f, transparent: true, opacity: .35, depthWrite: false, side: THREE.DoubleSide })); beam.position.y = 30;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3, .25, 8, 32), new THREE.MeshBasicMaterial({ color: 0xff3d7f })); ring.rotation.x = Math.PI / 2; ring.position.y = .4;
  beacon.add(beam, ring); beacon.userData = { beam, ring }; scene.add(beacon);
}

/* ================= HUD ================= */
let yuzuCount = 0;
try { yuzuCount = +localStorage.getItem('heyri-yuzu') || 0; } catch (e) { }
function updateStats() {
  $('#stats').innerHTML = `🍊 유자 ${yuzuCount}<br><small>지금 조종: ${P.mode === 'capy' ? '🐹 카피바라 (대장오리는 머리 위!)' : '🦆 대장오리 (카피바라가 따라와요)'}</small>`;
}
let toastT;
function toast(title, sub) { const t = $('#toast'); t.innerHTML = `${title}<div class="sub">${sub || ''}</div>`; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3400); }

// minimap
const mm = $('#mm'), mx = mm.getContext('2d'), MSC = 380 / (BX1 - BX0);
mm.width = 380; mm.height = Math.round((BZ1 - BZ0) * MSC);
const mX = x => (x - BX0) * MSC, mZ = z => (z - BZ0) * MSC;
const mmBase = document.createElement('canvas'); mmBase.width = mm.width; mmBase.height = mm.height;
{
  const c = mmBase.getContext('2d'); c.fillStyle = '#b9dd9b'; c.fillRect(0, 0, mm.width, mm.height);
  c.fillStyle = '#9ad47f'; c.strokeStyle = '#8a4b3a'; c.lineWidth = 2; c.beginPath(); CP.poly.forEach((q, i) => c[i ? 'lineTo' : 'moveTo'](mX(q[0]), mZ(q[1]))); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = '#7dc0e6'; for (const w of MAP.water) { c.beginPath(); w.forEach((q, i) => c[i ? 'lineTo' : 'moveTo'](mX(q[0]), mZ(q[1]))); c.fill(); }
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const r of MAP.roads) { const [w, col] = ROAD[r.k] || [3, 0xaaaaaa]; c.strokeStyle = '#' + col.toString(16).padStart(6, '0'); c.lineWidth = Math.max(1.5, w * MSC * 1.2); c.beginPath(); r.p.forEach((q, i) => c[i ? 'lineTo' : 'moveTo'](mX(q[0]), mZ(q[1]))); c.stroke(); }
  c.fillStyle = '#c9a77a'; for (const b of bldgs) c.fillRect(mX(b[0]) - 1.5, mZ(b[1]) - 1.5, 3, 3);
  c.fillStyle = '#1f4a7a'; c.font = 'bold 13px sans-serif'; c.fillText('영어마을', mX(640), mZ(520)); c.fillText('헤이리', mX(-200), mZ(60));
}
function drawMini() {
  mx.drawImage(mmBase, 0, 0);
  const st = curStep();
  if (st) { const p = st.at(); mx.fillStyle = '#ff3d7f'; mx.strokeStyle = '#fff'; mx.lineWidth = 3; mx.beginPath(); mx.arc(mX(p[0]), mZ(p[1]), 8 + Math.sin(time * 5) * 2, 0, 7); mx.fill(); mx.stroke(); }
  const o = ctl(); mx.save(); mx.translate(mX(o.position.x), mZ(o.position.z)); mx.rotate(-P.yaw + Math.PI);
  mx.fillStyle = '#2f7be0'; mx.strokeStyle = '#fff'; mx.lineWidth = 2.5; mx.beginPath(); mx.moveTo(0, -11); mx.lineTo(8, 9); mx.lineTo(0, 5); mx.lineTo(-8, 9); mx.closePath(); mx.fill(); mx.stroke(); mx.restore();
}

/* ================= main loop ================= */
const clock = new THREE.Clock(); let started = false, time = 0;
const tmpV = new THREE.Vector3();
function angLerp(a, b, t) { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; }
function step(dt) {
  time += dt;
  const o = ctl(), isDuck = P.mode === 'duck';
  const ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x + tilt.x;
  const iy = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + joy.y + tilt.y;
  const sy = Math.sin(camS.yaw), cy = Math.cos(camS.yaw);
  let mxv = -sy * iy + cy * ix, mzv = -cy * iy - sy * ix; let ml = Math.hypot(mxv, mzv), auto = false;
  if (ml > .08) { if (P.path) { P.path = null; tapMark.visible = false; } }
  else if (P.path) {
    while (P.path.length && Math.hypot(P.path[0].x - o.position.x, P.path[0].z - o.position.z) < 1.5) P.path.shift();
    if (!P.path.length) { P.path = null; tapMark.visible = false; }
    else {
      const w = P.path[0], ddx = w.x - o.position.x, ddz = w.z - o.position.z, dl = Math.hypot(ddx, ddz); mxv = ddx / dl; mzv = ddz / dl; ml = 1; auto = true;
      P.stuck = (P.stuck || 0) + dt;
      if (P.stuck > 1.6) {
        if (Math.hypot(o.position.x - (P.lastX ?? 1e9), o.position.z - (P.lastZ ?? 1e9)) < .5) { P.path = null; tapMark.visible = false; toast('길이 막혔어요', '다시 탭하거나 직접 움직여 주세요'); auto = false; ml = 0; }
        P.stuck = 0; P.lastX = o.position.x; P.lastZ = o.position.z;
      }
    }
  }
  if (!auto) P.stuck = 0;
  if (tapMark.visible) { tapMark.rotation.z = time * 2; tapMark.scale.setScalar(1 + Math.sin(time * 6) * .12); }
  const run = keys.ShiftLeft || keys.ShiftRight || runToggle || (auto && P.pathLen > 70);
  const target = ml > .08 ? (isDuck ? (run ? 13 : 7) : (run ? 11 : 5.5)) * Math.min(1, ml) : 0;
  P.speed += (target - P.speed) * Math.min(1, dt * 8);
  if (ml > .08) { mxv /= ml; mzv /= ml; P.yaw = angLerp(P.yaw, Math.atan2(mxv, mzv), Math.min(1, dt * 10)); P.dir = [mxv, mzv]; }
  const d = P.dir;
  if (P.speed > .05) { o.position.x += d[0] * P.speed * dt; o.position.z += d[1] * P.speed * dt; }
  o.position.x = Math.max(BX0 + 5, Math.min(BX1 - 5, o.position.x)); o.position.z = Math.max(BZ0 + 5, Math.min(BZ1 - 5, o.position.z));
  collide(o.position, isDuck ? .45 : .6);
  const grounded = o.position.y <= .001, g = isDuck && keys.Space && P.vy < 0 ? 5 : 22;
  if (keys.Space && grounded) { P.vy = isDuck ? 8 : 6.5; chime([isDuck ? 880 : 440], .08); }
  P.vy -= g * dt; o.position.y += P.vy * dt;
  if (o.position.y < 0) { o.position.y = 0; P.vy = 0; }
  o.rotation.y = P.yaw;
  P.walk += P.speed * dt * 1.6;
  const air = o.position.y > .05, sp = Math.min(1, P.speed / 5);
  if (!isDuck) {
    const sw = Math.sin(P.walk * 2.2) * sp * .7;
    capy.legs.forEach((l, i) => l.rotation.x = (i === 0 || i === 3 ? sw : -sw));
    capy.children[0].position.y = .62 + Math.abs(Math.sin(P.walk * 2.2)) * .04 * sp;
    capy.rotation.z = Math.sin(P.walk * 2.2) * .03 * sp;
    duck.position.y = Math.abs(Math.sin(P.walk * 2.2 + .6)) * .05 * sp + Math.sin(time * 2) * .01;
    duck.rotation.z = Math.sin(time * 1.3) * .08; duck.rotation.y = Math.sin(time * .6) * .5 * (P.speed < .5 ? 1 : .1);
    duck.wings.forEach((w, i) => w.rotation.z = (i ? -1 : 1) * (air ? Math.sin(time * 30) * .8 : Math.sin(time * 3) * .05));
  } else {
    duck.rotation.z = Math.sin(P.walk * 2.2) * .12 * sp;
    duck.wings.forEach((w, i) => w.rotation.z = (i ? -1 : 1) * (air ? Math.sin(time * 34) * .9 : Math.sin(time * 3) * .05));
    const dx = duck.position.x - capy.position.x, dz = duck.position.z - capy.position.z, dd = Math.hypot(dx, dz); let cs = 0;
    if (dd > 3.5) { cs = Math.min(8, (dd - 3.5) * 2.5 + 1); capy.position.x += dx / dd * cs * dt; capy.position.z += dz / dd * cs * dt; capy.rotation.y = angLerp(capy.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 6)); collide(capy.position, .6); }
    const sw = Math.sin(time * 9) * Math.min(1, cs / 3) * .7;
    capy.legs.forEach((l, i) => l.rotation.x = (i === 0 || i === 3 ? sw : -sw)); capy.rotation.z = 0; capy.children[0].position.y = .62;
  }
  if (duck.cape) duck.cape.rotation.x = Math.sin(time * 3) * .04 + (air ? .25 : 0) + sp * .12;
  // camera
  tmpV.set(o.position.x, o.position.y * .5 + (isDuck ? .9 : 1.3), o.position.z);
  const dist = camS.dist * (isDuck ? .7 : 1), cp = Math.cos(camS.pitch);
  const cdx = Math.sin(camS.yaw) * cp * dist, cdy = Math.sin(camS.pitch) * dist, cdz = Math.cos(camS.yaw) * cp * dist;
  let k = 1; for (; k > .15; k -= .05) if (!camBlocked(tmpV.x + cdx * k, tmpV.y + cdy * k, tmpV.z + cdz * k)) break;
  camera.position.set(tmpV.x + cdx * k, tmpV.y + cdy * k, tmpV.z + cdz * k); camera.position.y = Math.max(camera.position.y, .6); camera.lookAt(tmpV);
  const dir = TOD[tod].dir; sun.position.set(o.position.x + dir[0] * 80, dir[1] * 80, o.position.z + dir[2] * 80); sun.target.position.copy(o.position);
  // NPCs look at you when you are near
  for (const n of npcs) {
    const dx = o.position.x - n.x, dz = o.position.z - n.z, dd = Math.hypot(dx, dz);
    n.model.rotation.y = angLerp(n.model.rotation.y, dd < 14 ? Math.atan2(dx, dz) : n.base, Math.min(1, dt * 4));
    n.model.position.y = Math.abs(Math.sin(time * 2 + n.x)) * .03;
    if (n.model.wings) n.model.wings.forEach((w, i) => w.rotation.z = (i ? -1 : 1) * Math.sin(time * 3 + n.x) * .05);
  }
  // mission objective
  const st = curStep();
  if (st) {
    const p = st.at(), dxo = p[0] - o.position.x, dzo = p[1] - o.position.z, dd = Math.hypot(dxo, dzo);
    beacon.position.set(p[0], 0, p[1]); beacon.userData.beam.material.opacity = .3 + Math.sin(time * 3) * .1; beacon.userData.ring.rotation.z = time; beacon.visible = true;
    $('#target').textContent = `${st.label} · ${Math.round(dd)}m`; $('#arrow').style.opacity = 1;
    const ad = Math.atan2(dxo, dzo), af = camS.yaw + Math.PI; $('#arrow').style.transform = `rotate(${(af - ad) * 180 / Math.PI}deg)`;
    const md = $('#mdist'); if (md) md.textContent = `남은 거리 약 ${Math.round(dd)}m`;
    if (dd < st.r && o.position.y < 3 && !dlgOpen) { st.run(); advance(); }
  } else { beacon.visible = false; $('#target').textContent = '자유 산책 중'; $('#arrow').style.transform = 'rotate(0deg)'; $('#arrow').style.opacity = 0; }
  for (const l of campusLabels) l.s.visible = Math.hypot(l.x - o.position.x, l.z - o.position.z) < 55;
  // landmark labels
  for (const s of stamps) {
    const dd = Math.hypot(s.x - o.position.x, s.z - o.position.z); s.sprite.visible = dd < 90; s.ring.rotation.z = time;
    if (!s.got && dd < 7) { s.got = true; s.ring.material.color.set(0x59c46a); saveMission(); chime([660, 830, 990]); toast(`🏷 ${s.name}`, s.blurb); }
  }
  for (const y of yuzus) {
    if (y.got) continue; y.m.rotation.y = time * 2; y.m.position.y = 1.1 + Math.sin(time * 2 + y.m.position.x) * .15;
    if (Math.hypot(y.m.position.x - o.position.x, y.m.position.z - o.position.z) < 1.8 && o.position.y < 2.5) { y.got = true; y.m.visible = false; yuzuCount++; saveMission(); updateStats(); chime([1040, 1560], .1); vib(12); }
  }
  clouds.forEach((c, i) => { c.g.position.x += dt * (1.5 + i % 3 * .5); if (c.g.position.x > BX1 + 300) c.g.position.x = BX0 - 300; });
}
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(.05, clock.getDelta());
  if (started) step(dt);
  renderer.render(scene, camera);
  if (started) drawMini();
}
updateStats(); renderMission(); restoreCarry();
camera.position.set(spawn[0] - gN[0] * 10, 5, spawn[1] - gN[1] * 10); camera.lookAt(spawn[0], 1, spawn[1]);
loop();
const btn = $('#start'); btn.disabled = false; btn.textContent = '여행 시작!';
btn.onclick = () => { $('#intro').style.display = 'none'; started = true; chime([523, 659, 784]); toast('🐹🦆 파주영어마을 정문에 도착!', '분홍색 빛기둥과 화살표를 따라가 보세요'); };
window.__game = { CB, HALL, hallF, teacher, camS, setTime, swap, P, capy, duck, scene, MS, officer, teacher, cafe, G, gN, camera };
