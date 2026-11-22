import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { findClinicalNote } from './anatomy-tr.js';
import {
  createAtlasState,
  registerMeshToEntity,
  computeEntityVisual,
  toggleIsolate,
  searchAtlas,
  computeSafeFocusPose,
  computeClipPlaneConfig
} from './atlas-core.js';

const viewport = document.getElementById('viewport');
const pinsLayer = document.getElementById('pinsLayer');
const statusBar = document.getElementById('statusBar');
const sheet = document.getElementById('sheet');
const sheetTitle = document.getElementById('sheetTitle');
const sheetBody = document.getElementById('sheetBody');
const selectedPill = document.getElementById('selectedPill');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, viewport.clientWidth / viewport.clientHeight, 0.005, 200);
camera.position.set(0, 1.0, 2.8);

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
controls.minDistance = 0.08;
controls.maxDistance = 12;

scene.add(new THREE.HemisphereLight(0xffffff, 0x3b4252, 0.95));
const keyL = new THREE.DirectionalLight(0xfffaf0, 1.15);
keyL.position.set(4, 6, 6);
scene.add(keyL);
const fillL = new THREE.DirectionalLight(0xe2e8f0, 0.55);
fillL.position.set(-5, 2, 3);
scene.add(fillL);
const backL = new THREE.DirectionalLight(0xdbeafe, 0.5);
backL.position.set(0, 4, -6);
scene.add(backL);

const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
const gltfLoader = new GLTFLoader();
const modelRoot = new THREE.Group();
scene.add(modelRoot);

const state = createAtlasState();
let manifest = null;
const systemMeta = {};
const systemGroups = {};
const systemLoaded = {};
const systemLoading = {};
const meshToEntity = new Map();

let pinsEnabled = false;
let activeSheet = null;
let bodyBounds = { minY: 0, maxY: 1.85, center: new THREE.Vector3(0, 0.92, 0), height: 1.85 };

const landmarkMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.008, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xdc2626, depthTest: false })
);
landmarkMarker.renderOrder = 999;
landmarkMarker.visible = false;
scene.add(landmarkMarker);

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
}

function closeSheet() {
  activeSheet = null;
  sheet.classList.add('hidden');
  document.querySelectorAll('.nav-btn[data-sheet]').forEach(b => b.classList.remove('active'));
}

function openSheet(type) {
  if (activeSheet === type) { closeSheet(); return; }
  activeSheet = type;
  sheet.classList.remove('hidden');
  document.querySelectorAll('.nav-btn[data-sheet]').forEach(b => b.classList.toggle('active', b.dataset.sheet === type));
  if (type === 'systems') renderSystemsSheet();
  else if (type === 'search') renderSearchSheet();
  else if (type === 'camera') renderCameraSheet();
  else if (type === 'slice') renderSliceSheet();
  else if (type === 'detail') renderDetailSheet();
}

document.getElementById('btnCloseSheet').addEventListener('click', closeSheet);
document.querySelectorAll('.nav-btn[data-sheet]').forEach(btn => {
  btn.addEventListener('click', () => openSheet(btn.dataset.sheet));
});

async function init() {
  try {
    const res = await fetch('./models/manifest.json');
    if (!res.ok) throw new Error('manifest.json bulunamadı');
    manifest = await res.json();
  } catch (e) {
    statusBar.textContent = 'Model manifesti bulunamadı';
    return;
  }

  try {
    const lres = await fetch('./models/landmarks.json');
    if (lres.ok) state.landmarks = await lres.json();
  } catch (e) { state.landmarks = []; }

  manifest.systems.forEach((sys, idx) => {
    const g = new THREE.Group();
    modelRoot.add(g);
    systemMeta[sys.id] = sys;
    systemGroups[sys.id] = g;
    systemLoaded[sys.id] = false;
    systemLoading[sys.id] = false;
    state.systems[sys.id] = {
      visible: sys.id === 'skeletal' || idx === 0,
      opacity: sys.defaultOpacity || 1.0
    };
  });

  const firstSys = systemMeta.skeletal ? 'skeletal' : manifest.systems[0].id;
  statusBar.textContent = 'Systema skeletale yükleniyor...';
  await loadSystem(firstSys);
  fitCameraToModel(true);
  refreshAllVisuals();
  updateStatusBar();
}

function updateStatusBar() {
  statusBar.textContent = `${state.entities.size} structurae • ${state.landmarks.length} puncta (TA2)`;
}

function loadSystem(sysId) {
  if (!systemMeta[sysId] || systemLoaded[sysId] || systemLoading[sysId]) return Promise.resolve();
  systemLoading[sysId] = true;
  statusBar.textContent = `${systemMeta[sysId].name} yükleniyor...`;

  return new Promise((resolve) => {
    gltfLoader.load(
      `./${systemMeta[sysId].file}`,
      (gltf) => {
        const root = gltf.scene;
        root.traverse(obj => {
          if (!obj.isMesh) return;
          let naturalColor = new THREE.Color(systemMeta[sysId].color);
          if (obj.material && obj.material.color) {
            naturalColor.copy(obj.material.color);
          }
          const mat = new THREE.MeshStandardMaterial({
            color: naturalColor.clone(),
            roughness: 0.52,
            metalness: 0.04,
            transparent: false,
            opacity: 1.0,
            depthWrite: true,
            depthTest: true,
            side: THREE.FrontSide,
            clippingPlanes: [clipPlane]
          });
          mat.userData.naturalColor = naturalColor.clone();
          obj.material = mat;

          const ud = obj.userData || {};
          const ent = registerMeshToEntity(state, {
            system: sysId,
            meshName: obj.name,
            latin: ud.anat_latin || ud.anat_name || obj.name,
            name: ud.anat_name || obj.name,
            ta2: ud.anat_ta2 || '',
            subtype: ud.anat_subtype || '',
            region: ud.anat_region || systemMeta[sysId].name,
            meshRef: obj
          });
          meshToEntity.set(obj, ent);
        });
        systemGroups[sysId].add(root);
        systemLoaded[sysId] = true;
        systemLoading[sysId] = false;
        updateStatusBar();
        resolve();
      },
      undefined,
      (err) => {
        console.error(err);
        systemLoading[sysId] = false;
        toast(`${systemMeta[sysId].name} yüklenemedi`);
        resolve();
      }
    );
  });
}

let scaledOnce = false;
function fitCameraToModel(resetView = false) {
  const box = new THREE.Box3().setFromObject(modelRoot);
  if (box.isEmpty()) return;

  if (!scaledOnce) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 1.85 / maxDim;
    modelRoot.scale.setScalar(scale);
    modelRoot.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    scaledOnce = true;
  }

  const finalBox = new THREE.Box3().setFromObject(modelRoot);
  const center = finalBox.getCenter(new THREE.Vector3());
  const size = finalBox.getSize(new THREE.Vector3());
  bodyBounds = { minY: finalBox.min.y, maxY: finalBox.max.y, center, height: size.y || 1.85 };

  if (resetView) {
    const dist = Math.max(size.x, size.y, size.z) * 1.42;
    controls.target.copy(center);
    camera.position.set(center.x, center.y + 0.04, center.z + dist);
    controls.update();
  }
}

function refreshAllVisuals() {
  for (const ent of state.entities.values()) {
    const vis = computeEntityVisual(state, ent);
    for (const mesh of ent.meshes) {
      mesh.visible = vis.visible;
      const mat = mesh.material;
      if (vis.colorHex !== null) {
        mat.color.setHex(vis.colorHex);
      } else {
        mat.color.copy(mat.userData.naturalColor);
      }
      if (mat.transparent !== vis.transparent) {
        mat.transparent = vis.transparent;
        mat.needsUpdate = true;
      }
      mat.opacity = vis.opacity;
      mat.depthWrite = vis.depthWrite;
      if (vis.isSelected) {
        mat.emissive.setHex(0x3b82f6);
        mat.emissiveIntensity = 0.45;
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 1.0;
      }
    }
  }
}

function getEntityBoundingBox(ent) {
  const box = new THREE.Box3();
  for (const mesh of ent.meshes) {
    box.expandByObject(mesh);
  }
  return box;
}

function focusEntity(ent) {
  const box = getEntityBoundingBox(ent);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const diag = box.getSize(new THREE.Vector3()).length();
  const pose = computeSafeFocusPose(camera.position, controls.target, center, diag);
  controls.target.set(pose.target.x, pose.target.y, pose.target.z);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  controls.update();
}

function getLandmarkWorldPos(lm) {
  return new THREE.Vector3(lm.pos[0], lm.pos[1], lm.pos[2]).applyMatrix4(modelRoot.matrixWorld);
}

async function focusLandmark(lm) {
  if (state.systems[lm.system]) {
    state.systems[lm.system].visible = true;
    if (!systemLoaded[lm.system]) await loadSystem(lm.system);
    fitCameraToModel(false);
    refreshAllVisuals();
  }
  modelRoot.updateMatrixWorld(true);
  const wpos = getLandmarkWorldPos(lm);
  state.selectedId = null;
  state.isolateMode = false;
  state.activeLandmark = lm;
  landmarkMarker.position.copy(wpos);
  landmarkMarker.visible = true;

  const pose = computeSafeFocusPose(camera.position, controls.target, wpos, 0.14);
  controls.target.set(pose.target.x, pose.target.y, pose.target.z);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  controls.update();

  document.getElementById('pillLatin').textContent = lm.latin;
  document.getElementById('pillSub').textContent = `${lm.ta2 ? lm.ta2 + ' • ' : ''}Punctum anatomicum`;
  selectedPill.classList.remove('hidden');
  toast(`Odaklandı: ${lm.latin}`);
}

// Raycast Picking
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downXY = { x: 0, y: 0 };

renderer.domElement.addEventListener('pointerdown', e => { downXY = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', e => {
  if (Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y) > 8) return;
  if (activeSheet) { closeSheet(); return; }

  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  const visibleMeshes = [];
  for (const ent of state.entities.values()) {
    for (const m of ent.meshes) {
      if (m.visible) visibleMeshes.push(m);
    }
  }
  const hits = raycaster.intersectObjects(visibleMeshes, false);
  if (!hits.length) { clearSelection(); return; }

  const ent = meshToEntity.get(hits[0].object);
  if (ent) selectEntity(ent, false);
});

function selectEntity(ent, focus = true) {
  state.activeLandmark = null;
  landmarkMarker.visible = false;
  state.selectedId = ent.id;
  document.getElementById('pillLatin').textContent = ent.latin;
  document.getElementById('pillSub').textContent = `${ent.ta2 ? ent.ta2 + ' • ' : ''}${ent.name}`;
  document.getElementById('btnPillFade').classList.toggle('active', ent.faded);
  document.getElementById('btnPillIsolate').classList.toggle('active', state.isolateMode);
  selectedPill.classList.remove('hidden');
  refreshAllVisuals();
  if (focus) focusEntity(ent);
}

function clearSelection() {
  state.selectedId = null;
  state.activeLandmark = null;
  state.isolateMode = false;
  landmarkMarker.visible = false;
  document.getElementById('btnPillIsolate').classList.remove('active');
  document.getElementById('btnPillFade').classList.remove('active');
  selectedPill.classList.add('hidden');
  if (activeSheet === 'detail') closeSheet();
  refreshAllVisuals();
}

// Color Mode Toggle (Doğal vs Atlas: Arter Kırmızı, Ven Mavi, Lenf Yeşil, Sinir Sarı)
document.getElementById('btnColorMode').addEventListener('click', (e) => {
  state.colorMode = state.colorMode === 'natural' ? 'atlas' : 'natural';
  const isAtlas = state.colorMode === 'atlas';
  e.target.textContent = isAtlas ? 'Renk: Atlas' : 'Renk: Doğal';
  e.target.classList.toggle('active', isAtlas);
  refreshAllVisuals();
  toast(isAtlas ? 'Atlas Modu: Arter Kırmızı • Ven Mavi • Lenf Yeşil • Sinir Sarı' : 'Doğal anatomik renkler aktif');
});

document.getElementById('btnOpenDetailFromPill').addEventListener('click', () => (state.selectedId || state.activeLandmark) && openSheet('detail'));
document.getElementById('btnPillClose').addEventListener('click', clearSelection);
document.getElementById('btnPillFade').addEventListener('click', (e) => {
  const ent = state.entities.get(state.selectedId);
  if (!ent) return;
  ent.faded = !ent.faded;
  e.target.classList.toggle('active', ent.faded);
  refreshAllVisuals();
});
document.getElementById('btnPillHide').addEventListener('click', () => {
  const ent = state.entities.get(state.selectedId);
  if (!ent) return;
  ent.hidden = true;
  toast(`${ent.latin} gizlendi`);
  clearSelection();
});
document.getElementById('btnPillIsolate').addEventListener('click', (e) => {
  const ent = state.entities.get(state.selectedId);
  if (!ent) return;
  const iso = toggleIsolate(state);
  e.target.classList.toggle('active', iso);
  document.getElementById('btnPillFade').classList.toggle('active', ent.faded);
  refreshAllVisuals();
  if (iso) focusEntity(ent);
});

// Bottom Sheets
function renderSystemsSheet() {
  sheetTitle.textContent = 'Systemata Anatomica (TA2)';
  sheetBody.innerHTML = `
    <div class="legend-row">
      <span class="legend-item"><span class="sys-dot" style="background:#d92626"></span>Arteriae</span>
      <span class="legend-item"><span class="sys-dot" style="background:#1d4ed8"></span>Venae</span>
      <span class="legend-item"><span class="sys-dot" style="background:#16a34a"></span>Lymphatica</span>
      <span class="legend-item"><span class="sys-dot" style="background:#eab308"></span>Nervi</span>
      <span class="legend-item"><span class="sys-dot" style="background:#93c5fd"></span>Ligamenta</span>
    </div>
  `;

  let modCount = 0;
  for (const e of state.entities.values()) if (e.hidden || e.faded) modCount++;
  if (modCount > 0) {
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'item-btn';
    restoreBtn.innerHTML = `<strong>Gizli / Saydam Yapıları Sıfırla (${modCount})</strong>`;
    restoreBtn.onclick = () => {
      for (const e of state.entities.values()) { e.hidden = false; e.faded = false; }
      refreshAllVisuals();
      renderSystemsSheet();
    };
    sheetBody.appendChild(restoreBtn);
  }

  Object.keys(systemMeta).forEach(sysId => {
    const m = systemMeta[sysId];
    const st = state.systems[sysId];
    const row = document.createElement('div');
    row.className = 'sys-row';
    row.innerHTML = `
      <div class="sys-head">
        <div class="sys-name">
          <span class="sys-dot" style="background:${m.color}"></span>
          <div>
            <div>${m.name}</div>
            <div class="sys-meta">${m.tr || ''} • ${m.meshCount} yapı • ${m.sizeMB} MB</div>
          </div>
        </div>
        <button class="toggle-btn ${st.visible ? 'on' : ''}">${st.visible ? 'AÇIK' : 'KAPALI'}</button>
      </div>
      <div class="slider-row">
        <span>Saydamlık</span>
        <input type="range" min="0.1" max="1" step="0.05" value="${st.opacity}" />
        <span>${Math.round(st.opacity * 100)}%</span>
      </div>
    `;
    const btn = row.querySelector('.toggle-btn');
    btn.onclick = async () => {
      st.visible = !st.visible;
      if (st.visible && !systemLoaded[sysId]) {
        btn.textContent = 'Yükleniyor...';
        await loadSystem(sysId);
        fitCameraToModel(false);
      }
      refreshAllVisuals();
      renderSystemsSheet();
    };
    const sl = row.querySelector('input');
    const lbl = row.querySelectorAll('.slider-row span')[1];
    sl.oninput = (e) => {
      st.opacity = parseFloat(e.target.value);
      lbl.textContent = `${Math.round(st.opacity * 100)}%`;
      refreshAllVisuals();
    };
    sheetBody.appendChild(row);
  });
}

function renderSearchSheet() {
  sheetTitle.textContent = 'Terminologia Anatomica (TA2) Ara';
  sheetBody.innerHTML = '<input id="sInput" class="search-box" type="search" placeholder="Örn: Ostium sinus coronarii, Os femoris, Aorta..." /><div id="sList"></div>';
  const input = document.getElementById('sInput');
  const list = document.getElementById('sList');

  const draw = () => {
    const { landmarks: lmMatches, entities: entMatches } = searchAtlas(state, input.value);
    list.innerHTML = '';

    lmMatches.forEach(lm => {
      const b = document.createElement('button');
      b.className = 'item-btn';
      b.innerHTML = `<strong><span class="badge-pin">PUNCTUM</span>${lm.latin}</strong><small>${lm.ta2 ? lm.ta2 + ' • ' : ''}${lm.region}</small>`;
      b.onclick = async () => { closeSheet(); await focusLandmark(lm); };
      list.appendChild(b);
    });

    entMatches.forEach(ent => {
      const b = document.createElement('button');
      b.className = 'item-btn';
      b.innerHTML = `<strong>${ent.latin}</strong><small>${ent.ta2 ? ent.ta2 + ' • ' : ''}${ent.name}</small>`;
      b.onclick = () => { selectEntity(ent, true); closeSheet(); };
      list.appendChild(b);
    });

    if (!lmMatches.length && !entMatches.length) {
      list.innerHTML = '<div class="sys-meta">Sonuç bulunamadı. İlgili sistemi Systemata sekmesinden açabilirsiniz.</div>';
    }
  };
  input.oninput = draw;
  draw();
}

function renderCameraSheet() {
  sheetTitle.textContent = 'Plana & Kamera';
  const c = bodyBounds.center;
  const h = bodyBounds.height;
  const views = [
    ['Anterior',  [c.x, c.y, c.z + h * 1.42], [c.x, c.y, c.z]],
    ['Posterior', [c.x, c.y, c.z - h * 1.42], [c.x, c.y, c.z]],
    ['Dexter',    [c.x - h * 1.42, c.y, c.z], [c.x, c.y, c.z]],
    ['Sinister',  [c.x + h * 1.42, c.y, c.z], [c.x, c.y, c.z]],
    ['Caput',     [c.x, bodyBounds.maxY - h * 0.1, c.z + h * 0.4], [c.x, bodyBounds.maxY - h * 0.1, c.z]],
    ['Thorax',    [c.x, bodyBounds.maxY - h * 0.3, c.z + h * 0.52], [c.x, bodyBounds.maxY - h * 0.3, c.z]],
    ['Abdomen',   [c.x, bodyBounds.maxY - h * 0.46, c.z + h * 0.52], [c.x, bodyBounds.maxY - h * 0.46, c.z]],
    ['Pelvis',    [c.x, bodyBounds.maxY - h * 0.56, c.z + h * 0.52], [c.x, bodyBounds.maxY - h * 0.56, c.z]],
    ['Totus',     [c.x, c.y, c.z + h * 1.48], [c.x, c.y, c.z]]
  ];
  sheetBody.innerHTML = '<div class="cam-grid"></div>';
  const grid = sheetBody.querySelector('.cam-grid');
  views.forEach(([label, pos, tgt]) => {
    const b = document.createElement('button');
    b.className = 'cam-tile';
    b.textContent = label;
    b.onclick = () => { camera.position.set(...pos); controls.target.set(...tgt); controls.update(); closeSheet(); };
    grid.appendChild(b);
  });
}

function applyClip() {
  const cfg = computeClipPlaneConfig(state.sliceEnabled, state.sliceAxis, state.sliceValue);
  clipPlane.normal.set(...cfg.normal);
  clipPlane.constant = cfg.constant;
}

function renderSliceSheet() {
  sheetTitle.textContent = 'Sectio Anatomica (Kesit)';
  const min = state.sliceAxis === 'axial' ? bodyBounds.minY : -0.6;
  const max = state.sliceAxis === 'axial' ? bodyBounds.maxY + 0.05 : 0.6;
  sheetBody.innerHTML = `
    <div class="cam-grid" style="margin-bottom:12px;">
      <button data-ax="axial" class="cam-tile ${state.sliceAxis === 'axial' ? 'active' : ''}">Transversalis</button>
      <button data-ax="sagittal" class="cam-tile ${state.sliceAxis === 'sagittal' ? 'active' : ''}">Sagittalis</button>
      <button data-ax="coronal" class="cam-tile ${state.sliceAxis === 'coronal' ? 'active' : ''}">Coronalis</button>
    </div>
    <div class="slider-row" style="margin-bottom:12px;">
      <span>Kesit</span>
      <input id="slSlice" type="range" min="${min}" max="${max}" step="0.02" value="${Math.min(max, Math.max(min, state.sliceValue))}" />
    </div>
    <button id="btnToggleSlice" class="item-btn" style="text-align:center;">
      <strong>${state.sliceEnabled ? 'Kesiti Kapat' : 'Kesiti Etkinleştir'}</strong>
    </button>
  `;
  sheetBody.querySelectorAll('[data-ax]').forEach(b => {
    b.onclick = () => {
      state.sliceAxis = b.dataset.ax;
      state.sliceEnabled = true;
      state.sliceValue = state.sliceAxis === 'axial' ? bodyBounds.center.y : 0;
      applyClip();
      renderSliceSheet();
    };
  });
  document.getElementById('slSlice').oninput = (e) => {
    state.sliceEnabled = true;
    state.sliceValue = parseFloat(e.target.value);
    applyClip();
  };
  document.getElementById('btnToggleSlice').onclick = () => {
    state.sliceEnabled = !state.sliceEnabled;
    applyClip();
    renderSliceSheet();
  };
}

function renderDetailSheet() {
  const ent = state.entities.get(state.selectedId);
  const target = ent || state.activeLandmark;
  if (!target) return;
  sheetTitle.textContent = ent ? 'Structura Anatomica' : 'Punctum Anatomicum';
  const note = findClinicalNote(`${target.latin} ${target.name}`);
  sheetBody.innerHTML = `
    <div class="detail-card">
      <p><strong>Terminologia Anatomica (Latince):</strong> ${target.latin}</p>
      ${target.ta2 ? `<p><strong>TA2 Kodu:</strong> ${target.ta2}</p>` : ''}
      <p><strong>İngilizce / Kayıt Adı:</strong> ${target.name}</p>
      <p><strong>Regio:</strong> ${target.region}</p>
      ${note ? `<p><strong>Not:</strong> ${note}</p>` : ''}
      ${ent ? '<button id="btnDetFocus" class="item-btn" style="margin-top:10px;text-align:center;"><strong>Kamerayı Odakla</strong></button>' : ''}
    </div>
  `;
  const bf = document.getElementById('btnDetFocus');
  if (bf) bf.onclick = () => { focusEntity(ent); closeSheet(); };
}

document.getElementById('btnPins').addEventListener('click', (e) => {
  pinsEnabled = !pinsEnabled;
  e.target.classList.toggle('active', pinsEnabled);
  toast(pinsEnabled ? 'Yakın anatomik pinler (TA2) açık' : 'Pinler gizlendi');
});

function updatePinsOverlay() {
  pinsLayer.innerHTML = '';
  if (!pinsEnabled && !state.activeLandmark) return;

  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  const list = [];

  if (state.activeLandmark) list.push({ lm: state.activeLandmark, active: true });
  if (pinsEnabled) {
    const camDist = camera.position.distanceTo(controls.target);
    const maxR = Math.max(0.25, camDist * 0.7);
    for (let i = 0; i < state.landmarks.length; i++) {
      const lm = state.landmarks[i];
      if (!state.systems[lm.system] || !state.systems[lm.system].visible) continue;
      const wp = getLandmarkWorldPos(lm);
      const d = wp.distanceTo(controls.target);
      if (d <= maxR) list.push({ lm, active: lm === state.activeLandmark, d, wp });
    }
    list.sort((a, b) => (a.d || 0) - (b.d || 0));
  }

  list.slice(0, 22).forEach(item => {
    const wp = item.wp || getLandmarkWorldPos(item.lm);
    const proj = wp.clone().project(camera);
    if (proj.z > 1) return;
    const x = (proj.x * 0.5 + 0.5) * w;
    const y = (-proj.y * 0.5 + 0.5) * h;
    if (x < 0 || x > w || y < 0 || y > h) return;

    const el = document.createElement('div');
    el.className = 'pin-tag' + (item.active ? ' active' : '');
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.textContent = item.lm.latin;
    el.onclick = () => focusLandmark(item.lm);
    pinsLayer.appendChild(el);
  });
}

document.getElementById('btnReset').addEventListener('click', () => {
  for (const e of state.entities.values()) { e.hidden = false; e.faded = false; }
  state.sliceEnabled = false;
  applyClip();
  clearSelection();
  closeSheet();
  fitCameraToModel(true);
  toast('Görünüm sıfırlandı');
});

window.addEventListener('resize', () => {
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
});

let frameCount = 0;
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  if ((++frameCount % 3) === 0) updatePinsOverlay();
}
animate();
init();
