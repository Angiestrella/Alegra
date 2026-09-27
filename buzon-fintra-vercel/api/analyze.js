// Recibe un comentario, lo envía a Gemini con el prompt versión 2 y devuelve el análisis en JSON.
// Configuración en Vercel (Settings > Environment Variables):
//   GEMINI_API_KEY  tu clave de Google AI Studio (obligatoria)
//   GEMINI_MODEL    el nombre exacto del modelo que usaste en AI Studio (opcional)
const PROMPT = require("./_prompt.js");

const FUENTES = ["Reseña de Google Play", "Ticket de soporte", "Sesión con cliente"];
const TIPOS = ["bug", "mejora", "funcion_nueva", "pregunta_soporte"];
const SEVERIDADES = ["bloqueo_total", "bloquea_tarea_central", "bloquea_tarea_secundaria", "friccion", "deseo"];

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Usa POST." });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "Falta configurar GEMINI_API_KEY en Vercel." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== "object") return res.status(400).json({ error: "Envía un JSON con el comentario." });

  const comentario = typeof body.comentario === "string" ? body.comentario.trim() : "";
  if (!comentario) return res.status(400).json({ error: "El comentario está vacío." });
  if (comentario.length > 2000) return res.status(400).json({ error: "El comentario supera los 2.000 caracteres." });
  const fuente = FUENTES.includes(body.fuente) ? body.fuente : "Reseña de Google Play";
  const pais = typeof body.pais === "string" && body.pais.length <= 40 ? body.pais : "desconocido";
  const cal = Number(body.calificacion);
  const calTxt = Number.isInteger(cal) && cal >= 1 && cal <= 5 ? `${cal}/5` : "—";

  const entrada = `Fuente: ${fuente}\nPaís: ${pais}\nCalificación: ${calTxt}\nComentario: ${comentario}`;
  const modelo = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;

  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PROMPT }] },
        contents: [{ role: "user", parts: [{ text: entrada }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
      })
    });
  } catch (e) {
    return res.status(502).json({ error: "No se pudo conectar con Gemini." });
  }

  if (r.status === 429) return res.status(429).json({ error: "Se alcanzó el límite de uso de Gemini. Espera un minuto y vuelve a intentarlo." });
  if (!r.ok) {
    const detalle = await r.text().catch(() => "");
    return res.status(502).json({ error: `Gemini respondió con un error (${r.status}).`, detalle: detalle.slice(0, 300) });
  }

  const data = await r.json().catch(() => null);
  const texto = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").replace(/```json|```/g, "").trim();
  let analisis;
  try { analisis = JSON.parse(texto); } catch { return res.status(502).json({ error: "Gemini no devolvió un JSON válido." }); }

  if (!TIPOS.includes(analisis.tipo) || !SEVERIDADES.includes(analisis.severidad) || typeof analisis.resumen !== "string") {
    return res.status(502).json({ error: "El análisis no tiene el formato esperado." });
  }
  if (!analisis.necesita_bug_report) analisis.bug_report = null;
  return res.status(200).json(analisis);
};
