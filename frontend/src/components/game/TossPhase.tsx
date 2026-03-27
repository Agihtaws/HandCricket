import { useState } from 'react'
import HandAnimation from '../HandAnimation'
import './TossPhase.css'
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

export default function TossPhase({ gameId, onTossComplete, onError }: TossPhaseProps) {
    const [stage, setStage]                     = useState<TossStage>('choose-odd-even');
    const [playerChoice, setPlayerChoice]       = useState<'odd' | 'even' | null>(null);
    const [playerTossNumber, setPlayerTossNumber] = useState<number | null>(null);
    const [computerTossNumber, setComputerTossNumber] = useState<number | null>(null);
    const [isAnimating, setIsAnimating]         = useState(false);
    const [playerWonToss, setPlayerWonToss]     = useState(false);
    const [sumIsOdd, setSumIsOdd]               = useState(false);
    const [isResolving, setIsResolving]         = useState(false);

    function handleOddEvenChoice(choice: 'odd' | 'even') {
        setPlayerChoice(choice);
        setStage('choose-number');
    }

    async function handleNumberChoice(num: number) {
        if (isAnimating || isResolving) return;
        setIsAnimating(true);
        setPlayerTossNumber(num);

        try {
            // Call the new toss endpoint to get the computer's number and outcome
            const response = await fetch(`${BACKEND_URL}/api/toss`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
                body: JSON.stringify({
                    playerTossNumber: num,
                    isOdd: playerChoice === 'odd',
                }),
            });
            const result = await response.json();
            if (!result.computerTossNumber) throw new Error('Invalid toss response');

            setComputerTossNumber(result.computerTossNumber);
            setPlayerWonToss(result.playerWon);
            setSumIsOdd(result.sumIsOdd);
        } catch (err: any) {
            setIsAnimating(false);
            onError('Toss failed. Please check your connection and try again.');
            return;
        }

        // Short delay for animation
        setTimeout(() => {
            setIsAnimating(false);
            setStage('reveal');
        }, 1200);
    }

    async function handleFinalTossSettlement(chooseBat: boolean) {
        if (isResolving) return;
        setIsResolving(true);
        try {
            const response = await fetch(`${BACKEND_URL}/api/resolve-toss`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
                body: JSON.stringify({
                    gameId,
                    isOdd:            playerChoice === 'odd',
                    playerTossNumber: playerTossNumber ?? 0,
                    computerTossNumber,
                    playerChoosesBat: chooseBat,
                }),
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.error);
            onTossComplete(chooseBat);
        } catch (err: any) {
            setIsResolving(false);
            onError('Blockchain sync failed. Please try again.');
        }
    }

    const sum = (playerTossNumber ?? 0) + (computerTossNumber ?? 0);

    return (
        <div className="toss-phase">
            {stage === 'choose-odd-even' && (
                <div className="toss-stage">
                    <h2 className="toss-title">🎲 Toss Time!</h2>
                    <p className="toss-instruction">First, pick Odd or Even</p>
                    <div className="choice-buttons">
                        <button className="choice-button odd-button" onClick={() => handleOddEvenChoice('odd')}>ODD</button>
                        <button className="choice-button even-button" onClick={() => handleOddEvenChoice('even')}>EVEN</button>
                    </div>
                </div>
            )}

            {stage === 'choose-number' && (
                <div className="toss-stage">
                    <h2 className="toss-title">Pick a Number</h2>
                    <p className="toss-instruction">You chose <strong>{playerChoice?.toUpperCase()}</strong>. Now pick your toss number:</p>
                    <div className="toss-number-grid">
                        {[1, 2, 3, 4, 5, 6].map((num) => (
                            <button
                                key={num}
                                className="toss-num-btn"
                                disabled={isAnimating || isResolving}
                                onClick={() => handleNumberChoice(num)}
                            >
                                <img src={numberImages[num - 1]} alt={num.toString()} />
                            </button>
                        ))}
                    </div>
                    {isAnimating && <p className="toss-instruction">Tossing...</p>}
                </div>
            )}

            {stage === 'reveal' && (
                <div className="toss-stage reveal-stage">
                    <h2 className="toss-title">{playerWonToss ? '🎉 You Won!' : '😔 CPU Won!'}</h2>

                    <div className="toss-hands-container">
                        <div className="toss-hand-wrapper">
                            <div className="toss-hand-label">You ({playerChoice})</div>
                            <div className="toss-hand-display">
                                <HandAnimation number={playerTossNumber} isAnimating={false} />
                            </div>
                        </div>
                        <div className="toss-vs">VS</div>
                        <div className="toss-hand-wrapper">
                            <div className="toss-hand-label">Computer</div>
                            <div className="toss-hand-display">
                                <HandAnimation number={computerTossNumber} isAnimating={false} />
                            </div>
                        </div>
                    </div>

                    <div className="calculation-area">
                        <div className="calc-row">
                            <span>{playerTossNumber}</span>
                            <span>+</span>
                            <span>{computerTossNumber}</span>
                            <span>=</span>
                            <span className="sum-val">{sum}</span>
                        </div>
                        <p className="sum-type">It's {sumIsOdd ? '🔴 ODD' : '🔵 EVEN'}</p>
                        <button className="continue-button" onClick={() => setStage('choose-bat-bowl')}>
                            Next →
                        </button>
                    </div>
                </div>
            )}

            {stage === 'choose-bat-bowl' && (
                <div className="toss-stage">
                    <h2 className="toss-title">{playerWonToss ? 'Your Choice!' : 'Computer Decides...'}</h2>
                    {playerWonToss ? (
                        <div className="choice-buttons">
                            <button
                                className="choice-button bat-button"
                                disabled={isResolving}
                                onClick={() => handleFinalTossSettlement(true)}
                            >
                                {isResolving ? 'Syncing...' : '🏏 BAT'}
                            </button>
                            <button
                                className="choice-button bowl-button"
                                disabled={isResolving}
                                onClick={() => handleFinalTossSettlement(false)}
                            >
                                {isResolving ? 'Syncing...' : '⚾ BOWL'}
                            </button>
                        </div>
                    ) : (
                        <div className="auto-choice">
                            <p>Computer chose to Bat first!</p>
                            <button
                                className="continue-button"
                                disabled={isResolving}
                                onClick={() => handleFinalTossSettlement(false)}
                            >
                                {isResolving ? 'Syncing...' : 'Start Game'}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}