// Capture matrix for the Quorum landing design audit. Usage: node cap.cjs <outDir> [routes...]
const { chromium } = require("/Users/jun/Developer/new/node_modules/playwright-core")
const out = process.argv[2]
const base = "http://127.0.0.1:4350"
const VIEW = { 1440: 900, 1280: 800, 1024: 768, 768: 1024, 390: 844 }
;(async () => {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" })
  const jobs = JSON.parse(process.argv[3] || "[]")
  const report = []
  for (const j of jobs) {
    const ctx = await browser.newContext({ viewport: { width: j.w, height: VIEW[j.w] ?? 900 }, colorScheme: j.theme, reducedMotion: j.reduced ? "reduce" : "no-preference", deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    const errors = []
    page.on("pageerror", (e) => errors.push(String(e)))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto(base + j.path, { waitUntil: "networkidle" })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(j.wait ?? 1200)
    if (j.scrollTo) { await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) window.scrollTo(0, el.getBoundingClientRect().top + scrollY + 1) }, j.scrollTo); await page.waitForTimeout(700) }
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: document.documentElement.scrollHeight }))
    const file = out + "/" + j.name + ".png"
    await page.screenshot({ path: file, fullPage: !!j.full })
    report.push({ name: j.name, ...m, overflowX: m.sw > m.cw, errors })
    await ctx.close()
  }
  await browser.close()
  console.log(JSON.stringify(report, null, 1))
})().catch((e) => { console.error(e); process.exit(1) })

