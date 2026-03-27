import { Transaction } from '@mysten/sui/transactions';
import { SuiClient } from '@onelabs/sui/client';
import { PACKAGE_ID, TREASURY_ID, BET_AMOUNT } from './constants';

// CPU game — user only touches their own coins + shared Treasury.
// GAME_CAP_ID is NOT needed here — backend calls activate_game separately.
export const createGameTx = (): Transaction => {
    const tx = new Transaction();
    const [betCoin] = tx.splitCoins(tx.gas, [BET_AMOUNT]);
    tx.moveCall({
        target: `${PACKAGE_ID}::game::user_create_game`,
        arguments: [
            tx.object(TREASURY_ID),
            betCoin,
        ],
    });
    return tx;
};

export const createPvPGameTx = (): Transaction => {
    const tx = new Transaction();
    const [betCoin] = tx.splitCoins(tx.gas, [BET_AMOUNT]);
    tx.moveCall({
        target: `${PACKAGE_ID}::pvp_game::create_game`,
        arguments: [betCoin],
    });
    return tx;
};

export const joinPvPGameTx = (gameId: string): Transaction => {
    const tx = new Transaction();
    const [betCoin] = tx.splitCoins(tx.gas, [BET_AMOUNT]);
    tx.moveCall({
        target: `${PACKAGE_ID}::pvp_game::join_game`,
        arguments: [tx.object(gameId), betCoin],
    });
    return tx;
};

export async function hasSufficientBalanceForBet(client: SuiClient, address: string): Promise<boolean> {
    const balance = await client.getBalance({ owner: address });
    return BigInt(balance.totalBalance) >= BET_AMOUNT;
}