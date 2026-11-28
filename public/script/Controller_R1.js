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

let serverTimeOffset = 0;
const unsubServerOffset = onValue(ref(db, ".info/serverTimeOffset"), (snapshot) => {
  if (snapshot.exists()) {
    serverTimeOffset = Number(snapshot.val()) || 0;
  }
});

function getServerNow() {
  return Date.now() + serverTimeOffset;
}

const channel = {
  postMessage: function(data) {
    return update(ref(db, 'games/commands'), {
      ...data,
      timestamp: getServerNow()
    });
  }
};

let currentQuesIndex = 1;
let round1Questions = [];
let globalPlayers = {};
let activePlayerIndex = null;
let isWaitBgShown = false;
let isGraphicShown = false;
let isPlayersShown = false;
let isQuestionShown = false;
let ctrlTimerInterval = null;
let isTimer5sRunning = false;
let currentTurnTime = -1;
let currentRemainingTime = -1;
let isTurnTimePlaying = false;
let turnTimerInterval = null;
let lr_config = { so_luot: 4, so_cau: 6, thoi_gian: -1, diem_dung: 10, diem_sai: 0 };
let lc_configs = [{ so_cau: 12, thoi_gian: -1, diem_dung: 10, diem_sai: -5 }];
let round1EventsController = null;

let isBuzzerEnabled = false;
let buzzerOpenedAt = null;
let lastHandledBuzzTimestamp = 0;
let playerBuzzTimes = {};

let turnTimerStartTimestamp = null;
let turnTimerStartRemaining = -1;
let timer5sStartTimestamp = null;

function renderBuzzerLockButtonUI() {
  const btn = document.getElementById('btn-toggle-buzzer');
  if (!btn) return;
  if (isBuzzerEnabled) {
    btn.textContent = 'CHUÔNG: MỞ';
    btn.classList.remove('buzzer-locked');
    btn.classList.add('buzzer-open');
  } else {
    btn.textContent = 'CHUÔNG: KHÓA';
    btn.classList.remove('buzzer-open');
    btn.classList.add('buzzer-locked');
  }
}

function renderPlayerBuzzTimesUI() {
  for (let i = 1; i <= 4; i++) {
    const timeEl = document.getElementById(`playerBtnBuzzTime-${i}`);
    if (!timeEl) continue;
    const sec = playerBuzzTimes[i];
    if (typeof sec === 'number' && !isNaN(sec)) {
      timeEl.textContent = `${sec.toFixed(2)}s`;
    } else {
      timeEl.textContent = '';
    }
  }
}

function resetRound1BuzzerDB(keepEnabled = isBuzzerEnabled) {
  const now = getServerNow();
  isBuzzerEnabled = Boolean(keepEnabled);
  buzzerOpenedAt = isBuzzerEnabled ? now : null;
  lastHandledBuzzTimestamp = Math.max(lastHandledBuzzTimestamp, now);
  playerBuzzTimes = {};
  renderBuzzerLockButtonUI();
  renderPlayerBuzzTimesUI();

  return set(ref(db, 'games/round_1_buzzer'), {
    enabled: isBuzzerEnabled,
    openedAt: buzzerOpenedAt,
    locked: false,
    playerIndex: null,
    playerName: "",
    buzzTimeSec: null,
    quesIndex: currentQuesIndex,
    timestamp: now
  });
}

function toggleBuzzerLock() {
  const now = getServerNow();
  isBuzzerEnabled = !isBuzzerEnabled;
  lastHandledBuzzTimestamp = Math.max(lastHandledBuzzTimestamp, now);
  renderBuzzerLockButtonUI();

  if (isBuzzerEnabled) {
    // Mở chuông -> Xóa trạng thái chuông cũ và bắt đầu tính thời gian từ 0.00s
    buzzerOpenedAt = now;
    playerBuzzTimes = {};
    renderPlayerBuzzTimesUI();

    document.querySelectorAll('.player-vertical-card').forEach(b => b.classList.remove('is-turn'));
    activePlayerIndex = null;
    channel.postMessage({ action: 'reset_buzzers', activePlayerIndex: null });

    set(ref(db, 'games/round_1_buzzer'), {
      enabled: true,
      openedAt: now,
      locked: false,
      playerIndex: null,
      playerName: "",
      buzzTimeSec: null,
      quesIndex: currentQuesIndex,
      timestamp: now
    });
  } else {
    // Khóa chuông -> Chỉ cập nhật trạng thái enabled/openedAt, không kích hoạt sự kiện bấm chuông
    buzzerOpenedAt = null;
    update(ref(db, 'games/round_1_buzzer'), {
      enabled: false,
      openedAt: null
    });
  }

  syncRound1StateToDB();
}

function syncRound1StateToDB() {
  const qText =
    isQuestionShown && round1Questions && round1Questions[currentQuesIndex]
      ? round1Questions[currentQuesIndex].cau_hoi
      : "";

  return set(ref(db, 'games/r1_state'), {
    currentQuesIndex,
    isQuestionShown,
    questionText: qText,
    activePlayerIndex,
    turnTime: currentTurnTime,
    remainingTime: currentRemainingTime,
    isTurnTimePlaying,
    timerStartedAt: isTurnTimePlaying ? turnTimerStartTimestamp : null,
    timerStartRemaining: isTurnTimePlaying ? turnTimerStartRemaining : null,
    isTimer5sRunning,
    timer5sStartedAt: isTimer5sRunning ? timer5sStartTimestamp : null,
    updatedAt: getServerNow()
  });
}

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

function createLuotChungConfigItem(labelText, inputId, value, titleText) {
  const item = document.createElement('div');
  item.className = 'config-item';

  const label = document.createElement('label');
  label.htmlFor = inputId;
  label.textContent = labelText;

  const input = document.createElement('input');
  input.type = 'number';
  input.id = inputId;
  input.value = value;
  if (titleText) {
    input.title = titleText;
  }

  item.appendChild(label);
  item.appendChild(input);
  return item;
}

window.renderLuotChungConfigs = function() {
  const num = parseInt(document.getElementById('numLuotChung')?.value, 10) || 0;
  const listContainer = document.getElementById('luotChungList');
  if (!listContainer) return;

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < num; i++) {
    const conf = lc_configs[i] || { so_cau: 12, thoi_gian: -1, diem_dung: 10, diem_sai: -5 };

    const group = document.createElement('div');
    group.className = 'lc-config-item-group';

    const title = document.createElement('div');
    title.className = 'config-group-title lc-config-item-title';
    title.textContent = `# Lượt Chung ${i + 1}`;

    const grid = document.createElement('div');
    grid.className = 'config-grid config-grid-compact';

    grid.appendChild(createLuotChungConfigItem('Số Câu', `lc_socau_${i}`, conf.so_cau));
    grid.appendChild(createLuotChungConfigItem('Thời gian (s)', `lc_thoigian_${i}`, conf.thoi_gian, '-1 là vô hạn'));
    grid.appendChild(createLuotChungConfigItem('Điểm Đúng', `lc_diemdung_${i}`, conf.diem_dung));
    grid.appendChild(createLuotChungConfigItem('Điểm Sai', `lc_diemsai_${i}`, conf.diem_sai));

    group.appendChild(title);
    group.appendChild(grid);
    fragment.appendChild(group);
  }

  listContainer.replaceChildren(fragment);
  window.updateTurnStatusOptions();
};

window.updateTurnStatusOptions = function() {
  const numLC = parseInt(document.getElementById('numLuotChung')?.value, 10) || 0;
  const lrInput = document.getElementById('lr_soluot');
  const numLR = lrInput ? (parseInt(lrInput.value, 10) || 4) : (lr_config.so_luot || 4);
  const select = document.getElementById('turnStatus');
  if (!select) return;

  const currentVal = select.value;
  const fragment = document.createDocumentFragment();

  for (let i = 1; i <= numLR; i++) {
    const opt = document.createElement('option');
    opt.value = `rieng_${i}`;
    opt.textContent = `Lượt riêng ${i}`;
    fragment.appendChild(opt);
  }
  for (let i = 0; i < numLC; i++) {
    const opt = document.createElement('option');
    opt.value = `chung_${i}`;
    opt.textContent = `Lượt chung ${i + 1}`;
    fragment.appendChild(opt);
  }

  select.replaceChildren(fragment);
  if (select.querySelector(`option[value="${currentVal}"]`)) {
    select.value = currentVal;
  }
};

function getTurnSignature(quesIndex) {
  let LR_Count = parseInt(lr_config.so_luot, 10);
  if (isNaN(LR_Count)) LR_Count = 4;
  const A = parseInt(lr_config.so_cau, 10) || 0;

  if (A > 0 && LR_Count > 0 && quesIndex <= (LR_Count * A)) {
    return `rieng_${Math.ceil(quesIndex / A)}`;
  }
  return 'chung';
}

window.jumpToTurn = function(val) {
  const prevTurnSig = getTurnSignature(currentQuesIndex);
  const LR_Count = parseInt(lr_config.so_luot, 10) || 4;
  const A = parseInt(lr_config.so_cau, 10) || 0;

  if (val.startsWith('rieng_')) {
    const pIdx = parseInt(val.split('_')[1], 10);
    currentQuesIndex = A > 0 ? (pIdx - 1) * A + 1 : 1;
  } else if (val.startsWith('chung_')) {
    const lcIdx = parseInt(val.split('_')[1], 10);
    let startIndex = (LR_Count * A) + 1;
    for (let i = 0; i < lcIdx; i++) {
      startIndex += parseInt(lc_configs[i]?.so_cau || 0, 10);
    }
    currentQuesIndex = startIndex;
  }

  if (getTurnSignature(currentQuesIndex) !== prevTurnSig) {
    activePlayerIndex = null;
    document.querySelectorAll('.player-vertical-card').forEach(b => b.classList.remove('is-turn'));
  }

  updateQAPreview();
  resetRound1BuzzerDB(isBuzzerEnabled);
  channel.postMessage({ action: 'reset_buzzers', activePlayerIndex });
  if (isQuestionShown && round1Questions && round1Questions[currentQuesIndex]) {
    channel.postMessage({
      action: 'show_question',
      text: round1Questions[currentQuesIndex].cau_hoi,
      quesIndex: currentQuesIndex
    });
  }
  syncRound1StateToDB();
};

function updateQAPreview() {
  const previewQues = document.getElementById('preview-question');
  const previewAns = document.getElementById('preview-answer');

  const nextQuesText = (round1Questions && round1Questions[currentQuesIndex])
    ? round1Questions[currentQuesIndex].cau_hoi
    : "...";
  const nextAnsText = (round1Questions && round1Questions[currentQuesIndex])
    ? round1Questions[currentQuesIndex].dap_an
    : "...";

  if (previewQues && previewQues.innerText !== nextQuesText) {
    previewQues.innerText = nextQuesText;
    previewQues.scrollTop = 0;
  }
  if (previewAns && previewAns.innerText !== nextAnsText) {
    previewAns.innerText = nextAnsText;
    previewAns.scrollTop = 0;
  }

  let LR_Count = parseInt(lr_config.so_luot, 10);
  if (isNaN(LR_Count)) LR_Count = 4;
  const A = parseInt(lr_config.so_cau, 10) || 0;

  let turnName = "";
  let relativeQues = 0;
  let totalTurnQues = 0;
  let turnTime = -1;

  if (A > 0 && LR_Count > 0 && currentQuesIndex <= (LR_Count * A)) {
    const playerIndex = Math.ceil(currentQuesIndex / A);
    turnName = `LƯỢT RIÊNG ${playerIndex}`;
    relativeQues = currentQuesIndex - ((playerIndex - 1) * A);
    totalTurnQues = A;
    turnTime = lr_config.thoi_gian;

    const statusSelect = document.getElementById('turnStatus');
    if (statusSelect && statusSelect.value !== `rieng_${playerIndex}`) {
      statusSelect.value = `rieng_${playerIndex}`;
    }
  } else if (lc_configs && lc_configs.length > 0) {
    let remainingIndex = currentQuesIndex - ((A > 0 && LR_Count > 0) ? (LR_Count * A) : 0);
    let foundLC = false;

    for (let i = 0; i < lc_configs.length; i++) {
      const B = parseInt(lc_configs[i].so_cau, 10) || 0;
      if (B > 0 && remainingIndex <= B) {
        turnName = `LƯỢT CHUNG ${i + 1}`;
        relativeQues = remainingIndex;
        totalTurnQues = B;
        turnTime = lc_configs[i].thoi_gian;
        foundLC = true;

        const statusSelect = document.getElementById('turnStatus');
        if (statusSelect && statusSelect.value !== `chung_${i}`) {
          statusSelect.value = `chung_${i}`;
        }
        break;
      } else {
        remainingIndex -= B;
      }
    }
    if (!foundLC) {
      turnName = "LƯỢT RIÊNG 0";
      relativeQues = 0;
      totalTurnQues = 0;
    }
  } else {
    turnName = "LƯỢT ...";
    relativeQues = 0;
    totalTurnQues = 0;
  }

  const timeStr = (turnTime === -1 || turnTime === undefined) ? "VÔ HẠN" : `${Number(turnTime).toFixed(1)}s`;
  const roundSpan = document.getElementById('roundText');
  const quesSpan = document.getElementById('quesText');
  const timeSpan = document.getElementById('timeText');

  if (roundSpan) roundSpan.innerText = turnName;
  if (quesSpan) quesSpan.innerText = (totalTurnQues > 0) ? `CÂU HỎI ${relativeQues}/${totalTurnQues}` : "HẾT CÂU HỎI";
  if (timeSpan) timeSpan.innerText = `THỜI GIAN: ${timeStr}`;

  if (!isTurnTimePlaying) {
    currentTurnTime = turnTime;
    if (currentRemainingTime === -1 || currentRemainingTime <= 0 || currentTurnTime !== turnTime) {
      currentRemainingTime = turnTime;
    }

    let displayTimeStr = "VÔ HẠN";
    if (currentRemainingTime !== -1 && currentRemainingTime !== undefined) {
      displayTimeStr = (currentRemainingTime > 0) ? `${Number(currentRemainingTime).toFixed(1)}s` : "0.00s";
    }
    if (timeSpan) timeSpan.innerText = `THỜI GIAN: ${displayTimeStr}`;
  } else {
    currentTurnTime = turnTime;
  }

  const btnPlayTime = document.getElementById('btnPlayPauseTime');
  const btnResetTime = document.getElementById('btnResetTime');
  if (btnPlayTime && btnResetTime) {
    if (turnTime !== -1 && turnTime !== undefined) {
      btnPlayTime.style.display = 'inline-block';
      btnResetTime.style.display = 'inline-block';
      btnPlayTime.innerText = isTurnTimePlaying ? '⏸' : '▶';
    } else {
      btnPlayTime.style.display = 'none';
      btnResetTime.style.display = 'none';
    }
  }

  window.compressBadgeText('roundText');
  window.compressBadgeText('quesText');
  window.compressBadgeText('timeText');
}

function isCommonQuestion(questionIndex) {
  const LR_Count = parseInt(lr_config.so_luot, 10) || 0;
  const individualQuestionCount = parseInt(lr_config.so_cau, 10) || 0;
  let remainingIndex = questionIndex - (individualQuestionCount > 0 && LR_Count > 0 ? LR_Count * individualQuestionCount : 0);

  if (remainingIndex <= 0) return false;

  for (const config of lc_configs) {
    const questionCount = parseInt(config.so_cau, 10) || 0;
    if (questionCount > 0 && remainingIndex <= questionCount) return true;
    remainingIndex -= questionCount;
  }

  return false;
}

window.triggerAction = function(btn, keyStr) {
  const btnWaitBg = document.getElementById('btn-wait-bg');
  const btnGraphic = document.getElementById('btn-graphic');
  const btnPlayers = document.getElementById('btn-players');
  const btnQuestion = document.getElementById('btn-question');
  const isFromPlayerBuzz = btn?.dataset?.fromPlayerBuzz === '1';

  if (btn) {
    btn.classList.add('active');
    setTimeout(() => {
      btn.classList.remove('active');
    }, 50);
  }

  if (keyStr === 'tb') {
    toggleBuzzerLock();
    return;
  }

  if (keyStr >= '1' && keyStr <= '6') {
    document.querySelectorAll('.player-vertical-card').forEach(b => b.classList.remove('is-turn'));
    const targetBtn = document.getElementById(`playerBtn-${keyStr}`);
    if (targetBtn) targetBtn.classList.add('is-turn');
    activePlayerIndex = parseInt(keyStr, 10);
    isPlayersShown = true;
    if (btnPlayers) btnPlayers.classList.remove('dimmed');
  } else if (keyStr === '0') {
    document.querySelectorAll('.player-vertical-card').forEach(b => b.classList.remove('is-turn'));
    activePlayerIndex = null;
    isPlayersShown = !isPlayersShown;
  } else if (keyStr === 'rb') {
    document.querySelectorAll('.player-vertical-card').forEach(b => b.classList.remove('is-turn'));
    activePlayerIndex = null;
    resetRound1BuzzerDB(isBuzzerEnabled);
  } else if (keyStr === 'r') {
    document.querySelectorAll('.player-vertical-card').forEach(b => b.classList.remove('is-turn'));
    activePlayerIndex = null;
    isWaitBgShown = false;
    isPlayersShown = false;
    isGraphicShown = false;
    isQuestionShown = false;
    if (btnWaitBg) btnWaitBg.classList.add('dimmed');
    if (btnGraphic) btnGraphic.classList.add('dimmed');
    if (btnPlayers) btnPlayers.classList.add('dimmed');
    if (btnQuestion) btnQuestion.classList.add('dimmed');

    channel.postMessage({ action: 'stop_turn_time' });
    isTurnTimePlaying = false;
    if (turnTimerInterval) clearInterval(turnTimerInterval);
    const btnPlayTime = document.getElementById('btnPlayPauseTime');
    if (btnPlayTime) btnPlayTime.innerText = '▶';
    currentRemainingTime = currentTurnTime;
    resetRound1BuzzerDB(false);
  }

  // Chỉ phát âm thanh bấm chuông khi thí sinh thực sự bấm chuông trên màn Player
  if (
    keyStr >= '1' &&
    keyStr <= '6' &&
    isFromPlayerBuzz &&
    isCommonQuestion(currentQuesIndex)
  ) {
    if (typeof window.playMusic === 'function') {
      window.playMusic('R1_Buzzed.mp3');
    }
  }

  if (keyStr === 'p') {
    if (currentQuesIndex > 1) {
      const prevTurnSig = getTurnSignature(currentQuesIndex);
      currentQuesIndex--;
      if (getTurnSignature(currentQuesIndex) !== prevTurnSig) {
        activePlayerIndex = null;
        document.querySelectorAll('.player-vertical-card').forEach(b => b.classList.remove('is-turn'));
      }
      updateQAPreview();
      resetRound1BuzzerDB(isBuzzerEnabled);
      channel.postMessage({ action: 'reset_buzzers', activePlayerIndex });
    }
  } else if (keyStr === 'n') {
    const prevTurnSig = getTurnSignature(currentQuesIndex);
    currentQuesIndex++;
    if (getTurnSignature(currentQuesIndex) !== prevTurnSig || isCommonQuestion(currentQuesIndex)) {
      activePlayerIndex = null;
      document.querySelectorAll('.player-vertical-card').forEach(b => b.classList.remove('is-turn'));
    }
    updateQAPreview();
    resetRound1BuzzerDB(isBuzzerEnabled);
    channel.postMessage({ action: 'reset_buzzers', activePlayerIndex });
  }

  if (keyStr === 'w') {
    isWaitBgShown = !isWaitBgShown;
    if (isWaitBgShown) {
      channel.postMessage({ action: 'show_wait_bg' });
      if (btnWaitBg) btnWaitBg.classList.remove('dimmed');
    } else {
      channel.postMessage({ action: 'hide_wait_bg' });
      if (btnWaitBg) btnWaitBg.classList.add('dimmed');
    }
  }

  if (keyStr === 's') {
    isGraphicShown = !isGraphicShown;
    if (isGraphicShown) {
      channel.postMessage({
        action: 'show_graphic',
        isTimeLimited: (currentTurnTime !== -1 && currentTurnTime !== undefined)
      });
      if (btnGraphic) btnGraphic.classList.remove('dimmed');
    } else {
      channel.postMessage({ action: 'hide_graphic' });
      if (btnGraphic) btnGraphic.classList.add('dimmed');
    }
  } else if (keyStr === '0') {
    if (isPlayersShown) {
      channel.postMessage({ action: 'show_players', players: globalPlayers });
      if (btnPlayers) btnPlayers.classList.remove('dimmed');
    } else {
      channel.postMessage({ action: 'hide_players' });
      if (btnPlayers) btnPlayers.classList.add('dimmed');
    }
  } else if (keyStr >= '1' && keyStr <= '6') {
    channel.postMessage({
      action: 'active_player',
      index: parseInt(keyStr, 10),
      players: globalPlayers
    });
  } else if (keyStr === 'q') {
    isQuestionShown = !isQuestionShown;
    if (isQuestionShown) {
      if (round1Questions && round1Questions[currentQuesIndex]) {
        channel.postMessage({
          action: 'show_question',
          text: round1Questions[currentQuesIndex].cau_hoi,
          quesIndex: currentQuesIndex
        });
      }
      if (btnQuestion) btnQuestion.classList.remove('dimmed');
    } else {
      channel.postMessage({ action: 'hide_question' });
      if (btnQuestion) btnQuestion.classList.add('dimmed');
    }
  } else if (keyStr === 'n' || keyStr === 'p') {
    if (isQuestionShown && round1Questions && round1Questions[currentQuesIndex]) {
      channel.postMessage({
        action: 'show_question',
        text: round1Questions[currentQuesIndex].cau_hoi,
        quesIndex: currentQuesIndex
      });
    }
  } else if (keyStr === 'r') {
    channel.postMessage({ action: 'reset_graphic' });
  } else if (keyStr === 'rb') {
    channel.postMessage({ action: 'reset_buzzers', activePlayerIndex: null });
  } else if (keyStr === 't5') {
    const timerBtn = document.getElementById('timer5s-display');
    if (isTimer5sRunning) {
      channel.postMessage({ action: 'stop_5s' });
      if (ctrlTimerInterval) clearInterval(ctrlTimerInterval);
      isTimer5sRunning = false;
      timer5sStartTimestamp = null;
      if (timerBtn) {
        timerBtn.innerText = '5';
        timerBtn.classList.remove('running');
      }
    } else {
      timer5sStartTimestamp = getServerNow();
      channel.postMessage({ action: 'start_5s' });
      isTimer5sRunning = true;
      if (ctrlTimerInterval) clearInterval(ctrlTimerInterval);

      let timeLeft = 5;
      if (timerBtn) {
        timerBtn.innerText = timeLeft;
        timerBtn.classList.add('running');
      }

      ctrlTimerInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
          if (timerBtn) timerBtn.innerText = timeLeft;
        } else {
          if (timerBtn) {
            timerBtn.innerText = '0';
            timerBtn.classList.remove('running');
          }
          clearInterval(ctrlTimerInterval);
          isTimer5sRunning = false;
          timer5sStartTimestamp = null;
          syncRound1StateToDB();
          setTimeout(() => {
            if (!isTimer5sRunning && timerBtn) timerBtn.innerText = '5';
          }, 1500);
        }
      }, 1000);
    }
  }

  syncRound1StateToDB();
};

window.resetTurnTime = function() {
  if (currentTurnTime === -1 || currentTurnTime === undefined) return;
  if (isTurnTimePlaying) {
    clearInterval(turnTimerInterval);
    isTurnTimePlaying = false;
    turnTimerStartTimestamp = null;
    turnTimerStartRemaining = -1;
    const btnPlayTime = document.getElementById('btnPlayPauseTime');
    if (btnPlayTime) btnPlayTime.innerText = '▶';
  }
  currentRemainingTime = currentTurnTime;
  const timeSpan = document.getElementById('timeText');
  if (timeSpan) {
    timeSpan.innerText = `THỜI GIAN: ${currentRemainingTime.toFixed(1)}s`;
    window.compressBadgeText('timeText');
  }
  syncRound1StateToDB();
};

window.toggleTurnTime = function() {
  if (currentTurnTime === -1 || currentTurnTime === undefined) return;
  const btn = document.getElementById('btnPlayPauseTime');
  const timeSpan = document.getElementById('timeText');
  let isRestarting = false;

  if (currentRemainingTime <= 0 || currentRemainingTime === currentTurnTime) {
    currentRemainingTime = currentTurnTime;
    isRestarting = true;
  }

  isTurnTimePlaying = !isTurnTimePlaying;
  if (isTurnTimePlaying) {
    if (btn) btn.innerText = '⏸';
    channel.postMessage({ action: 'play_turn_time', duration: currentTurnTime, restart: isRestarting });

    const startTime = Date.now();
    const startRemaining = currentRemainingTime;
    turnTimerStartTimestamp = getServerNow();
    turnTimerStartRemaining = startRemaining;

    if (turnTimerInterval) clearInterval(turnTimerInterval);
    turnTimerInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      currentRemainingTime = startRemaining - elapsed;

      if (currentRemainingTime > 0) {
        if (timeSpan) timeSpan.innerText = `THỜI GIAN: ${currentRemainingTime.toFixed(1)}s`;
      } else {
        currentRemainingTime = 0;
        if (timeSpan) timeSpan.innerText = 'HẾT GIỜ';
        clearInterval(turnTimerInterval);
        isTurnTimePlaying = false;
        turnTimerStartTimestamp = null;
        turnTimerStartRemaining = -1;
        if (btn) btn.innerText = '▶';
        channel.postMessage({ action: 'time_out' });
        syncRound1StateToDB();
      }
      window.compressBadgeText('timeText');
    }, 50);
  } else {
    if (btn) btn.innerText = '▶';
    channel.postMessage({ action: 'pause_turn_time' });
    if (turnTimerInterval) clearInterval(turnTimerInterval);
    turnTimerStartTimestamp = null;
    turnTimerStartRemaining = -1;
  }

  syncRound1StateToDB();
};

window.triggerScore = function(btn, type) {
  if (btn) {
    btn.classList.add('active');
    setTimeout(() => {
      btn.classList.remove('active');
    }, 500);
  }

  if (!activePlayerIndex) {
    return;
  }

  const selectVal = document.getElementById('turnStatus').value;
  let dDung = 0;
  let dSai = 0;

  if (selectVal.startsWith('rieng')) {
    dDung = Number(document.getElementById('lr_diemdung').value);
    dSai = Number(document.getElementById('lr_diemsai').value);
  } else if (selectVal.startsWith('chung_')) {
    const idx = parseInt(selectVal.split('_')[1], 10);
    dDung = Number(document.getElementById(`lc_diemdung_${idx}`).value);
    dSai = Number(document.getElementById(`lc_diemsai_${idx}`).value);
  }

  const delta = (type === 'add') ? dDung : dSai;
  if (typeof window.updateScoreByIndex === 'function') {
    window.updateScoreByIndex(activePlayerIndex, delta);
  } else {
    const currentScore = globalPlayers[activePlayerIndex]?.score || 0;
    window.updateScoreDB(activePlayerIndex, currentScore + delta);
  }

  if (typeof window.playMusic === 'function') {
    window.playMusic(type === 'add' ? 'R1_Right.mp3' : 'R1_Wrong.mp3');
  }
  console.log(`Đã ${type === 'add' ? 'cộng' : 'trừ'} ${Math.abs(delta)} điểm cho P${activePlayerIndex}`);
};

window.openConfig = function() {
  const configModal = document.getElementById('configModal');
  if (configModal) configModal.style.display = 'flex';
  setTimeout(() => {
    for (let i = 1; i <= 4; i++) window.compressConfigName(i);
  }, 50);
};

window.closeConfig = function() {
  const configModal = document.getElementById('configModal');
  if (configModal) configModal.style.display = 'none';
};

window.saveRoundConfig = function() {
  const numLC = parseInt(document.getElementById('numLuotChung').value, 10) || 0;
  const lc_arr = [];
  for (let i = 0; i < numLC; i++) {
    lc_arr.push({
      so_cau: Number(document.getElementById(`lc_socau_${i}`).value),
      diem_dung: Number(document.getElementById(`lc_diemdung_${i}`).value),
      diem_sai: Number(document.getElementById(`lc_diemsai_${i}`).value),
      thoi_gian: Number(document.getElementById(`lc_thoigian_${i}`).value)
    });
  }

  const round1Config = {
    luot_rieng: {
      so_luot: document.getElementById('lr_soluot') ? Number(document.getElementById('lr_soluot').value) : 4,
      so_cau: Number(document.getElementById('lr_socau').value),
      diem_dung: Number(document.getElementById('lr_diemdung').value),
      diem_sai: Number(document.getElementById('lr_diemsai').value),
      thoi_gian: Number(document.getElementById('lr_thoigian').value)
    },
    luot_chung: lc_arr
  };

  update(ref(db, 'games/round_1'), round1Config).then(() => {
    console.log("Đã lưu cấu hình vòng Khởi động linh hoạt!");
    window.closeConfig();
  });
};

function bindRound1Events() {
  if (round1EventsController) {
    round1EventsController.abort();
  }
  round1EventsController = new AbortController();
  const { signal } = round1EventsController;

  const btnResetTime = document.getElementById('btnResetTime');
  if (btnResetTime) {
    btnResetTime.addEventListener('click', window.resetTurnTime, { signal });
  }

  const btnPlayPauseTime = document.getElementById('btnPlayPauseTime');
  if (btnPlayPauseTime) {
    btnPlayPauseTime.addEventListener('click', window.toggleTurnTime, { signal });
  }

  document.querySelectorAll('#round1-ui [data-action]').forEach(el => {
    el.addEventListener('click', () => {
      window.triggerAction(el, el.dataset.action);
    }, { signal });
  });

  const btnBlankMusic = document.getElementById('btn-blank-music');
  if (btnBlankMusic) {
    btnBlankMusic.addEventListener('click', () => {
      if (typeof window.playMusic === 'function') {
        window.playMusic('Main_Blanks.mp3', false, false);
      }
    }, { signal });
  }

  document.querySelectorAll('#round1-ui [data-score-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      window.triggerScore(btn, btn.dataset.scoreType);
    }, { signal });
  });

  document.querySelectorAll('#round1-ui .player-vertical-card[data-player-turn]').forEach(card => {
    card.addEventListener('click', () => {
      window.triggerAction(card, card.dataset.playerTurn);
    }, { signal });
  });

  const closeConfigBtn = document.getElementById('closeR1ConfigBtn');
  if (closeConfigBtn) {
    closeConfigBtn.addEventListener('click', window.closeConfig, { signal });
  }

  const turnStatus = document.getElementById('turnStatus');
  if (turnStatus) {
    turnStatus.addEventListener('change', (e) => {
      window.jumpToTurn(e.target.value);
    }, { signal });
  }

  const numLuotChung = document.getElementById('numLuotChung');
  if (numLuotChung) {
    numLuotChung.addEventListener('change', window.renderLuotChungConfigs, { signal });
  }

  document.querySelectorAll('#configModal .player-score-name[data-player-index]').forEach(nameEl => {
    const idx = Number(nameEl.dataset.playerIndex);
    nameEl.addEventListener('input', () => window.compressConfigName(idx), { signal });
    nameEl.addEventListener('blur', () => window.updateNameDB(idx, nameEl.innerText), { signal });
  });

  document.querySelectorAll('#configModal .player-score-input[data-player-index]').forEach(scoreEl => {
    const idx = Number(scoreEl.dataset.playerIndex);
    scoreEl.addEventListener('change', () => window.updateScoreDB(idx, scoreEl.value), { signal });
  });

  const saveConfigBtn = document.getElementById('saveR1ConfigBtn');
  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', window.saveRoundConfig, { signal });
  }
}

const unsubPlayers = onValue(ref(db, 'games/players'), (snapshot) => {
  if (snapshot.exists()) {
    globalPlayers = snapshot.val();
    const players = snapshot.val();

    for (let i = 1; i <= 4; i++) {
      if (players[i]) {
        const nameEl = document.getElementById(`playerBtnName-${i}`);
        const scoreEl = document.getElementById(`playerBtnScore-${i}`);

        if (nameEl) nameEl.innerText = players[i].name;
        if (scoreEl) scoreEl.innerText = players[i].score;

        const scoreInput = document.getElementById(`config-score-${i}`);
        const nameLabel = document.getElementById(`config-name-${i}`);

        if (scoreInput && document.activeElement !== scoreInput) {
          scoreInput.value = players[i].score;
        }
        if (nameLabel && document.activeElement !== nameLabel) {
          nameLabel.innerText = players[i].name;
          window.compressConfigName(i);
        }
      }
    }
    updateQAPreview();

    if (isPlayersShown) {
      if (activePlayerIndex !== null) {
        channel.postMessage({ action: 'active_player', index: activePlayerIndex, players: globalPlayers });
      } else {
        channel.postMessage({ action: 'show_players', players: globalPlayers });
      }
    }
  }
});

const unsubQuestions = onValue(ref(db, 'questions/round_1'), (snapshot) => {
  if (snapshot.exists()) {
    round1Questions = snapshot.val();
    updateQAPreview();
    syncRound1StateToDB();
  }
});

const unsubRound1 = onValue(ref(db, 'games/round_1'), (snapshot) => {
  if (snapshot.exists()) {
    const data = snapshot.val();
    if (data.luot_rieng) {
      lr_config = data.luot_rieng;
      if (document.getElementById('lr_soluot')) {
        document.getElementById('lr_soluot').value = lr_config.so_luot !== undefined ? lr_config.so_luot : 4;
      }
      document.getElementById('lr_socau').value = lr_config.so_cau;
      document.getElementById('lr_diemdung').value = lr_config.diem_dung;
      document.getElementById('lr_diemsai').value = lr_config.diem_sai;
      document.getElementById('lr_thoigian').value = lr_config.thoi_gian || -1;
    }
    if (data.luot_chung) {
      if (Array.isArray(data.luot_chung)) {
        lc_configs = data.luot_chung;
      } else {
        lc_configs = [data.luot_chung];
      }
      document.getElementById('numLuotChung').value = lc_configs.length;
      window.renderLuotChungConfigs();
    }
    updateQAPreview();
    syncRound1StateToDB();
  }
});

const unsubBuzzer = onValue(ref(db, 'games/round_1_buzzer'), (snapshot) => {
  if (!snapshot.exists()) return;
  const data = snapshot.val() || {};

  if (typeof data.enabled === 'boolean') {
    isBuzzerEnabled = data.enabled;
    renderBuzzerLockButtonUI();
  }
  if (data.openedAt !== undefined) {
    buzzerOpenedAt = data.openedAt;
  }

  if (!data.locked || !data.playerIndex) {
    playerBuzzTimes = {};
    renderPlayerBuzzTimesUI();
    return;
  }

  const pIdx = Number(data.playerIndex);
  if (pIdx >= 1 && pIdx <= 4) {
    if (typeof data.buzzTimeSec === 'number' && !isNaN(data.buzzTimeSec)) {
      playerBuzzTimes = { [pIdx]: data.buzzTimeSec };
    } else if (data.openedAt && data.timestamp) {
      const calcSec = Math.max(0, Number(((Number(data.timestamp) - Number(data.openedAt)) / 1000).toFixed(2)));
      playerBuzzTimes = { [pIdx]: calcSec };
    }
    renderPlayerBuzzTimesUI();
  }

  // Chỉ xử lý tín hiệu bấm chuông khi chuông đang mở và câu hỏi trùng khớp
  if (!data.enabled) return;
  if (
    data.quesIndex !== undefined &&
    data.quesIndex !== null &&
    Number(data.quesIndex) !== Number(currentQuesIndex)
  ) {
    return;
  }

  const ts = Number(data.timestamp) || 0;
  if (pIdx < 1 || pIdx > 4 || ts <= lastHandledBuzzTimestamp) return;

  lastHandledBuzzTimestamp = ts;
  const targetBtn = document.getElementById(`playerBtn-${pIdx}`);
  if (targetBtn) {
    targetBtn.dataset.fromPlayerBuzz = '1';
  }
  window.triggerAction(targetBtn, String(pIdx));
  if (targetBtn) {
    delete targetBtn.dataset.fromPlayerBuzz;
  }
});

function initRound1() {
  bindRound1Events();
  window.renderLuotChungConfigs();
  window.compressBadgeText('roundText');
  window.compressBadgeText('quesText');
  window.compressBadgeText('timeText');
  resetRound1BuzzerDB(false);
  syncRound1StateToDB();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRound1, { once: true });
} else {
  initRound1();
}

window.cleanupCurrentRound = () => {
  if (typeof unsubPlayers === 'function') unsubPlayers();
  if (typeof unsubQuestions === 'function') unsubQuestions();
  if (typeof unsubRound1 === 'function') unsubRound1();
  if (typeof unsubBuzzer === 'function') unsubBuzzer();
  if (typeof unsubServerOffset === 'function') unsubServerOffset();

  if (ctrlTimerInterval) {
    clearInterval(ctrlTimerInterval);
    ctrlTimerInterval = null;
  }
  if (turnTimerInterval) {
    clearInterval(turnTimerInterval);
    turnTimerInterval = null;
  }
  if (round1EventsController) {
    round1EventsController.abort();
    round1EventsController = null;
  }
  isWaitBgShown = false;
  const btnWaitBg = document.getElementById('btn-wait-bg');
  if (btnWaitBg) btnWaitBg.classList.add('dimmed');
  window.closeConfig();
};