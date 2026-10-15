"use strict";

/**
 * @file Tennis match scoring.
 *
 * Computes the score of a tennis match from the app's recorded points
 * ({ winner: "A" | "B", outcome: ... }). The code follows the order of a
 * match: choosing a format, starting the match, starting a set, starting a
 * game, serving, playing a point, then winning a game, a set and the match.
 * Functions for reading the score come last.
 */

const PLAYERS = ["A", "B"];
const POINT_SCORE_NAMES = ["0", "15", "30", "40"];
const POINTS_TO_WIN_STANDARD_GAME = 4;
const MINIMUM_LEAD_TO_WIN = 2; // applies to sets, tiebreaks and advantage-scored games

/**
 * Returns the other player.
 * @param {"A"|"B"} player
 * @returns {"A"|"B"}
 */
function opponentOf(player) {
  return player === "A" ? "B" : "A";
}

/**
 * Throws an error if the value is not "A" or "B".
 * @param {*} player
 */
function assertValidPlayer(player) {
  if (!PLAYERS.includes(player)) {
    throw new Error(`Player must be "A" or "B", received: ${player}`);
  }
}

// ---------------------------------------------------------------------------
// Choosing a match format
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MatchFormat
 * @property {string}  name
 * @property {number}  setsToWinMatch               1 = single set (e.g. pro set), 2 = best of three, 3 = best of five
 * @property {number}  gamesToWinSet                6 = regular set, 4 = short set, 8 = pro set
 * @property {?number} tiebreakAtGamesAll           games each player must have for a tiebreak to be played (null = no tiebreaks)
 * @property {number}  setTiebreakPointsToWin       length of tiebreaks in sets other than the final set
 * @property {number}  finalSetTiebreakPointsToWin  length of the final set's tiebreak, or of the match tiebreak
 * @property {boolean} finalSetIsMatchTiebreak      true = the final set is replaced by a single match tiebreak
 * @property {boolean} noAdScoring                  true = at deuce, the next point wins the game
 */

/**
 * Creates a match format. Any setting left out gets the standard value for
 * best-of-three tiebreak sets; the tiebreak is played when the games are tied
 * at gamesToWinSet unless tiebreakAtGamesAll says otherwise.
 * @param {Partial<MatchFormat>} [settings]
 * @returns {MatchFormat}
 */
function createMatchFormat(settings = {}) {
  const gamesToWinSet = settings.gamesToWinSet ?? 6;
  return {
    name: "Custom format",
    setsToWinMatch: 2,
    gamesToWinSet,
    tiebreakAtGamesAll: gamesToWinSet,
    setTiebreakPointsToWin: 7,
    finalSetTiebreakPointsToWin: 7,
    finalSetIsMatchTiebreak: false,
    noAdScoring: false,
    ...settings,
  };
}

/**
 * Ready-made formats. League and junior rules vary by section and age group,
 * so adjust these when needed, e.g. { ...MATCH_FORMATS.USTA_LEAGUE, noAdScoring: true }.
 */
const MATCH_FORMATS = {
  GRAND_SLAM_BEST_OF_FIVE: createMatchFormat({
    name: "Grand Slam, best of five sets (10-point tiebreak at 6-6 in the fifth)",
    setsToWinMatch: 3,
    finalSetTiebreakPointsToWin: 10,
  }),
  GRAND_SLAM_BEST_OF_THREE: createMatchFormat({
    name: "Grand Slam, best of three sets (10-point tiebreak at 6-6 in the third)",
    finalSetTiebreakPointsToWin: 10,
  }),
  REGULAR_TOURNAMENT: createMatchFormat({
    name: "Regular tournament, best of three tiebreak sets",
  }),
  USTA_LEAGUE: createMatchFormat({
    name: "USTA League, 10-point match tiebreak instead of a third set",
    finalSetIsMatchTiebreak: true,
    finalSetTiebreakPointsToWin: 10,
  }),
  JUNIOR_TOURNAMENT: createMatchFormat({
    name: "Junior tournament, 10-point match tiebreak instead of a third set",
    finalSetIsMatchTiebreak: true,
    finalSetTiebreakPointsToWin: 10,
  }),
  JUNIOR_SHORT_SETS: createMatchFormat({
    name: "Junior short sets, first to 4 games, 7-point match tiebreak instead of a third set",
    gamesToWinSet: 4,
    finalSetIsMatchTiebreak: true,
  }),
  PRO_SET: createMatchFormat({
    name: "Pro set, first to 8 games, tiebreak at 8-8",
    setsToWinMatch: 1,
    gamesToWinSet: 8,
  }),
};

// ---------------------------------------------------------------------------
// The match begins
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TennisSet
 * @property {boolean} isFinalSet                    true if whoever wins this set wins the match
 * @property {boolean} isMatchTiebreak               true if this set is played as a single match tiebreak
 * @property {{A: number, B: number}} games
 * @property {?{A: number, B: number}} tiebreakPoints null unless the set reaches a tiebreak
 * @property {?("A"|"B")} winner
 *
 * @typedef {Object} Game
 * @property {boolean} isTiebreak
 * @property {number} minimumPointsToWin
 * @property {number} minimumLead                    1 for a no-ad game, otherwise 2
 * @property {{A: number, B: number}} points
 *
 * @typedef {Object} Match
 * @property {MatchFormat} format
 * @property {{A: string, B: string}} playerNames
 * @property {"A"|"B"} firstServer                   who served the first game of the match
 * @property {TennisSet[]} sets                      every set started so far, including the current one
 * @property {{A: number, B: number}} setsWon
 * @property {number} gamesCompleted                 games finished in the whole match (a tiebreak counts as one)
 * @property {?TennisSet} currentSet                 null once the match is over
 * @property {?Game} currentGame                     null once the match is over
 * @property {?("A"|"B")} server                     who serves the next point; null once the match is over
 * @property {?("A"|"B")} winner
 */

/**
 * Starts a new match with no points played.
 * @param {Object} [options]
 * @param {MatchFormat} [options.format=MATCH_FORMATS.REGULAR_TOURNAMENT]
 * @param {{A?: string, B?: string}} [options.playerNames]  display names; points still use "A" and "B"
 * @param {"A"|"B"} [options.firstServer="A"]                who serves the first game
 * @returns {Match}
 */
function startMatch({ format = MATCH_FORMATS.REGULAR_TOURNAMENT, playerNames = {}, firstServer = "A" } = {}) {
  assertValidPlayer(firstServer);

  const match = {
    format,
    playerNames: { A: "Player A", B: "Player B", ...playerNames },
    firstServer,
    sets: [],
    setsWon: { A: 0, B: 0 },
    gamesCompleted: 0,
    currentSet: null,
    currentGame: null,
    server: null,
    winner: null,
  };

  startSet(match);
  match.server = determineServer(match);
  return match;
}

// ---------------------------------------------------------------------------
// A set begins
// ---------------------------------------------------------------------------

/**
 * Starts the next set and its first game. When both players are one set away
 * from winning, this is the final set, which may be played as a match tiebreak.
 * @param {Match} match
 */
function startSet(match) {
  const setsEachWhenFinalSetStarts = match.format.setsToWinMatch - 1;
  const isFinalSet =
    match.setsWon.A === setsEachWhenFinalSetStarts && match.setsWon.B === setsEachWhenFinalSetStarts;

  match.currentSet = {
    isFinalSet,
    isMatchTiebreak: isFinalSet && match.format.finalSetIsMatchTiebreak,
    games: { A: 0, B: 0 },
    tiebreakPoints: null,
    winner: null,
  };
  match.sets.push(match.currentSet);
  startGame(match);
}

// ---------------------------------------------------------------------------
// A game begins
// ---------------------------------------------------------------------------

/**
 * Starts the next game, which is a tiebreak when the set is a match tiebreak
 * or the games are tied at the format's tiebreak score.
 * @param {Match} match
 */
function startGame(match) {
  const { format, currentSet } = match;
  const isTiebreak =
    currentSet.isMatchTiebreak ||
    (currentSet.games.A === format.tiebreakAtGamesAll && currentSet.games.B === format.tiebreakAtGamesAll);
  const tiebreakPointsToWin = currentSet.isFinalSet
    ? format.finalSetTiebreakPointsToWin
    : format.setTiebreakPointsToWin;

  match.currentGame = {
    isTiebreak,
    minimumPointsToWin: isTiebreak ? tiebreakPointsToWin : POINTS_TO_WIN_STANDARD_GAME,
    minimumLead: !isTiebreak && format.noAdScoring ? 1 : MINIMUM_LEAD_TO_WIN,
    points: { A: 0, B: 0 },
  };

  // The set shares the tiebreak's points object, so it always holds the
  // tiebreak score, both during the tiebreak and after it ends.
  if (isTiebreak) currentSet.tiebreakPoints = match.currentGame.points;
}

// ---------------------------------------------------------------------------
// A player serves
// ---------------------------------------------------------------------------

/**
 * Determines who serves the next point. This is the only place the server is decided.
 *
 * Players alternate serving every game for the whole match. A tiebreak counts
 * as one game, so whoever serves first in a tiebreak receives first in the next
 * set. In a tiebreak, the first server serves one point, then the serve changes
 * every two points.
 * @param {Match} match
 * @returns {?("A"|"B")} null once the match is over
 */
function determineServer(match) {
  if (match.winner) return null;

  const firstServerOfGame = match.gamesCompleted % 2 === 0 ? match.firstServer : opponentOf(match.firstServer);
  if (!match.currentGame.isTiebreak) return firstServerOfGame;

  const tiebreakPointsPlayed = match.currentGame.points.A + match.currentGame.points.B;
  const serviceTurnsCompleted = Math.floor((tiebreakPointsPlayed + 1) / 2);
  return serviceTurnsCompleted % 2 === 0 ? firstServerOfGame : opponentOf(firstServerOfGame);
}

// ---------------------------------------------------------------------------
// A point is played
// ---------------------------------------------------------------------------

/**
 * Adds one point to the match, then awards a game, set or match if the point
 * decided one. Points played after the match is over are ignored.
 * @param {Match} match
 * @param {"A"|"B"} pointWinner
 * @returns {Match} the same match object, updated
 */
function playPoint(match, pointWinner) {
  assertValidPlayer(pointWinner);
  if (match.winner) return match;

  match.currentGame.points[pointWinner] += 1;
  if (isGameWon(match.currentGame, pointWinner)) awardGame(match, pointWinner);

  match.server = determineServer(match);
  return match;
}

// ---------------------------------------------------------------------------
// A game is won
// ---------------------------------------------------------------------------

/**
 * Checks whether a player has enough points, with a big enough lead, to win the game.
 * @param {Game} game
 * @param {"A"|"B"} player
 * @returns {boolean}
 */
function isGameWon(game, player) {
  const lead = game.points[player] - game.points[opponentOf(player)];
  return game.points[player] >= game.minimumPointsToWin && lead >= game.minimumLead;
}

/**
 * Gives a player the game, then either awards the set or starts the next game.
 * @param {Match} match
 * @param {"A"|"B"} gameWinner
 */
function awardGame(match, gameWinner) {
  match.currentSet.games[gameWinner] += 1;
  match.gamesCompleted += 1;

  if (isSetWon(match, gameWinner)) awardSet(match, gameWinner);
  else startGame(match);
}

// ---------------------------------------------------------------------------
// A set is won
// ---------------------------------------------------------------------------

/**
 * Checks whether the game just won also won the set: either it was a
 * tiebreak, or the player reached the games needed with a two-game lead.
 * @param {Match} match
 * @param {"A"|"B"} player
 * @returns {boolean}
 */
function isSetWon(match, player) {
  if (match.currentGame.isTiebreak) return true;

  const { games } = match.currentSet;
  const lead = games[player] - games[opponentOf(player)];
  return games[player] >= match.format.gamesToWinSet && lead >= MINIMUM_LEAD_TO_WIN;
}

/**
 * Gives a player the set, then either awards the match or starts the next set.
 * @param {Match} match
 * @param {"A"|"B"} setWinner
 */
function awardSet(match, setWinner) {
  match.currentSet.winner = setWinner;
  match.setsWon[setWinner] += 1;

  if (match.setsWon[setWinner] === match.format.setsToWinMatch) awardMatch(match, setWinner);
  else startSet(match);
}

// ---------------------------------------------------------------------------
// The match is won
// ---------------------------------------------------------------------------

/**
 * Ends the match. No set, game or server remains afterwards.
 * @param {Match} match
 * @param {"A"|"B"} matchWinner
 */
function awardMatch(match, matchWinner) {
  match.winner = matchWinner;
  match.currentSet = null;
  match.currentGame = null;
}

// ---------------------------------------------------------------------------
// Connecting to the app (recording and undoing points)
// ---------------------------------------------------------------------------

/**
 * Computes the match from the app's list of recorded points. Call it again
 * whenever a point is recorded or undone; rebuilding from the list means undo
 * needs no special handling and the score can never fall out of sync.
 * @param {{winner: "A"|"B"}[]} recordedPoints
 * @param {Parameters<typeof startMatch>[0]} [options] same options as startMatch
 * @returns {Match}
 */
function computeMatchScore(recordedPoints, options) {
  const match = startMatch(options);
  for (const point of recordedPoints) {playPoint(match, point.winner);
  console.log(describeMatchScore(match));}
  return match;
}

// ---------------------------------------------------------------------------
// Reading the score
// ---------------------------------------------------------------------------

/**
 * Returns what each player would win by winning the next point:
 * "game point", "break point", "set point" and/or "match point".
 * Call it before recording a point to store the point's importance with your stats.
 * @param {Match} match
 * @returns {{A: string[], B: string[]}} e.g. { A: ["break point", "set point"], B: [] }
 */
function getPointStakes(match) {
  const stakes = { A: [], B: [] };
  if (match.winner) return stakes;

  for (const player of PLAYERS) {
    const matchIfPlayerWinsPoint = playPoint(structuredClone(match), player);
    const winsStandardGame = !match.currentGame.isTiebreak && matchIfPlayerWinsPoint.gamesCompleted > match.gamesCompleted;

    if (winsStandardGame) stakes[player].push(player === match.server ? "game point" : "break point");
    if (matchIfPlayerWinsPoint.setsWon[player] > match.setsWon[player]) stakes[player].push("set point");
    if (matchIfPlayerWinsPoint.winner === player) stakes[player].push("match point");
  }
  return stakes;
}

/**
 * Checks whether the players change ends before the next point: after every
 * odd-numbered game of a set (including a set's final game, if the set had an
 * odd number of games) and after every six points of a tiebreak.
 * @param {Match} match
 * @returns {boolean}
 */
function isChangeOfEnds(match) {
  if (match.winner) return false;

  const { currentGame, currentSet, sets } = match;
  const pointsPlayedInGame = currentGame.points.A + currentGame.points.B;
  if (pointsPlayedInGame > 0) return currentGame.isTiebreak && pointsPlayedInGame % 6 === 0;
  if (match.gamesCompleted === 0) return false;

  // A game has just ended; if the current set has no games yet, it ended the previous set.
  const setOfLastGame = currentSet.games.A + currentSet.games.B === 0 ? sets[sets.length - 2] : currentSet;
  return (setOfLastGame.games.A + setOfLastGame.games.B) % 2 === 1;
}

/**
 * Returns each player's score in the current game for a scoreboard,
 * e.g. { A: "40", B: "AD" } or, in a tiebreak, { A: "5", B: "3" }.
 * @param {Match} match
 * @returns {{A: string, B: string}}
 */
function getGameScoreLabels(match) {
  if (!match.currentGame) return { A: "", B: "" };

  const { points, isTiebreak } = match.currentGame;
  if (isTiebreak) return { A: String(points.A), B: String(points.B) };
  if (points.A < 3 || points.B < 3) return { A: POINT_SCORE_NAMES[points.A], B: POINT_SCORE_NAMES[points.B] };
  if (points.A === points.B) return { A: "40", B: "40" };
  return points.A > points.B ? { A: "AD", B: "40" } : { A: "40", B: "AD" };
}

/**
 * Describes the current game in words, player A's score first:
 * "30-15", "Deuce", "Advantage Serena", or "4-3" in a tiebreak.
 * @param {Match} match
 * @returns {string}
 */
function describeGameScore(match) {
  if (!match.currentGame) return "";

  const labels = getGameScoreLabels(match);
  if (!match.currentGame.isTiebreak && labels.A === "40" && labels.B === "40") {
    return match.format.noAdScoring ? "Deuce (deciding point)" : "Deuce";
  }
  const playerWithAdvantage = PLAYERS.find((player) => labels[player] === "AD");
  if (playerWithAdvantage) return `Advantage ${match.playerNames[playerWithAdvantage]}`;
  return `${labels.A}-${labels.B}`;
}

/**
 * Describes one set from a chosen player's point of view:
 * "6-4", "6-6 (3-2)" during a tiebreak, "7-6(5)" after one
 * (the loser's tiebreak points in brackets), or "[10-8]" for a match tiebreak.
 * @param {TennisSet} set
 * @param {"A"|"B"} [player="A"] whose games are listed first
 * @returns {string}
 */
function describeSetScore(set, player = "A") {
  const opponent = opponentOf(player);
  const { games, tiebreakPoints } = set;

  if (set.isMatchTiebreak) return `[${tiebreakPoints[player]}-${tiebreakPoints[opponent]}]`;

  const gamesScore = `${games[player]}-${games[opponent]}`;
  if (!tiebreakPoints) return gamesScore;
  if (!set.winner) return `${gamesScore} (${tiebreakPoints[player]}-${tiebreakPoints[opponent]})`;
  return `${gamesScore}(${Math.min(tiebreakPoints.A, tiebreakPoints.B)})`;
}

/**
 * Describes the whole match in one line:
 * "Serena vs Venus: 6-4, 2-1, 40-30 (Venus serving)" while in progress,
 * "Serena def. Venus 6-4, 7-6(5)" once finished.
 * @param {Match} match
 * @returns {string}
 */
function describeMatchScore(match) {
  const { playerNames, winner } = match;

  if (winner) {
    const setScores = match.sets.map((set) => describeSetScore(set, winner)).join(", ");
    return `${playerNames[winner]} def. ${playerNames[opponentOf(winner)]} ${setScores}`;
  }

  const setScores = match.sets.map((set) => describeSetScore(set, "A")).join(", ");
  const gameScore = match.currentGame.isTiebreak ? "" : `, ${describeGameScore(match)}`; // tiebreak points already appear in the set score
  return `${playerNames.A} vs ${playerNames.B}: ${setScores}${gameScore} (${playerNames[match.server]} serving)`;
}

// ---------------------------------------------------------------------------
// Exports (Node or bundlers; in a plain <script> tag everything is already global)
// ---------------------------------------------------------------------------

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MATCH_FORMATS,
    createMatchFormat,
    startMatch,
    playPoint,
    determineServer,
    computeMatchScore,
    getPointStakes,
    isChangeOfEnds,
    getGameScoreLabels,
    describeGameScore,
    describeSetScore,
    describeMatchScore,
  };
}