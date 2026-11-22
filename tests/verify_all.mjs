import assert from 'node:assert/strict';
import { formatBenchmarkReport } from '../src/benchmark.js';
import {
  ATLAS_PALETTE,
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
} from '../src/atlas-core.js';
import { findClinicalInfo } from '../src/anatomy-tr.js';

let passed = 0;
function runTest(name, fn) {
  fn();
  passed++;
  console.log(`[PASS] ${name}`);
}

function makeFixture() {
  const st = createAtlasState();
  st.systems = {
    cor_detail:    { visible: true,  opacity: 1.0 },
    cor_hd:        { visible: false, opacity: 1.0 },
    encephalon_hd: { visible: false, opacity: 1.0 },
    hra_cor:       { visible: false, opacity: 1.0 },
    hra_pulmo:     { visible: false, opacity: 1.0 },
    hra_hepar:     { visible: false, opacity: 1.0 },
    hra_pancreas:  { visible: false, opacity: 1.0 },
    hra_colon:     { visible: false, opacity: 1.0 },
    arteriae:      { visible: true,  opacity: 1.0 },
    venae:         { visible: true,  opacity: 1.0 },
    lymphatica:    { visible: true,  opacity: 1.0 },
    respiratory:   { visible: true,  opacity: 1.0 },
    digestive:     { visible: true,  opacity: 1.0 },
    skeletal:      { visible: true,  opacity: 1.0 },
    nervous:       { visible: true,  opacity: 1.0 }
  };

  registerMeshToEntity(st, { system: 'cor_detail', meshName: 'Left_coronary_artery_0', latin: 'Arteria coronaria sinistra', name: 'Left coronary artery', ta2: '4130', region: 'Cor', meshRef: { id: 'lca' } });
  registerMeshToEntity(st, { system: 'cor_detail', meshName: 'Coronary_sinus_0', latin: 'Sinus coronarius', name: 'Coronary sinus', ta2: '4900', region: 'Cor', meshRef: { id: 'cs' } });
  registerMeshToEntity(st, { system: 'cor_detail', meshName: 'Mitral_valve_0', latin: 'Valva mitralis', name: 'Mitral valve', ta2: '4080', region: 'Cor', meshRef: { id: 'mv' } });
  const frontale = registerMeshToEntity(st, { system: 'skeletal', meshName: 'Os_frontale_0', latin: 'Os frontale', name: 'Frontal bone', ta2: '0410', region: 'Cranium', meshRef: { id: 'fr0' } });
  registerMeshToEntity(st, { system: 'skeletal', meshName: 'Os_frontale_1', latin: 'Os frontale', name: 'Frontal bone', ta2: '0410', region: 'Cranium', meshRef: { id: 'fr1' } });
  registerMeshToEntity(st, { system: 'hra_hepar', meshName: 'HRA_Liver_0', latin: 'Hepar (NIH HRA)', name: 'Liver', ta2: '3100', region: 'CT/HRA', meshRef: { id: 'hl0' } });
  registerMeshToEntity(st, { system: 'lymphatica', meshName: 'Ductus_0', latin: 'Ductus thoracicus', name: 'Thoracic duct', ta2: '5100', region: 'Lymphatica', meshRef: { id: 'l0' } });
  registerMeshToEntity(st, { system: 'nervous', meshName: 'Vagus_0', latin: 'Nervus vagus', name: 'Vagus nerve', ta2: '6300', region: 'Nervosum', meshRef: { id: 'n0' } });

  st.surfacePins[frontale.id] = [
    { latin: 'Fossa glandulae lacrimalis', pos: [0.05, 1.68, 0.08] },
    { latin: 'Incisura supraorbitalis', pos: [0.03, 1.70, 0.09] },
    { latin: 'Sinus frontalis', pos: [0.01, 1.71, 0.09] }
  ];
  return st;
}

// 1. Surface-Snapped Osteology Pins (ONLY visible when isolated — 3 rounds)
for (let r = 1; r <= 3; r++) {
  runTest(`Yuzeye Kilitli Osteoloji Pinleri (Tur ${r}/3)`, () => {
    const st = makeFixture();
    const frontale = [...st.entities.values()].find(e => e.latin === 'Os frontale');
    assert.equal(frontale.meshes.length, 2);
    st.selectedId = frontale.id;
    // Before isolate: zero clutter
    assert.equal(getActiveSurfacePins(st).length, 0);
    // After isolate: exact frontal bone surface pins appear
    toggleIsolate(st);
    assert.equal(getActiveSurfacePins(st).length, 3);
    assert.equal(getActiveSurfacePins(st)[0].latin, 'Fossa glandulae lacrimalis');
    // Unisolate: pins hide again
    toggleIsolate(st);
    assert.equal(getActiveSurfacePins(st).length, 0);
  });
}

// 2. GPU Memory Unload (3 rounds)
for (let r = 1; r <= 3; r++) {
  runTest(`GPU Bellek Bosaltma (dispose/unload) Tur ${r}/3`, () => {
    const st = makeFixture();
    const removed = unloadSystemEntities(st, 'hra_hepar');
    assert.equal(removed, 1);
    assert.equal([...st.entities.values()].filter(e => e.system === 'hra_hepar').length, 0);
  });
}

// 3. Multi-Source CT/MRI Presets (NIH HRA, Cor HD, Encephalon HD, Cor & Koronerler)
['cor_detail', 'cor_hd', 'enceph_hd', 'hra_organs', 'resp_vasa'].forEach((pk, idx) => {
  runTest(`Coklu BT/MR On Ayari (${idx + 1}/5: ${STUDY_PRESETS[pk].label})`, () => {
    const st = makeFixture();
    const enabled = applyStudyPreset(st, pk);
    assert.deepEqual(enabled.sort(), [...STUDY_PRESETS[pk].systems].sort());
  });
});

// 4. Coronary & Atlas Color Coding (3 rounds)
for (let r = 1; r <= 3; r++) {
  runTest(`Koroner & Atlas Renklendirme (Tur ${r}/3)`, () => {
    const st = makeFixture();
    st.colorMode = 'atlas';
    const byLat = (s) => [...st.entities.values()].find(e => e.latin.includes(s));
    assert.equal(computeEntityVisual(st, byLat('Arteria coronaria')).colorHex, ATLAS_PALETTE.artery);
    assert.equal(computeEntityVisual(st, byLat('Sinus coronarius')).colorHex, ATLAS_PALETTE.vein);
    assert.equal(computeEntityVisual(st, byLat('Valva mitralis')).colorHex, ATLAS_PALETTE.heart);
    assert.equal(computeEntityVisual(st, byLat('Ductus thoracicus')).colorHex, ATLAS_PALETTE.lymph);
    assert.equal(computeEntityVisual(st, byLat('Nervus vagus')).colorHex, ATLAS_PALETTE.nerve);
  });
}

// 5. Clinical Dictionary (3 queries)
[
  ['Arteria coronaria sinistra', 'Sol Koroner Arter'],
  ['Valva mitralis', 'Mitral'],
  ['Hepar', 'Karaciğer']
].forEach(([lat, tr], idx) => {
  runTest(`Klinik Sozluk (${idx + 1}/3: ${lat})`, () => {
    const info = findClinicalInfo(lat, '');
    assert.ok(info && info.tr.includes(tr));
  });
});

// 6. TA2 Search (3 queries)
['Os frontale', 'Arteria coronaria', 'Valva mitralis'].forEach((q, idx) => {
  runTest(`Latince TA2 Arama (${idx + 1}/3: ${q})`, () => {
    const st = makeFixture();
    assert.ok(searchAtlas(st, q).length >= 1);
  });
});

// 7. Safe Camera Focus (3 scenarios)
[
  { cam: { x: 0, y: 1, z: 0 }, tgt: { x: 0, y: 1, z: 0 }, box: { x: 0, y: 1, z: 0 }, diag: 0.3 },
  { cam: { x: 0, y: 1.2, z: 2.5 }, tgt: { x: 0, y: 0.9, z: 0 }, box: { x: 0.02, y: 1.25, z: 0.05 }, diag: 0.02 },
  { cam: { x: -1, y: 0.5, z: 1.5 }, tgt: { x: 0, y: 0.5, z: 0 }, box: { x: 0.1, y: 0.6, z: 0 }, diag: 0.5 }
].forEach((sc, idx) => {
  runTest(`Guvenli Kamera Odaklama (${idx + 1}/3)`, () => {
    const pose = computeSafeFocusPose(sc.cam, sc.tgt, sc.box, sc.diag);
    const d = Math.hypot(pose.position.x - pose.target.x, pose.position.y - pose.target.y, pose.position.z - pose.target.z);
    assert.ok(d >= 0.179 && d <= 2.401);
  });
});

// 8. 3-Axis Clipping Plane (3 axes)
['axial', 'sagittal', 'coronal'].forEach((ax, idx) => {
  runTest(`Kesit Duzlemi (${idx + 1}/3: ${ax})`, () => {
    assert.equal(computeClipPlaneConfig(false, ax, 0.5).constant, 100);
    assert.equal(computeClipPlaneConfig(true, ax, 0.75).constant, 0.75);
  });
});



// 9. Benchmark Report Formatter (3 rounds)
for (let r = 1; r <= 3; r++) {
  runTest(`Benchmark Rapor Formati (Tur ${r}/3)`, () => {
    const txt = formatBenchmarkReport(
      [
        { name: 'Koroner Arterler', status: 'PASS', detail: '8 aktif damar' },
        { name: 'BT/MR Modulleri', status: 'FAIL', detail: '0 modul' }
      ],
      { avgFps: 58, minFps: 42, drawCalls: 120, triangles: 450000, geometries: 85 }
    );
    assert.ok(txt.includes('1 PASS | 0 WARN | 1 FAIL'));
    assert.ok(txt.includes('Ort 58 FPS'));
    assert.ok(txt.includes('[PASS] Koroner Arterler'));
    assert.ok(txt.includes('[FAIL] BT/MR Modulleri'));
  });
}

console.log(`\nTUM TESTLER BASARILI: ${passed}/${passed} gecti.`);
