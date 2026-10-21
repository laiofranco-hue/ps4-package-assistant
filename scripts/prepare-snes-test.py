#!/usr/bin/env python3
"""Prepare 1–3 explicitly selected ROMs locally. Never connects to the PS4."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import xml.etree.ElementTree as ET

DEFAULT_ROOT = Path.home() / '.codex/.chatgpt-projects/ps4-package-assistant-local/outputs/SNES-tests'


def prepare(roms, output_root=DEFAULT_ROOT):
    sources = [Path(p).expanduser().absolute() for p in roms]
    if not 1 <= len(sources) <= 3:
        raise ValueError('Escolha de 1 a 3 ROMs para o teste inicial.')
    names = set()
    for p in sources:
        info = p.lstat()
        if not stat.S_ISREG(info.st_mode) or p.suffix.lower() not in ('.sfc', '.smc'):
            raise ValueError('Escolha arquivos .sfc/.smc comuns, sem links simbólicos. ISO e ZIP não são ROMs prontas para este teste.')
        if not 0 < info.st_size <= 64 * 1024 * 1024:
            raise ValueError('Cada ROM deve ter entre 1 byte e 64 MiB.')
        if p.name.casefold() in names:
            raise ValueError('Nomes de arquivos repetidos: escolha ROMs com nomes distintos.')
        names.add(p.name.casefold())
    root = Path(output_root).expanduser().resolve()
    home = Path.home()
    forbidden = [home / 'Desktop', home / 'Documents', home / 'Library/Mobile Documents', home / 'Library/CloudStorage']
    if any(root == p or p in root.parents for p in forbidden):
        raise ValueError('Use uma pasta local fora de Desktop, Documents e armazenamento em nuvem.')
    root.mkdir(parents=True, exist_ok=True)
    destination = Path(tempfile.mkdtemp(prefix='snes-teste-', dir=root))
    try:
        target = destination / 'roms'
        target.mkdir()
        items = []
        for source in sources:
            # pEMU's file filter is case-sensitive: uppercase .SFC/.SMC are ignored.
            copied = target / (source.stem + source.suffix.lower())
            digest = hashlib.sha256()
            fd = os.open(source, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
            with os.fdopen(fd, 'rb') as original, copied.open('xb') as output:
                before = os.fstat(original.fileno())
                if not stat.S_ISREG(before.st_mode):
                    raise ValueError('A origem deixou de ser um arquivo comum.')
                for chunk in iter(lambda: original.read(1024 * 1024), b''):
                    digest.update(chunk)
                    output.write(chunk)
                after = os.fstat(original.fileno())
            current = source.lstat()
            fields = ('st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_ino', 'st_dev')
            if any(getattr(before, k) != getattr(after, k) or getattr(after, k) != getattr(current, k) for k in fields):
                raise ValueError('Uma ROM mudou durante a cópia. Tente novamente com o arquivo estável.')
            copied_hash = hashlib.sha256(copied.read_bytes()).hexdigest()
            if copied_hash != digest.hexdigest():
                raise ValueError('A cópia não confere com os bytes lidos da origem.')
            items.append({'file': 'roms/' + copied.name, 'size': copied.stat().st_size, 'sha256': copied_hash,
                          'ps4_target': '/data/psnes/roms/' + copied.name})
        gamelist = ET.Element('gameList')
        for item in items:
            game = ET.SubElement(gamelist, 'game')
            name = Path(item['file']).name
            ET.SubElement(game, 'path').text = './' + name
            ET.SubElement(game, 'name').text = Path(name).stem
        ET.ElementTree(gamelist).write(target / 'gamelist.xml', encoding='utf-8', xml_declaration=True)
        manifest = {'version': 1, 'emulator': 'pSNES', 'release': 'v7.2', 'title_id': 'PSNE00001',
                    'status': 'prepared-locally-not-tested-on-console', 'roms': items,
                    'checks': {k: 'pending' for k in ('installation', 'launch', 'library', 'controls', 'audio_video', 'save_state', 'in_game_save')}}
        (destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        return destination
    except BaseException:
        # Only this invocation's newly created staging directory may be removed.
        shutil.rmtree(destination)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Prepara cópias locais de até 3 ROMs SNES; não instala nem envia nada ao console.')
    parser.add_argument('roms', nargs='+', help='Caminhos explícitos de arquivos .sfc ou .smc')
    parser.add_argument('--output-root', type=Path, default=DEFAULT_ROOT)
    args = parser.parse_args()
    try:
        result = prepare(args.roms, args.output_root)
    except (OSError, ValueError) as error:
        parser.exit(1, 'Não foi possível preparar o teste: ' + str(error) + '\n')
    print('Biblioteca de teste preparada em:', result)
    print('Somente cópia e integridade verificadas. Execução, controles e salvamento no PS4 ainda pendentes.')
