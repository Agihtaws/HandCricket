import { useState, useRef } from 'react'
import HandAnimation from '../HandAnimation'
import { BACKEND_URL, API_KEY } from '../../utils/constants'

import img1 from '../../assets/images/one.png'; import img2 from '../../assets/images/two.png'
import img3 from '../../assets/images/three.png'; import img4 from '../../assets/images/four.png'
import img5 from '../../assets/images/five.png'; import img6 from '../../assets/images/six.png'

interface GamePlayProps {
    gameId:            string
    playerBats:        boolean
    targetScore:       number
    onGameEnd:         (playerWon: boolean, playerScore: number, computerScore: number) => void
    onInningsComplete: (newTarget: number) => void
    onFatalError:      (message: string) => void
}

const numberImages = [img1, img2, img3, img4, img5, img6]

// ─── Reusable class strings ───────────────────────────────────
const SCORE_CARD = (active: boolean) =>
    'flex flex-col items-center gap-1 px-5 py-3 rounded-2xl border transition-all duration-200 ' +
    (active
        ? 'bg-[#00ff8812] border-[#00ff8860] shadow-[0_0_16px_#00ff8820]'
        : 'bg-[#0a2212] border-[#00ff8820]')

const SCORE_LABEL = (active: boolean) =>
    'text-[10px] font-semibold tracking-[0.2em] uppercase ' +
    '[font-family:Orbitron,monospace] ' +
    (active ? 'text-[#00ff88]' : 'text-white/40')

const SCORE_VALUE = (active: boolean) =>
    'font-black tabular-nums leading-tight ' +
    '[font-family:Orbitron,monospace] ' +
    (active
        ? 'text-3xl text-[#00ff88] [text-shadow:0_0_16px_#00ff8860]'
        : 'text-2xl text-white/60')

const NUM_BTN =
    'relative bg-[#0a2212] border border-[#00ff8822] rounded-2xl ' +
    'flex flex-col items-center justify-center overflow-hidden ' +
    'min-h-[72px] cursor-pointer ' +
    'hover:border-[#00ff8860] hover:-translate-y-1 hover:shadow-[0_8px_24px_#00000060,0_0_20px_#00ff8815] ' +
    'active:scale-95 transition-all duration-200 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none'

export default function GamePlay({ gameId, playerBats, targetScore, onGameEnd, onInningsComplete, onFatalError }: GamePlayProps) {
    const isSecondInnings  = targetScore > 0
    const initialBatter    = isSecondInnings
        ? (playerBats ? 'computer' : 'player')
        : (playerBats ? 'player' : 'computer')

    const [playerScore, setPlayerScore]         = useState(0)
    const [computerScore, setComputerScore]     = useState(0)
    const [innings, setInnings]                 = useState<1 | 2>(isSecondInnings ? 2 : 1)
    const [currentBatter, setCurrentBatter]     = useState<'player' | 'computer'>(initialBatter)
    const [playerMoves, setPlayerMoves]         = useState<number[]>([])
    const [computerMoves, setComputerMoves]     = useState<number[]>([])
    const [playerNumber, setPlayerNumber]       = useState<number | null>(null)
    const [computerNumber, setComputerNumber]   = useState<number | null>(null)
    const [isAnimating, setIsAnimating]         = useState(false)
    const [isOut, setIsOut]                     = useState(false)
    const [isSettling, setIsSettling]           = useState(false)
    const [statusText, setStatusText]           = useState('')
    const [isOutPending, setIsOutPending]       = useState(false)
    const isProcessingRef                       = useRef(false)

    async function handleNumberClick(num: number) {
        if (isProcessingRef.current) return
        isProcessingRef.current = true

        setIsAnimating(true)
        setPlayerNumber(null)
        setComputerNumber(null)
        setIsOut(false)

        try {
            const moveResponse = await fetch(`${BACKEND_URL}/api/computer-move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
                body: JSON.stringify({ gameId }),
            })
            const moveResult = await moveResponse.json()
            if (!moveResult.success) throw new Error(moveResult.error)

            const computerNum = moveResult.computerMove as number
            const newPMoves   = [...playerMoves, num]
            const newCMoves   = [...computerMoves, computerNum]

            setPlayerMoves(newPMoves)
            setComputerMoves(newCMoves)

            setTimeout(async () => {
                setPlayerNumber(num)
                setComputerNumber(computerNum)
                setIsAnimating(false)

                const out = num === computerNum

                if (out) {
                    setIsOut(true)
                    setIsOutPending(true)
                    setTimeout(() => {
                        isProcessingRef.current = false
                        settleInnings(newPMoves, newCMoves, playerScore, computerScore, innings, currentBatter)
                    }, 1500)
                } else {
                    let updatedPlayerScore   = playerScore
                    let updatedComputerScore = computerScore

                    if (currentBatter === 'player') {
                        updatedPlayerScore = playerScore + num
                        setPlayerScore(updatedPlayerScore)
                    } else {
                        updatedComputerScore = computerScore + computerNum
                        setComputerScore(updatedComputerScore)
                    }

                    const targetReached =
                        innings === 2 &&
                        targetScore > 0 &&
                        (currentBatter === 'player'
                            ? updatedPlayerScore >= targetScore
                            : updatedComputerScore >= targetScore)

                    if (targetReached) {
                        setTimeout(() => {
                            isProcessingRef.current = false
                            settleInnings(newPMoves, newCMoves, updatedPlayerScore, updatedComputerScore, innings, currentBatter)
                        }, 1000)
                    } else {
                        isProcessingRef.current = false
                    }
                }
            }, 1200)

        } catch {
            setIsAnimating(false)
            isProcessingRef.current = false
            onFatalError(`Failed to get computer move. Game ID: ${gameId}. Please contact support.`)
        }
    }

    async function settleInnings(
        pMoves:         number[],
        cMoves:         number[],
        finalP:         number,
        finalC:         number,
        currentInnings: 1 | 2,
        batter:         'player' | 'computer',
    ) {
        setIsSettling(true)
        setStatusText('Verifying innings on blockchain...')

        try {
            const settleRes = await fetch(`${BACKEND_URL}/api/settle-innings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
                body: JSON.stringify({ gameId, playerMoves: pMoves, computerMoves: cMoves }),
            })
            const settleResult = await settleRes.json()
            if (!settleResult.success) throw new Error(settleResult.error)

            if (currentInnings === 1) {
                setStatusText('Switching innings...')
                const switchRes = await fetch(`${BACKEND_URL}/api/switch-innings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
                    body: JSON.stringify({ gameId }),
                })
                const switchResult = await switchRes.json()
                if (!switchResult.success) throw new Error(switchResult.error)

                const inningsScore = batter === 'player' ? finalP : finalC
                setInnings(2)
                setCurrentBatter(batter === 'player' ? 'computer' : 'player')
                setPlayerMoves([])
                setComputerMoves([])
                setIsOut(false)
                setPlayerNumber(null)
                setComputerNumber(null)
                setIsSettling(false)
                setIsOutPending(false)
                setStatusText('')
                onInningsComplete(inningsScore + 1)

            } else {
                setStatusText('Finalising payout...')
                const endRes = await fetch(`${BACKEND_URL}/api/end-game`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
                    body: JSON.stringify({ gameId }),
                })
                const endResult = await endRes.json()
                if (!endResult.success) throw new Error(endResult.error)

                // Determine who won based on who was batting in the second innings
                let playerWon: boolean;
                if (batter === 'player') {
                    // Player was batting → they win if they reached or exceeded the target
                    playerWon = finalP >= targetScore;
                } else {
                    // Computer was batting → player wins if computer failed to reach the target
                    playerWon = finalC < targetScore;
                }

                setIsSettling(false)
                setIsOutPending(false)
                setStatusText('')
                onGameEnd(playerWon, finalP, finalC)
            }

        } catch {
            setIsSettling(false)
            setStatusText('')
            setIsOutPending(false)
            onFatalError(`Settlement failed. Game ID: ${gameId}. Please contact support.`)
        }
    }

    const playerBatting   = currentBatter === 'player'
    const computerBatting = currentBatter === 'computer'

    return (
        <div className="w-full flex flex-col gap-3">

            {/* Scoreboard */}
            <div className="flex items-center justify-between gap-2 px-1">
                <div className={SCORE_CARD(playerBatting)}>
                    <span className={SCORE_LABEL(playerBatting)}>
                        You {playerBatting && '🏏'}
                    </span>
                    <span className={SCORE_VALUE(playerBatting)}>{playerScore}</span>
                </div>

                <div className="flex flex-col items-center gap-1 px-4 py-3 rounded-2xl bg-[#0a2212] border border-[#00ff8820]">
                    <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-white/40 [font-family:Orbitron,monospace]">
                        Target
                    </span>
                    <span className="text-2xl font-black text-white/60 tabular-nums [font-family:Orbitron,monospace]">
                        {targetScore > 0 ? targetScore : '—'}
                    </span>
                </div>

                <div className={SCORE_CARD(computerBatting)}>
                    <span className={SCORE_LABEL(computerBatting)}>
                        CPU {computerBatting && '🏏'}
                    </span>
                    <span className={SCORE_VALUE(computerBatting)}>{computerScore}</span>
                </div>
            </div>

            {/* Innings + syncing indicator */}
            <div className="flex items-center justify-center gap-3">
                <span className="text-[10px] tracking-[0.25em] uppercase text-white/30 [font-family:Orbitron,monospace]">
                    Innings {innings}/2
                </span>
                {isSettling && (
                    <span className="text-[10px] tracking-[0.15em] uppercase text-[#00ff8870] animate-pulse [font-family:Orbitron,monospace]">
                        {statusText} ⛓️
                    </span>
                )}
            </div>

            {/* OUT banner */}
            {isOut && (
                <div className="flex items-center justify-center animate-[fadeUp_0.3s_ease-out]">
                    <div className="px-8 py-2.5 rounded-full bg-[#ff444415] border border-[#ff444440]
                        text-[#ff4444] font-black text-lg tracking-widest [font-family:Orbitron,monospace]
                        [text-shadow:0_0_16px_#ff444480] shadow-[0_0_24px_#ff44441a]">
                        OUT! 🔴
                    </div>
                </div>
            )}

            {/* Hands */}
            <div className="flex items-center justify-center gap-6">
                <div className="flex flex-col items-center gap-2">
                    <p className="text-[9px] tracking-[0.25em] text-[#00ff8870] uppercase font-semibold [font-family:Orbitron,monospace]">
                        You
                    </p>
                    <div className="w-28 h-28 bg-[#0a2212] rounded-2xl border border-[#00ff8840]
                        flex items-center justify-center overflow-hidden
                        shadow-[0_0_20px_#00ff8815]">
                        <HandAnimation number={playerNumber} isAnimating={isAnimating} />
                    </div>
                </div>

                <div className="w-9 h-9 rounded-full bg-[#00ff8815] border border-[#00ff8860]
                    flex items-center justify-center shadow-[0_0_14px_#00ff8830]">
                    <span className="text-[#00ff88] text-[9px] font-black [font-family:Orbitron,monospace]">VS</span>
                </div>

                <div className="flex flex-col items-center gap-2">
                    <p className="text-[9px] tracking-[0.25em] text-[#00ff8870] uppercase font-semibold [font-family:Orbitron,monospace]">
                        Computer
                    </p>
                    <div className="w-28 h-28 bg-[#0a2212] rounded-2xl border border-[#00ff8840]
                        flex items-center justify-center overflow-hidden
                        shadow-[0_0_20px_#00ff8815]">
                        <HandAnimation number={computerNumber} isAnimating={isAnimating} />
                    </div>
                </div>
            </div>

            {/* Number buttons */}
            <div className="grid grid-cols-6 gap-2 mt-1">
                {[1, 2, 3, 4, 5, 6].map((num) => (
                    <button
                        key={num}
                        className={NUM_BTN}
                        onClick={() => handleNumberClick(num)}
                        disabled={isAnimating || isSettling || isOutPending}
                    >
                        <img
                            src={numberImages[num - 1]}
                            alt={num.toString()}
                            className="w-10 h-10 object-contain transition-transform duration-200 group-hover:scale-110"
                        />
                    </button>
                ))}
            </div>

            {/* Status bar */}
            <div className="text-center px-4 py-2.5 rounded-xl bg-[#00ff8806] border border-[#00ff8818]">
                <p className="text-xs text-white/60 tracking-wide [font-family:'Exo_2',sans-serif]">
                    {isSettling
                        ? statusText
                        : playerBatting
                            ? "You're batting! 🏏"
                            : 'Computer is batting…'}
                </p>
            </div>

            <style>{`
                @keyframes fadeUp {
                    from { opacity: 0; transform: translateY(10px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    )
}