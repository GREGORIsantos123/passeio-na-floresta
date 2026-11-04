"""Renderiza a cena quadro a quadro no Chrome e grava o video, ou so alguns quadros.

Video completo:   python tools/render_video.py passeio-na-floresta.mp4
Quadros de teste: python tools/render_video.py pasta/ --frames 0,30,90
"""
import argparse
import base64
import pathlib
import subprocess

import imageio_ffmpeg
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
GRAB = "(f) => { drawFrame(f); return document.getElementById('stage').toDataURL('image/png').split(',')[1]; }"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--frames", help="lista de quadros; grava PNGs em vez do video")
    ap.add_argument("--ss", type=float, default=2, help="superamostragem do render")
    ap.add_argument("--page", default="index.html", help="pagina a renderizar")
    ap.add_argument("--count", type=int, default=600, help="total de quadros do video")
    a = ap.parse_args()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto((ROOT / a.page).as_uri() + f"?capture=1&ss={a.ss}")
        try:
            page.wait_for_function("window.ready === true", timeout=120000)
        finally:
            if errors:
                print("ERROS NA PAGINA:", errors)

        if a.frames:
            out = pathlib.Path(a.out)
            out.mkdir(parents=True, exist_ok=True)
            for f in map(int, a.frames.split(",")):
                (out / f"t_{f:03d}.png").write_bytes(base64.b64decode(page.evaluate(GRAB, f)))
        else:
            cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
                   "-f", "image2pipe", "-framerate", "60", "-c:v", "png", "-i", "-",
                   "-vf", "scale=1280:720:flags=lanczos", "-c:v", "libx264", "-preset", "slow",
                   "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", a.out]
            ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
            for f in range(a.count):
                ff.stdin.write(base64.b64decode(page.evaluate(GRAB, f)))
                if f % 60 == 0:
                    print("quadro", f, flush=True)
            ff.stdin.close()
            if ff.wait() != 0:
                raise SystemExit("ffmpeg falhou")
        browser.close()
    if errors:
        raise SystemExit(f"Erros na pagina: {errors}")
    print("ok", a.out)


if __name__ == "__main__":
    main()
