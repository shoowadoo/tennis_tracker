const {
  computeMatchStateFromPointHistory,
  MATCH_FORMATS,
  describeMatchScore,
  TennisMatchScorer
} = require("./response_b.js");

const appPoints = require("./point-history.json");

const scorer = new TennisMatchScorer({
  matchFormat: MATCH_FORMATS.USTA_LEAGUE,
  firstServer: "A",                       // winner of the coin toss's choice
  playerNames: { A: "Sinner", B: "Alcaraz" },
});

// When the user records a point:
let score;
for (const point of appPoints) {
    score = scorer.recordPoint(point);
    console.log(score.scoreLine);
  }

// score = scorer.recordPoint({ winner: "A", outcome: "unforced_error" });
// // When the user taps undo:
// console.log(score)
// const scoreAfterUndo = scorer.undoLastPoint();
// console.log(scoreAfterUndo)

// const appPoints = require("./point-history.json");

// const matchState = computeMatchStateFromPointHistory(appPoints, MATCH_FORMATS.USTA_LEAGUE, "B");
// score = describeMatchScore(matchState, { A: "Alice", B: "Beth" });

// console.log(score);

