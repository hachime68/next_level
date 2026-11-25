// NEXT LEVEL — abertura 3D (Three.js)
// Carrega next_level_cyber_dimension.glb, toca as animações em loop, refaz o brilho (bloom + pulso emissivo)
// e escolhe a câmera Desktop (16:9, portal à direita) ou Mobile (centralizada) conforme a proporção da tela.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ---------- Ajustes (mexa aqui) ----------
const CONFIG = {
  glb: './next_level_cyber_dimension.glb',
  bloomStrength: 0.9,
  bloomRadius: 0.55,
  bloomThreshold: 0.82,
  envIntensity: 0.25,       // reflexo suave nos metais (sem isso o logo e o piso ficam pretos)
  maxPixelRatioDesktop: 2,
  maxPixelRatioMobile: 1.5,
  mobileBreakpointAspect: 0.95, // abaixo disso (retrato) usa a câmera mobile
  // Intensidades das luzes (candela). O GLB traz valores em unidades do Blender, que ficam fortes demais
  // no Three.js, por isso são redefinidas aqui. Se a cena ficar clara/escura demais, ajuste estes números.
  lights: {
    Light_PortalPurple: 28,
    Light_PortalBlue: 22,
    Light_Fill: 0.35,
  },
  logoKey: { color: '#00E5FF', intensity: 20, position: [3.6, 3.2, 8.0] }, // a luz de área do Blender não vai no GLB
};

window.__nlStarted = true; // avisa o diagnóstico do index.html que o módulo carregou

const LOOP_SECONDS = 8;
const FRAME0 = 1 / 30; // o primeiro quadro exportado está em t = 1/30 s
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.getElementById('scene');
const loadingEl = document.getElementById('loading');
const loadingBar = document.getElementById('loading-bar');
const fallbackEl = document.getElementById('fallback');

function showFallback(msg) {
  console.error(msg);
  loadingEl?.classList.add('hidden');
  fallbackEl?.classList.add('visible');
  const m = document.getElementById('fallback-msg');
  if (m) m.textContent = String(msg);
  document.body.classList.add('ready'); // mostra o texto da página mesmo sem o 3D
}

// ---------- Renderer / composer ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  showFallback('WebGL indisponível: ' + e.message);
  throw e;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#070711');

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = CONFIG.envIntensity;

let camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 300); // substituída pela câmera do GLB
let composer, renderPass, bloomPass;

function isPortrait() {
  return window.innerWidth / window.innerHeight < CONFIG.mobileBreakpointAspect;
}
function pixelRatio() {
  const max = isPortrait() ? CONFIG.maxPixelRatioMobile : CONFIG.maxPixelRatioDesktop;
  return Math.min(window.devicePixelRatio || 1, max);
}

function buildComposer() {
  const w = window.innerWidth, h = window.innerHeight, pr = pixelRatio();
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  const target = new THREE.WebGLRenderTarget(w * pr, h * pr, {
    type: THREE.HalfFloatType,
    samples: isPortrait() ? 0 : 4,
  });
  composer = new EffectComposer(renderer, target);
  renderPass = new RenderPass(scene, camera);
  bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), CONFIG.bloomStrength, CONFIG.bloomRadius, CONFIG.bloomThreshold);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
}

// ---------- Câmeras do GLB ----------
let desktopCam = null, mobileCam = null;
const baseFov = new Map(); // câmera -> { yfovRad, aspect }

function fitCamera(cam, aspect) {
  const base = baseFov.get(cam);
  const baseHalfY = Math.tan(base.yfovRad / 2);
  const baseHalfX = baseHalfY * base.aspect;
  // se a janela for mais estreita que a composição original, abre o fov para o portal não cortar
  const halfY = Math.max(baseHalfY, baseHalfX / aspect);
  cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfY));
  cam.aspect = aspect;
  cam.updateProjectionMatrix();
}

function applyCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const wanted = isPortrait() && mobileCam ? mobileCam : desktopCam;
  if (!wanted) return;
  camera = wanted;
  fitCamera(camera, aspect);
  if (renderPass) renderPass.camera = camera;
}

function onResize() {
  buildComposer();
  applyCamera();
  if (reducedMotion) composer.render();
}

// ---------- Brilho pulsante (o GLB não leva animação de material) ----------
const s = (p) => (1 - Math.cos(p)) / 2;
const curves = {
  core: (p) => 0.25 + 0.75 * s(p) + 0.05 * Math.sin(6 * p),
  ring: (p) => 0.5 + 0.5 * s(p),
  logo: (p) => 0.12 + 0.88 * (1 - Math.cos(p - 0.7)) / 2,
};
const pulseMaterials = [
  ['MAT_CorePurple', 'core'], ['MAT_CoreBlue', 'core'], ['MAT_CoreCyan', 'core'],
  ['MAT_LogoGlow', 'logo'], ['MAT_NeonPurple', 'ring'], ['MAT_NeonBlue', 'ring'],
];
const pulseTargets = []; // { mat, base, fn }
const pulseLights = [];  // { light, base, fn }

// ---------- Carregamento ----------
const clock = new THREE.Clock();
let mixer = null;
let time = 0;

const loader = new GLTFLoader();
loader.load(
  CONFIG.glb,
  (gltf) => {
    try {
    scene.add(gltf.scene);

    // câmeras
    desktopCam = gltf.scene.getObjectByName('Camera_Desktop');
    mobileCam = gltf.scene.getObjectByName('Camera_Mobile');
    if (!desktopCam || !desktopCam.isCamera) { showFallback('Camera_Desktop não encontrada no GLB'); return; }
    baseFov.set(desktopCam, { yfovRad: THREE.MathUtils.degToRad(desktopCam.fov), aspect: 16 / 9 });
    if (mobileCam && mobileCam.isCamera) baseFov.set(mobileCam, { yfovRad: THREE.MathUtils.degToRad(mobileCam.fov), aspect: 9 / 16 });
    else mobileCam = null;

    // materiais que pulsam
    const byName = new Map();
    gltf.scene.traverse((o) => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => byName.set(m.name, m));
        o.frustumCulled = true;
      }
    });
    for (const [name, curve] of pulseMaterials) {
      const m = byName.get(name);
      if (m) pulseTargets.push({ mat: m, base: m.emissiveIntensity, fn: curves[curve] });
      else console.warn('Material não encontrado:', name);
    }

    // luzes: redefine as intensidades e recria a luz-chave do logo
    for (const [name, intensity] of Object.entries(CONFIG.lights)) {
      const l = gltf.scene.getObjectByName(name);
      if (!l) { console.warn('Luz não encontrada:', name); continue; }
      const light = l.isLight ? l : l.children.find((c) => c.isLight);
      if (!light) continue;
      light.intensity = intensity;
      if (light.isPointLight) { light.decay = 2; light.distance = 0; }
      const fn = name === 'Light_Fill' ? null : (p) => 0.3 + 0.7 * s(p);
      if (fn) pulseLights.push({ light, base: intensity, fn });
    }
    const key = new THREE.PointLight(CONFIG.logoKey.color, CONFIG.logoKey.intensity, 0, 2);
    key.position.set(...CONFIG.logoKey.position);
    scene.add(key);
    pulseLights.push({ light: key, base: CONFIG.logoKey.intensity, fn: (p) => 0.15 + 0.85 * curves.logo(p) });

    // animações (movimento, rotação e escala vêm do GLB)
    mixer = new THREE.AnimationMixer(gltf.scene);
    gltf.animations.forEach((clip) => {
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
    });

    onResize();
    if (reducedMotion) {
      time = LOOP_SECONDS * 0.5; // quadro estático no pico do brilho
      mixer.setTime(time);
      updatePulse();
      composer.render();
    }
    loadingEl?.classList.add('hidden');
    document.body.classList.add('ready');
    if (!reducedMotion) renderer.setAnimationLoop(tick);
    } catch (e) {
      showFallback('Erro ao montar a cena: ' + (e?.message || e));
    }
  },
  (evt) => {
    if (evt.lengthComputable && loadingBar) loadingBar.style.width = Math.round((evt.loaded / evt.total) * 100) + '%';
  },
  (err) => showFallback('Falha ao carregar o GLB: ' + (err?.message || err)),
);

function updatePulse() {
  const t = (((time - FRAME0) % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
  const p = (2 * Math.PI * t) / LOOP_SECONDS;
  for (const t0 of pulseTargets) t0.mat.emissiveIntensity = t0.base * t0.fn(p);
  for (const l of pulseLights) l.light.intensity = l.base * l.fn(p);
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.1); // evita salto ao voltar de outra aba
  time += dt;
  mixer.update(dt);
  updatePulse();
  composer.render();
}

// ---------- Eventos ----------
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(onResize, 120);
});
buildComposer();
