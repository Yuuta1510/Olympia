import { getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// ==========================================
// 1. KHỞI TẠO FIREBASE, KÊNH ĐỒNG BỘ & STATE
// ==========================================
const app = getApp();
const db = window.firebaseDB || getDatabase(app);
const r3Channel = new BroadcastChannel('olympia_r3_control');

const r3ProjState = {
    questionIndex: 1,
    questionText: "",
    mediaUrl: "",
    mediaType: "none",
    answerMediaUrl: "",
    answerMediaType: "none",
    duration: 20,
    showWaitBg: true,
    showQuestion: false,
    showQuestionSeq: 0,
    showQuestionAnswer: false,
    showQuestionAnswerSeq: 0,
    timerRunning: false,
    timerSeq: 0,
    currentPage: 1,
    showAnswers: false,
    showAnswersSeq: 0,
    rankedPlayers: [
        { name: "P1", answer: "", time: null, wrong: false },
        { name: "P2", answer: "", time: null, wrong: false },
        { name: "P3", answer: "", time: null, wrong: false },
        { name: "P4", answer: "", time: null, wrong: false }
    ]
};

let mediaFadeTimeout = null;
let textFadeTimeout = null;
let p2RevealTimeout = null;

let lastShowQuestionSeq = 0;
let lastShowQuestionAnswer = false;
let lastShowQuestionAnswerSeq = 0;
let lastTimerSeq = 0;
let lastShowAnswersSeq = 0;

let r3CtrlUnsub = null;
let r3PlayersUnsub = null;

// ==========================================
// 2. HÀM TIỆN ÍCH & CO CHỮ TRANG 2
// ==========================================
function clearQuestionTimers() {
    if (mediaFadeTimeout !== null) {
        clearTimeout(mediaFadeTimeout);
        mediaFadeTimeout = null;
    }
    if (textFadeTimeout !== null) {
        clearTimeout(textFadeTimeout);
        textFadeTimeout = null;
    }
}

function clearP2RevealTimeout() {
    if (p2RevealTimeout !== null) {
        clearTimeout(p2RevealTimeout);
        p2RevealTimeout = null;
    }
}

function compressP2Text(spanId) {
    const spanEl = document.getElementById(spanId);
    if (!spanEl || !spanEl.parentElement) return;

    const parentEl = spanEl.parentElement;

    parentEl.style.justifyContent = '';
    spanEl.style.transform = 'none';

    const style = window.getComputedStyle(parentEl);
    const paddingX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const containerWidth = parentEl.getBoundingClientRect().width - paddingX;
    if (containerWidth <= 0) return;

    const justify = style.justifyContent;
    const textWidth = Math.max(spanEl.scrollWidth, spanEl.getBoundingClientRect().width);

    if (textWidth > containerWidth) {
        const scale = containerWidth / textWidth;
        if (justify === 'flex-end' || justify === 'end') {
            spanEl.style.transformOrigin = 'right center';
        } else {
            parentEl.style.justifyContent = 'flex-start';
            spanEl.style.transformOrigin = 'left center';
        }
        spanEl.style.transform = `scaleX(${scale})`;
    } else {
        spanEl.style.transformOrigin = 'center center';
    }
}

function compressAllP2Texts() {
    for (let i = 1; i <= 4; i++) {
        compressP2Text(`r3-proj-name-text-${i}`);
        compressP2Text(`r3-proj-ans-text-${i}`);
        compressP2Text(`r3-proj-time-text-${i}`);
    }
}

function hideAllP2RowsInstant() {
    for (let i = 1; i <= 4; i++) {
        const nameEl = document.getElementById(`r3-proj-name-${i}`);
        const ansEl = document.getElementById(`r3-proj-ans-${i}`);
        const timeEl = document.getElementById(`r3-proj-time-${i}`);
        const wrongEl = document.getElementById(`r3-proj-wrong-${i}`);

        [nameEl, ansEl, timeEl, wrongEl].forEach(el => {
            if (el) {
                el.style.transition = 'none';
                el.classList.remove('fade-in');
            }
        });
    }
}

function hideQuestionElementsInstant() {
    clearQuestionTimers();

    const showQuesVid = document.getElementById('r3-showques-video');
    if (showQuesVid) {
        showQuesVid.style.transition = 'none';
        showQuesVid.style.display = 'none';
        showQuesVid.pause();
        showQuesVid.currentTime = 0;
    }

    const qBox = document.getElementById('r3-question-box');
    if (qBox) {
        qBox.style.transition = 'none';
        qBox.classList.remove('is-visible');
    }

    const qImg = document.getElementById('r3-question-img');
    if (qImg) {
        qImg.style.transition = 'none';
        qImg.classList.remove('is-visible');
        qImg.style.display = 'none';
    }

    const qVid = document.getElementById('r3-question-video');
    if (qVid) {
        qVid.style.transition = 'none';
        qVid.classList.remove('is-visible');
        qVid.style.display = 'none';
        qVid.muted = true;
        qVid.volume = 0;
        qVid.pause();
        qVid.currentTime = 0;
    }
}

function stopTimerVideoInstant() {
    const timerVid = document.getElementById('r3-timer-video');
    if (timerVid) {
        timerVid.style.transition = 'none';
        timerVid.style.display = 'none';
        timerVid.pause();
        timerVid.currentTime = 0;
    }
}

// ==========================================
// 3. CHẠY HIỆU ỨNG TRANG 1 & TRANG 2 PROJECTOR
// ==========================================
function renderPage1MediaSlot({ url, type, autoPlayVideo = false }) {
    const qImg = document.getElementById('r3-question-img');
    const qVid = document.getElementById('r3-question-video');

    if (type === 'image' && url && qImg) {
        if (qVid) {
            qVid.style.transition = 'none';
            qVid.classList.remove('is-visible');
            qVid.style.display = 'none';
            qVid.pause();
            qVid.currentTime = 0;
        }
        if (qImg.getAttribute('src') !== url) {
            qImg.src = url;
        }
        qImg.style.transition = '';
        qImg.style.display = 'block';
        void qImg.offsetWidth;
        qImg.classList.add('is-visible');
    } else if (type === 'video' && url && qVid) {
        if (qImg) {
            qImg.style.transition = 'none';
            qImg.classList.remove('is-visible');
            qImg.style.display = 'none';
        }
        qVid.muted = true;
        qVid.defaultMuted = true;
        qVid.volume = 0;
        if (qVid.getAttribute('src') !== url) {
            qVid.src = url;
        }
        qVid.style.transition = '';
        qVid.style.display = 'block';
        void qVid.offsetWidth;
        qVid.classList.add('is-visible');
        if (autoPlayVideo) {
            qVid.currentTime = 0;
            qVid.play().catch(() => {});
        } else {
            qVid.pause();
        }
    } else {
        if (qImg) {
            qImg.style.transition = 'none';
            qImg.classList.remove('is-visible');
            qImg.style.display = 'none';
        }
        if (qVid) {
            qVid.style.transition = 'none';
            qVid.classList.remove('is-visible');
            qVid.style.display = 'none';
            qVid.pause();
            qVid.currentTime = 0;
        }
    }
}

function triggerQuestionSequence() {
    clearQuestionTimers();

    const showQuesVid = document.getElementById('r3-showques-video');
    const qBox = document.getElementById('r3-question-box');
    const qText = document.getElementById('r3-question-text');
    const qImg = document.getElementById('r3-question-img');
    const qVid = document.getElementById('r3-question-video');

    if (qText) qText.textContent = r3ProjState.questionText || "";
    if (qBox) {
        qBox.style.transition = 'none';
        qBox.classList.remove('is-visible');
    }

    // Reset media trước khi chạy hiệu ứng
    if (qImg) {
        qImg.style.transition = 'none';
        qImg.classList.remove('is-visible');
        qImg.style.display = 'none';
    }
    if (qVid) {
        qVid.style.transition = 'none';
        qVid.classList.remove('is-visible');
        qVid.style.display = 'none';
        qVid.muted = true;
        qVid.volume = 0;
        qVid.pause();
        qVid.currentTime = 0;
    }

    // 1. Chạy video đồ họa câu hỏi r3_showques.webm
    if (showQuesVid) {
        showQuesVid.style.transition = '';
        showQuesVid.style.display = 'block';
        showQuesVid.currentTime = 0;
        showQuesVid.play().catch(() => {});
    }

    // 2. Sau khi hiện câu hỏi khoảng 1s:
    //    - Nếu đang bật Đáp án câu hỏi -> hiện media đáp án
    //    - Nếu là ẢNH câu hỏi -> hiện & fade in 0.5s
    //    - Nếu là VIDEO câu hỏi -> KHÔNG hiện ngay, chờ bấm chạy thời gian
    mediaFadeTimeout = setTimeout(() => {
        if (!r3ProjState.showQuestion) return;

        if (r3ProjState.showQuestionAnswer) {
            renderPage1MediaSlot({
                url: r3ProjState.answerMediaUrl,
                type: r3ProjState.answerMediaType,
                autoPlayVideo: true
            });
            return;
        }

        if (r3ProjState.mediaType === 'image' && r3ProjState.mediaUrl && qImg) {
            qImg.src = r3ProjState.mediaUrl;
            qImg.style.transition = '';
            qImg.style.display = 'block';
            void qImg.offsetWidth;
            qImg.classList.add('is-visible');
        }
    }, 1000);

    // 3. Sau đó 0.5s (tức 1.5s từ lúc hiện câu hỏi) -> hiện & fade in 0.5s nội dung text câu hỏi
    textFadeTimeout = setTimeout(() => {
        if (!r3ProjState.showQuestion) return;
        if (qBox) {
            qBox.style.transition = '';
            void qBox.offsetWidth;
            qBox.classList.add('is-visible');
        }
    }, 1500);
}

function applyPage1QuestionAnswerToggle() {
    if (mediaFadeTimeout !== null) {
        clearTimeout(mediaFadeTimeout);
        mediaFadeTimeout = null;
    }

    if (r3ProjState.showQuestionAnswer) {
        renderPage1MediaSlot({
            url: r3ProjState.answerMediaUrl,
            type: r3ProjState.answerMediaType,
            autoPlayVideo: true
        });
    } else {
        renderPage1MediaSlot({
            url: r3ProjState.mediaUrl,
            type: r3ProjState.mediaType,
            autoPlayVideo: false
        });
    }
}

function triggerTimerAndQuestionVideo() {
    const duration = Math.max(1, Number(r3ProjState.duration) || 20);
    const qImg = document.getElementById('r3-question-img');
    const qVid = document.getElementById('r3-question-video');
    const timerVid = document.getElementById('r3-timer-video');

    // Đảm bảo ẩn ảnh nếu câu hỏi này là video
    if (r3ProjState.mediaType === 'video' && qImg) {
        qImg.classList.remove('is-visible');
        qImg.style.display = 'none';
    }

    // Nếu câu hỏi dùng VIDEO thì lúc bấm thời gian mới hiện và phát video
    if (r3ProjState.mediaType === 'video' && r3ProjState.mediaUrl && qVid) {
        qVid.muted = true;
        qVid.defaultMuted = true;
        qVid.volume = 0;
        if (qVid.getAttribute('src') !== r3ProjState.mediaUrl) {
            qVid.src = r3ProjState.mediaUrl;
        }
        qVid.style.transition = '';
        qVid.style.display = 'block';
        qVid.currentTime = 0;
        void qVid.offsetWidth;
        qVid.classList.add('is-visible');
        qVid.play().catch(() => {});
    }

    // Đồng hồ: <= 20s dùng 20s.webm chỉnh speed; > 20s dùng 30s.webm chỉnh speed
    if (timerVid) {
        const isShort = duration <= 20;
        const targetSrc = isShort ? '../graphic/o27/r3_20s.webm' : '../graphic/o27/r3_30s.webm';
        const targetRate = isShort ? (20 / duration) : (30 / duration);

        const applyRateAndPlay = () => {
            timerVid.playbackRate = targetRate;
            timerVid.currentTime = 0;
            timerVid.play().catch(() => {});
        };

        timerVid.style.display = 'block';
        if (timerVid.getAttribute('src') !== targetSrc) {
            timerVid.src = targetSrc;
            timerVid.addEventListener('loadedmetadata', applyRateAndPlay, { once: true });
            timerVid.load();
        } else {
            applyRateAndPlay();
        }
    }
}

function renderProjectorR3() {
    const waitBg = document.getElementById('r3-wait-bg');
    const page1 = document.getElementById('r3-page-1');
    const page2 = document.getElementById('r3-page-2');
    const ansVid = document.getElementById('r3-ans-video');
    if (!page1 || !page2) return;

    // Nền chờ r3_wait.png
    if (waitBg) {
        waitBg.style.opacity = r3ProjState.showWaitBg ? '1' : '0';
    }

    // Cập nhật text danh sách thí sinh cho Trang 2 (không kèm "s")
    for (let i = 1; i <= 4; i++) {
        const p = r3ProjState.rankedPlayers[i - 1] || { name: `P${i}`, answer: "", time: null, wrong: false };
        const nameSpan = document.getElementById(`r3-proj-name-text-${i}`);
        const ansSpan = document.getElementById(`r3-proj-ans-text-${i}`);
        const timeSpan = document.getElementById(`r3-proj-time-text-${i}`);

        if (nameSpan) nameSpan.textContent = p.name || "";
        if (ansSpan) ansSpan.textContent = p.answer || "";
        if (timeSpan) {
            timeSpan.textContent = (typeof p.time === 'number' && Number.isFinite(p.time))
                ? p.time.toFixed(2)
                : "";
        }
    }

    // Xử lý Trang 1 vs Trang 2
    if (r3ProjState.currentPage === 1) {
        page1.style.display = 'block';
        page2.style.display = 'none';

        if (!r3ProjState.showAnswers) {
            clearP2RevealTimeout();
            lastShowAnswersSeq = 0;
            if (ansVid) {
                ansVid.style.display = 'none';
                ansVid.pause();
                ansVid.currentTime = 0;
            }
            hideAllP2RowsInstant();
        }

        // Hiện / Ẩn câu hỏi
        if (r3ProjState.showQuestion) {
            if (r3ProjState.showQuestionSeq !== lastShowQuestionSeq) {
                lastShowQuestionSeq = r3ProjState.showQuestionSeq;
                lastShowQuestionAnswer = r3ProjState.showQuestionAnswer;
                lastShowQuestionAnswerSeq = r3ProjState.showQuestionAnswerSeq;
                stopTimerVideoInstant();
                triggerQuestionSequence();
            } else {
                const qText = document.getElementById('r3-question-text');
                if (qText) qText.textContent = r3ProjState.questionText || "";

                // Thay thế media câu hỏi bằng media đáp án (hoặc trả lại media câu hỏi) ngay tại Trang 1
                if (
                    r3ProjState.showQuestionAnswer !== lastShowQuestionAnswer ||
                    r3ProjState.showQuestionAnswerSeq !== lastShowQuestionAnswerSeq
                ) {
                    lastShowQuestionAnswer = r3ProjState.showQuestionAnswer;
                    lastShowQuestionAnswerSeq = r3ProjState.showQuestionAnswerSeq;
                    applyPage1QuestionAnswerToggle();
                }
            }
        } else {
            lastShowQuestionSeq = 0;
            lastShowQuestionAnswer = false;
            lastShowQuestionAnswerSeq = 0;
            hideQuestionElementsInstant();
            stopTimerVideoInstant();
        }

        // Chạy / Dừng đồng hồ (và video câu hỏi nếu có)
        if (r3ProjState.timerRunning) {
            if (r3ProjState.timerSeq !== lastTimerSeq) {
                lastTimerSeq = r3ProjState.timerSeq;
                triggerTimerAndQuestionVideo();
            }
        } else {
            if (!r3ProjState.showQuestionAnswer) {
                const qVid = document.getElementById('r3-question-video');
                if (qVid && !qVid.paused) qVid.pause();
            }

            const timerVid = document.getElementById('r3-timer-video');
            if (timerVid && !timerVid.paused) timerVid.pause();
        }
        return;
    }

    // TRANG 2: HIỆN TÊN, ĐÁP ÁN & THỜI GIAN TRẢ LỜI
    page1.style.display = 'none';
    page2.style.display = 'block';
    compressAllP2Texts();
    requestAnimationFrame(compressAllP2Texts);

    if (r3ProjState.showAnswers) {
        if (r3ProjState.showAnswersSeq !== lastShowAnswersSeq) {
            lastShowAnswersSeq = r3ProjState.showAnswersSeq;
            clearP2RevealTimeout();

            if (ansVid) {
                ansVid.style.display = 'block';
                ansVid.currentTime = 0;
                ansVid.play().catch(() => {});
            }

            hideAllP2RowsInstant();
            p2RevealTimeout = setTimeout(() => {
                compressAllP2Texts();
                for (let i = 1; i <= 4; i++) {
                    const p = r3ProjState.rankedPlayers[i - 1] || {};
                    const nameEl = document.getElementById(`r3-proj-name-${i}`);
                    const ansEl = document.getElementById(`r3-proj-ans-${i}`);
                    const timeEl = document.getElementById(`r3-proj-time-${i}`);
                    const wrongEl = document.getElementById(`r3-proj-wrong-${i}`);

                    [nameEl, ansEl, timeEl].forEach(el => {
                        if (el) {
                            el.style.transition = '';
                            el.classList.add('fade-in');
                        }
                    });
                    if (wrongEl) {
                        wrongEl.style.transition = '';
                        wrongEl.classList.toggle('fade-in', Boolean(p.wrong));
                    }
                }
                p2RevealTimeout = null;
            }, 2000);
        } else if (p2RevealTimeout === null) {
            if (ansVid) ansVid.style.display = 'block';
            for (let i = 1; i <= 4; i++) {
                const p = r3ProjState.rankedPlayers[i - 1] || {};
                const nameEl = document.getElementById(`r3-proj-name-${i}`);
                const ansEl = document.getElementById(`r3-proj-ans-${i}`);
                const timeEl = document.getElementById(`r3-proj-time-${i}`);
                const wrongEl = document.getElementById(`r3-proj-wrong-${i}`);

                [nameEl, ansEl, timeEl].forEach(el => {
                    if (el) {
                        el.style.transition = 'none';
                        el.classList.add('fade-in');
                    }
                });
                if (wrongEl) {
                    wrongEl.style.transition = '';
                    wrongEl.classList.toggle('fade-in', Boolean(p.wrong));
                }
            }
        }
    } else {
        clearP2RevealTimeout();
        lastShowAnswersSeq = 0;
        if (ansVid) {
            ansVid.style.display = 'none';
            ansVid.pause();
            ansVid.currentTime = 0;
        }
        hideAllP2RowsInstant();
    }
}

// ==========================================
// 4. LẮNG NGHE DỮ LIỆU & KHỞI TẠO PROJECTOR R3
// ==========================================
function handleR3Control(data) {
    if (!data) return;

    if (data.questionIndex !== undefined) r3ProjState.questionIndex = Number(data.questionIndex) || 1;
    if (data.questionText !== undefined) r3ProjState.questionText = String(data.questionText || "");
    if (data.mediaUrl !== undefined) r3ProjState.mediaUrl = String(data.mediaUrl || "");
    if (data.mediaType !== undefined) r3ProjState.mediaType = String(data.mediaType || "none");
    if (data.answerMediaUrl !== undefined) r3ProjState.answerMediaUrl = String(data.answerMediaUrl || "");
    if (data.answerMediaType !== undefined) r3ProjState.answerMediaType = String(data.answerMediaType || "none");
    if (data.duration !== undefined) r3ProjState.duration = Number(data.duration) || 20;
    if (data.showWaitBg !== undefined) r3ProjState.showWaitBg = Boolean(data.showWaitBg);
    if (data.showQuestion !== undefined) r3ProjState.showQuestion = Boolean(data.showQuestion);
    if (data.showQuestionSeq !== undefined) r3ProjState.showQuestionSeq = Number(data.showQuestionSeq) || 0;
    if (data.showQuestionAnswer !== undefined) {
        r3ProjState.showQuestionAnswer = r3ProjState.showQuestion ? Boolean(data.showQuestionAnswer) : false;
    }
    if (data.showQuestionAnswerSeq !== undefined) {
        r3ProjState.showQuestionAnswerSeq = r3ProjState.showQuestion ? (Number(data.showQuestionAnswerSeq) || 0) : 0;
    }
    if (data.timerRunning !== undefined) r3ProjState.timerRunning = Boolean(data.timerRunning);
    if (data.timerSeq !== undefined) r3ProjState.timerSeq = Number(data.timerSeq) || 0;
    if (data.page !== undefined) r3ProjState.currentPage = data.page === 2 ? 2 : 1;
    if (data.showAnswers !== undefined) r3ProjState.showAnswers = Boolean(data.showAnswers);
    if (data.showAnswersSeq !== undefined) r3ProjState.showAnswersSeq = Number(data.showAnswersSeq) || 0;

    if (Array.isArray(data.rankedPlayers)) {
        r3ProjState.rankedPlayers = [0, 1, 2, 3].map(i => ({
            name: data.rankedPlayers[i]?.name || `P${i + 1}`,
            answer: data.rankedPlayers[i]?.answer || "",
            time: data.rankedPlayers[i]?.time ?? null,
            wrong: Boolean(data.rankedPlayers[i]?.wrong)
        }));
    }

    renderProjectorR3();
}

function bindR3VideoFallbacks() {
    const ansVideo = document.getElementById('r3-ans-video');
    if (ansVideo && ansVideo.dataset.fallbackBound !== 'true') {
        ansVideo.dataset.fallbackBound = 'true';
        ansVideo.addEventListener('error', () => {
            if (!ansVideo.src.endsWith('r3_showans.webm')) {
                ansVideo.src = '../graphic/o27/r3_showans.webm';
            }
        });
    }
}

function setupR3Listeners() {
    r3CtrlUnsub = onValue(ref(db, 'games/r3_control'), (snapshot) => {
        if (snapshot.exists()) handleR3Control(snapshot.val());
    });
    r3Channel.onmessage = (event) => handleR3Control(event.data);

    r3PlayersUnsub = onValue(ref(db, 'games/players'), () => {
        if (r3ProjState.currentPage === 2) compressAllP2Texts();
    });
}

function initProjectorR3() {
    if (!document.getElementById('projector-bg')) return;
    const r3Ui = document.getElementById('r3-projector-ui');
    if (!r3Ui) return;

    r3Ui.style.display = 'block';
    bindR3VideoFallbacks();
    renderProjectorR3();

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            if (r3ProjState.currentPage === 2) compressAllP2Texts();
        });
    }

    setupR3Listeners();
    window.addEventListener('resize', compressAllP2Texts);
}

initProjectorR3();

window.cleanupCurrentRound = () => {
    clearQuestionTimers();
    clearP2RevealTimeout();
    lastShowQuestionSeq = 0;
    lastShowQuestionAnswer = false;
    lastShowQuestionAnswerSeq = 0;
    lastTimerSeq = 0;
    lastShowAnswersSeq = 0;
    window.removeEventListener('resize', compressAllP2Texts);

    if (typeof r3CtrlUnsub === 'function') r3CtrlUnsub();
    if (typeof r3PlayersUnsub === 'function') r3PlayersUnsub();
    r3CtrlUnsub = null;
    r3PlayersUnsub = null;

    r3Channel.onmessage = null;
    r3Channel.close();

    hideQuestionElementsInstant();
    stopTimerVideoInstant();

    const ansVid = document.getElementById('r3-ans-video');
    if (ansVid) {
        ansVid.style.display = 'none';
        ansVid.pause();
        ansVid.currentTime = 0;
    }

    const r3Ui = document.getElementById('r3-projector-ui');
    if (r3Ui) r3Ui.style.display = 'none';
};