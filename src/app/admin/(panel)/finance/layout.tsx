import { Workspace } from "@/components/admin/dash-workspace";

/**
 * Five of the analytics workspace's six sections live under this layout; the
 * sixth, Overview, is the admin panel's index page and renders the same
 * `Workspace` chrome itself. See the note in `dash-workspace.tsx` for why the
 * chrome is a component rather than this layout.
 */
export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return <Workspace>{children}</Workspace>;
}
