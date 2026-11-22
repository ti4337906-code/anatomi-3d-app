import * as THREE from 'three';

// Prosedurel medikal mikro-doku (bump & roughness) uretici
// Z-Anatomy'nin plastik gorunumunu kaldirip kemik periostu, kas lifi ve organ dokusu derinligi verir
function makeCanvasTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');

  if (kind === 'bone') {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const v = 108 + Math.floor(Math.random() * 44);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 4, 1 + Math.random() * 2);
    }
  } else if (kind === 'muscle') {
    ctx.fillStyle = '#787878';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 120; i++) {
      const x = (i / 120) * 256;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(215,215,215,0.45)' : 'rgba(45,45,45,0.45)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 6, 85, x - 6, 170, x, 256);
      ctx.stroke();
    }
  } else {
    // Organ / damar / sinir yumusak serozal mikro-doku
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 500; i++) {
      const v = 115 + Math.floor(Math.random() * 28);
      ctx.fillStyle = `rgba(${v},${v},${v},0.4)`;
      ctx.beginPath();
      ctx.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

const cache = {};
export function getMicroBumpTexture(subtype) {
  const key = subtype === 'bone' ? 'bone' : subtype === 'muscle' ? 'muscle' : 'organ';
  if (!cache[key]) cache[key] = makeCanvasTexture(key);
  return cache[key];
}

export function getPBRProfile(subtype) {
  switch (subtype) {
    case 'bone':     return { roughness: 0.62, metalness: 0.03, bumpScale: 0.0025 };
    case 'muscle':   return { roughness: 0.46, metalness: 0.04, bumpScale: 0.0032 };
    case 'artery':
    case 'vein':
    case 'heart':    return { roughness: 0.30, metalness: 0.05, bumpScale: 0.0015 };
    case 'nerve':    return { roughness: 0.38, metalness: 0.04, bumpScale: 0.0016 };
    case 'ligament': return { roughness: 0.42, metalness: 0.06, bumpScale: 0.0018 };
    case 'lymph':    return { roughness: 0.34, metalness: 0.04, bumpScale: 0.0014 };
    default:         return { roughness: 0.36, metalness: 0.05, bumpScale: 0.0020 };
  }
}
