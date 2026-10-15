"use strict";

/**
 * =============================================================================
 * tennisMatchScorer.js
 * =============================================================================
 *
 * Computes the score of a singles tennis match, one point at a time, from
 * point records shaped like:
 *
 *     { winner: "A" | "B", outcome: "winner" | "forced_error" | "unforced_error" }
 *
 * Supports Grand Slam, regular tour, USTA League and USTA Junior scoring
 * formats (and custom formats built from the same pieces), tracks the server
 * through games, tiebreaks and match tiebreaks, and supports undoing the last
 * recorded point.
 *
 * The file is laid out in the same order a real match unfolds:
 *
 *   PART 1 — The players and the points they play
 *   PART 2 — The rules agreed before the match (scoring formats)
 *   PART 3 — Before the first point: setting up the match
 *   PART 4 — Who is serving
 *   PART 5 — Playing the match: point → game → set → match
 *   PART 6 — Keeping score as points are recorded (and undone)
 *   PART 7 — Announcing the score
 *   PART 8 — Exports and a demonstration match
 * =============================================================================
 */

// =============================================================================
// PART 1 — THE PLAYERS AND THE POINTS THEY PLAY
// =============================================================================

const PLAYER_A = "A";
const PLAYER_B = "B";
const BOTH_PLAYERS = Object.freeze([PLAYER_A, PLAYER_B]);

const DEFAULT_PLAYER_NAMES = Object.freeze({
  [PLAYER_A]: "Player A",
  [PLAYER_B]: "Player B",
});

/** How a point ended. The outcome does not affect the score, but it is validated. */
const POINT_OUTCOMES = Object.freeze({
  WINNER: "winner",
  FORCED_ERROR: "forced_error",
  UNFORCED_ERROR: "unforced_error",
});

function getOpponentOf(player) {
  return player === PLAYER_A ? PLAYER_B : PLAYER_A;
}

function isValidPlayer(player) {
  return BOTH_PLAYERS.includes(player);
}

function createZeroScoreForBothPlayers() {
  return { [PLAYER_A]: 0, [PLAYER_B]: 0 };
}

function validateRecordedPoint(point) {
  if (!point || typeof point !== "object") {
    throw new Error('A point must be an object like { winner: "A", outcome: "winner" }.');
  }
  if (!isValidPlayer(point.winner)) {
    throw new Error(`Invalid point winner "${point.winner}". Expected "${PLAYER_A}" or "${PLAYER_B}".`);
  }
  const validOutcomes = Object.values(POINT_OUTCOMES);
  if (!validOutcomes.includes(point.outcome)) {
    throw new Error(`Invalid point outcome "${point.outcome}". Expected one of: ${validOutcomes.join(", ")}.`);
  }
}

// =============================================================================
// PART 2 — THE RULES AGREED BEFORE THE MATCH (SCORING FORMATS)
// =============================================================================

/** How a regular game is won once both players reach 40. */
const GAME_SCORING_METHODS = Object.freeze({
  ADVANTAGE: "advantage",       // deuce / advantage: the game must be won by two points
  NO_ADVANTAGE: "no_advantage", // at deuce, the next point (the "deciding point") wins the game
});

/** The kinds of set that can be played. */
const SET_TYPES = Object.freeze({
  GAMES_SET: "games_set",           // a normal set made up of games (e.g. first to 6, win by 2)
  MATCH_TIEBREAK: "match_tiebreak", // a single tiebreak played in place of a deciding set
});

/** The kinds of "game" that can be in progress. */
const GAME_TYPES = Object.freeze({
  STANDARD_GAME: "standard_game",   // 15, 30, 40, game
  SET_TIEBREAK: "set_tiebreak",     // tiebreak played at games-all to decide a set
  MATCH_TIEBREAK: "match_tiebreak", // tiebreak played in place of the deciding set
});

const POINTS_NEEDED_TO_WIN_STANDARD_GAME = 4;
const MINIMUM_WINNING_MARGIN = 2;

/**
 * Reusable rules for individual sets.
 *
 * GAMES_SET fields:
 *   gamesNeededToWinSet       – games needed to win the set (always by a margin of two)
 *   tiebreakPlayedAtGamesAll  – games-all score at which a tiebreak decides the set
 *                               (null = no tiebreak, the set continues until someone leads by two)
 *   tiebreakPointsNeededToWin – points needed to win that tiebreak (by a margin of two)
 *
 * MATCH_TIEBREAK fields:
 *   tiebreakPointsNeededToWin – points needed to win the match tiebreak (by a margin of two)
 */
const SET_RULES = Object.freeze({
  SIX_GAME_SET_WITH_SEVEN_POINT_TIEBREAK: Object.freeze({
    setType: SET_TYPES.GAMES_SET,
    gamesNeededToWinSet: 6,
    tiebreakPlayedAtGamesAll: 6,
    tiebreakPointsNeededToWin: 7,
  }),
  SIX_GAME_SET_WITH_TEN_POINT_TIEBREAK: Object.freeze({
    setType: SET_TYPES.GAMES_SET,
    gamesNeededToWinSet: 6,
    tiebreakPlayedAtGamesAll: 6,
    tiebreakPointsNeededToWin: 10,
  }),
  SIX_GAME_ADVANTAGE_SET_WITHOUT_TIEBREAK: Object.freeze({
    setType: SET_TYPES.GAMES_SET,
    gamesNeededToWinSet: 6,
    tiebreakPlayedAtGamesAll: null,
    tiebreakPointsNeededToWin: null,
  }),
  FOUR_GAME_SHORT_SET_WITH_SEVEN_POINT_TIEBREAK: Object.freeze({
    setType: SET_TYPES.GAMES_SET,
    gamesNeededToWinSet: 4,
    tiebreakPlayedAtGamesAll: 4,
    tiebreakPointsNeededToWin: 7,
  }),
  EIGHT_GAME_PRO_SET_WITH_SEVEN_POINT_TIEBREAK: Object.freeze({
    setType: SET_TYPES.GAMES_SET,
    gamesNeededToWinSet: 8,
    tiebreakPlayedAtGamesAll: 8,
    tiebreakPointsNeededToWin: 7,
  }),
  TEN_POINT_MATCH_TIEBREAK: Object.freeze({
    setType: SET_TYPES.MATCH_TIEBREAK,
    tiebreakPointsNeededToWin: 10,
  }),
});

/**
 * Complete match formats.
 *
 *   maximumNumberOfSets – "best of" this many sets (1, 3 or 5)
 *   gameScoringMethod   – advantage or no-advantage games
 *   regularSetRules     – rules for every set except the last possible one
 *   decidingSetRules    – rules for the last possible set (e.g. set 3 of a best-of-3 match)
 *
 * Custom formats can be created with the same shape, e.g.
 *   { ...MATCH_FORMATS.USTA_LEAGUE, gameScoringMethod: GAME_SCORING_METHODS.NO_ADVANTAGE }
 */
const MATCH_FORMATS = Object.freeze({
  GRAND_SLAM_BEST_OF_FIVE_SETS: Object.freeze({
    formatName: "Grand Slam (best of 5 sets)",
    description: "Men's singles at the Grand Slams: 7-point tiebreak at 6-6, 10-point tiebreak at 6-6 in the fifth set.",
    maximumNumberOfSets: 5,
    gameScoringMethod: GAME_SCORING_METHODS.ADVANTAGE,
    regularSetRules: SET_RULES.SIX_GAME_SET_WITH_SEVEN_POINT_TIEBREAK,
    decidingSetRules: SET_RULES.SIX_GAME_SET_WITH_TEN_POINT_TIEBREAK,
  }),
  GRAND_SLAM_BEST_OF_THREE_SETS: Object.freeze({
    formatName: "Grand Slam (best of 3 sets)",
    description: "Women's singles at the Grand Slams: 7-point tiebreak at 6-6, 10-point tiebreak at 6-6 in the third set.",
    maximumNumberOfSets: 3,
    gameScoringMethod: GAME_SCORING_METHODS.ADVANTAGE,
    regularSetRules: SET_RULES.SIX_GAME_SET_WITH_SEVEN_POINT_TIEBREAK,
    decidingSetRules: SET_RULES.SIX_GAME_SET_WITH_TEN_POINT_TIEBREAK,
  }),
  REGULAR_TOURNAMENT_BEST_OF_THREE_SETS: Object.freeze({
    formatName: "Regular tournament (best of 3 tiebreak sets)",
    description: "Standard ATP/WTA and most sanctioned tournaments: 7-point tiebreak at 6-6 in every set.",
    maximumNumberOfSets: 3,
    gameScoringMethod: GAME_SCORING_METHODS.ADVANTAGE,
    regularSetRules: SET_RULES.SIX_GAME_SET_WITH_SEVEN_POINT_TIEBREAK,
    decidingSetRules: SET_RULES.SIX_GAME_SET_WITH_SEVEN_POINT_TIEBREAK,
  }),
  USTA_LEAGUE: Object.freeze({
    formatName: "USTA League",
    description: "Two tiebreak sets; a 10-point match tiebreak is played in place of a third set.",
    maximumNumberOfSets: 3,
    gameScoringMethod: GAME_SCORING_METHODS.ADVANTAGE,
    regularSetRules: SET_RULES.SIX_GAME_SET_WITH_SEVEN_POINT_TIEBREAK,
    decidingSetRules: SET_RULES.TEN_POINT_MATCH_TIEBREAK,
  }),
  USTA_LEAGUE_NO_ADVANTAGE: Object.freeze({
    formatName: "USTA League (no-ad scoring)",
    description: "USTA League format with no-ad games, used by some local leagues.",
    maximumNumberOfSets: 3,
    gameScoringMethod: GAME_SCORING_METHODS.NO_ADVANTAGE,
    regularSetRules: SET_RULES.SIX_GAME_SET_WITH_SEVEN_POINT_TIEBREAK,
    decidingSetRules: SET_RULES.TEN_POINT_MATCH_TIEBREAK,
  }),
  JUNIOR_BEST_OF_THREE_TIEBREAK_SETS: Object.freeze({
    formatName: "Junior (best of 3 tiebreak sets)",
    description: "Full junior format: 7-point tiebreak at 6-6 in every set.",
    maximumNumberOfSets: 3,
    gameScoringMethod: GAME_SCORING_METHODS.ADVANTAGE,
    regularSetRules: SET_RULES.SIX_GAME_SET_WITH_SEVEN_POINT_TIEBREAK,
    decidingSetRules: SET_RULES.SIX_GAME_SET_WITH_SEVEN_POINT_TIEBREAK,
  }),
  JUNIOR_TWO_SETS_WITH_MATCH_TIEBREAK: Object.freeze({
    formatName: "Junior (two tiebreak sets + match tiebreak)",
    description: "Two tiebreak sets; a 10-point match tiebreak is played in place of a third set.",
    maximumNumberOfSets: 3,
    gameScoringMethod: GAME_SCORING_METHODS.ADVANTAGE,
    regularSetRules: SET_RULES.SIX_GAME_SET_WITH_SEVEN_POINT_TIEBREAK,
    decidingSetRules: SET_RULES.TEN_POINT_MATCH_TIEBREAK,
  }),
  JUNIOR_SHORT_SETS_NO_ADVANTAGE: Object.freeze({
    formatName: "Junior (short sets, no-ad, match tiebreak)",
    description: "Two short sets (first to 4, tiebreak at 4-4) with no-ad games; a 10-point match tiebreak in place of a third set.",
    maximumNumberOfSets: 3,
    gameScoringMethod: GAME_SCORING_METHODS.NO_ADVANTAGE,
    regularSetRules: SET_RULES.FOUR_GAME_SHORT_SET_WITH_SEVEN_POINT_TIEBREAK,
    decidingSetRules: SET_RULES.TEN_POINT_MATCH_TIEBREAK,
  }),
  JUNIOR_EIGHT_GAME_PRO_SET: Object.freeze({
    formatName: "Junior (8-game pro set)",
    description: "A single set to 8 games with a 7-point tiebreak at 8-8.",
    maximumNumberOfSets: 1,
    gameScoringMethod: GAME_SCORING_METHODS.ADVANTAGE,
    regularSetRules: SET_RULES.EIGHT_GAME_PRO_SET_WITH_SEVEN_POINT_TIEBREAK,
    decidingSetRules: SET_RULES.EIGHT_GAME_PRO_SET_WITH_SEVEN_POINT_TIEBREAK,
  }),
});

function assertPositiveWholeNumber(value, fieldLabel) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldLabel} must be a positive whole number (received ${value}).`);
  }
}

function validateSetRules(setRules, rulesLabel) {
  if (!setRules || typeof setRules !== "object") {
    throw new Error(`${rulesLabel} must be provided.`);
  }

  if (setRules.setType === SET_TYPES.MATCH_TIEBREAK) {
    assertPositiveWholeNumber(setRules.tiebreakPointsNeededToWin, `${rulesLabel}.tiebreakPointsNeededToWin`);
    return;
  }

  if (setRules.setType !== SET_TYPES.GAMES_SET) {
    throw new Error(`${rulesLabel}.setType must be "${SET_TYPES.GAMES_SET}" or "${SET_TYPES.MATCH_TIEBREAK}".`);
  }

  assertPositiveWholeNumber(setRules.gamesNeededToWinSet, `${rulesLabel}.gamesNeededToWinSet`);

  const isAdvantageSetWithoutTiebreak = setRules.tiebreakPlayedAtGamesAll === null;
  if (isAdvantageSetWithoutTiebreak) {
    return;
  }

  assertPositiveWholeNumber(setRules.tiebreakPlayedAtGamesAll, `${rulesLabel}.tiebreakPlayedAtGamesAll`);
  if (setRules.tiebreakPlayedAtGamesAll < setRules.gamesNeededToWinSet - 1) {
    throw new Error(`${rulesLabel}.tiebreakPlayedAtGamesAll must be at least gamesNeededToWinSet - 1.`);
  }
  assertPositiveWholeNumber(setRules.tiebreakPointsNeededToWin, `${rulesLabel}.tiebreakPointsNeededToWin`);
}

function validateMatchFormat(matchFormat) {
  if (!matchFormat || typeof matchFormat !== "object") {
    throw new Error("A match format must be provided (see MATCH_FORMATS).");
  }

  const { maximumNumberOfSets, gameScoringMethod, regularSetRules, decidingSetRules } = matchFormat;

  const isOddWholeNumberOfSets =
    Number.isInteger(maximumNumberOfSets) && maximumNumberOfSets >= 1 && maximumNumberOfSets % 2 === 1;
  if (!isOddWholeNumberOfSets) {
    throw new Error("maximumNumberOfSets must be an odd whole number such as 1, 3 or 5.");
  }

  if (!Object.values(GAME_SCORING_METHODS).includes(gameScoringMethod)) {
    throw new Error(`gameScoringMethod must be one of: ${Object.values(GAME_SCORING_METHODS).join(", ")}.`);
  }

  validateSetRules(regularSetRules, "regularSetRules");
  validateSetRules(decidingSetRules, "decidingSetRules");
}

function getNumberOfSetsNeededToWinMatch(matchFormat) {
  return Math.floor(matchFormat.maximumNumberOfSets / 2) + 1;
}

function getRulesForSet(matchFormat, setNumber) {
  const isDecidingSet = setNumber === matchFormat.maximumNumberOfSets;
  return isDecidingSet ? matchFormat.decidingSetRules : matchFormat.regularSetRules;
}

// =============================================================================
// PART 3 — BEFORE THE FIRST POINT: SETTING UP THE MATCH
// =============================================================================

/**
 * Creates the state of a match that is about to begin.
 * The first server is decided before play (e.g. by the coin toss / spin).
 */
function createNewMatch(matchFormat, firstServer) {
  validateMatchFormat(matchFormat);
  if (!isValidPlayer(firstServer)) {
    throw new Error(`Invalid first server "${firstServer}". Expected "${PLAYER_A}" or "${PLAYER_B}".`);
  }

  const matchState = {
    matchFormat,
    firstServer,
    completedSets: [],
    setsWonByPlayer: createZeroScoreForBothPlayers(),
    currentSet: null,
    currentGame: null,
    totalGamesCompletedInMatch: 0, // tiebreaks and match tiebreaks count as one game each
    totalPointsPlayed: 0,
    matchWinner: null,
  };

  startNextSet(matchState);
  return matchState;
}

// =============================================================================
// PART 4 — WHO IS SERVING
// =============================================================================

/**
 * The single function that determines who is serving the next point.
 *
 * Games: the serve alternates every game for the whole match, carrying over
 * from one set to the next. A set tiebreak or match tiebreak counts as one
 * game in that rotation. This also produces the rule that the player who
 * served first in a tiebreak receives first in the following set.
 *
 * Tiebreaks: the player whose turn it is serves the first point. After that,
 * each player serves two points in a row (pattern: 1, 2, 2, 2, ...).
 *
 * Returns "A", "B", or null if the match is over.
 */
function determineCurrentServer(matchState) {
  if (matchState.matchWinner !== null || matchState.currentGame === null) {
    return null;
  }

  const isEvenNumberedGameOfMatch = matchState.totalGamesCompletedInMatch % 2 === 0;
  const serverOfCurrentGame = isEvenNumberedGameOfMatch
    ? matchState.firstServer
    : getOpponentOf(matchState.firstServer);

  if (matchState.currentGame.gameType === GAME_TYPES.STANDARD_GAME) {
    return serverOfCurrentGame;
  }

  const tiebreakPointsPlayed =
    matchState.currentGame.pointsWonByPlayer[PLAYER_A] + matchState.currentGame.pointsWonByPlayer[PLAYER_B];
  const tiebreakServiceTurnNumber = Math.floor((tiebreakPointsPlayed + 1) / 2);
  const isTiebreakStartersServiceTurn = tiebreakServiceTurnNumber % 2 === 0;

  return isTiebreakStartersServiceTurn ? serverOfCurrentGame : getOpponentOf(serverOfCurrentGame);
}

// =============================================================================
// PART 5 — PLAYING THE MATCH: POINT → GAME → SET → MATCH
// =============================================================================

// ---- 5a. A set begins ------------------------------------------------------

function startNextSet(matchState) {
  const setNumber = matchState.completedSets.length + 1;
  const setRules = getRulesForSet(matchState.matchFormat, setNumber);

  matchState.currentSet = {
    setNumber,
    setRules,
    gamesWonByPlayer: createZeroScoreForBothPlayers(),
    tiebreakPointsByPlayer: null, // filled in if the set is decided by a tiebreak
    setWinner: null,
  };

  if (setRules.setType === SET_TYPES.MATCH_TIEBREAK) {
    startTiebreak(matchState, GAME_TYPES.MATCH_TIEBREAK, setRules.tiebreakPointsNeededToWin);
  } else {
    startStandardGame(matchState);
  }
}

// ---- 5b. A game (or tiebreak) begins --------------------------------------------

function startStandardGame(matchState) {
  matchState.currentGame = {
    gameType: GAME_TYPES.STANDARD_GAME,
    scoringMethod: matchState.matchFormat.gameScoringMethod,
    pointsNeededToWin: POINTS_NEEDED_TO_WIN_STANDARD_GAME,
    pointsWonByPlayer: createZeroScoreForBothPlayers(),
  };
}

function startTiebreak(matchState, tiebreakGameType, tiebreakPointsNeededToWin) {
  matchState.currentGame = {
    gameType: tiebreakGameType,
    scoringMethod: GAME_SCORING_METHODS.ADVANTAGE, // tiebreaks are always won by two points
    pointsNeededToWin: tiebreakPointsNeededToWin,
    pointsWonByPlayer: createZeroScoreForBothPlayers(),
  };
}

// ---- 5c. A point is played ----------------------------------------------------

function playPoint(matchState, pointWinner) {
  if (matchState.matchWinner !== null) {
    throw new Error("The match is already over, so no more points can be played.");
  }

  matchState.currentGame.pointsWonByPlayer[pointWinner] += 1;
  matchState.totalPointsPlayed += 1;

  if (hasPlayerWonCurrentGame(matchState.currentGame, pointWinner)) {
    completeCurrentGame(matchState, pointWinner);
  }
}

// ---- 5d. Is the game (or tiebreak) over? -------------------------------------

function hasPlayerWonCurrentGame(currentGame, player) {
  const playerPoints = currentGame.pointsWonByPlayer[player];
  const opponentPoints = currentGame.pointsWonByPlayer[getOpponentOf(player)];

  if (playerPoints < currentGame.pointsNeededToWin) {
    return false;
  }

  const isNoAdvantageStandardGame =
    currentGame.gameType === GAME_TYPES.STANDARD_GAME &&
    currentGame.scoringMethod === GAME_SCORING_METHODS.NO_ADVANTAGE;

  if (isNoAdvantageStandardGame) {
    return true; // the deciding point at deuce wins the game outright
  }

  return playerPoints - opponentPoints >= MINIMUM_WINNING_MARGIN;
}

// ---- 5e. The game ends: update the set ----------------------------------------

function completeCurrentGame(matchState, gameWinner) {
  const { currentSet, currentGame } = matchState;

  matchState.totalGamesCompletedInMatch += 1;
  currentSet.gamesWonByPlayer[gameWinner] += 1;

  const wasTiebreak = currentGame.gameType !== GAME_TYPES.STANDARD_GAME;
  if (wasTiebreak) {
    // The winner of a set tiebreak wins the set 7-6 (or 5-4, 9-8, ...).
    // The winner of a match tiebreak wins that "set" 1-0.
    currentSet.tiebreakPointsByPlayer = { ...currentGame.pointsWonByPlayer };
    completeCurrentSet(matchState, gameWinner);
    return;
  }

  if (hasPlayerWonGamesSet(currentSet, gameWinner)) {
    completeCurrentSet(matchState, gameWinner);
    return;
  }

  if (isSetTiebreakDue(currentSet)) {
    startTiebreak(matchState, GAME_TYPES.SET_TIEBREAK, currentSet.setRules.tiebreakPointsNeededToWin);
    return;
  }

  startStandardGame(matchState);
}

// ---- 5f. Is the set over, or is a tiebreak needed? ------------------------------

function hasPlayerWonGamesSet(currentSet, player) {
  const playerGames = currentSet.gamesWonByPlayer[player];
  const opponentGames = currentSet.gamesWonByPlayer[getOpponentOf(player)];

  return (
    playerGames >= currentSet.setRules.gamesNeededToWinSet &&
    playerGames - opponentGames >= MINIMUM_WINNING_MARGIN
  );
}

function isSetTiebreakDue(currentSet) {
  const { tiebreakPlayedAtGamesAll } = currentSet.setRules;
  if (tiebreakPlayedAtGamesAll === null) {
    return false; // advantage set: play continues until someone leads by two games
  }

  return (
    currentSet.gamesWonByPlayer[PLAYER_A] === tiebreakPlayedAtGamesAll &&
    currentSet.gamesWonByPlayer[PLAYER_B] === tiebreakPlayedAtGamesAll
  );
}

// ---- 5g. The set ends: update the match --------------------------------------

function completeCurrentSet(matchState, setWinner) {
  const finishedSet = matchState.currentSet;
  finishedSet.setWinner = setWinner;

  matchState.completedSets.push(finishedSet);
  matchState.setsWonByPlayer[setWinner] += 1;

  if (hasPlayerWonMatch(matchState, setWinner)) {
    completeMatch(matchState, setWinner);
    return;
  }

  startNextSet(matchState);
}

// ---- 5h. Is the match over? ----------------------------------------------

function hasPlayerWonMatch(matchState, player) {
  return matchState.setsWonByPlayer[player] >= getNumberOfSetsNeededToWinMatch(matchState.matchFormat);
}

function completeMatch(matchState, matchWinner) {
  matchState.matchWinner = matchWinner;
  matchState.currentSet = null;
  matchState.currentGame = null;
}

// =============================================================================
// PART 6 — KEEPING SCORE AS POINTS ARE RECORDED (AND UNDONE)
// =============================================================================

/**
 * Rebuilds the complete match state from the list of points played so far.
 * Scoring is deterministic, so replaying the point history always gives the
 * correct score and server. This is what makes "undo" reliable, even when the
 * undone point had ended a game, set, tiebreak or the match itself.
 */
function computeMatchStateFromPointHistory(pointHistory, matchFormat, firstServer) {
  const matchState = createNewMatch(matchFormat, firstServer);

  pointHistory.forEach((point, pointIndex) => {
    validateRecordedPoint(point);
    if (matchState.matchWinner !== null) {
      throw new Error(`Point #${pointIndex + 1} was recorded after the match had already ended.`);
    }
    playPoint(matchState, point.winner);
  });

  return matchState;
}

/**
 * The object your app interacts with.
 *
 *   const scorer = new TennisMatchScorer({
 *     matchFormat: MATCH_FORMATS.USTA_LEAGUE,
 *     firstServer: "A",
 *     playerNames: { A: "Alice", B: "Beth" },
 *   });
 *
 *   scorer.recordPoint({ winner: "A", outcome: "winner" });  // returns the updated score
 *   scorer.undoLastPoint();                                   // returns the updated score
 *   scorer.getCurrentServer();                                // "A" | "B" | null
 */
class TennisMatchScorer {
  constructor({ matchFormat, firstServer, playerNames = DEFAULT_PLAYER_NAMES }) {
    this.matchFormat = matchFormat;
    this.firstServer = firstServer;
    this.playerNames = { ...DEFAULT_PLAYER_NAMES, ...playerNames };
    this.recordedPoints = [];
    this.matchState = createNewMatch(matchFormat, firstServer);
  }

  /** Records one point and returns the updated score. */
  recordPoint(point) {
    validateRecordedPoint(point);
    if (this.matchState.matchWinner !== null) {
      throw new Error("The match is already over, so no more points can be recorded.");
    }

    playPoint(this.matchState, point.winner);
    this.recordedPoints.push({ winner: point.winner, outcome: point.outcome });
    return this.getScore();
  }

  /** Removes the most recent point and returns the updated score. */
  undoLastPoint() {
    if (this.recordedPoints.length === 0) {
      return this.getScore();
    }

    this.recordedPoints.pop();
    this.matchState = computeMatchStateFromPointHistory(this.recordedPoints, this.matchFormat, this.firstServer);
    return this.getScore();
  }

  /** Replaces the whole point history, e.g. when resuming a saved match. */
  loadPointHistory(pointHistory) {
    const rebuiltMatchState = computeMatchStateFromPointHistory(pointHistory, this.matchFormat, this.firstServer);
    this.recordedPoints = pointHistory.map((point) => ({ winner: point.winner, outcome: point.outcome }));
    this.matchState = rebuiltMatchState;
    return this.getScore();
  }

  getCurrentServer() {
    return determineCurrentServer(this.matchState);
  }

  isMatchComplete() {
    return this.matchState.matchWinner !== null;
  }

  getScore() {
    return describeMatchScore(this.matchState, this.playerNames);
  }
}

// =============================================================================
// PART 7 — ANNOUNCING THE SCORE
// =============================================================================

const DISPLAYED_STANDARD_GAME_POINTS = Object.freeze(["0", "15", "30", "40"]);
const SPOKEN_STANDARD_GAME_POINTS = Object.freeze(["Love", "15", "30", "40"]);

/**
 * Produces a display-friendly snapshot of the match score.
 * Per-player values are keyed by "A" and "B". `spokenScore` follows umpire
 * convention: the server's score is called first.
 */
function describeMatchScore(matchState, playerNames = DEFAULT_PLAYER_NAMES) {
  const currentServer = determineCurrentServer(matchState);

  const allSetsSoFar = matchState.currentSet
    ? [...matchState.completedSets, matchState.currentSet]
    : matchState.completedSets;
  const setScores = allSetsSoFar.map(describeSet);
  const currentGame = describeCurrentGame(matchState.currentGame, currentServer, playerNames);

  return {
    matchFormatName: matchState.matchFormat.formatName,
    isMatchComplete: matchState.matchWinner !== null,
    matchWinner: matchState.matchWinner,
    currentServer,
    currentSetNumber: matchState.currentSet ? matchState.currentSet.setNumber : null,
    totalPointsPlayed: matchState.totalPointsPlayed,
    setsWonByPlayer: { ...matchState.setsWonByPlayer },
    setScores,
    currentGame,
    scoreLine: buildScoreLine(matchState, setScores, currentGame, currentServer, playerNames),
  };
}

function describeSet(set) {
  return {
    setNumber: set.setNumber,
    isMatchTiebreak: set.setRules.setType === SET_TYPES.MATCH_TIEBREAK,
    gamesWonByPlayer: { ...set.gamesWonByPlayer },
    tiebreakPointsByPlayer: set.tiebreakPointsByPlayer ? { ...set.tiebreakPointsByPlayer } : null,
    setWinner: set.setWinner,
    isSetComplete: set.setWinner !== null,
  };
}

function describeCurrentGame(currentGame, currentServer, playerNames) {
  if (currentGame === null) {
    return null;
  }

  const pointsWonByPlayer = { ...currentGame.pointsWonByPlayer };

  if (currentGame.gameType === GAME_TYPES.STANDARD_GAME) {
    const { displayedScoreByPlayer, spokenScore } = describeStandardGameScore(currentGame, currentServer, playerNames);
    return { gameType: currentGame.gameType, pointsWonByPlayer, displayedScoreByPlayer, spokenScore };
  }

  const tiebreakLabel = currentGame.gameType === GAME_TYPES.SET_TIEBREAK ? "Tiebreak" : "Match tiebreak";
  const serverPoints = pointsWonByPlayer[currentServer];
  const receiverPoints = pointsWonByPlayer[getOpponentOf(currentServer)];

  return {
    gameType: currentGame.gameType,
    pointsWonByPlayer,
    pointsNeededToWin: currentGame.pointsNeededToWin,
    displayedScoreByPlayer: {
      [PLAYER_A]: String(pointsWonByPlayer[PLAYER_A]),
      [PLAYER_B]: String(pointsWonByPlayer[PLAYER_B]),
    },
    spokenScore: `${tiebreakLabel}: ${serverPoints}-${receiverPoints}`,
  };
}

function describeStandardGameScore(currentGame, currentServer, playerNames) {
  const receiver = getOpponentOf(currentServer);
  const serverPoints = currentGame.pointsWonByPlayer[currentServer];
  const receiverPoints = currentGame.pointsWonByPlayer[receiver];
  const bothPlayersHaveReachedForty = serverPoints >= 3 && receiverPoints >= 3;

  if (bothPlayersHaveReachedForty && serverPoints === receiverPoints) {
    const isDecidingPoint = currentGame.scoringMethod === GAME_SCORING_METHODS.NO_ADVANTAGE;
    return {
      displayedScoreByPlayer: { [PLAYER_A]: "40", [PLAYER_B]: "40" },
      spokenScore: isDecidingPoint ? "Deuce, deciding point" : "Deuce",
    };
  }

  if (bothPlayersHaveReachedForty) {
    const playerWithAdvantage = serverPoints > receiverPoints ? currentServer : receiver;
    return {
      displayedScoreByPlayer: {
        [playerWithAdvantage]: "Ad",
        [getOpponentOf(playerWithAdvantage)]: "40",
      },
      spokenScore: `Advantage ${playerNames[playerWithAdvantage]}`,
    };
  }

  const spokenScore =
    serverPoints === receiverPoints
      ? `${SPOKEN_STANDARD_GAME_POINTS[serverPoints]}-all`
      : `${SPOKEN_STANDARD_GAME_POINTS[serverPoints]}-${SPOKEN_STANDARD_GAME_POINTS[receiverPoints]}`;

  return {
    displayedScoreByPlayer: {
      [PLAYER_A]: DISPLAYED_STANDARD_GAME_POINTS[currentGame.pointsWonByPlayer[PLAYER_A]],
      [PLAYER_B]: DISPLAYED_STANDARD_GAME_POINTS[currentGame.pointsWonByPlayer[PLAYER_B]],
    },
    spokenScore,
  };
}

/** Formats a set the way it appears on a scoreboard: "6-4", "7-6(5)", "[10-8]". */
function formatSetScore(setDescription) {
  if (setDescription.isMatchTiebreak) {
    if (!setDescription.isSetComplete) {
      return null; // an in-progress match tiebreak is shown as the current game instead
    }
    const tiebreakPoints = setDescription.tiebreakPointsByPlayer;
    return `[${tiebreakPoints[PLAYER_A]}-${tiebreakPoints[PLAYER_B]}]`;
  }

  const games = setDescription.gamesWonByPlayer;
  let setScoreText = `${games[PLAYER_A]}-${games[PLAYER_B]}`;

  if (setDescription.tiebreakPointsByPlayer) {
    const tiebreakPoints = setDescription.tiebreakPointsByPlayer;
    const tiebreakLosersPoints = Math.min(tiebreakPoints[PLAYER_A], tiebreakPoints[PLAYER_B]);
    setScoreText += `(${tiebreakLosersPoints})`;
  }

  return setScoreText;
}

/**
 * One-line summary, always written from Player A's perspective, e.g.
 *   "Alice vs Beth | 6-4, 6-7(3), 2-1 | 30-15 | Alice serving"
 */
function buildScoreLine(matchState, setScores, currentGameDescription, currentServer, playerNames) {
  const scoreLineParts = [`${playerNames[PLAYER_A]} vs ${playerNames[PLAYER_B]}`];

  const setScoresText = setScores.map(formatSetScore).filter((setText) => setText !== null).join(", ");
  if (setScoresText) {
    scoreLineParts.push(setScoresText);
  }

  if (matchState.matchWinner !== null) {
    scoreLineParts.push(`${playerNames[matchState.matchWinner]} wins`);
    return scoreLineParts.join(" | ");
  }

  const displayedGameScore = currentGameDescription.displayedScoreByPlayer;
  const gameScoreText = `${displayedGameScore[PLAYER_A]}-${displayedGameScore[PLAYER_B]}`;

  if (currentGameDescription.gameType === GAME_TYPES.SET_TIEBREAK) {
    scoreLineParts.push(`Tiebreak ${gameScoreText}`);
  } else if (currentGameDescription.gameType === GAME_TYPES.MATCH_TIEBREAK) {
    scoreLineParts.push(`Match tiebreak ${gameScoreText}`);
  } else {
    scoreLineParts.push(gameScoreText);
  }

  scoreLineParts.push(`${playerNames[currentServer]} serving`);
  return scoreLineParts.join(" | ");
}

// =============================================================================
// PART 8 — EXPORTS AND A DEMONSTRATION MATCH
// =============================================================================

const tennisMatchScoring = {
  PLAYER_A,
  PLAYER_B,
  POINT_OUTCOMES,
  GAME_SCORING_METHODS,
  SET_TYPES,
  GAME_TYPES,
  SET_RULES,
  MATCH_FORMATS,
  TennisMatchScorer,
  createNewMatch,
  playPoint,
  determineCurrentServer,
  computeMatchStateFromPointHistory,
  describeMatchScore,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = tennisMatchScoring;
} else if (typeof window !== "undefined") {
  window.tennisMatchScoring = tennisMatchScoring;
}

/** Plays a short USTA League match to show scoring, server changes and undo. */
function runDemonstrationMatch() {
  const scorer = new TennisMatchScorer({
    matchFormat: MATCH_FORMATS.USTA_LEAGUE,
    firstServer: PLAYER_A,
    playerNames: { [PLAYER_A]: "Alice", [PLAYER_B]: "Beth" },
  });

  const recordPointWonBy = (player) => scorer.recordPoint({ winner: player, outcome: POINT_OUTCOMES.WINNER });
  const recordGameWonBy = (player) => {
    for (let pointNumber = 1; pointNumber <= POINTS_NEEDED_TO_WIN_STANDARD_GAME; pointNumber += 1) {
      recordPointWonBy(player);
    }
  };

  console.log("Start of match:      ", scorer.getScore().scoreLine);

  // Set 1: both players hold serve until Alice breaks in the final game to win 6-4.
  [PLAYER_A, PLAYER_B, PLAYER_A, PLAYER_B, PLAYER_A, PLAYER_B, PLAYER_A, PLAYER_B, PLAYER_A, PLAYER_A]
    .forEach(recordGameWonBy);
  console.log("After set 1:         ", scorer.getScore().scoreLine);

  // A game with deuce and advantage.
  [PLAYER_A, PLAYER_A, PLAYER_B, PLAYER_B, PLAYER_A, PLAYER_B, PLAYER_B].forEach(recordPointWonBy);
  console.log("Mid-game:            ", scorer.getScore().scoreLine, "|", scorer.getScore().currentGame.spokenScore);
  recordPointWonBy(PLAYER_B); // Beth breaks
  console.log("Beth breaks:         ", scorer.getScore().scoreLine);
  scorer.undoLastPoint();
  console.log("Undo:                ", scorer.getScore().scoreLine, "|", scorer.getScore().currentGame.spokenScore);
  recordPointWonBy(PLAYER_B);

  // Set 2 continues with holds of serve to 6-6.
  [PLAYER_B, PLAYER_A, PLAYER_B, PLAYER_A, PLAYER_B, PLAYER_A, PLAYER_B, PLAYER_A, PLAYER_A, PLAYER_B, PLAYER_A]
    .forEach(recordGameWonBy);
  console.log("Tiebreak begins:     ", scorer.getScore().scoreLine);

  // Tiebreak serving pattern: 1 point, then 2 points each.
  [PLAYER_A, PLAYER_B, PLAYER_A, PLAYER_A, PLAYER_B, PLAYER_B, PLAYER_B, PLAYER_B, PLAYER_B, PLAYER_B].forEach(
    (pointWinner) => {
      const serverBeforePoint = scorer.getCurrentServer();
      const scoreLine = recordPointWonBy(pointWinner).scoreLine;
      console.log(`  ${serverBeforePoint} served, ${pointWinner} won the point -> ${scoreLine}`);
    }
  );

  // Match tiebreak in place of a third set; Alice wins it 10-8.
  for (let exchangeNumber = 1; exchangeNumber <= 8; exchangeNumber += 1) {
    recordPointWonBy(PLAYER_A);
    recordPointWonBy(PLAYER_B);
  }
  recordPointWonBy(PLAYER_A);
  console.log("Match point:         ", scorer.getScore().scoreLine);
  recordPointWonBy(PLAYER_A);
  console.log("Final:               ", scorer.getScore().scoreLine);

  scorer.undoLastPoint();
  console.log("Undo match point:    ", scorer.getScore().scoreLine);
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  runDemonstrationMatch();
}