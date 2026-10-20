import { z } from 'zod';
export const workerEnvSchema = z.object({
  AGENT_NETWORK: z.literal('hideki').default('hideki'),
  AGENT_MODE: z.literal('DRY_RUN').default('DRY_RUN'),
  AGENT_STORE_PATH: z.string().min(1).default('data/agent-studio.sqlite'),
  AGENT_CONFIG_FILE: z.string().min(1).optional(),
  AGENT_POLL_MS: z.coerce.number().int().min(10000).max(300000).default(30000),
  AGENT_LEASE_TTL_MS: z.coerce.number().int().min(30000).max(120000).default(45000),
  AGENT_DATA_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
  AGENT_MAX_CYCLES: z.coerce.number().int().min(1).max(1000000).optional(),
  AGENT_WORKER_ID: z
    .string()
    .regex(/^[\w-]{1,80}$/)
    .optional(),
});
export function loadWorkerEnv(env: Record<string, string | undefined> = process.env) {
  if (['PRIVATE_KEY', 'OPERATOR_PRIVATE_KEY', 'AGENT_PRIVATE_KEY'].some((k) => !!env[k]))
    throw new Error(
      'This dry-run worker does not accept signing secrets. Remove secret variables; no key value has been logged.',
    );
  if (
    (env.NETWORK && env.NETWORK !== 'hideki') ||
    (env.DRY_RUN && env.DRY_RUN !== 'true') ||
    (env.AGENT_LIVE_ENABLED && env.AGENT_LIVE_ENABLED !== 'false')
  )
    throw new Error(
      'Only Hideki dry run is permitted. Environment variables cannot enable broadcast.',
    );
  return workerEnvSchema.parse(env);
}
