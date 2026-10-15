// An object groups a value (key) and two functions (load and save).
const matchStorage = {
  // This names our saved entry in the browser's localStorage.
  key: 'court-notes.points.v1',
  load() {
    // load() is shorthand for a function stored on this object (a method).
    // this refers to matchStorage when called as matchStorage.load().
    // getItem reads saved text; it returns null if the key does not exist.
    const raw = localStorage.getItem(this.key);
    // With no saved entry, start with an empty point list.
    if (raw === null) return [];
    // JSON.parse converts JSON text back into JavaScript arrays/objects.
    // Invalid JSON throws an error, handled by the caller's catch in app.js.
    const points = JSON.parse(raw);
    // Array.isArray checks that this is an array. ! means "not"; || means "or".
    // every calls its callback for each entry; all must pass. An empty array passes.
    // point => ... is an arrow function: it takes point and returns the expression.
    // && stops at the first false-like value, so null cannot reach point.winner.
    // includes checks whether an array contains the supplied value.
    if (!Array.isArray(points) || !points.every(point => point &&
      ['A', 'B'].includes(point.winner) &&
      ['winner', 'forced_error', 'unforced_error'].includes(point.outcome))) {
      // new Error creates an error; throw stops this function and reaches the caller's catch.
      throw new Error('Saved points are not valid.');
    }
    return points;
  },
  save(points) {
    // JSON.stringify converts the list to JSON text because localStorage stores text.
    // setItem writes that text under our key, replacing any previous value.
    // localStorage belongs to this browser; it does not need an internet connection.
    localStorage.setItem(this.key, JSON.stringify(points));
  }
};
