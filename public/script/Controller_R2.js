import { getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, set, update, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// ==========================================
// 1. KHỞI TẠO FIREBASE & TRẠNG THÁI VÒNG 2
// ==========================================
const app = getApp();
const db = getDatabase(app);
const r2Channel = new BroadcastChannel('olympia_r2_control');

const r2DataState = {
    cnv_answer: "",
    cnv_length: 0,
    cnv_image: "",
    rows: [
        { answer: "", state: 'unselected', length: 0 },
        { answer: "", state: 'unselected', length: 0 },
        { answer: "", state: 'unselected', length: 0 },
        { answer: "", state: 'unselected', length: 0 },
        { answer: "", state: 'unselected', length: 0 }
    ],
    image_pieces: [false, false, false, false, false],
    questions: ["", "", "", "", ""],
    images: ["", "", "", "", ""],
    players: [
        { name: "P1", score: 0, answer: "", wrong: false },
        { name: "P2", score: 0, answer: "", wrong: false },
        { name: "P3", score: 0, answer: "", wrong: false },
        { name: "P4", score: 0, answer: "", wrong: false }
    ],
    showQuestion: false,
    show15s: false,
    buzzedPlayers: [],
    selectedRowIndex: -1
};

const r2RawAnswerIsObject = [false, false, false, false];
let r2CurrentPage = 1;
let r2ShowAnswers = false;
let r2ShowAnswersSeq = 0;
let r2ShowWaitBg = true;

let r2PlayersUnsub = null;
let r2QuestionsUnsub = null;
let r2AnswersUnsub = null;

// ==========================================
// 2. HÀM TIỆN ÍCH & ĐỒNG BỘ ĐIỀU KHIỂN
// ==========================================
function formatCnvTitle(rawAnswer) {
    const clean = String(rawAnswer || "").replace(/\s+/g, '');
    const len = clean.length;
    if (len === 0) {
        return 'CHƯỚNG NGẠI VẬT CÓ 0 CHỮ CÁI';
    }
    if (/^\p{L}+$/u.test(clean)) {
        return `CHƯỚNG NGẠI VẬT CÓ ${len} CHỮ CÁI`;
    }
    if (/^\d+$/.test(clean)) {
        return `CHƯỚNG NGẠI VẬT CÓ ${len} CHỮ SỐ`;
    }
    return `CHƯỚNG NGẠI VẬT CÓ ${len} KÝ TỰ`;
}

function sendR2Control() {
    const payload = {
        page: r2CurrentPage,
        showAnswers: r2ShowAnswers,
        showAnswersSeq: r2ShowAnswersSeq,
        showWaitBg: r2ShowWaitBg,
        rows: r2DataState.rows.map(r => r.state),
        image_pieces: r2DataState.image_pieces,
        showQuestion: r2DataState.showQuestion,
        show15s: r2DataState.show15s,
        buzzedPlayers: r2DataState.buzzedPlayers,
        wrongAnswers: r2DataState.players.map(p => Boolean(p.wrong)),
        currentRowIndex: r2DataState.selectedRowIndex !== -1 ? r2DataState.selectedRowIndex : 0,
        question: r2DataState.selectedRowIndex !== -1 ? r2DataState.questions[r2DataState.selectedRowIndex] : "",
        image: r2DataState.selectedRowIndex !== -1 ? r2DataState.images[r2DataState.selectedRowIndex] : "",
        timestamp: Date.now()
    };
    set(ref(db, 'games/r2_control'), payload);
    r2Channel.postMessage(payload);
}

// ==========================================
// 3. CẬP NHẬT GIAO DIỆN (DOM RENDERING)
// ==========================================
function updateR2ButtonsUI() {
    const pageBtn = document.getElementById('r2-btn-page');
    const showAnsBtn = document.getElementById('r2-btn-show-ans');
    const waitBgBtn = document.getElementById('r2-btn-wait-bg');

    if (pageBtn) {
        pageBtn.textContent = r2CurrentPage === 1 ? 'CHUYỂN TRANG 2' : 'CHUYỂN TRANG 1';
        pageBtn.classList.toggle('active', r2CurrentPage === 2);
    }
    if (showAnsBtn) {
        showAnsBtn.classList.toggle('active', r2ShowAnswers);
    }
    if (waitBgBtn) {
        waitBgBtn.textContent = r2ShowWaitBg ? 'ẨN NỀN CHỜ' : 'HIỆN NỀN CHỜ';
        waitBgBtn.style.backgroundColor = r2ShowWaitBg ? '#dc2626' : '#2563eb';
    }
}

function updateR2UI() {
    const btnQues = document.getElementById('r2-btn-toggle-ques');
    if (btnQues) {
        btnQues.textContent = r2DataState.showQuestion ? 'ẨN CÂU HỎI' : 'HIỆN CÂU HỎI';
        btnQues.style.backgroundColor = r2DataState.showQuestion ? '#dc2626' : '#2563eb';
    }

    const qText = document.getElementById('r2-ctrl-q-text');
    if (qText) {
        qText.style.opacity = r2DataState.showQuestion ? '1' : '0.3';
        qText.innerText = r2DataState.selectedRowIndex !== -1 ? r2DataState.questions[r2DataState.selectedRowIndex] : "";
    }

    const btn15s = document.getElementById('r2-btn-toggle-15s');
    if (btn15s) {
        btn15s.style.backgroundColor = r2DataState.show15s ? '#dc2626' : '#9333ea';
    }

    const targetImg = document.querySelector('#r2-controller-ui .r2-ctrl-target-img');
    if (targetImg) {
        const nextSrc = r2DataState.cnv_image || '../graphic/o27/r2_target.png';
        if (targetImg.getAttribute('src') !== nextSrc) {
            targetImg.style.display = 'block';
            targetImg.src = nextSrc;
        }
    }

    r2DataState.image_pieces.forEach((hidden, i) => {
        const piece = document.getElementById(`r2-cp-${i + 1}`);
        const lbl = document.getElementById(`r2-lbl-${i + 1}`);
        if (piece) piece.classList.toggle('hidden', hidden);
        if (lbl) lbl.classList.toggle('hidden', hidden);
    });

    const rowWrappers = document.querySelectorAll('#r2-controller-ui .r2-ctrl-row-wrapper');
    r2DataState.rows.forEach((row, i) => {
        if (!rowWrappers[i]) return;
        const rowDiv = rowWrappers[i].querySelector('.r2-ctrl-row');
        if (rowDiv && rowDiv.children.length !== row.length) {
            rowDiv.replaceChildren();
            const fragment = document.createDocumentFragment();
            for (let idx = 0; idx < row.length; idx++) {
                const charEl = document.createElement('div');
                charEl.className = `r2-ctrl-char ${row.state}`;
                charEl.innerText = row.answer[idx] || '';
                fragment.appendChild(charEl);
            }
            rowDiv.appendChild(fragment);
        } else {
            const chars = rowWrappers[i].querySelectorAll('.r2-ctrl-char');
            chars.forEach((char, idx) => {
                char.className = `r2-ctrl-char ${row.state}`;
                char.innerText = row.answer[idx] || '';
            });
        }
    });

    r2DataState.players.forEach((p, i) => {
        const isBuzzed = r2DataState.buzzedPlayers.includes(i);
        const isWrong = Boolean(p.wrong);

        const scoreCard = document.getElementById(`r2-ctrl-score-${i}`);
        if (scoreCard) {
            scoreCard.classList.toggle('buzzed', isBuzzed);
            const nameEl = scoreCard.querySelector('.r2-c-score-name');
            const scoreEl = scoreCard.querySelector('.r2-c-score-val');
            if (nameEl) nameEl.innerText = p.name;
            if (scoreEl) scoreEl.innerText = p.score;
        }

        const ansCard = document.getElementById(`r2-ctrl-ans-card-${i}`);
        if (ansCard) {
            ansCard.classList.toggle('buzzed', isBuzzed);
            ansCard.classList.toggle('wrong', isWrong);
        }

        const ansNameEl = document.getElementById(`r2-ctrl-ans-name-${i}`);
        if (ansNameEl) ansNameEl.innerText = `${i + 1}. ${p.name}`;

        const ansStatusEl = document.getElementById(`r2-ctrl-ans-status-${i}`);
        if (ansStatusEl) {
            const hasAns = Boolean((p.answer || "").trim());
            ansStatusEl.innerText = hasAns ? "ĐÃ GỬI" : "TRỐNG";
            ansStatusEl.classList.toggle('has-answer', hasAns);
        }

        const ansInputEl = document.getElementById(`r2-ctrl-ans-input-${i}`);
        if (ansInputEl && document.activeElement !== ansInputEl) {
            ansInputEl.value = p.answer || "";
        }

        const wrongBtnEl = document.getElementById(`r2-ctrl-ans-wrong-${i}`);
        if (wrongBtnEl) {
            wrongBtnEl.classList.toggle('active', isWrong);
        }
    });

    const cnvTitle = document.querySelector('#r2-controller-ui .r2-ctrl-cnv-title');
    if (cnvTitle) cnvTitle.innerText = formatCnvTitle(r2DataState.cnv_answer);
}

// ==========================================
// 4. CÁC HÀM XỬ LÝ ĐIỀU KHIỂN VÒNG 2
// ==========================================
window.toggleR2WaitBg = function() {
    r2ShowWaitBg = !r2ShowWaitBg;
    if (!r2ShowWaitBg && window.playMusic) {
        window.playMusic('R2_ShowRow.mp3', false, false);
    }
    updateR2ButtonsUI();
    sendR2Control();
};

window.toggleR2Page = function() {
    r2CurrentPage = r2CurrentPage === 1 ? 2 : 1;
    updateR2ButtonsUI();
    sendR2Control();
};

window.showR2Answers = function() {
    r2ShowAnswers = true;
    r2ShowAnswersSeq++;
    updateR2ButtonsUI();
    if (window.playMusic) window.playMusic('R2_ShowAns.mp3', false, false);
    sendR2Control();
};

window.resetR2Answers = function() {
    r2ShowAnswers = false;
    r2ShowAnswersSeq = 0;
    updateR2ButtonsUI();
    update(ref(db, 'games/soundboard'), { soundId: 'R2_ShowAns_mp3', action: 'stop', timestamp: Date.now() });
    sendR2Control();
};

window.updateR2PlayerAnswer = function(index, newAnswer) {
    const cleanVal = newAnswer !== undefined ? String(newAnswer) : "";
    r2DataState.players[index].answer = cleanVal;

    const dbKey = index + 1;
    const targetRef = ref(db, `games/round_2/dap_an_thi_sinh/${dbKey}`);
    const writeOp = r2RawAnswerIsObject[index]
        ? update(targetRef, { answer: cleanVal })
        : set(targetRef, cleanVal);

    writeOp.then(() => {
        const inputEl = document.getElementById(`r2-ctrl-ans-input-${index}`);
        if (inputEl) {
            inputEl.classList.add('saved-flash');
            setTimeout(() => inputEl.classList.remove('saved-flash'), 600);
        }
    });
    updateR2UI();
};

window.toggleR2PlayerWrong = function(index) {
    if (!r2DataState.players[index]) return;
    r2DataState.players[index].wrong = !r2DataState.players[index].wrong;
    updateR2UI();
    sendR2Control();
};

window.resetAllR2PlayerAnswers = function() {
    for (let i = 0; i < 4; i++) {
        r2DataState.players[i].answer = "";
        r2DataState.players[i].wrong = false;
        r2RawAnswerIsObject[i] = false;
    }
    set(ref(db, 'games/round_2/dap_an_thi_sinh'), {
        1: "",
        2: "",
        3: "",
        4: ""
    });
    updateR2UI();
    sendR2Control();
};

window.selectR2Row = function(index) {
    if (r2DataState.rows[index].state === 'selected') {
        r2DataState.rows[index].state = 'unselected';
        r2DataState.selectedRowIndex = -1;
    } else {
        r2DataState.rows.forEach((r, i) => {
            if (r.state === 'selected' && i !== index) r.state = 'unselected';
        });
        r2DataState.rows[index].state = 'selected';
        r2DataState.selectedRowIndex = index;
        if (window.playMusic && index !== 4) window.playMusic('R2_SelectRow.mp3', false, false);
    }
    updateR2UI();
    sendR2Control();
};

window.setR2RowState = function(index, state) {
    r2DataState.rows[index].state = state;
    updateR2UI();
    sendR2Control();
};

window.toggleR2Question = function() {
    r2DataState.showQuestion = !r2DataState.showQuestion;
    if (r2DataState.showQuestion) {
        if (window.playMusic) window.playMusic('R2_ShowQues.mp3', false, false);
    } else {
        r2DataState.show15s = false;
        update(ref(db, 'games/soundboard'), { soundId: 'R2_15s_mp3', action: 'stop', timestamp: Date.now() });
    }
    updateR2UI();
    sendR2Control();
};

window.toggleR2_15s = function() {
    r2DataState.show15s = !r2DataState.show15s;
    if (r2DataState.show15s) {
        if (window.playMusic) window.playMusic('R2_15s.mp3', true, false);
    } else {
        update(ref(db, 'games/soundboard'), { soundId: 'R2_15s_mp3', action: 'stop', timestamp: Date.now() });
    }
    updateR2UI();
    sendR2Control();
};

window.toggleR2Buzzer = function(index) {
    const pos = r2DataState.buzzedPlayers.indexOf(index);
    if (pos > -1) {
        r2DataState.buzzedPlayers.splice(pos, 1);
    } else {
        r2DataState.buzzedPlayers.push(index);
        if (window.playMusic) window.playMusic('R2_Buzzed.mp3', false, false);
    }
    updateR2UI();
    sendR2Control();
};

window.toggleR2Piece = function(index) {
    const isHidden = !r2DataState.image_pieces[index];
    r2DataState.image_pieces[index] = isHidden;
    if (isHidden) {
        if (window.playMusic) window.playMusic('R2_PictureReveal.mp3', false, true);
    }
    updateR2UI();
    sendR2Control();
};

window.revealAllR2 = function() {
    r2DataState.image_pieces = [true, true, true, true, true];
    r2DataState.showQuestion = false;
    r2DataState.show15s = false;
    r2DataState.rows.forEach(r => r.state = 'opened');
    update(ref(db, 'games/soundboard'), { soundId: 'R2_15s_mp3', action: 'stop', timestamp: Date.now() });
    updateR2UI();
    sendR2Control();
};

// ==========================================
// 5. MODAL CONFIG VÒNG 2 (SỬA TÊN, ĐIỂM, CỘNG ĐIỂM)
// ==========================================
function syncR2ConfigModalScale() {
    const content = document.getElementById('r2ConfigModalContent');
    if (!content) return;
    const dpr = window.devicePixelRatio || 1;
    content.style.transform = `scale(${1 / dpr})`;
}

window.compressR2ConfigName = function(index) {
    const el = document.getElementById(`r2-config-name-${index}`);
    if (!el || !el.parentElement) return;
    el.style.transform = 'none';
    const textWidth = el.offsetWidth;
    const containerWidth = el.parentElement.clientWidth - 12;
    if (textWidth > containerWidth && containerWidth > 0) {
        const ratio = containerWidth / textWidth;
        el.style.transform = `scaleX(${ratio})`;
    }
};

window.updateR2ConfigPreview = function(index) {
    const scoreInput = document.getElementById(`r2-config-score-${index}`);
    const addInput = document.getElementById(`r2-config-add-${index}`);
    const previewEl = document.getElementById(`r2-config-preview-${index}`);
    if (!scoreInput || !addInput || !previewEl) return;

    const baseScore = Number(scoreInput.value) || 0;
    const bonusScore = Number(addInput.value) || 0;
    const nextTotal = baseScore + bonusScore;

    if (bonusScore !== 0) {
        const sign = bonusScore > 0 ? `+${bonusScore}` : `${bonusScore}`;
        previewEl.innerHTML = `Sau lưu: <strong>${baseScore} ${sign} = ${nextTotal}</strong>`;
        previewEl.classList.add('has-bonus');
    } else {
        previewEl.innerHTML = `Sau lưu: <strong>${baseScore}</strong>`;
        previewEl.classList.remove('has-bonus');
    }
};

window.adjustR2ConfigBonus = function(index, delta) {
    const addInput = document.getElementById(`r2-config-add-${index}`);
    if (!addInput) return;
    const currentBonus = Number(addInput.value) || 0;
    addInput.value = currentBonus + Number(delta);
    window.updateR2ConfigPreview(index);
};

window.setR2ConfigBonus = function(index, value) {
    const addInput = document.getElementById(`r2-config-add-${index}`);
    if (!addInput) return;
    addInput.value = Number(value) || 0;
    window.updateR2ConfigPreview(index);
};

window.updateR2ConfigNameDB = function(index, rawName) {
    const cleanName = String(rawName || '').trim() || `P${index}`;
    const nameEl = document.getElementById(`r2-config-name-${index}`);
    if (nameEl) {
        nameEl.innerText = cleanName;
        window.compressR2ConfigName(index);
    }
    if (r2DataState.players[index - 1]) {
        r2DataState.players[index - 1].name = cleanName;
    }
    update(ref(db, `games/players/${index}`), { name: cleanName });
    updateR2UI();
};

window.openConfig = function() {
    const modal = document.getElementById('r2ConfigModal');
    if (!modal) return;

    for (let i = 1; i <= 4; i++) {
        const p = r2DataState.players[i - 1] || { name: `P${i}`, score: 0 };
        const nameEl = document.getElementById(`r2-config-name-${i}`);
        const scoreInput = document.getElementById(`r2-config-score-${i}`);
        const addInput = document.getElementById(`r2-config-add-${i}`);

        if (nameEl) nameEl.innerText = p.name || `P${i}`;
        if (scoreInput) scoreInput.value = Number(p.score) || 0;
        if (addInput) addInput.value = 0;
        window.updateR2ConfigPreview(i);
    }

    syncR2ConfigModalScale();
    modal.style.display = 'flex';
    setTimeout(() => {
        for (let i = 1; i <= 4; i++) {
            window.compressR2ConfigName(i);
        }
    }, 30);
};

window.closeConfig = function() {
    const modal = document.getElementById('r2ConfigModal');
    if (modal) {
        modal.style.display = 'none';
    }
};

window.saveR2Config = function() {
    const updates = [];
    for (let i = 1; i <= 4; i++) {
        const nameEl = document.getElementById(`r2-config-name-${i}`);
        const scoreInput = document.getElementById(`r2-config-score-${i}`);
        const addInput = document.getElementById(`r2-config-add-${i}`);

        const finalName = (nameEl ? nameEl.innerText.trim() : '') || `P${i}`;
        const baseScore = scoreInput ? (Number(scoreInput.value) || 0) : (r2DataState.players[i - 1].score || 0);
        const bonusScore = addInput ? (Number(addInput.value) || 0) : 0;
        const finalScore = baseScore + bonusScore;

        r2DataState.players[i - 1].name = finalName;
        r2DataState.players[i - 1].score = finalScore;

        if (scoreInput) scoreInput.value = finalScore;
        if (addInput) addInput.value = 0;
        window.updateR2ConfigPreview(i);

        updates.push(
            update(ref(db, `games/players/${i}`), {
                name: finalName,
                score: finalScore
            })
        );
    }

    updateR2UI();
    Promise.all(updates).then(() => {
        window.closeConfig();
    });
};

// ==========================================
// 6. TÍCH HỢP DỮ LIỆU REALTIME TỪ FIREBASE
// ==========================================
function setupR2FirebaseListeners() {
    r2PlayersUnsub = onValue(ref(db, 'games/players'), (snapshot) => {
        if (!snapshot.exists()) return;
        const playersData = snapshot.val();
        for (let i = 1; i <= 4; i++) {
            if (playersData[i]) {
                r2DataState.players[i - 1].name = playersData[i].name || `P${i}`;
                r2DataState.players[i - 1].score = playersData[i].score || 0;

                const cfgNameEl = document.getElementById(`r2-config-name-${i}`);
                const cfgScoreEl = document.getElementById(`r2-config-score-${i}`);
                if (cfgNameEl && document.activeElement !== cfgNameEl) {
                    cfgNameEl.innerText = r2DataState.players[i - 1].name;
                    window.compressR2ConfigName(i);
                }
                if (cfgScoreEl && document.activeElement !== cfgScoreEl) {
                    cfgScoreEl.value = r2DataState.players[i - 1].score;
                    window.updateR2ConfigPreview(i);
                }
            }
        }
        updateR2UI();
    });

    r2QuestionsUnsub = onValue(ref(db, 'questions/round_2'), (snapshot) => {
        r2DataState.questions = ["", "", "", "", ""];
        r2DataState.rows.forEach(r => { r.answer = ""; r.length = 0; });
        r2DataState.images = ["", "", "", "", ""];
        r2DataState.cnv_answer = "";
        r2DataState.cnv_length = 0;
        r2DataState.cnv_image = "";

        if (snapshot.exists()) {
            const qData = snapshot.val();
            for (let i = 1; i <= 5; i++) {
                if (qData[i]) {
                    r2DataState.questions[i - 1] = qData[i].cau_hoi || "";
                    const ans = (qData[i].dap_an || "").replace(/\s+/g, '');
                    r2DataState.rows[i - 1].answer = ans;
                    r2DataState.rows[i - 1].length = ans.length;
                    r2DataState.images[i - 1] = qData[i].image || "";
                }
            }
            if (qData['cnv']) {
                r2DataState.cnv_answer = qData['cnv'].dap_an || "";
                r2DataState.cnv_length = r2DataState.cnv_answer.replace(/\s+/g, '').length;
                r2DataState.cnv_image = qData['cnv'].image || (qData[1] && qData[1].image) || "";
            } else if (qData[1] && qData[1].image) {
                r2DataState.cnv_image = qData[1].image;
            }
        }
        updateR2UI();
    });

    r2AnswersUnsub = onValue(ref(db, 'games/round_2/dap_an_thi_sinh'), (snapshot) => {
        const answers = snapshot.exists() ? snapshot.val() : {};
        for (let i = 1; i <= 4; i++) {
            const raw = answers ? answers[i] : undefined;
            if (raw !== undefined && raw !== null) {
                const isObj = typeof raw === 'object';
                r2RawAnswerIsObject[i - 1] = isObj;
                r2DataState.players[i - 1].answer = isObj ? (raw.answer || "") : String(raw);
            } else {
                r2RawAnswerIsObject[i - 1] = false;
                r2DataState.players[i - 1].answer = "";
            }
        }
        updateR2UI();
    });
}

// ==========================================
// 7. GẮN SỰ KIỆN DOM, KHỞI TẠO & DỌN DẸP
// ==========================================
function bindR2Events() {
    const r2Ui = document.getElementById('r2-controller-ui');
    if (!r2Ui || r2Ui.dataset.eventsBound === 'true') return;
    r2Ui.dataset.eventsBound = 'true';

    // Ảnh mục tiêu
    const targetImg = r2Ui.querySelector('.r2-ctrl-target-img');
    if (targetImg) {
        targetImg.addEventListener('error', () => {
            targetImg.style.display = 'none';
        });
        targetImg.addEventListener('load', () => {
            targetImg.style.display = 'block';
        });
    }

    // 5 mảnh ghép hình ảnh
    r2Ui.querySelectorAll('.r2-ctrl-piece').forEach(piece => {
        piece.addEventListener('click', () => {
            const idx = Number(piece.dataset.pieceIndex);
            window.toggleR2Piece(idx);
        });
    });

    // Chọn hàng ngang & nút Đúng (Đ) / Sai (S)
    r2Ui.querySelectorAll('.r2-ctrl-row-number').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.rowIndex);
            window.selectR2Row(idx);
        });
    });

    r2Ui.querySelectorAll('.r2-ctrl-state-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.rowIndex);
            const state = btn.dataset.state;
            window.setR2RowState(idx, state);
        });
    });

    // Cụm nút điều khiển dưới khung câu hỏi
    document.getElementById('r2-btn-wait-bg')?.addEventListener('click', window.toggleR2WaitBg);
    document.getElementById('r2-btn-toggle-ques')?.addEventListener('click', window.toggleR2Question);
    document.getElementById('r2-btn-toggle-15s')?.addEventListener('click', window.toggleR2_15s);
    document.getElementById('r2-btn-page')?.addEventListener('click', window.toggleR2Page);
    document.getElementById('r2-btn-show-ans')?.addEventListener('click', window.showR2Answers);
    document.getElementById('r2-btn-reset-ans')?.addEventListener('click', window.resetR2Answers);
    document.getElementById('r2-btn-reveal-all')?.addEventListener('click', window.revealAllR2);

    // 4 thẻ điểm bấm chuông
    r2Ui.querySelectorAll('.r2-c-score-card').forEach(card => {
        card.addEventListener('click', () => {
            const idx = Number(card.dataset.playerIndex);
            window.toggleR2Buzzer(idx);
        });
    });

    // Panel đáp án thí sinh
    r2Ui.querySelectorAll('.r2-ctrl-ans-input').forEach(input => {
        const idx = Number(input.dataset.playerIndex);
        input.addEventListener('change', () => {
            window.updateR2PlayerAnswer(idx, input.value);
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                window.updateR2PlayerAnswer(idx, input.value);
                input.blur();
            }
        });
    });

    r2Ui.querySelectorAll('.r2-ctrl-ans-wrong-btn').forEach(btn => {
        const idx = Number(btn.dataset.playerIndex);
        btn.addEventListener('click', () => {
            window.toggleR2PlayerWrong(idx);
        });
    });

    document.getElementById('r2-btn-reset-player-ans')?.addEventListener('click', window.resetAllR2PlayerAnswers);

    // Modal Cài đặt Vòng 2
    const cfgModal = document.getElementById('r2ConfigModal');
    if (cfgModal) {
        document.getElementById('r2-cfg-close-btn')?.addEventListener('click', window.closeConfig);
        document.getElementById('r2-cfg-save-btn')?.addEventListener('click', window.saveR2Config);

        cfgModal.querySelectorAll('.r2-cfg-name').forEach(nameEl => {
            const num = Number(nameEl.dataset.playerNum);
            nameEl.addEventListener('input', () => window.compressR2ConfigName(num));
            nameEl.addEventListener('blur', () => window.updateR2ConfigNameDB(num, nameEl.innerText));
            nameEl.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    nameEl.blur();
                }
            });
        });

        cfgModal.querySelectorAll('.r2-cfg-score-input, .r2-cfg-bonus-input').forEach(input => {
            const num = Number(input.dataset.playerNum);
            input.addEventListener('input', () => window.updateR2ConfigPreview(num));
        });

        cfgModal.querySelectorAll('.r2-cfg-preset-btn').forEach(btn => {
            const num = Number(btn.dataset.playerNum);
            btn.addEventListener('click', () => {
                if (btn.dataset.delta !== undefined) {
                    window.adjustR2ConfigBonus(num, Number(btn.dataset.delta));
                } else if (btn.dataset.set !== undefined) {
                    window.setR2ConfigBonus(num, Number(btn.dataset.set));
                }
            });
        });
    }
}

function initControllerR2() {
    const r2Ui = document.getElementById('r2-controller-ui');
    if (!r2Ui) return;

    r2Ui.style.display = 'block';
    bindR2Events();
    setupR2FirebaseListeners();
    window.addEventListener('resize', syncR2ConfigModalScale);

    r2CurrentPage = 1;
    r2ShowAnswers = false;
    r2ShowAnswersSeq = 0;
    updateR2ButtonsUI();
    updateR2UI();
    sendR2Control();
}

initControllerR2();

window.cleanupCurrentRound = () => {
    window.removeEventListener('resize', syncR2ConfigModalScale);
    if (typeof r2PlayersUnsub === 'function') r2PlayersUnsub();
    if (typeof r2QuestionsUnsub === 'function') r2QuestionsUnsub();
    if (typeof r2AnswersUnsub === 'function') r2AnswersUnsub();
    r2PlayersUnsub = null;
    r2QuestionsUnsub = null;
    r2AnswersUnsub = null;

    const cfgModal = document.getElementById('r2ConfigModal');
    if (cfgModal) cfgModal.style.display = 'none';

    const r2Ui = document.getElementById('r2-controller-ui');
    if (r2Ui) r2Ui.style.display = 'none';
};