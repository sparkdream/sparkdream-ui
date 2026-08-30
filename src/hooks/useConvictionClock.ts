"use client";

import { useSyncExternalStore } from "react";

/**
 * A coarse wall clock, in unix seconds, shared by every component that projects
 * conviction forward in time.
 *
 * Conviction is a function of stake age: each stake's weight climbs linearly
 * until it matures, so a card rendered once is wrong a minute later. The naive
 * fix is a `setInterval` per card, which is exactly what does not scale — a
 * page of N initiatives would hold N timers and wake the tab N times a period.
 *
 * Instead there is ONE module-level interval for the whole app, and components
 * subscribe to it. Cost is one timer regardless of how many rows are mounted,
 * and each tick is a pure recomputation from data already in memory: no network
 * traffic, no chain reads, nothing that grows with the number of initiatives.
 *
 * The timer only exists while something is subscribed, and it is suspended
 * while the tab is hidden — a backgrounded tab has no one to show a moving
 * number to, and browsers throttle its timers unpredictably anyway. Becoming
 * visible resyncs immediately, so returning to the tab never shows a stale
 * figure that then jumps.
 */

// 15s: fine enough that a maturing stake's progress reads as continuous, coarse
// enough that an idle tab wakes 4 times a minute. Conviction matures over hours
// (two half-lives), so nothing here needs sub-second fidelity.
const TICK_MS = 15_000;

let nowSeconds = Math.floor(Date.now() / 1000);
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function emit() {
  const next = Math.floor(Date.now() / 1000);
  // useSyncExternalStore compares snapshots by identity, so only notify when
  // the value actually moved. A duplicate second (or a resync that lands in the
  // same second) must not re-render every subscriber.
  if (next === nowSeconds) return;
  nowSeconds = next;
  for (const l of listeners) l();
}

function start() {
  if (timer !== null) return;
  timer = setInterval(emit, TICK_MS);
}

function stop() {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

function handleVisibility() {
  if (document.visibilityState === "hidden") {
    stop();
    return;
  }
  // Catch up on whatever elapsed while hidden before resuming the cadence.
  emit();
  if (listeners.size > 0) start();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", handleVisibility);
    if (document.visibilityState !== "hidden") start();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    }
  };
}

function getSnapshot(): number {
  return nowSeconds;
}

// The server has no clock worth agreeing with the client on: rendering a
// different second there guarantees a hydration mismatch on every card. Pin the
// server snapshot to 0 so the first client render is what fills the numbers in.
function getServerSnapshot(): number {
  return 0;
}

export function useConvictionClock(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
