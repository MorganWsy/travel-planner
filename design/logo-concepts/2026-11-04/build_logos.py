"""Build six original SVG concepts and render previews with local Microsoft Edge."""
from pathlib import Path
import html
import json
import subprocess
import time

ROOT = Path(__file__).resolve().parent
CONCEPTS = [
    {
        'id': 'A', 'file': 'a-folded-map', 'name': '折叠地图',
        'caption': '几何折面 · 路线串联', 'colors': ['#0F766E', '#14A69A', '#F17456'],
        'description': '折叠地图通过负空间路线串联，终点以暖色圆点强调。',
        'art': '''<defs><mask id="route-a"><rect width="256" height="256" fill="white"/><path d="M54 151L89 136L129 152Q141 157 148 143L180 112L202 122" fill="none" stroke="black" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/></mask></defs>
<g mask="url(#route-a)"><path d="M39 70L88 48V181L42 202Q24 210 24 191V89Q24 77 39 70Z" fill="#0F766E"/><path d="M88 48L162 76V208L88 181Z" fill="#14A69A"/><path d="M162 76L214 53Q232 45 232 64V172Q232 184 218 190L162 208Z" fill="#0F766E"/></g><circle cx="202" cy="122" r="13" fill="#F17456"/>''',
    },
    {
        'id': 'B', 'file': 'b-terrain-contours', 'name': '等高线',
        'caption': '地形轮廓 · 探索路径', 'colors': ['#17664F', '#59B79A'],
        'description': '三层等高线围合山地，以断开的轮廓形成进入地形的路径。',
        'art': '''<defs><mask id="route-b"><rect width="256" height="256" fill="white"/><path d="M91 224C82 194 86 170 111 150L139 128" fill="none" stroke="black" stroke-width="20" stroke-linecap="round"/></mask></defs>
<g fill="none" stroke-linecap="round" stroke-linejoin="round" mask="url(#route-b)"><path d="M48 187C20 174 23 142 48 120C66 105 73 82 94 65C119 45 153 48 180 68C205 87 225 114 224 143C223 172 201 194 174 202C132 216 82 205 48 187Z" stroke="#17664F" stroke-width="18"/><path d="M70 165C52 157 59 138 77 123C94 109 93 91 112 83C134 73 154 81 172 97C190 113 203 137 192 155C175 183 108 183 70 165Z" stroke="#59B79A" stroke-width="17"/><path d="M100 143C87 136 107 116 119 109C133 100 154 115 163 130C177 153 122 158 100 143Z" stroke="#17664F" stroke-width="16"/></g><circle cx="139" cy="128" r="9" fill="#59B79A"/>''',
    },
    {
        'id': 'C', 'file': 'c-mountain-sunrise', 'name': '山水日出',
        'caption': '山峰日出 · 向远方出发', 'colors': ['#234D68', '#F3A340'],
        'description': '山峰、日出和蜿蜒的负空间水路融合，呈现亲近自然的旅行气质。',
        'art': '''<defs><mask id="river-c"><rect width="256" height="256" fill="white"/><path d="M107 211C159 195 162 178 141 163C123 150 116 143 130 130L143 118" fill="none" stroke="black" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><circle cx="180" cy="67" r="25" fill="#F3A340"/><path d="M28 181L98 64Q106 51 115 66L159 137L178 108Q186 96 194 110L232 180Q241 196 223 196H37Q19 196 28 181Z" fill="#234D68" mask="url(#river-c)"/>''',
    },
    {
        'id': 'D', 'file': 'd-journey-ribbon', 'name': '丝带路线',
        'caption': '连续路线 · 灵活编排行程', 'colors': ['#3566D9', '#8261C8'],
        'description': '连续的圆角路线折回成流畅的丝带，两个留白途经点使起终点清晰。',
        'art': '''<defs><mask id="nodes-d"><rect width="256" height="256" fill="white"/><circle cx="46" cy="55" r="9" fill="black"/><circle cx="57" cy="193" r="9" fill="black"/></mask></defs><g fill="none" stroke-width="36" stroke-linecap="round" stroke-linejoin="round" mask="url(#nodes-d)"><path d="M46 55C46 81 67 102 95 102H162C191 102 211 121 211 147C211 173 191 193 162 193H57" stroke="#3566D9"/><path d="M162 102C191 102 211 121 211 147C211 173 191 193 162 193H126" stroke="#8261C8"/></g>''',
    },
    {
        'id': 'E', 'file': 'e-compass-route', 'name': '指南针',
        'caption': '方向定位 · 清楚知道去哪', 'colors': ['#D86E56', '#293D50'],
        'description': '四向罗盘与弯曲路线结合，以负空间形成面向目的地的方向感。',
        'art': '''<defs><mask id="path-e"><rect width="256" height="256" fill="white"/><path d="M112 190C106 166 149 164 149 141C149 123 108 125 112 105L130 72" fill="none" stroke="black" stroke-width="14" stroke-linecap="round"/><circle cx="130" cy="72" r="10" fill="black"/></mask></defs><g mask="url(#path-e)"><path d="M119 31Q128 15 137 31L164 89L223 119Q239 128 223 137L165 164L137 223Q128 239 119 223L90 165L33 137Q17 128 33 119L89 90Z" fill="#D86E56"/><path d="M119 31Q128 15 137 31L164 89L128 109L90 90Z" fill="#293D50"/></g>''',
    },
    {
        'id': 'F', 'file': 'f-map-mosaic', 'name': '地图拼片',
        'caption': '组合目的地 · 拼出自己的旅程', 'colors': ['#255C80', '#6EC7AF'],
        'description': '不等形的地图片区彼此咬合，片区之间的道路留白承载行程与图层的概念。',
        'art': '''<path d="M52 32H113V90Q113 104 99 104H32V52Q32 32 52 32Z" fill="#255C80"/><path d="M137 32H203Q224 32 224 53V120H170V99Q170 90 161 90H137Z" fill="#6EC7AF"/><path d="M32 128H89Q104 128 104 143V163Q104 176 118 176H135V224H53Q32 224 32 203Z" fill="#6EC7AF"/><path d="M128 115H145Q160 115 160 130V145H224V202Q224 224 202 224H159V166Q159 153 146 153H128Z" fill="#255C80"/><circle cx="117" cy="119" r="8" fill="#255C80"/>''',
    },
]


def svg_for(c):
    title = html.escape(f"{c['id']} · {c['name']}")
    description = html.escape(c['description'])
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 256 256" role="img" aria-labelledby="title desc">
<title id="title">{title}</title><desc id="desc">{description}</desc>
{c['art']}
</svg>\n'''


def comparison():
    parts = ['''<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1320" viewBox="0 0 1800 1320">
<rect width="1800" height="1320" fill="#F4F5F2"/>
<g font-family="Microsoft YaHei, sans-serif">
<text x="80" y="74" fill="#6C7B7C" font-size="18" letter-spacing="4">TRAVEL PLANNER / LOGO EXPLORATIONS</text>
<text x="76" y="149" fill="#1E353E" font-size="54" font-weight="700">旅程，从一个好标志开始</text>
<text x="80" y="193" fill="#7A878A" font-size="21">六个独立视觉方向 · 无文字图形标志 · SVG 矢量原稿</text>
<text x="1718" y="81" fill="#7A878A" font-size="18" text-anchor="end">01 — 06</text>
''']
    for i, c in enumerate(CONCEPTS):
        x, y = 80 + (i % 3) * 560, 244 + (i // 3) * 450
        parts.append(f'<rect x="{x}" y="{y}" width="520" height="410" rx="24" fill="white" stroke="#E4E8E4" stroke-width="1.5"/>')
        parts.append(f'<text x="{x+30}" y="{y+44}" fill="#8B9798" font-size="17" font-weight="700">{c["id"]}</text>')
        parts.append(f'<g transform="translate({x+164} {y+42}) scale(.75)">{c["art"].replace("route-a", "board-route-a").replace("route-b", "board-route-b").replace("river-c", "board-river-c").replace("nodes-d", "board-nodes-d").replace("path-e", "board-path-e")}</g>')
        parts.append(f'<text x="{x+32}" y="{y+300}" fill="#243C45" font-size="28" font-weight="700">{c["name"]}</text>')
        parts.append(f'<text x="{x+32}" y="{y+337}" fill="#7E8B8D" font-size="18">{c["caption"]}</text>')
        for j, color in enumerate(c['colors']):
            parts.append(f'<circle cx="{x+40+j*25}" cy="{y+374}" r="7" fill="{color}"/>')
        parts.append(f'<text x="{x+478}" y="{y+377}" fill="#A0AAAC" font-size="13" text-anchor="end">CONCEPT {c["id"]}</text>')
    parts.append('<text x="80" y="1214" fill="#677B7D" font-size="20">选择方向后，可继续细化平台字标、单色版与应用图标。</text><text x="1720" y="1214" text-anchor="end" fill="#8B9798" font-size="17">2026.11.04</text></g></svg>')
    return '\n'.join(parts) + '\n'


def build():
    for c in CONCEPTS:
        (ROOT / f"{c['file']}.svg").write_text(svg_for(c), encoding='utf-8')
    (ROOT / 'comparison.svg').write_text(comparison(), encoding='utf-8')
    metadata = [{k: v for k, v in c.items() if k != 'art'} for c in CONCEPTS]
    (ROOT / 'concepts.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    cards = '\n'.join(f'''<article><div class="art"><img src="{c['file']}.svg" alt="{c['name']}"></div><h2>{c['id']} · {c['name']}</h2><p>{c['description']}</p><a href="{c['file']}.svg" download>下载 SVG</a> <a href="{c['file']}.png" download>下载 PNG</a></article>''' for c in CONCEPTS)
    page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>旅游规划平台 Logo 候选</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f5f2;color:#243c45;font-family:"Microsoft YaHei",sans-serif}main{max-width:1200px;margin:0 auto;padding:48px 24px}h1{font-size:34px;margin:0 0 12px}.intro{color:#657c7e;line-height:1.8}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:30px}article{padding:24px;background:white;border:1px solid #e4e8e4;border-radius:20px}.art{height:210px;display:grid;place-items:center;background:transparent}img{width:190px;height:190px}h2{font-size:22px}p{line-height:1.8;color:#6b7b7e;min-height:86px}a{color:#0f766e;font-size:14px;text-decoration:none;margin-right:12px}button{border:1px solid #bac9c8;border-radius:8px;padding:9px 14px;background:white;color:#243c45;cursor:pointer}.dark{background:#182a32}.dark .art{background:#182a32;border-radius:12px}@media(max-width:850px){.grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:540px){.grid{grid-template-columns:1fr}h1{font-size:27px}}</style><main><h1>旅游规划平台 · Logo 候选</h1><div class="intro">六款无文字图形标志，尚未应用到平台。SVG 为可编辑矢量原稿，PNG 为透明预览。<br>可切换底色比较，选定后再完善单色版本、字标和深色模式配色。</div><p><button onclick="document.body.classList.toggle('dark')">切换图标预览底色</button> <a href="comparison.png">查看总览大图</a></p><section class="grid">''' + cards + '</section></main></html>'
    (ROOT / 'preview.html').write_text(page, encoding='utf-8')


def render():
    edge = Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')
    if not edge.exists():
        raise RuntimeError('Local Microsoft Edge executable not found')
    profile = ROOT / '.edge-render-profile'
    profile.mkdir(exist_ok=True)
    sources = [(c['file'], 512, 512) for c in CONCEPTS] + [('comparison', 1800, 1320)]
    for name, w, h in sources:
        target = ROOT / f'{name}.png'
        command = [str(edge), '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--hide-scrollbars', '--force-device-scale-factor=1', '--default-background-color=00000000', f'--user-data-dir={profile}', f'--window-size={w},{h}', f'--screenshot={target}', (ROOT / f'{name}.svg').as_uri()]
        process = subprocess.run(command, capture_output=True, text=True, timeout=40, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        deadline = time.monotonic() + 10
        while not target.exists() and time.monotonic() < deadline:
            time.sleep(.2)
        if not target.exists():
            raise RuntimeError(f'{name} preview failed ({process.returncode}): {process.stderr[-600:]}')
        print(f'Rendered {target.name}', flush=True)


if __name__ == '__main__':
    build()
    render()
