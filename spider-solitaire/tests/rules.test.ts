import { describe, expect, it } from "vitest";
import { canMoveFrom, canPlaceRun, getMovableRunLength, isCompletedSuitRun } from "../src/core/rules";
import { Card } from "../src/core/types";

let seq = 0;
function card(rank: number, suit: Card["suit"], faceUp = true): Card {
  return { id: `c${seq++}`, rank, suit, faceUp };
}

describe("getMovableRunLength", () => {
  it("is 0 for an empty column", () => {
    expect(getMovableRunLength([])).toBe(0);
  });

  it("is 0 when the top card is face-down", () => {
    expect(getMovableRunLength([card(5, "♠", false)])).toBe(0);
  });

  it("counts a single face-up card", () => {
    expect(getMovableRunLength([card(9, "♠", false), card(5, "♠")])).toBe(1);
  });

  it("counts a same-suit descending run from the top", () => {
    const column = [card(13, "♠", false), card(8, "♠"), card(7, "♠"), card(6, "♠")];
    expect(getMovableRunLength(column)).toBe(3);
  });

  it("stops the run at a suit change", () => {
    const column = [card(8, "♥"), card(7, "♠"), card(6, "♠")];
    expect(getMovableRunLength(column)).toBe(2);
  });

  it("stops the run at a non-consecutive rank", () => {
    const column = [card(9, "♠"), card(7, "♠"), card(6, "♠")];
    expect(getMovableRunLength(column)).toBe(2);
  });

  it("stops the run at a face-down card", () => {
    const column = [card(8, "♠", false), card(7, "♠"), card(6, "♠")];
    expect(getMovableRunLength(column)).toBe(2);
  });
});

describe("canMoveFrom", () => {
  const column = [card(13, "♠", false), card(8, "♠"), card(7, "♠"), card(6, "♠")];

  it("allows starting anywhere inside the movable run", () => {
    expect(canMoveFrom(column, 1)).toBe(true);
    expect(canMoveFrom(column, 2)).toBe(true);
    expect(canMoveFrom(column, 3)).toBe(true);
  });

  it("rejects starting before the movable run", () => {
    expect(canMoveFrom(column, 0)).toBe(false);
  });

  it("rejects out-of-range indices", () => {
    expect(canMoveFrom(column, -1)).toBe(false);
    expect(canMoveFrom(column, 4)).toBe(false);
  });
});

describe("canPlaceRun", () => {
  it("allows any run onto an empty column", () => {
    expect(canPlaceRun([card(9, "♥")], [])).toBe(true);
  });

  it("requires the target top rank to be exactly one higher", () => {
    const run = [card(9, "♠")];
    expect(canPlaceRun(run, [card(10, "♥")])).toBe(true);
    expect(canPlaceRun(run, [card(11, "♥")])).toBe(false);
    expect(canPlaceRun(run, [card(9, "♥")])).toBe(false);
  });

  it("ignores the run's own suit when matching rank (mixed-suit landing is legal)", () => {
    expect(canPlaceRun([card(9, "♦")], [card(10, "♣")])).toBe(true);
  });

  it("rejects landing on a face-down top card", () => {
    expect(canPlaceRun([card(9, "♠")], [card(10, "♥", false)])).toBe(false);
  });
});

describe("isCompletedSuitRun", () => {
  function fullRun(suit: Card["suit"]) {
    const cards: Card[] = [];
    for (let rank = 13; rank >= 1; rank--) cards.push(card(rank, suit));
    return cards;
  }

  it("detects a complete K..A same-suit run at the top", () => {
    const column = [card(5, "♥"), ...fullRun("♠")];
    expect(isCompletedSuitRun(column)).toBe("♠");
  });

  it("returns null when shorter than 13", () => {
    const column = fullRun("♠").slice(1);
    expect(isCompletedSuitRun(column)).toBeNull();
  });

  it("returns null when the run mixes suits", () => {
    const column = fullRun("♠");
    column[0] = card(13, "♥");
    expect(isCompletedSuitRun(column)).toBeNull();
  });

  it("returns null when a card in the run is face-down", () => {
    const column = fullRun("♠");
    column[6] = { ...column[6]!, faceUp: false };
    expect(isCompletedSuitRun(column)).toBeNull();
  });
});
