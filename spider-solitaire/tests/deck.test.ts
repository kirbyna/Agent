import { describe, expect, it } from "vitest";
import { createDeck, mulberry32, shuffle } from "../src/core/deck";
import { Difficulty } from "../src/core/types";

describe("createDeck", () => {
  it.each<[Difficulty, number]>([
    ["easy", 1],
    ["medium", 2],
    ["hard", 4],
  ])("builds a 104-card deck with %s suits", (difficulty, expectedSuitCount) => {
    const deck = createDeck(difficulty);
    expect(deck).toHaveLength(104);

    const suits = new Set(deck.map((c) => c.suit));
    expect(suits.size).toBe(expectedSuitCount);

    for (const suit of suits) {
      const cardsOfSuit = deck.filter((c) => c.suit === suit);
      // each suit's 13 ranks appear the same number of times, filling out 104 cards
      expect(cardsOfSuit.length).toBe(104 / expectedSuitCount);
      for (let rank = 1; rank <= 13; rank++) {
        expect(cardsOfSuit.filter((c) => c.rank === rank).length).toBe(cardsOfSuit.length / 13);
      }
    }

    expect(deck.every((c) => c.faceUp === false)).toBe(true);
  });
});

describe("shuffle", () => {
  it("does not mutate the input array", () => {
    const input = [1, 2, 3, 4, 5];
    const copy = input.slice();
    shuffle(input, mulberry32(1));
    expect(input).toEqual(copy);
  });

  it("is deterministic for a given seed", () => {
    const a = shuffle([1, 2, 3, 4, 5, 6, 7, 8], mulberry32(42));
    const b = shuffle([1, 2, 3, 4, 5, 6, 7, 8], mulberry32(42));
    expect(a).toEqual(b);
  });

  it("preserves all elements", () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    const result = shuffle(input, mulberry32(7));
    expect(result.slice().sort((a, b) => a - b)).toEqual(input);
  });
});
