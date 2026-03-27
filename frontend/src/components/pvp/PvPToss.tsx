import { useState, useRef, useEffect } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import HandAnimation from '../HandAnimation';
import { createPvPWebSocket, PvPWebSocket } from '../../utils/pvpWebSocket';
import { WS_URL } from '../../utils/constants';
import './PvPToss.css';

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

function shortenAddr(addr: string): string {
    return addr ? addr.slice(0, 6) + '…' + addr.slice(-4) : '';
}

export default function PvPToss({ gameId, isPlayer1, onGameStart, onBack }: PvPTossProps) {
    const account = useCurrentAccount();

    const [phase, setPhase]           = useState<Phase>('connecting');
    const [oddEven, setOddEven]       = useState<OddEven | null>(null);
    const [myNumber, setMyNumber]     = useState<number | null>(null);
    const [errorMsg, setErrorMsg]     = useState('');
    const [tossResult, setTossResult] = useState<TossResult | null>(null);
    const [iAmWinner, setIAmWinner]   = useState(false);
    const [revealStep, setRevealStep] = useState(0);
    const [dotCount, setDotCount]     = useState(1);
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
                if (status === 'failed') {
                    setErrorMsg('Connection failed after multiple attempts.');
                    setPhase('error');
                }
            },

            onConnected: () => {
                if (!mounted.current) return;
                setPhase('picking');
            },

            onReconnected: () => {
                if (!mounted.current) return;
                setPhase('picking');
            },

            onTossSubmitted: () => {
                if (!mounted.current) return;
                setPhase('submitted');
            },

            onTossResult: (msg) => {
                if (!mounted.current) return;
                const result: TossResult = {
                    p1Toss:            msg.p1Toss,
                    p2Toss:            msg.p2Toss,
                    total:             msg.total,
                    isOdd:             msg.isOdd,
                    p1WonToss:         msg.p1WonToss,
                    tossWinnerAddress: msg.tossWinnerAddress,
                };
                setTossResult(result);
                const won = isPlayer1 ? msg.p1WonToss : !msg.p1WonToss;
                setIAmWinner(won);
                setPhase('revealing');
                setTimeout(() => setRevealStep(1), 300);
                setTimeout(() => setRevealStep(2), 900);
                setTimeout(() => setRevealStep(3), 1600);
                setTimeout(() => {
                    if (!mounted.current) return;
                    setPhase(won ? 'bat_or_bowl' : 'waiting_choice');
                }, 2800);
            },

            onGameStart: (msg) => {
                if (!mounted.current) return;
                setPhase('starting');
                setTimeout(() => {
                    if (mounted.current) onGameStart({
                        currentBatter: msg.currentBatter,
                        p1Address:     msg.p1Address,
                        p2Address:     msg.p2Address,
                    });
                }, 1500);
            },

            onError: (msg) => {
                if (!mounted.current) return;
                setErrorMsg(msg.message ?? 'Server error. Please go back and try again.');
                setPhase('error');
            },
        });

        wsRef.current = ws;

        return () => {
            mounted.current = false;
            ws.destroy();
            wsRef.current = null;
        };
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

    if (phase === 'connecting') {
        return (
            <div className="pvp-toss">
                <div className="toss-card toss-card--narrow">
                    <div className="connecting-anim">🏏</div>
                    <p className="toss-status-text">Connecting{dots}</p>
                </div>
            </div>
        );
    }

    if (phase === 'error') {
        return (
            <div className="pvp-toss">
                <div className="toss-card toss-card--narrow">
                    <div className="toss-error-icon">⚠️</div>
                    <h2 className="toss-error-title">Connection Error</h2>
                    <p className="toss-error-body">{errorMsg}</p>
                    <button className="toss-btn toss-btn--back" onClick={onBack}>← Go Back</button>
                </div>
            </div>
        );
    }

    if (phase === 'starting') {
        return (
            <div className="pvp-toss">
                <div className="toss-card toss-card--narrow toss-card--launching">
                    <div className="launch-icon">🏏</div>
                    <h2 className="launch-title">Game Starting!</h2>
                    <p className="launch-sub">Heading to the pitch{dots}</p>
                </div>
            </div>
        );
    }

    if (phase === 'picking') {
        return (
            <div className="pvp-toss">
                <div className="toss-header">
                    <button className="back-btn" onClick={onBack}>← Back</button>
                    <div className="toss-header-title"><span>🎲 The Toss</span></div>
                    <div className="toss-player-badge">{myLabel}</div>
                </div>

                <div className="toss-card">
                    <div className="toss-card-inner">
                        <div className="game-id-chip">
                            <span className="chip-label">Room</span>
                            <span className="chip-val">{gameId.slice(0, 10)}…{gameId.slice(-6)}</span>
                        </div>

                        {isPlayer1 && (
                            <section className="toss-section">
                                <div className="toss-section-label">
                                    <span className="step-badge">1</span>
                                    <span>Your Call — Odd or Even?</span>
                                </div>
                                <div className="choice-buttons">
                                    <button className={`choice-button odd-button ${oddEven === 'odd' ? 'active' : ''}`} onClick={() => setOddEven('odd')}>ODD</button>
                                    <button className={`choice-button even-button ${oddEven === 'even' ? 'active' : ''}`} onClick={() => setOddEven('even')}>EVEN</button>
                                </div>
                            </section>
                        )}

                        {!isPlayer1 && (
                            <div className="p2-toss-hint">
                                <span>🎲</span>
                                <span>Pick your secret number.<br />Player 1 has called Odd or Even.</span>
                            </div>
                        )}

                        <section className="toss-section">
                            <div className="toss-section-label">
                                <span className="step-badge">{isPlayer1 ? '2' : '1'}</span>
                                <span>Pick Your Secret Number</span>
                            </div>
                            <div className="toss-number-grid">
                                {[1, 2, 3, 4, 5, 6].map(n => (
                                    <button key={n} className={`toss-num-btn ${myNumber === n ? 'active' : ''}`} onClick={() => setMyNumber(n)}>
                                        <img src={numberImages[n - 1]} alt={n.toString()} />
                                    </button>
                                ))}
                            </div>
                        </section>

                        <div className="selection-summary">
                            {isPlayer1 ? (
                                <>
                                    <span className={`summary-chip ${oddEven ? 'summary-chip--set' : ''}`}>{oddEven ? `Called: ${oddEven.toUpperCase()}` : 'No call yet'}</span>
                                    <span className={`summary-chip ${myNumber ? 'summary-chip--set' : ''}`}>{myNumber ? `Number: ${myNumber}` : 'No number'}</span>
                                </>
                            ) : (
                                <span className={`summary-chip ${myNumber ? 'summary-chip--set' : ''}`}>{myNumber ? `Number: ${myNumber}` : 'No number selected'}</span>
                            )}
                        </div>

                        <button className={`toss-submit-btn ${canSubmit ? 'toss-submit-btn--ready' : ''}`} onClick={handleSubmit} disabled={!canSubmit}>
                            {canSubmit ? '🤝 Lock In & Submit' : 'Select to continue…'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (phase === 'submitted') {
        return (
            <div className="pvp-toss">
                <div className="toss-card toss-card--narrow">
                    <div className="waiting-ball">🏏</div>
                    <h2 className="waiting-title">Move Locked In!</h2>
                    <div className="locked-summary">
                        {isPlayer1 && oddEven && <span className="locked-chip">Called: <strong>{oddEven.toUpperCase()}</strong></span>}
                        {myNumber && <span className="locked-chip">Number: <strong>{myNumber}</strong></span>}
                    </div>
                    <p className="toss-status-text">Waiting for {oppLabel}{dots}</p>
                    <div className="toss-vs-strip">
                        <span className="vs-name vs-name--mine">{myLabel} ✓</span>
                        <span className="vs-divider">vs</span>
                        <span className="vs-name vs-name--opp">{oppLabel} ⏳</span>
                    </div>
                </div>
            </div>
        );
    }

    if (phase === 'revealing' && tossResult) {
        const myToss  = isPlayer1 ? tossResult.p1Toss : tossResult.p2Toss;
        const oppToss = isPlayer1 ? tossResult.p2Toss : tossResult.p1Toss;

        return (
            <div className="pvp-toss">
                <div className="toss-stage reveal-stage">
                    <h2 className="toss-title">Toss Reveal</h2>
                    <div className="toss-hands-container">
                        <div className="toss-hand-wrapper">
                            <div className="toss-hand-label">{myLabel}</div>
                            <div className="toss-hand-display">
                                <HandAnimation number={revealStep >= 1 ? myToss : null} isAnimating={revealStep < 2} />
                            </div>
                        </div>
                        <div className="toss-vs">VS</div>
                        <div className="toss-hand-wrapper">
                            <div className="toss-hand-label">{oppLabel}</div>
                            <div className="toss-hand-display">
                                <HandAnimation number={revealStep >= 1 ? oppToss : null} isAnimating={revealStep < 2} />
                            </div>
                        </div>
                    </div>

                    {revealStep >= 2 && (
                        <div className="calculation-area">
                            <div className="calc-row">
                                <span>{myToss}</span><span>+</span><span>{oppToss}</span><span>=</span>
                                <span className="sum-val">{tossResult.total}</span>
                            </div>
                            <p className="sum-type">It's {tossResult.isOdd ? '🔴 ODD' : '🔵 EVEN'}</p>
                        </div>
                    )}

                    {revealStep >= 3 && (
                        <div className="reveal-winner">
                            <span className="winner-crown">{iAmWinner ? '👑' : '🏏'}</span>
                            <span className="winner-text">{iAmWinner ? 'You won the toss!' : `${oppLabel} won the toss!`}</span>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (phase === 'bat_or_bowl') {
        return (
            <div className="pvp-toss">
                <div className="toss-stage">
                    <h2 className="toss-title">Your Choice!</h2>
                    <div className="choice-buttons">
                        <button className="choice-button bat-button" onClick={() => handleBatBowl(true)} disabled={batBowlSent}>
                            🏏 BAT
                        </button>
                        <button className="choice-button bowl-button" onClick={() => handleBatBowl(false)} disabled={batBowlSent}>
                            ⚾ BOWL
                        </button>
                    </div>
                    {tossResult && (
                        <div className="bat-bowl-toss-recap">
                            <span>{tossResult.p1Toss} + {tossResult.p2Toss} = {tossResult.total}</span>
                            <span className={tossResult.isOdd ? 'recap-odd' : 'recap-even'}>({tossResult.isOdd ? 'Odd' : 'Even'})</span>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (phase === 'waiting_choice') {
        return (
            <div className="pvp-toss">
                <div className="toss-card toss-card--narrow">
                    <div className="waiting-ball">🏏</div>
                    <h2 className="waiting-title">{iAmWinner ? 'Sending choice…' : `${oppLabel} is choosing…`}</h2>
                    {!iAmWinner && tossResult && (
                        <div className="loss-recap">
                            <span>Toss: {tossResult.p1Toss} + {tossResult.p2Toss} = {tossResult.total}</span>
                            <span className={tossResult.isOdd ? 'recap-odd' : 'recap-even'}>({tossResult.isOdd ? 'Odd' : 'Even'})</span>
                        </div>
                    )}
                    <p className="toss-status-text">{iAmWinner ? 'Confirming on-chain…' : `Waiting for ${oppLabel}${dots}`}</p>
                </div>
            </div>
        );
    }

    return null;
}