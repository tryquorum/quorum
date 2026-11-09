// WCAG 2 대비. 알파가 있는 hex(#rrggbbaa)는 바탕 위에 sRGB 로 섞어서 재요(브라우저 기본 합성과 같아요).

type Rgb = [number, number, number]

function parse(hex: string): { rgb: Rgb; alpha: number } {
  const h = hex.replace('#', '')
  const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255
  return { rgb: [n(0), n(2), n(4)], alpha: full.length === 8 ? n(6) : 1 }
}

/** fg 를 bg 위에 alpha 만큼 섞은 불투명 hex */
export function over(fg: string, bg: string, alpha?: number): string {
  const f = parse(fg)
  const b = parse(bg)
  const a = alpha ?? f.alpha
  const mix = f.rgb.map((v, i) => v * a + (b.rgb[i] ?? 0) * (1 - a))
  return '#' + mix.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
}

function luminance(rgb: Rgb): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
}

export function contrast(fg: string, bg: string): number {
  const solidBg = parse(bg).alpha < 1 ? over(bg, '#ffffff') : bg
  const solidFg = parse(fg).alpha < 1 ? over(fg, solidBg) : fg
  const a = luminance(parse(solidFg).rgb)
  const b = luminance(parse(solidBg).rgb)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

