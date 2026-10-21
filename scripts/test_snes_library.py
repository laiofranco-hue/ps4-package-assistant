import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import xml.etree.ElementTree as ET

from snes_library import dat_index, identify, payload, build, write_gamelist, unique_save_names
from snes_art import choose_art, add_header_aliases
from snes_upload import upload_one


def archive(entries):
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w') as z:
        for name, data in entries.items():
            z.writestr(name, data)
    return result.getvalue()


class LibraryTests(unittest.TestCase):
    def test_hash_identification_handles_copier_headers_and_single_rom_zip(self):
        data = b'x' * 32768
        sha = hashlib.sha1(data).hexdigest()
        dat = f'game (\n name "Fixture (USA)"\n rom ( sha1 {sha} )\n)'
        index = dat_index(dat)
        self.assertEqual(identify(b'0'*512 + data, '.SMC', index)['title'], 'Fixture (USA)')
        zipped = archive({'nested/game.SFC':data, 'readme.txt':b'notes'})
        self.assertEqual(identify(zipped, '.zip', index)['match'], 'sha1')
        with self.assertRaises(ValueError):
            payload(archive({'one.sfc': data, 'two.smc': data}), '.zip')

    def test_iso_build_expands_multiple_rom_zip_and_preserves_original_names_and_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); iso = root/'source.iso'; iso.write_bytes(b'fixture ISO')
            data = b'x'*32768; sha = hashlib.sha1(data).hexdigest()
            dat = root/'db.dat'; dat.write_text(f'game (\n name "Fixture & Test (USA)"\n rom ( sha1 {sha} )\n)')
            contents = {'ROMS/ONE.SFC':data, 'ROMS/PARTS.ZIP':archive({'one.SMC':data,'two.SMC':data,'readme.txt':b'notes'})}
            def run(args, **kwargs):
                if '-tf' in args:
                    return '\n'.join(contents)
                return contents[args[-1]]
            with patch('snes_library.subprocess.check_output', side_effect=run):
                result = build(iso, dat, root/'out', progress=lambda _:None)
            manifest = json.loads((result/'manifest.json').read_text())
            self.assertEqual([i['name'] for i in manifest['items']], ['ONE.sfc','PARTS--one.smc','PARTS--two.smc'])
            self.assertFalse((result/'roms/PARTS.zip').exists())
            self.assertEqual(iso.read_bytes(), b'fixture ISO')
            self.assertEqual((result/'roms/ONE.sfc').read_bytes(), data)
            self.assertEqual(ET.parse(result/'roms/gamelist.xml').findtext('.//name'), 'Fixture & Test (USA)')

    def test_artwork_selection_does_not_fuzzily_assign_a_different_game(self):
        files = ['Named_Boxarts/Game (USA).png', 'Named_Boxarts/Game II (USA).png']
        self.assertEqual(choose_art('Game (Europe)', files)[0], files[0])
        self.assertEqual(choose_art('Game III', files), (None,'neutral'))
        items = [{'name':'a.sfc','title':'Game (USA)','match':'sha1','internal_title':'HEADER'},
                 {'name':'b.sfc','title':'Unknown','match':'unidentified','internal_title':'HEADER'}]
        add_header_aliases(items, files)
        self.assertEqual(items[1]['art_title'], 'Game (USA)')
        self.assertEqual(items[1]['match'], 'header-base')
        self.assertIn('[base;', items[1]['title'])
        ambiguous = items[:1] + [{'name':'c.sfc','title':'Game II (USA)','match':'sha1','internal_title':'HEADER'},
                                {'name':'d.sfc','title':'Unknown','match':'unidentified','internal_title':'HEADER'}]
        add_header_aliases(ambiguous, files)
        self.assertNotIn('art_title', ambiguous[-1])

    def test_save_names_avoid_same_stem_across_extensions_and_keep_existing_game_names(self):
        items = [{'name':'MARIO.sfc'}, {'name':'MARIO.smc'}, {'name':'MARIO--sfc.zip'}]
        changed = unique_save_names(items, preserve=['MARIO.smc'])
        self.assertEqual(items[1]['name'],'MARIO.smc')
        self.assertEqual(changed['MARIO.sfc'],'MARIO--sfc-2.sfc')
        self.assertEqual(len({Path(i['name']).stem.casefold() for i in items}),len(items))
        with self.assertRaises(ValueError):
            unique_save_names([{'name':'A.smc'},{'name':'A.sfc'}],preserve=['A.smc','A.sfc'])

    def test_xml_escapes_names_and_declares_the_media_type_used_by_psnes(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_gamelist(tmp,[{'name':'Game.sfc','title':'A & B','cover':'media/mixrbv2/cover.png'}])
            game = ET.parse(Path(tmp)/'gamelist.xml').getroot()[0]
            self.assertGreater(int(game.get('id')), 0)
            self.assertEqual(game.findtext('name'),'A & B')
            self.assertEqual(game.find('image').get('type'),'mixrbv2')
            self.assertEqual(game.findtext('image'),'./media/mixrbv2/cover.png')


class FakeFTP:
    def __init__(self): self.files = {}; self.corrupt = False
    def cwd(self, name): pass
    def nlst(self): return list(self.files)
    def storbinary(self, command, source, **kwargs): self.files[command[5:]] = source.read() + (b'corrupt' if self.corrupt else b'')
    def retrbinary(self, command, consume, **kwargs): consume(self.files[command[5:]])
    def rename(self, source, target): self.files[target] = self.files.pop(source)
    def delete(self, name): del self.files[name]


class UploadTests(unittest.TestCase):
    def test_only_new_verified_files_are_published_and_existing_conflicts_are_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)/'game.sfc'; source.write_bytes(b'fixture')
            sha = hashlib.sha256(b'fixture').hexdigest(); ftp = FakeFTP()
            self.assertEqual(upload_one(ftp,source,'/data/psnes/roms','game.sfc',sha),'uploaded')
            self.assertEqual(upload_one(ftp,source,'/data/psnes/roms','game.sfc',sha),'identical')
            ftp.files['foreign.sfc'] = b'keep'
            with self.assertRaises(ValueError): upload_one(ftp,source,'/data/psnes/roms','foreign.sfc',sha)
            self.assertEqual(ftp.files['foreign.sfc'],b'keep')
            ftp.corrupt = True
            with self.assertRaises(ValueError): upload_one(ftp,source,'/data/psnes/roms','bad.sfc',sha)
            self.assertNotIn('bad.sfc',ftp.files)
            self.assertFalse(any(name.endswith('.upload') for name in ftp.files))
            with self.assertRaises(ValueError): upload_one(ftp,source,'/data/psnes/roms','bad\nname',sha)


if __name__ == '__main__': unittest.main()
