import { getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const app = getApp();
const db = window.firebaseDB || getDatabase(app);
const r2Channel = new BroadcastChannel('olympia_r2_control');

const mockR2Data = {
    cnv_length: 5,
    rows: [
        { length: 11, answer: "TÔNTHẤTTÙNG", state: 'opened' },
        { length: 5, answer: "HÀNỘI", state: 'selected' },
        { length: 3, answer: "THU", state: 'cancelled' },
        { length: 5, answer: "ĐÔNG", state: 'unselected' }
    ],
    image_pieces: [false, false, false, false, false], 
    question: "Thủ đô của nước Cộng hòa Xã hội chủ nghĩa Việt Nam là gì?",
    players: [
        { name: "P1", answer: "OLYMPIA NĂM THỨ 27" },
        { name: "P2", answer: "ĐƯỜNG LÊN ĐỈNH OLYMPIA NĂM THỨ 27" },
        { name: "P3", answer: "CHÂU GAY" },
        { name: "P4", answer: "SOUTA GAY" }
    ],
    currentPage: 1,
    showAnswers: false
};

const showAnsAudio = new Audio('../sounds/R2_ShowAns.mp3');
showAnsAudio.preload = 'auto';
showAnsAudio.onerror = () => {
    if (!showAnsAudio.src.endsWith('R2_showans.mp3')) {
        showAnsAudio.src = '../sounds/R2_showans.mp3';
    }
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

    // Bắt buộc span phải là inline-block + nowrap để transform: scaleX hoạt động
    spanEl.style.display = 'inline-block';
    spanEl.style.whiteSpace = 'nowrap';
    spanEl.style.flexShrink = '0';

    // Đảm bảo khung cha dùng flex để không bị lệch tâm khi chữ dài hơn khung
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

    // Đặt tâm co giãn khớp với hướng căn lề của textbox
    const justify = updatedStyle.justifyContent;
    if (justify === 'center') {
        spanEl.style.transformOrigin = 'center center';
    } else if (justify === 'flex-end' || justify === 'end') {
        spanEl.style.transformOrigin = 'right center';
    } else {
        spanEl.style.transformOrigin = 'left center';
    }

    // Trả về tỷ lệ 1:1 để đo chính xác chiều rộng thật của text
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
    // Tự động hủy nếu đang chạy trên Livestream để đảm bảo tách bạch 100%
    if (!document.getElementById('projector-bg')) return;

    const oldUi = document.getElementById('r2-projector-ui');
    if (oldUi) oldUi.remove();

    const rootHTML = `
    <div id="r2-projector-ui">
        <div id="r2-page-1">
            <div class="r2-bg-layer"></div>
            <div class="r2-image-area">
                <img class="r2-main-img" src="../graphic/r2_target.png" />
                ${mockR2Data.image_pieces.map((hidden, i) => `<img class="r2-piece ${hidden ? 'hidden' : ''}" id="r2-p${i+1}" src="../graphic/${i+1}.png" />`).join('')}
            </div>
            
            <div class="r2-rows-area">
                <div class="r2-cnv-title">CHƯỚNG NGẠI VẬT CÓ ${mockR2Data.cnv_length} CHỮ CÁI</div>
                ${mockR2Data.rows.map(row => `
                    <div class="r2-row">
                        ${Array.from({length: row.length}).map((_, i) => `<div class="r2-char ${row.state}">${row.answer[i] || ''}</div>`).join('')}
                    </div>
                `).join('')}
            </div>
            <div class="r2-question-box">${mockR2Data.question}</div>
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
    });

    window.addEventListener('resize', compressAllP2Texts);
}

function renderPageLogic() {
    const page1 = document.getElementById('r2-page-1');
    const page2 = document.getElementById('r2-page-2');
    const vid = document.getElementById('r2-ans-video');
    if (!page1 || !page2) return;

    clearRevealTimeout();

    if (mockR2Data.currentPage === 1) {
        page1.style.display = 'block';
        page2.style.display = 'none';
        if (vid) {
            vid.style.display = 'none';
            vid.pause();
            vid.currentTime = 0;
        }
        showAnsAudio.pause();
        showAnsAudio.currentTime = 0;
        hideAllAnswersInstant();
        return;
    }

    // Đang ở Trang 2
    page1.style.display = 'none';
    page2.style.display = 'block';
    compressAllP2Texts();

    if (mockR2Data.showAnswers) {
        // 1. Hiện và chạy video R2_showans.webm
        if (vid) {
            vid.style.display = 'block';
            vid.currentTime = 0;
            vid.play().catch(() => {});
        }

        // 2. Chạy nhạc R2_ShowAns.mp3
        showAnsAudio.currentTime = 0;
        showAnsAudio.play().catch(() => {});

        // 3. Delay 2s rồi fade-in toàn bộ 4 tên thí sinh và 4 đáp án cùng lúc trong 0.3s
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
        // Chỉ có nền bg.png: ẩn cả video và toàn bộ 8 text, dừng nhạc
        if (vid) {
            vid.style.display = 'none';
            vid.pause();
            vid.currentTime = 0;
        }
        showAnsAudio.pause();
        showAnsAudio.currentTime = 0;
        hideAllAnswersInstant();
    }
}

initProjectorR2();

window.cleanupCurrentRound = () => {
    clearRevealTimeout();
    window.removeEventListener('resize', compressAllP2Texts);
    showAnsAudio.pause();
    showAnsAudio.currentTime = 0;
    if (typeof r2CtrlUnsub === 'function') r2CtrlUnsub();
    if (typeof r2PlayersUnsub === 'function') r2PlayersUnsub();
    r2Channel.onmessage = null;
    const ui = document.getElementById('r2-projector-ui');
    if (ui) ui.remove();
};

// Bật Console gõ testTogglePage() để nhảy qua Trang 2
window.testTogglePage = () => {
    mockR2Data.currentPage = mockR2Data.currentPage === 1 ? 2 : 1;
    mockR2Data.showAnswers = false;
    renderPageLogic();
};