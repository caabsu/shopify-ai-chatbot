// Image lightbox for review photos.
// — Click backdrop or × to close. Esc closes too.
// — Arrow keys or onscreen arrows navigate between images.
// — Click image (or +/− buttons, or mouse wheel) to zoom. Drag to pan when zoomed.
// — Pinch to zoom on touch devices.

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.6;

let activeInstance: { close: () => void } | null = null;

interface OpenOptions {
  images: string[];
  startIndex?: number;
  alt?: string;
}

export function openLightbox({ images, startIndex = 0, alt }: OpenOptions): void {
  if (!images.length) return;
  if (activeInstance) activeInstance.close();

  let currentIndex = Math.max(0, Math.min(startIndex, images.length - 1));
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  const prevBodyOverflow = document.body.style.overflow;

  const overlay = document.createElement('div');
  overlay.className = 'wbd-rv-lb';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Review photo viewer');

  const stage = document.createElement('div');
  stage.className = 'wbd-rv-lb-stage';

  const img = document.createElement('img');
  img.className = 'wbd-rv-lb-img';
  img.draggable = false;
  img.alt = alt ?? 'Review photo';
  stage.appendChild(img);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'wbd-rv-lb-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  const counter = document.createElement('div');
  counter.className = 'wbd-rv-lb-counter';

  const zoomControls = document.createElement('div');
  zoomControls.className = 'wbd-rv-lb-zoom';
  const zoomOutBtn = document.createElement('button');
  zoomOutBtn.type = 'button';
  zoomOutBtn.className = 'wbd-rv-lb-zoom-btn';
  zoomOutBtn.setAttribute('aria-label', 'Zoom out');
  zoomOutBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>';
  const zoomInBtn = document.createElement('button');
  zoomInBtn.type = 'button';
  zoomInBtn.className = 'wbd-rv-lb-zoom-btn';
  zoomInBtn.setAttribute('aria-label', 'Zoom in');
  zoomInBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  zoomControls.appendChild(zoomOutBtn);
  zoomControls.appendChild(zoomInBtn);

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'wbd-rv-lb-nav wbd-rv-lb-prev';
  prevBtn.setAttribute('aria-label', 'Previous photo');
  prevBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>';

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'wbd-rv-lb-nav wbd-rv-lb-next';
  nextBtn.setAttribute('aria-label', 'Next photo');
  nextBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';

  overlay.appendChild(stage);
  overlay.appendChild(closeBtn);
  overlay.appendChild(zoomControls);
  if (images.length > 1) {
    overlay.appendChild(prevBtn);
    overlay.appendChild(nextBtn);
    overlay.appendChild(counter);
  }

  // ── State application ────────────────────────────────────────────────────
  function applyTransform(): void {
    img.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
    stage.classList.toggle('is-zoomed', zoom > 1.001);
  }

  function resetTransform(): void {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  }

  function clampPan(): void {
    if (zoom <= 1) {
      panX = 0;
      panY = 0;
      return;
    }
    const rect = stage.getBoundingClientRect();
    const maxX = ((zoom - 1) * rect.width) / 2;
    const maxY = ((zoom - 1) * rect.height) / 2;
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }

  function setZoom(target: number, originX?: number, originY?: number): void {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, target));
    if (Math.abs(next - zoom) < 0.001) return;
    if (originX !== undefined && originY !== undefined && zoom > 0) {
      // Zoom toward the cursor point: keep that screen-point stable.
      const rect = stage.getBoundingClientRect();
      const cx = originX - rect.left - rect.width / 2;
      const cy = originY - rect.top - rect.height / 2;
      const ratio = next / zoom;
      panX = panX * ratio + cx * (1 - ratio);
      panY = panY * ratio + cy * (1 - ratio);
    }
    zoom = next;
    if (zoom === 1) {
      panX = 0;
      panY = 0;
    } else {
      clampPan();
    }
    applyTransform();
  }

  function show(index: number): void {
    currentIndex = (index + images.length) % images.length;
    img.src = images[currentIndex];
    img.alt = `${alt ?? 'Review photo'} ${currentIndex + 1} of ${images.length}`;
    resetTransform();
    counter.textContent = `${currentIndex + 1} / ${images.length}`;
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  function close(): void {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    overlay.classList.remove('is-open');
    document.body.style.overflow = prevBodyOverflow;
    activeInstance = null;
    // Wait for fade-out
    setTimeout(() => overlay.remove(), 180);
  }
  activeInstance = { close };

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });

  prevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    show(currentIndex - 1);
  });
  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    show(currentIndex + 1);
  });

  zoomInBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setZoom(zoom + ZOOM_STEP);
  });
  zoomOutBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setZoom(zoom - ZOOM_STEP);
  });

  // Click backdrop to close; clicking the image toggles zoom.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === stage) close();
  });

  img.addEventListener('click', (e) => {
    e.stopPropagation();
    if (zoom > 1.001) {
      resetTransform();
    } else {
      setZoom(2.4, e.clientX, e.clientY);
    }
  });

  // Mouse wheel zoom (toward cursor).
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.0025;
      setZoom(zoom * (1 + delta), e.clientX, e.clientY);
    },
    { passive: false },
  );

  // Pointer-based pan + pinch (works for mouse, touch, pen).
  const activePointers = new Map<number, { x: number; y: number }>();

  function getPinchDist(): number {
    const pts = Array.from(activePointers.values());
    if (pts.length < 2) return 0;
    const [a, b] = pts;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function getPinchCenter(): { x: number; y: number } | null {
    const pts = Array.from(activePointers.values());
    if (pts.length < 2) return null;
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }

  img.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    img.setPointerCapture(e.pointerId);

    if (activePointers.size === 2) {
      pinchStartDist = getPinchDist();
      pinchStartZoom = zoom;
      isPanning = false;
    } else if (zoom > 1) {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOriginX = panX;
      panOriginY = panY;
      stage.classList.add('is-panning');
    }
  });

  img.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2 && pinchStartDist > 0) {
      const dist = getPinchDist();
      const center = getPinchCenter();
      if (dist > 0 && center) {
        setZoom((dist / pinchStartDist) * pinchStartZoom, center.x, center.y);
      }
      return;
    }

    if (isPanning) {
      panX = panOriginX + (e.clientX - panStartX);
      panY = panOriginY + (e.clientY - panStartY);
      clampPan();
      applyTransform();
    }
  });

  function endPointer(e: PointerEvent): void {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) pinchStartDist = 0;
    if (activePointers.size === 0) {
      isPanning = false;
      stage.classList.remove('is-panning');
    }
  }
  img.addEventListener('pointerup', endPointer);
  img.addEventListener('pointercancel', endPointer);
  img.addEventListener('pointerleave', endPointer);

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      close();
    } else if (images.length > 1 && e.key === 'ArrowLeft') {
      show(currentIndex - 1);
    } else if (images.length > 1 && e.key === 'ArrowRight') {
      show(currentIndex + 1);
    } else if (e.key === '+' || e.key === '=') {
      setZoom(zoom + ZOOM_STEP);
    } else if (e.key === '-' || e.key === '_') {
      setZoom(zoom - ZOOM_STEP);
    } else if (e.key === '0') {
      resetTransform();
    }
  }
  document.addEventListener('keydown', onKey);

  function onResize(): void {
    clampPan();
    applyTransform();
  }
  window.addEventListener('resize', onResize);

  // Mount
  document.body.style.overflow = 'hidden';
  document.body.appendChild(overlay);
  show(currentIndex);

  // Trigger fade-in on next frame for transition to kick in
  requestAnimationFrame(() => overlay.classList.add('is-open'));
}
