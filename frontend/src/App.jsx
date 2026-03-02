import { useEffect, useMemo, useRef, useState } from "react";

function setTimeoutTracked(ref, fn, delay) {
  if (ref.current) {
    clearTimeout(ref.current);
  }
  ref.current = window.setTimeout(() => {
    ref.current = null;
    fn();
  }, delay);
}

export default function App() {
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [currentUsername, setCurrentUsername] = useState("");
  const [archiveEntries, setArchiveEntries] = useState([]);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);

  const [statusText, setStatusText] = useState("");
  const [statusError, setStatusError] = useState(false);
  const [badgeText, setBadgeText] = useState("Loading...");

  const [currentStudy, setCurrentStudy] = useState(null);
  const [abstractText, setAbstractText] = useState("Loading abstract...");
  const [abstractMeta, setAbstractMeta] = useState("Fetching from PubMed...");

  const [cardFlipped, setCardFlipped] = useState(false);
  const [cardExit, setCardExit] = useState(false);
  const [cardEnter, setCardEnter] = useState(false);
  const [cardExitY, setCardExitY] = useState("-48px");
  const [cardDragging, setCardDragging] = useState(false);
  const [cardStyle, setCardStyle] = useState({ transform: "", opacity: "", transition: "" });

  const [loading, setLoading] = useState(false);
  const [signupSuccessFlash, setSignupSuccessFlash] = useState(false);

  const currentStudyId = currentStudy?.id || "";

  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const latestTotalLoadedRef = useRef(0);
  const latestRemainingInDeckRef = useRef(0);

  const loadingRef = useRef(false);
  const currentStudyRef = useRef(null);

  const abstractRequestTokenRef = useRef(0);
  const signupFlashTimerRef = useRef(null);
  const exitTimerRef = useRef(null);
  const enterTimerRef = useRef(null);
  const swipeResetTimerRef = useRef(null);
  const swipeRafOneRef = useRef(null);
  const swipeRafTwoRef = useRef(null);
  const cardStyleRef = useRef(cardStyle);

  const touchStartYRef = useRef(null);
  const touchStartXRef = useRef(null);
  const touchCurrentYRef = useRef(null);
  const touchCurrentXRef = useRef(null);
  const lastSwipeAtRef = useRef(0);
  const movedDuringTouchRef = useRef(false);
  const swipeConsumedRef = useRef(false);
  const touchStartedInAbstractRef = useRef(false);

  useEffect(() => {
    currentStudyRef.current = currentStudy;
  }, [currentStudy]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    cardStyleRef.current = cardStyle;
  }, [cardStyle]);

  useEffect(() => {
    return () => {
      [signupFlashTimerRef, exitTimerRef, enterTimerRef, swipeResetTimerRef].forEach((timerRef) => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      });
      if (swipeRafOneRef.current) {
        cancelAnimationFrame(swipeRafOneRef.current);
        swipeRafOneRef.current = null;
      }
      if (swipeRafTwoRef.current) {
        cancelAnimationFrame(swipeRafTwoRef.current);
        swipeRafTwoRef.current = null;
      }
    };
  }, []);

  function setStatus(text, isError = false) {
    setStatusText(text || "");
    setStatusError(Boolean(isError));
  }

  function updateDeckBadge(total, remaining) {
    if (!Number.isFinite(total) || total <= 0) {
      setBadgeText("No studies loaded");
      return;
    }
    setBadgeText(`${remaining} left / ${total} loaded`);
  }

  async function apiJson(path, options = {}) {
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function logUsage(eventType, meta = {}) {
    fetch("/api/usage/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: eventType, meta }),
    }).catch(() => {});
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }

  function resetSwipeVisual() {
    if (swipeResetTimerRef.current) {
      clearTimeout(swipeResetTimerRef.current);
      swipeResetTimerRef.current = null;
    }
    if (swipeRafOneRef.current) {
      cancelAnimationFrame(swipeRafOneRef.current);
      swipeRafOneRef.current = null;
    }
    if (swipeRafTwoRef.current) {
      cancelAnimationFrame(swipeRafTwoRef.current);
      swipeRafTwoRef.current = null;
    }

    setCardDragging(false);
    setCardStyle({ transform: "", opacity: "", transition: "" });
  }

  function updateSwipeVisual(startX, currentX, startY, currentY) {
    const dx = currentX - startX;
    if (dx <= 0) {
      resetSwipeVisual();
      return;
    }

    const cappedX = Math.min(dx, 130);
    const dy = currentY - startY;
    const offsetY = Math.max(-14, Math.min(14, dy * 0.12));
    const rotate = Math.max(-6, Math.min(6, cappedX * 0.045));

    setCardDragging(true);
    setCardStyle({
      transition: "",
      transform: `translate3d(${cappedX}px, ${offsetY}px, 0) rotate(${rotate}deg)`,
      opacity: String(1 - Math.min(cappedX / 520, 0.18)),
    });
  }

  function playArchiveSwipeVisual() {
    if (swipeResetTimerRef.current) {
      clearTimeout(swipeResetTimerRef.current);
      swipeResetTimerRef.current = null;
    }

    if (swipeRafOneRef.current) {
      cancelAnimationFrame(swipeRafOneRef.current);
      swipeRafOneRef.current = null;
    }
    if (swipeRafTwoRef.current) {
      cancelAnimationFrame(swipeRafTwoRef.current);
      swipeRafTwoRef.current = null;
    }

    setCardDragging(false);
    const startTransform = cardStyleRef.current.transform || "translate3d(0px, 0px, 0px) rotate(0deg)";
    const exitX = Math.max(window.innerWidth * 1.15, 420);

    setCardStyle({
      transition: "transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 280ms ease",
      transform: startTransform,
      opacity: cardStyleRef.current.opacity || "1",
    });

    swipeRafOneRef.current = requestAnimationFrame(() => {
      swipeRafTwoRef.current = requestAnimationFrame(() => {
        setCardStyle({
          transition: "transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 280ms ease",
          transform: `translate3d(${exitX}px, 0px, 0px) rotate(11deg)`,
          opacity: "0.06",
        });
      });
    });

    swipeResetTimerRef.current = window.setTimeout(() => {
      swipeResetTimerRef.current = null;
      setCardStyle({ transform: "", opacity: "", transition: "" });
    }, 300);
  }

  function animateOutThenIn(direction, updater) {
    resetSwipeVisual();
    setCardFlipped(false);
    setCardExitY(direction === "down" ? "48px" : "-48px");
    setCardEnter(false);
    setCardExit(true);

    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }

    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      updater();
      setCardExit(false);
      setCardEnter(true);
      enterTimerRef.current = window.setTimeout(() => {
        enterTimerRef.current = null;
        setCardEnter(false);
      }, 250);
    }, 180);
  }

  async function loadAbstractForStudy(studyId, fallbackSummary) {
    if (!studyId) {
      setAbstractMeta("No study ID available.");
      setAbstractText(fallbackSummary);
      return;
    }

    const token = ++abstractRequestTokenRef.current;
    try {
      const res = await fetch(`/api/abstract/${encodeURIComponent(studyId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (token !== abstractRequestTokenRef.current || studyId !== (currentStudyRef.current?.id || "")) return;

      if (!data.ok) {
        setAbstractMeta("PubMed lookup unavailable.");
        setAbstractText(fallbackSummary);
        return;
      }

      const text = (data.abstract || "").trim() || fallbackSummary;
      setAbstractText(text);
      if (data.source === "pubmed") {
        setAbstractMeta("Source: PubMed");
      } else {
        setAbstractMeta("Source: feed summary (PubMed not found)");
      }
    } catch (_err) {
      if (token !== abstractRequestTokenRef.current || studyId !== (currentStudyRef.current?.id || "")) return;
      setAbstractMeta("PubMed lookup failed; using feed summary.");
      setAbstractText(fallbackSummary);
    }
  }

  function renderStudy(study) {
    setCardFlipped(false);
    setCurrentStudy(study);
    setAbstractMeta("Fetching from PubMed...");
    setAbstractText("Loading abstract...");
    void loadAbstractForStudy(study.id || "", study.summary || "No abstract available.");
  }

  function renderHistoryEntry(entry, direction) {
    animateOutThenIn(direction, () => renderStudy(entry.study));

    if (Number.isFinite(entry.total_loaded) && Number.isFinite(entry.remaining_in_deck)) {
      latestTotalLoadedRef.current = entry.total_loaded;
      latestRemainingInDeckRef.current = entry.remaining_in_deck;
    }
    updateDeckBadge(latestTotalLoadedRef.current, latestRemainingInDeckRef.current);

    if (entry.message) {
      setStatus(`Loaded with warnings: ${entry.message}`, true);
    } else {
      setStatus("");
    }
  }

  function showPreviousStudy(direction = "up") {
    if (loadingRef.current) return;

    if (historyIndexRef.current <= 0) {
      setStatus("No previous study in this session.");
      return;
    }

    historyIndexRef.current -= 1;
    renderHistoryEntry(historyRef.current[historyIndexRef.current], direction);
    logUsage("previous_study", { index: historyIndexRef.current });
  }

  async function showNextStudy(direction = "down") {
    if (loadingRef.current) return;

    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current += 1;
      renderHistoryEntry(historyRef.current[historyIndexRef.current], direction);
      logUsage("next_study_history", { index: historyIndexRef.current });
      return;
    }

    setLoading(true);
    loadingRef.current = true;
    setStatus("Loading next study...");

    try {
      const res = await fetch("/api/next");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (!data.ok || !data.study) {
        setCurrentStudy(null);
        updateDeckBadge(0, 0);
        setStatus(data.message || "No cached studies available.", true);
        return;
      }

      const entry = {
        study: data.study,
        total_loaded: data.total_loaded,
        remaining_in_deck: data.remaining_in_deck,
        message: data.message || "",
      };

      historyRef.current.push(entry);
      historyIndexRef.current = historyRef.current.length - 1;
      renderHistoryEntry(entry, direction);
      logUsage("next_study_fetched", { study_id: entry.study.id || "" });
    } catch (err) {
      setStatus(`Failed to load study: ${err.message}`, true);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }

  function buildStudyText(study, abstract) {
    return [
      `Title: ${study?.title || ""}`,
      `Journal: ${study?.journal || ""}`,
      `Published: ${study?.published_label || ""}`,
      `Link: ${study?.link || ""}`,
      "",
      "Abstract:",
      abstract || "",
    ].join("\n");
  }

  async function fetchArchive(forUsername = currentUsername) {
    if (!forUsername) {
      setArchiveEntries([]);
      return;
    }

    const { res, data } = await apiJson("/api/archive");
    if (!res.ok || !data.ok) {
      setArchiveEntries([]);
      return;
    }

    setArchiveEntries(Array.isArray(data.entries) ? data.entries : []);
  }

  async function syncAuthState() {
    const { data } = await apiJson("/api/me");
    const username = data.authenticated ? (data.username || "") : "";
    setCurrentUsername(username);
    if (username) {
      await fetchArchive(username);
    } else {
      setArchiveEntries([]);
    }
  }

  async function signup() {
    const username = usernameInput.trim();
    const password = passwordInput;

    if (!username || !password) {
      setStatus("Username and password are required.", true);
      return;
    }

    const { data } = await apiJson("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!data.ok) {
      setStatus(data.message || "Signup failed.", true);
      return;
    }

    setCurrentUsername(data.username || "");
    setPasswordInput("");
    await fetchArchive(data.username || "");
    setStatus("Account created and logged in.");
    setSignupSuccessFlash(true);
    setTimeoutTracked(signupFlashTimerRef, () => setSignupSuccessFlash(false), 1400);
    logUsage("signup_ui");
  }

  async function login() {
    const username = usernameInput.trim();
    const password = passwordInput;

    if (!username || !password) {
      setStatus("Username and password are required.", true);
      return;
    }

    const { data } = await apiJson("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!data.ok) {
      setStatus(data.message || "Login failed.", true);
      return;
    }

    setCurrentUsername(data.username || "");
    setPasswordInput("");
    await fetchArchive(data.username || "");
    setStatus("Logged in.");
    logUsage("login_ui");
  }

  async function logout() {
    await apiJson("/api/logout", { method: "POST" });
    setCurrentUsername("");
    setArchiveEntries([]);
    setStatus("Logged out.");
    logUsage("logout_ui");
  }

  async function addCurrentStudyToArchive() {
    if (!currentUsername) {
      setStatus("Login required to save to personal archive.", true);
      return;
    }

    const study = currentStudyRef.current;
    if (!study || !study.id) {
      setStatus("No study loaded yet.", true);
      return;
    }

    const payload = {
      study_id: study.id,
      title: study.title || "",
      journal: study.journal || "",
      published_label: study.published_label || "",
      link: study.link || "",
      abstract: abstractText || "",
    };

    const { data } = await apiJson("/api/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!data.ok) {
      setStatus(data.message || "Could not save to archive.", true);
      return;
    }

    await fetchArchive(currentUsername);
    setStatus("Saved to your personal archive.");
    logUsage("archive_save_ui", { study_id: study.id });
  }

  function removeStudyFromHistory(studyId) {
    if (!studyId || !historyRef.current.length) return;

    const currentHistoryStudyId =
      historyIndexRef.current >= 0 ? (historyRef.current[historyIndexRef.current]?.study?.id || "") : "";

    const filtered = historyRef.current.filter((entry) => (entry?.study?.id || "") !== studyId);
    if (filtered.length === historyRef.current.length) return;

    historyRef.current = filtered;
    historyIndexRef.current = filtered.findIndex((entry) => (entry?.study?.id || "") === currentHistoryStudyId);
  }

  async function markCurrentStudyNotTransfusion() {
    const study = currentStudyRef.current;
    if (!study || !study.id) {
      setStatus("No study loaded yet.", true);
      return;
    }

    if (!currentUsername) {
      setStatus("Login required to vote 'Not transfusion'.", true);
      return;
    }

    const { res, data } = await apiJson("/api/study/not-transfusion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ study_id: study.id }),
    });

    if (!res.ok || !data.ok) {
      setStatus(data.message || "Could not submit vote.", true);
      return;
    }

    setStatus(data.message || "Vote recorded.");
    logUsage("not_transfusion_vote_ui", {
      study_id: study.id,
      votes: Number(data.votes || 0),
      excluded: Boolean(data.excluded),
    });

    if (data.excluded) {
      removeStudyFromHistory(study.id);
      if ((currentStudyRef.current?.id || "") === study.id) {
        setCurrentStudy(null);
        await showNextStudy("up");
      }
    }
  }

  async function openArchivePanel() {
    if (!currentUsername) {
      setStatus("Login required to view personal archive.", true);
      return;
    }

    await fetchArchive(currentUsername);
    setIsArchiveOpen(true);
    logUsage("open_archive_panel", { count: archiveEntries.length });
  }

  async function copyCurrentStudyInformation() {
    const study = currentStudyRef.current;
    if (!study) {
      setStatus("No study loaded yet.", true);
      return;
    }

    try {
      await copyTextToClipboard(buildStudyText(study, abstractText || ""));
      setStatus("Study information copied.");
      logUsage("copy_current_study", { study_id: study.id || "" });
    } catch (err) {
      setStatus(`Copy failed: ${err.message}`, true);
    }
  }

  async function copyArchiveListInformation() {
    if (!currentUsername) {
      setStatus("Login required to copy personal archive list.", true);
      return;
    }

    if (!archiveEntries.length) {
      await fetchArchive(currentUsername);
    }

    if (!archiveEntries.length) {
      setStatus("Archive is empty.", true);
      return;
    }

    const body = archiveEntries
      .map((study, i) => `Study ${i + 1}\n${buildStudyText(study, study.abstract || "")}`)
      .join("\n\n----------------------------------------\n\n");

    try {
      await copyTextToClipboard(body);
      setStatus(`Copied archive list (${archiveEntries.length} studies).`);
      logUsage("copy_archive_list", { count: archiveEntries.length });
    } catch (err) {
      setStatus(`Copy list failed: ${err.message}`, true);
    }
  }

  function maybeSwipeNavigate(startY, endY, startX, endX) {
    const dy = startY - endY;
    const dxSigned = endX - startX;
    const dxAbs = Math.abs(dxSigned);
    movedDuringTouchRef.current = Math.abs(dy) > 14 || dxAbs > 14;

    const now = Date.now();
    if (now - lastSwipeAtRef.current < 240) return false;

    // Right swipe saves to personal archive.
    if (dxSigned > 56 && dxAbs > Math.abs(dy) * 1.2 && Math.abs(dy) < 100) {
      lastSwipeAtRef.current = now;
      playArchiveSwipeVisual();
      void addCurrentStudyToArchive();
      return true;
    }

    if (Math.abs(dy) < 42 || dxAbs > 120 || Math.abs(dy) < dxAbs * 1.15) return false;

    resetSwipeVisual();
    lastSwipeAtRef.current = now;
    if (dy > 0) {
      void showNextStudy("up");
    } else {
      showPreviousStudy("down");
    }
    return true;
  }

  function clearTouchState() {
    touchStartYRef.current = null;
    touchStartXRef.current = null;
    touchCurrentYRef.current = null;
    touchCurrentXRef.current = null;
    touchStartedInAbstractRef.current = false;
    swipeConsumedRef.current = false;
  }

  function onCardTouchStart(ev) {
    const t = ev.changedTouches[0];
    touchStartYRef.current = t.clientY;
    touchStartXRef.current = t.clientX;
    touchCurrentYRef.current = t.clientY;
    touchCurrentXRef.current = t.clientX;
    movedDuringTouchRef.current = false;
    swipeConsumedRef.current = false;
    touchStartedInAbstractRef.current = cardFlipped && Boolean(ev.target.closest("#study-abstract"));
  }

  function onCardTouchMove(ev) {
    if (touchStartYRef.current === null || touchStartXRef.current === null) return;

    const t = ev.changedTouches[0];
    touchCurrentYRef.current = t.clientY;
    touchCurrentXRef.current = t.clientX;

    const dy = touchStartYRef.current - touchCurrentYRef.current;
    const dxSigned = touchCurrentXRef.current - touchStartXRef.current;
    const dxAbs = Math.abs(dxSigned);
    movedDuringTouchRef.current = Math.abs(dy) > 14 || dxAbs > 14;

    if (touchStartedInAbstractRef.current) {
      resetSwipeVisual();
      return;
    }

    updateSwipeVisual(
      touchStartXRef.current,
      touchCurrentXRef.current,
      touchStartYRef.current,
      touchCurrentYRef.current
    );

    if ((Math.abs(dy) > 24 && Math.abs(dy) > dxAbs * 1.2) || (dxSigned > 24 && dxAbs > Math.abs(dy) * 1.2)) {
      ev.preventDefault();
    }

    if (
      !swipeConsumedRef.current &&
      maybeSwipeNavigate(
        touchStartYRef.current,
        touchCurrentYRef.current,
        touchStartXRef.current,
        touchCurrentXRef.current
      )
    ) {
      swipeConsumedRef.current = true;
    }
  }

  function onCardTouchEnd(ev) {
    if (touchStartYRef.current === null || touchStartXRef.current === null) return;

    if (touchStartedInAbstractRef.current) {
      resetSwipeVisual();
      clearTouchState();
      return;
    }

    const t = ev.changedTouches[0];
    if (!swipeConsumedRef.current) {
      maybeSwipeNavigate(touchStartYRef.current, t.clientY, touchStartXRef.current, t.clientX);
    }
    if (!swipeConsumedRef.current) {
      resetSwipeVisual();
    }

    clearTouchState();
  }

  function onCardTouchCancel() {
    resetSwipeVisual();
    clearTouchState();
  }

  function onCardClick(ev) {
    if (ev.target.closest("#study-link") || ev.target.closest("#not-transfusion-btn")) {
      return;
    }
    if (movedDuringTouchRef.current) {
      return;
    }
    setCardFlipped((prev) => !prev);
  }

  function onCardWheel(ev) {
    if (Math.abs(ev.deltaY) < 28) return;
    if (cardFlipped && ev.target.closest("#study-abstract")) return;

    if (ev.deltaY < 0) {
      showPreviousStudy("up");
    } else {
      void showNextStudy("down");
    }
  }

  useEffect(() => {
    void (async () => {
      await syncAuthState();
      await showNextStudy("down");
      logUsage("app_open");
    })();
  }, []);

  const authStateText = currentUsername ? `Logged in as ${currentUsername}` : "Not logged in";
  const archiveButtonText = `Archive (${archiveEntries.length})`;

  const signupButtonClass = useMemo(
    () => `auth-btn${signupSuccessFlash ? " success-flash" : ""}`,
    [signupSuccessFlash]
  );

  const signupButtonLabel = signupSuccessFlash ? "Signed up ✓" : "Sign Up";

  const notTransfusionButtonTitle = !currentStudyId
    ? "Load a study first."
    : !currentUsername
      ? "Login required to vote."
      : "Report this study as not transfusion-related.";

  const cardClass = [
    "card",
    cardFlipped ? "flipped" : "",
    cardExit ? "exit" : "",
    cardEnter ? "enter" : "",
    cardDragging ? "dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const cardInlineStyle = {
    "--exit-y": cardExitY,
    transform: cardStyle.transform || undefined,
    opacity: cardStyle.opacity || undefined,
    transition: cardStyle.transition || undefined,
  };

  return (
    <>
      <main className="shell">
        <header className="header">
          <div>
            <h1 className="title">TMScroll Studies</h1>
            <p className="subtitle">Doom scroll the latest in transfusion science</p>
          </div>
          <div className="badge" id="deck-badge">{badgeText}</div>
        </header>

        <p className="status" style={{ color: statusError ? "#b91c1c" : undefined }}>
          {statusText}
        </p>

        <section className="auth-row">
          <input
            type="text"
            placeholder="username"
            autoComplete="username"
            value={usernameInput}
            onChange={(ev) => setUsernameInput(ev.target.value)}
          />
          <input
            type="password"
            placeholder="password"
            autoComplete="current-password"
            value={passwordInput}
            onChange={(ev) => setPasswordInput(ev.target.value)}
          />
          <button id="login-btn" className="auth-btn" type="button" onClick={login}>
            Login
          </button>
          <button id="signup-btn" className={signupButtonClass} type="button" onClick={signup}>
            {signupButtonLabel}
          </button>
          <button id="logout-btn" className="auth-btn" type="button" onClick={logout}>
            Logout
          </button>
          <button id="archive-btn" className="auth-btn" type="button" onClick={openArchivePanel}>
            {archiveButtonText}
          </button>
          <p className="auth-state">{authStateText}</p>
        </section>

        <section className="card-wrap">
          <article
            id="study-card"
            className={cardClass}
            aria-live="polite"
            style={cardInlineStyle}
            onClick={onCardClick}
            onWheel={onCardWheel}
            onTouchStart={onCardTouchStart}
            onTouchMove={onCardTouchMove}
            onTouchEnd={onCardTouchEnd}
            onTouchCancel={onCardTouchCancel}
          >
            <div className="card-inner">
              <section className="face front">
                <div className="journal" id="journal">
                  {currentStudy?.journal || "Loading"}
                </div>
                <h2 className="study-title" id="study-title">
                  {currentStudy?.title || "Fetching studies..."}
                </h2>
                <p className="meta" id="study-meta">
                  {currentStudy?.published_label || "Please wait."}
                </p>
                <p className="flip-hint">
                  Swipe up: next | Swipe down: previous | Swipe right: save to archive | Tap: flip
                </p>
                <p className="summary" id="study-front-summary">
                  Tap to flip for PubMed abstract.
                </p>
                <div className="study-actions">
                  {currentStudy?.link ? (
                    <a id="study-link" className="study-link" href={currentStudy.link} target="_blank" rel="noreferrer">
                      Open study
                    </a>
                  ) : (
                    <a id="study-link" className="study-link" href="#" style={{ opacity: 0.65, pointerEvents: "none" }}>
                      No direct link in feed
                    </a>
                  )}
                  <button
                    id="not-transfusion-btn"
                    className="study-flag-btn"
                    type="button"
                    title={notTransfusionButtonTitle}
                    disabled={!currentStudyId}
                    onClick={markCurrentStudyNotTransfusion}
                  >
                    Not transfusion
                  </button>
                </div>
              </section>

              <section className="face back">
                <div className="journal">Abstract</div>
                <h2 className="study-title" id="study-back-title">
                  {currentStudy?.title || "Fetching studies..."}
                </h2>
                <p className="meta" id="abstract-meta">
                  {abstractMeta}
                </p>
                <p className="summary" id="study-abstract">
                  {abstractText}
                </p>
                <p className="flip-hint">Scrolling abstract will not change studies.</p>
              </section>
            </div>
          </article>
        </section>

        <section className="controls">
          <button id="prev-btn" className="ctl-btn" type="button" onClick={() => showPreviousStudy("down")}>
            ←
          </button>
          <button id="next-btn" className="ctl-btn" type="button" onClick={() => showNextStudy("down")}>
            →
          </button>
          <button id="copy-btn" className="ctl-btn" type="button" onClick={copyCurrentStudyInformation}>
            Copy
          </button>
          <button id="copy-list-btn" className="ctl-btn" type="button" onClick={copyArchiveListInformation}>
            Copy List
          </button>
        </section>

        <p className="hint"></p>
      </main>

      <section
        className={`archive-panel${isArchiveOpen ? " open" : ""}`}
        onClick={(ev) => {
          if (ev.target === ev.currentTarget) setIsArchiveOpen(false);
        }}
      >
        <div className="archive-card">
          <div className="archive-head">
            <span>
              {currentUsername ? `${currentUsername}'s Archive (${archiveEntries.length})` : "Archive"}
            </span>
            <button className="archive-close" type="button" onClick={() => setIsArchiveOpen(false)}>
              Close
            </button>
          </div>
          <div className="archive-list">
            {!archiveEntries.length ? (
              <div className="archive-item">
                <h4>No saved studies</h4>
                <p>Swipe right on a study to save it.</p>
              </div>
            ) : (
              archiveEntries.map((study, idx) => (
                <div className="archive-item" key={`${study.study_id || study.link || "entry"}-${idx}`}>
                  <h4>{study.title || "Untitled"}</h4>
                  <p>{`${study.journal || ""} ${study.published_label || ""}`.trim()}</p>
                  {study.link ? (
                    <p>
                      <a href={study.link} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </>
  );
}
