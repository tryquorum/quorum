import { asset } from "@/lib/base"

/**
 * The hero's product screen: the real Workspace from /w, rendered in an iframe by site/web/src/landing/demo on recorded
 * data from the c0mpiled-17 Seoul run. An iframe keeps the workspace's own routing (#/now), shortcuts, sidebar layout and
 * dialogs from touching the landing, and the preview changes whenever /w does.
 */
export function WorkspacePreview() {
  return (
    <iframe
      src={asset("media/workspace-demo.html")}
      title="Quorum workspace preview: the real workspace running on the recorded Seoul run, read-only"
      className="block h-[700px] w-full bg-[#08080a] max-sm:h-[640px]"
    />
  )
}
