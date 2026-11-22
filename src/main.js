import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { findClinicalNote } from './anatomy-tr.js';

const viewport = document.getElementById('viewport');
const statusChip = document.getElementById('statusChip');
const sheet = document.getElementById('sheet');
const sheetTitle = document.getElementById('sheetTitle');
const sheetBody = document.getElementById('sheetBody');
const selectedPill = document.getElementById('selectedPill');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, viewport.clientWidth / viewport.clientHeight, 0.01, 200);
camera.position.set(0, 1.0, 2.8);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.localClippingEnabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.9, 0);
controls.minDistance = 0.15;
controls.maxDistance = 12;

// Guclu medikal isiklandirma (her acidan net)
scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 1.15));
const dir1 = new THREE.DirectionalLight(0xffffff, 1.25);
dir1.position.set(4, 6, 6);
scene.add(dir1);
const dir2 = new THREE.DirectionalLight(0x7dd3fc, 0.75);
dir2.position.set(-5, 3, -5);
scene.add(dir2);

const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
const gltfLoader = new GLTFLoader();
const modelRoot = new THREE.Group();
scene.add(modelRoot);

let manifest = null;
const systemState = {};
const allStructures = [];
const meshToRecord = new Map();

let selectedRecord = null;
let xrayMode = false;
let isolateMode = false;
let sliceEnabled = false;
let sliceAxis = 'axial';
let sliceValue = 1.9;
let activeSheet = null;
let bodyBounds = { minY: 0, maxY: 1.85, center: new THREE.Vector3(0, 0.92, 0), height: 1.85 };

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

// =========================================================================
// MODEL YUKLEME VE OTOMATIK KADRAJ
// =========================================================================
async function init() {
  try {
    const res = await fetch('./models/manifest.json');
    if (!res.ok) throw new Error('manifest.json okunamadı');
    manifest = await res.json();
  } catch (e) {
    statusChip.textContent = 'Model bulunamadı';
    toast('Model manifesti eksik: ' + e.message);
    return;
  }

  manifest.systems.forEach((sys, idx) => {
    const g = new THREE.Group();
    modelRoot.add(g);
    // Hizli ve garanti acilis: ilk olarak iskelet acik, digerleri tek tikla yuklenir
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
  statusChip.textContent = `${allStructures.length} yapı hazır`;
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
          const m = obj.material ? obj.material.clone() : new THREE.MeshStandardMaterial({ color: st.meta.color });
          m.side = THREE.DoubleSide;
          m.transparent = true;
          m.clippingPlanes = [clipPlane];
          m.userData.baseEmissive = m.emissive ? m.emissive.clone() : new THREE.Color(0x000000);
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
            mat: m
          };
          allStructures.push(rec);
          meshToRecord.set(obj, rec);
        });
        st.group.add(root);
        st.loaded = true;
        st.loading = false;
        statusChip.textContent = `${allStructures.length} yapı yüklü`;
        resolve();
      },
      undefined,
      (err) => {
        console.error(err);
        st.loading = false;
        statusChip.textContent = `Hata: ${sysId}`;
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
    const dist = Math.max(size.x, size.y, size.z) * 1.45;
    controls.target.copy(center);
    camera.position.set(center.x, center.y + 0.05, center.z + dist);
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

    let op = sys.opacity;
    if (xrayMode && !isSel) op = Math.min(op, 0.14);
    if (isSel) {
      op = 1.0;
      rec.mat.emissive.setHex(0x00e5ff);
      rec.mat.emissiveIntensity = 0.65;
    } else {
      rec.mat.emissive.copy(rec.mat.userData.baseEmissive);
      rec.mat.emissiveIntensity = 1.0;
    }
    rec.mat.opacity = op;
    rec.mat.depthWrite = op >= 0.85;
  });
}

// =========================================================================
// SECIM VE DOKUNMATIK RAYCAST
// =========================================================================
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downXY = { x: 0, y: 0 };

renderer.domElement.addEventListener('pointerdown', e => {
  downXY = { x: e.clientX, y: e.clientY };
});

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
  selectedRecord = rec;
  document.getElementById('pillName').textContent = rec.name;
  document.getElementById('pillLatin').textContent = rec.latin;
  selectedPill.classList.remove('hidden');
  refreshMaterials();
  if (focus) focusRecord(rec);
}

function clearSelection() {
  selectedRecord = null;
  isolateMode = false;
  document.getElementById('btnPillIsolate').classList.remove('active');
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
  camera.position.copy(c).addScaledVector(dir, Math.max(0.32, Math.min(2.2, sz * 2.3)));
  controls.update();
}

document.getElementById('btnOpenDetailFromPill').addEventListener('click', () => selectedRecord && openSheet('detail'));
document.getElementById('btnPillClose').addEventListener('click', clearSelection);
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
  refreshMaterials();
});

// =========================================================================
// ALT CEKMECE ICERIKLERI
// =========================================================================
function renderSystemsSheet() {
  sheetTitle.textContent = 'Anatomik Sistemler';
  sheetBody.innerHTML = '';

  const hiddenCount = allStructures.filter(r => r.hidden).length;
  if (hiddenCount > 0) {
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'item-btn';
    restoreBtn.innerHTML = `<strong>Gizli Yapıları Geri Getir (${hiddenCount})</strong>`;
    restoreBtn.onclick = () => {
      allStructures.forEach(r => { r.hidden = false; });
      refreshMaterials();
      renderSystemsSheet();
      toast('Tüm gizli yapılar açıldı');
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
        <input type="range" min="0.05" max="1" step="0.05" value="${st.opacity}" />
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
  sheetTitle.textContent = `Yapı Ara (${allStructures.length} yüklü)`;
  sheetBody.innerHTML = '<input id="sInput" class="search-box" type="search" placeholder="Kemik, kas, arter, sinir ara..." /><div id="sList"></div>';
  const input = document.getElementById('sInput');
  const list = document.getElementById('sList');

  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const matches = allStructures.filter(r =>
      !q || r.name.toLowerCase().includes(q) || r.latin.toLowerCase().includes(q) || r.ta2.toLowerCase().includes(q)
    ).slice(0, 80);

    list.innerHTML = '';
    if (!matches.length) {
      list.innerHTML = '<div class="sys-meta">Eşleşen yapı yok (önce ilgili sistemi açın).</div>';
      return;
    }
    matches.forEach(rec => {
      const b = document.createElement('button');
      b.className = 'item-btn';
      b.innerHTML = `<strong>${rec.name}</strong><small>${rec.latin}</small>`;
      b.onclick = () => { selectRecord(rec, true); closeSheet(); };
      list.appendChild(b);
    });
  };
  input.oninput = draw;
  draw();
}

function renderCameraSheet() {
  sheetTitle.textContent = 'Kamera Açıları';
  const c = bodyBounds.center;
  const h = bodyBounds.height;
  const views = [
    ['Ön',      [c.x, c.y, c.z + h * 1.45], [c.x, c.y, c.z]],
    ['Arka',    [c.x, c.y, c.z - h * 1.45], [c.x, c.y, c.z]],
    ['Sağ Yan', [c.x - h * 1.45, c.y, c.z], [c.x, c.y, c.z]],
    ['Sol Yan', [c.x + h * 1.45, c.y, c.z], [c.x, c.y, c.z]],
    ['Baş',     [c.x, bodyBounds.maxY - h * 0.1, c.z + h * 0.42], [c.x, bodyBounds.maxY - h * 0.1, c.z]],
    ['Toraks',  [c.x, bodyBounds.maxY - h * 0.3, c.z + h * 0.55], [c.x, bodyBounds.maxY - h * 0.3, c.z]],
    ['Abdomen', [c.x, bodyBounds.maxY - h * 0.46, c.z + h * 0.55], [c.x, bodyBounds.maxY - h * 0.46, c.z]],
    ['Pelvis',  [c.x, bodyBounds.maxY - h * 0.56, c.z + h * 0.55], [c.x, bodyBounds.maxY - h * 0.56, c.z]],
    ['Tam Boy', [c.x, c.y, c.z + h * 1.5], [c.x, c.y, c.z]]
  ];
  sheetBody.innerHTML = '<div class="cam-grid"></div>';
  const grid = sheetBody.querySelector('.cam-grid');
  views.forEach(([label, pos, tgt]) => {
    const b = document.createElement('button');
    b.className = 'cam-tile';
    b.textContent = label;
    b.onclick = () => {
      camera.position.set(...pos);
      controls.target.set(...tgt);
      controls.update();
      closeSheet();
    };
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
    b.onclick = () => {
      sliceAxis = b.dataset.ax;
      sliceEnabled = true;
      sliceValue = sliceAxis === 'axial' ? bodyBounds.center.y : 0;
      updateClip();
      renderSliceSheet();
    };
  });
  document.getElementById('slSlice').oninput = (e) => {
    sliceEnabled = true;
    sliceValue = parseFloat(e.target.value);
    updateClip();
  };
  document.getElementById('btnToggleSlice').onclick = () => {
    sliceEnabled = !sliceEnabled;
    updateClip();
    renderSliceSheet();
  };
}

function renderDetailSheet() {
  if (!selectedRecord) return;
  sheetTitle.textContent = 'Yapı Detayı';
  const note = findClinicalNote(selectedRecord.name + ' ' + selectedRecord.latin);
  sheetBody.innerHTML = `
    <div class="detail-card">
      <p><strong>Adı:</strong> ${selectedRecord.name}</p>
      <p><strong>Latince / TA2:</strong> ${selectedRecord.latin} ${selectedRecord.ta2 ? '(' + selectedRecord.ta2 + ')' : ''}</p>
      <p><strong>Bölge:</strong> ${selectedRecord.region}</p>
      ${note ? `<p><strong>Klinik Not:</strong> ${note}</p>` : ''}
      <button id="btnDetFocus" class="item-btn" style="margin-top:10px;text-align:center;"><strong>Kamerayı Odakla</strong></button>
    </div>
  `;
  document.getElementById('btnDetFocus').onclick = () => { focusRecord(selectedRecord); closeSheet(); };
}

document.getElementById('btnXray').addEventListener('click', (e) => {
  xrayMode = !xrayMode;
  e.target.classList.toggle('active', xrayMode);
  refreshMaterials();
});

document.getElementById('btnReset').addEventListener('click', () => {
  allStructures.forEach(r => { r.hidden = false; });
  xrayMode = false;
  document.getElementById('btnXray').classList.remove('active');
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

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
init();
