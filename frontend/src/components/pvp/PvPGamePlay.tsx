import { useState, useRef, useEffect, useCallback } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import HandAnimation from '../HandAnimation';
import { WS_URL, BACKEND_URL } from '../../utils/constants';

// ─── Constants ────────────────────────────────────────────────────────────────
const BALL_SECS   = 5;
const TICK_MS     = 80;
const REVEAL_MS   = 1200; // GamePlay's reveal delay

// ─── Types ────────────────────────────────────────────────────────────────────
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
    | 'connecting' | 'idle' | 'live' | 'submitted'
    | 'result' | 'innings_break' | 'game_over'
    | 'disconnected' | 'error';

interface BallSnapshot {
    p1Move:      number;
    p2Move:      number;
    isOut:       boolean;
    p1Timeout:   boolean;
    p2Timeout:   boolean;
    p1ForceOut:  boolean;
    p2ForceOut:  boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function shortenAddr(a: string) {
    return a ? a.slice(0, 6) + '…' + a.slice(-4) : '…';
}

// ─── Chance Pips ──────────────────────────────────────────────────────────────
function ChancePips({ total = 3, left }: { total?: number; left: number }) {
    return (
        <div className="flex gap-1.5 items-center">
            {Array.from({ length: total }, (_, i) => (
                <span
                    key={i}
                    className={
                        'w-2 h-2 rounded-full transition-all duration-300 ' +
                        (i < left
                            ? 'bg-[#00ff88] shadow-[0_0_6px_#00ff8880]'
                            : 'bg-[#00ff8820] border border-[#00ff8830]')
                    }
                />
            ))}
        </div>
    );
}

// ─── Ball Timer ───────────────────────────────────────────────────────────────
function BallTimer({ secondsLeft, active }: { secondsLeft: number; active: boolean }) {
    const pct    = secondsLeft / BALL_SECS;
    const radius = 22;
    const circ   = 2 * Math.PI * radius;
    const dash   = circ * pct;
    const urgent = secondsLeft <= 2;

    return (
        <div
            className={`relative w-14 h-14 flex items-center justify-center transition-all duration-200 ${
                active ? 'opacity-100' : 'opacity-40'
            }`}
        >
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 54 54">
                <circle
                    cx="27" cy="27" r={radius}
                    stroke="rgba(255,255,255,0.08)" strokeWidth="3" fill="none"
                />
                <circle
                    cx="27" cy="27" r={radius}
                    stroke={urgent ? '#ef4444' : '#00ff88'}
                    strokeWidth="3" fill="none"
                    strokeDasharray={`${dash} ${circ}`}
                    strokeLinecap="round"
                    transform="rotate(-90 27 27)"
                    style={{ transition: `stroke-dasharray ${TICK_MS}ms linear, stroke 0.3s` }}
                />
            </svg>
            <span
                className={`text-sm font-black [font-family:Orbitron,monospace] relative z-10 ${
                    urgent ? 'text-[#ef4444]' : 'text-[#00ff88]'
                }`}
            >
                {active ? secondsLeft.toFixed(0) : '·'}
            </span>
        </div>
    );
}

// ─── Score Pill ───────────────────────────────────────────────────────────────
function ScorePill({
    label, score, isBatting,
}: {
    label: string; score: number; isBatting: boolean; isMine: boolean;
}) {
    return (
        <div
            className={
                'flex flex-col items-center gap-1 px-4 py-2.5 rounded-2xl border transition-all duration-200 ' +
                (isBatting
                    ? 'bg-[#00ff8812] border-[#00ff8860] shadow-[0_0_16px_#00ff8820]'
                    : 'bg-[#0a2212] border-[#00ff8820]')
            }
        >
            <span
                className={`text-[9px] font-semibold tracking-[0.2em] uppercase [font-family:Orbitron,monospace] ${
                    isBatting ? 'text-[#00ff88]' : 'text-white/40'
                }`}
            >
                {label} {isBatting && '🏏'}
            </span>
            <span
                className={`font-black tabular-nums [font-family:Orbitron,monospace] ${
                    isBatting
                        ? 'text-2xl text-[#00ff88] [text-shadow:0_0_16px_#00ff8860]'
                        : 'text-xl text-white/60'
                }`}
            >
                {score}
            </span>
        </div>
    );
}

// ─── Number Button ────────────────────────────────────────────────────────────
const numBtnClass = (selected: boolean, active: boolean) =>
    'relative flex flex-col items-center justify-center rounded-xl border overflow-hidden ' +
    'transition-all duration-150 select-none py-3 ' +
    (!active
        ? 'opacity-40 cursor-not-allowed bg-[#0a2212] border-[#00ff8815] '
        : 'cursor-pointer bg-[#0a2212] border-[#00ff8822] ' +
          'hover:border-[#00ff8860] hover:-translate-y-0.5 active:scale-95 ') +
    (selected ? 'border-[#00ff88] bg-[#00ff8812] shadow-[0_0_12px_#00ff8830] ' : '');

// ─── Shared overlay styles ────────────────────────────────────────────────────
const OVERLAY =
    'fixed inset-0 flex items-center justify-center z-50 bg-[#030f06cc] backdrop-blur-sm px-4';
const OVERLAY_CARD =
    'relative w-full max-w-sm bg-[#071a0c] rounded-2xl overflow-hidden border border-[#00ff8822] ' +
    'shadow-[0_0_0_1px_#00ff8810,0_24px_80px_rgba(0,0,0,0.9)] ' +
    'flex flex-col items-center justify-center text-center px-6 py-8 gap-4 ' +
    'animate-[fadeUp_0.4s_cubic-bezier(0.16,1,0.3,1)_both]';
const SHIMMER =
    'absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#00ff88] to-transparent ' +
    '[animation:shimmerBar_3s_ease-in-out_infinite]';
const BACK_BTN =
    'px-6 py-2.5 rounded-xl font-black text-xs tracking-widest uppercase [font-family:Orbitron,monospace] ' +
    'bg-[#00ff88] text-[#030f06] shadow-[0_0_16px_#00ff8840] ' +
    'hover:shadow-[0_0_28px_#00ff8860] hover:-translate-y-0.5 active:scale-95 transition-all duration-200';

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PvPGamePlay({
    gameId, isPlayer1, p1Address, p2Address,
    currentBatter: initBatter, onGameOver, onBack,
}: PvPGamePlayProps) {
    const account = useCurrentAccount();

    // ── Phase & game state ──────────────────────────────────────────────────
    const [uiPhase,        setUiPhase]        = useState<UIPhase>('connecting');
    const [innings,        setInnings]        = useState(1);
    const [batter,         setBatter]         = useState<'p1' | 'p2'>(initBatter);
    const [p1Score,        setP1Score]        = useState(0);
    const [p2Score,        setP2Score]        = useState(0);
    const [targetScore,    setTargetScore]    = useState(0);
    const [p1Chances,      setP1Chances]      = useState(3);
    const [p2Chances,      setP2Chances]      = useState(3);
    const [secondsLeft,    setSecondsLeft]    = useState(BALL_SECS);

    // ── Move state (raw) ────────────────────────────────────────────────────
    const [_myMove, setMyMove] = useState<number | null>(null);
    const [hasSubmitted,   setHasSubmitted]   = useState(false);
    const [lastBall,       setLastBall]       = useState<BallSnapshot | null>(null);

    const [displayMyMove,  setDisplayMyMove]  = useState<number | null>(null);
    const [displayOppMove, setDisplayOppMove] = useState<number | null>(null);
    const [isRevealing,    setIsRevealing]    = useState(false);

    // ── Overlay data ────────────────────────────────────────────────────────
    const [newInningsData, setNewInningsData] = useState<{ target: number; newBatter: 'p1' | 'p2' } | null>(null);
    const [gameOverData,   setGameOverData]   = useState<GameOverResult | null>(null);
    const [forfeitData,    setForfeitData]    = useState<{ winner: string; loser: string; message: string } | null>(null);
    const [errorMsg,       setErrorMsg]       = useState('');
    const [disconnMsg,     setDisconnMsg]     = useState('');
    const [dotCount,       setDotCount]       = useState(1);

    // ── Refs ────────────────────────────────────────────────────────────────
    const wsRef         = useRef<WebSocket | null>(null);
    const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
    const ballStartRef  = useRef<number>(0);
    const revealTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mounted       = useRef(true);

    // ── Derived ─────────────────────────────────────────────────────────────
    const mySlot     = isPlayer1 ? 'p1' : 'p2';
    const oppSlot    = isPlayer1 ? 'p2' : 'p1';
    const myScore    = isPlayer1 ? p1Score  : p2Score;
    const oppScore   = isPlayer1 ? p2Score  : p1Score;
    const myChances  = isPlayer1 ? p1Chances : p2Chances;
    const oppChances = isPlayer1 ? p2Chances : p1Chances;
    const iAmBatting = batter === mySlot;
    const myAddr     = isPlayer1 ? p1Address : p2Address;
    const oppAddr    = isPlayer1 ? p2Address : p1Address;
    const myLabel    = isPlayer1 ? 'You (P1)' : 'You (P2)';
    const oppLabel   = isPlayer1 ? 'Player 2' : 'Player 1';
    const dots       = '.'.repeat(dotCount);
    const isLive     = uiPhase === 'live';

    // ── Animation logic ─────────────────────────────────────────────────────
    const myHandAnimating  = isRevealing;
    const oppHandAnimating = isRevealing;

    // showResult: the result banner, but only after reveal finishes
    const showResult  = uiPhase === 'result' && lastBall !== null && !isRevealing;
    const matchedOut  = showResult && lastBall!.isOut && !lastBall!.p1ForceOut && !lastBall!.p2ForceOut;

    const isMyOut  = lastBall?.isOut && (
        (lastBall.p1ForceOut && isPlayer1) ||
        (lastBall.p2ForceOut && !isPlayer1) ||
        (lastBall.isOut && batter === mySlot)
    );
    const isOppOut = lastBall?.isOut && (
        (lastBall.p1ForceOut && !isPlayer1) ||
        (lastBall.p2ForceOut && isPlayer1) ||
        (lastBall.isOut && batter === oppSlot)
    );

    // ── Dot animation (connecting / idle states) ────────────────────────────
    useEffect(() => {
        if (!['connecting', 'idle', 'submitted', 'innings_break', 'disconnected'].includes(uiPhase)) return;
        const id = setInterval(() => setDotCount(d => (d % 3) + 1), 500);
        return () => clearInterval(id);
    }, [uiPhase]);

    // ── Cleanup on unmount ──────────────────────────────────────────────────
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            if (timerRef.current)    clearInterval(timerRef.current);
            if (revealTimeout.current) clearTimeout(revealTimeout.current);
            wsRef.current?.close();
        };
    }, []);

    const stopTimer = useCallback(() => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }, []);

    const startTimer = useCallback((serverTs: number) => {
        stopTimer();
        ballStartRef.current = serverTs;
        timerRef.current = setInterval(() => {
            if (!mounted.current) return;
            const elapsed = (Date.now() - ballStartRef.current) / 1000;
            setSecondsLeft(Math.max(0, BALL_SECS - elapsed));
        }, TICK_MS);
    }, [stopTimer]);

    const send = useCallback((payload: object) => {
        if (wsRef.current?.readyState === WebSocket.OPEN)
            wsRef.current.send(JSON.stringify(payload));
    }, []);

    // resetBall clears both raw moves AND display moves
    const resetBall = useCallback(() => {
        setMyMove(null);
        setHasSubmitted(false);
        setLastBall(null);
        setDisplayMyMove(null);
        setDisplayOppMove(null);
        setIsRevealing(false);
        if (revealTimeout.current) { clearTimeout(revealTimeout.current); revealTimeout.current = null; }
    }, []);

    // ── WebSocket setup ─────────────────────────────────────────────────────
    useEffect(() => {
        const playerAddress = account?.address ?? '';
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            if (!mounted.current) return;
            ws.send(JSON.stringify({ type: 'JOIN_ROOM', gameId, playerAddress, isPlayer1 }));
            setUiPhase('idle');
        };

        ws.onmessage = (event) => {
            if (!mounted.current) return;
            let msg: any;
            try { msg = JSON.parse(event.data); } catch { return; }

            switch (msg.type) {
    case 'BALL_START':
        resetBall();
        setInnings(msg.innings ?? 1);
        setBatter(msg.currentBatter);
        setP1Score(msg.p1Score ?? 0);
        setP2Score(msg.p2Score ?? 0);
        setTargetScore(msg.targetScore ?? 0);
        setP1Chances(msg.p1ChancesLeft ?? 3);
        setP2Chances(msg.p2ChancesLeft ?? 3);
        startTimer(msg.timestamp);
        setUiPhase('live');
        break;

    case 'GAME_START':   
        resetBall();
        setInnings(msg.innings ?? 1);
        setBatter(msg.currentBatter);
        setP1Score(0);
        setP2Score(0);
        setTargetScore(0);
        setP1Chances(3);
        setP2Chances(3);
        setUiPhase('live');
        break;

    case 'MOVE_ACCEPTED':
        setMyMove(msg.yourMove);
        setUiPhase('submitted');
        break;

                case 'BALL_RESULT': {
                    stopTimer();
                    const rawMyMove  = isPlayer1 ? msg.p1Move : msg.p2Move;
                    const rawOppMove = isPlayer1 ? msg.p2Move : msg.p1Move;

                    // Save the snapshot but keep display numbers null while animating
                    setLastBall({
                        p1Move: msg.p1Move, p2Move: msg.p2Move,
                        isOut: msg.isOut,
                        p1Timeout: msg.p1Timeout, p2Timeout: msg.p2Timeout,
                        p1ForceOut: msg.p1ForceOut, p2ForceOut: msg.p2ForceOut,
                    });
                    setDisplayMyMove(null);
                    setDisplayOppMove(null);
                    setIsRevealing(true);          // ← triggers shake animation
                    setUiPhase('result');

                    setP1Score(msg.p1Score);
                    setP2Score(msg.p2Score);
                    setP1Chances(msg.p1ChancesLeft);
                    setP2Chances(msg.p2ChancesLeft);

                    // After REVEAL_MS reveal the actual numbers 
                    revealTimeout.current = setTimeout(() => {
                        if (!mounted.current) return;
                        setDisplayMyMove(rawMyMove);
                        setDisplayOppMove(rawOppMove);
                        setIsRevealing(false);
                    }, REVEAL_MS);
                    break;
                }

                case 'INNINGS_SWITCH':
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

                case 'GAME_OVER':
                    stopTimer();
                    setGameOverData({
                        winner: msg.winner, p1Address: msg.p1Address, p2Address: msg.p2Address,
                        p1Score: msg.p1Score, p2Score: msg.p2Score,
                        targetScore: msg.targetScore, digest: msg.digest,
                    });
                    setUiPhase('game_over');
                    break;

                case 'OPPONENT_DISCONNECTED':
                    stopTimer();
                    setDisconnMsg(msg.message ?? 'Opponent disconnected. Waiting 30 seconds…');
                    setUiPhase('disconnected');
                    break;

                case 'GAME_FORFEITED':
                    stopTimer();
                    setForfeitData({ winner: msg.winner, loser: msg.loser, message: msg.message });
                    setGameOverData({
                        winner: msg.winner, p1Address, p2Address,
                        p1Score, p2Score, targetScore, digest: msg.digest ?? '',
                    });
                    setUiPhase('game_over');
                    break;

                case 'OPPONENT_RECONNECTED':
                    setDisconnMsg('');
                    if (ballStartRef.current > 0) { startTimer(ballStartRef.current); setUiPhase('live'); }
                    else setUiPhase('idle');
                    break;

                case 'RECONNECTED':
    resetBall();
    setInnings(msg.innings);
    setTargetScore(msg.targetScore);
    setBatter(msg.currentBatter);
    setP1Score(msg.p1Score);
    setP2Score(msg.p2Score);
    if (msg.status === 'playing') {
        setUiPhase('live');
    } else if (msg.status === 'finished') {
    } else {
        setUiPhase('idle');
    }
    break;

                case 'ERROR':
                    stopTimer();
                    setErrorMsg(msg.message ?? 'Unexpected server error.');
                    setUiPhase('error');
                    break;

                default: break;
            }
        };

        ws.onerror = () => {
            if (!mounted.current) return;
            setErrorMsg('WebSocket connection failed. Please check your network.');
            setUiPhase('error');
        };
    }, []);

    // ── Interactions ────────────────────────────────────────────────────────
    const handleNumberClick = (n: number) => {
        if (uiPhase !== 'live' || hasSubmitted) return;
        setHasSubmitted(true);
        send({ type: 'SUBMIT_MOVE', gameId, number: n });
        setMyMove(n);
        setUiPhase('submitted');
    };

    const handleForfeit = async () => {
        try {
            await fetch(`${BACKEND_URL}/api/pvp/forfeit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameId, forfeitingPlayer: account?.address ?? '' }),
            });
        } catch (e) {
            console.error('Forfeit API call failed:', e);
        } finally {
            wsRef.current?.close();
            onBack();
        }
    };

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <>
            <style>{`
                @keyframes fadeUp {
                    from { opacity: 0; transform: translateY(16px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes shimmerBar {
                    0%, 100% { opacity: 0.4; }
                    50%      { opacity: 1; }
                }
                @keyframes bounceBall {
                    0%, 100% { transform: translateY(0); }
                    50%      { transform: translateY(-10px); }
                }
            `}</style>

            {/* Connecting */}
            {uiPhase === 'connecting' && (
                <div className={OVERLAY}>
                    <div className={OVERLAY_CARD}>
                        <div className={SHIMMER} />
                        <span className="text-4xl [animation:bounceBall_1.2s_ease-in-out_infinite]">🏏</span>
                        <p className="text-sm text-[#00ff8870] tracking-widest [font-family:Orbitron,monospace] animate-pulse">
                            Connecting to match{dots}
                        </p>
                    </div>
                </div>
            )}

            {/* Error */}
            {uiPhase === 'error' && (
                <div className={OVERLAY}>
                    <div className={OVERLAY_CARD}>
                        <div className={SHIMMER} />
                        <span className="text-4xl">⚠️</span>
                        <h2 className="text-lg font-black text-[#ff4444] [font-family:Orbitron,monospace]">
                            Connection Error
                        </h2>
                        <p className="text-xs text-white/60 [font-family:'Exo_2',sans-serif] leading-relaxed">
                            {errorMsg}
                        </p>
                        <button className={BACK_BTN} onClick={onBack}>← Back to Lobby</button>
                    </div>
                </div>
            )}

            {/* Innings break */}
            {uiPhase === 'innings_break' && newInningsData && (
                <div className={OVERLAY}>
                    <div className={OVERLAY_CARD}>
                        <div className={SHIMMER} />
                        <span className="text-4xl">🏟️</span>
                        <h2 className="text-xl font-black text-[#00ff88] [font-family:Orbitron,monospace] [text-shadow:0_0_20px_#00ff8860]">
                            Innings Break
                        </h2>
                        <div className="w-full bg-[#00ff8806] border border-[#00ff8818] rounded-xl px-4 py-3 space-y-2">
                            {[{ label: myLabel, score: myScore }, { label: oppLabel, score: oppScore }].map(({ label, score }) => (
                                <div key={label} className="flex items-center justify-between">
                                    <span className="text-xs text-white/60 [font-family:'Exo_2',sans-serif]">{label}</span>
                                    <span className="text-lg font-black text-[#00ff88] [font-family:Orbitron,monospace]">{score}</span>
                                </div>
                            ))}
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <span className="text-[9px] tracking-[0.2em] uppercase text-[#00ff8860] [font-family:Orbitron,monospace]">Target</span>
                            <span className="text-3xl font-black text-[#00ff88] [font-family:Orbitron,monospace] [text-shadow:0_0_20px_#00ff8860]">
                                {newInningsData.target}
                            </span>
                        </div>
                        <p className="text-xs text-white/60 [font-family:'Exo_2',sans-serif] animate-pulse">
                            <strong className="text-white/80">
                                {newInningsData.newBatter === mySlot ? 'You' : oppLabel}
                            </strong>{' '}
                            {newInningsData.newBatter === mySlot ? 'are' : 'is'} chasing{dots}
                        </p>
                    </div>
                </div>
            )}

            {/* Disconnected */}
            {uiPhase === 'disconnected' && (
                <div className={OVERLAY}>
                    <div className={OVERLAY_CARD}>
                        <div className={SHIMMER} />
                        <span className="text-4xl">📡</span>
                        <h2 className="text-lg font-black text-[#00ff88] [font-family:Orbitron,monospace]">
                            Opponent Disconnected
                        </h2>
                        <p className="text-xs text-white/60 [font-family:'Exo_2',sans-serif] leading-relaxed">{disconnMsg}</p>
                        <p className="text-[10px] text-white/30 [font-family:'Exo_2',sans-serif]">
                            If they don't reconnect in 30s, you win the pot.
                        </p>
                    </div>
                </div>
            )}

            {/* Game over */}
            {uiPhase === 'game_over' && gameOverData && (() => {
                const iWon       = gameOverData.winner === myAddr;
                const wasForfeit = forfeitData !== null;
                return (
                    <div className={OVERLAY}>
                        <div className={`${OVERLAY_CARD} max-w-md`}>
                            <div className={SHIMMER} />

                            {/* Banner */}
                            <div className={`w-full py-3 rounded-xl flex items-center justify-center gap-3 ${
                                iWon
                                    ? 'bg-[#00ff8812] border border-[#00ff8840]'
                                    : 'bg-[#ff444410] border border-[#ff444430]'
                            }`}>
                                <span className="text-3xl">{iWon ? '🏆' : '💔'}</span>
                                <span className={`text-xl font-black [font-family:Orbitron,monospace] ${
                                    iWon
                                        ? 'text-[#00ff88] [text-shadow:0_0_20px_#00ff8860]'
                                        : 'text-[#ff4444]'
                                }`}>
                                    {iWon ? 'Victory!' : 'Defeated'}
                                </span>
                            </div>

                            {wasForfeit && (
                                <p className="text-xs text-white/50 [font-family:'Exo_2',sans-serif]">
                                    {iWon
                                        ? '🎉 Opponent forfeited — pot transferred to you!'
                                        : '😞 You forfeited the match.'}
                                </p>
                            )}

                            {/* Scorecard */}
                            <div className="w-full bg-[#00ff8806] border border-[#00ff8818] rounded-xl px-4 py-3 space-y-2">
                                {[
                                    { label: myLabel,  addr: myAddr,  score: myScore  },
                                    { label: oppLabel, addr: oppAddr, score: oppScore },
                                ].map(({ label, addr, score }, i) => (
                                    <div key={i}>
                                        {i === 1 && <div className="h-px bg-[#00ff8815] my-2" />}
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-xs font-bold text-white/70 [font-family:'Exo_2',sans-serif]">{label}</p>
                                                <p className="text-[9px] font-mono text-white/30">{shortenAddr(addr)}</p>
                                            </div>
                                            <span className="text-2xl font-black text-[#00ff88] [font-family:Orbitron,monospace]">{score}</span>
                                        </div>
                                    </div>
                                ))}
                                {gameOverData.targetScore > 0 && (
                                    <p className="text-[9px] text-white/30 text-center pt-1 [font-family:Orbitron,monospace]">
                                        Target was {gameOverData.targetScore}
                                    </p>
                                )}
                            </div>

                            {/* Payout */}
                            <div className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-center [font-family:'Exo_2',sans-serif] ${
                                iWon
                                    ? 'bg-[#00ff8812] text-[#00ff88] border border-[#00ff8830]'
                                    : 'bg-[#0a2212] text-white/40 border border-[#00ff8815]'
                            }`}>
                                {iWon
                                    ? '💰 0.2 OCT transferred to your wallet!'
                                    : '0.2 OCT transferred to opponent.'}
                            </div>

                            {gameOverData.digest && (
                                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#00ff8808] border border-[#00ff8815]">
                                    <span className="text-[9px] tracking-[0.2em] uppercase text-[#00ff8850] [font-family:Orbitron,monospace]">TX</span>
                                    <span className="text-[10px] font-mono text-white/30">
                                        {gameOverData.digest.slice(0, 16)}…
                                    </span>
                                </div>
                            )}

                            <button className={BACK_BTN} onClick={() => onGameOver(gameOverData)}>
                                Back to Home
                            </button>
                        </div>
                    </div>
                );
            })()}

            
            <div className="w-full max-w-sm mx-auto px-4 pt-4 pb-8 flex flex-col gap-3 overflow-y-auto">

                {/* ── Top bar ───────────────────────────────────────────────── */}
                <div className="flex items-center justify-between">
                    <button
                        onClick={handleForfeit}
                        className="px-4 py-1.5 rounded-xl text-[10px] font-bold tracking-wide
                            [font-family:'Exo_2',sans-serif] bg-transparent text-[#ff4444]
                            border border-[#ff444430] hover:bg-[#ff444412] hover:border-[#ff444460]
                            transition-all duration-200 active:scale-95"
                    >
                        Forfeit
                    </button>

                    <div className="flex items-center gap-2">
                        <span className="text-[9px] tracking-[0.2em] uppercase text-[#00ff8860] [font-family:Orbitron,monospace]">
                            Innings
                        </span>
                        <span className="text-sm font-black text-[#00ff88] [font-family:Orbitron,monospace]">
                            {innings}
                        </span>
                        {innings === 2 && targetScore > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold
                                bg-[#00ff8812] border border-[#00ff8830] text-[#00ff88]
                                [font-family:Orbitron,monospace]">
                                Target: {targetScore}
                            </span>
                        )}
                    </div>

                    <span className="text-[9px] font-mono text-white/20">{gameId.slice(0, 8)}…</span>
                </div>

                {/* ── Scoreboard ────────────────────────────────────────────── */}
                <div className="flex items-center justify-between gap-2">
                    <ScorePill label={myLabel}  score={myScore}  isBatting={iAmBatting}  isMine />
                    <div className="flex flex-col items-center gap-0.5">
                        <div className="h-px w-8 bg-[#00ff8820]" />
                        <span className="text-[9px] text-white/20 [font-family:Orbitron,monospace]">vs</span>
                        <div className="h-px w-8 bg-[#00ff8820]" />
                    </div>
                    <ScorePill label={oppLabel} score={oppScore} isBatting={!iAmBatting} isMine={false} />
                </div>

                {/* ── Chance pips ───────────────────────────────────────────── */}
                <div className="flex items-center justify-between px-1">
                    <div className="flex flex-col items-start gap-1">
                        <span className="text-[9px] text-white/30 [font-family:'Exo_2',sans-serif]">{myLabel}</span>
                        <ChancePips left={myChances} />
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        <span className="text-[9px] text-white/30 [font-family:'Exo_2',sans-serif]">{oppLabel}</span>
                        <ChancePips left={oppChances} />
                    </div>
                </div>

                {/* ── Arena ─────────────────────────────────────────────────── */}
                <div className="relative bg-[#071a0c] border border-[#00ff8818] rounded-2xl px-4 py-5
                    flex flex-col items-center gap-4">

                    {/* Top shimmer line */}
                    <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl
                        bg-gradient-to-r from-transparent via-[#00ff88] to-transparent opacity-30" />

                    {/* Timer */}
                    <BallTimer
                        secondsLeft={secondsLeft}
                        active={isLive || uiPhase === 'submitted'}
                    />

                    {/* Hands */}
                    <div className="flex items-center justify-center gap-6 w-full">

                        {/* My hand */}
                        <div className={`flex flex-col items-center gap-2 transition-opacity duration-300 ${
                            showResult && isMyOut ? 'opacity-50' : 'opacity-100'
                        }`}>
                            <p className="text-[9px] tracking-[0.2em] uppercase text-[#00ff8870]
                                font-semibold [font-family:Orbitron,monospace]">
                                You
                            </p>
                            <div className={`w-28 h-28 bg-[#0a2212] rounded-2xl border
                                flex items-center justify-center overflow-hidden
                                transition-all duration-300 ${
                                showResult && isMyOut
                                    ? 'border-[#ff444460] shadow-[0_0_20px_#ff44441a]'
                                    : 'border-[#00ff8840] shadow-[0_0_20px_#00ff8815]'
                                }`}>
                                
                                <HandAnimation
                                    number={displayMyMove}
                                    isAnimating={myHandAnimating}
                                />
                            </div>
                            {/* "Locked" badge — visible only while waiting for opponent */}
                            {uiPhase === 'submitted' && !isRevealing && (
                                <span className="text-[9px] font-bold text-[#00ff88]
                                    [font-family:Orbitron,monospace] animate-pulse">
                                    ✓ Locked
                                </span>
                            )}
                        </div>

                        {/* VS / result badge */}
                        <div className="w-10 h-10 rounded-full flex items-center justify-center border
                            transition-all duration-300 bg-[#00ff8815] border-[#00ff8860]
                            shadow-[0_0_14px_#00ff8830]">
                            {showResult ? (
                                matchedOut ? (
                                    <span className="text-[#ff4444] text-[9px] font-black [font-family:Orbitron,monospace]">
                                        OUT
                                    </span>
                                ) : (
                                    <span className="text-[#00ff88] text-base font-black">
                                        {lastBall!.p1Move === lastBall!.p2Move ? '=' : '≠'}
                                    </span>
                                )
                            ) : (
                                <span className="text-[#00ff88] text-[9px] font-black [font-family:Orbitron,monospace]">
                                    VS
                                </span>
                            )}
                        </div>

                        {/* Opponent hand */}
                        <div className={`flex flex-col items-center gap-2 transition-opacity duration-300 ${
                            showResult && isOppOut ? 'opacity-50' : 'opacity-100'
                        }`}>
                            <p className="text-[9px] tracking-[0.2em] uppercase text-[#00ff8870]
                                font-semibold [font-family:Orbitron,monospace]">
                                {oppLabel.replace('Player ', 'P')}
                            </p>
                            <div className={`w-28 h-28 bg-[#0a2212] rounded-2xl border
                                flex items-center justify-center overflow-hidden
                                transition-all duration-300 ${
                                showResult && isOppOut
                                    ? 'border-[#ff444460] shadow-[0_0_20px_#ff44441a]'
                                    : 'border-[#00ff8840] shadow-[0_0_20px_#00ff8815]'
                                }`}>
                                <HandAnimation
                                    number={displayOppMove}
                                    isAnimating={oppHandAnimating}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Ball result banner — shows AFTER reveal */}
                    {showResult && (
                        <div className={`px-5 py-2 rounded-full text-xs font-bold tracking-wide
                            [font-family:Orbitron,monospace] animate-[fadeUp_0.3s_ease-out] ${
                            lastBall!.isOut
                                ? 'bg-[#ff444415] border border-[#ff444440] text-[#ff4444] [text-shadow:0_0_12px_#ff444480]'
                                : 'bg-[#00ff8812] border border-[#00ff8830] text-[#00ff88]'
                            }`}>
                            {lastBall!.isOut
                                ? (lastBall!.p1ForceOut || lastBall!.p2ForceOut ? '⏱️ Force Out!' : '🏏 OUT!')
                                : `+${iAmBatting ? displayMyMove : displayOppMove} runs${
                                    (lastBall!.p1Timeout || lastBall!.p2Timeout) ? ' (timeout)' : ''
                                  }`
                            }
                        </div>
                    )}
                </div>

                {/* ── Number picker ─────────────────────────────────────────── */}
                <div className="flex flex-col gap-2">
                    <p className="text-center text-[10px] tracking-widest uppercase
                        text-[#00ff8860] [font-family:Orbitron,monospace] min-h-[16px]">
                        {isLive && !hasSubmitted
                            ? (iAmBatting ? '🏏 Bat your number' : '🎳 Bowl your number')
                            : ''}
                        {uiPhase === 'submitted' && !isRevealing
                            ? '✓ Move locked — waiting for opponent…'
                            : ''}
                        {isRevealing ? 'Revealing…' : ''}
                        {uiPhase === 'result' && !isRevealing ? 'Next ball coming up…' : ''}
                        {uiPhase === 'idle' ? `Preparing${dots}` : ''}
                    </p>

                    <div className="grid grid-cols-6 gap-2">
                        {[1, 2, 3, 4, 5, 6].map(n => {
                            const canClick = uiPhase === 'live' && !hasSubmitted;
                            const selected = displayMyMove === n && uiPhase === 'result' && !isRevealing;
                            return (
                                <button
                                    key={n}
                                    className={numBtnClass(selected, canClick)}
                                    onClick={() => handleNumberClick(n)}
                                    disabled={!canClick}
                                    aria-label={`Play ${n}`}
                                >
                                    <span className={`text-lg font-black [font-family:Orbitron,monospace] ${
                                        selected    ? 'text-[#00ff88]' :
                                        canClick    ? 'text-white/80'  : 'text-white/30'
                                    }`}>
                                        {n}
                                    </span>
                                    {/* Dot pips under each number */}
                                    <div className="flex gap-0.5 mt-1">
                                        {Array.from({ length: n }, (_, i) => (
                                            <span key={i} className={`w-1 h-1 rounded-full ${
                                                selected ? 'bg-[#00ff88]' :
                                                canClick ? 'bg-white/30'  : 'bg-white/10'
                                            }`} />
                                        ))}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* ── Footer ────────────────────────────────────────────────── */}
                <div className="flex items-center justify-center gap-2 text-[9px] font-mono text-white/20 pt-1">
                    <span>You: {shortenAddr(myAddr)}</span>
                    <span>·</span>
                    <span>Opp: {shortenAddr(oppAddr)}</span>
                    <span>·</span>
                    <span>{gameId.slice(0, 10)}…</span>
                </div>
            </div>
        </>
    );
}