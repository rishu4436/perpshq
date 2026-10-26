import type { OrderState } from '../shared-types';
const transitions: Partial<Record<OrderState, OrderState[]>> = {
  draft: ['validating'],
  validating: ['ready', 'rejected'],
  ready: ['signature', 'validating', 'draft'],
  signature: ['broadcasting', 'pending', 'rejected', 'unknown'],
  broadcasting: ['pending', 'unknown'],
  pending: ['confirmed', 'reverted', 'rejected', 'unknown'],
  confirmed: ['syncing', 'resting', 'partial', 'filled', 'cancelled', 'unknown'],
  syncing: ['resting', 'partial', 'filled', 'cancelled', 'unknown'],
  resting: ['partial', 'filled', 'cancelled', 'unknown'],
  partial: ['filled', 'cancelled', 'unknown'],
  unknown: [
    'pending',
    'confirmed',
    'syncing',
    'resting',
    'partial',
    'filled',
    'cancelled',
    'rejected',
    'reverted',
  ],
  rejected: ['draft'],
  reverted: ['draft'],
  cancelled: ['draft'],
  filled: ['draft'],
};
export function transition(from: OrderState, to: OrderState): OrderState {
  if (!transitions[from]?.includes(to))
    throw new Error(`Invalid order transition: ${from} → ${to}`);
  return to;
}
