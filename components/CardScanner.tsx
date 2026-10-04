"use client";

import { Camera, Check, Image as ImageIcon, Loader2, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CardGame, CardLanguage } from "@/lib/types";

type ScannerProps = {
  game: CardGame;
  language: CardLanguage;
  onDetected: (number: string, rawText: string) => Promise<void> | void;
  onClose: () => void;
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

function extractCollectorNumber(raw: string) {
  const cleaned = raw.toUpperCase().replace(/\n+/g, " ").replace(/\s+/g, " ");

  const slashMatch = cleaned.match(/(\d{1,3}[A-Z*]?)\s*[\/|\\]\s*(\d{1,3})/);
  if (slashMatch) {
    return normalizeCandidate(`${slashMatch[1]}/${slashMatch[2]}`);
  }

  const compact = normalizeCandidate(cleaned);
  const compactSlash = compact.match(/(\d{1,3}[A-Z*]?)\/(\d{1,3})/);
  if (compactSlash) {
    return `${compactSlash[1]}/${compactSlash[2]}`;
  }

  const standalone = cleaned.match(/\b(\d{1,3}[A-Z*]?)\b/);
  return standalone ? normalizeCandidate(standalone[1]) : "";
}

function preprocessCanvas(source: HTMLCanvasElement) {
  const output = document.createElement("canvas");
  const context = output.getContext("2d", { willReadFrequently: true });
  if (!context) return source;

  const cropTop = Math.floor(source.height * 0.60);
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
    setMessage("Point the lower edge of the card inside the frame.");

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

  async function recognize(canvas: HTMLCanvasElement) {
    setStatus("processing");
    setProgress(0);
    setMessage("Reading the collector number on-device…");

    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", undefined, {
        logger: (entry) => {
          if (entry.status === "recognizing text" && typeof entry.progress === "number") {
            setProgress(Math.round(entry.progress * 100));
          }
        },
      });

      await worker.setParameters({
        tessedit_char_whitelist: "0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz*",
        preserve_interword_spaces: "1",
      });

      const processed = preprocessCanvas(canvas);
      const result = await worker.recognize(processed);
      await worker.terminate();

      const text = result.data.text?.trim() ?? "";
      const number = extractCollectorNumber(text);

      setRawText(text);
      setCandidate(number);

      if (!number) {
        setStatus("error");
        setMessage("I could not confidently read a collector number. Retake the photo or type the number below.");
        return;
      }

      setStatus("result");
      setMessage(`Detected ${number}. Confirm it or correct the number before searching.`);
    } catch {
      setStatus("error");
      setMessage("OCR could not complete. Retake the photo or enter the collector number manually.");
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
    const normalized = normalizeCandidate(candidate);
    if (!normalized) return;
    await onDetected(normalized, rawText);
  }

  return (
    <article className="panel scanner-panel">
      <div className="scanner-heading">
        <div>
          <span className="eyebrow">Scan Assist</span>
          <h2>Scan collector number</h2>
          <p>
            {game === "riftbound" ? "Riftbound" : "Pokémon"} · {language}. The image stays on this device; OCR reads the printed number locally.
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
          <span>Keep the card number in this lower zone</span>
        </div>
      </div>

      <div className="scanner-status">
        {status === "processing" ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
        <div>
          <strong>{message}</strong>
          {status === "processing" && <span>{progress}%</span>}
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
              onChange={(event) => setCandidate(event.target.value)}
              placeholder={game === "riftbound" ? "030/298 or 030a/298" : "203/193"}
            />
          </label>

          {rawText && (
            <details>
              <summary>OCR text</summary>
              <pre>{rawText}</pre>
            </details>
          )}

          <button type="button" className="primary" onClick={() => void confirm()} disabled={!candidate.trim()}>
            <Check size={17} />
            Search this card number
          </button>
        </div>
      )}

      <p className="scanner-footnote">
        Tip: fill most of the frame with one card, keep it upright, and avoid glare over the collector number.
      </p>
    </article>
  );
}
