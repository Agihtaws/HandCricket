import { useState, useRef, useEffect, useCallback } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import HandAnimation from '../HandAnimation';
import { WS_URL, BACKEND_URL } from '../../utils/constants';
import './PvPGamePlay.css';

// ─── Constants ────────────────────────────────────────────────────────────
const BALL_SECS    = 5;          // must match backend BALL_TIMER_MS / 1000
const TICK_MS      = 80; 
// ─── Types ────────────────────────────────────────────────────────────────
export interface GameOverResult {
  winner:      string;
  p1Address:   string;
  p2Address:   string;
  p1Score:     number;
  p2Score:     number;
  targetScore: number;
  digest:      string;
}

export interface PvPGamePlayProps {
  gameId:        string;
  isPlayer1:     boolean;
  p1Address:     string;
  p2Address:     string;
  currentBatter: 'p1' | 'p2';
  onGameOver:    (result: GameOverResult) => void;
  onBack:        () => void;
}

type UIPhase =
  | 'connecting'    // WS opening / JOIN_ROOM handshake
  | 'idle'          // between balls (brief pause)
  | 'live'          // BALL_START received, timer running
  | 'submitted'     // player clicked a number, waiting for opponent
  | 'result'        // BALL_RESULT received — showing both hands
  | 'innings_break' // INNINGS_SWITCH received — overlay
  | 'game_over'     // GAME_OVER or GAME_FORFEITED
  | 'disconnected'  // OPPONENT_DISCONNECTED — grace period notice
  | 'error';

interface BallSnapshot {
  p1Move:      number;
  p2Move:      number;
  isOut:       boolean;
  p1Timeout:   boolean;
  p2Timeout:   boolean;
  p1ForceOut:  boolean;
  p2ForceOut:  boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function shortenAddr(a: string) {
  return a ? a.slice(0, 6) + '…' + a.slice(-4) : '…';
}

// ─── Chance Pips ──────────────────────────────────────────────────────────
function ChancePips({ total = 3, left }: { total?: number; left: number }) {
  return (
    <div className="chance-pips">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`pip${i < left ? ' pip--active' : ' pip--spent'}`} />
      ))}
    </div>
  );
}

// ─── Cricket Ball Timer ───────────────────────────────────────────────────
function BallTimer({ secondsLeft, active }: { secondsLeft: number; active: boolean }) {
  const pct    = secondsLeft / BALL_SECS;
  const radius = 22;
  const circ   = 2 * Math.PI * radius;
  const dash   = circ * pct;
  const urgent = secondsLeft <= 2;

  return (
    <div className={`ball-timer${active ? ' ball-timer--active' : ''}${urgent ? ' ball-timer--urgent' : ''}`}>
      <svg className="timer-ring" viewBox="0 0 54 54">
        <circle cx="27" cy="27" r={radius} stroke="rgba(255,255,255,0.08)" strokeWidth="3" fill="none" />
        <circle
          cx="27" cy="27" r={radius}
          stroke={urgent ? '#ef4444' : '#22c55e'}
          strokeWidth="3"
          fill="none"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          strokeDashoffset={0}
          transform="rotate(-90 27 27)"
          style={{ transition: `stroke-dasharray ${TICK_MS}ms linear, stroke 0.3s` }}
        />
      </svg>
      <span className={`timer-num${urgent ? ' timer-num--urgent' : ''}`}>
        {active ? secondsLeft.toFixed(0) : '·'}
      </span>
    </div>
  );
}

// ─── Score Pill ───────────────────────────────────────────────────────────
function ScorePill({
  label, score, isBatting, isMine,
}: {
  label: string; score: number; isBatting: boolean; isMine: boolean;
}) {
  return (
    <div className={`score-pill${isBatting ? ' score-pill--batting' : ''}${isMine ? ' score-pill--mine' : ''}`}>
      <span className="score-pill-label">{label}</span>
      <span className="score-pill-val">{score}</span>
      {isBatting && <span className="score-pill-bat">🏏</span>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────
export default function PvPGamePlay({
  gameId,
  isPlayer1,
  p1Address,
  p2Address,
  currentBatter: initBatter,
  onGameOver,
  onBack,
}: PvPGamePlayProps) {
  const account = useCurrentAccount();

  // ── Core game state ──────────────────────────────────────────────────
  const [uiPhase,      setUiPhase]      = useState<UIPhase>('connecting');
  const [innings,      setInnings]      = useState(1);
  const [batter,       setBatter]       = useState<'p1' | 'p2'>(initBatter);
  const [p1Score,      setP1Score]      = useState(0);
  const [p2Score,      setP2Score]      = useState(0);
  const [targetScore,  setTargetScore]  = useState(0);
  const [p1Chances,    setP1Chances]    = useState(3);
  const [p2Chances,    setP2Chances]    = useState(3);

  // ── Ball state ───────────────────────────────────────────────────────
  const [secondsLeft,  setSecondsLeft]  = useState(BALL_SECS);
  const [myMove,       setMyMove]       = useState<number | null>(null);
  const [oppMove,      setOppMove]      = useState<number | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [lastBall,     setLastBall]     = useState<BallSnapshot | null>(null);

  // ── Innings break ────────────────────────────────────────────────────
  const [newInningsData, setNewInningsData] = useState<{
    target: number; newBatter: 'p1' | 'p2';
  } | null>(null);

  // ── Game over ─────────────────────────────────────────────────────────
  const [gameOverData, setGameOverData] = useState<GameOverResult | null>(null);
  const [forfeitData,  setForfeitData]  = useState<{ winner: string; loser: string; message: string } | null>(null);

  // ── Misc UI ───────────────────────────────────────────────────────────
  const [errorMsg,     setErrorMsg]     = useState('');
  const [disconnMsg,   setDisconnMsg]   = useState('');
  const [dotCount,     setDotCount]     = useState(1);

  // ── Refs ──────────────────────────────────────────────────────────────
  const wsRef        = useRef<WebSocket | null>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const ballStartRef = useRef<number>(0);
  const mounted      = useRef(true);

  // ── Computed ──────────────────────────────────────────────────────────
  const mySlot     = isPlayer1 ? 'p1' : 'p2';
  const oppSlot    = isPlayer1 ? 'p2' : 'p1';
  const myScore    = isPlayer1 ? p1Score  : p2Score;
  const oppScore   = isPlayer1 ? p2Score  : p1Score;
  const myChances  = isPlayer1 ? p1Chances : p2Chances;
  const oppChances = isPlayer1 ? p2Chances : p1Chances;
  const iAmBatting = batter === mySlot;
  const myAddr     = isPlayer1 ? p1Address : p2Address;
  const oppAddr    = isPlayer1 ? p2Address : p1Address;

  // ── Dot animation ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!['connecting', 'idle', 'submitted', 'innings_break', 'disconnected'].includes(uiPhase)) return;
    const id = setInterval(() => setDotCount(d => (d % 3) + 1), 500);
    return () => clearInterval(id);
  }, [uiPhase]);

  // ── Cleanup ────────────────────────────────────────────────────────────
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      wsRef.current?.close();
    };
  }, []);

  // ── Timer management ──────────────────────────────────────────────────
  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const startTimer = useCallback((serverTs: number) => {
    stopTimer();
    ballStartRef.current = serverTs;
    timerRef.current = setInterval(() => {
      if (!mounted.current) return;
      const elapsed  = (Date.now() - ballStartRef.current) / 1000;
      const rem      = Math.max(0, BALL_SECS - elapsed);
      setSecondsLeft(rem);
    }, TICK_MS);
  }, [stopTimer]);

  // ── WS send ────────────────────────────────────────────────────────────
  const send = useCallback((payload: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  // ── Reset per-ball UI state ────────────────────────────────────────────
  const resetBall = useCallback(() => {
    setMyMove(null);
    setOppMove(null);
    setHasSubmitted(false);
    setLastBall(null);
  }, []);

  // ── Connect WebSocket ──────────────────────────────────────────────────
  useEffect(() => {
    const playerAddress = account?.address ?? '';
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mounted.current) return;
      ws.send(JSON.stringify({
        type: 'JOIN_ROOM',
        gameId,
        playerAddress,
        isPlayer1,
      }));
      setUiPhase('idle');
    };

    ws.onmessage = (event) => {
      if (!mounted.current) return;
      let msg: any;
      try { msg = JSON.parse(event.data); } catch { return; }

      switch (msg.type) {
        // ─ Ball starts ─────────────────────────────────────────────
        case 'BALL_START': {
          resetBall();
          setInnings(msg.innings ?? 1);
          setBatter(msg.currentBatter);
          setP1Score(msg.p1Score   ?? 0);
          setP2Score(msg.p2Score   ?? 0);
          setTargetScore(msg.targetScore ?? 0);
          setP1Chances(msg.p1ChancesLeft ?? 3);
          setP2Chances(msg.p2ChancesLeft ?? 3);
          startTimer(msg.timestamp);
          setUiPhase('live');
          break;
        }

        // ─ Move ack (only to this player) ──────────────────────────
        case 'MOVE_ACCEPTED': {
          setMyMove(msg.yourMove);
          setUiPhase('submitted');
          break;
        }

        // ─ Ball resolved ────────────────────────────────────────────
        case 'BALL_RESULT': {
          stopTimer();
          const snap: BallSnapshot = {
            p1Move:    msg.p1Move,
            p2Move:    msg.p2Move,
            isOut:     msg.isOut,
            p1Timeout: msg.p1Timeout,
            p2Timeout: msg.p2Timeout,
            p1ForceOut:msg.p1ForceOut,
            p2ForceOut:msg.p2ForceOut,
          };
          setLastBall(snap);
          setMyMove(isPlayer1  ? msg.p1Move : msg.p2Move);
          setOppMove(isPlayer1 ? msg.p2Move : msg.p1Move);
          setP1Score(msg.p1Score);
          setP2Score(msg.p2Score);
          setP1Chances(msg.p1ChancesLeft);
          setP2Chances(msg.p2ChancesLeft);
          setUiPhase('result');
          break;
        }

        // ─ Innings switch ──────────────────────────────────────────
        case 'INNINGS_SWITCH': {
          stopTimer();
          resetBall();
          setInnings(msg.innings);
          setTargetScore(msg.targetScore);
          setBatter(msg.currentBatter);
          setP1Score(msg.p1Score);
          setP2Score(msg.p2Score);
          setNewInningsData({ target: msg.targetScore, newBatter: msg.currentBatter });
          setUiPhase('innings_break');
          break;
        }

        // ─ Game over ───────────────────────────────────────────────
        case 'GAME_OVER': {
          stopTimer();
          const result: GameOverResult = {
            winner:      msg.winner,
            p1Address:   msg.p1Address,
            p2Address:   msg.p2Address,
            p1Score:     msg.p1Score,
            p2Score:     msg.p2Score,
            targetScore: msg.targetScore,
            digest:      msg.digest,
          };
          setGameOverData(result);
          setUiPhase('game_over');
          break;
        }

        // ─ Opponent disconnected ───────────────────────────────────
        case 'OPPONENT_DISCONNECTED': {
          stopTimer();
          setDisconnMsg(msg.message ?? 'Opponent disconnected. Waiting 30 seconds…');
          setUiPhase('disconnected');
          break;
        }

        // ─ Opponent forfeited (disconnect timeout) ─────────────────
        case 'GAME_FORFEITED': {
          stopTimer();
          setForfeitData({ winner: msg.winner, loser: msg.loser, message: msg.message });
          const result: GameOverResult = {
            winner:      msg.winner,
            p1Address:   p1Address,
            p2Address:   p2Address,
            p1Score,
            p2Score,
            targetScore,
            digest:      msg.digest ?? '',
          };
          setGameOverData(result);
          setUiPhase('game_over');
          break;
        }

        case 'OPPONENT_RECONNECTED': {
          setDisconnMsg('');
          if (ballStartRef.current > 0) {
            startTimer(ballStartRef.current);
            setUiPhase('live');
          } else {
            setUiPhase('idle');
          }
          break;
        }

        // ─ Error ───────────────────────────────────────────────────
        case 'ERROR': {
          stopTimer();
          setErrorMsg(msg.message ?? 'Unexpected server error.');
          setUiPhase('error');
          break;
        }

        default: break;
      }
    };

    ws.onerror = () => {
      if (!mounted.current) return;
      setErrorMsg('WebSocket connection failed. Please check your network.');
      setUiPhase('error');
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Submit move ────────────────────────────────────────────────────────
  const handleNumberClick = (n: number) => {
    if (uiPhase !== 'live' || hasSubmitted) return;
    setHasSubmitted(true);
    send({ type: 'SUBMIT_MOVE', gameId, number: n });
    setMyMove(n);                // optimistic update
    setUiPhase('submitted');
  };

  // ── Forfeit / back ─────────────────────────────────────────────────────
  const handleForfeit = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/pvp/forfeit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId,
          forfeitingPlayer: account?.address ?? '',
        }),
      });
    } catch (e) {
      console.error('Forfeit API call failed:', e);
    } finally {
      wsRef.current?.close();
      onBack();
    }
  };

  // ──────────────────────────────────────────────────────────────────────
  //  RENDER
  // ──────────────────────────────────────────────────────────────────────
  const dots      = '.'.repeat(dotCount);
  const myLabel   = isPlayer1 ? 'Player 1' : 'Player 2';
  const oppLabel  = isPlayer1 ? 'Player 2' : 'Player 1';

  // Determine which hand should be animating (shaking)
  const myAnimating = 
    (uiPhase === 'live' && !hasSubmitted) ||          // waiting for me to pick
    (uiPhase === 'submitted' && myMove === null);     // rare – should not happen

  const oppAnimating =
    uiPhase === 'live' ||                             // opp hasn't moved yet
    uiPhase === 'submitted' ||                        // still waiting for opp
    (uiPhase === 'result' && oppMove === null);       // should not happen

  // Which hand got out (for red glow)
  const isMyOut   = lastBall?.isOut && (
    (lastBall.p1ForceOut && isPlayer1) ||
    (lastBall.p2ForceOut && !isPlayer1) ||
    (lastBall.isOut && batter === mySlot)
  );
  const isOppOut  = lastBall?.isOut && (
    (lastBall.p1ForceOut && !isPlayer1) ||
    (lastBall.p2ForceOut && isPlayer1)  ||
    (lastBall.isOut && batter === oppSlot)
  );

  const showResult = uiPhase === 'result' && lastBall !== null;
  const matchedOut = showResult && lastBall!.isOut && !lastBall!.p1ForceOut && !lastBall!.p2ForceOut;

  // ── CONNECTING ────────────────────────────────────────────────────────
  if (uiPhase === 'connecting') {
    return (
      <div className="pvp-gameplay">
        <div className="gp-overlay-card">
          <div className="gp-spinner" />
          <p className="gp-overlay-text">Connecting to match{dots}</p>
        </div>
      </div>
    );
  }

  // ── ERROR ──────────────────────────────────────────────────────────────
  if (uiPhase === 'error') {
    return (
      <div className="pvp-gameplay">
        <div className="gp-overlay-card gp-overlay-card--error">
          <span className="gp-overlay-icon">⚠️</span>
          <h2>Connection Error</h2>
          <p>{errorMsg}</p>
          <button className="gp-back-btn" onClick={onBack}>← Back to Lobby</button>
        </div>
      </div>
    );
  }

  // ── INNINGS BREAK ──────────────────────────────────────────────────────
  if (uiPhase === 'innings_break' && newInningsData) {
    const chaser = newInningsData.newBatter === mySlot ? 'You' : oppLabel;
    return (
      <div className="pvp-gameplay">
        <div className="gp-overlay-card gp-overlay-card--innings">
          <span className="innings-break-icon">🏟️</span>
          <h2 className="innings-break-title">Innings Break</h2>
          <div className="innings-break-score">
            <div className="ib-row">
              <span>{myLabel}</span>
              <span className="ib-score">{myScore}</span>
            </div>
            <div className="ib-row">
              <span>{oppLabel}</span>
              <span className="ib-score">{oppScore}</span>
            </div>
          </div>
          <div className="innings-break-target">
            <span className="ib-target-label">Target</span>
            <span className="ib-target-val">{newInningsData.target}</span>
          </div>
          <p className="innings-break-sub">
            <strong>{chaser}</strong> {chaser === 'You' ? 'are' : 'is'} chasing{dots}
          </p>
        </div>
      </div>
    );
  }

  // ── DISCONNECTED ───────────────────────────────────────────────────────
  if (uiPhase === 'disconnected') {
    return (
      <div className="pvp-gameplay">
        <div className="gp-overlay-card gp-overlay-card--disconn">
          <span className="gp-overlay-icon">📡</span>
          <h2>Opponent Disconnected</h2>
          <p>{disconnMsg}</p>
          <p className="gp-overlay-sub">If they don't reconnect in 30s, you win the pot.</p>
        </div>
      </div>
    );
  }

  // ── GAME OVER ──────────────────────────────────────────────────────────
  if (uiPhase === 'game_over' && gameOverData) {
    const iWon        = gameOverData.winner === myAddr;
    const wasForfeit  = forfeitData !== null;

    return (
      <div className="pvp-gameplay pvp-gameplay--over">
        <div className="game-over-card">
          <div className={`over-banner${iWon ? ' over-banner--win' : ' over-banner--lose'}`}>
            <span className="over-trophy">{iWon ? '🏆' : '💔'}</span>
            <span className="over-result">{iWon ? 'Victory!' : 'Defeated'}</span>
          </div>

          {wasForfeit && (
            <div className="over-forfeit-note">
              {iWon ? '🎉 Opponent forfeited — pot transferred to you!' : '😞 You forfeited the match.'}
            </div>
          )}

          <div className="over-scorecard">
            <div className="over-score-row">
              <span className="over-player-label">{myLabel} <span className="over-addr">{shortenAddr(myAddr)}</span></span>
              <span className="over-player-score">{myScore}</span>
            </div>
            <div className="over-vs-divider">vs</div>
            <div className="over-score-row">
              <span className="over-player-label">{oppLabel} <span className="over-addr">{shortenAddr(oppAddr)}</span></span>
              <span className="over-player-score">{oppScore}</span>
            </div>
            {gameOverData.targetScore > 0 && (
              <div className="over-target-line">Target was {gameOverData.targetScore}</div>
            )}
          </div>

          <div className={`over-payout${iWon ? ' over-payout--win' : ''}`}>
            {iWon
              ? '💰 0.2 OCT transferred to your wallet!'
              : '0.2 OCT transferred to opponent.'}
          </div>

          {gameOverData.digest && (
            <div className="over-digest">
              <span className="over-digest-label">TX</span>
              <span className="over-digest-val">{gameOverData.digest.slice(0, 16)}…</span>
            </div>
          )}

          <button
            className="gp-back-btn gp-back-btn--over"
            onClick={() => onGameOver(gameOverData)}
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // ── MAIN GAMEPLAY ──────────────────────────────────────────────────────
  const isLive    = uiPhase === 'live';
  const isResult  = uiPhase === 'result';

  return (
    <div className="pvp-gameplay">

      {/* Top bar: innings + forfeit */}
      <header className="gp-topbar">
        <button className="gp-forfeit-btn" onClick={handleForfeit}>Forfeit</button>
        <div className="gp-innings-chip">
          <span className="gp-innings-label">Innings</span>
          <span className="gp-innings-num">{innings}</span>
          {innings === 2 && targetScore > 0 && (
            <span className="gp-target-chip">Target: {targetScore}</span>
          )}
        </div>
        <div className="gp-room-chip">
          {gameId.slice(0, 8)}…
        </div>
      </header>

      {/* Score board */}
      <section className="gp-scoreboard">
        <ScorePill
          label={myLabel}
          score={myScore}
          isBatting={iAmBatting}
          isMine={true}
        />
        <div className="gp-scoreboard-sep">
          <span className="sep-line" />
          <span className="sep-vs">vs</span>
          <span className="sep-line" />
        </div>
        <ScorePill
          label={oppLabel}
          score={oppScore}
          isBatting={!iAmBatting}
          isMine={false}
        />
      </section>

      {/* Chance pips */}
      <section className="gp-chances-row">
        <div className="chances-col">
          <span className="chances-label">{myLabel}</span>
          <ChancePips left={myChances} />
        </div>
        <div className="chances-col chances-col--opp">
          <span className="chances-label">{oppLabel}</span>
          <ChancePips left={oppChances} />
        </div>
      </section>

      {/* Arena */}
      <section className="gp-arena">

        {/* Timer ring */}
        <div className="gp-timer-wrap">
          <BallTimer secondsLeft={secondsLeft} active={isLive || uiPhase === 'submitted'} />
        </div>

        {/* Hands face-off using HandAnimation */}
        <div className="gp-hands-row">

          {/* My hand */}
          <div className={`gp-hand-col ${isMyOut ? 'hand-out' : ''}`}>
            <HandAnimation
              number={myMove}
              isAnimating={myAnimating}
            />
            {uiPhase === 'submitted' && !isResult && (
              <div className="gp-submitted-badge">✓ Locked</div>
            )}
            {isMyOut && <div className="hand-out-glow" />} {/* optional extra glow */}
          </div>

          {/* VS divider */}
          <div className="gp-arena-vs">
            {showResult ? (
              matchedOut ? (
                <span className="arena-vs-out">OUT!</span>
              ) : (
                <span className="arena-vs-match">
                  {lastBall!.p1Move === lastBall!.p2Move ? '=' : '≠'}
                </span>
              )
            ) : (
              <span className="arena-vs-text">VS</span>
            )}
          </div>

          {/* Opponent hand */}
          <div className={`gp-hand-col ${isOppOut ? 'hand-out' : ''}`}>
            <HandAnimation
              number={oppMove}
              isAnimating={oppAnimating}
            />
            {isOppOut && <div className="hand-out-glow" />}
          </div>
        </div>

        {/* Ball result message */}
        {showResult && (
          <div className={`gp-result-msg${lastBall!.isOut ? ' gp-result-msg--out' : ' gp-result-msg--score'}`}>
            {lastBall!.isOut ? (
              <span>
                {lastBall!.p1ForceOut || lastBall!.p2ForceOut ? '⏱️ Force Out!' : '🏏 OUT!'}
              </span>
            ) : (
              <span>
                +{iAmBatting ? myMove : oppMove} runs
                {(lastBall!.p1Timeout || lastBall!.p2Timeout) && (
                  <span className="gp-timeout-note"> (timeout)</span>
                )}
              </span>
            )}
          </div>
        )}

      </section>

      {/* Number picker */}
      <section className="gp-picker">
        <div className="gp-picker-label">
          {isLive && !hasSubmitted  ? (iAmBatting ? '🏏 Bat your number' : '🎳 Bowl your number') : ''}
          {uiPhase === 'submitted'  ? '✓ Move locked in — waiting for opponent…' : ''}
          {isResult                 ? 'Next ball coming up…' : ''}
          {uiPhase === 'idle'       ? `Preparing${dots}` : ''}
        </div>
        <div className="gp-number-grid">
          {[1, 2, 3, 4, 5, 6].map(n => (
            <button
              key={n}
              className={`gp-num-btn${myMove === n && uiPhase !== 'live' ? ' gp-num-btn--selected' : ''}${isLive && !hasSubmitted ? ' gp-num-btn--active' : ''}`}
              onClick={() => handleNumberClick(n)}
              disabled={uiPhase !== 'live' || hasSubmitted}
              aria-label={`Play ${n}`}
            >
              <span className="gp-num-val">{n}</span>
              <span className="gp-num-dots">
                {Array.from({ length: n }, (_, i) => (
                  <span key={i} className="gp-dot" style={{ animationDelay: `${i * 50}ms` }} />
                ))}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Status footer */}
      <footer className="gp-footer">
        <span className="gp-footer-addr">You: {shortenAddr(myAddr)}</span>
        <span className="gp-footer-sep">·</span>
        <span className="gp-footer-addr">Opp: {shortenAddr(oppAddr)}</span>
        <span className="gp-footer-sep">·</span>
        <span className="gp-footer-room">{gameId.slice(0, 10)}…</span>
      </footer>

    </div>
  );
}