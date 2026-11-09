const { chromium } = require("/Users/jun/Developer/new/node_modules/playwright-core")
;(async () => {
  const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" })
  const out = {}
  for (const theme of ["light", "dark"]) {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: theme, reducedMotion: "reduce" })).newPage()
    await p.goto("http://127.0.0.1:4350/", { waitUntil: "networkidle" }); await p.waitForTimeout(1000)
    out[theme] = await p.evaluate(() => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 1; const cx = cv.getContext("2d", { willReadFrequently: true })
      // Resolve any CSS color (oklch, color-mix, rgba) to sRGB by painting one pixel.
      const parse = (c) => { if (!c || c === "transparent") return { r: 0, g: 0, b: 0, a: 0 }; cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 } }
      const L = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
      const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break } } let base = parse(getComputedStyle(document.body).backgroundColor) ; const lp = document.querySelector(".lp"); base = parse(getComputedStyle(lp).backgroundColor) || base; for (let i = stack.length - 1; i >= 0; i--) { const c = stack[i]; if (c.a >= 1) base = c; else base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a), a: 1 } } return base }
      const fails = []; let n = 0
      const walker = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT)
      const seen = new Set()
      while (walker.nextNode()) {
        const t = walker.currentNode; const el = t.parentElement
        if (!t.textContent.trim() || seen.has(el)) continue
        seen.add(el)
        if (el.closest("canvas, iframe, video, [aria-hidden=true], #story")) continue
        const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none") continue
        const fg = parse(cs.color); const bg = bgOf(el); const op = [...(function* () { for (let e = el; e; e = e.parentElement) yield Number(getComputedStyle(e).opacity) })()].reduce((a, v) => a * v, 1)
        const f = { r: fg.r * fg.a * op + bg.r * (1 - fg.a * op), g: fg.g * fg.a * op + bg.g * (1 - fg.a * op), b: fg.b * fg.a * op + bg.b * (1 - fg.a * op) }
        const l1 = L(f), l2 = L(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
        const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700)
        n++
        if (ratio < (large ? 3 : 4.5)) fails.push({ text: t.textContent.trim().slice(0, 40), ratio: +ratio.toFixed(2), size: cs.fontSize })
      }
      return { checked: n, fails: fails.slice(0, 15), failCount: fails.length }
    })
    if (theme === "light") {
      const stops = []
      await p.evaluate(() => window.scrollTo(0, 0))
      for (let i = 0; i < 14; i++) { await p.keyboard.press("Tab"); stops.push(await p.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { tag: e.tagName, text: (e.textContent || e.getAttribute("title") || "").trim().slice(0, 28), outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0, visible: r.width > 0 && r.bottom > 0 && r.top < innerHeight } })) }
      out.focus = stops
    }
  }
  console.log(JSON.stringify(out, null, 1))
  await b.close()
})()

