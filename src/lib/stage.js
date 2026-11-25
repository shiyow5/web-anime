import * as THREE from 'three';
import { ensurePositioned, prefersReducedMotion } from './dom.js';

// three.js の素材が共通で使う土台。
// レンダラー、カメラ、リサイズ追従、描画ループ、ポインター追跡、後片付けをまとめて受け持つ。
// 画面外に出たときとタブが隠れたときは、描画ループを止める。
export function createStage(container, options = {}) {
  ensurePositioned(container);
  const {
    fov = 45,
    near = 0.1,
    far = 200,
    cameraZ = 6,
    background = null,
    antialias = true,
    preview = false,
    maxDpr = preview ? 1.5 : 2,
    startTime = 0,
  } = options;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias, alpha: true, powerPreference: 'high-performance' });
  } catch (error) {
    throw new Error('WebGL を初期化できませんでした。ブラウザーか GPU の設定を確認してください', { cause: error });
  }

  const canvas = renderer.domElement;
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  if (background) renderer.setClearColor(new THREE.Color(background), 1);
  else renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, near, far);
  camera.position.set(0, 0, cameraZ);

  const size = { width: 1, height: 1, dpr: 1 };
  // x, y は -1〜1（右と上が正）。sx, sy はなめらかに追いかける値。
  const pointer = { x: 0, y: 0, sx: 0, sy: 0, inside: false, speed: 0 };
  const frameFns = [];
  const resizeFns = [];
  const disposers = [];
  const reduced = prefersReducedMotion();

  function resize() {
    const rect = container.getBoundingClientRect();
    size.width = Math.max(1, Math.round(rect.width));
    size.height = Math.max(1, Math.round(rect.height));
    size.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    renderer.setPixelRatio(size.dpr);
    renderer.setSize(size.width, size.height, false);
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    for (const fn of resizeFns) fn(size);
  }

  function onPointerMove(event) {
    const rect = container.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    pointer.speed = Math.min(1, pointer.speed + Math.hypot(nx - pointer.x, ny - pointer.y) * 2);
    pointer.x = nx;
    pointer.y = ny;
    pointer.inside = true;
  }
  function onPointerLeave() {
    pointer.inside = false;
    pointer.x = 0;
    pointer.y = 0;
  }

  let raf = 0;
  let last = 0;
  let time = startTime;
  let onScreen = true;
  let destroyed = false;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.05));
    last = now;
    const step = reduced ? 0 : dt;
    time += step;
    const k = 1 - Math.exp(-dt * 6);
    pointer.sx += (pointer.x - pointer.sx) * k;
    pointer.sy += (pointer.y - pointer.sy) * k;
    pointer.speed *= Math.exp(-dt * 3);
    for (const fn of frameFns) fn(time, step);
    renderer.render(scene, camera);
  }
  function start() {
    if (raf || destroyed) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  function syncRunning() {
    if (onScreen && !document.hidden) start();
    else stop();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersectionObserver = new IntersectionObserver((entries) => {
    onScreen = entries.at(-1).isIntersecting;
    syncRunning();
  });
  intersectionObserver.observe(container);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerleave', onPointerLeave);
  document.addEventListener('visibilitychange', syncRunning);

  resize();
  start();

  function disposeMaterial(material) {
    for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
    for (const uniform of Object.values(material.uniforms ?? {})) uniform?.value?.isTexture && uniform.value.dispose();
    material.dispose();
  }

  return {
    renderer,
    scene,
    camera,
    canvas,
    size,
    pointer,
    reduced,
    onFrame: (fn) => frameFns.push(fn),
    onResize(fn) {
      resizeFns.push(fn);
      fn(size);
    },
    onDispose: (fn) => disposers.push(fn),
    // z = 0 の平面で、カメラに映る範囲の幅と高さを返す。
    viewport() {
      const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.abs(camera.position.z);
      return { width: height * camera.aspect, height };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', syncRunning);
      for (const fn of disposers) fn();
      scene.traverse((object) => {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) if (material) disposeMaterial(material);
      });
      scene.environment?.dispose?.();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
