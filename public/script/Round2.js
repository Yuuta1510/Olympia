import { getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

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
        { name: "P1", answer: "" }, { name: "P2", answer: "" },
        { name: "P3", answer: "" }, { name: "P4", answer: "" }
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

function initProjectorR2() {
    if (!document.getElementById('projector-bg')) return;

    const oldUi = document.getElementById('r2-projector-ui');
    if (oldUi) oldUi.remove();

    const rootHTML = `
    <div id="r2-projector-ui">
        <div id="r2-wait-bg" style="position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; background-image: url('../graphic/R2_Wait.png'); background-size: cover; background-position: center; z-index: 9999; display: block; opacity: 1; pointer-events: auto;"></div>
        
        <div id="r2-page-1">
            <div class="r2-bg-layer"></div>
            <video class="r2-video-layer" id="r2-15s-video" src="../graphic/R2_15s.webm" playsinline preload="auto" style="display: none; z-index: 1;"></video>
            
            <div class="r2-image-area">
                <img class="r2-main-img" src="${mockR2Data.cnv_image || '../graphic/r2_target.png'}" />
                ${mockR2Data.image_pieces.map((hidden, i) => `<img class="r2-piece ${hidden ? 'hidden' : ''}" id="r2-p${i+1}" src="../graphic/${i+1}.png" />`).join('')}
            </div>
            
            <div class="r2-rows-area">
                <div class="r2-cnv-title">${formatCnvTitle(mockR2Data.cnv_answer)}</div>
                ${mockR2Data.rows.map((row, i) => `
                    <div class="r2-row-container">
                        <div class="r2-row"></div>
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
                <img class="r2-p2-wrong r2-p2-pos-${i+1}" id="r2-proj-wrong-${i+1}" src="../graphic/R2_Wrong.png" alt="" />
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
                    mockR2Data.questions[i-1] = qData[i].cau_hoi || "";
                    const ans = (qData[i].dap_an || "").replace(/\s+/g, '');
                    mockR2Data.rows[i-1].answer = ans;
                    mockR2Data.rows[i-1].length = ans.length;
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
                    mockR2Data.players[i-1].answer = typeof answers[i] === 'object' ? (answers[i].answer || "") : answers[i];
                }
            }
            renderPageLogic();
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
        const piece = document.getElementById(`r2-p${i+1}`);
        if (piece) piece.classList.toggle('hidden', hidden);
    });

    const cnvTitle = document.querySelector('#r2-page-1 .r2-cnv-title');
    if (cnvTitle) cnvTitle.innerText = formatCnvTitle(mockR2Data.cnv_answer);

    const rowEls = document.querySelectorAll('#r2-page-1 .r2-row-container');
    mockR2Data.rows.forEach((row, i) => {
        if (rowEls[i]) {
            const rowDiv = rowEls[i].querySelector('.r2-row');
            if (rowDiv) {
                if (rowDiv.children.length !== row.length) {
                    rowDiv.innerHTML = Array.from({length: row.length}).map((_, charIdx) => 
                        `<div class="r2-char ${row.state}">${row.answer[charIdx] || ''}</div>`
                    ).join('');
                } else {
                    const charEls = rowDiv.querySelectorAll('.r2-char');
                    charEls.forEach((charEl, charIdx) => {
                        charEl.className = `r2-char ${row.state}`;
                        charEl.innerText = row.answer[charIdx] || '';
                    });
                }
            }
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

    for (let i = 1; i <= 4; i++) {
        const ansTextEl = document.getElementById(`r2-proj-ans-text-${i}`);
        if (ansTextEl) {
            ansTextEl.textContent = mockR2Data.players[i-1].answer;
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

initProjectorR2();

window.cleanupCurrentRound = () => {
    clearRevealTimeout();
    lastPlayedShowAnswersSeq = 0;
    window.removeEventListener('resize', compressAllP2Texts);
    if (typeof r2CtrlUnsub === 'function') r2CtrlUnsub();
    if (typeof r2PlayersUnsub === 'function') r2PlayersUnsub();
    if (typeof r2QuestionsUnsub === 'function') r2QuestionsUnsub();
    if (typeof r2AnswersUnsub === 'function') r2AnswersUnsub();
    r2Channel.onmessage = null;
    const ui = document.getElementById('r2-projector-ui');
    if (ui) ui.remove();
};