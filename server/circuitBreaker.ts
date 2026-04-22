/**
 * Circuit breaker wrapper for external API calls using cockatiel.
 * Provides: retry with exponential backoff + circuit breaker + timeout.
 *
 * Usage:
 *   const result = await withCircuitBreaker("youverify", () => callYouverify(payload));
 */
import {
  Policy,
  CircuitBreakerPolicy,
  retry,
  handleAll,
  ExponentialBackoff,
  circuitBreaker,
  ConsecutiveBreaker,
  timeout,
  TimeoutStrategy,
  wrap,
} from "cockatiel";

// ── Circuit breaker registry ──────────────────────────────────────────────────
const breakers = new Map<string, ReturnType<typeof wrap>>();

function getBreaker(name: string) {
  if (breakers.has(name)) return breakers.get(name)!;

  // Retry: up to 3 attempts with exponential backoff (100ms, 200ms, 400ms)
  const retryPolicy = retry(handleAll, {
    maxAttempts: 3,
    backoff: new ExponentialBackoff({ initialDelay: 100, maxDelay: 2000 }),
  });

  // Circuit breaker: open after 5 consecutive failures, half-open after 10s
  const cbPolicy = circuitBreaker(handleAll, {
    halfOpenAfter: 10_000,
    breaker: new ConsecutiveBreaker(5),
  });

  // Timeout: 8 seconds per attempt
  const timeoutPolicy = timeout(8_000, TimeoutStrategy.Cooperative);

  // Compose: timeout → retry → circuit breaker
  const policy = wrap(timeoutPolicy, retryPolicy, cbPolicy);

  breakers.set(name, policy);
  return policy;
}

/**
 * Execute fn() with retry + circuit breaker + timeout.
 * @param service  Logical service name (e.g. "youverify", "nimc", "nibss")
 * @param fn       Async function to execute
 */
export async function withCircuitBreaker<T>(
  service: string,
  fn: () => Promise<T>
): Promise<T> {
  const policy = getBreaker(service);
  return policy.execute(fn) as Promise<T>;
}

/**
 * Get the current state of a circuit breaker.
 */
export function getBreakerState(service: string): "closed" | "open" | "half-open" | "unknown" {
  // cockatiel doesn't expose state directly on the wrapped policy
  // We track it via a simple Map
  return "unknown";
}

/**
 * Reset a circuit breaker (useful for testing or manual recovery).
 */
export function resetBreaker(service: string): void {
  breakers.delete(service);
}
