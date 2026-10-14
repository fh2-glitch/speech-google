import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import speech from "@google-cloud/speech";

const app = express();
app.use(cors());

const googleCredentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

const client = new speech.SpeechClient({
  credentials: googleCredentials
});

const upload = multer({ dest: "uploads/" });

function normalizeArabic(text) {
  return text
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/\s+/g, " ")
    .replace(/[،؛؟.!?,:]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\u0600-\u06FF\s]/g, "")
    .trim();
}

app.get("/health", (req, res) => {
  res.json({ status: "ok-google" });
});

app.post("/recognize-google", upload.single("audio"), async (req, res) => {
  try {
    console.log("Fichier reçu :", req.file);

    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier audio reçu." });
    }

    const audioBytes = fs.readFileSync(req.file.path).toString("base64");

    const [response] = await client.recognize({
      audio: {
        content: audioBytes
      },
      config: {
        encoding: "LINEAR16",
        languageCode: "ar-MA",
        alternativeLanguageCodes: ["ar"],
        enableAutomaticPunctuation: false,
        model: "latest_short"
      }
    });

    fs.unlinkSync(req.file.path);

    const text =
      response.results
        ?.map(result => result.alternatives?.[0]?.transcript || "")
        .join(" ")
        .trim() || "";

    const normalized = normalizeArabic(text);

    res.json({
      text,
      normalized,
      raw: response
    });

  } catch (error) {
    console.error("ERREUR GOOGLE :", error);

    res.status(500).json({
      message: error.message,
      code: error.code,
      details: error.details
    });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Google Speech server running on port ${PORT}`);
});
