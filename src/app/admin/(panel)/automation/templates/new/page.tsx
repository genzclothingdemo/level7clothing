import { redirect } from "next/navigation";

/**
 * New templates are not made by hand any more: every alert the store can send
 * ships with its own message, and no screen can attach a new template to an
 * alert. The wording of each is edited in place on the templates list.
 */
export default function NewEmailTemplateMoved() {
  redirect("/admin/automation/templates");
}
