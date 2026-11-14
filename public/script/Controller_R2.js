import { getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, set, update, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const app = getApp();
const db = getDatabase(app);
const r2Channel = new BroadcastChannel('olympia_r2_control');

let r2DataState = {
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

let r2RawAnswerIsObject = [false, false, false, false];
let r2CurrentPage = 1;
let r2ShowAnswers = false;
let r2ShowAnswersSeq = 0;
let r2ShowWaitBg = true;

let r2PlayersUnsub = null;
let r2QuestionsUnsub = null;
let r2AnswersUnsub = null;

function formatCnvTitle(rawAnswer) {
    const clean = String(rawAnswer || "").replace(/\s+/g, '');
    const len = clean.length;
    if (len === 0) {
        return `CHƯỚNG NGẠI VẬT CÓ 0 CHỮ CÁI`;
    }
    if (/^\p{L}+$/u.test(clean)) {
        return `CHƯỚNG NGẠI VẬT CÓ ${len} CHỮ CÁI`;
    }
    if (/^\d+$/.test(clean)) {
        return `CHƯỚNG NGẠI VẬT CÓ ${len} CHỮ SỐ`;
    }
    return `CHƯỚNG NGẠI VẬT CÓ ${len} KÝ TỰ`;
}

function escapeAttr(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
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
        const nextSrc = r2DataState.cnv_image || '../graphic/r2_target.png';
        if (targetImg.getAttribute('src') !== nextSrc) {
            targetImg.style.display = 'block';
            targetImg.src = nextSrc;
        }
    }

    r2DataState.image_pieces.forEach((hidden, i) => {
        const piece = document.getElementById(`r2-cp-${i+1}`); 
        const lbl = document.getElementById(`r2-lbl-${i+1}`);
        if (piece) piece.classList.toggle('hidden', hidden);
        if (lbl) lbl.classList.toggle('hidden', hidden);
    });

    const rowWrappers = document.querySelectorAll('.r2-ctrl-row-wrapper');
    r2DataState.rows.forEach((row, i) => {
        if (rowWrappers[i]) {
            const chars = rowWrappers[i].querySelectorAll('.r2-ctrl-char');
            chars.forEach((char, idx) => {
                char.className = `r2-ctrl-char ${row.state}`; 
                char.innerText = row.answer[idx] || '';
            });
            const rowDiv = rowWrappers[i].querySelector('.r2-ctrl-row');
            if (rowDiv && rowDiv.children.length !== row.length) {
                rowDiv.innerHTML = Array.from({length: row.length}).map((_, idx) => `<div class="r2-ctrl-char ${row.state}">${row.answer[idx] || ''}</div>`).join('');
            }
        } 
    });  
    
    r2DataState.players.forEach((p, i) => { 
        const isBuzzed = r2DataState.buzzedPlayers.includes(i);
        const isWrong = Boolean(p.wrong);
        const scoreCard = document.getElementById(`r2-ctrl-score-${i}`);
        if (scoreCard) {
            if (isBuzzed) {
                scoreCard.classList.add('buzzed');
            } else {
                scoreCard.classList.remove('buzzed');
            }
            const nameEl = scoreCard.querySelector('.r2-c-score-name');
            const scoreEl = scoreCard.querySelector('.r2-c-score-val');
            if(nameEl) nameEl.innerText = p.name;
            if(scoreEl) scoreEl.innerText = p.score;
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

    const cnvTitle = document.querySelector('.r2-ctrl-cnv-title');
    if (cnvTitle) cnvTitle.innerText = formatCnvTitle(r2DataState.cnv_answer);
}

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
    if(window.playMusic) window.playMusic('R2_ShowAns.mp3', false, false);
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
        if(window.playMusic && index !== 4) window.playMusic('R2_SelectRow.mp3', false, false);
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
        if(window.playMusic) window.playMusic('R2_ShowQues.mp3', false, false);
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
        if(window.playMusic) window.playMusic('R2_15s.mp3', true, false);
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
        if(window.playMusic) window.playMusic('R2_Buzzed.mp3', false, false);
    }
    updateR2UI();
    sendR2Control();
};

window.toggleR2Piece = function(index) {
    const isHidden = !r2DataState.image_pieces[index];
    r2DataState.image_pieces[index] = isHidden;
    if (isHidden) {
        if(window.playMusic) window.playMusic('R2_PictureReveal.mp3', false, true);
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
// MÀN CONFIG VÒNG 2 (SỬA TÊN, SỬA ĐIỂM, CỘNG ĐIỂM)
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
// TÍCH HỢP DỮ LIỆU REALTIME TỪ FIREBASE
// ==========================================
r2PlayersUnsub = onValue(ref(db, 'games/players'), (snapshot) => {
    if (snapshot.exists()) {
        const playersData = snapshot.val();
        for (let i = 1; i <= 4; i++) {
            if (playersData[i]) {
                r2DataState.players[i-1].name = playersData[i].name || `P${i}`;
                r2DataState.players[i-1].score = playersData[i].score || 0;

                const cfgNameEl = document.getElementById(`r2-config-name-${i}`);
                const cfgScoreEl = document.getElementById(`r2-config-score-${i}`);
                if (cfgNameEl && document.activeElement !== cfgNameEl) {
                    cfgNameEl.innerText = r2DataState.players[i-1].name;
                    window.compressR2ConfigName(i);
                }
                if (cfgScoreEl && document.activeElement !== cfgScoreEl) {
                    cfgScoreEl.value = r2DataState.players[i-1].score;
                    window.updateR2ConfigPreview(i);
                }
            }
        }
        updateR2UI();
    }
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
                r2DataState.questions[i-1] = qData[i].cau_hoi || "";
                const ans = (qData[i].dap_an || "").replace(/\s+/g, '');
                r2DataState.rows[i-1].answer = ans;
                r2DataState.rows[i-1].length = ans.length;
                r2DataState.images[i-1] = qData[i].image || "";
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

function injectR2AnswerPanelStyles() {
    if (document.getElementById('r2-ctrl-answer-panel-style')) return;
    const styleEl = document.createElement('style');
    styleEl.id = 'r2-ctrl-answer-panel-style';
    styleEl.textContent = `
        #r2-controller-ui .r2-ctrl-image-area {
            left: 1.5% !important;
            right: auto !important;
            width: 32% !important;
        }
        #r2-controller-ui .r2-ctrl-rows-area {
            left: auto !important;
            right: 25% !important;
            width: 40% !important;
        }
        #r2-controller-ui .r2-ctrl-question {
            left: 1.5% !important;
            right: auto !important;
            width: 48% !important;
        }
        #r2-controller-ui .r2-ctrl-score-grid {
            left: auto !important;
            right: 25% !important;
            width: 25% !important;
        }

        #r2-controller-ui .r2-ctrl-answers-panel {
            position: absolute;
            top: 4%;
            bottom: 4%;
            right: 1.5%;
            width: 22%;
            background: rgba(15, 23, 42, 0.95);
            border: 2px solid #38bdf8;
            border-radius: 6px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            box-sizing: border-box;
            z-index: 20;
        }
        #r2-controller-ui .r2-ctrl-ans-header {
            font-size: 14px;
            font-weight: 800;
            color: #38bdf8;
            text-align: center;
            text-transform: uppercase;
            padding-bottom: 6px;
            border-bottom: 1px solid #334155;
        }
        #r2-controller-ui .r2-ctrl-ans-list {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            gap: 6px;
        }
        #r2-controller-ui .r2-ctrl-ans-card {
            flex: 1;
            background: #0b004b;
            border: 1.5px solid #475569;
            border-radius: 5px;
            padding: 6px 8px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 4px;
        }
        #r2-controller-ui .r2-ctrl-ans-card.buzzed {
            border-color: #facc15;
            box-shadow: 0 0 8px rgba(250, 204, 21, 0.45);
        }
        #r2-controller-ui .r2-ctrl-ans-card.wrong {
            background: #2a0a12;
            border-color: #ef4444;
        }
        #r2-controller-ui .r2-ctrl-ans-card-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 6px;
        }
        #r2-controller-ui .r2-ctrl-ans-player {
            font-size: 13px;
            font-weight: 800;
            color: #facc15;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        #r2-controller-ui .r2-ctrl-ans-status {
            font-size: 10px;
            font-weight: 800;
            padding: 2px 6px;
            border-radius: 3px;
            background: #1e293b;
            color: #94a3b8;
            flex-shrink: 0;
        }
        #r2-controller-ui .r2-ctrl-ans-status.has-answer {
            background: #166534;
            color: #bbf7d0;
        }
        #r2-controller-ui .r2-ctrl-ans-input-row {
            display: flex;
            align-items: center;
            gap: 6px;
            width: 100%;
        }
        #r2-controller-ui .r2-ctrl-ans-input {
            flex: 1;
            min-width: 0;
            background: #020617;
            color: #ffffff;
            border: 1.5px solid #334155;
            border-radius: 4px;
            padding: 5px 8px;
            font-family: inherit;
            font-size: 14px;
            font-weight: 700;
            outline: none;
            box-sizing: border-box;
        }
        #r2-controller-ui .r2-ctrl-ans-input:focus {
            border-color: #38bdf8;
        }
        #r2-controller-ui .r2-ctrl-ans-card.wrong .r2-ctrl-ans-input {
            color: #fca5a5;
            border-color: #dc2626;
            text-decoration: line-through;
        }
        #r2-controller-ui .r2-ctrl-ans-input.saved-flash {
            border-color: #22c55e !important;
        }
        #r2-controller-ui .r2-ctrl-ans-wrong-btn {
            flex-shrink: 0;
            padding: 5px 8px;
            background: #1e293b;
            color: #cbd5e1;
            border: 1.5px solid #475569;
            border-radius: 4px;
            font-family: inherit;
            font-size: 11.5px;
            font-weight: 800;
            text-transform: uppercase;
            cursor: pointer;
        }
        #r2-controller-ui .r2-ctrl-ans-wrong-btn:hover {
            border-color: #f87171;
            color: #fca5a5;
        }
        #r2-controller-ui .r2-ctrl-ans-wrong-btn.active {
            background: #dc2626;
            color: #ffffff;
            border-color: #fca5a5;
            box-shadow: 0 0 6px rgba(220, 38, 38, 0.65);
        }
        #r2-controller-ui .r2-ctrl-ans-reset-btn {
            width: 100%;
            padding: 8px;
            background: #dc2626;
            color: #ffffff;
            border: 1.5px solid #ffffff;
            border-radius: 4px;
            font-family: inherit;
            font-size: 12.5px;
            font-weight: 800;
            text-transform: uppercase;
            cursor: pointer;
        }
        #r2-controller-ui .r2-ctrl-ans-reset-btn:hover {
            background: #b91c1c;
        }

        /* ==========================================
           STYLE MODAL CONFIG VÒNG 2
           ========================================== */
        .r2-cfg-modal-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.85);
            z-index: 2000;
            justify-content: center;
            align-items: center;
        }
        .r2-cfg-modal-content {
            background: #0f172a;
            border: 2px solid #000080;
            border-radius: 8px;
            width: 960px;
            max-width: 96vw;
            padding: 22px 26px;
            color: #ffffff;
            display: flex;
            flex-direction: column;
            gap: 18px;
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.65);
            font-family: "UTM Avo", Arial, sans-serif;
            transform-origin: center center;
        }
        .r2-cfg-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #334155;
            padding-bottom: 10px;
        }
        .r2-cfg-modal-header h2 {
            font-size: 20px;
            color: #38bdf8;
            text-transform: uppercase;
            margin: 0;
        }
        .r2-cfg-close-btn {
            background: none;
            border: none;
            color: #94a3b8;
            font-size: 24px;
            cursor: pointer;
            line-height: 1;
        }
        .r2-cfg-close-btn:hover {
            color: #ff5252;
        }
        .r2-cfg-group-title {
            font-size: 13px;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-weight: bold;
        }
        .r2-cfg-players-row {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 14px;
            width: 100%;
        }
        .r2-cfg-player-card {
            display: flex;
            flex-direction: column;
            border: 2px solid #334155;
            border-radius: 6px;
            overflow: hidden;
            background-color: #0b1120;
        }
        .r2-cfg-name-wrapper {
            background: linear-gradient(90deg, #0284c7, #0369a1);
            border-bottom: 2px solid #334155;
            padding: 8px 10px;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: hidden;
            min-height: 38px;
        }
        .r2-cfg-name {
            color: #ffffff;
            text-align: center;
            font-size: 15px;
            font-weight: bold;
            white-space: nowrap;
            outline: none;
            transform-origin: center;
            display: inline-block;
            flex-shrink: 0;
            min-width: 24px;
            cursor: text;
        }
        .r2-cfg-score-section {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 8px 8px 6px 8px;
            background-color: #0b1120;
        }
        .r2-cfg-sub-label {
            font-size: 10.5px;
            font-weight: bold;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .r2-cfg-score-input {
            width: 100%;
            background-color: transparent;
            color: #ffffff;
            border: none;
            text-align: center;
            font-size: 36px;
            font-weight: bold;
            outline: none;
            font-family: "UTM Avo", Arial, sans-serif;
            padding: 2px 0;
        }
        .r2-cfg-score-input:focus {
            background-color: #162038;
            border-radius: 4px;
        }
        .r2-cfg-bonus-section {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 10px;
            background-color: #111c33;
            border-top: 1.5px solid #1e293b;
        }
        .r2-cfg-preset-row {
            display: grid;
            grid-template-columns: 1.4fr 1fr 0.9fr;
            gap: 6px;
        }
        .r2-cfg-preset-btn {
            padding: 6px 4px;
            border-radius: 4px;
            border: 1.5px solid #475569;
            background-color: #1e293b;
            color: #ffffff;
            font-family: "UTM Avo", Arial, sans-serif;
            font-size: 13px;
            font-weight: bold;
            cursor: pointer;
        }
        .r2-cfg-preset-btn:hover {
            border-color: #38bdf8;
            background-color: #27364f;
        }
        .r2-cfg-preset-btn.primary {
            background-color: #0284c7;
            border-color: #38bdf8;
            color: #ffffff;
        }
        .r2-cfg-preset-btn.primary:hover {
            background-color: #0369a1;
        }
        .r2-cfg-preset-btn.reset {
            background-color: #334155;
            color: #cbd5e1;
        }
        .r2-cfg-bonus-input-wrap {
            display: flex;
            align-items: center;
            background-color: #020617;
            border: 1.5px solid #334155;
            border-radius: 4px;
            padding: 0 8px;
        }
        .r2-cfg-bonus-input-wrap:focus-within {
            border-color: #facc15;
        }
        .r2-cfg-bonus-prefix {
            font-size: 15px;
            font-weight: bold;
            color: #facc15;
            margin-right: 4px;
            user-select: none;
        }
        .r2-cfg-bonus-input {
            width: 100%;
            background: transparent;
            border: none;
            color: #facc15;
            font-family: "UTM Avo", Arial, sans-serif;
            font-size: 18px;
            font-weight: bold;
            text-align: center;
            padding: 6px 2px;
            outline: none;
        }
        .r2-cfg-score-input::-webkit-outer-spin-button,
        .r2-cfg-score-input::-webkit-inner-spin-button,
        .r2-cfg-bonus-input::-webkit-outer-spin-button,
        .r2-cfg-bonus-input::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        .r2-cfg-score-input[type=number],
        .r2-cfg-bonus-input[type=number] {
            -moz-appearance: textfield;
        }
        .r2-cfg-preview-total {
            font-size: 12px;
            text-align: center;
            color: #94a3b8;
        }
        .r2-cfg-preview-total.has-bonus {
            color: #38bdf8;
        }
        .r2-cfg-save-btn {
            background: #0ea5e9;
            color: #ffffff;
            border: none;
            padding: 12px;
            border-radius: 4px;
            font-family: "UTM Avo", Arial, sans-serif;
            font-weight: bold;
            font-size: 15px;
            text-transform: uppercase;
            cursor: pointer;
        }
        .r2-cfg-save-btn:hover {
            background: #0284c7;
        }
    `;
    document.head.appendChild(styleEl);
}

function initR2ConfigModal() {
    const oldModal = document.getElementById('r2ConfigModal');
    if (oldModal) oldModal.remove();

    const modalHTML = `
    <div class="r2-cfg-modal-overlay" id="r2ConfigModal">
        <div class="r2-cfg-modal-content" id="r2ConfigModalContent">
            <div class="r2-cfg-modal-header">
                <h2>&#9881; CÀI ĐẶT VÒNG 2 - VƯỢT CHƯỚNG NGẠI VẬT</h2>
                <button class="r2-cfg-close-btn" onclick="closeConfig()">✖</button>
            </div>

            <div class="r2-cfg-group-title">Quản lý tên, điểm số &amp; cộng điểm thí sinh</div>

            <div class="r2-cfg-players-row">
                ${r2DataState.players.map((p, idx) => {
                    const num = idx + 1;
                    return `
                    <div class="r2-cfg-player-card">
                        <div class="r2-cfg-name-wrapper">
                            <div
                                class="r2-cfg-name"
                                contenteditable="true"
                                id="r2-config-name-${num}"
                                oninput="compressR2ConfigName(${num})"
                                onblur="updateR2ConfigNameDB(${num}, this.innerText)"
                                onkeydown="if (event.key === 'Enter') { event.preventDefault(); this.blur(); }"
                            >${escapeAttr(p.name || `P${num}`)}</div>
                        </div>

                        <div class="r2-cfg-score-section">
                            <span class="r2-cfg-sub-label">Tổng điểm hiện tại</span>
                            <input
                                class="r2-cfg-score-input"
                                type="number"
                                id="r2-config-score-${num}"
                                value="${Number(p.score) || 0}"
                                oninput="updateR2ConfigPreview(${num})"
                            />
                        </div>

                        <div class="r2-cfg-bonus-section">
                            <span class="r2-cfg-sub-label" style="text-align: center;">Điểm cộng thêm</span>
                            <div class="r2-cfg-preset-row">
                                <button type="button" class="r2-cfg-preset-btn primary" onclick="adjustR2ConfigBonus(${num}, 10)" title="Cộng thêm 10 điểm">+10</button>
                                <button type="button" class="r2-cfg-preset-btn" onclick="adjustR2ConfigBonus(${num}, -10)" title="Giảm 10 điểm">-10</button>
                                <button type="button" class="r2-cfg-preset-btn reset" onclick="setR2ConfigBonus(${num}, 0)" title="Đặt điểm cộng về 0">0</button>
                            </div>
                            <div class="r2-cfg-bonus-input-wrap" title="Nhập số điểm cộng tùy ý">
                                <span class="r2-cfg-bonus-prefix">+</span>
                                <input
                                    class="r2-cfg-bonus-input"
                                    type="number"
                                    id="r2-config-add-${num}"
                                    value="0"
                                    placeholder="Điểm khác"
                                    oninput="updateR2ConfigPreview(${num})"
                                />
                            </div>
                            <div class="r2-cfg-preview-total" id="r2-config-preview-${num}">
                                Sau lưu: <strong>${Number(p.score) || 0}</strong>
                            </div>
                        </div>
                    </div>`;
                }).join('')}
            </div>

            <button class="r2-cfg-save-btn" onclick="saveR2Config()">LƯU</button>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    window.addEventListener('resize', syncR2ConfigModalScale);
}

function initControllerR2() {
    const mainGrid = document.querySelector('.main-content-grid');
    if (!mainGrid) return;

    injectR2AnswerPanelStyles();
    initR2ConfigModal();

    const labelCoords = [
        { top: '15%', left: '15%' },
        { top: '15%', left: '85%' },
        { top: '85%', left: '85%' },
        { top: '85%', left: '15%' },
        { top: '50%', left: '50%' }
    ];

    const mockHTML = `
    <div id="r2-controller-ui">
        <div class="r2-ctrl-image-area">
            <img class="r2-ctrl-target-img" src="${escapeAttr(r2DataState.cnv_image || '../graphic/r2_target.png')}" onerror="this.style.display='none'" />
            ${r2DataState.image_pieces.map((hidden, i) => `
                <div class="r2-ctrl-piece ${hidden ? 'hidden' : ''}" id="r2-cp-${i+1}" onclick="toggleR2Piece(${i})" style="cursor: pointer; pointer-events: auto;"></div>
                <div class="r2-ctrl-lbl ${hidden ? 'hidden' : ''}" id="r2-lbl-${i+1}" style="top: ${labelCoords[i].top}; left: ${labelCoords[i].left}; transform: translate(-50%, -50%); pointer-events: none;">${i+1}</div>
            `).join('')}
        </div>

        <div class="r2-ctrl-rows-area">
            <div class="r2-ctrl-cnv-title">${formatCnvTitle(r2DataState.cnv_answer)}</div>
            ${r2DataState.rows.map((row, index) => `
                <div class="r2-ctrl-row-wrapper">
                    <div class="r2-ctrl-row">
                        ${Array.from({length: row.length}).map((_, i) => `<div class="r2-ctrl-char ${row.state}">${row.answer[i] || ''}</div>`).join('')}
                    </div>
                    
                    <div style="display: flex; align-items: center; gap: 8px; margin-left: 8px;">
                        <div class="r2-ctrl-row-number" onclick="selectR2Row(${index})" style="cursor: pointer; background: ${index === 4 ? '#d97706' : '#0ea5e9'};" title="Chọn hàng ngang ${index === 4 ? 'TT' : index + 1}">${index === 4 ? 'TT' : index + 1}</div>
                        <div style="display: flex; gap: 4px;">
                            <button onclick="setR2RowState(${index}, 'opened')" style="background: #16a34a; color: white; border: 1.5px solid white; border-radius: 4px; padding: 4px 8px; font-weight: bold; cursor: pointer;">Đ</button>
                            <button onclick="setR2RowState(${index}, 'cancelled')" style="background: #dc2626; color: white; border: 1.5px solid white; border-radius: 4px; padding: 4px 8px; font-weight: bold; cursor: pointer;">S</button>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>

        <div class="r2-ctrl-question">
            <div id="r2-ctrl-q-text" style="opacity: ${r2DataState.showQuestion ? '1' : '0.3'}; flex: 1; margin-bottom: 8px;">${r2DataState.selectedRowIndex !== -1 ? r2DataState.questions[r2DataState.selectedRowIndex] : ""}</div>
            
            <div class="r2-ctrl-page-btns" style="display: flex; flex-direction: row; flex-wrap: nowrap; gap: 6px; justify-content: space-between; margin-top: auto;">
                <button onclick="toggleR2WaitBg()" id="r2-btn-wait-bg" class="r2-ctrl-btn" style="white-space: nowrap; flex: 1; padding: 8px 6px; background: #dc2626; color: white; border: 1.5px solid #fff; border-radius: 4px; font-weight: bold; cursor: pointer;">ẨN NỀN CHỜ</button>
                <button onclick="toggleR2Question()" id="r2-btn-toggle-ques" class="r2-ctrl-btn" style="white-space: nowrap; flex: 1; padding: 8px 6px; background: ${r2DataState.showQuestion ? '#dc2626' : '#2563eb'}; color: white; border: 1.5px solid #fff; border-radius: 4px; font-weight: bold; cursor: pointer;">${r2DataState.showQuestion ? 'ẨN CÂU HỎI' : 'HIỆN CÂU HỎI'}</button>
                <button onclick="toggleR2_15s()" id="r2-btn-toggle-15s" class="r2-ctrl-btn" style="white-space: nowrap; flex: 1; padding: 8px 6px; background: ${r2DataState.show15s ? '#dc2626' : '#9333ea'}; color: white; border: 1.5px solid #fff; border-radius: 4px; font-weight: bold; cursor: pointer;">15s</button>
                <button class="r2-ctrl-btn" id="r2-btn-page" onclick="toggleR2Page()" style="white-space: nowrap; flex: 1; padding: 8px 6px;">CHUYỂN TRANG 2</button>
                <button class="r2-ctrl-btn" id="r2-btn-show-ans" onclick="showR2Answers()" style="white-space: nowrap; flex: 1; padding: 8px 6px;">HIỆN ĐÁP ÁN</button>
                <button class="r2-ctrl-btn" id="r2-btn-reset-ans" onclick="resetR2Answers()" style="white-space: nowrap; flex: 1; padding: 8px 6px;">RESET</button>
                <button class="r2-ctrl-btn" onclick="revealAllR2()" style="white-space: nowrap; flex: 1; padding: 8px 6px; background-color: #9333ea; border-color: #fff;">MỞ ALL</button>
            </div>
        </div>

        <div class="r2-ctrl-score-grid">
            ${r2DataState.players.map((p, i) => `
                <div class="r2-c-score-card" id="r2-ctrl-score-${i}" onclick="toggleR2Buzzer(${i})" style="cursor: pointer;" title="Bấm chuông chướng ngại vật">
                    <div class="r2-c-score-name">${p.name}</div>
                    <div class="r2-c-score-val">${p.score}</div>
                </div>
            `).join('')}
        </div>

        <div class="r2-ctrl-answers-panel">
            <div class="r2-ctrl-ans-header">ĐÁP ÁN THÍ SINH</div>
            <div class="r2-ctrl-ans-list">
                ${r2DataState.players.map((p, i) => `
                    <div class="r2-ctrl-ans-card ${p.wrong ? 'wrong' : ''}" id="r2-ctrl-ans-card-${i}">
                        <div class="r2-ctrl-ans-card-top">
                            <div class="r2-ctrl-ans-player" id="r2-ctrl-ans-name-${i}">${i + 1}. ${p.name}</div>
                            <span class="r2-ctrl-ans-status" id="r2-ctrl-ans-status-${i}">TRỐNG</span>
                        </div>
                        <div class="r2-ctrl-ans-input-row">
                            <input 
                                type="text" 
                                class="r2-ctrl-ans-input" 
                                id="r2-ctrl-ans-input-${i}" 
                                value="${escapeAttr(p.answer)}" 
                                placeholder="Nhập hoặc chờ đáp án..." 
                                onchange="updateR2PlayerAnswer(${i}, this.value)"
                                onkeydown="if (event.key === 'Enter') { updateR2PlayerAnswer(${i}, this.value); this.blur(); }"
                            />
                            <button 
                                type="button" 
                                class="r2-ctrl-ans-wrong-btn ${p.wrong ? 'active' : ''}" 
                                id="r2-ctrl-ans-wrong-${i}" 
                                onclick="toggleR2PlayerWrong(${i})" 
                                title="Đánh dấu / hủy đánh dấu đáp án sai"
                            >SAI</button>
                        </div>
                    </div>
                `).join('')}
            </div>
            <button class="r2-ctrl-ans-reset-btn" onclick="resetAllR2PlayerAnswers()">RESET ĐÁP ÁN TS</button>
        </div>
    </div>`;

    mainGrid.insertAdjacentHTML('beforeend', mockHTML);
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
    const styleEl = document.getElementById('r2-ctrl-answer-panel-style');
    if (styleEl) styleEl.remove();
    const cfgModal = document.getElementById('r2ConfigModal');
    if (cfgModal) cfgModal.remove();
    const ui = document.getElementById('r2-controller-ui');
    if (ui) ui.remove();
};