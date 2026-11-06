import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

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
  update(ref(db, `games/players/${index}`), { name: nameStr });
};

window.updateScoreDB = function(index, scoreVal) {
  update(ref(db, `games/players/${index}`), { score: Number(scoreVal) });
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
    update(ref(db, 'games/commands'), {
      ...data,
      timestamp: Date.now()
    });
  }
};

// --- BIẾN LƯU TRỮ VÀ CẤU HÌNH VÒNG 1 ---
let currentQuesIndex = 1;
let round1Questions = [];
let globalPlayers = {};
let activePlayerIndex = null;
let isPlayersShown = false;
let ctrlTimerInterval = null;
let isTimer5sRunning = false;

let lr_config = { so_cau: 6, thoi_gian: -1, diem_dung: 10, diem_sai: 0 };
let lc_configs = [{ so_cau: 12, thoi_gian: -1, diem_dung: 10, diem_sai: -5 }];

// --- RENDER DYNAMIC LƯỢT CHUNG ---
window.renderLuotChungConfigs = function() {
    let num = parseInt(document.getElementById('numLuotChung').value) || 0;
    let html = '';
    for(let i = 0; i < num; i++) {
        let conf = lc_configs[i] || { so_cau: 12, thoi_gian: -1, diem_dung: 10, diem_sai: -5 };
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
    let num = parseInt(document.getElementById('numLuotChung').value) || 0;
    let select = document.getElementById('turnStatus');
    let currentVal = select.value;
    let opts = `<option value="rieng">Lượt Riêng</option>`;
    for(let i=0; i<num; i++){
        opts += `<option value="chung_${i}">Lượt Chung ${i+1}</option>`;
    }
    select.innerHTML = opts;
    if(select.querySelector(`option[value="${currentVal}"]`)) {
        select.value = currentVal;
    }
};

// --- HÀM JUMP NHANH ---
window.jumpToTurn = function(val) {
    let X = parseInt(document.getElementById('numPlayers').value) || 4;
    let A = parseInt(lr_config.so_cau) || 0;
    
    if (val === 'rieng') {
        currentQuesIndex = 1;
    } else if (val.startsWith('chung_')) {
        let lcIdx = parseInt(val.split('_')[1]);
        let startIndex = X * A + 1;
        for(let i = 0; i < lcIdx; i++) {
            startIndex += parseInt(lc_configs[i]?.so_cau || 0);
        }
        currentQuesIndex = startIndex;
    }
    updateQAPreview();
};

// --- HÀM CẬP NHẬT GIAO DIỆN & TÍNH TOÁN LOGIC CÂU HỎI ---
function updateQAPreview() {
    if(round1Questions && round1Questions[currentQuesIndex]) {
        document.getElementById('preview-question').innerText = round1Questions[currentQuesIndex].cau_hoi;
        document.getElementById('preview-answer').innerText = round1Questions[currentQuesIndex].dap_an;
    } else {
        document.getElementById('preview-question').innerText = "...";
        document.getElementById('preview-answer').innerText = "...";
    }
    
    let X = parseInt(document.getElementById('numPlayers').value) || 4;
    let A = parseInt(lr_config.so_cau) || 0; 
    
    let turnName = "";
    let relativeQues = 0;
    let totalTurnQues = 0;
    let turnTime = -1;

    if (A > 0 && currentQuesIndex <= (X * A)) {
        let playerIndex = Math.ceil(currentQuesIndex / A); 
        turnName = `LƯỢT RIÊNG ${playerIndex}`;
        relativeQues = currentQuesIndex - ((playerIndex - 1) * A); 
        totalTurnQues = A;
        turnTime = lr_config.thoi_gian;
        
        activePlayerIndex = playerIndex;

        document.querySelectorAll('.player-btn').forEach(b => b.classList.remove('is-turn'));
        let targetBtn = document.querySelectorAll('.player-btn')[playerIndex - 1];
        if (targetBtn) targetBtn.classList.add('is-turn');

        let statusSelect = document.getElementById('turnStatus');
        if(statusSelect && statusSelect.value !== "rieng") statusSelect.value = "rieng";

    } else if (lc_configs && lc_configs.length > 0) {
        let remainingIndex = currentQuesIndex - (A > 0 ? X * A : 0);
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
        
        if (!foundLC) { turnName = "KẾT THÚC"; relativeQues = 0; totalTurnQues = 0; }
        activePlayerIndex = null;
        document.querySelectorAll('.player-btn').forEach(b => b.classList.remove('is-turn'));
    }
    else {
        turnName = "KẾT THÚC"; relativeQues = 0; totalTurnQues = 0;
        activePlayerIndex = null;
        document.querySelectorAll('.player-btn').forEach(b => b.classList.remove('is-turn'));
    }

    let timeStr = (turnTime === -1 || turnTime === undefined) ? "VÔ HẠN" : `${turnTime}s`;
    const roundSpan = document.getElementById('roundText');
    const quesSpan = document.getElementById('quesText');
    const timeSpan = document.getElementById('timeText');

    if (roundSpan) roundSpan.innerText = turnName;
    if (quesSpan) quesSpan.innerText = (totalTurnQues > 0) ? `CÂU HỎI ${relativeQues}/${totalTurnQues}` : "HẾT CÂU HỎI";
    if (timeSpan) timeSpan.innerText = `THỜI GIAN: ${timeStr}`;

    window.compressBadgeText('roundText');
    window.compressBadgeText('quesText');
    window.compressBadgeText('timeText');
}

// --- HÀM NÚT ĐIỀU KHIỂN ---
window.triggerAction = function(btn, keyStr) {
  if(btn) {
    btn.classList.add('active');
    
    if (keyStr >= '1' && keyStr <= '6') {
        document.querySelectorAll('.player-btn').forEach(b => b.classList.remove('is-turn'));
        btn.classList.add('is-turn');
        activePlayerIndex = parseInt(keyStr);
        isPlayersShown = true;
    } else if (keyStr === '0') {
        document.querySelectorAll('.player-btn').forEach(b => b.classList.remove('is-turn'));
        activePlayerIndex = null;
        isPlayersShown = true;
    } else if (keyStr === 'r') {
        document.querySelectorAll('.player-btn').forEach(b => b.classList.remove('is-turn'));
        activePlayerIndex = null;
        isPlayersShown = false;
    }

    setTimeout(() => { btn.classList.remove('active'); }, 50);
  }

  if (keyStr >= '1' && keyStr <= '6') {
      let pIdx = parseInt(keyStr);
      let A = parseInt(lr_config.so_cau) || 0;
      if (A > 0) {
          currentQuesIndex = (pIdx - 1) * A + 1;
          updateQAPreview();
      }
  } 
  else if (keyStr === 'n') {
      currentQuesIndex++;
      updateQAPreview();
  }

  if (keyStr === 's') channel.postMessage({ action: 'show_graphic' });
  else if (keyStr === '0') channel.postMessage({ action: 'show_players', players: globalPlayers });
  else if (keyStr >= '1' && keyStr <= '6') channel.postMessage({ action: 'active_player', index: parseInt(keyStr), players: globalPlayers });
  else if (keyStr === 'q' || keyStr === 'n') {
      if (round1Questions && round1Questions[currentQuesIndex]) channel.postMessage({ action: 'show_question', text: round1Questions[currentQuesIndex].cau_hoi });
  } else if (keyStr === 'r') channel.postMessage({ action: 'reset_graphic' });
  else if (keyStr === 't5') {
      const timeSpan = document.getElementById('timeText');

      if (isTimer5sRunning) {
          channel.postMessage({ action: 'stop_5s' }); 
          if (ctrlTimerInterval) clearInterval(ctrlTimerInterval);
          isTimer5sRunning = false;
          updateQAPreview();
      } else {
          channel.postMessage({ action: 'start_5s' }); 
          isTimer5sRunning = true;
          if (ctrlTimerInterval) clearInterval(ctrlTimerInterval);
          
          let timeLeft = 5;
          if (timeSpan) {
              timeSpan.innerText = `THỜI GIAN: ${timeLeft}s`;
              window.compressBadgeText('timeText');
          }
          
          ctrlTimerInterval = setInterval(() => {
              timeLeft--;
              if (timeLeft > 0) {
                  if (timeSpan) {
                      timeSpan.innerText = `THỜI GIAN: ${timeLeft}s`;
                      window.compressBadgeText('timeText');
                  }
              } else {
                  if (timeSpan) {
                      timeSpan.innerText = `HẾT GIỜ`;
                      window.compressBadgeText('timeText');
                  }
                  clearInterval(ctrlTimerInterval);
                  isTimer5sRunning = false;
                  setTimeout(() => {
                      if (!isTimer5sRunning) updateQAPreview();
                  }, 1500);
              }
          }, 1000);
      }
  }
};

window.triggerScore = function(btn, type) {
    if(btn) {
        btn.classList.add('active');
        setTimeout(() => { btn.classList.remove('active'); }, 500);
    }

    if (!activePlayerIndex) {
        alert("⚠️ Vui lòng chọn (nhấn nút P1-P4) để xác định thí sinh nhận điểm!");
        return;
    }

    let selectVal = document.getElementById('turnStatus').value;
    let dDung = 0, dSai = 0;
    
    if (selectVal === 'rieng') {
        dDung = Number(document.getElementById('lr_diemdung').value);
        dSai = Number(document.getElementById('lr_diemsai').value);
    } else if (selectVal.startsWith('chung_')) {
        let idx = parseInt(selectVal.split('_')[1]);
        dDung = Number(document.getElementById(`lc_diemdung_${idx}`).value);
        dSai = Number(document.getElementById(`lc_diemsai_${idx}`).value);
    }
    
    let delta = (type === 'add') ? dDung : dSai;
    let currentScore = globalPlayers[activePlayerIndex]?.score || 0;
    
    window.updateScoreDB(activePlayerIndex, currentScore + delta);
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

// ==========================================
// LẮNG NGHE DỮ LIỆU REALTIME TỪ FIREBASE
// ==========================================

onValue(ref(db, 'games/players'), (snapshot) => {
    if (snapshot.exists()) {
        globalPlayers = snapshot.val(); 
        const players = snapshot.val();
        
        for (let i = 1; i <= 4; i++) {
            if (players[i]) {
                const spanEl = document.getElementById(`playerBtnText-${i}`);
                if (spanEl) {
                    spanEl.innerText = `${players[i].name} (${players[i].score})`;
                    window.compressBadgeText(`playerBtnText-${i}`);
                }
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