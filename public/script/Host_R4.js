import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const db = window.firebaseDB;
const state = window.HostState;

const r4State = {
  ptsLevel1: 20,
  ptsLevel2: 30,
  timeLevel1: 15,
  timeLevel2: 20,
  stealTime: 5,

  activePlayer: null,
  turnOrder: [],
  completedPlayers: [],
  packChoices: [null, null, null],
  chosenValues: [20, 20, 30],
  currentSlot: 0,
  slotStatuses: ["pending", "pending", "pending"],

  questionCode: "#1",
  questionText: "",
  answerText: "",
  mainTimerDisplayText: "15s",
  isStealTimerRunning: false,
  stealTimeLeft: 5,

  starActive: false,
  buzzerPlayer: null,
  buzzerGraded: false,
  buzzerLocked: true
};

function normalizeR4QuestionsFallback(raw) {
  if (!raw) return [];
  const list = [];

  if (!Array.isArray(raw) && (raw[20] || raw[30] || raw["20"] || raw["30"])) {
    [20, 30].forEach((pt) => {
      const group = raw[pt] || raw[String(pt)];
      if (group) {
        Object.values(group).forEach((q) => {
          if (q && (q.cau_hoi || q.question)) {
            list.push({
              cau_hoi: q.cau_hoi || q.question || "",
              dap_an: q.dap_an || q.answer || "",
              diem: Number(q.diem || q.muc_diem || q.point || pt)
            });
          }
        });
      }
    });
    return list;
  }

  const items = Array.isArray(raw) ? raw : Object.values(raw);
  items.forEach((q, idx) => {
    if (!q) return;
    const text = q.cau_hoi || q.question || "";
    const ans = q.dap_an || q.answer || "";
    if (!text && !ans) return;

    const inferredPt = idx % 6 < 3 ? r4State.ptsLevel1 : r4State.ptsLevel2;
    list.push({
      cau_hoi: text,
      dap_an: ans,
      diem: Number(q.diem || q.muc_diem || q.point || inferredPt)
    });
  });

  return list;
}

function getFallbackQuestionForSlot(slotIdx) {
  const allQuestions = normalizeR4QuestionsFallback(state.questions.round_4);
  const targetPts = Number(r4State.chosenValues[slotIdx]) || r4State.ptsLevel1;
  const matching = allQuestions.filter((q) => Number(q.diem) === targetPts);
  const pool = matching.length > 0 ? matching : allQuestions;

  if (pool.length === 0) {
    return {
      code: `#${slotIdx + 1}`,
      cau_hoi: "Chưa có dữ liệu câu hỏi Vòng 4.",
      dap_an: "..."
    };
  }

  const playerBaseIdx = r4State.activePlayer ? (Number(r4State.activePlayer) - 1) * 3 : 0;
  const rawIndex = playerBaseIdx + Number(slotIdx);
  const safeIndex = ((rawIndex % pool.length) + pool.length) % pool.length;

  return {
    code: `#${safeIndex + 1}/${pool.length}`,
    cau_hoi: pool[safeIndex].cau_hoi,
    dap_an: pool[safeIndex].dap_an
  };
}

function renderR4View() {
  if (state.activeTab !== "R4") return;

  const activeP = Number(r4State.activePlayer) || null;
  const slot = Math.min(2, Math.max(0, Number(r4State.currentSlot) || 0));
  const curPts = Number(r4State.chosenValues[slot]) || r4State.ptsLevel1;

  // 1. Thanh tiêu đề trên cùng của Host
  const subEl = document.getElementById("hostRoundSub");
  if (subEl) {
    if (activeP) {
      const pName = state.players[activeP]?.name || `P${activeP}`;
      subEl.textContent = `TS: ${pName} • CÂU ${slot + 1}/3 (${curPts}Đ)`;
    } else {
      subEl.textContent = "CHƯA CHỌN THÍ SINH";
    }
  }

  // 2. Render 4 thẻ thí sinh ở header + 4 thẻ bảng điểm bên phải
  for (let i = 1; i <= 4; i++) {
    const p = state.players[i] || { name: `P${i}`, score: 0 };
    const baseName = String(p.name || `P${i}`).trim() || `P${i}`;
    const turnIdx = r4State.turnOrder.indexOf(i);
    const isCompleted =
      r4State.completedPlayers.includes(i) || (turnIdx !== -1 && activeP !== i);
    const displayName = turnIdx !== -1 ? `[L${turnIdx + 1}] ${baseName}` : baseName;

    const headerPill = document.getElementById(`hostR4HeaderPlayer-${i}`);
    if (headerPill) {
      headerPill.textContent = displayName;
      headerPill.classList.toggle("active", activeP === i);
      headerPill.classList.toggle("played", isCompleted && activeP !== i);
    }

    const nameEl = document.getElementById(`r4PName-${i}`);
    const scoreEl = document.getElementById(`r4PScore-${i}`);
    const cardEl = document.getElementById(`r4PlayerCard-${i}`);

    if (nameEl) nameEl.textContent = displayName;
    if (scoreEl) scoreEl.textContent = String(Number(p.score) || 0);
    if (cardEl) {
      cardEl.classList.toggle("is-main-player", activeP === i);
      cardEl.classList.toggle("is-buzzer-player", Number(r4State.buzzerPlayer) === i);
      cardEl.classList.toggle("is-played", isCompleted && activeP !== i);
    }
  }

  // 3. Render 3 cụm gói câu hỏi (mỗi cụm 2 ô 20 / 30)
  document.querySelectorAll("#hostR4PackGrid .r4-pack-cluster").forEach((cluster) => {
    const s = Number(cluster.dataset.slot);
    const chosenLvl = r4State.packChoices[s];
    cluster.classList.toggle("has-choice", chosenLvl === 1 || chosenLvl === 2);
  });

  document.querySelectorAll("#hostR4PackGrid .r4-pack-cell").forEach((cell) => {
    const s = Number(cell.dataset.slot);
    const level = Number(cell.dataset.level);
    cell.textContent = String(level === 2 ? r4State.ptsLevel2 : r4State.ptsLevel1);
    cell.classList.toggle("selected", r4State.packChoices[s] === level);
  });

  // 4. Header của Question-box
  const turnBadge = document.getElementById("hostR4TurnBadge");
  if (turnBadge) {
    if (activeP) {
      const turnNum = Math.max(1, r4State.turnOrder.indexOf(activeP) + 1);
      turnBadge.textContent = `LƯỢT ${turnNum}:`;
    } else {
      turnBadge.textContent = "CHƯA CHỌN TS:";
    }
  }

  const quesNumText = document.getElementById("hostR4QuesNumText");
  if (quesNumText) {
    quesNumText.textContent = `CÂU ${slot + 1}/3`;
  }

  for (let s = 0; s < 3; s++) {
    const qValEl = document.getElementById(`hostR4HeaderQVal-${s}`);
    if (qValEl) {
      const val = r4State.chosenValues[s] ?? (s === 2 ? r4State.ptsLevel2 : r4State.ptsLevel1);
      qValEl.textContent = `C${s + 1}: ${val}đ`;
      qValEl.classList.toggle("active", slot === s);
      qValEl.classList.toggle("done-right", r4State.slotStatuses[s] === "right");
      qValEl.classList.toggle("done-wrong", r4State.slotStatuses[s] === "wrong");
    }
  }

  const fallbackQ = getFallbackQuestionForSlot(slot);
  const codeText = r4State.questionCode || fallbackQ.code;
  const quesText = r4State.questionText || fallbackQ.cau_hoi;
  const ansText = r4State.answerText || fallbackQ.dap_an;

  const slotCodeEl = document.getElementById("hostR4ActiveSlotCode");
  if (slotCodeEl) slotCodeEl.textContent = codeText;

  const timeBadgeEl = document.getElementById("hostR4TimeBadge");
  if (timeBadgeEl) timeBadgeEl.textContent = r4State.mainTimerDisplayText || "15s";

  // 5. Nội dung Câu hỏi & Đáp án
  const quesEl = document.getElementById("hostR4QuesText");
  const ansEl = document.getElementById("hostR4AnsText");
  if (quesEl) quesEl.textContent = quesText;
  if (ansEl) ansEl.textContent = ansText;

  // 6. Ngôi sao hi vọng & Đồng hồ 5s giành quyền
  const starBadge = document.getElementById("hostR4StarBadge");
  if (starBadge) {
    starBadge.classList.toggle("active", Boolean(r4State.starActive));
    starBadge.textContent = r4State.starActive ? "⭐ ĐANG BẬT NSHV" : "⭐ NSHV";
  }

  const box5s = document.getElementById("hostR4Timer5sBox");
  if (box5s) {
    box5s.classList.toggle("running", Boolean(r4State.isStealTimerRunning));
    box5s.textContent = String(
      r4State.isStealTimerRunning ? r4State.stealTimeLeft : r4State.stealTime
    );
  }

  // 7. Thanh trạng thái giành quyền bấm chuông ở Answer-box
  const stealStatusEl = document.getElementById("hostR4StealStatusText");
  if (stealStatusEl) {
    if (r4State.buzzerPlayer) {
      const bName = state.players[r4State.buzzerPlayer]?.name || `P${r4State.buzzerPlayer}`;
      stealStatusEl.textContent = r4State.buzzerGraded
        ? `🔔 ${bName} (ĐÃ CHẤM)`
        : `🔔 ${bName} GIÀNH QUYỀN!`;
    } else {
      stealStatusEl.textContent = r4State.buzzerLocked
        ? "Đang khóa chuông"
        : "Đang mở chuông...";
    }
  }
}

const unsubR4Config = onValue(ref(db, "games/round_4_config"), (snap) => {
  if (!snap.exists()) return;
  const cfg = snap.val();
  if (cfg.ptsLevel1 !== undefined) r4State.ptsLevel1 = Number(cfg.ptsLevel1) || 20;
  if (cfg.ptsLevel2 !== undefined) r4State.ptsLevel2 = Number(cfg.ptsLevel2) || 30;
  if (cfg.timeLevel1 !== undefined) r4State.timeLevel1 = Number(cfg.timeLevel1) || 15;
  if (cfg.timeLevel2 !== undefined) r4State.timeLevel2 = Number(cfg.timeLevel2) || 20;
  if (cfg.stealTime !== undefined) r4State.stealTime = Number(cfg.stealTime) || 5;
  renderR4View();
});

const unsubR4State = onValue(ref(db, "games/r4_state"), (snap) => {
  if (!snap.exists()) return;
  const d = snap.val();

  if (d.ptsLevel1 !== undefined) r4State.ptsLevel1 = Number(d.ptsLevel1) || 20;
  if (d.ptsLevel2 !== undefined) r4State.ptsLevel2 = Number(d.ptsLevel2) || 30;
  if (d.timeLevel1 !== undefined) r4State.timeLevel1 = Number(d.timeLevel1) || 15;
  if (d.timeLevel2 !== undefined) r4State.timeLevel2 = Number(d.timeLevel2) || 20;
  if (d.stealTime !== undefined) r4State.stealTime = Number(d.stealTime) || 5;

  r4State.activePlayer = d.activePlayer ? Number(d.activePlayer) : null;
  r4State.turnOrder = Array.isArray(d.turnOrder) ? d.turnOrder.map(Number) : [];
  r4State.completedPlayers = Array.isArray(d.completedPlayers)
    ? d.completedPlayers.map(Number)
    : [];

  if (Array.isArray(d.packChoices)) {
    r4State.packChoices = [0, 1, 2].map((s) =>
      d.packChoices[s] === 1 || d.packChoices[s] === 2 ? d.packChoices[s] : null
    );
  } else {
    r4State.packChoices = [null, null, null];
  }

  if (Array.isArray(d.chosenValues) && d.chosenValues.length === 3) {
    r4State.chosenValues = d.chosenValues.map(Number);
  }

  if (d.currentSlot !== undefined) {
    r4State.currentSlot = Math.min(2, Math.max(0, Number(d.currentSlot) || 0));
  } else if (d.activeSlot !== undefined) {
    r4State.currentSlot = Math.min(2, Math.max(0, Number(d.activeSlot) || 0));
  }

  if (Array.isArray(d.slotStatuses) && d.slotStatuses.length === 3) {
    r4State.slotStatuses = d.slotStatuses;
  } else {
    r4State.slotStatuses = ["pending", "pending", "pending"];
  }

  if (d.questionCode !== undefined) r4State.questionCode = String(d.questionCode);
  if (d.questionText !== undefined) r4State.questionText = String(d.questionText);
  if (d.answerText !== undefined) r4State.answerText = String(d.answerText);
  if (d.mainTimerDisplayText !== undefined) {
    r4State.mainTimerDisplayText = String(d.mainTimerDisplayText);
  }

  r4State.isStealTimerRunning = Boolean(d.isStealTimerRunning);
  if (d.stealTimeLeft !== undefined) {
    r4State.stealTimeLeft = Number(d.stealTimeLeft) || r4State.stealTime;
  }

  r4State.starActive = Boolean(d.starActive);
  r4State.buzzerPlayer = d.buzzerPlayer ? Number(d.buzzerPlayer) : null;
  r4State.buzzerGraded = Boolean(d.buzzerGraded);
  r4State.buzzerLocked = d.buzzerLocked !== undefined ? Boolean(d.buzzerLocked) : true;

  renderR4View();
});

window.renderActiveHostRound = renderR4View;
window.cleanupCurrentRound = () => {
  unsubR4Config();
  unsubR4State();
  window.renderActiveHostRound = null;
};

renderR4View();