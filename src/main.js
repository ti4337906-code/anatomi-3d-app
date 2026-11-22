import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { findClinicalNote } from './anatomy-tr.js';

const viewport = document.getElementById('viewport');
const pinsLayer = document.getElementById('pinsLayer');
const statusChip = document.getElementById('statusChip');
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

// Dogal medikal studyo isigi (gercek anatomik renkleri bozmayan notr beyaz)
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

let manifest = null;
let landmarks = [];
const systemState = {};
const allStructures = [];
const meshToRecord = new Map();

let selectedRecord = null;
let activeLandmark = null;
let isolateMode = false;
let pinsEnabled = false;
let sliceEnabled = false;
let sliceAxis = 'axial';
let sliceValue = 1.9;
let activeSheet = null;
let bodyBounds = { minY: 0, maxY: 1.85, center: new THREE.Vector3(0, 0.92, 0), height: 1.85 };

// 3D marker sphere for focused landmark (e.g. Ostium sinus coronarii)
const landmarkMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.008, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xe11d48, depthTest: false })
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
    statusChip.textContent = 'Model bulunamadı';
    return;
  }

  try {
    const lres = await fetch('./models/landmarks.json');
    if (lres.ok) landmarks = await lres.json();
  } catch (e) { landmarks = []; }

  manifest.systems.forEach((sys, idx) => {
    const g = new THREE.Group();
    modelRoot.add(g);
    const isDefault = sys.id === 'skeletal' || idx === 0;
    systemState[sys.id] = {
      meta: sys, group: g, loaded: false, loading: false,
      visible: isDefault, opacity: sys.defaultOpacity || 1.0
    };
  });

  const firstSys = systemState.skeletal ? 'skeletal' : manifest.systems[0].id;
  statusChip.textContent = 'İskelet yükleniyor...';
  await loadSystem(firstSys);
  fitCameraToModel(true);
  refreshMaterials();
  statusChip.textContent = `${allStructures.length} yapı • ${landmarks.length} nokta`;
}

function loadSystem(sysId) {
  const st = systemState[sysId];
  if (!st || st.loaded || st.loading) return Promise.resolve();
  st.loading = true;
  statusChip.textContent = `${st.meta.name} yükleniyor...`;

  return new Promise((resolve) => {
    gltfLoader.load(
      `./${st.meta.file}`,
      (gltf) => {
        const root = gltf.scene;
        root.traverse(obj => {
          if (!obj.isMesh) return;
          // Blender'in seffaf/transmission ayarlarini atip sadece gercek rengi alarak %100 KATI materyal olustur
          let baseColor = new THREE.Color(st.meta.color);
          if (obj.material && obj.material.color) {
            baseColor.copy(obj.material.color);
          }
          const m = new THREE.MeshStandardMaterial({
            color: baseColor,
            roughness: 0.52,
            metalness: 0.04,
            transparent: false,
            opacity: 1.0,
            depthWrite: true,
            depthTest: true,
            side: THREE.FrontSide,
            clippingPlanes: [clipPlane]
          });
          m.userData.baseEmissive = new THREE.Color(0x000000);
          obj.material = m;

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
            faded: false,
            mat: m
          };
          allStructures.push(rec);
          meshToRecord.set(obj, rec);
        });
        st.group.add(root);
        st.loaded = true;
        st.loading = false;
        statusChip.textContent = `${allStructures.length} yapı • ${landmarks.length} nokta`;
        resolve();
      },
      undefined,
      (err) => {
        console.error(err);
        st.loading = false;
        toast(`${st.meta.name} yüklenemedi`);
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

function refreshMaterials() {
  allStructures.forEach(rec => {
    const sys = systemState[rec.system];
    const isSel = selectedRecord && selectedRecord.id === rec.id;
    let vis = sys.visible && !rec.hidden;
    if (isolateMode && selectedRecord) vis = isSel;
    rec.mesh.visible = vis;

    let op = rec.faded ? 0.22 : sys.opacity;
    if (isSel && !rec.faded) op = 1.0;

    const needsTrans = op < 0.99;
    if (rec.mat.transparent !== needsTrans) {
      rec.mat.transparent = needsTrans;
      rec.mat.needsUpdate = true;
    }
    rec.mat.opacity = op;
    rec.mat.depthWrite = !needsTrans;

    if (isSel) {
      rec.mat.emissive.setHex(0x3b82f6);
      rec.mat.emissiveIntensity = 0.45;
    } else {
      rec.mat.emissive.copy(rec.mat.userData.baseEmissive);
      rec.mat.emissiveIntensity = 1.0;
    }
  });
}

// Landmark world coordinate helper (applies same modelRoot transform)
function getLandmarkWorldPos(lm) {
  return new THREE.Vector3(lm.pos[0], lm.pos[1], lm.pos[2]).applyMatrix4(modelRoot.matrixWorld);
}

async function focusLandmark(lm) {
  // Ensure owning system is loaded and visible
  const st = systemState[lm.system];
  if (st) {
    st.visible = true;
    if (!st.loaded) await loadSystem(lm.system);
    fitCameraToModel(false);
    refreshMaterials();
  }
  modelRoot.updateMatrixWorld(true);
  const wpos = getLandmarkWorldPos(lm);
  activeLandmark = lm;
  landmarkMarker.position.copy(wpos);
  landmarkMarker.visible = true;

  controls.target.copy(wpos);
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(wpos).addScaledVector(dir, 0.28);
  controls.update();

  document.getElementById('pillName').textContent = lm.name;
  document.getElementById('pillLatin').textContent = `${lm.latin} (Anatomik Nokta)`;
  selectedPill.classList.remove('hidden');
  toast(`Odaklandı: ${lm.name}`);
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

  const visibleMeshes = allStructures.filter(r => r.mesh.visible).map(r => r.mesh);
  const hits = raycaster.intersectObjects(visibleMeshes, false);
  if (!hits.length) { clearSelection(); return; }

  const rec = meshToRecord.get(hits[0].object);
  if (rec) selectRecord(rec, false);
});

function selectRecord(rec, focus = true) {
  activeLandmark = null;
  landmarkMarker.visible = false;
  selectedRecord = rec;
  document.getElementById('pillName').textContent = rec.name;
  document.getElementById('pillLatin').textContent = rec.latin;
  document.getElementById('btnPillFade').classList.toggle('active', rec.faded);
  selectedPill.classList.remove('hidden');
  refreshMaterials();
  if (focus) focusRecord(rec);
}

function clearSelection() {
  selectedRecord = null;
  activeLandmark = null;
  landmarkMarker.visible = false;
  isolateMode = false;
  document.getElementById('btnPillIsolate').classList.remove('active');
  document.getElementById('btnPillFade').classList.remove('active');
  selectedPill.classList.add('hidden');
  if (activeSheet === 'detail') closeSheet();
  refreshMaterials();
}

function focusRecord(rec) {
  const box = new THREE.Box3().setFromObject(rec.mesh);
  const c = box.getCenter(new THREE.Vector3());
  const sz = box.getSize(new THREE.Vector3()).length();
  controls.target.copy(c);
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(c).addScaledVector(dir, Math.max(0.24, Math.min(2.2, sz * 2.2)));
  controls.update();
}

document.getElementById('btnOpenDetailFromPill').addEventListener('click', () => (selectedRecord || activeLandmark) && openSheet('detail'));
document.getElementById('btnPillClose').addEventListener('click', clearSelection);
document.getElementById('btnPillFade').addEventListener('click', (e) => {
  if (!selectedRecord) return;
  selectedRecord.faded = !selectedRecord.faded;
  e.target.classList.toggle('active', selectedRecord.faded);
  refreshMaterials();
});
document.getElementById('btnPillHide').addEventListener('click', () => {
  if (!selectedRecord) return;
  selectedRecord.hidden = true;
  toast(`${selectedRecord.name} gizlendi`);
  clearSelection();
});
document.getElementById('btnPillIsolate').addEventListener('click', (e) => {
  if (!selectedRecord) return;
  isolateMode = !isolateMode;
  e.target.classList.toggle('active', isolateMode);
  if (isolateMode) {
    selectedRecord.faded = false;
    document.getElementById('btnPillFade').classList.remove('active');
    focusRecord(selectedRecord);
  }
  refreshMaterials();
});

// Bottom Sheets
function renderSystemsSheet() {
  sheetTitle.textContent = 'Anatomik Sistemler';
  sheetBody.innerHTML = '';

  const modCount = allStructures.filter(r => r.hidden || r.faded).length;
  if (modCount > 0) {
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'item-btn';
    restoreBtn.innerHTML = `<strong>Gizli / Saydam Yapıları Sıfırla (${modCount})</strong>`;
    restoreBtn.onclick = () => {
      allStructures.forEach(r => { r.hidden = false; r.faded = false; });
      refreshMaterials();
      renderSystemsSheet();
    };
    sheetBody.appendChild(restoreBtn);
  }

  Object.values(systemState).forEach(st => {
    const m = st.meta;
    const row = document.createElement('div');
    row.className = 'sys-row';
    row.innerHTML = `
      <div class="sys-head">
        <div class="sys-name">
          <span class="sys-dot" style="background:${m.color}"></span>
          <div>
            <div>${m.name}</div>
            <div class="sys-meta">${m.meshCount} yapı • ${m.sizeMB} MB</div>
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
      if (st.visible && !st.loaded) {
        btn.textContent = 'Yükleniyor...';
        await loadSystem(m.id);
        fitCameraToModel(false);
      }
      refreshMaterials();
      renderSystemsSheet();
    };
    const sl = row.querySelector('input');
    const lbl = row.querySelectorAll('.slider-row span')[1];
    sl.oninput = (e) => {
      st.opacity = parseFloat(e.target.value);
      lbl.textContent = `${Math.round(st.opacity * 100)}%`;
      refreshMaterials();
    };
    sheetBody.appendChild(row);
  });
}

function renderSearchSheet() {
  sheetTitle.textContent = 'Yapı & Anatomik Nokta Ara';
  sheetBody.innerHTML = '<input id="sInput" class="search-box" type="search" placeholder="Örn: Ostium sinus coronarii, Femur, Aorta..." /><div id="sList"></div>';
  const input = document.getElementById('sInput');
  const list = document.getElementById('sList');

  const draw = () => {
    const q = input.value.trim().toLowerCase();
    list.innerHTML = '';

    // 1. Search Landmarks (Ostium, Foramen, Sulcus, etc.)
    const lmMatches = landmarks.filter(l =>
      q.length >= 2 && (l.name.toLowerCase().includes(q) || l.latin.toLowerCase().includes(q) || l.ta2.toLowerCase().includes(q))
    ).slice(0, 40);

    // 2. Search Loaded Meshes + Manifest structures
    const meshMatches = allStructures.filter(r =>
      !q || r.name.toLowerCase().includes(q) || r.latin.toLowerCase().includes(q) || r.ta2.toLowerCase().includes(q)
    ).slice(0, 50);

    lmMatches.forEach(lm => {
      const b = document.createElement('button');
      b.className = 'item-btn';
      b.innerHTML = `<strong><span class="badge-pin">NOKTA</span>${lm.name}</strong><small>${lm.latin} • ${lm.region}</small>`;
      b.onclick = async () => { closeSheet(); await focusLandmark(lm); };
      list.appendChild(b);
    });

    meshMatches.forEach(rec => {
      const b = document.createElement('button');
      b.className = 'item-btn';
      b.innerHTML = `<strong>${rec.name}</strong><small>${rec.latin}</small>`;
      b.onclick = () => { selectRecord(rec, true); closeSheet(); };
      list.appendChild(b);
    });

    if (!lmMatches.length && !meshMatches.length) {
      list.innerHTML = '<div class="sys-meta">Sonuç bulunamadı. Diğer sistemleri Sistemler sekmesinden açabilirsiniz.</div>';
    }
  };
  input.oninput = draw;
  draw();
}

function renderCameraSheet() {
  sheetTitle.textContent = 'Kamera Açıları';
  const c = bodyBounds.center;
  const h = bodyBounds.height;
  const views = [
    ['Ön',      [c.x, c.y, c.z + h * 1.42], [c.x, c.y, c.z]],
    ['Arka',    [c.x, c.y, c.z - h * 1.42], [c.x, c.y, c.z]],
    ['Sağ Yan', [c.x - h * 1.42, c.y, c.z], [c.x, c.y, c.z]],
    ['Sol Yan', [c.x + h * 1.42, c.y, c.z], [c.x, c.y, c.z]],
    ['Baş',     [c.x, bodyBounds.maxY - h * 0.1, c.z + h * 0.4], [c.x, bodyBounds.maxY - h * 0.1, c.z]],
    ['Toraks',  [c.x, bodyBounds.maxY - h * 0.3, c.z + h * 0.52], [c.x, bodyBounds.maxY - h * 0.3, c.z]],
    ['Abdomen', [c.x, bodyBounds.maxY - h * 0.46, c.z + h * 0.52], [c.x, bodyBounds.maxY - h * 0.46, c.z]],
    ['Pelvis',  [c.x, bodyBounds.maxY - h * 0.56, c.z + h * 0.52], [c.x, bodyBounds.maxY - h * 0.56, c.z]],
    ['Tam Boy', [c.x, c.y, c.z + h * 1.48], [c.x, c.y, c.z]]
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

function updateClip() {
  if (!sliceEnabled) { clipPlane.constant = 100; return; }
  if (sliceAxis === 'axial') clipPlane.normal.set(0, -1, 0);
  else if (sliceAxis === 'sagittal') clipPlane.normal.set(-1, 0, 0);
  else clipPlane.normal.set(0, 0, -1);
  clipPlane.constant = sliceValue;
}

function renderSliceSheet() {
  sheetTitle.textContent = 'Anatomik Kesit Düzlemi';
  const min = sliceAxis === 'axial' ? bodyBounds.minY : -0.6;
  const max = sliceAxis === 'axial' ? bodyBounds.maxY + 0.05 : 0.6;
  sheetBody.innerHTML = `
    <div class="cam-grid" style="margin-bottom:12px;">
      <button data-ax="axial" class="cam-tile ${sliceAxis === 'axial' ? 'active' : ''}">Aksiyel</button>
      <button data-ax="sagittal" class="cam-tile ${sliceAxis === 'sagittal' ? 'active' : ''}">Sagittal</button>
      <button data-ax="coronal" class="cam-tile ${sliceAxis === 'coronal' ? 'active' : ''}">Koronal</button>
    </div>
    <div class="slider-row" style="margin-bottom:12px;">
      <span>Kesit</span>
      <input id="slSlice" type="range" min="${min}" max="${max}" step="0.02" value="${Math.min(max, Math.max(min, sliceValue))}" />
    </div>
    <button id="btnToggleSlice" class="item-btn" style="text-align:center;">
      <strong>${sliceEnabled ? 'Kesiti Kapat' : 'Kesiti Etkinleştir'}</strong>
    </button>
  `;
  sheetBody.querySelectorAll('[data-ax]').forEach(b => {
    b.onclick = () => { sliceAxis = b.dataset.ax; sliceEnabled = true; sliceValue = sliceAxis === 'axial' ? bodyBounds.center.y : 0; updateClip(); renderSliceSheet(); };
  });
  document.getElementById('slSlice').oninput = (e) => { sliceEnabled = true; sliceValue = parseFloat(e.target.value); updateClip(); };
  document.getElementById('btnToggleSlice').onclick = () => { sliceEnabled = !sliceEnabled; updateClip(); renderSliceSheet(); };
}

function renderDetailSheet() {
  const target = selectedRecord || activeLandmark;
  if (!target) return;
  sheetTitle.textContent = activeLandmark ? 'Anatomik İşaret Noktası' : 'Yapı Detayı';
  const note = findClinicalNote(target.name + ' ' + target.latin);
  sheetBody.innerHTML = `
    <div class="detail-card">
      <p><strong>Adı:</strong> ${target.name}</p>
      <p><strong>Latince / TA2:</strong> ${target.latin} ${target.ta2 ? '(' + target.ta2 + ')' : ''}</p>
      <p><strong>Bölge:</strong> ${target.region}</p>
      ${note ? `<p><strong>Klinik Not:</strong> ${note}</p>` : ''}
      ${selectedRecord ? '<button id="btnDetFocus" class="item-btn" style="margin-top:10px;text-align:center;"><strong>Kamerayı Odakla</strong></button>' : ''}
    </div>
  `;
  const bf = document.getElementById('btnDetFocus');
  if (bf) bf.onclick = () => { focusRecord(selectedRecord); closeSheet(); };
}

// 3D Floating Pins projection (shows nearest 25 landmarks when Pins toggled OR always shows activeLandmark)
document.getElementById('btnPins').addEventListener('click', (e) => {
  pinsEnabled = !pinsEnabled;
  e.target.classList.toggle('active', pinsEnabled);
  toast(pinsEnabled ? 'Yakın anatomik noktalar açık' : 'Pinler gizlendi');
});

function updatePinsOverlay() {
  pinsLayer.innerHTML = '';
  if (!pinsEnabled && !activeLandmark) return;

  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  const list = [];

  if (activeLandmark) {
    list.push({ lm: activeLandmark, active: true });
  }
  if (pinsEnabled) {
    const camDist = camera.position.distanceTo(controls.target);
    const maxR = Math.max(0.25, camDist * 0.7);
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      if (!systemState[lm.system] || !systemState[lm.system].visible) continue;
      const wp = getLandmarkWorldPos(lm);
      const d = wp.distanceTo(controls.target);
      if (d <= maxR) list.push({ lm, active: lm === activeLandmark, d, wp });
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
    el.textContent = item.lm.name;
    el.onclick = () => focusLandmark(item.lm);
    pinsLayer.appendChild(el);
  });
}

document.getElementById('btnReset').addEventListener('click', () => {
  allStructures.forEach(r => { r.hidden = false; r.faded = false; });
  sliceEnabled = false;
  updateClip();
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
