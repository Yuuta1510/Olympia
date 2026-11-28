import {
  ref,
  set,
  onValue,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const state = window.PlayerState;
const db = state.db;

let serverTimeOffset = 0;
const unsubServerOffset = onValue(ref(db, ".info/serverTimeOffset"), (snapshot) => {
  if (snapshot.exists()) {
    serverTimeOffset = Number(snapshot.val()) || 0;
  }
});

function getServerNow() {
  return Date.now() + serverTimeOffset;
}

let round1Questions = [];
let lrConfig = { so_luot: 4, so_cau: 6, thoi_gian: -1, diem_dung: 10, diem_sai: 0 };
let lcConfigs = [{ so_cau: 12, thoi_gian: -1, diem_dung: 10, diem_sai: -5 }];

let currentQuesIndex = 1;
let isQuestionShown = false;
let currentQuestionText = "";
let controllerActivePlayerIndex = null;

let turnDuration = -1;
let remainingTime = -1;
let isTurnTimePlaying = false;
let turnTimerInterval = null;

let isTimer5sRunning = false;
let timer5sInterval = null;

let buzzerState = {
  enabled: false,
  openedAt: null,
  locked: false,
  playerIndex: null,
  playerName: "",
  buzzTimeSec: null,
  quesIndex: null
};

let unsubscribers = [];
let isInitialCmd = true;

function normalizePlayerIndex(rawIdx) {
  if (rawIdx === null || rawIdx === undefined || rawIdx === "") return null;
  const idx = Number(rawIdx);
  return Number.isInteger(idx) && idx >= 1 && idx <= 4 ? idx : null;
}

function getMyPlayerInfo() {
  const idx = Number(state.playerIndex) || 1;
  const p = (state.players && state.players[idx]) || {};
  const name = String(p.name || `P${idx}`).trim() || `P${idx}`;
  const score = Number(p.score) || 0;
  return { idx, name, score };
}

function getPlayerNameByIndex(idx) {
  const p = (state.players && state.players[idx]) || {};
  return String(p.name || `P${idx}`).trim() || `P${idx}`;
}

function isInfiniteTurnTime(val) {
  return val === -1 || val === undefined || val === null || isNaN(Number(val)) || Number(val) < 0;
}

function computeTurnInfo(quesIndex) {
  let lrCount = parseInt(lrConfig.so_luot, 10);
  if (isNaN(lrCount)) lrCount = 4;
  const a = parseInt(lrConfig.so_cau, 10) || 0;

  if (a > 0 && lrCount > 0 && quesIndex <= lrCount * a) {
    const turnOwnerIdx = Math.ceil(quesIndex / a);
    const relativeQues = quesIndex - (turnOwnerIdx - 1) * a;
    const ownerName = getPlayerNameByIndex(turnOwnerIdx).toUpperCase();
    return {
      isIndividualTurn: true,
      isCommonTurn: false,
      turnOwnerIdx,
      turnName: `LƯỢT RIÊNG - ${ownerName}`,
      relativeQues,
      totalTurnQues: a,
      turnTime: lrConfig.thoi_gian !== undefined ? Number(lrConfig.thoi_gian) : -1
    };
  }

  if (Array.isArray(lcConfigs) && lcConfigs.length > 0) {
    let remaining = quesIndex - (a > 0 && lrCount > 0 ? lrCount * a : 0);
    for (let i = 0; i < lcConfigs.length; i++) {
      const b = parseInt(lcConfigs[i].so_cau, 10) || 0;
      if (b > 0 && remaining <= b) {
        return {
          isIndividualTurn: false,
          isCommonTurn: true,
          turnOwnerIdx: null,
          turnName: "LƯỢT CHUNG",
          relativeQues: remaining,
          totalTurnQues: b,
          turnTime: lcConfigs[i].thoi_gian !== undefined ? Number(lcConfigs[i].thoi_gian) : -1
        };
      }
      remaining -= b;
    }
  }

  return {
    isIndividualTurn: false,
    isCommonTurn: false,
    turnOwnerIdx: null,
    turnName: "KHỞI ĐỘNG",
    relativeQues: 0,
    totalTurnQues: 0,
    turnTime: -1
  };
}

function resolveActiveContestant() {
  // 1. Đồng bộ trực tiếp với thí sinh đang được active trên Controller (cả lượt riêng lẫn lượt chung)
  const ctrlIdx = normalizePlayerIndex(controllerActivePlayerIndex);
  if (ctrlIdx !== null) {
    return ctrlIdx;
  }

  // 2. Trường hợp thí sinh vừa bấm chuông trước khi Controller kịp đồng bộ r1_state
  if (buzzerState && buzzerState.locked && buzzerState.playerIndex) {
    const buzzIdx = normalizePlayerIndex(buzzerState.playerIndex);
    if (buzzIdx !== null) {
      return buzzIdx;
    }
  }

  return null;
}

function updateQuestionFooterVisibility() {
  const footerEl = document.getElementById("r1PlayerQuestionFooter");
  const timeEl = document.getElementById("r1PlayerTimeText");
  const pillEl = document.getElementById("r1PlayerTimer5s");
  if (!footerEl) return;

  const isTimeVisible = Boolean(timeEl && timeEl.style.display !== "none");
  const is5sVisible = Boolean(pillEl && pillEl.classList.contains("is-visible"));
  footerEl.style.display = isTimeVisible || is5sVisible ? "flex" : "none";
}

function stopLocalTurnTimer() {
  if (turnTimerInterval) {
    clearInterval(turnTimerInterval);
    turnTimerInterval = null;
  }
}

function stopLocal5sTimer() {
  if (timer5sInterval) {
    clearInterval(timer5sInterval);
    timer5sInterval = null;
  }
}

function startLocalTurnTimer(duration, startRemaining, startedAt) {
  stopLocalTurnTimer();
  turnDuration = Number(duration);
  if (isInfiniteTurnTime(turnDuration)) {
    isTurnTimePlaying = false;
    remainingTime = -1;
    renderTimeDisplay();
    return;
  }

  const baseRemaining =
    typeof startRemaining === "number" && !isNaN(startRemaining)
      ? startRemaining
      : turnDuration;
  const baseStart =
    typeof startedAt === "number" && !isNaN(startedAt) ? startedAt : getServerNow();

  isTurnTimePlaying = true;
  turnTimerInterval = setInterval(() => {
    const elapsed = (getServerNow() - baseStart) / 1000;
    remainingTime = Math.max(0, baseRemaining - elapsed);
    renderTimeDisplay();

    if (remainingTime <= 0) {
      isTurnTimePlaying = false;
      stopLocalTurnTimer();
    }
  }, 80);
}

function startLocal5sTimer(startedAt) {
  stopLocal5sTimer();
  const pill = document.getElementById("r1PlayerTimer5s");
  if (!pill) return;

  isTimer5sRunning = true;
  pill.classList.add("is-visible");
  updateQuestionFooterVisibility();

  const baseStart =
    typeof startedAt === "number" && !isNaN(startedAt) ? startedAt : getServerNow();

  const tick = () => {
    const elapsedSec = Math.floor((getServerNow() - baseStart) / 1000);
    const left = 5 - elapsedSec;
    if (left > 0) {
      pill.textContent = `${left}s`;
    } else {
      pill.textContent = "0s";
      stopLocal5sTimer();
      isTimer5sRunning = false;
      setTimeout(() => {
        if (!isTimer5sRunning && pill) {
          pill.classList.remove("is-visible");
          updateQuestionFooterVisibility();
        }
      }, 1500);
    }
  };

  tick();
  timer5sInterval = setInterval(tick, 200);
}

function hide5sPill() {
  stopLocal5sTimer();
  isTimer5sRunning = false;
  const pill = document.getElementById("r1PlayerTimer5s");
  if (pill) {
    pill.classList.remove("is-visible");
  }
  updateQuestionFooterVisibility();
}

function renderTimeDisplay() {
  const timeEl = document.getElementById("r1PlayerTimeText");
  if (!timeEl) return;

  if (isInfiniteTurnTime(turnDuration)) {
    timeEl.style.display = "none";
    updateQuestionFooterVisibility();
    return;
  }

  timeEl.style.display = "inline-flex";
  const val = remainingTime >= 0 ? remainingTime : turnDuration;
  if (val <= 0) {
    timeEl.textContent = "0.0s";
  } else {
    timeEl.textContent = `${val.toFixed(1)}s`;
  }
  updateQuestionFooterVisibility();
}

function resetLocalBuzzer(syncToDB = false) {
  const wasLocked = Boolean(buzzerState.locked);
  buzzerState = {
    enabled: Boolean(buzzerState.enabled),
    openedAt: buzzerState.enabled ? getServerNow() : null,
    locked: false,
    playerIndex: null,
    playerName: "",
    buzzTimeSec: null,
    quesIndex: currentQuesIndex
  };
  renderBuzzerUI();

  if (syncToDB && wasLocked) {
    set(ref(db, "games/round_1_buzzer"), {
      enabled: buzzerState.enabled,
      openedAt: buzzerState.openedAt,
      locked: false,
      playerIndex: null,
      playerName: "",
      buzzTimeSec: null,
      quesIndex: currentQuesIndex,
      timestamp: getServerNow()
    }).catch(() => {});
  }
}

function renderBuzzerUI() {
  const buzzBtn = document.getElementById("r1PlayerBuzzBtn");
  const turnEl = document.getElementById("r1PlayerTurnText");
  const info = computeTurnInfo(currentQuesIndex);
  const activeIdx = resolveActiveContestant();

  for (let i = 1; i <= 4; i++) {
    const cardEl = document.getElementById(`r1ScoreCard-${i}`);
    const isCardActive = activeIdx === i;
    const isBuzzWinner =
      isCardActive &&
      Boolean(buzzerState && buzzerState.locked && Number(buzzerState.playerIndex) === i);

    if (cardEl) {
      cardEl.classList.toggle("is-active", isCardActive);
      cardEl.classList.toggle("is-buzzed", isBuzzWinner);
    }
  }

  if (turnEl) {
    turnEl.textContent = info.turnName;
  }

  if (!buzzBtn) return;

  const { idx: myIdx } = getMyPlayerInfo();

  buzzBtn.classList.remove("is-buzzed-me", "is-buzzed-other", "is-dimmed", "is-locked", "has-buzz-time");
  buzzBtn.textContent = "BẤM CHUÔNG";

  // 1. Lượt riêng -> làm mờ nút chuông
  if (!info.isCommonTurn) {
    buzzBtn.disabled = true;
    buzzBtn.classList.add("is-dimmed");
    return;
  }

  // 2. Đã có thí sinh bấm chuông giành quyền
  if (buzzerState && buzzerState.locked && buzzerState.playerIndex) {
    const winnerIdx = Number(buzzerState.playerIndex);
    const hasTime =
      typeof buzzerState.buzzTimeSec === "number" && !isNaN(buzzerState.buzzTimeSec);
    const timeText = hasTime ? `${buzzerState.buzzTimeSec.toFixed(2)}s` : "";

    buzzBtn.disabled = true;

    if (winnerIdx === myIdx) {
      buzzBtn.classList.add("is-buzzed-me");
      buzzBtn.textContent = timeText || "BẤM CHUÔNG";
    } else {
      buzzBtn.classList.add("is-buzzed-other");
    }
    return;
  }

  // 3. Controller đang KHÓA chuông -> không thể bấm
  if (!buzzerState || !buzzerState.enabled) {
    buzzBtn.disabled = true;
    buzzBtn.classList.add("is-locked");
    return;
  }

  // 4. Controller đang MỞ chuông -> sẵn sàng bấm
  buzzBtn.disabled = false;
}

function renderPlayerR1View() {
  if (!state || state.activeTab !== "R1") return;

  const { idx: myIdx } = getMyPlayerInfo();

  for (let i = 1; i <= 4; i++) {
    const p = (state.players && state.players[i]) || {};
    const pName = String(p.name || `P${i}`).trim() || `P${i}`;
    const pScore = Number(p.score) || 0;

    const cardEl = document.getElementById(`r1ScoreCard-${i}`);
    const nameEl = document.getElementById(`r1PlayerName-${i}`);
    const scoreEl = document.getElementById(`r1PlayerScore-${i}`);

    if (nameEl) nameEl.textContent = pName;
    if (scoreEl) scoreEl.textContent = String(pScore);
    if (cardEl) {
      cardEl.classList.toggle("is-self", i === myIdx);
    }
  }

  const info = computeTurnInfo(currentQuesIndex);
  const quesLabelEl = document.getElementById("r1PlayerQuestionLabel");

  if (quesLabelEl) {
    quesLabelEl.textContent =
      info.totalTurnQues > 0
        ? `CÂU HỎI ${info.relativeQues}/${info.totalTurnQues}`
        : "HẾT CÂU HỎI";
  }

  if (!isTurnTimePlaying && turnDuration !== info.turnTime) {
    turnDuration = info.turnTime;
    remainingTime = info.turnTime;
  }
  renderTimeDisplay();

  const quesBoxTextEl = document.getElementById("r1PlayerQuestionText");
  if (quesBoxTextEl) {
    const resolvedText =
      currentQuestionText ||
      (round1Questions && round1Questions[currentQuesIndex]
        ? round1Questions[currentQuesIndex].cau_hoi
        : "");

    if (isQuestionShown && resolvedText) {
      quesBoxTextEl.classList.remove("is-waiting");
      quesBoxTextEl.textContent = resolvedText;
    } else {
      quesBoxTextEl.classList.add("is-waiting");
      quesBoxTextEl.textContent = "Chờ MC hiển thị câu hỏi...";
    }
  }

  renderBuzzerUI();
}

async function handleBuzzPress() {
  if (!state || state.activeTab !== "R1") return;
  const info = computeTurnInfo(currentQuesIndex);
  if (!info.isCommonTurn) return;
  if (!buzzerState || !buzzerState.enabled || buzzerState.locked) return;

  const { idx, name } = getMyPlayerInfo();
  const buzzerRef = ref(db, "games/round_1_buzzer");

  try {
    await runTransaction(buzzerRef, (current) => {
      const enabled = current ? Boolean(current.enabled) : Boolean(buzzerState.enabled);
      const locked = current ? Boolean(current.locked) : Boolean(buzzerState.locked);
      const targetQues =
        current && current.quesIndex !== undefined && current.quesIndex !== null
          ? Number(current.quesIndex)
          : Number(currentQuesIndex);

      if (!enabled || locked || targetQues !== Number(currentQuesIndex)) {
        return;
      }

      const buzzNow = getServerNow();
      const baseOpenedAt = Number(current?.openedAt ?? buzzerState.openedAt) || buzzNow;
      const diffMs = Math.max(0, buzzNow - baseOpenedAt);
      const buzzTimeSec = Number((diffMs / 1000).toFixed(2));

      return {
        enabled: true,
        openedAt: baseOpenedAt,
        locked: true,
        playerIndex: idx,
        playerName: name,
        buzzTimeSec,
        quesIndex: currentQuesIndex,
        timestamp: buzzNow
      };
    });
  } catch (err) {
    console.error("Lỗi gửi tín hiệu chuông:", err);
  }
}

function handleKeyDown(e) {
  if (!state || state.activeTab !== "R1") return;
  if (e.code === "Space" && !e.repeat) {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    e.preventDefault();
    handleBuzzPress();
  }
}

function initPlayerRound1() {
  const buzzBtn = document.getElementById("r1PlayerBuzzBtn");
  if (buzzBtn) {
    buzzBtn.onclick = handleBuzzPress;
  }
  window.addEventListener("keydown", handleKeyDown);

  const unsubRound1 = onValue(ref(db, "games/round_1"), (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.val() || {};
    if (data.luot_rieng) {
      lrConfig = data.luot_rieng;
    }
    if (data.luot_chung) {
      lcConfigs = Array.isArray(data.luot_chung)
        ? data.luot_chung
        : [data.luot_chung];
    }
    renderPlayerR1View();
  });

  const unsubQuestions = onValue(ref(db, "questions/round_1"), (snapshot) => {
    if (snapshot.exists()) {
      round1Questions = snapshot.val() || [];
      renderPlayerR1View();
    }
  });

  const unsubBuzzer = onValue(ref(db, "games/round_1_buzzer"), (snapshot) => {
    if (snapshot.exists()) {
      const val = snapshot.val() || {};
      const isDifferentQues =
        val.locked &&
        val.quesIndex !== undefined &&
        val.quesIndex !== null &&
        Number(val.quesIndex) !== Number(currentQuesIndex);

      if (isDifferentQues) {
        buzzerState = {
          enabled: Boolean(val.enabled),
          openedAt: val.openedAt ?? null,
          locked: false,
          playerIndex: null,
          playerName: "",
          buzzTimeSec: null,
          quesIndex: currentQuesIndex
        };
      } else {
        let resolvedBuzzSec =
          typeof val.buzzTimeSec === "number" && !isNaN(val.buzzTimeSec)
            ? val.buzzTimeSec
            : null;
        if (resolvedBuzzSec === null && val.locked && val.openedAt && val.timestamp) {
          resolvedBuzzSec = Math.max(
            0,
            Number(((Number(val.timestamp) - Number(val.openedAt)) / 1000).toFixed(2))
          );
        }

        const wasLocked = Boolean(buzzerState.locked);
        const nextLocked = Boolean(val.locked);
        const nextWinnerIdx = normalizePlayerIndex(val.playerIndex);

        buzzerState = {
          enabled: Boolean(val.enabled),
          openedAt: val.openedAt ?? null,
          locked: nextLocked,
          playerIndex: nextWinnerIdx,
          playerName: val.playerName || "",
          buzzTimeSec: resolvedBuzzSec,
          quesIndex: val.quesIndex ?? null
        };

        // Khi thí sinh vừa bấm chuông thành công, đồng bộ ngay trạng thái active trên bảng điểm
        if (!wasLocked && nextLocked && nextWinnerIdx !== null) {
          controllerActivePlayerIndex = nextWinnerIdx;
        }
      }
    } else {
      buzzerState = {
        enabled: false,
        openedAt: null,
        locked: false,
        playerIndex: null,
        playerName: "",
        buzzTimeSec: null,
        quesIndex: null
      };
    }
    renderBuzzerUI();
  });

  const unsubR1State = onValue(ref(db, "games/r1_state"), (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.val() || {};

    if (typeof data.currentQuesIndex === "number" && data.currentQuesIndex >= 1) {
      const prevQues = currentQuesIndex;
      currentQuesIndex = data.currentQuesIndex;
      if (currentQuesIndex !== prevQues) {
        resetLocalBuzzer(false);
      }
    }
    if (typeof data.isQuestionShown === "boolean") {
      isQuestionShown = data.isQuestionShown;
    }
    if (typeof data.questionText === "string") {
      currentQuestionText = data.questionText;
    }

    controllerActivePlayerIndex = normalizePlayerIndex(data.activePlayerIndex);

    if (data.turnTime !== undefined) {
      turnDuration = Number(data.turnTime);
    }

    if (data.isTurnTimePlaying) {
      startLocalTurnTimer(
        data.turnTime,
        data.timerStartRemaining,
        data.timerStartedAt
      );
    } else {
      stopLocalTurnTimer();
      isTurnTimePlaying = false;
      if (data.remainingTime !== undefined) {
        remainingTime = Number(data.remainingTime);
      }
      renderTimeDisplay();
    }

    if (data.isTimer5sRunning) {
      startLocal5sTimer(data.timer5sStartedAt);
    } else {
      hide5sPill();
    }

    renderPlayerR1View();
  });

  const unsubCmds = onValue(ref(db, "games/commands"), (snapshot) => {
    if (isInitialCmd) {
      isInitialCmd = false;
      return;
    }
    if (!snapshot.exists()) return;
    const data = snapshot.val() || {};
    const action = data.action;
    if (!action) return;

    if (action === "reset_buzzers") {
      if (data.activePlayerIndex !== undefined) {
        controllerActivePlayerIndex = normalizePlayerIndex(data.activePlayerIndex);
      } else {
        controllerActivePlayerIndex = null;
      }
      resetLocalBuzzer(false);
    } else if (action === "active_player") {
      controllerActivePlayerIndex = normalizePlayerIndex(data.index);
      renderBuzzerUI();
    } else if (action === "show_players" || action === "hide_players") {
      controllerActivePlayerIndex = null;
      renderBuzzerUI();
    } else if (action === "show_question") {
      const prevQues = currentQuesIndex;
      if (typeof data.quesIndex === "number") {
        currentQuesIndex = data.quesIndex;
      }
      if (typeof data.text === "string") {
        currentQuestionText = data.text;
      }
      isQuestionShown = true;

      if (
        currentQuesIndex !== prevQues ||
        (buzzerState.locked &&
          buzzerState.quesIndex !== null &&
          Number(buzzerState.quesIndex) !== currentQuesIndex)
      ) {
        resetLocalBuzzer(false);
      }

      renderPlayerR1View();
    } else if (action === "hide_question") {
      isQuestionShown = false;
      renderPlayerR1View();
    } else if (action === "play_turn_time") {
      const dur = Number(data.duration ?? turnDuration);
      const startRem = data.restart || remainingTime <= 0 ? dur : remainingTime;
      startLocalTurnTimer(dur, startRem, data.timestamp || getServerNow());
    } else if (action === "pause_turn_time") {
      stopLocalTurnTimer();
      isTurnTimePlaying = false;
      renderTimeDisplay();
    } else if (action === "stop_turn_time") {
      stopLocalTurnTimer();
      isTurnTimePlaying = false;
      remainingTime = turnDuration;
      renderTimeDisplay();
    } else if (action === "reset_turn_time") {
      stopLocalTurnTimer();
      isTurnTimePlaying = false;
      turnDuration = Number(data.duration ?? turnDuration);
      remainingTime = turnDuration;
      renderTimeDisplay();
    } else if (action === "time_out") {
      stopLocalTurnTimer();
      isTurnTimePlaying = false;
      remainingTime = 0;
      renderTimeDisplay();
    } else if (action === "start_5s") {
      startLocal5sTimer(data.timestamp || getServerNow());
    } else if (action === "stop_5s") {
      hide5sPill();
    } else if (action === "reset_graphic") {
      isQuestionShown = false;
      currentQuestionText = "";
      controllerActivePlayerIndex = null;
      stopLocalTurnTimer();
      isTurnTimePlaying = false;
      remainingTime = turnDuration;
      hide5sPill();
      resetLocalBuzzer(false);
      renderPlayerR1View();
    }
  });

  unsubscribers = [
    unsubServerOffset,
    unsubRound1,
    unsubQuestions,
    unsubBuzzer,
    unsubR1State,
    unsubCmds
  ];

  window.renderActivePlayerRound = renderPlayerR1View;
  window.cleanupCurrentRound = () => {
    unsubscribers.forEach((fn) => {
      if (typeof fn === "function") fn();
    });
    unsubscribers = [];
    stopLocalTurnTimer();
    stopLocal5sTimer();
    window.removeEventListener("keydown", handleKeyDown);
    window.renderActivePlayerRound = null;
  };

  renderPlayerR1View();
}

initPlayerRound1();