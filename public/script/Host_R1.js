import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const db = window.firebaseDB;
const state = window.HostState;
const utils = window.HostUtils;

const r1State = {
  quesIndex: 1,
  turnLabel: "",
  activePlayer: null,
  customText: "",
  numPlayers: 4,
  lr: { so_luot: 4, so_cau: 6, thoi_gian: -1 },
  lc: [{ so_cau: 12, thoi_gian: -1 }]
};

let r1Timer5sInterval = null;
let r1Timer5sHideTimeout = null;

function stopR1Timer5s() {
  if (r1Timer5sInterval) {
    clearInterval(r1Timer5sInterval);
    r1Timer5sInterval = null;
  }
  if (r1Timer5sHideTimeout) {
    clearTimeout(r1Timer5sHideTimeout);
    r1Timer5sHideTimeout = null;
  }
  const overlay = document.getElementById("hostTimer5sOverlay");
  const valueEl = document.getElementById("hostTimer5sValue");
  if (overlay) overlay.style.display = "none";
  if (valueEl) valueEl.textContent = "5";
}

function startR1Timer5s() {
  if (state.activeTab !== "R1") {
    stopR1Timer5s();
    return;
  }

  stopR1Timer5s();

  const overlay = document.getElementById("hostTimer5sOverlay");
  const valueEl = document.getElementById("hostTimer5sValue");
  if (!overlay || !valueEl) return;

  let timeLeft = 5;
  valueEl.textContent = String(timeLeft);
  overlay.style.display = "flex";

  r1Timer5sInterval = setInterval(() => {
    if (state.activeTab !== "R1") {
      stopR1Timer5s();
      return;
    }

    timeLeft -= 1;
    if (timeLeft > 0) {
      valueEl.textContent = String(timeLeft);
    } else {
      valueEl.textContent = "0";
      clearInterval(r1Timer5sInterval);
      r1Timer5sInterval = null;

      r1Timer5sHideTimeout = setTimeout(() => {
        stopR1Timer5s();
      }, 1500);
    }
  }, 1000);
}

function renderR1View() {
  if (state.activeTab !== "R1") return;

  const r1Map = utils.normalizeNumberedMap(state.questions.round_1);
  const keys = Object.keys(r1Map).sort((a, b) => Number(a) - Number(b));
  let idx = Number(r1State.quesIndex) || 1;
  let item = r1Map[idx];

  if (!item && r1State.customText) {
    const matched = utils.findQuestionByText(r1Map, r1State.customText);
    if (matched) {
      idx = Number(matched.key) || idx;
      item = matched.item;
    }
  }
  if (!item && keys.length > 0 && !r1State.customText) {
    idx = Number(keys[0]);
    item = r1Map[keys[0]];
  }

  const X =
    r1State.lr?.so_luot !== undefined
      ? Number(r1State.lr.so_luot)
      : Number(r1State.numPlayers) || 4;
  const A = Number(r1State.lr?.so_cau) || 0;
  let turnName = r1State.turnLabel;
  let relQues = idx;
  let totalTurn = keys.length || A;
  let turnTime = Number(r1State.lr?.thoi_gian ?? -1);

  if (A > 0 && X > 0 && idx <= X * A) {
    const pTurn = Math.ceil(idx / A);
    if (!turnName) turnName = `LƯỢT RIÊNG ${pTurn}`;
    relQues = idx - (pTurn - 1) * A;
    totalTurn = A;
    turnTime = Number(r1State.lr?.thoi_gian ?? -1);
  } else {
    let rem = idx - (A > 0 && X > 0 ? X * A : 0);
    const lcList = Array.isArray(r1State.lc) ? r1State.lc : [r1State.lc];
    let found = false;
    for (let c = 0; c < lcList.length; c++) {
      const B = Number(lcList[c]?.so_cau) || 12;
      if (rem <= B) {
        if (!turnName) turnName = `LƯỢT CHUNG ${c + 1}`;
        relQues = rem;
        totalTurn = B;
        turnTime = Number(lcList[c]?.thoi_gian ?? -1);
        found = true;
        break;
      }
      rem -= B;
    }
    if (!found && !turnName) turnName = "LƯỢT CHUNG";
  }

  const timeLabel = turnTime === -1 ? "VÔ HẠN" : `${turnTime}s`;
  const metaStr = `${turnName} - CÂU HỎI ${relQues}/${totalTurn}`;

  document.getElementById("hostRoundSub").textContent = metaStr;
  document.getElementById("r1HeaderMeta").textContent = metaStr;
  document.getElementById("r1HeaderTime").textContent = `THỜI GIAN: ${timeLabel}`;
  document.getElementById("r1QuestionText").textContent =
    item?.cau_hoi || r1State.customText || "Chưa có câu hỏi Vòng 1.";
  document.getElementById("r1AnswerText").textContent = item?.dap_an || "...";

  const activeP = r1State.activePlayer;
  for (let i = 1; i <= 4; i++) {
    const card = document.getElementById(`r1ScoreCard-${i}`);
    if (card) {
      card.classList.toggle("is-active", activeP !== null && Number(activeP) === i);
    }
  }
}

const unsubRound1 = onValue(ref(db, "games/round_1"), (snap) => {
  if (!snap.exists()) return;
  const d = snap.val();
  if (d.so_thi_sinh || d.numPlayers)
    r1State.numPlayers = Number(d.so_thi_sinh || d.numPlayers) || 4;
  if (d.luot_rieng) r1State.lr = { ...r1State.lr, ...d.luot_rieng };
  if (d.luot_chung) r1State.lc = d.luot_chung;
  if (d.current_ques || d.currentQuesIndex)
    r1State.quesIndex = Number(d.current_ques || d.currentQuesIndex) || 1;
  if (d.turnLabel || d.current_turn_label)
    r1State.turnLabel = String(d.turnLabel || d.current_turn_label);
  if (d.activePlayer !== undefined) {
    const ap = Number(d.activePlayer);
    r1State.activePlayer = ap >= 1 && ap <= 4 ? ap : null;
  }
  renderR1View();
});

let isInitialCommandSnapshot = true;
const unsubCommands = onValue(ref(db, "games/commands"), (snap) => {
  const isFirstLoad = isInitialCommandSnapshot;
  isInitialCommandSnapshot = false;

  if (!snap.exists() || state.activeTab !== "R1") return;
  const cmd = snap.val();
  if (!cmd || typeof cmd !== "object") return;

  const action = String(cmd.action || "");

  if (cmd.quesIndex !== undefined)
    r1State.quesIndex = Number(cmd.quesIndex) || r1State.quesIndex;
  if (cmd.roundText) r1State.turnLabel = String(cmd.roundText);
  if (!isFirstLoad && action === "active_player") {
    const pIdx = Number(cmd.index);
    r1State.activePlayer = pIdx >= 1 && pIdx <= 4 ? pIdx : null;
  } else if (
    action === "show_players" ||
    action === "reset_graphic" ||
    action === "reset_buzzers"
  ) {
    r1State.activePlayer = null;
  }
  if (action === "show_question" && cmd.text)
    r1State.customText = String(cmd.text);

  if (!isFirstLoad && (action === "start_5s" || action === "r1_start_5s")) {
    startR1Timer5s();
  } else if (
    action === "stop_5s" ||
    action === "r1_stop_5s" ||
    action === "reset_graphic" ||
    action === "reset_main_graphic"
  ) {
    stopR1Timer5s();
  }

  renderR1View();
});

window.renderActiveHostRound = renderR1View;
window.cleanupCurrentRound = () => {
  stopR1Timer5s();
  unsubRound1();
  unsubCommands();
  window.renderActiveHostRound = null;
};

renderR1View();