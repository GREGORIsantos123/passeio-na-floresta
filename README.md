# Passeio na floresta

Os 12 princípios da animação com uma pessoa passeando com seu cachorro na floresta.
A movimentação da pessoa foi medida quadro a quadro em `movimentação.mp4`.

Há também um filme de 20s: o passeio, o encontro com o urso, a fuga e a chegada à cabana ao lado do lago.

## Como abrir

| | 12 princípios (10s) | Filme do urso (20s) |
|---|---|---|
| **Vídeo pronto** | `passeio-na-floresta.mp4` | `urso-na-floresta.mp4` |
| **Ao vivo no navegador** | `index.html` | `historia.html` |

Nas páginas ao vivo, a barra de espaço pausa e continua.

## Como gerar de novo

Só é preciso para mudar a cena e exportar o vídeo. Requer Python e Google Chrome:

```
pip install imageio-ffmpeg numpy playwright
python tools/extract_motion.py movimentação.mp4 src/motion-data.js
python tools/render_video.py passeio-na-floresta.mp4
python tools/render_video.py urso-na-floresta.mp4 --page historia.html --count 1200 --ss 1.5
```

O comando `extract_motion.py` só precisa rodar se o vídeo original mudar.

## Estrutura

- `src/scene.js`: personagens, floresta, efeitos e coreografia do cachorro
- `src/story.js`: filme do urso (roteiro, urso, cabana, lago e peixes)
- `src/motion-data.js`: curvas medidas no vídeo original (arquivo gerado)
- `tools/`: extração do movimento e exportação do vídeo
