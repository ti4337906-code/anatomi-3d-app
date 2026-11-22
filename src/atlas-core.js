export const ATLAS_PALETTE = {
  artery:   0xd92626,
  vein:     0x1d4ed8,
  lymph:    0x16a34a,
  nerve:    0xeab308,
  heart:    0xb91c1c,
  ligament: 0x93c5fd,
  muscle:   0x9f3535,
  bone:     0xe5dac3,
  viscera:  0xc27b60
};

export const STUDY_PRESETS = {
  cor_detail:  { label: 'Cor & Koronerler',    systems: ['cor_detail'] },
  cor_hd:      { label: 'Cor HD (BT/MR İç)',   systems: ['cor_hd'] },
  enceph_hd:   { label: 'Encephalon HD (MR)',  systems: ['encephalon_hd'] },
  hra_organs:  { label: 'NIH BT Organlar',     systems: ['hra_cor', 'hra_pulmo', 'hra_hepar', 'hra_pancreas', 'hra_colon'] },
  resp_vasa:   { label: 'Respiratorium + Vasa', systems: ['respiratory', 'cor_detail', 'arteriae', 'venae'] },
  digest_vasa: { label: 'Digestorium + Vasa',  systems: ['digestive', 'arteriae', 'venae'] }
};

export function inferSubtype(sysId, latin = '', name = '', region = '') {
  const txt = `${latin} ${name} ${region}`.toLowerCase();
  if (sysId === 'cor_detail') {
    if (/(vein|vena |venae|sinus coronarius|cardiac vein)/.test(txt)) return 'vein';
    if (/(artery|arteria|coronar|interventricular|circumflex|marginal|aort)/.test(txt)) return 'artery';
    return 'heart';
  }
  if (sysId === 'cor_hd' || sysId === 'hra_cor') return 'heart';
  if (sysId === 'encephalon_hd') return 'nerve';
  if (sysId === 'lymphatica') return 'lymph';
  if (sysId === 'venae') return 'vein';
  if (/(lymph|nodi |nodus |ductus thoracicus|cisterna chyli|spleen|thymus)/.test(txt)) return 'lymph';
  if (/(vein|vena |venae|venous|venosus|jugular|saphen|cava)/.test(txt)) return 'vein';
  if (sysId === 'arteriae' || sysId === 'hra_vasa' || /(artery|arteria|arteriae|aorta|carotid|coronar|truncus pulmonalis)/.test(txt)) return 'artery';
  if (sysId === 'nervous' || /(nerve|nervus|plexus|gangli|brain|cerebr|cerebell|spinal)/.test(txt)) return 'nerve';
  if (sysId === 'joints' || /(ligament|cartilag|menisc|discus|bursa|capsul)/.test(txt)) return 'ligament';
  if (sysId === 'muscular') return 'muscle';
  if (sysId === 'skeletal' || sysId === 'hra_pelvis' || sysId.startsWith('dental_')) return 'bone';
  return 'viscera';
}

export function canonicalEntityKey(sysId, rawName, latin) {
  const base = (latin || rawName || '').replace(/(_\d+|\.\d{3})$/, '').trim().toLowerCase();
  return `${sysId}::${base}`;
}

export function createAtlasState() {
  return {
    systems: {},
    entities: new Map(),
    surfacePins: {},   // entityKey -> [{ latin, pos }]
    selectedId: null,
    isolateMode: false,
    colorMode: 'natural',
    sliceEnabled: false,
    sliceAxis: 'axial',
    sliceValue: 1.9
  };
}

export function unloadSystemEntities(state, sysId) {
  let removed = 0;
  for (const [key, ent] of state.entities.entries()) {
    if (ent.system === sysId) {
      if (state.selectedId === key) {
        state.selectedId = null;
        state.isolateMode = false;
      }
      state.entities.delete(key);
      removed++;
    }
  }
  return removed;
}

export function getActiveSurfacePins(state) {
  if (!state.isolateMode || !state.selectedId) return [];
  return state.surfacePins[state.selectedId] || [];
}

export function applyStudyPreset(state, presetKey) {
  const preset = STUDY_PRESETS[presetKey];
  if (!preset) return [];
  state.isolateMode = false;
  state.selectedId = null;
  const active = [];
  for (const sysId of Object.keys(state.systems)) {
    const on = preset.systems.includes(sysId);
    state.systems[sysId].visible = on;
    if (on) {
      state.systems[sysId].opacity = 1.0;
      active.push(sysId);
    }
  }
  return active;
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

export function searchAtlas(state, query, maxEntities = 60) {
  const q = (query || '').trim().toLowerCase();
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
  return ents;
}

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
  const dist = Math.max(0.18, Math.min(2.4, (boxDiagonal || 0.25) * 2.1));
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
