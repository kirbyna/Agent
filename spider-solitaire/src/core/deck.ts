import { Card, Difficulty, SUITS_BY_DIFFICULTY, CARDS_PER_SUIT_RUN } from "./types";

const TOTAL_CARDS = 104;

/** Deterministic PRNG (mulberry32) so tests and replays can be reproduced from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds the unshuffled 104-card deck for a difficulty (1/2/4 suits repeated to fill the deck). */
export function createDeck(difficulty: Difficulty): Card[] {
  const suits = SUITS_BY_DIFFICULTY[difficulty];
  const copiesPerSuit = TOTAL_CARDS / (CARDS_PER_SUIT_RUN * suits.length);
  const deck: Card[] = [];
  let sequence = 0;
  for (const suit of suits) {
    for (let copy = 0; copy < copiesPerSuit; copy++) {
      for (let rank = 1; rank <= CARDS_PER_SUIT_RUN; rank++) {
        deck.push({ id: `${suit}-${rank}-${copy}-${sequence++}`, rank, suit, faceUp: false });
      }
    }
  }
  return deck;
}

/** Fisher-Yates shuffle. Pure: returns a new array, never mutates the input. */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = result[i]!;
    const b = result[j]!;
    result[i] = b;
    result[j] = a;
  }
  return result;
}
