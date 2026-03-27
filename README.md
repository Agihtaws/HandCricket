# 🏏 HandCricket – On‑Chain Cricket Game

> **Play the classic hand‑cricket game on the OneChain blockchain.**  
> Challenge the CPU or play with friends in real‑time PvP matches.


## ✨ Features

- 🎮 **Two game modes**  
  – **Vs CPU**: Quick single‑player matches against an AI opponent.  
  – **PvP**: Challenge another player in real time via WebSocket rooms.

- 💰 **Built‑in token economy**  
  Each game requires a small bet (0.1 OCT). Winners receive the pot – the treasury is managed entirely on‑chain.

- 🌐 **Fully decentralized**  
  Smart contracts written in Move, deployed on OneChain Testnet. Every game outcome is verified on the blockchain.

- 🖥️ **Modern web interface**  
  Built with React + TypeScript, using the OneChain TypeScript SDK for seamless wallet integration.

- 🧪 **Testnet ready**  
  Request free OCT from the faucet to start playing – no real money needed.

---

## 🧱 Tech Stack

| Area               | Technology                               |
|--------------------|------------------------------------------|
| Blockchain         | OneChain (Move smart contracts)          |
| Backend            | Node.js + TypeScript + Express + WebSocket |
| Frontend           | React + TypeScript + Vite                |
| Wallet SDK         | OneChain TypeScript SDK                  |
| Database           | None – all state is on‑chain or in‑memory |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later) and npm
- [OneChain CLI](https://github.com/one-chain-labs/onechain) (for interacting with the testnet)
- A OneChain wallet (e.g., [OneChain Wallet](https://chromewebstore.google.com/detail/onechain-wallet)) – you’ll need a testnet address

### 1. Clone the repository

```bash
git clone https://github.com/Agihtaws/HandCricket.git
cd HandCricket
```

### 2. Set up environment variables

Copy the example environment file and fill in the values:

```bash
cp .env.example .env
```

Edit `.env` – you’ll need:

```ini
# Backend
RPC_URL=https://rpc-testnet.onelabs.cc:443
ADMIN_SECRET_KEY=your_private_key_here
API_KEY=your_secret_key
PORT=3001
CORS_ORIGIN=your_frontend_app
PACKAGE_ID=0x8257d18d73a9ad02d71bcaafe56a36259fefd47fdb70596660b75f422dfdd27e
TREASURY_ID=0x381a74fe1356c3fbb240f844f05e2987abfb01e706cb8f8e8af1f0ccbb86cd67
GAME_CAP_ID=0x429ed884407ca70f2d5be318bf7e29e5cfdefaa3f7cf461f45718fc60e3ee963
ADMIN_CAP_ID=0xdc653a8efe4139ee994b49aa938a3463e87fca46b1c19bf1c74c9da5cf2b474f

# Frontend
VITE_PACKAGE_ID=0x8257d18d73a9ad02d71bcaafe56a36259fefd47fdb70596660b75f422dfdd27e
VITE_TREASURY_ID=0x381a74fe1356c3fbb240f844f05e2987abfb01e706cb8f8e8af1f0ccbb86cd67
VITE_GAME_CAP_ID=0x429ed884407ca70f2d5be318bf7e29e5cfdefaa3f7cf461f45718fc60e3ee963
VITE_BACKEND_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
VITE_API_KEY=your_api_key
```

> **Note:** The contract IDs above are for the testnet deployment. If you redeploy, update them accordingly.

### 3. Install dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 4. Start the backend server

```bash
cd backend
npm run dev
```

You should see logs confirming the server is running and the treasury balance.

### 5. Start the frontend dev server

```bash
cd ../frontend
npm run dev
```

Visit `http://localhost:5173` in your browser.

---

## 🎮 How to Play

1. **Connect your wallet** – click the “Connect Wallet” button and approve the connection.
2. **Choose mode** – “Play vs CPU” for a quick game, or “Create PvP Game” to play with a friend.
3. **Make your choice** – select a number between 1 and 6. The game follows classic hand‑cricket rules:
   - If your number matches the opponent’s, you’re **out**.
   - Otherwise, you score your number.
4. **Win the game** – after 10 chances or when the target is reached, the winner is declared and the treasury pays out.

For PvP, share the game ID with your friend – they can join from the lobby.

---

## 🛠️ Contract Details

The Move package (`hand_cricket`) contains three modules:

- **`game`** – Single‑player logic (user creates game, submits moves, CPU responds automatically via backend).
- **`pvp_game`** – Two‑player logic (creates game, join, both submit moves, result determined on‑chain).
- **`treasury`** – Manages the betting pool (fund, lock bets, pay out).

The backend acts as a trusted relay for CPU moves and orchestrates PvP games via WebSocket rooms.

---

## 🧪 Running on Testnet

To get free OCT:

```bash
one client faucet
```

Then you can use `one client gas` to see your coins. Make sure you have **at least two coins** (one for gas, one for bet) before starting a game.

---

## 🔗 Links & Placeholders

- **Frontend Live**: [🔗 https://hand-cricket-lyart.vercel.app](https://hand-cricket-lyart.vercel.app)
- **YouTube Demo**: [🎥 Watch the walkthrough – coming soon]
- **GitHub Repository**: [📁 https://github.com/Agihtaws/HandCricket](https://github.com/Agihtaws/HandCricket)

---


## 📄 License

This project is licensed under the MIT License – see the [LICENSE](LICENSE) file for details.

---

**Made with 💚 by the HandCricket Team**  
*Play fair, play on‑chain!*
