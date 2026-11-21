import { getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const app = getApp();
const db = getDatabase(app);

const PLAYER_BAR_IMG = '../graphic/r5_player.png';
const BUZZED_BAR_IMG = '../graphic/r5_buzzer.png';

// =========================================================================
// 1. THAM CHIẾU DOM TRÊN LIVESTREAM.HTML
// =========================================================================
const els = {
    root: () => document.getElementById('round5-ui'),
    quesImg: () => document.getElementById('r5_ques_img'),
    video15s: () => document.getElementById('r5_15s_video'),
    audio15s: () => document.getElementById('audio_r5_15s'),
    playersContainer: () => document.getElementById('r5-players-container'),
    questionText: () => document.getElementById('r5-question-text'),
    buzzerOverlay: () => document.getElementById('r5-buzzer-overlay')
};

const lsR5State = {
    players: ['Thí sinh 1', 'Thí sinh 2'],
    questionText: '',
    isQuestionShown: false,
    buzzedIndex: null
};

const unsubscribers = [];
let lastProcessedCommandTs = 0;

function preloadPlayerBarGraphics() {
    [PLAYER_BAR_IMG, BUZZED_BAR_IMG].forEach((src) => {
        const img = new Image();
        img.src = src;
    });
}

// =========================================================================
// 2. HIỂN THỊ DANH SÁCH 2 - 8 THÍ SINH (CHỈ ĐỔI NỀN KHI BẤM CHUÔNG)
// =========================================================================
function renderLivestreamPlayers() {
    const container = els.playersContainer();
    if (!container) return;

    const list = Array.isArray(lsR5State.players) ? lsR5State.players : [];
    container.classList.toggle('many-players', list.length >= 5);
    container.innerHTML = '';

    list.forEach((name, idx) => {
        const isBuzzed = lsR5State.buzzedIndex === idx;

        const slot = document.createElement('div');
        slot.className = 'r5-ls-player-slot';

        const bgImg = document.createElement('img');
        bgImg.className = 'r5-ls-player-bg';
        bgImg.src = isBuzzed ? BUZZED_BAR_IMG : PLAYER_BAR_IMG;
        bgImg.alt = '';

        const nameSpan = document.createElement('div');
        nameSpan.className = 'r5-ls-player-name';
        nameSpan.textContent = name;

        slot.appendChild(bgImg);
        slot.appendChild(nameSpan);
        container.appendChild(slot);
    });
}

function showQuestionSimultaneously(data = {}) {
    if (Array.isArray(data.players) && data.players.length > 0) {
        lsR5State.players = data.players;
    }
    if (typeof data.questionText === 'string') {
        lsR5State.questionText = data.questionText;
    }
    if (data.buzzedIndex !== undefined) {
        lsR5State.buzzedIndex = data.buzzedIndex;
    }

    lsR5State.isQuestionShown = true;

    const root = els.root();
    const quesImg = els.quesImg();
    const playersContainer = els.playersContainer();
    const questionTextEl = els.questionText();

    if (root) root.style.display = 'block';

    renderLivestreamPlayers();
    if (questionTextEl) {
        questionTextEl.textContent = lsR5State.questionText;
    }

    if (quesImg) quesImg.style.display = 'block';
    if (playersContainer) playersContainer.style.display = 'flex';
    if (questionTextEl) questionTextEl.style.display = 'flex';
}

function hideQuestionGraphics() {
    lsR5State.isQuestionShown = false;

    const quesImg = els.quesImg();
    const playersContainer = els.playersContainer();
    const questionTextEl = els.questionText();

    if (quesImg) quesImg.style.display = 'none';
    if (playersContainer) playersContainer.style.display = 'none';
    if (questionTextEl) questionTextEl.style.display = 'none';
}

// =========================================================================
// 3. ĐIỀU KHIỂN ĐỒNG HỒ 15S (r5_15s.webm + r5_15s.mp3)
// =========================================================================
function ensure15sAudioFallback() {
    const audio = els.audio15s();
    if (!audio || audio.dataset.fallbackBound === '1') return;
    audio.dataset.fallbackBound = '1';

    const switchToUpper = () => {
        if (!audio.src.includes('R5_15s.mp3')) {
            audio.src = '../sounds/R5_15s.mp3';
            audio.load();
        }
    };

    if (audio.error) {
        switchToUpper();
    }
    audio.addEventListener('error', switchToUpper);
}

function start15sMedia() {
    ensure15sAudioFallback();
    const video = els.video15s();
    const audio = els.audio15s();

    if (video) {
        video.style.display = 'block';
        video.currentTime = 0;
        video.play().catch(err => console.warn('Lỗi phát r5_15s.webm:', err));
    }
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(err => console.warn('Lỗi phát nhạc 15s Vòng 5:', err));
    }
}

function pause15sMedia() {
    const video = els.video15s();
    const audio = els.audio15s();

    if (video && !video.paused) {
        video.pause();
    }
    if (audio && !audio.paused) {
        audio.pause();
    }
}

function resume15sMedia() {
    const video = els.video15s();
    const audio = els.audio15s();

    if (video) {
        video.style.display = 'block';
        if (video.paused && !video.ended) {
            video.play().catch(err => console.warn('Lỗi tiếp tục r5_15s.webm:', err));
        }
    }
    if (audio && audio.paused && !audio.ended) {
        audio.play().catch(err => console.warn('Lỗi tiếp tục nhạc 15s Vòng 5:', err));
    }
}

function stopAndHide15sMedia() {
    const video = els.video15s();
    const audio = els.audio15s();

    if (video) {
        video.pause();
        video.currentTime = 0;
        video.style.display = 'none';
    }
    if (audio) {
        audio.pause();
        audio.currentTime = 0;
    }
}

function resetAllR5Graphics() {
    lsR5State.buzzedIndex = null;
    renderLivestreamPlayers();
    stopAndHide15sMedia();
    hideQuestionGraphics();
}

// =========================================================================
// 4. XỬ LÝ LỆNH TỪ CONTROLLER QUA FIREBASE
// =========================================================================
function handleR5Command(data) {
    if (!data || !data.action) return;
    if (data.round && data.round !== 'R5' && data.action !== 'reset_graphic') return;

    if (data.timestamp && data.timestamp === lastProcessedCommandTs) return;
    if (data.timestamp) lastProcessedCommandTs = data.timestamp;

    switch (data.action) {
        case 'r5_show_question':
            showQuestionSimultaneously(data);
            break;

        case 'r5_hide_question':
            hideQuestionGraphics();
            break;

        case 'r5_update_players':
            if (Array.isArray(data.players)) lsR5State.players = data.players;
            if (data.buzzedIndex !== undefined) lsR5State.buzzedIndex = data.buzzedIndex;
            renderLivestreamPlayers();
            break;

        case 'r5_start_timer':
            start15sMedia();
            break;

        case 'r5_pause_timer':
            pause15sMedia();
            break;

        case 'r5_resume_timer':
            resume15sMedia();
            break;

        case 'r5_stop_timer':
            stopAndHide15sMedia();
            break;

        case 'r5_time_up':
            break;

        case 'r5_buzz':
            setTimeout(() => {
                pause15sMedia();
            }, 200);
            if (Array.isArray(data.players)) lsR5State.players = data.players;
            lsR5State.buzzedIndex = typeof data.playerIndex === 'number' ? data.playerIndex : null;
            renderLivestreamPlayers();
            break;

        case 'r5_clear_buzz':
        case 'r5_wrong_resume':
            // Thí sinh sai hoặc reset chuông: chỉ trả nền về r5_player.png, không ẩn/làm mờ thí sinh
            lsR5State.buzzedIndex = null;
            if (Array.isArray(data.players)) lsR5State.players = data.players;
            renderLivestreamPlayers();
            if (data.resumeTimer) {
                resume15sMedia();
            }
            break;

        case 'r5_all_wrong':
            // Tất cả trả lời sai: chỉ reset nền chuông và dừng đồng hồ 15s
            lsR5State.buzzedIndex = null;
            if (Array.isArray(data.players)) lsR5State.players = data.players;
            stopAndHide15sMedia();
            renderLivestreamPlayers();
            break;

        case 'r5_win':
            lsR5State.buzzedIndex = null;
            if (Array.isArray(data.players)) lsR5State.players = data.players;
            stopAndHide15sMedia();
            renderLivestreamPlayers();
            break;

        case 'r5_reset_question':
        case 'reset_graphic':
            resetAllR5Graphics();
            break;

        default:
            break;
    }
}

// =========================================================================
// 5. KHỞI TẠO & LẮNG NGHE REALTIME
// =========================================================================
function initRound5Livestream() {
    preloadPlayerBarGraphics();
    ensure15sAudioFallback();

    const overlay = els.buzzerOverlay();
    if (overlay) overlay.style.display = 'none';

    const root = els.root();
    if (root) root.style.display = 'block';

    const unsubInitialState = onValue(ref(db, 'games/r5_state'), (snapshot) => {
        if (!snapshot.exists()) return;
        const st = snapshot.val();
        if (Array.isArray(st.players) && st.players.length > 0) {
            lsR5State.players = st.players;
        }
        lsR5State.buzzedIndex = typeof st.buzzedIndex === 'number' ? st.buzzedIndex : null;

        if (st.isQuestionShown) {
            showQuestionSimultaneously({
                questionText: st.questionText || '',
                players: lsR5State.players,
                buzzedIndex: lsR5State.buzzedIndex
            });
        }
    }, { onlyOnce: true });

    let isInitialCmd = true;
    const unsubCommands = onValue(ref(db, 'games/commands'), (snapshot) => {
        if (isInitialCmd) {
            isInitialCmd = false;
            return;
        }
        if (!snapshot.exists()) return;
        handleR5Command(snapshot.val());
    });

    unsubscribers.push(unsubInitialState, unsubCommands);
}

initRound5Livestream();

window.cleanupCurrentRound = () => {
    resetAllR5Graphics();
    unsubscribers.forEach(fn => {
        try { fn(); } catch (e) {}
    });
    unsubscribers.length = 0;
};