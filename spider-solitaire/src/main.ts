import {
  canMoveFrom,
  Card,
  dealFromStock,
  dealNewGame,
  Difficulty,
  difficultyLabel,
  findAutoTarget,
  findHint,
  GameState,
  hasAnyMove,
  isBoardFullyRevealed,
  isRedSuit,
  isWon,
  moveRun,
  rankLabel,
} from "./core";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

interface DragState {
  pointerId: number;
  fromCol: number;
  cardIndex: number;
  startX: number;
  startY: number;
  moved: boolean;
  originEl: HTMLElement;
  cardEls: HTMLElement[];
  ghostEl: HTMLElement | null;
}

const DRAG_THRESHOLD_PX = 6;

let state: GameState | null = null;
let history: GameState[] = [];
let selection: { col: number; index: number } | null = null;
let timerId: number | null = null;
let elapsedSeconds = 0;
let toastTimer: number | null = null;
let drag: DragState | null = null;
let suppressNextClick = false;
let autoCompleting = false;

/* ---------------- Sound ---------------- */

const SOUND_KEY = "spider-solitaire:sound:v1";
let soundEnabled = loadSoundPref();
let audioCtx: AudioContext | null = null;

function loadSoundPref(): boolean {
  try {
    const raw = localStorage.getItem(SOUND_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

function saveSoundPref() {
  try {
    localStorage.setItem(SOUND_KEY, soundEnabled ? "1" : "0");
  } catch {
    // ignore
  }
}

function ensureAudioContext(): AudioContext | null {
  if (!soundEnabled) return null;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

function playTone(freq: number, durationMs: number, type: OscillatorType = "sine", peak = 0.07) {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.03);
}

function playMoveSound() { playTone(520, 90, "triangle", 0.05); }
function playDealSound() { playTone(360, 70, "square", 0.035); }
function playInvalidSound() { playTone(160, 130, "sawtooth", 0.04); }
function playCollectSound() {
  [660, 880, 1046].forEach((f, i) => window.setTimeout(() => playTone(f, 140, "sine", 0.05), i * 70));
}
function playWinSound() {
  [523, 659, 784, 1047].forEach((f, i) => window.setTimeout(() => playTone(f, 200, "sine", 0.055), i * 120));
}

function updateSoundButton() {
  const btn = $("btn-sound");
  btn.classList.toggle("muted", !soundEnabled);
  btn.setAttribute("aria-label", soundEnabled ? "효과음 끄기" : "효과음 켜기");
  const wave = document.getElementById("sound-wave") as SVGElement | null;
  if (wave) wave.style.display = soundEnabled ? "" : "none";
}

/* ---------------- Best-score tracking ---------------- */

const STATS_KEY = "spider-solitaire:stats:v1";

interface DifficultyStats {
  bestScore: number;
  bestTimeSeconds: number;
  wins: number;
}

type StatsMap = Partial<Record<Difficulty, DifficultyStats>>;

function loadStats(): StatsMap {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    return raw ? (JSON.parse(raw) as StatsMap) : {};
  } catch {
    return {};
  }
}

function saveStats(stats: StatsMap) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // ignore
  }
}

function recordWin(difficulty: Difficulty, score: number, timeSeconds: number) {
  const stats = loadStats();
  const prev = stats[difficulty];
  const isNewScore = !prev || score > prev.bestScore;
  const isNewTime = !prev || timeSeconds < prev.bestTimeSeconds;
  const next: DifficultyStats = {
    bestScore: prev ? Math.max(prev.bestScore, score) : score,
    bestTimeSeconds: prev ? Math.min(prev.bestTimeSeconds, timeSeconds) : timeSeconds,
    wins: (prev?.wins ?? 0) + 1,
  };
  stats[difficulty] = next;
  saveStats(stats);
  return { best: next, isNewRecord: isNewScore || isNewTime };
}

function formatMMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

const SAVE_KEY = "spider-solitaire:save:v1";

interface SavedGame {
  state: GameState;
  elapsedSeconds: number;
}

function saveGame() {
  if (!state) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ state, elapsedSeconds } satisfies SavedGame));
  } catch {
    // storage unavailable (private mode, quota, etc.) — resuming just won't be offered
  }
}

function loadSavedGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as SavedGame) : null;
  } catch {
    return null;
  }
}

function clearSavedGame() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}

function refreshResumeButton() {
  const saved = loadSavedGame();
  const btn = $("btn-resume") as HTMLButtonElement;
  btn.disabled = !saved;
  btn.textContent = saved ? `이어하기 · ${difficultyLabel(saved.state.difficulty)}` : "이어하기 · 저장된 게임 없음";
}

function resumeGame() {
  const saved = loadSavedGame();
  if (!saved) return;
  state = saved.state;
  history = [];
  selection = null;
  elapsedSeconds = saved.elapsedSeconds;
  $("chip-level").textContent = difficultyLabel(state.difficulty);
  updateTimeDisplay();
  (document.getElementById("result-overlay") as HTMLElement).hidden = true;
  render();
  showScreen("screen-game");
  startTimer();
}

function showScreen(id: string) {
  document.querySelectorAll<HTMLElement>(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
}

function startTimer() {
  stopTimer();
  timerId = window.setInterval(() => {
    elapsedSeconds++;
    updateTimeDisplay();
  }, 1000);
}

function stopTimer() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

function updateTimeDisplay() {
  $("stat-time").textContent = formatMMSS(elapsedSeconds);
}

function showToast(message: string) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 1400);
}

function startGame(level: Difficulty, label: string) {
  state = dealNewGame(level);
  history = [];
  selection = null;
  elapsedSeconds = 0;
  $("chip-level").textContent = label;
  updateTimeDisplay();
  ($("result-overlay") as HTMLElement).hidden = true;
  render();
  showScreen("screen-game");
  startTimer();
}

function render() {
  if (!state) return;
  renderTableau();
  renderStock();
  $("stat-moves").textContent = String(state.moves);
  $("stat-score").textContent = String(state.score);
  ($("btn-undo") as HTMLButtonElement).disabled = history.length === 0;
  updateAutoCompleteVisibility();
  saveGame();
}

function updateAutoCompleteVisibility() {
  const btn = $("btn-autocomplete") as HTMLButtonElement;
  btn.hidden = autoCompleting || !state || isWon(state) || !isBoardFullyRevealed(state);
}

interface CardSnapshot {
  rect: DOMRect;
  clone: HTMLElement;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function snapshotTableauCards(): Map<string, CardSnapshot> {
  const snapshots = new Map<string, CardSnapshot>();
  document.querySelectorAll<HTMLElement>("#tableau .card[data-card-id]").forEach((el) => {
    const id = el.dataset.cardId!;
    snapshots.set(id, { rect: el.getBoundingClientRect(), clone: el.cloneNode(true) as HTMLElement });
  });
  return snapshots;
}

/**
 * FLIP-animates cards that moved between the snapshot and the DOM render() just produced.
 * A card with no prior snapshot only ever means one thing here (startGame/resumeGame use the
 * plain, unanimated render() instead) — it just landed from a stock deal — so it flies in from
 * the stock pile's position, staggered by column. A card that vanished entirely (a completed
 * K..A run being collected) flies up and fades out from where it sat.
 */
function animateTableauChanges(before: Map<string, CardSnapshot>, stockRect: DOMRect | null) {
  const seenIds = new Set<string>();
  let dealIndex = 0;

  document.querySelectorAll<HTMLElement>("#tableau .card[data-card-id]").forEach((el) => {
    const id = el.dataset.cardId!;
    seenIds.add(id);
    const prev = before.get(id);

    if (!prev) {
      if (!stockRect) {
        el.classList.add("deal-in");
        el.addEventListener("animationend", () => el.classList.remove("deal-in"), { once: true });
        return;
      }
      const rect = el.getBoundingClientRect();
      const dx = stockRect.left - rect.left;
      const dy = stockRect.top - rect.top;
      const delay = dealIndex++ * 35;
      el.style.opacity = "0";
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px) scale(0.85)`;
      requestAnimationFrame(() => {
        el.style.transition = `transform 0.32s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, opacity 0.18s ease-out ${delay}ms`;
        el.style.transform = "";
        el.style.opacity = "1";
        el.addEventListener(
          "transitionend",
          () => {
            el.style.transition = "";
            el.style.opacity = "";
          },
          { once: true }
        );
      });
      return;
    }

    const rect = el.getBoundingClientRect();
    const dx = prev.rect.left - rect.left;
    const dy = prev.rect.top - rect.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = "transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)";
      el.style.transform = "";
      el.addEventListener("transitionend", () => (el.style.transition = ""), { once: true });
    });
  });

  before.forEach((snap, id) => {
    if (seenIds.has(id)) return;
    const clone = snap.clone;
    clone.className = "card face-up collect-fly";
    clone.style.position = "fixed";
    clone.style.margin = "0";
    clone.style.left = `${snap.rect.left}px`;
    clone.style.top = `${snap.rect.top}px`;
    clone.style.width = `${snap.rect.width}px`;
    clone.style.height = `${snap.rect.height}px`;
    document.body.appendChild(clone);
    requestAnimationFrame(() => {
      clone.style.transform = "translateY(-70px) scale(0.85)";
      clone.style.opacity = "0";
    });
    clone.addEventListener("transitionend", () => clone.remove(), { once: true });
    window.setTimeout(() => clone.remove(), 700);
  });
}

function renderAnimated() {
  if (prefersReducedMotion()) {
    render();
    return;
  }
  const before = snapshotTableauCards();
  const stockBtn = document.getElementById("btn-stock") as HTMLButtonElement | null;
  const stockRect = stockBtn && stockBtn.style.visibility !== "hidden" ? stockBtn.getBoundingClientRect() : null;
  render();
  animateTableauChanges(before, stockRect);
}

function renderTableau() {
  const tableauEl = $("tableau");
  tableauEl.innerHTML = "";
  state!.tableau.forEach((column, colIndex) => {
    const colEl = document.createElement("div");
    colEl.className = column.length === 0 ? "column empty" : "column";
    colEl.dataset.col = String(colIndex);

    column.forEach((card: Card, cardIndex) => {
      const cardEl = document.createElement("div");
      cardEl.className = `card ${card.faceUp ? "face-up" : "face-down"}`;
      cardEl.dataset.col = String(colIndex);
      cardEl.dataset.index = String(cardIndex);
      cardEl.dataset.cardId = card.id;

      if (card.faceUp) {
        const label = rankLabel(card.rank);
        const idx = document.createElement("span");
        idx.className = label.length > 1 ? "idx wide" : "idx";
        idx.style.color = isRedSuit(card.suit) ? "var(--red-suit)" : "var(--black-suit)";
        idx.innerHTML = `<span>${label}</span><span>${card.suit}</span>`;
        cardEl.appendChild(idx);
      }
      if (selection && selection.col === colIndex && cardIndex >= selection.index) {
        cardEl.classList.add("selected");
      }
      colEl.appendChild(cardEl);
    });

    tableauEl.appendChild(colEl);
  });
}

function renderStock() {
  const rounds = Math.floor(state!.stock.length / 10);
  $("stock-count").textContent = String(rounds);
  ($("btn-stock") as HTMLButtonElement).style.visibility = rounds > 0 ? "visible" : "hidden";
}

function showResult(title: string) {
  $("result-title").textContent = title;
  $("result-time").textContent = formatMMSS(elapsedSeconds);
  $("result-moves").textContent = String(state!.moves);
  $("result-score").textContent = String(state!.score);
  ($("result-overlay") as HTMLElement).hidden = false;
}

function checkGameEnd() {
  if (!state) return;
  if (isWon(state)) {
    stopTimer();
    clearSavedGame();
    playWinSound();
    const { best, isNewRecord } = recordWin(state.difficulty, state.score, elapsedSeconds);
    const bestEl = $("overlay-best");
    bestEl.textContent = `${isNewRecord ? "🏆 신기록! " : ""}최고 점수 ${best.bestScore} · 최단 시간 ${formatMMSS(
      best.bestTimeSeconds
    )} · ${best.wins}승`;
    bestEl.hidden = false;
    showResult("승리!");
    return;
  }
  $("overlay-best").hidden = true;
  if (!hasAnyMove(state)) {
    stopTimer();
    clearSavedGame();
    showResult("더 이상 이동할 수 없어요");
  }
}

/** Applies a move, animating and playing the appropriate sound. Returns whether it succeeded. */
function commitMove(fromCol: number, cardIndex: number, toCol: number): boolean {
  if (!state) return false;
  const prev = state;
  const next = moveRun(state, fromCol, cardIndex, toCol);
  if (!next) {
    playInvalidSound();
    showToast("이동할 수 없습니다");
    renderAnimated();
    return false;
  }
  selection = null;
  history.push(prev);
  state = next;
  renderAnimated();
  if (next.completedSuits.length > prev.completedSuits.length) playCollectSound();
  else playMoveSound();
  checkGameEnd();
  return true;
}

function handleTableauClick(event: MouseEvent) {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  if (!state || autoCompleting) return;
  const target = event.target as HTMLElement;
  const colEl = target.closest<HTMLElement>(".column");
  if (!colEl) return;
  const colIndex = Number(colEl.dataset.col);
  const cardEl = target.closest<HTMLElement>(".card");
  const cardIndex = cardEl ? Number(cardEl.dataset.index) : null;

  if (!selection) {
    if (cardIndex === null) return;
    if (canMoveFrom(state.tableau[colIndex]!, cardIndex)) {
      selection = { col: colIndex, index: cardIndex };
      renderAnimated();
    }
    return;
  }

  if (selection.col === colIndex) {
    selection = null;
    renderAnimated();
    return;
  }

  const prev = state;
  const next = moveRun(state, selection.col, selection.index, colIndex);
  if (next) {
    selection = null;
    history.push(prev);
    state = next;
    renderAnimated();
    if (next.completedSuits.length > prev.completedSuits.length) playCollectSound();
    else playMoveSound();
    checkGameEnd();
    return;
  }

  // Move failed — if the tapped card is itself a valid pick-up, switch the selection to it
  // instead of just complaining, since that's almost certainly what the player meant.
  if (cardIndex !== null && canMoveFrom(state.tableau[colIndex]!, cardIndex)) {
    selection = { col: colIndex, index: cardIndex };
    renderAnimated();
    return;
  }

  selection = null;
  playInvalidSound();
  showToast("이동할 수 없습니다");
  renderAnimated();
}

function handleTableauPointerDown(event: PointerEvent) {
  // A completed drag onto a different element never gets a follow-up native click (the
  // browser only fires one when pointerdown/up share the same target), so a pending
  // suppression flag from a prior drag would otherwise leak into this unrelated tap.
  suppressNextClick = false;
  if (!state || drag || !event.isPrimary || autoCompleting) return;
  const cardEl = (event.target as HTMLElement).closest<HTMLElement>(".card.face-up");
  if (!cardEl) return;
  const fromCol = Number(cardEl.dataset.col);
  const cardIndex = Number(cardEl.dataset.index);
  if (!canMoveFrom(state.tableau[fromCol]!, cardIndex)) return;

  cardEl.setPointerCapture(event.pointerId);
  drag = {
    pointerId: event.pointerId,
    fromCol,
    cardIndex,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    originEl: cardEl,
    cardEls: [],
    ghostEl: null,
  };
  cardEl.addEventListener("pointermove", handleDragPointerMove);
  cardEl.addEventListener("pointerup", handleDragPointerUp);
  cardEl.addEventListener("pointercancel", handleDragPointerCancel);
}

function beginDragVisuals() {
  if (!state || !drag) return;
  const column = state.tableau[drag.fromCol]!;
  const colEl = drag.originEl.closest<HTMLElement>(".column")!;
  const runCardEls = Array.from(colEl.querySelectorAll<HTMLElement>(".card")).filter(
    (el) => Number(el.dataset.index) >= drag!.cardIndex
  );

  const rect = drag.originEl.getBoundingClientRect();
  drag.cardEls = runCardEls;

  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.style.width = `${rect.width}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;

  const stepOffset = rect.height * 0.42; // mirrors the tableau's -58% overlap
  runCardEls.forEach((el, i) => {
    const card = column[drag!.cardIndex + i]!;
    const ghostCard = document.createElement("div");
    ghostCard.className = "card face-up";
    ghostCard.style.width = `${rect.width}px`;
    ghostCard.style.height = `${rect.height}px`;
    ghostCard.style.top = `${i * stepOffset}px`;
    const label = rankLabel(card.rank);
    const idx = document.createElement("span");
    idx.className = label.length > 1 ? "idx wide" : "idx";
    idx.style.color = isRedSuit(card.suit) ? "var(--red-suit)" : "var(--black-suit)";
    idx.innerHTML = `<span>${label}</span><span>${card.suit}</span>`;
    ghostCard.appendChild(idx);
    ghost.appendChild(ghostCard);
    el.classList.add("drag-hidden");
  });

  document.body.appendChild(ghost);
  drag.ghostEl = ghost;
  selection = null;
}

function handleDragPointerMove(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;

  if (!drag.moved) {
    if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    beginDragVisuals();
  }

  event.preventDefault();
  if (drag.ghostEl) drag.ghostEl.style.transform = `translate(${dx}px, ${dy}px)`;
}

function endDrag() {
  if (!drag) return;
  drag.cardEls.forEach((el) => el.classList.remove("drag-hidden"));
  drag.ghostEl?.remove();
  drag.originEl.removeEventListener("pointermove", handleDragPointerMove);
  drag.originEl.removeEventListener("pointerup", handleDragPointerUp);
  drag.originEl.removeEventListener("pointercancel", handleDragPointerCancel);
  drag = null;
}

function handleDragPointerUp(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { fromCol, cardIndex, moved } = drag;

  if (!moved) {
    endDrag();
    return; // treat as a plain tap — the browser's click event drives selection
  }

  event.preventDefault();
  const dropTarget = document.elementFromPoint(event.clientX, event.clientY);
  const dropColEl = dropTarget?.closest<HTMLElement>(".column");
  const toCol = dropColEl ? Number(dropColEl.dataset.col) : null;
  endDrag();
  suppressNextClick = true;

  if (!state || toCol === null || toCol === fromCol) {
    renderAnimated();
    return;
  }

  commitMove(fromCol, cardIndex, toCol);
}

function handleDragPointerCancel(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const wasMoved = drag.moved;
  endDrag();
  if (wasMoved) renderAnimated();
}

function handleStockClick() {
  if (!state || autoCompleting) return;
  const prev = state;
  const next = dealFromStock(state);
  if (!next) {
    const hasEmptyColumn = state.tableau.some((column) => column.length === 0);
    playInvalidSound();
    showToast(hasEmptyColumn ? "빈 컬럼을 먼저 채워야 딜할 수 있습니다" : "더 이상 스톡이 없습니다");
    return;
  }
  history.push(prev);
  state = next;
  selection = null;
  renderAnimated();
  playDealSound();
  checkGameEnd();
}

function handleUndoClick() {
  if (history.length === 0 || autoCompleting) return;
  state = history.pop()!;
  selection = null;
  renderAnimated();
}

function handleTableauDoubleClick(event: MouseEvent) {
  if (!state || autoCompleting) return;
  const cardEl = (event.target as HTMLElement).closest<HTMLElement>(".card.face-up");
  if (!cardEl) return;
  const fromCol = Number(cardEl.dataset.col);
  const cardIndex = Number(cardEl.dataset.index);
  const toCol = findAutoTarget(state, fromCol, cardIndex);
  if (toCol === null) {
    playInvalidSound();
    showToast("이동할 곳이 없습니다");
    return;
  }
  commitMove(fromCol, cardIndex, toCol);
}

function handleAutoCompleteClick() {
  if (!state || autoCompleting) return;
  autoCompleting = true;
  updateAutoCompleteVisibility();

  const step = () => {
    if (!state) {
      autoCompleting = false;
      return;
    }
    const hint = findHint(state);
    if (!hint || hint.type !== "move") {
      autoCompleting = false;
      updateAutoCompleteVisibility();
      checkGameEnd();
      return;
    }
    const success = commitMove(hint.fromCol, hint.cardIndex, hint.toCol);
    if (!success || isWon(state)) {
      autoCompleting = false;
      updateAutoCompleteVisibility();
      return;
    }
    window.setTimeout(step, 260);
  };
  step();
}

function handleHintClick() {
  if (!state || autoCompleting) return;
  const hint = findHint(state);
  if (!hint) {
    showToast("가능한 이동이 없습니다");
    return;
  }
  if (hint.type === "deal") {
    const stockBtn = $("btn-stock");
    stockBtn.classList.add("hint");
    window.setTimeout(() => stockBtn.classList.remove("hint"), 1200);
    return;
  }
  const columns = document.querySelectorAll<HTMLElement>(".column");
  const fromColEl = columns[hint.fromCol];
  const toColEl = columns[hint.toCol];
  fromColEl?.querySelectorAll<HTMLElement>(".card").forEach((cardEl) => {
    if (Number(cardEl.dataset.index) >= hint.cardIndex) cardEl.classList.add("hint");
  });
  toColEl?.classList.add("hint-target");
  window.setTimeout(() => {
    fromColEl?.querySelectorAll<HTMLElement>(".card").forEach((cardEl) => cardEl.classList.remove("hint"));
    toColEl?.classList.remove("hint-target");
  }, 1200);
}

document.querySelectorAll<HTMLElement>(".tier").forEach((btn) => {
  btn.addEventListener("click", () => {
    const level = btn.dataset.level as Difficulty;
    const label = btn.dataset.label ?? difficultyLabel(level);
    startGame(level, label);
  });
});

$("tableau").addEventListener("click", handleTableauClick);
$("tableau").addEventListener("pointerdown", handleTableauPointerDown);
$("tableau").addEventListener("dblclick", handleTableauDoubleClick);
$("btn-stock").addEventListener("click", handleStockClick);
$("btn-undo").addEventListener("click", handleUndoClick);
$("btn-hint").addEventListener("click", handleHintClick);
$("btn-autocomplete").addEventListener("click", handleAutoCompleteClick);

$("btn-sound").addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  saveSoundPref();
  updateSoundButton();
  if (soundEnabled) playTone(700, 60, "sine", 0.05);
});
updateSoundButton();

$("btn-resume").addEventListener("click", resumeGame);

$("btn-back").addEventListener("click", () => {
  stopTimer();
  refreshResumeButton();
  showScreen("screen-start");
});
$("btn-newgame").addEventListener("click", () => {
  stopTimer();
  refreshResumeButton();
  showScreen("screen-start");
});
$("btn-retry").addEventListener("click", () => {
  if (!state) return;
  startGame(state.difficulty, difficultyLabel(state.difficulty));
});
$("btn-change-level").addEventListener("click", () => {
  ($("result-overlay") as HTMLElement).hidden = true;
  stopTimer();
  refreshResumeButton();
  showScreen("screen-start");
});

refreshResumeButton();
