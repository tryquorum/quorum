const { chromium } = require("/Users/jun/Developer/new/node_modules/playwright-core")
;(async () => {
  const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" })
  const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" })).newPage()
  await p.goto("http://127.0.0.1:4350/", { waitUntil: "networkidle" }); await p.waitForTimeout(1200)
  const r = await p.evaluate(() => {
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]) }
    const sections = [...document.querySelectorAll("main > section")].map((s) => { const r = s.getBoundingClientRect(); return { id: s.id || s.getAttribute("aria-labelledby"), top: Math.round(r.top + scrollY), h: Math.round(r.height), pad: getComputedStyle(s).paddingTop } })
    const eyebrows = [...document.querySelectorAll(".lp-eyebrow")].map((e) => e.textContent.trim())
    const text = document.querySelector("main").innerText
    const emdash = (text.match(/—/g) || []).length
    const steps = [...document.querySelectorAll(".lp-step, #story ol li")].slice(0, 3).map((li) => { const cs = getComputedStyle(li); return { op: cs.opacity, color: getComputedStyle(li.querySelector("p:last-child") || li).color } })
    const flags = [...document.querySelectorAll(".lp-flag")].map((f) => { const r = f.getBoundingClientRect(); const i = f.querySelector("img").getBoundingClientRect(); return [Math.round(r.width), Math.round(i.width)] })
    const boat = document.querySelector("#agents svg")?.getBoundingClientRect()
    const iframe = document.querySelector("iframe")?.getBoundingClientRect()
    return { sections, eyebrows, emdash, steps, flags: flags[0], boat: boat && [Math.round(boat.width), Math.round(boat.height)], iframe: iframe && [Math.round(iframe.width), Math.round(iframe.height)], h1: getComputedStyle(document.querySelector("h1")).fontSize, h2: getComputedStyle(document.querySelector("h2")).fontSize, body: getComputedStyle(document.querySelector("main p")).fontSize }
  })
  console.log(JSON.stringify(r, null, 1))
  await b.close()
})()
