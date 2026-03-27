import { useState } from 'react'
import HandAnimation from '../HandAnimation'
import { BACKEND_URL, API_KEY } from '../../utils/constants'

import img1 from '../../assets/images/one.png'
import img2 from '../../assets/images/two.png'
import img3 from '../../assets/images/three.png'
import img4 from '../../assets/images/four.png'
import img5 from '../../assets/images/five.png'
import img6 from '../../assets/images/six.png'

interface TossPhaseProps {
    gameId: string
    onTossComplete: (playerBats: boolean) => void
    onError: (message: string) => void
}

type TossStage = 'choose-odd-even' | 'choose-number' | 'reveal' | 'choose-bat-bowl'

const numberImages = [img1, img2, img3, img4, img5, img6]

// ─── Reusable class strings ───────────────────────────────────
const STAGE_CARD =
    'relative w-full max-w-lg mx-auto ' +
    'bg-[#071a0c] rounded-2xl overflow-hidden ' +
    'border border-[#00ff8822] ' +
    'shadow-[0_0_0_1px_#00ff8810,0_16px_60px_rgba(0,0,0,0.85),0_0_60px_#00ff8808_inset] ' +
    'flex flex-col items-center justify-center text-center ' +
    'px-6 py-6 ' +
    'animate-[fadeUp_0.4s_cubic-bezier(0.16,1,0.3,1)_both]'

const TOSS_TITLE =
    'text-2xl font-black text-[#00ff88] tracking-tight mb-1 ' +
    '[font-family:Orbitron,monospace] ' +
    '[text-shadow:0_0_24px_#00ff8860,0_0_60px_#00ff8820]'

const TOSS_INSTRUCTION =
    'text-xs text-white/70 mb-5 tracking-wide [font-family:"Exo_2",sans-serif]'

const ODD_BTN =
    'px-8 py-3.5 rounded-xl font-black text-xs tracking-widest uppercase ' +
    '[font-family:Orbitron,monospace] ' +
    'bg-[#00ff88] text-[#030f06] ' +
    'shadow-[0_0_20px_#00ff8850] ' +
    'hover:shadow-[0_0_35px_#00ff8870] hover:-translate-y-1 active:scale-95 ' +
    'transition-all duration-200'

const EVEN_BTN =
    'px-8 py-3.5 rounded-xl font-black text-xs tracking-widest uppercase ' +
    '[font-family:Orbitron,monospace] ' +
    'bg-gradient-to-r from-[#7c3aed] to-[#4f46e5] text-white ' +
    'shadow-[0_0_20px_#7c3aed50] ' +
    'hover:shadow-[0_0_35px_#7c3aed70] hover:-translate-y-1 active:scale-95 ' +
    'transition-all duration-200'

const BAT_BTN =
    'px-8 py-3.5 rounded-xl font-black text-xs tracking-widest uppercase ' +
    '[font-family:Orbitron,monospace] ' +
    'bg-[#00ff88] text-[#030f06] ' +
    'shadow-[0_0_20px_#00ff8850] ' +
    'hover:shadow-[0_0_35px_#00ff8870] hover:-translate-y-1 active:scale-95 ' +
    'transition-all duration-200 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none'

const BOWL_BTN =
    'px-8 py-3.5 rounded-xl font-black text-xs tracking-widest uppercase ' +
    '[font-family:Orbitron,monospace] ' +
    'bg-transparent text-[#00ff88] border-2 border-[#00ff8860] ' +
    'shadow-[0_0_10px_#00ff8820] ' +
    'hover:bg-[#00ff8812] hover:border-[#00ff88] hover:shadow-[0_0_24px_#00ff8840] hover:-translate-y-1 active:scale-95 ' +
    'transition-all duration-200 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none'

const CONTINUE_BTN =
    'px-9 py-3.5 rounded-xl font-black text-xs tracking-widest uppercase ' +
    '[font-family:Orbitron,monospace] ' +
    'bg-[#00ff88] text-[#030f06] ' +
    'shadow-[0_0_20px_#00ff8850,0_6px_20px_#00000050] ' +
    'hover:shadow-[0_0_40px_#00ff8870,0_10px_30px_#00000060] hover:-translate-y-1 active:scale-95 ' +
    'transition-all duration-200 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none'

const NUM_BTN =
    'relative bg-[#0a2212] border border-[#00ff8822] rounded-xl p-2.5 ' +
    'flex items-center justify-center overflow-hidden ' +
    'hover:border-[#00ff8860] hover:-translate-y-1 hover:shadow-[0_8px_24px_#00000060,0_0_20px_#00ff8815] ' +
    'active:scale-95 transition-all duration-200 cursor-pointer ' +
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none'

export default function TossPhase({ gameId, onTossComplete, onError }: TossPhaseProps) {
    const [stage, setStage]                           = useState<TossStage>('choose-odd-even')
    const [playerChoice, setPlayerChoice]             = useState<'odd' | 'even' | null>(null)
    const [playerTossNumber, setPlayerTossNumber]     = useState<number | null>(null)
    const [computerTossNumber, setComputerTossNumber] = useState<number | null>(null)
    const [isAnimating, setIsAnimating]               = useState(false)
    const [playerWonToss, setPlayerWonToss]           = useState(false)
    const [sumIsOdd, setSumIsOdd]                     = useState(false)
    const [isResolving, setIsResolving]               = useState(false)
    const [isRevealing, setIsRevealing]               = useState(false)

    function handleOddEvenChoice(choice: 'odd' | 'even') {
        setPlayerChoice(choice)
        setStage('choose-number')
    }

    async function handleNumberChoice(num: number) {
        if (isAnimating || isResolving) return
        setIsAnimating(true)
        setPlayerTossNumber(num)
        try {
            const response = await fetch(`${BACKEND_URL}/api/toss`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
                body: JSON.stringify({ playerTossNumber: num, isOdd: playerChoice === 'odd' }),
            })
            const result = await response.json()
            if (!result.computerTossNumber) throw new Error('Invalid toss response')
            setComputerTossNumber(result.computerTossNumber)
            setPlayerWonToss(result.playerWon)
            setSumIsOdd(result.sumIsOdd)
        } catch {
            setIsAnimating(false)
            onError('Toss failed. Please check your connection and try again.')
            return
        }
        setTimeout(() => {
            setIsAnimating(false)
            setStage('reveal')
            setIsRevealing(true)                // start shake animation
            setTimeout(() => {
                setIsRevealing(false)           // show actual numbers after shake
            }, 1200)                            // matches the hand shake duration
        }, 1200)
    }

    async function handleFinalTossSettlement(chooseBat: boolean) {
        if (isResolving) return
        setIsResolving(true)
        try {
            const response = await fetch(`${BACKEND_URL}/api/resolve-toss`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
                body: JSON.stringify({
                    gameId,
                    isOdd:             playerChoice === 'odd',
                    playerTossNumber:  playerTossNumber ?? 0,
                    computerTossNumber,
                    playerChoosesBat:  chooseBat,
                }),
            })
            const result = await response.json()
            if (!result.success) throw new Error(result.error)
            onTossComplete(chooseBat)
        } catch {
            setIsResolving(false)
            onError('Blockchain sync failed. Please try again.')
        }
    }

    const sum = (playerTossNumber ?? 0) + (computerTossNumber ?? 0)

    return (
        <div className="w-full max-w-lg mx-auto px-4">

            <style>{`
                @keyframes fadeUp {
                    from { opacity: 0; transform: translateY(16px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes shimmerBar {
                    0%, 100% { opacity: 0.4; }
                    50%       { opacity: 1; }
                }
            `}</style>

            {/* ── STAGE 1 — Odd / Even ──────────────────────── */}
            {stage === 'choose-odd-even' && (
                <div className={STAGE_CARD}>
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#00ff88] to-transparent [animation:shimmerBar_3s_ease-in-out_infinite]" />
                    <h2 className={TOSS_TITLE}>🎲 Toss Time!</h2>
                    <p className={TOSS_INSTRUCTION}>First, pick Odd or Even</p>
                    <div className="flex gap-4">
                        <button className={ODD_BTN} onClick={() => handleOddEvenChoice('odd')}>ODD</button>
                        <button className={EVEN_BTN} onClick={() => handleOddEvenChoice('even')}>EVEN</button>
                    </div>
                </div>
            )}

            {/* ── STAGE 2 — Pick a Number ───────────────────── */}
            {stage === 'choose-number' && (
                <div className={STAGE_CARD}>
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#00ff88] to-transparent [animation:shimmerBar_3s_ease-in-out_infinite]" />
                    <h2 className={TOSS_TITLE}>Pick a Number</h2>
                    <p className={TOSS_INSTRUCTION}>
                        You chose{' '}
                        <strong className="text-[#00ff88] font-bold">{playerChoice?.toUpperCase()}</strong>
                        . Now pick your toss number:
                    </p>
                    <div className="grid grid-cols-3 gap-2.5 w-full max-w-[260px] mx-auto">
                        {[1, 2, 3, 4, 5, 6].map((num) => (
                            <button
                                key={num}
                                className={NUM_BTN}
                                disabled={isAnimating || isResolving}
                                onClick={() => handleNumberChoice(num)}
                            >
                                <img
                                    src={numberImages[num - 1]}
                                    alt={num.toString()}
                                    className="w-12 h-12 object-contain transition-transform duration-200 hover:scale-110"
                                />
                            </button>
                        ))}
                    </div>
                    {isAnimating && (
                        <p className="mt-4 text-[#00ff8870] text-[10px] tracking-widest animate-pulse [font-family:Orbitron,monospace]">
                            Tossing…
                        </p>
                    )}
                </div>
            )}

            {/* ── STAGE 3 — Reveal with shake animation ──────── */}
            {stage === 'reveal' && (
                <div className={STAGE_CARD}>
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#00ff88] to-transparent [animation:shimmerBar_3s_ease-in-out_infinite]" />

                    <h2 className={TOSS_TITLE}>
                        {playerWonToss ? '🎉 You Won the Toss!' : '😔 CPU Won the Toss!'}
                    </h2>

                    {/* Hands */}
                    <div className="flex items-center justify-center gap-6 my-3">
                        <div className="flex flex-col items-center gap-2">
                            <p className="text-[9px] tracking-[0.25em] text-[#00ff8870] uppercase font-semibold [font-family:Orbitron,monospace]">
                                You ({playerChoice})
                            </p>
                            <div className="w-24 h-24 bg-[#0a2212] rounded-xl border border-[#00ff8840] flex items-center justify-center shadow-[0_0_20px_#00ff8815] overflow-hidden">
                                <HandAnimation number={playerTossNumber} isAnimating={isRevealing} />
                            </div>
                        </div>

                        <div className="w-8 h-8 rounded-full bg-[#00ff8815] border border-[#00ff8860] flex items-center justify-center shadow-[0_0_14px_#00ff8830]">
                            <span className="text-[#00ff88] text-[9px] font-black [font-family:Orbitron,monospace]">VS</span>
                        </div>

                        <div className="flex flex-col items-center gap-2">
                            <p className="text-[9px] tracking-[0.25em] text-[#00ff8870] uppercase font-semibold [font-family:Orbitron,monospace]">
                                Computer
                            </p>
                            <div className="w-24 h-24 bg-[#0a2212] rounded-xl border border-[#00ff8840] flex items-center justify-center shadow-[0_0_20px_#00ff8815] overflow-hidden">
                                <HandAnimation number={computerTossNumber} isAnimating={isRevealing} />
                            </div>
                        </div>
                    </div>

                    {/* Calculation area – only shown after the shake */}
                    {!isRevealing && (
                        <div className="w-full bg-[#00ff8806] border border-[#00ff8818] rounded-xl px-5 py-4 animate-[fadeUp_0.5s_ease-out]">
                            <div className="flex items-center justify-center gap-3 mb-2">
                                {[playerTossNumber, '+', computerTossNumber, '='].map((v, i) => (
                                    <span key={i} className="text-2xl font-black text-white/80 [font-family:Orbitron,monospace]">{v}</span>
                                ))}
                                <span className="text-2xl font-black text-[#00ff88] [font-family:Orbitron,monospace] bg-[#00ff8815] px-2.5 py-0.5 rounded-lg [text-shadow:0_0_16px_#00ff8860]">
                                    {sum}
                                </span>
                            </div>
                            <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#00ff8880] mb-3 [font-family:Orbitron,monospace]">
                                It's {sumIsOdd ? '🔴 ODD' : '🔵 EVEN'}
                            </p>
                            <button className={CONTINUE_BTN} onClick={() => setStage('choose-bat-bowl')}>
                                Next →
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── STAGE 4 — Bat / Bowl ──────────────────────── */}
            {stage === 'choose-bat-bowl' && (
                <div className={STAGE_CARD}>
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#00ff88] to-transparent [animation:shimmerBar_3s_ease-in-out_infinite]" />
                    <h2 className={TOSS_TITLE}>
                        {playerWonToss ? 'Your Choice!' : 'Computer Decides…'}
                    </h2>
                    {playerWonToss ? (
                        <div className="flex gap-4 mt-3">
                            <button className={BAT_BTN} disabled={isResolving} onClick={() => handleFinalTossSettlement(true)}>
                                {isResolving ? 'Syncing…' : '🏏 BAT'}
                            </button>
                            <button className={BOWL_BTN} disabled={isResolving} onClick={() => handleFinalTossSettlement(false)}>
                                {isResolving ? 'Syncing…' : '⚾ BOWL'}
                            </button>
                        </div>
                    ) : (
                        <div className="mt-3 space-y-4">
                            <p className="text-xs text-white/70 [font-family:'Exo_2',sans-serif]">
                                Computer chose to Bat first!
                            </p>
                            <button className={CONTINUE_BTN} disabled={isResolving} onClick={() => handleFinalTossSettlement(false)}>
                                {isResolving ? 'Syncing…' : 'Start Game'}
                            </button>
                        </div>
                    )}
                </div>
            )}

        </div>
    )
}