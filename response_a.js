"use strict";

/*
 * TENNIS MATCH SCORING
 *
 * Turns the app's list of recorded points into the actual score of the match.
 * The file is laid out in the order a tennis match unfolds:
 *
 *   1. Before the match: players and match formats
 *   2. The match begins
 *   3. A set begins
 *   4. A game begins
 *   5. A player serves
 *   6. A point is played
 *   7. A game is won
 *   8. A set is won
 *   9. The match is won
 *  10. Connecting to the app (recording and undoing points)
 *  11. Reading the score
 */

// =============================================================================
// 1. BEFORE THE MATCH: PLAYERS AND MATCH FORMATS
// =============================================================================

const PLAYER_A = "A";
const PLAYER_B = "B";

const GAME_TYPES = {
  STANDARD_GAME: "standard_game", // 0, 15, 30, 40, deuce, advantage
  SET_TIEBREAK: "set_tiebreak", // decides a set when the games are tied
  MATCH_TIEBREAK: "match_tiebreak", // played instead of a full deciding set
};

const POINTS_NEEDED_TO_WIN_STANDARD_GAME = 4;
const POINTS_LEAD_NEEDED_TO_WIN_TIEBREAK = 2;
const GAMES_LEAD_NEEDED_TO_WIN_SET = 2;
const STANDARD_GAME_POINT_NAMES = ["0", "15", "30", "40"];

/*
 * Every match format is described by the same settings:
 *
 *   setsNeededToWinMatch                  3 = best of five, 2 = best of three
 *   gamesNeededToWinSet                   6 for regular sets, 4 for short sets
 *   gamesAllScoreThatStartsSetTiebreak    6 means a tiebreak is played at 6-6
 *                                         (null = advantage sets, no tiebreak)
 *   pointsNeededToWinSetTiebreak          tiebreak length in non-deciding sets
 *   isDecidingSetReplacedByMatchTiebreak  true = match tiebreak instead of a
 *                                         full deciding set
 *   pointsNeededToWinDecidingTiebreak     tiebreak length in the deciding set
 *                                         (whether it is a match tiebreak or a
 *                                         tiebreak at the end of a full set)
 *   isNoAdScoring                         true = at deuce, the next point wins
 *
 * To tweak a format, copy one and override a setting, for example:
 *   const noAdLeagueFormat = { ...MATCH_FORMATS.USTA_LEAGUE, isNoAdScoring: true };
 */
const MATCH_FORMATS = {
  // Men's singles at the four majors: 10-point tiebreak at 6-6 in the fifth set.
  GRAND_SLAM_BEST_OF_FIVE_SETS: {
    formatName: "Grand Slam (best of five sets)",
    setsNeededToWinMatch: 3,
    gamesNeededToWinSet: 6,
    gamesAllScoreThatStartsSetTiebreak: 6,
    pointsNeededToWinSetTiebreak: 7,
    isDecidingSetReplacedByMatchTiebreak: false,
    pointsNeededToWinDecidingTiebreak: 10,
    isNoAdScoring: false,
  },

  // Women's singles at the four majors: 10-point tiebreak at 6-6 in the third set.
  GRAND_SLAM_BEST_OF_THREE_SETS: {
    formatName: "Grand Slam (best of three sets)",
    setsNeededToWinMatch: 2,
    gamesNeededToWinSet: 6,
    gamesAllScoreThatStartsSetTiebreak: 6,
    pointsNeededToWinSetTiebreak: 7,
    isDecidingSetReplacedByMatchTiebreak: false,
    pointsNeededToWinDecidingTiebreak: 10,
    isNoAdScoring: false,
  },

  // Regular tour-style events: best of three sets, 7-point tiebreak in every set.
  // Also use this for junior events that play a full third set.
  REGULAR_TOURNAMENT: {
    formatName: "Regular tournament (best of three tiebreak sets)",
    setsNeededToWinMatch: 2,
    gamesNeededToWinSet: 6,
    gamesAllScoreThatStartsSetTiebreak: 6,
    pointsNeededToWinSetTiebreak: 7,
    isDecidingSetReplacedByMatchTiebreak: false,
    pointsNeededToWinDecidingTiebreak: 7,
    isNoAdScoring: false,
  },

  // USTA League: two tiebreak sets, 10-point match tiebreak instead of a third set.
  USTA_LEAGUE: {
    formatName: "USTA League (match tiebreak instead of a third set)",
    setsNeededToWinMatch: 2,
    gamesNeededToWinSet: 6,
    gamesAllScoreThatStartsSetTiebreak: 6,
    pointsNeededToWinSetTiebreak: 7,
    isDecidingSetReplacedByMatchTiebreak: true,
    pointsNeededToWinDecidingTiebreak: 10,
    isNoAdScoring: false,
  },

  // Junior tournaments: two tiebreak sets, 10-point match tiebreak instead of a third set.
  JUNIOR_TOURNAMENT: {
    formatName: "Junior tournament (match tiebreak instead of a third set)",
    setsNeededToWinMatch: 2,
    gamesNeededToWinSet: 6,
    gamesAllScoreThatStartsSetTiebreak: 6,
    pointsNeededToWinSetTiebreak: 7,
    isDecidingSetReplacedByMatchTiebreak: true,
    pointsNeededToWinDecidingTiebreak: 10,
    isNoAdScoring: false,
  },

  // Younger juniors (10 and under): short sets to 4 games, tiebreak at 4-4,
  // 7-point match tiebreak instead of a third set.
  JUNIOR_SHORT_SETS: {
    formatName: "Junior short sets (first to four games)",
    setsNeededToWinMatch: 2,
    gamesNeededToWinSet: 4,
    gamesAllScoreThatStartsSetTiebreak: 4,
    pointsNeededToWinSetTiebreak: 7,
    isDecidingSetReplacedByMatchTiebreak: true,
    pointsNeededToWinDecidingTiebreak: 7,
    isNoAdScoring: false,
  },
};

function getOpponentOf(player) {
  return player === PLAYER_A ? PLAYER_B : PLAYER_A;
}

function assertIsValidPlayer(player) {
  if (player !== PLAYER_A && player !== PLAYER_B) {
    throw new Error(`Expected player to be "A" or "B" but received: ${player}`);
  }
}

// =============================================================================
// 2. THE MATCH BEGINS
// =============================================================================

function startMatch(matchFormat, playerServingFirstInMatch) {
  assertIsValidPlayer(playerServingFirstInMatch);

  const match = {
    matchFormat: matchFormat,
    playerServingFirstInMatch: playerServingFirstInMatch,
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

// =============================================================================
// 3. A SET BEGINS
// =============================================================================

function startNextSet(match) {
  const { matchFormat, setsWonByPlayer } = match;

  const setsWonBeforeDecidingSet = matchFormat.setsNeededToWinMatch - 1;
  const isDecidingSet =
    setsWonByPlayer.A === setsWonBeforeDecidingSet &&
    setsWonByPlayer.B === setsWonBeforeDecidingSet;

  match.currentSet = {
    setNumber: match.sets.length + 1,
    isDecidingSet: isDecidingSet,
    isPlayedAsMatchTiebreak:
      isDecidingSet && matchFormat.isDecidingSetReplacedByMatchTiebreak,
    gamesWonByPlayer: { A: 0, B: 0 },
    tiebreakPointsWonByPlayer: null, // filled in if the set reaches a tiebreak
    setWinner: null,
  };

  match.sets.push(match.currentSet);
}

// =============================================================================
// 4. A GAME BEGINS
// =============================================================================

function determineTypeOfNextGame(match) {
  const { matchFormat, currentSet } = match;

  if (currentSet.isPlayedAsMatchTiebreak) {
    return GAME_TYPES.MATCH_TIEBREAK;
  }

  const tiebreakScore = matchFormat.gamesAllScoreThatStartsSetTiebreak;
  const areGamesTiedAtTiebreakScore =
    currentSet.gamesWonByPlayer.A === tiebreakScore &&
    currentSet.gamesWonByPlayer.B === tiebreakScore;

  return areGamesTiedAtTiebreakScore
    ? GAME_TYPES.SET_TIEBREAK
    : GAME_TYPES.STANDARD_GAME;
}

function startNextGame(match) {
  const { matchFormat, currentSet } = match;
  const gameType = determineTypeOfNextGame(match);

  let pointsNeededToWin;
  let pointsLeadNeededToWin;

  if (gameType === GAME_TYPES.STANDARD_GAME) {
    pointsNeededToWin = POINTS_NEEDED_TO_WIN_STANDARD_GAME;
    pointsLeadNeededToWin = matchFormat.isNoAdScoring ? 1 : 2;
  } else {
    pointsNeededToWin = currentSet.isDecidingSet
      ? matchFormat.pointsNeededToWinDecidingTiebreak
      : matchFormat.pointsNeededToWinSetTiebreak;
    pointsLeadNeededToWin = POINTS_LEAD_NEEDED_TO_WIN_TIEBREAK;
  }

  match.currentGame = {
    gameType: gameType,
    pointsNeededToWin: pointsNeededToWin,
    pointsLeadNeededToWin: pointsLeadNeededToWin,
    pointsWonByPlayer: { A: 0, B: 0 },
  };

  // The set remembers its tiebreak score (for scorelines such as 7-6(5)).
  // It shares the tiebreak's points object, so it stays up to date during
  // the tiebreak and keeps the final tiebreak score afterwards.
  if (gameType !== GAME_TYPES.STANDARD_GAME) {
    currentSet.tiebreakPointsWonByPlayer = match.currentGame.pointsWonByPlayer;
  }
}

// =============================================================================
// 5. A PLAYER SERVES
// =============================================================================

/*
 * The one place that decides who is serving.
 *
 * - Players alternate serving every game for the whole match. A tiebreak
 *   counts as one game, which is why the player who served first in a
 *   tiebreak receives in the first game of the next set.
 * - Inside a tiebreak, the player whose turn it is serves the first point,
 *   and after that the serve changes hands every two points.
 */
function determineServer(match) {
  if (match.matchWinner !== null) {
    return null;
  }

  let gamesCompletedInMatch = 0;
  for (const set of match.sets) {
    gamesCompletedInMatch += set.gamesWonByPlayer.A + set.gamesWonByPlayer.B;
  }

  const playerServingFirstInCurrentGame =
    gamesCompletedInMatch % 2 === 0
      ? match.playerServingFirstInMatch
      : getOpponentOf(match.playerServingFirstInMatch);

  if (match.currentGame.gameType === GAME_TYPES.STANDARD_GAME) {
    return playerServingFirstInCurrentGame;
  }

  const tiebreakPointsPlayed =
    match.currentGame.pointsWonByPlayer.A + match.currentGame.pointsWonByPlayer.B;
  const serviceChangesSoFarInTiebreak = Math.floor((tiebreakPointsPlayed + 1) / 2);

  return serviceChangesSoFarInTiebreak % 2 === 0
    ? playerServingFirstInCurrentGame
    : getOpponentOf(playerServingFirstInCurrentGame);
}

// =============================================================================
// 6. A POINT IS PLAYED
// =============================================================================

/*
 * Updates the match with one point. A point can win a game, a game can win
 * a set, and a set can win the match - checked in exactly that order.
 * Points played after the match is over are ignored.
 */
function playPoint(match, pointWinner) {
  assertIsValidPlayer(pointWinner);

  if (match.matchWinner !== null) {
    return match;
  }

  awardPointToPlayer(match, pointWinner);

  if (hasPlayerWonCurrentGame(match, pointWinner)) {
    awardGameToPlayer(match, pointWinner);

    if (hasPlayerWonCurrentSet(match, pointWinner)) {
      awardSetToPlayer(match, pointWinner);

      if (hasPlayerWonMatch(match, pointWinner)) {
        awardMatchToPlayer(match, pointWinner);
      } else {
        startNextSet(match);
      }
    }

    if (match.matchWinner === null) {
      startNextGame(match);
    }
  }

  match.server = determineServer(match);

  return match;
}

function awardPointToPlayer(match, pointWinner) {
  match.currentGame.pointsWonByPlayer[pointWinner] += 1;
}

// =============================================================================
// 7. A GAME IS WON
// =============================================================================

function hasPlayerWonCurrentGame(match, player) {
  const { pointsWonByPlayer, pointsNeededToWin, pointsLeadNeededToWin } =
    match.currentGame;

  const playerPoints = pointsWonByPlayer[player];
  const opponentPoints = pointsWonByPlayer[getOpponentOf(player)];

  return (
    playerPoints >= pointsNeededToWin &&
    playerPoints - opponentPoints >= pointsLeadNeededToWin
  );
}

function awardGameToPlayer(match, gameWinner) {
  match.currentSet.gamesWonByPlayer[gameWinner] += 1;
}

// =============================================================================
// 8. A SET IS WON
// =============================================================================

function hasPlayerWonCurrentSet(match, player) {
  const gameJustWonWasTiebreak =
    match.currentGame.gameType !== GAME_TYPES.STANDARD_GAME;

  if (gameJustWonWasTiebreak) {
    return true;
  }

  const { gamesWonByPlayer } = match.currentSet;
  const playerGames = gamesWonByPlayer[player];
  const opponentGames = gamesWonByPlayer[getOpponentOf(player)];

  return (
    playerGames >= match.matchFormat.gamesNeededToWinSet &&
    playerGames - opponentGames >= GAMES_LEAD_NEEDED_TO_WIN_SET
  );
}

function awardSetToPlayer(match, setWinner) {
  match.currentSet.setWinner = setWinner;
  match.setsWonByPlayer[setWinner] += 1;
}

// =============================================================================
// 9. THE MATCH IS WON
// =============================================================================

function hasPlayerWonMatch(match, player) {
  return match.setsWonByPlayer[player] >= match.matchFormat.setsNeededToWinMatch;
}

function awardMatchToPlayer(match, matchWinner) {
  match.matchWinner = matchWinner;
  match.currentSet = null;
  match.currentGame = null;
}

// =============================================================================
// 10. CONNECTING TO THE APP (RECORDING AND UNDOING POINTS)
// =============================================================================

/*
 * Computes the score of the match from the app's list of recorded points,
 * where each point looks like { winner: "A" | "B", outcome: "..." }.
 *
 * Call this every time the list changes:
 *   - after a point is recorded, and
 *   - after the last point is undone.
 * Because the score is always rebuilt from the list, undo needs no special
 * handling and the score can never drift out of sync with the points.
 */
function computeMatchScore(
  recordedPoints,
  matchFormat = MATCH_FORMATS.REGULAR_TOURNAMENT,
  playerServingFirstInMatch = PLAYER_A
) {
  const match = startMatch(matchFormat, playerServingFirstInMatch);

  for (const recordedPoint of recordedPoints) {
    playPoint(match, recordedPoint.winner);
    console.log(describeMatchScore(match));
  }

  return match;
}

// =============================================================================
// 11. READING THE SCORE
// =============================================================================

/*
 * The current game's score for each player, ready for a scoreboard:
 *   standard game -> { A: "40", B: "30" }, { A: "AD", B: "40" }
 *   tiebreak      -> { A: "5", B: "3" }
 */
function getCurrentGameScoreLabelsByPlayer(match) {
  if (match.currentGame === null) {
    return { A: "", B: "" };
  }

  const { gameType, pointsWonByPlayer } = match.currentGame;
  const playerAPoints = pointsWonByPlayer.A;
  const playerBPoints = pointsWonByPlayer.B;

  if (gameType !== GAME_TYPES.STANDARD_GAME) {
    return { A: String(playerAPoints), B: String(playerBPoints) };
  }

  const hasGameReachedDeuce = playerAPoints >= 3 && playerBPoints >= 3;

  if (!hasGameReachedDeuce) {
    return {
      A: STANDARD_GAME_POINT_NAMES[playerAPoints],
      B: STANDARD_GAME_POINT_NAMES[playerBPoints],
    };
  }

  if (playerAPoints === playerBPoints) {
    return { A: "40", B: "40" };
  }

  return playerAPoints > playerBPoints ? { A: "AD", B: "40" } : { A: "40", B: "AD" };
}

// The current game's score as text, player A's score first: "30-15", "Deuce", "AD-40".
function describeCurrentGameScore(match) {
  const scoreLabels = getCurrentGameScoreLabelsByPlayer(match);
  const isDeuce = scoreLabels.A === "40" && scoreLabels.B === "40";

  return isDeuce ? "Deuce" : `${scoreLabels.A}-${scoreLabels.B}`;
}

/*
 * One set's score as text, player A's games first:
 *   "6-4"         regular set
 *   "6-6 (3-2)"   set tiebreak in progress
 *   "7-6(5)"      set won in a tiebreak (loser's tiebreak points in brackets)
 *   "[10-8]"      match tiebreak (in progress or finished)
 */
function describeSetScore(set) {
  const gamesScore = `${set.gamesWonByPlayer.A}-${set.gamesWonByPlayer.B}`;
  const tiebreakPoints = set.tiebreakPointsWonByPlayer;

  if (tiebreakPoints === null) {
    return gamesScore;
  }

  if (set.isPlayedAsMatchTiebreak) {
    return `[${tiebreakPoints.A}-${tiebreakPoints.B}]`;
  }

  if (set.setWinner === null) {
    return `${gamesScore} (${tiebreakPoints.A}-${tiebreakPoints.B})`;
  }

  const tiebreakLoserPoints = Math.min(tiebreakPoints.A, tiebreakPoints.B);
  return `${gamesScore}(${tiebreakLoserPoints})`;
}

/*
 * The whole match as one line, player A's score first:
 *   "6-4, 3-6, 2-1 (40-30) - Player B serving"
 *   "6-4, 6-7(5), [10-8] - Player A wins"
 */
function describeMatchScore(match) {
  const allSetScores = match.sets.map(describeSetScore).join(", ");

  if (match.matchWinner !== null) {
    return `${allSetScores} - Player ${match.matchWinner} wins`;
  }

  // During a tiebreak the points are already shown as part of the set score.
  const isStandardGame = match.currentGame.gameType === GAME_TYPES.STANDARD_GAME;
  const currentGameScore = isStandardGame
    ? ` (${describeCurrentGameScore(match)})`
    : "";

  return `${allSetScores}${currentGameScore} - Player ${match.server} serving`;
}

// =============================================================================
// EXPORTS (for Node or a bundler; in a plain <script> tag everything above is
// already available globally)
// =============================================================================

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PLAYER_A,
    PLAYER_B,
    GAME_TYPES,
    MATCH_FORMATS,
    startMatch,
    determineServer,
    playPoint,
    computeMatchScore,
    getCurrentGameScoreLabelsByPlayer,
    describeCurrentGameScore,
    describeSetScore,
    describeMatchScore,
  };
}
