import hashlib
import io
import json
from pathlib import Path
import posixpath
import tempfile
import unittest
import xml.etree.ElementTree as ET
from snes_app import synchronize, merge_xml, update_config, validate_library, main
from unittest.mock import patch


class FTP:
    def __init__(self):
        self.here = '/'
        self.files = {
            '/data/psnes/config.cfg':b'PSNES { ROMS : { }; SHOW_ZIP_NAMES = "ON"; SCALING = "FIT"; };',
            '/data/psnes/roms/gamelist.xml':b'<gameList><game id="1"><path>./other.smc</path><name>Other</name></game></gameList>',
            '/data/psnes/roms/other.smc':b'other',
            '/data/psnes/saves/other-0.state':b'state',
        }
        self.dirs = {'/','/data','/data/psnes','/data/psnes/roms','/data/psnes/saves'}
        self.fail_config = False
        self.closed = False
    def full(self,name): return posixpath.normpath(posixpath.join(self.here,name))
    def cwd(self,name):
        from ftplib import error_perm
        target=self.full(name)
        if target not in self.dirs: raise error_perm('550 missing')
        self.here=target
    def mkd(self,name): self.dirs.add(self.full(name))
    def nlst(self): return [posixpath.basename(n) for n in self.files if posixpath.dirname(n)==self.here]
    def retrlines(self,command,consume):
        folder=self.full(command[5:])
        for name in sorted(self.dirs | set(self.files)):
            if name != folder and posixpath.dirname(name)==folder:
                kind='d' if name in self.dirs else '-'
                size=0 if kind=='d' else len(self.files[name])
                consume(f'{kind}rwxr-xr-x 1 root root {size} Jan 1 00:00 {posixpath.basename(name)}')
    def retrbinary(self,command,consume,**kwargs): consume(self.files[self.full(command[5:])])
    def storbinary(self,command,source,**kwargs): self.files[self.full(command[5:])]=source.read()
    def rename(self,source,target):
        source,target=self.full(source),self.full(target)
        if self.fail_config and '.tmp' in source and target=='/data/psnes/config.cfg':
            self.fail_config=False
            raise OSError('simulated disconnect at config publication')
        if target in self.files: raise ValueError('exists')
        self.files[target]=self.files.pop(source)
    def delete(self,name): del self.files[self.full(name)]
    def close(self): self.closed=True


class AppTests(unittest.TestCase):
    def test_incompatible_iso_fails_before_metadata_or_cover_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch('snes_app.signal.signal'),patch('snes_library.subprocess.check_output',return_value='SYSTEM.CNF\nGAME.BIN'),patch('snes_app.download') as download:
                with self.assertRaisesRegex(ValueError,'não contém jogos SNES'):
                    main({'work':tmp,'kind':'prepare','iso':str(Path(tmp)/'wrong.iso'),'id':'test'})
                download.assert_not_called()

    def fixture(self,tmp):
        folder=Path(tmp)/'collection';(folder/'roms/media/mixrbv2').mkdir(parents=True)
        rom=b'fictional-rom';cover=b'fictional-cover'
        (folder/'roms/game.sfc').write_bytes(rom)
        (folder/'roms/media/mixrbv2/cover.png').write_bytes(cover)
        item={'name':'game.sfc','title':'Game & Test','sha256':hashlib.sha256(rom).hexdigest(),'cover':'media/mixrbv2/cover.png','cover_sha256':hashlib.sha256(cover).hexdigest()}
        (folder/'manifest.json').write_text(json.dumps({'version':1,'items':[item]}))
        work=Path(tmp)/'work';work.mkdir()
        return folder,work,item

    def test_sync_preserves_saves_unknown_games_and_other_preferences_and_is_repeatable(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder,work,item=self.fixture(tmp);ftp=FTP()
            report=synchronize(folder,work,'unused',lambda:None,ftp=ftp,progress=lambda *a,**k:None)
            self.assertEqual(report['roms'],1);self.assertEqual(report['saves_verified'],1)
            self.assertEqual(ftp.files['/data/psnes/saves/other-0.state'],b'state')
            self.assertEqual(ftp.files['/data/psnes/roms/other.smc'],b'other')
            root=ET.fromstring(ftp.files['/data/psnes/roms/gamelist.xml'])
            self.assertEqual(len(root),2);self.assertIn('Other',[x.findtext('name') for x in root])
            config=ftp.files['/data/psnes/config.cfg']
            self.assertIn(b'SHOW_ZIP_NAMES = "OFF"',config);self.assertIn(b'SCALING = "FIT"',config)
            self.assertIn(b'/data/psnes/roms/',config)
            self.assertTrue((Path(report['backup'])/'saves/other-0.state').exists())
            ftp.closed=False
            synchronize(folder,work,'unused',lambda:None,ftp=ftp,progress=lambda *a,**k:None)
            self.assertEqual(ftp.files['/data/psnes/config.cfg'],config)
            self.assertTrue(ftp.closed)

    def test_conflict_or_save_stem_collision_fails_before_metadata_changes(self):
        for name in ('game.sfc','game.smc'):
            with self.subTest(name=name),tempfile.TemporaryDirectory() as tmp:
                folder,work,_=self.fixture(tmp);ftp=FTP()
                ftp.files['/data/psnes/roms/'+name]=b'keep-existing'
                before=dict(ftp.files)
                with self.assertRaisesRegex(ValueError,'diferente|save existente'):
                    synchronize(folder,work,'unused',lambda:None,ftp=ftp)
                self.assertEqual(ftp.files,before)

    def test_metadata_transaction_rolls_back_both_files_if_second_publication_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder,work,_=self.fixture(tmp);ftp=FTP();before=dict(ftp.files);ftp.fail_config=True
            with self.assertRaises(OSError):
                synchronize(folder,work,'unused',lambda:None,ftp=ftp,progress=lambda *a,**k:None)
            for file in ('/data/psnes/config.cfg','/data/psnes/roms/gamelist.xml','/data/psnes/saves/other-0.state'):
                self.assertEqual(ftp.files[file],before[file])
            self.assertEqual(ftp.files['/data/psnes/roms/game.sfc'],b'fictional-rom')

    def test_cancel_before_transaction_does_not_publish_list_or_configuration(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder,work,_=self.fixture(tmp);ftp=FTP();before=dict(ftp.files)
            cancelled=False
            def progress(*args,**kwargs):
                nonlocal cancelled
                cancelled=True
            def check():
                if cancelled:raise ValueError('cancelled')
            with self.assertRaisesRegex(ValueError,'cancelled'):
                synchronize(folder,work,'unused',check,ftp=ftp,progress=progress)
            self.assertEqual(ftp.files,before)

    def test_changed_local_file_path_escape_and_unrecognized_configuration_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder,work,item=self.fixture(tmp)
            (folder/'roms/game.sfc').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'mudou'):validate_library(folder)
            item['name']='../game.sfc'
            (folder/'manifest.json').write_text(json.dumps({'version':1,'items':[item]}))
            with self.assertRaises(ValueError):validate_library(folder)
            with self.assertRaises(ValueError):update_config(b'ROMS : { SNES = ("Other", "0", "/other"); };')
            with self.assertRaises(ValueError):update_config(b'unknown')

if __name__=='__main__':unittest.main()
