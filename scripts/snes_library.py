"""Build a local pSNES library from explicitly selected ISO contents; no ROM downloads."""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

SUPPORTED = {'.sfc', '.smc', '.swc', '.fig', '.zip'}
MAX_ROM = 64 * 1024 * 1024


def dat_index(text):
    result = {}
    for match in re.finditer(r'game\s*\(\s*name\s+"([^"\n]+)"([\s\S]*?)\n\)', text):
        name, body = match.groups()
        for sha in re.findall(r'\bsha1\s+([0-9a-fA-F]{40})\b', body):
            result.setdefault(sha.lower(), []).append(name)
    return result


def payload(data, suffix):
    if suffix.lower() == '.zip':
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            files = [i for i in archive.infolist() if not i.is_dir() and Path(i.filename).suffix.lower() in SUPPORTED - {'.zip'}]
            if len(files) != 1 or files[0].file_size > MAX_ROM:
                raise ValueError('ZIP precisa conter uma única ROM SNES de até 64 MiB.')
            data = archive.read(files[0])
    if len(data) > MAX_ROM or not data:
        raise ValueError('ROM vazia ou maior que 64 MiB.')
    return data[512:] if len(data) % 32768 == 512 else data


def identify(data, suffix, index):
    body = payload(data, suffix)
    sha = hashlib.sha1(body).hexdigest()
    matches = index.get(sha, [])
    title = internal_title(body)
    if matches:
        return {'title': sorted(matches)[0], 'match': 'sha1', 'payload_sha1': sha, 'internal_title': title}
    return {'title': title, 'match': 'unidentified', 'payload_sha1': sha, 'internal_title': title}


def internal_title(body):
    for offset in (0x7fc0, 0xffc0, 0x40ffc0):
        text = body[offset:offset + 21]
        if len(text) == 21 and all(32 <= c < 127 for c in text):
            candidate = text.decode('ascii').strip()
            if re.search('[A-Za-z]{2}', candidate):
                return candidate
    return ''


def unique_save_names(items, preserve=()):
    """pSNES save/config paths omit extensions: distinct ROMs need distinct stems."""
    preserve = {n.casefold() for n in preserve}
    groups = {}
    used = {Path(i['name']).stem.casefold() for i in items}
    for item in items:
        groups.setdefault(Path(item['name']).stem.casefold(), []).append(item)
    renames = {}
    for group in groups.values():
        if len(group) < 2:
            continue
        protected = [i for i in group if i['name'].casefold() in preserve]
        if len(protected) > 1:
            raise ValueError('Nomes existentes já compartilham saves; requer revisão.')
        keeper = protected[0] if protected else group[0]
        for item in group:
            if item is keeper:
                continue
            original = Path(item['name'])
            stem = original.stem + '--' + original.suffix[1:].lower()
            candidate = stem; counter = 2
            while candidate.casefold() in used:
                candidate = stem + '-' + str(counter); counter += 1
            used.add(candidate.casefold())
            new = candidate + original.suffix.lower()
            renames[item['name']] = new
            item['name'] = new
    return renames


def write_gamelist(folder, items):
    root = ET.Element('gameList')
    for item in items:
        stable_id = int(hashlib.sha256(item['name'].encode('utf-8')).hexdigest()[:15], 16) + 1
        game = ET.SubElement(root, 'game', {'id': str(stable_id)})
        ET.SubElement(game, 'path').text = './' + item['name']
        ET.SubElement(game, 'name').text = item['title']
        if item.get('cover'):
            ET.SubElement(game, 'image', {'type':'mixrbv2'}).text = './' + item['cover']
        if item.get('snap'):
            ET.SubElement(game, 'thumbnail').text = './' + item['snap']
    ET.ElementTree(root).write(Path(folder) / 'gamelist.xml', encoding='utf-8', xml_declaration=True)


def build(iso, dat, output_root, progress=print, preserve_names=()):
    iso = Path(iso).expanduser().resolve(strict=True)
    root = Path(output_root).expanduser().resolve()
    home = Path.home()
    forbidden = [home/'Desktop', home/'Documents', home/'Library/Mobile Documents', home/'Library/CloudStorage']
    if any(root == p or p in root.parents for p in forbidden):
        raise ValueError('Escolha uma pasta local fora da nuvem, Desktop e Documents.')
    index = dat_index(Path(dat).read_text(encoding='utf-8'))
    if not index:
        raise ValueError('Banco de identificação vazio ou inválido.')
    before = iso.stat()
    listing = subprocess.check_output(['/usr/bin/bsdtar', '-tf', str(iso)], text=True).splitlines()
    selected = []
    names = set()
    for entry in listing:
        part = PurePosixPath(entry)
        if not entry.startswith('ROMS/') or part.suffix.lower() not in SUPPORTED:
            continue
        if '..' in part.parts or '\\' in entry or len(part.parts) != 2:
            raise ValueError('Caminho inesperado dentro da ISO.')
        name = part.stem + part.suffix.lower()
        if name.casefold() in names:
            raise ValueError('Nomes de jogos em conflito na ISO.')
        names.add(name.casefold()); selected.append((entry, name))
    if not selected or len(selected) > 10000:
        raise ValueError('Quantidade de ROMs inválida.')
    root.mkdir(parents=True, exist_ok=True)
    destination = Path(tempfile.mkdtemp(prefix='snes-biblioteca-', dir=root))
    roms = destination/'roms'; roms.mkdir()
    items, warnings = [], []
    try:
        for number, (entry, name) in enumerate(selected, 1):
            # Explicit members only; never extract arbitrary archive paths to disk.
            data = subprocess.check_output(['/usr/bin/bsdtar', '-xOf', str(iso), entry])
            if len(data) > MAX_ROM:
                raise ValueError('Arquivo da ISO ultrapassa 64 MiB.')
            expanded = [(name, data)]
            if Path(name).suffix == '.zip':
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    members = [i for i in archive.infolist() if not i.is_dir() and Path(i.filename).suffix.lower() in SUPPORTED - {'.zip'}]
                    if len(members) > 1:
                        if len(members) > 64 or sum(i.file_size for i in members) > 256*1024*1024:
                            raise ValueError('ZIP com volume inesperado de ROMs.')
                        expanded = []
                        for member in members:
                            if member.file_size > MAX_ROM:
                                raise ValueError('ROM no ZIP ultrapassa o limite.')
                            stem = re.sub(r'[^A-Za-z0-9_.-]', '_', Path(member.filename).stem)
                            target_name = Path(name).stem + '--' + stem + Path(member.filename).suffix.lower()
                            if target_name.casefold() in names:
                                raise ValueError('Conflito de nomes ao abrir ZIP.')
                            names.add(target_name.casefold())
                            expanded.append((target_name, archive.read(member)))
            for target_name, content in expanded:
                info = {'title': '', 'match': 'unidentified'}
                try:
                    info = identify(content, Path(target_name).suffix, index)
                except (ValueError, zipfile.BadZipFile, RuntimeError) as error:
                    warnings.append({'file': target_name, 'error': str(error)})
                target = roms/target_name; target.write_bytes(content)
                digest = hashlib.sha256(content).hexdigest()
                if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                    raise ValueError('A cópia local não confere.')
                items.append({'name': target_name, 'title': info['title'] or Path(target_name).stem,
                              'size': len(content), 'sha256': digest, **{k:v for k,v in info.items() if k != 'title'}})
            if number % 100 == 0 or number == len(selected):
                progress(f'Preparados {number}/{len(selected)}; identificados: {sum(i["match"] == "sha1" for i in items)}')
        after = iso.stat()
        if any(getattr(before, k) != getattr(after, k) for k in ('st_size','st_mtime_ns','st_ctime_ns','st_ino')):
            raise ValueError('A ISO mudou durante a preparação.')
        renames = unique_save_names(items, preserve_names)
        for old, new in renames.items():
            (roms/old).rename(roms/new)
        manifest = {'version': 1, 'status': 'prepared-local', 'items': items, 'warnings': warnings,
                    'source_dat_sha256': hashlib.sha256(Path(dat).read_bytes()).hexdigest()}
        write_gamelist(roms, items)
        (destination/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        return destination
    except BaseException:
        shutil.rmtree(destination)
        raise
