const {
  computeMatchScore,
  MATCH_FORMATS,
  describeMatchScore,
} = require("./response2_b.js");

const points = require("./point-history.json");

// let match = computeMatchScore(points, {
//   matchFormat: MATCH_FORMATS.USTA_LEAGUE,
//   playerServingFirst: "A",
// });
// let match = computeMatchScore(points, {...MATCH_FORMATS.REGULAR_TOURNAMENT, isNoAdScoring:true, setsNeededToWinMatch: 1,  gamesNeededToWinSet: 8, gamesAllScoreThatStartsSetTiebreak: 8}, "A");

// console.log(describeMatchScore(match));

match = computeMatchScore(points, {
  format: MATCH_FORMATS.USTA_LEAGUE, playerNames: {A: 'Sabalenka', B: 'Gauff'},
  firstServer: "B",
});
describeMatchScore(match);                // "0-0 (40-15) - Player A serving"
// getCurrentGameScoreLabelsByPlayer(match); // { A: "40", B: "15" }
match.server;                             // "A"

// Undo: your app removes the last point, then recomputes.
points.pop();
match = computeMatchScore(points, {
  matchFormat: MATCH_FORMATS.USTA_LEAGUE,
  playerServingFirst: "A",
});

console.log(describeMatchScore(match));
// console.log(getCurrentGameScoreLabelsByPlayer(match));
console.log(match.server);