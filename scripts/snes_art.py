"""Resolve existing covers for identified games; never fetch game ROMs."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
import shutil
import time
import urllib.parse
import urllib.request


def title_key(title):
    return re.sub(r'[^a-z0-9]', '', re.sub(r'\([^)]*\)|\[[^]]*\]', '', title).casefold())


def choose_art(title, files):
    clean = re.sub(r'[&*/:`<>?\\|]', '_', title) + '.png'
    exact = [p for p in files if Path(p).name == clean]
    if exact:
        return exact[0], 'exact-title'
    same = [p for p in files if title_key(Path(p).stem) == title_key(title)]
    if same:
        return sorted(same, key=lambda p: ('(USA)' not in p, '(World)' not in p, p))[0], 'same-title-other-edition'
    return None, 'neutral'


def add_header_aliases(items, files):
    """A unique internal-title family may provide base-game art, explicitly labelled."""
    headers = {}
    for item in items:
        header = item.get('internal_title', '').casefold()
        if item['match'] == 'sha1' and header:
            headers.setdefault(header, {}).setdefault(title_key(item['title']), []).append(item['title'])
    artnames = [Path(p).stem for p in files]
    for item in items:
        if item['match'] != 'unidentified':
            continue
        header = item.get('internal_title', '')
        families = headers.get(header.casefold(), {})
        if len(families) == 1:
            names = next(iter(families.values()))
        elif not families and len(header) >= 6:
            names = [n for n in artnames if title_key(n) == title_key(header)]
        else:
            names = []
        if names:
            title = sorted(names, key=lambda t: ('(USA)' not in t, '(World)' not in t, t))[0]
            item['art_title'] = title
            item['match'] = 'header-base'
            item['title'] = re.sub(r'\s*\([^)]*\)', '', title).strip() + ' [base; ' + Path(item['name']).stem + ']'


def add_art(folder, index_json, cache, progress=print):
    # Pillow is needed only to create clearly labelled neutral cards, not to edit game art.
    from PIL import Image, ImageDraw, ImageFont
    folder, cache = Path(folder), Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((folder/'manifest.json').read_text())
    tree = json.loads(Path(index_json).read_text())
    files = [i['path'] for i in tree['tree'] if i['path'].startswith('Named_Boxarts/') and i['path'].endswith('.png')]
    revision = tree['sha']
    add_header_aliases(manifest['items'], files)
    selected = {}
    for item in manifest['items']:
        art, match = choose_art(item.get('art_title') or item['title'], files) if item['match'] == 'sha1' or item.get('art_title') else (None, 'neutral')
        item['art_match'] = match
        if art:
            selected[art] = None
        item['art_source_path'] = art
    def download(art):
        key = hashlib.sha256((revision+'/'+art).encode()).hexdigest()+'.png'
        target = cache/key
        url = 'https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Super_Nintendo_Entertainment_System/'+revision+'/'+urllib.parse.quote(art, safe='/')
        if not target.exists():
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(url, timeout=25) as response:
                        data = response.read(5*1024*1024+1)
                    if len(data) > 5*1024*1024 or not data.startswith(b'\x89PNG\r\n\x1a\n'):
                        raise ValueError('Imagem inválida ou muito grande.')
                    target.write_bytes(data)
                    break
                except Exception:
                    if attempt == 2:
                        return art, None
                    time.sleep(attempt + 1)
        try:
            with Image.open(target) as image:
                image.verify()
            return art, target
        except Exception:
            return art, None
    with ThreadPoolExecutor(max_workers=6) as pool:
        jobs = [pool.submit(download, art) for art in selected]
        for number, future in enumerate(as_completed(jobs), 1):
            art, source = future.result(); selected[art] = source
            if number % 100 == 0 or number == len(jobs):
                progress(f'Capas consultadas: {number}/{len(jobs)}')
    media = folder/'roms/media/mixrbv2'; media.mkdir(parents=True, exist_ok=True)
    stats = {'original_covers':0, 'game_base_covers':0, 'neutral_cards':0}
    font_path = '/System/Library/Fonts/Supplemental/Arial.ttf'
    font = ImageFont.truetype(font_path, 27)
    small = ImageFont.truetype(font_path, 20)
    for item in manifest['items']:
        source = selected.get(item['art_source_path'])
        if source is None:
            image = Image.new('RGB', (420, 560), '#17202d')
            draw = ImageDraw.Draw(image)
            draw.text((30, 35), 'SUPER NINTENDO', font=small, fill='#9fbdcf')
            words = item['title'].split(); lines=[]; line=''
            for word in words:
                trial = (line+' '+word).strip()
                if draw.textbbox((0,0),trial,font=font)[2] > 360 and line:
                    lines.append(line); line=word
                else:
                    line=trial
            lines.append(line)
            for row, text in enumerate(lines[:9]):
                draw.text((30, 120+row*36), text, font=font, fill='#f4f7fa')
            draw.text((30, 480), 'Capa original nao identificada', font=small, fill='#a8b5c5')
            source = cache/('neutral-'+hashlib.sha256(item['title'].encode()).hexdigest()+'.png')
            image.save(source)
            item['art_match'] = 'neutral'; stats['neutral_cards'] += 1
        else:
            stats['original_covers'] += 1
            if item.get('art_title') and item['match'] != 'sha1':
                stats['game_base_covers'] += 1
                item['art_match'] = 'game-base-' + item['art_match']
        data = source.read_bytes(); digest = hashlib.sha256(data).hexdigest()
        target = media/('sneslib-'+digest[:24]+'.png')
        if not target.exists():
            shutil.copyfile(source, target)
        item['cover'] = 'media/mixrbv2/'+target.name
        item['cover_sha256'] = digest
    from snes_library import write_gamelist
    write_gamelist(folder/'roms', manifest['items'])
    manifest['artwork'] = {**stats, 'repository_revision': revision,
                           'source': 'https://github.com/libretro-thumbnails/Nintendo_-_Super_Nintendo_Entertainment_System'}
    manifest['status'] = 'prepared-with-covers'
    (folder/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return stats
