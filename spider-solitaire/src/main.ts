import {
  canMoveFrom,
  Card,
  dealFromStock,
  dealNewGame,
  Difficulty,
  difficultyLabel,
  findHint,
  GameState,
  hasAnyMove,
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

let state: GameState | null = null;
let history: GameState[] = [];
let selection: { col: number; index: number } | null = null;
let timerId: number | null = null;
let elapsedSeconds = 0;
let toastTimer: number | null = null;

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
  const m = Math.floor(elapsedSeconds / 60).toString().padStart(2, "0");
  const s = (elapsedSeconds % 60).toString().padStart(2, "0");
  $("stat-time").textContent = `${m}:${s}`;
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
}

function renderTableau() {
  const tableauEl = $("tableau");
  tableauEl.innerHTML = "";
  state!.tableau.forEach((column, colIndex) => {
    const colEl = document.createElement("div");
    colEl.className = "column";
    colEl.dataset.col = String(colIndex);

    column.forEach((card: Card, cardIndex) => {
      const cardEl = document.createElement("div");
      cardEl.className = `card ${card.faceUp ? "face-up" : "face-down"}`;
      cardEl.dataset.col = String(colIndex);
      cardEl.dataset.index = String(cardIndex);

      if (card.faceUp) {
        const idx = document.createElement("span");
        idx.className = "idx";
        idx.style.color = isRedSuit(card.suit) ? "var(--red-suit)" : "var(--black-suit)";
        idx.innerHTML = `<span>${rankLabel(card.rank)}</span><span>${card.suit}</span>`;
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
  $("result-time").textContent = $("stat-time").textContent ?? "00:00";
  $("result-moves").textContent = String(state!.moves);
  $("result-score").textContent = String(state!.score);
  ($("result-overlay") as HTMLElement).hidden = false;
}

function checkGameEnd() {
  if (!state) return;
  if (isWon(state)) {
    stopTimer();
    showResult("승리!");
    return;
  }
  if (!hasAnyMove(state)) {
    stopTimer();
    showResult("더 이상 이동할 수 없어요");
  }
}

function handleTableauClick(event: MouseEvent) {
  if (!state) return;
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
      render();
    }
    return;
  }

  if (selection.col === colIndex) {
    selection = null;
    render();
    return;
  }

  const prev = state;
  const next = moveRun(state, selection.col, selection.index, colIndex);
  if (next) {
    selection = null;
    history.push(prev);
    state = next;
    render();
    checkGameEnd();
    return;
  }

  // Move failed — if the tapped card is itself a valid pick-up, switch the selection to it
  // instead of just complaining, since that's almost certainly what the player meant.
  if (cardIndex !== null && canMoveFrom(state.tableau[colIndex]!, cardIndex)) {
    selection = { col: colIndex, index: cardIndex };
    render();
    return;
  }

  selection = null;
  showToast("이동할 수 없습니다");
  render();
}

function handleStockClick() {
  if (!state) return;
  const prev = state;
  const next = dealFromStock(state);
  if (!next) {
    const hasEmptyColumn = state.tableau.some((column) => column.length === 0);
    showToast(hasEmptyColumn ? "빈 컬럼이 있어 딜할 수 없습니다" : "더 이상 스톡이 없습니다");
    return;
  }
  history.push(prev);
  state = next;
  selection = null;
  render();
  checkGameEnd();
}

function handleUndoClick() {
  if (history.length === 0) return;
  state = history.pop()!;
  selection = null;
  render();
}

function handleHintClick() {
  if (!state) return;
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
$("btn-stock").addEventListener("click", handleStockClick);
$("btn-undo").addEventListener("click", handleUndoClick);
$("btn-hint").addEventListener("click", handleHintClick);

$("btn-back").addEventListener("click", () => {
  stopTimer();
  showScreen("screen-start");
});
$("btn-newgame").addEventListener("click", () => {
  stopTimer();
  showScreen("screen-start");
});
$("btn-retry").addEventListener("click", () => {
  if (!state) return;
  startGame(state.difficulty, difficultyLabel(state.difficulty));
});
$("btn-change-level").addEventListener("click", () => {
  ($("result-overlay") as HTMLElement).hidden = true;
  stopTimer();
  showScreen("screen-start");
});
