import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const db = window.firebaseDB;
const state = window.HostState;
const utils = window.HostUtils;

const SCORE_TIERS = [40, 30, 20, 10];
const VIDEO_EXT_REGEX = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv)(\?|#|$)/i;
const r3Channel = new BroadcastChannel("olympia_r3_control");

const r3State = {
  currentQuestionIndex: 1,
  durations: [20, 20, 30, 30],
  showQuestion: false,
  showQuestionAnswer: false,
  showQuestionAnswerSeq: 0,
  timerRunning: false,
  timerSeq: 0,
  timerStartTimestamp: 0,
  remainingTime: 20,
  currentPage: 1,
  showAnswers: false,
  playerStates: null,
  rawSubmissions: {}
};

let hostTimerInterval = null;
let lastTimerSeq = -1;
let lastShowQuesAnsSeq = -1;

function detectMediaInfo(rawItem, fallbackDuration) {
  if (!rawItem || typeof rawItem !== "object") {
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
    const declaredType = String(
      rawItem.media_type || rawItem.mediaType || rawItem.type || ""
    ).toLowerCase();
    if (explicitVideo || declaredType === "video" || VIDEO_EXT_REGEX.test(rawUrl)) {
      mediaType = "video";
    } else {
      mediaType = "image";
    }
  }

  const explicitAnsVideo = rawItem.answer_video || rawItem.ans_video || "";
  const explicitAnsImage =
    rawItem.answer_image || rawItem.ans_image || rawItem.anh_dap_an || "";
  const genericAnsMedia =
    rawItem.answer_media ||
    rawItem.ans_media ||
    rawItem.media_dap_an ||
    rawItem.answerMedia ||
    "";

  const rawAnsUrl = String(
    explicitAnsVideo || genericAnsMedia || explicitAnsImage || ""
  ).trim();
  let answerMediaType = "none";

  if (rawAnsUrl) {
    const declaredAnsType = String(
      rawItem.answer_media_type ||
        rawItem.ans_media_type ||
        rawItem.answerMediaType ||
        ""
    ).toLowerCase();
    if (
      explicitAnsVideo ||
      declaredAnsType === "video" ||
      VIDEO_EXT_REGEX.test(rawAnsUrl)
    ) {
      answerMediaType = "video";
    } else {
      answerMediaType = "image";
    }
  }

  const parsedDur = Number(rawItem.thoi_gian ?? rawItem.time ?? rawItem.duration);
  const duration =
    Number.isFinite(parsedDur) && parsedDur > 0 ? parsedDur : fallbackDuration;

  return {
    mediaUrl: rawUrl,
    mediaType,
    answerMediaUrl: rawAnsUrl,
    answerMediaType,
    duration
  };
}

function getQuestionsList() {
  const r3Map = utils.normalizeNumberedMap(state.questions.round_3);
  const list = [];
  for (let i = 1; i <= 4; i++) {
    const defaultDur = r3State.durations[i - 1] || (i <= 2 ? 20 : 30);
    const rawItem = r3Map[i] || null;
    if (rawItem) {
      const mediaInfo = detectMediaInfo(rawItem, defaultDur);
      list.push({
        text: rawItem.cau_hoi || rawItem.question || "",
        answer: rawItem.dap_an || rawItem.answer || "",
        mediaUrl: mediaInfo.mediaUrl,
        mediaType: mediaInfo.mediaType,
        answerMediaUrl: mediaInfo.answerMediaUrl,
        answerMediaType: mediaInfo.answerMediaType,
        duration: mediaInfo.duration
      });
    } else {
      list.push({
        text: "",
        answer: "",
        mediaUrl: "",
        mediaType: "none",
        answerMediaUrl: "",
        answerMediaType: "none",
        duration: defaultDur
      });
    }
  }
  return list;
}

function calculateAwardPoints(players) {
  const rightPlayers = players
    .map((p, idx) => ({
      idx,
      time:
        typeof p.time === "number" && Number.isFinite(p.time)
          ? p.time
          : Number.POSITIVE_INFINITY,
      status: p.status
    }))
    .filter((item) => item.status === "right")
    .sort((a, b) => a.time - b.time);

  const awards = [0, 0, 0, 0];
  let currentTierIdx = 0;

  rightPlayers.forEach((item, rankIdx) => {
    if (rankIdx > 0 && item.time !== rightPlayers[rankIdx - 1].time) {
      currentTierIdx = rankIdx;
    }
    if (currentTierIdx < SCORE_TIERS.length) {
      awards[item.idx] = SCORE_TIERS[currentTierIdx];
    }
  });

  return awards;
}

function updateTimerDisplay() {
  const timerBadge = document.getElementById("host-r3-timer-display");
  if (!timerBadge) return;
  timerBadge.textContent = `THỜI GIAN: ${Math.max(0, r3State.remainingTime).toFixed(1)}s`;
  timerBadge.classList.toggle("running", r3State.timerRunning);
}

function stopHostLocalTimer() {
  if (hostTimerInterval !== null) {
    clearInterval(hostTimerInterval);
    hostTimerInterval = null;
  }
}

function syncHostTimerFromControl(ctrl) {
  const wasRunning = r3State.timerRunning;
  const nextRunning = Boolean(ctrl.timerRunning);
  const nextSeq = Number(ctrl.timerSeq) || 0;
  const baseDur = Number(ctrl.duration) || (r3State.currentQuestionIndex <= 2 ? 20 : 30);

  r3State.timerRunning = nextRunning;
  r3State.timerSeq = nextSeq;
  if (ctrl.timerStartTimestamp !== undefined) {
    r3State.timerStartTimestamp = Number(ctrl.timerStartTimestamp) || 0;
  }

  if (nextRunning) {
    const rawRem =
      ctrl.remainingTime !== undefined && ctrl.remainingTime !== null
        ? Number(ctrl.remainingTime)
        : baseDur;
    const elapsed = ctrl.timestamp
      ? Math.max(0, (Date.now() - Number(ctrl.timestamp)) / 1000)
      : 0;
    r3State.remainingTime = Math.max(0, Number((rawRem - elapsed).toFixed(1)));

    if (!wasRunning || nextSeq !== lastTimerSeq || hostTimerInterval === null) {
      stopHostLocalTimer();
      hostTimerInterval = setInterval(() => {
        r3State.remainingTime = Math.max(
          0,
          Number((r3State.remainingTime - 0.1).toFixed(1))
        );
        updateTimerDisplay();
        if (r3State.remainingTime <= 0) {
          stopHostLocalTimer();
          r3State.timerRunning = false;
          updateTimerDisplay();
        }
      }, 100);
    }
  } else {
    stopHostLocalTimer();
    if (ctrl.remainingTime !== undefined && ctrl.remainingTime !== null) {
      r3State.remainingTime = Math.max(0, Number(ctrl.remainingTime));
    } else {
      r3State.remainingTime = baseDur;
    }
  }

  lastTimerSeq = nextSeq;
  updateTimerDisplay();
}

function updateMediaPreview(q) {
  const typeBadge = document.getElementById("host-r3-media-type");
  const imgEl = document.getElementById("host-r3-preview-img");
  const vidEl = document.getElementById("host-r3-preview-vid");
  const emptyEl = document.getElementById("host-r3-media-empty");

  if (!typeBadge || !imgEl || !vidEl || !emptyEl) return;

  const isAnsMode = r3State.showQuestionAnswer;
  const targetUrl = isAnsMode ? q.answerMediaUrl : q.mediaUrl;
  const targetType = isAnsMode ? q.answerMediaType : q.mediaType;

  if (targetType === "image" && targetUrl) {
    typeBadge.textContent = isAnsMode ? "ĐÁP ÁN: ẢNH (ĐANG HIỆN)" : "ẢNH (HIỆN SAU 1S)";
    imgEl.src = targetUrl;
    imgEl.style.display = "block";
    vidEl.pause();
    vidEl.style.display = "none";
    emptyEl.style.display = "none";
  } else if (targetType === "video" && targetUrl) {
    typeBadge.textContent = isAnsMode
      ? "ĐÁP ÁN: VIDEO (ĐANG HIỆN)"
      : "VIDEO (HIỆN KHI BẤM GIỜ)";
    vidEl.muted = true;
    vidEl.volume = 0;
    if (vidEl.getAttribute("src") !== targetUrl) {
      vidEl.src = targetUrl;
    }
    vidEl.style.display = "block";
    imgEl.style.display = "none";
    emptyEl.style.display = "none";

    if (isAnsMode) {
      if (r3State.showQuestionAnswerSeq !== lastShowQuesAnsSeq) {
        vidEl.currentTime = 0;
        vidEl.play().catch(() => {});
      }
    } else if (r3State.timerRunning) {
      if (vidEl.paused) {
        vidEl.play().catch(() => {});
      }
    } else {
      vidEl.pause();
      if (!r3State.showQuestion) {
        vidEl.currentTime = 0;
      }
    }
  } else {
    typeBadge.textContent = isAnsMode ? "ĐÁP ÁN: KHÔNG CÓ MEDIA" : "KHÔNG CÓ MEDIA";
    emptyEl.textContent = isAnsMode
      ? "Câu hỏi này chưa chuẩn bị media đáp án"
      : "Không có hình ảnh / video cho câu hỏi này";
    imgEl.style.display = "none";
    vidEl.pause();
    vidEl.style.display = "none";
    emptyEl.style.display = "block";
  }

  lastShowQuesAnsSeq = r3State.showQuestionAnswerSeq;
}

function renderR3View() {
  if (state.activeTab !== "R3") return;

  const questions = getQuestionsList();
  const idx = Math.min(4, Math.max(1, Number(r3State.currentQuestionIndex) || 1));
  const q = questions[idx - 1];

  const subEl = document.getElementById("hostRoundSub");
  if (subEl) {
    subEl.textContent = `CÂU HỎI ${idx}/4 • ${q.duration}s`;
  }

  for (let i = 1; i <= 4; i++) {
    const tabEl = document.getElementById(`host-r3-q-tab-${i}`);
    if (tabEl) {
      const dur = questions[i - 1]?.duration || r3State.durations[i - 1] || (i <= 2 ? 20 : 30);
      tabEl.textContent = `CÂU ${i} (${dur}s)`;
      tabEl.classList.toggle("active", i === idx);
    }
  }

  const qTextEl = document.getElementById("host-r3-q-text");
  if (qTextEl) {
    qTextEl.textContent = q.text || `(Chưa có nội dung câu hỏi ${idx})`;
  }

  const ansBadgeEl = document.getElementById("host-r3-correct-ans");
  if (ansBadgeEl) {
    ansBadgeEl.textContent = q.answer || "---";
  }

  updateMediaPreview(q);
  updateTimerDisplay();

  // Tổng hợp dữ liệu 4 thí sinh từ Controller và Firebase
  const mergedPlayers = [];
  for (let i = 0; i < 4; i++) {
    const dbPlayer = state.players[i + 1] || {};
    const ctrlP = Array.isArray(r3State.playerStates) ? r3State.playerStates[i] : null;
    const rawSub = r3State.rawSubmissions ? r3State.rawSubmissions[i + 1] : null;

    let answer = "";
    let time = null;
    let status = "none";

    if (ctrlP) {
      answer = String(ctrlP.answer ?? "");
      time =
        typeof ctrlP.time === "number" && Number.isFinite(ctrlP.time)
          ? ctrlP.time
          : null;
      status = ctrlP.status || "none";
    } else if (rawSub !== null && rawSub !== undefined) {
      if (typeof rawSub === "object") {
        answer = String(rawSub.answer ?? rawSub.dap_an ?? "");
        const rawTime = rawSub.time ?? rawSub.thoi_gian;
        if (rawTime !== undefined && rawTime !== null && rawTime !== "") {
          time = Number(Number(rawTime).toFixed(2));
        } else if (rawSub.timestamp && r3State.timerStartTimestamp > 0) {
          const diff = Math.max(
            0,
            (Number(rawSub.timestamp) - r3State.timerStartTimestamp) / 1000
          );
          time = Number(diff.toFixed(2));
        }
      } else {
        answer = String(rawSub);
      }
    }

    mergedPlayers.push({
      name: String(dbPlayer.name || ctrlP?.name || `P${i + 1}`).trim() || `P${i + 1}`,
      score: Number(dbPlayer.score ?? ctrlP?.score) || 0,
      answer,
      time,
      status
    });
  }

  const awards = calculateAwardPoints(mergedPlayers);

  mergedPlayers.forEach((p, idx) => {
    const cardEl = document.getElementById(`host-r3-ans-card-${idx}`);
    if (cardEl) {
      cardEl.classList.toggle("is-right", p.status === "right");
      cardEl.classList.toggle("is-wrong", p.status === "wrong");
    }

    const nameEl = document.getElementById(`host-r3-player-name-${idx}`);
    if (nameEl) nameEl.textContent = `${idx + 1}. ${p.name}`;

    const scoreEl = document.getElementById(`host-r3-player-score-${idx}`);
    if (scoreEl) scoreEl.textContent = `${p.score}đ`;

    const earnEl = document.getElementById(`host-r3-earn-${idx}`);
    if (earnEl) {
      const pts = awards[idx];
      earnEl.textContent = `+${pts}`;
      earnEl.classList.toggle("has-points", pts > 0);
    }

    const timeEl = document.getElementById(`host-r3-time-${idx}`);
    if (timeEl) {
      timeEl.textContent =
        typeof p.time === "number" && Number.isFinite(p.time)
          ? p.time.toFixed(2)
          : "--";
    }

    const ansEl = document.getElementById(`host-r3-ans-${idx}`);
    if (ansEl) ansEl.textContent = p.answer || "";

    const judgeEl = document.getElementById(`host-r3-judge-${idx}`);
    if (judgeEl) {
      judgeEl.classList.toggle("right", p.status === "right");
      judgeEl.classList.toggle("wrong", p.status === "wrong");
      judgeEl.textContent =
        p.status === "right" ? "ĐÚNG" : p.status === "wrong" ? "SAI" : "";
    }
  });
}

function applyControlPayload(ctrl) {
  if (!ctrl || typeof ctrl !== "object") return;

  if (ctrl.questionIndex !== undefined) {
    r3State.currentQuestionIndex = Number(ctrl.questionIndex) || 1;
  }
  if (Array.isArray(ctrl.durations)) {
    r3State.durations = ctrl.durations;
  }
  if (ctrl.showQuestion !== undefined) {
    r3State.showQuestion = Boolean(ctrl.showQuestion);
  }
  if (ctrl.showQuestionAnswer !== undefined) {
    r3State.showQuestionAnswer = Boolean(ctrl.showQuestionAnswer);
  }
  if (ctrl.showQuestionAnswerSeq !== undefined) {
    r3State.showQuestionAnswerSeq = Number(ctrl.showQuestionAnswerSeq) || 0;
  }
  if (ctrl.page !== undefined) {
    r3State.currentPage = Number(ctrl.page) || 1;
  }
  if (ctrl.showAnswers !== undefined) {
    r3State.showAnswers = Boolean(ctrl.showAnswers);
  }
  if (Array.isArray(ctrl.playerStates)) {
    r3State.playerStates = ctrl.playerStates;
  }

  syncHostTimerFromControl(ctrl);
  renderR3View();
}

const unsubR3Control = onValue(ref(db, "games/r3_control"), (snap) => {
  if (!snap.exists()) return;
  applyControlPayload(snap.val());
});

const unsubR3Answers = onValue(ref(db, "games/round_3/dap_an_thi_sinh"), (snap) => {
  r3State.rawSubmissions = snap.exists() ? snap.val() : {};
  renderR3View();
});

r3Channel.onmessage = (event) => {
  applyControlPayload(event.data);
};

window.renderActiveHostRound = renderR3View;
window.cleanupCurrentRound = () => {
  stopHostLocalTimer();
  const vidEl = document.getElementById("host-r3-preview-vid");
  if (vidEl) {
    vidEl.pause();
    vidEl.removeAttribute("src");
  }
  unsubR3Control();
  unsubR3Answers();
  r3Channel.close();
  window.renderActiveHostRound = null;
};

renderR3View();