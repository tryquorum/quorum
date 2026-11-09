import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

// From board/apps/web/src/components/md.tsx (AI answer renderer). Quorum drops board's local-file image
// rewrite (fileSrc) and the Tiptap export; links open in a new tab.
export function Md({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => defaultUrlTransform(url)}
        components={{
          a: ({ node, ...p }) => { void node; return <a {...p} target="_blank" rel="noopener" /> },
          img: ({ node, ...p }) => { void node; return <img {...p} loading="lazy" /> },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
