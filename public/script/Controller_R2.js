import { getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, set } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const app = getApp();
const db = getDatabase(app);
const r2Channel = new BroadcastChannel('olympia_r2_control');

const mockR2DataCtrl = {
    cnv_length: 15,
    rows: [
        { length: 6, answer: "HÀ NỘI", state: 'opened' },
        { length: 4, answer: "MÙA", state: 'selected' },
        { length: 3, answer: "THU", state: 'cancelled' },
        { length: 5, answer: "ĐÔNG", state: 'unselected' }
    ],
    image_pieces: [false, false, true, false, false], 
    question: "Thủ đô của nước Cộng hòa Xã hội chủ nghĩa Việt Nam là gì?",
    players: [
        { name: "P1", score: 100 }, { name: "P2", score: 80 },
        { name: "P3", score: 120 }, { name: "P4", score: 0 }
    ]
};

let r2CurrentPage = 1;
let r2ShowAnswers = false;

function sendR2Control() {
    const payload = {
        page: r2CurrentPage,
        showAnswers: r2ShowAnswers,
        timestamp: Date.now()
    };
    set(ref(db, 'games/r2_control'), payload);
    r2Channel.postMessage(payload);
}

function updateR2ButtonsUI() {
    const pageBtn = document.getElementById('r2-btn-page');
    const showAnsBtn = document.getElementById('r2-btn-show-ans');

    if (pageBtn) {
        pageBtn.textContent = r2CurrentPage === 1 ? 'CHUYỂN TRANG 2' : 'CHUYỂN TRANG 1';
        pageBtn.classList.toggle('active', r2CurrentPage === 2);
    }
    if (showAnsBtn) {
        showAnsBtn.classList.toggle('active', r2ShowAnswers);
    }
}

window.toggleR2Page = function() {
    r2CurrentPage = r2CurrentPage === 1 ? 2 : 1;
    r2ShowAnswers = false;
    updateR2ButtonsUI();
    sendR2Control();
};

window.showR2Answers = function() {
    r2ShowAnswers = true;
    updateR2ButtonsUI();
    sendR2Control();
};

window.resetR2Answers = function() {
    r2ShowAnswers = false;
    updateR2ButtonsUI();
    sendR2Control();
};

function initControllerR2() {
    const mainGrid = document.querySelector('.main-content-grid');
    if (!mainGrid) return;
    
    // Đặt tọa độ (top, left) lệch khỏi tâm để số nằm ở góc hoặc vị trí bạn thích
    const labelCoords = [
        { top: '15%', left: '15%' }, // Số 1: Nằm lệch về góc trên-trái của mảnh chữ L 1
        { top: '15%', left: '85%' }, // Số 2: Nằm lệch về góc trên-phải của mảnh chữ L 2
        { top: '85%', left: '85%' }, // Số 3: Nằm lệch về góc dưới-phải của mảnh chữ L 3
        { top: '85%', left: '15%' }, // Số 4: Nằm lệch về góc dưới-trái của mảnh chữ L 4
        { top: '50%', left: '50%' }  // Số 5: Giữ ở chính giữa hình chữ nhật trung tâm
    ];

    const mockHTML = `
    <div id="r2-controller-ui">
        <div class="r2-ctrl-image-area">
            <img class="r2-ctrl-target-img" src="../graphic/r2_target.png" onerror="this.style.display='none'" />
            ${mockR2DataCtrl.image_pieces.map((hidden, i) => `
                <div class="r2-ctrl-piece ${hidden ? 'hidden' : ''}" id="r2-cp-${i+1}"></div>
                <div class="r2-ctrl-lbl ${hidden ? 'hidden' : ''}" id="r2-lbl-${i+1}" style="top: ${labelCoords[i].top}; left: ${labelCoords[i].left}; transform: translate(-50%, -50%);">${i+1}</div>
            `).join('')}
        </div>

        <div class="r2-ctrl-rows-area">
            <div class="r2-ctrl-cnv-title">CHƯỚNG NGẠI VẬT CÓ ${mockR2DataCtrl.cnv_length} CHỮ CÁI</div>
            ${mockR2DataCtrl.rows.map((row, index) => `
                <div class="r2-ctrl-row-wrapper">
                    <div class="r2-ctrl-row">
                        ${Array.from({length: row.length}).map((_, i) => `<div class="r2-ctrl-char ${row.state}">${row.answer[i] || ''}</div>`).join('')}
                    </div>
                    <div class="r2-ctrl-row-number">${index + 1}</div>
                </div>
            `).join('')}
        </div>

        <div class="r2-ctrl-question">${mockR2DataCtrl.question}</div>

        <div class="r2-ctrl-score-grid">
            ${mockR2DataCtrl.players.map(p => `
                <div class="r2-c-score-card">
                    <div class="r2-c-score-name">${p.name}</div>
                    <div class="r2-c-score-val">${p.score}</div>
                </div>
            `).join('')}
        </div>

        <div class="r2-ctrl-page-btns">
            <button class="r2-ctrl-btn" id="r2-btn-page" onclick="toggleR2Page()">CHUYỂN TRANG 2</button>
            <button class="r2-ctrl-btn" id="r2-btn-show-ans" onclick="showR2Answers()">HIỆN ĐÁP ÁN</button>
            <button class="r2-ctrl-btn" id="r2-btn-reset-ans" onclick="resetR2Answers()">RESET HIỆN ĐÁP ÁN</button>
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