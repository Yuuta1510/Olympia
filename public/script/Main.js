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

// =========================================================================
// 1. KHỞI TẠO CÁC THẺ VIDEO INTRO & LOWERTHIRD TRÊN LIVESTREAM
// =========================================================================
function initMainLivestreamDOM() {
    let root = document.getElementById('mainGraphicRoot');
    if (!root) {
        root = document.createElement('div');
        root.id = 'mainGraphicRoot';
        root.innerHTML = `
            <video id="mainIntroVideo" playsinline preload="auto"></video>
            <div id="mainLowerthirdGroup">
                <video id="mainLowerthirdVideo" playsinline preload="auto"></video>
                <div id="mainLowerthirdTexts"></div>
            </div>
        `;
        document.body.appendChild(root);

        const introVid = document.getElementById('mainIntroVideo');
        const ltVid = document.getElementById('mainLowerthirdVideo');

        setVideoSourceWithFallback(introVid, ['../graphic/intro.mp4', '../graphic/Intro.mp4', '/graphic/intro.mp4', 'graphic/intro.mp4', 'Graphic/Intro.mp4', 'Intro.mp4', 'Graphic/intro.mp4', 'intro.mp4']);
        setVideoSourceWithFallback(ltVid, ['../graphic/lowerthird.webm', '../graphic/Lowerthird.webm', '/graphic/lowerthird.webm', 'graphic/lowerthird.webm', 'Graphic/lowerthird.webm', 'lowerthird.webm', 'Graphic/Lowerthird.webm']);

        introVid.addEventListener('ended', () => {
            introVid.pause();
        });

        ltVid.addEventListener('ended', () => {
            ltVid.pause();
        });
    }
}

function setVideoSourceWithFallback(videoEl, srcList) {
    let idx = 0;
    videoEl.src = srcList[idx];
    videoEl.onerror = () => {
        idx++;
        if (idx < srcList.length) {
            videoEl.src = srcList[idx];
        }
    };
}

initMainLivestreamDOM();

// =========================================================================
// 2. HÀM VẼ VÀ ĐIỀU KHIỂN HIỆU ỨNG INTRO / LOWERTHIRD
// =========================================================================
let fadeOutTimeout = null;

function renderLivestreamLtTexts(textsArray) {
    const container = document.getElementById('mainLowerthirdTexts');
    if (!container) return;
    container.innerHTML = '';

    if (!Array.isArray(textsArray)) return;
    textsArray.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'livestream-lt-text-item';
        div.style.left = `${item.x}%`;
        div.style.top = `${item.y}%`;
        div.style.fontSize = `${item.size}vw`;
        div.textContent = item.content || '';
        container.appendChild(div);
    });
}

function playMainIntro() {
    const introVid = document.getElementById('mainIntroVideo');
    if (!introVid) return;
    introVid.style.display = 'block';
    introVid.currentTime = 0;
    introVid.play().catch(err => console.error("Lỗi phát Intro.mp4:", err));
}

function hideMainIntro() {
    const introVid = document.getElementById('mainIntroVideo');
    if (!introVid) return;
    introVid.style.display = 'none';
    introVid.pause();
    introVid.currentTime = 0;
}

function playMainLowerthird(textsArray) {
    const group = document.getElementById('mainLowerthirdGroup');
    const ltVid = document.getElementById('mainLowerthirdVideo');
    const textContainer = document.getElementById('mainLowerthirdTexts');
    if (!group || !ltVid || !textContainer) return;

    if (fadeOutTimeout) {
        clearTimeout(fadeOutTimeout);
        fadeOutTimeout = null;
    }

    renderLivestreamLtTexts(textsArray);

    // Gỡ bỏ class fade-out và xóa mọi inline opacity để không cản trở CSS Animation
    group.classList.remove('fade-out-15s');
    group.style.removeProperty('opacity');
    group.style.display = 'block';

    textContainer.classList.remove('fade-in-text');
    void textContainer.offsetWidth; // Force reflow để chạy lại animation
    textContainer.classList.add('fade-in-text');

    ltVid.currentTime = 0;
    ltVid.play().catch(err => console.error("Lỗi phát lowerthird.webm:", err));
}

function hideMainLowerthird() {
    const group = document.getElementById('mainLowerthirdGroup');
    const ltVid = document.getElementById('mainLowerthirdVideo');
    const textContainer = document.getElementById('mainLowerthirdTexts');
    if (!group) return;

    // Reset và kích hoạt animation fade out 1.5s mượt mà cho cả khối (Video + Text)
    group.style.removeProperty('opacity');
    group.classList.remove('fade-out-15s');
    void group.offsetWidth; // Force reflow
    group.classList.add('fade-out-15s');

    if (fadeOutTimeout) clearTimeout(fadeOutTimeout);
    fadeOutTimeout = setTimeout(() => {
        group.style.display = 'none';
        group.classList.remove('fade-out-15s');
        if (textContainer) textContainer.classList.remove('fade-in-text');
        if (ltVid) {
            ltVid.pause();
            ltVid.currentTime = 0;
        }
    }, 1500);
}

function resetAllMainGraphics() {
    if (fadeOutTimeout) {
        clearTimeout(fadeOutTimeout);
        fadeOutTimeout = null;
    }
    hideMainIntro();
    const group = document.getElementById('mainLowerthirdGroup');
    const ltVid = document.getElementById('mainLowerthirdVideo');
    const textContainer = document.getElementById('mainLowerthirdTexts');
    if (group) {
        group.style.display = 'none';
        group.classList.remove('fade-out-15s');
        group.style.removeProperty('opacity');
    }
    if (textContainer) textContainer.classList.remove('fade-in-text');
    if (ltVid) {
        ltVid.pause();
        ltVid.currentTime = 0;
    }
}

// =========================================================================
// 3. LẮNG NGHE LỆNH TỪ CONTROLLER QUA FIREBASE
// =========================================================================
let isInitialLoad = true;

if (typeof window.currentRoundUnsubscribe === 'function') {
    window.currentRoundUnsubscribe();
}

window.currentRoundUnsubscribe = onValue(ref(db, 'games/commands'), (snapshot) => {
    if (isInitialLoad) {
        isInitialLoad = false;
        return;
    }
    if (!snapshot.exists()) return;
    const data = snapshot.val();
    if (!data || !data.action) return;

    if (data.action === 'play_intro') {
        playMainIntro();
    } else if (data.action === 'hide_intro') {
        hideMainIntro();
    } else if (data.action === 'play_lowerthird') {
        playMainLowerthird(data.texts || []);
    } else if (data.action === 'update_lowerthird_texts') {
        renderLivestreamLtTexts(data.texts || []);
    } else if (data.action === 'hide_lowerthird') {
        hideMainLowerthird();
    } else if (data.action === 'reset_main_graphic' || data.action === 'reset_graphic') {
        resetAllMainGraphics();
    }
});