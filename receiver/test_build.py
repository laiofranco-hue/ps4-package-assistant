import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('receiver_build', Path(__file__).with_name('build.py'))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class RuntimePackaging(unittest.TestCase):
    def test_required_modules_are_copied_and_identified(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'sdk/src/modules'
            source.mkdir(parents=True)
            stage = root / 'stage'
            stage.mkdir()
            for name in ('libc.prx', 'libSceFios2.prx'):
                (source / name).write_bytes(bytes.fromhex('4f153d1d') + bytes(60))
            hashes = build.stage_runtime_modules(root / 'sdk', stage)
            self.assertEqual(set(hashes), {'libc.prx', 'libSceFios2.prx'})
            for name in hashes:
                self.assertEqual((source / name).read_bytes(), (stage / 'sce_module' / name).read_bytes())
            (source / 'libc.prx').unlink()
            with self.assertRaises(FileNotFoundError):
                build.stage_runtime_modules(root / 'sdk', stage)

    def test_invalid_runtime_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'sdk/src/modules'
            source.mkdir(parents=True)
            (source / 'libc.prx').write_bytes(b'not a module')
            stage = root / 'stage'
            stage.mkdir()
            with self.assertRaises(ValueError):
                build.stage_runtime_modules(root / 'sdk', stage)


if __name__ == '__main__':
    unittest.main()
