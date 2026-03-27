import { useRef, useEffect } from 'react';
import { WS_URL } from './constants';

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_MS      = 500;
const RECONNECT_MAX_MS       = 8_000;

export interface MsgConnected            { type: 'CONNECTED'; message: string; }
export interface MsgRoomCreated          { type: 'ROOM_CREATED'; gameId: string; }
export interface MsgPlayerJoined         { type: 'PLAYER_JOINED'; p1Address: string; p2Address: string; message: string; }
export interface MsgTossSubmitted        { type: 'TOSS_SUBMITTED'; }
export interface MsgTossResult           { type: 'TOSS_RESULT'; p1Toss: number; p2Toss: number; total: number; isOdd: boolean; p1WonToss: boolean; tossWinnerAddress: string; message: string; }
export interface MsgGameStart            { type: 'GAME_START'; currentBatter: 'p1' | 'p2'; p1Address: string; p2Address: string; innings: 1 | 2; }
export interface MsgBallStart            { type: 'BALL_START'; timestamp: number; currentBatter: 'p1' | 'p2'; innings: 1 | 2; p1Score: number; p2Score: number; targetScore: number; p1ChancesLeft: number; p2ChancesLeft: number; }
export interface MsgMoveAccepted         { type: 'MOVE_ACCEPTED'; yourMove: number; }
export interface MsgBallResult           { type: 'BALL_RESULT'; p1Move: number; p2Move: number; isOut: boolean; p1Score: number; p2Score: number; p1Timeout: boolean; p2Timeout: boolean; p1ForceOut: boolean; p2ForceOut: boolean; p1ChancesLeft: number; p2ChancesLeft: number; }
export interface MsgInningsSwitch        { type: 'INNINGS_SWITCH'; innings: 2; targetScore: number; currentBatter: 'p1' | 'p2'; p1Score: number; p2Score: number; }
export interface MsgGameOver             { type: 'GAME_OVER'; winner: string; p1Address: string; p2Address: string; p1Score: number; p2Score: number; targetScore: number; digest: string; }
export interface MsgOpponentDisconnected { type: 'OPPONENT_DISCONNECTED'; message: string; }
export interface MsgOpponentReconnected  { type: 'OPPONENT_RECONNECTED'; }
export interface MsgReconnected          { type: 'RECONNECTED'; status: 'waiting' | 'toss' | 'playing' | 'finished'; innings: 1 | 2; p1Score: number; p2Score: number; targetScore: number; currentBatter: 'p1' | 'p2'; }
export interface MsgGameForfeited        { type: 'GAME_FORFEITED'; winner: string; loser: string; message: string; digest: string; }
export interface MsgRoomCancelled        { type: 'ROOM_CANCELLED'; }
export interface MsgError                { type: 'ERROR'; message: string; }

export type InboundMessage =
    | MsgConnected | MsgRoomCreated | MsgPlayerJoined | MsgTossSubmitted
    | MsgTossResult | MsgGameStart | MsgBallStart | MsgMoveAccepted
    | MsgBallResult | MsgInningsSwitch | MsgGameOver | MsgOpponentDisconnected
    | MsgOpponentReconnected | MsgReconnected | MsgGameForfeited
    | MsgRoomCancelled | MsgError;

interface OutJoinRoom      { type: 'JOIN_ROOM'; gameId: string; playerAddress: string; isPlayer1: boolean; }
interface OutSubmitToss    { type: 'SUBMIT_TOSS'; gameId: string; playerAddress: string; tossNumber: number; choseOdd?: boolean; }
interface OutChooseBatBowl { type: 'CHOOSE_BAT_BOWL'; gameId: string; chooseBat: boolean; }
interface OutSubmitMove    { type: 'SUBMIT_MOVE'; gameId: string; number: number; }
type OutboundMessage = OutJoinRoom | OutSubmitToss | OutChooseBatBowl | OutSubmitMove;

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

export interface PvPWebSocketOptions {
    gameId:        string;
    playerAddress: string;
    isPlayer1:     boolean;
    url?:          string;

    onStatusChange?:          (status: ConnectionStatus)       => void;
    onConnected?:             (msg: MsgConnected)              => void;
    onRoomCreated?:           (msg: MsgRoomCreated)            => void;
    onPlayerJoined?:          (msg: MsgPlayerJoined)           => void;
    onTossSubmitted?:         (msg: MsgTossSubmitted)          => void;
    onTossResult?:            (msg: MsgTossResult)             => void;
    onGameStart?:             (msg: MsgGameStart)              => void;
    onBallStart?:             (msg: MsgBallStart)              => void;
    onMoveAccepted?:          (msg: MsgMoveAccepted)           => void;
    onBallResult?:            (msg: MsgBallResult)             => void;
    onInningsSwitch?:         (msg: MsgInningsSwitch)          => void;
    onGameOver?:              (msg: MsgGameOver)               => void;
    onOpponentDisconnected?:  (msg: MsgOpponentDisconnected)   => void;
    onOpponentReconnected?:   (msg: MsgOpponentReconnected)    => void;
    onReconnected?:           (msg: MsgReconnected)            => void;
    onGameForfeited?:         (msg: MsgGameForfeited)          => void;
    onRoomCancelled?:         (msg: MsgRoomCancelled)          => void;
    onError?:                 (msg: MsgError)                  => void;
    onRawMessage?:            (msg: InboundMessage)            => void;
}

export class PvPWebSocket {
    private readonly opts:    Readonly<PvPWebSocketOptions>;
    private readonly url:     string;
    private ws:               WebSocket | null = null;
    private status:           ConnectionStatus = 'idle';
    private retryCount:       number           = 0;
    private destroyed:        boolean          = false;
    private reconnectTimer:   ReturnType<typeof setTimeout>  | null = null;
    private queue:            OutboundMessage[]              = [];
    private joinSent:         boolean          = false;   // prevent duplicate JOIN

    constructor(opts: PvPWebSocketOptions) {
        this.opts = opts;
        this.url  = opts.url ?? WS_URL;
    }

   connect(): void {
        if (this.destroyed) return;
        if (this.status === 'connecting' || this.status === 'connected') return;
        this._openSocket();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this._stopReconnect();
        if (this.ws) {
            this.ws.onclose = this.ws.onerror = this.ws.onmessage = this.ws.onopen = null;
            this.ws.close();
            this.ws = null;
        }
        this._setStatus('disconnected');
    }

    submitToss(tossNumber: number, choseOdd?: boolean): void {
        if (!Number.isInteger(tossNumber) || tossNumber < 1 || tossNumber > 6) return;
        const msg: OutSubmitToss = { type: 'SUBMIT_TOSS', gameId: this.opts.gameId, playerAddress: this.opts.playerAddress, tossNumber };
        if (this.opts.isPlayer1) {
            if (choseOdd === undefined) return;
            msg.choseOdd = choseOdd;
        }
        this._enqueue(msg);
    }

    chooseBatOrBowl(chooseBat: boolean): void {
        this._enqueue({ type: 'CHOOSE_BAT_BOWL', gameId: this.opts.gameId, chooseBat });
    }

    submitMove(number: number): void {
        if (!Number.isInteger(number) || number < 1 || number > 6) return;
        this._enqueue({ type: 'SUBMIT_MOVE', gameId: this.opts.gameId, number });
    }

    get connectionStatus(): ConnectionStatus { return this.status; }
    get isConnected(): boolean               { return this.status === 'connected'; }
    get pendingQueueLength(): number         { return this.queue.length; }

    private _openSocket(): void {
        this._setStatus(this.retryCount > 0 ? 'reconnecting' : 'connecting');
        let ws: WebSocket;
        try {
            ws = new WebSocket(this.url);
        } catch (err) {
            console.error('[PvPWS] WebSocket constructor threw:', err);
            this._scheduleReconnect();
            return;
        }
        this.ws = ws;

        ws.onopen = () => {
            if (this.destroyed) { ws.close(); return; }
            // Only send JOIN once per connection (even after reconnect)
            if (!this.joinSent) {
                this.joinSent = true;
                this._sendDirect({
                    type: 'JOIN_ROOM',
                    gameId: this.opts.gameId,
                    playerAddress: this.opts.playerAddress,
                    isPlayer1: this.opts.isPlayer1,
                });
            }
        };

        ws.onmessage = (event) => {
            if (!this.destroyed) this._handleMessage(event);
        };

        ws.onerror = () => {};

        ws.onclose = (event) => {
            if (this.destroyed) return;
            console.warn(`[PvPWS] Closed — code: ${event.code}`);
            this.ws = null;
            this._scheduleReconnect();
        };
    }

    private _handleMessage(event: MessageEvent): void {
        let msg: InboundMessage;
        try {
            msg = JSON.parse(event.data as string) as InboundMessage;
        } catch {
            return;
        }

        if (msg.type === 'CONNECTED') {
            this.retryCount = 0;
            this._setStatus('connected');
            this._flushQueue();
            this.opts.onConnected?.(msg);
        } else if (msg.type === 'RECONNECTED') {
            this.retryCount = 0;
            this._flushQueue();
            this.opts.onReconnected?.(msg);
        } else if (msg.type === 'ROOM_CREATED')           { this.opts.onRoomCreated?.(msg);
        } else if (msg.type === 'PLAYER_JOINED')          { this.opts.onPlayerJoined?.(msg);
        } else if (msg.type === 'TOSS_SUBMITTED')         { this.opts.onTossSubmitted?.(msg);
        } else if (msg.type === 'TOSS_RESULT')            { this.opts.onTossResult?.(msg);
        } else if (msg.type === 'GAME_START')             { this.opts.onGameStart?.(msg);
        } else if (msg.type === 'BALL_START')             { this.opts.onBallStart?.(msg);
        } else if (msg.type === 'MOVE_ACCEPTED')          { this.opts.onMoveAccepted?.(msg);
        } else if (msg.type === 'BALL_RESULT')            { this.opts.onBallResult?.(msg);
        } else if (msg.type === 'INNINGS_SWITCH')         { this.opts.onInningsSwitch?.(msg);
        } else if (msg.type === 'GAME_OVER')              { this.opts.onGameOver?.(msg);
        } else if (msg.type === 'OPPONENT_DISCONNECTED')  { this.opts.onOpponentDisconnected?.(msg);
        } else if (msg.type === 'OPPONENT_RECONNECTED')   { this.opts.onOpponentReconnected?.(msg);
        } else if (msg.type === 'GAME_FORFEITED')         { this.opts.onGameForfeited?.(msg);
        } else if (msg.type === 'ROOM_CANCELLED')         { this.opts.onRoomCancelled?.(msg);
        } else if (msg.type === 'ERROR')                  { console.error('[PvPWS] Server error:', msg.message); this.opts.onError?.(msg);
        }

        this.opts.onRawMessage?.(msg);
    }

    private _enqueue(msg: OutboundMessage): void {
        if (this.ws?.readyState === WebSocket.OPEN && this.status === 'connected') {
            this._sendDirect(msg);
        } else {
            this.queue.push(msg);
        }
    }

    private _sendDirect(msg: OutboundMessage | OutJoinRoom): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        try { this.ws.send(JSON.stringify(msg)); } catch (err) { console.error('[PvPWS] send failed:', err); }
    }

    private _flushQueue(): void {
        if (this.queue.length === 0) return;
        const drain = [...this.queue];
        this.queue = [];
        for (const msg of drain) this._sendDirect(msg);
    }

    private _scheduleReconnect(): void {
        if (this.destroyed) return;
        if (this.retryCount >= MAX_RECONNECT_ATTEMPTS) {
            this._setStatus('failed');
            this.opts.onError?.({ type: 'ERROR', message: `WebSocket failed after ${MAX_RECONNECT_ATTEMPTS} attempts.` });
            return;
        }
        const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.retryCount) + Math.random() * 200, RECONNECT_MAX_MS);
        this.retryCount++;
        this._setStatus('reconnecting');
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.destroyed) this._openSocket();
        }, delay);
    }

    private _stopReconnect(): void {
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    }

    private _setStatus(next: ConnectionStatus): void {
        if (this.status === next) return;
        this.status = next;
        this.opts.onStatusChange?.(next);
    }
}

export function createPvPWebSocket(opts: PvPWebSocketOptions): PvPWebSocket {
    const instance = new PvPWebSocket(opts);
    instance.connect();
    return instance;
}

export function usePvPWebSocket(opts: PvPWebSocketOptions): PvPWebSocket | null {
    const instanceRef = useRef<PvPWebSocket | null>(null);
    const optsRef     = useRef<PvPWebSocketOptions>(opts);

    useEffect(() => { optsRef.current = opts; });

    useEffect(() => {
        const proxied: PvPWebSocketOptions = {
            ...opts,
            onStatusChange:          (s) => optsRef.current.onStatusChange?.(s),
            onConnected:             (m) => optsRef.current.onConnected?.(m),
            onRoomCreated:           (m) => optsRef.current.onRoomCreated?.(m),
            onPlayerJoined:          (m) => optsRef.current.onPlayerJoined?.(m),
            onTossSubmitted:         (m) => optsRef.current.onTossSubmitted?.(m),
            onTossResult:            (m) => optsRef.current.onTossResult?.(m),
            onGameStart:             (m) => optsRef.current.onGameStart?.(m),
            onBallStart:             (m) => optsRef.current.onBallStart?.(m),
            onMoveAccepted:          (m) => optsRef.current.onMoveAccepted?.(m),
            onBallResult:            (m) => optsRef.current.onBallResult?.(m),
            onInningsSwitch:         (m) => optsRef.current.onInningsSwitch?.(m),
            onGameOver:              (m) => optsRef.current.onGameOver?.(m),
            onOpponentDisconnected:  (m) => optsRef.current.onOpponentDisconnected?.(m),
            onOpponentReconnected:   (m) => optsRef.current.onOpponentReconnected?.(m),
            onReconnected:           (m) => optsRef.current.onReconnected?.(m),
            onGameForfeited:         (m) => optsRef.current.onGameForfeited?.(m),
            onRoomCancelled:         (m) => optsRef.current.onRoomCancelled?.(m),
            onError:                 (m) => optsRef.current.onError?.(m),
            onRawMessage:            (m) => optsRef.current.onRawMessage?.(m),
        };

        const instance = new PvPWebSocket(proxied);
        instanceRef.current = instance;
        instance.connect();

        return () => {
            instance.destroy();
            instanceRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opts.gameId, opts.playerAddress, opts.isPlayer1, opts.url]);

    return instanceRef.current;
}