import { useState, useRef, useEffect } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import HandAnimation from '../HandAnimation';
import { createPvPWebSocket, PvPWebSocket } from '../../utils/pvpWebSocket';
import { WS_URL } from '../../utils/constants';

import img1 from '../../assets/images/one.png';
import img2 from '../../assets/images/two.png';
import img3 from '../../assets/images/three.png';
import img4 from '../../assets/images/four.png';
import img5 from '../../assets/images/five.png';
import img6 from '../../assets/images/six.png';

export interface PvPTossProps {
    gameId:      string;
    isPlayer1:   boolean;
    onGameStart: (params: { currentBatter: 'p1' | 'p2'; p1Address: string; p2Address: string }) => void;
    onBack:      () => void;
}

type OddEven = 'odd' | 'even';
type Phase =
    | 'connecting'
    | 'picking'
    | 'submitted'
    | 'revealing'
    | 'bat_or_bowl'
    | 'waiting_choice'
    | 'starting'
    | 'error';

interface TossResult {
    p1Toss:            number;
    p2Toss:            number;
    total:             number;
    isOdd:             boolean;
    p1WonToss:         boolean;
    tossWinnerAddress: string;
}

const numberImages = [img1, img2, img3, img4, img5, img6];

// ─── Card shells ──────────────────────────────────────────────────────────────

/** Narrow centred card — connecting / error / starting / submitted / bat_or_bowl / waiting */
const NARROW_CARD =
    'relative w-full max-w-sm ' +
    'bg-[#071a0c] rounded-3xl overflow-hidden ' +
    'border border-[#00ff8822] ' +
    'shadow-[0_0_0_1px_#00ff8810,0_24px_80px_rgba(0,0,0,0.85),0_0_80px_#00ff8808_inset] ' +
    'flex flex-col items-center justify-center text-center px-6 py-8 gap-4 ' +
    'animate-[fadeUp_0.4s_cubic-bezier(0.16,1,0.3,1)_both]'

/** Wide card — picking / revealing */
const WIDE_CARD =
    'relative w-full max-w-sm ' +
    'bg-[#071a0c] rounded-3xl overflow-hidden ' +
    'border border-[#00ff8822] ' +
    'shadow-[0_0_0_1px_#00ff8810,0_24px_80px_rgba(0,0,0,0.85),0_0_80px_#00ff8808_inset] ' +
    'animate-[fadeUp_0.4s_cubic-bezier(0.16,1,0.3,1)_both]'

// ─── Reusable styles ──────────────────────────────────────────────────────────

const SHIMMER =
    'absolute top-0 left-0 right-0 h-[2px] animate-pulse ' +
    'bg-gradient-to-r from-transparent via-[#00ff88] to-transparent'

const SECTION_LABEL =
    'text-[10px] tracking-[0.25em] text-[#00ff8870] uppercase font-semibold [font-family:Orbitron,monospace]'

const STEP_BADGE =
    'w-5 h-5 rounded-full bg-[#00ff8820] border border-[#00ff8860] flex items-center justify-center ' +
    'text-[#00ff88] text-[9px] font-black [font-family:Orbitron,monospace]'

const ODD_BTN = (active: boolean) =>
    'flex-1 py-3 rounded-xl font-black text-xs tracking-widest uppercase [font-family:Orbitron,monospace] ' +
    'transition-all duration-200 active:scale-95 ' +
    (active
        ? 'bg-[#00ff88] text-[#030f06] shadow-[0_0_20px_#00ff8860]'
        : 'bg-[#00ff8812] text-[#00ff88] border border-[#00ff8840] hover:bg-[#00ff8820]')

const EVEN_BTN = (active: boolean) =>
    'flex-1 py-3 rounded-xl font-black text-xs tracking-widest uppercase [font-family:Orbitron,monospace] ' +
    'transition-all duration-200 active:scale-95 ' +
    (active
        ? 'bg-gradient-to-r from-[#7c3aed] to-[#4f46e5] text-white shadow-[0_0_20px_#7c3aed60]'
        : 'bg-[#7c3aed15] text-[#a78bfa] border border-[#7c3aed40] hover:bg-[#7c3aed25]')

const NUM_BTN = (active: boolean) =>
    'relative bg-[#0a2212] border rounded-xl p-2 flex items-center justify-center overflow-hidden ' +
    'transition-all duration-200 active:scale-95 cursor-pointer ' +
    (active
        ? 'border-[#00ff88] shadow-[0_0_14px_#00ff8840] scale-[1.04]'
        : 'border-[#00ff8822] hover:border-[#00ff8860] hover:-translate-y-0.5 hover:shadow-[0_4px_12px_#00000060]')

const SUBMIT_BTN = (ready: boolean) =>
    'w-full py-3.5 rounded-xl font-black text-xs tracking-widest uppercase [font-family:Orbitron,monospace] ' +
    'transition-all duration-200 active:scale-95 ' +
    (ready
        ? 'bg-[#00ff88] text-[#030f06] shadow-[0_0_20px_#00ff8850] hover:shadow-[0_0_35px_#00ff8870] hover:-translate-y-0.5'
        : 'bg-[#0a2212] text-white/30 border border-[#00ff8815] cursor-not-allowed')

const BACK_BTN =
    'px-4 py-2 rounded-xl text-xs font-bold tracking-wide [font-family:"Exo_2",sans-serif] ' +
    'bg-transparent text-[#00ff88] border border-[#00ff8840] ' +
    'hover:bg-[#00ff8812] hover:border-[#00ff88] transition-all duration-200 active:scale-95'

const BAT_BTN =
    'flex-1 py-3.5 rounded-xl font-black text-xs tracking-widest uppercase [font-family:Orbitron,monospace] ' +
    'bg-[#00ff88] text-[#030f06] shadow-[0_0_20px_#00ff8850] ' +
    'hover:shadow-[0_0_35px_#00ff8870] hover:-translate-y-0.5 active:scale-95 ' +
    'transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0'

const BOWL_BTN =
    'flex-1 py-3.5 rounded-xl font-black text-xs tracking-widest uppercase [font-family:Orbitron,monospace] ' +
    'bg-transparent text-[#00ff88] border-2 border-[#00ff8860] ' +
    'hover:bg-[#00ff8812] hover:border-[#00ff88] hover:-translate-y-0.5 active:scale-95 ' +
    'transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0'

const SUMMARY_CHIP = (set: boolean) =>
    'px-3 py-1 rounded-full text-[10px] font-semibold tracking-wide border transition-all duration-200 ' +
    (set
        ? 'bg-[#00ff8815] border-[#00ff8840] text-[#00ff88]'
        : 'bg-[#0a2212] border-[#00ff8820] text-white/30')

const LOCKED_CHIP =
    'px-3 py-1 rounded-full text-[10px] font-semibold border bg-[#00ff8815] border-[#00ff8840] text-[#00ff88]'

export default function PvPToss({ gameId, isPlayer1, onGameStart, onBack }: PvPTossProps) {
    const account = useCurrentAccount();

    const [phase, setPhase]             = useState<Phase>('connecting');
    const [oddEven, setOddEven]         = useState<OddEven | null>(null);
    const [myNumber, setMyNumber]       = useState<number | null>(null);
    const [errorMsg, setErrorMsg]       = useState('');
    const [tossResult, setTossResult]   = useState<TossResult | null>(null);
    const [iAmWinner, setIAmWinner]     = useState(false);
    const [revealStep, setRevealStep]   = useState(0);
    const [dotCount, setDotCount]       = useState(1);
    const [batBowlSent, setBatBowlSent] = useState(false);

    const wsRef   = useRef<PvPWebSocket | null>(null);
    const mounted = useRef(true);

    useEffect(() => {
        if (!['connecting', 'submitted', 'waiting_choice', 'starting'].includes(phase)) return;
        const id = setInterval(() => setDotCount(d => (d % 3) + 1), 500);
        return () => clearInterval(id);
    }, [phase]);

    useEffect(() => {
        mounted.current = true;
        const ws = createPvPWebSocket({
            gameId,
            playerAddress: account?.address ?? '',
            isPlayer1,
            url: WS_URL,
            onStatusChange: (status) => {
                if (!mounted.current) return;
                if (status === 'connected' || status === 'reconnecting') return;
                if (status === 'failed') { setErrorMsg('Connection failed after multiple attempts.'); setPhase('error'); }
            },
            onConnected:     () => { if (mounted.current) setPhase('picking'); },
            onReconnected:   () => { if (mounted.current) setPhase('picking'); },
            onTossSubmitted: () => { if (mounted.current) setPhase('submitted'); },
            onTossResult: (msg) => {
                if (!mounted.current) return;
                const result: TossResult = {
                    p1Toss: msg.p1Toss, p2Toss: msg.p2Toss, total: msg.total,
                    isOdd: msg.isOdd, p1WonToss: msg.p1WonToss, tossWinnerAddress: msg.tossWinnerAddress,
                };
                setTossResult(result);
                const won = isPlayer1 ? msg.p1WonToss : !msg.p1WonToss;
                setIAmWinner(won);
                setPhase('revealing');
                setTimeout(() => setRevealStep(1), 300);
                setTimeout(() => setRevealStep(2), 900);
                setTimeout(() => setRevealStep(3), 1600);
                setTimeout(() => { if (mounted.current) setPhase(won ? 'bat_or_bowl' : 'waiting_choice'); }, 2800);
            },
            onGameStart: (msg) => {
                if (!mounted.current) return;
                setPhase('starting');
                setTimeout(() => {
                    if (mounted.current)
                        onGameStart({ currentBatter: msg.currentBatter, p1Address: msg.p1Address, p2Address: msg.p2Address });
                }, 1500);
            },
            onError: (msg) => {
                if (!mounted.current) return;
                setErrorMsg(msg.message ?? 'Server error. Please go back and try again.');
                setPhase('error');
            },
        });
        wsRef.current = ws;
        return () => { mounted.current = false; ws.destroy(); wsRef.current = null; };
    }, [gameId, isPlayer1, account?.address, onGameStart]);

    const canSubmit = myNumber !== null && (isPlayer1 ? oddEven !== null : true);

    function handleSubmit() {
        if (!canSubmit || phase !== 'picking') return;
        wsRef.current?.submitToss(myNumber!, isPlayer1 ? oddEven === 'odd' : undefined);
        setPhase('submitted');
    }

    function handleBatBowl(chooseBat: boolean) {
        if (batBowlSent) return;
        setBatBowlSent(true);
        wsRef.current?.chooseBatOrBowl(chooseBat);
        setPhase('waiting_choice');
    }

    const dots     = '.'.repeat(dotCount);
    const myLabel  = isPlayer1 ? 'Player 1' : 'Player 2';
    const oppLabel = isPlayer1 ? 'Player 2' : 'Player 1';

    return (
        <>
            <style>{`
                @keyframes fadeUp    { from { opacity:0; transform:translateY(22px); } to { opacity:1; transform:translateY(0); } }
                @keyframes shimmerBar { 0%,100% { opacity:0.4; } 50% { opacity:1; } }
                @keyframes bounceBall { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-10px); } }
            `}</style>

            {/* ── Full-viewport shell ── */}
            <div className="h-screen w-full flex items-center justify-center px-4
                bg-[#030f06] relative overflow-hidden">

                {/* Background radial glow */}
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_100%,#0d3318_0%,transparent_70%)] pointer-events-none" />

                {/* Grid texture */}
                <div
                    className="absolute inset-0 opacity-[0.04] pointer-events-none"
                    style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2300ff88' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                    }}
                />

                {/* Ambient ping dots */}
                <div className="absolute top-12 left-8 w-3 h-3 rounded-full bg-[#00ff88] opacity-20 animate-ping" style={{ animationDuration: '3.2s' }} />
                <div className="absolute top-1/3 right-6 w-2 h-2 rounded-full bg-[#7c3aed] opacity-15 animate-ping" style={{ animationDuration: '4.8s', animationDelay: '1s' }} />
                <div className="absolute bottom-24 left-10 w-2 h-2 rounded-full bg-[#00ff88] opacity-15 animate-ping" style={{ animationDuration: '3.6s', animationDelay: '0.5s' }} />

                {/* ── Inner scroll container (for picking phase) ── */}
                <div className="relative z-10 w-full flex items-center justify-center
                    overflow-y-auto max-h-screen py-6">

                    {/* ── CONNECTING ──────────────────────────────── */}
                    {phase === 'connecting' && (
                        <div className={NARROW_CARD}>
                            <div className={SHIMMER} />
                            <span className="text-4xl" style={{ animation: 'bounceBall 1.2s ease-in-out infinite' }}>🏏</span>
                            <p className="text-sm text-[#00ff8870] tracking-widest [font-family:Orbitron,monospace] animate-pulse">
                                Connecting{dots}
                            </p>
                        </div>
                    )}

                    {/* ── ERROR ───────────────────────────────────── */}
                    {phase === 'error' && (
                        <div className={NARROW_CARD}>
                            <div className={SHIMMER} />
                            <span className="text-4xl">⚠️</span>
                            <h2 className="text-lg font-black text-[#ff4444] [font-family:Orbitron,monospace]">
                                Connection Error
                            </h2>
                            <p className="text-xs text-white/60 [font-family:'Exo_2',sans-serif] leading-relaxed">
                                {errorMsg}
                            </p>
                            <button className={BACK_BTN} onClick={onBack}>← Go Back</button>
                        </div>
                    )}

                    {/* ── STARTING ────────────────────────────────── */}
                    {phase === 'starting' && (
                        <div className={NARROW_CARD}>
                            <div className={SHIMMER} />
                            <span className="text-4xl" style={{ animation: 'bounceBall 0.8s ease-in-out infinite' }}>🏏</span>
                            <h2 className="text-xl font-black text-[#00ff88] [font-family:Orbitron,monospace]"
                                style={{ textShadow: '0 0 20px #00ff8860' }}>
                                Game Starting!
                            </h2>
                            <p className="text-xs text-[#00ff8870] tracking-widest [font-family:Orbitron,monospace] animate-pulse">
                                Heading to the pitch{dots}
                            </p>
                        </div>
                    )}

                    {/* ── PICKING ─────────────────────────────────── */}
                    {phase === 'picking' && (
                        <div className={WIDE_CARD}>
                            <div className={SHIMMER} />
                            <div className="px-5 py-5 space-y-4">

                                {/* Header row */}
                                <div className="flex items-center justify-between gap-2">
                                    <button className={BACK_BTN} onClick={onBack}>← Back</button>
                                    <span className="text-sm font-black text-[#00ff88] [font-family:Orbitron,monospace]">
                                        🎲 The Toss
                                    </span>
                                    <span className="px-3 py-1 rounded-full text-[10px] font-bold tracking-wide
                                        border border-[#00ff8840] text-[#00ff8880] bg-[#00ff8808] [font-family:Orbitron,monospace]">
                                        {myLabel}
                                    </span>
                                </div>

                                {/* Divider */}
                                <div className="h-px bg-gradient-to-r from-transparent via-[#00ff8830] to-transparent" />

                                {/* Room chip */}
                                <div className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-full
                                    bg-[#00ff8808] border border-[#00ff8818] w-fit mx-auto">
                                    <span className="text-[9px] tracking-[0.2em] uppercase text-[#00ff8860] [font-family:Orbitron,monospace]">Room</span>
                                    <span className="text-[10px] font-mono text-white/50">
                                        {gameId.slice(0, 10)}…{gameId.slice(-6)}
                                    </span>
                                </div>

                                {/* P1: Odd / Even */}
                                {isPlayer1 && (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <div className={STEP_BADGE}>1</div>
                                            <span className={SECTION_LABEL}>Your Call — Odd or Even?</span>
                                        </div>
                                        <div className="flex gap-3">
                                            <button className={ODD_BTN(oddEven === 'odd')}  onClick={() => setOddEven('odd')}>ODD</button>
                                            <button className={EVEN_BTN(oddEven === 'even')} onClick={() => setOddEven('even')}>EVEN</button>
                                        </div>
                                    </div>
                                )}

                                {/* P2 hint */}
                                {!isPlayer1 && (
                                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl
                                        bg-[#00ff8808] border border-[#00ff8818]">
                                        <span className="text-xl">🎲</span>
                                        <p className="text-xs text-white/60 [font-family:'Exo_2',sans-serif] leading-relaxed">
                                            Pick your secret number.<br />Player 1 has called Odd or Even.
                                        </p>
                                    </div>
                                )}

                                {/* Number grid */}
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <div className={STEP_BADGE}>{isPlayer1 ? '2' : '1'}</div>
                                        <span className={SECTION_LABEL}>Pick Your Secret Number</span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 max-w-[220px] mx-auto">
                                        {[1, 2, 3, 4, 5, 6].map(n => (
                                            <button key={n} className={NUM_BTN(myNumber === n)} onClick={() => setMyNumber(n)}>
                                                <img src={numberImages[n - 1]} alt={n.toString()} className="w-10 h-10 object-contain" />
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Summary chips */}
                                <div className="flex items-center justify-center gap-2 flex-wrap">
                                    {isPlayer1 ? (
                                        <>
                                            <span className={SUMMARY_CHIP(!!oddEven)}>
                                                {oddEven ? `Called: ${oddEven.toUpperCase()}` : 'No call yet'}
                                            </span>
                                            <span className={SUMMARY_CHIP(!!myNumber)}>
                                                {myNumber ? `Number: ${myNumber}` : 'No number'}
                                            </span>
                                        </>
                                    ) : (
                                        <span className={SUMMARY_CHIP(!!myNumber)}>
                                            {myNumber ? `Number: ${myNumber}` : 'No number selected'}
                                        </span>
                                    )}
                                </div>

                                {/* Submit */}
                                <button className={SUBMIT_BTN(canSubmit)} onClick={handleSubmit} disabled={!canSubmit}>
                                    {canSubmit ? '🤝 Lock In & Submit' : 'Select to continue…'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── SUBMITTED ───────────────────────────────── */}
                    {phase === 'submitted' && (
                        <div className={NARROW_CARD}>
                            <div className={SHIMMER} />
                            <span className="text-4xl" style={{ animation: 'bounceBall 1.2s ease-in-out infinite' }}>🏏</span>
                            <h2 className="text-lg font-black text-[#00ff88] [font-family:Orbitron,monospace]"
                                style={{ textShadow: '0 0 16px #00ff8860' }}>
                                Move Locked In!
                            </h2>
                            <div className="flex gap-2 flex-wrap justify-center">
                                {isPlayer1 && oddEven && (
                                    <span className={LOCKED_CHIP}>Called: <strong>{oddEven.toUpperCase()}</strong></span>
                                )}
                                {myNumber && (
                                    <span className={LOCKED_CHIP}>Number: <strong>{myNumber}</strong></span>
                                )}
                            </div>
                            <p className="text-xs text-[#00ff8870] tracking-widest [font-family:Orbitron,monospace] animate-pulse">
                                Waiting for {oppLabel}{dots}
                            </p>
                            {/* VS strip */}
                            <div className="flex items-center gap-3 w-full px-2">
                                <span className="flex-1 text-right text-xs font-bold text-[#00ff88] [font-family:'Exo_2',sans-serif]">
                                    {myLabel} ✓
                                </span>
                                <span className="text-white/20 text-xs">vs</span>
                                <span className="flex-1 text-xs font-bold text-white/40 [font-family:'Exo_2',sans-serif]">
                                    {oppLabel} ⏳
                                </span>
                            </div>
                        </div>
                    )}

                    {/* ── REVEALING ───────────────────────────────── */}
                    {phase === 'revealing' && tossResult && (() => {
                        const myToss  = isPlayer1 ? tossResult.p1Toss : tossResult.p2Toss;
                        const oppToss = isPlayer1 ? tossResult.p2Toss : tossResult.p1Toss;
                        return (
                            <div className={WIDE_CARD}>
                                <div className={SHIMMER} />
                                <div className="px-5 py-6 flex flex-col items-center gap-4">
                                    <h2 className="text-xl font-black text-[#00ff88] [font-family:Orbitron,monospace]"
                                        style={{ textShadow: '0 0 20px #00ff8860' }}>
                                        Toss Reveal
                                    </h2>

                                    {/* Hands */}
                                    <div className="flex items-center justify-center gap-5 w-full">
                                        <div className="flex flex-col items-center gap-2">
                                            <p className={SECTION_LABEL}>{myLabel}</p>
                                            <div className="w-24 h-24 bg-[#0a2212] rounded-xl border border-[#00ff8840]
                                                flex items-center justify-center overflow-hidden shadow-[0_0_20px_#00ff8815]">
                                                <HandAnimation number={revealStep >= 1 ? myToss : null} isAnimating={revealStep < 2} />
                                            </div>
                                        </div>
                                        <div className="w-8 h-8 rounded-full bg-[#00ff8815] border border-[#00ff8860]
                                            flex items-center justify-center shadow-[0_0_14px_#00ff8830]">
                                            <span className="text-[#00ff88] text-[9px] font-black [font-family:Orbitron,monospace]">VS</span>
                                        </div>
                                        <div className="flex flex-col items-center gap-2">
                                            <p className={SECTION_LABEL}>{oppLabel}</p>
                                            <div className="w-24 h-24 bg-[#0a2212] rounded-xl border border-[#00ff8840]
                                                flex items-center justify-center overflow-hidden shadow-[0_0_20px_#00ff8815]">
                                                <HandAnimation number={revealStep >= 1 ? oppToss : null} isAnimating={revealStep < 2} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Calculation */}
                                    {revealStep >= 2 && (
                                        <div className="w-full bg-[#00ff8806] border border-[#00ff8818] rounded-xl px-5 py-4
                                            animate-[fadeUp_0.4s_ease-out]">
                                            <div className="flex items-center justify-center gap-2 mb-2">
                                                {[myToss, '+', oppToss, '='].map((v, i) => (
                                                    <span key={i} className="text-xl font-black text-white/80 [font-family:Orbitron,monospace]">{v}</span>
                                                ))}
                                                <span className="text-xl font-black text-[#00ff88] [font-family:Orbitron,monospace]
                                                    bg-[#00ff8815] px-2.5 py-0.5 rounded-lg"
                                                    style={{ textShadow: '0 0 16px #00ff8860' }}>
                                                    {tossResult.total}
                                                </span>
                                            </div>
                                            <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#00ff8880] [font-family:Orbitron,monospace]">
                                                It's {tossResult.isOdd ? '🔴 ODD' : '🔵 EVEN'}
                                            </p>
                                        </div>
                                    )}

                                    {/* Winner */}
                                    {revealStep >= 3 && (
                                        <div className="flex items-center gap-2 animate-[fadeUp_0.4s_ease-out]">
                                            <span className="text-2xl">{iAmWinner ? '👑' : '🏏'}</span>
                                            <span className="text-sm font-bold text-white/80 [font-family:'Exo_2',sans-serif]">
                                                {iAmWinner ? 'You won the toss!' : `${oppLabel} won the toss!`}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })()}

                    {/* ── BAT OR BOWL ─────────────────────────────── */}
                    {phase === 'bat_or_bowl' && (
                        <div className={NARROW_CARD}>
                            <div className={SHIMMER} />
                            <span className="text-4xl" style={{ filter: 'drop-shadow(0 0 12px #00ff8860)' }}>👑</span>
                            <h2 className="text-xl font-black text-[#00ff88] [font-family:Orbitron,monospace]"
                                style={{ textShadow: '0 0 20px #00ff8860' }}>
                                Your Choice!
                            </h2>
                            <p className="text-xs text-white/40 [font-family:'Exo_2',sans-serif]">
                                You won the toss — bat or bowl?
                            </p>
                            <div className="flex gap-3 w-full">
                                <button className={BAT_BTN} onClick={() => handleBatBowl(true)} disabled={batBowlSent}>
                                    🏏 BAT
                                </button>
                                <button className={BOWL_BTN} onClick={() => handleBatBowl(false)} disabled={batBowlSent}>
                                    ⚾ BOWL
                                </button>
                            </div>
                            {tossResult && (
                                <p className="text-[10px] text-white/30 [font-family:Orbitron,monospace]">
                                    {tossResult.p1Toss} + {tossResult.p2Toss} = {tossResult.total}{' '}
                                    <span className={tossResult.isOdd ? 'text-[#ff6666]' : 'text-[#60a5fa]'}>
                                        ({tossResult.isOdd ? 'Odd' : 'Even'})
                                    </span>
                                </p>
                            )}
                        </div>
                    )}

                    {/* ── WAITING CHOICE ──────────────────────────── */}
                    {phase === 'waiting_choice' && (
                        <div className={NARROW_CARD}>
                            <div className={SHIMMER} />
                            <span className="text-4xl" style={{ animation: 'bounceBall 1.2s ease-in-out infinite' }}>🏏</span>
                            <h2 className="text-lg font-black text-[#00ff88] [font-family:Orbitron,monospace]">
                                {iAmWinner ? 'Sending choice…' : `${oppLabel} is choosing…`}
                            </h2>
                            {!iAmWinner && tossResult && (
                                <p className="text-[10px] text-white/30 [font-family:Orbitron,monospace]">
                                    Toss: {tossResult.p1Toss} + {tossResult.p2Toss} = {tossResult.total}{' '}
                                    <span className={tossResult.isOdd ? 'text-[#ff6666]' : 'text-[#60a5fa]'}>
                                        ({tossResult.isOdd ? 'Odd' : 'Even'})
                                    </span>
                                </p>
                            )}
                            <p className="text-xs text-[#00ff8870] tracking-widest [font-family:Orbitron,monospace] animate-pulse">
                                {iAmWinner ? 'Confirming on-chain…' : `Waiting for ${oppLabel}${dots}`}
                            </p>
                        </div>
                    )}

                </div>
            </div>
        </>
    );
}