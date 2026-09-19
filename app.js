/**
 * Passport Photo Maker — Main Application
 * Clean, focused rebuild — production ready
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const MM = 96 / 25.4;           // screen px per mm at 96 DPI
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 5.0;
const SNAP_PX = 6;               // snap threshold in screen px

// ─── PAGE PRESETS (mm) ───────────────────────────────────────────────────────
const PAGE = {
  A3:     { w: 297,   h: 420   },
  A4:     { w: 210,   h: 297   },
  A5:     { w: 148,   h: 210   },
  Letter: { w: 215.9, h: 279.4 },
  Legal:  { w: 215.9, h: 355.6 },
  '4x6':  { w: 101.6, h: 152.4 },
  '5x7':  { w: 127,   h: 177.8 },
  '8x10': { w: 203.2, h: 254   }
};

// ─── PHOTO PRESETS (mm) ──────────────────────────────────────────────────────
const PHOTO = {
  '35x45':    { w: 35,    h: 45    },
  '2x2':      { w: 50.8,  h: 50.8  },
  '40x60':    { w: 40,    h: 60    },
  'aadhaar':  { w: 35,    h: 45    },
  'pan':      { w: 25,    h: 35    },
  'driving':  { w: 35,    h: 45    },
  '50x50':    { w: 50,    h: 50    }
};

// ─── STATE ───────────────────────────────────────────────────────────────────
let state = {
  photos:         [],     // [{id, name, origSrc, src, hasBg}]
  activePhotoId:  null,
  selectedPhotoIds: new Set(), // multi-selected photo ids

  page: {
    preset:  'A4',
    w: 210, h: 297,
    bg: '#ffffff',
    portrait: true,
    margins: { t: 10, b: 10, l: 10, r: 10 }
  },

  photoSize: { preset: '35x45', w: 35, h: 45 },

  bgColor:  '#ffffff',          // color to show behind transparent photos
  spacing:  { h: 3, v: 3 },    // mm
  mode:     'auto',             // 'auto' | 'free'

  border: { enabled: false, width: 0.5, color: '#000000' }, // photo border

  filters: { brightness: 100, contrast: 100, saturation: 100 }, // image adjustments

  items:    [],     // [{id, photoId, x, y, w, h, brightness, contrast, saturation}] — x,y,w,h in mm
  selected: [],     // selected item ids

  zoom: 1, panX: 0, panY: 0,
  user: null
};

// History for undo/redo
let history = [], histIdx = -1;

// Crop instance
let cropperJS = null;

// Interaction state
let drag = null;   // current drag operation descriptor
let isPanning = false, isSpacePanning = false;
let panStart = { x: 0, y: 0 };

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const Q = (s, el = document) => el.querySelector(s);
const QA = (s, el = document) => [...el.querySelectorAll(s)];

const fileInput       = $('file-input');
const dropzone        = $('dropzone');
const photoGrid       = $('photo-grid');
const btnAddMore      = $('btn-add-more');
const selectedCard    = $('selected-card');
const selectedPreview = $('selected-preview');
const selectedName    = $('selected-name');
const btnCrop         = $('btn-crop');
const btnRemoveBg     = $('btn-remove-bg');
const btnRemoveBgAll  = $('btn-remove-bg-all');
const batchCount      = $('batch-count');
const aiProgress      = $('ai-progress');
const aiStatusText    = $('ai-status-text');
const aiPct           = $('ai-pct');
const colorPresets    = $('color-presets');
const bgColorPicker   = $('bg-color-picker');
const bgColorHex      = $('bg-color-hex');

const borderEnabled   = $('border-enabled');
const borderControls  = $('border-controls');
const borderWidthSlider = $('border-width');
const borderWidthVal  = $('border-width-val');
const borderColorPicker = $('border-color-picker');
const borderColorText = $('border-color-text');
const btnResetBg      = $('btn-reset-bg');

const pagePreset      = $('page-preset');
const customPageDims  = $('custom-page-dims');
const pageWInput      = $('page-w');
const pageHInput      = $('page-h');
const pageUnit        = $('page-unit');
const btnPortrait     = $('btn-portrait');
const btnLandscape    = $('btn-landscape');
const pageBgPicker    = $('page-bg-picker');
const pageBgText      = $('page-bg-text');
const marginT         = $('margin-t');
const marginR         = $('margin-r');
const marginB         = $('margin-b');
const marginL         = $('margin-l');

const photoPreset     = $('photo-preset');
const customPhotoDims = $('custom-photo-dims');
const photoWInput     = $('photo-w');
const photoHInput     = $('photo-h');
const photoUnit       = $('photo-unit');
const lockAspect      = $('lock-aspect');

const btnModeAuto     = $('btn-mode-auto');
const btnModeFree     = $('btn-mode-free');
const autoControls    = $('auto-controls');
const spacingH        = $('spacing-h');
const spacingHVal     = $('spacing-h-val');
const spacingV        = $('spacing-v');
const spacingVVal     = $('spacing-v-val');
const btnArrange      = $('btn-arrange');

const exportFilename  = $('export-filename');
const btnPng          = $('btn-png');
const btnJpg          = $('btn-jpg');
const btnPdf          = $('btn-pdf');
const btnPrint        = $('btn-print');

const btnUndo         = $('btn-undo');
const btnRedo         = $('btn-redo');
const btnZoomOut      = $('btn-zoom-out');
const btnZoomIn       = $('btn-zoom-in');
const btnZoomFit      = $('btn-zoom-fit');
const btnZoom100      = $('btn-zoom-100');
const zoomDisplay     = $('zoom-display');
const itemToolbar     = $('item-toolbar');
const btnDeleteItem   = $('btn-delete-item');
const btnToggleTheme  = $('btn-toggle-theme');

const canvasWrap      = $('canvas-wrap');
const canvasScaler    = $('canvas-scaler');
const page            = $('page');
const marginsGuide    = $('margins-guide');
const itemsLayer      = $('items-layer');
const guidesLayer     = $('guides-layer');
const canvasPH        = $('canvas-placeholder');

const ctxMenu         = $('ctx-menu');
const ctxDelete       = $('ctx-delete');
const ctxDuplicate    = $('ctx-duplicate');

const statusPage      = $('info-page');
const statusPhoto     = $('info-photo');
const statusCount     = $('info-count');
const statusUsage     = $('info-usage');
const statusQuality   = $('info-quality');

const expPageSize     = $('exp-page-size');
const expPhotoSize    = $('exp-photo-size');
const expRes          = $('exp-res');
const expCount        = $('exp-count');

const cropModal       = $('crop-modal');
const cropImg         = $('crop-img');

const toastCont       = $('toast-container');


// ─── UTILITIES ────────────────────────────────────────────────────────────────
let _idCounter = 0;
function uid() { return 'id-' + (_idCounter++) + '-' + Date.now(); }

function toMm(value, unit) {
  const v = parseFloat(value);
  if (isNaN(v)) return 0;
  switch (unit) {
    case 'cm': return v * 10;
    case 'in': return v * 25.4;
    case 'px': return v / MM;
    default:   return v;
  }
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function toast(msg, type = 'info', ms = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  toastCont.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// Load a File into a data URL, resolving only after the image is verified loaded
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => resolve(e.target.result);
      img.onerror = () => reject(new Error('Cannot read image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

function hexValid(s) { return /^#[0-9a-fA-F]{6}$/.test(s); }


// ─── HISTORY ─────────────────────────────────────────────────────────────────
function snap() {
  const s = JSON.parse(JSON.stringify({
    items: state.items,
    page:  state.page,
    photoSize: state.photoSize,
    bgColor: state.bgColor,
    spacing: state.spacing,
    mode: state.mode,
    border: state.border
  }));
  history = history.slice(0, histIdx + 1);
  history.push(s);
  if (history.length > 60) { history.shift(); } else { histIdx = history.length - 1; }
  histIdx = history.length - 1;
  syncHistoryBtns();
}

function restore(s) {
  state.items    = JSON.parse(JSON.stringify(s.items));
  state.page     = JSON.parse(JSON.stringify(s.page));
  state.photoSize= JSON.parse(JSON.stringify(s.photoSize));
  state.bgColor  = s.bgColor;
  state.spacing  = JSON.parse(JSON.stringify(s.spacing));
  state.mode     = s.mode;
  state.border   = s.border ? JSON.parse(JSON.stringify(s.border)) : { enabled: false, width: 1, color: '#000000' };
  state.selected = [];
  syncControls();
  renderCanvas();
  syncHistoryBtns();
}

function syncHistoryBtns() {
  btnUndo.disabled = histIdx <= 0;
  btnRedo.disabled = histIdx >= history.length - 1;
}

btnUndo.addEventListener('click', () => {
  if (histIdx > 0) { histIdx--; restore(history[histIdx]); }
});
btnRedo.addEventListener('click', () => {
  if (histIdx < history.length - 1) { histIdx++; restore(history[histIdx]); }
});

window.addEventListener('keydown', e => {
  const inInput = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);
  if (inInput) return;
  if (e.ctrlKey && !e.shiftKey && e.key === 'z') { e.preventDefault(); btnUndo.click(); }
  if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); btnRedo.click(); }
});


// ─── SIDEBAR TABS ─────────────────────────────────────────────────────────────
QA('.stab[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.tab;
    QA('.stab[data-tab]').forEach(b => b.classList.remove('active'));
    QA('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${id}`)?.classList.add('active');
  });
});


// Ensure light mode is active
document.body.classList.remove('dark');


// ─── PHOTO UPLOAD ─────────────────────────────────────────────────────────────
dropzone.addEventListener('click', () => fileInput.click());
btnAddMore.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});
['dragleave','dragend'].forEach(ev => dropzone.addEventListener(ev, () => dropzone.classList.remove('drag-over')));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFiles(fileInput.files);
  fileInput.value = '';
});

async function handleFiles(files) {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const fileArr = Array.from(files);

  // Filter and validate up front
  const valid = [];
  for (const f of fileArr) {
    if (!allowed.includes(f.type)) { toast(`"${f.name}" is not a supported format.`, 'error'); continue; }
    if (f.size > 25 * 1024 * 1024)  { toast(`"${f.name}" is too large (max 25 MB).`, 'error'); continue; }
    valid.push(f);
  }

  if (!valid.length) return;

  // Show loading indicator on dropzone
  dropzone.classList.add('loading');
  if (valid.length > 1) toast(`Loading ${valid.length} photos…`, 'info', 2000);

  // Load all files in parallel
  const results = await Promise.allSettled(valid.map(async f => {
    const src = await fileToDataUrl(f);
    return { id: uid(), name: f.name, origSrc: src, src, hasBg: false };
  }));

  dropzone.classList.remove('loading');

  let added = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      state.photos.push(r.value);
      if (!state.activePhotoId) state.activePhotoId = r.value.id;
      added++;
    } else {
      toast(`Failed to load "${valid[i].name}".`, 'error');
    }
  });

  if (added > 0) {
    renderPhotoGrid();
    updateSelectedCard();
    if (added > 1) toast(`${added} photos added!`, 'success');
    if (state.mode === 'auto') autoArrange();
    snap();
  }
}

function deletePhoto(id) {
  state.photos      = state.photos.filter(p => p.id !== id);
  state.items       = state.items.filter(it => it.photoId !== id);
  state.selected    = state.selected.filter(s => state.items.some(it => it.id === s));
  state.selectedPhotoIds.delete(id);
  if (state.activePhotoId === id) {
    state.activePhotoId = state.photos[0]?.id ?? null;
  }
  if (state.photos.length > 0) {
    if (state.mode === 'auto') {
      autoArrange();
    } else {
      reflowItems();
      renderCanvas();
    }
  } else {
    state.items = [];
    renderCanvas();
  }
  renderPhotoGrid();
  updateSelectedCard();
  renderCopiesList();
  snap();
}

function renderPhotoGrid() {
  photoGrid.innerHTML = '';
  const hasPhotos = state.photos.length > 0;
  dropzone.style.display   = hasPhotos ? 'none' : 'block';
  btnAddMore.style.display = hasPhotos ? 'block' : 'none';
  btnRemoveBgAll.style.display = hasPhotos ? 'block' : 'none';
  if (hasPhotos) batchCount.textContent = state.photos.length;

  state.photos.forEach(photo => {
    const isActive   = photo.id === state.activePhotoId;
    const isChecked  = state.selectedPhotoIds.has(photo.id);
    const el = document.createElement('div');
    el.className = 'photo-thumb' + (isActive ? ' active' : '') + (isChecked ? ' checked' : '');
    el.dataset.id = photo.id;

    // Checkbox for multi-select
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'thumb-check';
    chk.checked = isChecked;
    chk.title = 'Select for batch action';
    chk.addEventListener('click', e => {
      e.stopPropagation();
      if (chk.checked) state.selectedPhotoIds.add(photo.id);
      else             state.selectedPhotoIds.delete(photo.id);
      renderPhotoGrid();
      updateSelectedCard();
    });

    const img = document.createElement('img');
    img.src = photo.src;
    img.alt = photo.name;
    img.loading = 'lazy';

    const name = document.createElement('div');
    name.className = 'thumb-name';
    name.textContent = photo.name;

    const del = document.createElement('button');
    del.className = 'thumb-del';
    del.textContent = '×';
    del.title = 'Remove photo';
    del.addEventListener('click', e => { e.stopPropagation(); deletePhoto(photo.id); });

    el.append(chk, img, name, del);
    el.addEventListener('click', e => {
      if (e.target === chk) return;
      state.activePhotoId = photo.id;
      state.selectedPhotoIds.add(photo.id);
      renderPhotoGrid();
      updateSelectedCard();
    });
    photoGrid.appendChild(el);
  });

  // Multi-select toolbar
  updateMultiSelectBar();
  // Copies list (per photo)
  renderCopiesList();
}

function updateMultiSelectBar() {
  const bar = $('multi-select-bar');
  const selCount = state.selectedPhotoIds.size;
  if (!bar) return;
  if (selCount >= 1) {
    bar.style.display = 'flex';
    $('multi-sel-count').textContent = selCount === 1 ? '1 photo selected' : `${selCount} photos selected`;
  } else {
    bar.style.display = 'none';
  }
}

function updateSelectedCard() {
  const photo = state.photos.find(p => p.id === state.activePhotoId);
  btnCrop.disabled      = !photo;
  btnRemoveBg.disabled  = !photo;

  // Clear preview
  let imgEl = selectedPreview.querySelector('img');
  let msgEl = selectedPreview.querySelector('.no-selection-msg');

  if (photo) {
    if (!imgEl) {
      msgEl?.remove();
      imgEl = document.createElement('img');
      imgEl.alt = 'Selected';
      imgEl.style.cssText = 'max-height:130px;max-width:100%;object-fit:contain;';
      selectedPreview.appendChild(imgEl);
    }
    imgEl.src = photo.src;
    selectedName.textContent = photo.name;
  } else {
    imgEl?.remove();
    if (!msgEl) {
      msgEl = document.createElement('div');
      msgEl.className = 'no-selection-msg';
      msgEl.textContent = 'Select a photo from the Photos tab';
      selectedPreview.appendChild(msgEl);
    }
    selectedName.textContent = 'No photo selected';
  }

  // Update copies counter
  updateCopiesCounter();
}


// ─── PER-PHOTO COPIES LIST ────────────────────────────────────────────────────
const copiesListContainer = $('copies-list-container');
const copiesList          = $('copies-list');

function renderCopiesList() {
  if (!copiesList) return;
  copiesList.innerHTML = '';

  const hasPhotos = state.photos.length > 0;
  if (copiesListContainer) copiesListContainer.style.display = hasPhotos ? 'block' : 'none';
  if (!hasPhotos) return;

  state.photos.forEach(photo => {
    const count = state.items.filter(it => it.photoId === photo.id).length;

    const row = document.createElement('div');
    row.className = 'photo-copies-row';

    // Thumbnail
    const thumb = document.createElement('img');
    thumb.src = photo.src;
    thumb.alt = photo.name;
    thumb.className = 'photo-copies-thumb';

    // Name
    const nameEl = document.createElement('span');
    nameEl.className = 'photo-copies-name';
    nameEl.textContent = photo.name;
    nameEl.title = photo.name;

    // Stepper
    const stepper = document.createElement('div');
    stepper.className = 'copies-stepper';

    const btnMinus = document.createElement('button');
    btnMinus.className = 'copies-btn';
    btnMinus.innerHTML = '&minus;';
    btnMinus.title = 'Remove one copy';
    btnMinus.disabled = count === 0;
    btnMinus.addEventListener('click', () => {
      const itemsOfPhoto = state.items.filter(it => it.photoId === photo.id);
      if (!itemsOfPhoto.length) return;
      const toRemove = itemsOfPhoto[itemsOfPhoto.length - 1];
      state.items    = state.items.filter(it => it.id !== toRemove.id);
      state.selected = state.selected.filter(id => id !== toRemove.id);
      // Re-flow all remaining items to close the gap
      reflowItems();
      renderCanvas();
      snap();
    });

    const countEl = document.createElement('span');
    countEl.className = 'copies-count';
    countEl.textContent = count;

    const btnPlus = document.createElement('button');
    btnPlus.className = 'copies-btn';
    btnPlus.innerHTML = '&plus;';
    btnPlus.title = 'Add one copy';
    btnPlus.addEventListener('click', () => {
      // Add one copy of this photo and slot it in at the next available position
      const newItem = {
        id:      uid(),
        photoId: photo.id,
        x:       0,
        y:       0,
        w:       state.photoSize.w,
        h:       state.photoSize.h
      };
      state.items.push(newItem);
      state.selected = [newItem.id];
      // Re-flow to assign proper position
      reflowItems();
      renderCanvas();
      snap();
    });

    stepper.append(btnMinus, countEl, btnPlus);
    row.append(thumb, nameEl, stepper);
    copiesList.appendChild(row);
  });
}

// Stub so existing callers don't break
function updateCopiesCounter() { renderCopiesList(); }



// ─── CROP MODAL ───────────────────────────────────────────────────────────────
let cropUndoStack = [];
const btnCundo = $('btn-cundo');

btnCrop.addEventListener('click', () => openCrop());

function openCrop() {
  const photo = state.photos.find(p => p.id === state.activePhotoId);
  if (!photo) return;
  cropUndoStack = [];
  if (btnCundo) btnCundo.disabled = true;
  cropImg.src = photo.src;
  cropModal.style.display = 'flex';
  if (cropperJS) { cropperJS.destroy(); cropperJS = null; }
  const aspect = state.photoSize.w / state.photoSize.h;
  cropImg.onload = () => {
    cropperJS = new Cropper(cropImg, {
      aspectRatio: aspect,
      viewMode: 1,
      autoCropArea: 0.9,
      movable: true,
      zoomable: true,
      cropBoxResizable: true
    });
  };
}

$('btn-crop-close').addEventListener('click',  closeCrop);
$('btn-crop-cancel').addEventListener('click', closeCrop);
function closeCrop() {
  cropModal.style.display = 'none';
  cropperJS?.destroy(); cropperJS = null;
  cropUndoStack = [];
  if (btnCundo) btnCundo.disabled = true;
}

// ─── Crop Undo Stack ──────────────────────────────────────────────────────────


function cropSaveUndo() {
  if (!cropperJS) return;
  // Save current image data URL + cropper canvas data for full restore
  const canvasData  = cropperJS.getCanvasData();
  const cropBoxData = cropperJS.getCropBoxData();
  const imgData     = cropperJS.getData();
  const snapshot    = { canvasData, cropBoxData, imgData };
  cropUndoStack.push(snapshot);
  if (btnCundo) btnCundo.disabled = false;
}

function cropUndo() {
  if (!cropperJS || !cropUndoStack.length) return;
  const prev = cropUndoStack.pop();
  // Restore canvas position/scale then crop box
  cropperJS.setCanvasData(prev.canvasData);
  cropperJS.setCropBoxData(prev.cropBoxData);
  if (btnCundo) btnCundo.disabled = cropUndoStack.length === 0;
}

if (btnCundo) btnCundo.addEventListener('click', cropUndo);

// Ctrl+Z while modal is open
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && cropModal.style.display !== 'none') {
    e.preventDefault();
    cropUndo();
  }
});

function cropAction(fn) {
  cropSaveUndo();
  fn();
}

$('btn-crot-l').addEventListener('click',  () => cropAction(() => cropperJS?.rotate(-90)));
$('btn-crot-r').addEventListener('click',  () => cropAction(() => cropperJS?.rotate(90)));
$('btn-cflip-h').addEventListener('click', () => cropAction(() => {
  const d = cropperJS?.getData(); if (d) cropperJS.scaleX(-(d.scaleX || 1));
}));
$('btn-cflip-v').addEventListener('click', () => cropAction(() => {
  const d = cropperJS?.getData(); if (d) cropperJS.scaleY(-(d.scaleY || 1));
}));
$('btn-czoom-in').addEventListener('click',  () => cropAction(() => cropperJS?.zoom(0.1)));
$('btn-czoom-out').addEventListener('click', () => cropAction(() => cropperJS?.zoom(-0.1)));
$('btn-creset').addEventListener('click', () => {
  // Reset clears the undo stack too
  cropUndoStack = [];
  if (btnCundo) btnCundo.disabled = true;
  cropperJS?.reset();
});

$('btn-crop-apply').addEventListener('click', () => {
  if (!cropperJS) return;
  const c = cropperJS.getCroppedCanvas({ imageSmoothingQuality: 'high' });
  const src = c.toDataURL('image/png');
  const photo = state.photos.find(p => p.id === state.activePhotoId);
  if (photo) {
    photo.src = src;
    renderPhotoGrid();
    updateSelectedCard();
    renderCanvas();
    snap();
    toast('Crop applied!', 'success');
  }
  closeCrop();
});


// ─── AI BACKGROUND REMOVAL (@imgly/background-removal) ───────────────────────
// Cached reference to the removeBackground function from @imgly/background-removal
let _imglyRemoveBg = null;
let _imglyLoading = false;

/**
 * Lazily import @imgly/background-removal from CDN.
 * The library handles its own ONNX model download + IndexedDB caching.
 * After first load, the module is cached in _imglyRemoveBg.
 */
async function ensureImglyLoaded() {
  if (_imglyRemoveBg) return;
  if (_imglyLoading) {
    // Another call is already loading — wait for it
    while (_imglyLoading) await new Promise(r => setTimeout(r, 100));
    if (_imglyRemoveBg) return;
    throw new Error('AI model failed to load. Please try again.');
  }
  _imglyLoading = true;
  aiProgress.style.display = 'flex';
  aiStatusText.textContent = 'Loading local AI model (~40 MB, cached after first use)…';
  aiPct.textContent = '';
  try {
    const module = await import(
      /* webpackIgnore: true */
      '/lib/imgly/index.mjs'
    );
    _imglyRemoveBg = module.removeBackground;
    if (typeof _imglyRemoveBg !== 'function') {
      throw new Error('Library loaded but removeBackground function not found.');
    }
  } catch (err) {
    _imglyRemoveBg = null;
    const msg = err?.message || '';
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('ERR_')) {
      throw new Error('Unable to load local AI model. Check if server is running.');
    }
    if (msg.includes('memory') || msg.includes('OOM')) {
      throw new Error('Out of memory. Close other tabs and try again.');
    }
    if (msg.includes('wasm') || msg.includes('WebAssembly')) {
      throw new Error('Your browser does not support WebAssembly. Please use a modern browser (Chrome, Edge, Firefox, or Safari).');
    }
    throw new Error('AI model could not be loaded: ' + (msg || 'Unknown error. Please try again.'));
  } finally {
    _imglyLoading = false;
  }
}

/**
 * Convert a data URL to a Blob (required by @imgly/background-removal).
 */
function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * Remove background from a single photo object using @imgly/background-removal.
 * Preserves original resolution, outputs transparent PNG.
 */
async function removeBg(photo) {
  aiProgress.style.display = 'flex';
  aiStatusText.textContent = 'Removing background…';
  aiPct.textContent = '';

  const runModel = async (modelName) => {
    const inputBlob = dataUrlToBlob(photo.src);
    return await _imglyRemoveBg(inputBlob, {
      publicPath: window.location.origin + '/lib/imgly/',
      model: modelName,
      output: { format: 'image/png', quality: 1.0 },
      progress: (key, current, total) => {
        if (key === 'compute:inference') {
          aiStatusText.textContent = 'AI is processing cutout…';
        } else if (key === 'fetch:model') {
          aiStatusText.textContent = `Loading local AI model (${modelName} quality)…`;
          if (total > 0) aiPct.textContent = `(${Math.round((current / total) * 100)}%)`;
        }
      }
    });
  };

  try {
    let resultBlob;
    try {
      resultBlob = await runModel('medium');
    } catch (mediumErr) {
      console.warn('Medium model failed, falling back to small model:', mediumErr);
      aiStatusText.textContent = 'Retrying with lightweight model…';
      resultBlob = await runModel('small');
    }

    // Convert result Blob to data URL to maintain compatibility with rest of app
    const resultUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read result image.'));
      reader.readAsDataURL(resultBlob);
    });

    photo.src   = resultUrl;
    photo.hasBg = true;
  } catch (err) {
    console.error('Background removal error:', err);
    const msg = err?.message || String(err) || '';
    if (msg.includes('memory') || msg.includes('OOM') || msg.includes('allocation')) {
      throw new Error('Out of memory. Try a smaller photo resolution or close unused browser tabs.');
    }
    if (msg.includes('corrupt') || msg.includes('decode') || msg.includes('invalid image')) {
      throw new Error('Image format not supported or corrupted. Please try a different photo.');
    }
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('ERR_')) {
      throw new Error('Unable to read local AI model files. Please refresh the page and try again.');
    }
    throw new Error('Background removal failed: ' + (msg || 'Unknown error. Please try again.'));
  }
}

// Single photo background removal
btnRemoveBg.addEventListener('click', async () => {
  const photo = state.photos.find(p => p.id === state.activePhotoId);
  if (!photo) return;
  btnRemoveBg.disabled = true;
  btnRemoveBgAll.disabled = true;
  try {
    await ensureImglyLoaded();
    await removeBg(photo);
    renderPhotoGrid();
    updateSelectedCard();
    renderCanvas();
    snap();
    toast('Background removed!', 'success');
  } catch (e) {
    toast(e.message, 'error', 5000);
  } finally {
    aiProgress.style.display = 'none';
    btnRemoveBg.disabled = false;
    btnRemoveBgAll.disabled = false;
  }
});

// Batch background removal (process sequentially to avoid browser crashes)
btnRemoveBgAll.addEventListener('click', async () => {
  if (!state.photos.length) return;
  btnRemoveBgAll.disabled = true;
  btnRemoveBg.disabled = true;
  let success = 0;
  let failed = 0;
  try {
    await ensureImglyLoaded();
    for (let i = 0; i < state.photos.length; i++) {
      aiStatusText.textContent = `Processing photo ${i + 1} of ${state.photos.length}…`;
      aiPct.textContent = '';
      try {
        await removeBg(state.photos[i]);
        success++;
      } catch (err) {
        failed++;
        toast(`Photo ${i + 1} failed: ${err.message}`, 'error', 4000);
      }
    }
    renderPhotoGrid();
    updateSelectedCard();
    renderCanvas();
    snap();
    if (failed === 0) {
      toast(`All ${success} backgrounds removed!`, 'success');
    } else {
      toast(`${success} removed, ${failed} failed.`, 'error', 5000);
    }
  } catch (e) {
    toast(e.message, 'error', 5000);
  } finally {
    aiProgress.style.display = 'none';
    btnRemoveBgAll.disabled = false;
    btnRemoveBg.disabled = !state.activePhotoId;
  }
});

// Reset photo to original (restore from origSrc)
btnResetBg.addEventListener('click', () => {
  const photo = state.photos.find(p => p.id === state.activePhotoId);
  if (!photo) return;
  photo.src   = photo.origSrc;
  photo.hasBg = false;
  renderPhotoGrid();
  updateSelectedCard();
  renderCanvas();
  snap();
  toast('Photo reset to original.', 'info');
});


// ─── MULTI-PHOTO BATCH ACTIONS ────────────────────────────────────────────────

// Select All / Deselect All shortcuts
document.addEventListener('click', e => {
  if (e.target.id === 'btn-select-all') {
    state.photos.forEach(p => state.selectedPhotoIds.add(p.id));
    if (state.photos.length) state.activePhotoId = state.photos[0].id;
    renderPhotoGrid(); updateSelectedCard();
  }
  if (e.target.id === 'btn-deselect-all') {
    state.selectedPhotoIds.clear();
    renderPhotoGrid(); updateSelectedCard();
  }
});

// Remove BG for selected photos
document.addEventListener('click', async e => {
  if (e.target.id !== 'btn-rmbg-selected') return;
  const ids = [...state.selectedPhotoIds];
  if (!ids.length) return;
  const photos = state.photos.filter(p => ids.includes(p.id));
  $('btn-rmbg-selected').disabled = true;
  $('btn-reset-selected').disabled = true;
  let success = 0, failed = 0;
  try {
    await ensureImglyLoaded();
    for (let i = 0; i < photos.length; i++) {
      aiStatusText.textContent = `Removing background ${i + 1}/${photos.length}…`;
      aiPct.textContent = '';
      try { await removeBg(photos[i]); success++; }
      catch(err) { failed++; toast(`"${photos[i].name}" failed: ${err.message}`, 'error', 4000); }
    }
    renderPhotoGrid(); updateSelectedCard(); renderCanvas(); snap();
    toast(failed === 0 ? `✅ ${success} backgrounds removed!` : `${success} done, ${failed} failed.`, failed ? 'error' : 'success');
  } catch(e) { toast(e.message, 'error', 5000); }
  finally {
    aiProgress.style.display = 'none';
    const b = $('btn-rmbg-selected'); if (b) b.disabled = false;
    const c = $('btn-reset-selected'); if (c) c.disabled = false;
  }
});

// Reset selected photos to original
document.addEventListener('click', e => {
  if (e.target.id !== 'btn-reset-selected') return;
  const ids = [...state.selectedPhotoIds];
  if (!ids.length) return;
  state.photos.filter(p => ids.includes(p.id)).forEach(p => { p.src = p.origSrc; p.hasBg = false; });
  renderPhotoGrid(); updateSelectedCard(); renderCanvas(); snap();
  toast(`${ids.length} photo${ids.length > 1 ? 's' : ''} reset to original.`, 'info');
});

// ─── BACKGROUND COLOR ─────────────────────────────────────────────────────────
function setPhotoBgColor(color) {
  state.bgColor = color;
  bgColorPicker.value = color;
  bgColorHex.value    = color;
  // Update active swatch
  QA('.color-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === color);
  });
  renderCanvas();
}

QA('.color-swatch[data-color]').forEach(sw => {
  sw.addEventListener('click', () => setPhotoBgColor(sw.dataset.color));
});

bgColorPicker.addEventListener('input', e => {
  setPhotoBgColor(e.target.value);
  snap();
});
bgColorHex.addEventListener('change', () => {
  const v = bgColorHex.value.trim();
  if (hexValid(v)) { setPhotoBgColor(v); snap(); }
});
$('custom-swatch').addEventListener('click', () => bgColorPicker.click());


// ─── PHOTO BORDER ─────────────────────────────────────────────────────────────
function applyBorderColor(color) {
  state.border.color = color;
  borderColorPicker.value = color;
  borderColorText.textContent = color;
  QA('[data-border-color]').forEach(sw =>
    sw.classList.toggle('active', sw.dataset.borderColor === color)
  );
  renderCanvas();
}

borderEnabled.addEventListener('change', () => {
  state.border.enabled = borderEnabled.checked;
  borderControls.style.display = borderEnabled.checked ? 'block' : 'none';
  renderCanvas();
  snap();
});

borderWidthSlider.addEventListener('input', () => {
  state.border.width = parseFloat(borderWidthSlider.value);
  borderWidthVal.textContent = state.border.width;
  renderCanvas();
});
borderWidthSlider.addEventListener('change', snap);

borderColorPicker.addEventListener('input', e => {
  applyBorderColor(e.target.value);
});
borderColorPicker.addEventListener('change', snap);

QA('[data-border-color]').forEach(sw => {
  sw.addEventListener('click', () => { applyBorderColor(sw.dataset.borderColor); snap(); });
});


// ─── PAGE SETTINGS ────────────────────────────────────────────────────────────
pagePreset.addEventListener('change', () => {
  const v = pagePreset.value;
  if (v === 'custom') {
    customPageDims.style.display = 'block';
    return;
  }
  customPageDims.style.display = 'none';
  const p = PAGE[v];
  if (!p) return;
  state.page.preset = v;
  if (state.page.portrait) { state.page.w = p.w; state.page.h = p.h; }
  else                     { state.page.w = p.h; state.page.h = p.w; }
  updatePageInputs();
  if (state.mode === 'auto') autoArrange();
  else renderCanvas();
  snap();
});

function updatePageInputs() {
  const unit = pageUnit.value;
  let f = 1;
  if (unit === 'cm') f = 0.1;
  else if (unit === 'in') f = 1/25.4;
  else if (unit === 'px') f = MM;
  pageWInput.value = +(state.page.w * f).toFixed(2);
  pageHInput.value = +(state.page.h * f).toFixed(2);
}

pageUnit.addEventListener('change', updatePageInputs);

function applyCustomPageDims() {
  const unit = pageUnit.value;
  const w = toMm(pageWInput.value, unit);
  const h = toMm(pageHInput.value, unit);
  if (w < 20 || h < 20) return;
  state.page.w = w; state.page.h = h;
  state.page.preset = 'custom';
  pagePreset.value = 'custom';
  if (state.mode === 'auto') autoArrange(); else renderCanvas();
  snap();
}
pageWInput.addEventListener('change', applyCustomPageDims);
pageHInput.addEventListener('change', applyCustomPageDims);

btnPortrait.addEventListener('click', () => {
  if (state.page.portrait) return;
  state.page.portrait = true;
  if (state.page.w > state.page.h) { [state.page.w, state.page.h] = [state.page.h, state.page.w]; }
  updatePageInputs();
  btnPortrait.classList.add('active'); btnLandscape.classList.remove('active');
  if (state.mode === 'auto') autoArrange(); else renderCanvas();
  snap();
});
btnLandscape.addEventListener('click', () => {
  if (!state.page.portrait) return;
  state.page.portrait = false;
  if (state.page.w < state.page.h) { [state.page.w, state.page.h] = [state.page.h, state.page.w]; }
  updatePageInputs();
  btnLandscape.classList.add('active'); btnPortrait.classList.remove('active');
  if (state.mode === 'auto') autoArrange(); else renderCanvas();
  snap();
});

pageBgPicker.addEventListener('input', e => {
  state.page.bg = e.target.value;
  pageBgText.textContent = state.page.bg;
  renderCanvas();
});
pageBgPicker.addEventListener('change', snap);

function readMargins() {
  state.page.margins.t = parseFloat(marginT.value) || 0;
  state.page.margins.r = parseFloat(marginR.value) || 0;
  state.page.margins.b = parseFloat(marginB.value) || 0;
  state.page.margins.l = parseFloat(marginL.value) || 0;
}
[marginT, marginR, marginB, marginL].forEach(inp => {
  inp.addEventListener('change', () => {
    readMargins();
    if (state.mode === 'auto') autoArrange(); else renderCanvas();
    snap();
  });
});


// ─── PHOTO SIZE SETTINGS ──────────────────────────────────────────────────────
photoPreset.addEventListener('change', () => {
  const v = photoPreset.value;
  if (v === 'custom') {
    customPhotoDims.style.display = 'block';
    return;
  }
  customPhotoDims.style.display = 'none';
  const p = PHOTO[v];
  if (!p) return;
  state.photoSize.preset = v;
  state.photoSize.w = p.w;
  state.photoSize.h = p.h;
  photoWInput.value = +(p.w).toFixed(1);
  photoHInput.value = +(p.h).toFixed(1);
  if (state.mode === 'auto') autoArrange(); else renderCanvas();
  snap();
});

function applyCustomPhotoDims() {
  const unit = photoUnit.value;
  const w = toMm(photoWInput.value, unit);
  const h = toMm(photoHInput.value, unit);
  if (w < 5 || h < 5) return;
  state.photoSize.w = w;
  state.photoSize.h = h;
  state.photoSize.preset = 'custom';
  photoPreset.value = 'custom';
  customPhotoDims.style.display = 'block';
  if (state.mode === 'auto') autoArrange(); else renderCanvas();
  snap();
}

photoWInput.addEventListener('change', () => {
  if (lockAspect.checked && state.photoSize.h > 0) {
    const ratio = state.photoSize.h / state.photoSize.w;
    const unit = photoUnit.value;
    const w = toMm(photoWInput.value, unit);
    let f = 1;
    if (unit === 'cm') f = 0.1; else if (unit === 'in') f = 1/25.4; else if (unit === 'px') f = 1/MM;
    photoHInput.value = +((w * ratio) * f).toFixed(2);
  }
  applyCustomPhotoDims();
});
photoHInput.addEventListener('change', () => {
  if (lockAspect.checked && state.photoSize.w > 0) {
    const ratio = state.photoSize.w / state.photoSize.h;
    const unit = photoUnit.value;
    const h = toMm(photoHInput.value, unit);
    let f = 1;
    if (unit === 'cm') f = 0.1; else if (unit === 'in') f = 1/25.4; else if (unit === 'px') f = 1/MM;
    photoWInput.value = +((h * ratio) * f).toFixed(2);
  }
  applyCustomPhotoDims();
});


// ─── LAYOUT MODE ──────────────────────────────────────────────────────────────
btnModeAuto.addEventListener('click', () => {
  state.mode = 'auto';
  btnModeAuto.classList.add('active'); btnModeFree.classList.remove('active');
  autoControls.style.display = 'block';
  autoArrange();
  snap();
});
btnModeFree.addEventListener('click', () => {
  state.mode = 'free';
  btnModeFree.classList.add('active'); btnModeAuto.classList.remove('active');
  autoControls.style.display = 'none';
  snap();
});


// ─── SPACING ─────────────────────────────────────────────────────────────────
spacingH.addEventListener('input', () => {
  state.spacing.h = parseFloat(spacingH.value);
  spacingHVal.textContent = state.spacing.h;
  if (state.mode === 'auto') autoArrange();
});
spacingH.addEventListener('change', snap);
spacingV.addEventListener('input', () => {
  state.spacing.v = parseFloat(spacingV.value);
  spacingVVal.textContent = state.spacing.v;
  if (state.mode === 'auto') autoArrange();
});
spacingV.addEventListener('change', snap);
btnArrange.addEventListener('click', () => { autoArrange(); snap(); });


// ─── AUTO ARRANGE ─────────────────────────────────────────────────────────────
// CRITICAL: this MUST never place photos outside the page
// ─── REFLOW ITEMS ─────────────────────────────────────────────────────────────
// Re-positions all existing state.items in a sequential grid without changing
// their photoIds or count. Used by the + / − copies buttons.
function reflowItems() {
  if (!state.items.length) return;

  const { w: PW, h: PH, margins: M } = state.page;
  const { w: phW, h: phH }           = state.photoSize;
  const { h: spH, v: spV }           = state.spacing;

  const availW = PW - M.l - M.r;
  const availH = PH - M.t - M.b;
  if (availW <= 0 || availH <= 0 || phW <= 0 || phH <= 0) return;

  const cols    = Math.max(1, Math.floor((availW + spH) / (phW + spH)));
  const rows    = Math.max(1, Math.floor((availH + spV) / (phH + spV)));
  const gridW   = cols * phW + (cols - 1) * spH;
  const gridH   = rows * phH + (rows - 1) * spV;
  const startX  = M.l + Math.max(0, (availW - gridW) / 2);
  const startY  = M.t + Math.max(0, (availH - gridH) / 2);

  // Group consecutive: sort by each photo's index in state.photos so all
  // copies of the same photo appear together on the sheet.
  const photoOrder = new Map(state.photos.map((p, i) => [p.id, i]));
  state.items.sort((a, b) => (photoOrder.get(a.photoId) ?? 0) - (photoOrder.get(b.photoId) ?? 0));

  state.items.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    item.x = startX + col * (phW + spH);
    item.y = startY + row * (phH + spV);
    item.w = phW;
    item.h = phH;
  });
}

function autoArrange() {
  if (!state.photos.length) {
    state.items = [];
    renderCanvas();
    return;
  }

  const { w: PW, h: PH, margins: M } = state.page;
  const { w: phW, h: phH }           = state.photoSize;
  const { h: spH, v: spV }           = state.spacing;

  const availW = PW - M.l - M.r;
  const availH = PH - M.t - M.b;

  if (availW <= 0 || availH <= 0 || phW <= 0 || phH <= 0) {
    state.items = [];
    renderCanvas();
    return;
  }

  // How many photos fit (must be at least 1)
  const cols = Math.max(1, Math.floor((availW + spH) / (phW + spH)));
  const rows = Math.max(1, Math.floor((availH + spV) / (phH + spV)));

  // Actual grid dimensions
  const gridW = cols * phW + (cols - 1) * spH;
  const gridH = rows * phH + (rows - 1) * spV;

  // Center within printable area
  const startX = M.l + Math.max(0, (availW - gridW) / 2);
  const startY = M.t + Math.max(0, (availH - gridH) / 2);

  let maxSlots = cols * rows;
  const newItems = [];

  const numPhotos = state.photos.length;
  const baseCopies = Math.floor(maxSlots / numPhotos);
  const remainder = maxSlots % numPhotos;

  const photoIdsToPlace = [];
  for (let i = 0; i < numPhotos; i++) {
    const copies = baseCopies + (i < remainder ? 1 : 0);
    for (let c = 0; c < copies; c++) {
      photoIdsToPlace.push(state.photos[i].id);
    }
  }

  for (let i = 0; i < maxSlots; i++) {
    const photoId = photoIdsToPlace[i] || state.photos[0].id;
    const col = i % cols;
    const row = Math.floor(i / cols);
    newItems.push({
      id:      uid(),
      photoId: photoId,
      x: startX + col * (phW + spH),
      y: startY + row * (phH + spV),
      w: phW,
      h: phH
    });
  }

  state.items    = newItems;
  state.selected = [];
  renderCanvas();
}


// ─── CANVAS RENDERING ─────────────────────────────────────────────────────────
function renderCanvas() {
  // 1. Page dimensions
  const PW = state.page.w * MM;
  const PH = state.page.h * MM;
  page.style.width  = PW + 'px';
  page.style.height = PH + 'px';
  page.style.backgroundColor = state.page.bg;

  // 2. Margins guide
  const M = state.page.margins;
  const ml = M.l * MM, mt = M.t * MM;
  const mw = (state.page.w - M.l - M.r) * MM;
  const mh = (state.page.h - M.t - M.b) * MM;
  marginsGuide.style.left   = ml + 'px';
  marginsGuide.style.top    = mt + 'px';
  marginsGuide.style.width  = Math.max(0, mw) + 'px';
  marginsGuide.style.height = Math.max(0, mh) + 'px';

  // 2.5. Clear any orphaned lasso boxes
  QA('.lasso-box').forEach(el => {
    if (!dragState || dragState.el !== el) {
      el.remove();
    }
  });

  // 3. Clear items layer
  itemsLayer.innerHTML = '';

  if (state.items.length === 0) {
    const ph = document.createElement('div');
    ph.className = 'canvas-placeholder';
    ph.innerHTML = state.photos.length > 0
      ? 'Click <strong>Auto Arrange Photos</strong> in the Layout tab to place photos on the page.'
      : 'Upload photos in the Photos tab to get started.';
    itemsLayer.appendChild(ph);
    updateStatusBar();
    return;
  }

  // 4. Render each item
  state.items.forEach((item, idx) => {
    const photo = state.photos.find(p => p.id === item.photoId);
    if (!photo) return;

    const el = document.createElement('div');
    el.className = 'photo-item' + (state.selected.includes(item.id) ? ' selected' : '');
    el.dataset.id = item.id;
    el.style.left   = (item.x * MM) + 'px';
    el.style.top    = (item.y * MM) + 'px';
    el.style.width  = (item.w * MM) + 'px';
    el.style.height = (item.h * MM) + 'px';
    el.style.backgroundColor = state.bgColor;
    el.style.outline = '';
    el.style.outlineOffset = '';

    const img = document.createElement('img');
    img.src = photo.src;
    img.alt = photo.name;
    img.draggable = false;

    // Apply brightness, contrast, saturation filters
    const b = item.brightness ?? state.filters.brightness ?? 100;
    const c = item.contrast ?? state.filters.contrast ?? 100;
    const s = item.saturation ?? state.filters.saturation ?? 100;
    if (b !== 100 || c !== 100 || s !== 100) {
      img.style.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
    } else {
      img.style.filter = '';
    }

    el.appendChild(img);

    if (state.border.enabled) {
      const bDiv = document.createElement('div');
      bDiv.className = 'photo-border-overlay';
      const bw = Math.max(1, state.border.width * MM);
      bDiv.style.position = 'absolute';
      bDiv.style.inset = '0';
      bDiv.style.border = `${bw}px solid ${state.border.color}`;
      bDiv.style.pointerEvents = 'none';
      bDiv.style.zIndex = '5';
      bDiv.style.boxSizing = 'border-box';
      el.appendChild(bDiv);
    }



    // Resize handles if selected
    if (state.selected.includes(item.id)) {
      ['tl','tr','bl','br'].forEach(dir => {
        const h = document.createElement('div');
        h.className = `rhandle ${dir}`;
        h.dataset.dir = dir;
        el.appendChild(h);
      });
    }

    itemsLayer.appendChild(el);
  });

  updateStatusBar();
  updateCopiesCounter();
}

function updateStatusBar() {
  const { w: PW, h: PH, preset } = state.page;
  const { w: phW, h: phH }       = state.photoSize;
  const n = state.items.length;
  const totalArea = PW * PH;
  const usedArea  = state.items.reduce((s, it) => s + it.w * it.h, 0);
  const usage     = totalArea > 0 ? Math.round((usedArea / totalArea) * 100) : 0;

  const dpi = parseInt(Q('input[name="dpi"]:checked')?.value) || 300;

  statusPage.textContent    = `${preset !== 'custom' ? preset + ' · ' : ''}${Math.round(PW)}×${Math.round(PH)} mm`;
  statusPhoto.textContent   = `${phW}×${phH} mm`;
  statusCount.textContent   = `${n} photo${n !== 1 ? 's' : ''}`;
  statusUsage.textContent   = usage + '%';
  statusQuality.textContent = dpi >= 300 ? '⭐ ' + dpi + ' DPI' : dpi + ' DPI';

  // Export panel info
  const expW = Math.round(PW * dpi / 25.4);
  const expH = Math.round(PH * dpi / 25.4);
  expPageSize.textContent  = `${preset !== 'custom' ? preset + ' · ' : ''}${Math.round(PW)}×${Math.round(PH)} mm`;
  expPhotoSize.textContent = `${phW}×${phH} mm`;
  expRes.textContent       = `${expW.toLocaleString()} × ${expH.toLocaleString()} px`;
  expCount.textContent     = n;

  // Toolbar
  itemToolbar.style.display = state.selected.length ? 'flex' : 'none';
}


// ─── ZOOM & PAN ───────────────────────────────────────────────────────────────
function applyTransform() {
  canvasScaler.style.transform = `translate(${state.panX}px,${state.panY}px) scale(${state.zoom})`;
  zoomDisplay.textContent = Math.round(state.zoom * 100) + '%';
}

function setZoom(z, originX, originY) {
  const prev = state.zoom;
  state.zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
  if (originX != null) {
    const r = state.zoom / prev;
    state.panX = originX - r * (originX - state.panX);
    state.panY = originY - r * (originY - state.panY);
  }
  applyTransform();
}

function fitPage() {
  const cw = canvasWrap.clientWidth;
  const ch = canvasWrap.clientHeight;
  const pw = state.page.w * MM;
  const ph = state.page.h * MM;
  const z  = Math.min((cw - 80) / pw, (ch - 80) / ph, MAX_ZOOM);
  state.zoom = Math.max(z, MIN_ZOOM);
  state.panX = (cw - pw * state.zoom) / 2;
  state.panY = (ch - ph * state.zoom) / 2;
  applyTransform();
}

btnZoomIn.addEventListener('click',  () => setZoom(state.zoom + 0.1));
btnZoomOut.addEventListener('click', () => setZoom(state.zoom - 0.1));
btnZoomFit.addEventListener('click', fitPage);
btnZoom100.addEventListener('click', () => {
  state.zoom = 1;
  state.panX = (canvasWrap.clientWidth  - state.page.w * MM) / 2;
  state.panY = (canvasWrap.clientHeight - state.page.h * MM) / 2;
  applyTransform();
});

// Ctrl+wheel zoom
canvasWrap.addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const r = canvasWrap.getBoundingClientRect();
  const ox = e.clientX - r.left;
  const oy = e.clientY - r.top;
  setZoom(state.zoom * (e.deltaY < 0 ? 1.1 : 0.9), ox, oy);
}, { passive: false });

// Middle-button pan / spacebar pan
canvasWrap.addEventListener('mousedown', e => {
  if (e.button === 1 || isSpacePanning) {
    e.preventDefault();
    isPanning = true;
    panStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
    canvasWrap.style.cursor = 'grabbing';
  }
});

window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
    e.preventDefault();
    isSpacePanning = true;
    canvasWrap.style.cursor = 'grab';
  }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    isSpacePanning = false; isPanning = false;
    canvasWrap.style.cursor = '';
  }
});

// Fit page on canvas wrap resize
const resizeObs = new ResizeObserver(fitPage);
resizeObs.observe(canvasWrap);


// ─── CANVAS INTERACTION (drag, resize, lasso, context menu) ───────────────────
let dragState = null;

canvasWrap.addEventListener('mousedown', e => {
  hideCtxMenu();
  if (e.button === 1 || isSpacePanning) return; // handled above
  if (e.button !== 0) return;

  const rect = canvasScaler.getBoundingClientRect();
  // World-space coordinate (mm)
  const wx = (e.clientX - rect.left) / state.zoom / MM;
  const wy = (e.clientY - rect.top)  / state.zoom / MM;

  // Did we click a resize handle?
  const rhandle = e.target.closest('.rhandle');
  if (rhandle && rhandle.closest('.photo-item')) {
    const itemEl = rhandle.closest('.photo-item');
    const item   = state.items.find(it => it.id === itemEl.dataset.id);
    if (!item) return;
    e.preventDefault();
    const aspect = item.w / item.h;
    dragState = {
      type: 'resize',
      dir:  rhandle.dataset.dir,
      item,
      aspect,
      startClientX: e.clientX, startClientY: e.clientY,
      startW: item.w, startH: item.h, startX: item.x, startY: item.y
    };
    return;
  }

  // Did we click a photo item?
  const itemEl = e.target.closest('.photo-item');
  if (itemEl) {
    const item = state.items.find(it => it.id === itemEl.dataset.id);
    if (!item) return;
    e.preventDefault();

    // Selection
    if (e.shiftKey) {
      const idx = state.selected.indexOf(item.id);
      if (idx === -1) state.selected.push(item.id);
      else state.selected.splice(idx, 1);
    } else if (!state.selected.includes(item.id)) {
      state.selected = [item.id];
    }
    renderCanvas();

    // Start drag-move
    dragState = {
      type: 'move',
      items: state.selected.map(id => {
        const it = state.items.find(i => i.id === id);
        return it ? { id, startX: it.x, startY: it.y } : null;
      }).filter(Boolean),
      startClientX: e.clientX, startClientY: e.clientY,
      anchorItem: item
    };
    return;
  }

  // Clicked empty canvas — start lasso
  state.selected = [];
  renderCanvas();
  const lassoEl = document.createElement('div');
  lassoEl.className = 'lasso-box';
  lassoEl.style.left = wx * MM + 'px';
  lassoEl.style.top  = wy * MM + 'px';
  page.appendChild(lassoEl);

  dragState = {
    type: 'lasso',
    startWX: wx, startWY: wy,
    startClientX: e.clientX, startClientY: e.clientY,
    el: lassoEl
  };
});

window.addEventListener('mousemove', e => {
  if (isPanning) {
    state.panX = e.clientX - panStart.x;
    state.panY = e.clientY - panStart.y;
    applyTransform();
    return;
  }
  if (!dragState) return;

  const mmPerPx = 1 / (state.zoom * MM);
  const dxMm = (e.clientX - dragState.startClientX) * mmPerPx;
  const dyMm = (e.clientY - dragState.startClientY) * mmPerPx;

  if (dragState.type === 'move') {
    dragState.items.forEach(entry => {
      const item = state.items.find(it => it.id === entry.id);
      if (!item) return;
      item.x = clamp(entry.startX + dxMm, 0, state.page.w - item.w);
      item.y = clamp(entry.startY + dyMm, 0, state.page.h - item.h);
    });
    renderCanvas();
    drawSnapGuides(dragState.anchorItem);
  }

  else if (dragState.type === 'resize') {
    const item = dragState.item;
    let newW = dragState.startW;
    let newH = dragState.startH;
    const dir = dragState.dir;

    if (dir.includes('r')) newW = Math.max(5, dragState.startW + dxMm);
    if (dir.includes('l')) newW = Math.max(5, dragState.startW - dxMm);
    if (dir.includes('b')) newH = Math.max(5, dragState.startH + dyMm);
    if (dir.includes('t')) newH = Math.max(5, dragState.startH - dyMm);

    // Lock aspect ratio
    if (newW / newH > dragState.aspect) newH = newW / dragState.aspect;
    else                               newW = newH * dragState.aspect;

    item.w = newW; item.h = newH;
    if (dir.includes('l')) item.x = clamp(dragState.startX + (dragState.startW - newW), 0, state.page.w - item.w);
    if (dir.includes('t')) item.y = clamp(dragState.startY + (dragState.startH - newH), 0, state.page.h - item.h);

    renderCanvas();
  }

  else if (dragState.type === 'lasso') {
    const rect = canvasScaler.getBoundingClientRect();
    const curWX = (e.clientX - rect.left) / state.zoom / MM;
    const curWY = (e.clientY - rect.top)  / state.zoom / MM;
    const lx = Math.min(dragState.startWX, curWX);
    const ly = Math.min(dragState.startWY, curWY);
    const lw = Math.abs(curWX - dragState.startWX);
    const lh = Math.abs(curWY - dragState.startWY);
    dragState.el.style.left   = lx * MM + 'px';
    dragState.el.style.top    = ly * MM + 'px';
    dragState.el.style.width  = lw * MM + 'px';
    dragState.el.style.height = lh * MM + 'px';
    // Live selection
    state.selected = state.items.filter(it =>
      it.x >= lx && it.y >= ly &&
      it.x + it.w <= lx + lw &&
      it.y + it.h <= ly + lh
    ).map(it => it.id);
  }
});

window.addEventListener('mouseup', e => {
  if (isPanning) {
    isPanning = false;
    canvasWrap.style.cursor = isSpacePanning ? 'grab' : '';
  }
  // Clear any lasso boxes in the DOM
  QA('.lasso-box').forEach(el => el.remove());

  if (!dragState) return;
  if (dragState.type === 'lasso') {
    renderCanvas();
  }
  guidesLayer.innerHTML = '';
  if (dragState.type === 'move' || dragState.type === 'resize') snap();
  dragState = null;
});

window.addEventListener('blur', () => {
  if (isPanning) {
    isPanning = false;
    canvasWrap.style.cursor = isSpacePanning ? 'grab' : '';
  }
  // Clear any lasso boxes in the DOM
  QA('.lasso-box').forEach(el => el.remove());

  if (dragState) {
    if (dragState.type === 'lasso') {
      renderCanvas();
    }
    guidesLayer.innerHTML = '';
    dragState = null;
  }
});

// Keyboard shortcuts
window.addEventListener('keydown', e => {
  const inInput = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);
  if (inInput) return;

  // Delete selected items
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected.length) {
    e.preventDefault();
    deleteSelectedItems();
    return;
  }

  // Ctrl+D duplicate
  if (e.ctrlKey && e.key === 'd' && state.selected.length) {
    e.preventDefault();
    duplicateSelected();
    return;
  }

  // Ctrl+A select all
  if (e.ctrlKey && e.key === 'a') {
    e.preventDefault();
    state.selected = state.items.map(it => it.id);
    renderCanvas();
    return;
  }

  // Escape — deselect
  if (e.key === 'Escape') {
    state.selected = [];
    renderCanvas();
    return;
  }

  // Arrow nudge
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key) && state.selected.length) {
    e.preventDefault();
    const nudge = e.shiftKey ? 5 : 0.5;
    const dx = e.key === 'ArrowLeft' ? -nudge : e.key === 'ArrowRight' ? nudge : 0;
    const dy = e.key === 'ArrowUp'   ? -nudge : e.key === 'ArrowDown'  ? nudge : 0;
    state.selected.forEach(id => {
      const it = state.items.find(i => i.id === id);
      if (!it) return;
      it.x = clamp(it.x + dx, 0, state.page.w - it.w);
      it.y = clamp(it.y + dy, 0, state.page.h - it.h);
    });
    renderCanvas(); snap();
  }
});

// Context menu
page.addEventListener('contextmenu', e => {
  const itemEl = e.target.closest('.photo-item');
  if (!itemEl) return;
  e.preventDefault();
  const item = state.items.find(it => it.id === itemEl.dataset.id);
  if (!item) return;
  if (!state.selected.includes(item.id)) { state.selected = [item.id]; renderCanvas(); }
  ctxMenu.dataset.targetId = item.id;
  ctxMenu.style.display = 'block';
  ctxMenu.style.left = e.clientX + 'px';
  ctxMenu.style.top  = e.clientY + 'px';
});

document.addEventListener('click', hideCtxMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtxMenu(); });
function hideCtxMenu() { ctxMenu.style.display = 'none'; }

ctxDelete.addEventListener('click', () => { hideCtxMenu(); deleteSelectedItems(); });
ctxDuplicate.addEventListener('click', () => { hideCtxMenu(); duplicateSelected(); });

btnDeleteItem.addEventListener('click', deleteSelectedItems);

function deleteSelectedItems() {
  state.items    = state.items.filter(it => !state.selected.includes(it.id));
  state.selected = [];
  reflowItems();
  renderCanvas();
  renderCopiesList();
  snap();
}

function duplicateSelected() {
  const copies = [];
  state.selected.forEach(id => {
    const it = state.items.find(i => i.id === id);
    if (!it) return;
    const copy = { ...it, id: uid(), x: Math.min(state.page.w - it.w, it.x + 5), y: Math.min(state.page.h - it.h, it.y + 5) };
    state.items.push(copy);
    copies.push(copy.id);
  });
  state.selected = copies;
  renderCanvas(); snap();
}


// ─── SNAP GUIDES ─────────────────────────────────────────────────────────────
function drawSnapGuides(anchorItem) {
  guidesLayer.innerHTML = '';
  if (!anchorItem) return;
  const { x, y, w, h } = anchorItem;
  const midX = x + w / 2, midY = y + h / 2;
  const cx = state.page.w / 2, cy = state.page.h / 2;
  const T = SNAP_PX / (state.zoom * MM);

  if (Math.abs(midX - cx) < T) addGuide('v', cx);
  if (Math.abs(midY - cy) < T) addGuide('h', cy);
  if (Math.abs(x - state.page.margins.l) < T) addGuide('v', state.page.margins.l);
  if (Math.abs(y - state.page.margins.t) < T) addGuide('h', state.page.margins.t);
}

function addGuide(type, posMm) {
  const el = document.createElement('div');
  el.className = 'guide-line ' + type;
  if (type === 'v') el.style.left = posMm * MM + 'px';
  else              el.style.top  = posMm * MM + 'px';
  guidesLayer.appendChild(el);
}


// ─── EXPORT ENGINE ────────────────────────────────────────────────────────────
async function generateExportCanvas() {
  const dpi = parseInt(Q('input[name="dpi"]:checked')?.value) || 300;
  const pxPerMm = dpi / 25.4;

  const W = Math.round(state.page.w * pxPerMm);
  const H = Math.round(state.page.h * pxPerMm);

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = state.page.bg;
  ctx.fillRect(0, 0, W, H);

  // Pre-load all unique photo images
  const imgCache = new Map();
  for (const photo of state.photos) {
    if (!imgCache.has(photo.id)) {
      try { imgCache.set(photo.id, await loadImage(photo.src)); }
      catch { /* skip broken */ }
    }
  }

  // Draw each item
  for (const item of state.items) {
    const img = imgCache.get(item.photoId);
    if (!img) continue;

    const px = item.x * pxPerMm;
    const py = item.y * pxPerMm;
    const pw = item.w * pxPerMm;
    const ph = item.h * pxPerMm;

    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();

    // Apply brightness, contrast, saturation filters for export rendering
    const b = item.brightness ?? state.filters.brightness ?? 100;
    const c = item.contrast ?? state.filters.contrast ?? 100;
    const s = item.saturation ?? state.filters.saturation ?? 100;
    if (b !== 100 || c !== 100 || s !== 100) {
      ctx.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
    } else {
      ctx.filter = 'none';
    }

    ctx.drawImage(img, px, py, pw, ph);
    ctx.filter = 'none';
    ctx.restore();

    // Draw border on top (outside clip)
    if (state.border.enabled) {
      const bw = state.border.width * pxPerMm;
      ctx.save();
      ctx.strokeStyle = state.border.color;
      ctx.lineWidth = bw * 2; // strokeRect centers on edge; double so half shows inside
      ctx.beginPath();
      ctx.rect(px, py, pw, ph);
      ctx.clip(); // clip to item bounds so stroke stays inside
      ctx.strokeRect(px, py, pw, ph);
      ctx.restore();
    }
  }

  return canvas;
}

btnPng.addEventListener('click', async () => {
  if (!state.items.length) { toast('No photos on canvas to export.', 'error'); return; }
  btnPng.textContent = '…';
  try {
    const c = await generateExportCanvas();
    download(c.toDataURL('image/png'), exportFilename.value + '.png');
    toast('PNG downloaded!', 'success');
  } catch(e) { toast('Export failed: ' + e.message, 'error'); }
  btnPng.textContent = 'PNG';
});

btnJpg.addEventListener('click', async () => {
  if (!state.items.length) { toast('No photos on canvas to export.', 'error'); return; }
  btnJpg.textContent = '…';
  try {
    const c = await generateExportCanvas();
    download(c.toDataURL('image/jpeg', 0.95), exportFilename.value + '.jpg');
    toast('JPG downloaded!', 'success');
  } catch(e) { toast('Export failed: ' + e.message, 'error'); }
  btnJpg.textContent = 'JPG';
});

btnPdf.addEventListener('click', async () => {
  if (!state.items.length) { toast('No photos on canvas to export.', 'error'); return; }
  if (!window.jspdf) { toast('jsPDF not loaded.', 'error'); return; }
  btnPdf.textContent = '…';
  try {
    const c   = await generateExportCanvas();
    const img = c.toDataURL('image/jpeg', 0.95);
    const { jsPDF } = window.jspdf;
    const orient = state.page.w > state.page.h ? 'l' : 'p';
    const pdf = new jsPDF(orient, 'mm', [state.page.w, state.page.h]);
    pdf.addImage(img, 'JPEG', 0, 0, state.page.w, state.page.h);
    pdf.save(exportFilename.value + '.pdf');
    toast('PDF downloaded!', 'success');
  } catch(e) { toast('PDF failed: ' + e.message, 'error'); }
  btnPdf.textContent = 'PDF';
});

btnPrint.addEventListener('click', async () => {
  if (!state.items.length) { toast('No photos on canvas to print.', 'error'); return; }
  btnPrint.textContent = 'Preparing…';
  try {
    const c   = await generateExportCanvas();
    const src = c.toDataURL('image/png');
    let sheet = $('print-sheet');
    if (!sheet) { sheet = document.createElement('div'); sheet.id = 'print-sheet'; document.body.appendChild(sheet); }
    sheet.innerHTML = `<img src="${src}" style="width:${state.page.w}mm;height:${state.page.h}mm;display:block;" alt="Print layout">`;
    setTimeout(() => window.print(), 200);
  } catch(e) { toast('Print failed: ' + e.message, 'error'); }
  btnPrint.textContent = 'Print Layout Sheet';
});

function download(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = filename; a.click();
}

// DPI change → update status
QA('input[name="dpi"]').forEach(r => r.addEventListener('change', () => updateStatusBar()));


// ─── SYNC CONTROLS (after undo/redo) ─────────────────────────────────────────
function syncControls() {
  // Page
  const pp = Object.keys(PAGE).find(k => PAGE[k].w === state.page.w && PAGE[k].h === state.page.h);
  pagePreset.value = pp || 'custom';
  customPageDims.style.display = pp ? 'none' : 'block';
  updatePageInputs();
  pageBgPicker.value = state.page.bg;
  pageBgText.textContent = state.page.bg;
  marginT.value = state.page.margins.t;
  marginR.value = state.page.margins.r;
  marginB.value = state.page.margins.b;
  marginL.value = state.page.margins.l;
  btnPortrait.classList.toggle('active', state.page.portrait);
  btnLandscape.classList.toggle('active', !state.page.portrait);

  // Photo
  const phPresets = { '35x45': true, '2x2': true, '40x60': true, 'aadhaar': true, 'pan': true, 'driving': true, '50x50': true };
  const pp2 = Object.keys(PHOTO).find(k => PHOTO[k].w === state.photoSize.w && PHOTO[k].h === state.photoSize.h);
  photoPreset.value = pp2 || 'custom';
  customPhotoDims.style.display = pp2 ? 'none' : 'block';
  photoWInput.value = state.photoSize.w;
  photoHInput.value = state.photoSize.h;

  // BG color
  bgColorPicker.value = state.bgColor;
  bgColorHex.value    = state.bgColor;
  QA('.color-swatch[data-color]').forEach(sw => sw.classList.toggle('active', sw.dataset.color === state.bgColor));

  // Border
  borderEnabled.checked = state.border.enabled;
  borderControls.style.display = state.border.enabled ? 'block' : 'none';
  borderWidthSlider.value = state.border.width;
  borderWidthVal.textContent = state.border.width;
  borderColorPicker.value = state.border.color;
  borderColorText.textContent = state.border.color;
  QA('[data-border-color]').forEach(sw => sw.classList.toggle('active', sw.dataset.borderColor === state.border.color));

  // Spacing
  spacingH.value = state.spacing.h; spacingHVal.textContent = state.spacing.h;
  spacingV.value = state.spacing.v; spacingVVal.textContent = state.spacing.v;

  // Mode
  btnModeAuto.classList.toggle('active', state.mode === 'auto');
  btnModeFree.classList.toggle('active', state.mode === 'free');
  autoControls.style.display = state.mode === 'auto' ? 'block' : 'none';
}


// ─── AUTH SYSTEM ──────────────────────────────────────────────────────────────

// Simulated Google accounts for local dev
const MOCK_GOOGLE_ACCOUNTS = [
  { name: 'Test User', email: 'testuser@gmail.com' },
  { name: 'Demo Dev',  email: 'demo.dev@gmail.com' }
];

// Helper: show/hide element
function authShow(el) { if (el) el.style.display = ''; }
function authHide(el) { if (el) el.style.display = 'none'; }

// Toggle password visibility
function setupEyeBtn(eyeBtnId, inputId) {
  const btn = $(eyeBtnId), inp = $(inputId);
  if (!btn || !inp) return;
  btn.addEventListener('click', () => {
    const isPass = inp.type === 'password';
    inp.type = isPass ? 'text' : 'password';
    btn.textContent = isPass ? '🙈' : '👁';
  });
}
setupEyeBtn('login-eye-btn', 'login-password');
setupEyeBtn('signup-eye-btn', 'signup-password');
setupEyeBtn('reset-eye-btn', 'reset-password');
setupEyeBtn('chpwd-eye-btn', 'chpwd-new');

function showAuthView(viewId) {}
function closeAuthModal() {}
function openAuthModal() {}

// Navigation between views
$('btn-go-signup') && $('btn-go-signup').addEventListener('click', () => showAuthView('auth-view-signup'));
$('btn-go-forgot') && $('btn-go-forgot').addEventListener('click', () => showAuthView('auth-view-forgot'));
$('btn-go-login-from-signup') && $('btn-go-login-from-signup').addEventListener('click', () => showAuthView('auth-view-login'));
$('btn-go-login-from-forgot') && $('btn-go-login-from-forgot').addEventListener('click', () => showAuthView('auth-view-login'));
$('btn-auth-close') && $('btn-auth-close').addEventListener('click', closeAuthModal);
$('btn-continue-guest') && $('btn-continue-guest').addEventListener('click', closeAuthModal);
$('auth-overlay') && $('auth-overlay').addEventListener('click', (e) => {
  if (e.target === $('auth-overlay')) closeAuthModal();
});

// ─── Auth helpers: show inline errors/success ─────────────────────────────
function setAuthMsg(el, type, msg) {
  if (!el) return;
  el.textContent = msg;
  el.className = type === 'error' ? 'auth-error' : 'auth-success';
  authShow(el);
}
function clearAuthMsg(el) { if (el) { el.textContent = ''; authHide(el); } }

// ─── Login form ────────────────────────────────────────────────────────────
$('login-form') && $('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-login-submit');
  const errEl = $('login-error');
  clearAuthMsg(errEl);
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  if (!email || !password) { setAuthMsg(errEl, 'error', 'Please fill in all fields.'); return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.errors?.[0]?.title || 'Login failed.';
      setAuthMsg(errEl, 'error', msg);
      if (data.verifyLink) {
        setAuthMsg(errEl, 'error', msg + '\n\nVerification link (dev): ' + data.verifyLink);
      }
    } else {
      state.user = data.user;
      updateUserUI();
      closeAuthModal();
      toast(`Welcome back, ${data.user.name}! 👋`, 'success');
    }
  } catch(err) {
    setAuthMsg(errEl, 'error', 'Network error. Is the server running?');
  }
  btn.disabled = false; btn.textContent = 'Sign In';
});

// ─── Signup form ───────────────────────────────────────────────────────────
$('signup-form') && $('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-signup-submit');
  const errEl = $('signup-error');
  const sucEl = $('signup-success');
  clearAuthMsg(errEl); clearAuthMsg(sucEl);
  const name = $('signup-name').value.trim();
  const email = $('signup-email').value.trim();
  const password = $('signup-password').value;
  if (!name || !email || !password) { setAuthMsg(errEl, 'error', 'All fields are required.'); return; }
  if (password.length < 6) { setAuthMsg(errEl, 'error', 'Password must be at least 6 characters.'); return; }
  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) {
      setAuthMsg(errEl, 'error', data.errors?.[0]?.title || 'Signup failed.');
    } else {
      let msg = '✅ Account created! Check server console for verification link.';
      if (data.verifyLink) msg += `\n\nVerify: ${data.verifyLink}`;
      setAuthMsg(sucEl, 'success', msg);
      $('signup-form').reset();
    }
  } catch(err) {
    setAuthMsg(errEl, 'error', 'Network error. Is the server running?');
  }
  btn.disabled = false; btn.textContent = 'Create Account';
});

// ─── Forgot password form ──────────────────────────────────────────────────
$('forgot-form') && $('forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-forgot-submit');
  const errEl = $('forgot-error');
  const sucEl = $('forgot-success');
  clearAuthMsg(errEl); clearAuthMsg(sucEl);
  const email = $('forgot-email').value.trim();
  if (!email) { setAuthMsg(errEl, 'error', 'Email is required.'); return; }
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) {
      setAuthMsg(errEl, 'error', data.errors?.[0]?.title || 'Failed.');
    } else {
      let msg = '✅ ' + data.message;
      if (data.resetLink) msg += `\n\nDev link: ${data.resetLink}`;
      setAuthMsg(sucEl, 'success', msg);
    }
  } catch(err) {
    setAuthMsg(errEl, 'error', 'Network error.');
  }
  btn.disabled = false; btn.textContent = 'Send Reset Link';
});

// ─── Reset password form ───────────────────────────────────────────────────
$('reset-form') && $('reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-reset-submit');
  const errEl = $('reset-error');
  const sucEl = $('reset-success');
  clearAuthMsg(errEl); clearAuthMsg(sucEl);
  const token = $('reset-token-input').value.trim();
  const password = $('reset-password').value;
  if (!token) { setAuthMsg(errEl, 'error', 'Invalid or missing reset token.'); return; }
  if (password.length < 6) { setAuthMsg(errEl, 'error', 'Password must be at least 6 characters.'); return; }
  btn.disabled = true; btn.textContent = 'Updating…';
  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) {
      setAuthMsg(errEl, 'error', data.errors?.[0]?.title || 'Reset failed.');
    } else {
      setAuthMsg(sucEl, 'success', '✅ Password updated! You can now sign in.');
      setTimeout(() => showAuthView('auth-view-login'), 2000);
    }
  } catch(err) {
    setAuthMsg(errEl, 'error', 'Network error.');
  }
  btn.disabled = false; btn.textContent = 'Update Password';
});

// ─── Google Login (Simulated) ──────────────────────────────────────────────
function openGooglePopup(callback) {
  const popup = $('google-popup');
  const accountsEl = $('google-accounts');
  accountsEl.innerHTML = '';
  MOCK_GOOGLE_ACCOUNTS.forEach(acc => {
    const item = document.createElement('div');
    item.className = 'google-account-item';
    item.innerHTML = `
      <div class="google-account-avatar">${acc.name.charAt(0).toUpperCase()}</div>
      <div class="google-account-info">
        <span class="google-account-name">${acc.name}</span>
        <span class="google-account-email">${acc.email}</span>
      </div>`;
    item.addEventListener('click', () => { authHide(popup); callback(acc); });
    accountsEl.appendChild(item);
  });
  $('google-custom-name').value = '';
  $('google-custom-email').value = '';
  authShow(popup);
}
function closeGooglePopup() { authHide($('google-popup')); }
$('btn-google-cancel') && $('btn-google-cancel').addEventListener('click', closeGooglePopup);
$('btn-google-custom') && $('btn-google-custom').addEventListener('click', () => {
  const name = $('google-custom-name').value.trim() || 'Google User';
  const email = $('google-custom-email').value.trim();
  if (!email) { toast('Please enter an email for the custom account.', 'error'); return; }
  closeGooglePopup();
  doGoogleLogin({ name, email });
});

async function doGoogleLogin(account) {
  try {
    const res = await fetch('/api/auth/google-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: account.name, email: account.email, googleId: 'mock-' + account.email }),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.errors?.[0]?.title || 'Google login failed.', 'error');
    } else {
      state.user = data.user;
      updateUserUI();
      closeAuthModal();
      toast(`Signed in as ${account.name} via Google 🎉`, 'success');
    }
  } catch(err) {
    toast('Network error during Google login.', 'error');
  }
}

$('btn-google-login') && $('btn-google-login').addEventListener('click', () => openGooglePopup(doGoogleLogin));
$('btn-google-signup') && $('btn-google-signup').addEventListener('click', () => openGooglePopup(doGoogleLogin));

// ─── User Avatar Button ────────────────────────────────────────────────────
$('btn-user-account') && $('btn-user-account').addEventListener('click', () => {
  if (state.user) {
    openSettingsModal();
  } else {
    openAuthModal();
  }
});

// ─── Update UI based on auth state ────────────────────────────────────────
function updateUserUI() {
  const avatarIcon = $('user-avatar-display');
  if (!avatarIcon) return;
  if (state.user) {
    const isPro = state.user.plan === 'Pro';
    avatarIcon.className = 'user-avatar-icon logged-in' + (isPro ? ' pro-user' : '');
    const initial = (state.user.name || state.user.email || '?').charAt(0).toUpperCase();
    avatarIcon.textContent = initial;
    avatarIcon.title = `${state.user.name} (${state.user.plan})`;
  } else {
    avatarIcon.className = 'user-avatar-icon';
    avatarIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
    avatarIcon.title = 'Sign In';
  }
}

async function checkSession() {
  state.user = null;
  updateUserUI();
}
checkSession();

// Check for reset-password hash on load
(function checkResetTokenInUrl() {
  const hash = window.location.hash;
  if (hash.startsWith('#reset-password?token=')) {
    const token = hash.replace('#reset-password?token=', '').split('&')[0];
    if (token) {
      const input = $('reset-token-input');
      if (input) input.value = token;
      showAuthView('auth-view-reset');
      history.replaceState(null, '', '/');
    }
  }
  // Check for payment return
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get('payment_status') === 'success') {
    const orderId = searchParams.get('order_id');
    if (orderId) handlePaymentReturn(orderId);
    history.replaceState(null, '', '/');
  }
})();

// ─── Logout ───────────────────────────────────────────────────────────────
async function doLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch(e) {}
  state.user = null;
  updateUserUI();
  closeSettingsModal();
  toast('Signed out.', 'success');
}
$('btn-settings-logout') && $('btn-settings-logout').addEventListener('click', doLogout);

// ─── Account Settings Modal ────────────────────────────────────────────────
function openSettingsModal() {
  if (!state.user) return;
  $('settings-display-name').textContent = state.user.name || 'User';
  $('settings-display-email').textContent = state.user.email || '';
  const badge = $('settings-plan-badge');
  if (badge) {
    badge.textContent = state.user.plan || 'Free';
    badge.className = 'plan-badge' + (state.user.plan === 'Pro' ? ' pro' : '');
  }
  $('profile-name').value = state.user.name || '';
  $('profile-email').value = state.user.email || '';
  // Security tab: show/hide Google notice
  const googleNotice = $('security-google-notice');
  const emailSection = $('security-email-section');
  if (state.user.provider === 'google') {
    authShow(googleNotice); authHide(emailSection);
  } else {
    authHide(googleNotice); authShow(emailSection);
  }
  // Settings tabs: reset to profile
  switchSettingsTab('profile');
  // Reset delete confirm
  authHide($('delete-confirm'));
  clearAuthMsg($('profile-error')); clearAuthMsg($('profile-success'));
  clearAuthMsg($('chpwd-error')); clearAuthMsg($('chpwd-success'));
  clearAuthMsg($('delete-error'));
  authShow($('settings-overlay'));
  loadSubscriptionStatus();
}
function closeSettingsModal() { authHide($('settings-overlay')); }
$('btn-settings-close') && $('btn-settings-close').addEventListener('click', closeSettingsModal);
$('settings-overlay') && $('settings-overlay').addEventListener('click', (e) => {
  if (e.target === $('settings-overlay')) closeSettingsModal();
});

// Settings tab switching
function switchSettingsTab(tabName) {
  QA('.settings-tab').forEach(t => t.classList.toggle('active', t.dataset.stab === tabName));
  QA('.settings-panel').forEach(p => {
    if (p.id === 'stab-' + tabName) {
      p.classList.add('active');
      p.style.display = 'block';
    } else {
      p.classList.remove('active');
      p.style.display = 'none';
    }
  });
}
QA('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => switchSettingsTab(tab.dataset.stab));
});

// ─── Profile Update ────────────────────────────────────────────────────────
$('profile-form') && $('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-profile-save');
  const errEl = $('profile-error');
  const sucEl = $('profile-success');
  clearAuthMsg(errEl); clearAuthMsg(sucEl);
  const name = $('profile-name').value.trim();
  const email = $('profile-email').value.trim();
  if (!name || !email) { setAuthMsg(errEl, 'error', 'Name and email are required.'); return; }
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch('/api/auth/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) {
      setAuthMsg(errEl, 'error', data.errors?.[0]?.title || 'Update failed.');
    } else {
      setAuthMsg(sucEl, 'success', '✅ Profile updated!');
      state.user.name = name; state.user.email = email;
      updateUserUI();
      $('settings-display-name').textContent = name;
      $('settings-display-email').textContent = email;
    }
  } catch(err) {
    setAuthMsg(errEl, 'error', 'Network error.');
  }
  btn.disabled = false; btn.textContent = 'Save Changes';
});

// ─── Change Password ───────────────────────────────────────────────────────
$('change-password-form') && $('change-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-chpwd-submit');
  const errEl = $('chpwd-error');
  const sucEl = $('chpwd-success');
  clearAuthMsg(errEl); clearAuthMsg(sucEl);
  const current_password = $('chpwd-current').value;
  const new_password = $('chpwd-new').value;
  if (!current_password || !new_password) { setAuthMsg(errEl, 'error', 'Both fields required.'); return; }
  if (new_password.length < 6) { setAuthMsg(errEl, 'error', 'New password must be 6+ characters.'); return; }
  btn.disabled = true; btn.textContent = 'Updating…';
  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password, new_password }),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) {
      setAuthMsg(errEl, 'error', data.errors?.[0]?.title || 'Failed to change password.');
    } else {
      setAuthMsg(sucEl, 'success', '✅ Password updated!');
      $('change-password-form').reset();
    }
  } catch(err) {
    setAuthMsg(errEl, 'error', 'Network error.');
  }
  btn.disabled = false; btn.textContent = 'Update Password';
});

// ─── Delete Account ────────────────────────────────────────────────────────
$('btn-show-delete') && $('btn-show-delete').addEventListener('click', () => {
  authShow($('delete-confirm'));
  $('btn-show-delete').style.display = 'none';
});
$('btn-delete-cancel') && $('btn-delete-cancel').addEventListener('click', () => {
  authHide($('delete-confirm'));
  $('btn-show-delete').style.display = '';
  clearAuthMsg($('delete-error'));
});
$('btn-delete-confirm') && $('btn-delete-confirm').addEventListener('click', async () => {
  const btn = $('btn-delete-confirm');
  const errEl = $('delete-error');
  clearAuthMsg(errEl);
  const password = $('delete-password').value;
  btn.disabled = true; btn.textContent = 'Deleting…';
  try {
    const body = { password };
    const res = await fetch('/api/auth/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) {
      setAuthMsg(errEl, 'error', data.errors?.[0]?.title || 'Deletion failed.');
    } else {
      state.user = null;
      updateUserUI();
      closeSettingsModal();
      toast('Account deleted. Goodbye! 👋', 'success');
    }
  } catch(err) {
    setAuthMsg(errEl, 'error', 'Network error.');
  }
  btn.disabled = false; btn.textContent = 'Delete My Account';
});

// ─── Subscription & Payment ────────────────────────────────────────────────
async function loadSubscriptionStatus() {
  if (!state.user) return;
  try {
    const res = await fetch('/api/auth/subscription-status', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    renderSubscriptionUI(data);
  } catch(e) {}
}

function renderSubscriptionUI(data) {
  const plan = data.plan || 'Free';
  const planType = data.plan_type;
  const trialExpires = data.trial_expires_at;
  const planExpires = data.plan_expires_at;
  const orders = data.orders || [];

  // Update sub-plan-badge
  const badge = $('sub-plan-badge');
  if (badge) {
    badge.textContent = plan;
    badge.className = 'plan-badge' + (plan === 'Pro' ? ' pro' : '') + (planType === 'trial' ? ' trial' : '');
  }

  // Expires row
  const expiresRow = $('plan-expires-row');
  const expiresVal = $('sub-plan-expires');
  if (plan === 'Pro' && planExpires) {
    authShow(expiresRow);
    const d = new Date(planExpires * 1000);
    if (expiresVal) expiresVal.textContent = d.toLocaleDateString('en-IN', { year:'numeric', month:'short', day:'numeric' });
  } else {
    authHide(expiresRow);
  }

  // Trial banner: show only for Free users who haven't used trial
  const trialBanner = $('trial-banner');
  if (plan === 'Free' && !data.trial_started_at) {
    authShow(trialBanner);
  } else {
    authHide(trialBanner);
  }

  // Mark active plan on pricing cards
  QA('.pricing-card').forEach(card => {
    const isActive = plan === 'Pro' && card.dataset.plan === planType;
    card.classList.toggle('active-plan', isActive);
  });

  // Payment history
  const histEl = $('payment-history');
  const histList = $('payment-history-list');
  if (orders.length > 0 && histEl && histList) {
    authShow(histEl);
    histList.innerHTML = orders.map(o => {
      const d = new Date((o.paid_at || o.created_at) * 1000);
      const statusClass = o.status === 'PAID' ? 'paid' : (o.status === 'PENDING' ? 'pending' : 'failed');
      return `<div class="payment-history-item">
        <div class="pay-info">
          <span class="pay-plan">${o.plan_type}</span>
          <span class="pay-amount">₹${o.amount}</span>
        </div>
        <div class="pay-meta">
          <span class="pay-status ${statusClass}">${o.status}</span>
          <span class="pay-date">${d.toLocaleDateString('en-IN')}</span>
        </div>
      </div>`;
    }).join('');
  } else if (histEl) {
    authHide(histEl);
  }
}

// Start trial
$('btn-start-trial') && $('btn-start-trial').addEventListener('click', async () => {
  const btn = $('btn-start-trial');
  btn.disabled = true; btn.textContent = 'Starting…';
  try {
    const res = await fetch('/api/auth/start-trial', { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (!res.ok) {
      toast(data.errors?.[0]?.title || 'Could not start trial.', 'error');
    } else {
      state.user.plan = 'Pro';
      updateUserUI();
      toast(data.message || '🎉 7-day Pro trial started!', 'success');
      await loadSubscriptionStatus();
    }
  } catch(e) {
    toast('Network error.', 'error');
  }
  btn.disabled = false; btn.textContent = 'Try Free';
});

// Subscribe buttons → Cashfree checkout
QA('.btn-subscribe').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!state.user) {
      toast('Please sign in to subscribe.', 'info');
      openAuthModal();
      return;
    }
    const planType = btn.dataset.plan;
    await initiatePayment(planType);
  });
});

async function initiatePayment(planType) {
  const overlay = $('checkout-overlay');
  authShow(overlay);
  try {
    const res = await fetch('/api/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_type: planType }),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) {
      authHide(overlay);
      const msg = data.errors?.[0]?.title || 'Payment initiation failed.';
      toast(msg, 'error');
      return;
    }
    // Try Cashfree JS SDK
    if (window.Cashfree && data.payment_session_id) {
      const cashfree = window.Cashfree({ mode: data.cf_env === 'production' ? 'production' : 'sandbox' });
      authHide(overlay);
      cashfree.checkout({
        paymentSessionId: data.payment_session_id,
        returnUrl: window.location.origin + '/?payment_status=success&order_id=' + data.order_id
      });
    } else {
      // Fallback: server not configured with Cashfree keys
      authHide(overlay);
      toast('💡 Payment gateway not configured. Set CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET on the server.', 'info');
    }
  } catch(err) {
    authHide(overlay);
    toast('Network error during payment.', 'error');
  }
}

async function handlePaymentReturn(orderId) {
  toast('Verifying payment…', 'info');
  try {
    const res = await fetch('/api/payment/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
      credentials: 'include'
    });
    const data = await res.json();
    if (data.status === 'PAID') {
      state.user = state.user || {};
      state.user.plan = data.plan || 'Pro';
      updateUserUI();
      toast(data.message || '🎉 Payment successful! Pro plan activated.', 'success');
      await loadSubscriptionStatus();
    } else {
      toast(data.message || 'Payment is being processed.', 'info');
    }
  } catch(e) {
    toast('Could not verify payment.', 'error');
  }
}

// Session timeout: poll every 5 minutes to keep session alive / detect expiry
let sessionPollInterval = setInterval(async () => {
  if (!state.user) return;
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) {
      state.user = null;
      updateUserUI();
      toast('Session expired. Please sign in again.', 'info');
      clearInterval(sessionPollInterval);
    }
  } catch(e) {}
}, 5 * 60 * 1000);

// ─── END AUTH SYSTEM ──────────────────────────────────────────────────────────

// ─── END ──────────────────────────────────────────────────────────────────────
}); // DOMContentLoaded
