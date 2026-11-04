"""Mede a movimentacao do video original, quadro a quadro, e grava src/motion-data.js.

Uso: python tools/extract_motion.py movimentacao.mp4 src/motion-data.js [fx.txt]

Para cada painel da grade 4x3 (320x240 cada) guarda, por quadro:
  x     centro do corpo (px no painel)
  foot  base do corpo (px no painel)
  w, h  largura e altura do corpo
  lean  inclinacao (deslocamento horizontal por px de altura; + = topo para a direita)
  sq    "quadradez" (area / (w*h)): cupula ~0.78, quadrado ~0.95
  eye   altura do olho (detecta a piscada/olhar semicerrado)
  look  deslocamento dos olhos em relacao ao centro, normalizado por w
"""
import json
import subprocess
import sys

import imageio_ffmpeg
import numpy as np

W, H, PW, PH = 1280, 720, 320, 240
NAMES = ["solido", "encenacao", "antecipacao", "apelo", "pose", "arco", "exagero",
         "continuidade", "secundaria", "easing", "timing", "squash"]
# As duas raias do painel Timing sao separadas em y=118.
TIMING_SPLIT = 118


def load(video):
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    raw = subprocess.run([exe, "-hide_banner", "-loglevel", "error", "-i", video,
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)


def body_mask(p):
    """Laranja cheio do corpo; rastros e brilho (semitransparentes) ficam de fora."""
    r, g, b = p[..., 0].astype(np.int16), p[..., 1].astype(np.int16), p[..., 2].astype(np.int16)
    return (r > 240) & (g > 135) & (g < 175) & (b < 80)


def white_mask(p):
    return (p[..., 0] > 215) & (p[..., 1] > 215) & (p[..., 2] > 205)


def measure(p, y_off, is_secondary=False):
    m = body_mask(p)
    white = white_mask(p)
    ball = None
    if is_secondary:
        # Linhas estreitas no topo sao a bolinha e o "pescoco": separa do corpo.
        ys = np.nonzero(m.any(axis=1))[0]
        if len(ys):
            widths = m.sum(axis=1)
            body_rows = np.nonzero(widths >= 20)[0]
            if len(body_rows):
                ball = float(ys.min() + y_off)
                m = m.copy()
                m[:body_rows.min()] = False
    ys, xs = np.nonzero(m)
    if len(xs) < 8:
        return None, ball
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    w, h = int(x1 - x0 + 1), int(y1 - y0 + 1)

    # Olhos: pontos brancos dentro da caixa do corpo.
    sub = white[y0:y1 + 1, x0:x1 + 1]
    ey, ex = np.nonzero(sub)
    if len(ex) >= 4:
        eye_h = float(ey.max() - ey.min() + 1)
        eye_cx = float(ex.mean() + x0)
    else:
        eye_h, eye_cx = 0.0, None

    # Inclinacao: regressao do centro de cada linha contra a altura.
    rows, centers = [], []
    for r in range(y0, y1 + 1):
        c = np.nonzero(m[r] | white[r])[0]
        if len(c) >= 2:
            rows.append(r)
            centers.append((c.min() + c.max()) / 2)
    lean = 0.0
    if len(rows) >= 8:
        lean = -float(np.polyfit(rows, centers, 1)[0])

    filled = (m | white)[y0:y1 + 1, x0:x1 + 1].sum()
    cx = (x0 + x1) / 2
    look = 0.0 if eye_cx is None else (eye_cx - cx) / max(w, 1)
    return dict(x=float(cx), foot=float(y1 + 1 + y_off), w=w, h=h, lean=lean,
                sq=float(filled) / (w * h), eye=eye_h, look=look,
                clipped=bool(y0 + y_off <= 1)), ball


def smooth(a, sigma=1.0):
    r = 3
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    return np.convolve(np.pad(a, r, mode="edge"), k, mode="valid")


def to_track(samples):
    """Lista de dicts/None -> colunas suavizadas; None continua marcado em vis=0."""
    n = len(samples)
    keys = ["x", "foot", "w", "h", "lean", "sq", "eye", "look"]
    vis = np.array([s is not None for s in samples])
    cols = {k: np.zeros(n) for k in keys}
    last = None
    for i, s in enumerate(samples):
        if s is None:
            s = last
        if s is None:
            s = next((v for v in samples if v is not None), None)
        if s is None:
            continue
        for k in keys:
            cols[k][i] = s[k]
        if not s["clipped"]:
            last = s
        else:
            # Saiu pelo topo: a altura medida nao vale, mantem a ultima boa.
            if last is not None:
                cols["w"][i], cols["h"][i] = last["w"], last["h"]
    for k in ("w", "h", "lean", "sq", "look"):
        cols[k] = smooth(cols[k], 1.0)
    return {
        "vis": vis.astype(int).tolist(),
        "x": np.round(cols["x"], 1).tolist(),
        "foot": np.round(cols["foot"], 1).tolist(),
        "w": np.round(cols["w"], 1).tolist(),
        "h": np.round(cols["h"], 1).tolist(),
        "lean": np.round(cols["lean"], 2).tolist(),
        "sq": np.round(cols["sq"], 2).tolist(),
        "eye": np.round(cols["eye"], 0).astype(int).tolist(),
        "look": np.round(cols["look"], 2).tolist(),
    }


def main():
    video, out = sys.argv[1], sys.argv[2]
    frames = load(video)
    tracks, balls = {}, []
    for i, name in enumerate(NAMES):
        px, py = (i % 4) * PW, (i // 4) * PH
        crops = frames[:, py + 1:py + PH - 1, px + 1:px + PW - 1]
        if name == "timing":
            top, bot = [], []
            for c in crops:
                top.append(measure(c[:TIMING_SPLIT - 1], 1)[0])
                bot.append(measure(c[TIMING_SPLIT - 1:], TIMING_SPLIT)[0])
            tracks["timing_a"] = to_track(top)
            tracks["timing_b"] = to_track(bot)
            continue
        samples = []
        for c in crops:
            s, ball = measure(c, 1, name == "secundaria")
            samples.append(s)
            if name == "secundaria":
                balls.append(ball if ball is not None else 0.0)
        tracks[name] = to_track(samples)
    tracks["secundaria"]["ball"] = np.round(smooth(np.array(balls), 0.8), 1).tolist()

    with open(out, "w", encoding="utf-8") as f:
        f.write("// Gerado por tools/extract_motion.py a partir do video original. Nao editar.\n")
        f.write("window.MOTION=" + json.dumps(tracks, separators=(",", ":")) + ";\n")

    # Relatorio: quando aparecem efeitos fora do corpo (branco e poeira cinza).
    if len(sys.argv) > 3:
        with open(sys.argv[3], "w", encoding="utf-8") as f:
            for i, name in enumerate(NAMES):
                px, py = (i % 4) * PW, (i // 4) * PH
                wh, gr = [], []
                for fr in frames:
                    c = fr[py + 30:py + PH - 1, px + 1:px + PW - 1].astype(np.int16)
                    w = (c[..., 0] > 150) & (c[..., 1] > 150) & (c[..., 2] > 150)
                    g = (abs(c[..., 0] - c[..., 2]) < 18) & (c[..., 0] > 45) & (c[..., 0] < 140)
                    wh.append(int(w.sum()))
                    gr.append(int(g.sum()))
                f.write(f"\n== {name}\nwhite " + " ".join(map(str, wh[:330:5])) +
                        "\ngray  " + " ".join(map(str, gr[:330:5])) + "\n")
    t = tracks["pose"]
    print("ok", {k: len(v["x"]) for k, v in tracks.items()}, "pose w0", t["w"][0], "h0", t["h"][0])


if __name__ == "__main__":
    main()
