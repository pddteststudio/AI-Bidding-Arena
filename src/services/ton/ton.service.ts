import crypto from 'node:crypto';
import { env } from '../../config/env';

export interface TonTransferResult {
  success: boolean;
  txHash: string;
  mode: 'mock' | 'mcp' | 'walletlink';
}

export interface TonPaymentRequest {
  address: string;
  amountTon: number;
  amountNano: string;
  memo: string;
  url: string;
}

export class TonService {
  async getBalance(_userId: string): Promise<number> {
    if (env.tonMode === 'mcp') {
      return 999;
    }

    return 999999;
  }

  buildPaymentRequest(input: { userId: string; amountTon: number; auctionId: number }): TonPaymentRequest {
    const address = env.tonReceiverAddress || 'UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ';
    const amountNano = BigInt(Math.round(input.amountTon * 1_000_000_000)).toString();
    const memo = `auction:${input.auctionId}:winner:${input.userId}`;
    const url = `ton://transfer/${address}?amount=${amountNano}&text=${encodeURIComponent(memo)}`;
    return {
      address,
      amountTon: Number(input.amountTon.toFixed(2)),
      amountNano,
      memo,
      url,
    };
  }

  async confirmSettlement(_winnerId: string, _amount: number): Promise<TonTransferResult> {
    if (env.tonMode === 'mcp') {
      return this.confirmViaMcp();
    }

    return {
      success: true,
      txHash: `mock_paid_${crypto.randomBytes(8).toString('hex')}`,
      mode: env.tonMode === 'walletlink' ? 'walletlink' : 'mock',
    };
  }

  private async confirmViaMcp(): Promise<TonTransferResult> {
    console.warn('TON MCP settlement confirmation is configured as an integration point.');
    return {
      success: true,
      txHash: `mcp_paid_${crypto.randomBytes(8).toString('hex')}`,
      mode: 'mcp',
    };
  }
}

export const tonService = new TonService();
