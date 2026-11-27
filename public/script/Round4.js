import { getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const app = getApp();
const db = getDatabase(app);

// =========================================================================
// 1. TRẠNG THÁI ĐỒ HỌA LIVESTREAM VÒNG 4
// =========================================================================
let cachedPlayers = {
    1: { name: 'P1', score: 0 },
    2: { name: 'P2', score: 0 },
    3: { name: 'P3', score: 0 },
    4: { name: 'P4', score: 0 }
};

let activePlayerIndex = null;
let buzzerPlayerIndex = null;
let currentChosenValues = [20, 20, 30];
let arePlayersShown = false;

let packFadeInTimer = null;
let quesFadeInTimer = null;
let isInitialCmdLoad = true;
const unsubscribers = [];

function clearR4Timers() {
    if (packFadeInTimer) {
        clearTimeout(packFadeInTimer);
        packFadeInTimer = null;
    }
    if (quesFadeInTimer) {
        clearTimeout(quesFadeInTimer);
        quesFadeInTimer = null;
    }
}

function setupVideoHoldLastFrame(videoEl) {
    if (!videoEl) return;
    videoEl.addEventListener('ended', () => {
        videoEl.pause();
    });
}

function fadeInElement(el) {
    if (!el) return;
    el.style.transition = 'none';
    el.style.opacity = '0';
    void el.offsetWidth;
    el.style.transition = 'opacity 0.3s ease';
    el.style.opacity = '1';
}

// =========================================================================
// 2. HÀM CẬP NHẬT TEXT & SHAPE THÍ SINH
// =========================================================================
function isProjectorScreen() {
    return Boolean(document.getElementById('projector-bg')) ||
           window.location.pathname.toLowerCase().includes('projector') ||
           document.title.toLowerCase().includes('projector');
}

function renderProjectorPlayersBar(animateFadeIn = false) {
    const activeTextEl = document.getElementById('r4-proj-active-text');
    const activeShapeEl = document.getElementById('r4-proj-active-shape');

    const validActiveId = (activePlayerIndex >= 1 && activePlayerIndex <= 4)
        ? Number(activePlayerIndex)
        : null;

    // 1. Vị trí thí sinh đang chơi
    if (activeTextEl) {
        const activePlayer = validActiveId
            ? (cachedPlayers[validActiveId] || { name: `P${validActiveId}`, score: 0 })
            : null;
        activeTextEl.textContent = activePlayer ? activePlayer.name : '';

        if (!arePlayersShown || !validActiveId) {
            activeTextEl.style.transition = 'none';
            activeTextEl.style.opacity = '0';
        } else if (animateFadeIn) {
            fadeInElement(activeTextEl);
        } else {
            activeTextEl.style.opacity = '1';
        }
    }

    if (activeShapeEl) {
        if (!arePlayersShown || !validActiveId) {
            activeShapeEl.classList.remove('is-active-player', 'is-buzzer-player');
            activeShapeEl.style.transition = 'none';
            activeShapeEl.style.opacity = '0';
        } else {
            activeShapeEl.classList.add('is-active-player');
            activeShapeEl.classList.remove('is-buzzer-player');
            if (animateFadeIn) {
                fadeInElement(activeShapeEl);
            } else {
                activeShapeEl.style.opacity = '1';
            }
        }
    }

    // 2. Vị trí 3 thí sinh còn lại xếp theo thứ tự stt 1 -> 4 từ trái sang phải
    const remainingIds = [1, 2, 3, 4].filter(id => id !== validActiveId);

    for (let slot = 1; slot <= 3; slot++) {
        const playerId = remainingIds[slot - 1];
        const textEl = document.getElementById(`r4-proj-other-text-${slot}`);
        const shapeEl = document.getElementById(`r4-proj-other-shape-${slot}`);

        if (textEl) {
            if (playerId) {
                const p = cachedPlayers[playerId] || { name: `P${playerId}`, score: 0 };
                textEl.textContent = `${p.name} (${p.score})`;
            } else {
                textEl.textContent = '';
            }

            if (!arePlayersShown || !playerId) {
                textEl.style.transition = 'none';
                textEl.style.opacity = '0';
            } else if (animateFadeIn) {
                fadeInElement(textEl);
            } else {
                textEl.style.opacity = '1';
            }
        }

        if (shapeEl) {
            if (!arePlayersShown || !playerId) {
                shapeEl.classList.remove('is-active-player', 'is-buzzer-player');
                shapeEl.style.transition = 'none';
                shapeEl.style.opacity = '0';
            } else {
                const isBuzzer = Number(buzzerPlayerIndex) === playerId;
                shapeEl.classList.remove('is-active-player');
                shapeEl.classList.toggle('is-buzzer-player', isBuzzer);

                if (isBuzzer) {
                    if (animateFadeIn) {
                        fadeInElement(shapeEl);
                    } else {
                        shapeEl.style.opacity = '1';
                    }
                } else {
                    shapeEl.style.transition = 'none';
                    shapeEl.style.opacity = '0';
                }
            }
        }
    }
}

function renderPlayersBarAndScore(animateFadeIn = false) {
    if (isProjectorScreen() && document.getElementById('r4-proj-active-text')) {
        renderProjectorPlayersBar(animateFadeIn);
    } else {
        for (let i = 1; i <= 4; i++) {
            const p = cachedPlayers[i] || { name: `P${i}`, score: 0 };
            const textEl = document.getElementById(`r4-player-text-${i}`);
            const shapeEl = document.getElementById(`r4-player-shape-${i}`);

            if (textEl) {
                if (activePlayerIndex === i) {
                    textEl.textContent = p.name;
                } else {
                    textEl.textContent = `${p.name} (${p.score})`;
                }

                if (!arePlayersShown) {
                    textEl.style.transition = 'none';
                    textEl.style.opacity = '0';
                } else if (animateFadeIn) {
                    fadeInElement(textEl);
                } else {
                    textEl.style.opacity = '1';
                }
            }

            if (shapeEl) {
                if (!arePlayersShown) {
                    shapeEl.classList.remove('is-active-player', 'is-buzzer-player');
                    shapeEl.style.transition = 'none';
                    shapeEl.style.opacity = '0';
                } else {
                    const isActive = activePlayerIndex === i;
                    const isBuzzer = buzzerPlayerIndex === i;
                    shapeEl.classList.toggle('is-active-player', isActive);
                    shapeEl.classList.toggle('is-buzzer-player', isBuzzer);

                    if (isActive || isBuzzer) {
                        if (animateFadeIn) {
                            fadeInElement(shapeEl);
                        } else {
                            shapeEl.style.opacity = '1';
                        }
                    } else {
                        shapeEl.style.transition = 'none';
                        shapeEl.style.opacity = '0';
                    }
                }
            }
        }
    }

    const activeScoreEl = document.getElementById('r4-active-score-text');
    if (activeScoreEl) {
        const activeScore = activePlayerIndex && cachedPlayers[activePlayerIndex]
            ? cachedPlayers[activePlayerIndex].score
            : 0;
        activeScoreEl.textContent = activeScore;

        if (!arePlayersShown) {
            activeScoreEl.style.transition = 'none';
            activeScoreEl.style.opacity = '0';
        } else if (animateFadeIn) {
            fadeInElement(activeScoreEl);
        } else {
            activeScoreEl.style.opacity = '1';
        }
    }
}

// =========================================================================
// 3. CÁC HÀM ĐIỀU KHIỂN HIỆU ỨNG ĐỒ HỌA
// =========================================================================

// Bước 1: Hiện gói câu hỏi (hỗ trợ chọn câu trước ShowPack, fade in đồng thời text + shape 0.3s)
function showPackStage(ptsLevel1 = 20, ptsLevel2 = 30, selectedIndices = []) {
    clearR4Timers();
    hideQuesStage();

    const packStage = document.getElementById('r4-pack-stage');
    const packVid = document.getElementById('r4_showpack');
    const packShapesWrap = document.getElementById('r4-pack-shapes');
    const packTextsWrap = document.getElementById('r4-pack-texts');

    if (!packStage || !packVid || !packTextsWrap) return;

    const selectedSet = new Set((Array.isArray(selectedIndices) ? selectedIndices : []).map(Number));

    for (let i = 0; i < 6; i++) {
        const txt = document.getElementById(`r4-pack-text-${i}`);
        const shp = document.getElementById(`r4-pack-shape-${i}`);
        if (txt) txt.textContent = i < 3 ? ptsLevel1 : ptsLevel2;
        if (shp) shp.classList.toggle('is-selected', selectedSet.has(i));
    }

    if (packShapesWrap) packShapesWrap.classList.remove('fade-in');
    packTextsWrap.classList.remove('fade-in');
    packStage.style.display = 'block';

    packVid.currentTime = 0;
    packVid.play().catch(err => console.warn('Không thể phát r4_showpack.webm:', err));

    // Sau 2s fade in đồng thời cả 6 text lẫn các shape đã chọn (0.3s)
    packFadeInTimer = setTimeout(() => {
        if (packShapesWrap) packShapesWrap.classList.add('fade-in');
        packTextsWrap.classList.add('fade-in');
    }, 2000);
}

function hidePackStage() {
    const packStage = document.getElementById('r4-pack-stage');
    const packVid = document.getElementById('r4_showpack');
    const packShapesWrap = document.getElementById('r4-pack-shapes');
    const packTextsWrap = document.getElementById('r4-pack-texts');

    if (packShapesWrap) packShapesWrap.classList.remove('fade-in');
    if (packTextsWrap) packTextsWrap.classList.remove('fade-in');
    if (packStage) packStage.style.display = 'none';
    if (packVid) {
        packVid.pause();
        packVid.currentTime = 0;
    }
}

// Bước 2: Cập nhật shape gradient đỏ đè lên vid dưới text khi chọn câu
function updatePackSelection(selectedIndices = []) {
    const selectedSet = new Set(selectedIndices.map(Number));
    for (let i = 0; i < 6; i++) {
        const shp = document.getElementById(`r4-pack-shape-${i}`);
        if (shp) {
            shp.classList.toggle('is-selected', selectedSet.has(i));
        }
    }
}

// Bước 3: Ẩn gói, chạy r4_showques.webm -> tạm thời không hiện tên TS & shape active
function showQuesStage(payload, showPlayersAfterVid = false) {
    clearR4Timers();
    hidePackStage();
    stopTimerVideo();

    if (payload.players) {
        cachedPlayers = payload.players;
    }
    activePlayerIndex = Number(payload.activePlayer) || null;
    buzzerPlayerIndex = null;
    arePlayersShown = false;

    if (Array.isArray(payload.chosenValues) && payload.chosenValues.length === 3) {
        currentChosenValues = payload.chosenValues;
    }

    const quesStage = document.getElementById('r4-ques-stage');
    const quesVid = document.getElementById('r4_showques');
    const quesTextsWrap = document.getElementById('r4-ques-texts');
    const quesTextEl = document.getElementById('r4-question-text');

    if (!quesStage || !quesVid || !quesTextsWrap) return;

    if (quesTextEl) {
        quesTextEl.style.display = 'none';
        quesTextEl.textContent = '';
    }
    for (let s = 0; s < 3; s++) {
        const qValTxt = document.getElementById(`r4-qval-text-${s}`);
        const qValShp = document.getElementById(`r4-qval-shape-${s}`);
        if (qValTxt) qValTxt.textContent = currentChosenValues[s];
        if (qValShp) qValShp.classList.remove('is-current-qval');
    }

    renderPlayersBarAndScore(false);

    quesTextsWrap.classList.remove('fade-in');
    quesStage.style.display = 'block';

    quesVid.currentTime = 0;
    quesVid.play().catch(err => console.warn('Không thể phát r4_showques.webm:', err));

    quesFadeInTimer = setTimeout(() => {
        quesTextsWrap.classList.add('fade-in');
        if (showPlayersAfterVid) {
            arePlayersShown = true;
            renderPlayersBarAndScore(true);
        }
    }, 3000);
}

function revealPlayersInQuesStage(payload) {
    const quesStage = document.getElementById('r4-ques-stage');
    const quesTextsWrap = document.getElementById('r4-ques-texts');

    if (!quesStage || quesStage.style.display !== 'block') {
        showQuesStage(payload, true);
        return;
    }

    if (payload.players) cachedPlayers = payload.players;
    activePlayerIndex = Number(payload.activePlayer) || null;
    if (Array.isArray(payload.chosenValues) && payload.chosenValues.length === 3) {
        currentChosenValues = payload.chosenValues;
        for (let s = 0; s < 3; s++) {
            const qValTxt = document.getElementById(`r4-qval-text-${s}`);
            if (qValTxt) qValTxt.textContent = currentChosenValues[s];
        }
    }

    if (quesFadeInTimer) {
        clearTimeout(quesFadeInTimer);
        quesFadeInTimer = null;
    }
    if (quesTextsWrap) {
        quesTextsWrap.classList.add('fade-in');
    }

    const shouldFadeIn = !arePlayersShown;
    arePlayersShown = true;
    renderPlayersBarAndScore(shouldFadeIn);
}

function hidePlayersInQuesStage() {
    arePlayersShown = false;
    renderPlayersBarAndScore(false);
}

function hideQuesStage() {
    const quesStage = document.getElementById('r4-ques-stage');
    const quesVid = document.getElementById('r4_showques');
    const quesTextsWrap = document.getElementById('r4-ques-texts');
    const quesTextEl = document.getElementById('r4-question-text');

    stopTimerVideo();
    arePlayersShown = false;

    if (quesTextsWrap) quesTextsWrap.classList.remove('fade-in');
    if (quesTextEl) {
        quesTextEl.style.display = 'none';
        quesTextEl.textContent = '';
    }
    if (quesStage) quesStage.style.display = 'none';
    if (quesVid) {
        quesVid.pause();
        quesVid.currentTime = 0;
    }
}

// Bước 4: Hiện câu hỏi + vẽ shape gradient hình bình hành đè dưới text giá trị câu hỏi hiện tại
function showQuestionAndHighlightValue(slotIndex = 0, questionText = '') {
    const quesTextEl = document.getElementById('r4-question-text');
    if (quesTextEl) {
        quesTextEl.textContent = questionText;
        quesTextEl.style.display = 'flex';
    }

    for (let s = 0; s < 3; s++) {
        const qValShp = document.getElementById(`r4-qval-shape-${s}`);
        if (qValShp) {
            qValShp.classList.toggle('is-current-qval', s === Number(slotIndex));
        }
    }
}

function hideQuestionTextOnly() {
    const quesTextEl = document.getElementById('r4-question-text');
    if (quesTextEl) {
        quesTextEl.style.display = 'none';
        quesTextEl.textContent = '';
    }
    for (let s = 0; s < 3; s++) {
        const qValShp = document.getElementById(`r4-qval-shape-${s}`);
        if (qValShp) qValShp.classList.remove('is-current-qval');
    }
}

function startTimerVideo(duration) {
    const timerVid = document.getElementById('r4_timer');
    if (!timerVid) return;

    const dur = Math.max(1, Number(duration) || 15);
    const prefix = isProjectorScreen() ? 'pro_' : '';
    const targetSrc = dur === 15
        ? `../graphic/o27/${prefix}r4_15s.webm`
        : `../graphic/o27/${prefix}r4_20s.webm`;
    const rate = (dur === 15 || dur === 20) ? 1 : (20 / dur);

    timerVid.pause();
    timerVid.style.display = 'block';
    timerVid.defaultPlaybackRate = rate;
    timerVid.playbackRate = rate;

    const playWithRate = () => {
        timerVid.defaultPlaybackRate = rate;
        timerVid.playbackRate = rate;
        timerVid.currentTime = 0;
        timerVid.play().catch(err => console.warn('Không thể phát video thời gian R4:', err));
    };

    if (timerVid.getAttribute('src') !== targetSrc) {
        timerVid.src = targetSrc;
        timerVid.addEventListener('loadedmetadata', playWithRate, { once: true });
        timerVid.load();
    } else {
        playWithRate();
    }
}

function pauseTimerVideo() {
    const timerVid = document.getElementById('r4_timer');
    if (timerVid && !timerVid.paused) {
        timerVid.pause();
    }
}

function resumeTimerVideo() {
    const timerVid = document.getElementById('r4_timer');
    if (timerVid && timerVid.style.display !== 'none' && timerVid.paused) {
        timerVid.play().catch(err => console.warn('Không thể tiếp tục video thời gian R4:', err));
    }
}

function stopTimerVideo() {
    const timerVid = document.getElementById('r4_timer');
    if (!timerVid) return;
    timerVid.style.display = 'none';
    timerVid.pause();
    timerVid.currentTime = 0;
    timerVid.defaultPlaybackRate = 1;
    timerVid.playbackRate = 1;
}

// Bước 6: Bật / tắt Ngôi sao hi vọng (r4_star.webm - chỉ đổi khi Controller bấm nút sao)
function toggleStarVideo(isActive) {
    const starVid = document.getElementById('r4_star');
    if (!starVid) return;

    if (isActive) {
        starVid.style.display = 'block';
        starVid.currentTime = 0;
        starVid.play().catch(err => console.warn('Không thể phát r4_star.webm:', err));
    } else {
        starVid.style.display = 'none';
        starVid.pause();
        starVid.currentTime = 0;
    }
}

function toggleR4WaitBg(isVisible) {
    if (!isProjectorScreen()) return;
    const waitBgEl = document.getElementById('r4-wait-bg');
    if (!waitBgEl) return;
    waitBgEl.style.display = isVisible ? 'block' : 'none';
}

function resetAllR4Graphics() {
    clearR4Timers();
    hidePackStage();
    hideQuesStage();
    stopTimerVideo();
    toggleStarVideo(false);
    toggleR4WaitBg(false);
    activePlayerIndex = null;
    buzzerPlayerIndex = null;
    arePlayersShown = false;
}

// =========================================================================
// 4. LẮNG NGHE DỮ LIỆU REALTIME TỪ FIREBASE
// =========================================================================
function initRound4Livestream() {
    setupVideoHoldLastFrame(document.getElementById('r4_showpack'));
    setupVideoHoldLastFrame(document.getElementById('r4_showques'));
    setupVideoHoldLastFrame(document.getElementById('r4_timer'));
    setupVideoHoldLastFrame(document.getElementById('r4_star'));

    const unsubPlayers = onValue(ref(db, 'games/players'), (snapshot) => {
        if (snapshot.exists()) {
            cachedPlayers = snapshot.val();
            renderPlayersBarAndScore(false);
        }
    });

    const unsubCommands = onValue(ref(db, 'games/commands'), (snapshot) => {
        if (isInitialCmdLoad) {
            isInitialCmdLoad = false;
            return;
        }
        if (!snapshot.exists()) return;
        const data = snapshot.val();
        if (!data || !data.action) return;

        switch (data.action) {
            case 'r4_show_wait_bg':
                toggleR4WaitBg(true);
                break;

            case 'r4_hide_wait_bg':
                toggleR4WaitBg(false);
                break;

            case 'r4_show_pack':
                showPackStage(data.ptsLevel1, data.ptsLevel2, data.selectedIndices || []);
                break;

            case 'r4_update_pack_selection':
                updatePackSelection(data.selectedIndices || []);
                break;

            case 'r4_show_ques_stage':
                showQuesStage(data, false);
                break;

            case 'r4_show_players':
                revealPlayersInQuesStage(data);
                break;

            case 'r4_hide_players':
                hidePlayersInQuesStage();
                break;

            case 'r4_show_question':
                showQuestionAndHighlightValue(data.slotIndex, data.questionText);
                break;

            case 'r4_hide_question':
                hideQuestionTextOnly();
                break;

            case 'r4_start_timer':
                startTimerVideo(data.duration);
                break;

            case 'r4_pause_timer':
                pauseTimerVideo();
                break;

            case 'r4_resume_timer':
                resumeTimerVideo();
                break;

            case 'r4_stop_timer':
                stopTimerVideo();
                break;

            case 'r4_update_buzzer':
                if (data.activePlayer !== undefined) {
                    activePlayerIndex = data.activePlayer ? Number(data.activePlayer) : null;
                }
                buzzerPlayerIndex = data.buzzerPlayer ? Number(data.buzzerPlayer) : null;
                renderPlayersBarAndScore(false);
                break;

            case 'r4_toggle_star':
                toggleStarVideo(Boolean(data.active));
                break;

            case 'reset_graphic':
                resetAllR4Graphics();
                break;
        }
    });

    unsubscribers.push(unsubPlayers, unsubCommands);
}

initRound4Livestream();

window.cleanupCurrentRound = () => {
    resetAllR4Graphics();
    unsubscribers.forEach(fn => {
        try { fn(); } catch (e) {}
    });
    unsubscribers.length = 0;
};