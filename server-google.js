import express from "express";
import multer from "multer";
import cors from "cors";
import speech from "@google-cloud/speech";

const app = express();

/* 1. Sites autorisés à utiliser le serveur (protège votre quota Google).
      Réglage sur Render → Environment → variable ORIGINES_AUTORISEES, adresses séparées par des virgules, ex. :
        https://e-madrassa.ma,https://www.e-madrassa.ma,https://autre-site.ma
      ORIGINES_AUTORISEES = *   → tous les sites sont acceptés (comme avant)
      Sans variable : e-madrassa.ma + les tests sur votre ordinateur (fichier ouvert directement, localhost). */
const ORIGINES = (process.env.ORIGINES_AUTORISEES ||
  "https://e-madrassa.ma,https://www.e-madrassa.ma")
  .split(",").map(o => o.trim().replace(/\/$/, "")).filter(Boolean);
const TOUT_ACCEPTER = ORIGINES.includes("*");

function origineAcceptee(origin) {
  if (TOUT_ACCEPTER || !origin || origin === "null") return true;            // "null" = page ouverte depuis un fichier (tests)
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;  // tests sur votre ordinateur
  if (ORIGINES.includes(origin)) return true;
  // un sous-domaine d'un site autorisé (ex. cours.e-madrassa.ma) est accepté aussi
  return ORIGINES.some(o => { try { return new URL(origin).hostname.endsWith("." + new URL(o).hostname.replace(/^www\./, "")); } catch (e) { return false; } });
}
app.use(cors({ origin: (origin, ok) => ok(null, origineAcceptee(origin)) }));

const googleCredentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const client = new speech.SpeechClient({ credentials: googleCredentials });

/* 2. L'audio reste en mémoire : il n'est JAMAIS écrit sur le disque du serveur.
      Taille maximum 5 Mo (une lecture de 20 s en WAV fait environ 2 Mo). */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

function normalizeArabic(text) {
  return text
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/\s+/g, " ")
    .replace(/[،؛؟.!?,:]/g, "")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[^؀-ۿ\s]/g, "")
    .trim();
}

app.get("/health", (req, res) => {
  res.json({ status: "ok-google" });
});

app.post("/recognize-google", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier audio reçu." });
    }
    /* 3. Le journal ne contient que la taille du fichier, jamais l'audio ni le texte reconnu. */
    console.log("Audio reçu :", req.file.size, "octets");

    const [response] = await client.recognize({
      audio: { content: req.file.buffer.toString("base64") },
      config: {
        encoding: "LINEAR16",
        languageCode: "ar-MA",
        alternativeLanguageCodes: ["ar"],
        enableAutomaticPunctuation: false,
        model: "latest_short"
      }
    });

    const text =
      response.results
        ?.map(result => result.alternatives?.[0]?.transcript || "")
        .join(" ")
        .trim() || "";

    /* 4. On ne renvoie que le texte (la réponse brute de Google n'est plus transmise). */
    res.json({ text, normalized: normalizeArabic(text) });

  } catch (error) {
    console.error("ERREUR GOOGLE :", error.code, error.message);
    res.status(500).json({ message: error.message, code: error.code });
  } finally {
    if (req.file) req.file.buffer = null;      // l'audio est libéré dans tous les cas
  }
});

/* fichier trop gros ou autre erreur d'envoi */
app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Serveur de reconnaissance prêt sur le port", PORT));
