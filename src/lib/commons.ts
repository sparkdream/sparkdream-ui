// Helpers operating on commons (council/committee) Group objects.

import type { Group } from "@/types/commons";

/**
 * Only councils and operations committees hold spendable treasuries.
 * Governance committees and the supervisory board have FundingWeight 0 and
 * no max_spend_per_epoch budget, so MsgSpendFromCommons from them would
 * always fail.
 */
export function canSpendTreasury(group: Group): boolean {
  const name = group.index;
  return name.endsWith(" Council") || name.includes("Operations Committee");
}
