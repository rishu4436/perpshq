import { isDeepStrictEqual } from 'node:util';
import type { AgentConfig } from '../../../packages/agent-engine';
/** JSONB may reorder object keys and omits undefined optional properties. */
export function sameConfig(a: AgentConfig | undefined, b: AgentConfig) {
  return !!a && isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
}
