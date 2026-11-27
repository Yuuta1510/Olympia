const state = window.HostState;

function renderMainView() {
  if (state.activeTab !== "M") return;
  document.getElementById("hostRoundSub").textContent = "DANH SÁCH 4 THÍ SINH (VỊ TRÍ 1 → 4)";

  for (let i = 1; i <= 4; i++) {
    const p = state.players[i] || {};
    const displayName = String(p.name || `P${i}`).trim() || `P${i}`;
    const fullName = String(p.fullName ?? p.full_name ?? p.ho_ten ?? "").trim();
    const hostPrimaryName = fullName || displayName;

    const info = String(p.info ?? p.thong_tin ?? p.description ?? p.details ?? "").trim();
    const avatarUrl = String(
      p.avatar || p.avatarUrl || p.avatar_url || p.img || p.image || ""
    ).trim();
    const score = Number(p.score) || 0;

    const nameEl = document.getElementById(`mainName-${i}`);
    const infoEl = document.getElementById(`mainInfo-${i}`);
    const scoreEl = document.getElementById(`mainScore-${i}`);
    const imgEl = document.getElementById(`mainAvatar-${i}`);
    const fbEl = document.getElementById(`mainFallback-${i}`);

    if (nameEl) nameEl.textContent = hostPrimaryName;
    if (infoEl) infoEl.textContent = info || "(Chưa có thông tin bổ sung)";
    if (scoreEl) scoreEl.textContent = String(score);
    if (fbEl) fbEl.textContent = `TS ${i}`;

    if (imgEl && fbEl) {
      if (avatarUrl) {
        imgEl.src = avatarUrl;
        imgEl.style.display = "block";
        fbEl.style.display = "none";
        imgEl.onerror = () => {
          imgEl.style.display = "none";
          fbEl.style.display = "block";
        };
      } else {
        imgEl.removeAttribute("src");
        imgEl.style.display = "none";
        fbEl.style.display = "block";
      }
    }
  }
}

window.renderActiveHostRound = renderMainView;
window.cleanupCurrentRound = () => {
  window.renderActiveHostRound = null;
};

renderMainView();