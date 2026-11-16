import { getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// ==========================================
// 1. KHỞI TẠO FIREBASE, KÊNH ĐỒNG BỘ & TRẠNG THÁI
// ==========================================
const app = getApp();
const db = window.firebaseDB || getDatabase(app);
const r2Channel = new BroadcastChannel('olympia_r2_control');

const mockR2Data = {
    cnv_answer: "",
    cnv_length: 0,
    cnv_image: "",
    currentRowIndex: 0,
    rows: [
        { answer: "", state: 'unselected', length: 0 },
        { answer: "", state: 'unselected', length: 0 },
        { answer: "", state: 'unselected', length: 0 },
        { answer: "", state: 'unselected', length: 0 },
        { answer: "", state: 'unselected', length: 0 }
    ],
    image_pieces: [false, false, false, false, false],
    questions: ["", "", "", "", ""],
    players: [
        { name: "P1", answer: "" },
        { name: "P2", answer: "" },
        { name: "P3", answer: "" },
        { name: "P4", answer: "" }
    ],
    wrongAnswers: [false, false, false, false],
    currentPage: 1,
    showAnswers: false,
    showAnswersSeq: 0,
    showWaitBg: true,
    showQuestion: false,
    show15s: false,
    buzzedPlayers: []
};

let revealTimeout = null;
let lastPlayedShowAnswersSeq = 0;
let r2CtrlUnsub = null;
let r2PlayersUnsub = null;
let r2QuestionsUnsub = null;
let r2AnswersUnsub = null;

// ==========================================
// 2. HÀM TIỆN ÍCH ĐỊNH DẠNG & CO CHỮ
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
        const wrongEl = document.getElementById(`r2-proj-wrong-${i}`);
        if (nameEl) {
            nameEl.style.transition = 'none';
            nameEl.classList.remove('fade-in');
        }
        if (ansEl) {
            ansEl.style.transition = 'none';
            ansEl.classList.remove('fade-in');
        }
        if (wrongEl) {
            wrongEl.style.transition = 'none';
            wrongEl.classList.remove('fade-in');
        }
    }
}

// ==========================================
// 3. CẬP NHẬT GIAO DIỆN PROJECTOR VÒNG 2
// ==========================================
function renderPageLogic() {
    const page1 = document.getElementById('r2-page-1');
    const page2 = document.getElementById('r2-page-2');
    const vid = document.getElementById('r2-ans-video');
    const waitBg = document.getElementById('r2-wait-bg');
    if (!page1 || !page2) return;

    if (waitBg) {
        if (mockR2Data.showWaitBg) {
            waitBg.style.opacity = '1';
            waitBg.style.pointerEvents = 'auto';
        } else {
            waitBg.style.opacity = '0';
            waitBg.style.pointerEvents = 'none';
        }
    }

    const mainImg = document.querySelector('#r2-page-1 .r2-main-img');
    if (mainImg) {
        const nextSrc = mockR2Data.cnv_image || '../graphic/r2_target.png';
        if (mainImg.getAttribute('src') !== nextSrc) {
            mainImg.src = nextSrc;
        }
    }

    mockR2Data.image_pieces.forEach((hidden, i) => {
        const piece = document.getElementById(`r2-p${i + 1}`);
        if (piece) piece.classList.toggle('hidden', hidden);
    });

    const cnvTitle = document.querySelector('#r2-page-1 .r2-cnv-title');
    if (cnvTitle) cnvTitle.innerText = formatCnvTitle(mockR2Data.cnv_answer);

    const rowEls = document.querySelectorAll('#r2-page-1 .r2-row-container');
    mockR2Data.rows.forEach((row, i) => {
        if (!rowEls[i]) return;
        const rowDiv = rowEls[i].querySelector('.r2-row');
        if (!rowDiv) return;

        if (rowDiv.children.length !== row.length) {
            rowDiv.replaceChildren();
            const fragment = document.createDocumentFragment();
            for (let charIdx = 0; charIdx < row.length; charIdx++) {
                const charEl = document.createElement('div');
                charEl.className = `r2-char ${row.state}`;
                charEl.innerText = row.answer[charIdx] || '';
                fragment.appendChild(charEl);
            }
            rowDiv.appendChild(fragment);
        } else {
            const charEls = rowDiv.querySelectorAll('.r2-char');
            charEls.forEach((charEl, charIdx) => {
                charEl.className = `r2-char ${row.state}`;
                charEl.innerText = row.answer[charIdx] || '';
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
        if (vid15s && vid15s.style.display !== 'block') {
            vid15s.style.display = 'block';
            vid15s.currentTime = 0;
            vid15s.play().catch(() => {});
        }
    } else if (vid15s) {
        vid15s.style.display = 'none';
        vid15s.pause();
        vid15s.currentTime = 0;
    }

    const buzzerContainer = document.getElementById('r2-buzzer-container');
    if (buzzerContainer) {
        buzzerContainer.replaceChildren();
        if (mockR2Data.currentPage === 1 && mockR2Data.buzzedPlayers && mockR2Data.buzzedPlayers.length > 0) {
            const renderList = [...mockR2Data.buzzedPlayers].reverse();
            const fragment = document.createDocumentFragment();

            renderList.forEach(pIdx => {
                const itemEl = document.createElement('div');
                itemEl.className = 'r2-buzzer-item';

                const wrapperEl = document.createElement('div');
                wrapperEl.className = 'r2-buzzer-name-wrapper';

                const nameEl = document.createElement('span');
                nameEl.className = 'r2-buzzer-name';
                nameEl.id = `r2-buzzer-name-${pIdx}`;
                nameEl.textContent = mockR2Data.players[pIdx]?.name || '';

                wrapperEl.appendChild(nameEl);
                itemEl.appendChild(wrapperEl);
                fragment.appendChild(itemEl);
            });

            buzzerContainer.appendChild(fragment);
            renderList.forEach(pIdx => compressP2Text(`r2-buzzer-name-${pIdx}`));
        }
    }

    for (let i = 1; i <= 4; i++) {
        const ansTextEl = document.getElementById(`r2-proj-ans-text-${i}`);
        if (ansTextEl) {
            ansTextEl.textContent = mockR2Data.players[i - 1].answer;
        }
    }

    if (mockR2Data.currentPage === 1) {
        page1.style.display = 'block';
        page2.style.display = 'none';
        if (!mockR2Data.showAnswers) {
            clearRevealTimeout();
            lastPlayedShowAnswersSeq = 0;
            if (vid) {
                vid.style.display = 'none';
                vid.pause();
                vid.currentTime = 0;
            }
            hideAllAnswersInstant();
        }
        return;
    }

    page1.style.display = 'none';
    page2.style.display = 'block';
    compressAllP2Texts();

    if (mockR2Data.showAnswers) {
        const shouldTriggerReveal = mockR2Data.showAnswersSeq !== lastPlayedShowAnswersSeq;
        if (shouldTriggerReveal) {
            lastPlayedShowAnswersSeq = mockR2Data.showAnswersSeq;
            clearRevealTimeout();

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
                    const wrongEl = document.getElementById(`r2-proj-wrong-${i}`);
                    const isWrong = Boolean(mockR2Data.wrongAnswers[i - 1]);
                    if (nameEl) {
                        nameEl.style.transition = '';
                        nameEl.classList.add('fade-in');
                    }
                    if (ansEl) {
                        ansEl.style.transition = '';
                        ansEl.classList.add('fade-in');
                    }
                    if (wrongEl) {
                        wrongEl.style.transition = '';
                        wrongEl.classList.toggle('fade-in', isWrong);
                    }
                }
                revealTimeout = null;
            }, 2000);
        } else {
            if (vid) {
                vid.style.display = 'block';
            }
            if (revealTimeout === null) {
                for (let i = 1; i <= 4; i++) {
                    const nameEl = document.getElementById(`r2-proj-name-${i}`);
                    const ansEl = document.getElementById(`r2-proj-ans-${i}`);
                    const wrongEl = document.getElementById(`r2-proj-wrong-${i}`);
                    const isWrong = Boolean(mockR2Data.wrongAnswers[i - 1]);
                    if (nameEl) {
                        nameEl.style.transition = 'none';
                        nameEl.classList.add('fade-in');
                    }
                    if (ansEl) {
                        ansEl.style.transition = 'none';
                        ansEl.classList.add('fade-in');
                    }
                    if (wrongEl) {
                        wrongEl.style.transition = '';
                        wrongEl.classList.toggle('fade-in', isWrong);
                    }
                }
            }
        }
    } else {
        clearRevealTimeout();
        lastPlayedShowAnswersSeq = 0;
        if (vid) {
            vid.style.display = 'none';
            vid.pause();
            vid.currentTime = 0;
        }
        hideAllAnswersInstant();
    }
}

// ==========================================
// 4. LẮNG NGHE DỮ LIỆU & KHỞI TẠO VÒNG 2
// ==========================================
function handleControl(data) {
    if (!data) return;
    mockR2Data.currentPage = data.page === 2 ? 2 : 1;
    mockR2Data.showAnswers = Boolean(data.showAnswers);
    if (data.showAnswersSeq !== undefined) {
        mockR2Data.showAnswersSeq = Number(data.showAnswersSeq) || 0;
    } else if (mockR2Data.showAnswers && lastPlayedShowAnswersSeq === 0) {
        mockR2Data.showAnswersSeq = 1;
    }

    if (data.showWaitBg !== undefined) {
        mockR2Data.showWaitBg = Boolean(data.showWaitBg);
    }
    if (data.currentRowIndex !== undefined) {
        mockR2Data.currentRowIndex = data.currentRowIndex;
    }
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
    if (Array.isArray(data.wrongAnswers)) {
        mockR2Data.wrongAnswers = [0, 1, 2, 3].map(i => Boolean(data.wrongAnswers[i]));
    } else {
        mockR2Data.wrongAnswers = [false, false, false, false];
    }
    renderPageLogic();
}

function bindR2VideoFallback() {
    const ansVideo = document.getElementById('r2-ans-video');
    if (!ansVideo || ansVideo.dataset.fallbackBound === 'true') return;
    ansVideo.dataset.fallbackBound = 'true';

    ansVideo.addEventListener('error', () => {
        if (!ansVideo.src.endsWith('r2_showans.webm')) {
            ansVideo.src = '../graphic/r2_showans.webm';
        }
    });
}

function setupR2FirebaseListeners() {
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

    r2QuestionsUnsub = onValue(ref(db, 'questions/round_2'), (snapshot) => {
        mockR2Data.questions = ["", "", "", "", ""];
        mockR2Data.rows.forEach(r => { r.answer = ""; r.length = 0; });
        mockR2Data.cnv_answer = "";
        mockR2Data.cnv_length = 0;
        mockR2Data.cnv_image = "";

        if (snapshot.exists()) {
            const qData = snapshot.val();
            for (let i = 1; i <= 5; i++) {
                if (qData[i]) {
                    mockR2Data.questions[i - 1] = qData[i].cau_hoi || "";
                    const ans = (qData[i].dap_an || "").replace(/\s+/g, '');
                    mockR2Data.rows[i - 1].answer = ans;
                    mockR2Data.rows[i - 1].length = ans.length;
                }
            }
            if (qData['cnv']) {
                mockR2Data.cnv_answer = qData['cnv'].dap_an || "";
                mockR2Data.cnv_length = mockR2Data.cnv_answer.replace(/\s+/g, '').length;
                mockR2Data.cnv_image = qData['cnv'].image || (qData[1] && qData[1].image) || "";
            } else if (qData[1] && qData[1].image) {
                mockR2Data.cnv_image = qData[1].image;
            }
        }
        renderPageLogic();
    });

    r2AnswersUnsub = onValue(ref(db, 'games/round_2/dap_an_thi_sinh'), (snapshot) => {
        if (snapshot.exists()) {
            const answers = snapshot.val();
            for (let i = 1; i <= 4; i++) {
                if (answers[i] !== undefined) {
                    mockR2Data.players[i - 1].answer = typeof answers[i] === 'object' ? (answers[i].answer || "") : answers[i];
                }
            }
            renderPageLogic();
        }
    });
}

function initProjectorR2() {
    if (!document.getElementById('projector-bg')) return;

    const r2Ui = document.getElementById('r2-projector-ui');
    if (!r2Ui) return;

    r2Ui.style.display = 'block';
    bindR2VideoFallback();
    renderPageLogic();

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            if (mockR2Data.currentPage === 2) compressAllP2Texts();
        });
    }

    setupR2FirebaseListeners();
    window.addEventListener('resize', compressAllP2Texts);
}

initProjectorR2();

window.cleanupCurrentRound = () => {
    clearRevealTimeout();
    lastPlayedShowAnswersSeq = 0;
    window.removeEventListener('resize', compressAllP2Texts);

    if (typeof r2CtrlUnsub === 'function') r2CtrlUnsub();
    if (typeof r2PlayersUnsub === 'function') r2PlayersUnsub();
    if (typeof r2QuestionsUnsub === 'function') r2QuestionsUnsub();
    if (typeof r2AnswersUnsub === 'function') r2AnswersUnsub();
    r2CtrlUnsub = null;
    r2PlayersUnsub = null;
    r2QuestionsUnsub = null;
    r2AnswersUnsub = null;

    r2Channel.onmessage = null;
    r2Channel.close();

    const vid15s = document.getElementById('r2-15s-video');
    if (vid15s) {
        vid15s.style.display = 'none';
        vid15s.pause();
        vid15s.currentTime = 0;
    }

    const ansVid = document.getElementById('r2-ans-video');
    if (ansVid) {
        ansVid.style.display = 'none';
        ansVid.pause();
        ansVid.currentTime = 0;
    }

    const ui = document.getElementById('r2-projector-ui');
    if (ui) ui.style.display = 'none';
};