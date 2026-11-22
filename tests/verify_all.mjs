import assert from 'node:assert/strict';
import {
  ATLAS_PALETTE,
  inferSubtype,
  createAtlasState,
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

// Setup realistic multi-primitive anatomical dataset
function makeFixture() {
  const st = createAtlasState();
  st.systems = {
    skeletal:       { visible: true,  opacity: 1.0 },
    cardiovascular: { visible: true,  opacity: 1.0 },
    nervous:        { visible: true,  opacity: 1.0 },
    joints:         { visible: false, opacity: 1.0 }
  };

  // Multi-mesh bone (Os femoris split into 2 glTF primitives)
  registerMeshToEntity(st, { system: 'skeletal', meshName: 'Femur_0', latin: 'Os femoris (Dexter)', name: 'Femur (Dexter)', ta2: '1360', region: 'Systema skeletale', meshRef: { id: 'f0' } });
  registerMeshToEntity(st, { system: 'skeletal', meshName: 'Femur_1', latin: 'Os femoris (Dexter)', name: 'Femur (Dexter)', ta2: '1360', region: 'Systema skeletale', meshRef: { id: 'f1' } });
  registerMeshToEntity(st, { system: 'skeletal', meshName: 'Cranium_0', latin: 'Cranium', name: 'Skull', ta2: '0400', region: 'Systema skeletale', meshRef: { id: 'c0' } });
  registerMeshToEntity(st, { system: 'skeletal', meshName: 'Humerus_0', latin: 'Humerus (Sinister)', name: 'Humerus (Sinister)', ta2: '1180', region: 'Systema skeletale', meshRef: { id: 'h0' } });

  // Artery, Vein, Lymph, Nerve
  registerMeshToEntity(st, { system: 'cardiovascular', meshName: 'Aorta_0', latin: 'Aorta ascendens', name: 'Ascending aorta', ta2: '4120', region: 'Arteriae', meshRef: { id: 'a0' } });
  registerMeshToEntity(st, { system: 'cardiovascular', meshName: 'VenaCava_0', latin: 'Vena cava superior', name: 'Superior vena cava', ta2: '4800', region: 'Venae', meshRef: { id: 'v0' } });
  registerMeshToEntity(st, { system: 'cardiovascular', meshName: 'DuctusThor_0', latin: 'Ductus thoracicus', name: 'Thoracic duct', ta2: '5100', region: 'Systema lymphoideum', meshRef: { id: 'l0' } });
  registerMeshToEntity(st, { system: 'nervous', meshName: 'NervusVagus_0', latin: 'Nervus vagus', name: 'Vagus nerve', ta2: '6300', region: 'Nervi craniales', meshRef: { id: 'n0' } });

  st.landmarks = [
    { latin: 'Ostium sinus coronarii', name: 'Opening of coronary sinus', ta2: '4051', system: 'cardiovascular', region: 'Atrium dextrum', pos: [0.02, 1.25, 0.05] },
    { latin: 'Foramen magnum', name: 'Foramen magnum', ta2: '0560', system: 'skeletal', region: 'Os occipitale', pos: [0.0, 1.62, -0.02] },
    { latin: 'Sulcus intertubercularis', name: 'Intertubercular sulcus', ta2: '1192', system: 'skeletal', region: 'Humerus', pos: [0.22, 1.38, 0.01] }
  ];
  return st;
}

// 1. Subtype & Atlas Color Mode (tested 3+ times across Artery/Vein/Lymph/Nerve/Bone)
for (let round = 1; round <= 3; round++) {
  runTest(`Atlas Renklendirme & Alt Tip Siniflandirma (Tur ${round}/3)`, () => {
    const st = makeFixture();
    assert.equal(inferSubtype('cardiovascular', 'Aorta ascendens', '', 'Arteriae'), 'artery');
    assert.equal(inferSubtype('cardiovascular', 'Vena cava superior', '', 'Venae'), 'vein');
    assert.equal(inferSubtype('cardiovascular', 'Ductus thoracicus', '', 'Lymph'), 'lymph');
    assert.equal(inferSubtype('nervous', 'Nervus vagus', '', 'Nervi'), 'nerve');

    // Natural mode -> colorHex null (keeps Z-Anatomy original color)
    st.colorMode = 'natural';
    for (const ent of st.entities.values()) {
      assert.equal(computeEntityVisual(st, ent).colorHex, null);
    }

    // Atlas mode -> red artery, blue vein, green lymph, yellow nerve
    st.colorMode = 'atlas';
    const aorta = [...st.entities.values()].find(e => e.latin.includes('Aorta'));
    const vena = [...st.entities.values()].find(e => e.latin.includes('Vena cava'));
    const lymph = [...st.entities.values()].find(e => e.latin.includes('Ductus thoracicus'));
    const nerve = [...st.entities.values()].find(e => e.latin.includes('Nervus vagus'));

    assert.equal(computeEntityVisual(st, aorta).colorHex, ATLAS_PALETTE.artery);
    assert.equal(computeEntityVisual(st, vena).colorHex, ATLAS_PALETTE.vein);
    assert.equal(computeEntityVisual(st, lymph).colorHex, ATLAS_PALETTE.lymph);
    assert.equal(computeEntityVisual(st, nerve).colorHex, ATLAS_PALETTE.nerve);
  });
}

// 2. Multi-primitive Bone Grouping & Isolate/Unisolate (3 different bones, 3 cycles)
const isolateTargets = ['Os femoris', 'Cranium', 'Humerus'];
isolateTargets.forEach((boneName, idx) => {
  runTest(`Coklu-Mesh Kemik Izolasyonu & Geri Alma (${idx + 1}/3: ${boneName})`, () => {
    const st = makeFixture();
    const femur = [...st.entities.values()].find(e => e.latin.includes('Os femoris'));
    assert.equal(femur.meshes.length, 2, 'Femur_0 ve Femur_1 tek kemikte birlesmeli');

    const target = [...st.entities.values()].find(e => e.latin.includes(boneName));
    st.selectedId = target.id;
    target.faded = true; // even if faded before isolate, isolate must restore opaque!

    assert.equal(toggleIsolate(st), true);
    for (const ent of st.entities.values()) {
      const v = computeEntityVisual(st, ent);
      if (ent.id === target.id) {
        assert.equal(v.visible, true);
        assert.equal(v.opacity, 1.0);
        assert.equal(v.transparent, false);
        assert.equal(v.depthWrite, true);
      } else {
        assert.equal(v.visible, false);
      }
    }

    // Toggle off isolate -> all visible systems return cleanly
    assert.equal(toggleIsolate(st), false);
    const other = [...st.entities.values()].find(e => e.id !== target.id && st.systems[e.system].visible);
    assert.equal(computeEntityVisual(st, other).visible, true);
  });
});

// 3. Solid Opaque Rendering vs Fade/Hide/Restore (3 rounds)
for (let round = 1; round <= 3; round++) {
  runTest(`Kati Render (Opaque), Fade ve Gizle/Geri Getir (Tur ${round}/3)`, () => {
    const st = makeFixture();
    const ent = [...st.entities.values()][round % st.entities.size];

    // Default must be 100% solid opaque
    const v0 = computeEntityVisual(st, ent);
    assert.equal(v0.transparent, false);
    assert.equal(v0.depthWrite, true);
    assert.equal(v0.opacity, 1.0);

    // Fade
    ent.faded = true;
    const vFade = computeEntityVisual(st, ent);
    assert.equal(vFade.transparent, true);
    assert.equal(vFade.opacity, 0.22);

    // Hide & Restore
    ent.hidden = true;
    assert.equal(computeEntityVisual(st, ent).visible, false);
    ent.hidden = false;
    ent.faded = false;
    assert.equal(computeEntityVisual(st, ent).visible, true);
    assert.equal(computeEntityVisual(st, ent).transparent, false);
  });
}

// 4. Latin TA2 Search (Meshes + Ostium sinus coronarii / Foramen / Sulcus Landmarks — 3 queries)
const searchQueries = [
  ['Ostium sinus coronarii', true],
  ['Foramen magnum', true],
  ['Os femoris', false]
];
searchQueries.forEach(([q, expectLandmark], idx) => {
  runTest(`Latince TA2 Arama & Landmark Bulma (${idx + 1}/3: ${q})`, () => {
    const st = makeFixture();
    const res = searchAtlas(st, q);
    if (expectLandmark) {
      assert.ok(res.landmarks.length >= 1, `Landmark bulunamadi: ${q}`);
      assert.ok(res.landmarks[0].latin.toLowerCase().includes(q.toLowerCase()));
    } else {
      assert.ok(res.entities.length >= 1, `Structura bulunamadi: ${q}`);
    }
  });
});

// 5. Safe Camera Focus Math (including zero-vector degeneracy — 3 scenarios)
const camScenarios = [
  { name: 'Sifir vektor korumasi', cam: { x: 0, y: 1, z: 0 }, tgt: { x: 0, y: 1, z: 0 }, box: { x: 0, y: 1, z: 0 }, diag: 0.3 },
  { name: 'Kucuk ostium odaklama', cam: { x: 0, y: 1.2, z: 2.5 }, tgt: { x: 0, y: 0.9, z: 0 }, box: { x: 0.02, y: 1.25, z: 0.05 }, diag: 0.02 },
  { name: 'Buyuk kemik (Femur) odaklama', cam: { x: -1, y: 0.5, z: 1.5 }, tgt: { x: 0, y: 0.5, z: 0 }, box: { x: 0.1, y: 0.6, z: 0 }, diag: 0.5 }
];
camScenarios.forEach((sc, idx) => {
  runTest(`Guvenli Kamera Odaklama (${idx + 1}/3: ${sc.name})`, () => {
    const pose = computeSafeFocusPose(sc.cam, sc.tgt, sc.box, sc.diag);
    assert.ok(Number.isFinite(pose.position.x) && Number.isFinite(pose.position.y) && Number.isFinite(pose.position.z));
    const d = Math.hypot(pose.position.x - pose.target.x, pose.position.y - pose.target.y, pose.position.z - pose.target.z);
    assert.ok(d >= 0.219 && d <= 2.401, `Mesafe sinir disi: ${d}`);
  });
});

// 6. 3-Axis Clipping Plane (3 axes)
['axial', 'sagittal', 'coronal'].forEach((ax, idx) => {
  runTest(`Anatomik Kesit Duzlemi (${idx + 1}/3: ${ax})`, () => {
    const off = computeClipPlaneConfig(false, ax, 0.5);
    assert.equal(off.constant, 100);
    const on = computeClipPlaneConfig(true, ax, 0.75);
    assert.equal(on.constant, 0.75);
    assert.equal(on.normal.filter(n => n === -1).length, 1);
  });
});

console.log(`\nTUM TESTLER BASARILI: ${passed}/${passed} gecti.`);
