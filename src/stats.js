/* Derived totals only: the point history is the saved record. */
function calculateStats(points) {
  // A new object on every call keeps totals from carrying over between calls.
  // const keeps result bound to this object; its properties can still change.
  const result = {
    A: { pointsWon: 0, winners: 0, forcedErrors: 0, unforcedErrors: 0 },
    B: { pointsWon: 0, winners: 0, forcedErrors: 0, unforcedErrors: 0 }
  };
  for (const point of points) {
    // for...of visits each point. [point.winner] selects the A or B object.
    // ++ increases the existing number by one.
    result[point.winner].pointsWon++;
    // condition ? valueIfTrue : valueIfFalse is JavaScript's conditional expression.
    const loser = point.winner === 'A' ? 'B' : 'A';
    // Credit winners to the point winner; charge errors to the point loser.
    if (point.outcome === 'winner') result[point.winner].winners++;
    if (point.outcome === 'forced_error') result[loser].forcedErrors++;
    if (point.outcome === 'unforced_error') result[loser].unforcedErrors++;
  }
  // Send the completed totals back to the code that called this function.
  return result;
}
