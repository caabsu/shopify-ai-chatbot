export interface ProviderPostconditionPollResult<T> {
  value: T;
  satisfied: boolean;
  attempts: number;
}

export interface ShopifyRefundTransaction {
  id: string;
  kind: string;
  status: string;
  amount: string;
}

/**
 * A Shopify cancellation refund is safe to describe as submitted once either
 * the financial projection has caught up or Shopify exposes a new full-value
 * REFUND transaction in PENDING/SUCCESS state. PENDING is not a failed or
 * ambiguous mutation: it means Shopify accepted the refund and the payment
 * provider is settling it, which is why customer copy promises a later bank
 * posting window.
 */
export function cancellationRefundWasSubmitted(input: {
  financialStatus: string;
  refundedBefore: number;
  refundedAfter: number;
  expectedOutstanding: number | null;
  transactions: ShopifyRefundTransaction[];
  refundTransactionIdsBefore: ReadonlySet<string>;
}): boolean {
  if (input.financialStatus.toUpperCase() === 'REFUNDED') return true;
  if (input.expectedOutstanding === null
      || !Number.isFinite(input.refundedBefore)
      || !Number.isFinite(input.refundedAfter)) return false;

  const refundDelta = Math.max(0, input.refundedAfter - input.refundedBefore);
  if (refundDelta + 0.01 >= input.expectedOutstanding) return true;

  const newlySubmitted = input.transactions
    .filter((transaction) => (
      transaction.kind.toUpperCase() === 'REFUND'
      && ['PENDING', 'SUCCESS'].includes(transaction.status.toUpperCase())
      && !input.refundTransactionIdsBefore.has(transaction.id)
    ))
    .reduce((sum, transaction) => {
      const amount = Number.parseFloat(transaction.amount || '0');
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0);
  return newlySubmitted + 0.01 >= input.expectedOutstanding;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Provider verification was aborted');
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Poll a read-only provider projection after an accepted mutation. Commerce
 * APIs commonly expose the mutation job before their financial/read models
 * converge. A short bounded poll avoids turning normal eventual consistency
 * into a manual reconciliation incident.
 */
export async function pollProviderPostcondition<T>(input: {
  load: (signal: AbortSignal) => Promise<T>;
  isSatisfied: (value: T) => boolean;
  signal: AbortSignal;
  timeoutMs: number;
  intervalMs: number;
}): Promise<ProviderPostconditionPollResult<T>> {
  const timeoutMs = Math.max(0, input.timeoutMs);
  const intervalMs = Math.max(1, input.intervalMs);
  const deadline = Date.now() + timeoutMs;
  let latest: T | undefined;
  let attempts = 0;
  let lastError: unknown;

  while (true) {
    if (input.signal.aborted) throw abortError(input.signal);
    try {
      latest = await input.load(input.signal);
      attempts += 1;
      if (input.isSatisfied(latest)) {
        return { value: latest, satisfied: true, attempts };
      }
    } catch (error) {
      if (input.signal.aborted) throw abortError(input.signal);
      lastError = error;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await abortableDelay(Math.min(intervalMs, remaining), input.signal);
  }

  if (latest !== undefined) {
    return { value: latest, satisfied: false, attempts };
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Provider verification did not return a readable state');
}
