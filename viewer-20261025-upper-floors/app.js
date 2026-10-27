import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FLOORS = {
  1: {
    url: './assets/event.glb',
    label: 'Первый этаж',
    sceneLabel: 'Этаж 1',
    subtitle: 'Расстановка · первый этаж',
    tag: '01',
    description: 'План расстановки',
    note: 'Стены и колонны условно 5 м. Северо-западная часть площадки не восстановлена.',
    layers: [
      {id: 'stands', label: 'Стенды партнёров', color: 'blue', prefixes: ['Event_partner_platform_']},
      {id: 'banner', label: 'Баннер', color: 'red', prefixes: ['Event_banner_']},
    ],
  },
  2: {
    url: './assets/floor02.glb',
    label: 'Второй этаж',
    sceneLabel: 'Этаж 2',
    subtitle: 'Аллея и стенд · второй этаж',
    tag: '02',
    description: 'Аллея, LED-ряд и INFORCE',
    note: 'Стены и колонны условно 3 м. LED-ряд предварительный: 11 шт., шаг 2 м. Высоты — допущение, не обмер.',
    layers: [
      {id: 'led', label: 'LED-бар 100 IP', color: 'amber', prefixes: ['Event_Bar100_']},
      {id: 'stands', label: 'INFORCE 5×5', color: 'blue', prefixes: ['Event_INFORCE_']},
      {id: 'partners', label: 'VK, EPIC, Ленин, еда', color: 'violet', prefixes: ['Event_VK_', 'Event_EPIC_', 'Event_Lenin_', 'Event_Food_']},
    ],
  },
  3: {
    url: './assets/floor03.glb',
    label: 'Третий этаж',
    sceneLabel: 'Этаж 3',
    subtitle: 'Бары и DJ · третий этаж',
    tag: '03',
    description: 'Бары, DJ и звук',
    note: 'Стены и колонны условно 3 м. Большой зал — предварительная зона, не перекрытие. Крепления Syva/KS21 не утверждены.',
    layers: [
      {id: 'bars', label: 'Бары 5×2,5', color: 'amber', prefixes: ['Event_Bar3_']},
      {id: 'dj', label: 'DJ-стойка', color: 'red', prefixes: ['Event_DJ_']},
      {id: 'sound', label: 'Syva + KS21', color: 'blue', prefixes: ['Event_Syva', 'Event_KS21']},
    ],
  },
};

const viewport = document.querySelector('#viewer');
const loading = document.querySelector('#loading');
const loadingTitle = document.querySelector('#loading-title');
const loadProgress = document.querySelector('#load-progress');
const error = document.querySelector('#error');
const errorText = document.querySelector('#error-text');
const retry = document.querySelector('#retry');
const layersRoot = document.querySelector('#layers');
const floorButtons = [...document.querySelectorAll('[data-floor]')];
const cameraButtons = [...document.querySelectorAll('[data-view]')];
const actionButtons = [...document.querySelectorAll('.canvas-tools button'), ...cameraButtons];
const status = document.querySelector('#model-status');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer, controls, camera, scene, sun;
let bounds = null, centre = null;
let current = null;
let activeFloor = 1;
let loadToken = 0;
let currentView = 'overview';
let animation = 0;
let framePending = false;
let fatalError = false;
const cache = new Map();
const pending = new Map();

function draw() {
  if (framePending || !renderer) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    if (!renderer || !scene || !camera) return;
    controls.update();
    renderer.render(scene, camera);
  });
}

function setBusy(floor) {
  loading.hidden = false;
  error.hidden = true;
  loadingTitle.textContent = `Открываем ${FLOORS[floor].label.toLowerCase()}`;
  loadProgress.textContent = 'Загружаем 3D-план…';
  status.textContent = 'Загрузка';
  viewport.dataset.loaded = 'false';
  actionButtons.forEach(button => { button.disabled = true; });
  layersRoot.querySelectorAll('input').forEach(input => { input.disabled = true; });
}

function setReady(floor) {
  loading.hidden = true;
  error.hidden = true;
  status.textContent = `${FLOORS[floor].label} · 3D`;
  viewport.dataset.loaded = 'true';
  actionButtons.forEach(button => { button.disabled = false; });
}

function fail(message, fatal = false) {
  loading.hidden = true;
  error.hidden = false;
  errorText.textContent = message;
  status.textContent = 'Ошибка загрузки';
  viewport.dataset.loaded = 'false';
  fatalError = fatal;
  actionButtons.forEach(button => { button.disabled = true; });
  layersRoot.querySelectorAll('input').forEach(input => { input.disabled = true; });
  retry.textContent = fatal ? 'Обновить страницу' : 'Повторить';
  if (fatal) floorButtons.forEach(button => { button.disabled = true; });
}

function buildLayerControls(floor) {
  layersRoot.replaceChildren();
  for (const layer of FLOORS[floor].layers) {
    const label = document.createElement('label');
    label.className = 'layer';
    label.dataset.layer = layer.id;
    const title = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.className = `swatch ${layer.color}`;
    title.append(swatch, document.createTextNode(layer.label));
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.disabled = true;
    input.id = `layer-${floor}-${layer.id}`;
    input.addEventListener('change', () => {
      if (!current) return;
      const objects = current.entry.layerObjects[layer.id] || [];
      objects.forEach(object => { object.visible = input.checked; });
      draw();
    });
    const toggle = document.createElement('span');
    toggle.className = 'switch';
    toggle.setAttribute('aria-hidden', 'true');
    label.append(title, input, toggle);
    layersRoot.append(label);
  }
}

function updateChrome(floor) {
  const config = FLOORS[floor];
  document.querySelector('#project-subtitle').textContent = config.subtitle;
  document.querySelector('#floor-tag').textContent = config.tag;
  document.querySelector('#floor-name').textContent = config.label;
  document.querySelector('#floor-desc').textContent = config.description;
  document.querySelector('#scene-floor').textContent = config.sceneLabel;
  document.querySelector('#floor-note').textContent = config.note;
  document.title = `${config.label} · Все инструменты`;
  floorButtons.forEach(button => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.floor) === floor));
  });
  buildLayerControls(floor);
}

function applyLayerRows(entry, floor) {
  for (const layer of FLOORS[floor].layers) {
    const row = layersRoot.querySelector(`[data-layer="${layer.id}"]`);
    if (!row) continue;
    const objects = entry.layerObjects[layer.id] || [];
    row.hidden = objects.length === 0;
    const input = row.querySelector('input');
    if (input) {
      input.disabled = objects.length === 0;
      input.checked = true;
    }
    objects.forEach(object => { object.visible = true; });
  }
}

function prepareEntry(gltfScene, floor) {
  const model = gltfScene;
  model.name = `Floor${floor}`;
  model.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  model.updateMatrixWorld(true);
  const entryBounds = new THREE.Box3().setFromObject(model);
  const layerObjects = {};
  for (const layer of FLOORS[floor].layers) {
    const found = new Set();
    model.traverse(object => {
      if (layer.prefixes.some(prefix => object.name.startsWith(prefix))) found.add(object);
    });
    layerObjects[layer.id] = [...found];
  }
  return {model, bounds: entryBounds, layerObjects};
}

function detachCurrent() {
  if (!current) return;
  scene.remove(current.entry.model);
  current = null;
  bounds = null;
  centre = null;
}

function disposeEntry(entry) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  entry.model.traverse(object => {
    if (!object.isMesh) return;
    if (object.geometry) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      if (!material) continue;
      materials.add(material);
      for (const key of Object.keys(material)) {
        const value = material[key];
        if (value && value.isTexture) textures.add(value);
      }
    }
  });
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}

function fetchFloor(floor) {
  if (cache.has(floor)) return Promise.resolve(cache.get(floor));
  if (pending.has(floor)) return pending.get(floor);
  const promise = new GLTFLoader().loadAsync(FLOORS[floor].url, event => {
    if (activeFloor === floor && event.total) {
      loadProgress.textContent = `Загрузка ${Math.round(event.loaded / event.total * 100)}%`;
    }
  }).then(gltf => {
    const entry = prepareEntry(gltf.scene, floor);
    cache.set(floor, entry);
    return entry;
  }).finally(() => {
    pending.delete(floor);
  });
  pending.set(floor, promise);
  return promise;
}

async function loadFloor(floor, {force = false} = {}) {
  if (!FLOORS[floor]) return;
  const token = ++loadToken;
  cancelAnimationFrame(animation);
  animation = 0;
  activeFloor = floor;
  fatalError = false;
  updateChrome(floor);
  detachCurrent();
  setBusy(floor);
  if (force) {
    const old = cache.get(floor);
    cache.delete(floor);
    if (old) disposeEntry(old);
  }
  try {
    const entry = await fetchFloor(floor);
    if (token !== loadToken || activeFloor !== floor) return;
    current = {floor, entry};
    scene.add(entry.model);
    bounds = entry.bounds;
    centre = bounds.getCenter(new THREE.Vector3());
    centre.y = 0;
    controls.minDistance = 4;
    controls.maxDistance = Math.max(60, bounds.getSize(new THREE.Vector3()).length() * 5);
    sun.target.position.copy(centre);
    applyLayerRows(entry, floor);
    currentView = 'overview';
    setView('overview', false);
    setReady(floor);
  } catch (exception) {
    if (token !== loadToken || activeFloor !== floor) return;
    console.error('Viewer:', exception);
    fail(`Не удалось открыть ${FLOORS[floor].label.toLowerCase()}. Проверьте соединение и попробуйте ещё раз.`);
  }
}

function setView(name, animate = true) {
  if (!current || !bounds || !centre) return;
  cancelAnimationFrame(animation);
  animation = 0;
  const size = bounds.getSize(new THREE.Vector3());
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const limitingFov = Math.min(verticalFov, 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect));
  const distance = size.length() / 2 / Math.sin(limitingFov / 2) * 1.09;
  const directions = {
    overview: new THREE.Vector3(0.85, 0.95, 1.15),
    top: new THREE.Vector3(0, 1, 0.0001),
    entrance: new THREE.Vector3(1.35, 0.65, 0.45),
  };
  const end = centre.clone().add(directions[name].normalize().multiplyScalar(distance));
  const start = camera.position.clone();
  const startTarget = controls.target.clone();
  const startTime = performance.now();
  currentView = name;
  cameraButtons.forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.view === name));
  });
  document.querySelector('#view-label').textContent = {
    overview: 'Общий вид', top: 'Сверху', entrance: 'Со стороны входа',
  }[name];
  function step(now) {
    const t = animate && !reducedMotion ? Math.min((now - startTime) / 420, 1) : 1;
    const eased = 1 - (1 - t) ** 3;
    camera.position.lerpVectors(start, end, eased);
    controls.target.lerpVectors(startTarget, centre, eased);
    controls.update();
    draw();
    animation = t < 1 ? requestAnimationFrame(step) : 0;
  }
  step(startTime);
}

function zoom(factor) {
  if (!current) return;
  cancelAnimationFrame(animation);
  animation = 0;
  const delta = camera.position.clone().sub(controls.target);
  if (delta.length() < 0.01) return;
  delta.setLength(THREE.MathUtils.clamp(delta.length() * factor, controls.minDistance, controls.maxDistance));
  camera.position.copy(controls.target).add(delta);
  controls.update();
  draw();
}

function resize() {
  if (!renderer) return;
  const {width, height} = viewport.getBoundingClientRect();
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  if (current && !animation) setView(currentView, false);
  draw();
}

async function init() {
  try {
    renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute('aria-label', '3D-план. Вращайте мышью или пальцем, меняйте масштаб колесом или двумя пальцами.');
    renderer.domElement.tabIndex = 0;
    viewport.prepend(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1500);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minPolarAngle = 0.02;
    controls.maxPolarAngle = Math.PI / 2 - 0.015;
    controls.screenSpacePanning = true;
    controls.addEventListener('change', draw);
    controls.addEventListener('start', () => {
      cancelAnimationFrame(animation);
      animation = 0;
    });
    controls.listenToKeyEvents(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xf9fff3, 0xa7b49a, 2.7));
    sun = new THREE.DirectionalLight(0xfff7e9, 3.1);
    sun.position.set(-15, 70, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {left: -75, right: 75, top: 75, bottom: -75, near: 1, far: 220});
    sun.shadow.normalBias = 0.04;
    sun.shadow.bias = -0.0001;
    scene.add(sun);
    scene.add(sun.target);
    const fill = new THREE.DirectionalLight(0xe0edff, 1.2);
    fill.position.set(45, 40, -50);
    scene.add(fill);

    new ResizeObserver(resize).observe(viewport);
    resize();
    renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      fail('3D-просмотр остановился. Обновите страницу, чтобы открыть его снова.', true);
    });
    await loadFloor(1, {force: true});
  } catch (exception) {
    console.error('Viewer init:', exception);
    fail('Браузер не смог запустить 3D. Попробуйте открыть страницу в другом браузере.', true);
  }
}

floorButtons.forEach(button => button.addEventListener('click', () => {
  const floor = Number(button.dataset.floor);
  if (floor === activeFloor && current && current.floor === floor && error.hidden) return;
  loadFloor(floor);
}));
cameraButtons.forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelector('#reset').addEventListener('click', () => setView('overview'));
document.querySelector('#zoom-in').addEventListener('click', () => zoom(0.8));
document.querySelector('#zoom-out').addEventListener('click', () => zoom(1.25));
document.querySelector('#retry').addEventListener('click', () => {
  if (fatalError) {
    location.reload();
    return;
  }
  loadFloor(activeFloor, {force: true});
});
document.querySelector('#details-toggle').addEventListener('click', event => {
  const button = event.currentTarget;
  const expanded = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(expanded));
  document.querySelector('#view-settings').classList.toggle('open', expanded);
});
const fullscreen = document.querySelector('#fullscreen');
if (!document.fullscreenEnabled) fullscreen.hidden = true;
fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await viewport.requestFullscreen();
  } catch {
    status.textContent = 'Полный экран недоступен';
  }
});
document.addEventListener('fullscreenchange', () => {
  const active = Boolean(document.fullscreenElement);
  fullscreen.setAttribute('aria-label', active ? 'Выйти из полного экрана' : 'На весь экран');
  fullscreen.title = active ? 'Выйти из полного экрана' : 'На весь экран';
  resize();
});
window.addEventListener('pagehide', () => {
  cache.forEach(entry => disposeEntry(entry));
  cache.clear();
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  detachCurrent();
  cache.clear();
  loadFloor(activeFloor, {force: true});
});
init();
