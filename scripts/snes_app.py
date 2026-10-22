"""Local app worker: prepare collections and publish verified files to pSNES."""
import copy
import fcntl
import hashlib
import io
import json
from pathlib import Path
import re
import signal
import sys
import tempfile
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from ftplib import error_perm

from snes_library import build, write_gamelist
from snes_art import add_art
from snes_upload import connect, upload_one, remote_digest

REMOTE = '/data/psnes/roms'
ART_REV = 'cdd8f1d44612976cc9d422b0ace53a8542667688'


def digest(file):
    result = hashlib.sha256()
    with Path(file).open('rb') as source:
        for chunk in iter(lambda: source.read(262144), b''):
            result.update(chunk)
    return result.hexdigest()


def read(ftp, file):
    chunks = []
    ftp.retrbinary('RETR ' + file, chunks.append, blocksize=262144)
    return b''.join(chunks)


def listing(ftp, folder):
    lines = []
    ftp.retrlines('LIST ' + folder, lines.append)
    result = []
    for line in lines:
        parts = line.split(None, 8)
        if len(parts) != 9 or line[0] not in 'd-':
            raise ValueError('Listagem FTP inesperada. Nenhum metadado foi atualizado.')
        name = parts[-1]
        if name in ('.', '..'):
            continue
        if any(c in name for c in '/\\\r\n'):
            raise ValueError('Nome FTP inesperado.')
        result.append((name, line[0], int(parts[4])))
    return result


def existing_saves(ftp, folder, backup, check, depth=0):
    if depth > 5:
        raise ValueError('Pasta de saves muito profunda.')
    found = {}
    for name, kind, size in listing(ftp, folder):
        check()
        full = folder + '/' + name
        if kind == 'd':
            found.update(existing_saves(ftp, full, backup, check, depth+1))
        else:
            if size > 64*1024*1024:
                raise ValueError('Save maior que o limite de backup.')
            data = read(ftp, full)
            local = backup / full.removeprefix('/data/psnes/')
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(data)
            found[full] = hashlib.sha256(data).hexdigest()
    return found


def merge_xml(old, folder, items):
    write_gamelist(folder, items)
    root = ET.parse(folder/'gamelist.xml').getroot()
    known = {i['name'] for i in items}
    if old is not None:
        if b'<!DOCTYPE' in old.upper() or b'<!ENTITY' in old.upper():
            raise ValueError('XML existente possui declaração inesperada; preservado.')
        previous = ET.fromstring(old)
        if previous.tag != 'gameList':
            raise ValueError('Lista anterior não reconhecida; preservada.')
        for entry in previous:
            name = (entry.findtext('path') or '').removeprefix('./')
            if entry.tag != 'game' or name not in known:
                root.append(copy.deepcopy(entry))
    ids = set()
    for entry in root.findall('game'):
        value = entry.get('id')
        if not value or value in ids:
            value = str(int(hashlib.sha256(ET.tostring(entry)).hexdigest()[:15],16)+1)
            while value in ids:
                value = str(int(value)+1)
            entry.set('id', value)
        ids.add(value)
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)


def update_config(original):
    # Keep all emulator preferences; only register its ROM directory and display titles.
    text = original.decode('utf-8')
    matches = list(re.finditer(r'\bROMS\s*[:=]\s*\{([\s\S]*?)\}', text))
    if len(matches) != 1:
        raise ValueError('Bloco ROMS não reconhecido. Abra e feche o pSNES uma vez.')
    block = matches[0]
    if REMOTE+'/' not in block.group(1):
        if re.search(r'\bSNES\s*=', block.group(1)):
            raise ValueError('pSNES usa outra pasta SNES; preservada. Revise a configuração antes de continuar.')
        body = block.group(1) + '\n SNES = ( "Super Nintendo", "0x00000004", "'+REMOTE+'/" );\n'
        text = text[:block.start(1)] + body + text[block.end(1):]
    text = re.sub(r'(\bSHOW_ZIP_NAMES\s*=\s*)"ON"', r'\1"OFF"', text)
    return text.encode('utf-8')


def validate_library(folder):
    folder = Path(folder).resolve(strict=True)
    manifest = json.loads((folder/'manifest.json').read_text())
    items = manifest.get('items', [])
    if manifest.get('version') != 1 or not 0 < len(items) <= 10000:
        raise ValueError('Manifesto inválido.')
    stems = set()
    for item in items:
        name = item['name']
        if Path(name).name != name or any(c in name for c in '\r\n\\') or Path(name).suffix not in ('.smc','.sfc','.swc','.fig','.zip'):
            raise ValueError('Nome de ROM inválido.')
        stem = Path(name).stem.casefold()
        if stem in stems:
            raise ValueError('ROMs compartilham nome de save. Prepare a biblioteca novamente.')
        stems.add(stem)
        for key, hashkey in [('name','sha256'),('cover','cover_sha256')]:
            if not item.get(key):
                continue
            file = (folder/'roms'/item[key]).resolve(strict=True)
            if folder/'roms' not in file.parents or not file.is_file():
                raise ValueError('Arquivo fora da biblioteca.')
            if key == 'cover' and not re.fullmatch(r'media/mixrbv2/[^/]+\.png',item[key]):
                raise ValueError('Caminho de capa inválido.')
            if digest(file) != item.get(hashkey):
                raise ValueError('Arquivo local mudou: '+name+'. Prepare ou abra outra biblioteca.')
    return manifest


def synchronize(folder, work, host, check, ftp=None, progress=print):
    manifest = validate_library(folder)
    folder, work = Path(folder), Path(work)
    check()
    ftp = ftp or connect(host)
    session = uuid.uuid4().hex
    backup = work/('backup-'+session)
    backup.mkdir(parents=True)
    changed = []
    try:
        root_entries = {n:k for n,k,_ in listing(ftp,'/data/psnes')}
        if root_entries.get('config.cfg') != '-':
            raise ValueError('pSNES não inicializado. Abra e feche o emulador no PS4 antes de sincronizar.')
        config = read(ftp,'/data/psnes/config.cfg')
        new_config = update_config(config)
        rom_entries = {n:(k,s) for n,k,s in listing(ftp,REMOTE)}
        old = read(ftp,REMOTE+'/gamelist.xml') if 'gamelist.xml' in rom_entries else None
        with tempfile.TemporaryDirectory(dir=work) as tmp:
            xml = merge_xml(old,Path(tmp),manifest['items'])
        (backup/'config.cfg').write_bytes(config)
        if old is not None:
            (backup/'gamelist.xml').write_bytes(old)
        # Fail before copying if any destination conflicts or shares another game's save stem.
        remote_stems = {}
        for name,(kind,_) in rom_entries.items():
            if kind == '-' and Path(name).suffix.lower() in ('.smc','.sfc','.swc','.fig','.zip'):
                remote_stems.setdefault(Path(name).stem.casefold(),[]).append(name)
        verified = set()
        progress('Conferindo jogos existentes e possíveis conflitos de saves…',flush=True)
        for number,item in enumerate(manifest['items'],1):
            check()
            collisions = remote_stems.get(Path(item['name']).stem.casefold(),[])
            if any(n != item['name'] for n in collisions):
                raise ValueError('Conflito com save existente: '+item['name']+'. Arquivo preservado; use um nome-base diferente na nova coleção.')
            if item['name'] in rom_entries and remote_digest(ftp,REMOTE+'/'+item['name']) != item['sha256']:
                raise ValueError('ROM diferente já existe: '+item['name']+'. Preservada sem sobrescrever.')
            if item['name'] in rom_entries:
                verified.add(item['name'])
            if number % 10 == 0 or number == len(manifest['items']):
                progress(f'Jogos conferidos antes da cópia: {number}/{len(manifest["items"])}',flush=True)
        saves = {}
        for name in ('saves','sram','configs'):
            if root_entries.get(name) == 'd':
                saves.update(existing_saves(ftp,'/data/psnes/'+name,backup,check))
        progress('Backup pronto. Copiando jogos e capas com conferência de integridade.',flush=True)
        records = []
        images = {}
        for item in manifest['items']:
            records.append((item['name'],item['sha256']))
            if item.get('cover'):
                images[item['cover']] = item['cover_sha256']
        records.extend(sorted(images.items()))
        for number,(relative,expected) in enumerate(records,1):
            check()
            local = folder/'roms'/relative
            if digest(local) != expected:
                raise ValueError('Arquivo local mudou durante a cópia: '+relative)
            destination = REMOTE if '/' not in relative else REMOTE+'/media/mixrbv2'
            if relative not in verified:
                upload_one(ftp,local,destination,local.name,expected)
            if number % 10 == 0 or number == len(records):
                progress(f'Conferidos no PS4: {number}/{len(records)}',flush=True)
        check()
        # No cancellation in the small metadata transaction. Roll back on a publication failure.
        def publish(file,data,original):
            names = {n for n,_,_ in listing(ftp,str(Path(file).parent))}
            exists = Path(file).name in names
            if (original is None and exists) or (original is not None and (not exists or read(ftp,file) != original)):
                raise ValueError('Metadados mudaram no PS4. Feche o pSNES e tente novamente.')
            if data == original:
                return
            temp = file+'.snes-app-'+session+'.tmp'
            previous = file+'.before-snes-app-'+session
            ftp.storbinary('STOR '+temp,io.BytesIO(data),blocksize=262144)
            if read(ftp,temp) != data:
                raise ValueError('Metadados remotos não conferem.')
            if original is not None:
                if read(ftp,file) != original:
                    raise ValueError('pSNES alterou a configuração; feche o emulador.')
                ftp.rename(file,previous)
            try:
                ftp.rename(temp,file)
            except BaseException:
                if original is not None:
                    ftp.rename(previous,file)
                raise
            changed.append((file,previous if original is not None else None))
            if read(ftp,file) != data:
                raise ValueError('Verificação final dos metadados falhou.')
        try:
            publish(REMOTE+'/gamelist.xml',xml,old)
            publish('/data/psnes/config.cfg',new_config,config)
            for file,expected in saves.items():
                if remote_digest(ftp,file) != expected:
                    raise ValueError('Um save mudou durante o envio. Feche completamente o pSNES.')
        except BaseException:
            for file,previous in reversed(changed):
                ftp.rename(file,file+'.failed-snes-app-'+session)
                if previous:
                    ftp.rename(previous,file)
            raise
        receipt = {'roms':len(manifest['items']),'images':len(images),'saves_verified':len(saves),'backup':str(backup),'status':'verified-awaiting-console-check'}
        (backup/'receipt.json').write_text(json.dumps(receipt,indent=2))
        progress('Sincronização concluída. Reabra o pSNES para conferir lista, capas e saves.',flush=True)
        return receipt
    finally:
        ftp.close()


def download(url, file, limit):
    if file.exists():
        return
    with urllib.request.urlopen(url,timeout=45) as response:
        data = response.read(limit+1)
    if len(data) > limit:
        raise ValueError('Índice de capas ou identificação maior que o limite.')
    temp = file.with_suffix('.download')
    temp.write_bytes(data)
    temp.replace(file)


def main(spec):
    work = Path(spec['work']); work.mkdir(parents=True,exist_ok=True)
    cancelled = False
    def stop(*_):
        nonlocal cancelled
        cancelled = True
    signal.signal(signal.SIGTERM,stop)
    signal.signal(signal.SIGINT,stop)
    def check():
        if cancelled or (work/('cancel-'+spec['id'])).exists():
            raise ValueError('Tarefa cancelada. Arquivos já conferidos e backups preservados; nenhuma ROM ou save foi removido.')
    def progress(message,**kwargs):
        check(); print(message,flush=True)
    with (work/'worker.lock').open('a') as lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Outra tarefa SNES continua ativa. Aguarde sua conclusão.')
        if spec['kind'] == 'prepare':
            try:
                import PIL
            except ImportError:
                raise ValueError('Pillow não encontrado no Python. Instale com: python3 -m pip install Pillow; ou configure SNES_PYTHON com seu Python que contém Pillow.')
            dat = work/'no-intro.dat'; art = work/'art-index.json'
            print('Preparando identificação e índice de capas. Nenhum jogo será baixado.',flush=True)
            download('https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/no-intro/Nintendo%20-%20Super%20Nintendo%20Entertainment%20System.dat',dat,32*1024*1024)
            download('https://api.github.com/repos/libretro-thumbnails/Nintendo_-_Super_Nintendo_Entertainment_System/git/trees/'+ART_REV+'?recursive=1',art,16*1024*1024)
            tree = json.loads(art.read_text())
            if tree.get('sha') != ART_REV or tree.get('truncated'):
                raise ValueError('Índice de capas incompleto ou revisão diferente.')
            preserve = []
            if spec.get('folder'):
                previous = json.loads((Path(spec['folder'])/'manifest.json').read_text())
                preserve = [i['name'] for i in previous['items']]
            folder = build(spec['iso'],dat,work/'collections',progress=progress,preserve_names=preserve)
            add_art(folder,art,work/'art-cache',progress=progress)
            check()
            (work/'result.json').write_text(json.dumps({'folder':str(folder)}))
            print('Biblioteca preparada com capas. Nenhum arquivo enviado ao PS4.',flush=True)
        elif spec['kind'] == 'sync':
            synchronize(spec['folder'],work,spec['ps4Ip'],check)
        else:
            raise ValueError('Tarefa SNES inválida.')


if __name__ == '__main__':
    try:
        main(json.loads(Path(sys.argv[1]).read_text()))
    except Exception as error:
        print(str(error),file=sys.stderr,flush=True)
        sys.exit(1)
