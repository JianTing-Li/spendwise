"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DemoState, MutationResponse } from "../contracts";

class DemoError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function responseError(status: number) {
  if (status === 401) return new DemoError(status, "Sign in again to access the demo.");
  if (status === 403) return new DemoError(status, "Access denied. Your account or request is not authorized for this action.");
  if (status === 409) return new DemoError(status, "This run changed or is no longer eligible. Reload to check the latest attempt.");
  return new DemoError(status, "Demo unavailable. Reload to check the current state before trying again.");
}

/** Observe durable runs while the mutation request owns their execution. */
export function useDemo() {
  const [data, setData] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const requestId = useRef(0);
  const appliedId = useRef(0);
  const generation = useRef(-1);
  const mutation = useRef<{ kind: string; controller: AbortController } | null>(null);

  const report = useCallback((cause: unknown) => {
    if (cause instanceof DemoError && [401, 403].includes(cause.status)) setData(null);
    setError(cause instanceof DemoError ? cause.message : "Connection lost. Reload to check the current state before trying again.");
  }, []);

  const load = useCallback(async (signal?: AbortSignal, expectedEpoch = epoch.current) => {
    const id = ++requestId.current;
    try {
      const response = await fetch("/api/demo", { cache: "no-store", signal });
      if (!response.ok) throw responseError(response.status);
      const next = DemoState.parse(await response.json());
      if (signal?.aborted || expectedEpoch !== epoch.current || id < appliedId.current || next.generation < generation.current) return;
      appliedId.current = id;
      generation.current = next.generation;
      setData(next);
      setError("");
    } catch (cause) {
      if (!signal?.aborted && expectedEpoch === epoch.current && id >= appliedId.current) {
        appliedId.current = id;
        report(cause);
      }
    }
  }, [report]);

  useEffect(() => {
    const controller = new AbortController();
    const lifecycle = epoch;
    const timer = setTimeout(() => void load(controller.signal), 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
      mutation.current?.controller.abort();
      mutation.current = null;
      lifecycle.current++;
    };
  }, [load]);

  const active = data?.runs.some(run => ["pending", "running"].includes(run.state)) ?? false;
  useEffect(() => {
    if ((!active && !["inject", "retry"].includes(busy ?? "")) || error) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await load(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(poll, 750);
    };
    timer = setTimeout(poll, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, busy, error, load]);

  async function act(action: object, path = "/api/demo") {
    const kind = "action" in action ? String(action.action) : "retry";
    // A ref closes the gap before React commits a disabled button. Reset may
    // supersede execution, but never another reset. Server idempotency remains authoritative.
    if (mutation.current && (kind !== "reset" || mutation.current.kind === "reset")) return;
    mutation.current?.controller.abort();
    const current = { kind, controller: new AbortController() };
    mutation.current = current;
    const expectedEpoch = ++epoch.current;
    setBusy(kind);
    setError("");
    if (kind === "reset") setData(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Spendwise-Demo": "1" },
        body: JSON.stringify(action),
        signal: current.controller.signal,
      });
      if (expectedEpoch !== epoch.current || current.controller.signal.aborted) return;
      if (!response.ok) throw responseError(response.status);
      const result = MutationResponse.parse(await response.json());
      if (expectedEpoch !== epoch.current || current.controller.signal.aborted) return;
      generation.current = Math.max(generation.current, result.generation);
      // Reads started before this commit cannot reintroduce old findings/review.
      await load(current.controller.signal, ++epoch.current);
    } catch (cause) {
      if (expectedEpoch === epoch.current && !current.controller.signal.aborted) report(cause);
    } finally {
      if (mutation.current === current) { mutation.current = null; setBusy(null); }
    }
  }

  return { data, busy, error, load, act, active };
}
