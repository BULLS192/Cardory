"use client";

import { Camera, Check, Image as ImageIcon, Loader2, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CardGame, CardLanguage } from "@/lib/types";
import { extractChineseCollectorNumber } from "@/lib/chinese-collector-ocr";
import { parsePrintedIdentity } from "@/lib/scanner-recognition";
import { compareCatalogueArtwork, type VisualCandidate } from "@/lib/scanner-visual";
import { cardImage } from "@/lib/tcgdex";
import type { CardSearchResult } from "@/lib/types";

type ScannerProps = {
  game: CardGame;
  language: CardLanguage;
  onDetected: (number: string, rawText: string, preferredCardId?: string) => Promise<void> | void;
  onClose: () => void;
  setCode?: string;
};

type Status = "camera" | "processing" | "result" | "error";

function normalizeCandidate(value: string) {
  return value
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[|\\]/g, "/")
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .replace(/L(?=\d)/g, "1");
}

function preprocessCanvas(source: HTMLCanvasElement, chinese = false) {
  const output = document.createElement("canvas");
  const context = output.getContext("2d", { willReadFrequently: true });
  if (!context) return source;

  const cropTop = Math.floor(source.height * (chinese ? 0.40 : 0.60));
  const cropHeight = Math.max(1, source.height - cropTop);
  const maxWidth = 1600;
  const scale = Math.min(2, maxWidth / source.width);
  output.width = Math.max(1, Math.round(source.width * scale));
  output.height = Math.max(1, Math.round(cropHeight * scale));

  context.drawImage(
    source,
    0,
    cropTop,
    source.width,
    cropHeight,
    0,
    0,
    output.width,
    output.height
  );

  const image = context.getImageData(0, 0, output.width, output.height);
  const data = image.data;

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const contrast = gray > 155 ? 255 : gray < 95 ? 0 : (gray - 95) * (255 / 60);
    data[i] = contrast;
    data[i + 1] = contrast;
    data[i + 2] = contrast;
  }

  context.putImageData(image, 0, 0);
  return output;
}

export default function CardScanner({
  game,
  language,
  onDetected,
  onClose,
  setCode,
}: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<Status>("camera");
  const [message, setMessage] = useState("Point the lower edge of the card inside the frame.");
  const [progress, setProgress] = useState(0);
  const [rawText, setRawText] = useState("");
  const [candidate, setCandidate] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [matches, setMatches] = useState<VisualCandidate[]>([]);
  const [preferredId, setPreferredId] = useState("");
  const [visualBusy, setVisualBusy] = useState(false);
  const [visualProgress, setVisualProgress] = useState("");
  const [visualNotice, setVisualNotice] = useState("");
  const lastCaptureRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    void startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }

  async function startCamera() {
    stopCamera();
    setStatus("camera");
    setMessage("Center the entire card in the frame, including its number.");
    setMatches([]);
    setPreferredId("");
    setVisualNotice("");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMessage("Live camera is unavailable here. Use Take / Upload Photo instead.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch {
      setMessage("Camera permission was not granted. You can still take or upload a photo.");
    }
  }

  async function findVisualMatches(canvas: HTMLCanvasElement, printed: string) {
    setMatches([]);
    setPreferredId("");
    setVisualNotice("");
    setVisualBusy(true);
    setVisualProgress("Looking up catalogue artwork…");
    try {
      const params = new URLSearchParams({ game, language, number: printed });
      if (setCode?.trim()) params.set("set", setCode.trim());
      const response = await fetch("/api/cards/search?" + params.toString());
      if (!response.ok) throw new Error("Catalogue search unavailable");
      const data = await response.json() as { results?: CardSearchResult[] };
      const options = Array.isArray(data.results) ? data.results : [];
      if (!options.length) {
        setVisualNotice("No indexed printing matches this number. Check the set code or search manually.");
        return;
      }
      const ranked = await compareCatalogueArtwork(canvas, options,
        (done, total) => setVisualProgress("Comparing artwork " + done + "/" + total));
      setMatches(ranked.slice(0, 5));
      if (!ranked.some((entry) => entry.similarity !== null)) {
        setVisualNotice("Reference artwork is unavailable. Confirm the set and number in the catalogue.");
      } else {
        setVisualNotice("Artwork similarity is a suggestion, not proof of set or foil variant. Select the correct printing.");
      }
    } catch {
      setVisualNotice("Artwork comparison is unavailable. Number search still works.");
    } finally {
      setVisualBusy(false);
      setVisualProgress("");
    }
  }

  async function recognize(canvas: HTMLCanvasElement) {
    lastCaptureRef.current = canvas;
    setMatches([]);
    setPreferredId("");
    setVisualNotice("");
    setStatus("processing");
    setProgress(0);
    const chinese = game === "pokemon" &&
      (language === "Chinese" || language === "Chinese Simplified");
    setMessage(chinese ? "Reading Chinese set code and collector number on-device…"
      : "Reading the collector number on-device…");

    let worker: Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>> | null = null;
    try {
      const { createWorker } = await import("tesseract.js");
      // Only load the additional language pack when scanning Chinese cards;
      // keep existing English/Japanese scanning performance unchanged.
      const langs = language === "Chinese"
        ? ["eng", "chi_tra"] : language === "Chinese Simplified"
          ? ["eng", "chi_sim"] : ["eng"];
      worker = await createWorker(langs, undefined, {
        logger: (entry) => {
          if (entry.status === "recognizing text" && typeof entry.progress === "number") {
            setProgress(Math.round(entry.progress * 100));
          }
        },
      });

      if (!chinese) {
        await worker.setParameters({
          tessedit_char_whitelist: "0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz*",
          preserve_interword_spaces: "1",
        });
      } else {
        await worker.setParameters({ preserve_interword_spaces: "1" });
      }

      const first = await worker.recognize(preprocessCanvas(canvas, chinese));
      let text = first.data.text?.trim() ?? "";
      let identity = chinese ? null : parsePrintedIdentity(text);
      let number = chinese ? extractChineseCollectorNumber(text) :
        identity ? (identity.setCode ? identity.setCode + " " : "") + identity.number : "";

      // The set code isn't consistently in the last 40% on Chinese cards.
      // A second full-image pass is safer than guessing from a damage or HP stat.
      if (chinese && (!number || !/^[A-Z0-9.\\-]+\\s+\\d/.test(number))) {
        const second = await worker.recognize(canvas);
        const secondText = second.data.text?.trim() ?? "";
        text = [text, secondText].filter(Boolean).join("\n");
        const secondNumber = extractChineseCollectorNumber(secondText);
        if (secondNumber && (!number || /^[A-Z0-9.\\-]+\\s+\\d/.test(secondNumber))) {
          number = secondNumber;
        }
      }

      if (!chinese && (!identity || identity.confidence !== "high")) {
        const second = await worker.recognize(canvas);
        const fullText = second.data.text?.trim() ?? "";
        const fullIdentity = parsePrintedIdentity(fullText);
        text = [text, fullText].filter(Boolean).join("\n");
        if (fullIdentity && (!identity || fullIdentity.confidence === "high")) {
          identity = fullIdentity;
          number = (identity.setCode ? identity.setCode + " " : "") + identity.number;
        }
      }

      setRawText(text);
      setCandidate(number);
      if (!number) {
        setStatus("error");
        setMessage("Could not confidently find the printed set code and collector number. Retake the photo or enter them manually.");
        return;
      }

      setMessage("Detected " + number + ". Comparing catalogue artwork…");
      await findVisualMatches(canvas, number);
      setStatus("result");
      setMessage("Detected " + number + ". Verify the printing before adding.");
    } catch {
      setStatus("error");
      setMessage("OCR could not complete on this device. Retake the photo or enter the printed code and number manually.");
    } finally {
      if (worker) await worker.terminate().catch(() => undefined);
    }
  }

  async function captureFromVideo() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    await recognize(canvas);
  }

  async function processFile(file: File) {
    const image = new window.Image();
    const objectUrl = URL.createObjectURL(file);

    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Image load failed"));
        image.src = objectUrl;
      });

      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(image, 0, 0);
      await recognize(canvas);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function confirm() {
    const normalized = game === "pokemon" &&
      (language === "Japanese" || language === "Chinese" || language === "Chinese Simplified")
      ? candidate.normalize("NFKC").trim() : normalizeCandidate(candidate);
    if (!normalized) return;
    await onDetected(normalized, rawText, preferredId || undefined);
  }

  return (
    <article className="panel scanner-panel">
      <div className="scanner-heading">
        <div>
          <span className="eyebrow">Scan Assist</span>
          <h2>Scanner 2.0 · artwork + OCR</h2>
          <p>
            {game === "riftbound" ? "Riftbound" : "Pokémon"} · {language}. Your photo stays on this device; only public catalogue artwork is fetched for comparison.
          </p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close scanner">
          <X size={18} />
        </button>
      </div>

      <div className="scanner-view">
        <video ref={videoRef} playsInline muted className="scanner-video" />
        <div className="scanner-shade scanner-shade-top" />
        <div className="scanner-target">
          <span>Center one entire card inside the guide</span>
        </div>
      </div>

      <div className="scanner-status">
        {status === "processing" ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
        <div>
          <strong>{message}</strong>
          {status === "processing" && <span>{visualBusy ? visualProgress : progress + "%"}</span>}
        </div>
      </div>

      <div className="scanner-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void captureFromVideo()}
          disabled={!cameraReady || status === "processing"}
        >
          <Camera size={17} />
          Capture & read
        </button>

        <button
          type="button"
          className="ghost"
          onClick={() => fileInputRef.current?.click()}
          disabled={status === "processing"}
        >
          <ImageIcon size={17} />
          Take / upload photo
        </button>

        <button
          type="button"
          className="ghost"
          onClick={() => void startCamera()}
          disabled={status === "processing"}
        >
          <RefreshCw size={16} />
          Reset camera
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void processFile(file);
            event.currentTarget.value = "";
          }}
        />
      </div>

      {(status === "result" || status === "error") && (
        <div className="scanner-result">
          <label>
            <span>Detected collector number</span>
            <input
              value={candidate}
              onChange={(event) => { setCandidate(event.target.value); setMatches([]); setPreferredId(""); }}
              placeholder={game === "riftbound" ? "030/298 or 030a/298" : (language === "Chinese" || language === "Chinese Simplified") ? "CSV9C 023/190" : "203/193"}
            />
          </label>

          {rawText && (
            <details>
              <summary>OCR text</summary>
              <pre>{rawText}</pre>
            </details>
          )}

          {visualBusy && <p role="status" className="muted">{visualProgress}</p>}
          {matches.length > 0 && (
            <fieldset className="scanner-match-list">
              <legend>Suggested printings · select only if the artwork and set match</legend>
              {matches.map(({ card, similarity }, index) => (
                <label className="scanner-match-option" key={card.id}>
                  <input type="radio" name="visual-card-match" value={card.id}
                    checked={preferredId === card.id}
                    onChange={() => setPreferredId(card.id)} />
                  {card.image && (
                    <img loading="lazy" alt="" width={44} height={61}
                      src={"/api/scanner/artwork?src=" + encodeURIComponent(cardImage(card.image, "low") ?? card.image)} />
                  )}
                  <span>
                    <strong>{card.name} #{card.localId}</strong>
                    <small>{card.setName ?? card.setId ?? "Unknown set"} · {similarity == null ? "Number match" : "Artwork suggestion " + (index + 1)}</small>
                  </span>
                </label>
              ))}
              <button type="button" className="text-button" onClick={() => setPreferredId("")}>
                Clear artwork selection
              </button>
            </fieldset>
          )}
          {visualNotice && <p className="muted" role="note">{visualNotice}</p>}
          {!visualBusy && !!candidate.trim() && !!lastCaptureRef.current && (
            <button type="button" className="ghost"
              onClick={() => void findVisualMatches(lastCaptureRef.current!, candidate)}>
              Compare artwork again
            </button>
          )}
          <button type="button" className="primary" onClick={() => void confirm()}
            disabled={!candidate.trim() || visualBusy}>
            <Check size={17} /> {preferredId ? "Review selected printing" : "Search this card number"}
          </button>
        </div>
      )}

      <p className="scanner-footnote">
        Tip: show the full card, keep it upright, and minimize glare. Artwork ranking does not determine foil type; verify the exact printing. Chinese and Japanese cards: keep the set code visible.
      </p>
    </article>
  );
}
