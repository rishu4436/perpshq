import { describe, expect, it } from 'vitest';
import { agentFixture, agentNow } from '../agent-fixtures';
import { agentConfigSchema } from '../../packages/agent-engine/config';
import { assessRisk, sizeProposal } from '../../packages/agent-risk';
function fixture() {
  const f = agentFixture();
  f.config.mode = 'ASSISTED';
  f.config.ownerAddress = '0x' + '1'.repeat(40);
  f.config.execution.signer = 'owner-wallet';
  Object.assign(f.observation.account!, {
    source: 'chain',
    permissions: null,
    gasSTT: '1',
    verifiedLeverage: 20,
    historyComplete: true,
    sessionPnl: '0',
    dailyPnl: '0',
    exposureComplete: true,
  });
  return f;
}
describe('owner-wallet risk policy', () => {
  it('revalidates exact reviewed units using fresh planning stops after a mark move', () => {
    const f = fixture();
    const original = sizeProposal(f.config, f.detail.market, 'long');
    f.detail.market.markPrice! *= 1.001;
    const fresh = sizeProposal(f.config, f.detail.market, 'long', original.quantity);
    const reviewed = {
      ...original,
      estimatedLoss: fresh.estimatedLoss,
      stopPrice: fresh.stopPrice,
      targetPrice: fresh.targetPrice,
    };
    const risk = assessRisk(f.config, f.observation, f.runtime, reviewed, agentNow);
    expect(risk.checks.find((c) => c.name === 'Sizing integrity')?.passed).toBe(true);
    const stale = assessRisk(
      f.config,
      f.observation,
      f.runtime,
      {
        ...original,
        estimatedLoss: fresh.estimatedLoss,
      },
      agentNow,
    );
    expect(stale.checks.find((c) => c.name === 'Sizing integrity')?.passed).toBe(false);
  });
  it('permits owner signing without fabricating a delegated grant', () => {
    const f = fixture();
    expect(agentConfigSchema.safeParse(f.config).success).toBe(true);
    const risk = assessRisk(
      f.config,
      f.observation,
      f.runtime,
      sizeProposal(f.config, f.detail.market, 'long'),
      agentNow,
    );
    expect(risk.checks.find((c) => c.name === 'Operator permission')?.passed).toBe(true);
  });
  it('retains delegated permission requirements when owner signing is not selected', () => {
    const f = fixture();
    f.config.execution.signer = 'operator';
    f.config.operatorAddress = '0x' + '2'.repeat(40);
    const risk = assessRisk(
      f.config,
      f.observation,
      f.runtime,
      sizeProposal(f.config, f.detail.market, 'long'),
      agentNow,
    );
    expect(risk.allowed).toBe(false);
    expect(risk.checks.find((c) => c.name === 'Operator permission')?.passed).toBe(false);
  });
  it('blocks owner proposals when complete loss history is unavailable', () => {
    const f = fixture();
    f.observation.account!.historyComplete = false;
    const risk = assessRisk(
      f.config,
      f.observation,
      f.runtime,
      sizeProposal(f.config, f.detail.market, 'long'),
      agentNow,
    );
    expect(risk.allowed).toBe(false);
    expect(risk.checks.find((c) => c.name === 'Loss history complete')?.passed).toBe(false);
  });
});
