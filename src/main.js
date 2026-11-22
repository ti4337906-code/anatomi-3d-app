import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { findClinicalInfo } from './anatomy-tr.js';
import { getMicroBumpTexture, getPBRProfile } from './pbr-textures.js';
import {
  STUDY_PRESETS,
  createAtlasState,
  unloadSystemEntities,
  getActiveSurfacePins,
  applyStudyPreset,
  registerMeshToEntity,
  computeEntityVisual,
  toggleIsolate,
  searchAtlas,
  computeSafeFocusPose,
  computeClipPlaneConfig
} from './atlas-core.js';

const viewport = document.getElementById('viewport');
const singlePin = document.getElementById('singlePin');
const singlePinText = document.getElementById('singlePinText');
const selectionCard = document.getElementById('selectionCard');
const sheet = document.getElementById('sheet');
const sheetBody = document.getElementById('sheetBody');

// Overlay container for isolated bone/organ surface-snapped osteology pins
const surfacePinsLayer = document.createElement('div');
surfacePinsLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:15;overflow:hidden;';
document.body.appendChild(surfacePinsLayer);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, viewport.clientWidth / viewport.clientHeight, 0.005, 200);
camera.position.set(0, 1.0, 2.2);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
viewport.appendChild(renderer.domElement);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.9, 0);
controls.minDistance = 0.05;
controls.maxDistance = 12;

scene.add(new THREE.HemisphereLight(0xffffff, 0x2b303b, 0.72));
const keyL = new THREE.DirectionalLight(0xfffaf2, 1.35);
keyL.position.set(3.5, 5.5, 5.5);
keyL.castShadow = true;
keyL.shadow.mapSize.set(1024, 1024);
keyL.shadow.bias = -0.0005;
scene.add(keyL);
const fillL = new THREE.DirectionalLight(0xdbeafe, 0.52);
fillL.position.set(-4.5, 2.0, 2.5);
scene.add(fillL);
const rimL = new THREE.DirectionalLight(0xe2e8f0, 0.65);
rimL.position.set(0, 4.0, -5.5);
scene.add(rimL);

const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('./draco/');
dracoLoader.setDecoderConfig({ type: 'js' });
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

const modelRoot = new THREE.Group();
scene.add(modelRoot);

const state = createAtlasState();
let manifest = null;
const systemMeta = {};
const systemGroups = {};
const systemLoaded = {};
const systemLoading = {};
const meshToEntity = new Map();

let activeTab = null;
let bodyBounds = { minY: 0, maxY: 1.85, center: new THREE.Vector3(0, 0.92, 0), height: 1.85 };

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2000);
}

function closeSheet() {
  activeTab = null;
  sheet.classList.add('hidden');
}

function openSheet(tab) {
  activeTab = tab;
  sheet.classList.remove('hidden');
  selectionCard.classList.add('hidden');
  document.querySelectorAll('.stab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'systems') renderSystemsTab();
  else if (tab === 'tools') renderToolsTab();
  else if (tab === 'search') renderSearchTab();
}

document.getElementById('btnMenu').addEventListener('click', () => activeTab ? closeSheet() : openSheet('systems'));
document.getElementById('btnSearch').addEventListener('click', () => openSheet('search'));
document.getElementById('btnCloseSheet').addEventListener('click', closeSheet);
document.querySelectorAll('.stab').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.tab)));

// Real GPU memory disposal when a heavy CT/MRI layer is turned OFF
function disposeSystemGPU(sysId) {
  const g = systemGroups[sysId];
  if (!g || !systemLoaded[sysId]) return;
  g.traverse(obj => {
    if (obj.isMesh) {
      meshToEntity.delete(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          if (m.map) m.map.dispose();
          if (m.normalMap) m.normalMap.dispose();
          if (m.roughnessMap) m.roughnessMap.dispose();
          if (m.aoMap) m.aoMap.dispose();
          m.dispose();
        });
      }
    }
  });
  while (g.children.length > 0) g.remove(g.children[0]);
  unloadSystemEntities(state, sysId);
  systemLoaded[sysId] = false;
}

async function init() {
  try {
    const res = await fetch('./models/manifest.json');
    if (!res.ok) throw new Error('manifest.json bulunamadı');
    manifest = await res.json();
  } catch (e) {
    toast('Model dosyaları bulunamadı');
    return;
  }

  try {
    const pres = await fetch('./models/surface_pins.json');
    if (pres.ok) state.surfacePins = await pres.json();
  } catch (e) { state.surfacePins = {}; }

  manifest.systems.forEach((sys) => {
    const g = new THREE.Group();
    modelRoot.add(g);
    systemMeta[sys.id] = sys;
    systemGroups[sys.id] = g;
    systemLoaded[sys.id] = false;
    systemLoading[sys.id] = false;
    state.systems[sys.id] = {
      visible: !!sys.defaultVisible,
      opacity: sys.defaultOpacity || 1.0
    };
  });

  const defaults = manifest.systems.filter(s => s.defaultVisible && !s.standalone);
  for (const s of defaults) await loadSystem(s.id);
  fitCameraToModel(true);
  refreshAllVisuals();
}

function loadSystem(sysId) {
  if (!systemMeta[sysId] || systemLoaded[sysId] || systemLoading[sysId]) return Promise.resolve();
  systemLoading[sysId] = true;
  toast(`${systemMeta[sysId].name} yükleniyor...`);

  return new Promise((resolve) => {
    gltfLoader.load(
      `./${systemMeta[sysId].file}`,
      (gltf) => {
        const root = gltf.scene;
        root.traverse(obj => {
          if (!obj.isMesh) return;
          if (obj.geometry && !obj.geometry.attributes.normal) obj.geometry.computeVertexNormals();

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

          const srcMat = obj.material;
          let naturalColor = new THREE.Color(systemMeta[sysId].color);
          if (srcMat && srcMat.color) naturalColor.copy(srcMat.color);

          const profile = getPBRProfile(ent.subtype);
          const hasNormalMap = !!(srcMat && srcMat.normalMap);
          const mat = new THREE.MeshStandardMaterial({
            color: naturalColor.clone(),
            map: (srcMat && srcMat.map) || null,
            normalMap: hasNormalMap ? srcMat.normalMap : null,
            roughnessMap: (srcMat && srcMat.roughnessMap) || null,
            aoMap: (srcMat && srcMat.aoMap) || null,
            bumpMap: hasNormalMap ? null : getMicroBumpTexture(ent.subtype),
            bumpScale: profile.bumpScale,
            roughness: profile.roughness,
            metalness: profile.metalness,
            envMapIntensity: 0.75,
            transparent: false,
            opacity: 1.0,
            depthWrite: true,
            depthTest: true,
            side: systemMeta[sysId].standalone ? THREE.DoubleSide : THREE.FrontSide,
            clippingPlanes: [clipPlane]
          });
          mat.userData.naturalColor = naturalColor.clone();
          obj.material = mat;
          obj.castShadow = true;
          obj.receiveShadow = true;
          meshToEntity.set(obj, ent);
        });

        // Align standalone CT/MRI models (keep NIH HRA organs in their shared CCF coordinate frame!)
        if (systemMeta[sysId].standalone && systemMeta[sysId].group !== 'ct_hra') {
          const b = new THREE.Box3().setFromObject(root);
          if (!b.isEmpty()) {
            const sz = b.getSize(new THREE.Vector3());
            const md = Math.max(sz.x, sz.y, sz.z) || 1;
            const c = b.getCenter(new THREE.Vector3());
            const targetSize = sysId === 'cor_hd' ? 0.55 : 0.35;
            const sc = targetSize / md;
            root.scale.setScalar(sc);
            root.position.set(-c.x * sc, bodyBounds.center.y - c.y * sc, -c.z * sc);
          }
        }

        systemGroups[sysId].add(root);
        systemLoaded[sysId] = true;
        systemLoading[sysId] = false;
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
  const box = new THREE.Box3();
  for (const [id, g] of Object.entries(systemGroups)) {
    if (!systemMeta[id].standalone && systemLoaded[id]) box.expandByObject(g);
  }
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

  const finalBox = new THREE.Box3();
  for (const [id, g] of Object.entries(systemGroups)) {
    if (!systemMeta[id].standalone && systemLoaded[id]) finalBox.expandByObject(g);
  }
  if (finalBox.isEmpty()) return;
  const center = finalBox.getCenter(new THREE.Vector3());
  const size = finalBox.getSize(new THREE.Vector3());
  bodyBounds = { minY: finalBox.min.y, maxY: finalBox.max.y, center, height: size.y || 1.85 };

  if (resetView) {
    const dist = Math.max(size.x, size.y, size.z) * 1.15;
    controls.target.set(center.x, bodyBounds.maxY - bodyBounds.height * 0.36, center.z);
    camera.position.set(center.x, bodyBounds.maxY - bodyBounds.height * 0.34, center.z + dist * 0.72);
    controls.update();
  }
}

function focusSystemGroups(sysIds) {
  const box = new THREE.Box3();
  for (const id of sysIds) {
    if (systemGroups[id] && systemLoaded[id]) box.expandByObject(systemGroups[id]);
  }
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const diag = box.getSize(new THREE.Vector3()).length();
  const pose = computeSafeFocusPose(camera.position, controls.target, center, diag);
  controls.target.set(pose.target.x, pose.target.y, pose.target.z);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  controls.update();
}

function refreshAllVisuals() {
  for (const ent of state.entities.values()) {
    const vis = computeEntityVisual(state, ent);
    for (const mesh of ent.meshes) {
      mesh.visible = vis.visible;
      const mat = mesh.material;
      if (vis.colorHex !== null) mat.color.setHex(vis.colorHex);
      else mat.color.copy(mat.userData.naturalColor);

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

function getEntityBox(ent) {
  const box = new THREE.Box3();
  for (const m of ent.meshes) box.expandByObject(m);
  return box;
}

function focusEntity(ent) {
  const box = getEntityBox(ent);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const diag = box.getSize(new THREE.Vector3()).length();
  const pose = computeSafeFocusPose(camera.position, controls.target, center, diag);
  controls.target.set(pose.target.x, pose.target.y, pose.target.z);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  controls.update();
}

// Raycast Picking
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downXY = { x: 0, y: 0 };

renderer.domElement.addEventListener('pointerdown', e => { downXY = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', e => {
  if (Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y) > 8) return;
  if (activeTab) { closeSheet(); return; }

  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  const visibleMeshes = [];
  for (const ent of state.entities.values()) {
    for (const m of ent.meshes) if (m.visible) visibleMeshes.push(m);
  }
  const hits = raycaster.intersectObjects(visibleMeshes, false);
  if (!hits.length) { clearSelection(); return; }

  const ent = meshToEntity.get(hits[0].object);
  if (ent) selectEntity(ent, false);
});

function selectEntity(ent, focus = true) {
  state.selectedId = ent.id;
  const info = findClinicalInfo(ent.latin, ent.name);
  document.getElementById('selLatin').textContent = ent.latin;
  document.getElementById('selTr').textContent = info
    ? `${info.tr}${ent.ta2 ? ' • TA2: ' + ent.ta2 : ''}`
    : `${ent.ta2 ? 'TA2: ' + ent.ta2 + ' • ' : ''}${ent.region}`;

  const noteEl = document.getElementById('selNote');
  if (info && info.note) {
    noteEl.textContent = info.note;
    noteEl.classList.remove('hidden');
  } else {
    noteEl.classList.add('hidden');
  }

  document.getElementById('btnActFade').classList.toggle('active', ent.faded);
  document.getElementById('btnActIsolate').classList.toggle('active', state.isolateMode);
  selectionCard.classList.remove('hidden');
  refreshAllVisuals();
  if (focus) focusEntity(ent);
}

function clearSelection() {
  state.selectedId = null;
  state.isolateMode = false;
  selectionCard.classList.add('hidden');
  singlePin.classList.add('hidden');
  surfacePinsLayer.innerHTML = '';
  refreshAllVisuals();
}

function updatePins() {
  const ent = state.entities.get(state.selectedId);
  if (!ent) {
    singlePin.classList.add('hidden');
    surfacePinsLayer.innerHTML = '';
    return;
  }

  const box = getEntityBox(ent);
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3());
    const proj = center.project(camera);
    if (proj.z <= 1) {
      singlePin.style.left = `${(proj.x * 0.5 + 0.5) * viewport.clientWidth}px`;
      singlePin.style.top = `${(-proj.y * 0.5 + 0.5) * viewport.clientHeight}px`;
      singlePinText.textContent = ent.latin;
      singlePin.classList.remove('hidden');
    } else {
      singlePin.classList.add('hidden');
    }
  }

  // Show surface-snapped osteology/organ pins ONLY when isolated (zero clutter!)
  surfacePinsLayer.innerHTML = '';
  const pins = getActiveSurfacePins(state);
  if (!pins.length) return;

  modelRoot.updateMatrixWorld(true);
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  pins.forEach(p => {
    const wp = new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]).applyMatrix4(modelRoot.matrixWorld);
    const pr = wp.project(camera);
    if (pr.z > 1) return;
    const x = (pr.x * 0.5 + 0.5) * w;
    const y = (-pr.y * 0.5 + 0.5) * h;
    if (x < 10 || x > w - 10 || y < 10 || y > h - 10) return;
    const tag = document.createElement('div');
    tag.className = 'single-pin';
    tag.style.left = `${x}px`;
    tag.style.top = `${y}px`;
    tag.innerHTML = `<span class="pin-dot" style="background:#38bdf8"></span>${p.latin}`;
    surfacePinsLayer.appendChild(tag);
  });
}

document.getElementById('btnClearSel').addEventListener('click', clearSelection);
document.getElementById('btnActFocus').addEventListener('click', () => {
  const ent = state.entities.get(state.selectedId);
  if (ent) focusEntity(ent);
});
document.getElementById('btnActFade').addEventListener('click', (e) => {
  const ent = state.entities.get(state.selectedId);
  if (!ent) return;
  ent.faded = !ent.faded;
  e.target.classList.toggle('active', ent.faded);
  refreshAllVisuals();
});
document.getElementById('btnActHide').addEventListener('click', () => {
  const ent = state.entities.get(state.selectedId);
  if (!ent) return;
  ent.hidden = true;
  toast(`${ent.latin} gizlendi`);
  clearSelection();
});
document.getElementById('btnActIsolate').addEventListener('click', (e) => {
  const ent = state.entities.get(state.selectedId);
  if (!ent) return;
  const iso = toggleIsolate(state);
  e.target.classList.toggle('active', iso);
  document.getElementById('btnActFade').classList.toggle('active', ent.faded);
  refreshAllVisuals();
  if (iso) focusEntity(ent);
});

function renderSystemsTab() {
  sheetBody.innerHTML = `
    <div class="section-label">Hızlı BT/MR & Çalışma Modları</div>
    <div id="pGrid" class="grid-2"></div>
    <div class="section-label">BT/MR Yüksek Detaylı Modüller (NIH HRA • CAHID • MR)</div>
    <div id="ctRows"></div>
    <div class="section-label">Tam Vücut Katmanları (Z-Anatomy TA2)</div>
    <div id="zRows"></div>
  `;

  const pGrid = document.getElementById('pGrid');
  Object.entries(STUDY_PRESETS).forEach(([key, cfg]) => {
    const validIds = cfg.systems.filter(id => !!systemMeta[id]);
    if (!validIds.length) return;
    const b = document.createElement('button');
    b.className = 'tile-btn';
    b.textContent = cfg.label;
    b.onclick = async () => {
      const toEnable = applyStudyPreset(state, key);
      // Free GPU memory from closed heavy standalone modules
      for (const sid of Object.keys(systemMeta)) {
        if (!state.systems[sid].visible && systemLoaded[sid] && systemMeta[sid].standalone) {
          disposeSystemGPU(sid);
        }
      }
      for (const sid of toEnable) {
        if (!systemLoaded[sid]) await loadSystem(sid);
      }
      refreshAllVisuals();
      focusSystemGroups(toEnable);
      closeSheet();
    };
    pGrid.appendChild(b);
  });

  const ctRows = document.getElementById('ctRows');
  const zRows = document.getElementById('zRows');

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
            <div class="sys-meta">${m.tr || ''} • ${m.sizeMB || 0} MB</div>
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
      if (st.visible) {
        if (!systemLoaded[sysId]) {
          btn.textContent = '...';
          await loadSystem(sysId);
        }
        refreshAllVisuals();
        if (m.standalone || sysId === 'cor_detail') focusSystemGroups([sysId]);
      } else {
        // Free GPU RAM immediately when heavy CT/MRI module is closed
        if (m.standalone) disposeSystemGPU(sysId);
        refreshAllVisuals();
      }
      renderSystemsTab();
    };
    const sl = row.querySelector('input');
    const lbl = row.querySelectorAll('.slider-row span')[1];
    sl.oninput = (e) => {
      st.opacity = parseFloat(e.target.value);
      lbl.textContent = `${Math.round(st.opacity * 100)}%`;
      refreshAllVisuals();
    };
    if (m.group === 'ct_hd' || m.group === 'ct_hra' || m.group === 'custom') ctRows.appendChild(row);
    else zRows.appendChild(row);
  });
}

function applyClip() {
  const cfg = computeClipPlaneConfig(state.sliceEnabled, state.sliceAxis, state.sliceValue);
  clipPlane.normal.set(...cfg.normal);
  clipPlane.constant = cfg.constant;
}

function renderToolsTab() {
  const min = state.sliceAxis === 'axial' ? bodyBounds.minY : -0.6;
  const max = state.sliceAxis === 'axial' ? bodyBounds.maxY + 0.05 : 0.6;
  sheetBody.innerHTML = `
    <div class="section-label">Renklendirme Modu</div>
    <div class="grid-2">
      <button id="mNat" class="tile-btn ${state.colorMode === 'natural' ? 'active' : ''}">Doğal (PBR)</button>
      <button id="mAtl" class="tile-btn ${state.colorMode === 'atlas' ? 'active' : ''}">Atlas (Arter/Ven/Lenf)</button>
    </div>

    <div class="section-label">Sectio Anatomica (Kesit)</div>
    <div class="grid-3">
      <button data-ax="axial" class="tile-btn ${state.sliceAxis === 'axial' ? 'active' : ''}">Transversalis</button>
      <button data-ax="sagittal" class="tile-btn ${state.sliceAxis === 'sagittal' ? 'active' : ''}">Sagittalis</button>
      <button data-ax="coronal" class="tile-btn ${state.sliceAxis === 'coronal' ? 'active' : ''}">Coronalis</button>
    </div>
    <div class="slider-row" style="margin-bottom:10px;">
      <input id="slSlice" type="range" min="${min}" max="${max}" step="0.02" value="${Math.min(max, Math.max(min, state.sliceValue))}" />
      <button id="btnSliceOn" class="toggle-btn ${state.sliceEnabled ? 'on' : ''}">${state.sliceEnabled ? 'AÇIK' : 'KAPALI'}</button>
    </div>

    <div class="section-label">Kamera Açıları</div>
    <div id="camGrid" class="grid-3"></div>

    <button id="btnFullReset" class="tile-btn" style="width:100%;margin-top:6px;">Tüm Diseksiyonu ve Kamerayı Sıfırla</button>
  `;

  document.getElementById('mNat').onclick = () => { state.colorMode = 'natural'; refreshAllVisuals(); renderToolsTab(); };
  document.getElementById('mAtl').onclick = () => { state.colorMode = 'atlas'; refreshAllVisuals(); renderToolsTab(); };

  sheetBody.querySelectorAll('[data-ax]').forEach(b => {
    b.onclick = () => { state.sliceAxis = b.dataset.ax; state.sliceEnabled = true; state.sliceValue = state.sliceAxis === 'axial' ? bodyBounds.center.y : 0; applyClip(); renderToolsTab(); };
  });
  document.getElementById('slSlice').oninput = (e) => { state.sliceEnabled = true; state.sliceValue = parseFloat(e.target.value); applyClip(); };
  document.getElementById('btnSliceOn').onclick = () => { state.sliceEnabled = !state.sliceEnabled; applyClip(); renderToolsTab(); };

  const c = bodyBounds.center;
  const h = bodyBounds.height;
  const views = [
    ['Cor',      [c.x + 0.03, bodyBounds.maxY - h * 0.29, c.z + h * 0.3],  [c.x + 0.02, bodyBounds.maxY - h * 0.29, c.z]],
    ['Pulmones', [c.x, bodyBounds.maxY - h * 0.28, c.z + h * 0.46],        [c.x, bodyBounds.maxY - h * 0.28, c.z]],
    ['Abdomen',  [c.x, bodyBounds.maxY - h * 0.43, c.z + h * 0.46],        [c.x, bodyBounds.maxY - h * 0.43, c.z]],
    ['Anterior', [c.x, c.y, c.z + h * 1.4], [c.x, c.y, c.z]],
    ['Posterior',[c.x, c.y, c.z - h * 1.4], [c.x, c.y, c.z]],
    ['Dexter',   [c.x - h * 1.4, c.y, c.z], [c.x, c.y, c.z]]
  ];
  const cg = document.getElementById('camGrid');
  views.forEach(([lbl, pos, tgt]) => {
    const b = document.createElement('button');
    b.className = 'tile-btn';
    b.textContent = lbl;
    b.onclick = () => { camera.position.set(...pos); controls.target.set(...tgt); controls.update(); closeSheet(); };
    cg.appendChild(b);
  });

  document.getElementById('btnFullReset').onclick = () => {
    for (const e of state.entities.values()) { e.hidden = false; e.faded = false; }
    state.sliceEnabled = false;
    applyClip();
    clearSelection();
    fitCameraToModel(true);
    closeSheet();
    toast('Sıfırlandı');
  };
}

function renderSearchTab() {
  sheetBody.innerHTML = '<input id="sInput" class="search-box" type="search" placeholder="Latince / TA2 ara (örn: Coronaria, Valva, Pulmo, Hepar)..." /><div id="sList"></div>';
  const input = document.getElementById('sInput');
  const list = document.getElementById('sList');

  const draw = () => {
    const ents = searchAtlas(state, input.value);
    list.innerHTML = '';
    if (!ents.length) {
      list.innerHTML = '<div class="sys-meta">Sonuç yok — önce ilgili katmanı Systemata sekmesinden açın.</div>';
      return;
    }
    ents.forEach(ent => {
      const info = findClinicalInfo(ent.latin, ent.name);
      const b = document.createElement('button');
      b.className = 'item-btn';
      b.innerHTML = `<strong>${ent.latin}</strong><small>${info ? info.tr : ent.name}</small>`;
      b.onclick = () => { closeSheet(); selectEntity(ent, true); };
      list.appendChild(b);
    });
  };
  input.oninput = draw;
  draw();
}

window.addEventListener('resize', () => {
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
});

let frame = 0;
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  if ((++frame % 2) === 0) updatePins();
}
animate();
init();
