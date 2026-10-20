import hashlib
from pathlib import Path
import tempfile
import unittest
from windows_agent import print_arguments, executable_digest, NoRedirect

class AgentTests(unittest.TestCase):
    def test_safe_argument_array_and_duplex(self):
        job = {"id": "a"*24, "copies": 3, "color": False, "duplex": "long", "kind": "document", "printer": 'Office & Printer;not-a-command'}
        args = print_arguments(job, Path('C:/SumatraPDF.exe'), Path('C:/document.pdf'))
        self.assertEqual(args[2], job['printer'])
        self.assertIn('3x,monochrome,duplexlong,fit,paper=A4', args)
        self.assertEqual(args[-1], 'C:/document.pdf')
    def test_photo_uses_driver_paper_size(self):
        args = print_arguments({"id":"a"*24,"copies":1,"color":True,"duplex":"off","kind":"photo","printer":"Photo"},Path('sumatra'),Path('photo.pdf'))
        self.assertNotIn('paper=A4', args[4])
    def test_rejects_invalid_job_settings(self):
        job = {"id":"a"*24,"copies":1,"color":True,"duplex":"off","kind":"document","printer":"Office"}
        for changed in [{"id":"../../file"},{"copies":True},{"copies":21},{"duplex":"anything"},{"printer":"\ncommand"},{"printer":"-silent"},{"color":"false"}]:
            with self.assertRaises(ValueError): print_arguments({**job,**changed},Path('sumatra'),Path('pdf'))
    def test_executable_checksum(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'fixture'; p.write_bytes(b'test')
            self.assertEqual(executable_digest(p),hashlib.sha256(b'test').hexdigest())
    def test_no_redirect(self):
        self.assertIsNone(NoRedirect().redirect_request(None,None,None,None,None,None))

if __name__ == '__main__': unittest.main()
