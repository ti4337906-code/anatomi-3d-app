import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { findClinicalNote } from './anatomy-tr.js';

// =========================================================================
// 1. SCENE, CAMERA, RENDERER & CLIPPING PLANE
// =========================================================================
const viewport = document.getElementById('viewport');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(42, viewport.clientWidth / viewport.clientHeight, 0.02, 100);
camera.position.set(0, 1.0, 2.6);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.localClippingEnabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.9, 0);
controls.minDistance = 0.25;
controls.maxDistance = 6.5;

// Studio Medical Lighting
scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.9));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
keyLight.position.set(3, 5, 5);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.5);
fillLight.position.set(-4, 2, 3);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
rimLight.position.set(0, 3, -5);
scene.add(rimLight);

const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
let sliceEnabled = false;
let sliceAxis = 'axial';

// =========================================================================
// 2. LOADERS (100% OFFLINE DRACO + GLTF)
// =========================================================================
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('./draco/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

// =========================================================================
// 3. STATE
// =========================================================================
let manifest = null;
const systemState = {};       // sysId -> { meta, group, loaded, loading, visible, opacity }
const allStructures = [];     // { id, mesh, name, latin, ta2, system, region, hidden, origMat }
const meshToRecord = new Map();

let selectedRecord = null;
let xrayMode = false;
let isolateMode = false;
let quizActive = false;
let quizTarget = null;
let quizScore = 0;
let quizStreak = 0;

const modelRoot = new THREE.Group();
scene.add(modelRoot);

// =========================================================================
// 4. UI HELPERS
// =========================================================================
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingStatus = document.getElementById('loadingStatus');
const loadingBar = document.getElementById('loadingBar');

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 2400);
}

function setLoading(pct, text) {
  loadingBar.style.width = `${pct}%`;
  loadingStatus.textContent = text;
}

// =========================================================================
// 5. LOAD MANIFEST & SYSTEM GLBs ON DEMAND
// =========================================================================
async function initAtlas() {
  try {
    const res = await fetch('./models/manifest.json');
    if (!res.ok) throw new Error('Manifest bulunamadı');
    manifest = await res.json();
  } catch (err) {
    setLoading(100, 'Henüz 3D model dosyaları derlenmemiş.');
    loadingStatus.innerHTML =
      'Henüz <code>public/models/manifest.json</code> üretilmemiş.<br/><br/>' +
      'GitHub Actions iş akışı çalıştığında Z-Anatomy modelleri otomatik indirilip buraya paketlenecektir.';
    return;
  }

  document.getElementById('statSystems').textContent = manifest.systems.length;
  document.getElementById('statMeshes').textContent = manifest.totalStructures;

  manifest.systems.forEach(sys => {
    const g = new THREE.Group();
    g.name = sys.id;
    modelRoot.add(g);
    systemState[sys.id] = {
      meta: sys,
      group: g,
      loaded: false,
      loading: false,
      visible: sys.defaultVisible,
      opacity: sys.defaultOpacity
    };
  });

  renderSystemsUI();

  // Load default visible systems sequentially to keep mobile memory smooth
  const toLoad = manifest.systems.filter(s => s.defaultVisible);
  for (let i = 0; i < toLoad.length; i++) {
    const s = toLoad[i];
    setLoading(15 + Math.round(((i + 1) / toLoad.length) * 80), `${s.name} yükleniyor (${s.sizeMB} MB)...`);
    await loadSystemGLB(s.id);
  }

  normalizeWholeBodyScale();
  renderStructuresList();
  refreshMaterials();
  loadingOverlay.classList.add('hidden');
}

function loadSystemGLB(sysId) {
  const st = systemState[sysId];
  if (!st || st.loaded || st.loading) return Promise.resolve();
  st.loading = true;

  return new Promise((resolve) => {
    gltfLoader.load(
      `./${st.meta.file}`,
      (gltf) => {
        const root = gltf.scene;
        root.traverse(obj => {
          if (!obj.isMesh) return;
          const origMat = obj.material ? obj.material.clone() : new THREE.MeshStandardMaterial({ color: st.meta.color });
          origMat.transparent = true;
          origMat.clippingPlanes = [clipPlane];
          origMat.clipShadows = true;
          origMat.userData.baseEmissive = origMat.emissive ? origMat.emissive.clone() : new THREE.Color(0x000000);
          obj.material = origMat;

          const ud = obj.userData || {};
          const rec = {
            id: `${sysId}:${obj.name}`,
            mesh: obj,
            name: ud.anat_name || obj.name,
            latin: ud.anat_latin || obj.name,
            ta2: ud.anat_ta2 || '',
            system: sysId,
            region: ud.anat_region || st.meta.name,
            hidden: false,
            mat: origMat
          };
          allStructures.push(rec);
          meshToRecord.set(obj, rec);
        });

        st.group.add(root);
        st.loaded = true;
        st.loading = false;
        resolve();
      },
      undefined,
      (err) => {
        console.error('GLB yükleme hatası:', sysId, err);
        st.loading = false;
        resolve();
      }
    );
  });
}

let normalized = false;
function normalizeWholeBodyScale() {
  if (normalized) return;
  const box = new THREE.Box3().setFromObject(modelRoot);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 1.85 / maxDim;
  modelRoot.scale.setScalar(scale);
  modelRoot.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  controls.target.set(0, 0.92, 0);
  camera.position.set(0, 1.0, 2.55);
  controls.update();
  normalized = true;
}

// =========================================================================
// 6. MATERIAL, DISSECTION & X-RAY REFRESH
// =========================================================================
function refreshMaterials() {
  let hiddenCount = 0;

  allStructures.forEach(rec => {
    const sys = systemState[rec.system];
    if (rec.hidden) hiddenCount++;

    const isSel = selectedRecord && selectedRecord.id === rec.id;
    let vis = sys.visible && !rec.hidden;
    if (isolateMode && selectedRecord) vis = isSel;
    rec.mesh.visible = vis;

    let op = sys.opacity;
    if (xrayMode && !isSel) op = Math.min(op, 0.16);
    if (isSel) {
      op = 1.0;
      rec.mat.emissive.setHex(0x0ea5e9);
      rec.mat.emissiveIntensity = 0.65;
    } else {
      rec.mat.emissive.copy(rec.mat.userData.baseEmissive);
      rec.mat.emissiveIntensity = 1.0;
    }
    rec.mat.opacity = op;
    rec.mat.depthWrite = op >= 0.85;
  });

  document.getElementById('hiddenCount').textContent = hiddenCount;
  document.getElementById('hiddenFooter').classList.toggle('hidden', hiddenCount === 0);
}

// =========================================================================
// 7. RAYCAST PICKING (DISTINGUISHES TOUCH DRAG FROM TAP)
// =========================================================================
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
let downPos = { x: 0, y: 0 };

renderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  if (dist > 6) return; // Was orbit/pan drag, not a tap

  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointerNDC, camera);
  const visibleMeshes = allStructures.filter(r => r.mesh.visible).map(r => r.mesh);
  const hits = raycaster.intersectObjects(visibleMeshes, false);

  if (hits.length === 0) {
    if (!quizActive) clearSelection();
    return;
  }

  const rec = meshToRecord.get(hits[0].object);
  if (!rec) return;

  if (quizActive) handleQuizGuess(rec);
  else selectRecord(rec, false);
});

function selectRecord(rec, focus = true) {
  selectedRecord = rec;
  const sys = systemState[rec.system].meta;

  const badge = document.getElementById('detailSystemBadge');
  badge.textContent = sys.name;
  badge.style.borderColor = sys.color;
  badge.style.color = sys.color;

  document.getElementById('detailName').textContent = rec.name;
  document.getElementById('detailLatin').textContent = rec.latin;
  document.getElementById('detailTa2').textContent = rec.ta2 ? `TA2: ${rec.ta2}` : '';
  document.getElementById('detailRegion').textContent = rec.region;

  const note = findClinicalNote(rec.name + ' ' + rec.latin);
  const clinWrap = document.getElementById('detailClinicalWrap');
  if (note) {
    document.getElementById('detailClinical').textContent = note;
    clinWrap.classList.remove('hidden');
  } else {
    clinWrap.classList.add('hidden');
  }

  document.getElementById('inspectorEmpty').classList.add('hidden');
  document.getElementById('inspectorDetail').classList.remove('hidden');
  document.getElementById('rightPanel').classList.remove('closed');

  refreshMaterials();
  if (focus) focusOnRecord(rec);
}

function clearSelection() {
  selectedRecord = null;
  isolateMode = false;
  document.getElementById('btnIsolate').classList.remove('active');
  document.getElementById('inspectorDetail').classList.add('hidden');
  document.getElementById('inspectorEmpty').classList.remove('hidden');
  refreshMaterials();
}

function focusOnRecord(rec) {
  const box = new THREE.Box3().setFromObject(rec.mesh);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  controls.target.copy(center);
  const dist = Math.max(0.35, Math.min(2.4, size * 2.4));
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  controls.update();
}

// =========================================================================
// 8. UI RENDERING (SYSTEMS & SEARCHABLE STRUCTURE TREE)
// =========================================================================
const systemsContainer = document.getElementById('systemsContainer');
const structuresContainer = document.getElementById('structuresContainer');
const searchInput = document.getElementById('searchInput');

function renderSystemsUI() {
  systemsContainer.innerHTML = '';
  Object.values(systemState).forEach(st => {
    const m = st.meta;
    const card = document.createElement('div');
    card.className = 'sys-card';
    card.innerHTML = `
      <div class="sys-top">
        <div class="sys-title">
          <span class="sys-dot" style="background:${m.color}"></span>
          <div>
            <div>${m.name}</div>
            <div class="sys-sub">${m.meshCount} yapı • ${m.sizeMB} MB</div>
          </div>
        </div>
        <button class="tool-btn sys-eye">${st.visible ? 'Açık' : 'Kapalı'}</button>
      </div>
      <div class="sys-slider-row">
        <input type="range" min="0.05" max="1" step="0.05" value="${st.opacity}" />
        <span class="mono-val">${Math.round(st.opacity * 100)}%</span>
      </div>
    `;

    const eyeBtn = card.querySelector('.sys-eye');
    eyeBtn.classList.toggle('active', st.visible);
    eyeBtn.addEventListener('click', async () => {
      st.visible = !st.visible;
      if (st.visible && !st.loaded) {
        showToast(`${m.name} yükleniyor...`);
        await loadSystemGLB(m.id);
        normalizeWholeBodyScale();
        renderStructuresList();
      }
      renderSystemsUI();
      refreshMaterials();
    });

    const slider = card.querySelector('input[type="range"]');
    const valEl = card.querySelector('.mono-val');
    slider.addEventListener('input', (e) => {
      st.opacity = parseFloat(e.target.value);
      valEl.textContent = `${Math.round(st.opacity * 100)}%`;
      refreshMaterials();
    });

    systemsContainer.appendChild(card);
  });
}

function renderStructuresList() {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = allStructures.filter(r => {
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || r.latin.toLowerCase().includes(q) || r.ta2.toLowerCase().includes(q);
  });

  document.getElementById('structCount').textContent = allStructures.length;
  structuresContainer.innerHTML = '';

  const slice = filtered.slice(0, 120); // Cap DOM rows for smooth 60fps scrolling
  slice.forEach(rec => {
    const row = document.createElement('button');
    row.className = 'struct-row' + (selectedRecord && selectedRecord.id === rec.id ? ' active' : '');
    const color = systemState[rec.system].meta.color;
    row.innerHTML = `
      <span class="sys-dot" style="background:${color}"></span>
      <div>
        <div class="name">${rec.name}</div>
        <div class="sub">${rec.latin}</div>
      </div>
    `;
    row.addEventListener('click', () => selectRecord(rec, true));
    structuresContainer.appendChild(row);
  });

  if (filtered.length > 120) {
    const info = document.createElement('div');
    info.className = 'muted-sm';
    info.style.textAlign = 'center';
    info.style.padding = '8px';
    info.textContent = `${filtered.length - 120} sonuç daha var — aramayı daraltın.`;
    structuresContainer.appendChild(info);
  }
}

// =========================================================================
// 9. CONTROLS, PRESETS, SLICER & QUIZ
// =========================================================================
const leftPanel = document.getElementById('leftPanel');
const rightPanel = document.getElementById('rightPanel');
if (window.innerWidth < 900) {
  leftPanel.classList.add('closed');
  rightPanel.classList.add('closed');
}

document.getElementById('btnToggleLeft').addEventListener('click', () => leftPanel.classList.toggle('closed'));
document.getElementById('btnToggleRight').addEventListener('click', () => rightPanel.classList.toggle('closed'));
document.getElementById('btnCloseDetail').addEventListener('click', clearSelection);

document.getElementById('tabSystems').addEventListener('click', (e) => {
  e.target.classList.add('active');
  document.getElementById('tabStructures').classList.remove('active');
  systemsContainer.classList.remove('hidden');
  structuresContainer.classList.add('hidden');
});
document.getElementById('tabStructures').addEventListener('click', (e) => {
  e.target.classList.add('active');
  document.getElementById('tabSystems').classList.remove('active');
  structuresContainer.classList.remove('hidden');
  systemsContainer.classList.add('hidden');
});

searchInput.addEventListener('input', () => {
  if (searchInput.value.trim()) {
    document.getElementById('tabStructures').click();
  }
  renderStructuresList();
});

// Dissection buttons
document.getElementById('btnFocus').addEventListener('click', () => selectedRecord && focusOnRecord(selectedRecord));
document.getElementById('btnIsolate').addEventListener('click', (e) => {
  if (!selectedRecord) return;
  isolateMode = !isolateMode;
  e.target.classList.toggle('active', isolateMode);
  refreshMaterials();
});
document.getElementById('btnHide').addEventListener('click', () => {
  if (!selectedRecord) return;
  selectedRecord.hidden = true;
  showToast(`${selectedRecord.name} gizlendi`);
  clearSelection();
});
document.getElementById('btnRestoreHidden').addEventListener('click', () => {
  allStructures.forEach(r => { r.hidden = false; });
  refreshMaterials();
  showToast('Tüm gizli yapılar geri getirildi');
});

// X-Ray & Slicer
document.getElementById('btnXray').addEventListener('click', (e) => {
  xrayMode = !xrayMode;
  e.target.classList.toggle('active', xrayMode);
  refreshMaterials();
});

const slicePanel = document.getElementById('slicePanel');
const sliceRange = document.getElementById('sliceRange');
function updateClipPlane() {
  if (!sliceEnabled) { clipPlane.constant = 100; return; }
  const v = parseFloat(sliceRange.value);
  if (sliceAxis === 'axial') clipPlane.normal.set(0, -1, 0);
  else if (sliceAxis === 'sagittal') clipPlane.normal.set(-1, 0, 0);
  else clipPlane.normal.set(0, 0, -1);
  clipPlane.constant = v;
  const pct = Math.round(((v - parseFloat(sliceRange.min)) / (parseFloat(sliceRange.max) - parseFloat(sliceRange.min))) * 100);
  document.getElementById('sliceVal').textContent = `${pct}%`;
}

document.getElementById('btnSlice').addEventListener('click', (e) => {
  sliceEnabled = !sliceEnabled;
  e.target.classList.toggle('active', sliceEnabled);
  slicePanel.classList.toggle('hidden', !sliceEnabled);
  updateClipPlane();
});
sliceRange.addEventListener('input', updateClipPlane);
document.querySelectorAll('.axis-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    sliceAxis = btn.dataset.plane;
    if (sliceAxis === 'axial') { sliceRange.min = 0; sliceRange.max = 1.9; sliceRange.value = 1.1; }
    else { sliceRange.min = -0.6; sliceRange.max = 0.6; sliceRange.value = 0.0; }
    document.querySelectorAll('.axis-btn').forEach(b => b.classList.toggle('active', b === btn));
    updateClipPlane();
  });
});

// Presets
const PRESET_MAP = {
  default:   ['skeletal', 'joints', 'cardiovascular', 'nervous', 'visceral'],
  all:       ['skeletal', 'joints', 'muscular', 'cardiovascular', 'nervous', 'visceral', 'integumentary'],
  skeletal:  ['skeletal', 'joints'],
  neurovasc: ['skeletal', 'cardiovascular', 'nervous'],
  viscera:   ['visceral', 'cardiovascular']
};
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const activeList = PRESET_MAP[btn.dataset.preset] || [];
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b === btn));
    for (const [id, st] of Object.entries(systemState)) {
      st.visible = activeList.includes(id);
      if (st.visible && !st.loaded) await loadSystemGLB(id);
    }
    normalizeWholeBodyScale();
    renderSystemsUI();
    renderStructuresList();
    refreshMaterials();
  });
});

// Camera Presets
const CAM_VIEWS = {
  anterior:  { pos: [0, 1.0, 2.55],  target: [0, 0.92, 0] },
  posterior: { pos: [0, 1.0, -2.55], target: [0, 0.92, 0] },
  right:     { pos: [-2.55, 1.0, 0], target: [0, 0.92, 0] },
  left:      { pos: [2.55, 1.0, 0],  target: [0, 0.92, 0] },
  head:      { pos: [0.22, 1.65, 0.65], target: [0, 1.62, 0] },
  thorax:    { pos: [0.15, 1.25, 0.85], target: [0, 1.22, 0] },
  abdomen:   { pos: [-0.15, 0.98, 0.85], target: [0, 0.95, 0] }
};
document.querySelectorAll('.cam-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const v = CAM_VIEWS[btn.dataset.cam];
    if (!v) return;
    camera.position.set(...v.pos);
    controls.target.set(...v.target);
    controls.update();
    document.querySelectorAll('.cam-btn').forEach(b => b.classList.toggle('active', b === btn));
  });
});

// Quiz Mode
const quizPanel = document.getElementById('quizPanel');
function nextQuiz() {
  const pool = allStructures.filter(r => r.mesh.visible);
  if (pool.length === 0) { showToast('Sınav için en az bir sistem açık olmalı'); return; }
  quizTarget = pool[Math.floor(Math.random() * pool.length)];
  document.getElementById('quizQuestion').textContent = `${quizTarget.name} (${quizTarget.latin})`;
  document.getElementById('quizFeedback').textContent = '3D model üzerinde hedef yapıya dokunun.';
}
function handleQuizGuess(rec) {
  const fb = document.getElementById('quizFeedback');
  if (rec.id === quizTarget.id) {
    quizScore += 10;
    quizStreak += 1;
    fb.innerHTML = `<span style="color:#6ee7b7">Doğru! +10 puan</span>`;
    setTimeout(() => { if (quizActive) nextQuiz(); }, 1000);
  } else {
    quizStreak = 0;
    fb.innerHTML = `<span style="color:#fda4af">Yanlış — seçilen: ${rec.name}</span>`;
  }
  document.getElementById('quizScore').textContent = quizScore;
  document.getElementById('quizStreak').textContent = quizStreak;
}

document.getElementById('btnQuiz').addEventListener('click', (e) => {
  quizActive = !quizActive;
  e.target.classList.toggle('active', quizActive);
  quizPanel.classList.toggle('hidden', !quizActive);
  if (quizActive) { quizScore = 0; quizStreak = 0; nextQuiz(); }
});
document.getElementById('btnCloseQuiz').addEventListener('click', () => document.getElementById('btnQuiz').click());
document.getElementById('btnQuizSkip').addEventListener('click', nextQuiz);
document.getElementById('btnQuizHint').addEventListener('click', () => quizTarget && focusOnRecord(quizTarget));

// License modal & Reset
document.getElementById('btnLicense').addEventListener('click', () => document.getElementById('licenseModal').classList.remove('hidden'));
document.getElementById('btnCloseLicense').addEventListener('click', () => document.getElementById('licenseModal').classList.add('hidden'));
document.getElementById('btnReset').addEventListener('click', () => {
  allStructures.forEach(r => { r.hidden = false; });
  xrayMode = false; document.getElementById('btnXray').classList.remove('active');
  sliceEnabled = false; document.getElementById('btnSlice').classList.remove('active');
  slicePanel.classList.add('hidden');
  clipPlane.constant = 100;
  clearSelection();
  camera.position.set(0, 1.0, 2.55);
  controls.target.set(0, 0.92, 0);
  controls.update();
  showToast('Görünüm ve diseksiyon sıfırlandı');
});

window.addEventListener('resize', () => {
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
initAtlas();
