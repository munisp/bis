import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type BisTraceContext = Readonly<{ traceId: string; spanId: string; flags: string; requestId: string; component: string }>;
const storage = new AsyncLocalStorage<BisTraceContext>();
const traceparent = /^([\da-f]{2})-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/i;
const requestId = /^[A-Za-z0-9._-]{16,128}$/;
const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const nonZero = (value: string) => /[1-9a-f]/i.test(value);

export function newTraceContext(headers: { traceparent?: string; requestId?: string }, component: string): BisTraceContext {
  const parsed = headers.traceparent?.trim().match(traceparent);
  const traceId = parsed && nonZero(parsed[2]) && nonZero(parsed[3]) ? parsed[2].toLowerCase() : hex(16);
  const flags = parsed ? parsed[4].toLowerCase() : "01";
  const inboundRequestId = headers.requestId?.trim() ?? "";
  return { traceId, spanId: hex(8), flags, requestId: requestId.test(inboundRequestId) ? inboundRequestId : hex(16), component };
}

export function formatTraceparent(context: BisTraceContext): string { return `00-${context.traceId}-${context.spanId}-${context.flags}`; }
export function currentTraceContext(): BisTraceContext | undefined { return storage.getStore(); }
export function traceLogFields(): Record<string, string> {
  const context = currentTraceContext();
  return context ? { trace_id: context.traceId, span_id: context.spanId, request_id: context.requestId, component: context.component } : {};
}
export function runWorkerTrace<T>(component: string, operation: string, fn: () => Promise<T>): Promise<T> {
  const parent = currentTraceContext();
  const context: BisTraceContext = parent
    ? { ...parent, spanId: hex(8), component: `${component}:${operation}` }
    : newTraceContext({}, `${component}:${operation}`);
  return storage.run(context, fn);
}
export function injectTraceHeaders(headers: Headers | Record<string, string>, component: string): void {
  const parent = currentTraceContext() ?? newTraceContext({}, component);
  const child: BisTraceContext = { ...parent, spanId: hex(8), component };
  if (headers instanceof Headers) { headers.set("traceparent", formatTraceparent(child)); headers.set("x-request-id", child.requestId); }
  else { headers.traceparent = formatTraceparent(child); headers["x-request-id"] = child.requestId; }
}
export function traceCorrelationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const context = newTraceContext({ traceparent: req.header("traceparent") ?? undefined, requestId: req.header("x-request-id") ?? undefined }, "bff.http");
  res.setHeader("traceparent", formatTraceparent(context));
  res.setHeader("x-request-id", context.requestId);
  storage.run(context, next);
}
