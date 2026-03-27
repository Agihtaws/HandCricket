import {
  useCurrentAccount,
  useSuiClientQuery,
  useSignAndExecuteTransaction,
  useSuiClient,
} from '@mysten/dapp-kit'
import { useState } from 'react'
import './App.css'

import TossPhase    from './components/game/TossPhase'
import GamePlay     from './components/game/GamePlay'
import PvPLobby     from './components/pvp/PvPLobby'
import PvPToss      from './components/pvp/PvPToss'
import PvPGamePlay  from './components/pvp/PvPGamePlay'
import HomePage     from './pages/HomePage'

import { createGameTx } from './utils/transactions'
import { BACKEND_URL }  from './utils/constants'

// ─── App-level phases ─────────────────────────────────────────────────────────
type AppPhase =
  | 'home'
  | 'vs-cpu'
  | 'pvp-lobby'
  | 'pvp-toss'
  | 'pvp-gameplay'

interface PvPState {
  gameId:        string
  isPlayer1:     boolean
  currentBatter: 'p1' | 'p2'
  p1Address:     string
  p2Address:     string
}


const GHOST_BTN =
  'inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm ' +
  'border border-[#00ff8844] text-[#00ff88] ' +
  'hover:border-[#00ff88] hover:bg-[#00ff8812] ' +
  'transition-all duration-200'

const FIELD_BG =
  'min-h-screen w-full bg-[#030f06] relative overflow-hidden ' +
  'before:absolute before:inset-0 before:bg-[radial-gradient(ellipse_80%_60%_at_50%_100%,#0d3318_0%,transparent_70%)] ' +
  'after:absolute after:inset-0 after:bg-[url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%2300ff88\' fill-opacity=\'0.03\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")] ' +
  'after:opacity-40'

// ─────────────────────────────────────────────────────────────────────────────

function App() {
  const account                    = useCurrentAccount()
  const suiClient                  = useSuiClient()
  const { mutate: signAndExecute } = useSignAndExecuteTransaction({
    execute: async ({ bytes, signature }) =>
      suiClient.executeTransactionBlock({
        transactionBlock: bytes,
        signature,
        options: { showObjectChanges: true },
      }),
  })

  const [phase, setPhase] = useState<AppPhase>('home')
  const [pvp,   setPvp]   = useState<PvPState | null>(null)

  const [gameId,         setGameId]         = useState<string | null>(null)
  const [isCreatingGame, setIsCreatingGame] = useState(false)
  const [isEndingGame,   setIsEndingGame]   = useState(false)
  const [targetScore,    setTargetScore]    = useState<number>(0)
  const [tossComplete,   setTossComplete]   = useState(false)
  const [playerBats,     setPlayerBats]     = useState(false)
  const [gameResult,     setGameResult]     = useState<{
    playerWon: boolean; playerScore: number; computerScore: number
  } | null>(null)
  const [fatalError, setFatalError] = useState<string | null>(null)

  // ── Balance ─────────────────────────────────────────────────────────────
  const { data: balance, isLoading: balanceLoading, refetch: refetchBalance } =
    useSuiClientQuery(
      'getBalance',
      { owner: account?.address ?? '' },
      { enabled: !!account }
    )

  const octBalance = balance ? Number(balance.totalBalance) / 1_000_000_000 : 0

  // ── Computer-mode handlers ───────────────────────────────────────────────
  const handleCreateGame = () => {
    setIsCreatingGame(true)
    const tx = createGameTx()

    signAndExecute({ transaction: tx }, {
      onSuccess: async (result) => {
        try {
          const gameChange = result.objectChanges?.find(
            (obj: any) => obj.objectType?.includes('::game::Game')
          ) as any

          if (!gameChange?.objectId) {
            alert('Game created on-chain but could not find game object. Please refresh.')
            return
          }

          const newGameId = gameChange.objectId as string

          const activateRes = await fetch(`${BACKEND_URL}/api/activate-game`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': import.meta.env.VITE_API_KEY,
            },
            body: JSON.stringify({ gameId: newGameId }),
          })

          const activateData = await activateRes.json()

          if (!activateRes.ok || !activateData.success) {
            console.error('activate-game failed:', activateData)
            alert('Game was created but backend failed to activate it. Please contact support.')
            return
          }

          setGameId(newGameId)
          setPhase('vs-cpu')
        } finally {
          setIsCreatingGame(false)
        }
      },
      onError: () => {
        setIsCreatingGame(false)
        alert('Transaction rejected or failed.')
      },
    })
  }

 
  const handleInningsSwitch = (newTarget: number) => {
    setTargetScore(newTarget)
    // no fetch here
  }


  const handleEndGamePayout = (playerWon: boolean, playerScore: number, computerScore: number) => {
    setIsEndingGame(true)
    setGameResult({ playerWon, playerScore, computerScore })
    setIsEndingGame(false)
    refetchBalance()
  }

  const handleForfeit = async () => {
    if (!gameId) { resetCpuGame(); return }
    try {
      await fetch(`${BACKEND_URL}/api/forfeit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_API_KEY,
        },
        body: JSON.stringify({ gameId }),
      })
    } finally { resetCpuGame() }
  }

  const handleFatalError = (message: string) => {
    setFatalError(message)
    setTimeout(resetCpuGame, 3000)
  }

  const resetCpuGame = () => {
    setGameId(null); setTossComplete(false); setPlayerBats(false)
    setGameResult(null); setTargetScore(0); setFatalError(null)
    setPhase('home')
  }

  // ── PvP handlers ───────────────────────────────────────────────
  const handlePvPLobbyStart = ({ gameId: gId, isPlayer1 }: { gameId: string; isPlayer1: boolean }) => {
    setPvp({ gameId: gId, isPlayer1, currentBatter: 'p1', p1Address: '', p2Address: '' })
    setPhase('pvp-toss')
  }

  const handlePvPTossComplete = ({ currentBatter, p1Address, p2Address }: {
    currentBatter: 'p1' | 'p2'; p1Address: string; p2Address: string
  }) => {
    setPvp(prev => prev ? { ...prev, currentBatter, p1Address, p2Address } : prev)
    setPhase('pvp-gameplay')
  }

  const handlePvPGameOver = () => { setPvp(null); setPhase('home'); refetchBalance() }
  const handlePvPBack     = () => { setPvp(null); setPhase('home') }

  if (phase === 'pvp-lobby')
    return <PvPLobby onGameStart={handlePvPLobbyStart} onBack={handlePvPBack} />

  if (phase === 'pvp-toss' && pvp)
    return (
      <PvPToss
        gameId={pvp.gameId}
        isPlayer1={pvp.isPlayer1}
        onGameStart={handlePvPTossComplete}
        onBack={handlePvPBack}
      />
    )

  if (phase === 'pvp-gameplay' && pvp)
    return (
      <PvPGamePlay
        gameId={pvp.gameId}
        isPlayer1={pvp.isPlayer1}
        p1Address={pvp.p1Address}
        p2Address={pvp.p2Address}
        currentBatter={pvp.currentBatter}
        onGameOver={handlePvPGameOver}
        onBack={handlePvPBack}
      />
    )


  if (phase === 'vs-cpu' && gameId) {
    return (
      <div className={FIELD_BG}>
        {/* Pitch glow at bottom */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2
          w-[300px] h-[160px] sm:w-[520px] sm:h-[260px]
          rounded-full bg-[#00ff8806] blur-3xl pointer-events-none" />

        {/* Floating ping dots */}
        <div className="absolute top-10 left-6 w-3 h-3 rounded-full bg-[#00ff88] opacity-30 animate-ping" style={{ animationDuration: '3s' }} />
        <div className="absolute top-32 right-8 w-2 h-2 rounded-full bg-[#00ff88] opacity-20 animate-ping" style={{ animationDuration: '4.5s', animationDelay: '1s' }} />
        <div className="absolute bottom-20 left-12 w-2 h-2 rounded-full bg-[#00ff88] opacity-20 animate-ping" style={{ animationDuration: '3.8s', animationDelay: '0.5s' }} />

        <div className="relative z-10 flex flex-col min-h-screen">

          {/* ── Header ───────────────────────────────────────────────────── */}
          <header className="flex items-center justify-between
            px-4 sm:px-8 py-3 sm:py-4
            border-b border-[#00ff8820] backdrop-blur-sm bg-[#030f0680]
            sticky top-0 z-50">

            {/* Logo */}
            <div className="flex items-center gap-2 sm:gap-3">
              🏏
              <div className="hidden sm:block">
                <p className="text-[10px] tracking-[0.3em] text-[#00ff8880] uppercase font-semibold">Hand Cricket</p>
                <p className="text-[8px] tracking-[0.2em] text-[#ffffff30] uppercase">vs CPU</p>
              </div>
              {/* Mobile-only label */}
              <span className="sm:hidden text-[10px] tracking-[0.25em] text-[#00ff8870] uppercase font-semibold">
                vs CPU
              </span>
            </div>

            {/* Balance */}
            <div className="flex items-center gap-1.5 sm:gap-2
              px-2.5 py-1.5 sm:px-4 sm:py-2
              rounded-full border border-[#00ff8840] bg-[#00ff8808]">
              <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#00ff88] animate-pulse" />
              <span
                className="text-[#00ff88] font-bold text-xs sm:text-base tabular-nums"
                style={{ fontFamily: 'Orbitron, monospace' }}
              >
                {octBalance.toFixed(2)}
              </span>
              <span className="text-[#00ff8870] text-[10px] sm:text-xs font-semibold">OCT</span>
            </div>

            {/* Forfeit */}
            <button onClick={handleForfeit} className={GHOST_BTN + ' text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2'}>
              <span className="hidden sm:inline">← Forfeit</span>
              <span className="sm:hidden font-bold">✕</span>
            </button>
          </header>

          {/* ── Game area ────────────────────────────────────────────────── */}
          <main className="flex-1 flex items-center justify-center px-4 py-6 sm:py-10">
            <div className="w-full max-w-sm sm:max-w-lg xl:max-w-2xl">

              {/* Fatal error */}
              {fatalError && (
                <div className="animate-fade-in text-center space-y-5 p-6 sm:p-8 rounded-2xl
                  border border-red-500/30 bg-red-950/30 backdrop-blur-sm">
                  <div className="text-5xl">⚠️</div>
                  <p className="text-red-400 font-semibold text-base sm:text-lg">{fatalError}</p>
                  <p className="text-[#ffffff40] text-sm">Returning to home…</p>
                  <div className="h-1 w-full rounded-full bg-[#ffffff10] overflow-hidden">
                    <div className="h-full bg-red-500 rounded-full animate-[shrink_3s_linear_forwards]" />
                  </div>
                </div>
              )}

              {/* Toss */}
              {!fatalError && !tossComplete && (
                <div className="animate-fade-in">
                  <div className="mb-5 sm:mb-6 text-center space-y-1">
                    <p className="text-[10px] sm:text-xs tracking-[0.3em] text-[#00ff8870] uppercase font-semibold">Round 1</p>
                    <h2 className="text-xl sm:text-3xl font-black text-white tracking-tight"
                      style={{ fontFamily: 'Orbitron, monospace' }}>
                      The <span className="text-[#00ff88]">Toss</span>
                    </h2>
                  </div>
                  <div className="rounded-2xl border border-[#00ff8825] bg-[#00ff8806] backdrop-blur-sm p-4 sm:p-6 shadow-[0_0_60px_#00ff8808]">
                    <TossPhase
                      gameId={gameId}
                      onTossComplete={(playerBatsFirst) => {
                        setPlayerBats(playerBatsFirst)
                        setTossComplete(true)
                      }}
                      onError={(msg) => { alert(`Toss error: ${msg}`); resetCpuGame() }}
                    />
                  </div>
                </div>
              )}

              {/* Gameplay */}
              {!fatalError && tossComplete && gameResult === null && (
                <div className="animate-fade-in">
                  <div className="mb-5 sm:mb-6 text-center space-y-1">
                    <p className="text-[10px] sm:text-xs tracking-[0.3em] text-[#00ff8870] uppercase font-semibold">
                      {playerBats ? '🏏 You\'re Batting' : '🎯 You\'re Bowling'}
                    </p>
                    <h2 className="text-xl sm:text-3xl font-black text-white tracking-tight"
                      style={{ fontFamily: 'Orbitron, monospace' }}>
                      {targetScore > 0
                        ? <>Target: <span className="text-[#00ff88]">{targetScore + 1}</span></>
                        : <>Set a <span className="text-[#00ff88]">Score</span></>
                      }
                    </h2>
                  </div>
                  <div className="rounded-2xl border border-[#00ff8825] bg-[#00ff8806] backdrop-blur-sm p-4 sm:p-6 shadow-[0_0_60px_#00ff8808]">
                    <GamePlay
                      gameId={gameId}
                      playerBats={playerBats}
                      targetScore={targetScore}
                      onInningsComplete={handleInningsSwitch}
                      onGameEnd={handleEndGamePayout}
                      onFatalError={handleFatalError}
                    />
                  </div>
                </div>
              )}

              {/* Result screen */}
{!fatalError && gameResult !== null && (
  <div className="animate-fade-in w-full max-w-md mx-auto">
    <div className={`rounded-2xl border backdrop-blur-sm overflow-hidden shadow-lg ${
      gameResult.playerWon
        ? 'border-[#00ff8840] bg-[#00ff8808]'
        : 'border-[#ff444440] bg-[#ff444408]'
    }`}>
      {/* Thin accent line */}
      <div className={`h-0.5 w-full ${gameResult.playerWon ? 'bg-[#00ff88]' : 'bg-[#ff4444]'}`} />

      <div className="p-5 sm:p-6 text-center space-y-4">
        {/* Trophy / skull icon */}
        <div className="text-4xl sm:text-5xl select-none">
          {isEndingGame ? '⏳' : gameResult.playerWon ? '🏆' : '💀'}
        </div>

        {/* Title */}
        <div>
          <h2
            className={`text-xl sm:text-2xl font-bold tracking-tight ${
              gameResult.playerWon ? 'text-[#00ff88]' : 'text-[#ff4444]'
            }`}
            style={{ fontFamily: 'Orbitron, monospace' }}
          >
            {isEndingGame
              ? 'Processing...'
              : gameResult.playerWon
                ? 'VICTORY!'
                : 'DEFEATED'}
          </h2>
          <p className="text-xs text-white/50 mt-1">
            {isEndingGame ? 'Payout in progress' : gameResult.playerWon ? 'You won the match!' : 'Better luck next time'}
          </p>
        </div>

        {/* Score display */}
        <div className="flex justify-center gap-4 sm:gap-6">
          <div className="text-center">
            <div className="text-2xl sm:text-3xl font-black text-white tabular-nums">
              {gameResult.playerScore}
            </div>
            <div className="text-[10px] text-white/40 uppercase tracking-wider">You</div>
          </div>
          <div className="flex flex-col items-center justify-center">
            <div className="text-xs text-white/30 font-bold">VS</div>
          </div>
          <div className="text-center">
            <div className="text-2xl sm:text-3xl font-black text-white/70 tabular-nums">
              {gameResult.computerScore}
            </div>
            <div className="text-[10px] text-white/40 uppercase tracking-wider">CPU</div>
          </div>
        </div>

        {/* Payout message (only for win) */}
        {gameResult.playerWon && !isEndingGame && (
          <p className="text-xs text-[#00ff88]/70 leading-relaxed">
            +0.2 OCT added to your wallet
          </p>
        )}

        {/* Play again button */}
        <button
          onClick={resetCpuGame}
          disabled={isEndingGame}
          className="mt-2 px-5 py-2 rounded-full bg-[#00ff88] text-[#030f06] font-bold text-sm hover:shadow-[0_0_20px_#00ff88] transition-all duration-200 disabled:opacity-50"
        >
          🏏 Play Again
        </button>
      </div>
    </div>
  </div>
)}
            </div>
          </main>

          {/* ── Footer ───────────────────────────────────────────────────── */}
          <footer className="text-center py-3 border-t border-[#00ff8810]">
            <p className="text-[10px] tracking-[0.3em] text-[#ffffff20] uppercase">
              Hand Cricket • Powered by Sui
            </p>
          </footer>
        </div>

        {/* Keyframes */}
        <style>{`
          @keyframes fade-in {
            from { opacity: 0; transform: translateY(16px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes shrink {
            from { width: 100%; }
            to   { width: 0%; }
          }
          .animate-fade-in {
            animation: fade-in 0.45s cubic-bezier(0.16,1,0.3,1) both;
          }
        `}</style>
      </div>
    )
  }


  //  Home screen

  return (
    <div className={`app ${account ? 'wallet-connected' : ''}`}>
      <HomePage
        account={account}
        balance={octBalance}
        balanceLoading={balanceLoading}
        onCreateGame={handleCreateGame}
        onPvPSelected={() => setPhase('pvp-lobby')}
        isCreatingGame={isCreatingGame}
      />
    </div>
  )
}

export default App