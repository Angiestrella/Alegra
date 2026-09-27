// Recibe un comentario, lo envía a Gemini con el prompt versión 2 y devuelve el análisis en JSON.
// Configuración en Vercel (Settings > Environment Variables):
//   GEMINI_API_KEY  tu clave de Google AI Studio (obligatoria)
//   GEMINI_MODEL           el identificador exacto del modelo que usaste en AI Studio
//   GEMINI_MODEL_FALLBACK  otro modelo para cuando el principal esté saturado (opcional)
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
  const modelos = [process.env.GEMINI_MODEL || "gemini-2.5-flash", process.env.GEMINI_MODEL_FALLBACK].filter(Boolean);
  const cuerpo = JSON.stringify({
    systemInstruction: { parts: [{ text: PROMPT }] },
    contents: [{ role: "user", parts: [{ text: entrada }] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
  });
  const esperar = ms => new Promise(ok => setTimeout(ok, ms));
 
  // Reintenta los errores temporales de Gemini (500, 502, 503, 504) y, si hay modelo de respaldo, lo usa.
  let r = null, ultimoEstado = 0;
  buscar: for (const modelo of modelos) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;
    for (let intento = 1; intento <= 3; intento++) {
      try {
        r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: cuerpo });
      } catch (e) { r = null; }
      ultimoEstado = r ? r.status : 0;
      if (r && r.ok) break buscar;
      if ([429, 400, 403, 404].includes(ultimoEstado)) break; // este modelo no sirve ahora: pasar al de respaldo
      if (r && ![500, 502, 503, 504].includes(ultimoEstado)) break buscar; // error que no se arregla reintentando
      if (intento < 3) await esperar(intento * 1500);
    }
  }
 
  if (!r) return res.status(502).json({ error: "No se pudo conectar con Gemini. Vuelve a intentarlo." });
  if (ultimoEstado === 429) return res.status(429).json({ error: "Se alcanzó el límite de uso de Gemini. Espera un minuto y vuelve a intentarlo." });
  if ([500, 502, 503, 504].includes(ultimoEstado)) return res.status(503).json({ error: "Gemini está saturado en este momento. Espera un minuto y vuelve a intentarlo." });
  if (!r.ok) {
    const detalle = await r.text().catch(() => "");
    let motivo = "";
    try { motivo = (JSON.parse(detalle).error || {}).message || ""; } catch (e) {}
    console.error("Gemini", r.status, detalle.slice(0, 500)); // visible en Vercel > Registros
    return res.status(502).json({ error: `Gemini respondió con un error (${r.status})${motivo ? ": " + motivo.slice(0, 220) : "."}` });
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
