// let allows reassignment; [] creates an empty array (a list).
let points = [];
let storageReady = true;
// const prevents reassignment. document is the browser's representation of the page.
// getElementById finds the HTML element with this id.
const status = document.getElementById('status');
const saveStatus = document.getElementById('save-status');

function showStorageError(message) {
  // hidden controls visibility; textContent sets plain text inside the element.
  saveStatus.hidden = false;
  saveStatus.textContent = message;
}

// try runs code that might fail. catch handles a thrown error instead of stopping the app.
try {
  // load is our own function, defined in storage.js, not a browser built-in.
  points = matchStorage.load();
} catch (error) {
  storageReady = false;
  showStorageError('Saved points could not be loaded. New points will not be saved until you start a new match.');
}

function render() {
  // Our function in stats.js calculates fresh totals from the saved point list.
  const stats = calculateStats(points);
  // Replace these point totals with the scoring engine's result when it is ready.
  for (const player of ['A', 'B']) {
    // for...of visits each value. Backticks make a template string;
    // ${...} inserts a value. toLowerCase turns A/B into a/b to match the HTML ids.
    // stats[player] looks up A or B using the value of player.
    document.getElementById(`score-${player.toLowerCase()}`).textContent = stats[player].pointsWon;
  }
  // length is the number of entries. === checks equality without converting types.
  // disabled blocks button use. && requires both conditions to be true here.
  document.getElementById('undo').disabled = points.length === 0;
  document.getElementById('export').disabled = points.length === 0;
  document.getElementById('reset').disabled = points.length === 0 && storageReady;
  const table = document.getElementById('stats');
  // Remove existing rows so we can rebuild the table with the latest totals.
  table.replaceChildren();
  for (const player of ['A', 'B']) {
    // createElement makes an HTML element in memory; it does not display it yet.
    const row = document.createElement('tr');
    for (const value of [player, stats[player].winners, stats[player].forcedErrors, stats[player].unforcedErrors]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      // append places the cell inside its row, then the row inside the page's table.
      row.append(cell);
    }
    table.append(row);
  }
}

function commit(message) {
  // This is our helper: save the changed history, announce the action, redraw.
  if (storageReady) {
    try {
      matchStorage.save(points);
      saveStatus.hidden = true;
      saveStatus.textContent = '';
    } catch (error) {
      showStorageError('Could not save. Keep this page open to retain your points.');
    }
  }
  // This element is visually hidden; screen readers announce its text.
  status.textContent = message;
  render();
}

// Each tile records both the point winner and the outcome in one tap.
// querySelectorAll finds every element matching a CSS selector.
// [data-outcome] means "has a data-outcome attribute".
// forEach calls a function once per matching element, passing that element in.
// button => ... is an arrow function, similar to a Python lambda:
// button is its parameter; the expression after => is returned automatically.
// () => { ... } takes no parameters and runs a block; returning needs an explicit return.
// addEventListener registers a callback: the browser runs it later on a click.
document.querySelectorAll('[data-outcome]').forEach(button => button.addEventListener('click', () => {
  // The inner callback remembers button from the outer function (a "closure").
  // dataset reads HTML data-* attributes as strings: data-player becomes dataset.player.
  // { winner: ..., outcome: ... } creates an object; push adds it to the end of the array.
  points.push({ winner: button.dataset.player, outcome: button.dataset.outcome });
  // getAttribute reads the button's accessible label; commit is our own function.
  commit(button.getAttribute('aria-label'));
}));
document.getElementById('undo').addEventListener('click', () => {
  // ! means "not". Zero is treated as false, so this exits when the list is empty.
  if (!points.length) return;
  // pop removes the last entry from the array.
  points.pop();
  commit('Last point removed.');
});
document.getElementById('export').addEventListener('click', () => {
  const file = new Blob([JSON.stringify(points, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'point-history.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = 'Point history download requested.';
});
document.getElementById('reset').addEventListener('click', () => {
  // confirm opens the browser's OK/Cancel dialog and returns true/false.
  // Cancel makes !... true, so return exits this callback without clearing anything.
  if (!window.confirm('Start a new match? This clears the current match.')) return;
  points = [];
  storageReady = true;
  commit('New match ready.');
});
// Run once on page load. The callbacks above redraw after later user actions.
render();
