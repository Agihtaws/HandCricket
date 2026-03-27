// src/components/wallet/ConnectModal.tsx
// Uses @mysten/dapp-kit (NOT @mysten/dapp-kit-react)
// Matches the user's main.tsx: WalletProvider + SuiClientProvider setup

import { useState, useEffect } from 'react'
import { useWallets, useConnectWallet } from '@mysten/dapp-kit'

// ─── Types ────────────────────────────────────────────────────────────────────
type ModalState = 'idle' | 'connecting' | 'error' | 'cancelled'

interface ConnectModalProps {
  open: boolean
  onClose: () => void
}

// ─── Wallet icon with fallback ────────────────────────────────────────────────
function WalletIcon({ icon, name }: { icon?: string; name: string }) {
  if (icon) {
    return (
      <img
        src={icon}
        alt={name}
        className="w-10 h-10 rounded-xl object-contain"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  return (
    <div className="w-10 h-10 rounded-xl bg-[#00ff8815] border border-[#00ff8840]
      flex items-center justify-center text-[#00ff88] font-black text-lg select-none">
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export default function ConnectModal({ open, onClose }: ConnectModalProps) {
  const wallets = useWallets()
  const { mutate: connectWallet } = useConnectWallet()

  const [modalState,       setModalState]       = useState<ModalState>('idle')
  const [connectingWallet, setConnectingWallet] = useState<string | null>(null)
  const [errorMessage,     setErrorMessage]     = useState<string>('')
  const [visible,          setVisible]          = useState(false)

  // ── Animate in / out ────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setVisible(true)
      setModalState('idle')
      setConnectingWallet(null)
      setErrorMessage('')
    } else {
      const t = setTimeout(() => setVisible(false), 300)
      return () => clearTimeout(t)
    }
  }, [open])

  // ── Close on Escape ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalState !== 'connecting') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [modalState, onClose])

  const handleClose = () => {
    if (modalState === 'connecting') return
    onClose()
  }

  // ── Connect handler ──────────────────────────────────────────────────────
  const handleConnect = (wallet: ReturnType<typeof useWallets>[number]) => {
    setConnectingWallet(wallet.name)
    setModalState('connecting')
    setErrorMessage('')

    connectWallet(
      { wallet },
      {
        onSuccess: () => {
          onClose()
        },
        onError: (err: any) => {
          const msg: string = err?.message ?? ''
          if (
            msg.toLowerCase().includes('cancel') ||
            msg.toLowerCase().includes('reject') ||
            msg.toLowerCase().includes('user rejected')
          ) {
            setModalState('cancelled')
          } else {
            setModalState('error')
            setErrorMessage(msg || 'Something went wrong. Please try again.')
          }
          setConnectingWallet(null)
        },
      }
    )
  }

  const handleRetry = () => {
    setModalState('idle')
    setErrorMessage('')
    setConnectingWallet(null)
  }

  if (!visible) return null

  return (
    <>
      {/* ── Keyframes ───────────────────────────────────────────────────── */}
      <style>{`
        @keyframes hc-modal-in {
          from { opacity: 0; transform: translateY(24px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        @keyframes hc-modal-out {
          from { opacity: 1; transform: translateY(0)    scale(1);    }
          to   { opacity: 0; transform: translateY(24px) scale(0.96); }
        }
        @keyframes hc-bd-in  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes hc-bd-out { from { opacity: 1; } to { opacity: 0; } }
        @keyframes hc-spin   { to { transform: rotate(360deg); } }
        @keyframes hc-row-in {
          from { opacity: 0; transform: translateX(-10px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes hc-shimmer { 0%,100%{opacity:.4} 50%{opacity:1} }

        .hc-modal-in   { animation: hc-modal-in  0.32s cubic-bezier(0.16,1,0.3,1) both; }
        .hc-modal-out  { animation: hc-modal-out 0.28s cubic-bezier(0.7,0,0.84,0) both; }
        .hc-bd-in      { animation: hc-bd-in     0.25s ease both; }
        .hc-bd-out     { animation: hc-bd-out    0.25s ease both; }
        .hc-spinner    { animation: hc-spin      1s linear infinite; }
        .hc-wallet-row { animation: hc-row-in    0.3s cubic-bezier(0.16,1,0.3,1) both; }
        .hc-shimmer    { animation: hc-shimmer   2.5s ease-in-out infinite; }
      `}</style>

      {/* ── Backdrop ────────────────────────────────────────────────────── */}
      <div
        onClick={handleClose}
        className={`fixed inset-0 z-[999] flex items-center justify-center px-4
          bg-black/70 backdrop-blur-sm
          ${open ? 'hc-bd-in' : 'hc-bd-out'}`}
      >
        {/* ── Modal card ──────────────────────────────────────────────── */}
        <div
          onClick={(e) => e.stopPropagation()}
          className={`relative w-full max-w-sm rounded-2xl overflow-hidden
            bg-[#071a0c] border border-[#00ff8825]
            shadow-[0_0_0_1px_#00ff8810,0_24px_80px_rgba(0,0,0,0.85),0_0_80px_#00ff8810_inset]
            ${open ? 'hc-modal-in' : 'hc-modal-out'}`}
        >
          {/* Shimmer top bar */}
          <div className="absolute top-0 left-0 right-0 h-[2px] hc-shimmer
            bg-gradient-to-r from-transparent via-[#00ff88] to-transparent rounded-t-2xl" />

          {/* Grid texture */}
          <div
            className="absolute inset-0 opacity-[0.025] pointer-events-none"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%2300ff88' fill-opacity='1'%3E%3Cpath d='M0 0h1v40H0zm39 0h1v40h-1zM0 0v1h40V0zm0 39v1h40v-1z'/%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />

          <div className="relative z-10 p-6">

            {/* ── Header ────────────────────────────────────────────── */}
            <div className="flex items-start justify-between mb-6">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xl select-none">🏏</span>
                  <p
                    className="text-[10px] tracking-[0.35em] text-[#00ff8880] uppercase font-semibold"
                    style={{ fontFamily: 'Orbitron, monospace' }}
                  >
                    Hand Cricket
                  </p>
                </div>
                <h2
                  className="text-xl font-black text-white tracking-tight"
                  style={{ fontFamily: 'Orbitron, monospace' }}
                >
                  Connect <span className="text-[#00ff88]">Wallet</span>
                </h2>
              </div>

              <button
                onClick={handleClose}
                disabled={modalState === 'connecting'}
                className="w-8 h-8 rounded-lg flex items-center justify-center
                  border border-[#00ff8820] text-[#00ff8860]
                  hover:border-[#00ff8866] hover:text-[#00ff88] hover:bg-[#00ff8810]
                  disabled:opacity-30 disabled:cursor-not-allowed
                  transition-all duration-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* ══ IDLE — wallet list ════════════════════════════════════ */}
            {modalState === 'idle' && (
              <div className="space-y-2">
                <p className="text-xs text-[#ffffff40] mb-4 tracking-wide">
                  Choose your wallet to start playing
                </p>

                {wallets.length === 0 ? (
                  <div className="text-center py-8 space-y-3">
                    <div className="text-4xl select-none opacity-40">🦊</div>
                    <p className="text-[#ffffff50] text-sm leading-relaxed">
                      No wallets detected.<br />
                      Install a Sui-compatible wallet to continue.
                    </p>
                    <a
                      href="https://suiwallet.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-2 text-xs text-[#00ff88] border border-[#00ff8840]
                        px-4 py-2 rounded-lg hover:bg-[#00ff8812] transition-all duration-200"
                    >
                      Get Sui Wallet →
                    </a>
                  </div>
                ) : (
                  wallets.map((wallet, i) => (
                    <button
                      key={wallet.name}
                      onClick={() => handleConnect(wallet)}
                      className="hc-wallet-row w-full flex items-center gap-3 p-3 rounded-xl
                        border border-[#00ff8818] bg-[#00ff8806]
                        hover:border-[#00ff8855] hover:bg-[#00ff8812]
                        hover:shadow-[0_0_20px_#00ff8812]
                        active:scale-[0.98]
                        transition-all duration-200 group text-left"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <WalletIcon icon={wallet.icon} name={wallet.name} />
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-white font-bold text-sm truncate
                            group-hover:text-[#00ff88] transition-colors duration-200"
                          style={{ fontFamily: 'Exo 2, sans-serif' }}
                        >
                          {wallet.name}
                        </p>
                        <p className="text-[#ffffff30] text-[11px] mt-0.5">Sui Wallet</p>
                      </div>
                      <span className="text-[#00ff8830] group-hover:text-[#00ff88]
                        group-hover:translate-x-1 transition-all duration-200 text-sm">
                        →
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* ══ CONNECTING ═══════════════════════════════════════════ */}
            {modalState === 'connecting' && (
              <div className="flex flex-col items-center py-8 space-y-5 text-center">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border-2 border-[#00ff8820]" />
                  <div className="absolute inset-0 rounded-full border-2 border-transparent
                    border-t-[#00ff88] hc-spinner" />
                  <div className="absolute inset-2 rounded-full bg-[#00ff8808]
                    flex items-center justify-center text-xl select-none">🏏</div>
                </div>
                <div className="space-y-1">
                  <p className="text-[#00ff88] font-bold text-base tracking-wide"
                    style={{ fontFamily: 'Orbitron, monospace' }}>
                    Connecting…
                  </p>
                  <p className="text-[#ffffff40] text-xs">
                    Approve in <span className="text-[#00ff8880]">{connectingWallet}</span>
                  </p>
                </div>
                <p className="text-[#ffffff25] text-[11px] leading-relaxed max-w-[200px]">
                  Check your wallet for a connection request
                </p>
              </div>
            )}

            {/* ══ CANCELLED ════════════════════════════════════════════ */}
            {modalState === 'cancelled' && (
              <div className="flex flex-col items-center py-8 space-y-5 text-center">
                <div className="w-16 h-16 rounded-full bg-[#ffd70015] border border-[#ffd70030]
                  flex items-center justify-center text-3xl select-none">🚫</div>
                <div className="space-y-1">
                  <p className="text-[#ffd700] font-bold text-base"
                    style={{ fontFamily: 'Orbitron, monospace' }}>
                    Request Cancelled
                  </p>
                  <p className="text-[#ffffff40] text-xs">You cancelled the connection request.</p>
                </div>
                <button onClick={handleRetry}
                  className="px-6 py-2.5 rounded-xl font-bold text-sm bg-[#00ff88] text-[#030f06]
                    shadow-[0_0_20px_#00ff8860] hover:shadow-[0_0_35px_#00ff8899]
                    hover:-translate-y-0.5 active:scale-95 transition-all duration-200"
                  style={{ fontFamily: 'Exo 2, sans-serif' }}>
                  Try Again
                </button>
              </div>
            )}

            {/* ══ ERROR ════════════════════════════════════════════════ */}
            {modalState === 'error' && (
              <div className="flex flex-col items-center py-8 space-y-5 text-center">
                <div className="w-16 h-16 rounded-full bg-[#ff444415] border border-[#ff444430]
                  flex items-center justify-center text-3xl select-none">⚠️</div>
                <div className="space-y-1">
                  <p className="text-[#ff4444] font-bold text-base"
                    style={{ fontFamily: 'Orbitron, monospace' }}>
                    Connection Failed
                  </p>
                  <p className="text-[#ffffff40] text-xs leading-relaxed max-w-[220px] mx-auto">
                    {errorMessage || 'Something went wrong. Please try again.'}
                  </p>
                </div>
                <button onClick={handleRetry}
                  className="px-6 py-2.5 rounded-xl font-bold text-sm bg-[#00ff88] text-[#030f06]
                    shadow-[0_0_20px_#00ff8860] hover:shadow-[0_0_35px_#00ff8899]
                    hover:-translate-y-0.5 active:scale-95 transition-all duration-200"
                  style={{ fontFamily: 'Exo 2, sans-serif' }}>
                  Retry
                </button>
              </div>
            )}

            {/* ── Footer ────────────────────────────────────────────── */}
            {modalState === 'idle' && wallets.length > 0 && (
              <p className="mt-5 text-center text-[#ffffff20] text-[10px] tracking-wide leading-relaxed">
                By connecting you agree to the{' '}
                <span className="text-[#00ff8840]">terms of the game</span>.
                <br />
                Powered by <span className="text-[#00ff8840]">Sui Network</span>
              </p>
            )}

          </div>
        </div>
      </div>
    </>
  )
}