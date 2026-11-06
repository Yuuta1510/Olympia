import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue, update, set } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyD8kOt_miajR8UvjeRF6v9aYy-n1q4uCEE",
  authDomain: "olympia-d2f44.firebaseapp.com",
  databaseURL: "https://olympia-d2f44-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "olympia-d2f44",
  storageBucket: "olympia-d2f44.firebasestorage.app",
  messagingSenderId: "18063059793",
  appId: "1:18063059793:web:5dad7ce59006e779988170",
  measurementId: "G-XVER3NDTXY"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getDatabase(app);

// =========================================================================
// 1. BẢO TOÀN CẤU TRÚC DOM CHO CÁC VÒNG THI KHÁC KHI CHUYỂN TAB
// =========================================================================
const mainGrid = document.querySelector('.main-content-grid');
if (mainGrid && !window.originalRound1GridHTML) {
  window.originalRound1GridHTML = mainGrid.innerHTML;
}

if (!window.hasHookedSelectTabForMain) {
  const baseSelectTab = window.selectTab;
  window.selectTab = function(btn, tabCode) {
    if (tabCode !== 'M' && window.originalRound1GridHTML) {
      const grid = document.querySelector('.main-content-grid');
      if (grid && grid.dataset.mode === 'MAIN') {
        grid.innerHTML = window.originalRound1GridHTML;
        grid.dataset.mode = 'ROUND';
      }
    }
    if (typeof baseSelectTab === 'function') {
      baseSelectTab(btn, tabCode);
    }
  };
  window.hasHookedSelectTabForMain = true;
}

// =========================================================================
// 2. CÁC HÀM TIỆN ÍCH CƠ BẢN (GIỮ NGUYÊN)
// =========================================================================
window.updateNameDB = function(index, nameStr) {
  update(ref(db, `games/players/${index}`), { name: nameStr });
};

window.updateScoreDB = function(index, scoreVal) {
  update(ref(db, `games/players/${index}`), { score: Number(scoreVal) });
};

window.compressConfigName = function(index) {
  const el = document.getElementById(`config-name-${index}`);
  if (!el) return;
  el.style.transform = 'none';
  const textWidth = el.offsetWidth;
  const containerWidth = el.parentElement.clientWidth - 10;
  if (textWidth > containerWidth && containerWidth > 0) {
    const ratio = containerWidth / textWidth;
    el.style.transform = `scaleX(${ratio})`;
  }
};

window.compressBadgeText = function(spanId) {
  const el = document.getElementById(spanId);
  if (!el) return;
  el.style.transform = 'none';
  const textWidth = el.offsetWidth;
  const containerWidth = el.parentElement.clientWidth - 20;
  if (textWidth > containerWidth && containerWidth > 0) {
    const ratio = containerWidth / textWidth;
    el.style.transform = `scaleX(${ratio})`;
  }
};

window.openConfig = function() {
  document.getElementById('configModal').style.display = 'flex';
  setTimeout(() => {
    for (let i = 1; i <= 4; i++) window.compressConfigName(i);
  }, 50);
};

window.closeConfig = function() {
  document.getElementById('configModal').style.display = 'none';
};

function sendCommand(data) {
  update(ref(db, 'games/commands'), {
    ...data,
    timestamp: Date.now()
  });
}

// =========================================================================
// 3. QUẢN LÝ NHIỀU BỘ SETUP TEXT (PRESETS) CHO LOWERTHIRD
// =========================================================================
let isIntroActive = false;
let isLowerthirdActive = false;
let activeRoundIntro = null; // Lưu vòng đang phát intro ('r1', 'r2', 'r3', 'r4' hoặc null)

let ltPresets = [
  {
    id: 1,
    name: "Bộ 1",
    texts: [
      { id: 1, content: "HỌ VÀ TÊN THÍ SINH", x: 15, y: 74, size: 2.2 },
      { id: 2, content: "Trường THPT Chuyên...", x: 15, y: 80, size: 1.5 }
    ]
  }
];
let activePresetId = 1;
let nextPresetId = 2;

let selectedTextId = null;
let nextTextId = 3;

try {
  const savedPresets = localStorage.getItem('olympia_main_lt_presets');
  if (savedPresets) {
    const parsed = JSON.parse(savedPresets);
    if (parsed && Array.isArray(parsed.presets) && parsed.presets.length > 0) {
      ltPresets = parsed.presets;
      activePresetId = parsed.activePresetId || ltPresets[0].id;
      if (!ltPresets.some(p => p.id === activePresetId)) {
        activePresetId = ltPresets[0].id;
      }
      nextPresetId = Math.max(...ltPresets.map(p => p.id)) + 1;

      let maxTxtId = 0;
      ltPresets.forEach(p => {
        if (Array.isArray(p.texts)) {
          p.texts.forEach(t => { if (t.id > maxTxtId) maxTxtId = t.id; });
        } else {
          p.texts = [];
        }
      });
      nextTextId = maxTxtId + 1;
    }
  } else {
    const oldSingle = localStorage.getItem('olympia_main_lt_texts');
    if (oldSingle) {
      const parsedOld = JSON.parse(oldSingle);
      if (Array.isArray(parsedOld) && parsedOld.length > 0) {
        ltPresets[0].texts = parsedOld;
        nextTextId = Math.max(...parsedOld.map(t => t.id)) + 1;
      }
    }
  }
} catch (e) {}

function getActivePreset() {
  let preset = ltPresets.find(p => p.id === activePresetId);
  if (!preset && ltPresets.length > 0) {
    preset = ltPresets[0];
    activePresetId = preset.id;
  }
  return preset;
}

function getActiveTexts() {
  const preset = getActivePreset();
  return preset ? preset.texts : [];
}

function saveLtConfig() {
  try {
    localStorage.setItem('olympia_main_lt_presets', JSON.stringify({
      presets: ltPresets,
      activePresetId: activePresetId
    }));
  } catch (e) {}
  update(ref(db, 'games/main_lowerthird'), {
    presets: ltPresets,
    activePresetId: activePresetId,
    texts: getActiveTexts(),
    updatedAt: Date.now()
  });
}

function renderMainWorkspace() {
  if (!mainGrid) return;
  mainGrid.dataset.mode = 'MAIN';

  const rText = document.getElementById('roundText');
  const qText = document.getElementById('quesText');
  const tText = document.getElementById('timeText');
  if (rText) rText.innerText = "MAIN CONTROL";
  if (qText) qText.innerText = "INTRO: OFF";
  if (tText) tText.innerText = "LOWERTHIRD: OFF";
  window.compressBadgeText('roundText');
  window.compressBadgeText('quesText');
  window.compressBadgeText('timeText');

  mainGrid.innerHTML = `
    <div class="qa-column">
      <div class="lt-editor-workspace">
        <!-- Khung Preview 16:9 lấy frame cuối của lowerthird.webm -->
        <div class="lt-preview-wrapper" id="ltPreviewWrapper">
          <div class="lt-canvas-16-9" id="ltCanvas">
            <video id="ltPreviewVideo" class="lt-bg-video" muted playsinline preload="auto"></video>
            <div class="lt-text-layer" id="ltTextLayer"></div>
          </div>
        </div>

        <!-- Bảng điều chỉnh Bộ Setup (Presets) & Text bên phải Preview -->
        <div class="lt-controls-panel">
          
          <!-- KHU VỰC 1: QUẢN LÝ BỘ SETUP (PRESETS) -->
          <div class="lt-section-box">
            <div class="lt-panel-header">
              <span class="lt-panel-title">1. Bộ Setup (Presets)</span>
              <div class="lt-btn-group">
                <button class="lt-small-btn" onclick="addLtPreset()" title="Tạo bộ trống mới">+ Tạo mới</button>
                <button class="lt-small-btn secondary" onclick="duplicateLtPreset()" title="Nhân bản bộ hiện tại">Nhân bản</button>
                <button class="lt-small-btn danger" onclick="removeLtPreset()" title="Xóa bộ hiện tại">Xóa bộ</button>
              </div>
            </div>

            <div class="lt-items-list" id="ltPresetsList"></div>

            <div class="lt-field-group">
              <label>Tên bộ Setup đang chọn:</label>
              <input type="text" id="ltPresetNameInput" placeholder="VD: TS 1 - Nguyễn Văn A..." oninput="updateActivePresetName(this.value)">
            </div>
          </div>

          <!-- KHU VỰC 2: QUẢN LÝ CÁC TEXT TRONG BỘ ĐANG CHỌN -->
          <div class="lt-section-box" style="flex: 1;">
            <div class="lt-panel-header">
              <span class="lt-panel-title">2. Các Text trong Bộ</span>
              <div class="lt-btn-group">
                <button class="lt-small-btn" onclick="addLtText()">+ Thêm Text</button>
                <button class="lt-small-btn danger" onclick="removeLtText()">Xóa Text</button>
              </div>
            </div>

            <div class="lt-items-list" id="ltItemsList"></div>

            <div class="lt-field-group">
              <label>Nội dung Text:</label>
              <textarea id="ltInputContent" placeholder="Chọn 1 Text để sửa..." oninput="updateSelectedLtText('content', this.value)"></textarea>
            </div>

            <div class="lt-field-group">
              <label><span>Kích cỡ chữ (Size):</span> <span id="ltSizeVal">-</span></label>
              <input type="range" id="ltInputSize" min="0.5" max="8" step="0.1" value="2.2" oninput="updateSelectedLtText('size', this.value)">
            </div>

            <div class="lt-coord-grid">
              <div class="lt-field-group">
                <label>Vị trí Ngang X (%):</label>
                <input type="number" id="ltInputX" step="0.1" min="0" max="100" oninput="updateSelectedLtText('x', this.value)">
              </div>
              <div class="lt-field-group">
                <label>Vị trí Dọc Y (%):</label>
                <input type="number" id="ltInputY" step="0.1" min="0" max="100" oninput="updateSelectedLtText('y', this.value)">
              </div>
            </div>

            <div style="font-size: 11px; color: #94a3b8; line-height: 1.35; margin-top: auto; border-top: 1px solid #1e293b; padding-top: 6px;">
              💡 Chọn <b>Bộ Setup</b> ở trên, kéo thả chữ trực tiếp trên khung hình. Click ra vùng trống để ẩn viền chọn về trong suốt.
            </div>
          </div>

        </div>
      </div>
    </div>

    <!-- Cột phải: Chạy Intro chung, Lowerthird và 4 Intro của 4 vòng thi -->
    <div class="sidebar-column">
      <button class="sidebar-action-btn" id="btnMainIntro" onclick="triggerMainIntro(this)">CHẠY INTRO</button>
      <button class="sidebar-action-btn" id="btnMainLT" onclick="triggerMainLowerthird(this)">LOWERTHIRD</button>
      <button class="sidebar-action-btn round-intro-btn" id="btnRoundIntro_r1" data-round="r1" onclick="toggleRoundIntro(this, 'r1')">INTRO VÒNG 1</button>
      <button class="sidebar-action-btn round-intro-btn" id="btnRoundIntro_r2" data-round="r2" onclick="toggleRoundIntro(this, 'r2')">INTRO VÒNG 2</button>
      <button class="sidebar-action-btn round-intro-btn" id="btnRoundIntro_r3" data-round="r3" onclick="toggleRoundIntro(this, 'r3')">INTRO VÒNG 3</button>
      <button class="sidebar-action-btn round-intro-btn" id="btnRoundIntro_r4" data-round="r4" onclick="toggleRoundIntro(this, 'r4')">INTRO VÒNG 4</button>
      <button class="sidebar-action-btn"></button>
      <button class="sidebar-action-btn" style="background-color: #cc0000;" onclick="triggerMainReset(this)">RESET ĐỒ HỌA</button>
      <button class="sidebar-action-btn"></button>
    </div>
  `;

  const previewWrapper = document.getElementById('ltPreviewWrapper');
  if (previewWrapper) {
    previewWrapper.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.lt-draggable-text')) {
        selectedTextId = null;
        renderLtEditorUI();
      }
    });
  }

  setupPreviewVideoLastFrame();
  renderLtEditorUI();
  setupCanvasDragEvents();
  syncRoundIntroButtonsUI();
}

function setupPreviewVideoLastFrame() {
  const vid = document.getElementById('ltPreviewVideo');
  if (!vid) return;

  const sources = ['Graphic/lowerthird.webm', 'lowerthird.webm', 'Graphic/Lowerthird.webm'];
  let srcIdx = 0;

  vid.src = sources[srcIdx];
  vid.onerror = () => {
    srcIdx++;
    if (srcIdx < sources.length) vid.src = sources[srcIdx];
  };

  vid.addEventListener('loadedmetadata', () => {
    if (vid.duration && isFinite(vid.duration)) {
      vid.currentTime = Math.max(0, vid.duration - 0.05);
    }
  });

  vid.addEventListener('seeked', () => {
    vid.pause();
  });
}

function renderLtEditorUI() {
  const layer = document.getElementById('ltTextLayer');
  const list = document.getElementById('ltItemsList');
  const presetsList = document.getElementById('ltPresetsList');
  const presetNameInput = document.getElementById('ltPresetNameInput');
  if (!layer || !list || !presetsList) return;

  const activePreset = getActivePreset();
  const ltTexts = activePreset ? activePreset.texts : [];

  // 1. Render danh sách các Bộ Setup (Presets)
  presetsList.innerHTML = '';
  ltPresets.forEach((preset, idx) => {
    const chip = document.createElement('button');
    chip.className = `lt-item-chip preset-chip ${preset.id === activePresetId ? 'active' : ''}`;
    chip.innerText = preset.name || `Bộ ${idx + 1}`;
    chip.onclick = () => {
      if (activePresetId !== preset.id) {
        activePresetId = preset.id;
        selectedTextId = null;
        saveLtConfig();
        renderLtEditorUI();
        if (isLowerthirdActive) {
          sendCommand({ action: 'update_lowerthird_texts', texts: getActiveTexts() });
        }
      }
    };
    presetsList.appendChild(chip);
  });

  if (presetNameInput && activePreset && document.activeElement !== presetNameInput) {
    presetNameInput.value = activePreset.name || '';
  }

  // 2. Render danh sách nút chọn Text trong Bộ hiện tại
  list.innerHTML = '';
  ltTexts.forEach((item, idx) => {
    const chip = document.createElement('button');
    chip.className = `lt-item-chip ${item.id === selectedTextId ? 'active' : ''}`;
    chip.innerText = `Text ${idx + 1}`;
    chip.onclick = () => {
      selectedTextId = (selectedTextId === item.id) ? null : item.id;
      renderLtEditorUI();
    };
    list.appendChild(chip);
  });

  // 3. Render các phần tử Text của Bộ hiện tại trên mặt Canvas 16:9
  layer.innerHTML = '';
  ltTexts.forEach((item) => {
    const el = document.createElement('div');
    el.className = `lt-draggable-text ${item.id === selectedTextId ? 'selected' : ''}`;
    el.dataset.id = item.id;
    el.style.left = `${item.x}%`;
    el.style.top = `${item.y}%`;
    el.style.fontSize = `${item.size}cqw`;
    el.textContent = item.content;

    el.addEventListener('mousedown', (e) => {
      selectedTextId = item.id;
      renderLtEditorUI();
      startDraggingText(e, item.id);
    });

    layer.appendChild(el);
  });

  // 4. Đổ thông số của Text đang chọn vào các ô Input
  const current = ltTexts.find(t => t.id === selectedTextId);
  const contentInput = document.getElementById('ltInputContent');
  const sizeInput = document.getElementById('ltInputSize');
  const sizeLabel = document.getElementById('ltSizeVal');
  const xInput = document.getElementById('ltInputX');
  const yInput = document.getElementById('ltInputY');

  if (current) {
    if (contentInput && document.activeElement !== contentInput) contentInput.value = current.content;
    if (sizeInput && document.activeElement !== sizeInput) sizeInput.value = current.size;
    if (sizeLabel) sizeLabel.innerText = `${current.size}`;
    if (xInput && document.activeElement !== xInput) xInput.value = Number(current.x).toFixed(1);
    if (yInput && document.activeElement !== yInput) yInput.value = Number(current.y).toFixed(1);
    if (contentInput) contentInput.disabled = false;
    if (sizeInput) sizeInput.disabled = false;
    if (xInput) xInput.disabled = false;
    if (yInput) yInput.disabled = false;
  } else {
    if (contentInput) { contentInput.value = ''; contentInput.disabled = true; }
    if (sizeInput) { sizeInput.disabled = true; }
    if (sizeLabel) sizeLabel.innerText = `-`;
    if (xInput) { xInput.value = ''; xInput.disabled = true; }
    if (yInput) { yInput.value = ''; yInput.disabled = true; }
  }
}

// =========================================================================
// CÁC HÀM THAO TÁC VỚI BỘ SETUP (PRESETS)
// =========================================================================
window.addLtPreset = function() {
  const newPreset = {
    id: nextPresetId++,
    name: `Bộ ${ltPresets.length + 1}`,
    texts: [
      { id: nextTextId++, content: "Nội dung dòng 1", x: 15, y: 74, size: 2.2 },
      { id: nextTextId++, content: "Nội dung dòng 2", x: 15, y: 80, size: 1.5 }
    ]
  };
  ltPresets.push(newPreset);
  activePresetId = newPreset.id;
  selectedTextId = null;
  saveLtConfig();
  renderLtEditorUI();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', texts: getActiveTexts() });
  }
};

window.duplicateLtPreset = function() {
  const current = getActivePreset();
  if (!current) return;

  const clonedTexts = current.texts.map(t => ({
    id: nextTextId++,
    content: t.content,
    x: t.x,
    y: t.y,
    size: t.size
  }));

  const newPreset = {
    id: nextPresetId++,
    name: `${current.name} (Copy)`,
    texts: clonedTexts
  };
  ltPresets.push(newPreset);
  activePresetId = newPreset.id;
  selectedTextId = null;
  saveLtConfig();
  renderLtEditorUI();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', texts: getActiveTexts() });
  }
};

window.removeLtPreset = function() {
  if (ltPresets.length <= 1) {
    alert("Cần giữ lại ít nhất 1 bộ Setup!");
    return;
  }
  ltPresets = ltPresets.filter(p => p.id !== activePresetId);
  activePresetId = ltPresets[ltPresets.length - 1].id;
  selectedTextId = null;
  saveLtConfig();
  renderLtEditorUI();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', texts: getActiveTexts() });
  }
};

window.updateActivePresetName = function(newName) {
  const current = getActivePreset();
  if (!current) return;
  current.name = newName;
  saveLtConfig();

  const presetsList = document.getElementById('ltPresetsList');
  if (presetsList) {
    const chips = presetsList.querySelectorAll('.preset-chip');
    const idx = ltPresets.findIndex(p => p.id === activePresetId);
    if (idx !== -1 && chips[idx]) {
      chips[idx].innerText = newName || `Bộ ${idx + 1}`;
    }
  }
};

// =========================================================================
// CÁC HÀM THAO TÁC KÉO THẢ & CHỈNH SỬA TEXT TRONG BỘ HIỆN TẠI
// =========================================================================
let draggingId = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

function startDraggingText(e, id) {
  e.preventDefault();
  e.stopPropagation();
  const canvas = document.getElementById('ltCanvas');
  const ltTexts = getActiveTexts();
  const item = ltTexts.find(t => t.id === id);
  if (!canvas || !item) return;

  draggingId = id;
  const rect = canvas.getBoundingClientRect();
  const mouseXPercent = ((e.clientX - rect.left) / rect.width) * 100;
  const mouseYPercent = ((e.clientY - rect.top) / rect.height) * 100;

  dragOffsetX = mouseXPercent - item.x;
  dragOffsetY = mouseYPercent - item.y;
}

function setupCanvasDragEvents() {
  window.addEventListener('mousemove', (e) => {
    if (draggingId === null) return;
    const canvas = document.getElementById('ltCanvas');
    const ltTexts = getActiveTexts();
    const item = ltTexts.find(t => t.id === draggingId);
    if (!canvas || !item) return;

    const rect = canvas.getBoundingClientRect();
    let newX = ((e.clientX - rect.left) / rect.width) * 100 - dragOffsetX;
    let newY = ((e.clientY - rect.top) / rect.height) * 100 - dragOffsetY;

    newX = Math.max(0, Math.min(98, newX));
    newY = Math.max(0, Math.min(98, newY));

    item.x = Number(newX.toFixed(2));
    item.y = Number(newY.toFixed(2));

    const activeEl = document.querySelector(`.lt-draggable-text[data-id="${draggingId}"]`);
    if (activeEl) {
      activeEl.style.left = `${item.x}%`;
      activeEl.style.top = `${item.y}%`;
    }
    const xInput = document.getElementById('ltInputX');
    const yInput = document.getElementById('ltInputY');
    if (xInput) xInput.value = item.x.toFixed(1);
    if (yInput) yInput.value = item.y.toFixed(1);
  });

  window.addEventListener('mouseup', () => {
    if (draggingId !== null) {
      draggingId = null;
      saveLtConfig();
      if (isLowerthirdActive) {
        sendCommand({ action: 'update_lowerthird_texts', texts: getActiveTexts() });
      }
    }
  });
}

window.addLtText = function() {
  const preset = getActivePreset();
  if (!preset) return;

  const newItem = {
    id: nextTextId++,
    content: `Text mới ${preset.texts.length + 1}`,
    x: 15,
    y: Math.min(88, 68 + preset.texts.length * 6),
    size: 2.0
  };
  preset.texts.push(newItem);
  selectedTextId = newItem.id;
  saveLtConfig();
  renderLtEditorUI();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', texts: getActiveTexts() });
  }
};

window.removeLtText = function() {
  if (selectedTextId === null) return;
  const preset = getActivePreset();
  if (!preset) return;

  preset.texts = preset.texts.filter(t => t.id !== selectedTextId);
  selectedTextId = null;
  saveLtConfig();
  renderLtEditorUI();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', texts: getActiveTexts() });
  }
};

window.updateSelectedLtText = function(field, val) {
  const ltTexts = getActiveTexts();
  const item = ltTexts.find(t => t.id === selectedTextId);
  if (!item) return;

  if (field === 'content') {
    item.content = val;
  } else if (field === 'size') {
    item.size = Math.max(0.2, Number(val) || 1);
    const sizeLabel = document.getElementById('ltSizeVal');
    if (sizeLabel) sizeLabel.innerText = `${item.size}`;
  } else if (field === 'x') {
    item.x = Number(val) || 0;
  } else if (field === 'y') {
    item.y = Number(val) || 0;
  }

  const activeEl = document.querySelector(`.lt-draggable-text[data-id="${selectedTextId}"]`);
  if (activeEl) {
    activeEl.textContent = item.content;
    activeEl.style.left = `${item.x}%`;
    activeEl.style.top = `${item.y}%`;
    activeEl.style.fontSize = `${item.size}cqw`;
  }

  saveLtConfig();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', texts: getActiveTexts() });
  }
};

// =========================================================================
// 4. LOGIC NÚT BẤM CHẠY INTRO CHUNG, LOWERTHIRD & 4 INTRO VÒNG THI
// =========================================================================
function flashButtonYellow(btn) {
  if (!btn) return;
  btn.classList.add('active');
  setTimeout(() => { btn.classList.remove('active'); }, 50);
}

function syncRoundIntroButtonsUI() {
  document.querySelectorAll('.round-intro-btn').forEach(b => {
    const rCode = b.getAttribute('data-round');
    if (activeRoundIntro && rCode === activeRoundIntro) {
      b.classList.add('is-running');
    } else {
      b.classList.remove('is-running');
    }
  });
}

// Chạy 4 video Intro của 4 vòng thi: intro_r1.mp4, intro_r2.mp4, intro_r3.mp4, intro_r4.mp4
window.toggleRoundIntro = function(btn, roundKey) {
  flashButtonYellow(btn);
  const fileName = `intro_${roundKey}.mp4`;

  if (activeRoundIntro === roundKey) {
    // Đang chạy đúng vòng này -> Bấm lần nữa để biến mất
    activeRoundIntro = null;
    syncRoundIntroButtonsUI();
    set(ref(db, 'games/round_intro_status'), null);
    set(ref(db, 'games/round_intro'), {
      action: 'hide',
      round: roundKey,
      file: fileName,
      timestamp: Date.now()
    });
  } else {
    // Chưa chạy hoặc đang chạy vòng khác -> Phát full màn hình video vòng mới
    activeRoundIntro = roundKey;
    syncRoundIntroButtonsUI();
    set(ref(db, 'games/round_intro_status'), roundKey);
    set(ref(db, 'games/round_intro'), {
      action: 'play',
      round: roundKey,
      file: fileName,
      timestamp: Date.now()
    });
  }
};

// Đồng bộ trạng thái 4 nút Intro Vòng thi từ Firebase
onValue(ref(db, 'games/round_intro_status'), (snapshot) => {
  const statusVal = snapshot.val();
  activeRoundIntro = (typeof statusVal === 'string' && statusVal) ? statusVal : null;
  syncRoundIntroButtonsUI();
});

window.triggerMainIntro = function(btn) {
  flashButtonYellow(btn);
  const qText = document.getElementById('quesText');

  if (!isIntroActive) {
    isIntroActive = true;
    btn.classList.add('is-running');
    btn.innerText = "ẨN INTRO";
    if (qText) qText.innerText = "INTRO: ON";
    sendCommand({ action: 'play_intro' });
  } else {
    isIntroActive = false;
    btn.classList.remove('is-running');
    btn.innerText = "CHẠY INTRO";
    if (qText) qText.innerText = "INTRO: OFF";
    sendCommand({ action: 'hide_intro' });
  }
  window.compressBadgeText('quesText');
};

window.triggerMainLowerthird = function(btn) {
  flashButtonYellow(btn);
  const tText = document.getElementById('timeText');

  if (!isLowerthirdActive) {
    isLowerthirdActive = true;
    btn.classList.add('is-running');
    btn.innerText = "ẨN LOWERTHIRD";
    if (tText) tText.innerText = "LOWERTHIRD: ON";
    sendCommand({
      action: 'play_lowerthird',
      texts: getActiveTexts()
    });
  } else {
    isLowerthirdActive = false;
    btn.classList.remove('is-running');
    btn.innerText = "LOWERTHIRD";
    if (tText) tText.innerText = "LOWERTHIRD: OFF";
    sendCommand({
      action: 'hide_lowerthird'
    });
  }
  window.compressBadgeText('timeText');
};

window.triggerMainReset = function(btn) {
  flashButtonYellow(btn);
  isIntroActive = false;
  isLowerthirdActive = false;
  activeRoundIntro = null;
  syncRoundIntroButtonsUI();

  const btnIntro = document.getElementById('btnMainIntro');
  const btnLT = document.getElementById('btnMainLT');
  const qText = document.getElementById('quesText');
  const tText = document.getElementById('timeText');

  if (btnIntro) {
    btnIntro.classList.remove('is-running');
    btnIntro.innerText = "CHẠY INTRO";
  }
  if (btnLT) {
    btnLT.classList.remove('is-running');
    btnLT.innerText = "LOWERTHIRD";
  }
  if (qText) qText.innerText = "INTRO: OFF";
  if (tText) tText.innerText = "LOWERTHIRD: OFF";
  window.compressBadgeText('quesText');
  window.compressBadgeText('timeText');

  set(ref(db, 'games/round_intro_status'), null);
  set(ref(db, 'games/round_intro'), {
    action: 'hide',
    timestamp: Date.now()
  });
  sendCommand({ action: 'reset_main_graphic' });
};

onValue(ref(db, 'games/players'), (snapshot) => {
  if (snapshot.exists()) {
    const players = snapshot.val();
    for (let i = 1; i <= 4; i++) {
      if (players[i]) {
        const spanEl = document.getElementById(`playerBtnText-${i}`);
        if (spanEl) {
          spanEl.innerText = `${players[i].name} (${players[i].score})`;
          window.compressBadgeText(`playerBtnText-${i}`);
        }
        const scoreInput = document.getElementById(`config-score-${i}`);
        const nameLabel = document.getElementById(`config-name-${i}`);
        if (scoreInput && document.activeElement !== scoreInput) scoreInput.value = players[i].score;
        if (nameLabel && document.activeElement !== nameLabel) {
          nameLabel.innerText = players[i].name;
          window.compressConfigName(i);
        }
      }
    }
  }
});

renderMainWorkspace();