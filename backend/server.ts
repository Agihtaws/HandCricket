import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import pino from 'pino';
import pinoHttp from 'pino-http';

import { Ed25519Keypair }            from '@onelabs/sui/keypairs/ed25519';
import { SuiClient, getFullnodeUrl } from '@onelabs/sui/client';
import { Transaction }               from '@onelabs/sui/transactions';
import { decodeSuiPrivateKey }       from '@onelabs/sui/cryptography';
import { MIST_PER_SUI }              from '@onelabs/sui/utils';

const REQUIRED_ENV = ['ADMIN_SECRET_KEY', 'API_KEY', 'PACKAGE_ID', 'TREASURY_ID', 'GAME_CAP_ID', 'ADMIN_CAP_ID'];
for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        console.error(`❌ Missing required env var: ${key}`);
        process.exit(1);
    }
}

const PACKAGE_ID   = process.env.PACKAGE_ID!;
const TREASURY_ID  = process.env.TREASURY_ID!;
const GAME_CAP_ID  = process.env.GAME_CAP_ID!;
const ADMIN_CAP_ID = process.env.ADMIN_CAP_ID!;
const API_KEY      = process.env.API_KEY!;
const RPC_URL      = process.env.RPC_URL || getFullnodeUrl('testnet');
const PORT = Number(process.env.PORT) || 3001;

const BALL_TIMER_MS        = Number(process.env.BALL_TIMER_MS) || 5_000;
const RECONNECT_GRACE_MS   = Number(process.env.RECONNECT_GRACE_MS) || 30_000;
const BALL_REVEAL_DELAY_MS = Number(process.env.BALL_REVEAL_DELAY_MS) || 1_500;
const INNINGS_BREAK_MS     = Number(process.env.INNINGS_BREAK_MS) || 3_000;
const WS_PING_INTERVAL_MS  = Number(process.env.WS_PING_INTERVAL_MS) || 15_000;
const WS_RATE_LIMIT        = Number(process.env.WS_RATE_LIMIT) || 20;
const MAINTENANCE_INTERVAL_MS = Number(process.env.MAINTENANCE_INTERVAL_MS) || 60_000;
const FUNDING_AMOUNT_MIST = BigInt(process.env.FUNDING_AMOUNT_MIST || '1000000000');
const TREASURY_LOW_THRESHOLD_OCT = Number(process.env.TREASURY_LOW_THRESHOLD_OCT) || 2.0;
const ADMIN_LOW_THRESHOLD_OCT    = Number(process.env.ADMIN_LOW_THRESHOLD_OCT) || 1.2;
const FORFEIT_AFTER_DISCONNECT_MS = RECONNECT_GRACE_MS;

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
});
const httpLogger = pinoHttp({ logger, autoLogging: false });

const client = new SuiClient({ url: RPC_URL });
const { secretKey } = decodeSuiPrivateKey(process.env.ADMIN_SECRET_KEY!);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);
const ADMIN_ADDRESS = keypair.getPublicKey().toSuiAddress();

logger.info(`Backend initialized. Admin address: ${ADMIN_ADDRESS}`);

class TxQueue {
    private queue: Array<() => Promise<void>> = [];
    private running = false;

    add<T>(fn: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue.push(async () => {
                try { resolve(await fn()); } catch (err) { reject(err); }
            });
            this.drain();
        });
    }

    private async drain(): Promise<void> {
        if (this.running) return;
        this.running = true;
        while (this.queue.length > 0) {
            await this.queue.shift()!();
        }
        this.running = false;
    }
}
const txQueue = new TxQueue();

async function signAndWait(tx: Transaction): Promise<string> {
    return txQueue.add(async () => {
        const result = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx });
        await client.waitForTransaction({ digest: result.digest });
        return result.digest;
    });
}

interface TreasuryFields {
    balance: string;
    total_games_played: number;
    total_payouts: number;
}
interface GameFields {
    status: number;
    winner?: { vec: string[] } | null;
    player1: string;
    player2?: { vec: string[] };
}

async function getGameObject(gameId: string): Promise<GameFields | null> {
    try {
        const obj = await client.getObject({ id: gameId, options: { showContent: true } });
        const fields = (obj.data?.content as any)?.fields;
        if (!fields) return null;
        return fields as GameFields;
    } catch {
        return null;
    }
}

interface PlayerSlot {
    ws: WebSocket;
    address: string;
    tossNumber: number | null;
    choseOdd: boolean | null;
    currentMove: number | null;
    hasSubmitted: boolean;
    timeoutLeft: number;
}

type RoomStatus = 'waiting' | 'toss' | 'playing' | 'finished' | 'error';

interface Room {
    gameId: string;
    p1: PlayerSlot;
    p2: PlayerSlot | null;
    status: RoomStatus;
    currentBatter: 'p1' | 'p2';
    innings: 1 | 2;
    p1Score: number;
    p2Score: number;
    targetScore: number;
    p1Moves: number[];
    p2Moves: number[];
    ballTimer: NodeJS.Timeout | null;
    ballStartTimestamp: number;
    disconnectTimers: Map<'p1' | 'p2', NodeJS.Timeout>;
    lock: RoomLock;
}

class RoomLock {
    private queue: Array<() => void> = [];
    private locked = false;

    async acquire(): Promise<() => void> {
        if (!this.locked) {
            this.locked = true;
            return () => { this.locked = false; this.release(); };
        }
        return new Promise(resolve => {
            this.queue.push(() => {
                this.locked = true;
                resolve(() => { this.locked = false; this.release(); });
            });
        });
    }

    private release(): void {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            next?.();
        }
    }
}

const rooms = new Map<string, Room>();

function wsSend(ws: WebSocket, payload: object): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(room: Room, payload: object): void {
    wsSend(room.p1.ws, payload);
    if (room.p2) wsSend(room.p2.ws, payload);
}

function whichSlot(room: Room, ws: WebSocket): 'p1' | 'p2' | null {
    if (room.p1.ws === ws) return 'p1';
    if (room.p2?.ws === ws) return 'p2';
    return null;
}

interface RateEntry { count: number; resetAt: number; }
const wsRateMap = new Map<WebSocket, RateEntry>();

function isRateLimited(ws: WebSocket): boolean {
    const now = Date.now();
    let entry = wsRateMap.get(ws);
    if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + 1000 };
    entry.count++;
    wsRateMap.set(ws, entry);
    return entry.count > WS_RATE_LIMIT;
}

async function pvpResolveToss(gameId: string, p1ChoseOdd: boolean, p1Toss: number, p2Toss: number, tossWinnerBats: boolean): Promise<string> {
    const tx = new Transaction();
    tx.moveCall({
        target: `${PACKAGE_ID}::pvp_game::resolve_toss`,
        arguments: [
            tx.object(GAME_CAP_ID), tx.object(gameId),
            tx.pure.bool(p1ChoseOdd), tx.pure.u64(p1Toss),
            tx.pure.u64(p2Toss), tx.pure.bool(tossWinnerBats),
        ],
    });
    return signAndWait(tx);
}

async function pvpSettleInnings(gameId: string, p1Moves: number[], p2Moves: number[]): Promise<string> {
    const tx = new Transaction();
    tx.moveCall({
        target: `${PACKAGE_ID}::pvp_game::settle_innings`,
        arguments: [
            tx.object(GAME_CAP_ID), tx.object(gameId),
            tx.pure.vector('u64', p1Moves), tx.pure.vector('u64', p2Moves),
        ],
    });
    return signAndWait(tx);
}

async function pvpSwitchInnings(gameId: string): Promise<string> {
    const tx = new Transaction();
    tx.moveCall({
        target: `${PACKAGE_ID}::pvp_game::switch_innings`,
        arguments: [tx.object(GAME_CAP_ID), tx.object(gameId)],
    });
    return signAndWait(tx);
}

async function pvpEndGame(gameId: string): Promise<string> {
    const tx = new Transaction();
    tx.moveCall({
        target: `${PACKAGE_ID}::pvp_game::end_game`,
        arguments: [tx.object(GAME_CAP_ID), tx.object(gameId)],
    });
    return signAndWait(tx);
}

async function pvpForfeit(gameId: string, forfeitingPlayer: string): Promise<string> {
    const tx = new Transaction();
    tx.moveCall({
        target: `${PACKAGE_ID}::pvp_game::forfeit_game`,
        arguments: [tx.object(GAME_CAP_ID), tx.object(gameId), tx.pure.address(forfeitingPlayer)],
    });
    return signAndWait(tx);
}

async function startBall(room: Room): Promise<void> {
    room.ballStartTimestamp = Date.now();
    broadcast(room, {
        type:          'BALL_START',
        timestamp:     room.ballStartTimestamp,
        currentBatter: room.currentBatter,
        innings:       room.innings,
        p1Score:       room.p1Score,
        p2Score:       room.p2Score,
        targetScore:   room.targetScore,
        p1ChancesLeft: room.p1.timeoutLeft,
        p2ChancesLeft: room.p2!.timeoutLeft,
    });
    room.ballTimer = setTimeout(() => resolveBall(room), BALL_TIMER_MS);
}

async function resolveBall(room: Room): Promise<void> {
    if (room.ballTimer) { clearTimeout(room.ballTimer); room.ballTimer = null; }

    const p1 = room.p1;
    const p2 = room.p2!;

    let p1Move = p1.hasSubmitted ? p1.currentMove! : 0;
    let p2Move = p2.hasSubmitted ? p2.currentMove! : 0;
    let p1ForceOut = false;
    let p2ForceOut = false;

    if (!p1.hasSubmitted && !p2.hasSubmitted) {
        p1Move = 1; p2Move = 2;
    }

    if (!p1.hasSubmitted) { p1.timeoutLeft--; if (p1.timeoutLeft <= 0) p1ForceOut = true; }
    if (!p2.hasSubmitted) { p2.timeoutLeft--; if (p2.timeoutLeft <= 0) p2ForceOut = true; }

    if (p1ForceOut) {
        p1Move = p2.hasSubmitted ? p2.currentMove! : 1;
    }
    if (p2ForceOut) {
        p2Move = p1.hasSubmitted ? p1.currentMove! : 1;
    }

    p1Move = Math.min(6, Math.max(1, p1Move));
    p2Move = Math.min(6, Math.max(1, p2Move));

    const isOut = p1Move === p2Move;

    room.p1Moves.push(p1Move);
    room.p2Moves.push(p2Move);

    if (!isOut) {
        if (room.currentBatter === 'p1') room.p1Score += p1Move;
        else room.p2Score += p2Move;
    }

    broadcast(room, {
        type:          'BALL_RESULT',
        p1Move, p2Move, isOut,
        p1Score:       room.p1Score,
        p2Score:       room.p2Score,
        p1Timeout:     !p1.hasSubmitted,
        p2Timeout:     !p2.hasSubmitted,
        p1ForceOut, p2ForceOut,
        p1ChancesLeft: p1.timeoutLeft,
        p2ChancesLeft: p2.timeoutLeft,
    });

    p1.currentMove = null; p1.hasSubmitted = false;
    p2.currentMove = null; p2.hasSubmitted = false;

    if (isOut) {
        await handleInningsEnd(room);
        return;
    }

    if (room.innings === 2) {
        const chaserScore = room.currentBatter === 'p1' ? room.p1Score : room.p2Score;
        if (chaserScore >= room.targetScore) {
            await handleGameOver(room, false);
            return;
        }
    }

    setTimeout(() => {
        if (room.status === 'playing') startBall(room);
    }, BALL_REVEAL_DELAY_MS);
}

async function handleInningsEnd(room: Room): Promise<void> {
    const onChain = await getGameObject(room.gameId);
    if (!onChain || onChain.status !== 2) {
        logger.error(`On-chain state mismatch for game ${room.gameId} (innings end)`);
        await markRoomError(room, 'On-chain game state inconsistent');
        return;
    }

    try {
        const digest = await pvpSettleInnings(room.gameId, room.p1Moves, room.p2Moves);
        logger.info(`✅ [PvP] Innings settled | ${room.gameId} | digest: ${digest}`);

        if (room.innings === 1) {
            const batterScore = room.currentBatter === 'p1' ? room.p1Score : room.p2Score;
            room.targetScore = batterScore + 1;
            room.innings = 2;
            room.currentBatter = room.currentBatter === 'p1' ? 'p2' : 'p1';
            room.p1Moves = [];
            room.p2Moves = [];
            room.p1.timeoutLeft = 3;
            room.p2!.timeoutLeft = 3;

            const switchDigest = await pvpSwitchInnings(room.gameId);
            logger.info(`✅ [PvP] Innings switched | ${room.gameId} | digest: ${switchDigest}`);

            broadcast(room, {
                type:          'INNINGS_SWITCH',
                innings:       2,
                targetScore:   room.targetScore,
                currentBatter: room.currentBatter,
                p1Score:       room.p1Score,
                p2Score:       room.p2Score,
            });

            setTimeout(() => {
                if (room.status === 'playing') startBall(room);
            }, INNINGS_BREAK_MS);
        } else {
            await handleGameOver(room, true);
        }
    } catch (err: any) {
        logger.error(`❌ [PvP] handleInningsEnd error: ${err.message}`);
        await markRoomError(room, 'Innings settlement failed. Contact support.');
    }
}

async function handleGameOver(room: Room, alreadySettled: boolean): Promise<void> {
    room.status = 'finished';

    try {
        if (!alreadySettled) {
            const settleDigest = await pvpSettleInnings(room.gameId, room.p1Moves, room.p2Moves);
            logger.info(`✅ [PvP] Innings settled (target reached) | ${room.gameId} | digest: ${settleDigest}`);
        }

        const digest = await pvpEndGame(room.gameId);
        logger.info(`✅ [PvP] Game over + payout | ${room.gameId} | digest: ${digest}`);

        const winner = room.currentBatter === 'p1'
            ? (room.p1Score >= room.targetScore ? room.p1.address : room.p2!.address)
            : (room.p2Score >= room.targetScore ? room.p2!.address : room.p1.address);

        broadcast(room, {
            type:        'GAME_OVER',
            winner,
            p1Address:   room.p1.address,
            p2Address:   room.p2!.address,
            p1Score:     room.p1Score,
            p2Score:     room.p2Score,
            targetScore: room.targetScore,
            digest,
        });

        setTimeout(() => {
            clearRoomTimers(room);
            rooms.delete(room.gameId);
        }, 30_000);
    } catch (err: any) {
        logger.error(`❌ [PvP] handleGameOver error: ${err.message}`);
        await markRoomError(room, 'Game end transaction failed. Contact support.');
    }
}

async function markRoomError(room: Room, errorMessage: string): Promise<void> {
    room.status = 'error';
    broadcast(room, { type: 'ERROR', message: errorMessage, gameId: room.gameId });
    logger.error(`Room ${room.gameId} marked as error: ${errorMessage}`);
    setTimeout(() => {
        clearRoomTimers(room);
        rooms.delete(room.gameId);
    }, 30_000);
}

function clearRoomTimers(room: Room): void {
    if (room.ballTimer) clearTimeout(room.ballTimer);
    for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
    room.disconnectTimers.clear();
}

async function handleJoinRoom(ws: WebSocket, msg: any): Promise<void> {
    const { gameId, playerAddress, isPlayer1 } = msg;
    if (!gameId || !playerAddress) {
        wsSend(ws, { type: 'ERROR', message: 'JOIN_ROOM requires gameId and playerAddress' });
        return;
    }

    const newSlot: PlayerSlot = {
        ws, address: playerAddress,
        tossNumber: null, choseOdd: null,
        currentMove: null, hasSubmitted: false, timeoutLeft: 3,
    };

    if (isPlayer1) {
        if (rooms.has(gameId)) {
            const room = rooms.get(gameId)!;
            const release = await room.lock.acquire();
            try {
                const dt = room.disconnectTimers.get('p1');
                if (dt) { clearTimeout(dt); room.disconnectTimers.delete('p1'); }
                room.p1.ws = ws;
                wsSend(ws, {
                    type: 'RECONNECTED', status: room.status,
                    innings: room.innings, p1Score: room.p1Score,
                    p2Score: room.p2Score, targetScore: room.targetScore,
                    currentBatter: room.currentBatter,
                    ballStartTimestamp: room.ballStartTimestamp,
                });
                if (room.p2) broadcast(room, { type: 'OPPONENT_RECONNECTED' });
                return;
            } finally { release(); }
        }
        const room: Room = {
            gameId, p1: newSlot, p2: null,
            status: 'waiting', currentBatter: 'p1', innings: 1,
            p1Score: 0, p2Score: 0, targetScore: 0,
            p1Moves: [], p2Moves: [],
            ballTimer: null, ballStartTimestamp: 0,
            disconnectTimers: new Map(),
            lock: new RoomLock(),
        };
        rooms.set(gameId, room);
        wsSend(ws, { type: 'ROOM_CREATED', gameId });
        logger.info(`🏏 [PvP] Room created: ${gameId} | P1: ${playerAddress}`);
    } else {
        const room = rooms.get(gameId);
        if (!room) {
            wsSend(ws, { type: 'ERROR', message: 'Room not found. Check the room code.' });
            return;
        }
        const release = await room.lock.acquire();
        try {
            if (room.status === 'error') {
                wsSend(ws, { type: 'ERROR', message: 'This game is in an error state.' });
                return;
            }
            if (room.p2 !== null) {
                if (room.p2.address !== playerAddress) {
                    wsSend(ws, { type: 'ERROR', message: 'This room already has two players.' });
                    return;
                }
                const dt = room.disconnectTimers.get('p2');
                if (dt) { clearTimeout(dt); room.disconnectTimers.delete('p2'); }
                room.p2.ws = ws;
                wsSend(ws, {
                    type: 'RECONNECTED', status: room.status,
                    innings: room.innings, p1Score: room.p1Score,
                    p2Score: room.p2Score, targetScore: room.targetScore,
                    currentBatter: room.currentBatter,
                    ballStartTimestamp: room.ballStartTimestamp,
                });
                broadcast(room, { type: 'OPPONENT_RECONNECTED' });
                return;
            }
            if (playerAddress === room.p1.address) {
                wsSend(ws, { type: 'ERROR', message: 'Cannot join your own room.' });
                return;
            }
            room.p2 = newSlot;
            room.status = 'toss';
            broadcast(room, {
                type:      'PLAYER_JOINED',
                p1Address: room.p1.address,
                p2Address: playerAddress,
                message:   'Both players ready. Toss phase starting.',
            });
            logger.info(`🏏 [PvP] P2 joined: ${gameId} | P2: ${playerAddress}`);
        } finally { release(); }
    }
}

async function handleSubmitToss(ws: WebSocket, msg: any): Promise<void> {
    const { gameId, tossNumber, choseOdd } = msg;
    const room = rooms.get(gameId);
    if (!room || room.status !== 'toss') return;
    const release = await room.lock.acquire();
    try {
        const slot = whichSlot(room, ws);
        if (!slot) return;
        const n = Number(tossNumber);
        if (!Number.isInteger(n) || n < 1 || n > 6) {
            wsSend(ws, { type: 'ERROR', message: 'Toss number must be an integer between 1 and 6.' });
            return;
        }
        if (slot === 'p1') {
            room.p1.tossNumber = n;
            room.p1.choseOdd = Boolean(choseOdd);
        } else {
            room.p2!.tossNumber = n;
        }
        wsSend(ws, { type: 'TOSS_SUBMITTED' });

        if (room.p1.tossNumber !== null && room.p2?.tossNumber !== null) {
            const p1Toss = room.p1.tossNumber!;
            const p2Toss = room.p2!.tossNumber!;
            const p1ChoseOdd = room.p1.choseOdd!;
            const total = p1Toss + p2Toss;
            const isOdd = total % 2 === 1;
            const p1WonToss = (p1ChoseOdd && isOdd) || (!p1ChoseOdd && !isOdd);
            broadcast(room, {
                type:              'TOSS_RESULT',
                p1Toss, p2Toss, total, isOdd, p1WonToss,
                tossWinnerAddress: p1WonToss ? room.p1.address : room.p2!.address,
                message:           'Toss winner: choose to Bat or Bowl.',
            });
            logger.info(`🎲 [PvP] Toss result | ${gameId} | P1Won: ${p1WonToss}`);
        }
    } finally { release(); }
}

async function handleBatBowlChoice(ws: WebSocket, msg: any): Promise<void> {
    const { gameId, chooseBat } = msg;
    const room = rooms.get(gameId);
    if (!room || room.status !== 'toss') return;
    const release = await room.lock.acquire();
    try {
        const slot = whichSlot(room, ws);
        if (!slot) return;

        const p1Toss = room.p1.tossNumber!;
        const p2Toss = room.p2!.tossNumber!;
        const p1ChoseOdd = room.p1.choseOdd!;
        const isOdd = (p1Toss + p2Toss) % 2 === 1;
        const p1WonToss = (p1ChoseOdd && isOdd) || (!p1ChoseOdd && !isOdd);

        const expectedSlot: 'p1' | 'p2' = p1WonToss ? 'p1' : 'p2';
        if (slot !== expectedSlot) {
            wsSend(ws, { type: 'ERROR', message: 'Only the toss winner can choose bat or bowl.' });
            return;
        }

        const tossWinnerBats = Boolean(chooseBat);
        room.currentBatter = p1WonToss
            ? (tossWinnerBats ? 'p1' : 'p2')
            : (tossWinnerBats ? 'p2' : 'p1');
        room.status = 'playing';

        try {
            const digest = await pvpResolveToss(gameId, p1ChoseOdd, p1Toss, p2Toss, tossWinnerBats);
            logger.info(`✅ [PvP] Toss on-chain | ${gameId} | digest: ${digest}`);
            broadcast(room, {
                type:          'GAME_START',
                currentBatter: room.currentBatter,
                p1Address:     room.p1.address,
                p2Address:     room.p2!.address,
                innings:       1,
            });
            setTimeout(() => startBall(room), 2_000);
        } catch (err: any) {
            logger.error(`❌ [PvP] handleBatBowlChoice error: ${err.message}`);
            await markRoomError(room, 'Toss settlement failed.');
        }
    } finally { release(); }
}

async function handleSubmitMove(ws: WebSocket, msg: any): Promise<void> {
    const { gameId, number } = msg;
    const room = rooms.get(gameId);
    if (!room || room.status !== 'playing') return;
    const release = await room.lock.acquire();
    try {
        const slot = whichSlot(room, ws);
        if (!slot) return;
        const n = Number(number);
        if (!Number.isInteger(n) || n < 1 || n > 6) {
            wsSend(ws, { type: 'ERROR', message: 'Move must be an integer between 1 and 6.' });
            return;
        }
        const player = slot === 'p1' ? room.p1 : room.p2!;
        if (player.hasSubmitted) return;
        player.currentMove = n;
        player.hasSubmitted = true;
        wsSend(ws, { type: 'MOVE_ACCEPTED', yourMove: n });
        if (room.p1.hasSubmitted && room.p2!.hasSubmitted) {
            await resolveBall(room);
        }
    } finally { release(); }
}

async function handleDisconnect(ws: WebSocket): Promise<void> {
    for (const [gameId, room] of rooms) {
        const slot = whichSlot(room, ws);
        if (!slot) continue;
        const release = await room.lock.acquire();
        try {
            if (room.status === 'finished' || room.status === 'waiting' || room.status === 'error') {
                clearRoomTimers(room);
                rooms.delete(gameId);
                return;
            }
            logger.info(`⚡ [PvP] Disconnect: ${gameId} | slot: ${slot}`);
            const other = slot === 'p1' ? room.p2 : room.p1;
            const disconnectedAddress = slot === 'p1' ? room.p1.address : room.p2!.address;
            if (other) {
                wsSend(other.ws, {
                    type:    'OPPONENT_DISCONNECTED',
                    message: 'Opponent disconnected. Waiting 30 seconds for reconnect...',
                });
            }
            const timer = setTimeout(async () => {
                const forfeitRelease = await room.lock.acquire();
                try {
                    logger.info(`⏰ [PvP] Grace expired: ${disconnectedAddress} | forfeiting`);
                    const digest = await pvpForfeit(gameId, disconnectedAddress);
                    const winner = slot === 'p1' ? room.p2!.address : room.p1.address;
                    if (other) {
                        wsSend(other.ws, {
                            type:    'GAME_FORFEITED',
                            winner,
                            loser:   disconnectedAddress,
                            message: 'Opponent failed to reconnect. You win the full pot!',
                            digest,
                        });
                    }
                } catch (err: any) {
                    logger.error(`❌ [PvP] Forfeit on disconnect failed: ${err.message}`);
                } finally {
                    clearRoomTimers(room);
                    rooms.delete(gameId);
                    forfeitRelease();
                }
            }, FORFEIT_AFTER_DISCONNECT_MS);
            room.disconnectTimers.set(slot, timer);
        } finally { release(); }
        return;
    }
}

const app = express();
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
}));
app.use(express.json());
app.use((req, _res, next) => {
    logger.info(`${req.method} ${req.url}`);
    next();
});

app.get('/health', (_req, res) => {
    res.json({
        status:       'ok',
        timestamp:    new Date().toISOString(),
        adminAddress: ADMIN_ADDRESS,
        packageId:    PACKAGE_ID,
        network:      RPC_URL.includes('testnet') ? 'testnet' : 'mainnet',
        uptime:       `${process.uptime().toFixed(1)}s`,
        activeRooms:  rooms.size,
    });
});

app.get('/health/ws', (_req, res) => {
    res.json({
        status: wss.clients.size > 0 ? 'active' : 'idle',
        connections: wss.clients.size,
        activeRooms: rooms.size,
    });
});

app.get('/metrics', requireApiKey, async (_req, res) => {
    try {
        const treasuryObj = await client.getObject({ id: TREASURY_ID, options: { showContent: true } });
        const fields = (treasuryObj.data?.content as any)?.fields as TreasuryFields;
        const totalGames = fields?.total_games_played || 0;
        res.json({
            activeRooms: rooms.size,
            totalGamesPlayed: totalGames,
            totalPayouts: fields?.total_payouts || 0,
            treasuryBalance: fields?.balance || '0',
        });
    } catch (err: any) {
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
});

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
    if (req.headers['x-api-key'] !== API_KEY) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    next();
}

app.get('/api/balance', requireApiKey, async (_req, res) => {
    try {
        const [walletResult, treasuryObj] = await Promise.all([
            client.getBalance({ owner: ADMIN_ADDRESS }),
            client.getObject({ id: TREASURY_ID, options: { showContent: true } }),
        ]);
        const walletMist = BigInt(walletResult.totalBalance);
        const walletOct = Number(walletMist) / Number(MIST_PER_SUI);
        const fields = (treasuryObj.data?.content as any)?.fields as TreasuryFields;
        if (!fields) { res.status(500).json({ error: 'Treasury object not found.' }); return; }
        const treasuryMist = BigInt(fields.balance);
        const treasuryOct = Number(treasuryMist) / Number(MIST_PER_SUI);
        res.json({
            adminAddress:        ADMIN_ADDRESS,
            walletBalanceOct:    walletOct.toFixed(6),
            walletBalanceMist:   walletMist.toString(),
            treasuryBalanceOct:  treasuryOct.toFixed(6),
            treasuryBalanceMist: treasuryMist.toString(),
            totalGamesPlayed:    fields.total_games_played,
            totalPayouts:        fields.total_payouts,
            activeRooms:         rooms.size,
        });
    } catch (err: any) {
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/toss', requireApiKey, async (req, res) => {
    const { playerTossNumber, isOdd } = req.body;
    if (!playerTossNumber || isOdd === undefined) {
        return res.status(400).json({ error: 'Missing playerTossNumber or isOdd' });
    }
    const playerNum = Number(playerTossNumber);
    if (isNaN(playerNum) || playerNum < 1 || playerNum > 6) {
        return res.status(400).json({ error: 'Invalid playerTossNumber' });
    }

    const computerNum = Math.floor(Math.random() * 6) + 1;
    const sum = playerNum + computerNum;
    const sumIsOdd = sum % 2 === 1;
    const playerWon = (Boolean(isOdd) && sumIsOdd) || (!Boolean(isOdd) && !sumIsOdd);

    res.json({
        computerTossNumber: computerNum,
        playerWon,
        sumIsOdd,
        sum,
    });
});

app.post('/api/activate-game', requireApiKey, async (req, res) => {
    const { gameId } = req.body;
    if (!validateBody(req.body, ['gameId'], res)) return;
    try {
        const tx = new Transaction();
        tx.moveCall({
            target: `${PACKAGE_ID}::game::activate_game`,
            arguments: [
                tx.object(GAME_CAP_ID),
                tx.object(TREASURY_ID),
                tx.object(gameId),
            ],
        });
        const digest = await signAndWait(tx);
        logger.info(`✅ [CPU] activate-game | ${gameId} | digest: ${digest}`);
        res.json({ success: true, digest });
    } catch (err: any) {
        logger.error(`❌ [CPU] activate-game: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/resolve-toss', requireApiKey, async (req, res) => {
    const { gameId, isOdd, playerTossNumber, playerChoosesBat } = req.body;
    if (!validateBody(req.body, ['gameId','isOdd','playerTossNumber','playerChoosesBat'], res)) return;
    try {
        const computerTossNumber = Math.floor(Math.random() * 6) + 1;
        const sum = Number(playerTossNumber) + computerTossNumber;
        const sumIsOdd = sum % 2 === 1;
        const playerWon = Boolean(isOdd) === sumIsOdd;
        const tx = new Transaction();
        tx.moveCall({
            target: `${PACKAGE_ID}::game::resolve_toss`,
            arguments: [
                tx.object(GAME_CAP_ID), tx.object(gameId),
                tx.pure.bool(Boolean(isOdd)), tx.pure.u64(Number(playerTossNumber)),
                tx.pure.u64(computerTossNumber), tx.pure.bool(Boolean(playerChoosesBat)),
            ],
        });
        const digest = await signAndWait(tx);
        logger.info(`✅ [CPU] resolve-toss | ${gameId}`);
        res.json({ success: true, digest, computerTossNumber, playerWon, sum, sumIsOdd });
    } catch (err: any) {
        logger.error(`❌ [CPU] resolve-toss: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/computer-move', requireApiKey, async (req, res) => {
    const { gameId } = req.body;
    if (!validateBody(req.body, ['gameId'], res)) return;
    const computerMove = Math.floor(Math.random() * 6) + 1;
    logger.info(`✅ [CPU] computer-move | ${gameId} | move: ${computerMove}`);
    res.json({ success: true, computerMove });
});

app.post('/api/settle-innings', requireApiKey, async (req, res) => {
    const { gameId, playerMoves, computerMoves } = req.body;
    if (!validateBody(req.body, ['gameId','playerMoves','computerMoves'], res)) return;
    if (!Array.isArray(playerMoves) || !Array.isArray(computerMoves)) {
        res.status(400).json({ error: 'playerMoves and computerMoves must be arrays' }); return;
    }
    if (playerMoves.length !== computerMoves.length || playerMoves.length === 0) {
        res.status(400).json({ error: 'Move arrays must be equal length and non-empty' }); return;
    }
    try {
        const tx = new Transaction();
        tx.moveCall({
            target: `${PACKAGE_ID}::game::settle_innings`,
            arguments: [
                tx.object(GAME_CAP_ID), tx.object(gameId),
                tx.pure.vector('u64', playerMoves.map(Number)),
                tx.pure.vector('u64', computerMoves.map(Number)),
            ],
        });
        const digest = await signAndWait(tx);
        logger.info(`✅ [CPU] settle-innings | ${gameId} | balls: ${playerMoves.length}`);
        res.json({ success: true, digest });
    } catch (err: any) {
        logger.error(`❌ [CPU] settle-innings: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/switch-innings', requireApiKey, async (req, res) => {
    const { gameId } = req.body;
    if (!validateBody(req.body, ['gameId'], res)) return;
    try {
        const tx = new Transaction();
        tx.moveCall({
            target: `${PACKAGE_ID}::game::switch_innings`,
            arguments: [tx.object(GAME_CAP_ID), tx.object(gameId)],
        });
        const digest = await signAndWait(tx);
        logger.info(`✅ [CPU] switch-innings | ${gameId}`);
        res.json({ success: true, digest });
    } catch (err: any) {
        logger.error(`❌ [CPU] switch-innings: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/end-game', requireApiKey, async (req, res) => {
    const { gameId } = req.body;
    if (!validateBody(req.body, ['gameId'], res)) return;
    try {
        const tx = new Transaction();
        tx.moveCall({
            target: `${PACKAGE_ID}::game::end_game`,
            arguments: [tx.object(GAME_CAP_ID), tx.object(TREASURY_ID), tx.object(gameId)],
        });
        const digest = await signAndWait(tx);
        logger.info(`✅ [CPU] end-game | ${gameId}`);
        res.json({ success: true, digest });
    } catch (err: any) {
        logger.error(`❌ [CPU] end-game: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/forfeit', requireApiKey, async (req, res) => {
    const { gameId } = req.body;
    if (!validateBody(req.body, ['gameId'], res)) return;
    try {
        const tx = new Transaction();
        tx.moveCall({
            target: `${PACKAGE_ID}::game::forfeit_game`,
            arguments: [tx.object(GAME_CAP_ID), tx.object(TREASURY_ID), tx.object(gameId)],
        });
        const digest = await signAndWait(tx);
        logger.info(`✅ [CPU] forfeit | ${gameId}`);
        res.json({ success: true, digest });
    } catch (err: any) {
        logger.error(`❌ [CPU] forfeit: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/pvp/forfeit', requireApiKey, async (req, res) => {
    const { gameId, forfeitingPlayer } = req.body;
    if (!validateBody(req.body, ['gameId','forfeitingPlayer'], res)) return;
    try {
        const digest = await pvpForfeit(gameId, forfeitingPlayer);
        logger.info(`✅ [PvP] Manual forfeit | ${gameId} | forfeiter: ${forfeitingPlayer}`);
        const room = rooms.get(gameId);
        if (room) {
            await room.lock.acquire();
            clearRoomTimers(room);
            rooms.delete(gameId);
        }
        res.json({ success: true, digest });
    } catch (err: any) {
        logger.error(`❌ [PvP] Manual forfeit error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pvp/room/:gameId', requireApiKey, async (req, res) => {
    const room = rooms.get(req.params.gameId);
    if (!room) { res.status(404).json({ error: 'Room not found' }); return; }
    const release = await room.lock.acquire();
    try {
        res.json({
            gameId:          room.gameId,
            status:          room.status,
            p1Address:       room.p1.address,
            p2Address:       room.p2?.address ?? null,
            currentBatter:   room.currentBatter,
            innings:         room.innings,
            p1Score:         room.p1Score,
            p2Score:         room.p2Score,
            targetScore:     room.targetScore,
            p1Moves:         room.p1Moves,
            p2Moves:         room.p2Moves,
            p1ChancesLeft:   room.p1.timeoutLeft,
            p2ChancesLeft:   room.p2?.timeoutLeft ?? null,
            ballTimerActive: room.ballTimer !== null,
        });
    } finally { release(); }
});

function validateBody(body: any, fields: string[], res: Response): boolean {
    for (const f of fields) {
        if (body[f] === undefined || body[f] === null || body[f] === '') {
            res.status(400).json({ error: `Missing required field: ${f}` });
            return false;
        }
    }
    return true;
}

async function runMaintenance(): Promise<void> {
    logger.info(`🔧 Maintenance [${new Date().toLocaleTimeString()}]`);
    try {
        const treasuryObj = await client.getObject({ id: TREASURY_ID, options: { showContent: true } });
        const fields = (treasuryObj.data?.content as any)?.fields as TreasuryFields;
        if (!fields) throw new Error('Treasury object not found');
        const tOct = Number(fields.balance) / Number(MIST_PER_SUI);
        logger.info(`   Treasury: ${tOct.toFixed(4)} OCT`);

        if (tOct < TREASURY_LOW_THRESHOLD_OCT) {
            const walletBal = await client.getBalance({ owner: ADMIN_ADDRESS });
            const wOct = Number(walletBal.totalBalance) / Number(MIST_PER_SUI);
            logger.warn(`   ⚠️  Treasury low. Wallet: ${wOct.toFixed(4)} OCT`);

            if (wOct > ADMIN_LOW_THRESHOLD_OCT) {
                const tx = new Transaction();
                tx.setSender(ADMIN_ADDRESS);
                const [coin] = tx.splitCoins(tx.gas, [FUNDING_AMOUNT_MIST]);
                tx.moveCall({
                    target: `${PACKAGE_ID}::treasury::fund`,
                    arguments: [tx.object(ADMIN_CAP_ID), tx.object(TREASURY_ID), coin],
                });
                const result = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx });
                await client.waitForTransaction({ digest: result.digest });
                logger.info(`   ✅ Auto-funded 1 OCT → digest: ${result.digest}`);
            } else {
                logger.error(`\n🚨 CRITICAL ALERT: Admin wallet is critically low (${wOct.toFixed(4)} OCT).`);
                logger.error(`🚨 Treasury balance: ${tOct.toFixed(4)} OCT. Manual top-up required immediately!\n`);
            }
        } else {
            logger.info(`   ✅ Healthy.`);
        }
    } catch (err: any) {
        logger.error(`   ❌ Maintenance error: ${err.message}`);
    }
}

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws: WebSocket) => {
    logger.info('🔌 WS client connected');
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
        else clearInterval(pingInterval);
    }, WS_PING_INTERVAL_MS);

    ws.on('pong', () => {});
    ws.on('message', async (raw) => {
        if (isRateLimited(ws)) {
            wsSend(ws, { type: 'ERROR', message: 'Rate limit exceeded.' });
            return;
        }
        try {
            const msg = JSON.parse(raw.toString());
            logger.info(`📨 WS [${msg.type}]${msg.gameId ? ` room:${msg.gameId}` : ''}`);
            switch (msg.type) {
                case 'JOIN_ROOM':       await handleJoinRoom(ws, msg); break;
                case 'SUBMIT_TOSS':     await handleSubmitToss(ws, msg); break;
                case 'CHOOSE_BAT_BOWL': await handleBatBowlChoice(ws, msg); break;
                case 'SUBMIT_MOVE':     await handleSubmitMove(ws, msg); break;
                default: wsSend(ws, { type: 'ERROR', message: `Unknown message type: ${msg.type}` });
            }
        } catch {
            wsSend(ws, { type: 'ERROR', message: 'Invalid JSON.' });
        }
    });

    ws.on('close', () => {
        clearInterval(pingInterval);
        wsRateMap.delete(ws);
        handleDisconnect(ws);
        logger.info('🔌 WS client disconnected');
    });

    ws.on('error', (err) => logger.error(`❌ WS error: ${err.message}`));
    wsSend(ws, { type: 'CONNECTED', message: 'Hand Cricket backend ready' });
});

httpServer.listen(PORT, () => {
    logger.info('\n══════════════════════════════════════════════════');
    logger.info('🏏  Hand Cricket Backend  —  Production Ready');
    logger.info('══════════════════════════════════════════════════');
    logger.info(`🌐 HTTP      → http://localhost:${PORT}`);
    logger.info(`🔌 WebSocket → ws://localhost:${PORT}`);
    logger.info(`👛 Admin     → ${ADMIN_ADDRESS}`);
    logger.info(`📦 Package   → ${PACKAGE_ID}`);
    logger.info('──────────────────────────────────────────────────');
    logger.info('  GET  /health                 (public)');
    logger.info('  GET  /health/ws              (public)');
    logger.info('  GET  /metrics                (auth required)');
    logger.info('  GET  /api/balance            (auth required)');
    logger.info('  POST /api/activate-game       (auth required)');
    logger.info('  POST /api/resolve-toss       (auth required)');
    logger.info('  POST /api/settle-innings     (auth required)');
    logger.info('  POST /api/switch-innings     (auth required)');
    logger.info('  POST /api/end-game           (auth required)');
    logger.info('  POST /api/forfeit            (auth required)');
    logger.info('  POST /api/pvp/forfeit        (auth required)');
    logger.info('  GET  /api/pvp/room/:gameId   (auth required)');
    logger.info('══════════════════════════════════════════════════\n');
    setTimeout(() => {
        runMaintenance();
        setInterval(runMaintenance, MAINTENANCE_INTERVAL_MS);
    }, 5_000);
});