import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeFunctionData,
  encodeEventTopics,
  encodeAbiParameters,
  parseAbiParameters,
  type Hex,
} from 'viem';
import {
  perpPoolWriteAbi,
  binaryPoolWriteAbi,
  orderBookEventsAbi,
  type PerpMarket,
} from '@somnia-chain/markets-sdk';
import probe from '../../docs/probe-results.json' with { type: 'json' };
import { agentFixture, agentNow } from '../agent-fixtures';
import { rpc, sdk } from '../../packages/dreamdex-adapter';
import {
  operatorAbi,
  readPermissions,
  prepareOperatorAction,
  encodeOperatorAction,
  verifiedSelectors,
  assertOperatorReview,
  assertLiveExecutionDisabled,
  submitIsolatedMock,
  reconcileOperator,
  type OperatorPreview,
} from '../../packages/agent-execution';
import { evaluateAgent } from '../../packages/agent-engine';
import { AgentStore } from '../../packages/agent-store';
const owner = '0x' + '1'.repeat(40),
  operator = '0x' + '2'.repeat(40),
  hash = '0x' + 'a'.repeat(64);
function context() {
  const f = agentFixture();
  f.config.ownerAddress = owner;
  f.config.operatorAddress = operator;
  f.config.mode = 'ASSISTED';
  f.account.source = 'chain';
  f.account.exposureComplete = true;
  f.account.gasSTT = '1';
  f.account.permissions = { place: true, cancel: true, reduce: true, checkedAt: agentNow };
  f.account.verifiedLeverage = 5;
  const decision = evaluateAgent(f.config, f.observation, f.runtime, agentNow);
  return { ...f, decision };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(agentNow);
  vi.spyOn(rpc, 'getChainId').mockResolvedValue(50383);
  vi.spyOn(rpc, 'getBlockNumber').mockResolvedValue(100n);
  vi.spyOn(rpc, 'getBytecode').mockResolvedValue('0x1234');
  vi.spyOn(rpc, 'getBalance').mockResolvedValue(10n ** 18n);
  vi.spyOn(rpc, 'readContract').mockResolvedValue(true as never);
  vi.spyOn(rpc, 'call').mockResolvedValue({ data: '0x' } as never);
  vi.spyOn(rpc, 'estimateGas').mockResolvedValue(1000000n);
  vi.spyOn(rpc, 'getGasPrice').mockResolvedValue(1000n);
  vi.spyOn(rpc, 'getTransactionCount').mockResolvedValue(0);
  vi.spyOn(sdk.client, 'getMaxPerpOrderSize').mockResolvedValue({
    priceable: true,
    placeable: true,
    maxQuantity: 10n ** 30n,
    limitedBy: 'none',
  } as never);
  vi.spyOn(sdk.client, 'getPerpSystemConfig').mockResolvedValue({
    fullyWired: true,
    collateralToken: agentFixture().detail.market.quoteToken,
  } as never);
  vi.spyOn(sdk.client, 'getOrder').mockResolvedValue({
    owner,
    status: 'Open',
    quantityRemaining: '1000000',
    fullQuantity: '1000000',
  } as never);
});

describe('delegated receipt and order reconciliation with isolated RPC/indexer mocks', () => {
  async function receiptCase(
    kind:
      'resting' | 'partial' | 'filled' | 'delay' | 'reverted' | 'wrong-owner' | 'wrong-operator',
  ) {
    const f = context(),
      pool = f.detail.market.poolAddress;
    vi.spyOn(sdk.client, 'listPerpMarkets').mockResolvedValue(
      probe.markets.data as unknown as PerpMarket[],
    );
    const data = encodeOperatorAction(
      owner as `0x${string}`,
      { kind: 'place', proposal: f.decision.proposal! },
      1800000010000000000n,
    );
    const placed = {
      address: pool,
      topics: encodeEventTopics({
        abi: orderBookEventsAbi,
        eventName: 'OrderPlaced',
        args: { orderId: 1n },
      }),
      data: encodeAbiParameters(
        parseAbiParameters('(uint128,bool,address,uint64,uint256,uint256,uint256,uint64)'),
        [[1n, true, owner as `0x${string}`, 0n, 1n, 100n, 100n, 0n]],
      ),
    };
    const logs = [placed];
    if (kind === 'partial' || kind === 'filled')
      logs.push({
        address: pool,
        topics: encodeEventTopics({
          abi: orderBookEventsAbi,
          eventName: 'OrderFilled',
          args: { takerOrderId: 1n, makerOrderId: 2n },
        }),
        data: encodeAbiParameters(parseAbiParameters('uint256,uint256,uint256,uint256'), [
          50n,
          kind === 'filled' ? 0n : 50n,
          50n,
          1n,
        ]),
      });
    vi.spyOn(rpc, 'getTransaction').mockResolvedValue({
      from: kind === 'wrong-operator' ? owner : operator,
      to: pool,
      input: data,
    } as never);
    vi.spyOn(rpc, 'getTransactionReceipt').mockResolvedValue({
      status: kind === 'reverted' ? 'reverted' : 'success',
      blockNumber: 100n,
      logs: kind === 'reverted' ? [] : logs,
    } as never);
    vi.spyOn(rpc, 'getBlock').mockResolvedValue({ timestamp: 1800000000n } as never);
    if (kind === 'delay')
      vi.mocked(sdk.client.getOrder).mockRejectedValue(new Error('Indexer delayed'));
    else
      vi.mocked(sdk.client.getOrder).mockResolvedValue({
        owner: kind === 'wrong-owner' ? operator : owner,
        status: 'Open',
        quantityRemaining: '100',
        fullQuantity: '100',
      } as never);
    return { config: f.config, data };
  }
  it.each([
    ['resting', 'resting'],
    ['partial', 'partial'],
    ['filled', 'filled'],
    ['delay', 'syncing'],
    ['reverted', 'reverted'],
  ] as const)('reconciles %s without equating receipt success with a fill', async (kind, state) => {
    const f = await receiptCase(kind),
      result = await reconcileOperator(f.config, hash as Hex, f.data);
    expect(result.state).toBe(state);
    expect(result.transactionTimestamp).toBe(agentNow);
    expect(result.indexerStatus).toBe(
      ['delay', 'reverted'].includes(kind) ? 'not-observed' : 'available',
    );
    expect(result.evidenceKind).toBe('ON_CHAIN_RECEIPT');
  });
  it.each(['wrong-owner', 'wrong-operator'] as const)('rejects %s attribution', async (kind) => {
    const f = await receiptCase(kind);
    await expect(reconcileOperator(f.config, hash as Hex, f.data)).rejects.toThrow(/match|owner/);
  });
  it('requires the exact reviewed calldata', async () => {
    const f = await receiptCase('resting');
    await expect(reconcileOperator(f.config, hash as Hex, '0x1234')).rejects.toThrow('match');
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(async () => sdk.close());
describe('verified linked-operator ABI, never broadcasts', () => {
  it('a reduction policy cannot enable a non-atomic delegated position close', async () => {
    const f = context();
    f.config.execution.allowPositionReductions = true;
    const p = { ...f.decision.proposal!, action: 'close-position' as const };
    f.account.positions = [
      {
        marketId: f.config.marketId,
        side: p.side === 'long' ? 'short' : 'long',
        quantity: p.quantity,
        entryPrice: String(f.detail.market.markPrice),
        notional: p.notional,
        unrealizedPnl: '0',
        source: 'chain',
      },
    ];
    await expect(
      prepareOperatorAction(
        f.config,
        { kind: 'place', proposal: p },
        {
          market: f.detail.market,
          decision: { ...f.decision, proposal: p },
          observation: f.observation,
          runtime: f.runtime,
        },
      ),
    ).rejects.toThrow('no atomic reduce-only');
    expect(rpc.call).not.toHaveBeenCalled();
  });
  it('matches all published selectors and installed SDK parameter suffixes', () => {
    expect(verifiedSelectors()).toEqual([
      { name: 'placeOrderFor', selector: '0x80054449' },
      { name: 'cancelOrderFor', selector: '0xe37b444b' },
      { name: 'reduceOrderFor', selector: '0x364c2587' },
    ]);
    for (const [delegated, direct, abi] of [
      ['placeOrderFor', 'placeOrder', perpPoolWriteAbi],
      ['cancelOrderFor', 'cancelOrder', perpPoolWriteAbi],
      ['reduceOrderFor', 'reduceOrder', binaryPoolWriteAbi],
    ] as const) {
      const a = operatorAbi.find((v) => v.type === 'function' && v.name === delegated)!,
        b = abi.find((v) => v.type === 'function' && v.name === direct)!;
      if (a.type !== 'function' || b.type !== 'function') throw Error('Missing official ABI');
      expect(a.inputs.slice(1).map((v) => v.type)).toEqual(b.inputs.map((v) => v.type));
    }
  });
  it('encodes owner separately from operator for place, cancel and resting-order reduction', () => {
    const f = context(),
      p = f.decision.proposal!;
    const placed = decodeFunctionData({
      abi: operatorAbi,
      data: encodeOperatorAction(
        owner as `0x${string}`,
        { kind: 'place', proposal: p },
        1800000010000000000n,
      ),
    });
    expect(placed.functionName).toBe('placeOrderFor');
    expect(placed.args[0]).toBe(owner);
    expect(
      decodeFunctionData({
        abi: operatorAbi,
        data: encodeOperatorAction(
          owner as `0x${string}`,
          { kind: 'reduce-order', orderId: '1', newQuantityRemaining: '100000' },
          0n,
        ),
      }),
    ).toMatchObject({ functionName: 'reduceOrderFor', args: [owner, 1n, 100000n] });
  });
  it('checks each permission at the pool, at the same chain block, and reads actual operator gas', async () => {
    const f = context(),
      p = await readPermissions(f.config, f.detail.market);
    expect(p).toMatchObject({
      place: true,
      cancel: true,
      reduce: true,
      gasSTT: '1',
      block: '100',
      broadcastEnabled: false,
    });
    expect(rpc.readContract).toHaveBeenCalledTimes(3);
    expect(vi.mocked(rpc.readContract).mock.calls.every(([p]) => p.blockNumber === 100n)).toBe(
      true,
    );
  });
  it.each(['wrong-chain', 'legacy', 'revoked'] as const)('fails closed for %s', async (kind) => {
    const f = context();
    if (kind === 'wrong-chain') {
      vi.mocked(rpc.getChainId).mockResolvedValue(1);
      await expect(readPermissions(f.config, f.detail.market)).rejects.toThrow('mismatch');
    } else {
      if (kind === 'legacy') vi.mocked(rpc.getBytecode).mockResolvedValue(undefined);
      if (kind === 'revoked') vi.mocked(rpc.readContract).mockResolvedValue(false as never);
      expect((await readPermissions(f.config, f.detail.market)).place).toBe(false);
    }
  });
  it('prepares and simulates a correctly sized owner order without any signer', async () => {
    const f = context(),
      p = await prepareOperatorAction(
        f.config,
        { kind: 'place', proposal: f.decision.proposal! },
        {
          market: f.detail.market,
          decision: f.decision,
          observation: f.observation,
          runtime: f.runtime,
        },
      );
    expect(p.operator).toBe(operator);
    expect(p.owner).toBe(owner);
    expect(p.gas).toBe('1250000');
    expect(p.value).toBe('0');
    expect(p.broadcastEnabled).toBe(false);
    const fresh = await prepareOperatorAction(
      f.config,
      { kind: 'place', proposal: f.decision.proposal! },
      {
        market: f.detail.market,
        decision: f.decision,
        observation: f.observation,
        runtime: f.runtime,
        approvedData: p.data,
      },
    );
    expect(fresh.data).toBe(p.data);
    assertOperatorReview(p, fresh);
  });
  it.each([
    'paper',
    'gas',
    'simulation',
    'size',
    'wiring',
    'unknown',
    'lease',
    'revoked-during-preflight',
  ] as const)('blocks %s before returning a ready preview', async (kind) => {
    const f = context();
    if (kind === 'paper') f.account.source = 'paper';
    if (kind === 'gas') vi.mocked(rpc.getBalance).mockResolvedValue(0n);
    if (kind === 'simulation')
      vi.mocked(rpc.call).mockRejectedValue(new Error('Simulation reverted'));
    if (kind === 'size')
      vi.mocked(sdk.client.getMaxPerpOrderSize).mockResolvedValue({
        priceable: true,
        placeable: false,
        maxQuantity: 0n,
        limitedBy: 'voucherBlocked',
      } as never);
    if (kind === 'wiring')
      vi.mocked(sdk.client.getPerpSystemConfig).mockResolvedValue({
        fullyWired: false,
        collateralToken: f.detail.market.quoteToken,
      } as never);
    if (kind === 'unknown') f.runtime.unknownIntent = true;
    if (kind === 'lease') f.runtime.leaseValid = false;
    if (kind === 'revoked-during-preflight')
      vi.mocked(rpc.readContract)
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(true as never)
        .mockResolvedValue(false as never);
    await expect(
      prepareOperatorAction(
        f.config,
        { kind: 'place', proposal: f.decision.proposal! },
        {
          market: f.detail.market,
          decision: f.decision,
          observation: f.observation,
          runtime: f.runtime,
        },
      ),
    ).rejects.toThrow();
  });
  it('supports only owned open resting cancellation/shrinkage with an explicit action policy', async () => {
    const f = context();
    await expect(
      prepareOperatorAction(
        f.config,
        { kind: 'cancel', orderId: '1' },
        { market: f.detail.market, runtime: f.runtime },
      ),
    ).rejects.toThrow('action policy');
    f.config.execution.allowRestingCancellations = true;
    const p = await prepareOperatorAction(
      f.config,
      { kind: 'cancel', orderId: '1' },
      { market: f.detail.market, runtime: f.runtime },
    );
    expect(decodeFunctionData({ abi: operatorAbi, data: p.data }).functionName).toBe(
      'cancelOrderFor',
    );
    await expect(
      prepareOperatorAction(
        f.config,
        { kind: 'reduce-order', orderId: '1', newQuantityRemaining: '1000001' },
        { market: f.detail.market, runtime: f.runtime },
      ),
    ).rejects.toThrow('lower');
    vi.mocked(sdk.client.getOrder).mockResolvedValue({
      owner: operator,
      status: 'Open',
      quantityRemaining: '1000000',
    } as never);
    await expect(
      prepareOperatorAction(
        f.config,
        { kind: 'cancel', orderId: '1' },
        { market: f.detail.market, runtime: f.runtime },
      ),
    ).rejects.toThrow('another owner');
  });
  it('a changed reviewed estimate/calldata/nonce requires new human review and live mode cannot activate', async () => {
    const f = context(),
      p = await prepareOperatorAction(
        f.config,
        { kind: 'place', proposal: f.decision.proposal! },
        {
          market: f.detail.market,
          decision: f.decision,
          observation: f.observation,
          runtime: f.runtime,
        },
      );
    for (const changed of [
      { ...p, data: '0x1234' as Hex },
      { ...p, pendingNonce: 1 },
      { ...p, estimatedGasSTT: '999' },
    ])
      expect(() => assertOperatorReview(p, changed)).toThrow('renewed');
    expect(() => assertLiveExecutionDisabled()).toThrow('disabled');
  });
});
describe('isolated mock dispatch persistence/nonce coordination', () => {
  async function setup() {
    const f = context(),
      s = new AgentStore(':memory:');
    s.save(f.config, undefined, agentNow);
    const lease = s.acquire('mock-worker', agentNow)!;
    const p: OperatorPreview = await prepareOperatorAction(
      f.config,
      { kind: 'place', proposal: f.decision.proposal! },
      {
        market: f.detail.market,
        decision: f.decision,
        observation: f.observation,
        runtime: f.runtime,
      },
    );
    return { ...f, s, lease, p };
  }
  it('stores intent before a mocked send and blocks duplicate/unresolved submissions after restart', async () => {
    const f = await setup();
    try {
      const send = vi.fn(async () => {
        expect(f.s.unresolved(f.config.id)[0].state).toBe('prepared');
        return hash;
      });
      await submitIsolatedMock(
        f.s,
        f.lease,
        f.config,
        f.decision,
        f.p,
        { kind: 'MOCK', send },
        agentNow,
      );
      await expect(
        submitIsolatedMock(
          f.s,
          f.lease,
          f.config,
          f.decision,
          f.p,
          { kind: 'MOCK', send },
          agentNow,
        ),
      ).rejects.toThrow('Duplicate');
      expect(send).toHaveBeenCalledTimes(1);
      expect(f.s.unresolved()[0].nonce).toBe(0);
    } finally {
      f.s.close();
    }
  });
  it('a wallet rejection is terminal; transport loss preserves an unknown intent', async () => {
    for (const rejected of [true, false]) {
      const f = await setup();
      try {
        await expect(
          submitIsolatedMock(
            f.s,
            f.lease,
            f.config,
            f.decision,
            f.p,
            {
              kind: 'MOCK',
              send: async () => {
                throw rejected ? { code: 4001 } : new Error('transport lost');
              },
            },
            agentNow,
          ),
        ).rejects.toBeDefined();
        const record = f.s.db.prepare('SELECT state FROM agent_intents').get() as { state: string };
        expect(record.state).toBe(rejected ? 'rejected' : 'unknown');
      } finally {
        f.s.close();
      }
    }
  });
  it('retains a late mock hash after timeout and never sends a second request', async () => {
    const f = await setup();
    try {
      let resolveHash!: (h: string) => void;
      const response = new Promise<string>((r) => {
        resolveHash = r;
      });
      await expect(
        submitIsolatedMock(
          f.s,
          f.lease,
          f.config,
          f.decision,
          f.p,
          { kind: 'MOCK', send: () => response },
          agentNow,
          5,
        ),
      ).rejects.toThrow('timeout');
      expect(f.s.unresolved()[0].state).toBe('unknown');
      resolveHash(hash);
      await response;
      await new Promise((r) => setTimeout(r, 0));
      expect(f.s.unresolved()[0].hash).toBe(hash);
    } finally {
      f.s.close();
    }
  });
  it('a pending emergency stop prevents even isolated mock dispatch', async () => {
    const f = await setup();
    try {
      f.s.command(f.config.id, 'emergency-stop', 1, agentNow);
      const send = vi.fn(async () => hash);
      await expect(
        submitIsolatedMock(
          f.s,
          f.lease,
          f.config,
          f.decision,
          f.p,
          { kind: 'MOCK', send },
          agentNow,
        ),
      ).rejects.toThrow('control');
      expect(send).not.toHaveBeenCalled();
    } finally {
      f.s.close();
    }
  });
});
