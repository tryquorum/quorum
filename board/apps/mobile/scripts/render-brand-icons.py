# 방향판 아이콘을 한 도형 정의에서 모두 그려요. 실행: uv run --no-project --with pillow python apps/mobile/scripts/render-brand-icons.py
# iOS 홈 화면 아이콘은 꽉 찬 정사각형(알파 없음, 둥근 모서리·여백·그림자 없음)이어야 iOS 마스크가 한 번만 씌워져요.
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
MOBILE = ROOT / 'apps/mobile/assets'
WEB = ROOT / 'apps/web/public/brand'

BG = (15, 15, 15)
TIP = (252, 252, 252)
TAIL = (184, 184, 184)
DOT = (223, 58, 46)
SS = 4  # 가장자리를 부드럽게 하려고 크게 그린 뒤 줄여요

# 바늘은 45도 축 위의 연(kite) 모양이에요. 값은 예전 아이콘의 둥근 타일(892px)에서 잰 축 좌표예요.
TIP_U, TAIL_U, WAIST_U, HALF_W = 333.0, -381.1, -31.5, 77.5
DOT_U, DOT_R = 392.2, 42.6
SHIFT_U = -((DOT_U + DOT_R) + TAIL_U) / 2  # 바늘과 점을 합친 상자를 가운데에 둬요
SCALE = 1.12  # 1024 캔버스 기준 배율. 가장자리 여백이 약 18%라 iOS 마스크 안전 영역 안이에요


def glyph(draw, size, colors):
    tip, tail, dot = colors
    k = size / 1024 * SCALE
    c = size / 2
    r2 = math.sqrt(0.5)

    def at(u, v):
        u = (u + SHIFT_U) * k
        v = v * k
        return (c + (u + v) * r2, c + (-u + v) * r2)

    a, b = at(WAIST_U, -HALF_W), at(WAIST_U, HALF_W)
    draw.polygon([a, at(TIP_U, 0), b], fill=tip)
    draw.polygon([a, at(TAIL_U, 0), b], fill=tail)
    dx, dy = at(DOT_U, 0)
    rr = DOT_R * k
    draw.ellipse([dx - rr, dy - rr, dx + rr, dy + rr], fill=dot)


def render(size, mode, bg, colors, rounded=False):
    big = size * SS
    canvas_mode = 'RGBA' if rounded or bg is None else mode
    img = Image.new(canvas_mode, (big, big), (0, 0, 0, 0) if canvas_mode == 'RGBA' else bg)
    draw = ImageDraw.Draw(img)
    if rounded:
        draw.rounded_rectangle([0, 0, big - 1, big - 1], radius=round(big * 0.2237), fill=bg + (255,))
    glyph(draw, big, colors)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def gray(rgb):
    return round(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2])


COLORS = (TIP, TAIL, DOT)
OUTPUTS = {
    # iOS 앱 아이콘(Expo가 크기별로 만들어요)
    MOBILE / 'icon.png': lambda: render(1024, 'RGB', BG, COLORS),
    MOBILE / 'icon-dark.png': lambda: render(1024, 'RGBA', None, COLORS),
    MOBILE / 'icon-tinted.png': lambda: render(1024, 'L', 0, (255, gray(TAIL), 255)),
    # 시작 화면은 마스크가 없어서 둥근 타일을 직접 그려요
    MOBILE / 'splash-icon.png': lambda: render(1024, 'RGBA', BG, COLORS, rounded=True),
    # 웹: apple-touch-icon과 로고는 꽉 찬 정사각형(iOS·CSS가 둥글게 깎아요), 탭 파비콘은 둥근 타일
    WEB / 'apple-touch-icon.png': lambda: render(180, 'RGB', BG, COLORS),
    WEB / 'logo-192.png': lambda: render(192, 'RGB', BG, COLORS),
    WEB / 'logo-512.png': lambda: render(512, 'RGB', BG, COLORS),
    WEB / 'favicon-32.png': lambda: render(32, 'RGBA', BG, COLORS, rounded=True),
    WEB / 'favicon-16.png': lambda: render(16, 'RGBA', BG, COLORS, rounded=True),
}

if __name__ == '__main__':
    for path, make in OUTPUTS.items():
        make().save(path, optimize=True)
        print(path.relative_to(ROOT))
    sys.exit(0)

