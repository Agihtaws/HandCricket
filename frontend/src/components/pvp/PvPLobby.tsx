import { useState, useRef, useEffect, useCallback } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { createPvPGameTx, joinPvPGameTx } from '../../utils/transactions';
import { WS_URL } from '../../utils/constants';

export interface PvPLobbyProps {
    onGameStart: (params: { gameId: string; isPlayer1: boolean }) => void;
    onBack: () => void;
}

type Tab   = 'create' | 'join';
type Phase = 'idle' | 'signing' | 'waiting' | 'ready';

function shortenAddress(addr: string) {
    return addr.slice(0, 6) + '...' + addr.slice(-4);
}
function shortenGameId(id: string) {
    return id.slice(0, 10) + '...' + id.slice(-8);
}
async function copyToClipboard(text: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// ── Button styles (matching HomePage) ────────────────────────────────────────
const CREATE_BTN =
    'relative w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-2xl ' +
    'font-bold tracking-wider uppercase text-sm select-none ' +
    'bg-[#00ff88] text-[#030f06] ' +
    'shadow-[0_0_10px_#00ff8840] hover:shadow-[0_0_18px_#00ff8860] ' +
    'hover:-translate-y-0.5 active:scale-95 transition-all duration-200 ease-out ' +
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none'

const JOIN_BTN =
    'relative w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-2xl ' +
    'font-bold tracking-wider uppercase text-sm select-none ' +
    'bg-gradient-to-r from-[#7c3aed] to-[#4f46e5] text-white ' +
    'shadow-[0_0_10px_#7c3aed40] hover:shadow-[0_0_18px_#7c3aed60] ' +
    'hover:-translate-y-0.5 active:scale-95 transition-all duration-200 ease-out ' +
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none'

const CANCEL_BTN =
    'relative w-full flex items-center justify-center gap-2 px-5 py-3 rounded-2xl ' +
    'font-bold tracking-wider uppercase text-xs select-none ' +
    'border border-[#ffffff15] text-white/40 ' +
    'hover:border-[#ff444440] hover:text-[#ff4444] hover:bg-[#ff444408] ' +
    'active:scale-95 transition-all duration-200 ease-out'

export default function PvPLobby({ onGameStart, onBack }: PvPLobbyProps) {
    const account                    = useCurrentAccount();
    const client                     = useSuiClient();
    const { mutateAsync: signAndEx } = useSignAndExecuteTransaction({
        execute: async ({ bytes, signature }) =>
            client.executeTransactionBlock({
                transactionBlock: bytes,
                signature,
                options: { showObjectChanges: true },
            }),
    });

    const [tab, setTab]             = useState<Tab>('create');
    const [phase, setPhase]         = useState<Phase>('idle');
    const [roomCode, setRoomCode]   = useState('');
    const [joinInput, setJoinInput] = useState('');
    const [copied, setCopied]       = useState(false);
    const [errorMsg, setErrorMsg]   = useState('');
    const [statusMsg, setStatusMsg] = useState('');
    const [dotCount, setDotCount]   = useState(1);

    const wsRef    = useRef<WebSocket | null>(null);
    const phaseRef = useRef<Phase>('idle');

    const updatePhase = useCallback((p: Phase) => {
        phaseRef.current = p;
        setPhase(p);
    }, []);

    useEffect(() => {
        if (phase !== 'waiting') return;
        const id = setInterval(() => setDotCount(d => (d % 3) + 1), 500);
        return () => clearInterval(id);
    }, [phase]);

    useEffect(() => { return () => { wsRef.current?.close(); }; }, []);

    const connectWebSocket = useCallback((gameId: string, isPlayer1: boolean) => {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;
        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'JOIN_ROOM', gameId, playerAddress: account!.address, isPlayer1 }));
        };
        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                switch (msg.type) {
                    case 'ROOM_CREATED':
                        updatePhase('waiting');
                        setStatusMsg('Room created. Waiting for opponent');
                        break;
                    case 'PLAYER_JOINED':
                        updatePhase('ready');
                        ws.close();
                        onGameStart({ gameId, isPlayer1 });
                        break;
                    case 'ERROR':
                        setErrorMsg(msg.message || 'WebSocket error');
                        updatePhase('idle');
                        ws.close();
                        break;
                    case 'ROOM_CANCELLED':
                        setErrorMsg('Room was cancelled.');
                        updatePhase('idle');
                        ws.close();
                        break;
                }
            } catch { }
        };
        ws.onerror = () => { setErrorMsg('Could not connect to game server.'); updatePhase('idle'); };
        ws.onclose = (ev) => {
            if (ev.code !== 1000 && phaseRef.current !== 'ready' && phaseRef.current === 'waiting') {
                setErrorMsg('Connection lost. Please try again.');
                updatePhase('idle');
            }
        };
    }, [account, onGameStart, updatePhase]);

    const handleCreateRoom = async () => {
        if (!account) return;
        setErrorMsg('');
        updatePhase('signing');
        setStatusMsg('Sign the transaction to bet 0.1 OCT…');
        try {
            const tx     = createPvPGameTx();
            const result = await signAndEx(
                { transaction: tx },
                { onSuccess: () => setStatusMsg('Confirmed. Setting up room…'), onError: (err) => { throw err; } },
            );
            const created = result.objectChanges?.find(
                (c: { type: string }) => c.type === 'created' && (c as any).objectType?.includes('pvp_game::PvPGame'),
            );
            if (!created) throw new Error('Could not find PvPGame object in transaction output.');
            const gameId = (created as any).objectId as string;
            setRoomCode(gameId);
            connectWebSocket(gameId, true);
        } catch (err: any) {
            updatePhase('idle');
            const msg = err?.message ?? String(err);
            if (msg.includes('rejected') || msg.includes('cancelled') || msg.includes('denied')) {
                setErrorMsg('Transaction cancelled.');
            } else {
                setErrorMsg(`Failed: ${msg}`);
            }
        }
    };

    const handleJoinRoom = async () => {
        if (!account) return;
        const gameId = joinInput.trim();
        if (!gameId.startsWith('0x') || gameId.length < 10) {
            setErrorMsg('Enter a valid room code (starts with 0x).');
            return;
        }
        setErrorMsg('');
        updatePhase('signing');
        setStatusMsg('Sign the transaction to bet 0.1 OCT…');
        try {
            const tx = joinPvPGameTx(gameId);
            await signAndEx(
                { transaction: tx },
                { onSuccess: () => setStatusMsg('Confirmed. Joining room…'), onError: (err) => { throw err; } },
            );
            connectWebSocket(gameId, false);
            updatePhase('waiting');
            setStatusMsg('Joining room');
        } catch (err: any) {
            updatePhase('idle');
            const msg = err?.message ?? String(err);
            if (msg.includes('rejected') || msg.includes('cancelled') || msg.includes('denied')) {
                setErrorMsg('Transaction cancelled.');
            } else if (msg.includes('ENotWaiting')) {
                setErrorMsg('Room not found or already full.');
            } else if (msg.includes('ESamePlayer')) {
                setErrorMsg("You can't join your own room.");
            } else {
                setErrorMsg(`Failed: ${msg}`);
            }
        }
    };

    const handleCopyCode = async () => {
        const ok = await copyToClipboard(roomCode);
        if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
    };

    const handleBack = () => {
        wsRef.current?.close();
        updatePhase('idle');
        setRoomCode('');
        setJoinInput('');
        setErrorMsg('');
        onBack();
    };

    const handleReset = () => {
        wsRef.current?.close();
        updatePhase('idle');
        setRoomCode('');
        setJoinInput('');
        setErrorMsg('');
        setStatusMsg('');
    };

    const dots = '.'.repeat(dotCount);

    return (
        <>
            {/* ── Full-viewport shell — NO scroll ── */}
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

                {/* ── Card ── */}
                <div className="relative z-10 w-full max-w-sm
                    bg-[#071a0c] rounded-3xl overflow-hidden
                    border border-[#00ff8822]
                    shadow-[0_0_0_1px_#00ff8810,0_24px_80px_rgba(0,0,0,0.85),0_0_80px_#00ff8808_inset]
                    animate-[fadeUp_0.5s_cubic-bezier(0.16,1,0.3,1)_both]">

                    {/* Shimmer top bar */}
                    <div className="absolute top-0 left-0 right-0 h-[2px] animate-pulse
                        bg-gradient-to-r from-transparent via-[#00ff88] to-transparent" />

                    <div className="px-5 py-5 sm:px-7 sm:py-6 space-y-4">

                        {/* ── Header ── */}
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleBack}
                                disabled={phase === 'signing'}
                                className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center
                                    text-[#00ff8860] border border-[#00ff8820]
                                    hover:text-[#00ff88] hover:border-[#00ff8840] hover:bg-[#00ff8808]
                                    disabled:opacity-30 disabled:cursor-not-allowed
                                    transition-all duration-200 text-xs"
                            >
                                ←
                            </button>

                            <div className="flex-1 text-center">
                                <h1
                                    className="text-xl font-black text-[#00ff88] tracking-tight flex items-center justify-center gap-2"
                                    style={{ fontFamily: 'Orbitron, monospace', textShadow: '0 0 20px #00ff8860' }}
                                >
                                    🏏 PvP Mode
                                    <span className="text-[9px] tracking-[0.2em] font-bold px-1.5 py-0.5 rounded-full
                                        bg-[#00ff8815] border border-[#00ff8830] text-[#00ff88]">
                                        LIVE
                                    </span>
                                </h1>
                            </div>

                            {/* Wallet badge */}
                            {account && (
                                <div className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-xl
                                    bg-[#00ff8808] border border-[#00ff8820]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />
                                    <span className="text-[9px] font-mono text-[#00ff8870]">
                                        {shortenAddress(account.address)}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Divider */}
                        <div className="h-px bg-gradient-to-r from-transparent via-[#00ff8830] to-transparent" />

                        {/* ── Bet notice ── */}
                        <div className="flex items-center justify-center gap-2 py-2 px-3 rounded-2xl
                            bg-[#00ff8806] border border-[#00ff8815]">
                            <span className="text-sm">💰</span>
                            <p className="text-[11px] text-white/50 text-center">
                                Both stake <span className="text-[#00ff88] font-bold">0.1 OCT</span> — winner takes{' '}
                                <span className="text-[#00ff88] font-bold">0.2 OCT</span>
                            </p>
                        </div>

                        {/* ── IDLE: tab switcher + panels ── */}
                        {phase === 'idle' && (
                            <div className="space-y-3">
                                {/* Tab switcher */}
                                <div className="flex gap-2 p-1 rounded-2xl bg-[#00000030] border border-[#ffffff08]">
                                    <button
                                        onClick={() => { setTab('create'); setErrorMsg(''); }}
                                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold tracking-wide uppercase transition-all duration-200
                                            ${tab === 'create'
                                                ? 'bg-[#00ff88] text-[#030f06] shadow-[0_0_10px_#00ff8840]'
                                                : 'text-white/40 hover:text-white/60'}`}
                                        style={{ fontFamily: 'Exo 2, sans-serif' }}
                                    >
                                        🆕 Create
                                    </button>
                                    <button
                                        onClick={() => { setTab('join'); setErrorMsg(''); }}
                                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold tracking-wide uppercase transition-all duration-200
                                            ${tab === 'join'
                                                ? 'bg-gradient-to-r from-[#7c3aed] to-[#4f46e5] text-white shadow-[0_0_10px_#7c3aed40]'
                                                : 'text-white/40 hover:text-white/60'}`}
                                        style={{ fontFamily: 'Exo 2, sans-serif' }}
                                    >
                                        🔗 Join
                                    </button>
                                </div>

                                {/* Create panel */}
                                {tab === 'create' && (
                                    <div className="rounded-2xl bg-[#00ff8806] border border-[#00ff8818] px-4 py-3 space-y-3">
                                        <p
                                            className="text-[9px] tracking-[0.3em] text-[#00ff8880] uppercase font-semibold text-center"
                                            style={{ fontFamily: 'Orbitron, monospace' }}
                                        >
                                            Host a Match
                                        </p>
                                        <ul className="space-y-1.5">
                                            {[
                                                { n: '1', t: 'Sign transaction (0.1 OCT bet)' },
                                                { n: '2', t: 'Share room code with opponent' },
                                                { n: '3', t: 'Game starts when they join!' },
                                            ].map(({ n, t }) => (
                                                <li key={n} className="flex items-center gap-2 text-xs text-white/60">
                                                    <span className="shrink-0 w-4 h-4 rounded-full bg-[#00ff8820] border border-[#00ff8840]
                                                        flex items-center justify-center text-[9px] text-[#00ff88] font-bold">
                                                        {n}
                                                    </span>
                                                    {t}
                                                </li>
                                            ))}
                                        </ul>
                                        <button
                                            onClick={handleCreateRoom}
                                            disabled={!account}
                                            className={CREATE_BTN}
                                            style={{ fontFamily: 'Exo 2, sans-serif' }}
                                        >
                                            <span className="text-base shrink-0">🎯</span>
                                            <span className="flex-1 text-left">
                                                {!account ? 'Connect Wallet First' : 'Create Room'}
                                            </span>
                                            <span className="text-[#030f0660] font-semibold text-[11px]">0.1 OCT</span>
                                        </button>
                                    </div>
                                )}

                                {/* Join panel */}
                                {tab === 'join' && (
                                    <div className="rounded-2xl bg-[#7c3aed08] border border-[#7c3aed18] px-4 py-3 space-y-3">
                                        <p
                                            className="text-[9px] tracking-[0.3em] text-[#a78bfa] uppercase font-semibold text-center"
                                            style={{ fontFamily: 'Orbitron, monospace' }}
                                        >
                                            Join a Match
                                        </p>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-white/40 font-semibold tracking-wide uppercase">
                                                Room Code
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="0x1a2b3c4d..."
                                                value={joinInput}
                                                onChange={(e) => { setJoinInput(e.target.value); setErrorMsg(''); }}
                                                onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
                                                className="w-full bg-[#00000030] border border-[#7c3aed30] rounded-xl
                                                    px-3 py-2.5 text-xs font-mono text-white/70 placeholder-white/20
                                                    focus:outline-none focus:border-[#7c3aed60] focus:bg-[#7c3aed08]
                                                    transition-all duration-200"
                                            />
                                        </div>
                                        <button
                                            onClick={handleJoinRoom}
                                            disabled={!account || !joinInput.trim()}
                                            className={JOIN_BTN}
                                            style={{ fontFamily: 'Exo 2, sans-serif' }}
                                        >
                                            <span className="text-base shrink-0">🎮</span>
                                            <span className="flex-1 text-left">
                                                {!account ? 'Connect Wallet First' : 'Join Room'}
                                            </span>
                                            <span className="text-white/35 font-semibold text-[11px]">0.1 OCT</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── SIGNING phase ── */}
                        {phase === 'signing' && (
                            <div className="rounded-2xl bg-[#00ff8806] border border-[#00ff8818] px-4 py-5
                                flex flex-col items-center gap-3 text-center">
                                <div className="relative w-10 h-10 flex items-center justify-center">
                                    <div className="absolute inset-0 rounded-full border-2 border-[#00ff8830] animate-ping" />
                                    <div className="absolute inset-1 rounded-full border border-[#00ff8850] animate-spin" style={{ animationDuration: '1.5s' }} />
                                    <span className="text-lg relative z-10">✍️</span>
                                </div>
                                <div>
                                    <p
                                        className="text-sm font-bold text-[#00ff88] mb-1"
                                        style={{ fontFamily: 'Orbitron, monospace' }}
                                    >
                                        Waiting for Signature
                                    </p>
                                    <p className="text-[11px] text-white/40">{statusMsg}</p>
                                </div>
                                <div className="w-full h-1 rounded-full bg-[#ffffff08] overflow-hidden">
                                    <div className="h-full bg-[#00ff88] rounded-full animate-pulse w-2/3" />
                                </div>
                            </div>
                        )}

                        {/* ── WAITING phase ── */}
                        {phase === 'waiting' && (
                            <div className="space-y-3">
                                <div className="rounded-2xl bg-[#00ff8806] border border-[#00ff8818] px-4 py-4
                                    flex flex-col items-center gap-2 text-center">
                                    <span
                                        className="text-2xl animate-bounce"
                                        style={{ animationDuration: '1.2s', filter: 'drop-shadow(0 0 10px #00ff8860)' }}
                                    >
                                        🏏
                                    </span>
                                    <p
                                        className="text-sm font-bold text-[#00ff88]"
                                        style={{ fontFamily: 'Orbitron, monospace' }}
                                    >
                                        {tab === 'create' ? `Waiting for opponent${dots}` : `Joining room${dots}`}
                                    </p>
                                </div>

                                {/* Room code display */}
                                {roomCode && tab === 'create' && (
                                    <div className="rounded-2xl bg-[#00000030] border border-[#00ff8820] px-4 py-3 space-y-2">
                                        <p className="text-[9px] tracking-[0.3em] text-[#00ff8860] uppercase font-semibold text-center"
                                            style={{ fontFamily: 'Orbitron, monospace' }}>
                                            Your Room Code
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <code className="flex-1 text-[10px] font-mono text-white/50 truncate">
                                                {shortenGameId(roomCode)}
                                            </code>
                                            <button
                                                onClick={handleCopyCode}
                                                className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wide uppercase
                                                    transition-all duration-200
                                                    ${copied
                                                        ? 'bg-[#00ff8820] text-[#00ff88] border border-[#00ff8840]'
                                                        : 'border border-[#00ff8830] text-[#00ff8870] hover:bg-[#00ff8810] hover:text-[#00ff88]'}`}
                                            >
                                                {copied ? '✅ Copied' : '📋 Copy'}
                                            </button>
                                        </div>
                                        <p className="text-[10px] font-mono text-white/25 break-all leading-relaxed">
                                            {roomCode}
                                        </p>
                                        <p className="text-[10px] text-white/30 text-center">
                                            Share this code with your opponent
                                        </p>
                                    </div>
                                )}

                                {tab === 'join' && (
                                    <div className="rounded-2xl bg-[#00000030] border border-[#7c3aed20] px-4 py-3 text-center">
                                        <p className="text-[10px] text-[#a78bfa] font-mono mb-1">
                                            Room: {shortenGameId(joinInput)}
                                        </p>
                                        <p className="text-[10px] text-white/30">Connecting to your opponent…</p>
                                    </div>
                                )}

                                <button onClick={handleReset} className={CANCEL_BTN} style={{ fontFamily: 'Exo 2, sans-serif' }}>
                                    Cancel
                                </button>
                            </div>
                        )}

                        {/* ── Error toast ── */}
                        {errorMsg && (
                            <div className="flex items-start gap-2 p-2.5 rounded-xl
                                bg-[#ff440010] border border-[#ff444025] text-[#ff6666] text-xs leading-relaxed">
                                <span className="shrink-0 mt-0.5">⚠️</span>
                                <span className="flex-1">{errorMsg}</span>
                                <button
                                    onClick={() => setErrorMsg('')}
                                    className="shrink-0 text-[#ff444460] hover:text-[#ff4444] transition-colors"
                                >
                                    ✕
                                </button>
                            </div>
                        )}

                    </div>
                </div>
            </div>

            <style>{`
                @keyframes fadeUp {
                    from { opacity: 0; transform: translateY(22px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </>
    );
}