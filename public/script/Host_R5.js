import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const db = window.firebaseDB;
const state = window.HostState;

const R5_MAX_QUESTIONS = 12;
const R5_MAX_PLAYERS = 8;
const R5_DURATION_MS = 15000;

const r5State = {
  players: ["Thí sinh 1", "Thí sinh 2"],
  currentQuesIdx: 0,
  questionText: "",
  isQuestionShown: false,
  buzzedIndex: null,
  eliminatedIndices: [],
  winnerIndex: null,
  remainingMs: R5_DURATION_MS,
  isTimerRunning: false
};

let timerInterval = null;
let lastTickTime = 0;

function clearLocalTimerInterval() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function getR5QuestionsList() {
  const raw =
    state.questions.round_5 ||
    state.questions.round5 ||
    state.questions.Round_5 ||
    {};

  const loaded = [];
  if (raw && typeof raw === "object") {
    const entries = Object.entries(raw).sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true })
    );

    for (const [key, item] of entries) {
      if (item && typeof item === "object" && (item.cau_hoi !== undefined || item.dap_an !== undefined)) {
        loaded.push({
          id: key,
          cau_hoi: String(item.cau_hoi ?? ""),
          dap_an: String(item.dap_an ?? "")
        });
      }
      if (loaded.length >= R5_MAX_QUESTIONS) break;
    }
  }
  return loaded;
}

function getTimeBadgeText() {
  const secStr = (Math.max(0, r5State.remainingMs) / 1000).toFixed(1);
  if (r5State.remainingMs <= 0) {
    return "HẾT GIỜ (0.0s)";
  }
  if (r5State.buzzedIndex !== null) {
    return `TẠM DỪNG: ${secStr}s`;
  }
  return `THỜI GIAN: ${secStr}s`;
}

function updateTimeDisplayOnly() {
  if (state.activeTab !== "R5") return;
  const timeText = getTimeBadgeText();
  const timeBadge = document.getElementById("hostR5TimeBadge");
  if (timeBadge) timeBadge.textContent = timeText;
}

function syncLocalTimerLoop() {
  if (r5State.isTimerRunning && r5State.remainingMs > 0) {
    if (timerInterval === null) {
      lastTickTime = performance.now();
      timerInterval = setInterval(() => {
        if (!r5State.isTimerRunning) {
          clearLocalTimerInterval();
          return;
        }
        const now = performance.now();
        const delta = now - lastTickTime;
        lastTickTime = now;

        r5State.remainingMs = Math.max(0, r5State.remainingMs - delta);
        updateTimeDisplayOnly();

        if (r5State.remainingMs <= 0) {
          r5State.isTimerRunning = false;
          clearLocalTimerInterval();
          renderR5View();
        }
      }, 100);
    }
  } else {
    clearLocalTimerInterval();
  }
}

function renderR5View() {
  if (state.activeTab !== "R5") return;

  const questions = getR5QuestionsList();
  const totalQ = questions.length;
  let idx = Number(r5State.currentQuesIdx) || 0;
  if (totalQ > 0 && idx >= totalQ) idx = totalQ - 1;
  if (idx < 0) idx = 0;

  const currentQ = questions[idx] || null;

  const quesBadgeStr = totalQ > 0 ? `CÂU HỎI ${idx + 1}/${totalQ}` : "CÂU HỎI 0/0";
  const timeBadgeStr = getTimeBadgeText();

  const quesBadgeEl = document.getElementById("hostR5QuesBadge");
  if (quesBadgeEl) quesBadgeEl.textContent = quesBadgeStr;

  const timeBadgeEl = document.getElementById("hostR5TimeBadge");
  if (timeBadgeEl) timeBadgeEl.textContent = timeBadgeStr;

  const visBadgeEl = document.getElementById("hostR5QuesVisBadge");
  if (visBadgeEl) {
    visBadgeEl.textContent = r5State.isQuestionShown ? "ĐANG HIỆN CÂU HỎI" : "ĐANG ẨN CÂU HỎI";
    visBadgeEl.classList.toggle("is-shown", r5State.isQuestionShown);
  }

  const topSubEl = document.getElementById("hostRoundSub");
  if (topSubEl) {
    if (r5State.winnerIndex !== null && r5State.players[r5State.winnerIndex]) {
      topSubEl.textContent = `🏆 CHIẾN THẮNG: ${r5State.players[r5State.winnerIndex]}`;
    } else if (r5State.buzzedIndex !== null && r5State.players[r5State.buzzedIndex]) {
      topSubEl.textContent = `🔔 ${r5State.players[r5State.buzzedIndex]} BẤM CHUÔNG`;
    } else {
      topSubEl.textContent = `${quesBadgeStr} • ${r5State.isQuestionShown ? "ĐANG HIỆN CÂU HỎI" : "ĐANG ẨN CÂU HỎI"}`;
    }
  }

  const qPrev = document.getElementById("hostR5PreviewQuestion");
  if (qPrev) {
    qPrev.textContent = currentQ
      ? currentQ.cau_hoi
      : r5State.questionText || "Chưa có câu hỏi phụ trong Database (questions/round_5).";
  }

  const aPrev = document.getElementById("hostR5PreviewAnswer");
  if (aPrev) {
    aPrev.textContent = currentQ ? `${currentQ.dap_an}` : "...";
  }

  const countLabel = document.getElementById("hostR5PlayersCountLabel");
  if (countLabel) {
    countLabel.textContent = `THÍ SINH (${r5State.players.length}/${R5_MAX_PLAYERS})`;
  }

  const listEl = document.getElementById("hostR5PlayersList");
  if (listEl) {
    listEl.innerHTML = "";
    r5State.players.forEach((name, pIdx) => {
      const isBuzzed = r5State.buzzedIndex === pIdx;
      const isEliminated = r5State.eliminatedIndices.includes(pIdx);
      const isWinner = r5State.winnerIndex === pIdx;

      const card = document.createElement("div");
      card.className = "r5-player-card";
      if (isBuzzed) card.classList.add("is-buzzed");
      if (isEliminated) card.classList.add("is-eliminated");
      if (isWinner) card.classList.add("is-winner");

      let subText = `TS ${pIdx + 1} • SẴN SÀNG`;
      if (isWinner) subText = `TS ${pIdx + 1} • 🏆 CHIẾN THẮNG`;
      else if (isBuzzed) subText = `TS ${pIdx + 1} • 🔔 ĐANG TRẢ LỜI`;
      else if (isEliminated) subText = `TS ${pIdx + 1} • ❌ ĐÃ SAI (HẾT 1 LƯỢT)`;

      const leftDiv = document.createElement("div");
      leftDiv.className = "r5-p-left";

      const nameDiv = document.createElement("div");
      nameDiv.className = "r5-p-name";
      nameDiv.textContent = `${pIdx + 1}. ${name}`;

      const subDiv = document.createElement("div");
      subDiv.className = "r5-p-sub";
      subDiv.textContent = subText;

      leftDiv.appendChild(nameDiv);
      leftDiv.appendChild(subDiv);
      card.appendChild(leftDiv);

      listEl.appendChild(card);
    });
  }
}

const unsubR5State = onValue(ref(db, "games/r5_state"), (snap) => {
  if (!snap.exists()) return;
  const d = snap.val();
  if (!d || typeof d !== "object") return;

  if (Array.isArray(d.players) && d.players.length > 0) {
    r5State.players = d.players.slice(0, R5_MAX_PLAYERS);
  }

  if (d.currentQuesIdx !== undefined) {
    r5State.currentQuesIdx = Math.max(0, Number(d.currentQuesIdx) || 0);
  } else if (d.currentQuesIndex !== undefined || d.quesIndex !== undefined) {
    r5State.currentQuesIdx = Math.max(0, (Number(d.currentQuesIndex ?? d.quesIndex) || 1) - 1);
  }

  if (d.questionText !== undefined) {
    r5State.questionText = String(d.questionText || "");
  }
  if (d.isQuestionShown !== undefined) {
    r5State.isQuestionShown = Boolean(d.isQuestionShown);
  }

  r5State.buzzedIndex = typeof d.buzzedIndex === "number" ? d.buzzedIndex : null;
  r5State.eliminatedIndices = Array.isArray(d.eliminatedIndices)
    ? d.eliminatedIndices.map(Number)
    : [];
  r5State.winnerIndex = typeof d.winnerIndex === "number" ? d.winnerIndex : null;

  if (typeof d.remainingMs === "number" && Number.isFinite(d.remainingMs)) {
    r5State.remainingMs = Math.max(0, d.remainingMs);
  }
  if (d.isTimerRunning !== undefined) {
    r5State.isTimerRunning = Boolean(d.isTimerRunning);
    if (r5State.isTimerRunning) {
      lastTickTime = performance.now();
    }
  }

  syncLocalTimerLoop();
  renderR5View();
});

let isInitialCommandSnapshot = true;
const unsubCommands = onValue(ref(db, "games/commands"), (snap) => {
  const isFirstLoad = isInitialCommandSnapshot;
  isInitialCommandSnapshot = false;

  if (isFirstLoad || !snap.exists() || state.activeTab !== "R5") return;
  const cmd = snap.val();
  if (!cmd || typeof cmd !== "object") return;

  const action = String(cmd.action || "");
  if (cmd.round && cmd.round !== "R5" && action !== "reset_graphic") return;

  if (Array.isArray(cmd.players) && cmd.players.length > 0) {
    r5State.players = cmd.players.slice(0, R5_MAX_PLAYERS);
  }
  if (Array.isArray(cmd.eliminatedIndices)) {
    r5State.eliminatedIndices = cmd.eliminatedIndices.map(Number);
  }
  if (typeof cmd.remainingMs === "number" && Number.isFinite(cmd.remainingMs)) {
    r5State.remainingMs = Math.max(0, cmd.remainingMs);
  }

  if (action === "r5_show_question") {
    r5State.isQuestionShown = true;
    if (cmd.questionIndex !== undefined) {
      r5State.currentQuesIdx = Math.max(0, (Number(cmd.questionIndex) || 1) - 1);
    }
    if (cmd.questionText !== undefined) {
      r5State.questionText = String(cmd.questionText || "");
    }
    if (typeof cmd.buzzedIndex === "number") r5State.buzzedIndex = cmd.buzzedIndex;
    if (typeof cmd.winnerIndex === "number") r5State.winnerIndex = cmd.winnerIndex;
  } else if (action === "r5_hide_question") {
    r5State.isQuestionShown = false;
  } else if (action === "r5_start_timer") {
    r5State.remainingMs = (Number(cmd.duration) || 15) * 1000;
    r5State.isTimerRunning = true;
    lastTickTime = performance.now();
  } else if (action === "r5_resume_timer") {
    r5State.isTimerRunning = true;
    lastTickTime = performance.now();
  } else if (action === "r5_pause_timer") {
    r5State.isTimerRunning = false;
  } else if (action === "r5_stop_timer") {
    r5State.isTimerRunning = false;
    r5State.remainingMs = R5_DURATION_MS;
  } else if (action === "r5_time_up") {
    r5State.isTimerRunning = false;
    r5State.remainingMs = 0;
  } else if (action === "r5_buzz" && typeof cmd.playerIndex === "number") {
    r5State.isTimerRunning = false;
    r5State.buzzedIndex = cmd.playerIndex;
  } else if (action === "r5_win" && typeof cmd.winnerIndex === "number") {
    r5State.isTimerRunning = false;
    r5State.remainingMs = R5_DURATION_MS;
    r5State.buzzedIndex = null;
    r5State.winnerIndex = cmd.winnerIndex;
  } else if (action === "r5_all_wrong") {
    r5State.isTimerRunning = false;
    r5State.remainingMs = R5_DURATION_MS;
    r5State.buzzedIndex = null;
  } else if (action === "r5_wrong_resume" || action === "r5_clear_buzz") {
    r5State.buzzedIndex = null;
    r5State.isTimerRunning = Boolean(cmd.resumeTimer) && r5State.remainingMs > 0;
    if (r5State.isTimerRunning) {
      lastTickTime = performance.now();
    }
  } else if (action === "r5_reset_question" || action === "reset_graphic") {
    r5State.isQuestionShown = false;
    r5State.buzzedIndex = null;
    r5State.eliminatedIndices = [];
    r5State.winnerIndex = null;
    r5State.isTimerRunning = false;
    r5State.remainingMs = R5_DURATION_MS;
  } else if (action === "r5_update_players") {
    r5State.buzzedIndex = typeof cmd.buzzedIndex === "number" ? cmd.buzzedIndex : null;
    r5State.winnerIndex = typeof cmd.winnerIndex === "number" ? cmd.winnerIndex : null;
  }

  syncLocalTimerLoop();
  renderR5View();
});

window.renderActiveHostRound = renderR5View;
window.cleanupCurrentRound = () => {
  clearLocalTimerInterval();
  unsubR5State();
  unsubCommands();
  window.renderActiveHostRound = null;
};

renderR5View();