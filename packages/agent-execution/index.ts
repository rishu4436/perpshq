import {
  parseAbi,
  encodeFunctionData,
  decodeFunctionData,
  decodeEventLog,
  zeroAddress,
  toFunctionSelector,
  type Address,
  type Hex,
} from 'viem';
import { contractErrorsAbi, orderBookEventsAbi, perpPoolWriteAbi } from '@somnia-chain/markets-sdk';
import { rpc, sdk, marketById } from '../dreamdex-adapter';
import { fromRaw } from '../risk-engine';
import type { AgentConfig } from '../agent-engine/config';
import { LIVE_BROADCAST_ENABLED } from '../agent-engine/config';
import type {
  AgentDecision,
  AgentObservation,
  AgentRuntime,
  ProposedOrder,
} from '../agent-engine/types';
import { assessRisk } from '../agent-risk';
import { AgentStore, type WorkerLease } from '../agent-store';
import type { Market } from '../shared-types';

// Signatures from DreamDEX S.A.'s MIT-licensed official bot kit, pinned in the design doc.
// SDK 0.32.1 does not export these delegated writes. See THIRD-PARTY-NOTICES.md.
export const operatorAbi = [
  ...parseAbi([
    'function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) payable returns (bool success, uint128 orderId)',
    'function cancelOrderFor(address owner, uint128 orderId)',
    'function reduceOrderFor(address owner, uint128 orderId, uint256 newQuantityRemaining)',
    'function isOperatorAuthorized(address owner, address operator, bytes4 selector) view returns (bool)',
  ]),
  ...contractErrorsAbi,
] as const;
export const operatorSelectors = {
  place: '0x80054449',
  cancel: '0xe37b444b',
  reduce: '0x364c2587',
} as const;
export interface PermissionSnapshot {
  owner: string;
  operator: string;
  marketId: string;
  checkedAt: number;
  chainId: 50383;
  block: string;
  accountKind: 'contract-observed' | 'no-contract-code';
  place: boolean;
  cancel: boolean;
  reduce: boolean;
  gasSTT: string;
  broadcastEnabled: false;
}
type Reader = Pick<
  typeof rpc,
  | 'getChainId'
  | 'getBlockNumber'
  | 'getBytecode'
  | 'getBalance'
  | 'readContract'
  | 'call'
  | 'estimateGas'
  | 'getGasPrice'
  | 'getTransactionCount'
  | 'getTransaction'
  | 'getTransactionReceipt'
  | 'getBlock'
>;
export async function readPermissions(
  config: AgentConfig,
  m: Market,
  reader: Reader = rpc,
): Promise<PermissionSnapshot> {
  if (!config.ownerAddress || !config.operatorAddress)
    throw new Error('Configure public owner and dedicated operator addresses first');
  if (config.ownerAddress.toLowerCase() === config.operatorAddress.toLowerCase())
    throw new Error('Owner and operator must differ');
  if (m.id.toLowerCase() !== config.marketId.toLowerCase() || (await reader.getChainId()) !== 50383)
    throw new Error('Hideki market/chain identity mismatch');
  const owner = config.ownerAddress as Address,
    operator = config.operatorAddress as Address,
    blockNumber = await reader.getBlockNumber();
  const [code, balance, ...grants] = await Promise.all([
    reader.getBytecode({ address: owner, blockNumber }),
    reader.getBalance({ address: operator, blockNumber }),
    ...Object.values(operatorSelectors).map((selector) =>
      reader.readContract({
        address: m.poolAddress,
        abi: operatorAbi,
        functionName: 'isOperatorAuthorized',
        args: [owner, operator, selector],
        blockNumber,
      }),
    ),
  ]);
  const contract = !!code && code !== '0x';
  return {
    owner,
    operator,
    marketId: m.id,
    checkedAt: Date.now(),
    chainId: 50383,
    block: blockNumber.toString(),
    accountKind: contract ? 'contract-observed' : 'no-contract-code',
    place: contract && grants[0] === true,
    cancel: contract && grants[1] === true,
    reduce: contract && grants[2] === true,
    gasSTT: fromRaw(balance, 18),
    broadcastEnabled: false,
  };
}
export type OperatorAction =
  | { kind: 'place'; proposal: ProposedOrder }
  | { kind: 'cancel'; orderId: string }
  | { kind: 'reduce-order'; orderId: string; newQuantityRemaining: string };
export function encodeOperatorAction(
  owner: Address,
  action: OperatorAction,
  expiryNs: bigint,
): Hex {
  if (action.kind === 'cancel')
    return encodeFunctionData({
      abi: operatorAbi,
      functionName: 'cancelOrderFor',
      args: [owner, BigInt(action.orderId)],
    });
  if (action.kind === 'reduce-order')
    return encodeFunctionData({
      abi: operatorAbi,
      functionName: 'reduceOrderFor',
      args: [owner, BigInt(action.orderId), BigInt(action.newQuantityRemaining)],
    });
  const p = action.proposal;
  return encodeFunctionData({
    abi: operatorAbi,
    functionName: 'placeOrderFor',
    args: [
      owner,
      p.side === 'long',
      0n,
      BigInt(p.rawPrice),
      BigInt(p.rawQuantity),
      expiryNs,
      p.orderType === 'IOC' ? 2 : 0,
      0,
      zeroAddress,
      0n,
    ],
  });
}
export interface OperatorPreview {
  chainId: 50383;
  owner: string;
  operator: string;
  to: string;
  data: Hex;
  value: '0';
  gas: string;
  gasPrice: string;
  estimatedGasSTT: string;
  pendingNonce: number;
  expiresAt: number;
  configRevision: number;
  decisionId?: string;
  action: OperatorAction['kind'];
  permissions: PermissionSnapshot;
  broadcastEnabled: false;
}
export async function prepareOperatorAction(
  config: AgentConfig,
  action: OperatorAction,
  options: {
    reader?: Reader;
    market?: Market;
    decision?: AgentDecision;
    observation?: AgentObservation;
    runtime?: AgentRuntime;
    approvedData?: Hex;
  } = {},
): Promise<OperatorPreview> {
  const reader = options.reader ?? rpc,
    m = options.market ?? (await marketById(config.marketId)),
    permissions = await readPermissions(config, m, reader);
  if (
    !options.runtime?.leaseValid ||
    !options.runtime.controlAvailable ||
    options.runtime.unknownIntent
  )
    throw new Error(
      'A current worker lease, available control plane and reconciled outcome are required',
    );
  const allowed =
    action.kind === 'place'
      ? permissions.place
      : action.kind === 'cancel'
        ? permissions.cancel
        : permissions.reduce;
  if (!allowed)
    throw new Error('Required market-specific operator permission is missing or revoked');
  if (action.kind === 'place') {
    if (options.observation?.account?.source !== 'chain')
      throw new Error(
        'Unsigned operator preparation requires a verified chain account, not a paper ledger',
      );
    if (
      !options.decision ||
      !options.observation ||
      !options.runtime ||
      options.decision.agentId !== config.id ||
      options.decision.configRevision !== config.revision ||
      options.decision.proposal?.rawQuantity !== action.proposal.rawQuantity ||
      options.decision.proposal.rawPrice !== action.proposal.rawPrice
    )
      throw new Error('A matching current strategy decision and risk context are required');
    const policy = assessRisk(
      config,
      options.observation,
      options.runtime,
      action.proposal,
      Date.now(),
    );
    if (!policy.allowed)
      throw new Error(
        'Agent risk policy blocked preparation: ' +
          policy.checks
            .filter((v) => !v.passed)
            .map((v) => v.name)
            .join(', '),
      );
    if (action.proposal.action !== 'entry' && !config.execution.allowPositionReductions)
      throw new Error('Position reductions require a separately enabled action policy');
    if (action.proposal.action !== 'entry')
      throw new Error(
        'Operator position exit is unavailable: the verified delegated ABI has no atomic reduce-only position operation. Review the owner wallet in the official app.',
      );
    const p = action.proposal,
      max = await sdk.client.getMaxPerpOrderSize({
        pool: m.poolAddress,
        marginBank: m.marginBank,
        account: config.ownerAddress as Address,
        isBid: p.side === 'long',
        price: BigInt(p.rawPrice),
        autoPull: false,
      });
    if (!max.priceable || !max.placeable || BigInt(p.rawQuantity) > max.maxQuantity)
      throw new Error(
        'Official owner sizing blocked the order: ' +
          (max.priceable ? max.limitedBy : 'unpriceable'),
      );
  } else {
    if (!config.execution.allowRestingCancellations)
      throw new Error('Resting-order management requires its action policy to be enabled');
    const order = await sdk.client.getOrder(m.poolAddress, BigInt(action.orderId));
    if (
      !order ||
      order.owner.toLowerCase() !== config.ownerAddress!.toLowerCase() ||
      order.status !== 'Open' ||
      BigInt(order.quantityRemaining) <= 0n
    )
      throw new Error('Order is unavailable, closed or belongs to another owner');
    if (action.kind === 'reduce-order') {
      const q = BigInt(action.newQuantityRemaining);
      if (
        q < BigInt(m.minQuantity) ||
        q >= BigInt(order.quantityRemaining) ||
        q % BigInt(m.lotSize) !== 0n
      )
        throw new Error('Resting reduction must lower remaining quantity and respect minimum/lot');
    }
  }
  const system = await sdk.client.getPerpSystemConfig(m.marginBank);
  if (!system.fullyWired || system.collateralToken.toLowerCase() !== m.quoteToken.toLowerCase())
    throw new Error('Perps collateral wiring is invalid');
  let expiry = BigInt(Date.now() + config.execution.expirySeconds * 1000) * 1000000n;
  if (options.approvedData && action.kind === 'place') {
    const decoded = decodeFunctionData({ abi: operatorAbi, data: options.approvedData });
    if (
      decoded.functionName !== 'placeOrderFor' ||
      decoded.args[5] <= BigInt(Date.now() + 30000) * 1000000n ||
      decoded.args[5] > BigInt(Date.now() + 86400000) * 1000000n
    )
      throw new Error('Approved order expiry/call is invalid');
    expiry = decoded.args[5];
  }
  const data = encodeOperatorAction(config.ownerAddress as Address, action, expiry);
  if (options.approvedData && options.approvedData.toLowerCase() !== data.toLowerCase())
    throw new Error('Approved operator parameters changed; review a new preview');
  const operator = config.operatorAddress as Address;
  await reader.call({ account: operator, to: m.poolAddress, data, value: 0n });
  const gas =
      ((await reader.estimateGas({ account: operator, to: m.poolAddress, data, value: 0n })) *
        125n) /
      100n,
    gasPrice = await reader.getGasPrice();
  const reserve = BigInt(
    new (await import('decimal.js')).default(config.risk.minGasReserveSTT)
      .mul('1e18')
      .ceil()
      .toFixed(0),
  );
  if ((await reader.getBalance({ address: operator })) < gas * gasPrice + reserve)
    throw new Error('Insufficient operator STT for estimated gas plus configured reserve');
  // Recheck grants after sizing/simulation, not only before network I/O.
  const finalPermissions = await readPermissions(config, m, reader);
  if (
    !(action.kind === 'place'
      ? finalPermissions.place
      : action.kind === 'cancel'
        ? finalPermissions.cancel
        : finalPermissions.reduce)
  )
    throw new Error('Operator permission was revoked during preparation');
  return {
    chainId: 50383,
    owner: config.ownerAddress!,
    operator,
    to: m.poolAddress,
    data,
    value: '0',
    gas: gas.toString(),
    gasPrice: gasPrice.toString(),
    estimatedGasSTT: fromRaw(gas * gasPrice, 18),
    pendingNonce: await reader.getTransactionCount({ address: operator, blockTag: 'pending' }),
    expiresAt: Date.now() + 30000,
    configRevision: config.revision,
    decisionId: options.decision?.id,
    action: action.kind,
    permissions: finalPermissions,
    broadcastEnabled: false,
  };
}
export function assertOperatorReview(a: OperatorPreview, b: OperatorPreview) {
  for (const key of [
    'chainId',
    'owner',
    'operator',
    'to',
    'data',
    'value',
    'gas',
    'gasPrice',
    'estimatedGasSTT',
    'pendingNonce',
    'configRevision',
    'decisionId',
    'action',
  ] as const)
    if (String(a[key]).toLowerCase() !== String(b[key]).toLowerCase())
      throw new Error('Operator preview changed; renewed human review is required');
  if (b.expiresAt <= Date.now()) throw new Error('Operator preview expired');
}
export function assertLiveExecutionDisabled(): never {
  throw new Error(
    'Live broadcast is disabled in this release. Separate authorization, verified execution evidence, supervised canary and an authenticated deployment review are required.',
  );
}
export interface IsolatedMockTransport {
  kind: 'MOCK';
  send: (preview: OperatorPreview, nonce: number) => Promise<string>;
}
/** Exercises persistence/recovery with isolated transports. No live signer is constructed or accepted. */
export async function submitIsolatedMock(
  store: AgentStore,
  lease: WorkerLease,
  config: AgentConfig,
  decision: AgentDecision,
  preview: OperatorPreview,
  transport: IsolatedMockTransport,
  now = Date.now(),
  timeoutMs = 1000,
) {
  if ((transport as { kind: string }).kind !== 'MOCK' || LIVE_BROADCAST_ENABLED)
    assertLiveExecutionDisabled();
  if (
    preview.chainId !== 50383 ||
    preview.configRevision !== config.revision ||
    decision.configRevision !== config.revision ||
    preview.owner.toLowerCase() !== config.ownerAddress?.toLowerCase() ||
    preview.operator.toLowerCase() !== config.operatorAddress?.toLowerCase() ||
    preview.to.toLowerCase() !== config.marketId.toLowerCase() ||
    preview.expiresAt <= now
  )
    throw new Error('Mock execution identity or review expired');
  const current = store.get(config.id);
  if (
    current.config.revision !== config.revision ||
    current.runtime.status === 'emergency-stopped' ||
    store
      .commands(config.id)
      .some((c) => !c.acknowledgedAt && ['pause', 'stop', 'emergency-stop'].includes(c.type))
  )
    throw new Error('Agent control/configuration changed before dispatch');
  const key = [
    config.id,
    config.revision,
    decision.id,
    config.ownerAddress!.toLowerCase(),
    config.marketId.toLowerCase(),
  ].join('|');
  const intent = store.reserveIntent(
    lease,
    {
      key,
      agentId: config.id,
      revision: config.revision,
      owner: config.ownerAddress!,
      operator: config.operatorAddress!,
      marketId: config.marketId,
      decisionId: decision.id,
      data: preview.data,
      createdAt: now,
      kind: 'MOCK',
    },
    preview.pendingNonce,
    now,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const send = Promise.resolve()
      .then(() => {
        if (!store.owns(lease, Date.now())) throw new Error('Lease lost before dispatch');
        return transport.send(preview, intent.nonce);
      })
      .then((hash) => {
        if (!/^0x[\da-f]{64}$/i.test(hash)) throw new Error('Invalid mock transaction hash');
        const saved = store.intent(key);
        if (saved && ['prepared', 'unknown'].includes(saved.state))
          store.updateIntent(key, 'sent', hash);
        return hash;
      });
    return await Promise.race([
      send,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Unknown mock transaction outcome: timeout')),
          timeoutMs,
        );
      }),
    ]);
  } catch (e) {
    const saved = store.intent(key);
    if (saved && ['prepared', 'sent'].includes(saved.state))
      store.updateIntent(key, (e as { code?: number }).code === 4001 ? 'rejected' : 'unknown');
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export async function reconcileOperator(
  config: AgentConfig,
  hash: Hex,
  expectedData: Hex,
  reader: Reader = rpc,
) {
  if ((await reader.getChainId()) !== 50383) throw new Error('Receipt chain mismatch');
  const m = await marketById(config.marketId),
    [tx, receipt] = await Promise.all([
      reader.getTransaction({ hash }),
      reader.getTransactionReceipt({ hash }),
    ]);
  const call = decodeFunctionData({ abi: operatorAbi, data: tx.input });
  if (
    tx.from.toLowerCase() !== config.operatorAddress?.toLowerCase() ||
    tx.to?.toLowerCase() !== m.poolAddress.toLowerCase() ||
    tx.input.toLowerCase() !== expectedData.toLowerCase() ||
    !['placeOrderFor', 'cancelOrderFor', 'reduceOrderFor'].includes(call.functionName) ||
    String(call.args[0]).toLowerCase() !== config.ownerAddress?.toLowerCase()
  )
    throw new Error('Delegated transaction evidence does not match owner/operator/market/calldata');
  const block = await reader.getBlock({ blockNumber: receipt.blockNumber }),
    events = receipt.logs
      .filter((log) => log.address.toLowerCase() === m.poolAddress.toLowerCase())
      .flatMap((log) => {
        try {
          return [decodeEventLog({ abi: orderBookEventsAbi, data: log.data, topics: log.topics })];
        } catch {
          return [];
        }
      });
  const placed = events.find((e) => e.eventName === 'OrderPlaced'),
    id =
      call.functionName === 'placeOrderFor'
        ? (placed?.args as { placedOrder?: { orderId?: bigint } } | undefined)?.placedOrder?.orderId
        : call.args[1];
  const order =
    id !== undefined
      ? await sdk.client.getOrder(m.poolAddress, id as bigint).catch(() => null)
      : null;
  if (order && order.owner.toLowerCase() !== config.ownerAddress?.toLowerCase())
    throw new Error('Indexed order owner does not match the reviewed owner');
  const fills = events.filter(
    (e) =>
      e.eventName === 'OrderFilled' && (e.args.makerOrderId === id || e.args.takerOrderId === id),
  );
  const last = fills.at(-1),
    remaining =
      last?.eventName === 'OrderFilled'
        ? last.args.takerOrderId === id
          ? last.args.takerRemainingQuantity
          : last.args.makerRemainingQuantity
        : undefined;
  const { orderOutcome } = await import('../trade-planner/evidence');
  return {
    hash,
    chainId: 50383,
    agentId: config.id,
    configRevision: config.revision,
    owner: config.ownerAddress,
    operator: config.operatorAddress,
    pool: m.poolAddress,
    input: tx.input,
    receipt,
    events,
    orderId: id?.toString(),
    order,
    state: orderOutcome({
      reverted: receipt.status === 'reverted',
      cancellation: call.functionName === 'cancelOrderFor',
      cancelled: events.some((e) => e.eventName === 'OrderCancelled' && e.args.orderId === id),
      rested: events.some((e) => e.eventName === 'OrderRested' && e.args.orderId === id),
      fillCount: fills.length,
      remaining,
      order,
    }),
    indexerStatus: order ? 'available' : 'not-observed',
    checkedAt: Date.now(),
    transactionTimestamp: Number(block.timestamp) * 1000,
    evidenceKind: 'ON_CHAIN_RECEIPT',
  };
}
export function verifiedSelectors() {
  return operatorAbi
    .filter((a) => a.type === 'function' && a.name !== 'isOperatorAuthorized')
    .map((a) => ({ name: a.name, selector: toFunctionSelector(a) }));
}
export { perpPoolWriteAbi };
