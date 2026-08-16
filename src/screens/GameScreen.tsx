import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Brand, ErrorBanner, PixelButton, PLAYER_COLORS, roomPlayers } from "../components/ui";
import {
  backspaceInput,
  clearInput,
  completedCount,
  coordinates,
  createRun,
  currentIndex,
  enterDigit,
  enterNotDivisible,
  formatTime,
  gameDefinitions,
  NOT_DIVISIBLE,
  passCurrent,
  roundGridSize,
  totalProblems,
} from "../game/engine";
import { playCorrectSound, playCountdownBeep, playGoalSound, playWrongSound } from "../game/sound";
import { friendlyError, recordLeaderboardBest, submitFinish, syncCompletedCount } from "../services/rooms.spark";
import type { LocalRunState, PersistedRun, RoomData, RoomPlayer, RoundConfig } from "../types";

function RaceTrack({ players, uid, ownCount, total }: { players: RoomPlayer[]; uid: string; ownCount: number; total: number }) {
  return (
    <aside className="race-hud" aria-label="参加者のゴールまでの距離">
      <div className="race-hud__header"><span>RACE MONITOR</span><b>GOAL</b></div>
      <div className="race-lanes">
        {players.map((player, index) => {
          const count = player.id === uid ? ownCount : player.completedCount;
          const progress = Math.max(0, Math.min(100, count / total * 100));
          return (
            <div className={`race-lane ${player.id === uid ? "race-lane--me" : ""}`} key={player.id}>
              <span className="race-lane__name">{player.name}</span>
              <span className="race-lane__road">
                <i
                  className="racer-dot"
                  style={{ "--progress": `${progress}%`, "--player-color": PLAYER_COLORS[index] } as CSSProperties}
                />
                <i className="finish-strip" aria-hidden="true" />
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function HundredGrid({ round, state, racing }: { round: RoundConfig; state: LocalRunState; racing: boolean }) {
  const gridSize = roundGridSize(round);
  const game = gameDefinitions[round.gameMode];
  const active = currentIndex(state);
  const point = active === null ? { row: gridSize - 1, column: gridSize - 1 } : coordinates(active, gridSize);
  const viewportRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [guides, setGuides] = useState({
    showColumn: false,
    showRow: false,
    columns: [] as Array<{ index: number; left: number; width: number; height: number }>,
    rows: [] as Array<{ index: number; top: number; width: number; height: number }>,
    cornerLeft: 0,
    cornerTop: 0,
    cornerWidth: 0,
    cornerHeight: 0,
  });
  const style = {
    "--grid-dimension": gridSize + 1,
    "--grid-size": gridSize,
    "--race-scale": gridSize === 5 ? 1.12 : 1.7,
    "--board-x": `${((gridSize - 1) / 2 - point.column) * 100 / (gridSize + 1)}%`,
    "--board-y": `${((gridSize - 1) / 2 - point.row) * 100 / (gridSize + 1)}%`,
    "--freeze-x": guides.showRow ? `${guides.cornerWidth / 2}px` : "0px",
    "--freeze-y": guides.showColumn ? `${guides.cornerHeight / 2}px` : "0px",
  } as CSSProperties;

  useLayoutEffect(() => {
    let frame = 0;
    let settleTimer = 0;
    const measure = () => {
      const viewport = viewportRef.current;
      const grid = gridRef.current;
      if (!racing || active === null || !viewport || !grid) {
        setGuides((current) => current.showColumn || current.showRow ? { ...current, showColumn: false, showRow: false } : current);
        return;
      }
      const columnHeader = grid.querySelector<HTMLElement>(`[data-column-header="${point.column}"]`);
      const rowHeader = grid.querySelector<HTMLElement>(`[data-row-header="${point.row}"]`);
      const corner = grid.querySelector<HTMLElement>(".grid-corner");
      if (!columnHeader || !rowHeader || !corner) return;

      const viewportRect = viewport.getBoundingClientRect();
      const columnRect = columnHeader.getBoundingClientRect();
      const rowRect = rowHeader.getBoundingClientRect();
      const cornerRect = corner.getBoundingClientRect();
      const gridStyle = getComputedStyle(grid);
      const freezeX = Number.parseFloat(gridStyle.getPropertyValue("--freeze-x")) || 0;
      const freezeY = Number.parseFloat(gridStyle.getPropertyValue("--freeze-y")) || 0;
      const columns = Array.from(grid.querySelectorAll<HTMLElement>("[data-column-header]"))
        .map((header, index) => {
          const rect = header.getBoundingClientRect();
          return { index, left: rect.left - viewportRect.left, width: rect.width, height: rect.height, rect };
        })
        .filter(({ rect }) => rect.right > viewportRect.left && rect.left < viewportRect.right)
        .map(({ rect: _rect, ...layout }) => layout);
      const rows = Array.from(grid.querySelectorAll<HTMLElement>("[data-row-header]"))
        .map((header, index) => {
          const rect = header.getBoundingClientRect();
          return { index, top: rect.top - viewportRect.top, width: rect.width, height: rect.height, rect };
        })
        .filter(({ rect }) => rect.bottom > viewportRect.top && rect.top < viewportRect.bottom)
        .map(({ rect: _rect, ...layout }) => layout);
      setGuides({
        // Freeze the complete header strip as soon as the original starts clipping.
        showColumn: columnRect.top - freezeY < viewportRect.top + 1,
        showRow: rowRect.left - freezeX < viewportRect.left + 1,
        columns,
        rows,
        cornerLeft: cornerRect.left - viewportRect.left,
        cornerTop: cornerRect.top - viewportRect.top,
        cornerWidth: cornerRect.width,
        cornerHeight: cornerRect.height,
      });
    };

    frame = requestAnimationFrame(measure);
    settleTimer = window.setTimeout(measure, 130);
    window.addEventListener("resize", measure);
    gridRef.current?.addEventListener("transitionend", measure);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settleTimer);
      window.removeEventListener("resize", measure);
      gridRef.current?.removeEventListener("transitionend", measure);
    };
  }, [active, point.column, point.row, racing]);

  return (
    <div ref={viewportRef} className={`board-viewport ${racing ? "board-viewport--racing" : ""}`}>
      {racing && active !== null && guides.showColumn && guides.columns.map((header) => (
        <div
          className={`focus-axis focus-axis--column ${header.index === point.column ? "focus-axis--current" : ""}`}
          style={{ left: header.left, width: header.width, height: header.height }}
          aria-hidden="true"
          key={`fixed-column-${header.index}`}
        >
          {round.columnValues[header.index]}
        </div>
      ))}
      {racing && active !== null && guides.showRow && guides.rows.map((header) => (
        <div
          className={`focus-axis focus-axis--row ${header.index === point.row ? "focus-axis--current" : ""}`}
          style={{ top: header.top, width: header.width, height: header.height }}
          aria-hidden="true"
          key={`fixed-row-${header.index}`}
        >
          {round.rowValues[header.index]}
        </div>
      ))}
      {racing && active !== null && (guides.showColumn || guides.showRow) && (
        <div
          className="focus-axis focus-axis--corner"
          style={{
            left: guides.showRow ? 0 : guides.cornerLeft,
            top: guides.showColumn ? 0 : guides.cornerTop,
            width: guides.cornerWidth,
            height: guides.cornerHeight,
          }}
          aria-hidden="true"
        >
          {game.symbol}
        </div>
      )}
      <div ref={gridRef} className={`hundred-grid hundred-grid--${gridSize}`} style={style}>
        <div className="grid-header grid-corner">{game.symbol}</div>
        {round.columnValues.map((value, index) => <div className="grid-header" data-column-header={index} key={`column-${index}`}>{value}</div>)}
        {round.rowValues.map((rowValue, row) => (
          <div className="grid-row" key={`row-${row}`}>
            <div className="grid-header" data-row-header={row}>{rowValue}</div>
            {round.columnValues.map((_, column) => {
              const index = row * gridSize + column;
              const isActive = active === index;
              const solved = state.answers[index] !== null;
              return (
                <div
                  className={`grid-cell ${solved ? "grid-cell--solved" : ""} ${state.passed[index] ? "grid-cell--passed" : ""} ${isActive ? "grid-cell--active" : ""}`}
                  data-grid-cell={index}
                  key={index}
                >
                  {solved ? state.answers[index] === NOT_DIVISIBLE ? "—" : state.answers[index] : isActive ? <span>{state.input}<i /></span> : state.passed[index] ? "·" : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
function NumberPad({
  disabled,
  onDigit,
  onClear,
  onBackspace,
  onNotDivisible,
  onPass,
}: {
  disabled: boolean;
  onDigit: (digit: number) => void;
  onClear: () => void;
  onBackspace: () => void;
  onNotDivisible?: () => void;
  onPass: () => void;
}) {
  return (
    <div className="number-pad" aria-label="数字入力パッド">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
        <button type="button" key={digit} onPointerDown={(event) => { event.preventDefault(); onDigit(digit); }} disabled={disabled}>{digit}</button>
      ))}
      <button type="button" className="number-pad__clear" onPointerDown={(event) => { event.preventDefault(); onClear(); }} disabled={disabled}>CLR</button>
      <button type="button" onPointerDown={(event) => { event.preventDefault(); onDigit(0); }} disabled={disabled}>0</button>
      <button type="button" className="number-pad__back" onPointerDown={(event) => { event.preventDefault(); onBackspace(); }} disabled={disabled}>⌫</button>
      {onNotDivisible && <button type="button" className="number-pad__not-divisible" onPointerDown={(event) => { event.preventDefault(); onNotDivisible(); }} disabled={disabled}>割り切れない</button>}
      <button type="button" className="number-pad__pass" onPointerDown={(event) => { event.preventDefault(); onPass(); }} disabled={disabled}>PASS ›</button>
    </div>
  );
}

function ResultsPanel({ room, uid, ownTime, onLeave }: { room: RoomData; uid: string; ownTime: number | null; onLeave: () => void }) {
  const originalOrder = roomPlayers(room);
  const players = [...originalOrder].sort((a, b) => {
    if (a.status === "finished" && b.status !== "finished") return -1;
    if (a.status !== "finished" && b.status === "finished") return 1;
    if (a.status === "finished" && b.status === "finished") {
      return (a.elapsedTime ?? Infinity) - (b.elapsedTime ?? Infinity) || (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity);
    }
    if (a.status === "dnf" && b.status !== "dnf") return 1;
    if (a.status !== "dnf" && b.status === "dnf") return -1;
    return a.joinedAt - b.joinedAt;
  });
  const finished = players.filter((player) => player.status === "finished");
  const final = room.meta.status === "finished";

  return (
    <div className="results-backdrop">
      <section className="results-panel pixel-panel" aria-live="polite">
        <span className="results-panel__kicker">{final ? "FINAL RESULT" : "LIVE RESULT"}</span>
        <h2>{players.length === 1 ? "PRACTICE CLEAR!" : "FINISH!"}</h2>
        {ownTime !== null && <p className="own-record">YOUR TIME <strong>{formatTime(ownTime)}</strong></p>}
        <ol className="result-list">
          {players.map((player) => {
            const rank = player.status === "finished" ? finished.findIndex((item) => item.id === player.id) + 1 : null;
            const colorIndex = originalOrder.findIndex((item) => item.id === player.id);
            return (
              <li key={player.id} className={player.id === uid ? "result-list__me" : ""}>
                <span className="result-rank">{rank ? String(rank).padStart(2, "0") : "--"}</span>
                <span className="result-dot" style={{ "--player-color": PLAYER_COLORS[Math.max(0, colorIndex)] } as CSSProperties} />
                <strong>{player.name}</strong>
                <span>{player.status === "finished" ? formatTime(player.elapsedTime) : player.status === "dnf" ? "DNF" : "RACING..."}</span>
              </li>
            );
          })}
        </ol>
        <p className="result-wait">{final ? "全レーサーの結果が確定しました" : "ほかのレーサーは走行中です"}</p>
        <PixelButton tone="secondary" onClick={onLeave}>パドックへ戻る</PixelButton>
      </section>
    </div>
  );
}

function restoreRun(storageKey: string, round: RoundConfig): { persisted: PersistedRun; restored: boolean } {
  const total = totalProblems(round);
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) as PersistedRun : null;
    if (parsed?.state?.roundId === round.id && parsed.state.answers?.length === total && parsed.state.passed?.length === total) {
      return { persisted: parsed, restored: true };
    }
  } catch {
    // A corrupt local snapshot should never prevent a race from starting.
  }
  return {
    persisted: { state: createRun(round.id, roundGridSize(round)), elapsedMs: 0, savedAt: Date.now() },
    restored: false,
  };
}

export function GameScreen({
  roomId,
  room,
  round,
  uid,
  onLeave,
}: {
  roomId: string;
  room: RoomData;
  round: RoundConfig;
  uid: string;
  onLeave: () => void;
}) {
  const storageKey = `pixel-rally:run:${roomId}:${round.id}:${uid}`;
  const initialRef = useRef<ReturnType<typeof restoreRun> | null>(null);
  if (!initialRef.current) initialRef.current = restoreRun(storageKey, round);
  const initial = initialRef.current;
  const [run, setRun] = useState<LocalRunState>(initial.persisted.state);
  const runRef = useRef(run);
  const [raceStarted, setRaceStarted] = useState(initial.restored);
  const [countdown, setCountdown] = useState<string | null>(initial.restored ? null : "3");
  const [elapsed, setElapsed] = useState(initial.persisted.elapsedMs);
  const elapsedRef = useRef(initial.persisted.elapsedMs);
  const baseElapsedRef = useRef(initial.restored ? initial.persisted.elapsedMs + Math.max(0, Date.now() - initial.persisted.savedAt) : 0);
  const startPerfRef = useRef(performance.now());
  const [flash, setFlash] = useState<"correct" | "wrong" | "">("");
  const serverPlayer = room.players[uid];
  const total = totalProblems(round);
  const [localFinished, setLocalFinished] = useState(serverPlayer?.status === "finished" || completedCount(run) === total);
  const [ownFinishTime, setOwnFinishTime] = useState<number | null>(serverPlayer?.elapsedTime ?? null);
  const [error, setError] = useState("");
  const flashTimer = useRef<number | null>(null);
  const leaderboardRetryRef = useRef(false);

  useEffect(() => { runRef.current = run; }, [run]);

  useEffect(() => {
    if (serverPlayer?.status !== "finished" || leaderboardRetryRef.current) return;
    leaderboardRetryRef.current = true;
    void recordLeaderboardBest(roomId, round.id).catch((cause) => {
      leaderboardRetryRef.current = false;
      setError(friendlyError(cause));
    });
  }, [roomId, round.id, serverPlayer?.status]);

  useEffect(() => {
    if (initial.restored) return;
    const origin = performance.now();
    let startedInCountdown = false;
    let previousPhase = -1;
    let animation = 0;
    const tick = (now: number) => {
      const age = now - origin;
      const phase = age < 1_000 ? 0 : age < 2_000 ? 1 : age < 3_000 ? 2 : age < 3_650 ? 3 : 4;
      if (phase !== previousPhase) {
        previousPhase = phase;
        if (phase < 3) {
          setCountdown(String(3 - phase));
          playCountdownBeep(false);
        } else if (phase === 3) {
          if (!startedInCountdown) {
            startedInCountdown = true;
            startPerfRef.current = now;
            baseElapsedRef.current = 0;
            setRaceStarted(true);
          }
          setCountdown("GO!");
          playCountdownBeep(true);
        } else {
          setCountdown(null);
          return;
        }
      }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [initial.restored]);

  useEffect(() => {
    if (!raceStarted || localFinished) return;
    let animation = 0;
    let lastPaint = 0;
    startPerfRef.current = performance.now();
    const tick = (now: number) => {
      const value = baseElapsedRef.current + (now - startPerfRef.current);
      elapsedRef.current = value;
      if (now - lastPaint > 32) {
        setElapsed(value);
        lastPaint = now;
      }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [localFinished, raceStarted]);

  useEffect(() => {
    if (!raceStarted || localFinished) return;
    const timer = window.setTimeout(() => {
      const snapshot: PersistedRun = { state: run, elapsedMs: elapsedRef.current, savedAt: Date.now() };
      localStorage.setItem(storageKey, JSON.stringify(snapshot));
    }, 0);
    return () => clearTimeout(timer);
  }, [localFinished, raceStarted, run, storageKey]);

  const pulse = useCallback((kind: "correct" | "wrong") => {
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    setFlash("");
    requestAnimationFrame(() => setFlash(kind));
    flashTimer.current = window.setTimeout(() => setFlash(""), 180);
  }, []);

  const finish = useCallback((finalState: LocalRunState) => {
    const finalTime = baseElapsedRef.current + (performance.now() - startPerfRef.current);
    elapsedRef.current = finalTime;
    setElapsed(finalTime);
    setOwnFinishTime(finalTime);
    setLocalFinished(true);
    localStorage.removeItem(storageKey);
    playGoalSound();
    void syncCompletedCount(roomId, uid, total).catch(() => undefined);
    void submitFinish(roomId, round.id, finalTime).catch((cause) => setError(friendlyError(cause)));
    runRef.current = finalState;
  }, [roomId, round.id, storageKey, total, uid]);

  const applyInputResult = useCallback((result: ReturnType<typeof enterDigit>) => {
    runRef.current = result.state;
    setRun(result.state);
    if (result.event === "wrong") {
      pulse("wrong");
      playWrongSound();
    }
    if (result.event === "correct" || result.event === "finished") {
      pulse("correct");
      if (result.event === "correct") playCorrectSound();
      const count = completedCount(result.state);
      void syncCompletedCount(roomId, uid, count).catch(() => undefined);
      if (result.event === "finished") finish(result.state);
    }
  }, [finish, pulse, roomId, uid]);

  const handleDigit = useCallback((digit: number) => {
    if (!raceStarted || localFinished) return;
    applyInputResult(enterDigit(runRef.current, digit, round));
  }, [applyInputResult, localFinished, raceStarted, round]);

  const handleNotDivisible = useCallback(() => {
    if (!raceStarted || localFinished) return;
    applyInputResult(enterNotDivisible(runRef.current, round));
  }, [applyInputResult, localFinished, raceStarted, round]);

  const handleClear = useCallback(() => {
    if (!raceStarted || localFinished) return;
    const next = clearInput(runRef.current);
    runRef.current = next;
    setRun(next);
  }, [localFinished, raceStarted]);

  const handleBackspace = useCallback(() => {
    if (!raceStarted || localFinished) return;
    const next = backspaceInput(runRef.current);
    runRef.current = next;
    setRun(next);
  }, [localFinished, raceStarted]);

  const handlePass = useCallback(() => {
    if (!raceStarted || localFinished) return;
    const next = passCurrent(runRef.current);
    runRef.current = next;
    setRun(next);
  }, [localFinished, raceStarted]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        handleDigit(Number(event.key));
      } else if (event.key === "Backspace") {
        event.preventDefault();
        handleBackspace();
      } else if (event.key === "Delete" || event.key === "Escape") {
        event.preventDefault();
        handleClear();
      } else if (round.gameMode === "division" && event.key.toLowerCase() === "n") {
        event.preventDefault();
        handleNotDivisible();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [handleBackspace, handleClear, handleDigit, handleNotDivisible, round.gameMode]);

  const handleLeaveRace = useCallback(() => {
    if (window.confirm("このレースを退出しますか？走行中の場合はDNFになります。")) onLeave();
  }, [onLeave]);

  const ownCount = completedCount(run);
  const finalSprint = total - ownCount <= 5 && !localFinished;
  const index = currentIndex(run);
  const gridSize = roundGridSize(round);
  const problem = index === null ? null : coordinates(index, gridSize);
  const game = gameDefinitions[round.gameMode];
  const players = roomPlayers(room);

  return (
    <main className={`game-screen ${flash ? `game-screen--${flash}` : ""}`}>
      <header className="game-topbar">
        <div className="game-brand-actions">
          <Brand compact />
          <button type="button" className="game-leave-button" onClick={handleLeaveRace}>退出</button>
        </div>
        <div className={`game-timer ${finalSprint ? "game-timer--hidden" : ""}`}>
          <small>TIME</small><strong>{finalSprint ? "??:??.???" : formatTime(elapsed)}</strong>
        </div>
        {!finalSprint ? <RaceTrack players={players} uid={uid} ownCount={ownCount} total={total} /> : <div className="final-lap">FINAL<br />SPRINT!</div>}
      </header>

      {error && <div className="game-error"><ErrorBanner message={error} onClose={() => setError("")} /></div>}

      <div className="game-layout">
        <section className="board-zone">
          <HundredGrid round={round} state={run} racing={raceStarted && countdown === null && !localFinished} />
          <div className="board-caption"><span>START</span><i /><span>{total} GRID CIRCUIT</span><i /><span>GOAL</span></div>
        </section>
        <aside className="control-zone">
          <div className={`current-question ${flash ? `current-question--${flash}` : ""}`}>
            <small>CURRENT CELL</small>
            {problem ? (
              game.id === "gcd" ? (
                <div className="question-line question-line--gcd">
                  <span>GCD({round.rowValues[problem.row]}, {round.columnValues[problem.column]})</span><b>=</b><strong>{run.input || "_"}</strong>
                </div>
              ) : (
                <div className="question-line">
                  <span>{round.rowValues[problem.row]}</span><b>{game.symbol}</b><span>{round.columnValues[problem.column]}</span><b>=</b><strong>{run.input || "_"}</strong>
                </div>
              )
            ) : <div className="question-line"><strong>GOAL!</strong></div>}
          </div>
          <NumberPad disabled={!raceStarted || localFinished} onDigit={handleDigit} onClear={handleClear} onBackspace={handleBackspace} onNotDivisible={game.id === "division" ? handleNotDivisible : undefined} onPass={handlePass} />
          <div className="keyboard-hint"><kbd>0-9</kbd> 数字入力 {game.id === "division" && <><kbd>N</kbd> 割り切れない </>}<kbd>⌫</kbd> 1文字削除 <kbd>DEL</kbd> クリア</div>
        </aside>
      </div>

      {countdown && <div className={`countdown countdown--${countdown === "GO!" ? "go" : "number"}`}><span>{countdown}</span><small>{countdown === "GO!" ? "RACE START" : "GET READY"}</small></div>}
      {localFinished && <ResultsPanel room={room} uid={uid} ownTime={ownFinishTime} onLeave={onLeave} />}
    </main>
  );
}
