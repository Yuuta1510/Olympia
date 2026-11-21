import { getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, set, update, onValue, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// ==========================================
// 1. KHỞI TẠO FIREBASE & TRẠNG THÁI VÒNG 3
// ==========================================
const app = getApp();
const db = getDatabase(app);
const r3Channel = new BroadcastChannel('olympia_r3_control');

const SCORE_TIERS = [40, 30, 20, 10];
const VIDEO_EXT_REGEX = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv)(\?|#|$)/i;

const r3State = {
    currentQuestionIndex: 1, // 1..4
    durations: [20, 20, 30, 30], // 20s cho 2 câu đầu, 30s cho 2 câu sau
    questions: [
        { text: "", answer: "", mediaUrl: "", mediaType: "none", answerMediaUrl: "", answerMediaType: "none", duration: 20 },
        { text: "", answer: "", mediaUrl: "", mediaType: "none", answerMediaUrl: "", answerMediaType: "none", duration: 20 },
        { text: "", answer: "", mediaUrl: "", mediaType: "none", answerMediaUrl: "", answerMediaType: "none", duration: 30 },
        { text: "", answer: "", mediaUrl: "", mediaType: "none", answerMediaUrl: "", answerMediaType: "none", duration: 30 }
    ],
    players: [
        { name: "P1", score: 0, answer: "", time: null, status: "none" },
        { name: "P2", score: 0, answer: "", time: null, status: "none" },
        { name: "P3", score: 0, answer: "", time: null, status: "none" },
        { name: "P4", score: 0, answer: "", time: null, status: "none" }
    ],
    showWaitBg: true,
    showQuestion: false,
    showQuestionSeq: 0,
    showQuestionAnswer: false,
    showQuestionAnswerSeq: 0,
    timerRunning: false,
    timerSeq: 0,
    timerStartTimestamp: 0,
    remainingTime: 20,
    currentPage: 1,
    showAnswers: false,
    showAnswersSeq: 0
};

let r3TimerInterval = null;
let activeR3ClockSoundId = null;
let r3PlayersUnsub = null;
let r3QuestionsUnsub = null;
let r3AnswersUnsub = null;

function getR3ClockAudioConfig(duration) {
    const dur = Math.max(1, Number(duration) || 20);
    const exactFiles = {
        10: 'R3_10s.mp3',
        20: 'R3_20s.mp3',
        30: 'R3_30s.mp3',
        40: 'R3_40s.mp3'
    };

    if (exactFiles[dur]) {
        return { file: exactFiles[dur], playbackRate: 1 };
    }
    return { file: 'R3_30s.mp3', playbackRate: 30 / dur };
}
// ==========================================
// 2. HÀM TIỆN ÍCH & ĐỒNG BỘ SANG PROJECTOR
// ==========================================
function detectMediaInfo(rawItem, fallbackDuration) {
    if (!rawItem || typeof rawItem !== 'object') {
        return {
            mediaUrl: "",
            mediaType: "none",
            answerMediaUrl: "",
            answerMediaType: "none",
            duration: fallbackDuration
        };
    }

    const explicitVideo = rawItem.video || rawItem.vid || "";
    const explicitImage = rawItem.image || rawItem.img || rawItem.hinh_anh || "";
    const genericMedia = rawItem.media || rawItem.url || rawItem.file || "";

    const rawUrl = String(explicitVideo || genericMedia || explicitImage || "").trim();
    let mediaType = "none";

    if (rawUrl) {
        const declaredType = String(rawItem.media_type || rawItem.mediaType || rawItem.type || "").toLowerCase();
        if (explicitVideo || declaredType === 'video' || VIDEO_EXT_REGEX.test(rawUrl)) {
            mediaType = "video";
        } else {
            mediaType = "image";
        }
    }

    const explicitAnsVideo = rawItem.answer_video || rawItem.ans_video || "";
    const explicitAnsImage = rawItem.answer_image || rawItem.ans_image || rawItem.anh_dap_an || "";
    const genericAnsMedia = rawItem.answer_media || rawItem.ans_media || rawItem.media_dap_an || rawItem.answerMedia || "";

    const rawAnsUrl = String(explicitAnsVideo || genericAnsMedia || explicitAnsImage || "").trim();
    let answerMediaType = "none";

    if (rawAnsUrl) {
        const declaredAnsType = String(rawItem.answer_media_type || rawItem.ans_media_type || rawItem.answerMediaType || "").toLowerCase();
        if (explicitAnsVideo || declaredAnsType === 'video' || VIDEO_EXT_REGEX.test(rawAnsUrl)) {
            answerMediaType = "video";
        } else {
            answerMediaType = "image";
        }
    }

    const parsedDur = Number(rawItem.thoi_gian ?? rawItem.time ?? rawItem.duration);
    const duration = Number.isFinite(parsedDur) && parsedDur > 0 ? parsedDur : fallbackDuration;

    return {
        mediaUrl: rawUrl,
        mediaType,
        answerMediaUrl: rawAnsUrl,
        answerMediaType,
        duration
    };
}

function getCurrentQuestion() {
    return r3State.questions[r3State.currentQuestionIndex - 1] || {
        text: "",
        answer: "",
        mediaUrl: "",
        mediaType: "none",
        answerMediaUrl: "",
        answerMediaType: "none",
        duration: r3State.durations[r3State.currentQuestionIndex - 1] || 20
    };
}

function calculateAwardPoints() {
    // Lọc các thí sinh được chấm ĐÚNG, sắp xếp theo thời gian trả lời tăng dần (nhanh nhất đứng đầu)
    const rightPlayers = r3State.players
        .map((p, idx) => ({
            idx,
            time: typeof p.time === 'number' && Number.isFinite(p.time) ? p.time : Number.POSITIVE_INFINITY,
            status: p.status
        }))
        .filter(item => item.status === 'right')
        .sort((a, b) => a.time - b.time);

    const awards = [0, 0, 0, 0];
    let currentTierIdx = 0;

    rightPlayers.forEach((item, rankIdx) => {
        // Nếu đồng thời gian với người liền trước thì giữ nguyên mức điểm cao hơn
        if (rankIdx > 0 && item.time !== rightPlayers[rankIdx - 1].time) {
            currentTierIdx = rankIdx;
        }
        if (currentTierIdx < SCORE_TIERS.length) {
            awards[item.idx] = SCORE_TIERS[currentTierIdx];
        }
    });

    return awards;
}

function buildRankedPlayersForProjector() {
    // Trang 2 hiển thị tên, đáp án, thời gian trả lời (ưu tiên người có thời gian nhanh nhất lên trên)
    return r3State.players
        .map((p, idx) => ({
            playerIndex: idx + 1,
            name: p.name || `P${idx + 1}`,
            answer: p.answer || "",
            time: typeof p.time === 'number' && Number.isFinite(p.time) ? p.time : null,
            wrong: p.status === 'wrong'
        }))
        .sort((a, b) => {
            const hasA = a.time !== null && a.answer.trim() !== "";
            const hasB = b.time !== null && b.answer.trim() !== "";
            if (hasA && hasB) return a.time - b.time;
            if (hasA) return -1;
            if (hasB) return 1;
            return a.playerIndex - b.playerIndex;
        });
}

function sendR3Control() {
    const q = getCurrentQuestion();
    const payload = {
        questionIndex: r3State.currentQuestionIndex,
        questionText: q.text,
        mediaUrl: q.mediaUrl,
        mediaType: q.mediaType,
        answerMediaUrl: q.answerMediaUrl,
        answerMediaType: q.answerMediaType,
        duration: q.duration,
        showWaitBg: r3State.showWaitBg,
        showQuestion: r3State.showQuestion,
        showQuestionSeq: r3State.showQuestionSeq,
        showQuestionAnswer: r3State.showQuestionAnswer,
        showQuestionAnswerSeq: r3State.showQuestionAnswerSeq,
        timerRunning: r3State.timerRunning,
        timerSeq: r3State.timerSeq,
        page: r3State.currentPage,
        showAnswers: r3State.showAnswers,
        showAnswersSeq: r3State.showAnswersSeq,
        rankedPlayers: buildRankedPlayersForProjector(),
        timestamp: Date.now()
    };

    set(ref(db, 'games/r3_control'), payload);
    r3Channel.postMessage(payload);
}

// ==========================================
// 3. CẬP NHẬT GIAO DIỆN CONTROLLER (DOM RENDER)
// ==========================================
function updateR3MediaPreview() {
    const q = getCurrentQuestion();
    const typeBadge = document.getElementById('r3-ctrl-media-type');
    const imgEl = document.getElementById('r3-ctrl-preview-img');
    const vidEl = document.getElementById('r3-ctrl-preview-vid');
    const emptyEl = document.getElementById('r3-ctrl-media-empty');

    if (!typeBadge || !imgEl || !vidEl || !emptyEl) return;

    const isAnsMode = r3State.showQuestionAnswer;
    const targetUrl = isAnsMode ? q.answerMediaUrl : q.mediaUrl;
    const targetType = isAnsMode ? q.answerMediaType : q.mediaType;

    if (targetType === 'image' && targetUrl) {
        typeBadge.textContent = isAnsMode ? 'ĐÁP ÁN: ẢNH (ĐANG HIỆN)' : 'ẢNH (HIỆN SAU 1S)';
        imgEl.src = targetUrl;
        imgEl.style.display = 'block';
        vidEl.pause();
        vidEl.style.display = 'none';
        emptyEl.style.display = 'none';
    } else if (targetType === 'video' && targetUrl) {
        typeBadge.textContent = isAnsMode ? 'ĐÁP ÁN: VIDEO (ĐANG HIỆN)' : 'VIDEO (HIỆN KHI BẤM GIỜ)';
        vidEl.muted = true;
        vidEl.volume = 0;
        if (vidEl.getAttribute('src') !== targetUrl) {
            vidEl.src = targetUrl;
        }
        vidEl.style.display = 'block';
        imgEl.style.display = 'none';
        emptyEl.style.display = 'none';
        if (isAnsMode) {
            vidEl.currentTime = 0;
            vidEl.play().catch(() => {});
        }
    } else {
        typeBadge.textContent = isAnsMode ? 'ĐÁP ÁN: KHÔNG CÓ MEDIA' : 'KHÔNG CÓ MEDIA';
        emptyEl.textContent = isAnsMode ? 'Câu hỏi này chưa chuẩn bị media đáp án' : 'Không có hình ảnh / video';
        imgEl.style.display = 'none';
        vidEl.pause();
        vidEl.style.display = 'none';
        emptyEl.style.display = 'block';
    }
}

function updateR3TimerDisplay() {
    const timerBadge = document.getElementById('r3-ctrl-timer-display');
    const timerBtn = document.getElementById('r3-btn-timer');
    if (timerBadge) {
        timerBadge.textContent = `THỜI GIAN: ${Math.max(0, r3State.remainingTime).toFixed(1)}s`;
        timerBadge.classList.toggle('running', r3State.timerRunning);
    }
    if (timerBtn) {
        timerBtn.textContent = r3State.timerRunning ? 'DỪNG GIỜ' : 'BẤM GIỜ';
        timerBtn.classList.toggle('active', r3State.timerRunning);
    }
}

function updateR3UI() {
    const q = getCurrentQuestion();

    // Tabs câu hỏi 1..4
    document.querySelectorAll('#r3-controller-ui .r3-ctrl-q-tab').forEach(tab => {
        const idx = Number(tab.dataset.qIndex);
        const dur = r3State.questions[idx - 1]?.duration || r3State.durations[idx - 1] || (idx <= 2 ? 20 : 30);
        tab.textContent = `CÂU ${idx} (${dur}s)`;
        tab.classList.toggle('active', idx === r3State.currentQuestionIndex);
    });

    // Nội dung câu hỏi & đáp án
    const qTextEl = document.getElementById('r3-ctrl-q-text');
    if (qTextEl) qTextEl.textContent = q.text || `(Chưa có nội dung câu hỏi ${r3State.currentQuestionIndex})`;

    const ansBadgeEl = document.getElementById('r3-ctrl-correct-ans');
    if (ansBadgeEl) ansBadgeEl.textContent = q.answer || '---';

    // Các nút điều khiển
    const waitBgBtn = document.getElementById('r3-btn-wait-bg');
    if (waitBgBtn) {
        waitBgBtn.textContent = r3State.showWaitBg ? 'ẨN NỀN CHỜ' : 'HIỆN NỀN CHỜ';
        waitBgBtn.classList.toggle('active', r3State.showWaitBg);
    }

    const showQuesBtn = document.getElementById('r3-btn-show-ques');
    if (showQuesBtn) {
        showQuesBtn.textContent = r3State.showQuestion ? 'ẨN CÂU HỎI' : 'HIỆN CÂU HỎI';
        showQuesBtn.classList.toggle('active', r3State.showQuestion);
    }

    const showQuesAnsBtn = document.getElementById('r3-btn-show-ques-ans');
    if (showQuesAnsBtn) {
        showQuesAnsBtn.disabled = !r3State.showQuestion;
        showQuesAnsBtn.style.opacity = r3State.showQuestion ? '1' : '0.45';
        showQuesAnsBtn.style.cursor = r3State.showQuestion ? 'pointer' : 'not-allowed';
        showQuesAnsBtn.textContent = r3State.showQuestionAnswer ? 'ẨN Đ/A CÂU HỎI' : 'HIỆN Đ/A CÂU HỎI';
        showQuesAnsBtn.classList.toggle('active', r3State.showQuestionAnswer);
        const hasAnsMedia = Boolean(q.answerMediaUrl && q.answerMediaType !== 'none');
        showQuesAnsBtn.title = !r3State.showQuestion
            ? 'Chỉ được hiện đáp án sau khi đã hiện câu hỏi'
            : (hasAnsMedia
                ? `Thay media câu hỏi bằng ${q.answerMediaType === 'video' ? 'video' : 'ảnh'} đáp án`
                : 'Câu hỏi này chưa có media đáp án');
    }

    const pageBtn = document.getElementById('r3-btn-page');
    if (pageBtn) {
        pageBtn.textContent = r3State.currentPage === 1 ? 'CHUYỂN TRANG 2' : 'CHUYỂN TRANG 1';
        pageBtn.classList.toggle('active', r3State.currentPage === 2);
    }

    const showAnsBtn = document.getElementById('r3-btn-show-ans');
    if (showAnsBtn) {
        showAnsBtn.classList.toggle('active', r3State.showAnswers);
    }

    updateR3TimerDisplay();

    // Danh sách đáp án & thời gian 4 thí sinh
    const awards = calculateAwardPoints();
    r3State.players.forEach((p, idx) => {
        const cardEl = document.getElementById(`r3-ctrl-ans-card-${idx}`);
        if (cardEl) {
            cardEl.classList.toggle('is-right', p.status === 'right');
            cardEl.classList.toggle('is-wrong', p.status === 'wrong');
        }

        const nameEl = document.getElementById(`r3-ctrl-player-name-${idx}`);
        if (nameEl) nameEl.textContent = `${idx + 1}. ${p.name}`;

        const scoreEl = document.getElementById(`r3-ctrl-player-score-${idx}`);
        if (scoreEl) scoreEl.textContent = `${p.score}đ`;

        const earnEl = document.getElementById(`r3-ctrl-earn-${idx}`);
        if (earnEl) {
            const pts = awards[idx];
            earnEl.textContent = `+${pts}`;
            earnEl.classList.toggle('has-points', pts > 0);
        }

        const timeInput = document.getElementById(`r3-ctrl-time-input-${idx}`);
        if (timeInput && document.activeElement !== timeInput) {
            timeInput.value = (typeof p.time === 'number' && Number.isFinite(p.time)) ? p.time.toFixed(2) : '';
        }

        const ansInput = document.getElementById(`r3-ctrl-ans-input-${idx}`);
        if (ansInput && document.activeElement !== ansInput) {
            ansInput.value = p.answer || '';
        }

        const rightBtn = document.getElementById(`r3-ctrl-right-${idx}`);
        const wrongBtn = document.getElementById(`r3-ctrl-wrong-${idx}`);
        if (rightBtn) rightBtn.classList.toggle('active', p.status === 'right');
        if (wrongBtn) wrongBtn.classList.toggle('active', p.status === 'wrong');
    });
}

// ==========================================
// 4. LOGIC ĐIỀU KHIỂN VÒNG 3
// ==========================================
function stopR3ClockMusic() {
    if (!activeR3ClockSoundId) return;
    const soundIdToStop = activeR3ClockSoundId;
    activeR3ClockSoundId = null;
    set(ref(db, `games/soundboard_status/${soundIdToStop}`), false);
    update(ref(db, 'games/soundboard'), {
        soundId: soundIdToStop,
        action: 'stop',
        timestamp: Date.now()
    });
}

function stopLocalTimer(stopMusic = true) {
    if (r3TimerInterval !== null) {
        clearInterval(r3TimerInterval);
        r3TimerInterval = null;
    }
    r3State.timerRunning = false;
    if (stopMusic) {
        stopR3ClockMusic();
    } else {
        activeR3ClockSoundId = null;
    }
}

function selectR3Question(qIndex) {
    const targetIdx = Math.min(4, Math.max(1, Number(qIndex) || 1));
    stopLocalTimer();

    r3State.currentQuestionIndex = targetIdx;
    r3State.showQuestion = false;
    r3State.showQuestionAnswer = false;
    r3State.showQuestionAnswerSeq = 0;
    r3State.remainingTime = getCurrentQuestion().duration;

    const vidEl = document.getElementById('r3-ctrl-preview-vid');
    if (vidEl) {
        vidEl.pause();
        vidEl.currentTime = 0;
    }

    updateR3MediaPreview();
    updateR3UI();
    sendR3Control();
}

function toggleR3WaitBg() {
    r3State.showWaitBg = !r3State.showWaitBg;
    updateR3UI();
    sendR3Control();
}

function toggleR3ShowQuestion() {
    r3State.showQuestion = !r3State.showQuestion;
    if (r3State.showQuestion) {
        r3State.showQuestionSeq++;
        if (typeof window.playMusic === 'function') {
            window.playMusic('R3_ShowQues.mp3', false, false);
        }
    } else {
        stopLocalTimer();
        r3State.showQuestionAnswer = false;
        r3State.showQuestionAnswerSeq = 0;
    }
    updateR3MediaPreview();
    updateR3UI();
    sendR3Control();
}

function toggleR3ShowQuestionAnswer() {
    if (!r3State.showQuestion) return;

    const nextState = !r3State.showQuestionAnswer;
    r3State.showQuestionAnswer = nextState;

    if (nextState) {
        stopLocalTimer(true);
        r3State.showQuestionAnswerSeq++;
    } else {
        const vidEl = document.getElementById('r3-ctrl-preview-vid');
        if (vidEl) {
            vidEl.pause();
            vidEl.currentTime = 0;
        }
    }

    updateR3MediaPreview();
    updateR3UI();
    sendR3Control();
}

function toggleR3Timer() {
    const q = getCurrentQuestion();
    const { file: clockSound, playbackRate: clockRate } = getR3ClockAudioConfig(q.duration);

    if (!r3State.timerRunning) {
        // Nếu đang bật media đáp án thì trả về media câu hỏi trước khi bấm giờ
        if (r3State.showQuestionAnswer) {
            r3State.showQuestionAnswer = false;
            r3State.showQuestionAnswerSeq = 0;
            updateR3MediaPreview();
        }

        // Nếu chưa bấm hiện câu hỏi thì tự bật luôn câu hỏi
        if (!r3State.showQuestion) {
            r3State.showQuestion = true;
            r3State.showQuestionSeq++;
        }

        if (r3State.remainingTime <= 0.1 || r3State.remainingTime > q.duration) {
            r3State.remainingTime = q.duration;
        }

        stopR3ClockMusic();
        r3State.timerRunning = true;
        r3State.timerSeq++;
        r3State.timerStartTimestamp = Date.now();
        activeR3ClockSoundId = clockSound.replace(/[^A-Za-z0-9_-]/g, '_');

        if (typeof window.playMusic === 'function') {
            window.playMusic(clockSound, false, false, clockRate);
        }

        if (q.mediaType === 'video') {
            const vidEl = document.getElementById('r3-ctrl-preview-vid');
            if (vidEl) {
                vidEl.muted = true;
                vidEl.volume = 0;
                vidEl.currentTime = 0;
                vidEl.play().catch(() => {});
            }
        }

        r3TimerInterval = setInterval(() => {
            r3State.remainingTime = Math.max(0, Number((r3State.remainingTime - 0.1).toFixed(1)));
            updateR3TimerDisplay();

            if (r3State.remainingTime <= 0) {
                stopLocalTimer(false);
                updateR3UI();
                sendR3Control();
            }
        }, 100);
    } else {
        stopLocalTimer(true);
    }

    updateR3UI();
    sendR3Control();
}

function toggleR3Page() {
    r3State.currentPage = r3State.currentPage === 1 ? 2 : 1;
    updateR3UI();
    sendR3Control();
}

function showR3Answers() {
    r3State.showAnswers = true;
    r3State.showAnswersSeq++;
    if (typeof window.playMusic === 'function') {
        window.playMusic('R3_ShowAns.mp3', false, false);
    }
    updateR3UI();
    sendR3Control();
}

function resetR3AnswersDisplay() {
    r3State.showAnswers = false;
    r3State.showAnswersSeq = 0;
    update(ref(db, 'games/soundboard'), {
        soundId: 'R3_ShowAns_mp3',
        action: 'stop',
        timestamp: Date.now()
    });
    updateR3UI();
    sendR3Control();
}

function resetR3Graphic() {
    stopLocalTimer(true);
    r3State.showQuestion = false;
    r3State.showQuestionAnswer = false;
    r3State.showQuestionAnswerSeq = 0;
    r3State.showAnswers = false;
    r3State.showAnswersSeq = 0;
    r3State.currentPage = 1;
    r3State.remainingTime = getCurrentQuestion().duration;

    update(ref(db, 'games/soundboard'), {
        soundId: 'R3_ShowAns_mp3',
        action: 'stop',
        timestamp: Date.now()
    });

    const vidEl = document.getElementById('r3-ctrl-preview-vid');
    if (vidEl) {
        vidEl.pause();
        vidEl.currentTime = 0;
    }

    updateR3MediaPreview();
    updateR3UI();
    sendR3Control();
}

function updateR3PlayerAnswer(idx, val) {
    const cleanAns = val !== undefined ? String(val) : "";
    r3State.players[idx].answer = cleanAns;

    const dbKey = idx + 1;
    update(ref(db, `games/round_3/dap_an_thi_sinh/${dbKey}`), {
        answer: cleanAns,
        time: r3State.players[idx].time
    }).then(() => {
        const inputEl = document.getElementById(`r3-ctrl-ans-input-${idx}`);
        if (inputEl) {
            inputEl.classList.add('saved-flash');
            setTimeout(() => inputEl.classList.remove('saved-flash'), 500);
        }
    });

    updateR3UI();
    sendR3Control();
}

function updateR3PlayerTime(idx, rawTime) {
    const trimmed = String(rawTime ?? "").trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    r3State.players[idx].time = (parsed !== null && Number.isFinite(parsed) && parsed >= 0) ? Number(parsed.toFixed(2)) : null;

    const dbKey = idx + 1;
    update(ref(db, `games/round_3/dap_an_thi_sinh/${dbKey}`), {
        answer: r3State.players[idx].answer,
        time: r3State.players[idx].time
    });

    updateR3UI();
    sendR3Control();
}

function setR3PlayerJudge(idx, targetStatus) {
    const current = r3State.players[idx].status;
    r3State.players[idx].status = (current === targetStatus) ? 'none' : targetStatus;
    updateR3UI();
    sendR3Control();
}

function awardR3CurrentQuestionScores() {
    const awards = calculateAwardPoints();
    let anyAwarded = false;

    for (let i = 0; i < 4; i++) {
        const plus = awards[i];
        if (plus > 0) {
            anyAwarded = true;
            runTransaction(ref(db, `games/players/${i + 1}/score`), (cur) => (Number(cur) || 0) + plus);
        }
    }
}

function resetAllR3PlayerAnswers() {
    const resetObj = {};
    for (let i = 0; i < 4; i++) {
        r3State.players[i].answer = "";
        r3State.players[i].time = null;
        r3State.players[i].status = "none";
        resetObj[i + 1] = { answer: "", time: null };
    }
    set(ref(db, 'games/round_3/dap_an_thi_sinh'), resetObj);
    updateR3UI();
    sendR3Control();
}

// ==========================================
// 5. MODAL CONFIG VÒNG 3 (TƯƠNG TỰ VÒNG 2)
// ==========================================
function syncR3ConfigModalScale() {
    const content = document.getElementById('r3ConfigModalContent');
    if (!content) return;
    const dpr = window.devicePixelRatio || 1;
    content.style.transform = `scale(${1 / dpr})`;
}

function compressR3ConfigName(index) {
    const el = document.getElementById(`r3-config-name-${index}`);
    if (!el || !el.parentElement) return;
    el.style.transform = 'none';
    const textWidth = el.offsetWidth;
    const containerWidth = el.parentElement.clientWidth - 12;
    if (textWidth > containerWidth && containerWidth > 0) {
        el.style.transform = `scaleX(${containerWidth / textWidth})`;
    }
}

function updateR3ConfigPreview(index) {
    const scoreInput = document.getElementById(`r3-config-score-${index}`);
    const addInput = document.getElementById(`r3-config-add-${index}`);
    const previewEl = document.getElementById(`r3-config-preview-${index}`);
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
}

window.openConfig = function() {
    const modal = document.getElementById('r3ConfigModal');
    if (!modal) return;

    for (let i = 1; i <= 4; i++) {
        const durInput = document.getElementById(`r3-cfg-dur-${i}`);
        if (durInput) {
            durInput.value = r3State.questions[i - 1]?.duration || r3State.durations[i - 1] || (i <= 2 ? 20 : 30);
        }

        const p = r3State.players[i - 1] || { name: `P${i}`, score: 0 };
        const nameEl = document.getElementById(`r3-config-name-${i}`);
        const scoreInput = document.getElementById(`r3-config-score-${i}`);
        const addInput = document.getElementById(`r3-config-add-${i}`);

        if (nameEl) nameEl.textContent = p.name || `P${i}`;
        if (scoreInput) scoreInput.value = Number(p.score) || 0;
        if (addInput) addInput.value = 0;
        updateR3ConfigPreview(i);
    }

    syncR3ConfigModalScale();
    modal.style.display = 'flex';
    setTimeout(() => {
        for (let i = 1; i <= 4; i++) compressR3ConfigName(i);
    }, 30);
};

window.closeConfig = function() {
    const modal = document.getElementById('r3ConfigModal');
    if (modal) modal.style.display = 'none';
};

function saveR3Config() {
    const updates = [];

    for (let i = 1; i <= 4; i++) {
        const durInput = document.getElementById(`r3-cfg-dur-${i}`);
        if (durInput) {
            const newDur = Math.max(1, Number(durInput.value) || (i <= 2 ? 20 : 30));
            r3State.durations[i - 1] = newDur;
            r3State.questions[i - 1].duration = newDur;
            updates.push(
                update(ref(db, `questions/round_3/${i}`), {
                    thoi_gian: newDur
                })
            );
        }

        const nameEl = document.getElementById(`r3-config-name-${i}`);
        const scoreInput = document.getElementById(`r3-config-score-${i}`);
        const addInput = document.getElementById(`r3-config-add-${i}`);

        const finalName = (nameEl ? nameEl.textContent.trim() : '') || `P${i}`;
        const baseScore = scoreInput ? (Number(scoreInput.value) || 0) : (r3State.players[i - 1].score || 0);
        const bonusScore = addInput ? (Number(addInput.value) || 0) : 0;
        const finalScore = baseScore + bonusScore;

        r3State.players[i - 1].name = finalName;
        r3State.players[i - 1].score = finalScore;

        if (scoreInput) scoreInput.value = finalScore;
        if (addInput) addInput.value = 0;
        updateR3ConfigPreview(i);

        updates.push(
            update(ref(db, `games/players/${i}`), {
                name: finalName,
                score: finalScore
            })
        );
    }

    if (!r3State.timerRunning) {
        r3State.remainingTime = getCurrentQuestion().duration;
    }

    updateR3UI();
    sendR3Control();
    Promise.all(updates).then(() => window.closeConfig());
}

// ==========================================
// 6. FIREBASE LISTENERS & GẮN SỰ KIỆN DOM
// ==========================================
function setupR3FirebaseListeners() {
    r3PlayersUnsub = onValue(ref(db, 'games/players'), (snapshot) => {
        if (!snapshot.exists()) return;
        const playersData = snapshot.val();
        for (let i = 1; i <= 4; i++) {
            if (playersData[i]) {
                r3State.players[i - 1].name = playersData[i].name || `P${i}`;
                r3State.players[i - 1].score = Number(playersData[i].score) || 0;
            }
        }
        updateR3UI();
        sendR3Control();
    });

    r3QuestionsUnsub = onValue(ref(db, 'questions/round_3'), (snapshot) => {
        const qData = snapshot.exists() ? snapshot.val() : {};
        for (let i = 1; i <= 4; i++) {
            const defaultDur = r3State.durations[i - 1] || (i <= 2 ? 20 : 30);
            const rawItem = qData ? qData[i] : null;
            if (rawItem) {
                const mediaInfo = detectMediaInfo(rawItem, defaultDur);
                r3State.questions[i - 1] = {
                    text: rawItem.cau_hoi || rawItem.question || "",
                    answer: rawItem.dap_an || rawItem.answer || "",
                    mediaUrl: mediaInfo.mediaUrl,
                    mediaType: mediaInfo.mediaType,
                    answerMediaUrl: mediaInfo.answerMediaUrl,
                    answerMediaType: mediaInfo.answerMediaType,
                    duration: mediaInfo.duration
                };
            } else {
                r3State.questions[i - 1] = {
                    text: "",
                    answer: "",
                    mediaUrl: "",
                    mediaType: "none",
                    answerMediaUrl: "",
                    answerMediaType: "none",
                    duration: defaultDur
                };
            }
        }

        if (!r3State.timerRunning) {
            r3State.remainingTime = getCurrentQuestion().duration;
        }
        updateR3MediaPreview();
        updateR3UI();
        sendR3Control();
    });

    r3AnswersUnsub = onValue(ref(db, 'games/round_3/dap_an_thi_sinh'), (snapshot) => {
        const answers = snapshot.exists() ? snapshot.val() : {};
        for (let i = 1; i <= 4; i++) {
            const raw = answers ? answers[i] : null;
            if (raw !== null && raw !== undefined) {
                if (typeof raw === 'object') {
                    r3State.players[i - 1].answer = String(raw.answer ?? raw.dap_an ?? "");
                    const rawTime = raw.time ?? raw.thoi_gian;
                    if (rawTime !== undefined && rawTime !== null && rawTime !== "") {
                        r3State.players[i - 1].time = Number(Number(rawTime).toFixed(2));
                    } else if (raw.timestamp && r3State.timerStartTimestamp > 0) {
                        const diff = Math.max(0, (Number(raw.timestamp) - r3State.timerStartTimestamp) / 1000);
                        r3State.players[i - 1].time = Number(diff.toFixed(2));
                    } else {
                        r3State.players[i - 1].time = null;
                    }
                } else {
                    r3State.players[i - 1].answer = String(raw);
                }
            } else {
                r3State.players[i - 1].answer = "";
                r3State.players[i - 1].time = null;
            }
        }
        updateR3UI();
        sendR3Control();
    });
}

function bindR3Events() {
    const r3Ui = document.getElementById('r3-controller-ui');
    if (!r3Ui || r3Ui.dataset.eventsBound === 'true') return;
    r3Ui.dataset.eventsBound = 'true';

    // Tự động chèn nút HIỆN Đ/A CÂU HỎI nếu Controller.html chưa có sẵn thẻ này
    let showQuesAnsBtn = document.getElementById('r3-btn-show-ques-ans');
    if (!showQuesAnsBtn) {
        const leftControls = r3Ui.querySelector('.r3-ctrl-left-controls');
        if (leftControls) {
            showQuesAnsBtn = document.createElement('button');
            showQuesAnsBtn.type = 'button';
            showQuesAnsBtn.className = 'r3-ctrl-btn';
            showQuesAnsBtn.id = 'r3-btn-show-ques-ans';
            showQuesAnsBtn.textContent = 'HIỆN Đ/A CÂU HỎI';
            const pageBtn = document.getElementById('r3-btn-page');
            if (pageBtn && pageBtn.parentElement === leftControls) {
                leftControls.insertBefore(showQuesAnsBtn, pageBtn);
            } else {
                leftControls.appendChild(showQuesAnsBtn);
            }
        }
    }

    r3Ui.querySelectorAll('.r3-ctrl-q-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            selectR3Question(Number(tab.dataset.qIndex));
        });
    });

    document.getElementById('r3-btn-wait-bg')?.addEventListener('click', toggleR3WaitBg);
    document.getElementById('r3-btn-show-ques')?.addEventListener('click', toggleR3ShowQuestion);
    showQuesAnsBtn?.addEventListener('click', toggleR3ShowQuestionAnswer);
    document.getElementById('r3-btn-timer')?.addEventListener('click', toggleR3Timer);
    document.getElementById('r3-btn-page')?.addEventListener('click', toggleR3Page);
    document.getElementById('r3-btn-show-ans')?.addEventListener('click', showR3Answers);
    document.getElementById('r3-btn-reset-ans')?.addEventListener('click', resetR3AnswersDisplay);
    document.getElementById('r3-btn-reset-graphic')?.addEventListener('click', resetR3Graphic);

    r3Ui.querySelectorAll('.r3-ctrl-ans-input').forEach(input => {
        const idx = Number(input.dataset.playerIndex);
        input.addEventListener('change', () => updateR3PlayerAnswer(idx, input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                updateR3PlayerAnswer(idx, input.value);
                input.blur();
            }
        });
    });

    r3Ui.querySelectorAll('.r3-ctrl-time-input').forEach(input => {
        const idx = Number(input.dataset.playerIndex);
        input.addEventListener('change', () => updateR3PlayerTime(idx, input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                updateR3PlayerTime(idx, input.value);
                input.blur();
            }
        });
    });

    r3Ui.querySelectorAll('.r3-ctrl-judge-btn.right').forEach(btn => {
        btn.addEventListener('click', () => setR3PlayerJudge(Number(btn.dataset.playerIndex), 'right'));
    });

    r3Ui.querySelectorAll('.r3-ctrl-judge-btn.wrong').forEach(btn => {
        btn.addEventListener('click', () => setR3PlayerJudge(Number(btn.dataset.playerIndex), 'wrong'));
    });

    document.getElementById('r3-btn-award-scores')?.addEventListener('click', awardR3CurrentQuestionScores);
    document.getElementById('r3-btn-reset-player-ans')?.addEventListener('click', resetAllR3PlayerAnswers);

    // Modal Config Vòng 3
    const cfgModal = document.getElementById('r3ConfigModal');
    if (cfgModal) {
        document.getElementById('r3-cfg-close-btn')?.addEventListener('click', window.closeConfig);
        document.getElementById('r3-cfg-save-btn')?.addEventListener('click', saveR3Config);

        cfgModal.querySelectorAll('.r3-cfg-name').forEach(nameEl => {
            const num = Number(nameEl.dataset.playerNum);
            nameEl.addEventListener('input', () => compressR3ConfigName(num));
            nameEl.addEventListener('blur', () => {
                const cleanName = nameEl.textContent.trim() || `P${num}`;
                nameEl.textContent = cleanName;
                compressR3ConfigName(num);
                r3State.players[num - 1].name = cleanName;
                update(ref(db, `games/players/${num}`), { name: cleanName });
                updateR3UI();
            });
            nameEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    nameEl.blur();
                }
            });
        });

        cfgModal.querySelectorAll('.r3-cfg-score-input, .r3-cfg-bonus-input').forEach(input => {
            const num = Number(input.dataset.playerNum);
            input.addEventListener('input', () => updateR3ConfigPreview(num));
        });

        cfgModal.querySelectorAll('.r3-cfg-preset-btn').forEach(btn => {
            const num = Number(btn.dataset.playerNum);
            btn.addEventListener('click', () => {
                const addInput = document.getElementById(`r3-config-add-${num}`);
                if (!addInput) return;
                if (btn.dataset.delta !== undefined) {
                    addInput.value = (Number(addInput.value) || 0) + Number(btn.dataset.delta);
                } else if (btn.dataset.set !== undefined) {
                    addInput.value = Number(btn.dataset.set) || 0;
                }
                updateR3ConfigPreview(num);
            });
        });
    }
}

function initControllerR3() {
    const r3Ui = document.getElementById('r3-controller-ui');
    if (!r3Ui) return;

    r3Ui.style.display = 'grid';
    bindR3Events();
    setupR3FirebaseListeners();
    window.addEventListener('resize', syncR3ConfigModalScale);

    r3State.currentPage = 1;
    r3State.showQuestion = false;
    r3State.showQuestionAnswer = false;
    r3State.showQuestionAnswerSeq = 0;
    r3State.showAnswers = false;
    r3State.remainingTime = getCurrentQuestion().duration;

    updateR3MediaPreview();
    updateR3UI();
    sendR3Control();
}

initControllerR3();

window.cleanupCurrentRound = () => {
    stopLocalTimer();
    window.removeEventListener('resize', syncR3ConfigModalScale);
    if (typeof r3PlayersUnsub === 'function') r3PlayersUnsub();
    if (typeof r3QuestionsUnsub === 'function') r3QuestionsUnsub();
    if (typeof r3AnswersUnsub === 'function') r3AnswersUnsub();
    r3PlayersUnsub = null;
    r3QuestionsUnsub = null;
    r3AnswersUnsub = null;

    const cfgModal = document.getElementById('r3ConfigModal');
    if (cfgModal) cfgModal.style.display = 'none';

    const r3Ui = document.getElementById('r3-controller-ui');
    if (r3Ui) r3Ui.style.display = 'none';
};