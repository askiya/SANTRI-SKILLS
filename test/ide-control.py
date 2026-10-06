import importlib.util, os, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('control',os.path.join(os.path.dirname(__file__),'../scripts/antigravity_control.py'))
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
class IdentityTests(unittest.TestCase):
    def test_close_only_matches_exact_executable_not_product_name(self):
        exe='C:/Apps/IDE/Antigravity IDE.exe'
        processes=[{'ProcessId':11,'ExecutablePath':exe},{'ProcessId':12,'ExecutablePath':'C:/Apps/Desktop/Antigravity.exe'},{'ProcessId':13,'ExecutablePath':'C:/Other/Antigravity IDE.exe'},{'ProcessId':14,'ExecutablePath':None}]
        self.assertEqual(c.matching_pids(exe,processes),[11])
    def test_wrong_variant_launch_rejected_without_spawn(self):
        with patch.object(c,'verified_executable',side_effect=ValueError('Bukan Antigravity IDE')),patch.object(c.subprocess,'Popen') as spawn:
            with self.assertRaises(ValueError): c.launch('C:/Apps/Desktop/Antigravity.exe')
            spawn.assert_not_called()
    def test_graceful_close_posts_wm_close_then_waits_without_taskkill(self):
        with patch.object(c.sys,'platform','win32'),patch.object(c,'verified_executable',return_value='fixture'),patch.object(c,'processes',return_value=[{'ProcessId':11,'ExecutablePath':'fixture'},{'ProcessId':12,'ExecutablePath':'other'}]),patch.object(c,'window_pids',return_value={11}) as windows,patch.object(c,'wait_stopped',return_value=[]) as waited,patch.object(c,'run') as run:
            self.assertEqual(c.close(False,'fixture'),0)
            windows.assert_called_once_with({11});waited.assert_called_once_with('fixture');run.assert_not_called()
    def test_graceful_timeout_returns_force_required_without_force(self):
        with patch.object(c.sys,'platform','win32'),patch.object(c,'verified_executable',return_value='fixture'),patch.object(c,'processes',return_value=[{'ProcessId':11,'ExecutablePath':'fixture'}]),patch.object(c,'window_pids',return_value={11}),patch.object(c,'wait_stopped',return_value=[11]),patch.object(c,'run') as run:
            self.assertEqual(c.close(False,'fixture'),1);run.assert_not_called()
    def test_force_close_uses_exact_pid_and_slash_f_only_after_explicit_force(self):
        result=type('R',(),{'returncode':0,'stdout':'','stderr':''})()
        with patch.object(c.sys,'platform','win32'),patch.object(c,'verified_executable',return_value='fixture'),patch.object(c,'processes',return_value=[{'ProcessId':11,'ExecutablePath':'fixture'},{'ProcessId':12,'ExecutablePath':'other'}]),patch.object(c,'wait_stopped',return_value=[]),patch.object(c,'run',return_value=result) as run:
            self.assertEqual(c.close(True,'fixture'),0)
            run.assert_called_once_with(['taskkill','/PID','11','/F'])
if __name__=='__main__':unittest.main()
