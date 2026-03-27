module hand_cricket::pvp_game;

use one::coin::{Self, Coin};
use one::oct::OCT;
use one::balance::{Self, Balance};
use one::event;
use hand_cricket::treasury::{Self, GameCap};

// ===== Status Constants =====

const STATUS_WAITING: u8 = 0;
const STATUS_TOSS: u8 = 1;
const STATUS_PLAYING: u8 = 2;
const STATUS_FINISHED: u8 = 3;

// ===== Batter Constants =====

const BATTING_P1: u8 = 0;
const BATTING_P2: u8 = 1;

// ===== Error Codes =====

const ENotWaiting: u64 = 0;
const ENotInToss: u64 = 1;
const ENotPlaying: u64 = 2;
const ENotFinished: u64 = 3;
const EWrongBetAmount: u64 = 4;
const ESamePlayer: u64 = 5;
const EInningsDidNotEnd: u64 = 6;
const EInningsAlreadySwitched: u64 = 7;
const EInvalidForfeiter: u64 = 8;
const EInvalidMove: u64 = 9;

// ===== Events =====

public struct PvPGameCreated has copy, drop {
    game_id: ID,
    player1: address,
}

public struct PvPGameJoined has copy, drop {
    game_id: ID,
    player2: address,
}

public struct PvPTossResolved has copy, drop {
    game_id: ID,
    first_batter: u8,
}

public struct PvPInningsSwitched has copy, drop {
    game_id: ID,
}

public struct PvPGameEnded has copy, drop {
    game_id: ID,
    winner: address,
    player1_score: u64,
    player2_score: u64,
}

public struct PvPGameForfeited has copy, drop {
    game_id: ID,
    forfeiter: address,
    recipient: address,
}

// ===== Structs =====

public struct PvPGame has key {
    id: UID,
    player1: address,
    player2: Option<address>,
    player1_bet: Balance<OCT>,
    player2_bet: Balance<OCT>,
    status: u8,
    current_batter: u8,
    innings: u8,
    player1_score: u64,
    player2_score: u64,
    target_score: u64,
    winner: Option<address>,
}

// ===== Public Functions =====

public fun create_game(player1_bet: Coin<OCT>, ctx: &mut TxContext) {
    // FIX: use treasury::bet_amount() — single source of truth, no local constant
    assert!(coin::value(&player1_bet) == treasury::bet_amount(), EWrongBetAmount);
    let player1 = tx_context::sender(ctx);
    let game = PvPGame {
        id: object::new(ctx),
        player1,
        player2: option::none(),
        player1_bet: coin::into_balance(player1_bet),
        player2_bet: balance::zero<OCT>(),
        status: STATUS_WAITING,
        current_batter: BATTING_P1,
        innings: 1,
        player1_score: 0,
        player2_score: 0,
        target_score: 0,
        winner: option::none(),
    };
    event::emit(PvPGameCreated { game_id: object::id(&game), player1 });
    transfer::share_object(game);
}

public fun join_game(game: &mut PvPGame, player2_bet: Coin<OCT>, ctx: &mut TxContext) {
    assert!(game.status == STATUS_WAITING, ENotWaiting);
    assert!(coin::value(&player2_bet) == treasury::bet_amount(), EWrongBetAmount);

    let sender = tx_context::sender(ctx);
    assert!(sender != game.player1, ESamePlayer);

    balance::join(&mut game.player2_bet, coin::into_balance(player2_bet));
    game.player2 = option::some(sender);
    game.status = STATUS_TOSS;
    event::emit(PvPGameJoined { game_id: object::id(game), player2: sender });
}

public fun resolve_toss(
    _: &GameCap,
    game: &mut PvPGame,
    p1_chose_odd: bool,
    p1_toss: u64,
    p2_toss: u64,
    toss_winner_bats: bool,
) {
    assert!(game.status == STATUS_TOSS, ENotInToss);

    let total = p1_toss + p2_toss;
    let is_odd = (total % 2) == 1;
    let p1_won_toss = (p1_chose_odd && is_odd) || (!p1_chose_odd && !is_odd);

    game.current_batter = if (p1_won_toss) {
        if (toss_winner_bats) BATTING_P1 else BATTING_P2
    } else {
        if (toss_winner_bats) BATTING_P2 else BATTING_P1
    };

    game.status = STATUS_PLAYING;
    event::emit(PvPTossResolved { game_id: object::id(game), first_batter: game.current_batter });
}

public fun settle_innings(
    _: &GameCap,
    game: &mut PvPGame,
    p1_moves: vector<u64>,
    p2_moves: vector<u64>,
) {
    assert!(game.status == STATUS_PLAYING, ENotPlaying);

    let p1_addr = game.player1;
    let p2_addr = *option::borrow(&game.player2);

    if (game.current_batter == BATTING_P1) {
        game.player1_score = 0;
    } else {
        game.player2_score = 0;
    };

    let len = vector::length(&p1_moves);
    let mut i = 0;
    let mut ended = false;

    while (i < len) {
        let p1 = *vector::borrow(&p1_moves, i);
        let p2 = *vector::borrow(&p2_moves, i);

        
        assert!(p1 >= 1 && p1 <= 6, EInvalidMove);
        assert!(p2 >= 1 && p2 <= 6, EInvalidMove);

        if (p1 == p2) {
            if (game.innings == 1) {
                let batter_score = if (game.current_batter == BATTING_P1) {
                    game.player1_score
                } else {
                    game.player2_score
                };
                game.target_score = batter_score + 1;
            } else {
                game.status = STATUS_FINISHED;
                let chaser_score = if (game.current_batter == BATTING_P1) {
                    game.player1_score
                } else {
                    game.player2_score
                };

                if (game.current_batter == BATTING_P1) {
                    game.winner = option::some(
                        if (chaser_score >= game.target_score) { p1_addr } else { p2_addr }
                    );
                } else {
                    game.winner = option::some(
                        if (chaser_score >= game.target_score) { p2_addr } else { p1_addr }
                    );
                };
            };
            ended = true;
            break

        } else {
            if (game.current_batter == BATTING_P1) {
                game.player1_score = game.player1_score + p1;
                if (game.innings == 2 && game.player1_score >= game.target_score) {
                    game.status = STATUS_FINISHED;
                    game.winner = option::some(p1_addr);
                    ended = true;
                    break
                };
            } else {
                game.player2_score = game.player2_score + p2;
                if (game.innings == 2 && game.player2_score >= game.target_score) {
                    game.status = STATUS_FINISHED;
                    game.winner = option::some(p2_addr);
                    ended = true;
                    break
                };
            };
        };

        i = i + 1;
    };

    assert!(ended, EInningsDidNotEnd);
}

public fun switch_innings(_: &GameCap, game: &mut PvPGame) {
    assert!(game.status == STATUS_PLAYING, ENotPlaying);
    assert!(game.innings == 1, EInningsAlreadySwitched);
    game.innings = 2;
    game.current_batter = if (game.current_batter == BATTING_P1) BATTING_P2 else BATTING_P1;
    event::emit(PvPInningsSwitched { game_id: object::id(game) });
}

public fun end_game(_: &GameCap, game: PvPGame, ctx: &mut TxContext) {
    assert!(game.status == STATUS_FINISHED, ENotFinished);

    
    let game_id = object::id(&game);
    let p1_score = game.player1_score;
    let p2_score = game.player2_score;

    let PvPGame {
        id,
        player1,
        player2,
        player1_bet,
        player2_bet,
        status: _,
        current_batter: _,
        innings: _,
        player1_score: _,
        player2_score: _,
        target_score: _,
        winner,
    } = game;

    object::delete(id);

    let mut payout = coin::from_balance(player1_bet, ctx);
    coin::join(&mut payout, coin::from_balance(player2_bet, ctx));

    let _p2 = option::destroy_some(player2);

    let winner_addr = if (option::is_some(&winner)) {
        let w = option::destroy_some(winner);
        transfer::public_transfer(payout, w);
        w
    } else {

        option::destroy_none(winner);
        transfer::public_transfer(payout, player1);
        player1
    };

    event::emit(PvPGameEnded {
        game_id,
        winner: winner_addr,
        player1_score: p1_score,
        player2_score: p2_score,
    });
}

public fun forfeit_game(
    _: &GameCap,
    game: PvPGame,
    forfeiting_player: address,
    ctx: &mut TxContext,
) {
    let game_id = object::id(&game);
    let status = game.status;

    let PvPGame {
        id,
        player1,
        player2,
        player1_bet,
        player2_bet,
        status: _,
        current_batter: _,
        innings: _,
        player1_score: _,
        player2_score: _,
        target_score: _,
        winner: _,
    } = game;

    object::delete(id);

    let recipient = if (status == STATUS_WAITING) {
        assert!(forfeiting_player == player1, EInvalidForfeiter);
        let refund = coin::from_balance(player1_bet, ctx);
        transfer::public_transfer(refund, player1);
        balance::destroy_zero(player2_bet);
        option::destroy_none(player2);
        player1
    } else {
        let p2_addr = option::destroy_some(player2);
        assert!(forfeiting_player == player1 || forfeiting_player == p2_addr, EInvalidForfeiter);

        let mut payout = coin::from_balance(player1_bet, ctx);
        coin::join(&mut payout, coin::from_balance(player2_bet, ctx));

        let r = if (forfeiting_player == player1) { p2_addr } else { player1 };
        transfer::public_transfer(payout, r);
        r
    };

    event::emit(PvPGameForfeited {
        game_id,
        forfeiter: forfeiting_player,
        recipient,
    });
}

// ===== Read Functions =====

public fun get_player1(game: &PvPGame): address               { game.player1 }
public fun get_player2(game: &PvPGame): &Option<address>      { &game.player2 }
public fun get_status(game: &PvPGame): u8                     { game.status }
public fun get_current_batter(game: &PvPGame): u8             { game.current_batter }
public fun get_innings(game: &PvPGame): u8                    { game.innings }
public fun get_player1_score(game: &PvPGame): u64             { game.player1_score }
public fun get_player2_score(game: &PvPGame): u64             { game.player2_score }
public fun get_target_score(game: &PvPGame): u64              { game.target_score }
public fun get_winner(game: &PvPGame): &Option<address>       { &game.winner }