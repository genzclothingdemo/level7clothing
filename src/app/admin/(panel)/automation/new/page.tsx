import { redirect } from "next/navigation";

/**
 * There is no "new rule" screen any more — **Settings → Alerts is the only
 * place an alert is created**, by ticking the cell for the event, the person
 * and the channel. A second way in is how one message came to be sent twice.
 *
 * Kept as a redirect rather than deleted so a bookmark or an old link lands
 * on the screen that does this now instead of a 404.
 */
export default function NewAutomationRuleMoved() {
  redirect("/admin/settings?tab=alerts");
}
