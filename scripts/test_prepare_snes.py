import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('prepare_snes', Path(__file__).with_name('prepare-snes-test.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrepareTests(unittest.TestCase):
    def test_explicit_selection_copies_preserves_and_never_claims_console_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            a = root / 'Teste com acento ação.sfc'
            b = root / 'Segundo.smc'
            a.write_bytes(b'fictional test fixture A')
            b.write_bytes(b'fictional test fixture B')
            untouched = root / 'Outro.sfc'
            untouched.write_bytes(b'not selected')
            output = root / 'outputs'
            result = module.prepare([a, b], output)
            data = json.loads((result / 'manifest.json').read_text())
            self.assertEqual(len(data['roms']), 2)
            self.assertEqual(set(data['checks'].values()), {'pending'})
            self.assertEqual(data['status'], 'prepared-locally-not-tested-on-console')
            self.assertFalse((result / 'roms' / untouched.name).exists())
            for original in (a, b):
                self.assertEqual((result / 'roms' / original.name).read_bytes(), original.read_bytes())
            self.assertEqual(data['roms'][0]['sha256'], hashlib.sha256(a.read_bytes()).hexdigest())
            self.assertEqual(data['roms'][0]['ps4_target'], '/data/psnes/roms/' + a.name)
            self.assertNotIn(str(root), (result / 'manifest.json').read_text())
            again = module.prepare([a], output)
            self.assertNotEqual(result, again)
            self.assertTrue(result.exists())

    def test_rejects_invalid_missing_links_duplicate_names_and_large_batches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            a = root / 'one.sfc'
            a.write_bytes(b'test fixture')
            invalid = root / 'homebrew.iso'
            invalid.write_bytes(b'not an SNES ROM')
            linked = root / 'link.sfc'
            linked.symlink_to(a)
            output = root / 'out'
            for entries in ([], [a] * 4, [a, a], [invalid], [linked], [root / 'missing.smc']):
                with self.assertRaises((ValueError, OSError)):
                    module.prepare(entries, output)
            self.assertFalse(output.exists())
            with self.assertRaises(ValueError):
                module.prepare([a], Path.home() / 'Documents/prohibited-test-output')
            self.assertEqual(a.read_bytes(), b'test fixture')


if __name__ == '__main__':
    unittest.main()
