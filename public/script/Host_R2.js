import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const db = window.firebaseDB;
const state = window.HostState;
const utils = window.HostUtils;
const r2Channel = new BroadcastChannel("olympia_r2_control");

const r2State = {
  selectedRowIndex: -1, // 0..4 hoặc -1 khi chưa chọn hàng nào
  questionText: "",
  imageUrl: "",
  showQuestion: false,
  show15s: false,
  rowStates: ["unselected", "unselected", "unselected", "unselected", "unselected"],
  imagePieces: [false, false, false, false, false],
  submissions: { 1: "", 2: "", 3: "", 4: "" },
  times: {},
  wrongAnswers: [false, false, false, false], // Chỉ true khi Controller bấm nút SAI cho thí sinh tương ứng
  buzzedPlayers: [] // Mảng chỉ số 0-based (0..3) giống Controller_R2.js
};

function formatCnvTitle(rawAnswer) {
  const clean = String(rawAnswer || "").replace(/\s+/g, "");
  const len = clean.length;
  if (len === 0) return "CHƯỚNG NGẠI VẬT CÓ 0 CHỮ CÁI";
  if (/^\p{L}+$/u.test(clean)) return `CHƯỚNG NGẠI VẬT CÓ ${len} CHỮ CÁI`;
  if (/^\d+$/.test(clean)) return `CHƯỚNG NGẠI VẬT CÓ ${len} CHỮ SỐ`;
  return `CHƯỚNG NGẠI VẬT CÓ ${len} KÝ TỰ`;
}

function getR2RowItem(r2, rowIndexZeroBased) {
  if (!r2 || typeof r2 !== "object" || rowIndexZeroBased < 0 || rowIndexZeroBased > 4) {
    return null;
  }
  const rowNum = rowIndexZeroBased + 1;
  if (r2[rowNum] && typeof r2[rowNum] === "object") return r2[rowNum];
  if (r2[String(rowNum)] && typeof r2[String(rowNum)] === "object") return r2[String(rowNum)];
  if (Array.isArray(r2) && r2[rowIndexZeroBased]) return r2[rowIndexZeroBased];
  return null;
}

function normalizeRowStates(rawRows) {
  const normalized = ["unselected", "unselected", "unselected", "unselected", "unselected"];
  if (!Array.isArray(rawRows)) return normalized;
  for (let i = 0; i < 5; i++) {
    const item = rawRows[i];
    if (typeof item === "string" && item.trim()) {
      normalized[i] = item.trim();
    } else if (item && typeof item === "object" && item.state) {
      normalized[i] = String(item.state).trim();
    }
  }
  return normalized;
}

function normalizeWrongAnswers(rawWrong) {
  if (Array.isArray(rawWrong)) {
    return [0, 1, 2, 3].map((idx) => rawWrong[idx] === true);
  }
  if (rawWrong && typeof rawWrong === "object") {
    return [0, 1, 2, 3].map((idx) => rawWrong[idx] === true);
  }
  return [false, false, false, false];
}

function applyR2ControlPayload(d, isFullSnapshot = false) {
  if (!d || typeof d !== "object") return;

  // 1. Trạng thái 5 hàng ngang
  if (Array.isArray(d.rows)) {
    r2State.rowStates = normalizeRowStates(d.rows);
    r2State.selectedRowIndex = r2State.rowStates.findIndex((st) => st === "selected");
  } else if (Array.isArray(d.rowStates)) {
    r2State.rowStates = normalizeRowStates(d.rowStates);
    r2State.selectedRowIndex = r2State.rowStates.findIndex((st) => st === "selected");
  } else if (d.selectedRowIndex !== undefined) {
    r2State.selectedRowIndex = Number(d.selectedRowIndex);
  }

  // 2. Câu hỏi, ảnh, trạng thái hiện câu hỏi & 15s
  if (d.question !== undefined) r2State.questionText = String(d.question || "");
  if (d.image !== undefined) r2State.imageUrl = String(d.image || "");

  if (d.showQuestion !== undefined) r2State.showQuestion = Boolean(d.showQuestion);
  else if (d.questionVisible !== undefined) r2State.showQuestion = Boolean(d.questionVisible);

  if (d.show15s !== undefined) r2State.show15s = Boolean(d.show15s);

  // 3. 5 miếng ghép hình ảnh
  if (Array.isArray(d.image_pieces)) {
    r2State.imagePieces = d.image_pieces.map(Boolean);
  } else if (Array.isArray(d.imagePieces)) {
    r2State.imagePieces = d.imagePieces.map(Boolean);
  } else if (Array.isArray(d.openedPieces)) {
    r2State.imagePieces = d.openedPieces.map(Boolean);
  }

  // 4. Danh sách bấm chuông CNV (0-based: [0..3])
  if (Array.isArray(d.buzzedPlayers)) {
    r2State.buzzedPlayers = d.buzzedPlayers
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0 && v <= 3);
  } else if (d.buzzedPlayers === null || (isFullSnapshot && d.buzzedPlayers === undefined)) {
    r2State.buzzedPlayers = [];
  }

  // 5. Đánh dấu đáp án SAI (chỉ lấy đúng theo chỉ số 0-based từ Controller)
  if (d.wrongAnswers !== undefined) {
    r2State.wrongAnswers = normalizeWrongAnswers(d.wrongAnswers);
  } else if (isFullSnapshot) {
    r2State.wrongAnswers = [false, false, false, false];
  }
}

function renderR2View() {
  if (state.activeTab !== "R2") return;

  const r2 = state.questions.round_2 || {};
  const cnvObj = r2.cnv || getR2RowItem(r2, 4) || {};
  const cnvAns = String(cnvObj.dap_an || "").trim();
  const imgUrl = String(
    cnvObj.image || getR2RowItem(r2, 0)?.image || r2State.imageUrl || "../graphic/o27/r2_target.png"
  ).trim();

  // 1. Ảnh CNV & 5 miếng ghép
  const targetImgEl = document.getElementById("hostR2TargetImg");
  if (targetImgEl && imgUrl && targetImgEl.getAttribute("src") !== imgUrl) {
    targetImgEl.style.display = "block";
    targetImgEl.src = imgUrl;
  }

  for (let p = 0; p < 5; p++) {
    const isHidden = Boolean(r2State.imagePieces[p]);
    const cpEl = document.getElementById(`host-r2-cp-${p + 1}`);
    const lblEl = document.getElementById(`host-r2-lbl-${p + 1}`);
    if (cpEl) cpEl.classList.toggle("hidden", isHidden);
    if (lblEl) lblEl.classList.toggle("hidden", isHidden);
  }

  // 2. Tiêu đề CNV & 5 hàng ngang
  const cnvTitleEl = document.getElementById("hostR2CnvTitle");
  if (cnvTitleEl) cnvTitleEl.textContent = formatCnvTitle(cnvAns);

  const cnvKeywordEl = document.getElementById("hostR2CnvKeyword");
  if (cnvKeywordEl) cnvKeywordEl.textContent = cnvAns || "---";

  for (let r = 0; r < 5; r++) {
    const rowData = getR2RowItem(r2, r) || {};
    const cleanAns = String(rowData.dap_an || "").replace(/\s+/g, "");
    const rowState = r2State.rowStates[r] || "unselected";
    const tilesWrap = document.getElementById(`hostR2Tiles-${r}`);

    if (tilesWrap) {
      if (tilesWrap.children.length !== cleanAns.length) {
        tilesWrap.replaceChildren();
        const frag = document.createDocumentFragment();
        for (let idx = 0; idx < cleanAns.length; idx++) {
          const tile = document.createElement("div");
          tile.className = `r2-host-char ${rowState}`;
          tile.textContent = cleanAns[idx] || "";
          frag.appendChild(tile);
        }
        tilesWrap.appendChild(frag);
      } else {
        const tiles = tilesWrap.querySelectorAll(".r2-host-char");
        tiles.forEach((tile, idx) => {
          tile.className = `r2-host-char ${rowState}`;
          tile.textContent = cleanAns[idx] || "";
        });
      }
    }
  }

  // 3. Khung câu hỏi & thông báo chuông CNV
  const selIdx = r2State.selectedRowIndex;
  const activeItem = selIdx >= 0 && selIdx <= 4 ? getR2RowItem(r2, selIdx) : null;

  let qTitle = "";
  if (selIdx === 4) qTitle = "CÂU HỎI HÀNG NGANG TRUNG TÂM (TT)";
  else if (selIdx >= 0 && selIdx <= 3) qTitle = `CÂU HỎI HÀNG NGANG ${selIdx + 1}`;

  const roundSubEl = document.getElementById("hostRoundSub");
  if (roundSubEl) roundSubEl.textContent = qTitle;

  const quesHeaderEl = document.getElementById("hostR2QuesHeader");
  if (quesHeaderEl) quesHeaderEl.textContent = qTitle;

  const timer15El = document.getElementById("hostR2Timer15Badge");
  if (timer15El) {
    timer15El.classList.toggle("is-running", Boolean(r2State.show15s));
  }

  const quesTextEl = document.getElementById("host-r2-q-text");
  if (quesTextEl) {
    const resolvedQ =
      selIdx !== -1
        ? String(activeItem?.cau_hoi || activeItem?.question || r2State.questionText || "").trim()
        : "";
    quesTextEl.textContent = resolvedQ;
    quesTextEl.style.opacity = r2State.showQuestion ? "1" : "0.3";
  }

  const buzzCornerEl = document.getElementById("hostR2BuzzerCorner");
  if (buzzCornerEl) {
    if (r2State.buzzedPlayers.length > 0) {
      const buzzNames = r2State.buzzedPlayers.map((idx, order) => {
        const pNum = idx + 1;
        const pName = String(state.players[pNum]?.name || `P${pNum}`).trim() || `P${pNum}`;
        return `${order + 1}. ${pName}`;
      });
      buzzCornerEl.textContent = `🔔 CHUÔNG CNV: ${buzzNames.join(" → ")}`;
      buzzCornerEl.style.display = "inline-flex";
    } else {
      buzzCornerEl.textContent = "";
      buzzCornerEl.style.display = "none";
    }
  }

  // 4. Bảng điểm 2x2 & Panel đáp án 4 thí sinh
  const subs = utils.extractPlayerEntries(
    r2State.submissions,
    r2State.times,
    null,
    null
  );

  for (let i = 0; i < 4; i++) {
    const pNum = i + 1;
    const pName = String(state.players[pNum]?.name || `P${pNum}`).trim() || `P${pNum}`;
    const pScore = Number(state.players[pNum]?.score) || 0;
    const isBuzzed = r2State.buzzedPlayers.includes(i);
    const sub = subs[pNum] || {};
    const isWrong = r2State.wrongAnswers[i] === true;
    const ansStr = String(sub.answer || "");
    const hasAns = Boolean(ansStr.trim());

    // Thẻ điểm 2x2
    const scoreCard = document.getElementById(`host-r2-score-${i}`);
    const scoreNameEl = document.getElementById(`host-r2-score-name-${i}`);
    const scoreValEl = document.getElementById(`host-r2-score-val-${i}`);
    if (scoreCard) scoreCard.classList.toggle("buzzed", isBuzzed);
    if (scoreNameEl) scoreNameEl.textContent = pName;
    if (scoreValEl) scoreValEl.textContent = String(pScore);

    // Thẻ đáp án cột phải
    const ansCard = document.getElementById(`host-r2-ans-card-${i}`);
    const ansNameEl = document.getElementById(`host-r2-ans-name-${i}`);
    const ansStatusEl = document.getElementById(`host-r2-ans-status-${i}`);
    const ansTextEl = document.getElementById(`host-r2-ans-text-${i}`);

    if (ansCard) {
      ansCard.classList.toggle("buzzed", isBuzzed);
      ansCard.classList.toggle("wrong", isWrong);
    }
    if (ansNameEl) ansNameEl.textContent = `${pNum}. ${pName}`;
    if (ansStatusEl) {
      ansStatusEl.textContent = hasAns ? "ĐÃ GỬI" : "TRỐNG";
      ansStatusEl.classList.toggle("has-answer", hasAns);
    }
    if (ansTextEl) ansTextEl.textContent = ansStr;
  }
}

const targetImg = document.getElementById("hostR2TargetImg");
if (targetImg) {
  targetImg.onerror = () => {
    targetImg.style.display = "none";
  };
  targetImg.onload = () => {
    targetImg.style.display = "block";
  };
}

r2Channel.onmessage = (event) => {
  if (!event?.data) return;
  applyR2ControlPayload(event.data, false);
  renderR2View();
};

const unsubR2Control = onValue(ref(db, "games/r2_control"), (snap) => {
  if (!snap.exists()) {
    r2State.wrongAnswers = [false, false, false, false];
    r2State.buzzedPlayers = [];
    renderR2View();
    return;
  }
  applyR2ControlPayload(snap.val(), true);
  renderR2View();
});

const unsubR2Answers = onValue(ref(db, "games/round_2/dap_an_thi_sinh"), (snap) => {
  r2State.submissions = snap.exists() ? snap.val() : { 1: "", 2: "", 3: "", 4: "" };
  renderR2View();
});

window.renderActiveHostRound = renderR2View;
window.cleanupCurrentRound = () => {
  unsubR2Control();
  unsubR2Answers();
  r2Channel.close();
  window.renderActiveHostRound = null;
};

renderR2View();