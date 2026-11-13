import { getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, set, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const app = getApp();
const db = getDatabase(app);
const r2Channel = new BroadcastChannel('olympia_r2_control');

let r2DataState = {
    cnv_length: 5,
    rows: [
        { answer: "TÔN THẤT TÙNG", state: 'unselected' }, // Hàng 1
        { answer: "HÀ NỘI", state: 'unselected' },       // Hàng 2
        { answer: "THU", state: 'unselected' },         // Hàng 3
        { answer: "ĐÔNG", state: 'unselected' },        // Hàng 4
        { answer: "HÀ NỘI", state: 'unselected' }        // Hàng 5 (Trung tâm)
    ].map(row => {
        const cleanAnswer = row.answer.replace(/\s+/g, '');
        return {
            ...row,
            answer: cleanAnswer,
            length: cleanAnswer.length
        };
    }),
    image_pieces: [false, false, false, false, false],
    questions: [
        "Tên một bệnh viện nổi tiếng ở Hà Nội?",
        "Thủ đô của nước Cộng hòa Xã hội chủ nghĩa Việt Nam là gì?",
        "Mùa lá rụng là mùa nào trong năm?",
        "Mùa lạnh nhất trong năm là mùa nào?",
        "Từ khóa trung tâm" 
    ],
    players: [
        { name: "P1", score: 100 }, { name: "P2", score: 80 },
        { name: "P3", score: 120 }, { name: "P4", score: 0 }
    ],
    showQuestion: false,
    show15s: false,
    buzzedPlayers: [],
    selectedRowIndex: -1
};

let r2CurrentPage = 1;
let r2ShowAnswers = false;
let r2ShowWaitBg = true; // Biến quản lý trạng thái hình nền chờ

function sendR2Control() {
    const payload = {
        page: r2CurrentPage,
        showAnswers: r2ShowAnswers,
        showWaitBg: r2ShowWaitBg, // Gửi trạng thái hình nền sang Projector
        rows: r2DataState.rows.map(r => r.state),
        image_pieces: r2DataState.image_pieces,
        showQuestion: r2DataState.showQuestion,
        show15s: r2DataState.show15s,
        buzzedPlayers: r2DataState.buzzedPlayers,
        currentRowIndex: r2DataState.selectedRowIndex !== -1 ? r2DataState.selectedRowIndex : 0,
        question: r2DataState.selectedRowIndex !== -1 ? r2DataState.questions[r2DataState.selectedRowIndex] : "",
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

    r2DataState.image_pieces.forEach((hidden, i) => {
        const piece = document.getElementById(`r2-cp-${i+1}`); const lbl = document.getElementById(`r2-lbl-${i+1}`);
        if (piece) piece.classList.toggle('hidden', hidden);
        if (lbl) lbl.classList.toggle('hidden', hidden);
    });

    const rowWrappers = document.querySelectorAll('.r2-ctrl-row-wrapper');
    r2DataState.rows.forEach((row, i) => {
        if (rowWrappers[i]) {
            const chars = rowWrappers[i].querySelectorAll('.r2-ctrl-char');
            chars.forEach(char => {
                char.className = `r2-ctrl-char ${row.state}`; 
            }); 
        } 
    });  
    
    r2DataState.players.forEach((_, i) => { 
        const scoreCard = document.getElementById(`r2-ctrl-score-${i}`);
        if (scoreCard) {
            if (r2DataState.buzzedPlayers.includes(i)) {
                scoreCard.classList.add('buzzed');
            } else {
                scoreCard.classList.remove('buzzed');
            }
        }
    });
}

// Hàm xử lý việc tắt nền chờ và chạy nhạc
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
    r2ShowAnswers = false;
    updateR2ButtonsUI();
    update(ref(db, 'games/soundboard'), { soundId: 'R2_ShowAns_mp3', action: 'stop', timestamp: Date.now() });
    sendR2Control();
};

window.showR2Answers = function() {
    r2ShowAnswers = true;
    updateR2ButtonsUI();
    if(window.playMusic) window.playMusic('R2_ShowAns.mp3', false, false);
    sendR2Control();
};

window.resetR2Answers = function() {
    r2ShowAnswers = false;
    updateR2ButtonsUI();
    update(ref(db, 'games/soundboard'), { soundId: 'R2_ShowAns_mp3', action: 'stop', timestamp: Date.now() });
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

function initControllerR2() {
    const mainGrid = document.querySelector('.main-content-grid');
    if (!mainGrid) return;

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
            <img class="r2-ctrl-target-img" src="../graphic/r2_target.png" onerror="this.style.display='none'" />
            ${r2DataState.image_pieces.map((hidden, i) => `
                <div class="r2-ctrl-piece ${hidden ? 'hidden' : ''}" id="r2-cp-${i+1}" onclick="toggleR2Piece(${i})" style="cursor: pointer; pointer-events: auto;"></div>
                <div class="r2-ctrl-lbl ${hidden ? 'hidden' : ''}" id="r2-lbl-${i+1}" style="top: ${labelCoords[i].top}; left: ${labelCoords[i].left}; transform: translate(-50%, -50%); pointer-events: none;">${i+1}</div>
            `).join('')}
        </div>

        <div class="r2-ctrl-rows-area">
            <div class="r2-ctrl-cnv-title">CHƯỚNG NGẠI VẬT CÓ ${r2DataState.cnv_length} CHỮ CÁI</div>
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
    </div>`;

    mainGrid.insertAdjacentHTML('beforeend', mockHTML);
    r2CurrentPage = 1;
    r2ShowAnswers = false;
    updateR2ButtonsUI();
    sendR2Control();
}

initControllerR2();

window.cleanupCurrentRound = () => {
    const ui = document.getElementById('r2-controller-ui');
    if (ui) ui.remove();
};