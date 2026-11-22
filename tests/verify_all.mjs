import assert from 'node:assert/strict';
import {
  ATLAS_PALETTE,
  STUDY_PRESETS,
  inferSubtype,
  createAtlasState,
  applyStudyPreset,
  registerMeshToEntity,
  computeEntityVisual,
  toggleIsolate,
  searchAtlas,
  computeSafeFocusPose,
  computeClipPlaneConfig
} from '../src/atlas-core.js';

let passed = 0;
function runTest(name, fn) {
  fn();
  passed++;
  console.log(`[PASS] ${name}`);
}

function makeFixture() {
  const st = createAtlasState();
  st.systems = {
    cor_hd:      { visible: false, opacity: 1.0 },
    arteriae:    { visible: true,  opacity: 1.0 },
    venae:       { visible: true,  opacity: 1.0 },
    lymphatica:  { visible: true,  opacity: 1.0 },
    respiratory: { visible: true,  opacity: 1.0 },
    digestive:   { visible: true,  opacity: 1.0 },
    skeletal:    { visible: true,  opacity: 1.0 },
    nervous:     { visible: true,  opacity: 1.0 }
  };

  registerMeshToEntity(st, { system: 'skeletal', meshName: 'Femur_0', latin: 'Os femoris (Dexter)', name: 'Femur (Dexter)', ta2: '1360', region: 'Systema skeletale', meshRef: { id: 'f0' } });
  registerMeshToEntity(st, { system: 'skeletal', meshName: 'Femur_1', latin: 'Os femoris (Dexter)', name: 'Femur (Dexter)', ta2: '1360', region: 'Systema skeletale', meshRef: { id: 'f1' } });
  registerMeshToEntity(st, { system: 'arteriae', meshName: 'Aorta_0', latin: 'Aorta ascendens', name: 'Ascending aorta', ta2: '4120', region: 'Arteriae', meshRef: { id: 'a0' } });
  registerMeshToEntity(st, { system: 'arteriae', meshName: 'Cor_0', latin: 'Cor', name: 'Heart', ta2: '3950', region: 'Cor', meshRef: { id: 'c0' } });
  registerMeshToEntity(st, { system: 'venae', meshName: 'VenaCava_0', latin: 'Vena cava superior', name: 'Superior vena cava', ta2: '4800', region: 'Venae', meshRef: { id: 'v0' } });
  registerMeshToEntity(st, { system: 'lymphatica', meshName: 'DuctusThor_0', latin: 'Ductus thoracicus', name: 'Thoracic duct', ta2: '5100', region: 'Systema lymphoideum', meshRef: { id: 'l0' } });
  registerMeshToEntity(st, { system: 'respiratory', meshName: 'PulmoD_0', latin: 'Pulmo dexter', name: 'Right lung', ta2: '3280', region: 'Systema respiratorium', meshRef: { id: 'p0' } });
  registerMeshToEntity(st, { system: 'digestive', meshName: 'Hepar_0', latin: 'Hepar', name: 'Liver', ta2: '3100', region: 'Systema digestorium', meshRef: { id: 'h0' } });
  registerMeshToEntity(st, { system: 'nervous', meshName: 'NervusVagus_0', latin: 'Nervus vagus', name: 'Vagus nerve', ta2: '6300', region: 'Nervi craniales', meshRef: { id: 'n0' } });

  st.landmarks = [
    { latin: 'Ostium sinus coronarii', name: 'Opening of coronary sinus', ta2: '4051', system: 'arteriae', region: 'Atrium dextrum', pos: [0.02, 1.25, 0.05] },
    { latin: 'Carina tracheae', name: 'Carina of trachea', ta2: '3240', system: 'respiratory', region: 'Trachea', pos: [0.0, 1.32, 0.01] },
    { latin: 'Papilla duodeni major', name: 'Major duodenal papilla', ta2: '3055', system: 'digestive', region: 'Duodenum', pos: [-0.03, 1.05, 0.02] }
  ];
  return st;
}

// 1. Atlas Color Coding (3 rounds)
for (let r = 1; r <= 3; r++) {
  runTest(`Atlas Renklendirme (Arter/Ven/Lenf/Sinir/Kalp) Tur ${r}/3`, () => {
    const st = makeFixture();
    st.colorMode = 'atlas';
    const byLat = (s) => [...st.entities.values()].find(e => e.latin.includes(s));
    assert.equal(computeEntityVisual(st, byLat('Aorta')).colorHex, ATLAS_PALETTE.artery);
    assert.equal(computeEntityVisual(st, byLat('Vena cava')).colorHex, ATLAS_PALETTE.vein);
    assert.equal(computeEntityVisual(st, byLat('Ductus thoracicus')).colorHex, ATLAS_PALETTE.lymph);
    assert.equal(computeEntityVisual(st, byLat('Nervus vagus')).colorHex, ATLAS_PALETTE.nerve);
    assert.equal(computeEntityVisual(st, byLat('Cor')).colorHex, ATLAS_PALETTE.heart);
  });
}

// 2. Study Presets (Cardio, Respiratory, Digestive, Cor HD — 4 tests)
['cardio_all', 'resp_vasa', 'digest_vasa', 'cor_hd'].forEach((pk, idx) => {
  runTest(`Hizli Calisma On Ayari (${idx + 1}/4: ${STUDY_PRESETS[pk].label})`, () => {
    const st = makeFixture();
    const enabled = applyStudyPreset(st, pk);
    assert.deepEqual(enabled.sort(), [...STUDY_PRESETS[pk].systems].sort());
    for (const [sid, s] of Object.entries(st.systems)) {
      assert.equal(s.visible, STUDY_PRESETS[pk].systems.includes(sid));
    }
  });
});

// 3. Multi-mesh Isolation & Restore (3 structures)
['Os femoris', 'Pulmo dexter', 'Hepar'].forEach((nm, idx) => {
  runTest(`Izolasyon & Geri Alma (${idx + 1}/3: ${nm})`, () => {
    const st = makeFixture();
    const target = [...st.entities.values()].find(e => e.latin.includes(nm));
    st.selectedId = target.id;
    target.faded = true;
    assert.equal(toggleIsolate(st), true);
    assert.equal(computeEntityVisual(st, target).visible, true);
    assert.equal(computeEntityVisual(st, target).transparent, false);
    assert.equal(toggleIsolate(st), false);
  });
});

// 4. Solid Opaque vs Fade/Hide (3 rounds)
for (let r = 1; r <= 3; r++) {
  runTest(`Kati Render & Fade/Gizle (Tur ${r}/3)`, () => {
    const st = makeFixture();
    const ent = [...st.entities.values()][r];
    assert.equal(computeEntityVisual(st, ent).transparent, false);
    ent.faded = true;
    assert.equal(computeEntityVisual(st, ent).transparent, true);
    ent.hidden = true;
    assert.equal(computeEntityVisual(st, ent).visible, false);
  });
}

// 5. Latin TA2 Search across Cardio, Respiratory & Digestive Landmarks (3 queries)
['Ostium sinus coronarii', 'Carina tracheae', 'Papilla duodeni major'].forEach((q, idx) => {
  runTest(`Latince TA2 Landmark Arama (${idx + 1}/3: ${q})`, () => {
    const st = makeFixture();
    const res = searchAtlas(st, q);
    assert.equal(res.landmarks.length, 1);
    assert.equal(res.landmarks[0].latin, q);
  });
});

// 6. Safe Camera Focus (3 scenarios)
[
  { cam: { x: 0, y: 1, z: 0 }, tgt: { x: 0, y: 1, z: 0 }, box: { x: 0, y: 1, z: 0 }, diag: 0.3 },
  { cam: { x: 0, y: 1.2, z: 2.5 }, tgt: { x: 0, y: 0.9, z: 0 }, box: { x: 0.02, y: 1.25, z: 0.05 }, diag: 0.02 },
  { cam: { x: -1, y: 0.5, z: 1.5 }, tgt: { x: 0, y: 0.5, z: 0 }, box: { x: 0.1, y: 0.6, z: 0 }, diag: 0.5 }
].forEach((sc, idx) => {
  runTest(`Guvenli Kamera Odaklama (${idx + 1}/3)`, () => {
    const pose = computeSafeFocusPose(sc.cam, sc.tgt, sc.box, sc.diag);
    const d = Math.hypot(pose.position.x - pose.target.x, pose.position.y - pose.target.y, pose.position.z - pose.target.z);
    assert.ok(d >= 0.219 && d <= 2.401);
  });
});

// 7. 3-Axis Clipping Plane (3 axes)
['axial', 'sagittal', 'coronal'].forEach((ax, idx) => {
  runTest(`Kesit Duzlemi (${idx + 1}/3: ${ax})`, () => {
    assert.equal(computeClipPlaneConfig(false, ax, 0.5).constant, 100);
    assert.equal(computeClipPlaneConfig(true, ax, 0.75).constant, 0.75);
  });
});

console.log(`\nTUM TESTLER BASARILI: ${passed}/${passed} gecti.`);
