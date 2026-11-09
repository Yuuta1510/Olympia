import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue, update, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

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

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

window.updateNameDB = function(index, nameStr) {
    update(ref(db, `games/players/${index}`), {name: nameStr});
};
window.updateScoreDB = function(index, scoreVal) {
    update(ref(db, `games/players/${index}`), {score: Number(scoreVal)});
};

window.compressConfigName = function(index) {
    const el = document.getElementById(`config-name-${index}`);
    if (!el) return;
    el.style.transform = 'none';
    const textWidth = el.offsetWidth;
    const containerWidth = el.parentElement.clientWidth - 10;
    if (textWidth > containerWidth && containerWidth > 0) {
        const ratio = containerWidth / textWidth;
        el.style.transform = `scaleX(${ratio})`;
    }
};

window.compressBadgeText = function(spanId) {
    const el = document.getElementById(spanId);
    if (!el) return;
    el.style.transform = 'none'; 
    const textWidth = el.offsetWidth;
    const containerWidth = el.parentElement.clientWidth - 20; 
    if (textWidth > containerWidth && containerWidth > 0) {
        const ratio = containerWidth / textWidth;
        el.style.transform = `scaleX(${ratio})`;
    }
};

window.addEventListener('load', () => {
    window.compressBadgeText('roundText');
    window.compressBadgeText('quesText');
    window.compressBadgeText('timeText');
    window.renderLuotChungConfigs();
});

const channel = {
    postMessage: function(data) {
        return update(ref(db, 'games/commands'), {
            ...data,
            timestamp: Date.now()
        });
    }
};

let currentQuesIndex = 1;
let round1Questions = [];
let globalPlayers = {};
let activePlayerIndex = null;
let isGraphicShown = false;
let isPlayersShown = false;
let isQuestionShown = false;
let ctrlTimerInterval = null;
let isTimer5sRunning = false;
let currentTurnTime = -1;
let currentRemainingTime = -1;
let isTurnTimePlaying = false;
let turnTimerInterval = null;
let lr_config = {so_luot: 4, so_cau: 6, thoi_gian: -1, diem_dung: 10, diem_sai: 0};
let lc_configs = [{so_cau: 12, thoi_gian: -1, diem_dung: 10, diem_sai: -5}];

window.renderLuotChungConfigs = function() {
    let num = parseInt(document.getElementById('numLuotChung').value) || 0;
    let html = '';
    for(let i = 0; i < num; i++){
        let conf = lc_configs[i] || {so_cau: 12, thoi_gian: -1, diem_dung: 10, diem_sai: -5};
        html += `
        <div style="border-left: 2px solid #38bdf8; padding-left: 10px;">
          <div class="config-group-title" style="font-size: 12px; margin-bottom: 4px; color: #38bdf8;"># Lượt Chung ${i+1}</div>
          <div class="config-grid" style="gap: 10px;">
            <div class="config-item"><label>Số Câu</label><input type="number" id="lc_socau_${i}" value="${conf.so_cau}"></div>
            <div class="config-item"><label>Thời gian (s)</label><input type="number" id="lc_thoigian_${i}" value="${conf.thoi_gian}" title="-1 là vô hạn"></div>
            <div class="config-item"><label>Điểm Đúng</label><input type="number" id="lc_diemdung_${i}" value="${conf.diem_dung}"></div>
            <div class="config-item"><label>Điểm Sai</label><input type="number" id="lc_diemsai_${i}" value="${conf.diem_sai}"></div>
          </div>
        </div>`;
    }
    document.getElementById('luotChungList').innerHTML = html;
    window.updateTurnStatusOptions();
};

window.updateTurnStatusOptions = function() {
    let numLC = parseInt(document.getElementById('numLuotChung').value) || 0;
    let lrInput = document.getElementById('lr_soluot');
    let numLR = lrInput ? (parseInt(lrInput.value) || 4) : (lr_config.so_luot || 4);
    let select = document.getElementById('turnStatus');
    if (!select) return;
    let currentVal = select.value;
    let opts = '';

    for (let i = 1; i <= numLR; i++) {
        opts += `<option value="rieng_${i}">Lượt riêng ${i}</option>`;
    }
    for(let i = 0; i < numLC; i++) {
        opts += `<option value="chung_${i}">Lượt chung ${i+1}</option>`;
    }
    select.innerHTML = opts;
    if (select.querySelector(`option[value="${currentVal}"]`)) {
        select.value = currentVal;
    }
};

window.jumpToTurn = function(val) {
    let LR_Count = parseInt(lr_config.so_luot) || 4;
    let A = parseInt(lr_config.so_cau) || 0;

    if (val.startsWith('rieng_')) {
        let pIdx = parseInt(val.split('_')[1]);
        if (A > 0) {
            currentQuesIndex = (pIdx - 1) * A + 1;
        } else {
            currentQuesIndex = 1;
        }
    } else if (val.startsWith('chung_')) {
        let lcIdx = parseInt(val.split('_')[1]);
        let startIndex = (LR_Count * A) + 1;
        for(let i = 0; i < lcIdx; i++) {
            startIndex += parseInt(lc_configs[i]?.so_cau || 0);
        }
        currentQuesIndex = startIndex;
    }
    updateQAPreview();
};

function updateQAPreview() {
    if (round1Questions && round1Questions[currentQuesIndex]) {
        document.getElementById('preview-question').innerText = round1Questions[currentQuesIndex].cau_hoi;
        document.getElementById('preview-answer').innerText = round1Questions[currentQuesIndex].dap_an;
    } else {
        document.getElementById('preview-question').innerText = "...";
        document.getElementById('preview-answer').innerText = "...";
    }

    let LR_Count = parseInt(lr_config.so_luot);
    if (isNaN(LR_Count)) LR_Count = 4;
    let A = parseInt(lr_config.so_cau) || 0;

    let turnName = "";
    let relativeQues = 0;
    let totalTurnQues = 0;
    let turnTime = -1;

    if (A > 0 && LR_Count > 0 && currentQuesIndex <= (LR_Count * A)) {
        let playerIndex = Math.ceil(currentQuesIndex / A); 
        turnName = `LƯỢT RIÊNG ${playerIndex}`;
        relativeQues = currentQuesIndex - ((playerIndex - 1) * A); 
        totalTurnQues = A;
        turnTime = lr_config.thoi_gian;
        
        let statusSelect = document.getElementById('turnStatus');
        if(statusSelect && statusSelect.value !== `rieng_${playerIndex}`) {
            statusSelect.value = `rieng_${playerIndex}`;
        }
    } else if (lc_configs && lc_configs.length > 0) {
        let remainingIndex = currentQuesIndex - ((A > 0 && LR_Count > 0) ? (LR_Count * A) : 0);
        let foundLC = false;
        
        for(let i = 0; i < lc_configs.length; i++) {
            let B = parseInt(lc_configs[i].so_cau) || 0;
            if (B > 0 && remainingIndex <= B) {
                turnName = `LƯỢT CHUNG ${i + 1}`;
                relativeQues = remainingIndex;
                totalTurnQues = B;
                turnTime = lc_configs[i].thoi_gian;
                foundLC = true;
                
                let statusSelect = document.getElementById('turnStatus');
                if(statusSelect && statusSelect.value !== `chung_${i}`) statusSelect.value = `chung_${i}`;
                break;
            } else {
                remainingIndex -= B; 
            }
        }
        if (!foundLC) { turnName = "LƯỢT RIÊNG 0"; relativeQues = 0; totalTurnQues = 0; }
    }
    else {
        turnName = "LƯỢT ..."; relativeQues = 0; totalTurnQues = 0;
    }

    let timeStr = (turnTime === -1 || turnTime === undefined) ? "VÔ HẠN" : `${Number(turnTime).toFixed(1)}s`;
    const roundSpan = document.getElementById('roundText');
    const quesSpan = document.getElementById('quesText');
    const timeSpan = document.getElementById('timeText');

    if (roundSpan) roundSpan.innerText = turnName;
    if (quesSpan) quesSpan.innerText = (totalTurnQues > 0) ? `CÂU HỎI ${relativeQues}/${totalTurnQues}` : "HẾT CÂU HỎI";
    if (timeSpan) timeSpan.innerText = `THỜI GIAN: ${timeStr}`;

    if (!isTurnTimePlaying) {
        currentTurnTime = turnTime;
        if (currentRemainingTime === -1 || currentRemainingTime <= 0 || currentTurnTime !== turnTime) {
            currentRemainingTime = turnTime;
        }
        
        let displayTimeStr = "VÔ HẠN";
        if (currentRemainingTime !== -1 && currentRemainingTime !== undefined) {
            displayTimeStr = (currentRemainingTime > 0) ? `${Number(currentRemainingTime).toFixed(1)}s` : "0.00s";
        }
        if (timeSpan) timeSpan.innerText = `THỜI GIAN: ${displayTimeStr}`;
    } else {
        currentTurnTime = turnTime;
    }
    const btnPlayTime = document.getElementById('btnPlayPauseTime');
    const btnResetTime = document.getElementById('btnResetTime');
    if (btnPlayTime && btnResetTime) {
        if (turnTime !== -1 && turnTime !== undefined) {
            btnPlayTime.style.display = 'inline-block';
            btnResetTime.style.display = 'inline-block';
            btnPlayTime.innerText = isTurnTimePlaying ? '⏸' : '▶';
        } else {
            btnPlayTime.style.display = 'none';
            btnResetTime.style.display = 'none';
        }
    }
    window.compressBadgeText('roundText');
    window.compressBadgeText('quesText');
    window.compressBadgeText('timeText');
}

function isCommonQuestion(questionIndex) {
    const LR_Count = parseInt(lr_config.so_luot) || 0;
    const individualQuestionCount = parseInt(lr_config.so_cau) || 0;
    let remainingIndex = questionIndex - (individualQuestionCount > 0 && LR_Count > 0 ? LR_Count * individualQuestionCount : 0);

    if (remainingIndex <= 0) return false;

    for (const config of lc_configs) {
        const questionCount = parseInt(config.so_cau) || 0;
        if (questionCount > 0 && remainingIndex <= questionCount) return true;
        remainingIndex -= questionCount;
    }

    return false;
}

window.triggerAction = function(btn, keyStr) {
  let resetBuzzersForNextQuestion = false;
  const btnGraphic = document.getElementById('btn-graphic');
  const btnPlayers = document.getElementById('btn-players');
  const btnQuestion = document.getElementById('btn-question');

  if (btn) {
    btn.classList.add('active');
    if (keyStr >= '1' && keyStr <= '6') {
        document.querySelectorAll('.player-vertical-card').forEach(b => b.classList.remove('is-turn'));
        const targetBtn = document.getElementById(`playerBtn-${keyStr}`);
        if (targetBtn) targetBtn.classList.add('is-turn');
        activePlayerIndex = parseInt(keyStr);
        isPlayersShown = true;
        if (btnPlayers) btnPlayers.classList.remove('dimmed');
    } else if (keyStr === '0') {
        document.querySelectorAll('.player-vertical-card').forEach(b => b.classList.remove('is-turn'));
        activePlayerIndex = null;
        isPlayersShown = !isPlayersShown; 
    } else if (keyStr === 'r') {
        document.querySelectorAll('.player-vertical-card').forEach(b => b.classList.remove('is-turn'));
        activePlayerIndex = null;
        isPlayersShown = false;
        isGraphicShown = false;
        isQuestionShown = false;
        if (btnGraphic) btnGraphic.classList.add('dimmed');
        if (btnPlayers) btnPlayers.classList.add('dimmed');
        if (btnQuestion) btnQuestion.classList.add('dimmed');
    } else if (keyStr === 'r' || keyStr === 'rb') {
        document.querySelectorAll('.player-vertical-card').forEach(b => b.classList.remove('is-turn'));
        activePlayerIndex = null;
        if (keyStr === 'r') {
            isPlayersShown = false;
            isGraphicShown = false;
            isQuestionShown = false;
            if (btnGraphic) btnGraphic.classList.add('dimmed');
            if (btnPlayers) btnPlayers.classList.add('dimmed');
            if (btnQuestion) btnQuestion.classList.add('dimmed');
        }
    } if (keyStr === 'r') {
        channel.postMessage({ action: 'stop_turn_time' });
        isTurnTimePlaying = false;
        if (turnTimerInterval) clearInterval(turnTimerInterval);
        currentRemainingTime = currentTurnTime; // Reset bộ đếm về gốc
    }
    setTimeout(() => { btn.classList.remove('active'); }, 50);
  }

  if (keyStr >= '1' && keyStr <= '6' && isCommonQuestion(currentQuesIndex)) {
      if (typeof window.playMusic === 'function') {
          window.playMusic('R1_Buzzed.mp3');
      }
  }
  if (keyStr === 'p') {
      if(currentQuesIndex > 1) {
          currentQuesIndex--;
          updateQAPreview();
      }
  }
  if (keyStr === 'n') {
      currentQuesIndex++;
      updateQAPreview();
      resetBuzzersForNextQuestion = isCommonQuestion(currentQuesIndex);
      if (resetBuzzersForNextQuestion) {
          activePlayerIndex = null;
          document.querySelectorAll('.player-vertical-card').forEach(b => b.classList.remove('is-turn'));
      }
  }
  if (keyStr === 'r') {
      channel.postMessage({ action: 'stop_turn_time' });
      isTurnTimePlaying = false;
      const btnPlayTime = document.getElementById('btnPlayPauseTime');
      if (btnPlayTime) btnPlayTime.innerText = '▶';
      currentRemainingTime = currentTurnTime;
  }

  if (keyStr === 's') {
      isGraphicShown = !isGraphicShown;
      if (isGraphicShown) {
          channel.postMessage({ action: 'show_graphic', isTimeLimited: (currentTurnTime !== -1 && currentTurnTime !== undefined) });
          if (btnGraphic) btnGraphic.classList.remove('dimmed');
      } else {
          channel.postMessage({ action: 'hide_graphic' });
          if (btnGraphic) btnGraphic.classList.add('dimmed');
      }
  }
  else if (keyStr === '0') {
      if (isPlayersShown) {
          channel.postMessage({ action: 'show_players', players: globalPlayers });
          if (btnPlayers) btnPlayers.classList.remove('dimmed');
      } else {
          channel.postMessage({ action: 'hide_players' });
          if (btnPlayers) btnPlayers.classList.add('dimmed');
      }
  } 
  else if (keyStr >= '1' && keyStr <= '6') {
      channel.postMessage({ action: 'active_player', index: parseInt(keyStr), players: globalPlayers });
  } 

  else if (keyStr === 'q') {
      isQuestionShown = !isQuestionShown;
      if (isQuestionShown) {
          if (round1Questions && round1Questions[currentQuesIndex]) {
              channel.postMessage({ action: 'show_question', text: round1Questions[currentQuesIndex].cau_hoi });
          }
          if (btnQuestion) btnQuestion.classList.remove('dimmed');
      } else {
          channel.postMessage({ action: 'hide_question' });
          if (btnQuestion) btnQuestion.classList.add('dimmed');
      }
  }
  else if (keyStr === 'n' || keyStr === 'p') {
      if (isQuestionShown && round1Questions && round1Questions[currentQuesIndex]) {
          const showQuestion = () => channel.postMessage({ action: 'show_question', text: round1Questions[currentQuesIndex].cau_hoi });
          if (keyStr === 'n' && resetBuzzersForNextQuestion) {
              channel.postMessage({ action: 'reset_buzzers' }).then(showQuestion);
          } else {
              showQuestion();
          }
      }
  }
  else if (keyStr === 'r') {
      channel.postMessage({ action: 'reset_graphic' });
  }
  else if (keyStr === 'rb') {
      channel.postMessage({ action: 'reset_buzzers' });
  }
  else if (keyStr === 't5') {
      const timerBtn = document.getElementById('timer5s-display');
      if (isTimer5sRunning) {
          channel.postMessage({ action: 'stop_5s' }); 
          if (ctrlTimerInterval) clearInterval(ctrlTimerInterval);
          isTimer5sRunning = false;
          if (timerBtn) {
              timerBtn.innerText = '5';
              timerBtn.classList.remove('running');
          }
      } else {
          channel.postMessage({ action: 'start_5s' }); 
          isTimer5sRunning = true;
          if (ctrlTimerInterval) clearInterval(ctrlTimerInterval);
          
          let timeLeft = 5;
          if (timerBtn) {
              timerBtn.innerText = timeLeft;
              timerBtn.classList.add('running');
          }
          
          ctrlTimerInterval = setInterval(() => {
              timeLeft--;
              if (timeLeft > 0) {
                  if (timerBtn) timerBtn.innerText = timeLeft;
              } else {
                  if (timerBtn) {
                      timerBtn.innerText = '0';
                      timerBtn.classList.remove('running');
                  }
                  clearInterval(ctrlTimerInterval);
                  isTimer5sRunning = false;
                  setTimeout(() => {
                      if (!isTimer5sRunning && timerBtn) timerBtn.innerText = '5';
                  }, 1500);
              }
          }, 1000);
      }
  }
};
window.resetTurnTime = function() {
    if (currentTurnTime === -1 || currentTurnTime === undefined) return;
    if (isTurnTimePlaying) {
        clearInterval(turnTimerInterval);
        isTurnTimePlaying = false;
        const btnPlayTime = document.getElementById('btnPlayPauseTime');
        if (btnPlayTime) btnPlayTime.innerText = '▶';
    }
    currentRemainingTime = currentTurnTime;
    const timeSpan = document.getElementById('timeText');
    if (timeSpan) {
        timeSpan.innerText = `THỜI GIAN: ${currentRemainingTime.toFixed(1)}s`;
        window.compressBadgeText('timeText');
    }
};
window.toggleTurnTime = function() {
    if (currentTurnTime === -1 || currentTurnTime === undefined) return;
    const btn = document.getElementById('btnPlayPauseTime');
    const timeSpan = document.getElementById('timeText');
    let isRestarting = false;
    if (currentRemainingTime <= 0 || currentRemainingTime === currentTurnTime) {
        currentRemainingTime = currentTurnTime;
        isRestarting = true;
    }
    isTurnTimePlaying = !isTurnTimePlaying;
    if (isTurnTimePlaying) {
        btn.innerText = '⏸';
        channel.postMessage({ action: 'play_turn_time', duration: currentTurnTime, restart: isRestarting });

        const startTime = Date.now();
        const startRemaining = currentRemainingTime;

        if (turnTimerInterval) clearInterval(turnTimerInterval);
        turnTimerInterval = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            currentRemainingTime = startRemaining - elapsed;

            if (currentRemainingTime > 0) {
                if (timeSpan) timeSpan.innerText = `THỜI GIAN: ${currentRemainingTime.toFixed(1)}s`;
            } else {
                currentRemainingTime = 0;
                if (timeSpan) timeSpan.innerText = `HẾT GIỜ`;
                clearInterval(turnTimerInterval);
                isTurnTimePlaying = false;
                btn.innerText = '▶';
                channel.postMessage({ action: 'time_out' });
            }
            window.compressBadgeText('timeText');
        }, 50);
    } else {
        btn.innerText = '▶';
        channel.postMessage({ action: 'pause_turn_time' });
        if (turnTimerInterval) clearInterval(turnTimerInterval);
    }
};

window.triggerScore = function(btn, type) {
    if(btn) {
        btn.classList.add('active');
        setTimeout(() => { btn.classList.remove('active'); }, 500);
    }

    if (!activePlayerIndex) {
        return;
    }

    let selectVal = document.getElementById('turnStatus').value;
    let dDung = 0, dSai = 0;
    
    if (selectVal.startsWith('rieng')) {
        dDung = Number(document.getElementById('lr_diemdung').value);
        dSai = Number(document.getElementById('lr_diemsai').value);
    } else if (selectVal.startsWith('chung_')) {
        let idx = parseInt(selectVal.split('_')[1]);
        dDung = Number(document.getElementById(`lc_diemdung_${idx}`).value);
        dSai = Number(document.getElementById(`lc_diemsai_${idx}`).value);
    }
    
    let delta = (type === 'add') ? dDung : dSai;
    if (typeof window.updateScoreByIndex === 'function') {
        window.updateScoreByIndex(activePlayerIndex, delta);
    } else {
        let currentScore = globalPlayers[activePlayerIndex]?.score || 0;
        window.updateScoreDB(activePlayerIndex, currentScore + delta);
    }

    if (typeof window.playMusic === 'function') {
        window.playMusic(type === 'add' ? 'R1_Right.mp3' : 'R1_Wrong.mp3');
    }
    console.log(`Đã ${type === 'add' ? 'cộng' : 'trừ'} ${Math.abs(delta)} điểm cho P${activePlayerIndex}`);
};

window.openConfig = function() {
  document.getElementById('configModal').style.display = 'flex';
  setTimeout(() => {
      for (let i = 1; i <= 4; i++) window.compressConfigName(i);
  }, 50);
};

window.closeConfig = function() {
  document.getElementById('configModal').style.display = 'none';
};

onValue(ref(db, 'games/players'), (snapshot) => {
    if (snapshot.exists()) {
        globalPlayers = snapshot.val(); 
        const players = snapshot.val();
        
        for (let i = 1; i <= 4; i++) {
            if (players[i]) {
                const nameEl = document.getElementById(`playerBtnName-${i}`);
                const scoreEl = document.getElementById(`playerBtnScore-${i}`);
                
                if (nameEl) nameEl.innerText = players[i].name;
                if (scoreEl) scoreEl.innerText = players[i].score;
                
                const scoreInput = document.getElementById(`config-score-${i}`);
                const nameLabel = document.getElementById(`config-name-${i}`);
                
                if (scoreInput && document.activeElement !== scoreInput) {
                    scoreInput.value = players[i].score;
                }
                if (nameLabel && document.activeElement !== nameLabel) {
                    nameLabel.innerText = players[i].name;
                    window.compressConfigName(i); 
                }
            }
        }
        updateQAPreview(); 

        if (isPlayersShown) {
            if (activePlayerIndex !== null) {
                channel.postMessage({ action: 'active_player', index: activePlayerIndex, players: globalPlayers });
            } else {
                channel.postMessage({ action: 'show_players', players: globalPlayers });
            }
        }
    }
});

onValue(ref(db, 'questions/round_1'), (snapshot) => {
    if(snapshot.exists()) {
        round1Questions = snapshot.val();
        updateQAPreview();
    }
});

onValue(ref(db, 'games/round_1'), (snapshot) => {
    if(snapshot.exists()) {
        const data = snapshot.val();
        if(data.luot_rieng) {
            lr_config = data.luot_rieng;
            if (document.getElementById('lr_soluot')) document.getElementById('lr_soluot').value = lr_config.so_luot !== undefined ? lr_config.so_luot : 4;
            document.getElementById('lr_socau').value = lr_config.so_cau;
            document.getElementById('lr_diemdung').value = lr_config.diem_dung;
            document.getElementById('lr_diemsai').value = lr_config.diem_sai;
            document.getElementById('lr_thoigian').value = lr_config.thoi_gian || -1; 
        }
        if(data.luot_chung) {
            if(Array.isArray(data.luot_chung)) {
                lc_configs = data.luot_chung;
            } else {
                lc_configs = [data.luot_chung];
            }
            document.getElementById('numLuotChung').value = lc_configs.length;
            window.renderLuotChungConfigs();
        }
        updateQAPreview();
    }
});

window.saveRoundConfig = function() {
  let numLC = parseInt(document.getElementById('numLuotChung').value) || 0;
  let lc_arr = [];
  for (let i = 0; i < numLC; i++) {
      lc_arr.push({
          so_cau: Number(document.getElementById(`lc_socau_${i}`).value),
          diem_dung: Number(document.getElementById(`lc_diemdung_${i}`).value),
          diem_sai: Number(document.getElementById(`lc_diemsai_${i}`).value),
          thoi_gian: Number(document.getElementById(`lc_thoigian_${i}`).value)
      });
  }

  const round1Config = {
    luot_rieng: {
      so_luot: document.getElementById('lr_soluot') ? Number(document.getElementById('lr_soluot').value) : 4,
      so_cau: Number(document.getElementById('lr_socau').value),
      diem_dung: Number(document.getElementById('lr_diemdung').value),
      diem_sai: Number(document.getElementById('lr_diemsai').value),
      thoi_gian: Number(document.getElementById('lr_thoigian').value)
    },
    luot_chung: lc_arr
  };

  update(ref(db, 'games/round_1'), round1Config).then(() => {
      console.log("Đã lưu cấu hình vòng Khởi động linh hoạt!");
      window.closeConfig();
  });
};