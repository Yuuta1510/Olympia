import { getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const app = getApp();
const db = window.firebaseDB || getDatabase(app);
const r2Channel = new BroadcastChannel('olympia_r2_control');

const mockR2Data = {
    cnv_length: 5,
    currentRowIndex: 0, 
    rows: [
        { answer: "TÔN THẤT TÙNG", state: 'unselected' }, 
        { answer: "HÀ NỘI", state: 'unselected' },       
        { answer: "THU", state: 'unselected' },         
        { answer: "ĐÔNG", state: 'unselected' },        
        { answer: "HÀ NỘI", state: 'unselected' }       
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
        { name: "P1", answer: "" }, { name: "P2", answer: "" },
        { name: "P3", answer: "" }, { name: "P4", answer: "" }
    ],
    currentPage: 1,
    showAnswers: false,
    showWaitBg: true, // Trạng thái mặc định hiển thị nền chờ
    showQuestion: false,
    show15s: false,
    buzzedPlayers: []
};

let revealTimeout = null;
let r2CtrlUnsub = null;
let r2PlayersUnsub = null;

function clearRevealTimeout() {
    if (revealTimeout !== null) {
        clearTimeout(revealTimeout);
        revealTimeout = null;
    }
}

function compressP2Text(spanId) {
    const spanEl = document.getElementById(spanId);
    if (!spanEl || !spanEl.parentElement) return;

    const parentEl = spanEl.parentElement;
    const style = window.getComputedStyle(parentEl);

    spanEl.style.display = 'inline-block';
    spanEl.style.whiteSpace = 'nowrap';
    spanEl.style.flexShrink = '0';

    if (style.display !== 'flex' && style.display !== 'inline-flex') {
        parentEl.style.display = 'flex';
        parentEl.style.alignItems = 'center';
        if (style.textAlign === 'center') {
            parentEl.style.justifyContent = 'center';
        } else if (style.textAlign === 'right') {
            parentEl.style.justifyContent = 'flex-end';
        } else {
            parentEl.style.justifyContent = 'flex-start';
        }
    }
    parentEl.style.overflow = 'hidden';

    const updatedStyle = window.getComputedStyle(parentEl);
    const paddingX = (parseFloat(updatedStyle.paddingLeft) || 0) + (parseFloat(updatedStyle.paddingRight) || 0);
    const containerWidth = parentEl.clientWidth - paddingX;
    if (containerWidth <= 0) return;

    const justify = updatedStyle.justifyContent;
    if (justify === 'center') {
        spanEl.style.transformOrigin = 'center center';
    } else if (justify === 'flex-end' || justify === 'end') {
        spanEl.style.transformOrigin = 'right center';
    } else {
        spanEl.style.transformOrigin = 'left center';
    }

    spanEl.style.transform = 'none';
    const textWidth = Math.max(spanEl.scrollWidth, spanEl.offsetWidth);

    if (textWidth > containerWidth) {
        const ratio = containerWidth / textWidth;
        spanEl.style.transform = `scaleX(${ratio})`;
    }
}

function compressAllP2Texts() {
    for (let i = 1; i <= 4; i++) {
        compressP2Text(`r2-proj-name-text-${i}`);
        compressP2Text(`r2-proj-ans-text-${i}`);
    }
    if (mockR2Data.buzzedPlayers) {
        mockR2Data.buzzedPlayers.forEach(pIdx => compressP2Text(`r2-buzzer-name-${pIdx}`));
    }
}

function hideAllAnswersInstant() {
    for (let i = 1; i <= 4; i++) {
        const nameEl = document.getElementById(`r2-proj-name-${i}`);
        const ansEl = document.getElementById(`r2-proj-ans-${i}`);
        if (nameEl) {
            nameEl.style.transition = 'none';
            nameEl.classList.remove('fade-in');
        }
        if (ansEl) {
            ansEl.style.transition = 'none';
            ansEl.classList.remove('fade-in');
        }
    }
}

function initProjectorR2() {
    if (!document.getElementById('projector-bg')) return;

    const oldUi = document.getElementById('r2-projector-ui');
    if (oldUi) oldUi.remove();

    const rootHTML = `
    <div id="r2-projector-ui">
        <!-- Lớp hình nền chờ đè lên mọi thứ của R2 -->
        <div id="r2-wait-bg" style="position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; background-image: url('../graphic/R2_Wait.png'); background-size: cover; background-position: center; z-index: 9999; display: block; opacity: 1; pointer-events: auto;"></div>
        
        <div id="r2-page-1">
            <div class="r2-bg-layer"></div>
            <video class="r2-video-layer" id="r2-15s-video" src="../graphic/R2_15s.webm" playsinline preload="auto" style="display: none; z-index: 1;"></video>
            
            <div class="r2-image-area">
                <img class="r2-main-img" src="../graphic/r2_target.png" />
                ${mockR2Data.image_pieces.map((hidden, i) => `<img class="r2-piece ${hidden ? 'hidden' : ''}" id="r2-p${i+1}" src="../graphic/${i+1}.png" />`).join('')}
            </div>
            
            <div class="r2-rows-area">
                <div class="r2-cnv-title">CHƯỚNG NGẠI VẬT CÓ ${mockR2Data.cnv_length} CHỮ CÁI</div>
                ${mockR2Data.rows.map((row, i) => `
                    <div class="r2-row-container">
                        <div class="r2-row">
                            ${Array.from({length: row.length}).map((_, charIdx) => `<div class="r2-char ${row.state}">${row.answer[charIdx] || ''}</div>`).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
            
            <div class="r2-buzzer-container" id="r2-buzzer-container"></div>
            
            <div class="r2-question-box" style="display: ${mockR2Data.showQuestion ? 'block' : 'none'};">
                ${mockR2Data.questions[mockR2Data.currentRowIndex] || ""}
            </div>
        </div>

        <div id="r2-page-2">
            <div class="r2-p2-bg"></div>
            <video class="r2-video-layer" id="r2-ans-video" src="../graphic/R2_showans.webm" onerror="this.onerror=null; this.src='../graphic/R2_ShowAns.webm';" playsinline preload="auto"></video>
            ${mockR2Data.players.map((p, i) => `
                <div class="r2-p2-text r2-p2-name r2-p2-pos-${i+1}" id="r2-proj-name-${i+1}"><span class="r2-p2-inner" id="r2-proj-name-text-${i+1}">${p.name}</span></div>
                <div class="r2-p2-text r2-p2-ans r2-p2-pos-${i+1}" id="r2-proj-ans-${i+1}"><span class="r2-p2-inner" id="r2-proj-ans-text-${i+1}">${p.answer}</span></div>
            `).join('')}
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', rootHTML);
    renderPageLogic();

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            if (mockR2Data.currentPage === 2) compressAllP2Texts();
        });
    }

    const handleControl = (data) => {
        if (!data) return;
        mockR2Data.currentPage = data.page === 2 ? 2 : 1;
        mockR2Data.showAnswers = Boolean(data.showAnswers);
        
        if (data.showWaitBg !== undefined) {
            mockR2Data.showWaitBg = Boolean(data.showWaitBg);
        }

        if (data.currentRowIndex !== undefined) {
            mockR2Data.currentRowIndex = data.currentRowIndex;
        } else if (data.currentRow !== undefined) {
            mockR2Data.currentRowIndex = Math.max(0, data.currentRow - 1); 
        } else if (data.row !== undefined) {
            mockR2Data.currentRowIndex = Math.max(0, data.row - 1);
        }
        
        if (data.questions !== undefined) mockR2Data.questions = data.questions;

        if (data.rows) {
            data.rows.forEach((st, i) => {
                if (mockR2Data.rows[i]) mockR2Data.rows[i].state = st;
            });
        }
        if (data.image_pieces) {
            mockR2Data.image_pieces = data.image_pieces;
        }
        if (data.showQuestion !== undefined) {
            mockR2Data.showQuestion = data.showQuestion;
        }
        if (data.show15s !== undefined) {
            mockR2Data.show15s = data.show15s;
        }
        if (data.buzzedPlayers) {
            mockR2Data.buzzedPlayers = data.buzzedPlayers;
        } else {
            mockR2Data.buzzedPlayers = [];
        }
        renderPageLogic();
    };

    r2CtrlUnsub = onValue(ref(db, 'games/r2_control'), (snapshot) => {
        if (snapshot.exists()) handleControl(snapshot.val());
    });

    r2Channel.onmessage = (event) => handleControl(event.data);

    r2PlayersUnsub = onValue(ref(db, 'games/players'), (snapshot) => {
        if (!snapshot.exists()) return;
        const players = snapshot.val();
        for (let i = 1; i <= 4; i++) {
            if (players[i]) {
                mockR2Data.players[i - 1].name = players[i].name || `P${i}`;
                const nameTextEl = document.getElementById(`r2-proj-name-text-${i}`);
                if (nameTextEl) {
                    nameTextEl.textContent = mockR2Data.players[i - 1].name;
                    compressP2Text(`r2-proj-name-text-${i}`);
                }
            }
        }
        if (mockR2Data.buzzedPlayers && mockR2Data.buzzedPlayers.length > 0) {
            mockR2Data.buzzedPlayers.forEach(pIdx => {
                const bzEl = document.getElementById(`r2-buzzer-name-${pIdx}`);
                if (bzEl) {
                    bzEl.textContent = mockR2Data.players[pIdx].name;
                    compressP2Text(`r2-buzzer-name-${pIdx}`);
                }
            });
        }
    });

    window.addEventListener('resize', compressAllP2Texts);
}

function renderPageLogic() {
    const page1 = document.getElementById('r2-page-1');
    const page2 = document.getElementById('r2-page-2');
    const vid = document.getElementById('r2-ans-video');
    const waitBg = document.getElementById('r2-wait-bg');
    if (!page1 || !page2) return;

    clearRevealTimeout();

    // Điều khiển lớp nền chờ
    if (waitBg) {
        if (mockR2Data.showWaitBg) {
            waitBg.style.opacity = '1';
            waitBg.style.pointerEvents = 'auto';
        } else {
            waitBg.style.opacity = '0';
            waitBg.style.pointerEvents = 'none';
        }
    }

    mockR2Data.image_pieces.forEach((hidden, i) => {
        const piece = document.getElementById(`r2-p${i+1}`);
        if (piece) piece.classList.toggle('hidden', hidden);
    });

    const rowEls = document.querySelectorAll('#r2-page-1 .r2-row');
    mockR2Data.rows.forEach((row, i) => {
        if (rowEls[i]) {
            const charEls = rowEls[i].querySelectorAll('.r2-char');
            charEls.forEach((charEl) => {
                charEl.className = `r2-char ${row.state}`;
            });
        }
    });

    const qBox = document.querySelector('#r2-page-1 .r2-question-box');
    if (qBox) {
        qBox.style.display = mockR2Data.showQuestion ? 'block' : 'none';
        qBox.innerText = mockR2Data.questions[mockR2Data.currentRowIndex] || "";
    }

    const vid15s = document.getElementById('r2-15s-video');
    if (mockR2Data.show15s) {
        if (vid15s && vid15s.style.display === 'none') {
            vid15s.style.display = 'block';
            vid15s.currentTime = 0;
            vid15s.play().catch(() => {});
        }
    } else {
        if (vid15s) {
            vid15s.style.display = 'none';
            vid15s.pause();
            vid15s.currentTime = 0;
        }
    }

    const buzzerContainer = document.getElementById('r2-buzzer-container');
    if (buzzerContainer) {
        if (mockR2Data.currentPage === 1 && mockR2Data.buzzedPlayers && mockR2Data.buzzedPlayers.length > 0) {
            const renderList = [...mockR2Data.buzzedPlayers].reverse();
            buzzerContainer.innerHTML = renderList.map(pIdx => `
                <div class="r2-buzzer-item">
                    <div class="r2-buzzer-name-wrapper">
                        <span class="r2-buzzer-name" id="r2-buzzer-name-${pIdx}">${mockR2Data.players[pIdx].name}</span>
                    </div>
                </div>
            `).join('');
            
            renderList.forEach(pIdx => {
                compressP2Text(`r2-buzzer-name-${pIdx}`);
            });
        } else {
            buzzerContainer.innerHTML = '';
        }
    }

    if (mockR2Data.currentPage === 1) {
        page1.style.display = 'block';
        page2.style.display = 'none';
        if (vid) {
            vid.style.display = 'none';
            vid.pause();
            vid.currentTime = 0;
        }
        hideAllAnswersInstant();
        return;
    }

    page1.style.display = 'none';
    page2.style.display = 'block';
    compressAllP2Texts();

    if (mockR2Data.showAnswers) {
        if (vid) {
            vid.style.display = 'block';
            vid.currentTime = 0;
            vid.play().catch(() => {});
        }

        hideAllAnswersInstant();
        revealTimeout = setTimeout(() => {
            compressAllP2Texts();
            for (let i = 1; i <= 4; i++) {
                const nameEl = document.getElementById(`r2-proj-name-${i}`);
                const ansEl = document.getElementById(`r2-proj-ans-${i}`);
                if (nameEl) {
                    nameEl.style.transition = '';
                    nameEl.classList.add('fade-in');
                }
                if (ansEl) {
                    ansEl.style.transition = '';
                    ansEl.classList.add('fade-in');
                }
            }
            revealTimeout = null;
        }, 2000);
    } else {
        if (vid) {
            vid.style.display = 'none';
            vid.pause();
            vid.currentTime = 0;
        }
        hideAllAnswersInstant();
    }
}

initProjectorR2();

window.cleanupCurrentRound = () => {
    clearRevealTimeout();
    window.removeEventListener('resize', compressAllP2Texts);
    if (typeof r2CtrlUnsub === 'function') r2CtrlUnsub();
    if (typeof r2PlayersUnsub === 'function') r2PlayersUnsub();
    r2Channel.onmessage = null;
    const ui = document.getElementById('r2-projector-ui');
    if (ui) ui.remove();
};