/**
 * Development-only behaviour toggles.
 *
 * These change what the UI signs, not just what it shows, so each one is
 * off unless explicitly enabled and is surfaced in the interface whenever it
 * is on. Nothing here should ever be enabled on a deployment the public can
 * reach.
 */

/**
 * Sign federation peer-lifecycle messages DIRECTLY as the connected wallet,
 * instead of wrapping them in a Commons Council proposal.
 *
 * Why this is possible at all: x/federation gates these messages on
 * `IsCouncilAuthorized(ctx, authority, "commons", "operations")`, which
 * accepts the gov authority, the council policy address, the Operations
 * Committee policy address, OR any individual Operations Committee member
 * signing for themselves. The forms default to the council policy — the
 * safest of the four — which means a submit opens a vote rather than
 * changing anything.
 *
 * On a canonical network that is correct: the council's 51% threshold over a
 * 5-day window is the point. On a devnet being reset several times a day it
 * makes peer setup impossible, since a 3-message bring-up would take a
 * fortnight of votes to land.
 *
 * With this on, `authority` becomes the connected address and the message is
 * broadcast alone. The chain still authorizes it — a non-member is rejected
 * with ErrNotAuthorized — so this loosens nothing the chain enforces. What it
 * removes is the council's review of a change one member can already make.
 *
 * Enable with NEXT_PUBLIC_DIRECT_COUNCIL_SIGNING=1. Never set this on
 * testnet or mainnet: it turns a governed action into a unilateral one for
 * every operator who loads the page.
 */
export const DIRECT_COUNCIL_SIGNING =
  process.env.NEXT_PUBLIC_DIRECT_COUNCIL_SIGNING === "1";
