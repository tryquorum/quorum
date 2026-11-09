import { useRef } from "react"
import { ChevronsUpDown, Keyboard, LogOut, Settings, UserRound } from "lucide-react"
import { Avatar, AvatarBadge, AvatarFallback } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSettingsInfo } from "@/components/settings/parts"
import { useShortcutHelp } from "@/components/shortcut-dispatch"
import { useSpaces } from "@/hooks/use-space"
import { logoutKind } from "@/lib/logout"
import { settingsHash } from "@/lib/settings-registry"
import { isMac } from "@/lib/shortcuts"
import { cn } from "@/lib/utils"

export function SidebarAccount({ email, syncOk, syncText, active, navigate, closeMobile }: {
  email: string; syncOk: boolean; syncText: string; active: boolean
  navigate: (target: string, action: () => void) => void
  closeMobile: () => void
}) {
  const { isMobile } = useSidebar()
  const { info, error, retry } = useSettingsInfo()
  const { me } = useSpaces()
  const openHelp = useShortcutHelp()
  const logoutForm = useRef<HTMLFormElement>(null)
  const logout = me ? logoutKind(info?.listener, me.auth) : null
  const shortcut = typeof navigator !== "undefined" && isMac(navigator.platform) ? "⌘," : "Ctrl+,"
  const settings = () => navigate("v:settings", () => { location.hash = settingsHash().slice(1) })
  const account = () => navigate("v:settings", () => { location.hash = settingsHash("account").slice(1) })
  return <>
    <li className={cn(syncOk && "sr-only")}>
      <div role="status" className={cn(!syncOk && "flex min-h-8 items-center gap-2 px-2 text-xs text-destructive max-md:min-h-11")}>
        {!syncOk && <span aria-hidden className="flex size-8 shrink-0 items-center justify-center"><span className="size-2 rounded-full bg-destructive" /></span>}
        <span>{syncText}</span>
      </div>
    </li>
    <SidebarMenuItem className="flex items-center gap-1">
      <DropdownMenu onOpenChange={(open) => { if (open && error) retry() }}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton size="lg" className="min-w-0 flex-1 data-[state=open]:bg-sidebar-accent" aria-label={`계정 메뉴: ${email}`}>
            <Avatar><AvatarFallback>{email.trim().charAt(0).toUpperCase() || "?"}</AvatarFallback>{!syncOk && <AvatarBadge className="bg-destructive" />}</Avatar>
            <span className="min-w-0 flex-1 truncate text-left text-sm font-medium" title={email}>{email}</span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-60" side={isMobile ? "top" : "right"} align="end" sideOffset={8}>
          <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="max-md:min-h-11 [@media(pointer:coarse)]:min-h-11" onSelect={settings}><Settings />설정<DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem className="max-md:min-h-11 [@media(pointer:coarse)]:min-h-11" onSelect={account}><UserRound />계정</DropdownMenuItem>
          <DropdownMenuItem className="max-md:min-h-11 [@media(pointer:coarse)]:min-h-11" onSelect={() => { closeMobile(); openHelp() }}><Keyboard />키보드 단축키<DropdownMenuShortcut>?</DropdownMenuShortcut></DropdownMenuItem>
          {logout && <><DropdownMenuSeparator />{logout === "google"
            ? <DropdownMenuItem className="max-md:min-h-11 [@media(pointer:coarse)]:min-h-11" onSelect={() => logoutForm.current?.requestSubmit()}><LogOut />로그아웃</DropdownMenuItem>
            : <DropdownMenuItem className="max-md:min-h-11 [@media(pointer:coarse)]:min-h-11" asChild><a href="/cdn-cgi/access/logout"><LogOut />로그아웃</a></DropdownMenuItem>}</>}
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip><TooltipTrigger asChild>
        <button type="button" aria-label={`설정 ${shortcut}`} onClick={settings} data-active={active} className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground max-md:size-11 [@media(pointer:coarse)]:size-11"><Settings className="size-4" /></button>
      </TooltipTrigger><TooltipContent side="top">설정 {shortcut}</TooltipContent></Tooltip>
      {logout === "google" && <form ref={logoutForm} method="post" action="/auth/logout" />}
    </SidebarMenuItem>
  </>
}
