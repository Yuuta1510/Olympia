const state = window.PlayerState;

function renderMainView() {
  if (!state || state.activeTab !== "M") return;

  for (let i = 1; i <= 4; i++) {
    const p = state.players?.[i] || {};
    const displayName = String(p.name || `P${i}`).trim() || `P${i}`;
    const score = Number(p.score) || 0;

    const nameEl = document.getElementById(`playerMainName-${i}`);
    const scoreEl = document.getElementById(`playerMainScore-${i}`);

    if (nameEl) nameEl.textContent = displayName;
    if (scoreEl) scoreEl.textContent = String(score);
  }
}

window.renderActivePlayerRound = renderMainView;
window.cleanupCurrentRound = () => {
  window.renderActivePlayerRound = null;
};

renderMainView();