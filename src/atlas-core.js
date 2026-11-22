// Saf, test edilebilir anatomi cekirdek motoru (gruplama, renk modu, izolasyon, arama, kamera guvenligi)

export const ATLAS_PALETTE = {
  artery:   0xd92626, // Parlak arteriyel kirmizi
  vein:     0x1d4ed8, // Koyu venoz mavi
  lymph:    0x16a34a, // Zumrut lenfatik yesil
  nerve:    0xeab308, // Parlak sinir sarisi
  heart:    0xb91c1c, // Miyokard kirmizisi
  ligament: 0x93c5fd, // Bag ve kikirdak buz mavisi
  muscle:   0x9f3535, // Cizgili kas tonu
  bone:     0xe5dac3, // Fildisi kemik tonu
  viscera:  0xc27b60  // Ic organ dogal tonu
};

export function inferSubtype(sysId, latin = '', name = '', region = '') {
  const txt = `${latin} ${name} ${region}`.toLowerCase();
  if (/(lymph|nodi |nodus |ductus thoracicus|cisterna chyli|spleen|thymus)/.test(txt)) return 'lymph';
  if (/(vein|vena |venae|venous|venosus|sinus |jugular|saphen|cava)/.test(txt)) return 'vein';
  if (/(artery|arteria|arteriae|aorta|carotid|coronar|truncus pulmonalis|arterios)/.test(txt)) return 'artery';
  if (/(heart|\bcor\b|atrium|ventric|myocard|pericard)/.test(txt)) return 'heart';
  if (sysId === 'nervous' || /(nerve|nervus|plexus|gangli|brain|cerebr|cerebell|spinal)/.test(txt)) return 'nerve';
  if (sysId === 'joints' || /(ligament|cartilag|menisc|discus|bursa|capsul)/.test(txt)) return 'ligament';
  if (sysId === 'muscular') return 'muscle';
  if (sysId === 'skeletal') return 'bone';
  return 'viscera';
}

// Blender glTF coklu-materyal mesh'lerini (Femur_0, Femur_1) tek anatomik yapida birlestirir
export function canonicalEntityKey(sysId, rawName, latin) {
  const base = (latin || rawName || '').replace(/(_\d+|\.\d{3})$/, '').trim().toLowerCase();
  return `${sysId}::${base}`;
}

export function createAtlasState() {
  return {
    systems: {},         // sysId -> { visible, opacity }
    entities: new Map(), // entityKey -> { id, latin, name, ta2, system, subtype, region, meshes: [], hidden: false, faded: false }
    landmarks: [],
    selectedId: null,
    activeLandmark: null,
    isolateMode: false,
    colorMode: 'natural', // 'natural' | 'atlas'
    sliceEnabled: false,
    sliceAxis: 'axial',
    sliceValue: 1.9
  };
}

export function registerMeshToEntity(state, meshInfo) {
  const key = canonicalEntityKey(meshInfo.system, meshInfo.meshName, meshInfo.latin);
  let ent = state.entities.get(key);
  if (!ent) {
    const subtype = meshInfo.subtype || inferSubtype(meshInfo.system, meshInfo.latin, meshInfo.name, meshInfo.region);
    ent = {
      id: key,
      latin: meshInfo.latin || meshInfo.name || meshInfo.meshName,
      name: meshInfo.name || meshInfo.meshName,
      ta2: meshInfo.ta2 || '',
      system: meshInfo.system,
      subtype,
      region: meshInfo.region || meshInfo.system,
      meshes: [],
      hidden: false,
      faded: false
    };
    state.entities.set(key, ent);
  }
  ent.meshes.push(meshInfo.meshRef);
  return ent;
}

export function computeEntityVisual(state, ent) {
  const sys = state.systems[ent.system] || { visible: true, opacity: 1.0 };
  const isSelected = state.selectedId === ent.id;

  let visible = sys.visible && !ent.hidden;
  if (state.isolateMode && state.selectedId) {
    visible = isSelected;
  }

  let opacity = ent.faded ? 0.22 : sys.opacity;
  if (isSelected && (!ent.faded || state.isolateMode)) {
    opacity = 1.0;
  }

  const transparent = opacity < 0.99;
  const colorHex = state.colorMode === 'atlas' ? (ATLAS_PALETTE[ent.subtype] || ATLAS_PALETTE.viscera) : null;

  return { visible, opacity, transparent, depthWrite: !transparent, isSelected, colorHex };
}

export function toggleIsolate(state) {
  if (!state.selectedId) {
    state.isolateMode = false;
    return false;
  }
  state.isolateMode = !state.isolateMode;
  if (state.isolateMode) {
    const ent = state.entities.get(state.selectedId);
    if (ent) {
      ent.hidden = false;
      ent.faded = false;
    }
  }
  return state.isolateMode;
}

export function searchAtlas(state, query, maxLandmarks = 40, maxEntities = 50) {
  const q = (query || '').trim().toLowerCase();
  const lm = [];
  if (q.length >= 2) {
    for (const l of state.landmarks) {
      if (
        (l.latin && l.latin.toLowerCase().includes(q)) ||
        (l.name && l.name.toLowerCase().includes(q)) ||
        (l.ta2 && l.ta2.toLowerCase().includes(q))
      ) {
        lm.push(l);
        if (lm.length >= maxLandmarks) break;
      }
    }
  }
  const ents = [];
  for (const e of state.entities.values()) {
    if (
      !q ||
      e.latin.toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q) ||
      e.ta2.toLowerCase().includes(q)
    ) {
      ents.push(e);
      if (ents.length >= maxEntities) break;
    }
  }
  return { landmarks: lm, entities: ents };
}

// Sifir-vektor korumali guvenli kamera odaklama hesaplayicisi
export function computeSafeFocusPose(camPos, targetPos, boxCenter, boxDiagonal) {
  let dx = camPos.x - targetPos.x;
  let dy = camPos.y - targetPos.y;
  let dz = camPos.z - targetPos.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) {
    dx = 0; dy = 0.08; dz = 1;
  } else {
    dx /= len; dy /= len; dz /= len;
  }
  const dist = Math.max(0.22, Math.min(2.4, (boxDiagonal || 0.25) * 2.15));
  return {
    target: { x: boxCenter.x, y: boxCenter.y, z: boxCenter.z },
    position: { x: boxCenter.x + dx * dist, y: boxCenter.y + dy * dist, z: boxCenter.z + dz * dist },
    distance: dist
  };
}

export function computeClipPlaneConfig(enabled, axis, value) {
  if (!enabled) return { normal: [0, -1, 0], constant: 100 };
  if (axis === 'axial') return { normal: [0, -1, 0], constant: value };
  if (axis === 'sagittal') return { normal: [-1, 0, 0], constant: value };
  return { normal: [0, 0, -1], constant: value };
}
