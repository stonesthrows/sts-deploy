function timerTabInit() { /* timer now lives inline in the restock queue */ }

// ── ⋯ Overflow menu toggle ─────────────────────
function toggleKbOverflow() {
  document.getElementById('kbOverflowMenu').classList.toggle('open');
}
// Close overflow menu when clicking outside it
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('kbOverflowWrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('kbOverflowMenu').classList.remove('open');
  }
});

// ── Stat card → kanban filter ──────────────────
window.kanbanStatFilter = null;
window.kanbanStatFilterKey = null;

function applyStatFilter(key) {
  if (window.kanbanStatFilterKey === key) {
    // Toggle off
    window.kanbanStatFilter = null;
    window.kanbanStatFilterKey = null;
  } else {
    window.kanbanStatFilterKey = key;
    if (key === 'active') {
      window.kanbanStatFilter = null; // active = no extra filter needed
    } else if (key === 'due') {
      window.kanbanStatFilter = o => {
        if (!o.deadline) return false;
        const diff = Math.round((new Date(o.deadline) - TODAY) / 86400000);
        return diff >= 0 && diff <= 7;
      };
    } else if (key === 'materials') {
      window.kanbanStatFilter = o => o.stage === 'order-mat' || o.stage === 'materials';
    } else if (key === 'bench') {
      window.kanbanStatFilter = o => o.stage === 'build';
    }
  }
  // Update visual active state on cards
  ['active','due','materials','bench'].forEach(k => {
    const el = document.getElementById('scard-' + k);
    if (el) el.classList.toggle('stat-active-filter', k === window.kanbanStatFilterKey);
  });
  if (typeof renderKanban === 'function') renderKanban();
}
