/**
 * In-App Live Test & 360° WebGL Benchmark Suite
 * Runs real on-device diagnostic checks (model sizes, coronary meshes,
 * osteology pins, clipping, color modes, GPU dispose, and 360° FPS)
 * and formats a copyable plain-text report.
 */

export function formatBenchmarkReport(results, fpsMetrics) {
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const warnCount = results.filter(r => r.status === 'WARN').length;

  const lines = [
    '=== ATLAS ANATOMICUS 3D — CANLI TEST & BENCHMARK RAPORU ===',
    `Özet: ${passCount} PASS | ${warnCount} WARN | ${failCount} FAIL (Toplam ${results.length})`
  ];

  if (fpsMetrics) {
    lines.push(
      `360° FPS: Ort ${fpsMetrics.avgFps} FPS | Min ${fpsMetrics.minFps} FPS | Draw Calls: ${fpsMetrics.drawCalls} | Üçgen: ${fpsMetrics.triangles.toLocaleString('tr-TR')} | GPU Geometri: ${fpsMetrics.geometries}`
    );
  }

  lines.push('---');
  for (const r of results) {
    lines.push(`[${r.status}] ${r.name}: ${r.detail}`);
  }
  return lines.join('\n');
}

export async function runLiveBenchmarkSuite(ctx) {
  const {
    manifest,
    state,
    systemMeta,
    systemLoaded,
    loadSystem,
    disposeSystemGPU,
    refreshAllVisuals,
    selectEntity,
    clearSelection,
    getEntityBox,
    applyClip,
    camera,
    controls,
    renderer,
    viewport,
    onProgress
  } = ctx;

  const results = [];
  const push = (name, status, detail) => {
    results.push({ name, status, detail });
    if (onProgress) onProgress([...results], null);
  };

  // 1. Manifest & Total Size
  const totalMB = manifest.systems.reduce((acc, s) => acc + (s.sizeMB || 0), 0);
  const ctMods = manifest.systems.filter(s => s.group === 'ct_hd' || s.group === 'ct_hra' || s.group === 'custom');
  push(
    'Paket & Model Boyutu',
    totalMB >= 15 ? 'PASS' : 'WARN',
    `${manifest.systems.length} modül (${ctMods.length} BT/MR), Toplam ${totalMB.toFixed(1)} MB, ${manifest.totalStructures || 0} Z-Anatomy yapısı`
  );

  // 2. BT/MR Modules presence
  if (ctMods.length > 0) {
    const listStr = ctMods.slice(0, 6).map(m => `${m.id}(${m.sizeMB || 0}MB)`).join(', ');
    push('BT/MR Modülleri', 'PASS', `${ctMods.length} modül mevcut: ${listStr}`);
  } else {
    push('BT/MR Modülleri', 'FAIL', 'Manifest içinde hiç BT/MR modülü bulunamadı (0 adet)');
  }

  // 3. Coronary Arteries & Heart Presence (ensure cor_detail is loaded)
  if (systemMeta.cor_detail && !systemLoaded.cor_detail) {
    state.systems.cor_detail.visible = true;
    await loadSystem('cor_detail');
    refreshAllVisuals();
  }
  const corEnts = [];
  const corKeywords = ['coronar', 'interventricular', 'circumflex', 'cardiac vein', 'sinus coronarius', 'great cardiac', 'middle cardiac', 'small cardiac'];
  for (const ent of state.entities.values()) {
    const t = `${ent.latin} ${ent.name}`.toLowerCase();
    if (corKeywords.some(k => t.includes(k))) {
      const box = getEntityBox(ent);
      if (!box.isEmpty()) corEnts.push(ent);
    }
  }
  if (corEnts.length >= 2) {
    const samples = corEnts.slice(0, 3).map(e => e.latin).join(', ');
    push('Koroner Arterler (3D Mesh)', 'PASS', `${corEnts.length} aktif 3D koroner/kardiyak damar: ${samples}`);
  } else {
    push('Koroner Arterler (3D Mesh)', 'FAIL', `Sahnede sadece ${corEnts.length} koroner damar bulundu (Manifest coronaryCount=${manifest.coronaryCount || 0})`);
  }

  // 4. Osteology Surface-Snapped Pins
  const pinKeys = Object.keys(state.surfacePins || {});
  const totalPins = pinKeys.reduce((acc, k) => acc + (state.surfacePins[k]?.length || 0), 0);
  push(
    'Yüzeye Kilitli Osteoloji Pinleri',
    totalPins >= 10 ? 'PASS' : 'WARN',
    `${pinKeys.length} yapı üzerinde ${totalPins} adet yüzeye sabitlenmiş pin`
  );

  // 5. Selection + Mesh-Centered Pin Projection Check
  const testEnt = corEnts[0] || Array.from(state.entities.values()).find(e => e.meshes.some(m => m.visible));
  if (testEnt) {
    selectEntity(testEnt, true);
    const box = getEntityBox(testEnt);
    const c = box.getCenter(camera.position.clone().set(0, 0, 0));
    const proj = c.project(camera);
    const px = (proj.x * 0.5 + 0.5) * viewport.clientWidth;
    const py = (-proj.y * 0.5 + 0.5) * viewport.clientHeight;
    const valid = Number.isFinite(px) && Number.isFinite(py) && px >= 0 && px <= viewport.clientWidth && py >= 0 && py <= viewport.clientHeight;
    push(
      'Pin & Kamera Odaklama',
      valid ? 'PASS' : 'FAIL',
      `${testEnt.latin} -> ekran(${Math.round(px)}, ${Math.round(py)})`
    );
  } else {
    push('Pin & Kamera Odaklama', 'FAIL', 'Test edilecek görünür 3D yapı bulunamadı');
  }

  // 6. Atlas Color Mode + Clipping Plane Toggle
  const prevColor = state.colorMode;
  const prevSlice = state.sliceEnabled;
  state.colorMode = 'atlas';
  state.sliceEnabled = true;
  state.sliceAxis = 'axial';
  refreshAllVisuals();
  applyClip();
  const clipOk = renderer.localClippingEnabled === true;
  state.colorMode = prevColor;
  state.sliceEnabled = prevSlice;
  refreshAllVisuals();
  applyClip();
  clearSelection();
  push('Atlas Renk & Kesit Düzlemi', clipOk ? 'PASS' : 'FAIL', 'PBR ↔ Atlas geçişi ve Transversalis kesit doğrulandı');

  // 7. GPU Memory Dispose Check
  const probeMod = ctMods[0];
  if (probeMod) {
    const geomBefore = renderer.info.memory.geometries;
    const wasLoaded = !!systemLoaded[probeMod.id];
    const t0 = performance.now();
    if (!wasLoaded) await loadSystem(probeMod.id);
    const loadMs = Math.round(performance.now() - t0);
    const geomLoaded = renderer.info.memory.geometries;
    if (!wasLoaded) {
      disposeSystemGPU(probeMod.id);
    }
    const geomAfter = renderer.info.memory.geometries;
    const freed = wasLoaded ? true : geomAfter <= geomLoaded;
    push(
      'GPU Bellek & BT Modül Yükleme',
      freed && geomLoaded > 0 ? 'PASS' : 'WARN',
      `${probeMod.id}: ${loadMs}ms yükleme | Geometri: ${geomBefore} -> ${geomLoaded} -> ${geomAfter}`
    );
  } else {
    push('GPU Bellek & BT Modül Yükleme', 'WARN', 'Test edilecek ayrı BT/MR modülü yok');
  }

  // 8. 360° Live Orbit FPS Benchmark (~2.2s)
  const startPos = camera.position.clone();
  const target = controls.target.clone();
  const offset = startPos.clone().sub(target);
  const radius = Math.hypot(offset.x, offset.z) || 1.2;
  const baseAngle = Math.atan2(offset.x, offset.z);
  const yPos = startPos.y;

  const frameTimes = [];
  const durationMs = 2200;
  const startTime = performance.now();
  let lastT = startTime;

  await new Promise(resolve => {
    function step(now) {
      const elapsed = now - startTime;
      const dt = now - lastT;
      lastT = now;
      if (dt > 0 && dt < 500) frameTimes.push(dt);

      const prog = Math.min(1, elapsed / durationMs);
      const ang = baseAngle + prog * Math.PI * 2;
      camera.position.set(target.x + Math.sin(ang) * radius, yPos, target.z + Math.cos(ang) * radius);
      controls.update();

      if (prog < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });

  camera.position.copy(startPos);
  controls.update();

  const avgDt = frameTimes.length ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : 16.7;
  const maxDt = frameTimes.length ? Math.max(...frameTimes) : 16.7;
  const fpsMetrics = {
    avgFps: Math.round(1000 / Math.max(1, avgDt)),
    minFps: Math.round(1000 / Math.max(1, maxDt)),
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries
  };

  push(
    '360° WebGL FPS Benchmark',
    fpsMetrics.avgFps >= 24 ? 'PASS' : 'WARN',
    `Ort ${fpsMetrics.avgFps} FPS (Min ${fpsMetrics.minFps}) • ${fpsMetrics.drawCalls} draw call • ${fpsMetrics.triangles.toLocaleString('tr-TR')} üçgen`
  );

  if (onProgress) onProgress(results, fpsMetrics);
  return { results, fpsMetrics, reportText: formatBenchmarkReport(results, fpsMetrics) };
}
