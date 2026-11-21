import { getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue, update, set, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const app = getApp();
const db = getDatabase(app);

// Dọn dẹp instance cũ nếu script được nạp lại khi chuyển tab trên Controller
if (typeof window.__r4DestroyInstance === 'function') {
    window.__r4DestroyInstance();
}

// =========================================================================
// 1. TRẠNG THÁI & CẤU HÌNH VÒNG 4
// =========================================================================
const r4State = {
    ptsLevel1: 20,
    ptsLevel2: 30,
    timeLevel1: 15,
    timeLevel2: 20,
    stealTime: 5,

    activePlayer: null,           // 1..4 (Thí sinh đang về đích)
    turnOrder: [],                // Thứ tự lượt thi của các thí sinh (VD: [2, 4, 1, 3])
    completedPlayers: [],         // Danh sách thí sinh đã thi xong lượt
    turnChosenValues: {},         // Lưu các mức điểm đã thi của từng thí sinh để tự tịnh tiến câu hỏi
    packChoices: [null, null, null], // Lựa chọn từng câu: null | 1 (mức 1: 20đ) | 2 (mức 2: 30đ)
    selectedPackIndices: [],      // Mảng tối đa 3 phần tử trong khoảng 0..5 gửi sang Livestream
    chosenValues: [20, 20, 30],
    currentSlot: 0,               // 0, 1, 2 (Câu 1, Câu 2, Câu 3)
    slotStatuses: ['pending', 'pending', 'pending'], // 'pending' | 'right' | 'wrong'
    slotQuestionOffset: [0, 0, 0], // Cho phép đổi câu hỏi trong ngân hàng đề

    playersShown: false,          // Trạng thái tên & điểm thí sinh đang hiện trên Livestream
    questionShown: false,         // Trạng thái câu hỏi đang hiện trên Livestream
    starActive: false,
    mainWrongDeducted: false,     // Đã trừ điểm NSHV cho thí sinh chính ở câu hiện tại chưa
    buzzerPlayer: null,           // 1..4 (Thí sinh bấm chuông giành quyền)
    buzzerGraded: false,          // Đã chấm đúng/sai cho lượt bấm chuông hiện tại chưa
    buzzerLocked: true,

    stage: 'idle'                 // 'idle' | 'pack' | 'ques'
};

let playersData = {
    1: { name: 'P1', score: 0 },
    2: { name: 'P2', score: 0 },
    3: { name: 'P3', score: 0 },
    4: { name: 'P4', score: 0 }
};

let allR4Questions = [];      // Danh sách câu hỏi từ Firebase questions/round_4
let mainTimerInterval = null;
let mainTimeLeft = 15;
let mainTimerDisplayText = '15s';
let isMainTimerPaused = false;

let stealTimerInterval = null;
let stealTimeLeft = 5;
let isStealTimerRunning = false;

let lastScoreTx = { key: '', time: 0 };
let eventsAbortController = null;
const unsubscribers = [];

function sendR4Command(payload) {
    update(ref(db, 'games/commands'), {
        round: 'R4',
        ...payload,
        timestamp: Date.now()
    });
}

function syncR4StateToDB() {
    set(ref(db, 'games/r4_state'), {
        ptsLevel1: r4State.ptsLevel1,
        ptsLevel2: r4State.ptsLevel2,
        activePlayer: r4State.activePlayer,
        turnOrder: r4State.turnOrder,
        completedPlayers: r4State.completedPlayers,
        selectedPackIndices: r4State.selectedPackIndices,
        chosenValues: r4State.chosenValues,
        currentSlot: r4State.currentSlot,
        playersShown: r4State.playersShown,
        questionShown: r4State.questionShown,
        starActive: r4State.starActive,
        buzzerPlayer: r4State.buzzerPlayer,
        buzzerLocked: r4State.buzzerLocked,
        stage: r4State.stage,
        timestamp: Date.now()
    });
}

function markActivePlayerCompleted() {
    const pIdx = r4State.activePlayer;
    if (!pIdx) return;

    r4State.turnChosenValues[pIdx] = [...r4State.chosenValues];
    if (!r4State.turnOrder.includes(pIdx)) {
        r4State.turnOrder.push(pIdx);
    }
    if (!r4State.completedPlayers.includes(pIdx)) {
        r4State.completedPlayers.push(pIdx);
    }
}

// Ánh xạ đúng theo cột từng câu:
// Câu 1 (s=0): mức 1 -> 0, mức 2 -> 3
// Câu 2 (s=1): mức 1 -> 1, mức 2 -> 4
// Câu 3 (s=2): mức 1 -> 2, mức 2 -> 5
function computeSelectedPackIndices() {
    const indices = [];
    for (let s = 0; s < 3; s++) {
        const lvl = r4State.packChoices[s];
        if (lvl === 1) {
            indices.push(s);
        } else if (lvl === 2) {
            indices.push(s + 3);
        }
    }
    return indices;
}

// =========================================================================
// 2. XỬ LÝ NGÂN HÀNG CÂU HỎI VÒNG 4 (questions/round_4)
// =========================================================================
function normalizeR4Questions(raw) {
    if (!raw) return [];
    const list = [];

    if (!Array.isArray(raw) && (raw[20] || raw[30] || raw['20'] || raw['30'])) {
        [20, 30].forEach(pt => {
            const group = raw[pt] || raw[String(pt)];
            if (group) {
                Object.values(group).forEach(q => {
                    if (q && (q.cau_hoi || q.question)) {
                        list.push({
                            cau_hoi: q.cau_hoi || q.question || '',
                            dap_an: q.dap_an || q.answer || '',
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
        const text = q.cau_hoi || q.question || '';
        const ans = q.dap_an || q.answer || '';
        if (!text && !ans) return;

        const inferredPt = ((idx % 6) < 3) ? r4State.ptsLevel1 : r4State.ptsLevel2;
        list.push({
            cau_hoi: text,
            dap_an: ans,
            diem: Number(q.diem || q.muc_diem || q.point || inferredPt)
        });
    });

    return list;
}

function getQuestionForSlot(slotIdx) {
    const targetPts = Number(r4State.chosenValues[slotIdx]) || r4State.ptsLevel1;
    const matching = allR4Questions.filter(q => Number(q.diem) === targetPts);
    const pool = matching.length > 0 ? matching : allR4Questions;

    if (pool.length === 0) {
        return {
            code: `#${slotIdx + 1}`,
            cau_hoi: `[Câu ${slotIdx + 1} - Gói ${targetPts} điểm] (Chưa có dữ liệu câu hỏi trong Firebase questions/round_4)`,
            dap_an: '...'
        };
    }

    const playerBaseIdx = r4State.activePlayer ? (Number(r4State.activePlayer) - 1) * 3 : 0;
    const rawIndex = playerBaseIdx + Number(slotIdx) + (r4State.slotQuestionOffset[slotIdx] || 0);
    const safeIndex = ((rawIndex % pool.length) + pool.length) % pool.length;

    return {
        code: `#${safeIndex + 1}/${pool.length}`,
        cau_hoi: pool[safeIndex].cau_hoi,
        dap_an: pool[safeIndex].dap_an
    };
}

// =========================================================================
// 3. KHỞI TẠO KHUNG DOM QUESTION-BOX, ANSWER-BOX & BẢNG ĐIỂM VÒNG 1
// =========================================================================
function ensureR4LayoutDOM() {
    const root = document.getElementById('r4-controller-ui');
    if (!root) return;

    root.innerHTML = `
      <div class="r4-left-col">
        <div class="r4-question-box">
          <div class="r4-question-header">
            <div class="r4-header-left">
              <span class="r4-header-turn" id="r4TurnBadge">CHỌN TS:</span>
              <div class="r4-header-players" id="r4HeaderPlayers">
                ${[1, 2, 3, 4].map(i => `
                  <button type="button" class="r4-h-player" id="r4HeaderPlayer-${i}" data-player="${i}" title="Chọn thí sinh ${i} về đích">P${i}</button>
                `).join('')}
              </div>
              <span class="r4-header-divider">|</span>
              <span class="r4-header-ques" id="r4QuesNumText">CÂU 1/3</span>
              <span class="r4-header-divider">|</span>
              <div class="r4-header-qvals" id="r4HeaderQVals">
                <button type="button" class="r4-h-qval active" id="r4HeaderQVal-0" data-slot="0" title="Chọn Câu 1">C1: 20đ</button>
                <button type="button" class="r4-h-qval" id="r4HeaderQVal-1" data-slot="1" title="Chọn Câu 2">C2: 20đ</button>
                <button type="button" class="r4-h-qval" id="r4HeaderQVal-2" data-slot="2" title="Chọn Câu 3">C3: 30đ</button>
              </div>
            </div>
            <div class="r4-header-right">
              <div class="r4-bank-nav" title="Đổi câu hỏi trong ngân hàng đề">
                <button type="button" class="r4-bank-nav-btn" id="r4BtnBankPrev">◀</button>
                <span class="r4-bank-code" id="r4ActiveSlotCode">#1</span>
                <button type="button" class="r4-bank-nav-btn" id="r4BtnBankNext">▶</button>
              </div>
              <span class="r4-header-time" id="r4TimeBadge">15s</span>
            </div>
          </div>

          <div class="r4-pack-bar">
            <span class="r4-pack-label">CHỌN GÓI:</span>
            <div class="r4-pack-clusters" id="r4PackGrid">
              ${[0, 1, 2].map(slot => `
                <div class="r4-pack-cluster" data-slot="${slot}">
                  <span class="r4-cluster-title">CÂU ${slot + 1}</span>
                  <div class="r4-cluster-btns">
                    <button type="button" class="r4-pack-cell" data-slot="${slot}" data-level="1">20</button>
                    <button type="button" class="r4-pack-cell" data-slot="${slot}" data-level="2">30</button>
                  </div>
                </div>
              `).join('')}
            </div>
            <button type="button" class="r4-pack-reset-btn" id="r4BtnResetPack" title="Bỏ chọn gói">↺</button>
          </div>

          <div class="r4-question-content" id="r4PreviewQuestion">Chọn thí sinh ở thanh trên và chọn gói 3 câu hỏi để bắt đầu...</div>

          <div class="r4-question-actions">
            <div class="r4-left-actions">
              <button type="button" class="r4-btn primary" id="r4BtnShowPack">HIỆN GÓI</button>
              <button type="button" class="r4-btn success" id="r4BtnConfirmPack">CHỌN GÓI</button>
              <button type="button" class="r4-btn primary" id="r4BtnShowPlayers">HIỆN TÊN TS</button>
              <button type="button" class="r4-btn primary" id="r4BtnShowQues">HIỆN CÂU HỎI</button>
              <button type="button" class="r4-btn" id="r4BtnPrevSlot">◀ LÙI</button>
              <button type="button" class="r4-btn" id="r4BtnNextSlot">TIẾP ▶</button>
              <button type="button" class="r4-btn warning" id="r4BtnStartMainTimer">▶ CHẠY ĐỒNG HỒ</button>
              <button type="button" class="r4-btn secondary r4-btn-icon" id="r4BtnResetMainTimer" title="Đặt lại đồng hồ">🔄</button>
              <button type="button" class="r4-btn danger" id="r4BtnResetGraphic">RESET ĐỒ HỌA</button>
            </div>
            <div class="r4-right-actions">
              <button type="button" class="r4-star-btn" id="r4BtnStar" title="Bật / Tắt Ngôi sao hi vọng">⭐ NSHV</button>
              <div class="r4-timer-5s-box" id="r4BtnTimer5s" title="Mở / Tắt 5s giành quyền trả lời">5</div>
            </div>
          </div>
        </div>

        <div class="r4-answer-box">
          <div class="r4-answer-content" id="r4PreviewAnswer">Đáp án</div>
          <div class="r4-answer-actions">
            <div class="r4-answer-left-actions">
              <span class="r4-steal-status" id="r4StealStatusText">Đang khóa chuông</span>
              <button type="button" class="r4-btn secondary" id="r4BtnClearBuzz">XÓA CHUÔNG</button>
            </div>
            <div class="r4-answer-right-actions">
              <button type="button" class="r4-btn score-btn success" id="r4BtnMainRight">✔ ĐÚNG</button>
              <button type="button" class="r4-btn score-btn danger" id="r4BtnMainWrong">✖ SAI</button>
            </div>
          </div>
        </div>
      </div>

      <div class="r4-right-col" id="r4PlayersList">
        ${[1, 2, 3, 4].map(i => `
          <div class="r4-player-card" id="r4PlayerCard-${i}" data-player="${i}" title="Click để bấm chuông giành quyền cho thí sinh ${i}">
            <div class="r4-p-name" id="r4PName-${i}">P${i}</div>
            <div class="r4-p-score" id="r4PScore-${i}">0</div>
          </div>
        `).join('')}
      </div>
    `;
}

// =========================================================================
// 4. CẬP NHẬT GIAO DIỆN CONTROLLER
// =========================================================================
function getDurationForPoints(pts) {
    return Number(pts) === Number(r4State.ptsLevel2) ? r4State.timeLevel2 : r4State.timeLevel1;
}

function updateMainTimerButtonUI() {
    const startBtn = document.getElementById('r4BtnStartMainTimer');
    if (!startBtn) return;

    if (!mainTimerInterval) {
        startBtn.textContent = '▶ CHẠY ĐỒNG HỒ';
    } else if (isMainTimerPaused) {
        startBtn.textContent = '▶ TIẾP TC';
    } else {
        startBtn.textContent = '⏸ TẠM DỪNG';
    }
}

function renderR4ControllerUI() {
    // 1. Render 4 nút chọn thí sinh ở header + 4 thẻ bảng điểm bên phải
    for (let i = 1; i <= 4; i++) {
        const p = playersData[i] || { name: `P${i}`, score: 0 };
        const headerBtn = document.getElementById(`r4HeaderPlayer-${i}`);
        const card = document.getElementById(`r4PlayerCard-${i}`);
        const nameEl = document.getElementById(`r4PName-${i}`);
        const scoreEl = document.getElementById(`r4PScore-${i}`);
        const turnIdx = r4State.turnOrder.indexOf(i);
        const isCompleted = r4State.completedPlayers.includes(i) || (turnIdx !== -1 && r4State.activePlayer !== i);
        const displayName = turnIdx !== -1 ? `[L${turnIdx + 1}] ${p.name}` : p.name;

        if (headerBtn) {
            headerBtn.textContent = displayName;
            headerBtn.title = `Chọn ${p.name} tham gia phần thi Về đích`;
            headerBtn.classList.toggle('active', r4State.activePlayer === i);
            headerBtn.classList.toggle('played', isCompleted && r4State.activePlayer !== i);
        }

        if (nameEl) nameEl.textContent = displayName;
        if (scoreEl) scoreEl.textContent = p.score;

        if (card) {
            const cannotBuzz = !r4State.activePlayer || r4State.activePlayer === i;
            card.classList.toggle('is-main-player', r4State.activePlayer === i);
            card.classList.toggle('is-buzzer-player', r4State.buzzerPlayer === i);
            card.classList.toggle('is-played', isCompleted && r4State.activePlayer !== i);
            card.classList.toggle('is-disabled-buzz', cannotBuzz);
            card.title = cannotBuzz
                ? (r4State.activePlayer === i ? `${p.name} đang thi chính` : 'Chọn thí sinh thi trước')
                : `Click để ${p.name} bấm chuông giành quyền`;
        }
    }

    // 2. Render 3 cụm chọn gói (mỗi cụm 2 nút 20 / 30)
    document.querySelectorAll('.r4-pack-cluster').forEach(cluster => {
        const slot = Number(cluster.dataset.slot);
        const chosenLvl = r4State.packChoices[slot];
        cluster.classList.toggle('has-choice', chosenLvl === 1 || chosenLvl === 2);
    });

    document.querySelectorAll('.r4-pack-cell').forEach(cell => {
        const slot = Number(cell.dataset.slot);
        const level = Number(cell.dataset.level);
        cell.textContent = level === 2 ? r4State.ptsLevel2 : r4State.ptsLevel1;
        cell.classList.toggle('selected', r4State.packChoices[slot] === level);
    });

    // 3. Render Header của Question-box
    const turnBadge = document.getElementById('r4TurnBadge');
    const quesNumText = document.getElementById('r4QuesNumText');
    const activeSlotCode = document.getElementById('r4ActiveSlotCode');
    const timeBadge = document.getElementById('r4TimeBadge');

    if (turnBadge) {
        if (r4State.activePlayer) {
            const turnNum = r4State.turnOrder.indexOf(r4State.activePlayer) + 1;
            turnBadge.textContent = `LƯỢT ${turnNum}:`;
        } else {
            turnBadge.textContent = 'CHỌN TS:';
        }
    }

    if (quesNumText) {
        quesNumText.textContent = `CÂU ${r4State.currentSlot + 1}/3`;
    }

    for (let s = 0; s < 3; s++) {
        const qValBtn = document.getElementById(`r4HeaderQVal-${s}`);
        if (qValBtn) {
            qValBtn.textContent = `C${s + 1}: ${r4State.chosenValues[s]}đ`;
            qValBtn.classList.toggle('active', r4State.currentSlot === s);
            qValBtn.classList.toggle('done-right', r4State.slotStatuses[s] === 'right');
            qValBtn.classList.toggle('done-wrong', r4State.slotStatuses[s] === 'wrong');
        }
    }

    const activeQ = getQuestionForSlot(r4State.currentSlot);
    if (activeSlotCode) {
        activeSlotCode.textContent = activeQ.code;
    }

    if (timeBadge) {
        timeBadge.textContent = mainTimerDisplayText;
    }

    // 4. Nội dung Câu hỏi & Đáp án trong 2 box
    const qPrev = document.getElementById('r4PreviewQuestion');
    const aPrev = document.getElementById('r4PreviewAnswer');
    if (qPrev) qPrev.textContent = activeQ.cau_hoi;
    if (aPrev) aPrev.textContent = `${activeQ.dap_an}`;

    // 5. Cập nhật trạng thái nút Toggle HIỆN / ẨN TÊN TS & HIỆN / ẨN CÂU HỎI
    const btnShowPlayers = document.getElementById('r4BtnShowPlayers');
    if (btnShowPlayers) {
        btnShowPlayers.textContent = r4State.playersShown ? 'ẨN TÊN TS' : 'HIỆN TÊN TS';
        btnShowPlayers.classList.toggle('active', r4State.playersShown);
    }

    const btnShowQues = document.getElementById('r4BtnShowQues');
    if (btnShowQues) {
        btnShowQues.textContent = r4State.questionShown ? 'ẨN CÂU HỎI' : 'HIỆN CÂU HỎI';
        btnShowQues.classList.toggle('active', r4State.questionShown);
    }

    // 6. Ngôi sao hi vọng & Nút lùi/tiếp
    const starBtn = document.getElementById('r4BtnStar');
    if (starBtn) {
        starBtn.classList.toggle('active', r4State.starActive);
        starBtn.textContent = r4State.starActive ? '⭐ ĐANG BẬT NSHV' : '⭐ NSHV';
    }

    const prevBtn = document.getElementById('r4BtnPrevSlot');
    if (prevBtn) {
        prevBtn.disabled = r4State.currentSlot <= 0;
    }

    updateMainTimerButtonUI();

    // 7. Trạng thái giành quyền bấm chuông & 2 nút ĐÚNG / SAI hợp nhất
    const stealStatus = document.getElementById('r4StealStatusText');
    const btnRight = document.getElementById('r4BtnMainRight');
    const btnWrong = document.getElementById('r4BtnMainWrong');

    if (r4State.buzzerPlayer) {
        const bName = playersData[r4State.buzzerPlayer]?.name || `P${r4State.buzzerPlayer}`;
        if (stealStatus) {
            stealStatus.textContent = r4State.buzzerGraded
                ? `🔔 ${bName} (ĐÃ CHẤM)`
                : `🔔 ${bName} GIÀNH QUYỀN!`;
        }
        if (btnRight) btnRight.disabled = r4State.buzzerGraded;
        if (btnWrong) btnWrong.disabled = r4State.buzzerGraded;
    } else {
        if (stealStatus) {
            stealStatus.textContent = r4State.buzzerLocked ? 'Đang khóa chuông' : 'Đang mở chuông...';
        }
        if (btnRight) btnRight.disabled = r4State.slotStatuses[r4State.currentSlot] === 'right';
        if (btnWrong) btnWrong.disabled = false;
    }
}

// =========================================================================
// 5. ĐỒNG HỒ CÂU HỎI (15s / 20s) & ĐỒNG HỒ GIÀNH QUYỀN (5s)
// =========================================================================
function stopMainTimer(hideVideo = true, pauseVideo = false) {
    if (mainTimerInterval) {
        clearInterval(mainTimerInterval);
        mainTimerInterval = null;
    }
    isMainTimerPaused = false;
    updateMainTimerButtonUI();
    if (hideVideo) {
        sendR4Command({ action: 'r4_stop_timer' });
    } else if (pauseVideo) {
        sendR4Command({ action: 'r4_pause_timer' });
    }
}

function startMainTimer() {
    stopMainTimer(false, false);
    stopStealTimer();

    const curPts = r4State.chosenValues[r4State.currentSlot] || r4State.ptsLevel1;
    mainTimeLeft = getDurationForPoints(curPts);
    mainTimerDisplayText = `${mainTimeLeft}s`;
    isMainTimerPaused = false;

    const timeBadge = document.getElementById('r4TimeBadge');
    if (timeBadge) timeBadge.textContent = mainTimerDisplayText;

    sendR4Command({
        action: 'r4_start_timer',
        duration: mainTimeLeft
    });

    if (typeof window.playMusic === 'function') {
        if (mainTimeLeft === 15) window.playMusic('R4_15s.mp3', false, false);
        else if (mainTimeLeft === 20) window.playMusic('R4_20s.mp3', false, false);
        else if (mainTimeLeft === 30) window.playMusic('R4_30s.mp3', false, false);
    }

    mainTimerInterval = setInterval(() => {
        if (isMainTimerPaused) return;
        mainTimeLeft--;
        if (mainTimeLeft > 0) {
            mainTimerDisplayText = `${mainTimeLeft}s`;
            if (timeBadge) timeBadge.textContent = mainTimerDisplayText;
        } else {
            mainTimerDisplayText = 'HẾT GIỜ!';
            if (timeBadge) timeBadge.textContent = mainTimerDisplayText;
            stopMainTimer(false, false);
        }
    }, 1000);

    updateMainTimerButtonUI();
}

function togglePauseMainTimer() {
    if (!mainTimerInterval) return;
    isMainTimerPaused = !isMainTimerPaused;
    mainTimerDisplayText = isMainTimerPaused
        ? `DỪNG (${mainTimeLeft}s)`
        : `${mainTimeLeft}s`;
    const timeBadge = document.getElementById('r4TimeBadge');
    if (timeBadge) {
        timeBadge.textContent = mainTimerDisplayText;
    }
    sendR4Command({
        action: isMainTimerPaused ? 'r4_pause_timer' : 'r4_resume_timer'
    });
    updateMainTimerButtonUI();
}

function resetMainTimer() {
    stopMainTimer(true, false);
    const curPts = r4State.chosenValues[r4State.currentSlot] || r4State.ptsLevel1;
    mainTimeLeft = getDurationForPoints(curPts);
    mainTimerDisplayText = `${mainTimeLeft}s`;
    const timeBadge = document.getElementById('r4TimeBadge');
    if (timeBadge) timeBadge.textContent = mainTimerDisplayText;
}

function stopStealTimer() {
    if (stealTimerInterval) {
        clearInterval(stealTimerInterval);
        stealTimerInterval = null;
    }
    isStealTimerRunning = false;

    const box5s = document.getElementById('r4BtnTimer5s');
    if (box5s) {
        box5s.classList.remove('running');
        box5s.textContent = r4State.stealTime;
    }
}

function startSteal5sTimer() {
    stopMainTimer(false, true);
    stopStealTimer();

    isStealTimerRunning = true;
    stealTimeLeft = r4State.stealTime;
    r4State.buzzerLocked = false;
    r4State.buzzerPlayer = null;
    r4State.buzzerGraded = false;
    set(ref(db, 'games/r4_buzzer'), null);
    syncR4StateToDB();
    renderR4ControllerUI();

    if (typeof window.playMusic === 'function') {
        window.playMusic('R4_5s.mp3', false, false);
    }

    const box5s = document.getElementById('r4BtnTimer5s');
    const timeBadge = document.getElementById('r4TimeBadge');
    mainTimerDisplayText = `CHUÔNG: ${stealTimeLeft}s`;
    if (box5s) {
        box5s.classList.add('running');
        box5s.textContent = stealTimeLeft;
    }
    if (timeBadge) timeBadge.textContent = mainTimerDisplayText;

    stealTimerInterval = setInterval(() => {
        stealTimeLeft--;
        if (stealTimeLeft > 0) {
            mainTimerDisplayText = `CHUÔNG: ${stealTimeLeft}s`;
            if (box5s) box5s.textContent = stealTimeLeft;
            if (timeBadge) timeBadge.textContent = mainTimerDisplayText;
        } else {
            stopStealTimer();
            r4State.buzzerLocked = true;
            mainTimerDisplayText = 'HẾT 5s';
            syncR4StateToDB();
            renderR4ControllerUI();
            if (timeBadge) timeBadge.textContent = mainTimerDisplayText;
        }
    }, 1000);
}

// =========================================================================
// 6. LOGIC TÍNH ĐIỂM CHUẨN LUẬT VỀ ĐÍCH (1 CẶP NÚT ĐÚNG / SAI)
// =========================================================================
function addScoreToPlayer(playerIdx, delta) {
    const pIdx = Number(playerIdx);
    const ptsDelta = Number(delta);
    if (!pIdx || !ptsDelta) return;

    const now = Date.now();
    const txKey = `${pIdx}_${ptsDelta}`;
    if (lastScoreTx.key === txKey && (now - lastScoreTx.time) < 300) {
        return;
    }
    lastScoreTx = { key: txKey, time: now };

    runTransaction(ref(db, `games/players/${pIdx}/score`), (cur) => {
        return (Number(cur) || 0) + ptsDelta;
    });
}

function handleUnifiedRight() {
    if (!r4State.activePlayer) {
        alert('Vui lòng chọn thí sinh đang về đích ở thanh trên trước!');
        return;
    }

    const pts = Number(r4State.chosenValues[r4State.currentSlot]) || r4State.ptsLevel1;

    // TRƯỜNG HỢP 1: CÓ THÍ SINH KHÁC BẤM CHUÔNG -> ÁP DỤNG LUẬT CƯỚP ĐIỂM
    if (r4State.buzzerPlayer) {
        if (r4State.buzzerGraded) return;

        const stealPlayer = r4State.buzzerPlayer;
        r4State.buzzerGraded = true;
        r4State.buzzerLocked = true;
        r4State.slotStatuses[r4State.currentSlot] = 'wrong';

        stopMainTimer(false, true);
        stopStealTimer();

        addScoreToPlayer(stealPlayer, pts);

        if (!r4State.starActive) {
            addScoreToPlayer(r4State.activePlayer, -pts);
        } else if (!r4State.mainWrongDeducted) {
            addScoreToPlayer(r4State.activePlayer, -pts);
            r4State.mainWrongDeducted = true;
        }

        if (r4State.starActive) {
            r4State.starActive = false;
            sendR4Command({ action: 'r4_toggle_star', active: false });
        }

        if (typeof window.playMusic === 'function') {
            window.playMusic('R4_Right.mp3', false, false);
        }

        syncR4StateToDB();
        renderR4ControllerUI();
        return;
    }

    // TRƯỜNG HỢP 2: KHÔNG CÓ THÍ SINH KHÁC BẤM CHUÔNG -> THÍ SINH CHÍNH ĐÚNG
    if (r4State.slotStatuses[r4State.currentSlot] === 'right') {
        return;
    }

    r4State.slotStatuses[r4State.currentSlot] = 'right';
    r4State.buzzerLocked = true;

    stopMainTimer(false, true);
    stopStealTimer();

    const reward = r4State.starActive ? pts * 2 : pts;
    addScoreToPlayer(r4State.activePlayer, reward);

    if (r4State.starActive) {
        r4State.starActive = false;
        sendR4Command({ action: 'r4_toggle_star', active: false });
    }

    if (typeof window.playMusic === 'function') {
        window.playMusic('R4_Right.mp3', false, false);
    }

    syncR4StateToDB();
    renderR4ControllerUI();
}

function handleUnifiedWrong() {
    if (!r4State.activePlayer) {
        alert('Vui lòng chọn thí sinh đang về đích ở thanh trên trước!');
        return;
    }

    const pts = Number(r4State.chosenValues[r4State.currentSlot]) || r4State.ptsLevel1;

    // TRƯỜNG HỢP 1: CÓ THÍ SINH KHÁC BẤM CHUÔNG -> NGƯỜI BẤM CHUÔNG SAI (-1/2 ĐIỂM CÂU HỎI)
    if (r4State.buzzerPlayer) {
        if (r4State.buzzerGraded) return;

        const stealPlayer = r4State.buzzerPlayer;
        r4State.buzzerGraded = true;
        r4State.buzzerLocked = true;
        r4State.slotStatuses[r4State.currentSlot] = 'wrong';

        stopMainTimer(false, true);
        stopStealTimer();

        if (r4State.starActive && !r4State.mainWrongDeducted) {
            addScoreToPlayer(r4State.activePlayer, -pts);
            r4State.mainWrongDeducted = true;
        }

        const penalty = pts / 2;
        addScoreToPlayer(stealPlayer, -penalty);

        if (r4State.starActive) {
            r4State.starActive = false;
            sendR4Command({ action: 'r4_toggle_star', active: false });
        }

        if (typeof window.playMusic === 'function') {
            window.playMusic('R4_Wrong.mp3', false, false);
        }

        syncR4StateToDB();
        renderR4ControllerUI();
        return;
    }

    // TRƯỜNG HỢP 2: KHÔNG CÓ THÍ SINH KHÁC BẤM CHUÔNG -> THÍ SINH CHÍNH SAI & CHẠY 5S MỞ CHUÔNG
    stopMainTimer(false, true);
    r4State.slotStatuses[r4State.currentSlot] = 'wrong';

    if (r4State.starActive && !r4State.mainWrongDeducted) {
        addScoreToPlayer(r4State.activePlayer, -pts);
        r4State.mainWrongDeducted = true;
    }

    startSteal5sTimer();
}

function triggerStealBuzz(playerIdx) {
    if (!r4State.activePlayer || playerIdx === r4State.activePlayer) return;
    if (r4State.buzzerGraded || r4State.buzzerPlayer === playerIdx) return;

    stopStealTimer();

    r4State.buzzerPlayer = playerIdx;
    r4State.buzzerGraded = false;
    r4State.buzzerLocked = true;

    if (typeof window.playMusic === 'function') {
        window.playMusic('R4_Buzzed.mp3', false, false);
    }

    sendR4Command({
        action: 'r4_update_buzzer',
        buzzerPlayer: playerIdx,
        activePlayer: r4State.activePlayer
    });

    syncR4StateToDB();
    renderR4ControllerUI();
}

function clearStealBuzz() {
    r4State.buzzerPlayer = null;
    r4State.buzzerGraded = false;
    set(ref(db, 'games/r4_buzzer'), null);

    sendR4Command({
        action: 'r4_update_buzzer',
        buzzerPlayer: null,
        activePlayer: r4State.activePlayer
    });

    syncR4StateToDB();
    renderR4ControllerUI();
}

// =========================================================================
// 7. GẮN SỰ KIỆN GIAO DIỆN & MODAL CÀI ĐẶT
// =========================================================================
function selectActivePlayer(pIdx) {
    if (!pIdx || r4State.activePlayer === pIdx) return;

    if (r4State.activePlayer && r4State.activePlayer !== pIdx) {
        r4State.turnChosenValues[r4State.activePlayer] = [...r4State.chosenValues];
        if (r4State.stage === 'ques' || r4State.slotStatuses.some(s => s !== 'pending')) {
            markActivePlayerCompleted();
        }
    }

    r4State.completedPlayers = r4State.completedPlayers.filter(id => id !== pIdx);

    if (!r4State.turnOrder.includes(pIdx)) {
        r4State.turnOrder.push(pIdx);
    }

    r4State.activePlayer = pIdx;
    r4State.stage = 'idle';
    r4State.packChoices = [null, null, null];
    r4State.selectedPackIndices = [];
    r4State.chosenValues = [r4State.ptsLevel1, r4State.ptsLevel1, r4State.ptsLevel2];
    r4State.currentSlot = 0;
    r4State.slotStatuses = ['pending', 'pending', 'pending'];
    r4State.slotQuestionOffset = [0, 0, 0];
    r4State.playersShown = false;
    r4State.questionShown = false;
    r4State.starActive = false;
    r4State.mainWrongDeducted = false;
    r4State.buzzerPlayer = null;
    r4State.buzzerGraded = false;
    r4State.buzzerLocked = true;

    mainTimeLeft = r4State.timeLevel1;
    mainTimerDisplayText = `${mainTimeLeft}s`;

    set(ref(db, 'games/r4_buzzer'), null);
    stopMainTimer(false, false);
    stopStealTimer();

    sendR4Command({ action: 'reset_graphic' });
    syncR4StateToDB();
    renderR4ControllerUI();
}

function syncQuestionToLivestreamIfShown() {
    if (!r4State.questionShown) return;
    const qData = getQuestionForSlot(r4State.currentSlot);
    sendR4Command({
        action: 'r4_show_question',
        slotIndex: r4State.currentSlot,
        questionText: qData.cau_hoi,
        pointValue: r4State.chosenValues[r4State.currentSlot]
    });
}

function switchToSlot(slotIdx) {
    const targetSlot = Math.max(0, Math.min(2, Number(slotIdx)));
    r4State.currentSlot = targetSlot;
    r4State.mainWrongDeducted = false;

    if (r4State.starActive) {
        r4State.starActive = false;
        sendR4Command({ action: 'r4_toggle_star', active: false });
    }
    clearStealBuzz();
    stopStealTimer();
    resetMainTimer();
    syncQuestionToLivestreamIfShown();
    syncR4StateToDB();
    renderR4ControllerUI();
}

function bindR4Events() {
    if (eventsAbortController) {
        eventsAbortController.abort();
    }
    eventsAbortController = new AbortController();
    const { signal } = eventsAbortController;

    // Chọn thí sinh tham gia phần thi ở header của question-box
    document.querySelectorAll('.r4-h-player').forEach(btn => {
        btn.addEventListener('click', () => {
            selectActivePlayer(Number(btn.dataset.player));
        }, { signal });
    });

    // Click vào thẻ bảng điểm bên cột phải để bấm chuông giành quyền trả lời
    document.querySelectorAll('.r4-player-card').forEach(card => {
        card.addEventListener('click', () => {
            const pIdx = Number(card.dataset.player);
            triggerStealBuzz(pIdx);
        }, { signal });
    });

    // Chọn / đổi / bỏ chọn mốc điểm (20 hoặc 30) cho từng câu trong 3 cụm
    document.querySelectorAll('.r4-pack-cell').forEach(cell => {
        cell.addEventListener('click', () => {
            const slot = Number(cell.dataset.slot);
            const level = Number(cell.dataset.level);

            if (r4State.packChoices[slot] === level) {
                r4State.packChoices[slot] = null;
            } else {
                r4State.packChoices[slot] = level;
            }

            r4State.selectedPackIndices = computeSelectedPackIndices();
            r4State.chosenValues = [0, 1, 2].map(s => {
                const lvl = r4State.packChoices[s];
                return lvl === 2 ? r4State.ptsLevel2 : r4State.ptsLevel1;
            });

            if (r4State.activePlayer) {
                r4State.turnChosenValues[r4State.activePlayer] = [...r4State.chosenValues];
            }

            sendR4Command({
                action: 'r4_update_pack_selection',
                selectedIndices: r4State.selectedPackIndices
            });
            syncR4StateToDB();
            renderR4ControllerUI();
        }, { signal });
    });

    // Bỏ chọn lại toàn bộ 3 cụm gói
    document.getElementById('r4BtnResetPack')?.addEventListener('click', () => {
        r4State.packChoices = [null, null, null];
        r4State.selectedPackIndices = [];
        r4State.chosenValues = [r4State.ptsLevel1, r4State.ptsLevel1, r4State.ptsLevel1];
        sendR4Command({
            action: 'r4_update_pack_selection',
            selectedIndices: []
        });
        syncR4StateToDB();
        renderR4ControllerUI();
    }, { signal });

    // 1. Nút HIỆN GÓI
    document.getElementById('r4BtnShowPack')?.addEventListener('click', () => {
        r4State.stage = 'pack';
        r4State.playersShown = false;
        r4State.questionShown = false;
        r4State.starActive = false;
        r4State.mainWrongDeducted = false;
        r4State.buzzerPlayer = null;
        r4State.buzzerGraded = false;

        if (typeof window.playMusic === 'function') {
            window.playMusic('R4_ShowPack.mp3', false, false);
        }

        sendR4Command({
            action: 'r4_show_pack',
            ptsLevel1: r4State.ptsLevel1,
            ptsLevel2: r4State.ptsLevel2,
            selectedIndices: r4State.selectedPackIndices
        });
        syncR4StateToDB();
        renderR4ControllerUI();
    }, { signal });

    // 2. Nút CHỌN GÓI
    document.getElementById('r4BtnConfirmPack')?.addEventListener('click', () => {
        if (!r4State.activePlayer) {
            alert('Vui lòng chọn thí sinh đang về đích ở thanh trên!');
            return;
        }
        if (r4State.packChoices.some(lvl => lvl === null)) {
            alert('Vui lòng chọn đủ 3 câu hỏi trước khi bấm Chọn gói!');
            return;
        }

        r4State.turnChosenValues[r4State.activePlayer] = [...r4State.chosenValues];
        r4State.stage = 'ques';
        r4State.currentSlot = 0;
        r4State.slotStatuses = ['pending', 'pending', 'pending'];
        r4State.playersShown = false;
        r4State.questionShown = false;
        r4State.starActive = false;
        r4State.mainWrongDeducted = false;
        r4State.buzzerPlayer = null;
        r4State.buzzerGraded = false;

        const firstDur = getDurationForPoints(r4State.chosenValues[0]);
        mainTimeLeft = firstDur;
        mainTimerDisplayText = `${firstDur}s`;

        if (typeof window.playMusic === 'function') {
            window.playMusic('R4_ShowQues.mp3', false, false);
        }

        sendR4Command({
            action: 'r4_show_ques_stage',
            activePlayer: r4State.activePlayer,
            players: playersData,
            chosenValues: r4State.chosenValues
        });
        syncR4StateToDB();
        renderR4ControllerUI();
    }, { signal });

    // 3. Nút Toggle HIỆN / ẨN TÊN THÍ SINH
    document.getElementById('r4BtnShowPlayers')?.addEventListener('click', () => {
        if (!r4State.activePlayer) {
            alert('Vui lòng chọn thí sinh đang về đích ở thanh trên trước!');
            return;
        }

        r4State.playersShown = !r4State.playersShown;

        if (r4State.playersShown) {
            r4State.turnChosenValues[r4State.activePlayer] = [...r4State.chosenValues];
            r4State.stage = 'ques';
            sendR4Command({
                action: 'r4_show_players',
                activePlayer: r4State.activePlayer,
                players: playersData,
                chosenValues: r4State.chosenValues
            });
        } else {
            sendR4Command({
                action: 'r4_hide_players'
            });
        }

        syncR4StateToDB();
        renderR4ControllerUI();
    }, { signal });

    // 4. Nút Toggle HIỆN / ẨN CÂU HỎI
    document.getElementById('r4BtnShowQues')?.addEventListener('click', () => {
        r4State.questionShown = !r4State.questionShown;

        if (r4State.questionShown) {
            const qData = getQuestionForSlot(r4State.currentSlot);
            sendR4Command({
                action: 'r4_show_question',
                slotIndex: r4State.currentSlot,
                questionText: qData.cau_hoi,
                pointValue: r4State.chosenValues[r4State.currentSlot]
            });
        } else {
            sendR4Command({
                action: 'r4_hide_question'
            });
        }

        syncR4StateToDB();
        renderR4ControllerUI();
    }, { signal });

    // 5. Nút LÙI CÂU (◀ LÙI)
    document.getElementById('r4BtnPrevSlot')?.addEventListener('click', () => {
        if (r4State.currentSlot <= 0) return;

        if (r4State.starActive) {
            r4State.starActive = false;
            sendR4Command({ action: 'r4_toggle_star', active: false });
        }
        clearStealBuzz();
        stopStealTimer();

        r4State.currentSlot--;
        r4State.mainWrongDeducted = false;
        resetMainTimer();
        syncQuestionToLivestreamIfShown();
        syncR4StateToDB();
        renderR4ControllerUI();
    }, { signal });

    // 6. Nút CÂU TIẾP (TIẾP ▶)
    document.getElementById('r4BtnNextSlot')?.addEventListener('click', () => {
        if (r4State.starActive) {
            r4State.starActive = false;
            sendR4Command({ action: 'r4_toggle_star', active: false });
        }
        clearStealBuzz();
        stopStealTimer();

        if (r4State.currentSlot < 2) {
            r4State.currentSlot++;
            r4State.mainWrongDeducted = false;
            resetMainTimer();
            syncQuestionToLivestreamIfShown();
        } else {
            stopMainTimer(false, false);
            markActivePlayerCompleted();
            r4State.activePlayer = null;
            r4State.stage = 'idle';
            r4State.playersShown = false;
            r4State.questionShown = false;
            r4State.mainWrongDeducted = false;
            r4State.buzzerLocked = true;
            set(ref(db, 'games/r4_buzzer'), null);
            sendR4Command({ action: 'reset_graphic' });
        }
        syncR4StateToDB();
        renderR4ControllerUI();
    }, { signal });

    // Chọn nhanh Câu 1 / Câu 2 / Câu 3 trên header
    document.querySelectorAll('.r4-h-qval').forEach(btn => {
        btn.addEventListener('click', () => {
            switchToSlot(Number(btn.dataset.slot));
        }, { signal });
    });

    // Đổi câu hỏi trong ngân hàng đề (◀ / ▶ trên header)
    document.getElementById('r4BtnBankPrev')?.addEventListener('click', () => {
        const s = r4State.currentSlot;
        r4State.slotQuestionOffset[s] = (r4State.slotQuestionOffset[s] || 0) - 1;
        syncQuestionToLivestreamIfShown();
        renderR4ControllerUI();
    }, { signal });

    document.getElementById('r4BtnBankNext')?.addEventListener('click', () => {
        const s = r4State.currentSlot;
        r4State.slotQuestionOffset[s] = (r4State.slotQuestionOffset[s] || 0) + 1;
        syncQuestionToLivestreamIfShown();
        renderR4ControllerUI();
    }, { signal });

    // 7. Nút CHẠY ĐỒNG HỒ & Reset đồng hồ
    document.getElementById('r4BtnStartMainTimer')?.addEventListener('click', () => {
        if (!mainTimerInterval) {
            startMainTimer();
        } else {
            togglePauseMainTimer();
        }
    }, { signal });

    document.getElementById('r4BtnResetMainTimer')?.addEventListener('click', resetMainTimer, { signal });

    // 8. Nút RESET ĐỒ HỌA
    document.getElementById('r4BtnResetGraphic')?.addEventListener('click', () => {
        stopMainTimer(false, false);
        stopStealTimer();

        if (r4State.activePlayer && (r4State.stage === 'ques' || r4State.slotStatuses.some(s => s !== 'pending'))) {
            markActivePlayerCompleted();
            r4State.activePlayer = null;
        }

        r4State.stage = 'idle';
        r4State.playersShown = false;
        r4State.questionShown = false;
        r4State.starActive = false;
        r4State.mainWrongDeducted = false;
        r4State.buzzerPlayer = null;
        r4State.buzzerGraded = false;
        r4State.buzzerLocked = true;
        set(ref(db, 'games/r4_buzzer'), null);

        sendR4Command({ action: 'reset_graphic' });
        syncR4StateToDB();
        renderR4ControllerUI();
    }, { signal });

    // Ngôi sao hi vọng & 5s giành quyền
    document.getElementById('r4BtnStar')?.addEventListener('click', () => {
        r4State.starActive = !r4State.starActive;
        if (r4State.starActive && typeof window.playMusic === 'function') {
            window.playMusic('R4_Star.mp3', false, false);
        }
        sendR4Command({
            action: 'r4_toggle_star',
            active: r4State.starActive
        });
        syncR4StateToDB();
        renderR4ControllerUI();
    }, { signal });

    document.getElementById('r4BtnTimer5s')?.addEventListener('click', () => {
        if (isStealTimerRunning) {
            stopStealTimer();
            r4State.buzzerLocked = true;
            syncR4StateToDB();
            renderR4ControllerUI();
        } else {
            startSteal5sTimer();
        }
    }, { signal });

    // 9. Cặp nút ĐÚNG / SAI hợp nhất & Xóa chuông
    document.getElementById('r4BtnMainRight')?.addEventListener('click', handleUnifiedRight, { signal });
    document.getElementById('r4BtnMainWrong')?.addEventListener('click', handleUnifiedWrong, { signal });
    document.getElementById('r4BtnClearBuzz')?.addEventListener('click', clearStealBuzz, { signal });

    // Modal Cài đặt Vòng 4
    document.getElementById('r4CfgCloseBtn')?.addEventListener('click', closeR4ConfigModal, { signal });
    document.getElementById('r4CfgSaveBtn')?.addEventListener('click', saveR4ConfigModal, { signal });
}

// =========================================================================
// 8. MODAL CÀI ĐẶT (KẾT NỐI VỚI NÚT SETTINGS TRÊN HEADER CONTROLLER)
// =========================================================================
function openR4ConfigModal() {
    const modal = document.getElementById('r4ConfigModal');
    if (!modal) return;

    document.getElementById('r4CfgPts1').value = r4State.ptsLevel1;
    document.getElementById('r4CfgTime1').value = r4State.timeLevel1;
    document.getElementById('r4CfgPts2').value = r4State.ptsLevel2;
    document.getElementById('r4CfgTime2').value = r4State.timeLevel2;
    document.getElementById('r4CfgStealTime').value = r4State.stealTime;

    for (let i = 1; i <= 4; i++) {
        const p = playersData[i] || { name: `P${i}`, score: 0 };
        document.getElementById(`r4CfgPName-${i}`).value = p.name;
        document.getElementById(`r4CfgPScore-${i}`).value = p.score;
    }

    modal.style.display = 'flex';
}

function closeR4ConfigModal() {
    const modal = document.getElementById('r4ConfigModal');
    if (modal) modal.style.display = 'none';
}

function saveR4ConfigModal() {
    r4State.ptsLevel1 = Number(document.getElementById('r4CfgPts1').value) || 20;
    r4State.timeLevel1 = Number(document.getElementById('r4CfgTime1').value) || 15;
    r4State.ptsLevel2 = Number(document.getElementById('r4CfgPts2').value) || 30;
    r4State.timeLevel2 = Number(document.getElementById('r4CfgTime2').value) || 20;
    r4State.stealTime = Number(document.getElementById('r4CfgStealTime').value) || 5;

    r4State.chosenValues = [0, 1, 2].map(s => {
        const lvl = r4State.packChoices[s];
        return lvl === 2 ? r4State.ptsLevel2 : r4State.ptsLevel1;
    });

    if (!mainTimerInterval && !isStealTimerRunning) {
        const curDur = getDurationForPoints(r4State.chosenValues[r4State.currentSlot]);
        mainTimeLeft = curDur;
        mainTimerDisplayText = `${curDur}s`;
    }

    const playerUpdates = {};
    for (let i = 1; i <= 4; i++) {
        const nameVal = document.getElementById(`r4CfgPName-${i}`).value.trim() || `P${i}`;
        const scoreVal = Number(document.getElementById(`r4CfgPScore-${i}`).value) || 0;
        playerUpdates[`games/players/${i}/name`] = nameVal;
        playerUpdates[`games/players/${i}/score`] = scoreVal;
    }
    update(ref(db), playerUpdates);

    update(ref(db, 'games/round_4_config'), {
        ptsLevel1: r4State.ptsLevel1,
        timeLevel1: r4State.timeLevel1,
        ptsLevel2: r4State.ptsLevel2,
        timeLevel2: r4State.timeLevel2,
        stealTime: r4State.stealTime
    });

    syncR4StateToDB();
    renderR4ControllerUI();
    closeR4ConfigModal();
}

window.openConfig = openR4ConfigModal;

// =========================================================================
// 9. LẮNG NGHE DỮ LIỆU REALTIME TỪ FIREBASE
// =========================================================================
function initControllerR4() {
    ensureR4LayoutDOM();
    bindR4Events();

    const unsubPlayers = onValue(ref(db, 'games/players'), (snapshot) => {
        if (snapshot.exists()) {
            playersData = snapshot.val();
            renderR4ControllerUI();
        }
    });

    const unsubQuestions = onValue(ref(db, 'questions/round_4'), (snapshot) => {
        if (snapshot.exists()) {
            allR4Questions = normalizeR4Questions(snapshot.val());
            renderR4ControllerUI();
        }
    });

    const unsubConfig = onValue(ref(db, 'games/round_4_config'), (snapshot) => {
        if (snapshot.exists()) {
            const cfg = snapshot.val();
            if (cfg.ptsLevel1 !== undefined) r4State.ptsLevel1 = Number(cfg.ptsLevel1);
            if (cfg.timeLevel1 !== undefined) r4State.timeLevel1 = Number(cfg.timeLevel1);
            if (cfg.ptsLevel2 !== undefined) r4State.ptsLevel2 = Number(cfg.ptsLevel2);
            if (cfg.timeLevel2 !== undefined) r4State.timeLevel2 = Number(cfg.timeLevel2);
            if (cfg.stealTime !== undefined) r4State.stealTime = Number(cfg.stealTime);
            renderR4ControllerUI();
        }
    });

    const unsubBuzzer = onValue(ref(db, 'games/r4_buzzer'), (snapshot) => {
        if (!snapshot.exists() || r4State.buzzerLocked || r4State.buzzerPlayer) return;
        const buzz = snapshot.val();
        const pIdx = Number(buzz?.player);
        if (pIdx >= 1 && pIdx <= 4 && pIdx !== r4State.activePlayer) {
            triggerStealBuzz(pIdx);
        }
    });

    unsubscribers.push(unsubPlayers, unsubQuestions, unsubConfig, unsubBuzzer);
    renderR4ControllerUI();
}

function destroyControllerR4() {
    stopMainTimer(false, false);
    stopStealTimer();
    closeR4ConfigModal();

    if (eventsAbortController) {
        eventsAbortController.abort();
        eventsAbortController = null;
    }

    unsubscribers.forEach(fn => {
        try { fn(); } catch (e) {}
    });
    unsubscribers.length = 0;
}

window.__r4DestroyInstance = destroyControllerR4;
window.cleanupCurrentRound = destroyControllerR4;

initControllerR4();