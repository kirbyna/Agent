import { Suit } from "./types";

const RANK_LABELS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function rankLabel(rank: number): string {
  return RANK_LABELS[rank - 1] ?? String(rank);
}

export function isRedSuit(suit: Suit): boolean {
  return suit === "♥" || suit === "♦";
}

export function difficultyLabel(difficulty: "easy" | "medium" | "hard"): string {
  if (difficulty === "easy") return "쉬움 · 1수트";
  if (difficulty === "medium") return "보통 · 2수트";
  return "어려움 · 4수트";
}
