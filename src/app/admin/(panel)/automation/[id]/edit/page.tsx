import { redirect } from "next/navigation";

/**
 * Rules are not edited one by one any more. Whether an alert is on is a tick
 * on **Settings → Alerts**, and what it says is its template, on Admin →
 * Automation → Message wording. The event, the person and the channel are what
 * an alert *is* — changing one of those is a different alert, which is a
 * different cell on the grid.
 *
 * A redirect, so an old link to a rule's editor still lands somewhere useful.
 */
export default function EditAutomationRuleMoved() {
  redirect("/admin/settings?tab=alerts");
}
