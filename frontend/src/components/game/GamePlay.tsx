import { useState, useRef } from 'react'
import HandAnimation from '../HandAnimation'
import './GamePlay.css'
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

export default function GamePlay({ gameId, playerBats, targetScore, onGameEnd, onInningsComplete, onFatalError }: GamePlayProps) {
    const isSecondInnings  = targetScore > 0
    const initialBatter    = isSecondInnings
        ? (playerBats ? 'computer' : 'player')
        : (playerBats ? 'player' : 'computer')

    const [playerScore, setPlayerScore]     = useState(0)
    const [computerScore, setComputerScore] = useState(0)
    const [innings, setInnings]             = useState<1 | 2>(isSecondInnings ? 2 : 1)
    const [currentBatter, setCurrentBatter] = useState<'player' | 'computer'>(initialBatter)
    const [playerMoves, setPlayerMoves]     = useState<number[]>([])
    const [computerMoves, setComputerMoves] = useState<number[]>([])
    const [playerNumber, setPlayerNumber]   = useState<number | null>(null)
    const [computerNumber, setComputerNumber] = useState<number | null>(null)
    const [isAnimating, setIsAnimating]     = useState(false)
    const [isOut, setIsOut]                 = useState(false)
    const [isSettling, setIsSettling]       = useState(false)
    const [statusText, setStatusText]       = useState('')
    const [isOutPending, setIsOutPending] = useState(false);
    const isProcessingRef = useRef(false)

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

            const computerNum  = moveResult.computerMove as number
            const newPMoves    = [...playerMoves, num]
            const newCMoves    = [...computerMoves, computerNum]

            setPlayerMoves(newPMoves)
            setComputerMoves(newCMoves)

            setTimeout(async () => {
                setPlayerNumber(num)
                setComputerNumber(computerNum)
                setIsAnimating(false)

                const out = num === computerNum

                if (out) {
    setIsOut(true);
    setIsOutPending(true);  // lock UI immediately
    setTimeout(() => {
        isProcessingRef.current = false;
        settleInnings(newPMoves, newCMoves, playerScore, computerScore, innings, currentBatter);
    }, 1500);
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

        } catch (err: any) {
            setIsAnimating(false)
            isProcessingRef.current = false
            onFatalError(`Failed to get computer move. Game ID: ${gameId}. Please contact support.`)
        }
    }

    async function settleInnings(
        pMoves:      number[],
        cMoves:      number[],
        finalP:      number,
        finalC:      number,
        currentInnings: 1 | 2,
        batter:      'player' | 'computer',
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

                setIsSettling(false)
                setIsOutPending(false)
                setStatusText('')
                onGameEnd(finalP >= targetScore, finalP, finalC)
            }

        } catch (err: any) {
            setIsSettling(false)
            setStatusText('')
            setIsOutPending(false)
            onFatalError(`Settlement failed. Game ID: ${gameId}. Please contact support.`)
        }
    }

    return (
        <div className="game-play">
            <div className="scoreboard">
                <div className={`score-item ${currentBatter === 'player' ? 'batting' : ''}`}>
                    <span className="label">You {currentBatter === 'player' && '🏏'}</span>
                    <span className="value">{playerScore}</span>
                </div>
                <div className="score-item target-item">
                    <span className="label">Target</span>
                    <span className="value">{targetScore > 0 ? targetScore : '-'}</span>
                </div>
                <div className={`score-item ${currentBatter === 'computer' ? 'batting' : ''}`}>
                    <span className="label">CPU {currentBatter === 'computer' && '🏏'}</span>
                    <span className="value">{computerScore}</span>
                </div>
            </div>

            <div className="innings-indicator">
                <span>Innings {innings}/2</span>
                {isSettling && <span className="syncing">{statusText} ⛓️</span>}
            </div>

            {isOut && <div className="out-banner"><div className="out-text">OUT! 🔴</div></div>}

            <div className="hands-container">
                <div className="hand-wrapper">
                    <div className="hand-label">You</div>
                    <div className="hand-display">
                        <HandAnimation number={playerNumber} isAnimating={isAnimating} />
                    </div>
                </div>
                <div className="vs-badge">VS</div>
                <div className="hand-wrapper">
                    <div className="hand-label">Computer</div>
                    <div className="hand-display">
                        <HandAnimation number={computerNumber} isAnimating={isAnimating} />
                    </div>
                </div>
            </div>

            <div className="action-buttons">
                {[1, 2, 3, 4, 5, 6].map((num) => (
                    <button
                        key={num}
                        className="number-button"
                        onClick={() => handleNumberClick(num)}
                        disabled={isAnimating || isSettling || isOutPending}
                    >
                        <img src={numberImages[num - 1]} alt={num.toString()} />
                    </button>
                ))}
            </div>

            <div className="game-status">
                <p>
                    {isSettling
                        ? statusText
                        : currentBatter === 'player'
                            ? "You're batting!"
                            : 'Computer is batting'}
                </p>
            </div>
        </div>
    )
}