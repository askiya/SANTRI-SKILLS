#!/usr/bin/env python3
"""Antigravity process control (stdlib only): status / close / launch.

Detection of the installed binary is delegated to node src/detect.js
(findAntigravityExecutable) so paths stay in one place.
Close defaults to a GRACEFUL request; --force performs a hard kill.
Output: one JSON object on stdout. Exit 0 on success, 1 on failure.
"""
import argparse, json, os, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROC = "Antigravity.exe" if sys.platform == "win32" else "Antigravity" if sys.platform == "darwin" else "antigravity"

def run(argv):
    return subprocess.run(argv, capture_output=True, text=True, timeout=20)

def is_running():
    if sys.platform == "win32":
        r = run(["tasklist", "/FI", f"IMAGENAME eq {PROC}", "/FO", "CSV", "/NH"])
        return PROC.lower() in r.stdout.lower()
    return run(["pgrep", "-x", PROC]).returncode == 0

def detect_executable():
    for node in ("node", "node.exe"):
        try:
            r = run([node, os.path.join(REPO, "src", "detect.js")])
            if r.returncode == 0:
                return json.loads(r.stdout).get("executable")
        except (OSError, subprocess.TimeoutExpired, ValueError):
            continue
    raise SystemExit(fail("node tidak ditemukan; deteksi lokasi Antigravity (src/detect.js) gagal."))

def fail(msg):
    print(json.dumps({"ok": False, "error": msg}))
    return 1

def ok(**kw):
    print(json.dumps({"ok": True, **kw}))
    return 0

def close(force):
    if not is_running():
        return ok(action="close", running=False, message="Antigravity tidak sedang berjalan.")
    print("PERINGATAN: menutup Antigravity dapat menghilangkan pekerjaan yang belum disimpan.", file=sys.stderr)
    if sys.platform == "win32":
        # taskkill without /F sends WM_CLOSE (graceful); /F terminates hard.
        argv = ["taskkill", "/IM", PROC] + (["/F"] if force else [])
    elif force:
        argv = ["pkill", "-KILL", "-x", PROC]
    else:
        argv = ["pkill", "-TERM", "-x", PROC]
    r = run(argv)
    if r.returncode != 0:
        return fail(f"Gagal menutup Antigravity ({'paksa' if force else 'graceful'}): {(r.stderr or r.stdout).strip()}")
    return ok(action="close", forced=force, message="Permintaan tutup paksa dikirim." if force else "Permintaan tutup graceful dikirim; Antigravity bisa menolak jika ada dialog belum disimpan.")

def launch(executable):
    exe = executable or detect_executable()
    if not exe or not os.path.isfile(exe):
        return fail("Binary Antigravity tidak ditemukan. Instal Antigravity dulu; dashboard tidak akan menebak path lain.")
    if sys.platform == "darwin" and ".app/" in exe.replace("\\", "/"):
        app = exe.split(".app/")[0] + ".app"
        r = run(["open", app])
        if r.returncode != 0:
            return fail(f"Gagal membuka {app}: {(r.stderr or r.stdout).strip()}")
    else:
        subprocess.Popen([exe], cwd=os.path.dirname(exe) or None,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=(sys.platform != "win32"))
    return ok(action="launch", executable=exe, message="Antigravity diluncurkan.")

def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="action", required=True)
    sub.add_parser("status")
    c = sub.add_parser("close")
    c.add_argument("--force", action="store_true", help="hard kill; unsaved work WILL be lost")
    l = sub.add_parser("launch")
    l.add_argument("--executable", help="explicit path to the Antigravity binary")
    a = p.parse_args()
    try:
        if a.action == "status":
            return ok(action="status", running=is_running(), process=PROC)
        if a.action == "close":
            return close(a.force)
        return launch(a.executable)
    except (OSError, subprocess.TimeoutExpired) as e:
        return fail(f"Kontrol Antigravity gagal: {e}")

if __name__ == "__main__":
    sys.exit(main())
