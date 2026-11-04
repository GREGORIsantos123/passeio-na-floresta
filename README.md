# Passeio na floresta

Os 12 princípios da animação com uma pessoa passeando com seu cachorro na floresta.
A movimentação da pessoa foi medida quadro a quadro em `movimentação.mp4`.

## Como abrir

- **Ver o vídeo pronto:** `passeio-na-floresta.mp4`
- **Ver ao vivo:** abra `index.html` no navegador (a barra de espaço pausa e continua)

## Como gerar de novo

Só é preciso para mudar a cena e exportar o vídeo. Requer Python e Google Chrome:

```
pip install imageio-ffmpeg numpy playwright
python tools/extract_motion.py movimentação.mp4 src/motion-data.js
python tools/render_video.py passeio-na-floresta.mp4
```

O primeiro comando Python só precisa rodar se o vídeo original mudar.

## Estrutura

- `src/scene.js`: personagens, floresta, efeitos e coreografia do cachorro
- `src/motion-data.js`: curvas medidas no vídeo original (arquivo gerado)
- `tools/`: extração do movimento e exportação do vídeo
