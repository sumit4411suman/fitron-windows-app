// The 3D FITRON logo scene from the live site. One WebGL canvas behind the page; the logo locks
// onto each [data-logo-anchor] as it scrolls into view and drifts into the background between them.
import * as THREE from '/site/three.module.js';

function roomEnvironment() {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ metalness: 0, side: THREE.BackSide, color: 0x888888 }));
  room.position.set(-0.757, 13.219, 0.717); room.scale.set(31.713, 28.305, 28.591); scene.add(room);
  const light = (x, y, z, sx, sy, sz, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    m.material.color.setScalar(i); m.position.set(x, y, z); m.scale.set(sx, sy, sz); scene.add(m);
  };
  light(-16.116, 14.37, 8.208, 0.1, 2.428, 2.739, 50);
  light(-16.109, 18.021, -8.207, 0.1, 2.425, 2.751, 50);
  light(14.904, 12.198, -1.832, 0.15, 4.265, 6.331, 17);
  light(-0.462, 8.89, 14.52, 4.38, 5.441, 0.088, 43);
  light(3.235, 11.486, -12.541, 2.5, 2.0, 0.1, 20);
  light(0.0, 20.0, 0.0, 1.0, 0.1, 1.0, 100);
  const l = new THREE.PointLight(0xffffff, 900, 28, 2); l.position.set(0.418, 16.199, 0.3); scene.add(l);
  return scene;
}

export function start(canvas) {
  const root = document.documentElement;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lowPower = coarse && (navigator.hardwareConcurrency || 4) <= 4;
  let renderer = null;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { console.warn('[FITRON] WebGL unavailable, showing the flat logo instead.'); return; }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0e0d0a, 42, 78);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  cam.position.set(0, 0, 40);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(roomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const gold = new THREE.MeshStandardMaterial({ color: 0xe9c463, metalness: 1, roughness: 0.24 });
  const deep = new THREE.MeshStandardMaterial({ color: 0xb98b2e, metalness: 1, roughness: 0.34 });
  const SEG = lowPower ? 14 : 24;
  const P = (x, y) => new THREE.Vector3((x - 512) / 100, -(y - 512) / 100, 0);
  const UP = new THREE.Vector3(0, 1, 0);
  const geoCache = new Map();
  const sphereGeo = (r) => { if (!geoCache.has(r)) geoCache.set(r, new THREE.SphereGeometry(r, SEG, Math.round(SEG * 0.66))); return geoCache.get(r); };
  function stroke(pts, r, mat, group) {
    const v = pts.map(([x, y]) => P(x, y));
    v.forEach((a, i) => {
      const joint = new THREE.Mesh(sphereGeo(r), mat); joint.position.copy(a); group.add(joint);
      if (i < v.length - 1) {
        const b = v[i + 1];
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), SEG, 1, true), mat);
        seg.position.copy(a).add(b).multiplyScalar(0.5);
        seg.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
        group.add(seg);
      }
    });
  }
  function plate(x, y, radius, length, mat, group) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, SEG * 2), mat);
    m.rotation.z = Math.PI / 2; m.position.copy(P(x, y)); group.add(m);
  }
  const pivot = new THREE.Group(), logo = new THREE.Group();
  pivot.add(logo); scene.add(pivot);
  const F = new THREE.Group();
  stroke([[395, 668], [395, 315], [636, 315]], 0.23, gold, F);
  stroke([[422, 490], [468, 490], [490, 420], [525, 578], [560, 490], [622, 490]], 0.155, gold, F);
  plate(652, 315, 0.5, 0.42, deep, F);
  logo.add(F);
  const dumbbell = new THREE.Group();
  stroke([[404, 745], [620, 745]], 0.12, deep, dumbbell);
  plate(393, 745, 0.37, 0.32, gold, dumbbell); plate(630, 745, 0.37, 0.32, gold, dumbbell);
  plate(352, 745, 0.23, 0.24, deep, dumbbell); plate(671, 745, 0.23, 0.24, deep, dumbbell);
  logo.add(dumbbell);
  const ringMain = new THREE.Mesh(new THREE.TorusGeometry(3.82, 0.055, 16, lowPower ? 120 : 220), gold);
  const ringInner = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.016, 8, lowPower ? 120 : 220), deep);
  logo.add(ringMain, ringInner);
  const arcsTilt = new THREE.Group(), arcs = new THREE.Group();
  [[14, 30], [50, 32], [100, 30], [136, 32], [194, 30], [230, 32], [280, 30], [316, 32]].forEach(([s, len]) => {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(4.15, 0.045, 10, 60, THREE.MathUtils.degToRad(len)), deep);
    arc.rotation.z = THREE.MathUtils.degToRad(s); arcs.add(arc);
  });
  [[90, 0.2], [0, 0.13], [180, 0.13], [270, 0.17]].forEach(([deg, r]) => {
    const dot = new THREE.Mesh(sphereGeo(r), gold), t = THREE.MathUtils.degToRad(deg);
    dot.position.set(Math.cos(t) * 4.15, Math.sin(t) * 4.15, 0); arcs.add(dot);
  });
  arcsTilt.add(arcs); logo.add(arcsTilt);
  const LOGO_D = 8.9;

  const N = lowPower ? 90 : coarse ? 150 : 280;
  const base = new Float32Array(N * 3), pos = new Float32Array(N * 3), speed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    base[i * 3] = (Math.random() - 0.5) * 48; base[i * 3 + 1] = Math.random() * 32; base[i * 3 + 2] = -30 + Math.random() * 26;
    speed[i] = 0.15 + Math.random() * 0.4;
  }
  const dotTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,240,200,1)'); grad.addColorStop(0.35, 'rgba(233,196,99,.7)'); grad.addColorStop(1, 'rgba(233,196,99,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.34, map: dotTex, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending })));
  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(6, 10, 12); scene.add(key);
  const glint = new THREE.PointLight(0xffdc96, 3, 0, 0); glint.position.set(0, 0, 14); scene.add(glint);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas); resize();

  let px = 0, py = 0, sx = 0, sy = 0;
  addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; px = e.clientX / innerWidth - 0.5; py = e.clientY / innerHeight - 0.5; }, { passive: true });
  let scrollPos = scrollY, lastScroll = scrollY, twist = 0;
  addEventListener('scroll', () => { scrollPos = scrollY; }, { passive: true });

  const cur = { x: 0, y: 0, z: 0, s: 1, rx: 0, ry: 0, e: 0, rt: 0 }, tgt = { ...cur };
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  let first = true;
  function computeTarget(t) {
    const anchors = document.querySelectorAll('[data-logo-anchor]');
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const viewH = 2 * cam.position.z * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), k = viewH / ch;
    const wide = cw >= 900;
    const bg = { x: wide ? viewH * cam.aspect * 0.36 : 0, y: wide ? -viewH * 0.08 : viewH * 0.06, z: wide ? -24 : -32, s: wide ? 1.5 : 1.3,
      rx: 0.4 + Math.sin(scrollPos * 0.0011) * 0.35, ry: Math.sin(scrollPos * 0.0009 + t * 0.08) * 1.1, e: 1, rt: 1 };
    let best = null, bestVis = 0, br = null;
    for (const a of anchors) {
      const r = a.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= ch || r.width === 0) continue;
      const vis = (Math.min(r.bottom, ch) - Math.max(r.top, 0)) / Math.min(r.height, ch);
      if (vis > bestVis) { bestVis = vis; best = a; br = r; }
    }
    let w = 0, at = bg;
    if (best) {
      w = smooth(0.25, 0.9, bestVis);
      const sway = reduce ? 0 : Math.sin(t * 0.5) * 0.2;
      at = { x: (br.left + br.width / 2 - cw / 2) * k, y: -(br.top + br.height / 2 - ch / 2) * k, z: 0, s: (br.width * k) / LOGO_D,
        rx: sy * 0.55 + (reduce ? 0 : Math.sin(t * 0.37) * 0.06), ry: sx * 0.85 + sway,
        e: parseFloat(best.dataset.explode) || 0, rt: parseFloat(best.dataset.rings) || 0 };
    }
    const wPos = smooth(0, 0.35, w);
    for (const k2 in tgt) { const mix = k2 === 'x' || k2 === 'y' ? wPos : w; tgt[k2] = bg[k2] + (at[k2] - bg[k2]) * mix; }
    return w;
  }

  const clock = new THREE.Clock();
  let skip = false, t = 0;
  function frame() {
    requestAnimationFrame(frame);
    if (lowPower && (skip = !skip)) return;
    const dt = Math.min(0.05, clock.getDelta()); t += dt;
    if (coarse) { px = Math.sin(t * 0.3) * 0.25; py = Math.cos(t * 0.23) * 0.15; }
    sx += (px - sx) * 0.06; sy += (py - sy) * 0.06;
    const attached = computeTarget(t);
    const f = first ? 1 : (attached > 0.5 ? 0.22 : 0.08);
    for (const k2 in cur) cur[k2] += (tgt[k2] - cur[k2]) * f;
    first = false;
    const dScroll = scrollPos - lastScroll; lastScroll = scrollPos;
    if (!reduce) twist = Math.max(-0.9, Math.min(0.9, twist * 0.93 + dScroll * 0.0009));
    pivot.position.set(cur.x, cur.y, cur.z); pivot.scale.setScalar(cur.s);
    logo.rotation.set(cur.rx, cur.ry + twist, 0);
    logo.position.y = reduce ? 0 : Math.sin(t * 1.1) * 0.08;
    const e = cur.e;
    F.position.z = e * 1.8; dumbbell.position.set(0, -e * 0.6, e * 2.8);
    ringMain.rotation.x = e * 0.9 + cur.rt * 0.5; ringMain.rotation.y = cur.rt * 0.25;
    ringInner.position.z = -e * 1.0; ringInner.rotation.y = e * 0.8 + cur.rt * 0.6;
    arcsTilt.position.z = -e * 2.0; arcsTilt.rotation.x = -cur.rt * 0.45;
    if (!reduce) arcs.rotation.z += dt * 0.12;
    const scrollShift = scrollPos * 0.006;
    for (let i = 0; i < N; i++) {
      const depth = (base[i * 3 + 2] + 30) / 26;
      let y = base[i * 3 + 1] + (reduce ? 0 : t * speed[i]) + scrollShift * (0.4 + depth);
      y = ((y % 32) + 32) % 32 - 16;
      pos[i * 3] = base[i * 3] + (reduce ? 0 : Math.sin(t * 0.2 + i) * 0.3); pos[i * 3 + 1] = y; pos[i * 3 + 2] = base[i * 3 + 2];
    }
    dustGeo.attributes.position.needsUpdate = true;
    glint.position.set(sx * 34, -sy * 22, 14);
    canvas.style.opacity = (0.18 + 0.82 * Math.min(1, Math.max(0, (attached - 0.15) / 0.6))).toFixed(3);
    renderer.render(scene, cam);
    if (!root.classList.contains('has-3d')) root.classList.add('has-3d');
  }
  requestAnimationFrame(frame);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); root.classList.remove('has-3d'); });
  canvas.addEventListener('webglcontextrestored', () => root.classList.add('has-3d'));
}
