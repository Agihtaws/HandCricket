module hand_cricket::game;

use one::coin::{Self, Coin};
use one::oct::OCT;
use one::balance::{Self, Balance};
use one::event;
use hand_cricket::treasury::{Self, Treasury, GameCap};

// ===== Errors =====

const EWrongBetAmount: u64 = 0;
const EGameNotInProgress: u64 = 1;
const EInvalidMove: u64 = 2;
const EInningsDidNotEnd: u64 = 3;
const EInningsAlreadySwitched: u64 = 4;
const EGameNotPending: u64 = 5;
const EInsufficientTreasury: u64 = 6;

// ===== Status Constants =====

const STATUS_PENDING: u8 = 0;   
const STATUS_TOSS: u8 = 1;
const STATUS_PLAYING: u8 = 2;
const STATUS_FINISHED: u8 = 3;

const BATTING_PLAYER: u8 = 0;
const BATTING_COMPUTER: u8 = 1;

// ===== Events =====

public struct GameCreated has copy, drop {
    game_id: ID,
    player: address,
}

public struct GameActivated has copy, drop {
    game_id: ID,
}

public struct TossResolved has copy, drop {
    game_id: ID,
    first_batter: u8,
}

public struct InningsSwitched has copy, drop {
    game_id: ID,
}

public struct GameEnded has copy, drop {
    game_id: ID,
    player: address,
    winner: Option<address>,
    player_score: u64,
    computer_score: u64,
}

public struct GameForfeited has copy, drop {
    game_id: ID,
    player: address,
}

// ===== Structs =====

public struct Game has key {
    id: UID,
    player: address,
    player_bet: Balance<OCT>,
    treasury_bet: Balance<OCT>,
    status: u8,
    current_batter: u8,
    innings: u8,
    player_score: u64,
    computer_score: u64,
    target_score: u64,
    toss_resolved: bool,
    winner: Option<address>,
}

// ===== Public Functions =====


public fun user_create_game(
    treasury: &mut Treasury,
    player_bet: Coin<OCT>,
    ctx: &mut TxContext,
) {
    assert!(coin::value(&player_bet) == treasury::bet_amount(), EWrongBetAmount);
    assert!(treasury::get_balance(treasury) > 0, EInsufficientTreasury); 
    let player = tx_context::sender(ctx);
    let game = Game {
        id: object::new(ctx),
        player,
        player_bet: coin::into_balance(player_bet),
        treasury_bet: balance::zero<OCT>(),   
        status: STATUS_PENDING,
        current_batter: BATTING_PLAYER,
        innings: 1,
        player_score: 0,
        computer_score: 0,
        target_score: 0,
        toss_resolved: false,
        winner: option::none(),
    };
    event::emit(GameCreated { game_id: object::id(&game), player });
    transfer::share_object(game);
}


public fun activate_game(
    game_cap: &GameCap,
    treasury: &mut Treasury,
    game: &mut Game,
    ctx: &mut TxContext,
) {
    assert!(game.status == STATUS_PENDING, EGameNotPending);
    let treasury_bet = treasury::lock_bet(game_cap, treasury, ctx);
    balance::join(&mut game.treasury_bet, coin::into_balance(treasury_bet));
    game.status = STATUS_TOSS;
    event::emit(GameActivated { game_id: object::id(game) });
}


public fun create_game(
    game_cap: &GameCap,
    treasury: &mut Treasury,
    player_bet: Coin<OCT>,
    ctx: &mut TxContext,
) {
    assert!(coin::value(&player_bet) == treasury::bet_amount(), EWrongBetAmount);
    let treasury_bet = treasury::lock_bet(game_cap, treasury, ctx);
    let player = tx_context::sender(ctx);
    let game = Game {
        id: object::new(ctx),
        player,
        player_bet: coin::into_balance(player_bet),
        treasury_bet: coin::into_balance(treasury_bet),
        status: STATUS_TOSS,
        current_batter: BATTING_PLAYER,
        innings: 1,
        player_score: 0,
        computer_score: 0,
        target_score: 0,
        toss_resolved: false,
        winner: option::none(),
    };
    event::emit(GameCreated { game_id: object::id(&game), player });
    transfer::share_object(game);
}

public fun resolve_toss(
    _game_cap: &GameCap,
    game: &mut Game,
    odd_or_even: bool,
    p_toss: u64,
    c_toss: u64,
    p_chooses_bat: bool,
) {
    assert!(game.status == STATUS_TOSS, EGameNotInProgress);
    let is_odd = ((p_toss + c_toss) % 2) == 1;
    let p_won = (odd_or_even && is_odd) || (!odd_or_even && !is_odd);

    game.current_batter = if (p_won) {
        if (p_chooses_bat) BATTING_PLAYER else BATTING_COMPUTER
    } else {
        if (p_chooses_bat) BATTING_COMPUTER else BATTING_PLAYER
    };

    game.toss_resolved = true;
    game.status = STATUS_PLAYING;
    event::emit(TossResolved { game_id: object::id(game), first_batter: game.current_batter });
}

public fun settle_innings(
    _game_cap: &GameCap,
    game: &mut Game,
    player_moves: vector<u64>,
    computer_moves: vector<u64>,
) {
    assert!(game.status == STATUS_PLAYING, EGameNotInProgress);

    if (game.current_batter == BATTING_PLAYER) {
        game.player_score = 0;
    } else {
        game.computer_score = 0;
    };

    let len = vector::length(&player_moves);
    let mut i = 0;
    let mut ended = false;

    while (i < len) {
        let p = *vector::borrow(&player_moves, i);
        let c = *vector::borrow(&computer_moves, i);

        assert!(p >= 1 && p <= 6, EInvalidMove);
        assert!(c >= 1 && c <= 6, EInvalidMove);

        if (p == c) {
            if (game.innings == 1) {
                game.target_score = (if (game.current_batter == BATTING_PLAYER) {
                    game.player_score
                } else {
                    game.computer_score
                }) + 1;
            } else {
                game.status = STATUS_FINISHED;
                if (game.current_batter == BATTING_PLAYER) {
                    game.winner = if (game.player_score >= game.target_score) {
                        option::some(game.player)
                    } else {
                        option::none()
                    };
                } else {
                    game.winner = if (game.computer_score >= game.target_score) {
                        option::none()
                    } else {
                        option::some(game.player)
                    };
                };
            };
            ended = true;
            break
        } else {
            if (game.current_batter == BATTING_PLAYER) {
                game.player_score = game.player_score + p;
                if (game.innings == 2 && game.player_score >= game.target_score) {
                    game.status = STATUS_FINISHED;
                    game.winner = option::some(game.player);
                    ended = true;
                    break
                };
            } else {
                game.computer_score = game.computer_score + c;
                if (game.innings == 2 && game.computer_score >= game.target_score) {
                    game.status = STATUS_FINISHED;
                    game.winner = option::none();
                    ended = true;
                    break
                };
            };
        };
        i = i + 1;
    };

    assert!(ended, EInningsDidNotEnd);
}

public fun switch_innings(_game_cap: &GameCap, game: &mut Game) {
    assert!(game.status == STATUS_PLAYING, EGameNotInProgress);
    assert!(game.innings == 1, EInningsAlreadySwitched);
    game.innings = 2;
    game.current_batter = if (game.current_batter == BATTING_PLAYER) {
        BATTING_COMPUTER
    } else {
        BATTING_PLAYER
    };
    event::emit(InningsSwitched { game_id: object::id(game) });
}

public fun end_game(game_cap: &GameCap, treasury: &mut Treasury, game: Game, ctx: &mut TxContext) {
    assert!(game.status == STATUS_FINISHED, EGameNotInProgress);

    let game_id = object::id(&game);
    let player_addr = game.player;
    let player_score = game.player_score;
    let computer_score = game.computer_score;
    let winner_for_event = game.winner;

    let Game { id, player_bet, treasury_bet, winner, .. } = game;
    object::delete(id);

    let p_coin = coin::from_balance(player_bet, ctx);
    let t_coin = coin::from_balance(treasury_bet, ctx);

    if (option::is_some(&winner)) {
        let winner_addr = option::destroy_some(winner);
        treasury::payout_winner(game_cap, treasury, p_coin, t_coin, winner_addr);
    } else {
        treasury::reclaim_losing_bet(game_cap, treasury, p_coin, t_coin);
        option::destroy_none(winner);
    };

    event::emit(GameEnded {
        game_id,
        player: player_addr,
        winner: winner_for_event,
        player_score,
        computer_score,
    });
}

public fun forfeit_game(
    game_cap: &GameCap,
    treasury: &mut Treasury,
    game: Game,
    ctx: &mut TxContext,
) {
    let game_id = object::id(&game);
    let player_addr = game.player;

    let Game { id, player_bet, treasury_bet, .. } = game;
    object::delete(id);
    let p_coin = coin::from_balance(player_bet, ctx);
    let t_coin = coin::from_balance(treasury_bet, ctx);
    treasury::reclaim_losing_bet(game_cap, treasury, p_coin, t_coin);
    event::emit(GameForfeited { game_id, player: player_addr });
}

// ===== Read Functions =====

public fun get_player(game: &Game): address { game.player }
public fun get_status(game: &Game): u8 { game.status }
