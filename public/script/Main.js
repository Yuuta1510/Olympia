import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

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

const DEFAULT_FONT = '"UTM Avo", Arial, sans-serif';
const VALID_PROJECTOR_BG_KEYS = ['R0', 'R1', 'R2', 'R3', 'R4'];

const LT1_SOURCES = [
    '../graphic/main_lowerthird.webm',
    '../graphic/main_lowerthird.webm',
    '/graphic/main_lowerthird.webm',
    'graphic/main_lowerthird.webm',
    'Graphic/main_lowerthird.webm',
    'main_lowerthird.webm',
    'main_lowerthird.webm'
];

const LT2_SOURCES = [
    '../graphic/main_credit.webm',
    '/graphic/main_credit.webm',
    'graphic/main_credit.webm',
    'Graphic/main_credit.webm',
    'main_credit.webm',
];

const LS_POINT_SUMMARY_SOURCES = [
    '../graphic/main_pointsummary.webm',
    '/graphic/main_pointsummary.webm',
    'graphic/main_pointsummary.webm',
    'Graphic/main_pointsummary.webm',
    'main_pointsummary.webm',
];

const PROJ_POINT_SUMMARY_SOURCES = [
    '../graphic/pro_main_pointsummary.webm',
    '/graphic/pro_main_pointsummary.webm',
    'graphic/pro_main_pointsummary.webm',
    'Graphic/pro_main_pointsummary.webm',
    'pro_main_pointsummary.webm',
];

const PROJ_TOTAL_SOURCES = [
    '../graphic/pro_main_total.webm',
    '/graphic/pro_main_total.webm',
    'graphic/pro_main_total.webm',
    'Graphic/pro_main_total.webm',
    'pro_main_total.webm',
    '../graphic/main_total.webm',
    '/graphic/main_total.webm',
    'graphic/main_total.webm',
    'Graphic/main_total.webm',
    'main_total.webm',
];

let currentActiveVideoType = 'lt1';
let activeTickerAnimations = [];
let fadeOutTimeout = null;
let currentProjectorBgKey = null;
let currentProjectorBgSignature = null;
let customGameThumbnails = {};

// Biến quản lý Tổng kết điểm
let cachedPlayers = {};
let psFadeInTimer = null;
let psFadeOutTimer = null;

function isProjectorScreen() {
    return Boolean(document.getElementById('projector-bg'));
}

// =========================================================================
// 1. KHỞI TẠO NGUỒN MEDIA CHO INTRO, LOWERTHIRD, NỀN PROJECTOR & TỔNG KẾT ĐIỂM
// =========================================================================
function setProjectorThumbnail(bgKey = 'R0', forceRefresh = false) {
    if (!isProjectorScreen()) return;
    const normalizedKey = VALID_PROJECTOR_BG_KEYS.includes(String(bgKey).toUpperCase())
        ? String(bgKey).toUpperCase()
        : 'R0';

    const bgLayer = document.getElementById('projMainBgLayer');
    const imgEl = document.getElementById('projMainThumbnailImg');
    if (!bgLayer || !imgEl) return;

    bgLayer.style.display = 'block';

    const customUrl = customGameThumbnails && customGameThumbnails[normalizedKey]
        ? String(customGameThumbnails[normalizedKey]).trim()
        : '';
    const nextSignature = `${normalizedKey}::${customUrl}`;

    if (!forceRefresh && currentProjectorBgSignature === nextSignature && imgEl.getAttribute('src')) {
        return;
    }
    currentProjectorBgKey = normalizedKey;
    currentProjectorBgSignature = nextSignature;

    const kUpper = normalizedKey;
    const kLower = normalizedKey.toLowerCase();
    const localSources = [
        `../graphic/${kUpper}_thumbnail.png`,
        `../graphic/${kLower}_thumbnail.png`,
        `/graphic/${kUpper}_thumbnail.png`,
        `graphic/${kUpper}_thumbnail.png`,
        `Graphic/${kUpper}_thumbnail.png`,
        `${kUpper}_thumbnail.png`,
        `${kLower}_thumbnail.png`
    ];
    const sources = customUrl ? [customUrl, ...localSources] : localSources;

    let idx = 0;
    imgEl.src = sources[idx];
    imgEl.onerror = () => {
        idx++;
        if (idx < sources.length) {
            imgEl.src = sources[idx];
        } else {
            imgEl.onerror = null;
        }
    };
}

function initMainLivestreamDOM() {
    const onProjector = isProjectorScreen();

    // Đảm bảo trên màn Livestream không bao giờ tồn tại video Intro của phần Main
    if (!onProjector) {
        const strayIntro = document.getElementById('mainIntroVideo');
        if (strayIntro) strayIntro.remove();
    }

    const root = document.getElementById('mainGraphicRoot');
    if (!root) return;

    const introVid = document.getElementById('mainIntroVideo');
    const ltVid = document.getElementById('mainLowerthirdVideo');
    const lsPsVid = document.getElementById('lsPointSummaryVideo');
    const projPsVid = document.getElementById('projPointSummaryVideo');
    const projTotalVid = document.getElementById('projTotalVideo');

    // Chỉ nạp và chạy Intro Main ở màn Projector; chạy xong video tự động ẩn đi
    if (onProjector && introVid) {
        setVideoSourceWithFallback(introVid, [
            '../graphic/intro.webm',
            '../graphic/Intro.webm',
            '/graphic/intro.webm',
            'graphic/intro.webm',
            'Graphic/Intro.webm',
            'Intro.webm',
            'Graphic/intro.webm',
            'intro.webm'
        ]);
        if (!introVid.dataset.mainEndedBound) {
            introVid.dataset.mainEndedBound = 'true';
            introVid.addEventListener('ended', () => {
                hideMainIntro();
            });
        }
        set(ref(db, 'games/main_intro_status'), false);
    }

    if (ltVid) {
        setVideoSourceWithFallback(ltVid, LT1_SOURCES);
        if (!ltVid.dataset.mainEndedBound) {
            ltVid.dataset.mainEndedBound = 'true';
            ltVid.addEventListener('ended', () => ltVid.pause());
        }
    }

    if (lsPsVid) {
        setVideoSourceWithFallback(lsPsVid, LS_POINT_SUMMARY_SOURCES);
        if (!lsPsVid.dataset.mainEndedBound) {
            lsPsVid.dataset.mainEndedBound = 'true';
            lsPsVid.addEventListener('ended', () => lsPsVid.pause());
        }
    }

    if (projPsVid) {
        setVideoSourceWithFallback(projPsVid, PROJ_POINT_SUMMARY_SOURCES);
        if (!projPsVid.dataset.mainEndedBound) {
            projPsVid.dataset.mainEndedBound = 'true';
            projPsVid.addEventListener('ended', () => projPsVid.pause());
        }
    }

    if (projTotalVid) {
        setVideoSourceWithFallback(projTotalVid, PROJ_TOTAL_SOURCES);
        if (!projTotalVid.dataset.mainEndedBound) {
            projTotalVid.dataset.mainEndedBound = 'true';
            projTotalVid.addEventListener('ended', () => projTotalVid.pause());
        }
    }

    if (onProjector) {
        setProjectorThumbnail('R0');
    }
}

function setVideoSourceWithFallback(videoEl, srcList, onReadyCallback) {
    if (!videoEl) return;
    let idx = 0;
    videoEl.src = srcList[idx];
    videoEl.onerror = () => {
        idx++;
        if (idx < srcList.length) {
            videoEl.src = srcList[idx];
        }
    };
    if (typeof onReadyCallback === 'function') {
        videoEl.onloadeddata = () => {
            videoEl.onloadeddata = null;
            onReadyCallback();
        };
    }
}

function seekVideoToLastFrame(videoEl, onReady) {
    if (!videoEl) return;

    const finishSeek = () => {
        if (typeof onReady === 'function') onReady();
    };

    const applyLastFrame = () => {
        videoEl.pause();
        if (videoEl.duration && isFinite(videoEl.duration)) {
            const targetTime = Math.max(0, videoEl.duration - 0.05);
            if (Math.abs(videoEl.currentTime - targetTime) < 0.01 && !videoEl.seeking && videoEl.readyState >= 2) {
                finishSeek();
            } else {
                let done = false;
                const handleDone = () => {
                    if (done) return;
                    done = true;
                    finishSeek();
                };
                videoEl.addEventListener('seeked', handleDone, { once: true });
                videoEl.currentTime = targetTime;
                setTimeout(handleDone, 350); // Dự phòng nếu trình duyệt không bắn seeked
            }
        } else {
            finishSeek();
        }
    };

    if (videoEl.readyState >= 1 && videoEl.duration && isFinite(videoEl.duration)) {
        applyLastFrame();
    } else {
        videoEl.addEventListener('loadedmetadata', applyLastFrame, { once: true });
        videoEl.load();
    }
}

function setImageSourceWithFallback(imgEl, playerIndex, customAvatarUrl = '') {
    if (!imgEl) return;
    const resolvedCustomUrl = String(
        customAvatarUrl || cachedPlayers?.[playerIndex]?.avatarUrl || ''
    ).trim();

    const localSources = [
        `../graphic/main_player${playerIndex}.png`,
        `../graphic/main_player${playerIndex}.png`,
        `/graphic/main_player${playerIndex}.png`,
        `graphic/main_player${playerIndex}.png`,
        `Graphic/main_player${playerIndex}.png`,
        `main_player${playerIndex}.png`,
        `main_player${playerIndex}.png`
    ];
    const sources = resolvedCustomUrl ? [resolvedCustomUrl, ...localSources] : localSources;

    let idx = 0;
    imgEl.classList.remove('is-hidden');
    imgEl.src = sources[idx];
    imgEl.onerror = () => {
        idx++;
        if (idx < sources.length) {
            imgEl.src = sources[idx];
        } else {
            imgEl.onerror = null;
            imgEl.classList.add('is-hidden');
        }
    };
}

function setFitTextContent(containerEl, value) {
    if (!containerEl) return;
    let inner = containerEl.querySelector('.fit-text-inner');
    if (!inner) {
        inner = document.createElement('span');
        inner.className = 'fit-text-inner';
        containerEl.textContent = '';
        containerEl.appendChild(inner);
    }
    inner.textContent = (value !== undefined && value !== null) ? String(value) : '';
    fitHorizontalText(containerEl);
}

function fitHorizontalText(containerEl) {
    if (!containerEl) return;
    const inner = containerEl.querySelector('.fit-text-inner');
    if (!inner) return;

    inner.style.transform = 'none';

    const style = window.getComputedStyle(containerEl);
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;
    const maxWidth = containerEl.clientWidth - padLeft - padRight;
    const textWidth = inner.offsetWidth;

    if (textWidth > maxWidth && maxWidth > 0) {
        const ratio = maxWidth / textWidth;
        inner.style.transform = `scaleX(${ratio})`;
    }
}

function refitAllVisiblePointSummaryTexts() {
    fitHorizontalText(document.getElementById('lsPointSummaryName'));
    fitHorizontalText(document.getElementById('lsPointSummaryScore'));
    fitHorizontalText(document.getElementById('projPointSummaryName'));
    fitHorizontalText(document.getElementById('projPointSummaryScore'));
    for (let i = 1; i <= 4; i++) {
        fitHorizontalText(document.getElementById(`projTotalName-${i}`));
        fitHorizontalText(document.getElementById(`projTotalScore-${i}`));
    }
}

initMainLivestreamDOM();

if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => refitAllVisiblePointSummaryTexts());
}
window.addEventListener('resize', refitAllVisiblePointSummaryTexts);

// =========================================================================
// 2. HÀM VẼ VÀ ĐIỀU KHIỂN HIỆU ỨNG INTRO / LOWERTHIRD
// =========================================================================
function escapeHTML(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function sanitizeRichHTML(rawHtml) {
    const temp = document.createElement('div');
    temp.innerHTML = rawHtml || '';

    function cleanNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return document.createTextNode(node.textContent);
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return document.createDocumentFragment();
        }

        const tag = node.tagName.toLowerCase();
        if (tag === 'br') {
            return document.createElement('br');
        }

        const span = document.createElement('span');
        if (tag === 'b' || tag === 'strong') span.style.fontWeight = 'bold';
        if (tag === 'i' || tag === 'em') span.style.fontStyle = 'italic';

        if (node.style) {
            if (node.style.fontFamily) span.style.fontFamily = node.style.fontFamily;
            if (node.style.fontWeight) span.style.fontWeight = node.style.fontWeight;
            if (node.style.fontStyle) span.style.fontStyle = node.style.fontStyle;
        }
        if (tag === 'font' && node.getAttribute('face')) {
            span.style.fontFamily = node.getAttribute('face');
        }

        const frag = document.createDocumentFragment();
        const isBlock = (tag === 'div' || tag === 'p');
        if (isBlock && node.previousSibling) {
            frag.appendChild(document.createElement('br'));
        }

        const hasStyle = Boolean(span.style.fontFamily || span.style.fontWeight || span.style.fontStyle);
        const target = hasStyle ? span : frag;

        Array.from(node.childNodes).forEach(child => {
            target.appendChild(cleanNode(child));
        });

        if (hasStyle) {
            frag.appendChild(span);
        }
        return frag;
    }

    const out = document.createElement('div');
    Array.from(temp.childNodes).forEach(child => {
        out.appendChild(cleanNode(child));
    });
    return out.innerHTML;
}

function getItemRichHTML(item) {
    if (item.html !== undefined && item.html !== null) {
        return sanitizeRichHTML(item.html);
    }
    return escapeHTML(item.content || '').replace(/\r?\n/g, '<br>');
}

function applyTypography(el, item) {
    el.style.fontFamily = item.fontFamily || DEFAULT_FONT;
    el.style.fontWeight = item.bold !== false ? 'bold' : 'normal';
    el.style.fontStyle = item.italic ? 'italic' : 'normal';
    el.style.fontSize = `${item.size}vw`;
}

function clearTickerAnimations() {
    activeTickerAnimations.forEach(anim => {
        try { anim.cancel(); } catch (e) {}
    });
    activeTickerAnimations = [];
}

function renderStandardLtTexts(textsArray) {
    const container = document.getElementById('mainLowerthirdTexts');
    const tickerViewport = document.getElementById('mainLowerthirdTickerViewport');
    if (!container) return;

    clearTickerAnimations();
    if (tickerViewport) {
        tickerViewport.style.display = 'none';
        tickerViewport.innerHTML = '';
    }

    container.style.display = 'block';
    container.innerHTML = '';

    if (!Array.isArray(textsArray)) return;
    textsArray.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'livestream-lt-text-item';
        div.style.left = `${item.x}%`;
        div.style.top = `${item.y}%`;
        applyTypography(div, item);
        div.innerHTML = getItemRichHTML(item);
        container.appendChild(div);
    });
}

function renderTickerLtTexts(textsArray, clipLeft = 15, tickerSpeed = 12) {
    const standardContainer = document.getElementById('mainLowerthirdTexts');
    const tickerViewport = document.getElementById('mainLowerthirdTickerViewport');
    if (!tickerViewport) return;

    clearTickerAnimations();
    if (standardContainer) {
        standardContainer.style.display = 'none';
        standardContainer.classList.remove('fade-in-text');
        standardContainer.innerHTML = '';
    }

    const safeClipLeft = Math.max(0, Math.min(85, Number(clipLeft) || 0));
    const safeSpeed = Math.max(2, Math.min(40, Number(tickerSpeed) || 12));

    tickerViewport.style.left = `${safeClipLeft}%`;
    tickerViewport.style.display = 'block';
    tickerViewport.innerHTML = '';

    if (!Array.isArray(textsArray) || textsArray.length === 0) return;

    const viewportWidth = window.innerWidth * ((100 - safeClipLeft) / 100);
    const pxPerSec = (safeSpeed / 100) * window.innerWidth;

    textsArray.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'livestream-lt-ticker-item';
        div.style.top = `${item.y}%`;
        applyTypography(div, item);

        const richHtml = getItemRichHTML(item).replace(/(<br\s*\/?>)+/gi, ' &nbsp;•&nbsp; ');
        div.innerHTML = richHtml;
        div.style.transform = `translate3d(${viewportWidth}px, 0, 0)`;
        tickerViewport.appendChild(div);

        const textWidth = div.offsetWidth;
        const totalDistance = viewportWidth + textWidth;
        const durationMs = Math.max(1500, (totalDistance / pxPerSec) * 1000);

        const anim = div.animate(
            [
                { transform: `translate3d(${viewportWidth}px, 0, 0)` },
                { transform: `translate3d(-${textWidth}px, 0, 0)` }
            ],
            {
                duration: durationMs,
                delay: 400,
                easing: 'linear',
                iterations: Infinity
            }
        );

        activeTickerAnimations.push(anim);
    });
}

function playMainIntro() {
    // Bỏ hoàn toàn Intro của phần Main tại màn Livestream, chỉ chạy ở Projector
    if (!isProjectorScreen()) return;

    const introVid = document.getElementById('mainIntroVideo');
    if (!introVid) return;

    introVid.style.display = 'block';
    introVid.currentTime = 0;
    introVid.muted = false;

    const onPlaySuccess = () => {
        set(ref(db, 'games/main_intro_status'), true);
    };

    introVid.play()
        .then(onPlaySuccess)
        .catch(err => {
            if (err && err.name === 'NotAllowedError') {
                // Nếu trình duyệt chặn autoplay có tiếng trên Projector, tự động mute để video vẫn phát và tự ẩn khi xong
                introVid.muted = true;
                introVid.play()
                    .then(onPlaySuccess)
                    .catch(err2 => {
                        console.error("Lỗi phát Intro.webm:", err2);
                        hideMainIntro();
                    });
            } else {
                console.error("Lỗi phát Intro.webm:", err);
                hideMainIntro();
            }
        });
}

function hideMainIntro() {
    const introVid = document.getElementById('mainIntroVideo');
    if (introVid) {
        introVid.pause();
        introVid.currentTime = 0;
        introVid.style.display = 'none';
    }
    if (isProjectorScreen()) {
        set(ref(db, 'games/main_intro_status'), false);
    }
}

function playMainLowerthird(payload) {
    // Màn Projector không hiện lowerthird (đã hỗ trợ riêng trên màn Livestream)
    if (isProjectorScreen()) return;

    const group = document.getElementById('mainLowerthirdGroup');
    const ltVid = document.getElementById('mainLowerthirdVideo');
    const textContainer = document.getElementById('mainLowerthirdTexts');
    if (!group || !ltVid || !textContainer) return;

    if (fadeOutTimeout) {
        clearTimeout(fadeOutTimeout);
        fadeOutTimeout = null;
    }

    const videoType = payload?.videoType === 'lt2' ? 'lt2' : 'lt1';
    const textsArray = Array.isArray(payload?.texts) ? payload.texts : (Array.isArray(payload) ? payload : []);
    const clipLeft = payload?.clipLeft !== undefined ? payload.clipLeft : 15;
    const tickerSpeed = payload?.tickerSpeed !== undefined ? payload.tickerSpeed : 12;

    const prevVideoType = currentActiveVideoType;
    currentActiveVideoType = videoType;

    group.classList.remove('fade-out-15s');
    group.style.removeProperty('opacity');
    group.style.display = 'block';

    if (videoType === 'lt2') {
        renderTickerLtTexts(textsArray, clipLeft, tickerSpeed);
    } else {
        renderStandardLtTexts(textsArray);
        textContainer.classList.remove('fade-in-text');
        void textContainer.offsetWidth;
        textContainer.classList.add('fade-in-text');
    }

    const startPlayback = () => {
        ltVid.currentTime = 0;
        ltVid.play().catch(err => console.error(`Lỗi phát ${videoType}:`, err));
    };

    if (prevVideoType !== videoType || !ltVid.src) {
        const sources = videoType === 'lt2' ? LT2_SOURCES : LT1_SOURCES;
        setVideoSourceWithFallback(ltVid, sources, startPlayback);
    } else {
        startPlayback();
    }
}

function updateMainLowerthirdLive(payload) {
    if (isProjectorScreen()) return;

    const videoType = payload?.videoType === 'lt2' ? 'lt2' : 'lt1';
    if (videoType !== currentActiveVideoType) {
        playMainLowerthird(payload);
        return;
    }

    const textsArray = Array.isArray(payload?.texts) ? payload.texts : [];
    if (videoType === 'lt2') {
        renderTickerLtTexts(textsArray, payload?.clipLeft ?? 15, payload?.tickerSpeed ?? 12);
    } else {
        renderStandardLtTexts(textsArray);
    }
}

function hideMainLowerthird() {
    if (isProjectorScreen()) return;

    const group = document.getElementById('mainLowerthirdGroup');
    const ltVid = document.getElementById('mainLowerthirdVideo');
    const textContainer = document.getElementById('mainLowerthirdTexts');
    const tickerViewport = document.getElementById('mainLowerthirdTickerViewport');
    if (!group) return;

    group.style.removeProperty('opacity');
    group.classList.remove('fade-out-15s');
    void group.offsetWidth;
    group.classList.add('fade-out-15s');

    if (fadeOutTimeout) clearTimeout(fadeOutTimeout);
    fadeOutTimeout = setTimeout(() => {
        clearTickerAnimations();
        group.style.display = 'none';
        group.classList.remove('fade-out-15s');
        if (textContainer) textContainer.classList.remove('fade-in-text');
        if (tickerViewport) {
            tickerViewport.style.display = 'none';
            tickerViewport.innerHTML = '';
        }
        if (ltVid) {
            ltVid.pause();
            ltVid.currentTime = 0;
        }
    }, 1500);
}

// =========================================================================
// 3. ĐIỀU KHIỂN TỔNG KẾT ĐIỂM & KẾT QUẢ TRẬN ĐẤU (LIVESTREAM & PROJECTOR)
// =========================================================================
function getOrderedPlayersList(rawPlayers) {
    const source = (Array.isArray(rawPlayers) && rawPlayers.length >= 4) ? null : (rawPlayers || cachedPlayers);
    if (Array.isArray(rawPlayers) && rawPlayers.length >= 4) {
        return rawPlayers.slice(0, 4).map((p, idx) => {
            const pIdx = p?.index || (idx + 1);
            return {
                index: pIdx,
                name: (p?.name && String(p.name).trim() !== '') ? String(p.name) : `PLAYER ${pIdx}`,
                score: Number(p?.score) || 0,
                avatarUrl: p?.avatarUrl || cachedPlayers?.[pIdx]?.avatarUrl || ''
            };
        });
    }
    const list = [];
    for (let i = 1; i <= 4; i++) {
        const p = (source && source[i]) ? source[i] : {};
        list.push({
            index: i,
            name: (p.name && String(p.name).trim() !== '') ? String(p.name) : `PLAYER ${i}`,
            score: Number(p.score) || 0,
            avatarUrl: p.avatarUrl || ''
        });
    }
    return list;
}

function getSortedPlayersList(rawSorted, rawPlayers) {
    if (Array.isArray(rawSorted) && rawSorted.length >= 4) {
        return rawSorted.slice(0, 4);
    }
    const list = getOrderedPlayersList(rawPlayers);
    list.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.index - b.index;
    });
    return list;
}

function clearPointSummaryTimers() {
    if (psFadeInTimer) {
        clearTimeout(psFadeInTimer);
        psFadeInTimer = null;
    }
    if (psFadeOutTimer) {
        clearTimeout(psFadeOutTimer);
        psFadeOutTimer = null;
    }
}

function hideLivestreamPointSummaryImmediate() {
    const group = document.getElementById('lsPointSummaryGroup');
    const vid = document.getElementById('lsPointSummaryVideo');
    const textWrap = document.getElementById('lsPointSummaryTextWrap');
    if (group) {
        group.classList.remove('is-visible', 'is-fading-out');
    }
    if (textWrap) {
        textWrap.classList.remove('is-instant-visible', 'is-fading-in');
    }
    if (vid) {
        vid.pause();
        vid.currentTime = 0;
    }
}

function hideProjectorPointSummaryImmediate() {
    const psGroup = document.getElementById('projPointSummaryGroup');
    const psVid = document.getElementById('projPointSummaryVideo');
    const psTextWrap = document.getElementById('projPointSummaryTextWrap');
    const totalGroup = document.getElementById('projTotalGroup');
    const totalVid = document.getElementById('projTotalVideo');

    if (psGroup) {
        psGroup.classList.remove('is-visible', 'is-fading-out');
    }
    if (psTextWrap) {
        psTextWrap.classList.remove('is-instant-visible', 'is-fading-in');
    }
    if (psVid) {
        psVid.pause();
        psVid.currentTime = 0;
    }
    if (totalGroup) {
        delete totalGroup.dataset.pendingShow;
        totalGroup.classList.remove('is-preparing', 'is-fading-in', 'is-instant-visible');
    }
    if (totalVid) {
        totalVid.pause();
        totalVid.currentTime = 0;
    }
}

function handlePointSummaryCommand(data) {
    const step = Number(data?.step) || 0;
    const sortedPlayers = getSortedPlayersList(data?.sortedPlayers, data?.players);
    const orderedPlayers = getOrderedPlayersList(data?.players);

    clearPointSummaryTimers();

    if (!isProjectorScreen()) {
        // =================================================================
        // MÀN HÌNH LIVESTREAM
        // =================================================================
        const group = document.getElementById('lsPointSummaryGroup');
        const vid = document.getElementById('lsPointSummaryVideo');
        const textWrap = document.getElementById('lsPointSummaryTextWrap');
        const nameEl = document.getElementById('lsPointSummaryName');
        const scoreEl = document.getElementById('lsPointSummaryScore');
        if (!group || !vid || !textWrap || !nameEl || !scoreEl) return;

        if (step === 1) {
            const p = sortedPlayers[0];
            group.classList.remove('is-fading-out');
            group.classList.add('is-visible');

            textWrap.classList.remove('is-instant-visible', 'is-fading-in');
            setFitTextContent(nameEl, p.name);
            setFitTextContent(scoreEl, p.score);

            vid.currentTime = 0;
            vid.play().catch(err => console.error("Lỗi phát PointSummary.webm:", err));

            psFadeInTimer = setTimeout(() => {
                void textWrap.offsetWidth;
                textWrap.classList.add('is-fading-in');
            }, 1000);

        } else if (step >= 2 && step <= 4) {
            const p = sortedPlayers[step - 1];
            group.classList.remove('is-fading-out');
            group.classList.add('is-visible');

            textWrap.classList.remove('is-fading-in');
            textWrap.classList.add('is-instant-visible');
            setFitTextContent(nameEl, p.name);
            setFitTextContent(scoreEl, p.score);

        } else if (step === 5) {
            group.classList.add('is-visible');
            void group.offsetWidth;
            group.classList.remove('is-visible');
            group.classList.add('is-fading-out');

            psFadeOutTimer = setTimeout(() => {
                hideLivestreamPointSummaryImmediate();
            }, 1000);

        } else if (step >= 6) {
            hideLivestreamPointSummaryImmediate();
        }

    } else {
        // =================================================================
        // MÀN HÌNH PROJECTOR
        // =================================================================
        const psGroup = document.getElementById('projPointSummaryGroup');
        const psVid = document.getElementById('projPointSummaryVideo');
        const psTextWrap = document.getElementById('projPointSummaryTextWrap');
        const psNameEl = document.getElementById('projPointSummaryName');
        const psScoreEl = document.getElementById('projPointSummaryScore');
        const totalGroup = document.getElementById('projTotalGroup');
        const totalVid = document.getElementById('projTotalVideo');
        if (!psGroup || !psVid || !psTextWrap || !psNameEl || !psScoreEl || !totalGroup || !totalVid) return;

        if (step === 1) {
            totalGroup.classList.remove('is-preparing', 'is-fading-in', 'is-instant-visible');
            totalVid.pause();
            totalVid.currentTime = 0;

            const p = sortedPlayers[0];
            psGroup.classList.remove('is-fading-out');
            psGroup.classList.add('is-visible');

            psTextWrap.classList.remove('is-instant-visible', 'is-fading-in');
            setFitTextContent(psNameEl, p.name);
            setFitTextContent(psScoreEl, p.score);

            psVid.currentTime = 0;
            psVid.play().catch(err => console.error("Lỗi phát Proj_PointSummary.webm:", err));

            psFadeInTimer = setTimeout(() => {
                void psTextWrap.offsetWidth;
                psTextWrap.classList.add('is-fading-in');
            }, 1000);

        } else if (step >= 2 && step <= 4) {
            const p = sortedPlayers[step - 1];
            psGroup.classList.remove('is-fading-out');
            psGroup.classList.add('is-visible');

            psTextWrap.classList.remove('is-fading-in');
            psTextWrap.classList.add('is-instant-visible');
            setFitTextContent(psNameEl, p.name);
            setFitTextContent(psScoreEl, p.score);

        } else if (step === 5) {
            // 1. Nạp dữ liệu 4 thí sinh & cho video Main_Total fade-in trước ngay tại 0ms
            totalGroup.classList.remove('is-fading-in', 'is-instant-visible');
            totalGroup.classList.add('is-preparing');

            for (let i = 1; i <= 4; i++) {
                const pl = orderedPlayers[i - 1] || { index: i, name: `PLAYER ${i}`, score: 0, avatarUrl: '' };
                const imgEl = document.getElementById(`projTotalImg-${i}`);
                const nameEl = document.getElementById(`projTotalName-${i}`);
                const scoreEl = document.getElementById(`projTotalScore-${i}`);

                if (imgEl) setImageSourceWithFallback(imgEl, i, pl.avatarUrl);
                if (nameEl) setFitTextContent(nameEl, pl.name);
                if (scoreEl) setFitTextContent(scoreEl, pl.score);
            }

            totalVid.currentTime = 0;
            totalVid.play().catch(err => console.error("Lỗi phát Proj_Total.webm:", err));

            void totalGroup.offsetWidth;
            totalGroup.classList.remove('is-preparing');
            totalGroup.classList.add('is-fading-in');

            const PS_FADE_OUT_DELAY_MS = 500;    // Độ trễ trước khi PointSummary fade-out
            const PS_FADE_OUT_DURATION_MS = 600;

            psFadeInTimer = setTimeout(() => {
                psGroup.classList.remove('is-visible');
                psGroup.classList.add('is-fading-out');

                psFadeOutTimer = setTimeout(() => {
                    psGroup.classList.remove('is-visible', 'is-fading-out');
                    psTextWrap.classList.remove('is-instant-visible', 'is-fading-in');
                    psVid.pause();
                    psVid.currentTime = 0;
                }, PS_FADE_OUT_DURATION_MS);
            }, PS_FADE_OUT_DELAY_MS);

        } else if (step >= 6) {
            hideProjectorPointSummaryImmediate();
        }
    }
}

function showMatchResultInstant(data) {
    if (!isProjectorScreen()) return;

    const psGroup = document.getElementById('projPointSummaryGroup');
    const psVid = document.getElementById('projPointSummaryVideo');
    const psTextWrap = document.getElementById('projPointSummaryTextWrap');
    const totalGroup = document.getElementById('projTotalGroup');
    const totalVid = document.getElementById('projTotalVideo');
    if (!totalGroup || !totalVid) return;

    clearPointSummaryTimers();

    if (psGroup) psGroup.classList.remove('is-visible', 'is-fading-out');
    if (psTextWrap) psTextWrap.classList.remove('is-instant-visible', 'is-fading-in');
    if (psVid) {
        psVid.pause();
        psVid.currentTime = 0;
    }

    const orderedPlayers = getOrderedPlayersList(data?.players);

    totalGroup.classList.remove('is-preparing', 'is-fading-in', 'is-instant-visible');
    totalGroup.dataset.pendingShow = 'true';

    for (let i = 1; i <= 4; i++) {
        const pl = orderedPlayers[i - 1] || { index: i, name: `PLAYER ${i}`, score: 0, avatarUrl: '' };
        const imgEl = document.getElementById(`projTotalImg-${i}`);
        const nameEl = document.getElementById(`projTotalName-${i}`);
        const scoreEl = document.getElementById(`projTotalScore-${i}`);

        if (imgEl) setImageSourceWithFallback(imgEl, i, pl.avatarUrl);
        if (nameEl) setFitTextContent(nameEl, pl.name);
        if (scoreEl) setFitTextContent(scoreEl, pl.score);
    }

    seekVideoToLastFrame(totalVid, () => {
        if (totalGroup.dataset.pendingShow !== 'true') return;
        delete totalGroup.dataset.pendingShow;
        totalGroup.classList.add('is-instant-visible');
        refitAllVisiblePointSummaryTexts();
    });
}

function hideMatchResultInstant() {
    if (!isProjectorScreen()) return;
    hideProjectorPointSummaryImmediate();
}

function resetAllMainGraphics() {
    if (fadeOutTimeout) {
        clearTimeout(fadeOutTimeout);
        fadeOutTimeout = null;
    }
    clearPointSummaryTimers();
    clearTickerAnimations();
    hideMainIntro();
    hideLivestreamPointSummaryImmediate();
    hideProjectorPointSummaryImmediate();

    // Giữ nguyên #projMainBgLayer hiển thị xuyên suốt trong cửa sổ Main trên Projector
    const group = document.getElementById('mainLowerthirdGroup');
    const ltVid = document.getElementById('mainLowerthirdVideo');
    const textContainer = document.getElementById('mainLowerthirdTexts');
    const tickerViewport = document.getElementById('mainLowerthirdTickerViewport');

    if (group) {
        group.style.display = 'none';
        group.classList.remove('fade-out-15s');
        group.style.removeProperty('opacity');
    }
    if (textContainer) textContainer.classList.remove('fade-in-text');
    if (tickerViewport) {
        tickerViewport.style.display = 'none';
        tickerViewport.innerHTML = '';
    }
    if (ltVid) {
        ltVid.pause();
        ltVid.currentTime = 0;
    }
}

// =========================================================================
// 4. LẮNG NGHE DỮ LIỆU & LỆNH TỪ CONTROLLER QUA FIREBASE
// =========================================================================
let isInitialLoad = true;

if (typeof window.currentRoundUnsubscribe === 'function') {
    window.currentRoundUnsubscribe();
}

const unsubGameThumbnails = onValue(ref(db, 'games/game_thumbnails'), (snapshot) => {
    customGameThumbnails = snapshot.exists() ? (snapshot.val() || {}) : {};
    if (isProjectorScreen()) {
        setProjectorThumbnail(currentProjectorBgKey || 'R0', true);
    }
});

const unsubProjectorBg = onValue(ref(db, 'games/main_projector_bg'), (snapshot) => {
    if (!isProjectorScreen()) return;
    if (!snapshot.exists()) {
        setProjectorThumbnail('R0');
        return;
    }
    const val = snapshot.val();
    const bgKey = (val && val.key) ? val.key : 'R0';
    setProjectorThumbnail(bgKey);
});

const unsubPlayers = onValue(ref(db, 'games/players'), (snapshot) => {
    if (snapshot.exists()) {
        cachedPlayers = snapshot.val() || {};

        // Cập nhật trực tiếp nếu bảng Proj_Total đang hiển thị trên Projector
        const totalGroup = document.getElementById('projTotalGroup');
        if (isProjectorScreen() && totalGroup && (totalGroup.classList.contains('is-fading-in') || totalGroup.classList.contains('is-instant-visible'))) {
            for (let i = 1; i <= 4; i++) {
                const p = cachedPlayers[i] || {};
                const imgEl = document.getElementById(`projTotalImg-${i}`);
                const nameEl = document.getElementById(`projTotalName-${i}`);
                const scoreEl = document.getElementById(`projTotalScore-${i}`);

                if (imgEl) setImageSourceWithFallback(imgEl, i, p.avatarUrl || '');
                if (nameEl) setFitTextContent(nameEl, p.name || `PLAYER ${i}`);
                if (scoreEl) setFitTextContent(scoreEl, Number(p.score) || 0);
            }
        }
    }
});

const unsubCommands = onValue(ref(db, 'games/commands'), (snapshot) => {
    if (isInitialLoad) {
        isInitialLoad = false;
        return;
    }
    if (!snapshot.exists()) return;
    const data = snapshot.val();
    if (!data || !data.action) return;

    if (data.action === 'set_projector_bg') {
        if (isProjectorScreen()) {
            setProjectorThumbnail(data.key || 'R0', true);
        }
    } else if (data.action === 'play_intro') {
        if (isProjectorScreen()) playMainIntro();
    } else if (data.action === 'hide_intro') {
        if (isProjectorScreen()) hideMainIntro();
    } else if (data.action === 'play_lowerthird') {
        if (!isProjectorScreen()) playMainLowerthird(data);
    } else if (data.action === 'update_lowerthird_texts') {
        if (!isProjectorScreen()) updateMainLowerthirdLive(data);
    } else if (data.action === 'hide_lowerthird') {
        if (!isProjectorScreen()) hideMainLowerthird();
    } else if (data.action === 'point_summary') {
        handlePointSummaryCommand(data);
    } else if (data.action === 'show_match_result') {
        showMatchResultInstant(data);
    } else if (data.action === 'hide_match_result') {
        hideMatchResultInstant();
    } else if (data.action === 'reset_main_graphic' || data.action === 'reset_graphic') {
        resetAllMainGraphics();
    }
});

window.currentRoundUnsubscribe = () => {
    unsubGameThumbnails();
    unsubProjectorBg();
    unsubPlayers();
    unsubCommands();
};

window.cleanupCurrentRound = () => {
    resetAllMainGraphics();
    if (typeof window.currentRoundUnsubscribe === 'function') {
        window.currentRoundUnsubscribe();
        window.currentRoundUnsubscribe = null;
    }
    currentProjectorBgKey = null;
    currentProjectorBgSignature = null;
};