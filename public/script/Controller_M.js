import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue, update, set } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

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
const storage = getStorage(app);
const uiAbortController = new AbortController();

// =========================================================================
// 1. BẢO TOÀN CẤU TRÚC DOM & HÀM GỐC CHO CÁC VÒNG THI KHÁC
// =========================================================================
const mainGrid = document.querySelector('.main-content-grid');

const previousWindowHandlers = {
  openConfig: window.openConfig,
  closeConfig: window.closeConfig,
  updateNameDB: window.updateNameDB,
  updateScoreDB: window.updateScoreDB,
  compressConfigName: window.compressConfigName,
  compressBadgeText: window.compressBadgeText
};

function isMainTabActive() {
  const activeTabBtn = document.querySelector('.header-tab-btn.active');
  if (activeTabBtn && activeTabBtn.dataset.tab) {
    return activeTabBtn.dataset.tab === 'M';
  }
  return Boolean(mainGrid && mainGrid.dataset.mode === 'MAIN');
}

function hideOtherRoundPanelsInGrid() {
  if (!mainGrid) return;
  Array.from(mainGrid.children).forEach((child) => {
    if (child.id === 'main-controller-ui') return;
    if (child.dataset.mainPrevDisplay === undefined) {
      child.dataset.mainPrevDisplay = child.style.display || '';
    }
    child.style.display = 'none';
  });
}

function restoreOtherRoundPanelsInGrid() {
  if (!mainGrid) return;
  const mainContainer = document.getElementById('main-controller-ui');
  if (mainContainer) {
    mainContainer.style.display = 'none';
  }
  Array.from(mainGrid.children).forEach((child) => {
    if (child.id === 'main-controller-ui') return;
    if (child.dataset.mainPrevDisplay !== undefined) {
      child.style.display = child.dataset.mainPrevDisplay;
      delete child.dataset.mainPrevDisplay;
    }
  });
  mainGrid.dataset.mode = 'ROUND';
}

function restoreDefaultConfigModalContent() {
  const modal = document.getElementById('configModal');
  if (!modal) return;
  const mainDialog = document.getElementById('mainConfigDialog');
  if (mainDialog) {
    mainDialog.style.display = 'none';
  }
  const roundModalContent = document.getElementById('configModalContent');
  if (roundModalContent && roundModalContent.dataset.mainPrevDisplay !== undefined) {
    roundModalContent.style.display = roundModalContent.dataset.mainPrevDisplay;
    delete roundModalContent.dataset.mainPrevDisplay;
  }
  modal.dataset.mode = 'ROUND';
}

if (!window.hasHookedSelectTabForMain) {
  const baseSelectTab = window.selectTab;
  window.selectTab = function(btn, tabCode) {
    if (tabCode !== 'M') {
      const modal = document.getElementById('configModal');
      if (modal && modal.dataset.mode === 'MAIN') {
        modal.style.display = 'none';
      }
      restoreDefaultConfigModalContent();
      restoreOtherRoundPanelsInGrid();
    }
    if (typeof baseSelectTab === 'function') {
      baseSelectTab(btn, tabCode);
    }
  };
  window.hasHookedSelectTabForMain = true;
}

// =========================================================================
// 2. CÁC HÀM TIỆN ÍCH CƠ BẢN & MODAL CẤU HÌNH MAIN (NÚT BÁNH RĂNG)
// =========================================================================
let latestPlayersData = {};
let customGameThumbnails = {};
let customGameThumbnailsMeta = {};
let initializedPlayerInfoFlags = {};
let activeStorageUploads = 0;

// Quản lý âm lượng riêng biệt 2 màn: Livestream & Projector (0 - 100)
let screenVolumes = {
  livestream: 100,
  projector: 100
};
let lastNonZeroVolumes = {
  livestream: 100,
  projector: 100
};

function clampVolumePercent(val) {
  const num = Math.round(Number(val));
  if (!Number.isFinite(num)) return 100;
  return Math.min(100, Math.max(0, num));
}

function syncScreenVolumeCardUI(screenKey, vol, skipInputElement = false) {
  const cleanVol = clampVolumePercent(vol);
  if (cleanVol > 0) {
    lastNonZeroVolumes[screenKey] = cleanVol;
  }

  const slider = document.getElementById(`mainCfgVolSlider-${screenKey}`);
  const numInput = document.getElementById(`mainCfgVolInput-${screenKey}`);
  const badge = document.getElementById(`mainCfgVolBadge-${screenKey}`);
  const muteBtn = document.getElementById(`mainCfgVolMute-${screenKey}`);

  if (slider) slider.value = cleanVol;
  if (numInput && !skipInputElement && document.activeElement !== numInput) {
    numInput.value = cleanVol;
  }
  if (badge) badge.textContent = `${cleanVol}%`;
  if (muteBtn) {
    muteBtn.textContent = cleanVol === 0 ? '🔇' : '🔊';
    muteBtn.classList.toggle('is-muted', cleanVol === 0);
  }
}

window.setScreenVolume = function(screenKey, rawVal, skipInputElement = false) {
  if (screenKey !== 'livestream' && screenKey !== 'projector') return;
  const cleanVol = clampVolumePercent(rawVal);
  screenVolumes[screenKey] = cleanVol;
  syncScreenVolumeCardUI(screenKey, cleanVol, skipInputElement);
  set(ref(db, `games/audio_volume/${screenKey}`), cleanVol);
};

window.handleScreenVolumeNumberInput = function(screenKey, rawStr) {
  if (rawStr === '' || rawStr === null || rawStr === undefined) return;
  const parsed = Number(rawStr);
  if (!Number.isFinite(parsed)) return;
  window.setScreenVolume(screenKey, parsed, true);
};

window.normalizeScreenVolumeNumberInput = function(screenKey, inputEl) {
  const cleanVol = inputEl && inputEl.value !== ''
    ? clampVolumePercent(inputEl.value)
    : screenVolumes[screenKey];
  if (inputEl) inputEl.value = cleanVol;
  window.setScreenVolume(screenKey, cleanVol, false);
};

window.toggleScreenMute = function(screenKey) {
  if (screenKey !== 'livestream' && screenKey !== 'projector') return;
  const current = clampVolumePercent(screenVolumes[screenKey]);
  const nextVol = current > 0 ? 0 : (lastNonZeroVolumes[screenKey] || 100);
  window.setScreenVolume(screenKey, nextVol, false);
};

window.updateNameDB = function(index, nameStr) {
  const cleanName = String(nameStr ?? '').trim() || `PLAYER ${index}`;
  update(ref(db, `games/players/${index}`), { name: cleanName });
};

window.updateScoreDB = function(index, scoreVal) {
  update(ref(db, `games/players/${index}`), { score: Number(scoreVal) || 0 });
};

window.updatePlayerInfoDB = function(index, infoStr) {
  update(ref(db, `games/players/${index}`), { info: String(infoStr ?? '') });
};

window.updatePlayerFullNameDB = function(index, fullNameStr) {
  update(ref(db, `games/players/${index}`), { fullName: String(fullNameStr ?? '').trim() });
};

window.adjustMainPlayerScore = function(index, delta) {
  const scoreInput = document.getElementById(`mainCfgScore-${index}`);
  const currentVal = scoreInput
    ? (Number(scoreInput.value) || 0)
    : (Number(latestPlayersData?.[index]?.score) || 0);
  const nextVal = currentVal + (Number(delta) || 0);
  if (scoreInput) scoreInput.value = nextVal;
  window.updateScoreDB(index, nextVal);
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

function applyMainDialogDprScale() {
  const dialog = document.getElementById('mainConfigDialog');
  if (!dialog) return;
  const dpr = window.devicePixelRatio || 1;
  if (dpr !== 1) {
    dialog.style.transform = `scale(${1 / dpr})`;
    dialog.style.maxWidth = `${96 * dpr}vw`;
    dialog.style.maxHeight = `${92 * dpr}vh`;
  } else {
    dialog.style.transform = '';
    dialog.style.maxWidth = '96vw';
    dialog.style.maxHeight = '92vh';
  }
}

function setPlayerAvatarPreviewFallback(imgEl, playerIndex, customUrl = '') {
  if (!imgEl) return;
  const fallbackSpan = imgEl.parentElement?.querySelector('.main-cfg-avatar-fallback');
  if (fallbackSpan) fallbackSpan.style.display = 'none';
  imgEl.style.display = 'block';

  const localSources = [
    `../graphic/main/main_player${playerIndex}.png`,
    `../graphic/main/main_player${playerIndex}.png`,
    `/graphic/main/main_player${playerIndex}.png`,
    `graphic/main/main_player${playerIndex}.png`,
    `graphic/main/main_player${playerIndex}.png`,
    `main_player${playerIndex}.png`,
    `main_player${playerIndex}.png`
  ];
  const sources = customUrl ? [customUrl, ...localSources] : localSources;

  let idx = 0;
  imgEl.src = sources[idx];
  imgEl.onerror = () => {
    idx++;
    if (idx < sources.length) {
      imgEl.src = sources[idx];
    } else {
      imgEl.onerror = null;
      imgEl.style.display = 'none';
      if (fallbackSpan) fallbackSpan.style.display = 'inline';
    }
  };
}

function setMainConfigGlobalStatus(msg, isError = false) {
  const el = document.getElementById('mainCfgGlobalStatus');
  if (!el) return;
  el.style.color = isError ? '#f87171' : '#38bdf8';
  el.innerText = msg;
}

function sanitizeStorageFileName(fileName) {
  return String(fileName || 'image.png').replace(/[^a-zA-Z0-9._-]/g, '_');
}

window.triggerPlayerAvatarFile = function(playerIndex) {
  const input = document.getElementById(`mainCfgAvatarFile-${playerIndex}`);
  if (input) input.click();
};

window.handlePlayerAvatarUpload = function(playerIndex, inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    setMainConfigGlobalStatus('Vui lòng chọn đúng định dạng tệp hình ảnh!', true);
    inputEl.value = '';
    return;
  }

  const statusEl = document.getElementById(`mainCfgAvatarStatus-${playerIndex}`);
  const uploadBtn = document.getElementById(`mainCfgAvatarBtn-${playerIndex}`);
  const previewImg = document.getElementById(`mainCfgAvatarImg-${playerIndex}`);

  const localBlobUrl = URL.createObjectURL(file);
  if (previewImg) {
    const fallbackSpan = previewImg.parentElement?.querySelector('.main-cfg-avatar-fallback');
    if (fallbackSpan) fallbackSpan.style.display = 'none';
    previewImg.onerror = null;
    previewImg.style.display = 'block';
    previewImg.src = localBlobUrl;
  }

  activeStorageUploads++;
  if (uploadBtn) uploadBtn.disabled = true;
  if (statusEl) statusEl.innerText = 'Đang tải 0%...';
  setMainConfigGlobalStatus(`Đang tải avatar Thí sinh ${playerIndex} lên Storage...`);

  const oldStoragePath = latestPlayersData?.[playerIndex]?.avatarStoragePath || '';
  const storagePath = `avatars/player_${playerIndex}_${Date.now()}_${sanitizeStorageFileName(file.name)}`;
  const fileRef = storageRef(storage, storagePath);
  const uploadTask = uploadBytesResumable(fileRef, file, { contentType: file.type });

  uploadTask.on(
    'state_changed',
    (snapshot) => {
      const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
      if (statusEl) statusEl.innerText = `Đang tải ${pct}%...`;
    },
    (error) => {
      console.error('Lỗi upload avatar:', error);
      activeStorageUploads = Math.max(0, activeStorageUploads - 1);
      URL.revokeObjectURL(localBlobUrl);
      if (uploadBtn) uploadBtn.disabled = false;
      if (statusEl) statusEl.innerText = 'Lỗi tải lên';
      setMainConfigGlobalStatus(`Lỗi tải avatar TS ${playerIndex}: ${error.message}`, true);
      if (previewImg) {
        setPlayerAvatarPreviewFallback(previewImg, playerIndex, latestPlayersData?.[playerIndex]?.avatarUrl || '');
      }
      inputEl.value = '';
    },
    async () => {
      try {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        const currentP = latestPlayersData?.[playerIndex] || {};
        await update(ref(db, `games/players/${playerIndex}`), {
          name: currentP.name || `PLAYER ${playerIndex}`,
          fullName: currentP.fullName ?? '',
          score: Number(currentP.score) || 0,
          info: currentP.info ?? '',
          avatarUrl: downloadURL,
          avatarStoragePath: storagePath
        });

        if (oldStoragePath && oldStoragePath !== storagePath) {
          deleteObject(storageRef(storage, oldStoragePath)).catch(() => {});
        }

        if (previewImg) {
          setPlayerAvatarPreviewFallback(previewImg, playerIndex, downloadURL);
        }
        if (statusEl) statusEl.innerText = 'Đã lưu Storage';
        setMainConfigGlobalStatus(`Đã lưu avatar Thí sinh ${playerIndex} lên Firebase Storage!`);
      } catch (err) {
        console.error('Lỗi lấy URL avatar:', err);
        if (statusEl) statusEl.innerText = 'Lỗi lưu DB';
        setMainConfigGlobalStatus(`Lỗi lưu link avatar TS ${playerIndex}: ${err.message}`, true);
      } finally {
        activeStorageUploads = Math.max(0, activeStorageUploads - 1);
        URL.revokeObjectURL(localBlobUrl);
        if (uploadBtn) uploadBtn.disabled = false;
        inputEl.value = '';
      }
    }
  );
};

window.resetPlayerAvatarToDefault = async function(playerIndex) {
  const oldStoragePath = latestPlayersData?.[playerIndex]?.avatarStoragePath || '';
  const statusEl = document.getElementById(`mainCfgAvatarStatus-${playerIndex}`);

  await update(ref(db, `games/players/${playerIndex}`), {
    avatarUrl: '',
    avatarStoragePath: ''
  });

  if (oldStoragePath) {
    deleteObject(storageRef(storage, oldStoragePath)).catch(() => {});
  }

  const previewImg = document.getElementById(`mainCfgAvatarImg-${playerIndex}`);
  if (previewImg) {
    setPlayerAvatarPreviewFallback(previewImg, playerIndex, '');
  }
  if (statusEl) statusEl.innerText = 'Ảnh mặc định';
  setMainConfigGlobalStatus(`Đã đặt lại avatar Thí sinh ${playerIndex} về mặc định.`);
};

window.triggerGameThumbnailFile = function(bgKey) {
  const input = document.getElementById(`mainCfgThumbFile-${bgKey}`);
  if (input) input.click();
};

window.handleGameThumbnailUpload = function(bgKey, inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    setMainConfigGlobalStatus('Vui lòng chọn đúng định dạng tệp hình ảnh!', true);
    inputEl.value = '';
    return;
  }

  const statusEl = document.getElementById(`mainCfgThumbStatus-${bgKey}`);
  const uploadBtn = document.getElementById(`mainCfgThumbBtn-${bgKey}`);
  const previewImg = document.getElementById(`mainCfgThumbImg-${bgKey}`);

  const localBlobUrl = URL.createObjectURL(file);
  if (previewImg) {
    const fallbackText = previewImg.parentElement?.querySelector('.proj-bg-thumb-fallback');
    if (fallbackText) fallbackText.style.display = 'none';
    previewImg.onerror = null;
    previewImg.style.display = 'block';
    previewImg.src = localBlobUrl;
  }

  activeStorageUploads++;
  if (uploadBtn) uploadBtn.disabled = true;
  if (statusEl) statusEl.innerText = 'Đang tải 0%...';
  setMainConfigGlobalStatus(`Đang tải ảnh thumbnail ${bgKey} lên Storage...`);

  const oldStoragePath = customGameThumbnailsMeta?.[bgKey]?.storagePath || '';
  const storagePath = `thumbnails/${bgKey}_${Date.now()}_${sanitizeStorageFileName(file.name)}`;
  const fileRef = storageRef(storage, storagePath);
  const uploadTask = uploadBytesResumable(fileRef, file, { contentType: file.type });

  uploadTask.on(
    'state_changed',
    (snapshot) => {
      const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
      if (statusEl) statusEl.innerText = `Đang tải ${pct}%...`;
    },
    (error) => {
      console.error('Lỗi upload thumbnail:', error);
      activeStorageUploads = Math.max(0, activeStorageUploads - 1);
      URL.revokeObjectURL(localBlobUrl);
      if (uploadBtn) uploadBtn.disabled = false;
      if (statusEl) statusEl.innerText = 'Lỗi tải lên';
      setMainConfigGlobalStatus(`Lỗi tải thumbnail ${bgKey}: ${error.message}`, true);
      if (previewImg) setControllerThumbFallback(previewImg, bgKey);
      inputEl.value = '';
    },
    async () => {
      try {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        await update(ref(db, 'games/game_thumbnails'), {
          [bgKey]: downloadURL
        });
        await set(ref(db, `games/game_thumbnails_meta/${bgKey}`), {
          url: downloadURL,
          fileName: file.name,
          storagePath: storagePath,
          updatedAt: Date.now()
        });

        if (oldStoragePath && oldStoragePath !== storagePath) {
          deleteObject(storageRef(storage, oldStoragePath)).catch(() => {});
        }

        customGameThumbnails[bgKey] = downloadURL;
        if (previewImg) {
          setControllerThumbFallback(previewImg, bgKey);
        }
        renderProjectorBgSelectorUI();

        if (activeProjectorBg === bgKey) {
          syncProjectorBgToDB(activeProjectorBg, true);
        }

        if (statusEl) statusEl.innerText = 'Đã lưu Storage';
        setMainConfigGlobalStatus(`Đã lưu ảnh thumbnail ${bgKey} lên Firebase Storage!`);
      } catch (err) {
        console.error('Lỗi lưu URL thumbnail:', err);
        if (statusEl) statusEl.innerText = 'Lỗi lưu DB';
        setMainConfigGlobalStatus(`Lỗi lưu link thumbnail ${bgKey}: ${err.message}`, true);
      } finally {
        activeStorageUploads = Math.max(0, activeStorageUploads - 1);
        URL.revokeObjectURL(localBlobUrl);
        if (uploadBtn) uploadBtn.disabled = false;
        inputEl.value = '';
      }
    }
  );
};

window.resetGameThumbnailToDefault = async function(bgKey) {
  const oldStoragePath = customGameThumbnailsMeta?.[bgKey]?.storagePath || '';
  const statusEl = document.getElementById(`mainCfgThumbStatus-${bgKey}`);

  await update(ref(db, 'games/game_thumbnails'), {
    [bgKey]: ''
  });
  await set(ref(db, `games/game_thumbnails_meta/${bgKey}`), null);

  if (oldStoragePath) {
    deleteObject(storageRef(storage, oldStoragePath)).catch(() => {});
  }

  customGameThumbnails[bgKey] = '';
  const previewImg = document.getElementById(`mainCfgThumbImg-${bgKey}`);
  if (previewImg) {
    setControllerThumbFallback(previewImg, bgKey);
  }
  renderProjectorBgSelectorUI();

  if (activeProjectorBg === bgKey) {
    syncProjectorBgToDB(activeProjectorBg, true);
  }

  if (statusEl) statusEl.innerText = 'Ảnh mặc định';
  setMainConfigGlobalStatus(`Đã đặt lại thumbnail ${bgKey} về mặc định.`);
};

window.saveAndCloseMainConfig = async function() {
  if (activeStorageUploads > 0) {
    setMainConfigGlobalStatus('Đang tải ảnh lên Storage, vui lòng chờ hoàn tất...', true);
    return;
  }

  const lsVolInput = document.getElementById('mainCfgVolInput-livestream');
  const projVolInput = document.getElementById('mainCfgVolInput-projector');
  const lsVol = lsVolInput && lsVolInput.value !== ''
    ? clampVolumePercent(lsVolInput.value)
    : clampVolumePercent(screenVolumes.livestream);
  const projVol = projVolInput && projVolInput.value !== ''
    ? clampVolumePercent(projVolInput.value)
    : clampVolumePercent(screenVolumes.projector);

  screenVolumes.livestream = lsVol;
  screenVolumes.projector = projVol;

  const updates = {
    'games/audio_volume/livestream': lsVol,
    'games/audio_volume/projector': projVol
  };

  for (let i = 1; i <= 4; i++) {
    const nameInput = document.getElementById(`mainCfgName-${i}`);
    const fullNameInput = document.getElementById(`mainCfgFullName-${i}`);
    const scoreInput = document.getElementById(`mainCfgScore-${i}`);
    const infoInput = document.getElementById(`mainCfgInfo-${i}`);

    const currentP = latestPlayersData?.[i] || {};
    const nameVal = nameInput ? (nameInput.value.trim() || `PLAYER ${i}`) : (currentP.name || `PLAYER ${i}`);
    const fullNameVal = fullNameInput ? fullNameInput.value.trim() : String(currentP.fullName ?? '');
    const scoreVal = scoreInput ? (Number(scoreInput.value) || 0) : (Number(currentP.score) || 0);
    const infoVal = infoInput ? String(infoInput.value ?? '') : String(currentP.info ?? '');

    updates[`games/players/${i}/name`] = nameVal;
    updates[`games/players/${i}/fullName`] = fullNameVal;
    updates[`games/players/${i}/score`] = scoreVal;
    updates[`games/players/${i}/info`] = infoVal;
    if (currentP.avatarUrl === undefined) {
      updates[`games/players/${i}/avatarUrl`] = '';
    }
  }

  try {
    await update(ref(db), updates);
    window.closeConfig();
  } catch (err) {
    console.error('Lỗi lưu cấu hình Main:', err);
    setMainConfigGlobalStatus(`Lỗi lưu dữ liệu: ${err.message}`, true);
  }
};

function populateMainConfigModalUI() {
  const modal = document.getElementById('configModal');
  const dialog = document.getElementById('mainConfigDialog');
  if (!modal || !dialog) return;

  // Giữ nguyên #configModalContent của các vòng khác (chỉ ẩn tạm)
  const roundModalContent = document.getElementById('configModalContent');
  if (roundModalContent) {
    if (roundModalContent.dataset.mainPrevDisplay === undefined) {
      roundModalContent.dataset.mainPrevDisplay = roundModalContent.style.display || '';
    }
    roundModalContent.style.display = 'none';
  }

  modal.dataset.mode = 'MAIN';
  dialog.style.display = '';

  syncScreenVolumeCardUI('livestream', screenVolumes.livestream, false);
  syncScreenVolumeCardUI('projector', screenVolumes.projector, false);

  for (let i = 1; i <= 4; i++) {
    const p = latestPlayersData?.[i] || {};
    const nameInput = document.getElementById(`mainCfgName-${i}`);
    const fullNameInput = document.getElementById(`mainCfgFullName-${i}`);
    const scoreInput = document.getElementById(`mainCfgScore-${i}`);
    const infoInput = document.getElementById(`mainCfgInfo-${i}`);
    const imgEl = document.getElementById(`mainCfgAvatarImg-${i}`);
    const statusEl = document.getElementById(`mainCfgAvatarStatus-${i}`);

    if (nameInput) nameInput.value = p.name !== undefined && p.name !== null ? p.name : `PLAYER ${i}`;
    if (fullNameInput) fullNameInput.value = p.fullName !== undefined && p.fullName !== null ? p.fullName : '';
    if (scoreInput) scoreInput.value = Number(p.score) || 0;
    if (infoInput) infoInput.value = p.info !== undefined && p.info !== null ? p.info : '';
    if (imgEl) setPlayerAvatarPreviewFallback(imgEl, i, p.avatarUrl || '');
    if (statusEl) statusEl.innerText = p.avatarUrl ? 'Đã lưu Storage' : 'Ảnh mặc định';
  }

  PROJECTOR_BG_OPTIONS.forEach((opt) => {
    const thumbImgEl = document.getElementById(`mainCfgThumbImg-${opt.key}`);
    const statusEl = document.getElementById(`mainCfgThumbStatus-${opt.key}`);
    if (thumbImgEl) setControllerThumbFallback(thumbImgEl, opt.key);
    if (statusEl) statusEl.innerText = customGameThumbnails?.[opt.key] ? 'Đã lưu Storage' : 'Ảnh mặc định';
  });

  setMainConfigGlobalStatus('Âm lượng Livestream và Projector hoạt động độc lập và cập nhật trực tiếp.');
  applyMainDialogDprScale();
}

window.openConfig = function() {
  if (!isMainTabActive()) {
    if (typeof previousWindowHandlers.openConfig === 'function') {
      previousWindowHandlers.openConfig();
    }
    return;
  }

  const modal = document.getElementById('configModal');
  if (!modal) return;
  populateMainConfigModalUI();
  modal.style.display = 'flex';
};

window.closeConfig = function() {
  const modal = document.getElementById('configModal');
  if (modal) modal.style.display = 'none';
};

function sendCommand(data) {
  update(ref(db, 'games/commands'), {
    ...data,
    timestamp: Date.now()
  });
}

// =========================================================================
// 2B. QUẢN LÝ NỀN MÀN CHIẾU PROJECTOR (5 THUMBNAIL: R0 -> R4)
// =========================================================================
const PROJECTOR_BG_OPTIONS = [
  { key: 'R0', label: 'Nền Chính', file: 'r0_thumbnail.png' },
  { key: 'R1', label: 'Vòng 1', file: 'r1_thumbnail.png' },
  { key: 'R2', label: 'Vòng 2', file: 'r2_thumbnail.png' },
  { key: 'R3', label: 'Vòng 3', file: 'r3_thumbnail.png' },
  { key: 'R4', label: 'Vòng 4', file: 'r4_thumbnail.png' }
];

let activeProjectorBg = 'R0';
try {
  const savedBg = localStorage.getItem('olympia_main_projector_bg');
  if (savedBg && PROJECTOR_BG_OPTIONS.some(opt => opt.key === savedBg)) {
    activeProjectorBg = savedBg;
  }
} catch (e) {}

function getProjectorBgOption(bgKey) {
  return PROJECTOR_BG_OPTIONS.find(opt => opt.key === bgKey) || PROJECTOR_BG_OPTIONS[0];
}

function syncProjectorBgToDB(bgKey, alsoSendCommand = false) {
  const opt = getProjectorBgOption(bgKey);
  const customUrl = customGameThumbnails?.[opt.key] || '';
  set(ref(db, 'games/main_projector_bg'), {
    key: opt.key,
    file: opt.file,
    url: customUrl,
    updatedAt: Date.now()
  });
  if (alsoSendCommand) {
    sendCommand({
      action: 'set_projector_bg',
      key: opt.key,
      file: opt.file,
      url: customUrl
    });
  }
}

function setControllerThumbFallback(imgEl, bgKey) {
  if (!imgEl) return;
  const fallbackText = imgEl.parentElement?.querySelector('.proj-bg-thumb-fallback');
  if (fallbackText) fallbackText.style.display = 'none';
  imgEl.style.display = 'block';

  const kUpper = bgKey.toUpperCase();
  const kLower = bgKey.toLowerCase();
  const customUrl = customGameThumbnails?.[kUpper] || customGameThumbnails?.[bgKey] || '';

  const localSources = [
    `../graphic/o27/${kUpper}_thumbnail.png`,
    `../graphic/o27/${kLower}_thumbnail.png`,
    `/graphic/o27/${kUpper}_thumbnail.png`,
    `graphic/o27/${kUpper}_thumbnail.png`,
    `graphic/o27/${kUpper}_thumbnail.png`,
    `${kUpper}_thumbnail.png`,
    `${kLower}_thumbnail.png`
  ];
  const sources = customUrl ? [customUrl, ...localSources] : localSources;

  let idx = 0;
  imgEl.src = sources[idx];
  imgEl.onerror = () => {
    idx++;
    if (idx < sources.length) {
      imgEl.src = sources[idx];
    } else {
      imgEl.onerror = null;
      imgEl.style.display = 'none';
      if (fallbackText) fallbackText.style.display = 'inline';
    }
  };
}

function renderProjectorBgSelectorUI() {
  const grid = document.getElementById('projBgSelectorGrid');
  const badge = document.getElementById('projBgActiveBadge');
  const activeOpt = getProjectorBgOption(activeProjectorBg);

  if (badge) {
    const customMetaName = customGameThumbnailsMeta?.[activeOpt.key]?.fileName;
    badge.innerText = customMetaName ? `${activeOpt.key} (${customMetaName})` : activeOpt.file;
  }
  if (!grid) return;

  grid.innerHTML = '';
  PROJECTOR_BG_OPTIONS.forEach((opt) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `proj-bg-card ${opt.key === activeProjectorBg ? 'active' : ''}`;
    card.title = `${opt.label} (${opt.file})`;
    card.onclick = () => window.selectProjectorBg(opt.key);

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'proj-bg-thumb-wrap';

    const imgEl = document.createElement('img');
    imgEl.className = 'proj-bg-thumb-img';
    imgEl.alt = opt.label;

    const fallbackSpan = document.createElement('span');
    fallbackSpan.className = 'proj-bg-thumb-fallback';
    fallbackSpan.textContent = opt.key;

    const codeTag = document.createElement('span');
    codeTag.className = 'proj-bg-code-tag';
    codeTag.textContent = opt.key;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'proj-bg-label';
    labelSpan.textContent = opt.label;

    thumbWrap.append(imgEl, fallbackSpan, codeTag);
    card.append(thumbWrap, labelSpan);

    setControllerThumbFallback(imgEl, opt.key);
    grid.appendChild(card);
  });
}

window.selectProjectorBg = function(bgKey) {
  const opt = getProjectorBgOption(bgKey);
  activeProjectorBg = opt.key;
  try {
    localStorage.setItem('olympia_main_projector_bg', activeProjectorBg);
  } catch (e) {}

  renderProjectorBgSelectorUI();
  syncProjectorBgToDB(activeProjectorBg, true);
};

const unsubProjectorBg = onValue(ref(db, 'games/main_projector_bg'), (snapshot) => {
  if (!snapshot.exists()) {
    syncProjectorBgToDB(activeProjectorBg, false);
    return;
  }
  const val = snapshot.val();
  if (val && val.key && PROJECTOR_BG_OPTIONS.some(opt => opt.key === val.key)) {
    if (activeProjectorBg !== val.key) {
      activeProjectorBg = val.key;
      try {
        localStorage.setItem('olympia_main_projector_bg', activeProjectorBg);
      } catch (e) {}
      renderProjectorBgSelectorUI();
    }
  }
});

const unsubGameThumbnails = onValue(ref(db, 'games/game_thumbnails'), (snapshot) => {
  customGameThumbnails = snapshot.exists() ? (snapshot.val() || {}) : {};
  renderProjectorBgSelectorUI();

  const modal = document.getElementById('configModal');
  if (modal && modal.style.display === 'flex' && modal.dataset.mode === 'MAIN') {
    PROJECTOR_BG_OPTIONS.forEach((opt) => {
      const thumbImgEl = document.getElementById(`mainCfgThumbImg-${opt.key}`);
      const statusEl = document.getElementById(`mainCfgThumbStatus-${opt.key}`);
      if (thumbImgEl) setControllerThumbFallback(thumbImgEl, opt.key);
      if (statusEl && activeStorageUploads === 0) {
        statusEl.innerText = customGameThumbnails?.[opt.key] ? 'Đã lưu Storage' : 'Ảnh mặc định';
      }
    });
  }
});

const unsubGameThumbnailsMeta = onValue(ref(db, 'games/game_thumbnails_meta'), (snapshot) => {
  customGameThumbnailsMeta = snapshot.exists() ? (snapshot.val() || {}) : {};
  renderProjectorBgSelectorUI();
});

const unsubAudioVolume = onValue(ref(db, 'games/audio_volume'), (snapshot) => {
  const data = snapshot.exists() ? (snapshot.val() || {}) : {};
  const lsVol = data.livestream !== undefined ? clampVolumePercent(data.livestream) : 100;
  const projVol = data.projector !== undefined ? clampVolumePercent(data.projector) : 100;

  screenVolumes.livestream = lsVol;
  screenVolumes.projector = projVol;

  const modal = document.getElementById('configModal');
  if (modal && modal.style.display === 'flex' && modal.dataset.mode === 'MAIN') {
    syncScreenVolumeCardUI('livestream', lsVol, false);
    syncScreenVolumeCardUI('projector', projVol, false);
  } else {
    if (lsVol > 0) lastNonZeroVolumes.livestream = lsVol;
    if (projVol > 0) lastNonZeroVolumes.projector = projVol;
  }
});

// =========================================================================
// 3. QUẢN LÝ BỘ SETUP (PRESETS), VIDEO LOWERTHIRD & ĐA FONT TRONG 1 TEXT
// =========================================================================
const DEFAULT_FONT = '"UTM Avo", Arial, sans-serif';

const FONT_OPTIONS = [
  { label: 'UTM Avo (Mặc định)', value: '"UTM Avo", Arial, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Segoe UI', value: '"Segoe UI", Tahoma, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Roboto', value: '"Roboto", Arial, sans-serif' },
  { label: 'Montserrat', value: '"Montserrat", Arial, sans-serif' },
  { label: 'Oswald', value: '"Oswald", Arial, sans-serif' },
  { label: 'UTM Bebas', value: '"UTM Bebas", Impact, sans-serif' },
  { label: 'UTM Trajan', value: '"UTM Trajan", Georgia, serif' }
];

let isIntroActive = false;
let isLowerthirdActive = false;
let activeRoundIntro = null;
let currentPreviewVideoType = null;
let savedSelectionRange = null;

// Trạng thái Tổng kết điểm (0: nghỉ, 1..5: đang chạy các bước, lần 6 -> về 0)
let pointSummaryStep = 0;
let pointSummaryOrder = [];

// Trạng thái Hiện kết quả trận đấu (bật/tắt bảng tổng kết frame cuối không animation)
let isMatchResultActive = false;

function buildOrderedPlayers(playersObj) {
  const list = [];
  for (let i = 1; i <= 4; i++) {
    const p = (playersObj && playersObj[i]) ? playersObj[i] : {};
    const rawName = (p.name !== undefined && p.name !== null && String(p.name).trim() !== '')
      ? String(p.name)
      : `PLAYER ${i}`;
    list.push({
      index: i,
      name: rawName,
      score: Number(p.score) || 0,
      avatarUrl: p.avatarUrl || '',
      info: p.info || ''
    });
  }
  return list;
}

function buildSortedPlayers(playersObj) {
  const list = buildOrderedPlayers(playersObj);
  list.sort((a, b) => {
    if (a.score !== b.score) {
      return a.score - b.score;
    }
    return a.index - b.index;
  });
  return list;
}

function getPointSummaryBtnText() {
  return pointSummaryStep > 0 ? `TỔNG KẾT (${pointSummaryStep}/5)` : 'TỔNG KẾT ĐIỂM';
}

function updatePointSummaryBtnUI() {
  const btn = document.getElementById('btnPointSummary');
  if (!btn) return;
  btn.innerText = getPointSummaryBtnText();
  btn.classList.toggle('is-running', pointSummaryStep > 0);
}

function syncMatchResultBtnUI() {
  const btn = document.getElementById('btnMatchResult');
  if (!btn) return;
  btn.classList.toggle('is-running', isMatchResultActive);
  btn.innerText = isMatchResultActive ? 'ẨN KẾT QUẢ' : 'KẾT QUẢ TRẬN ĐẤU';
}

function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeRichHTML(rawHtml) {
  const temp = document.createElement('div');
  temp.innerHTML = rawHtml || '';

  function cleanNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return document.createDocumentFragment();
    }

    const tag = node.tagName.toLowerCase();
    if (tag === 'br') {
      return document.createElement('br');
    }

    const span = document.createElement('span');
    if (tag === 'b' || tag === 'strong') span.style.fontWeight = 'bold';
    if (tag === 'i' || tag === 'em') span.style.fontStyle = 'italic';

    if (node.style) {
      if (node.style.fontFamily) span.style.fontFamily = node.style.fontFamily;
      if (node.style.fontWeight) span.style.fontWeight = node.style.fontWeight;
      if (node.style.fontStyle) span.style.fontStyle = node.style.fontStyle;
    }
    if (tag === 'font' && node.getAttribute('face')) {
      span.style.fontFamily = node.getAttribute('face');
    }

    const frag = document.createDocumentFragment();
    const isBlock = (tag === 'div' || tag === 'p');
    if (isBlock && node.previousSibling) {
      frag.appendChild(document.createElement('br'));
    }

    const hasStyle = Boolean(span.style.fontFamily || span.style.fontWeight || span.style.fontStyle);
    const target = hasStyle ? span : frag;

    Array.from(node.childNodes).forEach(child => {
      target.appendChild(cleanNode(child));
    });

    if (hasStyle) {
      frag.appendChild(span);
    }
    return frag;
  }

  const out = document.createElement('div');
  Array.from(temp.childNodes).forEach(child => {
    out.appendChild(cleanNode(child));
  });
  return out.innerHTML;
}

function getItemRichHTML(item) {
  if (item.html !== undefined && item.html !== null) {
    return sanitizeRichHTML(item.html);
  }
  return escapeHTML(item.content || '').replace(/\r?\n/g, '<br>');
}

function normalizeTextItem(t, fallbackId) {
  const baseFont = t.fontFamily || DEFAULT_FONT;
  const baseBold = t.bold !== undefined ? Boolean(t.bold) : true;
  const baseItalic = Boolean(t.italic);
  const content = t.content !== undefined ? t.content : '';
  const html = t.html !== undefined && t.html !== null
    ? sanitizeRichHTML(t.html)
    : escapeHTML(content).replace(/\r?\n/g, '<br>');

  return {
    id: t.id || fallbackId,
    content,
    html,
    x: Number(t.x) || 0,
    y: Number(t.y) || 0,
    size: Number(t.size) || 2.0,
    fontFamily: baseFont,
    bold: baseBold,
    italic: baseItalic
  };
}

function normalizePreset(p, fallbackId) {
  return {
    id: p.id || fallbackId,
    name: p.name || `Bộ ${fallbackId}`,
    videoType: p.videoType === 'lt2' ? 'lt2' : 'lt1',
    clipLeft: p.clipLeft !== undefined ? Math.max(0, Math.min(85, Number(p.clipLeft))) : 15,
    tickerSpeed: p.tickerSpeed !== undefined ? Math.max(2, Math.min(40, Number(p.tickerSpeed))) : 12,
    texts: Array.isArray(p.texts) ? p.texts.map((t, i) => normalizeTextItem(t, i + 1)) : []
  };
}

let ltPresets = [
  {
    id: 1,
    name: "Bộ 1",
    videoType: "lt1",
    clipLeft: 15,
    tickerSpeed: 12,
    texts: [
      {
        id: 1,
        content: "HỌ VÀ TÊN THÍ SINH",
        html: "HỌ VÀ TÊN THÍ SINH",
        x: 15,
        y: 74,
        size: 2.2,
        fontFamily: DEFAULT_FONT,
        bold: true,
        italic: false
      },
      {
        id: 2,
        content: "Trường THPT Chuyên...",
        html: "Trường THPT Chuyên...",
        x: 15,
        y: 80,
        size: 1.5,
        fontFamily: DEFAULT_FONT,
        bold: true,
        italic: false
      }
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
      ltPresets = parsed.presets.map((p, idx) => normalizePreset(p, idx + 1));
      activePresetId = parsed.activePresetId || ltPresets[0].id;
      if (!ltPresets.some(p => p.id === activePresetId)) {
        activePresetId = ltPresets[0].id;
      }
      nextPresetId = Math.max(...ltPresets.map(p => p.id)) + 1;

      let maxTxtId = 0;
      ltPresets.forEach(p => {
        p.texts.forEach(t => { if (t.id > maxTxtId) maxTxtId = t.id; });
      });
      nextTextId = maxTxtId + 1;
    }
  } else {
    const oldSingle = localStorage.getItem('olympia_main_lt_texts');
    if (oldSingle) {
      const parsedOld = JSON.parse(oldSingle);
      if (Array.isArray(parsedOld) && parsedOld.length > 0) {
        ltPresets[0].texts = parsedOld.map((t, idx) => normalizeTextItem(t, idx + 1));
        nextTextId = Math.max(...ltPresets[0].texts.map(t => t.id)) + 1;
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

function getActivePresetPayload() {
  const preset = getActivePreset();
  if (!preset) {
    return { videoType: 'lt1', clipLeft: 15, tickerSpeed: 12, texts: [] };
  }
  return {
    videoType: preset.videoType || 'lt1',
    clipLeft: preset.clipLeft !== undefined ? preset.clipLeft : 15,
    tickerSpeed: preset.tickerSpeed !== undefined ? preset.tickerSpeed : 12,
    texts: preset.texts || []
  };
}

function saveLtConfig() {
  try {
    localStorage.setItem('olympia_main_lt_presets', JSON.stringify({
      presets: ltPresets,
      activePresetId: activePresetId
    }));
  } catch (e) {}
  const payload = getActivePresetPayload();
  update(ref(db, 'games/main_lowerthird'), {
    presets: ltPresets,
    activePresetId: activePresetId,
    ...payload,
    updatedAt: Date.now()
  });
}

function bindMainWorkspaceEvents() {
  const { signal } = uiAbortController;

  const previewWrapper = document.getElementById('ltPreviewWrapper');
  if (previewWrapper) {
    previewWrapper.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.lt-draggable-text')) {
        selectedTextId = null;
        savedSelectionRange = null;
        renderLtEditorUI();
      }
    }, { signal });
  }

  document.getElementById('btnAddLtPreset')?.addEventListener('click', () => window.addLtPreset(), { signal });
  document.getElementById('btnDuplicateLtPreset')?.addEventListener('click', () => window.duplicateLtPreset(), { signal });
  document.getElementById('btnRemoveLtPreset')?.addEventListener('click', () => window.removeLtPreset(), { signal });

  document.getElementById('ltPresetNameInput')?.addEventListener('input', (e) => {
    window.updateActivePresetName(e.target.value);
  }, { signal });

  document.getElementById('ltPresetVideoSelect')?.addEventListener('change', (e) => {
    window.updateActivePresetVideo(e.target.value);
  }, { signal });

  document.getElementById('ltClipLeftInput')?.addEventListener('input', (e) => {
    window.updateActivePresetTicker('clipLeft', e.target.value);
  }, { signal });

  document.getElementById('ltTickerSpeedInput')?.addEventListener('input', (e) => {
    window.updateActivePresetTicker('tickerSpeed', e.target.value);
  }, { signal });

  document.getElementById('btnAddLtText')?.addEventListener('click', () => window.addLtText(), { signal });
  document.getElementById('btnRemoveLtText')?.addEventListener('click', () => window.removeLtText(), { signal });

  document.getElementById('ltInputFont')?.addEventListener('change', (e) => {
    window.handleFontSelectChange(e.target.value);
  }, { signal });

  const btnBold = document.getElementById('ltBtnBold');
  if (btnBold) {
    btnBold.addEventListener('mousedown', (e) => e.preventDefault(), { signal });
    btnBold.addEventListener('click', () => window.toggleSelectedLtStyle('bold'), { signal });
  }

  const btnItalic = document.getElementById('ltBtnItalic');
  if (btnItalic) {
    btnItalic.addEventListener('mousedown', (e) => e.preventDefault(), { signal });
    btnItalic.addEventListener('click', () => window.toggleSelectedLtStyle('italic'), { signal });
  }

  document.getElementById('ltInputCustomFont')?.addEventListener('input', (e) => {
    window.applyFontFamilyToEditor(e.target.value);
  }, { signal });

  document.getElementById('ltInputSize')?.addEventListener('input', (e) => {
    window.updateSelectedLtText('size', e.target.value);
  }, { signal });

  document.getElementById('ltInputX')?.addEventListener('input', (e) => {
    window.updateSelectedLtText('x', e.target.value);
  }, { signal });

  document.getElementById('ltInputY')?.addEventListener('input', (e) => {
    window.updateSelectedLtText('y', e.target.value);
  }, { signal });

  document.getElementById('btnMainIntro')?.addEventListener('click', (e) => {
    window.triggerMainIntro(e.currentTarget);
  }, { signal });

  document.getElementById('btnMainLT')?.addEventListener('click', (e) => {
    window.triggerMainLowerthird(e.currentTarget);
  }, { signal });

  document.querySelectorAll('.round-intro-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.toggleRoundIntro(btn, btn.dataset.round);
    }, { signal });
  });

  document.getElementById('btnPointSummary')?.addEventListener('click', (e) => {
    window.triggerPointSummary(e.currentTarget);
  }, { signal });

  document.getElementById('btnMatchResult')?.addEventListener('click', (e) => {
    window.triggerMatchResult(e.currentTarget);
  }, { signal });

  document.getElementById('btnMainReset')?.addEventListener('click', (e) => {
    window.triggerMainReset(e.currentTarget);
  }, { signal });
}

function bindMainConfigModalEvents() {
  const { signal } = uiAbortController;

  document.getElementById('mainCfgCloseBtn')?.addEventListener('click', () => {
    window.saveAndCloseMainConfig();
  }, { signal });

  document.getElementById('mainCfgSaveBtn')?.addEventListener('click', () => {
    window.saveAndCloseMainConfig();
  }, { signal });

  document.querySelectorAll('.main-cfg-vol-mute-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.toggleScreenMute(btn.dataset.screen);
    }, { signal });
  });

  document.querySelectorAll('.main-cfg-vol-slider').forEach((slider) => {
    slider.addEventListener('input', () => {
      window.setScreenVolume(slider.dataset.screen, slider.value);
    }, { signal });
  });

  document.querySelectorAll('.main-cfg-vol-num').forEach((input) => {
    input.addEventListener('input', () => {
      window.handleScreenVolumeNumberInput(input.dataset.screen, input.value);
    }, { signal });
    input.addEventListener('change', () => {
      window.normalizeScreenVolumeNumberInput(input.dataset.screen, input);
    }, { signal });
  });

  document.querySelectorAll('.main-cfg-hidden-file[data-player-index]').forEach((input) => {
    input.addEventListener('change', () => {
      window.handlePlayerAvatarUpload(Number(input.dataset.playerIndex), input);
    }, { signal });
  });

  document.querySelectorAll('.main-cfg-avatar-upload-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.triggerPlayerAvatarFile(Number(btn.dataset.playerIndex));
    }, { signal });
  });

  document.querySelectorAll('.main-cfg-avatar-reset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.resetPlayerAvatarToDefault(Number(btn.dataset.playerIndex));
    }, { signal });
  });

  document.querySelectorAll('.main-cfg-name-input').forEach((input) => {
    input.addEventListener('change', () => {
      window.updateNameDB(Number(input.dataset.playerIndex), input.value);
    }, { signal });
  });

  document.querySelectorAll('.main-cfg-fullname-input').forEach((input) => {
    input.addEventListener('change', () => {
      window.updatePlayerFullNameDB(Number(input.dataset.playerIndex), input.value);
    }, { signal });
  });

  document.querySelectorAll('.main-cfg-score-step').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.adjustMainPlayerScore(Number(btn.dataset.playerIndex), Number(btn.dataset.delta));
    }, { signal });
  });

  document.querySelectorAll('.main-cfg-score-input').forEach((input) => {
    input.addEventListener('change', () => {
      window.updateScoreDB(Number(input.dataset.playerIndex), input.value);
    }, { signal });
  });

  document.querySelectorAll('.main-cfg-info-input').forEach((textarea) => {
    textarea.addEventListener('change', () => {
      window.updatePlayerInfoDB(Number(textarea.dataset.playerIndex), textarea.value);
    }, { signal });
  });

  document.querySelectorAll('.main-cfg-hidden-file[data-bg-key]').forEach((input) => {
    input.addEventListener('change', () => {
      window.handleGameThumbnailUpload(input.dataset.bgKey, input);
    }, { signal });
  });

  document.querySelectorAll('.main-cfg-thumb-upload-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.triggerGameThumbnailFile(btn.dataset.bgKey);
    }, { signal });
  });

  document.querySelectorAll('.main-cfg-thumb-reset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.resetGameThumbnailToDefault(btn.dataset.bgKey);
    }, { signal });
  });
}

function renderMainWorkspace() {
  if (!mainGrid) return;

  hideOtherRoundPanelsInGrid();
  mainGrid.dataset.mode = 'MAIN';

  const mainContainer = document.getElementById('main-controller-ui');
  if (mainContainer) {
    mainContainer.style.display = 'contents';
  }

  const rText = document.getElementById('roundText');
  if (rText) rText.innerText = "MAIN CONTROL";
  window.compressBadgeText('roundText');

  syncMainIntroBtnUI();
  syncMainLowerthirdBtnUI();
  syncRoundIntroButtonsUI();
  updatePointSummaryBtnUI();
  syncMatchResultBtnUI();

  bindMainWorkspaceEvents();
  bindMainConfigModalEvents();
  renderProjectorBgSelectorUI();
  setupRichEditorEvents();
  currentPreviewVideoType = null;
  setupPreviewVideoFrame(getActivePreset()?.videoType || 'lt1');
  renderLtEditorUI();
  setupCanvasDragEvents();
}

function setupRichEditorEvents() {
  const editor = document.getElementById('ltRichEditor');
  if (!editor) return;

  const saveRangeAndSyncToolbar = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) {
        savedSelectionRange = range.cloneRange();
        syncToolbarFromCaret(range);
      }
    }
  };

  const { signal } = uiAbortController;

  editor.addEventListener('input', () => {
    syncRichEditorToData();
    saveRangeAndSyncToolbar();
  }, { signal });

  editor.addEventListener('mouseup', saveRangeAndSyncToolbar, { signal });
  editor.addEventListener('keyup', saveRangeAndSyncToolbar, { signal });

  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  }, { signal });
}

function syncToolbarFromCaret(range) {
  const editor = document.getElementById('ltRichEditor');
  const fontSelect = document.getElementById('ltInputFont');
  const customFontGroup = document.getElementById('ltCustomFontGroup');
  const customFontInput = document.getElementById('ltInputCustomFont');
  const btnBold = document.getElementById('ltBtnBold');
  const btnItalic = document.getElementById('ltBtnItalic');
  if (!editor || !range) return;

  let targetEl = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range.startContainer.parentElement;

  if (!targetEl || !editor.contains(targetEl)) targetEl = editor;

  const computed = window.getComputedStyle(targetEl);
  const weightNum = parseInt(computed.fontWeight, 10);
  const isBold = computed.fontWeight === 'bold' || (!isNaN(weightNum) && weightNum >= 600);
  const isItalic = computed.fontStyle === 'italic' || computed.fontStyle === 'oblique';

  if (btnBold) btnBold.classList.toggle('active', isBold);
  if (btnItalic) btnItalic.classList.toggle('active', isItalic);

  let fontEl = targetEl;
  let declaredFont = '';
  while (fontEl && fontEl !== editor.parentElement) {
    if (fontEl.style && fontEl.style.fontFamily) {
      declaredFont = fontEl.style.fontFamily;
      break;
    }
    fontEl = fontEl.parentElement;
  }

  if (fontSelect && declaredFont) {
    const matched = FONT_OPTIONS.find(f =>
      f.value.replace(/['"]/g, '').toLowerCase() === declaredFont.replace(/['"]/g, '').toLowerCase()
    );
    if (matched) {
      fontSelect.value = matched.value;
      if (customFontGroup) customFontGroup.style.display = 'none';
    } else {
      fontSelect.value = '__custom__';
      if (customFontGroup) customFontGroup.style.display = 'flex';
      if (customFontInput && document.activeElement !== customFontInput) {
        customFontInput.value = declaredFont;
      }
    }
  }
}

function syncRichEditorToData() {
  const editor = document.getElementById('ltRichEditor');
  const ltTexts = getActiveTexts();
  const item = ltTexts.find(t => t.id === selectedTextId);
  if (!editor || !item) return;

  item.html = sanitizeRichHTML(editor.innerHTML);
  item.content = editor.innerText;

  const activeEl = document.querySelector(`.lt-draggable-text[data-id="${selectedTextId}"]`);
  if (activeEl) {
    applyTextStyleToElement(activeEl, item);
  }

  saveLtConfig();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', ...getActivePresetPayload() });
  }
}

function applyInlineStyleToSelection(styleProp, styleVal) {
  const editor = document.getElementById('ltRichEditor');
  const ltTexts = getActiveTexts();
  const item = ltTexts.find(t => t.id === selectedTextId);
  if (!editor || !item) return false;

  const sel = window.getSelection();
  if (savedSelectionRange && editor.contains(savedSelectionRange.commonAncestorContainer)) {
    sel.removeAllRanges();
    sel.addRange(savedSelectionRange);
  }

  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;

  if (!range.collapsed) {
    const fragment = range.extractContents();
    fragment.querySelectorAll('span').forEach(sp => {
      sp.style[styleProp] = '';
    });

    const wrapper = document.createElement('span');
    wrapper.style[styleProp] = styleVal;
    wrapper.appendChild(fragment);

    range.insertNode(wrapper);

    const newRange = document.createRange();
    newRange.selectNodeContents(wrapper);
    sel.removeAllRanges();
    sel.addRange(newRange);
    savedSelectionRange = newRange.cloneRange();

    syncRichEditorToData();
    syncToolbarFromCaret(newRange);
    return true;
  }

  const span = document.createElement('span');
  span.style[styleProp] = styleVal;
  const zwsp = document.createTextNode('\u200B');
  span.appendChild(zwsp);
  range.insertNode(span);

  const caretRange = document.createRange();
  caretRange.setStart(zwsp, 1);
  caretRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caretRange);
  savedSelectionRange = caretRange.cloneRange();

  syncRichEditorToData();
  syncToolbarFromCaret(caretRange);
  return true;
}

function setupPreviewVideoFrame(videoType = 'lt1') {
  const vid = document.getElementById('ltPreviewVideo');
  if (!vid) return;
  if (currentPreviewVideoType === videoType && vid.src) return;
  currentPreviewVideoType = videoType;

  const sources = videoType === 'lt2'
    ? [
        '../graphic/o27/main_credit.webm',
        '../graphic/o27/main_credit.webm',
        '/graphic/o27/main_credit.webm',
        'graphic/o27/main_credit.webm',
        'graphic/o27/main_credit.webm',
        'main_credit.webm',
        'main_credit.webm'
      ]
    : [
        '../graphic/o27/main_lowerthird.webm',
        '../graphic/o27/main_lowerthird.webm',
        '/graphic/o27/main_lowerthird.webm',
        'graphic/o27/main_lowerthird.webm',
        'graphic/o27/main_lowerthird.webm',
        'main_lowerthird.webm',
        'main_lowerthird.webm'
      ];

  let srcIdx = 0;
  vid.src = sources[srcIdx];
  vid.onerror = () => {
    srcIdx++;
    if (srcIdx < sources.length) vid.src = sources[srcIdx];
  };

  vid.onloadedmetadata = () => {
    if (vid.duration && isFinite(vid.duration)) {
      vid.currentTime = videoType === 'lt2'
        ? Math.max(0, vid.duration * 0.5)
        : Math.max(0, vid.duration - 0.05);
    }
  };

  vid.onseeked = () => {
    vid.pause();
  };
}

function applyTextStyleToElement(el, item) {
  el.style.left = `${item.x}%`;
  el.style.top = `${item.y}%`;
  el.style.fontSize = `${item.size}cqw`;
  el.style.fontFamily = item.fontFamily || DEFAULT_FONT;
  el.style.fontWeight = item.bold !== false ? 'bold' : 'normal';
  el.style.fontStyle = item.italic ? 'italic' : 'normal';
  el.innerHTML = getItemRichHTML(item);
}

function renderLtEditorUI() {
  const layer = document.getElementById('ltTextLayer');
  const list = document.getElementById('ltItemsList');
  const presetsList = document.getElementById('ltPresetsList');
  const presetNameInput = document.getElementById('ltPresetNameInput');
  const videoSelect = document.getElementById('ltPresetVideoSelect');
  const tickerRow = document.getElementById('ltTickerSettingsRow');
  const clipLeftInput = document.getElementById('ltClipLeftInput');
  const tickerSpeedInput = document.getElementById('ltTickerSpeedInput');
  const clipGuide = document.getElementById('ltClipGuide');
  const clipGuideBadge = document.getElementById('ltClipGuideBadge');
  if (!layer || !list || !presetsList) return;

  const activePreset = getActivePreset();
  const ltTexts = activePreset ? activePreset.texts : [];
  const videoType = activePreset?.videoType || 'lt1';
  const clipLeft = activePreset?.clipLeft !== undefined ? activePreset.clipLeft : 15;
  const tickerSpeed = activePreset?.tickerSpeed !== undefined ? activePreset.tickerSpeed : 12;

  setupPreviewVideoFrame(videoType);

  presetsList.innerHTML = '';
  ltPresets.forEach((preset, idx) => {
    const chip = document.createElement('button');
    chip.className = `lt-item-chip preset-chip ${preset.id === activePresetId ? 'active' : ''}`;
    const tag = preset.videoType === 'lt2' ? '*' : '';
    chip.innerText = `${preset.name || `Bộ ${idx + 1}`}${tag}`;
    chip.onclick = () => {
      if (activePresetId !== preset.id) {
        activePresetId = preset.id;
        selectedTextId = null;
        savedSelectionRange = null;
        saveLtConfig();
        renderLtEditorUI();
        if (isLowerthirdActive) {
          sendCommand({
            action: 'update_lowerthird_texts',
            ...getActivePresetPayload()
          });
        }
      }
    };
    presetsList.appendChild(chip);
  });

  if (presetNameInput && activePreset && document.activeElement !== presetNameInput) {
    presetNameInput.value = activePreset.name || '';
  }
  if (videoSelect) {
    videoSelect.value = videoType;
  }

  if (videoType === 'lt2') {
    if (tickerRow) tickerRow.style.display = 'grid';
    if (clipLeftInput && document.activeElement !== clipLeftInput) clipLeftInput.value = clipLeft;
    if (tickerSpeedInput && document.activeElement !== tickerSpeedInput) tickerSpeedInput.value = tickerSpeed;
    if (clipGuide) {
      clipGuide.style.display = 'block';
      clipGuide.style.width = `${clipLeft}%`;
    }
    if (clipGuideBadge) {
      clipGuideBadge.innerText = `Cắt trái ${clipLeft}%`;
    }
  } else {
    if (tickerRow) tickerRow.style.display = 'none';
    if (clipGuide) clipGuide.style.display = 'none';
  }

  list.innerHTML = '';
  ltTexts.forEach((item, idx) => {
    const chip = document.createElement('button');
    chip.className = `lt-item-chip ${item.id === selectedTextId ? 'active' : ''}`;
    chip.innerText = `Text ${idx + 1}`;
    chip.onclick = () => {
      selectedTextId = (selectedTextId === item.id) ? null : item.id;
      savedSelectionRange = null;
      renderLtEditorUI();
    };
    list.appendChild(chip);
  });

  layer.innerHTML = '';
  ltTexts.forEach((item) => {
    const el = document.createElement('div');
    el.className = `lt-draggable-text ${item.id === selectedTextId ? 'selected' : ''}`;
    el.dataset.id = item.id;
    applyTextStyleToElement(el, item);

    el.addEventListener('mousedown', (e) => {
      if (selectedTextId !== item.id) {
        selectedTextId = item.id;
        savedSelectionRange = null;
        renderLtEditorUI();
      }
      startDraggingText(e, item.id);
    });

    layer.appendChild(el);
  });

  const current = ltTexts.find(t => t.id === selectedTextId);
  const richEditor = document.getElementById('ltRichEditor');
  const fontSelect = document.getElementById('ltInputFont');
  const customFontGroup = document.getElementById('ltCustomFontGroup');
  const customFontInput = document.getElementById('ltInputCustomFont');
  const btnBold = document.getElementById('ltBtnBold');
  const btnItalic = document.getElementById('ltBtnItalic');
  const sizeInput = document.getElementById('ltInputSize');
  const sizeLabel = document.getElementById('ltSizeVal');
  const xInput = document.getElementById('ltInputX');
  const yInput = document.getElementById('ltInputY');

  if (current) {
    if (richEditor) {
      richEditor.setAttribute('contenteditable', 'true');
      richEditor.style.fontFamily = current.fontFamily || DEFAULT_FONT;
      richEditor.style.fontWeight = current.bold !== false ? 'bold' : 'normal';
      richEditor.style.fontStyle = current.italic ? 'italic' : 'normal';
      if (document.activeElement !== richEditor) {
        richEditor.innerHTML = getItemRichHTML(current);
      }
    }

    if (sizeInput && document.activeElement !== sizeInput) sizeInput.value = current.size;
    if (sizeLabel) sizeLabel.innerText = `${current.size}`;
    if (xInput && document.activeElement !== xInput) xInput.value = Number(current.x).toFixed(1);
    if (yInput && document.activeElement !== yInput) yInput.value = Number(current.y).toFixed(1);

    const curFont = current.fontFamily || DEFAULT_FONT;
    const isPresetFont = FONT_OPTIONS.some(f => f.value === curFont);
    if (fontSelect) {
      fontSelect.disabled = false;
      if (!savedSelectionRange) {
        fontSelect.value = isPresetFont ? curFont : '__custom__';
      }
    }
    if (customFontGroup && !savedSelectionRange) {
      customFontGroup.style.display = isPresetFont ? 'none' : 'flex';
    }
    if (customFontInput) {
      customFontInput.disabled = false;
      if (!savedSelectionRange && document.activeElement !== customFontInput) {
        customFontInput.value = isPresetFont ? '' : curFont;
      }
    }

    if (btnBold) {
      btnBold.disabled = false;
      if (!savedSelectionRange) btnBold.classList.toggle('active', current.bold !== false);
    }
    if (btnItalic) {
      btnItalic.disabled = false;
      if (!savedSelectionRange) btnItalic.classList.toggle('active', Boolean(current.italic));
    }

    if (sizeInput) sizeInput.disabled = false;
    if (xInput) xInput.disabled = false;
    if (yInput) yInput.disabled = false;
  } else {
    if (richEditor) {
      richEditor.setAttribute('contenteditable', 'false');
      richEditor.innerHTML = '';
    }
    if (fontSelect) { fontSelect.value = DEFAULT_FONT; fontSelect.disabled = true; }
    if (customFontGroup) customFontGroup.style.display = 'none';
    if (customFontInput) { customFontInput.value = ''; customFontInput.disabled = true; }
    if (btnBold) { btnBold.disabled = true; btnBold.classList.remove('active'); }
    if (btnItalic) { btnItalic.disabled = true; btnItalic.classList.remove('active'); }
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
    videoType: "lt1",
    clipLeft: 15,
    tickerSpeed: 12,
    texts: [
      { id: nextTextId++, content: "Nội dung dòng 1", html: "Nội dung dòng 1", x: 15, y: 74, size: 2.2, fontFamily: DEFAULT_FONT, bold: true, italic: false },
      { id: nextTextId++, content: "Nội dung dòng 2", html: "Nội dung dòng 2", x: 15, y: 80, size: 1.5, fontFamily: DEFAULT_FONT, bold: true, italic: false }
    ]
  };
  ltPresets.push(newPreset);
  activePresetId = newPreset.id;
  selectedTextId = null;
  savedSelectionRange = null;
  saveLtConfig();
  renderLtEditorUI();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', ...getActivePresetPayload() });
  }
};

window.duplicateLtPreset = function() {
  const current = getActivePreset();
  if (!current) return;

  const clonedTexts = current.texts.map(t => ({
    id: nextTextId++,
    content: t.content,
    html: t.html !== undefined ? t.html : escapeHTML(t.content),
    x: t.x,
    y: t.y,
    size: t.size,
    fontFamily: t.fontFamily || DEFAULT_FONT,
    bold: t.bold !== false,
    italic: Boolean(t.italic)
  }));

  const newPreset = {
    id: nextPresetId++,
    name: `${current.name} (Copy)`,
    videoType: current.videoType || 'lt1',
    clipLeft: current.clipLeft !== undefined ? current.clipLeft : 15,
    tickerSpeed: current.tickerSpeed !== undefined ? current.tickerSpeed : 12,
    texts: clonedTexts
  };
  ltPresets.push(newPreset);
  activePresetId = newPreset.id;
  selectedTextId = null;
  savedSelectionRange = null;
  saveLtConfig();
  renderLtEditorUI();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', ...getActivePresetPayload() });
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
  savedSelectionRange = null;
  saveLtConfig();
  renderLtEditorUI();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', ...getActivePresetPayload() });
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
      const tag = current.videoType === 'lt2' ? ' [LT2]' : '';
      chips[idx].innerText = `${newName || `Bộ ${idx + 1}`}${tag}`;
    }
  }
};

window.updateActivePresetVideo = function(videoType) {
  const current = getActivePreset();
  if (!current) return;
  current.videoType = videoType === 'lt2' ? 'lt2' : 'lt1';
  saveLtConfig();
  renderLtEditorUI();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', ...getActivePresetPayload() });
  }
};

window.updateActivePresetTicker = function(field, val) {
  const current = getActivePreset();
  if (!current) return;
  if (field === 'clipLeft') {
    current.clipLeft = Math.max(0, Math.min(85, Number(val) || 0));
    const clipGuide = document.getElementById('ltClipGuide');
    const clipGuideBadge = document.getElementById('ltClipGuideBadge');
    if (clipGuide) clipGuide.style.width = `${current.clipLeft}%`;
    if (clipGuideBadge) clipGuideBadge.innerText = `Cắt trái ${current.clipLeft}%`;
  } else if (field === 'tickerSpeed') {
    current.tickerSpeed = Math.max(2, Math.min(40, Number(val) || 12));
  }
  saveLtConfig();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', ...getActivePresetPayload() });
  }
};

// =========================================================================
// CÁC HÀM THAO TÁC KÉO THẢ & CHỈNH SỬA ĐA FONT TRONG BỘ HIỆN TẠI
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

const handleCanvasMouseMove = (e) => {
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
};

const handleCanvasMouseUp = () => {
  if (draggingId !== null) {
    draggingId = null;
    saveLtConfig();
    if (isLowerthirdActive) {
      sendCommand({ action: 'update_lowerthird_texts', ...getActivePresetPayload() });
    }
  }
};

function setupCanvasDragEvents() {
  const { signal } = uiAbortController;
  window.addEventListener('mousemove', handleCanvasMouseMove, { signal });
  window.addEventListener('mouseup', handleCanvasMouseUp, { signal });
}

window.addLtText = function() {
  const preset = getActivePreset();
  if (!preset) return;

  const defaultLabel = `Text mới ${preset.texts.length + 1}`;
  const newItem = {
    id: nextTextId++,
    content: defaultLabel,
    html: defaultLabel,
    x: preset.videoType === 'lt2' ? (preset.clipLeft || 15) + 2 : 15,
    y: Math.min(88, 68 + preset.texts.length * 6),
    size: 2.0,
    fontFamily: DEFAULT_FONT,
    bold: true,
    italic: false
  };
  preset.texts.push(newItem);
  selectedTextId = newItem.id;
  savedSelectionRange = null;
  saveLtConfig();
  renderLtEditorUI();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', ...getActivePresetPayload() });
  }
};

window.removeLtText = function() {
  if (selectedTextId === null) return;
  const preset = getActivePreset();
  if (!preset) return;

  preset.texts = preset.texts.filter(t => t.id !== selectedTextId);
  selectedTextId = null;
  savedSelectionRange = null;
  saveLtConfig();
  renderLtEditorUI();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', ...getActivePresetPayload() });
  }
};

window.applyFontFamilyToEditor = function(fontVal) {
  const ltTexts = getActiveTexts();
  const item = ltTexts.find(t => t.id === selectedTextId);
  if (!item) return;

  const cleanFont = (fontVal || '').trim() || DEFAULT_FONT;

  if (applyInlineStyleToSelection('fontFamily', cleanFont)) {
    return;
  }

  item.fontFamily = cleanFont;
  const richEditor = document.getElementById('ltRichEditor');
  if (richEditor) {
    richEditor.querySelectorAll('span').forEach(sp => { sp.style.fontFamily = ''; });
    richEditor.style.fontFamily = cleanFont;
    item.html = sanitizeRichHTML(richEditor.innerHTML);
  }

  const activeEl = document.querySelector(`.lt-draggable-text[data-id="${selectedTextId}"]`);
  if (activeEl) applyTextStyleToElement(activeEl, item);

  saveLtConfig();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', ...getActivePresetPayload() });
  }
};

window.handleFontSelectChange = function(val) {
  const customFontGroup = document.getElementById('ltCustomFontGroup');
  const customFontInput = document.getElementById('ltInputCustomFont');
  if (val === '__custom__') {
    if (customFontGroup) customFontGroup.style.display = 'flex';
    if (customFontInput) {
      customFontInput.disabled = false;
      customFontInput.focus();
    }
  } else {
    if (customFontGroup) customFontGroup.style.display = 'none';
    window.applyFontFamilyToEditor(val);
  }
};

window.toggleSelectedLtStyle = function(styleKey) {
  const ltTexts = getActiveTexts();
  const item = ltTexts.find(t => t.id === selectedTextId);
  if (!item) return;

  const btn = document.getElementById(styleKey === 'bold' ? 'ltBtnBold' : 'ltBtnItalic');
  const willActivate = btn ? !btn.classList.contains('active') : true;

  if (styleKey === 'bold') {
    if (applyInlineStyleToSelection('fontWeight', willActivate ? 'bold' : 'normal')) return;
    item.bold = willActivate;
  } else if (styleKey === 'italic') {
    if (applyInlineStyleToSelection('fontStyle', willActivate ? 'italic' : 'normal')) return;
    item.italic = willActivate;
  }

  const richEditor = document.getElementById('ltRichEditor');
  if (richEditor) {
    const prop = styleKey === 'bold' ? 'fontWeight' : 'fontStyle';
    richEditor.querySelectorAll('span').forEach(sp => { sp.style[prop] = ''; });
    richEditor.style.fontWeight = item.bold !== false ? 'bold' : 'normal';
    richEditor.style.fontStyle = item.italic ? 'italic' : 'normal';
    item.html = sanitizeRichHTML(richEditor.innerHTML);
  }

  const activeEl = document.querySelector(`.lt-draggable-text[data-id="${selectedTextId}"]`);
  if (activeEl) applyTextStyleToElement(activeEl, item);

  renderLtEditorUI();
  saveLtConfig();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', ...getActivePresetPayload() });
  }
};

window.updateSelectedLtText = function(field, val) {
  const ltTexts = getActiveTexts();
  const item = ltTexts.find(t => t.id === selectedTextId);
  if (!item) return;

  if (field === 'size') {
    item.size = Math.max(0.2, Number(val) || 1);
    const sizeLabel = document.getElementById('ltSizeVal');
    if (sizeLabel) sizeLabel.innerText = `${item.size}`;
  } else if (field === 'x') {
    item.x = Number(val) || 0;
  } else if (field === 'y') {
    item.y = Number(val) || 0;
  }

  const activeEl = document.querySelector(`.lt-draggable-text[data-id="${selectedTextId}"]`);
  if (activeEl) applyTextStyleToElement(activeEl, item);

  saveLtConfig();
  if (isLowerthirdActive) {
    sendCommand({ action: 'update_lowerthird_texts', ...getActivePresetPayload() });
  }
};

// =========================================================================
// 4. LOGIC NÚT BẤM INTRO CHUNG, LOWERTHIRD, INTRO VÒNG THI & TỔNG KẾT ĐIỂM
// =========================================================================
function flashButtonYellow(btn) {
  if (!btn) return;
  btn.classList.add('active');
  setTimeout(() => { btn.classList.remove('active'); }, 50);
}

function syncMainIntroBtnUI() {
  const btnIntro = document.getElementById('btnMainIntro');
  const qText = document.getElementById('quesText');
  if (btnIntro) {
    btnIntro.classList.toggle('is-running', isIntroActive);
    btnIntro.innerText = isIntroActive ? "ẨN INTRO" : "CHẠY INTRO";
  }
  if (qText) {
    qText.innerText = isIntroActive ? "INTRO: ON" : "INTRO: OFF";
    window.compressBadgeText('quesText');
  }
}

function syncMainLowerthirdBtnUI() {
  const btnLT = document.getElementById('btnMainLT');
  const tText = document.getElementById('timeText');
  if (btnLT) {
    btnLT.classList.toggle('is-running', isLowerthirdActive);
    btnLT.innerText = isLowerthirdActive ? "ẨN LOWERTHIRD" : "LOWERTHIRD";
  }
  if (tText) {
    tText.innerText = isLowerthirdActive ? "LOWERTHIRD: ON" : "LOWERTHIRD: OFF";
    window.compressBadgeText('timeText');
  }
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

window.toggleRoundIntro = function(btn, roundKey) {
  flashButtonYellow(btn);
  const fileName = `intro_${roundKey}.webm`;

  if (activeRoundIntro === roundKey) {
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

const unsubRoundIntroStatus = onValue(ref(db, 'games/round_intro_status'), (snapshot) => {
  const statusVal = snapshot.val();
  activeRoundIntro = (typeof statusVal === 'string' && statusVal) ? statusVal : null;
  syncRoundIntroButtonsUI();
});

const unsubMainIntroStatus = onValue(ref(db, 'games/main_intro_status'), (snapshot) => {
  const statusVal = Boolean(snapshot.val());
  if (isIntroActive !== statusVal) {
    isIntroActive = statusVal;
    syncMainIntroBtnUI();
  }
});

window.triggerMainIntro = function(btn) {
  flashButtonYellow(btn);

  if (!isIntroActive) {
    isIntroActive = true;
    syncMainIntroBtnUI();
    set(ref(db, 'games/main_intro_status'), true);
    sendCommand({ action: 'play_intro' });
  } else {
    isIntroActive = false;
    syncMainIntroBtnUI();
    set(ref(db, 'games/main_intro_status'), false);
    sendCommand({ action: 'hide_intro' });
  }
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
      ...getActivePresetPayload()
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

window.triggerPointSummary = function(btn) {
  flashButtonYellow(btn);

  if (isMatchResultActive) {
    isMatchResultActive = false;
    syncMatchResultBtnUI();
  }

  if (pointSummaryStep === 0) {
    pointSummaryOrder = buildSortedPlayers(latestPlayersData);
  }

  const nextStep = pointSummaryStep + 1;
  const orderedPlayers = buildOrderedPlayers(latestPlayersData);

  if (nextStep >= 6) {
    pointSummaryStep = 0;
    updatePointSummaryBtnUI();
    sendCommand({
      action: 'point_summary',
      step: 6,
      sortedPlayers: pointSummaryOrder,
      players: orderedPlayers
    });
    pointSummaryOrder = [];
  } else {
    pointSummaryStep = nextStep;
    updatePointSummaryBtnUI();
    sendCommand({
      action: 'point_summary',
      step: pointSummaryStep,
      sortedPlayers: pointSummaryOrder,
      players: orderedPlayers
    });
    if (pointSummaryStep === 1 && typeof window.playMusic === 'function') {
      window.playMusic('Main_PointSummary.mp3', false, false);
    }
  }
};

window.triggerMatchResult = function(btn) {
  flashButtonYellow(btn);

  if (!isMatchResultActive) {
    if (pointSummaryStep > 0) {
      pointSummaryStep = 0;
      pointSummaryOrder = [];
      updatePointSummaryBtnUI();
    }
    isMatchResultActive = true;
    syncMatchResultBtnUI();
    sendCommand({
      action: 'show_match_result',
      players: buildOrderedPlayers(latestPlayersData)
    });
  } else {
    isMatchResultActive = false;
    syncMatchResultBtnUI();
    sendCommand({
      action: 'hide_match_result'
    });
  }
};

window.triggerMainReset = function(btn) {
  flashButtonYellow(btn);
  isIntroActive = false;
  isLowerthirdActive = false;
  activeRoundIntro = null;
  pointSummaryStep = 0;
  pointSummaryOrder = [];
  isMatchResultActive = false;
  syncMainIntroBtnUI();
  syncRoundIntroButtonsUI();
  updatePointSummaryBtnUI();
  syncMatchResultBtnUI();

  const btnLT = document.getElementById('btnMainLT');
  const tText = document.getElementById('timeText');

  if (btnLT) {
    btnLT.classList.remove('is-running');
    btnLT.innerText = "LOWERTHIRD";
  }
  if (tText) tText.innerText = "LOWERTHIRD: OFF";
  window.compressBadgeText('timeText');

  set(ref(db, 'games/main_intro_status'), false);
  set(ref(db, 'games/round_intro_status'), null);
  set(ref(db, 'games/round_intro'), {
    action: 'hide',
    timestamp: Date.now()
  });
  sendCommand({ action: 'reset_main_graphic' });
};

const unsubPlayers = onValue(ref(db, 'games/players'), (snapshot) => {
  const players = snapshot.exists() ? (snapshot.val() || {}) : {};
  latestPlayersData = players;
  const modal = document.getElementById('configModal');
  const isMainModalOpen = modal && modal.style.display === 'flex' && modal.dataset.mode === 'MAIN';

  for (let i = 1; i <= 4; i++) {
    const p = players[i] || {};

    if (p.info === undefined && !initializedPlayerInfoFlags[i]) {
      initializedPlayerInfoFlags[i] = true;
      update(ref(db, `games/players/${i}`), { info: '' });
    }

    if (players[i]) {
      const spanEl = document.getElementById(`playerBtnText-${i}`);
      if (spanEl) {
        spanEl.innerText = `${players[i].name} (${players[i].score})`;
        window.compressBadgeText(`playerBtnText-${i}`);
      }

      const nameEl = document.getElementById(`playerBtnName-${i}`);
      const scoreEl = document.getElementById(`playerBtnScore-${i}`);
      if (nameEl) nameEl.innerText = players[i].name ?? `P${i}`;
      if (scoreEl) scoreEl.innerText = players[i].score ?? 0;

      const scoreInput = document.getElementById(`config-score-${i}`);
      const nameLabel = document.getElementById(`config-name-${i}`);
      if (scoreInput && document.activeElement !== scoreInput) scoreInput.value = players[i].score;
      if (nameLabel && document.activeElement !== nameLabel) {
        nameLabel.innerText = players[i].name;
        window.compressConfigName(i);
      }

      if (isMainModalOpen) {
        const mName = document.getElementById(`mainCfgName-${i}`);
        const mFullName = document.getElementById(`mainCfgFullName-${i}`);
        const mScore = document.getElementById(`mainCfgScore-${i}`);
        const mInfo = document.getElementById(`mainCfgInfo-${i}`);
        const mAvatarImg = document.getElementById(`mainCfgAvatarImg-${i}`);
        const mAvatarStatus = document.getElementById(`mainCfgAvatarStatus-${i}`);

        if (mName && document.activeElement !== mName) mName.value = players[i].name ?? '';
        if (mFullName && document.activeElement !== mFullName) mFullName.value = players[i].fullName ?? '';
        if (mScore && document.activeElement !== mScore) mScore.value = players[i].score ?? 0;
        if (mInfo && document.activeElement !== mInfo) mInfo.value = players[i].info ?? '';
        if (mAvatarImg && activeStorageUploads === 0) {
          setPlayerAvatarPreviewFallback(mAvatarImg, i, players[i].avatarUrl || '');
        }
        if (mAvatarStatus && activeStorageUploads === 0) {
          mAvatarStatus.innerText = players[i].avatarUrl ? 'Đã lưu Storage' : 'Ảnh mặc định';
        }
      }
    }
  }
});

window.addEventListener('resize', applyMainDialogDprScale, { signal: uiAbortController.signal });

window.cleanupCurrentRound = function() {
  unsubProjectorBg();
  unsubGameThumbnails();
  unsubGameThumbnailsMeta();
  unsubAudioVolume();
  unsubRoundIntroStatus();
  unsubMainIntroStatus();
  unsubPlayers();

  uiAbortController.abort();

  const modal = document.getElementById('configModal');
  if (modal && modal.dataset.mode === 'MAIN') {
    modal.style.display = 'none';
  }
  restoreDefaultConfigModalContent();
  restoreOtherRoundPanelsInGrid();

  window.openConfig = previousWindowHandlers.openConfig;
  window.closeConfig = previousWindowHandlers.closeConfig;
  window.updateNameDB = previousWindowHandlers.updateNameDB;
  window.updateScoreDB = previousWindowHandlers.updateScoreDB;
  window.compressConfigName = previousWindowHandlers.compressConfigName;
  if (previousWindowHandlers.compressBadgeText) {
    window.compressBadgeText = previousWindowHandlers.compressBadgeText;
  }
};

renderMainWorkspace();