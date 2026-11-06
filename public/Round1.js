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

// --- GIỮ NGUYÊN CÁC HÀM compressText, drawAllPlayers, activePlayer, drawQuestion CỦA BẠN Ở ĐÂY ---
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
    container.style.display = 'flex';
    
    if (playersData) {
        const existingPlayers = container.querySelectorAll('.player');
        if (existingPlayers.length > 0) {
            for (const [stt, player] of Object.entries(playersData)) {
                if (!player) continue;
                const nameEl = document.getElementById(`player-name-${stt}`);
                const scoreEl = document.getElementById(`player-score-${stt}`);
                if (nameEl) nameEl.textContent = `${stt}. ${player.name || ""}`;
                if (scoreEl) scoreEl.textContent = player.score || 0;
                compressText(`player-name-${stt}`, 200, 'left');
            }
            return; 
        }

        container.innerHTML = '<div id="active-bg"></div>';
        for (const [stt, player] of Object.entries(playersData)) {
            if (!player) continue;
            const row = document.createElement('div');
            row.className = 'player';

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
            compressText(`player-name-${stt}`, 200, 'left');
        }
    } else {
        container.innerHTML = "";
    }
}

function activePlayer(index) {
    const bg = document.getElementById('active-bg');
    const players = document.querySelectorAll('.player'); 
    const target = players[index - 1];
    if (bg && target) {
        bg.style.opacity = 1;
        bg.style.left = (target.offsetLeft - 9) + 'px';
        const totalPlayer = players.length;
        if(index === totalPlayer) {
            bg.classList.add('is-trapezoid');
        } else {
            bg.classList.remove('is-trapezoid'); 
        }
    }
}

function drawQuestion(textStr) {
    const textQues = document.getElementById('questionText');
    textQues.style.display = 'block';
    textQues.textContent = textStr;
}

let timer5sInterval = null;
let isInitialLoad = true;

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
            videoEl.style.display = 'block';
            videoEl.currentTime = 0; 
            videoEl.play().catch(err => console.error("Lỗi phát video:", err));
        }
    } else if (data.action === 'show_players') {
        await drawAllPlayers(data.players);
        const bg = document.getElementById('active-bg');
        if (bg) bg.style.opacity = 0; 
    } else if (data.action === 'active_player') {
        await drawAllPlayers(data.players);
        activePlayer(data.index); 
    } else if (data.action === 'show_question') {
        drawQuestion(data.text);
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
        const videoEl = document.getElementById('graphic_r1');
        if (videoEl) {
            videoEl.style.display = 'none';
            videoEl.pause();
            videoEl.currentTime = 0;
        }
        document.getElementById('playerContainer').style.display = 'none';
        document.getElementById('questionText').style.display = 'none';
        
        const timerBox = document.getElementById('timer5sBox');
        if (timerBox) {
            timerBox.style.display = 'none';
            if (timer5sInterval) clearInterval(timer5sInterval);
        }
    }
});