// src/App.tsx
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

// ─── Reusable Tailwind class strings ──────────────────────────────────────────
const NEON_BTN =
  'relative inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold tracking-widest uppercase text-sm ' +
  'bg-[#00ff88] text-[#030f06] ' +
  'shadow-[0_0_18px_#00ff8888,0_0_40px_#00ff8830] ' +
  'hover:shadow-[0_0_30px_#00ff88cc,0_0_60px_#00ff8860] ' +
  'hover:scale-105 active:scale-95 ' +
  'transition-all duration-200 ease-out ' +
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100'

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
          // Step 1 — find the Game object the user just created on-chain
          const gameChange = result.objectChanges?.find(
            (obj: any) => obj.objectType?.includes('::game::Game')
          ) as any

          if (!gameChange?.objectId) {
            alert('Game created on-chain but could not find game object. Please refresh.')
            return
          }

          const newGameId = gameChange.objectId as string

          // Step 2 — tell the backend to activate the game (lock treasury bet, move to TOSS)
          // The backend has GameCap; the frontend never needed it.
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

          // Step 3 — game is now STATUS_TOSS on-chain, proceed to toss phase
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

  const handleInningsSwitch = async (newTarget: number) => {
    if (!gameId) return
    setTargetScore(newTarget)
    try {
      const res = await fetch(`${BACKEND_URL}/api/switch-innings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_API_KEY,
        },
        body: JSON.stringify({ gameId }),
      })
      const result = await res.json()
      if (result.success) console.log('Innings switched. Digest:', result.digest)
    } catch (e) { console.error('Backend switch failed:', e) }
  }

  const handleEndGamePayout = async (_: boolean, pScore: number, cScore: number) => {
    if (!gameId) return
    setIsEndingGame(true)
    let isWinner = false
    try {
      const gameData = await suiClient.getObject({ id: gameId, options: { showContent: true } })
      isWinner = (gameData.data?.content as any).fields.winner === account?.address
    } catch {}
    try {
      const res = await fetch(`${BACKEND_URL}/api/end-game`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_API_KEY,
        },
        body: JSON.stringify({ gameId }),
      })
      const result = await res.json()
      if (result.success) {
        setGameResult({ playerWon: isWinner, playerScore: pScore, computerScore: cScore })
        setIsEndingGame(false)
        refetchBalance()
      }
    } catch {
      setIsEndingGame(false)
      setGameResult({ playerWon: isWinner, playerScore: pScore, computerScore: cScore })
    }
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

  // ── PvP handlers ────────────────────────────────────────────────────────
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

  // ════════════════════════════════════════════════════════════════════════════
  //  PvP screens
  // ════════════════════════════════════════════════════════════════════════════
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

  // ════════════════════════════════════════════════════════════════════════════
  //  Computer-mode game screen
  // ════════════════════════════════════════════════════════════════════════════
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
              <span
                className="text-xl sm:text-3xl select-none animate-bounce"
                style={{ animationDuration: '2s' }}
              >
                🏏
              </span>
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
                <div className="animate-fade-in">
                  {/* Win/Loss ambient glow */}
                  <div className={`absolute inset-0 pointer-events-none transition-opacity duration-700 ${
                    gameResult.playerWon
                      ? 'bg-[radial-gradient(ellipse_50%_40%_at_50%_50%,#00ff8815,transparent)]'
                      : 'bg-[radial-gradient(ellipse_50%_40%_at_50%_50%,#ff003315,transparent)]'
                  }`} />

                  <div className={`relative rounded-3xl border backdrop-blur-sm overflow-hidden shadow-2xl ${
                    gameResult.playerWon
                      ? 'border-[#00ff8840] bg-[#00ff8808] shadow-[0_0_80px_#00ff8825]'
                      : 'border-[#ff003340] bg-[#ff00330a] shadow-[0_0_80px_#ff003320]'
                  }`}>

                    {/* Shimmer bar */}
                    <div className={`h-1 w-full animate-pulse ${
                      gameResult.playerWon
                        ? 'bg-gradient-to-r from-transparent via-[#00ff88] to-transparent'
                        : 'bg-gradient-to-r from-transparent via-[#ff4444] to-transparent'
                    }`} />

                    <div className="p-5 sm:p-10 text-center space-y-5 sm:space-y-8">

                      {/* Trophy / skull */}
                      <div
                        className="text-5xl sm:text-7xl select-none"
                        style={{
                          filter: gameResult.playerWon
                            ? 'drop-shadow(0 0 20px #00ff8888)'
                            : 'drop-shadow(0 0 20px #ff444488)',
                          animation: 'pulse 2s ease-in-out infinite',
                        }}
                      >
                        {isEndingGame ? '⏳' : gameResult.playerWon ? '🏆' : '💀'}
                      </div>

                      {/* Title */}
                      <div className="space-y-1">
                        <p className={`text-[10px] sm:text-xs tracking-[0.4em] uppercase font-semibold ${
                          gameResult.playerWon ? 'text-[#00ff8880]' : 'text-[#ff444480]'
                        }`}>
                          {isEndingGame ? 'Processing' : gameResult.playerWon ? 'Victory' : 'Defeated'}
                        </p>
                        <h2
                          className={`text-2xl sm:text-4xl font-black tracking-tight ${
                            gameResult.playerWon ? 'text-[#00ff88]' : 'text-[#ff4444]'
                          }`}
                          style={{ fontFamily: 'Orbitron, monospace' }}
                        >
                          {isEndingGame
                            ? 'Processing Payout…'
                            : gameResult.playerWon
                              ? 'LEGENDARY!'
                              : 'GAME OVER'}
                        </h2>
                      </div>

                      {/* Score cards */}
                      <div className="grid grid-cols-3 gap-2 sm:gap-4 items-center">
                        {/* Player */}
                        <div className="rounded-xl sm:rounded-2xl border border-[#00ff8830] bg-[#00ff8810]
                          p-3 sm:p-6 flex flex-col items-center gap-1 sm:gap-2">
                          <span className="text-[9px] sm:text-xs tracking-[0.2em] text-[#00ff8870] uppercase font-semibold">You</span>
                          <span
                            className="text-2xl sm:text-5xl font-black text-[#00ff88] tabular-nums"
                            style={{ fontFamily: 'Orbitron, monospace' }}
                          >
                            {gameResult.playerScore}
                          </span>
                          <span className="text-[9px] sm:text-[10px] text-[#ffffff30] uppercase tracking-widest">runs</span>
                        </div>

                        {/* VS */}
                        <div className="flex flex-col items-center gap-1">
                          <div className="w-6 sm:w-8 h-px bg-[#ffffff20]" />
                          <span className="text-[10px] sm:text-sm font-black text-[#ffffff30] tracking-widest">VS</span>
                          <div className="w-6 sm:w-8 h-px bg-[#ffffff20]" />
                        </div>

                        {/* CPU */}
                        <div className="rounded-xl sm:rounded-2xl border border-[#ff444430] bg-[#ff444410]
                          p-3 sm:p-6 flex flex-col items-center gap-1 sm:gap-2">
                          <span className="text-[9px] sm:text-xs tracking-[0.2em] text-[#ff444470] uppercase font-semibold">CPU</span>
                          <span
                            className="text-2xl sm:text-5xl font-black text-[#ff4444] tabular-nums"
                            style={{ fontFamily: 'Orbitron, monospace' }}
                          >
                            {gameResult.computerScore}
                          </span>
                          <span className="text-[9px] sm:text-[10px] text-[#ffffff30] uppercase tracking-widest">runs</span>
                        </div>
                      </div>

                      {/* Payout message */}
                      <p className="text-[#ffffff60] text-xs sm:text-base leading-relaxed max-w-xs mx-auto">
                        {gameResult.playerWon
                          ? '✨ Amazing play! Your 0.2 OCT winnings are heading to your wallet.'
                          : '😤 Better luck next time! Get back out there and reclaim your OCT.'}
                      </p>

                      {/* Play again */}
                      <button
                        onClick={resetCpuGame}
                        disabled={isEndingGame}
                        className={NEON_BTN + ' w-full sm:w-auto sm:px-10 py-3 sm:py-4 text-sm sm:text-base'}
                        style={{ fontFamily: 'Exo 2, sans-serif' }}
                      >
                        <span className="text-lg">🏏</span>
                        Play Again
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

  // ════════════════════════════════════════════════════════════════════════════
  //  Home screen
  // ════════════════════════════════════════════════════════════════════════════
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