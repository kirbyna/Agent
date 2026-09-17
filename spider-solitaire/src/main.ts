import {
  canMoveFrom,
  canPlaceRun,
  Card,
  dealFromStock,
  dealNewGame,
  Difficulty,
  difficultyLabel,
  findAllHints,
  findAutoCompletePlan,
  findAutoTarget,
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
  originRect: DOMRect | null;
  cardEls: HTMLElement[];
  ghostEl: HTMLElement | null;
  snappedCol: number | null;
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
let hintTimer: number | null = null;
let hintIndex = 0;
let hintStateRef: GameState | null = null;

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

/** Short haptic buzz for a completed K..A run, on devices/browsers that support it. */
function vibrateOnCollect() {
  navigator.vibrate?.(60);
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

/* ---------------- Win history / rankings ---------------- */

const HISTORY_KEY = "spider-solitaire:history:v1";
const MAX_HISTORY_ENTRIES = 50;
const RANKING_BADGE_CUTOFF = 10;

interface GameRecord {
  difficulty: Difficulty;
  score: number;
  timeSeconds: number;
  moves: number;
  date: number;
}

function loadHistory(): GameRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as GameRecord[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(records: GameRecord[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(records));
  } catch {
    // ignore
  }
}

/** Appends a win, re-sorts by score (then time) and trims the list, returning
 *  the trimmed list plus this game's 1-based rank among same-difficulty wins
 *  (null once it falls outside the kept history, e.g. beyond MAX_HISTORY_ENTRIES). */
function recordHistory(record: GameRecord): { records: GameRecord[]; rank: number | null } {
  const records = loadHistory();
  records.push(record);
  records.sort((a, b) => b.score - a.score || a.timeSeconds - b.timeSeconds);
  const trimmed = records.slice(0, MAX_HISTORY_ENTRIES);
  saveHistory(trimmed);
  const sameDifficulty = trimmed.filter((r) => r.difficulty === record.difficulty);
  const index = sameDifficulty.indexOf(record);
  return { records: trimmed, rank: index === -1 ? null : index + 1 };
}

function formatShortDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function renderRankings(filter: "all" | Difficulty) {
  const records = loadHistory()
    .filter((r) => filter === "all" || r.difficulty === filter)
    .sort((a, b) => b.score - a.score || a.timeSeconds - b.timeSeconds);

  const listEl = $("rank-list");
  listEl.innerHTML = "";

  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "rank-empty";
    empty.textContent = "아직 기록이 없어요. 한 판 클리어해보세요!";
    listEl.appendChild(empty);
    return;
  }

  records.forEach((record, i) => {
    const row = document.createElement("div");
    const pos = i + 1;
    row.className = `rank-row${pos <= 3 ? ` top${pos}` : ""}`;

    const posEl = document.createElement("span");
    posEl.className = "rank-pos";
    posEl.textContent = String(pos);

    const info = document.createElement("div");
    info.className = "rank-info";
    const scoreEl = document.createElement("span");
    scoreEl.className = "rank-score";
    scoreEl.textContent = `${record.score}점`;
    const metaEl = document.createElement("span");
    metaEl.className = "rank-meta";
    metaEl.textContent = `${difficultyLabel(record.difficulty)} · ${formatMMSS(record.timeSeconds)} · ${formatShortDate(record.date)}`;
    info.append(scoreEl, metaEl);

    row.append(posEl, info);
    listEl.appendChild(row);
  });
}

function setRankingsFilter(filter: string) {
  document.querySelectorAll<HTMLElement>(".rank-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.filter === filter);
  });
  renderRankings(filter as "all" | Difficulty);
}

function spawnConfetti() {
  const colors = ["#f2c230", "#c8102e", "#eaf5ea", "#2aa04c"];
  const overlay = $("result-overlay");
  for (let i = 0; i < 24; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length]!;
    piece.style.animationDuration = `${900 + Math.random() * 500}ms`;
    piece.style.animationDelay = `${Math.random() * 200}ms`;
    overlay.appendChild(piece);
    piece.addEventListener("animationend", () => piece.remove(), { once: true });
  }
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
  showScreen("screen-game");
  render();
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
  showScreen("screen-game");
  render();
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
function animateTableauChanges(before: Map<string, CardSnapshot>, stockRect: DOMRect | null, collectColIndex: number | null) {
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

  // A completed run always ends up piled in the destination column (moveRun appends the
  // moved run onto it before collecting), so anchor every disappearing card's fly-away
  // there instead of at its own pre-move position — otherwise the moved portion (still at
  // its old source-column spot in this snapshot) and the portion already resident in the
  // destination flicker away from two different columns at once.
  const collectColEl =
    collectColIndex !== null ? document.querySelector<HTMLElement>(`.column[data-col="${collectColIndex}"]`) : null;
  const collectRect = collectColEl?.getBoundingClientRect() ?? null;

  before.forEach((snap, id) => {
    if (seenIds.has(id)) return;
    const clone = snap.clone;
    clone.className = "card face-up collect-fly";
    clone.style.position = "fixed";
    clone.style.margin = "0";
    clone.style.left = `${collectRect ? collectRect.left : snap.rect.left}px`;
    clone.style.top = `${collectRect ? collectRect.top : snap.rect.top}px`;
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

function renderAnimated(collectColIndex: number | null = null) {
  if (prefersReducedMotion()) {
    render();
    return;
  }
  const before = snapshotTableauCards();
  const stockBtn = document.getElementById("btn-stock") as HTMLButtonElement | null;
  const stockRect = stockBtn && stockBtn.style.visibility !== "hidden" ? stockBtn.getBoundingClientRect() : null;
  render();
  animateTableauChanges(before, stockRect, collectColIndex);
}

function renderTableau() {
  const tableauEl = $("tableau");
  tableauEl.innerHTML = "";
  let maxColumnLength = 0;

  state!.tableau.forEach((column, colIndex) => {
    maxColumnLength = Math.max(maxColumnLength, column.length);
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
        const suitColor = isRedSuit(card.suit) ? "var(--red-suit)" : "var(--black-suit)";

        const idx = document.createElement("span");
        idx.className = label.length > 1 ? "idx wide" : "idx";
        idx.style.color = suitColor;
        idx.innerHTML = `<span>${label}</span><span>${card.suit}</span>`;
        cardEl.appendChild(idx);

        const center = document.createElement("span");
        center.className = "center-mark";
        center.style.color = suitColor;
        center.textContent = card.suit;
        cardEl.appendChild(center);
      }
      if (selection && selection.col === colIndex && cardIndex >= selection.index) {
        cardEl.classList.add("selected");
      }
      colEl.appendChild(cardEl);
    });

    tableauEl.appendChild(colEl);
  });

  adjustCardOverlap(tableauEl, maxColumnLength);
}

const DEFAULT_CARD_OVERLAP = 0.76; // matches the CSS fallback (calc(-1 * var(--card-overlap, 76%)))
const MAX_CARD_OVERLAP = 0.9; // never shrink the visible sliver below ~10% of a card

/** Increases card overlap (shrinks the visible sliver) just enough that the tallest
 *  column still fits the tableau's height, instead of running off the bottom. */
function adjustCardOverlap(tableauEl: HTMLElement, maxColumnLength: number) {
  if (maxColumnLength <= 1) {
    tableauEl.style.removeProperty("--card-overlap");
    return;
  }
  const firstCard = tableauEl.querySelector<HTMLElement>(".card");
  const availableHeight = tableauEl.clientHeight;
  if (!firstCard || availableHeight <= 0) {
    tableauEl.style.removeProperty("--card-overlap");
    return;
  }
  const rect = firstCard.getBoundingClientRect();
  const cardHeight = rect.height;
  const cardWidth = rect.width;
  if (cardHeight <= 0 || cardWidth <= 0) return;

  // A few px of slack absorbs sub-pixel rounding across many stacked margins so the
  // tallest column doesn't end up sitting exactly on (or a hair past) the edge.
  const safeHeight = availableHeight - 16;

  // CSS resolves a vertical percentage margin against the containing block's WIDTH,
  // not this element's own height, so the visible "peek" per covered card is
  // cardHeight - overlapFraction * cardWidth, not cardHeight * (1 - overlapFraction).
  const defaultPeek = cardHeight - DEFAULT_CARD_OVERLAP * cardWidth;
  const neededHeight = cardHeight + (maxColumnLength - 1) * defaultPeek;
  if (neededHeight <= safeHeight) {
    tableauEl.style.removeProperty("--card-overlap");
    return;
  }

  const requiredOverlap = (maxColumnLength * cardHeight - safeHeight) / ((maxColumnLength - 1) * cardWidth);
  const clamped = Math.min(MAX_CARD_OVERLAP, Math.max(DEFAULT_CARD_OVERLAP, requiredOverlap));
  tableauEl.style.setProperty("--card-overlap", `${(clamped * 100).toFixed(2)}%`);
}

function currentCardOverlapFraction(): number {
  const raw = getComputedStyle($("tableau")).getPropertyValue("--card-overlap").trim();
  const pct = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(pct) ? pct / 100 : DEFAULT_CARD_OVERLAP;
}

function renderStock() {
  const rounds = Math.floor(state!.stock.length / 10);
  const btn = $("btn-stock") as HTMLButtonElement;
  btn.style.visibility = rounds > 0 ? "visible" : "hidden";
  btn.setAttribute("aria-label", `스톡에서 카드 배분 (${rounds}벌 남음)`);

  const stockCardsEl = $("stock-cards");
  stockCardsEl.innerHTML = "";
  for (let i = 0; i < rounds; i++) {
    const cardEl = document.createElement("span");
    cardEl.className = "stock-card";
    cardEl.style.transform = `translate(${i * 4}px, ${(rounds - 1 - i) * 2}px)`;
    stockCardsEl.appendChild(cardEl);
  }
}

function showResult(title: string, isWin: boolean) {
  $("result-title").textContent = title;
  $("result-time").textContent = formatMMSS(elapsedSeconds);
  $("result-moves").textContent = String(state!.moves);
  $("result-score").textContent = String(state!.score);
  $("result-icon").textContent = isWin ? "🏆" : "🕸️";
  ($("result-overlay") as HTMLElement).hidden = false;
  if (isWin) spawnConfetti();
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

    const { rank } = recordHistory({
      difficulty: state.difficulty,
      score: state.score,
      timeSeconds: elapsedSeconds,
      moves: state.moves,
      date: Date.now(),
    });
    const rankEl = $("result-rank");
    if (rank !== null && rank <= RANKING_BADGE_CUTOFF) {
      rankEl.textContent = `${difficultyLabel(state.difficulty)} 역대 ${rank}위!`;
      rankEl.hidden = false;
    } else {
      rankEl.hidden = true;
    }

    showResult("승리!", true);
    return;
  }
  $("overlay-best").hidden = true;
  $("result-rank").hidden = true;
  if (!hasAnyMove(state)) {
    stopTimer();
    clearSavedGame();
    showResult("더 이상 이동할 수 없어요", false);
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
  const completed = next.completedSuits.length > prev.completedSuits.length;
  renderAnimated(completed ? toCol : null);
  if (completed) {
    playCollectSound();
    vibrateOnCollect();
  } else {
    playMoveSound();
  }
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
    const completed = next.completedSuits.length > prev.completedSuits.length;
    renderAnimated(completed ? colIndex : null);
    if (completed) {
      playCollectSound();
      vibrateOnCollect();
    } else {
      playMoveSound();
    }
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
    originRect: null,
    cardEls: [],
    ghostEl: null,
    snappedCol: null,
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
  drag.originRect = rect;

  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.style.width = `${rect.width}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;

  const stepOffset = rect.height - currentCardOverlapFraction() * rect.width;
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

function clearDropHighlight() {
  document.querySelectorAll<HTMLElement>(".column.drop-ready").forEach((el) => el.classList.remove("drop-ready"));
}

const SNAP_MAGNET_PX = 32; // how far outside the tableau a drop still counts, for a magnetic feel

/** Finds the valid drop column (if any) near the pointer, and where the run should
 *  visually snap to land on it, so a hover anywhere near a legal target sticks like a magnet.
 *  Picks the horizontally nearest column within the tableau's vertical span (plus a margin)
 *  instead of requiring the pointer to sit exactly over rendered card elements. */
function findSnapTarget(clientX: number, clientY: number): { colEl: HTMLElement; colIndex: number; left: number; top: number } | null {
  if (!state || !drag) return null;
  const tableauEl = $("tableau");
  const tableauRect = tableauEl.getBoundingClientRect();
  if (
    clientY < tableauRect.top - SNAP_MAGNET_PX ||
    clientY > tableauRect.bottom + SNAP_MAGNET_PX ||
    clientX < tableauRect.left - SNAP_MAGNET_PX ||
    clientX > tableauRect.right + SNAP_MAGNET_PX
  ) {
    return null;
  }

  let nearest: HTMLElement | null = null;
  let bestDist = Infinity;
  tableauEl.querySelectorAll<HTMLElement>(".column").forEach((el) => {
    const rect = el.getBoundingClientRect();
    const dist = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
    if (dist < bestDist) {
      bestDist = dist;
      nearest = el;
    }
  });
  if (!nearest) return null;
  const colEl: HTMLElement = nearest;
  const colIndex = Number(colEl.dataset.col);
  if (colIndex === drag.fromCol) return null;

  const run = state.tableau[drag.fromCol]!.slice(drag.cardIndex);
  if (!canPlaceRun(run, state.tableau[colIndex]!)) return null;

  const colRect = colEl.getBoundingClientRect();
  const existingCards = colEl.querySelectorAll<HTMLElement>(".card");
  if (existingCards.length === 0 || !drag.originRect) {
    return { colEl, colIndex, left: colRect.left, top: colRect.top };
  }
  const lastCardRect = existingCards[existingCards.length - 1]!.getBoundingClientRect();
  const stepOffset = drag.originRect.height - currentCardOverlapFraction() * drag.originRect.width;
  return { colEl, colIndex, left: lastCardRect.left, top: lastCardRect.top + stepOffset };
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
  if (!drag.ghostEl || !drag.originRect) return;

  const snap = findSnapTarget(event.clientX, event.clientY);
  if (snap) {
    if (drag.snappedCol !== snap.colIndex) {
      clearDropHighlight();
      snap.colEl.classList.add("drop-ready");
      drag.snappedCol = snap.colIndex;
    }
    drag.ghostEl.style.transition = "transform 0.12s ease";
    drag.ghostEl.style.transform = `translate(${snap.left - drag.originRect.left}px, ${snap.top - drag.originRect.top}px)`;
  } else {
    if (drag.snappedCol !== null) {
      clearDropHighlight();
      drag.snappedCol = null;
    }
    drag.ghostEl.style.transition = "none";
    drag.ghostEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}

function endDrag() {
  if (!drag) return;
  clearDropHighlight();
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
  const toCol = drag.snappedCol;
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
    playInvalidSound();
    showToast("더 이상 스톡이 없습니다");
    return;
  }
  history.push(prev);
  state = next;
  selection = null;
  renderAnimated();
  playDealSound();
  if (next.completedSuits.length > prev.completedSuits.length) {
    playCollectSound();
    vibrateOnCollect();
  }
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

  const plan = findAutoCompletePlan(state);
  if (!plan) {
    showToast("지금은 자동 정리를 끝까지 진행할 수 없어요");
    return;
  }

  autoCompleting = true;
  updateAutoCompleteVisibility();

  let stepIndex = 0;
  const step = () => {
    if (!state || stepIndex >= plan.length) {
      autoCompleting = false;
      updateAutoCompleteVisibility();
      return;
    }
    const move = plan[stepIndex++]!;
    const success = commitMove(move.fromCol, move.cardIndex, move.toCol);
    if (!success || isWon(state)) {
      autoCompleting = false;
      updateAutoCompleteVisibility();
      return;
    }
    window.setTimeout(step, 260);
  };
  step();
}

function clearHintHighlight() {
  document.querySelectorAll<HTMLElement>(".card.hint").forEach((el) => el.classList.remove("hint"));
  document.querySelectorAll<HTMLElement>(".column.hint-target").forEach((el) => el.classList.remove("hint-target"));
  $("btn-stock").classList.remove("hint");
}

function handleHintClick() {
  if (!state || autoCompleting) return;

  if (state !== hintStateRef) {
    hintStateRef = state;
    hintIndex = 0;
  }

  const hints = findAllHints(state);
  if (hints.length === 0) {
    showToast("가능한 이동이 없습니다");
    return;
  }
  const hint = hints[hintIndex % hints.length]!;
  hintIndex++;

  if (hintTimer !== null) window.clearTimeout(hintTimer);
  clearHintHighlight();

  if (hint.type === "deal") {
    $("btn-stock").classList.add("hint");
    hintTimer = window.setTimeout(clearHintHighlight, 1200);
    return;
  }
  const columns = document.querySelectorAll<HTMLElement>(".column");
  const fromColEl = columns[hint.fromCol];
  const toColEl = columns[hint.toCol];
  fromColEl?.querySelectorAll<HTMLElement>(".card").forEach((cardEl) => {
    if (Number(cardEl.dataset.index) >= hint.cardIndex) cardEl.classList.add("hint");
  });
  toColEl?.classList.add("hint-target");
  hintTimer = window.setTimeout(clearHintHighlight, 1200);
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

$("btn-rankings").addEventListener("click", () => {
  setRankingsFilter("all");
  showScreen("screen-rankings");
});
$("btn-view-rankings").addEventListener("click", () => {
  setRankingsFilter("all");
  showScreen("screen-rankings");
});
$("btn-rankings-back").addEventListener("click", () => {
  refreshResumeButton();
  showScreen("screen-start");
});
document.querySelectorAll<HTMLElement>(".rank-tab").forEach((tab) => {
  tab.addEventListener("click", () => setRankingsFilter(tab.dataset.filter!));
});

refreshResumeButton();
