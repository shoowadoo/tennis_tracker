# Tennis tracker

Open `index.html` in a browser. No installation or build step is required.

Tap an outcome in the column of the player who won. Each tile records the point in one tap. Errors are assigned to the player who lost. Undo removes the latest point. New match clears the current history after confirmation.

The app stores one match's point history in this browser's local storage. Browser storage availability for directly opened files varies; the footer reports save failures. Clearing browser data deletes the history.

## Files

- `index.html`: screen layout.
- `src/styles.css`: appearance.
- `src/app.js`: button actions and display updates.
- `src/stats.js`: totals calculated from the point history.
- `src/storage.js`: saves and loads the history.

## Scoring exercise

The screen currently shows total points won, not tennis scoring. The tennis scoring engine is intentionally left for your model evaluation work. It can be added as `src/scoring.js` without changing how points are recorded or saved. Each saved point contains `winner` (`A` or `B`) and `outcome` (`winner`, `forced_error`, or `unforced_error`).

For a scoring function that expects a list of player letters, pass `points.map(point => point.winner)` from `app.js`. Load the scoring script before `app.js` in `index.html` and use its result in `render()` to display the tennis score.
