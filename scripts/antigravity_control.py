#!/usr/bin/env python3
"""Antigravity IDE process control. Stdlib only; exact executable identity."""
import argparse, json, os, subprocess, sys, time, ctypes
from ctypes import wintypes

GRACE_SECONDS = 8

def window_pids(pids):
    """Post WM_CLOSE only to visible top-level windows owned by exact-path PIDs."""
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    sent = set()
    errors = []
    @callback_type
    def each(hwnd, _):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids and user32.IsWindowVisible(hwnd):
            if not user32.PostMessageW(hwnd, 0x0010, 0, 0):
                errors.append(ctypes.get_last_error())
                return False
            sent.add(pid.value)
        return True
    completed = user32.EnumWindows(each, 0)
    if errors or not completed: raise OSError(errors[0] if errors else ctypes.get_last_error(), 'WM_CLOSE/EnumWindows gagal')
    return sent

def wait_stopped(exe, seconds=GRACE_SECONDS):
    deadline = time.monotonic() + seconds
    while True:
        remaining = matching_pids(exe)
        if not remaining: return []
        if time.monotonic() >= deadline: return remaining
        time.sleep(min(.25, max(0, deadline-time.monotonic())))


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def run(argv):
    return subprocess.run(argv, capture_output=True, text=True, timeout=20)

def fail(msg):
    print(json.dumps({"ok": False, "error": msg}))
    return 1

def ok(**kw):
    print(json.dumps({"ok": True, **kw}))
    return 0

def detect_executable():
    for node in ("node", "node.exe"):
        try:
            r = run([node, os.path.join(REPO, "src", "detect.js")])
            if r.returncode == 0:
                return json.loads(r.stdout).get("executable")
        except (OSError, subprocess.TimeoutExpired, ValueError):
            continue
    raise ValueError("node tidak ditemukan; deteksi Antigravity IDE gagal.")

def verified_executable(executable=None):
    detected = detect_executable()
    if not detected:
        raise ValueError("Binary Antigravity IDE terverifikasi tidak ditemukan atau ambigu.")
    if executable and os.path.normcase(os.path.realpath(executable)) != os.path.normcase(os.path.realpath(detected)):
        raise ValueError("Executable bukan Antigravity IDE terverifikasi.")
    return detected

def processes():
    if sys.platform == "win32":
        script = "Get-CimInstance Win32_Process -Filter \"Name='Antigravity IDE.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"
        r = run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script])
        if r.returncode != 0: raise OSError((r.stderr or r.stdout).strip())
        data = json.loads(r.stdout or "[]")
        return data if isinstance(data, list) else [data]
    r = run(["ps", "-eo", "pid=,comm="])
    return [{"ProcessId": int(x.split(None,1)[0]), "ExecutablePath": x.split(None,1)[1]} for x in r.stdout.splitlines() if len(x.split(None,1)) == 2]

def matching_pids(executable, entries=None):
    wanted = os.path.normcase(os.path.realpath(executable))
    result=[]
    for p in entries if entries is not None else processes():
        actual=p.get("ExecutablePath")
        if actual and os.path.normcase(os.path.realpath(actual)) == wanted:
            try: result.append(int(p["ProcessId"]))
            except (KeyError, TypeError, ValueError): pass
    return result

def status(executable=None):
    exe=verified_executable(executable)
    pids=matching_pids(exe)
    return ok(action="status",running=bool(pids),processIds=pids,executable=exe)

def close(force, executable=None):
    exe=verified_executable(executable)
    pids=matching_pids(exe)
    if not pids: return ok(action="close",running=False,message="Antigravity IDE tidak sedang berjalan.")
    print("PERINGATAN: menutup Antigravity IDE dapat menghilangkan pekerjaan yang belum disimpan.",file=sys.stderr)
    if sys.platform == "win32" and not force:
        sent = window_pids(set(pids))
        if not sent: return fail("FORCE_REQUIRED: Jendela utama Antigravity IDE tidak ditemukan; tidak ada proses yang dipaksa berhenti.")
        remaining = wait_stopped(exe)
        if remaining: return fail(f"FORCE_REQUIRED: Antigravity IDE menolak/belum selesai menutup (PID {remaining}). Simpan pekerjaan lalu pilih Paksa Restart jika setuju kehilangan perubahan belum disimpan.")
    else:
        for pid in pids:
            argv=["taskkill","/PID",str(pid),"/F"] if sys.platform=="win32" else ["kill","-KILL" if force else "-TERM",str(pid)]
            r=run(argv)
            if r.returncode != 0: return fail(f"Gagal menutup PID {pid}: {(r.stderr or r.stdout).strip()}")
        remaining=wait_stopped(exe)
        if remaining: return fail(f"Proses masih berjalan setelah permintaan tutup: {remaining}")
    return ok(action="close",forced=force,processIds=pids,message="Antigravity IDE berhenti; identitas executable dan PID telah diverifikasi.")

def launch(executable=None):
    exe=verified_executable(executable)
    subprocess.Popen([exe],cwd=os.path.dirname(exe),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=(sys.platform!="win32"))
    return ok(action="launch",executable=exe,message="Antigravity IDE diluncurkan.")

def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest="action",required=True)
    s=sub.add_parser("status");s.add_argument("--executable")
    c=sub.add_parser("close");c.add_argument("--force",action="store_true");c.add_argument("--executable")
    l=sub.add_parser("launch");l.add_argument("--executable")
    a=p.parse_args()
    try:
        if a.action=="status": return status(a.executable)
        if a.action=="close": return close(a.force,a.executable)
        return launch(a.executable)
    except (OSError,subprocess.TimeoutExpired,ValueError) as e: return fail(f"Kontrol Antigravity IDE gagal: {e}")
if __name__=="__main__":sys.exit(main())
