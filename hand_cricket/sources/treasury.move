module hand_cricket::treasury;

use one::coin::{Self, Coin};
use one::oct::OCT;
use one::balance::{Self, Balance};
use one::event;

// ===== Constants =====

const BET_AMOUNT: u64 = 100_000_000;
const MIN_RESERVE: u64 = 100_000_000;

// ===== Errors =====

const EInsufficientTreasury: u64 = 0;
const EInvalidAddress: u64 = 1;
const EWrongBetAmount: u64 = 2;

// ===== Events =====

public struct TreasuryFunded has copy, drop {
    amount: u64,
}

public struct TreasuryWithdrawn has copy, drop {
    amount: u64,
    recipient: address,
}

public struct WinnerPaid has copy, drop {
    winner: address,
    amount: u64,
}

// ===== Structs =====

// FIX: removed `store` from AdminCap — prevents public wrapping/transfer
public struct AdminCap has key { id: UID }
public struct GameCap has key { id: UID }

public struct Treasury has key {
    id: UID,
    balance: Balance<OCT>,
    total_games_played: u64,
    total_payouts: u64,
}

// ===== Init =====

fun init(ctx: &mut TxContext) {
    let treasury = Treasury {
        id: object::new(ctx),
        balance: balance::zero<OCT>(),
        total_games_played: 0,
        total_payouts: 0,
    };
    transfer::share_object(treasury);

    let game_cap = GameCap { id: object::new(ctx) };
    transfer::transfer(game_cap, tx_context::sender(ctx));

    let admin_cap = AdminCap { id: object::new(ctx) };
    transfer::transfer(admin_cap, tx_context::sender(ctx));
}

// ===== Admin Functions =====

public fun fund(_: &AdminCap, treasury: &mut Treasury, coin: Coin<OCT>) {
    let amount = coin::value(&coin);
    balance::join(&mut treasury.balance, coin::into_balance(coin));
    event::emit(TreasuryFunded { amount });
}

public fun withdraw(
    _: &AdminCap,
    treasury: &mut Treasury,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert!(recipient != @0x0, EInvalidAddress);
    let current_balance = balance::value(&treasury.balance);
    // FIX: split the check to avoid u64 overflow from amount + MIN_RESERVE
    assert!(current_balance >= MIN_RESERVE, EInsufficientTreasury);
    assert!(current_balance - MIN_RESERVE >= amount, EInsufficientTreasury);
    let withdrawn = coin::from_balance(balance::split(&mut treasury.balance, amount), ctx);
    transfer::public_transfer(withdrawn, recipient);
    event::emit(TreasuryWithdrawn { amount, recipient });
}

// ===== Game Contract Functions =====

// NEW: exposed so game.move and pvp_game.move share a single source of truth
public fun bet_amount(): u64 { BET_AMOUNT }

public fun lock_bet(_: &GameCap, treasury: &mut Treasury, ctx: &mut TxContext): Coin<OCT> {
    let current_balance = balance::value(&treasury.balance);
    // FIX: same safe split pattern as withdraw
    assert!(current_balance >= MIN_RESERVE, EInsufficientTreasury);
    assert!(current_balance - MIN_RESERVE >= BET_AMOUNT, EInsufficientTreasury);
    treasury.total_games_played = treasury.total_games_played + 1;
    coin::from_balance(balance::split(&mut treasury.balance, BET_AMOUNT), ctx)
}

public fun payout_winner(
    _: &GameCap,
    treasury: &mut Treasury,
    player_bet: Coin<OCT>,
    treasury_bet: Coin<OCT>,
    winner: address,
) {
    assert!(winner != @0x0, EInvalidAddress);
    assert!(coin::value(&player_bet) == BET_AMOUNT, EWrongBetAmount);
    assert!(coin::value(&treasury_bet) == BET_AMOUNT, EWrongBetAmount);

    treasury.total_payouts = treasury.total_payouts + 1;

    let mut final_payout = player_bet;
    coin::join(&mut final_payout, treasury_bet);
    let payout_amount = coin::value(&final_payout);
    transfer::public_transfer(final_payout, winner);
    event::emit(WinnerPaid { winner, amount: payout_amount });
}

public fun reclaim_losing_bet(
    _: &GameCap,
    treasury: &mut Treasury,
    player_bet: Coin<OCT>,
    treasury_bet: Coin<OCT>,
) {
    balance::join(&mut treasury.balance, coin::into_balance(player_bet));
    balance::join(&mut treasury.balance, coin::into_balance(treasury_bet));
}

// ===== Read Functions =====

public fun get_balance(treasury: &Treasury): u64 { balance::value(&treasury.balance) }
public fun get_total_games(treasury: &Treasury): u64 { treasury.total_games_played }
public fun get_total_payouts(treasury: &Treasury): u64 { treasury.total_payouts }