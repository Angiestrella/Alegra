# Buzón de Fintra

Web de triage para el reto de Alegra. Archivos:

- `index.html`: la web (bandeja, prioridades y analizar comentario).
- `api/analyze.js`: el servidor que envía cada comentario a Gemini.
- `api/_prompt.js`: las instrucciones del sistema (prompt versión 2).
- `regenerar.html`: pasa los 17 comentarios por Gemini y genera `seed.json`.
- `vercel.json`: da hasta 60 segundos a cada análisis.

Configuración en Vercel: `GEMINI_API_KEY` (obligatoria) y `GEMINI_MODEL` (el nombre exacto del modelo usado en Google AI Studio).
