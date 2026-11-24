/* Car wrap scene (v2): a 3D iPad drops in back-first and turns to the viewer, the pencil draws the car in four views,
   the wrap colours fill in, then the tablet lifts up and forward and the wrapped 3D car that was hiding behind it turns.
   The page script calls window.cw3d.update(P, stageRect, boxRect) on every scroll frame (boxRect = where the tablet rests).
   3D models: "2018 Renault Megane R.S. Trophy 300" by adrianaflak09, CC BY 4.0 (repainted white, wrap projected on);
   iPad Pro, converted to glTF and re-materialled. */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const A = 'assets/print/car-wrap/3d/', V = 'assets/print/car-wrap/';
const canvas = document.getElementById('cw-3d'), scene3 = document.getElementById('cw-scene');
if (canvas && scene3) {
  const small = innerWidth < 821, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = {args: null, ready: false, started: false};
  window.cw3d = {state, update: (...a) => { state.args = a; if (state.ready) draw(); }};

  /* ---------- timeline (scroll progress of the whole scene) ---------- */
  const T = {enter: [.14, .26], draw: [.27, .52], paint: [.53, .62], lift: [.63, .74], dolly: [.64, .8], orbit: [.8, .95], out: [.955, .985]};

  /* ---------- where the graphics sit on the car (measured against the mockups) ---------- */
  const MAP = {
    side: {u: [0.23995, 0.43530], v: [-0.31150, 0.44874]},
    hood: {k: 5.2e-4, logoZ: -1.86, centreY: 1473},
    back: {px0: 350, py0: 272.2, s: 339, k: .2163, ox: 1.4, oy: -43, clipY: -.06}
  };

  /* ---------- SVG artwork -> canvases ---------- */
  const fontCss = async () => {   // the slogan is live text; Montserrat Black stands in for the original font
    const b = await (await fetch('assets/fonts/Montserrat-Black-static.woff2')).arrayBuffer();
    let s = ''; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return `@font-face{font-family:'ft40-Roman';src:url(data:font/woff2;base64,${btoa(s)}) format('woff2');}`;
  };
  const loadSvg = async (url, box, css = '') => {
    let t = await (await fetch(url)).text();
    t = t.replace(/viewBox="[^"]*"/, `viewBox="${box.join(' ')}" width="${box[2]}" height="${box[3]}"`);
    if (css) t = t.replace(/<style type="text\/css">/, `<style type="text/css">${css}`);
    // Illustrator export bug: a nested opacity mask reuses its parent's id and is never applied
    const ids = [...t.matchAll(/<mask[^>]*id="([^"]+)"/g)].map(m => m[1]);
    ids.filter((id, i) => ids.indexOf(id) !== i).forEach((id, n) => {
      const tag = `id="${id}"`, i = t.lastIndexOf(tag), nid = `fixMask${n}`;
      t = t.slice(0, i) + `id="${nid}"` + t.slice(i + tag.length);
      const e = t.indexOf('</mask>', i) + 7, p = t.indexOf('<path', e);
      if (p > 0 && !/style=/.test(t.slice(p, t.indexOf('>', p)))) t = t.slice(0, p) + `<path style="mask:url(#${nid})"` + t.slice(p + 5);
    });
    return t;
  };
  const svgImage = async t => { const im = new Image(); im.src = URL.createObjectURL(new Blob([t], {type: 'image/svg+xml'})); await im.decode(); return im; };
  const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
  const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  async function splitKeep(svgText, box, keeps) {
    const host = document.createElement('div'); host.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px;overflow:hidden;opacity:0;pointer-events:none';
    host.innerHTML = svgText; document.body.appendChild(host);
    const svg = host.querySelector('svg'); svg.setAttribute('width', box[2] / 10); svg.setAttribute('height', box[3] / 10);
    const root = svg.getScreenCTM().inverse();
    const rootBox = el => { const b = el.getBBox(), m = root.multiply(el.getScreenCTM()); const p = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      const xs = p.map(q => q.x), ys = p.map(q => q.y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
    const inside = (b, r) => b[0] >= r[0] - 2 && b[1] >= r[1] - 2 && b[2] <= r[0] + r[2] + 2 && b[3] <= r[1] + r[3] + 2 && b[2] > b[0];
    const kept = [];
    const walk = el => { for (const c of el.children) { const tag = c.tagName.toLowerCase(); if (['defs', 'style', 'clippath', 'lineargradient', 'radialgradient', 'mask', 'symbol'].includes(tag)) continue;
      let b; try { b = rootBox(c); } catch (e) { continue; }
      if (keeps.some(r => inside(b, r))) { kept.push(c); continue; } if (tag === 'g') walk(c); } };
    walk(svg);
    svg.setAttribute('width', box[2]); svg.setAttribute('height', box[3]);
    const ser = () => { svg.querySelectorAll('clipPath, mask, defs').forEach(e => e.setAttribute('visibility', 'visible')); return new XMLSerializer().serializeToString(svg); };
    kept.forEach(k => k.setAttribute('visibility', 'hidden')); const base = ser();
    kept.forEach(k => k.setAttribute('visibility', 'visible'));
    [...svg.children].forEach(c => { if (!['defs', 'style'].includes(c.tagName.toLowerCase())) c.setAttribute('visibility', 'hidden'); });
    const keepOnly = ser(); host.remove();
    return {base, keepOnly};
  }
  async function buildSide(css, W) {
    const box = [3721, -6773, 7203, 5548], s = W / box[2], H = Math.round(box[3] * s);
    const t = await loadSvg(A + 'Side-Graphic.svg', box, css);
    const badgeBox = [160, 1123, 3680, 750], badgeAt = [4629, -4421, 531, 108];
    const badge = await svgImage(await loadSvg(A + 'Side-Logo.svg', badgeBox));
    const keeps = [[5845, -4335, 2085, 495], [5800, -3900, 2130, 300], [8865, -4505, 870, 250]];
    const px = r => [(r[0] - box[0]) * s, (r[1] - box[1]) * s, r[2] * s, r[3] * s];
    const mir = r => { const p = px(r); return [W - p[0] - p[2], p[1], p[2], p[3]]; };
    const L = canvasOf(W, H), lx = L.getContext('2d');
    lx.drawImage(await svgImage(t), 0, 0, W, H); lx.drawImage(badge, ...px(badgeAt));
    const sp = await splitKeep(t, box, keeps);
    const R = canvasOf(W, H), rx = R.getContext('2d');
    rx.save(); rx.translate(W, 0); rx.scale(-1, 1); rx.drawImage(await svgImage(sp.base), 0, 0, W, H); rx.restore();
    const kc = canvasOf(W, H); kc.getContext('2d').drawImage(await svgImage(sp.keepOnly), 0, 0, W, H);
    for (const r of keeps) { const a = px(r), b = mir(r); rx.drawImage(kc, a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]); }
    rx.drawImage(badge, ...mir(badgeAt));
    return {L, R};
  }
  const HOOD_LOGO = {clip: 'SVGID_00000137107320397185680950000011473513099710035596_', cx: 1143.6, cy: 1512.5, k: .93};
  const shrinkHoodLogo = t => { const i = t.lastIndexOf('<g>', t.indexOf('id="' + HOOD_LOGO.clip + '"')), e = t.lastIndexOf('</g>'), {cx, cy, k} = HOOD_LOGO;
    return t.slice(0, i) + `<g transform="translate(${cx} ${cy}) scale(${k}) translate(${-cx} ${-cy})">` + t.slice(i, e) + '</g>' + t.slice(e); };
  async function buildPlain(url, box, W, edit = t => t) {
    const s = W / box[2], c = canvasOf(W, Math.round(box[3] * s));
    c.getContext('2d').drawImage(await svgImage(edit(await loadSvg(url, box))), 0, 0, c.width, c.height); return c;
  }

  /* ---------- the tablet screen: the client's car pictures traced line by line, then the finished wrap mock-up ---------- */
  // sheet3-plain: Megane_Front, Megane_Back and Megane_Side (twice, one mirrored and larger) laid out exactly as in Megane_Project;
  // sheet3-wrap: Megane_Project itself; sheet3-own: which car owns each pixel (red = id * 60). r = box as fractions of the sheet width
  const SHEET = {w: 2000, h: 1249, views: [
    {id: 1, r: [.0109, .376, .6964, .2361]},    // big side view
    {id: 2, r: [.1022, .0308, .3462, .2361]},   // front
    {id: 3, r: [.5298, .0109, .3452, .2569]},   // rear
    {id: 4, r: [.4514, .3105, .504, .1736]}]};  // small side view
  const SCW = small ? 1600 : 2048, SCH = Math.round(SCW * .69283 / .92753);
  const SC = canvasOf(SCW, SCH), sx = SC.getContext('2d');
  const BG = canvasOf(SCW, SCH);
  // where the sheet sits on the screen (below the app bar)
  const area = {x: SCW * .055, y: SCH * .2, w: SCW * .89, h: SCH * .74};
  const sk = Math.min(area.w / SHEET.w, area.h / SHEET.h), sw = SHEET.w * sk, shh = SHEET.h * sk;
  const sheetAt = {x: area.x + (area.w - sw) / 2, y: area.y + (area.h - shh) / 2 + SCH * .01, k: sk};
  const viewPx = v => [sheetAt.x + v.r[0] * SHEET.w * sk, sheetAt.y + v.r[1] * SHEET.w * sk, v.r[2] * SHEET.w * sk, v.r[3] * SHEET.w * sk];
  let lines = [], layers = null, shadows = null;

  function paintBackground() {
    const x = BG.getContext('2d'), u = SCW / 1000;
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, SCW, SCH);
    // faint dot grid, like a drawing app canvas
    x.fillStyle = 'rgba(17,17,20,.07)';
    for (let gy = SCH * .17; gy < SCH * .985; gy += 22 * u) for (let gx = SCW * .02; gx < SCW * .985; gx += 22 * u) x.fillRect(gx, gy, 1.6 * u, 1.6 * u);
    // status bar + app bar
    x.fillStyle = '#1c1c1e'; x.font = `600 ${13 * u}px -apple-system,"Segoe UI",Montserrat,sans-serif`; x.textBaseline = 'middle';
    x.fillText('9:41', SCW * .035, SCH * .035);
    x.textAlign = 'right'; x.fillText('100%', SCW * .93, SCH * .035); x.textAlign = 'left';
    x.strokeStyle = '#1c1c1e'; x.lineWidth = 1.5 * u; const bx = SCW * .938, by = SCH * .035 - 5.5 * u;
    x.beginPath(); x.roundRect(bx, by, 22 * u, 11 * u, 3 * u); x.stroke(); x.fillRect(bx + 2 * u, by + 2 * u, 16 * u, 7 * u);
    const pill = (px, w, draw) => { x.fillStyle = 'rgba(242,242,245,.95)'; x.beginPath(); x.roundRect(px, SCH * .075, w, SCH * .07, SCH * .035); x.fill();
      x.strokeStyle = 'rgba(0,0,0,.06)'; x.lineWidth = u; x.stroke(); draw(px); };
    pill(SCW * .03, 300 * u, px => { x.fillStyle = '#1c1c1e'; x.font = `600 ${15 * u}px -apple-system,"Segoe UI",Montserrat,sans-serif`; x.fillText('‹   Wrap · all views', px + 18 * u, SCH * .11); });
    pill(SCW * .97 - 190 * u, 190 * u, px => {
      [0, 1, 2].forEach(i => { x.beginPath(); const cx = px + 30 * u + i * 40 * u; if (i === 2) x.roundRect(cx - 9 * u, SCH * .11 - 9 * u, 18 * u, 18 * u, 4 * u); else x.arc(cx, SCH * .11, 9 * u, 0, 7);
        x.strokeStyle = '#3a3a3e'; x.lineWidth = 1.6 * u; x.stroke(); if (i === 0) { x.fillStyle = '#1c1c1e'; x.fill(); } });
      const g = x.createConicGradient(0, px + 150 * u, SCH * .11); ['#f5c400', '#1c1c1e', '#c9cad0', '#f5c400'].forEach((c, i) => g.addColorStop(i / 3, c));
      x.beginPath(); x.arc(px + 150 * u, SCH * .11, 10 * u, 0, 7); x.fillStyle = g; x.fill(); });
  }
  function paintScreen(dr, col) {
    sx.drawImage(BG, 0, 0);
    const u = SCW / 1000;

    // pencil lines
    sx.lineCap = 'round'; sx.lineJoin = 'round'; sx.strokeStyle = '#26262b';
    let tip = null;
    for (const l of lines) {
      const t = clamp((dr - l.s) / (l.e - l.s)); if (t <= 0) continue;
      const P = l.p, n = Math.max(2, Math.ceil(P.length * t));
      sx.lineWidth = l.w * u; sx.beginPath(); sx.moveTo(P[0][0], P[0][1]);
      for (let i = 1; i < n; i++) sx.lineTo(P[i][0], P[i][1]);
      sx.stroke();
      if (t < 1 && (!tip || l.s > tip.s)) tip = {s: l.s, x: P[n - 1][0], y: P[n - 1][1]};
    }
    // wrap colours wipe in view by view, with the site's yellow scan line on the edge
    // (each car is a masked layer of the mock-up, so overlapping cars stay clean)
    if (layers && col > 0) {
      SHEET.views.forEach((v, i) => {
        const c = clamp((col - i * .15) / .5); if (c <= 0) return;
        const [x, y, w, h] = viewPx(v), lx = x - sheetAt.x, ly = y - sheetAt.y, L = layers[i];
        sx.drawImage(L, lx, ly, w * c, h, x, y, w * c, h);
        if (c < 1) { sx.fillStyle = 'rgba(255,210,31,.9)'; sx.fillRect(x + w * c - 2 * u, y - 4 * u, 4 * u, h + 8 * u); }
      });
      // finally the soft floor shadows of the mock-up
      const sh = clamp((col - .88) / .12);
      if (sh > 0) { sx.save(); sx.globalAlpha = sh; sx.globalCompositeOperation = 'multiply'; sx.drawImage(shadows, sheetAt.x, sheetAt.y); sx.restore(); }
    }
    screenTex.needsUpdate = true;
    return tip;
  }

  // line work traced from the plain sheet (same Canny-style tracer as the first version)
  function trace(img, own) {
    const W = small ? 1100 : 1400, H = Math.round(img.naturalHeight * W / img.naturalWidth);
    const c = canvasOf(W, H), x = c.getContext('2d', {willReadFrequently: true});
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(img, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data, N = W * H, k = [1, 4, 6, 4, 1];
    let g = new Float32Array(N);
    for (let i = 0; i < N; i++) g[i] = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2];
    const blur = a => { const t = new Float32Array(N), o = new Float32Array(N);
      for (let y = 0; y < H; y++) for (let X = 0; X < W; X++) { let s = 0; for (let j = -2; j <= 2; j++) s += k[j + 2] * a[y * W + Math.min(W - 1, Math.max(0, X + j))]; t[y * W + X] = s / 16; }
      for (let y = 0; y < H; y++) for (let X = 0; X < W; X++) { let s = 0; for (let j = -2; j <= 2; j++) s += k[j + 2] * t[Math.min(H - 1, Math.max(0, y + j)) * W + X]; o[y * W + X] = s / 16; }
      return o; };
    g = blur(blur(g));
    const mag = new Float32Array(N), dir = new Uint8Array(N);
    for (let y = 1; y < H - 1; y++) for (let X = 1; X < W - 1; X++) { const i = y * W + X;
      const gx = -g[i - W - 1] - 2 * g[i - 1] - g[i + W - 1] + g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1];
      const gy = -g[i - W - 1] - 2 * g[i - W] - g[i - W + 1] + g[i + W - 1] + 2 * g[i + W] + g[i + W + 1];
      mag[i] = Math.hypot(gx, gy) / 4; let a = Math.atan2(gy, gx) * 180 / Math.PI; if (a < 0) a += 180;
      dir[i] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3; }
    const nms = new Float32Array(N), off = [[1, 0], [1, 1], [0, 1], [-1, 1]];
    for (let y = 1; y < H - 1; y++) for (let X = 1; X < W - 1; X++) { const i = y * W + X, [dx, dy] = off[dir[i]], m = mag[i];
      if (m >= mag[i + dy * W + dx] && m >= mag[i - dy * W - dx]) nms[i] = m; }
    const HI = 34, LO = 13, e = new Uint8Array(N), st = [], nb = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
    for (let i = 0; i < N; i++) if (nms[i] >= HI) { e[i] = 2; st.push(i); }
    while (st.length) { const i = st.pop(); for (const o of nb) { const j = i + o; if (j > 0 && j < N && !e[j] && nms[j] >= LO) { e[j] = 2; st.push(j); } } }
    const seen = new Uint8Array(N), chains = [], order = [-W, 1, W, -1, -W - 1, -W + 1, W - 1, W + 1];
    const count = i => { let n = 0; for (const o of nb) if (e[i + o] === 2) n++; return n; };
    const follow = s => { const pts = [s]; seen[s] = 1; let cur = s;
      for (;;) { let nx = -1; for (const o of order) { const j = cur + o; if (e[j] === 2 && !seen[j]) { nx = j; break; } } if (nx < 0) break; seen[nx] = 1; pts.push(nx); cur = nx; }
      return pts; };
    for (let pass = 0; pass < 2; pass++) for (let i = W; i < N - W; i++) if (e[i] === 2 && !seen[i] && (pass || count(i) === 1)) { const p = follow(i); if (p.length >= 8) chains.push(p); }
    const rdp = (P, eps) => { if (P.length < 3) return P; let mx = 0, id = 0; const a = P[0], b = P[P.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      for (let i = 1; i < P.length - 1; i++) { const dd = Math.abs(dy * P[i][0] - dx * P[i][1] + b[0] * a[1] - b[1] * a[0]) / L; if (dd > mx) { mx = dd; id = i; } }
      return mx > eps ? rdp(P.slice(0, id + 1), eps).slice(0, -1).concat(rdp(P.slice(id), eps)) : [a, b]; };
    // to screen pixels, grouped by view; per view the long outlines first (left to right), then the details
    const toScr = sheetAt.k * SHEET.w / W, per = SHEET.views.map(() => []);
    for (const ch of chains) {
      const P = rdp(ch.map(i => [i % W, (i / W) | 0]), .75).map(([X, Y]) => [sheetAt.x + X * toScr, sheetAt.y + Y * toScr]);
      let cx = 0, cy = 0, minx = 1e9; for (const q of P) { cx += q[0]; cy += q[1]; minx = Math.min(minx, q[0]); } cx /= P.length; cy /= P.length;
      // the car a line belongs to = the car that owns most of the pixels just inside it
      const votes = [0, 0, 0, 0, 0];
      for (let i = 0; i < ch.length; i += 3) { const X = ch[i] % W, Y = (ch[i] / W) | 0, ox = Math.round(X * own.w / W), oy = Math.round(Y * own.h / H);
        for (const [dx, dy] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]]) votes[own.at(ox + dx, oy + dy)]++; }
      let vid = 0; for (let k2 = 1; k2 < 5; k2++) if (votes[k2] > votes[vid] || vid === 0 && votes[k2] > 0) vid = k2;
      const vi = SHEET.views.findIndex(v => v.id === vid);
      if (vi < 0 || votes[vid] < 2) continue;
      // dense polyline for partial drawing
      const dense = [P[0]]; for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6)); for (let j = 1; j <= n; j++) dense.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]); }
      per[vi].push({p: dense, len: ch.length, cx, minx});
    }
    const BIG = 60, out = [];
    per.forEach((list, vi) => {
      const big = list.filter(o => o.len >= BIG).sort((a, b) => a.minx - b.minx), sm = list.filter(o => o.len < BIG).sort((a, b) => a.cx - b.cx);
      const bt = big.reduce((s, o) => s + o.len, 0) || 1, stt = sm.reduce((s, o) => s + o.len, 0) || 1, v0 = vi / 4, span = 1 / 4;
      let cum = 0; big.forEach(o => { const s = v0 + cum / bt * span * .6; out.push({p: o.p, s, e: Math.min(v0 + span, s + Math.max(.006, o.len / bt * span * .6 * 2)), w: 1.25}); cum += o.len; });
      cum = 0; sm.forEach(o => { const s = v0 + span * .6 + cum / stt * span * .38; out.push({p: o.p, s, e: s + .01, w: o.len >= 25 ? .95 : .7}); cum += o.len; });
    });
    return out;
  }

  /* ---------- three.js ---------- */
  let r, scene, cam, U, car, floor, ipad, ipadIn, pencil, screenTex, ready = false;
  const IPAD_W = 1.0019, SCREEN = {w: .92753, h: .69283, z: .0123};
  function setup() {
    r = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true});
    r.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 2));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.12;
    scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), .04).texture;
    cam = new THREE.PerspectiveCamera(24, 1, .02, 200); scene.add(cam);
    // a soft key light that travels with the camera keeps the tablet and the pencil bright from every angle
    const key = new THREE.DirectionalLight(0xffffff, .9); key.position.set(-1.2, 1.6, .4); cam.add(key); key.target.position.set(0, 0, -1); cam.add(key.target);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d8e0, .35));
    const sc = canvasOf(128, 128), sxx = sc.getContext('2d');
    const gr = sxx.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.34)'); gr.addColorStop(.55, 'rgba(0,0,0,.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    sxx.fillStyle = gr; sxx.fillRect(0, 0, 128, 128);
    floor = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 5.4), new THREE.MeshBasicMaterial({map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false}));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.73; scene.add(floor);
    U = {uSideL: {value: null}, uSideR: {value: null}, uHood: {value: null}, uBack: {value: null},
      uSide: {value: new THREE.Vector4()}, uHoodM: {value: new THREE.Vector4()}, uBackM: {value: new THREE.Vector4()},
      uToCar: {value: new THREE.Matrix4()}, uBackClip: {value: MAP.back.clipY}};
    const m = MAP.side; U.uSide.value.set(m.u[0], m.u[1], m.v[0], m.v[1]);
    const h = MAP.hood, hb = [-438, 336, 2816, 2451], sx0 = 1144 - h.logoZ / h.k;
    U.uHoodM.value.set(1 / h.k / hb[2], (sx0 - hb[0]) / hb[2], -1 / h.k / hb[3], (h.centreY - hb[1]) / hb[3]);
    const b = MAP.back, ab = [3017.8, 2125.1];
    U.uBackM.value.set(b.s / b.k / ab[0], (b.px0 - b.ox) / b.k / ab[0], -b.s / b.k / ab[1], (b.py0 - b.oy) / b.k / ab[1]);
    screenTex = new THREE.CanvasTexture(SC); screenTex.colorSpace = THREE.SRGBColorSpace; screenTex.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy());
  }
  function wrapMaterial(mat) {
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'uniform mat4 uToCar;\nvarying vec3 vCarP;\nvarying vec3 vCarN;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvCarP = (uToCar * vec4(position, 1.0)).xyz;\nvCarN = normalize(mat3(uToCar) * normal);');
      sh.fragmentShader = `uniform sampler2D uSideL, uSideR, uHood, uBack; uniform vec4 uSide, uHoodM, uBackM; uniform float uBackClip;
varying vec3 vCarP; varying vec3 vCarN;
vec4 samp(sampler2D t, vec2 uv){ if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0) return vec4(0.0); return texture2D(t, uv); }
` + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 p = vCarP; vec3 n = normalize(vCarN); vec3 col = diffuseColor.rgb;
  float ws = smoothstep(0.18, 0.42, abs(n.x)) * (1.0 - smoothstep(1.80, 1.86, p.z) * (1.0 - smoothstep(-0.07, -0.05, p.y)));
  // rear bumper stays white: everything behind the bumper/fender seam (under the taillight down to the wheel arch) and below the lamps
  float zs = p.y > -0.092 ? 1.617 + (p.y + 0.092) * 0.725 : 1.52;
  ws *= 1.0 - smoothstep(zs - 0.004, zs + 0.004, p.z) * (1.0 - smoothstep(0.10, 0.115, p.y));
  vec2 su = vec2(p.z * uSide.x + uSide.y, p.y * uSide.z + uSide.w);
  vec4 s = p.x < 0.0 ? samp(uSideL, su) : samp(uSideR, vec2(1.0 - su.x, su.y));
  col = mix(col, s.rgb, s.a * ws);
  float wh = smoothstep(0.25, 0.55, n.y) * (1.0 - smoothstep(-0.2, 0.0, p.z));
  vec4 h = samp(uHood, vec2(p.z * uHoodM.x + uHoodM.y, p.x * uHoodM.z + uHoodM.w));
  col = mix(col, h.rgb, h.a * wh);
  float wb = smoothstep(0.25, 0.55, n.z) * smoothstep(1.72, 1.86, p.z) * smoothstep(uBackClip - 0.008, uBackClip + 0.002, p.y);
  vec4 b = samp(uBack, vec2(p.x * uBackM.x + uBackM.y, p.y * uBackM.z + uBackM.w));
  col = mix(col, b.rgb, b.a * wb);
  diffuseColor.rgb = col;
}`);
    };
    mat.customProgramCacheKey = () => 'cwwrap1';
    mat.needsUpdate = true;
  }
  const tex = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy()); return t; };

  function dressIpad(root) {
    root.traverse(o => { if (!o.isMesh) return;
      [].concat(o.material).forEach(m => {
        if (m.name === 'Aluminium') { m.color.setRGB(.86, .87, .89); m.metalness = .45; m.roughness = .38; m.envMapIntensity = 2.2; }
        if (m.name === 'Strip') { m.color.setRGB(.8, .81, .83); m.metalness = .6; m.roughness = .3; m.envMapIntensity = 2; }
        if (m.name === 'Logo') { m.envMapIntensity = 2.4; }
        if (m.name === 'Bezel' || m.name === 'Glass') { m.roughness = .08; m.envMapIntensity = 1.4; }
      }); });
    // the live screen sits a hair above the glass; its corners follow the display's rounding
    const shape = new THREE.Shape(), w = SCREEN.w / 2, h = SCREEN.h / 2, rr = .0235;
    shape.moveTo(-w + rr, -h); shape.lineTo(w - rr, -h); shape.quadraticCurveTo(w, -h, w, -h + rr); shape.lineTo(w, h - rr); shape.quadraticCurveTo(w, h, w - rr, h);
    shape.lineTo(-w + rr, h); shape.quadraticCurveTo(-w, h, -w, h - rr); shape.lineTo(-w, -h + rr); shape.quadraticCurveTo(-w, -h, -w + rr, -h);
    const geo = new THREE.ShapeGeometry(shape, 8), uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / SCREEN.w + .5, pos.getY(i) / SCREEN.h + .5);
    const scr = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({map: screenTex, toneMapped: false}));
    scr.position.z = SCREEN.z; root.add(scr);
    // Apple Pencil: white body with flat side, grey tip
    pencil = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.0158, .0158, .52, 28), new THREE.MeshStandardMaterial({color: 0xf4f4f6, roughness: .35, envMapIntensity: 1.6}));
    body.position.y = .045 + .26;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(.0158, .0035, .045, 28), new THREE.MeshStandardMaterial({color: 0xf0f0f2, roughness: .4}));
    cone.position.y = .0225;
    const nib = new THREE.Mesh(new THREE.SphereGeometry(.0036, 12, 8), new THREE.MeshStandardMaterial({color: 0x7a7a80, roughness: .6}));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(.0158, .0158, .03, 28), new THREE.MeshStandardMaterial({color: 0xdadade, metalness: .6, roughness: .25}));
    cap.position.y = .045 + .52 + .015;
    pencil.add(body, cone, nib, cap);
    pencil.rotation.set(.9, 0, -.5);   // rises out of the glass, leaning right, like a hand holding it
    root.add(pencil);
  }

  async function start() {
    if (state.started) return; state.started = true;
    setup();
    const gl = url => new Promise((ok, no) => new GLTFLoader().load(url, ok, undefined, no));
    const [g, ig, css, plainImg, wImg, ownImg] = await Promise.all([gl(A + 'megane-white.glb'), gl(A + 'ipad.glb'), fontCss(),
      loadImg(V + 'sheet3-plain.webp'), loadImg(V + 'sheet3-wrap.webp'), loadImg(V + 'sheet3-own.png')]);
    // owner map -> per-car colour layers at screen size, plus the shadows (everything no car owns)
    const own = (() => { const c = canvasOf(ownImg.naturalWidth, ownImg.naturalHeight), x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(ownImg, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data, w = c.width, h = c.height;
      return {w, h, at: (X, Y) => X < 0 || Y < 0 || X >= w || Y >= h ? 0 : Math.round(d[(Y * w + X) * 4] / 60)}; })();
    const LW = Math.round(sw), LH = Math.round(shh);
    const ownS = canvasOf(LW, LH), osx = ownS.getContext('2d', {willReadFrequently: true}); osx.imageSmoothingEnabled = false; osx.drawImage(ownImg, 0, 0, LW, LH);
    const od = osx.getImageData(0, 0, LW, LH).data;
    const wrapS = canvasOf(LW, LH), wsx = wrapS.getContext('2d', {willReadFrequently: true}); wsx.imageSmoothingQuality = 'high'; wsx.drawImage(wImg, 0, 0, LW, LH);
    const wd = wsx.getImageData(0, 0, LW, LH).data;
    const layerOf = id => { const c = canvasOf(LW, LH), x = c.getContext('2d'), im = x.createImageData(LW, LH);
      for (let i = 0; i < LW * LH; i++) if (Math.round(od[i * 4] / 60) === id) { im.data[i * 4] = wd[i * 4]; im.data[i * 4 + 1] = wd[i * 4 + 1]; im.data[i * 4 + 2] = wd[i * 4 + 2]; im.data[i * 4 + 3] = 255; }
      x.putImageData(im, 0, 0); return c; };
    layers = SHEET.views.map(v => layerOf(v.id));
    shadows = (() => { const c = canvasOf(LW, LH), x = c.getContext('2d'), im = x.createImageData(LW, LH);
      for (let i = 0; i < LW * LH; i++) { const no = Math.round(od[i * 4] / 60) === 0; im.data[i * 4] = no ? wd[i * 4] : 255; im.data[i * 4 + 1] = no ? wd[i * 4 + 1] : 255; im.data[i * 4 + 2] = no ? wd[i * 4 + 2] : 255; im.data[i * 4 + 3] = 255; }
      x.putImageData(im, 0, 0); return c; })();
    paintBackground(); lines = trace(plainImg, own); paintScreen(0, 0);
    car = g.scene; scene.add(car); car.updateMatrixWorld(true);
    ipad = new THREE.Group(); ipadIn = ig.scene; ipad.add(ipadIn); cam.add(ipad); dressIpad(ipadIn);
    const [side, hood, back] = await Promise.all([
      buildSide(css, small ? 2048 : 2880),
      buildPlain(A + 'Hood-Graphic.svg', [-438, 336, 2816, 2451], small ? 1536 : 2048, shrinkHoodLogo),
      buildPlain(A + 'Trunk-Graphic.svg', [0, 0, 3017.8, 2125.1], small ? 1280 : 1792)
    ]);
    U.uSideL.value = tex(side.L); U.uSideR.value = tex(side.R); U.uHood.value = tex(hood); U.uBack.value = tex(back);
    const inv = new THREE.Matrix4().copy(car.matrixWorld).invert();
    car.traverse(o => { if (o.isMesh && o.material && o.material.name === 'Paint') { U.uToCar.value.multiplyMatrices(inv, o.matrixWorld); wrapMaterial(o.material); } });
    // taillights: the red parts of the lamps get brighter and glow a little, like in the mock-up
    car.traverse(o => { if (!o.isMesh || !o.material || o.material.name !== 'Renault_Megane_RS_Trophy-R_Albedo') return;
      const m = o.material, toCar = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      m.onBeforeCompile = sh => { sh.uniforms.uTl = {value: toCar};
        sh.vertexShader = 'uniform mat4 uTl;\nvarying vec3 vTlP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTlP = (uTl * vec4(position, 1.0)).xyz;');
        sh.fragmentShader = 'varying vec3 vTlP;\nfloat tlM;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
tlM = smoothstep(1.78, 1.86, vTlP.z) * smoothstep(0.05, 0.2, diffuseColor.r - max(diffuseColor.g, diffuseColor.b));
diffuseColor.rgb = mix(diffuseColor.rgb, min(diffuseColor.rgb * vec3(1.7, 1.0, 1.0) + vec3(0.12, 0.0, 0.0), vec3(1.0)), tlM);`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.06, 0.04) * tlM * 0.55;`);
      };
      m.customProgramCacheKey = () => 'cwtail1'; m.needsUpdate = true; });
    r.compile(scene, cam);
    state.ready = true; draw();
    if (!reduce) (function idle() { requestAnimationFrame(idle); if (state.args && floatOn) draw(true); })();
  }

  /* ---------- per frame ---------- */
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), seg = (p, [a, b]) => clamp((p - a) / (b - a)),
        ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, io3 = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
        out3 = t => 1 - Math.pow(1 - t, 3), lerp = (a, b, t) => a + (b - a) * t;
  let lastKey = '', lastScreen = '', floatOn = false;
  function draw(idle) {
    if (!state.args) return;
    const [p, stage, box] = state.args, Wd = Math.round(stage.width), Hd = Math.round(stage.height);
    const vis = clamp((p - T.enter[0]) / .01) * (1 - seg(p, T.out));
    canvas.style.opacity = vis;
    if (vis <= 0) return;
    const now = performance.now() / 1000;
    const enter = reduce ? 1 : io3(seg(p, T.enter)), landed = clamp((p - T.enter[1]) / .02) * (1 - seg(p, T.lift));
    floatOn = landed > 0;
    const key = [p.toFixed(5), Wd, Hd, Math.round(box.left), Math.round(box.top), Math.round(box.width)].join();
    if (!idle && key === lastKey) return; lastKey = key;
    if (canvas.width !== Math.round(Wd * r.getPixelRatio()) || canvas.height !== Math.round(Hd * r.getPixelRatio())) r.setSize(Wd, Hd, false);
    const aspect = Wd / Hd, fov = 24, tanV = Math.tan(fov * Math.PI / 360);
    cam.fov = fov; cam.aspect = aspect;

    // the tablet lives in camera space so it lands exactly on the layout box
    const dI = 1, wpp = 2 * dI * tanV / Hd;
    const s = box.width * wpp / IPAD_W;
    const restX = (box.left + box.width / 2 - stage.left - Wd / 2) * wpp, restY = -(box.top + box.height / 2 - stage.top - Hd / 2) * wpp;
    const lift = reduce ? seg(p, T.lift) : io3(seg(p, T.lift));
    const bob = Math.sin(now * 1.3) * .004 * landed, sway = Math.sin(now * .9) * .02 * landed;
    ipad.scale.setScalar(s);
    ipad.position.set(lerp(restX + .12, restX, enter), lerp(restY + Hd * wpp * 1.1, restY, out3(seg(p, [T.enter[0], T.enter[1] - .02]))) + bob + lift * lift * Hd * wpp * 1.3,
      lerp(-dI - .5, -dI, enter) + lift * .62);
    ipad.rotation.set(lerp(-.55, 0, enter) + Math.sin(enter * Math.PI) * .12 - lift * .45, lerp(Math.PI, Math.PI * 2, enter) + sway, lerp(.22, 0, enter));
    ipad.visible = lift < 1;

    // screen: draw, then paint
    const dr = seg(p, T.draw), col = seg(p, T.paint), sk = dr.toFixed(4) + col.toFixed(4);
    let tip = null;
    if (sk !== lastScreen) { lastScreen = sk; tip = paintScreen(dr, col); state.tip = tip; } else tip = state.tip;
    // the pencil comes in from the right, follows the line tip, and leaves when the sketch is done
    const pin = io3(clamp((p - T.draw[0] + .012) / .02)), pout = io3(clamp((p - T.draw[1]) / .02));
    const tx = tip ? (tip.x / SCW - .5) * SCREEN.w : SCREEN.w * .3, ty = tip ? (.5 - tip.y / SCH) * SCREEN.h : -SCREEN.h * .1;
    pencil.position.set(lerp(.9, tx, pin) + pout * .9, lerp(-.2, ty, pin) - pout * .2, SCREEN.z + .002 + (1 - pin) * .05 + pout * .08);
    pencil.visible = pin > 0 && pout < 1;

    // the car waits behind the tablet facing us; when the tablet lifts it drives out headlights first, stops, then the camera turns around it
    car.visible = p > T.enter[1] - .005;
    const needW = 2.05 * Wd / (.8 * box.width), Rhide = needW / (2 * tanV * aspect) + 2.3;      // front view: ~2 m wide incl. mirrors
    const Rframe = (Math.max(2.75 / (tanV * aspect), 1.9 / tanV) + 1.6) * 1.12;
    const drive = io3(seg(p, T.dolly)), orbit = ease(seg(p, T.orbit)), dolly = drive;
    const back = Math.max(0, Rhide - Rframe) * (1 - drive);                          // how far behind its final spot the car still is
    car.position.z = back; floor.position.z = back;
    const R = Rframe;
    // start straight in front of the car (it faces -z), then one sweep around it, ending on a front three-quarter view
    const az = Math.PI - orbit * (Math.PI * 7 / 4), el = .04 + Math.sin(Math.PI * Math.min(1, orbit * 1.1)) * .2;
    const tyc = -.105;
    cam.position.set(Math.sin(az) * Math.cos(el) * R, tyc + Math.sin(el) * R, Math.cos(az) * Math.cos(el) * R);
    // where the car sits on screen: right behind the resting tablet, then a little above centre for the turn
    const carDy = lerp(box.top + box.height / 2 - stage.top - Hd / 2, -Hd * .1, drive), carDx = (box.left + box.width / 2 - stage.left - Wd / 2) * (1 - drive);
    const wAtCar = 2 * (R + back) * tanV / Hd, right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    cam.up.set(0, 1, 0); cam.lookAt(-right.x * carDx * wAtCar, tyc + carDy * wAtCar, back - right.z * carDx * wAtCar);
    cam.updateProjectionMatrix();
    floor.material.opacity = seg(p, [T.lift[0] + .02, T.lift[1]]);
    r.render(scene, cam);
  }

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => { if (es[es.length - 1].isIntersecting) { io.disconnect(); start().catch(e => console.error(e)); } }, {rootMargin: '200% 0px'});
    io.observe(scene3);
  } else start();
}
