// Runs once when the server starts (Next.js instrumentation hook).

/**
 * Give outbound connections longer to be made.
 *
 * The hosts this server talks to (the chain's API behind its CDN, the
 * explorer, Arweave) answer on IPv4 and IPv6. Node tries the addresses in
 * turn and by default gives each only 250 ms to connect before moving on. If
 * none connects in its slice the request fails with ETIMEDOUT in well under
 * a second, however healthy the host. That happens when IPv6 doesn't route
 * (WSL, many containers) and the IPv4 attempt is a little slow, which a busy
 * server makes it: the status page saw one request in a few hundred fail this
 * way, and a card whose check hangs on one request read "Unreachable".
 *
 * It applies to every outbound connection of the process, so the chain API
 * proxy and the verdict feeds get the same benefit.
 */
export async function register(): Promise<void> {
  // Written this way round so the build leaves the Node-only file out of the edge runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
