import { useState } from 'react'
import { useDisconnectWallet } from '@mysten/dapp-kit'
import ConnectModal from '../components/wallet/ConnectModal'

interface HomePageProps {
  account: { address: string } | null
  balance: number
  balanceLoading: boolean
  onCreateGame: () => void
  onPvPSelected: () => void
  isCreatingGame?: boolean
}

// ─── Button styles ────────────────────────────────────────────────────────────
const CONNECT_BTN =
  'relative w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-2xl ' +
  'font-bold tracking-wider uppercase text-sm select-none ' +
  'bg-[#00ff88] text-[#030f06] ' +
  'shadow-[0_0_12px_#00ff8850,inset_0_1px_0_#ffffff30] ' +
  'hover:shadow-[0_0_20px_#00ff8870,inset_0_1px_0_#ffffff40] ' +
  'hover:-translate-y-0.5 active:scale-95 ' +
  'transition-all duration-200 ease-out'

const NEON_BTN =
  'relative w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-2xl ' +
  'font-bold tracking-wider uppercase text-sm select-none ' +
  'bg-[#00ff88] text-[#030f06] ' +
  'shadow-[0_0_10px_#00ff8840] ' +
  'hover:shadow-[0_0_18px_#00ff8860] ' +
  'hover:-translate-y-0.5 active:scale-95 ' +
  'transition-all duration-200 ease-out ' +
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none'

const PVP_BTN =
  'relative w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-2xl ' +
  'font-bold tracking-wider uppercase text-sm select-none ' +
  'bg-gradient-to-r from-[#7c3aed] to-[#4f46e5] text-white ' +
  'shadow-[0_0_10px_#7c3aed40] ' +
  'hover:shadow-[0_0_18px_#7c3aed60] ' +
  'hover:-translate-y-0.5 active:scale-95 ' +
  'transition-all duration-200 ease-out ' +
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none'

// ─── Game rules ───────────────────────────────────────────────────────────────
const RULES = [
  { icon: '🎯', text: 'Bet 0.1 OCT per game' },
  { icon: '🏏', text: 'Choose numbers 1–6 each round' },
  { icon: '⚡', text: "Same number = You're OUT!" },
  { icon: '💰', text: 'Win = Get 0.2 OCT back' },
]

export default function HomePage({
  account,
  balance,
  balanceLoading,
  onCreateGame,
  onPvPSelected,
  isCreatingGame = false,
}: HomePageProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const { mutate: disconnect } = useDisconnectWallet()

  const octBalance   = balance ?? 0
  const lowBalance   = octBalance < 0.1
  const shortAddress = account
    ? `${account.address.slice(0, 6)}...${account.address.slice(-4)}`
    : ''

  return (
    <>
      <ConnectModal open={modalOpen} onClose={() => setModalOpen(false)} />

      {/* ── Full-viewport shell — NO scroll ──────────────────────────── */}
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
        <div className="absolute top-1/3 right-6 w-2 h-2 rounded-full bg-[#00ff88] opacity-15 animate-ping" style={{ animationDuration: '4.8s', animationDelay: '1s' }} />
        <div className="absolute bottom-24 left-10 w-2 h-2 rounded-full bg-[#00ff88] opacity-15 animate-ping" style={{ animationDuration: '3.6s', animationDelay: '0.5s' }} />

        {/* ── Card — compact so it always fits in viewport ─────────── */}
        <div
          className="relative z-10 w-full max-w-sm
            bg-[#071a0c] rounded-3xl overflow-hidden
            border border-[#00ff8822]
            shadow-[0_0_0_1px_#00ff8810,0_24px_80px_rgba(0,0,0,0.85),0_0_80px_#00ff8808_inset]
            animate-[fadeUp_0.5s_cubic-bezier(0.16,1,0.3,1)_both]"
        >
          {/* Shimmer top bar */}
          <div className="absolute top-0 left-0 right-0 h-[2px] animate-pulse
            bg-gradient-to-r from-transparent via-[#00ff88] to-transparent" />

          <div className="px-5 py-5 sm:px-7 sm:py-6 space-y-4">

            {/* ── Brand ─────────────────────────────────────────────── */}
            <div className="text-center space-y-1">
              <h1
                className="text-3xl font-black text-[#00ff88] tracking-tight leading-tight flex items-center justify-center gap-2"
                style={{
                  fontFamily: 'Orbitron, monospace',
                  textShadow: '0 0 24px #00ff8860, 0 0 60px #00ff8820',
                }}
              >
                <span
  className="text-3xl select-none inline-block"
  style={{ filter: 'drop-shadow(0 0 14px #00ff8888)' }}
>
  🏏
</span>
                Hand Cricket
              </h1>
              <p className="text-[10px] tracking-[0.28em] text-[#ffffff30] uppercase font-medium">
                Play against the house or challenge a friend
              </p>
            </div>

            {/* Divider */}
            <div className="h-px bg-gradient-to-r from-transparent via-[#00ff8830] to-transparent" />

            {/* ── Wallet section ─────────────────────────────────────── */}
            {!account ? (
              /* ── NOT CONNECTED ───────────────────────────────────── */
              <div className="space-y-3">
                <div className="text-center space-y-0.5">
                  <p className="text-white/80 text-sm font-medium">Connect your Sui wallet to play</p>
                  <p className="text-white/30 text-[11px]">Slippage-free, on-chain hand cricket</p>
                </div>

                {/* CONNECT BUTTON */}
                <button
                  onClick={() => setModalOpen(true)}
                  className={CONNECT_BTN}
                  style={{ fontFamily: 'Exo 2, sans-serif' }}
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                    <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                  </svg>
                  Connect Wallet
                </button>

                <p className="text-center text-[10px] tracking-[0.2em] text-[#ffffff20] uppercase">
                  Powered by <span className="text-[#00ff8840]">Sui Network</span>
                </p>
              </div>
            ) : (
              /* ── CONNECTED ───────────────────────────────────────── */
              <div className="space-y-3">

                {/* Wallet info row + disconnect */}
                <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-[#00ff8808] border border-[#00ff8820]">
                  {/* Avatar */}
                  <div className="w-8 h-8 shrink-0 rounded-xl bg-[#00ff8815] border border-[#00ff8840]
                    flex items-center justify-center text-sm select-none">
                    🦊
                  </div>

                  {/* Address */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-[#00ff8870] font-semibold tracking-wide uppercase mb-0.5">
                      Connected
                    </p>
                    <p className="text-white/60 text-[11px] font-mono truncate">{shortAddress}</p>
                  </div>

                  {/* Balance */}
                  <div className="shrink-0 text-right mr-1">
                    <p
                      className="text-[#00ff88] font-black text-base tabular-nums leading-tight"
                      style={{ fontFamily: 'Orbitron, monospace', textShadow: '0 0 12px #00ff8860' }}
                    >
                      {balanceLoading
                        ? <span className="text-[#00ff8850] text-sm animate-pulse">···</span>
                        : octBalance.toFixed(2)
                      }
                    </p>
                    <p className="text-[9px] text-[#00ff8860] font-semibold">OCT</p>
                  </div>

                  {/* Disconnect button — plain text ✕ */}
                  <button
                    onClick={() => disconnect()}
                    title="Disconnect wallet"
                    className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center
                      text-white/25 text-base leading-none font-light
                      hover:text-[#ff4444] hover:bg-[#ff444412]
                      transition-all duration-200"
                  >
                    ✕
                  </button>
                </div>

                {/* Low balance warning */}
                {!balanceLoading && lowBalance && (
                  <div className="flex items-start gap-2 p-2.5 rounded-xl
                    bg-[#ff440010] border border-[#ff444025] text-[#ff6666] text-xs leading-relaxed">
                    <span className="shrink-0 mt-0.5">⚠️</span>
                    <span>Need at least <strong>0.1 OCT</strong> to play. Top up and refresh.</span>
                  </div>
                )}

                {/* How to play */}
                <div className="rounded-2xl bg-[#00ff8806] border border-[#00ff8818] px-4 py-3">
                  <p
                    className="text-[9px] tracking-[0.3em] text-[#00ff8880] uppercase font-semibold mb-2.5 text-center"
                    style={{ fontFamily: 'Orbitron, monospace' }}
                  >
                    How to Play
                  </p>
                  <ul className="space-y-1.5">
                    {RULES.map(({ icon, text }) => (
                      <li key={text} className="flex items-center gap-2 text-xs text-white/65">
                        <span className="text-sm shrink-0 w-5 text-center">{icon}</span>
                        <span>{text}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Game mode buttons */}
                <div className="space-y-2.5">
                  <button
                    onClick={onCreateGame}
                    disabled={lowBalance || isCreatingGame}
                    className={NEON_BTN}
                    style={{ fontFamily: 'Exo 2, sans-serif' }}
                  >
                    {isCreatingGame ? (
                      <>
                        <svg className="w-4 h-4 animate-spin shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                        </svg>
                        Creating Game…
                      </>
                    ) : (
                      <>
                        <span className="text-base shrink-0">🤖</span>
                        <span className="flex-1 text-left">vs Computer</span>
                        <span className="text-[#030f0660] font-semibold text-[11px] tracking-wider shrink-0">0.1 OCT</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={onPvPSelected}
                    disabled={lowBalance}
                    className={PVP_BTN}
                    style={{ fontFamily: 'Exo 2, sans-serif' }}
                  >
                    <span className="text-base shrink-0">🆚</span>
                    <span className="flex-1 text-left">vs Player</span>
                    <span className="text-white/35 font-semibold text-[11px] tracking-wider shrink-0">0.1 OCT</span>
                  </button>
                </div>

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
  )
}