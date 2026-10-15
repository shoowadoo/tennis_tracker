"use strict";

/*
 * TENNIS MATCH SCORING (singles)
 *
 * Rebuilds the score of a match from the app's list of recorded points.
 * The file follows the order of a real match:
 *   1. Before the match      - match formats
 *   2. The match begins      - startMatch, startNextSet, startNextGame
 *   3. A player serves       - determineServer
 *   4. A point is played     - playPoint, then awardGame -> awardSet -> awardMatch
 *   5. Connecting to the app - computeMatchScore
 *   6. Reading the score     - getGameScoreTextByPlayer, describeMatchScore
 */

// =============================================================================
// 1. BEFORE THE MATCH
// =============================================================================

const POINTS_NEEDED_TO_WIN_STANDARD_GAME = 4;
const STANDARD_GAME_POINT_NAMES = ["0", "15", "30", "40"];
const GAMES_LEAD_NEEDED_TO_WIN_SET = 2;

const DEFAULT_MATCH_FORMAT_SETTINGS = {
  setsNeededToWinMatch: 2, // 2 = best of three, 3 = best of five, 1 = single set
  gamesNeededToWinSet: 6,
  tiebreakPlayedAtGamesAll: 6, // 6 = tiebreak at 6-6; null = no tiebreak (advantage sets)
  pointsNeededToWinSetTiebreak: 7,
  pointsNeededToWinDecidingSetTiebreak: 7, // tiebreak that ends a full deciding set
  pointsNeededToWinMatchTiebreak: null, // a number = a match tiebreak replaces the deciding set
  isNoAdScoring: false, // true = at deuce, the next point wins the game
};

/**
 * Creates a match format from the default settings plus any custom settings.
 * @param {object} [customSettings] Settings that differ from DEFAULT_MATCH_FORMAT_SETTINGS.
 * @returns {object} The complete, read-only match format.
 * @throws {Error} If a custom setting name is not recognized.
 */
function createMatchFormat(customSettings = {}) {
  for (const settingName of Object.keys(customSettings)) {
    if (!(settingName in DEFAULT_MATCH_FORMAT_SETTINGS)) {
      throw new Error(`Unknown match format setting: ${settingName}`);
    }
  }
  return Object.freeze({ ...DEFAULT_MATCH_FORMAT_SETTINGS, ...customSettings });
}

/**
 * Creates a pro set format: one long set, with a tiebreak when the games are tied at the target.
 * @param {number} [gamesNeededToWinSet=8] Games needed to win the pro set (usually 8).
 * @param {object} [customSettings] Any other settings to change, e.g. { isNoAdScoring: true }.
 * @returns {object} The pro set match format.
 */
function createProSetFormat(gamesNeededToWinSet = 8, customSettings = {}) {
  return createMatchFormat({
    setsNeededToWinMatch: 1,
    gamesNeededToWinSet,
    tiebreakPlayedAtGamesAll: gamesNeededToWinSet,
    ...customSettings,
  });
}

const MATCH_FORMATS = {
  GRAND_SLAM_BEST_OF_FIVE_SETS: createMatchFormat({ setsNeededToWinMatch: 3, pointsNeededToWinDecidingSetTiebreak: 10 }),
  GRAND_SLAM_BEST_OF_THREE_SETS: createMatchFormat({ pointsNeededToWinDecidingSetTiebreak: 10 }),
  REGULAR_TOURNAMENT: createMatchFormat(),
  USTA_LEAGUE: createMatchFormat({ pointsNeededToWinMatchTiebreak: 10 }),
  JUNIOR_TOURNAMENT: createMatchFormat({ pointsNeededToWinMatchTiebreak: 10 }),
  JUNIOR_SHORT_SETS: createMatchFormat({ gamesNeededToWinSet: 4, tiebreakPlayedAtGamesAll: 4, pointsNeededToWinMatchTiebreak: 7 }),
  PRO_SET: createProSetFormat(8),
};

/**
 * Finds the other player.
 * @param {"A"|"B"} player
 * @returns {"A"|"B"} The player's opponent.
 */
function getOpponentOf(player) {
  return player === "A" ? "B" : "A";
}

/**
 * Confirms that a value identifies one of the two players.
 * @param {*} player The value to check.
 * @throws {Error} If the value is not "A" or "B".
 */
function assertIsPlayer(player) {
  if (player !== "A" && player !== "B") {
    throw new Error(`Expected player "A" or "B" but received: ${player}`);
  }
}

// =============================================================================
// 2. THE MATCH BEGINS
// =============================================================================

/**
 * Starts a new match at 0-0 in the first game of the first set.
 * @param {object} [matchSetup]
 * @param {object} [matchSetup.matchFormat] One of MATCH_FORMATS, or a format from createMatchFormat.
 * @param {{A?: string, B?: string}} [matchSetup.playerNames] Display names; either one may be omitted.
 * @param {"A"|"B"} [matchSetup.playerServingFirst] The player who serves the first game.
 * @returns {object} The match, which playPoint updates as points are played.
 */
function startMatch({ matchFormat = MATCH_FORMATS.REGULAR_TOURNAMENT, playerNames = {}, playerServingFirst = "A" } = {}) {
  assertIsPlayer(playerServingFirst);

  const match = {
    matchFormat,
    playerNames: { A: "Player A", B: "Player B", ...playerNames },
    playerServingFirst,
    sets: [], // every set started so far, including the current one
    setsWonByPlayer: { A: 0, B: 0 },
    currentSet: null, // null once the match is over
    currentGame: null, // null once the match is over
    server: null, // null once the match is over
    matchWinner: null,
  };

  startNextSet(match);
  startNextGame(match);
  match.server = determineServer(match);
  return match;
}

/**
 * Starts the next set and makes it the current set.
 * @param {object} match The match to update.
 */
function startNextSet(match) {
  const { setsNeededToWinMatch, pointsNeededToWinMatchTiebreak } = match.matchFormat;
  const { A: setsWonByA, B: setsWonByB } = match.setsWonByPlayer;

  // A one-set match (pro set) has no separate deciding set.
  const isDecidingSet =
    setsNeededToWinMatch > 1 &&
    setsWonByA === setsNeededToWinMatch - 1 &&
    setsWonByB === setsNeededToWinMatch - 1;

  match.currentSet = {
    isDecidingSet,
    isPlayedAsMatchTiebreak: isDecidingSet && pointsNeededToWinMatchTiebreak !== null,
    gamesWonByPlayer: { A: 0, B: 0 },
    tiebreakPointsWonByPlayer: null, // filled in when the set is decided by a tiebreak
    setWinner: null,
  };
  match.sets.push(match.currentSet);
}

/**
 * Starts the next game of the current set: a standard game, a set tiebreak or a match tiebreak.
 * @param {object} match The match to update.
 */
function startNextGame(match) {
  const { matchFormat, currentSet } = match;
  const { A: gamesWonByA, B: gamesWonByB } = currentSet.gamesWonByPlayer;

  const isSetTiebreak =
    gamesWonByA === matchFormat.tiebreakPlayedAtGamesAll &&
    gamesWonByB === matchFormat.tiebreakPlayedAtGamesAll;
  const isTiebreak = currentSet.isPlayedAsMatchTiebreak || isSetTiebreak;

  let pointsNeededToWin = POINTS_NEEDED_TO_WIN_STANDARD_GAME;
  if (currentSet.isPlayedAsMatchTiebreak) {
    pointsNeededToWin = matchFormat.pointsNeededToWinMatchTiebreak;
  } else if (isSetTiebreak) {
    pointsNeededToWin = currentSet.isDecidingSet
      ? matchFormat.pointsNeededToWinDecidingSetTiebreak
      : matchFormat.pointsNeededToWinSetTiebreak;
  }

  match.currentGame = {
    isTiebreak,
    pointsNeededToWin,
    pointsLeadNeededToWin: matchFormat.isNoAdScoring && !isTiebreak ? 1 : 2,
    pointsWonByPlayer: { A: 0, B: 0 },
  };
}

// =============================================================================
// 3. A PLAYER SERVES
// =============================================================================

/**
 * Decides who serves the next point. This is the only place the server is worked out.
 * Players alternate every game for the whole match, and a tiebreak counts as one game.
 * Inside a tiebreak, the player due to serve serves the first point, and after that
 * the serve changes hands every two points.
 * @param {object} match The match to inspect.
 * @returns {"A"|"B"|null} The server, or null once the match is over.
 */
function determineServer(match) {
  if (match.matchWinner) return null;

  const gamesPlayedInMatch = match.sets.reduce(
    (gamesPlayed, set) => gamesPlayed + set.gamesWonByPlayer.A + set.gamesWonByPlayer.B,
    0
  );
  const playerDueToServeThisGame =
    gamesPlayedInMatch % 2 === 0 ? match.playerServingFirst : getOpponentOf(match.playerServingFirst);

  if (!match.currentGame.isTiebreak) return playerDueToServeThisGame;

  const { A: pointsWonByA, B: pointsWonByB } = match.currentGame.pointsWonByPlayer;
  const serviceChangesSoFarInTiebreak = Math.floor((pointsWonByA + pointsWonByB + 1) / 2);
  return serviceChangesSoFarInTiebreak % 2 === 0
    ? playerDueToServeThisGame
    : getOpponentOf(playerDueToServeThisGame);
}

// =============================================================================
// 4. A POINT IS PLAYED
// =============================================================================

/**
 * Checks whether a player has reached a target count with a big enough lead.
 * Used for points in a game and for games in a set.
 * @param {{A: number, B: number}} countByPlayer Points or games won by each player.
 * @param {"A"|"B"} player The player to check.
 * @param {number} targetCount The count the player must reach.
 * @param {number} leadNeeded The lead the player must have over the opponent.
 * @returns {boolean} True if the player has reached the target with the lead.
 */
function hasReachedTargetWithLead(countByPlayer, player, targetCount, leadNeeded) {
  const playerCount = countByPlayer[player];
  const opponentCount = countByPlayer[getOpponentOf(player)];
  return playerCount >= targetCount && playerCount - opponentCount >= leadNeeded;
}

/**
 * Adds one point to the match, then awards the game, set and match if they were won.
 * Points played after the match is over are ignored.
 * @param {object} match The match to update.
 * @param {"A"|"B"} pointWinner The player who won the point.
 * @returns {object} The same match, updated.
 */
function playPoint(match, pointWinner) {
  assertIsPlayer(pointWinner);
  if (match.matchWinner) return match;

  const { pointsWonByPlayer, pointsNeededToWin, pointsLeadNeededToWin } = match.currentGame;
  pointsWonByPlayer[pointWinner] += 1;

  if (hasReachedTargetWithLead(pointsWonByPlayer, pointWinner, pointsNeededToWin, pointsLeadNeededToWin)) {
    awardGame(match, pointWinner);
  }

  match.server = determineServer(match);
  return match;
}

/**
 * Awards the current game, then awards the set if the game won it; otherwise play moves to the next game.
 * @param {object} match The match to update.
 * @param {"A"|"B"} gameWinner The player who won the game.
 */
function awardGame(match, gameWinner) {
  const { matchFormat, currentSet, currentGame } = match;
  currentSet.gamesWonByPlayer[gameWinner] += 1;

  if (currentGame.isTiebreak) {
    currentSet.tiebreakPointsWonByPlayer = currentGame.pointsWonByPlayer;
  }

  const hasWonSet =
    currentGame.isTiebreak ||
    hasReachedTargetWithLead(
      currentSet.gamesWonByPlayer,
      gameWinner,
      matchFormat.gamesNeededToWinSet,
      GAMES_LEAD_NEEDED_TO_WIN_SET
    );

  if (hasWonSet) awardSet(match, gameWinner);
  if (!match.matchWinner) startNextGame(match);
}

/**
 * Awards the current set, then awards the match if the set won it; otherwise the next set starts.
 * @param {object} match The match to update.
 * @param {"A"|"B"} setWinner The player who won the set.
 */
function awardSet(match, setWinner) {
  match.currentSet.setWinner = setWinner;
  match.setsWonByPlayer[setWinner] += 1;

  if (match.setsWonByPlayer[setWinner] === match.matchFormat.setsNeededToWinMatch) {
    awardMatch(match, setWinner);
  } else {
    startNextSet(match);
  }
}

/**
 * Awards the match and ends play.
 * @param {object} match The match to update.
 * @param {"A"|"B"} matchWinner The player who won the match.
 */
function awardMatch(match, matchWinner) {
  match.matchWinner = matchWinner;
  match.currentSet = null;
  match.currentGame = null;
}

// =============================================================================
// 5. CONNECTING TO THE APP
// =============================================================================

/**
 * Rebuilds the match from the app's list of recorded points. Call it whenever the
 * list changes: after a point is recorded and after the last point is undone.
 * @param {Array<{winner: "A"|"B"}>} recordedPoints Every point recorded so far, in order.
 * @param {object} [matchSetup] The same setup that startMatch accepts.
 * @returns {object} The match as it stands after the last recorded point.
 */
function computeMatchScore(recordedPoints, matchSetup) {
  const match = startMatch(matchSetup);
  recordedPoints.forEach((recordedPoint) => {
  playPoint(match, recordedPoint.winner);
  console.log(describeMatchScore(match));
});
  return match;
}

// =============================================================================
// 6. READING THE SCORE
// =============================================================================

/**
 * Gets each player's score in the current game as scoreboard text.
 * @param {object} match The match to read.
 * @returns {{A: string, B: string}} For example { A: "40", B: "AD" }, or { A: "5", B: "3" }
 *   in a tiebreak. Both are empty once the match is over.
 */
function getGameScoreTextByPlayer(match) {
  if (!match.currentGame) return { A: "", B: "" };

  const { isTiebreak, pointsWonByPlayer } = match.currentGame;

  const getScoreTextFor = (player) => {
    const playerPoints = pointsWonByPlayer[player];
    const opponentPoints = pointsWonByPlayer[getOpponentOf(player)];
    if (isTiebreak) return String(playerPoints);
    if (playerPoints >= 3 && opponentPoints >= 3) return playerPoints > opponentPoints ? "AD" : "40";
    return STANDARD_GAME_POINT_NAMES[playerPoints];
  };

  return { A: getScoreTextFor("A"), B: getScoreTextFor("B") };
}

/**
 * Describes a completed set, player A's games first.
 * @param {object} set A set that has a winner.
 * @returns {string} "6-4"; "7-6(5)" for a set tiebreak (loser's tiebreak points in
 *   parentheses); "[10-8]" for a match tiebreak.
 */
function describeCompletedSet(set) {
  const { gamesWonByPlayer, tiebreakPointsWonByPlayer } = set;

  if (set.isPlayedAsMatchTiebreak) {
    return `[${tiebreakPointsWonByPlayer.A}-${tiebreakPointsWonByPlayer.B}]`;
  }

  const tiebreakLoserPointsInParentheses = tiebreakPointsWonByPlayer
    ? `(${Math.min(tiebreakPointsWonByPlayer.A, tiebreakPointsWonByPlayer.B)})`
    : "";
  return `${gamesWonByPlayer.A}-${gamesWonByPlayer.B}${tiebreakLoserPointsInParentheses}`;
}

/**
 * Describes the whole match in one line, player A's score first.
 * @param {object} match The match to describe.
 * @returns {string} For example "Ann vs Bea: 6-4, 2-1 (40-30) - Bea serving"
 *   or "Ann vs Bea: 6-4, 6-7(5), [10-8] - Ann wins".
 */
function describeMatchScore(match) {
  const { playerNames, sets, currentSet, server, matchWinner } = match;
  const setDescriptions = sets.filter((set) => set.setWinner).map(describeCompletedSet);

  if (!matchWinner) {
    const gameScoreText = getGameScoreTextByPlayer(match);
    const gameDescription = `${gameScoreText.A}-${gameScoreText.B}`;
    const { A: gamesWonByA, B: gamesWonByB } = currentSet.gamesWonByPlayer;
    setDescriptions.push(
      currentSet.isPlayedAsMatchTiebreak
        ? `[${gameDescription}]`
        : `${gamesWonByA}-${gamesWonByB} (${gameDescription})`
    );
  }

  const matchStatus = matchWinner ? `${playerNames[matchWinner]} wins` : `${playerNames[server]} serving`;
  return `${playerNames.A} vs ${playerNames.B}: ${setDescriptions.join(", ")} - ${matchStatus}`;
}

// =============================================================================
// EXPORTS (Node or a bundler; in a plain <script> tag everything is already global)
// =============================================================================

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MATCH_FORMATS,
    createMatchFormat,
    createProSetFormat,
    startMatch,
    determineServer,
    playPoint,
    computeMatchScore,
    getGameScoreTextByPlayer,
    describeMatchScore,
  };
}