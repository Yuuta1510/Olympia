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
// 1. CẤU HÌNH & TRẠNG THÁI VÒNG 5: CÂU HỎI PHỤ
// =========================================================================
const R5_MAX_QUESTIONS = 12;
const R5_MIN_PLAYERS = 2;
const R5_MAX_PLAYERS = 8;
const R5_DURATION_MS = 15000;

const r5State = {
    players: ['Thí sinh 1', 'Thí sinh 2'],
    questions: [], // Tải từ nhánh questions/round_5 trên Firebase Realtime Database
    currentQuesIdx: 0,
    isQuestionShown: false,
    buzzedIndex: null,
    eliminatedIndices: [],
    winnerIndex: null,
    remainingMs: R5_DURATION_MS,
    isTimerRunning: false,
    wasTimerRunningBeforeBuzz: false
};

let timerInterval = null;
let lastTickTime = 0;
let isEventsBound = false;
const unsubscribers = [];

function sendR5Command(payload) {
    update(ref(db, 'games/commands'), {
        round: 'R5',
        ...payload,
        timestamp: Date.now()
    });
}

function syncR5StateToDB() {
    const currentQ = r5State.questions[r5State.currentQuesIdx];
    set(ref(db, 'games/r5_state'), {
        players: r5State.players,
        currentQuesIdx: r5State.currentQuesIdx,
        questionText: currentQ ? currentQ.cau_hoi : '',
        isQuestionShown: r5State.isQuestionShown,
        buzzedIndex: r5State.buzzedIndex,
        eliminatedIndices: r5State.eliminatedIndices,
        winnerIndex: r5State.winnerIndex,
        remainingMs: r5State.remainingMs,
        isTimerRunning: r5State.isTimerRunning,
        timestamp: Date.now()
    });
}

// =========================================================================
// 2. ĐỒNG HỒ 15S (PAUSE KHI BẤM CHUÔNG, CHẠY TIẾP NẾU TRẢ LỜI SAI)
// =========================================================================
function clearLocalTimerInterval() {
    if (timerInterval !== null) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function updateTimeBadgeDisplay() {
    const timeBadge = document.getElementById('r5TimeBadge');
    const playBtn = document.getElementById('r5BtnPlayPauseTime');
    const secStr = (Math.max(0, r5State.remainingMs) / 1000).toFixed(1);

    if (timeBadge) {
        if (r5State.remainingMs <= 0) {
            timeBadge.textContent = 'HẾT GIỜ (0.0s)';
        } else if (r5State.buzzedIndex !== null) {
            timeBadge.textContent = `TẠM DỪNG: ${secStr}s`;
        } else {
            timeBadge.textContent = `THỜI GIAN: ${secStr}s`;
        }
    }
    if (playBtn) {
        playBtn.textContent = r5State.isTimerRunning ? '⏸' : '▶';
    }
}

function runTimerTickLoop() {
    clearLocalTimerInterval();
    timerInterval = setInterval(() => {
        if (!r5State.isTimerRunning) return;
        const now = performance.now();
        const delta = now - lastTickTime;
        lastTickTime = now;

        r5State.remainingMs = Math.max(0, r5State.remainingMs - delta);
        updateTimeBadgeDisplay();

        if (r5State.remainingMs <= 0) {
            r5State.isTimerRunning = false;
            clearLocalTimerInterval();
            sendR5Command({ action: 'r5_time_up' });
            syncR5StateToDB();
            renderR5ControllerUI();
        }
    }, 100);
}

function startOrRestart15sTimer() {
    clearLocalTimerInterval();
    r5State.remainingMs = R5_DURATION_MS;
    r5State.isTimerRunning = true;
    r5State.wasTimerRunningBeforeBuzz = false;
    lastTickTime = performance.now();

    sendR5Command({
        action: 'r5_start_timer',
        duration: 15
    });

    runTimerTickLoop();
    updateTimeBadgeDisplay();
    renderR5ControllerUI();
}

function resume15sTimer() {
    if (r5State.remainingMs <= 0) return;
    clearLocalTimerInterval();
    r5State.isTimerRunning = true;
    lastTickTime = performance.now();

    sendR5Command({
        action: 'r5_resume_timer',
        remainingMs: r5State.remainingMs
    });

    runTimerTickLoop();
    updateTimeBadgeDisplay();
    renderR5ControllerUI();
}

function pause15sTimer(sendCommand = true) {
    if (r5State.isTimerRunning) {
        const now = performance.now();
        r5State.remainingMs = Math.max(0, r5State.remainingMs - (now - lastTickTime));
    }
    r5State.isTimerRunning = false;
    clearLocalTimerInterval();

    if (sendCommand) {
        sendR5Command({
            action: 'r5_pause_timer',
            remainingMs: r5State.remainingMs
        });
    }
    updateTimeBadgeDisplay();
}

function stopAndReset15sTimer(sendStopCommand = true) {
    r5State.isTimerRunning = false;
    r5State.wasTimerRunningBeforeBuzz = false;
    r5State.remainingMs = R5_DURATION_MS;
    clearLocalTimerInterval();

    if (sendStopCommand) {
        sendR5Command({ action: 'r5_stop_timer' });
    }
    updateTimeBadgeDisplay();
}

// =========================================================================
// 3. LOGIC BẤM CHUÔNG, CHẤM ĐÚNG (CHIẾN THẮNG) & CHẤM SAI (1 LƯỢT / CÂU)
// =========================================================================
function handlePlayerBuzz(playerIdx) {
    if (playerIdx < 0 || playerIdx >= r5State.players.length) return;
    if (r5State.winnerIndex !== null) return;
    if (r5State.buzzedIndex !== null) return;
    if (r5State.eliminatedIndices.includes(playerIdx)) return;

    r5State.wasTimerRunningBeforeBuzz = r5State.isTimerRunning;
    if (r5State.isTimerRunning) {
        pause15sTimer(false);
    }

    r5State.buzzedIndex = playerIdx;

    if (typeof window.playMusic === 'function') {
        window.playMusic('R5_Buzzed.mp3', false, false);
    }

    sendR5Command({
        action: 'r5_buzz',
        playerIndex: playerIdx,
        playerName: r5State.players[playerIdx],
        players: r5State.players,
        eliminatedIndices: r5State.eliminatedIndices,
        remainingMs: r5State.remainingMs
    });

    syncR5StateToDB();
    updateTimeBadgeDisplay();
    renderR5ControllerUI();
}

function handleAnswerRight() {
    if (r5State.buzzedIndex === null) return;

    const winnerIdx = r5State.buzzedIndex;
    r5State.winnerIndex = winnerIdx;
    r5State.buzzedIndex = null;
    stopAndReset15sTimer(false);

    sendR5Command({
        action: 'r5_win',
        winnerIndex: winnerIdx,
        winnerName: r5State.players[winnerIdx],
        players: r5State.players
    });

    syncR5StateToDB();
    renderR5ControllerUI();
}

function handleAnswerWrong() {
    if (r5State.buzzedIndex === null) return;

    const wrongIdx = r5State.buzzedIndex;
    if (!r5State.eliminatedIndices.includes(wrongIdx)) {
        r5State.eliminatedIndices.push(wrongIdx);
    }
    r5State.buzzedIndex = null;
    set(ref(db, 'games/r5_buzzer'), null);

    const allEliminated = r5State.eliminatedIndices.length >= r5State.players.length;
    const shouldResumeTimer = !allEliminated && r5State.wasTimerRunningBeforeBuzz && r5State.remainingMs > 0;
    r5State.wasTimerRunningBeforeBuzz = false;

    if (allEliminated) {
        stopAndReset15sTimer(false);
        sendR5Command({
            action: 'r5_all_wrong',
            players: r5State.players,
            eliminatedIndices: r5State.eliminatedIndices
        });
    } else if (shouldResumeTimer) {
        r5State.isTimerRunning = true;
        lastTickTime = performance.now();
        sendR5Command({
            action: 'r5_wrong_resume',
            resumeTimer: true,
            remainingMs: r5State.remainingMs,
            players: r5State.players,
            eliminatedIndices: r5State.eliminatedIndices
        });
        runTimerTickLoop();
    } else {
        sendR5Command({
            action: 'r5_wrong_resume',
            resumeTimer: false,
            remainingMs: r5State.remainingMs,
            players: r5State.players,
            eliminatedIndices: r5State.eliminatedIndices
        });
    }

    syncR5StateToDB();
    updateTimeBadgeDisplay();
    renderR5ControllerUI();
}

function resetQuestionTurnState(keepQuestionShown = false) {
    r5State.buzzedIndex = null;
    r5State.eliminatedIndices = [];
    r5State.winnerIndex = null;
    set(ref(db, 'games/r5_buzzer'), null);
    stopAndReset15sTimer(true);

    if (!keepQuestionShown) {
        r5State.isQuestionShown = false;
    }
}

// =========================================================================
// 4. CẬP NHẬT GIAO DIỆN CONTROLLER VÒNG 5
// =========================================================================
function renderR5ControllerUI() {
    const totalQ = r5State.questions.length;
    const currentQ = r5State.questions[r5State.currentQuesIdx] || null;

    const quesBadge = document.getElementById('r5QuesBadge');
    if (quesBadge) {
        quesBadge.textContent = totalQ > 0
            ? `CÂU HỎI ${r5State.currentQuesIdx + 1}/${totalQ}`
            : 'CÂU HỎI 0/0';
    }
    updateTimeBadgeDisplay();

    const qPrev = document.getElementById('r5PreviewQuestion');
    const aPrev = document.getElementById('r5PreviewAnswer');
    if (qPrev) {
        qPrev.textContent = currentQ
            ? currentQ.cau_hoi
            : 'Chưa có câu hỏi phụ trong Database (questions/round_5).';
    }
    if (aPrev) {
        aPrev.textContent = currentQ ? `${currentQ.dap_an}` : '...';
    }

    const statusBanner = document.getElementById('r5StatusBanner');
    const btnRight = document.getElementById('r5BtnRight');
    const btnWrong = document.getElementById('r5BtnWrong');

    if (statusBanner) {
        statusBanner.classList.remove('is-buzzed', 'is-winner');
        if (r5State.winnerIndex !== null) {
            statusBanner.classList.add('is-winner');
            statusBanner.textContent = `🏆 CHIẾN THẮNG CÂU HỎI PHỤ: ${r5State.players[r5State.winnerIndex]}`;
        } else if (r5State.buzzedIndex !== null) {
            statusBanner.classList.add('is-buzzed');
            statusBanner.textContent = `🔔 ${r5State.players[r5State.buzzedIndex]} ĐANG BẤM CHUÔNG TRẢ LỜI!`;
        } else if (r5State.eliminatedIndices.length >= r5State.players.length) {
            statusBanner.textContent = '❌ KHÔNG AI TRẢ LỜI ĐÚNG — BẤM "NEXT ▶" ĐỂ SANG CÂU TIẾP THEO';
        } else if (r5State.remainingMs <= 0) {
            statusBanner.textContent = '⏰ HẾT THỜI GIAN 15S — BẤM "NEXT ▶" ĐỂ SANG CÂU TIẾP THEO';
        } else if (r5State.isTimerRunning) {
            statusBanner.textContent = '⏱ ĐANG CHẠY ĐỒNG HỒ 15S — CHỜ THÍ SINH BẤM CHUÔNG...';
        } else if (r5State.isQuestionShown) {
            statusBanner.textContent = '📢 ĐÃ HIỆN CÂU HỎI — SẴN SÀNG BẤM CHUÔNG HOẶC CHẠY 15S';
        } else {
            statusBanner.textContent = 'Sẵn sàng — Bấm "HIỆN CÂU HỎI" để bắt đầu';
        }
    }

    const hasActiveBuzz = r5State.buzzedIndex !== null && r5State.winnerIndex === null;
    if (btnRight) btnRight.disabled = !hasActiveBuzz;
    if (btnWrong) btnWrong.disabled = !hasActiveBuzz;

    const btnShowQues = document.getElementById('r5BtnShowQues');
    if (btnShowQues) btnShowQues.classList.toggle('is-active', r5State.isQuestionShown);

    const countLabel = document.getElementById('r5PlayersCountLabel');
    if (countLabel) {
        countLabel.textContent = `THÍ SINH (${r5State.players.length}/${R5_MAX_PLAYERS})`;
    }

    const listEl = document.getElementById('r5PlayersList');
    if (listEl) {
        listEl.innerHTML = '';
        r5State.players.forEach((name, idx) => {
            const isBuzzed = r5State.buzzedIndex === idx;
            const isEliminated = r5State.eliminatedIndices.includes(idx);
            const isWinner = r5State.winnerIndex === idx;

            const card = document.createElement('div');
            card.className = 'r5-player-card';
            if (isBuzzed) card.classList.add('is-buzzed');
            if (isEliminated) card.classList.add('is-eliminated');
            if (isWinner) card.classList.add('is-winner');

            let subText = `TS ${idx + 1} • Click hoặc phím ${idx + 1} để bấm chuông`;
            if (isWinner) subText = `TS ${idx + 1} • 🏆 CHIẾN THẮNG`;
            else if (isBuzzed) subText = `TS ${idx + 1} • 🔔 ĐANG TRẢ LỜI`;
            else if (isEliminated) subText = `TS ${idx + 1} • ❌ ĐÃ SAI (HẾT 1 LƯỢT)`;

            const leftDiv = document.createElement('div');
            leftDiv.className = 'r5-p-left';

            const nameDiv = document.createElement('div');
            nameDiv.className = 'r5-p-name';
            nameDiv.textContent = `${idx + 1}. ${name}`;

            const subDiv = document.createElement('div');
            subDiv.className = 'r5-p-sub';
            subDiv.textContent = subText;

            leftDiv.appendChild(nameDiv);
            leftDiv.appendChild(subDiv);

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'r5-p-edit-btn';
            editBtn.textContent = '✎';
            editBtn.title = 'Đổi tên thí sinh này';
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const newName = prompt(`Nhập tên mới cho Thí sinh ${idx + 1}:`, name);
                if (newName !== null && newName.trim() !== '') {
                    r5State.players[idx] = newName.trim();
                    syncR5StateToDB();
                    renderR5ControllerUI();
                    if (r5State.isQuestionShown) {
                        sendR5Command({
                            action: 'r5_update_players',
                            players: r5State.players,
                            eliminatedIndices: r5State.eliminatedIndices,
                            buzzedIndex: r5State.buzzedIndex,
                            winnerIndex: r5State.winnerIndex
                        });
                    }
                }
            });

            card.appendChild(leftDiv);
            card.appendChild(editBtn);

            card.addEventListener('click', () => {
                handlePlayerBuzz(idx);
            });

            listEl.appendChild(card);
        });
    }
}

// =========================================================================
// 5. MODAL NHẬP TÊN 2 - 8 THÍ SINH VÒNG 5
// =========================================================================
function renderR5ConfigInputs(count) {
    const grid = document.getElementById('r5CfgPlayersGrid');
    if (!grid) return;
    grid.innerHTML = '';

    for (let i = 0; i < count; i++) {
        const item = document.createElement('div');
        item.className = 'r5-cfg-player-item';

        const label = document.createElement('label');
        label.setAttribute('for', `r5CfgName-${i}`);
        label.textContent = `Thí sinh ${i + 1}:`;

        const input = document.createElement('input');
        input.type = 'text';
        input.id = `r5CfgName-${i}`;
        input.value = r5State.players[i] || `Thí sinh ${i + 1}`;
        input.placeholder = `Nhập tên thí sinh ${i + 1}...`;

        item.appendChild(label);
        item.appendChild(input);
        grid.appendChild(item);
    }
}

function openR5ConfigModal() {
    const modal = document.getElementById('r5ConfigModal');
    const countInput = document.getElementById('r5CfgPlayerCount');
    if (!modal || !countInput) return;

    countInput.value = r5State.players.length;
    renderR5ConfigInputs(r5State.players.length);
    modal.style.display = 'flex';
}

function closeR5ConfigModal() {
    const modal = document.getElementById('r5ConfigModal');
    if (modal) modal.style.display = 'none';
}

function saveR5ConfigModal() {
    const countInput = document.getElementById('r5CfgPlayerCount');
    let count = parseInt(countInput?.value, 10) || R5_MIN_PLAYERS;
    count = Math.min(R5_MAX_PLAYERS, Math.max(R5_MIN_PLAYERS, count));

    const updatedPlayers = [];
    for (let i = 0; i < count; i++) {
        const inp = document.getElementById(`r5CfgName-${i}`);
        const val = inp?.value.trim() || `Thí sinh ${i + 1}`;
        updatedPlayers.push(val);
    }

    r5State.players = updatedPlayers;
    r5State.eliminatedIndices = r5State.eliminatedIndices.filter(i => i < count);
    if (r5State.buzzedIndex !== null && r5State.buzzedIndex >= count) {
        r5State.buzzedIndex = null;
    }
    if (r5State.winnerIndex !== null && r5State.winnerIndex >= count) {
        r5State.winnerIndex = null;
    }

    syncR5StateToDB();
    renderR5ControllerUI();

    if (r5State.isQuestionShown) {
        sendR5Command({
            action: 'r5_update_players',
            players: r5State.players,
            eliminatedIndices: r5State.eliminatedIndices,
            buzzedIndex: r5State.buzzedIndex,
            winnerIndex: r5State.winnerIndex
        });
    }

    closeR5ConfigModal();
}

window.openConfig = openR5ConfigModal;

// =========================================================================
// 6. GẮN SỰ KIỆN ĐIỀU KHIỂN & PHÍM TẮT
// =========================================================================
function handleR5Keydown(e) {
    const r5Ui = document.getElementById('r5-controller-ui');
    if (!r5Ui || r5Ui.style.display === 'none') return;
    if (document.getElementById('r5ConfigModal')?.style.display === 'flex') return;

    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

    if (e.key >= '1' && e.key <= '8') {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < r5State.players.length) {
            e.preventDefault();
            handlePlayerBuzz(idx);
        }
    }
}

function bindR5Events() {
    if (isEventsBound) return;
    isEventsBound = true;

    document.getElementById('r5BtnShowQues')?.addEventListener('click', () => {
        const currentQ = r5State.questions[r5State.currentQuesIdx];
        const qText = currentQ ? currentQ.cau_hoi : '';

        r5State.isQuestionShown = true;

        if (typeof window.playMusic === 'function') {
            window.playMusic('R5_ShowQues.mp3', false, false);
        }

        sendR5Command({
            action: 'r5_show_question',
            questionIndex: r5State.currentQuesIdx + 1,
            questionText: qText,
            players: r5State.players,
            eliminatedIndices: r5State.eliminatedIndices,
            buzzedIndex: r5State.buzzedIndex,
            winnerIndex: r5State.winnerIndex
        });

        syncR5StateToDB();
        renderR5ControllerUI();
    });

    document.getElementById('r5BtnHideQues')?.addEventListener('click', () => {
        r5State.isQuestionShown = false;
        sendR5Command({ action: 'r5_hide_question' });
        syncR5StateToDB();
        renderR5ControllerUI();
    });

    document.getElementById('r5BtnStart15s')?.addEventListener('click', () => {
        if (r5State.winnerIndex !== null) return;
        startOrRestart15sTimer();
        syncR5StateToDB();
    });

    document.getElementById('r5BtnPlayPauseTime')?.addEventListener('click', () => {
        if (r5State.isTimerRunning) {
            pause15sTimer(true);
            syncR5StateToDB();
            renderR5ControllerUI();
        } else if (r5State.remainingMs > 0 && r5State.remainingMs < R5_DURATION_MS) {
            resume15sTimer();
            syncR5StateToDB();
        } else {
            startOrRestart15sTimer();
            syncR5StateToDB();
        }
    });

    document.getElementById('r5BtnResetTime')?.addEventListener('click', () => {
        stopAndReset15sTimer(true);
        syncR5StateToDB();
        renderR5ControllerUI();
    });

    document.getElementById('r5BtnPrevQues')?.addEventListener('click', () => {
        if (r5State.questions.length === 0) return;
        r5State.currentQuesIdx = Math.max(0, r5State.currentQuesIdx - 1);
        resetQuestionTurnState(false);
        sendR5Command({ action: 'r5_reset_question' });
        syncR5StateToDB();
        renderR5ControllerUI();
    });

    document.getElementById('r5BtnNextQues')?.addEventListener('click', () => {
        if (r5State.questions.length === 0) return;
        if (r5State.currentQuesIdx < r5State.questions.length - 1) {
            r5State.currentQuesIdx++;
        }
        resetQuestionTurnState(false);
        sendR5Command({ action: 'r5_reset_question' });
        syncR5StateToDB();
        renderR5ControllerUI();
    });

    document.getElementById('r5BtnResetBuzz')?.addEventListener('click', () => {
        r5State.buzzedIndex = null;
        set(ref(db, 'games/r5_buzzer'), null);
        const shouldResume = r5State.wasTimerRunningBeforeBuzz && r5State.remainingMs > 0;
        r5State.wasTimerRunningBeforeBuzz = false;
        if (shouldResume) {
            r5State.isTimerRunning = true;
            lastTickTime = performance.now();
            runTimerTickLoop();
        }
        sendR5Command({
            action: 'r5_clear_buzz',
            resumeTimer: shouldResume,
            players: r5State.players,
            eliminatedIndices: r5State.eliminatedIndices
        });
        syncR5StateToDB();
        updateTimeBadgeDisplay();
        renderR5ControllerUI();
    });

    document.getElementById('r5BtnResetGraphic')?.addEventListener('click', () => {
        resetQuestionTurnState(false);
        sendR5Command({ action: 'reset_graphic' });
        syncR5StateToDB();
        renderR5ControllerUI();
    });

    document.getElementById('r5BtnRight')?.addEventListener('click', handleAnswerRight);
    document.getElementById('r5BtnWrong')?.addEventListener('click', handleAnswerWrong);

    document.getElementById('r5BtnAddPlayer')?.addEventListener('click', () => {
        if (r5State.players.length >= R5_MAX_PLAYERS) {
            return;
        }
        r5State.players.push(`Thí sinh ${r5State.players.length + 1}`);
        syncR5StateToDB();
        renderR5ControllerUI();
        if (r5State.isQuestionShown) {
            sendR5Command({
                action: 'r5_update_players',
                players: r5State.players,
                eliminatedIndices: r5State.eliminatedIndices,
                buzzedIndex: r5State.buzzedIndex,
                winnerIndex: r5State.winnerIndex
            });
        }
    });

    document.getElementById('r5BtnRemovePlayer')?.addEventListener('click', () => {
        if (r5State.players.length <= R5_MIN_PLAYERS) {
            return;
        }
        r5State.players.pop();
        const maxIdx = r5State.players.length;
        r5State.eliminatedIndices = r5State.eliminatedIndices.filter(i => i < maxIdx);
        if (r5State.buzzedIndex !== null && r5State.buzzedIndex >= maxIdx) r5State.buzzedIndex = null;
        if (r5State.winnerIndex !== null && r5State.winnerIndex >= maxIdx) r5State.winnerIndex = null;

        syncR5StateToDB();
        renderR5ControllerUI();
        if (r5State.isQuestionShown) {
            sendR5Command({
                action: 'r5_update_players',
                players: r5State.players,
                eliminatedIndices: r5State.eliminatedIndices,
                buzzedIndex: r5State.buzzedIndex,
                winnerIndex: r5State.winnerIndex
            });
        }
    });

    document.getElementById('r5BtnOpenConfig')?.addEventListener('click', openR5ConfigModal);
    document.getElementById('r5CfgCloseBtn')?.addEventListener('click', closeR5ConfigModal);
    document.getElementById('r5CfgSaveBtn')?.addEventListener('click', saveR5ConfigModal);

    document.getElementById('r5CfgPlayerCount')?.addEventListener('input', (e) => {
        let val = parseInt(e.target.value, 10);
        if (!Number.isFinite(val)) return;
        val = Math.min(R5_MAX_PLAYERS, Math.max(R5_MIN_PLAYERS, val));
        renderR5ConfigInputs(val);
    });
}

// =========================================================================
// 7. KHỞI TẠO & LẮNG NGHE DỮ LIỆU FIREBASE (CÂU HỎI, THÍ SINH & CHUÔNG)
// =========================================================================
function initControllerR5() {
    bindR5Events();
    document.addEventListener('keydown', handleR5Keydown);

    // Tải tối đa 12 câu hỏi phụ từ nhánh questions/round_5
    const unsubQuestions = onValue(ref(db, 'questions/round_5'), (snapshot) => {
        const loadedQuestions = [];
        if (snapshot.exists()) {
            const raw = snapshot.val();
            if (raw && typeof raw === 'object') {
                const entries = Object.entries(raw).sort((a, b) =>
                    a[0].localeCompare(b[0], undefined, { numeric: true })
                );

                for (const [key, item] of entries) {
                    if (item && typeof item === 'object' && (item.cau_hoi !== undefined || item.dap_an !== undefined)) {
                        loadedQuestions.push({
                            id: key,
                            cau_hoi: String(item.cau_hoi ?? ''),
                            dap_an: String(item.dap_an ?? '')
                        });
                    }
                    if (loadedQuestions.length >= R5_MAX_QUESTIONS) break;
                }
            }
        }

        r5State.questions = loadedQuestions;
        if (r5State.questions.length === 0) {
            r5State.currentQuesIdx = 0;
        } else if (r5State.currentQuesIdx >= r5State.questions.length) {
            r5State.currentQuesIdx = r5State.questions.length - 1;
        }

        if (r5State.isQuestionShown) {
            syncR5StateToDB();
        }
        renderR5ControllerUI();
    }, (error) => {
        console.error('Lỗi tải câu hỏi từ questions/round_5:', error);
    });

    const unsubSavedPlayers = onValue(ref(db, 'games/r5_state/players'), (snapshot) => {
        if (snapshot.exists()) {
            const savedPlayers = snapshot.val();
            if (Array.isArray(savedPlayers) && savedPlayers.length >= R5_MIN_PLAYERS) {
                r5State.players = savedPlayers.slice(0, R5_MAX_PLAYERS);
                renderR5ControllerUI();
            }
        }
    }, { onlyOnce: true });

    const unsubBuzzer = onValue(ref(db, 'games/r5_buzzer'), (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.val();
        if (!data) return;

        let pIdx = -1;
        if (data.playerIndex !== undefined && data.playerIndex !== null) {
            pIdx = Number(data.playerIndex);
        } else if (data.player !== undefined && data.player !== null) {
            pIdx = Number(data.player) - 1;
        }

        if (Number.isInteger(pIdx) && pIdx >= 0 && pIdx < r5State.players.length) {
            handlePlayerBuzz(pIdx);
        }
    });

    unsubscribers.push(unsubQuestions, unsubSavedPlayers, unsubBuzzer);
    renderR5ControllerUI();
}

initControllerR5();

window.cleanupCurrentRound = () => {
    clearLocalTimerInterval();
    closeR5ConfigModal();
    document.removeEventListener('keydown', handleR5Keydown);
    unsubscribers.forEach(fn => {
        try { fn(); } catch (e) {}
    });
    unsubscribers.length = 0;
    if (window.openConfig === openR5ConfigModal) {
        window.openConfig = null;
    }
};