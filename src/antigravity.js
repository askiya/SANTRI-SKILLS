'use strict';
// Antigravity particle effect — Canvas 2D adaptation of React Three Fiber original.
// Visual adaptation notes:
//   R3F uses 3D instanced meshes projected by a perspective camera (FOV 35, Z=50).
//   Canvas 2D draws projected capsules (rounded lines) without real 3D shading/depth buffer.
//   All physics parameters are IDENTICAL to the R3F original:
//     count=300, magnetRadius=6, ringRadius=7, waveSpeed=0.4, waveAmplitude=1,
//     particleSize=1.5, lerpSpeed=0.05, color=#5227FF, autoAnimate=true,
//     particleVariance=1, rotationSpeed=0, depthFactor=1, pulseSpeed=3,
//     particleShape=capsule, fieldStrength=10
//   Adaptations from 3D→2D:
//     - No real z-buffer; z used only for projectionFactor and scale attenuation.
//     - Capsule geometry (r=0.1,l=0.4) drawn as a rounded strokeCap=round line
//       oriented toward the pointer (lookAt+rotateX 90° → 2D angle perpendicular to pointer direction).
//     - Viewport units: R3F viewport (world units) mapped to canvas pixels ×(canvasW/viewportW).
//       viewportW approximated from FOV 35 at Z=50: ~31 units; ratio ≈ canvasW/31.
//     - No lighting/material; flat color with alpha from scale.

function initAntigravity(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null; // fallback: caller shows static logo

  const COLOR = '#5227FF';
  const COUNT = 300;
  const MAGNET_RADIUS = 6;
  const RING_RADIUS = 7;
  const WAVE_SPEED = 0.4;
  const WAVE_AMP = 1;
  const PARTICLE_SIZE = 1.5;
  const LERP = 0.05;
  const PARTICLE_VAR = 1;
  const ROTATION_SPEED = 0; // per original
  const DEPTH_FACTOR = 1;
  const PULSE_SPEED = 3;
  const FIELD_STRENGTH = 10;

  // R3F camera: fov=35, z=50 → viewport half-width = tan(17.5°)*50 ≈ 15.75 → full ≈ 31.5
  const VIEWPORT_W = 31.5;
  const VIEWPORT_H = 31.5; // aspect adjusted at resize

  let w = 0, h = 0, dpr = 1;
  let viewW = VIEWPORT_W, viewH = VIEWPORT_H;
  let pxPerUnit = 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = rect.width; h = rect.height;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pxPerUnit = w / VIEWPORT_W;
    viewW = VIEWPORT_W;
    viewH = h / pxPerUnit;
  }

  // Particles — identical init to R3F
  const particles = [];
  function initParticles() {
    particles.length = 0;
    for (let i = 0; i < COUNT; i++) {
      const x = (Math.random() - 0.5) * viewW;
      const y = (Math.random() - 0.5) * viewH;
      const z = (Math.random() - 0.5) * 20;
      particles.push({
        t: Math.random() * 100,
        speed: 0.01 + Math.random() / 200,
        mx: x, my: y, mz: z,
        cx: x, cy: y, cz: z,
        randomRadiusOffset: (Math.random() - 0.5) * 2,
      });
    }
  }

  // Pointer tracking
  let pointerX = 0, pointerY = 0, lastMoveTime = 0;
  let lastPX = 0, lastPY = 0;
  const virtualMouse = { x: 0, y: 0 };

  function onPointerMove(e) {
    const rect = canvas.getBoundingClientRect();
    // Normalized -1..1 like R3F pointer
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -( ((e.clientY - rect.top) / rect.height) * 2 - 1 );
    const dist = Math.sqrt((nx - lastPX) ** 2 + (ny - lastPY) ** 2);
    if (dist > 0.001) { lastMoveTime = Date.now(); lastPX = nx; lastPY = ny; }
    pointerX = nx; pointerY = ny;
  }
  window.addEventListener('pointermove', onPointerMove);

  // Animation state
  let raf = 0, running = false, startTime = 0, frameCount = 0;
  canvas.dataset.frames = '0';

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const t = (now - startTime) / 1000;
    frameCount++;
    canvas.dataset.frames = String(frameCount);

    // Destination
    let destX = (pointerX * viewW) / 2;
    let destY = (pointerY * viewH) / 2;
    if (Date.now() - lastMoveTime > 2000) {
      destX = Math.sin(t * 0.5) * (viewW / 4);
      destY = Math.cos(t * 0.5 * 2) * (viewH / 4);
    }

    virtualMouse.x += (destX - virtualMouse.x) * 0.05;
    virtualMouse.y += (destY - virtualMouse.y) * 0.05;
    const targetX = virtualMouse.x;
    const targetY = virtualMouse.y;
    const globalRotation = t * ROTATION_SPEED;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2); // center origin like R3F

    for (let i = 0; i < COUNT; i++) {
      const p = particles[i];
      p.t += p.speed / 2;

      const projFactor = 1 - p.cz / 50;
      const ptX = targetX * projFactor;
      const ptY = targetY * projFactor;

      const dx = p.mx - ptX;
      const dy = p.my - ptY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let tpx, tpy, tpz;
      if (dist < MAGNET_RADIUS) {
        const angle = Math.atan2(dy, dx) + globalRotation;
        const wave = Math.sin(p.t * WAVE_SPEED + angle) * (0.5 * WAVE_AMP);
        const deviation = p.randomRadiusOffset * (5 / (FIELD_STRENGTH + 0.1));
        const r = RING_RADIUS + wave + deviation;
        tpx = ptX + r * Math.cos(angle);
        tpy = ptY + r * Math.sin(angle);
        tpz = p.mz * DEPTH_FACTOR + Math.sin(p.t) * (1 * WAVE_AMP * DEPTH_FACTOR);
      } else {
        tpx = p.mx; tpy = p.my; tpz = p.mz * DEPTH_FACTOR;
      }

      p.cx += (tpx - p.cx) * LERP;
      p.cy += (tpy - p.cy) * LERP;
      p.cz += (tpz - p.cz) * LERP;

      // Scale (identical to R3F)
      const cdist = Math.sqrt((p.cx - ptX) ** 2 + (p.cy - ptY) ** 2);
      const distFromRing = Math.abs(cdist - RING_RADIUS);
      let scaleFactor = Math.max(0, Math.min(1, 1 - distFromRing / 10));
      const finalScale = scaleFactor * (0.8 + Math.sin(p.t * PULSE_SPEED) * 0.2 * PARTICLE_VAR) * PARTICLE_SIZE;

      if (finalScale < 0.01) continue;

      // Capsule direction: perpendicular to pointer (lookAt + rotateX 90°)
      const toPointerAngle = Math.atan2(ptY - p.cy, ptX - p.cx);
      const capsAngle = toPointerAngle + Math.PI / 2;

      // Draw capsule as rounded thick line. R3F capsule: radius=0.1, length=0.4 → half=0.2
      const capsRadius = 0.1 * finalScale * pxPerUnit;
      const capsHalf = 0.2 * finalScale * pxPerUnit;
      const sx = p.cx * pxPerUnit;
      const sy = -p.cy * pxPerUnit; // flip Y (screen Y is down)
      const cdx = Math.cos(capsAngle) * capsHalf;
      const cdy = -Math.sin(capsAngle) * capsHalf;

      ctx.beginPath();
      ctx.moveTo(sx - cdx, sy - cdy);
      ctx.lineTo(sx + cdx, sy + cdy);
      ctx.lineWidth = capsRadius * 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = COLOR;
      ctx.globalAlpha = Math.min(1, scaleFactor);
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function start() {
    if (running) return;
    running = true; startTime = performance.now();
    resize(); initParticles();
    raf = requestAnimationFrame(frame);
  }

  function stop() { running = false; cancelAnimationFrame(raf); }

  // Visibility
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else if (canvas.dataset.active === '1') start();
  });

  // Reduced motion
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const checkMotion = () => { if (mq.matches) { stop(); drawStatic(); } };
  mq.addEventListener('change', checkMotion);

  function drawStatic() {
    resize();
    ctx.clearRect(0, 0, w, h);
    ctx.save(); ctx.translate(w / 2, h / 2);
    // Draw a ring of dots at rest
    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * Math.PI * 2;
      const x = Math.cos(angle) * RING_RADIUS * pxPerUnit;
      const y = Math.sin(angle) * RING_RADIUS * pxPerUnit;
      ctx.beginPath(); ctx.arc(x, y, 1.5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = COLOR; ctx.globalAlpha = 0.6; ctx.fill();
    }
    ctx.restore(); ctx.globalAlpha = 1;
  }

  let ro;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => { if (running) resize(); });
    ro.observe(canvas);
  }

  return {
    start() { canvas.dataset.active = '1'; if (mq.matches) drawStatic(); else start(); },
    stop() { canvas.dataset.active = '0'; stop(); },
    destroy() { stop(); window.removeEventListener('pointermove', onPointerMove); if (ro) ro.disconnect(); },
    get frameCount() { return frameCount; },
  };
}

if (typeof module !== 'undefined') module.exports = { initAntigravity };
