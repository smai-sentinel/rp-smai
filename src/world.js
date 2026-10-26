import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildings, parks, ROADS, LANDMARKS, rng, blocked } from '../shared/world.js';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .8, ...extra });
const dummy = new THREE.Object3D();
const tmpBox = new THREE.Box3();
const tempV = new THREE.Vector3();
class Batcher {
  constructor(scene) { this.scene = scene; this.batches = new Map(); }
  add(geo, material, x, y, z, rotation = 0) {
    if (geo.index) { const source = geo; geo = geo.toNonIndexed(); source.dispose(); }
    dummy.position.set(x, y, z); dummy.rotation.set(0, rotation, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    geo.applyMatrix4(dummy.matrix);
    if (!this.batches.has(material)) this.batches.set(material, []);
    this.batches.get(material).push(geo);
  }
  box(w, h, d, material, x, y, z, rotation = 0) { this.add(new THREE.BoxGeometry(w, h, d), material, x, y, z, rotation); }
  flush() {
    for (const [material, list] of this.batches) {
      const geometry = mergeGeometries(list, false); const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true; mesh.receiveShadow = true; this.scene.add(mesh); list.forEach(g => g.dispose());
    }
    this.batches.clear();
  }
}
function texture(draw, size = 256) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size); const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 8; return tex;
}
function makeFacade(style) {
  const palettes = [['#68818a', '#213b47'], ['#bfbaa8', '#41595f'], ['#98aeb2', '#223f4e'], ['#bb9a80', '#4c5356']];
  const [frame, glass] = palettes[style]; const random = rng(728 + style);
  const map = texture((ctx, n) => {
    ctx.fillStyle = frame; ctx.fillRect(0, 0, n, n);
    for (let x = 0; x < n; x += 32) for (let y = 0; y < n; y += 40) {
      ctx.fillStyle = random() > .65 ? '#c7bc98' : glass; ctx.fillRect(x + 3, y + 4, 25, 31);
      ctx.fillStyle = '#ffffff13'; ctx.fillRect(x + 4, y + 5, 10, 29);
      ctx.fillStyle = '#00000033'; ctx.fillRect(x + 3, y + 32, 25, 3);
      if (style === 1) { ctx.fillStyle = frame; ctx.fillRect(x + 15, y + 4, 2, 31); }
    }
  });
  return mat('#ffffff', { map, roughness: style % 2 ? .55 : .3, metalness: .25, emissive: '#e7bd75', emissiveMap: map, emissiveIntensity: .13 });
}
function mesh(geo, material, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function compactStaticModel(source) {
  source.updateMatrixWorld(true); const batches = new Map(); const result = new THREE.Group();
  source.traverse(o => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    let geometry = o.geometry.clone(); if (geometry.index) { const old = geometry; geometry = geometry.toNonIndexed(); old.dispose(); }
    geometry.applyMatrix4(o.matrixWorld);
    for (const key of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv', 'uv1'].includes(key)) geometry.deleteAttribute(key);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    if (!geometry.attributes.uv1) geometry.setAttribute('uv1', geometry.attributes.uv.clone());
    if (!batches.has(o.material)) batches.set(o.material, []); batches.get(o.material).push(geometry);
  });
  for (const [material, geometries] of batches) { mesh(mergeGeometries(geometries), material, result); geometries.forEach(g => g.dispose()); }
  return result;
}
function label(text, width = 12, color = '#e3efeb', bg = '#12252d', height = 1.9) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128; const c = canvas.getContext('2d');
  c.fillStyle = bg; c.fillRect(0, 0, 1024, 128); c.fillStyle = color; c.font = '600 61px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 512, 66, 950);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide }));
}

export class CityRenderer {
  constructor(canvas, onProgress = () => {}) {
    this.canvas = canvas; this.onProgress = onProgress; this.entities = new Map(); this.mixers = new Map(); this.effects = [];
    this.scene = new THREE.Scene(); this.scene.fog = new THREE.FogExp2('#b8b6a5', .00155);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.15;
    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .1, 2400); this.camera.position.set(130, 85, 170);
    const pmrem = new THREE.PMREMGenerator(this.renderer); const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, .04); this.scene.environment = this.environment.texture; this.scene.environmentIntensity = .55; room.dispose(); pmrem.dispose();
    this.sun = new THREE.DirectionalLight('#ffe1b2', 3.1); this.sun.position.set(-170, 180, 160); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); Object.assign(this.sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 10, far: 600 });
    this.sun.shadow.bias = -.0003; this.sun.shadow.normalBias = .25; this.scene.add(this.sun, this.sun.target);
    this.ambient = new THREE.HemisphereLight('#b4cbd9', '#665b4b', 1.5); this.scene.add(this.ambient);
    this.buildSky(); this.buildCity(); this.createTemplates();
    this.resize = () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); };
    window.addEventListener('resize', this.resize); this.ready = this.loadModels();
  }
  buildSky() {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color('#547d98') }, bottom: { value: new THREE.Color('#f1cfa7') }, sunDir: { value: v3(-.8, .24, .6).normalize() }, time: { value: 0 } },
      vertexShader: 'varying vec3 vWorld; void main(){ vWorld=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `varying vec3 vWorld; uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform float time;
      void main(){ vec3 d=normalize(vWorld); float h=max(0.,d.y); vec3 col=mix(bottom,top,pow(h,.45));
      float s=max(0.,dot(d,sunDir)); col+=vec3(1.,.65,.27)*pow(s,30.)*.4; col+=vec3(2.,1.5,.7)*pow(s,1800.);
      float cloud=sin(d.x*19.+sin(d.z*17.)+time*.006)*sin(d.z*33.+d.x*9.); col+=smoothstep(.34,.75,cloud)*smoothstep(.05,.4,h)*.09;
      gl_FragColor=vec4(col,1.); }`,
    })); this.scene.add(this.sky);
    const waterGeo = new THREE.PlaneGeometry(4000, 2700, 80, 80); waterGeo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(waterGeo, new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, eye: { value: this.camera.position }, sun: { value: v3(-.8, .3, .4).normalize() } },
      vertexShader: `uniform float time; varying vec3 wp; varying vec3 normalW;
      void main(){ vec3 p=position; p.y+=sin(p.x*.07+time*.7)*.35+sin(p.z*.08+time*.5)*.2;
      normalW=normalize(vec3(-.024*cos(p.x*.07+time*.7),1.,-.016*cos(p.z*.08+time*.5))); wp=(modelMatrix*vec4(p,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.); }`,
      fragmentShader: `uniform vec3 eye; uniform vec3 sun; varying vec3 wp; varying vec3 normalW;
      void main(){ vec3 v=normalize(eye-wp); float f=pow(1.-max(0.,dot(v,normalW)),3.); float spec=pow(max(0.,dot(reflect(-sun,normalW),v)),100.);
      vec3 col=mix(vec3(.12,.29,.32),vec3(.59,.66,.63),f); col+=vec3(1.,.8,.5)*spec*.8; gl_FragColor=vec4(col,1.); }`,
    })); this.water.position.set(0, -1.4, 1750); this.scene.add(this.water);
  }
  buildCity() {
    const b = new Batcher(this.scene), random = rng(181);
    const concrete = mat('#a2a49a'), curb = mat('#b8b8a9'), asphalt = mat('#303d41'), roadLine = mat('#cfc5a2'), white = mat('#e4e5d9');
    const stone = mat('#c9c0a7'), roof = mat('#5e6a6d'), glass = mat('#315568', { roughness: .18, metalness: .65 });
    const foliage = [mat('#3d6450'), mat('#537450'), mat('#5c7651')], bark = mat('#7d7160'), steel = mat('#34464a', { metalness: .6 });
    const sand = mat('#d9c6a5');
    asphalt.map = texture((c, n) => { c.fillStyle = '#869397'; c.fillRect(0, 0, n, n); for (let i = 0; i < 15000; i++) { c.fillStyle = random() > .5 ? '#9ca6a92a' : '#30404530'; c.fillRect(random() * n, random() * n, 1, 1); } }); asphalt.map.repeat.set(60, 60);
    const paving = texture((ctx, n) => {
      ctx.fillStyle = '#a5aaa5'; ctx.fillRect(0, 0, n, n);
      for (let i = 0; i < 7000; i++) { ctx.fillStyle = random() > .5 ? '#d9d6bc20' : '#3e4b4a18'; ctx.fillRect(random() * n, random() * n, 2, 2); }
      ctx.strokeStyle = '#737d794b'; ctx.lineWidth = 1; for (let i = 0; i <= n; i += 64) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, n); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(n, i); ctx.stroke(); }
    }); paving.repeat.set(90, 90);
    mesh(new THREE.BoxGeometry(850, 2, 850), mat('#b0b2a6', { map: paving }), this.scene, 0, -1.1, 0);
    b.box(1500, 1, 90, sand, 0, -1.1, 465);
    for (const r of ROADS) {
      b.box(24, .13, 840, asphalt, r, -.01, 0); b.box(840, .13, 24, asphalt, 0, .01, r);
      for (const side of [-1, 1]) { b.box(.35, .27, 840, curb, r + side * 12.2, .1, 0); b.box(840, .27, .35, curb, 0, .1, r + side * 12.2); }
      for (let k = -400; k < 415; k += 12) {
        if (ROADS.some(v => Math.abs(v - k) < 18)) continue;
        b.box(.16, .02, 5, roadLine, r, .1, k); b.box(5, .02, .16, roadLine, k, .11, r);
      }
      for (const cross of ROADS) for (let stripe = -9; stripe <= 9; stripe += 3) {
        for (const side of [-1, 1]) { b.box(1.3, .02, 5, white, r + stripe, .12, cross + side * 16); b.box(5, .02, 1.3, white, r + side * 16, .13, cross + stripe); }
      }
    }
    this.facades = [0, 1, 2, 3].map(makeFacade);
    for (const building of buildings) {
      const { x, z, w, d, h, style } = building;
      b.box(w + 1.5, .7, d + 1.5, concrete, x, .35, z);
      const geo = style === 2 ? new THREE.CylinderGeometry(w * .48, w * .51, h, 20) : new THREE.BoxGeometry(w, h, d);
      const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 20, uv.getY(i) * h / 24);
      b.add(geo, this.facades[style], x, h / 2 + .5, z);
      if (style === 2) { b.add(new THREE.CylinderGeometry(w * .5, w * .5, .8, 20), roof, x, h + .7, z); }
      else {
        b.box(w + .7, .8, d + .7, roof, x, h + .7, z);
        b.box(w * .36, 2.2, d * .4, concrete, x, h + 1.9, z);
        for (let floor = 8; floor < h; floor += style === 1 ? 4 : 14) b.box(w + .35, .22, d + .35, stone, x, floor, z);
        for (const corner of [-1, 1]) b.box(.7, h, d + .1, style === 3 ? stone : steel, x + corner * (w / 2 - .4), h / 2, z);
      }
      b.box(w * .45, 3.3, .18, glass, x, 1.8, z - d / 2 - .15);
      b.box(w * .5, .2, 2, stone, x, 3.7, z - d / 2 - .8);
      if (h > 60) { b.add(new THREE.CylinderGeometry(.08, .15, 9, 6), steel, x, h + 6, z); }
    }
    // Street furniture is merged by material for predictable rendering cost.
    for (const r of ROADS) for (let z = -392; z < 410; z += 60) {
      if (ROADS.some(v => Math.abs(v - z) < 22)) continue;
      for (const s of [-1, 1]) {
        const x = r + s * 17;
        b.add(new THREE.CylinderGeometry(.12, .2, 7.2, 6), steel, x, 3.6, z);
        b.box(2.7, .12, .17, steel, x - s * 1.2, 7.15, z);
        b.box(1.2, .1, .5, matCached('lamp', '#fff3be', { emissive: '#ffe1a5', emissiveIntensity: 2 }), x - s * 2, 7.1, z);
      }
    }
    const palm = (x, z, height = 10) => {
      b.add(new THREE.CylinderGeometry(.18, .38, height, 7), bark, x, height / 2, z);
      for (let i = 0; i < 7; i++) {
        const a = i * Math.PI * 2 / 7; const points = [v3(0, 0, 0), v3(Math.sin(a) * 1.4, .7, Math.cos(a) * 1.4), v3(Math.sin(a) * 4, -.5, Math.cos(a) * 4)];
        const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 5, .25, 3, false);
        b.add(geo, foliage[i % 3], x, height, z);
        for (let j = 1; j <= 3; j++) { const frond = new THREE.SphereGeometry(1, 6, 4); frond.scale(.6, .12, 1.5); b.add(frond, foliage[i % 3], x + Math.sin(a) * j, height + .3 - j * .2, z + Math.cos(a) * j, -a); }
      }
    };
    for (let x = -390; x <= 395; x += 28) { palm(x, 403, 9 + random() * 3); if (Math.abs(x % 120) > 18) palm(x, 378, 8); }
    for (const p of parks) {
      b.box(91, .2, 91, foliage[1], p.x, .2, p.z); b.box(92, .25, 5, sand, p.x, .34, p.z); b.box(5, .25, 92, sand, p.x, .35, p.z);
      b.add(new THREE.CylinderGeometry(8, 8, .7, 32), curb, p.x, .55, p.z); b.add(new THREE.CylinderGeometry(7, 7, .1, 32), glass, p.x, .95, p.z);
      for (let i = 0; i < 12; i++) {
        const x = p.x + (random() - .5) * 78, z = p.z + (random() - .5) * 78; if (Math.abs(x - p.x) < 9 || Math.abs(z - p.z) < 9) continue;
        b.add(new THREE.CylinderGeometry(.25, .4, 4, 7), bark, x, 2, z);
        const geo = new THREE.IcosahedronGeometry(3.4, 1); geo.scale(1, 1.5, 1); b.add(geo, foliage[i % 3], x, 5.5, z);
      }
    }
    for (let i = 0; i < 28; i++) {
      const x = -390 + i * 29;
      b.box(3, .2, .7, bark, x, .75, 397); for (const dx of [-1, 1]) b.box(.12, .7, .6, steel, x + dx, .35, 397);
      b.box(3, .6, .14, bark, x, 1.15, 397.35);
    }
    // Boardwalk, pavilion and sea rail.
    b.box(850, .5, 10, matCached('wood', '#aaa18b'), 0, .1, 417);
    for (let x = -415; x <= 415; x += 8) b.box(.12, 1.15, .12, steel, x, .75, 422);
    b.box(840, .12, .12, steel, 0, 1.3, 422);
    b.box(14, .8, 100, matCached('wood', '#aaa18b'), 300, -.1, 452);
    b.box(30, .8, 26, matCached('wood', '#aaa18b'), 300, -.1, 498);
    this.buildLandmarks(b, { concrete, stone, steel, glass, curb, white, roof });
    for (const [key, l] of Object.entries(LANDMARKS)) {
      const ring = mesh(new THREE.TorusGeometry(key === 'bank' ? 3.1 : 2.2, .08, 6, 48), new THREE.MeshBasicMaterial({ color: l.color }), this.scene, l.x, .2, l.z); ring.rotation.x = Math.PI / 2;
      const marker = mesh(new THREE.OctahedronGeometry(.45), new THREE.MeshBasicMaterial({ color: l.color }), this.scene, l.x, 3.4, l.z); marker.userData.marker = true; marker.userData.base = 3.4;
    }
    b.flush(); this.onProgress('הרחובות והעיר מוכנים');
  }
  buildLandmarks(b, m) {
    const { stone, steel, glass, white, concrete } = m;
    // Open bank entrance: the geometry and authoritative collision agree.
    b.box(70, .3, 56, stone, 60, .12, 61);
    b.box(2, 12, 56, stone, 26, 6, 61); b.box(2, 12, 56, stone, 94, 6, 61); b.box(70, 12, 2, stone, 60, 6, 89);
    for (const x of [39, 81]) { b.box(28, 12, 2, stone, x, 6, 33); b.box(21, 5.5, .15, glass, x, 4.6, 31.9); }
    for (const x of [27, 49, 71, 93]) b.add(new THREE.CylinderGeometry(.8, 1, 12, 12), white, x, 6, 29.5);
    b.box(72, 2.6, 8, stone, 60, 12, 31);
    const bankLabel = label('S E N T I N E L   B A N K', 40, '#d7e2d4', '#233d42', 2.6); bankLabel.position.set(60, 12, 26.9); bankLabel.rotation.y = Math.PI; this.scene.add(bankLabel);
    this.bankRoof = mesh(new THREE.BoxGeometry(70, .5, 56), stone, this.scene, 60, 12.7, 61);
    b.box(22, 1.3, 3, matCached('walnut', '#79624b'), 41, .8, 64);
    for (let z = 42; z < 84; z += 6) b.box(65, .02, .1, steel, 60, .3, z);
    b.box(18, 5, 2, steel, 60, 2.5, 77);
    const vault = mesh(new THREE.CylinderGeometry(2.4, 2.4, .5, 32), matCached('vault', '#839096', { metalness: .85, roughness: .25 }), this.scene, 60, 2.8, 75.7); vault.rotation.x = Math.PI / 2;
    const wheel = mesh(new THREE.TorusGeometry(.8, .08, 8, 24), steel, this.scene, 60, 2.8, 75.35);
    for (let i = 0; i < 4; i++) { const spoke = mesh(new THREE.BoxGeometry(.08, 1.6, .1), steel, this.scene, 60, 2.8, 75.3); spoke.rotation.z = i * Math.PI / 4; }
    const vaultLabel = label('VAULT 01', 5, '#e7cc87', '#233d42', .8); vaultLabel.position.set(60, 5.5, 75.7); vaultLabel.rotation.y = Math.PI; this.scene.add(vaultLabel);
    const landmarkBuilding = (x, z, w, d, h, title, color) => {
      b.box(w, h, d, concrete, x, h / 2, z); b.box(w + 2, .8, d + 2, stone, x, h + .4, z);
      for (let level = 3; level < h - 1; level += 4) b.box(w - 8, 2.4, .15, glass, x, level, z - d / 2 - .1);
      b.box(8, 3.5, .3, glass, x, 1.75, z - d / 2 - .2);
      const sign = label(title, w * .75, color, '#233d42', 2.5); sign.position.set(x, h - .5, z - d / 2 - .25); sign.rotation.y = Math.PI; this.scene.add(sign);
    };
    landmarkBuilding(-60, -67, 76, 64, 14, 'SMAI POLICE DEPARTMENT', '#a9d3ff');
    landmarkBuilding(180, 65, 76, 50, 10, 'COAST CUSTOMS', '#ddfca0');
    landmarkBuilding(-180, 64, 72, 60, 22, 'SMAI MEDICAL CENTER', '#ffb4a5');
    landmarkBuilding(-300, 279, 70, 46, 7, 'SOUTH COAST STORAGE', '#dcc8ed');
    // The jail interior is revealed only while detained.
    this.jailInterior = new THREE.Group(); this.jailInterior.visible = false; this.scene.add(this.jailInterior);
    mesh(new THREE.BoxGeometry(9, .2, 9), mat('#555e63'), this.jailInterior, -60, .05, -75);
    for (const x of [-64.5, -55.5]) mesh(new THREE.BoxGeometry(.3, 4, 9), mat('#8e999e'), this.jailInterior, x, 2, -75);
    mesh(new THREE.BoxGeometry(9, 4, .3), mat('#8e999e'), this.jailInterior, -60, 2, -79.5);
    for (let x = -64; x <= -56; x += .55) mesh(new THREE.CylinderGeometry(.05, .05, 4, 6), steel, this.jailInterior, x, 2, -70.5);
    mesh(new THREE.BoxGeometry(2, .35, 3.5), mat('#687b82'), this.jailInterior, -63, .7, -77);
  }
  createTemplates() {
    this.baseCar = new THREE.Group(); const body = mat('#bade97', { metalness: .55, roughness: .28 });
    const dark = mat('#142129', { metalness: .45, roughness: .2 }); const rubber = mat('#151b20'); const chrome = mat('#b2c3c6', { metalness: .9, roughness: .25 });
    mesh(new RoundedBoxGeometry(1.95, .65, 4.5, 3, .22), body, this.baseCar, 0, .7, 0).name = 'paint';
    const cabin = mesh(new RoundedBoxGeometry(1.65, .65, 2.1, 3, .22), dark, this.baseCar, 0, 1.24, -.1); cabin.scale.set(1, 1, 1);
    mesh(new RoundedBoxGeometry(1.65, .12, 1.3, 2, .09), body, this.baseCar, 0, 1.59, -.2).name = 'paint';
    for (const x of [-1, 1]) for (const z of [-1.45, 1.45]) {
      const wheel = mesh(new THREE.CylinderGeometry(.39, .39, .26, 18), rubber, this.baseCar, x, .42, z); wheel.rotation.z = Math.PI / 2;
      const rim = mesh(new THREE.CylinderGeometry(.25, .25, .28, 10), chrome, this.baseCar, x, .42, z); rim.rotation.z = Math.PI / 2;
    }
    for (const x of [-.7, .7]) {
      mesh(new THREE.BoxGeometry(.43, .13, .04), mat('#f8edc9', { emissive: '#fff0c0', emissiveIntensity: 1.5 }), this.baseCar, x, .9, 2.26);
      mesh(new THREE.BoxGeometry(.42, .13, .04), mat('#9d2525', { emissive: '#c12919', emissiveIntensity: .7 }), this.baseCar, x, .9, -2.26);
    }
    this.personFallback = new THREE.Group();
    const skin = mat('#b99b81'), coat = mat('#49616c'), pants = mat('#25363d');
    mesh(new THREE.CapsuleGeometry(.23, .48, 6, 12), coat, this.personFallback, 0, 1.15, 0);
    mesh(new THREE.SphereGeometry(.16, 12, 10), skin, this.personFallback, 0, 1.72, 0);
    for (const x of [-.13, .13]) mesh(new THREE.CapsuleGeometry(.09, .6, 4, 8), pants, this.personFallback, x, .48, 0);
    for (const x of [-.31, .31]) mesh(new THREE.CapsuleGeometry(.07, .42, 4, 8), coat, this.personFallback, x, 1.1, 0);
    this.gunTemplate = new THREE.Group();
    mesh(new RoundedBoxGeometry(.12, .12, .42, 1, .025), mat('#293138', { metalness: .7, roughness: .3 }), this.gunTemplate, 0, 0, .12);
    const grip = mesh(new THREE.BoxGeometry(.105, .22, .14), mat('#131c21'), this.gunTemplate, 0, -.12, -.02); grip.rotation.x = -.2;
    mesh(new THREE.BoxGeometry(.025, .035, .03), mat('#c7d4b3'), this.gunTemplate, 0, .08, .28);
  }
  async loadModels() {
    const loader = new GLTFLoader();
    const results = await Promise.allSettled([
      loader.loadAsync(import.meta.env.BASE_URL + 'models/citizen-realistic.glb').then(gltf => {
        this.humanModel = gltf; gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse(o => { if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); } });
        tmpBox.setFromObject(gltf.scene, true); this.humanScale = 1.83 / tmpBox.getSize(new THREE.Vector3()).y; this.humanMinY = tmpBox.min.y;
        this.onProgress('הדמויות המונפשות מוכנות');
      }),
      loader.loadAsync(import.meta.env.BASE_URL + 'models/concept-car.glb').then(gltf => {
        this.carModel = compactStaticModel(gltf.scene);
        this.carModel.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.material.transmission) { o.material.transmission = 0; o.material.transparent = true; o.material.opacity = .52; } } });
        this.onProgress('מודל הרכב המפורט מוכן');
      }),
      new HDRLoader().loadAsync(import.meta.env.BASE_URL + 'environment/coastal-sky.hdr').then(hdr => {
        hdr.mapping = THREE.EquirectangularReflectionMapping; this.scene.background = hdr; this.scene.environment = hdr;
        this.scene.backgroundBlurriness = .02; this.scene.environmentIntensity = .8; this.sky.visible = false;
      }),
    ]);
    this.assetErrors = results.filter(r => r.status === 'rejected').length;
    for (const [id, entity] of this.entities) { this.scene.remove(entity); this.entities.delete(id); } this.mixers.clear();
    return results;
  }
  makeCar(data) {
    const group = new THREE.Group(); let model;
    // Detailed cars nearby; lightweight geometry for distant traffic.
    if (this.carModel) {
      model = this.carModel.clone(true); tmpBox.setFromObject(model); const size = tmpBox.getSize(new THREE.Vector3()); const center = tmpBox.getCenter(new THREE.Vector3());
      const scale = 4.7 / Math.max(size.x, size.z); model.scale.multiplyScalar(scale); model.position.set(-center.x * scale, -tmpBox.min.y * scale + .04, -center.z * scale);
      const wrapper = new THREE.Group(); wrapper.add(model); if (size.x > size.z) wrapper.rotation.y = Math.PI / 2;
      const lod = new THREE.LOD(); lod.addLevel(wrapper, 0);
      const low = this.baseCar.clone(true); low.traverse(o => { if (o.name === 'paint') { o.material = o.material.clone(); o.material.color.set(data.color); o.userData.paint = true; } });
      lod.addLevel(low, this.lowQuality ? 35 : 65); group.add(lod);
      model.traverse(o => { if (o.isMesh && o.material?.name?.startsWith('Paint 1')) { o.material = o.material.clone(); o.material.color.set(data.color); o.userData.paint = true; } });
    } else {
      model = this.baseCar.clone(true); model.traverse(o => { if (o.name === 'paint') { o.material = o.material.clone(); o.material.color.set(data.police ? '#e2e9e4' : data.color); o.userData.paint = true; } });
      if (data.model === 1) model.scale.set(1.07, 1.18, 1.08); group.add(model);
    }
    if (data.police) {
      mesh(new THREE.BoxGeometry(1.3, .12, .3), matCached('policeBar', '#1b2c37'), group, 0, 1.8, 0);
      const red = mesh(new THREE.BoxGeometry(.45, .16, .3), new THREE.MeshBasicMaterial({ color: '#ec4545' }), group, -.4, 1.91, 0); red.name = 'red';
      const blue = mesh(new THREE.BoxGeometry(.45, .16, .3), new THREE.MeshBasicMaterial({ color: '#4d9aff' }), group, .4, 1.91, 0); blue.name = 'blue';
      const sign = label('POLICE', 1.5, '#183747', '#e2e9e4', .35); sign.position.set(0, 1.03, -2.3); sign.rotation.y = Math.PI; group.add(sign);
    }
    group.userData.color = data.color; this.scene.add(group); this.entities.set(data.id, group); return group;
  }
  makePerson(data) {
    const group = new THREE.Group(); let model;
    if (this.humanModel) {
      model = skeletonClone(this.humanModel.scene); const scale = this.humanScale;
      model.scale.multiplyScalar(scale); model.position.y = -this.humanMinY * scale;
      model.traverse(o => { if (o.isMesh) {
        o.castShadow = true; o.frustumCulled = false;
        if (o.material?.name?.includes('original top')) { o.material = o.material.clone(); o.material.color.set(data.role === 'police' ? '#243d64' : data.color || '#697c64'); }
        if (o.name === 'held_accessory' || o.material?.name?.includes('accessory') || o.material?.name?.includes('Accessory')) o.visible = false;
      } });
      const mixer = new THREE.AnimationMixer(model); const clip = this.humanModel.animations[0]; if (clip) { const action = mixer.clipAction(clip); action.play(); action.time = Math.random() * clip.duration; }
      this.mixers.set(data.id, mixer);
    } else model = this.personFallback.clone(true);
    group.add(model); group.userData.model = model;
    if (!data.id.startsWith('ped')) {
      const gun = this.gunTemplate.clone(true); gun.position.set(-.33, 1.43, .37); gun.visible = false; group.add(gun); group.userData.gun = gun;
      if (data.role === 'police') { mesh(new THREE.CylinderGeometry(.18, .18, .08, 12), mat('#1d3357'), group, 0, 1.83, 0); }
    }
    this.scene.add(group); this.entities.set(data.id, group); return group;
  }
  updateEntities(state, dt, localId) {
    const seen = new Set();
    for (const data of [...state.vehicles, ...state.pedestrians, ...state.players]) {
      seen.add(data.id); const car = 'driver' in data;
      const object = this.entities.get(data.id) || (car ? this.makeCar(data) : this.makePerson(data));
      const factor = object.userData.initialized ? 1 - Math.exp(-15 * dt) : 1;
      object.position.x = THREE.MathUtils.lerp(object.position.x, data.x, factor); object.position.z = THREE.MathUtils.lerp(object.position.z, data.z, factor);
      object.rotation.y += Math.atan2(Math.sin(data.yaw - object.rotation.y), Math.cos(data.yaw - object.rotation.y)) * factor;
      object.visible = !data.vehicle && (!data.id.startsWith('ped') || object.position.distanceTo(this.camera.position) < (this.lowQuality ? 70 : 160)); object.userData.initialized = true;
      if (!car) {
        const mixer = this.mixers.get(data.id); if (mixer && object.visible) { mixer.timeScale = data.down || Math.abs(data.speed || 0) < .1 ? 0 : Math.min(2.5, Math.abs(data.speed || 1.3) / 1.8); mixer.update(dt); }
        object.userData.model.rotation.z = data.down ? Math.PI / 2 : 0;
        if (object.userData.gun) object.userData.gun.visible = !!data.aiming;
        if (data.aiming && mixer) mixer.timeScale = 0;
      } else {
        if (object.userData.color !== data.color) { object.traverse(o => { if (o.userData.paint) o.material.color.set(data.color); }); object.userData.color = data.color; }
        if (data.police) { object.getObjectByName('red').visible = data.siren && Math.sin(state.time * 19) > 0; object.getObjectByName('blue').visible = data.siren && Math.sin(state.time * 19) < 0; }
      }
    }
    for (const [id, obj] of this.entities) if (!seen.has(id)) { this.scene.remove(obj); this.entities.delete(id); this.mixers.delete(id); }
    const local = state.players.find(p => p.id === localId);
    this.bankRoof.visible = !local || Math.hypot(local.x - 60, local.z - 61) > 48;
    this.jailInterior.visible = !!local?.jail;
    // Jail room is drawn inside the police building; reveal it by rendering only interior and local avatar.
    if (local?.jail) this.jailInterior.traverse(o => { if (o.material) { o.material.depthTest = false; o.renderOrder = 10; } });
    return local;
  }
  shot(event) {
    const geometry = new THREE.BufferGeometry().setFromPoints([v3(event.from.x, event.from.y, event.from.z), v3(event.end.x, event.end.y, event.end.z)]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#fff1bb', transparent: true, opacity: .9 }));
    this.scene.add(line); this.effects.push({ object: line, life: .12 });
    const spark = mesh(new THREE.SphereGeometry(.12, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffe8a3' }), this.scene, event.end.x, event.end.y, event.end.z);
    this.effects.push({ object: spark, life: .18 });
  }
  render(state, localId, view, dt, elapsed) {
    const local = this.updateEntities(state, dt, localId); const camera = this.camera;
    if (!local) {
      const angle = elapsed * .016; camera.position.set(65 + Math.sin(angle) * 105, 67, 125 + Math.cos(angle) * 75); camera.lookAt(30, 14, 0);
    } else {
      const body = this.entities.get(local.vehicle || local.id); const p = body?.position || v3(local.x, 0, local.z);
      let yaw = view.yaw, distance = local.vehicle ? 9.2 : local.aiming ? 2.1 : 5.3, height = local.vehicle ? 4.1 : local.aiming ? 1.8 : 3;
      if (view.firstPerson) { distance = -.2; height = local.vehicle ? 1.5 : 1.7; }
      if (local.jail) { distance = 4; height = 3; yaw = Math.PI; }
      const shoulder = local.aiming ? .7 : 0;
      let cx = p.x - Math.sin(yaw) * distance + Math.cos(yaw) * shoulder, cz = p.z - Math.cos(yaw) * distance - Math.sin(yaw) * shoulder;
      if (!local.jail && !view.firstPerson) {
        for (let t = 1; t > .1; t -= .1) { if (!blocked(p.x + (cx - p.x) * t, p.z + (cz - p.z) * t, .2)) { cx = p.x + (cx - p.x) * t; cz = p.z + (cz - p.z) * t; break; } }
      }
      const targetPos = v3(cx, height - Math.sin(view.pitch) * distance, cz);
      const smooth = local.aiming || view.firstPerson ? 1 : 1 - Math.exp(-8 * dt);
      camera.position.lerp(targetPos, view.justStarted ? 1 : smooth); view.justStarted = false;
      const aimHeight = local.aiming ? 1.5 : view.firstPerson ? height : 1.3;
      const lookDistance = local.aiming || view.firstPerson ? 25 : local.vehicle ? 6 : 4.5;
      camera.lookAt(p.x + Math.sin(yaw) * lookDistance, aimHeight + Math.tan(view.pitch) * lookDistance, p.z + Math.cos(yaw) * lookDistance);
      const fov = local.aiming ? 43 : local.vehicle ? 65 + Math.abs(local.speed) * .15 : 58;
      camera.fov = THREE.MathUtils.lerp(camera.fov, fov, Math.min(1, dt * 8)); camera.updateProjectionMatrix();
      if (view.firstPerson && body && !local.vehicle) body.visible = false;
      this.sun.position.set(p.x - 170, 180, p.z + 160); this.sun.target.position.set(p.x, 0, p.z);
    }
    const day = Math.max(.12, Math.min(1, .2 + Math.sin((state.clock - 6) / 12 * Math.PI) * 1.8));
    this.sun.intensity = .3 + day * 2.3; this.ambient.intensity = .6 + day * .85;
    this.scene.backgroundIntensity = .25 + day * 1.1;
    const dusk = new THREE.Color('#bdafa3'), night = new THREE.Color('#172d43'); this.scene.fog.color.copy(night).lerp(dusk, day);
    this.sky.material.uniforms.top.value.set('#13263c').lerp(new THREE.Color('#567f99'), day);
    this.sky.material.uniforms.bottom.value.set('#33465a').lerp(new THREE.Color('#f1cba2'), day);
    this.sky.position.copy(camera.position); this.sky.material.uniforms.time.value = elapsed; this.water.material.uniforms.time.value = elapsed;
    this.facades.forEach(m => m.emissiveIntensity = .12 + (1 - day) * .28);
    for (const o of this.scene.children) if (o.userData.marker) { o.position.y = o.userData.base + Math.sin(elapsed * 2) * .35; o.rotation.y = elapsed; }
    for (const e of this.effects) { e.life -= dt; if (e.life <= 0) { this.scene.remove(e.object); e.object.geometry.dispose(); e.object.material.dispose(); } }
    this.effects = this.effects.filter(e => e.life > 0);
    this.renderer.render(this.scene, camera); return local;
  }
  quality(high) {
    this.lowQuality = !high;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, high ? 1.8 : 1)); this.renderer.shadowMap.enabled = high;
    for (const entity of this.entities.values()) entity.traverse(o => { if (o.isLOD && o.levels[1]) o.levels[1].distance = high ? 65 : 35; });
  }
}
const cached = new Map();
function matCached(name, color, extra = {}) { if (!cached.has(name)) cached.set(name, mat(color, extra)); return cached.get(name); }
