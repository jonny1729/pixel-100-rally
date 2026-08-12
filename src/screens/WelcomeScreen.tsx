import { useState, type FormEvent } from "react";
import { usingEmulators } from "../firebase";
import { friendlyError } from "../services/rooms.spark";
import { Brand, ErrorBanner, PixelButton } from "../components/ui";

export function WelcomeScreen({ onComplete }: { onComplete: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized || Array.from(normalized).length > 16) {
      setError("レーサー名は1〜16文字で入力してください。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onComplete(normalized);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="splash screen-shell">
      <div className="sky-pixels" aria-hidden="true" />
      <div className="splash__content">
        <Brand />
        <p className="splash__tagline">100問を駆け抜けろ。</p>
        <form className="pixel-panel entry-card" onSubmit={handleSubmit}>
          <div className="entry-card__number">01</div>
          <label htmlFor="player-name">レーサー名</label>
          <input
            id="player-name"
            autoComplete="nickname"
            maxLength={16}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="なまえを入力"
            autoFocus
          />
          {error && <ErrorBanner message={error} />}
          <PixelButton type="submit" disabled={busy || !name.trim()}>
            {busy ? "CONNECTING..." : "ENTER CIRCUIT"}
          </PixelButton>
          <small>{usingEmulators ? "LOCAL FIREBASE EMULATOR" : "FIREBASE ONLINE"}</small>
        </form>
      </div>
      <div className="pixel-road" aria-hidden="true" />
    </main>
  );
}
