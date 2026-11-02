"""
가혹 조건 합성 벤치마크 생성기 (테스트 전용 데이터 — 실제 측정과 무관)
발 안쪽 면 장면을 그리고 조명·색온도·노이즈·블러·JPEG·반사·방해물 등을 적용한다.
출력: bench/data/<cond>_<seed>.rgb.gz (RGB 원시값) + bench/data/truth.json (정답 좌표)
python3 bench/gen.py [seeds]
"""
import gzip, io, json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H, SS = 960, 540, 4
OUT = os.path.join(os.path.dirname(__file__), os.environ.get('BENCH_OUT', 'data'))

CONDS = {
    # 검출되어야 하는 조건
    'clean': {},
    'noise_high': {'noise': 18},
    'warm_light': {'gains': (1.25, 1.0, 0.66)},
    'cool_light': {'gains': (0.82, 1.0, 1.2)},
    'low_light': {'bright': 0.32, 'noise': 9},
    'shading': {'grad': (0.42, 1.15), 'vignette': 0.5},
    'specular': {'specular': True},
    'sticker_shading': {'inner_grad': 0.32},
    'tilt': {'axis': 0.86},
    'defocus': {'defocus': 1.6},
    'motion_blur': {'motion': 7},
    'jpeg_q50': {'jpeg': 50},
    'denim_nearby': {'denim': True},
    'small': {'radius': (6.5, 8)},
    'combo_hard': {'gains': (1.18, 1.0, 0.75), 'bright': 0.55, 'noise': 12, 'jpeg': 70, 'specular': True, 'grad': (0.6, 1.1), 'inner_grad': 0.2},
    # 거부되어야 하는 조건 (측정하면 안 됨)
    'reject_occluded': {'occlude': True, 'expect': 'reject'},
    'reject_extra_blue': {'extra_blue': True, 'expect': 'reject'},
    'reject_heavy_blur': {'defocus': 4.5, 'expect': 'reject'},
}


def ellipse_poly(cx, cy, a, b, th, n=160):
    c, s = math.cos(th), math.sin(th)
    return [(cx + a * math.cos(t) * c - b * math.sin(t) * s, cy + a * math.cos(t) * s + b * math.sin(t) * c) for t in np.linspace(0, 2 * math.pi, n, endpoint=False)]


def render(cond, seed):
    p = CONDS[cond]
    rng = np.random.default_rng(seed * 1000 + sum(map(ord, cond)))
    toe = 'right' if rng.random() < 0.5 else 'left'
    # 배경: 바닥(저주파 질감)
    base = np.array(rng.choice([[200, 196, 188], [170, 150, 125], [215, 215, 212]]), float)
    yy, xx = np.mgrid[0:H, 0:W]
    tex = sum(np.sin(xx / (40 + 30 * rng.random()) + rng.random() * 6) * np.cos(yy / (35 + 30 * rng.random()) + rng.random() * 6) for _ in range(3)) * 4
    img = np.dstack([base[k] + tex for k in range(3)])
    # 발(안쪽 면) 실루엣
    sil = Image.new('L', (W * SS, H * SS), 0); d = ImageDraw.Draw(sil)
    span = W * rng.uniform(0.55, 0.68); cx0 = W / 2 + rng.uniform(-30, 30); ybase = H * rng.uniform(0.62, 0.7)
    sgn = 1 if toe == 'right' else -1
    heel = cx0 - sgn * span / 2; toex = cx0 + sgn * span / 2
    pts = []
    for t in np.linspace(0, 1, 60):  # 윗선: 발꿈치 → 발목 → 발등 → 발가락
        x = heel + (toex - heel) * t
        top = ybase - (H * 0.33) * (1 - t) ** 1.5 - 40 * math.sin(math.pi * t) - 18
        pts.append((x, top))
    pts += [(toex + sgn * 30, ybase + 6), (heel - sgn * 25, ybase + 8)]
    d.polygon([(x * SS, y * SS) for x, y in pts], fill=255)
    m = np.asarray(sil.resize((W, H), Image.LANCZOS), float) / 255
    skin = np.array(rng.choice([[226, 182, 152], [205, 160, 125], [180, 130, 100], [235, 200, 175]]), float)
    shade = 0.82 + 0.25 * np.clip((ybase - yy) / (H * 0.4), 0, 1)
    for k in range(3): img[..., k] = img[..., k] * (1 - m) + skin[k] * shade * m
    # 데님(바지 밑단) — 스티커보다 탁한 파랑, 넓은 면적
    if p.get('denim'):
        dm = Image.new('L', (W, H), 0); dd = ImageDraw.Draw(dm)
        x0 = heel - sgn * 40; dd.polygon([(x0, 0), (x0 + sgn * 260, 0), (x0 + sgn * 230, ybase - H * 0.36), (x0 - sgn * 20, ybase - H * 0.3)], fill=255)
        dmask = np.asarray(dm, float) / 255
        dtex = 1 + 0.12 * np.sin(xx * 1.7 + yy * 1.7) + rng.normal(0, 0.05, (H, W))
        den = np.array([72, 92, 132], float)
        for k in range(3): img[..., k] = img[..., k] * (1 - dmask) + den[k] * dtex * dmask
    # 스티커
    rmin, rmax = p.get('radius', (11, 16)); r = rng.uniform(rmin, rmax)
    P3 = (heel + sgn * span * 0.06, ybase - rng.uniform(8, 16))
    P1 = (toex - sgn * span * 0.12, ybase - rng.uniform(6, 14))
    tt = rng.uniform(0.33, 0.47); hpx = rng.uniform(32, 90)
    ang = math.atan2(P1[1] - P3[1], P1[0] - P3[0])
    nx, ny = -math.sin(ang), math.cos(ang)
    if ny > 0: nx, ny = -nx, -ny
    P2 = (P3[0] + (P1[0] - P3[0]) * tt + nx * hpx, P3[1] + (P1[1] - P3[1]) * tt + ny * hpx)
    blue = np.array(rng.choice([[28, 86, 214], [22, 64, 190], [38, 108, 228], [30, 75, 200]]), float)
    axis = p.get('axis', 1.0); th = rng.uniform(0, math.pi)
    stickers = [P1, P2, P3]
    extra = []
    if p.get('extra_blue'):
        extra.append((rng.uniform(80, W - 80), rng.uniform(40, 90)))
    for (sx, sy) in stickers + extra:
        sm = Image.new('L', (W * SS, H * SS), 0)
        ImageDraw.Draw(sm).polygon([(x * SS, y * SS) for x, y in ellipse_poly(sx, sy, r, r * axis, th)], fill=255)
        smask = np.asarray(sm.resize((W, H), Image.LANCZOS), float) / 255
        g = 1.0
        if p.get('inner_grad'):
            ga = rng.uniform(0, 2 * math.pi)
            g = 1 + p['inner_grad'] * (((xx - sx) * math.cos(ga) + (yy - sy) * math.sin(ga)) / r).clip(-1, 1)
        for k in range(3): img[..., k] = img[..., k] * (1 - smask) + blue[k] * g * smask
        if p.get('specular'):
            hx, hy = sx + rng.uniform(-0.35, 0.35) * r, sy + rng.uniform(-0.35, 0.35) * r
            hm = Image.new('L', (W * SS, H * SS), 0)
            ImageDraw.Draw(hm).polygon([(x * SS, y * SS) for x, y in ellipse_poly(hx, hy, r * 0.32, r * 0.18, rng.uniform(0, 3))], fill=255)
            hmask = np.asarray(hm.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2)), float) / 255 * 0.9
            for k in range(3): img[..., k] = img[..., k] * (1 - hmask) + 245 * hmask
    if p.get('occlude'):  # P2의 절반을 바지 밑단(피부색과 다른 천)이 가림
        om = Image.new('L', (W, H), 0); ImageDraw.Draw(om).rectangle([P2[0] - 60, 0, P2[0] + 60, P2[1] + rng.uniform(-3, 3)], fill=255)
        o = np.asarray(om.filter(ImageFilter.GaussianBlur(0.8)), float) / 255
        cloth = np.array([90, 85, 80], float)
        for k in range(3): img[..., k] = img[..., k] * (1 - o) + cloth[k] * o
    # 조명
    light = np.ones((H, W))
    if p.get('grad'):
        a0, a1 = p['grad']; ga = rng.uniform(0, 2 * math.pi)
        tproj = ((xx - W / 2) * math.cos(ga) + (yy - H / 2) * math.sin(ga)) / (W / 2)
        light *= a0 + (a1 - a0) * (tproj.clip(-1, 1) + 1) / 2
    if p.get('vignette'):
        rr = ((xx - W / 2) ** 2 + (yy - H / 2) ** 2) / ((W / 2) ** 2 + (H / 2) ** 2)
        light *= 1 - p['vignette'] * rr
    light *= p.get('bright', 1.0)
    img *= light[..., None]
    if p.get('gains'): img *= np.array(p['gains'])[None, None, :]
    im = Image.fromarray(img.clip(0, 255).astype(np.uint8))
    if p.get('defocus'): im = im.filter(ImageFilter.GaussianBlur(p['defocus']))
    arr = np.asarray(im, float)
    if p.get('motion'):
        L = p['motion']; k = np.ones(L) / L
        arr = np.apply_along_axis(lambda v: np.convolve(v, k, mode='same'), 1, arr)
    sigma = p.get('noise', 4)
    arr = arr + rng.normal(0, sigma, arr.shape)
    im = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    if p.get('jpeg'):
        buf = io.BytesIO(); im.save(buf, 'JPEG', quality=p['jpeg'], subsampling=2); im = Image.open(io.BytesIO(buf.getvalue())).convert('RGB')
    def perp(pt):
        dx, dy = P1[0] - P3[0], P1[1] - P3[1]; L = math.hypot(dx, dy)
        return abs((pt[0] - P3[0]) * dy - (pt[1] - P3[1]) * dx) / L
    return im, {'cond': cond, 'seed': seed, 'toe': toe, 'expect': p.get('expect', 'detect'), 'radius': r, 'axis': axis,
                'P1': P1, 'P2': P2, 'P3': P3, 'heightPx': perp(P2), 'w': W, 'h': H}


if __name__ == '__main__':
    seeds = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    off = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    os.makedirs(OUT, exist_ok=True)
    truth = []
    for cond in CONDS:
        for s in range(off, off + seeds):
            im, t = render(cond, s)
            name = f'{cond}_{s}'
            with gzip.open(os.path.join(OUT, name + '.rgb.gz'), 'wb', compresslevel=3) as f: f.write(im.tobytes())
            if s == off: im.save(os.path.join(OUT, name + '.png'))
            t['file'] = name + '.rgb.gz'; truth.append(t)
    json.dump(truth, open(os.path.join(OUT, 'truth.json'), 'w'), indent=0)
    print(len(truth), 'images')
