// Existing gameplay fixtures isolate their rule from start-player selection:
// prefix explicit dice, then leave their board/deck fixture stream unchanged.
export function withStartingRolls(count, random, first = 0) {
  const dice = Array.from({length:count}, (_, index) => index === first ? [.99,.99] : [0,0]).flat();
  return () => dice.length ? dice.shift() : random();
}
