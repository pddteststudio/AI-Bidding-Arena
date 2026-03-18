import crypto from 'node:crypto';
import { env } from '../../config/env';

export interface TonTransferResult {
  success: boolean;
  txHash: string;
  mode: 'mock' | 'mcp';
}

export class TonService {
  async createBidCharge(userId: string, amount: number): Promise<TonTransferResult> {
    if (env.tonMode === 'mcp') {
      return this.createMcpTransfer(userId, amount);
    }

    return {
      success: env.tonMockConfirm,
      txHash: `mock_${crypto.randomBytes(8).toString('hex')}`,
      mode: 'mock',
    };
  }

  async getBalance(_userId: string): Promise<number> {
    if (env.tonMode === 'mcp') {
      // Placeholder for future MCP integration.
      return 999;
    }

    return 999;
  }

  private async createMcpTransfer(userId: string, amount: number): Promise<TonTransferResult> {
    console.warn(`TON MCP mode is enabled, but real execution is left as an integration point. user=${userId}, amount=${amount}`);
    return {
      success: true,
      txHash: `mcp_placeholder_${crypto.randomBytes(8).toString('hex')}`,
      mode: 'mcp',
    };
  }
}

export const tonService = new TonService();
