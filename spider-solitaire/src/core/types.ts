export type Suit = "♠" | "♥" | "♦" | "♣";
export type Difficulty = "easy" | "medium" | "hard";

export interface Card {
  id: string;
  rank: number; // 1 = Ace ... 11 = J, 12 = Q, 13 = K
  suit: Suit;
  faceUp: boolean;
}

export interface GameState {
  difficulty: Difficulty;
  tableau: Card[][]; // 10 columns, last element of each array is the top card
  stock: Card[]; // remaining cards, dealt 10 at a time (one per column)
  completedSuits: Suit[]; // one entry per fully collected K..A run, length 0-8
  score: number;
  moves: number;
}

export const COLUMN_COUNT = 10;
export const CARDS_PER_SUIT_RUN = 13;
export const STOCK_DEAL_SIZE = COLUMN_COUNT;

export const SUITS_BY_DIFFICULTY: Record<Difficulty, Suit[]> = {
  easy: ["♠"],
  medium: ["♠", "♥"],
  hard: ["♠", "♥", "♦", "♣"],
};
