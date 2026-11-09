import { asset } from "@/lib/base"
import { cn } from "@/lib/utils"

// Official logos from site/web/public/logos (sources and terms in SOURCES.md). The OpenAI wordmark is
// used as published (no recolor, crop or stretch); Codex has no logo of its own, so its name is set beside it.
// The page follows the reader's theme, so each ink-colored logo ships a light and a dark file.
export type LogoKey = "aside" | "gbrain" | "gstack" | "codex" | "luma"

function Themed({ light, dark, alt, className }: { light: string; dark: string; alt: string; className: string }) {
  return (
    <>
      <img src={asset(light)} alt={alt} className={cn(className, "dark:hidden")} />
      <img src={asset(dark)} alt={alt} className={cn(className, "hidden dark:block")} />
    </>
  )
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-md bg-[#f4f4f2] px-2 py-1 ring-1 ring-black/5", className)}>{children}</span>
}

export function Logo({ name, className, size = "md" }: { name: LogoKey; className?: string; size?: "sm" | "md" }) {
  const sm = size === "sm"
  switch (name) {
    case "aside":
      return <Chip className={cn(sm && "px-1.5 py-0.5", className)}><img src={asset("logos/aside.svg")} alt="Aside" className={sm ? "h-3.5 w-auto" : "h-5 w-auto"} /></Chip>
    case "gbrain":
      return <span className={cn("inline-flex", className)}><Themed light="logos/gbrain.svg" dark="logos/gbrain-light.svg" alt="gbrain" className={sm ? "h-4 w-auto" : "h-6 w-auto"} /></span>
    case "gstack":
      return (
        <span className={cn("inline-flex items-center gap-2", className)}>
          <img src={asset("logos/gstack.png")} alt={sm ? "gstack" : ""} className={sm ? "size-5 rounded" : "size-7 rounded-md"} />
          {!sm && <span className="text-lg font-semibold tracking-tight">gstack</span>}
        </span>
      )
    case "codex":
      return (
        <span className={cn("inline-flex items-center gap-2", className)}>
          <Themed light="logos/openai.svg" dark="logos/openai-light.svg" alt="OpenAI" className={sm ? "-my-1 h-6 w-auto" : "-my-2 h-10 w-auto"} />
          <span className={sm ? "text-sm font-semibold" : "text-lg font-semibold tracking-tight"}>Codex</span>
        </span>
      )
    case "luma":
      return (
        <span className={cn("inline-flex items-center gap-2", className)}>
          <Chip className="p-1"><img src={asset("logos/luma.svg")} alt="" className="size-5" /></Chip>
          <span className="text-lg font-semibold tracking-tight">Luma</span>
        </span>
      )
  }
}
