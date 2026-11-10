import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyD8kOt_miajR8UvjeRF6v9aYy-n1q4uCEE",
    authDomain: "olympia-d2f44.firebaseapp.com",
    databaseURL: "https://olympia-d2f44-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "olympia-d2f44",
    storageBucket: "olympia-d2f44.firebasestorage.app",
    messagingSenderId: "18063059793",
    appId: "1:18063059793:web:5dad7ce59006e779988170",
    measurementId: "G-XVER3NDTXY"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getDatabase(app);

let globalPlayers = {};
let lr_config = { so_luot: 4, so_cau: 6 };
let lc_configs = [{ so_cau: 12 }];

onValue(ref(db, 'games/players'), (snapshot) => {
    if (snapshot.exists()) globalPlayers = snapshot.val();
});

onValue(ref(db, 'games/round_1'), (snapshot) => {
    if (snapshot.exists()) {
        const data = snapshot.val();
        if (data.luot_rieng) lr_config = data.luot_rieng;
        if (data.luot_chung) {
            lc_configs = Array.isArray(data.luot_chung) ? data.luot_chung : [data.luot_chung];
        }
    }
});

function updateProjectorInfo(quesIndex) {
    const turnNameEl = document.getElementById('projTurnName');
    const countBoxEl = document.getElementById('projQuestionCount');
    const countNumEl = document.getElementById('countNumber');

    if (!turnNameEl || !countBoxEl || !countNumEl) return;

    if (!quesIndex) {
        turnNameEl.style.display = 'none';
        countBoxEl.style.display = 'none';
        return;
    }

    let LR_Count = parseInt(lr_config.so_luot) || 4;
    let A = parseInt(lr_config.so_cau) || 0;

    let turnName = "";
    let relativeQues = 0;
    let totalTurnQues = 0;

    if (A > 0 && LR_Count > 0 && quesIndex <= (LR_Count * A)) {
        let playerIndex = Math.ceil(quesIndex / A);
        relativeQues = quesIndex - ((playerIndex - 1) * A);
        totalTurnQues = A;
        
        let pName = (globalPlayers && globalPlayers[playerIndex] && globalPlayers[playerIndex].name) 
                    ? globalPlayers[playerIndex].name 
                    : `THÍ SINH ${playerIndex}`;
        turnName = `KHỞI ĐỘNG RIÊNG - ${pName.toUpperCase()}`;
    } else if (lc_configs && lc_configs.length > 0) {
        let remainingIndex = quesIndex - ((A > 0 && LR_Count > 0) ? (LR_Count * A) : 0);
        let foundLC = false;
        for (let i = 0; i < lc_configs.length; i++) {
            let B = parseInt(lc_configs[i].so_cau) || 0;
            if (B > 0 && remainingIndex <= B) {
                turnName = `KHỞI ĐỘNG CHUNG`;
                relativeQues = remainingIndex;
                totalTurnQues = B;
                foundLC = true;
                break;
            } else {
                remainingIndex -= B;
            }
        }
        if (!foundLC) {
            turnName = `KHỞI ĐỘNG CHUNG`;
            relativeQues = 0;
            totalTurnQues = 0;
        }
    } else {
        turnName = `KHỞI ĐỘNG CHUNG`;
        relativeQues = 0;
        totalTurnQues = 0;
    }

    turnNameEl.textContent = turnName;
    countNumEl.textContent = `${relativeQues}/${totalTurnQues}`;

    turnNameEl.style.display = 'block';
    countBoxEl.style.display = 'flex';
}

function hideProjectorInfo() {
    const turnNameEl = document.getElementById('projTurnName');
    const countBoxEl = document.getElementById('projQuestionCount');
    if (turnNameEl) turnNameEl.style.display = 'none';
    if (countBoxEl) countBoxEl.style.display = 'none';
}

function compressText(elementId, maxWidth, align) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (align === 'left') {
        el.style.alignSelf = 'flex-start';
        el.style.transformOrigin = 'left';
    } else if (align === 'right') {
        el.style.alignSelf = 'flex-end';
        el.style.transformOrigin = 'right';
    } else { 
        el.style.alignSelf = 'center';
        el.style.transformOrigin = 'center';
    }
    el.style.transform = 'none';
    const originalWidth = el.scrollWidth;
    if (originalWidth >= maxWidth) {
        const scaleRatio = maxWidth / originalWidth;
        el.style.transform = `scaleX(${scaleRatio})`;
    }
}

async function drawAllPlayers(playersData) {
    const container = document.getElementById('playerContainer');
    container.style.display = 'block'; // Đổi từ 'flex' sang 'block'
    
    if (playersData) {
        const existingPlayers = container.querySelectorAll('.player');
        if (existingPlayers.length > 0) {
            for (const [stt, player] of Object.entries(playersData)) {
                if (!player) continue;
                const nameEl = document.getElementById(`player-name-${stt}`);
                const scoreEl = document.getElementById(`player-score-${stt}`);
                if (nameEl) nameEl.textContent = `${stt}. ${player.name || ""}`;
                if (scoreEl) scoreEl.textContent = player.score || 0;
                compressText(`player-name-${stt}`, 190, 'left');
            }
            return; 
        }

        container.innerHTML = '<div id="active-bg"></div>';
        for (const [stt, player] of Object.entries(playersData)) {
            if (!player) continue;
            const row = document.createElement('div');
            // Gán thêm class định vị riêng cho từng thí sinh (player-pos-1, player-pos-2, ...)
            row.className = `player player-pos-${stt}`;

            const nameEl = document.createElement('div');
            nameEl.className = 'player-name';
            nameEl.id = `player-name-${stt}`;
            nameEl.textContent = `${stt}. ${player.name || ""}`;
            
            const scoreEl = document.createElement('div');
            scoreEl.className = 'player-score';
            scoreEl.id = `player-score-${stt}`; 
            scoreEl.textContent = player.score || 0;

            row.appendChild(nameEl);
            row.appendChild(scoreEl);
            container.appendChild(row);
            compressText(`player-name-${stt}`, 190, 'left');
        }
    } else {
        container.innerHTML = "";
    }
}

function activePlayer(index) {
    const bg = document.getElementById('active-bg');
    if (!bg) return;
    bg.style.opacity = '';
    if (index >= 1 && index <= 4) {
        bg.className = `pos-${index}`;
    } else {
        bg.className = '';
    }
}

function drawQuestion(textStr) {
    const textQues = document.getElementById('questionText');
    textQues.style.display = 'block';
    textQues.textContent = textStr;
}

let timer5sInterval = null;
let isInitialLoad = true;
let turnTimeAudio = document.getElementById('audio_r1_clock');
if (!turnTimeAudio) {
    turnTimeAudio = document.createElement('audio');
    turnTimeAudio.id = 'audio_r1_clock';
    turnTimeAudio.preload = 'auto';
    turnTimeAudio.style.display = 'none';
    document.body.appendChild(turnTimeAudio);
}

let currentVideoDuration = -1;

if (typeof window.currentRoundUnsubscribe === 'function') {
    window.currentRoundUnsubscribe();
}

window.currentRoundUnsubscribe = onValue(ref(db, 'games/commands'), async (snapshot) => {
    if (isInitialLoad) {
        isInitialLoad = false;
        return;
    }

    if (!snapshot.exists()) return;
    const data = snapshot.val();
    if (!data || !data.action) return;

    if (data.action === 'show_graphic') {
        const videoEl = document.getElementById('graphic_r1');
        if (videoEl) {
            // Tự động nhận diện nếu trang hiện tại là Projector
            const isProjector = window.location.pathname.toLowerCase().includes('projector') || 
                                document.title.toLowerCase().includes('projector');
            
            const fileNormal = isProjector ? '../graphic/KhoiDong_Proj.webm' : '../graphic/KhoiDong.webm';
            const fileTime   = isProjector ? '../graphic/KhoiDongTime_Proj.webm' : '../graphic/KhoiDongTime.webm';

            videoEl.src = data.isTimeLimited ? fileTime : fileNormal;
            videoEl.style.display = 'block';
            videoEl.currentTime = 0; 
            videoEl.play().catch(err => console.error("Lỗi phát video nền:", err));
        }
    } else if (data.action === 'hide_graphic') {
        const videoEl = document.getElementById('graphic_r1');
        const timeEl = document.getElementById('graphic_time');
        if (videoEl) {
            videoEl.style.display = 'none';
            videoEl.pause();
        }
        if (timeEl) {
            timeEl.style.display = 'none';
            timeEl.pause();
        }
    } else if (data.action === 'play_turn_time') {
        const timeEl = document.getElementById('graphic_time');
        const reqDuration = data.duration || 60; // Số giây cấu hình (ví dụ 90)

        // 1. Kiểm tra và tải nguồn Video & Audio mới nếu cần (Bóc tách độc lập)
        if (currentVideoDuration !== reqDuration) {
            currentVideoDuration = reqDuration;
            
            // Xử lý Video độc lập
            if (timeEl) {
                timeEl.src = `../graphic/${reqDuration}s.webm`;
                timeEl.playbackRate = 1.0; // Reset speed mặc định
                timeEl.onerror = () => {
                    console.warn(`Không tìm thấy video ${reqDuration}s.webm, Fallback về 60s.webm`);
                    timeEl.onerror = null; 
                    timeEl.src = `../graphic/60s.webm`;
                    timeEl.playbackRate = 60 / reqDuration;
                    if (!timeEl.paused || data.action === 'play_turn_time') timeEl.play().catch(e => console.error(e));
                };
            }
            
            // Xử lý Audio độc lập
            turnTimeAudio.src = `../sounds/R1_${reqDuration}s.mp3`;
            turnTimeAudio.playbackRate = 1.0; // Reset speed mặc định
            turnTimeAudio.onerror = () => {
                console.warn(`Không tìm thấy audio R1_${reqDuration}s.mp3, Fallback về R1_60s.mp3`);
                turnTimeAudio.onerror = null; 
                turnTimeAudio.src = `../sounds/R1_60s.mp3`;
                turnTimeAudio.playbackRate = 60 / reqDuration;
                if (!turnTimeAudio.paused || data.action === 'play_turn_time') turnTimeAudio.play().catch(e => console.error(e));
            };
        } else {
            // Nếu đã nạp file rồi, đảm bảo playbackRate được áp dụng đúng
            if (timeEl) timeEl.playbackRate = timeEl.src.includes('60s.webm') && reqDuration !== 60 ? 60 / reqDuration : 1.0;
            turnTimeAudio.playbackRate = turnTimeAudio.src.includes('60s.mp3') && reqDuration !== 60 ? 60 / reqDuration : 1.0;
        }
        
        // Nếu có cờ đếm lại từ đầu, ép thời gian của clock và nhạc về 0
        if (data.restart) {
            if (timeEl) timeEl.currentTime = 0;
            turnTimeAudio.currentTime = 0;
        }

        if (timeEl) {
            timeEl.style.display = 'block';
            if (timeEl.paused) {
                timeEl.play().catch(err => console.error("Lỗi phát time video:", err));
            }
        }
        
        if (turnTimeAudio.paused) {
            turnTimeAudio.play().catch(err => console.error("Lỗi phát nhạc turn time:", err));
        }
        
    } else if (data.action === 'pause_turn_time') {
        const timeEl = document.getElementById('graphic_time');
        if (timeEl && !timeEl.paused) {
            timeEl.pause();
        }
        if (!turnTimeAudio.paused) {
            turnTimeAudio.pause();
        }
        
    } else if (data.action === 'time_out') {
        const timeEl = document.getElementById('graphic_time');
        if (timeEl) {
            timeEl.pause();
        }
        
    } else if (data.action === 'stop_turn_time') {
        const timeEl = document.getElementById('graphic_time');
        if (timeEl) {
            timeEl.pause();
        }
    } else if (data.action === 'show_players') {
        await drawAllPlayers(data.players);
        activePlayer(0);
    } else if (data.action === 'hide_players') {
        const container = document.getElementById('playerContainer');
        if (container) container.style.display = 'none';
    } else if (data.action === 'active_player') {
        await drawAllPlayers(data.players);
        activePlayer(data.index); 
    } else if (data.action === 'show_question') {
        drawQuestion(data.text);
        if (data.quesIndex) {
            updateProjectorInfo(data.quesIndex);
        }
    } else if (data.action === 'hide_question') {
        const textQues = document.getElementById('questionText');
        if (textQues) textQues.style.display = 'none';
        hideProjectorInfo();
    } else if (data.action === 'reset_buzzers') {
        activePlayer(0);
    } else if (data.action === 'start_5s') {
        const timerBox = document.getElementById('timer5sBox');
        if (!timerBox) return;
        
        timerBox.style.display = 'flex';
        let timeLeft = 5;
        timerBox.textContent = timeLeft;
        
        if (timer5sInterval) clearInterval(timer5sInterval);
        timer5sInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft > 0) {
                timerBox.textContent = timeLeft;
            } else {
                timerBox.textContent = 0;
                clearInterval(timer5sInterval);
                setTimeout(() => { timerBox.style.display = 'none'; }, 1500); 
            }
        }, 1000);
    } else if (data.action === 'stop_5s') {
        const timerBox = document.getElementById('timer5sBox');
        if (timerBox) timerBox.style.display = 'none';
        if (timer5sInterval) clearInterval(timer5sInterval);
    } else if (data.action === 'reset_graphic') {
        hideProjectorInfo();
        const videoEl = document.getElementById('graphic_r1');
        const timeEl = document.getElementById('graphic_time');
        if (videoEl) {
            videoEl.style.display = 'none';
            videoEl.pause();
            videoEl.currentTime = 0;
        }
        if (timeEl) {
            timeEl.style.display = 'none';
            timeEl.pause();
            timeEl.currentTime = 0;
        }
        
        // Đảm bảo dọn dẹp âm thanh khi ấn Reset
        turnTimeAudio.pause();
        turnTimeAudio.currentTime = 0;
        
        document.getElementById('playerContainer').style.display = 'none';
        document.getElementById('questionText').style.display = 'none';
        
        const timerBox = document.getElementById('timer5sBox');
        if (timerBox) {
            timerBox.style.display = 'none';
            if (timer5sInterval) clearInterval(timer5sInterval);
        }
    }
});