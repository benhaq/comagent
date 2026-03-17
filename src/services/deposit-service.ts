import { Context, Effect } from "effect"
import type {
  DatabaseError,
  DepositDuplicateError,
  DepositFundingError,
  CheckoutNoWalletError,
} from "../lib/errors.js"

export interface DepositResult {
  orderId: string
  amountPAS: string
  amountUSDC: string
  crossmintFundingStatus: "funded"
}

export interface DepositServiceShape {
  confirmDeposit(
    userId: string,
    amountPAS: number,
    transactionHash: string,
  ): Effect.Effect<
    DepositResult,
    | DatabaseError
    | DepositDuplicateError
    | DepositFundingError
    | CheckoutNoWalletError
  >
}

export class DepositService extends Context.Tag("DepositService")<
  DepositService,
  DepositServiceShape
>() {}
